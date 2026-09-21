import { describe, expect, it } from "vitest";
import { type InboxRowSource, toInboxRows } from "../src/screens/Inbox.js";

const NOW = Date.parse("2026-09-21T12:00:00Z");

function item(over: Partial<InboxRowSource> = {}): InboxRowSource {
  return {
    thread_id: "t1",
    account_id: "a-gmail",
    status: "received",
    sent_at: NOW - 60_000,
    body: "Could you check the countersigned NDA?",
    thread: { title: "Northwind NDA", unread_count: 0, kind: "thread", meta: null },
    ...over,
  };
}

const channels = new Map([["a-gmail", "gmail" as const]]);

describe("toInboxRows (A5 §3.1 row grammar, reduced to what the PWA renders)", () => {
  it("keeps one row per thread — the newest item, since the query is sent_at desc", () => {
    const rows = toInboxRows(
      [item({ sent_at: NOW, body: "newest" }), item({ sent_at: NOW - 5000, body: "older" })],
      channels,
      new Set(),
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.summary).toBe("newest");
  });

  it("names the row after the person, then the thread title", () => {
    const withPerson = toInboxRows(
      [item({ author: { display_name: "Dana Lee" } })],
      channels,
      new Set(),
      NOW,
    );
    expect(withPerson[0]?.name).toBe("Dana Lee");
    const withoutPerson = toInboxRows([item({ author: null })], channels, new Set(), NOW);
    expect(withoutPerson[0]?.name).toBe("Northwind NDA");
  });

  it("prefers the thread's stored summary, then the subject, then the body's first line", () => {
    const summarised = toInboxRows(
      [
        item({
          thread: {
            title: "T",
            unread_count: 0,
            kind: "thread",
            meta: { summary: "AI wrote this" },
          },
        }),
      ],
      channels,
      new Set(),
      NOW,
    );
    expect(summarised[0]?.summary).toBe("AI wrote this");
    const bare = toInboxRows(
      [item({ body: "First line\nsecond line", thread: { title: "T", unread_count: 0 } })],
      channels,
      new Set(),
      NOW,
    );
    expect(bare[0]?.summary).toBe("First line");
  });

  it("carries unread and the pending-approval flag through", () => {
    const rows = toInboxRows(
      [item({ thread: { title: "T", unread_count: 3, kind: "thread" } })],
      channels,
      new Set(["t1"]),
      NOW,
    );
    expect(rows[0]?.unread).toBe(true);
    expect(rows[0]?.unreadCount).toBe(3);
    expect(rows[0]?.hasPendingApproval).toBe(true);
  });

  it("marks an agent session as a session rather than as its channel", () => {
    const rows = toInboxRows(
      [
        item({
          thread: { title: "Refactor the ingest sink", unread_count: 0, kind: "agent_session" },
        }),
      ],
      channels,
      new Set(),
      NOW,
      // agent_sessions.state is the database vocabulary (A3's state check), not the badge's.
      new Map([["t1", { state: "waiting_approval", runtime: "claude_code" }]]),
    );
    expect(rows[0]?.agentState).toBe("blocked");
    expect(rows[0]?.avatar).toEqual({ kind: "runtime", runtime: "claude_code" });
  });

  it("drops the 60-item window down to the newest rows, in order", () => {
    const rows = toInboxRows(
      [
        item({ thread_id: "t2", sent_at: NOW - 1000 }),
        item({ thread_id: "t3", sent_at: NOW - 2000 }),
      ],
      channels,
      new Set(),
      NOW,
    );
    expect(rows.map((r) => r.id)).toEqual(["t2", "t3"]);
  });
});
