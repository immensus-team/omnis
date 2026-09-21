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
    const { rerender } = render(<Toast id={0} message={null} onDismiss={vi.fn()} />);
    const status = screen.getByRole("status");
    // Present before it has anything to say: a live region that arrives with its content already
    // inside it is a region some screen readers never announce.
    expect(status).toBeEmptyDOMElement();
    expect(pill()).toBeNull();

    rerender(
      <Toast
        id={1}
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
    render(<Toast id={1} message="Archived" onDismiss={onDismiss} />);

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
        id={1}
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
    render(
      <Toast
        id={1}
        message="Archived"
        action={{ label: "Undo", onAction }}
        onDismiss={onDismiss}
      />,
    );

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
        id={1}
        message="Archived"
        action={{ label: "Undo", onAction: vi.fn() }}
        onDismiss={vi.fn()}
      />,
    );

    rerender(<Toast id={1} message={null} onDismiss={vi.fn()} />);
    // Still on screen and still saying what it said — a null message means "leaving", not "blank".
    expect(screen.getByRole("status")).toHaveTextContent("Archived");
    expect(pill()).toHaveClass("toast__pill--closing");

    act(() => vi.advanceTimersByTime(FAST_MS));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("starts a replacement's clock over, even when it says exactly what the last one said", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { rerender } = render(<Toast id={1} message="Archived" onDismiss={onDismiss} />);

    // Halfway through the first toast's window, a second archive raises the same sentence. `j e j e`
    // down a list is this, twice a second.
    act(() => vi.advanceTimersByTime(TOAST_MS / 2));
    rerender(<Toast id={2} message="Archived" onDismiss={onDismiss} />);

    // The new toast is not the old one with less time on it: it gets the whole duration, and the
    // outgoing toast's clock went with the outgoing toast. Keyed on the message alone nothing here
    // changes, the original timer keeps running, and this fires 2.5s early — which is an Undo
    // withdrawn while the user is still reaching for it, and `z` disarmed with it.
    act(() => vi.advanceTimersByTime(TOAST_MS - 1));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("gives up a hover hold when the pill goes, so the next toast still dismisses itself", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    const { rerender } = render(
      <Toast id={1} message="Ignored: Approval a1" onDismiss={onDismiss} />,
    );

    // The pointer is on the pill because this is the Undo being clicked — the click clears the
    // toast, and the pill is unmounted from under the pointer. Nothing fires a `mouseleave` for a
    // node that is no longer there, so a hold that is not given up here outlives its own pill.
    fireEvent.mouseEnter(pill() as Element);
    rerender(<Toast id={1} message={null} onDismiss={onDismiss} />);
    act(() => vi.advanceTimersByTime(FAST_MS));
    expect(pill()).toBeNull();

    // The next toast — the "Archived" of whatever the user did next — is not the pill that was
    // hovered, and it counts down like any other. With the stale hold still set its timer never
    // arms: the toast sits there until something else replaces it, and the undo stays armed.
    rerender(<Toast id={2} message="Archived" onDismiss={onDismiss} />);
    act(() => vi.advanceTimersByTime(TOAST_MS - 1));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
