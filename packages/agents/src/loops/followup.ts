// A4 §7 L6 network follow-up loop.
import type { Channel } from "@omnis/protocol";
import type { Pool } from "pg";
import { z } from "zod";
import { type ContextRequest, buildContext } from "../context/assemble.js";
import { registerLoop } from "../loop/registry.js";
import type { LoopSpec, TriggerContext } from "../loop/spec.js";
import { getAgentsPool } from "../pool.js";

/** A4 §7.3: at most 10 people per day — beyond that it is spam, not follow-up. */
export const INACTIVE_SWEEP_LIMIT = 10;
/** Master §13: we never initiate outreach on these two channels. */
export const NO_COLD_OUTREACH_CHANNELS: readonly Channel[] = ["linkedin", "kakaotalk"];

export function isFirstContact(
  p: { first_contact_at: string | null; item_count: number },
  now: Date,
): boolean {
  if (p.first_contact_at === null) return true;
  const days = (now.getTime() - new Date(p.first_contact_at).getTime()) / 86_400_000;
  return days <= 90 && p.item_count < 3;
}

/** A4 §7.4 channel choice: the most-used channel in the last 90 days, ties go to email. The two
 *  no-cold-outreach channels are the exception. */
export function pickFollowupChannel(i: {
  counts: Partial<Record<Channel, number>>;
  theySentLast: boolean;
  hasEmail: boolean;
}): Channel | null {
  const ranked = (Object.entries(i.counts) as [Channel, number][]).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  const top = ranked[0];
  if (top === undefined) return i.hasEmail ? "gmail" : null;
  // A4 §7.4/§7.5 hard gate: a no-cold-outreach channel drops out of the running whether tied or alone.
  // (The plan text returned the tie branch first and skipped this gate — the gate wins.)
  const forbidden = !i.theySentLast && NO_COLD_OUTREACH_CHANNELS.includes(top[0]);
  const tie = ranked.filter(([, n]) => n === top[1]).length > 1;
  if (i.hasEmail && (tie || forbidden)) return "gmail";
  // With no email either, we give up on sending entirely — the caller creates only the task.
  return forbidden ? null : top[0];
}

export interface InactiveCandidate {
  id: string;
  display_name: string;
  vip: boolean;
  thread_id: string;
  effective_cadence_days: number;
}

/** A4 §7.3 SQL verbatim. The LLM only runs over these candidates. */
export async function inactiveCandidates(pool: Pool): Promise<InactiveCandidate[]> {
  const { rows } = await pool.query<InactiveCandidate>(
    `WITH cadence AS (
       SELECT p.id, p.display_name, p.vip, p.priority_score, t.id AS thread_id, t.last_item_at,
              COALESCE(p.cadence_days,
                       CASE WHEN p.vip THEN 14
                            WHEN p.relationship_state = 'warming' THEN 21
                            WHEN p.relationship_state = 'active'  THEN 30 END)
                AS effective_cadence_days
         FROM persons p
         JOIN threads t ON t.id = p.primary_thread_id
        WHERE p.merged_into IS NULL
          AND p.relationship_state IN ('active','warming'))
     SELECT id, display_name, vip, thread_id, effective_cadence_days
       FROM cadence c
      WHERE c.last_item_at < now() - (c.effective_cadence_days || ' days')::interval
        AND NOT EXISTS (SELECT 1 FROM tasks k
                         WHERE k.person_id = c.id AND k.state = 'open' AND k.kind = 'followup'
                           AND k.created_at > now() - interval '14 days')
      ORDER BY c.priority_score DESC
      LIMIT ${INACTIVE_SWEEP_LIMIT}`,
  );
  return rows;
}

export const FollowupOutput = z.object({
  kind: z.enum(["post_meeting", "first_contact", "dormant_revive", "pending_step"]),
  person_id: z.string().uuid(),
  draft: z
    .object({
      channel: z.enum([
        "gmail",
        "slack",
        "telegram",
        "kakaotalk",
        "linkedin",
        "whatsapp",
        "outlook",
      ]),
      body: z.string().max(1500),
      register: z.string().max(20),
    })
    .optional(),
  task: z
    .object({ title: z.string().max(120), due_at: z.string().datetime().optional() })
    .optional(),
  relationship_update: z
    .object({
      state: z.enum(["unknown", "new", "warming", "active", "dormant", "closed"]).optional(),
      cadence_days: z.number().int().optional(),
      note: z.string().max(200).optional(),
    })
    .optional(),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(300),
  injection_flags: z.array(z.string()).default([]),
});
export type FollowupOutputT = z.infer<typeof FollowupOutput>;

export const followupLoop: LoopSpec<FollowupOutputT> = {
  id: "followup",
  kind: "deliberate",
  // The sweep job picks candidates and fires this event once per person — the loop itself runs for
  // a single person.
  trigger: { kind: "event", on: "person.inactive", debounceMs: 0 },
  palette: [
    "read_thread",
    "read_person",
    "read_entity",
    "read_calendar",
    "search_memory",
    "propose_draft",
    "propose_task",
  ],
  budget: { inputTokens: 5500, outputTokens: 800, wallClockMs: 40_000, maxSteps: 5 },
  tier: "T1",
  outputSchema: FollowupOutput,

  assemble: (ctx: TriggerContext) => {
    // ponytail: only attach the thread slot when thread_id exists — the plan's `ctx.thread_id ?? ""`
    // blows up the query with an empty-string uuid on the inactive sweep, which is not a meeting trigger.
    const req: ContextRequest = {
      selfModel: ["USER.md", "VOICE.md"],
      entities: { personIds: ctx.person_id === undefined ? [] : [ctx.person_id], asOf: "now" },
      memories: { query: String(ctx.payload.display_name ?? ""), k: 4 },
    };
    if (ctx.thread_id !== undefined) req.thread = { threadId: ctx.thread_id, lastN: 8 };
    return buildContext(req);
  },

  async apply(result, _ctx) {
    const pool = getAgentsPool();
    const o = result.output;
    const update = o.relationship_update;
    if (update === undefined) return;

    // A4 §7.4: relationship_update is applied automatically. Only the transition to 'closed' needs
    // approval — deciding to cut off a relationship is not the agent's job.
    if (update.state === "closed") {
      await pool.query(
        `INSERT INTO pending_approvals (action, args, description, risk, requested_by)
         VALUES ('memory_write', $1::jsonb, $2, 'normal',
                 (SELECT id FROM agent_runtimes WHERE runtime = 'omnis' LIMIT 1))`,
        [
          JSON.stringify({ person_id: o.person_id, state: "closed", note: update.note ?? null }),
          `Mark ${o.person_id}'s relationship as 'closed'? — ${o.rationale}`,
        ],
      );
      return;
    }
    await pool.query(
      `UPDATE persons
          SET relationship_state = COALESCE($2, relationship_state),
              cadence_days = COALESCE($3, cadence_days),
              notes = COALESCE($4, notes)
        WHERE id = $1`,
      [o.person_id, update.state ?? null, update.cadence_days ?? null, update.note ?? null],
    );
  },
};

registerLoop(followupLoop);

/** A4 §7.3 weekday 10:00 sweep (jobs.name = 'network_inactive_sweep'). Runs the loop once per candidate. */
export async function sweepFollowups(
  runOne: (c: InactiveCandidate) => Promise<void>,
): Promise<number> {
  const rows = await inactiveCandidates(getAgentsPool());
  for (const c of rows) await runOne(c);
  return rows.length;
}
