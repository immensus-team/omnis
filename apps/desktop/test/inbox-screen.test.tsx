// @vitest-environment jsdom
// The screen's pure rules (filtering, titles, summaries, ordering, grouping) plus, since loop-r2-05,
// its loading shape: eight placeholder rows while the items query has not answered. The render at
// the bottom is the only part that needs a DOM or a Zero; everything above it is a function call.
import "./setup";

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  Inbox,
  type InboxFilter,
  type InboxQueryItem,
  type SortableInboxRow,
  filterInboxItems,
  groupByAgentState,
  inboxRowTitle,
  sortInboxRows,
  threadSummary,
} from "../src/screens/Inbox";

/** `vi.hoisted` because the mock factories below run before this file's static imports: a plain
 *  `const` would still be in its temporal dead zone when the screen is first loaded. */
const { zero } = vi.hoisted(() => {
  /** Any chain reads back as itself — `zero.query.items.where(...).orderBy(...).related(...)
   *  .limit(...)` — so the screen can walk as far along a query as it likes. */
  const chain: unknown = new Proxy({}, { get: () => () => chain });
  return { zero: { query: new Proxy({}, { get: () => chain }) } };
});

vi.mock("../src/zero-client.js", () => ({
  initZero: () => zero,
  useZeroClient: () => zero,
  loadZeroToken: async () => {},
  hasZeroToken: () => true,
}));

vi.mock("@rocicorp/zero/react", () => ({
  // Every query resolves to `unknown` with no rows, which is the first paint of a screen whose
  // replica has not synced: the shape production shows behind a slow hub.
  useQuery: () => [[], { type: "unknown" }],
  useZero: () => zero,
  ZeroProvider: ({ children }: { children: unknown }) => children,
}));

const items: InboxQueryItem[] = [
  { id: "1", scope: "work", hasPendingApproval: false, authorKind: "person" },
  {
    id: "2",
    scope: "personal",
    hasPendingApproval: true,
    authorKind: "person",
  },
  { id: "3", scope: "work", hasPendingApproval: false, authorKind: "agent" },
];

describe("filterInboxItems (A5 §2.1: five mutually exclusive filter pills)", () => {
  const cases: [InboxFilter, string[]][] = [
    ["all", ["1", "2", "3"]],
    ["work", ["1", "3"]],
    ["personal", ["2"]],
    ["agents", ["3"]],
    ["needs-approval", ["2"]],
  ];
  it.each(cases)("filter=%s → ids %j", (filter, expectedIds) => {
    expect(filterInboxItems(items, filter).map((i) => i.id)).toEqual(expectedIds);
  });
});

describe("inboxRowTitle (U2 per-thread row title: person -> thread title -> channel handle)", () => {
  it("prefers the person display name", () => {
    expect(
      inboxRowTitle({
        personName: "Sora Kim",
        threadTitle: "#omnis-launch",
        channelHandle: "C0123",
      }),
    ).toBe("Sora Kim");
  });
  it("falls back to the thread title when there is no person (e.g. I sent the last message)", () => {
    expect(
      inboxRowTitle({ personName: null, threadTitle: "#omnis-launch", channelHandle: "C0123" }),
    ).toBe("#omnis-launch");
  });
  it("falls back to the channel handle when there is no person and no thread title", () => {
    expect(
      inboxRowTitle({ personName: null, threadTitle: null, channelHandle: "+15551234567" }),
    ).toBe("+15551234567");
  });
  it("uses the placeholder only when nothing identifies the row", () => {
    expect(inboxRowTitle({ personName: null, threadTitle: null, channelHandle: null })).toBe(
      "(no title)",
    );
  });
});

describe("threadSummary (U2: threads.meta.summary -> subject -> last item's first body line)", () => {
  it("prefers threads.meta.summary when B3 has filled it", () => {
    expect(
      threadSummary({
        metaSummary: "Wants the Brightstone Realty contract shared",
        subject: "Contract request",
        body: "Hello\nCould you send the contract?",
      }),
    ).toBe("Wants the Brightstone Realty contract shared");
  });
  it("falls back to the item subject when there is no summary yet", () => {
    expect(
      threadSummary({ metaSummary: null, subject: "Contract request", body: "Hello\nbody" }),
    ).toBe("Contract request");
  });
  it("skips a subject that is already the row title and uses the body instead", () => {
    // For Gmail and gcal, thread.title is the subject, so the row title and the summary end up
    // as the same string.
    expect(
      threadSummary({
        metaSummary: null,
        subject: "omnis launch sync",
        title: "omnis launch sync",
        body: "See you at 10 tomorrow\nvenue to follow",
      }),
    ).toBe("See you at 10 tomorrow");
  });
  it("leaves the summary empty when every candidate just repeats the title", () => {
    // For gcal even the body is that same e.summary string — rather than print one sentence
    // twice, the second line is collapsed.
    expect(
      threadSummary({
        metaSummary: null,
        subject: null,
        title: "omnis launch sync",
        body: "omnis launch sync",
      }),
    ).toBe("");
  });
  it("strips the Subject header the gmail adapter synthesizes into the body", () => {
    expect(
      threadSummary({
        metaSummary: null,
        subject: null,
        title: "PoC slides",
        body: "Subject: PoC slides\n\nSending the draft slides\nplease take a look",
      }),
    ).toBe("Sending the draft slides");
  });
  it("falls back to the first line of the body when there is no summary and no subject", () => {
    expect(
      threadSummary({
        metaSummary: null,
        subject: null,
        body: "Please take a look at the meeting notes\nthanks",
      }),
    ).toBe("Please take a look at the meeting notes");
  });
  it("trims the first line", () => {
    expect(
      threadSummary({ metaSummary: null, subject: null, body: "  padded  \nsecond line" }),
    ).toBe("padded");
  });
});

