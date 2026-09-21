// US-C13, hub half: an approved `send` on a KakaoTalk thread never reaches the window on the first
// accept. The first execution is a dry run — the mini types nothing and answers a preview — and only
// accepting the second approval (`args.confirm_of` = the first one's id) sends for real.
import { randomUUID } from "node:crypto";
import { createPool, one, query } from "@omnis/db";
import { type Kernel, createKernel, createLogger, setSetting } from "@omnis/kernel";
import { type HostId, type HubMethod, verifyApproval } from "@omnis/protocol";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeHub } from "../../src/bridge.js";
import {
  type CaptureSendExecutor,
  captureRelayRegistry,
  startCaptureSendExecutor,
} from "../../src/capture-relay.js";

const TOKEN = "test-kakao-dry-run-token";
/** C-D3: kmsg needs Accessibility, so `capture.send` always goes to the mini. */
const HOST: HostId = "mini";
const DAY_MS = 86_400_000;
const ago = (days: number): string => new Date(Date.now() - days * DAY_MS).toISOString();

const logger = createLogger("@omnis/hub", { sink: () => {} });

interface Call {
  host: HostId;
  method: HubMethod;
  params: Record<string, unknown>;
}

const calls: Call[] = [];

/** The mini's half of the contract (apps/local-agent/src/capture.ts): a dry run types nothing and
 *  the preview is what it would have typed. */
const answer = (params: Record<string, unknown>): { preview: string; sent: boolean } => ({
  preview: `kakao dry run: ${String(params.text)}`,
  sent: params.dry_run !== true,
});

const bridgeCall = vi.fn(
  async (host: HostId, method: HubMethod, params: Record<string, unknown>) => {
    calls.push({ host, method, params });
    return answer(params);
  },
);

/** One relay table, the same shape main.ts builds: the factory registers the relay the executor
 *  looks up, so `capture.send` travels the production signing path. */
const relays = captureRelayRegistry();
relays
  .factories({ call: bridgeCall as unknown as BridgeHub["call"], token: TOKEN, host: HOST })
  .kakaotalk?.();

const captureCalls = (): Call[] => calls.filter((c) => c.method === "capture.send");
const realCalls = (): Call[] => captureCalls().filter((c) => c.params.dry_run !== true);

async function until<T>(fn: () => Promise<T | null> | T | null, ms = 5000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const v = await fn();
    if (v !== null) return v;
    if (Date.now() - started > ms) throw new Error("condition never became true");
    await new Promise((r) => setTimeout(r, 20));
  }
}

let pool: Pool;
let kernel: Kernel;
let exec: CaptureSendExecutor;
let kakaoThreadId: string;

interface ApprovalRow {
  state: string;
  fail_reason: string | null;
  args: Record<string, unknown>;
}

const approvalRow = (id: string): Promise<ApprovalRow> =>
  one<ApprovalRow>(pool, "SELECT state, fail_reason, args FROM pending_approvals WHERE id = $1", [
    id,
  ]);

const failedRow = (id: string): Promise<ApprovalRow | null> =>
  until(async () => {
    const row = await approvalRow(id);
    return row.state === "failed" ? row : null;
  });

/** The approval the executor proposes after a dry run: same args, plus `confirm_of` and the preview. */
async function pendingConfirm(dryRunId: string): Promise<{ id: string; state: string } | null> {
  const rows = await query<{ id: string; state: string }>(
    pool,
    `SELECT id, state FROM pending_approvals
      WHERE action = 'send' AND args->>'confirm_of' = $1 AND state = 'pending'`,
    [dryRunId],
  );
  return rows[0] ?? null;
}

/** An approved action is executed by the executor's own NOTIFY subscription, so the tests decide
 *  and then poll — the same shape apps/hub/test/integration/delegate-exec.test.ts uses. */
async function decide(id: string): Promise<void> {
  await kernel.approvals.decide(id, { decision: "accept" });
}

async function proposeSend(threadId: string, args: Record<string, unknown> = {}): Promise<string> {
  return await kernel.approvals.propose({
    action: "send",
    args: { text: "on my way", ...args },
    description: "Send the drafted KakaoTalk reply",
    thread_id: threadId,
  });
}

