import { type HTMLAttributes, forwardRef } from "react";
import { cn } from "../lib/cn.js";

/** US-D06: the three aurora variants. `dawn` and `mist` are reference image 1 (soft indigo ridge,
 *  warm bloom), `void` is image 2 (near-black band, ember rim). The previous draft's `dusk` is
 *  dropped — it was image 2 at alpha 0.34, which composites to a pale lavender smudge rather than a
 *  cinematic mass (ACCENT-DIRECTION.md §2.5). Surfaces that used `dusk` get `dawn`. */
export type AuroraVariant = "dawn" | "mist" | "void";

/** Decorative texture plate. Renders the two layers that need their own opacity (the masked
 *  silhouette and the grain); the field and the vignette are pseudo-elements on `.aurora` itself.
 *
 *  It takes exactly one prop. A caller that wants a different blur or alpha sets `--aurora-blur` /
 *  `--aurora-alpha` in its own two-class rule (`.aurora.my-surface { … }` — see §2.7), not through a
 *  prop: the per-surface values are CSS's business.
 *
 *  Two rules the call site owns, because the component cannot enforce them:
 *  - Never let `.aurora` and `.glass-surface` land on the same element. `.aurora`'s
 *    `background-color` and `.glass-surface`'s `background` are both (0,1,0): either the vignette
 *    fades to an opaque `--bg-base` and kills the glass at the rim, or the panel stops being glass.
 *    The aurora is painted by an *ancestor* of the glass, never on it — an element's own ::before
 *    paints above its own background.
 *  - Never put a scroll container directly on one — wrap the scroller inside. Aurora goes on
 *    fixed-size, non-scrolling boxes only.
 *
 *  The ref is forwarded for the same reason `GlassSurface`'s is, one wave later: below 900px the AI
 *  panel is `vaul`'s `Drawer.Content` and this is the element it hands the drawer's role, its
 *  `data-vaul-*` attributes and the ref it measures and drags through Radix's `Slot` — a function
 *  component without `forwardRef` would drop that ref silently in React 18. */
export const AuroraSurface = forwardRef<
  HTMLDivElement,
  { variant?: AuroraVariant } & HTMLAttributes<HTMLDivElement>
>(function AuroraSurface({ variant = "dawn", className, children, ...rest }, ref) {
  return (
    <div ref={ref} className={cn("aurora", className)} data-aurora={variant} {...rest}>
      <span className="aurora__mass" aria-hidden="true" />
      <span className="aurora__grain" aria-hidden="true" />
      {children}
    </div>
  );
});
