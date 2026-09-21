// US-C04 / C-D5 (A4 §4.4, master §19 Q10): an open per-runtime, per-host, per-repo allow rule
// decides a delegate approval without a human — and every guard still sends it back to Logan.
import { createPool, one, query } from "@omnis/db";
import { type Kernel, createKernel, createLogger, setSetting } from "@omnis/kernel";
import type { HostId, HubMethod } from "@omnis/protocol";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { BridgeHub } from "../../src/bridge.js";
import { type DelegateExecutor, startDelegateExecutor } from "../../src/delegate-exec.js";

const HOST: HostId = "macbook";
/** The repo every rule in this file allows, and a workdir inside it. */
const REPO = "/repo/omnis";
const logger = createLogger("@omnis/hub", { sink: () => {} });

const calls: { host: HostId; method: HubMethod; params: Record<string, unknown> }[] = [];
let killSwitchOn = false;

const bridge: Pick<BridgeHub, "call" | "hosts"> = {
  hosts: () => [HOST],
  call: async <T>(host: HostId, method: HubMethod, params: Record<string, unknown>): Promise<T> => {
    calls.push({ host, method, params });
    const brief = params.brief as { approval_id: string };
    return {
      session_key: `agent:claude_ds:${HOST}:delegation-${brief.approval_id.slice(0, 8)}`,
      turn_id: "d-1",
    } as T;
  },
};

const killSwitch = { isOn: async (): Promise<boolean> => killSwitchOn };

let pool: Pool;
let kernel: Kernel;
let exec: DelegateExecutor;
let accountId = "";
let threadId = "";

beforeAll(async () => {
  pool = createPool();
  kernel = createKernel({ pool, logger });
  // No agent_runtimes row is seeded here on purpose: `applyRules` and `decide` never read that
  // table (requested_by/owner_runtime_id are nullable and left unset), and an extra pre-seeded
  // 'online' row would satisfy bridge.test.ts's heartbeat poll before its own registration lands.
  const account = await one<{ id: string }>(
    pool,
    `INSERT INTO accounts (channel, external_id, display)
       VALUES ('gmail', 'delegate-autonomy-test', 'delegate autonomy test')
     ON CONFLICT (channel, external_id) DO UPDATE SET display = EXCLUDED.display
     RETURNING id`,
  );
  accountId = account.id;
  const thread = await one<{ id: string }>(
    pool,
    `INSERT INTO threads (account_id, external_id, kind, meta)
       VALUES ($1, 'delegate-autonomy', 'email', '{}'::jsonb)
     ON CONFLICT (account_id, external_id) DO UPDATE SET meta = '{}'::jsonb
     RETURNING id`,
    [accountId],
  );
  threadId = thread.id;
  exec = startDelegateExecutor({
    pool,
    kernel,
    bridge,
    token: "test-autonomy-token",
    killSwitch,
    logger,
  });
});

beforeEach(async () => {
  calls.length = 0;
  killSwitchOn = false;
  await setSetting(pool, "delegation.allow_rules", [], "test");
  await setSetting(pool, "delegation.hermes_enabled", false, "test");
});

afterEach(() => {
  calls.length = 0;
});

afterAll(async () => {
  exec.stop();
  // The settings table is shared with every other integration file, and an open rule matches on
  // (runtime, host, workdir) — leave both keys at their defaults so this file cannot decide
  // another file's approvals.
  await setSetting(pool, "delegation.allow_rules", [], "test");
  await setSetting(pool, "delegation.hermes_enabled", false, "test");
  await kernel.close();
  await pool.end();
});

interface Seeded {
  id: string;
  taskId: string;
}

/** A delegation approval exactly as `propose_delegation` leaves one: a task whose source item is
 *  an inbox message, plus the pending row (args carry runtime/host/workdir/est_minutes). */
