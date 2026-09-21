// US-C03: the hub turns a decided delegate approval into a signed delegate.run, then attaches the
// result back to the originating thread. A2 §5.1 path, §5.3 attachment, §5.4 failure table.
import { randomUUID } from "node:crypto";
import { createPool, one, query } from "@omnis/db";
import { type Kernel, createKernel, createLogger } from "@omnis/kernel";
import {
  BRIDGE_ERRORS,
  BridgeError,
  type BridgeErrorCode,
  type HostId,
  type HubMethod,
  verifyApproval,
} from "@omnis/protocol";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { BridgeHub } from "../../src/bridge.js";
import { type DelegateExecutor, startDelegateExecutor } from "../../src/delegate-exec.js";
import { ensureSession } from "../../src/sessions.js";

const TOKEN = "test-delegate-exec-token";
const HOST: HostId = "macbook";

const logger = createLogger("@omnis/hub", { sink: () => {} });

// ---- the fake bridge: records every hub → host call, and answers delegate.run like the real
// local-agent does (`agent:{runtime}:{host}:delegation-{id8}`, apps/local-agent/src/delegate.ts).

interface Call {
  host: HostId;
  method: HubMethod;
  params: Record<string, unknown>;
}

const calls: Call[] = [];
let connected: HostId[] = [HOST];
/** Set to make the next delegate.run fail the way the real bridge does (A2 §3.4 error codes). */
let bridgeError: { code: BridgeErrorCode; message: string } | null = null;
let killSwitchOn = false;

const bridge: Pick<BridgeHub, "call" | "hosts"> = {
  hosts: () => [...connected],
  call: async <T>(host: HostId, method: HubMethod, params: Record<string, unknown>): Promise<T> => {
    calls.push({ host, method, params });
    if (bridgeError !== null) throw new BridgeError(bridgeError.code, bridgeError.message);
    const brief = params.brief as { approval_id: string; target: { runtime: string } };
    return {
      session_key: delegationKey(brief.approval_id, brief.target.runtime),
      turn_id: "d-1",
    } as T;
  },
};

const killSwitch = {
  isOn: async (): Promise<boolean> => killSwitchOn,
};

/** The local-agent's own session_key formula (apps/local-agent/src/delegate.ts). */
const delegationKey = (approvalId: string, runtime = "claude_ds", host = HOST): string =>
  `agent:${runtime}:${host}:delegation-${approvalId.slice(0, 8)}`;

// ---- seeding ----

interface Seeded {
  id: string;
  taskId: string;
  threadId: string;
}

async function seedDelegate(
  overrides: Partial<{ runtime: string; host: string; workdir: string; verify_cmd: string }> = {},
): Promise<Seeded> {
  const account = await one<{ id: string }>(
    pool,
    `INSERT INTO accounts (channel, external_id, display)
       VALUES ('agent', 'delegate-exec-test', 'delegate exec test')
       ON CONFLICT (channel, external_id) DO UPDATE SET display = EXCLUDED.display
     RETURNING id`,
  );
  const thread = await one<{ id: string }>(
    pool,
    `INSERT INTO threads (account_id, external_id, kind, title, last_item_at)
       VALUES ($1, $2, 'agent_session', 'delegation source', now()) RETURNING id`,
    [account.id, `delegate-exec-${randomUUID()}`],
  );
  const task = await one<{ id: string }>(
    pool,
    `INSERT INTO tasks (title, kind, owner_kind, created_by, state)
       VALUES ('Delegate: fix the flaky test', 'delegation', 'agent', 'agent', 'open') RETURNING id`,
  );
  const id = await kernel.approvals.propose({
    action: "delegate",
    args: {
      runtime: overrides.runtime ?? "claude_ds",
      host: overrides.host ?? HOST,
      workdir: overrides.workdir ?? "/repo/omnis",
      brief: "Fix the flaky delegation test",
      inputs: ["/repo/omnis/apps/hub"],
      verify_cmd: overrides.verify_cmd ?? "pnpm test",
    },
    description: "Handing this task to claude_ds on macbook.",
    thread_id: thread.id,
    task_id: task.id,
  });
  return { id, taskId: task.id, threadId: thread.id };
}

/** A pending approval that is not a delegation (a normal send card). */
async function seedSendApproval(): Promise<string> {
  return await kernel.approvals.propose({
    action: "send",
    args: { text: "Sending it" },
    description: "US-C03 non-delegate control",
  });
}

