import { describe, expect, it } from "vitest";
import {
  AgentRuntime,
  META_KEYS,
  PROTOCOL_VERSION,
  PermissionProfile,
  RuntimeCapabilities,
} from "../src/bridge.js";

describe("bridge core types", () => {
  it("pins the protocol version and meta keys", () => {
    expect(PROTOCOL_VERSION).toBe("2026-09-20");
    expect(META_KEYS.protocolVersion).toBe("ai.omnis/protocolVersion");
    expect(META_KEYS.traceId).toBe("ai.omnis/traceId");
    expect(META_KEYS.origin).toBe("ai.omnis/origin");
  });

  it("passes unknown runtime feature strings through untouched", () => {
    const caps = RuntimeCapabilities.parse({
      resume: true,
      cross_project_resume: false,
      stream_deltas: true,
      reasoning_stream: false,
      tool_calls: true,
      approvals: "hook",
      cancel: true,
      models: ["sonnet", "haiku"],
      features: ["interrupt_receipt_v1", "some_future_flag"],
    });
    expect(caps.features).toEqual(["interrupt_receipt_v1", "some_future_flag"]);
  });

  it("allows binary_path=null and allowed_roots=[] for http transport", () => {
    const rt = AgentRuntime.parse({
      id: "6d0f4f1e-3d52-4b8a-9c0a-2f4b1f0a7c11",
      runtime: "hermes",
      host: "mini",
      version: "hermes 0.9.0",
      capabilities: {
        resume: true,
        cross_project_resume: false,
        stream_deltas: true,
        reasoning_stream: false,
        tool_calls: true,
        approvals: "none",
        cancel: false,
        models: [],
        features: [],
      },
      transport: "http",
      binary_path: null,
      allowed_roots: [],
      base_url: "http://127.0.0.1:8642",
      state: "online",
      last_health_at: "2026-09-20T01:02:03.000Z",
    });
    expect(rt.transport).toBe("http");
  });

  it("rejects an unknown permission profile", () => {
    expect(() => PermissionProfile.parse("root")).toThrow();
  });
});
