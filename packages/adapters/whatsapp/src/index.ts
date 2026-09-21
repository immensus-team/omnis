import {
  type Adapter,
  AdapterError,
  type AdapterErrorKind,
  type AdapterEvent,
  type Attachment,
  type AuthRef,
  type Capabilities,
  type Health,
  type NormalizedItem,
  type Outbound,
  type ParticipantRef,
  type SendResult,
  type ThreadRef,
} from "@omnis/protocol";
import { readKeychainSecret } from "./keychain.js";

export const CHANNEL = "whatsapp" as const;

/** A1 §2.6: Beeper's WebSocket is labelled experimental, so it runs in parallel with a 1-minute REST
 *  poll rather than replacing it — the poll is the documented fallback when the WS drops. */
export const POLL_MS = 60_000;

/** A1-D3 / A1 §2.7: the whatsmeow switch condition is "the WS reconnects 3 or more times during a
 *  30-minute observation". */
export const WS_RECONNECT_DEGRADE = 3;
export const WS_WINDOW_MS = 30 * 60_000;

/** A1-D3's signal, pinned to the exact text the health surface carries so the switch condition is
 *  greppable rather than inferred from a status code. */
export const WS_UNSTABLE_MESSAGE = "ws_unstable: consider whatsmeow fallback (A1-D3)";

/** Only the last N sourceHashes are remembered for dedupe; past that window a row is emitted again and
 *  the kernel's source_hash uniqueness is the real guard (the same tradeoff as kmsg's and linkedin's). */
export const DEDUPE_WINDOW = 5_000;

/** One page per chat per pass. Beeper already holds history locally, so pages are cheap; a message
 *  sitting past the page edge arrives on the next pass, where sourceHash makes it idempotent. That is
 *  true of the poll, which runs every POLL_MS forever — backfill() is one-shot, so it cannot lean on a
 *  next pass. See its note.
 *  UNVERIFIED: this assumes `after` returns the OLDEST rows first. If Beeper returns newest-first, a
 *  chat producing more than a page between two polls misses the older slice for good while the cursor
 *  advances past it — the US-C23 spike settles the ordering before the poll is trusted. */
const MESSAGE_PAGE_LIMIT = 100;

/** A Beeper Desktop API WS frame, as the client hands it over. The wire format is flat — `{ type, seq,
 *  ts, chatID, ids, entries }`, with `entries` carrying full payloads for `message.upserted` and
 *  nothing but `ids` for the deletions — so `data` is whatever the client extracted for this type. */
export type BeeperEvent = {
  type: "message.upserted" | "message.deleted" | "chat.upserted" | "chat.deleted";
  data: unknown;
};

/** Whether a real Desktop API client satisfies this subset is UNVERIFIED — the A1-② spike checks it
 *  against a paired secondary number (US-C23). Narrow on purpose: only the calls the adapter makes, so
 *  every fixture/mock test runs without an HTTP client or a Beeper install. */
export interface BeeperClientLike {
  listChats(): Promise<unknown[]>;
  listMessages(chatId: string, opts: { after?: string; limit: number }): Promise<unknown[]>;
  sendMessage(chatId: string, text: string): Promise<{ id: string; timestamp: string }>;
  markRead(chatId: string): Promise<void>;
  onEvent(cb: (e: BeeperEvent) => void, onClose: (reason: string) => void): () => void;
}

export interface WhatsAppAdapterDeps {
  client?: BeeperClientLike;
  /** The approval-gate sink. Write-back ships only through the approval path (US-A07), which injects the
   *  send here — telegram's and linkedin's idiom. Without it `send()` is `fatal_unsupported`. */
  sink?: (thread: ThreadRef, draft: Outbound) => Promise<SendResult>;
  now?: () => Date;
  pollMs?: number;
}

type Json = Record<string, unknown>;

function recordOf(value: unknown): Json | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : null;
}

