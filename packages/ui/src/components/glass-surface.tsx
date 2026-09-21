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

/** The content-layer twin of GlassSurface, and for the same reason it takes the remaining div
 *  attributes: a screen that has to say something about a surface — DigestCard's `data-digest-kind`
 *  is the case that needed it — would otherwise have to wrap the surface in a div that exists only
 *  to hold one attribute. */
export function OpaqueSurface({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("opaque-surface", className)} {...rest}>
      {children}
    </div>
  );
}
