import { AdapterError, type Attachment, type NormalizedItem } from "@omnis/protocol";

export const CHANNEL = "telegram" as const;

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
