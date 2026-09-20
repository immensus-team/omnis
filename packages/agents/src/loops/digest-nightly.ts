// A4 §6.4. §9 (L8) owns the verdict; this file only defines how that result is exposed to a human.
import { createHash } from "node:crypto";
import type { Channel } from "@omnis/protocol";
import type { Pool } from "pg";
import { z } from "zod";
import { buildContext } from "../context/assemble.js";
import type { BriefItem } from "../digest/rank.js";
import type { LoopSpec, TriggerContext } from "../loop/spec.js";
import { getAgentsPool } from "../pool.js";

export const NIGHTLY_DIGEST_CRON = "0 23 * * *";

export interface DigestGroup {
  reason: string;
  count: number;
  samples: BriefItem[];
  undo_token: string;
}

export interface NightlyDigest {
  headline: string;
  auto_archived: DigestGroup[];
  handled: { count: number; by_channel: Partial<Record<Channel, number>> };
  still_open: BriefItem[];
  cost: { month_to_date_usd: number; cap_usd: number; tier_state: string };
  agents: { runs: number; failed: number; delegated: number };
}

/** The 7-day window is decided by meta.archived_by.at, so the token is not stored — it is recomputable. */
export function undoTokenFor(digestId: string, reason: string): string {
  return createHash("sha256").update(`${digestId}::${reason}`).digest("hex").slice(0, 16);
}

/** headline and one_liner are the only two sentences the model writes (A4 §6.4). */
export const NightlyDigestOutput = z.object({
  headline: z.string().max(120),
  one_liner: z.string().max(160),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(200),
  // ponytail: no .default() here, for the same reason as digest-morning.ts — once z.input and
  // z.output diverge it will not assign to LoopSpec's ZodType<TOut>.
  injection_flags: z.array(z.string()),
});
export type NightlyDigestOutputT = z.infer<typeof NightlyDigestOutput>;

const ZERO_COST: NightlyDigest["cost"] = {
  month_to_date_usd: 0,
  cap_usd: 60,
  tier_state: "normal",
};

/** A4 §9.4: auto-archive is exposed in full — count is the total, only samples is cut to 3. */
export async function nightlyGroups(
  pool: Pool,
  since: Date,
  digestId: string,
): Promise<DigestGroup[]> {
  const { rows } = await pool.query<{
    reason: string;
    count: string;
    samples: { id: string; line: string }[] | null;
  }>(
    `SELECT COALESCE(meta->'archived_by'->>'reason','Other') AS reason,
            count(*)::text AS count,
            jsonb_agg(jsonb_build_object('id', id, 'line', left(COALESCE(subject, body), 90))
                      ORDER BY sent_at DESC) AS samples
       FROM items
      WHERE status = 'archived' AND (meta->'archived_by'->>'at')::timestamptz >= $1
      GROUP BY 1 ORDER BY count(*) DESC`,
    [since],
  );
  return rows.map((r) => ({
    reason: r.reason,
    count: Number(r.count),
    samples: (r.samples ?? []).slice(0, 3).map((s) => ({
      ref: { kind: "item" as const, id: s.id },
      line: s.line,
      why: r.reason,
    })),
    undo_token: undoTokenFor(digestId, r.reason),
  }));
}

async function handledToday(pool: Pool, now: Date): Promise<NightlyDigest["handled"]> {
  const { rows } = await pool.query<{ channel: Channel; n: string }>(
    `SELECT a.channel, count(*)::text AS n
       FROM items i JOIN accounts a ON a.id = i.account_id
      WHERE i.status IN ('sent','read') AND i.sent_at >= date_trunc('day', $1::timestamptz)
      GROUP BY a.channel`,
    [now],
  );
  const by: Partial<Record<Channel, number>> = {};
  let total = 0;
  for (const r of rows) {
    by[r.channel] = Number(r.n);
    total += Number(r.n);
  }
  return { count: total, by_channel: by };
}

async function agentStats(pool: Pool, now: Date): Promise<NightlyDigest["agents"]> {
  const { rows } = await pool.query<{ runs: string; failed: string; delegated: string }>(
    `SELECT count(*)::text AS runs,
            count(*) FILTER (WHERE outcome = 'failed')::text AS failed,
            count(*) FILTER (WHERE loop = 'delegate')::text AS delegated
       FROM agent_runs WHERE created_at >= date_trunc('day', $1::timestamptz)`,
    [now],
  );
  return {
    runs: Number(rows[0]?.runs ?? "0"),
    failed: Number(rows[0]?.failed ?? "0"),
    delegated: Number(rows[0]?.delegated ?? "0"),
  };
}

export const nightlyDigestLoop: LoopSpec<NightlyDigestOutputT> = {
  id: "digest",
  kind: "deliberate",
  trigger: { kind: "schedule", cron: NIGHTLY_DIGEST_CRON },
  palette: [],
  budget: { inputTokens: 40_000, outputTokens: 2200, wallClockMs: 300_000, maxSteps: 1 },
  tier: "T1",
  outputSchema: NightlyDigestOutput,

  assemble: (_ctx: TriggerContext) =>
    buildContext({ selfModel: ["USER.md"], tasks: { state: "open", limit: 20 } }),

  async apply(result, ctx) {
    const pool = getAgentsPool();
    const dayStart = new Date(ctx.now);
    dayStart.setHours(0, 0, 0, 0);
    const digestId = `${ctx.now.toISOString().slice(0, 10)}:nightly`;
    const cost = (ctx.payload.cost as NightlyDigest["cost"] | undefined) ?? ZERO_COST;

    const digest: NightlyDigest = {
      headline: result.output.headline,
      auto_archived: await nightlyGroups(pool, dayStart, digestId),
      handled: await handledToday(pool, ctx.now),
      // Open item 6: A4 §6.4 has no selection rule for the "tomorrow morning preview" — leave it empty.
      still_open: [],
      cost,
      agents: await agentStats(pool, ctx.now),
    };
    const itemIds = digest.auto_archived.flatMap((g) => g.samples.map((s) => s.ref.id));
    await pool.query(
      `INSERT INTO digests (kind, for_date, body, item_ids, metrics)
       VALUES ('nightly', (now() AT TIME ZONE 'Asia/Seoul')::date, $1, $2::uuid[], $3::jsonb)
       ON CONFLICT (kind, for_date)
         DO UPDATE SET body = EXCLUDED.body, item_ids = EXCLUDED.item_ids, metrics = EXCLUDED.metrics`,
      [
        JSON.stringify(digest),
        itemIds,
        JSON.stringify({
          archived: digest.auto_archived.reduce((n, g) => n + g.count, 0),
          cost_mtd_usd: cost.month_to_date_usd,
        }),
      ],
    );
  },
};
// Not registered in the registry for the same reason as morningDigestLoop (shared LoopId 'digest').
