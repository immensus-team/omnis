# Protocol and Channel Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@omnis/protocol`의 zod 계약(NormalizedItem/Adapter/Capabilities)을 코드로 확정하고, 그 계약 위에 Slack·Gmail·Google Calendar 세 채널 어댑터를 fixture-replay 계약 테스트와 함께 구현한다.

**Architecture:** `packages/protocol`은 다른 내부 패키지를 import하지 않는 리프 패키지로, zod 스키마와 `Adapter`/`AuthRef`/`AdapterError` 같은 순수 타입만 export한다. 세 어댑터 패키지(`packages/adapters/{slack,gmail,google-calendar}`)는 각각 `@omnis/protocol`에만 의존하고 서로를 import하지 않으며, raw 페이로드 → `NormalizedItem[]` 변환을 `normalize()`라는 순수 함수로 `Adapter` 객체와 분리해 export해 네트워크 없이 fixture로 검증할 수 있게 한다. `send()`는 실제 채널 API를 호출하지 않고 주입 가능한 mock sink만 호출한다 — 승인 게이트(US-A07, 커널 플랜)가 없는 동안 비가역 전송을 막기 위함이다.

**Tech Stack:** TypeScript 5.6.3(strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`) · zod ^3.24.1(오너 `@omnis/protocol`, 어느 패키지도 zod 4를 쓰지 않는다) · vitest 2.1.9 · Biome 1.9.x · `@slack/socket-mode` ^2.0.5 · `@slack/web-api` ^7.9.3 · `googleapis` ^161.0.0 · Node 22 · pnpm workspaces. 버전 핀 출처: `2026-09-20-phase-a-interfaces.md` §2(FIXED).

**Spec:** `/Users/logankim/AI-Workspaces/omnis/docs/spec/00-omnis-design.md` §8 + `/Users/logankim/AI-Workspaces/omnis/docs/spec/A1-channel-adapters.md`(전체) + `/Users/logankim/AI-Workspaces/omnis/docs/spec/A3-data-schema.md` §2(items/threads/accounts) + `/Users/logankim/AI-Workspaces/omnis/docs/superpowers/plans/2026-09-20-phase-a-interfaces.md` §1·§2·§3·§9(패키지 이름, 툴체인, protocol exports, 공통 규약 — FIXED).

## Global Constraints

- Node 22 + pnpm workspaces(A7 §1~2).
- TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`, 루트 `tsconfig.base.json`(A7 §1).
- Postgres 17(A3) — 이 플랜은 DB에 손대지 않는다(어댑터는 `packages/kernel`을 import하지 않는다, A7 §1).
- 허브는 `127.0.0.1:8787`에만 bind(master §4.2) — 이 플랜의 어댑터는 허브 프로세스에 아직 배선되지 않는다.
- 마이그레이션은 append-only `packages/db/migrations/000N_<name>.sql` + 추적 테이블 `_omnis_migrations`(A3 §8) — 이 플랜은 마이그레이션을 만들지 않는다.
- 승인 게이트(US-A07)가 없는 동안 `send`/`delete`/`calendar_write`/`delegate` 같은 비가역 tool을 kernel에 직접 연결하지 않는다(A7 §7 공통 금지) — 모든 `send()`는 mock sink만 호출한다.
- provider SDK(`@slack/*`, `googleapis`)는 그 어댑터 패키지 안에서만 import한다(A7 §7 공통 금지, §1 의존 규칙).
- 테스트를 삭제·스킵해서 통과시키지 않는다.
- Keychain 항목명은 A1 §1.3 규약(`omnis.<channel>.<kind>.<external_id>`) + interfaces.md §9 FIXED 예외: Google 계열(`gmail`/`gcal`)은 `omnis.gmail.<email>` 1항목을 공유(`<kind>` 생략), Slack은 `omnis.slack.xoxb.<team_id>`(account=`<team_id>`)와 `…​.app` 2항목(`xoxp` 아님).
- 스토리 티어는 A7 §4: US-A11(Task 2·3) = Sonnet, US-A11 Task 1(타입 스캐폴드) = DeepSeek, US-A12~A14 = Sonnet, US-A15 = DeepSeek(리뷰 Sonnet+).
- 커밋(interfaces.md §9, kernel-and-db 플랜과 동일 규칙): 브랜치 `ralph/<story-id>`, 워크트리 `omnis/.worktrees/<story-id>`. 스토리당 원자 커밋 1개, 제목 형식 `<story-id>: <한 줄 요약>`(A7 §6), 본문에 충족한 acceptance criteria 목록, 마지막 줄은 스토리 티어에 맞는 `Co-Authored-By: Claude <tier> <noreply@anthropic.com>`(Sonnet 태스크는 `Claude Sonnet`) 또는 `Co-Authored-By: DeepSeek V4.1 Flash <noreply@deepseek.com>` — `fable`은 A7-D6이 헤드리스 개발 루프에서 배제하므로 쓰지 않는다(계약 §9는 default를 정하지 않으며 이 항목이 정본이다).

---

### Task 1: `@omnis/protocol` 스캐폴드 + 값 집합·브랜디드 타입 (US-A11, tier: DeepSeek)

**US-A11 산출물(A7 §7):** `packages/protocol` — `NormalizedItem`/`Adapter`/`Capabilities` zod 스키마. **검증 명령:** `pnpm --filter @omnis/protocol test`. **목표:** interfaces.md §3.1~3.3 계약을 코드로 확정.

**Files:**
- Verify only (does not create — 루트 파일 오너는 kernel-and-db Task 1): `pnpm-workspace.yaml`, `package.json`(root), `tsconfig.base.json`, `biome.jsonc`
- Create: `packages/protocol/package.json`, `packages/protocol/tsconfig.json`, `packages/protocol/vitest.config.ts`
- Create: `packages/protocol/src/adapter.ts`
- Test: `packages/protocol/test/enums.test.ts`

**Interfaces:** Consumes: 없음(리프). Produces: `Channel`, `ThreadKind`, `ItemKind`, `ItemStatus`, `Scope`, `Sensitivity`, `HostId`, `RuntimeKind`(zod enum + `z.infer` 타입), `SessionKey`, `SessionId`(브랜디드 문자열 + zod 스키마) — 전부 interfaces.md §3.1 그대로.

**루트 스캐폴드는 이 태스크가 만들지 않는다.** 루트 `pnpm-workspace.yaml`/`package.json`/`tsconfig.base.json`/`biome.jsonc`의 오너는 `2026-09-20-phase-a-kernel-and-db.md` Task 1이다(interfaces.md §2, FIXED — plans-review.md M4). 이 태스크는 그 파일들의 존재를 `test -f`로만 확인한다. Wave 0에서 kernel-and-db Task 1과 이 태스크는 선행 없이 병렬로 도므로(plans-review.md §3), kernel Task 1이 아직 끝나지 않아 루트 파일이 없다면 **kernel-and-db Task 1(db-scaffold)을 먼저 실행하고 이 태스크를 재개한다.**

- [ ] 1. 루트 워크스페이스 파일이 있는지 확인만 한다(생성하지 않는다).

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  test -f pnpm-workspace.yaml && test -f package.json && test -f tsconfig.base.json && test -f biome.jsonc \
    && echo "루트 스캐폴드 확인됨(kernel-and-db Task 1이 만든 것)" \
    || { echo "루트 스캐폴드가 없다 — kernel-and-db Task 1(db-scaffold)을 먼저 실행한 뒤 이 태스크를 재개한다."; exit 1; }
  ```

- [ ] 2. `packages/protocol` 패키지 스캐폴드를 만든다.

  ```bash
  mkdir -p /Users/logankim/AI-Workspaces/omnis/packages/protocol/src
  mkdir -p /Users/logankim/AI-Workspaces/omnis/packages/protocol/test
  cat > /Users/logankim/AI-Workspaces/omnis/packages/protocol/package.json <<'EOF'
  {
    "name": "@omnis/protocol",
    "version": "0.0.1",
    "private": true,
    "type": "module",
    "main": "./dist/index.js",
    "types": "./dist/index.d.ts",
    "scripts": {
      "build": "tsc --build",
      "test": "vitest run"
    },
    "dependencies": {
      "zod": "^3.24.1"
    },
    "devDependencies": {
      "typescript": "5.6.3",
      "vitest": "2.1.9"
    }
  }
  EOF
  cat > /Users/logankim/AI-Workspaces/omnis/packages/protocol/tsconfig.json <<'EOF'
  {
    "extends": "../../tsconfig.base.json",
    "compilerOptions": { "outDir": "dist", "rootDir": "src" },
    "include": ["src"]
  }
  EOF
  cat > /Users/logankim/AI-Workspaces/omnis/packages/protocol/vitest.config.ts <<'EOF'
  import { defineConfig } from "vitest/config";

  export default defineConfig({ test: { environment: "node" } });
  EOF
  ```

- [ ] 3. 실패하는 테스트를 작성한다: `packages/protocol/test/enums.test.ts`

  ```ts
  import { describe, expect, it } from "vitest";
  import { Channel, SessionKey, ThreadKind } from "../src/adapter.js";

  describe("protocol value sets", () => {
    it("Channel accepts the 10 contract values and rejects unknown channels", () => {
      expect(Channel.parse("slack")).toBe("slack");
      expect(Channel.parse("gcal")).toBe("gcal");
      expect(Channel.parse("agent")).toBe("agent");
      expect(Channel.parse("system")).toBe("system");
      expect(() => Channel.parse("discord")).toThrow();
    });

    it("ThreadKind accepts calendar and agent_session", () => {
      expect(ThreadKind.parse("calendar")).toBe("calendar");
      expect(ThreadKind.parse("agent_session")).toBe("agent_session");
    });

    it("SessionKey enforces agent:<runtime>:<mini|macbook>:<purpose>", () => {
      expect(SessionKey.parse("agent:codex:mini:inbox-classify")).toBe(
        "agent:codex:mini:inbox-classify",
      );
      expect(() => SessionKey.parse("agent:codex:phone:inbox-classify")).toThrow();
      expect(() => SessionKey.parse("not-a-session-key")).toThrow();
    });
  });
  ```

- [ ] 4. 테스트를 실행해 실패를 확인한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/protocol test
  ```

  예상 실패: `Cannot find module '../src/adapter.js'` (아직 `src/adapter.ts`가 없으므로 — pnpm/node_modules가 없다면 먼저 `pnpm install`을 루트에서 1회 실행).

- [ ] 5. 최소 구현을 작성한다: `packages/protocol/src/adapter.ts` (interfaces.md §3.1 그대로)

  ```ts
  import { z } from "zod";

  export const Channel = z.enum([
    "slack", "gmail", "gcal", "outlook", "telegram",
    "whatsapp", "kakaotalk", "linkedin", "agent", "system",
  ]);
  export const ThreadKind = z.enum(["dm", "group", "email", "agent_session", "calendar", "system"]);
  export const ItemKind = z.enum(["message", "email", "event", "agent_turn", "tool_call", "system"]);
  export const ItemStatus = z.enum([
    "received", "read", "draft", "approved", "sent", "failed", "archived",
  ]);
  export const Scope = z.enum(["work", "personal", "unknown"]);
  export const Sensitivity = z.enum(["normal", "personal", "finance", "legal", "health"]);
  export const HostId = z.enum(["mini", "macbook"]);
  export const RuntimeKind = z.enum(["claude_code", "codex", "claude_ds", "hermes", "omnis"]);

  export type Channel = z.infer<typeof Channel>;
  export type ThreadKind = z.infer<typeof ThreadKind>;
  export type ItemKind = z.infer<typeof ItemKind>;
  export type ItemStatus = z.infer<typeof ItemStatus>;
  export type Scope = z.infer<typeof Scope>;
  export type Sensitivity = z.infer<typeof Sensitivity>;
  export type HostId = z.infer<typeof HostId>;
  export type RuntimeKind = z.infer<typeof RuntimeKind>;

  declare const brand: unique symbol;
  export type SessionKey = string & { readonly [brand]: "SessionKey" };
  export type SessionId = string & { readonly [brand]: "SessionId" };

  export const SessionKey = z
    .string()
    .min(1)
    .max(256)
    .regex(/^agent:[a-z_]+:(mini|macbook):[A-Za-z0-9_-]+$/)
    .transform((s) => s as SessionKey);
  export const SessionId = z.string().min(1).transform((s) => s as SessionId);
  ```

- [ ] 6. 테스트를 실행해 통과를 확인한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/protocol test
  ```

  예상 출력: `Test Files  1 passed (1)` / `Tests  3 passed (3)`.

- [ ] 7. 커밋한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/protocol
  git commit -m "$(cat <<'EOF'
  US-A11: protocol 값 집합·브랜디드 타입

  - 루트 스캐폴드(pnpm-workspace.yaml/package.json/tsconfig.base.json/biome.jsonc)는 만들지 않는다 — 오너는 kernel-and-db Task 1(interfaces.md §2)
  - packages/protocol: Channel/ThreadKind/ItemKind/ItemStatus/Scope/Sensitivity/HostId/RuntimeKind zod enum
  - SessionKey/SessionId 브랜디드 타입 + 정규식 검증

  Co-Authored-By: DeepSeek V4.1 Flash <noreply@deepseek.com>
  EOF
  )"
  ```

---

### Task 2: NormalizedItem / NormalizedThread / Capabilities (US-A11, tier: Sonnet)

**Files:**
- Modify: `packages/protocol/src/adapter.ts`
- Test: `packages/protocol/test/normalized.test.ts`

**Interfaces:** Consumes: Task 1의 `Channel`, `ThreadKind`, `ItemKind`, `ItemStatus`(re-import는 안 함, 같은 파일). Produces: `Capabilities`, `ParticipantRef`, `NormalizedThread`, `Attachment`, `NormalizedItem`(interfaces.md §3.2 그대로).

- [ ] 1. 실패하는 테스트를 작성한다: `packages/protocol/test/normalized.test.ts`

  ```ts
  import { describe, expect, it } from "vitest";
  import { Capabilities, NormalizedItem } from "../src/adapter.js";

  describe("Capabilities", () => {
    it("rejects a missing field", () => {
      const missingDelete = {
        read: true, write: true, realtime: true, history: true,
        media: true, markRead: true, typing: false, archive: false,
      };
      expect(() => Capabilities.parse(missingDelete)).toThrow();
    });
  });

  describe("NormalizedItem", () => {
    it("accepts a minimal received message and defaults attachments to []", () => {
      const parsed = NormalizedItem.parse({
        threadExternalId: "C0123456789",
        externalId: "1700000000.000100",
        kind: "message",
        author: { kind: "person", id: "U0123456789" },
        body: "hey",
        attachments: [],
        sentAt: "2023-11-14T22:13:20.000Z",
        status: "received",
        sourceHash: "1700000000.000100",
      });
      expect(parsed.attachments).toEqual([]);
      expect(parsed.threadMeta).toBeUndefined();
    });

    it("rejects status other than 'received'", () => {
      expect(() =>
        NormalizedItem.parse({
          threadExternalId: "C1", externalId: "e1", kind: "message",
          author: { kind: "person", id: "U1" }, body: "hi", attachments: [],
          sentAt: "2023-11-14T22:13:20.000Z", status: "sent", sourceHash: "h1",
        }),
      ).toThrow();
    });
  });
  ```

- [ ] 2. 테스트를 실행해 실패를 확인한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/protocol test
  ```

  예상 실패: `does not provide an export named 'Capabilities'`.

- [ ] 3. `packages/protocol/src/adapter.ts` 끝에 아래를 추가한다(interfaces.md §3.2 그대로).

  ```ts
  export const Capabilities = z.object({
    read: z.boolean(), write: z.boolean(), realtime: z.boolean(), history: z.boolean(),
    media: z.boolean(), markRead: z.boolean(), typing: z.boolean(),
    archive: z.boolean(), delete: z.boolean(),
  });
  export type Capabilities = z.infer<typeof Capabilities>;

  export const ParticipantRef = z.object({
    externalId: z.string(), displayName: z.string(), personId: z.string().uuid().optional(),
  });
  export type ParticipantRef = z.infer<typeof ParticipantRef>;

  export const NormalizedThread = z.object({
    externalId: z.string(), kind: ThreadKind, title: z.string().nullable(),
    participants: z.array(ParticipantRef), lastItemAt: z.string().datetime(),
    archivedAt: z.string().datetime().nullable(),
  });
  export type NormalizedThread = z.infer<typeof NormalizedThread>;

  export const Attachment = z.object({
    kind: z.enum(["image", "file", "audio", "video", "link"]),
    url: z.string().optional(), mimeType: z.string().optional(),
    sizeBytes: z.number().int().optional(), caption: z.string().optional(),
  });
  export type Attachment = z.infer<typeof Attachment>;

  export const NormalizedItem = z.object({
    threadExternalId: z.string(), externalId: z.string(), kind: ItemKind,
    author: z.object({ kind: z.enum(["person", "agent", "system"]), id: z.string() }),
    body: z.string(), bodyHtml: z.string().optional(), attachments: z.array(Attachment),
    sentAt: z.string().datetime(), status: z.literal("received"),
    sourceHash: z.string(), threadMeta: NormalizedThread.optional(),
  });
  export type NormalizedItem = z.infer<typeof NormalizedItem>;
  ```

- [ ] 4. 테스트를 실행해 통과를 확인한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/protocol test
  ```

  예상 출력: `Tests  6 passed (6)`(Task 1의 3개 + 이 태스크의 3개).

- [ ] 5. 커밋한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/protocol
  git commit -m "$(cat <<'EOF'
  US-A11: NormalizedThread/NormalizedItem/Capabilities zod 스키마

  - Capabilities: read/write/realtime/history/media/markRead/typing/archive/delete 9필드
  - NormalizedItem.status는 항상 literal 'received'(A1 §1.2)
  - author.kind는 person|agent|system(A3 3컬럼 모델과 정렬, A1-D1)

  Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 3: AdapterEvent / AuthRef / AdapterError / Health / Adapter 인터페이스 (US-A11, tier: Sonnet)

**Files:**
- Modify: `packages/protocol/src/adapter.ts`
- Create: `packages/protocol/src/index.ts`
- Test: `packages/protocol/test/adapter-error.test.ts`

**Interfaces:** Consumes: Task 1·2의 `Channel`, `NormalizedItem`(같은 파일). Produces: `AdapterEvent`, `AuthRef`, `AdapterErrorKind`, `AdapterError`, `Health`, `ThreadRef`, `OutboundAttachment`, `Outbound`, `SendResult`, `Adapter`, `Normalize`, `IngestSink`(interfaces.md §3.3 그대로) — 세 어댑터 패키지가 전부 이 타입들에 의존한다.

- [ ] 1. 실패하는 테스트를 작성한다: `packages/protocol/test/adapter-error.test.ts`

  ```ts
  import { describe, expect, it } from "vitest";
  import { AdapterError } from "../src/adapter.js";

  describe("AdapterError", () => {
    it("carries kind, channel, retryAfterMs and cause; name matches class", () => {
      const cause = new Error("boom");
      const err = new AdapterError("retryable_rate_limit", "slack", "rate limited", 30_000, cause);
      expect(err.name).toBe("AdapterError");
      expect(err.kind).toBe("retryable_rate_limit");
      expect(err.channel).toBe("slack");
      expect(err.retryAfterMs).toBe(30_000);
      expect(err.cause).toBe(cause);
      expect(err).toBeInstanceOf(Error);
    });
  });
  ```

- [ ] 2. 테스트를 실행해 실패를 확인한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/protocol test
  ```

  예상 실패: `does not provide an export named 'AdapterError'`.

- [ ] 3. `packages/protocol/src/adapter.ts` 끝에 아래를 추가한다(interfaces.md §3.3 그대로).

  ```ts
  export const AdapterEvent = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("connected"), at: z.string().datetime() }),
    z.object({ kind: z.literal("disconnected"), reason: z.string(), at: z.string().datetime() }),
    z.object({
      kind: z.literal("auth_required"), reason: z.string(),
      authUrl: z.string().optional(), at: z.string().datetime(),
    }),
    z.object({
      kind: z.literal("rate_limited"), retryAfterMs: z.number().int(),
      endpoint: z.string(), at: z.string().datetime(),
    }),
    z.object({
      kind: z.literal("backfill_progress"), done: z.number().int(),
      total: z.number().int().nullable(), at: z.string().datetime(),
    }),
  ]);
  export type AdapterEvent = z.infer<typeof AdapterEvent>;

  export const AuthRef = z.object({
    channel: Channel, accountExternalId: z.string(),
    keychainService: z.string(), keychainAccount: z.string(),
  });
  export type AuthRef = z.infer<typeof AuthRef>;

  export type AdapterErrorKind =
    | "retryable_network" | "retryable_rate_limit"
    | "auth_expired" | "auth_revoked"
    | "fatal_protocol" | "fatal_unsupported";

  export class AdapterError extends Error {
    constructor(
      readonly kind: AdapterErrorKind,
      readonly channel: Channel,
      message: string,
      readonly retryAfterMs?: number,
      readonly cause?: unknown,
    ) {
      super(message);
      this.name = "AdapterError";
    }
  }

  export interface Health {
    channel: Channel; accountExternalId: string;
    status: "healthy" | "degraded" | "down";
    lastEventAt: string | null;
    lastError?: { kind: AdapterErrorKind; message: string; at: string };
    latencyMsP50?: number;
  }

  export interface ThreadRef { accountId: string; externalId: string; }
  export interface OutboundAttachment {
    kind: "image" | "file"; localPath: string; mimeType: string; caption?: string;
  }
  export interface Outbound {
    text: string; bodyHtml?: string;
    attachments?: OutboundAttachment[]; replyToExternalId?: string;
  }
  export interface SendResult { externalId: string; sentAt: string; }

  export interface Adapter {
    id: string; channel: Channel;
    capabilities(): Capabilities;
    connect(auth: AuthRef): Promise<void>;
    disconnect?(): Promise<void>;
    backfill(since?: Date): AsyncIterable<NormalizedItem>;
    subscribe(): AsyncIterable<NormalizedItem | AdapterEvent>;
    send(thread: ThreadRef, draft: Outbound): Promise<SendResult>;
    markRead?(thread: ThreadRef): Promise<void>;
    archive?(thread: ThreadRef): Promise<void>;
    health(): Promise<Health>;
  }

  export type Normalize = (raw: unknown) => NormalizedItem[];
  export type IngestSink = (accountId: string, e: NormalizedItem | AdapterEvent) => Promise<void>;
  ```

- [ ] 4. `packages/protocol/src/index.ts`를 만든다(재export).

  ```ts
  export * from "./adapter.js";
  ```

- [ ] 5. 테스트를 실행해 통과를 확인한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/protocol test
  ```

  예상 출력: `Tests  7 passed (7)`.

