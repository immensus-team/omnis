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
  // 레퍼런스(ref-issue-tracker-density.webp)의 칩은 한 덩어리 문장이 아니라 채움이 번갈아 드는
  // 칸들이다 — `[▣ Priority][is any of][2 priorities][×]`. 그 구조가 이 컴포넌트의 계약이다.
  it("draws each chip as a field cell and a value cell, not one flat string", () => {
    const chips: FilterChip[] = [
      { id: "channel", field: "Channel", value: "Slack", onRemove: vi.fn() },
      { id: "labels", field: "Label", value: "2개 중 하나", onRemove: vi.fn() },
    ];
    const { container } = render(<FilterChipBar chips={chips} />);

    const cells = [...container.querySelectorAll(".filter-chip")].map((chip) => [
      chip.querySelector(".filter-chip__field")?.textContent,
      chip.querySelector(".filter-chip__value")?.textContent,
    ]);
    expect(cells).toEqual([
      ["Channel", "Slack"],
      ["Label", "2개 중 하나"],
    ]);
  });

  it("clicking a chip's × calls that chip's onRemove", () => {
    const channel = vi.fn();
    const labels = vi.fn();
    render(
      <FilterChipBar
        chips={[
          { id: "channel", field: "Channel", value: "Slack", onRemove: channel },
          { id: "labels", field: "Label", value: "2개 중 하나", onRemove: labels },
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

  // 레퍼런스의 필터 팝오버 입력은 맨 왼쪽에 돋보기가 서고 아래 헤어라인 한 줄이 목록을
  // 끊는다. 그 크롬이 없으면 placeholder가 목록 위에 맨몸으로 떠 입력칸으로 안 읽힌다.
  it("gives the popover input a search glyph and a rule above the list", () => {
    render(<FilterChipBar chips={[]} addOptions={addOptions()} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Label" }));

    const search = screen.getByRole("dialog").querySelector(".filter-chip-popover__search");
    expect(search).not.toBeNull();
    expect(search?.querySelector("svg")).not.toBeNull();
    expect(search?.contains(screen.getByPlaceholderText("Label 검색"))).toBe(true);
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
