// @vitest-environment jsdom
// The root `pnpm test` does not read apps/web/vitest.config.ts, so this file declares its own
// environment and setup — the same line apps/desktop's tsx tests carry for the same reason. Without
// it the file runs in node and dies on `document is not defined`.
import "./setup";

import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";

/** The shell is what this file is about, so Zero is stubbed at the module boundary: a real client
 *  would open a WebSocket to 127.0.0.1:4848 from every test run. `useQuery` answers "loaded, no
 *  rows", which is the state the empty inbox copy describes. */
const zqlChain: unknown = new Proxy(function zql() {} as unknown as object, {
  get: () => zqlChain,
  apply: () => zqlChain,
});

vi.mock("@rocicorp/zero/react", () => ({
  ZeroProvider: ({ children }: { children: ReactNode }) => children,
  useZero: () => ({ query: zqlChain }),
  useQuery: () => [[], { type: "complete" }],
}));

/** The client module is stubbed for the same reason: App's getZero() builds a real Zero, which opens
 *  a WebSocket to the zero-cache port. A unit test that dials a socket is a network call, and this one
 *  logs a connection failure on every run, which makes a green suite look broken. */
vi.mock("../src/zero-client.js", () => ({
  initZero: () => ({}),
  useZeroClient: () => ({ query: zqlChain }),
}));

/** jsdom has no matchMedia, and the shell asks it one question at mount ("is this installed?").
 *  The default stub says "no" — a browser, which is where the install guide belongs. */
const realMatchMedia = window.matchMedia;

function stubStandalone(standalone: boolean): void {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: standalone,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  window.matchMedia = realMatchMedia;
});

describe("App shell", () => {
  it("opens on Inbox, and the top bar follows the tab that is selected", () => {
    stubStandalone(false);
    render(<App />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Inbox");
    expect(screen.getByRole("tab", { name: "Inbox" })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("tab", { name: "Tasks" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Tasks");
    expect(screen.getByRole("tab", { name: "Tasks" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Inbox" })).toHaveAttribute("aria-selected", "false");
  });

  it("shows the install guide in a browser and lets it be dismissed", () => {
    stubStandalone(false);
    render(<App />);
    expect(screen.getByRole("dialog", { name: "Add to Home Screen" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("dialog", { name: "Add to Home Screen" })).toBeNull();
  });

  it("does not show the install guide once the app is installed", () => {
    stubStandalone(true);
    render(<App />);
    expect(screen.queryByRole("dialog", { name: "Add to Home Screen" })).toBeNull();
  });

  it("draws the Inbox tab's body and says so on the surface", () => {
    stubStandalone(true);
    render(<App />);
    expect(screen.getByRole("main")).toHaveAttribute("data-screen", "inbox");
    // The screenshot tool reads this attribute — a frame of an empty list photographs as cleanly
    // as a finished one.
    expect(screen.getByText("Nothing in the inbox.")).toBeInTheDocument();
  });
});
