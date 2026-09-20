// @vitest-environment jsdom
// US-D02: only the Agents view uses group headers (blocked -> working -> idle -> done -> failed).
// Needs-approval queries pending alone, so there is always exactly one group and the count goes on
// the tab pill instead of into a header. It reuses archive-inbox.test.tsx's table-tagging mock —
// Inbox needs different rows per query.
import "./setup";

import { fireEvent, render, screen } from "@testing-library/react";
import { VirtuosoMockContext } from "react-virtuoso";
import { describe, expect, it, vi } from "vitest";

const THREADS = {
  pending: "11111111-1111-1111-1111-111111111111",
  decided: "22222222-2222-2222-2222-222222222222",
  pending2: "88888888-8888-8888-8888-888888888888",
  blocked: "55555555-5555-5555-5555-555555555555",
  working: "66666666-6666-6666-6666-666666666666",
  agentEmail: "77777777-7777-7777-7777-777777777777",
} as const;

/** The default is a human thread (kind='email'). Only agent_session rows group by session
 *  state. */
function item(threadId: string, title: string, over: Record<string, unknown> = {}) {
  return {
    id: `item-${threadId}`,
    thread_id: threadId,
    account_id: "acct-1",
    status: "received",
    scope: "work",
    subject: null,
    body: `${title} body`,
    sent_at: Date.now(),
    author_person_id: null,
    author_agent_id: null,
    thread: {
      id: threadId,
      kind: "email",
      title,
      external_id: title,
      meta: {},
      unread_count: 0,
      archived_at: null,
    },
    author: null,
    ...over,
  };
}

function agentItem(threadId: string, title: string) {
  return item(threadId, title, {
    thread: {
      id: threadId,
      kind: "agent_session",
      title,
      external_id: title,
      meta: {},
      unread_count: 0,
      archived_at: null,
    },
  });
}

const store: Record<string, unknown[]> = {
  items: [
    item(THREADS.pending, "Waiting thread"),
    item(THREADS.decided, "Decided thread"),
    item(THREADS.pending2, "Waiting thread 2"),
    agentItem(THREADS.blocked, "Blocked session"),
    agentItem(THREADS.working, "Running session"),
    // Sent by an agent but not an agent_session — there is no session state to group it by, so it
    // lands in the ungrouped bucket.
    item(THREADS.agentEmail, "Agent mail", { author_agent_id: "agent-1" }),
  ],
  accounts: [{ id: "acct-1", channel: "gmail" }],
  // Two pending plus one already decided. The decided one is filtered out by Inbox's
  // `.where("state","=","pending")`, and the mock below actually applies that where — which is
  // what makes this fixture feed the screen the same rows production would.
  pending_approvals: [
    { id: "ap-1", thread_id: THREADS.pending, state: "pending", decision: null, created_at: 1 },
    { id: "ap-5", thread_id: THREADS.pending2, state: "pending", decision: null, created_at: 5 },
    {
      id: "ap-2",
      thread_id: THREADS.decided,
      state: "executed",
      decision: "accept",
      created_at: 2,
    },
  ],
  labels: [],
  thread_labels: [],
  agent_sessions: [
    {
      id: "as-1",
      thread_id: THREADS.blocked,
      session_key: "k1",
      state: "waiting_approval",
      started_at: 1,
      runtime_id: "rt-1",
    },
    {
      id: "as-2",
      thread_id: THREADS.working,
      session_key: "k2",
      state: "running",
      started_at: 2,
      runtime_id: "rt-1",
    },
  ],
  agent_runtimes: [{ id: "rt-1", runtime: "claude_code" }],
};

/** zero.query.<table>....(chain) -> the tag plus the accumulated where clauses.
 *  A mock that discards `where` can feed the screen rows the production query could never produce
 *  (which is exactly what happened in round two: the whole approval lifecycle went in and the test
 *  asserted several groups). Only `=` and `!=` are interpreted — those are the operators Inbox
 *  uses — and an unknown operator throws rather than leaking through quietly. */
type Where = [string, string, unknown];
function taggedQuery(table: string, wheres: Where[] = []): unknown {
  const proxy: unknown = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === "__table") return table;
        if (prop === "__wheres") return wheres;
        if (prop === "where")
          return (field: string, op: string, value: unknown) =>
            taggedQuery(table, [...wheres, [field, op, value]]);
        return () => proxy;
      },
    },
  );
  return proxy;
}
const zero = { query: new Proxy({}, { get: (_t, table) => taggedQuery(String(table)) }) };

function runQuery(q: { __table: string; __wheres: Where[] }): unknown[] {
  const rows = store[q.__table] ?? [];
  return rows.filter((row) =>
    q.__wheres.every(([field, op, value]) => {
      if (op !== "=" && op !== "!=") throw new Error(`operator not handled by this mock: ${op}`);
      const actual = (row as Record<string, unknown>)[field];
      return op === "=" ? actual === value : actual !== value;
    }),
  );
}

vi.mock("../src/zero-client.js", () => ({
  initZero: () => zero,
  useZeroClient: () => zero,
  loadZeroToken: async () => {},
}));
vi.mock("@rocicorp/zero/react", () => ({
  useQuery: (q: { __table: string; __wheres: Where[] }) => [runQuery(q), { type: "complete" }],
  useZero: () => zero,
  ZeroProvider: ({ children }: { children: unknown }) => children,
}));

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const { Inbox } = await import("../src/screens/Inbox");

