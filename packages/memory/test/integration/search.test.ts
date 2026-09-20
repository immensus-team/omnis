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
      content: "다비치 PoC 기획서 마감 9월 23일",
      source_ref: "/a.md",
    });
    await upsertMemory(pool, {
      ...base,
      kind: "fact",
      content: "점심 메뉴는 김치찌개",
      source_ref: "/b.md",
    });

    const hits = await searchMemories(pool, { query: "다비치 PoC 기획서 마감", k: 2 });
    expect(hits).toHaveLength(2);
    expect(hits[0]?.content).toContain("다비치");
    expect(hits[0]?.score).toBeGreaterThan(hits[1]?.score ?? 1);
    expect(hits[0]?.source_kind).toBe("file");
    expect(hits[0]?.source_ref).toBe("/a.md");
    expect(hits[0]?.valid_from).toBe("2026-09-01T00:00:00.000Z");
    expect(hits[0]?.valid_until).toBeNull();
    expect(hits[0]?.source_item_id).toBeNull();
  });

  // 부분 HNSW의 WHERE와 같은 술어를 쓰지 않으면 무효화된 기억이 되살아난다.
  it("never returns invalidated memories", async () => {
    await upsertMemory(pool, {
      ...base,
      kind: "fact",
      content: "옛 사무실 주소는 강남",
      source_ref: "/old.md",
    });
    await invalidateBySource(pool, "file", "/old.md");
    expect(await searchMemories(pool, { query: "옛 사무실 주소는 강남", k: 5 })).toEqual([]);
  });

  it("never returns rows whose embedding is still NULL", async () => {
    process.env.OLLAMA_HOST = "127.0.0.1:1";
    await upsertMemory(pool, {
      ...base,
      kind: "fact",
      content: "임베딩 없는 기억",
      source_ref: "/n.md",
    });
    process.env.OLLAMA_HOST = ollama.host;
    expect(await searchMemories(pool, { query: "임베딩 없는 기억", k: 5 })).toEqual([]);
  });

  it("filters by kind and still fills k when enough rows match", async () => {
    await upsertMemory(pool, {
      ...base,
      kind: "preference",
      content: "회의는 오전을 선호한다",
      source_ref: "/p1.md",
    });
    await upsertMemory(pool, {
      ...base,
      kind: "fact",
      content: "회의는 오전 10시에 있었다",
      source_ref: "/f1.md",
    });

    const hits = await searchMemories(pool, { query: "회의는 오전", k: 5, kinds: ["preference"] });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.content).toContain("선호");
  });

  it("drops hits below minScore", async () => {
    await upsertMemory(pool, {
      ...base,
      kind: "fact",
      content: "전혀 다른 이야기 자전거 정비",
      source_ref: "/x.md",
    });
    expect(await searchMemories(pool, { query: "다비치 PoC 마감", k: 5, minScore: 0.5 })).toEqual(
      [],
    );
  });

  it("defaults k to 10", async () => {
    for (let i = 0; i < 12; i += 1) {
      await upsertMemory(pool, {
        ...base,
        kind: "fact",
        content: `회의 기록 ${i}`,
        source_ref: `/m${i}.md`,
      });
    }
    expect(await searchMemories(pool, { query: "회의 기록" })).toHaveLength(10);
  });

  // 질의 임베딩이 실패하면 "결과 없음"이 아니라 에러다 — 조용히 빈 컨텍스트를 만들면 안 된다.
  it("throws MemoryEmbedError when the query itself cannot be embedded", async () => {
    process.env.OLLAMA_HOST = "127.0.0.1:1";
    try {
      await expect(searchMemories(pool, { query: "아무거나" })).rejects.toThrow(MemoryEmbedError);
    } finally {
      process.env.OLLAMA_HOST = ollama.host;
    }
  });
});
