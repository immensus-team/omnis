import { describe, expect, it } from "vitest";
import { EXTRACT_BUDGET, parseExtractOutput } from "../src/ingest/extract.js";

describe("parseExtractOutput", () => {
  it("keeps well-formed memories, entities and relations", () => {
    const out = parseExtractOutput({
      memories: [
        {
          content: "the deadline is September 23",
          kind: "fact",
          confidence: 0.8,
          valid_from: "2026-09-20T00:00:00.000Z",
        },
      ],
      entities: [
        {
          type: "project",
          name: "Davichi PoC",
          attributes: { owner: "logan" },
          valid_from: "2026-09-20T00:00:00.000Z",
        },
      ],
      relations: [
        {
          from: "Davichi PoC",
          to: "Onward Lab",
          type: "owned_by",
          confidence: 0.6,
          valid_from: "2026-09-20T00:00:00.000Z",
        },
      ],
    });
    expect(out.memories).toHaveLength(1);
    expect(out.entities[0]?.type).toBe("project");
    expect(out.relations[0]?.type).toBe("owned_by");
  });

  it("drops memories with an unknown kind instead of failing the whole chunk", () => {
    const out = parseExtractOutput({
      memories: [
        { content: "a", kind: "gossip", confidence: 0.5, valid_from: "2026-09-20T00:00:00.000Z" },
        { content: "b", kind: "fact", confidence: 0.5, valid_from: "2026-09-20T00:00:00.000Z" },
      ],
    });
    expect(out.memories.map((m) => m.content)).toEqual(["b"]);
  });

  it("drops anything without a parseable valid_from (4-timestamp is mandatory)", () => {
    const out = parseExtractOutput({
      memories: [{ content: "a", kind: "fact", confidence: 0.5, valid_from: "someday" }],
      entities: [{ type: "org", name: "X" }],
    });
    expect(out.memories).toEqual([]);
    expect(out.entities).toEqual([]);
  });

  it("clamps confidence into [0,1] and defaults it when missing", () => {
    const out = parseExtractOutput({
      memories: [
        { content: "a", kind: "fact", confidence: 5, valid_from: "2026-09-20T00:00:00.000Z" },
        { content: "b", kind: "fact", valid_from: "2026-09-20T00:00:00.000Z" },
      ],
    });
    expect(out.memories[0]?.confidence).toBe(1);
    expect(out.memories[1]?.confidence).toBe(0.5);
  });

  it("returns an empty result for junk instead of throwing", () => {
    expect(parseExtractOutput("not json at all")).toEqual({
      memories: [],
      entities: [],
      relations: [],
    });
    expect(parseExtractOutput(null)).toEqual({ memories: [], entities: [], relations: [] });
  });

  it("drops a relation whose endpoints are not both named", () => {
    const out = parseExtractOutput({
      relations: [{ from: "A", type: "knows", valid_from: "2026-09-20T00:00:00.000Z" }],
    });
    expect(out.relations).toEqual([]);
  });

  it("parses a fenced JSON code block the way a model actually answers", () => {
    const out = parseExtractOutput(
      '```json\n{"memories":[{"content":"a","kind":"fact","confidence":0.4,"valid_from":"2026-09-20T00:00:00.000Z"}]}\n```',
    );
    expect(out.memories.map((m) => m.content)).toEqual(["a"]);
  });

  it("pins the A4 §10.6 budget", () => {
    expect(EXTRACT_BUDGET).toEqual({
      inputTokens: 2000,
      outputTokens: 500,
      wallClockMs: 20_000,
      maxSteps: 1,
      tier: "T1",
    });
  });
});
