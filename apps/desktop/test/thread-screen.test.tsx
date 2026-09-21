import { describe, expect, it } from "vitest";
import {
  type ThreadQueryItem,
  findDraftItem,
  threadFlow,
  threadSubline,
} from "../src/screens/Thread";

const items: ThreadQueryItem[] = [
  { id: "1", status: "read", body: "acknowledged" },
  { id: "2", status: "draft", body: "this draft is the newest" },
];

describe("findDraftItem (A5 §3.2 DraftCard appears only while a status='draft' Item exists)", () => {
  it("returns the draft item when present", () => {
    expect(findDraftItem(items)?.id).toBe("2");
  });
  it("returns undefined when no draft exists", () => {
    expect(findDraftItem(items.filter((i) => i.status !== "draft"))).toBeUndefined();
  });
});

describe("threadSubline (US-D03: the reference's one grey line under the title)", () => {
  it("reads channel, people, last activity in that order", () => {
    expect(
      threadSubline({
        channel: "Slack",
        participants: ["Sora Kim", "Marcus Lee"],
        lastActivity: "3m",
      }),
    ).toBe("Slack · Sora Kim, Marcus Lee · last activity 3m");
  });

  it("drops an empty part instead of leaving a separator behind", () => {
    // An agent session has no channel and no participants; a stray " · " would be a line of
    // punctuation with nothing between it.
    expect(threadSubline({ channel: null, participants: [], lastActivity: "2w" })).toBe(
      "last activity 2w",
    );
    expect(threadSubline({ channel: "Gmail", participants: [], lastActivity: null })).toBe("Gmail");
  });

  it("counts the people it did not name", () => {
    // Four names in a 13px line at 390px is a wrapped subline on every thread that has a group;
    // the fourth name is the one nobody reads.
    expect(
      threadSubline({
        channel: "Slack",
        participants: ["A", "B", "C", "D", "E"],
        lastActivity: null,
      }),
    ).toBe("Slack · A, B, C +2");
  });
});

describe("threadFlow (US-D09 §c.5: approvals are events in the conversation, in document order)", () => {
  const approval = (id: string, thread_id: string | null, created_at: number) => ({
    id,
    thread_id,
    created_at,
    risk: "normal",
    action: "send" as const,
    description: `${id} description`,
    config: { allow_accept: true, allow_edit: false, allow_respond: false, allow_ignore: false },
  });

  const messages: ThreadQueryItem[] = [
    { id: "m1", status: "read", body: "first", sent_at: 100 },
    { id: "m2", status: "read", body: "second", sent_at: 300 },
  ];

  it("places an approval between the messages it came between", () => {
    const flow = threadFlow(messages, [approval("a1", "t1", 200)], "t1");
    expect(flow.map((node) => (node.kind === "item" ? node.item.id : node.approval.id))).toEqual([
      "m1",
      "a1",
      "m2",
    ]);
  });

  it("keeps another thread's approval out of this one", () => {
    // The same scoping US-D03 gave the stack: the pane is about the conversation in front of you.
    const flow = threadFlow(
      messages,
      [approval("a1", "other", 200), approval("a2", null, 250)],
      "t1",
    );
    expect(flow).toHaveLength(2);
  });

  it("puts the message before an approval raised in the same millisecond", () => {
    // Stable sort, and the push order is items-then-approvals: the thing that caused the approval
    // is the thing above it.
    const flow = threadFlow(messages, [approval("a1", "t1", 100)], "t1");
    expect(flow.map((node) => node.kind)).toEqual(["item", "approval", "item"]);
  });

  it("keeps an item with no sent_at at the top rather than dropping it", () => {
    // A fixture (and any row written before sent_at was filled) has no timestamp; the flow shows it
    // rather than losing a message.
    const flow = threadFlow([{ id: "m0", status: "read", body: "no clock" }], [], "t1");
    expect(flow.map((node) => (node.kind === "item" ? node.item.id : ""))).toEqual(["m0"]);
  });
});
