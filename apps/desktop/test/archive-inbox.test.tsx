// @vitest-environment jsdom
// US-A36: archive a row -> it leaves the Inbox and appears in the "Archived" view -> Restore
// brings it back. app-shell.test.tsx's proxy mock answers every query with the same value, so this
// file tags queries by table name and returns different rows per table (Inbox runs seven).
import "./setup";

import { TOAST_MS, type ToastRequest, Toaster, toast as raiseToast } from "@omnis/ui";
import { LEAVE_MS, REDUCED_FADE_MS } from "@omnis/ui/lib/motion";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { type MouseEvent as ReactMouseEvent, useRef } from "react";
import { VirtuosoMockContext } from "react-virtuoso";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const THREAD_A = "11111111-1111-1111-1111-111111111111";
const THREAD_B = "22222222-2222-2222-2222-222222222222";

function item(threadId: string, title: string, archivedAt: number | null) {
  return {
    id: `item-${threadId}`,
    thread_id: threadId,
    account_id: "acct-1",
    status: "received",
    scope: "work",
    subject: null,
    body: `${title} body`,
    sent_at: Date.now(),
    author_person_id: null,
    author_agent_id: null,
    thread: {
      id: threadId,
      kind: "email",
      title,
      external_id: title,
      meta: {},
      unread_count: 0,
      archived_at: archivedAt,
    },
    author: null,
  };
}

const store: Record<string, unknown[]> = {
  items: [item(THREAD_A, "New mail", null), item(THREAD_B, "Older mail", Date.now() - 86_400_000)],
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
// The leave animation is advanceable in every test that archives something; this is the backstop
// for one that throws before reaching its own vi.useRealTimers().
afterEach(() => vi.useRealTimers());

const renderInbox = () =>
  render(
    <VirtuosoMockContext.Provider value={{ viewportHeight: 600, itemHeight: 72 }}>
      <Inbox />
    </VirtuosoMockContext.Provider>,
  );

const rowNames = (): string[] =>
  screen
    .queryAllByRole("option")
    .map((r) => r.querySelector(".inbox-row__name")?.textContent ?? "");

const archivedPill = () => screen.getByRole("button", { name: "Archived" });
const url = (call: number): string => String(fetchMock.mock.calls[call]?.[0]);

/** US-D04: an archived row is no longer gone on the frame the click lands — it stays in the list
 *  for one leave animation (LEAVE_MS) and then goes. Every assertion after an archive or a restore
 *  therefore has two halves: what the list shows while the row is leaving, and what it shows once
 *  the animation has run out. Driven by the same constant the screen holds the row for, so a change
 *  to the duration cannot leave these tests passing against a stale number. */
const runLeaveAnimation = () => act(() => vi.advanceTimersByTime(LEAVE_MS));

describe("Inbox archive/restore (US-A36)", () => {
  it("hides threads that are already archived and lists them under the Archived pill", () => {
    renderInbox();
    expect(rowNames()).toEqual(["New mail"]);

    fireEvent.click(archivedPill());
    expect(rowNames()).toEqual(["Older mail"]);
    expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument();
  });

  it("archives the selected row with `e` — it collapses out, then shows up in Archived", () => {
    vi.useFakeTimers();
    renderInbox();
    fireEvent.click(screen.getByRole("option", { name: /New mail/ }));
    fireEvent.keyDown(window, { key: "e" });

    // US-D04, first half: the row is still in the list — it has to be, or there is nothing left to
    // animate. What changed on the click is that it is marked as leaving, which is the flag app.css
    // hangs the collapse off and which switches the row's pointer-events off.
    expect(rowNames()).toEqual(["New mail"]);
    expect(screen.getByRole("option", { name: /New mail/ })).toHaveClass("inbox-row--leaving");
    // The server call is not held back behind the animation — it goes out on the click.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(url(0)).toContain(`/api/threads/${THREAD_A}/archive`);

    // Second half: once the animation has run out the row leaves by the ordinary archived rule.
    runLeaveAnimation();
    expect(rowNames()).toEqual([]);

    fireEvent.click(archivedPill());
    expect(rowNames()).toEqual(["New mail", "Older mail"]);
    vi.useRealTimers();
  });

  it("restores it with `u` — back in the Inbox, and the hub gets the unarchive", () => {
    vi.useFakeTimers();
    renderInbox();
    fireEvent.click(screen.getByRole("option", { name: /New mail/ }));
    fireEvent.keyDown(window, { key: "e" });
    runLeaveAnimation();
    fireEvent.click(archivedPill());
    fireEvent.click(screen.getByRole("option", { name: /New mail/ }));
    fireEvent.keyDown(window, { key: "u" });

    // A restore leaves the Archived list by the same route an archive leaves the Inbox — the row is
    // held for one animation there too, which is why the assertion still sees it.
    expect(rowNames()).toEqual(["New mail", "Older mail"]);
    runLeaveAnimation();
    expect(rowNames()).toEqual(["Older mail"]);
    expect(url(1)).toContain(`/api/threads/${THREAD_A}/unarchive`);

    fireEvent.click(archivedPill());
    expect(rowNames()).toEqual(["New mail"]);
    vi.useRealTimers();
  });

  it("the hover action archives the row it belongs to without opening it", () => {
    vi.useFakeTimers();
    const onOpen = vi.fn();
    render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 600, itemHeight: 72 }}>
        <Inbox onOpen={onOpen} />
      </VirtuosoMockContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(onOpen).not.toHaveBeenCalled();
    expect(url(0)).toContain(`/api/threads/${THREAD_A}/archive`);

    runLeaveAnimation();
    expect(rowNames()).toEqual([]);
    vi.useRealTimers();
  });
});

