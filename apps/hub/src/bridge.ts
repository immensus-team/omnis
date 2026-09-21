import { randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { one, query } from "@omnis/db";
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
  RuntimeState,
  SessionCreateParams,
  assertProtocolVersion,
  toJsonRpcError,
  withMeta,
} from "@omnis/protocol";
import type { Pool } from "pg";
import { type WebSocket, WebSocketServer } from "ws";
import {
  HERDR_STATE,
  type SessionRow,
  type SessionStateValue,
  ensureSession,
  hasPendingApproval,
  paletteTool,
  runtimeOf,
  setSessionState,
  writeAgentItem,
} from "./sessions.js";

const BRIDGE_PATH = "/bridge";

/** Contract §3.5 SessionState → A3 §4 agent_sessions.state. The two enums use different names. */
const SESSION_STATE: Readonly<Record<string, SessionStateValue>> = {
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
  /** Value of Keychain omnis.bridge.token.<host> (injected as OMNIS_BRIDGE_TOKEN by the A6 wrapper). Empty closes the bridge. */
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
  /** Notifications are processed in arrival order — if session.registered committed after
   *  turn.item.*, we would create the same session twice or attach items to a thread that does not
   *  exist yet. Requests (approval.requested) are not put on this queue because they stay blocked
   *  until a human decides. */
  queue: Promise<void>;
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

  // ---- bridge → hub notifications ----

  async function onRegister(host: HostId, params: Record<string, unknown>): Promise<string> {
    const runtime = RuntimeKind.parse(params.runtime);
    const version = typeof params.version === "string" ? params.version : null;
    const display = typeof params.display === "string" ? params.display : `${runtime}@${host}`;
    const capabilities = (params.capabilities ?? {}) as Record<string, unknown>;
    // US-C01: the agent probes its binaries once at boot, so a runtime whose probe failed registers as
    // 'degraded' — the hub still shows it and routing skips it. Absent/garbled state keeps the old
    // behaviour (registering means "I am here") rather than failing a connection over one field.
    const parsedState = RuntimeState.safeParse(params.state);
    const state = parsedState.success ? parsedState.data : "online";
    // US-C00: runtime.registered is a request now, so the bridge learns the row's id here instead of
    // looking it up afterwards (local-agent fills runtimeIds with it — US-C01).
    const { id } = await one<{ id: string }>(
      pool,
      `INSERT INTO agent_runtimes (runtime, host, display, capabilities, version, state, last_seen_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, now())
       ON CONFLICT (runtime, host) DO UPDATE
         SET display = EXCLUDED.display, capabilities = EXCLUDED.capabilities,
             version = EXCLUDED.version, state = EXCLUDED.state, last_seen_at = now()
       RETURNING id`,
      [runtime, host, display, JSON.stringify(capabilities), version, state],
    );
    logger.info("runtime registered", { runtime, host, version, state, runtimeId: id });
    return id;
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

  /** Within one session the thread/account/runtime ids never change — so we do not look them up
   *  four times per item. Holding `state` here is what keeps us from firing an UPDATE with the
   *  same value for every item and leaking meaningless changes to Zero through sessions_notify. */
  interface CachedSession extends SessionRow {
    state: SessionStateValue | null;
    /** Between turn.started and turn.completed. Decides whether we go back to working after an approval decision. */
    turnOpen: boolean;
    /** The terminal state the last turn.completed settled on (done/failed). idle when there was no turn. */
    settled: SessionStateValue;
  }
  const sessions = new Map<string, CachedSession>();

  async function applyState(
    session: CachedSession,
    sessionKey: string,
    value: SessionStateValue,
  ): Promise<void> {
    if (session.state === value) return;
    await setSessionState(pool, session.runtimeId, sessionKey, value);
    session.state = value;
  }

  /** The single place that decides state when an approval round-trip overlaps a turn (A2 §1.3):
   *  blocked > working > the last turn's outcome.
   *  Both turn.completed and an approval decision go through here — fixing only one of them leaves
   *  the session stuck in running forever on the "approval requested → turn ended → decision"
   *  ordering. */
  async function settleState(session: CachedSession, sessionKey: string): Promise<void> {
    if (await hasPendingApproval(pool, session.threadId)) {
      await applyState(session, sessionKey, HERDR_STATE.blocked);
      return;
    }
    await applyState(session, sessionKey, session.turnOpen ? HERDR_STATE.working : session.settled);
  }

  async function sessionFor(
    host: HostId,
    sessionKey: string,
    hint: { runtime?: string; cwd?: string | null; sessionId?: string | null } = {},
  ): Promise<CachedSession> {
    const cacheKey = `${host}|${sessionKey}`;
    const cached = sessions.get(cacheKey);
    if (cached !== undefined && hint.sessionId === undefined && hint.cwd === undefined) {
      return cached;
    }
    const runtime = RuntimeKind.parse(hint.runtime ?? runtimeOf(sessionKey));
    const row = await ensureSession(pool, {
      runtime,
      host,
      sessionKey,
      ...(hint.cwd === undefined ? {} : { cwd: hint.cwd }),
      ...(hint.sessionId === undefined ? {} : { sessionId: hint.sessionId }),
    });
    const cachedRow: CachedSession = {
      ...row,
      state: cached?.state ?? null,
      turnOpen: cached?.turnOpen ?? false,
      settled: cached?.settled ?? HERDR_STATE.idle,
    };
    sessions.set(cacheKey, cachedRow);
    return cachedRow;
  }

  async function onSessionRegistered(host: HostId, params: Record<string, unknown>): Promise<void> {
    const sessionKey = String(params.session_key);
    const sessionId = typeof params.session_id === "string" ? params.session_id : null;
    const mapped = typeof params.state === "string" ? SESSION_STATE[params.state] : undefined;
    // A session the bridge opened on its own side must show up in the inbox too — create it here
    // if missing (0007's sessions_notify trigger fires the NOTIFY, so emitting here would send it
    // twice).
    const session = await sessionFor(host, sessionKey, {
      ...(typeof params.runtime === "string" ? { runtime: params.runtime } : {}),
      sessionId,
    });
    if (mapped !== undefined) {
      await applyState(session, sessionKey, mapped);
    }
  }

  // ---- turn.* → items (A2 §4.1, A2-D4) ----

  async function onTurnNotification(
    host: HostId,
    method: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    await kernel.events.emit("ephemeral", method, { ...params, host });
    if (method === "turn.item.delta") return; // A2-D4: deltas are never persisted
    const sessionKey = typeof params.session_key === "string" ? params.session_key : "";
    if (sessionKey === "") return;
    const session = await sessionFor(host, sessionKey);
    const turnId = String(params.turn_id ?? "");

    if (method === "turn.started") {
      session.turnOpen = true;
      await applyState(session, sessionKey, HERDR_STATE.working);
      return;
    }
    if (method === "turn.completed") {
      const ok = params.status === "ok";
      // master §11: execution surfaces as a single kind='system' line.
      await writeAgentItem(pool, {
        session,
        externalId: `${sessionKey}|${turnId}|turn`,
        kind: "system",
        body: ok ? "✓ Turn completed" : "⚠ Turn failed",
        tool: null,
      });
      session.turnOpen = false;
      session.settled = ok ? HERDR_STATE.done : "failed";
      await settleState(session, sessionKey);
      return;
    }

    const started = method === "turn.item.started";
    const kind = params.kind === "tool_call" ? "tool_call" : "agent_turn";
    const meta = (params.meta ?? {}) as Record<string, unknown>;
    const rawTool = String(meta.label ?? meta.tool ?? params.label ?? "");
    await writeAgentItem(pool, {
      session,
      externalId: `${sessionKey}|${turnId}|${String(params.item_id ?? "")}`,
      kind,
      body: started ? "" : String(params.body ?? ""),
      tool:
        kind === "tool_call"
          ? {
              name: paletteTool(rawTool),
              label: rawTool,
              state: started ? "loading" : params.status === "failed" ? "error" : "done",
              args: meta.input ?? {},
            }
          : null,
    });
    if (started) {
      session.turnOpen = true;
      await applyState(session, sessionKey, HERDR_STATE.working);
    }
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
      // A decision may have landed between propose and subscribe — read it once directly.
      void readDecision(id).then((r) => {
        if (r !== null) settle(r);
      }, reject);
    });
  }

  async function onApprovalRequested(
    host: HostId,
    params: Record<string, unknown>,
  ): Promise<HumanResponse> {
    const interrupt = HumanInterrupt.parse(params.interrupt);
    const sessionKey = typeof params.session_key === "string" ? params.session_key : "";
    // Attach the approval to the session's thread: the ApprovalCard shows up in that thread, and
    // that same thread_id is the sole basis for judging whether turn.completed means blocked or
    // done (A2 §1.3).
    // Even when the session cannot be resolved, the approval itself always goes up — something we
    // must ask a human about cannot be swallowed just because of runtime registration ordering. We
    // give up only the link and the blocked indicator.
    const session =
      sessionKey === ""
        ? null
        : await sessionFor(host, sessionKey).catch((e) => {
            logger.warn("approval has no resolvable session", {
              sessionKey,
              err: e instanceof Error ? e.message : String(e),
            });
            return null;
          });
    const linked =
      session === null || interrupt.thread_id !== undefined
        ? interrupt
        : { ...interrupt, thread_id: session.threadId };
    const id = await kernel.approvals.propose(linked);
    logger.info("approval requested by bridge", { id, action: interrupt.action });
    if (session !== null) {
      await applyState(session, sessionKey, HERDR_STATE.blocked);
    }
    try {
      return await waitForDecision(id);
    } finally {
      // A decision landed, so recompute. Unconditionally forcing working back would mean that
      // when an approval finishes after its turn (A2 §1.3, "approval requested → turn ended →
      // decision") there is never another chance to settle on done.
      if (session !== null) await settleState(session, sessionKey);
    }
  }

  // ---- dispatch ----

  async function dispatch(
    conn: Conn,
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    if (method === "runtime.registered") {
      // US-C00: the upsert's id goes back to the bridge. A notification without an id still runs;
      // onMessage drops the result for anything that is not a request.
      return { runtime_id: await onRegister(conn.host, params) };
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
      await onTurnNotification(conn.host, method, params);
      return null;
    }
    if (method === "approval.requested") {
      return await onApprovalRequested(conn.host, params);
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

    // response to a hub → bridge request
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

    const run = async (): Promise<void> => {
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
    };
    if (isRequest) void run();
    else conn.queue = conn.queue.then(run);
  }

  // ---- upgrade ----

  function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    // deviation(lint/correctness/noVoidTypeReturn): call then return, rather than `return refuse(...)`.
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
      const conn: Conn = { ws, host, alive: true, queue: Promise.resolve() };
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
      throw new BridgeError(
        BRIDGE_ERRORS.CAPABILITY_UNSUPPORTED,
        `${method} is Phase B (contract §8)`,
      );
    }
    // Check connectivity first — do not create session rows or throw on parameters for a host that
    // is not even attached.
    if (!conns.has(host)) {
      throw new BridgeError(
        BRIDGE_ERRORS.RUNTIME_UNAVAILABLE,
        `no bridge connected for host ${host}`,
      );
    }
    if (method === "session.create") {
      const p = SessionCreateParams.parse(params);
      // The bridge re-validates cwd first (A2-D12) — so we never leave a row behind for a session
      // it rejected.
      await rpc<unknown>(host, method, params);
      const session = await sessionFor(host, p.session_key, { runtime: p.runtime, cwd: p.cwd });
      await applyState(session, p.session_key, HERDR_STATE.idle);
      // Discard the thread_id the bridge returned: the thread belongs to the hub (A3 §4).
      return { session_id: null, thread_id: session.threadId } as T;
    }
    if (method === "session.resume") {
      const sessionKey = String((params as { session_key?: unknown }).session_key ?? "");
      const result = await rpc<{ session_id: string; restored: boolean }>(host, method, params);
      const session = await sessionFor(host, sessionKey, {
        sessionId: result.session_id === "" ? null : result.session_id,
      });
      await applyState(session, sessionKey, HERDR_STATE.idle);
      return result as T;
    }
    return await rpc<T>(host, method, params);
  }

  async function rpc<T>(
    host: HostId,
    method: HubMethod,
    params: Record<string, unknown>,
  ): Promise<T> {
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
