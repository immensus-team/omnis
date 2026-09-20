// US-A36: user-driven thread archive/unarchive.
// The approval gates in master §7 are only send/delete/delegate/calendar_write — archiving is not
// egress, so it creates no pending_approvals (same rationale as A4-D3 and A4 §9: a reversible
// state transition).
// L8 auto-archive (A4 §9) uses `items.status='archived'`, but that is a per-item decision about
// "which mail do we clear out of the inbox"; the unit a human clears here is the thread
// (`threads.archived_at` in A5 §3.8). Both can coexist on the same thread and Inbox hides either.
import { query } from "@omnis/db";
import type { Kernel, Logger } from "@omnis/kernel";
import type { Adapter } from "@omnis/protocol";
import type { Pool } from "pg";

export interface ArchiveDeps {
  pool: Pool;
  kernel: Kernel;
  logger: Logger;
  /** Channel → adapter. The hub does not boot an adapter registry yet, so main.ts passes nothing
   *  here (Phase A uses seeding and the bridge only) — once the registry exists, plugging it in
   *  here turns write-back on. */
  adapters?: ReadonlyMap<string, Adapter>;
}

export type WriteBack = "skipped" | "ok" | "failed";

export interface ArchiveResult {
  id: string;
  archived_at: string | null;
  writeBack: WriteBack;
}

interface Row {
  account_id: string;
  external_id: string;
  channel: string;
  before_at: Date | null;
  after_at: Date | null;
}

/** Archive or unarchive one thread. Returns null when the thread is missing (the route maps 404). */
export async function setThreadArchived(
  deps: ArchiveDeps,
  threadId: string,
  archived: boolean,
): Promise<ArchiveResult | null> {
  const { pool, kernel, logger } = deps;
  // COALESCE keeps archived_at (the anchor for the 7-day undo window) from drifting on a second
  // archive — idempotent.
  const rows = await query<Row>(
    pool,
    `WITH before AS (SELECT id, archived_at FROM threads WHERE id = $1)
     UPDATE threads t
        SET archived_at = CASE WHEN $2::boolean THEN COALESCE(t.archived_at, now()) ELSE NULL END
       FROM before b, accounts a
      WHERE t.id = b.id AND a.id = t.account_id
     RETURNING t.account_id, t.external_id, a.channel,
               b.archived_at AS before_at, t.archived_at AS after_at`,
    [threadId, archived],
  );
  const row = rows[0];
  if (row === undefined) return null;

  const after = row.after_at === null ? null : row.after_at.toISOString();
  await kernel.audit.record({
    actor: "me",
    action: archived ? "thread.archived" : "thread.unarchived",
    target_table: "threads",
    target_id: threadId,
    before: { archived_at: row.before_at === null ? null : row.before_at.toISOString() },
    after: { archived_at: after },
  });
  await kernel.events.emit("durable", "thread.updated", { id: threadId, archived_at: after });

  return { id: threadId, archived_at: after, writeBack: await writeBack(deps, row, archived) };
}

/** Mirror the archive to the channel side. A failure does not roll back the local archive (the
 *  human just pressed the button) — instead we leave a system item on the thread so it does not
 *  vanish silently (the surface-errors principle in A5 §3.2).
 *  Adapters have no unarchive (protocol §Adapter), so unarchiving is local-only. */
async function writeBack(deps: ArchiveDeps, row: Row, archived: boolean): Promise<WriteBack> {
  if (!archived) return "skipped";
  const adapter = deps.adapters?.get(row.channel);
  if (adapter?.archive === undefined || !adapter.capabilities().archive) return "skipped";
  try {
    await adapter.archive({ accountId: row.account_id, externalId: row.external_id });
    return "ok";
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    deps.logger.error("archive write-back failed", { channel: row.channel, err: reason });
    await query(
      deps.pool,
      `INSERT INTO items (thread_id, account_id, kind, status, body, sent_at)
       SELECT id, $1, 'system', 'received', $2, now() FROM threads WHERE account_id = $1 AND external_id = $3`,
      [
        row.account_id,
        `${row.channel} archive write-back failed — archived in omnis only: ${reason}`,
        row.external_id,
      ],
    );
    return "failed";
  }
}
