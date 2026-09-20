import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pickSensitivity, sensitivityFor } from "../../src/sensitivity.js";
import type { ItemRow } from "../../src/types.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});
let accountId = "";
let threadId = "";
let vipId = "";
let plainId = "";

beforeAll(async () => {
  const a = await pool.query<{ id: string }>(
    `INSERT INTO accounts (channel, external_id, display) VALUES ('gmail','sens@test','t')
       ON CONFLICT (channel, external_id) DO UPDATE SET display='t' RETURNING id`,
  );
  accountId = a.rows[0]?.id;
  const t = await pool.query<{ id: string }>(
    `INSERT INTO threads (account_id, external_id, kind) VALUES ($1,'thr_sens','email')
       ON CONFLICT (account_id, external_id) DO UPDATE SET kind='email' RETURNING id`,
    [accountId],
  );
  threadId = t.rows[0]?.id;
  vipId = (
    await pool.query<{ id: string }>(
      "INSERT INTO persons (display_name, vip) VALUES ('VIP One', true) RETURNING id",
    )
  ).rows[0]?.id;
  plainId = (
    await pool.query<{ id: string }>(
      "INSERT INTO persons (display_name) VALUES ('Plain One') RETURNING id",
    )
  ).rows[0]?.id;
});
afterAll(() => pool.end());

const item = (over: Partial<ItemRow> = {}): ItemRow => ({
  id: "00000000-0000-0000-0000-0000000000dd",
  thread_id: threadId,
  account_id: accountId,
  channel: "gmail",
  kind: "email",
  scope: "unknown",
  sensitivity: "normal",
  author_person_id: null,
  author_is_me: false,
  subject: null,
  body: "hi",
  sent_at: new Date().toISOString(),
  embedding: null,
  ...over,
});

// agent_runs.item_id는 items(id) FK다. classify()가 recordRun하기 전에 대응하는
// items 행이 있어야 한다 — classify.test.ts와 같은 패턴(deviation).
async function insertItem(it: ItemRow): Promise<void> {
  await pool.query(
    `INSERT INTO items (id, thread_id, account_id, external_id, kind, scope, sensitivity, subject, body, sent_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (id) DO UPDATE SET scope = $6, sensitivity = $7, subject = $8, body = $9, sent_at = $10`,
    [
      it.id,
      it.thread_id,
      it.account_id,
      it.id,
      it.kind,
      it.scope,
      it.sensitivity,
      it.subject,
      it.body,
      it.sent_at,
    ],
  );
}

describe("pickSensitivity", () => {
  it("keeps the highest of health > legal > finance > personal > normal", () => {
    expect(pickSensitivity("personal", "health", "normal")).toBe("health");
    expect(pickSensitivity("normal", "finance", "personal")).toBe("finance");
    expect(pickSensitivity("legal", "finance")).toBe("legal");
    expect(pickSensitivity()).toBe("normal");
  });
});

describe("sensitivityFor", () => {
  it("defaults to normal", async () => {
    const s = await sensitivityFor(item({ author_person_id: plainId }), {
      threadId,
      accountChannel: "gmail",
      authorPersonId: plainId,
      pool,
    });
    expect(s).toBe("normal");
  });

  it("promotes to personal for a VIP author", async () => {
    const s = await sensitivityFor(item({ author_person_id: vipId }), {
      threadId,
      accountChannel: "gmail",
      authorPersonId: vipId,
      pool,
    });
    expect(s).toBe("personal");
  });

  it("stays normal when the author is unknown", async () => {
    const s = await sensitivityFor(item(), { threadId, accountChannel: "gmail", pool });
    expect(s).toBe("normal");
  });

  it("never downgrades what the item already carries", async () => {
    const s = await sensitivityFor(item({ author_person_id: plainId, sensitivity: "finance" }), {
      threadId,
      accountChannel: "gmail",
      authorPersonId: plainId,
      pool,
    });
    expect(s).toBe("finance");
  });
});

describe("classify + sensitivity", () => {
  it("carries the VIP promotion through the T0 rule path", async () => {
    const { classify, configureAgents } = await import("../../src/index.js");
    configureAgents({ pool });
    await pool.query("UPDATE threads SET scope = 'work' WHERE id = $1", [threadId]);
    const it0 = item({ id: "00000000-0000-0000-0000-0000000000d9", author_person_id: vipId });
    await insertItem(it0);
    const out = await classify(it0, {
      threadId,
      accountChannel: "gmail",
      authorPersonId: vipId,
      pool,
    });
    expect(out).toMatchObject({ tier_used: "T0", scope: "work", sensitivity: "personal" });
    await pool.query("UPDATE threads SET scope = 'unknown' WHERE id = $1", [threadId]);
  });
});
