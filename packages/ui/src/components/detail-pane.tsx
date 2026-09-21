import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { type KeyboardEvent, useRef, useState } from "react";
import { cn } from "../lib/cn.js";
import {
  DETAIL_MIN_WIDTH,
  DETAIL_STEP_PX,
  clampDetailWidth,
  detailWidthFromDrag,
  maxDetailWidth,
  steppedDetailWidth,
} from "../lib/detail-pane.js";
import { pointerDrag } from "../lib/pointer-drag.js";

// US-D10 §c.5 — the detail pane's own controls: the collapse chevron, the drag grip, and the two
// ways out the floating tiers needed (loop-r1-02: the sheet's `‹ Inbox` row and the ✕).
//
// All of them are here rather than in apps/desktop/App.tsx for the same reason the rail's tiles are
// in this package: the pane's chrome is components, and what the shell owns is where they sit. They
// are also the things the shell has no state for — the toggle reports a press and the grip reports a
// width, and none of them reads the settings KV itself.

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

export interface DetailPaneBackProps {
  onBack(): void;
  className?: string;
}

/** `<900` only: the sheet's way back to the list.
 *
 *  The tier's equivalent of the collapse chevron. There the pane is the window's full width, so the
 *  way out is a row at the top of the sheet rather than a control on an edge that is off screen —
 *  and the chevron is deliberately `display: none` there (app.css), because a control for a column
 *  that does not exist is a control that lies.
 *
 *  A word and not a bare `<`. "Inbox" is what the press goes back to; the chevron alone would be a
 *  second unlabelled direction glyph next to the pane's own, and the two point opposite ways. */
export function DetailPaneBack({ onBack, className }: DetailPaneBackProps) {
  return (
    <button
      type="button"
      className={cn("detail-pane__back", className)}
      aria-label="Back to Inbox"
      onClick={onBack}
    >
      <ChevronLeft size={18} aria-hidden="true" />
      Inbox
    </button>
  );
}

export interface DetailPaneCloseProps {
  onClose(): void;
  className?: string;
}

/** `900–1279.98` only: the floating sheet's ✕ (v3 §c.6's close control).
 *
 *  Below 900 the sheet draws `DetailPaneBack` instead, and at >=1280 the pane is a column whose
 *  collapse chevron already puts it away — so the shell renders this in exactly one tier, and the
 *  three controls cannot appear together and compete. */
export function DetailPaneClose({ onClose, className }: DetailPaneCloseProps) {
  return (
    <button
      type="button"
      className={cn("detail-pane__close", className)}
      aria-label="Close"
      onClick={onClose}
    >
      <X size={16} aria-hidden="true" />
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
  /** Where the gesture started. A ref and not state: `onMove` is the closure React attached when
   *  the pointer went down, and a state write would re-render before the gesture reads it — the
   *  origin has to be the value at the press, not the value one frame later. */
  const from = useRef(width);

  const onPointerDown = pointerDrag(
    {
      onStart: () => {
        from.current = width;
        setDragging(true);
      },
      onMove: (dx) => onWidthChange(detailWidthFromDrag(from.current, dx, shellWidth)),
      onEnd: (dx) => {
        setDragging(false);
        onWidthCommit(
          clampDetailWidth(detailWidthFromDrag(from.current, dx, shellWidth), shellWidth),
        );
      },
      // Escape, or a cancelled pointer. Nothing was committed, so the pane goes back to the width
      // it had at the press and no write is made — a gesture that never happened is not a setting.
      onCancel: () => {
        setDragging(false);
        onCancel();
      },
    },
    { axis: "x" },
  );

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

  return (
    <div
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
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
    >
      <span className="detail-pane__grip-pill" aria-hidden="true" />
    </div>
  );
}
