// @vitest-environment jsdom
// The screen's pure rules (the greeting, the state machine, the briefing parser) plus, since
// loop-r2-06, the render that shows its approvals come from the shell rather than from a query of
// its own. Everything above the render block is a function call.
import "./setup";

import type { ApprovalStackItem } from "@omnis/ui/components/approval-stack";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  STATE_COPY,
  Today,
  greetingLine,
  isSameLocalDay,
  parseMorningBriefing,
  screenState,
} from "../src/screens/Today.js";

/** `vi.hoisted` because the mock factories below run before this file's static imports: a plain
 *  `const` would still be in its temporal dead zone when the screen is first loaded. Every chain
 *  reads back as itself, so the screen can walk as far along a query as it likes. */
const { zero } = vi.hoisted(() => {
  const chain: unknown = new Proxy({}, { get: () => () => chain });
  return { zero: { query: new Proxy({}, { get: () => chain }) } };
});

vi.mock("../src/zero-client.js", () => ({
  initZero: () => zero,
  useZeroClient: () => zero,
  loadZeroToken: async () => {},
  hasZeroToken: () => true,
}));

// Every query answers with no rows. loop-r2-06's point is that this screen's approval count is a
// prop now: a number that still came from a query here could only read 0.
vi.mock("@rocicorp/zero/react", () => ({
  useQuery: () => [[], { type: "complete" }],
  useZero: () => zero,
  ZeroProvider: ({ children }: { children: unknown }) => children,
}));

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

describe("screenState (US-B28's states, less the one loop-r2-05 moved to the shell)", () => {
  const ok = { resultTypes: ["complete", "complete"] as const };
  it("error wins over everything — a failed query is the most specific thing we know", () => {
    expect(screenState({ resultTypes: ["error", "unknown"], hasContent: true })).toBe("error");
  });
  // loop-r2-05: there is no `offline` state here any more. Whether this window can see the hub is
  // one fact about the whole shell, and Today saying "You're offline" while the Inbox's subline
  // said "Updated now" was two screens telling different stories about the same socket. The
  // screen's own answer while a query has not answered is `loading`, and the shell's banner above
  // it says what the connection is doing.
  it("never reports offline — the shell's connection banner is the one place that is said", () => {
    expect(screenState({ resultTypes: ["unknown", "complete"], hasContent: false })).toBe(
      "loading",
    );
    expect(Object.keys(STATE_COPY)).not.toContain("offline");
  });
  it("loading while any query is still 'unknown'", () => {
    expect(screenState({ resultTypes: ["unknown", "complete"], hasContent: false })).toBe(
      "loading",
    );
  });
  it("empty when every query completed and there is nothing to show", () => {
    expect(screenState({ ...ok, hasContent: false })).toBe("empty");
  });
  it("ready when every query completed and there is something to show", () => {
    expect(screenState({ ...ok, hasContent: true })).toBe("ready");
  });
  // Already-synced local data stays on screen through a failed query — only the banner appears,
  // the lists stay alive: the return value is a state word, never a reason to blank the body.
  // `ready` is the one state with nothing to say, and it says it with an empty string rather than
  // a fourth state of the banner.
  it("keeps a state word for the caller, and says nothing when there is nothing to say", () => {
    expect(STATE_COPY.error).not.toBe("");
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

// loop-r2-06 (L2-07, L2-24): Today used to run its own `pending_approvals` query and call
// `decideApproval` directly, so it counted a different set from the Inbox's subline — three numbers
// for one queue — and a card decided from here left no toast, no undo, and no `hiddenApprovalIds`
// entry, so the same card was still sitting in the Inbox a moment later. It reads and decides
// through the shell now, and writes nothing to the hub itself.
describe("Today's approval strip (loop-r2-06)", () => {
  const fixture = (over: Partial<ApprovalStackItem> = {}): ApprovalStackItem => ({
    id: "ap-1",
    action: "send",
    description: "Send the deck to Dana?",
    args: {},
    config: { allow_accept: true, allow_edit: true, allow_respond: false, allow_ignore: true },
    thread_id: "t1",
    risk: "normal",
    created_at: Date.now(),
    ...over,
  });

  const expand = (description: string) =>
    fireEvent.click(screen.getByRole("button", { name: new RegExp(description) }));

  it("counts the shell's queue, not a query of its own", () => {
    // The mock answers every query with no rows, so both numbers can only come from the prop.
    const { container } = render(<Today approvals={[fixture()]} onDecide={vi.fn()} />);
    expect(container.querySelector(".today-screen__greeting")).toHaveTextContent(
      "1 approvals pending",
    );
    expect(screen.getByRole("heading", { name: "Pending approvals (1)" })).toBeInTheDocument();
  });

  it("decides through the shell and writes nothing to the hub itself", () => {
    const onDecide = vi.fn();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<Today approvals={[fixture()]} onDecide={onDecide} />);

    expand("Send the deck to Dana");
    // The card's Accept asks first (§c.8), so the decision is behind the prompt's own Approve.
    fireEvent.click(screen.getByText("Approve"));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Approve" }),
    );

    // The id is the approval's, and the screen collapses its own chip; the decision — and with it
    // the toast, the undo and the removal from the Inbox — is the shell's.
    expect(onDecide).toHaveBeenCalledWith("ap-1", "accept", undefined);
    expect(screen.queryByText("Approve")).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("names the destination on the card and offers a way into the thread", () => {
    const onOpenThread = vi.fn();
    render(
      <Today
        approvals={[fixture()]}
        onDecide={vi.fn()}
        destinationFor={() => "#omnis-launch"}
        onOpenThread={onOpenThread}
      />,
    );

    expand("Send the deck to Dana");
    // The card's own header sentence, from the shell's map — the same name the queue's rows use.
    expect(screen.getByText("Reply in #omnis-launch")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open thread" }));
    expect(onOpenThread).toHaveBeenCalledWith("t1");
  });

  it("offers no way into a thread it does not have", () => {
    // An approval raised outside any thread has no conversation to go back to; `onOpenThread` being
    // present is not enough on its own.
    render(
      <Today
        approvals={[fixture({ thread_id: null })]}
        onDecide={vi.fn()}
        onOpenThread={vi.fn()}
      />,
    );
    expand("Send the deck to Dana");
    expect(screen.queryByRole("button", { name: "Open thread" })).not.toBeInTheDocument();
  });
});
