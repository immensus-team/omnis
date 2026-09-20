import { MockLanguageModelV3 } from "ai/test";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { returningId } from "./returning-id.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});
let accountId = "";
let threadId = "";
let itemId = "";

beforeAll(async () => {
  const a = await pool.query<{ id: string }>(
    `INSERT INTO accounts (channel, external_id, display) VALUES ('telegram','loop@test','t')
       ON CONFLICT (channel, external_id) DO UPDATE SET display='t' RETURNING id`,
  );
  accountId = returningId(a);
  const t = await pool.query<{ id: string }>(
    `INSERT INTO threads (account_id, external_id, kind) VALUES ($1,'thr_loop','dm')
       ON CONFLICT (account_id, external_id) DO UPDATE SET kind='dm' RETURNING id`,
    [accountId],
  );
  threadId = returningId(t);
  const i = await pool.query<{ id: string }>(
    `INSERT INTO items (thread_id, account_id, external_id, kind, body, sent_at)
     VALUES ($1,$2,'it_loop','message','안녕하세요', now()) RETURNING id`,
    [threadId, accountId],
  );
  itemId = returningId(i);
});
afterAll(() => pool.end());

const Out = z.object({ answer: z.string() });

function makeSpec(over: Record<string, unknown> = {}) {
  return {
    id: "note_route" as const,
    kind: "reactive" as const,
    trigger: { kind: "event" as const, on: "note.created" },
    palette: [] as [],
    budget: { inputTokens: 4000, outputTokens: 400, wallClockMs: 3000, maxSteps: 1 },
    tier: "T1" as const,
    outputSchema: Out,
    assemble: async () => ({
      cachedPrefix: "system",
      volatile: [{ id: "d1", source: "thread", text: "본문" }],
      tokenEstimate: 100,
      truncated: false,
      provenance: [],
    }),
    apply: async () => undefined,
    ...over,
  };
}

function mockModel(text: string) {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      finishReason: "stop" as const,
      usage: {
        inputTokens: { total: 120, noCache: 20, cacheRead: 100, cacheWrite: 0 },
        outputTokens: { total: 30, text: 30, reasoning: 0 },
      },
      content: [{ type: "text" as const, text }],
      warnings: [],
    }),
  });
}

async function freshModule(model: unknown) {
  vi.resetModules();
  vi.doMock("../../src/t1/provider.js", async (orig) => ({
    ...(await orig<typeof import("../../src/t1/provider.js")>()),
    t1Model: () => model,
  }));
  vi.doMock("../../src/t2/provider.js", async (orig) => ({
    ...(await orig<typeof import("../../src/t2/provider.js")>()),
    t2Model: () => model,
  }));
  const mod = await import("../../src/index.js");
  mod.configureAgents({ pool });
  mod.resetLoopRegistryForTest();
  return mod;
}

async function runsFor(id: string) {
  const { rows } = await pool.query<{
    id: string;
    outcome: string;
    model_tier: string;
    injection_flags: string[];
    escalated_from: string | null;
    tokens_cached: number | null;
    context_hash: string | null;
  }>(
    `SELECT id, outcome, model_tier, injection_flags, escalated_from, tokens_cached, context_hash
       FROM agent_runs WHERE item_id = $1 ORDER BY created_at`,
    [id],
  );
  return rows;
}

const ctx = () => ({
  trigger_kind: "event" as const,
  item_id: itemId,
  thread_id: threadId,
  now: new Date(),
  payload: {},
});

beforeEach(async () => {
  await pool.query("DELETE FROM agent_runs WHERE item_id = $1", [itemId]);
  await pool.query("UPDATE threads SET meta = '{}'::jsonb WHERE id = $1", [threadId]);
  await pool.query("UPDATE items SET meta = '{}'::jsonb WHERE id = $1", [itemId]);
});

