import type { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { CodexAdapter, codexDecisionToResponse, mapAppServerEvent } from "../src/bridges/codex.js";
import type { EventSink } from "../src/rpc-dispatch.js";
import type { SessionRecord } from "../src/session-registry.js";

const ctx = () => ({
  session_key: "agent:codex:mini:proj-omnis",
  turn_id: "t1",
  seq: new Map<string, number>(),
});

describe("mapAppServerEvent (A2 §4.2)", () => {
  it("binds the runtime session_id from thread.started", () => {
    const out = mapAppServerEvent("thread.started", { threadId: "th_7" }, ctx());
    expect(out[0]?.method).toBe("session.registered");
    expect(out[0]?.params.session_id).toBe("th_7");
  });

  it("keeps every reasoning delta ephemeral and tagged", () => {
    for (const m of [
      "item/reasoning/textDelta",
      "item/reasoning/summaryTextDelta",
      "item/plan/delta",
    ]) {
      const out = mapAppServerEvent(m, { itemId: "i1", delta: "thinking" }, ctx());
      expect(out[0]?.method).toBe("turn.item.delta");
      expect(out[0]?.params.channel).toBe("reasoning");
    }
  });

  it("generalises an unknown item type instead of dropping the thread", () => {
    const out = mapAppServerEvent(
      "item/started",
      { item: { id: "i9", type: "quantumToolCall" } },
      ctx(),
    );
    expect(out[0]?.method).toBe("turn.item.started");
    expect(out[0]?.params.kind).toBe("tool_call");
    expect(out[0]?.params.label).toBe("quantumToolCall");
  });

  it("maps agentMessage to an agent_turn item", () => {
    const out = mapAppServerEvent(
      "item/started",
      { item: { id: "i1", type: "agentMessage" } },
      ctx(),
    );
    expect(out[0]?.params.kind).toBe("agent_turn");
  });

  it("turns turn.failed into a failed turn.completed", () => {
    const out = mapAppServerEvent(
      "turn.failed",
      { error: { code: -32009, message: "usage limit" } },
      ctx(),
    );
    expect(out[0]?.method).toBe("turn.completed");
    expect(out[0]?.params.status).toBe("failed");
  });
});

describe("codexDecisionToResponse (A2 §4.2 approval table)", () => {
  it("maps accept / decline straight through", () => {
    expect(codexDecisionToResponse("accept")).toEqual({ decision: "accept" });
    expect(codexDecisionToResponse("decline")).toEqual({ decision: "ignore" });
  });

  it("records a session rule for acceptForSession", () => {
    expect(codexDecisionToResponse("acceptForSession")).toEqual({
      decision: "accept",
      decided_args: { session_rules: true },
    });
  });

  it("downgrades acceptWithExecpolicyAmendment to ignore until S-A2-3", () => {
    expect(codexDecisionToResponse("acceptWithExecpolicyAmendment")).toEqual({
      decision: "ignore",
    });
  });
});

// --- one resident child handles several turns (A2-D6) ---

function fakeAppServer(): { spawnFn: typeof spawn; notify: (m: string, p: unknown) => void } {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  // app-server stand-in: answers every request with an empty result to release startTurn's await.
  createInterface({ input: stdin }).on("line", (line) => {
    const msg = JSON.parse(line) as { id: number };
    stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} })}\n`);
  });
  const spawnFn = ((): unknown => {
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
    child.stdin = stdin;
    child.stdout = stdout;
    child.stderr = null;
    child.kill = (): boolean => true;
    return child;
  }) as unknown as typeof spawn;
  return {
    spawnFn,
    notify: (method, params) => {
      stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
    },
  };
}

function countingSink(): {
  calls: { kind: string; e: Record<string, unknown> }[];
  sink: EventSink;
} {
  const calls: { kind: string; e: Record<string, unknown> }[] = [];
  const push =
    (kind: string) =>
    (e: Record<string, unknown>): void => {
      calls.push({ kind, e });
    };
  return {
    calls,
    sink: {
      itemStarted: push("itemStarted"),
      delta: push("delta"),
      itemCompleted: push("itemCompleted"),
      turnStarted: push("turnStarted"),
      turnCompleted: push("turnCompleted"),
      approval: async () => ({ approval_id: "a", decision: "deny" }) as never,
      raw: () => {},
    },
  };
}

const CAPS = {
  resume: true,
  cross_project_resume: true,
  stream_deltas: true,
  reasoning_stream: true,
  tool_calls: true,
  approvals: "native" as const,
  cancel: true,
  models: ["gpt-5-codex"],
  features: [],
};

function codexRecord(sessionId: string | null): SessionRecord {
  return {
    session_key: "agent:codex:mini:proj-omnis",
    session_id: sessionId,
    runtime: "codex",
    runtime_id: "r1",
    cwd: "/tmp",
    purpose: "test",
    origin: "human",
    permission_profile: "workspace",
    state: "idle",
    opened_at: new Date().toISOString(),
    last_turn_at: null,
  };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 10));

describe("CodexAdapter on a resident app-server child", () => {
  it("does not replay an earlier turn's handlers on the next turn", async () => {
    const { spawnFn, notify } = fakeAppServer();
    const adapter = new CodexAdapter({
      binary: "codex",
      spawnFn,
      capabilities: CAPS,
      version: "0.155.1",
    });

    const first = countingSink();
    const h1 = await adapter.startTurn(codexRecord("th_1"), { text: "one" }, first.sink);
    notify("thread.started", { threadId: "th_1" });
    notify("item/started", { threadId: "th_1", item: { id: "i1", type: "agentMessage" } });
    notify("turn.completed", { threadId: "th_1" });
    await tick();

    const second = countingSink();
    const h2 = await adapter.startTurn(codexRecord("th_1"), { text: "two" }, second.sink);
    notify("item/started", { threadId: "th_1", item: { id: "i2", type: "agentMessage" } });
    notify("turn.completed", { threadId: "th_1" });
    await tick();

    expect(h2.turn_id).not.toBe(h1.turn_id);
    // turn 1's sink must not see turn 2's events (the symptom of duplicate emits)
    expect(first.calls.filter((c) => c.e.item_id === "i2")).toHaveLength(0);
    expect(first.calls.filter((c) => c.kind === "turnCompleted")).toHaveLength(1);
    // turn 2 sees its own events exactly once each
    expect(
      second.calls.filter((c) => c.kind === "itemStarted" && c.e.item_id === "i2"),
    ).toHaveLength(1);
    expect(second.calls.filter((c) => c.kind === "turnCompleted")).toHaveLength(1);
    expect(second.calls.every((c) => c.e.turn_id === h2.turn_id)).toBe(true);

    await adapter.close();
  });

  it("reports turn.started as a turn start, never as a completion", async () => {
    const { spawnFn, notify } = fakeAppServer();
    const adapter = new CodexAdapter({
      binary: "codex",
      spawnFn,
      capabilities: CAPS,
      version: "0.155.1",
    });
    const s = countingSink();
    await adapter.startTurn(codexRecord("th_1"), { text: "one" }, s.sink);
    notify("turn.started", { threadId: "th_1" });
    await tick();

    expect(s.calls.map((c) => c.kind)).toContain("turnStarted");
    expect(s.calls.filter((c) => c.kind === "turnCompleted")).toHaveLength(0);

    await adapter.close();
  });
});
