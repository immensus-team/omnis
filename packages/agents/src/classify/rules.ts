import type { Channel, Scope } from "@omnis/protocol";
// A4 §2.2 1단 — 결정론적 규칙 ($0, ~1ms). 순서가 우선순위다.
// A6 §6: 1~3B 로컬 분류기는 스파이크 전까지 미탑재이므로 T0는 규칙 + kNN 둘뿐이다.
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

/** Logan의 업무 도메인. Settings에서 편집 가능해지는 건 Phase B — 지금은 상수다. */
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

/** A4 §2.2 r_calendar_peer: 최근 7일 안에 같은 캘린더 이벤트에 함께 있었으면 업무로 본다. */
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

/** 1단 판정. 아무 규칙도 안 맞으면 null을 돌려 2단(kNN)으로 넘긴다. */
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

  void item; // 1단은 본문을 보지 않는다 — 본문 판정은 2단(kNN)과 3단(T1)의 몫이다.
  return null;
}
