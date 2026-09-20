import { createPool, one } from "@omnis/db";
import { ApprovalStateError, type Approvals, createApprovals, createLogger } from "@omnis/kernel";
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

const base = {
  args: {},
  description: "state machine",
  config: { allow_accept: true, allow_edit: true, allow_respond: false, allow_ignore: true },
  risk: "normal" as const,
};

async function stateOf(id: string): Promise<string> {
  const row = await one<{ state: string }>(
    pool,
    `SELECT state FROM pending_approvals WHERE id = $1`,
    [id],
  );
  return row.state;
}

describe("approvals state machine", () => {
  it("walks pending → decided → executing → executed", async () => {
    const id = await approvals.propose({ ...base, action: "send" });
    expect(await stateOf(id)).toBe("pending");
    await approvals.decide(id, { decision: "accept" });
    expect(await stateOf(id)).toBe("decided");

    const claimed = await approvals.beginExecution(id);
    expect(claimed.decision).toBe("accept");
    expect(await stateOf(id)).toBe("executing");

    await approvals.completeExecution(id);
    expect(await stateOf(id)).toBe("executed");
    const row = await one<{ executed_at: Date }>(
      pool,
      `SELECT executed_at FROM pending_approvals WHERE id = $1`,
      [id],
    );
    expect(row.executed_at).toBeInstanceOf(Date);
  });

  it("walks decided → executing → failed and records the reason", async () => {
    const id = await approvals.propose({ ...base, action: "calendar_write" });
    await approvals.decide(id, { decision: "edit", decided_args: { when: "tomorrow" } });
    await approvals.beginExecution(id);
    await approvals.failExecution(id, "google returned 503");

    const row = await one<{ state: string; fail_reason: string }>(
      pool,
      `SELECT state, fail_reason FROM pending_approvals WHERE id = $1`,
      [id],
    );
    expect(row.state).toBe("failed");
    expect(row.fail_reason).toContain("503");
  });

  it("refuses to execute what was ignored or never decided", async () => {
    const ignored = await approvals.propose({ ...base, action: "send" });
    await approvals.decide(ignored, { decision: "ignore" });
    await expect(approvals.beginExecution(ignored)).rejects.toThrow(ApprovalStateError);
    await expect(approvals.beginExecution(ignored)).rejects.toThrow(/not executable/);

    const untouched = await approvals.propose({ ...base, action: "send" });
    await expect(approvals.beginExecution(untouched)).rejects.toThrow(/not executable/);
  });

  it("refuses a double beginExecution (at-most-once claim)", async () => {
    const id = await approvals.propose({ ...base, action: "delegate" });
    await approvals.decide(id, { decision: "accept" });
    await approvals.beginExecution(id);
    await expect(approvals.beginExecution(id)).rejects.toThrow(/not executable/);
  });

  it("expires a pending approval with decision='ignore' so approvals_decided_ck holds", async () => {
    const id = await approvals.propose({
      ...base,
      action: "send",
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    expect(await approvals.expire(id)).toBe(true);

    const row = await one<{ state: string; decision: string; decided_at: Date }>(
      pool,
      `SELECT state, decision, decided_at FROM pending_approvals WHERE id = $1`,
      [id],
    );
    expect(row.state).toBe("expired");
    expect(row.decision).toBe("ignore");
    expect(row.decided_at).toBeInstanceOf(Date);
  });

  it("does not expire an approval whose deadline has not passed", async () => {
    const id = await approvals.propose({
      ...base,
      action: "send",
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(await approvals.expire(id)).toBe(false);
    expect(await stateOf(id)).toBe("pending");
  });
});