/** loop-r1-06, in S6's vocabulary: the toast slot, in miniature. The screen raises a request and the
 *  host draws it — that is the whole contract — so the two have to be rendered together for
 *  "Archived · Undo" to be something a test can click. The host is the app's own (`@omnis/ui`'s
 *  `Toaster`, mounted once in main.tsx), and what this miniature keeps is App.tsx's `notify` at the
 *  size this file needs: one slot, and the work a toast was handed runs when the toast goes. The
 *  rest of the shell's — cancelling that work when the action is taken, and running it when a newer
 *  toast replaces this one — is the shell's own subject, covered in app-shell.test.tsx where the
 *  real one runs. */
function Harness() {
  const held = useRef<(() => void) | null>(null);
  const runHeld = () => {
    const outgoing = held.current;
    held.current = null;
    outgoing?.();
  };
  const notify = (spec: ToastRequest, deferred?: { run: () => void }) => {
    runHeld();
    held.current = deferred?.run ?? null;
    const action = spec.action;
    raiseToast(spec.message, {
      // The shell's one slot, by the same id: a second archive updates the toast rather than
      // stacking a second one, exactly as `notify` does in App.tsx.
      id: TOAST_SLOT_ID,
      duration: TOAST_MS,
      action:
        action === undefined
          ? undefined
          : {
              label: action.label,
              onClick: (event: ReactMouseEvent<HTMLButtonElement>) => {
                event.preventDefault();
                held.current = null;
                action.onAction();
              },
            },
      onDismiss: runHeld,
      onAutoClose: runHeld,
    });
  };
  return (
    <VirtuosoMockContext.Provider value={{ viewportHeight: 600, itemHeight: 72 }}>
      <Inbox notify={notify} />
      <Toaster />
    </VirtuosoMockContext.Provider>
  );
}

/** App.tsx's slot id. Repeated rather than exported: what is under test is that this file's own
 *  harness and the shell agree about "one toast", and sharing the constant would hide a drift. */
const TOAST_SLOT_ID = "omnis-toast-slot";

