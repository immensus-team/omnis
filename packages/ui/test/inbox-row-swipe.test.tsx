// @vitest-environment jsdom
// US-D08 §c.4: the row's swipe. The geometry is asserted in apps/desktop/test/inbox-row-rules
// against the stylesheet; this file drives the gesture itself, because what the numbers cannot show
// is where the row comes to rest, which of two rows is the revealed one, and what a press does to a
// row that is already revealed.
//
// The root `pnpm test` (vitest.workspace.ts) does not read packages/ui/vitest.config.ts, so the
// environment and setup are declared by the file itself.
import "./setup";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InboxRow } from "../src/components/inbox-row";

const baseProps = {
  id: "thread-1",
  name: "Sora Kim",
  timestamp: "3m",
  summary: "Please take a look at the meeting notes",
  isDraft: false,
  avatar: { kind: "initials" as const, name: "Sora Kim" },
  channel: "slack" as const,
  agentState: null,
  unread: true,
  selected: false,
  hasPendingApproval: false,
  labels: [],
  onSelect: vi.fn(),
  onArchive: vi.fn(),
};

const REAL_MATCH_MEDIA = window.matchMedia;

/** The narrow shell, with a switch: `setNarrow(false)` is a window widened past 900, which is the
 *  one transition the component has to survive — the strip and the gesture stop existing there. */
