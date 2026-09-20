import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// deviation: plan's vitest.config.ts has no `globals: true`, so RTL's automatic
// afterEach(cleanup) detection never fires and DOM leaks across tests in the same
// file (button.test.tsx's 2 tests both rendered a <button>). Explicit cleanup instead
// of adding globals:true — smaller blast radius, doesn't change other test files' semantics.
afterEach(() => {
  cleanup();
});

// deviation: jsdom 25 doesn't implement ResizeObserver or Element.scrollIntoView, which
// cmdk (Task 7 CommandPalette) calls on mount/select to track list height and scroll the
// active item into view. Not spec'd anywhere — jsdom's own known gaps.
// Minimal no-op stubs, ponytail: no resize/scroll behavior simulated, add real ones if a
// test ever asserts on cmdk's height- or scroll-driven behavior.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (typeof Element.prototype.scrollIntoView === "undefined") {
  Element.prototype.scrollIntoView = () => {};
}

// deviation: Node 22 defines a global `localStorage` getter that returns undefined unless
// `--localstorage-file` is passed, and vitest's jsdom populateGlobal never installs jsdom's
// own Storage over it — so `localStorage` is undefined for both the bare global and
// `window.localStorage` (verified by probe). US-D01's model picker (lib/ask-model.ts) reads
// and writes it inside try/catch, so the missing Storage is silent: the picker still changes
// label, it just never persists, and no test could see that.
// Minimal in-memory Storage, ponytail: no quota/eviction semantics, add them if a test ever
// asserts on either. The store lives for the whole file (one module graph per file), which is
// why tests that touch it clear it in beforeEach.
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
    },
  });
}
