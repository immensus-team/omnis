import { type KeyboardEvent as ReactKeyboardEvent, type RefObject, useEffect } from "react";

// US-D09: the focus trap and the return-focus rule the two modal surfaces share — the Sheet (§c.6)
// and the ConfirmPrompt (§c.8). One implementation, because "focus is trapped while open and comes
// back to the trigger on close" is one requirement stated twice, and two copies of a Tab walker is
// where they start disagreeing about which elements count as focusable.
//
// No dependency: this repo has Radix Popover and HoverCard, and neither traps focus (Popover is
// non-modal by design). §e guard 6 rejects a headless-UI kit, so the trap is written here.

/** What the walker counts as focusable. `[tabindex="-1"]` is excluded because that is precisely
 *  what "focusable, not tabbable" means — an element reachable only by script must not appear in
 *  the Tab order the trap is walking. */
const FOCUSABLE =
  'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])';

export function focusablesIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.hasAttribute("disabled") && el.tabIndex !== -1,
  );
}

/** Wraps Tab and Shift+Tab inside the overlay the event was bound to. Call it from the overlay's
 *  own `onKeyDown` — `e.currentTarget` is the trap's root, so no ref is needed to bound it, and a
 *  dialog whose focus has not yet left the container wraps from the container's edges.
 *
 *  A container with nothing focusable in it swallows Tab rather than letting focus walk out of a
 *  modal it cannot come back into. */
export function trapTab(e: ReactKeyboardEvent<HTMLElement>): void {
  if (e.key !== "Tab") return;
  const items = focusablesIn(e.currentTarget);
  if (items.length === 0) {
    e.preventDefault();
    return;
  }
  const first = items[0] as HTMLElement;
  const last = items[items.length - 1] as HTMLElement;
  const active = document.activeElement;
  const inside = active instanceof HTMLElement && e.currentTarget.contains(active);
  if (e.shiftKey && (active === first || !inside)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !inside)) {
    e.preventDefault();
    first.focus();
  }
}

/** Focus goes back to whatever was focused when the dialog opened. A trigger that unmounted while
 *  the dialog was open has nothing to return to, and focusing a detached node silently moves focus
 *  to <body> — which is how "focus returned" becomes "focus was thrown away".
 *
 *  **Declare this before `useInitialFocus`.** Effects run in declaration order, and this one has to
 *  read `document.activeElement` while it is still the trigger. React's `autoFocus` prop cannot be
 *  used for the move-in instead: ReactDOM applies it during the commit, i.e. before any effect, so
 *  the trigger is already gone by the time this runs and the dialog returns focus to itself. */
export function useReturnFocus(open: boolean): void {
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [open]);
}

/** Moves focus onto the dialog's own first control once it is open. Takes the element rather than
 *  the container: the dialog's container is a `GlassSurface`, which renders a plain div and takes
 *  no ref, while the control inside it is a real button. */
export function useInitialFocus<T extends HTMLElement>(
  open: boolean,
  target: RefObject<T | null>,
): void {
  useEffect(() => {
    if (!open) return;
    target.current?.focus();
  }, [open, target]);
}
