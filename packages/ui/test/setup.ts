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
