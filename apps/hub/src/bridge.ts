import { randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { query } from "@omnis/db";
import type { Kernel, Logger } from "@omnis/kernel";
import {
  BRIDGE_ERRORS,
  BridgeError,
  type BridgeErrorCode,
  HUB_METHODS,
  HostId,
  type HubMethod,
  HumanInterrupt,
  type HumanResponse,
  JSONRPC_ERRORS,
  PROTOCOL_VERSION,
  RuntimeKind,
  assertProtocolVersion,
  toJsonRpcError,
  withMeta,
} from "@omnis/protocol";
import type { Pool } from "pg";
import { type WebSocket, WebSocketServer } from "ws";

const BRIDGE_PATH = "/bridge";

/** 계약 §3.5 SessionState → A3 §4 agent_sessions.state. 두 enum의 이름이 다르다. */
const SESSION_STATE: Readonly<Record<string, string>> = {
  idle: "idle",
  running: "running",
  awaiting_approval: "waiting_approval",
  failed: "failed",
  closed: "ended",
};

const TURN_NOTIFICATIONS = new Set([
  "turn.started",
  "turn.item.started",
  "turn.item.delta",
  "turn.item.completed",
  "turn.completed",
]);

export interface BridgeDeps {
  kernel: Kernel;
  pool: Pool;
  logger: Logger;
  /** Keychain omnis.bridge.token.<host>의 값(A6 래퍼가 OMNIS_BRIDGE_TOKEN으로 주입). 빈 문자열이면 브리지를 닫는다. */
  token: string;
  heartbeatMs?: number;
  callTimeoutMs?: number;
}

export interface BridgeHub {
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
  call<T>(host: HostId, method: HubMethod, params: Record<string, unknown>): Promise<T>;
  hosts(): HostId[];
  close(): Promise<void>;
}

interface Conn {
  ws: WebSocket;
  host: HostId;
  alive: boolean;
}

interface Waiting {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  timer: NodeJS.Timeout;
}

interface Waiter {
  stop: () => void;
  reject: (e: unknown) => void;
}

function refuse(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nconnection: close\r\ncontent-length: 0\r\n\r\n`);
  socket.destroy();
}

function constantEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function createBridgeHub(deps: BridgeDeps): BridgeHub {
  const { kernel, pool, logger, token } = deps;
  const heartbeatMs = deps.heartbeatMs ?? 30_000;
  const callTimeoutMs = deps.callTimeoutMs ?? 60_000;

  const wss = new WebSocketServer({ noServer: true });
  const conns = new Map<HostId, Conn>();
  const pending = new Map<string, Waiting>();
  const waiters = new Set<Waiter>();
  let closed = false;

  function send(ws: WebSocket, msg: Record<string, unknown>): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  async function markOffline(host: HostId): Promise<void> {
    await query(pool, "UPDATE agent_runtimes SET state = 'offline' WHERE host = $1", [host]);
  }

  // ---- bridge → hub 알림 ----

  async function onRegister(host: HostId, params: Record<string, unknown>): Promise<void> {
    const runtime = RuntimeKind.parse(params.runtime);
    const version = typeof params.version === "string" ? params.version : null;
    const display = typeof params.display === "string" ? params.display : `${runtime}@${host}`;
    const capabilities = (params.capabilities ?? {}) as Record<string, unknown>;
    await query(
      pool,
      `INSERT INTO agent_runtimes (runtime, host, display, capabilities, version, state, last_seen_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, 'online', now())
       ON CONFLICT (runtime, host) DO UPDATE
         SET display = EXCLUDED.display, capabilities = EXCLUDED.capabilities,
             version = EXCLUDED.version, state = 'online', last_seen_at = now()`,
      [runtime, host, display, JSON.stringify(capabilities), version],
    );
    logger.info("runtime registered", { runtime, host, version });
  }

  async function onHealth(host: HostId, params: Record<string, unknown>): Promise<void> {
    const runtime = RuntimeKind.parse(params.runtime);
    const raw = params.state;
    const state = raw === "degraded" || raw === "offline" ? raw : "online";
    await query(
      pool,
      "UPDATE agent_runtimes SET state = $1, last_seen_at = now() WHERE runtime = $2 AND host = $3",
      [state, runtime, host],
    );
  }

  async function onSessionRegistered(host: HostId, params: Record<string, unknown>): Promise<void> {
    const runtime = RuntimeKind.parse(params.runtime);
    const sessionKey = String(params.session_key);
    const sessionId = typeof params.session_id === "string" ? params.session_id : null;
    const mapped = typeof params.state === "string" ? SESSION_STATE[params.state] : undefined;
    const rows = await query<{ id: string }>(
      pool,
      `UPDATE agent_sessions s
          SET session_id = $1,
              state = COALESCE($2, s.state),
              last_turn_at = now()
         FROM agent_runtimes r
        WHERE s.runtime_id = r.id AND r.runtime = $3 AND r.host = $4 AND s.session_key = $5
      RETURNING s.id`,
      [sessionId, mapped ?? null, runtime, host, sessionKey],
    );
    if (rows.length === 0) {
      // 허브가 session.create로 먼저 row를 만든다(Phase B). 지금은 모르는 세션을 조용히 흘린다.
      logger.warn("session.registered for an unknown session_key", { runtime, host, sessionKey });
    }
    // NOTIFY는 0007의 sessions_notify 트리거가 쏜다 — 여기서 emit하면 두 번 나간다.
  }

  // ---- approval.requested ----

  async function readDecision(id: string): Promise<HumanResponse | null> {
    const rows = await query<{
      decision: string | null;
      decided_args: Record<string, unknown> | null;
    }>(
      pool,
      "SELECT decision, decided_args FROM pending_approvals WHERE id = $1 AND state <> 'pending'",
      [id],
    );
    const row = rows[0];
    if (row === undefined || row.decision === null) return null;
    const decision = row.decision as HumanResponse["decision"];
    return row.decided_args === null ? { decision } : { decision, decided_args: row.decided_args };
  }

  function waitForDecision(id: string): Promise<HumanResponse> {
    return new Promise<HumanResponse>((resolve, reject) => {
      let done = false;
      const waiter: Waiter = { stop: () => undefined, reject };
      const settle = (r: HumanResponse): void => {
        if (done) return;
        done = true;
        waiter.stop();
        waiters.delete(waiter);
        resolve(r);
      };
      waiter.stop = kernel.events.subscribe("omnis_approval", (p) => {
        if (p.id !== id) return;
        void readDecision(id).then((r) => {
          if (r !== null) settle(r);
        }, reject);
      });
      waiters.add(waiter);
      // propose와 subscribe 사이에 결정이 났을 수 있다 — 한 번 직접 읽는다.
      void readDecision(id).then((r) => {
        if (r !== null) settle(r);
      }, reject);
    });
  }

  async function onApprovalRequested(params: Record<string, unknown>): Promise<HumanResponse> {
    const interrupt = HumanInterrupt.parse(params.interrupt);
    const id = await kernel.approvals.propose(interrupt);
    logger.info("approval requested by bridge", { id, action: interrupt.action });
    return await waitForDecision(id);
  }

  // ---- 디스패치 ----

  async function dispatch(
    conn: Conn,
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    if (method === "runtime.registered") {
      await onRegister(conn.host, params);
      return null;
    }
    if (method === "session.registered") {
      await onSessionRegistered(conn.host, params);
      return null;
    }
    if (method === "health") {
      await onHealth(conn.host, params);
      return null;
    }
    if (TURN_NOTIFICATIONS.has(method)) {
      // ephemeral 팬아웃만(A3-D14). items row 쓰기는 US-A18/A19가 브리지 클라이언트 쪽에서 한다.
      await kernel.events.emit("ephemeral", method, { ...params, host: conn.host });
      return null;
    }
    if (method === "approval.requested") {
      return await onApprovalRequested(params);
    }
    throw new BridgeError(JSONRPC_ERRORS.METHOD_NOT_FOUND, `unknown bridge method: ${method}`);
  }

  function onMessage(conn: Conn, raw: string): void {
    let msg: {
      id?: string | number | null;
      method?: string;
      params?: unknown;
      result?: unknown;
      error?: { code: number; message: string };
    };
    try {
      msg = JSON.parse(raw) as typeof msg;
    } catch {
      send(conn.ws, {
        jsonrpc: "2.0",
        id: null,
        error: { code: JSONRPC_ERRORS.PARSE, message: "parse error" },
      });
      return;
    }

    // hub → bridge 요청에 대한 응답
    if (msg.method === undefined) {
      if (msg.id === undefined || msg.id === null) return;
      const waiting = pending.get(String(msg.id));
      if (waiting === undefined) return;
      pending.delete(String(msg.id));
      clearTimeout(waiting.timer);
      if (msg.error !== undefined) {
        waiting.reject(new BridgeError(msg.error.code as BridgeErrorCode, msg.error.message));
      } else {
        waiting.resolve(msg.result);
      }
      return;
    }

    const method = msg.method;
    const id = msg.id;
    const isRequest = id !== undefined && id !== null;
    const params = (msg.params ?? {}) as Record<string, unknown>;

    void (async () => {
      try {
        assertProtocolVersion(params);
        const result = await dispatch(conn, method, params);
        if (isRequest) send(conn.ws, { jsonrpc: "2.0", id, result });
      } catch (e) {
        logger.warn("bridge method failed", {
          method,
          host: conn.host,
          err: e instanceof Error ? e.message : String(e),
        });
        if (isRequest) send(conn.ws, { jsonrpc: "2.0", id, error: toJsonRpcError(e) });
      }
    })();
  }

  // ---- 업그레이드 ----

  function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    // deviation(lint/correctness/noVoidTypeReturn): `return refuse(...)` 대신 호출 후 return.
    const path = (req.url ?? "/").split("?")[0];
    if (path !== BRIDGE_PATH) {
      refuse(socket, 404, "Not Found");
      return;
    }
    if (closed) {
      refuse(socket, 503, "Shutting Down");
      return;
    }
    if (token === "") {
      refuse(socket, 503, "Bridge Token Not Configured");
      return;
    }

    const auth = req.headers.authorization ?? "";
    if (!auth.startsWith("Bearer ") || !constantEquals(auth.slice(7), token)) {
      refuse(socket, 401, "Unauthorized");
      return;
    }
    const parsed = HostId.safeParse(req.headers["x-omnis-host"]);
    if (!parsed.success) {
      refuse(socket, 400, "Bad Request");
      return;
    }
    const host = parsed.data;

    wss.handleUpgrade(req, socket, head, (ws) => {
      const previous = conns.get(host);
      if (previous !== undefined) previous.ws.close(1012, "replaced by a newer bridge");
      const conn: Conn = { ws, host, alive: true };
      conns.set(host, conn);
      ws.on("pong", () => {
        conn.alive = true;
      });
      ws.on("message", (data) => onMessage(conn, String(data)));
      ws.on("error", (e: Error) => logger.warn("bridge socket error", { host, err: e.message }));
      ws.on("close", () => {
        if (conns.get(host) === conn) conns.delete(host);
        void markOffline(host).catch((e: unknown) => {
          logger.error("markOffline failed", {
            host,
            err: e instanceof Error ? e.message : String(e),
          });
        });
        logger.info("bridge disconnected", { host });
      });
      logger.info("bridge connected", { host, protocolVersion: PROTOCOL_VERSION });
    });
  }

  // ---- hub → bridge ----

  async function call<T>(
    host: HostId,
    method: HubMethod,
    params: Record<string, unknown>,
  ): Promise<T> {
    if (!HUB_METHODS.includes(method)) {
      throw new BridgeError(JSONRPC_ERRORS.METHOD_NOT_FOUND, `not a hub method: ${method}`);
    }
    if (method === "ingest.scan" || method === "ingest.read") {
      throw new BridgeError(BRIDGE_ERRORS.CAPABILITY_UNSUPPORTED, `${method} is Phase B (계약 §8)`);
    }
    const conn = conns.get(host);
    if (conn === undefined) {
      throw new BridgeError(
        BRIDGE_ERRORS.RUNTIME_UNAVAILABLE,
        `no bridge connected for host ${host}`,
      );
    }
    const id = randomUUID();
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(
          new BridgeError(
            BRIDGE_ERRORS.TURN_TIMEOUT,
            `${method} timed out after ${callTimeoutMs}ms`,
          ),
        );
      }, callTimeoutMs);
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      send(conn.ws, { jsonrpc: "2.0", id, method, params: withMeta(params) });
    });
  }

  const beat = setInterval(() => {
    for (const conn of [...conns.values()]) {
      if (!conn.alive) {
        conn.ws.terminate();
        continue;
      }
      conn.alive = false;
      conn.ws.ping();
    }
  }, heartbeatMs);
  beat.unref();

  return {
    handleUpgrade,
    call,
    hosts: () => [...conns.keys()],
    async close() {
      closed = true;
      clearInterval(beat);
      for (const w of [...waiters]) {
        w.stop();
        w.reject(new BridgeError(BRIDGE_ERRORS.RUNTIME_UNAVAILABLE, "hub is shutting down"));
      }
      waiters.clear();
      for (const p of [...pending.values()]) {
        clearTimeout(p.timer);
        p.reject(new BridgeError(BRIDGE_ERRORS.RUNTIME_UNAVAILABLE, "hub is shutting down"));
      }
      pending.clear();
      for (const conn of [...conns.values()]) conn.ws.close(1001, "hub shutting down");
      conns.clear();
      await new Promise<void>((r) => wss.close(() => r()));
    },
  };
}
