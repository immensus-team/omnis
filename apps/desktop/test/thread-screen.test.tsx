import { describe, expect, it } from "vitest";
import { type ThreadQueryItem, findDraftItem, threadSubline } from "../src/screens/Thread";

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
