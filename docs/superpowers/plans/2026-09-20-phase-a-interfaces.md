# Phase A 인터페이스 계약 (2026-09-20)

6개 계획 문서가 서로 다른 이름을 쓰지 않도록 **이름과 시그니처만** 고정한다. 여기 적힌 식별자는 계획 작성자가 **그대로 복사**한다. 설계 논의는 없다 — 근거는 부록에 있다.

## 0. 부록 충돌 판정 (A7 §1 의존 규칙 기준, 각 1줄)

1. `packages/bridge-protocol`(A2 §1.1 주석) → **`@omnis/protocol`의 `src/bridge.ts`**(A7 §1이 protocol을 유일 리프로 고정, A7 §7 US-A16이 정본 경로).
2. `packages/adapters/agent-bridge`(A7 §1 트리) vs `apps/local-agent/src/bridges/*`(A7 §7 US-A18·A19) → **Phase A는 후자만 만든다**. RuntimeAdapter는 자식 프로세스를 spawn하므로 "protocol에만 의존하는 순수 정규화 계층"이라는 `packages/adapters/*` 규칙을 만족하지 못한다. `@omnis/adapter-agent-bridge` 패키지는 Phase A에 존재하지 않는다.
3. `OMNIS_DB_URL`(A3 §8 러너 예시) vs `DATABASE_URL`(A6 §1·§9) → **`DATABASE_URL`**(비밀 주입 오너가 A6이고 wrapper가 export하는 이름이 실행 시 정본).
4. `schema_migrations`/`0001_core.sql` → **`_omnis_migrations` + A3 §8의 8파일**(A3가 스키마 오너, A7 수정이력이 이미 정정).
5. A4 §1.7의 `tier`/`input_tokens`/`status`/`started_at` → **A3 §4 컬럼명**(`model_tier`/`tokens_in`/`outcome`/`created_at`).
6. `pending_approvals.action` 4값(A7 §1 본문) vs 6값(A3 `approvals_action_ck`) → **A3의 6값**.
7. Keychain `omnis.<host>.session_bus_token`(구 A6 §9) → **`omnis.bridge.token.<host>`**(A2 §2.1 리터럴).
8. 허브 외부 base URL: A2 §2.1 `wss://…/bridge` vs A6 §3 `tailscale serve /api/ → localhost:8787/` → **A6 §3이 마운트 오너**이므로 외부 base는 `https://<mini>.ts.net/api`, 브리지는 `wss://<mini>.ts.net/api/bridge`.
9. ephemeral 티어: 마스터 §7 "NOTIFY 또는 WS" vs A3-D14 "NOTIFY를 타지 않는다" → **WS 팬아웃 전용**(A3-D14가 더 구체적이고 후행).
10. 커밋 메시지: Conventional Commits 접두 대신 **A7 §6의 `<story-id>: <한 줄 요약>`**.

## 1. 패키지 이름과 경로

| 패키지명 | 경로 | 의존(이 외 금지) | Phase A 스토리 |
|---|---|---|---|
| `@omnis/protocol` | `packages/protocol` | 없음(리프, `zod`만) | A11, A16 |
| `@omnis/db` | `packages/db` | `pg` | A01~A04 |
| `@omnis/kernel` | `packages/kernel` | `@omnis/db`, `@omnis/protocol` | A05~A09, A21 |
| `@omnis/memory` | `packages/memory` | `@omnis/db`, `@omnis/protocol` | Phase B(스캐폴드만) |
| `@omnis/adapter-slack` | `packages/adapters/slack` | `@omnis/protocol` | A12, A15 |
| `@omnis/adapter-gmail` | `packages/adapters/gmail` | `@omnis/protocol` | A13, A15 |
| `@omnis/adapter-google-calendar` | `packages/adapters/google-calendar` | `@omnis/protocol` | A14, A15 |
| `@omnis/agents` | `packages/agents` | `@omnis/protocol`, `ai`, `pg` | A22b, A23, A23b |
| `@omnis/ui` | `packages/ui` | React만 | A24 |
| `@omnis/hub` | `apps/hub` | 모든 `packages/*` | A10 |
| `@omnis/desktop` | `apps/desktop` | `@omnis/ui`, `@omnis/protocol`, `@omnis/kernel`(`/zero` 서브패스만) | A22, A25~A31 |
| `@omnis/web` | `apps/web` | 동일 | Phase B |
| `@omnis/local-agent` | `apps/local-agent` | `@omnis/protocol` | A17~A20 |

- 디렉터리명 `google-calendar` ≠ `accounts.channel` 값 `gcal`(A3 §1.1). 둘은 다른 네임스페이스이고, 어댑터가 `export const CHANNEL = 'gcal' as const`로 잇는다.
- `tools/spikes/*`는 워크스페이스 밖(`pnpm-workspace.yaml`에 넣지 않는다).
- `@omnis/agents`는 `ClassifyCtx.pool: Pool`이 이미 `pg`를 요구하므로 `pg`를 직접 의존한다. `@omnis/memory`는 Phase A에서 쓰지 않는다(스캐폴드만).
- `@omnis/desktop`은 `@omnis/kernel`을 통째로 import하지 않고 `@omnis/kernel/zero` 서브패스만 쓴다(§7). 그래도 `apps/desktop/package.json`에 `"@omnis/kernel": "workspace:*"`를 **선언한다**.

## 2. 툴체인 명령 (A7 §2 그대로)

pnpm workspaces · Node 22 · TypeScript strict(`strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`, 루트 `tsconfig.base.json`) · Biome 1개 · vitest · ORM 없음.

| 목적 | 명령 |
|---|---|
| 패키지 테스트 | `pnpm --filter @omnis/<name> test` |
| 타입체크(전체) | `pnpm typecheck` = `tsc --build --force` |
| 린트 / 포맷 | `pnpm lint` = `biome check` / `pnpm format` = `biome check --write` |
| 전체 테스트 | `pnpm test` = `vitest run` |
| 계약 / 통합 | `pnpm test:contract` = `vitest run --project contract` · `pnpm test:integration` = `vitest run --project integration` |
| 마이그레이션 | `pnpm db:migrate` · `pnpm db:migrate:create <name>` · `pnpm db:seed` |
| Tauri | `pnpm tauri:dev` · `pnpm tauri:build`(= `pnpm --filter @omnis/desktop tauri dev|build`) |
| 개발 | `pnpm dev`(hub + desktop 동시) · `pnpm build` = `tsc --build` |

vitest 프로젝트 이름은 `unit`(기본) / `contract` / `integration` 셋으로 고정한다(루트 `vitest.workspace.ts`). `unit` 프로젝트의 include는 `*.test.ts`와 **`*.test.tsx`를 둘 다** 덮는다(`packages/ui`·`apps/desktop`의 tsx 테스트가 `pnpm test`에서 조용히 스킵되지 않도록).

**루트 파일 오너 = kernel-and-db Task 1.** 루트 `package.json`·`pnpm-workspace.yaml`·`tsconfig.base.json`·`biome.jsonc`·`vitest.workspace.ts`는 `2026-09-20-phase-a-kernel-and-db.md`의 Task 1만 생성한다. 다른 모든 계획의 루트 스캐폴드 스텝은 삭제하고 "루트 스캐폴드는 kernel-and-db Task 1이 만든다 — 존재를 확인만 한다(`test -f`)"로 대체한다.

