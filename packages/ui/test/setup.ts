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

// deviation: jsdom 25 implements neither PointerEvent nor pointer capture (probed: both are
// `undefined`). lib/pointer-drag.ts is Pointer Events only — the whole point of §c.1 is that no
// drag library is installed — so without these, `@testing-library`'s fireEvent.pointerDown builds
// a plain Event with no `button`/`pointerType` on it and the primitive sees `button === undefined`
// on every gesture and returns before it starts.
// PointerEvent extends jsdom's real MouseEvent, so clientX/Y, button and the event plumbing are the
// real ones and only the pointer fields are filled in.
// The capture trio below is a no-op that exists to be *spied on*, not to be used: lib/pointer-drag.ts
// binds its listeners on `window` precisely because capturing the element would end the gesture at
// the first reorder (see its header), and pointer-drag.test.tsx asserts `setPointerCapture` is never
// called. Removing the stubs would make that assertion pass for the wrong reason — an undefined
// method cannot be called either.
// ponytail: no capture state, no implicit release. Add it if a test ever asserts retargeting.
if (typeof globalThis.PointerEvent === "undefined") {
  class PointerEventStub extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly isPrimary: boolean;
    readonly width: number;
    readonly height: number;
    readonly pressure: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? "";
      this.isPrimary = init.isPrimary ?? true;
      this.width = init.width ?? 1;
      this.height = init.height ?? 1;
      this.pressure = init.pressure ?? 0.5;
    }
  }
  Object.defineProperty(globalThis, "PointerEvent", { value: PointerEventStub });
}
if (typeof Element.prototype.setPointerCapture === "undefined") {
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => false;
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
