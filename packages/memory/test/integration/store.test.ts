import { createPool, one, query } from "@omnis/db";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { invalidateBySource, reembedNulls, supersede, upsertMemory } from "../../src/store.js";
import { type FakeOllama, startFakeOllama } from "../helpers/fake-ollama.js";

let pool: Pool;
let ollama: FakeOllama;
const originalHost = process.env.OLLAMA_HOST;

beforeAll(async () => {
  pool = createPool();
  ollama = await startFakeOllama();
  process.env.OLLAMA_HOST = ollama.host;
});
afterAll(async () => {
  await ollama.close();
  // Avoids biome lint/performance/noDelete while really deleting the key (= does not leave the
  // string "undefined" behind).
  if (originalHost === undefined) Reflect.deleteProperty(process.env, "OLLAMA_HOST");
  else process.env.OLLAMA_HOST = originalHost;
  await pool.end();
});
afterEach(async () => {
  await query(pool, "DELETE FROM memories");
});

const base = {
  kind: "fact",
  scope: "work",
  source_kind: "file",
  confidence: 0.7,
  valid_from: "2026-09-01T00:00:00.000Z",
} as const;

describe("upsertMemory", () => {
  it("writes content, the 768d embedding and all four timestamps", async () => {
    const id = await upsertMemory(pool, {
      ...base,
      content: "The Davich PoC proposal is due September 23",
      source_ref: "/Users/logan/notes/davich.md",
    });
    const row = await one<{
      content: string;
      embedding: string | null;
      kind: string;
      scope: string;
      source_kind: string;
      source_ref: string;
      valid_from: Date;
      valid_until: Date | null;
      recorded_at: Date;
      invalidated_at: Date | null;
      superseded_by: string | null;
    }>(pool, "SELECT * FROM memories WHERE id = $1", [id]);

    expect(row.content).toContain("Davich");
    expect(row.embedding).toMatch(/^\[-?\d/); // pgvector literal
    expect(row.kind).toBe("fact");
    expect(row.source_ref).toBe("/Users/logan/notes/davich.md");
    expect(row.valid_from.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(row.valid_until).toBeNull();
    expect(row.recorded_at).toBeInstanceOf(Date);
    expect(row.invalidated_at).toBeNull();
    expect(row.superseded_by).toBeNull();
  });

  // A rescan that reads the same file again must not double the memories.
  it("returns the existing live id for the same (source_kind, source_ref, content)", async () => {
    const m = { ...base, content: "the same sentence", source_ref: "/a.md" } as const;
    const first = await upsertMemory(pool, m);
    const second = await upsertMemory(pool, m);
    expect(second).toBe(first);
    expect(await query(pool, "SELECT id FROM memories")).toHaveLength(1);
  });

  it("stores embedding = NULL when ollama is unreachable, and keeps the row", async () => {
    process.env.OLLAMA_HOST = "127.0.0.1:1";
    try {
      const id = await upsertMemory(pool, {
        ...base,
        content: "saved while offline",
        source_ref: "/b.md",
      });
      const row = await one<{ embedding: string | null }>(
        pool,
        "SELECT embedding FROM memories WHERE id = $1",
        [id],
      );
      expect(row.embedding).toBeNull();
    } finally {
      process.env.OLLAMA_HOST = ollama.host;
    }
  });
});

describe("invalidateBySource", () => {
  it("sets invalidated_at on every live row of that source and deletes nothing", async () => {
    await upsertMemory(pool, { ...base, content: "chunk 1", source_ref: "/gone.md" });
    await upsertMemory(pool, { ...base, content: "chunk 2", source_ref: "/gone.md" });
    await upsertMemory(pool, { ...base, content: "stays live", source_ref: "/stay.md" });

    const n = await invalidateBySource(pool, "file", "/gone.md", new Date("2026-09-20T00:00:00Z"));
    expect(n).toBe(2);
    expect(await query(pool, "SELECT id FROM memories")).toHaveLength(3); // does not delete
    const live = await query<{ source_ref: string }>(
      pool,
      "SELECT source_ref FROM memories WHERE invalidated_at IS NULL",
    );
    expect(live.map((r) => r.source_ref)).toEqual(["/stay.md"]);
  });

  it("is a no-op the second time (already invalidated rows are not counted again)", async () => {
    await upsertMemory(pool, { ...base, content: "x", source_ref: "/gone.md" });
    expect(await invalidateBySource(pool, "file", "/gone.md")).toBe(1);
    expect(await invalidateBySource(pool, "file", "/gone.md")).toBe(0);
  });
});

describe("supersede", () => {
  it("links the old row to the new one and invalidates it", async () => {
    const oldId = await upsertMemory(pool, {
      ...base,
      content: "title: team lead",
      source_ref: "/p.md",
    });
    const newId = await upsertMemory(pool, {
      ...base,
      content: "title: director",
      source_ref: "/p.md",
    });
    await supersede(pool, oldId, newId);
    const row = await one<{ superseded_by: string; invalidated_at: Date | null }>(
      pool,
      "SELECT superseded_by, invalidated_at FROM memories WHERE id = $1",
      [oldId],
    );
    expect(row.superseded_by).toBe(newId);
    expect(row.invalidated_at).toBeInstanceOf(Date);
  });
});

describe("reembedNulls", () => {
  it("fills in embeddings that an earlier ollama outage left NULL", async () => {
    process.env.OLLAMA_HOST = "127.0.0.1:1";
    await upsertMemory(pool, { ...base, content: "embedded later", source_ref: "/late.md" });
    process.env.OLLAMA_HOST = ollama.host;

    expect(await reembedNulls(pool, 10)).toBe(1);
    const row = await one<{ embedding: string | null }>(
      pool,
      "SELECT embedding FROM memories WHERE source_ref = '/late.md'",
    );
    expect(row.embedding).toMatch(/^\[-?\d/);
    expect(await reembedNulls(pool, 10)).toBe(0);
  });

  it("never touches invalidated rows", async () => {
    process.env.OLLAMA_HOST = "127.0.0.1:1";
    await upsertMemory(pool, { ...base, content: "dead memory", source_ref: "/dead.md" });
    process.env.OLLAMA_HOST = ollama.host;
    await invalidateBySource(pool, "file", "/dead.md");
    expect(await reembedNulls(pool, 10)).toBe(0);
  });
});
