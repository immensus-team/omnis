import { SessionSummary } from "@omnis/protocol";
import { describe, expect, it } from "vitest";
import {
  type TranscriptItemRow,
  type TranscriptSessionRow,
  buildSessionSummary,
  clampLastN,
  toSessionState,
} from "../src/transcript.js";

const session: TranscriptSessionRow = {
  id: "11111111-1111-1111-1111-111111111111",
  session_key: "agent:claude_code:macbook:omnis",
  runtime: "claude_code",
  host: "macbook",
  state: "running",
  summary: "Reviewing Phase B plan cross-review feedback",
  started_at: new Date("2026-09-20T01:00:00.000Z"),
  last_turn_at: new Date("2026-09-20T04:00:00.000Z"),
  turn_count: 42,
};

const items: TranscriptItemRow[] = [
  {
    id: "i1",
    kind: "agent_turn",
    body: "Read the plan",
    tool: null,
    author_is_me: false,
    sent_at: new Date("2026-09-20T03:58:00.000Z"),
  },
  {
    id: "i2",
    kind: "tool_call",
    body: "",
    tool: { label: "Read docs/plan.md", state: "ok" },
    author_is_me: false,
    sent_at: new Date("2026-09-20T03:59:00.000Z"),
  },
  {
    id: "i3",
    kind: "agent_turn",
    body: "Moving to the next task",
    tool: null,
    author_is_me: true,
    sent_at: new Date("2026-09-20T04:00:00.000Z"),
  },
];

describe("toSessionState (agent_sessions.state 6 values -> SessionState 5 values)", () => {
  it("maps starting/idle/ended to the protocol's three", () => {
    expect(toSessionState("starting")).toBe("idle");
    expect(toSessionState("idle")).toBe("idle");
    expect(toSessionState("ended")).toBe("closed");
  });
  it("maps waiting_approval to awaiting_approval (the names differ)", () => {
    expect(toSessionState("waiting_approval")).toBe("awaiting_approval");
  });
  it("passes running and failed through", () => {
    expect(toSessionState("running")).toBe("running");
    expect(toSessionState("failed")).toBe("failed");
  });
  it("throws on an unknown state instead of guessing", () => {
    expect(() => toSessionState("teleporting")).toThrow();
  });
});

describe("clampLastN (A2 §6 recent_turns <= 10)", () => {
  it("defaults to 10 and clamps out-of-range input", () => {
    expect(clampLastN(null)).toBe(10);
    expect(clampLastN("3")).toBe(3);
    expect(clampLastN("0")).toBe(1);
    expect(clampLastN("99")).toBe(10);
    expect(clampLastN("beer")).toBe(10);
  });
});

describe("buildSessionSummary", () => {
  it("produces a payload that parses against the protocol schema", () => {
    const out = buildSessionSummary(session, items);
    expect(() => SessionSummary.parse(out)).not.toThrow();
    expect(out.purpose).toBe("omnis");
    expect(out.state).toBe("running");
    expect(out.summary).toBe("Reviewing Phase B plan cross-review feedback");
    expect(out.open_questions).toEqual([]);
    expect(out.artifacts).toEqual([]);
  });

  it("folds tool_call items into the preceding turn instead of emitting a turn for them", () => {
    const out = buildSessionSummary(session, items);
    expect(out.recent_turns.map((t) => t.turn_id)).toEqual(["i1", "i3"]);
    expect(out.recent_turns[0]?.tool_calls).toEqual([{ label: "Read docs/plan.md", status: "ok" }]);
    expect(out.recent_turns[1]?.tool_calls).toEqual([]);
  });

  it("marks author_is_me turns as 'user' and the rest as 'agent'", () => {
    const out = buildSessionSummary(session, items);
    expect(out.recent_turns.map((t) => t.role)).toEqual(["agent", "user"]);
  });

  it("truncates turn text to 1000 chars so the schema never rejects a long turn", () => {
    const long: TranscriptItemRow[] = [
      {
        id: "i9",
        kind: "agent_turn",
        body: "x".repeat(2000),
        tool: null,
        author_is_me: false,
        sent_at: new Date("2026-09-20T04:01:00.000Z"),
      },
    ];
    const out = buildSessionSummary(session, long);
    expect(out.recent_turns[0]?.text.length).toBe(1000);
    expect(() => SessionSummary.parse(out)).not.toThrow();
  });

  it("uses an empty summary when the session has none yet", () => {
    const out = buildSessionSummary({ ...session, summary: null, last_turn_at: null }, []);
    expect(out.summary).toBe("");
    expect(out.last_turn_at).toBeNull();
    expect(() => SessionSummary.parse(out)).not.toThrow();
  });
});
