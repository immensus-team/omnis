import { createPool, one, query, tx } from "@omnis/db";
import { runFollowupMiss } from "@omnis/kernel";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** The injected clock, not `new Date()`: A3 §12 (5b)'s metric window is [now-72h, now-48h], and
 *  the sibling suite that pins that query (packages/db calendar-queries) counts meetings at
 *  `now() - 3 days` with **no account filter** — its "drops the person once I replied" case asserts
 *  a global zero. A fixture at the real "now" would land in both windows and make one of the two
 *  suites order-dependent, so this one runs six months in the past: 2026-03-10 22:00 KST. */
const NOW = new Date("2026-03-10T13:00:00Z");
/** 60h before NOW — inside the sweep window. */
const END = new Date("2026-03-08T01:00:00Z");
/** 47h before NOW — the same meeting shape, one hour too recent to judge yet. */
const END_TOO_RECENT = new Date("2026-03-08T14:00:00Z");
const KST_DAY = "2026-03-10";

let pool: Pool;
let accountId = "";
const eventIds: Record<string, string> = {};
let anaId = "";
let boId = "";
let caiId = "";

/** A calendar thread item: A3 §2.1's join rule is `items.sent_at = start_at`. */
async function seedMeeting(
  c: Pool,
  externalId: string,
  start: Date,
  end: Date,
  attendees: unknown[],
): Promise<string> {
  const thread = await one<{ id: string }>(
    c,
    `INSERT INTO threads (account_id, external_id, kind, participants)
     VALUES ($1, $2, 'calendar', '{}') RETURNING id`,
    [accountId, `${externalId}-thread`],
  );
  const item = await one<{ id: string }>(
    c,
    `INSERT INTO items (thread_id, account_id, kind, subject, body, sent_at)
     VALUES ($1, $2, 'event', $3, '', $4) RETURNING id`,
    [thread.id, accountId, externalId, start],
  );
  const event = await one<{ id: string }>(
    c,
    `INSERT INTO calendar_events (item_id, account_id, external_id, start_at, end_at, attendees)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING id`,
    [item.id, accountId, externalId, start, end, JSON.stringify(attendees)],
  );
  return event.id;
}

beforeAll(async () => {
  pool = createPool();
  await tx(pool, async (c) => {
    const account = await one<{ id: string }>(
      c,
      `INSERT INTO accounts (channel, external_id, display)
       VALUES ('gcal', 'c17-cal', 'US-C17 calendar') RETURNING id`,
    );
    accountId = account.id;
    const person = async (name: string) =>
      (
        await one<{ id: string }>(
          c,
          "INSERT INTO persons (display_name) VALUES ($1) RETURNING id",
          [name],
        )
      ).id;
    anaId = await person("C17 Ana");
    boId = await person("C17 Bo");
    caiId = await person("C17 Cai");

    // The two conversations the reply check reads: one thread per outside attendee.
    const dm = async (externalId: string, personId: string) =>
      (
        await one<{ id: string }>(
          c,
          `INSERT INTO threads (account_id, external_id, kind, participants)
           VALUES ($1, $2, 'dm', ARRAY[$3]::uuid[]) RETURNING id`,
          [accountId, externalId, personId],
        )
      ).id;
    const anaThread = await dm("c17-dm-ana", anaId);
    await dm("c17-dm-bo", boId);

    eventIds.ana = await seedMeeting(c, "c17-ev-ana", END, END, [
      { email: "ana@davich.test", person_id: anaId },
      { email: "logan@onward.lab" },
    ]);
    eventIds.bo = await seedMeeting(c, "c17-ev-bo", END, END, [
      { email: "bo@davich.test", person_id: boId },
      { email: "logan@onward.lab" },
    ]);
    // Internal-only: nobody resolved to a persons row, so there is nobody to follow up with.
    eventIds.internal = await seedMeeting(c, "c17-ev-internal", END, END, [
      { email: "logan@onward.lab" },
      { email: "mina@onward.lab" },
    ]);
    eventIds.recent = await seedMeeting(c, "c17-ev-recent", END_TOO_RECENT, END_TOO_RECENT, [
      { email: "cai@davich.test", person_id: caiId },
    ]);

    // The one follow-up that happened: I replied to Ana two hours after the meeting ended.
    await query(
      c,
      `INSERT INTO items (thread_id, account_id, kind, body, status, author_is_me, sent_at)
       VALUES ($1, $2, 'message', 'Good to meet you', 'sent', true, $3)`,
      [anaThread, accountId, new Date(END.getTime() + 2 * 3_600_000)],
    );

    // A nightly row already exists for the day, with a metric the job must not disturb.
    await query(
      c,
      `INSERT INTO digests (kind, for_date, body, metrics)
       VALUES ('nightly', $1, 'existing body', '{"archived":7}'::jsonb)`,
      [KST_DAY],
    );
  });
});

afterAll(async () => {
  await query(pool, "DELETE FROM digests WHERE kind = 'nightly' AND for_date = $1", [KST_DAY]);
  // calendar_events hang off items (item_id, ON DELETE CASCADE), items off threads.
  await query(pool, "DELETE FROM items WHERE account_id = $1", [accountId]);
  await query(pool, "DELETE FROM threads WHERE account_id = $1", [accountId]);
  await query(pool, "DELETE FROM persons WHERE display_name LIKE 'C17 %'");
  await query(pool, "DELETE FROM accounts WHERE id = $1", [accountId]);
  await pool.end();
});

function readDigest() {
  return one<{ metrics: Record<string, unknown>; body: string }>(
    pool,
    "SELECT metrics, body FROM digests WHERE kind = 'nightly' AND for_date = $1",
    [KST_DAY],
  );
}

describe("runFollowupMiss (US-C17, A3 §12 5b)", () => {
  it("counts the meeting with no follow-up and leaves the internal-only one out", async () => {
    const result = await runFollowupMiss(pool, NOW);

    expect(result.misses).toBe(1);
    expect(result.meetingIds).toEqual([eventIds.bo]);
    expect(result.meetingIds).not.toContain(eventIds.ana); // replied two hours later
    expect(result.meetingIds).not.toContain(eventIds.internal); // nobody to follow up with
    expect(result.meetingIds).not.toContain(eventIds.recent); // ended 47h ago — not judged yet
  });

  it("merges followup_miss into today's nightly row without touching the other metrics", async () => {
    await runFollowupMiss(pool, NOW);
    const row = await readDigest();

    expect(row.metrics.followup_miss).toBe(1);
    expect(row.metrics.archived).toBe(7);
    expect(row.body).toBe("existing body"); // metrics only — the body is the digest's to write
  });

  it("is idempotent: a second run on the same night leaves the row as the first one wrote it", async () => {
    await runFollowupMiss(pool, NOW);
    const first = await readDigest();
    const second = await runFollowupMiss(pool, NOW);

    expect(second.misses).toBe(1);
    expect(await readDigest()).toEqual(first);
  });

  it("reports zero rather than throwing when nothing ended in the window", async () => {
    // 2026-06-01: no fixture of this suite is anywhere near it.
    const result = await runFollowupMiss(pool, new Date("2026-06-01T13:00:00Z"));

    expect(result).toEqual({ misses: 0, meetingIds: [] });
    await query(pool, "DELETE FROM digests WHERE kind = 'nightly' AND for_date = '2026-06-01'");
  });
});
