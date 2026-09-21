import { useEffect, useState } from "react";

// The narrow-shell breakpoint, in one place. app.css's `@container shell (max-width: 899.98px)` is
// the authority; React cannot read the result of a container query (it is neither the window width
// nor the shell's box width), so the same number is written here as well — and app-shell.test.tsx
// asserts this literal is the one app.css carries, so the two cannot drift apart silently.
//
// Until US-D08 this lived in channel-rail.tsx as NARROW_RAIL_QUERY, with a comment telling the next
// person to change both numbers by hand. The row swipe is the next person: it is touch-and-narrow
// only, for the same reason the rail folds there (that is the coarse-pointer layout). Two consumers
// now read one literal instead of keeping two in step.
export const NARROW_SHELL_QUERY = "(max-width: 899.98px)";

// US-D09 §c.5: above 899.98 the detail pane has a second shape before it becomes the wide grid
// column — from 900 to 1279.98 it is a fixed glass sheet floating over the list, and app.css says
// so in `@container shell (max-width: 1279.98px)`. That matters to React for one reason: the pane's
// toolbar cannot be glass *and* be inside a glass sheet (ACCENT §4.4), so the call site has to know
// which of the two it is rendering. The same number is written here as well as in app.css, for the
// same reason NARROW_SHELL_QUERY is — React cannot read a container query's result — and
// app-shell.test.tsx asserts the two literals match.
export const FLOATING_PANE_QUERY = "(max-width: 1279.98px)";

/** jsdom has no matchMedia — without it we fall back to the wide shell (the same defence as
 *  motion.ts's reduced-motion read and command-palette.tsx's duration read). The wide tier is the
 *  layout as it has always been, so that is what the unit tests see; the narrow tier is for the CSS
 *  container queries and a real browser. */
export function mediaQuery(query: string): MediaQueryList | null {
  try {
    return window.matchMedia(query);
  } catch {
    return null;
  }
}

/** One query, re-read on every change rather than only at mount: these breakpoints are crossed by a
 *  window resize or a rotation, not just at load. False where `matchMedia` is missing (jsdom), which
 *  is the wide shell — the layout as it has always been. */
function useMatch(query: string): boolean {
  const [matches, setMatches] = useState(() => mediaQuery(query)?.matches ?? false);
  useEffect(() => {
    const mq = mediaQuery(query);
    if (!mq) return;
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** True while the shell is narrow — i.e. while the rail is a bottom bar and the row swipe is on. */
export function useNarrowShell(): boolean {
  return useMatch(NARROW_SHELL_QUERY);
}

/** True while the detail pane is the floating glass sheet rather than the wide grid column. The
 *  pane's toolbar asks this to decide between a glass capsule (over an opaque column) and the
 *  sheet's own chrome row (over the glass sheet). */
export function useFloatingPane(): boolean {
  return useMatch(FLOATING_PANE_QUERY);
}
