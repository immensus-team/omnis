// GET /transcript/:session_id over real HTTP (delta §7). transcript.test.ts covers the
// pure buildSessionSummary/clampLastN logic; this covers the wiring in http.ts — the
// uuid guard, the 404, and that the summary actually reaches the wire.
import type { AddressInfo } from "node:net";
import { createPool, query } from "@omnis/db";
import { type Kernel, createKernel, createLogger } from "@omnis/kernel";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HUB_VERSION } from "../../src/config.js";
import { createHubServer } from "../../src/http.js";

let base = "";
let kernel: Kernel;
let pool: Pool;
let close: () => Promise<void>;
let sessionId = "";

beforeAll(async () => {
  pool = createPool();
  kernel = createKernel({ pool });
  const server = createHubServer({
    kernel,
    pool,
    config: {
      port: 0,
      host: "127.0.0.1",
      version: HUB_VERSION,
      bridgeToken: "",
      userId: "logan",
      zeroAuthSecret: "test-zero-secret",
    },
    logger: createLogger("@omnis/hub"),
    startedAt: Date.now(),
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address() as AddressInfo;
  base = `http://127.0.0.1:${addr.port}`;
  close = async () => {
    await new Promise<void>((r) => server.close(() => r()));
    await kernel.close();
    await pool.end();
  };

  const one = async <T>(sql: string, params: unknown[] = []): Promise<T> => {
    const rows = await query<T>(pool, sql, params);
    const row = rows[0];
    if (row === undefined) throw new Error(`seed returned no row: ${sql}`);
    return row;
  };
  const runtime = await one<{ id: string }>(
    `INSERT INTO agent_runtimes (runtime, host, display, state)
     VALUES ('claude_code','macbook','seed','online')
     ON CONFLICT (runtime, host) DO UPDATE SET display = EXCLUDED.display RETURNING id`,
  );
  const account = await one<{ id: string }>(
    `INSERT INTO accounts (channel, external_id, display)
     VALUES ('agent','transcript-route','seed') RETURNING id`,
  );
  const thread = await one<{ id: string }>(
    `INSERT INTO threads (account_id, external_id, kind)
     VALUES ($1,'transcript-route','agent_session') RETURNING id`,
    [account.id],
  );
  const session = await one<{ id: string }>(
    `INSERT INTO agent_sessions (runtime_id, thread_id, session_key, summary, last_turn_at, state)
     VALUES ($1,$2,'agent:claude_code:macbook:omnis','durable summary', now(), 'running')
     RETURNING id`,
    [runtime.id, thread.id],
  );
  sessionId = session.id;
  await query(
    pool,
    `INSERT INTO items (thread_id, account_id, kind, body, sent_at)
     VALUES ($1,$2,'agent_turn','first turn', now() - interval '2 min'),
            ($1,$2,'agent_turn','second turn', now() - interval '1 min')`,
    [thread.id, account.id],
  );
});

afterAll(async () => {
  await close();
});

describe("GET /transcript/:session_id", () => {
  it("returns the SessionSummary for a real session", async () => {
    const res = await fetch(`${base}/transcript/${sessionId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.session_key).toBe("agent:claude_code:macbook:omnis");
    expect(body.runtime).toBe("claude_code");
    expect(body.host).toBe("macbook");
    expect(body.state).toBe("running");
    expect(body.summary).toBe("durable summary");
    expect(body.turn_count).toBe(2);
    const turns = body.recent_turns as { text: string }[];
    expect(turns.map((t) => t.text)).toEqual(["first turn", "second turn"]);
  });

  it("400s a non-uuid session_id instead of letting Postgres throw 22P02", async () => {
    const res = await fetch(`${base}/transcript/abc`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid session_id" });
  });

  it("404s a well-formed uuid that has no session", async () => {
    const res = await fetch(`${base}/transcript/22222222-2222-2222-2222-222222222222`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "session not found" });
  });

  it("405s a non-GET method", async () => {
    const res = await fetch(`${base}/transcript/${sessionId}`, { method: "POST" });
    expect(res.status).toBe(405);
  });

  it("?last_n narrows the turn window instead of always returning up to 10", async () => {
    const res = await fetch(`${base}/transcript/${sessionId}?last_n=1`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { recent_turns: { text: string }[] };
    expect(body.recent_turns.map((t) => t.text)).toEqual(["second turn"]);
  });
});
