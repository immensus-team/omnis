// @vitest-environment jsdom
// loop-r1-03: the keyboard triage grammar. `j`/`k` and the arrow keys move the selection, `e`
// archives the selected row and lands on the next one (L-02, NC-02: it used to stay put, so every
// further `e` posted the same id), Home/End reach the ends of the list (L-19), and the list is a
// single tab stop (NC-18: it used to be three per row, 27 Tabs to the pane).
//
// The Zero and fetch mocking is archive-inbox.test.tsx's — a query proxy tagged by table name, so
// Inbox's seven queries get rows this file decides on. The focus assertions read document.activeElement
// because focus *is* the selection here: it is what makes the roving tab stop and `j` the same
// gesture rather than two that have to be kept in step.
import "./setup";

import { type ToastRequest } from "@omnis/ui";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { VirtuosoMockContext } from "react-virtuoso";
import { beforeEach, describe, expect, it, vi } from "vitest";

const THREADS = [
  "11111111-1111-1111-1111-111111111111",
  "22222222-2222-2222-2222-222222222222",
  "33333333-3333-3333-3333-333333333333",
  "44444444-4444-4444-4444-444444444444",
] as const;
const TITLES = ["Row one", "Row two", "Row three", "Row four"] as const;
const NOW = Date.UTC(2026, 8, 21, 12, 0, 0);

/** InboxRow's `openDelay` on the person card. The two card tests below have to wait past it: a
 *  card that "did not open" because the test never waited is not the same as one the focus could
 *  not open, and only the second is the property this story added. */
const CARD_OPEN_DELAY_MS = 400;

/** Newest first, which is the order the query's `sent_at desc` hands them over and therefore the
 *  order the rows are listed in — the tests' "row 2" has to be the second row on screen. */
function item(index: number) {
  const threadId = THREADS[index] as string;
  return {
    id: `item-${index}`,
    thread_id: threadId,
    account_id: "acct-1",
    status: "received",
    scope: "work",
    subject: null,
    body: `${TITLES[index]} body`,
    sent_at: NOW - index * 60_000,
    author_person_id: null,
    author_agent_id: null,
    thread: {
      id: threadId,
      kind: "email",
      title: TITLES[index],
      external_id: TITLES[index],
      meta: {},
      unread_count: 0,
      archived_at: null,
    },
    author: null,
  };
}

const store: Record<string, unknown[]> = {
  items: THREADS.map((_, index) => item(index)),
  accounts: [{ id: "acct-1", channel: "gmail" }],
  pending_approvals: [],
  labels: [],
  thread_labels: [],
  agent_sessions: [],
  agent_runtimes: [],
};

/** zero.query.<table>....(chain) -> { __table }. Every chain method returns the proxy itself. */
function taggedQuery(table: string): unknown {
  const proxy: unknown = new Proxy(
    {},
    { get: (_t, prop) => (prop === "__table" ? table : () => proxy) },
  );
  return proxy;
}
const zero = { query: new Proxy({}, { get: (_t, table) => taggedQuery(String(table)) }) };

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

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const { Inbox } = await import("../src/screens/Inbox");

const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }) as unknown as Response);
beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

const renderInbox = (notify?: (spec: ToastRequest) => void): void => {
  render(
    <VirtuosoMockContext.Provider value={{ viewportHeight: 600, itemHeight: 72 }}>
      <Inbox notify={notify} />
    </VirtuosoMockContext.Provider>,
  );
};

/** The thread id each write named, in the order the writes went out. The URL is the assertion
 *  rather than a spy on `setThreadArchived`, because the URL is what the hub actually receives —
 *  the bug this file is about was a correct function being handed the wrong id. */
const writtenIds = (): string[] =>
  fetchMock.mock.calls.map(
    (call) =>
      String(call[0]).match(/\/api\/threads\/([^/]+)\/(?:un)?archive$/)?.[1] ?? "(not a write)",
  );

