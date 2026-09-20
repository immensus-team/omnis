# Phase B 인터페이스 계약 — 델타 (2026-09-20)

`2026-09-20-phase-a-interfaces.md`에 **더해지는 것만** 적는다. Phase A 계약의 항목은 전부 그대로 유효하고, 여기서 다시 쓰지 않는다. 5개 Phase B 계획 문서가 서로 다른 이름을 쓰지 않도록 **이름과 시그니처만** 고정한다 — 설계 논의는 없고 근거는 부록에 있다. 여기 적힌 식별자는 계획 작성자가 **그대로 복사**한다.

스토리 ID는 `2026-09-20-phase-b-backlog.md`(US-B01~B44)를 가리킨다.

---

## 0. 부록 충돌 판정 (각 1줄)

Phase A 계약 §0의 10건은 그대로 유효하다. Phase B가 새로 가르는 것:

> **개정 (2026-09-20, 교차 리뷰)** — `2026-09-20-phase-b-plans-review.md`의 M1~M11을 이 문서에 반영했다. 바뀐 절: §1(루트 스크립트 단일 오너), §2.1(`isDenied`/`DENY_PATTERNS` 정의 이관), §3(`@omnis/memory` 신규 9심볼), §4(`LoopId`·`TriggerContext`·`decide?`·`runLoopSpec`·`LoopKernel`/`LoopLogger`·`writeSystemItem` 추가, `startLoops` 시그니처 교정, `ingestLoop` 삭제), §5(`cost.last_state`), §6(W0 스키마 번들), §7(`GET /transcript` 재배정, `POST /notes/:id/route` 추가), §9(환경변수 2·Keychain 4), §11(W0 행). 계획 문서 본문 수정(M12~M14)은 각 계획 저자 몫이다.

1. **mem0-ts 커스텀 VectorStore**(A3-D12 본문) vs **직접 구현**(A3-D12 폴백) → **폴백이 정본**(백로그 B-D1, `mem0ai@3.2.0` 실측: `MemoryConfig.vectorStore`가 provider 문자열 + `VectorStoreFactory` 정적 팩토리라 인스턴스 주입 슬롯이 없고, 번들 `PGVector`가 자기 테이블을 만든다). S-A3-1 = **FAIL**, `@omnis/memory`가 `public.memories`에 직접 붙는다.
2. self-model 파일 경로: A3 §5 표 `~/.omnis/memory/*.md` vs A4 §13.2 `~/omnis/self-model/` → **`~/.omnis/self-model/`**(A6 §9의 `omnis.*` 점 스킴과 `~/.omnis/` 홈 규약에 맞춘다. `OMNIS_SELF_MODEL_DIR`로 덮어쓴다).
3. `notes` 라우팅 컬럼: A4 §8이 부르는 `notes.routed_to` vs A3 `routed_to_thread_id`/`routed_to_person_id`/`route_state` → **A3의 3컬럼**(A3가 스키마 오너).
4. 자동 보관 시각: `threads.archived_at`(A5 §3.8 되살리기 배너) vs `items.meta.archived_by.at`(A4 §9.3 undo 기준) → **둘 다 쓴다**. 스레드 배너는 `threads.archived_at`, item 단위 undo 창은 `meta.archived_by.at`. 컬럼 승격은 열린 항목(백로그 §6-3).
5. 설정 저장소: 부록 어디에도 없음 → **`settings` kv 테이블 1개**(백로그 B-D2, 이 문서 §5의 `0009`).
6. Web Push 알림 종류: A5 §4.4 "Digest 진입 푸시 1종" vs A4 §3.6 3등급 → **A4 §3.6이 알림 정책 오너**. A5의 "1종"은 Digest 진입 푸시가 1종이라는 뜻이고 초안 3등급은 폰에도 그대로 적용된다.
7. 아바타: A5 §3.6 "아바타/이니셜" → **이니셜만**(백로그 B-D3). `persons.avatar_url` 컬럼을 만들지 않는다.

---

## 1. 패키지 추가·변경

| 패키지명 | 경로 | 의존(이 외 금지) | Phase B 스토리 |
|---|---|---|---|
| `@omnis/memory` | `packages/memory` | `@omnis/db`, `@omnis/protocol`, `ai`, `pg` | B01, B02, B04, B08~B12 |
| `@omnis/adapter-outlook` | `packages/adapters/outlook` | `@omnis/protocol` | B37 |
| `@omnis/adapter-telegram` | `packages/adapters/telegram` | `@omnis/protocol` | B38 |
| `@omnis/web` | `apps/web` | `@omnis/ui`, `@omnis/protocol`, `@omnis/kernel`(`/zero` 서브패스만) | B35, B36 |

**변경되는 의존**:
- `@omnis/agents` → `@omnis/protocol`, `@omnis/memory`, `ai`, `pg`를 의존한다(Phase A 계약 §1의 "`@omnis/memory` 제거, Phase A 미사용" 각주는 여기서 해제된다). `@omnis/db`는 계속 의존하지 않는다 — `configureAgents({pool})`로 주입받는 규칙 유지.
- `@omnis/kernel` → 변화 없음(`@omnis/db`, `@omnis/protocol`).
- `apps/hub` → `@omnis/memory`, `@omnis/adapter-outlook`, `@omnis/adapter-telegram` 추가.

**새 버전 핀**: `web-push 3.6.7`(허브 발송) · `mtcute 0.29.x`(Telegram 사이드카) · `@microsoft/microsoft-graph-client 3.0.7`(Outlook) · `vite-plugin-pwa 0.21.x`(`apps/web`). 나머지 핀은 Phase A 계약 §2 그대로. **`mem0ai`는 의존에 넣지 않는다**(§0-1).

**새 루트 스크립트**(오너 = memory-ingestion 계획 Task 1이 **5개를 한 번에** 넣는다. 다른 계획은 이 `scripts` 블록을 다시 건드리지 않는다 — agents 계획이 `eval:archive`를 재추가하던 스텝은 삭제한다. 가리키는 파일은 각 소유 계획이 따로 만든다):