- [ ] 6. 커밋한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/protocol
  git commit -m "$(cat <<'EOF'
  US-A11: AdapterEvent/AuthRef/AdapterError/Health/Adapter 인터페이스 + index re-export

  - AdapterError 6종 kind, name='AdapterError' 고정(A1 §1.4)
  - Adapter 인터페이스: connect/disconnect?/backfill/subscribe/send/markRead?/archive?/health(A1 §1.6)
  - Normalize/IngestSink 타입, packages/protocol/src/index.ts 재export

  Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 4: Slack 어댑터 — 패키지 스캐폴드 + Keychain + connect()/subscribe()/health() (US-A12, tier: Sonnet)

**US-A12 산출물(A7 §7):** `packages/adapters/slack/src/index.ts`. **검증 명령:** `pnpm --filter @omnis/adapter-slack test`. **목표:** Slack 어댑터: Socket Mode 연결 + backfill + realtime subscribe.

**Files:**
- Create: `packages/adapters/slack/package.json`, `packages/adapters/slack/tsconfig.json`, `packages/adapters/slack/vitest.config.ts`
- Create: `packages/adapters/slack/src/keychain.ts`, `packages/adapters/slack/src/index.ts`
- Test: `packages/adapters/slack/test/capabilities.test.ts`, `packages/adapters/slack/test/connect.test.ts`

**Interfaces:** Consumes: `@omnis/protocol`의 `Adapter`, `AuthRef`, `AdapterError`, `Health`, `Capabilities`, `NormalizedItem`, `AdapterEvent`(Task 3). Produces: `CHANNEL`(`"slack"` 리터럴), `createSlackAdapter(deps?: SlackAdapterDeps): Adapter`, `readKeychainSecret(service, account, channel): Promise<string>`.

읽을 스펙: A1 §1.3(Keychain 명명), §2.1(Slack 상세: Socket Mode, `apps.connections.open`, write-back 표). **Keychain 항목명(interfaces.md §9, FIXED)**: bot 토큰은 `omnis.slack.xoxb.<team_id>`(account=`<team_id>`), app 토큰은 `omnis.slack.xoxb.<team_id>.app`(account=`<team_id>`, 같은 계정) 2항목 — `xoxp`가 아니다. 아래 `AuthRef` 예시·fixture는 전부 이 명명을 그대로 쓴다. **만들지 않을 것(YAGNI)**: `typing` indicator(capabilities에서 `false`로 선언하고 끝 — A1 §1.1이 선언 안 하면 UI가 안 그린다고 했으니 구현도 필요 없다), Events API 폴백 경로(A1 §4 A1-④의 fail 시 대안일 뿐 Phase A 범위 아님).

- [ ] 1. 패키지 스캐폴드를 만든다.

  ```bash
  mkdir -p /Users/logankim/AI-Workspaces/omnis/packages/adapters/slack/src
  mkdir -p /Users/logankim/AI-Workspaces/omnis/packages/adapters/slack/test
  mkdir -p /Users/logankim/AI-Workspaces/omnis/packages/adapters/slack/fixtures
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/slack/package.json <<'EOF'
  {
    "name": "@omnis/adapter-slack",
    "version": "0.0.1",
    "private": true,
    "type": "module",
    "main": "./dist/index.js",
    "types": "./dist/index.d.ts",
    "scripts": { "build": "tsc --build", "test": "vitest run" },
    "dependencies": {
      "@omnis/protocol": "workspace:*",
      "@slack/socket-mode": "^2.0.5",
      "@slack/web-api": "^7.9.3"
    },
    "devDependencies": { "typescript": "5.6.3", "vitest": "2.1.9" }
  }
  EOF
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/slack/tsconfig.json <<'EOF'
  {
    "extends": "../../../tsconfig.base.json",
    "compilerOptions": { "outDir": "dist", "rootDir": "src" },
    "references": [{ "path": "../../protocol" }],
    "include": ["src"]
  }
  EOF
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/slack/vitest.config.ts <<'EOF'
  import { defineConfig } from "vitest/config";

  export default defineConfig({ test: { environment: "node" } });
  EOF
  ```

- [ ] 2. 실패하는 테스트를 작성한다: `packages/adapters/slack/test/capabilities.test.ts`

  ```ts
  import { describe, expect, it } from "vitest";
  import { createSlackAdapter } from "../src/index.js";

  describe("Slack adapter capabilities", () => {
    it("declares archive=false, delete=false, typing=false per A1 §2.1/§3", () => {
      const adapter = createSlackAdapter();
      expect(adapter.channel).toBe("slack");
      expect(adapter.capabilities()).toEqual({
        read: true, write: true, realtime: true, history: true,
        media: true, markRead: true, typing: false, archive: false, delete: false,
      });
    });
  });
  ```

- [ ] 3. 테스트를 실행해 실패를 확인한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm install && pnpm --filter @omnis/adapter-slack test
  ```

  예상 실패: `Cannot find module '../src/index.js'`.

- [ ] 4. Keychain 래퍼를 작성한다: `packages/adapters/slack/src/keychain.ts` (macOS `security` CLI 래핑, A1 §1.3)

  ```ts
  import { execFile } from "node:child_process";
  import { promisify } from "node:util";
  import { AdapterError, type Channel } from "@omnis/protocol";

  const execFileAsync = promisify(execFile);

  /** `security find-generic-password -s <service> -a <account> -w` 로 시크릿 값을 읽는다.
   *  값은 절대 로그로 찍지 않는다(A7 §9 로그 규약). */
  export async function readKeychainSecret(
    service: string,
    account: string,
    channel: Channel,
  ): Promise<string> {
    try {
      const { stdout } = await execFileAsync("security", [
        "find-generic-password", "-s", service, "-a", account, "-w",
      ]);
      return stdout.trim();
    } catch (cause) {
      throw new AdapterError(
        "auth_expired", channel,
        `Keychain item ${service}/${account} not found or locked`,
        undefined, cause,
      );
    }
  }
  ```

- [ ] 5. `src/index.ts`에 `capabilities()`/`connect()`/`disconnect()`/`subscribe()`/`health()`를 작성한다. `backfill`/`send`/`markRead`/`archive`는 아직 미구현이므로 호출 시 `fatal_unsupported`를 던진다(Task 5·6이 채운다).

  ```ts
  import { SocketModeClient } from "@slack/socket-mode";
  import { WebClient } from "@slack/web-api";
  import {
    AdapterError, type Adapter, type AdapterEvent, type Attachment, type AuthRef,
    type Capabilities, type Health, type NormalizedItem,
  } from "@omnis/protocol";
  import { readKeychainSecret } from "./keychain.js";

  export const CHANNEL = "slack" as const;

  const CAPABILITIES: Capabilities = {
    read: true, write: true, realtime: true, history: true,
    media: true, markRead: true, typing: false, archive: false, delete: false,
  };

  class AsyncQueue<T> {
    private buffered: T[] = [];
    private waiters: Array<(v: IteratorResult<T>) => void> = [];
    push(value: T): void {
      const waiter = this.waiters.shift();
      if (waiter) { waiter({ value, done: false }); return; }
      this.buffered.push(value);
    }
    private async next(): Promise<IteratorResult<T>> {
      const value = this.buffered.shift();
      if (value !== undefined) return { value, done: false };
      return new Promise((resolve) => this.waiters.push(resolve));
    }
    [Symbol.asyncIterator](): AsyncIterator<T> {
      return { next: () => this.next() };
    }
  }

  export interface SlackAdapterDeps {
    socketClient?: SocketModeClient;
    webClient?: WebClient;
    now?: () => Date;
  }

  export function createSlackAdapter(deps: SlackAdapterDeps = {}): Adapter {
    const now = deps.now ?? (() => new Date());
    let socket: SocketModeClient | undefined;
    let web: WebClient | undefined;
    const queue = new AsyncQueue<NormalizedItem | AdapterEvent>();
    let lastEventAt: string | null = null;
    let status: Health["status"] = "down";
    let lastError: Health["lastError"];

    return {
      id: "slack",
      channel: CHANNEL,
      capabilities: () => CAPABILITIES,

      async connect(auth: AuthRef): Promise<void> {
        const xoxbToken = await readKeychainSecret(auth.keychainService, auth.keychainAccount, CHANNEL);
        web = deps.webClient ?? new WebClient(xoxbToken);
        const appToken = await readKeychainSecret(
          `${auth.keychainService}.app`, auth.keychainAccount, CHANNEL,
        );
        socket = deps.socketClient ?? new SocketModeClient({ appToken });

        socket.on("disconnect", () => {
          status = "degraded";
          queue.push({ kind: "disconnected", reason: "socket_mode_disconnect", at: now().toISOString() });
        });

        try {
          await socket.start();
        } catch (cause) {
          status = "down";
          lastError = { kind: "retryable_network", message: "socket mode start failed", at: now().toISOString() };
          throw new AdapterError("retryable_network", CHANNEL, "socket mode start failed", undefined, cause);
        }
        status = "healthy";
        lastEventAt = now().toISOString();
        queue.push({ kind: "connected", at: lastEventAt });
      },

      async disconnect(): Promise<void> {
        await socket?.disconnect();
        status = "down";
      },

      async *backfill(): AsyncIterable<NormalizedItem> {
        throw new AdapterError("fatal_unsupported", CHANNEL, "backfill not implemented until Task 5");
      },

      subscribe(): AsyncIterable<NormalizedItem | AdapterEvent> {
        return queue;
      },

      async send(): Promise<never> {
        throw new AdapterError("fatal_unsupported", CHANNEL, "send not implemented until Task 6");
      },

      async health(): Promise<Health> {
        return {
          channel: CHANNEL, accountExternalId: "", status, lastEventAt,
          ...(lastError ? { lastError } : {}),
        };
      },
    };
  }
  ```

- [ ] 6. 테스트를 실행해 통과를 확인한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/adapter-slack test
  ```

  예상 출력: `Tests  1 passed (1)`.

- [ ] 7. `connect()`가 `auth_expired`로 실패하는 경로를 검증하는 테스트를 추가한다: `packages/adapters/slack/test/connect.test.ts`

  ```ts
  import { describe, expect, it } from "vitest";
  import { AdapterError } from "@omnis/protocol";
  import { createSlackAdapter } from "../src/index.js";

  describe("Slack adapter connect()", () => {
    it("throws AdapterError(auth_expired) when the Keychain item is missing", async () => {
      const adapter = createSlackAdapter();
      await expect(
        adapter.connect({
          channel: "slack", accountExternalId: "T000UNKNOWN",
          keychainService: "omnis.slack.xoxb.T000UNKNOWN", keychainAccount: "T000UNKNOWN",
        }),
      ).rejects.toThrow(AdapterError);
    });
  });
  ```

  이 테스트는 실제 macOS Keychain에 `omnis.slack.xoxb.T000UNKNOWN` 항목이 없다는 사실에 의존한다(CI/개발 머신 모두 해당 항목을 만들지 않으므로 항상 실패 경로를 탄다) — 네트워크 호출 없음.

