// @vitest-environment jsdom
// US-D09 §c.8: the inline confirmation. Setup is declared by the file (see sheet.test.tsx).
import "./setup";

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { CONFIRM_COPY, ConfirmPrompt } from "../src/components/confirm-prompt";

function Harness({
  destructive,
  onConfirm = vi.fn(),
}: {
  destructive?: boolean;
  onConfirm?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { title, body } = CONFIRM_COPY.archiveThreads(3);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Archive all shown
      </button>
      <ConfirmPrompt
        open={open}
        onOpenChange={setOpen}
        title={title}
        body={body}
        confirmLabel="Archive"
        {...(destructive ? { destructive: true } : {})}
        onConfirm={onConfirm}
      />
    </>
  );
}

/** See sheet.test.tsx's `press`: jsdom's `click` never focuses the button it fires on, so the
 *  trigger is focused by hand or the return-focus assertion tests jsdom rather than the component. */
function press(element: HTMLElement): void {
  element.focus();
  fireEvent.click(element);
}

function openPrompt(): HTMLElement {
  press(screen.getByRole("button", { name: "Archive all shown" }));
  return screen.getByRole("alertdialog");
}

describe("ConfirmPrompt (US-D09 §c.8)", () => {
  it("is a glass card over a dimmed backdrop, titled with the whole question", () => {
    render(<Harness />);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    const prompt = openPrompt();
    expect(prompt).toHaveClass("glass-surface");
    expect(prompt).toHaveAttribute("data-glass-slot", "sheet");
    expect(prompt).toHaveAccessibleName("Archive 3 threads?");
    expect(prompt).toHaveAccessibleDescription(/stay in Archived/);
  });

  it("pluralises the count, and never counts one thread as threads", () => {
    expect(CONFIRM_COPY.archiveThreads(3).title).toBe("Archive 3 threads?");
    expect(CONFIRM_COPY.archiveThreads(1).title).toBe("Archive 1 thread?");
    expect(CONFIRM_COPY.approve("Send the NDA to Northwind legal?").title).toBe(
      "Approve this action?",
    );
  });

  it("never nests one glass surface inside another (ACCENT §4.4)", () => {
    render(<Harness />);
    openPrompt();
    expect(document.querySelectorAll(".glass-surface .glass-surface")).toHaveLength(0);
  });

  it("confirms once and comes back with focus on its trigger", () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    const trigger = screen.getByRole("button", { name: "Archive all shown" });
    press(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it("cancel closes it without confirming, and Escape does the same", () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    openPrompt();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    openPrompt();
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("orders the two pills cancel-then-confirm, which is what makes the wrap stack confirm on top", () => {
    render(<Harness />);
    openPrompt();
    const actions = document.querySelector(".confirm-prompt__actions") as HTMLElement;
    const labels = [...actions.querySelectorAll("button")].map((b) => b.textContent);
    // CSS pairs this order with `flex-wrap: wrap-reverse`, whose first line lands at the cross-end:
    // swapping the two here would silently put the cancel button on top instead.
    expect(labels).toEqual(["Cancel", "Archive"]);
  });

  it("marks a destructive confirm so the pill can leave the accent", () => {
    render(<Harness destructive />);
    openPrompt();
    expect(screen.getByRole("button", { name: "Archive" })).toHaveAttribute(
      "data-destructive",
      "true",
    );
  });
});