function textOf(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

const WHATSAPP_ACCOUNT = /whatsapp/i;

/** backlog US-C11 "keep only WhatsApp-network chats". Beeper carries 12+ networks (master §8) and omnis
 *  v1 takes WhatsApp alone, so every chat and message is filtered through this before it becomes an
 *  item. The chat's `network` is authoritative when present; a *message* payload has no `network` field
 *  in the Desktop API schema, so it falls back to the account id, which does carry the bridge name
 *  (`local-whatsapp_ba_…` / `whatsapp_…` — the ids the API docs show). An empty `network` is treated as
 *  absent rather than as a mismatch, so a sparsely-populated payload is not silently dropped. */
export function isWhatsAppChat(chat: { accountID?: string; network?: string }): boolean {
  // Trimmed before the comparison: a padded value must not read as a mismatch, because that is not a
  // mislabelled chat but a dropped one — listWhatsAppChats skips it and every message in it is lost.
  const network = textOf(chat.network)?.trim() ?? null;
  if (network !== null && network !== "") return network.toLowerCase() === "whatsapp";
  return WHATSAPP_ACCOUNT.test(chat.accountID ?? "");
}

function networkFields(raw: Json): { accountID?: string; network?: string } {
  const out: { accountID?: string; network?: string } = {};
  const accountID = textOf(raw.accountID);
  if (accountID !== null) out.accountID = accountID;
  const network = textOf(raw.network);
  if (network !== null) out.network = network;
  return out;
}

const RATE_LIMIT = /too many requests|rate.?limit|throttl|\b429\b/i;

/** The shape a Beeper client raises: the HTTP status, the message, and the server's Retry-After when it
 *  sent one. A non-HTTP fault (a dead socket, Beeper.app quitting) has no status and lands as a
 *  transient network error, which is what A1 §2.6 expects to see when Beeper itself dies. */
export function mapApiError(cause: unknown): AdapterError {
  const shaped = recordOf(cause) ?? {};
  const status = typeof shaped.status === "number" ? shaped.status : undefined;
  const message = textOf(shaped.message) ?? "";
  if (status === 429 || RATE_LIMIT.test(message)) {
    return new AdapterError(
      "retryable_rate_limit",
      CHANNEL,
      `beeper: ${message === "" ? "too many requests" : message}`,
      typeof shaped.retryAfterMs === "number" ? shaped.retryAfterMs : undefined,
      cause,
    );
  }
  // A1 §2.6: "token invalidation → auth_required". Re-issuing the token in Beeper Settings is a human
  // step, so this is an auth error and not something the poll retries its way out of.
  if (status === 401 || status === 403) {
    return new AdapterError(
      "auth_expired",
      CHANNEL,
      "beeper: Desktop API token rejected — re-issue it in Settings → Integrations (A1 §2.6)",
      undefined,
      cause,
    );
  }
  return new AdapterError(
    "retryable_network",
    CHANNEL,
    `beeper: ${message === "" ? "request failed" : message}`,
    undefined,
    cause,
  );
}

function participantsOf(raw: unknown): ParticipantRef[] {
  const container = recordOf(raw);
  const items = Array.isArray(container?.items) ? container.items : [];
  const out: ParticipantRef[] = [];
  for (const entry of items) {
    const participant = recordOf(entry);
    if (participant === null) continue;
    const id = textOf(participant.id);
    if (id === null) continue;
    out.push({
      externalId: id,
      displayName: textOf(participant.fullName) ?? textOf(participant.username) ?? id,
    });
  }
  return out;
}

interface ChatContext {
  kind: "dm" | "group";
  title: string | null;
  participants: ParticipantRef[];
}

/** The Desktop API chat's type is exactly two values — `single` (a direct message) and `group` — so
 *  anything else is read as a dm rather than inventing a third thread kind. */
function chatContextOf(raw: unknown): ChatContext | null {
  const chat = recordOf(raw);
  if (chat === null || textOf(chat.id) === null) return null;
  return {
    kind: chat.type === "group" ? "group" : "dm",
    title: textOf(chat.title),
    participants: participantsOf(chat.participants),
  };
}

function attachmentKind(type: unknown): Attachment["kind"] {
  if (type === "img") return "image";
  if (type === "video") return "video";
  if (type === "audio") return "audio";
  return "file";
}

/** The Desktop API's attachment vocabulary (`unknown | img | video | audio`) is narrower than the
 *  protocol's, so an unrecognised type is carried as a file rather than dropped — losing the message
 *  would be worse than labelling its document. */
function attachmentsOf(raw: unknown): Attachment[] {
  if (!Array.isArray(raw)) return [];
  const out: Attachment[] = [];
  for (const entry of raw) {
    const source = recordOf(entry);
    if (source === null) continue;
    const shaped: Attachment = { kind: attachmentKind(source.type) };
    const url = textOf(source.srcURL);
    if (url !== null) shaped.url = url;
    const mimeType = textOf(source.mimeType);
    if (mimeType !== null) shaped.mimeType = mimeType;
    if (typeof source.fileSize === "number") shaped.sizeBytes = source.fileSize;
    const fileName = textOf(source.fileName);
    if (fileName !== null) shaped.caption = fileName;
    out.push(shaped);
  }
  return out;
}

/** Epoch values below this are seconds, not milliseconds: 1e12 ms is 2001-09-09, and Beeper's own `ts`
 *  is ~1.7e12, so a genuine millisecond stamp is three orders of magnitude clear of the floor. */
const EPOCH_MS_FLOOR = 1e12;

/** The last millisecond whose ISO-8601 rendering keeps a four-digit year (9999-12-31T23:59:59.999Z).
 *  Past it `toISOString()` switches to an extended year — `253402300800000` renders `+010000-01-01T…` —
 *  and `sentAt` is `z.string().datetime()` (packages/protocol/src/adapter.ts:104), whose year is exactly
 *  four digits. Without this bound the adapter emits an item that the protocol's own type calls invalid.
 *  Beeper's real stamps are ~1.7e12, so year 9999 is three orders of magnitude of headroom. */
const EPOCH_MS_CEIL = 253_402_300_799_999;

/** `sentAt` must be a valid ISO string. Beeper sends ISO-8601, but the WS `ts` field is epoch
 *  milliseconds (the docs' own example: `ts: 1739320000000`), and a client that forwards the frame
 *  verbatim can hand either one over — so both are read. Anything else yields no item rather than a
 *  mis-dated row, and that includes an epoch-*seconds* number, which read as ms would silently put the
 *  message in 1970 (the same drop-rather-than-guess call the Gmail/Outlook/telegram adapters make). */
function parseSentAt(value: unknown): string | null {
  // A number is epoch milliseconds by definition, so it is measured against the floor rather than
  // trusted: an epoch-*seconds* value is the one way a numeric `ts` can be silently mis-dated instead
  // of dropped. The floor is a plain range check and deliberately not an early return — `toISOString()`
  // throws RangeError outside the Date range, so the `Number.isFinite(getTime())` guard below stays the
  // thing that decides renderability for numbers and strings alike.
  if (typeof value === "number" && (!Number.isFinite(value) || value < EPOCH_MS_FLOOR)) return null;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const ms = new Date(value).getTime();
  // The ceiling is checked on the resolved epoch rather than on the numeric input, because the string
  // form reaches an extended year too (`"+275760-09-13T00:00:00.000Z"` resolves to 8.64e15).
  if (!Number.isFinite(ms) || ms > EPOCH_MS_CEIL) return null;
  return new Date(ms).toISOString();
}

const EVENT_TYPES = new Set<string>([
  "message.upserted",
  "message.deleted",
  "chat.upserted",
  "chat.deleted",
]);

/** `raw` is either a Beeper payload (a REST `listMessages` row, or the `entries[i]` the client pulled
 *  out of a WS frame) or the whole event envelope `{ type, data }`. Both reach the same item, which is
 *  what keeps the WS and the poll from doubling each other up.
 *
 *  A message payload may carry its chat alongside it (`data.chat`, which the adapter attaches from its
 *  chat cache and the poll attaches from the chat it just listed); that chat is where threadMeta's
 *  title, participants and dm-vs-group come from. */
export function normalize(raw: unknown): NormalizedItem[] {
  // The real `message.upserted` frame carries `entries` — an array — so a whole list is read as one item
  // per entry. Handling it here rather than on the WS path alone keeps one shape rule and lets the
  // contract fixtures pin it, which they cannot do for a branch inside the adapter's event handler.
  if (Array.isArray(raw)) return raw.flatMap((entry) => normalize(entry));

  const payload = recordOf(raw);
  if (payload === null) return [];
  const type = textOf(payload.type);

  // A deletion carries no content, and omnis never hard-deletes: the stored item stays and the deletion
  // is not a new timeline entry. Checked before anything else because the real frames are IDs-only —
  // there is nothing further to read.
  if (type === "message.deleted" || type === "chat.deleted") return [];

  const rawData = type !== null && EVENT_TYPES.has(type) ? payload.data : payload;
  // The envelope's `data` is the entries array in a forwarded frame, so it is split the same way.
  if (Array.isArray(rawData)) return rawData.flatMap((entry) => normalize(entry));
  const data = recordOf(rawData);
  if (data === null) return [];

  const chat = recordOf(data.chat);
  if (!isWhatsAppChat(networkFields(chat ?? data))) return [];

  const chatId = textOf(data.chatID);
  const id = textOf(data.id);
  const senderId = textOf(data.senderID);
  // A chat payload (`chat.upserted`) has an id but no chatID and no sender, and carries no message
  // content: it is the source threadMeta is read from, never an item in itself.
  if (chatId === null || id === null || senderId === null) return [];

  // A delete that arrives as an upsert of an existing id carries nothing to store either.
  if (data.isDeleted === true) return [];

  const sentAt = parseSentAt(data.timestamp);
  if (sentAt === null) return [];

  const body = typeof data.text === "string" ? data.text : "";
  const attachments = attachmentsOf(data.attachments);
  // A state change (a group icon edit, membership churn) upserts with neither text nor media. An item
  // with an empty body and no attachment would be a blank row in the inbox, so it is dropped — telegram
  // and slack drop the same case for the same reason.
  if (body === "" && attachments.length === 0) return [];

  const context = chatContextOf(chat);
  // The raw Desktop API message id doubles as the item id and the idempotency key (A1 §2.6), and the
  // quoted-message link has no home in NormalizedItem v1, so `linkedMessageID` is dropped: a WhatsApp
  // quote threads by chat, and this item already lands in that chat.
  return [
    {
      threadExternalId: chatId,
      externalId: id,
      kind: "message",
      author: { kind: "person", id: senderId },
      body,
      attachments,
      sentAt,
      status: "received",
      sourceHash: id,
      threadMeta: {
        externalId: chatId,
        kind: context?.kind ?? "dm",
        title: context?.title ?? null,
        participants:
          context !== null && context.participants.length > 0
            ? context.participants
            : [{ externalId: senderId, displayName: textOf(data.senderName) ?? senderId }],
        lastItemAt: sentAt,
        archivedAt: null,
      },
    },
  ];
}

/** The kmsg/slack/telegram/linkedin adapters each carry their own copy of this twenty-line
 *  push-to-pull bridge; a fifth copy keeps the diff to this package instead of refactoring four
 *  adapters another task owns. */
class AsyncQueue<T> {
  private buffered: T[] = [];
  private waiters: Array<(v: IteratorResult<T>) => void> = [];
  push(value: T): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value, done: false });
      return;
    }
    this.buffered.push(value);
  }
  private async next(): Promise<IteratorResult<T>> {
    const value = this.buffered.shift();
    if (value !== undefined) return { value, done: false };
    return new Promise((resolve) => this.waiters.push(resolve));
  }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return { next: () => this.next() };
  }
}

