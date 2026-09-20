// B3: kinso 인박스 행의 "AI 한 줄 요약" 루프. DESIGN-DIRECTION.md: "요약은 T1(DeepSeek Flash) 한 줄,
// 실패·미생성 시 subject 또는 본문 첫 줄 폴백. threads.meta.summary에 저장하고 매 실행을
// agent_runs에 기록."
import { getAgentsPool } from "./pool.js";
import { finishRun, recordRun } from "./record-run.js";
import { SchemaViolationError } from "./t1/classify-t1.js";
import { T1_RUN_MODEL, summarizeWithT1 } from "./t1/summarize-t1.js";

const SUMMARY_MAX_CHARS = 90;

export interface SummarizeThreadResult {
  summary: string;
  source: "t1" | "fallback";
}

/** 폴백: subject, 없으면 본문 첫 줄. 90자를 넘으면 자른다(design direction §요약). */
function fallbackSummary(subject: string | null, body: string): string {
  const line = (subject ?? body.split("\n")[0] ?? "").trim();
  return line.length > SUMMARY_MAX_CHARS ? `${line.slice(0, SUMMARY_MAX_CHARS - 1)}…` : line;
}

/** 스레드의 마지막 item을 요약해 threads.meta에 쓴다. 마지막 item이 outbound(author_is_me)면
 *  건너뛴다 — 내가 보낸 메시지로 인박스 행을 요약할 이유가 없다. 스레드에 item이 아직 없어도,
 *  마지막 item에 요약할 텍스트가 없어도(subject/body 둘 다 빈 문자열) 건너뛴다. */
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
  // 빈 item(sessions.ts writeAgentItem의 started 단계 tool_call은 body='')을 요약하면 T1 호출을
  // 낭비하고 폴백이 빈 문자열을 뱉어 이미 있던 멀쩡한 요약을 지운다. 요약할 텍스트가 없으면
  // 마지막 요약을 그대로 둔다.
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
    // 키가 없거나(t1Model()이 던짐) 스키마 위반이거나 타임아웃이거나 — 전부 같은 폴백.
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
