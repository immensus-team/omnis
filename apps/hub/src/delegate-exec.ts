// A2 §5.1/§5.3/§5.4 + A4 §5.4. The kernel, not an agent, turns a decided approval into a bridge
// call. No automatic retry anywhere: every retry is a new approval a human presses.
import { query } from "@omnis/db";
import type { Kernel, Logger, PendingApproval } from "@omnis/kernel";
import type { KillSwitch } from "@omnis/kernel";
import {
  BRIDGE_ERRORS,
  BridgeError,
  DelegationBrief,
  type HostId,
  signApproval,
} from "@omnis/protocol";
import type { Pool } from "pg";
import type { z } from "zod";
import type { BridgeHub } from "./bridge.js";

export interface DelegateExecDeps {
  pool: Pool;
  kernel: Kernel;
  bridge: Pick<BridgeHub, "call" | "hosts">;
  /** Value of Keychain omnis.bridge.token.<host> — the same secret the bridge verifies with (A2-D8). */
  token: string;
  killSwitch: Pick<KillSwitch, "isOn">;
  logger: Logger;
}

export interface DelegateExecutor {
  execute(approvalId: string): Promise<void>;
  onTurnCompleted(host: HostId, p: Record<string, unknown>): Promise<void>;
  /** Called when a host connects, to re-drive the approvals skipped while it was offline.
   *  The plan's DelegateExecutor did not list it; bridge.ts needs a connect hook for A2 §5.4's
   *  "keep the process, queue to outbox" row. */
  redrive(host: HostId): Promise<void>;
  stop(): void;
}

/** A2 §5.4: one re-approval on the other code runtime after a rate limit. hermes and omnis are not
 *  targets we retry onto, so they have no entry and the approval simply stays failed. */
const FALLBACK_RUNTIME: Readonly<Record<string, string | undefined>> = {
  claude_ds: "claude_code",
  claude_code: "claude_ds",
  codex: "claude_code",
};

/** A2 §5.2's five fixed fields, assembled from the approval's args. `decided_args` (an `edit`
 *  decision) wins over the proposed args — the human's edits are what gets signed. */
export function briefFromApproval(a: PendingApproval): z.input<typeof DelegationBrief> {
  const args = { ...a.args, ...(a.decided_args ?? {}) } as Record<string, unknown>;
  return {
    approval_id: a.id,
    // The jsonb args are untyped, so the three enums/strings are cast here and validated by
    // DelegationBrief in execute() before anything is signed or sent.
    target: {
      runtime: String(args.runtime) as z.input<typeof DelegationBrief>["target"]["runtime"],
      host: String(args.host) as HostId,
      cwd: String(args.workdir),
    },
    goal: String(args.brief),
    inputs: Array.isArray(args.inputs) ? args.inputs.map(String) : [],
    verify: String(args.verify_cmd),
    output: "diff" as const,
    timeout_ms: 900_000, // A2 §5.2 default, written out so the signed object never depends on a zod default
    ...(a.item_id !== null ? { source_item_id: a.item_id } : {}),
  };
}

interface Running {
  approvalId: string;
  taskId: string | null;
  threadId: string | null;
  /** `<runtime>@<host> — <goal>`, the human-readable half of the result line. */
  summary: string;
}

