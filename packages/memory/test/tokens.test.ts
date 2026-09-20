import { describe, expect, it } from "vitest";
import { estimateTokens } from "../src/tokens.js";

describe("estimateTokens", () => {
  it("counts ascii at roughly four characters per token", () => {
    expect(estimateTokens("abcd".repeat(100))).toBe(100); // 400 chars / 4
  });

  it("counts hangul at roughly 1.5 characters per token", () => {
    // "가" is a hangul syllable — this fixture exists to exercise the non-ASCII token path.
    expect(estimateTokens("가".repeat(150))).toBe(100); // 150 chars / 1.5
  });

  it("adds both halves for mixed text", () => {
    // Frozen hangul fixture: the non-ASCII half must stay hangul to hit the 1.5 chars/token path.
    expect(estimateTokens(`${"abcd".repeat(100)}${"가".repeat(150)}`)).toBe(200);
  });

  it("is zero for an empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("is monotonic — appending text never lowers the estimate", () => {
    // Frozen hangul fixtures ("meeting notes" / "meeting notes, extra") — hangul text must keep
    // exercising the 1.5 chars/token path.
    const a = estimateTokens("회의 노트");
    expect(estimateTokens("회의 노트 추가분")).toBeGreaterThan(a);
  });
});
