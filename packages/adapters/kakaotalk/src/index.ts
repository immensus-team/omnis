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
  type SendResult,
  type ThreadRef,
} from "@omnis/protocol";

export const CHANNEL = "kakaotalk" as const;

/** A1 §2.8: kmsg's own default watch interval is relaxed to 5-15s ("human-level frequency", per the
 *  talksafety.kakao.com anomaly-detection list) so long-running capture does not look like a bot. */
export const POLL_MIN_MS = 5_000;
export const POLL_MAX_MS = 15_000;

/** Only the last N sourceHashes are remembered for dedupe; a line repeated past that window is emitted
 *  again, and the kernel's source_hash uniqueness is the real guard. */
export const DEDUPE_WINDOW = 5_000;

export interface KmsgClientLike {
  chats(): Promise<unknown>; // `kmsg chats --json`
  read(chatId: string): Promise<unknown>; // `kmsg read <id> --background-safe --json`
  watch(onLine: (raw: unknown) => void): () => void; // `kmsg watch --json`, returns stop
  send(
    chatId: string,
    text: string,
    opts: { dryRun: boolean },
  ): Promise<{ preview: string; sent: boolean }>;
}

export interface KakaoAdapterDeps {
  client?: KmsgClientLike;
  now?: () => Date;
  rand?: () => number;
  sendEnabled?: () => boolean;
}

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

/** A1 §2.8: the item id is a surrogate key — KakaoTalk exposes no global message id, so the
 *  (chat_id, timestamp, sender, first 64 chars) hash doubles as both `externalId` and `sourceHash`. */
export function sourceHash(
  chatId: string,
  timestamp: string,
  sender: string,
  body: string,
): string {
  return createHash("sha256")
    .update(`${chatId}\n${timestamp}\n${sender}\n${body.slice(0, 64)}`)
    .digest("hex");
}

/** Uniform in [5s, 15s]. The clamp only bites for a rand() that returns exactly 1 (Math.random never
 *  does, and tests pin the ceiling through it). */
export function nextPollDelayMs(rand: () => number = Math.random): number {
  return Math.min(POLL_MAX_MS, POLL_MIN_MS + Math.floor(rand() * (POLL_MAX_MS - POLL_MIN_MS + 1)));
}

interface KmsgLine {
  chat_id?: unknown;
  chat_name?: unknown;
  sender?: unknown;
  is_me?: unknown;
  text?: unknown;
  timestamp?: unknown;
  attachments?: unknown;
}

const ATTACHMENT_KINDS: ReadonlyArray<Attachment["kind"]> = [
  "image",
  "file",
  "audio",
  "video",
  "link",
];

function attachmentKind(kind: unknown): Attachment["kind"] {
  return ATTACHMENT_KINDS.includes(kind as Attachment["kind"])
    ? (kind as Attachment["kind"])
    : "file";
}

export function normalize(raw: unknown): NormalizedItem[] {
  if (typeof raw !== "object" || raw === null) return [];
  const line = raw as KmsgLine;
  if (line.chat_id === undefined || line.chat_id === null) return [];
  if (typeof line.timestamp !== "string" || line.timestamp.trim() === "") return [];
  const at = new Date(line.timestamp).getTime();
  // An unreadable timestamp has no place on the timeline, and `sentAt` must be a valid ISO string — a
  // dropped line beats one stamped with the epoch.
  if (!Number.isFinite(at)) return [];

  const chatId = String(line.chat_id);
  const sender = typeof line.sender === "string" && line.sender !== "" ? line.sender : null;
  const isMe = line.is_me === true;
  const authorId = isMe ? "me" : (sender ?? "unknown");
  const body = typeof line.text === "string" ? line.text : "";
  const attachments = Array.isArray(line.attachments)
    ? line.attachments.map((a) => ({
        kind: attachmentKind((a as { kind?: unknown } | null)?.kind),
      }))
    : [];
  const chatName =
    typeof line.chat_name === "string" && line.chat_name !== "" ? line.chat_name : null;
  const sentAt = new Date(at).toISOString();
  const hash = sourceHash(chatId, line.timestamp, sender ?? "", body);

  return [
    {
      threadExternalId: chatId,
      externalId: hash,
      kind: "message",
      author: { kind: "person", id: authorId },
      body,
      attachments,
      sentAt,
      status: "received",
      sourceHash: hash,
      threadMeta: {
        externalId: chatId,
        // ponytail: a kmsg line carries no room-type field, so a room name is the only signal —
        // a named 1:1 room reads as "group". Task 20 re-pins this against real kmsg output.
        kind: chatName === null ? "dm" : "group",
        title: chatName,
        participants: [{ externalId: authorId, displayName: sender ?? authorId }],
        lastItemAt: sentAt,
        archivedAt: null,
      },
    },
  ];
}

