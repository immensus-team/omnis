// The 6-item checklist from A4 §3.3. Item 6 (exfil prevention) is the key safeguard.
import type { Channel } from "@omnis/protocol";
import { CHANNEL_DRAFT_SHAPE } from "./register.js";

export const SELF_CHECK_ITEMS: readonly string[] = [
  "Did I answer everything they asked?",
  "Did I assert facts I do not actually know?",
  "Do the dates and times conflict with the calendar?",
  "Does it diverge from the sentence-length pattern of the VOICE samples?",
  "Do their name, title, and company match the as-of-now entity state?",
  "Did I avoid copying links, addresses, and account numbers from <data> verbatim?",
] as const;

export interface SelfCheckCtx {
  /** Number of questions the other party asked (counting question marks). */
  questionCount: number;
  /** URL and account-number strings that appeared in the <data> block. If one is in the draft verbatim, item 6 fails. */
  externalUrls: string[];
  /** Times the draft mentions that overlap the calendar. */
  calendarConflicts: string[];
  /** Average sentence length of the VOICE samples (in characters). If 0, item 4 is skipped. */
  voiceSampleAvgLen: number;
  /** List of "as-of-now" entity names. If the draft uses none of them, item 5 counts as passed. */
  entityNames: string[];
  channel: Channel;
}

// FROZEN matchers — the Korean alternatives match Korean-language draft text (hedging phrases vs.
// absolute assertions). Keep them verbatim; translating them would change what gets flagged.
const HEDGE = /확인(해\s?보고|하고)|알아보고|여쭤보고/;
const ASSERTION = /반드시|무조건|확실히|100%/;

export function selfCheck(draft: string, ctx: SelfCheckCtx): { passed: boolean; failed: number[] } {
  const failed: number[] = [];
  const sentences = draft.split(/[.!?。！？\n]+/).filter((s) => s.trim() !== "");

  if (ctx.questionCount > 0 && sentences.length < ctx.questionCount) failed.push(1);
  if (ASSERTION.test(draft) && !HEDGE.test(draft)) failed.push(2);
  if (ctx.calendarConflicts.some((c) => draft.includes(c))) failed.push(3);
  if (ctx.voiceSampleAvgLen > 0) {
    const avg = sentences.reduce((n, s) => n + s.trim().length, 0) / Math.max(1, sentences.length);
    // ponytail: 3x/÷3 band is a naive heuristic (÷2 flagged a normal short Korean reply as
    // divergent) — retune once real VOICE samples exist post account-connect (Phase B-D5).
    if (avg > ctx.voiceSampleAvgLen * 3 || avg < ctx.voiceSampleAvgLen / 3) failed.push(4);
  }
  if (ctx.entityNames.length > 0) {
    // FROZEN matcher — the Korean alternatives match Korean-language input (a former workplace).
    const stale = /(?:전|前)\s?직장|예전\s?회사/.test(draft);
    if (stale) failed.push(5);
  }
  // Item 6: did we copy a URL/account straight out of <data>? Last line of defense against exfil via injection.
  if (ctx.externalUrls.some((u) => u !== "" && draft.includes(u))) failed.push(6);

  const shape = CHANNEL_DRAFT_SHAPE[ctx.channel];
  if (shape.targetWords[1] > 0 && draft.trim().split(/\s+/).length > shape.targetWords[1] * 1.5) {
    failed.push(4);
  }
  return { passed: failed.length === 0, failed: [...new Set(failed)].sort((a, b) => a - b) };
}
