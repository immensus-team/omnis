import { describe, expect, it } from "vitest";
import { agentSessionKinsoState, initialsFromName, pastelFromName } from "../src/lib/row-meta";

describe("initialsFromName (U2 아바타 폴백)", () => {
  it("두 단어 이름은 각 단어 첫 글자", () => {
    expect(initialsFromName("Sora Kim")).toBe("SK");
  });
  it("한 단어 이름은 앞 두 글자", () => {
    expect(initialsFromName("Codex")).toBe("CO");
  });
  it("빈 문자열은 물음표", () => {
    expect(initialsFromName("")).toBe("?");
  });
  it("여러 단어면 처음과 마지막만 쓴다", () => {
    expect(initialsFromName("David Yun Park")).toBe("DP");
  });
});

describe("pastelFromName (U2 아바타 배경색)", () => {
  it("같은 이름은 항상 같은 색(결정적)", () => {
    expect(pastelFromName("Sora Kim")).toBe(pastelFromName("Sora Kim"));
  });
  it("다른 이름은 대체로 다른 색", () => {
    expect(pastelFromName("Sora Kim")).not.toBe(pastelFromName("David Park"));
  });
  it("oklch 파스텔(고명도) 문자열을 반환한다", () => {
    expect(pastelFromName("Sora Kim")).toMatch(/^oklch\(0\.88 0\.06 \d+\)$/);
  });
});

describe("agentSessionKinsoState (A3 agent_sessions.state → herdr 4상태)", () => {
  it.each([
    ["starting", "working"],
    ["running", "working"],
    ["idle", "idle"],
    ["waiting_approval", "blocked"],
    ["ended", "done"],
    ["failed", "blocked"],
  ] as const)("%s → %s", (dbState, expected) => {
    expect(agentSessionKinsoState(dbState)).toBe(expected);
  });
  it("모르는 값은 idle로 폴백한다", () => {
    expect(agentSessionKinsoState("unknown-future-state")).toBe("idle");
  });
});
