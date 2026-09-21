// @vitest-environment jsdom
// D7 §c.1: the shared drag primitive. The root `pnpm test` (vitest.workspace.ts) does not read
// packages/ui/vitest.config.ts, so the environment and setup are declared by the file itself.
import "./setup";

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type DragHandlers, pointerDrag } from "../src/lib/pointer-drag";

interface Harness extends DragHandlers {
  el: HTMLElement;
  down: (init?: Record<string, unknown>) => void;
  unmount: () => void;
}

/** A real element with the real handler attached: the primitive binds pointer capture and its own
 *  listeners from `e.currentTarget`, so the gesture has to run through an event React dispatched
 *  rather than a hand-rolled object. */
function harness(
  opts?: Parameters<typeof pointerDrag>[1],
  pointerType: "mouse" | "touch" = "mouse",
): Harness {
  const handlers: Harness = {
    onStart: vi.fn(),
    onMove: vi.fn(),
    onEnd: vi.fn(),
    onCancel: vi.fn(),
    el: document.createElement("div"),
    down: () => {},
    unmount: () => {},
  };
  const { unmount } = render(
    <div data-testid="tile" onPointerDown={pointerDrag(handlers, opts)} />,
  );
  handlers.el = screen.getByTestId("tile");
  handlers.unmount = unmount;
  handlers.down = (init: Record<string, unknown> = {}) =>
    fireEvent.pointerDown(handlers.el, {
      button: 0,
      pointerId: 1,
      pointerType,
      clientX: 0,
      clientY: 0,
      ...init,
    });
  return handlers;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("pointerDrag (D7 §c.1)", () => {
  it("fires start, move and end once each across down -> move -> up", () => {
    const h = harness();
    h.down();
    fireEvent.pointerMove(h.el, { pointerId: 1, clientX: 20, clientY: 4 });
    fireEvent.pointerMove(h.el, { pointerId: 1, clientX: 52, clientY: 4 });
    fireEvent.pointerUp(h.el, { pointerId: 1, clientX: 52, clientY: 4 });

    expect(h.onStart).toHaveBeenCalledTimes(1);
    expect(h.onMove).toHaveBeenCalledTimes(2);
    expect(h.onMove).toHaveBeenLastCalledWith(52, 4);
    expect(h.onEnd).toHaveBeenCalledTimes(1);
    expect(h.onEnd).toHaveBeenCalledWith(52, 4);
    expect(h.onCancel).not.toHaveBeenCalled();
  });

  it("ignores a non-primary button", () => {
    const h = harness();
    h.down({ button: 2 });
    fireEvent.pointerMove(h.el, { pointerId: 1, clientX: 40, clientY: 0 });
    fireEvent.pointerUp(h.el, { pointerId: 1, clientX: 40, clientY: 0 });

    expect(h.onStart).not.toHaveBeenCalled();
    expect(h.onMove).not.toHaveBeenCalled();
    expect(h.onEnd).not.toHaveBeenCalled();
  });

  it("does not start on a click's worth of jitter", () => {
    const h = harness();
    h.down();
    fireEvent.pointerMove(h.el, { pointerId: 1, clientX: 2, clientY: 1 });
    fireEvent.pointerUp(h.el, { pointerId: 1, clientX: 2, clientY: 1 });

    expect(h.onStart).not.toHaveBeenCalled();
    expect(h.onEnd).not.toHaveBeenCalled();
    // And nothing was cancelled either — this gesture never existed, it was a click.
    expect(h.onCancel).not.toHaveBeenCalled();
  });

  it("measures the start slop on the requested axis only", () => {
    const h = harness({ axis: "x" });
    h.down();
    // 30px down the wrong axis is a scroll, not a horizontal swipe.
    fireEvent.pointerMove(h.el, { pointerId: 1, clientX: 0, clientY: 30 });
    expect(h.onStart).not.toHaveBeenCalled();

    fireEvent.pointerMove(h.el, { pointerId: 1, clientX: 30, clientY: 30 });
    expect(h.onStart).toHaveBeenCalledTimes(1);
  });

  it("cancels on Escape without reporting an end", () => {
    const h = harness();
    h.down();
    fireEvent.pointerMove(h.el, { pointerId: 1, clientX: 30, clientY: 0 });
    fireEvent.keyDown(window, { key: "Escape" });

    expect(h.onCancel).toHaveBeenCalledTimes(1);
    expect(h.onEnd).not.toHaveBeenCalled();
    // The gesture is over: a late pointerup cannot report a second outcome.
    fireEvent.pointerUp(h.el, { pointerId: 1, clientX: 30, clientY: 0 });
    expect(h.onEnd).not.toHaveBeenCalled();
  });

  it("cancels on pointercancel", () => {
    const h = harness();
    h.down();
    fireEvent.pointerMove(h.el, { pointerId: 1, clientX: 30, clientY: 0 });
    fireEvent.pointerCancel(h.el, { pointerId: 1 });

    expect(h.onCancel).toHaveBeenCalledTimes(1);
    expect(h.onEnd).not.toHaveBeenCalled();
  });

  it("takes a mouse press with no hold, so a trackpad drag is immediate", () => {
    const h = harness({ holdMs: 350 });
    vi.useFakeTimers();
    h.down();
    fireEvent.pointerMove(h.el, { pointerId: 1, clientX: 20, clientY: 0 });

    expect(h.onStart).toHaveBeenCalledTimes(1);
  });
});

describe("pointerDrag long press (D7 §c.2, touch)", () => {
  it("starts after holdMs of stillness", () => {
    vi.useFakeTimers();
    const h = harness({ holdMs: 350 }, "touch");
    h.down();
    expect(h.onStart).not.toHaveBeenCalled();

    vi.advanceTimersByTime(349);
    expect(h.onStart).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(h.onStart).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(h.el, { pointerId: 1, clientX: 0, clientY: 0 });
    expect(h.onEnd).toHaveBeenCalledWith(0, 0);
  });

  it("abandons the hold when the finger moves first — the scroll wins", () => {
    vi.useFakeTimers();
    const h = harness({ holdMs: 350 }, "touch");
    h.down();
    fireEvent.pointerMove(h.el, { pointerId: 1, clientX: 20, clientY: 0 });

    // Still inside the hold window and already past the 8px cancel distance: no start now, and none
    // when the timer would have fired.
    expect(h.onStart).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(h.onStart).not.toHaveBeenCalled();
    expect(h.onCancel).not.toHaveBeenCalled();

    // And the gesture is dead — a later move cannot resurrect it.
    fireEvent.pointerMove(h.el, { pointerId: 1, clientX: 60, clientY: 0 });
    expect(h.onStart).not.toHaveBeenCalled();
    expect(h.onMove).not.toHaveBeenCalled();
  });

  it("does not lift a tile whose element has left the document", () => {
    vi.useFakeTimers();
    const h = harness({ holdMs: 350 }, "touch");
    h.down();
    // The component unmounts mid-press — its listeners went with it, and the only thing left to do
    // is not lift a tile that is no longer on screen.
    h.unmount();

    vi.advanceTimersByTime(350);
    expect(h.onStart).not.toHaveBeenCalled();
  });
});
