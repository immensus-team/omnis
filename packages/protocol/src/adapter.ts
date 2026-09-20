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

declare const brand: unique symbol;
export type SessionKey = string & { readonly [brand]: "SessionKey" };
export type SessionId = string & { readonly [brand]: "SessionId" };

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
