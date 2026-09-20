// A4 §9. 이 루프는 egress가 아니다 — pending_approvals를 만들지 않고, 7일 undo·전량 노출·
// 하드 삭제 금지 셋으로 보장한다.
import type { Pool } from "pg";
import { z } from "zod";
import { buildContext } from "../context/assemble.js";
import { registerLoop } from "../loop/registry.js";
import type { LoopSpec, TriggerContext } from "../loop/spec.js";
import { getAgentsPool } from "../pool.js";

export const T1_ARCHIVE_CONFIDENCE_MIN = 0.85;

export const AUTO_ARCHIVE_RULES = {
  senderNonHuman: "ar_sender_nonhuman",
  noCta: "ar_no_cta",
  notVipNormal: "ar_not_vip_normal",
  neverReplied: "ar_never_replied",
  noNewQuestion: "ar_no_new_question",
} as const;

export const AutoArchiveOutput = z.object({
  archive: z.boolean(),
  reason: z.string().max(40),
  rule_ids: z.array(z.string()),
  tier: z.enum(["T0", "T1"]),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(200),
  // ponytail: .default([])를 쓰면 z.input과 z.output이 갈려 LoopSpec의 ZodType<TOut>에 대입되지 않는다.
  // T1 프롬프트가 항상 채우게 하는 쪽이 싸다.
  injection_flags: z.array(z.string()),
});
export type AutoArchiveOutputT = z.infer<typeof AutoArchiveOutput>;

const NONHUMAN_LOCAL = /^(no-?reply|noreply|donotreply|notifications?|alerts?|mailer|bounce)/i;

export function nonHumanSender(i: { handle: string; meta: Record<string, unknown> }): boolean {
  const local = i.handle.split("@")[0] ?? "";
  if (i.handle !== "" && NONHUMAN_LOCAL.test(local)) return true;
  const nested = i.meta.headers;
  const headers = (typeof nested === "object" && nested !== null ? nested : i.meta) as Record<
    string,
    unknown
  >;
  if (typeof headers["List-Unsubscribe"] === "string") return true;
  if (String(headers.Precedence ?? "").toLowerCase() === "bulk") return true;
  if (i.meta.bot === true) return true; // Slack bot 발신
  return false;
}

export interface HardGateResult {
  blocked: boolean;
  reason: string | null;
}

/** A4 §9.2: 규칙보다 먼저 평가하는 하드 게이트 5종. 하나라도 걸리면 절대 보관하지 않는다. */
export async function hardGate(pool: Pool, itemId: string): Promise<HardGateResult> {
  const { rows } = await pool.query<{
    sensitivity: string;
    kind: string;
    vip: boolean | null;
    pending: string;
    flags: number;
    excluded: string | null;
  }>(
    `SELECT i.sensitivity, i.kind,
            p.vip,
            (SELECT count(*)::text FROM pending_approvals a
              WHERE a.thread_id = i.thread_id AND a.state = 'pending') AS pending,
            COALESCE(jsonb_array_length(i.meta->'injection_flags'), 0) AS flags,
            t.meta->>'no_auto_archive_until' AS excluded
       FROM items i
       JOIN threads t ON t.id = i.thread_id
       LEFT JOIN persons p ON p.id = i.author_person_id
      WHERE i.id = $1`,
    [itemId],
  );
  const r = rows[0];
  if (r === undefined) return { blocked: true, reason: "item not found" };
  if (r.sensitivity !== "normal") return { blocked: true, reason: "sensitivity" };
  if (r.vip === true) return { blocked: true, reason: "vip" };
  if (Number(r.pending) > 0) return { blocked: true, reason: "pending_approval" };
  if (r.flags > 0) return { blocked: true, reason: "injection_flags" };
  if (!["message", "email"].includes(r.kind)) return { blocked: true, reason: "kind" };
  if (r.excluded !== null && new Date(r.excluded) > new Date()) {
    return { blocked: true, reason: "rearchive_exclusion" };
  }
  return { blocked: false, reason: null };
}

