import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
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

/** A2 §4.2: an item/started absent from this list is generalized to kind='tool_call', label=item.type. */
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
    // Until S-A2-3 the amendment payload schema is unknown, so the edit path is not exposed to the UI.
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

  return []; // unknown events are cold-tier only
}

export interface CodexAdapterConfig {
  binary: string;
  spawnFn?: typeof spawn;
  capabilities: RuntimeCapabilities;
  version: string;
}

/** One child carries several turns, so it has to hold which turn a notification belongs to. */
interface ActiveTurn {
  ctx: Ctx;
  sink: EventSink;
  thread_id: string | null;
}

/** The app-server notifications the adapter subscribes to. Anything absent here is cold-tier only. */
const CODEX_EVENT_METHODS = [
  "thread.started",
  "turn.started",
  "item/started",
  "item/completed",
  "turn.completed",
  "turn.failed",
  "item/agentMessage/delta",
  "item/commandExecution/outputDelta",
  ...REASONING_DELTA_METHODS,
];

/** A2-D6: one resident app-server child handles several threads/turns. */
export class CodexAdapter implements RuntimeAdapter {
  readonly kind: RuntimeKind = "codex";
  #client: AppServerClient | null = null;
  #child: ReturnType<typeof spawn> | null = null;
  readonly #turns = new Set<ActiveTurn>();

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
    const client = new AppServerClient({ stdin: child.stdin, stdout: child.stdout });
    // The handler is attached once per child. Attaching it per turn would, since AppServerClient has no off(),
    // make the previous turn's closure fire too from the second turn on (duplicate events) and grow the list without bound.
    for (const m of CODEX_EVENT_METHODS) {
      client.on(m, (params) => {
        this.#route(m, params);
      });
    }
    this.#client = client;
    return client;
  }

  #turnFor(p: Record<string, unknown>): ActiveTurn | undefined {
    const threadId = typeof p.threadId === "string" ? p.threadId : null;
    if (threadId !== null) {
      for (const t of this.#turns) if (t.thread_id === threadId) return t;
    }
    // ponytail: a notification without a threadId is attributed only when exactly one turn is active.
    // With two or more concurrent turns and no threadId, attribution is ambiguous, so it is dropped (better than misdelivery).
    return this.#turns.size === 1 ? this.#turns.values().next().value : undefined;
  }

  #route(method: string, params: unknown): void {
    const p = (params ?? {}) as Record<string, unknown>;
    const turn = this.#turnFor(p);
    if (turn === undefined) return;

    turn.sink.raw(JSON.stringify({ method, params }));
    for (const e of mapAppServerEvent(method, params, turn.ctx)) {
      if (e.method === "turn.item.delta") turn.sink.delta(e.params);
      else if (e.method === "turn.item.started" || e.method === "session.registered")
        turn.sink.itemStarted(e.params);
      else if (e.method === "turn.item.completed") turn.sink.itemCompleted(e.params);
      else if (e.method === "turn.started") turn.sink.turnStarted(e.params);
      else turn.sink.turnCompleted(e.params);
    }

    if (method === "thread.started" && typeof p.threadId === "string") turn.thread_id = p.threadId;
    if (method === "turn.completed" || method === "turn.failed") this.#turns.delete(turn);
  }

  async startTurn(s: SessionRecord, input: TurnInput, sink: EventSink): Promise<TurnHandle> {
    const client = this.#ensure();
    const turnId = `t-${randomUUID().slice(0, 8)}`;
    const turn: ActiveTurn = {
      ctx: { session_key: s.session_key, turn_id: turnId, seq: new Map<string, number>() },
      sink,
      thread_id: s.session_id,
    };
    this.#turns.add(turn);
    try {
      await client.request("turn.start", {
        threadId: s.session_id,
        cwd: s.cwd,
        input: input.text,
      });
    } catch (e) {
      this.#turns.delete(turn);
      throw e;
    }
    return {
      turn_id: turnId,
      cancel: async (): Promise<boolean> => {
        this.#turns.delete(turn);
        await client.request("turn.cancel", { turnId });
        return true;
      },
    };
  }

  async cancel(h: TurnHandle, reason: string): Promise<boolean> {
    return await h.cancel(reason);
  }

  async close(): Promise<void> {
    this.#turns.clear();
    this.#client?.close();
    this.#child?.kill("SIGTERM");
    this.#client = null;
    this.#child = null;
  }
}
