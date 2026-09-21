import { X } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Drawer } from "vaul";
import { cn } from "../lib/cn.js";
import { trapTab, useInitialFocus, useReturnFocus } from "../lib/focus-trap.js";
import { useNarrowShell } from "../lib/media-query.js";
import { pointerDrag } from "../lib/pointer-drag.js";
import { GlassSurface, OpaqueSurface } from "./glass-surface.js";
import { DrawerGrabber, NarrowDrawer } from "./narrow-drawer.js";

// US-D09 §c.6: the sheet. M125 (Filters) and M115 (grouped menu) are the two references; one
// component serves both, so the grammar is written once — the groups, the rows, the confirm, the
// glass, and the portal below are shared by both tiers.
//
// It renders through a portal to document.body, and that is not decoration. #root is
// `container-type: inline-size` (app.css), which is `contain: layout` — a containing block for
// fixed-position descendants. A sheet left in the tree at 390 would therefore `position: fixed`
// against #root rather than the viewport, and if it were nested inside the list card (whose own
// `container-type: inline-size` is the `list` query) it would size against that card and cover only
// the list. The portal is also what keeps `.glass-surface` off an ancestor chain that already
// carries one: the sheet is glass, and ACCENT §4.4 forbids glass inside glass.
//
// **Two implementations, one grammar.** Below 900px the surface is `vaul`'s drawer; at and above it
// it is the hand-rolled dialog this file has always had. That split is the brief's ("S5: mobile
// sheets via vaul"), and the reason the wide tier is not ported is that a drawer is a different
// *shape*, not a different implementation of the same one: `vaul` is full-height and translated to
// a snap offset, its dismissal threshold is a fraction of its own height rather than a distance
// travelled, and its modal behaviour comes from Radix — all three are things M125 has and a centred
// 480px desktop card does not. Porting the wide tier would be a redesign of a surface the brief
// leaves alone, so the wide tier keeps the durations and the geometry it was signed off with.
//
// What the narrow tier gets out of `vaul` is the three things `pointerDrag` + `trapTab` were
// approximating: a drag that measures its own velocity and snaps between rest points, the snap
// points themselves (0.5 and 0.92 of the viewport), and a modal's focus machinery — trap, initial
// focus and return-to-trigger — from Radix rather than from `focus-trap.ts`. That half is
// `NarrowDrawer` (narrow-drawer.tsx) rather than code in this file, because it turned out to be the
// mechanism every `<900` surface wants: the two sheets and the AI panel are the same drawer with
// different boxes, and the fourth and fifth copy of `handleOnly`/`snapPoints`/`autoFocus` would be
// three chances to drift.

/** §c.6: a downward drag past this dismisses the wide tier's sheet (M125's drag-to-close). The
 *  narrow tier's dismissal is `vaul`'s: it is measured against the drawer's own height, and it is
 *  the velocity-aware version of the same gesture. */
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

/** The tier switch. Both branches are components rather than one function with a branch inside:
 *  they use different hooks, and a conditional hook is not a hook. */
export function Sheet(props: SheetProps) {
  return useNarrowShell() ? <SheetDrawer {...props} /> : <SheetDialog {...props} />;
}

interface SheetHeaderProps {
  /** The title element: an `<h2>` at the wide tier, `vaul`'s `Drawer.Title` at the narrow one —
   *  Radix derives the dialog's accessible name from it, and a bare `<h2>` there would leave the
   *  dialog unnamed and Radix warning about it. */
  title: ReactNode;
  confirm?: SheetConfirm;
  /** Whichever header control this sheet has — the confirm, or the ✕ when it has none. Where the
   *  wide tier's initial focus lands; the narrow tier's comes from Radix. */
  actionRef: RefObject<HTMLButtonElement>;
  onClose: () => void;
  /** Set only by the wide tier. There the header *is* the drag handle; at the narrow tier the
   *  handle is `vaul`'s own element and `handleOnly` keeps the header plain. */
  onPointerDown?: (e: ReactPointerEvent<HTMLDivElement>) => void;
}

/** The 44px header both tiers draw. The two controls are mutually exclusive by construction (see
 *  `SheetConfirm`), which is what makes "two ways out of the same header" unrepresentable. */
function SheetHeader({ title, confirm, actionRef, onClose, onPointerDown }: SheetHeaderProps) {
  return (
    <div className="sheet__header" onPointerDown={onPointerDown}>
      {confirm ? null : (
        <button
          type="button"
          ref={actionRef}
          className="sheet__close"
          aria-label="Close"
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </button>
      )}
      {title}
      {confirm && (
        <button
          type="button"
          // The header's own button is where focus lands on open: a sheet that opens with focus
          // left on the trigger behind it is a sheet a keyboard cannot get into, and the trap
          // below would then be holding focus outside the dialog it is trapping.
          ref={actionRef}
          className="sheet__confirm"
          onClick={() => {
            confirm.onConfirm();
            onClose();
          }}
        >
          {confirm.label}
        </button>
      )}
    </div>
  );
}

/** The narrow tier: the shared `vaul` drawer (narrow-drawer.tsx), which is where the four
 *  load-bearing props and the return-to-trigger live now that three surfaces are drawers. What is
 *  this sheet's own is the box it draws in (`.sheet`, positioned by app.css), its `Drawer.Title` —
 *  Radix derives the dialog's name from it, so the narrow header is the one element the two tiers
 *  cannot share — and the grabber the drag is bound to. */
function SheetDrawer({ open, onOpenChange, title, confirm, children }: SheetProps) {
  const headerAction = useRef<HTMLButtonElement>(null);
  return (
    <NarrowDrawer open={open} onOpenChange={onOpenChange} className="sheet">
      <GlassSurface slot="sheet">
        <DrawerGrabber />
        <SheetHeader
          title={<Drawer.Title className="sheet__title">{title}</Drawer.Title>}
          {...(confirm ? { confirm } : {})}
          actionRef={headerAction}
          onClose={() => onOpenChange(false)}
        />
        <div className="sheet__body">{children}</div>
      </GlassSurface>
    </NarrowDrawer>
  );
}

/** The wide tier: the dialog this file has always drawn. Unchanged but for the header, which moved
 *  into `SheetHeader` so the two tiers cannot drift on the controls. */
function SheetDialog({ open, onOpenChange, title, confirm, children }: SheetProps) {
  /** The finger's travel while the header is being dragged; null between gestures, which is also
   *  what tells the panel to leave its transform alone and let the entrance animation own it. */
  const [dragY, setDragY] = useState<number | null>(null);
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
        <SheetHeader
          title={<h2 className="sheet__title">{title}</h2>}
          {...(confirm ? { confirm } : {})}
          actionRef={headerAction}
          onClose={() => onOpenChange(false)}
          onPointerDown={startHeaderDrag}
        />
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