**버전 핀(FIXED, 전 워크스페이스 동일)**: `vitest 2.1.9` · `zod ^3.24.1`(오너 = `@omnis/protocol`, **어느 패키지도 zod 4를 쓰지 않는다**) · `pg 8.13.1` · `typescript 5.6.3` · `packageManager pnpm@9.12.3` · `@rocicorp/zero 1.9.0`(exact, caret 금지) · `ai 7.0.107`.

위 표의 `pnpm dev`(hub + desktop 동시) · `pnpm tauri:dev` · `pnpm tauri:build` · `pnpm db:migrate`는 전부 **루트 `package.json`의 `scripts` 항목**이다(kernel-and-db Task 1이 같이 쓴다).

**DB 드라이버**: `pg` 8.x 고정(A3 §8 러너가 `import { Client } from "pg"`). ORM 없음, 타입드 thin wrapper는 `@omnis/db`가 제공(§4).

**통합 테스트 DB**: 컨테이너 없이 로컬 네이티브 Postgres 17(`brew install postgresql@17` + `pgvector`). 개발 DB는 `omnis`, 테스트 DB는 **`omnis_test`** 고정. 테스트는 `DATABASE_URL`을 읽고, 없으면 `postgres://logan@127.0.0.1:5432/omnis_test`를 기본값으로 쓴다. 리셋 전략은 `vitest` `globalSetup` 1개: `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` → `migrate(pool, MIGRATIONS_DIR)`. 파일별 트랜잭션 롤백은 쓰지 않는다(트리거·NOTIFY를 검증해야 하므로). CI는 GitHub Actions `postgres:17` 서비스 컨테이너, 경로 필터는 A7-D7.

## 3. `@omnis/protocol` exports

전부 zod 스키마 + `z.infer` 타입. 파일: `src/adapter.ts`(3.1~3.3), `src/approval.ts`(3.4), `src/bridge.ts`(3.5), `src/index.ts`(re-export).

### 3.1 값 집합·브랜디드 타입

```ts
import { z } from "zod";

export const Channel = z.enum(["slack","gmail","gcal","outlook","telegram","whatsapp","kakaotalk","linkedin","agent","system"]);
export const ThreadKind = z.enum(["dm","group","email","agent_session","calendar","system"]);
export const ItemKind = z.enum(["message","email","event","agent_turn","tool_call","system"]);
export const ItemStatus = z.enum(["received","read","draft","approved","sent","failed","archived"]);
export const Scope = z.enum(["work","personal","unknown"]);
export const Sensitivity = z.enum(["normal","personal","finance","legal","health"]);
export const HostId = z.enum(["mini","macbook"]);
export const RuntimeKind = z.enum(["claude_code","codex","claude_ds","hermes","omnis"]);
export type Channel = z.infer<typeof Channel>;   // 이하 모든 enum 동일 패턴

declare const brand: unique symbol;
export type SessionKey = string & { readonly [brand]: "SessionKey" }; // `agent:{runtime}:{host}:{purpose}`, ':'→'-' 치환, ≤256자
export type SessionId  = string & { readonly [brand]: "SessionId" };  // 런타임이 준 트랜스크립트 id, 회전함
export const SessionKey = z.string().min(1).max(256).regex(/^agent:[a-z_]+:(mini|macbook):[A-Za-z0-9_-]+$/).transform(s => s as SessionKey);
export const SessionId  = z.string().min(1).transform(s => s as SessionId);
```

### 3.2 Capabilities / NormalizedThread / NormalizedItem (A1 §1.1~1.2)

```ts
export const Capabilities = z.object({
  read: z.boolean(), write: z.boolean(), realtime: z.boolean(), history: z.boolean(),
  media: z.boolean(), markRead: z.boolean(), typing: z.boolean(),
  archive: z.boolean(), delete: z.boolean(),      // v1 전 채널 delete=false
});

export const ParticipantRef = z.object({
  externalId: z.string(), displayName: z.string(), personId: z.string().uuid().optional(), // 어댑터는 항상 비운다
});

export const NormalizedThread = z.object({
  externalId: z.string(), kind: ThreadKind, title: z.string().nullable(),
  participants: z.array(ParticipantRef), lastItemAt: z.string().datetime(), archivedAt: z.string().datetime().nullable(),
});

export const Attachment = z.object({
  kind: z.enum(["image","file","audio","video","link"]),
  url: z.string().optional(), mimeType: z.string().optional(),
  sizeBytes: z.number().int().optional(), caption: z.string().optional(),
});

export const NormalizedItem = z.object({
  threadExternalId: z.string(), externalId: z.string(), kind: ItemKind,
  author: z.object({ kind: z.enum(["person","agent","system"]), id: z.string() }),
  body: z.string(), bodyHtml: z.string().optional(), attachments: z.array(Attachment),
  sentAt: z.string().datetime(), status: z.literal("received"),
  sourceHash: z.string(), threadMeta: NormalizedThread.optional(),
});
```

**author → A3 3컬럼 매핑(커널 write path가 수행, 어댑터는 관여 안 함)**: `kind:'person'` → `author_person_id`(persons 해석 후), `kind:'agent'` → `author_agent_id`(→`agent_runtimes.id`), `kind:'system'` → 둘 다 NULL. `author_is_me`는 커널이 내 identity와 대조해 세운다. 어댑터는 `person`만 만든다. `sensitivity`/`scope`는 어댑터가 쓰지 않는다(L1이 유일 생산자, A4 §2.4).

### 3.3 AdapterEvent / AuthRef / Adapter (A1 §1.3·§1.6 그대로)

