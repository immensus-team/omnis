import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import {
  BRIDGE_ERRORS,
  BridgeError,
  JSONRPC_ERRORS,
  type PermissionProfile,
  type RuntimeCapabilities,
  type RuntimeKind,
  type SessionOrigin,
  type TurnInput,
} from "@omnis/protocol";
import type { EventSink, RuntimeAdapter, TurnHandle } from "../rpc-dispatch.js";
import type { SessionRecord } from "../session-registry.js";
import { createDurableDebouncer } from "./durable-debounce.js";
import { mapStreamJsonEvent, newStreamJsonState } from "./stream-json.js";

/**
 * profile → --permission-mode mapping (A2 §7.1, contract §8).
 * the literals measured on claude 2.1.274 are only these six — acceptEdits|auto|bypassPermissions|manual|dontAsk|plan — and
 * the value 'default' does not exist (tools/spikes/_probes/2026-09-20-cli-probes.md §3).
 * Gate ⑫ (S-A2-2) passed, so this table is settled and its invariants still hold:
 * bypassPermissions is only produced for trusted + origin='human'.
 */
export const PERMISSION_MODE: Record<PermissionProfile, string> = {
  observe: "plan",
  workspace: "manual",
  trusted: "bypassPermissions",
};

export function permissionModeFor(profile: PermissionProfile, origin: SessionOrigin): string {
  if (profile === "trusted" && origin !== "human") {
    throw new BridgeError(
      JSONRPC_ERRORS.INVALID_PARAMS,
      "trusted profile requires origin='human' (A2 §7.1)",
    );
  }
  return PERMISSION_MODE[profile];
}

export interface ClaudeArgsOpts {
  prompt: string;
  model: string;
  profile: PermissionProfile;
  origin: SessionOrigin;
  sessionId: string | null;
  strictMcpConfig?: boolean;
  /**
   * Whether to switch on `--bare`. When unset, the conservative A2-D11 default (non-human origin = bare).
   * `--bare` narrows the auth path to ANTHROPIC_API_KEY / apiKeyHelper, reads neither OAuth nor the Keychain, and
   * as measured under Gate ⑪, ignores even the `--settings` hook declaration and `--permission-mode`.
   * The per-runtime execution mode is decided by ClaudeAdapterConfig (master §19 Q13) — this fallback is
   * only the conservative default for callers that invoke buildClaudeArgs directly.
   */
  bare?: boolean;
}

export function buildClaudeArgs(o: ClaudeArgsOpts): string[] {
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--model",
    o.model,
    "--permission-mode",
    permissionModeFor(o.profile, o.origin),
  ];
  if (o.sessionId !== null) args.push("--resume", o.sessionId);
  if (o.bare ?? o.origin !== "human") args.push("--bare"); // the A2-D11 default; the adapter can flip it
  if (o.strictMcpConfig === true) args.push("--strict-mcp-config"); // A2 §4.3
  args.push(o.prompt);
  return args;
}

export function parseClaudeCapabilities(versionLine: string): {
  version: string;
  capabilities: RuntimeCapabilities;
} {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(versionLine);
  const maj = Number(m?.[1] ?? 0);
  const min = Number(m?.[2] ?? 0);
  const pat = Number(m?.[3] ?? 0);
  const atLeast = (a: number, b: number, c: number): boolean =>
    maj > a || (maj === a && (min > b || (min === b && pat >= c)));
  return {
    version: `claude ${maj}.${min}.${pat}`,
    capabilities: {
      resume: true,
      cross_project_resume: atLeast(2, 1, 223),
      stream_deltas: true,
      reasoning_stream: false,
      tool_calls: true,
      approvals: "hook",
      cancel: true,
      models: ["sonnet", "haiku", "opus"],
      features: [],
    },
  };
}

export interface ClaudeAdapterConfig {
  kind: Extract<RuntimeKind, "claude_code" | "claude_ds">;
  binary: string;
  defaultModel: string;
  strictMcpConfig?: boolean;
  /**
   * The TOML `[[runtime]]` key `bare` lands here. When unset, the per-runtime default from contract §8 / master §19 Q13:
   * claude_code=false (subscription auth — the only mode where the omnis `--settings` hook fires),
   * claude_ds=true (API-key only, where --bare is the natural mode).
   */
  bare?: boolean;
  env?: NodeJS.ProcessEnv;
  spawnFn?: typeof spawn;
}

/** A2-D5: one subprocess per turn, never resident. A2-D8: claude-ds is a configuration variant of this class. */
export class ClaudeCodeAdapter implements RuntimeAdapter {
  readonly kind: RuntimeKind;
  /**
   * Whether this adapter actually runs with `--bare`. probe() and startTurn() must not diverge, so it is
   * computed in exactly one place (contract §8 / master §19 Q13):
   * claude_code=false (subscription auth + the omnis `--settings` hook), claude_ds=true (API-key only).
   */
  readonly #bare: boolean;
  constructor(private readonly cfg: ClaudeAdapterConfig) {
    this.kind = cfg.kind;
    this.#bare = cfg.bare ?? cfg.kind === "claude_ds";
  }

