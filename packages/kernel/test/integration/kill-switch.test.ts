import { createPool, one, query } from "@omnis/db";
import {
  type Events,
  type KillSwitch,
  KillSwitchError,
  createAudit,
  createEvents,
  createKillSwitch,
  createLogger,
  killSwitchStatus,
} from "@omnis/kernel";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let pool: Pool;
let eventsA: Events & { close(): Promise<void> };
let eventsB: Events & { close(): Promise<void> };
let a: KillSwitch;
let b: KillSwitch;
const logger = createLogger("@omnis/kernel");

beforeAll(async () => {
  pool = createPool();
  const audit = createAudit(pool);
  eventsA = createEvents({ pool, logger });
  eventsB = createEvents({ pool, logger });
  a = createKillSwitch({ pool, events: eventsA, audit, logger });
  b = createKillSwitch({ pool, events: eventsB, audit, logger });
  await new Promise((r) => setTimeout(r, 300)); // time for LISTEN to take effect
});
beforeEach(async () => {
  await a.set(false, "test reset");
  await new Promise((r) => setTimeout(r, 150));
});
afterAll(async () => {
  await eventsA.close();
  await eventsB.close();
  await pool.end();
});

describe("kill switch", () => {
  it("starts off and reads its state from the newest audit_log row", async () => {
    expect(await a.isOn()).toBe(false);
    await a.set(true, "suspected injection — stop everything");
    expect(await a.isOn()).toBe(true);

    const row = await one<{ actor: string; after: { on: boolean; reason: string } }>(
      pool,
      `SELECT actor, after FROM audit_log WHERE action = 'kill_switch.set' ORDER BY seq DESC LIMIT 1`,
    );
    expect(row.actor).toBe("me");
    expect(row.after.on).toBe(true);
    expect(row.after.reason).toContain("injection");
  });

  it("creates no table of its own", async () => {
    const rows = await query<{ table_name: string }>(
      pool,
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name LIKE '%kill%'`,
    );
    expect(rows).toEqual([]);
  });

  it("invalidates the other process's cache through omnis_control", async () => {
    expect(await b.isOn()).toBe(false); // populates b's cache
    await a.set(true, "from process A");
    await new Promise((r) => setTimeout(r, 400));
    expect(await b.isOn()).toBe(true);
  });

  it("reports since and reason for the hub route", async () => {
    await a.set(true, "under maintenance");
    const status = await killSwitchStatus(pool);
    expect(status.on).toBe(true);
    expect(status.reason).toBe("under maintenance");
    expect(status.since).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    await a.set(false, "maintenance done");
    const off = await killSwitchStatus(pool);
    expect(off.on).toBe(false);
    expect(off.reason).toBe("maintenance done");
  });

  it("keeps the whole history because audit_log is append-only", async () => {
    await a.set(true, "one");
    await a.set(false, "two");
    const rows = await query<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM audit_log WHERE action = 'kill_switch.set'`,
    );
    expect(Number(rows[0]?.n ?? "0")).toBeGreaterThanOrEqual(3);
  });
});

describe("assertOff", () => {
  it("throws KillSwitchError while on and stays silent while off", async () => {
    await expect(a.assertOff()).resolves.toBeUndefined();
    await a.set(true, "stop");
    await expect(a.assertOff()).rejects.toThrow(KillSwitchError);
    await expect(a.assertOff()).rejects.toThrow(/kill switch is on/);
  });
});
