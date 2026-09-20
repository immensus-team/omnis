import { describe, expect, it } from "vitest";
import { reduceKeySequence } from "../src/hooks/use-keymap";

describe("reduceKeySequence (A5 §2.4 go-to 접두 g+letter, 300ms 창)", () => {
  it("g then i within 300ms resolves to 'go-inbox'", () => {
    const r1 = reduceKeySequence(null, "g", 1000);
    expect(r1.pending).toBe("g");
    const r2 = reduceKeySequence(r1, "i", 1100);
    expect(r2.resolved).toBe("go-inbox");
  });
  it("g then i after 300ms does not resolve (window expired)", () => {
    const r1 = reduceKeySequence(null, "g", 1000);
    const r2 = reduceKeySequence(r1, "i", 1500);
    expect(r2.resolved).toBeUndefined();
  });
  it("a single non-prefix key resolves directly (e.g. 'e' = archive)", () => {
    const r = reduceKeySequence(null, "e", 1000);
    expect(r.resolved).toBe("archive");
  });
});
