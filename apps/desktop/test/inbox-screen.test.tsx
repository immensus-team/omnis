import { describe, expect, it } from "vitest";
import {
  type InboxFilter,
  type InboxQueryItem,
  filterInboxItems,
  inboxRowTitle,
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

describe("inboxRowTitle (A5 §3.1 행 제목)", () => {
  it("prefers the author display name", () => {
    expect(
      inboxRowTitle({
        author: { display_name: "Sora Kim" },
        subject: "견적",
        thread: { title: "#omnis-launch" },
      }),
    ).toBe("Sora Kim");
  });
  it("falls back to the item subject", () => {
    expect(inboxRowTitle({ subject: "견적 요청", thread: { title: "#omnis-launch" } })).toBe(
      "견적 요청",
    );
  });
  // Phase A는 author_person_id를 채우지 않고(kernel/ingest.ts) Slack 메시지에는 subject가 없다 —
  // 스레드 제목까지 못 내려가면 Inbox 전체가 "(제목 없음)"이 된다.
  it("falls back to the thread title when there is no author and no subject", () => {
    expect(inboxRowTitle({ subject: null, thread: { title: "#omnis-launch" } })).toBe(
      "#omnis-launch",
    );
  });
  it("uses the placeholder only when nothing identifies the row", () => {
    expect(inboxRowTitle({ subject: null, thread: { title: null } })).toBe("(제목 없음)");
  });
});
