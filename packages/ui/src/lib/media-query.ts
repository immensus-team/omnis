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

/** True while the shell is narrow — i.e. while the rail is a bottom bar and the row swipe is on.
 *  Re-read on every change rather than only at mount: the breakpoint is crossed by a window resize
 *  or a rotation, not just at load. */
export function useNarrowShell(): boolean {
  const [narrow, setNarrow] = useState(() => mediaQuery(NARROW_SHELL_QUERY)?.matches ?? false);
  useEffect(() => {
    const mq = mediaQuery(NARROW_SHELL_QUERY);
    if (!mq) return;
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return narrow;
}
