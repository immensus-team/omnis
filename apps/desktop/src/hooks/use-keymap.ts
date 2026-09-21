import { useEffect, useState } from "react";

const DIRECT_KEYS: Record<string, string> = {
  j: "next-row",
  k: "prev-row",
  e: "archive",
  u: "unarchive",
  r: "reply",
  a: "approve",
  s: "snooze",
  d: "delegate",
  l: "label",
  t: "add-task",
  n: "focus-note",
  x: "toggle-select",
  // loop-r1-06: the keyboard twin of the toast's Undo. It is live exactly as long as that button
  // is — the screen behind it arms and disarms the undo with the toast it raised — so `z` on a
  // screen with nothing to take back is a key that does nothing, which is what it already was.
  z: "undo",
};
const GOTO_KEYS: Record<string, string> = {
  i: "go-inbox",
  t: "go-today",
  k: "go-tasks",
  n: "go-network",
  o: "go-notes",
  d: "go-digest",
  s: "go-settings",
};
const GOTO_WINDOW_MS = 300;

export interface KeySeqState {
  pending: "g" | null;
  resolved?: string;
  at: number;
}

/** A5 §2.4: a letter within 300ms of a `g` resolves to a go-to action. A pure reducer, so it is
 *  testable without a timer. */
export function reduceKeySequence(
  prev: KeySeqState | null,
  key: string,
  atMs: number,
): KeySeqState {
  if (prev?.pending === "g" && atMs - prev.at <= GOTO_WINDOW_MS) {
    const action = GOTO_KEYS[key];
    return action !== undefined
      ? { pending: null, resolved: action, at: atMs }
      : { pending: null, at: atMs };
  }
  if (key === "g") return { pending: "g", at: atMs };
  const direct = DIRECT_KEYS[key];
  return direct !== undefined
    ? { pending: null, resolved: direct, at: atMs }
    : { pending: null, at: atMs };
}

/** A single key must not leak into an action while someone is typing in the ask bar, a composer or
 *  the palette — typing an "e" used to archive the thread. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

/** The layers that own the keyboard while they are up: a modal (the ConfirmPrompt, the filters
 *  sheet, the ask drawer), a popover menu. `[role="listbox"]` is deliberately **not** here — the
 *  Inbox list is one, and `j`/`k` inside it are the screen's own keys.
 *
 *  Below 900 the thread pane is itself a vaul drawer and does carry `[data-vaul-drawer]`, so it is
 *  named as the one exception below rather than left out of this list: it is the document being
 *  read, not a layer over the document. */
const OVERLAY_ANCESTORS =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [data-vaul-drawer]';
const THREAD_SHEET = ".app-shell__detail";

/** An overlay the thread sheet is, or holds, is not an overlay *over* the thread sheet — that is the
 *  drawer's own box (App.tsx puts `.app-shell__detail` on `Drawer.Content`), and reading it is what
 *  the screen is for. An overlay opened on top of it is portaled out and does not match. */
function holdsThreadSheet(el: Element): boolean {
  return el.matches(THREAD_SHEET) || el.querySelector(THREAD_SHEET) !== null;
}

/** L2-03/NC2-15: a single-key shortcut must not fire from inside an overlay either. The bug this
 *  closes is silent data loss rather than a stray scroll: below 900 ⌘K or a tap opens the ask drawer,
 *  the drawer covered the bar's own input and held none of its own, so focus landed on the
 *  "Suggestions" tab button — and typing "Brightstone" there ran its `e` as Inbox's archive key and
 *  archived the selected thread through `POST /api/threads/…/archive`. Every keymap in the app
 *  (Shell's `g`-letters, Inbox's row keys, Thread's `r`) routes through `useKeymap`, so one guard
 *  here is the guard for all of them. */
export function isInsideOverlay(target: EventTarget | null): boolean {
  if (target instanceof Element) {
    const owner = target.closest(OVERLAY_ANCESTORS);
    if (owner !== null && !holdsThreadSheet(owner)) return true;
  }
  // The document scan is the half that does not depend on where the caret is: a modal that is up
  // owns the keyboard whether or not the focus happened to stay inside it. `querySelectorAll` rather
  // than `querySelector` because the one overlay that may be skipped is the thread sheet, and a
  // modal stacked *over* it has to still count.
  return Array.from(document.querySelectorAll('[aria-modal="true"]')).some(
    (el) => !holdsThreadSheet(el),
  );
}

export function useKeymap(onResolve: (action: string) => void) {
  const [state, setState] = useState<KeySeqState | null>(null);
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;
      if (isInsideOverlay(e.target)) return;
      const next = reduceKeySequence(state, e.key, Date.now());
      setState(next.resolved ? null : next);
      if (next.resolved) {
        // The letter must not land in whatever the action just focused. `r` opens the reply composer
        // and focuses its box inside this same keydown, so without this a real keyboard sends the
        // browser on to insert the "r" into the sentence the key was meant to start — one stray
        // letter per shortcut. jsdom cannot see it: `fireEvent.keyDown` dispatches the keydown and
        // stops there, where a browser runs the whole sequence (keydown, beforeinput, insertion).
        // Nothing else is lost by refusing the default: the target is never an editable one — that is
        // the guard above — so the press had no other default to perform.
        e.preventDefault();
        onResolve(next.resolved);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [state, onResolve]);
}
