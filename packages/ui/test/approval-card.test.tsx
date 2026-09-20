// @vitest-environment jsdom
// The root `pnpm test` (vitest.workspace.ts) does not read packages/ui/vitest.config.ts, so the
// environment and the setup (jest-dom matchers + afterEach(cleanup)) are declared by the file itself.
import "./setup";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type ApprovalCardInterrupt, ApprovalCardView } from "../src/components/approval-card.js";

const interrupt: ApprovalCardInterrupt = {
  action: "send",
  description: "Gmail reply: to David Park",
  config: { allow_accept: true, allow_edit: true, allow_respond: false, allow_ignore: true },
};

describe("ApprovalCardView (A5-D10, the 4-way HumanInterrupt)", () => {
  it("renders only the buttons the config allows", () => {
    render(<ApprovalCardView interrupt={interrupt} onDecide={vi.fn()} />);
    expect(screen.getByText("Approve")).toBeInTheDocument();
    expect(screen.getByText("Edit & approve")).toBeInTheDocument();
    expect(screen.queryByText("Respond")).not.toBeInTheDocument();
    expect(screen.getByText("Ignore")).toBeInTheDocument();
  });

  it("accept calls onDecide('accept')", () => {
    const onDecide = vi.fn();
    render(<ApprovalCardView interrupt={interrupt} onDecide={onDecide} />);
    fireEvent.click(screen.getByText("Approve"));
    expect(onDecide).toHaveBeenCalledWith("accept", undefined);
  });
});
