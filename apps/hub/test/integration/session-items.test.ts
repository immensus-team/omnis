// US-A34: 브리지 이벤트 → 인박스 item. mock 런타임 픽스처를 실제 어댑터가 파싱하고,
// 실제 HubClient가 실제 WS /bridge로 쏘고, 허브가 items/agent_sessions에 쓴다.
// 시드의 bridgeSink 같은 우회로가 없다는 것이 이 파일이 지키는 것이다.
import type { AddressInfo } from "node:net";
import { createPool, query } from "@omnis/db";
import { type Kernel, createKernel, createLogger } from "@omnis/kernel";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { ClaudeCodeAdapter } from "../../../local-agent/src/bridges/claude-code.js";
import { HubClient } from "../../../local-agent/src/hub-client.js";
import { createHubSink } from "../../../local-agent/src/hub-sink.js";
import type { SessionRecord } from "../../../local-agent/src/session-registry.js";
import { FIXTURES, mockSpawn } from "../../../local-agent/test/mock-runtime.js";
import { type BridgeHub, createBridgeHub } from "../../src/bridge.js";
import { readConfig } from "../../src/config.js";
import { createHubServer } from "../../src/http.js";
import { HERDR_STATE, hasPendingApproval } from "../../src/sessions.js";

const TOKEN = "test-session-items-token";
const SESSION_KEY = "agent:claude_code:macbook:inbox-draft";

let pool: Pool;
let kernel: Kernel;
let bridge: BridgeHub;
let server: ReturnType<typeof createHubServer>;
let client: HubClient;
let threadId: string;

const logger = createLogger("@omnis/hub", { sink: () => {} });

const session: SessionRecord = {
  session_key: SESSION_KEY,
  session_id: null,
  runtime: "claude_code",
  runtime_id: "00000000-0000-0000-0000-000000000000",
  cwd: process.cwd(),
  purpose: "inbox:draft",
  origin: "job",
  permission_profile: "observe",
  state: "idle",
  opened_at: new Date().toISOString(),
  last_turn_at: null,
};

async function until<T>(fn: () => Promise<T | null>, ms = 15_000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const v = await fn();
    if (v !== null) return v;
    if (Date.now() - started > ms) throw new Error("condition never became true");
    await new Promise((r) => setTimeout(r, 50));
  }
}

