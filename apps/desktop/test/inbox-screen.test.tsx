import { describe, expect, it } from "vitest";
import {
  type InboxFilter,
  type InboxQueryItem,
  type SortableInboxRow,
  approvalPillState,
  filterInboxItems,
  groupByAgentState,
  groupByApprovalState,
  inboxRowTitle,
  sortInboxRows,
  threadSummary,
} from "../src/screens/Inbox";

const items: InboxQueryItem[] = [
  { id: "1", scope: "work", hasPendingApproval: false, approvalState: null, authorKind: "person" },
  {
    id: "2",
    scope: "personal",
    hasPendingApproval: true,
    approvalState: "pending",
    authorKind: "person",
  },
  { id: "3", scope: "work", hasPendingApproval: false, approvalState: null, authorKind: "agent" },
];

describe("filterInboxItems (A5 §2.1 필터 pill 5개, 서로 배타)", () => {
  const cases: [InboxFilter, string[]][] = [
    ["all", ["1", "2", "3"]],
    ["work", ["1", "3"]],
    ["personal", ["2"]],
    ["agents", ["3"]],
    ["needs-approval", ["2"]],
  ];
  it.each(cases)("filter=%s → ids %j", (filter, expectedIds) => {
    expect(filterInboxItems(items, filter).map((i) => i.id)).toEqual(expectedIds);
  });

  // needs-approval은 내 액션 큐다 — 결정·만료된 건까지 남기면 탭이 영원히 비워지지 않는다.
  it("needs-approval은 결정·만료된 승인을 빼고 대기 중인 것만 남긴다", () => {
    const rows: InboxQueryItem[] = [
      {
        id: "p",
        scope: "work",
        hasPendingApproval: true,
        approvalState: "pending",
        authorKind: "person",
      },
      {
        id: "a",
        scope: "work",
        hasPendingApproval: false,
        approvalState: "approved",
        authorKind: "person",
      },
      {
        id: "e",
        scope: "work",
        hasPendingApproval: false,
        approvalState: "expired",
        authorKind: "person",
      },
      {
        id: "n",
        scope: "work",
        hasPendingApproval: false,
        approvalState: null,
        authorKind: "person",
      },
    ];
    expect(filterInboxItems(rows, "needs-approval").map((i) => i.id)).toEqual(["p"]);
  });
});

describe("inboxRowTitle (U2: 스레드 단위 행 제목, 사람 → 스레드 제목 → 채널 핸들)", () => {
  it("prefers the person display name", () => {
    expect(
      inboxRowTitle({
        personName: "Sora Kim",
        threadTitle: "#omnis-launch",
        channelHandle: "C0123",
      }),
    ).toBe("Sora Kim");
  });
  it("falls back to the thread title when there is no person (e.g. I sent the last message)", () => {
    expect(
      inboxRowTitle({ personName: null, threadTitle: "#omnis-launch", channelHandle: "C0123" }),
    ).toBe("#omnis-launch");
  });
  it("falls back to the channel handle when there is no person and no thread title", () => {
    expect(
      inboxRowTitle({ personName: null, threadTitle: null, channelHandle: "+15551234567" }),
    ).toBe("+15551234567");
  });
  it("uses the placeholder only when nothing identifies the row", () => {
    expect(inboxRowTitle({ personName: null, threadTitle: null, channelHandle: null })).toBe(
      "(제목 없음)",
    );
  });
});

describe("threadSummary (U2: threads.meta.summary → subject → 마지막 item 본문 첫 줄)", () => {
  it("prefers threads.meta.summary when B3 has filled it", () => {
    expect(
      threadSummary({
        metaSummary: "Brightstone Realty 계약서 공유를 원해요",
        subject: "계약서 요청",
        body: "안녕하세요\n계약서 부탁드립니다",
      }),
    ).toBe("Brightstone Realty 계약서 공유를 원해요");
  });
  it("falls back to the item subject when there is no summary yet", () => {
    expect(
      threadSummary({ metaSummary: null, subject: "계약서 요청", body: "안녕하세요\n본문" }),
    ).toBe("계약서 요청");
  });
  it("skips a subject that is already the row title and uses the body instead", () => {
    // Gmail/gcal은 thread.title이 subject라 행 제목과 요약이 같은 문자열이 된다.
    expect(
      threadSummary({
        metaSummary: null,
        subject: "omnis launch sync",
        title: "omnis launch sync",
        body: "내일 10시에 봐요\n장소는 추후 공지",
      }),
    ).toBe("내일 10시에 봐요");
  });
  it("leaves the summary empty when every candidate just repeats the title", () => {
    // gcal은 body까지 e.summary와 같은 문자열이다 — 같은 말을 두 줄 쓰느니 둘째 줄을 접는다.
    expect(
      threadSummary({
        metaSummary: null,
        subject: null,
        title: "omnis launch sync",
        body: "omnis launch sync",
      }),
    ).toBe("");
  });
  it("strips the Subject header the gmail adapter synthesizes into the body", () => {
    expect(
      threadSummary({
        metaSummary: null,
        subject: null,
        title: "PoC slides",
        body: "Subject: PoC slides\n\n슬라이드 초안 보냅니다\n확인 부탁드려요",
      }),
    ).toBe("슬라이드 초안 보냅니다");
  });
  it("falls back to the first line of the body when there is no summary and no subject", () => {
    expect(
      threadSummary({
        metaSummary: null,
        subject: null,
        body: "회의 자료 확인 부탁드립니다\n감사합니다",
      }),
    ).toBe("회의 자료 확인 부탁드립니다");
  });
  it("trims the first line", () => {
    expect(
      threadSummary({ metaSummary: null, subject: null, body: "  공백 있음  \n둘째 줄" }),
    ).toBe("공백 있음");
  });
});

