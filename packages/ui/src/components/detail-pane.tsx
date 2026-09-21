import { useDrag } from "@use-gesture/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../lib/cn.js";
import {
  DETAIL_MIN_WIDTH,
  DETAIL_STEP_PX,
  clampDetailWidth,
  detailWidthFromDrag,
  maxDetailWidth,
  steppedDetailWidth,
} from "../lib/detail-pane.js";

// US-D10 §c.5 — the detail pane's own two controls: the collapse chevron and the drag grip.
//
// Both are here rather than in apps/desktop/App.tsx for the same reason the rail's tiles are in
// this package: the pane's chrome is components, and what the shell owns is where they sit. They
// are also the two things the shell has no state for — the toggle reports a press and the grip
// reports a width, and neither reads the settings KV itself.

export interface DetailPaneToggleProps {
  /** True while the pane is collapsed — i.e. while the press would *bring it back*. The chevron
   *  points the way the pane will move: right to take it away, left to bring it back. */
  collapsed: boolean;
  onToggle(): void;
  className?: string;
}

/** The pane's collapse control. One button, two states.
 *
 *  The accessible name says what the press *does* ("Collapse details" / "Expand details") rather
 *  than what the pane is, because a name that reads "Details" leaves a screen-reader user to guess
 *  the verb — and it is the same string as the tooltip, so the two cannot describe different
 *  actions. */
export function DetailPaneToggle({ collapsed, onToggle, className }: DetailPaneToggleProps) {
  const label = collapsed ? "Expand details" : "Collapse details";
  const Icon = collapsed ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      className={cn("detail-pane__toggle", className)}
      aria-expanded={!collapsed}
      aria-label={label}
      title={label}
      onClick={onToggle}
    >
      <Icon size={18} aria-hidden="true" />
    </button>
  );
}

export interface DetailPaneHandleProps {
  /** The pane's width right now. It is the drag's origin and what a cancelled gesture returns to. */
  width: number;
  /** The shell's own box. Half of it is the ceiling — measured against the shell rather than the
   *  window, because the rail and the list share the window with the pane. */
  shellWidth: number;
  /** Every frame of a gesture: where the pane should draw, rubber band included. Not persisted —
   *  a drag is not a decision until it is released. This is the only path that reports a width
   *  outside 320…half the shell, which is why the shell draws it without clamping it. */
  onWidthChange(width: number): void;
  /** The gesture ended: the width to settle at, and the one to remember. */
  onWidthCommit(width: number): void;
  /** The gesture ended with nothing decided (Escape, a pointer the browser took away). The pane
   *  goes back to the width it had when the grip was pressed — and the shell already has that
   *  number: it is the width it passed in, so this callback is "drop whatever the gesture was
   *  drawing" rather than a value to re-set. Nothing is written. */
  onCancel(): void;
  /** Double-click. Named `reset` rather than "commit the default" because there is a difference:
   *  the pane goes back to the width the shell ships with, which is a fraction of the window and
   *  not a number of pixels at all. The shell clears the setting rather than writing one. */
  onReset(): void;
  className?: string;
}

/** The divider's grip: a short pill on the pane's left edge, centred vertically.
 *
 *  It is a `separator` with a range, which is the standard window-splitter pattern — the role
 *  carries `aria-valuenow`/`min`/`max` to a screen reader and makes the arrow keys below something
 *  the role promises rather than a private convention. It is focusable, so a keyboard user can
 *  reach the same widths a pointer can; that is also why it is never `display: none` on hover,
 *  only transparent (app.css), because a control that is invisible but present still has to be
 *  pressable. */
