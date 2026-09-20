// A4 §12.4. There are two budgets — $54 general and a $6 reserve for VIP·sensitive drafts
// (master §14, §19 Q11).
import { query } from "@omnis/db";
import type { Pool } from "pg";

export type CostState = "normal" | "warn" | "degraded" | "reserve_only" | "frozen";

export interface CostInput {
  mtdUsd: number;
  capUsd: number;
  reserveRatio: number;
}

export function costState({ mtdUsd, capUsd, reserveRatio }: CostInput): CostState {
  const general = capUsd * (1 - reserveRatio);
  if (mtdUsd >= capUsd) return "frozen";
  if (mtdUsd >= general) return "reserve_only";
  const r = mtdUsd / capUsd;
  if (r >= 0.8) return "degraded";
  if (r >= 0.6) return "warn";
  return "normal";
}

export interface Policy {
  allowT2NonSensitive: boolean;
  allowT2Reserve: boolean;
  draftsNonVip: boolean;
  draftsVipSensitive: boolean;
  digestCron: "daily" | "alternate" | "off";
  note: string | null;
}

export const POLICY: Record<CostState, Policy> = {
  normal: {
    allowT2NonSensitive: true,
    allowT2Reserve: true,
    draftsNonVip: true,
    draftsVipSensitive: true,
    digestCron: "daily",
    note: null,
  },
  warn: {
    allowT2NonSensitive: true,
    allowT2Reserve: true,
    draftsNonVip: true,
    draftsVipSensitive: true,
    digestCron: "daily",
    note: "This month's LLM spend is at 60% of the cap.",
  },
  degraded: {
    allowT2NonSensitive: false,
    allowT2Reserve: true,
    draftsNonVip: true,
    draftsVipSensitive: true,
    digestCron: "alternate",
    note: "Paused T2 escalation for non-sensitive work (generating with T1). VIP·sensitive drafts continue from the reserve.",
  },
  reserve_only: {
    allowT2NonSensitive: false,
    allowT2Reserve: true,
    draftsNonVip: false,
    draftsVipSensitive: true,
    digestCron: "alternate",
    note: "The general budget is exhausted, so non-VIP draft generation has stopped. Classification, labeling, todo extraction, and auto-archiving continue; VIP·sensitive drafts continue from the reserve.",
  },
  frozen: {
    allowT2NonSensitive: false,
    allowT2Reserve: false,
    draftsNonVip: false,
    draftsVipSensitive: false,
    digestCron: "off",
    note: "The reserve is exhausted too, so all draft generation has stopped. Classification, labeling, todo extraction, and auto-archiving continue.",
  },
};

/** This month's total spend. agent_runs.cost_usd is the only input (A4 §12.4). */
export async function mtdSpendUsd(pool: Pool, now: Date): Promise<number> {
  const rows = await query<{ sum: string | null }>(
    pool,
    `SELECT COALESCE(sum(cost_usd), 0)::text AS sum FROM agent_runs
      WHERE created_at >= date_trunc('month', $1::timestamptz)`,
    [now],
  );
  return Number(rows[0]?.sum ?? "0");
}

/** Reserve spend: model_tier='T2' AND (VIP person, or an item with sensitivity<>'normal'). */
export async function reserveSpendUsd(pool: Pool, now: Date): Promise<number> {
  const rows = await query<{ sum: string | null }>(
    pool,
    `SELECT COALESCE(sum(r.cost_usd), 0)::text AS sum
       FROM agent_runs r
       JOIN items i ON i.id = r.item_id
       LEFT JOIN persons p ON p.id = i.author_person_id
      WHERE r.model_tier = 'T2'
        AND r.created_at >= date_trunc('month', $1::timestamptz)
        AND (COALESCE(p.vip, false) OR i.sensitivity <> 'normal')`,
    [now],
  );
  return Number(rows[0]?.sum ?? "0");
}

export async function currentPolicy(
  pool: Pool,
  now: Date = new Date(),
): Promise<{ state: CostState; policy: Policy; mtdUsd: number; reserveUsd: number }> {
  const { getSetting } = await import("../settings.js");
  const capUsd = await getSetting<number>(pool, "cost.cap_usd", 60);
  const reserveRatio = await getSetting<number>(pool, "cost.reserve_ratio", 0.1);
  const mtdUsd = await mtdSpendUsd(pool, now);
  const state = costState({ mtdUsd, capUsd, reserveRatio });
  const policy = POLICY[state];
  return { state, policy, mtdUsd, reserveUsd: await reserveSpendUsd(pool, now) };
}
