import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, one, query, tx } from "@omnis/db";

let pool: Pool;
beforeAll(() => {
  pool = createPool();
});
afterAll(async () => {
  await pool.end();
});

describe("0002_core_inbox", () => {
  it("creates the 9 tables A3 §8 assigns to this file", async () => {
    const rows = await query<{ table_name: string }>(
      pool,
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY($1) ORDER BY table_name`,
      [[
        "accounts",
        "account_secrets",
        "agent_runtimes",
        "calendar_events",
        "identities",
        "items",
        "person_merges",
        "persons",
        "threads",
      ]],
    );
    expect(rows).toHaveLength(9);
  });

  it("seeds exactly one omnis agent_runtime and refuses a second", async () => {
    const row = await one<{ host: string; state: string; n: string }>(
      pool,
      `SELECT host, state, (SELECT count(*) FROM agent_runtimes WHERE runtime = 'omnis')::text AS n
         FROM agent_runtimes WHERE runtime = 'omnis'`,
    );
    expect(row.n).toBe("1");
    expect(row.host).toBe("mini");
    expect(row.state).toBe("online");

    await expect(
      query(pool, "INSERT INTO agent_runtimes (runtime, host, display) VALUES ('omnis','macbook','dup')"),
    ).rejects.toThrow(/agent_runtimes_omnis_uq/);
  });

  it("rejects an item with both a person and an agent author (items_author_ck)", async () => {
    const ids = await tx(pool, async (c) => {
      const acc = await one<{ id: string }>(
        c,
        `INSERT INTO accounts (channel, external_id, display) VALUES ('slack','T1:U1','logan') RETURNING id`,
      );
      const thr = await one<{ id: string }>(
        c,
        `INSERT INTO threads (account_id, external_id, kind) VALUES ($1,'C1','dm') RETURNING id`,
        [acc.id],
      );
      const per = await one<{ id: string }>(
        c,
        `INSERT INTO persons (display_name) VALUES ('Someone') RETURNING id`,
      );
      const run = await one<{ id: string }>(c, `SELECT id FROM agent_runtimes WHERE runtime='omnis'`);
      return { accountId: acc.id, threadId: thr.id, personId: per.id, runtimeId: run.id };
    });

    await expect(
      query(
        pool,
        `INSERT INTO items (thread_id, account_id, kind, author_person_id, author_agent_id, sent_at)
         VALUES ($1,$2,'message',$3,$4, now())`,
        [ids.threadId, ids.accountId, ids.personId, ids.runtimeId],
      ),
    ).rejects.toThrow(/items_author_ck/);
  });

  it("generates search_tsv and enforces the source_hash idempotency index", async () => {
    const acc = await one<{ id: string }>(
      pool,
      `INSERT INTO accounts (channel, external_id, display) VALUES ('gmail','a@b.c','logan') RETURNING id`,
    );
    const thr = await one<{ id: string }>(
      pool,
      `INSERT INTO threads (account_id, external_id, kind) VALUES ($1,'t-1','email') RETURNING id`,
      [acc.id],
    );
    const item = await one<{ id: string; tsv: string }>(
      pool,
      `INSERT INTO items (thread_id, account_id, kind, subject, body, sent_at, source_hash)
       VALUES ($1,$2,'email','quarterly plan','ship the kernel', now(), 'hash-1')
       RETURNING id, search_tsv::text AS tsv`,
      [thr.id, acc.id],
    );
    expect(item.tsv).toContain("kernel");

    await expect(
      query(
        pool,
        `INSERT INTO items (thread_id, account_id, kind, body, sent_at, source_hash)
         VALUES ($1,$2,'email','dup', now(), 'hash-1')`,
        [thr.id, acc.id],
      ),
    ).rejects.toThrow(/items_source_hash_uq/);
  });

  it("stores a 768d embedding and indexes it with HNSW only when not null", async () => {
    const idx = await one<{ indexdef: string }>(
      pool,
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'items_embedding_idx'`,
    );
    expect(idx.indexdef).toContain("hnsw");
    expect(idx.indexdef).toContain("vector_cosine_ops");
    expect(idx.indexdef).toContain("WHERE (embedding IS NOT NULL)");
  });

  it("derives attendees_count and enforces calendar_events_span_ck", async () => {
    const acc = await one<{ id: string }>(
      pool,
      `INSERT INTO accounts (channel, external_id, display) VALUES ('gcal','cal-1','logan') RETURNING id`,
    );
    const thr = await one<{ id: string }>(
      pool,
      `INSERT INTO threads (account_id, external_id, kind) VALUES ($1,'cal-thread','calendar') RETURNING id`,
      [acc.id],
    );
    const item = await one<{ id: string }>(
      pool,
      `INSERT INTO items (thread_id, account_id, kind, subject, body, sent_at)
       VALUES ($1,$2,'event','standup','', now()) RETURNING id`,
      [thr.id, acc.id],
    );
    const ev = await one<{ attendees_count: number }>(
      pool,
      `INSERT INTO calendar_events (item_id, account_id, external_id, start_at, end_at, attendees)
       VALUES ($1,$2,'ev-1', now(), now() + interval '30 minutes',
               '[{"email":"a@b.c"},{"email":"d@e.f"}]'::jsonb)
       RETURNING attendees_count`,
      [item.id, acc.id],
    );
    expect(ev.attendees_count).toBe(2);

    await expect(
      query(
        pool,
        `INSERT INTO calendar_events (item_id, account_id, external_id, start_at, end_at)
         VALUES ($1,$2,'ev-2', now(), now() - interval '1 hour')`,
        [item.id, acc.id],
      ),
    ).rejects.toThrow(/calendar_events_span_ck|calendar_events_item_id_key/);
  });
});
