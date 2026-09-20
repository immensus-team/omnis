// @vitest-environment jsdom
// The root `pnpm test` (vitest.workspace.ts) does not read packages/ui/vitest.config.ts,
// so the file declares its own environment and setup (jest-dom matchers + afterEach(cleanup)).
import "./setup";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ApprovalStack,
  type ApprovalStackItem,
  scopeApprovalStack,
} from "../src/components/approval-stack.js";

function approval(over: Partial<ApprovalStackItem> & { id: string }): ApprovalStackItem {
  return {
    action: "send",
    description: `approval ${over.id}`,
    config: { allow_accept: true, allow_edit: true, allow_respond: false, allow_ignore: true },
    thread_id: "t1",
    risk: "normal",
    created_at: 0,
    ...over,
  };
}

// The open thread's own approval is the risky old one; the newest approval in the queue belongs to
// another thread. Both facts matter: the stack is scoped by thread **and** ranked by risk.
const A = approval({ id: "a", thread_id: "t1", risk: "normal", created_at: 100 });
const B = approval({ id: "b", thread_id: "t1", risk: "high", created_at: 50 });
const C = approval({ id: "c", thread_id: "t2", risk: "normal", created_at: 200 });
// t2's own riskiest — the queue's newest, and the reason "t1's stack does not show it" is a real
// assertion rather than a coincidence of ordering.
const D = approval({ id: "d", thread_id: "t2", risk: "high", created_at: 300 });
const ALL = [A, B, C, D];

describe("scopeApprovalStack (US-D03: hierarchy instead of an identical card wall)", () => {
  it("expands the open thread's riskiest approval and collapses the rest", () => {
    const { primary, collapsed } = scopeApprovalStack(ALL, "t1");
    expect(primary?.id).toBe("b");
    expect(collapsed.map((a) => a.id)).toEqual(["a"]);
  });

  it("prefers the newest when risk ties", () => {
    const older = approval({ id: "old", thread_id: "t1", created_at: 1 });
    const newer = approval({ id: "new", thread_id: "t1", created_at: 2 });
    expect(scopeApprovalStack([older, newer], "t1").primary?.id).toBe("new");
  });

  it("leaves other threads' approvals out of the open thread's stack entirely", () => {
    // The inbox's needs-approval tab is the queue surface. Listing the rest of the queue here put
    // another conversation's work at the top of this pane, above the title of the thread it was
    // supposed to be about, so the pane never opened on its own subject.
    const { primary, collapsed } = scopeApprovalStack(ALL, "t1");
    expect([primary?.id, ...collapsed.map((a) => a.id)]).toEqual(["b", "a"]);
    expect(scopeApprovalStack(ALL, "t1").collapsed.some((a) => a.thread_id !== "t1")).toBe(false);
  });

  it("falls back to the whole queue when no thread is open", () => {
    // Nothing is open, so there is no narrower scope to read — and this pane is only ever drawn
    // for the queue itself, so it still leads with one real card rather than a list of stubs.
    const { primary, collapsed } = scopeApprovalStack(ALL, null);
    expect(primary?.id).toBe("d");
    expect(collapsed.map((a) => a.id)).toEqual(["b", "c", "a"]);
  });

  it("empties the stack when the open thread has no approval of its own", () => {
    const { primary, collapsed } = scopeApprovalStack(ALL, "t3");
    expect(primary).toBeNull();
    expect(collapsed).toEqual([]);
  });
});

describe("ApprovalStack (US-D03)", () => {
  it("renders one expanded card and the rest as one-line rows under a count", () => {
    render(<ApprovalStack approvals={ALL} openThreadId="t1" onDecide={vi.fn()} />);
    // The expanded card keeps its four buttons; the collapsed rows do not carry any.
    expect(screen.getByText("Approve")).toBeInTheDocument();
    expect(screen.getAllByText("Approve")).toHaveLength(1);
    expect(screen.getByText("1 more waiting")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /approval [a-d]/ })).toHaveLength(1);
  });

  it("draws nothing for an open thread that has no approval of its own", () => {
    // The whole-queue fallback is for the pane with nothing open. With a thread open, an empty
    // scope is an empty pane — not four rows about four other conversations.
    const { container } = render(
      <ApprovalStack approvals={ALL} openThreadId="t3" onDecide={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("names the action and the risk on a collapsed row", () => {
    // Two high-risk approvals in one thread: the newer takes the card, so the older is the only
    // way a collapsed row can carry the risk badge at all (the ranking always promotes the risky
    // one to the card).
    const highNew = approval({ id: "high-new", thread_id: "t5", risk: "high", created_at: 20 });
    const highOld = approval({ id: "high-old", thread_id: "t5", risk: "high", created_at: 10 });
    const calm = approval({ id: "calm", thread_id: "t5", risk: "normal", created_at: 30 });
    render(
      <ApprovalStack approvals={[highOld, calm, highNew]} openThreadId="t5" onDecide={vi.fn()} />,
    );
    expect(screen.getAllByText("High risk")).toHaveLength(1);
    expect(screen.getAllByText("Send")).toHaveLength(2);
  });

  it("promotes a collapsed row when it is picked, and does not leave it behind in the list", () => {
    // t2 is the one thread here with two approvals, so it is the one where a row can be picked.
    render(<ApprovalStack approvals={ALL} openThreadId="t2" onDecide={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /approval c/ }));
    expect(screen.queryByText(/more waiting/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /approval c/ })).not.toBeInTheDocument();
    expect(screen.getByText("Approve")).toBeInTheDocument();
  });

  it("does not carry a picked approval across a thread switch", () => {
    // This component is rendered as a stable child of the thread view (App.tsx), so switching
    // threads re-renders it instead of remounting it and pickedId outlives the thread it was
    // picked in. It used to be looked up in the unscoped queue, so the pick made in t2 stayed on
    // screen after switching to a thread that has nothing pending of its own — another
    // conversation's card, with its four buttons, under this thread's title.
    const { container, rerender } = render(
      <ApprovalStack approvals={ALL} openThreadId="t2" onDecide={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /approval c/ }));
    // Before the switch the pick really is what is on screen, so the assertion below is about the
    // switch and not about a click that never took.
    expect(screen.getByText("Approve")).toBeInTheDocument();
    rerender(<ApprovalStack approvals={ALL} openThreadId="t3" onDecide={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("falls back to the newly opened thread's own primary after a switch", () => {
    // The other half of the same guarantee: a stale pick must not survive into a thread that *does*
    // have approvals — it has to yield to that thread's own card. Asserted through the decision
    // callback, because that is the id the hub would act on.
    const onDecide = vi.fn();
    const { rerender } = render(
      <ApprovalStack approvals={ALL} openThreadId="t2" onDecide={onDecide} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /approval c/ }));
    rerender(<ApprovalStack approvals={ALL} openThreadId="t1" onDecide={onDecide} />);
    expect(screen.getByText("1 more waiting")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /approval c/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Approve"));
    expect(onDecide).toHaveBeenCalledWith("b", "accept", undefined);
  });

  it("draws nothing at all when the queue is empty", () => {
    const { container } = render(
      <ApprovalStack approvals={[]} openThreadId={null} onDecide={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("decides by the approval's id, not by the card's", () => {
    const onDecide = vi.fn();
    render(<ApprovalStack approvals={ALL} openThreadId="t1" onDecide={onDecide} />);
    fireEvent.click(screen.getByText("Approve"));
    expect(onDecide).toHaveBeenCalledWith("b", "accept", undefined);
  });
});
