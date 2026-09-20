import { createPool, one } from "@omnis/db";
import { type Kernel, createKernel } from "@omnis/kernel";
import type { NormalizedItem } from "@omnis/protocol";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let pool: Pool;
let kernel: Kernel;
let accountId = "";

beforeAll(async () => {
  pool = createPool();
  kernel = createKernel({ pool });
  const acc = await one<{ id: string }>(
    pool,
    `INSERT INTO accounts (channel, external_id, display) VALUES ('slack','T-ing:U','ing') RETURNING id`,
  );
  accountId = acc.id;
});
afterAll(async () => {
  await kernel.close();
  await pool.end();
});

describe("createKernel", () => {
  it("exposes exactly the contract's surface", () => {
    expect(Object.keys(kernel).sort()).toEqual([
      "approvals",
      "audit",
      "close",
      "events",
      "ingest",
      "killSwitch",
      "scheduler",
    ]);
    expect(typeof kernel.ingest.sink).toBe("function");
  });
});

describe("ingest.sink", () => {
  const item = (externalId: string, body: string): NormalizedItem => ({
    threadExternalId: "C-ing",
    externalId,
    kind: "message",
    author: { kind: "person", id: "U-mina" },
    body,
    attachments: [],
    sentAt: new Date().toISOString(),
    status: "received",
    sourceHash: `hash-${externalId}`,
    threadMeta: {
      externalId: "C-ing",
      kind: "dm",
      title: "Mina",
      participants: [{ externalId: "U-mina", displayName: "Mina" }],
      lastItemAt: new Date().toISOString(),
      archivedAt: null,
    },
  });

  it("upserts the thread and the item, leaving author resolution to Phase B", async () => {
    await kernel.ingest.sink(accountId, item("m-1", "첫 메시지"));
    const row = await one<{
      body: string;
      status: string;
      author_person_id: string | null;
      author_is_me: boolean;
      thread_kind: string;
    }>(
      pool,
      `SELECT i.body, i.status, i.author_person_id, i.author_is_me, t.kind AS thread_kind
         FROM items i JOIN threads t ON t.id = i.thread_id
        WHERE i.account_id = $1 AND i.external_id = 'm-1'`,
      [accountId],
    );
    expect(row.body).toBe("첫 메시지");
    expect(row.status).toBe("received");
    expect(row.author_person_id).toBeNull();
    expect(row.author_is_me).toBe(false);
    expect(row.thread_kind).toBe("dm");
  });

  it("is idempotent on source_hash and bumps threads.last_item_at", async () => {
    await kernel.ingest.sink(accountId, item("m-1", "첫 메시지"));
    const count = await one<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM items WHERE account_id=$1 AND source_hash='hash-m-1'`,
      [accountId],
    );
    expect(count.n).toBe("1");

    await kernel.ingest.sink(accountId, item("m-2", "두 번째"));
    const thread = await one<{ last_item_at: Date }>(
      pool,
      `SELECT last_item_at FROM threads WHERE account_id=$1 AND external_id='C-ing'`,
      [accountId],
    );
    expect(thread.last_item_at).toBeInstanceOf(Date);
  });

  it("writes an AdapterEvent to the cold tier instead of items", async () => {
    await kernel.ingest.sink(accountId, {
      kind: "rate_limited",
      retryAfterMs: 30_000,
      endpoint: "conversations.history",
      at: new Date().toISOString(),
    });
    const ev = await one<{ payload: Record<string, unknown> }>(
      pool,
      `SELECT payload FROM events WHERE kind = 'adapter.rate_limited' ORDER BY seq DESC LIMIT 1`,
    );
    expect(ev.payload.endpoint).toBe("conversations.history");
  });

  it("refuses an item for an unknown thread with no threadMeta", async () => {
    await expect(
      kernel.ingest.sink(accountId, {
        threadExternalId: "C-never",
        externalId: "m-x",
        kind: "message",
        author: { kind: "person", id: "U" },
        body: "orphan",
        attachments: [],
        sentAt: new Date().toISOString(),
        status: "received",
        sourceHash: "hash-m-x",
      }),
    ).rejects.toThrow(/unknown thread/);
  });
});
