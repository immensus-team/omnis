// US-A36: 사람이 직접 누르는 스레드 보관/되살리기.
// 마스터 §7의 승인 게이트는 send/delete/delegate/calendar_write 넷뿐이다 — 보관은 egress가 아니므로
// pending_approvals를 만들지 않는다(A4-D3, A4 §9와 같은 근거: 되돌릴 수 있는 상태 전이다).
// L8 자동 보관(A4 §9)은 `items.status='archived'`를 쓰지만 그건 "어떤 메일을 인박스에서 치울까"의
// item 단위 판정이고, 여기서 사람이 치우는 단위는 스레드다(A5 §3.8의 `threads.archived_at`).
// 둘은 같은 스레드에 공존할 수 있고 Inbox는 둘 다를 숨긴다.
import { query } from "@omnis/db";
import type { Kernel, Logger } from "@omnis/kernel";
import type { Adapter } from "@omnis/protocol";
import type { Pool } from "pg";

export interface ArchiveDeps {
  pool: Pool;
  kernel: Kernel;
  logger: Logger;
  /** 채널 → 어댑터. 허브는 아직 어댑터 레지스트리를 부팅하지 않아 main.ts는 이걸 넘기지 않는다
   *  (Phase A는 시드/브리지로만 쓴다) — 레지스트리가 생기면 여기에 꽂으면 write-back이 켜진다. */
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

/** 스레드 하나를 보관하거나 되살린다. 스레드가 없으면 null(라우트가 404로 옮긴다). */
export async function setThreadArchived(
  deps: ArchiveDeps,
  threadId: string,
  archived: boolean,
): Promise<ArchiveResult | null> {
  const { pool, kernel, logger } = deps;
  // COALESCE라 두 번 보관해도 archived_at(= 7일 undo 창의 기준)이 밀리지 않는다 — 멱등.
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

/** 채널 쪽에도 보관을 반영한다. 실패해도 로컬 보관은 되돌리지 않는다(사람이 방금 누른 결과다) —
 *  대신 스레드에 system item을 남겨 조용히 사라지지 않게 한다(A5 §3.2의 오류 노출 원칙).
 *  Adapter에는 unarchive가 없으므로(protocol §Adapter) 되살리기는 로컬 전용이다. */
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
        `${row.channel} 보관 반영 실패 — omnis에서만 보관됨: ${reason}`,
        row.external_id,
      ],
    );
    return "failed";
  }
}
