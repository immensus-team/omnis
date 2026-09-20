import { describe, expect, it } from "vitest";
import { type BriefCandidate, SECTION_CAPS, rankBriefItems } from "../src/index.js";

const now = new Date("2026-09-20T00:00:00Z");
const c = (over: Partial<BriefCandidate>): BriefCandidate => ({
  ref: { kind: "item", id: over.ref?.id ?? "i1" },
  thread_id: "t1",
  section: "needs_you",
  line: "one-liner",
  why: "reason",
  priority: "fyi",
  vip: false,
  pendingApproval: false,
  unansweredTurns: 0,
  meetingToday: false,
  dueToday: false,
  ageHours: 0,
  snoozed: false,
  ...over,
});

describe("rankBriefItems (A4 §6.3)", () => {
  it("scores priority, vip and pending approval in that weight order", () => {
    const out = rankBriefItems(
      [
        c({ ref: { kind: "item", id: "low" }, thread_id: "ta", priority: "fyi" }),
        c({ ref: { kind: "item", id: "now" }, thread_id: "tb", priority: "now" }),
        c({ ref: { kind: "item", id: "vip" }, thread_id: "tc", priority: "fyi", vip: true }),
      ],
      now,
    );
    expect(out.map((i) => i.ref.id)).toEqual(["now", "vip", "low"]);
  });

  it("shows a thread at most once across the whole briefing", () => {
    const out = rankBriefItems(
      [
        c({ ref: { kind: "item", id: "a" }, thread_id: "same", priority: "now" }),
        c({ ref: { kind: "item", id: "b" }, thread_id: "same", priority: "now" }),
        c({ ref: { kind: "item", id: "z" }, thread_id: "other", priority: "today" }),
      ],
      now,
    );
    expect(out.map((i) => i.ref.id)).toEqual(["a", "z"]);
  });

  it("pushes snoozed items down", () => {
    const out = rankBriefItems(
      [
        c({
          ref: { kind: "item", id: "snoozed" },
          thread_id: "t1",
          priority: "now",
          snoozed: true,
        }),
        c({ ref: { kind: "item", id: "plain" }, thread_id: "t2", priority: "today" }),
      ],
      now,
    );
    expect(out[0]?.ref.id).toBe("plain");
  });

  it("caps each section per A4 §6.2", () => {
    expect(SECTION_CAPS).toEqual({
      needs_you: 5,
      drafts: 7,
      calendar: Number.POSITIVE_INFINITY,
      commitments: 5,
      agents: 5,
    });
  });
});
