// @vitest-environment jsdom
// 루트 `pnpm test`(vitest.workspace.ts)는 packages/ui/vitest.config.ts를 읽지 않는다.
// 환경과 셋업(jest-dom matchers + afterEach(cleanup))을 파일 자체가 선언한다.
import "./setup";

import { render, screen } from "@testing-library/react";
import { Clock } from "lucide-react";
import { describe, expect, it } from "vitest";
import { AgentStatusPill, ApprovalStatusPill, StatusPill } from "../src/components/status-pill";

describe("ApprovalStatusPill (approval 4상태)", () => {
  it.each([
    ["pending", "대기", "warning"],
    ["approved", "승인됨", "success"],
    ["rejected", "거절됨", "danger"],
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
    ["blocked", "차단됨", "danger"],
    ["done", "완료", "success"],
    ["failed", "실패", "danger"],
  ] as const)("%s → %s / tone %s", (state, label, tone) => {
    render(<AgentStatusPill state={state} />);
    const pill = screen.getByText(label);
    expect(pill).toHaveClass("status-pill");
    expect(pill).toHaveAttribute("data-tone", tone);
  });
});

describe("count prop", () => {
  // 0은 "없음"이 아니라 실제 카운트다 — `count !== undefined` 분기가 0에서 살아있는지 고정한다.
  it.each([
    [6, "6"],
    [0, "0"],
    [undefined, null],
  ] as const)("count=%s", (count, text) => {
    const { container } = render(<ApprovalStatusPill state="pending" count={count} />);
    const el = container.querySelector(".status-pill__count");
    if (text === null) {
      expect(el).toBeNull();
    } else {
      expect(el).toHaveTextContent(text);
    }
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
