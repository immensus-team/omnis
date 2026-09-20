# Phase B interface contract — delta (2026-09-20)

This records **only what is added to** `2026-09-20-phase-a-interfaces.md`. Every item in the Phase A contract stays valid as written and is not restated here. So that the five Phase B plan documents do not use different names, it pins down **names and signatures only** — there is no design discussion, and the rationale is in the appendix. Plan authors **copy verbatim** the identifiers written here.

Story IDs refer to `2026-09-20-phase-b-backlog.md` (US-B01~B44).

---

## 0. Appendix conflict rulings (one line each)

The 10 items in Phase A contract §0 remain valid as-is. What Phase B newly decides:

> **Revision (2026-09-20, cross review)** — M1~M11 from `2026-09-20-phase-b-plans-review.md` have been folded into this document. Sections changed: §1 (single owner for root scripts), §2.1 (`isDenied`/`DENY_PATTERNS` definition relocated), §3 (`@omnis/memory` 9 new symbols), §4 (`LoopId`·`TriggerContext`·`decide?`·`runLoopSpec`·`LoopKernel`/`LoopLogger`·`writeSystemItem` added, `startLoops` signature corrected, `ingestLoop` removed), §5 (`cost.last_state`), §6 (W0 schema bundle), §7 (`GET /transcript` reassigned, `POST /notes/:id/route` added), §9 (2 environment variables · 4 Keychain items), §11 (W0 row). Body edits to the plan documents (M12~M14) are up to each plan author.

1. **mem0-ts custom VectorStore** (body of A3-D12) vs **direct implementation** (A3-D12 fallback) → **the fallback is the source of truth** (backlog B-D1, measured against `mem0ai@3.2.0`: `MemoryConfig.vectorStore` is a provider string plus a static `VectorStoreFactory` factory, so there is no slot for injecting an instance, and the bundled `PGVector` creates its own table). S-A3-1 = **FAIL**; `@omnis/memory` attaches directly to `public.memories`.
2. self-model file path: the A3 §5 table's `~/.omnis/memory/*.md` vs A4 §13.2's `~/omnis/self-model/` → **`~/.omnis/self-model/`** (aligns with the `omnis.*` dotted scheme in A6 §9 and the `~/.omnis/` home convention. Overridden by `OMNIS_SELF_MODEL_DIR`).
3. `notes` routing columns: `notes.routed_to` as called for by A4 §8 vs A3's `routed_to_thread_id`/`routed_to_person_id`/`route_state` → **A3's 3 columns** (A3 owns the schema).
4. Auto-archive timestamp: `threads.archived_at` (A5 §3.8 restore banner) vs `items.meta.archived_by.at` (A4 §9.3 undo basis) → **use both**. The thread banner uses `threads.archived_at`; the item-level undo window uses `meta.archived_by.at`. Promoting it to a column is an open item (backlog §6-3).
5. Settings storage: found in no appendix → **one `settings` kv table** (backlog B-D2, `0009` in §5 of this document).
6. Web Push notification kinds: A5 §4.4 "1 kind of digest-entry push" vs A4 §3.6's 3 tiers → **A4 §3.6 owns notification policy**. A5's "1 kind" means there is one kind of digest-entry push, and the 3 draft tiers apply on the phone unchanged.
7. Avatar: A5 §3.6 "avatar/initials" → **initials only** (backlog B-D3). No `persons.avatar_url` column is created.

---

## 1. Packages added and changed

| Package | Path | Dependencies (nothing else) | Phase B story |
|---|---|---|---|
| `@omnis/memory` | `packages/memory` | `@omnis/db`, `@omnis/protocol`, `ai`, `pg` | B01, B02, B04, B08~B12 |
| `@omnis/adapter-outlook` | `packages/adapters/outlook` | `@omnis/protocol` | B37 |
| `@omnis/adapter-telegram` | `packages/adapters/telegram` | `@omnis/protocol` | B38 |
| `@omnis/web` | `apps/web` | `@omnis/ui`, `@omnis/protocol`, `@omnis/kernel` (`/zero` subpath only) | B35, B36 |

