import type { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { BridgeError } from "@omnis/protocol";
import { describe, expect, it } from "vitest";
import {
  ClaudeCodeAdapter,
  PERMISSION_MODE,
  buildClaudeArgs,
  createClaudeDsAdapter,
  parseClaudeCapabilities,
  permissionModeFor,
} from "../src/bridges/claude-code.js";
import type { EventSink } from "../src/rpc-dispatch.js";
import type { SessionRecord } from "../src/session-registry.js";

describe("buildClaudeArgs (A2-D5)", () => {
  it("always asks for stream-json with verbose and partial messages", () => {
    const a = buildClaudeArgs({
      prompt: "hi",
      model: "sonnet",
      profile: "workspace",
      origin: "delegation",
      sessionId: null,
    });
    expect(a.slice(0, 7)).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--model",
      "sonnet",
    ]);
    expect(a).toContain("hi");
  });

  it("adds --resume only when a session_id exists", () => {
    expect(
      buildClaudeArgs({
        prompt: "x",
        model: "sonnet",
        profile: "trusted",
        origin: "human",
        sessionId: null,
      }),
    ).not.toContain("--resume");
    const resumed = buildClaudeArgs({
      prompt: "x",
      model: "sonnet",
      profile: "trusted",
      origin: "human",
      sessionId: "s-42",
    });
    expect(resumed[resumed.indexOf("--resume") + 1]).toBe("s-42");
  });

  it("falls back to --bare on every non-human origin when nothing decided it (A2-D11)", () => {
    expect(
      buildClaudeArgs({
        prompt: "x",
        model: "sonnet",
        profile: "workspace",
        origin: "delegation",
        sessionId: null,
      }),
    ).toContain("--bare");
    expect(
      buildClaudeArgs({
        prompt: "x",
        model: "sonnet",
        profile: "trusted",
        origin: "human",
        sessionId: null,
      }),
    ).not.toContain("--bare");
  });

  it("lets the bare flag override the origin default in both directions (Gate ⑪ undecided)", () => {
    // if Gate ⑪ settles on running delegation under subscription auth, bare:false
    expect(
      buildClaudeArgs({
        prompt: "x",
        model: "sonnet",
        profile: "workspace",
        origin: "delegation",
        sessionId: null,
        bare: false,
      }),
    ).not.toContain("--bare");
    // if it settles on isolating even human turns behind an API key, bare:true
    expect(
      buildClaudeArgs({
        prompt: "x",
        model: "sonnet",
        profile: "trusted",
        origin: "human",
        sessionId: null,
        bare: true,
      }),
    ).toContain("--bare");
  });

  it("adds --strict-mcp-config for the claude-ds variant", () => {
    expect(
      buildClaudeArgs({
        prompt: "x",
        model: "deepseek-flash",
        profile: "workspace",
        origin: "delegation",
        sessionId: null,
        strictMcpConfig: true,
      }),
    ).toContain("--strict-mcp-config");
  });
});

describe("permissionModeFor (A2 §7.1)", () => {
  const CLI_MODES = ["acceptEdits", "auto", "bypassPermissions", "manual", "dontAsk", "plan"];

  it("maps each profile to a literal the CLI actually accepts", () => {
    expect(permissionModeFor("observe", "job")).toBe("plan");
    expect(permissionModeFor("workspace", "delegation")).toBe("manual");
    expect(permissionModeFor("trusted", "human")).toBe("bypassPermissions");
    for (const mode of Object.values(PERMISSION_MODE)) expect(CLI_MODES).toContain(mode);
    expect(Object.values(PERMISSION_MODE)).not.toContain("default"); // a value claude 2.1.274 does not have
  });

  it("never yields bypassPermissions outside trusted+human", () => {
    expect(permissionModeFor("trusted", "human")).toBe("bypassPermissions");
    for (const [p, o] of [
      ["workspace", "delegation"],
      ["observe", "job"],
      ["workspace", "human"],
    ] as const) {
      expect(permissionModeFor(p, o)).not.toBe("bypassPermissions");
    }
  });

  it("refuses a trusted profile that did not come from a human", () => {
    expect(() => permissionModeFor("trusted", "delegation")).toThrow(BridgeError);
  });
});

describe("parseClaudeCapabilities", () => {
  it("turns on cross_project_resume from 2.1.223 upwards", () => {
    expect(parseClaudeCapabilities("2.1.231 (Claude Code)").capabilities.cross_project_resume).toBe(
      true,
    );
    expect(parseClaudeCapabilities("2.1.205 (Claude Code)").capabilities.cross_project_resume).toBe(
      false,
    );
  });

  it("always reports hook approvals and delta streaming", () => {
    const c = parseClaudeCapabilities("2.1.231 (Claude Code)").capabilities;
    expect(c.approvals).toBe("hook");
    expect(c.stream_deltas).toBe(true);
    expect(c.reasoning_stream).toBe(false);
  });
});

// --- adapter default execution mode (master §19 Q13 / contract §8) ---