vi.stubGlobal(
  "fetch",
  vi.fn(async () => ({ ok: true, json: async () => ({}) })),
);

const renderInbox = () =>
  render(
    <VirtuosoMockContext.Provider value={{ viewportHeight: 800, itemHeight: 72 }}>
      <Inbox />
    </VirtuosoMockContext.Provider>,
  );

/** The order the group headers sit in the DOM is the order they appear on screen. Read by tone
 *  rather than by label: the tones are a one-to-one mapping of the agent states
 *  (status-pill.tsx AGENT_META — blocked is warning, working is info), and unlike the labels they
 *  are not product copy that the app's i18n layer owns. */
const headerTones = (container: HTMLElement): string[] =>
  [...container.querySelectorAll(".group-header .status-pill")].map(
    (el) => el.getAttribute("data-tone") ?? "",
  );

/** The count is a separate chip outside the pill (the reference's grammar). */
const headerCounts = (container: HTMLElement): string[] =>
  [...container.querySelectorAll(".group-header__count")].map((el) => el.textContent ?? "");

const rowNames = (): string[] =>
  screen.getAllByRole("option").map((r) => r.querySelector(".inbox-row__name")?.textContent ?? "");

// The needs-approval pill's accessible name carries the count ("needs-approval 2"), so it is
// matched by prefix.
const filterTab = (name: string) =>
  screen.getByRole("radio", { name: (n: string) => n.startsWith(name) });
const filterBy = (name: string) => fireEvent.click(filterTab(name));

describe("Inbox group headers (US-D02)", () => {
  it("puts blocked above working in the agents view", () => {
    const { container } = renderInbox();
    filterBy("agents");

    // Compared against the badge's own state hooks rather than its text: the state labels are
    // product copy that still goes through the app's Korean-first i18n layer.
    expect(headerTones(container)).toEqual(["warning", "info"]);
    expect(headerCounts(container)).toEqual(["1", "1"]);
  });

  it("leaves an agent row with no session state at the end, under no header", () => {
    const { container } = renderInbox();
    filterBy("agents");

    // Only two headers — an ungrouped row cannot be given a state label.
    expect(container.querySelectorAll(".group-header")).toHaveLength(2);
    expect(rowNames()).toEqual(["Blocked session", "Running session", "Agent mail"]);
  });

  // With the header saying the state directly above it, a row repeating the same word makes the
  // screen read "needs approval / needs approval" (round two's rejection). Filling that slot with
  // a channel glyph instead makes a runtime session row claim to be a Slack message (round
  // three's rejection) — a session row's right slot is left empty.
  it("neither repeats the status badge nor swaps in a channel glyph when grouped", () => {
    const { container } = renderInbox();
    filterBy("agents");
    expect(container.querySelectorAll(".status-badge--agent")).toHaveLength(0);
    // The two session rows have an empty slot; only the non-session "Agent mail" row keeps a
    // channel glyph.
    expect(container.querySelectorAll(".inbox-row__channel-icon")).toHaveLength(1);
    expect(screen.queryByLabelText("Gmail message")).toBeInTheDocument();
  });

  it("keeps the status badge on the row in a view with no groups", () => {
    const { container } = renderInbox();
    filterBy("all");
    expect(container.querySelectorAll(".status-badge--agent")).toHaveLength(2);
  });

  // Needs-approval queries pending alone, so there is always one group — a header band would only
  // repeat the name of the tab just chosen, so the count folds into the tab pill instead.
  it("puts the pending count on the tab pill rather than in a header", () => {
    const { container } = renderInbox();
    expect(filterTab("needs-approval")).toHaveTextContent("2");

    filterBy("needs-approval");
    expect(container.querySelectorAll(".group-header")).toHaveLength(0);
    expect(rowNames()).toEqual(["Waiting thread", "Waiting thread 2"]);
  });

  // On the needs-approval tab every row is pending, so a dot on each of them distinguishes
  // nothing. On any other tab it still means "this one is waiting on your decision", so it stays.
  it("hides the row's pending-approval dot on needs-approval and shows it elsewhere", () => {
    const { container } = renderInbox();
    filterBy("all");
    expect(container.querySelectorAll(".inbox-row__approval-dot").length).toBeGreaterThan(0);

    filterBy("needs-approval");
    expect(container.querySelectorAll(".inbox-row__approval-dot")).toHaveLength(0);
  });

  // Every other filter, and Archived, must stay flat — grouping leaking into them is a
  // regression.
  it("draws no group headers in the all/work/personal filters or the Archived view", () => {
    const { container } = renderInbox();
    expect(container.querySelectorAll(".group-header")).toHaveLength(0);

    for (const name of ["work", "personal"]) {
      filterBy(name);
      expect(container.querySelectorAll(".group-header")).toHaveLength(0);
    }

    filterBy("agents");
    expect(container.querySelectorAll(".group-header")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    expect(container.querySelectorAll(".group-header")).toHaveLength(0);
  });
});
