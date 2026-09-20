import { createPool, one, query } from "@omnis/db";
import {
  createEvents,
  createLogger,
  createScheduler,
  registerTokenRefreshJob,
} from "@omnis/kernel";
import type { Events, Scheduler } from "@omnis/kernel";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let pool: Pool;
let events: Events & { close(): Promise<void> };
let scheduler: Scheduler;
let accountId: string;

beforeAll(async () => {
  pool = createPool();
  events = createEvents({ pool, logger: createLogger("@omnis/kernel") });
  // The 0006 seed pre-plants 'token_refresh' with next_run_at=now() (migration apply time, delta §8).
  // scheduler.start()'s upsert leaves an existing row's next_run_at alone (FIXED, scheduler.ts), so if
  // this seed row is left in place start()'s first internal tick immediately fires once to "catch up on
  // a missed run" — and with the test then moving next_run_at into the past, the refresher is called
  // twice. Delete the seed row so every run starts from a clean state (symmetric with afterAll).
  await query(pool, "DELETE FROM jobs WHERE name = 'token_refresh'");
  const account = await one<{ id: string }>(
    pool,
    `INSERT INTO accounts (channel, external_id, display) VALUES ('outlook', 'expiring@x.com', 'x') RETURNING id`,
  );
  accountId = account.id;
  await query(
    pool,
    `INSERT INTO account_secrets (account_id, auth_ref, expires_at) VALUES ($1, 'omnis.outlook.expiring@x.com', now() + interval '5 minutes')`,
    [accountId],
  );
});
afterAll(async () => {
  await scheduler.stop();
  await query(pool, "DELETE FROM account_secrets WHERE account_id = $1", [accountId]);
  await query(pool, "DELETE FROM accounts WHERE id = $1", [accountId]);
  await query(pool, "DELETE FROM jobs WHERE name = 'token_refresh'");
  await events.close();
  await pool.end();
});

describe("token_refresh job", () => {
  it("calls the injected refresher for accounts whose secret expires within the window", async () => {
    const refresher = vi.fn(async () => {});
    scheduler = createScheduler({
      pool,
      events,
      logger: createLogger("@omnis/kernel"),
      tickMs: 50,
    });
    registerTokenRefreshJob(scheduler, {
      pool,
      logger: createLogger("@omnis/kernel"),
      refreshers: { outlook: refresher },
      windowMinutes: 60,
    });
    await scheduler.start();
    await query(
      pool,
      `UPDATE jobs SET next_run_at = now() - interval '1 minute' WHERE name = 'token_refresh'`,
    );
    await new Promise((r) => setTimeout(r, 300));
    expect(refresher).toHaveBeenCalledOnce();
    const [auth] = refresher.mock.calls[0] as [
      { channel: string; accountExternalId: string; keychainService: string },
    ];
    expect(auth.channel).toBe("outlook");
    expect(auth.accountExternalId).toBe("expiring@x.com");
    expect(auth.keychainService).toBe("omnis.outlook.expiring@x.com");
  });
});
