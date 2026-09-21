import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signApproval } from "@omnis/protocol";
import { describe, expect, it, vi } from "vitest";
import { defaultRunVerify, renderDelegationPrompt, runDelegation } from "../src/delegate.js";
import type { EventSink, RuntimeAdapter } from "../src/rpc-dispatch.js";
import { SessionRegistry } from "../src/session-registry.js";

const TOKEN = "bridge-token";
// assertPathAllowed realpaths the cwd, so it has to exist.
const ROOT = realpathSync(mkdtempSync(join(tmpdir(), "deleg-")));
const CWD = join(ROOT, "omnis");
mkdirSync(CWD);
const brief = {
  approval_id: "7f1c2a4e-3b7d-4c55-9a0e-2d6f1e8b9c01",
  target: { runtime: "claude_ds", host: "macbook", cwd: CWD },
  goal: "Fix the flaky test",
  inputs: [join(CWD, "a.ts")],
  verify: "pnpm test",
  output: "diff",
  timeout_ms: 60_000,
};

function harness(verifyExit = 0) {
  const events: Array<[string, Record<string, unknown>]> = [];
  const sink: EventSink = {
    itemStarted: (e) => events.push(["itemStarted", e]),
    delta: () => {},
    turnStarted: (e) => events.push(["turnStarted", e]),
    itemCompleted: (e) => events.push(["itemCompleted", e]),
    turnCompleted: (e) => events.push(["turnCompleted", e]),
    approval: vi.fn(),
    raw: () => {},
  };
  let finish: (() => void) | undefined;
  const adapter: RuntimeAdapter = {
    kind: "claude_ds",
    probe: vi.fn(),
    startTurn: vi.fn(async (s, _i, sk) => {
      finish = () =>
        sk.turnCompleted({
          session_key: s.session_key,
          turn_id: "t1",
          status: "ok",
          usage: { cost_usd: null, duration_ms: 1, num_turns: 1 },
        });
      return { turn_id: "t1", cancel: async () => true };
    }),
    cancel: vi.fn(async () => true),
    close: vi.fn(),
  };
  const runVerify = vi.fn(async () => ({
    exitCode: verifyExit,
    tail: verifyExit === 0 ? "ok" : "1 failed",
    timedOut: false,
  }));
  const deps = {
    token: TOKEN,
    host: "macbook" as const,
    registry: new SessionRegistry(),
    adapterFor: () => adapter,
    allowedRoots: new Map([["claude_ds" as const, [ROOT]]]),
    runtimeIds: new Map([["claude_ds" as const, "11111111-1111-4111-8111-111111111111"]]),
    sinkFor: () => sink,
    runVerify,
    logger: { log() {}, debug() {}, info() {}, warn() {}, error() {} },
  };
  return {
    deps,
    adapter,
    events,
    runVerify,
    done: async () => {
      finish?.();
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

describe("defaultRunVerify", () => {
  it("reports the exit code, the output tail, and a timeout as data rather than throwing", async () => {
    await expect(defaultRunVerify("printf 'ok' && exit 7", CWD, 5_000)).resolves.toMatchObject({
      exitCode: 7,
      tail: "ok",
      timedOut: false,
    });
    const timedOut = await defaultRunVerify("sleep 5", CWD, 100);
    expect(timedOut.timedOut).toBe(true);
    expect(timedOut.exitCode).toBeNull();
  });
});

describe("runDelegation", () => {
  it("refuses a missing or forged signature with -32006", async () => {
    const { deps } = harness();
    await expect(runDelegation({ brief }, deps)).rejects.toMatchObject({ code: -32006 });
    const forged = await runDelegation(
      { brief, sig: signApproval("wrong", brief.approval_id, brief) },
      deps,
    ).then(
      () => {
        throw new Error("runDelegation accepted a forged signature");
      },
      (e: Error & { code?: number; data?: unknown }) => e,
    );
    expect(forged).toMatchObject({ code: -32006 });
    // A2 §7.2: the bridge token both signs and verifies, so it must not surface where the caller can read it.
    expect(`${forged.message} ${JSON.stringify(forged.data ?? null)}`).not.toContain(TOKEN);
    await expect(
      runDelegation(
        {
          brief: { ...brief, goal: "tampered" },
          sig: signApproval(TOKEN, brief.approval_id, brief),
        },
        deps,
      ),
    ).rejects.toMatchObject({ code: -32006 });
  });

  it("refuses a cwd outside allowed_roots with -32005", async () => {
    const { deps } = harness();
    const b = { ...brief, target: { ...brief.target, cwd: "/etc" } };
    await expect(
      runDelegation({ brief: b, sig: signApproval(TOKEN, b.approval_id, b) }, deps),
    ).rejects.toMatchObject({ code: -32005 });
  });

  it("opens a workspace-profile delegation session and sends the A2 §5.2 prompt", async () => {
    const { deps, adapter } = harness();
    const r = await runDelegation(
      { brief, sig: signApproval(TOKEN, brief.approval_id, brief) },
      deps,
    );
    expect(r.session_key).toBe("agent:claude_ds:macbook:delegation-7f1c2a4e");
    const [session, input] = (adapter.startTurn as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    expect(session).toMatchObject({
      origin: "delegation",
      permission_profile: "workspace",
      cwd: CWD,
    });
    expect(input.text).toBe(renderDelegationPrompt(brief as never, CWD));
    expect(input.text).toContain("VERIFY: run `pnpm test`; it must exit 0 before you report done.");
  });

  it("re-runs verify after the turn and reports it as a tool_call item; exit != 0 fails the turn", async () => {
    const { deps, events, runVerify, done } = harness(1);
    await runDelegation({ brief, sig: signApproval(TOKEN, brief.approval_id, brief) }, deps);
    await done();
    expect(runVerify).toHaveBeenCalledWith("pnpm test", CWD, 60_000);
    const verifyItem = events.find(([k, e]) => k === "itemCompleted" && e.kind === "tool_call");
    expect(verifyItem?.[1]).toMatchObject({
      status: "failed",
      body: "1 failed",
      meta: { label: "verify", exit_code: 1 },
    });
    expect(events.at(-1)).toEqual(["turnCompleted", expect.objectContaining({ status: "failed" })]);
  });
});
