// A4 §4. Precision first — a false todo buries a real one.
import { z } from "zod";
import { buildContext } from "../context/assemble.js";
import {
  HOST_OPTIONS,
  QUESTION,
  RUNTIME_OPTIONS,
  delegationRequest,
} from "../decision/decisions.js";
import { decideOrNull } from "../decision/router.js";
import { choiceOf, probabilityOf } from "../decision/types.js";
import {
  DELEGATION_DAILY_CAP,
  DELEGATION_THREAD_CAP_24H,
  type DelegationHints,
  type Routing,
  extractHints,
  hostHealth,
  routeByRule,
} from "../delegate/route.js";
import { registerLoop } from "../loop/registry.js";
import type { LoopSpec, TriggerContext } from "../loop/spec.js";
import { getAgentsPool } from "../pool.js";
import { PROPOSE_TOOLS } from "../tools/propose.js";

export const TASK_CONFIDENCE_MIN = 0.7;
export const TASK_MAX_PER_ITEM = 3;
/** Minimum P(eligible) before the decision tier hands a task to an agent (see routeDelegation). */
export const DELEGATION_JEV_MIN = 0.7;

export const TaskOutput = z.object({
  tasks: z
    .array(
      z.object({
        title: z.string().max(120),
        detail: z.string().max(600).optional(),
        owner: z.enum(["me", "agent"]),
        agent_hint: z.string().max(200).optional(),
        due_at: z.string().datetime().optional(),
        due_basis: z.enum(["stated", "inferred", "none"]),
        duplicate_of: z.string().uuid().optional(),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(8),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(200),
  // A4 §1.6: runLoopSpec's flagsOf() reads this field. Adding a default would split z.input from
  // z.output so it no longer fits LoopSpec<TaskOutputT> — make the model always emit it, even empty.
  injection_flags: z.array(z.string()),
});
export type TaskOutputT = z.infer<typeof TaskOutput>;

export const taskLoop: LoopSpec<TaskOutputT> = {
  id: "task",
  kind: "reactive",
  // A4 §4.1 calls for two event triggers (item.labeled / item.sent) but LoopTrigger carries only
  // one (US-B06 contract). For promises I sent (item.sent) the hub wakes this loop as manual instead.
  trigger: { kind: "event", on: "item.labeled", where: "author <> 'me'", debounceMs: 20_000 },
  palette: ["read_thread", "read_tasks", "search_memory", "propose_task", "propose_delegation"],
  budget: { inputTokens: 2800, outputTokens: 400, wallClockMs: 15_000, maxSteps: 2 },
  tier: "T1",
  outputSchema: TaskOutput,

  assemble: (ctx: TriggerContext) =>
    buildContext({
      selfModel: ["USER.md", "PROJECTS.md"],
      thread: { threadId: ctx.thread_id ?? "", lastN: 6 },
      tasks: { state: "open", limit: 20 },
      memories: { query: String(ctx.payload.query ?? ""), k: 3 },
    }),

  async apply(result, ctx) {
    const sourceItemId = ctx.item_id;
    if (sourceItemId === undefined) return;
    const kept = result.output.tasks
      .filter((t) => t.confidence >= TASK_CONFIDENCE_MIN)
      .slice(0, TASK_MAX_PER_ITEM);

    for (const t of kept) {
      const out = (await PROPOSE_TOOLS.propose_task?.execute?.(
        {
          title: t.title,
          source_item_id: sourceItemId,
          due_basis: t.due_basis,
          owner: t.owner,
          kind: t.owner === "agent" ? "delegation" : "todo",
          confidence: t.confidence,
          ...(t.detail !== undefined ? { detail: t.detail } : {}),
          ...(t.due_at !== undefined ? { due_at: t.due_at } : {}),
          ...(t.agent_hint !== undefined ? { agent_hint: t.agent_hint } : {}),
          ...(t.duplicate_of !== undefined ? { duplicate_of: t.duplicate_of } : {}),
        },
        { toolCallId: result.run_id, messages: [], context: undefined },
      )) as { task_id: string } | undefined;

      // A4 §4.4: when owner='agent', run routeByRule inside the same execution (no LLM call, ~1ms).
      if (out === undefined || t.owner !== "agent" || t.duplicate_of !== undefined) continue;
      if (result.injection_flags.length > 0) continue; // runaway guard ④
      const hintText = `${t.title}\n${t.detail ?? ""}\n${t.agent_hint ?? ""}`;
      const hints = extractHints(hintText);
      const routing = await routeDelegation(hints, t.title, t.detail ?? "", hintText);
      if (routing === null) continue; // neither a rule nor the decision tier could decide
      if (!(await underDelegationCaps(ctx.thread_id ?? null))) continue;
      await PROPOSE_TOOLS.propose_delegation?.execute?.(
        {
          task_id: out.task_id,
          runtime: routing.runtime ?? "claude_code",
          host: routing.host,
          brief: t.detail ?? t.title,
          acceptance: [t.title],
          rule_id: routing.rule_id,
          confidence: t.confidence,
          ...(hints.est_minutes !== null ? { est_minutes: hints.est_minutes } : {}),
          ...(hints.repo !== null ? { workdir: hints.repo } : {}),
        },
        { toolCallId: result.run_id, messages: [], context: undefined },
      );
    }
  },
};

/**
 * A4 §5.2 routing. The deterministic rules run first and win outright when one matches; only the
 * `null` they leave behind goes to the decision tier. Delegation is an egress path, so the answer
 * is still a proposal — `underDelegationCaps` and the pending-approval row are checked by the caller.
 */
export async function routeDelegation(
  hints: DelegationHints,
  title: string,
  detail: string,
  hintText: string,
): Promise<Routing | null> {
  const byRule = routeByRule(hints, await hostHealth());
  if (byRule !== null) return byRule;
  const jev = await decideOrNull(
    delegationRequest({ taskTitle: title, taskDetail: detail, hints: hintText }),
    {},
  );
  if (jev === null) return null;
  const eligible = probabilityOf(jev, QUESTION.delegate);
  const host = choiceOf(jev, QUESTION.host, HOST_OPTIONS);
  const runtime = choiceOf(jev, QUESTION.runtime, RUNTIME_OPTIONS);
  if (eligible === null || eligible < DELEGATION_JEV_MIN) return null;
  if (host === null || runtime === null) return null;
  return { host, runtime, rule_id: "jev_delegation" };
}

/** A4 §4.4 runaway guards ①②: 5 per day, 2 per thread in 24h. */
async function underDelegationCaps(threadId: string | null): Promise<boolean> {
  const pool = getAgentsPool();
  const day = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM pending_approvals
      WHERE action = 'delegate' AND created_at > now() - interval '24 hours'`,
  );
  if (Number(day.rows[0]?.n ?? "0") >= DELEGATION_DAILY_CAP) return false;
  if (threadId === null) return true;
  const thread = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM pending_approvals
      WHERE action = 'delegate' AND thread_id = $1 AND created_at > now() - interval '24 hours'`,
    [threadId],
  );
  return Number(thread.rows[0]?.n ?? "0") < DELEGATION_THREAD_CAP_24H;
}

registerLoop(taskLoop);
