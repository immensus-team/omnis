// @vitest-environment jsdom
// The root `pnpm test` does not read apps/desktop/vitest.config.ts, so this file declares its own
// environment and setup (the same situation as network-screen.test.tsx and tasks-screen.test.tsx).
import "./setup";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NOTES_BANNER,
  type NoteListItem,
  ROUTING_NO_MATCH_COPY,
  type RouteCandidate,
  hasRoutingSuggestion,
  noteRoutingLabel,
  notesState,
  parseRouteCandidates,
  routingPanel,
  routingSuggestionCopy,
  topRouteCandidate,
} from "../src/screens/Notes.js";

/** What the L7 loop actually writes: `propose_route` stores `JSON.stringify(candidates)` into
 *  `notes.rationale` and leaves both target columns NULL (packages/agents/src/tools/propose.ts).
 *  The screen never sees a numeric confidence from anywhere else. */
const CANDIDATES = JSON.stringify([
  { kind: "thread", id: "t1", confidence: 0.62, why: "same project", suggested_use: "share" },
  {
    kind: "person",
    id: "p1",
    confidence: 0.91,
    why: "the note is about them",
    suggested_use: "followup",
  },
]);

const proposed: NoteListItem = {
  id: "n1",
  body: "Give David a heads-up that the PoC needs 3 more days",
  route_state: "proposed",
  rationale: CANDIDATES,
  routed_to_thread_id: null,
  routed_to_person_id: null,
};

/** A note the moment it is written: the column defaults to 'proposed' and the loop has not run yet,
 *  so there is nothing in `rationale`. A failed loop leaves it in exactly this shape (A4 §8.3's
 *  "failure is also a safe default state"). */
const justSaved: NoteListItem = { ...proposed, id: "n2", rationale: null };

const unrouted: NoteListItem = {
  ...proposed,
  id: "n3",
  route_state: "none",
  rationale: null,
};

// ─── the pure functions ─────────────────────────────────────────────────────────────────────────

describe("parseRouteCandidates (the proposal is JSON in a text column - read it defensively)", () => {
  it("reads the array propose_route stored, highest confidence first on request", () => {
    const parsed = parseRouteCandidates(CANDIDATES);
    expect(parsed.map((c) => c.id)).toEqual(["t1", "p1"]);
    expect(parsed[0]?.kind).toBe("thread");
  });

  it("reads a missing rationale as no candidates", () => {
    expect(parseRouteCandidates(null)).toEqual([]);
    expect(parseRouteCandidates(undefined)).toEqual([]);
    expect(parseRouteCandidates("")).toEqual([]);
  });

  it("reads unreadable and unexpected JSON as no candidates", () => {
    // A4 §8.3: a routing failure and a no-match converge on the same thing the user is shown, so
    // every one of these has to land on "nothing to suggest" rather than throw inside a render.
    expect(parseRouteCandidates("not json")).toEqual([]);
    expect(parseRouteCandidates('{"kind":"thread"}')).toEqual([]);
    expect(parseRouteCandidates('[null, 3, "x"]')).toEqual([]);
  });

  it("drops entries that are not a candidate the server would have accepted", () => {
    const mixed = JSON.stringify([
      { kind: "thread", id: "t1", confidence: 0.9 },
      { kind: "planet", id: "t2", confidence: 0.9 },
      { kind: "thread", confidence: 0.9 },
      { kind: "thread", id: "t3", confidence: "high" },
      { kind: "person", id: "p1", confidence: 0.5 },
    ]);
    expect(parseRouteCandidates(mixed).map((c) => c.id)).toEqual(["t1", "p1"]);
  });
});

describe("hasRoutingSuggestion (A4 §8.3: below 0.50 no proposal is stored at all)", () => {
  it("is true only for a proposal that carries a candidate", () => {
    expect(hasRoutingSuggestion(proposed)).toBe(true);
    expect(hasRoutingSuggestion(unrouted)).toBe(false);
    expect(hasRoutingSuggestion({ ...proposed, route_state: "accepted" })).toBe(false);
  });

  it("is false for a 'proposed' note with no candidate yet — that row is not a suggestion", () => {
    // 'proposed' is the column's DEFAULT (0004_tasks_approvals.sql), so every freshly written note
    // wears it for the two seconds the loop's debounce lasts — and forever if the loop failed.
    // Reading the state alone would draw a confirmation card for a suggestion nobody made.
    expect(hasRoutingSuggestion(justSaved)).toBe(false);
  });
});

