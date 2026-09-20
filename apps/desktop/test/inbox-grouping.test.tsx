// @vitest-environment jsdom
// US-D02: Needs-approval 뷰는 승인 라이프사이클(pending/approved/rejected/expired)별로,
// Agents 뷰는 세션 상태(blocked → working → idle → done → failed)별로 그룹 헤더를 단다.
// archive-inbox.test.tsx의 테이블 태깅 목을 그대로 쓴다 — Inbox는 쿼리마다 다른 행이 필요하다.
import "./setup";

import { fireEvent, render, screen } from "@testing-library/react";
import { VirtuosoMockContext } from "react-virtuoso";
import { describe, expect, it, vi } from "vitest";

const THREADS = {
  pending: "11111111-1111-1111-1111-111111111111",
  approved: "22222222-2222-2222-2222-222222222222",
  expired: "33333333-3333-3333-3333-333333333333",
  rejected: "44444444-4444-4444-4444-444444444444",
  blocked: "55555555-5555-5555-5555-555555555555",
  working: "66666666-6666-6666-6666-666666666666",
  agentEmail: "77777777-7777-7777-7777-777777777777",
} as const;

/** 기본은 사람 스레드(kind='email'). agent_session만 세션 상태로 묶인다. */
function item(threadId: string, title: string, over: Record<string, unknown> = {}) {
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
    ...over,
  };
}

function agentItem(threadId: string, title: string) {
  return item(threadId, title, {
    thread: {
      id: threadId,
      kind: "agent_session",
      title,
      external_id: title,
      meta: {},
      unread_count: 0,
      archived_at: null,
    },
  });
}

const store: Record<string, unknown[]> = {
  items: [
    item(THREADS.pending, "대기 건"),
    item(THREADS.approved, "승인 건"),
    item(THREADS.expired, "만료 건"),
    item(THREADS.rejected, "거절 건"),
    agentItem(THREADS.blocked, "막힌 세션"),
    agentItem(THREADS.working, "도는 세션"),
    // agent가 보낸 행이지만 agent_session은 아니다 — 묶을 세션 상태가 없다(ungrouped 버킷).
    item(THREADS.agentEmail, "에이전트 메일", { author_agent_id: "agent-1" }),
  ],
  accounts: [{ id: "acct-1", channel: "gmail" }],
  // A3 라이프사이클: 대기 / 실행 완료(accept) / 만료 / 실행 실패(→표시상 거절).
  pending_approvals: [
    { id: "ap-1", thread_id: THREADS.pending, state: "pending", decision: null, created_at: 1 },
    {
      id: "ap-2",
      thread_id: THREADS.approved,
      state: "executed",
      decision: "accept",
      created_at: 2,
    },
    { id: "ap-3", thread_id: THREADS.expired, state: "expired", decision: null, created_at: 3 },
    { id: "ap-4", thread_id: THREADS.rejected, state: "failed", decision: null, created_at: 4 },
  ],
  labels: [],
  thread_labels: [],
  agent_sessions: [
    {
      id: "as-1",
      thread_id: THREADS.blocked,
      session_key: "k1",
      state: "waiting_approval",
      started_at: 1,
      runtime_id: "rt-1",
    },
    {
      id: "as-2",
      thread_id: THREADS.working,
      session_key: "k2",
      state: "running",
      started_at: 2,
      runtime_id: "rt-1",
    },
  ],
  agent_runtimes: [{ id: "rt-1", runtime: "claude_code" }],
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

vi.stubGlobal(
  "fetch",
  vi.fn(async () => ({ ok: true, json: async () => ({}) })),
);

const renderInbox = () =>
  render(
    <VirtuosoMockContext.Provider value={{ viewportHeight: 800, itemHeight: 72 }}>
      <Inbox />
    </VirtuosoMockContext.Provider>,
  );

/** 헤더 pill의 라벨만 뽑는다. StatusPill은 [점][라벨][카운트] 순으로 그려서 textContent가
 * "대기4"가 된다 — 카운트를 붙여 놓고 순서를 단언하면 테스트가 문자열 파싱이 된다. */
const pillLabel = (pill: Element): string =>
  [...pill.childNodes]
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.textContent ?? "")
    .join("");

/** 그룹 헤더가 DOM에 놓인 순서 = 화면에 보이는 순서. */
const headerLabels = (container: HTMLElement): string[] =>
  [...container.querySelectorAll(".group-header .status-pill")].map(pillLabel);

const headerCounts = (container: HTMLElement): string[] =>
  [...container.querySelectorAll(".group-header .status-pill__count")].map(
    (el) => el.textContent ?? "",
  );

const filterBy = (name: string) => fireEvent.click(screen.getByRole("radio", { name }));

describe("Inbox 그룹 헤더 (US-D02)", () => {
  it("needs-approval 뷰를 대기 → 승인됨 → 거절됨 → 만료 순서로 묶는다", () => {
    const { container } = renderInbox();
    filterBy("needs-approval");

    expect(headerLabels(container)).toEqual(["대기", "승인됨", "거절됨", "만료"]);
    expect(headerCounts(container)).toEqual(["1", "1", "1", "1"]);
  });

  // 이 슬라이스의 의도된 동작 변경: 예전엔 지금 대기 중인 건만 이 탭에 떴다. 이제 결정·만료된
  // 건도 남는다 — 그래야 상태별 그룹이 여러 개 뜬다. 대기만 있던 스레드는 예전과 똑같이 뜬다.
  it("needs-approval 뷰는 결정·만료된 건도 함께 보여준다", () => {
    renderInbox();
    filterBy("needs-approval");
    expect(screen.getAllByRole("option")).toHaveLength(4);
  });

  it("agents 뷰는 확인 필요(blocked)를 작업 중(working)보다 위에 둔다", () => {
    const { container } = renderInbox();
    filterBy("agents");

    expect(headerLabels(container)).toEqual(["확인 필요", "작업 중"]);
    expect(headerCounts(container)).toEqual(["1", "1"]);
  });

  it("세션 상태가 없는 agent 행은 헤더 없이 마지막에 남는다", () => {
    const { container } = renderInbox();
    filterBy("agents");

    // 헤더는 2개뿐 — ungrouped 행에는 상태 라벨을 붙일 수 없다.
    expect(container.querySelectorAll(".group-header")).toHaveLength(2);
    const names = screen
      .getAllByRole("option")
      .map((r) => r.querySelector(".inbox-row__name")?.textContent ?? "");
    expect(names).toEqual(["막힌 세션", "도는 세션", "에이전트 메일"]);
  });

  // 나머지 필터와 Archived는 평평해야 한다 — 그룹핑이 그쪽으로 새면 회귀다.
  it("all/work/personal과 보관됨 뷰에는 그룹 헤더가 없다", () => {
    const { container } = renderInbox();
    expect(container.querySelectorAll(".group-header")).toHaveLength(0);

    for (const name of ["work", "personal"]) {
      filterBy(name);
      expect(container.querySelectorAll(".group-header")).toHaveLength(0);
    }

    filterBy("needs-approval");
    expect(container.querySelectorAll(".group-header")).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "보관됨" }));
    expect(container.querySelectorAll(".group-header")).toHaveLength(0);
  });
});
