// A4 §4.3: this is pure SQL, no LLM. Notifications use the §3.6 "batched" tier.
import { query } from "@omnis/db";
import type { Pool } from "pg";
import type { Logger } from "../logger.js";
import { type Notifier, first80 } from "../notify/batch.js";
import type { Scheduler } from "../scheduler.js";

export const TASK_REMIND_JOB_NAME = "task_remind";
export const TASK_REMIND_CRON = "0 9,14,19 * * *";

export type RemindKind = "due_soon" | "stale" | "undelegated";

export interface RemindGroup {
  kind: RemindKind;
  count: number;
  line: string;
  task_ids: string[];
}

const LINE: Record<RemindKind, (n: number) => string> = {
  due_soon: (n) => `${n} due today`,
  stale: (n) => `${n} untouched for 3 days`,
  undelegated: (n) => `${n} delegated to an agent have not gone out yet`,
};

export async function remindGroups(pool: Pool): Promise<RemindGroup[]> {
  // A4 §4.3's three WHERE clauses unfolded into a CASE — each task lands in one group (due first).
  const rows = await query<{ kind: RemindKind; count: string; task_ids: string[] }>(
    pool,
    `WITH classified AS (
       SELECT id,
              CASE
                WHEN due_at IS NOT NULL AND due_at < now() + interval '24 hours' THEN 'due_soon'
                WHEN owner_kind = 'agent' AND delegated_session_id IS NULL
                     AND created_at < now() - interval '4 hours' THEN 'undelegated'
                WHEN due_at IS NULL AND created_at < now() - interval '72 hours' THEN 'stale'
                ELSE NULL
              END AS kind
         FROM tasks WHERE state = 'open'
     )
     SELECT kind, count(*)::text AS count, array_agg(id::text) AS task_ids
       FROM classified WHERE kind IS NOT NULL GROUP BY kind`,
  );
  return rows.map((r) => ({
    kind: r.kind,
    count: Number(r.count),
    task_ids: r.task_ids,
    line: LINE[r.kind](Number(r.count)),
  }));
}

export interface TaskRemindDeps {
  pool: Pool;
  logger: Logger;
  notifier: Notifier;
}

export async function runTaskRemind(deps: TaskRemindDeps): Promise<number> {
  const groups = await remindGroups(deps.pool);
  for (const g of groups) {
    await deps.notifier.send(
      { kind: "draft", title: "omnis", body: first80(g.line), deep_link: "omnis://tasks" },
      "batched",
    );
  }
  deps.logger.info("task remind sent", { groups: groups.length });
  return groups.length;
}

export function registerTaskRemindJob(scheduler: Scheduler, deps: TaskRemindDeps): void {
  scheduler.register(TASK_REMIND_JOB_NAME, TASK_REMIND_CRON, async () => {
    await runTaskRemind(deps);
  });
}