describe("sortInboxRows (U2: blocked agent session·승인 대기 행이 최상단, 나머지는 원래 순서 유지)", () => {
  it("moves a pending-approval row to the top without reordering the rest", () => {
    const rows: (SortableInboxRow & { id: string })[] = [
      { id: "a", hasPendingApproval: false, agentState: null },
      { id: "b", hasPendingApproval: false, agentState: "idle" },
      { id: "c", hasPendingApproval: true, agentState: null },
      { id: "d", hasPendingApproval: false, agentState: "working" },
    ];
    expect(sortInboxRows(rows).map((r) => r.id)).toEqual(["c", "a", "b", "d"]);
  });

  it("moves a blocked agent session row to the top", () => {
    const rows: (SortableInboxRow & { id: string })[] = [
      { id: "a", hasPendingApproval: false, agentState: "done" },
      { id: "b", hasPendingApproval: false, agentState: "blocked" },
    ];
    expect(sortInboxRows(rows).map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("keeps relative order stable within the same priority", () => {
    const rows: (SortableInboxRow & { id: string })[] = [
      { id: "first", hasPendingApproval: true, agentState: null },
      { id: "second", hasPendingApproval: false, agentState: "blocked" },
      { id: "third", hasPendingApproval: false, agentState: null },
    ];
    expect(sortInboxRows(rows).map((r) => r.id)).toEqual(["first", "second", "third"]);
  });

  it("does not mutate the input array", () => {
    const rows: (SortableInboxRow & { id: string })[] = [
      { id: "a", hasPendingApproval: false, agentState: null },
      { id: "b", hasPendingApproval: true, agentState: null },
    ];
    const original = [...rows];
    sortInboxRows(rows);
    expect(rows).toEqual(original);
  });
});

describe("approvalPillState (US-D02: DB 승인 상태 + 판정 → 표시 상태)", () => {
  it.each([
    ["pending", null, "pending"],
    ["expired", null, "expired"],
    // 내가 승인해 준 건의 실행이 실패한 것. 이걸 "거절됨"으로 접으면 하지 않은 행동을 했다고
    // 말하는 셈이라 별도 상태다(DB에 rejected state는 없다 — 거절은 decision='ignore'다).
    ["failed", "accept", "failed"],
    ["failed", null, "failed"],
    ["executed", "accept", "approved"],
    ["executed", "edit", "approved"],
    ["decided", "accept", "approved"],
    ["executing", "accept", "approved"],
    // respond는 역제안이다 — 거절이 아니라 별도 선택지(config.allow_respond).
    ["decided", "respond", "responded"],
    ["decided", "ignore", "rejected"],
    ["decided", null, "rejected"],
    ["executed", null, "rejected"],
  ] as const)("state=%s decision=%s → %s", (state, decision, expected) => {
    expect(approvalPillState({ state, decision })).toBe(expected);
  });
});

describe("groupByApprovalState (US-D02: 대기 → 승인됨 → 역제안 → 거절됨 → 실패 → 만료)", () => {
  const rows = [
    { id: "e", approvalState: "expired" as const },
    { id: "p", approvalState: "pending" as const },
    { id: "n", approvalState: null },
    { id: "f", approvalState: "failed" as const },
    { id: "r", approvalState: "responded" as const },
    { id: "x", approvalState: "rejected" as const },
    { id: "a", approvalState: "approved" as const },
  ];

  it("데이터가 있는 그룹만, 순서대로 내고 그룹 안 순서는 건드리지 않는다", () => {
    expect(groupByApprovalState(rows).map((g) => [g.state, g.rows.map((r) => r.id)])).toEqual([
      ["pending", ["p"]],
      ["approved", ["a"]],
      ["responded", ["r"]],
      ["rejected", ["x"]],
      ["failed", ["f"]],
      ["expired", ["e"]],
    ]);
  });

  it("승인이 없는 행은 어느 그룹에도 안 들어간다", () => {
    expect(groupByApprovalState(rows).flatMap((g) => g.rows)).not.toContainEqual({ id: "n" });
  });

  it("빈 입력은 빈 배열 — 헤더 없는 섹션을 만들지 않는다", () => {
    expect(groupByApprovalState([])).toEqual([]);
  });
});

describe("groupByAgentState (US-D02: blocked 최상단, 세션 없는 행은 ungrouped)", () => {
  const rows = [
    { id: "i", agentState: "idle" as const },
    { id: "b", agentState: "blocked" as const },
    { id: "x", agentState: null },
    { id: "w", agentState: "working" as const },
  ];

  it("blocked → working → idle 순서로 묶고, ungrouped는 원래 순서로 따로 돌려준다", () => {
    const { groups, ungrouped } = groupByAgentState(rows);
    expect(groups.map((g) => [g.state, g.rows.map((r) => r.id)])).toEqual([
      ["blocked", ["b"]],
      ["working", ["w"]],
      ["idle", ["i"]],
    ]);
    expect(ungrouped.map((r) => r.id)).toEqual(["x"]);
  });
});