/** The same list, with the verb on it — `unarchive:2222…`. loop-r2-08's undo tests need it: an
 *  undo of an archive is only an undo if the call it makes is `unarchive`, and a toggle that had
 *  re-armed itself with the inverse would send `archive` for the same id and read as a restore to
 *  a reader who only looked at `writtenIds`. Same reading and the same reason as above. */
const writes = (): string[] =>
  fetchMock.mock.calls.map((call) => {
    const match = String(call[0]).match(/\/api\/threads\/([^/]+)\/(unarchive|archive)$/);
    return match === null ? "(not a write)" : `${match[2]}:${match[1]}`;
  });

const rows = (): HTMLElement[] => screen.queryAllByRole("option");
const rowById = (threadId: string): HTMLElement => {
  const el = document.querySelector(`[data-thread-id="${threadId}"]`);
  if (!(el instanceof HTMLElement)) throw new Error(`no row for ${threadId}`);
  return el;
};
const selected = (threadId: string): string | null =>
  rowById(threadId).getAttribute("aria-selected");
const tabStops = (): HTMLElement[] => rows().filter((row) => row.getAttribute("tabindex") === "0");

/** `moveTo` puts the focus on the row a frame after the key — the row may only just have been
 *  mounted by the virtualiser, so the focus cannot be read on the same tick. The component's frame
 *  is requested before this one, so awaiting a single frame runs it first. */
const nextFrame = async (): Promise<void> => {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
};

/** Real timers, and the wait is the assertion rather than padding — see CARD_OPEN_DELAY_MS. */
const pastCardDelay = async (): Promise<void> => {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, CARD_OPEN_DELAY_MS + 120));
  });
};

/** The hover card's own box. It is portalled to document.body, so it is looked up on the document
 *  rather than inside the rendered container. */
const personCard = (): Element | null => document.querySelector(".row-hover-card");

