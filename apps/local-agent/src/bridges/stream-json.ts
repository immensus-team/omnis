import type { BridgeItemKind, BridgeMethod } from "@omnis/protocol";

export interface BridgeEmit {
  method: BridgeMethod;
  params: Record<string, unknown>;
}

export interface StreamJsonState {
  seq: Map<string, number>;
  openText: string | null;
  toolLabels: Map<string, string>;
}

export function newStreamJsonState(): StreamJsonState {
  return { seq: new Map(), openText: null, toolLabels: new Map() };
}

const HEAD = 2048;
const TAIL = 1024;
const LIMIT = 8192;

/** A2 §4.1: 8KB 초과 tool_result는 앞 2KB + 잘린 바이트 수 + 뒤 1KB로 줄이고 전문은 cold에 둔다. */
export function truncateToolResult(body: string): { body: string; truncated: boolean } {
  const bytes = Buffer.byteLength(body, "utf8");
  if (bytes <= LIMIT) return { body, truncated: false };
  const cut = bytes - HEAD - TAIL;
  return {
    body: `${body.slice(0, HEAD)}… (${cut} bytes truncated)${body.slice(-TAIL)}`,
    truncated: true,
  };
}

interface Ctx {
  session_key: string;
  turn_id: string;
  state: StreamJsonState;
}

function nextSeq(state: StreamJsonState, itemId: string): number {
  const n = state.seq.get(itemId) ?? 0;
  state.seq.set(itemId, n + 1);
  return n;
}

function item(ctx: Ctx, itemId: string, extra: Record<string, unknown>): Record<string, unknown> {
  return { session_key: ctx.session_key, turn_id: ctx.turn_id, item_id: itemId, ...extra };
}

/** A2 §4.1 매핑표. 표에 없는 이벤트는 빈 배열 → cold 티어에만 남는다. */
export function mapStreamJsonEvent(raw: unknown, ctx: Ctx): BridgeEmit[] {
  const ev = raw as Record<string, unknown>;
  const type = ev.type;

  if (type === "system" && ev.subtype === "init") {
    return [
      {
        method: "session.registered",
        params: {
          session_key: ctx.session_key,
          session_id: String(ev.session_id ?? ""),
          capabilities_raw: Array.isArray(ev.capabilities) ? ev.capabilities : [],
        },
      },
    ];
  }

  if (type === "stream_event") {
    const inner = (ev.event ?? {}) as Record<string, unknown>;
    const idx = `blk-${String(inner.index ?? 0)}`;
    if (inner.type === "content_block_start") {
      const block = (inner.content_block ?? {}) as Record<string, unknown>;
      if (block.type !== "text") return [];
      ctx.state.openText = idx;
      return [
        {
          method: "turn.item.started",
          params: item(ctx, idx, {
            kind: "agent_turn" satisfies BridgeItemKind,
            label: "assistant",
            meta: {},
          }),
        },
      ];
    }
    if (inner.type === "content_block_delta") {
      const delta = (inner.delta ?? {}) as Record<string, unknown>;
      const text = typeof delta.text === "string" ? delta.text : "";
      if (text === "") return [];
      return [
        {
          method: "turn.item.delta",
          params: item(ctx, idx, { seq: nextSeq(ctx.state, idx), text, channel: "output" }),
        },
      ];
    }
    return [];
  }

  if (type === "assistant") {
    const content = (((ev.message ?? {}) as Record<string, unknown>).content ?? []) as Record<
      string,
      unknown
    >[];
    const out: BridgeEmit[] = [];
    for (const block of content) {
      if (block.type === "text") {
        const id = ctx.state.openText ?? "blk-0";
        out.push({
          method: "turn.item.completed",
          params: item(ctx, id, {
            kind: "agent_turn" satisfies BridgeItemKind,
            body: String(block.text ?? ""),
            status: "ok",
            meta: {},
          }),
        });
        ctx.state.openText = null;
      } else if (block.type === "tool_use") {
        const id = String(block.id ?? "");
        const label = String(block.name ?? "tool");
        ctx.state.toolLabels.set(id, label);
        out.push({
          method: "turn.item.started",
          params: item(ctx, id, {
            kind: "tool_call" satisfies BridgeItemKind,
            label,
            meta: { tool: label, input: block.input ?? {} },
          }),
        });
      }
    }
    return out;
  }

  if (type === "user") {
    const content = (((ev.message ?? {}) as Record<string, unknown>).content ?? []) as Record<
      string,
      unknown
    >[];
    return content
      .filter((b) => b.type === "tool_result")
      .map((b): BridgeEmit => {
        const id = String(b.tool_use_id ?? "");
        const { body, truncated } = truncateToolResult(
          typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? ""),
        );
        return {
          method: "turn.item.completed",
          params: item(ctx, id, {
            kind: "tool_call" satisfies BridgeItemKind,
            body,
            status: b.is_error === true ? "failed" : "ok",
            meta: {
              label: ctx.state.toolLabels.get(id) ?? "tool",
              ...(truncated ? { cold_ref: ctx.turn_id } : {}),
            },
          }),
        };
      });
  }

  if (type === "result") {
    return [
      {
        method: "turn.completed",
        params: {
          session_key: ctx.session_key,
          turn_id: ctx.turn_id,
          status: ev.subtype === "success" ? "ok" : "failed",
          usage: {
            cost_usd: typeof ev.total_cost_usd === "number" ? ev.total_cost_usd : null,
            duration_ms: Number(ev.duration_ms ?? 0),
            num_turns: Number(ev.num_turns ?? 1),
          },
        },
      },
    ];
  }

  if (type === "rate_limit_event") {
    return [
      {
        method: "health",
        params: { session_key: ctx.session_key, limited: true, at: new Date().toISOString() },
      },
    ];
  }

  return [];
}