async function insertAccount(channel: string, externalId: string): Promise<string> {
  const row = await one<{ id: string }>(
    pool,
    `INSERT INTO accounts (channel, external_id, display) VALUES ($1, $2, $1)
       ON CONFLICT (channel, external_id) DO UPDATE SET display = EXCLUDED.display
     RETURNING id`,
    [channel, externalId],
  );
  return row.id;
}

beforeAll(async () => {
  pool = createPool();
  kernel = createKernel({ pool, logger });
  const accountId = await insertAccount("kakaotalk", "kakaotalk:me");
  const thread = await one<{ id: string }>(
    pool,
    `INSERT INTO threads (account_id, external_id, kind, title)
       VALUES ($1, 'chat-with-myself', 'dm', 'chat with myself') RETURNING id`,
    [accountId],
  );
  kakaoThreadId = thread.id;
  exec = startCaptureSendExecutor({ pool, kernel, relays, logger });
});

beforeEach(async () => {
  calls.length = 0;
  await kernel.killSwitch.set(false, "kakao dry-run test reset");
  // The gate open, per test: 20 stable days and an opt-in. The closed cases override these.
  await setSetting(pool, "kakao.read_stable_since", ago(20), "test");
  await setSetting(pool, "kakao.send_enabled_at", ago(1), "test");
});

afterAll(async () => {
  exec.stop();
  await kernel.close();
  await pool.end();
});

