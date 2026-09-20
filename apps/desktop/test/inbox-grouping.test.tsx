// @vitest-environment jsdom
// US-D02: Agents 뷰만 그룹 헤더를 쓴다(blocked → working → idle → done → failed). Needs-approval은
// pending만 쿼리해서 그룹이 언제나 하나뿐이라 헤더 대신 탭 pill의 숫자로 센다.
// archive-inbox.test.tsx의 테이블 태깅 목을 그대로 쓴다 — Inbox는 쿼리마다 다른 행이 필요하다.
import "./setup";

import { fireEvent, render, screen } from "@testing-library/react";
import { VirtuosoMockContext } from "react-virtuoso";
import { describe, expect, it, vi } from "vitest";

const THREADS = {
  pending: "11111111-1111-1111-1111-111111111111",
  decided: "22222222-2222-2222-2222-222222222222",
  pending2: "88888888-8888-8888-8888-888888888888",
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
    item(THREADS.decided, "결정된 건"),
    item(THREADS.pending2, "대기 건 2"),
    agentItem(THREADS.blocked, "막힌 세션"),
    agentItem(THREADS.working, "도는 세션"),
    // agent가 보낸 행이지만 agent_session은 아니다 — 묶을 세션 상태가 없다(ungrouped 버킷).
    item(THREADS.agentEmail, "에이전트 메일", { author_agent_id: "agent-1" }),
  ],
  accounts: [{ id: "acct-1", channel: "gmail" }],
  // 대기 2건 + 이미 실행된 1건. 실행된 건은 Inbox의 `.where("state","=","pending")`이 걸러 내고,
  // 아래 목이 그 where를 실제로 적용한다 — 그래야 이 픽스처가 프로덕션과 같은 행을 먹인다.
  pending_approvals: [
    { id: "ap-1", thread_id: THREADS.pending, state: "pending", decision: null, created_at: 1 },
    { id: "ap-5", thread_id: THREADS.pending2, state: "pending", decision: null, created_at: 5 },
    {
      id: "ap-2",
      thread_id: THREADS.decided,
      state: "executed",
      decision: "accept",
      created_at: 2,
    },
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

/** zero.query.<table>....(체인) → 태그 + 누적된 where 절.
 *  where를 버리는 목은 프로덕션 쿼리가 절대 만들 수 없는 행을 화면에 먹일 수 있다(2회차에
 *  실제로 그랬다: 승인 라이프사이클 전체를 넣고 그룹이 여럿 나온다고 단언했다). `=` 하나만
 *  해석한다 — Inbox가 쓰는 연산자가 그것뿐이고, 모르는 연산자는 던져서 조용히 새지 않게 한다. */
type Where = [string, string, unknown];
function taggedQuery(table: string, wheres: Where[] = []): unknown {
  const proxy: unknown = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === "__table") return table;
        if (prop === "__wheres") return wheres;
        if (prop === "where")
          return (field: string, op: string, value: unknown) =>
            taggedQuery(table, [...wheres, [field, op, value]]);
        return () => proxy;
      },
    },
  );
  return proxy;
}
const zero = { query: new Proxy({}, { get: (_t, table) => taggedQuery(String(table)) }) };

function runQuery(q: { __table: string; __wheres: Where[] }): unknown[] {
  const rows = store[q.__table] ?? [];
  return rows.filter((row) =>
    q.__wheres.every(([field, op, value]) => {
      if (op !== "=" && op !== "!=") throw new Error(`목이 모르는 연산자: ${op}`);
      const actual = (row as Record<string, unknown>)[field];
      return op === "=" ? actual === value : actual !== value;
    }),
  );
}

