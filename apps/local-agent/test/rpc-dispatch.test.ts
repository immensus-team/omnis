import { withMeta } from "@omnis/protocol";
import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../src/logger.js";
import { createDispatcher } from "../src/rpc-dispatch.js";
import { SessionRegistry } from "../src/session-registry.js";

const spawn = vi.fn();
const adapter = {
  kind: "codex" as const,
  probe: async () => ({
    version: "codex rust-v0.155.1",
    capabilities: {
      resume: true,
      cross_project_resume: true,
      stream_deltas: true,
      reasoning_stream: true,
      tool_calls: true,
      approvals: "native" as const,
      cancel: true,
      models: [],
      features: [],
    },
  }),
  startTurn: async () => {
    spawn();
    return { turn_id: "t1", cancel: async () => true };
  },
  cancel: async () => true,
  close: async () => {},
};

const dispatch = () =>
  createDispatcher({
    registry: new SessionRegistry(),
    adapters: new Map([["codex", adapter]]),
    allowedRoots: new Map([["codex", ["/tmp"]]]),
    runtimeIds: new Map([["codex", "7f1f0c6a-1b9e-4c0b-9a6f-2c3d4e5f6071"]]),
    logger: createLogger("@omnis/local-agent", { sink: () => {} }),
    host: "mini",
  });

describe("rpc dispatcher", () => {
  it("rejects a request whose _meta carries an unknown version", async () => {
    await expect(
      dispatch()("session.create", { _meta: { "ai.omnis/protocolVersion": "1999-01-01" } }),
    ).rejects.toMatchObject({ code: -32010 });
  });

  it("answers -32601 for ingest.* in Phase A", async () => {
    await expect(dispatch()("ingest.scan", withMeta({ roots: ["/tmp"] }))).rejects.toMatchObject({
      code: -32601,
    });
  });

  it("answers -32601 for an entirely unknown method", async () => {
    await expect(dispatch()("turn.explode", withMeta({}))).rejects.toMatchObject({ code: -32601 });
  });

  it("rejects delegate.run without an approval_id and never spawns (A2 §5.1)", async () => {
    spawn.mockClear();
    await expect(
      dispatch()(
        "delegate.run",
        withMeta({
          target: { runtime: "codex", host: "mini", cwd: "/tmp" },
          goal: "do it",
          inputs: [],
          verify: "true",
          output: "report",
          timeout_ms: 900000,
        }),
      ),
    ).rejects.toMatchObject({ code: -32006 });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("creates a session slot without starting a process", async () => {
    const d = dispatch();
    const res = await d(
      "session.create",
      withMeta({
        session_key: "agent:codex:mini:proj-omnis",
        runtime: "codex",
        cwd: "/tmp",
        purpose: "proj:omnis",
        origin: "human",
        permission_profile: "trusted",
      }),
    );
    expect(res).toMatchObject({ session_id: null });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("refuses a cwd outside allowed_roots with -32005 and no spawn", async () => {
    spawn.mockClear();
    await expect(
      dispatch()(
        "session.create",
        withMeta({
          session_key: "agent:codex:mini:escape",
          runtime: "codex",
          cwd: "/etc",
          purpose: "proj:escape",
          origin: "human",
          permission_profile: "trusted",
        }),
      ),
    ).rejects.toMatchObject({ code: -32005 });
    expect(spawn).not.toHaveBeenCalled();
  });
});