| 목적 | 명령 |
|---|---|
| memory recall 평가 | `pnpm eval:memory` = `tsx tools/eval/memory-recall.ts` |
| 초안 평가 | `pnpm eval:draft` = `tsx tools/eval/draft.ts` |
| 자동 보관 평가 | `pnpm eval:archive` = `tsx tools/eval/auto-archive.ts` |
| Phase B e2e | `pnpm e2e:phase-b` = `tsx tools/e2e/run.ts --phase b` |
| PWA 빌드 | `pnpm web:build` = `pnpm --filter @omnis/web build` |

---

## 2. `@omnis/protocol` 추가 exports

파일: `src/ingest.ts`(2.1), `src/search.ts`(2.2), `src/bridge.ts`(수정, 2.3). 전부 zod + `z.infer`.

### 2.1 ingest RPC (A2 §3.2)

```ts
export const IngestScanParams = z.object({
  roots: z.array(z.string()).min(1),
  since: z.string().datetime().optional(),
});
export const IngestScanResult = z.object({
  files: z.array(z.object({
    path: z.string(), size: z.number().int(), mtime: z.string().datetime(), sha256: z.string(),
  })),
  truncated: z.boolean(),
});
export const IngestReadParams = z.object({
  path: z.string(),
  max_bytes: z.number().int().positive().default(1_048_576),   // 기본 1MB (A2 §3.2)
});
export const IngestReadResult = z.object({
  path: z.string(), mtime: z.string().datetime(), bytes: z.number().int(),
  content_b64: z.string(), truncated: z.boolean(),
});

export const MemorySourceKind = z.enum(["inbox","calendar","file","drive","github","self"]);
export const MemoryKind = z.enum(["fact","preference","commitment","event","summary"]);
export type MemorySourceKind = z.infer<typeof MemorySourceKind>;
export type MemoryKind = z.infer<typeof MemoryKind>;

// A4 §10.2 하드 제외. 여기(protocol)가 정의 오너다 — `apps/local-agent`는 `@omnis/protocol`만
// 의존하는데 `ingest.scan`/`ingest.read`가 허브와 **같은 목록**으로 경로를 거부해야 한다.
// `@omnis/memory`는 이 둘을 re-export만 한다(§3).
export const DENY_PATTERNS: readonly RegExp[];
export function isDenied(path: string): boolean;   // allowlist보다 먼저, 내용은 보지 않는다
```

`HUB_METHODS`에 `"ingest.scan"`, `"ingest.read"`를 추가한다(Phase A는 미구현이었다). 경로 거부는 기존 `BridgeError` 코드 `-32005`를 그대로 쓴다.

### 2.2 통합 검색 (A4 §14.4)

```ts
export const SearchHitKind = z.enum(["person","thread","item","memory"]);
export const SearchGroupKind = z.enum(["people","threads","items","memories"]);
export const SearchDeepLink = z.object({
  screen: z.enum(["thread","person","digest"]),
  thread_id: z.string().uuid().optional(),
  item_id: z.string().uuid().optional(),
  person_id: z.string().uuid().optional(),
});
export const SearchHit = z.object({
  kind: SearchHitKind, id: z.string().uuid(), score: z.number(),
  title: z.string(), snippet: z.string().max(160),
  at: z.string().datetime().nullable(), channel: Channel.nullable(),
  deep_link: SearchDeepLink.nullable(),
  source_kind: MemorySourceKind.optional(),
});
export const SearchGroup = z.object({
  kind: SearchGroupKind, total: z.number().int(), results: z.array(SearchHit),
});
export const SearchResponse = z.object({
  q: z.string(), took_ms: z.number().int(),
  groups: z.array(SearchGroup),   // 순서 고정: people, threads, items, memories
  truncated: z.boolean(),
});
```

### 2.3 알림·푸시

```ts
export const NotifyTier = z.enum(["immediate","batched","silent"]);   // A4 §3.6
export const PushSubscription = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
  ua: z.string().max(200).optional(),
});
export const PushPayload = z.object({
  kind: z.enum(["draft","approval","vip","briefing","digest","followup","adapter_down"]),
  title: z.string().max(80),
  body: z.string().max(80),          // 본문은 첫 80자만 (A4 §3.6 프라이버시 원칙)
  deep_link: z.string(),             // omnis://thread/{id} 등
  approval_id: z.string().uuid().optional(),   // 있으면 알림에 Approve 액션이 붙는다
});
```

---

## 3. `@omnis/memory` exports (신규 패키지)

