// @vitest-environment jsdom
// The root `pnpm test` (vitest.workspace.ts) does not read packages/ui/vitest.config.ts, so the
// file declares its own environment and setup (jest-dom matchers + afterEach(cleanup)).
import "./setup";

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChannelRail } from "../src/components/channel-rail";
import { RAIL_ORDER_STORAGE_KEY } from "../src/lib/rail-order";
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
  // D7: the rail's order is a preference the component reads on mount, so a test that reorders has
  // to leave the store as it found it — the jsdom Storage is one Map for the whole file.
  localStorage.clear();
  // The long-press tests run on fake timers; leaving them installed would freeze every timer the
  // RTL cleanup after this point wants to run.
  vi.useRealTimers();
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

// D7 §c.2: the rail's reorder. The store is covered by rail-order.test.ts, the gesture by
// pointer-drag.test.tsx; what is left to prove here is the wiring between them — that the rail
// reads the stored order, writes it back, and that the drag and the keyboard both go through it.
describe("ChannelRail reorder (D7 §c.2)", () => {
  const CHANNELS: UiChannel[] = ["gmail", "slack"];

  /** jsdom lays nothing out: every element's rect is 0x0, so the drop slots the drag measures all
   *  collapse onto one point and a test could not tell "moved one slot" from "moved to the end".
   *  This gives each plate tile the rect it would have in a stacked column (the wide rail, y) or a
   *  row (the narrow bar, x), 52px apart, centred at 100 + 52i. */
  function stubTileRects(axis: "x" | "y"): HTMLElement[] {
    const tiles = Array.from(
      document.querySelectorAll<HTMLElement>(".channel-rail__plate .channel-rail__tile"),
    );
    tiles.forEach((el, i) => {
      const centre = 100 + i * 52;
      el.getBoundingClientRect = () =>
        ({
          left: axis === "x" ? centre - 22 : 0,
          top: axis === "y" ? centre - 22 : 0,
          width: 44,
          height: 44,
          right: 0,
          bottom: 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect;
    });
    return tiles;
  }

  /** Every tile's aria-label, in the order the plate renders them. */
  function renderedOrder(scope: ParentNode = document): string[] {
    return Array.from(scope.querySelectorAll(".channel-rail__plate .channel-rail__tile")).map(
      (el) => el.getAttribute("aria-label") ?? "",
    );
  }

  /** A whole mouse gesture on one tile. The drop rule is that a tile moves once the pointer is past
   *  the *next slot's centre*, so 60px — a stride of 52 plus the primitive's 6px start slop, with
   *  room to spare — is one slot and then some. */
  function dragTile(tile: HTMLElement, delta: { x?: number; y?: number }): void {
    const x = 500;
    const y = 500;
    const ends = { pointerId: 1, clientX: x + (delta.x ?? 0), clientY: y + (delta.y ?? 0) };
    fireEvent.pointerDown(tile, {
      button: 0,
      pointerId: 1,
      pointerType: "mouse",
      clientX: x,
      clientY: y,
    });
    fireEvent.pointerMove(tile, ends);
    fireEvent.pointerUp(tile, ends);
  }

  it("reads the stored order on mount", () => {
    localStorage.setItem(RAIL_ORDER_STORAGE_KEY, JSON.stringify(["agent", "slack"]));
    render(<ChannelRail channels={CHANNELS} selected={null} onSelect={vi.fn()} />);
    expect(renderedOrder()).toEqual(["Agent", "Slack", "Gmail"]);
  });

  it("moves a dragged tile one slot and writes the order as a JSON array of channel ids", () => {
    render(<ChannelRail channels={CHANNELS} selected={null} onSelect={vi.fn()} />);
    stubTileRects("y");
    expect(renderedOrder()).toEqual(["Gmail", "Slack", "Agent"]);

    dragTile(screen.getByRole("button", { name: "Slack" }), { y: 60 });

    expect(renderedOrder()).toEqual(["Gmail", "Agent", "Slack"]);
    expect(JSON.parse(localStorage.getItem(RAIL_ORDER_STORAGE_KEY) ?? "null")).toEqual([
      "gmail",
      "agent",
      "slack",
    ]);
  });

  it("keeps the order across a remount — the reload the reviewer checks", () => {
    const first = render(<ChannelRail channels={CHANNELS} selected={null} onSelect={vi.fn()} />);
    stubTileRects("y");
    dragTile(screen.getByRole("button", { name: "Slack" }), { y: 60 });
    first.unmount();

    render(<ChannelRail channels={CHANNELS} selected={null} onSelect={vi.fn()} />);
    expect(renderedOrder()).toEqual(["Gmail", "Agent", "Slack"]);
  });

  it("moves the lifted tile on transform alone — no top, left or margin", () => {
    render(<ChannelRail channels={CHANNELS} selected={null} onSelect={vi.fn()} />);
    stubTileRects("y");
    const slack = screen.getByRole("button", { name: "Slack" });

    fireEvent.pointerDown(slack, {
      button: 0,
      pointerId: 1,
      pointerType: "mouse",
      clientX: 500,
      clientY: 500,
    });
    // A press is not a lift. The primitive starts a mouse drag on movement, not on the press, so a
    // plain click never picks the tile up (§e guard 5: nothing moves for decoration).
    expect(slack.style.transform).toBe("");
    expect(slack).not.toHaveClass("channel-rail__tile--dragging");

    // Past the 6px start slop, but not yet past the next slot's centre: the tile is simply wherever
    // the pointer is.
    fireEvent.pointerMove(slack, { pointerId: 1, clientX: 500, clientY: 507 });
    expect(slack).toHaveClass("channel-rail__tile--dragging");
    expect(slack.style.transform).toBe("translate3d(0px, 7px, 0) scale(1.08)");

    // Layout is React's and the FLIP's; the pointer only ever writes `transform`.
    for (const property of [
      "top",
      "left",
      "right",
      "bottom",
      "margin",
      "marginTop",
      "marginLeft",
    ]) {
      expect(slack.style.getPropertyValue(property)).toBe("");
    }

    // Across a slot boundary the transform carries a second, inverse term — that is the FLIP
    // holding the tile still in the same frame its slot moves underneath it, and it is still only
    // ever a transform. (jsdom lays nothing out, so the inverse here is 0; in a browser it is the
    // 52px the slot moved.)
    fireEvent.pointerMove(slack, { pointerId: 1, clientX: 500, clientY: 560 });
    expect(slack.style.transform).toBe(
      "translate3d(0px, 0px, 0) translate3d(0px, 60px, 0) scale(1.08)",
    );

    fireEvent.pointerUp(slack, { pointerId: 1, clientX: 500, clientY: 560 });
    expect(slack.style.transform).toBe("");
    expect(slack).not.toHaveClass("channel-rail__tile--dragging");
  });

  it("does not select the channel a drag just ended on, but does on the next click", () => {
    const onSelect = vi.fn();
    render(<ChannelRail channels={CHANNELS} selected={null} onSelect={onSelect} />);
    stubTileRects("y");
    const slack = screen.getByRole("button", { name: "Slack" });

    dragTile(slack, { y: 60 });
    // The pointerup that ends a drag is followed by a click on the same tile.
    fireEvent.click(slack);
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(slack);
    expect(onSelect).toHaveBeenCalledWith("slack");
  });

  it("puts an escaped drag back where it started, store and all", () => {
    render(<ChannelRail channels={CHANNELS} selected={null} onSelect={vi.fn()} />);
    stubTileRects("y");
    const slack = screen.getByRole("button", { name: "Slack" });

    fireEvent.pointerDown(slack, {
      button: 0,
      pointerId: 1,
      pointerType: "mouse",
      clientX: 500,
      clientY: 500,
    });
    fireEvent.pointerMove(slack, { pointerId: 1, clientX: 500, clientY: 560 });
    expect(renderedOrder()).toEqual(["Gmail", "Agent", "Slack"]);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.pointerUp(slack, { pointerId: 1, clientX: 500, clientY: 560 });

    expect(renderedOrder()).toEqual(["Gmail", "Slack", "Agent"]);
    expect(localStorage.getItem(RAIL_ORDER_STORAGE_KEY)).toBeNull();
  });

  it("marks the channel tiles reorderable and the Inbox tile not", () => {
    render(<ChannelRail channels={CHANNELS} selected={null} onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Slack" })).toHaveAttribute(
      "aria-roledescription",
      "reorderable",
    );
    // Inbox is not a channel — it is "show everything" — so it is neither reorderable nor a drop
    // target: it stands outside the plate the drag measures its slots from, and it has no handler.
    expect(screen.getByRole("button", { name: "Inbox" })).not.toHaveAttribute(
      "aria-roledescription",
    );
  });

  it("cannot drag the Inbox tile, and cannot drop a channel above it", () => {
    render(<ChannelRail channels={CHANNELS} selected={null} onSelect={vi.fn()} />);
    stubTileRects("y");
    const inbox = screen.getByRole("button", { name: "Inbox" });

    dragTile(inbox, { y: 60 });
    expect(inbox.style.transform).toBe("");
    expect(inbox).not.toHaveClass("channel-rail__tile--dragging");
    expect(renderedOrder()).toEqual(["Gmail", "Slack", "Agent"]);

    // A tile dragged up past everything lands at slot 0 of the plate — under Inbox, which never
    // gives up the top of the rail.
    dragTile(screen.getByRole("button", { name: "Agent" }), { y: -260 });
    expect(renderedOrder()).toEqual(["Agent", "Gmail", "Slack"]);
    expect(screen.getByRole("button", { name: "Inbox" })).toBeInTheDocument();
  });

  it("reorders on the x axis in the narrow shell, where the rail is a bottom bar", () => {
    stubNarrowRail(true);
    render(<ChannelRail channels={CHANNELS} selected={null} onSelect={vi.fn()} />);
    stubTileRects("x");
    const slack = screen.getByRole("button", { name: "Slack" });

    // A vertical drag is not this tier's axis: the bar scrolls, it does not reorder.
    dragTile(slack, { y: 100 });
    expect(renderedOrder()).toEqual(["Gmail", "Slack", "Agent"]);

    dragTile(slack, { x: 60 });
    expect(renderedOrder()).toEqual(["Gmail", "Agent", "Slack"]);
  });

  it("lifts a touch after the 350ms hold", () => {
    vi.useFakeTimers();
    render(<ChannelRail channels={CHANNELS} selected={null} onSelect={vi.fn()} />);
    stubTileRects("y");
    const slack = screen.getByRole("button", { name: "Slack" });

    fireEvent.pointerDown(slack, {
      button: 0,
      pointerId: 1,
      pointerType: "touch",
      clientX: 500,
      clientY: 500,
    });
    act(() => {
      vi.advanceTimersByTime(349);
    });
    expect(slack).not.toHaveClass("channel-rail__tile--dragging");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    // The lift lands where the tile stands, over --dur-fast — nothing has moved yet.
    expect(slack).toHaveClass("channel-rail__tile--dragging");
    expect(slack.style.transform).toBe("scale(1.08)");
    expect(slack.style.transition).toContain("var(--dur-fast)");
  });

  it("lets a finger that moves first scroll instead of lifting the tile", () => {
    vi.useFakeTimers();
    render(<ChannelRail channels={CHANNELS} selected={null} onSelect={vi.fn()} />);
    stubTileRects("y");
    const slack = screen.getByRole("button", { name: "Slack" });

    fireEvent.pointerDown(slack, {
      button: 0,
      pointerId: 1,
      pointerType: "touch",
      clientX: 500,
      clientY: 500,
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    // 20px at 100ms — the finger is scrolling, so the hold is abandoned and never comes back.
    fireEvent.pointerMove(slack, { pointerId: 1, clientX: 500, clientY: 520 });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(slack).not.toHaveClass("channel-rail__tile--dragging");
    expect(slack.style.transform).toBe("");
    expect(localStorage.getItem(RAIL_ORDER_STORAGE_KEY)).toBeNull();
  });

  it("reorders from the keyboard with Ctrl+Arrow and announces where the tile went", () => {
    const { container } = render(
      <ChannelRail channels={CHANNELS} selected={null} onSelect={vi.fn()} />,
    );
    const slack = screen.getByRole("button", { name: "Slack" });

    // Without Ctrl the arrows belong to the page, not the rail.
    fireEvent.keyDown(slack, { key: "ArrowDown" });
    expect(renderedOrder()).toEqual(["Gmail", "Slack", "Agent"]);

    fireEvent.keyDown(slack, { key: "ArrowDown", ctrlKey: true });
    expect(renderedOrder()).toEqual(["Gmail", "Agent", "Slack"]);
    expect(JSON.parse(localStorage.getItem(RAIL_ORDER_STORAGE_KEY) ?? "null")).toEqual([
      "gmail",
      "agent",
      "slack",
    ]);

    const live = container.querySelector(".channel-rail__announce");
    expect(live).toHaveAttribute("aria-live", "polite");
    expect(live).toHaveTextContent("Slack moved to position 3 of 3");

    // At the end of the rail the move is a no-op, and it does not announce a move that did not
    // happen.
    fireEvent.keyDown(slack, { key: "ArrowDown", ctrlKey: true });
    expect(renderedOrder()).toEqual(["Gmail", "Agent", "Slack"]);
    expect(live).toHaveTextContent("Slack moved to position 3 of 3");

    fireEvent.keyDown(slack, { key: "ArrowUp", ctrlKey: true });
    expect(renderedOrder()).toEqual(["Gmail", "Slack", "Agent"]);
    expect(live).toHaveTextContent("Slack moved to position 2 of 3");
  });

  it("reorders from the keyboard on the x axis in the narrow shell", () => {
    stubNarrowRail(true);
    render(<ChannelRail channels={CHANNELS} selected={null} onSelect={vi.fn()} />);
    const slack = screen.getByRole("button", { name: "Slack" });

    fireEvent.keyDown(slack, { key: "ArrowRight", ctrlKey: true });
    expect(renderedOrder()).toEqual(["Gmail", "Agent", "Slack"]);

    // ArrowDown is the wide rail's key, not this tier's.
    fireEvent.keyDown(slack, { key: "ArrowDown", ctrlKey: true });
    expect(renderedOrder()).toEqual(["Gmail", "Agent", "Slack"]);
  });
});