**Changed dependencies**:
- `@omnis/agents` → depends on `@omnis/protocol`, `@omnis/memory`, `ai`, `pg` (the Phase A contract §1 footnote "remove `@omnis/memory`, unused in Phase A" is lifted here). `@omnis/db` is still not a dependency — the rule that it is injected via `configureAgents({pool})` stands.
- `@omnis/kernel` → unchanged (`@omnis/db`, `@omnis/protocol`).
- `apps/hub` → adds `@omnis/memory`, `@omnis/adapter-outlook`, `@omnis/adapter-telegram`.

**New version pins**: `web-push 3.6.7` (hub sending) · `mtcute 0.29.x` (Telegram sidecar) · `@microsoft/microsoft-graph-client 3.0.7` (Outlook) · `vite-plugin-pwa 0.21.x` (`apps/web`). All other pins are as in Phase A contract §2. **`mem0ai` is not added as a dependency** (§0-1).

**New root scripts** (owner = memory-ingestion plan Task 1 adds **all five at once**. Other plans do not touch this `scripts` block again — delete the step where the agents plan re-added `eval:archive`. The files they point at are created separately by each owning plan):

| Purpose | Command |
|---|---|
| memory recall evaluation | `pnpm eval:memory` = `tsx tools/eval/memory-recall.ts` |
| draft evaluation | `pnpm eval:draft` = `tsx tools/eval/draft.ts` |
| auto-archive evaluation | `pnpm eval:archive` = `tsx tools/eval/auto-archive.ts` |
| Phase B e2e | `pnpm e2e:phase-b` = `tsx tools/e2e/run.ts --phase b` |
| PWA build | `pnpm web:build` = `pnpm --filter @omnis/web build` |

---

## 2. `@omnis/protocol` additional exports

Files: `src/ingest.ts` (2.1), `src/search.ts` (2.2), `src/bridge.ts` (modified, 2.3). All zod + `z.infer`.

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
  max_bytes: z.number().int().positive().default(1_048_576),   // default 1MB (A2 §3.2)
});
export const IngestReadResult = z.object({
  path: z.string(), mtime: z.string().datetime(), bytes: z.number().int(),
  content_b64: z.string(), truncated: z.boolean(),
});

export const MemorySourceKind = z.enum(["inbox","calendar","file","drive","github","self"]);
export const MemoryKind = z.enum(["fact","preference","commitment","event","summary"]);
export type MemorySourceKind = z.infer<typeof MemorySourceKind>;
export type MemoryKind = z.infer<typeof MemoryKind>;

// A4 §10.2 hard exclusion. protocol is the definition owner here — `apps/local-agent` depends on `@omnis/protocol`
// only, yet `ingest.scan`/`ingest.read` must reject paths with the **same list** as the hub.
// `@omnis/memory` only re-exports these two (§3).
export const DENY_PATTERNS: readonly RegExp[];
export function isDenied(path: string): boolean;   // before the allowlist, contents are not inspected
```

Add `"ingest.scan"` and `"ingest.read"` to `HUB_METHODS` (they were unimplemented in Phase A). Path rejection reuses the existing `BridgeError` code `-32005` as-is.

### 2.2 Unified search (A4 §14.4)

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
  groups: z.array(SearchGroup),   // fixed order: people, threads, items, memories
  truncated: z.boolean(),
});
```

### 2.3 Notification and push

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
  body: z.string().max(80),          // body carries only the first 80 chars (A4 §3.6 privacy principle)
  deep_link: z.string(),             // omnis://thread/{id} and similar
  approval_id: z.string().uuid().optional(),   // when present, an Approve action is attached to the notification
});
```

---

## 3. `@omnis/memory` exports (new package)

```ts
// src/embed.ts — T0, Ollama nomic-embed-text-v1.5, 768d
export const EMBED_MODEL = "nomic-embed-text-v1.5";
export const EMBED_DIMS = 768;
export function embed(texts: readonly string[]): Promise<(number[] | null)[]>;  // failures as null
export function toVectorLiteral(v: number[]): string;                            // "[0.1,0.2,…]"

// src/store.ts — owns public.memories directly (B-D1)
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
export function reembedNulls(pool: Pool, limit?: number): Promise<number>;        // retry where embedding IS NULL

// src/search.ts
export interface MemoryHit { memory_id: string; content: string; score: number;
  recorded_at: string; valid_from: string; valid_until: string | null; source_item_id: string | null;
  source_kind: MemorySourceKind; source_ref: string | null; }
