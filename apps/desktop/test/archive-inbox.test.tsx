// @vitest-environment jsdom
// US-A36: 행 보관 → Inbox에서 사라지고 "보관됨" 뷰에 뜬다 → 되살리면 돌아온다.
// app-shell.test.tsx의 프록시 목은 모든 쿼리에 같은 값을 주므로 여기서는 테이블 이름을 붙여
// 테이블별로 다른 행을 주는 목을 쓴다(Inbox는 7개 쿼리를 건다).
import "./setup";

import { fireEvent, render, screen } from "@testing-library/react";
import { VirtuosoMockContext } from "react-virtuoso";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    body: `${title} 본문`,
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
  items: [item(THREAD_A, "새 메일", null), item(THREAD_B, "묵은 메일", Date.now() - 86_400_000)],
  accounts: [{ id: "acct-1", channel: "gmail" }],
  pending_approvals: [],
  labels: [],
  thread_labels: [],
  agent_sessions: [],
  agent_runtimes: [],
};

/** zero.query.<table>....(체인) → { __table }. 체인 메서드는 전부 자기 자신을 돌려준다. */
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

const archivedPill = () => screen.getByRole("button", { name: "보관됨" });
const url = (call: number): string => String(fetchMock.mock.calls[call]?.[0]);

describe("Inbox 보관/되살리기 (US-A36)", () => {
  it("hides threads that are already archived and lists them under the 보관됨 pill", () => {
    renderInbox();
    expect(rowNames()).toEqual(["새 메일"]);

    fireEvent.click(archivedPill());
    expect(rowNames()).toEqual(["묵은 메일"]);
    expect(screen.getByRole("button", { name: "되살리기" })).toBeInTheDocument();
  });

  it("archives the selected row with `e` — it leaves the list at once and shows up in 보관됨", async () => {
    renderInbox();
    fireEvent.click(screen.getByRole("option", { name: /새 메일/ }));
    fireEvent.keyDown(window, { key: "e" });

    expect(rowNames()).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(url(0)).toContain(`/api/threads/${THREAD_A}/archive`);

    fireEvent.click(archivedPill());
    expect(rowNames()).toEqual(["새 메일", "묵은 메일"]);
  });

  it("restores it with `u` — back in the Inbox, and the hub gets the unarchive", () => {
    renderInbox();
    fireEvent.click(screen.getByRole("option", { name: /새 메일/ }));
    fireEvent.keyDown(window, { key: "e" });
    fireEvent.click(archivedPill());
    fireEvent.click(screen.getByRole("option", { name: /새 메일/ }));
    fireEvent.keyDown(window, { key: "u" });

    expect(rowNames()).toEqual(["묵은 메일"]);
    expect(url(1)).toContain(`/api/threads/${THREAD_A}/unarchive`);
    fireEvent.click(archivedPill());
    expect(rowNames()).toEqual(["새 메일"]);
  });

  it("the hover action archives the row it belongs to without opening it", () => {
    const onOpen = vi.fn();
    render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 600, itemHeight: 72 }}>
        <Inbox onOpen={onOpen} />
      </VirtuosoMockContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "보관" }));
    expect(onOpen).not.toHaveBeenCalled();
    expect(url(0)).toContain(`/api/threads/${THREAD_A}/archive`);
    expect(rowNames()).toEqual([]);
  });
});