describe("routingSuggestionCopy (A5 §3.7: confidence as text only, no percentages)", () => {
  it("names the target in words, at high confidence", () => {
    expect(routingSuggestionCopy(proposed, "David Park's thread")).toBe(
      "Routing suggestion: share to David Park's thread (high confidence)",
    );
  });

  it("says low confidence for a candidate under the 0.80 line", () => {
    // A4 §8.3 draws two bands above the threshold — >= 0.80 is a 1-tap card, 0.50~0.80 is a choice
    // — and A5 §3.7 expresses the difference in words, never as a number.
    const low = {
      ...proposed,
      rationale: JSON.stringify([{ kind: "thread", id: "t1", confidence: 0.62 }]),
    };
    expect(routingSuggestionCopy(low, "Q4 renewal with Davich")).toBe(
      "Routing suggestion: share to Q4 renewal with Davich (low confidence)",
    );
  });

  it("falls back to the no-match copy with nothing to point at", () => {
    expect(routingSuggestionCopy(unrouted, null)).toBe(ROUTING_NO_MATCH_COPY);
    expect(routingSuggestionCopy(justSaved, null)).toBe(ROUTING_NO_MATCH_COPY);
    // A target with no candidate behind it is the same dead end: there is nothing to Accept.
    expect(routingSuggestionCopy(justSaved, "David Park's thread")).toBe(ROUTING_NO_MATCH_COPY);
  });
});

describe("topRouteCandidate", () => {
  it("picks the highest confidence the model offered", () => {
    expect(topRouteCandidate(proposed)?.id).toBe("p1");
  });

  it("is null when there is nothing to pick from", () => {
    expect(topRouteCandidate(unrouted)).toBeNull();
    expect(topRouteCandidate(justSaved)).toBeNull();
  });
});

describe("noteRoutingLabel (A5 §3.7's Recent notes line)", () => {
  it("names where an accepted note went", () => {
    expect(noteRoutingLabel({ route_state: "accepted" }, "Network: David Park")).toBe(
      "→ Network: David Park",
    );
  });

  it("stays vague rather than naming a target it cannot see", () => {
    // An accepted note whose thread has not replicated yet: the id is there, the row is not.
    expect(noteRoutingLabel({ route_state: "accepted" }, null)).toBe("Routed");
  });

  it("says the note is waiting, and says when it was filed unrouted", () => {
    expect(noteRoutingLabel(proposed, null)).toBe("Awaiting your decision");
    expect(noteRoutingLabel(unrouted, null)).toBe("Not routed");
    expect(noteRoutingLabel(justSaved, null)).toBe("Not routed");
  });
});

describe("routingPanel (A5 §3.7 draws the suggestion under the input)", () => {
  const labelFor = (c: RouteCandidate) => (c.id === "p1" ? "David Park" : null);

  it("offers the newest note that still has a proposal", () => {
    // The list is newest-first. Note n2 was written after n1 and has no candidate yet; n1's
    // suggestion must not disappear from the panel while that resolves.
    const panel = routingPanel([justSaved, proposed, unrouted], labelFor);
    expect(panel?.noteId).toBe("n1");
    expect(panel?.candidate?.id).toBe("p1");
    expect(panel?.copy).toBe("Routing suggestion: share to David Park (high confidence)");
  });

  it("shows the no-match line for the newest note when nothing is proposed", () => {
    const panel = routingPanel([justSaved], labelFor);
    expect(panel).toEqual({ noteId: "n2", candidate: null, copy: ROUTING_NO_MATCH_COPY });
  });

  it("has nothing to say once the newest note is settled and nothing is pending", () => {
    const accepted = { ...proposed, route_state: "accepted" };
    expect(routingPanel([accepted], labelFor)).toBeNull();
    expect(routingPanel([], labelFor)).toBeNull();
  });
});

describe("notesState (the query's own state, same shape as the Network screen's)", () => {
  it("reports an error over a load in flight, and ready only when every query completed", () => {
    expect(notesState(["unknown", "error"])).toBe("error");
    expect(notesState(["complete", "unknown"])).toBe("loading");
    expect(notesState(["complete", "complete"])).toBe("ready");
    expect(NOTES_BANNER.ready).toBe("");
  });
});

// ─── the screen itself ──────────────────────────────────────────────────────────────────────────

/** The screen reads three tables. The fake tags each query with its table so the mocked `useQuery`
 *  can answer per table — the same arrangement network-screen.test.tsx uses, and for the same
 *  reason: a flat mock cannot tell a note from a thread, which is this screen's whole job. */
function chain(table: string) {
  const node: Record<string, unknown> = { __table: table };
  for (const m of ["where", "orderBy", "limit", "related"]) node[m] = () => node;
  return node;
}

const TABLES: Record<string, unknown> = {
  notes: chain("notes"),
  threads: chain("threads"),
  persons: chain("persons"),
};
const ROWS: Record<string, readonly unknown[]> = { notes: [], threads: [], persons: [] };

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
vi.mock("../src/api/notes.js", () => ({
  createNote: vi.fn(async (body: string) => ({
    id: "n9",
    body,
    route_state: "proposed",
    created_at: "2026-09-21T09:00:00.000Z",
  })),
  routeNote: vi.fn(async (id: string) => ({ id, route_state: "accepted" })),
}));

const api = await import("../src/api/notes.js");
const { Notes } = await import("../src/screens/Notes.js");

