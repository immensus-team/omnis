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

// deviation: jsdom 25 implements no matchMedia at all (probed: `window.matchMedia` is undefined).
// That is a gap rather than a preference, and it became load-bearing with the motion wave, which
// reads media queries on mount: @formkit/auto-animate throws outright without it — it checks
// `prefers-reduced-motion` before it will animate a list — and lib/media-query.ts asks for
// `prefers-reduced-transparency` the same way.
// Every query answers `false`, and the listener methods are real but never fire. That is all a
// component that *reads* a preference needs. A test that needs to *move* an answer installs its own
// stub over this one: motion-prefs.test.tsx does, because motion caches its answer and only ever
// updates it from a change event. The deprecated addListener/removeListener pair is here because
// libraries of this generation still call it.
// ponytail: no evaluator and no re-evaluation on resize. Add one if a test ever needs a query this
// answers wrongly.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// deviation: jsdom 25 implements no Web Animations API (probed: `Element.prototype.animate` is
// undefined), and @formkit/auto-animate calls it the moment a list's children change. Without this,
// *rendering* an AnimatedList is fine and *using* one throws — from a MutationObserver, on a later
// tick, after the test that caused it has already been reported as passing. That is the worst shape
// a failure can take, which is why this is a stub rather than something each test opts into.
// It records nothing and finishes nothing: it exists so the call is a call rather than a crash, and
// so a test can spy on it to tell an animation that ran from one that was skipped — which is how
// animated-list.test.tsx asserts auto-animate's reduced-motion bail-out.
// ponytail: no timeline, no currentTime, no finish event. Add them if a test ever asserts on the
// animation itself; jsdom has no layout, so it cannot.
if (typeof Element.prototype.animate === "undefined") {
  Element.prototype.animate = (() => ({
    addEventListener: () => {},
    removeEventListener: () => {},
    cancel: () => {},
    finish: () => {},
    play: () => {},
    pause: () => {},
    currentTime: 0,
    playState: "finished",
  })) as unknown as Element["animate"];
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
