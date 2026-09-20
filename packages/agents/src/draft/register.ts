// A4 §3.1·§3.2·§3.4. All rules — there is no model call in here.
import type { Channel } from "@omnis/protocol";
import type { ItemRow } from "../types.js";

export type Register = "formal_ko" | "polite_ko" | "casual_ko" | "formal_en" | "casual_en";

const FORMAL_LABELS = ["client", "investor", "senior"] as const;

export function pickRegister(ctx: {
  language: "ko" | "en";
  labels: string[];
  sameOrg: boolean;
  greeting?: string;
}): Register {
  if (ctx.language === "en") {
    return /^(dear|to whom)/i.test(ctx.greeting ?? "") ? "formal_en" : "casual_en";
  }
  if (ctx.labels.some((l) => (FORMAL_LABELS as readonly string[]).includes(l))) return "formal_ko";
  if (ctx.labels.includes("close")) return "casual_ko";
  if (ctx.sameOrg) return "polite_ko";
  return "formal_ko";
}

/** A4 §3.1: below 0.5 we do not draft at all. */
export const NEEDS_REPLY_MIN = 0.5;

// FROZEN matcher — the Korean alternatives match Korean-language input (a Korean "unsubscribe"
// phrase, plus the English word). Keep the Korean alternatives verbatim.
const UNSUBSCRIBE = /구독.{0,4}해지|unsubscribe|수신거부/i;

export function needsReplyScore(
  item: ItemRow,
  ctx: { lastAuthorIsThem: boolean; myReplyRatio: number; inTo: boolean; bulkHeaders: boolean },
): number {
  let s = 0;
  if (item.body.includes("?") || item.body.includes("？")) s += 0.3;
  if (ctx.lastAuthorIsThem) s += 0.3;
  s += 0.2 * Math.min(1, Math.max(0, ctx.myReplyRatio));
  if (ctx.inTo) s += 0.2;
  if (ctx.bulkHeaders || UNSUBSCRIBE.test(item.body)) s -= 0.6;
  return Math.min(1, Math.max(0, s));
}

export interface DraftShape {
  targetWords: [number, number];
  notes: string;
}

/** Exactly the A4 §3.4 table. Covers all 10 Channel values (agent/system are not draft targets, so 0). */
export const CHANNEL_DRAFT_SHAPE: Record<Channel, DraftShape> = {
  gmail: { targetWords: [60, 180], notes: "Greeting + body + sign-off; 2-3 paragraphs, Re:." },
  outlook: { targetWords: [60, 180], notes: "Same as Gmail." },
  slack: { targetWords: [10, 60], notes: "No greeting, minimal markdown. No new @mentions." },
  telegram: { targetWords: [8, 45], notes: "1-3 sentences. Emoji 0-1, only if VOICE has one." },
  whatsapp: { targetWords: [6, 30], notes: "1-2 sentences; short sentences, no line breaks." },
  kakaotalk: { targetWords: [5, 30], notes: "Under 80 chars, polite, minimal line breaks, text." },
  linkedin: { targetWords: [40, 90], notes: "Greeting + purpose + one ask. No cold outreach." },
  gcal: { targetWords: [10, 60], notes: "Invite response text; the event goes through approval." },
  agent: { targetWords: [0, 0], notes: "Not a draft — the user writes it directly (A4 §3.4)." },
  system: { targetWords: [0, 0], notes: "Not a draft." },
};
