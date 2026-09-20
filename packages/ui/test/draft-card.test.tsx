// @vitest-environment jsdom
// The root `pnpm test` (vitest.workspace.ts) does not read packages/ui/vitest.config.ts, so the
// file declares its own environment and setup (jest-dom matchers + afterEach(cleanup)).
import "./setup";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DraftCard } from "../src/components/draft-card";

describe("DraftCard (A5-D9)", () => {
  it("shows full body (no truncation) and rationale", () => {
    render(
      <DraftCard
        body="Yes, confirmed — I will leave comments tomorrow morning."
        rationale="PROJECTS.md #davich"
        onEditAndSend={vi.fn()}
        onDiscard={vi.fn()}
        onRegenerate={vi.fn()}
      />,
    );
    expect(
      screen.getByText("Yes, confirmed — I will leave comments tomorrow morning."),
    ).toBeInTheDocument();
    expect(screen.getByText(/PROJECTS.md #davich/)).toBeInTheDocument();
  });
  it("wires the 3 buttons to their callbacks (§8 microcopy, en source locale)", () => {
    const onEditAndSend = vi.fn();
    const onDiscard = vi.fn();
    const onRegenerate = vi.fn();
    render(
      <DraftCard
        body="b"
        rationale="r"
        onEditAndSend={onEditAndSend}
        onDiscard={onDiscard}
        onRegenerate={onRegenerate}
      />,
    );
    fireEvent.click(screen.getByText("Edit & send"));
    expect(onEditAndSend).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText("Discard"));
    expect(onDiscard).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText("Regenerate"));
    expect(onRegenerate).toHaveBeenCalledOnce();
  });
});
