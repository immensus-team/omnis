// packages/agents/src/self-model/propose.ts
// A4 §13. 사용자가 직접 쓴 텍스트는 사용자만 바꾼다 — 이 모듈은 제안 카드까지만 만든다.
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { getAgentsPool } from "../pool.js";
import { PROPOSE_TOOLS } from "../tools/propose.js";

export const SELF_MODEL_CRON = "0 21 * * 0";
export const MAX_PATCHES = 3;
export const MAX_PATCH_LINES = 20;
export const SUPPRESSION_WEEKS = 4;

export interface SelfModelPatch {
  file: "USER.md" | "VOICE.md" | "PROJECTS.md";
  diff: string;
  rationale: string;
  evidence: string[];
}

function changedLines(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
    if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
  }
  return { added, removed };
}

export function validatePatch(p: SelfModelPatch): { ok: boolean; reason: string | null } {
  const { added, removed } = changedLines(p.diff);
  if (added + removed === 0) return { ok: false, reason: "빈 diff" };
  if (added + removed > MAX_PATCH_LINES) {
    return { ok: false, reason: `변경 줄이 ${MAX_PATCH_LINES}줄을 넘었습니다(${added + removed})` };
  }
  const deletionOnly = added === 0 && removed > 0;
  const need = p.file === "USER.md" && deletionOnly ? 3 : 2;
  if (p.evidence.length < need) {
    return { ok: false, reason: `근거가 ${need}개 필요합니다(${p.evidence.length}개)` };
  }
  return { ok: true, reason: null };
}

export function diffHash(diff: string): string {
  return createHash("sha256").update(diff.trim()).digest("hex").slice(0, 32);
}

/** 무시된 패치는 4주간 다시 제안하지 않는다(A4 §13.2). settings kv를 그대로 쓴다.
 *  @omnis/agents는 @omnis/db·@omnis/kernel을 import할 수 없어(계약 §1) kernel의
 *  SettingKey 유니온을 못 쓴다 — self_model.suppressed.<hash>는 동적 키라 어차피 안 맞는다. */
export async function suppressPatch(
  pool: Pool,
  hash: string,
  now: Date = new Date(),
): Promise<void> {
  const until = new Date(now.getTime() + SUPPRESSION_WEEKS * 7 * 86_400_000).toISOString();
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ($1, to_jsonb($2::text))
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [`self_model.suppressed.${hash}`, until],
  );
}

export async function isSuppressed(
  pool: Pool,
  hash: string,
  now: Date = new Date(),
): Promise<boolean> {
  const { rows } = await pool.query<{ until: string }>(
    "SELECT value #>> '{}' AS until FROM settings WHERE key = $1",
    [`self_model.suppressed.${hash}`],
  );
  const until = rows[0]?.until;
  return until !== undefined && new Date(until) > now;
}

/** 파일당 최대 1개, 전체 최대 3개. 억제된 diff와 제약 위반은 건너뛴다. */
export async function proposeSelfModelPatches(
  patches: readonly SelfModelPatch[],
  runId: string,
): Promise<string[]> {
  const pool = getAgentsPool();
  const seenFiles = new Set<string>();
  const approvalIds: string[] = [];
  for (const p of patches) {
    if (approvalIds.length >= MAX_PATCHES) break;
    if (seenFiles.has(p.file)) continue;
    if (!validatePatch(p).ok) continue;
    if (await isSuppressed(pool, diffHash(p.diff))) continue;
    seenFiles.add(p.file);
    const out = (await PROPOSE_TOOLS.propose_self_model_patch?.execute?.(
      { file: p.file, diff: p.diff, rationale: p.rationale, evidence: p.evidence },
      { toolCallId: runId, messages: [], context: undefined },
    )) as { approval_id: string } | undefined;
    if (out !== undefined) approvalIds.push(out.approval_id);
  }
  return approvalIds;
}
