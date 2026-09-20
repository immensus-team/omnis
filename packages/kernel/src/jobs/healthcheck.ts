import { one } from "@omnis/db";
import type { Pool } from "pg";
import type { Events } from "../events.js";
import type { Scheduler } from "../scheduler.js";

export const HEALTHCHECK_JOB_NAME = "hub_healthcheck";
export const HEALTHCHECK_CRON = "*/5 * * * *";

/** 스케줄러가 물리는 첫 핸들러(US-A06). DB가 살아 있는지 + 큐가 막히지 않았는지만 본다. */
export function registerHealthcheckJob(
  scheduler: Scheduler,
  deps: { pool: Pool; events: Events },
): void {
  const { pool, events } = deps;
  scheduler.register(HEALTHCHECK_JOB_NAME, HEALTHCHECK_CRON, async () => {
    const row = await one<{ pending: string; due: string }>(
      pool,
      `SELECT (SELECT count(*) FROM pending_approvals WHERE state = 'pending')::text AS pending,
              (SELECT count(*) FROM jobs WHERE enabled AND next_run_at <= now())::text AS due`,
    );
    await events.emit("cold", "hub.health", {
      db: "up",
      pending_approvals: Number(row.pending),
      due_jobs: Number(row.due),
      actor: "system",
      target_table: "jobs",
    });
  });
}
