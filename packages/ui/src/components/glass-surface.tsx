import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn.js";

/** A5 §1.5: glass belongs on the control/navigation layer, four places only. The content layer is
 *  always OpaqueSurface. */
export type GlassSlot = "sidebar" | "toolbar" | "sheet" | "palette";

/** US-D01: the remaining div attributes (role/aria-label/data-*) pass straight through — the ask
 *  panel has to be a glass surface and role="dialog" at the same time, so there is no longer any
 *  reason to add a wrapping div per surface. */
export function GlassSurface({
  slot,
  className,
  children,
  ...rest
}: { slot: GlassSlot } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("glass-surface", className)} data-glass-slot={slot} {...rest}>
      {children}
    </div>
  );
}

/** US-D09 §c.5: like GlassSurface, the remaining div attributes pass through. The content layer's
 *  cards are the ones that carry state of their own — the tool-call badge is `aria-busy` and
 *  `data-state` at the same time as it is an opaque surface — and a wrapper div per surface is what
 *  that avoids. */
export function OpaqueSurface({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("opaque-surface", className)} {...rest}>
      {children}
    </div>
  );
}
