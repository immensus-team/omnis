import { describe, expect, it } from "vitest";
import { PUSH_BATCH_HOURS_KST, inQuietHours, notifyTierFor } from "../src/notify/tier.js";

/** Builds a UTC Date for a KST wall-clock time (Asia/Seoul has no DST, so a fixed -9h). */
const kst = (h: number, m = 0): Date => new Date(Date.UTC(2026, 8, 20, h - 9, m));

describe("inQuietHours (A4 §3.6)", () => {
  it("covers 23:00~07:00 KST across midnight", () => {
    expect(inQuietHours(kst(22, 59))).toBe(false);
    expect(inQuietHours(kst(23, 0))).toBe(true);
    expect(inQuietHours(kst(3, 0))).toBe(true);
    expect(inQuietHours(kst(6, 59))).toBe(true);
    expect(inQuietHours(kst(7, 0))).toBe(false);
  });
});

describe("notifyTierFor (A4 §3.6)", () => {
  const now = kst(14);
  it("pushes immediately only for priority=now with vip/mention/meeting", () => {
    expect(
      notifyTierFor({ priority: "now", vip: true, mentionsMe: false, meetingWithin2h: false, now }),
    ).toBe("immediate");
    expect(
      notifyTierFor({ priority: "now", vip: false, mentionsMe: true, meetingWithin2h: false, now }),
    ).toBe("immediate");
    expect(
      notifyTierFor({ priority: "now", vip: false, mentionsMe: false, meetingWithin2h: true, now }),
    ).toBe("immediate");
    expect(
      notifyTierFor({
        priority: "now",
        vip: false,
        mentionsMe: false,
        meetingWithin2h: false,
        now,
      }),
    ).toBe("silent");
  });

  it("batches priority=today and silences the rest", () => {
    expect(
      notifyTierFor({
        priority: "today",
        vip: false,
        mentionsMe: false,
        meetingWithin2h: false,
        now,
      }),
    ).toBe("batched");
    expect(
      notifyTierFor({ priority: "week", vip: true, mentionsMe: true, meetingWithin2h: true, now }),
    ).toBe("silent");
    expect(
      notifyTierFor({
        priority: "fyi",
        vip: false,
        mentionsMe: false,
        meetingWithin2h: false,
        now,
      }),
    ).toBe("silent");
  });

  it("downgrades immediate to batched inside quiet hours — except vip AND priority=now", () => {
    const night = kst(1);
    expect(
      notifyTierFor({
        priority: "now",
        vip: false,
        mentionsMe: true,
        meetingWithin2h: false,
        now: night,
      }),
    ).toBe("batched");
    expect(
      notifyTierFor({
        priority: "now",
        vip: true,
        mentionsMe: false,
        meetingWithin2h: false,
        now: night,
      }),
    ).toBe("immediate");
    expect(
      notifyTierFor({
        priority: "now",
        vip: true,
        mentionsMe: false,
        meetingWithin2h: false,
        now: night,
        vipOverride: false,
      }),
    ).toBe("batched");
  });

  it("batches at 09/12/15/18 KST", () => {
    expect(PUSH_BATCH_HOURS_KST).toEqual([9, 12, 15, 18]);
  });
});