export function DetailPaneHandle({
  width,
  shellWidth,
  onWidthChange,
  onWidthCommit,
  onCancel,
  onReset,
  className,
}: DetailPaneHandleProps) {
  const [dragging, setDragging] = useState(false);
  /** Where the gesture started. A ref and not state: the handler is the closure React attached when
   *  the pointer went down, and a state write would re-render before the gesture reads it — the
   *  origin has to be the value at the press, not the value one frame later. */
  const from = useRef(width);
  /** The press point, in clientX. The gesture reports absolute pointer coordinates (`xy`), and the
   *  pane's own arithmetic is written against the *travel* from the press — `detailWidthFromDrag`
   *  takes a dx. Subtracting the two here rather than reading the library's `movement` is
   *  deliberate: `movement` is re-based on the frame the 6px slop is crossed, so a drag would start
   *  6px behind the finger. The pane has followed the pointer one-for-one since US-D10 and the
   *  pinned tests say so, so the raw travel is what this file keeps. */
  const originX = useRef(0);
  /** Whether this gesture crossed the slop at all — the difference between a press that writes a
   *  width and a click that must not. */
  const moved = useRef(false);
  /** Escape ended this gesture. The release still arrives after it, and must not commit: a gesture
   *  that never happened is not a setting. */
  const aborted = useRef(false);

  /** The gesture's config. `capture: false` is load-bearing and is the same decision
   *  `pointer-drag.ts` documents at length: listeners go on `window`, not on the grip, so a pointer
   *  that leaves the 8px-wide grip mid-drag keeps driving the pane, and a synthetic move dispatched
   *  on `window` (what the tests do) reaches it. `threshold: 6` is the primitive's own start slop —
   *  below it the gesture has not started, so a click and a double-click stay clicks. */
  const config = {
    axis: "x",
    threshold: 6,
    pointer: { capture: false },
  } as const;

  const bind = useDrag(({ first, last, active, xy: [pointerX], event }) => {
    if (first) {
      from.current = width;
      moved.current = false;
      aborted.current = false;
    }
    // The release, and the cancel. Checked before `active` because the state reports the gesture
    // as *inactive* on its own last frame — `active` there is the value the gesture had a moment
    // ago, so a `!active` guard written first would swallow every release and the pane would
    // never commit. (The library's `cancel` field is a method for aborting the gesture, not a
    // flag saying one was cancelled; probed. A pointer the browser took away arrives here as a
    // `pointercancel` on the event instead, which is what the type test below reads.)
    if (last) {
      moved.current = false;
      setDragging(false);
      // Escape already reported the cancel; the release that follows it must not commit.
      if (aborted.current) return;
      if (event?.type === "pointercancel") {
        onCancel();
        return;
      }
      onWidthCommit(
        clampDetailWidth(
          detailWidthFromDrag(from.current, pointerX - originX.current, shellWidth),
          shellWidth,
        ),
      );
      return;
    }
    // Below the slop: no width has been decided yet, so nothing is drawn and a click stays a
    // click — which is what makes the double-click reset work.
    if (!active) return;
    if (!moved.current) {
      moved.current = true;
      setDragging(true);
    }
    // Every frame at the banded width; the release above is the only commit.
    onWidthChange(detailWidthFromDrag(from.current, pointerX - originX.current, shellWidth));
  }, config);

  /** Escape, while a drag is running. Bound to the window because the pointer is: the gesture's
   *  listeners are the library's, and a key has no target inside the grip once the finger has left
   *  it. The ref indirection keeps one listener across renders rather than re-binding per frame. */
  const abort = useCallback(() => {
    if (!moved.current) return;
    moved.current = false;
    aborted.current = true;
    setDragging(false);
    onCancel();
  }, [onCancel]);
  const abortRef = useRef(abort);
  abortRef.current = abort;
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent): void => {
      if (e.key === "Escape") abortRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    // The arrows would otherwise scroll the pane's own scroller out from under the grip.
    e.preventDefault();
    // Left grows the pane: the grip is the pane's *left* edge, so the two arrows mean the same
    // thing they mean to the pointer — left is left.
    const delta = e.key === "ArrowLeft" ? DETAIL_STEP_PX : -DETAIL_STEP_PX;
    // No rubber band here: a key has no release to spring back from, so a press that would leave
    // the range stops at the edge instead.
    onWidthCommit(steppedDetailWidth(width, delta, shellWidth));
  }

  const bindProps = bind();
  return (
    <div
      {...bindProps}
      className={cn("detail-pane__grip", dragging && "detail-pane__grip--dragging", className)}
      // biome-ignore lint/a11y/useSemanticElements: a window splitter is a focusable separator with a range. The rule's suggestion, <hr>, carries no value range and no tab stop, so it would trade the whole resize pattern for the element name.
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize details pane"
      aria-valuenow={Math.round(width)}
      aria-valuemin={DETAIL_MIN_WIDTH}
      aria-valuemax={Math.round(maxDetailWidth(shellWidth))}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      // After the spread, so this is the handler that runs: the library's start handler is called
      // from it rather than chained into it, which is what puts the origin capture ahead of it.
      onPointerDown={(e) => {
        originX.current = e.clientX;
        aborted.current = false;
        bindProps.onPointerDown?.(e);
      }}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
    >
      <span className="detail-pane__grip-pill" aria-hidden="true" />
    </div>
  );
}