  async probe(): Promise<{ version: string; capabilities: RuntimeCapabilities }> {
    const line = await this.#capture(["--version"]);
    const parsed = parseClaudeCapabilities(line);
    // Gate ⑪ FAIL (mode a): under `--bare`, both the `--settings` hook declaration and `--permission-mode`
    // are ignored outright — there is no approval surface at all. Telling the hub "hook approvals exist"
    // would make it wait for an approval that never comes, so this is recorded to match the execution mode.
    return {
      ...parsed,
      capabilities: { ...parsed.capabilities, approvals: this.#bare ? "none" : "hook" },
    };
  }

  async startTurn(s: SessionRecord, input: TurnInput, sink: EventSink): Promise<TurnHandle> {
    const args = buildClaudeArgs({
      prompt: input.text,
      model: this.cfg.defaultModel,
      profile: s.permission_profile,
      origin: s.origin,
      sessionId: s.session_id,
      bare: this.#bare,
      ...(this.cfg.strictMcpConfig === true ? { strictMcpConfig: true } : {}),
    });
    const turnId = `t-${Date.now().toString(36)}`;
    const child = (this.cfg.spawnFn ?? spawn)(this.cfg.binary, args, {
      cwd: s.cwd,
      env: { ...process.env, ...this.cfg.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (child.stdout === null)
      throw new BridgeError(
        BRIDGE_ERRORS.RUNTIME_UNAVAILABLE,
        `${this.cfg.binary} produced no stdout`,
      );

    // If stderr is opened as a pipe and nobody reads it, then the moment the real binary emits more warnings
    // than the OS pipe buffer (~64KB) the child blocks on write and the turn hangs forever with no events and no timeout.
    // Drain it into the cold tier so the pipe empties (the diagnostics are kept too).
    if (child.stderr !== null && child.stderr !== undefined) {
      createInterface({ input: child.stderr }).on("line", (l) => {
        sink.raw(`[stderr] ${l}`);
      });
    }

    const state = newStreamJsonState();
    const debounced = createDurableDebouncer((e) => {
      if (e.method === "turn.item.started") sink.itemStarted(e.params);
      else if (e.method === "turn.item.completed") sink.itemCompleted(e.params);
      else sink.turnCompleted(e.params);
    });

    createInterface({ input: child.stdout }).on("line", (line) => {
      sink.raw(line); // cold tier
      let ev: unknown;
      try {
        ev = JSON.parse(line);
      } catch {
        return; // an unknown shape must not kill the parser
      }
      for (const emit of mapStreamJsonEvent(ev, {
        session_key: s.session_key,
        turn_id: turnId,
        state,
      })) {
        if (emit.method === "turn.item.delta")
          sink.delta(emit.params); // ephemeral, never stored
        else if (emit.method === "session.registered" || emit.method === "health")
          sink.itemStarted(emit.params);
        else debounced.push({ method: emit.method, params: emit.params });
      }
    });

    return {
      turn_id: turnId,
      cancel: async (): Promise<boolean> => {
        child.kill("SIGTERM");
        return true;
      },
    };
  }

  async cancel(h: TurnHandle, reason: string): Promise<boolean> {
    return await h.cancel(reason);
  }

  async close(): Promise<void> {
    /* one process per turn, so there is no resident resource to close */
  }

  async #capture(args: string[]): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
      const child = (this.cfg.spawnFn ?? spawn)(this.cfg.binary, args, {
        stdio: ["ignore", "pipe", "ignore"],
      });
      let out = "";
      child.stdout?.on("data", (d: Buffer) => {
        out += d.toString("utf8");
      });
      child.on("error", reject);
      child.on("close", () => resolve(out.trim()));
    });
  }
}

/** A2 §4.3: only the binary, model alias and key source differ. Cost does not trust result.cost_usd. */
export function createClaudeDsAdapter(cfg: {
  binary: string;
  apiKey: string;
  model?: string;
  spawnFn?: typeof spawn;
}): ClaudeCodeAdapter {
  return new ClaudeCodeAdapter({
    kind: "claude_ds",
    binary: cfg.binary,
    defaultModel: cfg.model ?? "deepseek-flash",
    strictMcpConfig: true,
    bare: true, // API-key only, so --bare is the natural mode (probe §2, master §19 Q13 ②).
    env: { DEEPSEEK_API_KEY: cfg.apiKey },
    ...(cfg.spawnFn === undefined ? {} : { spawnFn: cfg.spawnFn }),
  });
}
