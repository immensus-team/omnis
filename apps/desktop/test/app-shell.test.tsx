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
  FLOATING_PANE_QUERY,
  NARROW_SHELL_QUERY,
  TOAST_MS,
  Toaster,
} from "@omnis/ui";
import { act, fireEvent, render as mount, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** This test file's own directory. vitest's transform can leave import.meta.url on a scheme other
 *  than file: (fileURLToPath then throws "The URL must be of scheme file"), so only the pathname is
 *  taken — it does not depend on cwd, so it is the same under the root `pnpm test` and under
 *  `--filter @omnis/desktop`. */
const TEST_DIR = dirname(new URL(import.meta.url).pathname);

/** The shell, with the app's toast host beside it. main.tsx mounts `<Toaster/>` next to `<App/>` (a
 *  toast outlives the screen that raised it), and sonner portals what it draws to `document.body` —
 *  so a test that mounted `<App/>` alone would have every `notify` reach no DOM at all, and the
 *  decision-toast block below would be asserting against nothing. Wrapping the import here rather
 *  than the file's thirty call sites keeps each test reading as the shell it is about; what the
 *  block's own timings rest on (TOAST_MS, one slot, the deferred work) is the app's real host. */
function render(ui: ReactElement) {
  return mount(
    <>
      {ui}
      <Toaster />
    </>,
  );
}

// This test only asks whether the screens are actually mounted in the shell. The Zero round trip
// is tools/e2e's job (Playwright).
//
// loop-r1-02: the queue is the one relation a test can put rows into. Every other query answers an
// empty list — which is what the tests above expect and what keeps them unchanged — while
// `pending_approvals` answers `approvals.rows`. `queue` is a second Proxy with its own identity so
// the `useQuery` mock below can recognise it: the chain's `get` and `apply` both return it, so
// `zero.query.pending_approvals.where("state", "=", "pending")` hands the *same object* to useQuery
// and nothing derived from it can be mistaken for it.
const approvals: { rows: unknown[] } = { rows: [] };
const queue: unknown = new Proxy(() => queue, {
  get: () => queue,
  apply: () => queue,
});
// loop-r1-08: `persons` is the second relation a test can put rows into, so that a person hit can
// be followed to a PersonDetail that names someone rather than to its empty state. It answers `[]`
// until a case fills it, which is what keeps every test above unchanged.
const persons: { rows: unknown[] } = { rows: [] };
const personQuery: unknown = new Proxy(() => personQuery, {
  get: () => personQuery,
  apply: () => personQuery,
});
// loop-r2-06: `tasks` (the checkbox's row) and `threads` (the name the queue's rows and Today's
// cards give an approval's conversation) are the two relations the new behaviours read. Same
// pattern as `persons`: they answer [] until a case fills them, which is what keeps every test
// above unchanged. `threads` answers every threads query with the same rows — the shell reads it
// once for the queue's titles and once for the open thread, and no case below has a thread open.
const tasks: { rows: unknown[] } = { rows: [] };
const tasksQuery: unknown = new Proxy(() => tasksQuery, {
  get: () => tasksQuery,
  apply: () => tasksQuery,
});
const threads: { rows: unknown[] } = { rows: [] };
const threadsQuery: unknown = new Proxy(() => threadsQuery, {
  get: () => threadsQuery,
  apply: () => threadsQuery,
});
const chain: unknown = new Proxy(() => chain, {
  get: (_target, prop) =>
    prop === "pending_approvals"
      ? queue
      : prop === "persons"
        ? personQuery
        : prop === "tasks"
          ? tasksQuery
          : prop === "threads"
            ? threadsQuery
            : chain,
  apply: () => chain,
});
vi.mock("../src/zero-client.js", () => ({
  initZero: () => chain,
  useZeroClient: () => chain,
  loadZeroToken: async () => {},
  // loop-r2-05: the shell now asks whether a token was ever issued, so the mock has to answer —
  // without this every App test would draw the "Can't reach omnis" banner.
  hasZeroToken: () => true,
}));
vi.mock("@rocicorp/zero/react", () => ({
  useQuery: (q: unknown) => [
    q === queue
      ? approvals.rows
      : q === personQuery
        ? persons.rows
        : q === tasksQuery
          ? tasks.rows
          : q === threadsQuery
            ? threads.rows
            : [],
    { type: "complete" },
  ],
  useZero: () => chain,
  useConnectionState: () => ({ name: "connected" }),
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
  // `persons` is module-level state shared by every test in this file, so the row a case fills in
  // goes back to empty with its fetch stub.
  afterEach(() => {
    vi.unstubAllGlobals();
    persons.rows = [];
  });

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

  // loop-r1-08 (L-16) replaces the either/or this case used to assert. The old rule was "a query
  // that matches an action is answered from the action list, so the hub is not asked", and it is
  // exactly what made typing "go to" a dead end: the command list never narrowed and no search
  // ever ran. Now the words are both — the matching commands on top of the hub's hits — so the row
  // appearing is no longer a reason to stay quiet, and `>` becomes the way to say "commands only".
  it("lists the matching command, asks the hub too, and stays quiet for a `>` query", async () => {
    const fetchMock = vi.fn(async () => searchAnswer());
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    const input = () => screen.getByPlaceholderText("Start typing to ask or search");

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    fireEvent.change(input(), { target: { value: "inbox" } });

    expect(screen.getByText("Go to Inbox")).toBeInTheDocument();
    // Scoped to /search: the shell's own settings read (US-D10's pane layout, restored on mount) is
    // also a hub call, and the palette's round trip is the one this test is about.
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter((call) => String(call[0]).includes("/search")),
      ).toHaveLength(1),
    );

    // The same words behind a `>` are command grammar, not a search — so the count above stays 1.
    fireEvent.change(input(), { target: { value: ">inbox" } });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes("/search"))).toHaveLength(
      1,
    );
    expect(screen.getByText("Go to Inbox")).toBeInTheDocument();
  });

  it("opens the person detail when a person hit is selected (loop-r1-08 L-15, NC-12)", async () => {
    const personId = "3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            q: "dana",
            took_ms: 2,
            truncated: false,
            groups: [
              {
                kind: "people",
                total: 1,
                results: [
                  {
                    kind: "person",
                    id: personId,
                    score: 1,
                    title: "Dana Whitfield",
                    snippet: "Northwind",
                    at: null,
                    channel: null,
                    // The shape the hub has been sending all along: `openHit` used to follow only
                    // `screen === "thread"`, so this row was drawn and then refused.
                    deep_link: { screen: "person", person_id: personId },
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    persons.rows = [{ id: personId, display_name: "Dana Whitfield", item_count: 4 }];
    render(<App />);

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    fireEvent.change(screen.getByPlaceholderText("Start typing to ask or search"), {
      target: { value: "dana" },
    });
    await waitFor(() => expect(screen.getByText("Dana Whitfield")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Dana Whitfield"));

    // The pane swaps to PersonDetail, the same surface the Network screen opens — not the approval
    // stack it fell back to while the person branch was missing.
    expect(await screen.findByRole("heading", { name: "Dana Whitfield" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Conversations" })).toBeInTheDocument();
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

  it("reserves the bars' band in the list, where the bars actually overlap it", () => {
    const css = narrowTier();
    expect(ruleBody(css, ".app-shell__main")).toContain(`padding-bottom: ${TWO_BARS};`);
    // S5: the pane and the AI panel are modal drawers below 900 — full viewport, `bottom: 0`, with a
    // scrim over everything else — so neither reserves the band any more. They are the two rules
    // this test used to read; the drawers sit *on* the bars rather than between them.
    expect(baseRule("[data-vaul-drawer].app-shell__detail")).toContain("bottom: 0;");
    expect(baseRule("[data-vaul-drawer].ask-panel")).toContain("bottom: 0;");
  });

  // §c.9's pieces: a 44px circle and a pill of --bar-h. The pill's height is the one that has to be
  // said here — it is 44px at the top of the list (`.ask-bar__pill`) and the bar's own rule is what
  // raises it. loop-r2-03 removed the third piece (the 52px compose circle), so the two that remain
  // are asserted and nothing else is.
  it("sizes the pieces as the brief does: a 44px circle and a pill of --bar-h", () => {
    const css = narrowTier();
    expect(ruleBody(css, ".bottom-bar .ask-bar__pill")).toContain("height: var(--bar-h);");
    expect(ruleBody(css, ".bottom-bar__piece")).toMatch(/width: 44px;/);
  });

  // The panel used to open upward inside the shell, pinned to the bar's own gutters (a panel clipped
  // to the ~246px pill would have been a column of ellipses). S5 made it the AI drawer, so the
  // gutters are gone: it is the window's width, like the filters sheet, and the constraint that
  // keeps it from widening the page is now `inset-inline: 0` rather than two insets.
  it("opens the panel as the window's width, not the bar's gutters", () => {
    const panel = baseRule("[data-vaul-drawer].ask-panel");
    expect(panel).toContain("inset-inline: 0;");
    expect(panel).toContain("width: auto;");
    expect(panel).not.toMatch(/--bar-gap/);
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
    // the filters circle and the ask pill. NC2-03: no compose circle — a new message needs a
    // recipient picker that does not exist, so the circle is not rendered rather than shown disabled,
    // and the pill takes the width it used to share.
    expect(document.querySelector(".channel-rail")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Filters" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Compose" })).toBeNull();
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

/** A rule at the top level of app.css — the base file rather than a tier. Not `ruleBody`, which
 *  reads the indented form of a rule declared inside an at-rule. The drawer rules are top-level even
 *  though they only ever match one tier: `[data-vaul-drawer].app-shell__detail` *is* the media query
 *  (a portal is outside `#root`, so no container query reaches it). */
function baseRule(selector: string): string {
  const css = readFileSync(join(TEST_DIR, "../src/app.css"), "utf8");
  const start = css.indexOf(`\n${selector} {`);
  expect(start, `${selector} is not in app.css`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
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

  // S5 replaced §c.5's third bar shape. Until then the narrow tier pinned a *floating* capsule at
  // `bottom: var(--bar-gap)`, in the BottomBar's own row between its two circles; the pane is a modal
  // `vaul` drawer now, and a modal drawer owns the pointer for everything outside itself — a bar
  // portaled into the BottomBar's line would have sat visible under the scrim and untouchable. It is
  // the drawer's chrome row instead, which is the shape the 900–1279.98 tier already uses, for the
  // same reason: the drawer's own field is the material the buttons stand on.
  it("makes the bar a static row of the drawer, not a capsule in the bar's row", () => {
    const body = baseRule("[data-vaul-drawer].app-shell__detail .thread-toolbar--pane");

    expect(body).toContain("position: static;");
    expect(body).toContain("align-self: flex-end;");
    // The chrome row casts nothing (there is no capsule to cast a shadow), so the band the sticky
    // tier reserves for `--shadow-glass` would only be a hole here.
    expect(body).toContain("margin-bottom: 0;");
    // `position: static` is the load-bearing one: the `>=900` block's sticky rule has the same
    // specificity, so a bar that lost this line would go back to hovering over the conversation with
    // no field behind it — the sender's date travelling through the glyphs.
    expect(body).not.toMatch(/position: (fixed|sticky|absolute);/);
  });

  // §c.5/M103: 36px in the capsule at the desk, 44px on a touch screen — the BottomBar's own circle
  // size. Both rules are top-level: the first because it applies everywhere, the second because its
  // selector is its media query.
  it("sizes the buttons for the pointer: 36px at the desk, 44px in the drawer", () => {
    const wide = baseRule(".thread-toolbar__button");
    expect(wide).toMatch(/width: 36px;/);
    expect(wide).toMatch(/height: 36px;/);

    const narrow = baseRule("[data-vaul-drawer].app-shell__detail .thread-toolbar__button");
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

  // loop-r2-03/NC2-03: the compose circle is not rendered and its rules are gone with it. They were
  // the 52px box and the `margin-left: auto` that made it the bar's trailing piece; leaving them in
  // app.css would be a rule for a control that no longer exists, which is the dead-code half of the
  // same defect the reviewers named (a disabled glyph under a tooltip explaining a phase). The pill
  // is the bar's only grown piece now, which the rule above it already states.
  it("leaves no compose circle in the bar or in app.css", () => {
    expect(narrowTier()).not.toContain(".bottom-bar__piece--compose");
  });

  // S5's two new drawers, stated as the box `vaul` needs rather than as a look. The full height is
  // the declaration that makes them drawers at all: `vaul` offsets a snap point by
  // `viewport - snap * viewport`, so a box shorter than the viewport shows a fraction of the wrong
  // height. Each is also the pane's/card's own geometry replaced — the pane is a 420px column with a
  // 16px grip gutter, and a drawer is the window's width, flush to the bottom edge.
  it("gives the thread drawer the sheet's box: full viewport, flush to the bottom", () => {
    const body = baseRule("[data-vaul-drawer].app-shell__detail");
    expect(body).toContain("height: 100dvh;");
    expect(body).toContain("bottom: 0;");
    expect(body).toContain("width: auto;");
    expect(body).toContain("margin-left: 0;");
    expect(body).toContain("max-height: none;");
    // The material is the `<=1279.98` sheet's recipe written out again, because that block is a
    // container query and a portal is outside `#root`. It is the pane's glass at its third shape.
    expect(body).toContain("background: var(--bg-overlay);");
    expect(body).toContain("backdrop-filter: blur(24px) saturate(1.4);");
    // Topmost while it is up, over the BottomBar's 30 and the filters sheet's own 40 — the drawer
    // content has to clear the scrim it is portaled beside.
    expect(body).toMatch(/z-index: 40;/);
    // `vaul` moves the box through a transform and animates it; a second animation on the same
    // property (the pane's fold, the floating sheet's slide) would fight the gesture.
    expect(body).toContain("animation: none;");
  });

  it("gives the AI panel drawer the same box, filled by its own glass", () => {
    const body = baseRule("[data-vaul-drawer].ask-panel");
    expect(body).toContain("height: 100dvh;");
    expect(body).toContain("bottom: 0;");
    expect(body).toMatch(/z-index: 40;/);
    // The card's cap is the opposite decision — a floating panel must not outgrow the screen — and
    // with the drawer a full viewport tall it would leave a band of bare aurora under the glass.
    expect(body).not.toContain("min(60vh, 420px)");
    expect(baseRule("[data-vaul-drawer].ask-panel .ask-panel__glass")).toContain(
      "max-height: none;",
    );
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

/* loop-r2-03/NC2-03: the reply composer's box. What the story asks for here is a claim about
   *selectors* — the composer takes the approval card's radius, padding, margin, field style, action
   row and buttons by being added to the rules that already declare them — so these read the shared
   selector rather than the numbers under it. A copy would satisfy a numeric check and drift from the
   card it is standing in for, which is the whole failure mode (the box becomes the card the moment
   the proposal lands, and a jump in radius or padding at that moment is the thing being avoided). */
describe("App shell reply composer (loop-r2-03: `r` opens a box that proposes a send)", () => {
  const css = (): string => readFileSync(join(TEST_DIR, "../src/app.css"), "utf8");

  it("is the card's box, by sharing its rules rather than restating them", () => {
    // The box, the field, its placeholder and its focus ring: four rules, each naming both.
    expect(css()).toMatch(/\.approval-card,\n\.reply-composer \{/);
    expect(css()).toMatch(
      /\.approval-card__editor,\n\.approval-card__respond,\n\.reply-composer__editor \{/,
    );
    expect(css()).toMatch(
      /\.approval-card__editor::placeholder,\n\.approval-card__respond::placeholder,\n\.reply-composer__editor::placeholder \{/,
    );
    expect(css()).toMatch(
      /\.approval-card__editor:focus-visible,\n\.approval-card__respond:focus-visible,\n\.reply-composer__editor:focus-visible \{/,
    );
    // And the margin that keeps it off the message above it — asserted against the neighbour that
    // makes the group unambiguous, because `.reply-composer,` on its own is in three groups.
    expect(css()).toMatch(/\n\.reply-composer,\n\.digest-card,/);
  });

  // 3 rows to start, 12 at most. `rows` is what the component passes and Chromium ignores it once
  // `field-sizing` applies, so the heights are the row arithmetic and not an attribute.
  it("sizes the field from its row count", () => {
    // Not `baseRule`: `.reply-composer__editor {` is the *last line of the three-way field selector*
    // before it is a rule of its own, and that grouped rule comes first in the file. The standalone
    // one is found from the end, the way the chrome-row tier is.
    const text = css();
    const start = text.lastIndexOf("\n.reply-composer__editor {");
    expect(start, "the composer's own editor rule is not in app.css").toBeGreaterThan(-1);
    const body = text.slice(start, text.indexOf("\n}", start));
    expect(body).toContain("field-sizing: content;");
    expect(body).toContain("min-height: calc(3 * 1.45 * 15px + 18px);");
    expect(body).toContain("max-height: calc(12 * 1.45 * 15px + 18px);");
    expect(body).toContain("overflow-y: auto;");
  });

  // A phone has no ⌘ key. The hint is text, not a control, so hiding it leaves nothing unlabelled —
  // the primary button beside it is the whole affordance there.
  it("hides the send chord from a thumb", () => {
    const body = atRuleBody("@media (pointer: coarse) {");
    expect(body).toMatch(/\.reply-composer__hint \{\n\s*display: none;/);
  });
});

describe("App shell detail card (US-D10 §c.5: the pane is the list's own card)", () => {
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

/** loop-r1-02: the pending-approval queue and the pane's three ways out.
 *
 *  The story is that the pane stops opening itself below 1280 (L-04, L-17, NC-03) and that every
 *  tier it *is* open in has a way back to the list (NC-37, NC-09). Both halves are shell state, so
 *  both are testable here without a browser: the auto-open rule is one boolean expression in App.tsx
 *  and the close is one callback three controls share.
 *
 *  What this file cannot reach is the geometry — that the 390 list is actually uncovered, and that
 *  the approval card's buttons stop at its right edge. Those are app.css and a real layout, and they
 *  belong to tools/e2e/shots-loop-r1-02.ts. */
describe("App shell approval queue (loop-r1-02: the list comes first)", () => {
  const REAL_MATCH_MEDIA = window.matchMedia;
  beforeEach(() => {
    approvals.rows = [];
  });
  afterEach(() => {
    window.matchMedia = REAL_MATCH_MEDIA;
  });

  /** The tier the shell is drawn in, answered per query. A stub that says `matches: true` to
   *  everything is not the same thing: the shell asks matchMedia three separate questions —
   *  narrow, floating, and (lib/motion.ts) reduced motion — and a yes to the third shortens the
   *  pane's leave from --dur-move to the 80ms fade, which would make the closes below pass for the
   *  wrong reason. */
  function stubTiers({ narrow, floating }: { narrow: boolean; floating: boolean }): void {
    window.matchMedia = ((query: string) => ({
      media: query,
      matches:
        query === NARROW_SHELL_QUERY ? narrow : query === FLOATING_PANE_QUERY ? floating : false,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
  }

  /** One row of the queue, in the shape ApprovalStackItem asks for — the same fields
   *  pending_approvals carries through Zero. */
  const approval = (id: string) => ({
    id,
    thread_id: `thread-${id}`,
    risk: "normal",
    created_at: 1,
    action: "send",
    description: `Approval ${id}`,
    config: { allow_accept: true, allow_edit: true, allow_respond: true, allow_ignore: true },
  });

  const pane = () => screen.queryByTestId("detail-pane");

  it("draws no pane at all below 1280, and the queue when it is asked for", () => {
    approvals.rows = [approval("a1"), approval("a2")];
    stubTiers({ narrow: false, floating: true });
    render(<App />);

    // The finding itself. Two approvals are waiting and the pane is nowhere: at 900–1279 that is
    // the ~40% of the list the sheet used to float over (L-17), and at 390 the full-height overlay
    // that made the inbox unreachable until every approval had been decided (L-04, NC-03).
    expect(pane()).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Pending approvals" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "2 need approval" }));
    expect(pane()).toBeInTheDocument();
    // With nothing open the queue *is* the pane, so the stack is what it draws.
    expect(screen.getByRole("region", { name: "Pending approvals" })).toBeInTheDocument();
  });

  it("takes the queue away again on Escape", async () => {
    approvals.rows = [approval("a1"), approval("a2")];
    stubTiers({ narrow: false, floating: true });
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "2 need approval" }));
    expect(pane()).toBeInTheDocument();

    // Escape closes, and below 1280 it closes for good: there is no auto-open rule to put the queue
    // back, which is the tier where the list has to win.
    fireEvent.keyDown(window, { key: "Escape" });
    // The pane is held in the DOM for --dur-move while it leaves (useClosingSpring) — a stylesheet
    // cannot animate a node React has already unmounted.
    await waitFor(() => expect(pane()).not.toBeInTheDocument());
  });

  it("does not open itself on the narrow tier either, and its back row is the way out", async () => {
    approvals.rows = [approval("a1"), approval("a2")];
    stubTiers({ narrow: true, floating: true });
    render(<App />);

    expect(pane()).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "2 need approval" }));
    expect(pane()).toBeInTheDocument();

    // NC-37: at 390 the pane is a full-width sheet and `.detail-pane__chrome` is `display: none`
    // there, so this row is the tier's only way back. jsdom applies no stylesheet, which is why the
    // control is reachable in both tiers here and its *visibility* is the Playwright check's job.
    fireEvent.click(screen.getByRole("button", { name: "Back to Inbox" }));
    await waitFor(() => expect(pane()).not.toBeInTheDocument());
  });

  it("says it in the singular for one, and draws nothing at zero", () => {
    stubTiers({ narrow: false, floating: true });

    approvals.rows = [approval("a1")];
    const { unmount } = render(<App />);
    const button = screen.getByRole("button", { name: "1 needs approval" });
    // A child of the subline and not a row beside it. That is the half of L-32 this file can hold:
    // an inline child of the same 13px line adds no height to the header, while a sibling block
    // under it would — and the header growing and shrinking as the last approval is decided is the
    // jump the finding is about. The rest is geometry, and belongs to the browser check.
    expect(button.parentElement?.className).toBe("inbox-card__subline");
    unmount();

    approvals.rows = [];
    render(<App />);
    expect(screen.queryByRole("button", { name: /needs? approval/ })).toBeNull();
  });

  // The regression guard: >=1280 the pane is a column and opening for the queue on arrival is the
  // behaviour the story deliberately leaves alone.
  it("still opens itself in the column tier", () => {
    approvals.rows = [approval("a1"), approval("a2")];
    render(<App />);
    expect(pane()).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Pending approvals" })).toBeInTheDocument();
  });

  // ...and the same tier is where the subline button earns its second job: a pane the user has
  // collapsed does not re-open for the queue on its own, so this is the way back to it.
  it("re-opens a collapsed pane for the queue at >=1280", async () => {
    approvals.rows = [approval("a1")];
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse details" }));
    await waitFor(() => expect(pane()).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "1 needs approval" }));
    expect(pane()).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Pending approvals" })).toBeInTheDocument();
  });

  /** loop-r1-06: what a decision says back, and — the half that is timing rather than copy — what
   *  it holds back. The ignore is the one decision with a delay to spend: nothing downstream has
   *  happened when the card leaves, so the hub is not told until the toast offering the undo has
   *  gone. Everything else here is about that gap closing in the right order. */
  describe("decision toasts (loop-r1-06)", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    interface HubCall {
      url: string;
      init?: RequestInit;
    }

    /** The hub as the decisions see it: every write recorded, and the answer switchable so the
     *  failure path can be walked. The response is as much of one as src/api/approvals.ts reads. */
    function stubDecide(ok = true): HubCall[] {
      const calls: HubCall[] = [];
      vi.stubGlobal("fetch", async (url: string, init?: RequestInit): Promise<Response> => {
        calls.push({ url, init });
        return { ok, status: ok ? 200 : 500, json: async () => ({}) } as unknown as Response;
      });
      return calls;
    }

    const decideCalls = (calls: HubCall[]): HubCall[] =>
      calls.filter((call) => call.url.includes("/decide"));
    /** Which decision each write carried, in the order the hub saw them. */
    const decisions = (calls: HubCall[]): string[] =>
      decideCalls(calls).map(
        (call) => (JSON.parse(String(call.init?.body)) as { decision: string }).decision,
      );

    /** The toast on screen. Not a role query: sonner renders no `role="status"` — its list is the
     *  live region and the toast inside it carries no role at all — so the class chain app.css styles
     *  the tokens against is the handle. The zero-length advance is sonner's own batching, not a
     *  timing of ours: it publishes through its store on a zero-delay timer to get React out of the
     *  click's batch, so under this block's fake timers the element is one tick behind the call that
     *  raised it. No length of dwell is being eaten by it — that starts when the toast mounts. */
    const toast = (): HTMLElement => {
      act(() => vi.advanceTimersByTime(0));
      const el = document.querySelector<HTMLElement>("[data-sonner-toast]");
      if (el === null) throw new Error("no toast on screen");
      return el;
    };

    /** The queue, opened the way the list opens it. */
    const openQueue = (count = 1): void => {
      fireEvent.click(
        screen.getByRole("button", {
          name: `${count} ${count === 1 ? "needs" : "need"} approval`,
        }),
      );
    };

    /** Approve through the confirmation — the card's own Approve asks first, and the question's
     *  button is the one that decides. */
    const approveThroughConfirm = (): void => {
      fireEvent.click(screen.getByRole("button", { name: "Approve" }));
      fireEvent.click(
        within(screen.getByRole("alertdialog")).getByRole("button", { name: "Approve" }),
      );
    };

    it("holds the ignore back until its toast goes, and an Undo means it never goes", async () => {
      const calls = stubDecide();
      approvals.rows = [approval("a1")];
      render(<App />);
      openQueue();

      fireEvent.click(screen.getByRole("button", { name: "Ignore" }));

      // The card is gone on the click — the pane is the queue, and the queue says it went — while
      // the hub has not been told. That gap is what the undo stands on: the decision is real to the
      // user and not yet real to the server.
      expect(screen.queryByText("Approval a1")).toBeNull();
      expect(toast()).toHaveTextContent("Ignored: Approval a1");
      expect(decideCalls(calls)).toHaveLength(0);

      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
      expect(screen.getByText("Approval a1")).toBeInTheDocument();

      // Past the toast's whole life, with the undo taken: nothing is ever sent. Without the
      // cancellation this is the line where the deferred ignore fires anyway.
      await act(async () => {
        vi.advanceTimersByTime(TOAST_MS);
      });
      expect(decideCalls(calls)).toHaveLength(0);
    });

    it("sends the ignore when the toast runs out — once, and as an ignore", async () => {
      const calls = stubDecide();
      approvals.rows = [approval("a1")];
      render(<App />);
      openQueue();
      fireEvent.click(screen.getByRole("button", { name: "Ignore" }));
      expect(decideCalls(calls)).toHaveLength(0);

      await act(async () => {
        vi.advanceTimersByTime(TOAST_MS);
      });

      expect(decisions(calls)).toEqual(["ignore"]);
      expect(decideCalls(calls)[0]?.url).toContain("/approvals/a1/decide");
      // The card stays gone: this is a decision that was taken out of the queue, not one that
      // failed.
      expect(screen.queryByText("Approval a1")).toBeNull();
    });

    it("sends it when another toast takes the slot instead", async () => {
      const calls = stubDecide();
      approvals.rows = [approval("a1"), approval("a2")];
      render(<App />);
      openQueue(2);
      fireEvent.click(screen.getAllByRole("button", { name: "Ignore" })[0] as HTMLElement);
      expect(decideCalls(calls)).toHaveLength(0);

      // One slot, no queue: the second decision's toast replaces the first, and with the undo off
      // the screen the ignored approval goes out rather than waiting for a button nobody can press.
      // loop-r2-01: this used to take the second decision from a click on "Edit". Edit opens the
      // message now and decides nothing by itself, so the second decision is an Approve — taken
      // through its own confirmation, which is the shortest path from the card to a decision that
      // leaves the machine. The subject of the check (the slot flush) is unchanged.
      approveThroughConfirm();
      await act(async () => {});

      expect(decisions(calls)).toEqual(["accept", "ignore"]);
    });

    it("says an approval did not go through, and puts the card back", async () => {
      const calls = stubDecide(false);
      approvals.rows = [approval("a1")];
      render(<App />);
      openQueue();
      approveThroughConfirm();
      await act(async () => {});

      expect(toast()).toHaveTextContent("Approval didn't go through.");
      expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
      // The rollback, and the reason the toast is not a lie: the card is back in the queue, which
      // is where the Retry will send it from.
      expect(screen.getByText("Approval a1")).toBeInTheDocument();
      expect(decisions(calls)).toEqual(["accept"]);
    });

    it("confirms an approval, and offers nothing to undo", async () => {
      stubDecide();
      approvals.rows = [approval("a1")];
      render(<App />);
      openQueue();
      approveThroughConfirm();
      await act(async () => {});

      expect(toast()).toHaveTextContent("Approved: Approval a1");
      // Accept has already gone out — the outbox has it and the reply may be on its way — so an
      // Undo here would be a button that lies. It is absent, not disabled.
      expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    });

    it("states the decision rather than repeating the question", async () => {
      stubDecide();
      approvals.rows = [{ ...approval("a1"), description: "Send the Q3 summary?" }];
      render(<App />);
      openQueue();
      approveThroughConfirm();
      await act(async () => {});

      expect(toast()).toHaveTextContent("Approved: Send the Q3 summary");
    });

    /** jsdom's Blob has no `text()` (nor `arrayBuffer`), so the beacon's body is read the way this
     *  environment does have — the same FileReader a browser would fall back on. */
    const readBody = (body: BodyInit | null): Promise<string> =>
      new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsText(body as Blob);
      });

    it("flushes the held-back ignore as a beacon if the window goes first", async () => {
      stubDecide();
      const sent: { url: string; body: BodyInit | null }[] = [];
      // loop-r2-05: `Object.assign` is not enough to build this stand-in any more. The shell reads
      // `navigator.onLine` for the connection banner, and jsdom's is an own accessor with no setter,
      // so assignment down the prototype chain throws. Own properties shadow it and leave the rest
      // of `navigator` — the parts the shell also touches — inherited and real.
      const fakeNavigator = Object.create(navigator) as Navigator;
      Object.defineProperties(fakeNavigator, {
        onLine: { value: navigator.onLine, configurable: true },
        sendBeacon: {
          configurable: true,
          value: (url: string, body?: BodyInit | null): boolean => {
            sent.push({ url, body: body ?? null });
            return true;
          },
        },
      });
      vi.stubGlobal("navigator", fakeNavigator);
      approvals.rows = [approval("a1")];
      render(<App />);
      openQueue();
      fireEvent.click(screen.getByRole("button", { name: "Ignore" }));

      act(() => {
        window.dispatchEvent(new Event("beforeunload"));
      });

      // A fetch would be cancelled with the document, so the deferred write leaves as a beacon —
      // same route, same JSON body, best effort by construction.
      expect(sent).toHaveLength(1);
      expect(sent[0]?.url).toContain("/approvals/a1/decide");
      // The fake clock goes before the read: jsdom's FileReader delivers its load in a task, and a
      // task that never runs is a promise that never settles.
      vi.useRealTimers();
      expect(await readBody(sent[0]?.body ?? null)).toContain('"decision":"ignore"');
    });
  });
});

/** loop-r2-06: the shell is the queue's one owner, and these are the two places that shows. The
 *  queue's rows and Today's cards learn a thread's name from the shell (L2-24), and the task
 *  checkbox's write goes up to the shell so that the toast, its undo and the optimistic box are the
 *  same code for every screen that ticks one (L2-04). Neither is observable from a screen on its
 *  own — `destinationFor` reaching `ApprovalStack` and `onToggleDone` reaching `Tasks` is exactly
 *  what a screen-level test cannot see, because the screen is handed the prop either way. */
describe("App shell queue destinations and task completion (loop-r2-06)", () => {
  const approval = (id: string, threadId = `thread-${id}`) => ({
    id,
    thread_id: threadId,
    risk: "normal",
    created_at: 1,
    action: "send",
    description: `Approval ${id}`,
    config: { allow_accept: true, allow_edit: true, allow_respond: true, allow_ignore: true },
  });
  /** A row of Today's tab: open, due today, mine. */
  const task = (over: Record<string, unknown> = {}) => ({
    id: "t1",
    title: "Send Dana deck comments",
    detail: null,
    kind: "todo",
    state: "open",
    owner_kind: "me",
    source_item_id: null,
    person_id: null,
    delegated_session_id: null,
    due_at: Date.now(),
    done_at: null,
    created_at: Date.now(),
    created_by: "me",
    ...over,
  });

  interface HubCall {
    url: string;
    init?: RequestInit;
  }

  function stubHub(ok = true): HubCall[] {
    const calls: HubCall[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit): Promise<Response> => {
      calls.push({ url, init });
      return { ok, status: ok ? 200 : 500, json: async () => ({}) } as unknown as Response;
    });
    return calls;
  }

  const bodiesFor = (calls: HubCall[], path: string): unknown[] =>
    calls.filter((call) => call.url.includes(path)).map((call) => JSON.parse(String(call.init?.body)));

  beforeEach(() => {
    approvals.rows = [];
    tasks.rows = [];
    threads.rows = [];
  });
  afterEach(() => vi.unstubAllGlobals());

  it("names the queue's threads and opens one from the card", () => {
    threads.rows = [{ id: "thread-a1", title: "#omnis-launch", external_id: "C0123" }];
    approvals.rows = [approval("a1"), approval("a2", "thread-a1")];

    const { container } = render(<App />);

    // Two approvals in one thread: the newer takes the card (a1, the first on a tie), so a2 is the
    // collapsed row — and that row is the one that had nothing but a description on it before.
    expect(screen.getByText("1 more waiting")).toBeInTheDocument();
    expect(
      within(screen.getByRole("button", { name: /Approval a2/ })).getByText("in #omnis-launch"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open #omnis-launch" }));
    // The link opened the conversation the card was about: the pane is a thread now, not the queue.
    expect(container.querySelector(".thread-screen")).not.toBeNull();
    expect(screen.queryByRole("region", { name: "Pending approvals" })).toBeNull();
  });

  it("falls back to the plain noun for a thread the shell cannot name, and draws no link at all without one", () => {
    // No thread row has synced for this approval's id. A row must not invent a name and must not
    // leave a dangling "in" — but the way back into the conversation is still there, under a label
    // that promises less than it cannot deliver.
    approvals.rows = [approval("a1"), approval("a2")];
    const { container, unmount } = render(<App />);
    expect(container.querySelector(".approval-stack__row-where")).toBeNull();
    expect(screen.getByRole("button", { name: "Open thread" })).toBeInTheDocument();
    unmount();

    // An approval raised outside any thread has no conversation to go back to, so the link is gone
    // rather than pointing at nothing.
    approvals.rows = [{ ...approval("a1"), thread_id: null }];
    const second = render(<App />);
    expect(second.container.querySelector(".approval-open-link")).toBeNull();
  });

  it("gives Today the shell's queue, counted from the same list the Inbox reads", () => {
    approvals.rows = [approval("a1"), approval("a2")];
    render(<App screen="today" />);

    // The strip is a prop now; this screen runs no query of its own for it. Two approvals, and the
    // greeting's second number is the same two.
    expect(screen.getByRole("heading", { name: "Pending approvals (2)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("2 approvals pending");
  });

  it("lets Today decide through the shell — one write, from the same path as the queue", () => {
    approvals.rows = [approval("a1")];
    const calls = stubHub();
    render(<App screen="today" />);

    fireEvent.click(screen.getByRole("button", { name: /Approval a1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Approve" }),
    );

    // Before loop-r2-06 this screen called `decideApproval` itself, which worked but left the card
    // in the Inbox and raised no toast. The write is the shell's now, so there is exactly one.
    expect(bodiesFor(calls, "/approvals/a1/decide")).toEqual([{ decision: "accept" }]);
  });

  it("ticks a task through the hub, says so, and reopens it from the toast's Undo", async () => {
    tasks.rows = [task()];
    const calls = stubHub();
    render(<App screen="tasks" />);

    const box = screen.getByRole("checkbox", { name: "Send Dana deck comments" });
    expect(box).not.toBeChecked();

    fireEvent.click(box);

    // The box fills on the click — the write is still in flight — and the hub is told "done".
    expect(box).toBeChecked();
    await waitFor(() =>
      expect(bodiesFor(calls, "/tasks/t1/state")).toEqual([{ state: "done" }]),
    );
    // The title travels with the callback, so the toast names the task rather than saying
    // "Completed" about nothing in particular.
    const toast = await waitFor(() => {
      const el = document.querySelector("[data-sonner-toast]");
      if (el === null) throw new Error("no toast yet");
      return el;
    });
    expect(toast.textContent).toContain('Completed "Send Dana deck comments"');

    fireEvent.click(within(toast as HTMLElement).getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(bodiesFor(calls, "/tasks/t1/state")).toEqual([{ state: "done" }, { state: "open" }]),
    );
  });

  it("puts the box back when the hub refuses, and offers a retry", async () => {
    tasks.rows = [task()];
    const calls = stubHub(false);
    render(<App screen="tasks" />);

    const box = screen.getByRole("checkbox", { name: "Send Dana deck comments" });
    fireEvent.click(box);
    expect(box).toBeChecked();

    // A refusal is not silently kept: the box goes back to the row's own state, and the toast says
    // what happened without claiming the task moved.
    await waitFor(() => expect(box).not.toBeChecked());
    const toast = await waitFor(() => {
      const el = document.querySelector("[data-sonner-toast]");
      if (el === null) throw new Error("no toast yet");
      return el;
    });
    expect(toast.textContent).toContain("Couldn't update the task.");
    expect(within(toast as HTMLElement).getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(bodiesFor(calls, "/tasks/t1/state")).toEqual([{ state: "done" }]);
  });
});
