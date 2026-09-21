// A2 §5: the only path by which a runtime works for omnis. Signature first, path second, then a
// workspace-profile session; the bridge re-runs `verify` itself because a runtime saying "done" is not proof.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  BRIDGE_ERRORS,
  BridgeError,
  DelegateRunParams,
  type HostId,
  type RuntimeKind,
  verifyApproval,
} from "@omnis/protocol";
import type { z } from "zod";
import type { Logger } from "./logger.js";
import { assertPathAllowed } from "./paths.js";
import type { EventSink, RuntimeAdapter } from "./rpc-dispatch.js";
import type { SessionRecord, SessionRegistry } from "./session-registry.js";

export type DelegationBriefT = z.infer<typeof DelegateRunParams>["brief"];

export interface VerifyResult {
  exitCode: number | null;
  tail: string;
  timedOut: boolean;
}
export type RunVerify = (cmd: string, cwd: string, timeoutMs: number) => Promise<VerifyResult>;

export interface DelegationDeps {
  /** The hub bridge token (omnis.bridge.token.<host>) — the same secret signs and verifies (A2-D8). */
  token: string;
  host: HostId;
  registry: SessionRegistry;
  logger: Logger;
  adapterFor(kind: RuntimeKind): RuntimeAdapter;
  allowedRoots: Map<RuntimeKind, string[]>;
  runtimeIds: Map<RuntimeKind, string>;
  sinkFor(s: SessionRecord, turnId: string): EventSink;
  runVerify?: RunVerify;
}

const TAIL_BYTES = 4096; // A2 §5.4: the verify output tail that goes on the thread

const execFileAsync = promisify(execFile);

/**
 * Runs the brief's `verify` command in the delegation cwd and keeps only the last 4 KB of output.
 * A non-zero exit is a *result*, not an exception — the caller turns it into a failed turn.
 */
export const defaultRunVerify: RunVerify = async (cmd, cwd, timeoutMs) => {
  const tail = (out: string, err: string): string => `${out}${err}`.slice(-TAIL_BYTES);
  try {
    const { stdout, stderr } = await execFileAsync("/bin/sh", ["-c", cmd], {
      cwd,
      timeout: timeoutMs,
      killSignal: "SIGTERM",
      maxBuffer: 8 * 1024 * 1024,
    });
    return { exitCode: 0, tail: tail(stdout, stderr), timedOut: false };
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stdout?: string; stderr?: string; killed?: boolean };
    return {
      exitCode: typeof err.code === "number" ? err.code : null,
      tail: tail(err.stdout ?? "", err.stderr ?? ""),
      timedOut: err.killed === true,
    };
  }
};

/** A2 §5.2: the one prompt shape, common to every runtime. */
export function renderDelegationPrompt(b: DelegationBriefT, cwd: string): string {
  return [
    `[omnis delegation · approval ${b.approval_id}]`,
    `GOAL: ${b.goal}`,
    `INPUTS: ${b.inputs.join("\n")}`,
    `VERIFY: run \`${b.verify}\`; it must exit 0 before you report done.`,
    `OUTPUT: ${b.output}${b.output_path ? ` at ${b.output_path}` : ""}`,
    `Do not send messages, do not modify files outside ${cwd}.`,
  ].join("\n");
}

/**
 * A2 §5.1/§5.2/§5.4. The gates run in this order on purpose: signature, then path, and only then does a
 * runtime get started — an unsigned or out-of-roots brief must never reach a child process.
 *
 * `--bare` (A2-D11) needs nothing here: the delegation session's `origin: "delegation"` is what makes the
 * Claude Code adapter default to `--bare`.
 */
