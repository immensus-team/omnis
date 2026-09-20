import { useEffect, useState } from "react";

const DIRECT_KEYS: Record<string, string> = {
  j: "next-row",
  k: "prev-row",
  e: "archive",
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

/** A5 §2.4: 'g' 다음 300ms 안에 letter가 오면 go-to 액션으로 resolve. 순수 리듀서라 타이머 없이 테스트 가능. */
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

export function useKeymap(onResolve: (action: string) => void) {
  const [state, setState] = useState<KeySeqState | null>(null);
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const next = reduceKeySequence(state, e.key, Date.now());
      setState(next.resolved ? null : next);
      if (next.resolved) onResolve(next.resolved);
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [state, onResolve]);
}
