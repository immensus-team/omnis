import type * as React from "react";

// D7 §c.1: the one drag primitive. Pointer Events and the FLIP in its consumers, no dependency —
// DESIGN-DIRECTION-v3 §b checked every package.json and §e guard 6 rejects adding an animation or
// drag library. The check is a grep for those package names, so this header deliberately does not
// spell them: a comment naming a banned dependency reads as a use of one. Two consumers: the rail's
// reorder (D7) and the row's swipe (D8). No second drag implementation may appear.
//
// Amended by the motion-OSS wave, which §e guard 6 now allows to add five vetted libraries (§c.1.1).
// The rule above survives it with one clarification: this file is the *gesture* layer — slop, the
// touch hold, Escape, click suppression, the hit-testing a library would re-derive — and it stays
// the one place those are written. The divider's resize is not a second implementation of them: it
// binds a library that does the same window-level job, and what it kept here is the arithmetic
// (§c.1.1's S3). Both consumers above are still this file's, unchanged.

export interface DragHandlers {
  onStart(): void;
  onMove(dx: number, dy: number): void;
  onEnd(dx: number, dy: number): void;
  onCancel(): void;
}

export interface DragOptions {
  /** Long-press hold, **in ms, on touch only** — the rail's reorder uses 350 so that a finger
   *  swiping sideways down the bar scrolls instead of grabbing a tile. A mouse press has no such
   *  ambiguity (there is no scroll gesture to steal), so a mouse drag starts on the slop below and
   *  the rail behaves the same on a trackpad as it does on a phone. 0 or absent disables the hold
   *  entirely, which is what D8's row swipe wants: `pointerDrag({ axis: "x" })` with no hold. */
  holdMs?: number;
  /** The axis the gesture is measured on, for both the start slop and the hold's cancel distance.
   *  "x" for a horizontal bar and for the row swipe, "y" for the wide rail. Absent measures the
   *  straight-line distance. */
  axis?: "x" | "y";
}

/** Movement before the hold elapses that abandons the long press: the finger is scrolling, the
 *  browser keeps its native scroll, and nothing is reported. §c.1's 8px. Measured in any direction
 *  — a finger that has moved that far has told us what it is doing, and which way it went is not
 *  the question. */
const HOLD_CANCEL_PX = 8;

/** Movement that starts a gesture with no hold. A click carries a pixel or two of jitter, and a
 *  tile that lifts on every click is a bounce nobody asked for (§e guard 5). §c.2's 6px. */
const START_SLOP_PX = 6;

/** Binds one pointer to an element. Returns the `onPointerDown` handler.
 *
 *  - Listeners go on `window`, not on the element — see below.
 *  - `holdMs > 0` arms a long-press timer; touch only.
 *  - Ignores `button !== 0` and a non-primary pen contact.
 *  - `Escape` cancels a running gesture, and abandons a pending hold.
 *  - Every event is filtered to the `pointerId` the gesture started with, so a second finger
 *    cannot drive a drag its press never started.
 *
 *  Why `window` and not `setPointerCapture` on the element: both consumers reorder or remove the
 *  element they are dragging *while the drag is running* — the rail splices the lifted tile to a
 *  new slot on every crossing so its neighbours can animate (FLIP needs the real DOM order), and
 *  the swipe's row unmounts on archive. React performs a keyed reorder with `insertBefore`, which
 *  is a remove-and-reinsert; per spec that fires `lostpointercapture` on the captured element, and
 *  Chromium then stops retargeting to it. Capture would therefore end the gesture at the first
 *  crossing — measured, not assumed: with capture the rail's drag reported one `pointermove`, then
 *  `lostpointercapture`, then nothing, and no `pointerup` at all. Window listeners track the
 *  pointer for as long as it is down, whatever the tree does underneath.
 *
 *  What it does not do: `preventDefault`. Touch scrolling has to keep working until the gesture has
 *  actually started, which is the whole point of the hold.
 */