```ts
export const AdapterEvent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("connected"), at: z.string().datetime() }),
  z.object({ kind: z.literal("disconnected"), reason: z.string(), at: z.string().datetime() }),
  z.object({ kind: z.literal("auth_required"), reason: z.string(), authUrl: z.string().optional(), at: z.string().datetime() }),
  z.object({ kind: z.literal("rate_limited"), retryAfterMs: z.number().int(), endpoint: z.string(), at: z.string().datetime() }),
  z.object({ kind: z.literal("backfill_progress"), done: z.number().int(), total: z.number().int().nullable(), at: z.string().datetime() }),
]);

export const AuthRef = z.object({            // 토큰 값은 절대 담지 않는다
  channel: Channel, accountExternalId: z.string(),
  keychainService: z.string(), keychainAccount: z.string(),
});

export type AdapterErrorKind = "retryable_network"|"retryable_rate_limit"|"auth_expired"|"auth_revoked"|"fatal_protocol"|"fatal_unsupported";
export class AdapterError extends Error {
  constructor(readonly kind: AdapterErrorKind, readonly channel: Channel,
              message: string, readonly retryAfterMs?: number, readonly cause?: unknown) { super(message); this.name = "AdapterError"; }
}

export interface Health { channel: Channel; accountExternalId: string; status: "healthy"|"degraded"|"down";
  lastEventAt: string | null; lastError?: { kind: AdapterErrorKind; message: string; at: string }; latencyMsP50?: number; }

export interface ThreadRef { accountId: string; externalId: string; }
export interface OutboundAttachment { kind: "image"|"file"; localPath: string; mimeType: string; caption?: string; }
export interface Outbound { text: string; bodyHtml?: string; attachments?: OutboundAttachment[]; replyToExternalId?: string; }
export interface SendResult { externalId: string; sentAt: string; }

export interface Adapter {
  id: string; channel: Channel;
  capabilities(): Capabilities;
  connect(auth: AuthRef): Promise<void>;
  disconnect?(): Promise<void>;
  backfill(since?: Date): AsyncIterable<NormalizedItem>;
  subscribe(): AsyncIterable<NormalizedItem | AdapterEvent>;
  send(thread: ThreadRef, draft: Outbound): Promise<SendResult>;   // 승인 후에만 호출된다
  markRead?(thread: ThreadRef): Promise<void>;
  archive?(thread: ThreadRef): Promise<void>;
  health(): Promise<Health>;
}
/** 계약 테스트용 순수 함수. 어댑터 모듈이 Adapter와 별개로 named export 한다. */
export type Normalize = (raw: unknown) => NormalizedItem[];
/** 허브가 어댑터에 주입하는 싱크. A2 §3.2의 `ingest.scan/read` RPC와 무관한 이름이다. */
export type IngestSink = (accountId: string, e: NormalizedItem | AdapterEvent) => Promise<void>;
```

### 3.4 승인 (A3 §4 / A4 / `22`)

```ts
export const ApprovalAction = z.enum(["send","delete","calendar_write","delegate","self_model_edit","memory_write"]);
export const ApprovalState  = z.enum(["pending","decided","executing","executed","failed","expired"]);
export const ApprovalDecision = z.enum(["accept","edit","respond","ignore"]);
export const ApprovalRisk = z.enum(["normal","high"]);

export const HumanInterrupt = z.object({
  action: ApprovalAction, args: z.record(z.unknown()), description: z.string(),
  config: z.object({ allow_accept: z.boolean(), allow_edit: z.boolean(), allow_respond: z.boolean(), allow_ignore: z.boolean() })
          .default({ allow_accept:true, allow_edit:true, allow_respond:false, allow_ignore:true }),
  risk: ApprovalRisk.default("normal"),
  requested_by: z.string().uuid().optional(), thread_id: z.string().uuid().optional(),
  item_id: z.string().uuid().optional(), task_id: z.string().uuid().optional(),
  expires_at: z.string().datetime().optional(),
});

export const HumanResponse = z.object({ decision: ApprovalDecision, decided_args: z.record(z.unknown()).optional() });
```

### 3.5 브리지 프로토콜 (A2 §1·§3)

```ts
/** A2 §7.1. profile은 origin과 purpose에서만 결정되고 프롬프트로 바뀌지 않는다. */
export const PermissionProfile = z.enum(["observe", "workspace", "trusted"]);
export type PermissionProfile = z.infer<typeof PermissionProfile>;

export const SessionOrigin = z.enum(["human", "delegation", "job"]);
export type SessionOrigin = z.infer<typeof SessionOrigin>;

export const SessionState = z.enum(["idle", "running", "awaiting_approval", "failed", "closed"]);
export type SessionState = z.infer<typeof SessionState>;

export const RuntimeState = z.enum(["online", "degraded", "offline"]);
export type RuntimeState = z.infer<typeof RuntimeState>;

export const RuntimeCapabilities = z.object({           // capabilities 자기기술 (A2 §1.2)
  resume: z.boolean(), cross_project_resume: z.boolean(), stream_deltas: z.boolean(),
  reasoning_stream: z.boolean(), tool_calls: z.boolean(),
  approvals: z.enum(["native","hook","none"]), cancel: z.boolean(),
  models: z.array(z.string()), features: z.array(z.string()),   // 런타임 원문 통과
});

export const AgentRuntime = z.object({
  id: z.string().uuid(), runtime: RuntimeKind, host: HostId, version: z.string(),
  capabilities: RuntimeCapabilities, transport: z.enum(["process","http"]),
  binary_path: z.string().nullable(), allowed_roots: z.array(z.string()),
  base_url: z.string().nullable(), state: z.enum(["online","degraded","offline"]),
  last_health_at: z.string().datetime(),
});

export const PROTOCOL_VERSION = "2026-09-20" as const;
export const META_KEYS = { protocolVersion: "ai.omnis/protocolVersion", traceId: "ai.omnis/traceId", origin: "ai.omnis/origin" } as const;

/** hub → bridge 요청 (A2 §3.2) */
export const HUB_METHODS = ["bridge/discover","session.create","session.resume","turn.start","turn.cancel",
  "session.read_summary","delegate.run","session.close","ingest.scan","ingest.read"] as const;
/** bridge → hub (A2 §3.3). approval.requested만 요청, 나머지는 알림 */
export const BRIDGE_METHODS = ["runtime.registered","session.registered","turn.started","turn.item.started",
  "turn.item.delta","turn.item.completed","turn.completed","approval.requested","health"] as const;
export type HubMethod = typeof HUB_METHODS[number];
export type BridgeMethod = typeof BRIDGE_METHODS[number];

/** JSON-RPC 2.0 표준 코드. A2 §3.4가 omnis 범위를 이 위에 얹는다. */
export const JSONRPC_ERRORS = {
  PARSE: -32700, INVALID_REQUEST: -32600, METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602, INTERNAL: -32603,
} as const;

export const BRIDGE_ERRORS = {
  SESSION_NOT_FOUND: -32001, RUNTIME_UNAVAILABLE: -32002, CAPABILITY_UNSUPPORTED: -32003,
  TURN_ALREADY_ACTIVE: -32004, PATH_NOT_ALLOWED: -32005, APPROVAL_REQUIRED: -32006,
  TURN_TIMEOUT: -32007, TURN_CANCELLED: -32008, RUNTIME_RATE_LIMITED: -32009,
  VERSION_UNSUPPORTED: -32010, AUTH_FAILED: -32011, BUDGET_EXCEEDED: -32012,
} as const;
export type BridgeErrorCode =
  | typeof BRIDGE_ERRORS[keyof typeof BRIDGE_ERRORS]
  | typeof JSONRPC_ERRORS[keyof typeof JSONRPC_ERRORS];
export class BridgeError extends Error { constructor(readonly code: BridgeErrorCode, message: string, readonly data?: unknown) { super(message); this.name = "BridgeError"; } }

export function toJsonRpcError(e: unknown): { code: number; message: string; data?: unknown } {
  if (e instanceof BridgeError) {
    return e.data === undefined
      ? { code: e.code, message: e.message }
      : { code: e.code, message: e.message, data: e.data };
  }
  return { code: JSONRPC_ERRORS.INTERNAL, message: e instanceof Error ? e.message : String(e) };
}

export const SUPPORTED_PROTOCOL_VERSIONS = [PROTOCOL_VERSION] as const;

export const RpcMeta = z.object({
  [META_KEYS.protocolVersion]: z.string(),
  [META_KEYS.traceId]: z.string().optional(),
  [META_KEYS.origin]: SessionOrigin.optional(),
}).passthrough();

export function withMeta<P extends Record<string, unknown>>(
  params: P,
  meta?: { traceId?: string; origin?: SessionOrigin },
): P & { _meta: Record<string, string> } {
  const _meta: Record<string, string> = { [META_KEYS.protocolVersion]: PROTOCOL_VERSION };
  if (meta?.traceId !== undefined) _meta[META_KEYS.traceId] = meta.traceId;
  if (meta?.origin !== undefined) _meta[META_KEYS.origin] = meta.origin;
  return { ...params, _meta };
}

/** A2-D3: 버전 불일치는 연결을 끊지 않고 이 요청만 -32010으로 거절한다. */
export function assertProtocolVersion(params: unknown): void {
  const meta = (params as { _meta?: unknown } | null | undefined)?._meta;
  const parsed = RpcMeta.safeParse(meta);
  const version = parsed.success ? parsed.data[META_KEYS.protocolVersion] : undefined;
  if (version === undefined || !SUPPORTED_PROTOCOL_VERSIONS.includes(version as typeof PROTOCOL_VERSION)) {
    throw new BridgeError(
      BRIDGE_ERRORS.VERSION_UNSUPPORTED,
      `unsupported protocol version: ${version ?? "<missing>"}`,
      { supported: [...SUPPORTED_PROTOCOL_VERSIONS] },
    );
  }
}
```

