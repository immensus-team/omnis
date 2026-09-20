import { z } from "zod";

/** 델타 §2.3 (A4 §3.6). 알림 3등급. */
export const NotifyTier = z.enum(["immediate", "batched", "silent"]);
export type NotifyTier = z.infer<typeof NotifyTier>;

/** 델타 §2.3. 푸시 payload — 본문은 첫 80자만(A4 §3.6 프라이버시 원칙). */
export const PushPayload = z.object({
  kind: z.enum(["draft", "approval", "vip", "briefing", "digest", "followup", "adapter_down"]),
  title: z.string().max(80),
  body: z.string().max(80),
  deep_link: z.string(),
  approval_id: z.string().uuid().optional(),
});
export type PushPayload = z.infer<typeof PushPayload>;
