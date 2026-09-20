import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MACBOOK_OFFLINE_MS, hostHealth } from "../../src/delegate/route.js";
import { configureAgents, resetAgentsPoolForTest } from "../../src/pool.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});
const now = new Date("2026-09-20T12:00:00Z");

beforeAll(async () => {
  configureAgents({ pool });
  await pool.query(
    `INSERT INTO agent_runtimes (runtime, host, display, state, last_seen_at)
     VALUES ('claude_code','macbook','mb','online',$1)
     ON CONFLICT (runtime, host) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at`,
    [new Date(now.getTime() - 300_000)],
  );
});

afterAll(async () => {
  resetAgentsPoolForTest();
  await pool.end();
});

describe("hostHealth (A4 §5.2)", () => {
  it("measures heartbeat age per host and treats a never-seen host as offline", async () => {
    const h = await hostHealth(now);
    expect(h.macbook.lastHeartbeatMs).toBe(300_000);
    expect(h.macbook.lastHeartbeatMs).toBeGreaterThan(MACBOOK_OFFLINE_MS);
    // 0002 시드의 omnis/mini row는 last_seen_at이 NULL이다.
    expect(h.mini.lastHeartbeatMs).toBe(Number.POSITIVE_INFINITY);
  });
});
