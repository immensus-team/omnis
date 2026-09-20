// @vitest-environment jsdom
// The root `pnpm test` (vitest.workspace.ts) does not read packages/ui/vitest.config.ts,
// so the file declares its own environment and setup (jest-dom matchers + afterEach(cleanup)).
import "./setup";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GroupHeader } from "../src/components/group-header";
import { AgentStatusPill } from "../src/components/status-pill";

describe("GroupHeader (US-D02: the list's per-state group header)", () => {
  it("keeps the label in the pill and the count in a separate chip beside it", () => {
    const { container } = render(
      <GroupHeader pill={<AgentStatusPill state="working" />} count={4} />,
    );
    const pill = container.querySelector(".group-header .status-pill");
    expect(pill).toHaveTextContent("Working");
    // If the number moves back inside the pill, the header reads as one more filter chip.
    expect(pill).not.toHaveTextContent("4");
    expect(container.querySelector(".group-header__count")).toHaveTextContent("4");
  });

  // 0 is a real count, not "none" — the chip is omitted only for undefined.
  it.each([
    [0, "0"],
    [undefined, null],
  ] as const)("count=%s", (count, text) => {
    const { container } = render(
      <GroupHeader pill={<AgentStatusPill state="working" />} count={count} />,
    );
    const el = container.querySelector(".group-header__count");
    if (text === null) expect(el).toBeNull();
    else expect(el).toHaveTextContent(text);
  });

  // Headers are interleaved with rows inside the listbox, so they must not be counted as options.
  it("gives the header wrapper role=presentation", () => {
    const { container } = render(<GroupHeader pill={<AgentStatusPill state="working" />} />);
    expect(container.querySelector(".group-header")).toHaveAttribute("role", "presentation");
  });

  it("brings the blocked pill into the header in the warning tone", () => {
    const { container } = render(<GroupHeader pill={<AgentStatusPill state="blocked" />} />);
    expect(container.querySelector(".group-header .status-pill")).toHaveAttribute(
      "data-tone",
      "warning",
    );
  });

  // The reference's "+" means "you can create one here", and omnis has no flow that opens a new
  // session in a given group state — so the header carries no button at all (no dead affordance).
  it("puts no button in the header", () => {
    render(<GroupHeader pill={<AgentStatusPill state="working" />} count={2} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("merges className onto .group-header", () => {
    const { container } = render(
      <GroupHeader pill={<AgentStatusPill state="working" />} className="custom" />,
    );
    expect(container.querySelector(".group-header")).toHaveClass("custom");
  });
});
