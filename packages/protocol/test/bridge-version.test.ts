import { describe, expect, it } from "vitest";
import { BridgeError, PROTOCOL_VERSION, assertProtocolVersion, withMeta } from "../src/bridge.js";

describe("per-request version negotiation", () => {
  it("stamps _meta with the protocol version and keeps the original params", () => {
    const p = withMeta(
      { session_key: "agent:codex:mini:proj-omnis" },
      { traceId: "01JBQ0000000000000000000", origin: "delegation" },
    );
    expect(p.session_key).toBe("agent:codex:mini:proj-omnis");
    expect(p._meta["ai.omnis/protocolVersion"]).toBe(PROTOCOL_VERSION);
    expect(p._meta["ai.omnis/traceId"]).toBe("01JBQ0000000000000000000");
    expect(p._meta["ai.omnis/origin"]).toBe("delegation");
  });

  it("omits optional meta keys entirely when not supplied", () => {
    const p = withMeta({ a: 1 });
    expect(Object.keys(p._meta)).toEqual(["ai.omnis/protocolVersion"]);
  });

  it("accepts a request carrying the supported version", () => {
    expect(() => assertProtocolVersion(withMeta({ a: 1 }))).not.toThrow();
  });

  it("rejects only the offending request with -32010 and a supported list", () => {
    try {
      assertProtocolVersion({ _meta: { "ai.omnis/protocolVersion": "2025-01-01" } });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(BridgeError);
      expect((e as BridgeError).code).toBe(-32010);
      expect((e as BridgeError).data).toEqual({ supported: [PROTOCOL_VERSION] });
    }
  });

  it("treats a missing _meta as unsupported", () => {
    expect(() => assertProtocolVersion({ session_key: "x" })).toThrow(BridgeError);
  });
});
