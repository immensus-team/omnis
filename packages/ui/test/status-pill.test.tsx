// @vitest-environment jsdom
// 루트 `pnpm test`(vitest.workspace.ts)는 packages/ui/vitest.config.ts를 읽지 않는다.
// 환경과 셋업(jest-dom matchers + afterEach(cleanup))을 파일 자체가 선언한다.
import "./setup";

import { render, screen } from "@testing-library/react";
import { Clock } from "lucide-react";
import { describe, expect, it } from "vitest";
import { AgentStatusPill, ApprovalStatusPill, StatusPill } from "../src/components/status-pill";

describe("ApprovalStatusPill (approval 라이프사이클 표시 상태)", () => {
  // failed/responded가 따로 있는 게 이 테이블의 요점이다: 내가 승인한 건의 실행 실패와
  // 역제안을 "거절됨"에 접으면 사용자가 하지 않은 행동을 했다고 말하게 된다.
  it.each([
    ["pending", "대기", "warning"],
    ["approved", "승인됨", "success"],
    ["rejected", "거절됨", "danger"],
    ["responded", "역제안", "info"],
    ["failed", "실패", "danger"],
    ["expired", "만료", "neutral"],
  ] as const)("%s → %s / tone %s", (state, label, tone) => {
    render(<ApprovalStatusPill state={state} />);
    const pill = screen.getByText(label);
    expect(pill).toHaveClass("status-pill");
    expect(pill).toHaveAttribute("data-tone", tone);
  });
});

describe("AgentStatusPill (agent session 5상태)", () => {
  it.each([
    ["idle", "대기", "neutral"],
    ["working", "작업 중", "info"],
    ["blocked", "확인 필요", "danger"],
    ["done", "완료", "success"],
    ["failed", "실패", "danger"],
  ] as const)("%s → %s / tone %s", (state, label, tone) => {
    render(<AgentStatusPill state={state} />);
    const pill = screen.getByText(label);
    expect(pill).toHaveClass("status-pill");
    expect(pill).toHaveAttribute("data-tone", tone);
  });
});

describe("카운트는 pill이 그리지 않는다", () => {
  // 레퍼런스에서 숫자는 pill 밖 별도 회색 칩이다(GroupHeader.__count). pill 안에 숫자를 다시
  // 넣으면 헤더가 필터 칩 줄과 같은 크기의 칩 하나로 뭉개진다 — 그 회귀를 여기서 막는다.
  it("pill 안에는 숫자 슬롯이 없다", () => {
    const { container } = render(<ApprovalStatusPill state="pending" />);
    expect(container.querySelector(".status-pill__count")).toBeNull();
  });
});

describe("StatusPill 기본형", () => {
  it("dot 기본값은 true — 점을 그리고 라벨 앞에 둔다", () => {
    const { container } = render(<StatusPill tone="info" label="작업 중" />);
    expect(container.querySelector(".status-pill__dot")).toBeInTheDocument();
  });

  it("dot={false}면 점을 그리지 않는다", () => {
    const { container } = render(<StatusPill tone="info" label="작업 중" dot={false} />);
    expect(container.querySelector(".status-pill__dot")).toBeNull();
  });

  // icon이 있으면 dot 기본값과 무관하게 아이콘이 점을 대신한다.
  it("icon을 주면 점 대신 아이콘", () => {
    const { container } = render(
      <StatusPill tone="info" label="작업 중" icon={<Clock size={12} />} />,
    );
    expect(container.querySelector(".status-pill__dot")).toBeNull();
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});
