import { describe, expect, it } from "vitest";
import { codexDecisionToResponse, mapAppServerEvent } from "../src/bridges/codex.js";

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

describe("codexDecisionToResponse (A2 §4.2 승인표)", () => {
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