const RATE_LIMIT = /too many requests|rate.?limit|throttl|HTTP 429/i;
const NETWORK =
  /not running|not installed|no such process|connection refused|ECONNREFUSED|timed? ?out|ENOTFOUND|network/i;
// A1 §2.8 failure mode: a KakaoTalk.app update breaking the accessibility path (kmsg's AXError) is the
// expected breakage, and it is not something a retry fixes.
const AX_PATH = /axerror|ax error|element not found|accessibility|not trusted/i;
const LOGGED_OUT = /not logged in|login required|unauthorized|sign in/i;

function messageOf(cause: unknown): string {
  if (typeof cause === "string") return cause;
  if (cause instanceof Error) return cause.message;
  const shaped = cause as { error?: unknown; message?: unknown } | null;
  if (typeof shaped?.error === "string") return shaped.error;
  if (typeof shaped?.message === "string") return shaped.message;
  return "";
}

export function mapError(cause: unknown): AdapterError {
  const message = messageOf(cause);
  const kind: AdapterErrorKind = RATE_LIMIT.test(message)
    ? "retryable_rate_limit"
    : NETWORK.test(message)
      ? "retryable_network"
      : AX_PATH.test(message)
        ? "fatal_protocol"
        : LOGGED_OUT.test(message)
          ? "auth_expired"
          : "retryable_network";
  return new AdapterError(kind, CHANNEL, `kmsg: ${message || "call failed"}`, undefined, cause);
}

/** `kmsg --json` commands answer with either a bare array or an object wrapping one (`{chats:[...]}`,
 *  `{messages:[...]}`). A watch line has neither, and comes through as-is. */
function lines(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const wrapped = (raw as { chats?: unknown; messages?: unknown } | null)?.messages;
  if (Array.isArray(wrapped)) return wrapped;
  const chats = (raw as { chats?: unknown } | null)?.chats;
  if (Array.isArray(chats)) return chats;
  return [raw];
}

function chatIdOf(entry: unknown): string | null {
  if (typeof entry === "string" && entry !== "") return entry;
  const id = (entry as { chat_id?: unknown } | null)?.chat_id;
  if (id === undefined || id === null) return null;
  const asString = String(id);
  return asString === "" ? null : asString;
}