```ts
// src/embed.ts — T0, Ollama nomic-embed-text-v1.5, 768d
export const EMBED_MODEL = "nomic-embed-text-v1.5";
export const EMBED_DIMS = 768;
export function embed(texts: readonly string[]): Promise<(number[] | null)[]>;  // 실패분은 null
export function toVectorLiteral(v: number[]): string;                            // "[0.1,0.2,…]"

// src/store.ts — public.memories 직접 소유 (B-D1)
export interface MemoryInput {
  content: string; kind: MemoryKind; scope: Scope;
  source_kind: MemorySourceKind; source_ref?: string;
  source_item_id?: string; person_id?: string; entity_id?: string;
  confidence: number;
  valid_from: string; valid_until?: string;      // 4-timestamp (A3 §5)
}
export interface MemoryRow extends MemoryInput {
  id: string; recorded_at: string; invalidated_at: string | null; superseded_by: string | null;
}
export function upsertMemory(pool: Pool, m: MemoryInput): Promise<string>;
export function invalidateBySource(pool: Pool, source_kind: MemorySourceKind, source_ref: string, at?: Date): Promise<number>;
export function supersede(pool: Pool, oldId: string, newId: string): Promise<void>;
export function reembedNulls(pool: Pool, limit?: number): Promise<number>;        // embedding IS NULL 재시도

// src/search.ts
export interface MemoryHit { memory_id: string; content: string; score: number;
  recorded_at: string; valid_from: string; valid_until: string | null; source_item_id: string | null;
  source_kind: MemorySourceKind; source_ref: string | null; }
export function searchMemories(pool: Pool, q: { query: string; k?: number; kinds?: MemoryKind[]; minScore?: number }): Promise<MemoryHit[]>;

// src/entities.ts — bi-temporal (A3 §5)
export interface EntityInput { type: "person"|"org"|"project"|"commitment"|"decision"|"topic";
  name: string; person_id?: string; attributes?: Record<string, unknown>;
  valid_from: string; valid_until?: string; }
export function upsertEntity(pool: Pool, e: EntityInput): Promise<string>;   // live 충돌 시 기존 row invalidate 후 새 row
export function assertRelation(pool: Pool, r: { from_entity_id: string; to_entity_id: string; type: string;
  attributes?: Record<string, unknown>; source_item_id?: string; confidence?: number;
  valid_from: string; valid_until?: string }): Promise<string>;
export function invalidateEntity(pool: Pool, id: string, at?: Date): Promise<void>;
export function asOf(pool: Pool, q: { entityId?: string; personId?: string; at: "now" | string }): Promise<EntityRow[]>;

// src/self-model.ts
export type SelfModelFile = "USER.md" | "VOICE.md" | "PROJECTS.md";
export const SELF_MODEL_TOKEN_CAPS: Record<SelfModelFile, number>;   // 1200 / 1500 / 1500 (A4 §12.3)
export interface SelfModelSnapshot { files: Partial<Record<SelfModelFile, string>>;
  sha256: string; tokenEstimate: number; overCap: SelfModelFile[]; }
export function loadSelfModel(files: readonly SelfModelFile[]): Promise<SelfModelSnapshot>;
export function applySelfModelPatch(file: SelfModelFile, diff: string, rationale: string): Promise<{ commit: string }>;
export function invalidateSnapshotCache(): void;

// src/ingest/*.ts
export interface Chunk { text: string; ord: number; source_ref: string; meta: Record<string, unknown>; }
export function chunkDocument(text: string): Chunk[];      // 500~800 토큰, 오버랩 100
export function chunkCode(path: string, text: string): Chunk[];   // 함수/클래스 경계
// isDenied/DENY_PATTERNS는 `@omnis/protocol`(src/ingest.ts, §2.1)에 정의하고 `@omnis/memory`가 re-export한다.
// `apps/local-agent`가 `@omnis/protocol`만 의존하면서 같은 목록을 써야 하기 때문이다(A2 §3.2 경로 거부).
export { isDenied, DENY_PATTERNS } from "@omnis/protocol";
export interface IngestSource { id: string; source_kind: MemorySourceKind; source_ref: string;
  cursor: Record<string, unknown>; last_ok_at: string | null; fail_count: number; last_error: string | null; }
export function runIngest(deps: { pool: Pool; logger: Logger; kind: MemorySourceKind }): Promise<{ chunks: number; memories: number; deadLettered: number }>;

export class MemoryEmbedError extends Error {}
export class IngestDeniedError extends Error {}

// --- memory-ingestion 계획이 고정한 것(계약에 없어 새로 더한다) ---
export function estimateTokens(s: string): number;            // §12.3 상한 검사와 §1.3 절삭이 같은 추정기를 쓴다
export interface EntityRow { id: string; type: EntityInput["type"]; name: string;
  person_id: string | null; attributes: Record<string, unknown>;
  valid_from: string; valid_until: string | null; recorded_at: string; invalidated_at: string | null; }
export function ensureSelfModelRepo(): Promise<void>;         // US-B02 "레포 초기화"
export function overCapWarning(snap: SelfModelSnapshot): string | null;   // 상한 초과 시 시스템 Item 문구
export interface IngestDoc { source_ref: string; text: string; meta: Record<string, unknown>; }
export interface IngestProvider { kind: MemorySourceKind;
  list(cursor: Record<string, unknown>): Promise<{ docs: IngestDoc[]; cursor: Record<string, unknown> }>; }
export function registerIngestProvider(p: IngestProvider): void;   // runIngest(deps)에 소스 슬롯이 없어서 레지스트리로 꽂는다
export function resetIngestProviders(): void;
export type Extractor = (chunk: Chunk) => Promise<unknown>;
export function setExtractor(e: Extractor): void;             // provider SDK 격리 유지(§1 의존 규칙)
export function createT1Extractor(model: unknown): Extractor;
export function parseExtractOutput(raw: unknown): { memories: MemoryInput[]; entities: EntityInput[] };
export function chunkCalendarEvent(e: CalendarChunkInput): Chunk;  // 1이벤트 = 1청크 (A4 §10.3)
export function writeIngestSystemItem(pool: Pool, msg: string): Promise<void>;
export const DEAD_LETTER_THRESHOLD: 3;                        // A4 §10.5
```

---

## 4. `@omnis/agents` 추가 exports

