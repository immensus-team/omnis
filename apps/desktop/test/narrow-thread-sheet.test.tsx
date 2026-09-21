// @vitest-environment jsdom
// motion-OSS S5: below 900px the detail pane is the same `vaul` drawer the filters come up in, so a
// row press opens the thread in a drawer rather than in the 420px column. What this file holds is the
// *mount* — that the pane really is a drawer at that tier, that the wide tier's pane is not one, and
// that the two things a drawer brings with it are there (a grabber to drag by, and the scrim over the
// list). Its box is asserted against app.css in app-shell.test.tsx, because that is where the numbers
// live: the full-viewport height `vaul`'s snap offset needs, the window's width, the glass recipe.
//
// The root `pnpm test` does not read apps/desktop/vitest.config.ts, so the environment and setup are
// declared by the file itself.
import "./setup";

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/** One pending approval, so the header draws the queue's own button — which is this tier's way into
 *  the drawer. It is not the *only* way (NC-37's back row and a row press both open it), but it is
 *  the one the 390 acceptance frames are shot in, and it is the one that reaches the pane without a
 *  thread: with nothing open the pane is the queue. */
const APPROVAL = {
  id: "approval-1",
  thread_id: "11111111-1111-1111-1111-111111111111",
  risk: "normal",
  created_at: Date.now() - 3_600_000,
  action: "send",
  description: "Send the follow-up to the launch thread",
  config: { allow_accept: true, allow_edit: true, allow_respond: true, allow_ignore: true },
};

/** Table-tagged, the way archive-inbox.test.tsx builds it: the shell runs a query per table, and one
 *  shared value would answer the approval queue and the thread list the same. */
function taggedQuery(table: string): unknown {
  const proxy: unknown = new Proxy(
    {},
    { get: (_t, prop) => (prop === "__table" ? table : () => proxy) },
  );
  return proxy;
}
const store: Record<string, unknown[]> = { pending_approvals: [APPROVAL] };
const zero = { query: new Proxy({}, { get: (_t, table) => taggedQuery(String(table)) }) };

vi.mock("../src/zero-client.js", () => ({
  initZero: () => zero,
  useZeroClient: () => zero,
  loadZeroToken: async () => {},
}));
vi.mock("@rocicorp/zero/react", () => ({
  useQuery: (q: { __table: string }) => [store[q.__table] ?? [], { type: "complete" }],
  useZero: () => zero,
  ZeroProvider: ({ children }: { children: unknown }) => children,
}));

// jsdom has neither ResizeObserver nor Element.scrollIntoView, and cmdk (the inline ask bar's
// Command.List) reaches for both on mount.
Element.prototype.scrollIntoView ??= () => {};
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const { App } = await import("../src/App");

/** jsdom has no layout and answers no media query, so the tier is decided by this stub and nothing
 *  else — the same one sheet.test.tsx and thread-toolbar-tiers.test.tsx use. */
const REAL_MATCH_MEDIA = window.matchMedia;
afterEach(() => {
  window.matchMedia = REAL_MATCH_MEDIA;
});
function stubTier(narrow: boolean): void {
  window.matchMedia = (() => ({
    matches: narrow,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

const scrim = () => document.querySelector("[data-vaul-overlay].sheet-overlay");

/** Opens the drawer the way the tier opens it. loop-r1's NC-03 finding is what makes this a press
 *  and not an arrival: the pane used to raise itself on the inbox's pending-approval queue, and at
 *  390 that was a modal sheet over the list, so the inbox was unreachable until every approval had
 *  been decided. Below 1280 the queue still says it is there — the header's button does — and the
 *  user is the one who takes it up. What S5 changed is the shape that press gives the pane. */
function openDrawer(): void {
  fireEvent.click(screen.getByRole("button", { name: "1 needs approval" }));
}

describe("The narrow thread sheet (motion-OSS S5)", () => {
  it("is the pane itself above the breakpoint, with no drawer in the tree at all", () => {
    stubTier(false);
    render(<App />);

    expect(screen.getByTestId("detail-pane")).toBeInTheDocument();
    expect(document.querySelector("[data-vaul-drawer]")).toBeNull();
    expect(scrim()).toBeNull();
    // The pane's own trailing chevron is the column's, and the drawer's grabber would be a second
    // handle on a pane that has no drag.
    expect(document.querySelector(".detail-pane__chrome")).not.toBeNull();
    expect(document.querySelector("[data-vaul-handle]")).toBeNull();
  });

  it("is vaul's drawer below it: a grabber to drag by, and the scrim over the list", () => {
    stubTier(true);
    render(<App />);
    openDrawer();

    const drawer = document.querySelector("[data-vaul-drawer]");
    expect(drawer).not.toBeNull();
    expect(drawer).toHaveClass("app-shell__detail");
    expect(drawer).toHaveAttribute("data-vaul-drawer-direction", "bottom");
    // Radix's, not `focus-trap.ts`'s — the same machinery the filters sheet gets.
    expect(drawer).toHaveAttribute("aria-modal", "true");
    expect(drawer).toHaveAccessibleName("Details");
    // The pane is what the drawer draws, and the two are different elements: the drawer is the box
    // `vaul` measures and drags, the pane is the `<section>` the screens were written against.
    expect(drawer).toContainElement(screen.getByTestId("detail-pane"));
    // `handleOnly` puts the whole gesture on the grabber, because the pane's body is a scroller.
    expect(drawer?.querySelector("[data-vaul-handle].drawer__grabber")).not.toBeNull();
    expect(drawer?.querySelectorAll("[data-vaul-handle]")).toHaveLength(1);
    // The scrim is the drawer family's — the filters sheet's own `.sheet-overlay`, reused.
    expect(scrim()).not.toBeNull();
  });

  it("dismisses on the scrim, and does not spring back on the queue that opened it", () => {
    stubTier(true);
    render(<App />);
    openDrawer();
    expect(screen.getByTestId("detail-pane")).toBeInTheDocument();

    // The approval is still pending and the queue's flag is still set — `queueOpen` is *why*
    // `paneVisible` is true — so closing the pane has to clear it, not just the two targets a thread
    // or a person would have set. Clearing only those leaves the drawer rising straight back up on
    // the next render, which is the one-press-two-things shape the dismissal exists to prevent; the
    // assertion below is that it is gone and stays gone.
    fireEvent.click(scrim() as HTMLElement);

    expect(screen.queryByTestId("detail-pane")).not.toBeInTheDocument();
    expect(document.querySelector("[data-vaul-drawer]")).toBeNull();
  });
});
