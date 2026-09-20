// A4 §10: L9 ingestion core. Sources are plugged in as providers and the extraction model is injected.
import type { MemorySourceKind } from "@omnis/protocol";
import type { Pool } from "pg";
import { assertRelation, upsertEntity } from "../entities.js";
import { invalidateBySource, upsertMemory } from "../store.js";
import { type Chunk, chunkCode, chunkDocument } from "./chunk.js";
import { isDenied } from "./deny.js";
import { getExtractor } from "./extract.js";
import {
  DEAD_LETTER_THRESHOLD,
  getSource,
  recordFailure,
  recordSuccess,
  saveCursor,
  withRetry,
  writeIngestSystemItem,
} from "./source.js";

/** Structurally accepts @omnis/kernel's Logger, **type only** (contract §12 intentional duplication). */
export interface Logger {
  debug(msg: string, extra?: Record<string, unknown>): void;
  info(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, extra?: Record<string, unknown>): void;
}

export interface IngestDoc {
  source_ref: string;
  /** null means no body. Arriving together with deleted=true is an invalidation signal. */
  text: string | null;
  /** A4 §10.4 table: the point in time the document speaks about, else mtime / commit time. */
  validFrom: string;
  deleted?: boolean;
  meta?: Record<string, unknown>;
  /** Cursor indicating this document has been processed. The last value seen is persisted. */
  nextCursor?: Record<string, unknown>;
}

export interface IngestProviderContext {
  pool: Pool;
  logger: Logger;
  cursor: Record<string, unknown>;
}

export interface IngestProvider {
  kind: MemorySourceKind;
  /** `ingest_sources.source_ref` — the key holding this provider's cursor (root path, 'changes', 'repos', etc.). */
  ref: string;
  list(ctx: IngestProviderContext): AsyncIterable<IngestDoc>;
}

const providers: IngestProvider[] = [];

export function registerIngestProvider(p: IngestProvider): void {
  providers.push(p);
}

/** Test-only. Never called from production code. */
export function resetIngestProviders(): void {
  providers.length = 0;
}

const CODE_EXT = /\.(ts|tsx|js|jsx|py|go|rs|java|rb|swift|kt|c|h|cc|cpp|sql|sh)$/i;

function chunksFor(doc: IngestDoc): Chunk[] {
  const text = doc.text ?? "";
  const chunks = CODE_EXT.test(doc.source_ref)
    ? chunkCode(doc.source_ref, text)
    : chunkDocument(text);
  return chunks.map((c) => ({ ...c, source_ref: doc.source_ref }));
}

export interface RunIngestDeps {
  pool: Pool;
  logger: Logger;
  kind: MemorySourceKind;
  /** Skips backoff in tests. */
  sleep?: (ms: number) => Promise<void>;
}

export async function runIngest(
  deps: RunIngestDeps,
): Promise<{ chunks: number; memories: number; deadLettered: number }> {
  const { pool, logger, kind } = deps;
  let chunkCount = 0;
  let memoryCount = 0;
  let deadLettered = 0;

  for (const p of providers.filter((x) => x.kind === kind)) {
    const source = await getSource(pool, kind, p.ref);
    let cursor = source.cursor;
    try {
      await withRetry(
        async () => {
          for await (const doc of p.list({ pool, logger, cursor })) {
            if (doc.nextCursor !== undefined) cursor = doc.nextCursor;

            // Signal-only documents that just move the cursor (Drive baselines, etc.) are not stored.
            if (doc.source_ref.startsWith("__") && doc.text === null && doc.deleted !== true)
              continue;

            // A4 §10.2: when the path is denied, skip it without opening the file.
            if (isDenied(doc.source_ref)) {
              logger.debug("ingest denied by path", { kind, source_ref: doc.source_ref });
              continue;
            }

            // A4 §10.4: deletions and tombstones are invalidated rather than erased.
            if (doc.deleted === true || doc.text === null) {
              await invalidateBySource(pool, kind, doc.source_ref);
              continue;
            }

            // Rescan idempotency: upsertMemory reuses the same (kind, ref, content), so chunks whose
            // content is unchanged produce no new row — invalidating first would break that reuse.
            for (const chunk of chunksFor(doc)) {
              chunkCount += 1;
              await upsertMemory(pool, {
                content: chunk.text,
                kind: "summary",
                scope: "unknown",
                source_kind: kind,
                source_ref: chunk.source_ref,
                confidence: 0.5,
                valid_from: doc.validFrom,
              });
              memoryCount += 1;
              memoryCount += await extractInto(pool, logger, kind, chunk, doc.validFrom);
            }
          }
        },
        deps.sleep === undefined ? {} : { sleep: deps.sleep },
      );

      await saveCursor(pool, source.id, cursor);
      await recordSuccess(pool, source.id);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const fails = await recordFailure(pool, source.id, message);
      logger.warn("ingest source failed", { kind, source_ref: p.ref, fails, err: message });
      if (fails >= DEAD_LETTER_THRESHOLD) {
        await writeIngestSystemItem(pool, {
          subject: `ingestion failed: ${kind} ${p.ref}`,
          body: `source_kind=${kind}\nsource_ref=${p.ref}\n${fails} consecutive failures\nlast error: ${message}`,
        });
        deadLettered += 1;
      }
    }
  }

  return { chunks: chunkCount, memories: memoryCount, deadLettered };
}

/** An extraction failure drops **only that chunk** and continues (A4 §10.5 parsing-failure row).
 *  The chunk embedding is already stored, so search survives even if T1 dies. */
async function extractInto(
  pool: Pool,
  logger: Logger,
  kind: MemorySourceKind,
  chunk: Chunk,
  validFrom: string,
): Promise<number> {
  let written = 0;
  try {
    const out = await getExtractor()(chunk, { validFrom });
    for (const m of out.memories) {
      await upsertMemory(pool, {
        content: m.content,
        kind: m.kind,
        scope: "unknown",
        source_kind: kind,
        source_ref: chunk.source_ref,
        confidence: m.confidence,
        valid_from: m.valid_from,
        ...(m.valid_until === undefined ? {} : { valid_until: m.valid_until }),
      });
      written += 1;
    }
    const idByName = new Map<string, string>();
    for (const e of out.entities) {
      idByName.set(
        e.name,
        await upsertEntity(pool, {
          type: e.type,
          name: e.name,
          attributes: e.attributes,
          valid_from: e.valid_from,
          ...(e.valid_until === undefined ? {} : { valid_until: e.valid_until }),
        }),
      );
    }
    for (const r of out.relations) {
      const from = idByName.get(r.from);
      const to = idByName.get(r.to);
      // Relations pointing at entities not defined in this chunk are dropped — resolving an
      // existing entity by name alone merges namesakes into one node (A3 §10's no-guessing rule).
      if (from === undefined || to === undefined) continue;
      await assertRelation(pool, {
        from_entity_id: from,
        to_entity_id: to,
        type: r.type,
        confidence: r.confidence,
        valid_from: r.valid_from,
        ...(r.valid_until === undefined ? {} : { valid_until: r.valid_until }),
      });
    }
  } catch (e) {
    logger.warn("extract failed, chunk skipped", {
      source_ref: chunk.source_ref,
      ord: chunk.ord,
      err: e instanceof Error ? e.message : String(e),
    });
  }
  return written;
}
