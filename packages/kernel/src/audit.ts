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
