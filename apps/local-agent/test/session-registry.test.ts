import { mkdtempSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BridgeError } from "@omnis/protocol";
import { describe, expect, it } from "vitest";
import { assertPathAllowed } from "../src/paths.js";
import { SessionRegistry } from "../src/session-registry.js";

const KEY = "agent:codex:mini:proj-omnis";
const newSession = () => ({
  session_key: KEY, runtime: "codex" as const, runtime_id: "7f1f0c6a-1b9e-4c0b-9a6f-2c3d4e5f6071",
  cwd: "/tmp", purpose: "proj:omnis", origin: "human" as const,
  permission_profile: "trusted" as const, opened_at: "2026-09-20T00:00:00.000Z",
});

describe("assertPathAllowed", () => {
  it("resolves symlinks before checking (A2 §7.2)", () => {
    const root = mkdtempSync(join(tmpdir(), "omnis-root-"));
    const outside = mkdtempSync(join(tmpdir(), "omnis-out-"));
    mkdirSync(join(root, "ok"));
    symlinkSync(outside, join(root, "escape"));
    expect(assertPathAllowed(join(root, "ok"), [root])).toContain("/ok");
    expect(() => assertPathAllowed(join(root, "escape"), [root])).toThrow(BridgeError);
  });

  it("throws -32005 for a cwd outside every allowed root", () => {
    try {
      assertPathAllowed("/etc", ["/tmp"]);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as BridgeError).code).toBe(-32005);
    }
  });
});

describe("SessionRegistry", () => {
  it("keeps session_key stable while session_id rotates (A2-D1)", () => {
    const reg = new SessionRegistry();
    reg.create(newSession());
    reg.bindSessionId(KEY, "thread_abc");
    reg.bindSessionId(KEY, "thread_def");
    expect(reg.require(KEY).session_key).toBe(KEY);
    expect(reg.require(KEY).session_id).toBe("thread_def");
  });

  it("starts a session with session_id=null and state=idle", () => {
    const reg = new SessionRegistry();
    const rec = reg.create(newSession());
    expect(rec.session_id).toBeNull();
    expect(rec.state).toBe("idle");
  });

  it("is idempotent on re-create for the same key", () => {
    const reg = new SessionRegistry();
    reg.create(newSession());
    reg.bindSessionId(KEY, "thread_abc");
    reg.create(newSession());
    expect(reg.list()).toHaveLength(1);
    expect(reg.require(KEY).session_id).toBe("thread_abc");
  });

  it("answers -32001 for an unknown key", () => {
    const reg = new SessionRegistry();
    try {
      reg.require("agent:codex:mini:nope");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as BridgeError).code).toBe(-32001);
    }
  });
});
