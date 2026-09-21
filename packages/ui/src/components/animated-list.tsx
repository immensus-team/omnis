import { useAutoAnimate } from "@formkit/auto-animate/react";
import type { ReactNode } from "react";

/** motion-OSS S6: a list that animates its own insertions and removals — an added item opens a
 *  gap, a removed one closes it, and the items between them move rather than jump.
 *
 *  It is exported rather than left to each caller because `useAutoAnimate` returns a ref, and a ref
 *  belongs to one element: any screen with more than one such list — Settings has three, one per
 *  allowlist kind — would otherwise need a component of its own to hold each ref. Fronting it here
 *  also keeps the library inside this package, the same reason `Toaster` fronts sonner: the app
 *  imports the behaviour, not the dependency.
 *
 *  Auto-animate rather than `motion`'s `layout`: what changes here is which items a list contains,
 *  not where a component sits, and `layout` would mean wrapping every child in a `LayoutGroup` to
 *  get what this gets in one ref. It honours `prefers-reduced-motion` itself — it checks the query
 *  and returns before touching the DOM — which is the same preference the rest of the wave reads
 *  through `useMotionPrefs`.
 *
 *  ponytail: a `ul` because both call sites are lists of chips. Take an element or a tag prop if a
 *  third caller needs something else. */
export function AnimatedList({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const [listRef] = useAutoAnimate();
  return (
    <ul className={className} ref={listRef}>
      {children}
    </ul>
  );
}
