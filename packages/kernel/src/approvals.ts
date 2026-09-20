import { one, query } from "@omnis/db";
import {
  type ApprovalAction,
  type ApprovalDecision,
  type ApprovalRisk,
  type ApprovalState,
  HumanInterrupt,
  HumanResponse,
} from "@omnis/protocol";
import type { Pool } from "pg";
import type { Audit } from "./audit.js";
import type { Logger } from "./logger.js";

export class ApprovalStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalStateError";
  }
}

export interface ApprovalConfig {
  allow_accept: boolean;
  allow_edit: boolean;
  allow_respond: boolean;
  allow_ignore: boolean;
}

/** pending_approvals row 1:1 (A3 §4). The type returned by Approvals.list in contract §5. */
export interface PendingApproval {
  id: string;
  action: ApprovalAction;
  args: Record<string, unknown>;
  description: string;
  config: ApprovalConfig;
  state: ApprovalState;
  decision: ApprovalDecision | null;
  decided_args: Record<string, unknown> | null;
  requested_by: string | null;
  thread_id: string | null;
  item_id: string | null;
  task_id: string | null;
  risk: ApprovalRisk;
  expires_at: Date | null;
  created_at: Date;
  decided_at: Date | null;
  executed_at: Date | null;
  fail_reason: string | null;
}

export interface Approvals {
  propose(i: unknown): Promise<string>;
  decide(id: string, r: unknown): Promise<void>;
  list(f?: {
    state?: ApprovalState;
    thread_id?: string;
    limit?: number;
  }): Promise<PendingApproval[]>;
  /** decided(accept|edit) → executing. 0 rows → ApprovalStateError. Only runEgress calls it. */
  beginExecution(id: string): Promise<PendingApproval>;
  /** executing → executed */
  completeExecution(id: string): Promise<void>;
  /** executing → failed */
  failExecution(id: string, reason: string): Promise<void>;
  /** pending & expires_at <= now → expired(+decision='ignore'). True if a row changed. */
  expire(id: string): Promise<boolean>;
}

export interface ApprovalsDeps {
  pool: Pool;
  logger: Logger;
  now?: () => Date;
  /** Task 21 wires the audit. When absent, audit records are skipped (test bootstrap). */
  audit?: Audit;
}

const SELECT_ALL = `SELECT id, action, args, description, config, state, decision, decided_args,
                           requested_by, thread_id, item_id, task_id, risk, expires_at,
                           created_at, decided_at, executed_at, fail_reason
                      FROM pending_approvals`;

