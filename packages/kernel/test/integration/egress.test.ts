import type { Adapter, Outbound, SendResult, ThreadRef } from "@omnis/protocol";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPool, one } from "@omnis/db";
import {
  ApprovalStateError,
  type EgressToken,
  KillSwitchError,
  type Kernel,
  createKernel,
  createOutbox,
  runEgress,
} from "@omnis/kernel";

let pool: Pool;
let kernel: Kernel;
const sent: Array<{ ref: ThreadRef; draft: Outbound }> = [];
let failNext = false;

const fakeAdapter = {
  id: "slack-test",
  channel: "slack",
  capabilities: () => ({
    read: true,
    write: true,
    realtime: true,
    history: true,
    media: false,
    markRead: true,
    typing: false,
    archive: true,
    delete: false,
  }),
  connect: async () => undefined,
  backfill: async function* () {},
  subscribe: async function* () {},
  async send(ref: ThreadRef, draft: Outbound): Promise<SendResult> {
    if (failNext) throw new Error("slack 503");
    sent.push({ ref, draft });
    return { externalId: "1758.000900", sentAt: new Date().toISOString() };
  },
  health: async () => ({
    channel: "slack" as const,
    accountExternalId: "T1",
    status: "healthy" as const,
    lastEventAt: null,
  }),
} as unknown as Adapter;

let outbox: ReturnType<typeof createOutbox>;

beforeAll(() => {
  pool = createPool();
  kernel = createKernel({ pool });
  outbox = createOutbox({ adapters: new Map([["slack", fakeAdapter]]) });
});
beforeEach(async () => {
  sent.length = 0;
  failNext = false;
  await kernel.killSwitch.set(false, "egress test reset");
});
afterAll(async () => {
  await kernel.close();
  await pool.end();
});

const base = {
  args: { text: "보냅니다" },
  description: "Slack 답장 발송",
  config: { allow_accept: true, allow_edit: true, allow_respond: false, allow_ignore: true },
  risk: "normal" as const,
};

async function approved(): Promise<string> {
  const id = await kernel.approvals.propose({ ...base, action: "send" });
  await kernel.approvals.decide(id, { decision: "accept" });
  return id;
}

describe("runEgress", () => {
  it("executes, marks the approval executed, and audits with approval_id", async () => {
    const approvalId = await approved();
    const result = await runEgress(
      kernel,
      { approvalId, actor: "me", action: "item.sent", targetTable: "items" },
      (token: EgressToken) =>
        outbox.send(token, { accountId: "a", externalId: "C1" }, { text: "보냅니다" }),
    );
    expect(result.externalId).toBe("1758.000900");
    expect(sent).toHaveLength(1);

    const ap = await one<{ state: string }>(
      pool,
      `SELECT state FROM pending_approvals WHERE id = $1`,
      [approvalId],
    );
    expect(ap.state).toBe("executed");

    const log = await one<{ approval_id: string; after: Record<string, unknown> }>(
      pool,
      `SELECT approval_id, after FROM audit_log WHERE approval_id = $1 ORDER BY seq DESC LIMIT 1`,
      [approvalId],
    );
    expect(log.approval_id).toBe(approvalId);
    expect(log.after.ok).toBe(true);
  });

  it("refuses to run when the kill switch is on — before touching the adapter", async () => {
    const approvalId = await approved();
    await kernel.killSwitch.set(true, "freeze");
    await expect(
      runEgress(
        kernel,
        { approvalId, actor: "me", action: "item.sent", targetTable: "items" },
        (t) => outbox.send(t, { accountId: "a", externalId: "C1" }, { text: "x" }),
      ),
    ).rejects.toThrow(KillSwitchError);
    expect(sent).toHaveLength(0);

    const ap = await one<{ state: string }>(
      pool,
      `SELECT state FROM pending_approvals WHERE id=$1`,
      [approvalId],
    );
    expect(ap.state).toBe("decided");
  });

  it("refuses an approval that was never decided, and never calls the adapter", async () => {
    const approvalId = await kernel.approvals.propose({ ...base, action: "send" });
    await expect(
      runEgress(
        kernel,
        { approvalId, actor: "me", action: "item.sent", targetTable: "items" },
        (t) => outbox.send(t, { accountId: "a", externalId: "C1" }, { text: "x" }),
      ),
    ).rejects.toThrow(ApprovalStateError);
    expect(sent).toHaveLength(0);
  });

  it("refuses an approval that was ignored", async () => {
    const approvalId = await kernel.approvals.propose({ ...base, action: "send" });
    await kernel.approvals.decide(approvalId, { decision: "ignore" });
    await expect(
      runEgress(
        kernel,
        { approvalId, actor: "me", action: "item.sent", targetTable: "items" },
        (t) => outbox.send(t, { accountId: "a", externalId: "C1" }, { text: "x" }),
      ),
    ).rejects.toThrow(/not executable/);
  });

  it("marks the approval failed and still audits when the adapter throws", async () => {
    const approvalId = await approved();
    failNext = true;
    await expect(
      runEgress(
        kernel,
        { approvalId, actor: "me", action: "item.sent", targetTable: "items" },
        (t) => outbox.send(t, { accountId: "a", externalId: "C1" }, { text: "x" }),
      ),
    ).rejects.toThrow(/slack 503/);

    const ap = await one<{ state: string; fail_reason: string }>(
      pool,
      `SELECT state, fail_reason FROM pending_approvals WHERE id = $1`,
      [approvalId],
    );
    expect(ap.state).toBe("failed");
    expect(ap.fail_reason).toContain("503");

    const log = await one<{ after: Record<string, unknown> }>(
      pool,
      `SELECT after FROM audit_log WHERE approval_id = $1 ORDER BY seq DESC LIMIT 1`,
      [approvalId],
    );
    expect(log.after.ok).toBe(false);
  });

  it("cannot be bypassed: outbox.send needs a token only runEgress can mint", () => {
    // @ts-expect-error — 토큰 없이 부르면 컴파일되지 않는다. 이것이 강제 장치다.
    void (() => outbox.send({ accountId: "a", externalId: "C1" }, { text: "x" }));
  });

  it("never leaks the raw adapter, so nothing can call send() directly", () => {
    expect(Object.keys(outbox)).toEqual(["send"]);
  });
});