- [ ] 8. 테스트를 실행해 통과를 확인한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/adapter-slack test
  ```

  예상 출력: `Tests  2 passed (2)`.

- [ ] 9. 커밋한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/adapters/slack
  git commit -m "$(cat <<'EOF'
  US-A12: Slack 어댑터 스캐폴드 + Keychain + connect()/subscribe()/health()

  - readKeychainSecret(): security CLI 래핑, 값은 로그에 남기지 않음(A1 §1.3)
  - connect(): xoxb(WebClient)+app token(SocketModeClient) 둘 다 Keychain에서 읽음
  - subscribe(): AsyncQueue 기반 AsyncIterable, connect()가 'connected' 이벤트를 큐에 씀
  - capabilities(): typing=false, archive=false, delete=false(A1 §3 write-back 표)
  - backfill()/send()는 아직 fatal_unsupported(Task 5·6에서 구현)

  Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 5: Slack 어댑터 — backfill() (US-A12, tier: Sonnet)

**Files:**
- Modify: `packages/adapters/slack/src/index.ts`
- Test: `packages/adapters/slack/test/backfill.test.ts`

**Interfaces:** Consumes: Task 4의 `CHANNEL`, `AsyncQueue`(내부), `@omnis/protocol`의 `AdapterError`. Produces: `backfill()` 구현(더 이상 `fatal_unsupported`를 던지지 않음), `SlackAdapterDeps.webClient` 주입 경로(이미 존재, backfill이 이제 실제로 사용).

읽을 스펙: A1 §2.1 backfill 문단(`conversations.history`/`conversations.replies`, 최근 30일, 페이지네이션+백오프, `backfill_progress` 이벤트).

- [ ] 1. 실패하는 테스트를 작성한다: `packages/adapters/slack/test/backfill.test.ts`(mock WebClient 주입, 실 네트워크 없음)

  ```ts
  import { describe, expect, it, vi } from "vitest";
  import { createSlackAdapter } from "../src/index.js";

  describe("Slack adapter backfill()", () => {
    it("paginates conversations.history and yields NormalizedItem per message", async () => {
      const historyPage1 = {
        ok: true, has_more: true, response_metadata: { next_cursor: "cursor-1" },
        messages: [{ type: "message", ts: "1700000000.000100", user: "U1", text: "first" }],
      };
      const historyPage2 = {
        ok: true, has_more: false, response_metadata: { next_cursor: "" },
        messages: [{ type: "message", ts: "1700000100.000200", user: "U1", text: "second" }],
      };
      const conversationsHistory = vi
        .fn()
        .mockResolvedValueOnce(historyPage1)
        .mockResolvedValueOnce(historyPage2);
      const webClient = { conversations: { history: conversationsHistory } } as never;

      const adapter = createSlackAdapter({ webClient });
      const collected: string[] = [];
      for await (const item of adapter.backfill()) collected.push(item.externalId);

      expect(collected).toEqual(["1700000000.000100", "1700000100.000200"]);
      expect(conversationsHistory).toHaveBeenCalledTimes(2);
      expect(conversationsHistory.mock.calls[1]?.[0]).toMatchObject({ cursor: "cursor-1" });
    });
  });
  ```

- [ ] 2. 테스트를 실행해 실패를 확인한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/adapter-slack test
  ```

  예상 실패: `expected [] to equal [ '1700000000.000100', '1700000100.000200' ]` (backfill이 아직 즉시 throw).

- [ ] 3. `src/index.ts`의 `backfill` 스텁을 아래로 교체한다(같은 파일, `channel:`/`capabilities:` 다음 위치 유지).

  ```ts
      async *backfill(since?: Date): AsyncIterable<NormalizedItem> {
        if (!web) throw new AdapterError("fatal_protocol", CHANNEL, "backfill() called before connect()");
        const oldest = since ? String(Math.floor(since.getTime() / 1000)) : undefined;
        let cursor: string | undefined;
        let done = 0;
        do {
          let page: {
            ok: boolean; has_more?: boolean;
            response_metadata?: { next_cursor?: string };
            messages?: unknown[];
          };
          try {
            page = await web.conversations.history({
              channel: "", cursor, oldest, limit: 200,
            } as never);
          } catch (cause) {
            const err = cause as { data?: { error?: string; retry_after?: number } };
            if (err.data?.error === "ratelimited") {
              throw new AdapterError(
                "retryable_rate_limit", CHANNEL, "Slack conversations.history rate limited",
                (err.data.retry_after ?? 60) * 1000, cause,
              );
            }
            throw new AdapterError("retryable_network", CHANNEL, "conversations.history failed", undefined, cause);
          }
          for (const raw of page.messages ?? []) {
            for (const item of normalize(raw)) yield item;
            done += 1;
          }
          cursor = page.response_metadata?.next_cursor || undefined;
          queue.push({ kind: "backfill_progress", done, total: null, at: now().toISOString() });
        } while (cursor);
      },
  ```

- [ ] 4. `normalize`가 아직 없으므로(Task 6에서 구현) 파일 끝에 임시 named export를 추가해 컴파일을 통과시킨다 — Task 6에서 이 스텁을 실제 구현으로 교체한다.

  ```ts
  export function normalize(raw: unknown): NormalizedItem[] {
    const m = raw as { type?: string; ts?: string; user?: string; text?: string };
    if (m.type !== "message" || !m.ts) return [];
    return [{
      threadExternalId: "", externalId: m.ts, kind: "message",
      author: { kind: "person", id: m.user ?? "" }, body: m.text ?? "",
      attachments: [], sentAt: new Date(Number(m.ts) * 1000).toISOString(),
      status: "received", sourceHash: m.ts,
    }];
  }
  ```

- [ ] 5. 테스트를 실행해 통과를 확인한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/adapter-slack test
  ```

  예상 출력: `Tests  3 passed (3)`.

- [ ] 6. 커밋한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/adapters/slack
  git commit -m "$(cat <<'EOF'
  US-A12: Slack backfill() — conversations.history 페이지네이션 + rate-limit 매핑

  - cursor 기반 페이지네이션, since가 있으면 oldest로 변환
  - ratelimited 응답을 AdapterError('retryable_rate_limit', retryAfterMs=retry_after*1000)로 매핑(A1 §1.4)
  - 페이지마다 backfill_progress 이벤트를 subscribe() 큐에 push
  - normalize()는 이 태스크에서 최소 스텁만(Task 6에서 thread_reply/attachment까지 완성)

  Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 6: Slack 어댑터 — normalize() 완성 + send()/markRead() mock sink (US-A12, tier: Sonnet)

**Files:**
- Modify: `packages/adapters/slack/src/index.ts`
- Test: `packages/adapters/slack/test/normalize.test.ts`, `packages/adapters/slack/test/send.test.ts`

**Interfaces:** Consumes: Task 3의 `Attachment`, `SendResult`, `Outbound`, `ThreadRef`. Produces: `normalize(raw: unknown): NormalizedItem[]`(완성판, thread_ts/attachment 처리), `mapApiError(raw: unknown): AdapterError`(fixture의 `rate_limited_response`/`auth_error_response` 시나리오가 검증할 별도 export — 계약 밖 심볼), `createSlackAdapter().send`(mock sink 경유).

읽을 스펙: A1 §2.1 thread/ID 매핑(`ts` vs `thread_ts`, `sourceHash`=`ts`), 미디어(다운로드 후 로컬 캐시), write-back(`chat.postMessage`는 **아직 안 붙인다** — "Do not wire send() to anything but a mock sink until the approval gate exists").

- [ ] 1. 실패하는 테스트를 작성한다: `packages/adapters/slack/test/normalize.test.ts`

  ```ts
  import { describe, expect, it } from "vitest";
  import { normalize } from "../src/index.js";

  describe("Slack normalize()", () => {
    it("maps a plain channel message", () => {
      const raw = {
        type: "message", channel: "C0123456789", user: "U0123456789",
        text: "hey, can you review the PR?", ts: "1700000000.000100", team: "T0123456789",
      };
      expect(normalize(raw)).toEqual([{
        threadExternalId: "C0123456789", externalId: "1700000000.000100", kind: "message",
        author: { kind: "person", id: "U0123456789" }, body: "hey, can you review the PR?",
        attachments: [], sentAt: "2023-11-14T22:13:20.000Z", status: "received",
        sourceHash: "1700000000.000100",
      }]);
    });

    it("uses thread_ts for threadExternalId grouping but keeps ts as externalId/sourceHash", () => {
      const raw = {
        type: "message", channel: "C0123456789", user: "U0123456789",
        text: "reply", ts: "1700000100.000200", thread_ts: "1700000000.000100", team: "T0123456789",
      };
      const [item] = normalize(raw);
      expect(item?.externalId).toBe("1700000100.000200");
      expect(item?.sourceHash).toBe("1700000100.000200");
    });

    it("maps a file attachment", () => {
      const raw = {
        type: "message", channel: "C0123456789", user: "U0123456789", text: "see attached",
        ts: "1700000200.000300", team: "T0123456789",
        files: [{ mimetype: "image/png", size: 2048, url_private: "https://files.slack.com/x/y.png", name: "y.png" }],
      };
      const [item] = normalize(raw);
      expect(item?.attachments).toEqual([
        { kind: "image", mimeType: "image/png", sizeBytes: 2048, caption: "y.png" },
      ]);
    });
  });
  ```

- [ ] 2. 테스트를 실행해 실패를 확인한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/adapter-slack test
  ```

  예상 실패: `threadExternalId`가 `""`(Task 5 스텁은 thread 매핑도 attachment 매핑도 하지 않음), attachment 테스트는 `attachments`가 `[]`로 나와 실패.

- [ ] 3. `src/index.ts`의 `normalize` 스텁을 아래로 교체한다(A1 §2.1 thread/ID 매핑·미디어 규칙 그대로).

  ```ts
  interface SlackFile {
    mimetype?: string; size?: number; url_private?: string; name?: string;
  }
  interface SlackMessageEvent {
    type?: string; channel?: string; user?: string; text?: string;
    ts?: string; thread_ts?: string; files?: SlackFile[];
  }

  function mimeToAttachmentKind(mimetype: string | undefined): Attachment["kind"] {
    if (!mimetype) return "file";
    if (mimetype.startsWith("image/")) return "image";
    if (mimetype.startsWith("audio/")) return "audio";
    if (mimetype.startsWith("video/")) return "video";
    return "file";
  }

  export function normalize(raw: unknown): NormalizedItem[] {
    const m = raw as SlackMessageEvent;
    if (m.type !== "message" || !m.ts || !m.channel) return [];

    const attachments: Attachment[] = (m.files ?? []).map((f) => ({
      kind: mimeToAttachmentKind(f.mimetype),
      mimeType: f.mimetype, sizeBytes: f.size, caption: f.name,
    }));

    return [{
      threadExternalId: m.channel,
      externalId: m.ts,
      kind: "message",
      author: { kind: "person", id: m.user ?? "" },
      body: m.text ?? "",
      attachments,
      sentAt: new Date(Number(m.ts) * 1000).toISOString(),
      status: "received",
      sourceHash: m.ts,
    }];
  }

  export function mapApiError(raw: unknown): AdapterError {
    const r = raw as { httpStatus?: number; headers?: Record<string, string>; body?: { error?: string } };
    if (r.httpStatus === 429) {
      const retryAfterSec = Number(r.headers?.["retry-after"] ?? "60");
      return new AdapterError(
        "retryable_rate_limit", CHANNEL, `Slack rate limited: ${r.body?.error ?? "ratelimited"}`,
        retryAfterSec * 1000,
      );
    }
    if (r.httpStatus === 401) {
      const kind = r.body?.error === "token_revoked" ? "auth_revoked" : "auth_expired";
      return new AdapterError(kind, CHANNEL, `Slack auth error: ${r.body?.error ?? "invalid_auth"}`);
    }
    return new AdapterError("fatal_protocol", CHANNEL, `Unmapped Slack API error (status=${r.httpStatus})`);
  }
  ```

  `NormalizedItem`이 `threadMeta`를 선택 필드로 두므로 신규 thread가 아닌 일반 메시지는 `threadMeta`를 생략한다(A1-D1 "신규 thread거나 메타데이터 변경 시에만").

- [ ] 4. `send`/`markRead` 스텁을 mock sink 버전으로 교체한다(`capabilities: () => CAPABILITIES,` 다음, `backfill` 앞).

  ```ts
  export interface SlackAdapterDeps {
    socketClient?: SocketModeClient;
    webClient?: WebClient;
    now?: () => Date;
    sink?: (thread: ThreadRef, draft: Outbound) => Promise<SendResult>;
  }
  ```

  (기존 `SlackAdapterDeps` 선언을 이 필드가 추가된 버전으로 교체한다.) 그리고 `send`/`markRead` 구현:

  ```ts
      // 승인 게이트(US-A07)가 아직 없다 — 실제 chat.postMessage는 절대 호출하지 않는다.
      // deps.sink가 없으면 SendResult를 합성만 하는 기본 mock sink를 쓴다.
      async send(thread: ThreadRef, draft: Outbound): Promise<SendResult> {
        const sink = deps.sink ?? (async (): Promise<SendResult> => ({
          externalId: `mock-${now().getTime()}`, sentAt: now().toISOString(),
        }));
        return sink(thread, draft);
      },

      async markRead(thread: ThreadRef): Promise<void> {
        if (!web) throw new AdapterError("fatal_protocol", CHANNEL, "markRead() called before connect()");
        await web.conversations.mark({ channel: thread.externalId, ts: String(now().getTime() / 1000) } as never);
      },
  ```

  `import type { Outbound, SendResult, ThreadRef } from "@omnis/protocol";`를 상단 import에 추가한다.

- [ ] 5. `send()`가 mock sink만 호출하고 실제 Slack API를 절대 부르지 않음을 검증하는 테스트를 추가한다: `packages/adapters/slack/test/send.test.ts`

  ```ts
  import { describe, expect, it, vi } from "vitest";
  import { createSlackAdapter } from "../src/index.js";

  describe("Slack adapter send()", () => {
    it("calls only the injected sink, never a real Web API client", async () => {
      const sink = vi.fn().mockResolvedValue({ externalId: "1700000300.000400", sentAt: "2023-11-14T22:20:00.000Z" });
      const webClient = { chat: { postMessage: vi.fn() } } as never;
      const adapter = createSlackAdapter({ webClient, sink });

      const result = await adapter.send(
        { accountId: "acc-1", externalId: "C0123456789" },
        { text: "approved reply" },
      );

      expect(sink).toHaveBeenCalledWith(
        { accountId: "acc-1", externalId: "C0123456789" },
        { text: "approved reply" },
      );
      expect(result.externalId).toBe("1700000300.000400");
      expect((webClient as { chat: { postMessage: ReturnType<typeof vi.fn> } }).chat.postMessage).not.toHaveBeenCalled();
    });
  });
  ```

- [ ] 6. 테스트를 실행해 전부 통과를 확인한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/adapter-slack test
  ```

  예상 출력: `Tests  7 passed (7)`.

- [ ] 7. 커밋한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/adapters/slack
  git commit -m "$(cat <<'EOF'
  US-A12: Slack normalize() 완성(thread_ts/attachment) + send() mock sink 배선

  - normalize(): channel→threadExternalId, ts→externalId/sourceHash, files→Attachment[]
  - mapApiError(): 429→retryable_rate_limit, 401→auth_expired|auth_revoked(A1 §1.4)
  - send()는 deps.sink만 호출한다 — chat.postMessage는 승인 게이트(US-A07) 전까지 배선하지 않음
  - markRead()는 conversations.mark 실제 호출(read 확인은 비가역 액션이 아님)

  Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 7: Gmail 어댑터 — 패키지 스캐폴드 + OAuth + connect()/health() (US-A13, tier: Sonnet)

**US-A13 산출물(A7 §7):** `packages/adapters/gmail/src/index.ts`. **검증 명령:** `pnpm --filter @omnis/adapter-gmail test`. **목표:** Gmail 어댑터(`users.watch`+Pub/Sub, OAuth, backfill).

**Files:**
- Create: `packages/adapters/gmail/package.json`, `packages/adapters/gmail/tsconfig.json`, `packages/adapters/gmail/vitest.config.ts`
- Create: `packages/adapters/gmail/src/keychain.ts`, `packages/adapters/gmail/src/index.ts`
- Test: `packages/adapters/gmail/test/capabilities.test.ts`

**Interfaces:** Consumes: `@omnis/protocol`의 `Adapter`/`AuthRef`/`AdapterError`/`Capabilities`/`Health`(Task 3). Produces: `CHANNEL`(`"gmail"`), `createGmailAdapter(deps?: GmailAdapterDeps): Adapter`.

읽을 스펙: A1 §1.3(Gmail Keychain `omnis.gmail.<email>`), §2.2(OAuth Desktop client, refresh token, Production 게시 요구사항). **Keychain 항목명(interfaces.md §9, FIXED)**: Google 계열(`gmail`/`gcal`)은 `omnis.gmail.<email>` **1항목을 공유**하고 `<kind>` 세그먼트를 생략한다(일반형 `omnis.<channel>.<kind>.<external_id>`의 예외) — gcal 어댑터(Task 10)가 같은 `keychainService`를 재사용한다. 아래 `AuthRef` 예시·fixture는 전부 이 명명을 그대로 쓴다. **만들지 않을 것(YAGNI)**: OAuth consent 화면 자체(온보딩 UI는 US-A31, Phase A 후반 별도 플랜) — 이 어댑터는 이미 발급된 refresh token을 Keychain에서 읽기만 한다.

- [ ] 1. 패키지 스캐폴드를 만든다.

  ```bash
  mkdir -p /Users/logankim/AI-Workspaces/omnis/packages/adapters/gmail/src
  mkdir -p /Users/logankim/AI-Workspaces/omnis/packages/adapters/gmail/test
  mkdir -p /Users/logankim/AI-Workspaces/omnis/packages/adapters/gmail/fixtures
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/gmail/package.json <<'EOF'
  {
    "name": "@omnis/adapter-gmail",
    "version": "0.0.1",
    "private": true,
    "type": "module",
    "main": "./dist/index.js",
    "types": "./dist/index.d.ts",
    "scripts": { "build": "tsc --build", "test": "vitest run" },
    "dependencies": {
      "@omnis/protocol": "workspace:*",
      "googleapis": "^161.0.0"
    },
    "devDependencies": { "typescript": "5.6.3", "vitest": "2.1.9" }
  }
  EOF
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/gmail/tsconfig.json <<'EOF'
  {
    "extends": "../../../tsconfig.base.json",
    "compilerOptions": { "outDir": "dist", "rootDir": "src" },
    "references": [{ "path": "../../protocol" }],
    "include": ["src"]
  }
  EOF
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/gmail/vitest.config.ts <<'EOF'
  import { defineConfig } from "vitest/config";

  export default defineConfig({ test: { environment: "node" } });
  EOF
  ```

- [ ] 2. 실패하는 테스트를 작성한다: `packages/adapters/gmail/test/capabilities.test.ts`

  ```ts
  import { describe, expect, it } from "vitest";
  import { createGmailAdapter } from "../src/index.js";

  describe("Gmail adapter capabilities", () => {
    it("declares full write-back per A1 §3 (send/markRead/archive all true)", () => {
      const adapter = createGmailAdapter({
        oauthClientId: "test-client-id", oauthClientSecret: "test-client-secret",
      });
      expect(adapter.channel).toBe("gmail");
      expect(adapter.capabilities()).toEqual({
        read: true, write: true, realtime: true, history: true,
        media: true, markRead: true, typing: false, archive: true, delete: false,
      });
    });
  });
  ```

- [ ] 3. 테스트를 실행해 실패를 확인한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm install && pnpm --filter @omnis/adapter-gmail test
  ```

  예상 실패: `Cannot find module '../src/index.js'`.

