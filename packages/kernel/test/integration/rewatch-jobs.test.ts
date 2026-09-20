import { createPool, one, query } from "@omnis/db";
import {
  createEvents,
  createLogger,
  createScheduler,
  registerGmailRewatchJob,
  registerGraphSubRenewJob,
} from "@omnis/kernel";
import type { Events, Scheduler } from "@omnis/kernel";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let pool: Pool;
let events: Events & { close(): Promise<void> };
let gmailScheduler: Scheduler;
let graphScheduler: Scheduler;

beforeAll(async () => {
  pool = createPool();
  events = createEvents({ pool, logger: createLogger("@omnis/kernel") });
  await query(
    pool,
    `INSERT INTO accounts (channel, external_id, display) VALUES ('gmail', 'a@gmail.com', 'a'), ('outlook', 'b@outlook.com', 'b')`,
  );
});
afterAll(async () => {
  await gmailScheduler.stop();
  await graphScheduler.stop();
  await query(pool, "DELETE FROM accounts WHERE external_id IN ('a@gmail.com', 'b@outlook.com')");
  await query(pool, "DELETE FROM jobs WHERE name IN ('gmail_rewatch', 'graph_sub_renew')");
  await events.close();
  await pool.end();
});

describe("gmail_rewatch / graph_sub_renew jobs", () => {
  it("calls the injected rewatch callback for each active account on that channel", async () => {
    const gmailRewatch = vi.fn(async () => {});
    const graphRenew = vi.fn(async () => {});
    gmailScheduler = createScheduler({
      pool,
      events,
      logger: createLogger("@omnis/kernel"),
      tickMs: 50,
    });
    graphScheduler = createScheduler({
      pool,
      events,
      logger: createLogger("@omnis/kernel"),
      tickMs: 50,
    });
    registerGmailRewatchJob(gmailScheduler, {
      pool,
      logger: createLogger("@omnis/kernel"),
      rewatch: gmailRewatch,
    });
    registerGraphSubRenewJob(graphScheduler, {
      pool,
      logger: createLogger("@omnis/kernel"),
      rewatch: graphRenew,
    });
    await gmailScheduler.start();
    await graphScheduler.start();
    await query(
      pool,
      `UPDATE jobs SET next_run_at = now() - interval '1 minute' WHERE name IN ('gmail_rewatch', 'graph_sub_renew')`,
    );
    await new Promise((r) => setTimeout(r, 300));
    expect(gmailRewatch).toHaveBeenCalledWith("a@gmail.com");
    expect(graphRenew).toHaveBeenCalledWith("b@outlook.com");
  });

  it("skips silently when no rewatch callback is wired on this host", async () => {
    const scheduler = createScheduler({
      pool,
      events,
      logger: createLogger("@omnis/kernel"),
      tickMs: 50,
    });
    registerGmailRewatchJob(scheduler, { pool, logger: createLogger("@omnis/kernel") });
    await scheduler.start();
    await query(
      pool,
      `UPDATE jobs SET next_run_at = now() - interval '1 minute' WHERE name = 'gmail_rewatch'`,
    );
    await new Promise((r) => setTimeout(r, 200));
    const job = await one<{ last_status: string }>(
      pool,
      "SELECT last_status FROM jobs WHERE name = 'gmail_rewatch'",
    );
    expect(job.last_status).toBe("ok"); // 콜백 없음 = 정상 스킵, 실패가 아니다
    await scheduler.stop();
  });
});
