import { createHash } from "node:crypto";
import {
  type Adapter,
  AdapterError,
  type AdapterErrorKind,
  type AdapterEvent,
  type Attachment,
  type Capabilities,
  type Health,
  type NormalizedItem,
  type Outbound,
  type ParticipantRef,
  type SendResult,
  type ThreadRef,
} from "@omnis/protocol";
import {
  type LinkedInPageLike,
  type RawConversation,
  type RawMessage,
  SelectorMissingError,
} from "./page.js";

// US-C09: the notification-email signal. The Playwright adapter (US-C10) joins this file's exports.
export {
  LINKEDIN_EMAIL_PREFIX,
  LINKEDIN_SENDER,
  LINKEDIN_THREAD_PREFIX,
  PREVIEW_MAX_CHARS,
  parseNotificationEmail,
} from "./email.js";
export {
  type LinkedInPageLike,
  type RawAttachment,
  type RawConversation,
  type RawMessage,
  type RawParticipant,
  SelectorMissingError,
} from "./page.js";

export const CHANNEL = "linkedin" as const;

/** A1 §2.9: polling at 5-15 minute randomized intervals, never a fixed second-level cron, imitating a
 *  human user. One account and one person's message volume sit far below LinkedIn's ceilings, but the
 *  randomization itself is an account-suspension mitigation (A1-D4) and is not tuned down. */
export const POLL_MIN_MS = 300_000;
export const POLL_MAX_MS = 900_000;

/** Only the last N sourceHashes are remembered for dedupe; past that window a row is emitted again and
 *  the kernel's source_hash uniqueness is the real guard — the same tradeoff as kmsg's. */
export const DEDUPE_WINDOW = 5_000;

/** A1 §2.9: item `sourceHash` = sha256 of the conversation id, the DOM ordinal and the timestamp. The
 *  body is deliberately not part of the key: the ordinal identifies the row, so an edit or a re-render
 *  of the same message keeps its key instead of duplicating. The timestamp is the raw DOM text, not the
 *  parsed ISO (the extractor's own format is what the key is defined on). */
export function sourceHash(conversationId: string, ordinal: number, sentAt: string): string {
  return createHash("sha256").update(`${conversationId}\n${ordinal}\n${sentAt}`).digest("hex");
}

/** Uniform in [5 min, 15 min]. The clamp only bites for a rand() that returns exactly 1 (Math.random
 *  never does, and the tests pin the ceiling through it). */
export function nextPollDelayMs(rand: () => number = Math.random): number {
  return Math.min(POLL_MAX_MS, POLL_MIN_MS + Math.floor(rand() * (POLL_MAX_MS - POLL_MIN_MS + 1)));
}

const RATE_LIMIT =
  /too many requests|rate.?limit|throttl|HTTP 429|\b429\b|reached the \w+ limit|invitation limit/i;
const LOGGED_OUT =
  /not logged in|login required|sign in|unauthorized|session (?:expired|invalid)|authwall|checkpoint|\b401\b/i;
/** A LinkedIn UI change breaks the DOM selectors — "element not found" is the same class of failure as
 *  an explicit `SelectorMissingError`, and A1 §2.9 says it is fixed by a manual deploy, never a retry.
 *  The bare "selector" also catches Playwright's "Timeout waiting for selector", which a slow page can
 *  produce; that reads as `degraded` for one poll instead of `down`, and the next poll clears it. */
const SELECTOR_MISSING = /selectormissingerror|selector|element not found/i;

function causeMessage(cause: unknown): string {
  if (typeof cause === "string") return cause;
  if (cause instanceof Error) return cause.message;
  const shaped = cause as { error?: unknown; message?: unknown } | null;
  if (typeof shaped?.error === "string") return shaped.error;
  if (typeof shaped?.message === "string") return shaped.message;
  // `{ error: { message, selector } }` — the extractor's error envelope, one level deeper.
  const nested = shaped?.error as { message?: unknown } | null;
  if (typeof nested?.message === "string") return nested.message;
  return "";
}

/** The selector a failure names, if it names one at all: from the error instance, or from the
 *  extractor's `{ error: { selector } }` envelope. */
function selectorOf(cause: unknown): string | null {
  if (cause instanceof SelectorMissingError) return cause.selector;
  const shaped = cause as { error?: unknown; selector?: unknown } | null;
  const nested = (
    shaped?.error !== null && typeof shaped?.error === "object" ? shaped.error : shaped
  ) as { selector?: unknown } | null;
  const selector = nested?.selector;
  return typeof selector === "string" && selector !== "" ? selector : null;
}

