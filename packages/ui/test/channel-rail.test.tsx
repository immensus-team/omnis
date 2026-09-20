// @vitest-environment jsdom
// The root `pnpm test` (vitest.workspace.ts) does not read packages/ui/vitest.config.ts, so the
// file declares its own environment and setup (jest-dom matchers + afterEach(cleanup)).
import "./setup";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChannelRail } from "../src/components/channel-rail";
import type { UiChannel } from "../src/types.js";

// US-D02b: stand in for the narrow shell (<900px). jsdom's window.matchMedia always reports
// matches:false, so it has to be replaced — the component calls window.matchMedia, not globalThis.
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

describe("ChannelRail (U1 kinso left rail)", () => {
  it("renders one tile per connected channel, plus the fixed Inbox tile", () => {
    render(
      <ChannelRail channels={["gmail", "slack", "agent"]} selected={null} onSelect={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Inbox" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gmail" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Slack" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Agent" })).toBeInTheDocument();
    // Three channels + Inbox = four tiles; an arbitrary fifth channel must not appear.
    expect(screen.queryByRole("button", { name: "LinkedIn" })).not.toBeInTheDocument();
  });

  it("clicking a channel tile calls onSelect with that channel", () => {
    const onSelect = vi.fn();
    render(<ChannelRail channels={["gmail", "slack"]} selected={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Slack" }));
    expect(onSelect).toHaveBeenCalledWith("slack");
  });

  it("clicking the Inbox tile calls onSelect with null (show everything)", () => {
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

// US-D02b: a rail tile's mark is the real brand PNG, not a react-icons glyph tinted with a brand hex.
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

describe("ChannelRail fixed tiles", () => {
  it("renders the Agents tile even when no agent account is connected", () => {
    render(<ChannelRail channels={["gmail"]} selected={null} onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Agent" })).toBeInTheDocument();
  });

  it("does not duplicate the Agents tile when an agent account is connected", () => {
    render(<ChannelRail channels={["gmail", "agent"]} selected={null} onSelect={vi.fn()} />);
    expect(screen.getAllByRole("button", { name: "Agent" })).toHaveLength(1);
  });
});

// US-D02b: in the narrow shell the rail is a bottom bar — at most four tiles stand in it and the
// rest, along with the avatar and settings, move into the More popover (pushing tiles into a 320px
// bar indefinitely produces horizontal scroll).
describe("ChannelRail narrow shell (US-D02b: bottom bar + More popover)", () => {
  const MANY: UiChannel[] = ["gmail", "slack", "outlook", "telegram", "whatsapp", "kakaotalk"];

  it("keeps only the first 4 tiles in the bar and moves the rest into More", () => {
    stubNarrowRail(true);
    render(<ChannelRail channels={MANY} selected={null} onSelect={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Inbox" })).toBeInTheDocument();
    for (const name of ["Gmail", "Slack", "Outlook", "Telegram"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    // From the fifth on they are not in the bar — they are inside More.
    expect(screen.queryByRole("button", { name: "WhatsApp" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Agent" })).not.toBeInTheDocument();
    // The two that stand at the foot of the wide rail are not in the bar either.
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
    // Unlike the 44px bar tiles there is room for words here — an icon alone does not say which
    // tile it is.
    expect(within(popover).getByText("Account")).toBeInTheDocument();
    expect(within(popover).getByText("Settings")).toBeInTheDocument();
    // The four already standing in the bar are not repeated in the popover.
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

  it("keeps every tile in the wide shell's bar", () => {
    stubNarrowRail(false);
    render(<ChannelRail channels={MANY} selected={null} onSelect={vi.fn()} />);

    expect(screen.getByRole("button", { name: "WhatsApp" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Account" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
  });

  it("does not offer a More button in the wide shell, where nothing overflows", () => {
    stubNarrowRail(false);
    const { container } = render(
      <ChannelRail channels={MANY} selected={null} onSelect={vi.fn()} />,
    );

    // The chevron is a mark, not a control: it stays out of the accessibility tree and out of the
    // tab order rather than announcing as a button that does nothing when pressed.
    expect(screen.queryByRole("button", { name: "More" })).not.toBeInTheDocument();
    expect(container.querySelector(".channel-rail__more")).toHaveAttribute("aria-hidden", "true");
  });
});

// US-D02b: Account and Settings have no screen behind them yet. A labelled, focusable button that
// does nothing is worse than a visibly gated one, so they are disabled and say why.
describe("ChannelRail Phase B controls", () => {
  it("disables Account and Settings and explains the gate in the wide shell", () => {
    stubNarrowRail(false);
    render(<ChannelRail channels={["gmail"]} selected={null} onSelect={vi.fn()} />);

    for (const name of ["Account", "Settings"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toBeDisabled();
      expect(button.getAttribute("title")).toMatch(/Phase B/);
    }
  });

  it("disables the Account and Settings rows inside the narrow shell's More popover", () => {
    stubNarrowRail(true);
    render(
      <ChannelRail
        channels={["gmail", "slack", "outlook", "telegram", "whatsapp"]}
        selected={null}
        onSelect={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    const popover = screen.getByRole("dialog");
    for (const name of ["Account", "Settings"]) {
      expect(within(popover).getByRole("button", { name })).toBeDisabled();
    }
  });
});

// US-D06 §4.1.1: the plate's glass sits on the rail's aurora, and the two are separate elements on
// purpose (§2.7) — one element carrying both classes gives the panel a `background-color` and a
// `background` at the same specificity and the glass loses.
describe("ChannelRail aurora backdrop (US-D06)", () => {
  it("paints the mist aurora on an ancestor of the plate, never on the plate itself", () => {
    const { container } = render(
      <ChannelRail channels={["gmail"]} selected={null} onSelect={vi.fn()} />,
    );
    const plate = container.querySelector(".channel-rail__plate");
    const aura = container.querySelector(".channel-rail__aurora");

    expect(aura).toHaveAttribute("data-aurora", "mist");
    // The aurora is the plate's parent, so its texture paints *behind* the glass rather than over
    // it, and the plate keeps `.glass-surface` to itself.
    expect(aura).toContainElement(plate);
    expect(plate).not.toHaveClass("aurora");
    // Both texture layers travel with it — a variant with no mass still needs the grain.
    expect(aura?.querySelector(".aurora__grain")).not.toBeNull();
  });
});
