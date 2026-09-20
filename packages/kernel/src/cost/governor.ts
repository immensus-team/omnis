// A4 §12.4. 예산은 두 개다 — 일반 $54와 VIP·민감 전용 예비비 $6(마스터 §14, §19 Q11).
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
    note: "이번 달 LLM 비용이 상한의 60%입니다.",
  },
  degraded: {
    allowT2NonSensitive: false,
    allowT2Reserve: true,
    draftsNonVip: true,
    draftsVipSensitive: true,
    digestCron: "alternate",
    note: "비민감 작업의 T2 에스컬레이션을 중단했습니다(T1으로 생성). VIP·민감 초안은 예비비로 계속됩니다.",
  },
  reserve_only: {
    allowT2NonSensitive: false,
    allowT2Reserve: true,
    draftsNonVip: false,
    draftsVipSensitive: true,
    digestCron: "alternate",
    note: "일반 예산이 소진되어 비VIP 초안 생성을 중단했습니다. 분류·라벨·투두 추출·자동 보관은 계속되고, VIP·민감 초안은 예비비로 계속됩니다.",
  },
  frozen: {
    allowT2NonSensitive: false,
    allowT2Reserve: false,
    draftsNonVip: false,
    draftsVipSensitive: false,
    digestCron: "off",
    note: "예비비까지 소진되어 모든 초안 생성을 중단했습니다. 분류·라벨·투두 추출·자동 보관은 계속됩니다.",
  },
};

/** 이번 달 총 지출. agent_runs.cost_usd가 유일한 입력이다(A4 §12.4). */
export async function mtdSpendUsd(pool: Pool, now: Date): Promise<number> {
  const rows = await query<{ sum: string | null }>(
    pool,
    `SELECT COALESCE(sum(cost_usd), 0)::text AS sum FROM agent_runs
      WHERE created_at >= date_trunc('month', $1::timestamptz)`,
    [now],
  );
  return Number(rows[0]?.sum ?? "0");
}

/** 예비비 소진분: model_tier='T2' AND (VIP person이거나 sensitivity<>'normal'인 item). */
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
