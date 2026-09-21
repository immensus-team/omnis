// US-C17 (master §2 success metric, §16 exit; A3 §12 5b). The metric the phase's exit criterion is
// stated in — "missed follow-ups = 0" — and nothing measured it. Pure SQL, no LLM, no notification:
// this job only counts and files the number in the night's digest row.
//
// The window is what makes a nightly sweep correct: [now-72h, now-48h] is exactly one day wide, so a
// meeting is judged once — 48 hours after it ended, which is A3 §12 5b's own grace period — and falls
// out of the window before the next run. An event that ended 47 hours ago may still be replied to.
import { query } from "@omnis/db";
import type { Pool } from "pg";
import { SEOUL_OFFSET_MS } from "../cron.js";
import type { Logger } from "../logger.js";
import type { Scheduler } from "../scheduler.js";

export const FOLLOWUP_MISS_JOB_NAME = "followup_miss";
/** 22:40 KST, twenty minutes before the nightly digest loop (23:00 KST). The order is what puts the
 *  number in the night's *body*: that loop builds it at 23:00 and reads this key for its
 *  "Missed follow-ups: N" line, so the count has to be in the row first. It is not a merge race —
 *  the loop merges its own metrics into the bag rather than replacing it (digest-nightly.ts). */
export const FOLLOWUP_MISS_CRON = "40 22 * * *";

/**
 * A3 §12 5b, narrowed to what US-C17's rule states: a meeting that ended in the window, with at
 * least one attendee who resolved to a `persons` row, and no `status='sent'` item authored by me in
 * any thread those people are in, sent after the meeting ended.
 *
 * Two things are deliberate. `p.merged_into IS NULL` skips a tombstoned person — following up with a
 * row that was merged away is following up with nobody. And the attendee's `person_id` is compared
 * as text against `threads.participants::text[]` instead of being cast to `uuid`: the column is
 * jsonb with no shape constraint, and a single malformed value would otherwise abort the whole
 * night's metric rather than just fail to match.
 *
 * `status <> 'cancelled'` is A3 §12 5b's own filter (migration 0002 even indexes `end_at` on it).
 * Nobody follows up on a meeting that did not happen, so counting one would file a miss that no
 * reply can ever clear — and the phase's exit gate is "0 for 14 consecutive nights".
 *
 * "Other than me" needs no clause of its own: `items.author_is_me` is the only place this schema
 * records who I am (A4 §7.2 has no self row in `persons`), so the reply half of the rule is already
 * mine-only, and an attendee who happens to be me cannot make a meeting external.
 */
const MISS_QUERY = `
  SELECT ce.id::text AS id
    FROM calendar_events ce
   WHERE ce.end_at >= $1::timestamptz - interval '72 hours'
     AND ce.end_at <= $1::timestamptz - interval '48 hours'
     AND ce.status <> 'cancelled'
     AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(ce.attendees) a
         JOIN persons p ON p.id::text = a->>'person_id'
        WHERE p.merged_into IS NULL)
     AND NOT EXISTS (
       SELECT 1
         FROM items i
         JOIN threads t ON t.id = i.thread_id
        WHERE i.status = 'sent'
          AND i.author_is_me
          AND i.sent_at > ce.end_at
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(ce.attendees) a
             WHERE a->>'person_id' = ANY (t.participants::text[])))
   ORDER BY ce.end_at, ce.id`;

/** The KST calendar day of `now`, as `digests.for_date` names it (digest-nightly.ts writes that
 *  column with `now() AT TIME ZONE 'Asia/Seoul'`, and the file is filed under that day). */
function kstDate(now: Date): string {
  return new Date(now.getTime() + SEOUL_OFFSET_MS).toISOString().slice(0, 10);
}

/** Counts the night's misses and files the number under `digests.metrics.followup_miss`.
 *
 *  The write is a merge, the way the monthly cost report's is: `metrics` is a shared jsonb bag and
 *  the digest loop reads and writes other keys in it. The merge is the only write when the day's row
 *  already exists.
 *
 *  When it does not, the row is created — but only if there is a number to file. A row that exists
 *  and has no body is a state the Digest screen reads as a *built* digest (it draws the body, and an
 *  empty body parses to no groups: "Nothing was auto-archived today"), which is wrong for the twenty
 *  minutes between this job and the loop that writes the body. So a night with nothing to count
 *  creates nothing: an absent `followup_miss` reads as 0 in every place that reads it, which is the
 *  same answer without the misleading row. */
export async function runFollowupMiss(
  pool: Pool,
  now: Date = new Date(),
): Promise<{ misses: number; meetingIds: string[] }> {
  const rows = await query<{ id: string }>(pool, MISS_QUERY, [now]);
  const meetingIds = rows.map((r) => r.id);
  const forDate = kstDate(now);

  const merged = await query<{ id: string }>(
    pool,
    `UPDATE digests SET metrics = digests.metrics || jsonb_build_object('followup_miss', $2::int)
      WHERE kind = 'nightly' AND for_date = $1
      RETURNING id`,
    [forDate, meetingIds.length],
  );
  if (merged.length === 0 && meetingIds.length > 0) {
    // ON CONFLICT for the unlikely race with the 23:00 loop inserting the same day's row.
    await query(
      pool,
      `INSERT INTO digests (kind, for_date, body, metrics)
         VALUES ('nightly', $1, '', jsonb_build_object('followup_miss', $2::int))
         ON CONFLICT (kind, for_date) DO UPDATE
           SET metrics = digests.metrics || jsonb_build_object('followup_miss', $2::int)`,
      [forDate, meetingIds.length],
    );
  }

  return { misses: meetingIds.length, meetingIds };
}

export interface FollowupMissDeps {
  pool: Pool;
  logger: Logger;
  now?: () => Date;
}

export function registerFollowupMissJob(scheduler: Scheduler, deps: FollowupMissDeps): void {
  scheduler.register(FOLLOWUP_MISS_JOB_NAME, FOLLOWUP_MISS_CRON, async () => {
    const { misses } = await runFollowupMiss(deps.pool, deps.now?.() ?? new Date());
    deps.logger.info("followup miss counted", { misses });
  });
}
