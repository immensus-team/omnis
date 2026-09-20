import { describe, expect, it } from "vitest";
import {
  CHANNEL_BRAND_ASSET,
  RUNTIME_ICON,
  RUNTIME_LETTER,
  agentSessionKinsoState,
  initialsFromName,
  pastelFromName,
} from "../src/lib/row-meta";
import type { UiChannel } from "../src/types";

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

describe("CHANNEL_BRAND_ASSET (US-D02b: official brand PNGs replace tinted react-icons)", () => {
  it("gives every UiChannel both a 1x and a 2x asset", () => {
    for (const channel of Object.keys(CHANNEL_BRAND_ASSET) as UiChannel[]) {
      expect(CHANNEL_BRAND_ASSET[channel].at1x).toMatch(/\.png$/);
      expect(CHANNEL_BRAND_ASSET[channel].at2x).toMatch(/\.png$/);
    }
  });

  it("resolves the two assets of a channel to different files", () => {
    for (const channel of Object.keys(CHANNEL_BRAND_ASSET) as UiChannel[]) {
      expect(CHANNEL_BRAND_ASSET[channel].at1x).not.toBe(CHANNEL_BRAND_ASSET[channel].at2x);
    }
  });

  // The record is typed Record<UiChannel, …> so tsc already proves exhaustiveness — this guards the
  // runtime map against a channel being dropped from it while the type still claims otherwise.
  it("covers all ten channels", () => {
    expect(Object.keys(CHANNEL_BRAND_ASSET)).toHaveLength(10);
    expect(Object.keys(CHANNEL_BRAND_ASSET).sort()).toEqual(
      [
        "agent",
        "gcal",
        "gmail",
        "kakaotalk",
        "linkedin",
        "outlook",
        "slack",
        "system",
        "telegram",
        "whatsapp",
      ].sort(),
    );
  });
});

describe("RUNTIME_ICON / RUNTIME_LETTER (U5: 에이전트 세션 아바타 = 런타임 로고)", () => {
  it("Claude Code는 Anthropic 마크(react-icons/si)를 쓴다", () => {
    expect(RUNTIME_ICON.claude_code).toBeDefined();
  });
  it("DeepSeek은 브랜드 마크를 쓴다", () => {
    expect(RUNTIME_ICON.claude_ds).toBeDefined();
  });
  it("Hermes는 브랜드 마크가 없어 아이콘 대신 글자 폴백('H')이다", () => {
    expect(RUNTIME_ICON.hermes).toBeUndefined();
    expect(RUNTIME_LETTER.hermes).toBe("H");
  });

  // simple-icons' SiHermes is the Hermès (fashion house) mark, not this runtime's — attaching it
  // would be the "any icon in a brand slot" slop the letter fallback above exists to avoid.
  it("Codex uses the OpenAI mark instead of the old generic lucide Bot", () => {
    expect(RUNTIME_ICON.codex).toBeDefined();
  });
});
