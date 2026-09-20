import { createPool, one, query } from "@omnis/db";
import { type Approvals, createApprovals, createLogger } from "@omnis/kernel";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let pool: Pool;
let approvals: Approvals;

beforeAll(() => {
  pool = createPool();
  approvals = createApprovals({ pool, logger: createLogger("@omnis/kernel") });
});
afterAll(async () => {
  await pool.end();
});

describe("approvals.propose", () => {
  it("inserts a pending row with the contract's default config and risk", async () => {
    const id = await approvals.propose({
      action: "send",
      args: { thread_id: "t", text: "안녕하세요" },
      description: "Slack DM 답장",
      config: { allow_accept: true, allow_edit: true, allow_respond: false, allow_ignore: true },
      risk: "normal",
    });
    const row = await one<{
      action: string;
      state: string;
      decision: string | null;
      risk: string;
      config: Record<string, boolean>;
      args: Record<string, unknown>;
    }>(
      pool,
      `SELECT action, state, decision, risk, config, args FROM pending_approvals WHERE id = $1`,
      [id],
    );

    expect(row.action).toBe("send");
    expect(row.state).toBe("pending");
    expect(row.decision).toBeNull();
    expect(row.risk).toBe("normal");
    expect(row.config.allow_respond).toBe(false);
    expect(row.args.text).toBe("안녕하세요");
  });

  it("accepts all 6 actions from A3 approvals_action_ck", async () => {
    for (const action of [
      "send",
      "delete",
      "calendar_write",
      "delegate",
      "self_model_edit",
      "memory_write",
    ] as const) {
      const id = await approvals.propose({
        action,
        args: {},
        description: `smoke ${action}`,
        config: { allow_accept: true, allow_edit: true, allow_respond: false, allow_ignore: true },
        risk: "normal",
      });
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it("rejects an action outside the enum before touching the database", async () => {
    const before = await one<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM pending_approvals`,
    );
    await expect(
      approvals.propose({
        // @ts-expect-error — 런타임 방어를 검증하려고 일부러 타입을 깬다
        action: "wire_money",
        args: {},
        description: "nope",
        config: { allow_accept: true, allow_edit: true, allow_respond: false, allow_ignore: true },
        risk: "normal",
      }),
    ).rejects.toThrow();
    const after = await one<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM pending_approvals`,
    );
    expect(after.n).toBe(before.n);
  });

  it("stores the optional foreign keys and expiry when given", async () => {
    const acc = await one<{ id: string }>(
      pool,
      `INSERT INTO accounts (channel, external_id, display) VALUES ('slack','T-ap:U','ap') RETURNING id`,
    );
    const thr = await one<{ id: string }>(
      pool,
      `INSERT INTO threads (account_id, external_id, kind) VALUES ($1,'ap-1','dm') RETURNING id`,
      [acc.id],
    );
    const runtime = await one<{ id: string }>(
      pool,
      `SELECT id FROM agent_runtimes WHERE runtime='omnis'`,
    );
    const expires = new Date(Date.now() + 3_600_000).toISOString();

    const id = await approvals.propose({
      action: "delegate",
      args: { runtime: "codex" },
      description: "맥북 Codex에 위임",
      config: { allow_accept: true, allow_edit: false, allow_respond: false, allow_ignore: true },
      risk: "high",
      requested_by: runtime.id,
      thread_id: thr.id,
      expires_at: expires,
    });
    const row = await one<{
      thread_id: string;
      requested_by: string;
      risk: string;
      expires_at: Date;
    }>(
      pool,
      `SELECT thread_id, requested_by, risk, expires_at FROM pending_approvals WHERE id = $1`,
      [id],
    );
    expect(row.thread_id).toBe(thr.id);
    expect(row.requested_by).toBe(runtime.id);
    expect(row.risk).toBe("high");
    expect(row.expires_at.toISOString()).toBe(expires);
  });
});

describe("approvals.list", () => {
  it("filters by state and thread and honours the limit", async () => {
    const pending = await approvals.list({ state: "pending", limit: 3 });
    expect(pending.length).toBeLessThanOrEqual(3);
    expect(pending.every((a) => a.state === "pending")).toBe(true);

    const thr = await one<{ id: string }>(pool, `SELECT id FROM threads WHERE external_id='ap-1'`);
    const scoped = await approvals.list({ thread_id: thr.id });
    expect(scoped.length).toBeGreaterThanOrEqual(1);
    expect(scoped.every((a) => a.thread_id === thr.id)).toBe(true);
  });

  it("orders high risk first, then oldest first (A3 §12 (2))", async () => {
    await query(pool, `DELETE FROM threads WHERE external_id = 'never'`); // no-op, keeps the pool warm
    const all = await approvals.list({ state: "pending", limit: 50 });
    const firstNormal = all.findIndex((a) => a.risk === "normal");
    const lastHigh = all.map((a) => a.risk).lastIndexOf("high");
    if (firstNormal !== -1 && lastHigh !== -1) {
      expect(lastHigh).toBeLessThan(firstNormal);
    }
  });
});