export function pointerDrag(
  handlers: DragHandlers,
  opts: DragOptions = {},
): (e: React.PointerEvent) => void {
  return (e: React.PointerEvent): void => {
    if (e.button !== 0) return;
    if (e.pointerType === "pen" && !e.isPrimary) return;
    const el = e.currentTarget as HTMLElement;
    const pointerId = e.pointerId;
    const holdMs = e.pointerType === "touch" ? (opts.holdMs ?? 0) : 0;
    const axis = opts.axis;
    const startX = e.clientX;
    const startY = e.clientY;
    let lastX = startX;
    let lastY = startY;
    let started = false;
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const distance = (dx: number, dy: number): number =>
      axis === "x" ? Math.abs(dx) : axis === "y" ? Math.abs(dy) : Math.hypot(dx, dy);

    const release = (): void => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onAbort);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("keydown", onKeyDown);
    };

    /** Finish once: `finished` is the latch every handler checks, so a `pointerup` that follows a
     *  `pointercancel` (or a late second event of any kind) cannot report a second outcome. */
    const end = (): void => {
      finished = true;
      release();
    };

    const onMove = (ev: PointerEvent): void => {
      if (finished || ev.pointerId !== pointerId) return;
      lastX = ev.clientX;
      lastY = ev.clientY;
      const dx = lastX - startX;
      const dy = lastY - startY;
      if (!started) {
        if (timer !== null) {
          if (distance(dx, dy) > HOLD_CANCEL_PX) end();
          return;
        }
        if (distance(dx, dy) < START_SLOP_PX) return;
        started = true;
        handlers.onStart();
      }
      handlers.onMove(dx, dy);
    };

    const onUp = (ev: PointerEvent): void => {
      if (finished || ev.pointerId !== pointerId) return;
      const dx = lastX - startX;
      const dy = lastY - startY;
      const dragged = started;
      end();
      if (dragged) handlers.onEnd(dx, dy);
    };

    /** Touch only, and only once the gesture has started. A touchmove the browser can still cancel
     *  is one it is about to turn into a scroll — and taking the gesture for a scroll fires
     *  `pointercancel`, which would end the drag the moment the user actually moves the tile. That
     *  was measured on the narrow rail: a long-press held, the lift appeared, the first move landed
     *  the tile under the finger, and then the order snapped back to where it started, because the
     *  move had been read as a scroll.
     *
     *  Gated on `started` on purpose: before the hold fires this gesture is not ours, so scrolling
     *  has to keep working — that is the whole point of the hold. `passive: false` because window
     *  touch listeners default to passive, and a passive listener's `preventDefault` does nothing. */
    const onTouchMove = (ev: TouchEvent): void => {
      if (started && ev.cancelable) ev.preventDefault();
    };

    /** The one cancel path. `onAbort` is the pointer-event wrapper that adds the pointerId filter;
     *  Escape reaches it directly. */
    const cancel = (): void => {
      if (finished) return;
      const dragged = started;
      end();
      if (dragged) handlers.onCancel();
    };

    const onAbort = (ev: PointerEvent): void => {
      if (ev.pointerId === pointerId) cancel();
    };

    const onKeyDown = (ev: KeyboardEvent): void => {
      // Escape during the hold abandons the press with no cancel callback: nothing was lifted, so
      // there is nothing for a consumer to put back.
      if (ev.key === "Escape") cancel();
    };

    if (holdMs > 0) {
      timer = setTimeout(() => {
        timer = null;
        // The component unmounted mid-press. Its element is gone with its listeners, so the only
        // thing left to do is not lift a tile that is no longer on screen.
        if (finished || !el.isConnected) {
          end();
          return;
        }
        started = true;
        handlers.onStart();
      }, holdMs);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onAbort);
    if (e.pointerType === "touch") {
      // A mouse gesture cannot be stolen by a scroll, so this listener is touch-only.
      window.addEventListener("touchmove", onTouchMove, { passive: false });
    }
    window.addEventListener("keydown", onKeyDown);
  };
}
