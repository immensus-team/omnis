// A4 §6.1~§6.3. The briefing must be complete by 06:30, so we call it synchronously rather than
// through a batch queue.
import { z } from "zod";
import { buildContext } from "../context/assemble.js";
import {
  type BriefCandidate,
  type BriefItem,
  type BriefSection,
  SECTION_CAPS,
  rankBriefItems,
} from "../digest/rank.js";
import type { LoopSpec, TriggerContext } from "../loop/spec.js";
import { getAgentsPool } from "../pool.js";

export const MORNING_DIGEST_CRON = "30 6 * * *";

/** These two sentences are all the model writes (A4 §6.3). */
export const MorningDigestOutput = z.object({
  greeting: z.string().max(120),
  one_liner: z.string().max(160),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(200),
  // ponytail: no .default() here, for the same reason as auto-archive.ts — once z.input and
  // z.output diverge it will not assign to LoopSpec's ZodType<TOut>.
  injection_flags: z.array(z.string()),
});
export type MorningDigestOutputT = z.infer<typeof MorningDigestOutput>;

const SECTION_TITLE: Record<string, string> = {
  needs_you: "Needs your decision now",
  drafts: "Drafts ready to send",
  calendar: "Today's schedule",
  commitments: "Your commitments",
  agents: "Agent progress / results",
};

export async function morningCandidates(now: Date): Promise<BriefCandidate[]> {
  const { rows } = await getAgentsPool().query<{
    kind: BriefCandidate["ref"]["kind"];
    id: string;
    thread_id: string;
    section: BriefCandidate["section"];
    line: string;
    why: string;
    priority: BriefCandidate["priority"];
    vip: boolean;
    pending_approval: boolean;
    unanswered_turns: number;
    meeting_today: boolean;
    due_today: boolean;
    age_hours: string;
    snoozed: boolean;
  }>(
    `WITH approvals AS (
       SELECT 'approval'::text AS kind, a.id::text AS id,
              COALESCE(a.thread_id::text, a.id::text) AS thread_id,
              'needs_you'::text AS section, a.description AS line, 'Pending approval'::text AS why,
              'now'::text AS priority, false AS vip, true AS pending_approval,
              0 AS unanswered_turns, false AS meeting_today, false AS due_today,
              (EXTRACT(EPOCH FROM (now() - a.created_at))/3600)::text AS age_hours,
              false AS snoozed
         FROM pending_approvals a WHERE a.state = 'pending'),
     drafts AS (
       SELECT 'item', i.id::text, i.thread_id::text, 'drafts',
              left(i.body, 90), COALESCE(i.meta->'draft'->>'rationale', 'Draft ready'), 'today',
              COALESCE(p.vip, false), false, 0, false, false,
              (EXTRACT(EPOCH FROM (now() - i.sent_at))/3600)::text, false
         FROM items i
         LEFT JOIN persons p ON p.id = i.author_person_id
        WHERE i.status = 'draft' AND (i.meta->>'pending') IS DISTINCT FROM 'true'),
     events AS (
       SELECT 'event', c.id::text, i.thread_id::text, 'calendar',
              COALESCE(i.subject, '(no subject)'),
              to_char(c.start_at AT TIME ZONE 'Asia/Seoul', 'HH24:MI'),
              'today', false, false, 0, true, false, '0', false
         FROM calendar_events c JOIN items i ON i.id = c.item_id
        WHERE c.status <> 'cancelled'
          AND c.start_at >= date_trunc('day', $1::timestamptz)
          AND c.start_at <  date_trunc('day', $1::timestamptz) + interval '1 day'),
     commitments AS (
       SELECT 'task', t.id::text, COALESCE(i.thread_id::text, t.id::text), 'commitments',
              t.title, 'Your commitment', 'today', false, false, 0, false,
              (t.due_at IS NOT NULL AND t.due_at < $1::timestamptz + interval '1 day'),
              (EXTRACT(EPOCH FROM (now() - t.created_at))/3600)::text, false
         FROM tasks t LEFT JOIN items i ON i.id = t.source_item_id
        WHERE t.state IN ('open','in_progress')),
     agents AS (
       SELECT 'session', s.id::text, s.thread_id::text, 'agents',
              COALESCE(s.summary, s.session_key), s.state, 'week', false, false, 0, false, false,
              (EXTRACT(EPOCH FROM (now() - s.started_at))/3600)::text, false
         FROM agent_sessions s WHERE s.ended_at IS NULL)
     SELECT * FROM approvals UNION ALL SELECT * FROM drafts UNION ALL SELECT * FROM events
     UNION ALL SELECT * FROM commitments UNION ALL SELECT * FROM agents`,
    [now],
  );

  return rows.map((r) => ({
    ref: { kind: r.kind, id: r.id },
    thread_id: r.thread_id,
    section: r.section,
    line: r.line,
    why: r.why,
    priority: r.priority,
    vip: r.vip,
    pendingApproval: r.pending_approval,
    unansweredTurns: r.unanswered_turns,
    meetingToday: r.meeting_today,
    dueToday: r.due_today,
    ageHours: Number(r.age_hours),
    snoozed: r.snoozed,
  }));
}

