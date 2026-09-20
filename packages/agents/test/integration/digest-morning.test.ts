import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  MORNING_DIGEST_CRON,
  configureAgents,
  getLoop,
  morningCandidates,
  morningDigestLoop,
} from "../../src/index.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});
beforeEach(async () => {
  configureAgents({ pool });
  await pool.query("DELETE FROM digests WHERE kind = 'morning'");
  await pool.query("DELETE FROM pending_approvals");
});
afterAll(() => pool.end());

describe("morningDigestLoop (A4 §6)", () => {
  it("runs at 06:30 KST and stays out of the registry", () => {
    expect(MORNING_DIGEST_CRON).toBe("30 6 * * *");
    expect(() => getLoop("digest")).toThrow(/not registered/);
  });

  it("writes exactly one digests row per day with coverage metrics", async () => {
    const ctx = {
      trigger_kind: "cron" as const,
      trigger_ref: "morning_digest",
      now: new Date(),
      payload: {},
    };
    const r = {
      loop: "digest" as const,
      run_id: "00000000-0000-0000-0000-00000000aaaa",
      output: {
        greeting: "Good morning.",
        one_liner: "Two quotes are what matter most today.",
        confidence: 0.9,
        rationale: "",
        injection_flags: [],
      },
      confidence: 0.9,
      rationale: "",
      escalate: false,
      injection_flags: [],
      unresolved: [],
    };
    await morningDigestLoop.apply(r, ctx);
    await morningDigestLoop.apply(r, ctx);
    const { rows } = await pool.query<{ n: string; metrics: { shown: number } }>(
      `SELECT count(*)::text AS n, (array_agg(metrics))[1] AS metrics
         FROM digests WHERE kind = 'morning'`,
    );
    expect(rows[0]?.n).toBe("1");
    expect(rows[0]?.metrics).toHaveProperty("shown");
  });

  it("collects a thread-less approval as a needs_you candidate", async () => {
    await pool.query(
      `INSERT INTO pending_approvals (action, args, description)
       VALUES ('send', '{}'::jsonb, 'Approve the quote reply')`,
    );
    const rows = await morningCandidates(new Date());
    const approval = rows.find((r) => r.ref.kind === "approval");
    expect(approval?.section).toBe("needs_you");
    expect(approval?.line).toBe("Approve the quote reply");
    expect(approval?.pendingApproval).toBe(true);
    // Even when thread_id is NULL, the dedupe key must not become null.
    expect(approval?.thread_id).toBe(approval?.ref.id);
  });
});
