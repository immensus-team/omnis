// B-D1: this file owns public.memories. The A3 §5 DDL (0005_memory.sql) is the source of truth
// and only its columns are used here — no schema changes.
import { one, query } from "@omnis/db";
import type { MemoryKind, MemorySourceKind, Scope } from "@omnis/protocol";
import type { Pool } from "pg";
import { EMBED_DOCUMENT_PREFIX, embed, toVectorLiteral } from "./embed.js";

export interface MemoryInput {
  content: string;
  kind: MemoryKind;
  scope: Scope;
  source_kind: MemorySourceKind;
  source_ref?: string;
  source_item_id?: string;
  person_id?: string;
  entity_id?: string;
  confidence: number;
  valid_from: string; // 4-timestamp (A3 §5) — recorded_at/invalidated_at are held by the DB
  valid_until?: string;
}

export interface MemoryRow extends MemoryInput {
  id: string;
  recorded_at: string;
  invalidated_at: string | null;
  superseded_by: string | null;
}

/** The same sentence from the same source arriving twice creates no new row — the only gate that
 *  keeps a rescan from blowing memories up exponentially. Same rule for sources whose `source_ref`
 *  is NULL (inbox, etc.). */
export async function upsertMemory(pool: Pool, m: MemoryInput): Promise<string> {
  const existing = await query<{ id: string }>(
    pool,
    `SELECT id FROM memories
      WHERE source_kind = $1
        AND source_ref IS NOT DISTINCT FROM $2
        AND content = $3
        AND invalidated_at IS NULL
      LIMIT 1`,
    [m.source_kind, m.source_ref ?? null, m.content],
  );
  const hit = existing[0];
  if (hit !== undefined) return hit.id;

  const [vec] = await embed([EMBED_DOCUMENT_PREFIX + m.content]);
  const row = await one<{ id: string }>(
    pool,
    `INSERT INTO memories (content, embedding, kind, scope, source_kind, source_ref,
                           source_item_id, person_id, entity_id, confidence, valid_from, valid_until)
       VALUES ($1, $2::vector, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
    [
      m.content,
      vec === null || vec === undefined ? null : toVectorLiteral(vec),
      m.kind,
      m.scope,
      m.source_kind,
      m.source_ref ?? null,
      m.source_item_id ?? null,
      m.person_id ?? null,
      m.entity_id ?? null,
      m.confidence,
      m.valid_from,
      m.valid_until ?? null,
    ],
  );
  return row.id;
}

/** A3 §11 / A4 §10.4: when a file disappears or a Drive tombstone arrives, the memory is
 *  **invalidated rather than deleted**. The partial HNSW (`WHERE invalidated_at IS NULL`) drops it
 *  from search automatically. */
export async function invalidateBySource(
  pool: Pool,
  source_kind: MemorySourceKind,
  source_ref: string,
  at: Date = new Date(),
): Promise<number> {
  const rows = await query<{ id: string }>(
    pool,
    `UPDATE memories SET invalidated_at = $3
      WHERE source_kind = $1 AND source_ref = $2 AND invalidated_at IS NULL
      RETURNING id`,
    [source_kind, source_ref, at],
  );
  return rows.length;
}

/** Links the old row to the new one when a contradicting fact arrives (the invalidated_at row of
 *  the A4 §10.4 table). */
export async function supersede(pool: Pool, oldId: string, newId: string): Promise<void> {
  await query(
    pool,
    `UPDATE memories
        SET superseded_by = $2, invalidated_at = COALESCE(invalidated_at, now())
      WHERE id = $1`,
    [oldId, newId],
  );
}

/** A4 §10.5 embedding-failure row: on the next polling cycle, re-embed only the NULL ones. */
export async function reembedNulls(pool: Pool, limit = 100): Promise<number> {
  const rows = await query<{ id: string; content: string }>(
    pool,
    `SELECT id, content FROM memories
      WHERE embedding IS NULL AND invalidated_at IS NULL
      ORDER BY recorded_at
      LIMIT $1`,
    [limit],
  );
  if (rows.length === 0) return 0;

  const vecs = await embed(rows.map((r) => EMBED_DOCUMENT_PREFIX + r.content));
  let filled = 0;
  for (const [i, r] of rows.entries()) {
    const v = vecs[i];
    if (v === null || v === undefined) continue;
    await query(pool, "UPDATE memories SET embedding = $2::vector WHERE id = $1", [
      r.id,
      toVectorLiteral(v),
    ]);
    filled += 1;
  }
  return filled;
}
