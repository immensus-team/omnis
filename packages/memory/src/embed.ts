// A4 §10.4-1: embeddings are T0 ($0). Ollama nomic-embed-text-v1.5, 768d — fits both A3 §5's
// vector(768) column and the HNSW limit (2,000d).
export const EMBED_MODEL = "nomic-embed-text-v1.5";
export const EMBED_DIMS = 768;

/** nomic-embed-text was trained to separate query/document with asymmetric task prefixes —
 *  embed without the prefix and cosine distance becomes close to random. Use document when
 *  storing, query when searching (Nomic model card). */
export const EMBED_QUERY_PREFIX = "search_query: ";
export const EMBED_DOCUMENT_PREFIX = "search_document: ";

/** The only gate that stops a wrong-dimension vector from reaching SQL. The embedding values
 *  themselves never go into the message. */
export class MemoryEmbedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryEmbedError";
  }
}

/** ponytail: 32 is roomier than Ollama's default num_parallel(4) while keeping the request body
 *  under a few MB. Tune it once the mini's measured throughput (S-A4-3) is in. */
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

/** A4 §10.5: never throws even when Ollama is down. Failures come back as null and the caller
 *  stores embedding=NULL — A3's partial HNSW never indexes NULL in the first place, so the
 *  schema already allows this state. reembedNulls() picks them up on the next cycle. */
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
      continue; // network or timeout — this whole batch stays null
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
