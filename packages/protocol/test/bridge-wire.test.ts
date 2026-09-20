import { describe, expect, it } from "vitest";
import {
  ApprovalRequestedParams,
  DelegationBrief,
  ItemDelta,
  SessionCreateParams,
  TurnCompleted,
} from "../src/bridge.js";

const KEY = "agent:codex:mini:proj-omnis";

describe("bridge wire payloads", () => {
  it("accepts a session.create params object", () => {
    const p = SessionCreateParams.parse({
      session_key: KEY,
      runtime: "codex",
      cwd: "/Users/logankim/dev/omnis",
      purpose: "proj:omnis",
      origin: "human",
      permission_profile: "trusted",
    });
    expect(p.session_key).toBe(KEY);
  });

  it("rejects a session_key whose purpose still contains a colon", () => {
    expect(() =>
      SessionCreateParams.parse({
        session_key: "agent:codex:mini:proj:omnis",
        runtime: "codex",
        cwd: "/x",
        purpose: "proj:omnis",
        origin: "human",
        permission_profile: "trusted",
      }),
    ).toThrow();
  });

  it("defaults the delta channel to output and requires a monotonic seq", () => {
    const d = ItemDelta.parse({
      session_key: KEY,
      turn_id: "t1",
      item_id: "i1",
      seq: 0,
      text: "he",
    });
    expect(d.channel).toBe("output");
    expect(() =>
      ItemDelta.parse({ session_key: KEY, turn_id: "t1", item_id: "i1", seq: -1, text: "x" }),
    ).toThrow();
  });

  it("requires output_path when a delegation brief outputs a file", () => {
    const base = {
      approval_id: "9a6a7a3e-1f2b-4a6c-8f33-0b2d6f0c9a10",
      target: { runtime: "claude_code", host: "macbook", cwd: "/Users/logankim/dev/omnis" },
      goal: "Fix the failing kernel contract test.",
      inputs: [],
      verify: "pnpm test:contract",
      timeout_ms: 900000,
    };
    expect(() => DelegationBrief.parse({ ...base, output: "file" })).toThrow();
    expect(
      DelegationBrief.parse({ ...base, output: "file", output_path: "/tmp/out.md" }).output,
    ).toBe("file");
  });

  it("carries a full HumanInterrupt on approval.requested", () => {
    const p = ApprovalRequestedParams.parse({
      session_key: KEY,
      turn_id: "t1",
      interrupt: { action: "delegate", args: { cmd: "rm -rf build" }, description: "run cleanup" },
    });
    expect(p.interrupt.config.allow_accept).toBe(true);
    expect(p.interrupt.risk).toBe("normal");
  });

  it("allows a cancelled turn to report status without an error object", () => {
    const t = TurnCompleted.parse({
      session_key: KEY,
      turn_id: "t1",
      status: "cancelled",
      usage: { cost_usd: null, duration_ms: 1200, num_turns: 1, tokens_in: 10, tokens_out: 4 },
    });
    expect(t.error).toBeUndefined();
  });
});
