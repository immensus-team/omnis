import {
  type Audit,
  COST_DAILY_JOB_NAME,
  COST_REPORT_CRON,
  COST_REPORT_JOB_NAME,
  type Events,
  FOLLOWUP_MISS_CRON,
  FOLLOWUP_MISS_JOB_NAME,
  HEALTHCHECK_JOB_NAME,
  type Logger,
  type Scheduler,
} from "@omnis/kernel";
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import type { BridgeHub } from "./bridge.js";
import { registerStartupJobs, registerTerminalImportJob } from "./startup-jobs.js";

const logger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

function fakeScheduler(): { scheduler: Scheduler; registered: [string, string][] } {
  const registered: [string, string][] = [];
  const scheduler: Scheduler = {
    register(name, cron) {
      registered.push([name, cron]);
    },
    async start() {},
    async stop() {},
  };
  return { scheduler, registered };
}

describe("registerStartupJobs", () => {
  it("registers the hub's whole job set — healthcheck, costs, the missed-follow-up metric", () => {
    const { scheduler, registered } = fakeScheduler();
    registerStartupJobs(scheduler, {
      pool: {} as Pool,
      events: {} as Events,
      audit: {} as Audit,
      logger,
    });
    expect(registered).toEqual([
      [HEALTHCHECK_JOB_NAME, "*/5 * * * *"],
      [COST_DAILY_JOB_NAME, "5 0 * * *"],
      [COST_REPORT_JOB_NAME, COST_REPORT_CRON],
      // US-C17: 22:40 KST, before the 23:00 nightly digest loop reads the key this writes.
      [FOLLOWUP_MISS_JOB_NAME, FOLLOWUP_MISS_CRON],
    ]);
  });
});

describe("registerTerminalImportJob", () => {
  it("registers the name and schedule the frozen jobs seed uses (US-C16)", () => {
    const { scheduler, registered } = fakeScheduler();
    registerTerminalImportJob(scheduler, {
      pool: {} as Pool,
      bridge: {} as Pick<BridgeHub, "call" | "hosts">,
      logger,
    });
    // Literal, not the exported constants: the coupling that matters is with the row migration
    // `0015_phase_c.sql` seeded — ('terminal_import', '*/5 * * * *') — and the scheduler only ticks
    // the names it was handed, so a drift here leaves a due row with no handler. The migration is
    // frozen once applied, so this test is the only side that can be changed.
    expect(registered).toEqual([["terminal_import", "*/5 * * * *"]]);
  });
});
