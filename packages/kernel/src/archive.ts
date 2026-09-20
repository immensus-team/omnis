// packages/kernel/src/archive.ts
// A4 §9.3·§9.4. Never hard-delete, under any circumstances (A3 §11: items are kept forever).
import { query } from "@omnis/db";
import type { Pool } from "pg";
import type { Audit } from "./audit.js";

export const UNDO_WINDOW_DAYS = 7;
export const REARCHIVE_EXCLUSION_DAYS = 30;

export interface ArchivedByMeta {
  rule_ids: string[];
  reason: string;
  tier: "T0" | "T1";
  confidence: number;
  run_id: string;
  /** Reference time for the 7-day undo window. items has no archived-at column (A4 §9.3). */
  at: string;
}

export async function archiveItem(pool: Pool, itemId: string, meta: ArchivedByMeta): Promise<void> {
  await query(
    pool,
    `UPDATE items SET status = 'archived',
        meta = meta || jsonb_build_object('archived_by', $2::jsonb)
      WHERE id = $1 AND status = 'received'`,
    [itemId, JSON.stringify(meta)],
  );
}

/** A thread a human revived is excluded from auto-archive for 30 days (A4 §9.4). */
export async function isRearchiveExcluded(
  pool: Pool,
  threadId: string,
  now: Date,
): Promise<boolean> {
  const rows = await query<{ until: string | null }>(
    pool,
    "SELECT meta->>'no_auto_archive_until' AS until FROM threads WHERE id = $1",
    [threadId],
  );
  const until = rows[0]?.until;
  return until !== undefined && until !== null && new Date(until) > now;
}

export async function undoArchive(
  pool: Pool,
  ref: { itemId?: string; undoToken?: string },
  actor: string,
  audit: Audit,
): Promise<number> {
  const rows = await query<{ id: string; thread_id: string }>(
    pool,
    `UPDATE items SET status = 'received'
      WHERE status = 'archived'
        AND (meta->'archived_by'->>'at')::timestamptz > now() - ($3 || ' days')::interval
        AND ( ($1::uuid IS NOT NULL AND id = $1)
           OR ($2::text IS NOT NULL AND meta->'archived_by'->>'undo_token' = $2) )
     RETURNING id, thread_id`,
    [ref.itemId ?? null, ref.undoToken ?? null, String(UNDO_WINDOW_DAYS)],
  );
  const threads = new Set(rows.map((r) => r.thread_id));
  for (const t of threads) {
    await query(
      pool,
      `UPDATE threads SET meta = meta || jsonb_build_object(
          'no_auto_archive_until', (now() + ($2 || ' days')::interval)::text)
        WHERE id = $1`,
      [t, String(REARCHIVE_EXCLUSION_DAYS)],
    );
  }
  for (const r of rows) {
    await audit.record({
      actor,
      action: "item.unarchive",
      target_table: "items",
      target_id: r.id,
      before: { status: "archived" },
      after: { status: "received" },
    });
  }
  return rows.length;
}

export interface ArchivedGroup {
  reason: string;
  count: number;
  item_ids: string[];
}

/** The nightly digest reads a day's worth grouped by reason (A4 §9.4 "full exposure"). */
export async function archivedSince(pool: Pool, since: Date): Promise<ArchivedGroup[]> {
  const rows = await query<{ reason: string; count: string; item_ids: string[] }>(
    pool,
    `SELECT COALESCE(meta->'archived_by'->>'reason', 'Other') AS reason,
            count(*)::text AS count,
            (array_agg(id ORDER BY sent_at DESC))[1:50] AS item_ids
       FROM items
      WHERE status = 'archived'
        AND (meta->'archived_by'->>'at')::timestamptz >= $1
      GROUP BY 1 ORDER BY count(*) DESC`,
    [since],
  );
  return rows.map((r) => ({ reason: r.reason, count: Number(r.count), item_ids: r.item_ids }));
}