describe("KakaoTalk send gate (US-C13)", () => {
  it("the first accept dry-runs, stores the preview, and proposes the confirm", async () => {
    const id = await proposeSend(kakaoThreadId);
    await decide(id);

    const confirm = await until(() => pendingConfirm(id));
    const row = await approvalRow(id);

    // Exactly one call, and it is a dry run: the mini's `dry_run` flag is what keeps kmsg from
    // typing, and nothing asked for a real send yet.
    expect(captureCalls()).toHaveLength(1);
    expect(realCalls()).toHaveLength(0);
    const call = captureCalls()[0];
    expect(call?.host).toBe(HOST);
    expect(call?.params).toMatchObject({
      channel: "kakaotalk",
      thread_external_id: "chat-with-myself",
      text: "on my way",
      dry_run: true,
      approval_id: id,
    });
    // The mini's half (handleCaptureSend) verifies exactly this object against the approval id.
    expect(
      verifyApproval(
        TOKEN,
        id,
        {
          channel: "kakaotalk",
          thread_external_id: "chat-with-myself",
          text: "on my way",
          dry_run: true,
        },
        String(call?.params.sig),
      ),
    ).toBe(true);

    expect(row.state).toBe("executed");
    // The preview is what the confirm card shows, and the confirm carries its own copy.
    expect(row.args.dry_run_preview).toBe("kakao dry run: on my way");
    expect(confirm?.id).not.toBe(id);
  });

  it("accepting the confirm is the only path to a real send", async () => {
    const dryRunId = await proposeSend(kakaoThreadId);
    await decide(dryRunId);
    const confirm = await until(() => pendingConfirm(dryRunId));
    expect(confirm).not.toBeNull();
    expect(realCalls()).toHaveLength(0);

    await decide(confirm.id);

    await until(() => (realCalls().length === 1 ? true : null));
    // One dry run, one real send — never a second real send of the same approval.
    expect(captureCalls()).toHaveLength(2);
    const real = realCalls()[0];
    expect(real?.params).toMatchObject({
      channel: "kakaotalk",
      thread_external_id: "chat-with-myself",
      text: "on my way",
      dry_run: false,
      approval_id: confirm.id,
    });
    expect((await approvalRow(confirm.id)).state).toBe("executed");
    // US-C22 reads this row: the send that left the machine is audited as item.sent.
    const audited = await query<{ action: string }>(
      pool,
      "SELECT action FROM audit_log WHERE approval_id = $1 AND action = 'item.sent'",
      [confirm.id],
    );
    expect(audited).toHaveLength(1);
  });

  it.each([
    ["no stable read", null, null, "no_stable_read"],
    ["ten days in", ago(10), null, "counting"],
    // An opt-in that arrived during the count does not shorten it.
    ["ten days in with an early opt-in", ago(10), ago(1), "counting"],
    ["stable read but no opt-in", ago(20), null, "awaiting_opt_in"],
  ])(
    "a closed gate (%s) fails the approval and calls capture.send zero times",
    async (_name, stable, optIn, reason) => {
      await setSetting(pool, "kakao.read_stable_since", stable, "test");
      await setSetting(pool, "kakao.send_enabled_at", optIn, "test");
      const id = await proposeSend(kakaoThreadId);
      await decide(id);

      expect((await failedRow(id)).fail_reason).toBe(`kakao send closed (${reason})`);
      expect(captureCalls()).toHaveLength(0);
    },
  );

  it("refuses a confirm_of that names no executed dry run", async () => {
    const unknown = await proposeSend(kakaoThreadId, { confirm_of: randomUUID() });
    await decide(unknown);
    expect((await failedRow(unknown)).fail_reason).toContain("is not a send approval");

    // A send approval that never ran is not a dry run either, even though it is a `send` row.
    const neverRan = await proposeSend(kakaoThreadId);
    const forged = await proposeSend(kakaoThreadId, { confirm_of: neverRan });
    await decide(forged);
    expect((await failedRow(forged)).fail_reason).toContain("not an executed dry run");
  });

  it("refuses a confirm that chains off another confirm", async () => {
    const dryRunId = await proposeSend(kakaoThreadId);
    await decide(dryRunId);
    const confirm = await until(() => pendingConfirm(dryRunId));
    await decide(confirm.id);
    await until(() => (realCalls().length === 1 ? true : null));

    // The confirm is itself an executed `send` carrying a preview, so without this check a third
    // approval naming it would reach the window for real — and the dry run would be optional from
    // the second real send on. US-C13 allows exactly one: the second approval.
    const chained = await proposeSend(kakaoThreadId, { confirm_of: confirm.id });
    await decide(chained);

    expect((await failedRow(chained)).fail_reason).toContain("not a dry run");
    expect(realCalls()).toHaveLength(1);
  });

  it("refuses a second send backed by a dry run that already sent", async () => {
    const dryRunId = await proposeSend(kakaoThreadId);
    await decide(dryRunId);
    const confirm = await until(() => pendingConfirm(dryRunId));
    await decide(confirm.id);
    await until(() => (realCalls().length === 1 ? true : null));

    // Same text, so every text check passes: only the dry run being spent can refuse this one.
    const reuse = await proposeSend(kakaoThreadId, { confirm_of: dryRunId });
    await decide(reuse);

    expect((await failedRow(reuse)).fail_reason).toContain("already backed a send");
    expect(realCalls()).toHaveLength(1);
  });

  it("refuses a confirm whose text the dry run never previewed", async () => {
    const dryRunId = await proposeSend(kakaoThreadId);
    await decide(dryRunId);
    await until(() => pendingConfirm(dryRunId));

    // The dry run previewed "on my way"; this names it while carrying something else entirely, which
    // is how an agent would get unreviewed text typed for real without a dry run of its own.
    const swapped = await proposeSend(kakaoThreadId, {
      text: "wire the deposit today",
      confirm_of: dryRunId,
    });
    await decide(swapped);

    expect((await failedRow(swapped)).fail_reason).toContain("previewed different text");
    expect(realCalls()).toHaveLength(0);
  });

  it("ignores a send approval on a channel it does not relay", async () => {
    const accountId = await insertAccount("slack", "slack:test");
    const thread = await one<{ id: string }>(
      pool,
      `INSERT INTO threads (account_id, external_id, kind, title)
         VALUES ($1, $2, 'dm', 'other channel') RETURNING id`,
      [accountId, `other-${randomUUID()}`],
    );
    const id = await proposeSend(thread.id);
    await decide(id);

    // Nothing to wait for on the happy path, so give the notification time to land before asserting
    // that it did nothing.
    await new Promise((r) => setTimeout(r, 150));
    expect((await approvalRow(id)).state).toBe("decided");
    expect(captureCalls()).toHaveLength(0);
  });

  it("kill switch on → no capture.send, approval failed with the switch's reason", async () => {
    await kernel.killSwitch.set(true, "freeze");
    const id = await proposeSend(kakaoThreadId);
    await decide(id);

    expect((await failedRow(id)).fail_reason).toBe("kill switch");
    expect(captureCalls()).toHaveLength(0);
  });
});
