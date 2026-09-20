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

describe('CommandPalette mode="inline" (U1 kinso ask/search 필 바)', () => {
  it("shows the kinso placeholder and no dropdown list while closed", () => {
    render(<CommandPalette mode="inline" open={false} onOpenChange={vi.fn()} actions={[]} />);
    expect(screen.getByPlaceholderText("Start typing to ask or search")).toBeInTheDocument();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("typing into the pill opens the palette (onOpenChange(true))", () => {
    const onOpenChange = vi.fn();
    render(<CommandPalette mode="inline" open={false} onOpenChange={onOpenChange} actions={[]} />);
    fireEvent.change(screen.getByPlaceholderText("Start typing to ask or search"), {
      target: { value: "s" },
    });
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("focusing the pill also opens the palette", () => {
    const onOpenChange = vi.fn();
    render(<CommandPalette mode="inline" open={false} onOpenChange={onOpenChange} actions={[]} />);
    fireEvent.focus(screen.getByPlaceholderText("Start typing to ask or search"));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("when open, renders the same grouped actions as the dialog mode does", () => {
    const perform = vi.fn();
    const actions: PaletteAction[] = [
      { id: "go-inbox", name: "Go to Inbox", group: "이동", perform },
    ];
    render(<CommandPalette mode="inline" open onOpenChange={vi.fn()} actions={actions} />);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Go to Inbox"));
    expect(perform).toHaveBeenCalledOnce();
  });
});

describe('CommandPalette mode="inline" 닫기 경로 (U1 회귀)', () => {
  it("Escape closes the inline dropdown", () => {
    const onOpenChange = vi.fn();
    render(<CommandPalette mode="inline" open onOpenChange={onOpenChange} actions={[]} />);
    fireEvent.keyDown(screen.getByPlaceholderText("Start typing to ask or search"), {
      key: "Escape",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("a pointerdown outside the pill closes the inline dropdown", () => {
    const onOpenChange = vi.fn();
    render(<CommandPalette mode="inline" open onOpenChange={onOpenChange} actions={[]} />);
    fireEvent.pointerDown(document.body);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("a pointerdown inside the palette does not close it (선택 클릭이 살아 있어야 한다)", () => {
    const onOpenChange = vi.fn();
    const actions: PaletteAction[] = [
      { id: "go-inbox", name: "Go to Inbox", group: "이동", perform: vi.fn() },
    ];
    render(<CommandPalette mode="inline" open onOpenChange={onOpenChange} actions={actions} />);
    fireEvent.pointerDown(screen.getByText("Go to Inbox"));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("does not listen while closed", () => {
    const onOpenChange = vi.fn();
    render(<CommandPalette mode="inline" open={false} onOpenChange={onOpenChange} actions={[]} />);
    fireEvent.pointerDown(document.body);
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
