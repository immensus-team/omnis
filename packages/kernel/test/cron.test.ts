import { nextRunAt } from "@omnis/kernel";
import { describe, expect, it } from "vitest";

/** KST 기준 시각을 UTC Date로 만든다(Asia/Seoul = UTC+9, DST 없음). */
function kst(iso: string): Date {
  return new Date(`${iso}+09:00`);
}

describe("nextRunAt (5-field cron, TZ=Asia/Seoul)", () => {
  it("handles the A3 seed schedules", () => {
    expect(nextRunAt("30 6 * * *", kst("2026-09-20T05:00:00")).toISOString()).toBe(
      kst("2026-09-20T06:30:00").toISOString(),
    );
    expect(nextRunAt("0 23 * * *", kst("2026-09-20T23:00:00")).toISOString()).toBe(
      kst("2026-09-21T23:00:00").toISOString(),
    );
    expect(nextRunAt("*/10 * * * *", kst("2026-09-20T10:03:00")).toISOString()).toBe(
      kst("2026-09-20T10:10:00").toISOString(),
    );
    expect(nextRunAt("0 9,14,19 * * *", kst("2026-09-20T10:00:00")).toISOString()).toBe(
      kst("2026-09-20T14:00:00").toISOString(),
    );
  });

  it("handles day-of-week ranges and single days", () => {
    // 2026-09-20 is a Sunday; the weekday job must jump to Monday.
    expect(nextRunAt("0 10 * * 1-5", kst("2026-09-20T09:00:00")).toISOString()).toBe(
      kst("2026-09-21T10:00:00").toISOString(),
    );
    // Sunday-only job, asked on Sunday before the hour.
    expect(nextRunAt("0 22 * * 0", kst("2026-09-20T09:00:00")).toISOString()).toBe(
      kst("2026-09-20T22:00:00").toISOString(),
    );
    // Monday-only job.
    expect(nextRunAt("0 4 * * 1", kst("2026-09-20T09:00:00")).toISOString()).toBe(
      kst("2026-09-21T04:00:00").toISOString(),
    );
  });

  it("never returns the instant it was given", () => {
    const at = kst("2026-09-20T06:30:00");
    expect(nextRunAt("30 6 * * *", at).getTime()).toBeGreaterThan(at.getTime());
  });

  it("rejects malformed cron strings", () => {
    expect(() => nextRunAt("30 6 * *", new Date())).toThrow(/5 fields/);
    expect(() => nextRunAt("99 6 * * *", new Date())).toThrow(/out of range/);
    expect(() => nextRunAt("*/0 * * * *", new Date())).toThrow(/step/);
  });
});
