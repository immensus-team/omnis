// @vitest-environment jsdom
// US-D10 §c.5: the pane's own two controls. The root `pnpm test` (vitest.workspace.ts) does not read
// packages/ui/vitest.config.ts, so the environment and setup are declared by the file itself.
import "./setup";

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DetailPaneHandle, DetailPaneToggle } from "../src/components/detail-pane.js";
import { DETAIL_MIN_WIDTH, maxDetailWidth } from "../src/lib/detail-pane.js";

/** The wide tier's shell — the number the acceptance frames are shot at. */
const SHELL = 1440;

function setupHandle(width = 420) {
  const props = {
    width,
    shellWidth: SHELL,
    onWidthChange: vi.fn(),
    onWidthCommit: vi.fn(),
    onCancel: vi.fn(),
    onReset: vi.fn(),
  };
  const { unmount } = render(<DetailPaneHandle {...props} />);
  const grip = screen.getByRole("separator");
  /** One gesture, driven through the events React actually dispatched: the primitive reads
   *  `e.currentTarget` and binds its listeners from it, so hand-rolled event objects would not
   *  reach it. `down` is a press at the origin; each `to` is an absolute clientX. */
  const drag = (to: number[]) => {
    fireEvent.pointerDown(grip, {
      button: 0,
      pointerId: 1,
      pointerType: "mouse",
      clientX: 0,
      clientY: 0,
    });
    for (const clientX of to) fireEvent.pointerMove(window, { pointerId: 1, clientX, clientY: 0 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: to.at(-1) ?? 0, clientY: 0 });
  };
  return { ...props, grip, drag, unmount };
}

afterEach(() => vi.restoreAllMocks());

