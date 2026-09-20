// B3: the "one-line AI summary" loop for a kinso inbox row. DESIGN-DIRECTION.md: "Summaries are one
// line from T1 (DeepSeek Flash); on failure or when not generated, fall back to the subject or the
// first line of the body. Store in threads.meta.summary and record every run in agent_runs."
import { getAgentsPool } from "./pool.js";
import { finishRun, recordRun } from "./record-run.js";
import { SchemaViolationError } from "./t1/classify-t1.js";
import { T1_RUN_MODEL, summarizeWithT1 } from "./t1/summarize-t1.js";

const SUMMARY_MAX_CHARS = 90;

export interface SummarizeThreadResult {
  summary: string;
  source: "t1" | "fallback";
}

/** Fallback: the subject, or the first line of the body when there is none. Truncates past 90 chars (design direction §summary). */
function fallbackSummary(subject: string | null, body: string): string {
  const line = (subject ?? body.split("\n")[0] ?? "").trim();
  return line.length > SUMMARY_MAX_CHARS ? `${line.slice(0, SUMMARY_MAX_CHARS - 1)}…` : line;
}

/** Summarizes the thread's last item and writes it to threads.meta. Skips when the last item is
 *  outbound (author_is_me) — there is no reason to summarize an inbox row with a message I sent.
 *  Also skips when the thread has no item yet, or the last item has no text to summarize
 *  (both subject and body empty). */
export async function summarizeThread(threadId: string): Promise<SummarizeThreadResult | null> {
  const pool = getAgentsPool();
  const { rows } = await pool.query<{
    id: string;
    subject: string | null;
    body: string;
    author_is_me: boolean;
  }>(
    `SELECT id, subject, body, author_is_me FROM items
       WHERE thread_id = $1 ORDER BY sent_at DESC LIMIT 1`,
    [threadId],
  );
  const last = rows[0];
  // Summarizing an empty item (sessions.ts writeAgentItem's started-stage tool_call has body='')
  // wastes a T1 call and lets the fallback return an empty string, wiping a good existing summary.
  // With no text to summarize, leave the previous summary alone.
  if (last === undefined || last.author_is_me) return null;
  if (`${last.subject ?? ""}${last.body}`.trim() === "") return null;

  const runId = await recordRun({
    loop: "summarize",
    item_id: last.id,
    trigger_kind: "event",
    model_tier: "T1",
    provider: "openrouter",
    model: T1_RUN_MODEL,
    outcome: "running",
  });

  let result: SummarizeThreadResult;
  try {
    const t1 = await summarizeWithT1({ subject: last.subject, body: last.body }, { threadId });
    result = { summary: t1.output.summary, source: "t1" };
    await finishRun(runId, {
      outcome: "ok",
      confidence: t1.output.confidence,
      latency_ms: t1.latencyMs,
      context_hash: t1.contextHash,
      ...t1.usage,
    });
  } catch (e) {
    // Missing key (t1Model() throws), schema violation, or timeout — all take the same fallback.
    result = { summary: fallbackSummary(last.subject, last.body), source: "fallback" };
    const raw = e instanceof SchemaViolationError ? e.rawOutput : undefined;
    await finishRun(runId, {
      outcome: "failed",
      error: e instanceof Error ? e.message : String(e),
      ...(raw !== undefined ? { raw_output: raw } : {}),
    });
  }

  await pool.query(
    `UPDATE threads
        SET meta = meta || jsonb_build_object(
              'summary', $2::text, 'summary_at', now(), 'summary_source', $3::text)
      WHERE id = $1`,
    [threadId, result.summary, result.source],
  );
  return result;
}
