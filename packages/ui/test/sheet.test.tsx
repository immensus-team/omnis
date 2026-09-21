// @vitest-environment jsdom
// US-D09 §c.6: the Sheet. The root `pnpm test` (vitest.workspace.ts) does not read
// packages/ui/vitest.config.ts, so the environment and setup are declared by the file itself.
import "./setup";

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { SHEET_DISMISS_PX, Sheet, SheetCheck, SheetGroup, SheetRow } from "../src/components/sheet";

/** A trigger plus the sheet, wired the way every real caller wires it (the BottomBar's filters
 *  button in Inbox.tsx): the trigger owns `open`, so "focus returns to the trigger" is testable
 *  without the test reaching into the component. */
function Harness({
  onOpenChange = vi.fn(),
  onConfirm,
  withConfirm = true,
}: {
  onOpenChange?: (open: boolean) => void;
  onConfirm?: () => void;
  withConfirm?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const change = (next: boolean) => {
    setOpen(next);
    onOpenChange(next);
  };
  return (
    <>
      <button type="button" onClick={() => change(true)}>
        Filters
      </button>
      <Sheet
        open={open}
        onOpenChange={change}
        title="Filters"
        {...(withConfirm ? { confirm: { label: "Done", onConfirm: onConfirm ?? vi.fn() } } : {})}
      >
        <SheetGroup label="Show">
          <SheetRow trailing={<SheetCheck checked />} onClick={vi.fn()}>
            All
          </SheetRow>
          <SheetRow onClick={vi.fn()}>Work</SheetRow>
        </SheetGroup>
      </Sheet>
    </>
  );
}

/** jsdom's `click` does not move focus the way a real press does (a browser focuses a button on
 *  mousedown, jsdom never does), so the trigger is focused first. Without it the sheet's
 *  return-focus target is <body> and the assertion is testing jsdom's gap rather than the
 *  component. */
function press(element: HTMLElement): void {
  element.focus();
  fireEvent.click(element);
}

function openSheet(): HTMLElement {
  press(screen.getByRole("button", { name: "Filters" }));
  return screen.getByRole("dialog");
}

describe("Sheet (US-D09 §c.6)", () => {
  it("renders nothing until it is open, and is a modal dialog when it is", () => {
    render(<Harness />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const dialog = openSheet();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Filters");
    expect(dialog).toHaveClass("glass-surface");
    expect(dialog).toHaveAttribute("data-glass-slot", "sheet");
  });

  it("never nests one glass surface inside another (ACCENT §4.4)", () => {
    render(<Harness />);
    // The dialog itself is glass; everything under it — the group card, the rows — must not be.
    // `closest` from each descendant is the check that would catch a group card that grew the
    // class back, which a bare querySelectorAll would miss.
    openSheet();
    expect(document.querySelectorAll(".glass-surface .glass-surface")).toHaveLength(0);
    expect(screen.getByText("All").closest(".glass-surface")).toBe(screen.getByRole("dialog"));
  });

  it("Escape closes it and focus comes back to the button that opened it", () => {
    const onOpenChange = vi.fn();
    render(<Harness onOpenChange={onOpenChange} />);
    const trigger = screen.getByRole("button", { name: "Filters" });
    press(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // Focus moved in on open rather than staying behind on the trigger.
    expect(document.activeElement).not.toBe(trigger);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it("traps Tab: the last control wraps to the first, Shift+Tab the other way", () => {
    render(<Harness />);
    openSheet();
    const confirm = screen.getByRole("button", { name: "Done" });
    const all = screen.getByRole("button", { name: "All" });
    const work = screen.getByRole("button", { name: "Work" });
    // DOM order is confirm (header) then the two rows, so the trap's ends are `confirm` and `work`.
    expect(document.activeElement).toBe(confirm);
    fireEvent.keyDown(work, { key: "Tab" });
    expect(document.activeElement).toBe(confirm);
    fireEvent.keyDown(confirm, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(work);
    // And an ordinary Tab in the middle is left to the browser — the trap must not rewrite it.
    fireEvent.keyDown(confirm, { key: "Tab" });
    expect(document.activeElement).toBe(confirm);
    expect(all).toBeInTheDocument();
  });

  it("confirms and closes in one press, with the ✕ only when there is no confirm", () => {
    const onConfirm = vi.fn();
    const { rerender } = render(<Harness onConfirm={onConfirm} />);
    openSheet();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // The no-confirm header is closed by the ✕ on the left instead — two ways out of one header is
    // one too many, so the two never appear together.
    rerender(<Harness withConfirm={false} />);
    press(screen.getByRole("button", { name: "Filters" }));
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
  });

  it("dismisses on a downward drag past the threshold and springs back under it", () => {
    const onOpenChange = vi.fn();
    render(<Harness onOpenChange={onOpenChange} />);
    const dialog = openSheet();
    // The header is the drag handle — the body has the sheet's own scroll to keep.
    const handle = dialog.querySelector(".sheet__header") as HTMLElement;
    const drag = (dy: number) => {
      fireEvent.pointerDown(handle, { button: 0, pointerId: 1, pointerType: "mouse", clientY: 0 });
      fireEvent.pointerMove(window, { pointerId: 1, clientY: dy });
      fireEvent.pointerUp(window, { pointerId: 1, clientY: dy });
    };
    drag(SHEET_DISMISS_PX - 8);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    drag(SHEET_DISMISS_PX + 8);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes on a click outside the panel and not on a click inside it", () => {
    const onOpenChange = vi.fn();
    render(<Harness onOpenChange={onOpenChange} />);
    const dialog = openSheet();
    fireEvent.click(screen.getByText("All"));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    fireEvent.click(dialog.parentElement as HTMLElement);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("SheetGroup / SheetRow (US-D09 §c.6)", () => {
  it("a row without an action is not a button", () => {
    render(
      <SheetGroup label="Total">
        <SheetRow>3 threads</SheetRow>
      </SheetGroup>,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("3 threads")).toBeInTheDocument();
  });

  it("carries its own selection semantics when it has one", () => {
    render(
      // biome-ignore lint/a11y/useSemanticElements: what is under test is that SheetRow hands the role through to a button; a real <input type="radio"> would assert the opposite of the component's contract.
      <SheetRow role="radio" checked onClick={() => {}}>
        All
      </SheetRow>,
    );
    expect(screen.getByRole("radio", { name: "All" })).toHaveAttribute("aria-checked", "true");
  });
});
