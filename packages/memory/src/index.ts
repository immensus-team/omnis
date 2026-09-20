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
export {
  DENY_PATTERNS,
  MAX_INGEST_FILE_BYTES,
  IngestDeniedError,
  gitignoreMatcher,
  isBinary,
  isDenied,
} from "./ingest/deny.js";
export {
  DEAD_LETTER_THRESHOLD,
  RETRY_BACKOFF_MS,
  getSource,
  saveCursor,
  recordSuccess,
  recordFailure,
  withRetry,
  writeIngestSystemItem,
  type IngestSource,
} from "./ingest/source.js";
export {
  parseExtractOutput,
  setExtractor,
  getExtractor,
  createT1Extractor,
  EXTRACT_BUDGET,
  type Extractor,
  type ExtractResult,
} from "./ingest/extract.js";
export {
  runIngest,
  registerIngestProvider,
  resetIngestProviders,
  type IngestDoc,
  type IngestProvider,
  type RunIngestDeps,
} from "./ingest/run.js";
export { createCalendarProvider } from "./ingest/calendar.js";
export {
  scanRoots,
  createLocalMiniProvider,
  watchLocalRoots,
  type LocalFile,
  type ScanOptions,
} from "./ingest/local-mini.js";
export { createLocalMacbookProvider, type BridgeCall } from "./ingest/local-macbook.js";
export { createDriveProvider, DRIVE_TEXT_MIME, type DriveFetch } from "./ingest/drive.js";
export { createGithubProvider, GithubRateLimitError, type GithubFetch } from "./ingest/github.js";
