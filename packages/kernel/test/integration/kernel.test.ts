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
    // NormalizedItem에 subject도 채널명도 없다 — 제목은 참가자(작성자)에서 합성된다.
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

  // 어댑터가 이제 *모든* 아이템에 threadMeta를 싣는다 — upsert가 무조건 대입이면
  // 제목 없는 메시지 한 통이 이름을 지우고, 답장 제목이 스레드를 개명하고,
  // 새 메시지가 사용자가 보관한 스레드를 되살린다.
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
    await send("m-keep-2", null, null); // 제목을 모르는 메시지
    expect((await read()).title).toBe("#omnis-launch");

    await send("m-keep-3", "Re: #omnis-launch", null); // 답장 제목
    expect((await read()).title).toBe("#omnis-launch");

    const archivedAt = new Date().toISOString();
    await send("m-keep-4", null, archivedAt);
    expect((await read()).archived_at).not.toBeNull();
    await send("m-keep-5", null, null); // 보관 뒤 새 메시지 — 되살리면 안 된다
    expect((await read()).archived_at).not.toBeNull();
  });
});
