import { Bot, Sparkles } from "lucide-react";
import type { ElementType } from "react";
import { FaLinkedin, FaSlack } from "react-icons/fa6";
import { PiMicrosoftOutlookLogo } from "react-icons/pi";
import {
  SiAnthropic,
  SiDeepseek,
  SiGmail,
  SiGooglecalendar,
  SiKakaotalk,
  SiTelegram,
  SiWhatsapp,
} from "react-icons/si";
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

/** simple-icons(react-icons/si)에 Slack/LinkedIn/Outlook 로고가 없어(상표 정책) fa6/pi에서 채운다. */
export const CHANNEL_ICON: Record<UiChannel, ElementType> = {
  gmail: SiGmail,
  slack: FaSlack,
  linkedin: FaLinkedin,
  whatsapp: SiWhatsapp,
  telegram: SiTelegram,
  kakaotalk: SiKakaotalk,
  outlook: PiMicrosoftOutlookLogo,
  gcal: SiGooglecalendar,
  agent: Sparkles,
  system: Sparkles,
};

/** U5 kinso polish: 레일 타일·행 아이콘에 실제 브랜드 컬러를 입힌다(DESIGN-DIRECTION.md, P1).
 * react-icons 아이콘은 currentColor를 쓰므로 이 값을 아이콘의 CSS color로 넣으면 된다.
 * simple-icons가 진짜 멀티톤 마크를 안 주므로(단색 path 1개) 대부분 브랜드 hex 단색이다 —
 * 태스크가 명시한 hex는 그대로(Slack/LinkedIn/WhatsApp/Telegram/Outlook/KakaoTalk), Gmail·GCal은
 * 태스크에 지정이 없어 구글 공개 브랜드 팔레트로 근사(ponytail: 정확한 값이 필요해지면 여기만 바꾼다). */
export const CHANNEL_COLOR: Record<UiChannel, string> = {
  gmail: "#EA4335",
  slack: "#4A154B",
  linkedin: "#0A66C2",
  whatsapp: "#25D366",
  telegram: "#26A5E4",
  kakaotalk: "#000000",
  outlook: "#0078D4",
  gcal: "#4285F4",
  agent: "var(--accent)",
  system: "var(--accent)",
};

/** KakaoTalk만 예외: 브랜드 옐로가 아이콘 자체가 아니라 뒤판(타일) 색이다(글리프는 검정) —
 * 다른 채널은 타일 없이 컬러 아이콘만 띄운다(kinso 실측, 23 §2). */
export const CHANNEL_TILE_BG: Partial<Record<UiChannel, string>> = {
  kakaotalk: "#FFE812",
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

// ponytail: 이 react-icons/simple-icons 버전에 OpenAI(Codex)·Hermes 전용 로고가 없다 — 있는 것
// (Anthropic/DeepSeek)만 실제 브랜드 마크를 쓴다. hermes는 RUNTIME_ICON에서 아예 빼고(undefined)
// row-meta.test.ts + inbox-row.tsx가 RUNTIME_LETTER["H"]로 폴백한다(태스크 스펙 그대로). codex는
// 마크가 없어도 "글자만" 폴백보다는 lucide Bot이 읽기 쉬워 그대로 둔다 — OpenAI 마크가 이 패키지에
// 들어오면 여기만 바꾼다.
export const RUNTIME_ICON: Partial<Record<AgentRuntimeKind, ElementType>> = {
  claude_code: SiAnthropic,
  claude_ds: SiDeepseek,
  codex: Bot,
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
