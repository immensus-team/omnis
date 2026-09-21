import { describe, expect, it } from "vitest";
import {
  DETAIL_DEFAULT_WIDTH,
  DETAIL_MIN_WIDTH,
  DETAIL_STEP_PX,
  clampDetailWidth,
  detailWidthFromDrag,
  draggedDetailWidth,
  maxDetailWidth,
  readDetailCollapsed,
  readDetailWidth,
  steppedDetailWidth,
} from "../src/lib/detail-pane.js";

/** The wide tier's shell: the number every acceptance frame is shot at, and the one where the
 *  pane's own 34% track is widest. */
const SHELL = 1440;

describe("maxDetailWidth (US-D10: half the shell)", () => {
  it("is half the shell's own box", () => {
    expect(maxDetailWidth(SHELL)).toBe(720);
    expect(maxDetailWidth(1000)).toBe(500);
  });

  // A shell narrow enough that half of it is under the minimum would otherwise have a maximum
  // below its minimum, and clamp would flip between the two depending on which side it read last.
  it("never falls below the 320px minimum", () => {
    expect(maxDetailWidth(600)).toBe(DETAIL_MIN_WIDTH);
    expect(maxDetailWidth(320)).toBe(DETAIL_MIN_WIDTH);
  });
});

describe("clampDetailWidth (US-D10: 320px to 50% of the shell)", () => {
  it("leaves a width inside the limits alone", () => {
    expect(clampDetailWidth(500, SHELL)).toBe(500);
  });

  it("raises anything under 320 and lowers anything past half the shell", () => {
    expect(clampDetailWidth(120, SHELL)).toBe(DETAIL_MIN_WIDTH);
    expect(clampDetailWidth(900, SHELL)).toBe(720);
  });

  // Restoring a width that was chosen on a wider window: the stored number is kept (see the hook),
  // and the clamp is what keeps the pane inside a box it no longer fits. The two ends are both
  // reachable from a stored 700 at this width.
  it("clamps a stored width against the shell it is being drawn in", () => {
    expect(clampDetailWidth(700, 1000)).toBe(500);
    expect(clampDetailWidth(700, SHELL)).toBe(700);
  });

  it("is idempotent — clamping a clamped width changes nothing", () => {
    for (const width of [0, 120, 320, 500, 720, 900, 5000]) {
      const once = clampDetailWidth(width, SHELL);
      expect(clampDetailWidth(once, SHELL)).toBe(once);
    }
  });
});

describe("draggedDetailWidth (US-D10: rubber-band past the limits)", () => {
  it("follows the pointer one-for-one inside the limits", () => {
    expect(draggedDetailWidth(500, SHELL)).toBe(500);
    expect(draggedDetailWidth(DETAIL_MIN_WIDTH, SHELL)).toBe(DETAIL_MIN_WIDTH);
    expect(draggedDetailWidth(720, SHELL)).toBe(720);
  });

  // 0.32 of the overshoot, both ends. The exact fraction is the point of the test: a rule that
  // took the whole distance would be no band at all, and one that took none would freeze the pane
  // against the limit mid-gesture.
  it("takes a third of the travel past the minimum, and past the maximum", () => {
    expect(draggedDetailWidth(DETAIL_MIN_WIDTH - 100, SHELL)).toBeCloseTo(320 - 32, 6);
    expect(draggedDetailWidth(820, SHELL)).toBeCloseTo(720 + 32, 6);
  });

  it("keeps moving past the limit rather than sticking to it", () => {
    const soft = draggedDetailWidth(DETAIL_MIN_WIDTH - 200, SHELL);
    const harder = draggedDetailWidth(DETAIL_MIN_WIDTH - 400, SHELL);
    expect(soft).toBeLessThan(DETAIL_MIN_WIDTH);
    expect(harder).toBeLessThan(soft);
  });
});

describe("detailWidthFromDrag (US-D10: the grip is on the pane's left edge)", () => {
  it("grows the pane when the pointer moves left", () => {
    expect(detailWidthFromDrag(400, -60, SHELL)).toBe(460);
  });

  it("shrinks it when the pointer moves right", () => {
    expect(detailWidthFromDrag(400, 60, SHELL)).toBe(340);
  });

  it("carries the rubber band through the sign inversion", () => {
    // 400 + 400 = 800, which is 80 past the 720 ceiling → 720 + 80 * 0.32.
    expect(detailWidthFromDrag(400, -400, SHELL)).toBeCloseTo(720 + 25.6, 6);
  });

  // A drag that never moved: the width it started at, unchanged, with no band applied.
  it("returns the starting width at zero travel", () => {
    expect(detailWidthFromDrag(500, 0, SHELL)).toBe(500);
  });
});

describe("steppedDetailWidth (US-D10: arrow keys move 16px)", () => {
  it("steps one press at a time", () => {
    expect(steppedDetailWidth(400, DETAIL_STEP_PX, SHELL)).toBe(416);
    expect(steppedDetailWidth(400, -DETAIL_STEP_PX, SHELL)).toBe(384);
  });

  // The keyboard has no release to spring back from, so a press that would leave the range stops
  // at the edge — the pane is never drawn outside 320–50% by a key.
  it("stops at the limits instead of banding past them", () => {
    expect(steppedDetailWidth(DETAIL_MIN_WIDTH + 4, -DETAIL_STEP_PX, SHELL)).toBe(DETAIL_MIN_WIDTH);
    expect(steppedDetailWidth(maxDetailWidth(SHELL) - 4, DETAIL_STEP_PX, SHELL)).toBe(
      maxDetailWidth(SHELL),
    );
  });

  it("walks to the far limit in whole steps", () => {
    let width = DETAIL_DEFAULT_WIDTH;
    for (let i = 0; i < 200; i++) width = steppedDetailWidth(width, -DETAIL_STEP_PX, SHELL);
    expect(width).toBe(DETAIL_MIN_WIDTH);
  });
});

describe("readDetailWidth (US-D10: what the settings row holds)", () => {
  it("reads a number the pane was dragged to", () => {
    expect(readDetailWidth(512)).toBe(512);
  });

  it("reads the seeded null as 'never set'", () => {
    expect(readDetailWidth(null)).toBeNull();
    expect(readDetailWidth(undefined)).toBeNull();
  });

  // A row is jsonb the hub serves and anyone can edit, so the reader is total: every shape that is
  // not a usable width means the same thing as "never set", rather than reaching the layout as NaN.
  it("reads anything unusable as 'never set'", () => {
    for (const value of [
      "420",
      0,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      true,
      {},
      [],
      "wide",
    ]) {
      expect(readDetailWidth(value)).toBeNull();
    }
  });
});

describe("readDetailCollapsed", () => {
  it("reads the boolean the pane was collapsed with", () => {
    expect(readDetailCollapsed(true)).toBe(true);
    expect(readDetailCollapsed(false)).toBe(false);
  });

  it("reads every other shape as expanded", () => {
    for (const value of [null, undefined, "true", 1, {}, []]) {
      expect(readDetailCollapsed(value)).toBe(false);
    }
  });
});
