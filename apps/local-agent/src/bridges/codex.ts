import { spawn } from "node:child_process";
import type {
  BridgeItemKind,
  HumanResponse,
  RuntimeCapabilities,
  RuntimeKind,
  TurnInput,
} from "@omnis/protocol";
import type { EventSink, RuntimeAdapter, TurnHandle } from "../rpc-dispatch.js";
import type { SessionRecord } from "../session-registry.js";
import { AppServerClient } from "./app-server-client.js";
import type { BridgeEmit } from "./stream-json.js";

/** A2 §4.2: 이 목록에 없는 item/started는 kind='tool_call', label=item.type으로 일반화한다. */
export const KNOWN_CODEX_ITEM_TYPES = [
  "agentMessage",
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "dynamicToolCall",
  "collabToolCall",
  "webSearch",
  "imageView",
] as const;

export const REASONING_DELTA_METHODS = new Set([
  "item/plan/delta",
  "item/reasoning/textDelta",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/summaryPartAdded",
]);

export type CodexDecision =
  | "accept"
  | "acceptForSession"
  | "decline"
  | "cancel"
  | "acceptWithExecpolicyAmendment";

export function codexDecisionToResponse(d: CodexDecision): HumanResponse {
  switch (d) {
    case "accept":
      return { decision: "accept" };
    case "acceptForSession":
      return { decision: "accept", decided_args: { session_rules: true } };
    // S-A2-3 전까지 amendment payload 스키마를 모르므로 edit 경로를 UI에 노출하지 않는다.
    default:
      return { decision: "ignore" };
  }
}

interface Ctx {
  session_key: string;
  turn_id: string;
  seq: Map<string, number>;
}

function delta(
  ctx: Ctx,
  itemId: string,
  text: string,
  channel: "output" | "reasoning",
): BridgeEmit {
  const n = ctx.seq.get(itemId) ?? 0;
  ctx.seq.set(itemId, n + 1);
  return {
    method: "turn.item.delta",
    params: {
      session_key: ctx.session_key,
      turn_id: ctx.turn_id,
      item_id: itemId,
      seq: n,
      text,
      channel,
    },
  };
}

function kindOf(type: string): BridgeItemKind {
  return type === "agentMessage" ? "agent_turn" : "tool_call";
}

export function mapAppServerEvent(method: string, params: unknown, ctx: Ctx): BridgeEmit[] {
  const p = (params ?? {}) as Record<string, unknown>;
  const base = { session_key: ctx.session_key, turn_id: ctx.turn_id };

  if (method === "thread.started") {
    return [
      { method: "session.registered", params: { ...base, session_id: String(p.threadId ?? "") } },
    ];
  }
  if (method === "turn.started")
    return [{ method: "turn.started", params: { ...base, at: new Date().toISOString() } }];

  if (REASONING_DELTA_METHODS.has(method)) {
    return [delta(ctx, String(p.itemId ?? "reasoning"), String(p.delta ?? ""), "reasoning")];
  }
  if (method === "item/agentMessage/delta" || method === "item/commandExecution/outputDelta") {
    return [delta(ctx, String(p.itemId ?? "i"), String(p.delta ?? p.chunk ?? ""), "output")];
  }

  if (method === "item/started") {
    const it = (p.item ?? {}) as Record<string, unknown>;
    const type = String(it.type ?? "unknown");
    return [
      {
        method: "turn.item.started",
        params: {
          ...base,
          item_id: String(it.id ?? ""),
          kind: kindOf(type),
          label: type === "agentMessage" ? "assistant" : type,
          meta: { item_type: type },
        },
      },
    ];
  }

  if (method === "item/completed") {
    const it = (p.item ?? {}) as Record<string, unknown>;
    const type = String(it.type ?? "unknown");
    return [
      {
        method: "turn.item.completed",
        params: {
          ...base,
          item_id: String(it.id ?? ""),
          kind: kindOf(type),
          body: String(it.text ?? it.output ?? ""),
          status: it.error === undefined ? "ok" : "failed",
          meta: { item_type: type },
        },
      },
    ];
  }

  if (method === "turn.completed" || method === "turn.failed") {
    const err = p.error as { code?: number; message?: string } | undefined;
    return [
      {
        method: "turn.completed",
        params: {
          ...base,
          status: method === "turn.completed" ? "ok" : "failed",
          usage: { cost_usd: null, duration_ms: Number(p.durationMs ?? 0), num_turns: 1 },
          ...(err === undefined
            ? {}
            : { error: { code: Number(err.code ?? -32603), message: String(err.message ?? "") } }),
        },
      },
    ];
  }

  return []; // 미지 이벤트는 cold 전용
}

export interface CodexAdapterConfig {
  binary: string;
  spawnFn?: typeof spawn;
  capabilities: RuntimeCapabilities;
  version: string;
}

/** A2-D6: 상주 app-server 자식 1개가 여러 thread/턴을 처리한다. */
export class CodexAdapter implements RuntimeAdapter {
  readonly kind: RuntimeKind = "codex";
  #client: AppServerClient | null = null;
  #child: ReturnType<typeof spawn> | null = null;

  constructor(private readonly cfg: CodexAdapterConfig) {}

  async probe(): Promise<{ version: string; capabilities: RuntimeCapabilities }> {
    return { version: this.cfg.version, capabilities: this.cfg.capabilities };
  }

  #ensure(): AppServerClient {
    if (this.#client !== null) return this.#client;
    const child = (this.cfg.spawnFn ?? spawn)(this.cfg.binary, ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (child.stdin === null || child.stdout === null)
      throw new Error("codex app-server has no stdio");
    this.#child = child;
    this.#client = new AppServerClient({ stdin: child.stdin, stdout: child.stdout });
    return this.#client;
  }

  async startTurn(s: SessionRecord, input: TurnInput, sink: EventSink): Promise<TurnHandle> {
    const client = this.#ensure();
    const turnId = `t-${Date.now().toString(36)}`;
    const ctx: Ctx = {
      session_key: s.session_key,
      turn_id: turnId,
      seq: new Map<string, number>(),
    };
    for (const m of [
      "thread.started",
      "turn.started",
      "item/started",
      "item/completed",
      "turn.completed",
      "turn.failed",
      "item/agentMessage/delta",
      "item/commandExecution/outputDelta",
      ...REASONING_DELTA_METHODS,
    ]) {
      client.on(m, (params) => {
        sink.raw(JSON.stringify({ method: m, params }));
        for (const e of mapAppServerEvent(m, params, ctx)) {
          if (e.method === "turn.item.delta") sink.delta(e.params);
          else if (e.method === "turn.item.started" || e.method === "session.registered")
            sink.itemStarted(e.params);
          else if (e.method === "turn.item.completed") sink.itemCompleted(e.params);
          else sink.turnCompleted(e.params);
        }
      });
    }
    await client.request("turn.start", {
      threadId: s.session_id,
      cwd: s.cwd,
      input: input.text,
    });
    return {
      turn_id: turnId,
      cancel: async (): Promise<boolean> => {
        await client.request("turn.cancel", { turnId });
        return true;
      },
    };
  }

  async cancel(h: TurnHandle, reason: string): Promise<boolean> {
    return await h.cancel(reason);
  }

  async close(): Promise<void> {
    this.#client?.close();
    this.#child?.kill("SIGTERM");
    this.#client = null;
    this.#child = null;
  }
}
