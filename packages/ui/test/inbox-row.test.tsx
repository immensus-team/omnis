// @vitest-environment jsdom
// 루트 `pnpm test`(vitest.workspace.ts)는 packages/ui/vitest.config.ts를 읽지 않는다.
// 환경과 셋업(jest-dom matchers + afterEach(cleanup))을 파일 자체가 선언한다.
import "./setup";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { InboxRow } from "../src/components/inbox-row";

const baseProps = {
  id: "thread-1",
  name: "Sora Kim",
  timestamp: "3m",
  summary: "회의 자료 확인 부탁드립니다",
  isDraft: false,
  avatar: { kind: "initials" as const, name: "Sora Kim" },
  channel: "slack" as const,
  agentState: null,
  unread: true,
  selected: false,
  hasPendingApproval: false,
  labels: [
    { kind: "scope" as const, name: "work", color: null },
    { kind: "topic" as const, name: "davich", color: "#4f8" },
  ],
  onSelect: vi.fn(),
};

describe("InboxRow (U2 kinso 대화 행 — 스레드 단위)", () => {
  it("renders name, timestamp, summary, avatar, channel icon and calls onSelect with the thread id", () => {
    render(<InboxRow {...baseProps} />);
    expect(screen.getByText("Sora Kim")).toBeInTheDocument();
    expect(screen.getByText("3m")).toBeInTheDocument();
    expect(screen.getByText("회의 자료 확인 부탁드립니다")).toBeInTheDocument();
    expect(screen.getByLabelText("Sora Kim")).toBeInTheDocument(); // 아바타
    expect(screen.getByLabelText("Slack 메시지")).toBeInTheDocument(); // 채널 브랜드 아이콘
    fireEvent.click(screen.getByRole("option"));
    expect(baseProps.onSelect).toHaveBeenCalledWith("thread-1");
  });

  it("bolds the name and shows a dot when unread (U2: unread = bold name + dot)", () => {
    render(<InboxRow {...baseProps} unread={true} />);
    expect(screen.getByText("Sora Kim")).toHaveAttribute("data-unread", "true");
    expect(screen.getByLabelText("안읽음")).toBeInTheDocument();
  });

  it("does not bold the name or show a dot when read", () => {
    render(<InboxRow {...baseProps} unread={false} />);
    expect(screen.getByText("Sora Kim")).toHaveAttribute("data-unread", "false");
    expect(screen.queryByLabelText("안읽음")).not.toBeInTheDocument();
  });

  it("prefixes draft summaries with '초안: ' (A5 §3.1)", () => {
    render(<InboxRow {...baseProps} isDraft={true} summary="네 확인했습니다" />);
    expect(screen.getByText("초안: 네 확인했습니다")).toBeInTheDocument();
  });

  it("shows at most 2 chips + N more, scope label first (A5 §3.1 우선순위)", () => {
    render(
      <InboxRow
        {...baseProps}
        labels={[
          { kind: "topic", name: "a", color: null },
          { kind: "scope", name: "work", color: null },
          { kind: "person", name: "b", color: null },
        ]}
      />,
    );
    expect(screen.getByLabelText("scope 라벨: work")).toBeInTheDocument();
    expect(screen.getByLabelText("라벨 1개 더 보기")).toHaveTextContent("+1");
  });
});

describe("InboxRow 채널 아이콘 (react-icons/si — US-A26 폴백에서 진짜 브랜드 아이콘으로)", () => {
  it("renders an actual icon element, not just an accessible name", () => {
    render(<InboxRow {...baseProps} channel="gmail" />);
    const icon = screen.getByLabelText("Gmail 메시지");
    expect(icon.querySelector("svg")).toBeInTheDocument();
  });
});

describe("InboxRow 아바타 (U2: 사진 → 이니셜+파스텔 폴백, agent_session은 런타임 로고)", () => {
  it("shows initials on a pastel background when there is no photo", () => {
    render(<InboxRow {...baseProps} avatar={{ kind: "initials", name: "Sora Kim" }} />);
    expect(screen.getByLabelText("Sora Kim")).toHaveTextContent("SK");
  });

  it("shows the runtime logo for an agent session row and a status badge instead of the channel icon", () => {
    render(
      <InboxRow
        {...baseProps}
        avatar={{ kind: "runtime", runtime: "claude_code" }}
        agentState="blocked"
      />,
    );
    expect(screen.getByLabelText("Claude Code 세션")).toBeInTheDocument();
    expect(screen.getByText("확인 필요")).toBeInTheDocument();
    expect(screen.queryByLabelText("Slack 메시지")).not.toBeInTheDocument();
  });
});

describe("InboxRow 승인 대기 배지", () => {
  it("shows an approval dot when the thread has a pending approval", () => {
    render(<InboxRow {...baseProps} hasPendingApproval={true} />);
    expect(screen.getByLabelText("승인 대기")).toBeInTheDocument();
  });
});

describe("InboxRow 리스트 (U2: 스레드 하나당 행 하나)", () => {
  it("renders one row per thread, each with an avatar, name, time, summary and brand icon", () => {
    const rows = [
      { ...baseProps, id: "t1", name: "Sora Kim", summary: "회의 자료 확인 부탁드립니다" },
      {
        ...baseProps,
        id: "t2",
        name: "#omnis-launch",
        summary: "adapter 테스트 3개 실패",
        avatar: { kind: "runtime" as const, runtime: "codex" as const },
        agentState: "working" as const,
        channel: "agent" as const,
      },
    ];
    render(
      <div>
        {rows.map((r) => (
          <InboxRow key={r.id} {...r} />
        ))}
      </div>,
    );
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(screen.getByText("Sora Kim")).toBeInTheDocument();
    expect(screen.getByText("회의 자료 확인 부탁드립니다")).toBeInTheDocument();
    expect(screen.getByLabelText("Slack 메시지")).toBeInTheDocument();
    expect(screen.getByText("#omnis-launch")).toBeInTheDocument();
    expect(screen.getByText("adapter 테스트 3개 실패")).toBeInTheDocument();
    expect(screen.getByLabelText("Codex 세션")).toBeInTheDocument();
  });
});
