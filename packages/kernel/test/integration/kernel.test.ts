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
    await kernel.ingest.sink(accountId, item("m-1", "first message"));
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
    expect(row.body).toBe("first message");
    expect(row.status).toBe("received");
    expect(row.author_person_id).toBeNull();
    expect(row.author_is_me).toBe(false);
    expect(row.thread_kind).toBe("dm");
  });

  it("is idempotent on source_hash and bumps threads.last_item_at", async () => {
    await kernel.ingest.sink(accountId, item("m-1", "first message"));
    const count = await one<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM items WHERE account_id=$1 AND source_hash='hash-m-1'`,
      [accountId],
    );
    expect(count.n).toBe("1");

    await kernel.ingest.sink(accountId, item("m-2", "second one"));
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

  it("lazily creates the thread when a first-sight item has no threadMeta (root fix)", async () => {
    const sentAt = new Date().toISOString();
    await kernel.ingest.sink(accountId, {
      threadExternalId: "C-lazy",
      externalId: "m-lazy-1",
      kind: "message",
      author: { kind: "person", id: "U-lazy" },
      body: "no threadMeta on first sight",
      attachments: [],
      sentAt,
      status: "received",
      sourceHash: "hash-m-lazy-1",
    });
    const thread = await one<{ kind: string; title: string | null; last_item_at: Date }>(
      pool,
      "SELECT kind, title, last_item_at FROM threads WHERE account_id = $1 AND external_id = 'C-lazy'",
      [accountId],
    );
    expect(thread.kind).toBe("group");
    // NormalizedItem carries neither a subject nor a channel name — the title is synthesized
    // from the participants (the author).
    expect(thread.title).toBe("U-lazy");

    // idempotent on a second item to the same lazily created thread: reuses it,
    // doesn't re-throw, and bumps last_item_at.
    const laterSentAt = new Date(Date.now() + 1000).toISOString();
    await kernel.ingest.sink(accountId, {
      threadExternalId: "C-lazy",
      externalId: "m-lazy-2",
      kind: "message",
      author: { kind: "person", id: "U-lazy" },
      body: "second item, same thread",
      attachments: [],
      sentAt: laterSentAt,
      status: "received",
      sourceHash: "hash-m-lazy-2",
    });
    const threadCount = await one<{ n: string }>(
      pool,
      "SELECT count(*)::text AS n FROM threads WHERE account_id = $1 AND external_id = 'C-lazy'",
      [accountId],
    );
    expect(threadCount.n).toBe("1");
    const updated = await one<{ last_item_at: Date }>(
      pool,
      "SELECT last_item_at FROM threads WHERE account_id = $1 AND external_id = 'C-lazy'",
      [accountId],
    );
    expect(updated.last_item_at.getTime()).toBe(new Date(laterSentAt).getTime());
  });

  // The adapter now puts threadMeta on *every* item — if the upsert assigned unconditionally,
  // one message with no title would blank the name, a reply title would rename the thread,
  // and a new message would resurrect a thread the user archived.
  it("never lets a later item rename, blank, or un-archive an existing thread", async () => {
    const meta = (
      title: string | null,
      archivedAt: string | null,
    ): NormalizedItem["threadMeta"] => ({
      externalId: "C-keep",
      kind: "group",
      title,
      participants: [],
      lastItemAt: new Date().toISOString(),
      archivedAt,
    });
    const send = async (
      externalId: string,
      title: string | null,
      archivedAt: string | null,
    ): Promise<void> => {
      await kernel.ingest.sink(accountId, {
        threadExternalId: "C-keep",
        externalId,
        kind: "message",
        author: { kind: "person", id: "U-keep" },
        body: externalId,
        attachments: [],
        sentAt: new Date().toISOString(),
        status: "received",
        sourceHash: `hash-${externalId}`,
        threadMeta: meta(title, archivedAt),
      });
    };
    const read = async (): Promise<{ title: string | null; archived_at: Date | null }> =>
      one(
        pool,
        "SELECT title, archived_at FROM threads WHERE account_id = $1 AND external_id = 'C-keep'",
        [accountId],
      );

    await send("m-keep-1", "#omnis-launch", null);
    await send("m-keep-2", null, null); // a message with no title
    expect((await read()).title).toBe("#omnis-launch");

    await send("m-keep-3", "Re: #omnis-launch", null); // a reply title
    expect((await read()).title).toBe("#omnis-launch");

    const archivedAt = new Date().toISOString();
    await send("m-keep-4", null, archivedAt);
    expect((await read()).archived_at).not.toBeNull();
    await send("m-keep-5", null, null); // new message after archiving — must not resurrect it
    expect((await read()).archived_at).not.toBeNull();
  });
});

// US-C09: a LinkedIn notification email is a "new message arrived" ping whose body is only the
// preview, so the hub marks its item `meta.partial`. NormalizedItem has no meta field, so the marker
// rides the item's own INSERT: no follow-up UPDATE means no window where the row reads as a full
// message, and no new column.
describe("ingest.sink itemMeta", () => {
  const marked = (externalId: string): NormalizedItem => ({
    threadExternalId: "C-li",
    externalId,
    kind: "message",
    author: { kind: "person", id: "https://www.linkedin.com/in/dana-lee-8b1c2" },
    body: "preview only",
    attachments: [],
    sentAt: new Date().toISOString(),
    status: "received",
    sourceHash: `hash-${externalId}`,
    threadMeta: {
      externalId: "C-li",
      kind: "dm",
      title: "Dana Lee",
      participants: [],
      lastItemAt: new Date().toISOString(),
      archivedAt: null,
    },
  });

  it("writes meta in the same statement, and leaves other items at the column default", async () => {
    const withMeta = createKernel({
      pool,
      itemMeta: (e) => (e.externalId.startsWith("li-email:") ? { partial: true } : undefined),
    });
    const acc = await one<{ id: string }>(
      pool,
      `INSERT INTO accounts (channel, external_id, display) VALUES ('linkedin','logan','Logan')
       ON CONFLICT (channel, external_id) DO UPDATE SET display = EXCLUDED.display RETURNING id`,
    );
    const metaOf = async (externalId: string): Promise<Record<string, unknown>> =>
      (
        await one<{ meta: Record<string, unknown> }>(
          pool,
          "SELECT meta FROM items WHERE account_id = $1 AND external_id = $2",
          [acc.id, externalId],
        )
      ).meta;

    await withMeta.ingest.sink(acc.id, marked("li-email:m-li-1"));
    expect(await metaOf("li-email:m-li-1")).toEqual({ partial: true });

    await withMeta.ingest.sink(acc.id, marked("m-full-1"));
    expect(await metaOf("m-full-1")).toEqual({});

    await withMeta.close();
  });
});
