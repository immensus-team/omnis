# Phase A interface contracts (2026-09-20)

This freezes **names and signatures only**, so that the 6 plan documents do not end up using different names for the same thing. Plan authors **copy verbatim** the identifiers written here. There is no design discussion — the rationale is in the appendix.

## 0. Appendix conflict resolutions (per the A7 §1 dependency rules, one line each)

1. `packages/bridge-protocol` (A2 §1.1 comment) → **`src/bridge.ts` in `@omnis/protocol`** (A7 §1 fixes protocol as the only leaf, A7 §7 US-A16 is the source-of-truth path).
2. `packages/adapters/agent-bridge` (A7 §1 tree) vs `apps/local-agent/src/bridges/*` (A7 §7 US-A18·A19) → **Phase A builds only the latter**. RuntimeAdapter spawns a child process, so it cannot satisfy the `packages/adapters/*` rule of being "a pure normalization layer that depends only on protocol". The `@omnis/adapter-agent-bridge` package does not exist in Phase A.
3. `OMNIS_DB_URL` (A3 §8 runner example) vs `DATABASE_URL` (A6 §1·§9) → **`DATABASE_URL`** (A6 owns secret injection, and the name the wrapper exports is the source of truth at runtime).
4. `schema_migrations`/`0001_core.sql` → **`_omnis_migrations` + the 8 files of A3 §8** (A3 owns the schema; the A7 change history already corrects this).
5. `tier`/`input_tokens`/`status`/`started_at` in A4 §1.7 → **the A3 §4 column names** (`model_tier`/`tokens_in`/`outcome`/`created_at`).
6. `pending_approvals.action` 4 values (A7 §1 body) vs 6 values (A3 `approvals_action_ck`) → **A3's 6 values**.
7. Keychain `omnis.<host>.session_bus_token` (former A6 §9) → **`omnis.bridge.token.<host>`** (A2 §2.1 literal).
8. Hub external base URL: A2 §2.1 `wss://…/bridge` vs A6 §3 `tailscale serve /api/ → localhost:8787/` → **A6 §3 owns the mount**, so the external base is `https://<mini>.ts.net/api` and the bridge is `wss://<mini>.ts.net/api/bridge`.
9. ephemeral tier: master §7 "NOTIFY or WS" vs A3-D14 "does not go through NOTIFY" → **WS fanout only** (A3-D14 is more specific and comes later).
10. Commit messages: instead of a Conventional Commits prefix, **the A7 §6 `<story-id>: <one-line summary>`**.

## 1. Package names and paths

| Package name | Path | Dependencies (nothing else allowed) | Phase A story |
|---|---|---|---|
| `@omnis/protocol` | `packages/protocol` | none (leaf, `zod` only) | A11, A16 |
| `@omnis/db` | `packages/db` | `pg` | A01~A04 |
| `@omnis/kernel` | `packages/kernel` | `@omnis/db`, `@omnis/protocol` | A05~A09, A21 |
| `@omnis/memory` | `packages/memory` | `@omnis/db`, `@omnis/protocol` | Phase B (scaffold only) |
| `@omnis/adapter-slack` | `packages/adapters/slack` | `@omnis/protocol` | A12, A15 |
| `@omnis/adapter-gmail` | `packages/adapters/gmail` | `@omnis/protocol` | A13, A15 |
| `@omnis/adapter-google-calendar` | `packages/adapters/google-calendar` | `@omnis/protocol` | A14, A15 |
| `@omnis/agents` | `packages/agents` | `@omnis/protocol`, `ai`, `pg` | A22b, A23, A23b |
| `@omnis/ui` | `packages/ui` | React only | A24 |
| `@omnis/hub` | `apps/hub` | all of `packages/*` | A10 |
| `@omnis/desktop` | `apps/desktop` | `@omnis/ui`, `@omnis/protocol`, `@omnis/kernel` (only the `/zero` subpath) | A22, A25~A31 |
| `@omnis/web` | `apps/web` | same | Phase B |
| `@omnis/local-agent` | `apps/local-agent` | `@omnis/protocol` | A17~A20 |

- The directory name `google-calendar` ≠ the `accounts.channel` value `gcal` (A3 §1.1). They are different namespaces, and the adapter joins them with `export const CHANNEL = 'gcal' as const`.
- `tools/spikes/*` is outside the workspace (do not add it to `pnpm-workspace.yaml`).
- `@omnis/agents` depends on `pg` directly because `ClassifyCtx.pool: Pool` already requires `pg`. `@omnis/memory` is not used in Phase A (scaffold only).
- `@omnis/desktop` does not import `@omnis/kernel` wholesale; it uses only the `@omnis/kernel/zero` subpath (§7). It still **declares** `"@omnis/kernel": "workspace:*"` in `apps/desktop/package.json`.

## 2. Toolchain commands (exactly as in A7 §2)

pnpm workspaces · Node 22 · TypeScript strict (`strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`, root `tsconfig.base.json`) · one Biome · vitest · no ORM.

