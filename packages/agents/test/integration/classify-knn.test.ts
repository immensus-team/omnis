import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { KNN_MARGIN_MIN, KNN_SIM_MIN, knnVote } from "../../src/classify/knn.js";
import type { ItemRow } from "../../src/types.js";
import { returningId } from "./returning-id.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});
const vec = (head: number) => `[${[head, ...Array(767).fill(0.01)].join(",")}]`;
let accountId = "";
let threadId = "";

beforeAll(async () => {
  const a = await pool.query<{ id: string }>(
    `INSERT INTO accounts (channel, external_id, display) VALUES ('gmail','knn@test','t')
       ON CONFLICT (channel, external_id) DO UPDATE SET display='t' RETURNING id`,
  );
  accountId = returningId(a);
  const t = await pool.query<{ id: string }>(
    `INSERT INTO threads (account_id, external_id, kind) VALUES ($1,'thr_knn','email')
       ON CONFLICT (account_id, external_id) DO UPDATE SET kind='email' RETURNING id`,
    [accountId],
  );
  threadId = returningId(t);
  await pool.query("DELETE FROM items WHERE account_id = $1", [accountId]);
  for (let i = 0; i < 5; i++) {
    await pool.query(
      `INSERT INTO items (thread_id, account_id, external_id, kind, scope, body, sent_at, embedding)
       VALUES ($1,$2,$3,'email','work','neighbor', now(), $4::vector)`,
      [threadId, accountId, `knn_nb_${i}`, vec(1)],
    );
  }
});
afterAll(() => pool.end());

function probe(embedding: string | null): ItemRow {
  return {
    id: "00000000-0000-0000-0000-0000000000bb",
    thread_id: threadId,
    account_id: accountId,
    channel: "gmail",
    kind: "email",
    scope: "unknown",
    sensitivity: "normal",
    author_person_id: null,
    author_is_me: false,
    subject: null,
    body: "probe",
    sent_at: new Date().toISOString(),
    embedding,
  };
}

describe("knnVote", () => {
  it("returns null when the item has no embedding (batch has not run yet)", async () => {
    expect(await knnVote(probe(null), { threadId, accountChannel: "gmail", pool })).toBeNull();
  });

  it("adopts the unanimous neighbourhood scope", async () => {
    const v = await knnVote(probe(vec(1)), { threadId, accountChannel: "gmail", pool });
    expect(v?.scope).toBe("work");
    expect(v?.margin).toBeGreaterThanOrEqual(KNN_MARGIN_MIN);
    expect(v?.avgSim).toBeGreaterThanOrEqual(KNN_SIM_MIN);
    expect(v?.neighborIds).toHaveLength(5);
  });

  it("returns null when the neighbourhood is too far away", async () => {
    expect(await knnVote(probe(vec(-1)), { threadId, accountChannel: "gmail", pool })).toBeNull();
  });
});
