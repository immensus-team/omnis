// @vitest-environment jsdom
// The root `pnpm test` does not read apps/desktop/vitest.config.ts (the same situation as the
// packages/ui tests), so this file declares its own environment and setup.
import "./setup";

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/** This test file's own directory. vitest's transform can leave import.meta.url on a scheme other
 *  than file: (fileURLToPath then throws "The URL must be of scheme file"), so only the pathname is
 *  taken — it does not depend on cwd, so it is the same under the root `pnpm test` and under
 *  `--filter @omnis/desktop`. */
const TEST_DIR = dirname(new URL(import.meta.url).pathname);

// This test only asks whether the screens are actually mounted in the shell. The Zero round trip
// is tools/e2e's job (Playwright).
const chain: unknown = new Proxy(() => chain, {
  get: () => chain,
  apply: () => chain,
});
vi.mock("../src/zero-client.js", () => ({
  initZero: () => chain,
  useZeroClient: () => chain,
  loadZeroToken: async () => {},
}));
vi.mock("@rocicorp/zero/react", () => ({
  useQuery: () => [[], { type: "complete" }],
  useZero: () => chain,
  ZeroProvider: ({ children }: { children: unknown }) => children,
}));

// jsdom has neither ResizeObserver nor Element.scrollIntoView, and cmdk (Command.List) reaches
// for both in its mount effect. Real browser behaviour is covered by tools/e2e's Playwright.
Element.prototype.scrollIntoView ??= () => {};
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const { App } = await import("../src/App");

