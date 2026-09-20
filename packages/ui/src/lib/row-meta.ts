import { Bot, Sparkles, Zap } from "lucide-react";
import type { ElementType } from "react";
import { FaLinkedin, FaSlack } from "react-icons/fa6";
import { PiMicrosoftOutlookLogo } from "react-icons/pi";
import {
  SiClaudecode,
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

/** A3 agent_runtimes_runtime_ck의 실제 enum(0002_core_inbox.sql). */
export type AgentRuntimeKind = "claude_code" | "codex" | "claude_ds" | "hermes" | "omnis";

export const RUNTIME_LABEL: Record<AgentRuntimeKind, string> = {
  claude_code: "Claude Code",
  codex: "Codex",
  claude_ds: "claude-ds",
  hermes: "Hermes",
  omnis: "omnis",
};

// ponytail: simple-icons에 OpenAI Codex/Hermes 전용 로고가 없다 — 있는 것(Claude/DeepSeek)만 실제
// 브랜드 마크를 쓰고, 나머지는 lucide 제네릭 아이콘으로 구분만 준다. 로고가 등록되면 여기만 바꾼다.
export const RUNTIME_ICON: Record<AgentRuntimeKind, ElementType> = {
  claude_code: SiClaudecode,
  claude_ds: SiDeepseek,
  codex: Bot,
  hermes: Zap,
  omnis: Sparkles,
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
