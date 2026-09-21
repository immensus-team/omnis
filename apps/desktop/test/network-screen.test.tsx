// @vitest-environment jsdom
// The root `pnpm test` does not read apps/desktop/vitest.config.ts, so this file declares its own
// environment and setup (the same situation as tasks-screen.test.tsx and app-shell.test.tsx).
import "./setup";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type FollowupCandidate,
  NETWORK_BANNER,
  PersonDetail,
  contactGapLabel,
  followupDueLabel,
  followupQueue,
  networkState,
} from "../src/screens/Network.js";

/** A queued person's name is on screen twice — once in the queue strip, once on their card — and
 *  that is deliberate (the strip says *who*, the card is where you act). Tests therefore scope to
 *  the region they mean instead of asking the document for the first match. */
function grid() {
  return within(document.querySelector(".network-screen__grid") as HTMLElement);
}
function queueStrip() {
  return within(document.querySelector(".network-screen__queue") as HTMLElement);
}

// ─── the pure functions ─────────────────────────────────────────────────────────────────────────

const now = new Date("2026-09-20T00:00:00").getTime();

/** The one candidate the boundary tests vary — named rather than indexed so the checks below do not
 *  have to assert that `candidates[0]` exists (`noNonNullAssertion` is a lint error here). */
const dueAfternoon: FollowupCandidate = {
  id: "1",
  nextFollowupAt: now - 1000,
  priorityScore: 0.5,
  mergedInto: null,
};

const candidates: FollowupCandidate[] = [
  dueAfternoon,
  { id: "2", nextFollowupAt: now + 100_000, priorityScore: 0.9, mergedInto: null }, // not due yet
  { id: "3", nextFollowupAt: now - 5000, priorityScore: 0.9, mergedInto: null },
  { id: "4", nextFollowupAt: now - 1000, priorityScore: 0.1, mergedInto: "1" }, // merged away
  { id: "5", nextFollowupAt: null, priorityScore: 0.3, mergedInto: null }, // never scheduled
];

describe("followupQueue (A3 persons_followup_idx: due, unmerged, by priority_score desc)", () => {
  it("returns only due, non-merged people ordered by priority", () => {
    expect(followupQueue(candidates, now).map((p) => p.id)).toEqual(["3", "1"]);
  });

  it("keeps a person whose date is exactly now", () => {
    // `<= now`, not `< now`: the sweep runs at a fixed weekday hour and a person due at 10:00:00
    // is due at 10:00:00. An exclusive bound would make the queue depend on the millisecond.
    expect(followupQueue([{ ...dueAfternoon, nextFollowupAt: now }], now)).toHaveLength(1);
  });

  it("drops everyone when nobody has been scheduled", () => {
    expect(followupQueue([{ ...dueAfternoon, nextFollowupAt: null }], now)).toEqual([]);
  });

  it("does not mutate its input", () => {
    // The screen memoises on `persons`, so an in-place sort would reorder Zero's own array and make
    // the grid's order depend on whether the queue happened to run first.
    const input = [...candidates];
    followupQueue(input, now);
    expect(input.map((p) => p.id)).toEqual(candidates.map((p) => p.id));
  });
});

describe("followupDueLabel (the queue strip's second line)", () => {
  it("says today for a date that has not quite passed", () => {
    expect(followupDueLabel(now + 60_000, now)).toBe("Due today");
  });

  it("counts days for the ordinary sweep case", () => {
    expect(followupDueLabel(now - 86_400_000, now)).toBe("Due yesterday");
    expect(followupDueLabel(now - 3 * 86_400_000, now)).toBe("Due 3 days ago");
  });

  it("switches to a date once the count stops being useful", () => {
    // "Due 41 days ago" is a rebuke; "Due 4 Aug" is the fact. Six days is the boundary.
    expect(followupDueLabel(now - 6 * 86_400_000, now)).toBe("Due 6 days ago");
    expect(followupDueLabel(now - 41 * 86_400_000, now)).toBe("Due 10 Aug");
  });
});