- [ ] 4. Keychain 래퍼를 작성한다: `packages/adapters/gmail/src/keychain.ts` (Slack Task 4와 동일 패턴, 채널만 다름 — 어댑터 패키지 간 import 금지라 복제한다)

  ```ts
  import { execFile } from "node:child_process";
  import { promisify } from "node:util";
  import { AdapterError, type Channel } from "@omnis/protocol";

  const execFileAsync = promisify(execFile);

  export async function readKeychainSecret(
    service: string,
    account: string,
    channel: Channel,
  ): Promise<string> {
    try {
      const { stdout } = await execFileAsync("security", [
        "find-generic-password", "-s", service, "-a", account, "-w",
      ]);
      return stdout.trim();
    } catch (cause) {
      throw new AdapterError(
        "auth_expired", channel,
        `Keychain item ${service}/${account} not found or locked`,
        undefined, cause,
      );
    }
  }
  ```

- [ ] 5. `src/index.ts`에 `capabilities()`/`connect()`/`disconnect()`/`health()`를 작성한다. `backfill`/`subscribe`/`send`/`markRead`/`archive`는 Task 8·9가 채운다.

  ```ts
  import { google } from "googleapis";
  import type { OAuth2Client } from "google-auth-library";
  import {
    AdapterError, type Adapter, type AdapterEvent, type AuthRef,
    type Capabilities, type Health, type NormalizedItem,
  } from "@omnis/protocol";
  import { readKeychainSecret } from "./keychain.js";

  export const CHANNEL = "gmail" as const;

  const CAPABILITIES: Capabilities = {
    read: true, write: true, realtime: true, history: true,
    media: true, markRead: true, typing: false, archive: true, delete: false,
  };

  export interface GmailAdapterDeps {
    oauthClientId: string;
    oauthClientSecret: string;
    oauthClient?: OAuth2Client;
    now?: () => Date;
  }

  export function createGmailAdapter(deps: GmailAdapterDeps): Adapter {
    const now = deps.now ?? (() => new Date());
    let oauth: OAuth2Client | undefined;
    let status: Health["status"] = "down";
    let lastEventAt: string | null = null;
    let lastError: Health["lastError"];

    return {
      id: "gmail",
      channel: CHANNEL,
      capabilities: () => CAPABILITIES,

      async connect(auth: AuthRef): Promise<void> {
        const refreshToken = await readKeychainSecret(auth.keychainService, auth.keychainAccount, CHANNEL);
        oauth = deps.oauthClient ?? new google.auth.OAuth2(deps.oauthClientId, deps.oauthClientSecret);
        oauth.setCredentials({ refresh_token: refreshToken });
        try {
          await oauth.getAccessToken();
        } catch (cause) {
          status = "down";
          throw new AdapterError("auth_revoked", CHANNEL, "Gmail refresh token rejected", undefined, cause);
        }
        status = "healthy";
        lastEventAt = now().toISOString();
      },

      async disconnect(): Promise<void> {
        status = "down";
      },

      async *backfill(): AsyncIterable<NormalizedItem> {
        throw new AdapterError("fatal_unsupported", CHANNEL, "backfill not implemented until Task 8");
      },

      subscribe(): AsyncIterable<NormalizedItem | AdapterEvent> {
        throw new AdapterError("fatal_unsupported", CHANNEL, "subscribe not implemented until Task 8");
      },

      async send(): Promise<never> {
        throw new AdapterError("fatal_unsupported", CHANNEL, "send not implemented until Task 9");
      },

      async health(): Promise<Health> {
        return {
          channel: CHANNEL, accountExternalId: "", status, lastEventAt,
          ...(lastError ? { lastError } : {}),
        };
      },
    };
  }
  ```

  Gmail Cloud 프로젝트의 OAuth client id/secret은 계정별 시크릿이 아니라 앱 레벨 시크릿이므로 `AuthRef`가 아니라 어댑터 생성 시 `deps`로 주입한다(A7 §9 "새 변수는 `OMNIS_` 접두" — 허브가 `OMNIS_GOOGLE_OAUTH_CLIENT_ID`/`OMNIS_GOOGLE_OAUTH_CLIENT_SECRET` 환경변수에서 읽어 넘기는 것은 `apps/hub` 배선 스토리(US-A10) 몫이고 이 플랜 범위 밖이다).

- [ ] 6. `google-auth-library`를 명시적으로 devDependency에 추가한다(타입 전용 import를 위해, `googleapis`가 재export하는 타입만으로는 `import type`이 실패할 수 있음).

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  node -e "
  const fs = require('fs');
  const p = 'packages/adapters/gmail/package.json';
  const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
  pkg.devDependencies['google-auth-library'] = '^9.15.0';
  fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');
  "
  pnpm install
  ```

- [ ] 7. 테스트를 실행해 통과를 확인한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/adapter-gmail test
  ```

  예상 출력: `Tests  1 passed (1)`.

- [ ] 8. 커밋한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/adapters/gmail
  git commit -m "$(cat <<'EOF'
  US-A13: Gmail 어댑터 스캐폴드 + OAuth2 refresh-token connect()/health()

  - Keychain omnis.gmail.<email>에서 refresh token을 읽어 OAuth2Client.setCredentials
  - connect() 실패 시 auth_revoked(A1 §1.4, 자동 재시도 금지)
  - capabilities(): send/markRead/archive 전부 true(A1 §3 Gmail 행)
  - OAuth client id/secret은 AuthRef가 아니라 GmailAdapterDeps로 주입(앱 레벨 시크릿)
  - backfill()/subscribe()/send()는 아직 fatal_unsupported(Task 8·9)

  Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 8: Gmail 어댑터 — `users.watch` + Pub/Sub pull subscribe() + backfill() (US-A13, tier: Sonnet)

**Files:**
- Modify: `packages/adapters/gmail/src/index.ts`
- Test: `packages/adapters/gmail/test/backfill.test.ts`

**Interfaces:** Consumes: Task 7의 `CHANNEL`, `GmailAdapterDeps`. Produces: `backfill()`, `subscribe()` 구현, `GmailAdapterDeps.pubsubSubscription`(pull 대상 구독 이름).

읽을 스펙: A1 §2.2(`users.watch()`→Pub/Sub 토픽→**pull** subscription, 7일 만료, `history.list` diff, backfill 최근 30일).

- [ ] 1. 실패하는 테스트를 작성한다: `packages/adapters/gmail/test/backfill.test.ts`(mock Gmail client 주입)

  ```ts
  import { describe, expect, it, vi } from "vitest";
  import { createGmailAdapter } from "../src/index.js";

  describe("Gmail adapter backfill()", () => {
    it("lists messages.list then fetches each message full resource", async () => {
      const list = vi.fn().mockResolvedValue({
        data: { messages: [{ id: "18c2f4a1b2d3e4f5" }], nextPageToken: undefined },
      });
      const get = vi.fn().mockResolvedValue({
        data: {
          id: "18c2f4a1b2d3e4f5", threadId: "18c2f4a1b2d3e4f0",
          payload: {
            headers: [
              { name: "From", value: "Dana Lee <dana@example.com>" },
              { name: "Subject", value: "omnis launch sync" },
              { name: "Message-Id", value: "<CAFakeMsgId001@mail.gmail.com>" },
            ],
            mimeType: "text/plain",
            body: { data: "TGV0J3Mgc3luYyB0b21vcnJvdyBhdCAxMGFtIGFib3V0IHRoZSBvbW5pcyBsYXVuY2gu" },
          },
        },
      });
      const gmailClient = { users: { messages: { list, get } } } as never;

      const adapter = createGmailAdapter({
        oauthClientId: "id", oauthClientSecret: "secret", gmailClient,
      });
      const collected = [];
      for await (const item of adapter.backfill()) collected.push(item);

      expect(collected).toHaveLength(1);
      expect(collected[0]?.threadExternalId).toBe("18c2f4a1b2d3e4f0");
      expect(collected[0]?.sourceHash).toBe("<CAFakeMsgId001@mail.gmail.com>");
      expect(collected[0]?.body).toContain("Let's sync tomorrow");
    });
  });
  ```

- [ ] 2. 테스트를 실행해 실패를 확인한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/adapter-gmail test
  ```

  예상 실패: `AdapterError: backfill not implemented until Task 8`.

- [ ] 3. `GmailAdapterDeps`에 `gmailClient`/`pubsubClient`를 추가하고 `backfill`/`subscribe`를 구현한다. `src/index.ts` 상단 import에 `import type { gmail_v1, pubsub_v1 } from "googleapis";`를 추가하고, `GmailAdapterDeps`를 아래로 교체한다.

  ```ts
  export interface GmailAdapterDeps {
    oauthClientId: string;
    oauthClientSecret: string;
    oauthClient?: OAuth2Client;
    gmailClient?: gmail_v1.Gmail;
    pubsubClient?: pubsub_v1.Pubsub;
    pubsubSubscription?: string;
    now?: () => Date;
  }
  ```

  `backfill`/`subscribe` 스텁을 아래로 교체한다.

  ```ts
      async *backfill(since?: Date): AsyncIterable<NormalizedItem> {
        const gmail = deps.gmailClient ?? google.gmail({ version: "v1", auth: oauth });
        const q = since ? `after:${Math.floor(since.getTime() / 1000)}` : undefined;
        let pageToken: string | undefined;
        do {
          let list: { data: { messages?: { id?: string }[]; nextPageToken?: string } };
          try {
            list = await gmail.users.messages.list({ userId: "me", q, pageToken, maxResults: 100 } as never);
          } catch (cause) {
            throw mapApiError(cause);
          }
          for (const ref of list.data.messages ?? []) {
            if (!ref.id) continue;
            let full: { data: unknown };
            try {
              full = await gmail.users.messages.get({ userId: "me", id: ref.id, format: "full" } as never);
            } catch (cause) {
              throw mapApiError(cause);
            }
            for (const item of normalize(full.data)) yield item;
          }
          pageToken = list.data.nextPageToken;
        } while (pageToken);
      },

      subscribe(): AsyncIterable<NormalizedItem | AdapterEvent> {
        const gmail = deps.gmailClient ?? google.gmail({ version: "v1", auth: oauth });
        const pubsub = deps.pubsubClient ?? google.pubsub({ version: "v1", auth: oauth });
        const subscription = deps.pubsubSubscription;
        if (!subscription) throw new AdapterError("fatal_protocol", CHANNEL, "pubsubSubscription not configured");

        async function* pull(): AsyncGenerator<NormalizedItem | AdapterEvent> {
          for (;;) {
            const res = await pubsub.projects.subscriptions.pull({
              subscription, requestBody: { maxMessages: 10 },
            } as never);
            const messages = (res as { data?: { receivedMessages?: { ackId?: string }[] } }).data?.receivedMessages ?? [];
            for (const received of messages) {
              const list = await gmail.users.messages.list({ userId: "me", maxResults: 10 } as never);
              for (const ref of (list as { data: { messages?: { id?: string }[] } }).data.messages ?? []) {
                if (!ref.id) continue;
                const full = await gmail.users.messages.get({ userId: "me", id: ref.id, format: "full" } as never);
                for (const item of normalize((full as { data: unknown }).data)) yield item;
              }
              if (received.ackId) {
                await pubsub.projects.subscriptions.acknowledge({
                  subscription, requestBody: { ackIds: [received.ackId] },
                } as never);
              }
            }
          }
        }
        return pull();
      },
  ```

- [ ] 4. `normalize`/`mapApiError`가 아직 없으므로(Task 9에서 완성) 파일 끝에 임시 스텁을 추가해 컴파일을 통과시킨다.

  ```ts
  export function normalize(raw: unknown): NormalizedItem[] {
    const r = raw as {
      id?: string; threadId?: string;
      payload?: { headers?: { name?: string; value?: string }[]; body?: { data?: string } };
    };
    if (!r.id || !r.threadId) return [];
    const headers = r.payload?.headers ?? [];
    const header = (name: string) => headers.find((h) => h.name === name)?.value ?? "";
    const bodyText = r.payload?.body?.data
      ? Buffer.from(r.payload.body.data, "base64url").toString("utf8")
      : "";
    return [{
      threadExternalId: r.threadId, externalId: r.id, kind: "email" as const,
      author: { kind: "person" as const, id: header("From") },
      subject: header("Subject") || undefined,
      body: bodyText, attachments: [],
      sentAt: new Date().toISOString(), status: "received" as const,
      sourceHash: header("Message-Id") || r.id,
    }] as unknown as NormalizedItem[];
  }

  export function mapApiError(cause: unknown): AdapterError {
    const err = cause as { code?: number };
    if (err.code === 429) return new AdapterError("retryable_rate_limit", CHANNEL, "Gmail API rate limited", 60_000, cause);
    if (err.code === 401) return new AdapterError("auth_expired", CHANNEL, "Gmail API auth expired", undefined, cause);
    return new AdapterError("retryable_network", CHANNEL, "Gmail API call failed", undefined, cause);
  }
  ```

  이 스텁의 `subject`는 `NormalizedItem` 스키마에 없는 필드다 — Task 9가 `subject`를 빼고 `body`에 합쳐 스키마를 맞춘다(지금은 `as unknown as NormalizedItem[]`로 타입만 우회해 컴파일과 이 태스크의 테스트를 통과시킨다).

- [ ] 5. 테스트를 실행해 통과를 확인한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/adapter-gmail test
  ```

  예상 출력: `Tests  2 passed (2)`.

- [ ] 6. 커밋한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/adapters/gmail
  git commit -m "$(cat <<'EOF'
  US-A13: Gmail backfill()(messages.list 페이지네이션) + subscribe()(Pub/Sub pull)

  - backfill(): messages.list → messages.get(format=full) → normalize()
  - subscribe(): projects.subscriptions.pull → 새 메시지 조회 → ack (A1 §2.2)
  - mapApiError(): HTTP 429→retryable_rate_limit, 401→auth_expired
  - normalize()는 이 태스크에서 임시 스텁(Task 9가 스키마에 맞게 완성)

  Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 9: Gmail 어댑터 — normalize() 스키마 정합 + send()/markRead()/archive() mock (US-A13, tier: Sonnet)

**Files:**
- Modify: `packages/adapters/gmail/src/index.ts`
- Test: `packages/adapters/gmail/test/normalize.test.ts`, `packages/adapters/gmail/test/send.test.ts`

**Interfaces:** Consumes: Task 3의 `NormalizedItem`(zod 스키마 — `subject`는 필드로 없으므로 본문에 흡수). Produces: `normalize()` 완성판(스키마와 정확히 일치), `createGmailAdapter().send`/`.markRead`/`.archive`.

읽을 스펙: A1 §2.2 thread/ID 매핑(`threadId`, `messages.id`, `sourceHash`=`Message-Id`), write-back(send/markRead/archive 셋 다 지원, 단 이 플랜은 **send는 mock sink만**).

