import {
  type Adapter,
  AdapterError,
  type AdapterEvent,
  type Attachment,
  type AuthRef,
  type Capabilities,
  type Health,
  type NormalizedItem,
  type Outbound,
  type SendResult,
  type ThreadRef,
} from "@omnis/protocol";
import { readKeychainSecret } from "./keychain.js";

export const CHANNEL = "telegram" as const;

// A1 §2.5 + backlog US-B40 "backfill cap (30 days / 500 messages per channel)" — this adapter enforces it directly.
export const BACKFILL_MAX_DAYS = 30;
export const BACKFILL_MAX_ITEMS = 500;

const CAPABILITIES: Capabilities = {
  read: true,
  write: true,
  realtime: true,
  history: true,
  media: true,
  markRead: true,
  typing: false,
  archive: false, // v1 keeps kernel-internal labels only (A1 §2.5)
  delete: false,
};

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

/** Whether mtcute's `TelegramClient` actually satisfies this subset is UNVERIFIED — the A1-⑦ spike checks it
 *  when connecting to a real account (B-D5). This interface narrowly defines only the methods the adapter actually calls, so
 *  the fixture/mock tests all run without mtcute. */
export interface TelegramClientLike {
  start(): Promise<void>;
  getHistory(chatId: string, opts: { limit: number; offsetUnixSec?: number }): Promise<unknown[]>;
  onUpdate(cb: (raw: unknown) => void): () => void; // the return value unsubscribes
  sendText(chatId: string, text: string): Promise<{ id: number; date: number }>;
  readHistory(chatId: string): Promise<void>;
}

export interface TelegramAdapterDeps {
  client?: TelegramClientLike;
  sink?: (thread: ThreadRef, draft: Outbound) => Promise<SendResult>;
  now?: () => Date;
}

