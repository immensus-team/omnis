import { describe, expect, it } from "vitest";
import {
  type InboxFilter,
  type InboxQueryItem,
  type SortableInboxRow,
  filterInboxItems,
  inboxRowTitle,
  sortInboxRows,
  threadSummary,
} from "../src/screens/Inbox";

const items: InboxQueryItem[] = [
  { id: "1", scope: "work", hasPendingApproval: false, authorKind: "person" },
  { id: "2", scope: "personal", hasPendingApproval: true, authorKind: "person" },
  { id: "3", scope: "work", hasPendingApproval: false, authorKind: "agent" },
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
