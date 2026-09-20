// @vitest-environment jsdom
// The root `pnpm test` (vitest.workspace.ts) does not read packages/ui/vitest.config.ts,
// so the file declares its own environment and setup (jest-dom matchers + afterEach(cleanup)).
import "./setup";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "../src/components/segmented-control.js";

const OPTIONS = [
  { value: "conversation", label: "Conversation" },
  { value: "summary", label: "Summary" },
  { value: "notes", label: "Notes" },
] as const;

describe("SegmentedControl (US-D03: the reference's Price/PPSF switch)", () => {
  it("marks exactly the selected segment as checked", () => {
    render(
      <SegmentedControl options={OPTIONS} value="summary" onChange={vi.fn()} label="Thread view" />,
    );
    expect(screen.getByRole("radio", { name: "Summary" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Conversation" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("reports the picked segment", () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        options={OPTIONS}
        value="conversation"
        onChange={onChange}
        label="Thread view"
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Notes" }));
    expect(onChange).toHaveBeenCalledWith("notes");
  });

  it("names the group", () => {
    // Three unlabelled radios announce "radio button, 1 of 3" with nothing saying what is chosen.
    render(
      <SegmentedControl
        options={OPTIONS}
        value="conversation"
        onChange={vi.fn()}
        label="Thread view"
      />,
    );
    expect(screen.getByRole("radiogroup", { name: "Thread view" })).toBeInTheDocument();
  });
});
