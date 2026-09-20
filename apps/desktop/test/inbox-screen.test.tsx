import { describe, expect, it } from "vitest";
import { type InboxFilter, type InboxQueryItem, filterInboxItems } from "../src/screens/Inbox";

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
