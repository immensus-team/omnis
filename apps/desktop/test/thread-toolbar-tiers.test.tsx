// @vitest-environment jsdom
// US-D09 §c.5: the thread screen is the one place where two of the reviewer's DOM checks have to be
// made against a real render — that the pane never holds two toolbars, that no glass surface ends up
// inside another one, and that the approval card and the tool-call badge are opaque and *in* the
// message flow rather than in a column beside it. thread-screen.test.tsx covers the merge itself as
// a pure function; this file renders the screen and inspects the tree.
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

/** The narrow tier is a JS breakpoint (lib/media-query.ts), not CSS, because Thread.tsx has to
 *  choose *where* to render the bar rather than hide one of two. */
const REAL_MATCH_MEDIA = window.matchMedia;
afterEach(() => {
  window.matchMedia = REAL_MATCH_MEDIA;
});
function stubNarrow(): void {
  window.matchMedia = ((query: string) => ({
    media: query,
    matches: true,
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
    renderThread();

    expect(toolbars()).toHaveLength(1);
    const bar = document.querySelector(".thread-toolbar--pane");
    expect(bar).not.toBeNull();
    expect(bar).toHaveClass("glass-surface");
    expect(bar).toHaveAttribute("data-glass-slot", "toolbar");
    // The floating tier's class is what app.css positions by; carrying both would put the wide bar
    // in the BottomBar's row.
    expect(bar).not.toHaveClass("thread-toolbar--floating");
    // archive is the one write this screen owns; reply is gated on Phase B.
    expect(screen.getByRole("button", { name: "Archive thread" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reply" })).toBeDisabled();
  });

  it("narrow: one floating bar, portaled out of the pane", () => {
    stubNarrow();
    renderThread();

    expect(toolbars()).toHaveLength(1);
    const bar = document.querySelector(".thread-toolbar--floating");
    expect(bar).not.toBeNull();
    expect(bar).toHaveClass("glass-surface");
    expect(document.querySelector(".thread-toolbar--pane")).toBeNull();
    // It has to live outside `.thread-screen`: at this tier the pane is a fixed sheet carrying
    // `backdrop-filter`, which would make it the containing block for a fixed descendant and land
    // the bar above the BottomBar instead of in its line.
    expect(bar?.parentElement).toBe(document.body);
    expect(document.querySelector(".thread-screen")?.contains(bar ?? null)).toBe(false);
  });

  it("never puts a glass surface inside another one, in either tier", () => {
    for (const narrow of [false, true]) {
      if (narrow) stubNarrow();
      const { unmount } = renderThread();
      expect(nestedGlass()).toEqual([]);
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
