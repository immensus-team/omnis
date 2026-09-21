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
  // loop-r1-02/L-26: the four labels are one word each. "Edit & approve" wrapped to two lines inside
  // its own button at 320 and pushed "Ignore" past the card's right edge — the card is where a
  // decision is made, so a decision the card clips is the one thing it must not do.
  it("renders only the buttons the config allows", () => {
    render(<ApprovalCardView interrupt={interrupt} onDecide={vi.fn()} />);
    expect(screen.getByText("Approve")).toBeInTheDocument();
    expect(screen.getByText("Edit")).toBeInTheDocument();
    expect(screen.queryByText("Respond")).not.toBeInTheDocument();
    expect(screen.getByText("Ignore")).toBeInTheDocument();
  });

  it("spells all four decisions when the config allows all four", () => {
    render(
      <ApprovalCardView
        interrupt={{
          ...interrupt,
          config: { allow_accept: true, allow_edit: true, allow_respond: true, allow_ignore: true },
        }}
        onDecide={vi.fn()}
      />,
    );
    for (const label of ["Approve", "Edit", "Respond", "Ignore"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
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

// loop-r2-01: the round-2 user tests lost data on two clicks. "Edit" decided `edit` with the
// untouched args — a confirm-free approve whose toast still said "Approved" — and "Respond" decided
// with `decided_args = NULL`, so the agent got an empty answer. Both are now states of the card, and
// the card says what it would send and where before either is pressed.
describe("ApprovalCardView — Edit and Respond open an editor (loop-r2-01)", () => {
  /** The shape the two bugs lived on: a send with a body, on a named channel, to a named place. */
  const sendInterrupt: ApprovalCardInterrupt = {
    action: "send",
    description: "Reply to #omnis-launch?",
    args: { channel: "slack", body: "Yes, I will review it today." },
    config: { allow_accept: true, allow_edit: true, allow_respond: true, allow_ignore: true },
  };
  const DESTINATION = "#omnis-launch";
  const original = (): HTMLElement => screen.getByText("Yes, I will review it today.");

  it("says where the action goes and what it would send", () => {
    render(
      <ApprovalCardView interrupt={sendInterrupt} destination={DESTINATION} onDecide={vi.fn()} />,
    );
    expect(screen.getByText("Reply in #omnis-launch · Slack")).toBeInTheDocument();
    expect(original()).toBeInTheDocument();
  });

  it("Edit opens the message; the click decides nothing", () => {
    const onDecide = vi.fn();
    render(
      <ApprovalCardView interrupt={sendInterrupt} destination={DESTINATION} onDecide={onDecide} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(onDecide).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Edit message" })).toHaveValue(
      "Yes, I will review it today.",
    );
  });

  it("Save & send asks first, then decides with the edited body — once", () => {
    const onDecide = vi.fn();
    render(
      <ApprovalCardView interrupt={sendInterrupt} destination={DESTINATION} onDecide={onDecide} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Edit message" }), {
      target: { value: "Yes, I will review it tomorrow." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save & send" }));

    // The prompt, not the button, is what sends — and it says which message it is about to send.
    const prompt = screen.getByRole("alertdialog", { name: "Approve this action?" });
    expect(onDecide).not.toHaveBeenCalled();
    expect(prompt).toHaveTextContent("Yes, I will review it tomorrow.");

    fireEvent.click(within(prompt).getByRole("button", { name: "Send" }));
    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(onDecide).toHaveBeenCalledWith("edit", {
      channel: "slack",
      body: "Yes, I will review it tomorrow.",
    });
  });

  it("Escape leaves the editor without deciding and puts the read state back", () => {
    const onDecide = vi.fn();
    render(
      <ApprovalCardView interrupt={sendInterrupt} destination={DESTINATION} onDecide={onDecide} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Edit message" }), {
      target: { value: "half a sentence" },
    });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Edit message" }), { key: "Escape" });

    expect(onDecide).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: "Edit message" })).not.toBeInTheDocument();
    expect(original()).toBeInTheDocument();
    // The focus goes back to the button that opened the editor, so a keyboard user is not dropped
    // on `<body>` — the same rule the pane's own Escape follows.
    expect(screen.getByRole("button", { name: "Edit" })).toHaveFocus();
  });

  it("Respond opens a reply field; nothing is sent until there is something to send", () => {
    const onDecide = vi.fn();
    render(
      <ApprovalCardView interrupt={sendInterrupt} destination={DESTINATION} onDecide={onDecide} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Respond" }));

    expect(onDecide).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Send to agent" })).toBeDisabled();

    const field = screen.getByRole("textbox", { name: "Reply to the agent" });
    fireEvent.change(field, { target: { value: "use Tuesday" } });
    expect(screen.getByRole("button", { name: "Send to agent" })).toBeEnabled();
    fireEvent.keyDown(field, { key: "Enter" });

    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(onDecide).toHaveBeenCalledWith("respond", { response: "use Tuesday" });
  });
});