```ts
// src/loop/spec.ts (A4 §1.1~§1.2)
// LoopId는 `@omnis/agents`가 **새로** export한다 — Phase A 계약에는 `RecordRunInput.loop`의
// 인라인 유니온만 있고 이름 붙은 타입이 없었다. 값은 그 9개와 글자 그대로 같다.
export type LoopId = "classify"|"draft"|"task"|"delegate"|"digest"|"followup"|"note_route"|"auto_archive"|"ingest";
export type LoopKind = "reactive" | "deliberate";
// A4 §1.2가 루프에 넘기는 트리거 문맥. 델타 v1에서 빠져 있었다(agents 계획 Task 1이 오너).
export interface TriggerContext { loop: LoopId; run_id: string; traceId: string | null;
  firedAt: Date; payload: Record<string, unknown>; }
export interface LoopTrigger { kind: "event"|"schedule"|"manual"; on?: string; where?: string; cron?: string; debounceMs?: number; }
export interface LoopBudget { inputTokens: number; outputTokens: number; wallClockMs: number; maxSteps: number; }
export interface LoopSpec<TOut> {
  id: LoopId; kind: LoopKind; trigger: LoopTrigger;
  palette: ReadonlyArray<ToolName>; budget: LoopBudget; tier: "T0"|"T1"|"T2";
  outputSchema: z.ZodType<TOut>;
  /** 모델 없는 T0 선판정. A4 §9.2(자동 보관 ①③④ SQL)·§2.2(분류 3단)가 요구한다.
   *  false를 돌려주면 모델을 깨우지 않고 루프가 끝난다. 선택 필드라 기존 구현을 깨지 않는다. */
  decide?(ctx: TriggerContext): Promise<boolean>;
  assemble(ctx: TriggerContext): Promise<AssembledContext>;
  apply(result: LoopResult<TOut>, ctx: TriggerContext): Promise<void>;
}
export interface LoopResult<T> { loop: LoopId; run_id: string; output: T; confidence: number;
  rationale: string; escalate: boolean; injection_flags: string[]; unresolved: string[]; }
export function registerLoop<T>(spec: LoopSpec<T>): void;
export function runLoop(id: LoopId, ctx: TriggerContext): Promise<LoopResult<unknown>>;
/** 레지스트리를 타지 않는 하위 진입점. `morningDigestLoop`/`nightlyDigestLoop`이 `LoopId`
 *  `'digest'` 하나를 공유해 `registerLoop` 키가 충돌하기 때문에 이 둘은 여기로 부른다. */
export function runLoopSpec<T>(spec: LoopSpec<T>, ctx: TriggerContext): Promise<LoopResult<T>>;
/** `@omnis/agents`는 `@omnis/kernel`을 의존하지 않는다(§1). `Kernel`/`Logger`가 구조적으로
 *  대입되는 최소 인터페이스만 받는다 — 델타 v1의 `{kernel: Kernel; logger: Logger}`는 §1 위반이었다. */
export interface LoopKernel { events: { on(...a: unknown[]): unknown; emit(...a: unknown[]): unknown };
  scheduler: { register(name: string, cron: string, fn: () => Promise<void>): void }; }
export interface LoopLogger { info(msg: string, meta?: unknown): void; warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void; }
export function startLoops(deps: { kernel: LoopKernel; logger: LoopLogger }): () => void;
/** A4 §1.6·§9·§12.4가 반복하는 "시스템 Item으로 인박스에 남긴다"의 단일 구현.
 *  커널 쪽 4줄 INSERT(`apps/hub/src/archive.ts`)는 의도된 중복이다. */
export function writeSystemItem(pool: Pool, body: string, meta?: Record<string, unknown>): Promise<string>;
export class LoopBudgetError extends Error {}
export class PhantomToolError extends Error {}

// src/context/assemble.ts (A4 §1.3)
export interface ContextRequest {
  selfModel?: SelfModelFile[]; memories?: { query: string; k: number; minScore?: number };
  entities?: { personIds?: string[]; asOf?: "now" | string };
  thread?: { threadId: string; lastN: number; includeToolCalls?: boolean };
  calendar?: { windowHours: number }; tasks?: { state: "open"|"all"; limit: number };
  sessions?: { sessionKeys: string[]; lastN: number };
}
export interface DataBlock { id: string; source: string; text: string; }
export interface AssembledContext { cachedPrefix: string; volatile: DataBlock[];
  tokenEstimate: number; truncated: boolean;
  provenance: Array<{ slot: string; itemIds: string[]; memoryIds: string[] }>; }
export function buildContext(req: ContextRequest): Promise<AssembledContext>;

// src/context/normalize.ts (A4 §1.4·§11.1)
export function normalizeExternal(text: string, nonce: string): string;   // NFKC·zero-width·HTML·base64·URL·8000자 절단
export function wrapData(text: string, attrs: { nonce: string; source: string; thread?: string; asOf: string }): string;
export function newNonce(): string;                                        // 16 hex
export const INJECTION_FLAGS: readonly string[];   // instruction_override | credential_request | exfil_link | phantom_tool | tag_escape

// src/tools/*.ts (A4 §1.5)
export type ToolName =
  | "read_thread" | "search_memory" | "read_person" | "read_entity" | "read_calendar" | "read_tasks" | "read_session"
  | "propose_label" | "propose_draft" | "propose_task" | "propose_delegation" | "propose_route" | "propose_self_model_patch";
export const PHANTOM_TOOLS: readonly string[];   // send_message, send_email, reply, delete_item, archive, calendar_create,
                                                 // calendar_update, run_agent, exec, read_file, http_fetch, read_secret
export function toolRegistry(palette: readonly ToolName[]): ToolSet;       // ai@7 ToolSet

// src/context/* 보조 (memory-ingestion 계획 Task 11·12가 고정)
export function scanInjection(text: string): string[];        // INJECTION_FLAGS 부분집합. normalizeExternal이 문자열만 돌려주므로 별도
export function setContextBudget(n: number): void;
export const CONTEXT_INPUT_BUDGET_TOKENS: 12000;

// src/loops/*.ts — 루프 하나당 하나, 전부 LoopSpec을 default export 하지 않고 이름으로 export
export const draftLoop: LoopSpec<DraftOutput>;
export const taskLoop: LoopSpec<TaskOutput>;
export const delegateLoop: LoopSpec<DelegateOutput>;
export const autoArchiveLoop: LoopSpec<AutoArchiveOutput>;
export const noteRouteLoop: LoopSpec<RouteOutput>;
export const followupLoop: LoopSpec<FollowupOutput>;
export const morningDigestLoop: LoopSpec<MorningBriefing>;
export const nightlyDigestLoop: LoopSpec<NightlyDigest>;
// `ingestLoop`은 삭제했다 — 어느 계획도 만들지 않고, L9의 실제 진입점은 `@omnis/memory`의
// `runIngest(deps)`를 허브 cron 핸들러가 직접 부르는 것이다(§3, memory-ingestion Task 17).

// src/draft/*.ts (A4 §3)
export type Register = "formal_ko"|"polite_ko"|"casual_ko"|"formal_en"|"casual_en";
export function pickRegister(ctx: { language: "ko"|"en"; labels: string[]; sameOrg: boolean; greeting?: string }): Register;
export function needsReplyScore(item: ItemRow, ctx: { lastAuthorIsThem: boolean; myReplyRatio: number; inTo: boolean; bulkHeaders: boolean }): number;
export const CHANNEL_DRAFT_SHAPE: Record<Channel, { targetWords: [number, number]; notes: string }>;
export function selfCheck(draft: string, ctx: SelfCheckCtx): { passed: boolean; failed: number[] };

// src/delegate/route.ts (A4 §5.2)
export interface DelegationHints { needs_paths: string[]; needs_channel_session: boolean;
  needs_always_on: boolean; est_minutes: number | null; repo: string | null; }
export interface Routing { host: HostId; runtime?: RuntimeKind; rule_id: string; }
export function extractHints(text: string): DelegationHints;               // 정규식, LLM 아님
export function routeByRule(h: DelegationHints, hosts: HostHealth): Routing | null;
export const DELEGATION_DAILY_CAP: 5;
export const DELEGATION_THREAD_CAP_24H: 2;

// src/digest/rank.ts (A4 §6.3) — 랭킹은 산술이다
export function rankBriefItems(rows: BriefCandidate[], now: Date): BriefItem[];
export interface MorningBriefing { greeting: string; sections: BriefSection[]; one_liner: string; }
export interface NightlyDigest { headline: string; auto_archived: DigestGroup[];
  handled: { count: number; by_channel: Record<Channel, number> };
  still_open: BriefItem[]; cost: { month_to_date_usd: number; cap_usd: number; tier_state: CostState };
  agents: { runs: number; failed: number; delegated: number }; }
export interface DigestGroup { reason: string; count: number; samples: BriefItem[]; undo_token: string; }
```

