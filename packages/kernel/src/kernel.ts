import type { IngestSink } from "@omnis/protocol";
import type { Pool } from "pg";
import { type Approvals, createApprovals } from "./approvals.js";
import { type Audit, createAudit } from "./audit.js";
import { type Events, createEvents } from "./events.js";
import { createIngestSink } from "./ingest.js";
import { type KillSwitch, createKillSwitch } from "./kill-switch.js";
import { type Logger, createLogger } from "./logger.js";
import { type Scheduler, createScheduler } from "./scheduler.js";

export interface KernelDeps {
  pool: Pool;
  now?: () => Date;
  logger?: Logger;
}

export interface Kernel {
  events: Events;
  scheduler: Scheduler;
  approvals: Approvals;
  killSwitch: KillSwitch;
  audit: Audit;
  ingest: { sink: IngestSink };
  close(): Promise<void>;
}

export function createKernel(deps: KernelDeps): Kernel {
  const { pool } = deps;
  const logger = deps.logger ?? createLogger("@omnis/kernel");
  const now = deps.now ?? ((): Date => new Date());

  const events = createEvents({ pool, logger });
  const audit = createAudit(pool);
  const killSwitch = createKillSwitch({ pool, events, audit, logger });
  const approvals = createApprovals({ pool, logger, now, audit });
  const scheduler = createScheduler({
    pool,
    events,
    logger,
    now,
    isKillSwitchOn: () => killSwitch.isOn(),
  });

  return {
    events,
    scheduler,
    approvals,
    killSwitch,
    audit,
    ingest: { sink: createIngestSink({ pool, logger }) },
    async close() {
      await scheduler.stop();
      await events.close();
    },
  };
}
