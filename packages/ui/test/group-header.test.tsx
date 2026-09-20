// @vitest-environment jsdom
// 루트 `pnpm test`(vitest.workspace.ts)는 packages/ui/vitest.config.ts를 읽지 않는다.
// 환경과 셋업(jest-dom matchers + afterEach(cleanup))을 파일 자체가 선언한다.
import "./setup";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GroupHeader } from "../src/components/group-header";
import { AgentStatusPill } from "../src/components/status-pill";

describe("GroupHeader (US-D02: 리스트 상태별 그룹 헤더)", () => {
  it("pill은 라벨만, 카운트는 pill 밖 별도 칩이다", () => {
    const { container } = render(
      <GroupHeader pill={<AgentStatusPill state="working" />} count={4} />,
    );
    const pill = container.querySelector(".group-header .status-pill");
    expect(pill).toHaveTextContent("작업 중");
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
      <GroupHeader pill={<AgentStatusPill state="working" />} count={count} />,
    );
    const el = container.querySelector(".group-header__count");
    if (text === null) expect(el).toBeNull();
    else expect(el).toHaveTextContent(text);
  });

  // listbox 안에 행과 섞여 들어가므로 헤더는 옵션으로 세어지면 안 된다.
  it("헤더 래퍼는 role=presentation이다", () => {
    const { container } = render(<GroupHeader pill={<AgentStatusPill state="working" />} />);
    expect(container.querySelector(".group-header")).toHaveAttribute("role", "presentation");
  });

  it("blocked pill은 warning 톤으로 헤더에 온다", () => {
    const { container } = render(<GroupHeader pill={<AgentStatusPill state="blocked" />} />);
    expect(container.querySelector(".group-header .status-pill")).toHaveAttribute(
      "data-tone",
      "warning",
    );
  });

  // 레퍼런스의 "+"는 "여기에 새로 만들 수 있다"는 뜻인데 omnis에는 그룹 상태에 맞춰 세션을
  // 새로 여는 흐름이 없다 — 그래서 헤더는 버튼을 아예 갖지 않는다(죽은 어포던스 금지).
  it("헤더에는 버튼이 없다", () => {
    render(<GroupHeader pill={<AgentStatusPill state="working" />} count={2} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("className은 .group-header에 합쳐진다", () => {
    const { container } = render(
      <GroupHeader pill={<AgentStatusPill state="working" />} className="custom" />,
    );
    expect(container.querySelector(".group-header")).toHaveClass("custom");
  });
});
