import { Menu } from "lucide-react";
import type { ReactNode } from "react";

/** US-D08 §c.9: the narrow tier's BottomBar — the Mail M100 / M135 / M143 bar. The pill is the
 *  middle slot and is handed in by the shell, because what it does (the action list, the thread it
 *  is about) is the shell's business; this component is the bar's shape and the circle beside it.
 *
 *  It is a component rather than two divs in App.tsx for the same reason the rail is one: the two
 *  bars live in one tier and share a stacking order, so they have to be readable in one place the
 *  day the numbers in app.css move.
 *
 *  The bar itself is transparent — the pieces are individually glass. A full-bleed glass band here
 *  would be a second rail bar stacked on the first, which is exactly what §c.9 says it is not.
 *
 *  loop-r2-03/NC2-03: the 52px compose circle is gone. A new message needs a recipient picker that
 *  does not exist, so the circle could only be a disabled glyph under a tooltip that said why —
 *  which is the roadmap jargon the reviewers read as an unfinished product. It is not rendered at
 *  all now, and the ask pill takes the width it gave back. */
export function BottomBar({
  children,
  /** US-D09 §c.6: the filters circle opens M125's sheet. It is handed in rather than built here —
   *  what the sheet filters is the list's state, and the list is the shell's child, not the bar's.
   *  The app always hands one in; a caller that does not gets the gate below rather than a second
   *  sheet of the bar's own invention. */
  onOpenFilters,
}: {
  children: ReactNode;
  onOpenFilters?: () => void;
}) {
  // The circle is glass, and the class is applied by hand rather than through <GlassSurface>: the
  // element has to be the <button> itself and GlassSurface only renders a div — the same reason
  // filter-chip-bar.tsx's popover carries `glass-surface` as a className. data-glass-slot is the
  // part of the component the recipe actually keys off, so it is set too.
  return (
    <div className="bottom-bar">
      <button
        type="button"
        className="bottom-bar__piece glass-surface"
        data-glass-slot="toolbar"
        aria-label="Filters"
        // The plain noun, §e guard 12. It used to carry the shared "not wired up yet" reason when the
        // shell handed in no sheet; the string is gone from the product, so the name is the whole
        // tooltip.
        title="Filters"
        disabled={onOpenFilters === undefined}
        onClick={onOpenFilters}
      >
        <Menu size={20} aria-hidden="true" />
      </button>
      {children}
    </div>
  );
}