describe("Inbox keyboard triage (loop-r1-03)", () => {
  it("moves the selection down with `j`, from nothing selected, and `k` back up", async () => {
    renderInbox();
    // Nothing is selected on load, so the first `j` has to land on the first row — the list is a
    // keyboard surface before a mouse has touched it.
    expect(tabStops()).toEqual([rowById(THREADS[0])]);

    fireEvent.keyDown(window, { key: "j" });
    await nextFrame();
    expect(selected(THREADS[0])).toBe("true");

    fireEvent.keyDown(window, { key: "j" });
    await nextFrame();
    // The second row holds the selection *and* the focus: they are one thing here, which is what
    // makes the roving tab stop and `j` the same gesture instead of two kept in step by hand.
    expect(selected(THREADS[1])).toBe("true");
    expect(document.activeElement).toBe(rowById(THREADS[1]));
    expect(selected(THREADS[0])).toBe("false");
    expect(tabStops()).toEqual([rowById(THREADS[1])]);

    fireEvent.keyDown(window, { key: "k" });
    await nextFrame();
    expect(selected(THREADS[0])).toBe("true");
    expect(document.activeElement).toBe(rowById(THREADS[0]));

    // At the top it stays put rather than wrapping round to the bottom.
    fireEvent.keyDown(window, { key: "k" });
    await nextFrame();
    expect(selected(THREADS[0])).toBe("true");
  });

  it("archives the selected row with `e` and lands on the row after it", async () => {
    renderInbox();
    fireEvent.keyDown(window, { key: "j" });
    await nextFrame();
    fireEvent.keyDown(window, { key: "j" });
    await nextFrame();
    expect(writtenIds()).toEqual([]);

    fireEvent.keyDown(window, { key: "e" });
    await nextFrame();

    expect(writtenIds()).toEqual([THREADS[1]]);
    // L-02: the selection lands on the next thread, so the list can be triaged without reaching for
    // the mouse between rows.
    expect(selected(THREADS[2])).toBe("true");
    expect(document.activeElement).toBe(rowById(THREADS[2]));
    expect(selected(THREADS[1])).toBe("false");
    // The archived row is still in the list — it is playing its 240ms leave animation (US-D04) —
    // and it is still exactly one tab stop, on the row the selection moved to.
    expect(rowById(THREADS[1])).toBeInTheDocument();
    expect(tabStops()).toEqual([rowById(THREADS[2])]);
  });

  it("carries the *next* row's id on the second `e`, not the one just archived (NC-02)", async () => {
    renderInbox();
    for (const key of ["j", "j", "e", "e"]) {
      fireEvent.keyDown(window, { key });
      await nextFrame();
    }
    // The stuck selection: the first `e` archived row two and the second archived row two again,
    // so the hub only ever heard about one thread. Three distinct threads, three distinct ids.
    expect(writtenIds()).toEqual([THREADS[1], THREADS[2]]);
    expect(selected(THREADS[3])).toBe("true");
  });

  it("falls back to the row before it when the last row is archived", async () => {
    renderInbox();
    // Home/End are the list's keys, not the window's — a press has to come from inside the list
    // for it to count (that scoping is the point of the wrapper's own handler).
    fireEvent.keyDown(rowById(THREADS[0]), { key: "End" });
    await nextFrame();
    expect(selected(THREADS[3])).toBe("true");

    fireEvent.keyDown(window, { key: "e" });
    await nextFrame();
    expect(writtenIds()).toEqual([THREADS[3]]);
    expect(selected(THREADS[2])).toBe("true");
    expect(tabStops()).toEqual([rowById(THREADS[2])]);
  });

  it("moves with the arrow keys and Home/End (L-19)", async () => {
    renderInbox();
    fireEvent.keyDown(rowById(THREADS[0]), { key: "ArrowDown" });
    await nextFrame();
    expect(selected(THREADS[0])).toBe("true");

    fireEvent.keyDown(rowById(THREADS[0]), { key: "ArrowDown" });
    await nextFrame();
    expect(selected(THREADS[1])).toBe("true");

    fireEvent.keyDown(rowById(THREADS[1]), { key: "End" });
    await nextFrame();
    expect(selected(THREADS[3])).toBe("true");
    expect(document.activeElement).toBe(rowById(THREADS[3]));

    fireEvent.keyDown(rowById(THREADS[3]), { key: "Home" });
    await nextFrame();
    expect(selected(THREADS[0])).toBe("true");
    expect(document.activeElement).toBe(rowById(THREADS[0]));

    fireEvent.keyDown(rowById(THREADS[0]), { key: "ArrowUp" });
    await nextFrame();
    expect(selected(THREADS[0])).toBe("true");
  });

  it("keeps exactly one row as the list's tab stop through a whole triage run (NC-18)", async () => {
    renderInbox();
    for (const key of ["j", "j", "j", "k", "e", "j", "Home", "End"]) {
      fireEvent.keyDown(key === "Home" || key === "End" ? rowById(THREADS[0]) : window, { key });
      await nextFrame();
      expect(tabStops()).toHaveLength(1);
    }
    // The stop is the row itself and never one of its controls: "More actions" and "Archive" are
    // out of the tab order, which is 27 Tabs' worth of the finding. They stay clickable — the
    // existing archive tests press both — and the archive is on `e` besides.
    for (const button of screen.queryAllByRole("button", { name: "More actions" })) {
      expect(button).toHaveAttribute("tabindex", "-1");
    }
    for (const button of screen.queryAllByRole("button", { name: "Archive" })) {
      expect(button).toHaveAttribute("tabindex", "-1");
    }
  });

  it("does not open the row's person card when `j` moves the focus", async () => {
    renderInbox();
    // The regression this asserts against: Radix's HoverCardTrigger opens on `focus` as well as on
    // `pointerenter`. Once `j` began moving the real focus from row to row, every move that rested
    // opened a PersonCard over the detail pane — the approval queue a keyboard-first triager is
    // reading, covered by the card of the row they had just landed on.
    fireEvent.keyDown(window, { key: "j" });
    await nextFrame();
    expect(document.activeElement).toBe(rowById(THREADS[0]));

    await pastCardDelay();
    expect(document.activeElement).toBe(rowById(THREADS[0]));
    expect(personCard()).toBeNull();

    fireEvent.keyDown(window, { key: "j" });
    await nextFrame();
    await pastCardDelay();
    expect(personCard()).toBeNull();
  });

  it("still opens the person card on a pointer, so the card survives the guard", async () => {
    renderInbox();
    // The other half of the same coin: gating the card on the pointer is only correct if the
    // pointer still opens it. Without this, "the focus does not open the card" is also satisfied
    // by a card that never opens at all.
    fireEvent.pointerOver(rowById(THREADS[0]));
    await pastCardDelay();
    expect(personCard()).not.toBeNull();
  });
});

