import { describe, expect, it } from "vitest";
import {
  BRIDGE_ERRORS,
  BRIDGE_METHODS,
  BridgeError,
  HUB_METHODS,
  JSONRPC_ERRORS,
  toJsonRpcError,
} from "../src/bridge.js";

describe("bridge errors", () => {
  it("pins every omnis error code from A2 §3.4", () => {
    expect(BRIDGE_ERRORS).toEqual({
      SESSION_NOT_FOUND: -32001,
      RUNTIME_UNAVAILABLE: -32002,
      CAPABILITY_UNSUPPORTED: -32003,
      TURN_ALREADY_ACTIVE: -32004,
      PATH_NOT_ALLOWED: -32005,
      APPROVAL_REQUIRED: -32006,
      TURN_TIMEOUT: -32007,
      TURN_CANCELLED: -32008,
      RUNTIME_RATE_LIMITED: -32009,
      VERSION_UNSUPPORTED: -32010,
      AUTH_FAILED: -32011,
      BUDGET_EXCEEDED: -32012,
    });
  });

  it("lists exactly the methods each side may send", () => {
    expect(HUB_METHODS).toContain("delegate.run");
    expect(HUB_METHODS).toContain("ingest.scan");
    expect(BRIDGE_METHODS).toContain("approval.requested");
    expect(BRIDGE_METHODS).not.toContain("turn.start");
  });

  it("keeps name identical to the class name", () => {
    const e = new BridgeError(BRIDGE_ERRORS.PATH_NOT_ALLOWED, "cwd outside allowed_roots");
    expect(e.name).toBe("BridgeError");
    expect(e).toBeInstanceOf(Error);
  });

  it("serialises a BridgeError and folds anything else into -32603", () => {
    const withData = new BridgeError(BRIDGE_ERRORS.VERSION_UNSUPPORTED, "bad version", {
      supported: ["2026-09-20"],
    });
    expect(toJsonRpcError(withData)).toEqual({
      code: -32010,
      message: "bad version",
      data: { supported: ["2026-09-20"] },
    });
    expect(toJsonRpcError(new TypeError("boom"))).toEqual({
      code: JSONRPC_ERRORS.INTERNAL,
      message: "boom",
    });
  });
});
