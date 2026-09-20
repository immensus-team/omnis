import { createPool, query } from "@omnis/db";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { MemoryEmbedError } from "../../src/embed.js";
import { searchMemories } from "../../src/search.js";
import { invalidateBySource, upsertMemory } from "../../src/store.js";
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
  if (originalHost === undefined) Reflect.deleteProperty(process.env, "OLLAMA_HOST");
  else process.env.OLLAMA_HOST = originalHost;
  await pool.end();
});
afterEach(async () => {
  await query(pool, "DELETE FROM memories");
});

const base = {
  scope: "work",
  source_kind: "file",
  confidence: 0.8,
  valid_from: "2026-09-01T00:00:00.000Z",
} as const;

describe("searchMemories", () => {
  it("ranks the memory that shares words with the query first", async () => {
    await upsertMemory(pool, {
      ...base,
      kind: "fact",
      content: "Davich PoC proposal due September 23",
      source_ref: "/a.md",
    });
    await upsertMemory(pool, {
      ...base,
      kind: "fact",
      content: "Lunch menu is soup",
      source_ref: "/b.md",
    });

    const hits = await searchMemories(pool, { query: "Davich PoC proposal due", k: 2 });
    expect(hits).toHaveLength(2);
    expect(hits[0]?.content).toContain("Davich");
    expect(hits[0]?.score).toBeGreaterThan(hits[1]?.score ?? 1);
    expect(hits[0]?.source_kind).toBe("file");
    expect(hits[0]?.source_ref).toBe("/a.md");
    expect(hits[0]?.valid_from).toBe("2026-09-01T00:00:00.000Z");
    expect(hits[0]?.valid_until).toBeNull();
    expect(hits[0]?.source_item_id).toBeNull();
  });

  // Unless the same predicate as the partial HNSW's WHERE is used, invalidated memories come back.
  it("never returns invalidated memories", async () => {
    await upsertMemory(pool, {
      ...base,
      kind: "fact",
      content: "The old office address was downtown",
      source_ref: "/old.md",
    });
    await invalidateBySource(pool, "file", "/old.md");
    expect(
      await searchMemories(pool, { query: "The old office address was downtown", k: 5 }),
    ).toEqual([]);
  });

  it("never returns rows whose embedding is still NULL", async () => {
    process.env.OLLAMA_HOST = "127.0.0.1:1";
    await upsertMemory(pool, {
      ...base,
      kind: "fact",
      content: "Memory with no embedding",
      source_ref: "/n.md",
    });
    process.env.OLLAMA_HOST = ollama.host;
    expect(await searchMemories(pool, { query: "Memory with no embedding", k: 5 })).toEqual([]);
  });

  it("filters by kind and still fills k when enough rows match", async () => {
    await upsertMemory(pool, {
      ...base,
      kind: "preference",
      content: "Prefers morning meetings",
      source_ref: "/p1.md",
    });
    await upsertMemory(pool, {
      ...base,
      kind: "fact",
      content: "The meeting was at 10am",
      source_ref: "/f1.md",
    });

    const hits = await searchMemories(pool, {
      query: "morning meetings",
      k: 5,
      kinds: ["preference"],
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.content).toContain("Prefers");
  });

  it("drops hits below minScore", async () => {
    await upsertMemory(pool, {
      ...base,
      kind: "fact",
      content: "Completely unrelated bicycle repair",
      source_ref: "/x.md",
    });
    expect(
      await searchMemories(pool, { query: "Davich PoC deadline", k: 5, minScore: 0.5 }),
    ).toEqual([]);
  });

  // A4 §10.6: vectors alone cannot reach 0.80 recall on short queries. When the query word does
  // not match the document's word (poll vs polling) the embeddings come out near-orthogonal, but
  // the character trigrams still overlap — this checks that the branch really changes the ranking.
  // The 11 decoys share neither words nor trigrams with the query, so their cosines are all equal
  // (no shared tokens) and only the lexical branch can lift the target row to rank 1.
  it("lexical trigram branch outranks vector ties", async () => {
    await upsertMemory(pool, {
      ...base,
      kind: "fact",
      content: "Drive pulls changes by polling",
      source_ref: "/target.md",
    });
    for (let i = 0; i < 11; i += 1) {
      await upsertMemory(pool, {
        ...base,
        kind: "fact",
        content: `Bicycle repair log ${i}`,
        source_ref: `/d${i}.md`,
      });
    }

    const hits = await searchMemories(pool, { query: "how often does it poll", k: 5 });
    expect(hits[0]?.source_ref).toBe("/target.md");
  });

  it("defaults k to 10", async () => {
    for (let i = 0; i < 12; i += 1) {
      await upsertMemory(pool, {
        ...base,
        kind: "fact",
        content: `Meeting note ${i}`,
        source_ref: `/m${i}.md`,
      });
    }
    expect(await searchMemories(pool, { query: "Meeting note" })).toHaveLength(10);
  });

  // A failed query embedding is an error, not "no results" — silently building an empty context
  // would let the loop assume it has no memories.
  it("throws MemoryEmbedError when the query itself cannot be embedded", async () => {
    process.env.OLLAMA_HOST = "127.0.0.1:1";
    try {
      await expect(searchMemories(pool, { query: "anything" })).rejects.toThrow(MemoryEmbedError);
    } finally {
      process.env.OLLAMA_HOST = ollama.host;
    }
  });
});
