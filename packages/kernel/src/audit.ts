import { query } from "@omnis/db";
import type { Pool } from "pg";

/** 계약 §5. append-only, 모든 egress가 반드시 경유한다. */
export interface AuditEntry {
  actor: string; // 'me' | `agent:${RuntimeKind}` | 'system'
  action: string; // 'item.sent' | 'approval.decided' | 'kill_switch.set' ...
  target_table: string;
  target_id?: string;
  before?: unknown;
  after?: unknown;
  approval_id?: string;
}

export interface Audit {
  record(e: AuditEntry): Promise<void>;
}

export function createAudit(pool: Pool): Audit {
  return {
    async record(e) {
      await query(
        pool,
        `INSERT INTO audit_log (actor, action, target_table, target_id, before, after, approval_id)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
        [
          e.actor,
          e.action,
          e.target_table,
          e.target_id ?? null,
          e.before === undefined ? null : JSON.stringify(e.before),
          e.after === undefined ? null : JSON.stringify(e.after),
          e.approval_id ?? null,
        ],
      );
    },
  };
}

/** A3 §9 규칙 5 / 마스터 §2: 승인 없는 외부 전송은 0건이어야 한다.
 *  밤 다이제스트 잡(Phase B)이 이 값을 세고, 0이 아니면 그날 다이제스트에 뜬다. */
export async function countUnapprovedSends(pool: Pool, since: Date): Promise<number> {
  const rows = await query<{ n: string }>(
    pool,
    `SELECT count(*)::text AS n FROM audit_log
      WHERE action = 'item.sent' AND approval_id IS NULL AND at >= $1`,
    [since],
  );
  return Number(rows[0]?.n ?? "0");
}
