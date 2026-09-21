// @vitest-environment jsdom
// The root `pnpm test` does not read apps/desktop/vitest.config.ts (the same situation as the
// packages/ui tests), so this file declares its own environment and setup.
import "./setup";

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
    expect(fetchMock).not.toHaveBeenCalled();
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
  // The narrow-shell breakpoint is held in **both** the CSS container query and
  // channel-rail.tsx's matchMedia — React cannot read a container query's result, so the two
  // cannot be merged. Change one and the rail draws the wrong tier (a bottom bar with six tiles,
  // or the reverse) while the screen still looks plausible. This test stops that drift: when
  // app.css changes, channel-rail.tsx's NARROW_RAIL_QUERY changes with it.
  it("uses the same narrow-rail breakpoint in app.css and channel-rail.tsx", () => {
    const css = readFileSync(join(TEST_DIR, "../src/app.css"), "utf8");
    const tsx = readFileSync(
      join(TEST_DIR, "../../../packages/ui/src/components/channel-rail.tsx"),
      "utf8",
    );
    // Look for the cut TS asserts inside the CSS. That catches drift in both directions: change
    // either side alone and the string is no longer in the CSS, which fails here. (Picking "the
    // narrowest cut" instead would grab the wrong value the moment a narrower cut is added.)
    const fromTsx = tsx.match(/NARROW_RAIL_QUERY = "\(max-width: ([\d.]+)px\)"/)?.[1];

    expect(fromTsx).toBeDefined();
    expect(css).toContain(`@container shell (max-width: ${fromTsx}px)`);
  });
});
