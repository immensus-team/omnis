import { createPool, query } from "@omnis/db";
import { afterAll, describe, expect, it } from "vitest";
import { ZeroPublicationError, assertZeroPublication } from "../../src/zero-publication.js";
import { ZERO_ITEM_COLUMNS, ZERO_TABLES } from "../../src/zero-schema.js";

const pool = createPool();
afterAll(() => pool.end());

describe("zero_omnis publication", () => {
  it("covers exactly the tables zeroSchema declares", async () => {
    const rows = await query<{ tablename: string }>(
      pool,
      "SELECT tablename FROM pg_publication_tables WHERE pubname = 'zero_omnis'",
    );
    expect(rows.map((r) => r.tablename).sort()).toEqual([...ZERO_TABLES].sort());
  });

  it("publishes items with the narrowed column list", async () => {
    const rows = await query<{ attnames: string[] }>(
      pool,
      "SELECT attnames::text[] AS attnames FROM pg_publication_tables WHERE pubname = 'zero_omnis' AND tablename = 'items'",
    );
    expect(rows[0]?.attnames.sort()).toEqual([...ZERO_ITEM_COLUMNS].sort());
  });

  it("assertZeroPublication passes against the migrated database", async () => {
    await expect(assertZeroPublication(pool)).resolves.toBeUndefined();
  });

  it("assertZeroPublication throws when a publication is missing", async () => {
    await query(pool, "ALTER PUBLICATION zero_omnis RENAME TO zero_omnis_tmp");
    try {
      await expect(assertZeroPublication(pool)).rejects.toBeInstanceOf(ZeroPublicationError);
    } finally {
      await query(pool, "ALTER PUBLICATION zero_omnis_tmp RENAME TO zero_omnis");
    }
  });
});