---

## 5. `@omnis/kernel` 추가 exports

```ts
// src/identity.ts (A3 §10) — US-B03
export function handleNorm(channel: Channel, raw: string, roomExternalId?: string): string;
export function resolvePerson(c: PoolClient, channel: Channel, handle: string, display: string): Promise<{ person_id: string; created: boolean }>;
export function mergePersons(pool: Pool, from: string, to: string, actor: string): Promise<void>;
export function splitIdentity(pool: Pool, identityId: string, toPersonId: string | null, actor: string): Promise<void>;
export function initialsFor(displayName: string): string;     // B-D3, avatar_url 없음

// src/settings.ts (B-D2) — US-B33
export type SettingKey =
  | "cost.cap_usd" | "cost.reserve_ratio" | "cost.last_state"   // last_state는 내부 키 — Settings 화면에 노출하지 않는다
  | "notify.quiet_hours" | "notify.vip_override"
  | "archive.t1_confidence_min" | "archive.enabled"
  | "ingest.local_roots.mini" | "ingest.local_roots.macbook" | "ingest.drive_folders" | "ingest.github_repos"
  | "autonomy.rules" | "kakao.send_enabled_at";
export function getSetting<T>(pool: Pool, key: SettingKey, fallback: T): Promise<T>;
export function setSetting(pool: Pool, key: SettingKey, value: unknown, actor: string): Promise<void>;  // audit_log 필수
export const SETTING_DEFAULTS: Readonly<Record<SettingKey, unknown>>;   // allowlist 3종은 전부 [] (빈 값)

// src/cost/governor.ts (A4 §12.4) — US-B14
export type CostState = "normal" | "warn" | "degraded" | "reserve_only" | "frozen";
export interface CostInput { mtdUsd: number; capUsd: number; reserveRatio: number; }
export function costState(i: CostInput): CostState;
export interface Policy { allowT2NonSensitive: boolean; allowT2Reserve: boolean;
  draftsNonVip: boolean; draftsVipSensitive: boolean;
  digestCron: "daily"|"alternate"|"off"; note: string | null; }
export const POLICY: Record<CostState, Policy>;
export function currentPolicy(pool: Pool): Promise<{ state: CostState; policy: Policy; mtdUsd: number; reserveUsd: number }>;

// src/notify/*.ts (A4 §3.6) — US-B15, B17
export function notifyTierFor(i: { priority: "now"|"today"|"week"|"fyi"; vip: boolean;
  mentionsMe: boolean; meetingWithin2h: boolean; now: Date }): NotifyTier;
export function inQuietHours(at: Date): boolean;                       // 23:00~07:00 KST
export interface Notifier { send(p: PushPayload, tier: NotifyTier): Promise<void>; }
export function createNotifier(deps: { pool: Pool; logger: Logger; vapid: VapidKeys }): Notifier;

// src/archive.ts (A4 §9) — US-B18
export const UNDO_WINDOW_DAYS: 7;
export const REARCHIVE_EXCLUSION_DAYS: 30;
export function archiveItem(pool: Pool, itemId: string, meta: ArchivedByMeta): Promise<void>;
export function undoArchive(pool: Pool, ref: { itemId?: string; undoToken?: string }, actor: string): Promise<number>;
export interface ArchivedByMeta { rule_ids: string[]; reason: string; tier: "T0"|"T1";
  confidence: number; run_id: string; at: string; }

// src/adapter-health.ts — US-B40
export function recordAdapterHealth(pool: Pool, channel: Channel, ok: boolean, error?: string): Promise<void>;
// 연속 실패 임계 초과 시 accounts.state='broken' + items(kind='system') + ntfy (A6 §8 이중 노출)
```

`Kernel` 인터페이스에 추가되는 필드: `settings`, `cost`, `notifier`, `identity`. `createKernel(deps)`의 `KernelDeps`에 `vapid?: VapidKeys`가 붙는다(없으면 Web Push 발송만 비활성, 나머지는 정상 동작).

---

## 6. `@omnis/db` — 마이그레이션 0009~0013

**Phase A 계약 §4의 "8파일이 v1 테이블 전체" 문장은 Phase B에서 5파일이 더해지는 것으로 갱신된다**(A3 §8도 같이 고쳐야 한다 — 백로그 §6-2).

