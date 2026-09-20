import { query } from "@omnis/db";
import type { Pool } from "pg";
import { SEOUL_OFFSET_MS } from "../cron.js";
import type { Events } from "../events.js";
import type { Scheduler } from "../scheduler.js";

export const COST_REPORT_JOB_NAME = "cost_report_monthly";
export const COST_REPORT_CRON = "10 0 1 * *";
/** A4 §12.4 / backlog exit criteria: draft-loop cache hit ratio target is >=40%.
 *  This job only flags loops under that ratio; it does not enforce anything. */
export const LOW_CACHE_HIT_RATIO = 0.4;

export interface CostReportRow {
  loop: string;
  model_tier: string;
  provider: string;
  runs: number;
  tokens_in: number;
  tokens_out: number;
  tokens_cached: number;
  cost_usd: number;
  cache_hit_ratio: number;
}

export interface MonthlyCostReport {
  month: string; // "YYYY-MM"
  totalCostUsd: number;
  rows: CostReportRow[];
  lowCacheHitLoops: string[];
}

/** Aggregates agent_runs over the half-open interval [monthStart, monthEnd) by loop/tier/provider.
 *  `month` is the Asia/Seoul calendar month monthStart falls in — the whole system (cron, Postgres)
 *  runs on that calendar, and a KST month boundary is 15:00 UTC on the previous day. */
export async function buildMonthlyCostReport(
  pool: Pool,
  monthStart: Date,
  monthEnd: Date,
): Promise<MonthlyCostReport> {
  const rows = await query<{
    loop: string;
    model_tier: string;
    provider: string;
    runs: string;
    tokens_in: string;
    tokens_out: string;
    tokens_cached: string;
    cost_usd: string;
  }>(
    pool,
    `SELECT loop, model_tier, provider,
            count(*)::text AS runs,
            coalesce(sum(tokens_in), 0)::text AS tokens_in,
            coalesce(sum(tokens_out), 0)::text AS tokens_out,
            coalesce(sum(tokens_cached), 0)::text AS tokens_cached,
            coalesce(sum(cost_usd), 0)::text AS cost_usd
       FROM agent_runs
      WHERE created_at >= $1 AND created_at < $2
      GROUP BY loop, model_tier, provider
      ORDER BY loop, model_tier, provider`,
    [monthStart, monthEnd],
  );

  const reportRows: CostReportRow[] = rows.map((r) => {
    const tokensIn = Number(r.tokens_in);
    const tokensCached = Number(r.tokens_cached);
    return {
      loop: r.loop,
      model_tier: r.model_tier,
      provider: r.provider,
      runs: Number(r.runs),
      tokens_in: tokensIn,
      tokens_out: Number(r.tokens_out),
      tokens_cached: tokensCached,
      cost_usd: Number(r.cost_usd),
      cache_hit_ratio: tokensIn > 0 ? tokensCached / tokensIn : 0,
    };
  });

  const byLoop = new Map<string, { in: number; cached: number }>();
  for (const r of reportRows) {
    const acc = byLoop.get(r.loop) ?? { in: 0, cached: 0 };
    acc.in += r.tokens_in;
    acc.cached += r.tokens_cached;
    byLoop.set(r.loop, acc);
  }
  const lowCacheHitLoops = [...byLoop.entries()]
    .filter(([, v]) => v.in > 0 && v.cached / v.in < LOW_CACHE_HIT_RATIO)
    .map(([loop]) => loop);

  return {
    month: new Date(monthStart.getTime() + SEOUL_OFFSET_MS).toISOString().slice(0, 7),
    totalCostUsd: reportRows.reduce((s, r) => s + r.cost_usd, 0),
    rows: reportRows,
    lowCacheHitLoops,
  };
}

/** Merges into the nightly digest row that another job (out of scope here) already created for
 *  that date — only `metrics` is touched, `body` is left alone.
 *  `forDate` is read as a UTC-midnight instant naming the KST calendar date of the digest row.
 *  ponytail: if the nightly digest row doesn't exist yet (e.g. that job hasn't run), this still
 *  creates one with an empty body so the metrics aren't lost — the nightly digest job can fill
 *  in the body later on its own schedule (metrics merges via jsonb `||`, so it's safe). No cap on
 *  this path; upgrade point: once digests.kind gets a 'monthly' value, give this its own row instead. */
export async function attachReportToDigest(
  pool: Pool,
  report: MonthlyCostReport,
  forDate: Date,
): Promise<void> {
  const forDateStr = forDate.toISOString().slice(0, 10);
  await query(
    pool,
    `INSERT INTO digests (kind, for_date, body, metrics)
       VALUES ('nightly', $1, '', jsonb_build_object('monthly_report', $2::jsonb))
       ON CONFLICT (kind, for_date) DO UPDATE
         SET metrics = digests.metrics || jsonb_build_object('monthly_report', $2::jsonb)`,
    [forDateStr, JSON.stringify(report)],
  );
}

/** US-B44: on the 1st of each month at 00:10 KST, aggregates last month's agent_runs and attaches
 *  the report to the previous day's (= last month's last day) nightly digest. That digest row was
 *  already created the night before by the nightly_digest job (US-B24, 23:00 KST, out of scope here). */
export function registerCostReportJob(
  scheduler: Scheduler,
  deps: { pool: Pool; events: Events; now?: () => Date },
): void {
  const { pool, events } = deps;
  const now = deps.now ?? ((): Date => new Date());
  scheduler.register(COST_REPORT_JOB_NAME, COST_REPORT_CRON, async () => {
    // cron.ts evaluates the schedule on the Asia/Seoul calendar, so this handler fires at 15:10 UTC
    // on the LAST day of the month it reports on — reading UTC calendar fields off `now()` would
    // land a month early on every single run. Shift into KST before touching the calendar, and back
    // out of it when forming the query window.
    const kstNow = new Date(now().getTime() + SEOUL_OFFSET_MS);
    const kstMonthStart = Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth() - 1, 1);
    const kstMonthEnd = Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), 1);
    const monthStart = new Date(kstMonthStart - SEOUL_OFFSET_MS);
    const monthEnd = new Date(kstMonthEnd - SEOUL_OFFSET_MS);
    const forDate = new Date(kstMonthEnd - 86_400_000); // last KST day of the reported month

    const report = await buildMonthlyCostReport(pool, monthStart, monthEnd);
    await attachReportToDigest(pool, report, forDate);

    await events.emit("cold", "cost.report_monthly", {
      month: report.month,
      total_cost_usd: report.totalCostUsd,
      low_cache_hit_loops: report.lowCacheHitLoops,
      actor: "system",
      target_table: "digests",
    });
  });
}
