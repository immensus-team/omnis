// @vitest-environment jsdom
// 루트 `pnpm test`(vitest.workspace.ts)는 packages/ui/vitest.config.ts를 읽지 않는다.
// 환경과 셋업(jest-dom matchers + afterEach(cleanup))을 파일 자체가 선언한다.
import "./setup";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GroupHeader } from "../src/components/group-header";
import { AgentStatusPill, ApprovalStatusPill } from "../src/components/status-pill";

describe("GroupHeader (US-D02: 리스트 상태별 그룹 헤더)", () => {
  it("pill은 라벨만, 카운트는 pill 밖 별도 칩이다", () => {
    const { container } = render(
      <GroupHeader pill={<ApprovalStatusPill state="pending" />} count={4} />,
    );
    const pill = container.querySelector(".group-header .status-pill");
    expect(pill).toHaveTextContent("대기");
    // 숫자가 pill 안으로 되돌아오면 헤더가 필터 칩과 같은 덩어리로 읽힌다.
    expect(pill).not.toHaveTextContent("4");
    expect(container.querySelector(".group-header__count")).toHaveTextContent("4");
  });

  // 0은 "없음"이 아니라 실제 카운트다 — undefined일 때만 칩을 생략한다.
  it.each([
    [0, "0"],
    [undefined, null],
  ] as const)("count=%s", (count, text) => {
    const { container } = render(
      <GroupHeader pill={<ApprovalStatusPill state="pending" />} count={count} />,
    );
    const el = container.querySelector(".group-header__count");
    if (text === null) expect(el).toBeNull();
    else expect(el).toHaveTextContent(text);
  });

  // listbox 안에 행과 섞여 들어가므로 헤더는 옵션으로 세어지면 안 된다.
  it("헤더 래퍼는 role=presentation이다", () => {
    const { container } = render(<GroupHeader pill={<ApprovalStatusPill state="pending" />} />);
    expect(container.querySelector(".group-header")).toHaveAttribute("role", "presentation");
  });

  it("agent pill도 같은 자리에 온다", () => {
    const { container } = render(<GroupHeader pill={<AgentStatusPill state="blocked" />} />);
    expect(container.querySelector(".group-header .status-pill")).toHaveAttribute(
      "data-tone",
      "danger",
    );
  });

  // + 는 "여기에 새로 만들 수 있다"는 뜻이다. 그런 흐름이 없는 화면에 버튼만 띄우면
  // 눌러도 아무 일이 없는 죽은 어포던스가 된다 — onAdd가 없으면 아예 안 그린다.
  it("onAdd가 없으면 + 버튼을 그리지 않는다", () => {
    render(<GroupHeader pill={<ApprovalStatusPill state="pending" />} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("onAdd를 주면 + 버튼이 생기고 클릭이 onAdd를 부른다", () => {
    const onAdd = vi.fn();
    render(<GroupHeader pill={<ApprovalStatusPill state="pending" />} onAdd={onAdd} />);
    fireEvent.click(screen.getByRole("button", { name: "추가" }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("className은 .group-header에 합쳐진다", () => {
    const { container } = render(
      <GroupHeader pill={<ApprovalStatusPill state="pending" />} className="custom" />,
    );
    expect(container.querySelector(".group-header")).toHaveClass("custom");
  });
});
