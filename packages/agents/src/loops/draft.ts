// A4 §3 L2 답장 초안 루프(Deliberate).
import type { Channel, Sensitivity } from "@omnis/protocol";
import { z } from "zod";
import { buildContext } from "../context/assemble.js";
import { CHANNEL_DRAFT_SHAPE, pickRegister } from "../draft/register.js";
import { selfCheck } from "../draft/selfcheck.js";
import { registerLoop } from "../loop/registry.js";
import type { LoopSpec, TriggerContext } from "../loop/spec.js";
import { getAgentsPool } from "../pool.js";
import { PROPOSE_TOOLS } from "../tools/propose.js";

/** A4 §3.1 SLA: 60초 안에 status='draft' row가 있어야 한다. 55초에 placeholder를 먼저 쓴다. */
export const DRAFT_SLA_MS = 60_000;
export const DRAFT_PLACEHOLDER_MS = 55_000;

/** LoopSpec.outputSchema는 `z.ZodType<TOut>`(입력=출력)이라 .default()를 쓸 수 없다 —
 *  배열·불리언 필드는 모델이 항상 채운다(빠지면 runLoopSpec의 재시도/에스컬레이션 경로로 간다). */
export const DraftOutput = z.object({
  body: z.string().max(4000),
  subject: z.string().max(200).optional(),
  language: z.enum(["ko", "en"]),
  rationale: z.string().max(400),
  evidence: z.array(
    z.object({
      kind: z.enum(["item", "memory", "calendar", "entity"]),
      id: z.string(),
      why: z.string().max(120),
    }),
  ),
  confidence: z.number().min(0).max(1),
  escalate: z.boolean(),
  unresolved: z.array(z.string()),
  injection_flags: z.array(z.string()),
});
export type DraftOutputT = z.infer<typeof DraftOutput>;

/** A4 §3.5의 6조건. 하나라도 참이면 T2(Claude Sonnet 5). */
export function shouldEscalate(i: {
  vip: boolean;
  sensitivity: Sensitivity;
  t1Confidence: number;
  t1Escalate: boolean;
  unresolvedCount: number;
  firstContact: boolean;
  channel: Channel;
}): boolean {
  if (i.vip) return true;
  if (i.sensitivity !== "normal") return true;
  if (i.t1Confidence < 0.65) return true;
  if (i.t1Escalate) return true;
  if (i.unresolvedCount >= 2) return true;
  // 초면 + 이메일/LinkedIn만. 메신저 초면은 T1으로 충분하다(A4 §3.5).
  if (
    i.firstContact &&
    (i.channel === "gmail" || i.channel === "outlook" || i.channel === "linkedin")
  ) {
    return true;
  }
  return false;
}

/** A4 §3.1: 화면이 "초안 없음"으로 비는 것보다 "준비 중"이 낫다. */
export async function writePlaceholderDraft(threadId: string): Promise<string> {
  const { rows } = await getAgentsPool().query<{ id: string }>(
    `INSERT INTO items (thread_id, account_id, kind, status, body, sent_at, author_is_me, meta)
     SELECT t.id, t.account_id,
            CASE WHEN t.kind = 'email' THEN 'email' ELSE 'message' END,
            'draft', '초안 준비 중…', now(), true, '{"pending": true}'::jsonb
       FROM threads t WHERE t.id = $1
     RETURNING id`,
    [threadId],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`thread not found: ${threadId}`);
  return id;
}

/** placeholder를 같은 row에서 교체하고 meta.pending을 지운다(A4 §3.1). */
async function replacePlaceholder(
  itemId: string,
  out: DraftOutputT,
  register: string,
): Promise<void> {
  await getAgentsPool().query(
    `UPDATE items
        SET body = $2, subject = COALESCE($3, subject),
            meta = (meta - 'pending') || jsonb_build_object('draft', jsonb_build_object(
              'rationale', $4::text, 'register', $5::text, 'language', $6::text,
              'confidence', $7::real, 'evidence', $8::jsonb))
      WHERE id = $1`,
    [
      itemId,
      out.body,
      out.subject ?? null,
      out.rationale,
      register,
      out.language,
      out.confidence,
      JSON.stringify(out.evidence),
    ],
  );
}

interface DraftTriggerPayload {
  query?: unknown;
  register?: string;
  external_urls?: string[];
  question_count?: number;
  channel?: Channel;
  placeholder_item_id?: string;
}

export const draftLoop: LoopSpec<DraftOutputT> = {
  id: "draft",
  kind: "deliberate",
  trigger: {
    kind: "event",
    on: "item.labeled",
    where: "author <> 'me' AND kind IN ('message','email') AND needs_reply_score >= 0.5",
    debounceMs: 20_000,
  },
  palette: [
    "read_thread",
    "search_memory",
    "read_person",
    "read_entity",
    "read_calendar",
    "read_tasks",
    "propose_draft",
  ],
  budget: { inputTokens: 6500, outputTokens: 800, wallClockMs: 45_000, maxSteps: 8 },
  tier: "T1",
  outputSchema: DraftOutput,

  // A4 §3.2의 7슬롯. 슬롯 이름과 수치는 그 표 그대로다.
  assemble: (ctx: TriggerContext) =>
    buildContext({
      selfModel: ["USER.md", "VOICE.md"],
      thread: { threadId: ctx.thread_id ?? "", lastN: 12, includeToolCalls: false },
      memories: {
        query: String((ctx.payload as DraftTriggerPayload).query ?? ""),
        k: 6,
        minScore: 0.5,
      },
      entities: { personIds: ctx.person_id === undefined ? [] : [ctx.person_id], asOf: "now" },
      calendar: { windowHours: 72 },
      tasks: { state: "open", limit: 10 },
    }),

  async apply(result, ctx) {
    const p = ctx.payload as DraftTriggerPayload;
    const channel: Channel = p.channel ?? "gmail";
    const register =
      p.register ?? pickRegister({ language: result.output.language, labels: [], sameOrg: false });

    let itemId = p.placeholder_item_id;
    if (itemId === undefined) {
      const out = (await PROPOSE_TOOLS.propose_draft?.execute?.(
        {
          thread_id: ctx.thread_id ?? "",
          body: result.output.body,
          ...(result.output.subject !== undefined ? { subject: result.output.subject } : {}),
          language: result.output.language,
          register,
          rationale: result.output.rationale,
          evidence: result.output.evidence,
          confidence: result.output.confidence,
          ...(ctx.item_id !== undefined ? { in_reply_to_item_id: ctx.item_id } : {}),
        },
        { toolCallId: result.run_id, messages: [], context: undefined },
      )) as { item_id: string } | undefined;
      itemId = out?.item_id;
    } else {
      await replacePlaceholder(itemId, result.output, register);
    }
    if (itemId === undefined) throw new Error("propose_draft stored no item");

    const check = selfCheck(result.output.body, {
      questionCount: p.question_count ?? 0,
      externalUrls: p.external_urls ?? [],
      calendarConflicts: [],
      voiceSampleAvgLen: 0,
      entityNames: [],
      channel,
    });
    // A4 §3.3 step 4: 실패 항목이 있으면 초안을 저장하되 UI가 볼 수 있게 표시한다 —
    // 재생성은 runLoopSpec의 재시도가 아니라 사람의 판단이다(6번은 안전 실패라 특히 그렇다).
    await getAgentsPool().query(
      "UPDATE items SET meta = meta || jsonb_build_object('draft_self_check', $2::jsonb) WHERE id = $1",
      [itemId, JSON.stringify({ ...check, shape: CHANNEL_DRAFT_SHAPE[channel].notes })],
    );
  },
};

registerLoop(draftLoop);
