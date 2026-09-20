import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "../src/lib/relative-time";

const NOW = new Date("2026-09-20T12:00:00Z").getTime();
const min = (n: number) => n * 60_000;
const hour = (n: number) => n * 3_600_000;
const day = (n: number) => n * 86_400_000;

describe("formatRelativeTime (U2 kinso 행 상대시간)", () => {
  it.each([
    ["방금(30초 전) → now", 30_000, "now"],
    ["59초 전 → now", 59_000, "now"],
    ["1분 전 → 1m", min(1), "1m"],
    ["3분 전 → 3m", min(3), "3m"],
    ["59분 전 → 59m", min(59), "59m"],
    ["정각 1시간 전 → 1h", hour(1), "1h"],
    ["23시간 전 → 23h", hour(23), "23h"],
    ["정각 1일 전 → 1d", day(1), "1d"],
    ["6일 전 → 6d", day(6), "6d"],
    ["정각 1주 전 → 1w", day(7), "1w"],
    ["13일 전 → 1w(바닥)", day(13), "1w"],
    ["2주 전 → 2w", day(14), "2w"],
  ] as const)("%s", (_label, agoMs, expected) => {
    expect(formatRelativeTime(NOW - agoMs, NOW)).toBe(expected);
  });

  it("4주가 지나면 날짜 표기로 전환된다 (spec 예시 '4 Aug')", () => {
    const aug4 = new Date("2026-08-04T09:00:00Z").getTime();
    expect(formatRelativeTime(aug4, NOW)).toBe("4 Aug");
  });

  it("해가 다르면 연도를 덧붙인다", () => {
    const lastYear = new Date("2025-12-01T09:00:00Z").getTime();
    expect(formatRelativeTime(lastYear, NOW)).toBe("1 Dec 2025");
  });

  it("미래 타임스탬프(클럭 스큐)는 now로 바닥을 둔다", () => {
    expect(formatRelativeTime(NOW + 60_000, NOW)).toBe("now");
  });
});
