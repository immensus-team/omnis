import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, one, query } from "@omnis/db";

let pool: Pool;
beforeAll(() => {
  pool = createPool();
});
afterAll(async () => {
  await pool.end();
});

describe("0004_tasks_approvals", () => {
  it("accepts the 6 approval actions from A3 §1.1 and rejects anything else", async () => {
    for (const action of [
      "send",
      "delete",
      "calendar_write",
      "delegate",
      "self_model_edit",
      "memory_write",
    ]) {
      const row = await one<{ state: string; risk: string; config: Record<string, boolean> }>(
        pool,
        `INSERT INTO pending_approvals (action, args, description)
         VALUES ($1, '{}'::jsonb, 'smoke') RETURNING state, risk, config`,
        [action],
      );
      expect(row.state).toBe("pending");
      expect(row.risk).toBe("normal");
      expect(row.config).toEqual({
        allow_accept: true,
        allow_edit: true,
        allow_respond: false,
        allow_ignore: true,
      });
    }
    await expect(
      query(pool, `INSERT INTO pending_approvals (action, args, description)
                   VALUES ('wire_money','{}'::jsonb,'nope')`),
    ).rejects.toThrow(/approvals_action_ck/);
  });

  it("couples state and decision through approvals_decided_ck", async () => {
    const a = await one<{ id: string }>(
      pool,
      `INSERT INTO pending_approvals (action, args, description)
       VALUES ('send','{}'::jsonb,'coupling') RETURNING id`,
    );
    // pending인데 decision이 있으면 거부
    await expect(
      query(pool, `UPDATE pending_approvals SET decision = 'accept' WHERE id = $1`, [a.id]),
    ).rejects.toThrow(/approvals_decided_ck/);
    // pending이 아닌데 decision이 NULL이어도 거부 — expired 포함
    await expect(
      query(pool, `UPDATE pending_approvals SET state = 'expired' WHERE id = $1`, [a.id]),
    ).rejects.toThrow(/approvals_decided_ck/);
    // 둘을 같이 바꾸면 통과
    await query(
      pool,
      `UPDATE pending_approvals SET state='decided', decision='accept', decided_at=now() WHERE id=$1`,
      [a.id],
    );
    const after = await one<{ state: string; decision: string }>(
      pool,
      `SELECT state, decision FROM pending_approvals WHERE id = $1`,
      [a.id],
    );
    expect([after.state, after.decision]).toEqual(["decided", "accept"]);
  });

  it("records an agent_run with A3 column names and links escalation", async () => {
    const first = await one<{ id: string; outcome: string }>(
      pool,
      `INSERT INTO agent_runs (loop, model_tier, provider, model, tokens_in, tokens_out, cost_usd)
       VALUES ('classify','T1','deepseek','deepseek-v4.1-flash', 800, 40, 0.000132)
       RETURNING id, outcome`,
    );
    expect(first.outcome).toBe("running");

    const second = await one<{ escalated_from: string }>(
      pool,
      `INSERT INTO agent_runs (loop, model_tier, provider, model, outcome, escalated_from)
       VALUES ('classify','T2','anthropic','claude-sonnet-5','ok',$1)
       RETURNING escalated_from`,
      [first.id],
    );
    expect(second.escalated_from).toBe(first.id);

    await expect(
      query(pool, `INSERT INTO agent_runs (loop, model_tier, provider, model)
                   VALUES ('classify','T7','local','x')`),
    ).rejects.toThrow(/agent_runs_tier_ck/);
  });

  it("keys agent_sessions by (runtime_id, session_key)", async () => {
    const runtime = await one<{ id: string }>(pool, `SELECT id FROM agent_runtimes WHERE runtime='omnis'`);
    const account = await one<{ id: string }>(
      pool,
      `INSERT INTO accounts (channel, external_id, display) VALUES ('agent','local','agents') RETURNING id`,
    );
    const thread = await one<{ id: string }>(
      pool,
      `INSERT INTO threads (account_id, external_id, kind) VALUES ($1,'sess-1','agent_session') RETURNING id`,
      [account.id],
    );
    await query(
      pool,
      `INSERT INTO agent_sessions (runtime_id, thread_id, session_key)
       VALUES ($1,$2,'agent:omnis:mini:classify')`,
      [runtime.id, thread.id],
    );
    await expect(
      query(
        pool,
        `INSERT INTO agent_sessions (runtime_id, thread_id, session_key)
         VALUES ($1,$2,'agent:omnis:mini:classify')`,
        [runtime.id, thread.id],
      ),
    ).rejects.toThrow(/agent_sessions_uq/);
  });

  it("keeps one digest per (kind, for_date)", async () => {
    await query(
      pool,
      `INSERT INTO digests (kind, for_date, body) VALUES ('morning','2026-09-20','brief')`,
    );
    await expect(
      query(pool, `INSERT INTO digests (kind, for_date, body) VALUES ('morning','2026-09-20','dup')`),
    ).rejects.toThrow(/digests_uq/);
  });
});
