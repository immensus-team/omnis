// 시드는 전부 "실제 코드 경로"를 탄다: 어댑터 normalize → 커널 IngestSink,
// 커널 approvals.propose, @omnis/agents classify(T0 규칙), WS /bridge 위의 로컬 에이전트 브리지.
// 에이전트 세션도 마찬가지다: thread/agent_sessions/items 전부 허브가 만든다(US-A34).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";
import { ClaudeCodeAdapter } from "../../apps/local-agent/src/bridges/claude-code.js";
import { HubClient } from "../../apps/local-agent/src/hub-client.js";
import { createHubSink } from "../../apps/local-agent/src/hub-sink.js";
import type { SessionRecord } from "../../apps/local-agent/src/session-registry.js";
import { FIXTURES, mockSpawn } from "../../apps/local-agent/test/mock-runtime.js";
import { normalize as normalizeGmail } from "../../packages/adapters/gmail/src/index.js";
import { normalize as normalizeGcal } from "../../packages/adapters/google-calendar/src/index.js";
import { normalize as normalizeSlack } from "../../packages/adapters/slack/src/index.js";
import { classify, configureAgents } from "../../packages/agents/src/index.js";
import { type Pool, one, query } from "../../packages/db/src/index.js";
import { createIngestSink, createKernel, createLogger } from "../../packages/kernel/src/index.js";
import type { Channel, NormalizedItem } from "../../packages/protocol/src/index.js";
import { BRIDGE_HOST, type E2EEnv, HUB_PORT, REPO_ROOT } from "./stack.js";

const logger = createLogger("@omnis/e2e");

export interface SeedResult {
  /** 브리지를 닫는다. 스모크가 끝날 때까지 열어 둬야 agent_runtimes가 online으로 남는다. */
  closeBridge?: () => void;
  slackThreadId: string;
  gmailThreadId: string;
  calendarThreadId: string;
  agentThreadId: string;
  approvalId: string;
  classifyTier: string;
  itemCount: number;
}

// 스모크 시드는 어댑터 픽스처 전부가 아니라 이 고정 슬라이스만 재생한다. 픽스처 디렉터리는
// 어댑터 계약 코퍼스라서 계속 자라고(38/42/44건), 디렉터리를 통째로 훑으면 시드 크기가 같이
// 자라 Inbox 목록이 가상화 구간에 들어가면서 행 수를 세는 A1/A2/A4/A4b/A5가 깨진다.
// 모든 픽스처의 normalize()는 어댑터 contract 테스트가 따로 본다.
const CHANNELS: {
  channel: Channel;
  fixturesDir: string;
  fixtures: string[];
  normalize: (raw: unknown) => NormalizedItem[];
}[] = [
  {
    channel: "slack",
    fixturesDir: join(REPO_ROOT, "packages/adapters/slack/fixtures"),
    fixtures: [
      "attachment.json",
      "deleted_message.json",
      "edited_message.json",
      "text_message.json",
      "thread_reply.json",
    ],
    normalize: normalizeSlack,
  },
  {
    channel: "gmail",
    fixturesDir: join(REPO_ROOT, "packages/adapters/gmail/fixtures"),
    fixtures: ["attachment.json", "text_message.json", "thread_reply.json"],
    normalize: normalizeGmail,
  },
  {
    channel: "gcal",
    fixturesDir: join(REPO_ROOT, "packages/adapters/google-calendar/fixtures"),
    fixtures: ["attachment.json", "text_message.json", "thread_reply.json"],
    normalize: normalizeGcal,
  },
];

interface Fixture {
  scenario: string;
  raw: unknown;
  expected: { items?: unknown[]; errorKind?: string };
}

function fixtureItems(
  dir: string,
  files: string[],
  normalize: (raw: unknown) => NormalizedItem[],
): NormalizedItem[] {
  const out: NormalizedItem[] = [];
  for (const file of [...files].sort()) {
    const fixture = JSON.parse(readFileSync(join(dir, file), "utf8")) as Fixture;
    if (fixture.expected.errorKind !== undefined) continue; // 에러 픽스처는 mapApiError의 몫
    out.push(...normalize(fixture.raw));
  }
  return out;
}

