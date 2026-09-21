// @vitest-environment jsdom
// The root `pnpm test` does not read apps/desktop/vitest.config.ts, so this file declares its own
// environment and setup (the same situation as app-shell.test.tsx).
import "./setup";

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TASKS_BANNER,
  type TaskViewRow,
  dueBasisFor,
  dueLabelFor,
  filterTasksByView,
  tasksState,
} from "../src/screens/Tasks.js";

// ─── the pure functions ─────────────────────────────────────────────────────────────────────────

const now = new Date("2026-09-20T12:00:00");
const rows: TaskViewRow[] = [
  { id: "1", ownerKind: "me", dueAt: new Date("2026-09-20T18:00:00").getTime(), state: "open" },
  { id: "2", ownerKind: "me", dueAt: new Date("2026-09-24T09:00:00").getTime(), state: "open" },
  { id: "3", ownerKind: "me", dueAt: null, state: "open" },
  {
    id: "4",
    ownerKind: "agent",
    dueAt: new Date("2026-09-20T18:00:00").getTime(),
    state: "in_progress",
  },
  { id: "5", ownerKind: "me", dueAt: new Date("2026-09-19T09:00:00").getTime(), state: "done" },
];

describe("filterTasksByView (A5 §3.5 four view tabs)", () => {
  // DEVIATION from the plan's `today` step, which expects ["1"]. The plan's own implementation of
  // this filter returns ["1","4"] for its own fixture — `open.filter(t => dueAt <= todayEnd)` has no
  // owner_kind term — and A5 §3.5 agrees with the code, not the expectation: Delegated is defined as
  // "only owner_kind='agent' items under Delegated", never as "and nowhere else", and §3.5's own mock
  // draws a delegated row ("Fix adapter tests (Codex) · delegated · in progress") inside Today. A
  // delegated task due today that vanished from Today would be a task with a due date the person
  // never sees on the day it is due.
  it("today = due within today, excluding done/dropped", () => {
    expect(filterTasksByView(rows, "today", now).map((r) => r.id)).toEqual(["1", "4"]);
  });
  it("week = due after today through +7d", () => {
    expect(filterTasksByView(rows, "week", now).map((r) => r.id)).toEqual(["2"]);
  });
  it("someday = no due date or beyond the week window", () => {
    expect(filterTasksByView(rows, "someday", now).map((r) => r.id)).toEqual(["3"]);
  });
  it("delegated = owner_kind agent regardless of due date", () => {
    expect(filterTasksByView(rows, "delegated", now).map((r) => r.id)).toEqual(["4"]);
  });

  // Delegated is a separate axis from the three due-date tabs, not a fourth bucket: A5 §3.5 defines
  // it as owner_kind='agent' "regardless of due date", so a delegated task due today is meant to
  // appear under both. The three due-date tabs do partition among themselves — that is the half of
  // this that has to hold, or a task becomes invisible from the only tabs that show it.
  it("puts a delegated task due today under both Today and Delegated", () => {
    expect(filterTasksByView(rows, "today", now).map((r) => r.id)).toContain("4");
    expect(filterTasksByView(rows, "delegated", now).map((r) => r.id)).toEqual(["4"]);
  });

  it("partitions the non-delegated open tasks across the three due-date tabs", () => {
    const mine = rows.filter(
      (r) => r.ownerKind === "me" && r.state !== "done" && r.state !== "dropped",
    );
    expect(mine).toHaveLength(3);
    const seen = ["today", "week", "someday"].flatMap((v) =>
      filterTasksByView(rows, v as "today", now)
        .filter((r) => r.ownerKind === "me")
        .map((r) => r.id),
    );
    expect(seen.sort()).toEqual(["1", "2", "3"]);
  });

  // `dropped` is not `done`: A3 has both, and a task the person gave up on must leave the list the
  // same way a finished one does. Only filtering on 'done' would leave dropped tasks on Today
  // forever.
  it("drops a dropped task", () => {
    const withDropped = [
      { id: "9", ownerKind: "me" as const, dueAt: now.getTime(), state: "dropped" },
    ];
    expect(filterTasksByView(withDropped, "today", now)).toEqual([]);
  });

  // "This week" starts tomorrow: a task due at 23:00 tonight belongs to Today, and listing it under
  // both tabs is the double-count the partition test above guards from the other side.
  it("does not repeat today's tasks in the week tab", () => {
    const lateTonight = [
      {
        id: "9",
        ownerKind: "me" as const,
        dueAt: new Date("2026-09-20T23:00:00").getTime(),
        state: "open",
      },
    ];
    expect(filterTasksByView(lateTonight, "week", now)).toEqual([]);
  });
});

