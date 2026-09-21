// @vitest-environment jsdom
// US-D09 §c.6: the Sheet. The root `pnpm test` (vitest.workspace.ts) does not read
// packages/ui/vitest.config.ts, so the environment and setup are declared by the file itself.
import "./setup";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NARROW_DRAWER_SNAP_POINTS } from "../src/components/narrow-drawer";
import { SHEET_DISMISS_PX, Sheet, SheetCheck, SheetGroup, SheetRow } from "../src/components/sheet";

/** The two tiers, because the sheet now has one implementation each. `useNarrowShell` reads
 *  `window.matchMedia` — the same limitation channel-rail.test.tsx and inbox-row-swipe.test.tsx
 *  work around — so "which tier is this test" is decided by this stub and nothing else. */
const REAL_MATCH_MEDIA = window.matchMedia;
function stubTier(narrow: boolean): void {
  window.matchMedia = (() => ({
    matches: narrow,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}
afterEach(() => {
  window.matchMedia = REAL_MATCH_MEDIA;
});

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

describe("Sheet (US-D09 §c.6) — the wide tier, the hand-rolled dialog", () => {
  // The wide tier is the default the whole file used to be; it is stated rather than assumed
  // because the stub is now per-test and a missing one would quietly run these against `vaul`.
  beforeEach(() => stubTier(false));

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

describe("Sheet, the narrow tier — vaul's drawer (motion-OSS S5)", () => {
  beforeEach(() => stubTier(true));

  // What the tier switch buys is the mechanism, and the mechanism is `vaul`'s only at the narrow
  // tier: the wide dialog above must not have grown a drawer underneath it. One assertion, and it
  // is the whole "desktop untouched" claim.
  it("is a dialog and not a drawer above the breakpoint", () => {
    stubTier(false);
    render(<Harness />);
    expect(openSheet().hasAttribute("data-vaul-drawer")).toBe(false);
  });

  it("is vaul's drawer below it, and is still the same glass dialog", () => {
    render(<Harness />);
    const dialog = openSheet();
    // The drawer's own attributes are on the dialog itself because `Drawer.Content asChild` hands
    // them to the `GlassSurface` through Radix's Slot — which is why that component forwards a ref.
    expect(dialog.hasAttribute("data-vaul-drawer")).toBe(true);
    expect(dialog.getAttribute("data-vaul-drawer-direction")).toBe("bottom");
    expect(dialog).toHaveClass("glass-surface");
    expect(dialog).toHaveAttribute("data-glass-slot", "sheet");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Filters");
  });

  // The brief's "snap points [0.5, 0.92]", asserted where it is observable: `vaul` writes the
  // active rest point to --snap-point-height, and for a bottom drawer that is a *translate* of
  // `viewport - snap * viewport`. At the opening snap point of 0.5 that is half the viewport, so
  // the assertion is "the sheet opens covering half the screen" — which is the M125 behaviour the
  // number is there for, not the number itself.
  it("opens at the half-height snap point and offers the second one", () => {
    expect([...NARROW_DRAWER_SNAP_POINTS]).toEqual([0.5, 0.92]);
    render(<Harness />);
    const dialog = openSheet();
    expect(dialog.getAttribute("data-vaul-snap-points")).toBe("true");
    expect(dialog.style.getPropertyValue("--snap-point-height")).toBe(
      `${window.innerHeight - 0.5 * window.innerHeight}px`,
    );
  });

  // The drag is the one thing this tier hands over that jsdom cannot follow: `vaul` measures the
  // drawer's height and the pointer's velocity to decide where a release settles, and jsdom has no
  // layout, so every measurement is 0 and a synthetic gesture moves nothing (probed). The evidence
  // for it is the browser sequence in docs/design/screens/motion-oss/, not this file — what this
  // file can say is that the handle exists and that it is `vaul`'s.
  it("gives the drag to a grabber, and the grabber is the only handle", () => {
    render(<Harness />);
    const dialog = openSheet();
    const handle = dialog.querySelector("[data-vaul-handle]");
    expect(handle).not.toBeNull();
    // `handleOnly` is what keeps the body's own scroll: the header and the list are not handles,
    // and the only element that is carries vaul's hit area rather than being one itself.
    expect(dialog.querySelectorAll("[data-vaul-handle]")).toHaveLength(1);
    expect(handle?.querySelector("[data-vaul-handle-hitarea]")).not.toBeNull();
  });

  it("still never nests one glass surface inside another (ACCENT §4.4)", () => {
    render(<Harness />);
    openSheet();
    expect(document.querySelectorAll(".glass-surface .glass-surface")).toHaveLength(0);
    expect(screen.getByText("All").closest(".glass-surface")).toBe(screen.getByRole("dialog"));
  });

  // Escape, the trap and the return-to-trigger are Radix's here rather than `focus-trap.ts`'s —
  // which is the point of the port, so they are asserted through the same three behaviours the wide
  // tier's tests assert rather than against Radix's internals.
  // Escape is Radix's here, and so is the return-to-trigger — but the return lands a task later
  // than the wide tier's, which is why this one awaits and that one does not. Radix dispatches its
  // close-autofocus from a `setTimeout(…, 0)` *after* the focus scope's own listeners are gone; a
  // restore attempted during React's mutation phase is pulled straight back into the panel by the
  // scope's still-attached `focusout` listener (probed). The wait is the behaviour, not test
  // slop.
  it("Escape closes it and focus comes back to the button that opened it", async () => {
    const onOpenChange = vi.fn();
    render(<Harness onOpenChange={onOpenChange} />);
    const trigger = screen.getByRole("button", { name: "Filters" });
    press(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(document.activeElement).not.toBe(trigger);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("moves focus onto the header's own button on open", () => {
    render(<Harness />);
    openSheet();
    // `vaul`'s `autoFocus` defaults to *off* and prevents Radix's mount autofocus when it is off;
    // the sheet passes it, and this is what turns the prop into a claim.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Done" }));
  });

  it("traps Tab: the last control wraps to the first, Shift+Tab the other way", () => {
    render(<Harness />);
    openSheet();
    const done = screen.getByRole("button", { name: "Done" });
    const all = screen.getByRole("button", { name: "All" });
    const work = screen.getByRole("button", { name: "Work" });
    fireEvent.keyDown(work, { key: "Tab" });
    expect(document.activeElement).toBe(done);
    fireEvent.keyDown(done, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(work);
    // An ordinary Tab in the middle is the browser's: it must not be rewritten into a wrap.
    fireEvent.keyDown(done, { key: "Tab" });
    expect(document.activeElement).toBe(done);
    expect(all).toBeInTheDocument();
  });

  it("closes on a click outside the panel and not on a click inside it", () => {
    const onOpenChange = vi.fn();
    render(<Harness onOpenChange={onOpenChange} />);
    openSheet();
    fireEvent.click(screen.getByText("All"));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    fireEvent.click(document.querySelector(".sheet-overlay") as HTMLElement);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("confirms and closes in one press", () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    openSheet();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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
