import { BridgeError } from "@omnis/protocol";
import { describe, expect, it } from "vitest";
import { TurnCap } from "../src/turn-cap.js";

describe("TurnCap (A2 §7.2)", () => {
  it("runs the first four turns and queues the fifth", () => {
    const cap = new TurnCap({ max: 4 });
    for (let i = 0; i < 4; i++) expect(cap.acquire(`t${i}`)).toBe("run");
    expect(cap.acquire("t4")).toBe("queued");
    expect(cap.active()).toBe(4);
    expect(cap.queued()).toBe(1);
  });

  it("promotes the head of the queue when a turn finishes, whatever the outcome", () => {
    const cap = new TurnCap({ max: 1 });
    cap.acquire("a");
    cap.acquire("b");
    expect(cap.release("a")).toBe("b");
    expect(cap.active()).toBe(1);
  });

  it("throws -32004 once the queue passes 8", () => {
    const cap = new TurnCap({ max: 4, queueMax: 8 });
    for (let i = 0; i < 12; i++) cap.acquire(`t${i}`);
    try {
      cap.acquire("overflow");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as BridgeError).code).toBe(-32004);
    }
  });

  it("ignores a release for an unknown turn id", () => {
    const cap = new TurnCap({ max: 4 });
    expect(cap.release("never-started")).toBeUndefined();
  });
});
