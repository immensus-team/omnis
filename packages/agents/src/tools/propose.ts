// A4 §1.5·A4-D3: a propose tool writes a row and emits nothing.
// All propose_delegation does is create one pending_approvals row (action='delegate');
// the actual execution happens in the kernel's approval handler on the runEgress path (A4 §5.4).
import { type ToolSet, tool } from "ai";
import { z } from "zod";
import { getAgentsPool } from "../pool.js";

export const ProposeLabelInput = z.object({
  item_id: z.string().uuid(),
  scope: z.enum(["work", "personal", "unknown"]),
  topic: z.string().max(40).optional(),
  priority: z.enum(["now", "today", "week", "fyi"]).optional(),
  person_label: z.string().max(40).optional(),
  confidence: z.number().min(0).max(1),
  matched_rule_ids: z.array(z.string()).default([]),
});
export const ProposeDraftInput = z.object({
  thread_id: z.string().uuid(),
  in_reply_to_item_id: z.string().uuid().optional(),
  body: z.string().max(4000),
  subject: z.string().max(200).optional(),
  language: z.enum(["ko", "en"]),
  register: z.enum(["formal_ko", "polite_ko", "casual_ko", "formal_en", "casual_en"]),
  rationale: z.string().max(400),
  evidence: z
    .array(
      z.object({
        kind: z.enum(["item", "memory", "calendar", "entity"]),
        id: z.string(),
        why: z.string().max(120),
      }),
    )
    .default([]),
  confidence: z.number().min(0).max(1),
});
export const ProposeTaskInput = z.object({
  title: z.string().max(120),
  detail: z.string().max(600).optional(),
  source_item_id: z.string().uuid(),
  due_at: z.string().datetime().optional(),
  due_basis: z.enum(["stated", "inferred", "none"]),
  owner: z.enum(["me", "agent"]).default("me"),
  kind: z.enum(["todo", "followup", "delegation"]).default("todo"),
  agent_hint: z.string().max(200).optional(),
  delegation_hint: z.record(z.unknown()).optional(),
  duplicate_of: z.string().uuid().optional(),
  confidence: z.number().min(0).max(1),
});
export const ProposeDelegationInput = z.object({
  task_id: z.string().uuid(),
  runtime: z.enum(["claude_code", "codex", "claude_ds", "omnis"]), // B-D7: hermes excluded
  host: z.enum(["mini", "macbook"]),
  brief: z.string().max(2000),
  acceptance: z.array(z.string()).min(1),
  verify_cmd: z.string().max(300).optional(),
  workdir: z.string().optional(),
  est_minutes: z.number().int().optional(),
  rule_id: z.string().optional(),
  confidence: z.number().min(0).max(1),
});
export const ProposeRouteInput = z.object({
  note_id: z.string().uuid(),
  candidates: z
    .array(
      z.object({
        kind: z.enum(["thread", "person"]),
        id: z.string().uuid(),
        confidence: z.number().min(0).max(1),
        why: z.string().max(160),
        suggested_use: z.enum(["followup", "question", "share", "context_only"]).optional(),
      }),
    )
    .max(3),
});
export const ProposeSelfModelPatchInput = z.object({
  file: z.enum(["USER.md", "VOICE.md", "PROJECTS.md"]),
  diff: z.string().max(4000),
  rationale: z.string().max(400),
  evidence: z.array(z.string()).min(2),
});

export type ProposeLabelInput = z.infer<typeof ProposeLabelInput>;
export type ProposeDraftInput = z.infer<typeof ProposeDraftInput>;
export type ProposeTaskInput = z.infer<typeof ProposeTaskInput>;
export type ProposeDelegationInput = z.infer<typeof ProposeDelegationInput>;
export type ProposeRouteInput = z.infer<typeof ProposeRouteInput>;
export type ProposeSelfModelPatchInput = z.infer<typeof ProposeSelfModelPatchInput>;

const OMNIS_RUNTIME = "SELECT id FROM agent_runtimes WHERE runtime = 'omnis' LIMIT 1";

