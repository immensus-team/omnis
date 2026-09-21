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

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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

  // Both circles are gated the way the rail's Account and Settings tiles are (channel-rail.tsx):
  // the destination is D9's — §c.9 itself says the filters button opens the Sheet — so rather than
  // announcing as actionable and doing nothing, they are disabled with the reason in the title.
  // The shared constant is the point: a second literal here could drift from the rail's.
  it("gates both circles with the rail's own reason, and keeps their names", () => {
    render(<BottomBar>{slot()}</BottomBar>);

    for (const name of ["Filters", "Compose"]) {
      const circle = screen.getByRole("button", { name });
      expect(circle).toBeDisabled();
      expect(circle).toHaveAttribute("title", PHASE_B_TITLE);
      // The accessible name is a real word and not the glyph — the icons are decorative.
      expect(circle.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    }
  });
});
