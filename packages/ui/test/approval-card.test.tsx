// @vitest-environment jsdom
// The root `pnpm test` (vitest.workspace.ts) does not read packages/ui/vitest.config.ts, so the
// environment and the setup (jest-dom matchers + afterEach(cleanup)) are declared by the file itself.
import "./setup";
import { fireEvent, render, screen, within } from "@testing-library/react";
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

  // US-D09 §c.8: the card's Accept is the one decision that leaves this screen for the tool, so it
  // asks first — and the prompt carries the description, because the card behind it is dimmed.
  it("accept asks before it decides, then calls onDecide('accept')", () => {
    const onDecide = vi.fn();
    render(<ApprovalCardView interrupt={interrupt} onDecide={onDecide} />);
    fireEvent.click(screen.getByText("Approve"));

    const prompt = screen.getByRole("alertdialog", { name: "Approve this action?" });
    expect(prompt).toHaveTextContent(interrupt.description);
    // Nothing has been decided yet — that is what the prompt is for.
    expect(onDecide).not.toHaveBeenCalled();

    fireEvent.click(within(prompt).getByRole("button", { name: "Approve" }));
    expect(onDecide).toHaveBeenCalledWith("accept", undefined);
  });

  it("cancel closes the question without deciding", () => {
    const onDecide = vi.fn();
    render(<ApprovalCardView interrupt={interrupt} onDecide={onDecide} />);
    fireEvent.click(screen.getByText("Approve"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onDecide).not.toHaveBeenCalled();
  });

  // A decision the tool cannot take back is the only one the pill may colour --danger-500; approving
  // a send is recoverable by deciding again, a delete is not.
  it("marks only the irreversible action's confirm as destructive", () => {
    // The prompt's confirm, not the card's button of the same name — the card's is never marked.
    const confirm = () =>
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Approve" });

    const { unmount } = render(<ApprovalCardView interrupt={interrupt} onDecide={vi.fn()} />);
    fireEvent.click(screen.getByText("Approve"));
    expect(confirm()).not.toHaveAttribute("data-destructive");
    unmount();

    render(<ApprovalCardView interrupt={{ ...interrupt, action: "delete" }} onDecide={vi.fn()} />);
    fireEvent.click(screen.getByText("Approve"));
    expect(confirm()).toHaveAttribute("data-destructive", "true");
  });
});
