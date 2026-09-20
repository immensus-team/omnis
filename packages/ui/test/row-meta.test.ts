import { describe, expect, it } from "vitest";
import {
  CHANNEL_COLOR,
  CHANNEL_TILE_BG,
  RUNTIME_ICON,
  RUNTIME_LETTER,
  agentSessionKinsoState,
  initialsFromName,
  pastelFromName,
} from "../src/lib/row-meta";

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

describe("CHANNEL_COLOR (U5: 레일·행 브랜드 아이콘 실컬러)", () => {
  it("각 채널이 3자리 이상의 hex 또는 CSS 변수 색을 갖는다", () => {
    for (const channel of Object.keys(CHANNEL_COLOR) as (keyof typeof CHANNEL_COLOR)[]) {
      expect(CHANNEL_COLOR[channel]).toMatch(/^#[0-9a-f]{6}$|^var\(--/i);
    }
  });
  it("지정된 브랜드 hex를 그대로 쓴다(DESIGN 스펙)", () => {
    expect(CHANNEL_COLOR.slack).toBe("#4A154B");
    expect(CHANNEL_COLOR.linkedin).toBe("#0A66C2");
    expect(CHANNEL_COLOR.whatsapp).toBe("#25D366");
    expect(CHANNEL_COLOR.telegram).toBe("#26A5E4");
    expect(CHANNEL_COLOR.outlook).toBe("#0078D4");
  });
  it("agent는 accent 토큰을 쓴다(Agents 타일 = accent 컬러 sparkle)", () => {
    expect(CHANNEL_COLOR.agent).toBe("var(--accent)");
  });
  it("KakaoTalk은 글리프가 검정이고 별도 타일 배경(브랜드 옐로)을 갖는다", () => {
    expect(CHANNEL_COLOR.kakaotalk).toBe("#000000");
    expect(CHANNEL_TILE_BG.kakaotalk).toBe("#FFE812");
  });
  it("다른 채널은 타일 배경을 갖지 않는다(아이콘 컬러만)", () => {
    expect(CHANNEL_TILE_BG.slack).toBeUndefined();
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
});