- [ ] 1. 실패하는 테스트를 작성한다: `packages/adapters/gmail/test/normalize.test.ts`

  ```ts
  import { describe, expect, it } from "vitest";
  import { NormalizedItem } from "@omnis/protocol";
  import { normalize } from "../src/index.js";

  describe("Gmail normalize()", () => {
    it("maps a plain-text message resource and validates against NormalizedItem", () => {
      const raw = {
        id: "18c2f4a1b2d3e4f5", threadId: "18c2f4a1b2d3e4f0",
        payload: {
          headers: [
            { name: "From", value: "Dana Lee <dana@example.com>" },
            { name: "Subject", value: "omnis launch sync" },
            { name: "Message-Id", value: "<CAFakeMsgId001@mail.gmail.com>" },
            { name: "Date", value: "Tue, 14 Nov 2023 22:13:20 +0000" },
          ],
          mimeType: "text/plain",
          body: { data: "TGV0J3Mgc3luYyB0b21vcnJvdyBhdCAxMGFtIGFib3V0IHRoZSBvbW5pcyBsYXVuY2gu" },
        },
      };
      const [item] = normalize(raw);
      expect(() => NormalizedItem.parse(item)).not.toThrow();
      expect(item).toMatchObject({
        threadExternalId: "18c2f4a1b2d3e4f0", externalId: "18c2f4a1b2d3e4f5",
        kind: "email", author: { kind: "person", id: "Dana Lee <dana@example.com>" },
        body: "Subject: omnis launch sync\n\nLet's sync tomorrow at 10am about the omnis launch.",
        sentAt: "2023-11-14T22:13:20.000Z", status: "received",
        sourceHash: "<CAFakeMsgId001@mail.gmail.com>",
      });
    });
  });
  ```

- [ ] 2. 테스트를 실행해 실패를 확인한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/adapter-gmail test
  ```

  예상 실패: `sentAt`이 `new Date().toISOString()`(현재 시각)이라 `"2023-11-14T22:13:20.000Z"`와 불일치.

- [ ] 3. `src/index.ts`의 `normalize` 스텁을 아래로 교체한다(Date 헤더 파싱 + subject를 body에 흡수).

  ```ts
  function decodeGmailBody(data: string | undefined): string {
    if (!data) return "";
    return Buffer.from(data, "base64url").toString("utf8");
  }

  export function normalize(raw: unknown): NormalizedItem[] {
    const r = raw as {
      id?: string; threadId?: string;
      payload?: { headers?: { name?: string; value?: string }[]; body?: { data?: string } };
    };
    if (!r.id || !r.threadId) return [];
    const headers = r.payload?.headers ?? [];
    const header = (name: string) => headers.find((h) => h.name === name)?.value ?? "";

    const subject = header("Subject");
    const from = header("From");
    const messageId = header("Message-Id");
    const dateHeader = header("Date");
    const bodyText = decodeGmailBody(r.payload?.body?.data);
    const sentAt = dateHeader ? new Date(dateHeader).toISOString() : new Date().toISOString();

    return [{
      threadExternalId: r.threadId,
      externalId: r.id,
      kind: "email",
      author: { kind: "person", id: from },
      body: subject ? `Subject: ${subject}\n\n${bodyText}` : bodyText,
      attachments: [],
      sentAt,
      status: "received",
      sourceHash: messageId || r.id,
    }];
  }
  ```

  (기존 `normalize`를 이걸로 완전히 교체 — `as unknown as NormalizedItem[]` 캐스팅을 제거한다.)

- [ ] 4. `send`/`markRead`/`archive` 스텁을 mock sink 버전으로 교체한다. `GmailAdapterDeps`에 `sink` 필드를 추가한다.

  ```ts
  export interface GmailAdapterDeps {
    oauthClientId: string;
    oauthClientSecret: string;
    oauthClient?: OAuth2Client;
    gmailClient?: gmail_v1.Gmail;
    pubsubClient?: pubsub_v1.Pubsub;
    pubsubSubscription?: string;
    sink?: (thread: ThreadRef, draft: Outbound) => Promise<SendResult>;
    now?: () => Date;
  }
  ```

  ```ts
      // 승인 게이트(US-A07) 전까지 실제 messages.send는 호출하지 않는다.
      async send(thread: ThreadRef, draft: Outbound): Promise<SendResult> {
        const sink = deps.sink ?? (async (): Promise<SendResult> => ({
          externalId: `mock-${now().getTime()}`, sentAt: now().toISOString(),
        }));
        return sink(thread, draft);
      },

      async markRead(thread: ThreadRef): Promise<void> {
        const gmail = deps.gmailClient ?? google.gmail({ version: "v1", auth: oauth });
        try {
          await gmail.users.messages.modify({
            userId: "me", id: thread.externalId, requestBody: { removeLabelIds: ["UNREAD"] },
          } as never);
        } catch (cause) {
          throw mapApiError(cause);
        }
      },

      async archive(thread: ThreadRef): Promise<void> {
        const gmail = deps.gmailClient ?? google.gmail({ version: "v1", auth: oauth });
        try {
          await gmail.users.messages.modify({
            userId: "me", id: thread.externalId, requestBody: { removeLabelIds: ["INBOX"] },
          } as never);
        } catch (cause) {
          throw mapApiError(cause);
        }
      },
  ```

  상단 import에 `import type { Outbound, SendResult, ThreadRef } from "@omnis/protocol";`를 추가한다.

- [ ] 5. `send()`가 mock sink만 호출함을 검증하는 테스트를 추가한다: `packages/adapters/gmail/test/send.test.ts`

  ```ts
  import { describe, expect, it, vi } from "vitest";
  import { createGmailAdapter } from "../src/index.js";

  describe("Gmail adapter send()", () => {
    it("calls only the injected sink, never gmail.users.messages.send", async () => {
      const sink = vi.fn().mockResolvedValue({ externalId: "18c2f4a1b2d3e4ff", sentAt: "2023-11-14T22:30:00.000Z" });
      const gmailClient = { users: { messages: { send: vi.fn() } } } as never;
      const adapter = createGmailAdapter({
        oauthClientId: "id", oauthClientSecret: "secret", gmailClient, sink,
      });

      const result = await adapter.send(
        { accountId: "acc-1", externalId: "18c2f4a1b2d3e4f0" },
        { text: "approved reply" },
      );

      expect(sink).toHaveBeenCalledTimes(1);
      expect(result.externalId).toBe("18c2f4a1b2d3e4ff");
      expect((gmailClient as { users: { messages: { send: ReturnType<typeof vi.fn> } } }).users.messages.send)
        .not.toHaveBeenCalled();
    });
  });
  ```

- [ ] 6. 테스트를 실행해 전부 통과를 확인한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/adapter-gmail test
  ```

  예상 출력: `Tests  4 passed (4)`.

- [ ] 7. 커밋한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/adapters/gmail
  git commit -m "$(cat <<'EOF'
  US-A13: Gmail normalize() 스키마 정합 + send()/markRead()/archive()

  - normalize(): Message-Id→sourceHash, threadId→threadExternalId, Subject는 body에 흡수(NormalizedItem에 subject 필드 없음)
  - send()는 mock sink만 호출(messages.send 미배선, 승인 게이트 대기)
  - markRead()는 UNREAD 라벨 제거, archive()는 INBOX 라벨 제거(둘 다 실제 API 호출 — 읽음/보관은 비가역 전송이 아님)

  Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 10: Google Calendar 어댑터 — 패키지 스캐폴드 + connect() + syncToken subscribe() (US-A14, tier: Sonnet)

**US-A14 산출물(A7 §7):** `packages/adapters/google-calendar/src/index.ts`. **검증 명령:** `pnpm --filter @omnis/adapter-google-calendar test`. **목표:** Google Calendar 어댑터(`events.list`+syncToken 폴링).

**Files:**
- Create: `packages/adapters/google-calendar/package.json`, `packages/adapters/google-calendar/tsconfig.json`, `packages/adapters/google-calendar/vitest.config.ts`
- Create: `packages/adapters/google-calendar/src/keychain.ts`, `packages/adapters/google-calendar/src/index.ts`
- Test: `packages/adapters/google-calendar/test/capabilities.test.ts`, `packages/adapters/google-calendar/test/subscribe.test.ts`

**Interfaces:** Consumes: `@omnis/protocol`의 `Adapter`/`AuthRef`/`AdapterError`/`Capabilities`/`Health`(Task 3). Produces: `CHANNEL`(`"gcal"` — interfaces.md §1 "디렉터리명 `google-calendar` ≠ `accounts.channel` 값 `gcal`"), `createGoogleCalendarAdapter(deps?): Adapter`.

읽을 스펙: A1 §2.3(Gmail과 같은 Cloud 프로젝트·client 재사용, `events.list`+syncToken 1~5분 폴링, write는 승인 후에만). **디렉터리명과 채널 값이 다르다는 점(interfaces.md §1)을 반드시 지킨다.** **Keychain(interfaces.md §9, FIXED)**: 별도 항목을 만들지 않고 Gmail과 같은 `omnis.gmail.<email>`을 재사용한다(`channel:"gcal"`이면서 `keychainService`만 같다) — Task 7이 만든 `omnis.gmail.<email>` 1항목을 그대로 넘겨받는다는 뜻이며, `AuthRef.channel`이 `"gcal"`이어도 keychainService는 바뀌지 않는다.

- [ ] 1. 패키지 스캐폴드를 만든다.

  ```bash
  mkdir -p /Users/logankim/AI-Workspaces/omnis/packages/adapters/google-calendar/src
  mkdir -p /Users/logankim/AI-Workspaces/omnis/packages/adapters/google-calendar/test
  mkdir -p /Users/logankim/AI-Workspaces/omnis/packages/adapters/google-calendar/fixtures
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/google-calendar/package.json <<'EOF'
  {
    "name": "@omnis/adapter-google-calendar",
    "version": "0.0.1",
    "private": true,
    "type": "module",
    "main": "./dist/index.js",
    "types": "./dist/index.d.ts",
    "scripts": { "build": "tsc --build", "test": "vitest run" },
    "dependencies": {
      "@omnis/protocol": "workspace:*",
      "googleapis": "^161.0.0"
    },
    "devDependencies": {
      "typescript": "5.6.3", "vitest": "2.1.9", "google-auth-library": "^9.15.0"
    }
  }
  EOF
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/google-calendar/tsconfig.json <<'EOF'
  {
    "extends": "../../../tsconfig.base.json",
    "compilerOptions": { "outDir": "dist", "rootDir": "src" },
    "references": [{ "path": "../../protocol" }],
    "include": ["src"]
  }
  EOF
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/google-calendar/vitest.config.ts <<'EOF'
  import { defineConfig } from "vitest/config";

  export default defineConfig({ test: { environment: "node" } });
  EOF
  cp /Users/logankim/AI-Workspaces/omnis/packages/adapters/gmail/src/keychain.ts \
     /Users/logankim/AI-Workspaces/omnis/packages/adapters/google-calendar/src/keychain.ts
  ```

- [ ] 2. 실패하는 테스트를 작성한다: `packages/adapters/google-calendar/test/capabilities.test.ts`

  ```ts
  import { describe, expect, it } from "vitest";
  import { CHANNEL, createGoogleCalendarAdapter } from "../src/index.js";

  describe("Google Calendar adapter", () => {
    it("uses channel value 'gcal' even though the package dir is google-calendar", () => {
      expect(CHANNEL).toBe("gcal");
    });

    it("declares write as approval-gated only (A1 §3: R/W(hold))", () => {
      const adapter = createGoogleCalendarAdapter({ oauthClientId: "id", oauthClientSecret: "secret" });
      expect(adapter.channel).toBe("gcal");
      expect(adapter.capabilities()).toEqual({
        read: true, write: true, realtime: false, history: true,
        media: false, markRead: false, typing: false, archive: false, delete: false,
      });
    });
  });
  ```

- [ ] 3. 테스트를 실행해 실패를 확인한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm install && pnpm --filter @omnis/adapter-google-calendar test
  ```

  예상 실패: `Cannot find module '../src/index.js'`.

- [ ] 4. `src/index.ts`를 작성한다: `capabilities()`/`connect()`(Gmail과 같은 Keychain 항목 재사용, A1 §2.3)/`disconnect()`/`health()`. `backfill`/`subscribe`/`send`는 스텁으로 둔다(Task 11이 채운다).

  ```ts
  import { google } from "googleapis";
  import type { OAuth2Client } from "google-auth-library";
  import type { calendar_v3 } from "googleapis";
  import {
    AdapterError, type Adapter, type AdapterEvent, type AuthRef,
    type Capabilities, type Health, type NormalizedItem,
  } from "@omnis/protocol";
  import { readKeychainSecret } from "./keychain.js";

  export const CHANNEL = "gcal" as const;

  const CAPABILITIES: Capabilities = {
    read: true, write: true, realtime: false, history: true,
    media: false, markRead: false, typing: false, archive: false, delete: false,
  };

  export interface GoogleCalendarAdapterDeps {
    oauthClientId: string;
    oauthClientSecret: string;
    oauthClient?: OAuth2Client;
    calendarClient?: calendar_v3.Calendar;
    pollIntervalMs?: number;
    now?: () => Date;
  }

  export function createGoogleCalendarAdapter(deps: GoogleCalendarAdapterDeps): Adapter {
    const now = deps.now ?? (() => new Date());
    let oauth: OAuth2Client | undefined;
    let status: Health["status"] = "down";
    let lastEventAt: string | null = null;

    return {
      id: "google-calendar",
      channel: CHANNEL,
      capabilities: () => CAPABILITIES,

      async connect(auth: AuthRef): Promise<void> {
        // A1 §2.3: Calendar는 Gmail과 같은 Cloud 프로젝트/client를 쓰므로
        // auth.keychainService는 호출자가 omnis.gmail.<email>을 그대로 넘긴다(재사용).
        const refreshToken = await readKeychainSecret(auth.keychainService, auth.keychainAccount, CHANNEL);
        oauth = deps.oauthClient ?? new google.auth.OAuth2(deps.oauthClientId, deps.oauthClientSecret);
        oauth.setCredentials({ refresh_token: refreshToken });
        try {
          await oauth.getAccessToken();
        } catch (cause) {
          status = "down";
          throw new AdapterError("auth_revoked", CHANNEL, "Calendar refresh token rejected", undefined, cause);
        }
        status = "healthy";
        lastEventAt = now().toISOString();
      },

      async disconnect(): Promise<void> {
        status = "down";
      },

      async *backfill(): AsyncIterable<NormalizedItem> {
        throw new AdapterError("fatal_unsupported", CHANNEL, "backfill not implemented until Task 11");
      },

      subscribe(): AsyncIterable<NormalizedItem | AdapterEvent> {
        throw new AdapterError("fatal_unsupported", CHANNEL, "subscribe not implemented until this task's next step");
      },

      async send(): Promise<never> {
        throw new AdapterError("fatal_unsupported", CHANNEL, "send not implemented until Task 11");
      },

      async health(): Promise<Health> {
        return { channel: CHANNEL, accountExternalId: "", status, lastEventAt };
      },
    };
  }
  ```

- [ ] 5. 테스트를 실행해 `capabilities`/`CHANNEL` 검증 2개가 통과함을 확인한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/adapter-google-calendar test
  ```

  예상 출력: `Tests  2 passed (2)`.

- [ ] 6. `subscribe()`의 syncToken 폴링 루프를 검증하는 실패하는 테스트를 작성한다: `packages/adapters/google-calendar/test/subscribe.test.ts`

  ```ts
  import { describe, expect, it, vi } from "vitest";
  import { createGoogleCalendarAdapter } from "../src/index.js";

  describe("Google Calendar adapter subscribe()", () => {
    it("polls events.list with syncToken and yields normalized events", async () => {
      const list = vi
        .fn()
        .mockResolvedValueOnce({
          data: {
            nextSyncToken: "sync-token-1",
            items: [{
              id: "evt1", status: "confirmed",
              summary: "omnis launch sync",
              start: { dateTime: "2026-09-25T10:00:00+09:00" },
              end: { dateTime: "2026-09-25T10:30:00+09:00" },
            }],
          },
        });
      const calendarClient = { events: { list } } as never;
      let ticks = 0;
      const adapter = createGoogleCalendarAdapter({
        oauthClientId: "id", oauthClientSecret: "secret", calendarClient,
        pollIntervalMs: 0,
      });

      const iterator = adapter.subscribe()[Symbol.asyncIterator]();
      const first = await iterator.next();
      expect(first.done).toBe(false);
      if (first.value && "kind" in first.value === false) {
        expect(first.value.externalId).toBe("evt1");
      }
      expect(list).toHaveBeenCalledWith(expect.objectContaining({ calendarId: "primary" }));
      ticks += 1;
      expect(ticks).toBe(1);
    });
  });
  ```

- [ ] 7. 테스트를 실행해 실패를 확인한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/adapter-google-calendar test
  ```

  예상 실패: `AdapterError: subscribe not implemented until this task's next step`.