/** loop-r2-08/L2-10, NC2-09: the undo is a stack, not a toggle. What both testers did was archive
 *  two rows and press ⌘Z twice, expecting two threads back; the toggle gave them one, because the
 *  second ⌘Z undid the undo (it re-armed `lastToggle` with the inverse action, so `z` archived the
 *  thread the first ⌘Z had just restored). The keys also went dead when their toast expired, which
 *  is the other half of the same finding. */
describe("Inbox undo stack (loop-r2-08)", () => {
  /** `j` to a row and archive it, the way the triage keys do. */
  const selectAndArchive = async (downs: number): Promise<void> => {
    for (let i = 0; i < downs; i += 1) {
      fireEvent.keyDown(window, { key: "j" });
      await nextFrame();
    }
    fireEvent.keyDown(window, { key: "e" });
    await nextFrame();
  };

  it("restores two threads across two ⌘Z presses, newest first", async () => {
    renderInbox();
    await selectAndArchive(1); // row 1 archived, selection advances to row 2
    await selectAndArchive(0); // row 2 archived, selection advances to row 3
    expect(writes()).toEqual([`archive:${THREADS[0]}`, `archive:${THREADS[1]}`]);

    fireEvent.keyDown(window, { key: "z", metaKey: true });
    await nextFrame();
    // The newest first: the thread archived last is the one the first undo takes back.
    expect(writes()[2]).toBe(`unarchive:${THREADS[1]}`);

    fireEvent.keyDown(window, { key: "z", metaKey: true });
    await nextFrame();
    expect(writes()[3]).toBe(`unarchive:${THREADS[0]}`);
  });

  it("does nothing at all on a third ⌘Z — the stack is what bounds it, not a toast", async () => {
    renderInbox();
    await selectAndArchive(1);
    await selectAndArchive(0);

    for (const key of ["z", "z", "z"]) {
      fireEvent.keyDown(window, { key, metaKey: true });
      await nextFrame();
    }
    // Four calls: two archives and the two undos they earned. The third press has an empty stack,
    // and an empty stack posts nothing — the old ref was disarmed by its toast expiring, which is
    // why this press used to be a no-op for the wrong reason and a live toggle before that.
    expect(writes()).toHaveLength(4);
    expect(writes().filter((w) => w.startsWith("archive:"))).toHaveLength(2);
  });

  it("selects and focuses the row it restored", async () => {
    renderInbox();
    // Two archives, so the selection has advanced one row *past* the one the undo brings back and
    // nothing about the result is a leftover of where the triage run had got to.
    await selectAndArchive(1);
    await selectAndArchive(0);
    expect(selected(THREADS[1])).toBe("false");
    expect(selected(THREADS[2])).toBe("true");

    fireEvent.keyDown(window, { key: "z", metaKey: true });
    await nextFrame();

    expect(selected(THREADS[1])).toBe("true");
    expect(document.activeElement).toBe(rowById(THREADS[1]));
    expect(tabStops()).toEqual([rowById(THREADS[1])]);
  });

  it("says which thread it archived, not just that something was", async () => {
    const notify = vi.fn();
    renderInbox(notify);
    fireEvent.keyDown(window, { key: "j" });
    await nextFrame();
    fireEvent.keyDown(window, { key: "e" });
    await nextFrame();

    // L2-10/NC2-09: "Archived" alone is a sentence about nothing — with two archives in a row it
    // named neither, and the undo it offered was a guess. The title is the row's own title.
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ message: `Archived "${TITLES[0]}"` }),
    );
  });
});
