import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";

/** jsdom has no matchMedia, and the shell asks it one question at mount ("is this installed?").
 *  The default stub says "no" — i.e. a browser, which is where the install guide belongs. */
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
});
