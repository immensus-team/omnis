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

  // US-D09 §c.5: the pane has a *second* shape. 900–1279.98 is a floating pane too, so the bar §c.5
  // puts inside it has to stop being glass there — and React cannot read a container query, so the
  // cut is held in TS as well. Same drift as the narrow shell's, one tier up: change either side
  // alone and the bar keeps its material on a pane that is already a glass sheet.
  it("uses the same floating-pane breakpoint in app.css and lib/media-query.ts", () => {
    const css = readFileSync(join(TEST_DIR, "../src/app.css"), "utf8");
    const ts = readFileSync(join(TEST_DIR, "../../../packages/ui/src/lib/media-query.ts"), "utf8");
    const fromTs = ts.match(/FLOATING_PANE_QUERY = "\(max-width: ([\d.]+)px\)"/)?.[1];

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

/** The body of a top-level at-rule: from its header to the `}` that closes it in column 0 (inner
 *  rules close indented). The header is matched with its brace, so `(min-width: 900px) {` does not
 *  also match the `(min-width: 900px) and (max-width: 1279.98px) {` block above it. */
function atRuleBody(header: string): string {
  const css = readFileSync(join(TEST_DIR, "../src/app.css"), "utf8");
  const start = css.indexOf(header);
  expect(start, `${header} is not in app.css`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("\n}", start));
}

/** US-D09's chrome-row tier. This header is written twice in app.css — the pre-existing `>=900`
 *  grid tier shares it — so `atRuleBody` would return the wrong block; the chrome row is the later
 *  of the two, which is also what makes it win the cascade. */
const CHROME_ROW_HEADER = "@container shell (min-width: 900px) and (max-width: 1279.98px) {";

function chromeRowTier(): string {
  const css = readFileSync(join(TEST_DIR, "../src/app.css"), "utf8");
  const start = css.lastIndexOf(CHROME_ROW_HEADER);
  expect(start, `${CHROME_ROW_HEADER} is not in app.css`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("\n}", start));
}

describe("App shell thread toolbar tiers (US-D09 §c.5/§c.9)", () => {
  // The wide tier's bar is a row of the conversation that stays put, not a floating panel: `sticky`
  // keeps it in the scrolling flow, and `margin-left: auto` with `width: max-content` pins a block
  // child to the pane's trailing edge without a wrapper element.
  it("sticks the pane's bar in the conversation's own flow", () => {
    const body = ruleBody(
      atRuleBody("@container shell (min-width: 900px) {"),
      ".thread-toolbar--pane",
    );
    expect(body).toMatch(/position: sticky;/);
    expect(body).toMatch(/margin-left: auto;/);
  });

  // The bar is right-aligned to the same edge the sender's date is, and `--shadow-glass` reaches
  // ~20px below the capsule's box — so at rest, with no reserved band, the capsule's bottom edge and
  // its shadow land across the date (the 1440 acceptance frame showed it sliced). The clearance is
  // what the browser check in tools/e2e/d9-surfaces.spec.ts measures; this is the text half, so a
  // rule that loses the margin fails here rather than only in a screenshot nobody re-reads.
  it("keeps the pane's bar clear of the header's first line", () => {
    const body = ruleBody(
      atRuleBody("@container shell (min-width: 900px) {"),
      ".thread-toolbar--pane",
    );
    const margin = /margin-bottom: (\d+)px;/.exec(body);
    expect(margin, "the bar reserves no band below itself").not.toBeNull();
    // 28 is `--shadow-glass`'s reach (y-offset 8 plus half its 24px blur) plus the 8px the paint
    // drops below the flow box at `top: 8px` — both measured at 1440 in d9-surfaces.spec.ts.
    expect(Number(margin?.[1])).toBeGreaterThanOrEqual(28);
  });

  // §c.5 pins the narrow tier's bar at `bottom: var(--bar-gap)`, which is where §c.9 leaves the rail
  // bar — the same adaptation the BottomBar needed. These three numbers have to be the BottomBar's
  // own: the bar stands in that row, between its 44px filters circle and its 52px compose circle, so
  // the insets that clear them are what keeps it from covering either.
  it("floats it in the BottomBar's row, clear of both circles", () => {
    const body = ruleBody(
      atRuleBody("@media (max-width: 899.98px) {"),
      ".thread-toolbar--floating",
    );

    expect(body).toMatch(/position: fixed;/);
    expect(body).toContain("bottom: calc(56px + var(--bar-gap));");
    expect(body).toContain("left: calc(var(--bar-gap) + 44px + 8px);");
    expect(body).toContain("right: calc(var(--bar-gap) + 52px + 8px);");
  });

  // §c.5/M103: 36px in the capsule at the desk, 44px on a touch screen — the BottomBar's own circle
  // size. The base rule is the wide tier's, because it is the one that applies everywhere.
  it("sizes the buttons for the pointer: 36px wide, 44px narrow", () => {
    const css = readFileSync(join(TEST_DIR, "../src/app.css"), "utf8");
    // The base rule is top-level, so it sits at column 0 and ruleBody's two-space match would not
    // find it; the narrow tier's is indented inside its at-rule.
    const start = css.indexOf("\n.thread-toolbar__button {");
    expect(start, ".thread-toolbar__button is not declared at the top level").toBeGreaterThan(-1);
    const wide = css.slice(start, css.indexOf("}", start));
    expect(wide).toMatch(/width: 36px;/);
    expect(wide).toMatch(/height: 36px;/);

    const narrow = ruleBody(
      atRuleBody("@media (max-width: 899.98px) {"),
      ".thread-toolbar--floating .thread-toolbar__button",
    );
    expect(narrow).toMatch(/width: 44px;/);
    expect(narrow).toMatch(/height: 44px;/);
  });

  // Reviewer check 2 starts above the toolbar: the pane itself must not be a glass surface, or the
  // toolbar §c.5 puts inside it is glass in glass. US-D09 therefore moved the <=1279.98 sheet's
  // recipe out of a `.glass-surface` class and into that block — so the escape hatch at >=1280 has
  // nothing left to undo, and both halves of this pair can be asserted.
  it("keeps the pane's glass on the floating tier only, not on a class", () => {
    const fading = ruleBody(
      atRuleBody("@container shell (max-width: 1279.98px) {"),
      ".app-shell__detail",
    );
    expect(fading).toContain("background: var(--bg-overlay);");
    expect(fading).toContain("backdrop-filter: blur(24px) saturate(1.4);");

    const solid = ruleBody(
      atRuleBody("@container shell (min-width: 1280px) {"),
      ".app-shell__detail",
    );
    expect(solid).toContain("background: var(--bg-base);");
    expect(solid).toMatch(/backdrop-filter: none;/);
  });

  // 900–1279.98 is the tier the rejected pass was caught in. The pane is a glass sheet there (the
  // test above asserts the recipe), so the bar inside it gives up its material and becomes the
  // sheet's own chrome row. Three declarations carry that, and each one is load-bearing:
  //   - `.thread-toolbar--pane` is `position: static`, or the `>=900` sticky rule above would still
  //     apply — both blocks have the same specificity, so source order is the only thing deciding;
  //   - the pane is a flex column and `.thread-screen` is the scroller, so a static row can sit
  //     above the conversation instead of being scrolled away with it;
  //   - and no fill, blur or shadow of its own, because the sheet behind it is the material §4.4
  //     means. A fill here would be the nesting again, one token deep.
  it("makes the bar the sheet's own chrome row at 900–1279.98, with the scroller under it", () => {
    const block = chromeRowTier();

    const pane = ruleBody(block, ".app-shell__detail");
    expect(pane).toContain("display: flex;");
    expect(pane).toContain("flex-direction: column;");

    expect(ruleBody(block, ".thread-screen")).toContain("overflow-y: auto;");

    const bar = ruleBody(block, ".thread-toolbar--pane");
    expect(bar).toContain("position: static;");
    expect(bar).toContain("align-self: flex-end;");
    expect(bar).not.toMatch(/background:|backdrop-filter:|box-shadow:/);
  });

  // Source order is what makes the block above win, and it is also the reason the helper cannot use
  // a plain `indexOf`: app.css declares this same at-rule header twice (the pre-existing `>=900`
  // grid tier is the other one). If the chrome-row block ever moves above the sticky block, the bar
  // silently goes back to being sticky *and* glass.
  it("writes the chrome-row tier after the sticky rule it overrides", () => {
    const css = readFileSync(join(TEST_DIR, "../src/app.css"), "utf8");
    expect(css.lastIndexOf(CHROME_ROW_HEADER)).toBeGreaterThan(
      css.indexOf("@container shell (min-width: 900px) {"),
    );
  });

  // The compose circle is the bar's *trailing* piece, and the auto margin is what keeps it there:
  // with a thread open the shell hands the bar no ask pill (`App.tsx` renders `null` for children),
  // so the pill's `flex: 1 1 auto` is gone and the circle slid left to sit 8px after the filters —
  // exactly where the floating action bar stands. The 390 shot had the bar covering it.
  it("keeps the compose circle at the bar's trailing edge when there is no ask pill", () => {
    expect(ruleBody(narrowTier(), ".bottom-bar__piece--compose")).toContain("margin-left: auto;");
  });

  // `--bar-h` is the BottomBar's own row height and this capsule stands in that row, but the box is
  // content-box: said as `height: var(--bar-h)` the 2px of padding and the 1px hairline per side
  // landed *outside* it and the bar measured 58 — three pixels proud of the two circles it stands
  // between. The subtraction is the chrome (2 × 2px + 2 × 1px), which is the one thing a test can
  // hold: the rule may not go back to the bare token.
  it("sizes the floating capsule to the row rather than to the row plus its own chrome", () => {
    const body = ruleBody(
      atRuleBody("@media (max-width: 899.98px) {"),
      ".thread-toolbar--floating",
    );
    expect(body).toContain("height: calc(var(--bar-h) - 6px);");
    expect(body).toContain("min-height: calc(var(--bar-h) - 6px);");
    expect(body).not.toContain("height: var(--bar-h);");
  });

  // §c.6/§c.7/§c.8 under reduced transparency: the three D9 surfaces go flat, and the fill is only
  // half of that. The blur has to be switched off on the two-class selector here: tokens.css says
  // it on a bare `.glass-surface`, but that media block sits before the `.glass-surface` rule it
  // means to override, so the base rule's `backdrop-filter` wins the cascade by source order and
  // the preference is ignored — a rule that reads right and does nothing.
  it("flattens the sheet, the prompt and the menu under reduced transparency", () => {
    const body = atRuleBody("@media (prefers-reduced-transparency: reduce) {");
    const sheet = ruleBody(body, ".glass-surface.sheet");
    expect(sheet).toContain("background: var(--bg-sheet);");
    expect(sheet).toContain("backdrop-filter: none;");

    const prompt = ruleBody(body, ".glass-surface.confirm-prompt");
    expect(prompt).toContain("background: var(--bg-sheet);");
    expect(prompt).toContain("backdrop-filter: none;");

    const menu = ruleBody(body, ".glass-surface.context-menu");
    expect(menu).toContain("background: var(--bg-elevated);");
    expect(menu).toContain("backdrop-filter: none;");
  });
});
