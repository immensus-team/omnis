// @vitest-environment jsdom
// The root `pnpm test` does not read apps/desktop/vitest.config.ts, so the environment and setup are
// declared by the file itself — the same two lines narrow-thread-sheet.test.tsx carries.
import "./setup";

import type { ApprovalStackItem } from "@omnis/ui";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Thread,
  type ThreadQueryItem,
  findDraftItem,
  foldDraft,
  threadFlow,
  threadSubline,
} from "../src/screens/Thread";

/** loop-r2-02: the thread screen reads eight tables through `useQuery`, so the mock is table-tagged
 *  — one shared value would answer the items and the approvals the same. Same shape as
 *  narrow-thread-sheet.test.tsx and archive-inbox.test.tsx. */
const { store, zero } = vi.hoisted(() => {
  const tagged = (table: string): unknown => {
    const proxy: unknown = new Proxy(
      {},
      { get: (_t, prop) => (prop === "__table" ? table : () => proxy) },
    );
    return proxy;
  };
  return {
    store: {} as Record<string, unknown[]>,
    zero: { query: new Proxy({}, { get: (_t, table) => tagged(String(table)) }) },
  };
});

vi.mock("../src/zero-client.js", () => ({
  initZero: () => zero,
  useZeroClient: () => zero,
  loadZeroToken: async () => {},
}));
vi.mock("@rocicorp/zero/react", () => ({
  useQuery: (q: { __table: string }) => [store[q.__table] ?? [], { type: "complete" }],
  useZero: () => zero,
  ZeroProvider: ({ children }: { children: unknown }) => children,
}));

const THREAD_ID = "11111111-1111-1111-1111-111111111111";
const DRAFT_BODY = "Yes, I will review it today.";

const threadRow = {
  id: THREAD_ID,
  account_id: "acc-1",
  external_id: "omnis-launch",
  title: "omnis-launch",
  scope: "work",
  unread_count: 0,
  created_at: 1,
  archived_at: null,
};

/** loop-r2-02: the two halves of one reply — the draft item and the `send` proposed over it. */
const draftItem = { id: "item-draft", status: "draft", body: DRAFT_BODY, sent_at: 3 };
const draftApproval = {
  id: "approval-1",
  thread_id: THREAD_ID,
  item_id: "item-draft",
  created_at: 4,
  risk: "normal",
  action: "send",
  description: "Reply to #omnis-launch?",
  args: { channel: "slack", body: DRAFT_BODY },
  config: { allow_accept: true, allow_edit: true, allow_respond: false, allow_ignore: true },
};

/** A thread with one ordinary message, the draft, and (when the test wants it) the approval. */
function seedStore(approvals: unknown[]): void {
  store.items = [
    {
      id: "item-1",
      status: "received",
      external_id: "slack-1",
      body: "can you take a look",
      sent_at: 1,
    },
    draftItem,
  ];
  store.threads = [threadRow];
  store.pending_approvals = approvals;
  store.accounts = [];
  store.persons = [];
  store.notes = [];
  store.labels = [];
  store.thread_labels = [];
}

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