export async function seed(pool: Pool, env: E2EEnv): Promise<SeedResult> {
  const sink = createIngestSink({ pool, logger });
  const threadIds: Record<string, string> = {};

  for (const spec of CHANNELS) {
    const account = await one<{ id: string }>(
      pool,
      `INSERT INTO accounts (channel, external_id, display, capabilities)
         VALUES ($1, $2, $3, '{"read":true,"write":true}'::jsonb)
         ON CONFLICT (channel, external_id) DO UPDATE SET display = EXCLUDED.display
         RETURNING id`,
      [spec.channel, `e2e-${spec.channel}`, `e2e ${spec.channel}`],
    );
    // 이제 slack/gmail/gcal의 normalize()가 전부 threadMeta를 싣는다 — raw fixture를
    // 그대로 넣는다(합성 workaround 제거, main의 실결함 #1 root fix).
    for (const item of fixtureItems(spec.fixturesDir, spec.fixtures, spec.normalize)) {
      await sink(account.id, item);
    }
    const thread = await one<{ id: string }>(
      pool,
      "SELECT id FROM threads WHERE account_id = $1 ORDER BY created_at LIMIT 1",
      [account.id],
    );
    threadIds[spec.channel] = thread.id;
  }

  const slackThreadId = threadIds.slack ?? "";
  const gmailThreadId = threadIds.gmail ?? "";
  const calendarThreadId = threadIds.gcal ?? "";

  // 라벨 칩(A5 §3.1)은 thread_labels로 붙는다.
  await labelThread(pool, slackThreadId, "scope", "work", "#2f6feb");
  await labelThread(pool, slackThreadId, "topic", "launch", "#8b5cf6");
  await labelThread(pool, gmailThreadId, "scope", "personal", "#16a34a");
  await query(pool, "UPDATE threads SET scope = 'work', unread_count = 2 WHERE id = $1", [
    slackThreadId,
  ]);
  await query(pool, "UPDATE threads SET scope = 'personal' WHERE id = $1", [gmailThreadId]);
  await query(pool, "UPDATE items SET scope = t.scope FROM threads t WHERE items.thread_id = t.id");

  // Thread 화면의 StatusBadge가 'received' 말고 다른 값도 그리는지 보려고 한 건을 초안으로 남긴다.
  const slackAccount = await one<{ account_id: string }>(
    pool,
    "SELECT account_id FROM threads WHERE id = $1",
    [slackThreadId],
  );
  await query(
    pool,
    `INSERT INTO items (thread_id, account_id, kind, status, scope, body, sent_at)
       VALUES ($1, $2, 'message', 'draft', 'work', 'Sure, I will review it today.', now())`,
    [slackThreadId, slackAccount.account_id],
  );

  // ── 승인 1건: 커널의 approvals.propose (계약 §5)
  const kernel = createKernel({ pool, logger });
  let approvalId: string;
  try {
    approvalId = await kernel.approvals.propose({
      action: "send",
      args: { channel: "slack", body: "네, 오늘 중으로 리뷰할게요." },
      description: "#omnis-launch에 답장을 보낼까요?",
      config: {
        allow_accept: true,
        allow_edit: true,
        allow_respond: false,
        allow_ignore: true,
      },
      risk: "normal",
      thread_id: slackThreadId,
    });
  } finally {
    await kernel.close();
  }

  // ── classify() 1회: T0 규칙 경로만 탄다(r_channel_work). DeepSeek/OpenRouter는 호출되지 않는다.
  const classifyTier = await runClassify(pool, slackThreadId);

  // ── 에이전트 세션: 실제 WS /bridge + mock 런타임 픽스처
  const agent = await seedAgentSession(pool, env);

  const { count } = await one<{ count: string }>(pool, "SELECT count(*) AS count FROM items");
  return {
    closeBridge: agent.close,
    slackThreadId,
    gmailThreadId,
    calendarThreadId,
    agentThreadId: agent.threadId,
    approvalId,
    classifyTier,
    itemCount: Number(count),
  };
}

async function labelThread(
  pool: Pool,
  threadId: string,
  kind: string,
  name: string,
  color: string,
): Promise<void> {
  const label = await one<{ id: string }>(
    pool,
    `INSERT INTO labels (name, kind, color) VALUES ($1, $2, $3)
       ON CONFLICT (kind, name) DO UPDATE SET color = EXCLUDED.color RETURNING id`,
    [name, kind, color],
  );
  await query(
    pool,
    `INSERT INTO thread_labels (thread_id, label_id, by) VALUES ($1, $2, 'rule')
       ON CONFLICT (thread_id, label_id) DO NOTHING`,
    [threadId, label.id],
  );
}

async function runClassify(pool: Pool, threadId: string): Promise<string> {
  // 네트워크 보장: 3단(T1 = DeepSeek/OpenRouter)은 t1Model()이 OMNIS_OPENROUTER_API_KEY를
  // 요구하고 없으면 fetch 전에 던진다. 키를 지워 두면 규칙이 안 맞아 흘러내려도 호출이
  // 아예 불가능하다 — "규칙이 마침 맞았다"가 아니라 강제된다. A10은 tier=T0을 따로 검증한다.
  process.env.OMNIS_OPENROUTER_API_KEY = "";
  configureAgents({ pool });
  const item = await one<{
    id: string;
    thread_id: string;
    account_id: string;
    kind: string;
    scope: string;
    sensitivity: string;
    author_person_id: string | null;
    author_is_me: boolean;
    subject: string | null;
    body: string;
    sent_at: Date;
  }>(
    pool,
    `SELECT id, thread_id, account_id, kind, scope, sensitivity, author_person_id,
            author_is_me, subject, body, sent_at
       FROM items WHERE thread_id = $1 AND status = 'received' ORDER BY sent_at LIMIT 1`,
    [threadId],
  );
  // 규칙 1단(r_thread_sticky)이 바로 먹지 않도록 스레드 scope는 분류 시점에 unknown으로 되돌린다.
  await query(pool, "UPDATE threads SET scope = 'unknown' WHERE id = $1", [threadId]);
  const result = await classify(
    {
      ...item,
      channel: "slack",
      kind: item.kind as "message",
      scope: "unknown",
      sensitivity: "normal",
      sent_at: item.sent_at.toISOString(),
      embedding: null,
    },
    { threadId, accountChannel: "slack", pool },
  );
  await query(pool, "UPDATE threads SET scope = $2 WHERE id = $1", [threadId, result.scope]);
  return result.tier_used;
}

