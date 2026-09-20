import { createPool, one, query } from "@omnis/db";
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
  args: { text: "draft" },
  description: "decide test",
  config: { allow_accept: true, allow_edit: true, allow_respond: false, allow_ignore: true },
  risk: "normal" as const,
};

describe("approvals.decide", () => {
  it("moves pending → decided and stores decision + decided_args + decided_at", async () => {
    const id = await approvals.propose({ ...base, action: "send" });
    await approvals.decide(id, { decision: "edit", decided_args: { text: "edited draft" } });

    const row = await one<{
      state: string;
      decision: string;
      decided_args: Record<string, unknown>;
      decided_at: Date;
    }>(
      pool,
      "SELECT state, decision, decided_args, decided_at FROM pending_approvals WHERE id = $1",
      [id],
    );
    expect(row.state).toBe("decided");
    expect(row.decision).toBe("edit");
    expect(row.decided_args.text).toBe("edited draft");
    expect(row.decided_at).toBeInstanceOf(Date);
  });

  it("accepts a decision with no decided_args", async () => {
    const id = await approvals.propose({ ...base, action: "delete" });
    await approvals.decide(id, { decision: "ignore" });
    const row = await one<{ decision: string; decided_args: unknown }>(
      pool,
      "SELECT decision, decided_args FROM pending_approvals WHERE id = $1",
      [id],
    );
    expect(row.decision).toBe("ignore");
    expect(row.decided_args).toBeNull();
  });

  it("refuses a second decide on the same approval", async () => {
    const id = await approvals.propose({ ...base, action: "send" });
    await approvals.decide(id, { decision: "accept" });
    await expect(approvals.decide(id, { decision: "ignore" })).rejects.toThrow(ApprovalStateError);
    await expect(approvals.decide(id, { decision: "ignore" })).rejects.toThrow(/not pending/);
  });

  it("refuses a decision the config disallows", async () => {
    const id = await approvals.propose({
      ...base,
      action: "delegate",
      config: { allow_accept: true, allow_edit: false, allow_respond: false, allow_ignore: true },
    });
    await expect(approvals.decide(id, { decision: "edit", decided_args: {} })).rejects.toThrow(
      /config forbids decision "edit"/,
    );
    const row = await one<{ state: string }>(
      pool,
      "SELECT state FROM pending_approvals WHERE id = $1",
      [id],
    );
    expect(row.state).toBe("pending");
  });

  it("refuses a decision on an expired approval", async () => {
    const id = await approvals.propose({
      ...base,
      action: "send",
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    });
    await expect(approvals.decide(id, { decision: "accept" })).rejects.toThrow(/expired/);
  });

  it("refuses an unknown id and an invalid decision value", async () => {
    await expect(
      approvals.decide("11111111-1111-1111-1111-111111111111", { decision: "accept" }),
    ).rejects.toThrow(/not found/);
    const id = await approvals.propose({ ...base, action: "send" });
    await expect(approvals.decide(id, { decision: "maybe" })).rejects.toThrow();
    await query(pool, "SELECT 1");
  });
});
