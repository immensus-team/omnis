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
 * profile → --permission-mode 매핑(A2 §7.1, 계약 §8).
 * claude 2.1.274 실측 리터럴은 acceptEdits|auto|bypassPermissions|manual|dontAsk|plan 6종뿐이고
 * 'default'라는 값은 존재하지 않는다(tools/spikes/_probes/2026-09-20-cli-probes.md §3).
 * 게이트 ⑫(S-A2-2) PASS로 이 표는 확정이고, 불변식도 그대로다:
 * bypassPermissions는 trusted + origin='human'에서만 나온다.
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
   * `--bare`를 켤지. 미지정이면 A2-D11의 보수값(비human origin = bare).
   * `--bare`는 인증 경로를 ANTHROPIC_API_KEY / apiKeyHelper로 한정하고 OAuth·Keychain을 읽지 않으며,
   * 게이트 ⑪ 실측으로는 `--settings`의 hook 선언과 `--permission-mode`까지 무시한다.
   * 런타임별 실행 모드는 ClaudeAdapterConfig가 정한다(마스터 §19 Q13) — 이 fallback은
   * buildClaudeArgs를 직접 부르는 쪽의 보수 기본값일 뿐이다.
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
  if (o.bare ?? o.origin !== "human") args.push("--bare"); // A2-D11 기본값, 어댑터가 뒤집는다
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
   * TOML `[[runtime]]`의 `bare`가 여기로 온다. 미지정이면 계약 §8 / 마스터 §19 Q13의 런타임별 기본값:
   * claude_code=false(구독 인증 + `--settings` omnis hook이 발동하는 유일한 모드),
   * claude_ds=true(API 키 전용이라 --bare가 자연스러운 모드).
   */
  bare?: boolean;
  env?: NodeJS.ProcessEnv;
  spawnFn?: typeof spawn;
}

/** A2-D5: 턴당 서브프로세스. 상주시키지 않는다. A2-D8: claude-ds는 이 클래스의 설정 변형이다. */
export class ClaudeCodeAdapter implements RuntimeAdapter {
  readonly kind: RuntimeKind;
  constructor(private readonly cfg: ClaudeAdapterConfig) {
    this.kind = cfg.kind;
  }

  async probe(): Promise<{ version: string; capabilities: RuntimeCapabilities }> {
    const line = await this.#capture(["--version"]);
    return parseClaudeCapabilities(line);
  }

  async startTurn(s: SessionRecord, input: TurnInput, sink: EventSink): Promise<TurnHandle> {
    const args = buildClaudeArgs({
      prompt: input.text,
      model: this.cfg.defaultModel,
      profile: s.permission_profile,
      origin: s.origin,
      sessionId: s.session_id,
      bare: this.cfg.bare ?? this.cfg.kind === "claude_ds",
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

    const state = newStreamJsonState();
    const debounced = createDurableDebouncer((e) => {
      if (e.method === "turn.item.started") sink.itemStarted(e.params);
      else if (e.method === "turn.item.completed") sink.itemCompleted(e.params);
      else sink.turnCompleted(e.params);
    });

    createInterface({ input: child.stdout }).on("line", (line) => {
      sink.raw(line); // cold 티어
      let ev: unknown;
      try {
        ev = JSON.parse(line);
      } catch {
        return; // 미지 형식도 파서를 죽이지 않는다
      }
      for (const emit of mapStreamJsonEvent(ev, {
        session_key: s.session_key,
        turn_id: turnId,
        state,
      })) {
        if (emit.method === "turn.item.delta")
          sink.delta(emit.params); // ephemeral, 저장 안 함
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
    /* 턴당 프로세스라 닫을 상주 자원이 없다 */
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

/** A2 §4.3: 바이너리·모델 alias·키 출처만 다르다. 비용은 result.cost_usd를 믿지 않는다. */
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
    bare: true, // API 키로만 돌므로 --bare가 자연스러운 모드(프로브 §2, 마스터 §19 Q13 ②).
    env: { DEEPSEEK_API_KEY: cfg.apiKey },
    ...(cfg.spawnFn === undefined ? {} : { spawnFn: cfg.spawnFn }),
  });
}
