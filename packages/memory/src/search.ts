// A3 §5의 부분 HNSW(`WHERE invalidated_at IS NULL`)를 타는 유일한 질의. WHERE 술어가
// 인덱스 조건과 어긋나면 플래너가 seq scan으로 떨어지고, 더 나쁘게는 무효화된 기억이 돌아온다.
import { query } from "@omnis/db";
import type { MemoryKind, MemorySourceKind } from "@omnis/protocol";
import type { Pool } from "pg";
import { EMBED_QUERY_PREFIX, MemoryEmbedError, embed, toVectorLiteral } from "./embed.js";

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

// A4 §10.6: 벡터 단독은 한국어 짧은 질의에서 recall@10 0.78로 목표(0.80)를 못 넘는다 —
// nomic-embed-text-v1.5가 한국어 의미 유사도에서 약해 같은 "허브" 문서 몇 개가 거의 모든 질의의
// 상위를 먹는다. 그래서 pg_trgm 문자 트라이그램 거리(조사 변화에 강하다 — 0001의 확장을 그대로
// 쓴다)를 두 번째 후보 목록으로 두고 RRF(k=60, 표준값)로 섞는다. 실측 0.780 → 0.920.
// score는 여전히 코사인 유사도다 — minScore 소비자(assemble.ts)의 의미를 바꾸지 않는다.
const RRF_K = 60;

// ponytail: 렉시컬 가지는 `content <-> $4`라서 live memories를 seq scan한다. 수만 row가 되면
// `CREATE INDEX ... USING gist (content gist_trgm_ops)`로 KNN을 인덱스에 태운다.
const SQL = `
  WITH vec AS (
    SELECT id, row_number() OVER (ORDER BY d) AS rank FROM (
      SELECT id, embedding <=> $1::vector AS d
        FROM memories
       WHERE invalidated_at IS NULL AND embedding IS NOT NULL
         AND ($3::text[] IS NULL OR kind = ANY($3))
       ORDER BY embedding <=> $1::vector
       LIMIT $2) v
  ), lex AS (
    SELECT id, row_number() OVER (ORDER BY d) AS rank FROM (
      SELECT id, content <-> $4 AS d
        FROM memories
       WHERE invalidated_at IS NULL AND embedding IS NOT NULL
         AND ($3::text[] IS NULL OR kind = ANY($3))
         AND similarity(content, $4) > 0
       ORDER BY content <-> $4
       LIMIT $2) l
  ), fused AS (
    SELECT id, sum(1.0 / (${RRF_K} + rank)) AS rrf
      FROM (SELECT * FROM vec UNION ALL SELECT * FROM lex) u
     GROUP BY id
  )
  SELECT m.id, m.content, 1 - (m.embedding <=> $1::vector) AS score,
         m.recorded_at, m.valid_from, m.valid_until, m.source_item_id, m.source_kind, m.source_ref
    FROM fused f JOIN memories m ON m.id = f.id
   ORDER BY f.rrf DESC, m.embedding <=> $1::vector
   LIMIT $2`;

export async function searchMemories(
  pool: Pool,
  q: { query: string; k?: number; kinds?: MemoryKind[]; minScore?: number },
): Promise<MemoryHit[]> {
  const k = q.k ?? 10;
  const [vec] = await embed([EMBED_QUERY_PREFIX + q.query]);
  if (vec === null || vec === undefined) {
    // 조용히 빈 배열을 돌려주면 루프가 "기억이 없다"로 오해하고 근거 없는 초안을 쓴다.
    throw new MemoryEmbedError("query embedding failed — ollama unreachable");
  }
  // 두 가지 후보를 섞으려면 k개보다 깊게 떠야 RRF가 순위를 바꿀 수 있다. 가지마다 4k개.
  const rows = await query<HitRow>(pool, SQL, [
    toVectorLiteral(vec),
    k * 4,
    q.kinds ?? null,
    q.query,
  ]);

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