`turn.item.delta`는 ephemeral이라 어떤 row도 만들지 않는다. `kind`는 `agent_turn` / `tool_call` 둘뿐이다(reasoning은 item이 아니다).

## 4. `@omnis/db` exports

```ts
export function createPool(env: NodeJS.ProcessEnv = process.env): Pool;  // DATABASE_URL 필수, 없으면 즉시 throw. max=10, application_name='omnis-hub'
export function migrate(pool: Pool, dir: string): Promise<{ applied: string[] }>;
export function query<T>(pool: Pool | PoolClient, sql: string, params?: readonly unknown[]): Promise<T[]>;
export function one<T>(pool: Pool | PoolClient, sql: string, params?: readonly unknown[]): Promise<T>;   // row ≠ 1이면 throw
export function tx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T>;
export const MIGRATIONS_DIR: string;   // packages/db/migrations 절대경로
export const NOTIFY_CHANNELS: readonly string[];
```

`migrate()` 의미(A3 §8 러너 그대로): `_omnis_migrations(name text PRIMARY KEY, sha text NOT NULL, applied_at timestamptz DEFAULT now())` 부트스트랩 → `pg_advisory_lock(8931447)` → `*.sql` 정렬 → 각 파일 sha256 비교(같으면 skip, 다르면 `migration <f> changed after apply` throw) → `.noxact.sql`이 아니면 `BEGIN/COMMIT`으로 감싸 실행 → `_omnis_migrations` insert → `finally`에서 advisory unlock. forward-only, 롤백 없음. 검증 = `pnpm db:migrate` 2연속 실행이 no-op.

마이그레이션 파일 8개(A3 §8, 이 목록이 v1 테이블 전체다):

| 파일 | 만드는 테이블 |
|---|---|
| `0001_extensions.sql` | `pgcrypto`·`vector`·`pg_trgm` + 역할 `omnis_owner`/`omnis_hub`/`omnis_sync` |
| `0002_core_inbox.sql` | `accounts`, `account_secrets`, `persons`, `identities`, `person_merges`, `agent_runtimes`(+`omnis` 1 row seed), `threads`, `items`(+부분 HNSW), `calendar_events` |
| `0003_labels.sql` | `labels`, `label_rules`, `item_labels`, `thread_labels` |
| `0004_tasks_approvals.sql` | `agent_sessions`, `agent_runs`, `tasks`, `pending_approvals`, `notes`, `digests` |
| `0005_memory.sql` | `entities`, `relations`, `memories` + HNSW |
| `0006_kernel.sql` | `events`, `audit_log`, `jobs`(+seed) + append-only 트리거 + `omnis_events_rolloff()` + GRANT |
| `0007_notify.sql` | NOTIFY 함수·트리거 |
| `0008_publication.sql` | `CREATE PUBLICATION zero_omnis`(컬럼 리스트 포함) |

NOTIFY 채널(페이로드는 **id만**, 8,000B 한도):

| 채널 | 페이로드 |
|---|---|
| `omnis_item` | `{"id","thread_id","op":"insert"\|"update"}` |
| `omnis_thread` | `{"id","op"}` |
| `omnis_approval` | `{"id","state":"pending"\|"decided"}` |
| `omnis_task` | `{"id","op"}` |
| `omnis_session` | `{"id","runtime","state"}` |
| `omnis_job` | `{"id","name"}` |
| `omnis_control` | `{"kill_switch":true\|false}` |

## 5. `@omnis/kernel` exports

