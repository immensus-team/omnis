import { afterEach, describe, expect, it } from "vitest";
import { EMBED_DIMS, EMBED_MODEL, MemoryEmbedError, embed, toVectorLiteral } from "../src/embed.js";
import { type FakeOllama, startFakeOllama } from "./helpers/fake-ollama.js";

let ollama: FakeOllama | null = null;
const originalHost = process.env.OLLAMA_HOST;

afterEach(async () => {
  await ollama?.close();
  ollama = null;
  if (originalHost === undefined) process.env.OLLAMA_HOST = undefined;
  else process.env.OLLAMA_HOST = originalHost;
});

describe("embed", () => {
  it("returns one 768-dim vector per input, in order", async () => {
    ollama = await startFakeOllama();
    process.env.OLLAMA_HOST = ollama.host;
    const out = await embed(["회의 내용 정리", "점심 메뉴"]);
    expect(out).toHaveLength(2);
    expect(out[0]).toHaveLength(EMBED_DIMS);
    expect(out[1]).toHaveLength(EMBED_DIMS);
    expect(out[0]).not.toEqual(out[1]);
  });

  // A4 §10.5: Ollama가 죽으면 예외가 아니라 null이다. 호출자는 embedding=NULL로 저장한다.
  it("returns null for every text when ollama is down", async () => {
    ollama = await startFakeOllama("all");
    process.env.OLLAMA_HOST = ollama.host;
    expect(await embed(["a", "b", "c"])).toEqual([null, null, null]);
  });

  it("returns null without any request when the host refuses the connection", async () => {
    process.env.OLLAMA_HOST = "127.0.0.1:1"; // 아무도 안 듣는 포트
    expect(await embed(["a"])).toEqual([null]);
  });

  it("batches long input lists instead of sending one request per text", async () => {
    ollama = await startFakeOllama();
    process.env.OLLAMA_HOST = ollama.host;
    const out = await embed(Array.from({ length: 70 }, (_, i) => `문장 ${i}`));
    expect(out.filter((v) => v !== null)).toHaveLength(70);
    expect(ollama.calls).toBe(3); // 32 + 32 + 6
  });

  it("returns [] for an empty input without touching the network", async () => {
    process.env.OLLAMA_HOST = "127.0.0.1:1";
    expect(await embed([])).toEqual([]);
  });

  it("pins the model name and dimension A3 §5 built the column for", () => {
    expect(EMBED_MODEL).toBe("nomic-embed-text-v1.5");
    expect(EMBED_DIMS).toBe(768);
  });
});

describe("toVectorLiteral", () => {
  it("renders the pgvector literal form", () => {
    // toVectorLiteral requires EMBED_DIMS(768) — pad to a valid vector while
    // still exercising the value-formatting (positive/negative/zero) the
    // plan's original 3-element example intended to check.
    const v = new Array<number>(EMBED_DIMS).fill(0);
    v[0] = 0.5;
    v[1] = -0.25;
    expect(toVectorLiteral(v)).toBe(`[0.5,-0.25,${new Array(EMBED_DIMS - 2).fill(0).join(",")}]`);
  });

  // 차원이 틀린 벡터를 조용히 쓰면 HNSW INSERT가 런타임에 깨진다. 여기서 깨뜨린다.
  it("refuses a vector whose dimension is not 768", () => {
    expect(() => toVectorLiteral([1, 2, 3])).toThrow(MemoryEmbedError);
    expect(() => toVectorLiteral([1, 2, 3])).toThrow(/768/);
  });
});
