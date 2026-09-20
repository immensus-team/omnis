// A4 §1.6 실패 처리 7종 + §1.7 실행 기록. 모든 루프가 이 함수 하나를 통과한다.
import { createHash } from "node:crypto";
import {
  type LanguageModel,
  type LanguageModelUsage,
  NoObjectGeneratedError,
  Output,
  generateObject,
  generateText,
  stepCountIs,
} from "ai";
import { newNonce, wrapData } from "../context/normalize.js";
import { getAgentsPool } from "../pool.js";
import { finishRun, recordRun } from "../record-run.js";
import { writeSystemItem } from "../system-item.js";
import { T1_RUN_MODEL, t1Model } from "../t1/provider.js";
import { T2_RUN_MODEL, t2Model } from "../t2/provider.js";
import { toolRegistry } from "../tools/registry.js";
import { getLoop } from "./registry.js";
import {
  LoopBudgetError,
  type LoopId,
  type LoopResult,
  type LoopSpec,
  PhantomToolError,
  type TriggerContext,
} from "./spec.js";

export const QUARANTINE_HOURS = 24;
export const FAILURE_WINDOW_HOURS = 24;
export const FAILURE_LIMIT = 3;
/** A4 §1.6: 재시도 백오프는 1s → 4s. 그 이상은 하지 않는다. */
const RETRY_BACKOFF_MS = [1_000, 4_000] as const;

type Tier = "T0" | "T1" | "T2";

function nextTier(t: Tier): Tier {
  return t === "T0" ? "T1" : "T2";
}

function modelFor(tier: Tier): LanguageModel {
  return tier === "T2" ? t2Model() : t1Model();
}