const approvalRow = (id: string) =>
  one<{ state: string; decision: string | null; fail_reason: string | null }>(
    pool,
    "SELECT state, decision, fail_reason FROM pending_approvals WHERE id = $1",
    [id],
  );

const taskRow = (taskId: string) =>
  one<{ state: string; delegated_session_id: string | null }>(
    pool,
    "SELECT state, delegated_session_id FROM tasks WHERE id = $1",
    [taskId],
  );

const systemItems = (threadId: string) =>
  query<{ body: string }>(pool, "SELECT body FROM items WHERE thread_id = $1 AND kind = 'system'", [
    threadId,
  ]);

const callsFor = (approvalId: string): Call[] =>
  calls.filter(
    (c) => (c.params.brief as { approval_id?: string } | undefined)?.approval_id === approvalId,
  );

const pendingForTask = (taskId: string) =>
  query<{ runtime: string }>(
    pool,
    `SELECT args->>'runtime' AS runtime FROM pending_approvals
      WHERE task_id = $1 AND state = 'pending' AND action = 'delegate'`,
    [taskId],
  );

/** Drives the turn.completed notification the local-agent sends when a delegated turn ends. */
async function completeTurn(approvalId: string, status: "ok" | "failed"): Promise<void> {
  await exec.onTurnCompleted(HOST, {
    session_key: delegationKey(approvalId),
    turn_id: "d-1",
    status,
    usage: { cost_usd: null, duration_ms: 12, num_turns: 1 },
  });
}

/** The decision lands over pg_notify, so the executor may already have run — poll instead of
 *  assuming which side won the race (beginExecution is the mutex; exactly one side proceeds). */
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
let exec: DelegateExecutor;

beforeAll(async () => {
  pool = createPool();
  kernel = createKernel({ pool, logger });
  for (const runtime of ["claude_ds", "claude_code", "codex"]) {
    await query(
      pool,
      `INSERT INTO agent_runtimes (runtime, host, display, state)
         VALUES ($1, $2, $1, 'online')
       ON CONFLICT (runtime, host) DO UPDATE SET state = 'online'`,
      [runtime, HOST],
    );
  }
  exec = startDelegateExecutor({ pool, kernel, bridge, token: TOKEN, killSwitch, logger });
});

afterEach(() => {
  connected = [HOST];
  bridgeError = null;
  killSwitchOn = false;
});

afterAll(async () => {
  exec.stop();
  await kernel.close();
  await pool.end();
});

