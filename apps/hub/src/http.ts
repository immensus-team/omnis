import { createHmac } from "node:crypto";
import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import type { Duplex } from "node:stream";
import { query } from "@omnis/db";
import {
  ApprovalStateError,
  type Kernel,
  type Logger,
  currentPolicy,
  getAllSettings,
  getSetting,
  killSwitchStatus,
  setSetting,
} from "@omnis/kernel";
import type { Adapter } from "@omnis/protocol";
import type { Pool } from "pg";
import { setThreadArchived } from "./archive.js";
import type { HubConfig } from "./config.js";
import { isValidSettingKey } from "./settings.js";

const APPROVAL_STATES = [
  "pending",
  "decided",
  "executing",
  "executed",
  "failed",
  "expired",
] as const;
const MAX_BODY_BYTES = 64 * 1024;
const ZERO_TOKEN_TTL_SEC = 7 * 24 * 60 * 60;

// US-A21b: HS256 한 줄짜리라 jose를 새로 끌어오지 않는다. 서명 대상은 허브가 방금 만든
// 헤더/페이로드뿐이고 검증은 zero-cache가 한다 — 여기서 남의 토큰을 파싱할 일은 없다.
const b64url = (v: object): string => Buffer.from(JSON.stringify(v)).toString("base64url");

function signZeroToken(sub: string, secret: string, nowSec: number): string {
  const body = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub, exp: nowSec + ZERO_TOKEN_TTL_SEC })}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

