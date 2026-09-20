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
    expect(screen.getByLabelText("Slack message")).toBeInTheDocument(); // 채널 브랜드 아이콘
    fireEvent.click(screen.getByRole("option"));
    expect(baseProps.onSelect).toHaveBeenCalledWith("thread-1");
  });

  it("bolds the name and shows a dot when unread (U2: unread = bold name + dot)", () => {
    render(<InboxRow {...baseProps} unread={true} />);
    expect(screen.getByText("Sora Kim")).toHaveAttribute("data-unread", "true");
    expect(screen.getByLabelText("Unread")).toBeInTheDocument();
  });

  it("does not bold the name or show a dot when read", () => {
    render(<InboxRow {...baseProps} unread={false} />);
    expect(screen.getByText("Sora Kim")).toHaveAttribute("data-unread", "false");
    expect(screen.queryByLabelText("Unread")).not.toBeInTheDocument();
  });

  it("prefixes draft summaries with 'Draft: ' (A5 §3.1)", () => {
    render(<InboxRow {...baseProps} isDraft={true} summary="네 확인했습니다" />);
    expect(screen.getByText("Draft: 네 확인했습니다")).toBeInTheDocument();
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
    expect(screen.getByLabelText("scope label: work")).toBeInTheDocument();
    expect(screen.getByLabelText("1 more labels")).toHaveTextContent("+1");
  });
});

