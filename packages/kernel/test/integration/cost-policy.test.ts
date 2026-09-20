import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { currentPolicy, reserveSpendUsd } from "../../src/cost/governor.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});
afterAll(() => pool.end());

beforeEach(async () => {
  // mtd 합계는 agent_runs 전량이 입력이라 다른 파일이 남긴 행도 상태를 바꾼다 — 테이블을 비운다.
  await pool.query("DELETE FROM agent_runs");
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ('cost.cap_usd','60'::jsonb),
                                              ('cost.reserve_ratio','0.1'::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
  );
});

async function spend(usd: number, tier: "T1" | "T2", itemId: string | null): Promise<void> {
  await pool.query(
    `INSERT INTO agent_runs (loop, item_id, trigger_kind, model_tier, provider, model, cost_usd, outcome)
     VALUES ('draft', $1, 'event', $2, 'openrouter', 'cost-test', $3, 'ok')`,
    [itemId, tier, usd],
  );
}

describe("currentPolicy (A4 §12.4)", () => {
  it("reads the month-to-date sum and returns the matching policy", async () => {
    await spend(50, "T1", null);
    const { state, policy, mtdUsd } = await currentPolicy(pool, new Date());
    expect(mtdUsd).toBeCloseTo(50, 5);
    expect(state).toBe("degraded");
    expect(policy.allowT2NonSensitive).toBe(false);
    expect(policy.draftsVipSensitive).toBe(true);
  });

  it("counts reserve spend only for T2 on VIP or non-normal items", async () => {
    const acc = await pool.query<{ id: string }>(
      `INSERT INTO accounts (channel, external_id, display) VALUES ('gmail','cost@test','c')
         ON CONFLICT (channel, external_id) DO UPDATE SET display='c' RETURNING id`,
    );
    const accountId = acc.rows[0]?.id ?? "";
    const thr = await pool.query<{ id: string }>(
      `INSERT INTO threads (account_id, external_id, kind) VALUES ($1,'thr_cost','email')
         ON CONFLICT (account_id, external_id) DO UPDATE SET kind='email' RETURNING id`,
      [accountId],
    );
    const it = await pool.query<{ id: string }>(
      `INSERT INTO items (thread_id, account_id, external_id, kind, sensitivity, body, sent_at)
       VALUES ($1,$2,'it_cost','email','finance','x', now())
       ON CONFLICT (account_id, external_id) WHERE external_id IS NOT NULL
         DO UPDATE SET sensitivity='finance' RETURNING id`,
      [thr.rows[0]?.id ?? "", accountId],
    );
    await spend(3, "T2", it.rows[0]?.id ?? null);
    await spend(7, "T2", null); // item 없는 T2는 예비비가 아니다
    expect(await reserveSpendUsd(pool, new Date())).toBeCloseTo(3, 5);
  });
});
