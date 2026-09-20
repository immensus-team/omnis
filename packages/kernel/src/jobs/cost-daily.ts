// A4 §12.4: 매일 00:05 KST 집계 + 상태 전이 감지. 뷰는 SQL이 갱신하므로 잡은 전이만 본다.
import { query } from "@omnis/db";
import type { Pool } from "pg";
import type { Audit } from "../audit.js";
import { type CostState, currentPolicy } from "../cost/governor.js";
import type { Logger } from "../logger.js";
import type { Scheduler } from "../scheduler.js";

export const COST_DAILY_JOB_NAME = "cost_daily";
export const COST_DAILY_CRON = "5 0 * * *";

export interface CostDailyDeps {
  pool: Pool;
  audit: Audit;
  logger: Logger;
  now?: Date;
}

/** The thresholds of the A4 §12.4 state table as-is. `Policy.note` only says "what stopped", so a
 *  sentence saying "why it changed now" is put in front of it. */
const HEADLINE: Record<CostState, string> = {
  normal: "LLM spend is back in the normal range",
  warn: "This month's LLM spend has passed 60% of the monthly cap",
  degraded: "This month's LLM spend has passed 80% of the monthly cap",
  reserve_only: "The general budget is spent; only the VIP/sensitive reserve is left",
  frozen: "The monthly cap is fully spent",
};

async function lastState(pool: Pool): Promise<CostState | null> {
  const rows = await query<{ value: CostState | null }>(
    pool,
    "SELECT value #>> '{}' AS value FROM settings WHERE key = 'cost.last_state'",
  );
  return rows[0]?.value ?? null;
}

export async function runCostDaily(deps: CostDailyDeps): Promise<CostState> {
  const { pool, audit, logger } = deps;
  const now = deps.now ?? new Date();
  const { state, policy, mtdUsd, reserveUsd } = await currentPolicy(pool, now);
  const previous = await lastState(pool);
  if (previous === state) return state;

  await query(
    pool,
    `INSERT INTO settings (key, value) VALUES ('cost.last_state', to_jsonb($1::text))
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [state],
  );
  await audit.record({
    actor: "system",
    action: "cost.state_changed",
    target_table: "settings",
    before: { from: previous },
    after: { to: state, mtdUsd, reserveUsd },
  });
  const body = `${HEADLINE[state]} (month to date $${mtdUsd.toFixed(2)}, reserve $${reserveUsd.toFixed(2)}).${
    policy.note === null ? "" : ` ${policy.note}`
  }`;
  // ponytail: @omnis/kernel cannot depend on @omnis/agents, so writeSystemItem is out of reach.
  // The same INSERT in the same shape — a deliberate duplication (contract §12).
  await query(
    pool,
    `WITH acc AS (
       INSERT INTO accounts (channel, external_id, display) VALUES ('system','omnis','omnis')
       ON CONFLICT (channel, external_id) DO UPDATE SET display = EXCLUDED.display RETURNING id),
     thr AS (
       INSERT INTO threads (account_id, external_id, kind, title)
       SELECT id, 'system:agents', 'system', 'omnis' FROM acc
       ON CONFLICT (account_id, external_id) DO UPDATE SET kind = 'system' RETURNING id, account_id)
     INSERT INTO items (thread_id, account_id, kind, status, body, sent_at, meta)
     SELECT thr.id, thr.account_id, 'system', 'received', $1, now(), $2::jsonb FROM thr`,
    [body, JSON.stringify({ cost_state: state, mtd_usd: mtdUsd, reserve_usd: reserveUsd })],
  );
  logger.warn("cost state changed", { from: previous, to: state, mtdUsd });
  return state;
}

export function registerCostDailyJob(scheduler: Scheduler, deps: CostDailyDeps): void {
  scheduler.register(COST_DAILY_JOB_NAME, COST_DAILY_CRON, async () => {
    await runCostDaily(deps);
  });
}