export const morningDigestLoop: LoopSpec<MorningDigestOutputT> = {
  id: "digest",
  kind: "deliberate",
  trigger: { kind: "schedule", cron: MORNING_DIGEST_CRON },
  palette: [],
  budget: { inputTokens: 30_000, outputTokens: 1800, wallClockMs: 180_000, maxSteps: 1 },
  tier: "T1",
  outputSchema: MorningDigestOutput,

  assemble: (_ctx: TriggerContext) =>
    buildContext({
      selfModel: ["USER.md"],
      tasks: { state: "open", limit: 20 },
      calendar: { windowHours: 24 },
    }),

  async apply(result, ctx) {
    const pool = getAgentsPool();
    const candidates = await morningCandidates(ctx.now);
    const ranked = rankBriefItems(candidates, ctx.now);
    const shown = new Set(ranked.map((r) => r.ref.id));
    const bySection = new Map<string, BriefItem[]>();
    for (const c of candidates) {
      if (!shown.has(c.ref.id)) continue;
      const list = bySection.get(c.section) ?? [];
      list.push({ ref: c.ref, line: c.line, why: c.why });
      bySection.set(c.section, list);
    }
    let quiet = candidates.length - ranked.length;
    const sections: BriefSection[] = [];
    for (const [id, cap] of Object.entries(SECTION_CAPS)) {
      const all = bySection.get(id) ?? [];
      const kept = Number.isFinite(cap) ? all.slice(0, cap) : all;
      quiet += all.length - kept.length;
      sections.push({ id: id as BriefSection["id"], title: SECTION_TITLE[id] ?? id, items: kept });
    }
    sections.push({ id: "quiet", title: "Other", count: quiet });

    const briefing = {
      greeting: result.output.greeting,
      sections,
      one_liner: result.output.one_liner,
    };
    const itemIds = ranked.filter((r) => r.ref.kind === "item").map((r) => r.ref.id);
    await pool.query(
      `INSERT INTO digests (kind, for_date, body, item_ids, metrics)
       VALUES ('morning', (now() AT TIME ZONE 'Asia/Seoul')::date, $1, $2::uuid[], $3::jsonb)
       ON CONFLICT (kind, for_date)
         DO UPDATE SET body = EXCLUDED.body, item_ids = EXCLUDED.item_ids, metrics = EXCLUDED.metrics`,
      [
        JSON.stringify(briefing),
        itemIds,
        JSON.stringify({ candidates: candidates.length, shown: ranked.length, quiet }),
      ],
    );
  },
};
// Not registered in the registry — it shares LoopId 'digest' with nightlyDigestLoop, so both
// loops run directly through runLoopSpec (the hub registers the cron handler).
