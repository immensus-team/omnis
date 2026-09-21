import { cn } from "../lib/cn.js";
import { StatusPill } from "./status-pill.js";

/**
 * US-C17 (master §2, §16 exit; backlog row C17). Three capture channels cannot send for reasons that
 * have nothing to do with the message you just typed — KakaoTalk waits out a 14-day stable-read
 * gate (US-C13), a LinkedIn thread that only ever arrived as a "new message arrived" preview needs
 * the capture host (US-C09), and WhatsApp is closed until its pilot check (US-C24). A composer that
 * draws itself anyway fails at the far end of an approval; this block is the honest alternative, and
 * it stands in the composer's slot — the pane draws it *instead of* one, and a non-null block is the
 * case where there is nothing to type into.
 *
 * The composer itself is US-C17's sibling story (loop-r2-03) and is not on this branch, so no
 * channel sends from the pane yet: this says "this channel cannot", never "the others can".
 *
 * `null` is the fourth state: this channel has nothing to announce, so the composer is the whole
 * story. Every screen that asks draws nothing extra on it.
 */
export type ComposerBlock =
  | { kind: "kakao_countdown"; days: number }
  | { kind: "linkedin_summary_only" }
  | { kind: "whatsapp_pilot" }
  | null;

/** The copy, verbatim from the plan's interface block. Exported so the dictionary (`i18n/en.ts`
 *  `thread.composerState`) and the tests hold the same strings rather than three transcriptions of
 *  them. `en` is the source locale; i18n/ko.ts carries the add-on. */
export const COMPOSER_STATE_COPY = {
  kakaoDays: (days: number) => `Sending opens in ${days} days`,
  kakaoToday: "Sending opens today once you turn it on in Settings",
  linkedinSummaryOnly: "Summary only — reply needs the capture host",
  whatsappPilot: "Sending is off until the pilot check",
} as const;

/** What the pane would draw, from what the screen knows about the channel and the thread. Pure, so
 *  every state has a test without a database or a capture host being involved.
 *
 *  `kakaoDaysRemaining` is the kernel gate's `daysRemaining` (kakao-send.ts). It is `null` while no
 *  stable read has been observed: there is no countdown to state yet, and the opt-in line is the one
 *  that names Settings — where the read connection itself is turned on — so `null` reads as day 0
 *  rather than as an invented number of days. (The 14-day gate then starts counting from the moment
 *  that connection comes up, so "opens today" is the plan's copy for a state that is really "not
 *  started"; the interface fixes four lines, and this is the one that names the missing step.) */
export function composerBlockFor(i: {
  channel: string;
  canWrite: boolean;
  partial: boolean;
  kakaoDaysRemaining: number | null;
}): ComposerBlock {
  if (i.channel === "kakaotalk" && !i.canWrite) {
    return { kind: "kakao_countdown", days: i.kakaoDaysRemaining ?? 0 };
  }
  // LinkedIn's line is about the *thread* being a preview, not about the account's write flag: the
  // adapter writes back under approval, so `canWrite` is true on a thread that can still reply.
  if (i.channel === "linkedin" && i.partial) return { kind: "linkedin_summary_only" };
  if (i.channel === "whatsapp" && !i.canWrite) return { kind: "whatsapp_pilot" };
  return null;
}

/** The block's one line. `days === 0` is the one state with two copies: a countdown that has run out
 *  is not "in 0 days", it is the opt-in that is left. */
function lineFor(block: Exclude<ComposerBlock, null>): string {
  switch (block.kind) {
    case "kakao_countdown":
      return block.days === 0
        ? COMPOSER_STATE_COPY.kakaoToday
        : COMPOSER_STATE_COPY.kakaoDays(block.days);
    case "linkedin_summary_only":
      return COMPOSER_STATE_COPY.linkedinSummaryOnly;
    case "whatsapp_pilot":
      return COMPOSER_STATE_COPY.whatsappPilot;
  }
}

/** The block, drawn as a pill: it stands in the composer's slot, so it reads as a state of that slot
 *  rather than as one more message in the conversation. All three states mean the same thing to the
 *  reader — this composer will not send — so they share one tone. */
export function ComposerState({
  block,
  className,
}: {
  block: Exclude<ComposerBlock, null>;
  className?: string;
}) {
  return (
    <p className={cn("composer-state", className)} data-kind={block.kind}>
      <StatusPill tone="warning" label={lineFor(block)} />
    </p>
  );
}
