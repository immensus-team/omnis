import { query } from "@omnis/db";
import type { Pool } from "pg";
import type { Audit } from "./audit.js";
import type { Events } from "./events.js";
import type { Logger } from "./logger.js";

export class KillSwitchError extends Error {
  constructor(message = "kill switch is on") {
    super(message);
    this.name = "KillSwitchError";
  }
}

export interface KillSwitch {
  isOn(): Promise<boolean>;
  set(on: boolean, reason: string): Promise<void>;
  assertOff(): Promise<void>;
}

export interface KillSwitchDeps {
  pool: Pool;
  events: Events;
  audit: Audit;
  logger: Logger;
}

interface KillSwitchRow {
  on: boolean;
  since: string | null;
  reason: string | null;
}

/** 허브 GET /kill-switch가 쓰는 읽기 전용 조회. 상태는 audit_log의 최신 row가 전부다(계약 §5). */
export async function killSwitchStatus(pool: Pool): Promise<KillSwitchRow> {
  const rows = await query<{ at: Date; after: { on?: unknown; reason?: unknown } | null }>(
    pool,
    `SELECT at, after FROM audit_log WHERE action = 'kill_switch.set' ORDER BY seq DESC LIMIT 1`,
  );
  const row = rows[0];
  if (row === undefined) {
    return { on: false, since: null, reason: null };
  }
  return {
    on: row.after?.on === true,
    since: row.at.toISOString(),
    reason: typeof row.after?.reason === "string" ? row.after.reason : null,
  };
}

export function createKillSwitch(deps: KillSwitchDeps): KillSwitch {
  const { pool, events, audit, logger } = deps;
  let cached: boolean | null = null;

  // 다른 프로세스가 스위치를 만지면 캐시를 버린다(계약 §5).
  events.subscribe("omnis_control", (p) => {
    cached = p.kill_switch === true;
    logger.warn("kill switch changed elsewhere", { on: cached });
  });

  async function isOn(): Promise<boolean> {
    if (cached !== null) return cached;
    const status = await killSwitchStatus(pool);
    cached = status.on;
    return cached;
  }

  return {
    isOn,
    async set(on, reason) {
      await audit.record({
        actor: "me",
        action: "kill_switch.set",
        target_table: "kill_switch",
        after: { on, reason },
      });
      cached = on;
      await events.emit("durable", "control.kill_switch", { kill_switch: on });
      logger.warn("kill switch set", { on, reason });
    },
    async assertOff() {
      if (await isOn()) throw new KillSwitchError();
    },
  };
}
