// A4 §3.1·§3.2·§3.4. 전부 규칙이다 — 여기에 모델 호출은 없다.
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

/** A4 §3.1: 0.5 미만이면 초안을 아예 안 만든다. */
export const NEEDS_REPLY_MIN = 0.5;

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

/** A4 §3.4 표 그대로. Channel 10값 전부를 덮는다(agent/system은 초안 대상이 아니라 0이다). */
export const CHANNEL_DRAFT_SHAPE: Record<Channel, DraftShape> = {
  gmail: { targetWords: [60, 180], notes: "인사말 + 본문 + 맺음말, 문단 2~3. subject는 Re: 유지." },
  outlook: { targetWords: [60, 180], notes: "Gmail과 동일." },
  slack: { targetWords: [10, 60], notes: "인사말 없음, 마크다운 최소. 새 @멘션 추가 금지." },
  telegram: { targetWords: [8, 45], notes: "1~3문장. 이모지는 VOICE에 샘플이 있을 때만 0~1개." },
  whatsapp: { targetWords: [6, 30], notes: "1~2문장, 줄바꿈 대신 단문." },
  kakaotalk: { targetWords: [5, 30], notes: "80자 이하, 존댓말 기본, 줄바꿈 최소, 텍스트만." },
  linkedin: { targetWords: [40, 90], notes: "인사 + 용건 + 제안 1개. 선제 발신 금지 규칙 적용." },
  gcal: { targetWords: [10, 60], notes: "초대 응답 문구. 일정 자체는 승인 경로다." },
  agent: { targetWords: [0, 0], notes: "초안 아님 — 사용자가 직접 쓴다(A4 §3.4)." },
  system: { targetWords: [0, 0], notes: "초안 아님." },
};
