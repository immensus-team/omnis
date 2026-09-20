// A4 §3.6. 맥과 폰에 똑같이 적용된다 — 폰 전용 규칙은 없다.
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
  /** Settings `notify.vip_override`. 기본 true — 끄면 조용시간 예외가 사라진다. */
  vipOverride?: boolean;
}): NotifyTier {
  const immediate = i.priority === "now" && (i.vip || i.mentionsMe || i.meetingWithin2h);
  if (immediate) {
    if (!inQuietHours(i.now)) return "immediate";
    // 조용시간 예외는 vip AND priority='now' 하나뿐이고, 그것조차 Settings에서 끌 수 있다.
    return i.vip && (i.vipOverride ?? true) ? "immediate" : "batched";
  }
  if (i.priority === "today") return "batched";
  return "silent";
}
