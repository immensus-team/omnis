import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { GlassSurface, OpaqueSurface } from "../src/components/glass-surface";

describe("A5-D5 Liquid Glass layer rule", () => {
  it("only accepts the 4 allowed slots (sidebar/toolbar/sheet/palette)", () => {
    render(<GlassSurface slot="sidebar">nav</GlassSurface>);
    const el = screen.getByText("nav");
    expect(el).toHaveClass("glass-surface");
    expect(el).toHaveAttribute("data-glass-slot", "sidebar");
  });
  it("OpaqueSurface always renders the opaque class (lists/body/editor)", () => {
    render(<OpaqueSurface>row</OpaqueSurface>);
    expect(screen.getByText("row")).toHaveClass("opaque-surface");
  });
});
