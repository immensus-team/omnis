import { createPool, one, query, tx } from "@omnis/db";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let pool: Pool;
let personId = "";
let accountId = "";

beforeAll(async () => {
  pool = createPool();
  const ids = await tx(pool, async (c) => {
    const acc = await one<{ id: string }>(
      c,
      `INSERT INTO accounts (channel, external_id, display) VALUES ('gcal','acc-cal','cal') RETURNING id`,
    );
    const person = await one<{ id: string }>(
      c,
      `INSERT INTO persons (display_name, org) VALUES ('Mina Park','Davich') RETURNING id`,
    );
    const thread = await one<{ id: string }>(
      c,
      `INSERT INTO threads (account_id, external_id, kind, participants)
       VALUES ($1,'cal-main','calendar', ARRAY[$2]::uuid[]) RETURNING id`,
      [acc.id, person.id],
    );
    // A3 §2.1 조인 규칙: items.sent_at = start_at
    const item = await one<{ id: string }>(
      c,
      `INSERT INTO items (thread_id, account_id, kind, subject, body, sent_at)
       VALUES ($1,$2,'event','PoC 킥오프','', now() - interval '3 days') RETURNING id`,
      [thread.id, acc.id],
    );
    await query(
      c,
      `INSERT INTO calendar_events (item_id, account_id, external_id, start_at, end_at, attendees)
       VALUES ($1,$2,'ev-acc', now() - interval '3 days', now() - interval '3 days' + interval '1 hour',
               '[{"email":"mina@davich.kr"},{"email":"logan@onward.lab"}]'::jsonb)`,
      [item.id, acc.id],
    );
    return { accountId: acc.id, personId: person.id };
  });
  accountId = ids.accountId;
  personId = ids.personId;
});
afterAll(async () => {
  await pool.end();
});

describe("US-A04 acceptance: calendar queries (A4 §7.1, A3 §12 5b)", () => {
  it("selects meetings whose attendees_count is between 1 and 8", async () => {
    const rows = await query<{ id: string; attendees_count: number }>(
      pool,
      `SELECT ce.id, ce.attendees_count
         FROM calendar_events ce
        WHERE ce.attendees_count BETWEEN 1 AND 8
          AND ce.status <> 'cancelled'
          AND ce.account_id = $1`,
      [accountId],
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]?.attendees_count).toBe(2);
  });

  it("runs the A3 §12 (5b) 48-hour missed-followup metric query", async () => {
    const rows = await query<{ missed_followups: string; who: string[] | null }>(
      pool,
      `WITH met AS (
         SELECT DISTINCT unnest(t.participants) AS person_id, max(ce.end_at) AS met_at
           FROM threads t
           JOIN items i  ON i.thread_id = t.id AND i.kind = 'event'
           JOIN calendar_events ce ON ce.item_id = i.id
          WHERE t.kind = 'calendar'
            AND ce.status <> 'cancelled'
            AND ce.end_at BETWEEN now() - interval '14 days' AND now() - $1::interval
          GROUP BY 1
       )
       SELECT count(*)::text AS missed_followups, array_agg(p.display_name) AS who
         FROM met m JOIN persons p ON p.id = m.person_id AND p.merged_into IS NULL
        WHERE NOT EXISTS (
          SELECT 1 FROM items i2
          JOIN threads t2 ON t2.id = i2.thread_id
          WHERE i2.author_is_me AND i2.status = 'sent'
            AND i2.sent_at > m.met_at AND i2.sent_at <= m.met_at + interval '48 hours'
            AND p.id = ANY (t2.participants))`,
      ["48 hours"],
    );
    expect(rows[0]?.missed_followups).toBe("1");
    expect(rows[0]?.who).toContain("Mina Park");
  });

  it("drops the person from the metric once I replied inside 48 hours", async () => {
    const thread = await one<{ id: string }>(
      pool,
      `SELECT id FROM threads WHERE external_id = 'cal-main'`,
    );
    await query(
      pool,
      `INSERT INTO items (thread_id, account_id, kind, body, status, author_is_me, sent_at)
       VALUES ($1,$2,'message','감사합니다','sent', true, now() - interval '2 days')`,
      [thread.id, accountId],
    );
    const rows = await query<{ missed_followups: string }>(
      pool,
      `WITH met AS (
         SELECT DISTINCT unnest(t.participants) AS person_id, max(ce.end_at) AS met_at
           FROM threads t
           JOIN items i  ON i.thread_id = t.id AND i.kind = 'event'
           JOIN calendar_events ce ON ce.item_id = i.id
          WHERE t.kind = 'calendar'
            AND ce.status <> 'cancelled'
            AND ce.end_at BETWEEN now() - interval '14 days' AND now() - $1::interval
          GROUP BY 1
       )
       SELECT count(*)::text AS missed_followups
         FROM met m JOIN persons p ON p.id = m.person_id AND p.merged_into IS NULL
        WHERE NOT EXISTS (
          SELECT 1 FROM items i2
          JOIN threads t2 ON t2.id = i2.thread_id
          WHERE i2.author_is_me AND i2.status = 'sent'
            AND i2.sent_at > m.met_at AND i2.sent_at <= m.met_at + interval '48 hours'
            AND p.id = ANY (t2.participants))`,
      ["48 hours"],
    );
    expect(rows[0]?.missed_followups).toBe("0");
    expect(personId).not.toBe("");
  });
});
