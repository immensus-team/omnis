import { describe, expect, it } from "vitest";
import { DURATION, EASE_SPRING, RADIUS, SPACE, TYPE_SCALE, WEIGHT } from "../src/tokens";

describe("A5 §1 design tokens", () => {
  it("type scale has exactly the 6 A5-D2 steps", () => {
    expect(Object.keys(TYPE_SCALE)).toEqual(["xs", "sm", "base", "lg", "xl", "2xl"]);
    expect(TYPE_SCALE.base).toEqual({ size: "14px", leading: "20px" });
  });
  it("spacing ladder matches A5 §1.3 exactly", () => {
    expect(SPACE).toEqual({ 1: "4px", 2: "8px", 3: "12px", 4: "16px", 6: "24px", 16: "96px" });
  });
  it("radius has the 4 A5-D3 steps", () => {
    expect(RADIUS).toEqual({ sm: "6px", md: "10px", lg: "16px", full: "999px" });
  });
  it("motion has 3 durations + one spring easing (A5-D4)", () => {
    expect(DURATION).toEqual({ fast: "100ms", base: "160ms", slow: "400ms" });
    expect(EASE_SPRING).toBe("cubic-bezier(0.2, 0, 0, 1)");
  });
  it("weight caps at semibold — no 700+ bold (A5 §9 체크리스트)", () => {
    expect(WEIGHT).toEqual({ regular: 400, medium: 510, semibold: 590 });
  });
});
