// The seed takes only "real code paths": adapter normalize → kernel IngestSink,
// kernel approvals.propose, @omnis/agents classify (T0 rules), the local agent bridge over WS /bridge.
// Agent sessions are the same: thread/agent_sessions/items are all created by the hub (US-A34).
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
  /** Closes the bridge. It has to stay open until the smoke ends so agent_runtimes stays online. */
  closeBridge?: () => void;
  slackThreadId: string;
  gmailThreadId: string;
  calendarThreadId: string;
  agentThreadId: string;
  approvalId: string;
  classifyTier: string;
  itemCount: number;
}

// The smoke seed replays only this fixed slice, not every adapter fixture. The fixture directories
// are the adapter contract corpus and keep growing (38/42/44 files), and sweeping a whole directory
// grows the seed with them — the Inbox list then enters the virtualized range and the row-counting
// A1/A2/A4/A4b/A5 break. Every fixture's normalize() is covered by the adapter contract tests.
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
    if (fixture.expected.errorKind !== undefined) continue; // error fixtures belong to mapApiError
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
    // slack/gmail/gcal normalize() all carry threadMeta now — feed the raw fixture straight in
    // (synthetic workaround removed, root fix for main's real defect #1).
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

  // Label chips (A5 §3.1) are attached through thread_labels.
  await labelThread(pool, slackThreadId, "scope", "work", "#2f6feb");
  await labelThread(pool, slackThreadId, "topic", "launch", "#8b5cf6");
  await labelThread(pool, gmailThreadId, "scope", "personal", "#16a34a");
  await query(pool, "UPDATE threads SET scope = 'work', unread_count = 2 WHERE id = $1", [
    slackThreadId,
  ]);
  await query(pool, "UPDATE threads SET scope = 'personal' WHERE id = $1", [gmailThreadId]);
  await query(pool, "UPDATE items SET scope = t.scope FROM threads t WHERE items.thread_id = t.id");

  // Leave one item as a draft so the Thread screen's StatusBadge has to render a value other than 'received'.
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

  // ── One approval: the kernel's approvals.propose (contract §5)
  const kernel = createKernel({ pool, logger });
  let approvalId: string;
  try {
    approvalId = await kernel.approvals.propose({
      action: "send",
      args: { channel: "slack", body: "Sure, I will review it today." },
      description: "Reply to #omnis-launch?",
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

  // ── One classify() call: takes only the T0 rule path (r_channel_work). DeepSeek/OpenRouter is never called.
  const classifyTier = await runClassify(pool, slackThreadId);

  // ── Agent session: real WS /bridge + mock runtime fixture
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
  // Network guarantee: for tier 3 (T1 = DeepSeek/OpenRouter) t1Model() requires
  // OMNIS_OPENROUTER_API_KEY and throws before any fetch when it is missing. Clearing the key makes
  // the call impossible even when the rules miss and it falls through — it is enforced, not "the
  // rules happened to match". A10 verifies tier=T0 separately.
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
  // Reset the thread scope to unknown at classification time so rule 1 (r_thread_sticky) does not hit immediately.
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

/** The real notifications the hub receives over WS /bridge + one turn of the mock runtime fixture.
 *  Session thread/row and items are all created by the hub (US-A34) — the seed does no direct INSERT. */
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

  // 1) Runtime registration — the hub upserts into agent_runtimes (bridge.ts onRegister).
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

  // 2) One mock runtime turn — the real ClaudeCodeAdapter parses stdio (replaying A2 §8.2's fixture)
  //    and createHubSink ships it to the hub unchanged. session.registered on the fixture's first
  //    line (system/init) creates the session thread, and the turn.item.* that follow become items.
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
    { text: "one inbox draft" },
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

/** G5: push one more item through the hub's IngestSink and time how long it takes to show up in the UI. */
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
