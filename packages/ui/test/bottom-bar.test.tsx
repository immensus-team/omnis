// @vitest-environment jsdom
// US-D08 §c.9: the narrow tier's BottomBar. The geometry (44/52px, the two-bar stacking maths) is
// asserted against app.css by apps/desktop/test/app-shell.test.tsx, because that is where the
// numbers live; this file drives what the component itself has to be true — three pieces in one
// line, the middle one the shell's, and two circles that say what they are without being pressable
// yet.
//
// The root `pnpm test` (vitest.workspace.ts) does not read packages/ui/vitest.config.ts, so the
// environment and setup are declared by the file itself.
import "./setup";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BottomBar } from "../src/components/bottom-bar";
import { PHASE_B_TITLE } from "../src/components/channel-rail";

/** The bar's middle piece, as the shell renders it. */
function slot() {
  return <div className="ask-bar" data-testid="slot" />;
}

function pieceClasses(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".bottom-bar > *")].map(
    (el) => el.className.split(" ")[0] as string,
  );
}

describe("BottomBar (US-D08 §c.9)", () => {
  it("puts filters, the shell's slot and compose on one line in that order", () => {
    const { container } = render(<BottomBar>{slot()}</BottomBar>);

    expect(pieceClasses(container)).toEqual(["bottom-bar__piece", "ask-bar", "bottom-bar__piece"]);
    // The middle piece is the shell's, not a second search field of the bar's own.
    expect(screen.getByTestId("slot")).toBeInTheDocument();
  });

  // §c.9: "44px circular glass button … 52px circular glass button". The sizes are in app.css; what
  // has to be true in the DOM is that the class the sizes hang off is on the circle each time, and
  // that only the compose one adds its modifier.
  it("gives each circle its glass and marks only the compose piece as the larger one", () => {
    const { container } = render(<BottomBar>{slot()}</BottomBar>);
    const [filters, compose] = [
      screen.getByRole("button", { name: "Filters" }),
      screen.getByRole("button", { name: "Compose" }),
    ];

    for (const circle of [filters, compose]) {
      expect(circle).toHaveClass("bottom-bar__piece");
      expect(circle).toHaveClass("glass-surface");
      expect(circle).toHaveAttribute("data-glass-slot", "toolbar");
    }
    expect(container.querySelectorAll(".bottom-bar__piece--compose")).toHaveLength(1);
    expect(compose).toHaveClass("bottom-bar__piece--compose");
    expect(filters).not.toHaveClass("bottom-bar__piece--compose");
  });

  // A circle with no destination is gated the way the rail's Account and Settings tiles are
  // (channel-rail.tsx): disabled, with the reason in the title rather than announced as actionable
  // and doing nothing. US-D09 gave Filters its destination (§c.6's sheet) and Compose still has
  // none, so this is now one of each — and the shared constant is the point, since a second literal
  // here could drift from the rail's.
  it("gates the circle the shell gave nothing to, and keeps both names", () => {
    render(<BottomBar>{slot()}</BottomBar>);

    const compose = screen.getByRole("button", { name: "Compose" });
    expect(compose).toBeDisabled();
    expect(compose).toHaveAttribute("title", PHASE_B_TITLE);

    for (const name of ["Filters", "Compose"]) {
      // The accessible name is a real word and not the glyph — the icons are decorative.
      expect(screen.getByRole("button", { name }).querySelector("svg")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
    }
  });

  // §c.6/M125: with the sheet handed in, the circle is a control — enabled, named the same way, and
  // it opens the sheet rather than a tooltip about Phase B.
  it("opens the filters sheet when the shell hands it one", () => {
    const onOpenFilters = vi.fn();
    render(<BottomBar onOpenFilters={onOpenFilters}>{slot()}</BottomBar>);

    const filters = screen.getByRole("button", { name: "Filters" });
    expect(filters).toBeEnabled();
    expect(filters).toHaveAttribute("title", "Filters");
    fireEvent.click(filters);
    expect(onOpenFilters).toHaveBeenCalledOnce();
  });
});