**오너십 (2026-09-20 교차 리뷰에서 바뀐 것, M1~M3):** `0009`·`0011`·`0012`·`0013`은 **웨이브 0 스키마 번들**이다 — 한 워크트리에서 한 커밋으로, `packages/kernel/src/settings.ts`(§5의 `getSetting`/`setSetting`/`SETTING_DEFAULTS`)와 같이 낸다. 이유:
- `0012`를 agents 계획(Task 7)과 channels 계획(Task 5)이 **각자 다른 내용으로** 만들고 있었다(agents판에만 `cost_daily` 뷰가 있다). 마이그레이션 러너는 이미 적용된 파일의 sha256이 바뀌면 throw하므로(계약 §4) 병렬 워크트리에서 나눠 가질 수 없다.
- `settings`(B33, surfaces)를 B09·B11·B14가 먼저 소비하고 B33은 다시 B09/B11/B14/B18에 의존해 **순환**이었다. `push_subscriptions`(B36)와 B17도 같은 형태였다.
번들을 먼저 머지하면 셋 다 사라진다. **다른 계획은 `packages/db/migrations/`에 파일을 만들지 않는다** — 예외는 memory-ingestion의 `0010` 하나. ops 계획의 `0014_cost_report_job.sql`은 이 규칙에서 불필요해지므로 삭제한다.

| 파일 | 만드는 것 | 스토리 |
|---|---|---|
| `0009_settings.sql`(W0) | `settings(key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())` + `SETTING_DEFAULTS` seed + `omnis_control` NOTIFY 트리거(`{"settings":"<key>"}`) | B33 |
| `0010_ingest_sources.sql` | `ingest_sources(id uuid PK, source_kind text NOT NULL, source_ref text NOT NULL, cursor jsonb NOT NULL DEFAULT '{}', last_ok_at timestamptz, fail_count int NOT NULL DEFAULT 0, last_error text, UNIQUE(source_kind, source_ref))` | B08 |
| `0011_push_subscriptions.sql`(W0) | `push_subscriptions(id uuid PK, endpoint text UNIQUE NOT NULL, p256dh text NOT NULL, auth text NOT NULL, ua text, created_at timestamptz NOT NULL DEFAULT now(), last_ok_at timestamptz, fail_count int NOT NULL DEFAULT 0)` | B36 |
| `0012_jobs_phase_b.sql`(W0) | `jobs` seed 4건 추가(§8 표) + `CREATE VIEW cost_daily`(agents 계획 Task 7 본문의 뷰 정의를 그대로 쓴다) | B14, B15, B37, B44가 **소비만** 한다 |
| `0013_publication_phase_b.sql`(W0) | `ALTER PUBLICATION zero_omnis ADD TABLE settings;` — `ingest_sources`·`push_subscriptions`는 **추가하지 않는다** | B33 |

- **새 NOTIFY 채널은 없다.** `settings` 변경은 기존 `omnis_control`에 `{"settings":"<key>"}`를 실어 허브 캐시를 무효화한다. `NOTIFY_CHANNELS`는 7개 그대로.
- **기존 마이그레이션은 건드리지 않는다.** `accounts_channel_ck`는 이미 `outlook`·`telegram`을 포함한다(0002 실측) — 새 마이그레이션 불필요.
- `memories`/`entities`/`relations`/`tasks`/`notes`/`digests`/`persons`는 **컬럼 변경 없음**. Phase B가 요구하는 값은 전부 기존 컬럼과 `items.meta`/`threads.meta`로 표현된다.

---

## 7. 허브 HTTP 라우트 추가

Phase A 계약 §5의 표에 더해진다. 전부 `127.0.0.1:8787` bind, Tailscale Serve `/api/` 마운트, `application/json`.

| 메서드·경로 | body | 응답 | 스토리 |
|---|---|---|---|
| `GET /search?q&k&scope&since` | — | `SearchResponse` (§2.2) | B26 |
| `GET /memory/search?q&k&kinds` | — | `{ results: MemoryHit[] }` (A3 §7의 예고된 경로) | B26 |
| `GET /transcript/:session_id?last_n` | — | `SessionSummary` (A3 §7) | ~~B39~~ → **surfaces 계획 Task 11**(2026-09-20 교차 리뷰 M8에서 재배정, 해당 태스크가 작성됨). channels 계획의 US-B39 산출물은 `apps/local-agent/src/bridges/hermes.ts` 하나뿐이라 이 허브 라우트를 구현하지 않는다 |
| `GET /settings` | — | `{ settings: Record<SettingKey, unknown> }` | B33 |
| `PUT /settings/:key` | `{ value: unknown }` | `{ key, value }` — `audit_log` 필수 | B33 |
| `POST /items/:id/unarchive` | — | `{ id, status: "received" }` | B32 |
| `POST /digests/:id/undo` | `{ undo_token: string }` | `{ restored: number }` | B32 |
| `GET /push/vapid-public-key` | — | `{ key: string }` (비밀 미설정 시 503) | B36 |
| `POST /push/subscribe` | `PushSubscription` (§2.3) | `{ id: string }` | B36 |
| `DELETE /push/subscribe` | `{ endpoint: string }` | `{ removed: boolean }` | B36 |
| `POST /approvals/:id/decide` | (기존) | (기존) — **Web Push `Approve` 액션이 이 경로를 그대로 쓴다.** 새 경로를 만들지 않는다 | B36 |
| `GET /cost` | — | `{ state: CostState, mtdUsd, capUsd, reserveUsd, policy: Policy }` | B33 |
| `POST /notes/:id/route` | `{ accept: boolean; thread_id?: string; person_id?: string }` | `{ route_state: string }` — L7 제안의 수락/거절. 델타 v1에 없던 라우트다 | B31 |

`GET /` 및 정적 자산: Tailscale Serve가 `apps/web` 빌드 산출물을 서빙한다(허브 프로세스가 아니라 `tailscale serve --bg --https=443 / localhost:5173/`, A6 §3). 허브는 API만 낸다.

---

## 8. 잡(cron) 추가

A4 §6.1 표가 정본인 10건 + A3 §6 인프라 6건은 **이미 `0006_kernel.sql`에 seed되어 있다**(실측). Phase B가 더하는 것만:

