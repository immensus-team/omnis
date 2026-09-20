// @vitest-environment jsdom
// 루트 `pnpm test`(vitest.workspace.ts)는 packages/ui/vitest.config.ts를 읽지 않는다.
// 환경과 셋업(jest-dom matchers + afterEach(cleanup))을 파일 자체가 선언한다.
import "./setup";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette, type PaletteAction, groupBy } from "../src/components/command-palette";
import {
  ASK_MODEL_STORAGE_KEY,
  type AskModelId,
  DEFAULT_ASK_MODEL,
  askModelLabel,
  writeAskModel,
} from "../src/lib/ask-model";

/** US-D01부터 패널의 기본 탭은 "제안"이다 — 명령 목록은 "명령" 탭 뒤에 있다. */
const openCommandsTab = () => fireEvent.click(screen.getByRole("button", { name: "명령" }));

/** 리터럴로 두되 AskModelId로 좁혀 오타가 컴파일에서 걸리게 한다. */
const FLASH_ID: AskModelId = "deepseek-v4.1-flash";

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

  it("mounts the AI 패널 dialog only while open (US-D01)", () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <CommandPalette mode="inline" open={false} onOpenChange={onOpenChange} actions={[]} />,
    );
    expect(screen.queryByRole("dialog", { name: "AI 패널" })).not.toBeInTheDocument();

    rerender(<CommandPalette mode="inline" open onOpenChange={onOpenChange} actions={[]} />);
    expect(screen.getByRole("dialog", { name: "AI 패널" })).toBeInTheDocument();
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
    openCommandsTab();
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
    openCommandsTab();
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

describe('CommandPalette mode="inline" 모델 선택기 영속성 (US-D01)', () => {
  // test/setup.ts의 메모리 Storage는 파일 단위로 살아남는다 — 테스트 사이에 비운다.
  beforeEach(() => localStorage.clear());

  it("pick swaps the toggle label and writes the id to localStorage", () => {
    render(<CommandPalette mode="inline" open onOpenChange={vi.fn()} actions={[]} />);

    const toggle = screen.getByRole("button", { name: askModelLabel(DEFAULT_ASK_MODEL) });
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: askModelLabel(FLASH_ID) }));

    expect(toggle).toHaveTextContent(askModelLabel(FLASH_ID));
    expect(localStorage.getItem(ASK_MODEL_STORAGE_KEY)).toBe(FLASH_ID);
  });

  it("starts on the stored model", () => {
    writeAskModel(FLASH_ID);
    render(<CommandPalette mode="inline" open onOpenChange={vi.fn()} actions={[]} />);

    expect(screen.getByRole("button", { name: askModelLabel(FLASH_ID) })).toBeInTheDocument();
  });
});

const askInput = () => screen.getByPlaceholderText("Start typing to ask or search");

describe('CommandPalette mode="inline" 타이핑 경로 (US-D01 회귀)', () => {
  const actions: PaletteAction[] = [
    { id: "go-inbox", name: "Go to Inbox", group: "이동", perform: vi.fn() },
  ];

  it("typing reaches the cmdk list without clicking the 명령 tab", () => {
    render(<CommandPalette mode="inline" open onOpenChange={vi.fn()} actions={actions} />);
    // 타이핑 전에는 제안 탭 — 명령 목록은 아직 없다.
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    fireEvent.change(askInput(), { target: { value: "Inbox" } });

    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getByText("Go to Inbox")).toBeInTheDocument();
  });

  it('a leading ">" also lands on the 명령 tab', () => {
    render(<CommandPalette mode="inline" open onOpenChange={vi.fn()} actions={actions} />);
    fireEvent.change(askInput(), { target: { value: ">" } });
    expect(screen.getByRole("button", { name: "명령" })).toHaveAttribute("aria-pressed", "true");
  });

  it("clearing the query returns to the 제안 tab", () => {
    render(<CommandPalette mode="inline" open onOpenChange={vi.fn()} actions={actions} />);
    fireEvent.change(askInput(), { target: { value: "Inbox" } });
    fireEvent.change(askInput(), { target: { value: "" } });
    expect(screen.getByRole("button", { name: "답장 초안 작성" })).toBeInTheDocument();
  });
});

describe('CommandPalette mode="inline" @ 멘션 어포던스 (US-D01)', () => {
  it("is present before any @ is typed and inserts one into the input", () => {
    render(<CommandPalette mode="inline" open onOpenChange={vi.fn()} actions={[]} />);
    expect(screen.queryByText("@ 멘션")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "멘션 추가" }));

    expect(askInput()).toHaveValue("@");
    expect(screen.getByText("@ 멘션")).toBeInTheDocument();
  });
});

describe('CommandPalette mode="inline" 닫힘 스프링 (US-D01)', () => {
  afterEach(() => vi.useRealTimers());

  it("keeps the panel mounted for one --dur-panel so the close animation can play", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <CommandPalette mode="inline" open onOpenChange={vi.fn()} actions={[]} />,
    );
    rerender(<CommandPalette mode="inline" open={false} onOpenChange={vi.fn()} actions={[]} />);

    expect(screen.getByRole("dialog", { name: "AI 패널" })).toHaveClass("ask-panel--closing");

    act(() => vi.advanceTimersByTime(240));
    expect(screen.queryByRole("dialog", { name: "AI 패널" })).not.toBeInTheDocument();
  });
});