/* loop-r2-02: one reply, one card. */
describe("foldDraft (a draft and the approval about it are one object)", () => {
  const approval = (over: Partial<ApprovalStackItem> = {}): ApprovalStackItem => ({
    id: "a1",
    thread_id: "t1",
    item_id: null,
    created_at: 1,
    risk: "normal",
    action: "send",
    description: "Reply?",
    args: { body: "yes" },
    config: { allow_accept: true, allow_edit: true, allow_respond: false, allow_ignore: true },
    ...over,
  });
  const items: ThreadQueryItem[] = [{ id: "d1", status: "draft", body: "yes" }];

  it("pairs by item_id first", () => {
    const byId = approval({ id: "by-id", item_id: "d1", args: { body: "something else" } });
    const byBody = approval({ id: "by-body" });
    expect(foldDraft(items, [byBody, byId], "t1").draftApproval?.id).toBe("by-id");
  });

  it("falls back to the approval quoting the same body", () => {
    // Rows written before the proposing caller filled `item_id` in.
    expect(foldDraft(items, [approval({ id: "by-body" })], "t1").draftApproval?.id).toBe("by-body");
  });

  it("takes nothing when the body differs and no item_id matches", () => {
    const other = approval({ args: { body: "a different reply" } });
    expect(foldDraft(items, [other], "t1").draftApproval).toBeUndefined();
  });

  it("keeps another thread's approval out of it", () => {
    expect(
      foldDraft(items, [approval({ item_id: "d1", thread_id: "t2" })], "t1").draftApproval,
    ).toBeUndefined();
  });

  it("folds nothing when no draft item exists", () => {
    // The clause that keeps the fallback honest: with no draft there is nothing to pair, even
    // though a `send` approval happened to quote a body.
    const fold = foldDraft([{ id: "m1", status: "received", body: "yes" }], [approval()], "t1");
    expect(fold).toEqual({ draft: undefined, draftApproval: undefined });
  });

  it("ignores an approval that is not a send", () => {
    const edit = approval({ item_id: "d1", action: "delete" });
    expect(foldDraft(items, [edit], "t1").draftApproval).toBeUndefined();
  });
});

describe("Thread — the draft and its approval are one card (loop-r2-02)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the reply once, as the approval's own card", () => {
    seedStore([draftApproval]);
    render(<Thread threadId={THREAD_ID} approvals={[draftApproval]} onDecide={vi.fn()} />);

    // The reported defect: the same sentence as a flow bubble, a draft card and an approval card.
    expect(screen.getAllByText(DRAFT_BODY)).toHaveLength(1);
    // The one action word for "throw this draft away" is on the card the person decides.
    expect(screen.getAllByRole("button", { name: "Discard" })).toHaveLength(1);
    // And the card is the approval's: header, provenance, and the message it would send.
    expect(screen.getByText("Reply in omnis-launch · Slack")).toBeInTheDocument();
    expect(screen.getByText("Drafted from memory and past threads")).toBeInTheDocument();
    expect(document.querySelector(".draft-card")).toBeNull();
    // The draft's id is the approval's item: the folded card is what decides it.
    expect(document.querySelector(".thread-screen__draft")).not.toBeNull();
  });

  it("renders the standalone DraftCard, with Discard only, when no approval is about the draft", () => {
    seedStore([]);
    render(<Thread threadId={THREAD_ID} approvals={[]} onDecide={vi.fn()} />);

    const card = document.querySelector(".draft-card");
    expect(card).not.toBeNull();
    expect(screen.getAllByText(DRAFT_BODY)).toHaveLength(1);
    // "Edit & send" and "Regenerate" were buttons that did nothing when pressed; a card that keeps
    // them is the defect, so this asserts the card's whole set rather than the one it needs.
    const buttons = screen.getAllByRole("button").filter((b) => card?.contains(b) === true);
    expect(buttons.map((b) => b.textContent)).toEqual(["Discard"]);
  });

  it("discards a standalone draft through the hub, not through Zero", () => {
    // Zero grants no write permissions, so `zero.mutate.items.update` was rejected by the server and
    // the old Discard failed silently. The assertion is on the request, which is the only place
    // that failure was ever visible.
    seedStore([]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    render(<Thread threadId={THREAD_ID} approvals={[]} onDecide={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/items/item-draft/discard");
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.method).toBe("POST");
  });

  it("draws neither card while App holds the ignored approval for its undo", () => {
    // The 5s window: the approval is off screen, so the draft would stop folding and redraw as a
    // standalone DraftCard — the card the person just dismissed, back on screen one frame later.
    seedStore([draftApproval]);
    render(
      <Thread
        threadId={THREAD_ID}
        approvals={[draftApproval]}
        onDecide={vi.fn()}
        heldItemIds={new Set(["item-draft"])}
      />,
    );
    expect(screen.queryByText(DRAFT_BODY)).toBeNull();
    expect(document.querySelector(".draft-card")).toBeNull();
    expect(document.querySelector(".thread-screen__draft")).toBeNull();
  });
});
