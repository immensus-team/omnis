import { createPool, one, query } from "@omnis/db";
import {
  type Events,
  type Scheduler,
  createEvents,
  createLogger,
  createScheduler,
} from "@omnis/kernel";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

let pool: Pool;
let events: Events & { close(): Promise<void> };
const logger = createLogger("@omnis/kernel");
const started: Scheduler[] = [];

beforeAll(() => {
  pool = createPool();
  events = createEvents({ pool, logger });
});
afterEach(async () => {
  for (const s of started.splice(0)) await s.stop();
});
afterAll(async () => {
  // 공유 omnis_test DB: 등록한 test_* 잡을 지우지 않으면 0006의 seed 개수 단언이 깨진다.
  await query(pool, `DELETE FROM jobs WHERE name LIKE 'test\\_%'`);
  await events.close();
  await pool.end();
});

function make(extra: Partial<Parameters<typeof createScheduler>[0]> = {}): Scheduler {
  const s = createScheduler({ pool, events, logger, tickMs: 50, ...extra });
  started.push(s);
  return s;
}

describe("scheduler", () => {
  it("upserts a jobs row on register+start and computes next_run_at", async () => {
    const s = make();
    s.register("test_upsert", "0 4 * * *", async () => undefined);
    await s.start();

    const row = await one<{
      schedule: string;
      enabled: boolean;
      next_run_at: Date;
      claimed_at: Date | null;
    }>(
      pool,
      `SELECT schedule, enabled, next_run_at, claimed_at FROM jobs WHERE name = 'test_upsert'`,
    );
    expect(row.schedule).toBe("0 4 * * *");
    expect(row.enabled).toBe(true);
    expect(row.claimed_at).toBeNull();
    expect(row.next_run_at.getTime()).toBeGreaterThan(Date.now());
  });

  it("runs a due job exactly once and records ok + next_run_at + a cold event", async () => {
    let runs = 0;
    const s = make();
    s.register("test_due", "*/1 * * * *", async () => {
      runs += 1;
    });
    await s.start();
    await query(
      pool,
      `UPDATE jobs SET next_run_at = now() - interval '1 minute' WHERE name = 'test_due'`,
    );
    await new Promise((r) => setTimeout(r, 400));

    expect(runs).toBe(1);
    const row = await one<{
      last_status: string;
      last_error: string | null;
      next_run_at: Date;
      claimed_at: Date | null;
    }>(
      pool,
      `SELECT last_status, last_error, next_run_at, claimed_at FROM jobs WHERE name = 'test_due'`,
    );
    expect(row.last_status).toBe("ok");
    expect(row.last_error).toBeNull();
    expect(row.claimed_at).toBeNull();
    expect(row.next_run_at.getTime()).toBeGreaterThan(Date.now());

    const ev = await one<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM events WHERE kind = 'job.run' AND payload->>'name' = 'test_due'`,
    );
    expect(ev.n).toBe("1");
  });

  it("records failed + last_error without crashing the tick", async () => {
    const s = make();
    s.register("test_fail", "*/1 * * * *", async () => {
      throw new Error("handler exploded");
    });
    await s.start();
    await query(
      pool,
      `UPDATE jobs SET next_run_at = now() - interval '1 minute' WHERE name = 'test_fail'`,
    );
    await new Promise((r) => setTimeout(r, 400));

    const row = await one<{ last_status: string; last_error: string }>(
      pool,
      `SELECT last_status, last_error FROM jobs WHERE name = 'test_fail'`,
    );
    expect(row.last_status).toBe("failed");
    expect(row.last_error).toContain("handler exploded");
  });

  it("does not touch seeded jobs that have no registered handler", async () => {
    const s = make();
    s.register("test_isolated", "*/1 * * * *", async () => undefined);
    await s.start();
    await query(
      pool,
      `UPDATE jobs SET next_run_at = now() - interval '1 hour' WHERE name = 'morning_digest'`,
    );
    await new Promise((r) => setTimeout(r, 300));

    const row = await one<{ last_status: string | null; claimed_at: Date | null }>(
      pool,
      `SELECT last_status, claimed_at FROM jobs WHERE name = 'morning_digest'`,
    );
    expect(row.last_status).toBeNull();
    expect(row.claimed_at).toBeNull();
  });

  it("skips a disabled job", async () => {
    let runs = 0;
    const s = make();
    s.register("test_disabled", "*/1 * * * *", async () => {
      runs += 1;
    });
    await s.start();
    await query(
      pool,
      `UPDATE jobs SET enabled = false, next_run_at = now() - interval '1 minute' WHERE name = 'test_disabled'`,
    );
    await new Promise((r) => setTimeout(r, 300));
    expect(runs).toBe(0);
  });

  it("stops ticking after stop()", async () => {
    let runs = 0;
    const s = make();
    s.register("test_stop", "*/1 * * * *", async () => {
      runs += 1;
    });
    await s.start();
    await s.stop();
    await query(
      pool,
      `UPDATE jobs SET next_run_at = now() - interval '1 minute' WHERE name = 'test_stop'`,
    );
    await new Promise((r) => setTimeout(r, 300));
    expect(runs).toBe(0);
  });
});
