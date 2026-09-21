// @vitest-environment jsdom
// The root `pnpm test` does not read apps/desktop/vitest.config.ts, so this file declares its own
// environment and setup (the same situation as agent-session-screen.test.tsx).
import "./setup";

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The same four-table Zero mock agent-session-screen.test.tsx uses: the screen looks its query up
 *  by table proxy, so each table needs its own rows. */
const tables: Record<string, unknown[]> = {
  items: [],
  agent_sessions: [],
  agent_runtimes: [],
  threads: [],
};
const tableName = new Map<unknown, string>();
function tableProxy(name: string): unknown {
  const proxy: unknown = new Proxy(() => {}, {
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

const { AgentSession, isImportedSessionKey } = await import("../src/screens/AgentSession");

const THREAD = "thread-imported-1";
const STARTED_AT = Date.now() - 6 * 60_000;
const READ_ONLY = "Read-only · opened in a terminal";

/** An imported session's thread: its external_id is the session key US-C16's job wrote. */
const IMPORTED_KEY = "agent:claude_code:macbook:term-aaaaaaaa";

function seed(sessionKey: string): void {
  tables.items = [
    { id: "item-1", kind: "agent_turn", tool: null, body: "Import the transcripts" },
    { id: "item-2", kind: "agent_turn", tool: null, body: "Written the job" },
  ];
  tables.agent_sessions = [
    {
      id: "session-1",
      runtime_id: "runtime-1",
      thread_id: THREAD,
      state: "idle",
      cwd: "/repo/omnis",
      started_at: STARTED_AT,
      last_turn_at: STARTED_AT + 60_000,
      ended_at: null,
    },
  ];
  tables.agent_runtimes = [
    { id: "runtime-1", runtime: "claude_code", host: "macbook", display: "claude_code@macbook" },
  ];
  tables.threads = [{ id: THREAD, title: "omnis · term-aaaaaaaa", external_id: sessionKey }];
}

describe("isImportedSessionKey (US-C16: the session key is the only marker)", () => {
  it("reads the key's purpose segment, not the runtime or the host", () => {
    expect(isImportedSessionKey(IMPORTED_KEY)).toBe(true);
    expect(isImportedSessionKey("agent:claude_code:macbook:inbox-draft")).toBe(false);
    // An ordinary purpose that merely starts with the same letters is not an import.
    expect(isImportedSessionKey("agent:claude_code:macbook:terminal-summary")).toBe(false);
  });

  it("is false for a thread that has no session key at all", () => {
    expect(isImportedSessionKey(undefined)).toBe(false);
    expect(isImportedSessionKey("")).toBe(false);
    expect(isImportedSessionKey("agent:claude_code:macbook")).toBe(false);
  });
});

describe("AgentSession, imported (US-C16: read-only, and it says so)", () => {
  beforeEach(() => seed(IMPORTED_KEY));

  it("marks the session read-only with the badge the brief names", () => {
    render(<AgentSession sessionThreadId={THREAD} />);
    expect(screen.getByText(READ_ONLY)).toBeInTheDocument();
  });

  it("renders the imported turns as a transcript", () => {
    render(<AgentSession sessionThreadId={THREAD} />);
    expect(screen.getByText("Import the transcripts")).toBeInTheDocument();
    expect(screen.getByText("Written the job")).toBeInTheDocument();
  });

  it("offers nothing to type into", () => {
    // The pane has no composer for any session today. This is the assertion that has to keep
    // holding: an imported transcript is a read-only record, so a composer arriving later must not
    // land on top of one (the badge above is the affordance it replaces).
    render(<AgentSession sessionThreadId={THREAD} />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(document.querySelector("form")).toBeNull();
  });
});

describe("AgentSession, live (US-C16: the badge is about the session, not the screen)", () => {
  it("shows no read-only badge on a session the hub opened itself", () => {
    seed("agent:claude_code:macbook:inbox-draft");
    render(<AgentSession sessionThreadId={THREAD} />);
    expect(screen.queryByText(READ_ONLY)).not.toBeInTheDocument();
    // The transcript is still there, so the absence above is the badge's and not the screen's.
    expect(screen.getByText("Import the transcripts")).toBeInTheDocument();
  });
});
