import {
  type Audit,
  type Events,
  type Logger,
  type Scheduler,
  registerCostDailyJob,
  registerCostReportJob,
  registerHealthcheckJob,
} from "@omnis/kernel";
import type { Pool } from "pg";
import type { BridgeHub } from "./bridge.js";
import {
  TERMINAL_IMPORT_CRON,
  TERMINAL_IMPORT_JOB_NAME,
  runTerminalImport,
} from "./terminal-import.js";

export interface StartupJobDeps {
  pool: Pool;
  events: Events;
  audit: Audit;
  logger: Logger;
}

/** The scheduler jobs this process owns at boot. Split out of `startHub` so a fake scheduler can
 *  assert the registration set without a database (the handlers only run on a scheduler tick). */
export function registerStartupJobs(scheduler: Scheduler, deps: StartupJobDeps): void {
  registerHealthcheckJob(scheduler, { pool: deps.pool, events: deps.events });
  registerCostDailyJob(scheduler, { pool: deps.pool, audit: deps.audit, logger: deps.logger });
  // US-B44 (W4a): monthly cost report → digests.metrics. Registered here, not in startHub, so the
  // set stays in one place as Phase B adds jobs.
  registerCostReportJob(scheduler, { pool: deps.pool, events: deps.events });
}

export interface TerminalImportJobDeps {
  pool: Pool;
  bridge: Pick<BridgeHub, "call" | "hosts">;
  logger: Logger;
}

/** US-C16: `import.terminal_sessions`'s pull job, in this file so the hub's job set stays in one
 *  place. Not part of `registerStartupJobs` because it needs the bridge, which `startHub` builds
 *  after the scheduler starts — so it is registered from there, in the ingest jobs' slot.
 *  Every tick is a no-op until the flag is on (`runTerminalImport` reads it first). */
export function registerTerminalImportJob(scheduler: Scheduler, deps: TerminalImportJobDeps): void {
  scheduler.register(TERMINAL_IMPORT_JOB_NAME, TERMINAL_IMPORT_CRON, async () => {
    await runTerminalImport(deps);
  });
}