async function seedDelegate(
  over: {
    runtime?: string;
    host?: string;
    workdir?: string;
    /** `null` omits the key entirely — propose_delegation's `est_minutes` is optional. */
    est_minutes?: number | null;
    /** Provenance of the task's source item: none, a plain inbox item, or a flagged one. */
    source?: "none" | "inbox" | "flagged";
  } = {},
): Promise<Seeded> {
  let sourceItemId: string | null = null;
  if ((over.source ?? "inbox") !== "none") {
    const meta = over.source === "flagged" ? { injection_flags: ["instruction_override"] } : {};
    const item = await one<{ id: string }>(
      pool,
      `INSERT INTO items (thread_id, account_id, kind, status, sensitivity, body, sent_at, meta)
       VALUES ($1, $2, 'email', 'received', 'normal', 'Hand this to the agent.', now(), $3::jsonb)
       RETURNING id`,
      [threadId, accountId, JSON.stringify(meta)],
    );
    sourceItemId = item.id;
  }
  const task = await one<{ id: string }>(
    pool,
    `INSERT INTO tasks (title, kind, owner_kind, created_by, state, source_item_id)
       VALUES ('Delegate: fix the flaky test', 'delegation', 'agent', 'agent', 'open', $1)
     RETURNING id`,
    [sourceItemId],
  );
  const id = await kernel.approvals.propose({
    action: "delegate",
    args: {
      runtime: over.runtime ?? "claude_ds",
      host: over.host ?? HOST,
      workdir: over.workdir ?? `${REPO}/apps`,
      brief: "Fix the flaky delegation test",
      acceptance: ["pnpm test passes"],
      verify_cmd: "pnpm test",
      ...(over.est_minutes === null ? {} : { est_minutes: over.est_minutes ?? 10 }),
    },
    description: "Handing this task to a runtime.",
    thread_id: threadId,
    task_id: task.id,
  });
  return { id, taskId: task.id };
}

const approvalRow = (id: string) =>
  one<{ state: string; decision: string | null }>(
    pool,
    "SELECT state, decision FROM pending_approvals WHERE id = $1",
    [id],
  );

const decidedAudit = (id: string) =>
  one<{ actor: string; after: Record<string, unknown> }>(
    pool,
    `SELECT actor, after FROM audit_log
      WHERE action = 'approval.decided' AND target_id = $1`,
    [id],
  );

const callsFor = (approvalId: string): typeof calls =>
  calls.filter(
    (c) => (c.params.brief as { approval_id?: string } | undefined)?.approval_id === approvalId,
  );

/** The decision runs over pg_notify, so the executor may already have sent delegate.run — poll
 *  instead of assuming which side won the race (beginExecution is the mutex). */
async function until<T>(fn: () => Promise<T | null> | T | null, ms = 5000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const v = await fn();
    if (v !== null) return v;
    if (Date.now() - started > ms) throw new Error("condition never became true");
    await new Promise((r) => setTimeout(r, 20));
  }
}

const rule = (over: Partial<{ runtime: string; host: string; repo: string }> = {}) => ({
  runtime: over.runtime ?? "claude_ds",
  host: over.host ?? HOST,
  repo: over.repo ?? REPO,
});

const allow = (rules: unknown[]) => setSetting(pool, "delegation.allow_rules", rules, "test");

