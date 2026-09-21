// @vitest-environment jsdom
// US-D09 §c.5: the thread screen is the one place where two of the reviewer's DOM checks have to be
// made against a real render — that the pane never holds two toolbars, that no glass surface ends up
// inside another one, and that the approval card and the tool-call badge are opaque and *in* the
// message flow rather than in a column beside it. thread-screen.test.tsx covers the merge itself as
// a pure function; this file renders the screen and inspects the tree. US-C17's composer slot is the
// same kind of check — `composerBlockFor` decides, and this file is where the pane is asked whether
// that decision reaches the DOM.
//
// archive-inbox.test.tsx's table-tagged store is reused rather than invented: Thread runs seven
// queries and app-shell.test.tsx's single-value proxy would answer all seven the same.
import "./setup";

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const THREAD = "11111111-1111-1111-1111-111111111111";
const OTHER_THREAD = "22222222-2222-2222-2222-222222222222";
const HOUR = 3_600_000;

const APPROVAL = {
  id: "approval-1",
  thread_id: THREAD,
  risk: "normal",
  created_at: Date.now() - HOUR,
  action: "send",
  description: "Send the follow-up to the launch thread",
  config: { allow_accept: true, allow_edit: true, allow_respond: true, allow_ignore: true },
};

const store: Record<string, unknown[]> = {
  items: [
    {
      id: "item-1",
      thread_id: THREAD,
      status: "received",
      body: "First message",
      sent_at: Date.now() - 2 * HOUR,
      author: { display_name: "Sora Kim" },
    },
    {
      id: "item-2",
      thread_id: THREAD,
      status: "received",
      kind: "tool_call",
      body: "12 rows written",
      sent_at: Date.now() - HOUR / 2,
      // From master §11's palette: the badge throws on anything else rather than drawing an empty
      // pill, so a fixture that invents a tool name fails in a way that has nothing to do with §c.5.
      tool: { name: "read_calendar", state: "done" },
      author: null,
    },
    {
      id: "item-3",
      thread_id: THREAD,
      status: "received",
      body: "Second message",
      sent_at: Date.now(),
      author: { display_name: "Sora Kim" },
    },
  ],
  threads: [
    {
      id: THREAD,
      account_id: "acct-1",
      external_id: "thread-external-1",
      title: "Launch follow-up",
      scope: "work",
      participants: [],
      meta: {},
      last_item_at: Date.now(),
      unread_count: 0,
      created_at: Date.now() - 3 * HOUR,
      archived_at: null,
    },
  ],
  accounts: [{ id: "acct-1", channel: "gmail" }],
  persons: [],
  notes: [],
  labels: [],
  thread_labels: [],
  // Deliberately another thread's approval: §c.5 scopes the flow to the thread on screen, so this
  // one must not appear at all. Its description is its own, so the assertion below can tell the two
  // apart instead of matching the copy they would otherwise share.
  pending_approvals: [
    {
      ...APPROVAL,
      id: "approval-other",
      thread_id: OTHER_THREAD,
      description: "Another thread's approval",
    },
  ],
};

/** zero.query.<table>....(chain) -> { __table }. Every chain method returns the proxy itself. */
function taggedQuery(table: string): unknown {
  const proxy: unknown = new Proxy(
    {},
    { get: (_t, prop) => (prop === "__table" ? table : () => proxy) },
  );
  return proxy;
}
const zero = { query: new Proxy({}, { get: (_t, table) => taggedQuery(String(table)) }) };

vi.mock("../src/zero-client.js", () => ({
  initZero: () => zero,
  useZeroClient: () => zero,
  loadZeroToken: async () => {},
}));
vi.mock("@rocicorp/zero/react", () => ({
  useQuery: (q: { __table: string }) => [store[q.__table] ?? [], { type: "complete" }],
  useZero: () => zero,
  ZeroProvider: ({ children }: { children: unknown }) => children,
}));

const { Thread } = await import("../src/screens/Thread");

