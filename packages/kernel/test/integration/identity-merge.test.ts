import { createPool, one, query, tx } from "@omnis/db";
import { mergePersons, resolvePerson, splitIdentity } from "@omnis/kernel";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let pool: Pool;
let accountId: string;
let threadId: string;

beforeAll(() => {
  pool = createPool();
});
afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await query(pool, "DELETE FROM items");
  await query(pool, "DELETE FROM threads");
  await query(pool, "DELETE FROM person_merges");
  await query(pool, "DELETE FROM identities");
  await query(pool, "DELETE FROM persons");
  await query(pool, "DELETE FROM accounts WHERE external_id LIKE 'test-%'");
  accountId = (
    await one<{ id: string }>(
      pool,
      `INSERT INTO accounts (channel, external_id, display)
         VALUES ('gmail','test-m','t') RETURNING id`,
    )
  ).id;
  threadId = (
    await one<{ id: string }>(
      pool,
      `INSERT INTO threads (account_id, external_id, kind)
         VALUES ($1,'thr','email') RETURNING id`,
      [accountId],
    )
  ).id;
});

async function seedItem(personId: string, externalId: string): Promise<void> {
  await query(
    pool,
    `INSERT INTO items (thread_id, account_id, external_id, kind, author_person_id, body, sent_at)
       VALUES ($1,$2,$3,'email',$4,'body', now())`,
    [threadId, accountId, externalId, personId],
  );
}

describe("mergePersons (A3 §10)", () => {
  it("moves identities and items, tombstones the source, and logs the merge", async () => {
    const a = await tx(pool, (c) => resolvePerson(c, "gmail", "a@corp.com", "Jinho Kim"));
    const b = await tx(pool, (c) => resolvePerson(c, "gmail", "b@corp.com", "Jinho Kim"));
    await seedItem(a.person_id, "m1");

    await mergePersons(pool, a.person_id, b.person_id, "me");

    expect(
      await query(pool, "SELECT id FROM identities WHERE person_id = $1", [b.person_id]),
    ).toHaveLength(2);
    const item = await one<{ author_person_id: string }>(
      pool,
      "SELECT author_person_id FROM items WHERE external_id = 'm1'",
    );
    expect(item.author_person_id).toBe(b.person_id);

    const tombstone = await one<{ merged_into: string }>(
      pool,
      "SELECT merged_into FROM persons WHERE id = $1",
      [a.person_id],
    );
    expect(tombstone.merged_into).toBe(b.person_id); // not deleted

    const merge = await one<{ kind: string; from_person_id: string; to_person_id: string }>(
      pool,
      "SELECT kind, from_person_id, to_person_id FROM person_merges ORDER BY at DESC LIMIT 1",
    );
    expect(merge).toEqual({
      kind: "merge",
      from_person_id: a.person_id,
      to_person_id: b.person_id,
    });

    const audit = await one<{ actor: string; action: string }>(
      pool,
      "SELECT actor, action FROM audit_log ORDER BY seq DESC LIMIT 1",
    );
    expect(audit).toEqual({ actor: "me", action: "person.merged" });
  });

  it("refuses to merge a person into itself", async () => {
    const a = await tx(pool, (c) => resolvePerson(c, "gmail", "a@corp.com", "Jinho Kim"));
    await expect(mergePersons(pool, a.person_id, a.person_id, "me")).rejects.toThrow(/itself/);
  });

  it("flattens a chain — merging into a tombstone lands on the survivor", async () => {
    const a = await tx(pool, (c) => resolvePerson(c, "gmail", "a@corp.com", "A"));
    const b = await tx(pool, (c) => resolvePerson(c, "gmail", "b@corp.com", "B"));
    const cPerson = await tx(pool, (c) => resolvePerson(c, "gmail", "c@corp.com", "C"));
    await mergePersons(pool, a.person_id, b.person_id, "me");
    await mergePersons(pool, b.person_id, cPerson.person_id, "me");

    const row = await one<{ merged_into: string }>(
      pool,
      "SELECT merged_into FROM persons WHERE id = $1",
      [a.person_id],
    );
    expect(row.merged_into).toBe(cPerson.person_id); // flattened to depth 1
  });
});

describe("splitIdentity (A3 §10)", () => {
  it("moves the identity to a new person and reassigns that channel's items", async () => {
    const a = await tx(pool, (c) => resolvePerson(c, "gmail", "a@corp.com", "A"));
    const b = await tx(pool, (c) => resolvePerson(c, "telegram", "+821011112222", "B"));
    await mergePersons(pool, b.person_id, a.person_id, "me");
    await seedItem(a.person_id, "m1");

    const identity = await one<{ id: string }>(
      pool,
      "SELECT id FROM identities WHERE handle_norm = 'a@corp.com'",
    );
    await splitIdentity(pool, identity.id, null, "me");

    const moved = await one<{ person_id: string }>(
      pool,
      "SELECT person_id FROM identities WHERE id = $1",
      [identity.id],
    );
    expect(moved.person_id).not.toBe(a.person_id);

    const item = await one<{ author_person_id: string | null }>(
      pool,
      "SELECT author_person_id FROM items WHERE external_id = 'm1'",
    );
    expect(item.author_person_id).toBe(moved.person_id);

    const split = await one<{ kind: string; identity_ids: string[] }>(
      pool,
      "SELECT kind, identity_ids FROM person_merges ORDER BY at DESC LIMIT 1",
    );
    expect(split.kind).toBe("split");
    expect(split.identity_ids).toEqual([identity.id]);
  });

  it("nulls the author and flags the thread when the source person keeps another identity on that channel", async () => {
    const a = await tx(pool, (c) => resolvePerson(c, "gmail", "a@corp.com", "A"));
    const b = await tx(pool, (c) => resolvePerson(c, "gmail", "b@corp.com", "B"));
    await mergePersons(pool, b.person_id, a.person_id, "me");
    await seedItem(a.person_id, "m1");

    const identity = await one<{ id: string }>(
      pool,
      "SELECT id FROM identities WHERE handle_norm = 'b@corp.com'",
    );
    await splitIdentity(pool, identity.id, null, "me");

    const item = await one<{ author_person_id: string | null }>(
      pool,
      "SELECT author_person_id FROM items WHERE external_id = 'm1'",
    );
    expect(item.author_person_id).toBeNull(); // cannot auto-reassign
    const thread = await one<{ meta: { reassign_needed?: boolean } }>(
      pool,
      "SELECT meta FROM threads WHERE id = $1",
      [threadId],
    );
    expect(thread.meta.reassign_needed).toBe(true);
  });

  it("can send the identity to a named person instead of a new one", async () => {
    const a = await tx(pool, (c) => resolvePerson(c, "gmail", "a@corp.com", "A"));
    const target = await tx(pool, (c) => resolvePerson(c, "telegram", "+821011112222", "T"));
    const identity = await one<{ id: string }>(
      pool,
      "SELECT id FROM identities WHERE handle_norm = 'a@corp.com'",
    );
    await splitIdentity(pool, identity.id, target.person_id, "me");

    const moved = await one<{ person_id: string }>(
      pool,
      "SELECT person_id FROM identities WHERE id = $1",
      [identity.id],
    );
    expect(moved.person_id).toBe(target.person_id);
    expect(a.person_id).not.toBe(target.person_id);
  });
});
