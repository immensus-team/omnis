import { query } from "@omnis/db";
import type { Pool } from "pg";
import type { Logger } from "../logger.js";
import type { Scheduler } from "../scheduler.js";

export const GMAIL_REWATCH_JOB_NAME = "gmail_rewatch";
export const GMAIL_REWATCH_CRON = "0 3 * * *"; // 0006 seed — watch TTL 7d, daily(A1 §2.2)
export const GRAPH_SUB_RENEW_JOB_NAME = "graph_sub_renew";
export const GRAPH_SUB_RENEW_CRON = "0 4 * * 1"; // 0006 seed — sub TTL 10080m, weekly(A1 §2.4)

export type RewatchFn = (accountExternalId: string) => Promise<void>;

export interface RewatchDeps {
  pool: Pool;
  logger: Logger;
  // undefined when this host has no adapter for that channel — the job then skips as ok.
  rewatch?: RewatchFn;
}

async function runForChannel(deps: RewatchDeps, channel: string): Promise<void> {
  if (deps.rewatch === undefined) return;
  const rows = await query<{ external_id: string }>(
    deps.pool,
    `SELECT external_id FROM accounts WHERE channel = $1 AND state <> 'paused'`,
    [channel],
  );
  for (const row of rows) {
    try {
      await deps.rewatch(row.external_id);
    } catch (e) {
      deps.logger.error(`${channel} rewatch failed`, {
        account: row.external_id,
        err: e instanceof Error ? e.message : String(e),
      });
    }
  }
}

export function registerGmailRewatchJob(scheduler: Scheduler, deps: RewatchDeps): void {
  scheduler.register(GMAIL_REWATCH_JOB_NAME, GMAIL_REWATCH_CRON, () =>
    runForChannel(deps, "gmail"),
  );
}

export function registerGraphSubRenewJob(scheduler: Scheduler, deps: RewatchDeps): void {
  scheduler.register(GRAPH_SUB_RENEW_JOB_NAME, GRAPH_SUB_RENEW_CRON, () =>
    runForChannel(deps, "outlook"),
  );
}
