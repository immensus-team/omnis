// @vitest-environment jsdom
// US-D09 §c.6/§c.8: the Filters sheet and the bulk archive's prompt, driven through Inbox — the
// screen that owns both the filter state the rows edit and the archive write the prompt guards.
// The components' own contracts are packages/ui/test/{sheet,confirm-prompt}.test.tsx; what is only
// true here is the wiring: the rows are the *same* state the pill strip reads, and the question
// names the count of what is on screen.
//
// archive-inbox.test.tsx's table-tagged store is reused rather than invented — Inbox runs eight
// queries and app-shell.test.tsx's single-value proxy would answer them all the same.
import "./setup";

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { VirtuosoMockContext } from "react-virtuoso";
import { beforeEach, describe, expect, it, vi } from "vitest";

function item(threadId: string, title: string, scope: string) {
  return {
    id: `item-${threadId}`,
    thread_id: threadId,
    account_id: "acct-1",
    status: "received",
    scope,
    subject: null,
    body: `${title} body`,
    sent_at: Date.now() - Number(threadId.slice(-1)) * 1000,
    author_person_id: null,
    author_agent_id: null,
    thread: {
      id: threadId,
      kind: "email",
      title,
      external_id: title,
      meta: {},
      unread_count: 0,
      archived_at: null,
    },
    author: null,
  };
}

/** Three threads on screen — the acceptance shot's "Archive 3 threads?" is this count. */
const store: Record<string, unknown[]> = {
  items: [
    item("t1", "First mail", "work"),
    item("t2", "Second mail", "work"),
    item("t3", "Third mail", "personal"),
  ],
  accounts: [{ id: "acct-1", channel: "gmail" }],
  pending_approvals: [],
  labels: [
    { id: "label-1", kind: "scope", name: "Receipts", color: null },
    { id: "label-2", kind: "scope", name: "Travel", color: null },
  ],
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

const onFiltersOpenChange = vi.fn();
const renderInbox = (filtersOpen: boolean) =>
  render(
    <VirtuosoMockContext.Provider value={{ viewportHeight: 600, itemHeight: 72 }}>
      <Inbox filtersOpen={filtersOpen} onFiltersOpenChange={onFiltersOpenChange} />
    </VirtuosoMockContext.Provider>,
  );

const rowNames = (): string[] =>
  screen
    .queryAllByRole("option")
    .map((r) => r.querySelector(".inbox-row__name")?.textContent ?? "");
const sheet = () => screen.getByRole("dialog", { name: "Filters" });
const archivedUrls = (): string[] =>
  fetchMock.mock.calls.map((call) => String(call[0])).filter((url) => url.includes("archive"));

describe("Inbox filters sheet (US-D09 §c.6)", () => {
  it("is closed until the shell opens it, and edits the same state the strip reads", () => {
    const { rerender } = render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 600, itemHeight: 72 }}>
        <Inbox filtersOpen={false} onFiltersOpenChange={onFiltersOpenChange} />
      </VirtuosoMockContext.Provider>,
    );
    expect(screen.queryByRole("dialog", { name: "Filters" })).not.toBeInTheDocument();
    expect(rowNames()).toHaveLength(3);

    // Pressing a row in the sheet is a filter change, not a copy of one: the list behind it has to
    // be filtered by the same state the strip's pills carry, or the sheet is a second source of
    // truth dressed as a menu.
    rerender(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 600, itemHeight: 72 }}>
        <Inbox filtersOpen onFiltersOpenChange={onFiltersOpenChange} />
      </VirtuosoMockContext.Provider>,
    );
    const show = within(sheet()).getByText("Show").parentElement;
    expect(show).not.toBeNull();
    fireEvent.click(within(show as HTMLElement).getByRole("radio", { name: "Work" }));

    expect(rowNames()).toEqual(["First mail", "Second mail"]);
    // And the strip agrees, so the sheet and the pills are one selection rather than two. Scoped to
    // the strip because the sheet's own Work row is the second element carrying that name.
    const pills = document.querySelector(".inbox-card__pills");
    expect(pills).not.toBeNull();
    expect(within(pills as HTMLElement).getByRole("radio", { name: "Work" })).toBeChecked();
  });

  it("carries the Archived view and the label filter as checkboxes, not as more radio pills", () => {
    renderInbox(true);

    // The five views are mutually exclusive by construction; Archived and the labels are toggles.
    expect(within(sheet()).getAllByRole("radio")).toHaveLength(5);
    const archived = within(sheet()).getByRole("checkbox", { name: "Archived threads" });
    expect(within(sheet()).getAllByRole("checkbox")).toHaveLength(3);

    fireEvent.click(archived);
    expect(archived).toBeChecked();
    // Nothing is archived in this store, so the archived view is the empty list — the point is that
    // the row reached the view state at all.
    expect(rowNames()).toEqual([]);

    fireEvent.click(within(sheet()).getByRole("checkbox", { name: "Receipts" }));
    expect(within(sheet()).getByRole("checkbox", { name: "Receipts" })).toBeChecked();
  });
});

describe("Inbox bulk archive (US-D09 §c.8)", () => {
  it("asks with the count before archiving what is shown", async () => {
    renderInbox(true);
    fireEvent.click(within(sheet()).getByText("Archive all 3 shown"));

    // The question is the title and it names the number — §c.8's whole point. `alertdialog` because
    // this one interrupts: it is waiting on a decision before it does anything.
    const prompt = screen.getByRole("alertdialog", { name: "Archive 3 threads?" });
    expect(prompt).toBeInTheDocument();
    expect(archivedUrls()).toEqual([]);

    // Scoped to the prompt: the rows behind it carry their own Archive controls.
    fireEvent.click(within(prompt).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(archivedUrls()).toHaveLength(3));
    // One write per thread, and the prompt is gone afterwards.
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("cancels without writing anything", () => {
    renderInbox(true);
    fireEvent.click(within(sheet()).getByText("Archive all 3 shown"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(archivedUrls()).toEqual([]);
  });

  it("does not offer the bulk action on the archived view or over an empty list", () => {
    renderInbox(true);
    fireEvent.click(within(sheet()).getByRole("checkbox", { name: "Archived threads" }));

    // Archiving from Archived is the other verb, and with nothing on screen there is nothing for
    // "Archive 0 threads?" to act on — so the row is not drawn at all.
    expect(within(sheet()).queryByText(/Archive all/)).not.toBeInTheDocument();
  });
});