```ts
export type LogLevel = "debug" | "info" | "warn" | "error";
export interface Logger {
  debug(msg: string, extra?: Record<string, unknown>): void;
  info(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, extra?: Record<string, unknown>): void;
}
export function createLogger(pkg: string, traceId?: string | null): Logger;   // §9의 한 줄 JSON 형식

export interface KernelDeps { pool: Pool; now?: () => Date; logger?: Logger; }
export function createKernel(deps: KernelDeps): Kernel;
export interface Kernel { events: Events; scheduler: Scheduler; approvals: Approvals; killSwitch: KillSwitch; audit: Audit; ingest: { sink: IngestSink }; close(): Promise<void>; }

export type EventTier = "ephemeral" | "durable" | "cold";
export interface Events {
  /** ephemeral: WS 팬아웃만(저장·NOTIFY 없음, A3-D14). durable: 호출자가 이미 쓴 row의 id를 NOTIFY로 알린다.
   *  cold: events 테이블 INSERT(트리거가 NOTIFY 없음). */
  emit(tier: EventTier, kind: string, payload: { id?: string; [k: string]: unknown }): Promise<void>;
  subscribe(channel: string, fn: (p: Record<string, unknown>) => void): () => void;  // 반환값은 unsubscribe
}

export interface Scheduler {
  register(name: string, cron: string, handler: () => Promise<void>): void;  // jobs(name, schedule, next_run_at) upsert
  start(): Promise<void>;   // 10초 틱. UPDATE jobs SET claimed_at=now() WHERE name=$1 AND claimed_at IS NULL AND enabled AND next_run_at<=now() RETURNING id
  stop(): Promise<void>;    // 실행 후 last_run_at/last_status('ok'|'failed'|'skipped')/last_error/next_run_at 갱신 + claimed_at=NULL
}

export interface PendingApproval {              // A3 §4 pending_approvals row (오너 @omnis/kernel)
  id: string; action: ApprovalAction; args: Record<string, unknown>; description: string;
  config: ApprovalConfig; state: ApprovalState;    // ApprovalConfig = HumanInterrupt.config의 4-boolean shape(§3.4)
  decision: ApprovalDecision | null; decided_args: Record<string, unknown> | null;
  requested_by: string | null; thread_id: string | null; item_id: string | null; task_id: string | null;
  risk: ApprovalRisk;
  expires_at: Date | null; created_at: Date; decided_at: Date | null; executed_at: Date | null;
  fail_reason: string | null;
}

export interface Approvals {
  propose(i: HumanInterrupt): Promise<string>;                 // → pending_approvals.id, state='pending'
  decide(id: string, r: HumanResponse): Promise<void>;         // pending → decided (decision/decided_args/decided_at)
  list(f?: { state?: ApprovalState; thread_id?: string; limit?: number }): Promise<PendingApproval[]>;
  beginExecution(id: string): Promise<PendingApproval>;        // decided(accept|edit) → executing. 0행이면 ApprovalStateError. runEgress만 부른다
  completeExecution(id: string): Promise<void>;                // executing → executed (executed_at)
  failExecution(id: string, reason: string): Promise<void>;    // executing → failed (fail_reason)
  expire(id: string): Promise<boolean>;                        // pending → expired. 이미 지나갔으면 false
}
// 상태 전이(A3 CHECK 문자열 그대로): pending → decided → executing → executed | failed, 그리고 pending → expired.
// decision ∈ accept|edit|respond|ignore, action ∈ send|delete|calendar_write|delegate|self_model_edit|memory_write, risk ∈ normal|high.

export interface KillSwitch { isOn(): Promise<boolean>; set(on: boolean, reason: string): Promise<void>; assertOff(): Promise<void>; }
// 상태 저장소는 새 테이블이 아니라 audit_log다: action='kill_switch.set', after={"on":bool,"reason":string}의 최신 row가 현재 값.
// 프로세스 내 캐시 + omnis_control NOTIFY로 무효화. assertOff()는 켜져 있으면 KillSwitchError를 throw.

export interface AuditEntry {
  actor: string;              // 'me' | `agent:${RuntimeKind}` | 'system'
  action: string;             // 'item.sent' | 'approval.decided' | 'kill_switch.set' ...
  target_table: string; target_id?: string;
  before?: unknown; after?: unknown; approval_id?: string;
}
export interface Audit { record(e: AuditEntry): Promise<void>; }   // append-only, egress는 반드시 경유
export function killSwitchStatus(pool: Pool): Promise<{ on: boolean; since: string | null; reason: string | null }>;  // 허브 GET /kill-switch

// egress — 비가역 행동은 전부 이 한 함수를 통과한다
declare const egressBrand: unique symbol;
export type EgressToken = string & { readonly [egressBrand]: "EgressToken" };
export interface EgressSpec { approvalId: string; actor: string; action: string; targetTable: string; targetId?: string; }
export interface EgressDeps { approvals: Approvals; killSwitch: KillSwitch; audit: Audit; }
export function runEgress<T>(deps: EgressDeps, spec: EgressSpec, fn: (t: EgressToken) => Promise<T>): Promise<T>;
export interface OutboxDeps { pool: Pool; adapters: Map<Channel, Adapter>; audit: Audit; logger: Logger; }
export function createOutbox(deps: OutboxDeps): { send(t: EgressToken, ref: ThreadRef, draft: Outbound): Promise<SendResult> };
export function createIngestSink(deps: { pool: Pool; logger: Logger }): IngestSink;

// Zero publication 정합성(부팅 시 1회, §7)
export class ZeroPublicationError extends Error {}
export function assertZeroPublication(pool: Pool): Promise<void>;
export const zeroSchema: Schema;    // src/zero-schema.ts (§7)
```

**`apps/hub`가 서비스하는 커널 HTTP 표면** — `127.0.0.1:8787`에만 bind, Tailscale Serve가 `/api/`로 마운트(외부 경로는 `https://<mini>.ts.net/api/...`). 요청·응답 전부 `application/json`.

| 메서드·경로 | body | 응답 |
|---|---|---|
| `GET /health` | — | `{ ok: boolean, version: string, db: "up"\|"down", uptimeSec: number, killSwitch: boolean }` |
| `GET /approvals?state=pending&limit=50` | — | `{ approvals: PendingApproval[] }` |
| `POST /approvals/:id/decide` | `HumanResponse` | `{ id: string, state: "decided" }` |
| `GET /kill-switch` | — | `{ on: boolean, since: string \| null, reason: string \| null }` |
| `POST /kill-switch` | `{ on: boolean, reason: string }` | `{ on: boolean, since: string }` |
| `WS /bridge` | JSON-RPC 2.0 | A2 §3 — **서버 구현 오너 = kernel-and-db 계획(T24 뒤의 새 태스크)**. agent-bridge 계획은 dial하는 클라이언트만 만든다 |

이미 다른 부록이 소유한 경로는 Phase A 범위 밖이다: `GET /search`(A4 §14, Phase B), `GET /memory/search`·`GET /transcript/:session_id`(A3 §7).

## 6. `@omnis/agents` exports

```ts
export interface RecordRunInput {          // 컬럼명은 A3 §4가 정본 (A4 §1.7 대응표)
  loop: "classify"|"draft"|"task"|"delegate"|"digest"|"followup"|"note_route"|"auto_archive"|"ingest";
  agent_session_id?: string; item_id?: string;
  trigger_kind: "event"|"cron"|"manual"; trigger_ref?: string;   // item 트리거는 item_id로, trigger_ref는 cron 잡 이름만
  model_tier: "T0"|"T1"|"T2"|"T3";
  provider: "local"|"deepseek"|"anthropic"|"openrouter";
  model: string;
  tokens_in?: number; tokens_out?: number; tokens_cached?: number; cost_usd?: number; latency_ms?: number;
  outcome: "running"|"ok"|"failed"|"skipped"|"blocked";
  error?: string; confidence?: number; escalated_from?: string;
  injection_flags?: string[]; context_hash?: string; result_ref?: string; raw_output?: string;
}
export function recordRun(input: RecordRunInput): Promise<string>;      // → agent_runs.id. 모든 L3 호출이 이 헬퍼를 거친다
export function finishRun(id: string, patch: Partial<RecordRunInput> & { outcome: RecordRunInput["outcome"] }): Promise<void>;  // finished_at=now()

/** A3 §2 items 중 L1 분류가 읽는 부분집합. 오너 = `packages/agents/src/types.ts`. */
export interface ItemRow {
  id: string; thread_id: string; account_id: string;
  channel: Channel;                  // accounts.channel 조인값
  kind: "message" | "email" | "event" | "agent_turn" | "tool_call" | "system";
  scope: Scope; sensitivity: Sensitivity;
  author_person_id: string | null; author_is_me: boolean;
  subject: string | null; body: string; sent_at: string;
  embedding: string | null;          // pgvector 리터럴 문자열("[0.1,0.2,…]"), 배치 전이면 null
}

// pool 주입 — `@omnis/agents`는 `@omnis/db`에 의존하지 않으므로(§1) 호출자가 pool을 꽂는다
export function configureAgents(deps: { pool: Pool }): void;
export function getAgentsPool(): Pool;                 // configureAgents 전이면 throw
export class AgentsNotConfiguredError extends Error {}

export interface ClassifyCtx { threadId: string; accountChannel: Channel; authorPersonId?: string; pool: Pool; }
export const ClassifyOutput = z.object({
  scope: Scope,                                   // work | personal | unknown
  topic: z.string().max(40).optional(),
  priority: z.enum(["now","today","week","fyi"]),
  person_label: z.string().max(40).optional(),
  matched_rule_ids: z.array(z.string()).default([]),
  sensitivity: Sensitivity,
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(200),
  injection_flags: z.array(z.string()).default([]),
  tier_used: z.enum(["T0","T1","T2"]),            // 1단 규칙/2단 kNN = T0, 3단 LLM = T1, 에스컬레이션 = T2
});
export function classify(item: ItemRow, ctx: ClassifyCtx): Promise<z.infer<typeof ClassifyOutput>>;
export function sensitivityFor(item: ItemRow, ctx: ClassifyCtx): Promise<Sensitivity>;  // Phase A: 'normal' 기본, VIP person이면 'personal'
```

