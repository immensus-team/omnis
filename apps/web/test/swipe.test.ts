import { describe, expect, it } from "vitest";
import { classifySwipe } from "../src/lib/swipe.js";

describe("classifySwipe (A5 §4.2: right=archive, partial left=menu, full left=snooze)", () => {
  it("returns none below the partial threshold", () => {
    expect(classifySwipe(20)).toBe("none");
    expect(classifySwipe(-20)).toBe("none");
  });
  it("returns archive for a partial or full rightward swipe", () => {
    expect(classifySwipe(80)).toBe("archive");
    expect(classifySwipe(200)).toBe("archive");
  });
  it("returns menu for a partial leftward swipe", () => {
    expect(classifySwipe(-80)).toBe("menu");
  });
  it("returns snooze for a full leftward swipe", () => {
    expect(classifySwipe(-200)).toBe("snooze");
  });
});
