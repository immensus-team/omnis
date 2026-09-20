// A3 §5의 부분 HNSW(`WHERE invalidated_at IS NULL`)를 타는 유일한 질의. WHERE 술어가
// 인덱스 조건과 어긋나면 플래너가 seq scan으로 떨어지고, 더 나쁘게는 무효화된 기억이 돌아온다.
import { query } from "@omnis/db";
import type { MemoryKind, MemorySourceKind } from "@omnis/protocol";
import type { Pool } from "pg";
import { MemoryEmbedError, embed, toVectorLiteral } from "./embed.js";

export interface MemoryHit {
  memory_id: string;
  content: string;
  score: number;
  recorded_at: string;
  valid_from: string;
  valid_until: string | null;
  source_item_id: string | null;
  source_kind: MemorySourceKind;
  source_ref: string | null;
}

interface HitRow {
  id: string;
  content: string;
  score: string;
  recorded_at: Date;
  valid_from: Date;
  valid_until: Date | null;
  source_item_id: string | null;
  source_kind: MemorySourceKind;
  source_ref: string | null;
}

const SQL = `
  SELECT id, content, 1 - (embedding <=> $1::vector) AS score,
         recorded_at, valid_from, valid_until, source_item_id, source_kind, source_ref
    FROM memories
   WHERE invalidated_at IS NULL
     AND embedding IS NOT NULL
     AND ($3::text[] IS NULL OR kind = ANY($3))
   ORDER BY embedding <=> $1::vector
   LIMIT $2`;

export async function searchMemories(
  pool: Pool,
  q: { query: string; k?: number; kinds?: MemoryKind[]; minScore?: number },
): Promise<MemoryHit[]> {
  const k = q.k ?? 10;
  const [vec] = await embed([q.query]);
  if (vec === null || vec === undefined) {
    // 조용히 빈 배열을 돌려주면 루프가 "기억이 없다"로 오해하고 근거 없는 초안을 쓴다.
    throw new MemoryEmbedError("query embedding failed — ollama unreachable");
  }
  // ponytail: kind 필터는 인덱스 스캔 뒤 필터라 k개를 못 채울 수 있다 — 필터가 있을 때만 4배로
  // 뽑고 잘라낸다. 수만 row가 되면 kind별 부분 인덱스로 승격한다.
  const limit = q.kinds === undefined ? k : k * 4;
  const rows = await query<HitRow>(pool, SQL, [toVectorLiteral(vec), limit, q.kinds ?? null]);

  const minScore = q.minScore ?? 0;
  return rows
    .map((r) => ({
      memory_id: r.id,
      content: r.content,
      score: Number(r.score),
      recorded_at: r.recorded_at.toISOString(),
      valid_from: r.valid_from.toISOString(),
      valid_until: r.valid_until === null ? null : r.valid_until.toISOString(),
      source_item_id: r.source_item_id,
      source_kind: r.source_kind,
      source_ref: r.source_ref,
    }))
    .filter((h) => h.score >= minScore)
    .slice(0, k);
}

// A4 §14.4: 통합 검색(US-B26, surfaces 계획 Task 1)이 memory hit의 snippet을 ≤160자로 자른다.
// items는 ts_headline이 있지만 memories는 없어서 절단만 한다. 소비자가 두 곳(hub search.ts,
// search_memory tool)이라 여기서 한 번만 정의한다 — hub 쪽에 복제하지 않는다.
export function truncateSnippet(text: string, max = 160): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}
