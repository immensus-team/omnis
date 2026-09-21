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
        onDiscard={vi.fn()}
      />,
    );
    expect(
      screen.getByText("Yes, confirmed — I will leave comments tomorrow morning."),
    ).toBeInTheDocument();
    expect(screen.getByText(/PROJECTS.md #davich/)).toBeInTheDocument();
  });

  it("wires Discard to its callback (§8 microcopy, en source locale)", () => {
    const onDiscard = vi.fn();
    render(<DraftCard body="b" rationale="r" onDiscard={onDiscard} />);
    fireEvent.click(screen.getByText("Discard"));
    expect(onDiscard).toHaveBeenCalledOnce();
  });

  it("offers Discard and nothing else (loop-r2-02)", () => {
    // "Edit & send" and "Regenerate" were on this card and neither did anything when pressed — the
    // reported defect. A draft that has an approval is rendered as that approval's card instead
    // (foldDraft, Thread.tsx), and the standalone draft's "Edit & send" comes back on loop-r2-03
    // wired to the composer; until then the card must not grow a button back by accident.
    render(<DraftCard body="b" rationale="r" onDiscard={vi.fn()} />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
  });
});