export const PROPOSE_TOOLS: ToolSet = {
  propose_label: tool({
    description: "Propose a label for an item and store it. Does not send anything.",
    inputSchema: ProposeLabelInput,
    execute: async (i) => {
      await getAgentsPool().query(
        `UPDATE items SET scope = $2,
            meta = meta || jsonb_build_object('label', jsonb_build_object(
              'topic', $3::text, 'priority', $4::text, 'person_label', $5::text,
              'confidence', $6::real, 'matched_rule_ids', $7::jsonb))
          WHERE id = $1`,
        [
          i.item_id,
          i.scope,
          i.topic ?? null,
          i.priority ?? null,
          i.person_label ?? null,
          i.confidence,
          JSON.stringify(i.matched_rule_ids),
        ],
      );
      return { label_ids: [i.item_id], stored: true as const };
    },
  }),

  propose_draft: tool({
    description: "Store a reply draft in items (status='draft'). Does not send anything.",
    inputSchema: ProposeDraftInput,
    execute: async (i) => {
      const { rows } = await getAgentsPool().query<{ id: string }>(
        `INSERT INTO items (thread_id, account_id, kind, status, subject, body, sent_at,
                            author_is_me, in_reply_to, meta)
         SELECT t.id, t.account_id,
                CASE WHEN t.kind = 'email' THEN 'email' ELSE 'message' END,
                'draft', $2, $3, now(), true, $4,
                jsonb_build_object('draft', jsonb_build_object(
                  'rationale', $5::text, 'register', $6::text, 'language', $7::text,
                  'confidence', $8::real, 'evidence', $9::jsonb))
           FROM threads t WHERE t.id = $1
         RETURNING id`,
        [
          i.thread_id,
          i.subject ?? null,
          i.body,
          i.in_reply_to_item_id ?? null,
          i.rationale,
          i.register,
          i.language,
          i.confidence,
          JSON.stringify(i.evidence),
        ],
      );
      const id = rows[0]?.id;
      if (id === undefined) throw new Error(`thread not found: ${i.thread_id}`);
      return { item_id: id, status: "draft" as const };
    },
  }),

  propose_task: tool({
    description:
      "Store a todo in tasks. When duplicate_of is set, only the source is added to the existing task.",
    inputSchema: ProposeTaskInput,
    execute: async (i) => {
      const pool = getAgentsPool();
      if (i.duplicate_of !== undefined) {
        await pool.query(
          "UPDATE tasks SET source_item_id = COALESCE(source_item_id, $2) WHERE id = $1",
          [i.duplicate_of, i.source_item_id],
        );
        return { task_id: i.duplicate_of, state: "open" as const };
      }
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO tasks (title, detail, kind, owner_kind, source_item_id, due_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'agent') RETURNING id`,
        [i.title, i.detail ?? null, i.kind, i.owner, i.source_item_id, i.due_at ?? null],
      );
      const id = rows[0]?.id;
      if (id === undefined) throw new Error("tasks insert returned no id");
      await pool.query(
        `UPDATE tasks SET detail = COALESCE(detail, '') ||
           CASE WHEN $2::text = '' THEN '' ELSE E'\\n\\n' || $2 END WHERE id = $1`,
        [id, i.agent_hint ?? ""],
      );
      await pool.query(
        "UPDATE items SET meta = meta || jsonb_build_object('task_due_basis', $2::text) WHERE id = $1",
        [i.source_item_id, i.due_basis],
      );
      return { task_id: id, state: "open" as const };
    },
  }),

  propose_delegation: tool({
    description: "Create a delegation approval card. Nothing runs without approval.",
    inputSchema: ProposeDelegationInput,
    execute: async (i) => {
      const pool = getAgentsPool();
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO pending_approvals (action, args, description, config, risk, task_id,
                                        thread_id, requested_by)
         SELECT 'delegate', $1::jsonb, $2,
                '{"allow_accept":true,"allow_edit":true,"allow_respond":false,"allow_ignore":true}'::jsonb,
                $3, $4,
                (SELECT it.thread_id FROM tasks tk
                   JOIN items it ON it.id = tk.source_item_id
                  WHERE tk.id = $4),
                (${OMNIS_RUNTIME})
         RETURNING id`,
        [
          JSON.stringify(i),
          `Handing this task to ${i.runtime} on ${i.host}. Estimated ${i.est_minutes ?? "?"} min.`,
          (i.est_minutes ?? 0) > 30 ? "high" : "normal",
          i.task_id,
        ],
      );
      const id = rows[0]?.id;
      if (id === undefined) throw new Error("pending_approvals insert returned no id");
      await pool.query("UPDATE tasks SET kind = 'delegation' WHERE id = $1", [i.task_id]);
      return { approval_id: id, state: "pending" as const };
    },
  }),

  propose_route: tool({
    description:
      "Propose up to 3 candidates to attach the note to. No automatic attachment (A4-D10).",
    inputSchema: ProposeRouteInput,
    execute: async (i) => {
      await getAgentsPool().query(
        `UPDATE notes SET route_state = 'proposed',
            rationale = $2,
            routed_to_thread_id = NULL, routed_to_person_id = NULL
          WHERE id = $1`,
        [i.note_id, JSON.stringify(i.candidates)],
      );
      return { note_id: i.note_id, stored: true as const };
    },
  }),

  propose_self_model_patch: tool({
    description:
      "Turn a self-model file patch into an approval card. The kernel applies it after approval.",
    inputSchema: ProposeSelfModelPatchInput,
    execute: async (i) => {
      const { rows } = await getAgentsPool().query<{ id: string }>(
        `INSERT INTO pending_approvals (action, args, description, risk, requested_by)
         VALUES ('self_model_edit', $1::jsonb, $2, 'normal', (${OMNIS_RUNTIME}))
         RETURNING id`,
        [JSON.stringify(i), `Proposed edit to ${i.file} — ${i.rationale}`],
      );
      const id = rows[0]?.id;
      if (id === undefined) throw new Error("pending_approvals insert returned no id");
      return { approval_id: id };
    },
  }),
};
