import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createPool, one, query } from "@omnis/db";
import { type Kernel, createKernel, createLogger } from "@omnis/kernel";
import { PROTOCOL_VERSION, RuntimeRegisteredResult } from "@omnis/protocol";
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
    // The port is chosen by listen(0) below. readConfig accepts only 1-65535, so give it a valid value.
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

/** A mini bridge client for tests: sends notifications and answers hub requests via handlers. */
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

/** A bridge → hub *request*: the id is what makes the hub answer instead of treating the message
 *  as a notification (US-C00 turns runtime.registered into one of these). */
function request(ws: WebSocket, method: string, params: Record<string, unknown>): Promise<unknown> {
  const id = `t-${randomUUID()}`;
  return new Promise((resolve, reject) => {
    const onMessage = (raw: unknown): void => {
      const msg = JSON.parse(String(raw)) as {
        id?: string;
        result?: unknown;
        error?: { message: string };
      };
      if (msg.id !== id) return;
      ws.off("message", onMessage);
      if (msg.error !== undefined) reject(new Error(msg.error.message));
      else resolve(msg.result);
    };
    ws.on("message", onMessage);
    ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params: { ...params, _meta: { "ai.omnis/protocolVersion": PROTOCOL_VERSION } },
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

  it("answers runtime.registered with the upserted row's runtime_id (US-C00)", async () => {
    const client = await connect({});

    const result = RuntimeRegisteredResult.parse(
      await request(client.ws, "runtime.registered", {
        runtime: "claude_code",
        host: "macbook",
        version: "2.1.274",
        capabilities: { resume: true, tool_calls: true, approvals: "hook", cancel: true },
      }),
    );

    const row = await one<{ id: string }>(
      pool,
      "SELECT id FROM agent_runtimes WHERE runtime = 'claude_code' AND host = 'macbook'",
    );
    expect(result.runtime_id).toBe(row.id);

    client.ws.close();
    await client.closed;
  });

  it("stores a runtime whose probe failed as degraded, not online (US-C01)", async () => {
    const client = await connect({});
    const readState = async (): Promise<string> =>
      (
        await one<{ state: string }>(
          pool,
          "SELECT state FROM agent_runtimes WHERE runtime = 'hermes' AND host = 'macbook'",
        )
      ).state;

    // A binary that is missing still registers — the hub shows it and routing skips it — so the
    // state the agent probed has to survive the INSERT.
    await request(client.ws, "runtime.registered", {
      runtime: "hermes",
      host: "macbook",
      version: "unknown",
      capabilities: { features: ["probe_failed"] },
      state: "degraded",
      display: "hermes@macbook",
    });
    expect(await readState()).toBe("degraded");

    // …and the upsert branch has to move it back once a probe succeeds.
    await request(client.ws, "runtime.registered", {
      runtime: "hermes",
      host: "macbook",
      version: "3.0.0",
      capabilities: {},
      state: "online",
    });
    expect(await readState()).toBe("online");

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
            args: { text: "Sending it" },
            description: "1 Slack reply",
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
      return rows.find((a) => a.description === "1 Slack reply")?.id ?? null;
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
    // Wait for *this* registration, not merely "some row is online": other integration files seed
    // claude_ds@macbook as online in their beforeAll, and matching that row would let terminate()
    // race runtime.registered — the upsert would then write online back over markOffline.
    await until(async () => {
      const rows = await query<{ state: string; version: string | null }>(
        pool,
        "SELECT state, version FROM agent_runtimes WHERE runtime = 'claude_ds' AND host = 'macbook'",
      );
      return rows[0]?.state === "online" && rows[0]?.version === "1.0.0" ? true : null;
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
