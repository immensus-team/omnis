// A3 §5 Graphiti 4-timestamp. 규칙은 하나다: 사실은 수정되지 않고 대체된다.
// valid_from/valid_until = 사실의 시간, recorded_at/invalidated_at = 시스템이 안 시간.
import { one, query, tx } from "@omnis/db";
import type { PoolClient } from "@omnis/db";
import type { Pool } from "pg";

export type EntityType = "person" | "org" | "project" | "commitment" | "decision" | "topic";

export interface EntityInput {
  type: EntityType;
  name: string;
  person_id?: string;
  attributes?: Record<string, unknown>;
  valid_from: string; // 필수 — 4-timestamp를 안 채우는 쓰기 경로를 타입으로 막는다
  valid_until?: string;
}

export interface EntityRow extends EntityInput {
  id: string;
  recorded_at: string;
  invalidated_at: string | null;
}

interface RawEntity {
  id: string;
  type: EntityType;
  name: string;
  person_id: string | null;
  attributes: Record<string, unknown>;
  valid_from: Date;
  valid_until: Date | null;
  recorded_at: Date;
  invalidated_at: Date | null;
}

function toRow(r: RawEntity): EntityRow {
  return {
    id: r.id,
    type: r.type,
    name: r.name,
    ...(r.person_id === null ? {} : { person_id: r.person_id }),
    attributes: r.attributes,
    valid_from: r.valid_from.toISOString(),
    ...(r.valid_until === null ? {} : { valid_until: r.valid_until.toISOString() }),
    recorded_at: r.recorded_at.toISOString(),
    invalidated_at: r.invalidated_at === null ? null : r.invalidated_at.toISOString(),
  };
}

/** 타입만으로는 빈 문자열을 못 막는다 — 추출기가 채우지 못한 값이 여기까지 오는 길목을 닫는다. */
function assertValidFrom(v: string, what: string): void {
  if (v === "" || Number.isNaN(Date.parse(v))) {
    throw new TypeError(
      `${what}.valid_from must be an ISO timestamp (A3 §5 4-timestamp), got: ${v}`,
    );
  }
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
}

/** live 유니크(`entities (type, lower(name)) WHERE invalidated_at IS NULL`) 충돌 시
 *  기존 row를 무효화하고 새 row를 넣는다 — 같은 트랜잭션이어야 유니크 위반이 안 난다. */
export async function upsertEntity(pool: Pool, e: EntityInput): Promise<string> {
  assertValidFrom(e.valid_from, "EntityInput");
  return tx(pool, async (c) => {
    const live = await query<RawEntity>(
      c,
      `SELECT * FROM entities
        WHERE type = $1 AND lower(name) = lower($2) AND invalidated_at IS NULL
        LIMIT 1`,
      [e.type, e.name],
    );
    const prev = live[0];
    if (prev !== undefined) {
      const unchanged =
        sameJson(prev.attributes, e.attributes) &&
        prev.valid_from.toISOString() === e.valid_from &&
        (prev.valid_until?.toISOString() ?? null) === (e.valid_until ?? null) &&
        prev.person_id === (e.person_id ?? null);
      if (unchanged) return prev.id;
      await query(c, "UPDATE entities SET invalidated_at = now() WHERE id = $1", [prev.id]);
    }
    return insertEntity(c, e);
  });
}

async function insertEntity(c: PoolClient, e: EntityInput): Promise<string> {
  const row = await one<{ id: string }>(
    c,
    `INSERT INTO entities (type, name, person_id, attributes, valid_from, valid_until)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6) RETURNING id`,
    [
      e.type,
      e.name,
      e.person_id ?? null,
      JSON.stringify(e.attributes ?? {}),
      e.valid_from,
      e.valid_until ?? null,
    ],
  );
  return row.id;
}

export interface RelationInput {
  from_entity_id: string;
  to_entity_id: string;
  type: string;
  attributes?: Record<string, unknown>;
  source_item_id?: string;
  confidence?: number;
  valid_from: string;
  valid_until?: string;
}

/** relations에는 live 유니크 인덱스가 없다(A3 §5). 같은 (from,to,type)의 live row를 손으로
 *  찾아 같은 규칙을 적용한다 — 엔티티와 동작이 갈리면 as-of 질의가 둘을 다르게 본다. */
export async function assertRelation(pool: Pool, r: RelationInput): Promise<string> {
  assertValidFrom(r.valid_from, "RelationInput");
  return tx(pool, async (c) => {
    const live = await query<{
      id: string;
      attributes: Record<string, unknown>;
      valid_from: Date;
      valid_until: Date | null;
    }>(
      c,
      `SELECT id, attributes, valid_from, valid_until FROM relations
        WHERE from_entity_id = $1 AND to_entity_id = $2 AND type = $3 AND invalidated_at IS NULL
        LIMIT 1`,
      [r.from_entity_id, r.to_entity_id, r.type],
    );
    const prev = live[0];
    if (prev !== undefined) {
      const unchanged =
        sameJson(prev.attributes, r.attributes) &&
        prev.valid_from.toISOString() === r.valid_from &&
        (prev.valid_until?.toISOString() ?? null) === (r.valid_until ?? null);
      if (unchanged) return prev.id;
      await query(c, "UPDATE relations SET invalidated_at = now() WHERE id = $1", [prev.id]);
    }
    const row = await one<{ id: string }>(
      c,
      `INSERT INTO relations (from_entity_id, to_entity_id, type, attributes, source_item_id,
                              confidence, valid_from, valid_until)
         VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8) RETURNING id`,
      [
        r.from_entity_id,
        r.to_entity_id,
        r.type,
        JSON.stringify(r.attributes ?? {}),
        r.source_item_id ?? null,
        r.confidence ?? 0.5,
        r.valid_from,
        r.valid_until ?? null,
      ],
    );
    return row.id;
  });
}

/** 죽은 엔티티에 붙은 관계는 같이 죽는다 — 안 그러면 as-of가 존재하지 않는 엔티티로 가는
 *  간선을 돌려준다. */
export async function invalidateEntity(
  pool: Pool,
  id: string,
  at: Date = new Date(),
): Promise<void> {
  await tx(pool, async (c) => {
    await query(
      c,
      "UPDATE entities SET invalidated_at = $2 WHERE id = $1 AND invalidated_at IS NULL",
      [id, at],
    );
    await query(
      c,
      `UPDATE relations SET invalidated_at = $2
        WHERE (from_entity_id = $1 OR to_entity_id = $1) AND invalidated_at IS NULL`,
      [id, at],
    );
  });
}

const AS_OF_SQL = `
  SELECT * FROM entities
   WHERE ($1::uuid IS NULL OR id = $1)
     AND ($2::uuid IS NULL OR person_id = $2)
     AND valid_from <= $3
     AND (valid_until IS NULL OR valid_until > $3)
     AND (invalidated_at IS NULL OR invalidated_at > $3)
   ORDER BY valid_from DESC`;

/** A3 §5의 3조건 질의. 'now'는 서버 시각이다 — 호출자가 시계를 들고 오지 않는다. */
export async function asOf(
  pool: Pool,
  q: { entityId?: string; personId?: string; at: "now" | string },
): Promise<EntityRow[]> {
  const at = q.at === "now" ? new Date() : new Date(q.at);
  const rows = await query<RawEntity>(pool, AS_OF_SQL, [
    q.entityId ?? null,
    q.personId ?? null,
    at,
  ]);
  return rows.map(toRow);
}
