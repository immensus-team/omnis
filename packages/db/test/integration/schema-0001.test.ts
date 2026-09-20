import { createPool, query } from "@omnis/db";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let pool: Pool;
beforeAll(() => {
  pool = createPool();
});
afterAll(async () => {
  await pool.end();
});

describe("0001_extensions", () => {
  it("installs pgcrypto, vector and pg_trgm", async () => {
    const rows = await query<{ extname: string }>(
      pool,
      "SELECT extname FROM pg_extension WHERE extname = ANY($1) ORDER BY extname",
      [["pgcrypto", "pg_trgm", "vector"]],
    );
    expect(rows.map((r) => r.extname)).toEqual(["pg_trgm", "pgcrypto", "vector"]);
  });

  it("creates the three omnis roles and marks omnis_sync as a replication role", async () => {
    const rows = await query<{ rolname: string; rolreplication: boolean }>(
      pool,
      "SELECT rolname, rolreplication FROM pg_roles WHERE rolname LIKE 'omnis_%' ORDER BY rolname",
    );
    expect(rows.map((r) => r.rolname)).toEqual(["omnis_hub", "omnis_owner", "omnis_sync"]);
    expect(rows.find((r) => r.rolname === "omnis_sync")?.rolreplication).toBe(true);
  });

  it("gives gen_random_uuid() from pgcrypto", async () => {
    const rows = await query<{ id: string }>(pool, "SELECT gen_random_uuid()::text AS id");
    expect(rows[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