export async function runDelegation(
  params: unknown,
  deps: DelegationDeps,
): Promise<{ session_key: string; turn_id: string }> {
  const raw = params as { brief?: { approval_id?: unknown }; sig?: unknown };
  const approvalId = typeof raw.brief?.approval_id === "string" ? raw.brief.approval_id : "";
  // Verify over the object exactly as received — zod defaults must not change what was signed.
  if (
    typeof raw.sig !== "string" ||
    approvalId === "" ||
    !verifyApproval(deps.token, approvalId, raw.brief, raw.sig)
  ) {
    deps.logger.error("delegate.run with an invalid signature", { host: deps.host });
    throw new BridgeError(
      BRIDGE_ERRORS.APPROVAL_REQUIRED,
      "delegate.run requires a hub-signed approval",
    );
  }
  const { brief } = DelegateRunParams.parse(params);
  if (brief.target.host !== deps.host)
    throw new BridgeError(BRIDGE_ERRORS.PATH_NOT_ALLOWED, `brief targets ${brief.target.host}`);
  const kind = brief.target.runtime;
  const adapter = deps.adapterFor(kind);
  const cwd = assertPathAllowed(brief.target.cwd, deps.allowedRoots.get(kind) ?? []);
  const runtimeId = deps.runtimeIds.get(kind);
  if (runtimeId === undefined)
    throw new BridgeError(BRIDGE_ERRORS.RUNTIME_UNAVAILABLE, `runtime not registered: ${kind}`);

  const id8 = brief.approval_id.slice(0, 8);
  const sessionKey = `agent:${kind}:${deps.host}:delegation-${id8}`;
  const rec = deps.registry.create({
    session_key: sessionKey,
    runtime: kind,
    runtime_id: runtimeId,
    cwd,
    purpose: `delegation-${id8}`,
    origin: "delegation",
    permission_profile: "workspace",
    opened_at: new Date().toISOString(),
  });
  const outer = deps.sinkFor(rec, `d-${id8}`);
  const runVerify = deps.runVerify ?? defaultRunVerify;
  let settled = false;
  // Declared before the sink: a runtime may complete synchronously inside startTurn(), and then settle()
  // reads this before the assignment below has run.
  // biome-ignore lint/style/useConst: assigned once, but only after settle() may already have read it.
  let timer: NodeJS.Timeout | undefined;
  const settle = (): boolean => {
    if (settled) return false;
    settled = true;
    clearTimeout(timer);
    return true;
  };

  const sink: EventSink = {
    ...outer,
    turnCompleted: (e) => {
      if (!settle()) return;
      if (e.status !== "ok") {
        outer.turnCompleted(e);
        return;
      }
      void runVerify(brief.verify, cwd, brief.timeout_ms).then((v) => {
        const ok = v.exitCode === 0;
        outer.itemCompleted({
          session_key: sessionKey,
          turn_id: e.turn_id,
          item_id: `${String(e.turn_id)}-verify`,
          kind: "tool_call",
          body: v.tail,
          status: ok ? "ok" : "failed",
          meta: { label: "verify", exit_code: v.exitCode, timed_out: v.timedOut },
        });
        // A2 §5.4: a failed verify is a failed turn; the tail is already on the tool_call item above.
        outer.turnCompleted({ ...e, status: ok ? "ok" : "failed" });
      });
    },
  };

  const handle = await adapter.startTurn(rec, { text: renderDelegationPrompt(brief, cwd) }, sink);
  timer = setTimeout(() => {
    if (!settle()) return;
    void handle.cancel("timeout");
    outer.turnCompleted({
      session_key: sessionKey,
      turn_id: handle.turn_id,
      status: "failed",
      usage: { cost_usd: null, duration_ms: brief.timeout_ms, num_turns: 1 },
      error: { code: BRIDGE_ERRORS.TURN_TIMEOUT, message: `timed out after ${brief.timeout_ms}ms` },
    });
  }, brief.timeout_ms);
  // The turn may already have completed inside startTurn(); the timer must not hold the event loop then.
  if (settled) clearTimeout(timer);
  return { session_key: sessionKey, turn_id: handle.turn_id };
}
