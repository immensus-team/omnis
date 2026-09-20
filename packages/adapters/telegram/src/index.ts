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

// A1 §2.5 + 백로그 US-B40 "backfill 상한(채널별 30일·500건)" — 이 어댑터가 직접 강제한다.
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

    // 승인 게이트(US-A07) 전까지 실제 client.sendText는 deps.sink가 없을 때만 호출한다(테스트 기본값은
    // mock sink). client가 주입돼 있고 deps.sink가 없으면 실제 전송처럼 보이는 경로를 열게 되므로,
    // 기본값은 항상 mock — 실제 전송이 필요해지면 승인 실행 경로(runEgress)가 deps.sink로 client.sendText를
    // 명시적으로 주입한다.
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
  // raw에서는 Date가 아니라 정수/문자열로 온다(아래 parseSentAt 참고).
  date?: number | string;
  editDate?: number | string;
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

/** Telegram의 date는 초 단위 unix 정수지만, raw로 오는 건 항상 그렇진 않다 — JSON을 한 번 왕복한
 *  mtcute 메시지는 Date가 ISO 문자열로 직렬화되고, 게이트웨이를 거친 raw는 숫자 문자열로 온다.
 *  그대로 곱하면 NaN이 되고 toISOString()이 RangeError를 던진다 — normalize()는 backfill()/subscribe()
 *  루프 안에서 메시지마다 불리므로 그 메시지 하나가 스트림 전체를 죽인다. 그래서 후보(date → editDate)
 *  마다 타입을 보고 읽는다: 숫자는 초 단위(unix)로, 문자열은 먼저 ISO-8601로 파싱한다(이 결과는 이미
 *  ms라 1000을 곱하지 않는다). ISO로 안 읽히는 문자열만 초 단위 숫자 문자열로 본다 — 순서를 뒤집으면
 *  ISO 문자열("2023-11-14T22:13:20.000Z")이 실패해 editDate(수정 시각)로 미끄러지므로, 보낸 시각을
 *  복구하려면 ISO를 먼저 시도해야 한다. 그렇게도 유한한 값이 안 나오면 다음 후보로 넘어가고, 전부
 *  실패하면 원래 기본값 0으로 물러난다(Gmail internalDate / Outlook sentDateTime 폴백과 같은 원칙).
 *  now()가 아니라 0인 건 기존 기본값을 보존하고 픽스처를 결정적으로 만들기 위해서다. 빈/공백 문자열은
 *  숫자로도 읽히지 않게 건너뛴다 — Number("")는 0이라 그냥 두면 epoch으로 확정돼 버린다. */
function parseSentAt(date?: number | string, editDate?: number | string): string {
  const ms = [date, editDate]
    .map((v) => {
      if (typeof v === "number") return v * 1000; // raw 숫자는 초 단위 unix
      if (typeof v !== "string" || v.trim() === "") return Number.NaN;
      const iso = new Date(v).getTime(); // ISO-8601은 ms 그대로 파싱된다
      return Number.isFinite(iso) ? iso : Number(v) * 1000; // 아니면 초 단위 숫자 문자열
    })
    .find((n) => Number.isFinite(n));
  return new Date(ms ?? 0).toISOString();
}

export function normalize(raw: unknown): NormalizedItem[] {
  const m = raw as TgMessage;
  if (m.deletedMessageIds !== undefined) return []; // 삭제 업데이트는 콘텐츠가 없다 — 아이템을 만들지 않는다
  if (m.id === undefined || m.chat?.id === undefined || m.sender?.id === undefined) return [];
  // text도 media도 없으면 이 어댑터가 표현할 수 있는 내용이 없다: new_chat_members 같은 서비스
  // 메시지가 액션만 싣고 오는 경우다(액션은 매핑하지 않는다). 빈 body/attachments 아이템을 내보내는
  // 대신 삭제 업데이트와 같은 방식으로 버린다 — Slack 어댑터도 같은 이유로 같은 가드를 둔다.
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