export function createKakaoTalkAdapter(deps: KakaoAdapterDeps = {}): Adapter {
  const now = deps.now ?? ((): Date => new Date());
  const rand = deps.rand ?? Math.random;
  const client = deps.client;
  const queue = new AsyncQueue<NormalizedItem | AdapterEvent>();
  const seen = new Map<string, true>();
  let status: Health["status"] = "down";
  let lastEventAt: string | null = null;
  let lastError: Health["lastError"];
  let stopWatch: (() => void) | undefined;
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

  function emit(raws: unknown[]): void {
    for (const raw of raws) {
      for (const item of normalize(raw)) {
        if (alreadySeen(item.sourceHash)) continue;
        lastEventAt = now().toISOString();
        queue.push(item);
      }
    }
  }

  function recordError(cause: unknown): AdapterError {
    const err = mapError(cause);
    lastError = { kind: err.kind, message: err.message, at: now().toISOString() };
    // A broken AX path degrades capture (the notification/OCR fallback lives outside this adapter) but
    // the watcher keeps running, so it is not "down".
    status = err.kind === "fatal_protocol" ? "degraded" : "down";
    return err;
  }

  // `watch --json` is push, but a chat opened after the watcher started only shows up in `chats`, so the
  // poll re-reads the open conversations on the same 5-15s cadence and dedupes against the watcher.
  async function pollOnce(): Promise<void> {
    if (client === undefined) return;
    try {
      for (const entry of lines(await client.chats())) {
        const chatId = chatIdOf(entry);
        if (chatId === null) continue;
        emit(lines(await client.read(chatId)));
      }
      status = "healthy";
      lastError = undefined;
    } catch (cause) {
      recordError(cause);
    }
  }

  function schedulePoll(): void {
    if (stopped) return;
    pollTimer = setTimeout(() => {
      void pollOnce().finally(schedulePoll);
    }, nextPollDelayMs(rand));
  }

  return {
    id: "kakaotalk",
    channel: CHANNEL,
    capabilities: (): Capabilities => ({
      read: true,
      write: deps.sendEnabled?.() === true, // US-C13 opens this after two weeks of stable reads
      realtime: true,
      history: false, // A1 §2.8: kmsg only exposes the currently open conversation history
      media: false,
      markRead: false,
      typing: false,
      archive: false,
      delete: false,
    }),

    async connect(): Promise<void> {
      // Deliberately no Keychain item: kmsg rides on KakaoTalk.app's own login (A1 §2.8), and `kmsg auth
      // login` is not used so no password of ours exists to store.
      if (client === undefined) {
        status = "down";
        throw new AdapterError(
          "fatal_protocol",
          CHANNEL,
          "kmsg client not wired — KakaoTalk capture runs on the GUI host (C-D3)",
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
      stopWatch?.();
      stopWatch = undefined;
      status = "down";
    },

    async *backfill(): AsyncIterable<NormalizedItem> {
      if (client === undefined)
        throw new AdapterError("fatal_protocol", CHANNEL, "backfill() called before connect()");
      let chatsRaw: unknown;
      try {
        chatsRaw = await client.chats();
      } catch (cause) {
        throw recordError(cause);
      }
      let done = 0;
      for (const entry of lines(chatsRaw)) {
        const chatId = chatIdOf(entry);
        if (chatId === null) continue;
        let readRaw: unknown;
        try {
          readRaw = await client.read(chatId);
        } catch (cause) {
          throw recordError(cause);
        }
        for (const item of lines(readRaw).flatMap((raw) => normalize(raw))) {
          yield item;
          done += 1;
        }
      }
      // kmsg reports no total — history is whatever the open conversation window holds.
      queue.push({ kind: "backfill_progress", done, total: null, at: now().toISOString() });
    },

    subscribe(): AsyncIterable<NormalizedItem | AdapterEvent> {
      if (client === undefined)
        throw new AdapterError("fatal_protocol", CHANNEL, "subscribe() called before connect()");
      stopped = false;
      stopWatch = client.watch((raw) => {
        emit(lines(raw));
      });
      schedulePoll();
      return queue;
    },

    async send(thread: ThreadRef, draft: Outbound): Promise<SendResult> {
      if (client === undefined)
        throw new AdapterError(
          "fatal_unsupported",
          CHANNEL,
          "kmsg is not wired — sending needs the capture host (US-C13)",
        );
      let result: { preview: string; sent: boolean };
      try {
        result = await client.send(thread.externalId, draft.text, {
          dryRun: deps.sendEnabled?.() !== true,
        });
      } catch (cause) {
        throw mapError(cause);
      }
      const sentAt = now().toISOString();
      const id = sourceHash(thread.externalId, sentAt, "me", draft.text);
      // kmsg's dry run answers with a preview and sent:false — nothing left the machine, so the id says
      // so instead of pretending a message exists (US-C13 reads the preview into the approval card).
      return { externalId: result.sent ? `kmsg:${id}` : `dry-run:${id}`, sentAt };
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
