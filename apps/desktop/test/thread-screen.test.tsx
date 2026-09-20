import { describe, expect, it } from "vitest";
import { type ThreadQueryItem, findDraftItem } from "../src/screens/Thread";

const items: ThreadQueryItem[] = [
  { id: "1", status: "read", body: "확인했습니다" },
  { id: "2", status: "draft", body: "이 초안이 최신" },
];

describe("findDraftItem (A5 §3.2 DraftCard는 status='draft'인 Item이 있을 때만)", () => {
  it("returns the draft item when present", () => {
    expect(findDraftItem(items)?.id).toBe("2");
  });
  it("returns undefined when no draft exists", () => {
    expect(findDraftItem(items.filter((i) => i.status !== "draft"))).toBeUndefined();
  });
});