/** 허브가 WS /bridge에서 받는 실제 알림들 + mock 런타임 픽스처 한 턴.
 *  세션 thread/row도 items도 전부 허브가 만든다(US-A34) — 시드에 직접 INSERT가 없다. */
async function seedAgentSession(
  pool: Pool,
  env: E2EEnv,
): Promise<{ threadId: string; close: () => void }> {
  const token = env.OMNIS_BRIDGE_TOKEN ?? "";
  const client = new HubClient({
    url: `ws://127.0.0.1:${HUB_PORT}/bridge`,
    token,
    host: BRIDGE_HOST,
    logger,
    connect: (url, headers) => new WebSocket(url, { headers }) as never,
    dispatch: async () => null,
  });
  await client.start();
  await waitFor(() => client.connected, "bridge connect");

  // 1) 런타임 등록 — 허브가 agent_runtimes에 upsert한다(bridge.ts onRegister).
  client.notify("runtime.registered", {
    runtime: "claude_code",
    version: "claude 2.1.274",
    display: "claude_code@macbook",
    capabilities: { resume: true, tool_calls: true },
  });
  const runtime = await waitForRow<{ id: string }>(
    pool,
    "SELECT id FROM agent_runtimes WHERE runtime = 'claude_code' AND host = $1 AND state = 'online'",
    [BRIDGE_HOST],
  );

  // 2) mock 런타임 한 턴 — 실제 ClaudeCodeAdapter가 stdio를 파싱하고(A2 §8.2의 fixture 재생),
  //    createHubSink가 그대로 허브에 쏜다. 픽스처 첫 줄(system/init)의 session.registered가
  //    세션 thread를 만들고, 뒤따르는 turn.item.*이 items가 된다.
  const session: SessionRecord = {
    session_key: "agent:claude_code:macbook:inbox-draft",
    session_id: null,
    runtime: "claude_code",
    runtime_id: runtime.id,
    cwd: REPO_ROOT,
    purpose: "inbox:draft",
    origin: "job",
    permission_profile: "observe",
    state: "idle",
    opened_at: new Date().toISOString(),
    last_turn_at: null,
  };
  const adapter = new ClaudeCodeAdapter({
    kind: "claude_code",
    binary: "claude",
    defaultModel: "sonnet",
    spawnFn: mockSpawn(FIXTURES.claudeToolCall),
  });
  await adapter.startTurn(
    session,
    { text: "inbox 초안 한 건" },
    createHubSink({ client, session, turnId: "e2e-turn-1", logger }),
  );

  const row = await waitForRow<{ thread_id: string }>(
    pool,
    "SELECT thread_id FROM agent_sessions WHERE session_key = $1",
    [session.session_key],
  );
  await waitFor(
    async () =>
      (
        await query(pool, "SELECT 1 FROM items WHERE thread_id = $1 AND kind = 'tool_call'", [
          row.thread_id,
        ])
      ).length > 0,
    "tool_call item",
  );
  await waitFor(
    async () =>
      (
        await query(pool, "SELECT 1 FROM items WHERE thread_id = $1 AND kind = 'system'", [
          row.thread_id,
        ])
      ).length > 0,
    "turn.completed system item",
  );
  return { threadId: row.thread_id, close: () => client.stop() };
}

/** G5: 허브의 IngestSink로 item 한 건을 더 넣고, 그게 UI에 비치기까지를 잰다. */
export async function ingestOneMore(pool: Pool, body: string): Promise<void> {
  const sink = createIngestSink({ pool, logger });
  const row = await one<{ account_id: string; external_id: string }>(
    pool,
    `SELECT t.account_id, t.external_id FROM threads t
       JOIN accounts a ON a.id = t.account_id WHERE a.channel = 'slack' LIMIT 1`,
  );
  const ts = String(Date.now() / 1000);
  await sink(row.account_id, {
    threadExternalId: row.external_id,
    externalId: ts,
    kind: "message",
    author: { kind: "person", id: "U0123456789" },
    body,
    attachments: [],
    sentAt: new Date().toISOString(),
    status: "received",
    sourceHash: ts,
  });
}

async function waitFor(
  probe: () => boolean | Promise<boolean>,
  what: string,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function waitForRow<T>(pool: Pool, sql: string, params: unknown[]): Promise<T> {
  let rows: T[] = [];
  await waitFor(async () => {
    rows = await query<T>(pool, sql, params);
    return rows.length > 0;
  }, sql);
  const row = rows[0];
  if (row === undefined) throw new Error(`no row for ${sql}`);
  return row;
}
