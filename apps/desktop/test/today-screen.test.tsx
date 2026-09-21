import { describe, expect, it } from "vitest";
import {
  STATE_COPY,
  greetingLine,
  isSameLocalDay,
  parseMorningBriefing,
  screenState,
} from "../src/screens/Today.js";

describe("greetingLine (A5 §3.4 greeting <h1>)", () => {
  it("includes the pending item count and approval count", () => {
    expect(greetingLine("Logan", 12, 4, new Date("2026-09-20T09:00:00"))).toBe(
      "Good morning, Logan. 12 items to handle today, 4 approvals pending.",
    );
  });
  it("still reads naturally with zero of both", () => {
    expect(greetingLine("Logan", 0, 0, new Date("2026-09-20T09:00:00"))).toBe(
      "Good morning, Logan. 0 items to handle today, 0 approvals pending.",
    );
  });
  // The plan's greeting was a fixed "Good morning". The screen is Today, not Morning — at 15:00
  // that line is simply wrong, and it is the very first thing the screen says. `now` is a
  // parameter so the hour is not read from a clock the test cannot control.
  it.each([
    [8, "morning"],
    [11, "morning"],
    [12, "afternoon"],
    [17, "afternoon"],
    [18, "evening"],
    [23, "evening"],
  ] as const)("%s:00 greets in the %s", (hour, part) => {
    expect(greetingLine("Logan", 1, 1, new Date(2026, 8, 20, hour))).toContain(`Good ${part},`);
  });
});

describe("isSameLocalDay (today-calendar filter decision)", () => {
  it("is true for two timestamps on the same calendar day", () => {
    expect(isSameLocalDay(new Date("2026-09-20T01:00:00"), new Date("2026-09-20T23:00:00"))).toBe(
      true,
    );
  });
  it("is false across a day boundary", () => {
    expect(isSameLocalDay(new Date("2026-09-20T23:59:00"), new Date("2026-09-21T00:01:00"))).toBe(
      false,
    );
  });
});

describe("screenState (US-B28 4 states — loading/empty/error/offline)", () => {
  const ok = { online: true, resultTypes: ["complete", "complete"] as const };
  it("error wins over everything — a failed query is the most specific thing we know", () => {
    expect(
      screenState({ online: false, resultTypes: ["error", "unknown"], hasContent: true }),
    ).toBe("error");
  });
  it("offline beats loading — offline queries never reach 'complete', so 'loading' would hang forever", () => {
    expect(
      screenState({ online: false, resultTypes: ["unknown", "complete"], hasContent: false }),
    ).toBe("offline");
  });
  it("loading while any query is still 'unknown'", () => {
    expect(
      screenState({ online: true, resultTypes: ["unknown", "complete"], hasContent: false }),
    ).toBe("loading");
  });
  it("empty when every query completed and there is nothing to show", () => {
    expect(screenState({ ...ok, hasContent: false })).toBe("empty");
  });
  it("ready when every query completed and there is something to show", () => {
    expect(screenState({ ...ok, hasContent: true })).toBe("ready");
  });
  // Even offline, already-synced local data stays on screen — only the banner appears, the lists
  // stay alive: the return value is a state word, never a reason to blank the body. `ready` is the
  // one state with nothing to say, and it says it with an empty string rather than a third state
  // of the banner.
  it("offline still reports content so the caller keeps rendering the cached lists", () => {
    expect(STATE_COPY.offline).not.toBe("");
    expect(STATE_COPY.ready).toBe("");
  });
});

// US-B23 stores the briefing as JSON (`{greeting, sections, one_liner}`), so the screen parses
// before it can draw anything. Every case below is about not throwing and not drawing a lie: this
// runs on a row the hub wrote, and the screen is the last place a parse error can be noticed.
describe("parseMorningBriefing (digests.body for kind='morning' is JSON, not prose)", () => {
  const body = JSON.stringify({
    greeting: "Good morning",
    one_liner: "Two things need you before the 10:00.",
    sections: [
      {
        id: "needs_you",
        title: "Needs you",
        items: [
          { ref: { kind: "item", id: "i1" }, line: "Contract signature request", why: "due today" },
        ],
      },
      { id: "quiet", title: "Everything else", count: 3 },
    ],
  });

  it("reads the one-liner and the sections, and drops the body's own greeting", () => {
    const brief = parseMorningBriefing(body);
    expect(brief?.oneLiner).toBe("Two things need you before the 10:00.");
    expect(brief?.sections).toHaveLength(1);
    expect(brief?.sections[0]?.title).toBe("Needs you");
    expect(brief?.sections[0]?.items[0]?.ref).toEqual({ kind: "item", id: "i1" });
  });

  it("keeps a count-only section out — a header with nothing under it is not a list", () => {
    expect(parseMorningBriefing(body)?.sections.map((s) => s.id)).toEqual(["needs_you"]);
  });

  it.each([
    ["not JSON at all", "Preparing your briefing…"],
    ["a JSON string", '"just prose"'],
    ["JSON null", "null"],
    ["an object with no sections", JSON.stringify({ greeting: "hi" })],
  ])("returns null for %s, so the section is skipped instead of throwing", (_label, input) => {
    expect(parseMorningBriefing(input)).toBeNull();
  });

  it("drops an item with no usable ref id rather than linking to nothing", () => {
    const brief = parseMorningBriefing(
      JSON.stringify({
        one_liner: "x",
        sections: [
          { id: "s", title: "S", items: [{ line: "no ref" }, { ref: {}, line: "no id" }] },
          { id: "kept", title: "K", items: [{ ref: { id: "i1" }, line: "keep me" }] },
        ],
      }),
    );
    // The section whose every item was unusable is gone; the one with a usable item survives.
    expect(brief?.sections.map((s) => s.id)).toEqual(["kept"]);
  });

  it("defaults ref.kind to 'item' and why to an empty string", () => {
    const brief = parseMorningBriefing(
      JSON.stringify({
        one_liner: "x",
        sections: [{ title: "S", items: [{ ref: { id: "i1" }, line: "L" }] }],
      }),
    );
    expect(brief?.sections[0]?.items[0]).toEqual({
      ref: { kind: "item", id: "i1" },
      line: "L",
      why: "",
    });
  });
});