| 잡 이름 | cron (TZ=Asia/Seoul) | 하는 일 | 소유 | 스토리 |
|---|---|---|---|---|
| `cost_daily` | `5 0 * * *` | `agent_runs` → `cost_daily` 집계 + `CostState` 전이 감지 | A4 §12.4 | B14 |
| `push_batch` | `0 9,12,15,18 * * *` | 묶음 등급 알림을 "초안 N건 준비됨" 1건으로 발송 | A4 §3.6 | B15 |
| `outlook_delta_poll` | `*/5 * * * *` | Graph delta 폴링(webhook 전 단계) | A1 §2.4 | B37 |
| `cost_report_monthly` | `10 0 1 * *` | 월간 리포트 → `digests.metrics` | A4 §12.4 | B44 |

**기존 잡에 핸들러가 붙는 것**(seed는 이미 있고 Phase B가 구현을 채운다): `morning_digest`(B23), `nightly_digest`(B24), `memory_consolidate`(B24), `auto_archive_sweep`(B18), `task_remind`(B19), `network_inactive_sweep`(B22), `self_model_weekly`(B25), `drive_poll`(B11, 맥북 `ingest.scan` 동승 B10), `github_poll`(B11), `eval_weekly`(B12), `token_refresh`/`gmail_rewatch`/`graph_sub_renew`(B40).

백업(`pg_dump`·restic)과 healthcheck ping은 **`jobs` 테이블이 아니라 launchd**다(A6 §1·§4 소유, B41·B42).

---

## 9. 환경변수 · Keychain 추가

**환경변수**(Phase A 계약 §9에 더함, 전부 `OMNIS_` 접두 + 대문자 스네이크):

| 이름 | 기본값 | 쓰는 곳 |
|---|---|---|
| `OMNIS_SELF_MODEL_DIR` | `~/.omnis/self-model` | `@omnis/memory` self-model 로더 (§0-2) |
| `OMNIS_OLLAMA_EMBED_MODEL` | `nomic-embed-text-v1.5` | `@omnis/memory` embed |
| `OMNIS_ANTHROPIC_API_KEY` | — | T2(Claude Sonnet 5) + Message Batches. 없으면 T2 경로가 스킵되고 시스템 Item이 뜬다 |
| `OMNIS_WEBPUSH_VAPID_PUBLIC` / `OMNIS_WEBPUSH_VAPID_PRIVATE` | — | 허브 Web Push 발송. 미설정 시 `/push/*`가 503 |
| `OMNIS_WEBPUSH_SUBJECT` | `mailto:281932556+jinhologankim@users.noreply.github.com` | VAPID `sub` 클레임 |
| `OMNIS_WEB_PORT` | `5173` | `apps/web` dev·정적 서빙 포트(A6 §3의 serve 대상) |
| `OMNIS_GITHUB_TOKEN` | — | GitHub ETag 폴링(PAT, App은 S-A4-6) |
| `OMNIS_OUTLOOK_CLIENT_ID` / `OMNIS_OUTLOOK_TENANT` | — / `common` | Outlook OAuth |
| `OMNIS_TELEGRAM_API_ID` / `OMNIS_TELEGRAM_API_HASH` | — | mtcute. **로그·에러 메시지에 절대 넣지 않는다** |
| `HERMES_BASE_URL` | `http://127.0.0.1:8642` | Phase A 계약에 이미 있음 — Phase B가 처음 쓴다 |
| `OMNIS_OPENROUTER_API_KEY` | — | 동기 T2(`anthropic/claude-sonnet-5`)와 T1 추출. 새 SDK 핀을 피하려고 동기 T2는 OpenRouter, Batch API만 Anthropic 직접 `fetch`다 — `agent_runs.provider`가 동기 T2에서 `openrouter`로 기록되는 것을 US-B44 리포트가 감안해야 한다. 빈 값이면 해당 경로가 스킵된다(B-D5 테스트 폴백) |
| `OMNIS_NTFY_URL` | `http://127.0.0.1:2586` | self-hosted ntfy. 토픽은 `omnis-critical`/`omnis-warning` 2종(A6 §8). `@omnis/kernel`의 `sendNtfy`(channels)와 `ops/scripts/healthcheck-ping.sh`(ops)가 같은 값을 쓴다 |

**Keychain 항목**(A6 §9 점 스킴 `omnis.<service>.<kind>`, account = `281932556+jinhologankim@users.noreply.github.com`):

`omnis.webpush.vapid_private` · `omnis.webpush.vapid_public` · `omnis.anthropic.api_key` · `omnis.github.pat` · `omnis.outlook.<upn>` · `omnis.telegram.session_key` · `omnis.hermes.api_key.mini` · `omnis.hermes.api_key.macbook`(뒤 둘은 Phase A 계약 §8에 이미 예약되어 있다). `omnis.openrouter.api_key`(동기 T2·T1 추출) · `omnis.healthchecks.<slug>`(체크 15종 ping UUID) · `omnis.restic.repo_password` · `omnis.b2.app_key`(백업, US-B41). DeepSeek 키는 기존 `deepseek-api` 항목을 그대로 읽는다(A6 §9 기존 자산 재사용 규칙).

---

## 10. Zero 복제 범위 변경

| 테이블 | 복제 | 왜 |
|---|---|---|
| `settings` | **포함**(`0013`) | Settings 화면과 PWA가 값을 읽는다. 쓰기는 허브 `PUT /settings/:key`만 |
| `ingest_sources` | 제외 | 폴링 커서. 클라이언트가 쓸 일이 없다 |
| `push_subscriptions` | 제외 | 엔드포인트·키는 서버만 |
| `memories`·`entities`·`relations` | **제외 유지** | A3 §7 그대로. 768d × 다수 row를 폰에 밀지 않는다 — `GET /search`·`GET /memory/search`가 유일 경로 |
| `items`(컬럼 리스트) | **변경 없음** | `meta`가 이미 포함이라 `meta.archived_by`·`meta.pending`이 그대로 내려간다 |
| `persons` | **변경 없음** | 이니셜은 `display_name`에서 계산한다(B-D3) |