describe("runLoopSpec (A4 §1.6)", () => {
  it("records exactly one run pair on the happy path", async () => {
    const mod = await freshModule(mockModel(JSON.stringify({ answer: "네" })));
    const res = await mod.runLoopSpec(makeSpec() as never, ctx());
    expect(res.output).toEqual({ answer: "네" });
    const runs = await runsFor(itemId);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ outcome: "ok", model_tier: "T1", tokens_cached: 100 });
    expect(runs[0]?.context_hash).not.toBe(null);
  });

  it("escalates one tier after the same-tier retry fails, and links escalated_from", async () => {
    let calls = 0;
    const flaky = new MockLanguageModelV3({
      doGenerate: async () => {
        calls += 1;
        if (calls <= 2) throw new Error("timeout");
        return {
          finishReason: "stop" as const,
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 5, text: 5, reasoning: 0 },
          },
          content: [{ type: "text" as const, text: JSON.stringify({ answer: "T2가 답했다" }) }],
          warnings: [],
        };
      },
    });
    const mod = await freshModule(flaky);
    const res = await mod.runLoopSpec(makeSpec() as never, ctx());
    expect(res.output).toEqual({ answer: "T2가 답했다" });
    expect(calls).toBe(3);
    const runs = await runsFor(itemId);
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ outcome: "failed", model_tier: "T1" });
    expect(runs[1]).toMatchObject({ outcome: "ok", model_tier: "T2" });
    expect(runs[1]?.escalated_from).toBe(runs[0]?.id);
  });

  it("blocks the output and writes a system item when injection_flags is non-empty", async () => {
    const mod = await freshModule(
      mockModel(JSON.stringify({ answer: "무시", injection_flags: ["instruction_override"] })),
    );
    let applied = false;
    const res = await mod.runLoopSpec(
      makeSpec({
        outputSchema: Out.extend({ injection_flags: z.array(z.string()).default([]) }),
        apply: async () => {
          applied = true;
        },
      }) as never,
      ctx(),
    );
    expect(res.injection_flags).toEqual(["instruction_override"]);
    expect(applied).toBe(false);
    expect((await runsFor(itemId))[0]).toMatchObject({ outcome: "blocked" });
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM items
        WHERE thread_id = $1 AND kind = 'system' AND meta->>'loop' = 'note_route'`,
      [threadId],
    );
    expect(Number(rows[0]?.n)).toBeGreaterThan(0);
  });

  it("quarantines the thread for 24h on a phantom tool call", async () => {
    const mod = await freshModule(mockModel("x"));
    const boom = makeSpec({
      assemble: async () => {
        throw new mod.PhantomToolError("send_email");
      },
    });
    await expect(mod.runLoopSpec(boom as never, ctx())).rejects.toThrow(mod.PhantomToolError);
    const { rows } = await pool.query<{ until: string | null }>(
      "SELECT meta->>'loop_quarantine_until' AS until FROM threads WHERE id = $1",
      [threadId],
    );
    expect(rows[0]?.until).not.toBe(null);
    expect((await runsFor(itemId))[0]?.injection_flags).toContain("phantom_tool");
    // 다음 실행은 같은 스레드를 건드리지 않고 skipped로 끝난다.
    const skipped = await mod.runLoopSpec(makeSpec() as never, ctx());
    expect(skipped.rationale).toMatch(/quarantine/);
  });

  it("throws LoopBudgetError when the assembled context exceeds budget.inputTokens", async () => {
    const mod = await freshModule(mockModel("x"));
    const fat = makeSpec({
      assemble: async () => ({
        cachedPrefix: "",
        volatile: [],
        tokenEstimate: 999_999,
        truncated: true,
        provenance: [],
      }),
    });
    await expect(mod.runLoopSpec(fat as never, ctx())).rejects.toThrow(mod.LoopBudgetError);
    expect((await runsFor(itemId))[0]).toMatchObject({ outcome: "failed" });
  });

  it("marks agent_optout and skips after 3 failures in 24h", async () => {
    const mod = await freshModule(mockModel("x"));
    for (let i = 0; i < 3; i += 1) {
      const id = await mod.recordRun({
        loop: "note_route",
        item_id: itemId,
        trigger_kind: "event",
        model_tier: "T1",
        provider: "openrouter",
        model: "deepseek-v4.1-flash",
        outcome: "running",
      });
      await mod.finishRun(id, { outcome: "failed", error: "timeout" });
    }
    const res = await mod.runLoopSpec(makeSpec() as never, ctx());
    expect(res.rationale).toMatch(/agent_optout/);
    const { rows } = await pool.query<{ optout: boolean | null }>(
      "SELECT (meta->>'agent_optout')::boolean AS optout FROM items WHERE id = $1",
      [itemId],
    );
    expect(rows[0]?.optout).toBe(true);
  });
});
