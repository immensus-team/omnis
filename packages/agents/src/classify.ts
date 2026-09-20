import { Scope, Sensitivity } from "@omnis/protocol";
// A4 §2 L1 분류·라벨 루프. 3단(결정론적 규칙 → 임베딩 kNN → T1 LLM)을 순서대로 내려간다.
import { z } from "zod";
import { knnVote } from "./classify/knn.js";
import { type ClassifyCtx, applyRules } from "./classify/rules.js";
import { finishRun, recordRun } from "./record-run.js";
import { pickSensitivity, sensitivityFor } from "./sensitivity.js";
import { SchemaViolationError, T1_RUN_MODEL, classifyWithT1 } from "./t1/classify-t1.js";
import type { ItemRow } from "./types.js";

export const ClassifyOutput = z.object({
  scope: Scope,
  topic: z.string().max(40).optional(),
  priority: z.enum(["now", "today", "week", "fyi"]),
  person_label: z.string().max(40).optional(),
  matched_rule_ids: z.array(z.string()).default([]),
  sensitivity: Sensitivity,
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(200),
  injection_flags: z.array(z.string()).default([]),
  tier_used: z.enum(["T0", "T1", "T2"]),
});
export type ClassifyResult = z.infer<typeof ClassifyOutput>;

export async function classify(item: ItemRow, ctx: ClassifyCtx): Promise<ClassifyResult> {
  // ── 1단: 결정론적 규칙 (T0, $0)
  const hit = await applyRules(item, ctx);
  if (hit !== null) {
    const sensitivity = await sensitivityFor(item, ctx);
    const runId = await recordRun({
      loop: "classify",
      item_id: item.id,
      trigger_kind: "event",
      model_tier: "T0",
      provider: "local",
      model: "rules-v1",
      outcome: "running",
    });
    const out: ClassifyResult = {
      scope: hit.scope,
      priority: "week",
      matched_rule_ids: [hit.rule_id],
      sensitivity,
      confidence: hit.confidence,
      rationale: `규칙 ${hit.rule_id}이 이 메시지를 ${hit.scope}로 판정했습니다.`,
      injection_flags: [],
      tier_used: "T0",
    };
    await finishRun(runId, { outcome: "ok", confidence: hit.confidence, latency_ms: 1 });
    return out;
  }

  // ── 2단: 임베딩 kNN (T0, $0)
  const knn = await knnVote(item, ctx);
  if (knn !== null) {
    const sensitivity = await sensitivityFor(item, ctx);
    const runId = await recordRun({
      loop: "classify",
      item_id: item.id,
      trigger_kind: "event",
      model_tier: "T0",
      provider: "local",
      model: "nomic-embed-text-v1.5",
      outcome: "running",
    });
    const confidence = Math.min(0.99, knn.avgSim);
    const out: ClassifyResult = {
      scope: knn.scope,
      priority: "week",
      matched_rule_ids: [],
      sensitivity,
      confidence,
      rationale: `비슷한 지난 메시지 ${knn.neighborIds.length}건이 모두 ${knn.scope}였습니다.`,
      injection_flags: [],
      tier_used: "T0",
    };
    await finishRun(runId, { outcome: "ok", confidence, latency_ms: 20 });
    return out;
  }

  // ── 3단: T1 LLM (DeepSeek V4.1 Flash via OpenRouter)
  const runId = await recordRun({
    loop: "classify",
    item_id: item.id,
    trigger_kind: "event",
    model_tier: "T1",
    provider: "openrouter",
    model: T1_RUN_MODEL,
    outcome: "running",
  });
  try {
    const t1 = await classifyWithT1(item, ctx);
    const blocked = t1.output.injection_flags.length > 0;
    await finishRun(runId, {
      outcome: blocked ? "blocked" : "ok",
      confidence: t1.output.confidence,
      latency_ms: t1.latencyMs,
      context_hash: t1.contextHash,
      injection_flags: t1.output.injection_flags,
      ...t1.usage,
    });
    // A4 §1.6: injection_flags가 비어있지 않으면 결과물을 만들지 않는다.
    if (blocked) {
      return {
        scope: "unknown",
        priority: "fyi",
        matched_rule_ids: [],
        sensitivity: "normal",
        confidence: 0,
        rationale: "이 메시지에 지시문으로 보이는 내용이 있어 자동 처리를 건너뛰었습니다.",
        injection_flags: t1.output.injection_flags,
        tier_used: "T1",
      };
    }
    return {
      ...t1.output,
      sensitivity: pickSensitivity(t1.output.sensitivity, await sensitivityFor(item, ctx)),
      tier_used: "T1",
    };
  } catch (e) {
    const raw = e instanceof SchemaViolationError ? e.rawOutput : undefined;
    await finishRun(runId, {
      outcome: "failed",
      error: e instanceof Error ? e.message : String(e),
      ...(raw !== undefined ? { raw_output: raw } : {}),
    });
    // A4 §2.5: 판정 못 하면 unknown으로 두고 Inbox All 탭에만 보인다.
    return {
      scope: "unknown",
      priority: "fyi",
      matched_rule_ids: [],
      sensitivity: "normal",
      confidence: 0,
      rationale: "자동 분류에 실패해 미분류로 남겨두었습니다.",
      injection_flags: [],
      tier_used: "T1",
    };
  }
}

export type { ClassifyCtx };