describe("hub delegation allow rules (US-C04)", () => {
  it("a matching rule decides the approval with no human, audits the rule, and runs the delegation", async () => {
    await allow([rule()]);
    const { id } = await seedDelegate();

    await exec.applyRules(id);

    // Only the decision is asserted here: the acceptance NOTIFY drives `execute`, which claims the
    // row into `executing` (and then `executed`) without waiting for this test. The lead-in state
    // is not readable from outside, so the settled state is asserted at the end instead.
    expect((await approvalRow(id)).decision).toBe("accept");
    // The audit trail still answers "why did this run without me?" (C-D5).
    const audit = await decidedAudit(id);
    expect(audit.actor).toBe("system");
    expect(audit.after).toMatchObject({
      state: "decided",
      decision: "accept",
      decided_by: "rule:0",
    });

    // Execution is the human path unchanged: the decided NOTIFY drives the same delegate.run.
    const call = await until(() => callsFor(id)[0] ?? null);
    expect(call).toMatchObject({ host: HOST, method: "delegate.run" });
    expect((await approvalRow(id)).state).toBe("executing");
  });

  it("records the index of the rule that matched, not the first rule", async () => {
    await allow([rule({ runtime: "codex" }), rule()]);
    const { id } = await seedDelegate();

    await exec.applyRules(id);

    expect((await decidedAudit(id)).after).toMatchObject({ decided_by: "rule:1" });
  });

  it("with no rule the approval stays pending and nothing runs", async () => {
    const { id } = await seedDelegate();

    await exec.applyRules(id);

    const row = await approvalRow(id);
    expect(row.state).toBe("pending");
    expect(row.decision).toBeNull();
    expect(callsFor(id)).toHaveLength(0);
  });

  it("leaves a non-delegate approval alone even when rules are open", async () => {
    await allow([rule()]);
    const send = await kernel.approvals.propose({
      action: "send",
      args: { text: "Sending it" },
      description: "US-C04 non-delegate control",
    });

    await exec.applyRules(send);

    expect((await approvalRow(send)).state).toBe("pending");
  });

  it("a brief over 30 minutes stays pending even with a matching rule (A4 §4.4)", async () => {
    await allow([rule()]);
    const { id } = await seedDelegate({ est_minutes: 31 });

    await exec.applyRules(id);

    expect((await approvalRow(id)).state).toBe("pending");
    expect(callsFor(id)).toHaveLength(0);
  });

  it("a brief with no estimate stays pending", async () => {
    await allow([rule()]);
    const { id, taskId } = await seedDelegate({ est_minutes: null });

    await exec.applyRules(id);

    expect((await approvalRow(id)).state).toBe("pending");
    // The task is untouched: a rule that does not fire leaves a normal approval card.
    const task = await one<{ state: string }>(pool, "SELECT state FROM tasks WHERE id = $1", [
      taskId,
    ]);
    expect(task.state).toBe("open");
  });

  it("a workdir outside the rule's repo stays pending", async () => {
    await allow([rule()]);
    const { id } = await seedDelegate({ workdir: `${REPO}-other/apps` });

    await exec.applyRules(id);

    expect((await approvalRow(id)).state).toBe("pending");
  });

  it("a workdir that escapes the repo with '..' stays pending", async () => {
    await allow([rule()]);
    const { id } = await seedDelegate({ workdir: `${REPO}/../secrets` });

    await exec.applyRules(id);

    expect((await approvalRow(id)).state).toBe("pending");
  });

  it("an injection-flagged source item stays pending", async () => {
    await allow([rule()]);
    const { id } = await seedDelegate({ source: "flagged" });

    await exec.applyRules(id);

    expect((await approvalRow(id)).state).toBe("pending");
  });

  it("a claude_code delegation from an inbox item stays pending (A2-D11)", async () => {
    await allow([rule({ runtime: "claude_code" })]);
    const { id } = await seedDelegate({ runtime: "claude_code" });

    await exec.applyRules(id);

    expect((await approvalRow(id)).state).toBe("pending");
    expect(callsFor(id)).toHaveLength(0);
  });

  it("a hermes target stays pending while delegation.hermes_enabled is false", async () => {
    await allow([rule({ runtime: "hermes" })]);
    const { id } = await seedDelegate({ runtime: "hermes" });

    await exec.applyRules(id);

    expect((await approvalRow(id)).state).toBe("pending");

    // The same rule with the flag on is allowed by the rule (execution is a separate story: the
    // runtime has to be a delegation target at all, US-C06/C07). Asserted on the audit row, not
    // on the state — execution may already have claimed and settled the row by now.
    await setSetting(pool, "delegation.hermes_enabled", true, "test");
    await exec.applyRules(id);
    expect((await decidedAudit(id)).after).toMatchObject({ decided_by: "rule:0" });
  });

  it("toggling a rule writes exactly one settings audit row (C-D5)", async () => {
    const count = async (): Promise<number> => {
      const rows = await query<{ n: string }>(
        pool,
        `SELECT count(*)::text AS n FROM audit_log
          WHERE action = 'settings.set' AND after->>'key' = 'delegation.allow_rules'`,
      );
      return Number(rows[0]?.n ?? "0");
    };
    const before = await count();

    await allow([rule()]);

    expect(await count()).toBe(before + 1);
    const latest = await one<{ after: { value: unknown[] } }>(
      pool,
      `SELECT after FROM audit_log
        WHERE action = 'settings.set' AND after->>'key' = 'delegation.allow_rules'
        ORDER BY at DESC LIMIT 1`,
    );
    expect(latest.after.value).toEqual([rule()]);
  });
});
