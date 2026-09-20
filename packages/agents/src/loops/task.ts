// A4 §4. 정밀도 우선 — 거짓 투두는 진짜 투두를 묻는다.
import { z } from "zod";
import { buildContext } from "../context/assemble.js";
import {
  DELEGATION_DAILY_CAP,
  DELEGATION_THREAD_CAP_24H,
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
  // A4 §1.6: runLoopSpec의 flagsOf()가 이 필드를 읽는다. default를 걸면 z.input과 z.output이
  // 갈라져 LoopSpec<TaskOutputT>에 안 붙는다 — 모델이 빈 배열이라도 항상 적게 한다.
  injection_flags: z.array(z.string()),
});
export type TaskOutputT = z.infer<typeof TaskOutput>;

export const taskLoop: LoopSpec<TaskOutputT> = {
  id: "task",
  kind: "reactive",
  // A4 §4.1은 event 트리거 2종(item.labeled / item.sent)을 요구하지만 LoopTrigger는 하나만
  // 담는다(US-B06 계약). 내가 보낸 약속(item.sent)은 허브가 같은 루프를 manual로 깨워 태운다.
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

      // A4 §4.4: owner='agent'면 같은 실행 안에서 routeByRule을 돌린다(LLM 호출 없음, ~1ms).
      if (out === undefined || t.owner !== "agent" || t.duplicate_of !== undefined) continue;
      if (result.injection_flags.length > 0) continue; // 폭주 방지 ④
      const hints = extractHints(`${t.title}\n${t.detail ?? ""}\n${t.agent_hint ?? ""}`);
      const routing = routeByRule(hints, await hostHealth());
      if (routing === null) continue; // 규칙이 못 가름 → L4가 깨어난다
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

/** A4 §4.4 폭주 방지 ①②: 하루 5건, 같은 스레드 24h 2건. */
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
