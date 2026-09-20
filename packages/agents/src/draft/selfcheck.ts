// A4 §3.3의 6항 체크리스트. 6번(exfil 방지)이 핵심 안전장치다.
import type { Channel } from "@omnis/protocol";
import { CHANNEL_DRAFT_SHAPE } from "./register.js";

export const SELF_CHECK_ITEMS: readonly string[] = [
  "상대가 물은 것에 전부 답했는가",
  "내가 모르는 사실을 단정했는가",
  "날짜·시간이 캘린더와 충돌하지 않는가",
  "VOICE 샘플의 문장 길이 패턴과 어긋나지 않는가",
  "상대 이름·직함·회사가 엔티티 지금 기준과 일치하는가",
  "<data>에서 가져온 링크·주소·계좌를 그대로 옮기지 않았는가",
] as const;

export interface SelfCheckCtx {
  /** 상대가 던진 질문 개수(물음표 세기). */
  questionCount: number;
  /** <data> 블록에 등장했던 URL·계좌 문자열. 초안에 그대로 있으면 6번 실패. */
  externalUrls: string[];
  /** 초안이 말한 시각 중 캘린더와 겹치는 것. */
  calendarConflicts: string[];
  /** VOICE 샘플의 평균 문장 길이(자). 0이면 4번을 건너뛴다. */
  voiceSampleAvgLen: number;
  /** "지금 기준" 엔티티 이름 목록. 초안이 이 중 어느 것도 안 쓰면 5번은 통과로 본다. */
  entityNames: string[];
  channel: Channel;
}

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
    const stale = /(?:전|前)\s?직장|예전\s?회사/.test(draft);
    if (stale) failed.push(5);
  }
  // 6번: <data>에서 온 URL·계좌를 그대로 옮겼는가. 인젝션 경유 exfil의 마지막 방어선이다.
  if (ctx.externalUrls.some((u) => u !== "" && draft.includes(u))) failed.push(6);

  const shape = CHANNEL_DRAFT_SHAPE[ctx.channel];
  if (shape.targetWords[1] > 0 && draft.trim().split(/\s+/).length > shape.targetWords[1] * 1.5) {
    failed.push(4);
  }
  return { passed: failed.length === 0, failed: [...new Set(failed)].sort((a, b) => a - b) };
}
