import { z } from "zod";

/** Delta §2.3 (A4 §3.6). The three notification tiers. */
export const NotifyTier = z.enum(["immediate", "batched", "silent"]);
export type NotifyTier = z.infer<typeof NotifyTier>;

/** Delta §2.3. Push payload — the body carries only the first 80 characters
 *  (A4 §3.6 privacy principle). */
export const PushPayload = z.object({
  kind: z.enum(["draft", "approval", "vip", "briefing", "digest", "followup", "adapter_down"]),
  title: z.string().max(80),
  body: z.string().max(80),
  deep_link: z.string(),
  approval_id: z.string().uuid().optional(),
});
export type PushPayload = z.infer<typeof PushPayload>;
