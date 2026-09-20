import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { configureAgents, writeSystemItem } from "../../src/index.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});
beforeAll(() => configureAgents({ pool }));
afterAll(() => pool.end());

describe("writeSystemItem (A4 §1.6)", () => {
  it("creates the system account/thread once and appends an item", async () => {
    const a = await writeSystemItem({
      body: "1 automatic processing failure",
      meta: { loop: "draft" },
    });
    const b = await writeSystemItem({ body: "2 automatic processing failures" });
    expect(a).not.toBe(b);

    const { rows } = await pool.query<{
      kind: string;
      status: string;
      body: string;
      meta: unknown;
    }>(
      `SELECT i.kind, i.status, i.body, i.meta FROM items i
         JOIN threads t ON t.id = i.thread_id
         JOIN accounts ac ON ac.id = i.account_id
        WHERE ac.channel = 'system' AND t.external_id = 'system:agents'
        ORDER BY i.sent_at`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0]).toMatchObject({ kind: "system", status: "received" });
    expect(rows.map((r) => r.body)).toContain("1 automatic processing failure");
    expect(rows.find((r) => r.body === "1 automatic processing failure")?.meta).toEqual({
      loop: "draft",
    });

    const { rows: accs } = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM accounts WHERE channel = 'system' AND external_id = 'omnis'",
    );
    expect(accs[0]?.n).toBe("1");
  });

  it("attaches to a given thread when thread_id is passed", async () => {
    const acc = await pool.query<{ id: string }>(
      `INSERT INTO accounts (channel, external_id, display) VALUES ('telegram','sys@test','t')
         ON CONFLICT (channel, external_id) DO UPDATE SET display='t' RETURNING id`,
    );
    const accountId = acc.rows[0]?.id ?? "";
    const thr = await pool.query<{ id: string }>(
      `INSERT INTO threads (account_id, external_id, kind) VALUES ($1,'thr_sys','dm')
         ON CONFLICT (account_id, external_id) DO UPDATE SET kind='dm' RETURNING id`,
      [accountId],
    );
    const threadId = thr.rows[0]?.id ?? "";
    const id = await writeSystemItem({ body: "Left on this thread", thread_id: threadId });
    const { rows } = await pool.query<{ thread_id: string; account_id: string }>(
      "SELECT thread_id, account_id FROM items WHERE id = $1",
      [id],
    );
    expect(rows[0]?.thread_id).toBe(threadId);
    expect(rows[0]?.account_id).toBe(accountId);
  });

  it("throws when the given thread does not exist", async () => {
    await expect(
      writeSystemItem({
        body: "missing thread",
        thread_id: "00000000-0000-0000-0000-000000000000",
      }),
    ).rejects.toThrow(/thread not found/);
  });
});
