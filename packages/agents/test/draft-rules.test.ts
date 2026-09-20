import { describe, expect, it } from "vitest";
import {
  CHANNEL_DRAFT_SHAPE,
  NEEDS_REPLY_MIN,
  needsReplyScore,
  pickRegister,
  selfCheck,
} from "../src/index.js";
import type { ItemRow } from "../src/types.js";

const item = (over: Partial<ItemRow> = {}): ItemRow => ({
  id: "i1",
  thread_id: "t1",
  account_id: "a1",
  channel: "gmail",
  kind: "email",
  scope: "work",
  sensitivity: "normal",
  author_person_id: null,
  author_is_me: false,
  subject: "Quote",
  body: "When can you send it?",
  sent_at: new Date().toISOString(),
  embedding: null,
  ...over,
});

describe("needsReplyScore (A4 §3.1)", () => {
  it("adds up the five weights", () => {
    const s = needsReplyScore(item(), {
      lastAuthorIsThem: true,
      myReplyRatio: 1,
      inTo: true,
      bulkHeaders: false,
    });
    expect(s).toBeCloseTo(1, 5); // 0.3 + 0.3 + 0.2 + 0.2, clamped to 1.0
  });

  it("drops a newsletter below the threshold", () => {
    // Frozen: a Korean-language newsletter body. It is what the frozen UNSUBSCRIBE regex in
    // src/draft/register.ts matches, so the Korean has to stay verbatim.
    const s = needsReplyScore(item({ body: "구독을 해지하려면 여기를 누르세요" }), {
      lastAuthorIsThem: true,
      myReplyRatio: 0,
      inTo: false,
      bulkHeaders: true,
    });
    expect(s).toBeLessThan(NEEDS_REPLY_MIN);
  });
});

describe("pickRegister (A4 §3.2)", () => {
  it("uses labels, org and greeting — never a model", () => {
    expect(pickRegister({ language: "ko", labels: ["client"], sameOrg: false })).toBe("formal_ko");
    expect(pickRegister({ language: "ko", labels: [], sameOrg: true })).toBe("polite_ko");
    expect(pickRegister({ language: "ko", labels: ["close"], sameOrg: false })).toBe("casual_ko");
    expect(pickRegister({ language: "en", labels: [], sameOrg: false, greeting: "Dear" })).toBe(
      "formal_en",
    );
    expect(pickRegister({ language: "en", labels: [], sameOrg: false, greeting: "Hi" })).toBe(
      "casual_en",
    );
  });
});

describe("CHANNEL_DRAFT_SHAPE (A4 §3.4)", () => {
  it("covers all ten Channel values with a word target", () => {
    expect(Object.keys(CHANNEL_DRAFT_SHAPE)).toHaveLength(10);
    expect(CHANNEL_DRAFT_SHAPE.gmail.targetWords).toEqual([60, 180]);
    expect(CHANNEL_DRAFT_SHAPE.kakaotalk.targetWords[1]).toBeLessThanOrEqual(40);
  });
});

describe("selfCheck (A4 §3.3)", () => {
  it("fails #6 when the draft copies a link that came from <data>", () => {
    const r = selfCheck("Understood. I'll send it over to https://evil.example/pay.", {
      questionCount: 0,
      externalUrls: ["https://evil.example/pay"],
      calendarConflicts: [],
      voiceSampleAvgLen: 40,
      entityNames: [],
      channel: "gmail",
    });
    expect(r.passed).toBe(false);
    expect(r.failed).toContain(6);
  });

  it("fails #1 when the draft answers fewer questions than it was asked", () => {
    const r = selfCheck("Yes.", {
      questionCount: 2,
      externalUrls: [],
      calendarConflicts: [],
      voiceSampleAvgLen: 40,
      entityNames: [],
      channel: "slack",
    });
    expect(r.failed).toContain(1);
  });

  it("passes a clean draft", () => {
    // Frozen: a Korean-language draft sample ("Yes, I'll send it Thursday at 2pm. I'll check and
    // let you know."). Its `확인해보고` matches the frozen Korean-only HEDGE regex in
    // src/draft/selfcheck.ts, so translating it would change which branch selfCheck takes.
    const r = selfCheck("네, 목요일 오후 2시에 보내드리겠습니다. 확인해보고 알려드리겠습니다.", {
      questionCount: 1,
      externalUrls: [],
      calendarConflicts: [],
      voiceSampleAvgLen: 40,
      entityNames: [],
      channel: "gmail",
    });
    expect(r).toEqual({ passed: true, failed: [] });
  });
});
