import { describe, expect, it } from "vitest";
import { canonicalJson, signApproval, verifyApproval } from "../src/delegation.js";

const id = "7f1c2a4e-3b7d-4c55-9a0e-2d6f1e8b9c01";
const brief = {
  goal: "g",
  target: { runtime: "claude_ds", host: "macbook", cwd: "/r" },
  inputs: [],
};

describe("approval signatures", () => {
  it("canonicalJson sorts keys at every depth", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 0 }] } })).toBe(
      '{"a":{"c":[3,{"e":0,"f":1}],"d":2},"b":1}',
    );
  });
  it("a signature verifies for the same token, id and payload in any key order", () => {
    const sig = signApproval("tok", id, brief);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    const reordered = {
      inputs: [],
      target: { cwd: "/r", host: "macbook", runtime: "claude_ds" },
      goal: "g",
    };
    expect(verifyApproval("tok", id, reordered, sig)).toBe(true);
  });
  it("rejects another token, another id, a changed payload, and garbage", () => {
    const sig = signApproval("tok", id, brief);
    expect(verifyApproval("other", id, brief, sig)).toBe(false);
    expect(verifyApproval("tok", id.replace("01", "02"), brief, sig)).toBe(false);
    expect(verifyApproval("tok", id, { ...brief, goal: "h" }, sig)).toBe(false);
    expect(verifyApproval("tok", id, brief, "zz")).toBe(false);
  });
});
