import type { RuntimeCapabilities, RuntimeState } from "@omnis/protocol";

/** A2-D6. Unpinning happens only once the full contract-test suite passes, and a human does it. */
export const CODEX_PINNED_VERSION = "rust-v0.155.1";

export const CODEX_CAPABILITIES: RuntimeCapabilities = {
  resume: true,
  cross_project_resume: true,
  stream_deltas: true,
  reasoning_stream: true,
  tool_calls: true,
  approvals: "native",
  cancel: true,
  models: [],
  features: [],
};

export function probeCodexVersion(
  versionLine: string,
  pinned: string = CODEX_PINNED_VERSION,
): { version: string; state: RuntimeState; capabilities: RuntimeCapabilities } {
  const found = /rust-v[0-9][^\s]*/.exec(versionLine)?.[0] ?? "unknown";
  const drifted = found !== pinned;
  return {
    version: `codex ${found}`,
    state: drifted ? "degraded" : "online",
    // The session still starts, but only a flag is carried so the hub can drop it from the delegation candidates.
    capabilities: drifted
      ? { ...CODEX_CAPABILITIES, features: ["version_mismatch"] }
      : CODEX_CAPABILITIES,
  };
}
