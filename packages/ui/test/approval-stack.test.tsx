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
const ALL = [A, B, C];

describe("scopeApprovalStack (US-D03: hierarchy instead of an identical card wall)", () => {
  it("expands the open thread's riskiest approval and collapses the rest", () => {
    const { primary, collapsed } = scopeApprovalStack(ALL, "t1");
    expect(primary?.id).toBe("b");
    expect(collapsed.map((a) => a.id)).toEqual(["a", "c"]);
  });

  it("prefers the newest when risk ties", () => {
    const older = approval({ id: "old", thread_id: "t1", created_at: 1 });
    const newer = approval({ id: "new", thread_id: "t1", created_at: 2 });
    expect(scopeApprovalStack([older, newer], "t1").primary?.id).toBe("new");
  });

  it("keeps a thread's own approvals ahead of other threads' in the collapsed list", () => {
    const other = approval({ id: "other", thread_id: "t9", risk: "high", created_at: 999 });
    expect(scopeApprovalStack([B, other, A], "t1").collapsed.map((a) => a.id)).toEqual([
      "a",
      "other",
    ]);
  });

  it("falls back to the whole queue when no thread is open", () => {
    // Nothing is open, so there is no narrower scope to read — the pane still leads with one real
    // card rather than three stubs.
    const { primary, collapsed } = scopeApprovalStack(ALL, null);
    expect(primary?.id).toBe("b");
    expect(collapsed).toHaveLength(2);
  });

  it("collapses everything when the open thread has no approval", () => {
    const { primary, collapsed } = scopeApprovalStack(ALL, "t3");
    expect(primary).toBeNull();
    expect(collapsed).toHaveLength(3);
  });
});

describe("ApprovalStack (US-D03)", () => {
  it("renders one expanded card and the rest as one-line rows under a count", () => {
    render(<ApprovalStack approvals={ALL} openThreadId="t1" onDecide={vi.fn()} />);
    // The expanded card keeps its four buttons; the collapsed rows do not carry any.
    expect(screen.getByText("Approve")).toBeInTheDocument();
    expect(screen.getAllByText("Approve")).toHaveLength(1);
    expect(screen.getByText("2 more waiting")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /approval [ac]/ })).toHaveLength(2);
  });

  it("names the action and the risk on a collapsed row", () => {
    render(<ApprovalStack approvals={ALL} openThreadId="t3" onDecide={vi.fn()} />);
    expect(screen.getByText("High risk")).toBeInTheDocument();
    expect(screen.getAllByText("Send")).toHaveLength(3);
  });

  it("promotes a collapsed row when it is picked, and does not leave it behind in the list", () => {
    render(<ApprovalStack approvals={ALL} openThreadId="t1" onDecide={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /approval c/ }));
    expect(screen.getByText("1 more waiting")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /approval c/ })).not.toBeInTheDocument();
    expect(screen.getByText("Approve")).toBeInTheDocument();
  });

  it("decides by the approval's id, not by the card's", () => {
    const onDecide = vi.fn();
    render(<ApprovalStack approvals={ALL} openThreadId="t1" onDecide={onDecide} />);
    fireEvent.click(screen.getByText("Approve"));
    expect(onDecide).toHaveBeenCalledWith("b", "accept", undefined);
  });
});