describe("dueBasisFor", () => {
  it("is inferred for agent-created tasks", () => {
    expect(dueBasisFor("agent")).toBe("inferred");
  });
  it("is explicit for me-created tasks", () => {
    expect(dueBasisFor("me")).toBe("explicit");
  });

  // The plan's created_by inference exists only because `tasks` has no due_basis column — but the
  // value is not lost: propose_task stores the model's own answer on the source item
  // (items.meta.task_due_basis). When the screen has that row, the real answer wins over the guess.
  it("prefers the source item's recorded basis over the created_by guess", () => {
    expect(dueBasisFor("agent", "stated")).toBe("explicit");
    expect(dueBasisFor("me", "inferred")).toBe("inferred");
  });
  it("falls back to the created_by guess for an unknown or absent basis", () => {
    expect(dueBasisFor("agent", "none")).toBe("inferred");
    expect(dueBasisFor("agent", null)).toBe("inferred");
    expect(dueBasisFor("me", undefined)).toBe("explicit");
  });
});

describe("dueLabelFor (A5 §3.5 due column)", () => {
  it("says nothing when there is no due date", () => {
    expect(dueLabelFor(null, now)).toBeNull();
  });
  it("labels the same calendar day as today", () => {
    expect(dueLabelFor(new Date("2026-09-20T23:00:00").getTime(), now)).toBe("Due today");
  });
  it("labels the next calendar day as tomorrow", () => {
    expect(dueLabelFor(new Date("2026-09-21T09:00:00").getTime(), now)).toBe("Due tomorrow");
  });
  // A date already in the past is the one thing on this screen that needs attention, so it says so
  // rather than printing a date the reader has to compare against a clock.
  it("marks a past date as overdue", () => {
    expect(dueLabelFor(new Date("2026-09-19T09:00:00").getTime(), now)).toBe("Overdue");
  });
  it("prints a date for anything further out", () => {
    expect(dueLabelFor(new Date("2026-09-24T09:00:00").getTime(), now)).toBe("Due 24 Sep");
  });
});

describe("tasksState (US-B29 banners)", () => {
  it("reports error ahead of loading — the failure is the more specific thing we know", () => {
    expect(tasksState(["error", "unknown"])).toBe("error");
  });
  it("is loading while any query is still unknown", () => {
    expect(tasksState(["unknown", "complete"])).toBe("loading");
  });
  it("is ready once every query completed", () => {
    expect(tasksState(["complete", "complete"])).toBe("ready");
  });
  // `ready` is the one state with nothing to say, and it says it with an empty string rather than a
  // third banner — the same contract Today's STATE_COPY keeps.
  it("draws no banner when ready", () => {
    expect(TASKS_BANNER.ready).toBe("");
    expect(TASKS_BANNER.error).not.toBe("");
  });
});

// ─── the screen itself ──────────────────────────────────────────────────────────────────────────

/** The screen reads four tables through Zero. The fake tags each table's query so the mocked
 *  `useQuery` can answer with that table's rows — a flat "always return the same array" mock cannot
 *  tell the task list from the approval queue, and this screen's whole job is telling them apart. */
function chain(table: string) {
  const node: Record<string, unknown> = { __table: table };
  for (const m of ["where", "orderBy", "limit", "related"]) node[m] = () => node;
  return node;
}

const TABLES: Record<string, unknown> = {
  tasks: chain("tasks"),
  pending_approvals: chain("pending_approvals"),
  items: chain("items"),
  accounts: chain("accounts"),
};
const ROWS: Record<string, readonly unknown[]> = {
  tasks: [],
  pending_approvals: [],
  items: [],
  accounts: [],
};

const decideApproval = vi.fn(async () => {});
vi.mock("../src/api/approvals.js", () => ({
  decideApproval: (...args: unknown[]) => decideApproval(...args),
}));
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

const { Tasks } = await import("../src/screens/Tasks.js");

const TASKS = [
  {
    id: "t1",
    title: "Review the Brightstone redlines",
    detail: null,
    kind: "todo",
    state: "open",
    owner_kind: "me",
    source_item_id: "i1",
    person_id: null,
    delegated_session_id: null,
    due_at: new Date("2026-09-20T18:00:00").getTime(),
    done_at: null,
    created_at: Date.now(),
    created_by: "agent",
  },
];