interface StatusReport {
  status: Health["status"];
  lastError?: NonNullable<Health["lastError"]>;
}

export function createWhatsAppAdapter(deps: WhatsAppAdapterDeps = {}): Adapter {
  const now = deps.now ?? ((): Date => new Date());
  const pollMs = deps.pollMs ?? POLL_MS;
  const client = deps.client;
  const queue = new AsyncQueue<NormalizedItem | AdapterEvent>();
  const seen = new Map<string, true>();
  /** The chat context a message payload does not carry. Filled by connect(), every poll, and
   *  `chat.upserted`; emptied entry-by-entry by `chat.deleted`. */
  const chats = new Map<string, Json>();
  const closeTimes: number[] = [];
  let lastEventAt: string | null = null;
  let failure: { status: "down" | "degraded"; error: NonNullable<Health["lastError"]> } | undefined;
  let pollAfter: string | undefined;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  /** Invalidates any poll chain from a previous session or subscription — see schedulePoll(). */
  let pollGeneration = 0;
  let unsubscribe: (() => void) | undefined;
  let up = false;

  /** True once a running pass no longer belongs to the live session: disconnect() took the adapter down
   *  (`up`), or a re-subscribe started a new chain (`generation`). Both land while a chat page is in
   *  flight, which is why it is asked per chat and per message instead of only at the pass's start. */
  function superseded(generation: number): boolean {
    return !up || generation !== pollGeneration;
  }

  function alreadySeen(hash: string): boolean {
    if (seen.has(hash)) return true;
    seen.set(hash, true);
    if (seen.size > DEDUPE_WINDOW) {
      const oldest = seen.keys().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
    return false;
  }

  /** The closes still inside the 30-minute observation, oldest pruned on read so the window slides
   *  without a timer of its own. */
  function recentCloses(): number {
    const cutoff = now().getTime() - WS_WINDOW_MS;
    while (closeTimes.length > 0 && (closeTimes[0] ?? 0) < cutoff) closeTimes.shift();
    return closeTimes.length;
  }

  function rememberChat(chat: Json): void {
    const id = textOf(chat.id);
    if (id !== null) chats.set(id, chat);
  }

  /** A message payload carries no chat of its own, so the last chat seen for that chatID is attached —
   *  that is what gives the item its real threadMeta (title, dm-vs-group, participants). A cache miss
   *  leaves the payload alone and normalize() falls back to the sender. */
  function enrich(raw: unknown): unknown {
    const payload = recordOf(raw);
    if (payload === null || payload.chat !== undefined) return raw;
    const chat = payload.chatID === undefined ? undefined : chats.get(String(payload.chatID));
    return chat === undefined ? raw : { ...payload, chat };
  }

  function emit(raw: unknown): void {
    for (const item of normalize(enrich(raw))) {
      if (alreadySeen(item.sourceHash)) continue;
      lastEventAt = now().toISOString();
      queue.push(item);
    }
  }

  function recordFailure(cause: unknown, status: "down" | "degraded"): AdapterError {
    const err = mapApiError(cause);
    failure = {
      status,
      error: { kind: err.kind, message: err.message, at: now().toISOString() },
    };
    return err;
  }

  /** The two capture paths fail independently and the reported status is the worse of them. A failed
   *  poll means no capture at all (`down`); a chat warm-up or an unstable WS means capture is running
   *  but diminished (`degraded`), which is exactly A1 §2.6's REST-poll fallback.
   *  A recorded failure therefore outranks the WS-close count, so when both are true the A1-D3 condition
   *  still holds but its literal "ws_unstable" text is not the one reported. That is deliberate — `down`
   *  is the louder fault and a consumer reading the status still sees one — so nothing should grep for
   *  that string to detect the switch condition. The US-C23 spike should settle which signal is
   *  authoritative rather than leave it to whichever branch runs first. */
  function statusAndError(): StatusReport {
    if (!up) return { status: "down" };
    if (failure !== undefined) return { status: failure.status, lastError: failure.error };
    const closes = recentCloses();
    if (closes >= WS_RECONNECT_DEGRADE) {
      return {
        status: "degraded",
        lastError: {
          kind: "retryable_network",
          message: WS_UNSTABLE_MESSAGE,
          at: new Date(closeTimes[closes - 1] ?? 0).toISOString(),
        },
      };
    }
    return { status: "healthy" };
  }

  /** The client is injected at construction, so "is it wired" is not the same question as "is it in
   *  service": reading before connect() (or after disconnect()) has to fail, not serve a dead client. */
  function requireClient(method: string): BeeperClientLike {
    if (client === undefined || !up) {
      throw new AdapterError(
        "fatal_protocol",
        CHANNEL,
        `${method}() called before connect() — no Beeper client is in service`,
      );
    }
    return client;
  }

  async function listWhatsAppChats(
    active: BeeperClientLike,
  ): Promise<Array<Json & { id: string }>> {
    const out: Array<Json & { id: string }> = [];
    for (const raw of await active.listChats()) {
      const chat = recordOf(raw);
      if (chat === null) continue;
      rememberChat(chat);
      if (!isWhatsAppChat(networkFields(chat))) continue;
      const id = textOf(chat.id);
      if (id !== null) out.push({ ...chat, id });
    }
    return out;
  }

  async function messagesOf(
    active: BeeperClientLike,
    chatId: string,
    after: string | undefined,
  ): Promise<unknown[]> {
    return active.listMessages(
      chatId,
      after === undefined ? { limit: MESSAGE_PAGE_LIMIT } : { after, limit: MESSAGE_PAGE_LIMIT },
    );
  }

  function handleEvent(event: BeeperEvent): void {
    // The `entries` array is a message-frame shape, and normalize() reads it back per entry — so the
    // array needs no fan-out here. Chat frames are single-payload, and their handling is unchanged.
    const payload = recordOf(event.data) ?? recordOf(event);
    if (event.type === "chat.upserted" && payload !== null) rememberChat(payload);
    if (event.type === "chat.deleted") {
      // `chat.deleted` is an IDs-only frame, so the cache is emptied from `ids`, not from a payload.
      const ids = Array.isArray(payload?.ids) ? payload.ids : [];
      for (const id of ids) if (typeof id === "string") chats.delete(id);
    }
    emit(payload);
  }

  /** A dropped WS is the client's to re-dial — BeeperClientLike has no connect method, because the real
   *  client owns reconnection — so the adapter's whole job here is to count drops inside the window that
   *  A1-D3's switch condition is defined on. The reason text is deliberately unused: the count is the
   *  signal, and the fixed A1-D3 message is what health() reports. */
  function handleClose(_reason: string): void {
    closeTimes.push(now().getTime());
    recentCloses();
  }

  // A1 §2.6: the WS is the realtime path and the poll is the safety net beneath it. Everything either
  // one delivers goes through emit(), so a message both saw is stored once (sourceHash).
  async function pollOnce(generation = pollGeneration): Promise<void> {
    const active = client;
    // `up` is checked as well as the timer being cleared: disconnect() is what makes this adapter stop
    // reading, so a chain that survived a re-subscribe must not reach the client after it.
    if (active === undefined || superseded(generation)) return;
    const startedAt = now().toISOString();
    try {
      for (const chat of await listWhatsAppChats(active)) {
        // Re-checked per chat, not only at the top: the guard above cannot see a disconnect() or a
        // re-subscribe that lands while the chat list, or an earlier chat's page, is still in flight.
        // Without this the superseded pass walks the rest of the list and emits what it reads.
        if (superseded(generation)) return;
        for (const message of await messagesOf(active, chat.id, pollAfter)) {
          // A page is up to MESSAGE_PAGE_LIMIT messages, so the check is repeated here too: this is what
          // makes "nothing is emitted once this pass is superseded" true, rather than "at most one page".
          if (superseded(generation)) return;
          emit({ ...recordOf(message), chat });
        }
      }
      // The cursor only moves on a fully successful pass: a partial one leaves it where it was and the
      // next pass re-reads the same span, which dedupe makes free.
      pollAfter = startedAt;
      failure = undefined;
    } catch (cause) {
      recordFailure(cause, "down");
    }
  }

  // No retry burst: a failure never shortens the interval, it just leaves the flag up until the next
  // scheduled poll finds Beeper answering again.
  // `generation` is what makes a re-subscribe total. Clearing pollTimer stops a pass that is merely
  // waiting, but a pass already in flight re-schedules itself when it finishes — and it would overwrite
  // pollTimer doing so, leaving a chain that disconnect() can no longer reach. A pass from a superseded
  // generation therefore never re-schedules.
  function schedulePoll(generation = pollGeneration): void {
    if (superseded(generation)) return;
    pollTimer = setTimeout(() => {
      void pollOnce(generation).finally(() => schedulePoll(generation));
    }, pollMs);
  }

  return {
    id: "whatsapp",
    channel: CHANNEL,
    capabilities: (): Capabilities => ({
      read: true,
      // Approval-only write-back: no gate injected means there is nothing this adapter may send.
      write: deps.sink !== undefined,
      realtime: true, // the Beeper Desktop API WS
      history: true, // Beeper already holds the history locally; REST backfill
      media: true, // proxied through the Beeper Assets API
      markRead: true, // POST /v1/chats/{chatID}/read
      typing: false,
      archive: false, // A1 §3: no archive on either WhatsApp path in v1
      delete: false, // a Beeper deletion is not a hard delete
    }),

    async connect(auth: AuthRef): Promise<void> {
      // A1 §2.6: the Desktop API token is Keychain `omnis.beeper.token`, and it is never logged.
      await readKeychainSecret(auth.keychainService, CHANNEL);
      if (client === undefined) {
        up = false;
        failure = undefined;
        throw new AdapterError(
          "fatal_protocol",
          CHANNEL,
          "Beeper client not wired — the Desktop API client runs on the capture host (C-D3, US-C23)",
        );
      }
      up = true;
      // The previous session's failure is not this one's: the warm-up below either succeeds (healthy)
      // or records its own error, so a reconnect cannot report a fault that has already been cleared.
      failure = undefined;
      // A new session also supersedes any poll chain the last one left behind. It deliberately does not
      // start one: polling is what subscribe() turns on, so connect() with no subscribe() to follow is a
      // session with no reader. That pairing is the caller's — apps/hub/src/adapters.ts:203 always
      // subscribes right after connecting — and the bump here is only ever an invalidation.
      pollGeneration += 1;
      lastEventAt = now().toISOString();
      // Warm the chat cache before any WS event can arrive: it is what lets a group's first WS message
      // carry threadMeta.kind = "group". threads.kind is written on insert only
      // (packages/kernel/src/ingest.ts:79), so a cache miss at series one would pin the thread as a dm.
      try {
        await listWhatsAppChats(client);
      } catch (cause) {
        // Not fatal: the WS is up and the first poll re-lists. Capture is diminished, not stopped.
        recordFailure(cause, "degraded");
      }
      queue.push({ kind: "connected", at: lastEventAt });
    },

    async disconnect(): Promise<void> {
      up = false;
      unsubscribe?.();
      unsubscribe = undefined;
      if (pollTimer !== undefined) {
        clearTimeout(pollTimer);
        pollTimer = undefined;
      }
    },

    // A1 §2.6: Beeper already holds the history locally, so a backfill is the same two REST calls the
    // poll makes, with the caller's own `since` as the cursor.
    // ponytail: one page per chat (MESSAGE_PAGE_LIMIT). This is a ceiling, not a design — a chat with
    // more than one page since `since` is truncated silently, and the poll's next-pass argument does not
    // apply because a one-shot backfill has no next pass. Nothing calls backfill() yet; whoever wires it
    // (Task 24) must loop the REST cursor, and the US-C23 spike has to pin `after`'s inclusivity first.
    async *backfill(since?: Date): AsyncIterable<NormalizedItem> {
      const active = requireClient("backfill");
      let chatsList: Array<Json & { id: string }>;
      try {
        chatsList = await listWhatsAppChats(active);
      } catch (cause) {
        throw recordFailure(cause, "down");
      }
      let done = 0;
      for (const chat of chatsList) {
        let messages: unknown[];
        try {
          messages = await messagesOf(active, chat.id, since?.toISOString());
        } catch (cause) {
          throw recordFailure(cause, "down");
        }
        for (const message of messages) {
          for (const item of normalize(enrich({ ...recordOf(message), chat }))) {
            if (alreadySeen(item.sourceHash)) continue;
            yield item;
            done += 1;
          }
        }
      }
      // `done` counts items, so a chat count would be the wrong unit for `total` (it reads as >100%
      // progress the moment a chat yields more than one item) and the item total is not knowable before
      // paging anyway — so the denominator is null, the way kakaotalk's and slack's backfills report it.
      queue.push({ kind: "backfill_progress", done, total: null, at: now().toISOString() });
    },

    subscribe(): AsyncIterable<NormalizedItem | AdapterEvent> {
      const active = requireClient("subscribe");
      // The hub's pump() re-subscribes on a sink failure (apps/hub/src/adapters.ts:203), so this is not
      // once-per-adapter in production: a second call replaces the first registration and poll chain
      // rather than stacking a second 60-second poller on Beeper's REST API and leaving the old WS
      // callback live.
      unsubscribe?.();
      if (pollTimer !== undefined) clearTimeout(pollTimer);
      pollGeneration += 1;
      unsubscribe = active.onEvent(handleEvent, handleClose);
      schedulePoll();
      return queue;
    },

    async send(thread: ThreadRef, draft: Outbound): Promise<SendResult> {
      // A1-② leaves WhatsApp send success UNVERIFIED until the Phase 0 spike, and A1 §2.6 keeps
      // write-back draft-then-approve. The adapter never calls client.sendMessage itself — the approval
      // execution path injects the sink (Task 24), so a send cannot happen without a gate.
      if (deps.sink === undefined) {
        throw new AdapterError(
          "fatal_unsupported",
          CHANNEL,
          "WhatsApp send needs an approval-gate sink — write-back ships with the approval path (US-A07)",
        );
      }
      return deps.sink(thread, draft);
    },

    async markRead(thread: ThreadRef): Promise<void> {
      const active = requireClient("markRead");
      try {
        await active.markRead(thread.externalId);
      } catch (cause) {
        throw mapApiError(cause);
      }
    },

    async health(): Promise<Health> {
      const { status, lastError } = statusAndError();
      return {
        channel: CHANNEL,
        // The Desktop API is reached with a token, not as an account omnis owns — there is no account id
        // of ours to name here (the same call linkedin's tokenless page makes).
        accountExternalId: "",
        status,
        lastEventAt,
        ...(lastError === undefined ? {} : { lastError }),
      };
    },
  };
}
