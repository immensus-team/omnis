import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AgentsNotConfiguredError, configureAgents, recordRun } from "../../src/index.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});
beforeAll(() => configureAgents({ pool }));
afterAll(() => pool.end());

describe("recordRun", () => {
  it("writes one agent_runs row with A3 §4 column names", async () => {
    const id = await recordRun({
      loop: "classify",
      trigger_kind: "event",
      model_tier: "T0",
      provider: "local",
      model: "rules-v1",
      outcome: "running",
      context_hash: "a".repeat(64),
    });
    const { rows } = await pool.query(
      "SELECT loop, model_tier, provider, model, outcome, context_hash, finished_at FROM agent_runs WHERE id = $1",
      [id],
    );
    expect(rows[0]).toMatchObject({
      loop: "classify",
      model_tier: "T0",
      provider: "local",
      model: "rules-v1",
      outcome: "running",
      context_hash: "a".repeat(64),
    });
    expect(rows[0].finished_at).toBeNull();
  });

  it("stores injection_flags as a text[] and not as a json string", async () => {
    const id = await recordRun({
      loop: "classify",
      trigger_kind: "event",
      model_tier: "T1",
      provider: "openrouter",
      model: "deepseek-v4.1-flash",
      outcome: "blocked",
      injection_flags: ["instruction_override", "credential_request"],
    });
    const { rows } = await pool.query<{ injection_flags: string[] }>(
      "SELECT injection_flags FROM agent_runs WHERE id = $1",
      [id],
    );
    expect(rows[0]?.injection_flags).toEqual(["instruction_override", "credential_request"]);
  });

  it("rejects a tier outside the A3 CHECK constraint", async () => {
    await expect(
      recordRun({
        loop: "classify",
        trigger_kind: "event",
        model_tier: "T9" as never,
        provider: "local",
        model: "x",
        outcome: "ok",
      }),
    ).rejects.toThrow(/agent_runs_tier_ck/);
  });

  it("throws AgentsNotConfiguredError before configureAgents", async () => {
    const { getAgentsPool, resetAgentsPoolForTest } = await import("../../src/pool.js");
    resetAgentsPoolForTest();
    expect(() => getAgentsPool()).toThrow(AgentsNotConfiguredError);
    configureAgents({ pool });
  });
});

describe("finishRun", () => {
  it("patches only the given columns and stamps finished_at", async () => {
    const { finishRun } = await import("../../src/index.js");
    const id = await recordRun({
      loop: "classify",
      trigger_kind: "event",
      model_tier: "T1",
      provider: "openrouter",
      model: "deepseek-v4.1-flash",
      outcome: "running",
      context_hash: "b".repeat(64),
    });
    await finishRun(id, {
      outcome: "ok",
      tokens_in: 1740,
      tokens_out: 121,
      tokens_cached: 1301,
      latency_ms: 812,
      confidence: 0.88,
    });
    const { rows } = await pool.query(
      "SELECT outcome, tokens_in, tokens_out, tokens_cached, latency_ms, confidence, context_hash, finished_at FROM agent_runs WHERE id = $1",
      [id],
    );
    expect(rows[0]).toMatchObject({
      outcome: "ok",
      tokens_in: 1740,
      tokens_out: 121,
      tokens_cached: 1301,
      latency_ms: 812,
      context_hash: "b".repeat(64),
    });
    expect(rows[0].confidence).toBeCloseTo(0.88, 5);
    expect(rows[0].finished_at).toBeInstanceOf(Date);
  });

  it("keeps the parsed-failure raw output for schema violations (A4 §1.6)", async () => {
    const { finishRun } = await import("../../src/index.js");
    const id = await recordRun({
      loop: "classify",
      trigger_kind: "event",
      model_tier: "T1",
      provider: "openrouter",
      model: "deepseek-v4.1-flash",
      outcome: "running",
    });
    await finishRun(id, {
      outcome: "failed",
      error: "schema violation",
      raw_output: '{"scope": "wrk"}',
    });
    const { rows } = await pool.query<{ outcome: string; raw_output: string }>(
      "SELECT outcome, raw_output FROM agent_runs WHERE id = $1",
      [id],
    );
    expect(rows[0]).toMatchObject({ outcome: "failed", raw_output: '{"scope": "wrk"}' });
  });

  it("throws when the id does not exist", async () => {
    const { finishRun } = await import("../../src/index.js");
    await expect(
      finishRun("00000000-0000-0000-0000-000000000000", { outcome: "ok" }),
    ).rejects.toThrow(/agent_runs row not found/);
  });
});
