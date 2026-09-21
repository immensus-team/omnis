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

export function useKeymap(onResolve: (action: string) => void) {
  const [state, setState] = useState<KeySeqState | null>(null);
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableTarget(e.target)) return;
      const next = reduceKeySequence(state, e.key, Date.now());
      setState(next.resolved ? null : next);
      if (next.resolved) onResolve(next.resolved);
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [state, onResolve]);
}