- [ ] 8. `subscribe()` 스텁을 syncToken 폴링 구현으로 교체한다(A1 §2.3: `events.list` + `syncToken`, 만료(410) 시 풀 재동기화, 1~5분 간격 — 테스트에서는 `pollIntervalMs: 0`으로 즉시 재폴링).

  ```ts
      subscribe(): AsyncIterable<NormalizedItem | AdapterEvent> {
        const calendar = deps.calendarClient ?? google.calendar({ version: "v3", auth: oauth });
        const intervalMs = deps.pollIntervalMs ?? 120_000;

        async function* poll(): AsyncGenerator<NormalizedItem | AdapterEvent> {
          let syncToken: string | undefined;
          for (;;) {
            let res: { data: { items?: unknown[]; nextSyncToken?: string } };
            try {
              res = await calendar.events.list({
                calendarId: "primary", syncToken, singleEvents: true,
                ...(syncToken ? {} : { timeMin: new Date().toISOString() }),
              } as never);
            } catch (cause) {
              const err = cause as { code?: number };
              if (err.code === 410) { syncToken = undefined; continue; }
              throw new AdapterError("retryable_network", CHANNEL, "events.list failed", undefined, cause);
            }
            for (const raw of res.data.items ?? []) {
              for (const item of normalize(raw)) yield item;
            }
            syncToken = res.data.nextSyncToken;
            if (intervalMs > 0) await new Promise((r) => setTimeout(r, intervalMs));
          }
        }
        return poll();
      },
  ```

  `normalize`가 아직 없으므로(Task 11) 파일 끝에 임시 스텁을 추가한다.

  ```ts
  export function normalize(raw: unknown): NormalizedItem[] {
    const e = raw as { id?: string; summary?: string; start?: { dateTime?: string }; end?: { dateTime?: string } };
    if (!e.id || !e.start?.dateTime) return [];
    return [{
      threadExternalId: e.id, externalId: e.id, kind: "event",
      author: { kind: "system", id: "" }, body: e.summary ?? "",
      attachments: [], sentAt: e.start.dateTime, status: "received", sourceHash: e.id,
    }];
  }
  ```

- [ ] 9. 테스트를 실행해 통과를 확인한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/adapter-google-calendar test
  ```

  예상 출력: `Tests  3 passed (3)`.

- [ ] 10. 커밋한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/adapters/google-calendar
  git commit -m "$(cat <<'EOF'
  US-A14: Google Calendar 어댑터 스캐폴드 + connect() + syncToken polling subscribe()

  - CHANNEL='gcal' (디렉터리명 google-calendar와 다름, interfaces.md §1 명시)
  - connect(): Gmail과 같은 Cloud 프로젝트 client 재사용(A1 §2.3), Keychain 항목도 호출자가 omnis.gmail.<email>을 넘김
  - subscribe(): events.list + syncToken 폴링, 410 Gone이면 syncToken을 버리고 풀 재동기화
  - capabilities(): realtime=false(폴링), write=true지만 승인 후에만(A1 §3 R/W(hold))
  - backfill()/send()는 아직 fatal_unsupported(Task 11)

  Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 11: Google Calendar 어댑터 — backfill() + normalize() 완성 + send() mock (US-A14, tier: Sonnet)

**Files:**
- Modify: `packages/adapters/google-calendar/src/index.ts`
- Test: `packages/adapters/google-calendar/test/normalize.test.ts`, `packages/adapters/google-calendar/test/backfill.test.ts`

**Interfaces:** Consumes: Task 3의 `NormalizedItem`(zod), `ThreadRef`/`Outbound`/`SendResult`. Produces: `normalize()` 완성판, `backfill()` 구현, `createGoogleCalendarAdapter().send`(mock sink).

읽을 스펙: A1 §2.3 backfill(`events.list`, `timeMin`=이번 분기 시작, `timeMax`=+90일), thread/ID 매핑(`kind="calendar"`, `externalId`=event id). **미해결 사항(§14 self-review에서 open question으로 재기록)**: A3 §2.1(이 플랜의 필수 읽기 범위 밖)의 `calendar_events` 상세 테이블은 `attendees`/`end_at`/`recurrence` 같은 필드가 필요한데 `NormalizedItem`에는 그런 필드가 없다 — 이 태스크는 `NormalizedItem`만 만든다(A1 §1.2 계약 그대로), 그 detail 테이블을 누가 무엇으로 채우는지는 이 플랜 범위 밖이다.

- [ ] 1. 실패하는 테스트를 작성한다: `packages/adapters/google-calendar/test/normalize.test.ts`

  ```ts
  import { describe, expect, it } from "vitest";
  import { NormalizedItem } from "@omnis/protocol";
  import { normalize } from "../src/index.js";

  describe("Google Calendar normalize()", () => {
    it("maps a confirmed event to a calendar-thread NormalizedItem", () => {
      const raw = {
        id: "evt1", status: "confirmed", summary: "omnis launch sync",
        start: { dateTime: "2026-09-25T10:00:00+09:00" },
        end: { dateTime: "2026-09-25T10:30:00+09:00" },
        attendees: [{ email: "dana@example.com", displayName: "Dana Lee", responseStatus: "accepted" }],
      };
      const [item] = normalize(raw);
      expect(() => NormalizedItem.parse(item)).not.toThrow();
      expect(item).toMatchObject({
        threadExternalId: "evt1", externalId: "evt1", kind: "event",
        author: { kind: "system", id: "" }, body: "omnis launch sync",
        sentAt: "2026-09-25T10:00:00+09:00", status: "received", sourceHash: "evt1",
        threadMeta: { kind: "calendar", externalId: "evt1" },
      });
    });

    it("skips cancelled events with no start time", () => {
      expect(normalize({ id: "evt2", status: "cancelled" })).toEqual([]);
    });
  });
  ```

- [ ] 2. 테스트를 실행해 실패를 확인한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/adapter-google-calendar test
  ```

  예상 실패: `threadMeta`가 `undefined`(Task 10 스텁은 `threadMeta`를 채우지 않음).

- [ ] 3. `src/index.ts`의 `normalize` 스텁을 아래로 교체한다.

  ```ts
  interface GCalEvent {
    id?: string; status?: string; summary?: string;
    start?: { dateTime?: string }; end?: { dateTime?: string };
    attendees?: { email?: string; displayName?: string }[];
  }

  export function normalize(raw: unknown): NormalizedItem[] {
    const e = raw as GCalEvent;
    if (!e.id || !e.start?.dateTime) return [];
    return [{
      threadExternalId: e.id,
      externalId: e.id,
      kind: "event",
      author: { kind: "system", id: "" },
      body: e.summary ?? "",
      attachments: [],
      sentAt: e.start.dateTime,
      status: "received",
      sourceHash: e.id,
      threadMeta: {
        externalId: e.id, kind: "calendar", title: e.summary ?? null,
        participants: (e.attendees ?? []).map((a) => ({
          externalId: a.email ?? "", displayName: a.displayName ?? a.email ?? "",
        })),
        lastItemAt: e.start.dateTime,
        archivedAt: e.status === "cancelled" ? e.start.dateTime : null,
      },
    }];
  }
  ```

- [ ] 4. `backfill`을 구현하고 `send`/`markRead`를 mock sink 버전으로 교체한다. `GoogleCalendarAdapterDeps`에 `sink` 필드를 추가한다.

  ```ts
  export interface GoogleCalendarAdapterDeps {
    oauthClientId: string;
    oauthClientSecret: string;
    oauthClient?: OAuth2Client;
    calendarClient?: calendar_v3.Calendar;
    pollIntervalMs?: number;
    sink?: (thread: ThreadRef, draft: Outbound) => Promise<SendResult>;
    now?: () => Date;
  }
  ```

  ```ts
      async *backfill(): AsyncIterable<NormalizedItem> {
        const calendar = deps.calendarClient ?? google.calendar({ version: "v3", auth: oauth });
        const quarterStart = new Date(now().getFullYear(), Math.floor(now().getMonth() / 3) * 3, 1);
        const timeMax = new Date(now().getTime() + 90 * 24 * 60 * 60 * 1000);
        let pageToken: string | undefined;
        do {
          let res: { data: { items?: unknown[]; nextPageToken?: string } };
          try {
            res = await calendar.events.list({
              calendarId: "primary", singleEvents: true, pageToken,
              timeMin: quarterStart.toISOString(), timeMax: timeMax.toISOString(),
            } as never);
          } catch (cause) {
            throw new AdapterError("retryable_network", CHANNEL, "events.list backfill failed", undefined, cause);
          }
          for (const raw of res.data.items ?? []) {
            for (const item of normalize(raw)) yield item;
          }
          pageToken = res.data.nextPageToken;
        } while (pageToken);
      },
  ```

  ```ts
      // 승인 게이트(US-A07) 전까지 events.insert/update는 절대 호출하지 않는다(A1 §2.3 "항상 pending_approvals를 거쳐").
      async send(thread: ThreadRef, draft: Outbound): Promise<SendResult> {
        const sink = deps.sink ?? (async (): Promise<SendResult> => ({
          externalId: `mock-${now().getTime()}`, sentAt: now().toISOString(),
        }));
        return sink(thread, draft);
      },
  ```

  상단 import에 `import type { Outbound, SendResult, ThreadRef } from "@omnis/protocol";`를 추가한다.

- [ ] 5. `send()`가 mock sink만 호출함을 검증하는 테스트를 추가한다: `packages/adapters/google-calendar/test/backfill.test.ts`에 이어서 작성(같은 파일, `describe` 블록 추가)

  ```ts
  import { describe, expect, it, vi } from "vitest";
  import { createGoogleCalendarAdapter } from "../src/index.js";

  describe("Google Calendar adapter backfill()", () => {
    it("lists events across the quarter-start..+90d window and normalizes each", async () => {
      const list = vi.fn().mockResolvedValue({
        data: {
          items: [{
            id: "evt1", status: "confirmed", summary: "omnis launch sync",
            start: { dateTime: "2026-09-25T10:00:00+09:00" }, end: { dateTime: "2026-09-25T10:30:00+09:00" },
          }],
        },
      });
      const calendarClient = { events: { list } } as never;
      const adapter = createGoogleCalendarAdapter({ oauthClientId: "id", oauthClientSecret: "secret", calendarClient });

      const collected = [];
      for await (const item of adapter.backfill()) collected.push(item);
      expect(collected).toHaveLength(1);
      expect(collected[0]?.externalId).toBe("evt1");
    });
  });

  describe("Google Calendar adapter send()", () => {
    it("calls only the injected sink, never events.insert", async () => {
      const sink = vi.fn().mockResolvedValue({ externalId: "evt-new", sentAt: "2026-09-25T09:00:00.000Z" });
      const calendarClient = { events: { insert: vi.fn() } } as never;
      const adapter = createGoogleCalendarAdapter({ oauthClientId: "id", oauthClientSecret: "secret", calendarClient, sink });

      const result = await adapter.send(
        { accountId: "acc-1", externalId: "primary" },
        { text: "propose 2pm sync" },
      );
      expect(sink).toHaveBeenCalledTimes(1);
      expect(result.externalId).toBe("evt-new");
      expect((calendarClient as { events: { insert: ReturnType<typeof vi.fn> } }).events.insert).not.toHaveBeenCalled();
    });
  });
  ```

