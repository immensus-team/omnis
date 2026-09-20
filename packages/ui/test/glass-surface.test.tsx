// @vitest-environment jsdom
// 루트 `pnpm test`(vitest.workspace.ts)는 packages/ui/vitest.config.ts를 읽지 않는다.
// 환경과 셋업(jest-dom matchers + afterEach(cleanup))을 파일 자체가 선언한다.
import "./setup";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