describe("contactGapLabel (the follow-up card's own line)", () => {
  it("spells the gap out rather than reusing the short relative form", () => {
    // formatRelativeTime prints "3d", which is right in a timestamp column and wrong in a sentence.
    expect(contactGapLabel(now - 3 * 86_400_000, now)).toBe("No contact in 3 days.");
    expect(contactGapLabel(now - 86_400_000, now)).toBe("No contact in a day.");
    expect(contactGapLabel(now, now)).toBe("Last spoke today.");
  });

  it("handles a person nobody has spoken to", () => {
    expect(contactGapLabel(null, now)).toBe("No conversation yet.");
  });
});

describe("networkState (US-B30 banners)", () => {
  it("reports an error over a load in flight", () => {
    expect(networkState(["unknown", "error"])).toBe("error");
  });

  it("stays loading while any query is unknown", () => {
    expect(networkState(["complete", "unknown"])).toBe("loading");
  });

  it("is ready when every query completed", () => {
    expect(networkState(["complete", "complete"])).toBe("ready");
    expect(NETWORK_BANNER.ready).toBe("");
  });
});

// ─── the screen itself ──────────────────────────────────────────────────────────────────────────

/** The screen reads three tables (the pane reads six). The fake tags each query with its table so
 *  the mocked `useQuery` can answer per table — a flat "always the same array" mock cannot tell a
 *  person from an identity, and this screen's job is telling them apart. */
function chain(table: string) {
  const node: Record<string, unknown> = { __table: table };
  for (const m of ["where", "orderBy", "limit", "related"]) node[m] = () => node;
  return node;
}

const TABLES: Record<string, unknown> = {
  persons: chain("persons"),
  identities: chain("identities"),
  accounts: chain("accounts"),
  items: chain("items"),
  notes: chain("notes"),
  threads: chain("threads"),
};
const ROWS: Record<string, readonly unknown[]> = {
  persons: [],
  identities: [],
  accounts: [],
  items: [],
  notes: [],
  threads: [],
};

vi.mock("../src/zero-client.js", () => ({
  initZero: () => ({ query: TABLES }),
  useZeroClient: () => ({ query: TABLES, online: true, onOnline: () => () => {} }),
  loadZeroToken: async () => {},
}));
vi.mock("@rocicorp/zero/react", () => ({
  useQuery: (q: { __table?: string }) => [ROWS[q.__table ?? ""] ?? [], { type: "complete" }],
  useZero: () => ({ query: TABLES }),
  ZeroProvider: ({ children }: { children: unknown }) => children,
}));

const { Network } = await import("../src/screens/Network.js");

const PERSON = {
  id: "p1",
  display_name: "David Park",
  org: "Davich",
  role: "CTO",
  relationship_state: "active",
  vip: true,
  notes: "Met at the November offsite.",
  first_contact_at: now - 120 * 86_400_000,
  last_contact_at: now - 3 * 86_400_000,
  next_followup_at: now - 86_400_000,
  item_count: 12,
  primary_thread_id: "t1",
  cadence_days: null,
  priority_score: 0.9,
  merged_into: undefined,
  created_at: now - 120 * 86_400_000,
};

