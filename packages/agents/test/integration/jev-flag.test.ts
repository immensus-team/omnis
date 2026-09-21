// The unit tests stub the pool, so nothing there would notice a wrong table or key name. This one
// reads the real settings row, which is what the hub writes when the flag is flipped.
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  DECISION_PROVIDER_KEY,
  DEFAULT_DECISION_PROVIDER,
  activeDecisionProvider,
  configureAgents,
  decideOrNull,
} from "../../src/index.js";
import type { DecisionRequest } from "../../src/index.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});

beforeEach(async () => {
  configureAgents({ pool });
  await pool.query("DELETE FROM settings WHERE key = $1", [DECISION_PROVIDER_KEY]);
});
// 0014_agents_decision_provider.sql seeds this row and kernel's settings suite asserts every
// SettingKey has one. Integration files share a DB and run in a single fork, so the deletions
// above would reach the next file unless the seeded value goes back first.
afterAll(async () => {
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [DECISION_PROVIDER_KEY, JSON.stringify(DEFAULT_DECISION_PROVIDER)],
  );
  await pool.end();
});

const REQ: DecisionRequest = {
  kind: "sensitivity",
  state: "From: a@b",
  questions: {
    sensitivity: {
      type: "choice",
      instructions: "how sensitive?",
      criteria: { normal: "n", health: "h" },
    },
  },
};

describe("agents.decision_provider (settings row)", () => {
  it("defaults to llm when no row exists — the state every environment starts in", async () => {
    expect(DEFAULT_DECISION_PROVIDER).toBe("llm");
    expect(await activeDecisionProvider(pool)).toBe("llm");
  });

  it("returns jev once the row is set, and llm again when it is cleared", async () => {
    await pool.query("INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)", [
      DECISION_PROVIDER_KEY,
      JSON.stringify("jev"),
    ]);
    expect(await activeDecisionProvider(pool)).toBe("jev");

    await pool.query("UPDATE settings SET value = $2::jsonb WHERE key = $1", [
      DECISION_PROVIDER_KEY,
      JSON.stringify("llm"),
    ]);
    expect(await activeDecisionProvider(pool)).toBe("llm");
  });

  it("ignores a value that is not exactly 'jev'", async () => {
    await pool.query("INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)", [
      DECISION_PROVIDER_KEY,
      JSON.stringify("JEV"),
    ]);
    expect(await activeDecisionProvider(pool)).toBe("llm");
  });

  it("makes no Jev call on the default path, whatever the decider would have said", async () => {
    let asked = 0;
    const decider = {
      run: { provider: "vercel-ai-gateway", model: "jev-latest" },
      available: async () => true,
      decide: async () => {
        asked += 1;
        throw new Error("must not be reached");
      },
    };

    expect(await decideOrNull(REQ, { pool, jev: decider })).toBe(null);
    expect(asked).toBe(0);
  });
});
