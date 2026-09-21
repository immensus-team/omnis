import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useReducedTransparency } from "./media-query.js";

/** US-D04: the durations CSS cannot tell JS about.
 *
 *  CSS handles almost all of the motion pass on its own (tokens.css + app.css). Three places need
 *  the same number in JavaScript instead, because the element has to be *held in the DOM* for the
 *  length of an exit animation — a stylesheet cannot animate a node React has already unmounted:
 *    - command-palette.tsx holds the ask panel for PANEL_MS after `open` goes false;
 *    - Inbox.tsx holds an archived row in the list for LEAVE_MS so it can collapse out;
 *    - toast.tsx holds the pill for FAST_MS so its fade is not cut off at the frame it starts;
 *    - all of them have to give up at the same moment the CSS does under reduced motion.
 *
 *  These mirror tokens.css and must move with it. That is not a comment-level promise:
 *  test/motion.test.ts reads tokens.css and fails if either side drifts. */

/** The one length every duration collapses onto under `prefers-reduced-motion: reduce`. Long enough
 *  to read as a fade, short enough not to be a transition anyone waits on (apple-design §14). */
export const REDUCED_FADE_MS = 80;

/** The three motion tiers of the v3 ladder, in ms, as tokens.css declares them. This table is the
 *  one place the numbers live in TypeScript; the two long-standing aliases below read off it rather
 *  than restating it, so adding a tier cannot leave one of them behind.
 *
 *  Note the names are the *token* rungs, not the task brief's: the brief called the three tiers
 *  "fast 160 / base 240 / panel 320", but tokens.css's ladder is `--dur-fast: 100ms` (hover),
 *  `--dur-base: 160ms` (the entry rung), `--dur-move: 240ms` (the transition rung) and
 *  `--dur-panel: 320ms` (the layer rung). The three numbers 160/240/320 are the brief's and are
 *  what matter; the keys are the repo's names for them, because a preset keyed `fast` at 160ms
 *  would contradict the `--dur-fast` token sitting right beside it at 100ms. */
export const TIER_MS = { base: 160, move: 240, panel: 320 } as const;

export type MotionTier = keyof typeof TIER_MS;

/** `--dur-panel` — the layer rung of DESIGN-DIRECTION's ladder: a floating panel's arrival. */
export const PANEL_MS = TIER_MS.panel;

/** `--dur-fast` — the fastest rung, and the only one that is an *exit* rather than a transition: the
 *  toast's fade. It is here for the same reason as the two below (a node has to be held in the DOM
 *  for the length of the animation that removes it), and it is short enough that the hold is a
 *  formality — but a zero-length hold unmounts the pill on the tick it started leaving, which is
 *  the one outcome this file exists to prevent. */
export const FAST_MS = 100;

/** `--dur-move` — the transition rung: a row collapsing out of a list. */
export const LEAVE_MS = TIER_MS.move;

/** A spring that lands on a given rung of the same ladder. `visualDuration` is the *perceived*
 *  length in seconds, which is what makes one preset per `--dur-*` token honest: the token says how
 *  long the movement reads as, and this says the same thing to motion's spring solver. */
export interface MotionSpring {
  type: "spring";
  visualDuration: number;
  bounce: number;
}

function springOn(tier: MotionTier, bounce: number): MotionSpring {
  return { type: "spring", visualDuration: TIER_MS[tier] / 1000, bounce };
}

/** The shared spring presets, one per tier — the motion-side twin of the `--dur-*`/`--ease-spring`
 *  brackets in tokens.css.
 *
 *  `bounce` is deliberately small and it *rises* as the rung shortens: a settling chip (160ms) can
 *  carry 0.15 and still read as crisp, while a 320ms panel at the same bounce would visibly wobble
 *  on its way in. That is the whole tuning rule, and it is the reason these are three presets and
 *  not one — §e guard 5 rejects a bounce nobody asked for, and a single high-bounce spring applied
 *  to a floating layer is exactly that bounce. */
export const SPRING = {
  /** `--dur-base` 160ms — the entry rung: a chip landing, a row lifting into place. */
  base: springOn("base", 0.15),
  /** `--dur-move` 240ms — the transition rung: a row collapsing out, the pane resizing. */
  move: springOn("move", 0.12),
  /** `--dur-panel` 320ms — the layer rung: a floating panel or sheet arriving. */
  panel: springOn("panel", 0.1),
} as const satisfies Record<MotionTier, MotionSpring>;

/** What the app has been asked to do less of. Two separate requests, deliberately not folded into
 *  one flag: `prefers-reduced-motion` asks for less *movement*, `prefers-reduced-transparency` asks
 *  for less *blur*. Someone can want the glass gone and the springs kept. */
export interface MotionPrefs {
  /** Reduce travel: springs become instant, entrances become fades. Read by every animated surface
   *  that has to decide in JavaScript; CSS-side decisions stay in the stylesheet's own media block. */
  reducedMotion: boolean;
  /** Reduce blur: glass surfaces fall back to an opaque fill. */
  reducedTransparency: boolean;
}

/** The one hook an animated component asks about the user's preferences.
 *
 *  `useReducedMotion` is motion's own, so the value it returns is the same one `MotionConfig`'s
 *  `reducedMotion="user"` acts on — a component that branches on this and a component that lets its
 *  transition be overridden cannot disagree. It returns `null` when the answer is not known yet
 *  (SSR, or a runtime with no `matchMedia`); that coalesces to `false`, the open branch, which is
 *  the same fallback `prefersReducedMotion()` above has always taken. */
export function useMotionPrefs(): MotionPrefs {
  return {
    reducedMotion: useReducedMotion() ?? false,
    reducedTransparency: useReducedTransparency(),
  };
}

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
