import { describe, expect, it } from "vitest";
import { CODEX_PINNED_VERSION, probeCodexVersion } from "../src/bridges/codex-probe.js";

describe("probeCodexVersion (A2-D6)", () => {
  it("pins rust-v0.155.1", () => {
    expect(CODEX_PINNED_VERSION).toBe("rust-v0.155.1");
  });

  it("stays online on an exact pin match", () => {
    const r = probeCodexVersion("codex-cli rust-v0.155.1");
    expect(r.state).toBe("online");
    expect(r.capabilities.features).not.toContain("version_mismatch");
  });

  it("degrades and flags a drifted version instead of refusing to start", () => {
    const r = probeCodexVersion("codex-cli rust-v0.156.0-alpha.3");
    expect(r.state).toBe("degraded");
    expect(r.capabilities.features).toContain("version_mismatch");
    expect(r.version).toBe("codex rust-v0.156.0-alpha.3");
  });

  it("reports the capabilities A2 §4.2 verified for app-server", () => {
    const c = probeCodexVersion("codex-cli rust-v0.155.1").capabilities;
    expect(c.reasoning_stream).toBe(true);
    expect(c.approvals).toBe("native");
    expect(c.tool_calls).toBe(true);
  });
});
