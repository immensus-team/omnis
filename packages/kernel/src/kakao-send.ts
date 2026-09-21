// US-C13 (master §19 Q3; A1 §2.8 write-back, A5 §3.9). KakaoTalk is the one channel where a mistake
// the writer makes can cost the whole account, so send is closed until the *read* connection has
// been stable for KAKAO_STABLE_DAYS: that reading is what proves kmsg has not been flagged. Two keys
// open it — `kakao.read_stable_since` (the first stable day) and `kakao.send_enabled_at` (Logan's
// own opt-in) — and neither alone is enough. Even open, the first execution only previews; see
// `kakaoSendStep`.
import type { Pool } from "pg";
import { getSetting } from "./settings.js";

/** A5 §3.9's countdown: "read stable {14-N}/14 days · activates in {N} days". */
export const KAKAO_STABLE_DAYS = 14;

const DAY_MS = 86_400_000;

export type KakaoSendReason = "no_stable_read" | "counting" | "awaiting_opt_in" | "open";

export interface KakaoSendState {
  /** True only when both keys lined up: KAKAO_STABLE_DAYS of stable read **and** the opt-in. */
  enabled: boolean;
  /** Whole days left in the countdown. `null` while no stable read has been observed — there is
   *  nothing to count down from — and 0 once the count is done, opt-in or not. */
  daysRemaining: number | null;
  reason: KakaoSendReason;
}

/** Both stamps live in the settings kv as ISO strings (`setSetting(pool, key, at.toISOString())`).
 *  Anything else — null, a number, a date someone typed into psql — reads as "no stamp", which is
 *  the closed direction. */
function stamp(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** The gate's whole state, from the two settings keys. `now` is a parameter so the 14-day boundary
 *  is testable without waiting two weeks. */
export async function kakaoSendState(pool: Pool, now: Date = new Date()): Promise<KakaoSendState> {
  const [stableRaw, optInRaw] = await Promise.all([
    getSetting<unknown>(pool, "kakao.read_stable_since", null),
    getSetting<unknown>(pool, "kakao.send_enabled_at", null),
  ]);
  const stableSince = stamp(stableRaw);
  if (stableSince === null) {
    return { enabled: false, daysRemaining: null, reason: "no_stable_read" };
  }
  const leftMs = stableSince.getTime() + KAKAO_STABLE_DAYS * DAY_MS - now.getTime();
  if (leftMs > 0) {
    // An early opt-in does not shorten the count: A5 §3.9's button stays disabled for 14 full days.
    return { enabled: false, daysRemaining: Math.ceil(leftMs / DAY_MS), reason: "counting" };
  }
  if (stamp(optInRaw) === null) {
    return { enabled: false, daysRemaining: 0, reason: "awaiting_opt_in" };
  }
  return { enabled: true, daysRemaining: 0, reason: "open" };
}

/** The approval's half of the flow. A `send` approval with no `confirm_of` is the first half — the
 *  dry run — and the executor stamps `confirm_of` on the approval it proposes next, so only a
 *  second, explicit accept reaches the window with `dry_run: false`. */
export type KakaoSendStep =
  | { kind: "closed"; reason: KakaoSendReason }
  | { kind: "dry_run" }
  | { kind: "confirm"; confirmOf: string };

export function kakaoSendStep(state: KakaoSendState, args: Record<string, unknown>): KakaoSendStep {
  if (!state.enabled) return { kind: "closed", reason: state.reason };
  return typeof args.confirm_of === "string" && args.confirm_of !== ""
    ? { kind: "confirm", confirmOf: args.confirm_of }
    : { kind: "dry_run" };
}