| Purpose | Command |
|---|---|
| Package tests | `pnpm --filter @omnis/<name> test` |
| Typecheck (whole repo) | `pnpm typecheck` = `tsc --build --force` |
| Lint / format | `pnpm lint` = `biome check` / `pnpm format` = `biome check --write` |
| All tests | `pnpm test` = `vitest run` |
| Contract / integration | `pnpm test:contract` = `vitest run --project contract` · `pnpm test:integration` = `vitest run --project integration` |
| Migrations | `pnpm db:migrate` · `pnpm db:migrate:create <name>` · `pnpm db:seed` |
| Tauri | `pnpm tauri:dev` · `pnpm tauri:build`(= `pnpm --filter @omnis/desktop tauri dev|build`) |
| Development | `pnpm dev` (hub + desktop together) · `pnpm build` = `tsc --build` |

The vitest project names are fixed at three: `unit` (default) / `contract` / `integration` (root `vitest.workspace.ts`). The `unit` project's include covers **both** `*.test.ts` and `*.test.tsx` (so that the tsx tests in `packages/ui` and `apps/desktop` are not silently skipped by `pnpm test`).

**Root file owner = kernel-and-db Task 1.** Only Task 1 of `2026-09-20-phase-a-kernel-and-db.md` creates the root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `biome.jsonc`, and `vitest.workspace.ts`. Delete the root scaffold step in every other plan and replace it with "the root scaffold is created by kernel-and-db Task 1 — only verify that it exists (`test -f`)".

**Version pins (FIXED, identical across the whole workspace)**: `vitest 2.1.9` · `zod ^3.24.1` (owner = `@omnis/protocol`, **no package uses zod 4**) · `pg 8.13.1` · `typescript 5.6.3` · `packageManager pnpm@9.12.3` · `@rocicorp/zero 1.9.0` (exact, no caret) · `ai 7.0.107`.

The `pnpm dev` (hub + desktop together), `pnpm tauri:dev`, `pnpm tauri:build`, and `pnpm db:migrate` entries in the table above are all **`scripts` entries in the root `package.json`** (kernel-and-db Task 1 writes them too).

**DB driver**: pinned to `pg` 8.x (the A3 §8 runner does `import { Client } from "pg"`). No ORM; the typed thin wrapper is provided by `@omnis/db` (§4).

**Integration test DB**: local native Postgres 17 with no container (`brew install postgresql@17` + `pgvector`). The dev DB is `omnis`, the test DB is fixed at **`omnis_test`**. Tests read `DATABASE_URL` and, if it is missing, fall back to `postgres://logan@127.0.0.1:5432/omnis_test`. The reset strategy is a single `vitest` `globalSetup`: `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` → `migrate(pool, MIGRATIONS_DIR)`. Per-file transaction rollback is not used (because triggers and NOTIFY must be verified). CI is the GitHub Actions `postgres:17` service container, and the path filter is A7-D7.

## 3. `@omnis/protocol` exports

All are zod schemas + `z.infer` types. Files: `src/adapter.ts` (3.1~3.3), `src/approval.ts` (3.4), `src/bridge.ts` (3.5), `src/index.ts` (re-export).

### 3.1 Value sets and branded types

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
export type Channel = z.infer<typeof Channel>;   // same pattern for every enum below

declare const brand: unique symbol;
export type SessionKey = string & { readonly [brand]: "SessionKey" }; // `agent:{runtime}:{host}:{purpose}`, ':'→'-' substitution, ≤256 chars
export type SessionId  = string & { readonly [brand]: "SessionId" };  // transcript id supplied by the runtime, rotates
export const SessionKey = z.string().min(1).max(256).regex(/^agent:[a-z_]+:(mini|macbook):[A-Za-z0-9_-]+$/).transform(s => s as SessionKey);
export const SessionId  = z.string().min(1).transform(s => s as SessionId);
```

### 3.2 Capabilities / NormalizedThread / NormalizedItem (A1 §1.1~1.2)

```ts
export const Capabilities = z.object({
  read: z.boolean(), write: z.boolean(), realtime: z.boolean(), history: z.boolean(),
  media: z.boolean(), markRead: z.boolean(), typing: z.boolean(),
  archive: z.boolean(), delete: z.boolean(),      // v1: delete=false for every channel
});