`classify()`는 3단(결정론적 규칙 → 임베딩 kNN → T1 LLM) 순서로 내려가고 어느 단에서 끝났든 `recordRun`/`finishRun` 한 쌍을 남긴다. `sensitivity`는 L1이 유일 생산자이며 겹치면 `health > legal > finance > personal` 우선순위로 하나만 고른다.

## 7. Zero

- 스키마 모듈: `packages/kernel/src/zero-schema.ts`, export 이름 **`zeroSchema`**(`@omnis/kernel`에서 re-export). `apps/desktop`은 `@omnis/kernel`을 통째로 import하지 않고 이 서브패스만 쓴다: `import { zeroSchema } from "@omnis/kernel/zero"`.
- 복제 테이블: `accounts`, `threads`, `calendar_events`, `persons`, `identities`, `labels`, `label_rules`(단 `probe_embedding` 제외), `item_labels`, `thread_labels`, `tasks`, `agent_runtimes`, `agent_sessions`, `pending_approvals`, `notes`, `digests`, 그리고 컬럼을 좁힌 `items`: `id, thread_id, account_id, external_id, kind, status, scope, sensitivity, author_person_id, author_agent_id, author_is_me, in_reply_to, subject, body, body_html, attachments, tool, sent_at, received_at, source_hash, idempotency_key, outbox_claimed_at, fail_reason, meta`(= `embedding`·`search_tsv` 제외).
- 제외 테이블: `account_secrets`, `events`, `audit_log`, `agent_runs`, `memories`, `entities`, `relations`, `person_merges`, `jobs`.
- `@rocicorp/zero` 버전은 **`1.9.0` exact**(caret 금지, A6 §5). 같은 모듈이 `ZERO_TABLES: readonly string[]`·`ZERO_ITEM_COLUMNS: readonly string[]`(·`ZERO_LABEL_RULE_COLUMNS`)도 export하고, `assertZeroPublication`(§5)이 부팅 때 Postgres publication과 대조한다.
- zero-cache 환경변수(A6 §1·§5): `ZERO_UPSTREAM_DB`, `ZERO_CVR_DB`(스키마 `zero_cvr`), `ZERO_REPLICA_FILE`. 복제 role은 `zero_replication`.
- 데스크톱 클라이언트: `apps/desktop/src/zero-client.ts`

```ts
export function initZero(opts?: {
  server?: string;
  userID?: string;
  auth?: string;
}): Zero<typeof zeroSchema>;
// 기본값: server = import.meta.env.OMNIS_ZERO_URL ?? "http://127.0.0.1:4848", schema = zeroSchema
//         auth = loadZeroToken()이 받아 둔 허브 토큰, userID = 그 토큰의 sub ?? "logan"
export async function fetchZeroToken(hubUrl?: string): Promise<string>;
export async function loadZeroToken(hubUrl?: string): Promise<void>; // main.tsx가 렌더 전에 1회
```

**US-A21b 결정(2026-09-20)**: 권한·인증을 계약에 추가한다.

- `packages/kernel/src/zero-schema.ts`가 `permissions`(= `definePermissions<AuthData, …>`),
  `AuthData = { sub: string }`, `OMNIS_USER_ID`, 그리고 CLI용 별칭 `schema`(= `zeroSchema`)를
  더 export한다. 규칙은 **모든 복제 테이블의 `row.select` 하나**뿐이다(쓰기는 허브 HTTP, 계약 §5).
- 허브가 `GET /api/zero-token`을 연다(§5의 라우트 목록에 추가). HS256 `{sub, exp:+7d}`,
  키는 `ZERO_AUTH_SECRET`, 다른 허브 라우트와 같은 127.0.0.1 경계. 비밀 미설정 시 503.
- 새 환경변수(§9): `ZERO_AUTH_SECRET`(허브·zero-cache 공유), `OMNIS_USER_ID`(기본 `logan`,
  허브·permissions 배포 양쪽에서 읽음).
- 배포 순서: `pnpm db:migrate` → `pnpm zero:deploy-permissions` → zero-cache 기동. 빠뜨리면
  zero-cache가 한 행도 안 내려보낸다.
- `initZero`는 계약대로 동기로 남기고, 토큰은 `loadZeroToken()`이 부팅 때 미리 받아 생성자에
  싣는다 — `connection.connect({auth})`(나중-인증)는 이미 하이드레이션된 쿼리를 다시 태우지 않는다.

## 8. `apps/local-agent`

