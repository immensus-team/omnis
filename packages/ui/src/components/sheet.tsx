import { X } from "lucide-react";
import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn.js";
import { trapTab, useInitialFocus, useReturnFocus } from "../lib/focus-trap.js";
import { pointerDrag } from "../lib/pointer-drag.js";
import { GlassSurface, OpaqueSurface } from "./glass-surface.js";

// US-D09 §c.6: the sheet. M125 (Filters) and M115 (grouped menu) are the two references; one
// component serves both, so the grammar is written once.
//
// It renders through a portal to document.body, and that is not decoration. #root is
// `container-type: inline-size` (app.css), which is `contain: layout` — a containing block for
// fixed-position descendants. A sheet left in the tree at 390 would therefore `position: fixed`
// against #root rather than the viewport, and if it were nested inside the list card (whose own
// `container-type: inline-size` is the `list` query) it would size against that card and cover only
// the list. The portal is also what keeps `.glass-surface` off an ancestor chain that already
// carries one: the sheet is glass, and ACCENT §4.4 forbids glass inside glass.

/** §c.6: a downward drag past this dismisses the sheet (M125's drag-to-close). */
export const SHEET_DISMISS_PX = 96;

export interface SheetConfirm {
  /** The visible word on the filled circle ("Done"). Also its accessible name. */
  label: string;
  onConfirm: () => void;
}

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Without it the header is closed by the ✕ on the left instead (M105); with it the confirm
   *  button is the way out and there is no ✕, which is M125 — two ways out of the same header is
   *  one too many. */
  confirm?: SheetConfirm;
  children: ReactNode;
}

export function Sheet({ open, onOpenChange, title, confirm, children }: SheetProps) {
  /** The finger's travel while the header is being dragged; null between gestures, which is also
   *  what tells the panel to leave its transform alone and let the entrance animation own it. */
  const [dragY, setDragY] = useState<number | null>(null);
  /** Whichever header control this sheet has — the confirm, or the ✕ when it has none. */
  const headerAction = useRef<HTMLButtonElement>(null);

  useReturnFocus(open);
  useInitialFocus(open, headerAction);

  // The one dismissal gesture, on the header only. Binding it to the whole panel would steal the
  // sheet body's own scroll: `pointerDrag` with no hold cannot tell a drag down the list from a
  // drag of the sheet, and the body is the half that has something to scroll.
  const startHeaderDrag = pointerDrag(
    {
      onStart: () => setDragY(0),
      onMove: (_dx, dy) => setDragY(Math.max(0, dy)),
      onEnd: (_dx, dy) => {
        setDragY(null);
        if (dy > SHEET_DISMISS_PX) onOpenChange(false);
      },
      onCancel: () => setDragY(null),
    },
    { axis: "y" },
  );

  if (!open) return null;

  /** One handler for both keys, on the overlay. The event reaches it from wherever focus is inside
   *  — the panel is the overlay's only child, so `currentTarget` is the trap's own root and no ref
   *  is needed to bound it. */
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onOpenChange(false);
      return;
    }
    trapTab(e);
  };

  return createPortal(
    // The backdrop is the overlay's own fill, so a click that lands on the overlay itself (not on
    // the panel) is a click outside — the target test is what keeps a click inside the sheet from
    // closing it, since the panel's events bubble through here.
    <div
      className="sheet-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
      onKeyDown={onKeyDown}
    >
      <GlassSurface
        slot="sheet"
        className="sheet"
        // biome-ignore lint/a11y/useSemanticElements: a native `<dialog>` is only modal via `showModal()`, and that takes over Escape and the backdrop — which are the overlay's job here — and jsdom does not implement it, so the trap would be untestable.
        role="dialog"
        aria-modal="true"
        aria-label={title}
        // Inline rather than a class: the resting offset is 0 and the drag's is whatever the
        // finger has travelled, so there is no second value for CSS to hold.
        style={dragY === null ? undefined : { transform: `translateY(${dragY}px)` }}
      >
        <div className="sheet__header" onPointerDown={startHeaderDrag}>
          {confirm ? null : (
            <button
              type="button"
              ref={headerAction}
              className="sheet__close"
              aria-label="Close"
              onClick={() => onOpenChange(false)}
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
          <h2 className="sheet__title">{title}</h2>
          {confirm && (
            <button
              type="button"
              // The header's own button is where focus lands on open: a sheet that opens with focus
              // left on the trigger behind it is a sheet a keyboard cannot get into, and the trap
              // below would then be holding focus outside the dialog it is trapping.
              ref={headerAction}
              className="sheet__confirm"
              onClick={() => {
                confirm.onConfirm();
                onOpenChange(false);
              }}
            >
              {confirm.label}
            </button>
          )}
        </div>
        <div className="sheet__body">{children}</div>
      </GlassSurface>
    </div>,
    document.body,
  );
}

/** §c.6: a grey label over a white grouped card. The card is `OpaqueSurface` and not a second
 *  glass surface — a glass card inside a glass sheet is the exact nesting ACCENT §4.4 rejects. */
export function SheetGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sheet-group">
      <p className="sheet-group__label">{label}</p>
      <OpaqueSurface className="sheet-group__card">{children}</OpaqueSurface>
    </div>
  );
}

export interface SheetRowProps {
  /** The row's visible word(s). A node so a row can carry a count or a chip beside it. */
  children: ReactNode;
  /** The right slot: a `--accent` checkmark, a toggle, a count, or a `>` chevron (M125/M115). */
  trailing?: ReactNode;
  onClick?: () => void;
  /** The single-select and multi-select rows state their own semantics at the call site
   *  (`role="radio"`/`role="checkbox"` on a `<button>`), so they are passed through rather than
   *  guessed here. */
  role?: "radio" | "checkbox";
  checked?: boolean;
  disabled?: boolean;
}

/** One 48px row inside a `SheetGroup`. A `div` when it does nothing — a row that is only a label
 *  ("Total", a section head) must not be a button that swallows a tap. */
export function SheetRow({ children, trailing, onClick, role, checked, disabled }: SheetRowProps) {
  const body = (
    <>
      <span className="sheet-row__label">{children}</span>
      {trailing !== undefined && <span className="sheet-row__trailing">{trailing}</span>}
    </>
  );
  if (!onClick) return <div className="sheet-row sheet-row--static">{body}</div>;
  return (
    <button
      type="button"
      className="sheet-row"
      onClick={onClick}
      disabled={disabled}
      // The role is a variable, so Biome cannot read it here; the call site is where the literal
      // lives (and where the same rule is suppressed for the same reason).
      role={role}
      aria-checked={role ? checked === true : undefined}
    >
      {body}
    </button>
  );
}

/** The check a selected row shows in its right slot (M125). Exported so a caller states the
 *  selection the same way twice. */
export function SheetCheck({ checked }: { checked: boolean }) {
  return (
    <span className={cn("sheet-row__check", checked && "sheet-row__check--on")} aria-hidden="true">
      {checked ? "✓" : ""}
    </span>
  );
}