beforeAll(async () => {
  pool = createPool();
  kernel = createKernel({ pool, logger });
  bridge = createBridgeHub({ kernel, pool, logger, token: TOKEN, heartbeatMs: 5_000 });
  server = createHubServer({
    kernel,
    pool,
    config: readConfig({ DATABASE_URL: "postgres://x/y", OMNIS_HUB_PORT: "8788" }),
    logger,
    startedAt: Date.now(),
    onUpgrade: (req, socket, head) => bridge.handleUpgrade(req, socket, head),
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;

  // 이 세션 키로 남은 앞선 실행의 흔적을 지운다(items는 thread CASCADE로 같이 지워진다).
  await query(pool, "DELETE FROM threads WHERE external_id = $1", [SESSION_KEY]);

  client = new HubClient({
    url: `ws://127.0.0.1:${port}/bridge`,
    token: TOKEN,
    host: "macbook",
    logger,
    connect: (url, headers) => new WebSocket(url, { headers }) as never,
    dispatch: async () => null,
  });
  await client.start();
  await until(async () => (client.connected ? true : null));

  client.notify("runtime.registered", {
    runtime: "claude_code",
    host: "macbook",
    version: "2.1.274",
    capabilities: { resume: true, tool_calls: true },
  });
  const runtime = await until(async () => {
    const rows = await query<{ id: string }>(
      pool,
      "SELECT id FROM agent_runtimes WHERE runtime = 'claude_code' AND host = 'macbook' AND state = 'online'",
    );
    return rows[0] ?? null;
  });
  session.runtime_id = runtime.id;

  const adapter = new ClaudeCodeAdapter({
    kind: "claude_code",
    binary: "claude",
    defaultModel: "sonnet",
    spawnFn: mockSpawn(FIXTURES.claudeToolCall),
  });
  await adapter.startTurn(
    session,
    { text: "inbox 초안 한 건" },
    createHubSink({ client, session, turnId: "t-int-1", logger }),
  );

  const row = await until(async () => {
    const rows = await query<{ thread_id: string }>(
      pool,
      "SELECT thread_id FROM agent_sessions WHERE session_key = $1",
      [SESSION_KEY],
    );
    return rows[0] ?? null;
  });
  threadId = row.thread_id;
  await until(async () => {
    const rows = await query<{ n: string }>(
      pool,
      "SELECT count(*) AS n FROM items WHERE thread_id = $1 AND kind = 'system'",
      [threadId],
    );
    return Number(rows[0]?.n ?? 0) > 0 ? true : null;
  });
});

afterAll(async () => {
  client.stop();
  await bridge.close();
  await new Promise<void>((r) => server.close(() => r()));
  await kernel.close();
  await pool.end();
});

describe("bridge session → inbox (US-A34)", () => {
  it("creates the agent_session thread from session.registered alone", async () => {
    const rows = await query<{ kind: string; title: string; channel: string }>(
      pool,
      `SELECT t.kind, t.title, a.channel FROM threads t
         JOIN accounts a ON a.id = t.account_id WHERE t.external_id = $1`,
      [SESSION_KEY],
    );
    expect(rows[0]?.kind).toBe("agent_session");
    expect(rows[0]?.channel).toBe("agent");
    expect(rows[0]?.title).toBe("claude_code · inbox-draft");
  });

  it("binds the rotating session_id the runtime reported", async () => {
    const rows = await query<{ session_id: string | null }>(
      pool,
      "SELECT session_id FROM agent_sessions WHERE session_key = $1",
      [SESSION_KEY],
    );
    expect(rows[0]?.session_id).toBe("s-mock-1");
  });

  it("persists the assistant turn, the tool call and the lifecycle line", async () => {
    const rows = await query<{ kind: string; body: string; tool: Record<string, unknown> | null }>(
      pool,
      "SELECT kind, body, tool FROM items WHERE thread_id = $1 ORDER BY kind, body",
      [threadId],
    );
    const turn = rows.find((r) => r.kind === "agent_turn");
    expect(turn?.body).toBe("Listing src/.");

    const tool = rows.find((r) => r.kind === "tool_call");
    // ToolCallBadge가 읽는 shape: master §11 팔레트 이름 + 배지 상태.
    expect(tool?.tool).toMatchObject({ name: "read", label: "Bash", state: "done" });
    expect(tool?.body).toContain("index.ts");

    expect(rows.find((r) => r.kind === "system")?.body).toBe("✓ 턴 완료");
  });

  it("stores no delta: one row per item plus the turn line (A2-D4)", async () => {
    const rows = await query<{ n: string }>(
      pool,
      "SELECT count(*) AS n FROM items WHERE thread_id = $1",
      [threadId],
    );
    expect(Number(rows[0]?.n)).toBe(3);
  });

  it("lands the session on the herdr 'done' state after the turn", async () => {
    const rows = await query<{ state: string; last_turn_at: Date | null }>(
      pool,
      "SELECT state, last_turn_at FROM agent_sessions WHERE session_key = $1",
      [SESSION_KEY],
    );
    expect(rows[0]?.state).toBe("idle");
    expect(rows[0]?.last_turn_at).not.toBeNull();
  });

  // 이 턴은 beforeAll에서 이미 turn.completed까지 끝났다 — 승인이 턴보다 늦게 끝나는
  // A2 §1.3의 순서(승인 요청 → 턴 종료 → 결정)다. 결정 뒤 종착지는 done이지 working이 아니다.
  it("blocks on approval.requested and settles to done — not working — on the decision", async () => {
    const asked = client.request("approval.requested", {
      session_key: SESSION_KEY,
      turn_id: "t-int-1",
      interrupt: {
        action: "send",
        args: { text: "보냅니다" },
        description: "US-A34 승인 왕복",
        config: { allow_accept: true, allow_edit: true, allow_respond: false, allow_ignore: true },
      },
    });
    const state = async (): Promise<string> =>
      (
        await query<{ state: string }>(
          pool,
          "SELECT state FROM agent_sessions WHERE session_key = $1",
          [SESSION_KEY],
        )
      )[0]?.state ?? "";
    await until(async () => ((await state()) === "waiting_approval" ? true : null));

    const approval = await until(async () => {
      const list = await kernel.approvals.list({ state: "pending", limit: 50 });
      return list.find((a) => a.description === "US-A34 승인 왕복") ?? null;
    });
    // 승인은 세션 스레드에 걸린다 — ApprovalCard가 그 스레드에서 보인다(A5 §4).
    expect(approval.thread_id).toBe(threadId);

    await kernel.approvals.decide(approval.id, { decision: "accept" });
    expect(await asked).toMatchObject({ decision: "accept" });
    await until(async () => ((await state()) === HERDR_STATE.done ? true : null));
    expect(await hasPendingApproval(pool, threadId)).toBe(false);
  });

  it("session.create over bridge.call() makes the row and hands back the hub's thread", async () => {
    const key = "agent:claude_code:macbook:proj-omnis";
    await query(pool, "DELETE FROM threads WHERE external_id = $1", [key]);
    const created = await bridge.call<{ thread_id: string }>("macbook", "session.create", {
      session_key: key,
      runtime: "claude_code",
      cwd: process.cwd(),
      purpose: "proj:omnis",
      origin: "human",
      permission_profile: "workspace",
    });
    const rows = await query<{ id: string; thread_id: string; state: string; cwd: string }>(
      pool,
      "SELECT id, thread_id, state, cwd FROM agent_sessions WHERE session_key = $1",
      [key],
    );
    expect(rows[0]?.thread_id).toBe(created.thread_id);
    expect(rows[0]?.state).toBe("idle");
    expect(rows[0]?.cwd).toBe(process.cwd());
  });
});