export function startDelegateExecutor(deps: DelegateExecDeps): DelegateExecutor {
  const { pool, logger } = deps;
  const running = new Map<string, Running>();

  /** Direct row read, not `approvals.list()`: list is capped (50 by default) and a decided
   *  approval outside that window would sit unexecuted forever. */
  async function loadDecided(id: string): Promise<PendingApproval | null> {
    const rows = await query<PendingApproval>(
      pool,
      "SELECT * FROM pending_approvals WHERE id = $1",
      [id],
    );
    const row = rows[0];
    return row !== undefined && row.state === "decided" ? row : null;
  }

  /** Claim then fail. A claim that loses the race means another caller owns the outcome — the
   *  guarded UPDATE in beginExecution is the only mutex between the NOTIFY subscriber, an explicit
   *  call and a reconnect re-drive. */
  async function claimAndFail(id: string, reason: string): Promise<void> {
    try {
      await deps.kernel.approvals.beginExecution(id);
    } catch (e) {
      logger.debug("delegation already claimed", {
        id,
        err: e instanceof Error ? e.message : String(e),
      });
      return;
    }
    await deps.kernel.approvals.failExecution(id, reason);
  }

  /** A2 §5.3: the result is one `kind='system'` line on the thread that asked for the work.
   *  Not writeAgentItem — that one needs a SessionRow, and this thread is an inbox one. */
  async function writeSystemItem(
    threadId: string,
    body: string,
    externalId: string,
  ): Promise<void> {
    await query(
      pool,
      `INSERT INTO items (thread_id, account_id, external_id, kind, status, body, sent_at)
         SELECT t.id, t.account_id, $2, 'system', 'received', $3, now()
           FROM threads t WHERE t.id = $1
       ON CONFLICT (account_id, external_id) WHERE external_id IS NOT NULL
         DO UPDATE SET body = EXCLUDED.body`,
      [threadId, externalId, body],
    );
    await query(pool, "UPDATE threads SET last_item_at = now() WHERE id = $1", [threadId]);
  }

  /** A2 §5.3(2). The session row exists by the time the turn ends: session.registered precedes
   *  turn.completed on the same bridge connection. */
  async function linkTask(taskId: string, sessionKey: string): Promise<void> {
    await query(
      pool,
      `UPDATE tasks
          SET delegated_session_id = (SELECT id FROM agent_sessions WHERE session_key = $2)
        WHERE id = $1`,
      [taskId, sessionKey],
    );
  }

  /** A2 §5.4: the same brief once on the other code runtime, as a *new pending approval*. Nothing
   *  runs until a human presses again — which is what keeps this a proposal, not a retry. */
  async function proposeFallback(a: PendingApproval): Promise<void> {
    const args = { ...a.args, ...(a.decided_args ?? {}) } as Record<string, unknown>;
    const next = FALLBACK_RUNTIME[String(args.runtime)];
    if (next === undefined) return;
    const id = await deps.kernel.approvals.propose({
      action: "delegate",
      args: { ...args, runtime: next },
      description: `${a.description} Retry on ${next} after a rate limit.`,
      risk: a.risk,
      ...(a.requested_by === null ? {} : { requested_by: a.requested_by }),
      ...(a.thread_id === null ? {} : { thread_id: a.thread_id }),
      ...(a.item_id === null ? {} : { item_id: a.item_id }),
      ...(a.task_id === null ? {} : { task_id: a.task_id }),
    });
    logger.warn("delegation rate limited — re-approval proposed", {
      approvalId: a.id,
      runtime: next,
      reApprovalId: id,
    });
  }

  async function onBridgeError(a: PendingApproval, e: unknown): Promise<void> {
    const reason = e instanceof Error ? e.message : String(e);
    await deps.kernel.approvals.failExecution(a.id, reason);
    if (e instanceof BridgeError && e.code === BRIDGE_ERRORS.RUNTIME_RATE_LIMITED) {
      await proposeFallback(a);
    }
    logger.warn("delegation call failed", { approvalId: a.id, reason });
  }

  function failureReason(p: Record<string, unknown>): string {
    const err = p.error as { message?: unknown } | undefined;
    return typeof err?.message === "string" && err.message !== "" ? err.message : "turn failed";
  }

  async function execute(approvalId: string): Promise<void> {
    const a = await loadDecided(approvalId);
    // A2 §5.1: only `delegate` executes, and only on a decision that means "do it".
    if (a === null || a.action !== "delegate") return;
    if (a.decision !== "accept" && a.decision !== "edit") return;

    const brief = briefFromApproval(a);
    // A garbage args blob must not stall the approval silently (an unknown host is never in
    // hosts(), so the connectivity check below could never fire): fail it where a human sees it.
    const parsed = DelegationBrief.safeParse(brief);
    if (!parsed.success) {
      await claimAndFail(
        a.id,
        `invalid delegation brief: ${parsed.error.issues[0]?.message ?? ""}`,
      );
      return;
    }
    // The target host is offline: leave it decided and let the reconnect re-drive it.
    if (!deps.bridge.hosts().includes(brief.target.host)) return;

    try {
      await deps.kernel.approvals.beginExecution(a.id);
    } catch {
      return; // lost the race
    }
    // A2 §5.4: the kill switch rejects every new run outright.
    if (await deps.killSwitch.isOn()) {
      await deps.kernel.approvals.failExecution(a.id, "kill switch");
      return;
    }
    try {
      const r = await deps.bridge.call<{ session_key: string }>(brief.target.host, "delegate.run", {
        brief,
        sig: signApproval(deps.token, a.id, brief),
      });
      running.set(r.session_key, {
        approvalId: a.id,
        taskId: a.task_id,
        threadId: a.thread_id,
        summary: `${brief.target.runtime}@${brief.target.host} — ${brief.goal}`,
      });
      logger.info("delegation started", {
        approvalId: a.id,
        runtime: brief.target.runtime,
        host: brief.target.host,
        sessionKey: r.session_key,
      });
    } catch (e) {
      await onBridgeError(a, e);
    }
  }

  async function onTurnCompleted(host: HostId, p: Record<string, unknown>): Promise<void> {
    const sessionKey = typeof p.session_key === "string" ? p.session_key : "";
    const entry = sessionKey === "" ? undefined : running.get(sessionKey);
    if (entry === undefined) return; // not a delegated turn
    running.delete(sessionKey); // a duplicate turn.completed is a no-op
    const ok = p.status === "ok";
    const reason = ok ? "" : failureReason(p);

    if (ok) await deps.kernel.approvals.completeExecution(entry.approvalId);
    else await deps.kernel.approvals.failExecution(entry.approvalId, reason);

    if (entry.threadId !== null) {
      await writeSystemItem(
        entry.threadId,
        ok
          ? `✓ Delegation done · ${entry.summary}`
          : `⚠ Delegation failed · ${entry.summary}: ${reason}`,
        `delegation|${entry.approvalId}|result`,
      );
    }
    if (entry.taskId !== null) {
      if (ok) await linkTask(entry.taskId, sessionKey);
      else await query(pool, "UPDATE tasks SET state = 'blocked' WHERE id = $1", [entry.taskId]);
    }
    logger.info("delegation settled", {
      host,
      sessionKey,
      approvalId: entry.approvalId,
      ok,
    });
  }

  /** A host came back: run the decided delegations that were left for it. */
  async function redrive(host: HostId): Promise<void> {
    if (!deps.bridge.hosts().includes(host)) return;
    const decided = await deps.kernel.approvals.list({ state: "decided", limit: 200 });
    for (const a of decided) {
      if (a.action !== "delegate") continue;
      const args = { ...a.args, ...(a.decided_args ?? {}) } as Record<string, unknown>;
      if (String(args.host) !== host) continue;
      await execute(a.id);
    }
  }

  // A3 §6.2: the DB trigger sends the approval NOTIFY, so a decision taken anywhere (the desktop,
  // another hub process, a future rule) reaches this executor without a caller.
  const unsubscribe = deps.kernel.events.subscribe("omnis_approval", (p) => {
    if (p.state !== "decided" || typeof p.id !== "string") return;
    void execute(p.id).catch((e: unknown) => {
      logger.error("delegate executor threw", {
        approvalId: p.id,
        err: e instanceof Error ? e.message : String(e),
      });
    });
  });

  return {
    execute,
    onTurnCompleted,
    redrive,
    stop() {
      unsubscribe();
      running.clear();
    },
  };
}
