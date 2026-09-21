// A4 §3 L2 reply-draft loop (Deliberate).
import type { Channel, Sensitivity } from "@omnis/protocol";
import { z } from "zod";
import { buildContext } from "../context/assemble.js";
import { QUESTION, draftWorthinessRequest } from "../decision/decisions.js";
import { decideOrNull } from "../decision/router.js";
import { itemState, threadTail } from "../decision/state.js";
import { probabilityOf } from "../decision/types.js";
import { CHANNEL_DRAFT_SHAPE, pickRegister } from "../draft/register.js";
import { selfCheck } from "../draft/selfcheck.js";
import { registerLoop } from "../loop/registry.js";
import type { LoopSpec, TriggerContext } from "../loop/spec.js";
import { getAgentsPool } from "../pool.js";
import { PROPOSE_TOOLS } from "../tools/propose.js";

/** A4 §3.1 SLA: a status='draft' row must exist within 60 seconds. We write a placeholder at 55s first. */
export const DRAFT_SLA_MS = 60_000;
export const DRAFT_PLACEHOLDER_MS = 55_000;

/**
 * Below this P(worth drafting) the decision tier vetoes the loop outright. The trigger's
 * `needs_reply_score >= 0.5` already fired, so the bar is deliberately low: this is the case where
 * replying is clearly pointless, not the case where it is merely debatable.
 */
export const DRAFT_WORTHINESS_VETO_BELOW = 0.15;

/** LoopSpec.outputSchema is `z.ZodType<TOut>` (input = output), so .default() is not allowed —
 *  the model always fills array and boolean fields (omitting one routes into runLoopSpec's retry/escalation path). */
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

/** The six conditions of A4 §3.5. If any one is true, go to T2 (Claude Sonnet 5). */
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
  // First contact + email/LinkedIn only. A first contact over a messenger is fine at T1 (A4 §3.5).
  if (
    i.firstContact &&
    (i.channel === "gmail" || i.channel === "outlook" || i.channel === "linkedin")
  ) {
    return true;
  }
  return false;
}

/** A4 §3.1: "preparing" beats the screen sitting empty with "no draft". */
export async function writePlaceholderDraft(threadId: string): Promise<string> {
  const { rows } = await getAgentsPool().query<{ id: string }>(
    `INSERT INTO items (thread_id, account_id, kind, status, body, sent_at, author_is_me, meta)
     SELECT t.id, t.account_id,
            CASE WHEN t.kind = 'email' THEN 'email' ELSE 'message' END,
            'draft', 'Preparing draft…', now(), true, '{"pending": true}'::jsonb
       FROM threads t WHERE t.id = $1
     RETURNING id`,
    [threadId],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`thread not found: ${threadId}`);
  return id;
}

/** Replaces the placeholder in the same row and clears meta.pending (A4 §3.1). */
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

  // The 7 slots of A4 §3.2. Slot names and numbers are exactly as in that table.
  // Decision #3, veto-only (docs/decisions/2026-09-21-jev-decision-tier.md). A "yes" is not an
  // approval: this returns null and the T1 model writes the draft exactly as before. Only a
  // confident "no" acts, and it acts by ending the run before any placeholder row is written.
  async decide(ctx: TriggerContext) {
    const itemId = ctx.item_id;
    const threadId = ctx.thread_id;
    if (itemId === undefined || threadId === undefined) return null;
    // Lazy: reading the item and the thread costs two queries, and with the flag off neither runs.
    const jev = await decideOrNull(async () => {
      const item = await itemState(itemId);
      if (item === null) return null;
      return draftWorthinessRequest({
        subject: item.subject,
        body: item.body,
        threadTail: await threadTail(threadId),
      });
    });
    const worth = jev === null ? null : probabilityOf(jev, QUESTION.worthDrafting);
    if (worth === null || worth >= DRAFT_WORTHINESS_VETO_BELOW) return null;
    return { skip: `decision model: no reply is needed (P(worth drafting) = ${worth.toFixed(2)})` };
  },

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
    // A4 §3.3 step 4: if any check failed, still store the draft but mark it so the UI can see it —
    // regeneration is a human decision, not a runLoopSpec retry (especially for #6, a safety failure).
    await getAgentsPool().query(
      "UPDATE items SET meta = meta || jsonb_build_object('draft_self_check', $2::jsonb) WHERE id = $1",
      [itemId, JSON.stringify({ ...check, shape: CHANNEL_DRAFT_SHAPE[channel].notes })],
    );
  },
};

registerLoop(draftLoop);
