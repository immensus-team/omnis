// A3 §5 Graphiti 4-timestamp. There is one rule: facts are never edited, they are superseded.
// valid_from/valid_until = the fact's own time, recorded_at/invalidated_at = when the system learned it.
import { one, query, tx } from "@omnis/db";
import type { PoolClient } from "@omnis/db";
import type { Pool } from "pg";

export type EntityType = "person" | "org" | "project" | "commitment" | "decision" | "topic";

export interface EntityInput {
  type: EntityType;
  name: string;
  person_id?: string;
  attributes?: Record<string, unknown>;
  valid_from: string; // required — the type blocks any write path that skips the 4-timestamp
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

/** The type alone cannot block an empty string — this closes the path by which a value the
 *  extractor failed to fill would reach here. */
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

/** On a live-unique collision (`entities (type, lower(name)) WHERE invalidated_at IS NULL`),
 *  invalidate the existing row and insert a new one — both in the same transaction, or the
 *  unique index fires. */
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

/** relations has no live-unique index (A3 §5). Find the live row for the same (from,to,type) by
 *  hand and apply the same rule — if the two diverge, as-of queries would see them differently. */
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

/** Relations attached to a dead entity die with it — otherwise as-of would return edges pointing
 *  at an entity that does not exist. */
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

/** A3 §5's three-condition query. 'now' means server time — the caller does not bring its own clock. */
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
