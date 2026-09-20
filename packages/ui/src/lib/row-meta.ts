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

/** The channel display labels that channel-rail.tsx (U1) and inbox-row.tsx (U2) both need.
 * They used to live in inbox-row.tsx and channel-rail imported them from there — once inbox-row
 * needed the marks too in U2, leaving them in place would have made a circular import, so they
 * moved into this shared lib. */
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

/** US-D02b: a channel mark is the real brand PNG (supplied by Logan at 64px/128px), not a
 * single-colour react-icons SVG. react-icons cannot give a multi-tone mark, and simple-icons has
 * no Slack/LinkedIn/Outlook at all for trademark reasons, so U5 *approximated* brand hexes over
 * monochrome glyphs and laid a CSS yellow tile under KakaoTalk — that whole approximation layer is
 * gone (KakaoTalk's yellow tile is inside its PNG). Filename = the UiChannel value, so a new
 * channel means one entry here plus two PNGs in assets/brands. */
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

/** The actual enum behind A3's agent_runtimes_runtime_ck (0002_core_inbox.sql). */
export type AgentRuntimeKind = "claude_code" | "codex" | "claude_ds" | "hermes" | "omnis";

export const RUNTIME_LABEL: Record<AgentRuntimeKind, string> = {
  claude_code: "Claude Code",
  codex: "Codex",
  claude_ds: "claude-ds",
  hermes: "Hermes",
  omnis: "omnis",
};

// Runtime badges are separate from channel marks — these stay on react-icons/lucide (the agent
// runtimes are not in the official PNG set, and a mark that does not exist is not hand-drawn).
// hermes is left out of RUNTIME_ICON entirely (undefined): simple-icons' SiHermes is the luxury
// brand's mark, not this runtime's, and putting any icon in a brand's slot is exactly the slop
// this rule exists to stop. inbox-row.tsx falls back to RUNTIME_LETTER's "H".
// ponytail: codex uses PiOpenAiLogo (react-icons/pi — the set this file already uses for Outlook).
// The spec named react-icons/si's SiOpenai, but simple-icons dropped the OpenAI logo for trademark
// reasons (5.7.0 only has SiOpenaigym left — it "looks like" SiOpenai because of prefix matching).
// pi is the set that actually carries the mark. The earlier lucide Bot was a stand-in from when no
// OpenAI mark existed. A real hermes mark, if one appears, is one line here.
//
// US-D05: `omnis: Sparkles` used to sit in this map, and it broke the standard the paragraph above
// sets. Every other entry is a real brand mark out of a mark set; Sparkles is a generic lucide
// glyph, and here it stood for omnis's *own* identity — the one mark in the app that cannot come
// from someone else's set. omnis's mark is the orb, and a hand-drawn approximation of it is barred
// (CLAUDE.md: never hand-draw brand SVGs), so the honest answer is the one the next comment already
// documents: a runtime with no mark falls through to RUNTIME_LETTER. Deleted rather than replaced.
export const RUNTIME_ICON: Partial<Record<AgentRuntimeKind, ElementType>> = {
  claude_code: SiAnthropic,
  claude_ds: SiDeepseek,
  codex: PiOpenAiLogo,
};

/** The letter fallback for a runtime with no mark in RUNTIME_ICON (today: hermes, omnis) — the same
 * idea as the avatar fallback (initialsFromName), one runtime initial instead of a person's
 * (DESIGN-DIRECTION.md P1: Hermes -> "H"). */
export const RUNTIME_LETTER: Record<AgentRuntimeKind, string> = {
  claude_code: "C",
  claude_ds: "DS",
  codex: "CX",
  hermes: "H",
  omnis: "O",
};

/** Maps agent_sessions.state down to the herdr/kinso four-state badge (idle/working/blocked/done)
 * (A3 agent_sessions_state_ck: starting/idle/running/waiting_approval/ended/failed).
 * `failed` folds into blocked rather than getting a state of its own — both ask the user for the
 * same thing: look at this. */
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

/** The avatar fallback when there is no photo (A5 §3.1 + DESIGN-DIRECTION U2): initials and a
 * pastel background derived deterministically from the name. The same name always gets the same
 * colour, so a re-render never makes it jump. */
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
  // High lightness, low chroma in oklch = pastel, in the same colour space as the project's tone
  // tokens (tokens.css).
  return `oklch(0.88 0.06 ${hue})`;
}
