// @vitest-environment jsdom
// 루트 `pnpm test`(vitest.workspace.ts)는 packages/ui/vitest.config.ts를 읽지 않는다.
// 환경과 셋업(jest-dom matchers + afterEach(cleanup))을 파일 자체가 선언한다.
import "./setup";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  type FilterChip,
  FilterChipBar,
  type FilterChipOption,
} from "../src/components/filter-chip-bar";

const OPTIONS: FilterChipOption[] = [
  { id: "l1", label: "Integrations" },
  { id: "l2", label: "Billing" },
];

function addOptions(over: Partial<{ selectedIds: string[]; onToggle: (id: string) => void }> = {}) {
  return {
    fieldLabel: "Label",
    options: OPTIONS,
    selectedIds: [],
    onToggle: vi.fn(),
    ...over,
  };
}

describe("FilterChipBar (US-D02)", () => {
  it("renders each chip's text", () => {
    const chips: FilterChip[] = [
      { id: "channel", fieldLabel: "Channel", text: "Channel is Slack", onRemove: vi.fn() },
      { id: "labels", fieldLabel: "Label", text: "Label is any of 2개 라벨", onRemove: vi.fn() },
    ];
    render(<FilterChipBar chips={chips} />);

    expect(screen.getByText("Channel is Slack")).toBeInTheDocument();
    expect(screen.getByText("Label is any of 2개 라벨")).toBeInTheDocument();
  });

  it("clicking a chip's × calls that chip's onRemove", () => {
    const channel = vi.fn();
    const labels = vi.fn();
    render(
      <FilterChipBar
        chips={[
          { id: "channel", fieldLabel: "Channel", text: "Channel is Slack", onRemove: channel },
          { id: "labels", fieldLabel: "Label", text: "Label is any of 2개 라벨", onRemove: labels },
        ]}
      />,
    );

    // 칩이 둘이면 ×도 둘 — 접근성 이름이 필드명으로 갈려야 어느 쪽인지 고를 수 있다.
    fireEvent.click(screen.getByRole("button", { name: "Channel 필터 제거" }));
    expect(channel).toHaveBeenCalledOnce();
    expect(labels).not.toHaveBeenCalled();
  });

  it("the add trigger opens a popover listing all options, and toggling keeps it open", () => {
    const onToggle = vi.fn();
    render(<FilterChipBar chips={[]} addOptions={addOptions({ onToggle })} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "+ Label" }));

    const popover = screen.getByRole("dialog");
    // placeholder는 필드명을 물려받는다 — 하드코딩된 영어 "Filter…"는 한국어 UI 한가운데
    // 혼자 영어로 남는다(실사용 화면에서 그대로 보였다).
    expect(within(popover).getByPlaceholderText("Label 검색")).toBeInTheDocument();
    expect(within(popover).getByText("Integrations")).toBeInTheDocument();
    expect(within(popover).getByText("Billing")).toBeInTheDocument();

    // 다중 선택: 한 번 고르고 나서도 목록이 살아 있어야 두 번째를 고를 수 있다.
    fireEvent.click(within(popover).getByText("Integrations"));
    expect(onToggle).toHaveBeenCalledWith("l1");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Billing")).toBeInTheDocument();
  });

  it("shows the ✓ only on the selected options", () => {
    render(<FilterChipBar chips={[]} addOptions={addOptions({ selectedIds: ["l1"] })} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Label" }));

    const popover = screen.getByRole("dialog");
    expect(within(popover).getByText("Integrations").previousSibling).toHaveTextContent("✓");
    expect(within(popover).getByText("Billing").previousSibling).toHaveTextContent("");
  });

  it("renders no add trigger when addOptions is omitted", () => {
    render(<FilterChipBar chips={[]} />);
    expect(screen.queryByRole("button", { name: "+ Label" })).not.toBeInTheDocument();
  });
});
