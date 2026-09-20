// A4 §10.4-1: 임베딩은 T0($0). Ollama nomic-embed-text-v1.5, 768d — A3 §5의 vector(768) 컬럼과
// HNSW 한계(2,000d) 양쪽에 맞는다.
export const EMBED_MODEL = "nomic-embed-text-v1.5";
export const EMBED_DIMS = 768;

/** 차원이 틀린 벡터가 SQL까지 내려가는 것을 막는 유일한 문. 임베딩 값 자체는 메시지에 넣지 않는다. */
export class MemoryEmbedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryEmbedError";
  }
}

/** ponytail: 32는 Ollama 기본 num_parallel(4)보다 넉넉하고 요청 바디가 수 MB를 넘지 않는 선.
 *  미니 처리량 실측(S-A4-3)이 나오면 그때 조정한다. */
const BATCH = 32;
const TIMEOUT_MS = 30_000;

function ollamaBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const host = env.OLLAMA_HOST ?? "127.0.0.1:11434";
  return /^https?:\/\//.test(host) ? host : `http://${host}`;
}

export function toVectorLiteral(v: number[]): string {
  if (v.length !== EMBED_DIMS) {
    throw new MemoryEmbedError(`expected ${EMBED_DIMS} dims, got ${v.length}`);
  }
  return `[${v.join(",")}]`;
}

/** A4 §10.5: Ollama가 죽어도 throw하지 않는다. 실패분은 null이고 호출자는 embedding=NULL로
 *  저장한다 — A3의 부분 HNSW가 NULL을 애초에 인덱싱하지 않으므로 스키마가 이미 이 상태를
 *  허용한다. 다음 주기에 reembedNulls()가 줍는다. */
export async function embed(texts: readonly string[]): Promise<(number[] | null)[]> {
  const out: (number[] | null)[] = new Array(texts.length).fill(null);
  if (texts.length === 0) return out;
  const model = process.env.OMNIS_OLLAMA_EMBED_MODEL ?? EMBED_MODEL;
  const url = `${ollamaBaseUrl()}/api/embed`;

  for (let i = 0; i < texts.length; i += BATCH) {
    const slice = texts.slice(i, i + BATCH);
    let embeddings: unknown;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, input: [...slice] }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) continue;
      embeddings = ((await res.json()) as { embeddings?: unknown }).embeddings;
    } catch {
      continue; // 네트워크·타임아웃 — 이 배치는 통째로 null로 남는다
    }
    if (!Array.isArray(embeddings)) continue;
    for (let j = 0; j < slice.length; j += 1) {
      const v: unknown = embeddings[j];
      if (Array.isArray(v) && v.length === EMBED_DIMS && v.every((n) => typeof n === "number")) {
        out[i + j] = v as number[];
      }
    }
  }
  return out;
}