function fakeSpawn(captured: string[][]): typeof spawn {
  return ((_bin: string, args: readonly string[]) => {
    captured.push([...args]);
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
    child.stdout = Readable.from([]);
    child.stderr = Readable.from([]);
    child.kill = (): boolean => true;
    return child;
  }) as unknown as typeof spawn;
}

function record(
  profile: SessionRecord["permission_profile"],
  origin: SessionRecord["origin"],
): SessionRecord {
  return {
    session_key: "k1",
    session_id: null,
    runtime: "claude_code",
    runtime_id: "r1",
    cwd: "/tmp",
    purpose: "test",
    origin,
    permission_profile: profile,
    state: "idle",
    opened_at: new Date().toISOString(),
    last_turn_at: null,
  };
}

const noopSink = (): EventSink => ({
  itemStarted: () => {},
  delta: () => {},
  itemCompleted: () => {},
  turnStarted: () => {},
  turnCompleted: () => {},
  approval: async () => ({ approval_id: "a", decision: "deny" }) as never,
  raw: () => {},
});

describe("ClaudeCodeAdapter run mode defaults", () => {
  it("runs claude_code delegation non-bare (subscription auth + hooks) and claude-ds bare", async () => {
    const captured: string[][] = [];
    const spawnFn = fakeSpawn(captured);

    const cc = new ClaudeCodeAdapter({
      kind: "claude_code",
      binary: "claude",
      defaultModel: "sonnet",
      spawnFn,
    });
    await cc.startTurn(record("workspace", "delegation"), { text: "hi" }, noopSink());
    expect(captured[0]).not.toContain("--bare");
    expect(captured[0]).toContain("manual");

    const ds = createClaudeDsAdapter({ binary: "claude-ds", apiKey: "k", spawnFn });
    await ds.startTurn(record("observe", "delegation"), { text: "hi" }, noopSink());
    expect(captured[1]).toContain("--bare");
    expect(captured[1]).toContain("--strict-mcp-config");
  });

  it("still honours an explicit bare override from TOML", async () => {
    const captured: string[][] = [];
    const cc = new ClaudeCodeAdapter({
      kind: "claude_code",
      binary: "claude",
      defaultModel: "sonnet",
      bare: true,
      spawnFn: fakeSpawn(captured),
    });
    await cc.startTurn(record("workspace", "delegation"), { text: "hi" }, noopSink());
    expect(captured[0]).toContain("--bare");
  });
});

// --- the approval surface follows the execution mode (Gate ⑪ FAIL mode a) ---

function fakeVersionSpawn(version: string): typeof spawn {
  return ((_bin: string, _args: readonly string[]) => {
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
    const stdout = Readable.from([Buffer.from(`${version}\n`)]);
    stdout.on("end", () => child.emit("close", 0));
    child.stdout = stdout;
    child.stderr = null;
    child.kill = (): boolean => true;
    return child;
  }) as unknown as typeof spawn;
}

describe("probe reports the approval surface the run mode actually has", () => {
  it("claude-ds (--bare) has no approval surface, non-bare claude_code keeps hooks", async () => {
    const ds = createClaudeDsAdapter({
      binary: "claude-ds",
      apiKey: "k",
      spawnFn: fakeVersionSpawn("2.1.274 (Claude Code)"),
    });
    // --bare ignores both the --settings hook declaration and --permission-mode → no approval path
    expect((await ds.probe()).capabilities.approvals).toBe("none");

    const cc = new ClaudeCodeAdapter({
      kind: "claude_code",
      binary: "claude",
      defaultModel: "sonnet",
      spawnFn: fakeVersionSpawn("2.1.274 (Claude Code)"),
    });
    expect((await cc.probe()).capabilities.approvals).toBe("hook");

    // the parser itself is unchanged (plan contract)
    expect(parseClaudeCapabilities("2.1.274 (Claude Code)").capabilities.approvals).toBe("hook");
  });
});

describe("startTurn drains the child's stderr", () => {
  it("forwards stderr to the cold tier instead of letting the pipe fill up", async () => {
    const stderr = Readable.from([Buffer.from("warn: something\n")]);
    const spawnFn = ((_bin: string, _args: readonly string[]) => {
      const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
      child.stdout = Readable.from([]);
      child.stderr = stderr;
      child.kill = (): boolean => true;
      return child;
    }) as unknown as typeof spawn;

    const rawLines: string[] = [];
    const sink: EventSink = { ...noopSink(), raw: (l) => rawLines.push(l) };
    const adapter = new ClaudeCodeAdapter({
      kind: "claude_code",
      binary: "claude",
      defaultModel: "sonnet",
      spawnFn,
    });
    await adapter.startTurn(record("workspace", "delegation"), { text: "hi" }, sink);
    await new Promise<void>((r) => stderr.on("end", () => setImmediate(r)));

    expect(rawLines).toContain("[stderr] warn: something");
    expect(stderr.readableEnded).toBe(true);
  });
});