export function mapError(cause: unknown): AdapterError {
  const selector = selectorOf(cause);
  const message = causeMessage(cause);
  const kind: AdapterErrorKind =
    selector !== null || SELECTOR_MISSING.test(message)
      ? "fatal_protocol"
      : RATE_LIMIT.test(message)
        ? "retryable_rate_limit"
        : LOGGED_OUT.test(message)
          ? "auth_expired"
          : // Anything left is a transient call failure — a navigation timeout, a closed browser, a
            // dropped connection — and the poller retries it on its normal schedule.
            "retryable_network";
  const detail = selector !== null ? `selector not found: ${selector}` : message || "call failed";
  return new AdapterError(kind, CHANNEL, `linkedin: ${detail}`, undefined, cause);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function attachmentsOf(raw: unknown): Attachment[] {
  if (!Array.isArray(raw)) return [];
  const out: Attachment[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") continue;
    const { kind, url } = entry as { kind?: unknown; url?: unknown };
    // The protocol's kind vocabulary is wider than the extractor's ("image" | "file"), and an unknown
    // kind is a document we can still carry — losing the message would be worse than labelling it.
    const shaped: Attachment = { kind: kind === "image" ? "image" : "file" };
    const href = nonEmptyString(url);
    if (href !== null) shaped.url = href;
    out.push(shaped);
  }
  return out;
}

function participantsOf(raw: unknown): ParticipantRef[] {
  if (!Array.isArray(raw)) return [];
  const out: ParticipantRef[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") continue;
    const { name, profileUrl } = entry as { name?: unknown; profileUrl?: unknown };
    const displayName = nonEmptyString(name);
    if (displayName === null) continue;
    // The profile URL is the stable id; a hidden profile leaves only a display name, and the email
    // adapter already keys participants the same way.
    out.push({ externalId: nonEmptyString(profileUrl) ?? displayName, displayName });
  }
  return out;
}

interface ConversationContext {
  conversationId: string;
  title: string | null;
  participants: ParticipantRef[];
}

function conversationOf(raw: unknown): ConversationContext | null {
  if (raw === null || typeof raw !== "object") return null;
  const candidate = raw as Partial<RawConversation>;
  const conversationId = nonEmptyString(candidate.conversationId);
  if (conversationId === null) return null;
  return {
    conversationId,
    title: nonEmptyString(candidate.title),
    participants: participantsOf(candidate.participants),
  };
}

interface MessageRow {
  conversationId: string;
  ordinal: number;
  authorId: string;
  text: string;
  attachments: Attachment[];
  sentAt: Date;
  rawSentAt: string;
}

/** A message that cannot be keyed (no conversation id, no ordinal, no readable timestamp) is dropped:
 *  `sourceHash` is what keeps the kernel from storing it twice, so an unkeyable row has no place on the
 *  timeline. The rest of the batch still goes through. */
function messageOf(entry: unknown, fallbackConversationId: string | null): MessageRow | null {
  if (entry === null || typeof entry !== "object") return null;
  const candidate = entry as Partial<RawMessage>;
  // The extractor knows the conversation id once per thread, so a per-message copy is optional.
  const conversationId = nonEmptyString(candidate.conversationId) ?? fallbackConversationId;
  if (conversationId === null) return null;
  if (typeof candidate.ordinal !== "number" || !Number.isFinite(candidate.ordinal)) return null;
  const rawSentAt = nonEmptyString(candidate.sentAt);
  if (rawSentAt === null) return null;
  const at = new Date(rawSentAt).getTime();
  // An unreadable timestamp has no place on the timeline, and `sentAt` must be a valid ISO string — a
  // dropped row beats one stamped with the epoch.
  if (!Number.isFinite(at)) return null;

  const senderName = nonEmptyString(candidate.senderName) ?? "";
  const senderProfileUrl = nonEmptyString(candidate.senderProfileUrl);
  const isMe = candidate.isMe === true;
  const text = typeof candidate.text === "string" ? candidate.text : "";
  const attachments = attachmentsOf(candidate.attachments);
  // A row with neither text nor media carries nothing to store; telegram and slack drop the same case
  // rather than putting a blank line in the inbox.
  if (text === "" && attachments.length === 0) return null;

  return {
    conversationId,
    ordinal: candidate.ordinal,
    authorId: isMe ? "me" : (senderProfileUrl ?? (senderName !== "" ? senderName : "unknown")),
    text,
    attachments,
    sentAt: new Date(at),
    rawSentAt,
  };
}

/** `raw` is the extractor's JSON: `{ conversation?, messages }`, or its `{ error: ... }` envelope — which
 *  has no `messages`, yields nothing here, and is classified by `mapError()` instead. */
export function normalize(raw: unknown): NormalizedItem[] {
  if (raw === null || typeof raw !== "object") return [];
  const payload = raw as { conversation?: unknown; messages?: unknown };
  if (!Array.isArray(payload.messages)) return [];

  const conversation = conversationOf(payload.conversation);
  const rows: MessageRow[] = [];
  for (const entry of payload.messages) {
    const row = messageOf(entry, conversation?.conversationId ?? null);
    if (row !== null) rows.push(row);
  }
  if (rows.length === 0) return [];

  const lastItemAt = new Date(Math.max(...rows.map((row) => row.sentAt.getTime()))).toISOString();
  // The inbox lists every participant including you, so a thread with more than two is a group message.
  // ponytail: kept to the participant count — the real extractor's output is what decides this, and task
  // 26 re-pins it against a live page (spike A1-⑧).
  const threadMeta =
    conversation === null
      ? null
      : {
          externalId: conversation.conversationId,
          kind: conversation.participants.length > 2 ? ("group" as const) : ("dm" as const),
          title: conversation.title,
          participants: conversation.participants,
          lastItemAt,
          archivedAt: null,
        };

  return rows.map((row) => {
    const hash = sourceHash(row.conversationId, row.ordinal, row.rawSentAt);
    return {
      threadExternalId: row.conversationId,
      externalId: hash,
      kind: "message",
      author: { kind: "person", id: row.authorId },
      body: row.text,
      attachments: row.attachments,
      sentAt: row.sentAt.toISOString(),
      status: "received",
      sourceHash: hash,
      ...(threadMeta === null ? {} : { threadMeta }),
    };
  });
}

/** The kmsg/slack/telegram adapters each carry their own copy of this twenty-line push-to-pull bridge;
 *  a fourth copy keeps the diff to this package instead of refactoring three adapters another task owns. */
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

export interface LinkedInAdapterDeps {
  page?: LinkedInPageLike;
  /** The approval-gate sink. Write-back ships only through the approval path (US-A07), which injects the
   *  send here — telegram's idiom. Without it `send()` is `fatal_unsupported` and nothing is typed. */
  sink?: (thread: ThreadRef, draft: Outbound) => Promise<SendResult>;
  rand?: () => number;
  now?: () => Date;
}

/** The inbox rows the adapter is willing to open: an entry without an id cannot be passed to
 *  `openThread()`, and a UI change that breaks the row shape should degrade capture, not stop it. */
function openableConversations(raw: unknown): RawConversation[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry) =>
      entry !== null &&
      typeof entry === "object" &&
      nonEmptyString((entry as RawConversation).conversationId) !== null,
  ) as RawConversation[];
}

