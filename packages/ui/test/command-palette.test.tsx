// @vitest-environment jsdom
// 루트 `pnpm test`(vitest.workspace.ts)는 packages/ui/vitest.config.ts를 읽지 않는다.
// 환경과 셋업(jest-dom matchers + afterEach(cleanup))을 파일 자체가 선언한다.
import "./setup";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CommandPalette, type PaletteAction, groupBy } from "../src/components/command-palette";

describe("groupBy", () => {
  it("groups items by the given key function", () => {
    const grouped = groupBy(
      [
        { g: "a", v: 1 },
        { g: "b", v: 2 },
        { g: "a", v: 3 },
      ],
      (x) => x.g,
    );
    expect(grouped).toEqual({
      a: [
        { g: "a", v: 1 },
        { g: "a", v: 3 },
      ],
      b: [{ g: "b", v: 2 }],
    });
  });
});

describe("CommandPalette (A5 §2.3)", () => {
  it("renders grouped actions and calls perform() + closes on select", () => {
    const perform = vi.fn();
    const onOpenChange = vi.fn();
    const actions: PaletteAction[] = [
      { id: "go-inbox", name: "Go to Inbox", group: "이동", perform },
    ];
    render(<CommandPalette open onOpenChange={onOpenChange} actions={actions} />);
    fireEvent.click(screen.getByText("Go to Inbox"));
    expect(perform).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
