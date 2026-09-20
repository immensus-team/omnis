import { createPool, one, query } from "@omnis/db";
import { createLogger } from "@omnis/kernel";
import {
  ADAPTER_HEALTH_FAIL_THRESHOLD,
  recordAdapterHealth,
  resetAdapterHealthCounters,
} from "@omnis/kernel";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let pool: Pool;
const logger = createLogger("@omnis/kernel");

beforeAll(() => {
  pool = createPool();
});
afterAll(async () => {
  await pool.end();
});

// The plan's original text is a single `DELETE FROM accounts WHERE channel IN (...)` line, but
// threads.account_id in the real schema is ON DELETE RESTRICT (A3 §11 forbids hard deletes —
// accounts are not simply deletable). The system threads/items that recordAdapterHealth() creates
// must go first, or the accounts delete fails (deviation: the plan's single DELETE does not fit
// this RESTRICT constraint).
async function cleanupTestData(): Promise<void> {
  await query(
    pool,
    `DELETE FROM items WHERE account_id IN (SELECT id FROM accounts WHERE channel IN ('outlook', 'system'))`,
  );
  await query(
    pool,
    `DELETE FROM threads WHERE account_id IN (SELECT id FROM accounts WHERE channel IN ('outlook', 'system'))`,
  );
  await query(pool, "DELETE FROM accounts WHERE channel IN ('outlook', 'system')");
}

beforeEach(async () => {
  resetAdapterHealthCounters();
  await cleanupTestData();
});
afterEach(async () => {
  await cleanupTestData();
});

describe("recordAdapterHealth()", () => {
  it("does nothing to accounts.state before the consecutive-failure threshold", async () => {
    await query(
      pool,
      `INSERT INTO accounts (channel, external_id, display) VALUES ('outlook', 'a@x.com', 'a')`,
    );
    for (let i = 0; i < ADAPTER_HEALTH_FAIL_THRESHOLD - 1; i += 1) {
      await recordAdapterHealth({ pool, logger }, "outlook", false, "network down");
    }
    const row = await one<{ state: string }>(
      pool,
      `SELECT state FROM accounts WHERE channel = 'outlook'`,
    );
    expect(row.state).toBe("active");
  });

  it("flips accounts.state to broken and inserts a system item once the threshold is hit", async () => {
    await query(
      pool,
      `INSERT INTO accounts (channel, external_id, display) VALUES ('outlook', 'a@x.com', 'a')`,
    );
    for (let i = 0; i < ADAPTER_HEALTH_FAIL_THRESHOLD; i += 1) {
      await recordAdapterHealth({ pool, logger }, "outlook", false, "network down");
    }
    const account = await one<{ state: string; last_error: string }>(
      pool,
      `SELECT state, last_error FROM accounts WHERE channel = 'outlook'`,
    );
    expect(account.state).toBe("broken");
    expect(account.last_error).toBe("network down");
    const sys = await one<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM items i JOIN threads t ON t.id = i.thread_id
        WHERE i.kind = 'system' AND i.body LIKE '%outlook%connection lost%'`,
    );
    expect(Number(sys.n)).toBeGreaterThanOrEqual(1);
  });

  it("recovers accounts.state to active and resets the counter on ok=true", async () => {
    await query(
      pool,
      `INSERT INTO accounts (channel, external_id, display, state) VALUES ('outlook', 'a@x.com', 'a', 'broken')`,
    );
    await recordAdapterHealth({ pool, logger }, "outlook", true);
    const row = await one<{ state: string }>(
      pool,
      `SELECT state FROM accounts WHERE channel = 'outlook'`,
    );
    expect(row.state).toBe("active");
  });

  it("POSTs to the ntfy topic once the threshold is hit, and skips silently when ntfy.url is unset", async () => {
    await query(
      pool,
      `INSERT INTO accounts (channel, external_id, display) VALUES ('outlook', 'a@x.com', 'a')`,
    );
    const fetchFn = vi.fn(async () => new Response("", { status: 200 }));
    for (let i = 0; i < ADAPTER_HEALTH_FAIL_THRESHOLD; i += 1) {
      await recordAdapterHealth(
        {
          pool,
          logger,
          ntfy: {
            url: "http://127.0.0.1:2586",
            topic: "omnis-warning",
            fetchFn: fetchFn as unknown as typeof fetch,
          },
        },
        "outlook",
        false,
        "network down",
      );
    }
    expect(fetchFn).toHaveBeenCalledOnce();
    expect((fetchFn.mock.calls[0] as [string])[0]).toBe("http://127.0.0.1:2586/omnis-warning");
  });
});