- 설정 파일: `~/.omnis/local-agent.toml`. 우선순위 **CLI > 환경변수(`OMNIS_*`) > TOML > 내장 기본값**(A2-D15). 기동 로그에 키별 실효값과 출처(`cli`|`env`|`toml`|`default`)를 한 줄씩 찍는다.
- 최상위 TOML 키: `host`(`"mini"`|`"macbook"`), `hub_url`, `token_keychain_item`.
- `[[runtime]]` 블록은 **TOML 전용**(CLI·env로 추가·수정 금지). 프로세스형(`claude_code`/`codex`/`claude_ds`): `kind`, `binary`, `allowed_roots`, `pinned_version`, `default_model`, `bare`(bool, 기본 `claude_ds`=true / `claude_code`=false — 게이트 ⑪·마스터 Q13이 확정; `--bare`는 API 키 인증만 허용함). HTTP형(`hermes`): `kind`, `base_url`(기본 `http://127.0.0.1:8642`), `token_keychain_item`, `session_header_mode`(`"hermes_v1"`). 반대쪽 필드가 오면 기동 거부. `allowed_roots`에 `$HOME`이나 `/`가 오면 기동 거부.
- CLI 플래그: `--hub <url>`(→`hub_url`), `--host <mini|macbook>`, `--token-keychain-item <name>`, `--runtimes <csv>`.
- 대응 환경변수: `OMNIS_HUB_URL`, `OMNIS_HOST`, `OMNIS_TOKEN_KEYCHAIN_ITEM`, `OMNIS_RUNTIMES`.
- 호스트 설정(`src/host-config.ts`): `mini` → `hub_url="ws://127.0.0.1:8787/bridge"`, 노출 런타임 `["codex","hermes"]`(Hermes는 Phase B), 동시 활성 턴 캡 4. `macbook` → `hub_url="wss://<mini>.ts.net/api/bridge"`, 런타임 `["claude_code","codex","claude_ds","hermes"]`, 캡 4.
- Keychain: `omnis.bridge.token.mini`, `omnis.bridge.token.macbook`, `omnis.hermes.api_key.mini`, `omnis.hermes.api_key.macbook`. account 필드는 `281932556+jinhologankim@users.noreply.github.com`. 채널 시크릿은 `omnis.<channel>.<kind>.<external_id>`(A1 §1.3).
- JSON-RPC 메서드: 수신(hub→bridge) = `HUB_METHODS`, 송신(bridge→hub) = `BRIDGE_METHODS`(§3.5). 파라미터·결과 타입은 전부 `@omnis/protocol` 심볼을 쓴다 — `session.create`는 `{session_key: SessionKey, runtime: RuntimeKind, cwd, purpose, origin, permission_profile, model?}` → `{session_id: null, thread_id}`, `turn.start`는 `{session_key, input:{text, attachments?}, model?, timeout_ms?}` → `{turn_id}`, `approval.requested`는 `{session_key, turn_id, interrupt: HumanInterrupt}` → `HumanResponse`. Phase A는 `ingest.scan`/`ingest.read`를 구현하지 않는다(Phase B).
- `--permission-mode` 리터럴(claude 2.1.274 실측, `tools/spikes/_probes/2026-09-20-cli-probes.md`): **`acceptEdits` · `auto` · `bypassPermissions` · `manual` · `dontAsk` · `plan`**. `"default"`라는 값은 **없다**.
- `PermissionProfile` → `--permission-mode` 매핑(A2 §7.1): `observe` → `plan`, `workspace` → `manual`, `trusted` → `bypassPermissions`(allowed_roots 안에서만). 게이트 ⑫ 결과로 확정 전까지는 pending.
- 재연결: 1s→2s→4s→…30s 상한, ±20% jitter. 끊긴 동안 durable 이벤트는 `~/.omnis/outbox.ndjson`(≤50MB)에 쌓고 재연결 시 순서대로 flush, ephemeral 델타는 버린다.

## 9. 공통 규약

- **환경변수**: `DATABASE_URL`(필수), `OMNIS_HUB_PORT=8787`, `OMNIS_HUB_URL`, `OMNIS_HOST`, `OMNIS_TOKEN_KEYCHAIN_ITEM`, `OMNIS_RUNTIMES`, `OMNIS_HUB_HTTP_URL`, `OMNIS_BRIDGE_TOKEN`(A6 래퍼가 Keychain `omnis.bridge.token.<host>`에서 주입), `OMNIS_ZERO_URL`, `ZERO_UPSTREAM_DB`, `ZERO_CVR_DB`, `ZERO_REPLICA_FILE`, `OLLAMA_HOST=127.0.0.1:11434`, `HERMES_BASE_URL`. 새 변수는 `OMNIS_` 접두 + 대문자 스네이크.
- **Keychain 항목 규칙**(기본형 `omnis.<channel>.<kind>.<external_id>`, account 필드는 `281932556+jinhologankim@users.noreply.github.com`):
  - Google 계열(`gmail`/`gcal`)은 **`omnis.gmail.<email>` 1항목을 공유**하고 `<kind>` 세그먼트를 생략한다. `gcal` 어댑터는 `channel:"gcal"`이면서 같은 `keychainService`를 재사용한다.
  - Slack은 **2항목**: `omnis.slack.xoxb.<team_id>`(bot 토큰, account=`<team_id>`)와 `omnis.slack.xoxb.<team_id>.app`(app 토큰). 온보딩도 이 이름으로 쓴다(`xoxp` 아님).
  - 브리지 토큰은 `omnis.bridge.token.<host>`(§8).
- **의도된 중복**: `createLogger`(`@omnis/kernel` + `apps/local-agent`)와 `readKeychainSecret`(어댑터 3개 + `apps/local-agent`)은 패키지 경계상 각자 갖는다. 공용 패키지로 뽑지 않는다 — 재논의 금지.
- **로그**: 한 줄 JSON을 stdout으로. 필수 키 `{"ts":"<ISO8601>","level":"debug|info|warn|error","pkg":"@omnis/kernel","msg":"...","trace_id":"<ULID|null>"}`. 시크릿 값은 어떤 키에도 넣지 않는다.
- **에러 클래스**: `AdapterError`(`@omnis/protocol`, `kind` 6종), `BridgeError`(`@omnis/protocol`, `code`), `MigrationError`(`@omnis/db`), `KillSwitchError`·`ApprovalStateError`(`@omnis/kernel`), `LoopBudgetError`·`SchemaViolationError`(`@omnis/agents`). 전부 `name`을 클래스명과 같게 둔다.
- **어댑터 계약 테스트 픽스처 배치**(A1 §1.7):

```
packages/adapters/<channel>/fixtures/<scenario>.json   # { scenario, raw, expected: { items: [...] } }
packages/adapters/<channel>/test/contract.test.ts      # expect(normalize(f.raw)).toEqual(f.expected.items)
```

채널당 최소 시나리오 파일명: `text_message.json`, `thread_reply.json`, `attachment.json`, `rate_limited_response.json`, `auth_error_response.json`(Slack·Telegram은 `edited_message.json`, `deleted_message.json` 추가). 네트워크·인증 호출 없음.
- **브랜치·커밋**: 브랜치 `ralph/<story-id>`(계획 단위 병렬 실행 시 `plan/<plan-slug>`), 워크트리는 worktrunk 기본 형제 레이아웃 `~/AI-Workspaces/omnis.<branch>`(게이트 ⑭ 실측, `tools/spikes/_probes`). Homebrew git ≥ 2.43 필요(`/opt/homebrew/bin` 우선). 스토리당 원자 커밋 1개, 제목 형식 **`US-A05: 커널 이벤트 버스 3티어 라우팅`**(= `<story-id>: <한 줄 요약>`, A7 §6), 본문에 충족한 acceptance criteria 목록, 본문 마지막에 `Implemented-by: Claude <tier>` 또는 `Implemented-by: DeepSeek V4.1 Flash`, 마지막 줄은 세션 규칙대로 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## 10. 스토리 → 계획 파일 → 태스크

kernel-and-db의 Task 16~25(US-A07~A10)는 **`@omnis/protocol`(US-A11)에 의존한다** — `HumanInterrupt`/`HumanResponse`/`ApprovalAction`/`IngestSink`/`ThreadRef`/`Outbound`/`SendResult`를 쓰므로 US-A11 머지 후에 착수한다(A7 §7 의존 열에는 빠져 있다).