async function t0Verdict(itemId: string): Promise<AutoArchiveOutputT | null> {
  const pool = getAgentsPool();
  const { rows } = await pool.query<{
    body: string;
    handle: string;
    meta: Record<string, unknown>;
    i_replied: boolean;
  }>(
    `SELECT i.body, COALESCE(id2.handle, '') AS handle, i.meta,
            EXISTS (SELECT 1 FROM items x
                     WHERE x.thread_id = i.thread_id AND x.author_is_me AND x.status = 'sent') AS i_replied
       FROM items i
       LEFT JOIN identities id2 ON id2.person_id = i.author_person_id
      WHERE i.id = $1 LIMIT 1`,
    [itemId],
  );
  const r = rows[0];
  if (r === undefined) return null;

  const rules: string[] = [];
  // ① 발신자가 사람이 아님 (T0, $0)
  if (!nonHumanSender({ handle: r.handle, meta: r.meta })) return null;
  rules.push(AUTO_ARCHIVE_RULES.senderNonHuman);
  // ③ VIP 아님 + sensitivity normal — hardGate가 이미 보장했다
  rules.push(AUTO_ARCHIVE_RULES.notVipNormal);
  // ④ 내가 답한 적 없음. 답한 적이 있으면 ④-b(T1)로 넘어간다.
  if (r.i_replied) return null;
  rules.push(AUTO_ARCHIVE_RULES.neverReplied);
  // ② T0 경로: 물음표 부재. 물음표가 있으면 T1을 태운다.
  if (r.body.includes("?") || r.body.includes("？")) return null;
  rules.push(AUTO_ARCHIVE_RULES.noCta);

  const headers = (r.meta as { headers?: Record<string, unknown> }).headers;
  return {
    archive: true,
    reason: typeof headers?.["List-Unsubscribe"] === "string" ? "뉴스레터" : "알림 메일",
    rule_ids: rules,
    tier: "T0",
    confidence: 0.95,
    rationale: "발신자가 사람이 아니고 나에게 향한 질문이 없어 보관했습니다.",
    injection_flags: [],
  };
}

async function applyArchive(itemId: string, out: AutoArchiveOutputT, runId: string): Promise<void> {
  if (!out.archive) return;
  // "애매하면 보관하지 않는다"(A4 §9.2)가 이 임계의 의미다.
  if (out.tier === "T1" && out.confidence < T1_ARCHIVE_CONFIDENCE_MIN) return;
  // ponytail: @omnis/agents는 @omnis/kernel을 의존할 수 없어 archiveItem을 직접 못 부른다.
  // 같은 UPDATE 한 문장을 여기 둔다(계약 §12의 의도된 중복).
  await getAgentsPool().query(
    `UPDATE items SET status = 'archived',
        meta = meta || jsonb_build_object('archived_by', jsonb_build_object(
          'rule_ids', $2::jsonb, 'reason', $3::text, 'tier', $4::text,
          'confidence', $5::real, 'run_id', $6::text, 'at', now()::text))
      WHERE id = $1 AND status = 'received'`,
    [itemId, JSON.stringify(out.rule_ids), out.reason, out.tier, out.confidence, runId],
  );
}

export const autoArchiveLoop: LoopSpec<AutoArchiveOutputT> = {
  id: "auto_archive",
  kind: "reactive",
  trigger: {
    kind: "event",
    on: "item.labeled",
    where: "status = 'received' AND author_is_me = false AND kind IN ('message','email')",
    debounceMs: 20_000,
  },
  palette: [],
  budget: { inputTokens: 1500, outputTokens: 120, wallClockMs: 8_000, maxSteps: 1 },
  tier: "T0",
  outputSchema: AutoArchiveOutput,

  async decide(ctx: TriggerContext) {
    const itemId = ctx.item_id;
    if (itemId === undefined) return null;
    const gate = await hardGate(getAgentsPool(), itemId);
    if (gate.blocked) {
      const reason = gate.reason ?? "gate";
      return {
        loop: "auto_archive" as const,
        output: {
          archive: false,
          reason,
          rule_ids: [],
          tier: "T0" as const,
          confidence: 1,
          rationale: `하드 게이트(${reason})에 걸려 보관하지 않았습니다.`,
          injection_flags: [],
        },
        confidence: 1,
        rationale: "hard gate",
        escalate: false,
        injection_flags: [],
        unresolved: [],
      };
    }
    const t0 = await t0Verdict(itemId);
    if (t0 === null) return null; // ② 또는 ④-b가 애매하다 → T1 경로
    return {
      loop: "auto_archive" as const,
      output: t0,
      confidence: t0.confidence,
      rationale: t0.rationale,
      escalate: false,
      injection_flags: [],
      unresolved: [],
    };
  },

  assemble: (ctx: TriggerContext) =>
    buildContext({
      thread: { threadId: ctx.thread_id ?? "", lastN: 4, includeToolCalls: false },
    }),

  async apply(result, ctx) {
    if (ctx.item_id === undefined) return;
    await applyArchive(ctx.item_id, result.output, result.run_id);
  },
};

registerLoop(autoArchiveLoop);

/** A4 §9.1 두 번째 경로: 22:00 스윕. 23:00 다이제스트보다 먼저 끝난다. */
export async function sweepAutoArchive(
  runOne: (itemId: string, threadId: string) => Promise<void>,
): Promise<number> {
  const { rows } = await getAgentsPool().query<{ id: string; thread_id: string }>(
    `SELECT id, thread_id FROM items
      WHERE status = 'received' AND author_is_me = false AND kind IN ('message','email')
        AND sent_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul'
      ORDER BY sent_at LIMIT 500`,
  );
  for (const r of rows) await runOne(r.id, r.thread_id);
  return rows.length;
}