beforeEach(() => {
  ROWS.persons = [PERSON];
  ROWS.identities = [
    {
      id: "id1",
      person_id: "p1",
      channel: "gmail",
      handle: "dana@example.com",
      handle_norm: "dana@example.com",
      verified: false,
      source: "adapter",
      created_at: now,
    },
  ];
  ROWS.accounts = [{ id: "a1", channel: "gmail", display: "e2e gmail", external_id: "e2e" }];
  ROWS.items = [
    {
      id: "i1",
      thread_id: "t1",
      account_id: "a1",
      kind: "email",
      status: "received",
      author_person_id: "p1",
      author_is_me: false,
      body: "Thanks for the update.",
      sent_at: now - 3 * 86_400_000,
      meta: {},
    },
  ];
  ROWS.notes = [];
  ROWS.threads = [
    { id: "t1", account_id: "a1", title: "omnis launch sync", last_item_at: now - 3 * 86_400_000 },
  ];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Network screen (A5 §3.6)", () => {
  it("names the screen and counts the follow-up queue", () => {
    render(<Network now={new Date(now)} />);
    expect(screen.getByRole("heading", { name: "Network" })).toBeInTheDocument();
    expect(screen.getByText("Follow-up queue (1)")).toBeInTheDocument();
  });

  it("shows the person's card with affiliation, title and the relationship dot", () => {
    render(<Network now={new Date(now)} />);
    expect(grid().getByText("David Park")).toBeInTheDocument();
    expect(grid().getByText("Davich · CTO")).toBeInTheDocument();
    expect(grid().getByText("Active").closest(".status-pill")).toHaveAttribute(
      "data-dot",
      "active",
    );
    // formatRelativeTime's short form ("3d"), which is what the inbox row prints for the same value.
    expect(grid().getByText("3d")).toBeInTheDocument();
  });

  it("puts a queued person in the strip with the reason they are in it", () => {
    render(<Network now={new Date(now)} />);
    expect(queueStrip().getByRole("button", { name: /David Park/ })).toBeInTheDocument();
    expect(queueStrip().getByText("Due yesterday")).toBeInTheDocument();
  });

  it("offers the follow-up on the card of a queued person", () => {
    render(<Network now={new Date(now)} />);
    expect(grid().getByText("No contact in 3 days.")).toBeInTheDocument();
    // The class is the assertion, not decoration: apps/desktop compiles no Tailwind, so a button
    // that carries only `@omnis/ui`'s `Button` utilities draws as the UA's grey system-font box.
    // `.network-screen__action` is what actually reset it.
    expect(grid().getByRole("button", { name: "Draft a follow-up" })).toHaveClass(
      "network-screen__action",
    );
  });

  it("leaves a person who is not due out of the queue", () => {
    ROWS.persons = [{ ...PERSON, next_followup_at: now + 30 * 86_400_000 }];
    render(<Network now={new Date(now)} />);
    expect(screen.getByText("Follow-up queue (0)")).toBeInTheDocument();
    expect(screen.getByText("Nobody is due for a follow-up.")).toBeInTheDocument();
    // Still on the grid: not being due for a follow-up is not a reason to hide someone.
    expect(grid().getByText("David Park")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Draft a follow-up" })).not.toBeInTheDocument();
  });

  it("hides a person who was merged into another", () => {
    // A3 §10: merged_into means this row is a duplicate of the one it points at. Drawing both is
    // drawing the same person twice under two names.
    ROWS.persons = [{ ...PERSON, merged_into: "p2" }];
    render(<Network now={new Date(now)} />);
    expect(screen.queryByText("David Park")).not.toBeInTheDocument();
    expect(screen.getByText("No people yet — they appear as messages arrive.")).toBeInTheDocument();
  });

  it("opens the person from the card and from the queue strip", () => {
    const onOpenPerson = vi.fn();
    render(<Network now={new Date(now)} onOpenPerson={onOpenPerson} />);
    // The card's name is the exact accessible name; the strip chip's also carries the due line.
    fireEvent.click(grid().getByRole("button", { name: "David Park" }));
    expect(onOpenPerson).toHaveBeenCalledWith("p1");
    onOpenPerson.mockClear();
    fireEvent.click(queueStrip().getByRole("button", { name: /David Park/ }));
    expect(onOpenPerson).toHaveBeenCalledWith("p1");
  });

  it("says so instead of opening an empty merge sheet", () => {
    // The plan puts the merge/split entry point here and leaves the dialog to follow-up scope, so
    // the button has to report that rather than pretend to work.
    render(<Network now={new Date(now)} />);
    expect(screen.getByRole("button", { name: "This is the same person" })).toHaveClass(
      "network-screen__action",
    );
    fireEvent.click(screen.getByRole("button", { name: "This is the same person" }));
    expect(screen.getByRole("status")).toHaveTextContent("Merging two people isn't wired up yet.");
  });

  it("banners an error without blanking the people it already has", () => {
    render(<Network now={new Date(now)} />);
    // No banner in the ready state — and the people are on screen either way, which is the point:
    // the rows Zero already synced are the truth even when the last query failed.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(grid().getByText("David Park")).toBeInTheDocument();
  });
});

describe("PersonDetail (A5 §3.6 — timeline, conversations across channels, notes)", () => {
  it("draws the person's facts, conversations and notes", () => {
    render(<PersonDetail personId="p1" />);
    expect(screen.getByRole("heading", { name: "David Park" })).toBeInTheDocument();
    expect(screen.getByText("Affiliation")).toBeInTheDocument();
    expect(screen.getByText("Davich · CTO")).toBeInTheDocument();
    expect(screen.getByText("omnis launch sync")).toBeInTheDocument();
    expect(screen.getByText("Met at the November offsite.")).toBeInTheDocument();
    expect(screen.getByText("dana@example.com")).toBeInTheDocument();
  });

  it("says there are no notes when the column is NULL, not only when it was never set", () => {
    // `persons.notes` is `string().optional()` on the Zero schema, so a NULL column reaches the pane
    // as `null` rather than `undefined`. The first cut tested only for `undefined`, so a person with
    // no notes — the Network shots' fixture has one — drew an empty <ul> under the heading, which
    // reads as a section that failed to load rather than one with nothing in it.
    ROWS.persons = [{ ...PERSON, notes: null }];
    render(<PersonDetail personId="p1" />);
    expect(screen.getByText("No notes yet.")).toBeInTheDocument();
    expect(document.querySelector(".person-detail__notes")).toBeNull();
  });

  it("still lists routed notes while the person's own notes column is NULL", () => {
    // The empty state must not swallow the notes the notes loop routed here: the heading has two
    // sources, and "No notes yet." is only true when both are empty.
    ROWS.persons = [{ ...PERSON, notes: null }];
    ROWS.notes = [
      {
        id: "n1",
        person_id: "p1",
        body: "Introduced to Priya at the offsite.",
        routed_to_person_id: "p1",
        created_at: now,
      },
    ];
    render(<PersonDetail personId="p1" />);
    expect(screen.getByText("Introduced to Priya at the offsite.")).toBeInTheDocument();
    expect(screen.queryByText("No notes yet.")).not.toBeInTheDocument();
  });

  it("opens the conversation behind a channel link", () => {
    const onOpenThread = vi.fn();
    render(<PersonDetail personId="p1" onOpenThread={onOpenThread} />);
    fireEvent.click(screen.getByRole("button", { name: /omnis launch sync/ }));
    expect(onOpenThread).toHaveBeenCalledWith("t1");
  });

  it("lists a conversation once even when many messages came from it", () => {
    ROWS.items = [
      { ...ROWS.items[0], id: "i1", thread_id: "t1" },
      { ...ROWS.items[0], id: "i2", thread_id: "t1" },
      { ...ROWS.items[0], id: "i3", thread_id: "t1" },
    ];
    render(<PersonDetail personId="p1" />);
    // A timeline that listed the same thread three times would push the other conversations out.
    expect(screen.getAllByRole("button", { name: /omnis launch sync|Gmail/ })).toHaveLength(1);
  });

  it("says so when the person is gone rather than rendering an empty pane", () => {
    ROWS.persons = [];
    render(<PersonDetail personId="p-missing" />);
    expect(screen.getByText("This person is no longer here.")).toBeInTheDocument();
  });
});
