// @vitest-environment jsdom
// The root `pnpm test` does not read apps/desktop/vitest.config.ts, so this file declares its own
// environment and setup.
import "./setup";

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** loop-r1-07: the screen now reads four tables, so the Zero mock has to tell them apart. One proxy
 *  per table, and `useQuery` looks the proxy up to find its rows — the same trick app-shell.test.tsx
 *  uses with a single queue, widened to the set this screen needs. The chain's `get` and `apply`
 *  both hand back the table proxy, so `zero.query.items.where(…).orderBy(…)` is the *same object* as
 *  `zero.query.items` and nothing derived from a query can be mistaken for another one. */
const tables: Record<string, unknown[]> = {
  items: [],
  agent_sessions: [],
  agent_runtimes: [],
  threads: [],
};
const tableName = new Map<unknown, string>();
function tableProxy(name: string): unknown {
  const proxy: unknown = new Proxy(() => {}, {
    // Not a thenable: an `await` on a query object would otherwise resolve to the proxy itself.
    get: (_target, prop) => (prop === "then" ? undefined : proxy),
    apply: () => proxy,
  });
  tableName.set(proxy, name);
  return proxy;
}
const TABLES: Record<string, unknown> = Object.fromEntries(
  Object.keys(tables).map((name) => [name, tableProxy(name)]),
);
const chain: unknown = new Proxy(() => {}, {
  get: (_target, prop) => (typeof prop === "string" && prop in TABLES ? TABLES[prop] : chain),
  apply: () => chain,
});

vi.mock("../src/zero-client.js", () => ({
  initZero: () => chain,
  useZeroClient: () => chain,
  loadZeroToken: async () => {},
}));
vi.mock("@rocicorp/zero/react", () => ({
  useQuery: (q: unknown) => [tables[tableName.get(q) ?? ""] ?? [], { type: "complete" }],
  useZero: () => chain,
  ZeroProvider: ({ children }: { children: unknown }) => children,
}));

// Imported after the mocks are registered and the proxies exist — the same reason app-shell.test.tsx
// defers its import of App.
const { AgentSession, isSystemExecutionLog, hasToolArgs } = await import(
  "../src/screens/AgentSession"
);

const SESSION_THREAD = "thread-session-1";
const STARTED_AT = Date.now() - 6 * 60_000;

interface SessionFixture {
  id: string;
  runtime_id: string;
  thread_id: string;
  state: string;
  cwd: string;
  started_at: number;
  last_turn_at: number;
  ended_at: number | null;
}

let sessionRow: SessionFixture;

function seed(): void {
  sessionRow = {
    id: "session-1",
    runtime_id: "runtime-1",
    thread_id: SESSION_THREAD,
    state: "waiting_approval",
    cwd: "/Users/logankim/AI-Workspaces/omnis.plan-loop-r1",
    started_at: STARTED_AT,
    last_turn_at: STARTED_AT + 60_000,
    ended_at: null,
  };
  tables.items = [];
  tables.agent_sessions = [sessionRow];
  tables.agent_runtimes = [
    { id: "runtime-1", runtime: "claude_code", host: "macbook", display: "claude_code@macbook" },
  ];
  tables.threads = [{ id: SESSION_THREAD, title: "Inbox draft" }];
}

/** The pending approval this screen is handed by the shell (App.tsx), in the shape the queue's
 *  Zero rows already carry. */
const APPROVAL = {
  id: "approval-1",
  action: "send",
  description: "Send the countersigned NDA back to Northwind legal?",
  args: { channel: "slack" },
  config: { allow_accept: true, allow_edit: true, allow_respond: false, allow_ignore: true },
  thread_id: SESSION_THREAD,
  risk: "normal",
  created_at: STARTED_AT,
};

describe("hasToolArgs (loop-r1-07: what a tool call has to expand)", () => {
  it("is false for a call the hub recorded with no input at all", () => {
    // The hub writes `meta.input ?? {}`, so an empty object is the shape of "no arguments" rather
    // than a `<details>` that opens onto `{}`.
    expect(hasToolArgs({})).toBe(false);
    expect(hasToolArgs(undefined)).toBe(false);
    expect(hasToolArgs(null)).toBe(false);
  });

  it("is true as soon as there is one argument", () => {
    expect(hasToolArgs({ command: "ls src" })).toBe(true);
  });
});

