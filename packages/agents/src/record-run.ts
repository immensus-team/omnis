import { getAgentsPool } from "./pool.js";

/** The `agent_runs.provider` column's domain. Exported so a decision provider can name its own runs. */
export type RunProvider = "local" | "deepseek" | "anthropic" | "openrouter" | "vercel-ai-gateway";

export interface RecordRunInput {
  loop:
    | "classify"
    | "summarize"
    | "draft"
    | "task"
    | "delegate"
    | "digest"
    | "followup"
    | "note_route"
    | "auto_archive"
    | "ingest";
  agent_session_id?: string;
  item_id?: string;
  trigger_kind: "event" | "cron" | "manual";
  trigger_ref?: string;
  model_tier: "T0" | "T1" | "T2" | "T3";
  /** "vercel-ai-gateway" is the Jev decision tier — see docs/decisions/2026-09-21-jev-decision-tier.md. */
  provider: RunProvider;
  model: string;
  tokens_in?: number;
  tokens_out?: number;
  tokens_cached?: number;
  cost_usd?: number;
  latency_ms?: number;
  outcome: "running" | "ok" | "failed" | "skipped" | "blocked";
  error?: string;
  confidence?: number;
  escalated_from?: string;
  injection_flags?: string[];
  context_hash?: string;
  result_ref?: string;
  raw_output?: string;
}

const COLUMNS = [
  "loop",
  "agent_session_id",
  "item_id",
  "trigger_kind",
  "trigger_ref",
  "model_tier",
  "provider",
  "model",
  "tokens_in",
  "tokens_out",
  "tokens_cached",
  "cost_usd",
  "latency_ms",
  "outcome",
  "error",
  "confidence",
  "escalated_from",
  "injection_flags",
  "context_hash",
  "result_ref",
  "raw_output",
] as const;

/** A4-D16: a run that is not recorded here does not exist. Every L3 call goes through this helper. */
export async function recordRun(input: RecordRunInput): Promise<string> {
  const values = COLUMNS.map((c) => {
    const v = (input as unknown as Record<string, unknown>)[c];
    if (c === "injection_flags") return (v as string[] | undefined) ?? [];
    return v ?? null;
  });
  const placeholders = COLUMNS.map((_, i) => `$${i + 1}`).join(", ");
  const { rows } = await getAgentsPool().query<{ id: string }>(
    `INSERT INTO agent_runs (${COLUMNS.join(", ")}) VALUES (${placeholders}) RETURNING id`,
    values,
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("agent_runs insert returned no id");
  return id;
}

const PATCHABLE = [
  "agent_session_id",
  "item_id",
  "trigger_ref",
  "model_tier",
  "provider",
  "model",
  "tokens_in",
  "tokens_out",
  "tokens_cached",
  "cost_usd",
  "latency_ms",
  "outcome",
  "error",
  "confidence",
  "escalated_from",
  "injection_flags",
  "context_hash",
  "result_ref",
  "raw_output",
] as const;

/** Ends a run: overwrites only the given columns and stamps finished_at. Retry decisions belong to the caller (A4 §1.6). */
export async function finishRun(
  id: string,
  patch: Partial<RecordRunInput> & { outcome: RecordRunInput["outcome"] },
): Promise<void> {
  const sets: string[] = ["finished_at = now()"];
  const values: unknown[] = [id];
  for (const c of PATCHABLE) {
    const v = (patch as Record<string, unknown>)[c];
    if (v === undefined) continue;
    values.push(v);
    sets.push(`${c} = $${values.length}`);
  }
  const { rowCount } = await getAgentsPool().query(
    `UPDATE agent_runs SET ${sets.join(", ")} WHERE id = $1`,
    values,
  );
  if (rowCount === 0) throw new Error(`agent_runs row not found: ${id}`);
}