export function searchMemories(pool: Pool, q: { query: string; k?: number; kinds?: MemoryKind[]; minScore?: number }): Promise<MemoryHit[]>;

// src/entities.ts — bi-temporal (A3 §5)
export interface EntityInput { type: "person"|"org"|"project"|"commitment"|"decision"|"topic";
  name: string; person_id?: string; attributes?: Record<string, unknown>;
  valid_from: string; valid_until?: string; }
export function upsertEntity(pool: Pool, e: EntityInput): Promise<string>;   // on live conflict, invalidate the existing row and insert a new one
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
export function chunkDocument(text: string): Chunk[];      // 500~800 tokens, 100 overlap
export function chunkCode(path: string, text: string): Chunk[];   // function/class boundaries
// isDenied/DENY_PATTERNS are defined in `@omnis/protocol` (src/ingest.ts, §2.1) and re-exported by `@omnis/memory`.
// That is because `apps/local-agent` depends only on `@omnis/protocol` while having to use the same list (A2 §3.2 path rejection).
export { isDenied, DENY_PATTERNS } from "@omnis/protocol";
export interface IngestSource { id: string; source_kind: MemorySourceKind; source_ref: string;
  cursor: Record<string, unknown>; last_ok_at: string | null; fail_count: number; last_error: string | null; }
export function runIngest(deps: { pool: Pool; logger: Logger; kind: MemorySourceKind }): Promise<{ chunks: number; memories: number; deadLettered: number }>;

export class MemoryEmbedError extends Error {}
export class IngestDeniedError extends Error {}

// --- pinned by the memory-ingestion plan (not in the contract, so added new) ---
export function estimateTokens(s: string): number;            // the §12.3 cap check and the §1.3 truncation use the same estimator
export interface EntityRow { id: string; type: EntityInput["type"]; name: string;
  person_id: string | null; attributes: Record<string, unknown>;
  valid_from: string; valid_until: string | null; recorded_at: string; invalidated_at: string | null; }
export function ensureSelfModelRepo(): Promise<void>;         // US-B02 "repo initialization"
export function overCapWarning(snap: SelfModelSnapshot): string | null;   // system Item text when over cap
export interface IngestDoc { source_ref: string; text: string; meta: Record<string, unknown>; }
export interface IngestProvider { kind: MemorySourceKind;
  list(cursor: Record<string, unknown>): Promise<{ docs: IngestDoc[]; cursor: Record<string, unknown> }>; }
export function registerIngestProvider(p: IngestProvider): void;   // runIngest(deps) has no source slot, so providers are plugged in via a registry
export function resetIngestProviders(): void;
export type Extractor = (chunk: Chunk) => Promise<unknown>;
export function setExtractor(e: Extractor): void;             // keeps the provider SDK isolated (§1 dependency rule)
export function createT1Extractor(model: unknown): Extractor;
export function parseExtractOutput(raw: unknown): { memories: MemoryInput[]; entities: EntityInput[] };
export function chunkCalendarEvent(e: CalendarChunkInput): Chunk;  // 1 event = 1 chunk (A4 §10.3)
export function writeIngestSystemItem(pool: Pool, msg: string): Promise<void>;
export const DEAD_LETTER_THRESHOLD: 3;                        // A4 §10.5
```

---

## 4. `@omnis/agents` additional exports

```ts
// src/loop/spec.ts (A4 §1.1~§1.2)
// LoopId is **newly** exported by `@omnis/agents` — the Phase A contract had `RecordRunInput.loop`
// only as an inline union, with no named type. Its values are literally those same 9.
export type LoopId = "classify"|"draft"|"task"|"delegate"|"digest"|"followup"|"note_route"|"auto_archive"|"ingest";
export type LoopKind = "reactive" | "deliberate";
// The trigger context A4 §1.2 passes to a loop. It was missing from delta v1 (the agents plan Task 1 is the owner).
export interface TriggerContext { loop: LoopId; run_id: string; traceId: string | null;
  firedAt: Date; payload: Record<string, unknown>; }