describe("sortInboxRows (U2: blocked agent sessions and pending-approval rows first, the rest in their original order)", () => {
  it("moves a pending-approval row to the top without reordering the rest", () => {
    const rows: (SortableInboxRow & { id: string })[] = [
      { id: "a", hasPendingApproval: false, agentState: null },
      { id: "b", hasPendingApproval: false, agentState: "idle" },
      { id: "c", hasPendingApproval: true, agentState: null },
      { id: "d", hasPendingApproval: false, agentState: "working" },
    ];
    expect(sortInboxRows(rows).map((r) => r.id)).toEqual(["c", "a", "b", "d"]);
  });

  it("moves a blocked agent session row to the top", () => {
    const rows: (SortableInboxRow & { id: string })[] = [
      { id: "a", hasPendingApproval: false, agentState: "done" },
      { id: "b", hasPendingApproval: false, agentState: "blocked" },
    ];
    expect(sortInboxRows(rows).map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("keeps relative order stable within the same priority", () => {
    const rows: (SortableInboxRow & { id: string })[] = [
      { id: "first", hasPendingApproval: true, agentState: null },
      { id: "second", hasPendingApproval: false, agentState: "blocked" },
      { id: "third", hasPendingApproval: false, agentState: null },
    ];
    expect(sortInboxRows(rows).map((r) => r.id)).toEqual(["first", "second", "third"]);
  });

  it("does not mutate the input array", () => {
    const rows: (SortableInboxRow & { id: string })[] = [
      { id: "a", hasPendingApproval: false, agentState: null },
      { id: "b", hasPendingApproval: true, agentState: null },
    ];
    const original = [...rows];
    sortInboxRows(rows);
    expect(rows).toEqual(original);
  });
});

describe("groupByAgentState (US-D02: blocked first, rows with no session left ungrouped)", () => {
  const rows = [
    { id: "i", agentState: "idle" as const },
    { id: "b", agentState: "blocked" as const },
    { id: "x", agentState: null },
    { id: "w", agentState: "working" as const },
  ];

  it("groups blocked -> working -> idle and returns the ungrouped rows separately in order", () => {
    const { groups, ungrouped } = groupByAgentState(rows);
    expect(groups.map((g) => [g.state, g.rows.map((r) => r.id)])).toEqual([
      ["blocked", ["b"]],
      ["working", ["w"]],
      ["idle", ["i"]],
    ]);
    expect(ungrouped.map((r) => r.id)).toEqual(["x"]);
  });
});

// loop-r2-05 (L2-05, NC2-13): the screen's loading shape. The brief's "the page is completely
// white for the whole wait" was two bugs — main.tsx awaiting the token before mounting anything,
// and the list having no state between "no rows" and "rows" — and this is the half that lives in
// the screen.
describe("Inbox skeleton rows (loop-r2-05)", () => {
  it("draws eight placeholder rows and marks the list busy while no query has answered", () => {
    const { container } = render(<Inbox />);
    expect(container.querySelectorAll(".inbox-row--skeleton")).toHaveLength(8);
    expect(container.querySelector(".inbox-card__list")?.getAttribute("aria-busy")).toBe("true");
  });

  it("hides the placeholders from the accessibility tree — they are not rows", () => {
    const { container } = render(<Inbox />);
    for (const row of container.querySelectorAll(".inbox-row--skeleton")) {
      expect(row.getAttribute("aria-hidden")).toBe("true");
    }
  });
});

// loop-r2-06 (L2-07, NC2-08): one screen used to show three disagreeing approval numbers, and the
// rows below them had a vote in two of the three. The pill's badge and the subline both read the
// shell's `visibleApprovals` now — the mock in this file answers every query with zero rows, so a
// number that still came from the list could only read 0 here.
describe("Inbox approval count (loop-r2-06)", () => {
  it("takes the pill badge and the subline from the shell's number, not from the rows", () => {
    const { container } = render(<Inbox pendingApprovals={8} onOpenApprovals={() => {}} />);

    expect(container.querySelector(".inbox-card__pill-count")).toHaveTextContent("8");
    expect(container.querySelector(".inbox-card__subline")).toHaveTextContent("8 need approval");
  });

  it("singularises one, and draws no badge at zero", () => {
    const { container } = render(<Inbox pendingApprovals={1} onOpenApprovals={() => {}} />);
    expect(container.querySelector(".inbox-card__subline")).toHaveTextContent("1 needs approval");

    const none = render(<Inbox pendingApprovals={0} />);
    expect(none.container.querySelector(".inbox-card__pill-count")).toBeNull();
    expect(none.container.querySelector(".inbox-card__subline")?.textContent ?? "").not.toContain(
      "approval",
    );
  });
});
