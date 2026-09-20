import { createPool, one, query } from "@omnis/db";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let pool: Pool;
beforeAll(() => {
  pool = createPool();
});
afterAll(async () => {
  await pool.end();
});

// ponytail: NOT a zero vector — pgvector cosine distance (<=>) to/from an all-zero
// vector is NaN (undefined direction), and HNSW's graph search silently drops
// NaN-distance candidates, so `ORDER BY embedding <=> zero LIMIT 1` returns 0 rows
// even though a seq scan would find it. A unit vector keeps the same test intent
// (nearest-neighbor lookup against a known query vector) without the degenerate case.
const unit768 = `[${["1", ...new Array(767).fill(0)].join(",")}]`;

describe("0005_memory", () => {
  it("keeps one live entity per (type, lower(name)) but allows invalidated duplicates", async () => {
    await query(pool, `INSERT INTO entities (type, name) VALUES ('org','Onward Lab')`);
    await expect(
      query(pool, `INSERT INTO entities (type, name) VALUES ('org','onward lab')`),
    ).rejects.toThrow(/entities_live_uq/);

    await query(
      pool,
      `UPDATE entities SET invalidated_at = now() WHERE lower(name) = 'onward lab'`,
    );
    await query(pool, `INSERT INTO entities (type, name) VALUES ('org','Onward Lab')`);
    const live = await one<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM entities WHERE lower(name)='onward lab' AND invalidated_at IS NULL`,
    );
    expect(live.n).toBe("1");
  });

  it("stores bi-temporal relations with all four timestamps", async () => {
    const from = await one<{ id: string }>(
      pool,
      `INSERT INTO entities (type, name) VALUES ('person','Jane Doe') RETURNING id`,
    );
    const to = await one<{ id: string }>(
      pool,
      `INSERT INTO entities (type, name) VALUES ('org','Acme') RETURNING id`,
    );
    const rel = await one<{
      valid_from: Date;
      valid_until: Date | null;
      recorded_at: Date;
      invalidated_at: Date | null;
    }>(
      pool,
      `INSERT INTO relations (from_entity_id, to_entity_id, type, valid_from)
       VALUES ($1,$2,'works_at', now() - interval '1 year')
       RETURNING valid_from, valid_until, recorded_at, invalidated_at`,
      [from.id, to.id],
    );
    expect(rel.valid_until).toBeNull();
    expect(rel.invalidated_at).toBeNull();
    expect(rel.recorded_at.getTime()).toBeGreaterThan(rel.valid_from.getTime());
  });

  it("indexes only live memories with HNSW cosine", async () => {
    const idx = await one<{ indexdef: string }>(
      pool,
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'memories_embedding_idx'`,
    );
    expect(idx.indexdef).toContain("hnsw");
    expect(idx.indexdef).toContain("WHERE (invalidated_at IS NULL)");

    await query(
      pool,
      `INSERT INTO memories (content, embedding, kind) VALUES ('logan prefers 한국어', $1::vector, 'preference')`,
      [unit768],
    );
    // ponytail: 통합 테스트는 omnis_test 한 DB를 공유하고, 앞서 돈 파일들이 memories에
    // 수백 건을 넣었다 지운다. HNSW는 죽은 원소를 그래프에 남겨 두므로 ef_search(기본 40)가
    // 죽은 원소만 훑고 끝나 살아 있는 행 하나를 못 찾는 일이 생긴다(스캔이 0행을 돌려준다).
    // VACUUM으로 죽은 인덱스 엔트리를 걷어내고 재면 앞 파일이 뭘 했든 결과가 같다.
    await query(pool, "VACUUM memories");
    const hit = await query<{ content: string }>(
      pool,
      "SELECT content FROM memories WHERE invalidated_at IS NULL ORDER BY embedding <=> $1::vector LIMIT 1",
      [unit768],
    );
    expect(hit[0]?.content).toContain("한국어");

    await expect(
      query(pool, `INSERT INTO memories (content, kind) VALUES ('x','rumor')`),
    ).rejects.toThrow(/memories_kind_ck/);
  });
});
