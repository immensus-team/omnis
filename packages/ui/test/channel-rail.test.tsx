// @vitest-environment jsdom
// 루트 `pnpm test`(vitest.workspace.ts)는 packages/ui/vitest.config.ts를 읽지 않는다.
// 환경과 셋업(jest-dom matchers + afterEach(cleanup))을 파일 자체가 선언한다.
import "./setup";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChannelRail } from "../src/components/channel-rail";

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
