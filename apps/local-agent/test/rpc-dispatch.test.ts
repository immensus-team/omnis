import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { type Adapter, signApproval, withMeta } from "@omnis/protocol";
import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../src/logger.js";
import { createDispatcher } from "../src/rpc-dispatch.js";
import { SessionRegistry } from "../src/session-registry.js";

const TOKEN = "test-bridge-token";
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

const dispatch = (captureAdapterFor?: (channel: string) => Adapter | undefined) =>
  createDispatcher({
    registry: new SessionRegistry(),
    adapters: new Map([["codex", adapter]]),
    allowedRoots: new Map([["codex", ["/tmp"]]]),
    runtimeIds: new Map([["codex", "7f1f0c6a-1b9e-4c0b-9a6f-2c3d4e5f6071"]]),
    logger: createLogger("@omnis/local-agent", { sink: () => {} }),
    host: "mini",
    token: TOKEN,
    ...(captureAdapterFor === undefined ? {} : { captureAdapterFor }),
  });

/** capture.send only reaches these three members, and the contract under test is that it reaches
 *  them at all (handleCaptureSend's own behaviour is capture.test.ts). */
const captureStub = (send: Adapter["send"]): Adapter =>
  ({ id: "capture", channel: "kakaotalk", send }) as unknown as Adapter;

describe("rpc dispatcher", () => {
  it("rejects a request whose _meta carries an unknown version", async () => {
    await expect(
      dispatch()("session.create", { _meta: { "ai.omnis/protocolVersion": "1999-01-01" } }),
    ).rejects.toMatchObject({ code: -32010 });
  });

  // US-B10: the Phase A gate (-32601) is gone — ingest.scan now goes to the real handler.
  it("routes ingest.scan to a real result instead of the Phase A gate", async () => {
    // dispatch()'s allowedRoots are fixed at codex → ["/tmp"], so the fixture is dug directly under /tmp
    // (on macOS os.tmpdir() is $TMPDIR, not /tmp, so it falls outside the allowlist).
    const root = await mkdtemp(join("/tmp", "omnis-rpc-ingest-"));
    const res = (await dispatch()("ingest.scan", withMeta({ roots: [root] }))) as {
      files: unknown[];
      truncated: boolean;
    };
    expect(res.files).toEqual([]);
    expect(res.truncated).toBe(false);
  });

  it("answers -32601 for an entirely unknown method", async () => {
    await expect(dispatch()("turn.explode", withMeta({}))).rejects.toMatchObject({ code: -32601 });
  });

  // US-C02: the Phase A gate (-32003) is gone. delegate.run reaches runDelegation, which checks the hub's
  // HMAC first (the execution half lives in delegate.test.ts) — an unsigned brief still never spawns.
  const brief = () => ({
    approval_id: "3c9e5a11-6d0b-4f2e-8a71-5b3c9d0e1f22",
    target: { runtime: "codex", host: "mini", cwd: "/tmp" },
    goal: "do it",
    inputs: [],
    verify: "true",
    output: "report",
    timeout_ms: 900000,
  });

  it("rejects delegate.run without a hub signature this bridge can reproduce, and never spawns (A2 §5.1)", async () => {
    spawn.mockClear();
    const b = brief();
    const unsigned = { brief: b };
    // A signature made with another token is the "forged approval" case -32006 exists for.
    const forged = { brief: b, sig: signApproval("another-token", b.approval_id, b) };
    for (const params of [unsigned, forged]) {
      await expect(dispatch()("delegate.run", withMeta(params))).rejects.toMatchObject({
        code: -32006,
      });
    }
    expect(spawn).not.toHaveBeenCalled();
  });

  it("routes a signed brief to the path gate: a cwd outside allowed_roots is -32005, not the old -32003", async () => {
    spawn.mockClear();
    const b = { ...brief(), target: { runtime: "codex", host: "mini", cwd: "/etc" } };
    await expect(
      dispatch()(
        "delegate.run",
        withMeta({ brief: b, sig: signApproval(TOKEN, b.approval_id, b) }),
      ),
    ).rejects.toMatchObject({ code: -32005 });
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

  // US-C12: the dispatcher is the route the hub actually uses, so a signed capture.send has to come
  // out the far end at the channel's adapter. handleCaptureSend's own rules live in capture.test.ts.
  const CAPTURE_APPROVAL = "11111111-1111-4111-8111-111111111111";

  it("routes a signed capture.send to the channel's capture adapter (US-C12)", async () => {
    const send = vi.fn(() =>
      Promise.resolve({ externalId: "dry-run:chat-1", sentAt: "2026-09-22T09:00:00.000Z" }),
    );
    const payload = {
      channel: "kakaotalk",
      thread_external_id: "chat-1",
      text: "on my way",
      dry_run: true,
    };
    const signed = withMeta({
      ...payload,
      approval_id: CAPTURE_APPROVAL,
      sig: signApproval(TOKEN, CAPTURE_APPROVAL, payload),
    });

    // No [[capture]] block on this host: the dispatcher's adapterFor default is what answers -32002.
    await expect(dispatch()("capture.send", signed)).rejects.toMatchObject({ code: -32002 });

    const d = dispatch((channel) => (channel === "kakaotalk" ? captureStub(send) : undefined));
    expect(await d("capture.send", signed)).toEqual({ preview: "on my way", sent: false });
    expect(send).toHaveBeenCalledWith(
      { accountId: "kakaotalk", externalId: "chat-1" },
      { text: "on my way", meta: { approval_id: CAPTURE_APPROVAL, dry_run: true } },
    );
  });
});
