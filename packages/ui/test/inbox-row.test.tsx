// @vitest-environment jsdom
// The root `pnpm test` (vitest.workspace.ts) does not read packages/ui/vitest.config.ts, so the
// file declares its own environment and setup (jest-dom matchers + afterEach(cleanup)).
import "./setup";

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InboxRow } from "../src/components/inbox-row";

const baseProps = {
  id: "thread-1",
  name: "Sora Kim",
  timestamp: "3m",
  summary: "Please take a look at the meeting notes",
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

describe("InboxRow (U2 kinso conversation row, one per thread)", () => {
  it("renders name, timestamp, summary, avatar, channel icon and calls onSelect with the thread id", () => {
    render(<InboxRow {...baseProps} />);
    expect(screen.getByText("Sora Kim")).toBeInTheDocument();
    expect(screen.getByText("3m")).toBeInTheDocument();
    expect(screen.getByText("Please take a look at the meeting notes")).toBeInTheDocument();
    expect(screen.getByLabelText("Sora Kim")).toBeInTheDocument(); // avatar
    expect(screen.getByLabelText("Slack message")).toBeInTheDocument(); // channel brand mark
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

  // US-D08 §c.4: the dot moved out of the meta line into the row's own leading column, so it is the
  // avatar's sibling and not the name's. The difference is not cosmetic — inside the meta line it
  // pushed the name and the time along by its own width, and every unread row in the list was
  // indented against every read one.
  it("puts the unread dot in the row's gutter, beside the avatar rather than the name", () => {
    const { container } = render(<InboxRow {...baseProps} unread={true} />);
    // US-D08 §c.4: the grid is on the content wrapper since the swipe — the row's own box carries
    // the padding and the hairline, and this half is what translates.
    const content = container.querySelector(".inbox-row__content");
    const dot = container.querySelector(".inbox-row__unread-dot");

    expect(dot?.parentElement).toBe(content);
    expect(container.querySelector(".inbox-row__meta")?.contains(dot)).toBe(false);
    // Order says which grid column it takes: the dot is placed before the avatar, and app.css gives
    // the two of them columns 1 and 2 respectively.
    expect(content?.firstElementChild).toBe(dot);
  });

  // US-D08 §c.4: the list says which row is last, because Virtuoso gives every row its own wrapper
  // and a `:last-child` selector in CSS would therefore be true of all of them.
  it("marks the last row of the list so the hairline under it can be dropped", () => {
    const { container: withLast } = render(<InboxRow {...baseProps} last={true} />);
    expect(withLast.querySelector(".inbox-row")).toHaveClass("inbox-row--last");

    const { container: without } = render(<InboxRow {...baseProps} />);
    expect(without.querySelector(".inbox-row")).not.toHaveClass("inbox-row--last");
  });

  it("prefixes draft summaries with 'Draft: ' (A5 §3.1)", () => {
    render(<InboxRow {...baseProps} isDraft={true} summary="Yes, got it" />);
    expect(screen.getByText("Draft: Yes, got it")).toBeInTheDocument();
  });

  it("shows at most 2 chips + N more, scope label first (A5 §3.1 priority)", () => {
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

// US-D02b: a channel mark is the real brand PNG, not a monochrome react-icons SVG. Vite may
// rewrite the hashed asset URL, so only the filename and the 1x/2x suffixes are asserted.
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

  // KakaoTalk's yellow tile now lives inside the PNG rather than in a CSS background — wrapping
  // it again would double-frame the mark.
  it("does not wrap KakaoTalk in a CSS tile on top of the baked-in one", () => {
    render(<InboxRow {...baseProps} channel="kakaotalk" />);
    const wrap = screen.getByLabelText("KakaoTalk message");
    expect(wrap.querySelector(".channel-glyph--tiled")).toBeNull();
    expect(wrap.querySelector("img")?.getAttribute("src")).toMatch(/kakaotalk@1x\.png$/);
  });
});

describe("InboxRow avatar (U2: photo -> initials+pastel fallback; agent_session shows its runtime logo)", () => {
  it("shows initials on a pastel background when there is no photo", () => {
    render(<InboxRow {...baseProps} avatar={{ kind: "initials", name: "Sora Kim" }} />);
    expect(screen.getByLabelText("Sora Kim")).toHaveTextContent("SK");
  });

  it("shows the runtime logo for an agent session row and a status badge instead of the channel icon", () => {
    const { container } = render(
      <InboxRow
        {...baseProps}
        avatar={{ kind: "runtime", runtime: "claude_code" }}
        agentState="blocked"
      />,
    );
    const avatarEl = screen.getByLabelText("Claude Code session");
    expect(avatarEl).toBeInTheDocument();
    expect(avatarEl.querySelector("svg")).toBeInTheDocument(); // the Anthropic brand mark
    // Asserted through the badge's own DOM hook rather than its text: the agent state labels are
    // product copy that still goes through the app's Korean-first i18n layer, and this test is
    // about which slot the row fills, not about what that copy says today.
    expect(container.querySelector(".status-badge--agent")).toBeInTheDocument();
    expect(screen.queryByLabelText("Slack message")).not.toBeInTheDocument();
  });

  // When the group header already says the state (the Agents view), the row does not repeat it —
  // but filling that slot with a channel glyph makes a runtime session row claim to be a "Slack
  // message". The slot is left empty instead.
  it("draws neither the status badge nor a stand-in channel glyph under groupedByState", () => {
    const { container } = render(
      <InboxRow
        {...baseProps}
        avatar={{ kind: "runtime", runtime: "claude_code" }}
        agentState="blocked"
        groupedByState={true}
      />,
    );
    expect(container.querySelector(".status-badge--agent")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Slack message")).not.toBeInTheDocument();
  });

  // For a non-session row (agentState null) the channel is a true fact about that row, even mixed
  // into a grouped view.
  it("keeps the channel glyph on non-session rows even under groupedByState", () => {
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

describe("InboxRow list (U2: one row per thread)", () => {
  it("renders one row per thread, each with an avatar, name, time, summary and brand icon", () => {
    const rows = [
      {
        ...baseProps,
        id: "t1",
        name: "Sora Kim",
        summary: "Please take a look at the meeting notes",
      },
      {
        ...baseProps,
        id: "t2",
        name: "#omnis-launch",
        summary: "three adapter tests failing",
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
    expect(screen.getByText("Please take a look at the meeting notes")).toBeInTheDocument();
    expect(screen.getByLabelText("Slack message")).toBeInTheDocument();
    expect(screen.getByText("#omnis-launch")).toBeInTheDocument();
    expect(screen.getByText("three adapter tests failing")).toBeInTheDocument();
    expect(screen.getByLabelText("Codex session")).toBeInTheDocument();
  });
});

describe("InboxRow archive action (US-A36)", () => {
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

describe("InboxRow hover card (US-D02)", () => {
  // The card only opens after openDelay (400ms) — fake timers advance exactly that 400ms (the
  // same pattern as command-palette.test.tsx's closing-spring test).
  afterEach(() => vi.useRealTimers());

  function hoverRow(over: Partial<typeof baseProps> & Record<string, unknown> = {}) {
    vi.useFakeTimers();
    render(<InboxRow {...baseProps} {...over} />);
    // Radix HoverCard 1.1.23's trigger listens to pointer events only — mouseEnter never opens
    // it.
    fireEvent.pointerEnter(screen.getAllByRole("option")[0] as HTMLElement);
    return () => document.querySelector(".row-hover-card") as HTMLElement | null;
  }

  it("stays absent before hover and only appears once 400ms have passed", () => {
    const card = hoverRow();

    // Sweeping the pointer down the list must not flash a card on every row.
    expect(card()).toBeNull();

    // Still absent right up to 400ms — that delay is the hover intent.
    act(() => vi.advanceTimersByTime(399));
    expect(card()).toBeNull();

    act(() => vi.advanceTimersByTime(1));
    expect(card()).not.toBeNull();
  });

  // The card's reason to exist: the full summary the row had to line-clamp.
  it("shows the full summary the row clipped, plus the channel and unread count it omits", () => {
    const long =
      "Asks you to share the latest Brightstone Realty sales contract. Two clauses moved since " +
      "last week's review, and they need a reply by Friday.";
    const card = hoverRow({ summary: long, unreadCount: 3 });
    act(() => vi.advanceTimersByTime(400));
    const meta = within(card() as HTMLElement);

    expect(meta.getByText(long)).toBeInTheDocument();
    expect(meta.getByText("Channels")).toBeInTheDocument();
    expect(meta.getByText("Slack")).toBeInTheDocument();
    expect(meta.getByText("Unread")).toBeInTheDocument();
    expect(meta.getByText("3")).toBeInTheDocument();
    expect(meta.getByText("Last contact")).toBeInTheDocument();
    expect(meta.getByText("3m")).toBeInTheDocument();
  });

  // US-D03: the hover card's body is the shared PersonCard — the same avatar/badge/table block the
  // Network screen will draw. The person facts the row cannot show (relationship state, VIP) come
  // through it.
  it("carries the person's relationship state and VIP badge", () => {
    const card = hoverRow({
      person: { vip: true, relationshipState: "active" as const },
    });
    act(() => vi.advanceTimersByTime(400));
    const meta = within(card() as HTMLElement);
    expect(meta.getByText("Relationship")).toBeInTheDocument();
    expect(meta.getByText("Active")).toBeInTheDocument();
    expect(meta.getByText("VIP")).toBeInTheDocument();
  });

  // The card does not repeat the row. The title (the name) appears once, and labels the row
  // already showed in full as chips do not come back in the card.
  it("does not repeat what the row already showed in full", () => {
    const card = hoverRow({ unreadCount: 0 });
    act(() => vi.advanceTimersByTime(400));
    const meta = within(card() as HTMLElement);

    expect(meta.getAllByText("Sora Kim")).toHaveLength(1);
    expect(meta.queryByText("Labels")).not.toBeInTheDocument();
    expect(meta.queryByText("Unread")).not.toBeInTheDocument();
  });

  // The full label list only adds value when the row clipped it to two chips plus "+N". The card
  // shows them as the person card's badge row — a label the row already drew in full as a chip
  // does not come back as a second chip here.
  it("lists every label once the chips have clipped some away", () => {
    const card = hoverRow({
      labels: [
        { kind: "scope" as const, name: "work", color: null },
        { kind: "topic" as const, name: "davich", color: null },
        { kind: "topic" as const, name: "contract", color: null },
      ],
    });
    act(() => vi.advanceTimersByTime(400));
    const meta = within(card() as HTMLElement);
    const badgeList = (card() as HTMLElement).querySelector(".person-card__badges");
    const badges = within(badgeList as HTMLElement);
    expect(badges.getByText("work")).toBeInTheDocument();
    expect(badges.getByText("davich")).toBeInTheDocument();
    expect(badges.getByText("contract")).toBeInTheDocument();
    // The unscoped row shows one chip, the card shows all three — nothing is repeated twice
    // inside the card itself.
    expect(meta.queryByText("Labels")).not.toBeInTheDocument();
  });

  // An agent_session row's right slot is a status badge rather than a channel mark, and the row
  // has no person behind it — so a "Channels" line would mean nothing.
  it("omits the channel line on an agent session row", () => {
    const card = hoverRow({
      agentState: "working" as const,
      avatar: { kind: "runtime" as const, runtime: "claude_code" as const },
    });
    act(() => vi.advanceTimersByTime(400));
    expect(within(card() as HTMLElement).queryByText("Channels")).not.toBeInTheDocument();
  });
});

// US-D09 §c.7: the row's `…`. The swipe is the row's gesture, so guard 11 wants a way to reach the
// same action without it — and the contextual menu is where the row's actions are enumerated. What
// these assert is that the enumeration is the row's own: the menu says what the pill says, from the
// same `archived` flag, and pressing it calls the same handler.
describe("InboxRow contextual menu (US-D09 §c.7)", () => {
  /** A press, not a bare click: jsdom's `click` never focuses the element it fires on, and Radix
   *  hands focus back to whatever was focused when the panel opened. */
  function openMenu(): HTMLElement {
    const trigger = screen.getByRole("button", { name: "More actions" });
    trigger.focus();
    fireEvent.click(trigger);
    return screen.getByRole("dialog");
  }

  it("shows Open and the archive action, and does not open the thread on the way", () => {
    const onSelect = vi.fn();
    const onArchive = vi.fn();
    render(<InboxRow {...baseProps} onSelect={onSelect} onArchive={onArchive} />);

    const menu = openMenu();
    expect(within(menu).getByText("Open")).toBeInTheDocument();
    expect(within(menu).getByText("Archive")).toBeInTheDocument();
    // The row is one big click target, so without the trigger stopping propagation, opening the
    // menu would also open the thread behind it.
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("runs the row's own open and archive, with the row's id", () => {
    const onSelect = vi.fn();
    const onArchive = vi.fn();
    render(<InboxRow {...baseProps} onSelect={onSelect} onArchive={onArchive} />);

    fireEvent.click(within(openMenu()).getByText("Archive"));
    expect(onArchive).toHaveBeenCalledWith("thread-1");
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(within(openMenu()).getByText("Open"));
    expect(onSelect).toHaveBeenCalledWith("thread-1");
  });

  // The reviewer's check, asserted where it can actually fail: the menu's second row is read
  // against the pill in the same render, so a row that says "Restore" on one and "Archive" on the
  // other is caught by its own inconsistency rather than by a hardcoded string that agrees with one
  // of them.
  it.each([false, true])("lists the swipe action the row is showing (archived=%s)", (archived) => {
    const { container } = render(
      <InboxRow {...baseProps} archived={archived} onArchive={vi.fn()} />,
    );
    const pillLabel = container.querySelector(".inbox-row__action")?.textContent;

    const menu = openMenu();
    expect(pillLabel).toBe(archived ? "Restore" : "Archive");
    expect(within(menu).getByText(pillLabel as string)).toBeInTheDocument();
  });

  it("keeps Open when the row has nothing to archive", () => {
    // A row with no archive action has no swipe either, so the check above is vacuous for it —
    // but the `…` still has to be there and still has to do something.
    render(<InboxRow {...baseProps} />);
    const menu = openMenu();
    expect(within(menu).getByText("Open")).toBeInTheDocument();
    expect(within(menu).queryByText("Archive")).not.toBeInTheDocument();
  });
});
