import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DECISION_PROVIDER_KEY,
  decideOrNull,
  parseDecisionProvider,
} from "../src/decision/router.js";
import type { Decider, DecisionRequest, DecisionResponse } from "../src/decision/types.js";

/** A pool that answers the one query the router makes, without needing a database. */
function stubPool(value: unknown): Pool {
  return {
    query: async () => ({ rows: value === undefined ? [] : [{ value }] }),
  } as unknown as Pool;
}

const RESULT: DecisionResponse = {
  provider: "vercel-ai-gateway",
  model: "jev-latest",
  answers: { scope: { type: "choice", choice: "work", probabilities: { work: 0.9 } } },
  confidence: {},
  latencyMs: 5,
  tokensIn: 100,
  tokensOut: 0,
  costUsd: 0.0000042,
};

/** Counts every touch, so "zero Jev calls when the flag is off" is an assertion and not a promise. */
function countingDecider(behaviour: "ok" | "throw" | "unavailable" = "ok"): {
  decider: Decider;
  calls: DecisionRequest[];
  availableChecks: { n: number };
} {
  const calls: DecisionRequest[] = [];
  const availableChecks = { n: 0 };
  const decider: Decider = {
    run: { provider: "vercel-ai-gateway", model: "jev-latest" },
    available: async () => {
      availableChecks.n += 1;
      return behaviour !== "unavailable";
    },
    decide: async (req) => {
      calls.push(req);
      if (behaviour === "throw") throw new Error("gateway exploded");
      return RESULT;
    },
  };
  return { decider, calls, availableChecks };
}

const REQ: DecisionRequest = {
  kind: "classify",
  state: "From: a@b",
  questions: {
    scope: {
      type: "choice",
      instructions: "work or personal?",
      criteria: { work: "w", personal: "p" },
    },
    priority: { type: "choice", instructions: "how soon?", criteria: { now: "n", fyi: "f" } },
  },
};

const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
afterEach(() => warn.mockClear());

describe("decision provider flag", () => {
  it("accepts exactly 'jev' and defaults everything else to 'llm'", () => {
    expect(parseDecisionProvider("jev")).toBe("jev");
    for (const v of ["llm", "JEVA", "true", "", null, 1, { a: 1 }]) {
      expect(parseDecisionProvider(v)).toBe("llm");
    }
  });

  it("makes ZERO Jev calls while the flag is off — the default", async () => {
    const { decider, calls, availableChecks } = countingDecider();

    // No settings row at all, and again with the key explicitly set to the default.
    expect(await decideOrNull(REQ, { pool: stubPool(undefined), jev: decider })).toBe(null);
    expect(await decideOrNull(REQ, { pool: stubPool("llm"), jev: decider })).toBe(null);

    // Not even a construction or an availability probe: the flag is checked first.
    expect(calls).toEqual([]);
    expect(availableChecks.n).toBe(0);
  });

  it("uses the decider once the flag is on", async () => {
    const { decider, calls, availableChecks } = countingDecider();

    const res = await decideOrNull(REQ, { pool: stubPool("jev"), jev: decider });

    expect(res).toEqual(RESULT);
    expect(calls).toEqual([REQ]);
    expect(availableChecks.n).toBe(1);
  });

  it("falls back to the LLM path when Jev is unavailable", async () => {
    const { decider, calls } = countingDecider("unavailable");

    expect(await decideOrNull(REQ, { pool: stubPool("jev"), jev: decider })).toBe(null);
    expect(calls).toEqual([]);
    expect(warn).not.toHaveBeenCalled(); // a missing credential is expected, not a problem
  });

  it("falls back to the LLM path, loudly, when a Jev call fails", async () => {
    const { decider } = countingDecider("throw");

    expect(await decideOrNull(REQ, { pool: stubPool("jev"), jev: decider })).toBe(null);
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toContain("classify");
    expect(String(warn.mock.calls[0]?.[0])).toContain("gateway exploded");
  });

  it("does not evaluate a lazy request while the flag is off", async () => {
    const { decider } = countingDecider();
    let built = 0;
    const source = async () => {
      built += 1;
      return REQ;
    };

    expect(await decideOrNull(source, { pool: stubPool("llm"), jev: decider })).toBe(null);
    expect(built).toBe(0); // draft and follow-up read the DB here; with the flag off they must not

    expect(await decideOrNull(source, { pool: stubPool("jev"), jev: decider })).toEqual(RESULT);
    expect(built).toBe(1);
  });

  it("treats a lazy request that resolves to null as an abstention", async () => {
    const { decider, calls, availableChecks } = countingDecider();

    expect(await decideOrNull(async () => null, { pool: stubPool("jev"), jev: decider })).toBe(
      null,
    );
    expect(calls).toEqual([]);
    expect(availableChecks.n).toBe(0); // never asked, so never probed either
  });

  it("reads the flag from the settings key the memo names", async () => {
    expect(DECISION_PROVIDER_KEY).toBe("agents.decision_provider");
    const seen: string[] = [];
    const pool = {
      query: async (_sql: string, values: unknown[]) => {
        seen.push(String(values[0]));
        return { rows: [] };
      },
    } as unknown as Pool;

    await decideOrNull(REQ, { pool });
    expect(seen).toEqual([DECISION_PROVIDER_KEY]);
  });
});
