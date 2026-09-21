// @vitest-environment jsdom
// US-D08 §c.9: the narrow tier's BottomBar. The geometry (the 44px circle, the pill's --bar-h, the
// two-bar stacking maths) is asserted against app.css by apps/desktop/test/app-shell.test.tsx,
// because that is where the numbers live; this file drives what the component itself has to be true
// — the circle and the shell's slot on one line, and a circle that says what it is.
//
// loop-r2-03/NC2-03: the 52px compose circle is gone. It was never a control — a new message needs a
// recipient picker that does not exist — so what it said on hover was a roadmap phase, and the ask
// pill behind it is what a phone actually needs on this line.
//
// The root `pnpm test` (vitest.workspace.ts) does not read packages/ui/vitest.config.ts, so the
// environment and setup are declared by the file itself.
import "./setup";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BottomBar } from "../src/components/bottom-bar";

/** The bar's other piece, as the shell renders it. */
function slot() {
  return <div className="ask-bar" data-testid="slot" />;
}

function pieceClasses(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".bottom-bar > *")].map(
    (el) => el.className.split(" ")[0] as string,
  );
}

describe("BottomBar (US-D08 §c.9)", () => {
  it("puts filters and the shell's slot on one line, and nothing else", () => {
    const { container } = render(<BottomBar>{slot()}</BottomBar>);

    expect(pieceClasses(container)).toEqual(["bottom-bar__piece", "ask-bar"]);
    // The other piece is the shell's, not a second search field of the bar's own.
    expect(screen.getByTestId("slot")).toBeInTheDocument();
    // NC2-03: no compose circle. Asserted as an absence rather than left to the count above, because
    // "the bar has two children" would also pass with the circle and no pill.
    expect(screen.queryByRole("button", { name: "Compose" })).toBeNull();
    expect(container.querySelector(".bottom-bar__piece--compose")).toBeNull();
  });

  // §c.9: "44px circular glass button". The size is in app.css; what has to be true in the DOM is
  // that the class the size hangs off is on the circle, and that it is glass like the rail's pieces.
  it("gives the circle its glass and its slot", () => {
    render(<BottomBar>{slot()}</BottomBar>);
    const filters = screen.getByRole("button", { name: "Filters" });

    expect(filters).toHaveClass("bottom-bar__piece");
    expect(filters).toHaveClass("glass-surface");
    expect(filters).toHaveAttribute("data-glass-slot", "toolbar");
    // The accessible name is a real word and not the glyph — the icon is decoration (§e guard 9).
    expect(filters.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  // loop-r2-03: the tooltip is the plain noun (§e guard 12). It used to be the shared "not wired up
  // yet — Phase B" string whenever the shell handed in no sheet, which named a build phase instead
  // of the control; that string is gone from the product, so this is the one title the circle has.
  it("names the circle in both states", () => {
    const { unmount } = render(<BottomBar>{slot()}</BottomBar>);
    expect(screen.getByRole("button", { name: "Filters" })).toHaveAttribute("title", "Filters");
    unmount();

    render(<BottomBar onOpenFilters={vi.fn()}>{slot()}</BottomBar>);
    expect(screen.getByRole("button", { name: "Filters" })).toHaveAttribute("title", "Filters");
  });

  // §c.6/M125: with the sheet handed in, the circle is a control — enabled and it opens the sheet.
  it("opens the filters sheet when the shell hands it one", () => {
    const onOpenFilters = vi.fn();
    render(<BottomBar onOpenFilters={onOpenFilters}>{slot()}</BottomBar>);

    const filters = screen.getByRole("button", { name: "Filters" });
    expect(filters).toBeEnabled();
    fireEvent.click(filters);
    expect(onOpenFilters).toHaveBeenCalledOnce();
  });

  // A caller that hands in no sheet gets no control: disabled, with the name but nothing behind it.
  it("gates the circle when the shell handed it no sheet", () => {
    render(<BottomBar>{slot()}</BottomBar>);
    expect(screen.getByRole("button", { name: "Filters" })).toBeDisabled();
  });
});
