import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useRef } from "react";
import { createPortal } from "react-dom";
import { trapTab, useInitialFocus, useReturnFocus } from "../lib/focus-trap.js";
import { GlassSurface } from "./glass-surface.js";

// US-D09 §c.8: the inline confirmation. M120 is the spec and it is a *prompt*, not a sheet — a
// small centred glass card over a dimmed backdrop, not a slide-up panel. It shares the trap and the
// return-focus rule with the Sheet (lib/focus-trap.ts) and nothing else: a prompt that slid up from
// the bottom would read as a second sheet with two buttons in it.
//
// Portalled for the same two reasons the Sheet is — #root is a `contain: layout` container, and the
// card is glass, which must not land inside another `.glass-surface`.

export interface ConfirmPromptProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** §c.8: the title **is** the whole question ("Archive 3 threads?"). */
  title: string;
  /** What happens, never why. Omitted for a question the title already answers in full. */
  body?: ReactNode;
  confirmLabel: string;
  /** Defaults to "Cancel" — the plain noun, §e guard 12. */
  cancelLabel?: string;
  /** Swaps the confirm pill to `--danger-500` (an action that cannot be undone). Archiving can, so
   *  it does not pass this. */
  destructive?: boolean;
  onConfirm: () => void;
}

export function ConfirmPrompt({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive,
  onConfirm,
}: ConfirmPromptProps) {
  const confirmButton = useRef<HTMLButtonElement>(null);
  useReturnFocus(open);
  useInitialFocus(open, confirmButton);
  if (!open) return null;

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onOpenChange(false);
      return;
    }
    trapTab(e);
  };

  return createPortal(
    <div
      className="confirm-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
      onKeyDown={onKeyDown}
    >
      <GlassSurface
        slot="sheet"
        className="confirm-prompt"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-prompt-title"
        {...(body === undefined ? {} : { "aria-describedby": "confirm-prompt-body" })}
      >
        <h2 className="confirm-prompt__title" id="confirm-prompt-title">
          {title}
        </h2>
        {body !== undefined && (
          <p className="confirm-prompt__body" id="confirm-prompt-body">
            {body}
          </p>
        )}
        {/* Cancel first in the DOM and `wrap-reverse` in CSS. On one line the two read
            cancel-then-confirm left to right, which is also the Tab order. When a label needs more
            than its half they stack — and `wrap-reverse` puts the first line at the cross-end, so
            the wrapped confirm lands **on top** (M112) with no measurement pass and no width
            branch in JS. Swapping the two elements here would invert the stack silently. */}
        <div className="confirm-prompt__actions">
          <button
            type="button"
            className="confirm-prompt__button confirm-prompt__button--cancel"
            onClick={() => onOpenChange(false)}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="confirm-prompt__button confirm-prompt__button--confirm"
            data-destructive={destructive ? "true" : undefined}
            ref={confirmButton}
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </GlassSurface>
    </div>,
    document.body,
  );
}

/** §c.8's three questions, in one place so the wording cannot drift between call sites. Plain
 *  sentences: the title is the question, the body says what happens (guard 12). */
export const CONFIRM_COPY = {
  approve: (what: string): { title: string; body: string } => ({
    title: "Approve this action?",
    body: what,
  }),
  archiveThreads: (count: number): { title: string; body: string } => ({
    title: `Archive ${count} ${count === 1 ? "thread" : "threads"}?`,
    body: "They leave the inbox and stay in Archived. You can restore them from there.",
  }),
} as const;
