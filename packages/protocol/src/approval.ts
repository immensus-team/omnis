import { z } from "zod";

/** 계약 §3.4 / A3 §4 pending_approvals. HumanInterrupt/HumanResponse를 그대로 이식(A3-D11). */
export const ApprovalAction = z.enum([
  "send",
  "delete",
  "calendar_write",
  "delegate",
  "self_model_edit",
  "memory_write",
]);
export const ApprovalState = z.enum([
  "pending",
  "decided",
  "executing",
  "executed",
  "failed",
  "expired",
]);
export const ApprovalDecision = z.enum(["accept", "edit", "respond", "ignore"]);
export const ApprovalRisk = z.enum(["normal", "high"]);

export type ApprovalAction = z.infer<typeof ApprovalAction>;
export type ApprovalState = z.infer<typeof ApprovalState>;
export type ApprovalDecision = z.infer<typeof ApprovalDecision>;
export type ApprovalRisk = z.infer<typeof ApprovalRisk>;

export const HumanInterrupt = z.object({
  action: ApprovalAction,
  args: z.record(z.unknown()),
  description: z.string(),
  config: z
    .object({
      allow_accept: z.boolean(),
      allow_edit: z.boolean(),
      allow_respond: z.boolean(),
      allow_ignore: z.boolean(),
    })
    .default({
      allow_accept: true,
      allow_edit: true,
      allow_respond: false,
      allow_ignore: true,
    }),
  risk: ApprovalRisk.default("normal"),
  requested_by: z.string().uuid().optional(),
  thread_id: z.string().uuid().optional(),
  item_id: z.string().uuid().optional(),
  task_id: z.string().uuid().optional(),
  expires_at: z.string().datetime().optional(),
});
export type HumanInterrupt = z.infer<typeof HumanInterrupt>;

export const HumanResponse = z.object({
  decision: ApprovalDecision,
  decided_args: z.record(z.unknown()).optional(),
});
export type HumanResponse = z.infer<typeof HumanResponse>;
