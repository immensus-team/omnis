import { query } from "@omnis/db";
import type { Pool } from "pg";

/** Contract §5. Append-only; every egress must pass through it. */
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

/** A3 §9 rule 5 / master §2: sends without approval must be zero.
 *  The nightly digest job (Phase B) counts this and surfaces it in that day's digest
 *  when it is non-zero. */
export async function countUnapprovedSends(pool: Pool, since: Date): Promise<number> {
  const rows = await query<{ n: string }>(
    pool,
    `SELECT count(*)::text AS n FROM audit_log
      WHERE action = 'item.sent' AND approval_id IS NULL AND at >= $1`,
    [since],
  );
  return Number(rows[0]?.n ?? "0");
}