/** Both shell tiers are JS breakpoints (lib/media-query.ts), not CSS, because Thread.tsx has to
 *  choose *where* to render the bar rather than hide one of two. jsdom has no layout, so the two
 *  queries are answered by hand: a tier is the pair of answers they get.
 *
 *  `wide` is the real jsdom default (matchMedia reports nothing as matching), kept as an explicit
 *  case so every test states its tier rather than relying on that. */
const REAL_MATCH_MEDIA = window.matchMedia;
afterEach(() => {
  window.matchMedia = REAL_MATCH_MEDIA;
});
function stubTier(tier: "wide" | "floating" | "narrow"): void {
  window.matchMedia = ((query: string) => ({
    media: query,
    matches:
      query.includes("899.98") === true
        ? tier === "narrow"
        : query.includes("1279.98") === true
          ? tier !== "wide"
          : false,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

const renderThread = () =>
  render(<Thread threadId={THREAD} approvals={[APPROVAL]} onDecide={() => {}} />);

const toolbars = () => document.querySelectorAll(".thread-toolbar");

/** Reviewer check 2, as a predicate: the DOM, not the source. A portaled panel is a child of the
 *  body, so this walks every glass surface in the document, wherever it ended up. */
function nestedGlass(): Element[] {
  return [...document.querySelectorAll(".glass-surface")].filter((el) => {
    const parent = el.parentElement;
    return parent !== null && parent.closest(".glass-surface") !== null;
  });
}

describe("Thread toolbar tiers (US-D09 §c.5/§c.9)", () => {
  it("wide: one sticky bar in the pane, and it is the glass", () => {
    stubTier("wide");
    renderThread();

    expect(toolbars()).toHaveLength(1);
    const bar = document.querySelector(".thread-toolbar--pane");
    expect(bar).not.toBeNull();
    expect(bar).toHaveClass("glass-surface");
    expect(bar).toHaveAttribute("data-glass-slot", "toolbar");
    // The pane is an opaque grid column at this tier, so the bar is a child of it — that is the
    // arrangement the glass recipe is for.
    expect(document.querySelector(".thread-screen")?.contains(bar ?? null)).toBe(true);
    // archive is the one write this screen owns; reply is gated on Phase B.
    expect(screen.getByRole("button", { name: "Archive thread" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reply" })).toBeDisabled();
  });

  // 900–1279.98: `@container shell (max-width: 1279.98px)` makes the pane itself a glass sheet, so
  // the bar may not be a second glass layer inside it (ACCENT §4.4). It becomes the sheet's chrome
  // row instead: the same buttons, no material, and no `.glass-surface` on the element at all —
  // which is what makes the nesting absent from the DOM rather than merely overridden by CSS.
  it("floating pane: one bar, with no material of its own and outside the scroller", () => {
    stubTier("floating");
    renderThread();

    expect(toolbars()).toHaveLength(1);
    const bar = document.querySelector(".thread-toolbar--pane");
    expect(bar).not.toBeNull();
    expect(bar).toHaveClass("thread-toolbar--chrome");
    expect(bar).not.toHaveClass("glass-surface");
    expect(bar).not.toHaveAttribute("data-glass-slot");
    // A sibling of the scroller, not a row inside it: app.css turns the pane into a column at this
    // tier and `.thread-screen` into the scroller, so a bar left in the flow would scroll away with
    // the message — and a sticky one with no field behind it would let the message travel through
    // the glyphs.
    const scroller = document.querySelector(".thread-screen");
    expect(scroller?.contains(bar ?? null)).toBe(false);
    // Above the scroller in document order too, which is the other half of "chrome row": app.css
    // right-aligns it as the pane's first flex item.
    expect(
      scroller !== null &&
        bar !== null &&
        (bar.compareDocumentPosition(scroller) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    ).toBe(true);
    // Same controls as the wide tier, so nothing is lost by the material change.
    expect(screen.getByRole("button", { name: "Archive thread" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reply" })).toBeDisabled();
  });

  // S5: below 900 the pane is the same `vaul` drawer the filters come up in, so the bar is that
  // drawer's chrome row — the same shape it already has at 900–1279.98, and for the same reason (the
  // drawer's own field is the material). What it is *not* any more is the floating bar that used to
  // be portaled into the BottomBar's line: a modal drawer owns the pointer for everything outside
  // itself, so a bar under its scrim would have been visible and untouchable.
  it("narrow: the same chrome row as the sheet tier, above the drawer's scroller", () => {
    stubTier("narrow");
    renderThread();

    expect(toolbars()).toHaveLength(1);
    const bar = document.querySelector(".thread-toolbar--pane");
    expect(bar).not.toBeNull();
    expect(bar).toHaveClass("thread-toolbar--chrome");
    expect(bar).not.toHaveClass("glass-surface");
    // Nothing is portaled out of the pane at this tier: the drawer is the pane, and a row of the
    // pane is what the user sees inside it.
    expect(bar?.parentElement).not.toBe(document.body);
    // A sibling of the scroller rather than a row inside it — the drawer's column does the same job
    // the sheet's did, so a bar in the flow would scroll away with the conversation.
    expect(document.querySelector(".thread-screen")?.contains(bar ?? null)).toBe(false);
    expect(screen.getByRole("button", { name: "Archive thread" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reply" })).toBeDisabled();
  });

  it("never puts a glass surface inside another one, in any tier", () => {
    for (const tier of ["wide", "floating", "narrow"] as const) {
      stubTier(tier);
      const { unmount } = renderThread();
      expect(nestedGlass(), `tier ${tier}`).toEqual([]);
      unmount();
    }
  });

  it("keeps the approval and the tool call opaque and in the message flow, in order", () => {
    renderThread();

    const first = screen.getByText("First message");
    const card = document.querySelector(".approval-card");
    const badge = document.querySelector(".tool-call-badge");
    const second = screen.getByText("Second message");

    expect(card).not.toBeNull();
    expect(badge).not.toBeNull();
    // §c.5/ACCENT §4.4: the content layer is opaque. Glass here would be the chrome/canvas mix-up.
    expect(card).toHaveClass("opaque-surface");
    expect(badge).toHaveClass("opaque-surface");
    expect(card).not.toHaveClass("glass-surface");
    expect(badge).not.toHaveClass("glass-surface");

    // Between the two messages — the same node, no wrapper column, and the flow's own order.
    const follows = (a: Element | null, b: Element | null) =>
      a !== null &&
      b !== null &&
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(follows(first, card)).toBe(true);
    expect(follows(card, badge)).toBe(true);
    expect(follows(badge, second)).toBe(true);

    // The other thread's approval is not in this conversation.
    expect(screen.queryByText("Another thread's approval")).not.toBeInTheDocument();
  });
});

/** US-C17: `composerBlockFor` picks the state (composer-state.test.tsx pins which) and Thread draws
 *  it in the composer's slot. That last step is the screen's own branch, so it is asserted against a
 *  render: the account's `capabilities` is what the answer is made of, and an account without one is
 *  the case where the pane must stay out of the way. */
describe("Thread composer slot (US-C17)", () => {
  const accounts = store.accounts;
  afterEach(() => {
    store.accounts = accounts;
  });

  it("draws the channel's state at the end of the conversation when its send is closed", () => {
    store.accounts = [
      { id: "acct-1", channel: "kakaotalk", capabilities: { write: false, kakaoDaysRemaining: 9 } },
    ];

    renderThread();

    const block = document.querySelector(".composer-state");
    expect(block).not.toBeNull();
    expect(block).toHaveAttribute("data-kind", "kakao_countdown");
    expect(screen.getByText("Sending opens in 9 days")).toBeInTheDocument();
    // The slot, not a message: it follows the conversation's last item rather than sitting in it.
    const last = screen.getByText("Second message");
    expect(
      block !== null &&
        last !== null &&
        (last.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    ).toBe(true);
  });

  it("draws nothing extra for a channel with nothing to announce", () => {
    // The store's own account is gmail and carries no capabilities — the composer's slot is empty,
    // and a block here would be a claim about a channel that has no capture-side state to report.
    renderThread();

    expect(document.querySelector(".composer-state")).toBeNull();
  });
});
