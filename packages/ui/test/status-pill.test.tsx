// @vitest-environment jsdom
// 루트 `pnpm test`(vitest.workspace.ts)는 packages/ui/vitest.config.ts를 읽지 않는다.
// 환경과 셋업(jest-dom matchers + afterEach(cleanup))을 파일 자체가 선언한다.
import "./setup";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentStatusBadge } from "../src/components/status-badge";
import { AgentStatusPill, StatusPill } from "../src/components/status-pill";

describe("AgentStatusPill (agent session 5상태)", () => {
  it.each([
    ["idle", "대기", "neutral"],
    ["working", "작업 중", "info"],
    // blocked = "내 응답 필요". danger(빨강)가 아닌 이유는 그게 에러가 아니라서다 — 에러는
    // failed다. 이 한 줄이 2회차 거절 사유(헤더 빨강 / 행 파랑)를 고정한다.
    ["blocked", "확인 필요", "warning"],
    ["done", "완료", "success"],
    ["failed", "실패", "danger"],
  ] as const)("%s → %s / tone %s", (state, label, tone) => {
    render(<AgentStatusPill state={state} />);
    const pill = screen.getByText(label);
    expect(pill).toHaveClass("status-pill");
    expect(pill).toHaveAttribute("data-tone", tone);
  });
});

// 같은 상태를 한 화면에서 두 문구로 보여주면 안 된다 — 헤더 pill과 행 배지는 모양이 다르지
// 목적이 같다. 색은 app.css가 선택자 두 개에 값 한 벌로 주므로(.status-pill[data-tone="warning"],
// .status-badge--agent[data-agent-state="blocked"]) 갈라질 수가 없고, 갈라질 수 있는 건 라벨이다.
describe("pill과 행 배지는 같은 상태를 같은 말로 부른다", () => {
  it.each(["idle", "working", "blocked", "done"] as const)("%s", (state) => {
    const { container: pill } = render(<AgentStatusPill state={state} />);
    const { container: badge } = render(<AgentStatusBadge state={state} />);
    expect(badge.textContent).toBe(pill.textContent);
  });
});

describe("StatusPill 기본형", () => {
  it("톤 점을 라벨 앞에 그린다", () => {
    const { container } = render(<StatusPill tone="info" label="작업 중" />);
    expect(container.querySelector(".status-pill__dot")).toBeInTheDocument();
    expect(container.querySelector(".status-pill")).toHaveTextContent("작업 중");
  });

  it("className은 .status-pill에 합쳐진다", () => {
    const { container } = render(<StatusPill tone="info" label="작업 중" className="custom" />);
    expect(container.querySelector(".status-pill")).toHaveClass("custom");
  });
});
