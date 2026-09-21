// @vitest-environment jsdom
// The root `pnpm test` (vitest.workspace.ts) does not read packages/ui/vitest.config.ts, so the
// environment and the setup (jest-dom matchers + afterEach(cleanup)) are declared by the file itself.
import "./setup";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TOAST_MS, Toast } from "../src/components/toast";
import { FAST_MS } from "../src/lib/motion";

/** The plate, which is what the pointer and the focus actually land on. A selector rather than a
 *  role: the pill has no role of its own on purpose — the announcement belongs to the wrapper the
 *  live region is on, and a second named region around the same sentence is the thing screen
 *  readers read twice. */
const pill = (): Element | null => document.querySelector(".toast__pill");

// Leave the timers real again for the next file: a fake clock that outlives a test unmounts the
// surfaces the following one renders (the same backstop archive-inbox.test.tsx carries).
afterEach(() => vi.useRealTimers());

describe("loop-r1-06 Toast (the write's answer, and its Undo)", () => {
  it("keeps the live region mounted, and draws the pill inside it only while there is one", () => {
    const { rerender } = render(<Toast message={null} onDismiss={vi.fn()} />);
    const status = screen.getByRole("status");
    // Present before it has anything to say: a live region that arrives with its content already
    // inside it is a region some screen readers never announce.
    expect(status).toBeEmptyDOMElement();
    expect(pill()).toBeNull();

    rerender(
      <Toast
        message="Archived"
        action={{ label: "Undo", onAction: vi.fn() }}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toBe(status);
    expect(status).toHaveTextContent("Archived");
    expect(status).toHaveTextContent("Undo");
  });

  it("dismisses itself once, when the duration has run out", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<Toast message="Archived" onDismiss={onDismiss} />);

    act(() => vi.advanceTimersByTime(TOAST_MS - 1));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    // ...and once. A second timer armed by the same toast would keep calling the shell's dismissal
    // on every tick, which the shell has no way to tell from the user swatting it away.
    act(() => vi.advanceTimersByTime(TOAST_MS * 3));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("does not run the clock down while the pointer is on it", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(
      <Toast
        message="Archived"
        action={{ label: "Undo", onAction: vi.fn() }}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.mouseEnter(pill() as Element);
    act(() => vi.advanceTimersByTime(TOAST_MS * 2));
    expect(onDismiss).not.toHaveBeenCalled();

    // The counterweight: leaving the pill arms the countdown again, and it is a full one — hovering
    // is what buys the time to read the sentence and press the button in it.
    fireEvent.mouseLeave(pill() as Element);
    act(() => vi.advanceTimersByTime(TOAST_MS - 1));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("runs the action on a click, and leaves the dismissing to the caller", () => {
    vi.useFakeTimers();
    const onAction = vi.fn();
    const onDismiss = vi.fn();
    render(<Toast message="Archived" action={{ label: "Undo", onAction }} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    // Not dismissed from here, and that is the contract the shell leans on: the archive's Undo
    // raises the *restore's* toast while the click is still being handled, and a dismissal raised
    // from inside the pill would clear the newer toast instead of this one.
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Archived");
  });

  it("holds the pill for the leave, so the fade has a node to run in", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <Toast
        message="Archived"
        action={{ label: "Undo", onAction: vi.fn() }}
        onDismiss={vi.fn()}
      />,
    );

    rerender(<Toast message={null} onDismiss={vi.fn()} />);
    // Still on screen and still saying what it said — a null message means "leaving", not "blank".
    expect(screen.getByRole("status")).toHaveTextContent("Archived");
    expect(pill()).toHaveClass("toast__pill--closing");

    act(() => vi.advanceTimersByTime(FAST_MS));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});
