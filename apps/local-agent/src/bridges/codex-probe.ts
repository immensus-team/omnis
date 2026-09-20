import type { RuntimeCapabilities, RuntimeState } from "@omnis/protocol";

/** A2-D6. 핀 해제는 계약 테스트 전량 통과 시에만, 사람이 한다. */
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
    // 세션은 계속 뜨지만 허브가 위임 대상 후보에서 뺄 수 있게 플래그만 싣는다.
    capabilities: drifted
      ? { ...CODEX_CAPABILITIES, features: ["version_mismatch"] }
      : CODEX_CAPABILITIES,
  };
}