`ZERO_TABLES`에 `"settings"` 1개가 추가되고 `assertZeroPublication`이 그 차이를 부팅에서 잡는다. **권한 규칙**: `settings`는 `row.select`만 — Phase A 편차(모든 복제 테이블 읽기 전용, 쓰기는 허브 HTTP)를 Phase B도 그대로 유지한다. `zero:deploy-permissions`를 `0013` 적용 후 다시 돌리지 않으면 zero-cache가 한 행도 내려보내지 않는다.

---

## 11. 스토리 → 계획 파일 → 심볼

| 스토리 | 계획 파일 | 이 문서가 고정한 심볼 |
|---|---|---|
| US-B01, B08~B12 | `…-phase-b-memory-ingestion.md` | §3 전부 (`embed`/`upsertMemory`/`searchMemories`/`invalidateBySource`/`chunk*`/`isDenied`/`runIngest`) |
| US-B02 | 〃 | §3 `loadSelfModel`/`applySelfModelPatch`/`SELF_MODEL_TOKEN_CAPS` |
| US-B03 | 〃 | §5 `handleNorm`/`resolvePerson`/`mergePersons`/`splitIdentity`/`initialsFor` |
| US-B04 | 〃 | §3 `upsertEntity`/`assertRelation`/`asOf` |
| US-B05 | 〃 | §4 `buildContext`/`normalizeExternal`/`wrapData`/`INJECTION_FLAGS` |
| US-B06, B07 | `…-phase-b-agents.md` | §4 `LoopSpec`/`LoopResult`/`registerLoop`/`ToolName`/`PHANTOM_TOOLS` |
| US-B13 | 〃 | §4 `draftLoop`/`pickRegister`/`needsReplyScore`/`CHANNEL_DRAFT_SHAPE`/`selfCheck` |
| US-B14 | 〃 | §5 `costState`/`POLICY`/`currentPolicy`, §8 `cost_daily` |
| US-B15, B17 | 〃 | §2.3 `NotifyTier`/`PushPayload`, §5 `notifyTierFor`/`inQuietHours`/`createNotifier`, §8 `push_batch` |
| US-B18 | 〃 | §5 `archiveItem`/`undoArchive`/`ArchivedByMeta`/`UNDO_WINDOW_DAYS` |
| US-B19, B20 | 〃 | §4 `taskLoop`/`delegateLoop`/`DelegationHints`/`routeByRule`/`DELEGATION_DAILY_CAP` |
| US-B21, B22 | 〃 | §4 `noteRouteLoop`/`followupLoop` |
| US-B23, B24 | 〃 | §4 `MorningBriefing`/`NightlyDigest`/`DigestGroup`/`rankBriefItems` |
| US-B25 | 〃 | §3 `applySelfModelPatch`, §4 `propose_self_model_patch` |
| US-B26, B27 | `…-phase-b-surfaces.md` | §2.2 `SearchResponse`/`SearchHit`, §7 `GET /search`·`GET /memory/search` |
| US-B28~B32 | 〃 | §7 `POST /items/:id/unarchive`·`POST /digests/:id/undo`, §4 digest 타입 |
| US-B33 | 〃 | §5 `SettingKey`/`getSetting`/`setSetting`/`SETTING_DEFAULTS`, §6 `0009`, §7 `/settings`·`/cost` |
| US-B35, B36 | 〃 | §1 `@omnis/web`, §2.3 `PushSubscription`, §6 `0011`, §7 `/push/*` |
| US-B37, B38 | `…-phase-b-channels.md` | §1 어댑터 패키지 2종, §8 `outlook_delta_poll` |
| US-B39 | 〃 | Phase A 계약 §8의 HTTP형 `[[runtime]]` 블록(`kind="hermes"`, `session_header_mode="hermes_v1"`) |
| US-B40 | 〃 | §5 `recordAdapterHealth` |
| US-B45 | 〃 | 신규 심볼 없음 — §3.2 `Adapter`/`AuthRef`(Phase A 계약)와 `createHubServer({adapters})`(이미 있는 선택 인자)를 실제로 채운다. `apps/hub/src/adapters.ts`가 `AdapterFactories`/`buildAdapters`/`startAdapterLoops`를 새로 export한다 |
| US-B16, B34, B41~B44 | `…-phase-b-ops.md` | §9 Keychain·환경변수, §8 `cost_report_monthly`. **`0014_cost_report_job.sql`은 만들지 않는다** — §6 W0 번들의 `0012`가 이 seed를 이미 갖는다 |
| (스키마 선행) | **웨이브 0 번들** — 어느 계획 문서에도 속하지 않는 단일 커밋 | §6의 `0009`·`0011`·`0012`·`0013` + §5 `packages/kernel/src/settings.ts`. B09·B11·B14·B15·B17·B33·B36·B37·B44가 전부 이것을 기다린다 |

---

## 12. 공통 규약 변경

- **로그**: Phase A §9 그대로. `@omnis/memory`의 `pkg` 값은 `"@omnis/memory"`. 임베딩 벡터·파일 내용·푸시 엔드포인트는 **어떤 키에도 넣지 않는다**.
- **에러 클래스**: Phase A의 7종에 `MemoryEmbedError`·`IngestDeniedError`(`@omnis/memory`), `PhantomToolError`(`@omnis/agents`)가 더해진다. 전부 `name`을 클래스명과 같게 둔다.
- **어댑터 계약 테스트 픽스처**: Outlook·Telegram도 Phase A와 같은 배치(`packages/adapters/<channel>/fixtures/<scenario>.json`). 최소 시나리오는 Phase A의 5종 + Telegram은 `edited_message.json`·`deleted_message.json` 추가(A1 §1.7).
- **브랜치·커밋**: Phase A 그대로. 제목은 `US-B05: 컨텍스트 조립기와 data 정규화`, 본문에 acceptance criteria + `Implemented-by: …`, 마지막 줄 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- **의도된 중복 유지**: `createLogger`·`readKeychainSecret`는 계속 각자 갖는다. `@omnis/memory`도 `@omnis/kernel`의 `Logger` **타입만** 쓰고 구현은 자기 것을 쓴다(패키지 의존 규칙 §1).
