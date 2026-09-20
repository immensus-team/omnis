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