export const ParticipantRef = z.object({
  externalId: z.string(), displayName: z.string(), personId: z.string().uuid().optional(), // the adapter always leaves this empty
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

**author → A3 3-column mapping (performed by the kernel write path, the adapter is not involved)**: `kind:'person'` → `author_person_id` (after persons resolution), `kind:'agent'` → `author_agent_id` (→`agent_runtimes.id`), `kind:'system'` → both NULL. `author_is_me` is set by the kernel by comparing against my identity. The adapter only produces `person`. `sensitivity`/`scope` are not written by the adapter (L1 is the only producer, A4 §2.4).

### 3.3 AdapterEvent / AuthRef / Adapter (exactly as in A1 §1.3·§1.6)

```ts
export const AdapterEvent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("connected"), at: z.string().datetime() }),
  z.object({ kind: z.literal("disconnected"), reason: z.string(), at: z.string().datetime() }),
  z.object({ kind: z.literal("auth_required"), reason: z.string(), authUrl: z.string().optional(), at: z.string().datetime() }),
  z.object({ kind: z.literal("rate_limited"), retryAfterMs: z.number().int(), endpoint: z.string(), at: z.string().datetime() }),
  z.object({ kind: z.literal("backfill_progress"), done: z.number().int(), total: z.number().int().nullable(), at: z.string().datetime() }),
]);

export const AuthRef = z.object({            // never carries the token value
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
  send(thread: ThreadRef, draft: Outbound): Promise<SendResult>;   // only called after approval
  markRead?(thread: ThreadRef): Promise<void>;
  archive?(thread: ThreadRef): Promise<void>;
  health(): Promise<Health>;
}
/** Pure function for contract tests. The adapter module exports it as a named export separate from Adapter. */
export type Normalize = (raw: unknown) => NormalizedItem[];
/** Sink the hub injects into the adapter. The name is unrelated to the `ingest.scan/read` RPC in A2 §3.2. */
export type IngestSink = (accountId: string, e: NormalizedItem | AdapterEvent) => Promise<void>;
```

### 3.4 Approval (A3 §4 / A4 / `22`)

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

### 3.5 Bridge protocol (A2 §1·§3)

```ts
/** A2 §7.1. The profile is determined only by origin and purpose and never changes with the prompt. */
export const PermissionProfile = z.enum(["observe", "workspace", "trusted"]);
export type PermissionProfile = z.infer<typeof PermissionProfile>;

export const SessionOrigin = z.enum(["human", "delegation", "job"]);
export type SessionOrigin = z.infer<typeof SessionOrigin>;

export const SessionState = z.enum(["idle", "running", "awaiting_approval", "failed", "closed"]);
export type SessionState = z.infer<typeof SessionState>;

export const RuntimeState = z.enum(["online", "degraded", "offline"]);
export type RuntimeState = z.infer<typeof RuntimeState>;

export const RuntimeCapabilities = z.object({           // capabilities self-description (A2 §1.2)
  resume: z.boolean(), cross_project_resume: z.boolean(), stream_deltas: z.boolean(),
  reasoning_stream: z.boolean(), tool_calls: z.boolean(),
  approvals: z.enum(["native","hook","none"]), cancel: z.boolean(),
  models: z.array(z.string()), features: z.array(z.string()),   // runtime text passed through verbatim
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

/** hub → bridge request (A2 §3.2) */
export const HUB_METHODS = ["bridge/discover","session.create","session.resume","turn.start","turn.cancel",
  "session.read_summary","delegate.run","session.close","ingest.scan","ingest.read"] as const;
/** bridge → hub (A2 §3.3). only approval.requested is a request; the rest are notifications */
export const BRIDGE_METHODS = ["runtime.registered","session.registered","turn.started","turn.item.started",
  "turn.item.delta","turn.item.completed","turn.completed","approval.requested","health"] as const;
export type HubMethod = typeof HUB_METHODS[number];
export type BridgeMethod = typeof BRIDGE_METHODS[number];

/** JSON-RPC 2.0 standard codes. A2 §3.4 layers the omnis range on top of them. */
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

/** A2-D3: a version mismatch does not drop the connection; only this request is rejected with -32010. */
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

`turn.item.delta` is ephemeral and creates no row at all. `kind` is only ever `agent_turn` / `tool_call` (reasoning is not an item).

## 4. `@omnis/db` exports

```ts
export function createPool(env: NodeJS.ProcessEnv = process.env): Pool;  // DATABASE_URL required; throws immediately if missing. max=10, application_name='omnis-hub'
export function migrate(pool: Pool, dir: string): Promise<{ applied: string[] }>;
export function query<T>(pool: Pool | PoolClient, sql: string, params?: readonly unknown[]): Promise<T[]>;
export function one<T>(pool: Pool | PoolClient, sql: string, params?: readonly unknown[]): Promise<T>;   // throws unless the row count = 1
export function tx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T>;
export const MIGRATIONS_DIR: string;   // absolute path of packages/db/migrations
export const NOTIFY_CHANNELS: readonly string[];
```

`migrate()` semantics (exactly as in the A3 §8 runner): bootstrap `_omnis_migrations(name text PRIMARY KEY, sha text NOT NULL, applied_at timestamptz DEFAULT now())` → `pg_advisory_lock(8931447)` → sort `*.sql` → compare each file's sha256 (skip if equal, throw `migration <f> changed after apply` if different) → unless it is `.noxact.sql`, wrap in `BEGIN/COMMIT` and execute → insert into `_omnis_migrations` → advisory unlock in `finally`. Forward-only, no rollback. Verification = two consecutive `pnpm db:migrate` runs are a no-op.

The 8 migration files (A3 §8; this list is the complete set of v1 tables):

| File | Tables created |
|---|---|
| `0001_extensions.sql` | `pgcrypto`·`vector`·`pg_trgm` + the roles `omnis_owner`/`omnis_hub`/`omnis_sync` |
| `0002_core_inbox.sql` | `accounts`, `account_secrets`, `persons`, `identities`, `person_merges`, `agent_runtimes` (+`omnis` 1 row seed), `threads`, `items` (+partial HNSW), `calendar_events` |
| `0003_labels.sql` | `labels`, `label_rules`, `item_labels`, `thread_labels` |
| `0004_tasks_approvals.sql` | `agent_sessions`, `agent_runs`, `tasks`, `pending_approvals`, `notes`, `digests` |
| `0005_memory.sql` | `entities`, `relations`, `memories` + HNSW |
| `0006_kernel.sql` | `events`, `audit_log`, `jobs` (+seed) + append-only triggers + `omnis_events_rolloff()` + GRANT |
| `0007_notify.sql` | NOTIFY functions and triggers |
| `0008_publication.sql` | `CREATE PUBLICATION zero_omnis` (including the column list) |

NOTIFY channels (the payload is **only the id**, 8,000B limit):

| Channel | Payload |
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
export function createLogger(pkg: string, traceId?: string | null): Logger;   // the one-line JSON format of §9

export interface KernelDeps { pool: Pool; now?: () => Date; logger?: Logger; }
export function createKernel(deps: KernelDeps): Kernel;
export interface Kernel { events: Events; scheduler: Scheduler; approvals: Approvals; killSwitch: KillSwitch; audit: Audit; ingest: { sink: IngestSink }; close(): Promise<void>; }

export type EventTier = "ephemeral" | "durable" | "cold";
export interface Events {
  /** ephemeral: WS fanout only (no storage, no NOTIFY, A3-D14). durable: announces via NOTIFY the id of a row the caller has already written.
   *  cold: INSERT into the events table (the trigger does not NOTIFY). */
  emit(tier: EventTier, kind: string, payload: { id?: string; [k: string]: unknown }): Promise<void>;
  subscribe(channel: string, fn: (p: Record<string, unknown>) => void): () => void;  // the return value is the unsubscribe function
}

export interface Scheduler {
  register(name: string, cron: string, handler: () => Promise<void>): void;  // jobs(name, schedule, next_run_at) upsert
  start(): Promise<void>;   // 10-second tick. UPDATE jobs SET claimed_at=now() WHERE name=$1 AND claimed_at IS NULL AND enabled AND next_run_at<=now() RETURNING id
  stop(): Promise<void>;    // after a run, update last_run_at/last_status('ok'|'failed'|'skipped')/last_error/next_run_at + claimed_at=NULL
}

export interface PendingApproval {              // A3 §4 pending_approvals row (owner @omnis/kernel)
  id: string; action: ApprovalAction; args: Record<string, unknown>; description: string;
  config: ApprovalConfig; state: ApprovalState;    // ApprovalConfig = the 4-boolean shape of HumanInterrupt.config (§3.4)
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
  beginExecution(id: string): Promise<PendingApproval>;        // decided(accept|edit) → executing. ApprovalStateError if 0 rows. Only runEgress calls it
  completeExecution(id: string): Promise<void>;                // executing → executed (executed_at)
  failExecution(id: string, reason: string): Promise<void>;    // executing → failed (fail_reason)
  expire(id: string): Promise<boolean>;                        // pending → expired. false if it has already moved on
}
// State transitions (exactly the A3 CHECK strings): pending → decided → executing → executed | failed, and pending → expired.
// decision ∈ accept|edit|respond|ignore, action ∈ send|delete|calendar_write|delegate|self_model_edit|memory_write, risk ∈ normal|high.

export interface KillSwitch { isOn(): Promise<boolean>; set(on: boolean, reason: string): Promise<void>; assertOff(): Promise<void>; }
// The state store is not a new table but audit_log: the latest row with action='kill_switch.set', after={"on":bool,"reason":string} is the current value.
// In-process cache invalidated by the omnis_control NOTIFY. assertOff() throws KillSwitchError if the switch is on.

export interface AuditEntry {
  actor: string;              // 'me' | `agent:${RuntimeKind}` | 'system'
  action: string;             // 'item.sent' | 'approval.decided' | 'kill_switch.set' ...
  target_table: string; target_id?: string;
  before?: unknown; after?: unknown; approval_id?: string;
}
export interface Audit { record(e: AuditEntry): Promise<void>; }   // append-only; egress must always go through it
export function killSwitchStatus(pool: Pool): Promise<{ on: boolean; since: string | null; reason: string | null }>;  // hub GET /kill-switch

// egress — every irreversible action goes through this one function
declare const egressBrand: unique symbol;
export type EgressToken = string & { readonly [egressBrand]: "EgressToken" };
export interface EgressSpec { approvalId: string; actor: string; action: string; targetTable: string; targetId?: string; }
export interface EgressDeps { approvals: Approvals; killSwitch: KillSwitch; audit: Audit; }
export function runEgress<T>(deps: EgressDeps, spec: EgressSpec, fn: (t: EgressToken) => Promise<T>): Promise<T>;
export interface OutboxDeps { pool: Pool; adapters: Map<Channel, Adapter>; audit: Audit; logger: Logger; }
export function createOutbox(deps: OutboxDeps): { send(t: EgressToken, ref: ThreadRef, draft: Outbound): Promise<SendResult> };
export function createIngestSink(deps: { pool: Pool; logger: Logger }): IngestSink;

// Zero publication consistency (once at boot, §7)
export class ZeroPublicationError extends Error {}
export function assertZeroPublication(pool: Pool): Promise<void>;
export const zeroSchema: Schema;    // src/zero-schema.ts (§7)
```

**The kernel HTTP surface served by `apps/hub`** — binds to `127.0.0.1:8787` only, mounted at `/api/` by Tailscale Serve (the external path is `https://<mini>.ts.net/api/...`). Requests and responses are all `application/json`.

| Method and path | body | Response |
|---|---|---|
| `GET /health` | — | `{ ok: boolean, version: string, db: "up"\|"down", uptimeSec: number, killSwitch: boolean }` |
| `GET /approvals?state=pending&limit=50` | — | `{ approvals: PendingApproval[] }` |
| `POST /approvals/:id/decide` | `HumanResponse` | `{ id: string, state: "decided" }` |
| `GET /kill-switch` | — | `{ on: boolean, since: string \| null, reason: string \| null }` |
| `POST /kill-switch` | `{ on: boolean, reason: string }` | `{ on: boolean, since: string }` |
| `WS /bridge` | JSON-RPC 2.0 | A2 §3 — **server implementation owner = the kernel-and-db plan (a new task after T24)**. The agent-bridge plan builds only the dialing client |

Routes already owned by another appendix are out of scope for Phase A: `GET /search` (A4 §14, Phase B), `GET /memory/search` and `GET /transcript/:session_id` (A3 §7).

## 6. `@omnis/agents` exports

```ts
export interface RecordRunInput {          // column names: A3 §4 is the source of truth (A4 §1.7 mapping table)
  loop: "classify"|"draft"|"task"|"delegate"|"digest"|"followup"|"note_route"|"auto_archive"|"ingest";
  agent_session_id?: string; item_id?: string;
  trigger_kind: "event"|"cron"|"manual"; trigger_ref?: string;   // item triggers use item_id; trigger_ref is only for cron job names
  model_tier: "T0"|"T1"|"T2"|"T3";
  provider: "local"|"deepseek"|"anthropic"|"openrouter";
  model: string;
  tokens_in?: number; tokens_out?: number; tokens_cached?: number; cost_usd?: number; latency_ms?: number;
  outcome: "running"|"ok"|"failed"|"skipped"|"blocked";
  error?: string; confidence?: number; escalated_from?: string;
  injection_flags?: string[]; context_hash?: string; result_ref?: string; raw_output?: string;
}
export function recordRun(input: RecordRunInput): Promise<string>;      // → agent_runs.id. Every L3 call goes through this helper
export function finishRun(id: string, patch: Partial<RecordRunInput> & { outcome: RecordRunInput["outcome"] }): Promise<void>;  // finished_at=now()

/** The subset of A3 §2 items that L1 classification reads. Owner = `packages/agents/src/types.ts`. */
export interface ItemRow {
  id: string; thread_id: string; account_id: string;
  channel: Channel;                  // the joined accounts.channel value
  kind: "message" | "email" | "event" | "agent_turn" | "tool_call" | "system";
  scope: Scope; sensitivity: Sensitivity;
  author_person_id: string | null; author_is_me: boolean;
  subject: string | null; body: string; sent_at: string;
  embedding: string | null;          // pgvector literal string ("[0.1,0.2,…]"), null if not yet batched
}

// pool injection — `@omnis/agents` does not depend on `@omnis/db` (§1), so the caller plugs in the pool
export function configureAgents(deps: { pool: Pool }): void;
export function getAgentsPool(): Pool;                 // throws if called before configureAgents
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
  tier_used: z.enum(["T0","T1","T2"]),            // stage 1 rules / stage 2 kNN = T0, stage 3 LLM = T1, escalation = T2
});
export function classify(item: ItemRow, ctx: ClassifyCtx): Promise<z.infer<typeof ClassifyOutput>>;
export function sensitivityFor(item: ItemRow, ctx: ClassifyCtx): Promise<Sensitivity>;  // Phase A: 'normal' by default, 'personal' for a VIP person
```

`classify()` descends through 3 stages (deterministic rules → embedding kNN → T1 LLM), and leaves one `recordRun`/`finishRun` pair no matter which stage it stopped at. L1 is the only producer of `sensitivity`, and when values overlap only one is chosen, by the `health > legal > finance > personal` precedence.

## 7. Zero

- Schema module: `packages/kernel/src/zero-schema.ts`, export name **`zeroSchema`** (re-exported from `@omnis/kernel`). `apps/desktop` does not import `@omnis/kernel` wholesale but uses only this subpath: `import { zeroSchema } from "@omnis/kernel/zero"`.
- Replicated tables: `accounts`, `threads`, `calendar_events`, `persons`, `identities`, `labels`, `label_rules` (except `probe_embedding`), `item_labels`, `thread_labels`, `tasks`, `agent_runtimes`, `agent_sessions`, `pending_approvals`, `notes`, `digests`, plus `items` with a narrowed column list: `id, thread_id, account_id, external_id, kind, status, scope, sensitivity, author_person_id, author_agent_id, author_is_me, in_reply_to, subject, body, body_html, attachments, tool, sent_at, received_at, source_hash, idempotency_key, outbox_claimed_at, fail_reason, meta` (= excluding `embedding`·`search_tsv`).
- Excluded tables: `account_secrets`, `events`, `audit_log`, `agent_runs`, `memories`, `entities`, `relations`, `person_merges`, `jobs`.
- The `@rocicorp/zero` version is **`1.9.0` exact** (no caret, A6 §5). The same module also exports `ZERO_TABLES: readonly string[]` and `ZERO_ITEM_COLUMNS: readonly string[]` (and `ZERO_LABEL_RULE_COLUMNS`), and `assertZeroPublication` (§5) compares them against the Postgres publication at boot.
- zero-cache env vars (A6 §1·§5): `ZERO_UPSTREAM_DB`, `ZERO_CVR_DB` (schema `zero_cvr`), `ZERO_REPLICA_FILE`. The replication role is `zero_replication`.
- Desktop client: `apps/desktop/src/zero-client.ts`

```ts
export function initZero(opts?: {
  server?: string;
  userID?: string;
  auth?: string;
}): Zero<typeof zeroSchema>;
// defaults: server = import.meta.env.OMNIS_ZERO_URL ?? "http://127.0.0.1:4848", schema = zeroSchema
//         auth = the hub token loadZeroToken() already fetched, userID = that token's sub ?? "logan"
export async function fetchZeroToken(hubUrl?: string): Promise<string>;
export async function loadZeroToken(hubUrl?: string): Promise<void>; // main.tsx calls this once before rendering
```

**US-A21b decision (2026-09-20)**: add permissions and auth to the contract.

- `packages/kernel/src/zero-schema.ts` additionally exports `permissions` (= `definePermissions<AuthData, …>`),
  `AuthData = { sub: string }`, `OMNIS_USER_ID`, and the CLI alias `schema` (= `zeroSchema`).
  There is **only one rule: `row.select` on every replicated table** (writes go through hub HTTP, contract §5).
- The hub opens `GET /api/zero-token` (added to the route list in §5). HS256 `{sub, exp:+7d}`,
  the key is `ZERO_AUTH_SECRET`, with the same 127.0.0.1 boundary as the other hub routes. 503 if the secret is not set.
- New env vars (§9): `ZERO_AUTH_SECRET` (shared by the hub and zero-cache), `OMNIS_USER_ID` (defaults to `logan`,
  read both by the hub and by the permissions deploy).
- Deploy order: `pnpm db:migrate` → `pnpm zero:deploy-permissions` → start zero-cache. Skip one and
  zero-cache will not push down a single row.
- `initZero` stays synchronous as the contract says, and the token is fetched ahead of time by `loadZeroToken()`
  at boot and passed into the constructor — `connection.connect({auth})` (late auth) does not re-run already hydrated queries.

## 8. `apps/local-agent`

- Config file: `~/.omnis/local-agent.toml`. Precedence **CLI > env vars (`OMNIS_*`) > TOML > built-in defaults** (A2-D15). At startup, log one line per key with its effective value and its source (`cli`|`env`|`toml`|`default`).
- Top-level TOML keys: `host` (`"mini"`|`"macbook"`), `hub_url`, `token_keychain_item`.
- `[[runtime]]` blocks are **TOML-only** (never added or modified via CLI or env). Process type (`claude_code`/`codex`/`claude_ds`): `kind`, `binary`, `allowed_roots`, `pinned_version`, `default_model`, `bare` (bool, default `claude_ds`=true / `claude_code`=false — settled by gate ⑪ and master Q13; `--bare` allows API-key auth only). HTTP type (`hermes`): `kind`, `base_url` (default `http://127.0.0.1:8642`), `token_keychain_item`, `session_header_mode` (`"hermes_v1"`). If a field from the other side shows up, startup is refused. If `allowed_roots` contains `$HOME` or `/`, startup is refused.
- CLI flags: `--hub <url>` (→`hub_url`), `--host <mini|macbook>`, `--token-keychain-item <name>`, `--runtimes <csv>`.
- Corresponding env vars: `OMNIS_HUB_URL`, `OMNIS_HOST`, `OMNIS_TOKEN_KEYCHAIN_ITEM`, `OMNIS_RUNTIMES`.
- Host config (`src/host-config.ts`): `mini` → `hub_url="ws://127.0.0.1:8787/bridge"`, exposed runtimes `["codex","hermes"]` (Hermes is Phase B), concurrent active turn cap 4. `macbook` → `hub_url="wss://<mini>.ts.net/api/bridge"`, runtimes `["claude_code","codex","claude_ds","hermes"]`, cap 4.
- Keychain: `omnis.bridge.token.mini`, `omnis.bridge.token.macbook`, `omnis.hermes.api_key.mini`, `omnis.hermes.api_key.macbook`. The account field is `281932556+jinhologankim@users.noreply.github.com`. Channel secrets are `omnis.<channel>.<kind>.<external_id>` (A1 §1.3).
- JSON-RPC methods: inbound (hub→bridge) = `HUB_METHODS`, outbound (bridge→hub) = `BRIDGE_METHODS` (§3.5). Parameters and result types all use `@omnis/protocol` symbols — `session.create` is `{session_key: SessionKey, runtime: RuntimeKind, cwd, purpose, origin, permission_profile, model?}` → `{session_id: null, thread_id}`, `turn.start` is `{session_key, input:{text, attachments?}, model?, timeout_ms?}` → `{turn_id}`, `approval.requested` is `{session_key, turn_id, interrupt: HumanInterrupt}` → `HumanResponse`. Phase A does not implement `ingest.scan`/`ingest.read` (Phase B).
- The `--permission-mode` literals (measured on claude 2.1.274, `tools/spikes/_probes/2026-09-20-cli-probes.md`): **`acceptEdits` · `auto` · `bypassPermissions` · `manual` · `dontAsk` · `plan`**. There is **no** value called `"default"`.
- `PermissionProfile` → `--permission-mode` mapping (A2 §7.1): `observe` → `plan`, `workspace` → `manual`, `trusted` → `bypassPermissions` (only inside allowed_roots). Pending until the gate ⑫ result settles it.
- Reconnect: 1s→2s→4s→…capped at 30s, ±20% jitter. While disconnected, durable events pile up in `~/.omnis/outbox.ndjson` (≤50MB) and are flushed in order on reconnect; ephemeral deltas are dropped.

## 9. Common conventions

- **Env vars**: `DATABASE_URL` (required), `OMNIS_HUB_PORT=8787`, `OMNIS_HUB_URL`, `OMNIS_HOST`, `OMNIS_TOKEN_KEYCHAIN_ITEM`, `OMNIS_RUNTIMES`, `OMNIS_HUB_HTTP_URL`, `OMNIS_BRIDGE_TOKEN` (injected by the A6 wrapper from Keychain `omnis.bridge.token.<host>`), `OMNIS_ZERO_URL`, `ZERO_UPSTREAM_DB`, `ZERO_CVR_DB`, `ZERO_REPLICA_FILE`, `OLLAMA_HOST=127.0.0.1:11434`, `HERMES_BASE_URL`. New variables use the `OMNIS_` prefix + upper snake case.
- **Keychain item rules** (base form `omnis.<channel>.<kind>.<external_id>`, the account field is `281932556+jinhologankim@users.noreply.github.com`):
  - The Google family (`gmail`/`gcal`) **shares 1 item, `omnis.gmail.<email>`**, and omits the `<kind>` segment. The `gcal` adapter has `channel:"gcal"` while reusing the same `keychainService`.
  - Slack uses **2 items**: `omnis.slack.xoxb.<team_id>` (bot token, account=`<team_id>`) and `omnis.slack.xoxb.<team_id>.app` (app token). Onboarding writes these names too (not `xoxp`).
  - The bridge token is `omnis.bridge.token.<host>` (§8).
- **Intended duplication**: `createLogger` (`@omnis/kernel` + `apps/local-agent`) and `readKeychainSecret` (the 3 adapters + `apps/local-agent`) each keep their own copy because of package boundaries. Do not extract them into a shared package — do not reopen this discussion.
- **Logs**: one-line JSON to stdout. Required keys `{"ts":"<ISO8601>","level":"debug|info|warn|error","pkg":"@omnis/kernel","msg":"...","trace_id":"<ULID|null>"}`. Never put secret values in any key.
- **Error classes**: `AdapterError` (`@omnis/protocol`, 6 `kind` values), `BridgeError` (`@omnis/protocol`, `code`), `MigrationError` (`@omnis/db`), `KillSwitchError` and `ApprovalStateError` (`@omnis/kernel`), `LoopBudgetError` and `SchemaViolationError` (`@omnis/agents`). All set `name` equal to the class name.
- **Adapter contract test fixture layout** (A1 §1.7):

```
packages/adapters/<channel>/fixtures/<scenario>.json   # { scenario, raw, expected: { items: [...] } }
packages/adapters/<channel>/test/contract.test.ts      # expect(normalize(f.raw)).toEqual(f.expected.items)
```

Minimum scenario filenames per channel: `text_message.json`, `thread_reply.json`, `attachment.json`, `rate_limited_response.json`, `auth_error_response.json` (Slack and Telegram also add `edited_message.json`, `deleted_message.json`). No network or auth calls.
- **Branches and commits**: branch `ralph/<story-id>` (`plan/<plan-slug>` when running plans in parallel), worktree in worktrunk's default sibling layout `~/AI-Workspaces/omnis.<branch>` (measured at gate ⑭, `tools/spikes/_probes`). Homebrew git ≥ 2.43 required (`/opt/homebrew/bin` first). One atomic commit per story, subject format **`US-A05: kernel event bus 3-tier routing`** (= `<story-id>: <one-line summary>`, A7 §6), the body listing the satisfied acceptance criteria, at the end of the body `Implemented-by: Claude <tier>` or `Implemented-by: DeepSeek V4.1 Flash`, and the last line per the session rules `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## 10. Story → plan file → task

kernel-and-db Tasks 16~25 (US-A07~A10) **depend on `@omnis/protocol` (US-A11)** — they use `HumanInterrupt`/`HumanResponse`/`ApprovalAction`/`IngestSink`/`ThreadRef`/`Outbound`/`SendResult`, so they start after US-A11 merges (they are missing from the dependency column in A7 §7).

| Story | Plan file | Task |
|---|---|---|
| US-A00 (+gates ①~⑭) | `2026-09-20-phase-0-spikes.md` | spike-scaffold, gate-01…gate-14, worktrunk-cli-spike, tauri-ui-test-spike |
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

## Change history (2026-09-20, cross-plan review)

Every recommended change in §2 of `2026-09-20-plans-review.md` has been applied. Applied items:

- **§1** — Replaced the `@omnis/agents` dependencies with `@omnis/protocol`,`ai`,`pg` (removed `@omnis/memory`, unused in Phase A). Added `@omnis/kernel` (for the `/zero` subpath only) to the `@omnis/desktop` dependencies + made the workspace dep declaration in `package.json` explicit. (M9)
- **§2** — Stated that the root file owner = kernel-and-db Task 1, and replaced the root scaffold steps in the other plans with a `test -f` check. Fixed the version pins (`vitest 2.1.9` · `zod ^3.24.1` · `pg 8.13.1` · `typescript 5.6.3` · `pnpm@9.12.3` · `@rocicorp/zero 1.9.0` · `ai 7.0.107`). Included `*.test.tsx` in the `unit` include. Stated that `pnpm dev`/`tauri:dev`/`tauri:build`/`db:migrate` are root scripts. (M1~M5, M12)
- **§3.5** — Added `PermissionProfile`·`SessionOrigin`·`SessionState`·`RuntimeState`·`JSONRPC_ERRORS`·`SUPPORTED_PROTOCOL_VERSIONS`·`RpcMeta`·`withMeta`·`assertProtocolVersion`·`toJsonRpcError`, and corrected `BridgeErrorCode` to the union of BRIDGE+JSONRPC (signature sources: `2026-09-20-phase-a-agent-bridge.md` Tasks 1·3·4).
- **§5** — Added `beginExecution`/`completeExecution`/`failExecution`/`expire` to `Approvals`. Added the `PendingApproval`, `Logger`/`createLogger`, `killSwitchStatus`, `runEgress`/`EgressToken`/`EgressSpec`/`EgressDeps`/`createOutbox`/`createIngestSink`, and `assertZeroPublication`/`ZeroPublicationError` definitions (sources: `2026-09-20-phase-a-kernel-and-db.md` Tasks 12·16·18·19·22, `…-sync-and-agents.md` Task 2). `WS /bridge` server implementation owner = kernel-and-db (new task `hub-bridge-ws` after T24). (M6)
- **§6** — Added the `ItemRow` definition (owner `@omnis/agents/src/types.ts`), and added `configureAgents`/`getAgentsPool`/`AgentsNotConfiguredError`.
- **§7** — Stated `@rocicorp/zero 1.9.0` exact, added the `ZERO_TABLES`/`ZERO_ITEM_COLUMNS` exports. (M10)
- **§8** — Recorded the 6 `--permission-mode` literals (`acceptEdits`/`auto`/`bypassPermissions`/`manual`/`dontAsk`/`plan`, no `default`) + the `PermissionProfile`→mode mapping (observe→`plan`, workspace→`manual`, trusted→`bypassPermissions`, pending until gate ⑫ settles it). Source: `tools/spikes/_probes/2026-09-20-cli-probes.md`.
- **§9** — Added `OMNIS_HUB_HTTP_URL` (M11). Documented the Keychain rules: the Google family shares 1 item `omnis.gmail.<email>` (omitting `<kind>`, reused by gcal), Slack uses 2 items `omnis.slack.xoxb.<team_id>` + `….app` (account=`<team_id>`), bridge token `omnis.bridge.token.<host>`. (M7, M8) Pinned the `createLogger`·`readKeychainSecret` duplication as intentional in one line.
- **§10** — Stated that kernel-and-db Tasks 16~25 depend on US-A11, and added the `hub-bridge-ws` task to US-A10.

Not applied (outside the contract = fixes belonging to the plan documents): M13 (`.github/workflows/ci.yml` owner unassigned), M14 (scope reduction of phase-0 T17).
- (Fable, 2026-09-20 follow-up) Corrected the §8 `bare` key, §9 `OMNIS_BRIDGE_TOKEN`, the worktree sibling layout, and the commit trailer rules (Implemented-by in the body + Co-Authored-By Fable).
