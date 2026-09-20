import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  T1_ARCHIVE_CONFIDENCE_MIN,
  autoArchiveLoop,
  configureAgents,
  hardGate,
  nonHumanSender,
  sweepAutoArchive,
} from "../../src/index.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});
let accountId = "";
let threadId = "";
beforeEach(async () => {
  configureAgents({ pool });
  const a = await pool.query<{ id: string }>(
    `INSERT INTO accounts (channel, external_id, display) VALUES ('gmail','aa@test','a')
       ON CONFLICT (channel, external_id) DO UPDATE SET display='a' RETURNING id`,
  );
  accountId = a.rows[0]?.id ?? "";
  const t = await pool.query<{ id: string }>(
    `INSERT INTO threads (account_id, external_id, kind, meta) VALUES ($1,'thr_aa','email','{}'::jsonb)
       ON CONFLICT (account_id, external_id) DO UPDATE SET meta='{}'::jsonb RETURNING id`,
    [accountId],
  );
  threadId = t.rows[0]?.id ?? "";
  await pool.query("DELETE FROM pending_approvals WHERE thread_id = $1", [threadId]);
  await pool.query("DELETE FROM items WHERE thread_id = $1", [threadId]);
});
afterAll(() => pool.end());

async function mkItem(over: Record<string, unknown> = {}): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO items (thread_id, account_id, kind, status, sensitivity, body, sent_at, meta)
     VALUES ($1,$2,$3,'received',$4,$5, now(), $6::jsonb) RETURNING id`,
    [
      threadId,
      accountId,
      over.kind ?? "email",
      over.sensitivity ?? "normal",
      over.body ?? "This is the weekly newsletter.",
      JSON.stringify(over.meta ?? {}),
    ],
  );
  return rows[0]?.id ?? "";
}

describe("autoArchiveLoop hard gates (A4 §9.2)", () => {
  it("declares the T0-first spec", () => {
    expect(autoArchiveLoop.id).toBe("auto_archive");
    expect(autoArchiveLoop.tier).toBe("T0");
    expect(autoArchiveLoop.palette).toEqual([]);
    expect(T1_ARCHIVE_CONFIDENCE_MIN).toBe(0.85);
  });

  it("refuses non-normal sensitivity, VIP, pending approvals, injection flags and wrong kinds", async () => {
    const sensitive = await mkItem({ sensitivity: "finance" });
    expect((await hardGate(pool, sensitive)).blocked).toBe(true);

    const flagged = await mkItem({ meta: { injection_flags: ["instruction_override"] } });
    expect((await hardGate(pool, flagged)).blocked).toBe(true);

    const wrongKind = await mkItem({ kind: "system" });
    expect((await hardGate(pool, wrongKind)).blocked).toBe(true);

    const vipItem = await mkItem();
    const p = await pool.query<{ id: string }>(
      "INSERT INTO persons (display_name, vip) VALUES ('VIP', true) RETURNING id",
    );
    await pool.query("UPDATE items SET author_person_id = $2 WHERE id = $1", [
      vipItem,
      p.rows[0]?.id ?? "",
    ]);
    expect((await hardGate(pool, vipItem)).reason).toBe("vip");

    const plain = await mkItem();
    expect((await hardGate(pool, plain)).blocked).toBe(false);
    await pool.query(
      `INSERT INTO pending_approvals (action, args, description, thread_id)
       VALUES ('send','{}'::jsonb,'pending approval',$1)`,
      [threadId],
    );
    expect((await hardGate(pool, plain)).blocked).toBe(true);
  });

  it("refuses a thread a human un-archived in the last 30 days (A4 §9.4)", async () => {
    const id = await mkItem();
    await pool.query(
      `UPDATE threads SET meta = jsonb_build_object(
          'no_auto_archive_until', (now() + interval '30 days')::text) WHERE id = $1`,
      [threadId],
    );
    expect((await hardGate(pool, id)).reason).toBe("rearchive_exclusion");
    await pool.query("UPDATE threads SET meta = '{}'::jsonb WHERE id = $1", [threadId]);
  });

  it("nonHumanSender catches no-reply locals and bulk headers", () => {
    expect(nonHumanSender({ handle: "no-reply@news.example", meta: {} })).toBe(true);
    expect(nonHumanSender({ handle: "notifications@x.example", meta: {} })).toBe(true);
    expect(nonHumanSender({ handle: "a@b.example", meta: { "List-Unsubscribe": "<x>" } })).toBe(
      true,
    );
    expect(nonHumanSender({ handle: "logan@onward.example", meta: {} })).toBe(false);
  });

  it("archives a newsletter entirely at T0 (no model call)", async () => {
    // Frozen: this Korean body is the newsletter fixture the UNSUBSCRIBE matcher must keep matching.
    const id = await mkItem({ body: "이번 주 소식입니다. 구독 해지는 아래에서." });
    await pool.query(
      `UPDATE items SET meta = meta || '{"headers":{"List-Unsubscribe":"<x>"}}'::jsonb WHERE id = $1`,
      [id],
    );
    const decided = await autoArchiveLoop.decide?.({
      trigger_kind: "event",
      item_id: id,
      thread_id: threadId,
      now: new Date(),
      payload: {},
    });
    expect(decided?.output.archive).toBe(true);
    expect(decided?.output.tier).toBe("T0");
    const runs = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM agent_runs WHERE item_id = $1 AND model_tier <> 'T0'",
      [id],
    );
    expect(runs.rows[0]?.n).toBe("0");
  });

  it("falls through to the model path when the body asks something", async () => {
    const id = await mkItem({
      body: "Just a heads-up. Are you able to attend?",
      meta: { headers: { "List-Unsubscribe": "<x>" } },
    });
    const decided = await autoArchiveLoop.decide?.({
      trigger_kind: "event",
      item_id: id,
      thread_id: threadId,
      now: new Date(),
      payload: {},
    });
    expect(decided).toBeNull();
  });

  it("apply() archives at T0 but refuses a T1 verdict below the threshold", async () => {
    const low = await mkItem();
    const ctx = {
      trigger_kind: "event" as const,
      item_id: low,
      thread_id: threadId,
      now: new Date(),
      payload: {},
    };
    await autoArchiveLoop.apply(
      {
        loop: "auto_archive",
        run_id: "00000000-0000-0000-0000-000000000000",
        output: {
          archive: true,
          reason: "newsletter",
          rule_ids: [],
          tier: "T1",
          confidence: T1_ARCHIVE_CONFIDENCE_MIN - 0.01,
          rationale: "ambiguous",
          injection_flags: [],
        },
        confidence: 0.84,
        rationale: "",
        escalate: false,
        injection_flags: [],
        unresolved: [],
      },
      ctx,
    );
    const after = await pool.query<{ status: string }>("SELECT status FROM items WHERE id = $1", [
      low,
    ]);
    expect(after.rows[0]?.status).toBe("received");

    await autoArchiveLoop.apply(
      {
        loop: "auto_archive",
        run_id: "00000000-0000-0000-0000-000000000000",
        output: {
          archive: true,
          reason: "newsletter",
          rule_ids: ["ar_sender_nonhuman"],
          tier: "T0",
          confidence: 0.95,
          rationale: "archive",
          injection_flags: [],
        },
        confidence: 0.95,
        rationale: "",
        escalate: false,
        injection_flags: [],
        unresolved: [],
      },
      ctx,
    );
    const done = await pool.query<{ status: string; reason: string }>(
      "SELECT status, meta->'archived_by'->>'reason' AS reason FROM items WHERE id = $1",
      [low],
    );
    expect(done.rows[0]?.status).toBe("archived");
    expect(done.rows[0]?.reason).toBe("newsletter");
  });

  it("sweepAutoArchive hands today's untouched items to the runner", async () => {
    const id = await mkItem();
    const seen: string[] = [];
    const n = await sweepAutoArchive(async (itemId) => {
      seen.push(itemId);
    });
    expect(n).toBeGreaterThanOrEqual(1);
    expect(seen).toContain(id);
  });
});
