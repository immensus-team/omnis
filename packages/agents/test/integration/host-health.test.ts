import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MACBOOK_OFFLINE_MS, hostHealth } from "../../src/delegate/route.js";
import { configureAgents, resetAgentsPoolForTest } from "../../src/pool.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});
// hostHealth looks at max(last_seen_at) per host — apps/hub's bridge test registers
// claude_code/macbook in the same DB at now(), so anchoring on a fixed past instant would let
// that row win the max. Stamping our heartbeat at now() and putting the reference instant five
// minutes after it keeps the age inside (0, 300s] even under contention.
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
    // The omnis/mini row from the 0002 seed has last_seen_at NULL.
    expect(h.mini.lastHeartbeatMs).toBe(Number.POSITIVE_INFINITY);
  });
});