vi.mock("../src/zero-client.js", () => ({
  initZero: () => zero,
  useZeroClient: () => zero,
  loadZeroToken: async () => {},
}));
vi.mock("@rocicorp/zero/react", () => ({
  useQuery: (q: { __table: string; __wheres: Where[] }) => [runQuery(q), { type: "complete" }],
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

/** 그룹 헤더가 DOM에 놓인 순서 = 화면에 보이는 순서. */
const headerLabels = (container: HTMLElement): string[] =>
  [...container.querySelectorAll(".group-header .status-pill")].map((el) => el.textContent ?? "");

/** 카운트는 pill 밖 별도 칩이다(레퍼런스 문법). */
const headerCounts = (container: HTMLElement): string[] =>
  [...container.querySelectorAll(".group-header__count")].map((el) => el.textContent ?? "");

const rowNames = (): string[] =>
  screen.getAllByRole("option").map((r) => r.querySelector(".inbox-row__name")?.textContent ?? "");

// needs-approval pill의 접근 이름에는 카운트가 붙는다("needs-approval 2") — 앞부분으로 찾는다.
const filterTab = (name: string) =>
  screen.getByRole("radio", { name: (n: string) => n.startsWith(name) });
const filterBy = (name: string) => fireEvent.click(filterTab(name));

describe("Inbox 그룹 헤더 (US-D02)", () => {
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
    expect(rowNames()).toEqual(["막힌 세션", "도는 세션", "에이전트 메일"]);
  });

  // 헤더가 바로 위에서 상태를 말하는데 행이 같은 말을 되풀이하면 화면이 "확인 필요 / 확인 필요"로
  // 읽힌다(2회차 거절 사유). 그렇다고 그 슬롯을 채널 글리프로 메우면 런타임 세션 행이
  // "Slack 메시지"라고 주장하게 된다(3회차 거절 사유) — 세션 행의 우측 슬롯은 비운다.
  it("그룹일 때 행은 상태 배지를 반복하지도, 채널 글리프로 바꿔 달지도 않는다", () => {
    const { container } = renderInbox();
    filterBy("agents");
    expect(container.querySelectorAll(".status-badge--agent")).toHaveLength(0);
    // 세션 2행은 빈 슬롯, 세션이 아닌 "에이전트 메일" 1행만 채널 글리프를 갖는다.
    expect(container.querySelectorAll(".inbox-row__channel-icon")).toHaveLength(1);
    expect(screen.queryByLabelText("Gmail message")).toBeInTheDocument();
  });

  it("그룹이 없는 뷰에서는 행이 상태 배지를 그대로 보여준다", () => {
    const { container } = renderInbox();
    filterBy("all");
    expect(container.querySelectorAll(".status-badge--agent")).toHaveLength(2);
  });

  // needs-approval은 pending만 쿼리해 그룹이 언제나 하나다 — 헤더 띠는 방금 고른 탭 이름을
  // 되풀이할 뿐이라, 숫자만 탭 pill로 접었다.
  it("needs-approval은 헤더 대신 탭 pill에 대기 건수를 단다", () => {
    const { container } = renderInbox();
    expect(filterTab("needs-approval")).toHaveTextContent("2");

    filterBy("needs-approval");
    expect(container.querySelectorAll(".group-header")).toHaveLength(0);
    expect(rowNames()).toEqual(["대기 건", "대기 건 2"]);
  });

  // needs-approval 탭에서는 모든 행이 Pending approval이라 행마다 붙는 점이 아무것도 구분하지 못한다.
  // 다른 탭에서는 "이 행만 내 결정을 기다린다"는 뜻이 살아 있으므로 그대로 둔다.
  it("needs-approval에서는 행의 Pending approval 점을 숨기고, 다른 탭에서는 보여준다", () => {
    const { container } = renderInbox();
    filterBy("all");
    expect(container.querySelectorAll(".inbox-row__approval-dot").length).toBeGreaterThan(0);

    filterBy("needs-approval");
    expect(container.querySelectorAll(".inbox-row__approval-dot")).toHaveLength(0);
  });

  // 나머지 필터와 Archived는 평평해야 한다 — 그룹핑이 그쪽으로 새면 회귀다.
  it("all/work/personal과 Archived 뷰에는 그룹 헤더가 없다", () => {
    const { container } = renderInbox();
    expect(container.querySelectorAll(".group-header")).toHaveLength(0);

    for (const name of ["work", "personal"]) {
      filterBy(name);
      expect(container.querySelectorAll(".group-header")).toHaveLength(0);
    }

    filterBy("agents");
    expect(container.querySelectorAll(".group-header")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    expect(container.querySelectorAll(".group-header")).toHaveLength(0);
  });
});
