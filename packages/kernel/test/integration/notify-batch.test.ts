import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../../src/logger.js";
import { PUSH_BATCH_CRON, first80, runPushBatch } from "../../src/notify/batch.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});
afterAll(() => pool.end());

let threadId = "";
beforeEach(async () => {
  const a = await pool.query<{ id: string }>(
    `INSERT INTO accounts (channel, external_id, display) VALUES ('gmail','nb@test','n')
       ON CONFLICT (channel, external_id) DO UPDATE SET display='n' RETURNING id`,
  );
  const t = await pool.query<{ id: string }>(
    `INSERT INTO threads (account_id, external_id, kind) VALUES ($1,'thr_nb','email')
       ON CONFLICT (account_id, external_id) DO UPDATE SET kind='email' RETURNING id`,
    [a.rows[0]?.id ?? ""],
  );
  threadId = t.rows[0]?.id ?? "";
  await pool.query("DELETE FROM items WHERE thread_id = $1", [threadId]);
});

describe("push_batch (A4 §3.6)", () => {
  it("runs at 09/12/15/18 KST", () => {
    expect(PUSH_BATCH_CRON).toBe("0 9,12,15,18 * * *");
  });

  it("truncates a body to the first 80 characters", () => {
    expect(first80("a".repeat(200))).toHaveLength(80);
    expect(first80("short")).toBe("short");
  });

  it("folds every pending draft into a single push", async () => {
    for (let i = 0; i < 3; i += 1) {
      await pool.query(
        `INSERT INTO items (thread_id, account_id, kind, status, body, sent_at, author_is_me)
         SELECT $1, account_id, 'email', 'draft', $2, now(), true FROM threads WHERE id = $1`,
        [threadId, `draft ${i}`],
      );
    }
    const send = vi.fn(async () => undefined);
    const n = await runPushBatch({
      pool,
      logger: createLogger("@omnis/kernel"),
      notifier: { send },
      now: new Date(),
    });
    expect(n).toBe(3);
    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0]?.[0] as { title: string; body: string; kind: string };
    expect(payload.kind).toBe("draft");
    expect(payload.body).toContain("3");
    expect(payload.body.length).toBeLessThanOrEqual(80);
  });

  it("sends nothing when there is no pending draft", async () => {
    const send = vi.fn(async () => undefined);
    const n = await runPushBatch({
      pool,
      logger: createLogger("@omnis/kernel"),
      notifier: { send },
      now: new Date(),
    });
    expect(n).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});
