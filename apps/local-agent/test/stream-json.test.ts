import { describe, expect, it, vi } from "vitest";
import { createDurableDebouncer } from "../src/bridges/durable-debounce.js";
import {
  mapStreamJsonEvent,
  newStreamJsonState,
  truncateToolResult,
} from "../src/bridges/stream-json.js";

const ctx = () => ({
  session_key: "agent:claude_code:macbook:inbox-draft",
  turn_id: "t1",
  state: newStreamJsonState(),
});

describe("mapStreamJsonEvent (A2 §4.1)", () => {
  it("lifts only session_id and capabilities out of system/init", () => {
    const c = ctx();
    const out = mapStreamJsonEvent(
      {
        type: "system",
        subtype: "init",
        session_id: "s-42",
        capabilities: ["interrupt_receipt_v1"],
        tools: new Array(80).fill("x"),
      },
      c,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.method).toBe("session.registered");
    expect(out[0]?.params.session_id).toBe("s-42");
    expect(JSON.stringify(out[0])).not.toContain("xxxxx");
  });

  it("maps a text content_block_delta to an ephemeral delta with a rising seq", () => {
    const c = ctx();
    mapStreamJsonEvent(
      {
        type: "stream_event",
        event: { type: "content_block_start", index: 0, content_block: { type: "text" } },
      },
      c,
    );
    const a = mapStreamJsonEvent(
      {
        type: "stream_event",
        event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "he" } },
      },
      c,
    );
    const b = mapStreamJsonEvent(
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "llo" },
        },
      },
      c,
    );
    expect(a[0]?.method).toBe("turn.item.delta");
    expect(a[0]?.params.seq).toBe(0);
    expect(b[0]?.params.seq).toBe(1);
  });

  it("closes the agent_turn item with the assistant text block", () => {
    const c = ctx();
    mapStreamJsonEvent(
      {
        type: "stream_event",
        event: { type: "content_block_start", index: 0, content_block: { type: "text" } },
      },
      c,
    );
    const out = mapStreamJsonEvent(
      { type: "assistant", message: { content: [{ type: "text", text: "hello" }] } },
      c,
    );
    expect(out[0]?.method).toBe("turn.item.completed");
    expect(out[0]?.params.kind).toBe("agent_turn");
    expect(out[0]?.params.body).toBe("hello");
  });

  it("opens a tool_call on tool_use and closes it on tool_result", () => {
    const c = ctx();
    const started = mapStreamJsonEvent(
      {
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "tu_1", name: "Bash", input: { command: "ls" } }],
        },
      },
      c,
    );
    expect(started[0]?.params.kind).toBe("tool_call");
    expect(started[0]?.params.label).toBe("Bash");
    const done = mapStreamJsonEvent(
      {
        type: "user",
        message: {
          content: [{ type: "tool_result", tool_use_id: "tu_1", is_error: false, content: "a\nb" }],
        },
      },
      c,
    );
    expect(done[0]?.method).toBe("turn.item.completed");
    expect(done[0]?.params.status).toBe("ok");
  });

  it("emits turn.completed with usage from result", () => {
    const out = mapStreamJsonEvent(
      {
        type: "result",
        subtype: "success",
        total_cost_usd: 0.012,
        duration_ms: 4200,
        num_turns: 1,
      },
      ctx(),
    );
    expect(out[0]?.method).toBe("turn.completed");
    expect(out[0]?.params.status).toBe("ok");
  });

  it("keeps unknown event types out of durable entirely", () => {
    expect(mapStreamJsonEvent({ type: "some_future_event", payload: 1 }, ctx())).toEqual([]);
  });

  it("truncates a tool_result over 8KB to head 2KB + tail 1KB", () => {
    const r = truncateToolResult("A".repeat(9000));
    expect(r.truncated).toBe(true);
    expect(r.body).toContain("bytes truncated");
    expect(r.body.length).toBeLessThan(3200);
  });
});

describe("createDurableDebouncer (A2-D4)", () => {
  it("coalesces repeated completions for one item inside the window and flushes on turn.completed", () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const d = createDurableDebouncer(
      (e) => seen.push(`${e.method}:${String(e.params.body ?? "")}`),
      { intervalMs: 500 },
    );
    d.push({ method: "turn.item.started", params: { item_id: "i1" } });
    d.push({ method: "turn.item.started", params: { item_id: "i1" } });
    d.push({ method: "turn.item.completed", params: { item_id: "i1", body: "partial" } });
    d.push({ method: "turn.item.completed", params: { item_id: "i1", body: "final" } });
    d.push({ method: "turn.completed", params: { turn_id: "t1" } });
    expect(seen).toEqual(["turn.item.started:", "turn.item.completed:final", "turn.completed:"]);
    vi.useRealTimers();
  });
});
