// @vitest-environment jsdom
// The root `pnpm test` does not read apps/desktop/vitest.config.ts (the same situation as the
// packages/ui tests), so this file declares its own environment and setup.
import "./setup";

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  DETAIL_COLLAPSED_KEY,
  DETAIL_DEFAULT_WIDTH,
  DETAIL_MIN_WIDTH,
  DETAIL_WIDTH_KEY,
} from "@omnis/ui";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  // US-B29: `?screen=tasks` routes to the Tasks screen, and the shell mounts it inside the same
  // rail/main shell as the Inbox — the same one-line proof the Inbox case above makes.
  it("mounts the Tasks screen when the shell is asked for it", () => {
    render(<App screen="tasks" />);
    expect(screen.getByRole("radiogroup", { name: "Task views" })).toBeInTheDocument();
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

/** loop-r1-01: the rail is not the only door. A5 §2.4's `g`+letter keymap and the palette's
 *  Navigate actions both call the shell's one goTo, and what these cases assert is that the door is
 *  wired — that the screen actually mounts is the screens' own tests' business. */
describe("App shell screen navigation (loop-r1-01)", () => {
  const inboxFilters = () => screen.queryByRole("radiogroup", { name: "Inbox filters" });

  /** ⌘K plus the panel's own tab. The action list is not in the DOM until it is asked for: the
   *  panel derives its tab from the input (ask-panel.tsx), showing Suggestions while the bar is
   *  empty — the same reason the search-mode test below has to type before it can see an action. */
  const openCommands = () => {
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Commands" }));
  };

  it("goes to Settings on `g s`, and back to the Inbox on `g i`", () => {
    render(<App />);
    expect(inboxFilters()).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "s" });
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    // One screen at a time: the list is gone, not merely covered.
    expect(inboxFilters()).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "i" });
    expect(inboxFilters()).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Settings" })).not.toBeInTheDocument();
  });

  // NC-01: the Commands list held one item. Seven screens, seven Navigate actions — the palette is
  // the third door onto the same navigation, and a screen missing from it is a screen most users
  // never find.
  it("offers all seven screens as Navigate actions in the palette", () => {
    render(<App />);
    openCommands();

    for (const name of [
      "Go to Inbox",
      "Go to Today",
      "Go to Tasks",
      "Go to Network",
      "Go to Notes",
      "Go to Digest",
      "Go to Settings",
    ]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it("switches screen from a palette action's perform", () => {
    render(<App />);
    openCommands();

    fireEvent.click(screen.getByText("Go to Tasks"));
    expect(screen.getByRole("radiogroup", { name: "Task views" })).toBeInTheDocument();
  });
});

describe("App shell search mode (US-B27)", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** The hub's GET /search answer for one item hit. */
  const searchAnswer = (): Response =>
    new Response(
      JSON.stringify({
        q: "launch",
        took_ms: 3,
        truncated: false,
        groups: [
          {
            kind: "items",
            total: 1,
            results: [
              {
                kind: "item",
                id: "i1",
                score: 1,
                title: "omnis launch sync",
                snippet: "Let's sync tomorrow at 10am",
                at: null,
                channel: "gmail",
                deep_link: { screen: "thread", thread_id: "t1", item_id: "i1" },
              },
            ],
          },
        ],
      }),
      { status: 200 },
    );

  it("asks the hub and shows results when the query matches no action", async () => {
    const fetchMock = vi.fn(async () => searchAnswer());
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    fireEvent.change(screen.getByPlaceholderText("Start typing to ask or search"), {
      target: { value: "launch" },
    });

    // The palette debounces 180ms before it hands the query over.
    await waitFor(() => expect(screen.getByText("omnis launch sync")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8787/search?q=launch");
  });

  it("does not ask the hub while the query still matches an action", async () => {
    const fetchMock = vi.fn(async () => searchAnswer());
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    fireEvent.change(screen.getByPlaceholderText("Start typing to ask or search"), {
      target: { value: "inbox" },
    });

    // Wait past the debounce window: the request that must not happen has had its chance.
    await new Promise((resolve) => setTimeout(resolve, 300));
    // Scoped to /search: the shell's own settings read (US-D10's pane layout, restored on mount) is
    // also a hub call, and "the palette stayed quiet" is the claim this test makes.
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes("/search"))).toHaveLength(
      0,
    );
    expect(screen.getByText("Go to Inbox")).toBeInTheDocument();
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

describe("App shell detail card (US-D10 §c.5: the pane is the list's own card)", () => {
  /** A rule at the top level of app.css — the base file rather than a tier. Not `ruleBody`, which
   *  reads the indented form of a rule declared inside an at-rule. */
  function baseRule(selector: string): string {
    const css = readFileSync(join(TEST_DIR, "../src/app.css"), "utf8");
    const start = css.indexOf(`\n${selector} {`);
    expect(start, `${selector} is not in app.css`).toBeGreaterThan(-1);
    return css.slice(start, css.indexOf("}", start));
  }

  function listCard(): string {
    return baseRule(".inbox-card");
  }

  function widePane(): string {
    return ruleBody(atRuleBody("@container shell (min-width: 1280px) {"), ".app-shell__detail");
  }

  // §c.5's card, stated as the half a test can hold: the pane is not a lookalike of the list card, it
  // is the same three declarations. They are read from `.inbox-card` itself, so the two cannot drift
  // apart silently — change the list card's radius and this fails until the pane follows it.
  it("gives the pane the same fill, radius and elevation as the list", () => {
    const list = listCard();
    const pane = widePane();

    for (const decl of [
      "background: var(--bg-base);",
      "border-radius: 20px;",
      "box-shadow: var(--shadow-row-selected);",
    ]) {
      expect(list, `.inbox-card does not carry ${decl}`).toContain(decl);
      expect(pane, `the pane does not carry ${decl}`).toContain(decl);
    }
    // ...and no hairline on either: the elevation is the edge.
    expect(pane).toContain("border: none;");
    expect(list).not.toContain("border:");
  });

  // The pane with no column: a thread the user asks for while collapsed arrives as the same card,
  // floating. `100% - 32px` is the window's own clamp — the sheet's geometry with the card's
  // material, and deliberately not the <=1279.98 glass recipe: §c.5 puts a glass toolbar inside this
  // pane, and a glass surface in a glass surface is the ACCENT §4.4 nesting US-D09 removed.
  it("floats the collapsed pane as the same opaque card, over the list", () => {
    const overlay = ruleBody(
      atRuleBody("@container shell (min-width: 1280px) {"),
      ".app-shell--detail-sheet .app-shell__detail",
    );

    expect(overlay).toContain("position: fixed;");
    expect(overlay).toContain("width: min(var(--detail-width, 420px), calc(100% - 32px));");
    expect(overlay).toMatch(/z-index: 20;/);
    // The material comes from the tier's own pane rule, which is opaque — so the overlay must not
    // restate a blur here, and this test is what stops the sheet's recipe being copied up.
    expect(overlay).not.toContain("backdrop-filter");
    expect(widePane()).toContain("backdrop-filter: none;");
  });

  // Once the pane is gone the list card runs the whole way across, so the corner the chevron wants is
  // the ask pill's own right end. The pill is `position: relative; z-index: 6` (it has to stand above
  // its own model menu), and a chevron under it is not merely hidden by the glass — the press lands on
  // the input, which is how a collapsed pane was unopenable by pointer at 1440. Comparing the two
  // numbers rather than pinning one keeps this a statement about the relationship: either can move,
  // as long as the chevron stays on top.
  it("keeps the collapsed pane's chevron above the ask pill sharing its corner", () => {
    const zIndex = (body: string) => Number(/z-index:\s*(-?\d+)/.exec(body)?.[1]);
    expect(zIndex(baseRule(".detail-pane__toggle--floating"))).toBeGreaterThan(
      zIndex(baseRule(".ask-bar__pill")),
    );
  });

  // `app-shell--detail-dragging` is on the shell for two declarations, and the second is the one a
  // reviewer caught missing: the grip's own `user-select: none` does not stop a selection the pointer
  // starts inside it and then extends out across the pane (which is every drag to the left), and the
  // class also has to switch the pane's settle *off* while a gesture is running (asserted below).
  it("turns off text selection for the length of a drag", () => {
    expect(baseRule(".app-shell--detail-dragging")).toContain("user-select: none;");
  });

  // §c.1's gesture is two halves, and the release is the half that lives in CSS. `draggedDetailWidth`
  // draws the band — 816px where the ceiling is 720 — and `onWidthCommit` then hands the shell the
  // clamped 720. Both numbers were already right; what was missing was anything making the pane
  // *travel* between them, so the band was computed and then thrown away in a single frame. The same
  // declaration covers the double-click reset and each arrow-key step, which is why it belongs on the
  // pane's own rule rather than on a gesture class.
  it("settles the width on release, and does not settle it mid-drag", () => {
    // --ease-settle is tokens.css's "a drag's drop" curve and --dur-move the movement rung (80ms
    // under prefers-reduced-motion, so the settle shortens with everything else rather than needing
    // a branch of its own).
    expect(baseRule(".app-shell__detail")).toContain(
      "transition: width var(--dur-move) var(--ease-settle);",
    );
    // The pill is positioned off the same width (`right: calc(16px + var(--detail-width, …))`), so
    // without this it snaps to the settled edge while the pane is still moving — a handle visibly
    // 96px off the divider it belongs to, for the length of the settle.
    expect(baseRule(".detail-pane__grip")).toContain(
      "transition: right var(--dur-move) var(--ease-settle);",
    );

    // ...and one flag switches both off. This is the declaration that keeps the drag one-to-one with
    // the pointer: transitioned, the pane would ease toward each frame of the gesture instead of
    // being drawn by it, and the divider would lag the cursor by --dur-move for the whole drag.
    const css = readFileSync(join(TEST_DIR, "../src/app.css"), "utf8");
    const start = css.indexOf("\n.app-shell--detail-dragging .app-shell__detail,");
    expect(start, "the drag does not switch the settle off").toBeGreaterThan(-1);
    const midDrag = css.slice(start, css.indexOf("}", start));
    expect(midDrag).toContain(".detail-pane__grip {");
    expect(midDrag).toContain("transition: none;");
  });
});

/** US-D10: the pane's layout is a setting, so the shell reads it once on mount and writes it back on
 *  every change. Both halves are visible without an approval in the queue: the width lands on the
 *  shell's own inline style (`--detail-width`, which every shape the pane takes reads from there) and
 *  the collapsed flag lands in the DOM as the one chevron that brings the pane back. The drag itself
 *  is packages/ui's — test/detail-pane.test.tsx drives it — and what this file owns is the shell's
 *  half: restore it, clamp it, and remember it. */
describe("App shell detail pane (US-D10: width and collapse are settings)", () => {
  const REAL_MATCH_MEDIA = window.matchMedia;
  afterEach(() => {
    vi.unstubAllGlobals();
    window.matchMedia = REAL_MATCH_MEDIA;
  });

  interface HubCall {
    url: string;
    init?: RequestInit;
  }

  /** The hub's settings routes — GET answers with `settings`, PUT with 200. Every call is recorded,
   *  because half of what these tests assert is what the shell did *not* write. The response is as
   *  much of one as src/api/settings.ts reads (`ok` and `json`), so the test does not depend on a
   *  global `Response` that jsdom does not implement. */
  function stubHub(settings: Record<string, unknown> = {}): HubCall[] {
    const calls: HubCall[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit): Promise<Response> => {
      calls.push({ url, init });
      const body = init?.method === "PUT" ? {} : { settings };
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    });
    return calls;
  }

  const writes = (calls: HubCall[]) => calls.filter((call) => call.init?.method === "PUT");
  const writtenValue = (call: HubCall | undefined) =>
    (JSON.parse(String(call?.init?.body)) as { value: unknown }).value;

  /** jsdom's window is 1024 wide, so the ceiling every clamp here is measured against is 512 — half
   *  the shell (`maxDetailWidth`). */
  const MAX = 512;

  /** The pane's width as the shell draws it. One property for the column, the sheet and the
   *  collapsed overlay, so this is the width in whichever shape the pane currently has. */
  function paneWidth(): string {
    return screen.getByTestId("app-shell").style.getPropertyValue("--detail-width");
  }

  it("draws the shipping width when nothing has been stored", async () => {
    const calls = stubHub();
    render(<App />);
    expect(paneWidth()).toBe(`${DETAIL_DEFAULT_WIDTH}px`);

    // ...and the answered read does not move it: `null` means "never dragged", which is the default.
    await waitFor(() => expect(writes(calls)).toHaveLength(0));
    expect(paneWidth()).toBe(`${DETAIL_DEFAULT_WIDTH}px`);
  });

  it("restores the stored width, clamped to the window it is drawn in", async () => {
    stubHub({ [DETAIL_WIDTH_KEY]: 500 });
    const fromStore = render(<App />);
    await waitFor(() => expect(paneWidth()).toBe("500px"));
    fromStore.unmount();

    // A number chosen on a wider screen is not rewritten by a narrower one — it is drawn at the
    // narrower screen's ceiling. 5000 is past half of jsdom's 1024, 240 is under the floor.
    stubHub({ [DETAIL_WIDTH_KEY]: 5000 });
    const wide = render(<App />);
    await waitFor(() => expect(paneWidth()).toBe(`${MAX}px`));
    wide.unmount();

    stubHub({ [DETAIL_WIDTH_KEY]: 240 });
    render(<App />);
    await waitFor(() => expect(paneWidth()).toBe(`${DETAIL_MIN_WIDTH}px`));
  });

  it("restores the collapsed pane, and the same press puts it back", async () => {
    const calls = stubHub({ [DETAIL_COLLAPSED_KEY]: true });
    render(<App />);

    // With the pane collapsed and nothing to show in it, the way back is the one chevron drawn on
    // the canvas — and that chevron is also how the restore is visible here. Collapsed means the
    // pane is not in the document at all, which is the whole of "the list takes the width".
    const toggle = await screen.findByRole("button", { name: "Expand details" });
    expect(screen.queryByTestId("detail-pane")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.queryByRole("button", { name: "Expand details" })).not.toBeInTheDocument();
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]?.url).toContain(DETAIL_COLLAPSED_KEY);
    expect(writtenValue(writes(calls)[0])).toBe(false);
  });

  it("collapses on Cmd+\\ and remembers it", async () => {
    const calls = stubHub();
    render(<App />);
    // Nothing is open, so neither chevron is drawn: there is nothing to collapse yet.
    expect(screen.queryByRole("button", { name: "Collapse details" })).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "\\", code: "Backslash", metaKey: true });
    // eslint-disable-next-line no-console
    expect(await screen.findByRole("button", { name: "Expand details" })).toBeInTheDocument();
    expect(screen.queryByTestId("detail-pane")).not.toBeInTheDocument();
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writtenValue(writes(calls)[0])).toBe(true);
  });

  // Below 900 the pane is a full-width sheet with no column and no toggle, and app.css hides both.
  // The shortcut is switched off with them rather than left writing a flag nothing on this tier can
  // show: a key that silently rewrites a setting the user cannot see is worse than a key that does
  // nothing. Nothing is asserted about the DOM because there is nothing there to assert — the flag
  // never flips, which is exactly what "no write" says.
  it("ignores the shortcut below 900, where the pane cannot be collapsed", async () => {
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          media: query,
          matches: true,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
    const calls = stubHub();
    render(<App />);

    fireEvent.keyDown(window, { key: "\\", code: "Backslash", metaKey: true });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Filters" })).toBeInTheDocument(),
    );
    expect(writes(calls)).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Expand details" })).not.toBeInTheDocument();
  });
});
