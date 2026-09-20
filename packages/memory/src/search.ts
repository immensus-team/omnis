// The only query that rides A3 §5's partial HNSW (`WHERE invalidated_at IS NULL`). If the WHERE
// predicate drifts from the index condition, the planner falls back to a seq scan — and worse,
// invalidated memories come back.
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

// A4 §10.6: vectors alone give recall@10 0.78 on short Korean queries, short of the 0.80 target —
// nomic-embed-text-v1.5 is weak on Korean semantic similarity, so a few of the same "hub" documents
// eat the top of nearly every query. So we keep pg_trgm character-trigram distance (robust to
// particle changes — reusing 0001's extension as-is) as a second candidate list and fuse with
// RRF (k=60, the standard value). Measured 0.780 → 0.920. score is still cosine similarity — this
// does not change the meaning of minScore for its consumer (assemble.ts).
const RRF_K = 60;

// ponytail: the lexical branch uses `content <-> $4`, so it seq scans live memories. Once there
// are tens of thousands of rows, put the KNN on an index with
// `CREATE INDEX ... USING gist (content gist_trgm_ops)`.
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
    // Silently returning an empty array makes the loop mistake it for "no memories" and write an
    // unsupported draft.
    throw new MemoryEmbedError("query embedding failed — ollama unreachable");
  }
  // Fusing two candidate lists requires fetching deeper than k for RRF to reorder anything. 4k per branch.
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

// A4 §14.4: unified search (US-B26, surfaces plan Task 1) truncates a memory hit's snippet to
// ≤160 characters. items have ts_headline but memories do not, so this only truncates. Two
// consumers (hub search.ts, the search_memory tool), so it is defined once here — not duplicated
// on the hub side.
export function truncateSnippet(text: string, max = 160): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}