export function createLinkedInAdapter(deps: LinkedInAdapterDeps = {}): Adapter {
  const now = deps.now ?? ((): Date => new Date());
  const rand = deps.rand ?? Math.random;
  const page = deps.page;
  const queue = new AsyncQueue<NormalizedItem | AdapterEvent>();
  const seen = new Map<string, true>();
  let status: Health["status"] = "down";
  let lastEventAt: string | null = null;
  let lastError: Health["lastError"];
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = true;

  function alreadySeen(hash: string): boolean {
    if (seen.has(hash)) return true;
    seen.set(hash, true);
    if (seen.size > DEDUPE_WINDOW) {
      const oldest = seen.keys().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
    return false;
  }

  function emit(raw: unknown): void {
    for (const item of normalize(raw)) {
      if (alreadySeen(item.sourceHash)) continue;
      lastEventAt = now().toISOString();
      queue.push(item);
    }
  }

  function recordError(cause: unknown): AdapterError {
    const err = mapError(cause);
    lastError = { kind: err.kind, message: err.message, at: now().toISOString() };
    // Broken selectors degrade capture (the notification-email signal still arrives through Gmail) but
    // the poller keeps its schedule, so it is not "down".
    status = err.kind === "fatal_protocol" ? "degraded" : "down";
    return err;
  }

  /** The page is injected at construction, so "is it wired" is not the same question as "is it in
   *  service": reading before connect() (or after disconnect()) has to fail, not serve a dead page. */
  function requireConnected(method: string): LinkedInPageLike {
    if (page === undefined || stopped) {
      throw new AdapterError(
        "fatal_protocol",
        CHANNEL,
        `${method}() called before connect() — no LinkedIn page is in service`,
      );
    }
    return page;
  }

  // A1 §2.9: the inbox page is opened to see whether new threads exist — only unread ones are opened
  // further, and no profile is ever visited. That is the whole anti-bulk-browsing rule (A1-D4).
  async function pollOnce(): Promise<void> {
    if (page === undefined) return;
    try {
      for (const conversation of openableConversations(await page.pollInbox())) {
        if (conversation.unread !== true) continue;
        emit({ conversation, messages: await page.openThread(conversation.conversationId) });
      }
      status = "healthy";
      lastError = undefined;
    } catch (cause) {
      recordError(cause);
    }
  }

  // No retry burst: a failure never shortens the interval, it just leaves the flag up until the next
  // scheduled poll finds the selectors working again.
  function schedulePoll(): void {
    if (stopped) return;
    pollTimer = setTimeout(() => {
      void pollOnce().finally(schedulePoll);
    }, nextPollDelayMs(rand));
  }

  return {
    id: "linkedin",
    channel: CHANNEL,
    capabilities: (): Capabilities => ({
      read: true,
      // Approval-only write-back: no gate injected means there is nothing this adapter may send.
      write: deps.sink !== undefined,
      realtime: false, // 5-15 minute polling, deliberately (A1 §2.9)
      history: true, // the one-time first-login inbox pass
      media: true, // image/document URLs are extracted and cached downstream
      markRead: false, // LinkedIn marks a thread read when the inbox opens — there is no call to make
      typing: false,
      archive: false,
      delete: false,
    }),

    async connect(): Promise<void> {
      // Deliberately no Keychain item: A1 §2.9 keeps the session cookies in the Playwright profile
      // directory and stores no credentials of ours, so there is no secret to read here.
      if (page === undefined) {
        status = "down";
        throw new AdapterError(
          "fatal_protocol",
          CHANNEL,
          "Playwright page not wired — LinkedIn capture runs on the GUI host (C-D3)",
        );
      }
      stopped = false;
      status = "healthy";
      lastEventAt = now().toISOString();
      queue.push({ kind: "connected", at: lastEventAt });
    },

    async disconnect(): Promise<void> {
      stopped = true;
      if (pollTimer !== undefined) {
        clearTimeout(pollTimer);
        pollTimer = undefined;
      }
      status = "down";
    },

    // A1 §2.9: the first login reads recent conversation history once — that is when read threads are
    // opened too. Every later read is the unread-only poll above.
    async *backfill(): AsyncIterable<NormalizedItem> {
      const active = requireConnected("backfill");
      let inbox: unknown;
      try {
        inbox = await active.pollInbox();
      } catch (cause) {
        throw recordError(cause);
      }
      const conversations = openableConversations(inbox);
      let done = 0;
      for (const conversation of conversations) {
        let messages: unknown;
        try {
          messages = await active.openThread(conversation.conversationId);
        } catch (cause) {
          throw recordError(cause);
        }
        for (const item of normalize({ conversation, messages })) {
          yield item;
          done += 1;
        }
      }
      queue.push({
        kind: "backfill_progress",
        done,
        total: conversations.length,
        at: now().toISOString(),
      });
    },

    subscribe(): AsyncIterable<NormalizedItem | AdapterEvent> {
      requireConnected("subscribe");
      stopped = false;
      schedulePoll();
      return queue;
    },

    async send(thread: ThreadRef, draft: Outbound): Promise<SendResult> {
      // A1 §2.9: write-back is approval-only. The adapter never types into the message box itself — the
      // approval execution path injects a sink, so a send cannot happen without a gate.
      if (deps.sink === undefined) {
        throw new AdapterError(
          "fatal_unsupported",
          CHANNEL,
          "LinkedIn send needs an approval-gate sink — write-back ships with the approval path (US-A07)",
        );
      }
      return deps.sink(thread, draft);
    },

    async health(): Promise<Health> {
      return {
        channel: CHANNEL,
        accountExternalId: "",
        status,
        lastEventAt,
        ...(lastError ? { lastError } : {}),
      };
    },
  };
}
