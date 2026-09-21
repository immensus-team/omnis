import { useEffect, useRef, useState } from "react";
import { cn } from "../lib/cn.js";
import { FAST_MS, useClosingSpring } from "../lib/motion.js";
import { GlassSurface } from "./glass-surface.js";

/** A toast's pressable half — the Undo, or a Retry. */
export interface ToastAction {
  label: string;
  onAction: () => void;
}

/** What the shell's one toast slot holds. A new spec replaces whatever is there: there is no queue,
 *  because there is one thing the user just did and one thing they might want taken back, and a
 *  stack of them would be a second place to look for the one that matters. */
export interface ToastSpec {
  message: string;
  action?: ToastAction;
}

/** The undo window Gmail's own archive toast gives. Every caller here inherits it — the number is
 *  not a parameter anyone passes. */
export const TOAST_MS = 5000;

export interface ToastProps {
  /** The toast to show, or null for "nothing to show". The wrapper below is mounted either way — a
   *  live region has to be in the DOM *before* its content is, or the change is not announced. */
  message: string | null;
  /** `| undefined` because the shell passes the slot's spec straight through: a toast without an
   *  action writes the property as undefined rather than omitting it, and this repo compiles with
   *  `exactOptionalPropertyTypes`. */
  action?: ToastAction | undefined;
  /** The toast has been up for its full duration. The caller owns the slot; this component never
   *  clears itself, so the dismissal is one decision in one place (App.tsx's notify/clear pair). */
  onDismiss: () => void;
  durationMs?: number;
}

/** loop-r1-06: the one thing the shell says back after a write. It is a floating panel, so it is
 *  glass — the toolbar slot, and no background of its own (ACCENT §4.4): the plate's tint, blur and
 *  hairline are `.glass-surface`'s, and app.css draws the pill around them.
 *
 *  The action is the point of it. Every toast this story raises is either reversible (Undo) or
 *  retryable (Retry), so the pill holds a message and one text button and nothing else. */
export function Toast({ message, action, onDismiss, durationMs = TOAST_MS }: ToastProps) {
  /** True while the pointer or the focus is on the pill. The Undo is why the toast is on screen at
   *  all, so a clock that runs down while someone is reaching for the button takes away the thing
   *  it was showing. The countdown restarts when they leave rather than resuming mid-flight:
   *  ponytail, carrying the remaining milliseconds is a second clock for a difference nobody can
   *  see, and restarting is the friendlier half of the same behaviour. */
  const [held, setHeld] = useState(false);
  // A ref, not a dependency: the shell's `onDismiss` is stable, but the timer effect must not be
  // re-armed by a caller that passes a fresh arrow on every render — that would reset the countdown
  // sixty times a second and the toast would never dismiss.
  const dismiss = useRef(onDismiss);
  useEffect(() => {
    dismiss.current = onDismiss;
  }, [onDismiss]);

  /** The pill outlives `message` by one leave animation, so the last thing it drew is kept here: a
   *  null message means "leaving", not "blank", and a pill that emptied itself out would fade a hole
   *  rather than the sentence the user is reading. */
  const last = useRef<{ message: string; action?: ToastAction | undefined } | null>(null);
  useEffect(() => {
    if (message !== null) last.current = { message, action };
  }, [message, action]);

  // The hold the leave is given, the same shape the ask panel and the detail pane use: `closing` is
  // true for one exit animation after the message goes (lib/motion.ts).
  const closing = useClosingSpring(message !== null, FAST_MS);
  const content = message !== null ? { message, action } : closing ? last.current : null;
  const shownAction = content?.action;

  useEffect(() => {
    if (message === null || held) return;
    const timer = window.setTimeout(() => dismiss.current(), durationMs);
    return () => window.clearTimeout(timer);
  }, [message, durationMs, held]);

  // The wrapper is `<output>` rather than a div with role="status": the element already carries the
  // role and the polite live region (the same call Network.tsx's merge note makes), and it is
  // always mounted, empty while there is nothing to say. The pill renders inside it only while it
  // is shown, so the region an announcement lands in outlives the toast that carried it.
  return (
    <output className="toast" aria-live="polite">
      {content !== null && (
        <GlassSurface
          slot="toolbar"
          className={cn("toast__pill", closing && "toast__pill--closing")}
          onMouseEnter={() => setHeld(true)}
          onMouseLeave={() => setHeld(false)}
          // React's focus events bubble, so these two catch the button inside the pill as well as
          // the pill itself — a focus ring on the Undo holds the toast exactly as a hover does.
          onFocus={() => setHeld(true)}
          onBlur={() => setHeld(false)}
        >
          <span className="toast__message">{content.message}</span>
          {shownAction !== undefined && (
            // No dismissal here: taking the action is not the same as ignoring the toast, and what
            // happens next belongs to the caller — the archive's Undo raises the restore's own
            // toast, and a dismissal from here would take that one away instead.
            <button type="button" className="toast__action" onClick={shownAction.onAction}>
              {shownAction.label}
            </button>
          )}
        </GlassSurface>
      )}
    </output>
  );
}