export interface HubServerDeps {
  kernel: Kernel;
  pool: Pool;
  config: HubConfig;
  logger: Logger;
  startedAt: number;
  /** 보관 write-back용 채널 어댑터(US-A36). 없으면 로컬 보관만 한다 — archive.ts 참조. */
  adapters?: ReadonlyMap<string, Adapter>;
  /** Task 26(hub-bridge-ws)이 WS /bridge를 여기에 꽂는다. 주입 안 되면 업그레이드는 501이다. */
  onUpgrade?: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new SyntaxError("body too large");
    chunks.push(buf);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createHubServer(deps: HubServerDeps): Server {
  const { kernel, pool, config, logger, startedAt } = deps;

  const server = createServer((req, res) => {
    void handle(req, res).catch((e: unknown) => {
      logger.error("route threw", {
        url: req.url,
        err: e instanceof Error ? e.message : String(e),
      });
      if (!res.headersSent) send(res, 500, { error: "internal" });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${config.host}:${config.port}`);
    const path = url.pathname;
    const method = req.method ?? "GET";

    if (path === "/health") {
      if (method !== "GET") return send(res, 405, { error: "method not allowed" });
      let db: "up" | "down" = "up";
      try {
        await query(pool, "SELECT 1");
      } catch {
        db = "down";
      }
      return send(res, 200, {
        ok: db === "up",
        version: config.version,
        db,
        uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
        killSwitch: await kernel.killSwitch.isOn(),
      });
    }

    if (path === "/approvals") {
      if (method !== "GET") return send(res, 405, { error: "method not allowed" });
      const stateParam = url.searchParams.get("state");
      if (
        stateParam !== null &&
        !APPROVAL_STATES.includes(stateParam as (typeof APPROVAL_STATES)[number])
      ) {
        return send(res, 400, { error: `unknown state: ${stateParam}` });
      }
      const limitParam = url.searchParams.get("limit");
      const limit = limitParam === null ? 50 : Number(limitParam);
      if (!Number.isInteger(limit) || limit < 1) return send(res, 400, { error: "bad limit" });
      const approvals = await kernel.approvals.list({
        ...(stateParam !== null ? { state: stateParam as (typeof APPROVAL_STATES)[number] } : {}),
        limit,
      });
      return send(res, 200, { approvals });
    }

    const decide = /^\/approvals\/([0-9a-fA-F-]{36})\/decide$/.exec(path);
    if (decide !== null) {
      if (method !== "POST") return send(res, 405, { error: "method not allowed" });
      const id = decide[1];
      if (id === undefined) return send(res, 400, { error: "bad id" });
      let body: unknown;
      try {
        body = await readJson(req);
      } catch {
        return send(res, 400, { error: "invalid json body" });
      }
      try {
        await kernel.approvals.decide(id, body);
      } catch (e) {
        if (e instanceof ApprovalStateError) return send(res, 409, { error: e.message });
        return send(res, 400, { error: e instanceof Error ? e.message : "bad request" });
      }
      return send(res, 200, { id, state: "decided" });
    }

    // US-A36 수동 보관/되살리기. 다른 라우트와 같은 경계(127.0.0.1 bind)이고, 마스터 §7의 승인
    // 게이트 대상이 아니다(send/delete/delegate/calendar_write만 승인을 탄다) — archive.ts 주석 참조.
    // `/api` 접두는 선택이다: Tailscale Serve가 /api → 8787에서 접두를 떼고 넘기므로 미니에서는
    // /threads/…로 도착하고, 데스크톱이 직접 127.0.0.1:8787로 부를 때는 /api/threads/…로 온다.
    const archiveRoute = /^(?:\/api)?\/threads\/([0-9a-fA-F-]{36})\/(archive|unarchive)$/.exec(
      path,
    );
    if (archiveRoute !== null) {
      if (method !== "POST") return send(res, 405, { error: "method not allowed" });
      const id = archiveRoute[1];
      if (id === undefined) return send(res, 400, { error: "bad id" });
      const result = await setThreadArchived(
        { pool, kernel, logger, ...(deps.adapters ? { adapters: deps.adapters } : {}) },
        id,
        archiveRoute[2] === "archive",
      );
      if (result === null) return send(res, 404, { error: "thread not found" });
      return send(res, 200, result);
    }

    // 데스크톱이 zero-cache에 붙을 때 쓰는 토큰. 다른 허브 라우트와 같은 경계(127.0.0.1 bind)다.
    if (path === "/api/zero-token") {
      if (method !== "GET") return send(res, 405, { error: "method not allowed" });
      if (config.zeroAuthSecret === "") {
        return send(res, 503, { error: "ZERO_AUTH_SECRET is not configured" });
      }
      const nowSec = Math.floor(Date.now() / 1000);
      return send(res, 200, {
        token: signZeroToken(config.userId, config.zeroAuthSecret, nowSec),
        expiresAt: (nowSec + ZERO_TOKEN_TTL_SEC) * 1000,
      });
    }

    if (path === "/kill-switch") {
      if (method === "GET") return send(res, 200, await killSwitchStatus(pool));
      if (method === "POST") {
        let body: unknown;
        try {
          body = await readJson(req);
        } catch {
          return send(res, 400, { error: "invalid json body" });
        }
        const b = body as { on?: unknown; reason?: unknown };
        if (typeof b.on !== "boolean" || typeof b.reason !== "string" || b.reason.length === 0) {
          return send(res, 400, { error: "expected { on: boolean, reason: string }" });
        }
        await kernel.killSwitch.set(b.on, b.reason);
        const status = await killSwitchStatus(pool);
        return send(res, 200, { on: status.on, since: status.since });
      }
      return send(res, 405, { error: "method not allowed" });
    }

    // Delta §7 (US-B33): Settings screen reads, settings write, and the cost banner.
    if (path === "/settings") {
      if (method !== "GET") return send(res, 405, { error: "method not allowed" });
      return send(res, 200, { settings: await getAllSettings(pool) });
    }

    const putSetting = /^\/settings\/([a-z0-9_.]+)$/.exec(path);
    if (putSetting !== null) {
      if (method !== "PUT") return send(res, 405, { error: "method not allowed" });
      const key = putSetting[1];
      if (key === undefined) return send(res, 400, { error: "bad key" });
      // Unknown key is checked before the body so a typo costs no read and no write.
      if (!isValidSettingKey(key)) return send(res, 404, { error: "unknown setting" });
      let body: unknown;
      try {
        body = await readJson(req);
      } catch {
        return send(res, 400, { error: "invalid json body" });
      }
      if (typeof body !== "object" || body === null || !("value" in body)) {
        return send(res, 400, { error: "expected { value: unknown }" });
      }
      // Single-user repo: the actor is hardcoded until there is a real session to read it from.
      await setSetting(pool, key, body.value, "me");
      return send(res, 200, { key, value: body.value });
    }

    if (path === "/cost") {
      if (method !== "GET") return send(res, 405, { error: "method not allowed" });
      const { state, policy, mtdUsd, reserveUsd } = await currentPolicy(pool);
      // currentPolicy reads the cap internally but does not report it; the banner needs it.
      const capUsd = await getSetting(pool, "cost.cap_usd", 60);
      return send(res, 200, { state, mtdUsd, capUsd, reserveUsd, policy });
    }

    // /search, /memory/search, /transcript/:id는 다른 부록이 소유한다(계약 §5) — Phase A는 열지 않는다.
    return send(res, 404, { error: "not found" });
  }

  server.on("upgrade", (req, socket, head) => {
    if (deps.onUpgrade !== undefined) {
      deps.onUpgrade(req, socket, head as Buffer);
      return;
    }
    // WS /bridge는 Task 26이 붙인다.
    socket.write("HTTP/1.1 501 Not Implemented\r\n\r\n");
    socket.destroy();
  });

  return server;
}
