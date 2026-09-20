import { Sparkles } from "lucide-react";
import type { ElementType } from "react";
import { PiOpenAiLogo } from "react-icons/pi";
import { SiAnthropic, SiDeepseek } from "react-icons/si";
import agent1x from "../assets/brands/agent@1x.png";
import agent2x from "../assets/brands/agent@2x.png";
import gcal1x from "../assets/brands/gcal@1x.png";
import gcal2x from "../assets/brands/gcal@2x.png";
import gmail1x from "../assets/brands/gmail@1x.png";
import gmail2x from "../assets/brands/gmail@2x.png";
import kakaotalk1x from "../assets/brands/kakaotalk@1x.png";
import kakaotalk2x from "../assets/brands/kakaotalk@2x.png";
import linkedin1x from "../assets/brands/linkedin@1x.png";
import linkedin2x from "../assets/brands/linkedin@2x.png";
import outlook1x from "../assets/brands/outlook@1x.png";
import outlook2x from "../assets/brands/outlook@2x.png";
import slack1x from "../assets/brands/slack@1x.png";
import slack2x from "../assets/brands/slack@2x.png";
import system1x from "../assets/brands/system@1x.png";
import system2x from "../assets/brands/system@2x.png";
import telegram1x from "../assets/brands/telegram@1x.png";
import telegram2x from "../assets/brands/telegram@2x.png";
import whatsapp1x from "../assets/brands/whatsapp@1x.png";
import whatsapp2x from "../assets/brands/whatsapp@2x.png";
import type { UiChannel } from "../types.js";

/** channel-rail.tsx(U1)와 inbox-row.tsx(U2)가 둘 다 필요한 채널 한글 라벨 + 브랜드 아이콘.
 * 예전에는 inbox-row.tsx에 있었고 channel-rail이 거기서 import했다 — U2에서 inbox-row도
 * 아이콘이 필요해지면서 그대로 두면 순환 import가 생겨 공용 lib로 옮긴다. */
export const CHANNEL_LABEL: Record<UiChannel, string> = {
  slack: "Slack",
  gmail: "Gmail",
  gcal: "Google Calendar",
  outlook: "Outlook",
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  kakaotalk: "KakaoTalk",
  linkedin: "LinkedIn",
  agent: "Agent",
  system: "System",
};

/** US-D02b: 채널 마크는 react-icons 단색 SVG가 아니라 실제 브랜드 PNG다(Logan 제공, 64px/128px).
 * react-icons는 멀티톤 마크를 못 주고(Slack/LinkedIn/Outlook은 상표 정책으로 simple-icons에 아예
 * 없다) 그래서 U5는 단색 아이콘에 브랜드 hex를 *근사*해 칠하고 KakaoTalk만 CSS로 노란 타일을
 * 덧씌웠다 — 이제 그 근사 레이어가 통째로 필요 없다(KakaoTalk의 노란 타일도 PNG 안에 있다).
 * 파일명 = UiChannel 값이라 채널이 늘면 여기 한 항목 + assets/brands PNG 2장만 추가하면 된다. */
export const CHANNEL_BRAND_ASSET: Record<UiChannel, { at1x: string; at2x: string }> = {
  slack: { at1x: slack1x, at2x: slack2x },
  gmail: { at1x: gmail1x, at2x: gmail2x },
  gcal: { at1x: gcal1x, at2x: gcal2x },
  outlook: { at1x: outlook1x, at2x: outlook2x },
  telegram: { at1x: telegram1x, at2x: telegram2x },
  whatsapp: { at1x: whatsapp1x, at2x: whatsapp2x },
  kakaotalk: { at1x: kakaotalk1x, at2x: kakaotalk2x },
  linkedin: { at1x: linkedin1x, at2x: linkedin2x },
  agent: { at1x: agent1x, at2x: agent2x },
  system: { at1x: system1x, at2x: system2x },
};

/** A3 agent_runtimes_runtime_ck의 실제 enum(0002_core_inbox.sql). */
export type AgentRuntimeKind = "claude_code" | "codex" | "claude_ds" | "hermes" | "omnis";