describe("isSystemExecutionLog (A5 §3.3 §9: a proposal and an execution log read differently)", () => {
  it("kind='system' is an execution log line, not a tool badge", () => {
    expect(
      isSystemExecutionLog({
        id: "1",
        kind: "system",
        tool: null,
        body: "✓ Delegated to Codex",
      } as Parameters<typeof isSystemExecutionLog>[0]),
    ).toBe(true);
  });
  it("kind='tool_call' is not (it renders as ToolCallBadge)", () => {
    expect(
      isSystemExecutionLog({
        id: "2",
        kind: "tool_call",
        tool: { name: "read" },
        body: "",
      } as Parameters<typeof isSystemExecutionLog>[0]),
    ).toBe(false);
  });
});

describe("AgentSession header (loop-r1-07/L-10: the session has a name, a state and a place)", () => {
  beforeEach(seed);

  it("shows the thread title, the runtime on its host, the directory and the blocked pill", () => {
    render(<AgentSession sessionThreadId={SESSION_THREAD} />);

    expect(screen.getByRole("heading", { name: "Inbox draft" })).toBeInTheDocument();
    expect(screen.getByText("Claude Code on macbook")).toBeInTheDocument();
    expect(screen.getByText("Directory")).toBeInTheDocument();
    expect(
      screen.getByText("/Users/logankim/AI-Workspaces/omnis.plan-loop-r1"),
    ).toBeInTheDocument();
    // waiting_approval reads as the row badge's "Blocked" — the same mapper, not a second one.
    expect(screen.getByText("Blocked")).toBeInTheDocument();
  });

  it("says nothing about money (UX-13: Zero carries no cost for a session)", () => {
    render(<AgentSession sessionThreadId={SESSION_THREAD} />);
    expect(document.body.textContent ?? "").not.toContain("$");
  });
});

