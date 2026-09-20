import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MACBOOK_OFFLINE_MS, hostHealth } from "../../src/delegate/route.js";
import { configureAgents, resetAgentsPoolForTest } from "../../src/pool.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});
// hostHealth는 host별 max(last_seen_at)을 본다 — apps/hub의 bridge 테스트가 같은 DB에
// claude_code/macbook을 now()로 등록하므로 고정 과거 시각을 기준으로 잡으면 그 쪽이 max가 된다.
// 우리 하트비트를 now()로 찍고 기준 시각을 그 5분 뒤로 두면 경합해도 나이는 (0, 300s]에 머문다.
const now = new Date(Date.now() + 300_000);

beforeAll(async () => {
  configureAgents({ pool });
  await pool.query(
    `INSERT INTO agent_runtimes (runtime, host, display, state, last_seen_at)
     VALUES ('claude_code','macbook','mb','online', now())
     ON CONFLICT (runtime, host) DO UPDATE SET last_seen_at = now()`,
  );
});

afterAll(async () => {
  resetAgentsPoolForTest();
  await pool.end();
});

describe("hostHealth (A4 §5.2)", () => {
  it("measures heartbeat age per host and treats a never-seen host as offline", async () => {
    const h = await hostHealth(now);
    expect(h.macbook.lastHeartbeatMs).toBeLessThanOrEqual(300_000);
    expect(h.macbook.lastHeartbeatMs).toBeGreaterThan(MACBOOK_OFFLINE_MS);
    // 0002 시드의 omnis/mini row는 last_seen_at이 NULL이다.
    expect(h.mini.lastHeartbeatMs).toBe(Number.POSITIVE_INFINITY);
  });
});