export interface LoopTrigger { kind: "event"|"schedule"|"manual"; on?: string; where?: string; cron?: string; debounceMs?: number; }
export interface LoopBudget { inputTokens: number; outputTokens: number; wallClockMs: number; maxSteps: number; }
export interface LoopSpec<TOut> {
  id: LoopId; kind: LoopKind; trigger: LoopTrigger;
  palette: ReadonlyArray<ToolName>; budget: LoopBudget; tier: "T0"|"T1"|"T2";
  outputSchema: z.ZodType<TOut>;
  /** Model-free T0 pre-check. Required by A4 §9.2 (auto-archive ①③④ SQL)·§2.2 (classification 3-stage).
   *  Returning false ends the loop without waking the model. It is an optional field, so it does not break existing implementations. */
  decide?(ctx: TriggerContext): Promise<boolean>;
  assemble(ctx: TriggerContext): Promise<AssembledContext>;
  apply(result: LoopResult<TOut>, ctx: TriggerContext): Promise<void>;
}
export interface LoopResult<T> { loop: LoopId; run_id: string; output: T; confidence: number;
  rationale: string; escalate: boolean; injection_flags: string[]; unresolved: string[]; }
export function registerLoop<T>(spec: LoopSpec<T>): void;
export function runLoop(id: LoopId, ctx: TriggerContext): Promise<LoopResult<unknown>>;
/** Lower-level entry point that does not go through the registry. `morningDigestLoop`/`nightlyDigestLoop` share the single `LoopId`
 *  `'digest'`, so their `registerLoop` keys collide — that is why these two are called here. */
export function runLoopSpec<T>(spec: LoopSpec<T>, ctx: TriggerContext): Promise<LoopResult<T>>;
/** `@omnis/agents` does not depend on `@omnis/kernel` (§1). It accepts only the minimal interface that `Kernel`/`Logger`
 *  are structurally assignable to — delta v1's `{kernel: Kernel; logger: Logger}` violated §1. */
export interface LoopKernel { events: { on(...a: unknown[]): unknown; emit(...a: unknown[]): unknown };
  scheduler: { register(name: string, cron: string, fn: () => Promise<void>): void }; }
export interface LoopLogger { info(msg: string, meta?: unknown): void; warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void; }
export function startLoops(deps: { kernel: LoopKernel; logger: LoopLogger }): () => void;
/** The single implementation of "leave it in the inbox as a system Item", repeated throughout A4 §1.6·§9·§12.4.
 *  The 4-line INSERT on the kernel side (`apps/hub/src/archive.ts`) is intentional duplication. */
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
export function normalizeExternal(text: string, nonce: string): string;   // NFKC·zero-width·HTML·base64·URL·8000-char truncation
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

// src/context/* helpers (pinned by memory-ingestion plan Tasks 11 and 12)
export function scanInjection(text: string): string[];        // subset of INJECTION_FLAGS. Separate because normalizeExternal returns only a string
export function setContextBudget(n: number): void;
export const CONTEXT_INPUT_BUDGET_TOKENS: 12000;

// src/loops/*.ts — one per loop; none of them default-exports its LoopSpec, all are exported by name
export const draftLoop: LoopSpec<DraftOutput>;
export const taskLoop: LoopSpec<TaskOutput>;
export const delegateLoop: LoopSpec<DelegateOutput>;
export const autoArchiveLoop: LoopSpec<AutoArchiveOutput>;
export const noteRouteLoop: LoopSpec<RouteOutput>;
export const followupLoop: LoopSpec<FollowupOutput>;
export const morningDigestLoop: LoopSpec<MorningBriefing>;
export const nightlyDigestLoop: LoopSpec<NightlyDigest>;
// `ingestLoop` has been removed — no plan creates it, and L9's real entry point is `@omnis/memory`'s
// `runIngest(deps)`, called directly by the hub cron handler (§3, memory-ingestion Task 17).

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
export function extractHints(text: string): DelegationHints;               // regex, not an LLM
export function routeByRule(h: DelegationHints, hosts: HostHealth): Routing | null;
export const DELEGATION_DAILY_CAP: 5;
export const DELEGATION_THREAD_CAP_24H: 2;

// src/digest/rank.ts (A4 §6.3) — ranking is arithmetic
export function rankBriefItems(rows: BriefCandidate[], now: Date): BriefItem[];
export interface MorningBriefing { greeting: string; sections: BriefSection[]; one_liner: string; }
export interface NightlyDigest { headline: string; auto_archived: DigestGroup[];
  handled: { count: number; by_channel: Record<Channel, number> };
  still_open: BriefItem[]; cost: { month_to_date_usd: number; cap_usd: number; tier_state: CostState };
  agents: { runs: number; failed: number; delegated: number }; }
