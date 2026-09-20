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

describe("0008_publication", () => {
  it("publishes exactly the 17 whitelisted tables (0008의 16 + 0013의 settings)", async () => {
    const rows = await query<{ tablename: string }>(
      pool,
      `SELECT tablename FROM pg_publication_tables WHERE pubname = 'zero_omnis' ORDER BY tablename`,
    );
    expect(rows.map((r) => r.tablename)).toEqual([
      "accounts",
      "agent_runtimes",
      "agent_sessions",
      "calendar_events",
      "digests",
      "identities",
      "item_labels",
      "items",
      "label_rules",
      "labels",
      "notes",
      "pending_approvals",
      "persons",
      "settings",
      "tasks",
      "thread_labels",
      "threads",
    ]);
  });

  it("excludes the tables A3 §7 says must never reach the phone", async () => {
    const rows = await query<{ tablename: string }>(
      pool,
      `SELECT tablename FROM pg_publication_tables
        WHERE pubname = 'zero_omnis' AND tablename = ANY($1)`,
      [
        [
          "account_secrets",
          "agent_runs",
          "audit_log",
          "entities",
          "events",
          "jobs",
          "memories",
          "person_merges",
          "relations",
        ],
      ],
    );
    expect(rows).toEqual([]);
  });

  it("narrows items to the 24 columns in A3 §7 (no embedding, no search_tsv)", async () => {
    // ponytail: attnames is name[] (OID 1003); pg-types@2.2.0 has no default array
    // parser for it, so it comes back as a raw "{a,b,c}" string. Cast to text[]
    // (OID 1009, which pg-types does parse) instead of hand-rolling a parser.
    const rows = await query<{ attnames: string[] }>(
      pool,
      `SELECT attnames::text[] AS attnames FROM pg_publication_tables WHERE pubname='zero_omnis' AND tablename='items'`,
    );
    const cols = rows[0]?.attnames ?? [];
    expect(cols).toHaveLength(24);
    expect(cols).toContain("sensitivity");
    expect(cols).toContain("meta");
    expect(cols).not.toContain("embedding");
    expect(cols).not.toContain("search_tsv");
  });

  it("narrows label_rules so probe_embedding is not replicated", async () => {
    const rows = await query<{ attnames: string[] }>(
      pool,
      `SELECT attnames::text[] AS attnames FROM pg_publication_tables WHERE pubname='zero_omnis' AND tablename='label_rules'`,
    );
    const cols = rows[0]?.attnames ?? [];
    expect(cols).toContain("prompt");
    expect(cols).toContain("active");
    expect(cols).not.toContain("probe_embedding");
  });
});
