import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn.js";

/** A5 §1.5: 유리는 컨트롤/내비게이션 레이어 4곳에만. 콘텐츠 레이어는 항상 OpaqueSurface. */
export type GlassSlot = "sidebar" | "toolbar" | "sheet" | "palette";

/** US-D01: 나머지 div 속성(role/aria-label/data-*)을 그대로 통과시킨다 — ask 패널이 유리 표면이면서
 *  동시에 role="dialog"여야 해서, 표면마다 감싸는 div를 하나 더 만들 이유가 없어졌다. */
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