export interface DigestGroup { reason: string; count: number; samples: BriefItem[]; undo_token: string; }
```

---

## 5. `@omnis/kernel` additional exports

```ts
// src/identity.ts (A3 §10) — US-B03
export function handleNorm(channel: Channel, raw: string, roomExternalId?: string): string;
export function resolvePerson(c: PoolClient, channel: Channel, handle: string, display: string): Promise<{ person_id: string; created: boolean }>;
export function mergePersons(pool: Pool, from: string, to: string, actor: string): Promise<void>;
export function splitIdentity(pool: Pool, identityId: string, toPersonId: string | null, actor: string): Promise<void>;
export function initialsFor(displayName: string): string;     // B-D3, no avatar_url

// src/settings.ts (B-D2) — US-B33
export type SettingKey =
  | "cost.cap_usd" | "cost.reserve_ratio" | "cost.last_state"   // last_state is an internal key — not exposed on the Settings screen
  | "notify.quiet_hours" | "notify.vip_override"
  | "archive.t1_confidence_min" | "archive.enabled"
  | "ingest.local_roots.mini" | "ingest.local_roots.macbook" | "ingest.drive_folders" | "ingest.github_repos"
  | "autonomy.rules" | "kakao.send_enabled_at";
export function getSetting<T>(pool: Pool, key: SettingKey, fallback: T): Promise<T>;
export function setSetting(pool: Pool, key: SettingKey, value: unknown, actor: string): Promise<void>;  // audit_log required
export const SETTING_DEFAULTS: Readonly<Record<SettingKey, unknown>>;   // all 3 allowlist kinds are [] (empty)

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
// when the consecutive-failure threshold is exceeded: accounts.state='broken' + items(kind='system') + ntfy (A6 §8 dual exposure)
```

Fields added to the `Kernel` interface: `settings`, `cost`, `notifier`, `identity`. `KernelDeps` for `createKernel(deps)` gains `vapid?: VapidKeys` (when absent, only Web Push sending is disabled; everything else behaves normally).

---

## 6. `@omnis/db` — migrations 0009~0013

**The Phase A contract §4 sentence "8 files is the entire v1 table set" is updated in Phase B to add 5 more files** (A3 §8 must be fixed the same way — backlog §6-2).

**Ownership (changed in the 2026-09-20 cross review, M1~M3):** `0009`·`0011`·`0012`·`0013` are the **wave 0 schema bundle** — one worktree, one commit, shipped together with `packages/kernel/src/settings.ts` (the `getSetting`/`setSetting`/`SETTING_DEFAULTS` from §5). Reasons:
- The agents plan (Task 7) and the channels plan (Task 5) were each creating `0012` with **different contents** (only the agents version has the `cost_daily` view). The migration runner throws when the sha256 of an already-applied file changes (contract §4), so parallel worktrees cannot split it between them.
- B09·B11·B14 consume `settings` (B33, surfaces) first, and B33 in turn depends on B09/B11/B14/B18 — a **circular dependency**. `push_subscriptions` (B36) and B17 had the same shape.
Merging the bundle first makes all three disappear. **Other plans do not create files under `packages/db/migrations/`** — the single exception is memory-ingestion's `0010`. The ops plan's `0014_cost_report_job.sql` becomes unnecessary under this rule, so it is deleted.

| File | What it creates | Story |
|---|---|---|
| `0009_settings.sql`(W0) | `settings(key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())` + `SETTING_DEFAULTS` seed + `omnis_control` NOTIFY trigger (`{"settings":"<key>"}`) | B33 |
| `0010_ingest_sources.sql` | `ingest_sources(id uuid PK, source_kind text NOT NULL, source_ref text NOT NULL, cursor jsonb NOT NULL DEFAULT '{}', last_ok_at timestamptz, fail_count int NOT NULL DEFAULT 0, last_error text, UNIQUE(source_kind, source_ref))` | B08 |
| `0011_push_subscriptions.sql`(W0) | `push_subscriptions(id uuid PK, endpoint text UNIQUE NOT NULL, p256dh text NOT NULL, auth text NOT NULL, ua text, created_at timestamptz NOT NULL DEFAULT now(), last_ok_at timestamptz, fail_count int NOT NULL DEFAULT 0)` | B36 |
| `0012_jobs_phase_b.sql`(W0) | adds 4 `jobs` seeds (§8 table) + `CREATE VIEW cost_daily` (uses the view definition in the agents plan Task 7 body verbatim) | B14, B15, B37, B44 **consume only** |
| `0013_publication_phase_b.sql`(W0) | `ALTER PUBLICATION zero_omnis ADD TABLE settings;` — `ingest_sources` and `push_subscriptions` are **not added** | B33 |

- **There is no new NOTIFY channel.** A `settings` change carries `{"settings":"<key>"}` on the existing `omnis_control` to invalidate the hub cache. `NOTIFY_CHANNELS` stays at 7.
- **Existing migrations are not touched.** `accounts_channel_ck` already includes `outlook` and `telegram` (measured in 0002) — no new migration needed.
- `memories`/`entities`/`relations`/`tasks`/`notes`/`digests`/`persons` have **no column changes**. Every value Phase B requires is expressed with existing columns and `items.meta`/`threads.meta`.

---

## 7. Hub HTTP routes added

Added to the table in Phase A contract §5. All bind to `127.0.0.1:8787`, mount under Tailscale Serve `/api/`, and use `application/json`.

| Method and path | body | Response | Story |
|---|---|---|---|
| `GET /search?q&k&scope&since` | — | `SearchResponse` (§2.2) | B26 |
| `GET /memory/search?q&k&kinds` | — | `{ results: MemoryHit[] }` (the path foreshadowed in A3 §7) | B26 |
| `GET /transcript/:session_id?last_n` | — | `SessionSummary` (A3 §7) | ~~B39~~ → **surfaces plan Task 11** (reassigned in M8 of the 2026-09-20 cross review; that task has been written). The channels plan's US-B39 deliverable is only `apps/local-agent/src/bridges/hermes.ts`, so it does not implement this hub route |
| `GET /settings` | — | `{ settings: Record<SettingKey, unknown> }` | B33 |
| `PUT /settings/:key` | `{ value: unknown }` | `{ key, value }` — `audit_log` required | B33 |
| `POST /items/:id/unarchive` | — | `{ id, status: "received" }` | B32 |
| `POST /digests/:id/undo` | `{ undo_token: string }` | `{ restored: number }` | B32 |
| `GET /push/vapid-public-key` | — | `{ key: string }` (503 when the secret is unset) | B36 |
| `POST /push/subscribe` | `PushSubscription` (§2.3) | `{ id: string }` | B36 |
| `DELETE /push/subscribe` | `{ endpoint: string }` | `{ removed: boolean }` | B36 |
| `POST /approvals/:id/decide` | (existing) | (existing) — **the Web Push `Approve` action uses this path as-is.** No new path is created | B36 |
| `GET /cost` | — | `{ state: CostState, mtdUsd, capUsd, reserveUsd, policy: Policy }` | B33 |
| `POST /notes/:id/route` | `{ accept: boolean; thread_id?: string; person_id?: string }` | `{ route_state: string }` — accept/reject of an L7 proposal. This route was not in delta v1 | B31 |

`GET /` and static assets: Tailscale Serve serves the `apps/web` build output (not the hub process — `tailscale serve --bg --https=443 / localhost:5173/`, A6 §3). The hub exposes the API only.

---

## 8. Jobs (cron) added

The 10 items in the A4 §6.1 table (the source of truth) plus the 6 infrastructure items in A3 §6 are **already seeded in `0006_kernel.sql`** (measured). Only what Phase B adds:

| Job name | cron (TZ=Asia/Seoul) | What it does | Owner | Story |
|---|---|---|---|---|
| `cost_daily` | `5 0 * * *` | `agent_runs` → `cost_daily` aggregation + `CostState` transition detection | A4 §12.4 | B14 |
| `push_batch` | `0 9,12,15,18 * * *` | sends batched-tier notifications as a single "N drafts ready" message | A4 §3.6 | B15 |
| `outlook_delta_poll` | `*/5 * * * *` | Graph delta polling (the stage before webhook) | A1 §2.4 | B37 |
| `cost_report_monthly` | `10 0 1 * *` | monthly report → `digests.metrics` | A4 §12.4 | B44 |

**Handlers attached to existing jobs** (the seeds already exist and Phase B fills in the implementations): `morning_digest`(B23), `nightly_digest`(B24), `memory_consolidate`(B24), `auto_archive_sweep`(B18), `task_remind`(B19), `network_inactive_sweep`(B22), `self_model_weekly`(B25), `drive_poll`(B11, riding along with the MacBook `ingest.scan` B10), `github_poll`(B11), `eval_weekly`(B12), `token_refresh`/`gmail_rewatch`/`graph_sub_renew`(B40).

Backups (`pg_dump`·restic) and healthcheck pings are **launchd, not the `jobs` table** (owned by A6 §1·§4, B41·B42).

---

## 9. Environment variables · Keychain additions

**Environment variables** (added to Phase A contract §9; all `OMNIS_`-prefixed + upper snake case):

| Name | Default | Used by |
|---|---|---|
| `OMNIS_SELF_MODEL_DIR` | `~/.omnis/self-model` | `@omnis/memory` self-model loader (§0-2) |
| `OMNIS_OLLAMA_EMBED_MODEL` | `nomic-embed-text-v1.5` | `@omnis/memory` embed |
| `OMNIS_ANTHROPIC_API_KEY` | — | T2 (Claude Sonnet 5) + Message Batches. Without it the T2 path is skipped and a system Item appears |
| `OMNIS_WEBPUSH_VAPID_PUBLIC` / `OMNIS_WEBPUSH_VAPID_PRIVATE` | — | hub Web Push sending. When unset, `/push/*` returns 503 |
| `OMNIS_WEBPUSH_SUBJECT` | `mailto:281932556+jinhologankim@users.noreply.github.com` | VAPID `sub` claim |
| `OMNIS_WEB_PORT` | `5173` | `apps/web` dev and static-serving port (the serve target in A6 §3) |
| `OMNIS_GITHUB_TOKEN` | — | GitHub ETag polling (PAT; the App is S-A4-6) |
| `OMNIS_OUTLOOK_CLIENT_ID` / `OMNIS_OUTLOOK_TENANT` | — / `common` | Outlook OAuth |
| `OMNIS_TELEGRAM_API_ID` / `OMNIS_TELEGRAM_API_HASH` | — | mtcute. **never put these in logs or error messages** |
| `HERMES_BASE_URL` | `http://127.0.0.1:8642` | already in the Phase A contract — Phase B is the first to use it |
| `OMNIS_OPENROUTER_API_KEY` | — | synchronous T2 (`anthropic/claude-sonnet-5`) and T1 extraction. To avoid a new SDK pin, synchronous T2 goes through OpenRouter and only the Batch API uses a direct Anthropic `fetch` — the US-B44 report must account for `agent_runs.provider` being recorded as `openrouter` on synchronous T2. An empty value skips that path (B-D5 test fallback) |
| `OMNIS_NTFY_URL` | `http://127.0.0.1:2586` | self-hosted ntfy. Two topics, `omnis-critical`/`omnis-warning` (A6 §8). `@omnis/kernel`'s `sendNtfy` (channels) and `ops/scripts/healthcheck-ping.sh` (ops) use the same value |

**Keychain entries** (A6 §9 dotted scheme `omnis.<service>.<kind>`, account = `281932556+jinhologankim@users.noreply.github.com`):

`omnis.webpush.vapid_private` · `omnis.webpush.vapid_public` · `omnis.anthropic.api_key` · `omnis.github.pat` · `omnis.outlook.<upn>` · `omnis.telegram.session_key` · `omnis.hermes.api_key.mini` · `omnis.hermes.api_key.macbook` (the last two are already reserved in Phase A contract §8). `omnis.openrouter.api_key`(synchronous T2 and T1 extraction) · `omnis.healthchecks.<slug>`(ping UUIDs for 15 checks) · `omnis.restic.repo_password` · `omnis.b2.app_key`(backups, US-B41). The DeepSeek key reads the existing `deepseek-api` entry as-is (A6 §9 reuse-existing-assets rule).

---

## 10. Zero replication scope changes

| Table | Replication | Why |
|---|---|---|
| `settings` | **included**(`0013`) | The Settings screen and the PWA read the values. Writes happen only through the hub's `PUT /settings/:key` |
| `ingest_sources` | excluded | Polling cursor. The client never has a reason to write it |
| `push_subscriptions` | excluded | Endpoint and keys are server-only |
| `memories`·`entities`·`relations` | **still excluded** | As in A3 §7. 768d × many rows are not pushed to the phone — `GET /search` and `GET /memory/search` are the only paths |
| `items`(column list) | **unchanged** | `meta` is already included, so `meta.archived_by`·`meta.pending` flow down as-is |
| `persons` | **unchanged** | Initials are computed from `display_name` (B-D3) |

One entry, `"settings"`, is added to `ZERO_TABLES`, and `assertZeroPublication` catches that difference at boot. **Permission rule**: `settings` gets `row.select` only — Phase B keeps the Phase A deviation (every replicated table read-only, writes over hub HTTP) exactly as it is. Unless `zero:deploy-permissions` is re-run after `0013` is applied, zero-cache will not send down a single row.

---

## 11. Story → plan file → symbols

| Story | Plan file | Symbols pinned by this document |
|---|---|---|
| US-B01, B08~B12 | `…-phase-b-memory-ingestion.md` | all of §3 (`embed`/`upsertMemory`/`searchMemories`/`invalidateBySource`/`chunk*`/`isDenied`/`runIngest`) |
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
| US-B28~B32 | 〃 | §7 `POST /items/:id/unarchive`·`POST /digests/:id/undo`, §4 digest types |
| US-B33 | 〃 | §5 `SettingKey`/`getSetting`/`setSetting`/`SETTING_DEFAULTS`, §6 `0009`, §7 `/settings`·`/cost` |
| US-B35, B36 | 〃 | §1 `@omnis/web`, §2.3 `PushSubscription`, §6 `0011`, §7 `/push/*` |
| US-B37, B38 | `…-phase-b-channels.md` | §1 the 2 adapter packages, §8 `outlook_delta_poll` |
| US-B39 | 〃 | the HTTP-form `[[runtime]]` block in Phase A contract §8 (`kind="hermes"`, `session_header_mode="hermes_v1"`) |
| US-B40 | 〃 | §5 `recordAdapterHealth` |
| US-B45 | 〃 | no new symbols — it actually fills in §3.2 `Adapter`/`AuthRef` (Phase A contract) and `createHubServer({adapters})` (an optional argument that already exists). `apps/hub/src/adapters.ts` newly exports `AdapterFactories`/`buildAdapters`/`startAdapterLoops` |
| US-B16, B34, B41~B44 | `…-phase-b-ops.md` | §9 Keychain and environment variables, §8 `cost_report_monthly`. **`0014_cost_report_job.sql` is not created** — `0012` in the §6 W0 bundle already carries this seed |
| (schema prerequisite) | **wave 0 bundle** — a single commit that belongs to no plan document | the `0009`·`0011`·`0012`·`0013` from §6 + `packages/kernel/src/settings.ts` from §5. B09·B11·B14·B15·B17·B33·B36·B37·B44 all wait on it |

---

## 12. Shared convention changes

- **Logging**: as in Phase A §9. `@omnis/memory`'s `pkg` value is `"@omnis/memory"`. Embedding vectors, file contents and push endpoints are **never put in any key**.
- **Error classes**: the 7 from Phase A gain `MemoryEmbedError` and `IngestDeniedError` (`@omnis/memory`), plus `PhantomToolError` (`@omnis/agents`). All keep `name` equal to the class name.
- **Adapter contract test fixtures**: Outlook and Telegram use the same layout as Phase A (`packages/adapters/<channel>/fixtures/<scenario>.json`). The minimum scenarios are Phase A's 5, plus `edited_message.json` and `deleted_message.json` for Telegram (A1 §1.7).
- **Branch and commit**: as in Phase A. The title is `US-B05: context assembler and data normalization`, the body carries acceptance criteria + `Implemented-by: …`, and the last line is `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- **Intentional duplication kept**: `createLogger` and `readKeychainSecret` stay per-package. `@omnis/memory` likewise uses only the `Logger` **type** from `@omnis/kernel` and keeps its own implementation (package dependency rule §1).
