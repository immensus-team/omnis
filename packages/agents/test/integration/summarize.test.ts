import { MockLanguageModelV3 } from "ai/test";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { configureAgents } from "../../src/index.js";
import { summarizeThread } from "../../src/summarize.js";
import { returningId } from "./returning-id.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});
let accountId = "";

beforeAll(async () => {
  configureAgents({ pool });
  const a = await pool.query<{ id: string }>(
    `INSERT INTO accounts (channel, external_id, display) VALUES ('telegram','sum@test','t')
       ON CONFLICT (channel, external_id) DO UPDATE SET display='t' RETURNING id`,
  );
  accountId = returningId(a);
});
afterAll(() => pool.end());

async function newThread(externalId: string): Promise<string> {
  const t = await pool.query<{ id: string }>(
    `INSERT INTO threads (account_id, external_id, kind) VALUES ($1,$2,'dm')
       ON CONFLICT (account_id, external_id) DO UPDATE SET kind='dm' RETURNING id`,
    [accountId, externalId],
  );
  return returningId(t);
}

async function addItem(
  threadId: string,
  over: {
    subject?: string | null;
    body: string;
    authorIsMe?: boolean;
    kind?: "message" | "agent_turn" | "tool_call";
  },
): Promise<string> {
  const row = await pool.query<{ id: string }>(
    `INSERT INTO items (thread_id, account_id, kind, subject, body, sent_at, author_is_me)
       VALUES ($1,$2,$6,$3,$4,now(),$5) RETURNING id`,
    [
      threadId,
      accountId,
      over.subject ?? null,
      over.body,
      over.authorIsMe ?? false,
      over.kind ?? "message",
    ],
  );
  return returningId(row);
}

async function threadMeta(
  threadId: string,
): Promise<{ summary: string | null; summary_source: string | null; summary_at: string | null }> {
  const { rows } = await pool.query<{ meta: Record<string, unknown> }>(
    "SELECT meta FROM threads WHERE id = $1",
    [threadId],
  );
  const meta = rows[0]?.meta ?? {};
  return {
    summary: (meta.summary as string | undefined) ?? null,
    summary_source: (meta.summary_source as string | undefined) ?? null,
    summary_at: (meta.summary_at as string | undefined) ?? null,
  };
}

async function runsFor(itemId: string) {
  const { rows } = await pool.query<{ loop: string; outcome: string; model_tier: string }>(
    "SELECT loop, outcome, model_tier FROM agent_runs WHERE item_id = $1 ORDER BY created_at",
    [itemId],
  );
  return rows;
}

const originalKey = process.env.OMNIS_OPENROUTER_API_KEY;
beforeEach(() => {
  process.env.OMNIS_OPENROUTER_API_KEY = originalKey;
});

describe("summarizeThread — fallback path", () => {
  it("skips a thread whose last item is outbound (author_is_me)", async () => {
    const threadId = await newThread("thr_out");
    await addItem(threadId, { body: "Could you send it over?", authorIsMe: false });
    await addItem(threadId, { body: "Yes, confirmed", authorIsMe: true });

    const out = await summarizeThread(threadId);
    expect(out).toBeNull();
    expect(await threadMeta(threadId)).toMatchObject({ summary: null });
  });

  it("skips a thread with no items at all", async () => {
    const threadId = await newThread("thr_empty");
    const out = await summarizeThread(threadId);
    expect(out).toBeNull();
  });

  it("keeps the existing summary when the last item has no text (agent tool_call with body='')", async () => {
    process.env.OMNIS_OPENROUTER_API_KEY = "";
    const threadId = await newThread("thr_blank");
    await addItem(threadId, { body: "Please share the contract" });
    expect((await summarizeThread(threadId))?.summary).toBe("Please share the contract");

    // The started stage of writeAgentItem(apps/hub/src/sessions.ts): kind='tool_call', body=''.
    const blankId = await addItem(threadId, { kind: "tool_call", body: "" });
    expect(await summarizeThread(threadId)).toBeNull();
    expect(await threadMeta(threadId)).toMatchObject({
      summary: "Please share the contract",
      summary_source: "fallback",
    });
    expect(await runsFor(blankId)).toHaveLength(0);
  });

  it("falls back to subject, records outcome=failed, and tags summary_source=fallback when the key is missing", async () => {
    process.env.OMNIS_OPENROUTER_API_KEY = "";
    const threadId = await newThread("thr_nokey");
    const itemId = await addItem(threadId, {
      subject: "Quote request",
      body: "Please send the quote by tomorrow",
    });

    const out = await summarizeThread(threadId);
    expect(out).toEqual({ summary: "Quote request", source: "fallback" });
    expect(await threadMeta(threadId)).toMatchObject({
      summary: "Quote request",
      summary_source: "fallback",
    });
    expect((await threadMeta(threadId)).summary_at).not.toBeNull();
    const runs = await runsFor(itemId);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ loop: "summarize", outcome: "failed", model_tier: "T1" });
  });

  it("falls back to the first line of the body when subject is null", async () => {
    process.env.OMNIS_OPENROUTER_API_KEY = "";
    const threadId = await newThread("thr_nosubject");
    await addItem(threadId, { subject: null, body: "This is the first line\nSecond line" });

    const out = await summarizeThread(threadId);
    expect(out?.summary).toBe("This is the first line");
    expect(out?.source).toBe("fallback");
  });

  it("truncates a long fallback line to 90 chars", async () => {
    process.env.OMNIS_OPENROUTER_API_KEY = "";
    const threadId = await newThread("thr_long");
    const long = "a".repeat(120);
    await addItem(threadId, { subject: long, body: "x" });

    const out = await summarizeThread(threadId);
    expect(out?.summary.length).toBe(90);
    expect(out?.summary.endsWith("…")).toBe(true);
  });
});

describe("summarizeThread — T1 path", () => {
  it("uses the T1 summary and records outcome=ok on success (MockLanguageModel)", async () => {
    vi.doMock("../../src/t1/provider.js", async (orig) => ({
      ...(await orig<typeof import("../../src/t1/provider.js")>()),
      t1Model: () =>
        new MockLanguageModelV3({
          doGenerate: async () => ({
            finishReason: "stop" as const,
            usage: {
              inputTokens: { total: 500, noCache: 500, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 30, text: 30, reasoning: 0 },
            },
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  summary: "Wants you to share the Brightstone Realty contract.",
                  confidence: 0.87,
                }),
              },
            ],
            warnings: [],
          }),
        }),
    }));
    vi.resetModules();
    // resetModules also clears the module singleton in pool.ts (same deviation as classify.test.ts).
    const { summarizeThread: summarizeMocked } = await import("../../src/summarize.js");
    const { configureAgents: configureAgentsFresh } = await import("../../src/index.js");
    configureAgentsFresh({ pool });

    const threadId = await newThread("thr_t1");
    const itemId = await addItem(threadId, {
      body: "Please share the Brightstone Realty contract",
    });

    const out = await summarizeMocked(threadId);
    expect(out).toEqual({
      summary: "Wants you to share the Brightstone Realty contract.",
      source: "t1",
    });
    expect(await threadMeta(threadId)).toMatchObject({
      summary: "Wants you to share the Brightstone Realty contract.",
      summary_source: "t1",
    });
    const runs = await runsFor(itemId);
    expect(runs[0]).toMatchObject({ loop: "summarize", outcome: "ok", model_tier: "T1" });

    vi.doUnmock("../../src/t1/provider.js");
    vi.resetModules();
  });
});
