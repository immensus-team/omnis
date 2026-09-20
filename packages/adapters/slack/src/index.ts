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
import { SocketModeClient } from "@slack/socket-mode";
import { WebClient } from "@slack/web-api";
import { readKeychainSecret } from "./keychain.js";

export const CHANNEL = "slack" as const;

const CAPABILITIES: Capabilities = {
  read: true,
  write: true,
  realtime: true,
  history: true,
  media: true,
  markRead: true,
  typing: false,
  archive: false,
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

export interface SlackAdapterDeps {
  socketClient?: SocketModeClient;
  webClient?: WebClient;
  now?: () => Date;
  sink?: (thread: ThreadRef, draft: Outbound) => Promise<SendResult>;
}

export function createSlackAdapter(deps: SlackAdapterDeps = {}): Adapter {
  const now = deps.now ?? (() => new Date());
  let socket: SocketModeClient | undefined;
  let web: WebClient | undefined = deps.webClient;
  const queue = new AsyncQueue<NormalizedItem | AdapterEvent>();
  let lastEventAt: string | null = null;
  let status: Health["status"] = "down";
  let lastError: Health["lastError"];

  return {
    id: "slack",
    channel: CHANNEL,
    capabilities: () => CAPABILITIES,

    async connect(auth: AuthRef): Promise<void> {
      const xoxbToken = await readKeychainSecret(
        auth.keychainService,
        auth.keychainAccount,
        CHANNEL,
      );
      web = deps.webClient ?? new WebClient(xoxbToken);
      const appToken = await readKeychainSecret(
        `${auth.keychainService}.app`,
        auth.keychainAccount,
        CHANNEL,
      );
      socket = deps.socketClient ?? new SocketModeClient({ appToken });

      socket.on("disconnect", () => {
        status = "degraded";
        queue.push({
          kind: "disconnected",
          reason: "socket_mode_disconnect",
          at: now().toISOString(),
        });
      });

      try {
        await socket.start();
      } catch (cause) {
        status = "down";
        lastError = {
          kind: "retryable_network",
          message: "socket mode start failed",
          at: now().toISOString(),
        };
        throw new AdapterError(
          "retryable_network",
          CHANNEL,
          "socket mode start failed",
          undefined,
          cause,
        );
      }
      status = "healthy";
      lastEventAt = now().toISOString();
      queue.push({ kind: "connected", at: lastEventAt });
    },

    async disconnect(): Promise<void> {
      await socket?.disconnect();
      status = "down";
    },

    async *backfill(since?: Date): AsyncIterable<NormalizedItem> {
      if (!web)
        throw new AdapterError("fatal_protocol", CHANNEL, "backfill() called before connect()");
      const oldest = since ? String(Math.floor(since.getTime() / 1000)) : undefined;
      let cursor: string | undefined;
      let done = 0;
      do {
        let page: {
          ok: boolean;
          has_more?: boolean;
          response_metadata?: { next_cursor?: string };
          messages?: unknown[];
        };
        try {
          page = await web.conversations.history({
            channel: "",
            cursor,
            oldest,
            limit: 200,
          } as never);
        } catch (cause) {
          const err = cause as { data?: { error?: string; retry_after?: number } };
          if (err.data?.error === "ratelimited") {
            throw new AdapterError(
              "retryable_rate_limit",
              CHANNEL,
              "Slack conversations.history rate limited",
              (err.data.retry_after ?? 60) * 1000,
              cause,
            );
          }
          throw new AdapterError(
            "retryable_network",
            CHANNEL,
            "conversations.history failed",
            undefined,
            cause,
          );
        }
        for (const raw of page.messages ?? []) {
          for (const item of normalize(raw)) yield item;
          done += 1;
        }
        cursor = page.response_metadata?.next_cursor || undefined;
        queue.push({ kind: "backfill_progress", done, total: null, at: now().toISOString() });
      } while (cursor);
    },

    subscribe(): AsyncIterable<NormalizedItem | AdapterEvent> {
      return queue;
    },

    // 승인 게이트(US-A07)가 아직 없다 — 실제 chat.postMessage는 절대 호출하지 않는다.
    // deps.sink가 없으면 SendResult를 합성만 하는 기본 mock sink를 쓴다.
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
      if (!web)
        throw new AdapterError("fatal_protocol", CHANNEL, "markRead() called before connect()");
      await web.conversations.mark({
        channel: thread.externalId,
        ts: String(now().getTime() / 1000),
      } as never);
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

interface SlackFile {
  mimetype?: string;
  size?: number;
  url_private?: string;
  name?: string;
}
interface SlackMessageEvent {
  type?: string;
  subtype?: string;
  channel?: string;
  user?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  files?: SlackFile[];
}

function mimeToAttachmentKind(mimetype: string | undefined): Attachment["kind"] {
  if (!mimetype) return "file";
  if (mimetype.startsWith("image/")) return "image";
  if (mimetype.startsWith("audio/")) return "audio";
  if (mimetype.startsWith("video/")) return "video";
  return "file";
}

export function normalize(raw: unknown): NormalizedItem[] {
  const m = raw as SlackMessageEvent;
  // channel is intentionally NOT required here (deviation from plan text): real
  // conversations.history page messages omit `channel` (it's implicit in the API
  // call), so requiring it would drop every item backfill.test.ts yields. Realtime
  // events (Events API / Socket Mode) do carry `channel`, which is used when present.
  if (m.type !== "message" || !m.ts) return [];
  if (m.subtype === "message_changed" || m.subtype === "message_deleted") return [];

  const attachments: Attachment[] = (m.files ?? []).map((f) => ({
    kind: mimeToAttachmentKind(f.mimetype),
    mimeType: f.mimetype,
    sizeBytes: f.size,
    caption: f.name,
  }));

  return [
    {
      threadExternalId: m.channel ?? "",
      externalId: m.ts,
      kind: "message",
      author: { kind: "person", id: m.user ?? "" },
      body: m.text ?? "",
      attachments,
      sentAt: new Date(Number(m.ts) * 1000).toISOString(),
      status: "received",
      sourceHash: m.ts,
    },
  ];
}

export function mapApiError(raw: unknown): AdapterError {
  const r = raw as {
    httpStatus?: number;
    headers?: Record<string, string>;
    body?: { error?: string };
  };
  if (r.httpStatus === 429) {
    const retryAfterSec = Number(r.headers?.["retry-after"] ?? "60");
    return new AdapterError(
      "retryable_rate_limit",
      CHANNEL,
      `Slack rate limited: ${r.body?.error ?? "ratelimited"}`,
      retryAfterSec * 1000,
    );
  }
  if (r.httpStatus === 401) {
    const kind = r.body?.error === "token_revoked" ? "auth_revoked" : "auth_expired";
    return new AdapterError(kind, CHANNEL, `Slack auth error: ${r.body?.error ?? "invalid_auth"}`);
  }
  return new AdapterError(
    "fatal_protocol",
    CHANNEL,
    `Unmapped Slack API error (status=${r.httpStatus})`,
  );
}
