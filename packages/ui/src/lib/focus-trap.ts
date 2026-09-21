import {
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";

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
 *  **The read is a layout effect, and that is what makes it portable.** This has to run before
 *  anything moves focus into the dialog. React's `autoFocus` prop cannot be used for the move-in
 *  instead — it applies during the commit, before any effect — but a *library's* move-in can, and
 *  `vaul`'s does: Radix's `FocusScope` autofocuses the first control in a passive effect, and a
 *  layout effect in an ancestor runs before every passive effect in the tree. So the same helper
 *  captures the trigger for the hand-rolled dialog (where nothing has moved focus yet either way)
 *  and for the drawer (where Radix has not run yet but is about to). Reading it in a passive effect
 *  instead would capture the dialog's own first control and return focus to itself.
 *
 *  **Declare this before `useInitialFocus`** at the wide tier, for the same reason in miniature:
 *  that one is a passive effect and would otherwise run first. */
export function useReturnFocus(open: boolean): void {
  const target = useReturnFocusTarget(open);
  useLayoutEffect(() => {
    if (!open) return;
    return () => restoreFocus(target.current);
  }, [open, target]);
}

/** The read half of `useReturnFocus`, on its own, for a caller that cannot do the write in a
 *  cleanup. `vaul`'s drawer is that caller: Radix's `FocusScope` keeps a `focusout` listener on the
 *  document that pulls focus back into the panel, and a *cleanup* runs during the mutation phase —
 *  while the scope is still mounted and listening — so focusing the trigger there is undone on the
 *  spot (probed: the trigger gets focus and immediately loses it to the panel's own button). The
 *  write has to wait for Radix's `onCloseAutoFocus`, which is dispatched after the scope's listeners
 *  are gone. This is the read that hook needs, kept apart so both tiers share one capture rule. */
export function useReturnFocusTarget(open: boolean): RefObject<HTMLElement | null> {
  const target = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    // Written on open only, never cleared on close — and that is load-bearing rather than an
    // omission. The close commit is *earlier* than Radix's `onCloseAutoFocus` (which is a task), so
    // a `target.current = null` here erases the trigger one beat before the handler that needs it
    // reads the ref (probed: the handler saw `undefined`). The next open overwrites it anyway.
    if (open && document.activeElement instanceof HTMLElement)
      target.current = document.activeElement;
  }, [open]);
  return target;
}

/** The write half: focus the captured element, if it is still in the document. */
export function restoreFocus(target: HTMLElement | null | undefined): void {
  if (target?.isConnected) target.focus();
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