describe("App shell (US-A25 'empty shell' + A26-A31 screen routing)", () => {
  it("mounts the Inbox screen", () => {
    render(<App />);
    expect(screen.getByRole("radiogroup", { name: "Inbox filters" })).toBeInTheDocument();
  });

  it("opens the ask panel on Cmd+K (US-D01: the inline ask bar's AI panel, not a modal palette)", () => {
    render(<App />);
    // Matched by role alone — the panel's accessible name is product copy that still goes through
    // the app's Korean-first i18n layer, and this test is about the shortcut, not that string.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("App shell layout (U1 kinso: rail + main column)", () => {
  it("does not reserve a detail column while nothing is open", () => {
    // In the kinso reference the Inbox card fills the window until something is selected — an
    // empty detail pane must not take width.
    render(<App />);
    expect(screen.queryByTestId("detail-pane")).not.toBeInTheDocument();
    expect(screen.getByTestId("app-shell")).not.toHaveClass("app-shell--with-detail");
  });
});

describe("App shell responsive contract (US-D02b)", () => {
  // The narrow-shell breakpoint is held in **both** the CSS container query and TS — React cannot
  // read a container query's result, so the two cannot be merged. Change one and the shell draws
  // the wrong tier (a bottom bar with six tiles, or the reverse) while the screen still looks
  // plausible. This test stops that drift: when app.css changes, media-query.ts changes with it.
  // US-D08: the literal moved out of channel-rail.tsx into lib/media-query.ts, because the row
  // swipe is narrow-only too and a second copy of it in the row is exactly the drift this guards.
  it("uses the same narrow-shell breakpoint in app.css and lib/media-query.ts", () => {
    const css = readFileSync(join(TEST_DIR, "../src/app.css"), "utf8");
    const ts = readFileSync(join(TEST_DIR, "../../../packages/ui/src/lib/media-query.ts"), "utf8");
    // Look for the cut TS asserts inside the CSS. That catches drift in both directions: change
    // either side alone and the string is no longer in the CSS, which fails here. (Picking "the
    // narrowest cut" instead would grab the wrong value the moment a narrower cut is added.)
    const fromTs = ts.match(/NARROW_SHELL_QUERY = "\(max-width: ([\d.]+)px\)"/)?.[1];

    expect(fromTs).toBeDefined();
    expect(css).toContain(`@container shell (max-width: ${fromTs}px)`);
  });
});

/** US-D08 §c.9's sum, in the three places it is written: what the list reserves at the bottom, what
 *  the detail sheet stops at, and where the ask panel opens to. One expression, so a change to
 *  either token (`--bar-h`, `--bar-gap`) or to the rail's 56px moves all three together — and this
 *  test fails if any one of them is written by hand instead. */
const TWO_BARS = "calc(56px + var(--bar-h) + var(--bar-gap) * 2)";

/** app.css from the `<900` shell block onwards. Everything the two bars' rules can live in is at or
 *  after that line, and matching against the whole file would also pass on a rule that had drifted
 *  into the wide tier — where a BottomBar would cover the list. */
function narrowTier(): string {
  const css = readFileSync(join(TEST_DIR, "../src/app.css"), "utf8");
  const start = css.indexOf("@container shell (max-width: 899.98px)");
  expect(start).toBeGreaterThan(-1);
  return css.slice(start);
}

/** The declarations of the first `selector {` in `css`, up to its closing brace. Deliberately not a
 *  CSS parser: these are two-line rules whose values are literal strings, and a parser would be a
 *  dependency for a test that reads one number. */
function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(`\n  ${selector} {`);
  expect(start, `${selector} is not declared in the narrow tier`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
}

describe("App shell bottom bars (US-D08 §c.9)", () => {
  // The two bars of the narrow tier are stacked, not merged: the rail bar keeps `bottom: 0` and its
  // 56px (it is full-bleed and carries the tier's only top hairline), and the BottomBar floats one
  // --bar-gap above it. At `bottom: 0` the circles would sit on the rail's hairline and the two
  // bars would share a row of pixels.
  it("floats the BottomBar one gap clear of the rail bar", () => {
    const css = narrowTier();
    const rail = ruleBody(css, ".channel-rail");
    expect(rail).toMatch(/bottom: 0;/);
    expect(rail).toMatch(/height: 56px;/);
    // The literal here is the rail's own height above — the same 56px the padding sum names.
    expect(ruleBody(css, ".bottom-bar")).toContain("bottom: calc(56px + var(--bar-gap));");
  });

  it("reserves room for both bars in the list, the sheet and the panel", () => {
    const css = narrowTier();
    expect(ruleBody(css, ".app-shell__main")).toContain(`padding-bottom: ${TWO_BARS};`);
    expect(ruleBody(css, ".app-shell__detail")).toContain(`bottom: ${TWO_BARS};`);
    expect(ruleBody(css, ".bottom-bar .ask-panel")).toContain(`bottom: ${TWO_BARS};`);
  });

  // §c.9's three pieces: a 44px circle, a pill of --bar-h, a 52px circle. The pill's height is the
  // one that has to be said here — it is 44px at the top of the list (`.ask-bar__pill`) and the
  // bar's own rule is what raises it.
  it("sizes the pieces as the brief does: 44px, --bar-h, 52px", () => {
    const css = narrowTier();
    expect(ruleBody(css, ".bottom-bar .ask-bar__pill")).toContain("height: var(--bar-h);");
    expect(ruleBody(css, ".bottom-bar__piece")).toMatch(/width: 44px;/);
    expect(ruleBody(css, ".bottom-bar__piece--compose")).toMatch(/width: 52px;/);
  });

  // The panel opens upward (below the bar there is a 12px gap and then the rail) and is pinned to
  // the shell's gutters rather than to the pill it belongs to: at 390 the pill is ~246px wide, and
  // a panel clipped to that is a column of ellipses. Both edges pinned is also what keeps it from
  // widening the page — the left/right insets are the constraint, not its content.
  it("opens the panel upward, pinned to the bar's gutters", () => {
    const panel = ruleBody(narrowTier(), ".bottom-bar .ask-panel");
    expect(panel).toMatch(/top: auto;/);
    expect(panel).toMatch(/left: var\(--bar-gap\);/);
    expect(panel).toMatch(/right: var\(--bar-gap\);/);
    expect(panel).toMatch(/width: auto;/);
    expect(panel).toMatch(/max-width: none;/);
  });
});

describe("App shell ask bar placement (US-D08 §c.9)", () => {
  // jsdom 25 has no window.matchMedia at all, which is why every test above renders the wide tier
  // for free — lib/media-query.ts's try/catch turns the missing function into "not narrow". The
  // narrow tier needs the stub, and only these two tests want it.
  const REAL_MATCH_MEDIA = window.matchMedia;
  afterEach(() => {
    window.matchMedia = REAL_MATCH_MEDIA;
  });
  function stubNarrow(): void {
    window.matchMedia = ((query: string) => ({
      media: query,
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
  }

  it("keeps the ask bar at the top of the list while the shell is wide", () => {
    render(<App />);

    expect(document.querySelector(".bottom-bar")).toBeNull();
    expect(document.querySelector(".ask-bar")?.parentElement).toBe(
      document.querySelector(".app-shell__main"),
    );
  });

  it("moves it into the BottomBar when the shell is narrow, and renders it once", () => {
    stubNarrow();
    render(<App />);

    // The bottom bar's middle piece, and only one ask bar in the document — a second render would
    // be a second cmdk list and two things answering Cmd+K.
    expect(document.querySelector(".bottom-bar > .ask-bar")).not.toBeNull();
    expect(document.querySelectorAll(".ask-bar")).toHaveLength(1);
    // Both bars of the tier are on screen: the rail's fixed bar and, above it, the BottomBar with
    // its two circles.
    expect(document.querySelector(".channel-rail")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Filters" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compose" })).toBeInTheDocument();
  });
});
