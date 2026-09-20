// A4 §2.4: sensitivity는 L1이 유일 생산자이고, 겹치면 health > legal > finance > personal 우선순위로 하나만 고른다.
// Phase A 범위(A7 §7 US-A23b): 기본 'normal' + VIP면 'personal' 승격까지. T2 강제 라우팅은 Phase B 비용 정책 스토리.
import type { Sensitivity } from "@omnis/protocol";
import type { ClassifyCtx } from "./classify/rules.js";
import type { ItemRow } from "./types.js";

/** 높은 것이 앞. 같은 메일이 실행마다 다른 값을 받지 않게 하는 게 이 순서의 목적이다. */
export const SENSITIVITY_PRIORITY: readonly Sensitivity[] = [
  "health",
  "legal",
  "finance",
  "personal",
  "normal",
];

export function pickSensitivity(...candidates: Sensitivity[]): Sensitivity {
  for (const level of SENSITIVITY_PRIORITY) {
    if (candidates.includes(level)) return level;
  }
  return "normal";
}

export async function sensitivityFor(item: ItemRow, ctx: ClassifyCtx): Promise<Sensitivity> {
  if (ctx.authorPersonId === undefined) return pickSensitivity(item.sensitivity);
  const { rows } = await ctx.pool.query<{ vip: boolean }>(
    "SELECT vip FROM persons WHERE id = $1 AND merged_into IS NULL",
    [ctx.authorPersonId],
  );
  const vip = rows[0]?.vip === true;
  return pickSensitivity(item.sensitivity, ...(vip ? (["personal"] as const) : []));
}
