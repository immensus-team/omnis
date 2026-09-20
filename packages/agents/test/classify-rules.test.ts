import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyRules, WORK_DOMAINS } from "../src/classify/rules.js";
import type { ClassifyCtx } from "../src/classify/rules.js";
import type { ItemRow } from "../src/types.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});
let accountId = "", threadId = "", personId = "";

beforeAll(async () => {
  const a = await pool.query<{ id: string }>(
    `INSERT INTO accounts (channel, external_id, display) VALUES ('gmail','rules@test','t')
       ON CONFLICT (channel, external_id) DO UPDATE SET display='t' RETURNING id`);
  accountId = a.rows[0]!.id;
  const t = await pool.query<{ id: string }>(
    `INSERT INTO threads (account_id, external_id, kind, scope) VALUES ($1,'thr_rules','email','unknown')
       ON CONFLICT (account_id, external_id) DO UPDATE SET scope='unknown' RETURNING id`, [accountId]);
  threadId = t.rows[0]!.id;
  const p = await pool.query<{ id: string }>(
    `INSERT INTO persons (display_name) VALUES ('Rules Tester') RETURNING id`);
  personId = p.rows[0]!.id;
});
afterAll(() => pool.end());

function item(over: Partial<ItemRow> = {}): ItemRow {
  return {
    id: "00000000-0000-0000-0000-0000000000aa", thread_id: threadId, account_id: accountId,
    channel: "gmail", kind: "email", scope: "unknown", sensitivity: "normal",
    author_person_id: personId, author_is_me: false, subject: "quote request",
    body: "hello", sent_at: new Date().toISOString(), embedding: null, ...over,
  };
}
const ctx = (): ClassifyCtx => ({ threadId, accountChannel: "gmail", authorPersonId: personId, pool });

describe("applyRules", () => {
  it("r_channel_work: slack is always work", async () => {
    const hit = await applyRules(item({ channel: "slack" }), { ...ctx(), accountChannel: "slack" });
    expect(hit).toMatchObject({ rule_id: "r_channel_work", scope: "work", confidence: 0.95 });
  });

  it("r_thread_sticky beats the channel default", async () => {
    await pool.query("UPDATE threads SET scope = 'personal' WHERE id = $1", [threadId]);
    const hit = await applyRules(item({ channel: "slack" }), { ...ctx(), accountChannel: "slack" });
    expect(hit).toMatchObject({ rule_id: "r_thread_sticky", scope: "personal", confidence: 0.98 });
    await pool.query("UPDATE threads SET scope = 'unknown' WHERE id = $1", [threadId]);
  });

  it("r_domain: a sender on a work domain is work", async () => {
    await pool.query(
      `INSERT INTO identities (person_id, channel, handle, handle_norm)
       VALUES ($1,'gmail','a@${WORK_DOMAINS[0]}','a@${WORK_DOMAINS[0]}')
       ON CONFLICT (channel, handle_norm) DO NOTHING`, [personId]);
    const hit = await applyRules(item(), ctx());
    expect(hit).toMatchObject({ rule_id: "r_domain", scope: "work", confidence: 0.92 });
  });

  it("returns null when nothing matches, so the kNN stage runs", async () => {
    const hit = await applyRules(item({ author_person_id: null }), { threadId, accountChannel: "telegram", pool });
    expect(hit).toBeNull();
  });
});