describe("DetailPaneToggle (US-D10: collapsible from a button)", () => {
  it("names the action it performs, not the pane it belongs to", () => {
    const { unmount } = render(<DetailPaneToggle collapsed={false} onToggle={() => {}} />);
    const expanded = screen.getByRole("button", { name: "Collapse details" });
    // The tooltip is the same string as the accessible name, so the two cannot promise different
    // presses to a sighted and a screen-reader user.
    expect(expanded.getAttribute("title")).toBe("Collapse details");
    expect(expanded.getAttribute("aria-expanded")).toBe("true");
    unmount();

    render(<DetailPaneToggle collapsed={true} onToggle={() => {}} />);
    const collapsed = screen.getByRole("button", { name: "Expand details" });
    expect(collapsed.getAttribute("aria-expanded")).toBe("false");
  });

  it("reports every press, and leaves the state to the shell that owns it", () => {
    const onToggle = vi.fn();
    render(<DetailPaneToggle collapsed={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  // A press that ends in the pane's header would submit whatever form it sits in, which is the
  // classic way a type-less button in a toolbar breaks a page.
  it("is a plain button, not a submit", () => {
    render(<DetailPaneToggle collapsed={false} onToggle={() => {}} />);
    expect(screen.getByRole("button").getAttribute("type")).toBe("button");
  });
});

describe("DetailPaneHandle role (US-D10: a splitter, described as one)", () => {
  it("is a vertical separator carrying the range it can be dragged through", () => {
    setupHandle(500);
    const grip = screen.getByRole("separator");
    expect(grip.getAttribute("aria-orientation")).toBe("vertical");
    expect(grip.getAttribute("aria-valuenow")).toBe("500");
    expect(grip.getAttribute("aria-valuemin")).toBe(String(DETAIL_MIN_WIDTH));
    expect(grip.getAttribute("aria-valuemax")).toBe(String(maxDetailWidth(SHELL)));
    expect(grip.getAttribute("tabindex")).toBe("0");
  });

  // Half the shell is the ceiling, but the grip reports it rounded: `aria-valuenow` is a number a
  // screen reader announces, and 719.5 read out as "seven hundred nineteen point five" is noise.
  it("rounds the values it announces", () => {
    setupHandle(420);
    expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe("420");
  });
});

describe("DetailPaneHandle drag (US-D10: rubber band, then a settle)", () => {
  it("reports every frame at the banded width and commits the clamped one", () => {
    const h = setupHandle(420);
    // Right shrinks the pane — the grip is its left edge. Travel of 20 → 400, of 100 → 320, and of
    // 300 → 120 raw, which is 200 under the minimum and bands back to 320 - 200 * 0.32. The band is
    // measured on the distance past the limit, not on the travel: the pane follows the pointer
    // one-for-one right up to 320 and only the overshoot is damped.
    h.drag([20, 100, 300]);

    expect(h.onWidthChange.mock.calls.map(([w]) => w)).toEqual([400, 320, 320 - 200 * 0.32]);
    // Nothing is written while the pointer is down; the release is the only commit, and it is the
    // clamped width rather than the banded one.
    expect(h.onWidthCommit).toHaveBeenCalledTimes(1);
    expect(h.onWidthCommit).toHaveBeenCalledWith(DETAIL_MIN_WIDTH);
  });

  it("bands past the ceiling and settles on it", () => {
    const h = setupHandle(420);
    // Left grows the pane: 420 + 600 is 1020 raw, i.e. 300 past the 720 ceiling — 720 + 300 * 0.32
    // on the way, and 720 on release.
    h.drag([-600]);

    expect(h.onWidthChange).toHaveBeenCalledWith(720 + 300 * 0.32);
    expect(h.onWidthCommit).toHaveBeenCalledWith(720);
  });

  // A click, a double-click and a drag all start with the same pointerdown. The primitive's 6px
  // slop is what keeps the first two from writing a width the user never chose — and the reset on
  // double-click only works because the press that preceded it committed nothing.
  it("writes nothing for a press that never moved", () => {
    const h = setupHandle(500);
    fireEvent.pointerDown(h.grip, {
      button: 0,
      pointerId: 1,
      pointerType: "mouse",
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 3, clientY: 0 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 3, clientY: 0 });

    expect(h.onWidthChange).not.toHaveBeenCalled();
    expect(h.onWidthCommit).not.toHaveBeenCalled();
  });

  it("drops the gesture when it is cancelled instead of walking the pane back", () => {
    const h = setupHandle(420);
    fireEvent.pointerDown(h.grip, {
      button: 0,
      pointerId: 1,
      pointerType: "mouse",
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: -100, clientY: 0 });
    expect(h.onWidthChange).toHaveBeenLastCalledWith(520);

    fireEvent.keyDown(window, { key: "Escape" });
    // `onCancel`, not a banded or re-set width: the width the pane returns to is the one the shell
    // passed in, and the shell still holds it. Handing 420 back would be a *new* width the shell
    // would have to write a frame from — which is what made the cancel animate home through the
    // band on the way out.
    expect(h.onCancel).toHaveBeenCalledTimes(1);
    expect(h.onWidthCommit).not.toHaveBeenCalled();
    expect(h.onWidthChange).toHaveBeenLastCalledWith(520);

    // And the gesture is over: a late release cannot commit it.
    fireEvent.pointerUp(window, { pointerId: 1, clientX: -100, clientY: 0 });
    expect(h.onWidthCommit).not.toHaveBeenCalled();
    expect(h.onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("DetailPaneHandle keyboard (US-D10: 16px steps)", () => {
  it("grows on ArrowLeft and shrinks on ArrowRight by one step", () => {
    const h = setupHandle(400);
    fireEvent.keyDown(h.grip, { key: "ArrowLeft" });
    expect(h.onWidthCommit).toHaveBeenCalledWith(416);
    fireEvent.keyDown(h.grip, { key: "ArrowRight" });
    expect(h.onWidthCommit).toHaveBeenCalledWith(384);
    // The commit path, not the change path: a key has no release to spring back from, so it settles
    // straight away — and nothing is drawn at a banded width on the way.
    expect(h.onWidthChange).not.toHaveBeenCalled();
  });

  it("stops at 320 and at half the shell instead of banding past them", () => {
    const atFloor = setupHandle(DETAIL_MIN_WIDTH);
    fireEvent.keyDown(atFloor.grip, { key: "ArrowRight" });
    expect(atFloor.onWidthCommit).toHaveBeenCalledWith(DETAIL_MIN_WIDTH);
    atFloor.unmount();

    const atCeiling = setupHandle(maxDetailWidth(SHELL));
    fireEvent.keyDown(atCeiling.grip, { key: "ArrowLeft" });
    expect(atCeiling.onWidthCommit).toHaveBeenCalledWith(maxDetailWidth(SHELL));
  });

  // The grip is inside the pane, which scrolls. An unhandled arrow would move the pane's content
  // out from under the control the user is holding.
  it("claims the arrows and leaves every other key to the shell", () => {
    const h = setupHandle(420);
    expect(fireEvent.keyDown(h.grip, { key: "ArrowLeft" })).toBe(false);
    expect(h.onWidthCommit).toHaveBeenCalledTimes(1);
    expect(fireEvent.keyDown(h.grip, { key: "ArrowUp" })).toBe(true);
    expect(h.onWidthCommit).toHaveBeenCalledTimes(1);
  });

  it("resets the width on a double-click", () => {
    const h = setupHandle(420);
    fireEvent.doubleClick(h.grip);
    expect(h.onReset).toHaveBeenCalledTimes(1);
    // A reset is not a commit: the default is a fraction of the window, so the shell clears the
    // setting rather than writing a number of pixels it would then have to keep in step.
    expect(h.onWidthCommit).not.toHaveBeenCalled();
  });
});
