// @vitest-environment jsdom
// The root `pnpm test` does not read apps/web/vitest.config.ts — see app.test.tsx.
import "./setup";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BottomTabBar, WEB_TABS } from "../src/components/BottomTabBar.js";

describe("BottomTabBar (A5 §4.1: fixed 5 slots, no Digest·Settings)", () => {
  it("renders exactly the 5 fixed tabs", () => {
    expect(WEB_TABS).toEqual(["inbox", "today", "tasks", "network", "notes"]);
  });

  it("marks the active tab and calls onSelect on click", () => {
    const onSelect = vi.fn();
    render(<BottomTabBar active="inbox" onSelect={onSelect} />);
    expect(screen.getByRole("tab", { name: "Inbox" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Today" }));
    expect(onSelect).toHaveBeenCalledWith("today");
  });

  it("leaves the other four tabs unselected", () => {
    render(<BottomTabBar active="notes" onSelect={() => undefined} />);
    const selected = screen
      .getAllByRole("tab")
      .filter((tab) => tab.getAttribute("aria-selected") === "true");
    expect(selected.map((tab) => tab.textContent)).toEqual(["Notes"]);
  });

  it("keeps Digest and Settings out of the bar — they are not tabs", () => {
    render(<BottomTabBar active="inbox" onSelect={() => undefined} />);
    expect(screen.queryByRole("tab", { name: "Digest" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Settings" })).toBeNull();
  });
});