// US-D02b: 채널 마크는 react-icons 단색 SVG가 아니라 실제 브랜드 PNG다. 해시된 에셋 URL은
// Vite가 다시 쓸 수 있으므로 파일명·1x/2x 접미사만 본다.
describe("InboxRow channel mark (US-D02b: official brand PNGs)", () => {
  it("renders the channel's real brand PNG in the 16px slot", () => {
    render(<InboxRow {...baseProps} channel="gmail" />);
    const img = screen.getByLabelText("Gmail message").querySelector("img");
    expect(img).toBeInTheDocument();
    expect(img?.getAttribute("src")).toMatch(/gmail@1x\.png$/);
    expect(img?.getAttribute("srcSet")).toMatch(/gmail@1x\.png 1x, .*gmail@2x\.png 2x$/);
    expect(img).toHaveAttribute("width", "16");
    expect(img).toHaveAttribute("height", "16");
  });

  it("keeps the mark decorative — the row's label carries the accessible name", () => {
    render(<InboxRow {...baseProps} channel="slack" />);
    const img = screen.getByLabelText("Slack message").querySelector("img");
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("aria-hidden", "true");
  });

  // KakaoTalk의 노란 타일은 이제 CSS 배경이 아니라 PNG 안에 들어 있다 — 한 번 더 감싸면 이중 프레임.
  it("does not wrap KakaoTalk in a CSS tile on top of the baked-in one", () => {
    render(<InboxRow {...baseProps} channel="kakaotalk" />);
    const wrap = screen.getByLabelText("KakaoTalk message");
    expect(wrap.querySelector(".channel-glyph--tiled")).toBeNull();
    expect(wrap.querySelector("img")?.getAttribute("src")).toMatch(/kakaotalk@1x\.png$/);
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
    const avatarEl = screen.getByLabelText("Claude Code session");
    expect(avatarEl).toBeInTheDocument();
    expect(avatarEl.querySelector("svg")).toBeInTheDocument(); // Anthropic 브랜드 마크
    expect(screen.getByText("확인 필요")).toBeInTheDocument();
    expect(screen.queryByLabelText("Slack message")).not.toBeInTheDocument();
  });

  // 그룹 헤더가 이미 상태를 말할 때(Agents 뷰) 행은 상태를 되풀이하지 않는다 — 그런데 그 자리를
  // 채널 글리프로 메우면 런타임 세션 행이 "Slack message"라고 주장한다. 슬롯을 비운다.
  it("groupedByState면 상태 배지도, 대신 들어오는 채널 글리프도 그리지 않는다", () => {
    render(
      <InboxRow
        {...baseProps}
        avatar={{ kind: "runtime", runtime: "claude_code" }}
        agentState="blocked"
        groupedByState={true}
      />,
    );
    expect(screen.queryByText("확인 필요")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Slack message")).not.toBeInTheDocument();
  });

  // 세션이 아닌 행(agentState null)은 그룹 뷰에 섞여 있어도 채널이 그 행의 진짜 사실이다.
  it("groupedByState라도 세션이 아닌 행은 채널 글리프를 그대로 갖는다", () => {
    render(<InboxRow {...baseProps} groupedByState={true} />);
    expect(screen.getByLabelText("Slack message")).toBeInTheDocument();
  });

  it("falls back to a letter tile ('H') for a runtime with no brand mark (Hermes)", () => {
    render(
      <InboxRow {...baseProps} avatar={{ kind: "runtime", runtime: "hermes" }} agentState="idle" />,
    );
    const avatarEl = screen.getByLabelText("Hermes session");
    expect(avatarEl).toHaveTextContent("H");
    expect(avatarEl.querySelector("svg")).not.toBeInTheDocument();
  });
});

describe("InboxRow pending-approval badge", () => {
  it("shows an approval dot when the thread has a pending approval", () => {
    render(<InboxRow {...baseProps} hasPendingApproval={true} />);
    expect(screen.getByLabelText("Pending approval")).toBeInTheDocument();
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
    expect(screen.getByLabelText("Slack message")).toBeInTheDocument();
    expect(screen.getByText("#omnis-launch")).toBeInTheDocument();
    expect(screen.getByText("adapter 테스트 3개 실패")).toBeInTheDocument();
    expect(screen.getByLabelText("Codex session")).toBeInTheDocument();
  });
});

describe("InboxRow 보관 액션 (US-A36)", () => {
  it("renders no action button unless onArchive is given", () => {
    render(<InboxRow {...baseProps} />);
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
  });

  it("calls onArchive with the thread id without selecting the row", () => {
    const onArchive = vi.fn();
    const onSelect = vi.fn();
    render(<InboxRow {...baseProps} onSelect={onSelect} onArchive={onArchive} />);
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(onArchive).toHaveBeenCalledWith("thread-1");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("labels the action Restore on an archived row (A5 §3.8)", () => {
    render(<InboxRow {...baseProps} archived={true} onArchive={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument();
  });
});

describe("InboxRow 호버 카드 (US-D02)", () => {
  // 카드는 openDelay(400ms)가 지나야 뜬다 — fake timer로 그 400ms만 실제로 흘려보낸다
  // (command-palette.test.tsx의 닫힘 스프링 테스트와 같은 패턴).
  afterEach(() => vi.useRealTimers());

  function hoverRow(over: Partial<typeof baseProps> & Record<string, unknown> = {}) {
    vi.useFakeTimers();
    render(<InboxRow {...baseProps} {...over} />);
    // Radix HoverCard 1.1.23의 트리거는 pointer 이벤트만 듣는다 — mouseEnter로는 열리지 않는다.
    fireEvent.pointerEnter(screen.getAllByRole("option")[0] as HTMLElement);
    return () => document.querySelector(".row-hover-card") as HTMLElement | null;
  }

  it("호버 전에는 없고, 400ms가 지나야 카드가 뜬다", () => {
    const card = hoverRow();

    // 리스트를 훑고 지나갈 때 카드가 줄줄이 번쩍이지 않는다.
    expect(card()).toBeNull();

    // 400ms 직전까지는 여전히 없다 — 이 지연이 곧 hover intent다.
    act(() => vi.advanceTimersByTime(399));
    expect(card()).toBeNull();

    act(() => vi.advanceTimersByTime(1));
    expect(card()).not.toBeNull();
  });

  // 카드의 존재 이유: 행이 line-clamp로 잘라 낸 요약의 전문.
  it("행이 자른 요약 전문과, 행에 없는 채널·Unread 수를 보여준다", () => {
    const long =
      "브라이트스톤 리얼티 매매계약서 최신본을 공유해 달라는 요청입니다. 지난주 검토본 이후 " +
      "특약 두 줄이 바뀌었고 금요일까지 회신이 필요하다고 합니다.";
    const card = hoverRow({ summary: long, unreadCount: 3 });
    act(() => vi.advanceTimersByTime(400));
    const meta = within(card() as HTMLElement);

    expect(meta.getByText(long)).toBeInTheDocument();
    expect(meta.getByText("Channel")).toBeInTheDocument();
    expect(meta.getByText("Slack")).toBeInTheDocument();
    expect(meta.getByText("Unread")).toBeInTheDocument();
    expect(meta.getByText("3")).toBeInTheDocument();
    expect(meta.getByText("Last activity")).toBeInTheDocument();
    expect(meta.getByText("3m")).toBeInTheDocument();
  });

  // 카드는 행을 되풀이하지 않는다. 제목(=이름)은 한 번뿐이고, 행이 이미 칩으로 다 보여 준
  // 라벨은 카드에 다시 나오지 않는다.
  it("행이 다 보여 준 것은 반복하지 않는다", () => {
    const card = hoverRow({ unreadCount: 0 });
    act(() => vi.advanceTimersByTime(400));
    const meta = within(card() as HTMLElement);

    expect(meta.getAllByText("Sora Kim")).toHaveLength(1);
    expect(meta.queryByText("Labels")).not.toBeInTheDocument();
    expect(meta.queryByText("Unread")).not.toBeInTheDocument();
  });

  // 칩 2개 + "+N"으로 잘렸을 때만 전체 라벨 목록이 값을 더한다.
  it("칩에서 잘린 라벨이 있으면 전체 목록을 보여준다", () => {
    const card = hoverRow({
      labels: [
        { kind: "scope" as const, name: "work", color: null },
        { kind: "topic" as const, name: "davich", color: null },
        { kind: "topic" as const, name: "계약", color: null },
      ],
    });
    act(() => vi.advanceTimersByTime(400));
    const meta = within(card() as HTMLElement);
    expect(meta.getByText("Labels")).toBeInTheDocument();
    expect(meta.getByText("work, davich, 계약")).toBeInTheDocument();
  });

  // agent_session 행은 우측 슬롯이 채널 아이콘 대신 상태 배지라 "Channel"이 의미가 없다.
  it("agent 세션 행에는 채널 줄이 없다", () => {
    const card = hoverRow({ agentState: "working" as const });
    act(() => vi.advanceTimersByTime(400));
    expect(within(card() as HTMLElement).queryByText("Channel")).not.toBeInTheDocument();
  });
});
