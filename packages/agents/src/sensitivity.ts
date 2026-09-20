// A4 §2.4: L1 is the sole producer of sensitivity; on a tie, pick exactly one by health > legal > finance > personal.
// Phase A scope (A7 §7 US-A23b): default 'normal', plus 'personal' promotion when the sender is a VIP. Forced T2 routing is a Phase B cost-policy story.
import type { Sensitivity } from "@omnis/protocol";
import type { ClassifyCtx } from "./classify/rules.js";
import type { ItemRow } from "./types.js";

/** Highest first. The point of this order is that the same mail never gets a different value per run. */
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
