// packages/agents/src/memory/consolidate.ts
// A4 §6.5: the only latency-insensitive job, so batching fits it exactly (Anthropic Message Batches, -50%).
// No new SDK pinned — submit and harvest are one fetch each.
export const ANTHROPIC_BATCH_URL = "https://api.anthropic.com/v1/messages/batches";
export const ANTHROPIC_BATCH_MODEL = "claude-sonnet-5";
export const MEMORY_CONSOLIDATE_CRON = "30 23 * * *";
/** Harvest before the next morning briefing (06:30). */
export const MEMORY_HARVEST_CRON = "0 6 * * *";

const ANTHROPIC_VERSION = "2023-06-01";

export interface ConsolidationRequest {
  custom_id: string;
  prompt: string;
}

export interface ConsolidationResult {
  custom_id: string;
  text: string;
}

function apiKey(): string {
  return process.env.OMNIS_ANTHROPIC_API_KEY ?? "";
}

function headers(key: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-api-key": key,
    "anthropic-version": ANTHROPIC_VERSION,
  };
}

/** Returns null when the key is missing — delta §9: the T2 path is skipped and a system Item appears. */
export async function submitConsolidation(
  requests: readonly ConsolidationRequest[],
): Promise<string | null> {
  const key = apiKey();
  if (key === "" || requests.length === 0) return null;
  const res = await fetch(ANTHROPIC_BATCH_URL, {
    method: "POST",
    headers: headers(key),
    body: JSON.stringify({
      requests: requests.map((r) => ({
        custom_id: r.custom_id,
        params: {
          model: ANTHROPIC_BATCH_MODEL,
          max_tokens: 800,
          messages: [{ role: "user", content: r.prompt }],
        },
      })),
    }),
  });
  if (!res.ok) throw new Error(`anthropic batch submit failed: ${res.status}`);
  const body = (await res.json()) as { id: string };
  return body.id;
}

export async function harvestConsolidation(batchId: string): Promise<ConsolidationResult[]> {
  const key = apiKey();
  if (key === "") return [];
  const status = await fetch(`${ANTHROPIC_BATCH_URL}/${batchId}`, { headers: headers(key) });
  if (!status.ok) throw new Error(`anthropic batch status failed: ${status.status}`);
  const meta = (await status.json()) as { processing_status: string; results_url?: string };
  if (meta.processing_status !== "ended" || meta.results_url === undefined) return [];

  const results = await fetch(meta.results_url, { headers: headers(key) });
  if (!results.ok) throw new Error(`anthropic batch results failed: ${results.status}`);
  const text = await results.text();
  const out: ConsolidationResult[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const row = JSON.parse(line) as {
      custom_id: string;
      result: { type: string; message?: { content: { type: string; text?: string }[] } };
    };
    if (row.result.type !== "succeeded") continue;
    const chunk = row.result.message?.content.find((c) => c.type === "text")?.text;
    if (chunk !== undefined) out.push({ custom_id: row.custom_id, text: chunk });
  }
  return out;
}
