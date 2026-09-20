import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  NIGHTLY_DIGEST_CRON,
  configureAgents,
  nightlyDigestLoop,
  nightlyGroups,
  undoTokenFor,
} from "../../src/index.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});
let threadId = "";
let seededAt = new Date();

beforeEach(async () => {
  configureAgents({ pool });
  await pool.query("DELETE FROM digests WHERE kind = 'nightly'");
  const a = await pool.query<{ id: string }>(
    `INSERT INTO accounts (channel, external_id, display) VALUES ('gmail','nd@test','n')
       ON CONFLICT (channel, external_id) DO UPDATE SET display='n' RETURNING id`,
  );
  const accountId = a.rows[0]?.id ?? "";
  const t = await pool.query<{ id: string }>(
    `INSERT INTO threads (account_id, external_id, kind) VALUES ($1,'thr_nd','email')
       ON CONFLICT (account_id, external_id) DO UPDATE SET kind='email' RETURNING id`,
    [accountId],
  );
  threadId = t.rows[0]?.id ?? "";
  await pool.query("DELETE FROM items WHERE thread_id = $1", [threadId]);
  // Clear the archive markers left behind by earlier test files — nightlyGroups counts DB-wide.
  await pool.query(
    "UPDATE items SET meta = meta - 'archived_by' WHERE status = 'archived' AND thread_id <> $1",
    [threadId],
  );
  seededAt = new Date();
  for (let i = 0; i < 5; i += 1) {
    await pool.query(
      `INSERT INTO items (thread_id, account_id, kind, status, body, sent_at, meta)
       VALUES ($1,$2,'email','archived',$3, now(),
         jsonb_build_object('archived_by', jsonb_build_object(
           'rule_ids','["ar_no_cta"]'::jsonb,'reason','newsletter','tier','T0',
           'confidence',0.95,'run_id','r','at', now()::text)))`,
      [threadId, accountId, `Newsletter ${i}`],
    );
  }
});
afterAll(() => pool.end());

describe("nightlyDigestLoop (A4 §6.4·§9.4)", () => {
  it("runs at 23:00 KST", () => {
    expect(NIGHTLY_DIGEST_CRON).toBe("0 23 * * *");
  });

  it("exposes every archived item — count is the full number, samples are capped at 3", async () => {
    const groups = await nightlyGroups(pool, seededAt, "d1");
    const g = groups.find((x) => x.reason === "newsletter");
    expect(g?.count).toBe(5);
    expect(g?.samples.length).toBe(3);
    expect(g?.undo_token).toBe(undoTokenFor("d1", "newsletter"));
  });

  // The fallback for an archived item whose meta carries no reason. kernel archive.ts's
  // archivedSince() reports the same bucket, so the two must not drift: reason is also what
  // undo_token is hashed from, and a casing split would silently produce two buckets and two
  // undo tokens for one bucket of items.
  it("buckets an archived item with no reason under 'Other'", async () => {
    await pool.query(
      `INSERT INTO items (thread_id, account_id, kind, status, body, sent_at, meta)
       VALUES ($1, (SELECT account_id FROM threads WHERE id = $1), 'email', 'archived',
               'No reason recorded', now(),
               jsonb_build_object('archived_by', jsonb_build_object('at', now()::text)))`,
      [threadId],
    );
    const groups = await nightlyGroups(pool, seededAt, "d1");
    expect(groups.find((x) => x.reason === "Other")?.count).toBe(1);
    expect(groups.find((x) => x.reason === "other")).toBeUndefined();
  });

  it("stores the cost field the hub injected", async () => {
    await nightlyDigestLoop.apply(
      {
        loop: "digest",
        run_id: "00000000-0000-0000-0000-00000000bbbb",
        output: {
          headline: "3 items handled today, 5 auto-archived.",
          one_liner: "It was a quiet day.",
          confidence: 0.9,
          rationale: "",
          injection_flags: [],
        },
        confidence: 0.9,
        rationale: "",
        escalate: false,
        injection_flags: [],
        unresolved: [],
      },
      {
        trigger_kind: "cron",
        trigger_ref: "nightly_digest",
        now: new Date(),
        payload: { cost: { month_to_date_usd: 12.5, cap_usd: 60, tier_state: "normal" } },
      },
    );
    const { rows } = await pool.query<{ body: string }>(
      "SELECT body FROM digests WHERE kind = 'nightly' ORDER BY created_at DESC LIMIT 1",
    );
    const parsed = JSON.parse(rows[0]?.body ?? "{}") as {
      cost: { cap_usd: number; tier_state: string };
      auto_archived: { count: number }[];
    };
    expect(parsed.cost).toEqual({ month_to_date_usd: 12.5, cap_usd: 60, tier_state: "normal" });
    expect(parsed.auto_archived[0]?.count).toBe(5);
  });

  it("falls back to a zeroed cost field when the hub injected none", async () => {
    await nightlyDigestLoop.apply(
      {
        loop: "digest",
        run_id: "00000000-0000-0000-0000-00000000cccc",
        output: {
          headline: "Quiet.",
          one_liner: "",
          confidence: 0.9,
          rationale: "",
          injection_flags: [],
        },
        confidence: 0.9,
        rationale: "",
        escalate: false,
        injection_flags: [],
        unresolved: [],
      },
      { trigger_kind: "cron", trigger_ref: "nightly_digest", now: new Date(), payload: {} },
    );
    const { rows } = await pool.query<{ n: string; body: string }>(
      `SELECT count(*)::text AS n, (array_agg(body))[1] AS body
         FROM digests WHERE kind = 'nightly'`,
    );
    expect(rows[0]?.n).toBe("1"); // one row per day — the second apply updates the same row
    const parsed = JSON.parse(rows[0]?.body ?? "{}") as { cost: { cap_usd: number } };
    expect(parsed.cost).toEqual({ month_to_date_usd: 0, cap_usd: 60, tier_state: "normal" });
  });
});