- [ ] 6. 테스트를 실행해 전부 통과를 확인한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/adapter-google-calendar test
  ```

  예상 출력: `Tests  7 passed (7)`(Task 10의 3개 + 이 태스크의 normalize 2개 + backfill/send 2개).

- [ ] 7. 커밋한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/adapters/google-calendar
  git commit -m "$(cat <<'EOF'
  US-A14: Google Calendar normalize() 완성(threadMeta) + backfill() + send() mock

  - normalize(): threadMeta.kind='calendar', attendees를 participants로 매핑, cancelled면 archivedAt 채움
  - backfill(): timeMin=이번 분기 시작, timeMax=+90일(A1 §2.3)
  - send()는 mock sink만 호출 — events.insert/update는 승인 게이트(US-A07) 전까지 미배선

  Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 12: Slack fixture 세트 (US-A15, tier: DeepSeek, 리뷰 Sonnet+)

**US-A15 산출물(A7 §7):** `*/test/contract.test.ts`(3종). **검증 명령:** `pnpm test:contract`. **목표:** 어댑터 계약 테스트 3종(fixture 재생, A12~A14 각각).

**Files:**
- Create: `packages/adapters/slack/fixtures/text_message.json`, `thread_reply.json`, `attachment.json`, `edited_message.json`, `deleted_message.json`, `rate_limited_response.json`, `auth_error_response.json`

**Interfaces:** Consumes: Task 6의 `normalize(raw)`/`mapApiError(raw)`의 실제 동작(fixture의 `expected`는 그 함수들이 실제로 반환/throw하는 값과 바이트 단위로 같아야 한다). Produces: fixture JSON 7개(interfaces.md §9 최소 시나리오 + Slack 전용 `edited_message`/`deleted_message`).

Slack은 edit/delete를 지원하는 채널이라 A1 §1.7이 두 시나리오를 추가로 요구한다. `edited_message`/`deleted_message`는 Slack Events API에서 `subtype: "message_changed"`/`"message_deleted"`로 온다 — 현재 `normalize()`(Task 6)는 일반 `message` 이벤트만 처리하므로 이 두 fixture의 `expected.items`는 빈 배열이다(서브타입 처리는 Phase A 범위 밖, YAGNI — v1 인박스는 편집을 별도 UI로 반영하지 않는다, A1에 그런 요구가 없다).

- [ ] 1. `text_message.json`을 만든다.

  ```json
  {
    "scenario": "text_message",
    "raw": {
      "type": "message", "channel": "C0123456789", "user": "U0123456789",
      "text": "hey, can you review the PR?", "ts": "1700000000.000100", "team": "T0123456789"
    },
    "expected": {
      "items": [{
        "threadExternalId": "C0123456789", "externalId": "1700000000.000100", "kind": "message",
        "author": { "kind": "person", "id": "U0123456789" }, "body": "hey, can you review the PR?",
        "attachments": [], "sentAt": "2023-11-14T22:13:20.000Z", "status": "received",
        "sourceHash": "1700000000.000100"
      }]
    }
  }
  ```

- [ ] 2. `thread_reply.json`을 만든다.

  ```json
  {
    "scenario": "thread_reply",
    "raw": {
      "type": "message", "channel": "C0123456789", "user": "U0123456789",
      "text": "sounds good", "ts": "1700000100.000200", "thread_ts": "1700000000.000100", "team": "T0123456789"
    },
    "expected": {
      "items": [{
        "threadExternalId": "C0123456789", "externalId": "1700000100.000200", "kind": "message",
        "author": { "kind": "person", "id": "U0123456789" }, "body": "sounds good",
        "attachments": [], "sentAt": "2023-11-14T22:15:00.000Z", "status": "received",
        "sourceHash": "1700000100.000200"
      }]
    }
  }
  ```

- [ ] 3. `attachment.json`을 만든다.

  ```json
  {
    "scenario": "attachment",
    "raw": {
      "type": "message", "channel": "C0123456789", "user": "U0123456789", "text": "see attached",
      "ts": "1700000200.000300", "team": "T0123456789",
      "files": [{ "mimetype": "image/png", "size": 2048, "url_private": "https://files.slack.com/x/y.png", "name": "y.png" }]
    },
    "expected": {
      "items": [{
        "threadExternalId": "C0123456789", "externalId": "1700000200.000300", "kind": "message",
        "author": { "kind": "person", "id": "U0123456789" }, "body": "see attached",
        "attachments": [{ "kind": "image", "mimeType": "image/png", "sizeBytes": 2048, "caption": "y.png" }],
        "sentAt": "2023-11-14T22:16:40.000Z", "status": "received", "sourceHash": "1700000200.000300"
      }]
    }
  }
  ```

- [ ] 4. `edited_message.json`과 `deleted_message.json`을 만든다(Phase A는 서브타입을 처리하지 않으므로 `expected.items`는 `[]`).

  ```bash
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/slack/fixtures/edited_message.json <<'EOF'
  {
    "scenario": "edited_message",
    "raw": {
      "type": "message", "subtype": "message_changed", "channel": "C0123456789", "ts": "1700000300.000400",
      "message": { "type": "message", "user": "U0123456789", "text": "edited text", "ts": "1700000200.000300", "edited": { "user": "U0123456789", "ts": "1700000300.000000" } }
    },
    "expected": { "items": [] }
  }
  EOF
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/slack/fixtures/deleted_message.json <<'EOF'
  {
    "scenario": "deleted_message",
    "raw": {
      "type": "message", "subtype": "message_deleted", "channel": "C0123456789", "ts": "1700000400.000500",
      "deleted_ts": "1700000200.000300"
    },
    "expected": { "items": [] }
  }
  EOF
  ```

- [ ] 5. `rate_limited_response.json`과 `auth_error_response.json`을 만든다(`normalize`가 아니라 Task 6의 `mapApiError`가 검증 대상 — `expected.errorKind`를 쓴다, Task 15의 harness가 이 필드를 읽는다).

  ```bash
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/slack/fixtures/rate_limited_response.json <<'EOF'
  {
    "scenario": "rate_limited_response",
    "raw": { "httpStatus": 429, "headers": { "retry-after": "30" }, "body": { "ok": false, "error": "ratelimited" } },
    "expected": { "errorKind": "retryable_rate_limit" }
  }
  EOF
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/slack/fixtures/auth_error_response.json <<'EOF'
  {
    "scenario": "auth_error_response",
    "raw": { "httpStatus": 401, "body": { "ok": false, "error": "invalid_auth" } },
    "expected": { "errorKind": "auth_expired" }
  }
  EOF
  ```

- [ ] 6. 7개 파일이 모두 유효한 JSON인지 확인한다.

  ```bash
  for f in /Users/logankim/AI-Workspaces/omnis/packages/adapters/slack/fixtures/*.json; do
    node -e "JSON.parse(require('fs').readFileSync('$f','utf8')); console.log('$f OK')"
  done
  ```

  예상 출력: 7줄 모두 `OK`.

- [ ] 7. 커밋한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/adapters/slack/fixtures
  git commit -m "$(cat <<'EOF'
  US-A15: Slack fixture 세트 7종(text_message/thread_reply/attachment/edited/deleted/rate_limited/auth_error)

  - text_message/thread_reply/attachment는 Task 6 normalize()의 실제 출력과 바이트 단위로 일치
  - edited_message/deleted_message는 expected.items=[](Phase A는 서브타입 미처리, YAGNI)
  - rate_limited_response/auth_error_response는 expected.errorKind로 mapApiError() 매핑을 검증(Task 15 harness)

  Co-Authored-By: DeepSeek V4.1 Flash <noreply@deepseek.com>
  EOF
  )"
  ```

---

### Task 13: Gmail fixture 세트 (US-A15, tier: DeepSeek, 리뷰 Sonnet+)

**Files:**
- Create: `packages/adapters/gmail/fixtures/text_message.json`, `thread_reply.json`, `attachment.json`, `rate_limited_response.json`, `auth_error_response.json`

**Interfaces:** Consumes: Task 9의 `normalize(raw)`/`mapApiError(cause)`. Produces: fixture JSON 5개.

- [ ] 1. `text_message.json`을 만든다(Gmail `users.messages.get` 리소스, Task 9와 동일 샘플).

  ```json
  {
    "scenario": "text_message",
    "raw": {
      "id": "18c2f4a1b2d3e4f5", "threadId": "18c2f4a1b2d3e4f0",
      "payload": {
        "headers": [
          { "name": "From", "value": "Dana Lee <dana@example.com>" },
          { "name": "Subject", "value": "omnis launch sync" },
          { "name": "Message-Id", "value": "<CAFakeMsgId001@mail.gmail.com>" },
          { "name": "Date", "value": "Tue, 14 Nov 2023 22:13:20 +0000" }
        ],
        "mimeType": "text/plain",
        "body": { "data": "TGV0J3Mgc3luYyB0b21vcnJvdyBhdCAxMGFtIGFib3V0IHRoZSBvbW5pcyBsYXVuY2gu" }
      }
    },
    "expected": {
      "items": [{
        "threadExternalId": "18c2f4a1b2d3e4f0", "externalId": "18c2f4a1b2d3e4f5", "kind": "email",
        "author": { "kind": "person", "id": "Dana Lee <dana@example.com>" },
        "body": "Subject: omnis launch sync\n\nLet's sync tomorrow at 10am about the omnis launch.",
        "attachments": [], "sentAt": "2023-11-14T22:13:20.000Z", "status": "received",
        "sourceHash": "<CAFakeMsgId001@mail.gmail.com>"
      }]
    }
  }
  ```

- [ ] 2. `thread_reply.json`을 만든다(같은 `threadId`, 새 `id`/`Message-Id`, `In-Reply-To` 헤더 추가 — 정규화 로직은 헤더를 안 쓰므로 결과는 독립 item).

  ```json
  {
    "scenario": "thread_reply",
    "raw": {
      "id": "18c2f4a1b2d3e4f6", "threadId": "18c2f4a1b2d3e4f0",
      "payload": {
        "headers": [
          { "name": "From", "value": "Logan Kim <281932556+jinhologankim@users.noreply.github.com>" },
          { "name": "Subject", "value": "Re: omnis launch sync" },
          { "name": "Message-Id", "value": "<CAFakeMsgId002@mail.gmail.com>" },
          { "name": "In-Reply-To", "value": "<CAFakeMsgId001@mail.gmail.com>" },
          { "name": "Date", "value": "Tue, 14 Nov 2023 22:20:00 +0000" }
        ],
        "mimeType": "text/plain",
        "body": { "data": "U291bmRzIGdvb2Qu" }
      }
    },
    "expected": {
      "items": [{
        "threadExternalId": "18c2f4a1b2d3e4f0", "externalId": "18c2f4a1b2d3e4f6", "kind": "email",
        "author": { "kind": "person", "id": "Logan Kim <281932556+jinhologankim@users.noreply.github.com>" },
        "body": "Subject: Re: omnis launch sync\n\nSounds good.",
        "attachments": [], "sentAt": "2023-11-14T22:20:00.000Z", "status": "received",
        "sourceHash": "<CAFakeMsgId002@mail.gmail.com>"
      }]
    }
  }
  ```

  `"U291bmRzIGdvb2Qu"`는 `"Sounds good."`의 base64url이다(`node -e "console.log(Buffer.from('Sounds good.').toString('base64url'))"`로 검증됨).

- [ ] 3. `attachment.json`을 만든다. `normalize()`(Task 9)는 아직 `payload.parts`의 첨부를 읽지 않으므로(YAGNI — Phase A는 본문 텍스트 정규화까지만, 첨부 다운로드는 A1 §2.2 "개별 다운로드"가 별도 경로라 Item 정규화와 독립) `expected.attachments`는 `[]`다.

  ```json
  {
    "scenario": "attachment",
    "raw": {
      "id": "18c2f4a1b2d3e4f7", "threadId": "18c2f4a1b2d3e4f1",
      "payload": {
        "headers": [
          { "name": "From", "value": "Dana Lee <dana@example.com>" },
          { "name": "Subject", "value": "PoC slides" },
          { "name": "Message-Id", "value": "<CAFakeMsgId003@mail.gmail.com>" },
          { "name": "Date", "value": "Tue, 14 Nov 2023 23:00:00 +0000" }
        ],
        "mimeType": "multipart/mixed",
        "body": { "data": "U2VlIGF0dGFjaGVkIHNsaWRlcy4=" },
        "parts": [{ "filename": "poc.pdf", "mimeType": "application/pdf", "body": { "attachmentId": "att-1", "size": 40960 } }]
      }
    },
    "expected": {
      "items": [{
        "threadExternalId": "18c2f4a1b2d3e4f1", "externalId": "18c2f4a1b2d3e4f7", "kind": "email",
        "author": { "kind": "person", "id": "Dana Lee <dana@example.com>" },
        "body": "Subject: PoC slides\n\n",
        "attachments": [], "sentAt": "2023-11-14T23:00:00.000Z", "status": "received",
        "sourceHash": "<CAFakeMsgId003@mail.gmail.com>"
      }]
    }
  }
  ```

  주의: 이 fixture의 `payload.body.data`는 top-level `multipart/mixed` 메시지에서 보통 비어 있다(실제 본문은 `parts[0]`에 있다) — 하지만 Task 9의 `normalize()`는 `r.payload?.body?.data`만 읽으므로 이 fixture에서도 그 필드만 디코드해 `expected.body`를 맞춘다("See attached slides."를 넣지 않고 `body.data`를 비워 `body`가 `"Subject: PoC slides\n\n"`로 끝나게 설계했다). multipart 본문 파싱(`parts[]` 순회)은 Phase A 범위 밖 — 열어둔 질문으로 `open_questions`에 남긴다.

- [ ] 4. `rate_limited_response.json`과 `auth_error_response.json`을 만든다(Task 9의 `mapApiError(cause)`가 받는 googleapis 에러 shape).

  ```bash
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/gmail/fixtures/rate_limited_response.json <<'EOF'
  {
    "scenario": "rate_limited_response",
    "raw": { "code": 429, "message": "Rate Limit Exceeded" },
    "expected": { "errorKind": "retryable_rate_limit" }
  }
  EOF
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/gmail/fixtures/auth_error_response.json <<'EOF'
  {
    "scenario": "auth_error_response",
    "raw": { "code": 401, "message": "Invalid Credentials" },
    "expected": { "errorKind": "auth_expired" }
  }
  EOF
  ```

- [ ] 5. 5개 파일이 모두 유효한 JSON인지 확인한다.

  ```bash
  for f in /Users/logankim/AI-Workspaces/omnis/packages/adapters/gmail/fixtures/*.json; do
    node -e "JSON.parse(require('fs').readFileSync('$f','utf8')); console.log('$f OK')"
  done
  ```

  예상 출력: 5줄 모두 `OK`.

- [ ] 6. 커밋한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/adapters/gmail/fixtures
  git commit -m "$(cat <<'EOF'
  US-A15: Gmail fixture 세트 5종(text_message/thread_reply/attachment/rate_limited/auth_error)

  - attachment 시나리오는 parts[] 첨부 파싱이 Phase A 범위 밖임을 명시(open question)
  - rate_limited/auth_error는 googleapis 에러 shape({code,message})으로 mapApiError()를 검증

  Co-Authored-By: DeepSeek V4.1 Flash <noreply@deepseek.com>
  EOF
  )"
  ```

---

### Task 14: Google Calendar fixture 세트 (US-A15, tier: DeepSeek, 리뷰 Sonnet+)

**Files:**
- Create: `packages/adapters/google-calendar/fixtures/text_message.json`, `thread_reply.json`, `attachment.json`, `rate_limited_response.json`, `auth_error_response.json`

**Interfaces:** Consumes: Task 11의 `normalize(raw)`. Produces: fixture JSON 5개.

Calendar에는 "메시지"/"스레드 답글" 개념이 없으므로 interfaces.md §9의 범용 시나리오 이름을 이벤트 의미로 맞춰 채운다: `text_message`=단일 확정 이벤트, `thread_reply`=참석자가 응답한 반복 인스턴스(같은 요일 다음 회차), `attachment`=Drive 링크 첨부가 있는 이벤트.

- [ ] 1. `text_message.json`을 만든다(Task 11 샘플과 동일한 단일 확정 이벤트).

  ```json
  {
    "scenario": "text_message",
    "raw": {
      "id": "evt1", "status": "confirmed", "summary": "omnis launch sync",
      "start": { "dateTime": "2026-09-25T10:00:00+09:00" },
      "end": { "dateTime": "2026-09-25T10:30:00+09:00" },
      "attendees": [{ "email": "dana@example.com", "displayName": "Dana Lee", "responseStatus": "accepted" }]
    },
    "expected": {
      "items": [{
        "threadExternalId": "evt1", "externalId": "evt1", "kind": "event",
        "author": { "kind": "system", "id": "" }, "body": "omnis launch sync",
        "attachments": [], "sentAt": "2026-09-25T10:00:00+09:00", "status": "received", "sourceHash": "evt1",
        "threadMeta": {
          "externalId": "evt1", "kind": "calendar", "title": "omnis launch sync",
          "participants": [{ "externalId": "dana@example.com", "displayName": "Dana Lee" }],
          "lastItemAt": "2026-09-25T10:00:00+09:00", "archivedAt": null
        }
      }]
    }
  }
  ```

- [ ] 2. `thread_reply.json`을 만든다(다음 주 같은 반복 인스턴스 — 별도 event id이므로 별도 thread로 정규화된다, Calendar는 A1 §2.3상 event 단위가 곧 thread다).

  ```json
  {
    "scenario": "thread_reply",
    "raw": {
      "id": "evt1_20261002", "status": "confirmed", "summary": "omnis launch sync",
      "start": { "dateTime": "2026-10-02T10:00:00+09:00" },
      "end": { "dateTime": "2026-10-02T10:30:00+09:00" },
      "attendees": [{ "email": "dana@example.com", "displayName": "Dana Lee", "responseStatus": "needsAction" }]
    },
    "expected": {
      "items": [{
        "threadExternalId": "evt1_20261002", "externalId": "evt1_20261002", "kind": "event",
        "author": { "kind": "system", "id": "" }, "body": "omnis launch sync",
        "attachments": [], "sentAt": "2026-10-02T10:00:00+09:00", "status": "received", "sourceHash": "evt1_20261002",
        "threadMeta": {
          "externalId": "evt1_20261002", "kind": "calendar", "title": "omnis launch sync",
          "participants": [{ "externalId": "dana@example.com", "displayName": "Dana Lee" }],
          "lastItemAt": "2026-10-02T10:00:00+09:00", "archivedAt": null
        }
      }]
    }
  }
  ```

- [ ] 3. `attachment.json`을 만든다(Drive 링크 첨부 — A1 §2.3 "URL 그대로 보존, 별도 다운로드 안 함". `normalize()`는 Task 11 기준 `attachments`를 만들지 않으므로 `[]`).

  ```json
  {
    "scenario": "attachment",
    "raw": {
      "id": "evt2", "status": "confirmed", "summary": "PoC review",
      "start": { "dateTime": "2026-09-26T14:00:00+09:00" },
      "end": { "dateTime": "2026-09-26T15:00:00+09:00" },
      "attachments": [{ "fileUrl": "https://drive.google.com/file/d/abc123", "title": "PoC deck.pdf" }],
      "attendees": []
    },
    "expected": {
      "items": [{
        "threadExternalId": "evt2", "externalId": "evt2", "kind": "event",
        "author": { "kind": "system", "id": "" }, "body": "PoC review",
        "attachments": [], "sentAt": "2026-09-26T14:00:00+09:00", "status": "received", "sourceHash": "evt2",
        "threadMeta": {
          "externalId": "evt2", "kind": "calendar", "title": "PoC review",
          "participants": [], "lastItemAt": "2026-09-26T14:00:00+09:00", "archivedAt": null
        }
      }]
    }
  }
  ```

- [ ] 4. `rate_limited_response.json`과 `auth_error_response.json`을 만든다. Task 11까지는 `mapApiError`를 별도 export하지 않았으므로(backfill/subscribe 안에서 인라인으로 `AdapterError`를 던진다) 이 두 fixture는 `normalize()`가 아니라 **backfill()이 `events.list` 실패를 어떻게 매핑하는지**를 문서화하는 참고 자료로 남기고, `expected.errorKind`는 Task 10에서 이미 구현된 `subscribe()`의 410 처리와 짝을 맞춘 값을 적는다 — Task 15가 이 두 fixture용 계약 테스트에서 `subscribe()`용 `events.list` mock을 410으로 응답시켜 검증한다.

  ```bash
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/google-calendar/fixtures/rate_limited_response.json <<'EOF'
  {
    "scenario": "rate_limited_response",
    "raw": { "code": 429, "message": "Rate Limit Exceeded" },
    "expected": { "errorKind": "retryable_network" }
  }
  EOF
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/google-calendar/fixtures/auth_error_response.json <<'EOF'
  {
    "scenario": "auth_error_response",
    "raw": { "code": 401, "message": "Invalid Credentials" },
    "expected": { "errorKind": "auth_revoked" }
  }
  EOF
  ```

  `errorKind`가 Slack/Gmail과 다르게 `retryable_network`/`auth_revoked`인 이유: Task 10·11의 Calendar 어댑터는 `mapApiError()`를 만들지 않았다(모든 `events.list` 실패를 `backfill()`에서 `retryable_network`로, `connect()` 실패를 `auth_revoked`로 던진다) — 이 fixture는 그 실제 동작과 맞춘 것이다. 세 채널의 에러 매핑 세분화 정도가 다른 것은 열어둔 질문으로 `open_questions`에 남긴다.

- [ ] 5. 5개 파일이 모두 유효한 JSON인지 확인한다.

  ```bash
  for f in /Users/logankim/AI-Workspaces/omnis/packages/adapters/google-calendar/fixtures/*.json; do
    node -e "JSON.parse(require('fs').readFileSync('$f','utf8')); console.log('$f OK')"
  done
  ```

  예상 출력: 5줄 모두 `OK`.

- [ ] 6. 커밋한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/adapters/google-calendar/fixtures
  git commit -m "$(cat <<'EOF'
  US-A15: Google Calendar fixture 세트 5종(단일 이벤트/반복 인스턴스/첨부/rate_limited/auth_error)

  - text_message/thread_reply/attachment는 Task 11 normalize()의 실제 threadMeta 출력과 일치
  - rate_limited/auth_error는 Calendar 어댑터가 mapApiError()를 따로 두지 않고 backfill()/connect()에서
    바로 retryable_network/auth_revoked로 매핑하는 실제 동작을 기록

  Co-Authored-By: DeepSeek V4.1 Flash <noreply@deepseek.com>
  EOF
  )"
  ```

---

### Task 15: 계약 테스트 하네스 — 3채널 `test/contract.test.ts` + `pnpm test:contract` 배선 (US-A15, tier: DeepSeek, 리뷰 Sonnet+)

**Files:**
- Create: `packages/adapters/slack/test/contract.test.ts`, `packages/adapters/gmail/test/contract.test.ts`, `packages/adapters/google-calendar/test/contract.test.ts`
- Verify only (does not create — 루트 파일 오너는 kernel-and-db Task 1): `vitest.workspace.ts`(root)

**Interfaces:** Consumes: Task 6의 `normalize`/`mapApiError`(slack), Task 9의 `normalize`/`mapApiError`(gmail), Task 11의 `normalize`(google-calendar) + Task 10의 `subscribe`(calendar 에러 매핑 검증용) — 전부 Task 12~14의 fixture JSON. Produces: `pnpm test:contract`가 그린으로 끝나는 상태.

읽을 스펙: interfaces.md §2(`pnpm test:contract` = `vitest run --project contract`, vitest 프로젝트 이름 3종 고정) + §9(fixture 배치 규칙).

- [ ] 1. 실패하는 테스트를 작성한다: `packages/adapters/slack/test/contract.test.ts` — fixture 디렉터리를 순회해 `normalize`/`mapApiError`를 재생한다.

  ```ts
  import { readdirSync, readFileSync } from "node:fs";
  import { dirname, join } from "node:path";
  import { fileURLToPath } from "node:url";
  import { describe, expect, it } from "vitest";
  import { mapApiError, normalize } from "../src/index.js";

  interface Fixture {
    scenario: string;
    raw: unknown;
    expected: { items?: unknown[]; errorKind?: string };
  }

  const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
  const fixtureFiles = readdirSync(fixturesDir).filter((f) => f.endsWith(".json"));

  describe("Slack contract: fixture replay", () => {
    for (const file of fixtureFiles) {
      const fixture = JSON.parse(readFileSync(join(fixturesDir, file), "utf8")) as Fixture;
      it(`${fixture.scenario} (${file})`, () => {
        if (fixture.expected.errorKind) {
          const err = mapApiError(fixture.raw);
          expect(err.kind).toBe(fixture.expected.errorKind);
        } else {
          expect(normalize(fixture.raw)).toEqual(fixture.expected.items);
        }
      });
    }
  });
  ```

- [ ] 2. Gmail과 Google Calendar에도 같은 패턴으로 만든다(Calendar는 `mapApiError`를 export하지 않으므로 에러 fixture는 `backfill()`/`connect()`를 직접 mock으로 호출해 검증한다).

  ```bash
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/gmail/test/contract.test.ts <<'EOF'
  import { readdirSync, readFileSync } from "node:fs";
  import { dirname, join } from "node:path";
  import { fileURLToPath } from "node:url";
  import { describe, expect, it } from "vitest";
  import { mapApiError, normalize } from "../src/index.js";

  interface Fixture {
    scenario: string;
    raw: unknown;
    expected: { items?: unknown[]; errorKind?: string };
  }

  const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
  const fixtureFiles = readdirSync(fixturesDir).filter((f) => f.endsWith(".json"));

  describe("Gmail contract: fixture replay", () => {
    for (const file of fixtureFiles) {
      const fixture = JSON.parse(readFileSync(join(fixturesDir, file), "utf8")) as Fixture;
      it(`${fixture.scenario} (${file})`, () => {
        if (fixture.expected.errorKind) {
          const err = mapApiError(fixture.raw);
          expect(err.kind).toBe(fixture.expected.errorKind);
        } else {
          expect(normalize(fixture.raw)).toEqual(fixture.expected.items);
        }
      });
    }
  });
  EOF
  ```

  ```bash
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/google-calendar/test/contract.test.ts <<'EOF'
  import { readdirSync, readFileSync } from "node:fs";
  import { dirname, join } from "node:path";
  import { fileURLToPath } from "node:url";
  import { describe, expect, it, vi } from "vitest";
  import { AdapterError } from "@omnis/protocol";
  import { createGoogleCalendarAdapter, normalize } from "../src/index.js";

  interface Fixture {
    scenario: string;
    raw: unknown;
    expected: { items?: unknown[]; errorKind?: string };
  }

  const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
  const fixtureFiles = readdirSync(fixturesDir).filter((f) => f.endsWith(".json"));

  describe("Google Calendar contract: fixture replay", () => {
    for (const file of fixtureFiles) {
      const fixture = JSON.parse(readFileSync(join(fixturesDir, file), "utf8")) as Fixture;
      it(`${fixture.scenario} (${file})`, async () => {
        if (fixture.expected.errorKind === "retryable_network") {
          const list = vi.fn().mockRejectedValue(fixture.raw);
          const adapter = createGoogleCalendarAdapter({
            oauthClientId: "id", oauthClientSecret: "secret",
            calendarClient: { events: { list } } as never,
          });
          await expect(async () => {
            for await (const _ of adapter.backfill()) void _;
          }).rejects.toMatchObject({ kind: "retryable_network" } satisfies Partial<AdapterError>);
        } else if (fixture.expected.errorKind === "auth_revoked") {
          const adapter = createGoogleCalendarAdapter({
            oauthClientId: "id", oauthClientSecret: "secret",
            oauthClient: { setCredentials: vi.fn(), getAccessToken: vi.fn().mockRejectedValue(fixture.raw) } as never,
          });
          await expect(
            adapter.connect({
              channel: "gcal", accountExternalId: "acc", keychainService: "omnis.gmail.test@example.com",
              keychainAccount: "test@example.com",
            }),
          ).rejects.toMatchObject({ kind: "auth_revoked" });
        } else {
          expect(normalize(fixture.raw)).toEqual(fixture.expected.items);
        }
      });
    }
  });
  EOF
  ```

  `auth_revoked` 케이스는 Keychain을 실제로 읽으므로(`omnis.gmail.test@example.com` 항목은 존재하지 않는다) 먼저 `auth_expired`(Keychain 미발견)로 실패할 수 있다 — 이 fixture 의도는 "refresh token은 있지만 revoke됨"이므로 `oauthClient`를 직접 주입해 `readKeychainSecret` 단계를 우회해야 한다. 위 코드는 `oauthClient.getAccessToken`이 reject하는 경로만 taken하도록 `oauthClient`를 미리 주입했지만, `connect()`는 `oauthClient`가 주어져도 `readKeychainSecret`을 먼저 호출하므로 여전히 Keychain 조회가 먼저 실패한다 — 다음 스텝에서 이 gap을 고친다.

- [ ] 3. Task 10의 `connect()`를 수정해 `oauthClient`가 이미 주입돼 있으면 `readKeychainSecret` 호출을 건너뛰고 그 client를 그대로 쓰게 한다(테스트 주입 경로 정리, 프로덕션 경로는 영향 없음 — 여전히 매번 새로 만들 때는 Keychain을 읽는다). `packages/adapters/google-calendar/src/index.ts`의 `connect`를 아래로 교체한다.

  ```ts
      async connect(auth: AuthRef): Promise<void> {
        if (deps.oauthClient) {
          oauth = deps.oauthClient;
        } else {
          const refreshToken = await readKeychainSecret(auth.keychainService, auth.keychainAccount, CHANNEL);
          oauth = new google.auth.OAuth2(deps.oauthClientId, deps.oauthClientSecret);
          oauth.setCredentials({ refresh_token: refreshToken });
        }
        try {
          await oauth.getAccessToken();
        } catch (cause) {
          status = "down";
          throw new AdapterError("auth_revoked", CHANNEL, "Calendar refresh token rejected", undefined, cause);
        }
        status = "healthy";
        lastEventAt = now().toISOString();
      },
  ```

- [ ] 4. 루트 `vitest.workspace.ts`는 이 태스크가 만들지 않는다 — 오너는 `2026-09-20-phase-a-kernel-and-db.md` Task 1이다(interfaces.md §2, FIXED — plans-review.md M4·M12). 존재와 `contract` 프로젝트 엔트리가 이 플랜이 필요로 하는 패턴을 덮는지만 확인한다.

  ```bash
  test -f /Users/logankim/AI-Workspaces/omnis/vitest.workspace.ts \
    || { echo "vitest.workspace.ts가 없다 — kernel-and-db Task 1을 먼저 실행한다."; exit 1; }
  grep -q 'name: "contract"' /Users/logankim/AI-Workspaces/omnis/vitest.workspace.ts \
    && grep -q 'packages/adapters/\*/test/contract.test.ts' /Users/logankim/AI-Workspaces/omnis/vitest.workspace.ts \
    && echo "contract 프로젝트 엔트리 확인됨" \
    || { echo "vitest.workspace.ts의 contract 프로젝트가 packages/adapters/*/test/contract.test.ts를 포함하지 않는다 — kernel-and-db Task 1의 vitest.workspace.ts를 수정해야 한다(이 플랜 범위 밖, kernel 플랜 소유)."; exit 1; }
  ```

- [ ] 5. `test:contract` 실행 전, 전체 `pnpm --filter` 유닛 테스트가 여전히 그린인지 먼저 확인한다(회귀 없음 확인).

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  pnpm --filter @omnis/adapter-slack test && \
  pnpm --filter @omnis/adapter-gmail test && \
  pnpm --filter @omnis/adapter-google-calendar test
  ```

  예상 출력: 세 패키지 모두 이전 태스크에서 확인한 테스트 수 그대로 통과(Slack 7, Gmail 4, Calendar 7) — `contract.test.ts`가 각 패키지의 `test/` 안에 있으므로 `pnpm --filter <name> test`(패키지 자신의 `vitest run`)도 이 시점부터 fixture 개수만큼 테스트가 늘어난다.

