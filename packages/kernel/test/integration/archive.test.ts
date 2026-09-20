// packages/kernel/test/integration/archive.test.ts
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  REARCHIVE_EXCLUSION_DAYS,
  UNDO_WINDOW_DAYS,
  archiveItem,
  archivedSince,
  isRearchiveExcluded,
  undoArchive,
} from "../../src/archive.js";
import { createAudit } from "../../src/audit.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});
afterAll(() => pool.end());

let threadId = "";
let itemId = "";
beforeEach(async () => {
  const a = await pool.query<{ id: string }>(
    `INSERT INTO accounts (channel, external_id, display) VALUES ('gmail','arch@test','a')
       ON CONFLICT (channel, external_id) DO UPDATE SET display='a' RETURNING id`,
  );
  const accountId = a.rows[0]?.id ?? "";
  const t = await pool.query<{ id: string }>(
    `INSERT INTO threads (account_id, external_id, kind, meta) VALUES ($1,'thr_arch','email','{}'::jsonb)
       ON CONFLICT (account_id, external_id) DO UPDATE SET meta = '{}'::jsonb RETURNING id`,
    [accountId],
  );
  threadId = t.rows[0]?.id ?? "";
  const i = await pool.query<{ id: string }>(
    `INSERT INTO items (thread_id, account_id, external_id, kind, status, body, sent_at, meta)
     VALUES ($1,$2,'it_arch','email','received','뉴스레터', now(), '{}'::jsonb)
     ON CONFLICT (account_id, external_id) WHERE external_id IS NOT NULL
       DO UPDATE SET status='received', meta='{}'::jsonb RETURNING id`,
    [threadId, accountId],
  );
  itemId = i.rows[0]?.id ?? "";
});

const meta = {
  rule_ids: ["ar_sender_nonhuman", "ar_no_cta"],
  reason: "뉴스레터",
  tier: "T0" as const,
  confidence: 0.93,
  run_id: "00000000-0000-0000-0000-0000000000aa",
  at: new Date().toISOString(),
};

describe("archiveItem / undoArchive (A4 §9.3·§9.4)", () => {
  it("sets status=archived and records meta.archived_by", async () => {
    await archiveItem(pool, itemId, meta);
    const { rows } = await pool.query<{ status: string; ab: typeof meta }>(
      "SELECT status, meta->'archived_by' AS ab FROM items WHERE id = $1",
      [itemId],
    );
    expect(rows[0]?.status).toBe("archived");
    expect(rows[0]?.ab.reason).toBe("뉴스레터");
    expect(UNDO_WINDOW_DAYS).toBe(7);
    expect(REARCHIVE_EXCLUSION_DAYS).toBe(30);
  });

  it("undo returns the item to received, audits it, and excludes the thread for 30 days", async () => {
    await archiveItem(pool, itemId, meta);
    const n = await undoArchive(pool, { itemId }, "me", createAudit(pool));
    expect(n).toBe(1);
    const { rows } = await pool.query<{ status: string }>(
      "SELECT status FROM items WHERE id = $1",
      [itemId],
    );
    expect(rows[0]?.status).toBe("received");
    const au = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_log WHERE action = 'item.unarchive' AND target_id = $1",
      [itemId],
    );
    expect(au.rows[0]?.n).toBe("1");
    expect(await isRearchiveExcluded(pool, threadId, new Date())).toBe(true);
  });

  it("never deletes anything — the row is still there after undo", async () => {
    await archiveItem(pool, itemId, meta);
    await undoArchive(pool, { itemId }, "me", createAudit(pool));
    const { rows } = await pool.query("SELECT id FROM items WHERE id = $1", [itemId]);
    expect(rows).toHaveLength(1);
  });

  it("archivedSince lists the day's archived items by reason", async () => {
    await archiveItem(pool, itemId, meta);
    const groups = await archivedSince(pool, new Date(Date.now() - 3_600_000));
    expect(groups.find((g) => g.reason === "뉴스레터")?.count).toBeGreaterThanOrEqual(1);
  });
});
