import { createPool, one, query } from "@omnis/db";
import {
  type Events,
  type KillSwitch,
  type Scheduler,
  createAudit,
  createEvents,
  createKillSwitch,
  createLogger,
  createScheduler,
} from "@omnis/kernel";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let pool: Pool;
let events: Events & { close(): Promise<void> };
let killSwitch: KillSwitch;
let scheduler: Scheduler;
let runs = 0;
const logger = createLogger("@omnis/kernel");

/** Closes the window in which a tick (50ms) already passed the gate and is in flight. Once it
 * elapses, no tick is left. */
const SETTLE_MS = 150;
/** The cron must not become due again on its own inside the test window (400ms) — only the
 * UPDATE below makes it due. */
const NEVER_IN_A_TEST_WINDOW = "0 4 * * *";

async function makeDue(): Promise<void> {
  await query(
    pool,
    `UPDATE jobs SET next_run_at = now() - interval '1 minute' WHERE name='test_killable'`,
  );
}

beforeAll(async () => {
  pool = createPool();
  events = createEvents({ pool, logger });
  killSwitch = createKillSwitch({ pool, events, audit: createAudit(pool), logger });
  await killSwitch.set(false, "test start");
  scheduler = createScheduler({
    pool,
    events,
    logger,
    tickMs: 50,
    isKillSwitchOn: () => killSwitch.isOn(),
  });
  scheduler.register("test_killable", NEVER_IN_A_TEST_WINDOW, async () => {
    runs += 1;
  });
  await scheduler.start();
});
afterAll(async () => {
  await scheduler.stop();
  await killSwitch.set(false, "test end");
  // Shared omnis_test DB: leaving the registered test_* job behind breaks the 0006
  // seed-count assertion.
  await query(pool, `DELETE FROM jobs WHERE name = 'test_killable'`);
  await events.close();
  await pool.end();
});

describe("kill switch stops the scheduler", () => {
  it("runs a due job while the switch is off", async () => {
    runs = 0;
    await makeDue();
    await new Promise((r) => setTimeout(r, 400));
    expect(runs).toBe(1);
  });

  it("stops running due jobs while the switch is on, and leaves the claim untouched", async () => {
    // set() only flips cached=on after the audit insert finishes. A tick that passed the gate in
    // the meantime is still in flight, so let it settle first, then zero the counter (order
    // matters).
    await killSwitch.set(true, "stop everything");
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    runs = 0;
    await makeDue();
    await new Promise((r) => setTimeout(r, 400));
    expect(runs).toBe(0);

    const row = await one<{ claimed_at: Date | null }>(
      pool,
      `SELECT claimed_at FROM jobs WHERE name = 'test_killable'`,
    );
    expect(row.claimed_at).toBeNull();
  });

  it("resumes on the next tick once the switch goes off", async () => {
    runs = 0;
    await killSwitch.set(false, "resume");
    await makeDue();
    await new Promise((r) => setTimeout(r, 400));
    expect(runs).toBe(1);
  });
});
