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

const CAPABILITIES: Capabilities = {
  read: true,
  write: true,
  realtime: true,
  history: true,
  media: true,
  markRead: true,
  typing: false,
  archive: false, // v1은 커널 내부 라벨만(A1 §2.5)
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

/** mtcute `TelegramClient`가 실제로 이 부분집합을 만족하는지는 UNVERIFIED — A1-⑦ 스파이크가 실계정
 *  연결 시점에 확인한다(B-D5). 이 인터페이스는 어댑터가 실제로 부르는 메서드만 좁게 정의해
 *  fixture/mock 테스트가 mtcute 없이도 전부 돌게 한다. */
export interface TelegramClientLike {
  start(): Promise<void>;
  getHistory(chatId: string, opts: { limit: number; offsetUnixSec?: number }): Promise<unknown[]>;
  onUpdate(cb: (raw: unknown) => void): () => void; // 반환값은 unsubscribe
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
      // 세션 파일 자체가 아니라 그걸 감싸는 암호화 키만 Keychain에 있다(A1 §2.5) — 로그로 찍지 않는다.
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

    backfill(): AsyncIterable<NormalizedItem> {
      throw new AdapterError("fatal_unsupported", CHANNEL, "backfill not implemented until Task 9");
    },

    subscribe(): AsyncIterable<NormalizedItem | AdapterEvent> {
      throw new AdapterError(
        "fatal_unsupported",
        CHANNEL,
        "subscribe not implemented until Task 9",
      );
    },

    async send(): Promise<never> {
      throw new AdapterError("fatal_unsupported", CHANNEL, "send not implemented until Task 10");
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
  date?: number;
  editDate?: number;
  media?: TgMedia;
  // 삭제 업데이트는 메시지가 아니라 별개 shape(mtcute DeleteMessageUpdate 계열)라 이 키로 판별한다.
  deletedMessageIds?: number[];
}

function tgAttachmentKind(type: string | undefined): Attachment["kind"] {
  if (type === "photo") return "image";
  if (type === "video") return "video";
  if (type === "voice" || type === "audio") return "audio";
  return "file";
}

export function normalize(raw: unknown): NormalizedItem[] {
  const m = raw as TgMessage;
  if (m.deletedMessageIds !== undefined) return []; // 삭제 업데이트는 콘텐츠가 없다 — 아이템을 만들지 않는다
  if (m.id === undefined || m.chat?.id === undefined || m.sender?.id === undefined) return [];

  const chatId = String(m.chat.id);
  const senderId = String(m.sender.id);
  const displayName =
    [m.sender.firstName, m.sender.lastName].filter(Boolean).join(" ") ||
    m.sender.username ||
    senderId;
  const sentAt = new Date((m.date ?? 0) * 1000).toISOString();
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
