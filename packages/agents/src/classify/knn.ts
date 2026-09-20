// A4 §2.2 stage 2 — embedding kNN (T0, $0, ~20ms). Weight = sim².
// The two thresholds get recalibrated from the first two weeks of label logs (A4 §2.2). For now they
// are set conservatively so a lot falls through to T1.
import type { Scope } from "@omnis/protocol";
import type { ItemRow } from "../types.js";
import type { ClassifyCtx } from "./rules.js";

export const KNN_K = 15;
export const KNN_MARGIN_MIN = 0.35;
export const KNN_SIM_MIN = 0.62;

export interface KnnVerdict {
  scope: Scope;
  margin: number;
  avgSim: number;
  neighborIds: string[];
}

const SQL = `
  SELECT i.id, i.scope, 1 - (i.embedding <=> $1::vector) AS sim
    FROM items i
   WHERE i.embedding IS NOT NULL
     AND i.id <> $3
     AND i.scope <> 'unknown'
     AND i.sent_at > now() - interval '180 days'
   ORDER BY i.embedding <=> $1::vector
   LIMIT $2`;

export async function knnVote(item: ItemRow, ctx: ClassifyCtx): Promise<KnnVerdict | null> {
  if (item.embedding === null) return null;

  const { rows } = await ctx.pool.query<{ id: string; scope: Scope; sim: string }>(SQL, [
    item.embedding,
    KNN_K,
    item.id,
  ]);
  if (rows.length === 0) return null;

  const votes = new Map<Scope, { weight: number; sims: number[]; ids: string[] }>();
  for (const r of rows) {
    const sim = Number(r.sim);
    const slot = votes.get(r.scope) ?? { weight: 0, sims: [], ids: [] };
    slot.weight += sim * sim;
    slot.sims.push(sim);
    slot.ids.push(r.id);
    votes.set(r.scope, slot);
  }

  const ranked = [...votes.entries()].sort((a, b) => b[1].weight - a[1].weight);
  const first = ranked[0];
  if (first === undefined) return null;
  const v1 = first[1].weight;
  const v2 = ranked[1]?.[1].weight ?? 0;
  const margin = v1 === 0 ? 0 : (v1 - v2) / v1;
  const avgSim = first[1].sims.reduce((a, b) => a + b, 0) / first[1].sims.length;

  if (margin < KNN_MARGIN_MIN || avgSim < KNN_SIM_MIN) return null;
  return { scope: first[0], margin, avgSim, neighborIds: first[1].ids };
}
