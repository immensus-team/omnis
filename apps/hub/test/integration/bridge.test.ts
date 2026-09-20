import type { AddressInfo } from "node:net";
import { createPool, query } from "@omnis/db";
import { type Kernel, createKernel, createLogger } from "@omnis/kernel";
import { PROTOCOL_VERSION } from "@omnis/protocol";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { type BridgeHub, createBridgeHub } from "../../src/bridge.js";
import { readConfig } from "../../src/config.js";
import { createHubServer } from "../../src/http.js";

const TOKEN = "test-bridge-token";

let pool: Pool;
let kernel: Kernel;
let bridge: BridgeHub;
let server: ReturnType<typeof createHubServer>;
let base: string;

beforeAll(async () => {
  pool = createPool();
  kernel = createKernel({ pool, logger: createLogger("@omnis/hub") });
  bridge = createBridgeHub({
    kernel,
    pool,
    logger: createLogger("@omnis/hub"),
    token: TOKEN,
    heartbeatMs: 250,
  });
  server = createHubServer({
    kernel,
    pool,
    // 포트는 아래 listen(0)이 정한다. readConfig는 1~65535만 받으므로 유효값을 준다.
    config: readConfig({ DATABASE_URL: "postgres://x/y", OMNIS_HUB_PORT: "8788" }),
    logger: createLogger("@omnis/hub"),
    startedAt: Date.now(),
    onUpgrade: (req, socket, head) => bridge.handleUpgrade(req, socket, head),
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/bridge`;
  await query(
    pool,
    "DELETE FROM agent_runtimes WHERE runtime = 'claude_code' AND host = 'macbook'",
  );
});

afterAll(async () => {
  await bridge.close();
  await new Promise<void>((r) => server.close(() => r()));
  await kernel.close();
  await pool.end();
});

/** 테스트용 미니 브리지 클라이언트: 알림을 보내고, 허브의 요청에는 handlers로 답한다. */
function connect(handlers: Record<string, (params: Record<string, unknown>) => unknown>): Promise<{
  ws: WebSocket;
  notify(method: string, params: Record<string, unknown>): void;
  closed: Promise<void>;
}> {
  const ws = new WebSocket(base, {
    headers: { authorization: `Bearer ${TOKEN}`, "x-omnis-host": "macbook" },
  });
  ws.on("message", (raw) => {
    const msg = JSON.parse(String(raw)) as {
      id?: string;
      method?: string;
      params?: Record<string, unknown>;
    };
    if (msg.method === undefined || msg.id === undefined) return;
    const handler = handlers[msg.method];
    if (handler === undefined) {
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32601, message: "no handler" },
        }),
      );
      return;
    }
    ws.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: handler(msg.params ?? {}) }));
  });
  const closed = new Promise<void>((r) => ws.on("close", () => r()));
  return new Promise((resolve, reject) => {
    ws.on("error", reject);
    ws.on("open", () =>
      resolve({
        ws,
        notify(method, params) {
          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              method,
              params: { ...params, _meta: { "ai.omnis/protocolVersion": PROTOCOL_VERSION } },
            }),
          );
        },
        closed,
      }),
    );
  });
}

async function until<T>(fn: () => Promise<T | null>, ms = 5000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const v = await fn();
    if (v !== null) return v;
    if (Date.now() - started > ms) throw new Error("condition never became true");
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("WS /bridge auth", () => {
  it("rejects an upgrade without the bridge token", async () => {
    const ws = new WebSocket(base, { headers: { "x-omnis-host": "macbook" } });
    const err = await new Promise<Error>((r) => ws.on("error", r));
    expect(err.message).toMatch(/401/);
  });

  it("rejects an upgrade without a valid x-omnis-host", async () => {
    const ws = new WebSocket(base, {
      headers: { authorization: `Bearer ${TOKEN}`, "x-omnis-host": "laptop" },
    });
    const err = await new Promise<Error>((r) => ws.on("error", r));
    expect(err.message).toMatch(/400/);
  });
});

describe("register + discover round trip", () => {
  it("writes agent_runtimes on runtime.registered and answers bridge/discover", async () => {
    const client = await connect({
      "bridge/discover": () => ({
        runtimes: [
          { runtime: "claude_code", host: "macbook", version: "2.1.274", state: "online" },
        ],
      }),
    });

    client.notify("runtime.registered", {
      runtime: "claude_code",
      host: "macbook",
      version: "2.1.274",
      capabilities: { resume: true, tool_calls: true, approvals: "hook", cancel: true },
    });

    const row = await until(async () => {
      const rows = await query<{
        state: string;
        version: string;
        capabilities: Record<string, unknown>;
      }>(
        pool,
        "SELECT state, version, capabilities FROM agent_runtimes WHERE runtime = 'claude_code' AND host = 'macbook'",
      );
      return rows[0] ?? null;
    });
    expect(row.state).toBe("online");
    expect(row.version).toBe("2.1.274");
    expect(row.capabilities.approvals).toBe("hook");

    expect(bridge.hosts()).toEqual(["macbook"]);

    const discovered = await bridge.call<{ runtimes: { runtime: string }[] }>(
      "macbook",
      "bridge/discover",
      {},
    );
    expect(discovered.runtimes.map((r) => r.runtime)).toEqual(["claude_code"]);

    client.ws.close();
    await client.closed;
  });

  it("refuses call() for a host that is not connected", async () => {
    await expect(bridge.call("mini", "session.create", {})).rejects.toThrow(/no bridge connected/);
  });

  it("refuses ingest.* as Phase B", async () => {
    await expect(bridge.call("macbook", "ingest.scan", {})).rejects.toThrow(/Phase B/);
  });
});

describe("approval.requested", () => {
  it("routes into pending_approvals and answers with the human decision", async () => {
    const client = await connect({});
    client.notify("runtime.registered", {
      runtime: "codex",
      host: "macbook",
      version: "0.155.1",
      capabilities: {},
    });

    const reply = new Promise<{ result?: { decision: string }; error?: unknown }>((resolve) => {
      client.ws.on("message", (raw) => {
        const msg = JSON.parse(String(raw)) as { id?: string; result?: { decision: string } };
        if (msg.id === "ap-1" && msg.result !== undefined) resolve(msg);
      });
    });

    client.ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "ap-1",
        method: "approval.requested",
        params: {
          session_key: "agent:codex:macbook:inbox",
          turn_id: "t-1",
          interrupt: {
            action: "send",
            args: { text: "보냅니다" },
            description: "슬랙 답장 1건",
            config: {
              allow_accept: true,
              allow_edit: true,
              allow_respond: false,
              allow_ignore: true,
            },
          },
          _meta: { "ai.omnis/protocolVersion": PROTOCOL_VERSION },
        },
      }),
    );

    const id = await until(async () => {
      const rows = await kernel.approvals.list({ state: "pending", limit: 50 });
      return rows.find((a) => a.description === "슬랙 답장 1건")?.id ?? null;
    });
    await kernel.approvals.decide(id, { decision: "accept" });

    const msg = await reply;
    expect(msg.result?.decision).toBe("accept");

    client.ws.close();
    await client.closed;
  });

  it("rejects a request whose _meta carries an unsupported protocol version", async () => {
    const client = await connect({});
    const reply = new Promise<{ error: { code: number } }>((resolve) => {
      client.ws.on("message", (raw) => {
        const msg = JSON.parse(String(raw)) as { id?: string; error?: { code: number } };
        if (msg.id === "bad-1" && msg.error !== undefined) resolve({ error: msg.error });
      });
    });
    client.ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "bad-1",
        method: "approval.requested",
        params: { interrupt: {}, _meta: { "ai.omnis/protocolVersion": "1999-01-01" } },
      }),
    );
    expect((await reply).error.code).toBe(-32010);

    client.ws.close();
    await client.closed;
  });
});

describe("heartbeat", () => {
  it("marks the runtime offline when the socket goes away", async () => {
    const client = await connect({});
    client.notify("runtime.registered", {
      runtime: "claude_ds",
      host: "macbook",
      version: "1.0.0",
      capabilities: {},
    });
    await until(async () => {
      const rows = await query<{ state: string }>(
        pool,
        "SELECT state FROM agent_runtimes WHERE runtime = 'claude_ds' AND host = 'macbook'",
      );
      return rows[0]?.state === "online" ? true : null;
    });

    client.ws.terminate();
    await until(async () => {
      const rows = await query<{ state: string }>(
        pool,
        "SELECT state FROM agent_runtimes WHERE runtime = 'claude_ds' AND host = 'macbook'",
      );
      return rows[0]?.state === "offline" ? true : null;
    });
    expect(bridge.hosts()).toEqual([]);
  });
});