let narrow = true;
let mediaListeners = new Set<() => void>();
function setNarrow(matches: boolean): void {
  narrow = matches;
  for (const listener of mediaListeners) listener();
}
beforeEach(() => {
  narrow = true;
  mediaListeners = new Set();
  window.matchMedia = ((query: string) => ({
    media: query,
    get matches() {
      return narrow;
    },
    addEventListener: (_: string, listener: () => void) => mediaListeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => mediaListeners.delete(listener),
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  window.matchMedia = REAL_MATCH_MEDIA;
});

/** A finger put down on the row and dragged `dx` px horizontally. The primitive reads
 *  `e.currentTarget`, so the press has to run through a real event on the real element, and the
 *  moves have to land on the row because that is where its window listeners are reached from. */
function press(row: HTMLElement, dx: number): void {
  fireEvent.pointerDown(row, {
    button: 0,
    pointerId: 1,
    pointerType: "touch",
    isPrimary: true,
    clientX: 300,
    clientY: 100,
  });
  move(row, dx);
}
function move(row: HTMLElement, dx: number): void {
  fireEvent.pointerMove(row, { pointerId: 1, clientX: 300 + dx, clientY: 100 });
}
function release(row: HTMLElement, dx: number): void {
  fireEvent.pointerUp(row, { pointerId: 1, clientX: 300 + dx, clientY: 100 });
}
/** A whole tap: down, up, and the click the browser adds at the end of it. Nothing moves, so the
 *  primitive never starts a drag and the click is an ordinary one — which is the difference between
 *  this and the click that follows a swipe (see the drag-click test below). */
function tap(row: HTMLElement): void {
  press(row, 0);
  release(row, 0);
  fireEvent.click(row);
}

function setup(over: Partial<typeof baseProps> = {}) {
  const { container } = render(<InboxRow {...baseProps} {...over} />);
  const row = container.querySelector(".inbox-row") as HTMLElement;
  const content = container.querySelector(".inbox-row__content") as HTMLElement;
  /** Where the content actually sits: the inline transform the component wrote, or 0. */
  const at = (): number => {
    const found = /translateX\((-?[\d.]+)px\)/.exec(content.style.transform);
    return found ? Number(found[1]) : 0;
  };
  return { container, row, content, at };
}

describe("InboxRow swipe (US-D08 §c.4)", () => {
  // The tier gate is the whole reason this is not a `touchstart` handler: at a desk the row is a
  // row, and nothing about it should move when a pointer crosses it.
  it("draws no action and moves nothing in the wide tier", () => {
    setNarrow(false);
    const { container, row, at } = setup();
    expect(container.querySelector(".inbox-row__swipe")).toBeNull();

    press(row, -120);
    release(row, -120);

    expect(at()).toBe(0);
    expect(baseProps.onArchive).not.toHaveBeenCalled();
  });

  it("follows the finger and springs back under the commit distance", () => {
    const onArchive = vi.fn();
    const { container, row, content, at } = setup({ onArchive });

    press(row, -40);
    // Mid-gesture: the content is exactly where the finger is, and the transition that would make
    // it lag is switched off for the length of the drag.
    expect(at()).toBe(-40);
    expect(row).toHaveClass("inbox-row--swiping");
    expect(row).toHaveClass("inbox-row--revealed");

    release(row, -40);
    expect(onArchive).not.toHaveBeenCalled();
    expect(at()).toBe(0);
    expect(row).not.toHaveClass("inbox-row--swiping");
    // Below half the travel there is nothing to come back to, so the row is not the revealed one.
    expect(container.querySelector(".inbox-row--revealed")).toBeNull();
    expect(content.style.transform).toBe("");
  });

  // 88 in the component, and the same number in the stylesheet as the disc plus the air beside it.
  it("archives when the release passes the whole action", () => {
    const onArchive = vi.fn();
    const onSelect = vi.fn();
    const { row, at } = setup({ onArchive, onSelect });

    press(row, -88);
    release(row, -88);

    expect(onArchive).toHaveBeenCalledWith("thread-1");
    expect(onSelect).not.toHaveBeenCalled();
    // The row stays where it was swiped to while it collapses: an archived row that slid back under
    // the finger that just pressed it reads as a rejected tap.
    expect(at()).toBe(-88);
  });

  it("stays revealed past half the travel, showing the action", () => {
    const onArchive = vi.fn();
    const { container, row, at } = setup({ onArchive });

    press(row, -60);
    release(row, -60);

    expect(onArchive).not.toHaveBeenCalled();
    expect(at()).toBe(-88);
    expect(container.querySelector(".inbox-row--revealed")).not.toBeNull();
  });

  // The browser's own order, which the tests above were missing: a release *also* delivers a click,
  // because the press and the release share a target and the content sliding sideways does not
  // change that. Measured in Chromium at 390: the point under the finger after a 60px swipe is
  // inside `.inbox-row__action`'s box — the button rides the content, so it moves with it, and
  // `opacity: 0` is not `pointer-events: none` — so every swipe ended by pressing the row's Archive
  // button and archived the row it had only meant to reveal. The row swallows that click in the
  // capture phase instead, wherever in the row it landed.
  it("ignores the click the browser sends after its own drag, even on the row's action", () => {
    const onArchive = vi.fn();
    const onSelect = vi.fn();
    const { container, row, at } = setup({ onArchive, onSelect });

    press(row, -60);
    release(row, -60);
    // What a real 60px drag puts under the finger: the row's own button, which has slid with the
    // content. Dispatched at the button, so it is the button's handler that would run first.
    const action = container.querySelector(".inbox-row__action") as HTMLElement;
    fireEvent.click(action);

    expect(onArchive).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    // Still the revealed row, not the closed one the click would have produced.
    expect(at()).toBe(-88);
    expect(container.querySelector(".inbox-row--revealed")).not.toBeNull();

    // And the swallow is spent: the next plain tap is an ordinary one.
    tap(row);
    expect(onSelect).not.toHaveBeenCalled(); // a revealed row closes on the first press
    tap(row);
    expect(onSelect).toHaveBeenCalledWith("thread-1");
  });

  // The latch is per gesture, and a gesture the browser takes away is still a gesture. A swipe that
  // ends in `pointercancel` — the platform deciding the touch was a scroll after all — delivers no
  // click, so nothing consumes the latch and the next, unrelated tap would be swallowed with it: a
  // row that silently stops responding until it is swiped again.
  it("does not let a swipe the browser cancelled swallow the next tap", () => {
    const onSelect = vi.fn();
    const { row } = setup({ onSelect });

    press(row, -60);
    fireEvent.pointerCancel(row, { pointerId: 1 });

    tap(row);
    expect(onSelect).toHaveBeenCalledWith("thread-1");
  });

  // The other side of the same latch: a tap that never became a drag must still reach the buttons
  // inside the row, or the row's own Archive button would be pressable only after some other row
  // had been swiped.
  it("leaves a plain tap on the row's action alone", () => {
    const onArchive = vi.fn();
    const { container, row } = setup({ onArchive });

    press(row, -3);
    release(row, -3);
    fireEvent.click(container.querySelector(".inbox-row__action") as HTMLElement);

    expect(onArchive).toHaveBeenCalledWith("thread-1");
  });

  // §c.4: "one row open at a time — opening a second closes the first." The two rows share no
  // props and no parent state, so this is the assertion that keeps the store they do share.
  it("closes the row that was revealed when another one is revealed", () => {
    const { container } = render(
      <>
        <InboxRow {...baseProps} id="a" onArchive={vi.fn()} />
        <InboxRow {...baseProps} id="b" onArchive={vi.fn()} />
      </>,
    );
    const rows = [...container.querySelectorAll(".inbox-row")] as HTMLElement[];
    const a = rows[0] as HTMLElement;
    const b = rows[1] as HTMLElement;
    const transformOf = (row: HTMLElement): string =>
      (row.querySelector(".inbox-row__content") as HTMLElement).style.transform;

    press(a, -60);
    release(a, -60);
    expect(transformOf(a)).toContain("-88");

    press(b, -60);
    release(b, -60);
    expect(transformOf(b)).toContain("-88");
    expect(transformOf(a)).toBe("");
  });

  // The way back that does not depend on remembering the gesture — and the reason a revealed row is
  // not a row you can get stuck in.
  it("closes the reveal on the next tap instead of opening the thread", () => {
    const onSelect = vi.fn();
    const { row, at } = setup({ onSelect });

    press(row, -60);
    release(row, -60);
    expect(at()).toBe(-88);

    // A tap, not a bare click: the click that ends the swipe itself is the next test's business.
    tap(row);
    expect(onSelect).not.toHaveBeenCalled();
    expect(at()).toBe(0);

    // And the tap after that is an ordinary one.
    tap(row);
    expect(onSelect).toHaveBeenCalledWith("thread-1");
  });

  // The strip is the gesture's visual echo, not a second control: the row's own button is the one
  // in the accessibility tree, and it is the one a keyboard can reach.
  it("keeps the strip out of the accessibility tree and out of the tab order", () => {
    const { container } = setup();

    expect(screen.getAllByRole("button", { name: "Archive" })).toHaveLength(1);
    const strip = container.querySelector(".inbox-row__swipe") as HTMLElement;
    expect(strip).toHaveAttribute("aria-hidden", "true");
    expect(strip.querySelector("button")?.getAttribute("tabindex")).toBe("-1");
    // The caption is still the visible word a reader needs to know what the disc does.
    expect(strip.querySelector(".inbox-row__swipe-caption")?.textContent).toBe("Archive");
  });

  it("offers Restore on an archived row", () => {
    const { container } = setup({ archived: true });
    expect(container.querySelector(".inbox-row__swipe-caption")?.textContent).toBe("Restore");
  });

  it("leaves a row with no archive action alone", () => {
    const { container, row, at } = setup({ onArchive: undefined });
    expect(container.querySelector(".inbox-row__swipe")).toBeNull();

    press(row, -120);
    release(row, -120);

    expect(at()).toBe(0);
  });

  // A rotation past 900 takes the strip and the gesture away at once. Without the component
  // closing the row it owns, the content would be left shifted with nothing on screen that can
  // bring it back.
  it("closes the reveal when the shell stops being narrow", () => {
    const { container, row, at } = setup();

    press(row, -60);
    release(row, -60);
    expect(at()).toBe(-88);

    // A rotation, not a render: the hook's own listener fires, and act() is only here because the
    // update it causes is not inside a React event.
    act(() => setNarrow(false));

    expect(at()).toBe(0);
    expect(container.querySelector(".inbox-row__swipe")).toBeNull();
  });
});