describe("Inbox archive toasts (loop-r1-06)", () => {
  /** The toast on screen. sonner renders no `role="status"` (its list is the live region and the
   *  toast inside it carries no role), so the element app.css styles is the handle. The zero-length
   *  advance is sonner's batching, not one of this file's timings: it publishes through its store on
   *  a zero-delay timer, so under these fake timers the element is one tick behind the raise. */
  const toast = () => {
    act(() => vi.advanceTimersByTime(0));
    const el = document.querySelector("[data-sonner-toast]");
    if (el === null) throw new Error("no toast on screen");
    return el;
  };

  /** Archive the first row with `e`, the way the triage keys do. "New mail" is the only thread in
   *  the inbox — "Older mail" is the archived one this file starts from. */
  const archiveWithE = () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("option", { name: /New mail/ }));
    fireEvent.keyDown(window, { key: "e" });
  };

  /** The row is in the inbox and has finished leaving — the state an undone archive leaves behind.
   *  Without the undo it is out of this list entirely, so `getByRole` would throw. */
  const expectingBack = () => {
    runLeaveAnimation();
    expect(screen.getByRole("option", { name: /New mail/ })).not.toHaveClass("inbox-row--leaving");
  };

  it("says what it did and offers the Undo, which really puts the thread back", () => {
    vi.useFakeTimers();
    archiveWithE();

    expect(toast()).toHaveTextContent("Archived");
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    // The reverse write, for the row the toast named — not for whatever is selected by then.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(url(1)).toContain(`/api/threads/${THREAD_A}/unarchive`);
    expectingBack();
    vi.useRealTimers();
  });

  it("undoes with `z` — the keyboard twin of that button", () => {
    vi.useFakeTimers();
    archiveWithE();
    expect(toast()).toHaveTextContent("Archived");

    fireEvent.keyDown(window, { key: "z" });
    expect(url(1)).toContain(`/api/threads/${THREAD_A}/unarchive`);
    expectingBack();
    vi.useRealTimers();
  });

  it("undoes with ⌘Z too, and stops once the toast has gone", () => {
    vi.useFakeTimers();
    archiveWithE();
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    expect(url(1)).toContain(`/api/threads/${THREAD_A}/unarchive`);

    // The undo is the toast's, not the screen's: five seconds after the archive there is no button
    // on screen, so ⌘Z has nothing left to take back. (The Ctrl variant is the same branch — the
    // listener takes either modifier.)
    act(() => vi.advanceTimersByTime(TOAST_MS));
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("says a failed archive failed, and offers the Retry", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as unknown as Response);
    archiveWithE();
    await act(async () => {});

    expect(toast()).toHaveTextContent("Couldn't archive. It's back in your inbox.");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    // The rollback is what makes the sentence true: the row is in the inbox, un-animated.
    expectingBack();
    vi.useRealTimers();
  });
});

describe("Inbox archive leave honours prefers-reduced-motion (US-D04)", () => {
  const REAL_MATCH_MEDIA = window.matchMedia;
  afterEach(() => {
    window.matchMedia = REAL_MATCH_MEDIA;
  });

  /** jsdom's window.matchMedia always reports matches:false, so the reduced branch is only
   *  reachable against a stub — the same limitation channel-rail.test.tsx works around. The screen
   *  reads window.matchMedia, not globalThis's. */
  const stubReducedMotion = () => {
    window.matchMedia = ((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
  };

  it("holds a leaving row for the reduced fade, not for the full leave duration", () => {
    stubReducedMotion();
    vi.useFakeTimers();
    renderInbox();
    fireEvent.click(screen.getByRole("option", { name: /New mail/ }));
    fireEvent.keyDown(window, { key: "e" });

    // The row is still held and still marked — reduced motion shortens the exit, it does not skip
    // it. (This is the assertion that would catch a regression to the old `--dur-*: 0ms` behaviour:
    // at zero the row would already be gone on this line.)
    expect(screen.getByRole("option", { name: /New mail/ })).toHaveClass("inbox-row--leaving");

    // Gone one reduced fade later. At the same instant a full-motion user still has the row (the
    // suite above asserts presence and then advances LEAVE_MS), so this is the reduced path and not
    // an accidental instant removal.
    act(() => vi.advanceTimersByTime(REDUCED_FADE_MS));
    expect(rowNames()).toEqual([]);
    vi.useRealTimers();
  });
});
