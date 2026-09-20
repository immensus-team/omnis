import { z } from "zod";

/** 델타 §2.3 (A4 §3.6). 알림 3등급. */
export const NotifyTier = z.enum(["immediate", "batched", "silent"]);
export type NotifyTier = z.infer<typeof NotifyTier>;
