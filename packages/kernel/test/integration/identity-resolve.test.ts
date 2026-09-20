import { createPool, one, query, tx } from "@omnis/db";
import { createIngestSink, createLogger, resolvePerson } from "@omnis/kernel";
import type { NormalizedItem } from "@omnis/protocol";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let pool: Pool;
let accountId: string;

beforeAll(() => {
  pool = createPool();
});
afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await query(pool, "DELETE FROM items");
  await query(pool, "DELETE FROM threads");
  await query(pool, "DELETE FROM identities");
  await query(pool, "DELETE FROM persons");
  await query(pool, "DELETE FROM accounts WHERE external_id LIKE 'test-%'");
  accountId = (
    await one<{ id: string }>(
      pool,
      `INSERT INTO accounts (channel, external_id, display)
         VALUES ('gmail', 'test-gmail', 'test') RETURNING id`,
    )
  ).id;
});

describe("resolvePerson (A3 §10)", () => {
  it("creates a new unverified person the first time and reuses it after", async () => {
    const first = await tx(pool, (c) => resolvePerson(c, "gmail", "A.B+x@Gmail.com", "김진호"));
    expect(first.created).toBe(true);

    const again = await tx(pool, (c) => resolvePerson(c, "gmail", "ab@gmail.com", "김진호"));
    expect(again.created).toBe(false);
    expect(again.person_id).toBe(first.person_id);

    const row = await one<{ handle_norm: string; verified: boolean; source: string }>(
      pool,
      "SELECT handle_norm, verified, source FROM identities WHERE person_id = $1",
      [first.person_id],
    );
    expect(row.handle_norm).toBe("ab@gmail.com");
    expect(row.verified).toBe(false);
    expect(row.source).toBe("adapter");
  });

  // 2단계: 같은 이메일이 다른 채널에 이미 있으면 그 person에 붙인다.
  it("attaches a new channel to the person who already has that email", async () => {
    const seed = await tx(pool, (c) => resolvePerson(c, "gmail", "ab@gmail.com", "김진호"));
    const outlook = await tx(pool, (c) => resolvePerson(c, "outlook", "ab@gmail.com", "Jinho Kim"));
    expect(outlook.created).toBe(false);
    expect(outlook.person_id).toBe(seed.person_id);
    expect(
      await query(pool, "SELECT id FROM identities WHERE person_id = $1", [seed.person_id]),
    ).toHaveLength(2);
  });

  // 4단계: 표시 이름이 같다고 붙이지 않는다.
  it("never merges two people just because the display name matches", async () => {
    const a = await tx(pool, (c) => resolvePerson(c, "gmail", "kim1@corp.com", "김진호"));
    const b = await tx(pool, (c) => resolvePerson(c, "gmail", "kim2@corp.com", "김진호"));
    expect(b.person_id).not.toBe(a.person_id);
  });

  // 1단계: merged_into tombstone은 끝까지 따라간다.
  it("follows persons.merged_into to the surviving person", async () => {
    const from = await tx(pool, (c) => resolvePerson(c, "gmail", "old@corp.com", "옛 사람"));
    const to = await tx(pool, (c) => resolvePerson(c, "gmail", "new@corp.com", "새 사람"));
    await query(pool, "UPDATE persons SET merged_into = $2 WHERE id = $1", [
      from.person_id,
      to.person_id,
    ]);

    const again = await tx(pool, (c) => resolvePerson(c, "gmail", "old@corp.com", "옛 사람"));
    expect(again.person_id).toBe(to.person_id);
  });

  it("does not create a slack identity from a display name (team:user is required)", async () => {
    await expect(tx(pool, (c) => resolvePerson(c, "slack", "김진호", "김진호"))).rejects.toThrow(
      /team_id:user_id/,
    );
  });
});

describe("createIngestSink fills author_person_id (Phase A left it NULL)", () => {
  function item(overrides: Partial<NormalizedItem> = {}): NormalizedItem {
    return {
      threadExternalId: "thr-1",
      externalId: "msg-1",
      kind: "email",
      author: { kind: "person", id: "ab@gmail.com" },
      body: "안녕하세요",
      attachments: [],
      sentAt: "2026-09-20T01:00:00.000Z",
      status: "received",
      sourceHash: "h1",
      threadMeta: {
        externalId: "thr-1",
        kind: "email",
        title: "인사",
        participants: [{ externalId: "ab@gmail.com", displayName: "김진호" }],
        lastItemAt: "2026-09-20T01:00:00.000Z",
        archivedAt: null,
      },
      ...overrides,
    } as NormalizedItem;
  }

  it("resolves the author and records the person on the item and the thread", async () => {
    const sink = createIngestSink({ pool, logger: createLogger("@omnis/kernel") });
    await sink(accountId, item());

    const row = await one<{ author_person_id: string | null }>(
      pool,
      "SELECT author_person_id FROM items WHERE external_id = 'msg-1'",
    );
    expect(row.author_person_id).not.toBeNull();

    const person = await one<{ display_name: string }>(
      pool,
      "SELECT display_name FROM persons WHERE id = $1",
      [row.author_person_id],
    );
    expect(person.display_name).toBe("김진호"); // threadMeta.participants에서 가져온다

    const thread = await one<{ participants: string[] }>(
      pool,
      "SELECT participants FROM threads WHERE external_id = 'thr-1'",
    );
    expect(thread.participants).toEqual([row.author_person_id]);
  });

  it("reuses the same person for a second message from the same handle", async () => {
    const sink = createIngestSink({ pool, logger: createLogger("@omnis/kernel") });
    await sink(accountId, item());
    await sink(accountId, item({ externalId: "msg-2", sourceHash: "h2" }));
    expect(await query(pool, "SELECT id FROM persons")).toHaveLength(1);
    const thread = await one<{ participants: string[] }>(
      pool,
      "SELECT participants FROM threads WHERE external_id = 'thr-1'",
    );
    expect(thread.participants).toHaveLength(1); // 중복으로 쌓이지 않는다
  });

  it("leaves author_person_id NULL for system authors", async () => {
    const sink = createIngestSink({ pool, logger: createLogger("@omnis/kernel") });
    await sink(
      accountId,
      item({ externalId: "msg-3", sourceHash: "h3", author: { kind: "system", id: "omnis" } }),
    );
    const row = await one<{ author_person_id: string | null }>(
      pool,
      "SELECT author_person_id FROM items WHERE external_id = 'msg-3'",
    );
    expect(row.author_person_id).toBeNull();
  });

  // 해석이 터져도 아이템을 잃지 않는다 — 인박스에 안 뜨는 메시지가 최악이다.
  it("still stores the item when the handle cannot be normalised", async () => {
    await query(pool, "UPDATE accounts SET channel = 'slack' WHERE id = $1", [accountId]);
    const sink = createIngestSink({ pool, logger: createLogger("@omnis/kernel") });
    await sink(
      accountId,
      item({ externalId: "msg-4", sourceHash: "h4", author: { kind: "person", id: "그냥 이름" } }),
    );
    const row = await one<{ author_person_id: string | null }>(
      pool,
      "SELECT author_person_id FROM items WHERE external_id = 'msg-4'",
    );
    expect(row.author_person_id).toBeNull();
  });
});
