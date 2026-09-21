// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isEditableTarget, reduceKeySequence } from "../src/hooks/use-keymap";

describe("reduceKeySequence (A5 §2.4 go-to prefix g+letter, 300ms window)", () => {
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

describe("US-A36 archive keys", () => {
  it("'u' resolves to 'unarchive' (the undo of archive, 'e' in A5 §2.4's table)", () => {
    expect(reduceKeySequence(null, "u", 1000).resolved).toBe("unarchive");
  });

  it("ignores keys typed into the ask bar / Composer — an 'e' must not leak into archive", () => {
    const input = document.createElement("input");
    expect(isEditableTarget(input)).toBe(true);
    expect(isEditableTarget(document.createElement("div"))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});
