import { createPool, one, query } from "@omnis/db";
import {
  COST_REPORT_CRON,
  COST_REPORT_JOB_NAME,
  type Events,
  LOW_CACHE_HIT_RATIO,
  type Scheduler,
  buildMonthlyCostReport,
  createEvents,
  createLogger,
  createScheduler,
  nextRunAt,
  registerCostReportJob,
} from "@omnis/kernel";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let pool: Pool;
let events: Events & { close(): Promise<void> };

/** The cron engine evaluates on the Asia/Seoul calendar, so "10 0 1 * *" fires at 15:10 UTC on the
 *  LAST day of the month it reports on. Derive the injected clock from the engine instead of hand-
 *  writing an instant, so the fixture cannot drift away from what the scheduler actually does. */
const FIRE_AT = nextRunAt(COST_REPORT_CRON, new Date("2026-08-15T00:00:00Z"));

/** August 2026 in KST: 2026-08-01 00:00 +09:00 .. 2026-09-01 00:00 +09:00. */
const AUG = { start: new Date("2026-07-31T15:00:00Z"), end: new Date("2026-08-31T15:00:00Z") };

async function seedRun(
  loop: string,
  tier: string,
  provider: string,
  tokensIn: number,
  tokensCached: number,
  costUsd: number,
) {
  await query(
    pool,
    `INSERT INTO agent_runs (loop, model_tier, provider, model, tokens_in, tokens_out, tokens_cached, cost_usd, outcome, created_at)
       VALUES ($1,$2,$3,'test-model',$4,10,$5,$6,'ok', $7)`,
    [loop, tier, provider, tokensIn, tokensCached, costUsd, new Date("2026-08-15T00:00:00Z")],
  );
}

beforeAll(async () => {
  pool = createPool();
  events = createEvents({ pool, logger: createLogger("@omnis/kernel") });
  await seedRun("draft", "T1", "deepseek", 1000, 500, 0.12); // 50% cache hit — healthy
  await seedRun("note_route", "T0", "local", 1000, 100, 0.01); // 10% cache hit — should be flagged
  await query(
    pool,
    `INSERT INTO digests (kind, for_date, body, metrics) VALUES ('nightly', '2026-08-31', 'existing body', '{"foo":1}'::jsonb)
       ON CONFLICT (kind, for_date) DO UPDATE SET body = EXCLUDED.body, metrics = EXCLUDED.metrics`,
  );
});
afterAll(async () => {
  await query(
    pool,
    "DELETE FROM agent_runs WHERE loop IN ('draft','note_route') AND model = 'test-model'",
  );
  await query(pool, "DELETE FROM digests WHERE kind = 'nightly' AND for_date = '2026-08-31'");
  await query(pool, "DELETE FROM jobs WHERE name = $1", [COST_REPORT_JOB_NAME]);
  await events.close();
  await pool.end();
});

describe("cost report window", () => {
  it("fires at the Seoul-calendar start of the month after the one it reports on", () => {
    expect(FIRE_AT.toISOString()).toBe("2026-08-31T15:10:00.000Z");
  });
});

describe("buildMonthlyCostReport", () => {
  it("aggregates by loop/tier/provider and flags loops under the cache-hit threshold", async () => {
    const report = await buildMonthlyCostReport(pool, AUG.start, AUG.end);
    expect(report.month).toBe("2026-08");
    expect(report.totalCostUsd).toBeCloseTo(0.13, 5);
    const draft = report.rows.find((r) => r.loop === "draft");
    expect(draft?.cache_hit_ratio).toBeCloseTo(0.5, 5);
    expect(report.lowCacheHitLoops).toContain("note_route");
    expect(report.lowCacheHitLoops).not.toContain("draft");
    expect(LOW_CACHE_HIT_RATIO).toBe(0.4);
  });
});

describe("cost_report_monthly job", () => {
  it("registers with the monthly cron and merges the report into the prior day's nightly digest", async () => {
    const scheduler: Scheduler = createScheduler({
      pool,
      events,
      logger: createLogger("@omnis/kernel"),
      tickMs: 50,
      now: () => FIRE_AT,
    });
    registerCostReportJob(scheduler, { pool, events, now: () => FIRE_AT });
    await scheduler.start();

    const job = await one<{ schedule: string }>(pool, "SELECT schedule FROM jobs WHERE name = $1", [
      COST_REPORT_JOB_NAME,
    ]);
    expect(job.schedule).toBe(COST_REPORT_CRON);

    await query(pool, `UPDATE jobs SET next_run_at = now() - interval '1 minute' WHERE name = $1`, [
      COST_REPORT_JOB_NAME,
    ]);
    await new Promise((r) => setTimeout(r, 400));
    await scheduler.stop();

    const digest = await one<{ body: string; metrics: Record<string, unknown> }>(
      pool,
      "SELECT body, metrics FROM digests WHERE kind = 'nightly' AND for_date = '2026-08-31'",
    );
    expect(digest.body).toBe("existing body"); // merge, not overwrite
    const report = digest.metrics.monthly_report as { month: string; lowCacheHitLoops: string[] };
    expect(report.month).toBe("2026-08");
    expect(report.lowCacheHitLoops).toContain("note_route");

    const ev = await one<{ payload: Record<string, unknown> }>(
      pool,
      `SELECT payload FROM events WHERE kind = 'cost.report_monthly' ORDER BY seq DESC LIMIT 1`,
    );
    expect(ev.payload.month).toBe("2026-08");
  });
});
