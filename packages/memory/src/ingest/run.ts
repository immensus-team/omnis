// A4 §10: L9 ingestion 코어. 소스는 provider로 꽂히고, 추출 모델은 주입된다.
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

/** @omnis/kernel의 Logger를 **타입만** 구조적으로 받는다(계약 §12 의도된 중복). */
export interface Logger {
  debug(msg: string, extra?: Record<string, unknown>): void;
  info(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, extra?: Record<string, unknown>): void;
}

export interface IngestDoc {
  source_ref: string;
  /** null이면 본문 없음. deleted=true와 함께 오면 무효화 신호다. */
  text: string | null;
  /** A4 §10.4 표: 문서가 말하는 시점, 없으면 mtime / 커밋 시각. */
  validFrom: string;
  deleted?: boolean;
  meta?: Record<string, unknown>;
  /** 이 문서까지 처리했음을 나타내는 커서. 마지막으로 본 값이 저장된다. */
  nextCursor?: Record<string, unknown>;
}

export interface IngestProviderContext {
  pool: Pool;
  logger: Logger;
  cursor: Record<string, unknown>;
}

export interface IngestProvider {
  kind: MemorySourceKind;
  /** `ingest_sources.source_ref` — 이 provider의 커서를 담는 키다(루트 경로, 'changes', 'repos' 등). */
  ref: string;
  list(ctx: IngestProviderContext): AsyncIterable<IngestDoc>;
}

const providers: IngestProvider[] = [];

export function registerIngestProvider(p: IngestProvider): void {
  providers.push(p);
}

/** 테스트 전용. 프로덕션 코드에서 호출하지 않는다. */
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
  /** 테스트에서 백오프를 건너뛴다. */
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

            // A4 §10.2: 경로가 걸리면 파일을 열지 않고 건너뛴다.
            if (isDenied(doc.source_ref)) {
              logger.debug("ingest denied by path", { kind, source_ref: doc.source_ref });
              continue;
            }

            // A4 §10.4: 삭제·tombstone은 지우지 않고 무효화한다.
            if (doc.deleted === true || doc.text === null) {
              await invalidateBySource(pool, kind, doc.source_ref);
              continue;
            }

            // 재스캔 멱등성: upsertMemory가 동일 (kind, ref, content)를 재사용하므로 내용이 안 바뀐
            // 청크는 새 row가 생기지 않는다 — 여기서 먼저 무효화하면 그 재사용이 깨지므로 하지 않는다.
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
          subject: `ingestion 실패: ${kind} ${p.ref}`,
          body: `source_kind=${kind}\nsource_ref=${p.ref}\n연속 실패 ${fails}회\n마지막 에러: ${message}`,
        });
        deadLettered += 1;
      }
    }
  }

  return { chunks: chunkCount, memories: memoryCount, deadLettered };
}

/** 추출 실패는 **그 청크만** 버리고 계속한다(A4 §10.5 파싱 실패 행). 청크 임베딩은 이미
 *  저장돼 있으므로 T1이 죽어도 검색은 산다. */
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
      // 이번 청크에서 정의되지 않은 엔티티를 가리키는 관계는 버린다 — 이름만으로 기존
      // 엔티티를 찾으면 동명이인이 한 노드로 붙는다(A3 §10의 추측 금지와 같은 원칙).
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
