import { getAgentsPool } from "./pool.js";

export interface RecordRunInput {
  loop:
    | "classify"
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
  provider: "local" | "deepseek" | "anthropic" | "openrouter";
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

/** A4-D16: 여기 없는 실행은 존재하지 않은 것으로 취급한다. 모든 L3 호출이 이 헬퍼를 거친다. */
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
