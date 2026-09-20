// 배럴. 태스크마다 한 줄씩 늘어난다 — 존재하지 않는 모듈을 미리 적지 않는다.
export { EMBED_MODEL, EMBED_DIMS, MemoryEmbedError, embed, toVectorLiteral } from "./embed.js";
export {
  upsertMemory,
  invalidateBySource,
  supersede,
  reembedNulls,
  type MemoryInput,
  type MemoryRow,
} from "./store.js";
export { searchMemories, truncateSnippet, type MemoryHit } from "./search.js";
export { estimateTokens } from "./tokens.js";
export {
  SELF_MODEL_FILES,
  SELF_MODEL_TOKEN_CAPS,
  invalidateSnapshotCache,
  loadSelfModel,
  overCapWarning,
  selfModelDir,
  type SelfModelFile,
  type SelfModelSnapshot,
} from "./self-model.js";
export { ensureSelfModelRepo, applySelfModelPatch, SelfModelPatchError } from "./self-model-git.js";
export {
  upsertEntity,
  assertRelation,
  invalidateEntity,
  asOf,
  type EntityInput,
  type EntityRow,
  type EntityType,
  type RelationInput,
} from "./entities.js";
export {
  chunkDocument,
  chunkCode,
  chunkCalendarEvent,
  CHUNK_MIN_TOKENS,
  CHUNK_MAX_TOKENS,
  CHUNK_OVERLAP_TOKENS,
  type Chunk,
  type CalendarChunkInput,
} from "./ingest/chunk.js";
