import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createAudit } from "../../src/audit.js";
import { COST_DAILY_CRON, COST_DAILY_JOB_NAME, runCostDaily } from "../../src/jobs/cost-daily.js";
import { createLogger } from "../../src/logger.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});
afterAll(() => pool.end());

beforeEach(async () => {
  // 상태는 agent_runs 전량의 월 합계로 결정된다 — 다른 테스트 파일이 남긴 비용까지 세면
  // 같은 입력이 다른 상태를 낳는다. 그래서 model='cd-test'가 아니라 테이블을 비운다.
  await pool.query("DELETE FROM agent_runs");
  await pool.query("DELETE FROM audit_log WHERE action = 'cost.state_changed'");
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ('cost.cap_usd','60'::jsonb),
                                              ('cost.reserve_ratio','0.1'::jsonb),
                                              ('cost.last_state','"normal"'::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
  );
});

describe("cost_daily job (A4 §12.4)", () => {
  it("is scheduled at 00:05 KST under the seeded job name", async () => {
    expect(COST_DAILY_CRON).toBe("5 0 * * *");
    const { rows } = await pool.query<{ schedule: string }>(
      "SELECT schedule FROM jobs WHERE name = $1",
      [COST_DAILY_JOB_NAME],
    );
    expect(rows[0]?.schedule).toBe("5 0 * * *");
  });

  it("aggregates agent_runs into the cost_daily view", async () => {
    await pool.query(
      `INSERT INTO agent_runs (loop, trigger_kind, model_tier, provider, model, cost_usd, tokens_in, tokens_cached, outcome)
       VALUES ('draft','cron','T1','openrouter','cd-test', 0.5, 1000, 700, 'ok'),
              ('draft','cron','T1','openrouter','cd-test', 0.25, 500, 100, 'failed')`,
    );
    const { rows } = await pool.query<{ runs: string; cost_usd: string; tokens_cached: string }>(
      `SELECT runs::text, cost_usd::text, tokens_cached::text FROM cost_daily
        WHERE loop = 'draft' AND model_tier = 'T1' AND day = (now() AT TIME ZONE 'Asia/Seoul')::date`,
    );
    expect(Number(rows[0]?.runs)).toBeGreaterThanOrEqual(2);
    expect(Number(rows[0]?.cost_usd)).toBeGreaterThanOrEqual(0.75);
    expect(Number(rows[0]?.tokens_cached)).toBeGreaterThanOrEqual(800);
  });

  it("records an audit row and a system item when the state changes", async () => {
    await pool.query(
      `INSERT INTO agent_runs (loop, trigger_kind, model_tier, provider, model, cost_usd, outcome)
       VALUES ('draft','cron','T1','openrouter','cd-test', 50, 'ok')`,
    );
    const logger = createLogger("@omnis/kernel");
    const state = await runCostDaily({ pool, audit: createAudit(pool), logger, now: new Date() });
    expect(state).toBe("degraded");
    const { rows } = await pool.query<{ after: { to: string } }>(
      "SELECT after FROM audit_log WHERE action = 'cost.state_changed' ORDER BY at DESC LIMIT 1",
    );
    expect(rows[0]?.after.to).toBe("degraded");
    const items = await pool.query<{ body: string }>(
      `SELECT body FROM items WHERE kind = 'system' AND body LIKE '%80%' ORDER BY sent_at DESC LIMIT 1`,
    );
    expect(items.rows[0]?.body).toContain("T2");
    // 두 번째 실행은 상태가 같으므로 아무것도 더 남기지 않는다
    await runCostDaily({ pool, audit: createAudit(pool), logger, now: new Date() });
    const again = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_log WHERE action = 'cost.state_changed'",
    );
    expect(again.rows[0]?.n).toBe("1");
  });
});
