import { describe, expect, it } from "vitest";
import {
  CHUNK_MAX_TOKENS,
  CHUNK_MIN_TOKENS,
  chunkCalendarEvent,
  chunkCode,
  chunkDocument,
} from "../src/ingest/chunk.js";
import { estimateTokens } from "../src/tokens.js";

const para = (n: number): string => `${"가".repeat(n)}`;

describe("chunkDocument (A4 §10.3 문서)", () => {
  it("returns one chunk for a short document", () => {
    const chunks = chunkDocument("짧은 메모 한 줄.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.ord).toBe(0);
    expect(chunks[0]?.text).toContain("짧은 메모");
    expect(chunks[0]?.meta.strategy).toBe("document");
  });

  it("returns nothing for whitespace-only input", () => {
    expect(chunkDocument("   \n\n  ")).toEqual([]);
  });

  it("keeps every chunk under the 800-token ceiling", () => {
    const doc = Array.from({ length: 30 }, () => para(400)).join("\n\n");
    for (const c of chunkDocument(doc)) {
      expect(estimateTokens(c.text)).toBeLessThanOrEqual(CHUNK_MAX_TOKENS);
    }
  });

  it("splits on paragraph boundaries and numbers chunks in order", () => {
    const doc = Array.from({ length: 12 }, (_, i) => `문단${i}\n${para(300)}`).join("\n\n");
    const chunks = chunkDocument(doc);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.ord)).toEqual(chunks.map((_, i) => i));
  });

  it("overlaps consecutive chunks so a sentence on the seam survives", () => {
    const doc = Array.from({ length: 12 }, (_, i) => `문단${i}\n${para(300)}`).join("\n\n");
    const chunks = chunkDocument(doc);
    const first = chunks[0];
    const second = chunks[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    const tail = (first as { text: string }).text.slice(-40);
    expect((second as { text: string }).text).toContain(tail);
  });

  it("hard-splits a single paragraph that is bigger than the ceiling", () => {
    const chunks = chunkDocument(para(4000)); // 한 문단, 오버플로
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(estimateTokens(c.text)).toBeLessThanOrEqual(CHUNK_MAX_TOKENS);
  });

  it("stays under the ceiling when the document is thousands of tiny paragraphs", () => {
    // 조각마다 "\n\n"(0.5토큰)이 붙는다. 세지 않으면 조각이 많을 때 상한을 넘었다(850토큰).
    const doc = Array.from({ length: 1000 }, () => "abcd").join("\n\n");
    for (const c of chunkDocument(doc)) {
      expect(estimateTokens(c.text)).toBeLessThanOrEqual(CHUNK_MAX_TOKENS);
    }
  });

  it("leaves source_ref empty — the caller stamps it (델타 §3 시그니처)", () => {
    expect(chunkDocument("메모")[0]?.source_ref).toBe("");
  });
});

describe("chunkCode (A4 §10.3 코드)", () => {
  const ts = `import { a } from "./a.js";

export function first(): number {
  return 1;
}

export async function second(x: number): Promise<number> {
  return x + 1;
}

export class Third {
  run(): void {}
}
`;

  it("cuts at function and class boundaries, not at fixed line counts", () => {
    const chunks = chunkCode("/repo/src/a.ts", ts);
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    const texts = chunks.map((c) => c.text);
    expect(texts.some((t) => t.includes("export function first") && t.includes("return 1;"))).toBe(
      true,
    );
    expect(texts.some((t) => t.startsWith("export async function second"))).toBe(true);
    expect(texts.some((t) => t.startsWith("export class Third"))).toBe(true);
  });

  it("never splits a function across two chunks", () => {
    for (const c of chunkCode("/repo/src/a.ts", ts)) {
      const opens = (c.text.match(/\{/g) ?? []).length;
      const closes = (c.text.match(/\}/g) ?? []).length;
      expect(opens).toBe(closes);
    }
  });

  it("recognises python def and class boundaries", () => {
    const py =
      "import os\n\ndef alpha():\n    return 1\n\nclass Beta:\n    def run(self):\n        pass\n";
    const chunks = chunkCode("/repo/x.py", py);
    expect(chunks.some((c) => c.text.includes("def alpha"))).toBe(true);
    expect(chunks.some((c) => c.text.includes("class Beta"))).toBe(true);
  });

  it("falls back to document chunking when no boundary is found", () => {
    const chunks = chunkCode("/repo/data.txt", para(3000));
    expect(chunks[0]?.meta.strategy).toBe("document");
  });

  it("stamps the path as source_ref and marks the strategy", () => {
    const c = chunkCode("/repo/src/a.ts", ts)[0];
    expect(c?.source_ref).toBe("/repo/src/a.ts");
    expect(c?.meta.strategy).toBe("code");
    expect(c?.meta.language).toBe("ts");
  });

  it("merges tiny adjacent units up to the ceiling instead of emitting one-liner chunks", () => {
    const many = Array.from({ length: 40 }, (_, i) => `export function f${i}(): void {}`).join(
      "\n\n",
    );
    const chunks = chunkCode("/repo/src/many.ts", many);
    expect(chunks.length).toBeLessThan(40);
    for (const c of chunks) expect(estimateTokens(c.text)).toBeLessThanOrEqual(CHUNK_MAX_TOKENS);
  });

  it("keeps merged one-liner chunks under the ceiling once they fill it (배럴 파일)", () => {
    // 40개는 한 청크(320토큰)로 접혀 상한을 못 건드린다. 200개는 상한까지 채우므로
    // "\n\n" 구분자를 안 세면 넘친다(825토큰이었다).
    const many = Array.from({ length: 200 }, (_, i) => `export function f${i}(): void {}`).join(
      "\n\n",
    );
    const chunks = chunkCode("/repo/src/barrel.ts", many);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(estimateTokens(c.text)).toBeLessThanOrEqual(CHUNK_MAX_TOKENS);
  });
});

describe("chunkCalendarEvent (A4 §10.3 캘린더)", () => {
  it("makes exactly one chunk carrying the times, title and attendees", () => {
    const c = chunkCalendarEvent({
      external_id: "evt-1",
      title: "다비치 PoC 킥오프",
      start_at: "2026-09-23T01:00:00.000Z",
      end_at: "2026-09-23T02:00:00.000Z",
      location: "강남 본사",
      attendees: ["a@corp.com", "b@corp.com"],
      description: "기획서 리뷰",
    });
    expect(c.ord).toBe(0);
    expect(c.source_ref).toBe("evt-1");
    expect(c.meta.strategy).toBe("calendar");
    expect(c.text).toContain("다비치 PoC 킥오프");
    expect(c.text).toContain("2026-09-23T01:00:00.000Z");
    expect(c.text).toContain("a@corp.com");
    expect(c.text).toContain("강남 본사");
  });

  it("is well under the minimum chunk size — calendar events are already short", () => {
    const c = chunkCalendarEvent({
      external_id: "evt-2",
      title: "점심",
      start_at: "2026-09-23T03:00:00.000Z",
      end_at: "2026-09-23T04:00:00.000Z",
      location: null,
      attendees: [],
      description: null,
    });
    expect(estimateTokens(c.text)).toBeLessThan(CHUNK_MIN_TOKENS);
  });
});
