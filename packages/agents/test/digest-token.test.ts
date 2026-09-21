import { describe, expect, it } from "vitest";
import { digestIdFor, undoTokenFor } from "../src/index.js";

/** US-B32: the archiver and the nightly digest must arrive at the same token without sharing a row,
 *  which is the only reason `undoTokenFor` is exported at all. These are the two dates that decide
 *  it: the day's first archive (00:30 KST) and the 23:00 KST digest that reports on it. */
describe("digestIdFor (the digest id an item's undo token is derived from)", () => {
  it("names the same KST day for an archive just after local midnight and the night's digest", () => {
    const archivedAt = new Date("2026-09-20T15:30:00Z"); // 2026-09-21 00:30 KST
    const digestAt = new Date("2026-09-21T14:00:00Z"); // 2026-09-21 23:00 KST
    expect(digestIdFor(archivedAt)).toBe(digestIdFor(digestAt));
    expect(digestIdFor(archivedAt)).toBe("2026-09-21:nightly");
    expect(undoTokenFor(digestIdFor(archivedAt), "newsletter")).toBe(
      undoTokenFor(digestIdFor(digestAt), "newsletter"),
    );
  });

  it("turns over at KST midnight, not UTC midnight", () => {
    expect(digestIdFor(new Date("2026-09-20T14:59:00Z"))).toBe("2026-09-20:nightly"); // 23:59 KST
    expect(digestIdFor(new Date("2026-09-20T15:00:00Z"))).toBe("2026-09-21:nightly"); // 00:00 KST
  });

  it("gives two reasons two tokens, and the same reason one", () => {
    const at = new Date("2026-09-21T14:00:00Z");
    const id = digestIdFor(at);
    expect(undoTokenFor(id, "newsletter")).not.toBe(undoTokenFor(id, "receipt"));
    expect(undoTokenFor(id, "receipt")).toBe(undoTokenFor(id, "receipt"));
  });
});
