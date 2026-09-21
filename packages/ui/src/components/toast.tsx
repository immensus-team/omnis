import { Toaster as SonnerToaster, type ToasterProps, toast } from "sonner";
import { cn } from "../lib/cn.js";

// motion-OSS S6: the app's one toast surface, and the first one it has had. `grep -rn "toast"` before
// this landed found exactly one hit in the whole repo — a comment in screens/Digest.tsx naming the
// seam where a toast library would go — so "Archived · Undo" was an affordance the product was
// missing, not one it was implementing twice.
//
// Why a wrapper rather than importing sonner at the call site: this package is the design system, and
// every other surface in it is fronted here for the same reason. The app imports `Toaster` and `toast`
// from @omnis/ui and does not learn which library is underneath — which is what keeps a future swap
// (or a second toast host) from being an app-wide change. It also gives the styling rules one home.
//
// The element sonner renders is styled from apps/desktop/src/app.css against the design tokens, via
// the `omnis-toast*` class names below. Sonner sets its own defaults as CSS custom properties on
// `[data-sonner-toaster]` (`--normal-bg`, `--normal-text`, `--normal-border`, `--border-radius`), and
// that stylesheet is imported by the app entry beside `tokens.css` — CSS is only ever imported by the
// app entry in this repo, never from inside a packages/ui component.
//
// loop-r1-06's toasts are raised through this host too (the merge of plan/motion-oss into main): the
// one pill the shell used to draw was a second surface for the same job, so the vocabulary below —
// a message and an optional action, no id and no library — is what the shell and the Inbox still
// speak, and `App.tsx`'s `notify` is the single place that turns it into sonner's own options.

/** The undo window Gmail's own archive toast gives. Every caller here inherits it — the number is
 *  not a parameter anyone passes. */
export const TOAST_MS = 5000;

/** A toast's pressable half — the Undo, or a Retry. */
export interface ToastAction {
  label: string;
  onAction: () => void;
}

/** A toast as the screen raising it describes it: what to say, and the one action that might be
 *  wanted. Identity, timing and rendering belong to the host, so a raiser never names either. */
export interface ToastRequest {
  message: string;
  action?: ToastAction;
}

/** The app's one toast host. Mount it once, at the root, inside `MotionConfig`.
 *
 *  `position="bottom-center"` rather than a corner: the two gestures that raise a toast (archiving a
 *  row, and the bulk archive confirm) are both actions on the list, and the list's own bottom edge is
 *  where the row that just left was — a toast in a far corner makes the user travel to read a message
 *  about something they were already looking at. */
export function Toaster({ toastOptions, ...props }: ToasterProps) {
  // A caller's class names are composed with ours, not substituted for them: app.css hangs the token
  // styling off `omnis-toast`, so a call site passing its own `classNames.toast` (a wider toast, say)
  // must add a class and not silently drop the one that makes it look like the rest of the app.
  const caller = toastOptions?.classNames;
  return (
    <SonnerToaster
      position="bottom-center"
      // `gap`/`offset` are left at sonner's defaults; the narrow tier's BottomBar sits over the
      // toaster's resting place and app.css lifts it there. That has to be a viewport media query
      // rather than the `@container shell` query the rest of the layout uses, because sonner portals
      // its list to document.body — outside #root, which is the container.
      toastOptions={{
        ...toastOptions,
        classNames: {
          ...caller,
          toast: cn("omnis-toast", caller?.toast),
          actionButton: cn("omnis-toast__action", caller?.actionButton),
          description: cn("omnis-toast__description", caller?.description),
        },
      }}
      {...props}
    />
  );
}

/** Re-exported so a call site can raise a toast without importing sonner itself. `toast(...)` is the
 *  whole API the app uses; the `.success`/`.error`/… variants come along with it. */
export { toast };
export type { ToasterProps };
