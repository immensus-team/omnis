import type { Channel, Scope } from "@omnis/protocol";
// A4 §2.2 stage 1 — deterministic rules ($0, ~1ms). Order is priority.
// A6 §6: the 1–3B local classifier is not shipped until the spike, so T0 is only rules + kNN.
import type { Pool } from "pg";
import type { ItemRow } from "../types.js";

export interface ClassifyCtx {
  threadId: string;
  accountChannel: Channel;
  authorPersonId?: string;
  pool: Pool;
}

export interface RuleHit {
  rule_id: string;
  scope: Scope;
  confidence: number;
}

/** Logan's work domains. Making these editable in Settings is Phase B — for now they are constants. */
export const WORK_DOMAINS: readonly string[] = ["onwardlab.com", "theunderpin.ai", "davich.com"];

export const DETERMINISTIC_RULES = [
  "r_thread_sticky",
  "r_person_label",
  "r_channel_work",
  "r_domain",
  "r_calendar_peer",
] as const;

async function threadScope(ctx: ClassifyCtx): Promise<Scope | null> {
  const { rows } = await ctx.pool.query<{ scope: Scope }>(
    "SELECT scope FROM threads WHERE id = $1",
    [ctx.threadId],
  );
  const s = rows[0]?.scope;
  return s !== undefined && s !== "unknown" ? s : null;
}

async function personScope(ctx: ClassifyCtx): Promise<Scope | null> {
  if (ctx.authorPersonId === undefined) return null;
  const { rows } = await ctx.pool.query<{ name: string }>(
    `SELECT l.name FROM labels l
      WHERE l.kind = 'scope' AND l.person_id = $1 AND NOT l.archived LIMIT 1`,
    [ctx.authorPersonId],
  );
  const n = rows[0]?.name;
  return n === "work" || n === "personal" ? n : null;
}

async function senderOnWorkDomain(ctx: ClassifyCtx): Promise<boolean> {
  if (ctx.authorPersonId === undefined) return false;
  const { rows } = await ctx.pool.query<{ handle_norm: string }>(
    "SELECT handle_norm FROM identities WHERE person_id = $1",
    [ctx.authorPersonId],
  );
  return rows.some((r) => WORK_DOMAINS.some((d) => r.handle_norm.endsWith(`@${d}`)));
}

/** A4 §2.2 r_calendar_peer: if they were on the same calendar event within the last 7 days, treat it as work. */
async function sharedEventWithin(ctx: ClassifyCtx, days: number): Promise<boolean> {
  if (ctx.authorPersonId === undefined) return false;
  const { rows } = await ctx.pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM calendar_events ce
      WHERE ce.status <> 'cancelled'
        AND ce.start_at > now() - make_interval(days => $2)
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(ce.attendees) a
                     WHERE a->>'person_id' = $1)`,
    [ctx.authorPersonId, days],
  );
  return Number(rows[0]?.n ?? "0") > 0;
}

/** Stage-1 decision. If no rule matches, return null and hand off to stage 2 (kNN). */
export async function applyRules(item: ItemRow, ctx: ClassifyCtx): Promise<RuleHit | null> {
  const sticky = await threadScope(ctx);
  if (sticky !== null) return { rule_id: "r_thread_sticky", scope: sticky, confidence: 0.98 };

  const person = await personScope(ctx);
  if (person !== null) return { rule_id: "r_person_label", scope: person, confidence: 0.94 };

  if (ctx.accountChannel === "slack")
    return { rule_id: "r_channel_work", scope: "work", confidence: 0.95 };

  if (await senderOnWorkDomain(ctx))
    return { rule_id: "r_domain", scope: "work", confidence: 0.92 };

  if (await sharedEventWithin(ctx, 7))
    return { rule_id: "r_calendar_peer", scope: "work", confidence: 0.85 };

  void item; // Stage 1 does not look at the body — body decisions belong to stage 2 (kNN) and stage 3 (T1).
  return null;
}
