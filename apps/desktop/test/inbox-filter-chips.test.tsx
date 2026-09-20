// @vitest-environment jsdom
// US-D02: 인박스 헤더 아래 라벨 필터 칩 바 — 팝오버에서 라벨 2개를 고르면 칩이 생기고 리스트가
// 그 라벨을 단 스레드만 남기며, 칩의 ×가 필터를 되돌린다.
// archive-inbox.test.tsx의 테이블 태깅 목을 그대로 쓴다(Inbox는 쿼리마다 다른 행이 필요하다).
import "./setup";

import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { VirtuosoMockContext } from "react-virtuoso";
import { describe, expect, it, vi } from "vitest";

const THREADS = {
  none: "11111111-1111-1111-1111-111111111111",
  integration: "22222222-2222-2222-2222-222222222222",
  billing: "33333333-3333-3333-3333-333333333333",
  both: "44444444-4444-4444-4444-444444444444",
} as const;

function item(threadId: string, title: string) {
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
      archived_at: null,
    },
    author: null,
  };
}

const store: Record<string, unknown[]> = {
  items: [
    item(THREADS.none, "라벨 없음"),
    item(THREADS.integration, "통합 건"),
    item(THREADS.billing, "청구 건"),
    item(THREADS.both, "둘 다 건"),
  ],
  accounts: [{ id: "acct-1", channel: "gmail" }],
  pending_approvals: [],
  labels: [
    { id: "l1", name: "Integrations", kind: "topic", color: null },
    { id: "l2", name: "Billing", kind: "topic", color: null },
  ],
  thread_labels: [
    { id: "tl-1", thread_id: THREADS.integration, label_id: "l1" },
    { id: "tl-2", thread_id: THREADS.billing, label_id: "l2" },
    { id: "tl-3", thread_id: THREADS.both, label_id: "l1" },
    { id: "tl-4", thread_id: THREADS.both, label_id: "l2" },
  ],
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

// 칩 팝오버가 여는 cmdk 목록은 마운트할 때 선택 항목을 scrollIntoView로 끌어온다.
// packages/ui/test/setup.ts는 이 구멍을 이미 메우지만 apps/desktop/test/setup.ts는 안 한다
// (그쪽에선 지금까지 cmdk를 렌더한 테스트가 없었다) — 여기서만 메운다.
if (typeof Element.prototype.scrollIntoView === "undefined") {
  Element.prototype.scrollIntoView = () => {};
}

const { Inbox } = await import("../src/screens/Inbox");

vi.stubGlobal(
  "fetch",
  vi.fn(async () => ({ ok: true, json: async () => ({}) })),
);

const renderInbox = (props: ComponentProps<typeof Inbox> = {}) =>
  render(
    <VirtuosoMockContext.Provider value={{ viewportHeight: 800, itemHeight: 72 }}>
      <Inbox {...props} />
    </VirtuosoMockContext.Provider>,
  );

/** 행 이름만 클래스로 긁는다 — 팝오버가 열려 있으면 cmdk의 항목들도 role="option"이라
 *  role 기반 쿼리는 리스트 행과 섞인다. */
const rowNames = (): string[] =>
  [...document.querySelectorAll(".inbox-row__name")].map((el) => el.textContent ?? "");

/** 칩은 필드 칸 + 값 칸이다(레퍼런스의 필터 DSL) — 한 덩어리 문자열로 읽지 않는다. */
const chipCells = (): (string | null | undefined)[][] =>
  [...document.querySelectorAll(".filter-chip")].map((chip) => [
    chip.querySelector(".filter-chip__field")?.textContent,
    chip.querySelector(".filter-chip__value")?.textContent,
  ]);

const addTrigger = () => screen.getByRole("button", { name: "Add Label filter" });
const optionIn = (label: string) => within(screen.getByRole("dialog")).getByText(label);

describe("Inbox label filter chips (US-D02)", () => {
  it("고른 라벨을 단 스레드만 남기고, 칩의 ×가 전체 목록을 되돌린다", () => {
    renderInbox();
    expect(rowNames()).toEqual(["라벨 없음", "통합 건", "청구 건", "둘 다 건"]);

    fireEvent.click(addTrigger());
    fireEvent.click(optionIn("Integrations"));
    expect(rowNames()).toEqual(["통합 건", "둘 다 건"]);
    // 다중 선택 — 첫 클릭 뒤에도 목록이 살아 있어야 두 번째를 고를 수 있다.
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(optionIn("Billing"));
    expect(rowNames()).toEqual(["통합 건", "청구 건", "둘 다 건"]);

    fireEvent.click(screen.getByRole("button", { name: "Remove Label filter" }));
    expect(rowNames()).toEqual(["라벨 없음", "통합 건", "청구 건", "둘 다 건"]);
  });

  // 칩 문구는 이 화면의 나머지(Archived/Pending approval/…)와 같은 언어다 — 영어 필터 DSL
  // ("Label is any of 2 labels")을 그대로 옮기면 한 칩 안에 두 언어가 섞인다.
  // 레퍼런스도 값이 하나면 수량사를 접는다("Channel is Slack") — "one of 1"은 사람이
  // 쓰지 않는 말이라 1개일 때는 채널 칩과 같이 이름만 값 칸에 남는다.
  it("라벨이 하나면 이름을, 둘 이상이면 개수를 값 칸에 말한다", () => {
    renderInbox();
    fireEvent.click(addTrigger());
    expect(document.querySelector(".filter-chip")).toBeNull();

    fireEvent.click(optionIn("Integrations"));
    expect(chipCells()).toEqual([["Label", "Integrations"]]);
    fireEvent.click(optionIn("Billing"));
    expect(chipCells()).toEqual([["Label", "one of 2"]]);
  });

  it("워크스페이스에 라벨이 하나도 없으면 빈 바를 그리지 않는다", () => {
    const saved = store.labels;
    store.labels = [];
    try {
      const { container } = renderInbox();
      expect(container.querySelector(".filter-chip-bar")).toBeNull();
    } finally {
      store.labels = saved;
    }
  });
});

describe("Inbox channel filter chips (US-D02)", () => {
  // 채널 칩의 ×는 셸(App.tsx)이 소유한 레일 선택을 되돌린다 — 레일 상태가 여기 없으므로
  // 콜백이 없으면 칩도 그리지 않는다(아무 일도 안 하는 ×는 없는 것만 못하다).
  it("channelFilter + 콜백이 있으면 칩을 그리고 ×가 null을 돌려준다", () => {
    const onChannelFilterChange = vi.fn();
    renderInbox({ channelFilter: "gmail", onChannelFilterChange });

    expect(chipCells()).toEqual([["Channel", "Gmail"]]);
    fireEvent.click(screen.getByRole("button", { name: "Remove Channel filter" }));
    expect(onChannelFilterChange).toHaveBeenCalledWith(null);
  });

  it("콜백이 없으면 channelFilter가 걸려 있어도 칩을 그리지 않는다", () => {
    renderInbox({ channelFilter: "gmail" });
    expect(document.querySelector(".filter-chip")).toBeNull();
  });
});
