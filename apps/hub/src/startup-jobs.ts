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
