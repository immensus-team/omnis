import { describe, expect, it } from "vitest";
import { truncateSnippet } from "../src/search.js";

describe("truncateSnippet (A4 §14.4 snippet ≤160자)", () => {
  it("returns short text unchanged", () => {
    expect(truncateSnippet("오전 미팅 선호")).toBe("오전 미팅 선호");
  });
  it("truncates to 160 chars with an ellipsis", () => {
    const long = "가".repeat(200);
    const out = truncateSnippet(long);
    expect(out.length).toBe(160);
    expect(out.endsWith("...")).toBe(true);
  });
  it("respects a custom max", () => {
    expect(truncateSnippet("abcdefgh", 5)).toBe("ab...");
  });
});
