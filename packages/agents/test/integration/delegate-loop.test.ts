import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { configureAgents, delegateLoop, renderBrief } from "../../src/index.js";
import { returningId } from "./returning-id.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});
beforeEach(async () => {
  configureAgents({ pool });
  await pool.query("DELETE FROM pending_approvals WHERE action = 'delegate'");
});
afterAll(() => pool.end());

describe("renderBrief (A4 §5.3)", () => {
  it("renders all eight sections and keeps acceptance non-empty", () => {
    const b = renderBrief({
      goal: "Fix the report script",
      background: ["It failed last week (item:it_1)", "The logs are in ops/logs (memory:m_2)"],
      steps: ["Diagnose the cause", "Fix it"],
      acceptance: ["pnpm test passes"],
      verifyCmd: "pnpm test",
      workdir: "/Users/logankim/AI-Workspaces/omnis",
    });
    for (const h of [
      "## Goal",
      "## Background",
      "## Steps",
      "## Acceptance Criteria",
      "## Verify Command",
      "## Workdir",
      "## Do Not",
    ]) {
      expect(b).toContain(h);
    }
    expect(b).toContain("- [ ] pnpm test passes");
    expect(b).toContain("Do not commit or push");
  });

  it("refuses an empty acceptance list", () => {
    expect(() =>
      renderBrief({
        goal: "x",
        background: [],
        steps: ["y"],
        acceptance: [],
        verifyCmd: "true",
        workdir: "/tmp",
      }),
    ).toThrow(/acceptance/);
  });
});

// US-C04: the `autonomyAllows` block that used to live here moved to
// packages/kernel/test/delegation-rules.test.ts along with the implementation
// (`delegationAllowed`). Every assertion it made — off by default, over 30 minutes,
// outside the repo, egress — is in that file's table, plus the guards it did not cover.

describe("delegateLoop (A4 §5)", () => {
  it("is T2, fires on an unrouted agent task, and cannot propose hermes", () => {
    expect(delegateLoop.tier).toBe("T2");
    expect(delegateLoop.trigger.on).toBe("task.created");
    expect(delegateLoop.trigger.where).toContain("routing_rule_id IS NULL");
    expect(delegateLoop.budget).toEqual({
      inputTokens: 8000,
      outputTokens: 900,
      wallClockMs: 60_000,
      maxSteps: 6,
    });
    expect(delegateLoop.palette).toEqual([
      "read_thread",
      "read_tasks",
      "read_session",
      "search_memory",
      "propose_delegation",
    ]);
    expect(delegateLoop.outputSchema.safeParse({ runtime: "hermes" }).success).toBe(false);
  });

  it("creates a pending approval row, never an execution", async () => {
    const taskId = returningId(
      await pool.query<{ id: string }>(
        "INSERT INTO tasks (title, owner_kind, created_by) VALUES ('delegation candidate','agent','agent') RETURNING id",
      ),
    );
    await delegateLoop.apply(
      {
        loop: "delegate",
        run_id: "00000000-0000-0000-0000-0000000000cc",
        output: {
          runtime: "claude_code",
          host: "mini",
          goal: "Fix it",
          background: [],
          steps: ["a"],
          acceptance: ["tests pass"],
          verify_cmd: "pnpm test",
          workdir: "/Users/logankim/AI-Workspaces/omnis",
          est_minutes: 20,
          confidence: 0.8,
          rationale: "work inside the repo",
          injection_flags: [],
        },
        confidence: 0.8,
        rationale: "work inside the repo",
        escalate: false,
        injection_flags: [],
        unresolved: [],
      } as never,
      { trigger_kind: "event", task_id: taskId, now: new Date(), payload: {} },
    );
    const { rows } = await pool.query<{
      state: string;
      action: string;
      risk: string;
      args: { brief: string };
    }>("SELECT state, action, risk, args FROM pending_approvals WHERE task_id = $1", [taskId]);
    expect(rows[0]).toMatchObject({ state: "pending", action: "delegate", risk: "normal" });
    expect(rows[0]?.args.brief).toContain("## Acceptance Criteria");
    const sessions = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM agent_sessions",
    );
    expect(sessions.rows[0]?.n).toBe("0");
  });
});
