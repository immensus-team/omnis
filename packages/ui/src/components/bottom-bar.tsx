import { Menu, SquarePen } from "lucide-react";
import type { ReactNode } from "react";
import { PHASE_B_TITLE } from "./channel-rail.js";

/** US-D08 §c.9: the narrow tier's BottomBar — the Mail M100 / M135 / M143 bar. Three pieces on one
 *  line: filters, the ask pill, compose. The pill is the middle slot and is handed in by the shell,
 *  because what it does (the action list, the thread it is about) is the shell's business; this
 *  component is the bar's shape and the two circles beside it.
 *
 *  It is a component rather than three divs in App.tsx for the same reason the rail is one: the two
 *  bars live in one tier and share a stacking order, so they have to be readable in one place the
 *  day the numbers in app.css move.
 *
 *  The bar itself is transparent — the three pieces are individually glass. A full-bleed glass band
 *  here would be a second rail bar stacked on the first, which is exactly what §c.9 says it is not. */
export function BottomBar({ children }: { children: ReactNode }) {
  // Both circles are glass, and the class is applied by hand rather than through <GlassSurface>:
  // the element has to be the <button> itself and GlassSurface only renders a div — the same reason
  // filter-chip-bar.tsx's popover carries `glass-surface` as a className. data-glass-slot is the
  // part of the component the recipe actually keys off, so it is set too.
  return (
    <div className="bottom-bar">
      <button
        type="button"
        className="bottom-bar__piece glass-surface"
        data-glass-slot="toolbar"
        aria-label="Filters"
        title={PHASE_B_TITLE}
        disabled
      >
        <Menu size={20} aria-hidden="true" />
      </button>
      {children}
      <button
        type="button"
        className="bottom-bar__piece bottom-bar__piece--compose glass-surface"
        data-glass-slot="toolbar"
        aria-label="Compose"
        title={PHASE_B_TITLE}
        disabled
      >
        <SquarePen size={20} aria-hidden="true" />
      </button>
    </div>
  );
}
