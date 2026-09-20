import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  AUTONOMY_MAX_MINUTES,
  autonomyAllows,
  configureAgents,
  delegateLoop,
  renderBrief,
} from "../../src/index.js";
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
      goal: "리포트 스크립트를 고친다",
      background: ["지난주 실패했다 (item:it_1)", "로그는 ops/logs에 있다 (memory:m_2)"],
      steps: ["원인 파악", "수정"],
      acceptance: ["pnpm test가 통과한다"],
      verifyCmd: "pnpm test",
      workdir: "/Users/logankim/AI-Workspaces/omnis",
    });
    for (const h of [
      "## 목표",
      "## 배경",
      "## 해야 할 일",
      "## 수용 기준",
      "## 검증 명령",
      "## 작업 디렉터리",
      "## 금지",
    ]) {
      expect(b).toContain(h);
    }
    expect(b).toContain("- [ ] pnpm test가 통과한다");
    expect(b).toContain("커밋/푸시하지 않는다");
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

describe("autonomyAllows (A4 §4.4, B-D6)", () => {
  it("is off by default", () => {
    expect(
      autonomyAllows({
        rules: [],
        runtime: "claude_ds",
        repo: "/Users/logankim/x",
        estMinutes: 5,
        hasEgress: false,
      }),
    ).toBe(false);
  });

  it("still requires approval for long, out-of-repo or egress work", () => {
    const rules = [{ runtime: "claude_ds", repo: "/Users/logankim/x" }];
    expect(
      autonomyAllows({
        rules,
        runtime: "claude_ds",
        repo: "/Users/logankim/x",
        estMinutes: 5,
        hasEgress: false,
      }),
    ).toBe(true);
    expect(
      autonomyAllows({
        rules,
        runtime: "claude_ds",
        repo: "/Users/logankim/x",
        estMinutes: AUTONOMY_MAX_MINUTES + 1,
        hasEgress: false,
      }),
    ).toBe(false);
    expect(
      autonomyAllows({
        rules,
        runtime: "claude_ds",
        repo: "/Users/other",
        estMinutes: 5,
        hasEgress: false,
      }),
    ).toBe(false);
    expect(
      autonomyAllows({
        rules,
        runtime: "claude_ds",
        repo: "/Users/logankim/x",
        estMinutes: 5,
        hasEgress: true,
      }),
    ).toBe(false);
  });
});

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
        "INSERT INTO tasks (title, owner_kind, created_by) VALUES ('위임 후보','agent','agent') RETURNING id",
      ),
    );
    await delegateLoop.apply(
      {
        loop: "delegate",
        run_id: "00000000-0000-0000-0000-0000000000cc",
        output: {
          runtime: "claude_code",
          host: "mini",
          goal: "고친다",
          background: [],
          steps: ["a"],
          acceptance: ["테스트 통과"],
          verify_cmd: "pnpm test",
          workdir: "/Users/logankim/AI-Workspaces/omnis",
          est_minutes: 20,
          confidence: 0.8,
          rationale: "레포 안 작업",
          injection_flags: [],
        },
        confidence: 0.8,
        rationale: "레포 안 작업",
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
    expect(rows[0]?.args.brief).toContain("## 수용 기준");
    const sessions = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM agent_sessions",
    );
    expect(sessions.rows[0]?.n).toBe("0");
  });
});
