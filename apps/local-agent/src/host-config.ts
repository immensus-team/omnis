import type { HostId, RuntimeKind } from "@omnis/protocol";
import { HOST_DEFAULTS } from "./config.js";

/** Phase A에 어댑터가 존재하는 런타임. hermes(Phase B)와 omnis(어댑터 없음)는 빠진다. */
export const PHASE_A_RUNTIMES: readonly RuntimeKind[] = ["claude_code", "codex", "claude_ds"];

export interface HostProfile {
  host: HostId;
  hub_url: string;
  token_keychain_item: string;
  exposedRuntimes: RuntimeKind[];
  maxActiveTurns: number;
}

export const HOST_PROFILES: Record<HostId, HostProfile> = {
  mini: {
    host: "mini",
    ...HOST_DEFAULTS.mini,
    exposedRuntimes: ["codex", "hermes"],
    maxActiveTurns: 4,
  },
  macbook: {
    host: "macbook",
    ...HOST_DEFAULTS.macbook,
    exposedRuntimes: ["claude_code", "codex", "claude_ds", "hermes"],
    maxActiveTurns: 4,
  },
};

export function hostProfile(host: HostId): HostProfile {
  return HOST_PROFILES[host];
}

/** 이 호스트가 Phase A에 실제로 등록하는 런타임. */
export function phaseARuntimesFor(host: HostId): RuntimeKind[] {
  return HOST_PROFILES[host].exposedRuntimes.filter((r) => PHASE_A_RUNTIMES.includes(r));
}
