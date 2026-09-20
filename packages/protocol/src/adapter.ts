import { z } from "zod";

export const Channel = z.enum([
  "slack",
  "gmail",
  "gcal",
  "outlook",
  "telegram",
  "whatsapp",
  "kakaotalk",
  "linkedin",
  "agent",
  "system",
]);
export const ThreadKind = z.enum(["dm", "group", "email", "agent_session", "calendar", "system"]);
export const ItemKind = z.enum(["message", "email", "event", "agent_turn", "tool_call", "system"]);
export const ItemStatus = z.enum([
  "received",
  "read",
  "draft",
  "approved",
  "sent",
  "failed",
  "archived",
]);
export const Scope = z.enum(["work", "personal", "unknown"]);
export const Sensitivity = z.enum(["normal", "personal", "finance", "legal", "health"]);
export const HostId = z.enum(["mini", "macbook"]);
export const RuntimeKind = z.enum(["claude_code", "codex", "claude_ds", "hermes", "omnis"]);

export type Channel = z.infer<typeof Channel>;
export type ThreadKind = z.infer<typeof ThreadKind>;
export type ItemKind = z.infer<typeof ItemKind>;
export type ItemStatus = z.infer<typeof ItemStatus>;
export type Scope = z.infer<typeof Scope>;
export type Sensitivity = z.infer<typeof Sensitivity>;
export type HostId = z.infer<typeof HostId>;
export type RuntimeKind = z.infer<typeof RuntimeKind>;

// 브랜드 키는 `unique symbol`이 아니라 문자열 프로퍼티다: 심볼이면 bridge.ts처럼 다른 파일이
// SessionKey를 쓰는 스키마를 export할 때 선언 emit이 TS4023으로 깨진다. 명목 타입 효과는 같다.
export type SessionKey = string & { readonly __brand: "SessionKey" };
export type SessionId = string & { readonly __brand: "SessionId" };

export const SessionKey = z
  .string()
  .min(1)
  .max(256)
  .regex(/^agent:[a-z_]+:(mini|macbook):[A-Za-z0-9_-]+$/)
  .transform((s) => s as SessionKey);
export const SessionId = z
  .string()
  .min(1)
  .transform((s) => s as SessionId);

export const Capabilities = z.object({
  read: z.boolean(),
  write: z.boolean(),
  realtime: z.boolean(),
  history: z.boolean(),
  media: z.boolean(),
  markRead: z.boolean(),
  typing: z.boolean(),
  archive: z.boolean(),
  delete: z.boolean(),
});
export type Capabilities = z.infer<typeof Capabilities>;

export const ParticipantRef = z.object({
  externalId: z.string(),
  displayName: z.string(),
  personId: z.string().uuid().optional(),
});
export type ParticipantRef = z.infer<typeof ParticipantRef>;

export const NormalizedThread = z.object({
  externalId: z.string(),
  kind: ThreadKind,
  title: z.string().nullable(),
  participants: z.array(ParticipantRef),
  lastItemAt: z.string().datetime(),
  archivedAt: z.string().datetime().nullable(),
});
export type NormalizedThread = z.infer<typeof NormalizedThread>;

export const Attachment = z.object({
  kind: z.enum(["image", "file", "audio", "video", "link"]),
  url: z.string().optional(),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().optional(),
  caption: z.string().optional(),
});
export type Attachment = z.infer<typeof Attachment>;

export const NormalizedItem = z.object({
  threadExternalId: z.string(),
  externalId: z.string(),
  kind: ItemKind,
  author: z.object({ kind: z.enum(["person", "agent", "system"]), id: z.string() }),
  body: z.string(),
  bodyHtml: z.string().optional(),
  attachments: z.array(Attachment),
  sentAt: z.string().datetime(),
  status: z.literal("received"),
  sourceHash: z.string(),
  threadMeta: NormalizedThread.optional(),
});
export type NormalizedItem = z.infer<typeof NormalizedItem>;

export const AdapterEvent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("connected"), at: z.string().datetime() }),
  z.object({ kind: z.literal("disconnected"), reason: z.string(), at: z.string().datetime() }),
  z.object({
    kind: z.literal("auth_required"),
    reason: z.string(),
    authUrl: z.string().optional(),
    at: z.string().datetime(),
  }),
  z.object({
    kind: z.literal("rate_limited"),
    retryAfterMs: z.number().int(),
    endpoint: z.string(),
    at: z.string().datetime(),
  }),
  z.object({
    kind: z.literal("backfill_progress"),
    done: z.number().int(),
    total: z.number().int().nullable(),
    at: z.string().datetime(),
  }),
]);
export type AdapterEvent = z.infer<typeof AdapterEvent>;

export const AuthRef = z.object({
  channel: Channel,
  accountExternalId: z.string(),
  keychainService: z.string(),
  keychainAccount: z.string(),
});
export type AuthRef = z.infer<typeof AuthRef>;

export type AdapterErrorKind =
  | "retryable_network"
  | "retryable_rate_limit"
  | "auth_expired"
  | "auth_revoked"
  | "fatal_protocol"
  | "fatal_unsupported";

export class AdapterError extends Error {
  constructor(
    readonly kind: AdapterErrorKind,
    readonly channel: Channel,
    message: string,
    readonly retryAfterMs?: number,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AdapterError";
  }
}

export interface Health {
  channel: Channel;
  accountExternalId: string;
  status: "healthy" | "degraded" | "down";
  lastEventAt: string | null;
  lastError?: { kind: AdapterErrorKind; message: string; at: string };
  latencyMsP50?: number;
}

export interface ThreadRef {
  accountId: string;
  externalId: string;
}
export interface OutboundAttachment {
  kind: "image" | "file";
  localPath: string;
  mimeType: string;
  caption?: string;
}
export interface Outbound {
  text: string;
  bodyHtml?: string;
  attachments?: OutboundAttachment[];
  replyToExternalId?: string;
}
export interface SendResult {
  externalId: string;
  sentAt: string;
}

export interface Adapter {
  id: string;
  channel: Channel;
  capabilities(): Capabilities;
  connect(auth: AuthRef): Promise<void>;
  disconnect?(): Promise<void>;
  backfill(since?: Date): AsyncIterable<NormalizedItem>;
  subscribe(): AsyncIterable<NormalizedItem | AdapterEvent>;
  send(thread: ThreadRef, draft: Outbound): Promise<SendResult>;
  markRead?(thread: ThreadRef): Promise<void>;
  archive?(thread: ThreadRef): Promise<void>;
  health(): Promise<Health>;
}

export type Normalize = (raw: unknown) => NormalizedItem[];
export type IngestSink = (accountId: string, e: NormalizedItem | AdapterEvent) => Promise<void>;
