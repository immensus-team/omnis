import { type ReactNode, useState } from "react";
import { Drawer } from "vaul";
import { restoreFocus, useReturnFocusTarget } from "../lib/focus-trap.js";

// The `<900` drawer, once, for every surface that becomes one. Three of them do — S5's filters
// sheet (sheet.tsx), the thread sheet the pane opens a row into (App.tsx) and the AI ask panel
// (ask-panel.tsx) — and they are the same mechanism with the same load-bearing props, so the
// mechanism lives here rather than three times over.
//
// What `vaul` supplies, and why each surface wants it: a drag that measures its own velocity and
// snaps between rest points, the rest points themselves, and a modal's focus machinery (trap,
// initial focus, Escape, return-to-trigger) from Radix rather than from `focus-trap.ts`. What stays
// the caller's is the box: `className` lands on `Drawer.Content`, so each surface places and sizes
// itself and this component positions nothing.

/** The rest points, as fractions of the viewport: the drawer opens at half height and pulls up to
 *  0.92, which is M125's Filters sheet and what the brief names for all three surfaces. Exported
 *  because it is asserted rather than assumed — the frames in `docs/design/screens/motion-oss/`
 *  measure the half-viewport translate it produces, and a test asserts the literal. */
export const NARROW_DRAWER_SNAP_POINTS = [0.5, 0.92] as const;

export interface NarrowDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Lands on `Drawer.Content`, which *is* the surface's own box below 900px. */
  className?: string;
  /** The dialog's accessible name, for a surface with no title element of its own. The filters
   *  sheet passes none and names itself with `Drawer.Title` instead — Radix derives the dialog's
   *  name from that, and passing a label as well would leave two answers to one question. */
  label?: string;
  /** Whether the drawer hands focus back to whatever opened it when it closes. True for every
   *  surface but one: the AI panel is opened by the ask bar's input, and that input's `onFocus` is
   *  what opens the panel — so returning focus to it reopened the drawer that had just been
   *  dismissed, and Escape and the scrim were both no-ops at that tier. The panel passes `false`;
   *  see `AskPanelDrawer`. */
  returnFocusToOpener?: boolean;
  /** One element, and it must forward a ref: `Drawer.Content asChild` hands it the drawer's role,
   *  its `data-vaul-*` attributes and the ref vaul measures and drags through Radix's `Slot`. */
  children: ReactNode;
}

/** A modal bottom drawer below the 900px breakpoint.
 *
 *  The four props worth naming, because each is a decision rather than a default:
 *  - `handleOnly` puts the drag on the grabber alone. Every one of these three surfaces has a
 *    scrollable body, and a drawer that drags from anywhere cannot tell a drag down the list from a
 *    drag of the drawer.
 *  - `snapPoints` is `NARROW_DRAWER_SNAP_POINTS` — the two rest points above.
 *  - `fadeFromIndex={0}` names the lowest snap as the one the scrim belongs to. `vaul`'s default is
 *    to hide the overlay at every snap point but the highest, which is the right model for a
 *    non-modal peek and the wrong one for three modal sheets.
 *  - `autoFocus` defaults **off** in `vaul`, and turning it on is what hands the modal's focus
 *    machinery to Radix at all. */
export function NarrowDrawer({
  open,
  onOpenChange,
  className,
  label,
  returnFocusToOpener = true,
  children,
}: NarrowDrawerProps) {
  /** Which rest point the drawer is at, so it comes back to where it was left. `vaul` hands back
   *  the snap point itself, which is `number | string | null` — the strings are the px form of the
   *  same option, which none of the three uses. */
  const [snap, setSnap] = useState<number | string | null>(NARROW_DRAWER_SNAP_POINTS[0]);
  // The one piece of the modal's focus machinery Radix cannot supply on its own. Radix restores
  // focus to `Dialog.Trigger`'s ref, and none of these three drawers is opened by a trigger that
  // could be handed over — the filters sheet's is the BottomBar's button in another component, and
  // the other two are opened by a row press and by a keystroke. Radix's own `onCloseAutoFocus`
  // takes that path, finds no trigger, and preventDefaults the restore, which is how focus ends up
  // on <body>; the handler below is the same job done from the element that actually opened the
  // drawer. It has to be *that* hook rather than a cleanup — see `useReturnFocusTarget` for why.
  const returnTo = useReturnFocusTarget(open);
  return (
    <Drawer.Root
      open={open}
      onOpenChange={onOpenChange}
      snapPoints={[...NARROW_DRAWER_SNAP_POINTS]}
      activeSnapPoint={snap}
      setActiveSnapPoint={setSnap}
      fadeFromIndex={0}
      handleOnly
      autoFocus
    >
      <Drawer.Portal>
        {/* The scrim. `.sheet-overlay` is the drawer family's — the filters sheet's chrome, reused
            here so the three are one surface rather than three that resemble each other. It is the
            overlay's own fill, so a click that lands on the overlay itself (not on the panel) is a
            click outside. Radix's own outside-pointerdown does not fire for a click on the overlay
            in every engine, so the target test is not redundant — it is the path actually taken. */}
        <Drawer.Overlay
          className="sheet-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) onOpenChange(false);
          }}
        />
        <Drawer.Content
          className={className}
          aria-modal="true"
          // Radix warns on every render when a dialog has a title and no description. None of these
          // three has anything to describe — every word in them is a control — and the explicit
          // `undefined` is the documented way to say so rather than a missing attribute it guesses at.
          aria-describedby={undefined}
          {...(label === undefined ? {} : { "aria-label": label })}
          // Focus goes back to whatever opened the drawer here because Radix's own path cannot reach
          // it. `preventDefault` is what stops Radix's fallback (with no trigger, to drop focus) —
          // this handler is composed ahead of Radix's, so preventing here is also what keeps it from
          // running at all. The two are one decision, hence the `preventDefault` staying outside the
          // condition: a caller that opts out of the *restore* is opting out of the fallback too, and
          // a fallback left armed is Radix's own focus-return wearing a different name.
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (returnFocusToOpener) restoreFocus(returnTo.current);
          }}
          asChild
        >
          {children}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

/** The grabber. All three drawers want the same one, and `handleOnly` above is why it exists at
 *  all: it is the only element in the drawer that carries the drag. `vaul` ships a 32x5 grey pill
 *  and a 44px hit area; app.css paints the pill with the design tokens and leaves the hit area
 *  alone, which is what lets the whole gesture live on a 5px-tall element. */
export function DrawerGrabber() {
  return <Drawer.Handle className="drawer__grabber" />;
}
