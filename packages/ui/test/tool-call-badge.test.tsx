// @vitest-environment jsdom
// The root `pnpm test` (vitest.workspace.ts) does not read packages/ui/vitest.config.ts, so the
// environment and the setup (jest-dom matchers + afterEach(cleanup)) are declared by the file.
import "./setup";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TOOL_LABELS, ToolCallBadge } from "../src/components/tool-call-badge";

describe("TOOL_LABELS / ToolCallBadge (A5-D11)", () => {
  it("covers all 8 master §11 tool names", () => {
    expect(Object.keys(TOOL_LABELS).sort()).toEqual(
      [
        "propose_delegation",
        "propose_draft",
        "propose_route",
        "propose_task",
        "read",
        "read_calendar",
        "read_session",
        "search_memory",
      ].sort(),
    );
  });
  it("loading state is aria-busy, done state shows the result summary", () => {
    const { rerender } = render(<ToolCallBadge tool="read" state="loading" />);
    expect(screen.getByText("Reading").closest("[aria-busy]")).toHaveAttribute("aria-busy", "true");
    rerender(<ToolCallBadge tool="read" state="done" resultSummary="3 files" />);
    expect(screen.getByText(/3 files/)).toBeInTheDocument();
  });
  it("throws for an unmapped tool name (fail fast, not a silent blank badge)", () => {
    // @ts-expect-error deliberately invalid tool for the failure-path assertion
    expect(() => render(<ToolCallBadge tool="delete" state="done" />)).toThrow(/unknown tool/);
  });
});
