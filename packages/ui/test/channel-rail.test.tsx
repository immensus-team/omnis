// @vitest-environment jsdom
// 루트 `pnpm test`(vitest.workspace.ts)는 packages/ui/vitest.config.ts를 읽지 않는다.
// 환경과 셋업(jest-dom matchers + afterEach(cleanup))을 파일 자체가 선언한다.
import "./setup";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChannelRail } from "../src/components/channel-rail";
import type { UiChannel } from "../src/types.js";

// US-D02b: 좁은 셸(<900px)을 흉내낸다. jsdom의 window.matchMedia는 항상 matches:false만 주므로
// 갈아끼워야 한다 — 컴포넌트는 window.matchMedia를 부르지 globalThis를 부르지 않는다.
const REAL_MATCH_MEDIA = window.matchMedia;
function stubNarrowRail(matches: boolean) {
  window.matchMedia = (() => ({
    matches,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}
afterEach(() => {
  window.matchMedia = REAL_MATCH_MEDIA;
});

describe("ChannelRail (U1 kinso 좌측 레일)", () => {
  it("renders one tile per connected channel, plus the fixed Inbox tile", () => {
    render(
      <ChannelRail channels={["gmail", "slack", "agent"]} selected={null} onSelect={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Inbox" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gmail" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Slack" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agent" })).toBeInTheDocument();
    // 채널 3개 + Inbox 1개 = 채널 타일 총 4개, 임의 5번째 채널은 없어야 한다.
    expect(screen.queryByRole("button", { name: "LinkedIn" })).not.toBeInTheDocument();
  });

  it("clicking a channel tile calls onSelect with that channel", () => {
    const onSelect = vi.fn();
    render(<ChannelRail channels={["gmail", "slack"]} selected={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Slack" }));
    expect(onSelect).toHaveBeenCalledWith("slack");
  });

  it("clicking the Inbox tile calls onSelect with null (전체 보기)", () => {
    const onSelect = vi.fn();
    render(<ChannelRail channels={["gmail"]} selected="gmail" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Inbox" }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("marks the selected channel tile pressed for a11y/visual state", () => {
    render(<ChannelRail channels={["gmail", "slack"]} selected="slack" onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Slack" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Gmail" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Inbox" })).toHaveAttribute("aria-pressed", "false");
  });
});

// US-D02b: 레일 타일의 마크는 브랜드 hex로 틴트한 react-icons가 아니라 실제 브랜드 PNG다.
describe("ChannelRail brand marks (US-D02b: official brand PNGs)", () => {
  it("renders each channel tile's real brand PNG at the 18px rail size", () => {
    render(<ChannelRail channels={["gmail", "slack"]} selected={null} onSelect={vi.fn()} />);
    const img = screen.getByRole("button", { name: "Slack" }).querySelector("img");
    expect(img?.getAttribute("src")).toMatch(/slack@1x\.png$/);
    expect(img?.getAttribute("srcSet")).toMatch(/slack@1x\.png 1x, .*slack@2x\.png 2x$/);
    expect(img).toHaveAttribute("width", "18");
    expect(img).toHaveAttribute("height", "18");
  });

  it("renders the agent silhouette on the Agents tile", () => {
    render(<ChannelRail channels={["gmail"]} selected={null} onSelect={vi.fn()} />);
    const img = screen.getByRole("button", { name: "Agent" }).querySelector("img");
    expect(img?.getAttribute("src")).toMatch(/agent@1x\.png$/);
  });
});

describe("ChannelRail 고정 타일", () => {
  it("renders the Agents tile even when no agent account is connected", () => {
    render(<ChannelRail channels={["gmail"]} selected={null} onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Agent" })).toBeInTheDocument();
  });

  it("does not duplicate the Agents tile when an agent account is connected", () => {
    render(<ChannelRail channels={["gmail", "agent"]} selected={null} onSelect={vi.fn()} />);
    expect(screen.getAllByRole("button", { name: "Agent" })).toHaveLength(1);
  });
});

// US-D02b: 좁은 셸에서 레일은 하단 바다 — 바에는 타일 4개까지만 서고 나머지 타일과
// 아바타/설정은 More 팝오버로 내려간다(320px 바에 계속 밀어 넣으면 가로 스크롤이 난다).
describe("ChannelRail narrow shell (US-D02b: bottom bar + More popover)", () => {
  const MANY: UiChannel[] = ["gmail", "slack", "outlook", "telegram", "whatsapp", "kakaotalk"];

  it("keeps only the first 4 tiles in the bar and moves the rest into More", () => {
    stubNarrowRail(true);
    render(<ChannelRail channels={MANY} selected={null} onSelect={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Inbox" })).toBeInTheDocument();
    for (const name of ["Gmail", "Slack", "Outlook", "Telegram"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    // 5번째부터는 바에 없다 — More 안에 있다.
    expect(screen.queryByRole("button", { name: "WhatsApp" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Agent" })).not.toBeInTheDocument();
    // 넓은 셸에서 바닥에 서던 둘도 이제 바에 없다.
    expect(screen.queryByRole("button", { name: "Account" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Settings" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More" })).toBeInTheDocument();
  });

  it("More opens a popover with the overflow tiles plus the Account/Settings rows", () => {
    stubNarrowRail(true);
    render(<ChannelRail channels={MANY} selected={null} onSelect={vi.fn()} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "More" }));

    const popover = screen.getByRole("dialog");
    expect(within(popover).getByRole("button", { name: "WhatsApp" })).toBeInTheDocument();
    expect(within(popover).getByRole("button", { name: "KakaoTalk" })).toBeInTheDocument();
    expect(within(popover).getByRole("button", { name: "Agent" })).toBeInTheDocument();
    // 44px 바 타일과 달리 여기는 글자를 놓을 자리가 있다 — 아이콘만으로는 무슨 타일인지 모른다.
    expect(within(popover).getByText("Account")).toBeInTheDocument();
    expect(within(popover).getByText("Settings")).toBeInTheDocument();
    // 바에 이미 선 4개는 팝오버에 없다(같은 목록을 두 곳에 그리지 않는다).
    expect(within(popover).queryByRole("button", { name: "Gmail" })).not.toBeInTheDocument();
  });

  it("picking an overflow channel selects it and closes the popover", () => {
    stubNarrowRail(true);
    const onSelect = vi.fn();
    render(<ChannelRail channels={MANY} selected={null} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(screen.getByRole("button", { name: "WhatsApp" }));

    expect(onSelect).toHaveBeenCalledWith("whatsapp");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("leaves the wide shell exactly as it was — every tile in the bar, More still inert", () => {
    stubNarrowRail(false);
    render(<ChannelRail channels={MANY} selected={null} onSelect={vi.fn()} />);

    expect(screen.getByRole("button", { name: "WhatsApp" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Account" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
    // 접을 게 없으니 열 것도 없다(오버플로 메뉴는 바가 좁아지는 티어 전용이다).
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
