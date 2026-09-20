// B-D1: public.memories는 이 파일이 소유한다. A3 §5 DDL(0005_memory.sql)이 정본이고
// 여기서는 그 컬럼만 쓴다 — 스키마를 바꾸지 않는다.
import { one, query } from "@omnis/db";
import type { MemoryKind, MemorySourceKind, Scope } from "@omnis/protocol";
import type { Pool } from "pg";
import { embed, toVectorLiteral } from "./embed.js";

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
  valid_from: string; // 4-timestamp (A3 §5) — recorded_at/invalidated_at은 DB가 쥔다
  valid_until?: string;
}

export interface MemoryRow extends MemoryInput {
  id: string;
  recorded_at: string;
  invalidated_at: string | null;
  superseded_by: string | null;
}

/** 같은 소스의 같은 문장이 두 번 들어오면 새 row를 만들지 않는다 — 재스캔이 memories를
 *  배로 불리는 것을 막는 유일한 문이다. `source_ref`가 NULL인 소스(inbox 등)도 같은 규칙. */
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

  const [vec] = await embed([m.content]);
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

/** A3 §11 / A4 §10.4: 파일이 사라지거나 Drive tombstone이 오면 **지우지 않고** 무효화한다.
 *  부분 HNSW(`WHERE invalidated_at IS NULL`)가 자동으로 검색에서 뺀다. */
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

/** 모순되는 사실이 들어왔을 때 옛 row를 새 row로 잇는다(A4 §10.4 표의 invalidated_at 행). */
export async function supersede(pool: Pool, oldId: string, newId: string): Promise<void> {
  await query(
    pool,
    `UPDATE memories
        SET superseded_by = $2, invalidated_at = COALESCE(invalidated_at, now())
      WHERE id = $1`,
    [oldId, newId],
  );
}

/** A4 §10.5 임베딩 실패 행: 다음 폴링 주기에 NULL인 것만 다시 임베딩한다. */
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

  const vecs = await embed(rows.map((r) => r.content));
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
