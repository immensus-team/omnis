// A4 §3.6. Applies to Mac and phone alike — there are no phone-only rules.
import type { NotifyTier } from "@omnis/protocol";

export const QUIET_START_HOUR_KST = 23;
export const QUIET_END_HOUR_KST = 7;
export const PUSH_BATCH_HOURS_KST: readonly number[] = [9, 12, 15, 18];

const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;

function seoulHour(at: Date): number {
  return new Date(at.getTime() + SEOUL_OFFSET_MS).getUTCHours();
}

export function inQuietHours(at: Date): boolean {
  const h = seoulHour(at);
  return h >= QUIET_START_HOUR_KST || h < QUIET_END_HOUR_KST;
}

export function notifyTierFor(i: {
  priority: "now" | "today" | "week" | "fyi";
  vip: boolean;
  mentionsMe: boolean;
  meetingWithin2h: boolean;
  now: Date;
  /** Settings `notify.vip_override`. Defaults to true — turning it off removes the quiet-hours
   *  exception. */
  vipOverride?: boolean;
}): NotifyTier {
  const immediate = i.priority === "now" && (i.vip || i.mentionsMe || i.meetingWithin2h);
  if (immediate) {
    if (!inQuietHours(i.now)) return "immediate";
    // Quiet hours have exactly one exception: vip AND priority='now', and Settings can disable it.
    return i.vip && (i.vipOverride ?? true) ? "immediate" : "batched";
  }
  if (i.priority === "today") return "batched";
  return "silent";
}
