import { createPool, one, query } from "@omnis/db";
import {
  type Events,
  HEALTHCHECK_CRON,
  HEALTHCHECK_JOB_NAME,
  type Scheduler,
  createEvents,
  createLogger,
  createScheduler,
  registerHealthcheckJob,
} from "@omnis/kernel";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let pool: Pool;
let events: Events & { close(): Promise<void> };
let scheduler: Scheduler;

beforeAll(async () => {
  pool = createPool();
  events = createEvents({ pool, logger: createLogger("@omnis/kernel") });
  scheduler = createScheduler({ pool, events, logger: createLogger("@omnis/kernel"), tickMs: 50 });
  registerHealthcheckJob(scheduler, { pool, events });
  await scheduler.start();
});
afterAll(async () => {
  await scheduler.stop();
  await events.close();
  await pool.end();
});

describe("hub_healthcheck job", () => {
  it("registers itself with a 5-minute schedule", async () => {
    const row = await one<{ schedule: string; enabled: boolean }>(
      pool,
      `SELECT schedule, enabled FROM jobs WHERE name = $1`,
      [HEALTHCHECK_JOB_NAME],
    );
    expect(row.schedule).toBe(HEALTHCHECK_CRON);
    expect(row.enabled).toBe(true);
  });

  it("runs and writes a cold hub.health event with the table counts", async () => {
    await query(pool, `UPDATE jobs SET next_run_at = now() - interval '1 minute' WHERE name = $1`, [
      HEALTHCHECK_JOB_NAME,
    ]);
    await new Promise((r) => setTimeout(r, 400));

    const job = await one<{ last_status: string }>(
      pool,
      `SELECT last_status FROM jobs WHERE name = $1`,
      [HEALTHCHECK_JOB_NAME],
    );
    expect(job.last_status).toBe("ok");

    const ev = await one<{ payload: Record<string, unknown> }>(
      pool,
      `SELECT payload FROM events WHERE kind = 'hub.health' ORDER BY seq DESC LIMIT 1`,
    );
    expect(ev.payload.db).toBe("up");
    expect(typeof ev.payload.pending_approvals).toBe("number");
    expect(typeof ev.payload.due_jobs).toBe("number");
  });
});