const NOTE_ROWS = [
  {
    id: "n1",
    body: "Give David a heads-up that the PoC needs 3 more days",
    route_state: "proposed",
    rationale: CANDIDATES,
    routed_to_thread_id: null,
    routed_to_person_id: null,
    created_at: 1_787_000_000_000,
  },
  {
    id: "n3",
    body: "Retro ideas for next week",
    route_state: "none",
    rationale: null,
    routed_to_thread_id: null,
    routed_to_person_id: null,
    created_at: 1_786_000_000_000,
  },
];

beforeEach(() => {
  ROWS.notes = NOTE_ROWS;
  ROWS.threads = [{ id: "t1", account_id: "a1", title: "Davich contract", last_item_at: null }];
  ROWS.persons = [{ id: "p1", display_name: "David Park", vip: true, org: "Davich", role: "CTO" }];
  vi.mocked(api.createNote).mockClear();
  vi.mocked(api.routeNote).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function list() {
  return within(document.querySelector(".notes-screen__recent") as HTMLElement);
}
function panel() {
  return within(document.querySelector(".notes-screen__suggestion") as HTMLElement);
}

describe("Notes screen (A5 §3.7)", () => {
  it("names the screen and offers the one-line input", () => {
    render(<Notes />);
    expect(screen.getByRole("heading", { name: "Notes" })).toBeInTheDocument();
    expect(screen.getByLabelText("New note")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("saves the note, clears the box and keeps the focus (so the next one is just typing)", async () => {
    render(<Notes />);
    const input = screen.getByLabelText("New note");
    fireEvent.change(input, { target: { value: "  Book the Q4 review  " } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    await vi.waitFor(() => {
      expect(vi.mocked(api.createNote)).toHaveBeenCalledWith("Book the Q4 review");
    });
    await vi.waitFor(() => {
      expect(input).toHaveValue("");
    });
    expect(document.activeElement).toBe(input);
  });

  it("does not write a note that is only whitespace", () => {
    render(<Notes />);
    const input = screen.getByLabelText("New note");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(vi.mocked(api.createNote)).not.toHaveBeenCalled();
  });

  it("keeps the text in the box when the save fails", async () => {
    vi.mocked(api.createNote).mockRejectedValueOnce(new Error("HTTP 500"));
    render(<Notes />);
    const input = screen.getByLabelText("New note");
    fireEvent.change(input, { target: { value: "Book the Q4 review" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    await vi.waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Couldn't save the note");
    });
    expect(input).toHaveValue("Book the Q4 review");
  });

  it("shows the suggestion with the three decisions A5 §3.7 draws", () => {
    render(<Notes />);
    expect(
      panel().getByText("Routing suggestion: share to David Park (high confidence)"),
    ).toBeInTheDocument();
    expect(panel().getByRole("button", { name: "Accept" })).toBeInTheDocument();
    expect(panel().getByRole("button", { name: "Don't route" })).toBeInTheDocument();
    // "Choose another target" is follow-up scope (the picker reuses B27's search), so it is drawn
    // disabled rather than shipped as a button that silently does nothing.
    expect(panel().getByRole("button", { name: "Choose another target" })).toBeDisabled();
  });

  it("accepts with the candidate that was on screen", async () => {
    render(<Notes />);
    fireEvent.click(panel().getByRole("button", { name: "Accept" }));
    await vi.waitFor(() => {
      expect(vi.mocked(api.routeNote)).toHaveBeenCalledWith("n1", {
        accept: true,
        personId: "p1",
      });
    });
  });

  it("files the note unrouted when told not to route it", async () => {
    render(<Notes />);
    fireEvent.click(panel().getByRole("button", { name: "Don't route" }));
    await vi.waitFor(() => {
      expect(vi.mocked(api.routeNote)).toHaveBeenCalledWith("n1", { accept: false });
    });
  });

  it("says so when a decision could not be written", async () => {
    vi.mocked(api.routeNote).mockRejectedValueOnce(new Error("HTTP 409"));
    render(<Notes />);
    fireEvent.click(panel().getByRole("button", { name: "Accept" }));
    await vi.waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Couldn't record that decision");
    });
  });

  it("lists the recent notes with where each one went", () => {
    render(<Notes />);
    expect(
      list().getByText("Give David a heads-up that the PoC needs 3 more days"),
    ).toBeInTheDocument();
    expect(list().getByText("Awaiting your decision")).toBeInTheDocument();
    expect(list().getByText("Retro ideas for next week")).toBeInTheDocument();
    expect(list().getByText("Not routed")).toBeInTheDocument();
  });

  it("reads a thread target as the thread's own title", () => {
    ROWS.notes = [
      {
        ...NOTE_ROWS[1],
        id: "n4",
        route_state: "accepted",
        routed_to_thread_id: "t1",
        routed_to_person_id: null,
      },
    ];
    render(<Notes />);
    expect(list().getByText("→ Davich contract")).toBeInTheDocument();
  });

  it("opens with the empty state rather than an empty list", () => {
    ROWS.notes = [];
    render(<Notes />);
    expect(list().getByText("No notes yet.")).toBeInTheDocument();
  });
});
