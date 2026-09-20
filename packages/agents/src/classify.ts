import { Scope, Sensitivity } from "@omnis/protocol";
// A4 §2 L1 classification/labeling loop. It descends the three stages in order (deterministic rules → embedding kNN → T1 LLM).
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
  // ── Stage 1: deterministic rules (T0, $0)
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
      rationale: `Rule ${hit.rule_id} classified this message as ${hit.scope}.`,
      injection_flags: [],
      tier_used: "T0",
    };
    await finishRun(runId, { outcome: "ok", confidence: hit.confidence, latency_ms: 1 });
    return out;
  }

  // ── Stage 2: embedding kNN (T0, $0)
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
      rationale: `${knn.neighborIds.length} similar past messages were all ${knn.scope}.`,
      injection_flags: [],
      tier_used: "T0",
    };
    await finishRun(runId, { outcome: "ok", confidence, latency_ms: 20 });
    return out;
  }

  // ── Stage 3: T1 LLM (DeepSeek V4.1 Flash via OpenRouter)
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
    // A4 §1.6: if injection_flags is non-empty, no output artifact is produced.
    if (blocked) {
      return {
        scope: "unknown",
        priority: "fyi",
        matched_rule_ids: [],
        sensitivity: "normal",
        confidence: 0,
        rationale:
          "This message contains what looks like instructions, so automatic processing was skipped.",
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
    // A4 §2.5: if it cannot be classified, leave it as unknown; it appears only in the Inbox All tab.
    return {
      scope: "unknown",
      priority: "fyi",
      matched_rule_ids: [],
      sensitivity: "normal",
      confidence: 0,
      rationale: "Automatic classification failed, so this was left unclassified.",
      injection_flags: [],
      tier_used: "T1",
    };
  }
}

export type { ClassifyCtx };
