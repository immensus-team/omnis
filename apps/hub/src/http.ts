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
  undoArchive,
} from "@omnis/kernel";
import { searchMemories } from "@omnis/memory";
import type { Adapter } from "@omnis/protocol";
import type { Pool } from "pg";
import { type ArchiveRouteDeps, handleDigestUndo, handleUnarchiveItem } from "./archive-routes.js";
import { setThreadArchived } from "./archive.js";
import type { HubConfig } from "./config.js";
import { NOTE_MAX_CHARS, createNote, decideNoteRouting } from "./notes.js";
import { removeSubscription, saveSubscription } from "./push.js";
import { createSearchDeps, runSearch } from "./search.js";
import { isValidSettingKey } from "./settings.js";
import { clampLastN, loadTranscript } from "./transcript.js";

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

// US-A21b: HS256 is a one-liner, so jose is not pulled in for it. The only thing signed is the
// header/payload the hub just built, and zero-cache does the verifying — nothing here ever parses
// a token this process did not mint.
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
  /** Channel adapter for archive write-back (US-A36). Without one, archiving stays local — see archive.ts. */
  adapters?: ReadonlyMap<string, Adapter>;
  /** Task 26 (hub-bridge-ws) plugs WS /bridge in here. Without it, upgrades get a 501. */
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
  const searchDeps = createSearchDeps(pool);
  // Delta §7: with no VAPID keypair every /push/* route is 503 — the browser can neither read a key
  // to subscribe with nor store a subscription nothing could ever deliver to. Checked once here
  // rather than per route, because "not configured" is a property of the whole family.
  const webpushConfigured = config.webpushVapidPublic !== "" && config.webpushVapidPrivate !== "";
  // US-B32: partly applied here so archive-routes.ts never has to know about pg or the audit sink.
  const archiveRouteDeps: ArchiveRouteDeps = {
    undoArchive: (ref, actor) => undoArchive(pool, ref, actor, kernel.audit),
  };

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

    // US-A36 manual archive/unarchive. Same boundary as the other routes (bound to 127.0.0.1), and
    // not behind the master §7 approval gate (only send/delete/delegate/calendar_write are) — see
    // the comment in archive.ts.
    // The `/api` prefix is optional: Tailscale Serve strips it when forwarding /api → 8787, so on
    // the mini this arrives as /threads/…, while the desktop calling 127.0.0.1:8787 directly uses
    // /api/threads/….
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

    // US-B32 (delta §7). The per-item restore: the same kernel `undoArchive` the thread route's
    // sibling reaches, one item at a time, which is the unit A4 §9 archives in. The optional /api
    // prefix matches the thread route above (Tailscale Serve strips it).
    const unarchiveItem = /^(?:\/api)?\/items\/([0-9a-fA-F-]{36})\/unarchive$/.exec(path);
    if (unarchiveItem !== null) {
      if (method !== "POST") return send(res, 405, { error: "method not allowed" });
      const id = unarchiveItem[1];
      if (id === undefined) return send(res, 400, { error: "bad id" });
      return send(res, 200, await handleUnarchiveItem(archiveRouteDeps, id));
    }

    // US-B32's "Restore all" for one digest category. The body carries the token because that is
    // what the archived items were stamped with; the path's id is the row the screen was showing.
    const digestUndo = /^(?:\/api)?\/digests\/([0-9a-fA-F-]{36})\/undo$/.exec(path);
    if (digestUndo !== null) {
      if (method !== "POST") return send(res, 405, { error: "method not allowed" });
      let body: unknown;
      try {
        body = await readJson(req);
      } catch {
        return send(res, 400, { error: "invalid json body" });
      }
      const token = (body as { undo_token?: unknown }).undo_token;
      if (typeof token !== "string" || token === "") {
        return send(res, 400, { error: "expected { undo_token: string }" });
      }
      return send(res, 200, await handleDigestUndo(archiveRouteDeps, token));
    }

    // The token the desktop uses to attach to zero-cache. Same boundary as the other hub routes
    // (bound to 127.0.0.1).
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

    // US-B26 / A4 §14. Synchronous, no agent_runs row. `scope`/`since` are accepted but not
    // applied yet — A4 §14.2's query table carries no filter for them (see search.ts).
    if (path === "/search") {
      if (method !== "GET") return send(res, 405, { error: "method not allowed" });
      const q = url.searchParams.get("q");
      if (q === null || q.trim() === "") return send(res, 400, { error: "q is required" });
      const kParam = url.searchParams.get("k");
      const k = kParam === null ? undefined : Number(kParam);
      if (k !== undefined && (!Number.isInteger(k) || k < 1)) {
        return send(res, 400, { error: "bad k" });
      }
      return send(res, 200, await runSearch(searchDeps, { q, ...(k === undefined ? {} : { k }) }));
    }

    if (path === "/memory/search") {
      if (method !== "GET") return send(res, 405, { error: "method not allowed" });
      const q = url.searchParams.get("q");
      if (q === null || q.trim() === "") return send(res, 400, { error: "q is required" });
      return send(res, 200, { results: await searchMemories(pool, { query: q }) });
    }

    if (path.startsWith("/transcript/")) {
      if (method !== "GET") return send(res, 405, { error: "method not allowed" });
      const sessionId = path.slice("/transcript/".length);
      // A non-uuid would make Postgres throw 22P02 — reject it with a clean 400 first.
      if (!/^[0-9a-f-]{36}$/i.test(sessionId))
        return send(res, 400, { error: "invalid session_id" });
      const summary = await loadTranscript(
        pool,
        sessionId,
        clampLastN(url.searchParams.get("last_n")),
      );
      if (summary === null) return send(res, 404, { error: "session not found" });
      return send(res, 200, summary);
    }

    // Delta §7 (US-B31): the Notes screen's two writes. POST /notes itself is not in the delta's
    // route table — it was listed as a follow-up task, but the L7 routing loop is triggered by
    // `note.created` and this is the only place that event can come from, so without it a note is
    // written by nobody and routed by nothing.
    if (path === "/notes") {
      if (method !== "POST") return send(res, 405, { error: "method not allowed" });
      let body: unknown;
      try {
        body = await readJson(req);
      } catch {
        return send(res, 400, { error: "invalid json body" });
      }
      if (
        typeof body !== "object" ||
        body === null ||
        typeof (body as { body?: unknown }).body !== "string"
      ) {
        return send(res, 400, { error: "expected { body: string }" });
      }
      const note = await createNote(pool, kernel.events, (body as { body: string }).body);
      if (note === null) {
        return send(res, 400, {
          error: `note body must be 1..${String(NOTE_MAX_CHARS)} characters`,
        });
      }
      return send(res, 201, note);
    }

    const noteRoute = /^\/notes\/([0-9a-fA-F-]{36})\/route$/.exec(path);
    if (noteRoute !== null) {
      if (method !== "POST") return send(res, 405, { error: "method not allowed" });
      const id = noteRoute[1];
      if (id === undefined) return send(res, 400, { error: "bad id" });
      let body: unknown;
      try {
        body = await readJson(req);
      } catch {
        return send(res, 400, { error: "invalid json body" });
      }
      const b = body as { accept?: unknown; thread_id?: unknown; person_id?: unknown };
      if (typeof b.accept !== "boolean") {
        return send(res, 400, { error: "expected { accept: boolean, thread_id?, person_id? }" });
      }
      for (const [key, value] of [
        ["thread_id", b.thread_id],
        ["person_id", b.person_id],
      ] as const) {
        if (value !== undefined && (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value))) {
          return send(res, 400, { error: `bad ${key}` });
        }
      }
      const outcome = await decideNoteRouting(pool, id, {
        accept: b.accept,
        ...(typeof b.thread_id === "string" ? { thread_id: b.thread_id } : {}),
        ...(typeof b.person_id === "string" ? { person_id: b.person_id } : {}),
      });
      if (!outcome.ok) {
        if (outcome.reason === "not_found") return send(res, 404, { error: "note not found" });
        if (outcome.reason === "not_proposed") {
          return send(res, 409, { error: "note is not awaiting a routing decision" });
        }
        return send(res, 400, { error: "accept needs exactly one of thread_id, person_id" });
      }
      return send(res, 200, { id, route_state: outcome.route_state });
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

    // Delta §7 (US-B36): the PWA's Web Push subscription. There is no sending path here — the
    // browser's Approve button reuses POST /approvals/:id/decide as-is, and delivery is
    // @omnis/kernel's sendWebPush (single owner, cross review M-webpush). The hub only hands out the
    // public key and stores/removes what the browser subscribed with.
    // The /api prefix is optional for the same reason the thread/item routes allow it (Tailscale
    // Serve strips it), and the PWA reaches these through apps/web's dev proxy in dev.
    const pushPath = path.startsWith("/api/push/") ? path.slice("/api".length) : path;
    if (pushPath === "/push/vapid-public-key" || pushPath === "/push/subscribe") {
      if (!webpushConfigured) return send(res, 503, { error: "web push is not configured" });

      if (pushPath === "/push/vapid-public-key") {
        if (method !== "GET") return send(res, 405, { error: "method not allowed" });
        return send(res, 200, { key: config.webpushVapidPublic });
      }

      if (method === "POST") {
        let body: unknown;
        try {
          body = await readJson(req);
        } catch {
          return send(res, 400, { error: "invalid json body" });
        }
        const b = body as {
          endpoint?: unknown;
          keys?: { p256dh?: unknown; auth?: unknown };
          ua?: unknown;
        };
        if (
          typeof b.endpoint !== "string" ||
          typeof b.keys?.p256dh !== "string" ||
          typeof b.keys?.auth !== "string"
        ) {
          return send(res, 400, { error: "expected PushSubscription shape" });
        }
        const id = await saveSubscription(pool, {
          endpoint: b.endpoint,
          keys: { p256dh: b.keys.p256dh, auth: b.keys.auth },
          ...(typeof b.ua === "string" ? { ua: b.ua } : {}),
        });
        return send(res, 200, { id });
      }

      if (method === "DELETE") {
        let body: unknown;
        try {
          body = await readJson(req);
        } catch {
          return send(res, 400, { error: "invalid json body" });
        }
        const b = body as { endpoint?: unknown };
        if (typeof b.endpoint !== "string") {
          return send(res, 400, { error: "expected { endpoint: string }" });
        }
        return send(res, 200, { removed: await removeSubscription(pool, b.endpoint) });
      }

      return send(res, 405, { error: "method not allowed" });
    }

    return send(res, 404, { error: "not found" });
  }

  server.on("upgrade", (req, socket, head) => {
    if (deps.onUpgrade !== undefined) {
      deps.onUpgrade(req, socket, head as Buffer);
      return;
    }
    // WS /bridge is wired up by Task 26.
    socket.write("HTTP/1.1 501 Not Implemented\r\n\r\n");
    socket.destroy();
  });

  return server;
}