export function createApprovals(deps: ApprovalsDeps): Approvals {
  const { pool, logger } = deps;

  return {
    async propose(i) {
      // zod enforces the six action values, config and risk defaults, before the DB is touched.
      const v = HumanInterrupt.parse(i);
      const row = await one<{ id: string }>(
        pool,
        `INSERT INTO pending_approvals
           (action, args, description, config, risk, requested_by, thread_id, item_id, task_id, expires_at)
         VALUES ($1, $2::jsonb, $3, $4::jsonb, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [
          v.action,
          JSON.stringify(v.args),
          v.description,
          JSON.stringify(v.config),
          v.risk,
          v.requested_by ?? null,
          v.thread_id ?? null,
          v.item_id ?? null,
          v.task_id ?? null,
          v.expires_at ?? null,
        ],
      );
      // The approvals_notify trigger from 0007 already fires NOTIFY — emitting here doubles it.
      await deps.audit?.record({
        actor: "system",
        action: "approval.proposed",
        target_table: "pending_approvals",
        target_id: row.id,
        after: { action: v.action, description: v.description, risk: v.risk },
      });
      logger.info("approval proposed", { id: row.id, action: v.action, risk: v.risk });
      return row.id;
    },

    async decide(id, r) {
      const v = HumanResponse.parse(r);
      const now = (deps.now ?? ((): Date => new Date()))();

      const rows = await query<PendingApproval>(pool, `${SELECT_ALL} WHERE id = $1`, [id]);
      const before = rows[0];
      if (before === undefined) {
        throw new ApprovalStateError(`approval ${id} not found`);
      }
      if (before.state !== "pending") {
        throw new ApprovalStateError(`approval ${id} is not pending (state=${before.state})`);
      }
      if (before.expires_at !== null && before.expires_at.getTime() <= now.getTime()) {
        throw new ApprovalStateError(
          `approval ${id} expired at ${before.expires_at.toISOString()}`,
        );
      }
      const allowed: Record<ApprovalDecision, keyof ApprovalConfig> = {
        accept: "allow_accept",
        edit: "allow_edit",
        respond: "allow_respond",
        ignore: "allow_ignore",
      };
      if (!before.config[allowed[v.decision]]) {
        throw new ApprovalStateError(`approval ${id} config forbids decision "${v.decision}"`);
      }

      // state and decision must change in one UPDATE to satisfy approvals_decided_ck.
      const updated = await query<{ id: string }>(
        pool,
        `UPDATE pending_approvals
            SET state = 'decided', decision = $2, decided_args = $3::jsonb, decided_at = $4
          WHERE id = $1 AND state = 'pending'
          RETURNING id`,
        [id, v.decision, v.decided_args === undefined ? null : JSON.stringify(v.decided_args), now],
      );
      if (updated[0] === undefined) {
        throw new ApprovalStateError(`approval ${id} is not pending (lost the race)`);
      }
      await deps.audit?.record({
        actor: "me",
        action: "approval.decided",
        target_table: "pending_approvals",
        target_id: id,
        before: { state: before.state },
        after: { state: "decided", decision: v.decision },
        approval_id: id,
      });
      logger.info("approval decided", { id, decision: v.decision });
    },

    async list(f) {
      const where: string[] = [];
      const params: unknown[] = [];
      if (f?.state !== undefined) {
        params.push(f.state);
        where.push(`state = $${params.length}`);
      }
      if (f?.thread_id !== undefined) {
        params.push(f.thread_id);
        where.push(`thread_id = $${params.length}`);
      }
      params.push(Math.min(f?.limit ?? 50, 200));
      // A3 §12 (2): high risk first, then oldest first.
      return query<PendingApproval>(
        pool,
        `${SELECT_ALL}
          ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
          ORDER BY (risk = 'high') DESC, created_at ASC
          LIMIT $${params.length}`,
        params,
      );
    },

    async beginExecution(id) {
      // Only decision accept|edit may execute. ignore/respond never reach the channel.
      const rows = await query<PendingApproval>(
        pool,
        `UPDATE pending_approvals
            SET state = 'executing'
          WHERE id = $1 AND state = 'decided' AND decision IN ('accept','edit')
          RETURNING id, action, args, description, config, state, decision, decided_args,
                    requested_by, thread_id, item_id, task_id, risk, expires_at,
                    created_at, decided_at, executed_at, fail_reason`,
        [id],
      );
      const row = rows[0];
      if (row === undefined) {
        throw new ApprovalStateError(
          `approval ${id} is not executable (needs state=decided, decision∈accept|edit)`,
        );
      }
      logger.info("approval execution claimed", { id, action: row.action });
      return row;
    },

    async completeExecution(id) {
      const rows = await query<{ id: string }>(
        pool,
        `UPDATE pending_approvals SET state = 'executed', executed_at = now()
          WHERE id = $1 AND state = 'executing' RETURNING id`,
        [id],
      );
      if (rows[0] === undefined) {
        throw new ApprovalStateError(`approval ${id} is not executing`);
      }
    },

    async failExecution(id, reason) {
      const rows = await query<{ id: string }>(
        pool,
        `UPDATE pending_approvals SET state = 'failed', fail_reason = $2
          WHERE id = $1 AND state = 'executing' RETURNING id`,
        [id, reason.slice(0, 2000)],
      );
      if (rows[0] === undefined) {
        throw new ApprovalStateError(`approval ${id} is not executing`);
      }
      logger.info("approval execution failed", { id, reason });
    },

    async expire(id) {
      // approvals_decided_ck requires a non-NULL decision on rows where state<>'pending'.
      // Nobody chose and time ran out = 'ignore'.
      const rows = await query<{ id: string }>(
        pool,
        `UPDATE pending_approvals
            SET state = 'expired', decision = 'ignore', decided_at = now()
          WHERE id = $1 AND state = 'pending' AND expires_at IS NOT NULL AND expires_at <= now()
          RETURNING id`,
        [id],
      );
      const hit = rows[0] !== undefined;
      if (hit) {
        await deps.audit?.record({
          actor: "system",
          action: "approval.expired",
          target_table: "pending_approvals",
          target_id: id,
          after: { state: "expired", decision: "ignore" },
          approval_id: id,
        });
      }
      return hit;
    },
  };
}
