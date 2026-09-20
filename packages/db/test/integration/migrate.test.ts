import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MigrationError, createPool, migrate, query } from "@omnis/db";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let pool: Pool;
beforeAll(() => {
  pool = createPool();
});
afterAll(async () => {
  await pool.end();
});

async function fixtureDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "omnis-mig-"));
  for (const [name, body] of Object.entries(files)) {
    await writeFile(join(dir, name), body, "utf8");
  }
  return dir;
}

describe("migrate", () => {
  it("applies files in order, records sha, and is a no-op on the second run", async () => {
    await query(pool, "DROP TABLE IF EXISTS mig_b, mig_a");
    await query(pool, "DELETE FROM _omnis_migrations WHERE name LIKE '9%'").catch(() => undefined);
    const dir = await fixtureDir({
      "9001_a.sql": "CREATE TABLE mig_a (id int PRIMARY KEY);",
      "9002_b.sql": "CREATE TABLE mig_b (id int REFERENCES mig_a(id));",
    });

    const first = await migrate(pool, dir);
    expect(first.applied).toEqual(["9001_a.sql", "9002_b.sql"]);

    const second = await migrate(pool, dir);
    expect(second.applied).toEqual([]);

    const rows = await query<{ name: string; sha: string }>(
      pool,
      "SELECT name, sha FROM _omnis_migrations WHERE name LIKE '9%' ORDER BY name",
    );
    expect(rows.map((r) => r.name)).toEqual(["9001_a.sql", "9002_b.sql"]);
    expect(rows[0]?.sha).toMatch(/^[0-9a-f]{64}$/);
  });

  it("throws MigrationError when an applied file changed", async () => {
    await query(pool, "DROP TABLE IF EXISTS mig_c");
    await query(pool, "DELETE FROM _omnis_migrations WHERE name = '9003_c.sql'");
    const dir = await fixtureDir({ "9003_c.sql": "CREATE TABLE mig_c (id int);" });
    await migrate(pool, dir);

    await writeFile(join(dir, "9003_c.sql"), "CREATE TABLE mig_c (id int, extra text);", "utf8");
    await expect(migrate(pool, dir)).rejects.toThrow(MigrationError);
    await expect(migrate(pool, dir)).rejects.toThrow(/changed after apply/);
  });

  it("rolls the whole file back when one statement fails", async () => {
    await query(pool, "DROP TABLE IF EXISTS mig_d");
    await query(pool, "DELETE FROM _omnis_migrations WHERE name = '9004_d.sql'");
    const dir = await fixtureDir({
      "9004_d.sql": "CREATE TABLE mig_d (id int); SELECT 1/0;",
    });
    await expect(migrate(pool, dir)).rejects.toThrow();

    const left = await query<{ n: string }>(pool, "SELECT to_regclass('public.mig_d')::text AS n");
    expect(left[0]?.n).toBeNull();
  });

  it("runs .noxact.sql outside a transaction", async () => {
    await query(pool, "DROP TABLE IF EXISTS mig_e");
    await query(pool, "DELETE FROM _omnis_migrations WHERE name LIKE '9005%'");
    const dir = await fixtureDir({
      "9005_e.sql": "CREATE TABLE mig_e (id int);",
      "9006_e_idx.noxact.sql": "CREATE INDEX CONCURRENTLY mig_e_idx ON mig_e (id);",
    });
    const out = await migrate(pool, dir);
    expect(out.applied).toEqual(["9005_e.sql", "9006_e_idx.noxact.sql"]);
  });
});