export function createTelegramAdapter(deps: TelegramAdapterDeps = {}): Adapter {
  const now = deps.now ?? ((): Date => new Date());
  const client: TelegramClientLike | undefined = deps.client;
  const queue = new AsyncQueue<NormalizedItem | AdapterEvent>();
  let status: Health["status"] = "down";
  let lastEventAt: string | null = null;
  let lastError: Health["lastError"];
  let unsubscribe: (() => void) | undefined;

  return {
    id: "telegram",
    channel: CHANNEL,
    capabilities: () => CAPABILITIES,

    async connect(auth: AuthRef): Promise<void> {
      // The Keychain holds only the encryption key wrapping the session file, not the file itself (A1 §2.5) — it is never logged.
      await readKeychainSecret(auth.keychainService, auth.keychainAccount, CHANNEL);
      if (client === undefined) {
        status = "down";
        throw new AdapterError(
          "fatal_protocol",
          CHANNEL,
          "mtcute client not wired — real Telegram connect deferred to A1-⑦ (B-D5)",
        );
      }
      try {
        await client.start();
      } catch (cause) {
        status = "down";
        throw mapApiError(cause);
      }
      status = "healthy";
      lastEventAt = now().toISOString();
      queue.push({ kind: "connected", at: lastEventAt });
    },

    async disconnect(): Promise<void> {
      unsubscribe?.();
      status = "down";
    },

    async *backfill(since?: Date): AsyncIterable<NormalizedItem> {
      if (client === undefined)
        throw new AdapterError("fatal_protocol", CHANNEL, "backfill() called before connect()");
      const cutoff = since ?? new Date(now().getTime() - BACKFILL_MAX_DAYS * 86_400_000);
      let raws: unknown[];
      try {
        raws = await client.getHistory("me", {
          limit: BACKFILL_MAX_ITEMS,
          offsetUnixSec: Math.floor(cutoff.getTime() / 1000),
        });
      } catch (cause) {
        throw mapApiError(cause);
      }
      let done = 0;
      for (const raw of raws) {
        if (done >= BACKFILL_MAX_ITEMS) break;
        for (const item of normalize(raw)) {
          yield item;
          done += 1;
        }
      }
      queue.push({ kind: "backfill_progress", done, total: raws.length, at: now().toISOString() });
    },

    subscribe(): AsyncIterable<NormalizedItem | AdapterEvent> {
      if (client === undefined)
        throw new AdapterError("fatal_protocol", CHANNEL, "subscribe() called before connect()");
      unsubscribe = client.onUpdate((raw) => {
        for (const item of normalize(raw)) queue.push(item);
      });
      return queue;
    },

    // Until the approval gate (US-A07) exists, the real client.sendText is called only when deps.sink is absent (the test default is
    // the mock sink). With a client injected and no deps.sink this would open a path that looks like a real send, so
    // the default is always mock — when a real send is needed, the approval execution path (runEgress) passes client.sendText
    // explicitly as deps.sink.
    async send(thread: ThreadRef, draft: Outbound): Promise<SendResult> {
      const sink =
        deps.sink ??
        (async (): Promise<SendResult> => ({
          externalId: `mock-${now().getTime()}`,
          sentAt: now().toISOString(),
        }));
      return sink(thread, draft);
    },

    async markRead(thread: ThreadRef): Promise<void> {
      if (client === undefined)
        throw new AdapterError("fatal_protocol", CHANNEL, "markRead() called before connect()");
      try {
        await client.readHistory(thread.externalId);
      } catch (cause) {
        throw mapApiError(cause);
      }
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

interface TgSender {
  id?: number;
  username?: string;
  firstName?: string;
  lastName?: string;
}
interface TgMedia {
  type?: string;
  mimeType?: string;
  fileSize?: number;
  fileName?: string;
}
interface TgMessage {
  id?: number;
  chat?: { id?: number | string; type?: string; title?: string };
  sender?: TgSender;
  text?: string;
  // In raw form these arrive as integers/strings rather than Date (see parseSentAt below).
  date?: number | string;
  editDate?: number | string;
  media?: TgMedia;
  // A delete update is not a message but a separate shape (the mtcute DeleteMessageUpdate family), so it is identified by this key.
  deletedMessageIds?: number[];
}

function tgAttachmentKind(type: string | undefined): Attachment["kind"] {
  if (type === "photo") return "image";
  if (type === "video") return "video";
  if (type === "voice" || type === "audio") return "audio";
  return "file";
}

/** Telegram's date is a unix integer in seconds, but what arrives as raw is not always that — a mtcute
 *  message that went through one JSON round-trip has its Date serialized as an ISO string, and raw that
 *  passed through the gateway arrives as a numeric string. Multiplying blindly gives NaN and
 *  toISOString() throws a RangeError — normalize() is called per message inside the
 *  backfill()/subscribe() loops, so one such message kills the entire stream. So each candidate
 *  (date → editDate) is read by type: numbers as seconds (unix), strings parsed as ISO-8601 first
 *  (that result is already in ms, so it is not multiplied by 1000). Only strings that do not read as
 *  ISO are treated as second-unit numeric strings — reversing that order makes the ISO string
 *  ("2023-11-14T22:13:20.000Z") fail and slide through to editDate (the edit time), so ISO has to be
 *  tried first to recover the sent time. If that still yields no finite value we move on to the next
 *  candidate, and if every one fails we fall back to the original default of 0 (the same principle as
 *  the Gmail internalDate / Outlook sentDateTime fallbacks). It is 0 rather than now() to preserve
 *  that existing default and keep fixtures deterministic. Empty/whitespace-only strings are skipped so
 *  they do not read as numbers either — Number("") is 0, and leaving it alone would settle the
 *  timestamp on the epoch. */
function parseSentAt(date?: number | string, editDate?: number | string): string {
  const ms = [date, editDate]
    .map((v) => {
      if (typeof v === "number") return v * 1000; // raw numbers are unix seconds
      if (typeof v !== "string" || v.trim() === "") return Number.NaN;
      const iso = new Date(v).getTime(); // ISO-8601 parses straight to ms
      return Number.isFinite(iso) ? iso : Number(v) * 1000; // otherwise a second-unit numeric string
    })
    .find((n) => Number.isFinite(n));
  return new Date(ms ?? 0).toISOString();
}

export function normalize(raw: unknown): NormalizedItem[] {
  const m = raw as TgMessage;
  if (m.deletedMessageIds !== undefined) return []; // a delete update has no content — no item is produced
  if (m.id === undefined || m.chat?.id === undefined || m.sender?.id === undefined) return [];
  // With neither text nor media there is nothing this adapter can represent: that is the case where a
  // service message like new_chat_members arrives carrying only an action (actions are not mapped).
  // Rather than emit an item with an empty body/attachments, drop it the same way as a delete update —
  // the Slack adapter keeps the same guard for the same reason.
  if (!m.text && !m.media) return [];

  const chatId = String(m.chat.id);
  const senderId = String(m.sender.id);
  const displayName =
    [m.sender.firstName, m.sender.lastName].filter(Boolean).join(" ") ||
    m.sender.username ||
    senderId;
  const sentAt = parseSentAt(m.date, m.editDate);
  const attachments: Attachment[] = m.media
    ? [
        {
          kind: tgAttachmentKind(m.media.type),
          ...(m.media.mimeType !== undefined ? { mimeType: m.media.mimeType } : {}),
          ...(m.media.fileSize !== undefined ? { sizeBytes: m.media.fileSize } : {}),
          ...(m.media.fileName !== undefined ? { caption: m.media.fileName } : {}),
        },
      ]
    : [];

  return [
    {
      threadExternalId: chatId,
      externalId: String(m.id),
      kind: "message",
      author: { kind: "person", id: senderId },
      body: m.text ?? "",
      attachments,
      sentAt,
      status: "received",
      sourceHash: `${chatId}:${m.id}`, // A1 §2.5: sourceHash = (chatId, messageId)
      threadMeta: {
        externalId: chatId,
        kind: m.chat.type === "private" ? "dm" : "group",
        title: m.chat.type === "private" ? null : (m.chat.title ?? null),
        participants: [{ externalId: senderId, displayName }],
        lastItemAt: sentAt,
        archivedAt: null,
      },
    },
  ];
}

export function mapApiError(cause: unknown): AdapterError {
  const err = cause as { code?: number; message?: string };
  const floodMatch = /FLOOD_WAIT_(\d+)/.exec(err.message ?? "");
  if (err.code === 420 || floodMatch !== null) {
    const secs = Number(floodMatch?.[1] ?? "60");
    return new AdapterError(
      "retryable_rate_limit",
      CHANNEL,
      `Telegram flood-wait: ${err.message ?? "FLOOD_WAIT"}`,
      secs * 1000,
      cause,
    );
  }
  if (err.code === 401 || err.message === "AUTH_KEY_UNREGISTERED") {
    return new AdapterError(
      "auth_revoked",
      CHANNEL,
      "Telegram session invalidated",
      undefined,
      cause,
    );
  }
  return new AdapterError(
    "retryable_network",
    CHANNEL,
    "Telegram MTProto call failed",
    undefined,
    cause,
  );
}
