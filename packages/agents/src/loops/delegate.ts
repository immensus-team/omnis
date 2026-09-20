// A4 §5. No path runs without approval — this loop's only output is a single pending_approvals row.
import { z } from "zod";
import { buildContext } from "../context/assemble.js";
import { renderBrief } from "../delegate/brief.js";
import { registerLoop } from "../loop/registry.js";
import type { LoopSpec, TriggerContext } from "../loop/spec.js";
import { PROPOSE_TOOLS } from "../tools/propose.js";

/** A4 §4.4: even with autonomy rules open, anything over 30 minutes goes through approval. */
export const AUTONOMY_MAX_MINUTES = 30;

export interface AutonomyRule {
  runtime: string;
  repo: string;
}

export function autonomyAllows(i: {
  rules: AutonomyRule[];
  runtime: string;
  repo: string | null;
  estMinutes: number;
  hasEgress: boolean;
}): boolean {
  if (i.hasEgress) return false;
  if (i.estMinutes > AUTONOMY_MAX_MINUTES) return false;
  if (i.repo === null) return false;
  return i.rules.some((r) => r.runtime === i.runtime && i.repo === r.repo);
}

export const DelegateOutput = z.object({
  runtime: z.enum(["claude_code", "codex", "claude_ds", "omnis"]), // B-D7: no hermes
  host: z.enum(["mini", "macbook"]),
  goal: z.string().max(200),
  // No .default() here, for the same reason as taskLoop: once z.input and z.output diverge it
  // will not attach to LoopSpec<DelegateOutputT>.outputSchema (the field A4 §1.6 flagsOf reads).
  background: z.array(z.string().max(200)).max(6),
  steps: z.array(z.string().max(200)).min(1).max(8),
  acceptance: z.array(z.string().max(200)).min(1),
  verify_cmd: z.string().max(300),
  workdir: z.string(),
  est_minutes: z.number().int().min(1).max(600),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(300),
  injection_flags: z.array(z.string()),
});
export type DelegateOutputT = z.infer<typeof DelegateOutput>;

export const delegateLoop: LoopSpec<DelegateOutputT> = {
  id: "delegate",
  kind: "deliberate",
  trigger: {
    kind: "event",
    on: "task.created",
    where: "owner_kind = 'agent' AND routing_rule_id IS NULL",
    debounceMs: 0,
  },
  palette: ["read_thread", "read_tasks", "read_session", "search_memory", "propose_delegation"],
  budget: { inputTokens: 8000, outputTokens: 900, wallClockMs: 60_000, maxSteps: 6 },
  tier: "T2",
  outputSchema: DelegateOutput,

  assemble: (ctx: TriggerContext) =>
    buildContext({
      selfModel: ["USER.md", "PROJECTS.md"],
      tasks: { state: "open", limit: 10 },
      sessions: { sessionKeys: [], lastN: 3 },
      memories: { query: String(ctx.payload.title ?? ""), k: 4 },
    }),

  async apply(result, ctx) {
    const taskId = ctx.task_id;
    if (taskId === undefined) return;
    const o = result.output;
    const brief = renderBrief({
      goal: o.goal,
      background: o.background,
      steps: o.steps,
      acceptance: o.acceptance,
      verifyCmd: o.verify_cmd,
      workdir: o.workdir,
    });
    await PROPOSE_TOOLS.propose_delegation?.execute?.(
      {
        task_id: taskId,
        runtime: o.runtime,
        host: o.host,
        brief,
        acceptance: o.acceptance,
        verify_cmd: o.verify_cmd,
        workdir: o.workdir,
        est_minutes: o.est_minutes,
        rule_id: "dr_llm",
        confidence: o.confidence,
      },
      { toolCallId: result.run_id, messages: [], context: undefined },
    );
  },
};

registerLoop(delegateLoop);
