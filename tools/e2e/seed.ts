// Every part of the seed goes through a "real code path": adapter normalize → kernel IngestSink,
// kernel approvals.propose, @omnis/agents classify (T0 rules), and the local agent bridge over the
// WS /bridge. Agent sessions are no exception: the hub creates the thread/agent_sessions/items
// (US-A34).
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
  /** Closes the bridge. It must stay open until the smoke finishes so agent_runtimes stays online. */
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
// are the adapter contract corpus and keep growing (38/42/44 rows), so sweeping a directory whole
// would grow the seed with them, push the Inbox list into its virtualization range, and break the
// A1/A2/A4/A4b/A5 checks that count rows. Every fixture's normalize() is covered separately by the
// adapter contract tests.
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
    // slack/gmail/gcal normalize() all carry threadMeta now — feed the raw fixture straight
    // through (synthetic workaround removed; root fix for real defect #1 on main).
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

  // Label chips (A5 §3.1) attach through thread_labels.
  await labelThread(pool, slackThreadId, "scope", "work", "#2f6feb");
  await labelThread(pool, slackThreadId, "topic", "launch", "#8b5cf6");
  await labelThread(pool, gmailThreadId, "scope", "personal", "#16a34a");
  await query(pool, "UPDATE threads SET scope = 'work', unread_count = 2 WHERE id = $1", [
    slackThreadId,
  ]);
  await query(pool, "UPDATE threads SET scope = 'personal' WHERE id = $1", [gmailThreadId]);
  await query(pool, "UPDATE items SET scope = t.scope FROM threads t WHERE items.thread_id = t.id");

  // Leave one item as a draft so we can see the Thread screen's StatusBadge render a value other than 'received'.
  const slackAccount = await one<{ account_id: string }>(
    pool,
    "SELECT account_id FROM threads WHERE id = $1",
    [slackThreadId],
  );
  // loop-r2-02: the returned id is the link the whole story rests on — the approval is *this*
  // draft, so deciding the approval consumes the item rather than leaving a second copy of the same
  // reply on screen.
  const draftItem = await one<{ id: string }>(
    pool,
    `INSERT INTO items (thread_id, account_id, kind, status, scope, body, sent_at)
       VALUES ($1, $2, 'message', 'draft', 'work', 'Yes, I will review it today.', now())
       RETURNING id`,
    [slackThreadId, slackAccount.account_id],
  );

  // ── one approval: the kernel's approvals.propose (contract §5)
  const kernel = createKernel({ pool, logger });
  let approvalId: string;
  try {
    approvalId = await kernel.approvals.propose({
      action: "send",
      args: { channel: "slack", body: "Yes, I will review it today." },
      description: "Reply to #omnis-launch?",
      config: {
        allow_accept: true,
        allow_edit: true,
        allow_respond: false,
        allow_ignore: true,
      },
      risk: "normal",
      thread_id: slackThreadId,
      item_id: draftItem.id,
    });
  } finally {
    await kernel.close();
  }

  // ── one classify() call: it takes the T0 rule path only (r_channel_work). DeepSeek/OpenRouter are never called.
  const classifyTier = await runClassify(pool, slackThreadId);

  // ── agent session: the real WS /bridge plus mock runtime fixtures
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
  // Network guarantee: tier 3 (T1 = DeepSeek/OpenRouter) requires OMNIS_OPENROUTER_API_KEY in
  // t1Model() and throws before fetching when it is absent. Clearing the key makes the call
  // outright impossible even if a rule misses and falls through — so this is enforced, not "the
  // rule happened to match". A10 verifies tier=T0 separately.
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
  // Reset the thread scope to unknown at classify time so the tier-1 rule (r_thread_sticky) does not fire immediately.
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

/** The real notifications the hub receives on the WS /bridge, plus one turn of mock runtime
 *  fixtures. The session thread/row and the items are all created by the hub (US-A34) — the seed
 *  does no direct INSERT. */
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

  // 1) runtime registration — the hub upserts into agent_runtimes (bridge.ts onRegister).
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

  // 2) one turn of the mock runtime — the real ClaudeCodeAdapter parses stdio (replaying the A2
  //    §8.2 fixture) and createHubSink sends it straight to the hub. session.registered in the
  //    fixture's first line (system/init) creates the session thread, and the turn.item.* that
  //    follow become items.
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
    { text: "One inbox draft" },
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

/** US-D05: the screenshots' row copy, layered over seed().
 *
 *  seed() is a replay — every string it produces comes out of an adapter fixture, and those
 *  fixtures are the adapter contract corpus, not prose. Two of their properties are right for a
 *  contract test and wrong on screen:
 *
 *  - gcal's three events are one recurring series, so the `summary` that gcal normalizes into both
 *    thread.title and the item body is "omnis launch sync" twice and "PoC review" once. B3's
 *    fallback (packages/agents/src/summarize.ts takes the subject, else the body's first line) then
 *    writes that same sentence into threads.meta.summary, and Inbox.tsx prints the row's own title
 *    underneath the row's own title.
 *  - gmail's message bodies are headed "Subject: …\n\n", so its fallback lands on a mail header.
 *
 *  So the shot runs get their own copy, keyed by the fixtures' own external ids. Deliberately NOT
 *  part of seed(): phase-a's G5 ingests a marker into the first Slack thread and asserts it reaches
 *  that row, and the zero-row-summary guard in shots-accent (waitForSummaries) is a B3 regression
 *  test — neither survives a seed that arrives pre-summarized. Nothing here touches the Slack
 *  thread or anything A2/A4/A5 counts.
 *
 *  The calendar events keep their own titles rather than taking an organizer's name.
 *  DESIGN-DIRECTION's row grammar is person-first because a conversation *is* the person; an
 *  event's identity is its title, and three events that all read "Dana Lee" would hide more than
 *  the name adds.
 *
 *  B3 owns threads.meta.summary until its debounce fires (30s after the last inbound item), so the
 *  fixture waits for that write to land before making its own — otherwise the job overwrites the
 *  copy and every row goes back to saying its title twice. */
export async function varyInboxCopy(pool: Pool): Promise<void> {
  const targets: [string, string][] = [
    ["evt1", "Dana Lee accepted. Agenda is the launch checklist and the Friday cut-off."],
    ["evt2", "PoC deck is attached — pricing is the one section left open."],
    ["evt1_20261002", "Second occurrence of the same sync; Dana Lee has not replied yet."],
    ["18c2f4a1b2d3e4f1", "Slides are attached; she wants comments before Thursday."],
    ["18c2f4a1b2d3e4f0", "Agreed to sync at 10am tomorrow about the launch."],
  ];
  await waitFor(
    async () => {
      const done = await query<{ n: string }>(
        pool,
        `SELECT count(*) AS n FROM threads
        WHERE external_id = ANY($1::text[]) AND meta->>'summary_at' IS NOT NULL`,
        [targets.map(([id]) => id)],
      );
      return Number(done[0]?.n ?? 0) === targets.length;
      // 120s, not waitFor's 20s default: the hub's summarize job debounces 30s behind the last
      // inbound item, and the seed's own agent turn has to land first.
    },
    "B3 to summarize the seeded threads",
    120_000,
  );

  for (const [externalId, summary] of targets) {
    await query(
      pool,
      `UPDATE threads
          SET meta = meta || jsonb_build_object('summary', $2::text, 'summary_source', 'fixture')
        WHERE external_id = $1`,
      [externalId, summary],
    );
  }
}

/** G5: push one more item through the hub's IngestSink and measure how long it takes to show up in the UI. */
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