| 스토리 | 계획 파일 | 태스크 |
|---|---|---|
| US-A00 (+게이트 ①~⑭) | `2026-09-20-phase-0-spikes.md` | spike-scaffold, gate-01…gate-14, worktrunk-cli-spike, tauri-ui-test-spike |
| US-A01 | `2026-09-20-phase-a-kernel-and-db.md` | db-scaffold, migrate-runner |
| US-A02 | 〃 | ddl-0001-extensions, ddl-0002-core-inbox |
| US-A03 | 〃 | ddl-0003-labels, ddl-0004-tasks-approvals |
| US-A04 | 〃 | ddl-0005-memory, ddl-0006-kernel, ddl-0007-notify, ddl-0008-publication, calendar-query-acceptance |
| US-A05 | 〃 | kernel-events-tiers, notify-fanout |
| US-A06 | 〃 | scheduler-jobs, scheduler-healthcheck-job |
| US-A07 | 〃 | approvals-propose, approvals-decide, approvals-state-machine |
| US-A08 | 〃 | kill-switch-audit-state, kill-switch-assert-off |
| US-A09 | 〃 | audit-record, egress-middleware |
| US-A10 | 〃 | hub-bootstrap, hub-http-routes, graceful-shutdown, hub-bridge-ws |
| US-A11 | `2026-09-20-phase-a-protocol-and-adapters.md` | protocol-enums, protocol-normalized, protocol-adapter-iface |
| US-A12 | 〃 | slack-socket-mode, slack-backfill, slack-normalize |
| US-A13 | 〃 | gmail-oauth, gmail-watch-pubsub, gmail-normalize |
| US-A14 | 〃 | gcal-synctoken-poll, gcal-normalize |
| US-A15 | 〃 | fixtures-slack, fixtures-gmail, fixtures-gcal, contract-harness |
| US-A16 | `2026-09-20-phase-a-agent-bridge.md` | bridge-types, bridge-error-map, version-negotiation |
| US-A17 | 〃 | local-agent-scaffold, toml-config-precedence, ws-connect-reconnect |
| US-A18 | 〃 | claude-code-adapter, stream-json-parse |
| US-A19 | 〃 | codex-adapter, app-server-jsonrpc, version-pin |
| US-A19b | 〃 | host-config-mini, launchagent-plist, concurrency-cap-4 |
| US-A20 | 〃 | mock-runtime, bridge-protocol-test |
| US-A21 | `2026-09-20-phase-a-sync-and-agents.md` | zero-schema, zero-permissions, hub-zero-wiring |
| US-A22b | 〃 | record-run, finish-run |
| US-A23 | 〃 | classify-rules-t0, classify-knn-t0, classify-llm-t1 |
| US-A23b | 〃 | sensitivity-hook, vip-promotion |
| US-A22 | `2026-09-20-phase-a-desktop.md` | zero-client-init, readonly-query-roundtrip |
| US-A24 | 〃 | design-tokens, shadcn-setup, glass-primitives |
| US-A25 | 〃 | tauri-scaffold, window-vibrancy |
| US-A26 | 〃 | inbox-screen, filter-pills, virtuoso-list |
| US-A27 | 〃 | thread-screen, status-badges |
| US-A28 | 〃 | agent-session-screen, tool-call-badge |
| US-A29 | 〃 | command-palette |
| US-A30 | 〃 | approval-card, four-way-decision |
| US-A31 | 〃 | onboarding-wizard, oauth-connect, keychain-store |

## 수정 이력 (2026-09-20, cross-plan review)

`2026-09-20-plans-review.md` §2의 권장 수정을 전부 반영했다. 적용 항목:

- **§1** — `@omnis/agents` 의존을 `@omnis/protocol`,`ai`,`pg`로 교체(`@omnis/memory` 제거, Phase A 미사용). `@omnis/desktop` 의존에 `@omnis/kernel`(`/zero` 서브패스 전용) 추가 + `package.json`에 workspace dep 선언 명시. (M9)
- **§2** — 루트 파일 오너 = kernel-and-db Task 1 명시, 다른 플랜의 루트 스캐폴드 스텝은 `test -f` 확인으로 대체. 버전 핀 고정(`vitest 2.1.9` · `zod ^3.24.1` · `pg 8.13.1` · `typescript 5.6.3` · `pnpm@9.12.3` · `@rocicorp/zero 1.9.0` · `ai 7.0.107`). `unit` include에 `*.test.tsx` 포함. `pnpm dev`/`tauri:dev`/`tauri:build`/`db:migrate`가 루트 스크립트임을 명시. (M1~M5, M12)
- **§3.5** — `PermissionProfile`·`SessionOrigin`·`SessionState`·`RuntimeState`·`JSONRPC_ERRORS`·`SUPPORTED_PROTOCOL_VERSIONS`·`RpcMeta`·`withMeta`·`assertProtocolVersion`·`toJsonRpcError` 추가, `BridgeErrorCode`를 BRIDGE+JSONRPC 합집합으로 정정(시그니처 출처: `2026-09-20-phase-a-agent-bridge.md` Task 1·3·4).
- **§5** — `Approvals`에 `beginExecution`/`completeExecution`/`failExecution`/`expire` 추가. `PendingApproval`·`Logger`/`createLogger`·`killSwitchStatus`·`runEgress`/`EgressToken`/`EgressSpec`/`EgressDeps`/`createOutbox`/`createIngestSink`·`assertZeroPublication`/`ZeroPublicationError` 정의 추가(출처: `2026-09-20-phase-a-kernel-and-db.md` Task 12·16·18·19·22, `…-sync-and-agents.md` Task 2). `WS /bridge` 서버 구현 오너 = kernel-and-db(T24 뒤 새 태스크 `hub-bridge-ws`). (M6)
- **§6** — `ItemRow` 정의 추가(오너 `@omnis/agents/src/types.ts`), `configureAgents`/`getAgentsPool`/`AgentsNotConfiguredError` 추가.
- **§7** — `@rocicorp/zero 1.9.0` exact 명기, `ZERO_TABLES`/`ZERO_ITEM_COLUMNS` export 추가. (M10)
- **§8** — `--permission-mode` 리터럴 6종(`acceptEdits`/`auto`/`bypassPermissions`/`manual`/`dontAsk`/`plan`, `default` 없음) 기록 + `PermissionProfile`→mode 매핑(observe→`plan`, workspace→`manual`, trusted→`bypassPermissions`, 게이트 ⑫ 확정 전 pending). 출처: `tools/spikes/_probes/2026-09-20-cli-probes.md`.
- **§9** — `OMNIS_HUB_HTTP_URL` 추가(M11). Keychain 규칙 명문화: Google 계열은 `omnis.gmail.<email>` 1항목 공유(`<kind>` 생략, gcal 재사용), Slack은 `omnis.slack.xoxb.<team_id>` + `….app` 2항목(account=`<team_id>`), 브리지 토큰 `omnis.bridge.token.<host>`. (M7, M8) `createLogger`·`readKeychainSecret` 중복은 의도된 것으로 1줄 고정.
- **§10** — kernel-and-db Task 16~25가 US-A11에 의존함을 명시, US-A10에 `hub-bridge-ws` 태스크 추가.

미반영(계약 밖 = 계획 문서 쪽 수정 사항): M13(`.github/workflows/ci.yml` 오너 미배정), M14(phase-0 T17 범위 축소).
- (Fable, 2026-09-20 후속) §8 `bare` 키, §9 `OMNIS_BRIDGE_TOKEN`, 워크트리 형제 레이아웃, 커밋 트레일러 규칙(Implemented-by 본문 + Co-Authored-By Fable) 정정.
