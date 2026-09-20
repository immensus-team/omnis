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

export function OpaqueSurface(props: { className?: string; children: ReactNode }) {
  return <div className={cn("opaque-surface", props.className)}>{props.children}</div>;
}
