// @vitest-environment jsdom
// The root `pnpm test` (vitest.workspace.ts) does not read packages/ui/vitest.config.ts,
// so the file declares its own environment and setup (jest-dom matchers + afterEach(cleanup)).
import "./setup";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentStatusBadge } from "../src/components/status-badge";
import { AgentStatusPill, StatusPill } from "../src/components/status-pill";

describe("AgentStatusPill (the five agent session states)", () => {
  it.each([
    ["idle", "Idle", "neutral"],
    ["working", "Working", "info"],
    // blocked = "needs my reply". It is not danger (red) because it is not an error — the error
    // is failed. This one line pins down round 2's rejection (red header / blue row).
    ["blocked", "Blocked", "warning"],
    ["done", "Done", "success"],
    ["failed", "Failed", "danger"],
  ] as const)("%s → %s / tone %s", (state, label, tone) => {
    render(<AgentStatusPill state={state} />);
    const pill = screen.getByText(label);
    expect(pill).toHaveClass("status-pill");
    expect(pill).toHaveAttribute("data-tone", tone);
  });
});

// One state must not be worded two ways on one screen — the header pill and the row badge have
// different shapes but the same purpose. The colour cannot diverge (app.css gives one set of
// values to both selectors); the label is the part that can.
describe("the pill and the row badge call the same state by the same name", () => {
  it.each(["idle", "working", "blocked", "done"] as const)("%s", (state) => {
    const { container: pill } = render(<AgentStatusPill state={state} />);
    const { container: badge } = render(<AgentStatusBadge state={state} />);
    expect(badge.textContent).toBe(pill.textContent);
  });
});

describe("StatusPill, the base form", () => {
  it("draws the tone dot before the label", () => {
    const { container } = render(<StatusPill tone="info" label="Working" />);
    expect(container.querySelector(".status-pill__dot")).toBeInTheDocument();
    expect(container.querySelector(".status-pill")).toHaveTextContent("Working");
  });

  it("merges className onto .status-pill", () => {
    const { container } = render(<StatusPill tone="info" label="Working" className="custom" />);
    expect(container.querySelector(".status-pill")).toHaveClass("custom");
  });
});
