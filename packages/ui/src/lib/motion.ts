import { useEffect, useRef, useState } from "react";

/** US-D04: the durations CSS cannot tell JS about.
 *
 *  CSS handles almost all of the motion pass on its own (tokens.css + app.css). Three places need
 *  the same number in JavaScript instead, because the element has to be *held in the DOM* for the
 *  length of an exit animation — a stylesheet cannot animate a node React has already unmounted:
 *    - command-palette.tsx holds the ask panel for PANEL_MS after `open` goes false;
 *    - Inbox.tsx holds an archived row in the list for LEAVE_MS so it can collapse out;
 *    - both have to give up at the same moment the CSS does under reduced motion.
 *
 *  These mirror tokens.css and must move with it. That is not a comment-level promise:
 *  test/motion.test.ts reads tokens.css and fails if either side drifts. */

/** The one length every duration collapses onto under `prefers-reduced-motion: reduce`. Long enough
 *  to read as a fade, short enough not to be a transition anyone waits on (apple-design §14). */
export const REDUCED_FADE_MS = 80;

/** `--dur-panel` — the layer rung of DESIGN-DIRECTION's ladder: a floating panel's arrival. */
export const PANEL_MS = 320;

/** `--dur-move` — the transition rung: a row collapsing out of a list. */
export const LEAVE_MS = 240;

/** jsdom's matchMedia always reports matches:false, and a bare Node environment has none at all —
 *  the same defence channel-rail.tsx and command-palette.tsx already carry. No matchMedia means the
 *  full-motion branch, which is what a real browser without the query would do anyway. */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** How long to hold an exiting element in the DOM: the full duration normally, the shared fade
 *  length under reduced motion. Never 0 — a zero-length hold unmounts the node on the same tick it
 *  started leaving, which is the one outcome this whole helper exists to avoid. */
export function motionMs(full: number): number {
  return prefersReducedMotion() ? REDUCED_FADE_MS : full;
}

/** True for the length of an exit animation, so a conditionally-rendered surface can stay mounted
 *  while it leaves. The same arithmetic both call sites need — the ask panel (PANEL_MS) and the
 *  detail pane (LEAVE_MS) — and the reason it is a hook rather than two copies: the first render to
 *  see `open === false` after a first render that was *already* false must not animate, and that
 *  along-with-the-timer rule is the whole of the logic.
 *
 *  `full` defaults to PANEL_MS because a floating panel is the common case. */
export function useClosingSpring(open: boolean, full: number = PANEL_MS): boolean {
  const [closing, setClosing] = useState(false);
  // A first render that is already closed must not run the close animation (it never opened, so
  // there is nothing to leave).
  const everOpened = useRef(open);
  useEffect(() => {
    if (open) {
      everOpened.current = true;
      setClosing(false);
      return;
    }
    if (!everOpened.current) return;
    setClosing(true);
    const timer = setTimeout(() => setClosing(false), motionMs(full));
    return () => clearTimeout(timer);
  }, [open, full]);
  return closing;
}
