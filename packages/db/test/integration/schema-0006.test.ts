import { createPool, one, query } from "@omnis/db";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let pool: Pool;
beforeAll(() => {
  pool = createPool();
});
afterAll(async () => {
  await pool.end();
});

describe("0006_kernel", () => {
  it("sets omnis.events_retention on the database", async () => {
    const row = await one<{ retention: string | null }>(
      pool,
      `SELECT current_setting('omnis.events_retention', true) AS retention`,
    );
    expect(row.retention).toBe("90 days");
  });

  it("forbids UPDATE and recent DELETE on events (A3-D5)", async () => {
    const ev = await one<{ seq: string }>(
      pool,
      `INSERT INTO events (kind, payload) VALUES ('test.append', '{"a":1}'::jsonb) RETURNING seq::text AS seq`,
    );
    await expect(
      query(pool, `UPDATE events SET kind = 'mutated' WHERE seq = $1`, [ev.seq]),
    ).rejects.toThrow(/append-only: UPDATE on events is forbidden/);
    await expect(query(pool, "DELETE FROM events WHERE seq = $1", [ev.seq])).rejects.toThrow(
      /retention window/,
    );
  });

  it("forbids UPDATE, DELETE and TRUNCATE on audit_log forever", async () => {
    const row = await one<{ seq: string }>(
      pool,
      `INSERT INTO audit_log (actor, action, target_table)
       VALUES ('system','test.audit','events') RETURNING seq::text AS seq`,
    );
    await expect(
      query(pool, `UPDATE audit_log SET action = 'x' WHERE seq = $1`, [row.seq]),
    ).rejects.toThrow(/append-only: UPDATE on audit_log is forbidden/);
    await expect(query(pool, "DELETE FROM audit_log WHERE seq = $1", [row.seq])).rejects.toThrow(
      /append-only: DELETE on audit_log is forbidden/,
    );
    await expect(query(pool, "TRUNCATE audit_log")).rejects.toThrow(
      /append-only: TRUNCATE on audit_log is forbidden/,
    );
  });

  it("rolls off events older than the retention window and audits the result", async () => {
    await query(
      pool,
      `INSERT INTO events (kind, at) VALUES ('old.one', now() - interval '100 days')`,
    );
    const out = await one<{ deleted: string }>(
      pool,
      "SELECT deleted::text AS deleted FROM omnis_events_rolloff()",
    );
    expect(Number(out.deleted)).toBeGreaterThanOrEqual(1);

    const audited = await one<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM audit_log WHERE action = 'events.rolloff'`,
    );
    expect(Number(audited.n)).toBeGreaterThanOrEqual(1);

    const left = await one<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM events WHERE kind = 'old.one'`,
    );
    expect(left.n).toBe("0");
  });

  it("seeds the 16 jobs A3 §6 lists, with the A4-owned schedules", async () => {
    const rows = await query<{ name: string; schedule: string }>(
      pool,
      "SELECT name, schedule FROM jobs ORDER BY name",
    );
    expect(rows).toHaveLength(16);
    const byName = new Map(rows.map((r) => [r.name, r.schedule]));
    expect(byName.get("morning_digest")).toBe("30 6 * * *");
    expect(byName.get("nightly_digest")).toBe("0 23 * * *");
    expect(byName.get("memory_consolidate")).toBe("30 23 * * *");
    expect(byName.get("slot_health")).toBe("*/5 * * * *");
    expect(byName.get("events_rolloff")).toBe("15 4 * * *");
  });

  it("restricts jobs.last_status to ok/failed/skipped", async () => {
    await expect(
      query(pool, `UPDATE jobs SET last_status = 'weird' WHERE name = 'slot_health'`),
    ).rejects.toThrow(/jobs_status_ck/);
  });
});