beforeEach(() => {
  ROWS.tasks = TASKS;
  ROWS.pending_approvals = [];
  ROWS.items = [];
  ROWS.accounts = [];
  decideApproval.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Tasks screen (A5 §3.5)", () => {
  it("renders the four view tabs with Today selected", () => {
    render(<Tasks now={now} />);
    const tabs = screen.getAllByRole("radio");
    expect(tabs.map((t) => t.textContent)).toEqual(["Today", "This week", "Someday", "Delegated"]);
    expect(screen.getByRole("radio", { name: "Today" })).toHaveAttribute("aria-checked", "true");
  });

  it("lists the tasks of the selected view", () => {
    render(<Tasks now={now} />);
    expect(screen.getByText("Review the Brightstone redlines")).toBeInTheDocument();
  });

  it("switches views and swaps the list", () => {
    render(<Tasks now={now} />);
    fireEvent.click(screen.getByRole("radio", { name: "Someday" }));
    expect(screen.queryByText("Review the Brightstone redlines")).not.toBeInTheDocument();
    expect(screen.getByText("Nothing without a date")).toBeInTheDocument();
  });

  // §8 gives the two wordings that matter by name; the other two follow them rather than inventing
  // a different register. An empty view says what is empty about it — "No tasks" on the Someday tab
  // would be indistinguishable from a broken query.
  it("uses the §8 empty copy per view", () => {
    ROWS.tasks = [];
    render(<Tasks now={now} />);
    expect(screen.getByText("Nothing due today")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Delegated" }));
    expect(screen.getByText("No delegated tasks")).toBeInTheDocument();
  });

  it("offers the quick-add input (the `t` shortcut's field; the global key listener is the shell's)", () => {
    render(<Tasks now={now} />);
    expect(screen.getByRole("textbox", { name: "Quick add task" })).toBeInTheDocument();
  });

  // A delegation waiting on approval has nothing to open — the session does not exist yet. The row
  // draws the approval card's trigger instead, and expands the card in place (A5 §3.5's inline
  // delegation approval), which is what the ApprovalCardView reuse is for.
  it("expands a delegation's approval card inline and decides it through the hub", () => {
    ROWS.tasks = [
      { ...TASKS[0], id: "d1", kind: "delegation", owner_kind: "agent", state: "open" },
    ];
    ROWS.pending_approvals = [
      {
        id: "a1",
        action: "delegate",
        args: { runtime: "claude_code", host: "mini" },
        description: "Handing this task to claude_code on mini. Estimated 12 min.",
        config: { allow_accept: true, allow_edit: true, allow_respond: false, allow_ignore: true },
        state: "pending",
        task_id: "d1",
        thread_id: null,
        risk: "normal",
        created_at: 1,
      },
    ];
    render(<Tasks now={now} onOpenDelegation={() => {}} />);
    expect(screen.queryByText(/Handing this task to/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Needs approval" }));
    expect(screen.getByText(/Handing this task to/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(decideApproval).toHaveBeenCalledWith("a1", "accept", undefined);
  });

  // The delegation row with a live session opens it instead — the approval slot must not shadow the
  // navigation it is standing in for.
  it("opens the Agent Session for a delegated task that has one", () => {
    const onOpenDelegation = vi.fn();
    ROWS.tasks = [
      {
        ...TASKS[0],
        id: "d2",
        kind: "delegation",
        owner_kind: "agent",
        state: "in_progress",
        delegated_session_id: "s1",
      },
    ];
    render(<Tasks now={now} onOpenDelegation={onOpenDelegation} />);
    fireEvent.click(screen.getByRole("radio", { name: "Delegated" }));
    fireEvent.click(screen.getByRole("button", { name: "Open session" }));
    expect(onOpenDelegation).toHaveBeenCalledWith("s1");
  });

  // A5 §3.5: the source is always visible. The channel is the label — "Gmail" says which
  // conversation it came out of, and "View source" (the plan's placeholder) says nothing.
  it("labels the source with its channel and opens the source item", () => {
    const onOpenSource = vi.fn();
    ROWS.items = [{ id: "i1", account_id: "acc1" }];
    ROWS.accounts = [{ id: "acc1", channel: "gmail" }];
    render(<Tasks now={now} onOpenSource={onOpenSource} />);
    fireEvent.click(screen.getByRole("button", { name: "Gmail" }));
    expect(onOpenSource).toHaveBeenCalledWith("i1");
  });
});
