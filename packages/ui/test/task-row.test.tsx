// @vitest-environment jsdom
// The root `pnpm test` (vitest.workspace.ts) does not read packages/ui/vitest.config.ts,
// so the file declares its own environment and setup (jest-dom matchers + afterEach(cleanup)).
import "./setup";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TaskRow, type TaskRowProps } from "../src/components/task-row.js";

const base: TaskRowProps = {
  id: "t1",
  title: "Review Davich PPT draft",
  kind: "todo",
  state: "open",
  dueBasis: "explicit",
  dueLabel: "Due today",
  sourceLabel: "Gmail",
  onToggleDone: vi.fn(),
  onOpenSource: vi.fn(),
};

describe("TaskRow (A5 §3.5)", () => {
  it("renders a native checkbox and toggles done on click", () => {
    const onToggleDone = vi.fn();
    render(<TaskRow {...base} onToggleDone={onToggleDone} />);
    const checkbox = screen.getByRole("checkbox", { name: base.title });
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(onToggleDone).toHaveBeenCalledWith("t1", true);
  });

  it("marks an inferred due date with a dotted data attribute (A5 §3.5)", () => {
    render(<TaskRow {...base} dueBasis="inferred" />);
    expect(screen.getByText("Due today")).toHaveAttribute("data-due-basis", "inferred");
  });

  it("calls onOpenSource when the source link is clicked", () => {
    const onOpenSource = vi.fn();
    render(<TaskRow {...base} onOpenSource={onOpenSource} />);
    fireEvent.click(screen.getByText("Gmail"));
    expect(onOpenSource).toHaveBeenCalled();
  });

  // The completion strikethrough is a CSS rule on `data-done`, so the attribute is the whole
  // contract between the component and the stylesheet — a `state="done"` row that did not set it
  // would render as an ordinary open task.
  it("marks a done row on both the checkbox and the title", () => {
    render(<TaskRow {...base} state="done" />);
    expect(screen.getByRole("checkbox", { name: base.title })).toBeChecked();
    expect(screen.getByText(base.title)).toHaveAttribute("data-done", "true");
  });

  // A5 §3.5's source is "always visible", but a task whose source item is unknown (a hand-written
  // todo) has nothing to show and nothing to link to — an empty slot would read as a broken one.
  it("draws no source slot and no due slot when both are null", () => {
    const onOpenSource = vi.fn();
    const { container } = render(
      <TaskRow {...base} dueLabel={null} sourceLabel={null} onOpenSource={onOpenSource} />,
    );
    expect(container.querySelector(".task-row__due")).toBeNull();
    expect(container.querySelector(".task-row__source")).toBeNull();
  });

  // The source is a label rather than a control when there is no handler, the same rule the
  // briefing items on Today follow — a button with nothing behind it is worse than plain text.
  it("renders the source as plain text without onOpenSource", () => {
    render(<TaskRow {...base} onOpenSource={undefined} />);
    expect(screen.queryByRole("button", { name: "Gmail" })).not.toBeInTheDocument();
    expect(screen.getByText("Gmail")).toBeInTheDocument();
  });

  it("names the kind icon for assistive tech (A5 §3.5 kind icon)", () => {
    render(<TaskRow {...base} kind="delegation" state="in_progress" />);
    expect(screen.getByRole("img", { name: "Delegated" })).toBeInTheDocument();
  });

  // A5 §3.5: "clicking a Delegated row navigates to that Agent Session". `Open session` is drawn
  // only when the caller actually has a session to open; otherwise the row states where the work
  // is, which is what the mock's "delegated · in progress" line said.
  it("offers the session link for a delegation row that has one", () => {
    const onOpenDelegation = vi.fn();
    render(
      <TaskRow
        {...base}
        kind="delegation"
        state="in_progress"
        onOpenDelegation={onOpenDelegation}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open session" }));
    expect(onOpenDelegation).toHaveBeenCalled();
  });

  it("states the delegation status when no session can be opened", () => {
    render(<TaskRow {...base} kind="delegation" state="blocked" onOpenDelegation={undefined} />);
    expect(screen.getByText("Needs you")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open session" })).not.toBeInTheDocument();
  });
});
