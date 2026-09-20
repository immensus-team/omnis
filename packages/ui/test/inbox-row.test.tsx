// @vitest-environment jsdom
// 루트 `pnpm test`(vitest.workspace.ts)는 packages/ui/vitest.config.ts를 읽지 않는다.
// 환경과 셋업(jest-dom matchers + afterEach(cleanup))을 파일 자체가 선언한다.
import "./setup";

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("InboxRow 채널 아이콘 브랜드 컬러 (P1: kinso polish — 회색 아이콘 대신 브랜드 컬러)", () => {
  it("colors the channel icon with the channel's brand hex, not the default grey", () => {
    render(<InboxRow {...baseProps} channel="slack" />);
    const svg = screen.getByLabelText("Slack 메시지").querySelector("svg");
    expect(svg).toHaveStyle({ color: "#4A154B" });
  });

  it("gives KakaoTalk a brand-yellow tile behind the (black) glyph", () => {
    render(<InboxRow {...baseProps} channel="kakaotalk" />);
    const wrap = screen.getByLabelText("KakaoTalk 메시지");
    expect(wrap.querySelector(".channel-glyph--tiled")).toHaveStyle({ background: "#FFE812" });
    expect(wrap.querySelector("svg")).toHaveStyle({ color: "#000000" });
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
    const avatarEl = screen.getByLabelText("Claude Code 세션");
    expect(avatarEl).toBeInTheDocument();
    expect(avatarEl.querySelector("svg")).toBeInTheDocument(); // Anthropic 브랜드 마크
    expect(screen.getByText("확인 필요")).toBeInTheDocument();
    expect(screen.queryByLabelText("Slack 메시지")).not.toBeInTheDocument();
  });

  it("falls back to a letter tile ('H') for a runtime with no brand mark (Hermes)", () => {
    render(
      <InboxRow {...baseProps} avatar={{ kind: "runtime", runtime: "hermes" }} agentState="idle" />,
    );
    const avatarEl = screen.getByLabelText("Hermes 세션");
    expect(avatarEl).toHaveTextContent("H");
    expect(avatarEl.querySelector("svg")).not.toBeInTheDocument();
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

describe("InboxRow 보관 액션 (US-A36)", () => {
  it("renders no action button unless onArchive is given", () => {
    render(<InboxRow {...baseProps} />);
    expect(screen.queryByRole("button", { name: "보관" })).not.toBeInTheDocument();
  });

  it("calls onArchive with the thread id without selecting the row", () => {
    const onArchive = vi.fn();
    const onSelect = vi.fn();
    render(<InboxRow {...baseProps} onSelect={onSelect} onArchive={onArchive} />);
    fireEvent.click(screen.getByRole("button", { name: "보관" }));
    expect(onArchive).toHaveBeenCalledWith("thread-1");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("labels the action 되살리기 on an archived row (A5 §3.8)", () => {
    render(<InboxRow {...baseProps} archived={true} onArchive={vi.fn()} />);
    expect(screen.getByRole("button", { name: "되살리기" })).toBeInTheDocument();
  });
});

describe("InboxRow 호버 카드 (US-D02)", () => {
  // 카드는 openDelay(400ms)가 지나야 뜬다 — fake timer로 그 400ms만 실제로 흘려보낸다
  // (command-palette.test.tsx의 닫힘 스프링 테스트와 같은 패턴).
  afterEach(() => vi.useRealTimers());

  function hoverRow(labels = baseProps.labels) {
    vi.useFakeTimers();
    render(<InboxRow {...baseProps} labels={labels} />);
    // Radix HoverCard 1.1.23의 트리거는 pointer 이벤트만 듣는다 — mouseEnter로는 열리지 않는다.
    fireEvent.pointerEnter(screen.getByRole("option"));
    return () => document.querySelector(".row-hover-card") as HTMLElement | null;
  }

  it("호버 전에는 없고, 400ms가 지나야 참여자·라벨·마지막 활동 카드가 뜬다", () => {
    const card = hoverRow();

    // 리스트를 훑고 지나갈 때 카드가 줄줄이 번쩍이지 않는다.
    expect(card()).toBeNull();

    // 400ms 직전까지는 여전히 없다 — 이 지연이 곧 hover intent다.
    act(() => vi.advanceTimersByTime(399));
    expect(card()).toBeNull();

    act(() => vi.advanceTimersByTime(1));
    const meta = within(card() as HTMLElement);
    // 제목 + 참여자 행. 지금은 둘 다 행이 아는 같은 이름 하나다(컴포넌트의 ponytail 주석 참고).
    expect(meta.getAllByText("Sora Kim")).toHaveLength(2);
    expect(meta.getByText("참여자")).toBeInTheDocument();
    expect(meta.getByText("work, davich")).toBeInTheDocument(); // 라벨은 쉼표로 이어 붙인다
    expect(meta.getByText("마지막 활동")).toBeInTheDocument();
    expect(meta.getByText("3m")).toBeInTheDocument();
  });

  it("라벨이 없는 행은 카드에서 라벨 행을 통째로 뺀다", () => {
    const card = hoverRow([]);

    act(() => vi.advanceTimersByTime(400));
    const meta = within(card() as HTMLElement);
    expect(meta.queryByText("라벨")).not.toBeInTheDocument();
    expect(meta.getByText("마지막 활동")).toBeInTheDocument();
  });
});