function runModelFor(tier: Tier): string {
  return tier === "T2" ? T2_RUN_MODEL : T1_RUN_MODEL;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** A4 §1.6: tool-not-found는 그 스레드를 24시간 자동루프에서 제외한다. */
async function quarantine(threadId: string, now: Date): Promise<void> {
  const until = new Date(now.getTime() + QUARANTINE_HOURS * 3_600_000).toISOString();
  await getAgentsPool().query(
    `UPDATE threads SET meta = meta || jsonb_build_object('loop_quarantine_until', $2::text)
      WHERE id = $1`,
    [threadId, until],
  );
}

async function isQuarantined(threadId: string, now: Date): Promise<boolean> {
  const { rows } = await getAgentsPool().query<{ until: string | null }>(
    "SELECT meta->>'loop_quarantine_until' AS until FROM threads WHERE id = $1",
    [threadId],
  );
  const until = rows[0]?.until;
  return until !== undefined && until !== null && new Date(until) > now;
}

/** A4 §1.6: 같은 item에 24시간 내 3회 실패하면 agent_optout으로 마킹하고 더 안 돈다. */
async function tooManyFailures(loop: LoopId, itemId: string): Promise<boolean> {
  const { rows } = await getAgentsPool().query<{ n: string }>(
    `SELECT count(*)::text AS n FROM agent_runs
      WHERE loop = $1 AND item_id = $2 AND outcome = 'failed'
        AND created_at > now() - ($3 || ' hours')::interval`,
    [loop, itemId, String(FAILURE_WINDOW_HOURS)],
  );
  return Number(rows[0]?.n ?? "0") >= FAILURE_LIMIT;
}

async function markOptOut(itemId: string): Promise<void> {
  await getAgentsPool().query(
    `UPDATE items SET meta = meta || '{"agent_optout": true}'::jsonb WHERE id = $1`,
    [itemId],
  );
}

function promptFor(ctx: TriggerContext, spec: LoopSpec<unknown>, volatileText: string): string {
  return wrapData(volatileText, {
    nonce: newNonce(),
    source: spec.id,
    ...(ctx.thread_id !== undefined ? { thread: ctx.thread_id } : {}),
    asOf: ctx.now.toISOString(),
  });
}

interface Generated {
  output: unknown;
  usage: { tokens_in?: number; tokens_out?: number; tokens_cached?: number };
  raw: string;
}

/** ai@7의 LanguageModelUsage는 평평하다(inputTokenDetails.cacheReadTokens) — classify-t1.ts와 같은 형태. */
function usageOf(u: LanguageModelUsage): Generated["usage"] {
  return {
    ...(u.inputTokens !== undefined ? { tokens_in: u.inputTokens } : {}),
    ...(u.outputTokens !== undefined ? { tokens_out: u.outputTokens } : {}),
    ...(u.inputTokenDetails.cacheReadTokens !== undefined
      ? { tokens_cached: u.inputTokenDetails.cacheReadTokens }
      : {}),
  };
}

async function generate(
  spec: LoopSpec<unknown>,
  tier: Tier,
  system: string,
  prompt: string,
): Promise<Generated> {
  const model = modelFor(tier);
  const abortSignal = AbortSignal.timeout(spec.budget.wallClockMs);
  if (spec.palette.length === 0) {
    const res = await generateObject({
      model,
      schema: spec.outputSchema,
      system,
      prompt,
      maxOutputTokens: spec.budget.outputTokens,
      abortSignal,
    });
    return { output: res.object, usage: usageOf(res.usage), raw: JSON.stringify(res.object) };
  }
  const res = await generateText({
    model,
    system,
    prompt,
    tools: toolRegistry(spec.palette),
    stopWhen: stepCountIs(spec.budget.maxSteps),
    output: Output.object({ schema: spec.outputSchema }),
    maxOutputTokens: spec.budget.outputTokens,
    abortSignal,
  });
  return { output: res.output, usage: usageOf(res.totalUsage), raw: res.text };
}

function flagsOf(output: unknown): string[] {
  if (typeof output !== "object" || output === null) return [];
  const f = (output as { injection_flags?: unknown }).injection_flags;
  return Array.isArray(f) ? f.filter((x): x is string => typeof x === "string") : [];
}

function numberField(output: unknown, key: string, fallback: number): number {
  if (typeof output !== "object" || output === null) return fallback;
  const v = (output as Record<string, unknown>)[key];
  return typeof v === "number" ? v : fallback;
}

function stringField(output: unknown, key: string, fallback: string): string {
  if (typeof output !== "object" || output === null) return fallback;
  const v = (output as Record<string, unknown>)[key];
  return typeof v === "string" ? v : fallback;
}

/** A4 §12.2: 캐시 히트율을 사후에 재려면 sha256(cachedPrefix)이 agent_runs에 남아야 한다. */
function hash(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

async function startRun(
  spec: LoopSpec<unknown>,
  ctx: TriggerContext,
  tier: Tier,
  escalatedFrom?: string,
): Promise<string> {
  return recordRun({
    loop: spec.id,
    trigger_kind: ctx.trigger_kind,
    model_tier: tier,
    provider: "openrouter",
    model: runModelFor(tier),
    outcome: "running",
    ...(ctx.item_id !== undefined ? { item_id: ctx.item_id } : {}),
    ...(ctx.trigger_ref !== undefined ? { trigger_ref: ctx.trigger_ref } : {}),
    ...(escalatedFrom !== undefined ? { escalated_from: escalatedFrom } : {}),
  });
}

async function skipped<T>(
  spec: LoopSpec<T>,
  ctx: TriggerContext,
  reason: string,
): Promise<LoopResult<T>> {
  const runId = await recordRun({
    loop: spec.id,
    trigger_kind: ctx.trigger_kind,
    model_tier: "T0",
    provider: "local",
    model: "gate",
    outcome: "running",
    ...(ctx.item_id !== undefined ? { item_id: ctx.item_id } : {}),
  });
  await finishRun(runId, { outcome: "skipped", error: reason });
  return {
    loop: spec.id,
    run_id: runId,
    output: undefined as T,
    confidence: 0,
    rationale: reason,
    escalate: false,
    injection_flags: [],
    unresolved: [],
  };
}

/** 레지스트리를 타지 않는 하위 진입점. digest 두 루프가 같은 LoopId를 쓰므로 필요하다. */
export async function runLoopSpec<T>(
  spec: LoopSpec<T>,
  ctx: TriggerContext,
): Promise<LoopResult<T>> {
  const anySpec = spec as LoopSpec<unknown>;

  // ── 게이트 1·2: quarantine, 24h 3회 실패
  if (ctx.thread_id !== undefined && (await isQuarantined(ctx.thread_id, ctx.now))) {
    return skipped(spec, ctx, "thread is quarantined for 24h (phantom tool)");
  }
  if (ctx.item_id !== undefined && (await tooManyFailures(spec.id, ctx.item_id))) {
    await markOptOut(ctx.item_id);
    return skipped(spec, ctx, "3 failures in 24h — marked agent_optout");
  }

  // ── T0 선판정: 모델을 부르지 않고 끝나는 경로(A4 §9.2 ①③④)
  const decided = spec.decide === undefined ? null : await spec.decide(ctx);
  if (decided !== null) {
    const runId = await recordRun({
      loop: spec.id,
      trigger_kind: ctx.trigger_kind,
      model_tier: "T0",
      provider: "local",
      model: "rules-v1",
      outcome: "running",
      ...(ctx.item_id !== undefined ? { item_id: ctx.item_id } : {}),
      ...(ctx.trigger_ref !== undefined ? { trigger_ref: ctx.trigger_ref } : {}),
    });
    const result: LoopResult<T> = { ...decided, run_id: runId };
    await finishRun(runId, { outcome: "ok", confidence: result.confidence });
    await spec.apply(result, ctx);
    return result;
  }

  let tier: Tier = spec.tier === "T0" ? "T1" : spec.tier;
  let runId = await startRun(anySpec, ctx, tier);

  const assembled = await spec.assemble(ctx).catch(async (e: unknown) => {
    if (e instanceof PhantomToolError) {
      if (ctx.thread_id !== undefined) await quarantine(ctx.thread_id, ctx.now);
      await finishRun(runId, {
        outcome: "failed",
        error: e.message,
        injection_flags: ["phantom_tool"],
      });
    }
    throw e;
  });

  if (assembled.tokenEstimate > spec.budget.inputTokens) {
    await finishRun(runId, {
      outcome: "failed",
      error: `budget.inputTokens ${assembled.tokenEstimate} > ${spec.budget.inputTokens}`,
    });
    throw new LoopBudgetError(
      spec.id,
      "inputTokens",
      assembled.tokenEstimate,
      spec.budget.inputTokens,
    );
  }

  const prompt = promptFor(ctx, anySpec, assembled.volatile.map((b) => b.text).join("\n"));
  let lastError: unknown = null;
  let lastRaw = "";

  // A4 §1.6: 같은 티어 1회 재시도 → 한 티어 상승해 1회 → failed.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt === 2) {
      const raised = nextTier(tier);
      if (raised === tier) break;
      const failedRunId = runId;
      await finishRun(failedRunId, {
        outcome: "failed",
        error: lastError instanceof Error ? lastError.message : String(lastError),
        ...(lastRaw !== "" ? { raw_output: lastRaw } : {}),
      });
      await sleep(RETRY_BACKOFF_MS[1]);
      tier = raised;
      runId = await startRun(anySpec, ctx, tier, failedRunId);
    } else if (attempt > 0) {
      await sleep(RETRY_BACKOFF_MS[0]);
    }
    try {
      const started = Date.now();
      const gen = await generate(anySpec, tier, assembled.cachedPrefix, prompt);
      const flags = flagsOf(gen.output);
      const confidence = numberField(gen.output, "confidence", 0.5);
      const result: LoopResult<T> = {
        loop: spec.id,
        run_id: runId,
        output: gen.output as T,
        confidence,
        rationale: stringField(gen.output, "rationale", ""),
        escalate: confidence < 0.5,
        injection_flags: flags,
        unresolved: [],
      };
      await finishRun(runId, {
        outcome: flags.length > 0 ? "blocked" : "ok",
        confidence,
        latency_ms: Date.now() - started,
        injection_flags: flags,
        ...(assembled.cachedPrefix === "" ? {} : { context_hash: hash(assembled.cachedPrefix) }),
        ...gen.usage,
      });
      // A4 §1.6: injection_flags가 비어 있지 않으면 결과물을 만들지 않는다.
      if (flags.length > 0) {
        await writeSystemItem({
          body: "이 메시지에 지시문으로 보이는 내용이 있어 자동 처리를 건너뛰었습니다.",
          ...(ctx.thread_id !== undefined ? { thread_id: ctx.thread_id } : {}),
          meta: { loop: spec.id, injection_flags: flags, run_id: runId },
        });
        return result;
      }
      await spec.apply(result, ctx);
      return result;
    } catch (e) {
      lastError = e;
      if (NoObjectGeneratedError.isInstance(e)) lastRaw = e.text ?? "";
    }
  }

  await finishRun(runId, {
    outcome: "failed",
    error: lastError instanceof Error ? lastError.message : String(lastError),
    ...(lastRaw !== "" ? { raw_output: lastRaw } : {}),
  });
  await writeSystemItem({
    body: `자동 처리에 실패했습니다(${spec.id}). 직접 확인해 주세요.`,
    ...(ctx.thread_id !== undefined ? { thread_id: ctx.thread_id } : {}),
    meta: { loop: spec.id, run_id: runId },
  });
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function runLoop(id: LoopId, ctx: TriggerContext): Promise<LoopResult<unknown>> {
  return runLoopSpec(getLoop(id), ctx);
}
