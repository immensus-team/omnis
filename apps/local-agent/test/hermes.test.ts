import { BridgeError } from "@omnis/protocol";
import { describe, expect, it, vi } from "vitest";
import {
  HermesAdapter,
  HermesSessionHeaderMismatchError,
  parseHermesCapabilities,
} from "../src/bridges/hermes.js";
import type { EventSink } from "../src/rpc-dispatch.js";
import type { SessionRecord } from "../src/session-registry.js";

describe("parseHermesCapabilities()", () => {
  it("maps the Hermes self-description to RuntimeCapabilities (Phase B: 승인 표면 none)", () => {
    const caps = parseHermesCapabilities({
      session_key_header: "X-Hermes-Session-Key",
      models: ["gpt-hermes-1"],
    });
    expect(caps.approvals).toBe("none"); // A2-D9: Phase B는 읽기 전용, 승인 요청이 발생할 여지가 없다
    expect(caps.models).toEqual(["gpt-hermes-1"]);
    expect(caps.stream_deltas).toBe(true);
  });
});

describe("HermesAdapter.probe()", () => {
  it("fetches GET /v1/capabilities with the bearer token and returns parsed capabilities", async () => {
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("http://127.0.0.1:8642/v1/capabilities");
      return new Response(
        JSON.stringify({ session_key_header: "X-Hermes-Session-Key", models: [] }),
        { status: 200 },
      );
    });
    const adapter = new HermesAdapter({
      baseUrl: "http://127.0.0.1:8642",
      token: "tok-1",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const result = await adapter.probe();
    expect(result.capabilities.approvals).toBe("none");
    expect(fetchFn.mock.calls).toHaveLength(1);
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok-1");
  });

  it("throws HermesSessionHeaderMismatchError when session_key_header is unexpected (A2 §2.1: degraded)", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ session_key_header: "X-Something-Else" }), { status: 200 }),
    );
    const adapter = new HermesAdapter({
      baseUrl: "http://127.0.0.1:8642",
      token: "tok-1",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(adapter.probe()).rejects.toBeInstanceOf(HermesSessionHeaderMismatchError);
  });
});

function fakeSink(): {
  sink: EventSink;
  calls: Record<string, unknown[]>;
} {
  const calls: Record<string, unknown[]> = {
    turnStarted: [],
    delta: [],
    itemCompleted: [],
    turnCompleted: [],
  };
  return {
    sink: {
      itemStarted: () => {},
      delta: (e) => {
        calls.delta?.push(e);
      },
      itemCompleted: (e) => {
        calls.itemCompleted?.push(e);
      },
      turnStarted: (e) => {
        calls.turnStarted?.push(e);
      },
      turnCompleted: (e) => {
        calls.turnCompleted?.push(e);
      },
      approval: async () => ({ decision: "ignore" as const }),
      raw: () => {},
    },
    calls,
  };
}

function baseSession(origin: SessionRecord["origin"]): SessionRecord {
  return {
    session_key: "agent:hermes:mini:inbox-draft",
    session_id: null,
    runtime: "hermes",
    runtime_id: "r-1",
    cwd: "/",
    purpose: "inbox-draft",
    origin,
    permission_profile: "observe",
    state: "idle",
    opened_at: "2026-09-20T00:00:00.000Z",
    last_turn_at: null,
  };
}

describe("HermesAdapter.startTurn()", () => {
  it("rejects non-human origin (A2-D9: Phase B is read-only, no delegation)", async () => {
    const adapter = new HermesAdapter({ baseUrl: "http://127.0.0.1:8642", token: "tok-1" });
    const { sink } = fakeSink();
    await expect(
      adapter.startTurn(baseSession("delegation"), { text: "do x" }, sink),
    ).rejects.toBeInstanceOf(BridgeError);
  });

  it("POSTs /v1/responses with X-Hermes-Session-Key and conversation=session_key on the first turn", async () => {
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("http://127.0.0.1:8642/v1/responses");
      expect((init.headers as Record<string, string>)["X-Hermes-Session-Key"]).toBe(
        "agent:hermes:mini:inbox-draft",
      );
      expect(JSON.parse(String(init.body))).toEqual({
        conversation: "agent:hermes:mini:inbox-draft",
        input: "do x",
      });
      return new Response(
        new ReadableStream({
          start(c) {
            c.close();
          },
        }),
        { status: 200, headers: { "X-Hermes-Session-Id": "resp-1" } },
      );
    });
    const adapter = new HermesAdapter({
      baseUrl: "http://127.0.0.1:8642",
      token: "tok-1",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const { sink, calls } = fakeSink();
    const handle = await adapter.startTurn(baseSession("human"), { text: "do x" }, sink);
    expect(handle.turn_id).toMatch(/^t-/);
    expect(calls.turnStarted).toHaveLength(1);
  });

  it("chains the next turn with previous_response_id from X-Hermes-Session-Id", async () => {
    const bodies: unknown[] = [];
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(
        new ReadableStream({
          start(c) {
            c.close();
          },
        }),
        { status: 200, headers: { "X-Hermes-Session-Id": "resp-1" } },
      );
    });
    const adapter = new HermesAdapter({
      baseUrl: "http://127.0.0.1:8642",
      token: "tok-1",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const { sink } = fakeSink();
    const s = baseSession("human");
    await adapter.startTurn(s, { text: "one" }, sink);
    await adapter.startTurn(s, { text: "two" }, sink);
    expect(bodies[1]).toEqual({ previous_response_id: "resp-1", input: "two" });
  });

  it("throws RUNTIME_UNAVAILABLE when /v1/responses is not ok", async () => {
    const fetchFn = vi.fn(async () => new Response("nope", { status: 503 }));
    const adapter = new HermesAdapter({
      baseUrl: "http://127.0.0.1:8642",
      token: "tok-1",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const { sink } = fakeSink();
    await expect(
      adapter.startTurn(baseSession("human"), { text: "do x" }, sink),
    ).rejects.toBeInstanceOf(BridgeError);
  });
});

function sseStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(`${line}\n`));
      controller.close();
    },
  });
}

