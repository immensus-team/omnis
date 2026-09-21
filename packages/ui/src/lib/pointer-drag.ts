import type * as React from "react";

// D7 §c.1: the one drag primitive. Pointer Events, no dependency — `motion`, `framer-motion` and
// `dnd-kit` are not installed and §e guard 6 rejects them. Two consumers: the rail's reorder (D7)
// and the row's swipe (D8). No second drag implementation may appear.

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
 *  - `setPointerCapture` on down, so the gesture survives leaving the element.
 *  - `holdMs > 0` arms a long-press timer; touch only.
 *  - Ignores `button !== 0` and a non-primary pen contact.
 *  - `Escape` cancels a running gesture, and abandons a pending hold.
 *  - Releases capture and clears the timer on up/cancel, and on the element leaving the document —
 *    a detached element is a gesture with no surface left under it.
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
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onAbort);
      el.removeEventListener("lostpointercapture", onAbort);
      window.removeEventListener("keydown", onKeyDown);
      try {
        el.releasePointerCapture(pointerId);
      } catch {
        /* jsdom has no pointer capture, and a real one may already be gone. Either way there is
           nothing left to release. */
      }
    };

    /** Finish once: `finished` is the latch every handler checks, so the up that ends a gesture and
     *  the `lostpointercapture` the release then fires cannot both report an outcome. */
    const end = (): void => {
      finished = true;
      release();
    };

    const onMove = (ev: PointerEvent): void => {
      if (finished) return;
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

    const onUp = (): void => {
      if (finished) return;
      const dx = lastX - startX;
      const dy = lastY - startY;
      const dragged = started;
      end();
      if (dragged) handlers.onEnd(dx, dy);
    };

    const onAbort = (): void => {
      if (finished) return;
      const dragged = started;
      end();
      if (dragged) handlers.onCancel();
    };

    const onKeyDown = (ev: KeyboardEvent): void => {
      if (ev.key !== "Escape") return;
      // Escape during the hold abandons the press with no cancel callback: nothing was lifted, so
      // there is nothing for a consumer to put back.
      if (started) onAbort();
      else end();
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

    try {
      el.setPointerCapture(pointerId);
    } catch {
      /* see release() */
    }
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onAbort);
    el.addEventListener("lostpointercapture", onAbort);
    window.addEventListener("keydown", onKeyDown);
  };
}
