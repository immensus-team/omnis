import { createPool, one, query } from "@omnis/db";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { asOf, assertRelation, invalidateEntity, upsertEntity } from "../../src/entities.js";

let pool: Pool;

beforeAll(() => {
  pool = createPool();
});
afterAll(async () => {
  await pool.end();
});
afterEach(async () => {
  await query(pool, "DELETE FROM relations");
  await query(pool, "DELETE FROM entities");
});

const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-06-01T00:00:00.000Z";

describe("upsertEntity", () => {
  it("creates one live row with the four timestamps", async () => {
    const id = await upsertEntity(pool, {
      type: "org",
      name: "Davich Optical",
      attributes: { industry: "retail" },
      valid_from: T1,
    });
    const row = await one<{
      type: string;
      name: string;
      attributes: Record<string, unknown>;
      valid_from: Date;
      valid_until: Date | null;
      recorded_at: Date;
      invalidated_at: Date | null;
    }>(pool, "SELECT * FROM entities WHERE id = $1", [id]);
    expect(row.type).toBe("org");
    expect(row.attributes.industry).toBe("retail");
    expect(row.valid_from.toISOString()).toBe(T1);
    expect(row.valid_until).toBeNull();
    expect(row.invalidated_at).toBeNull();
    expect(row.recorded_at).toBeInstanceOf(Date);
  });

  it("returns the same id when nothing changed", async () => {
    const e = { type: "project", name: "omnis", valid_from: T1 } as const;
    expect(await upsertEntity(pool, e)).toBe(await upsertEntity(pool, e));
    expect(await query(pool, "SELECT id FROM entities")).toHaveLength(1);
  });

  // entities_live_uq is on (type, lower(name)). A new fact has to be a new row, and for that
  // the old row must be invalidated first in the same transaction.
  it("invalidates the previous live row and inserts a new one when attributes change", async () => {
    const first = await upsertEntity(pool, {
      type: "person",
      name: "Jinho Kim",
      attributes: { title: "team lead" },
      valid_from: T1,
    });
    const second = await upsertEntity(pool, {
      type: "person",
      name: "Jinho Kim",
      attributes: { title: "director" },
      valid_from: T2,
    });
    expect(second).not.toBe(first);

    const rows = await query<{ id: string; invalidated_at: Date | null }>(
      pool,
      "SELECT id, invalidated_at FROM entities ORDER BY recorded_at",
    );
    expect(rows).toHaveLength(2); // old facts are not deleted
    expect(rows[0]?.invalidated_at).toBeInstanceOf(Date);
    expect(rows[1]?.invalidated_at).toBeNull();
  });

  it("matches case-insensitively, the way the live unique index does", async () => {
    const a = await upsertEntity(pool, { type: "org", name: "Onward Lab", valid_from: T1 });
    const b = await upsertEntity(pool, { type: "org", name: "onward lab", valid_from: T1 });
    expect(b).toBe(a);
  });

  it("refuses a write with no valid_from (4-timestamp guard)", async () => {
    await expect(
      upsertEntity(pool, { type: "org", name: "unsupported", valid_from: "" }),
    ).rejects.toThrow(/valid_from/);
  });
});

describe("assertRelation", () => {
  it("creates the relation once and reuses it", async () => {
    const from = await upsertEntity(pool, { type: "person", name: "Jinho Kim", valid_from: T1 });
    const to = await upsertEntity(pool, { type: "org", name: "onwardlab", valid_from: T1 });
    const r = { from_entity_id: from, to_entity_id: to, type: "works_at", valid_from: T1 } as const;
    expect(await assertRelation(pool, r)).toBe(await assertRelation(pool, r));
    expect(await query(pool, "SELECT id FROM relations")).toHaveLength(1);
  });

  it("supersedes the live relation when attributes change", async () => {
    const from = await upsertEntity(pool, { type: "person", name: "Jinho Kim", valid_from: T1 });
    const to = await upsertEntity(pool, { type: "org", name: "onwardlab", valid_from: T1 });
    await assertRelation(pool, {
      from_entity_id: from,
      to_entity_id: to,
      type: "works_at",
      attributes: { role: "team lead" },
      valid_from: T1,
    });
    await assertRelation(pool, {
      from_entity_id: from,
      to_entity_id: to,
      type: "works_at",
      attributes: { role: "director" },
      valid_from: T2,
    });
    const rows = await query<{ invalidated_at: Date | null }>(
      pool,
      "SELECT invalidated_at FROM relations ORDER BY recorded_at",
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.invalidated_at).toBeInstanceOf(Date);
    expect(rows[1]?.invalidated_at).toBeNull();
  });

  it("refuses a relation with no valid_from", async () => {
    const from = await upsertEntity(pool, { type: "person", name: "A", valid_from: T1 });
    const to = await upsertEntity(pool, { type: "person", name: "B", valid_from: T1 });
    await expect(
      assertRelation(pool, {
        from_entity_id: from,
        to_entity_id: to,
        type: "knows",
        valid_from: "",
      }),
    ).rejects.toThrow(/valid_from/);
  });
});

describe("invalidateEntity", () => {
  it("invalidates the entity and every live relation that touches it", async () => {
    const a = await upsertEntity(pool, { type: "person", name: "A", valid_from: T1 });
    const b = await upsertEntity(pool, { type: "org", name: "B", valid_from: T1 });
    await assertRelation(pool, {
      from_entity_id: a,
      to_entity_id: b,
      type: "works_at",
      valid_from: T1,
    });

    await invalidateEntity(pool, b, new Date(T2));

    const entity = await one<{ invalidated_at: Date | null }>(
      pool,
      "SELECT invalidated_at FROM entities WHERE id = $1",
      [b],
    );
    expect(entity.invalidated_at?.toISOString()).toBe(T2);
    const rel = await one<{ invalidated_at: Date | null }>(
      pool,
      "SELECT invalidated_at FROM relations LIMIT 1",
    );
    expect(rel.invalidated_at?.toISOString()).toBe(T2);
  });
});

describe("asOf (A3 §5 three conditions)", () => {
  it("reproduces the past: the old title at T1, the new one at now", async () => {
    await upsertEntity(pool, {
      type: "person",
      name: "Jinho Kim",
      attributes: { title: "team lead" },
      valid_from: T1,
      valid_until: T2,
    });
    await upsertEntity(pool, {
      type: "person",
      name: "Jinho Kim",
      attributes: { title: "director" },
      valid_from: T2,
    });

    const past = await asOf(pool, { at: "2026-03-01T00:00:00.000Z" });
    expect(past).toHaveLength(1);
    expect(past[0]?.attributes?.title).toBe("team lead");

    const now = await asOf(pool, { at: "now" });
    expect(now).toHaveLength(1);
    expect(now[0]?.attributes?.title).toBe("director");
  });

  it("filters by entityId", async () => {
    const a = await upsertEntity(pool, { type: "org", name: "A", valid_from: T1 });
    await upsertEntity(pool, { type: "org", name: "B", valid_from: T1 });
    const rows = await asOf(pool, { entityId: a, at: "now" });
    expect(rows.map((r) => r.name)).toEqual(["A"]);
  });

  it("returns nothing before valid_from", async () => {
    await upsertEntity(pool, { type: "org", name: "future", valid_from: T2 });
    expect(await asOf(pool, { at: T1 })).toEqual([]);
  });
});