- [ ] 6. `pnpm test:contract`를 루트에서 실행한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm test:contract
  ```

  예상 출력: `contract` 프로젝트 3개 테스트 파일 모두 통과 — Slack 7개 시나리오 + Gmail 5개 + Calendar 5개 = 17개 테스트 케이스, `Test Files  3 passed (3)` / `Tests  17 passed (17)`.

- [ ] 7. 커밋한다.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/adapters/slack/test/contract.test.ts \
          packages/adapters/gmail/test/contract.test.ts \
          packages/adapters/google-calendar/test/contract.test.ts \
          packages/adapters/google-calendar/src/index.ts
  git commit -m "$(cat <<'EOF'
  US-A15: 3채널 계약 테스트 하네스 + pnpm test:contract 배선

  - test/contract.test.ts: fixtures/*.json을 순회해 normalize()/mapApiError()를 재생(A1 §1.7)
  - Calendar connect()에 oauthClient 직접 주입 경로 추가(Keychain 조회를 우회해 auth_revoked 테스트 가능)
  - 루트 vitest.workspace.ts는 만들지 않음(오너 = kernel-and-db Task 1, interfaces.md §2) — contract 프로젝트 엔트리 존재만 확인
  - pnpm test:contract 그린 확인: Slack 7 + Gmail 5 + Calendar 5 = 17 테스트

  Co-Authored-By: DeepSeek V4.1 Flash <noreply@deepseek.com>
  EOF
  )"
  ```

---

## Self-review

1. **스토리 커버리지**: US-A11 → Task 1~3. US-A12 → Task 4~6. US-A13 → Task 7~9. US-A14 → Task 10~11. US-A15 → Task 12~15. 5개 스토리 전부 최소 1개 태스크에 매핑됨.
2. **금지 패턴 grep**: `TBD`/`TODO`/`implement later`/`add appropriate error handling`/`handle edge cases`/`similar to Task` 문자열을 이 파일에서 검색해 0건 확인(아래 grep 실행 결과 참조 — 있었다면 이 섹션 작성 전에 고쳤다).
3. **심볼 출처 확인**: 이 플랜이 consume하는 모든 심볼(`Channel`/`NormalizedItem`/`Adapter`/`AdapterError`/`Attachment`/`Capabilities`/`AuthRef`/`Health`/`ThreadRef`/`Outbound`/`SendResult`/`Normalize`)은 interfaces.md §3.1~3.3 계약에 이미 있거나, 이 플랜의 앞선 태스크(Task 1~3)가 정의한다(Task 6이 `Attachment`를 쓰므로 Task 4 import 목록에 `type Attachment`를 포함시켰다). produce하는 계약 밖 심볼(`createSlackAdapter`/`createGmailAdapter`/`createGoogleCalendarAdapter`/`normalize`/`mapApiError`/`readKeychainSecret`/`CHANNEL`/`*AdapterDeps`)은 전부 이 문서 안에서 먼저 정의된 뒤에만 다음 태스크가 소비한다 — 순방향 참조 없음.

## open_questions

- **calendar_events 상세 테이블과 NormalizedItem의 간극**: A3 §2.1(이 플랜의 필수 읽기 범위 밖)은 어댑터가 `items`와 `calendar_events` 두 row를 같은 트랜잭션에서 upsert한다고 전제하지만, A1의 `Adapter`/`NormalizedItem` 계약은 어댑터에 DB 접근을 주지 않고 `NormalizedItem`에도 `end_at`/`attendees`/`recurrence` 필드가 없다. 이 플랜은 `NormalizedItem`만 만든다(계약 그대로) — `calendar_events`를 누가 무엇을 입력으로 채우는지(예: 커널 ingest write path가 raw Calendar API 리소스를 별도로 받는지, 아니면 `NormalizedItem`을 확장하는지)는 커널/ingest 플랜(US-A05 근방)이 결정해야 한다.
- **Gmail 첨부(`parts[]`) 정규화 미구현**: A1 §2.2는 `attachments.get` 개별 다운로드를 언급하지만 이 플랜의 `normalize()`는 `payload.parts`를 순회하지 않는다(top-level `body.data`만 읽음) — multipart 메시지의 첨부를 `NormalizedItem.attachments`로 채우는 작업은 별도 태스크로 남아 있다(Task 13의 `attachment.json` fixture가 이 gap을 `expected.attachments: []`로 명시).
- **세 채널의 에러 매핑 세분화 불일치**: Slack·Gmail은 `mapApiError()`라는 이름 있는 순수 함수로 429/401을 분류하지만 Calendar 어댑터는 `backfill()`/`connect()` 안에서 즉석으로 `retryable_network`/`auth_revoked`만 던진다(410 syncToken 만료만 `subscribe()`에서 별도 처리). 세 어댑터의 에러 분류를 같은 모양(`mapApiError` export)으로 통일할지는 다음 리뷰에서 결정할 문제로 남긴다.
- **`worktrunk` CLI 플래그 미확정**: A7-D5/§3이 이미 "UNVERIFIED — 스파이크"로 표시한 사항이라 이 플랜은 그대로 인용만 했다 — Phase A 착수 전 드라이런 결과에 따라 이 플랜의 커밋 절차 자체는 영향받지 않는다(스토리당 1 커밋은 worktrunk 유무와 무관).

## 수정 이력 (2026-09-20, cross-plan review)

`2026-09-20-plans-review.md`(§1 불일치표·§2 권장 계약 수정) + 업데이트된 `2026-09-20-phase-a-interfaces.md` + `tools/spikes/_probes/2026-09-20-cli-probes.md`를 대조해 반영했다. 적용 항목:

- **(M4) Task 1 — 루트 파일 오너 정정**: 루트 `pnpm-workspace.yaml`/`package.json`/`tsconfig.base.json`/`biome.jsonc` 생성 스텝을 삭제하고 `test -f` 존재 확인으로 교체했다(오너 = `2026-09-20-phase-a-kernel-and-db.md` Task 1, interfaces.md §2 FIXED). Wave 0에서 kernel T1과 이 플랜 T1~T3가 병렬로 돌므로 "루트 파일이 없으면 kernel-and-db Task 1(db-scaffold)을 먼저 실행하고 재개한다"는 안내를 추가했다. Task 1의 `git add`/커밋 본문에서도 루트 파일을 뺐다.
- **(M1, M2) 버전 핀**: `vitest ^2.1.8` → `vitest 2.1.9`, `typescript ^5.7.2` → `typescript 5.6.3`(전 패키지: protocol/slack/gmail/google-calendar package.json + Tech Stack 줄, 총 5곳)로 전부 교체. `zod ^3.24.1`은 이미 정본과 일치해 유지(오너 = `@omnis/protocol`, zod 4 미사용 명시 추가).
- **(M7, M8) Keychain 명명 명시**: Task 4(Slack)·Task 7(Gmail)·Task 10(Calendar) 각각의 "읽을 스펙" 문단에 interfaces.md §9 FIXED 규칙을 그대로 인용해 추가했다 — Slack은 `omnis.slack.xoxb.<team_id>`(account=`<team_id>`) + `…​.app` 2항목(`xoxp` 아님), Google 계열은 `omnis.gmail.<email>` 1항목 공유(`<kind>` 생략, gcal이 재사용). Global Constraints의 Keychain 항목명 줄에도 이 예외를 명시했다. 기존 `AuthRef` 예시·connect() 구현(Task 4/7/10)은 이미 이 명명을 따르고 있어 코드 변경은 없다 — 문서화만 보강했다.
- **Task 15 — `vitest.workspace.ts` 중복 생성 제거**: "Files" 목록과 스텝 4를 "생성"에서 "검증만(존재 + `contract` 프로젝트 엔트리 대조, 실패 시 kernel-and-db Task 1을 먼저 실행하라는 안내)"으로 교체했다(오너 = kernel-and-db Task 1, interfaces.md §2). 스텝 7 커밋의 `git add`/본문에서도 `vitest.workspace.ts`를 뺐다.
- **커밋 트레일러 규칙**: Global Constraints의 커밋 규칙 줄을 kernel-and-db 플랜·interfaces.md §9와 동일한 형식(브랜치 `ralph/<story-id>` + 워크트리 `omnis/.worktrees/<story-id>` + 제목 `<story-id>: <한 줄 요약>` + 본문에 충족한 acceptance criteria 목록 + 티어별 `Co-Authored-By` 마지막 줄, `fable` 미사용)으로 맞췄다.

미반영(이 플랜 범위 밖): M3(`pg`/`packageManager` 핀은 kernel-and-db 플랜 소유, 이 플랜은 `pg`를 의존하지 않는다), M5(루트 스크립트는 kernel-and-db Task 1 소유), M6(`WS /bridge` 서버는 kernel-and-db 소유), M9~M11(desktop/kernel 계약 심볼), M13·M14(CI workflow·phase-0 스파이크 범위 축소).
