import { describe, expect, it, vi } from "vitest";
import { HubClient, backoffDelayMs, type SocketLike } from "../src/hub-client.js";
import { createLogger } from "../src/logger.js";

function fakeSocket() {
  const sent: string[] = [];
  const handlers: Record<string, ((...a: unknown[]) => void)[]> = {};
  const sock: SocketLike = {
    send: (d) => { sent.push(d); },
    close: () => { (handlers.close ?? []).forEach((h) => h()); },
    on: (ev, fn) => { (handlers[ev] ??= []).push(fn as (...a: unknown[]) => void); return sock; },
  };
  return { sock, sent, fire: (ev: string, ...a: unknown[]) => (handlers[ev] ?? []).forEach((h) => h(...a)) };
}

const deps = (connect: () => SocketLike) => ({
  url: "ws://127.0.0.1:8787/bridge",
  token: "t0ken",
  logger: createLogger("@omnis/local-agent", { sink: () => {} }),
  connect,
  dispatch: async (method: string) => ({ echoed: method }),
});

describe("backoffDelayMs", () => {
  it("doubles from 1s and caps at 30s", () => {
    const noJitter = () => 0.5;
    expect(backoffDelayMs(0, noJitter)).toBe(1000);
    expect(backoffDelayMs(3, noJitter)).toBe(8000);
    expect(backoffDelayMs(10, noJitter)).toBe(30000);
  });

  it("applies +-20% jitter", () => {
    expect(backoffDelayMs(0, () => 0)).toBe(800);
    expect(backoffDelayMs(0, () => 1)).toBe(1200);
  });
});

describe("HubClient", () => {
  it("dials with a bearer token and stamps _meta on outgoing requests", async () => {
    const f = fakeSocket();
    const headers: Record<string, string>[] = [];
    const c = new HubClient(deps((u?: string, h?: Record<string, string>) => { headers.push(h ?? {}); return f.sock; }) as never);
    await c.start();
    f.fire("open");
    c.notify("health", { host: "mini", runtimes: [], at: "2026-09-20T00:00:00.000Z" });
    expect(headers[0]?.Authorization).toBe("Bearer t0ken");
    const sentNotify = JSON.parse(f.sent[0] as string);
    expect(sentNotify.method).toBe("health");
    expect(sentNotify.id).toBeUndefined();
    expect(sentNotify.params._meta["ai.omnis/protocolVersion"]).toBe("2026-09-20");
  });

  it("answers an inbound request through dispatch and echoes the id", async () => {
    const f = fakeSocket();
    const c = new HubClient(deps(() => f.sock) as never);
    await c.start();
    f.fire("open");
    f.fire("message", JSON.stringify({ jsonrpc: "2.0", id: "h-1", method: "session.close", params: { _meta: { "ai.omnis/protocolVersion": "2026-09-20" } } }));
    await vi.waitFor(() => expect(f.sent.some((s) => JSON.parse(s).id === "h-1")).toBe(true));
    expect(JSON.parse(f.sent.find((s) => JSON.parse(s).id === "h-1") as string).result).toEqual({ echoed: "session.close" });
  });

  it("resolves an outbound request when the hub replies", async () => {
    const f = fakeSocket();
    const c = new HubClient(deps(() => f.sock) as never);
    await c.start();
    f.fire("open");
    const p = c.request("approval.requested", { session_key: "agent:codex:mini:x", turn_id: "t1" });
    const id = JSON.parse(f.sent[0] as string).id as string;
    f.fire("message", JSON.stringify({ jsonrpc: "2.0", id, result: { decision: "accept" } }));
    await expect(p).resolves.toEqual({ decision: "accept" });
  });
});