export const RUNTIME_LABEL: Record<AgentRuntimeKind, string> = {
  claude_code: "Claude Code",
  codex: "Codex",
  claude_ds: "claude-ds",
  hermes: "Hermes",
  omnis: "omnis",
};

// 런타임 배지는 채널 마크와 별개다 — 여기는 react-icons/lucide 그대로 간다(에이전트 런타임은
// 공식 PNG 세트에 없고, 없는 마크를 손으로 그리지 않는다).
// hermes는 RUNTIME_ICON에서 아예 뺀다(undefined) — simple-icons의 SiHermes는 명품 브랜드
// 에르메스 마크지 이 런타임의 마크가 아니므로 그걸 갖다 붙이는 건 "아무 아이콘이나 브랜드 자리에
// 넣기" 슬롭이다. inbox-row.tsx가 RUNTIME_LETTER["H"]로 폴백한다.
// ponytail: codex는 PiOpenAiLogo(react-icons/pi — 이 파일이 Outlook에 이미 쓰는 세트)로 간다.
// 스펙은 react-icons/si의 SiOpenai를 지목했지만 simple-icons는 OpenAI 로고를 상표 정책으로 뺐다
// (5.7.0에는 SiOpenaigym만 남아 있다 — 이름이 SiOpenai로 "보이는" 건 접두 매치다). OpenAI 마크가
// 실제로 있는 세트 중 pi를 골랐다. 이전 lucide Bot은 OpenAI 마크가 없던 시절의 대체물이었다.
// hermes용 진짜 마크는 생기면 여기 한 줄 추가.
export const RUNTIME_ICON: Partial<Record<AgentRuntimeKind, ElementType>> = {
  claude_code: SiAnthropic,
  claude_ds: SiDeepseek,
  codex: PiOpenAiLogo,
  omnis: Sparkles,
};

/** RUNTIME_ICON에 마크가 없는 런타임(현재 hermes)의 글자 폴백 — 아바타 폴백(initialsFromName)과
 * 같은 발상, 사람 이니셜 대신 런타임 이니셜 한 글자다(DESIGN-DIRECTION.md P1: Hermes → "H"). */
export const RUNTIME_LETTER: Record<AgentRuntimeKind, string> = {
  claude_code: "C",
  claude_ds: "DS",
  codex: "CX",
  hermes: "H",
  omnis: "O",
};

/** herdr/kinso 4-상태 배지(idle/working/blocked/done)로 내리는 agent_sessions.state 매핑
 * (A3 agent_sessions_state_ck: starting/idle/running/waiting_approval/ended/failed).
 * failed는 별도 상태 없이 blocked로 합친다 — 둘 다 "내가 봐야 한다"는 같은 사용자 행동을 요구한다. */
export type AgentSessionKinsoState = "idle" | "working" | "blocked" | "done";

const DB_STATE_TO_KINSO: Record<string, AgentSessionKinsoState> = {
  starting: "working",
  running: "working",
  idle: "idle",
  waiting_approval: "blocked",
  ended: "done",
  failed: "blocked",
};

export function agentSessionKinsoState(dbState: string): AgentSessionKinsoState {
  return DB_STATE_TO_KINSO[dbState] ?? "idle";
}

/** 아바타 폴백(사람 사진이 없을 때, A5 §3.1 + DESIGN-DIRECTION U2): 이름에서 결정적으로
 * 이니셜 + 파스텔 배경을 만든다. 같은 이름은 항상 같은 색 — 세션 간 리렌더로 색이 안 튄다. */
export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) return "?";
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  const last = parts[parts.length - 1] ?? first;
  return (first.charAt(0) + last.charAt(0)).toUpperCase();
}

export function pastelFromName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  // oklch 고명도·저채도 = 파스텔, 프로젝트 톤 토큰(tokens.css)과 같은 컬러 스페이스.
  return `oklch(0.88 0.06 ${hue})`;
}