describe("HermesAdapter SSE pump", () => {
  it("suppresses ': keepalive' comments and emits delta/itemCompleted/turnCompleted for data lines", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(
          sseStream([
            ": keepalive",
            `data: ${JSON.stringify({ type: "delta", text: "hel" })}`,
            ": keepalive",
            `data: ${JSON.stringify({ type: "delta", text: "lo" })}`,
            `data: ${JSON.stringify({ type: "done" })}`,
          ]),
          { status: 200, headers: { "X-Hermes-Session-Id": "resp-1" } },
        ),
    );
    const adapter = new HermesAdapter({
      baseUrl: "http://127.0.0.1:8642",
      token: "tok-1",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const { sink, calls } = fakeSink();
    await adapter.startTurn(baseSession("human"), { text: "hi" }, sink);
    await new Promise((r) => setTimeout(r, 20)); // #pump는 fire-and-forget(void) — 배출 완료를 잠깐 기다린다
    expect(calls.delta?.map((d) => (d as { text: string }).text)).toEqual(["hel", "lo"]);
    expect(calls.itemCompleted).toHaveLength(1);
    expect((calls.itemCompleted?.[0] as { body: string }).body).toBe("hello");
    expect(calls.turnCompleted).toHaveLength(1);
    expect((calls.turnCompleted?.[0] as { status: string }).status).toBe("ok");
  });

  // gate-hermes-sse: /v1/responses는 OpenAI Responses 호환일 수 있다 — 두 필드명 모양이 같은 결과를 내야 한다
  it("accepts the OpenAI Responses shape (response.output_text.delta / response.completed) identically", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(
          sseStream([
            ": keepalive",
            `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "hel" })}`,
            `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "lo" })}`,
            `data: ${JSON.stringify({ type: "response.output_text.done", text: "hello" })}`,
            `data: ${JSON.stringify({ type: "response.completed" })}`,
          ]),
          { status: 200 },
        ),
    );
    const adapter = new HermesAdapter({
      baseUrl: "http://127.0.0.1:8642",
      token: "tok-1",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const { sink, calls } = fakeSink();
    await adapter.startTurn(baseSession("human"), { text: "hi" }, sink);
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.delta?.map((d) => (d as { text: string }).text)).toEqual(["hel", "lo"]);
    expect((calls.itemCompleted?.[0] as { body: string }).body).toBe("hello");
    expect(calls.turnCompleted).toHaveLength(1); // 종료 이벤트가 둘이어도 턴 종료는 한 번
  });

  it("drops unknown event types and malformed JSON without throwing", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(
          sseStream([
            "data: {not json",
            `data: ${JSON.stringify({ type: "response.output_item.added" })}`,
            `data: ${JSON.stringify({ type: "delta", text: "ok" })}`,
            "data: [DONE]",
            `data: ${JSON.stringify({ type: "done" })}`,
          ]),
          { status: 200 },
        ),
    );
    const adapter = new HermesAdapter({
      baseUrl: "http://127.0.0.1:8642",
      token: "tok-1",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const { sink, calls } = fakeSink();
    await adapter.startTurn(baseSession("human"), { text: "hi" }, sink);
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.delta).toHaveLength(1);
    expect(calls.turnCompleted).toHaveLength(1);
  });
});

describe("HermesAdapter.cancel()/close()", () => {
  it("cancel() aborts the in-flight fetch via the turn handle", async () => {
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.signal).toBeInstanceOf(AbortSignal);
      return new Response(sseStream([]), { status: 200 });
    });
    const adapter = new HermesAdapter({
      baseUrl: "http://127.0.0.1:8642",
      token: "tok-1",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const { sink } = fakeSink();
    const handle = await adapter.startTurn(baseSession("human"), { text: "hi" }, sink);
    expect(await adapter.cancel(handle, "user cancelled")).toBe(true);
  });

  it("close() resolves without throwing (stateless HTTP client, no resident resource)", async () => {
    const adapter = new HermesAdapter({ baseUrl: "http://127.0.0.1:8642", token: "tok-1" });
    await expect(adapter.close()).resolves.toBeUndefined();
  });
});
