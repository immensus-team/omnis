import { describe, expect, it, vi } from "vitest";
import {
  HermesAdapter,
  HermesSessionHeaderMismatchError,
  parseHermesCapabilities,
} from "../src/bridges/hermes.js";

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
