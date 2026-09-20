import type { ReactNode } from "react";
import { cn } from "../lib/cn";

/** A5 §1.5: 유리는 컨트롤/내비게이션 레이어 4곳에만. 콘텐츠 레이어는 항상 OpaqueSurface. */
export type GlassSlot = "sidebar" | "toolbar" | "sheet" | "palette";

export function GlassSurface(props: { slot: GlassSlot; className?: string; children: ReactNode }) {
  return (
    <div className={cn("glass-surface", props.className)} data-glass-slot={props.slot}>
      {props.children}
    </div>
  );
}

export function OpaqueSurface(props: { className?: string; children: ReactNode }) {
  return <div className={cn("opaque-surface", props.className)}>{props.children}</div>;
}