describe("AgentSession states (loop-r1-07/NC-08)", () => {
  beforeEach(seed);

  it("tells a working session with no output that it is working", () => {
    tables.agent_sessions = [{ ...sessionRow, state: "running" }];
    render(<AgentSession sessionThreadId={SESSION_THREAD} />);

    expect(screen.getByText("Working · no output yet")).toBeInTheDocument();
    // The one animation this story adds, and it is decoration: the dot is hidden from the a11y tree
    // and the sentence beside it carries the meaning.
    expect(document.querySelector(".agent-session-screen__empty-dot")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("says why a blocked session is blocked, and where the question went (loop-r2-07/L2-06)", () => {
    render(<AgentSession sessionThreadId={SESSION_THREAD} />);
    // Blocked is read off the DB state; the runtime and its host come off agent_runtimes. Nothing
    // in omnis holds a question for this session, so the terminal is the only place left to ask.
    const note = screen.getByRole("note");
    expect(note).toHaveClass("agent-session-screen__blocked");
    expect(note).toHaveTextContent(
      "Blocked · No approval is waiting in omnis. Claude Code may be asking in its own terminal on macbook.",
    );
  });

  it("leads with the session's own summary when there is one", () => {
    // The row above the pane already says this; a pane that opens with less than its own row is the
    // defect the story closes, so the sentence is carried through rather than reinvented.
    tables.agent_sessions = [
      { ...sessionRow, summary: "Waiting for approval of the reply wording" },
    ];
    render(<AgentSession sessionThreadId={SESSION_THREAD} />);
    expect(screen.getByRole("note")).toHaveTextContent(
      "Blocked · Waiting for approval of the reply wording. No approval is waiting in omnis.",
    );
  });

  it('never says "nothing to decide here yet" (the sentence is gone)', () => {
    render(<AgentSession sessionThreadId={SESSION_THREAD} />);
    expect(document.body.textContent ?? "").not.toContain("nothing to decide here yet");
  });

  it("says so plainly when a finished session recorded nothing", () => {
    tables.agent_sessions = [{ ...sessionRow, state: "ended" }];
    render(<AgentSession sessionThreadId={SESSION_THREAD} />);
    expect(screen.getByText("No activity recorded for this session.")).toBeInTheDocument();
  });
});

describe("AgentSession transcript (loop-r2-07/NC2-07: the pane shows at least what the row shows)", () => {
  beforeEach(seed);

  it("renders a 'message' item's body as a turn", () => {
    // The kind a session's own prose arrives as, and the one the inbox row has always summarised
    // the session with — without it the pane drew "Working · no output yet" over a session whose
    // row read "Writing drafts for 3 received mails (2/3)".
    tables.items = [
      {
        id: "item-1",
        kind: "message",
        tool: null,
        body: "Writing drafts for 3 received mails (2/3)",
      },
    ];
    render(<AgentSession sessionThreadId={SESSION_THREAD} />);

    const turn = screen.getByText("Writing drafts for 3 received mails (2/3)");
    expect(turn).toHaveClass("agent-session-screen__turn");
  });

  it("draws the blocked note under a transcript that ended in '✓ Turn completed'", () => {
    tables.items = [
      { id: "item-1", kind: "agent_turn", tool: null, body: "Reading the draft." },
      { id: "item-2", kind: "system", tool: null, body: "✓ Turn completed" },
    ];
    render(<AgentSession sessionThreadId={SESSION_THREAD} />);

    expect(screen.getByText("✓ Turn completed")).toBeInTheDocument();
    const note = screen.getByRole("note");
    // After, not before: "✓ Turn completed" is how the record ends, and the reason the session is
    // still blocked is the answer to it. The note is the last child of the screen.
    expect(document.querySelector(".agent-session-screen")?.lastElementChild).toBe(note);
  });
});

describe("AgentSession tool calls (loop-r1-07: one line collapsed, raw I/O expanded)", () => {
  beforeEach(() => {
    seed();
    tables.items = [
      { id: "item-1", kind: "agent_turn", tool: null, body: "Listing src/." },
      {
        id: "item-2",
        kind: "tool_call",
        tool: { name: "read", state: "done", label: "Bash", args: { command: "ls src" } },
        body: "index.ts\nmain.ts",
      },
      {
        id: "item-3",
        kind: "tool_call",
        tool: { name: "read", state: "done", label: "Bash", args: {} },
        body: "index.ts",
      },
      { id: "item-4", kind: "system", tool: null, body: "✓ Turn completed" },
    ];
  });

  it("expands a call that carries its arguments, and leaves one that does not as a bare badge", () => {
    render(<AgentSession sessionThreadId={SESSION_THREAD} />);

    // Only the call with arguments gets the disclosure: item-3's `{}` is what the hub writes for a
    // call that reported no input, and a control that opens onto nothing is worse than none.
    const details = document.querySelectorAll("details.agent-session-screen__tool");
    expect(details).toHaveLength(1);
    expect(details[0]?.querySelector("summary .tool-call-badge")).not.toBeNull();
    expect(document.querySelectorAll(".tool-call-badge")).toHaveLength(2);
    // The turn and the system log are unchanged: still paragraphs, still in order.
    expect(screen.getByText("Listing src/.")).toBeInTheDocument();
    expect(screen.getByText("✓ Turn completed")).toBeInTheDocument();
  });

  it("shows the raw arguments once the summary is clicked", () => {
    render(<AgentSession sessionThreadId={SESSION_THREAD} />);
    const details = document.querySelector("details.agent-session-screen__tool");
    if (!(details instanceof HTMLDetailsElement)) throw new Error("no <details> to open");

    // Native <details>: closed to begin with, and the arguments are the body it opens onto.
    expect(details.open).toBe(false);
    const pre = details.querySelector("pre");
    expect(pre?.textContent).toBe(JSON.stringify({ command: "ls src" }, null, 2));

    const summary = details.querySelector("summary");
    if (!(summary instanceof HTMLElement)) throw new Error("no <summary> to click");
    fireEvent.click(summary);

    expect(details.open).toBe(true);
  });
});

describe("AgentSession approvals (loop-r1-07: the queue moved under the header)", () => {
  beforeEach(seed);

  it("renders the waiting section and the card for this thread's pending approval", () => {
    render(
      <AgentSession sessionThreadId={SESSION_THREAD} approvals={[APPROVAL]} onDecide={() => {}} />,
    );

    // loop-r2-07: the label names the connection, not just the reader — this session is blocked on
    // *this* approval.
    expect(screen.getByText("Waiting for your approval")).toBeInTheDocument();
    expect(
      screen.getByText("Send the countersigned NDA back to Northwind legal?"),
    ).toBeInTheDocument();
    // The card *is* the answer to "blocked on what", so the note is not drawn beside it.
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });

  it("does not claim to be waiting on another thread's approval", () => {
    render(
      <AgentSession
        sessionThreadId={SESSION_THREAD}
        approvals={[{ ...APPROVAL, id: "approval-2", thread_id: "another-thread" }]}
        onDecide={() => {}}
      />,
    );

    expect(screen.queryByText("Waiting for your approval")).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("No approval is waiting in omnis");
  });
});
