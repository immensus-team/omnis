import type { HostId, RuntimeKind } from "@omnis/protocol";
import { HOST_DEFAULTS } from "./config.js";

/** The runtimes that have an adapter in Phase A. hermes (Phase B) and omnis (no adapter) are left out. */
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

/** The runtimes this host actually registers in Phase A. */
export function phaseARuntimesFor(host: HostId): RuntimeKind[] {
  return HOST_PROFILES[host].exposedRuntimes.filter((r) => PHASE_A_RUNTIMES.includes(r));
}