describe("hub delegation executor (US-C03)", () => {
  it("a decided delegate approval is signed, sent to the target host, and marked executing", async () => {
    const { id } = await seedDelegate({
      runtime: "claude_ds",
      host: "macbook",
      workdir: "/repo/omnis",
      verify_cmd: "pnpm test",
    });
    await kernel.approvals.decide(id, { decision: "accept" });
    await exec.execute(id);

    const call = await until(() => callsFor(id)[0] ?? null);
    expect(call).toMatchObject({ host: "macbook", method: "delegate.run" });
    const { brief, sig } = call.params as { brief: Record<string, unknown>; sig: string };
    expect(verifyApproval(TOKEN, id, brief, sig)).toBe(true);
    expect(brief).toMatchObject({
      approval_id: id,
      goal: "Fix the flaky delegation test",
      inputs: ["/repo/omnis/apps/hub"],
      verify: "pnpm test",
      output: "diff",
      target: { runtime: "claude_ds", host: "macbook", cwd: "/repo/omnis" },
    });
    expect((await approvalRow(id)).state).toBe("executing");
  });

  it("an edit decision signs the edited args, not the proposed ones", async () => {
    const { id } = await seedDelegate({ verify_cmd: "pnpm test" });
    await kernel.approvals.decide(id, {
      decision: "edit",
      decided_args: { verify_cmd: "pnpm test:unit" },
    });
    await exec.execute(id);

    const call = await until(() => callsFor(id)[0] ?? null);
    const { brief, sig } = call.params as { brief: Record<string, unknown>; sig: string };
    expect((brief as { verify: string }).verify).toBe("pnpm test:unit");
    expect(verifyApproval(TOKEN, id, brief, sig)).toBe(true);
    expect((await approvalRow(id)).state).toBe("executing");
  });

  it("turn.completed ok → approval executed, system Item on the source thread, tasks.delegated_session_id set", async () => {
    const { id, taskId, threadId } = await seedDelegate();
    const session = await ensureSession(pool, {
      runtime: "claude_ds",
      host: HOST,
      sessionKey: delegationKey(id),
    });
    await kernel.approvals.decide(id, { decision: "accept" });
    await exec.execute(id);

    await completeTurn(id, "ok");

    expect((await approvalRow(id)).state).toBe("executed");
    const task = await taskRow(taskId);
    expect(task.delegated_session_id).toBe(session.id);
    const items = await systemItems(threadId);
    expect(items).toHaveLength(1);
    expect(items[0]?.body).toContain("Delegation");
    expect(callsFor(id)).toHaveLength(1);
  });

  it("turn.completed failed → approval failed, task blocked, one failure system Item, no second delegate.run", async () => {
    const { id, taskId, threadId } = await seedDelegate();
    await kernel.approvals.decide(id, { decision: "accept" });
    await exec.execute(id);
    await until(() => callsFor(id)[0] ?? null);

    // A failed `verify` arrives as a bare status, with no error object (apps/local-agent/src/delegate.ts).
    await completeTurn(id, "failed");

    const row = await approvalRow(id);
    expect(row.state).toBe("failed");
    expect(row.fail_reason).toBe("turn failed");
    expect((await taskRow(taskId)).state).toBe("blocked");
    expect(await systemItems(threadId)).toHaveLength(1);
    // A2 §5.4: failure never re-runs itself.
    expect(callsFor(id)).toHaveLength(1);
  });

  it("-32009 from the bridge → approval failed + exactly one new pending approval for another runtime", async () => {
    const { id, taskId } = await seedDelegate({ runtime: "claude_ds" });
    bridgeError = { code: BRIDGE_ERRORS.RUNTIME_RATE_LIMITED, message: "rate limited" };
    await kernel.approvals.decide(id, { decision: "accept" });
    await exec.execute(id);

    await until(async () => ((await approvalRow(id)).state === "failed" ? true : null));
    const row = await approvalRow(id);
    expect(row.fail_reason).toContain("rate limited");

    const pending = await pendingForTask(taskId);
    expect(pending).toHaveLength(1);
    // claude_ds ↔ claude_code (never hermes, A2 §5.4).
    expect(pending[0]?.runtime).toBe("claude_code");
    expect(callsFor(id)).toHaveLength(1);
  });

  it("kill switch on → no bridge call, approval failed with reason 'kill switch'", async () => {
    const { id } = await seedDelegate();
    killSwitchOn = true;
    await kernel.approvals.decide(id, { decision: "accept" });
    await exec.execute(id);

    // Wait for the settled state, not for "no longer decided": the claim (`executing`) is a
    // transient step before failExecution, and polling on `!== "decided"` can catch it.
    await until(async () => ((await approvalRow(id)).state === "failed" ? true : null));
    const row = await approvalRow(id);
    expect(row.state).toBe("failed");
    expect(row.fail_reason).toBe("kill switch");
    expect(callsFor(id)).toHaveLength(0);
  });

  it("target host not connected → approval stays decided (retried when the host reconnects), no failure yet", async () => {
    const { id } = await seedDelegate({ host: HOST });
    connected = [];
    await kernel.approvals.decide(id, { decision: "accept" });
    await exec.execute(id);

    const row = await approvalRow(id);
    expect(row.state).toBe("decided");
    expect(row.fail_reason).toBeNull();
    expect(callsFor(id)).toHaveLength(0);

    // The host comes back — the bridge tells the executor, which re-drives the decided rows.
    connected = [HOST];
    await exec.redrive(HOST);
    await until(() => callsFor(id)[0] ?? null);
    expect((await approvalRow(id)).state).toBe("executing");
  });

  it("an ignore decision or a non-delegate action is never executed", async () => {
    const ignored = await seedDelegate();
    await kernel.approvals.decide(ignored.id, { decision: "ignore" });
    await exec.execute(ignored.id);
    expect((await approvalRow(ignored.id)).state).toBe("decided");
    expect(callsFor(ignored.id)).toHaveLength(0);

    const send = await seedSendApproval();
    const before = calls.length;
    await kernel.approvals.decide(send, { decision: "accept" });
    await exec.execute(send);
    expect((await approvalRow(send)).state).toBe("decided");
    expect(calls).toHaveLength(before);
  });
});
