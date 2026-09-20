# Phase A Kernel & DB Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Postgres 17 위에 omnis L0 커널(스키마 8파일 + 이벤트 3티어 + 스케줄러 + 승인 게이트 + kill switch + 감사 미들웨어)을 세우고 `apps/hub`가 `127.0.0.1:8787`에서 그것을 서비스하게 만든다.

**Architecture:** `@omnis/db`는 DDL과 마이그레이션 러너, 타입드 쿼리 헬퍼만 갖는 최하층이다(ORM 없음). `@omnis/kernel`은 `@omnis/db`와 `@omnis/protocol`에만 의존해 events/scheduler/approvals/kill-switch/audit/egress를 순수 백엔드 로직으로 구현하고, 비가역 행동은 전부 `runEgress` 한 함수를 통과해야만 실행된다. `apps/hub`는 커널을 부팅해 루프백 HTTP 표면 5개와 `WS /bridge`(계약 §5가 서버 구현 오너를 이 계획으로 고정했다), graceful shutdown만 얹는다 — 채널 코드도 UI도 없다. 마지막으로 A7 §6의 CI 워크플로를 붙인다.

**Tech Stack:** Node 22 + pnpm workspaces · TypeScript 5.6 (strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`) · PostgreSQL 17 + `pgcrypto`/`vector`(pgvector)/`pg_trgm` · `pg` 8.13.x (ORM 없음) · vitest 2.1.x (projects: `unit`/`contract`/`integration`) · Biome 1.9.x · `node:http` + `ws` 8.18.x (웹 프레임워크 없음) · GitHub Actions(`pgvector/pgvector:pg17` 서비스 컨테이너)

**Spec:** /Users/logankim/AI-Workspaces/omnis/docs/spec/00-omnis-design.md + 이 계획이 구현하는 부록:
- `A3-data-schema.md` 전체 (§1 규약, §1.1 값 집합, §2 코어 DDL, §2.1 캘린더, §3 사람·라벨, §4 작업·에이전트·승인, §5 메모리, §6 커널 테이블, §6.1 append-only, §6.1.1 롤오프, §6.2 NOTIFY, §7 publication, §8 마이그레이션, §9 draft 전이, §11 보존)
- `00-omnis-design.md` §4.2 배치 토폴로지, §7 커널
- `A7-dev-process.md` §1 의존 규칙, §2 툴체인, §5 테스트 전략, §7 백로그(US-A01~A10)
- `2026-09-20-phase-a-interfaces.md` (인터페이스 계약 — §1 패키지, §2 명령, §4 `@omnis/db`, §5 `@omnis/kernel`, §9 공통 규약)

---

## Global Constraints

- Node 22 + pnpm workspaces. 루트 `pnpm-workspace.yaml`에 `packages/*`, `packages/adapters/*`, `apps/*`만 넣고 `tools/spikes/*`는 넣지 않는다(A7 §1).
- TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`를 루트 `tsconfig.base.json`에 고정하고 각 패키지가 extend한다(A7 §1).
- Postgres 17 고정(A3 §1). 개발 DB `omnis`, 테스트 DB `omnis_test`, 접속은 `DATABASE_URL`(계약 §0-3, §9).
- 허브는 `127.0.0.1:8787`에만 bind한다(마스터 §4.2). 8642는 Hermes `api_server`가 쓰므로 피한다.
- 마이그레이션은 append-only 파일 `packages/db/migrations/000N_<name>.sql`이고 추적 테이블은 `_omnis_migrations`다(A3 §8). 이미 적용된 파일을 수정하지 않는다 — 항상 새 번호를 추가한다.
- 승인 게이트(US-A07)가 완성되기 전에는 `send`/`delete`/`delegate`/`calendar_write` 비가역 tool을 아무 데도 배선하지 않는다(A7 §7 공통 금지). 이 계획에서 실제 채널 `send`가 닿는 지점은 Task 22의 `createOutbox` 하나뿐이고, 그 안에서만 `runEgress`를 거친다.
- 테스트를 삭제하거나 스킵해서 통과시키지 않는다(A7 §7 공통 금지).
- provider SDK는 각 어댑터 패키지 안에서만 import한다 — `@omnis/db`/`@omnis/kernel`/`apps/hub`는 `pg` 외의 외부 클라이언트를 갖지 않는다(A7 §1).
- Keychain item 이름은 A1 규칙 `omnis.<channel>.<kind>.<external_id>`, 브리지 토큰은 `omnis.bridge.token.<host>`다(계약 §0-7). 이 계획은 Keychain을 읽지 않지만 `account_secrets.auth_ref`가 이 형식의 문자열만 담는다는 것을 DDL 주석으로 유지한다.
- 스토리 티어는 A7 §4 배정표를 따르고, DeepSeek가 만든 diff는 반드시 Sonnet 이상이 리뷰한다(A7 §3·§4).
- 커밋 메시지는 `<story-id>: <한 줄 요약>` + 본문에 충족한 acceptance criteria 목록 + 본문 마지막의 `Implemented-by: <tier>` 한 줄(A7 §6이 요구하는 "실제로 그 스토리를 구현한 모델" 표기: `DeepSeek V4.1 Flash` / `Claude Sonnet` / `Claude Opus`), 그리고 커밋의 **마지막 줄은 예외 없이** `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`(세션 규칙). 계약 §9의 `Co-Authored-By: Claude <tier>` / `Co-Authored-By: DeepSeek V4.1 Flash` 형식은 `Implemented-by:` 본문 줄로 흡수됐다 — open question 아님. 아래 모든 `git commit` 명령이 이 형식이다.
- 브랜치는 `ralph/<story-id>`, 워크트리는 `omnis/.worktrees/<story-id>`(계약 §9).

**선행 조건(이 계획 밖)**: Task 16 이후는 `@omnis/protocol`의 `HumanInterrupt`/`HumanResponse`/`ApprovalAction`/`ApprovalState`/`ApprovalDecision`/`ApprovalRisk`(계약 §3.4)와 `Adapter`/`NormalizedItem`/`AdapterEvent`/`IngestSink`(계약 §3.2·§3.3)를 import한다. 이 심볼들은 `2026-09-20-phase-a-protocol-and-adapters.md`의 US-A11이 만든다. US-A11이 merge되기 전에는 Task 16~25를 시작하지 않는다(A7 §7의 의존 순서에는 없지만 계약 §1의 패키지 의존이 강제한다).

**`exactOptionalPropertyTypes` 함정**: `{ target_id: maybeUndefined }`는 optional 프로퍼티에 `undefined`를 대입하는 것이라 컴파일 에러다. 이 계획의 코드는 전부 `...(x !== undefined ? { k: x } : {})` 조건부 스프레드나 SQL 파라미터의 `?? null`로 푼다.

**`noUncheckedIndexedAccess` 함정**: `rows[0]`의 타입은 `T | undefined`다. 이 계획의 코드는 전부 `const row = rows[0]; if (row === undefined) throw ...`로 좁힌다.

---

## Task 1: db-scaffold (US-A01, tier: DeepSeek)

**스토리 US-A01** — 목표: `packages/db` 스캐폴드 + 마이그레이션 러너(스키마 없이 러너만, advisory lock + sha 비교) / 산출물: `packages/db/src/migrate.ts`, `_omnis_migrations` 부트스트랩 / 검증 명령: `pnpm --filter @omnis/db test` / 티어: DeepSeek(리뷰 Sonnet+).

이 태스크는 모노레포 전체의 부트스트랩을 `@omnis/db`가 살아나는 데 필요한 만큼만 만든다. Task 2가 러너를 얹는다.

**읽을 곳**: A7 §1(트리·의존 방향), A7 §2(툴체인·루트 스크립트), 계약 §1(패키지 표), 계약 §2(명령 표), 계약 §4(`@omnis/db` export 목록).

**만들지 않을 것(YAGNI)**: Turborepo/Nx(A7-D2가 명시적으로 배제), ORM, 커스텀 로깅 라이브러리, `packages/memory`·`packages/agents`·`packages/ui`·`apps/desktop` 스캐폴드(각자 자기 계획에서 만든다), CI 워크플로(A7 §6 — 이 계획의 Task 27이 만든다, 여기서는 아니다).

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/package.json`, `/Users/logankim/AI-Workspaces/omnis/pnpm-workspace.yaml`, `/Users/logankim/AI-Workspaces/omnis/tsconfig.base.json`, `/Users/logankim/AI-Workspaces/omnis/tsconfig.json`, `/Users/logankim/AI-Workspaces/omnis/biome.jsonc`, `/Users/logankim/AI-Workspaces/omnis/vitest.shared.ts`, `/Users/logankim/AI-Workspaces/omnis/vitest.workspace.ts`, `/Users/logankim/AI-Workspaces/omnis/packages/db/package.json`, `/Users/logankim/AI-Workspaces/omnis/packages/db/tsconfig.json`, `/Users/logankim/AI-Workspaces/omnis/packages/db/vitest.config.ts`, `/Users/logankim/AI-Workspaces/omnis/packages/db/src/index.ts`
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/db/test/pool.test.ts`

**Interfaces:**
- Consumes: 없음(리프 부트스트랩).
- Produces: `createPool(env?: NodeJS.ProcessEnv): Pool` · `query<T>(c: Pool | PoolClient, sql: string, params?: readonly unknown[]): Promise<T[]>` · `one<T>(c: Pool | PoolClient, sql: string, params?: readonly unknown[]): Promise<T>` · `tx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T>` · `MIGRATIONS_DIR: string` · `NOTIFY_CHANNELS: readonly string[]` (전부 `@omnis/db`, 계약 §4).

### Steps

- [ ] 1. 워크스페이스 루트 파일 4개를 만든다.

`/Users/logankim/AI-Workspaces/omnis/pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
  - "packages/adapters/*"
  - "apps/*"
```

`/Users/logankim/AI-Workspaces/omnis/package.json`:
```json
{
  "name": "omnis",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "packageManager": "pnpm@9.12.3",
  "scripts": {
    "build": "tsc --build",
    "typecheck": "tsc --build --force",
    "lint": "biome check .",
    "format": "biome check --write .",
    "test": "vitest run",
    "test:contract": "vitest run --project contract",
    "test:integration": "vitest run --project integration",
    "dev": "concurrently -k -n hub,desktop -c blue,magenta \"pnpm --filter @omnis/hub dev\" \"pnpm --filter @omnis/desktop dev\"",
    "tauri:dev": "pnpm --filter @omnis/desktop tauri dev",
    "tauri:build": "pnpm --filter @omnis/desktop tauri build",
    "db:migrate": "pnpm --filter @omnis/db migrate",
    "db:migrate:create": "pnpm --filter @omnis/db migrate:create",
    "db:seed": "echo 'no seed files in Phase A — v1 seed rows live in 0002/0006 migrations (A3 §4, §6)'"
  },
  "devDependencies": {
    "@biomejs/biome": "1.9.4",
    "@types/node": "22.7.5",
    "concurrently": "9.1.0",
    "tsx": "4.19.2",
    "typescript": "5.6.3",
    "vitest": "2.1.9"
  }
}
```

> **루트 파일 오너는 이 태스크 하나다**(계약 §2). 다른 5개 계획은 루트 스캐폴드를 만들지 않고 `test -f`로 존재만 확인한다. 버전 핀은 전 워크스페이스 동일: `vitest 2.1.9` · `typescript 5.6.3` · `pg 8.13.1` · `packageManager pnpm@9.12.3` · `zod ^3.24.1`(오너 `@omnis/protocol`, zod 4 금지) · `@rocicorp/zero 1.9.0` exact · `ai 7.0.107`.
>
> `dev`·`tauri:dev`·`tauri:build`는 `@omnis/desktop`을 가리킨다 — 그 패키지는 `2026-09-20-phase-a-desktop.md`가 만든다. 이 계획 단계에서 `pnpm dev`를 돌리면 pnpm이 `@omnis/desktop`을 못 찾고 그 한 쪽만 실패한다(정상). `db:migrate`는 `@omnis/db`의 `migrate` 스크립트를 부르고, 그 스크립트와 CLI 파일은 Task 2가 만든다.

`/Users/logankim/AI-Workspaces/omnis/tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "skipLibCheck": true
  }
}
```

`/Users/logankim/AI-Workspaces/omnis/tsconfig.json`:
```json
{
  "files": [],
  "references": [{ "path": "./packages/db" }]
}
```

`/Users/logankim/AI-Workspaces/omnis/biome.jsonc`:
```jsonc
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "files": { "ignore": ["**/dist/**", "**/node_modules/**", "tools/spikes/**"] },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "javascript": { "formatter": { "quoteStyle": "double", "semicolons": "always" } }
}
```

- [ ] 2. vitest 프로젝트 3개(`unit`/`contract`/`integration`)를 고정한다(계약 §2). 소스 TS를 그대로 실행하도록 워크스페이스 alias도 여기서 한 번만 선언한다.

`/Users/logankim/AI-Workspaces/omnis/vitest.shared.ts`:
```ts
import { fileURLToPath } from "node:url";

/** 내부 패키지는 빌드 산출물이 아니라 소스 TS를 그대로 물린다. 프로덕션은 tsc --build의 dist를 쓴다. */
export const omnisAlias: Record<string, string> = {
  "@omnis/db": fileURLToPath(new URL("./packages/db/src/index.ts", import.meta.url)),
  "@omnis/protocol": fileURLToPath(new URL("./packages/protocol/src/index.ts", import.meta.url)),
  "@omnis/kernel": fileURLToPath(new URL("./packages/kernel/src/index.ts", import.meta.url)),
};
```

`/Users/logankim/AI-Workspaces/omnis/vitest.workspace.ts`:
```ts
import { defineWorkspace } from "vitest/config";
import { omnisAlias } from "./vitest.shared.js";

export default defineWorkspace([
  {
    resolve: { alias: omnisAlias },
    test: {
      name: "unit",
      // 계약 §2: unit은 *.test.ts와 *.test.tsx를 둘 다 덮는다(packages/ui·apps/desktop의 tsx 테스트가
      // pnpm test에서 조용히 스킵되지 않도록). src/ 옆 테스트와 test/ 디렉터리 테스트를 모두 수집한다.
      include: [
        "packages/*/src/**/*.test.{ts,tsx}",
        "packages/*/test/**/*.test.{ts,tsx}",
        "packages/adapters/*/src/**/*.test.{ts,tsx}",
        "packages/adapters/*/test/**/*.test.{ts,tsx}",
        "apps/*/src/**/*.test.{ts,tsx}",
        "apps/*/test/**/*.test.{ts,tsx}",
      ],
      exclude: ["**/test/integration/**", "**/test/contract.test.ts", "**/node_modules/**", "**/dist/**"],
    },
  },
  {
    resolve: { alias: omnisAlias },
    test: { name: "contract", include: ["packages/adapters/*/test/contract.test.ts"] },
  },
  {
    resolve: { alias: omnisAlias },
    test: {
      name: "integration",
      include: ["packages/*/test/integration/**/*.test.ts", "apps/*/test/integration/**/*.test.ts"],
      globalSetup: ["./vitest.global-setup.ts"],
      fileParallelism: false,
      testTimeout: 20_000,
      hookTimeout: 60_000,
    },
  },
]);
```

> `vitest.global-setup.ts`는 Task 2가 만든다. Task 1에서는 `integration` 프로젝트에 매칭되는 파일이 없으므로 참조돼도 실행되지 않는다.

- [ ] 3. `@omnis/db` 패키지 골격을 만든다.

`/Users/logankim/AI-Workspaces/omnis/packages/db/package.json`:
```json
{
  "name": "@omnis/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": {
    "build": "tsc --build",
    "test": "vitest run",
    "test:integration": "vitest run test/integration",
    "migrate": "tsx src/cli/migrate.ts",
    "migrate:create": "tsx src/cli/create.ts"
  },
  "dependencies": { "pg": "8.13.1" },
  "devDependencies": { "@types/pg": "8.11.10", "tsx": "4.19.2" }
}
```

> `migrate`/`migrate:create`가 가리키는 CLI 파일은 Task 2가 만든다. Task 1에서는 스크립트만 선언돼 있고 실행하지 않는다 — 루트 `pnpm db:migrate`가 `pnpm --filter @omnis/db migrate`로 위임하므로(계약 §2) 이름을 여기서 미리 고정해 둔다.

`/Users/logankim/AI-Workspaces/omnis/packages/db/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

`/Users/logankim/AI-Workspaces/omnis/packages/db/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import { omnisAlias } from "../../vitest.shared.js";

export default defineConfig({
  resolve: { alias: omnisAlias },
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["../../vitest.global-setup.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
```

- [ ] 4. 실패하는 테스트를 쓴다. `/Users/logankim/AI-Workspaces/omnis/packages/db/test/pool.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MIGRATIONS_DIR, NOTIFY_CHANNELS, createPool } from "@omnis/db";

describe("createPool", () => {
  it("throws when DATABASE_URL is missing", () => {
    expect(() => createPool({})).toThrow(/DATABASE_URL/);
  });

  it("uses the given env and tags the connection", async () => {
    const pool = createPool({ DATABASE_URL: "postgres://nobody@127.0.0.1:5432/nothing" });
    try {
      expect(pool.options.max).toBe(10);
      expect(pool.options.application_name).toBe("omnis-hub");
    } finally {
      await pool.end();
    }
  });
});

describe("constants", () => {
  it("points MIGRATIONS_DIR at packages/db/migrations", () => {
    expect(MIGRATIONS_DIR.endsWith("/packages/db/migrations")).toBe(true);
  });

  it("lists the 7 NOTIFY channels from A3 §6.2", () => {
    expect([...NOTIFY_CHANNELS]).toEqual([
      "omnis_item",
      "omnis_thread",
      "omnis_approval",
      "omnis_task",
      "omnis_session",
      "omnis_job",
      "omnis_control",
    ]);
  });
});
```

- [ ] 5. 의존성을 설치하고 테스트를 돌려 실패를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm install && pnpm --filter @omnis/db test
```
기대 실패: `Failed to resolve import "@omnis/db"` 또는 `Cannot find module .../packages/db/src/index.ts`.

- [ ] 6. 최소 구현을 쓴다. `/Users/logankim/AI-Workspaces/omnis/packages/db/src/index.ts`:

```ts
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";

export { Pool, type PoolClient } from "pg";

/** packages/db/migrations 절대경로. src 실행(vitest)과 dist 실행(hub) 양쪽에서 같은 곳을 가리킨다. */
export const MIGRATIONS_DIR: string = fileURLToPath(new URL("../migrations", import.meta.url));

/** A3 §6.2. 페이로드는 id만, 8,000B 한도. */
export const NOTIFY_CHANNELS: readonly string[] = [
  "omnis_item",
  "omnis_thread",
  "omnis_approval",
  "omnis_task",
  "omnis_session",
  "omnis_job",
  "omnis_control",
] as const;

export function createPool(env: NodeJS.ProcessEnv = process.env): Pool {
  const connectionString = env.DATABASE_URL;
  if (connectionString === undefined || connectionString === "") {
    throw new Error("DATABASE_URL is required (계약 §9)");
  }
  return new Pool({ connectionString, max: 10, application_name: "omnis-hub" });
}

export async function query<T>(
  c: Pool | PoolClient,
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await c.query(sql, params as unknown[]);
  return result.rows as T[];
}

export async function one<T>(
  c: Pool | PoolClient,
  sql: string,
  params: readonly unknown[] = [],
): Promise<T> {
  const rows = await query<T>(c, sql, params);
  const row = rows[0];
  if (rows.length !== 1 || row === undefined) {
    throw new Error(`expected exactly 1 row, got ${rows.length}`);
  }
  return row;
}

export async function tx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
```

- [ ] 7. 테스트를 돌려 통과를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/db test
```
기대: `Test Files  1 passed (1)` / `Tests  4 passed (4)`.

- [ ] 8. 타입체크와 린트를 돌린다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm typecheck && pnpm lint
```
기대: 둘 다 에러 0.

- [ ] 9. 커밋한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-A01: packages/db 스캐폴드와 타입드 쿼리 헬퍼

- pnpm workspaces + tsconfig.base.json(strict/noUncheckedIndexedAccess/exactOptionalPropertyTypes)
- Biome 단일 린터, vitest 프로젝트 unit/contract/integration
- @omnis/db: createPool/query/one/tx/MIGRATIONS_DIR/NOTIFY_CHANNELS
- pnpm --filter @omnis/db test 통과

Implemented-by: DeepSeek V4.1 Flash

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 2: migrate-runner (US-A01, tier: DeepSeek)

**스토리 US-A01** (계속) — 산출물 `packages/db/src/migrate.ts` + `_omnis_migrations` 부트스트랩. 검증 명령 `pnpm --filter @omnis/db test`. A3 §8의 러너 코드가 단일 소스이고 이 태스크는 그것을 `migrate(pool, dir)` 시그니처로 옮겨 적는다.

**읽을 곳**: A3 §8(러너 코드 전문, 검증 규칙), 계약 §4(`migrate()` 의미 문단 — 부트스트랩 → advisory lock 8931447 → 정렬 → sha256 비교 → `.noxact.sql` 예외 → insert → finally unlock), 계약 §2(통합 테스트 DB 문단).

**만들지 않을 것(YAGNI)**: 롤백(forward-only, A3-D9), 마이그레이션 생성 템플릿의 화려한 스캐폴딩(파일 하나 touch면 충분), 드라이런 모드, 마이그레이션 잠금 타임아웃 설정.

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/packages/db/src/migrate.ts`, `/Users/logankim/AI-Workspaces/omnis/packages/db/src/cli/migrate.ts`, `/Users/logankim/AI-Workspaces/omnis/packages/db/src/cli/create.ts`, `/Users/logankim/AI-Workspaces/omnis/packages/db/migrations/.gitkeep`, `/Users/logankim/AI-Workspaces/omnis/vitest.global-setup.ts`
- Modify: `/Users/logankim/AI-Workspaces/omnis/packages/db/src/index.ts`
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/db/test/integration/migrate.test.ts`

**Interfaces:**
- Consumes: `createPool`, `query`, `MIGRATIONS_DIR` (Task 1).
- Produces: `migrate(pool: Pool, dir: string): Promise<{ applied: string[] }>` · `class MigrationError extends Error` (`name === "MigrationError"`, 계약 §9) — 둘 다 `@omnis/db` re-export.

### Steps

- [ ] 1. 테스트 DB를 만든다. 로컬 네이티브 Postgres 17 전제(계약 §2: 컨테이너 없음).

```bash
dropdb --if-exists omnis_test && createdb omnis_test && psql -d omnis_test -c 'SELECT version()'
```
기대: `PostgreSQL 17.x ...` 한 줄.

- [ ] 2. integration 프로젝트의 globalSetup을 만든다. 리셋 전략은 계약 §2 그대로 `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` → `migrate(pool, MIGRATIONS_DIR)` 하나뿐이다(파일별 트랜잭션 롤백은 쓰지 않는다 — 트리거와 NOTIFY를 검증해야 한다).

`/Users/logankim/AI-Workspaces/omnis/vitest.global-setup.ts`:
```ts
import { Client } from "pg";

const DEFAULT_URL = "postgres://logan@127.0.0.1:5432/omnis_test";

export default async function setup(): Promise<void> {
  const url = process.env.DATABASE_URL ?? DEFAULT_URL;
  if (!/omnis_test/.test(url)) {
    throw new Error(`refusing to wipe a database that is not omnis_test: ${url}`);
  }
  process.env.DATABASE_URL = url;

  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query("DROP SCHEMA IF EXISTS public CASCADE");
  await c.query("CREATE SCHEMA public");
  await c.end();

  const { createPool, migrate, MIGRATIONS_DIR } = await import("./packages/db/src/index.js");
  const pool = createPool();
  try {
    await migrate(pool, MIGRATIONS_DIR);
  } finally {
    await pool.end();
  }
}
```

> `DROP SCHEMA public CASCADE`는 확장(`vector` 등)과 `_omnis_migrations`까지 같이 지운다. 역할(`omnis_owner`/`omnis_hub`/`omnis_sync`)은 클러스터 전역이라 살아남으므로 `0001_extensions.sql`은 반드시 idempotent해야 한다(Task 3).

- [ ] 3. 실패하는 통합 테스트를 쓴다. `/Users/logankim/AI-Workspaces/omnis/packages/db/test/integration/migrate.test.ts`:

```ts
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MigrationError, createPool, migrate, query } from "@omnis/db";

let pool: Pool;
beforeAll(() => {
  pool = createPool();
});
afterAll(async () => {
  await pool.end();
});

async function fixtureDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "omnis-mig-"));
  for (const [name, body] of Object.entries(files)) {
    await writeFile(join(dir, name), body, "utf8");
  }
  return dir;
}

describe("migrate", () => {
  it("applies files in order, records sha, and is a no-op on the second run", async () => {
    await query(pool, "DROP TABLE IF EXISTS mig_b, mig_a");
    await query(pool, "DELETE FROM _omnis_migrations WHERE name LIKE '9%'").catch(() => undefined);
    const dir = await fixtureDir({
      "9001_a.sql": "CREATE TABLE mig_a (id int);",
      "9002_b.sql": "CREATE TABLE mig_b (id int REFERENCES mig_a(id));",
    });

    const first = await migrate(pool, dir);
    expect(first.applied).toEqual(["9001_a.sql", "9002_b.sql"]);

    const second = await migrate(pool, dir);
    expect(second.applied).toEqual([]);

    const rows = await query<{ name: string; sha: string }>(
      pool,
      "SELECT name, sha FROM _omnis_migrations WHERE name LIKE '9%' ORDER BY name",
    );
    expect(rows.map((r) => r.name)).toEqual(["9001_a.sql", "9002_b.sql"]);
    expect(rows[0]?.sha).toMatch(/^[0-9a-f]{64}$/);
  });

  it("throws MigrationError when an applied file changed", async () => {
    await query(pool, "DROP TABLE IF EXISTS mig_c");
    await query(pool, "DELETE FROM _omnis_migrations WHERE name = '9003_c.sql'");
    const dir = await fixtureDir({ "9003_c.sql": "CREATE TABLE mig_c (id int);" });
    await migrate(pool, dir);

    await writeFile(join(dir, "9003_c.sql"), "CREATE TABLE mig_c (id int, extra text);", "utf8");
    await expect(migrate(pool, dir)).rejects.toThrow(MigrationError);
    await expect(migrate(pool, dir)).rejects.toThrow(/changed after apply/);
  });

  it("rolls the whole file back when one statement fails", async () => {
    await query(pool, "DROP TABLE IF EXISTS mig_d");
    await query(pool, "DELETE FROM _omnis_migrations WHERE name = '9004_d.sql'");
    const dir = await fixtureDir({
      "9004_d.sql": "CREATE TABLE mig_d (id int); SELECT 1/0;",
    });
    await expect(migrate(pool, dir)).rejects.toThrow();

    const left = await query<{ n: string }>(pool, "SELECT to_regclass('public.mig_d')::text AS n");
    expect(left[0]?.n).toBeNull();
  });

  it("runs .noxact.sql outside a transaction", async () => {
    await query(pool, "DROP TABLE IF EXISTS mig_e");
    await query(pool, "DELETE FROM _omnis_migrations WHERE name LIKE '9005%'");
    const dir = await fixtureDir({
      "9005_e.sql": "CREATE TABLE mig_e (id int);",
      "9006_e_idx.noxact.sql": "CREATE INDEX CONCURRENTLY mig_e_idx ON mig_e (id);",
    });
    const out = await migrate(pool, dir);
    expect(out.applied).toEqual(["9005_e.sql", "9006_e_idx.noxact.sql"]);
  });
});
```

- [ ] 4. 테스트를 돌려 실패를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/db test
```
기대 실패: `No "migrate" export is defined on the "@omnis/db" mock` 계열 — 실제로는 `SyntaxError: The requested module ... does not provide an export named 'migrate'`.

- [ ] 5. 러너를 쓴다. `/Users/logankim/AI-Workspaces/omnis/packages/db/src/migrate.ts`:

```ts
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Pool } from "pg";

/** omnis migration advisory lock (A3 §8). */
const LOCK = 8_931_447;

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

export async function migrate(pool: Pool, dir: string): Promise<{ applied: string[] }> {
  const c = await pool.connect();
  const applied: string[] = [];
  try {
    await c.query(`CREATE TABLE IF NOT EXISTS _omnis_migrations (
      name text PRIMARY KEY,
      sha text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now())`);
    await c.query("SELECT pg_advisory_lock($1)", [LOCK]);
    try {
      const doneRes = await c.query<{ name: string; sha: string }>(
        "SELECT name, sha FROM _omnis_migrations",
      );
      const done = new Map(doneRes.rows.map((r) => [r.name, r.sha]));
      const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

      for (const f of files) {
        const sql = await readFile(join(dir, f), "utf8");
        const sha = createHash("sha256").update(sql).digest("hex");
        const prev = done.get(f);
        if (prev === sha) continue;
        if (prev !== undefined) {
          throw new MigrationError(`migration ${f} changed after apply (${prev} -> ${sha})`);
        }
        const inTx = !f.endsWith(".noxact.sql");
        if (inTx) await c.query("BEGIN");
        try {
          await c.query(sql);
          await c.query("INSERT INTO _omnis_migrations (name, sha) VALUES ($1, $2)", [f, sha]);
          if (inTx) await c.query("COMMIT");
          applied.push(f);
        } catch (e) {
          if (inTx) await c.query("ROLLBACK");
          throw e;
        }
      }
    } finally {
      await c.query("SELECT pg_advisory_unlock($1)", [LOCK]);
    }
  } finally {
    c.release();
  }
  return { applied };
}
```

- [ ] 6. `@omnis/db`에서 re-export한다. `/Users/logankim/AI-Workspaces/omnis/packages/db/src/index.ts` 맨 위 import 줄 바로 아래에 추가:

```ts
export { MigrationError, migrate } from "./migrate.js";
```

- [ ] 7. 빈 마이그레이션 디렉터리를 만든다(Task 3부터 채운다).

```bash
mkdir -p /Users/logankim/AI-Workspaces/omnis/packages/db/migrations && touch /Users/logankim/AI-Workspaces/omnis/packages/db/migrations/.gitkeep
```

- [ ] 8. 루트 스크립트가 물릴 CLI 두 개를 쓴다.

`/Users/logankim/AI-Workspaces/omnis/packages/db/src/cli/migrate.ts`:
```ts
import { MIGRATIONS_DIR, createPool } from "../index.js";
import { migrate } from "../migrate.js";

const pool = createPool();
try {
  const { applied } = await migrate(pool, MIGRATIONS_DIR);
  console.log(applied.length === 0 ? "up to date" : `applied ${applied.length}: ${applied.join(", ")}`);
} finally {
  await pool.end();
}
```

`/Users/logankim/AI-Workspaces/omnis/packages/db/src/cli/create.ts`:
```ts
import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MIGRATIONS_DIR } from "../index.js";

const name = process.argv[2];
if (name === undefined || !/^[a-z0-9_]+$/.test(name)) {
  throw new Error("usage: pnpm db:migrate:create <lower_snake_name>");
}
const existing = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
const last = existing.at(-1);
const nextNum = last === undefined ? 1 : Number(last.slice(0, 4)) + 1;
const file = join(MIGRATIONS_DIR, `${String(nextNum).padStart(4, "0")}_${name}.sql`);
await writeFile(file, `-- ${name}\n`, { flag: "wx" });
console.log(file);
```

- [ ] 9. 테스트를 돌려 통과를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/db test
```
기대: `Tests  8 passed (8)` (Task 1의 4개 + 이번 4개).

- [ ] 10. A3 §8이 정한 러너 전체 테스트, 즉 2연속 실행이 no-op인지 CLI로도 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && DATABASE_URL=postgres://logan@127.0.0.1:5432/omnis_test pnpm db:migrate && DATABASE_URL=postgres://logan@127.0.0.1:5432/omnis_test pnpm db:migrate
```
기대: 두 번 다 `up to date`(마이그레이션 파일이 아직 없으므로).

- [ ] 11. 커밋한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-A01: 마이그레이션 러너(advisory lock + sha256 비교, forward-only)

- migrate(pool, dir): _omnis_migrations 부트스트랩 → pg_advisory_lock(8931447) → 정렬 → sha 비교
- 적용된 파일이 바뀌면 MigrationError
- .noxact.sql은 트랜잭션 밖에서 실행(CREATE INDEX CONCURRENTLY용)
- pnpm db:migrate 2연속 실행이 no-op
- vitest globalSetup: DROP SCHEMA public CASCADE → migrate(MIGRATIONS_DIR)

Implemented-by: DeepSeek V4.1 Flash

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 3: ddl-0001-extensions (US-A02, tier: DeepSeek)

**스토리 US-A02** — 목표: DDL(A3-D9 `0001`~`0002`) / 산출물: `packages/db/migrations/0001_extensions.sql`, `packages/db/migrations/0002_core_inbox.sql` / 검증 명령: `pnpm db:migrate && pnpm --filter @omnis/db test` / 티어: DeepSeek(리뷰 Sonnet+). 의존: A01.

**읽을 곳**: A3 §1(규약 — 확장 3개, 역할 3개), A3 §8(파일 분할표 `0001` 행).

**만들지 않을 것(YAGNI)**: 역할별 세부 GRANT 매트릭스(A3가 정한 것만 — `0006`의 REVOKE/GRANT가 전부다), `uuidv7()` 대체 구현(A3-D1: 시간 정렬은 `(at, id)` 인덱스로 충분), `mem0` 스키마(폴백 경로 전용, Phase B).

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/packages/db/migrations/0001_extensions.sql`
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/db/test/integration/schema-0001.test.ts`

**Interfaces:**
- Consumes: `migrate`, `createPool`, `query`, `MIGRATIONS_DIR` (Task 1·2).
- Produces: 확장 `pgcrypto`/`vector`/`pg_trgm`, 역할 `omnis_owner`/`omnis_hub`/`omnis_sync`. SQL 심볼이라 TS export 없음.

### Steps

- [ ] 1. 실패하는 테스트를 쓴다. `/Users/logankim/AI-Workspaces/omnis/packages/db/test/integration/schema-0001.test.ts`:

```ts
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, query } from "@omnis/db";

let pool: Pool;
beforeAll(() => {
  pool = createPool();
});
afterAll(async () => {
  await pool.end();
});

describe("0001_extensions", () => {
  it("installs pgcrypto, vector and pg_trgm", async () => {
    const rows = await query<{ extname: string }>(
      pool,
      "SELECT extname FROM pg_extension WHERE extname = ANY($1) ORDER BY extname",
      [["pgcrypto", "pg_trgm", "vector"]],
    );
    expect(rows.map((r) => r.extname)).toEqual(["pg_trgm", "pgcrypto", "vector"]);
  });

  it("creates the three omnis roles and marks omnis_sync as a replication role", async () => {
    const rows = await query<{ rolname: string; rolreplication: boolean }>(
      pool,
      "SELECT rolname, rolreplication FROM pg_roles WHERE rolname LIKE 'omnis_%' ORDER BY rolname",
    );
    expect(rows.map((r) => r.rolname)).toEqual(["omnis_hub", "omnis_owner", "omnis_sync"]);
    expect(rows.find((r) => r.rolname === "omnis_sync")?.rolreplication).toBe(true);
  });

  it("gives gen_random_uuid() from pgcrypto", async () => {
    const rows = await query<{ id: string }>(pool, "SELECT gen_random_uuid()::text AS id");
    expect(rows[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
```

- [ ] 2. 테스트를 돌려 실패를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/db test
```
기대 실패: `expected [] to deeply equal [ 'pg_trgm', 'pgcrypto', 'vector' ]`.

- [ ] 3. `/Users/logankim/AI-Workspaces/omnis/packages/db/migrations/0001_extensions.sql`을 쓴다. `CREATE EXTENSION` 3줄은 A3 §1의 블록 그대로다. 역할 생성 DDL은 A3 §1이 "역할: `omnis_owner`(DDL·마이그레이션), `omnis_hub`(허브 프로세스, DML), `omnis_sync`(zero-cache, `REPLICATION` + SELECT)"로 책임만 정하고 SQL을 주지 않으므로 그 문장을 그대로 SQL로 옮긴다. 역할은 클러스터 전역이라 `DROP SCHEMA public CASCADE` 리셋에도 살아남는다 — 반드시 idempotent해야 한다.

```sql
-- 0001_extensions.sql
-- A3 §1 규약: 확장 3개 + 역할 3개. 역할은 클러스터 전역이므로 재실행 안전해야 한다.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omnis_owner') THEN
    CREATE ROLE omnis_owner NOLOGIN;        -- DDL·마이그레이션
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omnis_hub') THEN
    CREATE ROLE omnis_hub NOLOGIN;          -- 허브 프로세스, DML만
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omnis_sync') THEN
    CREATE ROLE omnis_sync NOLOGIN REPLICATION;   -- zero-cache: REPLICATION + SELECT
  ELSE
    ALTER ROLE omnis_sync REPLICATION;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO omnis_hub, omnis_sync;
```

> **복제 role은 `omnis_sync` 하나다.** zero-cache가 `ZERO_UPSTREAM_DB`로 붙을 때 쓰는 유저가 바로 `omnis_sync`이고, 논리 복제 슬롯도 이 role이 연다(A3 §1이 스키마 오너). 계약 §7이 적은 `zero_replication`은 같은 역할을 가리키는 옛 이름이므로 **쓰지 않는다** — `0001`에도, `0008`에도, `apps/hub` 어디에도 `zero_replication`이라는 이름은 등장하지 않는다.

- [ ] 4. 마이그레이션을 적용하고 테스트를 돌린다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/db test
```
기대: `Tests  11 passed (11)` (globalSetup이 `0001`을 적용한 뒤 3개가 새로 통과).

- [ ] 5. 개발 DB에도 적용해 A7 US-A02의 검증 명령 절반을 만족시킨다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && createdb omnis 2>/dev/null; DATABASE_URL=postgres://logan@127.0.0.1:5432/omnis pnpm db:migrate && DATABASE_URL=postgres://logan@127.0.0.1:5432/omnis pnpm db:migrate
```
기대: 첫 줄 `applied 1: 0001_extensions.sql`, 둘째 줄 `up to date`.

- [ ] 6. 커밋한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-A02: 0001_extensions.sql — pgcrypto/vector/pg_trgm + 역할 3개

- A3 §1 규약 그대로: CREATE EXTENSION 3개
- omnis_owner/omnis_hub/omnis_sync(REPLICATION) idempotent 생성
- pnpm db:migrate 2연속이 no-op

Implemented-by: DeepSeek V4.1 Flash

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 4: ddl-0002-core-inbox (US-A02, tier: DeepSeek)

**스토리 US-A02** (계속) — `0002_core_inbox.sql`은 A3 §8 표가 정한 9개 테이블 전부를 만든다: `accounts`, `account_secrets`, `persons`, `identities`, `person_merges`, `agent_runtimes`(+`omnis` 1 row seed), `threads`, `items`(+부분 HNSW), `calendar_events`.

**읽을 곳**: A3 §2(accounts/account_secrets/threads/items DDL 전문), A3 §2.1(calendar_events DDL + 조인 규칙), A3 §3(persons/identities/person_merges DDL), A3 §4(agent_runtimes DDL + 부분 유니크 인덱스 + seed), A3 §8(파일 순서 규칙 — "`person_merges`는 `persons`만 참조하므로 `0002`에, `calendar_events`는 `items`를 참조하므로 같은 `0002` 끝에").

**SQL은 A3에서 그대로 복사한다 — 바꿔 쓰지 않는다.** A3 §2의 읽기용 순서(items를 먼저 보여줌)와 달리 파일에서는 FK 대상이 먼저 온다: `accounts` → `account_secrets` → `threads` → `persons` → `identities` → `person_merges` → `agent_runtimes` → `items` → `calendar_events`. (A3 §2의 각주가 "실제 마이그레이션 파일에서는 그 두 테이블이 먼저 생성된다"라고 지시한 그대로다. `threads.participants`는 `uuid[]`이고 FK가 아니므로 `persons`보다 먼저 와도 된다.)

**만들지 않을 것(YAGNI)**: `items` 이외 테이블의 임베딩 컬럼, 한국어 형태소 분석기(A3 §1: v1에서 쓰지 않는다), person 해석 로직(A3 §10은 TS 쪽이고 Phase A 스토리에 없다), 파티셔닝(A3-D6).

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/packages/db/migrations/0002_core_inbox.sql`
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/db/test/integration/schema-0002.test.ts`

**Interfaces:**
- Consumes: `0001_extensions.sql`의 `pgcrypto`(`gen_random_uuid()`), `vector`, `pg_trgm`.
- Produces: 테이블 9개와 그 제약 이름 — `accounts_uq`, `accounts_channel_ck`, `accounts_state_ck`, `threads_uq`, `threads_kind_ck`, `threads_scope_ck`, `persons_rel_ck`, `identities_uq`, `identities_source_ck`, `person_merges_kind_ck`, `agent_runtimes_uq`, `agent_runtimes_runtime_ck`, `agent_runtimes_host_ck`, `agent_runtimes_state_ck`, `agent_runtimes_omnis_uq`, `items_kind_ck`, `items_status_ck`, `items_scope_ck`, `items_sensitivity_ck`, `items_author_ck`, `items_external_uq`, `items_source_hash_uq`, `items_idem_uq`, `items_embedding_idx`, `calendar_events_uq`, `calendar_events_status_ck`, `calendar_events_span_ck`. 뒤 태스크와 다른 계획이 이 이름들로 assertion을 건다.

### Steps

- [ ] 1. 실패하는 테스트를 쓴다. `/Users/logankim/AI-Workspaces/omnis/packages/db/test/integration/schema-0002.test.ts`:

```ts
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, one, query, tx } from "@omnis/db";

let pool: Pool;
beforeAll(() => {
  pool = createPool();
});
afterAll(async () => {
  await pool.end();
});

describe("0002_core_inbox", () => {
  it("creates the 9 tables A3 §8 assigns to this file", async () => {
    const rows = await query<{ table_name: string }>(
      pool,
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY($1) ORDER BY table_name`,
      [[
        "accounts",
        "account_secrets",
        "agent_runtimes",
        "calendar_events",
        "identities",
        "items",
        "person_merges",
        "persons",
        "threads",
      ]],
    );
    expect(rows).toHaveLength(9);
  });

  it("seeds exactly one omnis agent_runtime and refuses a second", async () => {
    const row = await one<{ host: string; state: string; n: string }>(
      pool,
      `SELECT host, state, (SELECT count(*) FROM agent_runtimes WHERE runtime = 'omnis')::text AS n
         FROM agent_runtimes WHERE runtime = 'omnis'`,
    );
    expect(row.n).toBe("1");
    expect(row.host).toBe("mini");
    expect(row.state).toBe("online");

    await expect(
      query(pool, "INSERT INTO agent_runtimes (runtime, host, display) VALUES ('omnis','macbook','dup')"),
    ).rejects.toThrow(/agent_runtimes_omnis_uq/);
  });

  it("rejects an item with both a person and an agent author (items_author_ck)", async () => {
    const ids = await tx(pool, async (c) => {
      const acc = await one<{ id: string }>(
        c,
        `INSERT INTO accounts (channel, external_id, display) VALUES ('slack','T1:U1','logan') RETURNING id`,
      );
      const thr = await one<{ id: string }>(
        c,
        `INSERT INTO threads (account_id, external_id, kind) VALUES ($1,'C1','dm') RETURNING id`,
        [acc.id],
      );
      const per = await one<{ id: string }>(
        c,
        `INSERT INTO persons (display_name) VALUES ('Someone') RETURNING id`,
      );
      const run = await one<{ id: string }>(c, `SELECT id FROM agent_runtimes WHERE runtime='omnis'`);
      return { accountId: acc.id, threadId: thr.id, personId: per.id, runtimeId: run.id };
    });

    await expect(
      query(
        pool,
        `INSERT INTO items (thread_id, account_id, kind, author_person_id, author_agent_id, sent_at)
         VALUES ($1,$2,'message',$3,$4, now())`,
        [ids.threadId, ids.accountId, ids.personId, ids.runtimeId],
      ),
    ).rejects.toThrow(/items_author_ck/);
  });

  it("generates search_tsv and enforces the source_hash idempotency index", async () => {
    const acc = await one<{ id: string }>(
      pool,
      `INSERT INTO accounts (channel, external_id, display) VALUES ('gmail','a@b.c','logan') RETURNING id`,
    );
    const thr = await one<{ id: string }>(
      pool,
      `INSERT INTO threads (account_id, external_id, kind) VALUES ($1,'t-1','email') RETURNING id`,
      [acc.id],
    );
    const item = await one<{ id: string; tsv: string }>(
      pool,
      `INSERT INTO items (thread_id, account_id, kind, subject, body, sent_at, source_hash)
       VALUES ($1,$2,'email','quarterly plan','ship the kernel', now(), 'hash-1')
       RETURNING id, search_tsv::text AS tsv`,
      [thr.id, acc.id],
    );
    expect(item.tsv).toContain("kernel");

    await expect(
      query(
        pool,
        `INSERT INTO items (thread_id, account_id, kind, body, sent_at, source_hash)
         VALUES ($1,$2,'email','dup', now(), 'hash-1')`,
        [thr.id, acc.id],
      ),
    ).rejects.toThrow(/items_source_hash_uq/);
  });

  it("stores a 768d embedding and indexes it with HNSW only when not null", async () => {
    const idx = await one<{ indexdef: string }>(
      pool,
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'items_embedding_idx'`,
    );
    expect(idx.indexdef).toContain("hnsw");
    expect(idx.indexdef).toContain("vector_cosine_ops");
    expect(idx.indexdef).toContain("WHERE (embedding IS NOT NULL)");
  });

  it("derives attendees_count and enforces calendar_events_span_ck", async () => {
    const acc = await one<{ id: string }>(
      pool,
      `INSERT INTO accounts (channel, external_id, display) VALUES ('gcal','cal-1','logan') RETURNING id`,
    );
    const thr = await one<{ id: string }>(
      pool,
      `INSERT INTO threads (account_id, external_id, kind) VALUES ($1,'cal-thread','calendar') RETURNING id`,
      [acc.id],
    );
    const item = await one<{ id: string }>(
      pool,
      `INSERT INTO items (thread_id, account_id, kind, subject, body, sent_at)
       VALUES ($1,$2,'event','standup','', now()) RETURNING id`,
      [thr.id, acc.id],
    );
    const ev = await one<{ attendees_count: number }>(
      pool,
      `INSERT INTO calendar_events (item_id, account_id, external_id, start_at, end_at, attendees)
       VALUES ($1,$2,'ev-1', now(), now() + interval '30 minutes',
               '[{"email":"a@b.c"},{"email":"d@e.f"}]'::jsonb)
       RETURNING attendees_count`,
      [item.id, acc.id],
    );
    expect(ev.attendees_count).toBe(2);

    await expect(
      query(
        pool,
        `INSERT INTO calendar_events (item_id, account_id, external_id, start_at, end_at)
         VALUES ($1,$2,'ev-2', now(), now() - interval '1 hour')`,
        [item.id, acc.id],
      ),
    ).rejects.toThrow(/calendar_events_span_ck|calendar_events_item_id_key/);
  });
});
```

- [ ] 2. 테스트를 돌려 실패를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/db test
```
기대 실패: `relation "accounts" does not exist`.

- [ ] 3. `/Users/logankim/AI-Workspaces/omnis/packages/db/migrations/0002_core_inbox.sql`을 쓴다. 아래 블록은 A3 §2·§2.1·§3·§4의 DDL을 FK 순서로 재배열한 것이고 컬럼·제약·인덱스는 한 글자도 바꾸지 않았다.

```sql
-- 0002_core_inbox.sql
-- A3 §8 표: accounts, account_secrets, persons, identities, person_merges,
--           agent_runtimes(+omnis seed), threads, items(+부분 HNSW), calendar_events
-- 순서는 FK 순서다(A3 §2 각주). A3 §2의 읽기용 순서와 다르다.

CREATE TABLE accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel       text NOT NULL,
  external_id   text NOT NULL,                 -- 채널 내 계정 식별자 (Slack team+user, 메일 주소 등)
  display       text NOT NULL,
  capabilities  jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {read,write,realtime,history,media,markRead,typing}
  state         text NOT NULL DEFAULT 'active',
  last_health_at timestamptz,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accounts_channel_ck CHECK (channel IN
    ('slack','gmail','outlook','gcal','telegram','whatsapp','kakaotalk','linkedin','agent','system')),
  CONSTRAINT accounts_state_ck CHECK (state IN ('active','paused','broken')),
  CONSTRAINT accounts_uq UNIQUE (channel, external_id)
);

-- A3-D4: 비밀은 별도 테이블. Zero publication에 절대 넣지 않는다.
CREATE TABLE account_secrets (
  account_id  uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  auth_ref    text NOT NULL,                   -- Keychain item 이름 (값이 아니다).
                                               -- 명명 규칙은 A1 소유: omnis.<channel>.<kind>.<external_id>
  scopes      text[] NOT NULL DEFAULT '{}',
  expires_at  timestamptz,
  rotated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE threads (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  external_id   text NOT NULL,
  kind          text NOT NULL,
  title         text,
  scope         text NOT NULL DEFAULT 'unknown',
  participants  uuid[] NOT NULL DEFAULT '{}',  -- persons.id
  meta          jsonb NOT NULL DEFAULT '{}'::jsonb,  -- 예약 키: meta.pending_next_step (A4 §7.3)
  last_item_at  timestamptz,
  unread_count  integer NOT NULL DEFAULT 0,
  needs_action  boolean NOT NULL DEFAULT false,
  archived_at   timestamptz,
  muted_until   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT threads_kind_ck CHECK (kind IN ('dm','group','email','agent_session','calendar','system')),
  CONSTRAINT threads_scope_ck CHECK (scope IN ('work','personal','unknown')),
  CONSTRAINT threads_uq UNIQUE (account_id, external_id)
);

CREATE INDEX threads_inbox_idx ON threads (last_item_at DESC)
  WHERE archived_at IS NULL;
CREATE INDEX threads_scope_idx ON threads (scope, last_item_at DESC)
  WHERE archived_at IS NULL;
CREATE INDEX threads_participants_idx ON threads USING gin (participants);

CREATE TABLE persons (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name       text NOT NULL,
  org                text,
  role               text,
  relationship_state text NOT NULL DEFAULT 'unknown',
  vip                boolean NOT NULL DEFAULT false,
  notes              text,
  first_contact_at   timestamptz,          -- A4 §7.2 초면 판정
  last_contact_at    timestamptz,
  next_followup_at   timestamptz,
  item_count         integer NOT NULL DEFAULT 0,
  primary_thread_id  uuid REFERENCES threads(id) ON DELETE SET NULL,  -- A4 §7.3 cadence 조인 대상
  cadence_days       integer,              -- NULL이면 relationship_state 기본값 (A4 §7.3)
  priority_score     real NOT NULL DEFAULT 0,
  merged_into        uuid REFERENCES persons(id) ON DELETE SET NULL,  -- tombstone
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT persons_rel_ck CHECK (relationship_state IN
    ('unknown','new','warming','active','dormant','closed'))
);
CREATE INDEX persons_followup_idx ON persons (next_followup_at)
  WHERE merged_into IS NULL AND next_followup_at IS NOT NULL;
CREATE INDEX persons_name_trgm_idx ON persons USING gin (display_name gin_trgm_ops);
CREATE INDEX persons_cadence_idx ON persons (priority_score DESC)
  WHERE merged_into IS NULL AND relationship_state IN ('warming','active');

CREATE TABLE identities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id   uuid NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  channel     text NOT NULL,
  handle      text NOT NULL,              -- 원본 표기
  handle_norm text NOT NULL,              -- 정규화 키 (A3 §10)
  display     text,
  verified    boolean NOT NULL DEFAULT false,
  source      text NOT NULL DEFAULT 'adapter',
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT identities_source_ck CHECK (source IN ('adapter','manual','agent')),
  CONSTRAINT identities_uq UNIQUE (channel, handle_norm)
);
CREATE INDEX identities_person_idx ON identities (person_id);

CREATE TABLE person_merges (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind           text NOT NULL,                 -- 'merge' | 'split'
  from_person_id uuid NOT NULL,
  to_person_id   uuid NOT NULL,
  identity_ids   uuid[] NOT NULL DEFAULT '{}',  -- split일 때 옮긴 identity
  reason         text,
  at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT person_merges_kind_ck CHECK (kind IN ('merge','split'))
);

CREATE TABLE agent_runtimes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  runtime      text NOT NULL,
  host         text NOT NULL,                  -- 'mini' | 'macbook'
  display      text NOT NULL,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,   -- 브리지 자기기술 (마스터 D5)
  version      text,
  state        text NOT NULL DEFAULT 'offline',
  last_seen_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_runtimes_runtime_ck CHECK (runtime IN
    ('claude_code','codex','claude_ds','hermes','omnis')),
  CONSTRAINT agent_runtimes_host_ck CHECK (host IN ('mini','macbook')),
  CONSTRAINT agent_runtimes_state_ck CHECK (state IN ('offline','online','degraded')),
  CONSTRAINT agent_runtimes_uq UNIQUE (runtime, host)
);

-- `omnis`는 유효한 runtime 값이지만 브리지 어댑터가 없는 특수 row다(마스터 §6, 99-review §4-8).
CREATE UNIQUE INDEX agent_runtimes_omnis_uq ON agent_runtimes (runtime)
  WHERE runtime = 'omnis';

INSERT INTO agent_runtimes (runtime, host, display, state)
  VALUES ('omnis', 'mini', 'omnis agents', 'online');

CREATE TABLE items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id        uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  external_id      text,                        -- draft는 NULL (아직 채널에 없음)
  kind             text NOT NULL,
  status           text NOT NULL DEFAULT 'received',
  scope            text NOT NULL DEFAULT 'unknown',
  sensitivity      text NOT NULL DEFAULT 'normal',   -- A4 L1이 유일한 생산자 (A4 §2.4, A4-D12)
  author_person_id uuid REFERENCES persons(id) ON DELETE SET NULL,
  author_agent_id  uuid REFERENCES agent_runtimes(id) ON DELETE SET NULL,
  author_is_me     boolean NOT NULL DEFAULT false,
  in_reply_to      uuid REFERENCES items(id) ON DELETE SET NULL,
  subject          text,
  body             text NOT NULL DEFAULT '',
  body_html        text,
  attachments      jsonb NOT NULL DEFAULT '[]'::jsonb,
  tool             jsonb,                       -- kind='tool_call'일 때 {name,args,state,label,icon}
  sent_at          timestamptz NOT NULL,
  received_at      timestamptz NOT NULL DEFAULT now(),
  source_hash      text,                        -- 어댑터 멱등성 키
  idempotency_key  text,                        -- 발송 멱등성 키 (A3-D10)
  outbox_claimed_at timestamptz,                -- 발송 워커의 at-most-once claim
  fail_reason      text,
  meta             jsonb NOT NULL DEFAULT '{}'::jsonb,
  embedding        vector(768),                 -- nomic-embed-text-v1.5. A4 §2.2 kNN의 입력
  search_tsv       tsvector GENERATED ALWAYS AS
                     (to_tsvector('simple', coalesce(subject,'') || ' ' || coalesce(body,''))) STORED,
  CONSTRAINT items_kind_ck CHECK (kind IN ('message','email','event','agent_turn','tool_call','system')),
  CONSTRAINT items_status_ck CHECK (status IN
    ('received','read','draft','approved','sent','failed','archived')),
  CONSTRAINT items_scope_ck CHECK (scope IN ('work','personal','unknown')),
  CONSTRAINT items_sensitivity_ck CHECK (sensitivity IN
    ('normal','personal','finance','legal','health')),
  CONSTRAINT items_author_ck CHECK (num_nonnulls(author_person_id, author_agent_id) <= 1)
);

CREATE UNIQUE INDEX items_external_uq ON items (account_id, external_id)
  WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX items_source_hash_uq ON items (account_id, source_hash)
  WHERE source_hash IS NOT NULL;
CREATE UNIQUE INDEX items_idem_uq ON items (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX items_thread_idx ON items (thread_id, sent_at DESC);
CREATE INDEX items_pending_idx ON items (status, sent_at DESC)
  WHERE status IN ('draft','approved','failed');
CREATE INDEX items_search_idx ON items USING gin (search_tsv);
CREATE INDEX items_body_trgm_idx ON items USING gin (body gin_trgm_ops);

-- 임베딩이 있는 item만 인덱싱한다.
CREATE INDEX items_embedding_idx ON items
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)   -- 파라미터 근거: UNVERIFIED — spike (A3 §14 S-A3-7)
  WHERE embedding IS NOT NULL;

-- A3 §2.1: items(kind='event')=인박스 투영, calendar_events=상세.
CREATE TABLE calendar_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id      uuid NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE,  -- 조인 규칙
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  external_id  text NOT NULL,              -- Google/Graph의 event id
  start_at     timestamptz NOT NULL,
  end_at       timestamptz NOT NULL,
  all_day      boolean NOT NULL DEFAULT false,
  status       text NOT NULL DEFAULT 'confirmed',
  attendees    jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{email, display, response, person_id}]
  attendees_count integer GENERATED ALWAYS AS (jsonb_array_length(attendees)) STORED,
  location     text,
  recurrence   text,                       -- RRULE 원문. 전개는 하지 않는다
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calendar_events_status_ck CHECK (status IN ('confirmed','tentative','cancelled')),
  CONSTRAINT calendar_events_uq UNIQUE (account_id, external_id),
  CONSTRAINT calendar_events_span_ck CHECK (end_at >= start_at)
);
CREATE INDEX calendar_events_start_idx ON calendar_events (start_at);
CREATE INDEX calendar_events_end_idx   ON calendar_events (end_at)
  WHERE status <> 'cancelled';
```

- [ ] 4. 테스트를 돌려 통과를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/db test
```
기대: `Tests  17 passed (17)`.

- [ ] 5. US-A02 검증 명령을 그대로 돌린다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && DATABASE_URL=postgres://logan@127.0.0.1:5432/omnis pnpm db:migrate && pnpm --filter @omnis/db test
```
기대: `applied 1: 0002_core_inbox.sql` 후 테스트 전부 통과.

- [ ] 6. 커밋한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-A02: 0002_core_inbox.sql — 인박스 코어 9개 테이블

- accounts/account_secrets/threads/persons/identities/person_merges/agent_runtimes/items/calendar_events
- items: author 3컬럼(items_author_ck), sensitivity, embedding vector(768) + 부분 HNSW, search_tsv 생성 컬럼
- agent_runtimes: omnis 1 row seed + agent_runtimes_omnis_uq 부분 유니크
- calendar_events: attendees_count 생성 컬럼 + span CHECK
- pnpm db:migrate && pnpm --filter @omnis/db test 통과

Implemented-by: DeepSeek V4.1 Flash

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 5: ddl-0003-labels (US-A03, tier: DeepSeek)

**스토리 US-A03** — 목표: DDL(A3-D9 `0003`~`0004`) — `0003_labels.sql`(`labels`/`label_rules`/`item_labels`/`thread_labels`) + `0004_tasks_approvals.sql`(`agent_sessions`/`tasks`/`pending_approvals`/`notes`/`digests`/`agent_runs`) / 검증 명령: `pnpm db:migrate && pnpm --filter @omnis/db test` / 티어: DeepSeek(리뷰 Sonnet+). 의존: A02.

**읽을 곳**: A3 §3(labels/label_rules/item_labels/thread_labels DDL 전문 + A4 §2.3 표기 대응표), A3 §1.1(`labels.kind`, `label_rules.tier` 값 집합), A3 §7(`label_rules`의 `probe_embedding`은 Zero 복제 제외 — 이 파일이 아니라 `0008`이 처리).

**만들지 않을 것(YAGNI)**: 규칙 컴파일러(A4 §2.3, Phase A 스토리 아님), `probe_embedding`의 HNSW 인덱스(A3가 `label_rules`에는 인덱스를 `label_rules_active_idx` 하나만 정했다 — 규칙은 수십 개 규모라 kNN 인덱스가 필요 없다), 라벨 시드 데이터.

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/packages/db/migrations/0003_labels.sql`
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/db/test/integration/schema-0003.test.ts`

**Interfaces:**
- Consumes: `0002`의 `persons`, `items`, `threads`.
- Produces: 제약 이름 `labels_kind_ck`, `labels_uq`, `label_rules_tier_ck`, `item_labels_by_ck`, `thread_labels_by_ck`와 인덱스 `label_rules_active_idx`, `item_labels_label_idx`, `thread_labels_label_idx`.

### Steps

- [ ] 1. 실패하는 테스트를 쓴다. `/Users/logankim/AI-Workspaces/omnis/packages/db/test/integration/schema-0003.test.ts`:

```ts
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, one, query } from "@omnis/db";

let pool: Pool;
beforeAll(() => {
  pool = createPool();
});
afterAll(async () => {
  await pool.end();
});

describe("0003_labels", () => {
  it("enforces labels_kind_ck and the (kind, name) unique key", async () => {
    await one<{ id: string }>(
      pool,
      `INSERT INTO labels (name, kind) VALUES ('work','scope') RETURNING id`,
    );
    await expect(
      query(pool, `INSERT INTO labels (name, kind) VALUES ('work','scope')`),
    ).rejects.toThrow(/labels_uq/);
    await expect(
      query(pool, `INSERT INTO labels (name, kind) VALUES ('nope','not-a-kind')`),
    ).rejects.toThrow(/labels_kind_ck/);
  });

  it("stores a label_rule with uuid arrays and a 768d probe embedding", async () => {
    const label = await one<{ id: string }>(
      pool,
      `INSERT INTO labels (name, kind) VALUES ('invoices','topic') RETURNING id`,
    );
    const rule = await one<{ tier: string; active: boolean; positives: string[] }>(
      pool,
      `INSERT INTO label_rules (label_id, prompt, probe_embedding)
       VALUES ($1, '청구서가 첨부된 메일', $2::vector)
       RETURNING tier, active, positives`,
      [label.id, `[${new Array(768).fill(0).join(",")}]`],
    );
    expect(rule.tier).toBe("T0");
    expect(rule.active).toBe(true);
    expect(rule.positives).toEqual([]);

    await expect(
      query(pool, `INSERT INTO label_rules (label_id, prompt, tier) VALUES ($1,'x','T9')`, [label.id]),
    ).rejects.toThrow(/label_rules_tier_ck/);
  });

  it("uses composite primary keys on item_labels and thread_labels and restricts `by`", async () => {
    const cols = await query<{ table_name: string; column_name: string }>(
      pool,
      `SELECT kcu.table_name, kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_name IN ('item_labels','thread_labels')
        ORDER BY kcu.table_name, kcu.column_name`,
    );
    expect(cols.map((c) => `${c.table_name}.${c.column_name}`)).toEqual([
      "item_labels.item_id",
      "item_labels.label_id",
      "thread_labels.label_id",
      "thread_labels.thread_id",
    ]);

    const label = await one<{ id: string }>(
      pool,
      `INSERT INTO labels (name, kind) VALUES ('urgent','priority') RETURNING id`,
    );
    const thread = await one<{ id: string }>(pool, `SELECT id FROM threads LIMIT 1`);
    await expect(
      query(pool, `INSERT INTO thread_labels (thread_id, label_id, by) VALUES ($1,$2,'robot')`, [
        thread.id,
        label.id,
      ]),
    ).rejects.toThrow(/thread_labels_by_ck/);
  });
});
```

- [ ] 2. 테스트를 돌려 실패를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/db test
```
기대 실패: `relation "labels" does not exist`.

- [ ] 3. `/Users/logankim/AI-Workspaces/omnis/packages/db/migrations/0003_labels.sql`을 쓴다 — A3 §3의 뒤쪽 블록 그대로다.

```sql
-- 0003_labels.sql
-- A3 §3: labels, label_rules, item_labels, thread_labels

CREATE TABLE labels (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  kind       text NOT NULL,
  color      text,
  rule       text,                          -- 자연어 규칙 (Superhuman Auto Labels 방식)
  rule_model text,
  person_id  uuid REFERENCES persons(id) ON DELETE CASCADE,  -- kind='person'
  archived   boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT labels_kind_ck CHECK (kind IN ('scope','topic','priority','person')),
  CONSTRAINT labels_uq UNIQUE (kind, name)
);

-- 자연어 라벨 규칙 (A4 §2.3). A4 표기 대응: compiled→rule, compiled_by→rule_by,
-- compiled_at→rule_at, corrections→corrections_30d. positives/negatives는 uuid[](items.id).
CREATE TABLE label_rules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label_id       uuid NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  prompt         text NOT NULL,                    -- 사용자가 적은 원문 (SSOT)
  rule           jsonb NOT NULL DEFAULT '{}'::jsonb, -- 컴파일 결과 CompiledRule (A4 §2.3)
  rule_by        text,                             -- 'claude-sonnet-5' | 'user'
  rule_at        timestamptz,
  probe_embedding vector(768),                     -- CompiledRule.semantic 임베딩 (A4 §2.3 kNN 폴백)
  tier           text NOT NULL DEFAULT 'T0',
  positives      uuid[] NOT NULL DEFAULT '{}',     -- items.id
  negatives      uuid[] NOT NULL DEFAULT '{}',
  hits_30d       integer NOT NULL DEFAULT 0,
  corrections_30d integer NOT NULL DEFAULT 0,
  pinned_by_user boolean NOT NULL DEFAULT false,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT label_rules_tier_ck CHECK (tier IN ('T0','T1'))
);
CREATE INDEX label_rules_active_idx ON label_rules (label_id) WHERE active;

CREATE TABLE item_labels (
  item_id    uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  label_id   uuid NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  confidence real,
  by         text NOT NULL DEFAULT 'agent',   -- 'agent' | 'me' | 'rule'
  at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT item_labels_by_ck CHECK (by IN ('agent','me','rule')),
  PRIMARY KEY (item_id, label_id)
);
CREATE INDEX item_labels_label_idx ON item_labels (label_id);

CREATE TABLE thread_labels (
  thread_id  uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  label_id   uuid NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  confidence real,
  by         text NOT NULL DEFAULT 'agent',
  at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT thread_labels_by_ck CHECK (by IN ('agent','me','rule')),
  PRIMARY KEY (thread_id, label_id)
);
CREATE INDEX thread_labels_label_idx ON thread_labels (label_id);
```

- [ ] 4. 테스트를 돌려 통과를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/db test
```
기대: `Tests  20 passed (20)`.

- [ ] 5. 커밋한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-A03: 0003_labels.sql — labels/label_rules/item_labels/thread_labels

- label_rules는 A4가 갖고 있던 DDL을 A3 표기(rule/rule_by/rule_at/corrections_30d)로 편입, id·label_id는 uuid
- item_labels/thread_labels는 (item|thread, label) 복합 PK + by CHECK
- pnpm db:migrate && pnpm --filter @omnis/db test 통과

Implemented-by: DeepSeek V4.1 Flash

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 6: ddl-0004-tasks-approvals (US-A03, tier: DeepSeek)

**스토리 US-A03** (계속) — `0004_tasks_approvals.sql`: `agent_sessions`, `agent_runs`, `tasks`, `pending_approvals`, `notes`, `digests`. `agent_runs`는 마스터 §6·A4-D16이 "평가·비용·감사의 단일 소스"로 못박은 테이블이다.

**읽을 곳**: A3 §4 전체(DDL 6개 + A4 §1.7 대응표), A3 §1.1(`tasks.state`/`tasks.kind`/`agent_runs.model_tier`/`agent_runs.outcome`/`agent_sessions.state`/`pending_approvals.action`·`state`·`decision` 값 집합), A3 §8(`agent_runs`가 `agent_sessions`와 `items` 둘 다 참조하므로 `0004`에 온다), 계약 §0-6(`action`은 A3의 6값이 이긴다).

**주의 — `approvals_decided_ck`의 실질적 의미**: `CHECK ((state = 'pending') = (decision IS NULL))`는 `state`가 `pending`이 아닌 모든 row에 non-NULL `decision`을 요구한다. `expired`도 예외가 아니다. Task 18이 이 제약을 만족시키는 방법(만료 시 `decision='ignore'`)을 정하므로 여기서는 A3 SQL을 그대로 적고 바꾸지 않는다.

**만들지 않을 것(YAGNI)**: 승인 실행기(Task 22), 다이제스트 생성기(Phase B), `agent_runs` 집계 뷰(비용 리포트는 Phase B), `tasks`의 반복 규칙.

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/packages/db/migrations/0004_tasks_approvals.sql`
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/db/test/integration/schema-0004.test.ts`

**Interfaces:**
- Consumes: `0002`의 `agent_runtimes`, `threads`, `items`, `persons`.
- Produces: 제약 이름 `agent_sessions_state_ck`, `agent_sessions_uq`, `agent_runs_tier_ck`, `agent_runs_outcome_ck`, `tasks_kind_ck`, `tasks_state_ck`, `tasks_owner_ck`, `approvals_action_ck`, `approvals_state_ck`, `approvals_decision_ck`, `approvals_risk_ck`, `approvals_decided_ck`, `notes_route_state_ck`, `digests_kind_ck`, `digests_uq`. Task 16~18과 `apps/hub`가 이 이름으로 실패를 식별한다.

### Steps

- [ ] 1. 실패하는 테스트를 쓴다. `/Users/logankim/AI-Workspaces/omnis/packages/db/test/integration/schema-0004.test.ts`:

```ts
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, one, query } from "@omnis/db";

let pool: Pool;
beforeAll(() => {
  pool = createPool();
});
afterAll(async () => {
  await pool.end();
});

describe("0004_tasks_approvals", () => {
  it("accepts the 6 approval actions from A3 §1.1 and rejects anything else", async () => {
    for (const action of [
      "send",
      "delete",
      "calendar_write",
      "delegate",
      "self_model_edit",
      "memory_write",
    ]) {
      const row = await one<{ state: string; risk: string; config: Record<string, boolean> }>(
        pool,
        `INSERT INTO pending_approvals (action, args, description)
         VALUES ($1, '{}'::jsonb, 'smoke') RETURNING state, risk, config`,
        [action],
      );
      expect(row.state).toBe("pending");
      expect(row.risk).toBe("normal");
      expect(row.config).toEqual({
        allow_accept: true,
        allow_edit: true,
        allow_respond: false,
        allow_ignore: true,
      });
    }
    await expect(
      query(pool, `INSERT INTO pending_approvals (action, args, description)
                   VALUES ('wire_money','{}'::jsonb,'nope')`),
    ).rejects.toThrow(/approvals_action_ck/);
  });

  it("couples state and decision through approvals_decided_ck", async () => {
    const a = await one<{ id: string }>(
      pool,
      `INSERT INTO pending_approvals (action, args, description)
       VALUES ('send','{}'::jsonb,'coupling') RETURNING id`,
    );
    // pending인데 decision이 있으면 거부
    await expect(
      query(pool, `UPDATE pending_approvals SET decision = 'accept' WHERE id = $1`, [a.id]),
    ).rejects.toThrow(/approvals_decided_ck/);
    // pending이 아닌데 decision이 NULL이어도 거부 — expired 포함
    await expect(
      query(pool, `UPDATE pending_approvals SET state = 'expired' WHERE id = $1`, [a.id]),
    ).rejects.toThrow(/approvals_decided_ck/);
    // 둘을 같이 바꾸면 통과
    await query(
      pool,
      `UPDATE pending_approvals SET state='decided', decision='accept', decided_at=now() WHERE id=$1`,
      [a.id],
    );
    const after = await one<{ state: string; decision: string }>(
      pool,
      `SELECT state, decision FROM pending_approvals WHERE id = $1`,
      [a.id],
    );
    expect([after.state, after.decision]).toEqual(["decided", "accept"]);
  });

  it("records an agent_run with A3 column names and links escalation", async () => {
    const first = await one<{ id: string; outcome: string }>(
      pool,
      `INSERT INTO agent_runs (loop, model_tier, provider, model, tokens_in, tokens_out, cost_usd)
       VALUES ('classify','T1','deepseek','deepseek-v4.1-flash', 800, 40, 0.000132)
       RETURNING id, outcome`,
    );
    expect(first.outcome).toBe("running");

    const second = await one<{ escalated_from: string }>(
      pool,
      `INSERT INTO agent_runs (loop, model_tier, provider, model, outcome, escalated_from)
       VALUES ('classify','T2','anthropic','claude-sonnet-5','ok',$1)
       RETURNING escalated_from`,
      [first.id],
    );
    expect(second.escalated_from).toBe(first.id);

    await expect(
      query(pool, `INSERT INTO agent_runs (loop, model_tier, provider, model)
                   VALUES ('classify','T7','local','x')`),
    ).rejects.toThrow(/agent_runs_tier_ck/);
  });

  it("keys agent_sessions by (runtime_id, session_key)", async () => {
    const runtime = await one<{ id: string }>(pool, `SELECT id FROM agent_runtimes WHERE runtime='omnis'`);
    const account = await one<{ id: string }>(
      pool,
      `INSERT INTO accounts (channel, external_id, display) VALUES ('agent','local','agents') RETURNING id`,
    );
    const thread = await one<{ id: string }>(
      pool,
      `INSERT INTO threads (account_id, external_id, kind) VALUES ($1,'sess-1','agent_session') RETURNING id`,
      [account.id],
    );
    await query(
      pool,
      `INSERT INTO agent_sessions (runtime_id, thread_id, session_key)
       VALUES ($1,$2,'agent:omnis:mini:classify')`,
      [runtime.id, thread.id],
    );
    await expect(
      query(
        pool,
        `INSERT INTO agent_sessions (runtime_id, thread_id, session_key)
         VALUES ($1,$2,'agent:omnis:mini:classify')`,
        [runtime.id, thread.id],
      ),
    ).rejects.toThrow(/agent_sessions_uq/);
  });

  it("keeps one digest per (kind, for_date)", async () => {
    await query(
      pool,
      `INSERT INTO digests (kind, for_date, body) VALUES ('morning','2026-09-20','brief')`,
    );
    await expect(
      query(pool, `INSERT INTO digests (kind, for_date, body) VALUES ('morning','2026-09-20','dup')`),
    ).rejects.toThrow(/digests_uq/);
  });
});
```

- [ ] 2. 테스트를 돌려 실패를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/db test
```
기대 실패: `relation "pending_approvals" does not exist`.

- [ ] 3. `/Users/logankim/AI-Workspaces/omnis/packages/db/migrations/0004_tasks_approvals.sql`을 쓴다 — A3 §4의 DDL 그대로, FK 순서대로 배열(`agent_sessions` → `agent_runs` → `tasks` → `pending_approvals` → `notes` → `digests`).

```sql
-- 0004_tasks_approvals.sql
-- A3 §4: agent_sessions, agent_runs, tasks, pending_approvals, notes, digests

CREATE TABLE agent_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  runtime_id   uuid NOT NULL REFERENCES agent_runtimes(id) ON DELETE CASCADE,
  thread_id    uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,  -- 세션 = thread
  session_key  text NOT NULL,        -- 안정 스코프 (마스터 D5)
  session_id   text,                 -- 회전하는 트랜스크립트 id
  cwd          text,
  state        text NOT NULL DEFAULT 'starting',
  summary      text,                 -- read_session이 읽는 durable 요약
  last_turn_at timestamptz,
  started_at   timestamptz NOT NULL DEFAULT now(),
  ended_at     timestamptz,
  CONSTRAINT agent_sessions_state_ck CHECK (state IN
    ('starting','idle','running','waiting_approval','ended','failed')),
  CONSTRAINT agent_sessions_uq UNIQUE (runtime_id, session_key)
);
CREATE INDEX agent_sessions_active_idx ON agent_sessions (last_turn_at DESC)
  WHERE ended_at IS NULL;

-- 모든 L3 루프 실행의 단일 기록 (A4-D16). 여기 없는 실행은 존재하지 않은 것으로 취급한다.
CREATE TABLE agent_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loop             text NOT NULL,
  agent_session_id uuid REFERENCES agent_sessions(id) ON DELETE SET NULL,
  item_id          uuid REFERENCES items(id) ON DELETE SET NULL,
  trigger_kind     text NOT NULL DEFAULT 'event',   -- 'event' | 'cron' | 'manual'
  trigger_ref      text,                   -- cron 잡 이름 등, item 외의 트리거
  model_tier       text NOT NULL,          -- T0|T1|T2|T3 (마스터 §14)
  provider         text NOT NULL,          -- 'local' | 'deepseek' | 'anthropic' | 'openrouter'
  model            text NOT NULL,
  tokens_in        integer,
  tokens_out       integer,
  tokens_cached    integer,
  cost_usd         numeric(10,6),
  latency_ms       integer,
  outcome          text NOT NULL DEFAULT 'running',
  error            text,
  confidence       real,
  escalated_from   uuid REFERENCES agent_runs(id) ON DELETE SET NULL,  -- T1 → T2 에스컬레이션
  injection_flags  text[] NOT NULL DEFAULT '{}',
  context_hash     text,                   -- sha256(cachedPrefix) — 캐시 히트율 추적
  result_ref       uuid,                   -- 산출물 id. FK 없음: 대상 테이블이 여럿
  raw_output       text,                   -- 스키마 위반 출력 보관 (A4 §1.6)
  created_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  CONSTRAINT agent_runs_tier_ck CHECK (model_tier IN ('T0','T1','T2','T3')),
  CONSTRAINT agent_runs_outcome_ck CHECK (outcome IN ('running','ok','failed','skipped','blocked'))
);
CREATE INDEX agent_runs_created_idx ON agent_runs (created_at DESC);
CREATE INDEX agent_runs_loop_idx    ON agent_runs (loop, created_at DESC);
CREATE INDEX agent_runs_item_idx    ON agent_runs (item_id) WHERE item_id IS NOT NULL;

CREATE TABLE tasks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title               text NOT NULL,
  detail              text,
  kind                text NOT NULL DEFAULT 'todo',  -- A4 §7.3 Task 라우팅
  state               text NOT NULL DEFAULT 'open',
  owner_kind          text NOT NULL DEFAULT 'me',   -- 'me' | 'agent'
  owner_runtime_id    uuid REFERENCES agent_runtimes(id) ON DELETE SET NULL,
  source_item_id      uuid REFERENCES items(id) ON DELETE SET NULL,
  person_id           uuid REFERENCES persons(id) ON DELETE SET NULL,
  delegated_session_id uuid REFERENCES agent_sessions(id) ON DELETE SET NULL,
  due_at              timestamptz,
  remind_at           timestamptz,
  done_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          text NOT NULL DEFAULT 'agent',
  CONSTRAINT tasks_kind_ck CHECK (kind IN ('todo','followup','delegation')),
  CONSTRAINT tasks_state_ck CHECK (state IN ('open','in_progress','blocked','done','dropped')),
  CONSTRAINT tasks_owner_ck CHECK (owner_kind IN ('me','agent'))
);
CREATE INDEX tasks_open_idx ON tasks (due_at NULLS LAST) WHERE state IN ('open','in_progress');
CREATE INDEX tasks_remind_idx ON tasks (remind_at) WHERE remind_at IS NOT NULL AND state <> 'done';

-- HumanInterrupt / HumanResponse를 그대로 이식. A3-D11.
CREATE TABLE pending_approvals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action        text NOT NULL,
  args          jsonb NOT NULL,          -- ActionRequest.args (전문. UI가 그대로 노출)
  description   text NOT NULL,
  config        jsonb NOT NULL DEFAULT
                  '{"allow_accept":true,"allow_edit":true,"allow_respond":false,"allow_ignore":true}'::jsonb,
  state         text NOT NULL DEFAULT 'pending',
  decision      text,                    -- accept | edit | respond | ignore
  decided_args  jsonb,                   -- edit/respond일 때 사람이 고친 결과
  requested_by  uuid REFERENCES agent_runtimes(id) ON DELETE SET NULL,
  thread_id     uuid REFERENCES threads(id) ON DELETE SET NULL,
  item_id       uuid REFERENCES items(id) ON DELETE SET NULL,
  task_id       uuid REFERENCES tasks(id) ON DELETE SET NULL,
  risk          text NOT NULL DEFAULT 'normal',
  expires_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  decided_at    timestamptz,
  executed_at   timestamptz,
  fail_reason   text,
  CONSTRAINT approvals_action_ck CHECK (action IN
    ('send','delete','calendar_write','delegate','self_model_edit','memory_write')),
  CONSTRAINT approvals_state_ck CHECK (state IN
    ('pending','decided','executing','executed','failed','expired')),
  CONSTRAINT approvals_decision_ck CHECK (decision IS NULL OR decision IN
    ('accept','edit','respond','ignore')),
  CONSTRAINT approvals_risk_ck CHECK (risk IN ('normal','high')),
  CONSTRAINT approvals_decided_ck CHECK ((state = 'pending') = (decision IS NULL))
);
CREATE INDEX approvals_pending_idx ON pending_approvals (created_at DESC) WHERE state = 'pending';
CREATE INDEX approvals_thread_idx ON pending_approvals (thread_id, created_at DESC);

CREATE TABLE notes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  body         text NOT NULL,
  routed_to_thread_id uuid REFERENCES threads(id) ON DELETE SET NULL,
  routed_to_person_id uuid REFERENCES persons(id) ON DELETE SET NULL,
  rationale    text,
  route_state  text NOT NULL DEFAULT 'proposed',
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notes_route_state_ck CHECK (route_state IN ('proposed','accepted','rejected','none'))
);

CREATE TABLE digests (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       text NOT NULL,
  for_date   date NOT NULL,
  body       text NOT NULL,
  item_ids   uuid[] NOT NULL DEFAULT '{}',
  metrics    jsonb NOT NULL DEFAULT '{}'::jsonb,   -- 커버리지·비용 지표 (마스터 §2)
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT digests_kind_ck CHECK (kind IN ('morning','nightly')),
  CONSTRAINT digests_uq UNIQUE (kind, for_date)
);
```

- [ ] 4. 테스트를 돌려 통과를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/db test
```
기대: `Tests  25 passed (25)`.

- [ ] 5. US-A03 검증 명령을 그대로 돌린다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && DATABASE_URL=postgres://logan@127.0.0.1:5432/omnis pnpm db:migrate && pnpm --filter @omnis/db test
```
기대: `applied 2: 0003_labels.sql, 0004_tasks_approvals.sql` 후 전부 통과.

- [ ] 6. 커밋한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-A03: 0004_tasks_approvals.sql — 세션·런·작업·승인·노트·다이제스트

- pending_approvals: action 6값(A3 approvals_action_ck), state 6값, decision 4값, approvals_decided_ck
- agent_runs: A3 컬럼명(model_tier/tokens_in/outcome/created_at) + escalated_from 자기참조
- agent_sessions (runtime_id, session_key) 유니크, tasks/notes/digests
- pnpm db:migrate && pnpm --filter @omnis/db test 통과

Implemented-by: DeepSeek V4.1 Flash

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 7: ddl-0005-memory (US-A04, tier: Sonnet)

**스토리 US-A04** — 목표: DDL(A3-D9 `0005`~`0008`) — `0005_memory.sql`(`entities`/`relations`/`memories`+HNSW) + `0006_kernel.sql`(`events` append-only/`audit_log`/`jobs`+트리거) + `0007_notify.sql`(LISTEN/NOTIFY, id-only 페이로드) + `0008_publication.sql`(`zero_omnis`) / 검증 명령: `pnpm db:migrate && pnpm --filter @omnis/db test` / 티어: Sonnet. 의존: A03. **추가 인수 기준**: US-A02가 만든 `calendar_events`에 대해 `attendees_count BETWEEN 1 AND 8` 조회와 `end_at` 기준 48시간 윈도 조회가 둘 다 성공해야 한다(Task 11).

**읽을 곳**: A3 §5(entities/relations/memories DDL + 3층 대응표), A3 §1.1(`memories.kind`, `entities.type`), A3 §11(보존 정책 — memories는 삭제하지 않고 `invalidated_at`으로 무효화).

**만들지 않을 것(YAGNI)**: mem0 VectorStore 어댑터(A3-D12, Phase B 스파이크 S-A3-1 결과 대기), 임베딩 생성(Ollama는 Phase B), `relations` traversal 헬퍼, Matryoshka 축소(A3 §13의 임계 신호가 오면).

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/packages/db/migrations/0005_memory.sql`
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/db/test/integration/schema-0005.test.ts`

**Interfaces:**
- Consumes: `0002`의 `persons`, `items`.
- Produces: 제약 이름 `entities_type_ck`, `memories_kind_ck`, `memories_scope_ck`와 인덱스 `entities_live_uq`, `memories_embedding_idx`, `relations_asof_idx`. Phase B의 `@omnis/memory`가 이 이름들 위에 선다.

### Steps

- [ ] 1. 실패하는 테스트를 쓴다. `/Users/logankim/AI-Workspaces/omnis/packages/db/test/integration/schema-0005.test.ts`:

```ts
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, one, query } from "@omnis/db";

let pool: Pool;
beforeAll(() => {
  pool = createPool();
});
afterAll(async () => {
  await pool.end();
});

const zero768 = `[${new Array(768).fill(0).join(",")}]`;

describe("0005_memory", () => {
  it("keeps one live entity per (type, lower(name)) but allows invalidated duplicates", async () => {
    await query(pool, `INSERT INTO entities (type, name) VALUES ('org','Onward Lab')`);
    await expect(
      query(pool, `INSERT INTO entities (type, name) VALUES ('org','onward lab')`),
    ).rejects.toThrow(/entities_live_uq/);

    await query(pool, `UPDATE entities SET invalidated_at = now() WHERE lower(name) = 'onward lab'`);
    await query(pool, `INSERT INTO entities (type, name) VALUES ('org','Onward Lab')`);
    const live = await one<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM entities WHERE lower(name)='onward lab' AND invalidated_at IS NULL`,
    );
    expect(live.n).toBe("1");
  });

  it("stores bi-temporal relations with all four timestamps", async () => {
    const from = await one<{ id: string }>(
      pool,
      `INSERT INTO entities (type, name) VALUES ('person','Jane Doe') RETURNING id`,
    );
    const to = await one<{ id: string }>(
      pool,
      `INSERT INTO entities (type, name) VALUES ('org','Acme') RETURNING id`,
    );
    const rel = await one<{
      valid_from: Date;
      valid_until: Date | null;
      recorded_at: Date;
      invalidated_at: Date | null;
    }>(
      pool,
      `INSERT INTO relations (from_entity_id, to_entity_id, type, valid_from)
       VALUES ($1,$2,'works_at', now() - interval '1 year')
       RETURNING valid_from, valid_until, recorded_at, invalidated_at`,
      [from.id, to.id],
    );
    expect(rel.valid_until).toBeNull();
    expect(rel.invalidated_at).toBeNull();
    expect(rel.recorded_at.getTime()).toBeGreaterThan(rel.valid_from.getTime());
  });

  it("indexes only live memories with HNSW cosine", async () => {
    const idx = await one<{ indexdef: string }>(
      pool,
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'memories_embedding_idx'`,
    );
    expect(idx.indexdef).toContain("hnsw");
    expect(idx.indexdef).toContain("WHERE (invalidated_at IS NULL)");

    await query(
      pool,
      `INSERT INTO memories (content, embedding, kind) VALUES ('logan prefers 한국어', $1::vector, 'preference')`,
      [zero768],
    );
    const hit = await query<{ content: string }>(
      pool,
      `SELECT content FROM memories WHERE invalidated_at IS NULL ORDER BY embedding <=> $1::vector LIMIT 1`,
      [zero768],
    );
    expect(hit[0]?.content).toContain("한국어");

    await expect(
      query(pool, `INSERT INTO memories (content, kind) VALUES ('x','rumor')`),
    ).rejects.toThrow(/memories_kind_ck/);
  });
});
```

- [ ] 2. 테스트를 돌려 실패를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/db test
```
기대 실패: `relation "entities" does not exist`.

- [ ] 3. `/Users/logankim/AI-Workspaces/omnis/packages/db/migrations/0005_memory.sql`을 쓴다 — A3 §5 그대로.

```sql
-- 0005_memory.sql
-- A3 §5: entities, relations, memories + HNSW. Graphiti 4-timestamp bi-temporal.

CREATE TABLE entities (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type           text NOT NULL,
  name           text NOT NULL,
  person_id      uuid REFERENCES persons(id) ON DELETE SET NULL,
  attributes     jsonb NOT NULL DEFAULT '{}'::jsonb,
  valid_from     timestamptz NOT NULL DEFAULT now(),
  valid_until    timestamptz,
  recorded_at    timestamptz NOT NULL DEFAULT now(),
  invalidated_at timestamptz,
  CONSTRAINT entities_type_ck CHECK (type IN
    ('person','org','project','commitment','decision','topic'))
);
CREATE UNIQUE INDEX entities_live_uq ON entities (type, lower(name))
  WHERE invalidated_at IS NULL;

CREATE TABLE relations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_entity_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  to_entity_id   uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  type           text NOT NULL,           -- works_at, introduced_by, owns, promised_to, decided_on ...
  attributes     jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_item_id uuid REFERENCES items(id) ON DELETE SET NULL,
  confidence     real NOT NULL DEFAULT 0.5,
  valid_from     timestamptz NOT NULL,     -- 사실이 유효해진 시점
  valid_until    timestamptz,              -- 사실이 무효해진 시점
  recorded_at    timestamptz NOT NULL DEFAULT now(),   -- 시스템이 알게 된 시점
  invalidated_at timestamptz               -- 시스템이 "더 이상 사실 아님"을 알게 된 시점
);
CREATE INDEX relations_from_idx ON relations (from_entity_id, type, valid_from DESC);
CREATE INDEX relations_to_idx   ON relations (to_entity_id, type, valid_from DESC);
CREATE INDEX relations_asof_idx ON relations (valid_from, valid_until);

-- L2-2 벡터 메모리. nomic-embed-text-v1.5 = 768d, HNSW 한계 2,000d 안쪽.
CREATE TABLE memories (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content        text NOT NULL,
  embedding      vector(768),
  kind           text NOT NULL DEFAULT 'fact',
  scope          text NOT NULL DEFAULT 'unknown',
  source_item_id uuid REFERENCES items(id) ON DELETE SET NULL,
  source_kind    text NOT NULL DEFAULT 'inbox',  -- inbox|calendar|file|drive|github|self
  source_ref     text,                            -- 파일 경로, Drive fileId, GitHub URL 등
  person_id      uuid REFERENCES persons(id) ON DELETE SET NULL,
  entity_id      uuid REFERENCES entities(id) ON DELETE SET NULL,
  confidence     real NOT NULL DEFAULT 0.5,
  valid_from     timestamptz NOT NULL DEFAULT now(),
  valid_until    timestamptz,
  recorded_at    timestamptz NOT NULL DEFAULT now(),
  invalidated_at timestamptz,
  superseded_by  uuid REFERENCES memories(id) ON DELETE SET NULL,
  CONSTRAINT memories_kind_ck CHECK (kind IN ('fact','preference','commitment','event','summary')),
  CONSTRAINT memories_scope_ck CHECK (scope IN ('work','personal','unknown'))
);

-- 현재 유효한 메모리만 인덱싱한다.
CREATE INDEX memories_embedding_idx ON memories
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)   -- 파라미터 근거: UNVERIFIED — spike (A3 §14 S-A3-7)
  WHERE invalidated_at IS NULL;
CREATE INDEX memories_person_idx ON memories (person_id, recorded_at DESC);
CREATE INDEX memories_source_idx ON memories (source_kind, source_ref);
CREATE INDEX memories_valid_idx ON memories (valid_from DESC) WHERE invalidated_at IS NULL;
```

- [ ] 4. 테스트를 돌려 통과를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/db test
```
기대: `Tests  28 passed (28)`.

- [ ] 5. 커밋한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-A04: 0005_memory.sql — entities/relations/memories + HNSW

- Graphiti 4-timestamp(valid_from/valid_until/recorded_at/invalidated_at)
- entities_live_uq: 살아있는 엔티티만 (type, lower(name)) 유니크
- memories는 invalidated_at으로 무효화, 부분 HNSW가 자동 제외

Implemented-by: Claude Sonnet

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 8: ddl-0006-kernel (US-A04, tier: Sonnet)

**스토리 US-A04** (계속) — `0006_kernel.sql`: `events`, `audit_log`, `jobs`(+ seed 16개) + append-only 트리거 + `omnis_events_rolloff()` 함수와 GRANT.

**읽을 곳**: A3 §6(events/audit_log/jobs DDL + seed 15행 + 오너 분담 주석), A3 §6.1(append-only 트리거 2함수 4트리거 + REVOKE), A3 §6.1.1(`omnis_events_rolloff()` SECURITY DEFINER 전문 + OWNER/REVOKE/GRANT), A3-D5·A3-D6, A3 §11(보존 정책).

**A3 SQL에서 딱 한 줄을 바꿔야 한다 — 그 이유와 바꾼 형태**: A3 §6.1은 `ALTER DATABASE omnis SET omnis.events_retention = '90 days';`로 DB 이름을 리터럴로 박았다. 테스트 DB는 `omnis_test`이고 계약 §2가 그 이름을 고정했으므로 리터럴을 그대로 쓰면 `0006`이 `omnis_test`에서 즉시 실패한다(`database "omnis" does not exist`). 동작이 같고 DB 이름에 독립적인 형태로만 바꾼다:

```sql
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET omnis.events_retention = %L', current_database(), '90 days');
END
$$;
```

`ALTER DATABASE ... SET`은 **새 커넥션부터** 적용된다. 그래서 `vitest.global-setup.ts`가 마이그레이션을 끝낸 뒤 각 테스트 파일이 새 풀을 여는 순서가 중요하다(globalSetup이 먼저 끝나고 테스트 파일이 나중에 연결하므로 자동으로 충족된다). 이 사실은 SQL 주석으로 남긴다.

**만들지 않을 것(YAGNI)**: 파티셔닝(A3-D6: 일 100,000건 또는 DELETE 5분 초과 전에는 하지 않는다), cold 덤프 파일 쓰기(A3 §11 — 허브가 롤오프 호출 전에 한다, Phase B), 잡 핸들러(Task 14~15), `omnis_hub`에 대한 전면 GRANT 매트릭스(A3가 정한 REVOKE/GRANT만).

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/packages/db/migrations/0006_kernel.sql`
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/db/test/integration/schema-0006.test.ts`

**Interfaces:**
- Consumes: `0004`(seed가 참조하는 테이블은 없지만 파일 순서상 뒤에 온다), `0001`의 역할 3개.
- Produces: 테이블 `events`(`seq` bigint identity), `audit_log`(`seq`), `jobs`; 함수 `omnis_append_only()`, `omnis_no_truncate()`, `omnis_events_rolloff()`; 트리거 `events_append_only`, `audit_append_only`, `events_no_truncate`, `audit_no_truncate`; DB 파라미터 `omnis.events_retention='90 days'`; seed 잡 16개(`morning_digest`, `nightly_digest`, `memory_consolidate`, `auto_archive_sweep`, `task_remind`, `network_inactive_sweep`, `self_model_weekly`, `eval_weekly`, `drive_poll`, `github_poll`, `followup_sweep`, `token_refresh`, `gmail_rewatch`, `graph_sub_renew`, `events_rolloff`, `slot_health`). Task 12·14·19·21이 전부 이 위에 선다.

### Steps

- [ ] 1. 실패하는 테스트를 쓴다. `/Users/logankim/AI-Workspaces/omnis/packages/db/test/integration/schema-0006.test.ts`:

```ts
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, one, query } from "@omnis/db";

let pool: Pool;
beforeAll(() => {
  pool = createPool();
});
afterAll(async () => {
  await pool.end();
});

describe("0006_kernel", () => {
  it("sets omnis.events_retention on the database", async () => {
    const row = await one<{ retention: string | null }>(
      pool,
      `SELECT current_setting('omnis.events_retention', true) AS retention`,
    );
    expect(row.retention).toBe("90 days");
  });

  it("forbids UPDATE and recent DELETE on events (A3-D5)", async () => {
    const ev = await one<{ seq: string }>(
      pool,
      `INSERT INTO events (kind, payload) VALUES ('test.append', '{"a":1}'::jsonb) RETURNING seq::text AS seq`,
    );
    await expect(
      query(pool, `UPDATE events SET kind = 'mutated' WHERE seq = $1`, [ev.seq]),
    ).rejects.toThrow(/append-only: UPDATE on events is forbidden/);
    await expect(query(pool, `DELETE FROM events WHERE seq = $1`, [ev.seq])).rejects.toThrow(
      /retention window/,
    );
  });

  it("forbids UPDATE, DELETE and TRUNCATE on audit_log forever", async () => {
    const row = await one<{ seq: string }>(
      pool,
      `INSERT INTO audit_log (actor, action, target_table)
       VALUES ('system','test.audit','events') RETURNING seq::text AS seq`,
    );
    await expect(
      query(pool, `UPDATE audit_log SET action = 'x' WHERE seq = $1`, [row.seq]),
    ).rejects.toThrow(/append-only: UPDATE on audit_log is forbidden/);
    await expect(query(pool, `DELETE FROM audit_log WHERE seq = $1`, [row.seq])).rejects.toThrow(
      /append-only: DELETE on audit_log is forbidden/,
    );
    await expect(query(pool, `TRUNCATE audit_log`)).rejects.toThrow(
      /append-only: TRUNCATE on audit_log is forbidden/,
    );
  });

  it("rolls off events older than the retention window and audits the result", async () => {
    await query(
      pool,
      `INSERT INTO events (kind, at) VALUES ('old.one', now() - interval '100 days')`,
    );
    const out = await one<{ deleted: string }>(
      pool,
      `SELECT deleted::text AS deleted FROM omnis_events_rolloff()`,
    );
    expect(Number(out.deleted)).toBeGreaterThanOrEqual(1);

    const audited = await one<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM audit_log WHERE action = 'events.rolloff'`,
    );
    expect(Number(audited.n)).toBeGreaterThanOrEqual(1);

    const left = await one<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM events WHERE kind = 'old.one'`,
    );
    expect(left.n).toBe("0");
  });

  it("seeds the 16 jobs A3 §6 lists, with the A4-owned schedules", async () => {
    const rows = await query<{ name: string; schedule: string }>(
      pool,
      `SELECT name, schedule FROM jobs ORDER BY name`,
    );
    expect(rows).toHaveLength(16);
    const byName = new Map(rows.map((r) => [r.name, r.schedule]));
    expect(byName.get("morning_digest")).toBe("30 6 * * *");
    expect(byName.get("nightly_digest")).toBe("0 23 * * *");
    expect(byName.get("memory_consolidate")).toBe("30 23 * * *");
    expect(byName.get("slot_health")).toBe("*/5 * * * *");
    expect(byName.get("events_rolloff")).toBe("15 4 * * *");
  });

  it("restricts jobs.last_status to ok/failed/skipped", async () => {
    await expect(
      query(pool, `UPDATE jobs SET last_status = 'weird' WHERE name = 'slot_health'`),
    ).rejects.toThrow(/jobs_status_ck/);
  });
});
```

- [ ] 2. 테스트를 돌려 실패를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/db test
```
기대 실패: `relation "events" does not exist`.

- [ ] 3. `/Users/logankim/AI-Workspaces/omnis/packages/db/migrations/0006_kernel.sql`을 쓴다.

```sql
-- 0006_kernel.sql
-- A3 §6: events, audit_log, jobs(+seed) + §6.1 append-only 트리거 + §6.1.1 롤오프 함수·GRANT
-- events/audit_log에는 FK를 걸지 않는다(A3 §1): 원본이 지워져도 감사 기록은 남아야 한다.

CREATE TABLE events (
  seq     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind    text NOT NULL,                 -- 'item.created', 'approval.decided', 'job.run', 'adapter.error' ...
  actor   text NOT NULL DEFAULT 'system',
  target_table text,
  target_id    uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_at_idx ON events (at DESC);
CREATE INDEX events_kind_idx ON events (kind, at DESC);
CREATE INDEX events_target_idx ON events (target_id, at DESC) WHERE target_id IS NOT NULL;

CREATE TABLE audit_log (
  seq          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor        text NOT NULL,            -- 'me' | 'agent:<runtime>' | 'system'
  action       text NOT NULL,
  target_table text NOT NULL,
  target_id    uuid,
  before       jsonb,
  after        jsonb,
  approval_id  uuid,                     -- FK 없음(의도적). egress는 여기에 반드시 남는다
  at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_at_idx ON audit_log (at DESC);
CREATE INDEX audit_log_action_idx ON audit_log (action, at DESC);

CREATE TABLE jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL UNIQUE,
  schedule     text NOT NULL,            -- 5-field cron, TZ=Asia/Seoul
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled      boolean NOT NULL DEFAULT true,
  next_run_at  timestamptz NOT NULL,
  claimed_at   timestamptz,              -- at-most-once claim
  last_run_at  timestamptz,
  last_status  text,
  last_error   text,
  CONSTRAINT jobs_status_ck CHECK (last_status IS NULL OR last_status IN ('ok','failed','skipped'))
);
CREATE INDEX jobs_due_idx ON jobs (next_run_at) WHERE enabled AND claimed_at IS NULL;

-- 스케줄 오너 분담(A3 §6):
--   L3~L9 루프 잡의 cron 정본은 A4 §6.1 표다. A3는 seed만 하고, 시각이 바뀌면 A4를 먼저 고친다.
--   어댑터·커널 인프라 잡의 오너는 A3다.
INSERT INTO jobs (name, schedule, next_run_at) VALUES
  -- A4 소유 (정본: A4 §6.1)
  ('morning_digest',        '30 6 * * *',   now()),   -- L5 아침 브리핑 06:30 KST
  ('nightly_digest',        '0 23 * * *',   now()),   -- L5 밤 다이제스트 23:00 KST
  ('memory_consolidate',    '30 23 * * *',  now()),   -- 야간 메모리 통합
  ('auto_archive_sweep',    '0 22 * * *',   now()),   -- L8 자동 보관
  ('task_remind',           '0 9,14,19 * * *', now()),-- L3 리마인드
  ('network_inactive_sweep','0 10 * * 1-5', now()),   -- L6 비활성 감지(평일 10:00)
  ('self_model_weekly',     '0 21 * * 0',   now()),   -- self-model 제안(일 21:00)
  ('eval_weekly',           '0 22 * * 0',   now()),   -- 평가 하네스(일 22:00)
  ('drive_poll',            '*/10 * * * *', now()),   -- L9 ingestion
  ('github_poll',           '*/15 * * * *', now()),   -- L9 ingestion
  -- A3 소유 (인프라)
  ('followup_sweep',        '0 * * * *',    now()),   -- outbox claim 해제
  ('token_refresh',         '*/30 * * * *', now()),
  ('gmail_rewatch',         '0 3 * * *',    now()),   -- watch 만료 7일 → 매일 갱신
  ('graph_sub_renew',       '0 4 * * 1',    now()),   -- Outlook 구독 10,080분
  ('events_rolloff',        '15 4 * * *',   now()),
  ('slot_health',           '*/5 * * * *',  now());   -- WAL 슬롯 감시

-- A3 §6.1 append-only 강제 (A3-D5)
CREATE OR REPLACE FUNCTION omnis_append_only() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'append-only: UPDATE on % is forbidden', TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    -- audit_log는 어떤 경우에도 삭제 불가. events는 롤오프 윈도우 밖만 허용.
    IF TG_TABLE_NAME = 'audit_log'
       OR OLD.at > now() - (current_setting('omnis.events_retention', true))::interval THEN
      RAISE EXCEPTION 'append-only: DELETE on % is forbidden (retention window)', TG_TABLE_NAME
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN OLD;
END
$fn$;

CREATE OR REPLACE FUNCTION omnis_no_truncate() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'append-only: TRUNCATE on % is forbidden', TG_TABLE_NAME
    USING ERRCODE = '42501';
END
$fn$;

CREATE TRIGGER events_append_only   BEFORE UPDATE OR DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION omnis_append_only();
CREATE TRIGGER audit_append_only    BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION omnis_append_only();
CREATE TRIGGER events_no_truncate   BEFORE TRUNCATE ON events
  FOR EACH STATEMENT EXECUTE FUNCTION omnis_no_truncate();
CREATE TRIGGER audit_no_truncate    BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION omnis_no_truncate();

-- A3 §6.1은 `ALTER DATABASE omnis SET ...`로 DB 이름을 리터럴로 적었다. 테스트 DB는 omnis_test이므로
-- 동작이 같고 이름에 독립적인 형태로만 바꾼다. ALTER DATABASE ... SET은 새 커넥션부터 적용된다.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET omnis.events_retention = %L', current_database(), '90 days');
END
$$;

-- 2차 방어: 허브 역할에서 권한 자체를 뺀다.
REVOKE UPDATE, DELETE, TRUNCATE ON events, audit_log FROM omnis_hub;
GRANT  DELETE ON events TO omnis_owner;   -- 롤오프는 아래 SECURITY DEFINER 함수로만

-- A3 §6.1.1: 허브(omnis_hub)는 임의 DELETE 대신 이 함수 EXECUTE만 갖는다.
CREATE OR REPLACE FUNCTION omnis_events_rolloff()
RETURNS TABLE (cutoff timestamptz, deleted bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  retention text := current_setting('omnis.events_retention', true);
  cut       timestamptz;
  n         bigint;
BEGIN
  IF retention IS NULL OR retention = '' THEN
    RAISE EXCEPTION 'omnis.events_retention is not set — refusing to roll off';
  END IF;
  cut := now() - retention::interval;
  -- 덤프(A3 §11)는 호출 전에 허브가 끝낸다. 이 함수는 삭제만 한다.
  DELETE FROM events WHERE at <= cut;
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO audit_log (actor, action, target_table, after)
    VALUES ('system', 'events.rolloff', 'events',
            json_build_object('cutoff', cut, 'deleted', n)::jsonb);
  RETURN QUERY SELECT cut, n;
END
$fn$;

ALTER FUNCTION omnis_events_rolloff() OWNER TO omnis_owner;
REVOKE ALL   ON FUNCTION omnis_events_rolloff() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION omnis_events_rolloff() TO omnis_hub;
```

- [ ] 4. 테스트를 돌려 통과를 확인한다. `omnis.events_retention` 테스트는 새 커넥션이 필요하므로, globalSetup이 끝난 뒤 열리는 테스트 풀에서 자동으로 만족된다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/db test
```
기대: `Tests  34 passed (34)`.

- [ ] 5. 커밋한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-A04: 0006_kernel.sql — events/audit_log/jobs + append-only + 롤오프 함수

- events/audit_log는 FK 없이 seq bigint identity, append-only 트리거 4개(UPDATE/DELETE/TRUNCATE)
- audit_log는 영구 삭제 불가, events는 retention 윈도 밖만 허용
- omnis_events_rolloff(): SECURITY DEFINER, OWNER omnis_owner, omnis_hub는 EXECUTE만
- jobs seed 16개(A4 소유 10 + A3 인프라 6)
- ALTER DATABASE는 current_database()로 동적 실행(테스트 DB omnis_test 대응, 동작 동일)

Implemented-by: Claude Sonnet

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 9: ddl-0007-notify (US-A04, tier: Sonnet)

**스토리 US-A04** (계속) — `0007_notify.sql`: LISTEN/NOTIFY 채널, 페이로드는 id만(8,000B 한도).

**읽을 곳**: A3 §6.2(채널 7개 표 + `omnis_notify_item()` 예시 + "같은 모양의 트리거를 `threads`, `pending_approvals`, `tasks`, `agent_sessions`에 붙인다"), A3-D7(허브 내부 팬아웃 전용), A3-D14·계약 §0-9(ephemeral은 NOTIFY를 타지 않는다), 계약 §4(채널·페이로드 표).

**채널 7개 중 6개만 트리거를 갖는다**: `omnis_item`/`omnis_thread`/`omnis_approval`/`omnis_task`/`omnis_session`/`omnis_job`은 테이블 트리거가 쏜다. **`omnis_control`은 테이블이 없다** — kill switch 상태 변경 때 커널이 `pg_notify`로 직접 쏜다(Task 19). 이 파일은 `omnis_control` 트리거를 만들지 않는다.

`omnis_approval`의 페이로드 `state`는 계약 §4가 `"pending"|"decided"` 두 값만 허용하므로 트리거는 그 두 상태로 바뀔 때만 NOTIFY한다. `omnis_session`은 `runtime` 문자열이 필요하므로 `agent_runtimes`를 조인한다.

**만들지 않을 것(YAGNI)**: 디바운스·coalescing 로직(Postgres가 같은 트랜잭션·같은 채널·같은 페이로드를 이미 합친다, A3 §6.2), ephemeral 채널, 페이로드에 body·title 등 실제 데이터(id만).

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/packages/db/migrations/0007_notify.sql`
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/db/test/integration/schema-0007.test.ts`

**Interfaces:**
- Consumes: `0002`(items/threads/agent_runtimes), `0004`(pending_approvals/tasks/agent_sessions), `0006`(jobs).
- Produces: 함수 `omnis_notify_item()`, `omnis_notify_thread()`, `omnis_notify_approval()`, `omnis_notify_task()`, `omnis_notify_session()`, `omnis_notify_job()`; 트리거 `items_notify`, `threads_notify`, `approvals_notify`, `tasks_notify`, `sessions_notify`, `jobs_notify`. Task 13이 이 트리거들이 실제로 쏘는지를 커널 `subscribe()`로 검증한다.

### Steps

- [ ] 1. 실패하는 테스트를 쓴다. 이 테스트는 `pg`의 raw client로 직접 LISTEN한다(커널은 아직 없다). `/Users/logankim/AI-Workspaces/omnis/packages/db/test/integration/schema-0007.test.ts`:

```ts
import { Client } from "pg";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, one, query } from "@omnis/db";

let pool: Pool;
let listener: Client;
const seen: Array<{ channel: string; payload: Record<string, unknown> }> = [];

beforeAll(async () => {
  pool = createPool();
  listener = new Client({ connectionString: process.env.DATABASE_URL });
  await listener.connect();
  listener.on("notification", (msg) => {
    seen.push({ channel: msg.channel, payload: JSON.parse(msg.payload ?? "{}") as Record<string, unknown> });
  });
  for (const ch of ["omnis_item", "omnis_thread", "omnis_approval", "omnis_task", "omnis_session", "omnis_job"]) {
    await listener.query(`LISTEN ${ch}`);
  }
});
afterAll(async () => {
  await listener.end();
  await pool.end();
});

async function settle(): Promise<void> {
  await listener.query("SELECT 1");
  await new Promise((r) => setTimeout(r, 120));
}

describe("0007_notify", () => {
  it("notifies omnis_item with id + thread_id + op and nothing else", async () => {
    const acc = await one<{ id: string }>(
      pool,
      `INSERT INTO accounts (channel, external_id, display) VALUES ('slack','T9:U9','n') RETURNING id`,
    );
    const thr = await one<{ id: string }>(
      pool,
      `INSERT INTO threads (account_id, external_id, kind) VALUES ($1,'n-1','dm') RETURNING id`,
      [acc.id],
    );
    seen.length = 0;
    const item = await one<{ id: string }>(
      pool,
      `INSERT INTO items (thread_id, account_id, kind, body, sent_at)
       VALUES ($1,$2,'message','hi', now()) RETURNING id`,
      [thr.id, acc.id],
    );
    await settle();

    const itemMsg = seen.find((s) => s.channel === "omnis_item");
    expect(itemMsg?.payload).toEqual({ id: item.id, thread_id: thr.id, op: "insert" });
    expect(seen.some((s) => s.channel === "omnis_thread")).toBe(true);

    seen.length = 0;
    await query(pool, `UPDATE items SET status = 'read' WHERE id = $1`, [item.id]);
    await settle();
    expect(seen.find((s) => s.channel === "omnis_item")?.payload.op).toBe("update");
  });

  it("notifies omnis_approval only for pending and decided", async () => {
    seen.length = 0;
    const a = await one<{ id: string }>(
      pool,
      `INSERT INTO pending_approvals (action, args, description)
       VALUES ('send','{}'::jsonb,'notify') RETURNING id`,
    );
    await settle();
    expect(seen.find((s) => s.channel === "omnis_approval")?.payload).toEqual({
      id: a.id,
      state: "pending",
    });

    seen.length = 0;
    await query(
      pool,
      `UPDATE pending_approvals SET state='decided', decision='accept', decided_at=now() WHERE id=$1`,
      [a.id],
    );
    await settle();
    expect(seen.find((s) => s.channel === "omnis_approval")?.payload).toEqual({
      id: a.id,
      state: "decided",
    });

    seen.length = 0;
    await query(pool, `UPDATE pending_approvals SET state='executing' WHERE id=$1`, [a.id]);
    await settle();
    expect(seen.some((s) => s.channel === "omnis_approval")).toBe(false);
  });

  it("notifies omnis_session with the runtime name and omnis_job with the job name", async () => {
    const runtime = await one<{ id: string }>(pool, `SELECT id FROM agent_runtimes WHERE runtime='omnis'`);
    const acc = await one<{ id: string }>(
      pool,
      `INSERT INTO accounts (channel, external_id, display) VALUES ('agent','notify','a') RETURNING id`,
    );
    const thr = await one<{ id: string }>(
      pool,
      `INSERT INTO threads (account_id, external_id, kind) VALUES ($1,'sess-n','agent_session') RETURNING id`,
      [acc.id],
    );
    seen.length = 0;
    const sess = await one<{ id: string }>(
      pool,
      `INSERT INTO agent_sessions (runtime_id, thread_id, session_key)
       VALUES ($1,$2,'agent:omnis:mini:notify') RETURNING id`,
      [runtime.id, thr.id],
    );
    await settle();
    expect(seen.find((s) => s.channel === "omnis_session")?.payload).toEqual({
      id: sess.id,
      runtime: "omnis",
      state: "starting",
    });

    seen.length = 0;
    const job = await one<{ id: string }>(
      pool,
      `UPDATE jobs SET next_run_at = now() WHERE name = 'slot_health' RETURNING id`,
    );
    await settle();
    expect(seen.find((s) => s.channel === "omnis_job")?.payload).toEqual({
      id: job.id,
      name: "slot_health",
    });
  });

  it("keeps every payload well under the 8,000B NOTIFY limit", async () => {
    for (const s of seen) {
      expect(Buffer.byteLength(JSON.stringify(s.payload), "utf8")).toBeLessThan(8000);
    }
  });
});
```

- [ ] 2. 테스트를 돌려 실패를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/db test
```
기대 실패: `expected undefined to deeply equal { id: ..., thread_id: ..., op: 'insert' }`.

- [ ] 3. `/Users/logankim/AI-Workspaces/omnis/packages/db/migrations/0007_notify.sql`을 쓴다. `omnis_notify_item()`은 A3 §6.2 그대로이고 나머지 5개는 A3가 "같은 모양"이라고 지시한 것을 각 채널의 페이로드 표(A3 §6.2 / 계약 §4)에 맞춰 쓴 것이다.

```sql
-- 0007_notify.sql
-- A3 §6.2 / A3-D7: 허브 내부 팬아웃 전용, 페이로드는 id만(8,000B 한도).
-- omnis_control은 테이블이 없다 — kill switch가 커널에서 pg_notify로 직접 쏜다.

CREATE OR REPLACE FUNCTION omnis_notify_item() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM pg_notify('omnis_item', json_build_object(
    'id', NEW.id, 'thread_id', NEW.thread_id,
    'op', CASE WHEN TG_OP = 'INSERT' THEN 'insert' ELSE 'update' END)::text);
  RETURN NULL;
END
$fn$;

CREATE OR REPLACE FUNCTION omnis_notify_thread() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM pg_notify('omnis_thread', json_build_object(
    'id', NEW.id,
    'op', CASE WHEN TG_OP = 'INSERT' THEN 'insert' ELSE 'update' END)::text);
  RETURN NULL;
END
$fn$;

-- 계약 §4: state는 'pending' | 'decided' 두 값만 흘린다.
CREATE OR REPLACE FUNCTION omnis_notify_approval() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.state NOT IN ('pending', 'decided') THEN
    RETURN NULL;
  END IF;
  PERFORM pg_notify('omnis_approval', json_build_object(
    'id', NEW.id, 'state', NEW.state)::text);
  RETURN NULL;
END
$fn$;

CREATE OR REPLACE FUNCTION omnis_notify_task() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM pg_notify('omnis_task', json_build_object(
    'id', NEW.id,
    'op', CASE WHEN TG_OP = 'INSERT' THEN 'insert' ELSE 'update' END)::text);
  RETURN NULL;
END
$fn$;

CREATE OR REPLACE FUNCTION omnis_notify_session() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  rt text;
BEGIN
  SELECT runtime INTO rt FROM agent_runtimes WHERE id = NEW.runtime_id;
  PERFORM pg_notify('omnis_session', json_build_object(
    'id', NEW.id, 'runtime', rt, 'state', NEW.state)::text);
  RETURN NULL;
END
$fn$;

CREATE OR REPLACE FUNCTION omnis_notify_job() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM pg_notify('omnis_job', json_build_object(
    'id', NEW.id, 'name', NEW.name)::text);
  RETURN NULL;
END
$fn$;

CREATE TRIGGER items_notify     AFTER INSERT OR UPDATE ON items
  FOR EACH ROW EXECUTE FUNCTION omnis_notify_item();
CREATE TRIGGER threads_notify   AFTER INSERT OR UPDATE ON threads
  FOR EACH ROW EXECUTE FUNCTION omnis_notify_thread();
CREATE TRIGGER approvals_notify AFTER INSERT OR UPDATE ON pending_approvals
  FOR EACH ROW EXECUTE FUNCTION omnis_notify_approval();
CREATE TRIGGER tasks_notify     AFTER INSERT OR UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION omnis_notify_task();
CREATE TRIGGER sessions_notify  AFTER INSERT OR UPDATE ON agent_sessions
  FOR EACH ROW EXECUTE FUNCTION omnis_notify_session();
CREATE TRIGGER jobs_notify      AFTER INSERT OR UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION omnis_notify_job();
```

- [ ] 4. 테스트를 돌려 통과를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/db test
```
기대: `Tests  38 passed (38)`.

- [ ] 5. 커밋한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-A04: 0007_notify.sql — NOTIFY 6채널 트리거(id-only 페이로드)

- omnis_item/thread/approval/task/session/job 트리거 + 함수
- omnis_approval은 pending|decided일 때만, omnis_session은 runtime 조인
- omnis_control은 테이블이 없으므로 커널이 직접 쏜다(A3-D7)
- 모든 페이로드가 8,000B 한도 안

Implemented-by: Claude Sonnet

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 10: ddl-0008-publication (US-A04, tier: Sonnet)

**스토리 US-A04** (계속) — `0008_publication.sql`: `CREATE PUBLICATION zero_omnis`(컬럼 리스트 포함).

**읽을 곳**: A3 §7(publication SQL 전문 + include/exclude 판정표 + "`label_rules`도 컬럼 리스트가 필요하다(`probe_embedding` 제외)" + 제외 테이블 목록), A3-D8(화이트리스트), 계약 §7(복제 테이블 목록과 좁힌 `items` 컬럼 리스트).

**A3가 펼치지 않은 것 하나**: A3 §7의 SQL 블록은 가독성 때문에 `items`만 컬럼을 펼쳤고 본문이 "실제 `0008_publication.sql`은 `label_rules`도 같은 방식으로 컬럼을 나열한다"라고 지시한다. 이 태스크가 그 지시를 이행한다 — `label_rules`에서 `probe_embedding`만 뺀 15개 컬럼을 나열한다.

**만들지 않을 것(YAGNI)**: 복제 슬롯 생성(zero-cache가 만든다), `zero_cvr` 스키마(A6 소관), Zero permission DSL(TS 쪽, US-A21), `idle_replication_slot_timeout`(A6 소유).

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/packages/db/migrations/0008_publication.sql`
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/db/test/integration/schema-0008.test.ts`

**Interfaces:**
- Consumes: `0002`~`0006`의 테이블 전부.
- Produces: publication `zero_omnis`. US-A21(`zeroSchema`)이 이 publication의 테이블·컬럼 집합과 1:1이어야 한다.

### Steps

- [ ] 1. 실패하는 테스트를 쓴다. `/Users/logankim/AI-Workspaces/omnis/packages/db/test/integration/schema-0008.test.ts`:

```ts
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, query } from "@omnis/db";

let pool: Pool;
beforeAll(() => {
  pool = createPool();
});
afterAll(async () => {
  await pool.end();
});

describe("0008_publication", () => {
  it("publishes exactly the 16 whitelisted tables", async () => {
    const rows = await query<{ tablename: string }>(
      pool,
      `SELECT tablename FROM pg_publication_tables WHERE pubname = 'zero_omnis' ORDER BY tablename`,
    );
    expect(rows.map((r) => r.tablename)).toEqual([
      "accounts",
      "agent_runtimes",
      "agent_sessions",
      "calendar_events",
      "digests",
      "identities",
      "item_labels",
      "items",
      "label_rules",
      "labels",
      "notes",
      "pending_approvals",
      "persons",
      "tasks",
      "thread_labels",
      "threads",
    ]);
  });

  it("excludes the tables A3 §7 says must never reach the phone", async () => {
    const rows = await query<{ tablename: string }>(
      pool,
      `SELECT tablename FROM pg_publication_tables
        WHERE pubname = 'zero_omnis' AND tablename = ANY($1)`,
      [[
        "account_secrets",
        "agent_runs",
        "audit_log",
        "entities",
        "events",
        "jobs",
        "memories",
        "person_merges",
        "relations",
      ]],
    );
    expect(rows).toEqual([]);
  });

  it("narrows items to the 24 columns in A3 §7 (no embedding, no search_tsv)", async () => {
    const rows = await query<{ attnames: string[] }>(
      pool,
      `SELECT attnames FROM pg_publication_tables WHERE pubname='zero_omnis' AND tablename='items'`,
    );
    const cols = rows[0]?.attnames ?? [];
    expect(cols).toHaveLength(24);
    expect(cols).toContain("sensitivity");
    expect(cols).toContain("meta");
    expect(cols).not.toContain("embedding");
    expect(cols).not.toContain("search_tsv");
  });

  it("narrows label_rules so probe_embedding is not replicated", async () => {
    const rows = await query<{ attnames: string[] }>(
      pool,
      `SELECT attnames FROM pg_publication_tables WHERE pubname='zero_omnis' AND tablename='label_rules'`,
    );
    const cols = rows[0]?.attnames ?? [];
    expect(cols).toContain("prompt");
    expect(cols).toContain("active");
    expect(cols).not.toContain("probe_embedding");
  });
});
```

- [ ] 2. 테스트를 돌려 실패를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/db test
```
기대 실패: `expected [] to deeply equal [ 'accounts', 'agent_runtimes', ... ]`.

- [ ] 3. `/Users/logankim/AI-Workspaces/omnis/packages/db/migrations/0008_publication.sql`을 쓴다.

```sql
-- 0008_publication.sql
-- A3 §7 / A3-D8: Zero 복제는 화이트리스트다. 새 테이블은 명시적으로 추가하지 않으면 동기화되지 않는다.
-- 제외: account_secrets(비밀), events(cold), audit_log(감사), agent_runs(비용·감사),
--       memories/entities/relations(서버 쿼리), person_merges, jobs.

CREATE PUBLICATION zero_omnis FOR TABLE
  accounts, threads, calendar_events, persons, identities,
  labels, item_labels, thread_labels,
  tasks, agent_runtimes, agent_sessions,
  pending_approvals, notes, digests,
  -- items만 컬럼 리스트로 좁힌다: 768d 임베딩과 생성 컬럼을 폰까지 끌고 가지 않는다.
  items (id, thread_id, account_id, external_id, kind, status, scope, sensitivity,
         author_person_id, author_agent_id, author_is_me, in_reply_to,
         subject, body, body_html, attachments, tool, sent_at, received_at,
         source_hash, idempotency_key, outbox_claimed_at, fail_reason, meta),
  -- label_rules는 probe_embedding만 뺀다(A3 §7 본문 지시).
  label_rules (id, label_id, prompt, rule, rule_by, rule_at, tier,
               positives, negatives, hits_30d, corrections_30d,
               pinned_by_user, active, created_at, updated_at);
```

> 이 publication을 읽는 복제 유저는 `0001`이 만든 **`omnis_sync`**(`REPLICATION` + SELECT)다. zero-cache의 `ZERO_UPSTREAM_DB` 접속 문자열이 이 role을 쓴다(계약 §7의 `zero_replication`은 옛 이름 — 쓰지 않는다).

> `items`의 컬럼 리스트는 `id`부터 `meta`까지 **24개**다(`embedding`·`search_tsv` 2개가 빠진 값). 테스트가 이 숫자를 고정한다 — `pg_publication_tables.attnames`의 길이로 직접 센다.

- [ ] 4. 테스트를 돌려 통과를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/db test
```
기대: `Tests  42 passed (42)`.

- [ ] 5. 커밋한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-A04: 0008_publication.sql — zero_omnis 화이트리스트 publication

- 복제 16개 테이블, items는 24컬럼(embedding/search_tsv 제외), label_rules는 probe_embedding 제외
- account_secrets/events/audit_log/agent_runs/memories/entities/relations/person_merges/jobs 제외

Implemented-by: Claude Sonnet

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 11: calendar-query-acceptance (US-A04, tier: Sonnet)

**스토리 US-A04의 명시적 인수 기준** — "US-A02가 만든 `calendar_events`에 대해 `attendees_count BETWEEN 1 AND 8` 조회(A4 §7.1 미팅-종료 트리거의 전제)와 `end_at` 기준 48시간 윈도 조회(A3 §12 (5b), A4 §7.5 지표의 전제)가 둘 다 성공해야 한다." 이 태스크는 그 두 조회를 실행 가능한 테스트로 고정한다.

**읽을 곳**: A3 §12 (5)·(5b)(팔로업 큐 / 48시간 지표 쿼리 전문), A3 §2.1(조인 규칙 — 1 이벤트 = 1 `items` row + 1 `calendar_events` row, `items.sent_at`에 `start_at`을 넣는다).

**만들지 않을 것(YAGNI)**: 팔로업 루프 자체(A4 §7, Phase B), `digests.metrics` 쓰기(밤 다이제스트 잡, Phase B), 쿼리를 감싸는 TS 헬퍼(아직 호출자가 없다 — 이 태스크는 SQL이 도는지만 증명한다).

**Files:**
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/db/test/integration/calendar-queries.test.ts`

**Interfaces:**
- Consumes: `0002`의 `accounts`/`threads`/`items`/`calendar_events`/`persons`.
- Produces: 없음(인수 테스트만). A3 §12 (5)/(5b) SQL이 스키마와 맞는다는 증거.

### Steps

- [ ] 1. 인수 테스트를 쓴다. `/Users/logankim/AI-Workspaces/omnis/packages/db/test/integration/calendar-queries.test.ts`:

```ts
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, one, query, tx } from "@omnis/db";

let pool: Pool;
let personId = "";
let accountId = "";

beforeAll(async () => {
  pool = createPool();
  const ids = await tx(pool, async (c) => {
    const acc = await one<{ id: string }>(
      c,
      `INSERT INTO accounts (channel, external_id, display) VALUES ('gcal','acc-cal','cal') RETURNING id`,
    );
    const person = await one<{ id: string }>(
      c,
      `INSERT INTO persons (display_name, org) VALUES ('Mina Park','Davich') RETURNING id`,
    );
    const thread = await one<{ id: string }>(
      c,
      `INSERT INTO threads (account_id, external_id, kind, participants)
       VALUES ($1,'cal-main','calendar', ARRAY[$2]::uuid[]) RETURNING id`,
      [acc.id, person.id],
    );
    // A3 §2.1 조인 규칙: items.sent_at = start_at
    const item = await one<{ id: string }>(
      c,
      `INSERT INTO items (thread_id, account_id, kind, subject, body, sent_at)
       VALUES ($1,$2,'event','PoC 킥오프','', now() - interval '3 days') RETURNING id`,
      [thread.id, acc.id],
    );
    await query(
      c,
      `INSERT INTO calendar_events (item_id, account_id, external_id, start_at, end_at, attendees)
       VALUES ($1,$2,'ev-acc', now() - interval '3 days', now() - interval '3 days' + interval '1 hour',
               '[{"email":"mina@davich.kr"},{"email":"logan@onward.lab"}]'::jsonb)`,
      [item.id, acc.id],
    );
    return { accountId: acc.id, personId: person.id };
  });
  accountId = ids.accountId;
  personId = ids.personId;
});
afterAll(async () => {
  await pool.end();
});

describe("US-A04 acceptance: calendar queries (A4 §7.1, A3 §12 5b)", () => {
  it("selects meetings whose attendees_count is between 1 and 8", async () => {
    const rows = await query<{ id: string; attendees_count: number }>(
      pool,
      `SELECT ce.id, ce.attendees_count
         FROM calendar_events ce
        WHERE ce.attendees_count BETWEEN 1 AND 8
          AND ce.status <> 'cancelled'
          AND ce.account_id = $1`,
      [accountId],
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]?.attendees_count).toBe(2);
  });

  it("runs the A3 §12 (5b) 48-hour missed-followup metric query", async () => {
    const rows = await query<{ missed_followups: string; who: string[] | null }>(
      pool,
      `WITH met AS (
         SELECT DISTINCT unnest(t.participants) AS person_id, max(ce.end_at) AS met_at
           FROM threads t
           JOIN items i  ON i.thread_id = t.id AND i.kind = 'event'
           JOIN calendar_events ce ON ce.item_id = i.id
          WHERE t.kind = 'calendar'
            AND ce.status <> 'cancelled'
            AND ce.end_at BETWEEN now() - interval '14 days' AND now() - $1::interval
          GROUP BY 1
       )
       SELECT count(*)::text AS missed_followups, array_agg(p.display_name) AS who
         FROM met m JOIN persons p ON p.id = m.person_id AND p.merged_into IS NULL
        WHERE NOT EXISTS (
          SELECT 1 FROM items i2
          JOIN threads t2 ON t2.id = i2.thread_id
          WHERE i2.author_is_me AND i2.status = 'sent'
            AND i2.sent_at > m.met_at AND i2.sent_at <= m.met_at + interval '48 hours'
            AND p.id = ANY (t2.participants))`,
      ["48 hours"],
    );
    expect(rows[0]?.missed_followups).toBe("1");
    expect(rows[0]?.who).toContain("Mina Park");
  });

  it("drops the person from the metric once I replied inside 48 hours", async () => {
    const thread = await one<{ id: string }>(
      pool,
      `SELECT id FROM threads WHERE external_id = 'cal-main'`,
    );
    await query(
      pool,
      `INSERT INTO items (thread_id, account_id, kind, body, status, author_is_me, sent_at)
       VALUES ($1,$2,'message','감사합니다','sent', true, now() - interval '2 days')`,
      [thread.id, accountId],
    );
    const rows = await query<{ missed_followups: string }>(
      pool,
      `WITH met AS (
         SELECT DISTINCT unnest(t.participants) AS person_id, max(ce.end_at) AS met_at
           FROM threads t
           JOIN items i  ON i.thread_id = t.id AND i.kind = 'event'
           JOIN calendar_events ce ON ce.item_id = i.id
          WHERE t.kind = 'calendar'
            AND ce.status <> 'cancelled'
            AND ce.end_at BETWEEN now() - interval '14 days' AND now() - $1::interval
          GROUP BY 1
       )
       SELECT count(*)::text AS missed_followups
         FROM met m JOIN persons p ON p.id = m.person_id AND p.merged_into IS NULL
        WHERE NOT EXISTS (
          SELECT 1 FROM items i2
          JOIN threads t2 ON t2.id = i2.thread_id
          WHERE i2.author_is_me AND i2.status = 'sent'
            AND i2.sent_at > m.met_at AND i2.sent_at <= m.met_at + interval '48 hours'
            AND p.id = ANY (t2.participants))`,
      ["48 hours"],
    );
    expect(rows[0]?.missed_followups).toBe("0");
    expect(personId).not.toBe("");
  });
});
```

- [ ] 2. 테스트를 돌린다. 스키마가 이미 있으므로 이번에는 바로 통과해야 한다 — 실패하면 `0002`의 `calendar_events`나 `threads.participants`가 A3와 어긋난 것이므로 Task 4로 돌아간다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/db test
```
기대: `Tests  45 passed (45)`.

- [ ] 3. US-A04 검증 명령을 그대로 돌려 스토리를 닫는다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && DATABASE_URL=postgres://logan@127.0.0.1:5432/omnis pnpm db:migrate && pnpm --filter @omnis/db test
```
기대: `applied 4: 0005_memory.sql, 0006_kernel.sql, 0007_notify.sql, 0008_publication.sql` 후 전부 통과.

- [ ] 4. 커밋한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-A04: 캘린더 인수 기준 — attendees_count 1..8 조회와 48시간 윈도 지표

- A4 §7.1 미팅-종료 트리거 전제: attendees_count BETWEEN 1 AND 8 조회 성공
- A3 §12 (5b) 48시간 미발송 지표 쿼리가 스키마 위에서 그대로 동작
- 48시간 안에 내가 보낸 item이 생기면 지표가 0으로 떨어지는 것까지 확인

Implemented-by: Claude Sonnet

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 12: kernel-events-tiers (US-A05, tier: Opus)

**스토리 US-A05** — 목표: `packages/kernel` 이벤트 버스(ephemeral/durable/cold 3티어 라우팅, NOTIFY 8000B id-only) / 산출물: `packages/kernel/src/events.ts` / 검증 명령: `pnpm --filter @omnis/kernel test:integration` / 티어: Opus. 의존: A04.

**읽을 곳**: 마스터 §7(이벤트 3티어 정의), A3-D14 + 계약 §0-9(**ephemeral은 WS 팬아웃 전용 — NOTIFY도 저장도 없다**), A3-D7(NOTIFY는 허브 내부 팬아웃 전용, id만), 계약 §5(`Events` 인터페이스 주석), 계약 §4(채널·페이로드 표), 계약 §9(로그 형식).

**3티어의 정확한 의미(계약 §5 주석 그대로)**:
- `ephemeral` — 프로세스 안 구독자에게만 전달한다. DB를 건드리지 않고 NOTIFY도 쏘지 않는다. 허브 WS 팬아웃이 유일한 소비자다.
- `durable` — **호출자가 이미 쓴 row의 id를 NOTIFY로 알린다.** row를 쓰는 것은 emit의 일이 아니다. `items`/`threads`/`pending_approvals`/`tasks`/`agent_sessions`/`jobs`는 `0007`의 트리거가 이미 쏘므로 emit을 부를 필요가 없다 — emit이 필요한 곳은 트리거가 없는 `omnis_control`(kill switch, Task 19)이다.
- `cold` — `events` 테이블 INSERT. `events`에는 NOTIFY 트리거가 없으므로 아무 데도 팬아웃되지 않는다.

**만들지 않을 것(YAGNI)**: 이벤트 리플레이, 구독 필터 DSL, 백프레셔 큐, 재연결 백오프(Task 25의 graceful shutdown이 닫고 허브가 재시작한다 — Phase A 허브는 LaunchDaemon이 되살린다), 트랜잭션 안에서 emit하는 경로.

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/package.json`, `/Users/logankim/AI-Workspaces/omnis/packages/kernel/tsconfig.json`, `/Users/logankim/AI-Workspaces/omnis/packages/kernel/vitest.config.ts`, `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/logger.ts`, `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/events.ts`, `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/index.ts`
- Modify: `/Users/logankim/AI-Workspaces/omnis/tsconfig.json`(references에 kernel 추가)
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/events.test.ts`

**Interfaces:**
- Consumes: `createPool`, `query`, `NOTIFY_CHANNELS` (`@omnis/db`, Task 1).
- Produces (`@omnis/kernel`): `type EventTier = "ephemeral" | "durable" | "cold"` · `interface Events { emit(tier: EventTier, kind: string, payload: { id?: string; [k: string]: unknown }): Promise<void>; subscribe(channel: string, fn: (p: Record<string, unknown>) => void): () => void }` (계약 §5) · `interface Logger { debug/info/warn/error(msg: string, extra?: Record<string, unknown>): void }` · `createLogger(pkg: string, traceId?: string | null): Logger`(계약 §5와 동일 시그니처 — 아래 구현은 `traceId: string | null = null` 기본값으로 둘 다 만족한다) · `createEvents(deps: { pool: Pool; logger: Logger }): Events & { close(): Promise<void> }` · `DURABLE_CHANNEL: Readonly<Record<string, string>>` · `NOTIFY_MAX_BYTES: 8000`. `createKernel`은 Task 22가 이 조각들을 모아 만든다.

### Steps

- [ ] 1. 패키지 골격을 만든다.

`/Users/logankim/AI-Workspaces/omnis/packages/kernel/package.json`:
```json
{
  "name": "@omnis/kernel",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./zero": { "types": "./dist/zero-schema.d.ts", "default": "./dist/zero-schema.js" }
  },
  "scripts": {
    "build": "tsc --build",
    "test": "vitest run",
    "test:integration": "vitest run test/integration"
  },
  "dependencies": { "@omnis/db": "workspace:*", "pg": "8.13.1" },
  "devDependencies": { "@types/pg": "8.11.10" }
}
```

> `./zero` 서브패스(계약 §7)는 US-A21이 `src/zero-schema.ts`를 만들 자리다. 이 태스크는 파일을 만들지 않는다 — `exports` 항목만 미리 둔다.

`/Users/logankim/AI-Workspaces/omnis/packages/kernel/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"],
  "references": [{ "path": "../db" }]
}
```

`/Users/logankim/AI-Workspaces/omnis/packages/kernel/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import { omnisAlias } from "../../vitest.shared.js";

export default defineConfig({
  resolve: { alias: omnisAlias },
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["../../vitest.global-setup.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
```

`/Users/logankim/AI-Workspaces/omnis/tsconfig.json`의 `references`를 갱신:
```json
{
  "files": [],
  "references": [{ "path": "./packages/db" }, { "path": "./packages/kernel" }]
}
```

- [ ] 2. 실패하는 통합 테스트를 쓴다. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/events.test.ts`:

```ts
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, one, query } from "@omnis/db";
import { type Events, createEvents, createLogger } from "@omnis/kernel";

let pool: Pool;
let events: Events & { close(): Promise<void> };

beforeAll(() => {
  pool = createPool();
  events = createEvents({ pool, logger: createLogger("@omnis/kernel") });
});
afterAll(async () => {
  await events.close();
  await pool.end();
});

function waitFor<T>(get: () => T | undefined, ms = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = setInterval(() => {
      const v = get();
      if (v !== undefined) {
        clearInterval(tick);
        resolve(v);
      } else if (Date.now() - started > ms) {
        clearInterval(tick);
        reject(new Error("timed out waiting for event"));
      }
    }, 25);
  });
}

describe("events — ephemeral tier", () => {
  it("delivers in-process only: no row, no NOTIFY", async () => {
    const got: Array<Record<string, unknown>> = [];
    const off = events.subscribe("turn.item.delta", (p) => got.push(p));

    const before = await one<{ n: string }>(pool, `SELECT count(*)::text AS n FROM events`);
    await events.emit("ephemeral", "turn.item.delta", { id: "t-1", text: "hel" });
    await events.emit("ephemeral", "turn.item.delta", { id: "t-1", text: "lo" });
    const after = await one<{ n: string }>(pool, `SELECT count(*)::text AS n FROM events`);

    expect(got).toEqual([
      { id: "t-1", text: "hel" },
      { id: "t-1", text: "lo" },
    ]);
    expect(after.n).toBe(before.n);

    off();
    await events.emit("ephemeral", "turn.item.delta", { id: "t-1", text: "!" });
    expect(got).toHaveLength(2);
  });
});

describe("events — durable tier", () => {
  it("notifies the mapped channel with the id-only payload", async () => {
    let received: Record<string, unknown> | undefined;
    const off = events.subscribe("omnis_control", (p) => {
      received = p;
    });
    await events.emit("durable", "control.kill_switch", { kill_switch: true });
    const got = await waitFor(() => received);
    expect(got).toEqual({ kill_switch: true });
    off();
  });

  it("refuses an unmapped kind and an oversized payload", async () => {
    await expect(events.emit("durable", "not.a.kind", { id: "x" })).rejects.toThrow(
      /no NOTIFY channel/,
    );
    await expect(
      events.emit("durable", "control.kill_switch", { id: "x", blob: "y".repeat(8100) }),
    ).rejects.toThrow(/NOTIFY payload/);
  });
});

describe("events — cold tier", () => {
  it("inserts into events and never notifies", async () => {
    let leaked = false;
    const off = events.subscribe("omnis_item", () => {
      leaked = true;
    });
    await events.emit("cold", "adapter.error", {
      id: "11111111-1111-1111-1111-111111111111",
      actor: "system",
      target_table: "accounts",
      reason: "rate limited",
    });
    const row = await one<{ kind: string; actor: string; target_table: string; payload: Record<string, unknown> }>(
      pool,
      `SELECT kind, actor, target_table, payload FROM events WHERE kind = 'adapter.error' ORDER BY seq DESC LIMIT 1`,
    );
    expect(row.actor).toBe("system");
    expect(row.target_table).toBe("accounts");
    expect(row.payload.reason).toBe("rate limited");
    await new Promise((r) => setTimeout(r, 150));
    expect(leaked).toBe(false);
    off();
  });
});

describe("events — subscribe", () => {
  it("rejects an unknown NOTIFY-looking channel", () => {
    expect(() => events.subscribe("omnis_bogus", () => undefined)).toThrow(/unknown omnis_ channel/);
  });

  it("keeps other subscribers alive when one throws", async () => {
    const seen: string[] = [];
    const offA = events.subscribe("local.test", () => {
      throw new Error("boom");
    });
    const offB = events.subscribe("local.test", () => seen.push("b"));
    await events.emit("ephemeral", "local.test", {});
    expect(seen).toEqual(["b"]);
    offA();
    offB();
    await query(pool, "SELECT 1");
  });
});
```

- [ ] 3. 테스트를 돌려 실패를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm install && pnpm --filter @omnis/kernel test:integration
```
기대 실패: `Failed to resolve import "@omnis/kernel"`.

- [ ] 4. 로거를 쓴다(계약 §9의 한 줄 JSON 형식). `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/logger.ts`:

```ts
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(msg: string, extra?: Record<string, unknown>): void;
  info(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, extra?: Record<string, unknown>): void;
}

/** 계약 §9: 한 줄 JSON을 stdout으로. 필수 키 ts/level/pkg/msg/trace_id. 시크릿은 어떤 키에도 넣지 않는다. */
export function createLogger(pkg: string, traceId: string | null = null): Logger {
  const write = (level: LogLevel, msg: string, extra?: Record<string, unknown>): void => {
    process.stdout.write(
      `${JSON.stringify({ ts: new Date().toISOString(), level, pkg, msg, trace_id: traceId, ...extra })}\n`,
    );
  };
  return {
    debug: (m, e) => write("debug", m, e),
    info: (m, e) => write("info", m, e),
    warn: (m, e) => write("warn", m, e),
    error: (m, e) => write("error", m, e),
  };
}
```

- [ ] 5. 이벤트 버스를 쓴다. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/events.ts`:

```ts
import { NOTIFY_CHANNELS, query } from "@omnis/db";
import type { Pool, PoolClient } from "pg";
import type { Logger } from "./logger.js";

export type EventTier = "ephemeral" | "durable" | "cold";

export interface Events {
  /** ephemeral: 프로세스 안 팬아웃만(저장·NOTIFY 없음, A3-D14).
   *  durable: 호출자가 이미 쓴 row의 id를 NOTIFY로 알린다.
   *  cold: events 테이블 INSERT(트리거가 없어 NOTIFY 없음). */
  emit(tier: EventTier, kind: string, payload: { id?: string; [k: string]: unknown }): Promise<void>;
  subscribe(channel: string, fn: (p: Record<string, unknown>) => void): () => void;
}

/** durable 이벤트 kind → NOTIFY 채널(계약 §4). 여기 없는 kind는 durable로 쏠 수 없다. */
export const DURABLE_CHANNEL: Readonly<Record<string, string>> = {
  "item.created": "omnis_item",
  "item.updated": "omnis_item",
  "thread.created": "omnis_thread",
  "thread.updated": "omnis_thread",
  "approval.requested": "omnis_approval",
  "approval.decided": "omnis_approval",
  "task.created": "omnis_task",
  "task.updated": "omnis_task",
  "session.updated": "omnis_session",
  "job.due": "omnis_job",
  "control.kill_switch": "omnis_control",
};

/** A3 §6.2: NOTIFY 페이로드 한도. */
export const NOTIFY_MAX_BYTES = 8000;

export interface EventsDeps {
  pool: Pool;
  logger: Logger;
}

export function createEvents(deps: EventsDeps): Events & { close(): Promise<void> } {
  const { pool, logger } = deps;
  const subs = new Map<string, Set<(p: Record<string, unknown>) => void>>();
  let listener: PoolClient | null = null;
  let closed = false;

  function fanout(channel: string, payload: Record<string, unknown>): void {
    const fns = subs.get(channel);
    if (fns === undefined) return;
    for (const fn of [...fns]) {
      try {
        fn(payload);
      } catch (e) {
        logger.error("subscriber threw", {
          channel,
          err: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  async function ensureListener(): Promise<void> {
    if (listener !== null || closed) return;
    const c = await pool.connect();
    c.on("notification", (msg) => {
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(msg.payload ?? "{}") as Record<string, unknown>;
      } catch {
        logger.warn("unparsable NOTIFY payload", { channel: msg.channel });
        return;
      }
      fanout(msg.channel, payload);
    });
    // 채널 이름은 식별자라 파라미터화할 수 없다. NOTIFY_CHANNELS는 고정 상수이므로 주입 경로가 없다.
    for (const ch of NOTIFY_CHANNELS) {
      await c.query(`LISTEN ${ch}`);
    }
    listener = c;
  }

  return {
    async emit(tier, kind, payload) {
      if (tier === "ephemeral") {
        fanout(kind, payload);
        return;
      }
      if (tier === "durable") {
        const channel = DURABLE_CHANNEL[kind];
        if (channel === undefined) {
          throw new Error(`durable event "${kind}" has no NOTIFY channel (kernel/events.ts)`);
        }
        const text = JSON.stringify(payload);
        const bytes = Buffer.byteLength(text, "utf8");
        if (bytes >= NOTIFY_MAX_BYTES) {
          throw new Error(`NOTIFY payload for "${kind}" is ${bytes}B, limit ${NOTIFY_MAX_BYTES}`);
        }
        await query(pool, "SELECT pg_notify($1, $2)", [channel, text]);
        return;
      }
      await query(
        pool,
        `INSERT INTO events (kind, actor, target_table, target_id, payload)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [
          kind,
          typeof payload.actor === "string" ? payload.actor : "system",
          typeof payload.target_table === "string" ? payload.target_table : null,
          typeof payload.id === "string" && /^[0-9a-f-]{36}$/.test(payload.id) ? payload.id : null,
          JSON.stringify(payload),
        ],
      );
    },

    subscribe(channel, fn) {
      if (channel.startsWith("omnis_") && !NOTIFY_CHANNELS.includes(channel)) {
        throw new Error(`unknown omnis_ channel: ${channel}`);
      }
      let fns = subs.get(channel);
      if (fns === undefined) {
        fns = new Set();
        subs.set(channel, fns);
      }
      fns.add(fn);
      if (channel.startsWith("omnis_")) {
        void ensureListener().catch((e: unknown) => {
          logger.error("LISTEN failed", { err: e instanceof Error ? e.message : String(e) });
        });
      }
      return () => {
        const set = subs.get(channel);
        set?.delete(fn);
      };
    },

    async close() {
      closed = true;
      subs.clear();
      const c = listener;
      listener = null;
      if (c !== null) {
        c.removeAllListeners("notification");
        c.release(true); // 이 커넥션은 LISTEN 상태이므로 풀에 돌려주지 않고 버린다
      }
    },
  };
}
```

- [ ] 6. 배럴을 쓴다. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/index.ts`:

```ts
export { DURABLE_CHANNEL, NOTIFY_MAX_BYTES, createEvents } from "./events.js";
export type { EventTier, Events, EventsDeps } from "./events.js";
export { createLogger } from "./logger.js";
export type { LogLevel, Logger } from "./logger.js";
```

- [ ] 7. 테스트를 돌려 통과를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
```
기대: `Tests  6 passed (6)`.

- [ ] 8. 타입체크를 돌린다(의존 방향이 컴파일 타임에 지켜지는지 확인, A7 §2).

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm typecheck
```
기대: 에러 0.

- [ ] 9. 커밋한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-A05: 커널 이벤트 버스 3티어 라우팅

- ephemeral: 프로세스 내 팬아웃만, row도 NOTIFY도 만들지 않는다(A3-D14)
- durable: DURABLE_CHANNEL 매핑으로 pg_notify, 8000B 한도 초과 시 throw
- cold: events 테이블 INSERT(NOTIFY 트리거 없음)
- subscribe는 omnis_ 채널 화이트리스트만 LISTEN, 구독자 예외가 다른 구독자를 죽이지 않는다
- pnpm --filter @omnis/kernel test:integration 통과

Implemented-by: Claude Opus

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 13: notify-fanout (US-A05, tier: Opus)

**스토리 US-A05** (계속) — `0007`의 DB 트리거와 커널 `subscribe()`가 실제로 이어져서, 아무도 `emit`을 부르지 않아도 row 쓰기만으로 팬아웃이 도는지를 고정한다. 이게 "durable 티어는 호출자가 이미 쓴 row의 id를 알린다"의 실제 동작이다.

**읽을 곳**: A3 §6.2(트리거 표), 계약 §5(`Events` 주석), Task 9가 만든 트리거 6개.

**만들지 않을 것(YAGNI)**: WS 서버(Task 24가 `/bridge`를 열 자리만 남기고, WS 자체는 US-A17), 팬아웃 메트릭, 구독자별 큐.

**Files:**
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/notify-fanout.test.ts`

**Interfaces:**
- Consumes: `createEvents`, `createLogger` (Task 12), `0007`의 트리거.
- Produces: 없음(행동 계약 테스트).

### Steps

- [ ] 1. 테스트를 쓴다. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/notify-fanout.test.ts`:

```ts
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, one, query } from "@omnis/db";
import { type Events, createEvents, createLogger } from "@omnis/kernel";

let pool: Pool;
let events: Events & { close(): Promise<void> };
const received: Array<{ channel: string; payload: Record<string, unknown> }> = [];

beforeAll(async () => {
  pool = createPool();
  events = createEvents({ pool, logger: createLogger("@omnis/kernel") });
  for (const ch of ["omnis_item", "omnis_thread", "omnis_approval"]) {
    events.subscribe(ch, (p) => received.push({ channel: ch, payload: p }));
  }
  // LISTEN이 걸릴 때까지 한 박자 기다린다(subscribe는 비동기로 커넥션을 잡는다).
  await new Promise((r) => setTimeout(r, 300));
});
afterAll(async () => {
  await events.close();
  await pool.end();
});

function waitFor(pred: () => boolean, ms = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = setInterval(() => {
      if (pred()) {
        clearInterval(tick);
        resolve();
      } else if (Date.now() - started > ms) {
        clearInterval(tick);
        reject(new Error("timed out waiting for NOTIFY"));
      }
    }, 25);
  });
}

describe("DB trigger → kernel subscriber", () => {
  it("delivers omnis_thread and omnis_item without anyone calling emit()", async () => {
    received.length = 0;
    const acc = await one<{ id: string }>(
      pool,
      `INSERT INTO accounts (channel, external_id, display) VALUES ('slack','T-fan:U','fan') RETURNING id`,
    );
    const thr = await one<{ id: string }>(
      pool,
      `INSERT INTO threads (account_id, external_id, kind) VALUES ($1,'fan-1','dm') RETURNING id`,
      [acc.id],
    );
    const item = await one<{ id: string }>(
      pool,
      `INSERT INTO items (thread_id, account_id, kind, body, sent_at)
       VALUES ($1,$2,'message','fanout', now()) RETURNING id`,
      [thr.id, acc.id],
    );

    await waitFor(() => received.some((r) => r.payload.id === item.id));
    const itemMsg = received.find((r) => r.channel === "omnis_item");
    expect(itemMsg?.payload).toEqual({ id: item.id, thread_id: thr.id, op: "insert" });
    expect(received.some((r) => r.channel === "omnis_thread" && r.payload.id === thr.id)).toBe(true);
  });

  it("coalesces identical payloads inside one transaction (A3 §6.2)", async () => {
    received.length = 0;
    const thr = await one<{ id: string }>(pool, `SELECT id FROM threads WHERE external_id='fan-1'`);
    await query(
      pool,
      `DO $$
       DECLARE t uuid := (SELECT id FROM threads WHERE external_id = 'fan-1');
       BEGIN
         UPDATE threads SET unread_count = unread_count + 1 WHERE id = t;
         UPDATE threads SET unread_count = unread_count + 1 WHERE id = t;
       END $$;`,
    );
    await waitFor(() => received.some((r) => r.channel === "omnis_thread"));
    await new Promise((r) => setTimeout(r, 200));
    const threadMsgs = received.filter((r) => r.channel === "omnis_thread" && r.payload.id === thr.id);
    expect(threadMsgs).toHaveLength(1);
  });

  it("delivers omnis_approval on insert and on decide, but not on executing", async () => {
    received.length = 0;
    const a = await one<{ id: string }>(
      pool,
      `INSERT INTO pending_approvals (action, args, description)
       VALUES ('delegate','{}'::jsonb,'fanout') RETURNING id`,
    );
    await waitFor(() => received.some((r) => r.channel === "omnis_approval"));
    expect(received.at(-1)?.payload).toEqual({ id: a.id, state: "pending" });

    received.length = 0;
    await query(
      pool,
      `UPDATE pending_approvals SET state='decided', decision='ignore', decided_at=now() WHERE id=$1`,
      [a.id],
    );
    await waitFor(() => received.length > 0);
    expect(received.at(-1)?.payload).toEqual({ id: a.id, state: "decided" });

    received.length = 0;
    await query(pool, `UPDATE pending_approvals SET state='executing' WHERE id=$1`, [a.id]);
    await new Promise((r) => setTimeout(r, 250));
    expect(received).toHaveLength(0);
  });
});
```

- [ ] 2. 테스트를 돌린다. Task 9와 Task 12가 모두 맞았다면 바로 통과한다 — 실패하면 어느 쪽이 깨졌는지 실패 메시지가 가른다(`timed out waiting for NOTIFY` = 트리거 또는 LISTEN 문제, payload 불일치 = 트리거의 `json_build_object` 문제).

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
```
기대: `Tests  9 passed (9)`.

- [ ] 3. US-A05 검증 명령으로 스토리를 닫고 커밋한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration && git add -A && git commit -m "US-A05: DB 트리거 → 커널 subscribe 팬아웃 검증

- items/threads INSERT만으로 omnis_item/omnis_thread가 구독자에게 도달
- 같은 트랜잭션의 동일 페이로드는 Postgres가 coalescing(A3 §6.2)
- omnis_approval은 pending/decided만, executing은 조용

Implemented-by: Claude Opus

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 14: scheduler-jobs (US-A06, tier: Opus)

**스토리 US-A06** — 목표: 스케줄러(`jobs` 테이블 + cron 실행기, 최초 job=헬스체크) / 산출물: `packages/kernel/src/scheduler.ts` / 검증 명령: `pnpm --filter @omnis/kernel test:integration` / 티어: Opus. 의존: A05.

**읽을 곳**: 마스터 §7(스케줄러 — 허브 프로세스 안의 cron 테이블, 실행 기록은 events에), A3 §6(`jobs` 컬럼과 `jobs_due_idx`, seed 16개, TZ=Asia/Seoul), 계약 §5(`Scheduler` 인터페이스 주석 — 10초 틱, claim UPDATE 문장 그대로, 실행 후 갱신 목록).

**cron 파서를 직접 쓴다 — 왜**: 계약 §1이 `@omnis/kernel`의 의존을 `@omnis/db`와 `@omnis/protocol`로 못박았으므로 `cron-parser` 같은 외부 라이브러리를 넣을 수 없다. seed 16개가 쓰는 문법은 `*`, `*/n`, `a,b,c`, `a-b` 네 가지뿐이고 TZ는 **Asia/Seoul 하나**다. Asia/Seoul은 DST가 없으므로 고정 +9h 오프셋으로 환산하면 정확하다. 이 두 사실이 파서를 40줄로 줄인다.

**만들지 않을 것(YAGNI)**: 초 단위 필드, `L`/`W`/`#` 확장, 여러 타임존, 분산 리더 선출(허브는 한 프로세스다 — `claimed_at`이 재시작 중복만 막으면 된다), 잡 재시도 백오프(다음 `next_run_at`에 다시 돈다), 잡 히스토리 테이블(`events` cold 티어가 남긴다).

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/cron.ts`, `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/scheduler.ts`
- Modify: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/index.ts`
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/cron.test.ts`, `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/scheduler.test.ts`

**Interfaces:**
- Consumes: `query`, `one` (`@omnis/db`) · `Events`, `Logger` (Task 12).
- Produces (`@omnis/kernel`): `nextRunAt(cron: string, from: Date): Date` · `interface Scheduler { register(name: string, cron: string, handler: () => Promise<void>): void; start(): Promise<void>; stop(): Promise<void> }` (계약 §5) · `createScheduler(deps: SchedulerDeps): Scheduler` · `interface SchedulerDeps { pool: Pool; events: Events; logger: Logger; now?: () => Date; tickMs?: number; isKillSwitchOn?: () => Promise<boolean> }`.

### Steps

- [ ] 1. cron 파서의 실패하는 유닛 테스트를 쓴다(DB가 필요 없으므로 `unit` 프로젝트다). `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/cron.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { nextRunAt } from "@omnis/kernel";

/** KST 기준 시각을 UTC Date로 만든다(Asia/Seoul = UTC+9, DST 없음). */
function kst(iso: string): Date {
  return new Date(`${iso}+09:00`);
}

describe("nextRunAt (5-field cron, TZ=Asia/Seoul)", () => {
  it("handles the A3 seed schedules", () => {
    expect(nextRunAt("30 6 * * *", kst("2026-09-20T05:00:00")).toISOString()).toBe(
      kst("2026-09-20T06:30:00").toISOString(),
    );
    expect(nextRunAt("0 23 * * *", kst("2026-09-20T23:00:00")).toISOString()).toBe(
      kst("2026-09-21T23:00:00").toISOString(),
    );
    expect(nextRunAt("*/10 * * * *", kst("2026-09-20T10:03:00")).toISOString()).toBe(
      kst("2026-09-20T10:10:00").toISOString(),
    );
    expect(nextRunAt("0 9,14,19 * * *", kst("2026-09-20T10:00:00")).toISOString()).toBe(
      kst("2026-09-20T14:00:00").toISOString(),
    );
  });

  it("handles day-of-week ranges and single days", () => {
    // 2026-09-20 is a Sunday; the weekday job must jump to Monday.
    expect(nextRunAt("0 10 * * 1-5", kst("2026-09-20T09:00:00")).toISOString()).toBe(
      kst("2026-09-21T10:00:00").toISOString(),
    );
    // Sunday-only job, asked on Sunday before the hour.
    expect(nextRunAt("0 22 * * 0", kst("2026-09-20T09:00:00")).toISOString()).toBe(
      kst("2026-09-20T22:00:00").toISOString(),
    );
    // Monday-only job.
    expect(nextRunAt("0 4 * * 1", kst("2026-09-20T09:00:00")).toISOString()).toBe(
      kst("2026-09-21T04:00:00").toISOString(),
    );
  });

  it("never returns the instant it was given", () => {
    const at = kst("2026-09-20T06:30:00");
    expect(nextRunAt("30 6 * * *", at).getTime()).toBeGreaterThan(at.getTime());
  });

  it("rejects malformed cron strings", () => {
    expect(() => nextRunAt("30 6 * *", new Date())).toThrow(/5 fields/);
    expect(() => nextRunAt("99 6 * * *", new Date())).toThrow(/out of range/);
    expect(() => nextRunAt("*/0 * * * *", new Date())).toThrow(/step/);
  });
});
```

- [ ] 2. 테스트를 돌려 실패를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test
```
기대 실패: `does not provide an export named 'nextRunAt'`.

- [ ] 3. cron 파서를 쓴다. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/cron.ts`:

```ts
/** A3 §6: 5-field cron, TZ=Asia/Seoul. Asia/Seoul은 DST가 없으므로 고정 +9h로 환산한다.
 *  ponytail: 분 단위 선형 스캔(366일 상한). 잡 실행 직후 한 번만 부르므로 비용이 문제되지 않는다.
 *  DST가 있는 타임존이 필요해지면 Intl.DateTimeFormat 기반 환산으로 갈아끼운다. */
const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;
const MINUTE_MS = 60_000;

function parseField(spec: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const slash = part.split("/");
    const rangePart = slash[0];
    const stepPart = slash[1];
    if (rangePart === undefined || slash.length > 2) throw new Error(`bad cron field: ${part}`);
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) throw new Error(`bad cron step: ${part}`);
    let lo = min;
    let hi = max;
    if (rangePart !== "*") {
      const bounds = rangePart.split("-");
      const a = Number(bounds[0]);
      const b = bounds.length > 1 ? Number(bounds[1]) : a;
      if (!Number.isInteger(a) || !Number.isInteger(b)) throw new Error(`bad cron range: ${part}`);
      lo = a;
      hi = b;
    }
    if (lo < min || hi > max || lo > hi) throw new Error(`cron field out of range: ${part}`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export function nextRunAt(cron: string, from: Date): Date {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`cron must have 5 fields, got ${fields.length}: ${cron}`);
  const field = (i: number): string => {
    const v = fields[i];
    if (v === undefined) throw new Error(`cron field ${i} missing: ${cron}`);
    return v;
  };
  const minutes = parseField(field(0), 0, 59);
  const hours = parseField(field(1), 0, 23);
  const doms = parseField(field(2), 1, 31);
  const months = parseField(field(3), 1, 12);
  const dows = parseField(field(4), 0, 6);
  const domStar = field(2) === "*";
  const dowStar = field(4) === "*";

  let t = Math.floor(from.getTime() / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
  const limit = t + 366 * 24 * 60 * MINUTE_MS;
  for (; t <= limit; t += MINUTE_MS) {
    const seoul = new Date(t + SEOUL_OFFSET_MS);
    if (!minutes.has(seoul.getUTCMinutes())) continue;
    if (!hours.has(seoul.getUTCHours())) continue;
    if (!months.has(seoul.getUTCMonth() + 1)) continue;
    const domOk = doms.has(seoul.getUTCDate());
    const dowOk = dows.has(seoul.getUTCDay());
    // POSIX cron: dom과 dow가 둘 다 제한되면 OR, 하나만 제한되면 그것만 본다.
    const dayOk = domStar && dowStar ? true : domStar ? dowOk : dowStar ? domOk : domOk || dowOk;
    if (dayOk) return new Date(t);
  }
  throw new Error(`no cron occurrence within 366 days: ${cron}`);
}
```

- [ ] 4. cron 유닛 테스트를 돌려 통과를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test -- cron
```
기대: `Tests  4 passed (4)`.

- [ ] 5. 스케줄러의 실패하는 통합 테스트를 쓴다. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/scheduler.test.ts`:

```ts
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createPool, one, query } from "@omnis/db";
import { type Events, type Scheduler, createEvents, createLogger, createScheduler } from "@omnis/kernel";

let pool: Pool;
let events: Events & { close(): Promise<void> };
const logger = createLogger("@omnis/kernel");
const started: Scheduler[] = [];

beforeAll(() => {
  pool = createPool();
  events = createEvents({ pool, logger });
});
afterEach(async () => {
  for (const s of started.splice(0)) await s.stop();
});
afterAll(async () => {
  await events.close();
  await pool.end();
});

function make(extra: Partial<Parameters<typeof createScheduler>[0]> = {}): Scheduler {
  const s = createScheduler({ pool, events, logger, tickMs: 50, ...extra });
  started.push(s);
  return s;
}

describe("scheduler", () => {
  it("upserts a jobs row on register+start and computes next_run_at", async () => {
    const s = make();
    s.register("test_upsert", "0 4 * * *", async () => undefined);
    await s.start();

    const row = await one<{ schedule: string; enabled: boolean; next_run_at: Date; claimed_at: Date | null }>(
      pool,
      `SELECT schedule, enabled, next_run_at, claimed_at FROM jobs WHERE name = 'test_upsert'`,
    );
    expect(row.schedule).toBe("0 4 * * *");
    expect(row.enabled).toBe(true);
    expect(row.claimed_at).toBeNull();
    expect(row.next_run_at.getTime()).toBeGreaterThan(Date.now());
  });

  it("runs a due job exactly once and records ok + next_run_at + a cold event", async () => {
    let runs = 0;
    const s = make();
    s.register("test_due", "*/1 * * * *", async () => {
      runs += 1;
    });
    await s.start();
    await query(pool, `UPDATE jobs SET next_run_at = now() - interval '1 minute' WHERE name = 'test_due'`);
    await new Promise((r) => setTimeout(r, 400));

    expect(runs).toBe(1);
    const row = await one<{ last_status: string; last_error: string | null; next_run_at: Date; claimed_at: Date | null }>(
      pool,
      `SELECT last_status, last_error, next_run_at, claimed_at FROM jobs WHERE name = 'test_due'`,
    );
    expect(row.last_status).toBe("ok");
    expect(row.last_error).toBeNull();
    expect(row.claimed_at).toBeNull();
    expect(row.next_run_at.getTime()).toBeGreaterThan(Date.now());

    const ev = await one<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM events WHERE kind = 'job.run' AND payload->>'name' = 'test_due'`,
    );
    expect(ev.n).toBe("1");
  });

  it("records failed + last_error without crashing the tick", async () => {
    const s = make();
    s.register("test_fail", "*/1 * * * *", async () => {
      throw new Error("handler exploded");
    });
    await s.start();
    await query(pool, `UPDATE jobs SET next_run_at = now() - interval '1 minute' WHERE name = 'test_fail'`);
    await new Promise((r) => setTimeout(r, 400));

    const row = await one<{ last_status: string; last_error: string }>(
      pool,
      `SELECT last_status, last_error FROM jobs WHERE name = 'test_fail'`,
    );
    expect(row.last_status).toBe("failed");
    expect(row.last_error).toContain("handler exploded");
  });

  it("does not touch seeded jobs that have no registered handler", async () => {
    const s = make();
    s.register("test_isolated", "*/1 * * * *", async () => undefined);
    await s.start();
    await query(pool, `UPDATE jobs SET next_run_at = now() - interval '1 hour' WHERE name = 'morning_digest'`);
    await new Promise((r) => setTimeout(r, 300));

    const row = await one<{ last_status: string | null; claimed_at: Date | null }>(
      pool,
      `SELECT last_status, claimed_at FROM jobs WHERE name = 'morning_digest'`,
    );
    expect(row.last_status).toBeNull();
    expect(row.claimed_at).toBeNull();
  });

  it("skips a disabled job", async () => {
    let runs = 0;
    const s = make();
    s.register("test_disabled", "*/1 * * * *", async () => {
      runs += 1;
    });
    await s.start();
    await query(
      pool,
      `UPDATE jobs SET enabled = false, next_run_at = now() - interval '1 minute' WHERE name = 'test_disabled'`,
    );
    await new Promise((r) => setTimeout(r, 300));
    expect(runs).toBe(0);
  });

  it("stops ticking after stop()", async () => {
    let runs = 0;
    const s = make();
    s.register("test_stop", "*/1 * * * *", async () => {
      runs += 1;
    });
    await s.start();
    await s.stop();
    await query(pool, `UPDATE jobs SET next_run_at = now() - interval '1 minute' WHERE name = 'test_stop'`);
    await new Promise((r) => setTimeout(r, 300));
    expect(runs).toBe(0);
  });
});
```

- [ ] 6. 테스트를 돌려 실패를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
```
기대 실패: `does not provide an export named 'createScheduler'`.

- [ ] 7. 스케줄러를 쓴다. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/scheduler.ts`:

```ts
import { query } from "@omnis/db";
import type { Pool } from "pg";
import { nextRunAt } from "./cron.js";
import type { Events } from "./events.js";
import type { Logger } from "./logger.js";

export interface Scheduler {
  register(name: string, cron: string, handler: () => Promise<void>): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface SchedulerDeps {
  pool: Pool;
  events: Events;
  logger: Logger;
  now?: () => Date;
  /** 기본 10초(계약 §5). 테스트만 줄인다. */
  tickMs?: number;
  /** Task 20이 kill switch를 물린다. 없으면 항상 꺼진 것으로 본다. */
  isKillSwitchOn?: () => Promise<boolean>;
}

export function createScheduler(deps: SchedulerDeps): Scheduler {
  const { pool, events, logger } = deps;
  const now = deps.now ?? ((): Date => new Date());
  const tickMs = deps.tickMs ?? 10_000;
  const isKillSwitchOn = deps.isKillSwitchOn ?? ((): Promise<boolean> => Promise.resolve(false));

  const handlers = new Map<string, () => Promise<void>>();
  const schedules = new Map<string, string>();
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let ticking = false;

  async function runOne(name: string, handler: () => Promise<void>): Promise<void> {
    // 계약 §5의 claim 문장 그대로. 0행이면 다른 틱/프로세스가 이미 잡았거나 아직 때가 아니다.
    const claimed = await query<{ id: string; schedule: string }>(
      pool,
      `UPDATE jobs SET claimed_at = now()
        WHERE name = $1 AND claimed_at IS NULL AND enabled AND next_run_at <= now()
        RETURNING id, schedule`,
      [name],
    );
    const job = claimed[0];
    if (job === undefined) return;

    const startedAt = Date.now();
    let status: "ok" | "failed" = "ok";
    let error: string | null = null;
    try {
      await handler();
    } catch (e) {
      status = "failed";
      error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      logger.error("job failed", { name, err: error });
    }
    await query(
      pool,
      `UPDATE jobs SET last_run_at = now(), last_status = $2, last_error = $3,
                       next_run_at = $4, claimed_at = NULL
        WHERE id = $1`,
      [job.id, status, error, nextRunAt(job.schedule, now())],
    );
    await events.emit("cold", "job.run", {
      id: job.id,
      name,
      status,
      latency_ms: Date.now() - startedAt,
      actor: "system",
      target_table: "jobs",
      ...(error !== null ? { error } : {}),
    });
  }

  async function tick(): Promise<void> {
    if (!running || ticking) return;
    ticking = true;
    try {
      if (await isKillSwitchOn()) {
        logger.warn("scheduler tick skipped: kill switch is on");
        return;
      }
      for (const [name, handler] of handlers) {
        await runOne(name, handler);
      }
    } catch (e) {
      logger.error("scheduler tick failed", { err: e instanceof Error ? e.message : String(e) });
    } finally {
      ticking = false;
    }
  }

  return {
    register(name, cron, handler) {
      nextRunAt(cron, now()); // 잘못된 cron은 등록 시점에 터진다
      handlers.set(name, handler);
      schedules.set(name, cron);
    },

    async start() {
      for (const [name, cron] of schedules) {
        await query(
          pool,
          `INSERT INTO jobs (name, schedule, next_run_at) VALUES ($1, $2, $3)
             ON CONFLICT (name) DO UPDATE SET schedule = EXCLUDED.schedule`,
          [name, cron, nextRunAt(cron, now())],
        );
      }
      running = true;
      timer = setInterval(() => {
        void tick();
      }, tickMs);
      timer.unref();
      await tick();
    },

    async stop() {
      running = false;
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      // 진행 중인 틱이 claimed_at을 들고 끝나도록 잠깐 기다린다.
      for (let i = 0; i < 100 && ticking; i += 1) {
        await new Promise((r) => setTimeout(r, 20));
      }
    },
  };
}
```

- [ ] 8. 배럴에 추가한다. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/index.ts`에 두 줄 추가:

```ts
export { nextRunAt } from "./cron.js";
export { createScheduler } from "./scheduler.js";
export type { Scheduler, SchedulerDeps } from "./scheduler.js";
```

- [ ] 9. 테스트를 돌려 통과를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test
```
기대: `Tests  19 passed (19)` (cron 4 + events 6 + fanout 3 + scheduler 6).

- [ ] 10. 커밋한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-A06: 스케줄러(jobs 테이블 + 5-field cron 실행기)

- register/start/stop, 10초 틱, 계약 §5의 claim UPDATE 문장 그대로(at-most-once)
- 실행 후 last_run_at/last_status/last_error/next_run_at 갱신 + claimed_at 해제
- 실행 기록은 cold 티어 job.run 이벤트로 남는다(마스터 §7)
- cron 파서는 자작: 외부 의존 금지(계약 §1) + Asia/Seoul은 DST가 없어 고정 +9h로 충분
- 핸들러가 등록되지 않은 seed 잡은 건드리지 않는다

Implemented-by: Claude Opus

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 15: scheduler-healthcheck-job (US-A06, tier: Opus)

**스토리 US-A06**의 "최초 job=헬스체크" 부분 — 스케줄러가 실제로 물릴 첫 핸들러를 만든다. A3 §6의 seed 16개는 전부 Phase B 이후의 루프·인프라 잡이라 Phase A에는 핸들러가 없다. `hub_healthcheck`는 A3 seed에 없으므로 `register()`가 새 row를 만든다.

**읽을 곳**: A6 §8(healthchecks.io ping 대상 표 — 이 잡이 그 자리의 Phase A 대역이다), A3 §6(`slot_health`는 A3 소유 인프라 잡이고 별개다), 마스터 §7("실행 기록은 events에 남는다").

**만들지 않을 것(YAGNI)**: healthchecks.io HTTP ping(A6 소관, Phase B에 `HC_UUIDS`가 생기면 이 핸들러 안에 한 줄 추가), ntfy 알림, WAL 슬롯 검사(`slot_health` 잡, Phase B), 디스크 용량 검사.

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/jobs/healthcheck.ts`
- Modify: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/index.ts`
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/healthcheck-job.test.ts`

**Interfaces:**
- Consumes: `one` (`@omnis/db`) · `Events`, `Scheduler` (Task 12·14).
- Produces (`@omnis/kernel`): `HEALTHCHECK_JOB_NAME = "hub_healthcheck"` · `HEALTHCHECK_CRON = "*/5 * * * *"` · `registerHealthcheckJob(scheduler: Scheduler, deps: { pool: Pool; events: Events }): void`.

### Steps

- [ ] 1. 실패하는 테스트를 쓴다. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/healthcheck-job.test.ts`:

```ts
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, one, query } from "@omnis/db";
import {
  HEALTHCHECK_CRON,
  HEALTHCHECK_JOB_NAME,
  type Events,
  type Scheduler,
  createEvents,
  createLogger,
  createScheduler,
  registerHealthcheckJob,
} from "@omnis/kernel";

let pool: Pool;
let events: Events & { close(): Promise<void> };
let scheduler: Scheduler;

beforeAll(async () => {
  pool = createPool();
  events = createEvents({ pool, logger: createLogger("@omnis/kernel") });
  scheduler = createScheduler({ pool, events, logger: createLogger("@omnis/kernel"), tickMs: 50 });
  registerHealthcheckJob(scheduler, { pool, events });
  await scheduler.start();
});
afterAll(async () => {
  await scheduler.stop();
  await events.close();
  await pool.end();
});

describe("hub_healthcheck job", () => {
  it("registers itself with a 5-minute schedule", async () => {
    const row = await one<{ schedule: string; enabled: boolean }>(
      pool,
      `SELECT schedule, enabled FROM jobs WHERE name = $1`,
      [HEALTHCHECK_JOB_NAME],
    );
    expect(row.schedule).toBe(HEALTHCHECK_CRON);
    expect(row.enabled).toBe(true);
  });

  it("runs and writes a cold hub.health event with the table counts", async () => {
    await query(pool, `UPDATE jobs SET next_run_at = now() - interval '1 minute' WHERE name = $1`, [
      HEALTHCHECK_JOB_NAME,
    ]);
    await new Promise((r) => setTimeout(r, 400));

    const job = await one<{ last_status: string }>(
      pool,
      `SELECT last_status FROM jobs WHERE name = $1`,
      [HEALTHCHECK_JOB_NAME],
    );
    expect(job.last_status).toBe("ok");

    const ev = await one<{ payload: Record<string, unknown> }>(
      pool,
      `SELECT payload FROM events WHERE kind = 'hub.health' ORDER BY seq DESC LIMIT 1`,
    );
    expect(ev.payload.db).toBe("up");
    expect(typeof ev.payload.pending_approvals).toBe("number");
    expect(typeof ev.payload.due_jobs).toBe("number");
  });
});
```

- [ ] 2. 테스트를 돌려 실패를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
```
기대 실패: `does not provide an export named 'registerHealthcheckJob'`.

- [ ] 3. 잡을 쓴다. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/jobs/healthcheck.ts`:

```ts
import { one } from "@omnis/db";
import type { Pool } from "pg";
import type { Events } from "../events.js";
import type { Scheduler } from "../scheduler.js";

export const HEALTHCHECK_JOB_NAME = "hub_healthcheck";
export const HEALTHCHECK_CRON = "*/5 * * * *";

/** 스케줄러가 물리는 첫 핸들러(US-A06). DB가 살아 있는지 + 큐가 막히지 않았는지만 본다. */
export function registerHealthcheckJob(
  scheduler: Scheduler,
  deps: { pool: Pool; events: Events },
): void {
  const { pool, events } = deps;
  scheduler.register(HEALTHCHECK_JOB_NAME, HEALTHCHECK_CRON, async () => {
    const row = await one<{ pending: string; due: string }>(
      pool,
      `SELECT (SELECT count(*) FROM pending_approvals WHERE state = 'pending')::text AS pending,
              (SELECT count(*) FROM jobs WHERE enabled AND next_run_at <= now())::text AS due`,
    );
    await events.emit("cold", "hub.health", {
      db: "up",
      pending_approvals: Number(row.pending),
      due_jobs: Number(row.due),
      actor: "system",
      target_table: "jobs",
    });
  });
}
```

- [ ] 4. 배럴에 추가한다:

```ts
export { HEALTHCHECK_CRON, HEALTHCHECK_JOB_NAME, registerHealthcheckJob } from "./jobs/healthcheck.js";
```

- [ ] 5. 테스트를 돌리고 US-A06 검증 명령으로 스토리를 닫는다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
```
기대: `Tests  17 passed (17)` (events 6 + fanout 3 + scheduler 6 + healthcheck 2).

- [ ] 6. 커밋한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-A06: hub_healthcheck — 스케줄러의 첫 잡

- */5 * * * *로 등록, DB 왕복 + pending_approvals/due_jobs 카운트
- 결과는 cold 티어 hub.health 이벤트로 남는다
- healthchecks.io ping은 A6 소관이라 붙이지 않는다

Implemented-by: Claude Opus

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 16: approvals-propose (US-A07, tier: Opus)

**스토리 US-A07** — 목표: 승인 게이트 API(`propose`/`decide` 상태 전이, HumanInterrupt/HumanResponse 이식) / 산출물: `packages/kernel/src/approvals.ts` / 검증 명령: `pnpm --filter @omnis/kernel test:integration` / 티어: Opus. 의존: A03, A05.

**선행**: 이 태스크부터 `@omnis/protocol`(US-A11)이 필요하다. `packages/protocol`이 워크스페이스에 없으면 시작하지 않는다.

**읽을 곳**: 계약 §3.4(`HumanInterrupt`/`HumanResponse` zod 스키마 전문 — `action` 6값, `config` 기본값, `risk` 기본 `normal`), 계약 §5(`Approvals` 인터페이스 + 상태 전이 주석), A3 §4(`pending_approvals` DDL과 제약 이름), A3-D11(`state`와 `decision` 두 컬럼), 마스터 §7(모든 egress가 이 게이트를 거친다).

**`action`은 A3의 6값이다**(계약 §0-6): `send`, `delete`, `calendar_write`, `delegate`, `self_model_edit`, `memory_write`. A7 §1 본문의 4값 표기는 여기서 쓰지 않는다.

**NOTIFY를 직접 쏘지 않는다**: `0007`의 `approvals_notify` 트리거가 INSERT 시 `omnis_approval`을 이미 쏜다. `propose()`가 `events.emit("durable", ...)`을 부르면 같은 알림이 두 번 나간다 — 부르지 않는다.

**만들지 않을 것(YAGNI)**: 승인 정책 엔진(채널·사람별 "자율 허용"은 마스터 §7이 v1 기능으로 적었지만 Phase A 스토리가 아니다 — 기본값은 항상 승인), 만료 스윕 잡(Task 18이 `expire()`를 만들고, 그걸 부르는 cron 잡은 Phase B), 승인 UI(US-A30), 푸시 알림(A6).

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/approvals.ts`, `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/audit.ts`(타입만 — 구현은 Task 21)
- Modify: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/package.json`(`@omnis/protocol` 의존 추가), `/Users/logankim/AI-Workspaces/omnis/packages/kernel/tsconfig.json`(references), `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/index.ts`
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/approvals-propose.test.ts`

**Interfaces:**
- Consumes: `HumanInterrupt`, `HumanResponse`, `ApprovalAction`, `ApprovalState`, `ApprovalDecision`, `ApprovalRisk` (`@omnis/protocol`, 계약 §3.4) · `one`, `query` (`@omnis/db`) · `Audit` (Task 21이 만든다 — 그전까지 `propose`는 `deps.audit`를 optional로 받는다).
- Produces (`@omnis/kernel`): `interface PendingApproval { id, action, args, description, config, state, decision, decided_args, requested_by, thread_id, item_id, task_id, risk, expires_at, created_at, decided_at, executed_at, fail_reason }` · `class ApprovalStateError extends Error` (`name === "ApprovalStateError"`, 계약 §9) · `interface Approvals { propose(i): Promise<string>; decide(id, r): Promise<void>; list(f?): Promise<PendingApproval[]> }` — 계약 §5의 `Approvals`는 여기에 더해 `beginExecution`/`completeExecution`/`failExecution`/`expire` 4개를 더 요구하고, 그 4개는 Task 18이 같은 인터페이스에 붙여 US-A07을 닫는다 · `createApprovals(deps: ApprovalsDeps): Approvals` · `interface ApprovalsDeps { pool: Pool; logger: Logger; now?: () => Date; audit?: Audit }`.

### Steps

- [ ] 1. protocol 의존을 배선한다. `packages/kernel/package.json`의 `dependencies`에 한 줄 추가하고 `tsconfig.json`의 `references`에 한 항목 추가한다.

```json
  "dependencies": { "@omnis/db": "workspace:*", "@omnis/protocol": "workspace:*", "pg": "8.13.1" },
```
```json
  "references": [{ "path": "../db" }, { "path": "../protocol" }]
```
그리고 설치한다:
```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm install
```
기대: `@omnis/protocol` 링크 생성. 실패하면 US-A11이 아직 merge되지 않은 것이므로 여기서 멈춘다.

- [ ] 2. 실패하는 테스트를 쓴다. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/approvals-propose.test.ts`:

```ts
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, one, query } from "@omnis/db";
import { type Approvals, createApprovals, createLogger } from "@omnis/kernel";

let pool: Pool;
let approvals: Approvals;

beforeAll(() => {
  pool = createPool();
  approvals = createApprovals({ pool, logger: createLogger("@omnis/kernel") });
});
afterAll(async () => {
  await pool.end();
});

describe("approvals.propose", () => {
  it("inserts a pending row with the contract's default config and risk", async () => {
    const id = await approvals.propose({
      action: "send",
      args: { thread_id: "t", text: "안녕하세요" },
      description: "Slack DM 답장",
      config: { allow_accept: true, allow_edit: true, allow_respond: false, allow_ignore: true },
      risk: "normal",
    });
    const row = await one<{
      action: string;
      state: string;
      decision: string | null;
      risk: string;
      config: Record<string, boolean>;
      args: Record<string, unknown>;
    }>(pool, `SELECT action, state, decision, risk, config, args FROM pending_approvals WHERE id = $1`, [id]);

    expect(row.action).toBe("send");
    expect(row.state).toBe("pending");
    expect(row.decision).toBeNull();
    expect(row.risk).toBe("normal");
    expect(row.config.allow_respond).toBe(false);
    expect(row.args.text).toBe("안녕하세요");
  });

  it("accepts all 6 actions from A3 approvals_action_ck", async () => {
    for (const action of ["send", "delete", "calendar_write", "delegate", "self_model_edit", "memory_write"] as const) {
      const id = await approvals.propose({
        action,
        args: {},
        description: `smoke ${action}`,
        config: { allow_accept: true, allow_edit: true, allow_respond: false, allow_ignore: true },
        risk: "normal",
      });
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it("rejects an action outside the enum before touching the database", async () => {
    const before = await one<{ n: string }>(pool, `SELECT count(*)::text AS n FROM pending_approvals`);
    await expect(
      approvals.propose({
        // @ts-expect-error — 런타임 방어를 검증하려고 일부러 타입을 깬다
        action: "wire_money",
        args: {},
        description: "nope",
        config: { allow_accept: true, allow_edit: true, allow_respond: false, allow_ignore: true },
        risk: "normal",
      }),
    ).rejects.toThrow();
    const after = await one<{ n: string }>(pool, `SELECT count(*)::text AS n FROM pending_approvals`);
    expect(after.n).toBe(before.n);
  });

  it("stores the optional foreign keys and expiry when given", async () => {
    const acc = await one<{ id: string }>(
      pool,
      `INSERT INTO accounts (channel, external_id, display) VALUES ('slack','T-ap:U','ap') RETURNING id`,
    );
    const thr = await one<{ id: string }>(
      pool,
      `INSERT INTO threads (account_id, external_id, kind) VALUES ($1,'ap-1','dm') RETURNING id`,
      [acc.id],
    );
    const runtime = await one<{ id: string }>(pool, `SELECT id FROM agent_runtimes WHERE runtime='omnis'`);
    const expires = new Date(Date.now() + 3_600_000).toISOString();

    const id = await approvals.propose({
      action: "delegate",
      args: { runtime: "codex" },
      description: "맥북 Codex에 위임",
      config: { allow_accept: true, allow_edit: false, allow_respond: false, allow_ignore: true },
      risk: "high",
      requested_by: runtime.id,
      thread_id: thr.id,
      expires_at: expires,
    });
    const row = await one<{ thread_id: string; requested_by: string; risk: string; expires_at: Date }>(
      pool,
      `SELECT thread_id, requested_by, risk, expires_at FROM pending_approvals WHERE id = $1`,
      [id],
    );
    expect(row.thread_id).toBe(thr.id);
    expect(row.requested_by).toBe(runtime.id);
    expect(row.risk).toBe("high");
    expect(row.expires_at.toISOString()).toBe(expires);
  });
});

describe("approvals.list", () => {
  it("filters by state and thread and honours the limit", async () => {
    const pending = await approvals.list({ state: "pending", limit: 3 });
    expect(pending.length).toBeLessThanOrEqual(3);
    expect(pending.every((a) => a.state === "pending")).toBe(true);

    const thr = await one<{ id: string }>(pool, `SELECT id FROM threads WHERE external_id='ap-1'`);
    const scoped = await approvals.list({ thread_id: thr.id });
    expect(scoped.length).toBeGreaterThanOrEqual(1);
    expect(scoped.every((a) => a.thread_id === thr.id)).toBe(true);
  });

  it("orders high risk first, then oldest first (A3 §12 (2))", async () => {
    await query(pool, `DELETE FROM threads WHERE external_id = 'never'`); // no-op, keeps the pool warm
    const all = await approvals.list({ state: "pending", limit: 50 });
    const firstNormal = all.findIndex((a) => a.risk === "normal");
    const lastHigh = all.map((a) => a.risk).lastIndexOf("high");
    if (firstNormal !== -1 && lastHigh !== -1) {
      expect(lastHigh).toBeLessThan(firstNormal);
    }
  });
});
```

- [ ] 3. 테스트를 돌려 실패를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
```
기대 실패: `does not provide an export named 'createApprovals'`.

- [ ] 4. 감사 **타입만** 먼저 놓는다. `propose`/`decide`가 `Audit`을 참조하는데 구현은 Task 21이 하므로, 인터페이스 파일을 여기서 만들고 Task 21이 같은 파일에 `createAudit`를 더한다. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/audit.ts`:

```ts
/** 계약 §5. append-only, 모든 egress가 반드시 경유한다. 구현은 Task 21. */
export interface AuditEntry {
  actor: string; // 'me' | `agent:${RuntimeKind}` | 'system'
  action: string; // 'item.sent' | 'approval.decided' | 'kill_switch.set' ...
  target_table: string;
  target_id?: string;
  before?: unknown;
  after?: unknown;
  approval_id?: string;
}

export interface Audit {
  record(e: AuditEntry): Promise<void>;
}
```

- [ ] 5. `propose`와 `list`를 쓴다. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/approvals.ts`:

```ts
import { one, query } from "@omnis/db";
import {
  type ApprovalAction,
  type ApprovalDecision,
  type ApprovalRisk,
  type ApprovalState,
  HumanInterrupt,
  HumanResponse,
} from "@omnis/protocol";
import type { Pool } from "pg";
import type { Audit } from "./audit.js";
import type { Logger } from "./logger.js";

export class ApprovalStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalStateError";
  }
}

export interface ApprovalConfig {
  allow_accept: boolean;
  allow_edit: boolean;
  allow_respond: boolean;
  allow_ignore: boolean;
}

/** pending_approvals row 1:1 (A3 §4). 계약 §5의 Approvals.list가 돌려주는 타입. */
export interface PendingApproval {
  id: string;
  action: ApprovalAction;
  args: Record<string, unknown>;
  description: string;
  config: ApprovalConfig;
  state: ApprovalState;
  decision: ApprovalDecision | null;
  decided_args: Record<string, unknown> | null;
  requested_by: string | null;
  thread_id: string | null;
  item_id: string | null;
  task_id: string | null;
  risk: ApprovalRisk;
  expires_at: Date | null;
  created_at: Date;
  decided_at: Date | null;
  executed_at: Date | null;
  fail_reason: string | null;
}

export interface Approvals {
  propose(i: unknown): Promise<string>;
  decide(id: string, r: unknown): Promise<void>;
  list(f?: { state?: ApprovalState; thread_id?: string; limit?: number }): Promise<PendingApproval[]>;
}

export interface ApprovalsDeps {
  pool: Pool;
  logger: Logger;
  now?: () => Date;
  /** Task 21이 audit를 물린다. 없으면 감사 기록을 건너뛴다(테스트 부트스트랩용). */
  audit?: Audit;
}

const SELECT_ALL = `SELECT id, action, args, description, config, state, decision, decided_args,
                           requested_by, thread_id, item_id, task_id, risk, expires_at,
                           created_at, decided_at, executed_at, fail_reason
                      FROM pending_approvals`;

export function createApprovals(deps: ApprovalsDeps): Approvals {
  const { pool, logger } = deps;

  return {
    async propose(i) {
      // zod가 action 6값·config·risk 기본값을 강제한다. DB에 닿기 전에 터진다.
      const v = HumanInterrupt.parse(i);
      const row = await one<{ id: string }>(
        pool,
        `INSERT INTO pending_approvals
           (action, args, description, config, risk, requested_by, thread_id, item_id, task_id, expires_at)
         VALUES ($1, $2::jsonb, $3, $4::jsonb, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [
          v.action,
          JSON.stringify(v.args),
          v.description,
          JSON.stringify(v.config),
          v.risk,
          v.requested_by ?? null,
          v.thread_id ?? null,
          v.item_id ?? null,
          v.task_id ?? null,
          v.expires_at ?? null,
        ],
      );
      // NOTIFY는 0007의 approvals_notify 트리거가 이미 쏜다 — 여기서 emit하면 두 번 나간다.
      await deps.audit?.record({
        actor: "system",
        action: "approval.proposed",
        target_table: "pending_approvals",
        target_id: row.id,
        after: { action: v.action, description: v.description, risk: v.risk },
      });
      logger.info("approval proposed", { id: row.id, action: v.action, risk: v.risk });
      return row.id;
    },

    async decide(id, r) {
      void HumanResponse.parse(r);
      throw new ApprovalStateError("decide() is implemented in Task 17");
    },

    async list(f) {
      const where: string[] = [];
      const params: unknown[] = [];
      if (f?.state !== undefined) {
        params.push(f.state);
        where.push(`state = $${params.length}`);
      }
      if (f?.thread_id !== undefined) {
        params.push(f.thread_id);
        where.push(`thread_id = $${params.length}`);
      }
      params.push(Math.min(f?.limit ?? 50, 200));
      // A3 §12 (2): 고위험 먼저, 그 다음 오래된 순.
      return query<PendingApproval>(
        pool,
        `${SELECT_ALL}
          ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
          ORDER BY (risk = 'high') DESC, created_at ASC
          LIMIT $${params.length}`,
        params,
      );
    },
  };
}
```

> `decide`는 Task 17이 채운다. 여기서 `throw`로 남기는 것은 placeholder가 아니라 **실행하면 반드시 터지는 명시적 미구현**이다 — Task 17의 실패 테스트가 이 문장을 바로 잡는다. Task 17을 건너뛰고 merge하지 않는다.

- [ ] 6. 배럴에 추가한다:

```ts
export { ApprovalStateError, createApprovals } from "./approvals.js";
export type { ApprovalConfig, Approvals, ApprovalsDeps, PendingApproval } from "./approvals.js";
```

- [ ] 7. 테스트를 돌려 통과를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
```
기대: propose 4개 + list 2개가 통과. `Tests  23 passed (23)`.

- [ ] 8. 커밋하지 않는다 — US-A07은 Task 18까지가 하나의 원자 커밋이다(A7-D8: 스토리당 원자 커밋 1개). Task 17로 넘어간다.

---

## Task 17: approvals-decide (US-A07, tier: Opus)

**스토리 US-A07** (계속) — `decide(id, HumanResponse)`: `pending → decided` 전이 하나만 한다. `decision`/`decided_args`/`decided_at`을 같은 UPDATE에서 채워야 `approvals_decided_ck`를 만족한다.

**읽을 곳**: 계약 §3.4(`HumanResponse = { decision, decided_args? }`, `decision ∈ accept|edit|respond|ignore`), 계약 §5(`decide`: pending → decided), A3 §4(`approvals_decided_ck`, `approvals_decision_ck`), A3 §11(`expires_at` 경과 시 `state='expired'`).

**config 게이트**: `config.allow_edit=false`인데 `decision='edit'`이 오면 `ApprovalStateError`다. 이게 `22`의 `HumanInterrupt.config`가 존재하는 이유다 — UI가 버튼을 숨기는 것과 별개로 서버가 거절해야 한다.

**만들지 않을 것(YAGNI)**: `respond` 결정이 만들어내는 후속 턴(A4 소관), 결정 취소, 다중 승인자.

**Files:**
- Modify: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/approvals.ts`
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/approvals-decide.test.ts`

**Interfaces:**
- Consumes: Task 16의 `createApprovals`, `PendingApproval`, `ApprovalStateError`.
- Produces: `Approvals.decide`의 실제 동작. 새 export 없음.

### Steps

- [ ] 1. 실패하는 테스트를 쓴다. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/approvals-decide.test.ts`:

```ts
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, one, query } from "@omnis/db";
import { type Approvals, ApprovalStateError, createApprovals, createLogger } from "@omnis/kernel";

let pool: Pool;
let approvals: Approvals;

beforeAll(() => {
  pool = createPool();
  approvals = createApprovals({ pool, logger: createLogger("@omnis/kernel") });
});
afterAll(async () => {
  await pool.end();
});

const base = {
  args: { text: "draft" },
  description: "decide test",
  config: { allow_accept: true, allow_edit: true, allow_respond: false, allow_ignore: true },
  risk: "normal" as const,
};

describe("approvals.decide", () => {
  it("moves pending → decided and stores decision + decided_args + decided_at", async () => {
    const id = await approvals.propose({ ...base, action: "send" });
    await approvals.decide(id, { decision: "edit", decided_args: { text: "고친 초안" } });

    const row = await one<{
      state: string;
      decision: string;
      decided_args: Record<string, unknown>;
      decided_at: Date;
    }>(pool, `SELECT state, decision, decided_args, decided_at FROM pending_approvals WHERE id = $1`, [id]);
    expect(row.state).toBe("decided");
    expect(row.decision).toBe("edit");
    expect(row.decided_args.text).toBe("고친 초안");
    expect(row.decided_at).toBeInstanceOf(Date);
  });

  it("accepts a decision with no decided_args", async () => {
    const id = await approvals.propose({ ...base, action: "delete" });
    await approvals.decide(id, { decision: "ignore" });
    const row = await one<{ decision: string; decided_args: unknown }>(
      pool,
      `SELECT decision, decided_args FROM pending_approvals WHERE id = $1`,
      [id],
    );
    expect(row.decision).toBe("ignore");
    expect(row.decided_args).toBeNull();
  });

  it("refuses a second decide on the same approval", async () => {
    const id = await approvals.propose({ ...base, action: "send" });
    await approvals.decide(id, { decision: "accept" });
    await expect(approvals.decide(id, { decision: "ignore" })).rejects.toThrow(ApprovalStateError);
    await expect(approvals.decide(id, { decision: "ignore" })).rejects.toThrow(/not pending/);
  });

  it("refuses a decision the config disallows", async () => {
    const id = await approvals.propose({
      ...base,
      action: "delegate",
      config: { allow_accept: true, allow_edit: false, allow_respond: false, allow_ignore: true },
    });
    await expect(approvals.decide(id, { decision: "edit", decided_args: {} })).rejects.toThrow(
      /config forbids decision "edit"/,
    );
    const row = await one<{ state: string }>(pool, `SELECT state FROM pending_approvals WHERE id = $1`, [id]);
    expect(row.state).toBe("pending");
  });

  it("refuses a decision on an expired approval", async () => {
    const id = await approvals.propose({
      ...base,
      action: "send",
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    });
    await expect(approvals.decide(id, { decision: "accept" })).rejects.toThrow(/expired/);
  });

  it("refuses an unknown id and an invalid decision value", async () => {
    await expect(
      approvals.decide("11111111-1111-1111-1111-111111111111", { decision: "accept" }),
    ).rejects.toThrow(/not found/);
    const id = await approvals.propose({ ...base, action: "send" });
    await expect(approvals.decide(id, { decision: "maybe" })).rejects.toThrow();
    await query(pool, `SELECT 1`);
  });
});
```

- [ ] 2. 테스트를 돌려 실패를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
```
기대 실패: `ApprovalStateError: decide() is implemented in Task 17`.

- [ ] 3. `decide`를 구현한다. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/approvals.ts`의 `decide` 메서드를 통째로 교체한다.

```ts
    async decide(id, r) {
      const v = HumanResponse.parse(r);
      const now = (deps.now ?? ((): Date => new Date()))();

      const rows = await query<PendingApproval>(pool, `${SELECT_ALL} WHERE id = $1`, [id]);
      const before = rows[0];
      if (before === undefined) {
        throw new ApprovalStateError(`approval ${id} not found`);
      }
      if (before.state !== "pending") {
        throw new ApprovalStateError(`approval ${id} is not pending (state=${before.state})`);
      }
      if (before.expires_at !== null && before.expires_at.getTime() <= now.getTime()) {
        throw new ApprovalStateError(`approval ${id} expired at ${before.expires_at.toISOString()}`);
      }
      const allowed: Record<ApprovalDecision, keyof ApprovalConfig> = {
        accept: "allow_accept",
        edit: "allow_edit",
        respond: "allow_respond",
        ignore: "allow_ignore",
      };
      if (!before.config[allowed[v.decision]]) {
        throw new ApprovalStateError(`approval ${id} config forbids decision "${v.decision}"`);
      }

      // state와 decision을 한 UPDATE에서 바꿔야 approvals_decided_ck를 만족한다.
      const updated = await query<{ id: string }>(
        pool,
        `UPDATE pending_approvals
            SET state = 'decided', decision = $2, decided_args = $3::jsonb, decided_at = $4
          WHERE id = $1 AND state = 'pending'
          RETURNING id`,
        [id, v.decision, v.decided_args === undefined ? null : JSON.stringify(v.decided_args), now],
      );
      if (updated[0] === undefined) {
        throw new ApprovalStateError(`approval ${id} is not pending (lost the race)`);
      }
      await deps.audit?.record({
        actor: "me",
        action: "approval.decided",
        target_table: "pending_approvals",
        target_id: id,
        before: { state: before.state },
        after: { state: "decided", decision: v.decision },
        approval_id: id,
      });
      logger.info("approval decided", { id, decision: v.decision });
    },
```

- [ ] 4. 테스트를 돌려 통과를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
```
기대: `Tests  29 passed (29)`.

- [ ] 5. 커밋하지 않는다 — Task 18까지가 US-A07 하나의 커밋이다.

---

## Task 18: approvals-state-machine (US-A07, tier: Opus)

**스토리 US-A07** (마무리) — 계약 §5가 적은 전이 전체를 실행 가능하게 만든다: `pending → decided → executing → executed | failed`, 그리고 `pending → expired`. `decided` 다음 구간은 Task 22의 `runEgress`가 쓴다.

**읽을 곳**: 계약 §5(상태 전이 한 줄 주석), A3 §4(`approvals_state_ck` 6값, `approvals_decided_ck`), A3 §11(`expires_at` 경과 시 `state='expired'`, row는 남긴다), A3 §9 규칙 5(모든 `→ sent` 전이는 `audit_log`에 `approval_id`와 함께 기록된다).

**`expired`와 `approvals_decided_ck`의 충돌 — 이 태스크가 푸는 방식**: `CHECK ((state = 'pending') = (decision IS NULL))`이므로 `state='expired'` row는 non-NULL `decision`을 가져야 한다. A3 §11의 "`expires_at` 경과 시 `state='expired'`"만으로는 제약을 통과할 수 없다. **만료는 `decision='ignore'`와 함께 기록한다** — 사람이 아무것도 고르지 않고 시간이 지난 것은 의미상 "무시"이고, `ApprovalDecision`의 4값 중 이것이 유일하게 맞는 값이다. `decided_at`은 만료 시각을 넣고, 감사 로그의 `action='approval.expired'`가 사람의 결정과 만료를 구분한다. (이 판단은 A3 본문에 없다 — open question으로 올린다.)

**만들지 않을 것(YAGNI)**: 만료 스윕 cron 잡(Phase B가 `expire()`를 `followup_sweep`에 얹는다), `executing` 타임아웃 회수, 재시도 큐.

**Files:**
- Modify: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/approvals.ts`
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/approvals-state-machine.test.ts`

**Interfaces:**
- Consumes: Task 16·17의 `createApprovals`, `ApprovalStateError`.
- Produces (`@omnis/kernel`, 계약 §5 `Approvals`의 나머지 메서드 4개 — 2026-09-20 계약 개정으로 정식 계약 표면이 됐다): `Approvals.beginExecution(id: string): Promise<PendingApproval>` · `Approvals.completeExecution(id: string): Promise<void>` · `Approvals.failExecution(id: string, reason: string): Promise<void>` · `Approvals.expire(id: string): Promise<boolean>`.

### Steps

- [ ] 1. 실패하는 테스트를 쓴다. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/approvals-state-machine.test.ts`:

```ts
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, one } from "@omnis/db";
import { type Approvals, ApprovalStateError, createApprovals, createLogger } from "@omnis/kernel";

let pool: Pool;
let approvals: Approvals;

beforeAll(() => {
  pool = createPool();
  approvals = createApprovals({ pool, logger: createLogger("@omnis/kernel") });
});
afterAll(async () => {
  await pool.end();
});

const base = {
  args: {},
  description: "state machine",
  config: { allow_accept: true, allow_edit: true, allow_respond: false, allow_ignore: true },
  risk: "normal" as const,
};

async function stateOf(id: string): Promise<string> {
  const row = await one<{ state: string }>(pool, `SELECT state FROM pending_approvals WHERE id = $1`, [id]);
  return row.state;
}

describe("approvals state machine", () => {
  it("walks pending → decided → executing → executed", async () => {
    const id = await approvals.propose({ ...base, action: "send" });
    expect(await stateOf(id)).toBe("pending");
    await approvals.decide(id, { decision: "accept" });
    expect(await stateOf(id)).toBe("decided");

    const claimed = await approvals.beginExecution(id);
    expect(claimed.decision).toBe("accept");
    expect(await stateOf(id)).toBe("executing");

    await approvals.completeExecution(id);
    expect(await stateOf(id)).toBe("executed");
    const row = await one<{ executed_at: Date }>(
      pool,
      `SELECT executed_at FROM pending_approvals WHERE id = $1`,
      [id],
    );
    expect(row.executed_at).toBeInstanceOf(Date);
  });

  it("walks decided → executing → failed and records the reason", async () => {
    const id = await approvals.propose({ ...base, action: "calendar_write" });
    await approvals.decide(id, { decision: "edit", decided_args: { when: "tomorrow" } });
    await approvals.beginExecution(id);
    await approvals.failExecution(id, "google returned 503");

    const row = await one<{ state: string; fail_reason: string }>(
      pool,
      `SELECT state, fail_reason FROM pending_approvals WHERE id = $1`,
      [id],
    );
    expect(row.state).toBe("failed");
    expect(row.fail_reason).toContain("503");
  });

  it("refuses to execute what was ignored or never decided", async () => {
    const ignored = await approvals.propose({ ...base, action: "send" });
    await approvals.decide(ignored, { decision: "ignore" });
    await expect(approvals.beginExecution(ignored)).rejects.toThrow(ApprovalStateError);
    await expect(approvals.beginExecution(ignored)).rejects.toThrow(/not executable/);

    const untouched = await approvals.propose({ ...base, action: "send" });
    await expect(approvals.beginExecution(untouched)).rejects.toThrow(/not executable/);
  });

  it("refuses a double beginExecution (at-most-once claim)", async () => {
    const id = await approvals.propose({ ...base, action: "delegate" });
    await approvals.decide(id, { decision: "accept" });
    await approvals.beginExecution(id);
    await expect(approvals.beginExecution(id)).rejects.toThrow(/not executable/);
  });

  it("expires a pending approval with decision='ignore' so approvals_decided_ck holds", async () => {
    const id = await approvals.propose({
      ...base,
      action: "send",
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    expect(await approvals.expire(id)).toBe(true);

    const row = await one<{ state: string; decision: string; decided_at: Date }>(
      pool,
      `SELECT state, decision, decided_at FROM pending_approvals WHERE id = $1`,
      [id],
    );
    expect(row.state).toBe("expired");
    expect(row.decision).toBe("ignore");
    expect(row.decided_at).toBeInstanceOf(Date);
  });

  it("does not expire an approval whose deadline has not passed", async () => {
    const id = await approvals.propose({
      ...base,
      action: "send",
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(await approvals.expire(id)).toBe(false);
    expect(await stateOf(id)).toBe("pending");
  });
});
```

- [ ] 2. 테스트를 돌려 실패를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
```
기대 실패: `approvals.beginExecution is not a function`.

- [ ] 3. `Approvals` 인터페이스에 메서드 4개를 더한다(`approvals.ts`의 `export interface Approvals` 블록 교체):

```ts
export interface Approvals {
  propose(i: unknown): Promise<string>;
  decide(id: string, r: unknown): Promise<void>;
  list(f?: { state?: ApprovalState; thread_id?: string; limit?: number }): Promise<PendingApproval[]>;
  /** decided(accept|edit) → executing. 0행이면 ApprovalStateError. runEgress만 부른다. */
  beginExecution(id: string): Promise<PendingApproval>;
  /** executing → executed */
  completeExecution(id: string): Promise<void>;
  /** executing → failed */
  failExecution(id: string, reason: string): Promise<void>;
  /** pending & expires_at <= now → expired(+decision='ignore'). 바뀌었으면 true. */
  expire(id: string): Promise<boolean>;
}
```

- [ ] 4. 구현 4개를 `createApprovals`가 돌려주는 객체의 `list` 뒤에 추가한다:

```ts
    async beginExecution(id) {
      // decision이 accept|edit일 때만 실행할 수 있다. ignore/respond는 채널로 나가지 않는다.
      const rows = await query<PendingApproval>(
        pool,
        `UPDATE pending_approvals
            SET state = 'executing'
          WHERE id = $1 AND state = 'decided' AND decision IN ('accept','edit')
          RETURNING id, action, args, description, config, state, decision, decided_args,
                    requested_by, thread_id, item_id, task_id, risk, expires_at,
                    created_at, decided_at, executed_at, fail_reason`,
        [id],
      );
      const row = rows[0];
      if (row === undefined) {
        throw new ApprovalStateError(`approval ${id} is not executable (needs state=decided, decision∈accept|edit)`);
      }
      return row;
    },

    async completeExecution(id) {
      const rows = await query<{ id: string }>(
        pool,
        `UPDATE pending_approvals SET state = 'executed', executed_at = now()
          WHERE id = $1 AND state = 'executing' RETURNING id`,
        [id],
      );
      if (rows[0] === undefined) {
        throw new ApprovalStateError(`approval ${id} is not executing`);
      }
    },

    async failExecution(id, reason) {
      const rows = await query<{ id: string }>(
        pool,
        `UPDATE pending_approvals SET state = 'failed', fail_reason = $2
          WHERE id = $1 AND state = 'executing' RETURNING id`,
        [id, reason.slice(0, 2000)],
      );
      if (rows[0] === undefined) {
        throw new ApprovalStateError(`approval ${id} is not executing`);
      }
    },

    async expire(id) {
      // approvals_decided_ck는 state<>'pending'인 row에 non-NULL decision을 요구한다.
      // 아무도 고르지 않고 시간이 지난 것 = 'ignore'.
      const rows = await query<{ id: string }>(
        pool,
        `UPDATE pending_approvals
            SET state = 'expired', decision = 'ignore', decided_at = now()
          WHERE id = $1 AND state = 'pending' AND expires_at IS NOT NULL AND expires_at <= now()
          RETURNING id`,
        [id],
      );
      const hit = rows[0] !== undefined;
      if (hit) {
        await deps.audit?.record({
          actor: "system",
          action: "approval.expired",
          target_table: "pending_approvals",
          target_id: id,
          after: { state: "expired", decision: "ignore" },
          approval_id: id,
        });
      }
      return hit;
    },
```

- [ ] 5. 테스트를 돌려 통과를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
```
기대: `Tests  35 passed (35)`.

- [ ] 6. US-A07을 하나의 원자 커밋으로 남긴다(Task 16~18).

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-A07: 승인 게이트 API(propose/decide + 전체 상태 전이)

- propose: HumanInterrupt zod 검증 후 pending_approvals INSERT, NOTIFY는 0007 트리거가 담당
- decide: pending → decided를 한 UPDATE로(approvals_decided_ck), config가 막는 decision은 ApprovalStateError
- 만료·이미 결정된 승인·존재하지 않는 id를 각각 구분해 거절
- beginExecution/completeExecution/failExecution: decided(accept|edit) → executing → executed|failed, at-most-once claim
- expire: pending → expired + decision='ignore'(제약 충족) + audit action='approval.expired'
- list: 고위험 먼저, 오래된 순(A3 §12 (2))

Implemented-by: Claude Opus

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 19: kill-switch-audit-state (US-A08, tier: Opus)

**스토리 US-A08** — 목표: kill switch(전역 플래그, 모든 자율 루프/egress 체크포인트) / 산출물: `packages/kernel/src/kill-switch.ts` / 검증 명령: `pnpm --filter @omnis/kernel test:integration` / 티어: Opus. 의존: A05.

**읽을 곳**: 마스터 §7(kill switch — 전역 플래그 하나로 모든 자율 루프와 egress를 멈춘다, UI와 CLI 양쪽에서 켠다), 계약 §5(`KillSwitch` 인터페이스 + **상태 저장소는 새 테이블이 아니라 `audit_log`** — `action='kill_switch.set'`, `after={"on":bool,"reason":string}`의 최신 row가 현재 값; 프로세스 내 캐시 + `omnis_control` NOTIFY로 무효화), A3 §6.2(`omnis_control` 채널 페이로드 `{"kill_switch":true|false}`).

**새 테이블을 만들지 않는 이유**(계약이 이미 정했지만 구현자가 이유를 알아야 한다): 스위치 변경은 그 자체가 감사 대상이고, `audit_log`는 append-only라 "누가 언제 왜 껐는가"의 이력이 공짜로 남는다. 플래그 테이블을 따로 두면 그 이력을 또 만들어야 한다.

**만들지 않을 것(YAGNI)**: 스위치 스코프(채널별/루프별 — 마스터가 "전역 플래그 하나"라고 못박았다), 자동 해제 타이머, CLI 바이너리(허브 HTTP `POST /kill-switch`가 Task 24에 생긴다).

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/kill-switch.ts`
- Modify: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/index.ts`
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/kill-switch.test.ts`

**Interfaces:**
- Consumes: `query` (`@omnis/db`) · `Events` (Task 12) · `Audit` (Task 16의 타입, Task 21의 구현).
- Produces (`@omnis/kernel`): `class KillSwitchError extends Error` (`name === "KillSwitchError"`, 계약 §9) · `interface KillSwitch { isOn(): Promise<boolean>; set(on: boolean, reason: string): Promise<void>; assertOff(): Promise<void> }` · `createKillSwitch(deps: KillSwitchDeps): KillSwitch` · `killSwitchStatus(pool: Pool): Promise<{ on: boolean; since: string | null; reason: string | null }>` (허브 `GET /kill-switch`가 쓴다) · `interface KillSwitchDeps { pool: Pool; events: Events; audit: Audit; logger: Logger }`.

### Steps

- [ ] 1. 실패하는 테스트를 쓴다. 이 테스트는 **두 개의 커널 인스턴스**를 만들어 NOTIFY 기반 캐시 무효화를 검증한다 — 허브와 다른 프로세스가 같이 도는 실제 상황이다. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/kill-switch.test.ts`:

```ts
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPool, one, query } from "@omnis/db";
import {
  type Events,
  type KillSwitch,
  KillSwitchError,
  createAudit,
  createEvents,
  createKillSwitch,
  createLogger,
  killSwitchStatus,
} from "@omnis/kernel";

let pool: Pool;
let eventsA: Events & { close(): Promise<void> };
let eventsB: Events & { close(): Promise<void> };
let a: KillSwitch;
let b: KillSwitch;
const logger = createLogger("@omnis/kernel");

beforeAll(async () => {
  pool = createPool();
  const audit = createAudit(pool);
  eventsA = createEvents({ pool, logger });
  eventsB = createEvents({ pool, logger });
  a = createKillSwitch({ pool, events: eventsA, audit, logger });
  b = createKillSwitch({ pool, events: eventsB, audit, logger });
  await new Promise((r) => setTimeout(r, 300)); // LISTEN이 걸릴 시간
});
beforeEach(async () => {
  await a.set(false, "test reset");
  await new Promise((r) => setTimeout(r, 150));
});
afterAll(async () => {
  await eventsA.close();
  await eventsB.close();
  await pool.end();
});

describe("kill switch", () => {
  it("starts off and reads its state from the newest audit_log row", async () => {
    expect(await a.isOn()).toBe(false);
    await a.set(true, "인젝션 의심 — 전부 정지");
    expect(await a.isOn()).toBe(true);

    const row = await one<{ actor: string; after: { on: boolean; reason: string } }>(
      pool,
      `SELECT actor, after FROM audit_log WHERE action = 'kill_switch.set' ORDER BY seq DESC LIMIT 1`,
    );
    expect(row.actor).toBe("me");
    expect(row.after.on).toBe(true);
    expect(row.after.reason).toContain("인젝션");
  });

  it("creates no table of its own", async () => {
    const rows = await query<{ table_name: string }>(
      pool,
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name LIKE '%kill%'`,
    );
    expect(rows).toEqual([]);
  });

  it("invalidates the other process's cache through omnis_control", async () => {
    expect(await b.isOn()).toBe(false); // b의 캐시를 채운다
    await a.set(true, "from process A");
    await new Promise((r) => setTimeout(r, 400));
    expect(await b.isOn()).toBe(true);
  });

  it("reports since and reason for the hub route", async () => {
    await a.set(true, "점검 중");
    const status = await killSwitchStatus(pool);
    expect(status.on).toBe(true);
    expect(status.reason).toBe("점검 중");
    expect(status.since).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    await a.set(false, "점검 끝");
    const off = await killSwitchStatus(pool);
    expect(off.on).toBe(false);
    expect(off.reason).toBe("점검 끝");
  });

  it("keeps the whole history because audit_log is append-only", async () => {
    await a.set(true, "one");
    await a.set(false, "two");
    const rows = await query<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM audit_log WHERE action = 'kill_switch.set'`,
    );
    expect(Number(rows[0]?.n ?? "0")).toBeGreaterThanOrEqual(3);
  });
});

describe("assertOff", () => {
  it("throws KillSwitchError while on and stays silent while off", async () => {
    await expect(a.assertOff()).resolves.toBeUndefined();
    await a.set(true, "stop");
    await expect(a.assertOff()).rejects.toThrow(KillSwitchError);
    await expect(a.assertOff()).rejects.toThrow(/kill switch is on/);
  });
});
```

- [ ] 2. 테스트를 돌려 실패를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
```
기대 실패: `does not provide an export named 'createKillSwitch'`. (`createAudit`도 없으므로 Task 21을 먼저 끝내거나, Task 21의 8줄짜리 `createAudit`를 먼저 붙이고 돌아온다 — 아래 3단계가 그것을 한다.)

- [ ] 3. Task 21의 `createAudit` 구현을 지금 붙인다(8줄이고 kill switch가 그것 없이는 상태를 못 쓴다). `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/audit.ts`의 타입 정의 아래에 추가:

```ts
import { query } from "@omnis/db";
import type { Pool } from "pg";

export function createAudit(pool: Pool): Audit {
  return {
    async record(e) {
      await query(
        pool,
        `INSERT INTO audit_log (actor, action, target_table, target_id, before, after, approval_id)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
        [
          e.actor,
          e.action,
          e.target_table,
          e.target_id ?? null,
          e.before === undefined ? null : JSON.stringify(e.before),
          e.after === undefined ? null : JSON.stringify(e.after),
          e.approval_id ?? null,
        ],
      );
    },
  };
}
```
그리고 배럴에 `export { createAudit } from "./audit.js"; export type { Audit, AuditEntry } from "./audit.js";`를 더한다. (Task 21은 이 구현 위에 egress 강제와 테스트를 얹는다.)

- [ ] 4. kill switch를 쓴다. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/kill-switch.ts`:

```ts
import { query } from "@omnis/db";
import type { Pool } from "pg";
import type { Audit } from "./audit.js";
import type { Events } from "./events.js";
import type { Logger } from "./logger.js";

export class KillSwitchError extends Error {
  constructor(message = "kill switch is on") {
    super(message);
    this.name = "KillSwitchError";
  }
}

export interface KillSwitch {
  isOn(): Promise<boolean>;
  set(on: boolean, reason: string): Promise<void>;
  assertOff(): Promise<void>;
}

export interface KillSwitchDeps {
  pool: Pool;
  events: Events;
  audit: Audit;
  logger: Logger;
}

interface KillSwitchRow {
  on: boolean;
  since: string | null;
  reason: string | null;
}

/** 허브 GET /kill-switch가 쓰는 읽기 전용 조회. 상태는 audit_log의 최신 row가 전부다(계약 §5). */
export async function killSwitchStatus(pool: Pool): Promise<KillSwitchRow> {
  const rows = await query<{ at: Date; after: { on?: unknown; reason?: unknown } | null }>(
    pool,
    `SELECT at, after FROM audit_log WHERE action = 'kill_switch.set' ORDER BY seq DESC LIMIT 1`,
  );
  const row = rows[0];
  if (row === undefined) {
    return { on: false, since: null, reason: null };
  }
  return {
    on: row.after?.on === true,
    since: row.at.toISOString(),
    reason: typeof row.after?.reason === "string" ? row.after.reason : null,
  };
}

export function createKillSwitch(deps: KillSwitchDeps): KillSwitch {
  const { pool, events, audit, logger } = deps;
  let cached: boolean | null = null;

  // 다른 프로세스가 스위치를 만지면 캐시를 버린다(계약 §5).
  events.subscribe("omnis_control", (p) => {
    cached = p.kill_switch === true;
    logger.warn("kill switch changed elsewhere", { on: cached });
  });

  async function isOn(): Promise<boolean> {
    if (cached !== null) return cached;
    const status = await killSwitchStatus(pool);
    cached = status.on;
    return cached;
  }

  return {
    isOn,
    async set(on, reason) {
      await audit.record({
        actor: "me",
        action: "kill_switch.set",
        target_table: "kill_switch",
        after: { on, reason },
      });
      cached = on;
      await events.emit("durable", "control.kill_switch", { kill_switch: on });
      logger.warn("kill switch set", { on, reason });
    },
    async assertOff() {
      if (await isOn()) throw new KillSwitchError();
    },
  };
}
```

- [ ] 5. 배럴에 추가한다:

```ts
export { KillSwitchError, createKillSwitch, killSwitchStatus } from "./kill-switch.js";
export type { KillSwitch, KillSwitchDeps } from "./kill-switch.js";
```

- [ ] 6. 테스트를 돌려 통과를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
```
기대: `Tests  41 passed (41)`.

- [ ] 7. 커밋하지 않는다 — Task 20까지가 US-A08 하나의 커밋이다.

---

## Task 20: kill-switch-assert-off (US-A08, tier: Opus)

**스토리 US-A08**의 "모든 자율 루프/egress 체크포인트" 부분 — 스위치가 켜졌을 때 실제로 **무엇이 멈추는가**를 배선하고 증명한다. Phase A에서 자율적으로 도는 것은 스케줄러 틱 하나이고(어댑터·L3 루프는 다른 계획), egress는 Task 22가 잡는다.

**읽을 곳**: 마스터 §7(kill switch가 멈추는 대상), Task 14의 `SchedulerDeps.isKillSwitchOn`(자리를 미리 열어 뒀다), A7 §7 공통 금지(승인 게이트 전에 비가역 tool을 배선하지 않는다).

**만들지 않을 것(YAGNI)**: 이미 claim된 잡의 중단(다음 틱부터 멈추면 충분하다), 스위치가 켜진 동안의 요청 큐잉, UI 배너(US-A24~A30).

**Files:**
- Modify: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/scheduler.ts`(주석만 — `isKillSwitchOn`은 Task 14에 이미 있다)
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/kill-switch-scheduler.test.ts`

**Interfaces:**
- Consumes: `createScheduler`(`isKillSwitchOn` 옵션, Task 14), `createKillSwitch`(Task 19).
- Produces: 없음(배선 계약 테스트).

### Steps

- [ ] 1. 테스트를 쓴다. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/kill-switch-scheduler.test.ts`:

```ts
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, one, query } from "@omnis/db";
import {
  type Events,
  type KillSwitch,
  type Scheduler,
  createAudit,
  createEvents,
  createKillSwitch,
  createLogger,
  createScheduler,
} from "@omnis/kernel";

let pool: Pool;
let events: Events & { close(): Promise<void> };
let killSwitch: KillSwitch;
let scheduler: Scheduler;
let runs = 0;
const logger = createLogger("@omnis/kernel");

beforeAll(async () => {
  pool = createPool();
  events = createEvents({ pool, logger });
  killSwitch = createKillSwitch({ pool, events, audit: createAudit(pool), logger });
  await killSwitch.set(false, "test start");
  scheduler = createScheduler({
    pool,
    events,
    logger,
    tickMs: 50,
    isKillSwitchOn: () => killSwitch.isOn(),
  });
  scheduler.register("test_killable", "*/1 * * * *", async () => {
    runs += 1;
  });
  await scheduler.start();
});
afterAll(async () => {
  await scheduler.stop();
  await killSwitch.set(false, "test end");
  await events.close();
  await pool.end();
});

describe("kill switch stops the scheduler", () => {
  it("runs a due job while the switch is off", async () => {
    runs = 0;
    await query(pool, `UPDATE jobs SET next_run_at = now() - interval '1 minute' WHERE name='test_killable'`);
    await new Promise((r) => setTimeout(r, 400));
    expect(runs).toBe(1);
  });

  it("stops running due jobs while the switch is on, and leaves the claim untouched", async () => {
    runs = 0;
    await killSwitch.set(true, "stop everything");
    await query(pool, `UPDATE jobs SET next_run_at = now() - interval '1 minute' WHERE name='test_killable'`);
    await new Promise((r) => setTimeout(r, 400));
    expect(runs).toBe(0);

    const row = await one<{ claimed_at: Date | null }>(
      pool,
      `SELECT claimed_at FROM jobs WHERE name = 'test_killable'`,
    );
    expect(row.claimed_at).toBeNull();
  });

  it("resumes on the next tick once the switch goes off", async () => {
    runs = 0;
    await killSwitch.set(false, "resume");
    await new Promise((r) => setTimeout(r, 400));
    expect(runs).toBe(1);
  });
});
```

- [ ] 2. 테스트를 돌린다. Task 14가 `isKillSwitchOn`을 이미 넣었으므로 바로 통과해야 한다 — 실패하면 Task 14의 `tick()`이 게이트를 빠뜨린 것이다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
```
기대: `Tests  44 passed (44)`.

- [ ] 3. `scheduler.ts`의 `isKillSwitchOn` 필드 주석을 확정 문구로 바꾼다(왜 이 게이트가 여기 있는지 다음 사람이 알도록):

```ts
  /** 마스터 §7: kill switch 하나로 모든 자율 루프가 멈춘다. 스케줄러 틱이 Phase A의 유일한 자율 루프다.
   *  이미 claim된 잡은 끝까지 돌고, 다음 틱부터 멈춘다. */
  isKillSwitchOn?: () => Promise<boolean>;
```

- [ ] 4. US-A08을 하나의 원자 커밋으로 남긴다(Task 19~20).

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-A08: kill switch(전역 플래그 + 자율 루프 체크포인트)

- 상태 저장소는 새 테이블이 아니라 audit_log의 최신 kill_switch.set row(계약 §5)
- 프로세스 내 캐시 + omnis_control NOTIFY로 다른 프로세스 캐시까지 무효화
- assertOff()는 KillSwitchError를 throw
- 스케줄러 틱이 매번 게이트를 지난다 — 켜져 있으면 due 잡도 claim하지 않는다
- killSwitchStatus(pool)로 since/reason 조회(허브 GET /kill-switch용)

Implemented-by: Claude Opus

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 21: audit-record (US-A09, tier: Opus)

**스토리 US-A09** — 목표: 감사 로그 미들웨어(모든 egress가 경유하도록 강제) / 산출물: `packages/kernel/src/audit.ts` / 검증 명령: `pnpm --filter @omnis/kernel test:integration` / 티어: Opus. 의존: A04, A07.

이 태스크는 기록 쪽(`Audit.record`)을 닫고, Task 22가 강제 쪽(`runEgress`)을 닫는다.

**읽을 곳**: 계약 §5(`AuditEntry` 필드와 `actor` 값 형태 `'me' | 'agent:${RuntimeKind}' | 'system'`), A3 §6(`audit_log` DDL — FK 없음, `approval_id`도 FK 없음), A3-D5(UPDATE/DELETE/TRUNCATE 영구 금지), A3 §9 규칙 5(**모든 `→ sent` 전이는 `approval_id`와 함께 기록된다. 승인 없는 sent는 존재할 수 없고, 야간 잡이 `sent인데 approval_id 없음`을 센다**), 마스터 §2 지표("승인 없는 외부 전송 0건").

**만들지 않을 것(YAGNI)**: 감사 로그 조회 API(A5의 Settings 화면, Phase B), 서명·해시 체인(append-only 트리거 + REVOKE로 충분, A3-D5), 보존 롤오프(`audit_log`는 영구 보존, A3 §11), 구조화된 `action` enum(자유 문자열이 정본 — A3가 CHECK를 걸지 않았다).

**Files:**
- Modify: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/audit.ts`(Task 19에서 붙인 `createAudit`에 배치 헬퍼와 불변식 쿼리를 더한다)
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/audit.test.ts`

**Interfaces:**
- Consumes: `query` (`@omnis/db`).
- Produces (`@omnis/kernel`): `interface AuditEntry` · `interface Audit { record(e: AuditEntry): Promise<void> }` (계약 §5) · `createAudit(pool: Pool): Audit` · `countUnapprovedSends(pool: Pool, since: Date): Promise<number>` (A3 §9 규칙 5의 야간 점검 쿼리 — 0이 아니면 마스터 §2 지표가 깨진 것이다).

### Steps

- [ ] 1. 실패하는 테스트를 쓴다. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/audit.test.ts`:

```ts
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, one, query } from "@omnis/db";
import { type Audit, countUnapprovedSends, createAudit } from "@omnis/kernel";

let pool: Pool;
let audit: Audit;

beforeAll(() => {
  pool = createPool();
  audit = createAudit(pool);
});
afterAll(async () => {
  await pool.end();
});

describe("audit.record", () => {
  it("writes every field and leaves optionals null", async () => {
    await audit.record({
      actor: "agent:codex",
      action: "item.sent",
      target_table: "items",
      target_id: "22222222-2222-2222-2222-222222222222",
      before: { status: "approved" },
      after: { status: "sent", external_id: "1758.000200" },
      approval_id: "33333333-3333-3333-3333-333333333333",
    });
    const row = await one<{
      actor: string;
      action: string;
      target_table: string;
      target_id: string;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
      approval_id: string;
      at: Date;
    }>(pool, `SELECT * FROM audit_log WHERE action = 'item.sent' ORDER BY seq DESC LIMIT 1`);

    expect(row.actor).toBe("agent:codex");
    expect(row.target_id).toBe("22222222-2222-2222-2222-222222222222");
    expect(row.before.status).toBe("approved");
    expect(row.after.external_id).toBe("1758.000200");
    expect(row.approval_id).toBe("33333333-3333-3333-3333-333333333333");
    expect(row.at).toBeInstanceOf(Date);
  });

  it("accepts an entry with no optional fields", async () => {
    await audit.record({ actor: "system", action: "hub.started", target_table: "jobs" });
    const row = await one<{ target_id: string | null; before: unknown; after: unknown; approval_id: string | null }>(
      pool,
      `SELECT target_id, before, after, approval_id FROM audit_log WHERE action='hub.started' ORDER BY seq DESC LIMIT 1`,
    );
    expect(row.target_id).toBeNull();
    expect(row.before).toBeNull();
    expect(row.after).toBeNull();
    expect(row.approval_id).toBeNull();
  });

  it("keeps a target_id that no longer exists (no FK, A3 §1)", async () => {
    const acc = await one<{ id: string }>(
      pool,
      `INSERT INTO accounts (channel, external_id, display) VALUES ('slack','T-au:U','au') RETURNING id`,
    );
    const thr = await one<{ id: string }>(
      pool,
      `INSERT INTO threads (account_id, external_id, kind) VALUES ($1,'au-1','dm') RETURNING id`,
      [acc.id],
    );
    await audit.record({ actor: "me", action: "thread.archived", target_table: "threads", target_id: thr.id });
    await query(pool, `DELETE FROM threads WHERE id = $1`, [thr.id]);

    const row = await one<{ target_id: string }>(
      pool,
      `SELECT target_id FROM audit_log WHERE action='thread.archived' ORDER BY seq DESC LIMIT 1`,
    );
    expect(row.target_id).toBe(thr.id);
  });

  it("cannot be edited or deleted", async () => {
    const row = await one<{ seq: string }>(
      pool,
      `SELECT seq::text AS seq FROM audit_log ORDER BY seq DESC LIMIT 1`,
    );
    await expect(query(pool, `UPDATE audit_log SET actor='hacker' WHERE seq=$1`, [row.seq])).rejects.toThrow(
      /append-only/,
    );
    await expect(query(pool, `DELETE FROM audit_log WHERE seq=$1`, [row.seq])).rejects.toThrow(/append-only/);
  });
});

describe("countUnapprovedSends (A3 §9 rule 5 / 마스터 §2)", () => {
  it("counts item.sent rows that carry no approval_id", async () => {
    const since = new Date(Date.now() - 60_000);
    const before = await countUnapprovedSends(pool, since);

    await audit.record({
      actor: "agent:claude_code",
      action: "item.sent",
      target_table: "items",
      target_id: "44444444-4444-4444-4444-444444444444",
    });
    expect(await countUnapprovedSends(pool, since)).toBe(before + 1);

    await audit.record({
      actor: "me",
      action: "item.sent",
      target_table: "items",
      target_id: "55555555-5555-5555-5555-555555555555",
      approval_id: "66666666-6666-6666-6666-666666666666",
    });
    expect(await countUnapprovedSends(pool, since)).toBe(before + 1);
  });
});
```

- [ ] 2. 테스트를 돌려 실패를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
```
기대 실패: `does not provide an export named 'countUnapprovedSends'`.

- [ ] 3. `audit.ts`에 불변식 쿼리를 더한다(`createAudit` 아래):

```ts
/** A3 §9 규칙 5 / 마스터 §2: 승인 없는 외부 전송은 0건이어야 한다.
 *  밤 다이제스트 잡(Phase B)이 이 값을 세고, 0이 아니면 그날 다이제스트에 뜬다. */
export async function countUnapprovedSends(pool: Pool, since: Date): Promise<number> {
  const rows = await query<{ n: string }>(
    pool,
    `SELECT count(*)::text AS n FROM audit_log
      WHERE action = 'item.sent' AND approval_id IS NULL AND at >= $1`,
    [since],
  );
  return Number(rows[0]?.n ?? "0");
}
```
그리고 배럴에 `countUnapprovedSends`를 더한다.

- [ ] 4. 테스트를 돌려 통과를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
```
기대: `Tests  49 passed (49)`.

- [ ] 5. 커밋하지 않는다 — Task 22까지가 US-A09 하나의 커밋이다.

---

## Task 22: egress-middleware (US-A09, tier: Opus)

**스토리 US-A09**의 핵심 — "모든 egress가 감사 로그를 경유하도록 **강제**". 강제는 관례가 아니라 구조여야 한다(마스터 D10: 프롬프트가 아니라 구조로). 이 태스크는 동시에 `createKernel`(계약 §5)을 조립한다 — 지금에야 6개 조각이 전부 존재하기 때문이다.

**강제 패턴 — 무엇이 무엇을 막는가**:
1. `runEgress(deps, spec, fn)`가 **유일한** 실행 경로다. 순서는 ① `killSwitch.assertOff()` → ② `approvals.beginExecution(approvalId)`(decided + accept|edit이 아니면 `ApprovalStateError`) → ③ `fn(token)` → ④ 성공이면 `completeExecution` + `audit.record({approval_id})`, 실패면 `failExecution` + `audit.record`. 감사 기록은 `finally` 경로에 있어 성공·실패 어느 쪽도 빠져나갈 수 없다.
2. `fn`은 `EgressToken`을 받는데, 이 브랜디드 타입은 `runEgress` 안에서만 만들어진다. 채널로 나가는 함수(`createOutbox().send`)가 토큰을 **인자로 요구**하므로, 승인 없이 부르는 코드는 타입체크에서 떨어진다.
3. 어댑터 인스턴스는 `createOutbox`가 클로저로 가두고 밖으로 내보내지 않는다. 허브는 raw `Adapter`를 손에 쥐지 않는다 — `adapter.send(...)`를 직접 부를 참조가 없다.

**읽을 곳**: 마스터 §7(승인 게이트 — 모든 egress가 `pending_approvals`를 거친다), A7 §1(`packages/agents`에는 `send`/`delete`/`delegate`/`calendar_write` 타입 자체가 없고 그것은 `packages/kernel`의 승인 핸들러에만 있다), A3 §9(draft 전이와 규칙 5), 계약 §3.3(`Adapter.send`는 "승인 후에만 호출된다"), 계약 §5(`Kernel` 인터페이스 — `events/scheduler/approvals/killSwitch/audit/ingest/close`).

**만들지 않을 것(YAGNI)**: 실제 채널 어댑터(다른 계획), outbox claim 워커(A3 §9 규칙 2·4 — `followup_sweep` 잡은 Phase B), 재시도 백오프, person 신원 해석(A3 §10은 Phase A 스토리가 아니다 — ingest sink는 `author_person_id`를 NULL로 두고 어댑터가 `person` author를 주더라도 해석하지 않는다), `ingest.scan`/`ingest.read` RPC(Phase B, A7 §7 시드 메모).

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/egress.ts`, `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/outbox.ts`, `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/ingest.ts`, `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/kernel.ts`
- Modify: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/index.ts`
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/egress.test.ts`, `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/kernel.test.ts`

**Interfaces:**
- Consumes: `Approvals`(+`beginExecution`/`completeExecution`/`failExecution`), `KillSwitch`, `Audit`, `Events`, `Scheduler` (Task 12~21) · `Adapter`, `ThreadRef`, `Outbound`, `SendResult`, `NormalizedItem`, `AdapterEvent`, `IngestSink` (`@omnis/protocol`).
- Produces (`@omnis/kernel`): `type EgressToken`(브랜디드) · `interface EgressSpec { approvalId: string; actor: string; action: string; targetTable: string; targetId?: string }` · `runEgress<T>(deps: EgressDeps, spec: EgressSpec, fn: (t: EgressToken) => Promise<T>): Promise<T>` · `interface EgressDeps { approvals: Approvals; killSwitch: KillSwitch; audit: Audit }` · `createOutbox(deps: OutboxDeps): { send(t: EgressToken, ref: ThreadRef, draft: Outbound): Promise<SendResult> }` · `createIngestSink(deps: { pool: Pool; logger: Logger }): IngestSink` · `interface KernelDeps { pool: Pool; now?: () => Date; logger?: Logger }` · `createKernel(deps: KernelDeps): Kernel` · `interface Kernel { events; scheduler; approvals; killSwitch; audit; ingest: { sink: IngestSink }; close(): Promise<void> }` (계약 §5 그대로).

### Steps

- [ ] 1. 실패하는 테스트를 쓴다. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/egress.test.ts`:

```ts
import type { Adapter, Outbound, SendResult, ThreadRef } from "@omnis/protocol";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPool, one } from "@omnis/db";
import {
  ApprovalStateError,
  type EgressToken,
  KillSwitchError,
  type Kernel,
  createKernel,
  createOutbox,
  runEgress,
} from "@omnis/kernel";

let pool: Pool;
let kernel: Kernel;
const sent: Array<{ ref: ThreadRef; draft: Outbound }> = [];
let failNext = false;

const fakeAdapter = {
  id: "slack-test",
  channel: "slack",
  capabilities: () => ({
    read: true, write: true, realtime: true, history: true, media: false,
    markRead: true, typing: false, archive: true, delete: false,
  }),
  connect: async () => undefined,
  backfill: async function* () {},
  subscribe: async function* () {},
  async send(ref: ThreadRef, draft: Outbound): Promise<SendResult> {
    if (failNext) throw new Error("slack 503");
    sent.push({ ref, draft });
    return { externalId: "1758.000900", sentAt: new Date().toISOString() };
  },
  health: async () => ({ channel: "slack" as const, accountExternalId: "T1", status: "healthy" as const, lastEventAt: null }),
} as unknown as Adapter;

let outbox: ReturnType<typeof createOutbox>;

beforeAll(() => {
  pool = createPool();
  kernel = createKernel({ pool });
  outbox = createOutbox({ adapters: new Map([["slack", fakeAdapter]]) });
});
beforeEach(async () => {
  sent.length = 0;
  failNext = false;
  await kernel.killSwitch.set(false, "egress test reset");
});
afterAll(async () => {
  await kernel.close();
  await pool.end();
});

const base = {
  args: { text: "보냅니다" },
  description: "Slack 답장 발송",
  config: { allow_accept: true, allow_edit: true, allow_respond: false, allow_ignore: true },
  risk: "normal" as const,
};

async function approved(): Promise<string> {
  const id = await kernel.approvals.propose({ ...base, action: "send" });
  await kernel.approvals.decide(id, { decision: "accept" });
  return id;
}

describe("runEgress", () => {
  it("executes, marks the approval executed, and audits with approval_id", async () => {
    const approvalId = await approved();
    const result = await runEgress(
      kernel,
      { approvalId, actor: "me", action: "item.sent", targetTable: "items" },
      (token: EgressToken) => outbox.send(token, { accountId: "a", externalId: "C1" }, { text: "보냅니다" }),
    );
    expect(result.externalId).toBe("1758.000900");
    expect(sent).toHaveLength(1);

    const ap = await one<{ state: string }>(
      pool,
      `SELECT state FROM pending_approvals WHERE id = $1`,
      [approvalId],
    );
    expect(ap.state).toBe("executed");

    const log = await one<{ approval_id: string; after: Record<string, unknown> }>(
      pool,
      `SELECT approval_id, after FROM audit_log WHERE approval_id = $1 ORDER BY seq DESC LIMIT 1`,
      [approvalId],
    );
    expect(log.approval_id).toBe(approvalId);
    expect(log.after.ok).toBe(true);
  });

  it("refuses to run when the kill switch is on — before touching the adapter", async () => {
    const approvalId = await approved();
    await kernel.killSwitch.set(true, "freeze");
    await expect(
      runEgress(kernel, { approvalId, actor: "me", action: "item.sent", targetTable: "items" }, (t) =>
        outbox.send(t, { accountId: "a", externalId: "C1" }, { text: "x" }),
      ),
    ).rejects.toThrow(KillSwitchError);
    expect(sent).toHaveLength(0);

    const ap = await one<{ state: string }>(pool, `SELECT state FROM pending_approvals WHERE id=$1`, [approvalId]);
    expect(ap.state).toBe("decided");
  });

  it("refuses an approval that was never decided, and never calls the adapter", async () => {
    const approvalId = await kernel.approvals.propose({ ...base, action: "send" });
    await expect(
      runEgress(kernel, { approvalId, actor: "me", action: "item.sent", targetTable: "items" }, (t) =>
        outbox.send(t, { accountId: "a", externalId: "C1" }, { text: "x" }),
      ),
    ).rejects.toThrow(ApprovalStateError);
    expect(sent).toHaveLength(0);
  });

  it("refuses an approval that was ignored", async () => {
    const approvalId = await kernel.approvals.propose({ ...base, action: "send" });
    await kernel.approvals.decide(approvalId, { decision: "ignore" });
    await expect(
      runEgress(kernel, { approvalId, actor: "me", action: "item.sent", targetTable: "items" }, (t) =>
        outbox.send(t, { accountId: "a", externalId: "C1" }, { text: "x" }),
      ),
    ).rejects.toThrow(/not executable/);
  });

  it("marks the approval failed and still audits when the adapter throws", async () => {
    const approvalId = await approved();
    failNext = true;
    await expect(
      runEgress(kernel, { approvalId, actor: "me", action: "item.sent", targetTable: "items" }, (t) =>
        outbox.send(t, { accountId: "a", externalId: "C1" }, { text: "x" }),
      ),
    ).rejects.toThrow(/slack 503/);

    const ap = await one<{ state: string; fail_reason: string }>(
      pool,
      `SELECT state, fail_reason FROM pending_approvals WHERE id = $1`,
      [approvalId],
    );
    expect(ap.state).toBe("failed");
    expect(ap.fail_reason).toContain("503");

    const log = await one<{ after: Record<string, unknown> }>(
      pool,
      `SELECT after FROM audit_log WHERE approval_id = $1 ORDER BY seq DESC LIMIT 1`,
      [approvalId],
    );
    expect(log.after.ok).toBe(false);
  });

  it("cannot be bypassed: outbox.send needs a token only runEgress can mint", () => {
    // @ts-expect-error — 토큰 없이 부르면 컴파일되지 않는다. 이것이 강제 장치다.
    void (() => outbox.send({ accountId: "a", externalId: "C1" }, { text: "x" }));
  });

  it("never leaks the raw adapter, so nothing can call send() directly", () => {
    expect(Object.keys(outbox)).toEqual(["send"]);
  });
});
```

- [ ] 2. 커널 조립 테스트를 쓴다. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/kernel.test.ts`:

```ts
import type { NormalizedItem } from "@omnis/protocol";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, one } from "@omnis/db";
import { type Kernel, createKernel } from "@omnis/kernel";

let pool: Pool;
let kernel: Kernel;
let accountId = "";

beforeAll(async () => {
  pool = createPool();
  kernel = createKernel({ pool });
  const acc = await one<{ id: string }>(
    pool,
    `INSERT INTO accounts (channel, external_id, display) VALUES ('slack','T-ing:U','ing') RETURNING id`,
  );
  accountId = acc.id;
});
afterAll(async () => {
  await kernel.close();
  await pool.end();
});

describe("createKernel", () => {
  it("exposes exactly the contract's surface", () => {
    expect(Object.keys(kernel).sort()).toEqual([
      "approvals",
      "audit",
      "close",
      "events",
      "ingest",
      "killSwitch",
      "scheduler",
    ]);
    expect(typeof kernel.ingest.sink).toBe("function");
  });
});

describe("ingest.sink", () => {
  const item = (externalId: string, body: string): NormalizedItem => ({
    threadExternalId: "C-ing",
    externalId,
    kind: "message",
    author: { kind: "person", id: "U-mina" },
    body,
    attachments: [],
    sentAt: new Date().toISOString(),
    status: "received",
    sourceHash: `hash-${externalId}`,
    threadMeta: {
      externalId: "C-ing",
      kind: "dm",
      title: "Mina",
      participants: [{ externalId: "U-mina", displayName: "Mina" }],
      lastItemAt: new Date().toISOString(),
      archivedAt: null,
    },
  });

  it("upserts the thread and the item, leaving author resolution to Phase B", async () => {
    await kernel.ingest.sink(accountId, item("m-1", "첫 메시지"));
    const row = await one<{
      body: string;
      status: string;
      author_person_id: string | null;
      author_is_me: boolean;
      thread_kind: string;
    }>(
      pool,
      `SELECT i.body, i.status, i.author_person_id, i.author_is_me, t.kind AS thread_kind
         FROM items i JOIN threads t ON t.id = i.thread_id
        WHERE i.account_id = $1 AND i.external_id = 'm-1'`,
      [accountId],
    );
    expect(row.body).toBe("첫 메시지");
    expect(row.status).toBe("received");
    expect(row.author_person_id).toBeNull();
    expect(row.author_is_me).toBe(false);
    expect(row.thread_kind).toBe("dm");
  });

  it("is idempotent on source_hash and bumps threads.last_item_at", async () => {
    await kernel.ingest.sink(accountId, item("m-1", "첫 메시지"));
    const count = await one<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM items WHERE account_id=$1 AND source_hash='hash-m-1'`,
      [accountId],
    );
    expect(count.n).toBe("1");

    await kernel.ingest.sink(accountId, item("m-2", "두 번째"));
    const thread = await one<{ last_item_at: Date }>(
      pool,
      `SELECT last_item_at FROM threads WHERE account_id=$1 AND external_id='C-ing'`,
      [accountId],
    );
    expect(thread.last_item_at).toBeInstanceOf(Date);
  });

  it("writes an AdapterEvent to the cold tier instead of items", async () => {
    await kernel.ingest.sink(accountId, {
      kind: "rate_limited",
      retryAfterMs: 30_000,
      endpoint: "conversations.history",
      at: new Date().toISOString(),
    });
    const ev = await one<{ payload: Record<string, unknown> }>(
      pool,
      `SELECT payload FROM events WHERE kind = 'adapter.rate_limited' ORDER BY seq DESC LIMIT 1`,
    );
    expect(ev.payload.endpoint).toBe("conversations.history");
  });

  it("refuses an item for an unknown thread with no threadMeta", async () => {
    await expect(
      kernel.ingest.sink(accountId, {
        threadExternalId: "C-never",
        externalId: "m-x",
        kind: "message",
        author: { kind: "person", id: "U" },
        body: "orphan",
        attachments: [],
        sentAt: new Date().toISOString(),
        status: "received",
        sourceHash: "hash-m-x",
      }),
    ).rejects.toThrow(/unknown thread/);
  });
});
```

- [ ] 3. 두 테스트를 돌려 실패를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
```
기대 실패: `does not provide an export named 'runEgress'`.

- [ ] 4. egress 게이트를 쓴다. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/egress.ts`:

```ts
import type { Approvals } from "./approvals.js";
import type { Audit } from "./audit.js";
import type { KillSwitch } from "./kill-switch.js";

declare const egressBrand: unique symbol;
/** runEgress 안에서만 만들어진다. 채널로 나가는 함수는 이 토큰을 인자로 요구해 우회를 컴파일 에러로 만든다. */
export type EgressToken = { readonly [egressBrand]: "EgressToken"; readonly approvalId: string };

export interface EgressSpec {
  approvalId: string;
  actor: string; // 'me' | `agent:${RuntimeKind}` | 'system'
  action: string; // 'item.sent' | 'calendar.written' | 'item.deleted' ...
  targetTable: string;
  targetId?: string;
}

export interface EgressDeps {
  approvals: Approvals;
  killSwitch: KillSwitch;
  audit: Audit;
}

/** 비가역 행동의 유일한 실행 경로(마스터 §7, A7 §1). 순서를 바꾸지 않는다. */
export async function runEgress<T>(
  deps: EgressDeps,
  spec: EgressSpec,
  fn: (token: EgressToken) => Promise<T>,
): Promise<T> {
  await deps.killSwitch.assertOff();
  await deps.approvals.beginExecution(spec.approvalId); // decided + accept|edit이 아니면 throw
  const token = { approvalId: spec.approvalId } as unknown as EgressToken;
  const targetIdField = spec.targetId !== undefined ? { target_id: spec.targetId } : {};
  try {
    const out = await fn(token);
    await deps.approvals.completeExecution(spec.approvalId);
    await deps.audit.record({
      actor: spec.actor,
      action: spec.action,
      target_table: spec.targetTable,
      ...targetIdField,
      after: { ok: true },
      approval_id: spec.approvalId,
    });
    return out;
  } catch (e) {
    const reason = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    await deps.approvals.failExecution(spec.approvalId, reason);
    await deps.audit.record({
      actor: spec.actor,
      action: spec.action,
      target_table: spec.targetTable,
      ...targetIdField,
      after: { ok: false, reason },
      approval_id: spec.approvalId,
    });
    throw e;
  }
}
```

- [ ] 5. outbox를 쓴다. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/outbox.ts`:

```ts
import type { Adapter, Outbound, SendResult, ThreadRef } from "@omnis/protocol";
import type { EgressToken } from "./egress.js";

export interface OutboxDeps {
  /** 채널 → 어댑터. 이 Map은 클로저 밖으로 나가지 않는다. */
  adapters: ReadonlyMap<string, Adapter>;
}

export interface Outbox {
  send(token: EgressToken, ref: ThreadRef, draft: Outbound): Promise<SendResult>;
}

/** 채널 send()에 닿는 유일한 지점. 토큰이 없으면 컴파일되지 않고, 어댑터는 밖으로 새지 않는다. */
export function createOutbox(deps: OutboxDeps): Outbox {
  const { adapters } = deps;
  return {
    async send(token, ref, draft) {
      void token; // 존재 자체가 승인 증거다
      const channel = ref.accountId.includes(":") ? ref.accountId.split(":")[0] : undefined;
      const adapter = channel !== undefined ? adapters.get(channel) : [...adapters.values()][0];
      if (adapter === undefined) {
        throw new Error(`no adapter registered for thread ${ref.accountId}/${ref.externalId}`);
      }
      return adapter.send(ref, draft);
    },
  };
}
```

> `accountId`로 채널을 고르는 규칙은 Phase A에 어댑터가 하나도 없어서 아직 정본이 없다. 어댑터 계획(US-A12~A15)이 실제 `accounts` 조회로 바꾼다 — 그때까지는 `adapters` Map이 1개짜리이므로 동작이 결정론적이다.

- [ ] 6. ingest sink를 쓴다. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/ingest.ts`:

```ts
import { one, query, tx } from "@omnis/db";
import type { AdapterEvent, IngestSink, NormalizedItem } from "@omnis/protocol";
import type { Pool } from "pg";
import type { Logger } from "./logger.js";

function isItem(e: NormalizedItem | AdapterEvent): e is NormalizedItem {
  return "threadExternalId" in e;
}

/** 어댑터가 밀어넣는 유일한 입구(계약 §3.3 IngestSink).
 *  Phase A는 thread/item upsert까지만 한다 — person 신원 해석(A3 §10)은 Phase A 스토리가 아니므로
 *  author_person_id를 채우지 않는다. 어댑터가 person author를 줘도 NULL로 남는다. */
export function createIngestSink(deps: { pool: Pool; logger: Logger }): IngestSink {
  const { pool, logger } = deps;
  return async (accountId, e) => {
    if (!isItem(e)) {
      await query(
        pool,
        `INSERT INTO events (kind, actor, target_table, target_id, payload)
         VALUES ($1, 'system', 'accounts', $2, $3::jsonb)`,
        [`adapter.${e.kind}`, accountId, JSON.stringify(e)],
      );
      return;
    }

    await tx(pool, async (c) => {
      let threadId: string;
      if (e.threadMeta !== undefined) {
        const m = e.threadMeta;
        const row = await one<{ id: string }>(
          c,
          `INSERT INTO threads (account_id, external_id, kind, title, last_item_at, archived_at)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (account_id, external_id) DO UPDATE
               SET title = EXCLUDED.title,
                   last_item_at = GREATEST(threads.last_item_at, EXCLUDED.last_item_at),
                   archived_at = EXCLUDED.archived_at
             RETURNING id`,
          [accountId, m.externalId, m.kind, m.title, m.lastItemAt, m.archivedAt],
        );
        threadId = row.id;
      } else {
        const rows = await query<{ id: string }>(
          c,
          `SELECT id FROM threads WHERE account_id = $1 AND external_id = $2`,
          [accountId, e.threadExternalId],
        );
        const row = rows[0];
        if (row === undefined) {
          throw new Error(
            `unknown thread ${e.threadExternalId} for account ${accountId}: adapter must send threadMeta on first sight`,
          );
        }
        threadId = row.id;
      }

      // author_agent_id만 해석한다. person은 Phase B(A3 §10).
      const agentId =
        e.author.kind === "agent"
          ? ((await query<{ id: string }>(c, `SELECT id FROM agent_runtimes WHERE id = $1`, [e.author.id]))[0]
              ?.id ?? null)
          : null;

      await query(
        c,
        `INSERT INTO items (thread_id, account_id, external_id, kind, status, author_agent_id,
                            subject, body, body_html, attachments, sent_at, source_hash)
           VALUES ($1,$2,$3,$4,'received',$5,$6,$7,$8,$9::jsonb,$10,$11)
           ON CONFLICT (account_id, source_hash) WHERE source_hash IS NOT NULL DO NOTHING`,
        [
          threadId,
          accountId,
          e.externalId,
          e.kind,
          agentId,
          null,
          e.body,
          e.bodyHtml ?? null,
          JSON.stringify(e.attachments),
          e.sentAt,
          e.sourceHash,
        ],
      );

      await query(
        c,
        `UPDATE threads SET last_item_at = GREATEST(COALESCE(last_item_at, $2::timestamptz), $2::timestamptz)
          WHERE id = $1`,
        [threadId, e.sentAt],
      );
    });
    logger.debug("ingested", { accountId, externalId: e.externalId });
  };
}
```

- [ ] 7. 커널을 조립한다. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/kernel.ts`:

```ts
import type { IngestSink } from "@omnis/protocol";
import type { Pool } from "pg";
import { type Approvals, createApprovals } from "./approvals.js";
import { type Audit, createAudit } from "./audit.js";
import { type Events, createEvents } from "./events.js";
import { type KillSwitch, createKillSwitch } from "./kill-switch.js";
import { createIngestSink } from "./ingest.js";
import { type Logger, createLogger } from "./logger.js";
import { type Scheduler, createScheduler } from "./scheduler.js";

export interface KernelDeps {
  pool: Pool;
  now?: () => Date;
  logger?: Logger;
}

export interface Kernel {
  events: Events;
  scheduler: Scheduler;
  approvals: Approvals;
  killSwitch: KillSwitch;
  audit: Audit;
  ingest: { sink: IngestSink };
  close(): Promise<void>;
}

export function createKernel(deps: KernelDeps): Kernel {
  const { pool } = deps;
  const logger = deps.logger ?? createLogger("@omnis/kernel");
  const now = deps.now ?? ((): Date => new Date());

  const events = createEvents({ pool, logger });
  const audit = createAudit(pool);
  const killSwitch = createKillSwitch({ pool, events, audit, logger });
  const approvals = createApprovals({ pool, logger, now, audit });
  const scheduler = createScheduler({
    pool,
    events,
    logger,
    now,
    isKillSwitchOn: () => killSwitch.isOn(),
  });

  return {
    events,
    scheduler,
    approvals,
    killSwitch,
    audit,
    ingest: { sink: createIngestSink({ pool, logger }) },
    async close() {
      await scheduler.stop();
      await events.close();
    },
  };
}
```

- [ ] 8. 배럴을 갱신한다:

```ts
export { runEgress } from "./egress.js";
export type { EgressDeps, EgressSpec, EgressToken } from "./egress.js";
export { createOutbox } from "./outbox.js";
export type { Outbox, OutboxDeps } from "./outbox.js";
export { createIngestSink } from "./ingest.js";
export { createKernel } from "./kernel.js";
export type { Kernel, KernelDeps } from "./kernel.js";
```

- [ ] 9. 테스트를 돌려 통과를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration && pnpm typecheck
```
기대: `Tests  62 passed (62)`, typecheck 에러 0. (`@ts-expect-error`가 붙은 우회 시도 테스트는 **컴파일이 실패해야 통과**한다 — typecheck가 통과하면 강제 장치가 산다.)

- [ ] 10. US-A09를 하나의 원자 커밋으로 남긴다(Task 21~22).

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-A09: 감사 로그 + 모든 egress가 경유하는 강제 게이트

- createAudit: audit_log append-only INSERT, FK 없는 target_id/approval_id 그대로 보존
- countUnapprovedSends: A3 §9 규칙 5 / 마스터 §2 '승인 없는 외부 전송 0건' 점검 쿼리
- runEgress: killSwitch.assertOff → beginExecution → fn → completeExecution|failExecution + audit(approval_id)
- 우회 불가 3중: EgressToken은 runEgress만 발급, outbox.send가 토큰을 요구, 어댑터는 클로저 밖으로 안 나간다
- createKernel: events/scheduler/approvals/killSwitch/audit/ingest/close (계약 §5 그대로)
- ingest.sink: thread/item upsert + source_hash 멱등, AdapterEvent는 cold 티어로

Implemented-by: Claude Opus

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 23: hub-bootstrap (US-A10, tier: Sonnet)

**스토리 US-A10** — 목표: `apps/hub` 부트스트랩(kernel 초기화, Postgres 연결, graceful shutdown) / 산출물: `apps/hub/src/main.ts` / 검증 명령: `pnpm --filter @omnis/hub build` / 티어: Sonnet. 의존: A05~A09.

**읽을 곳**: 마스터 §4.2(허브는 `127.0.0.1:8787`에만 bind, Tailscale Serve가 `/api/`로 노출, 8642는 Hermes), 계약 §5(허브 HTTP 표면 표), 계약 §9(환경변수 `DATABASE_URL`·`OMNIS_HUB_PORT=8787`, 로그 형식), A6 §3(`tailscale serve --https=443 /api/ localhost:8787/`).

**만들지 않을 것(YAGNI)**: Express/Fastify(라우트 5개에 프레임워크는 과하다 — `node:http`로 충분하고, 계약 §1이 `apps/hub`의 의존을 `packages/*`로 못박았다), 부팅 시 자동 마이그레이션(`pnpm db:migrate`가 별도 단계다 — 허브가 스키마를 바꾸면 A3의 오너십이 무너진다), 어댑터 등록(다른 계획), WS `/bridge` 구현(US-A17), CORS(루프백 전용), 인증(tailnet 경계가 인증이다 — A6 §3).

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/apps/hub/package.json`, `/Users/logankim/AI-Workspaces/omnis/apps/hub/tsconfig.json`, `/Users/logankim/AI-Workspaces/omnis/apps/hub/vitest.config.ts`, `/Users/logankim/AI-Workspaces/omnis/apps/hub/src/config.ts`, `/Users/logankim/AI-Workspaces/omnis/apps/hub/src/main.ts`
- Modify: `/Users/logankim/AI-Workspaces/omnis/tsconfig.json`
- Test: `/Users/logankim/AI-Workspaces/omnis/apps/hub/test/config.test.ts`

**Interfaces:**
- Consumes: `createPool` (`@omnis/db`) · `createKernel`, `createLogger`, `registerHealthcheckJob` (`@omnis/kernel`).
- Produces (`@omnis/hub`, 내부 전용): `interface HubConfig { port: number; host: "127.0.0.1"; version: string }` · `readConfig(env?: NodeJS.ProcessEnv): HubConfig` · `startHub(): Promise<{ close(): Promise<void> }>` (Task 24·25가 채운다).

### Steps

- [ ] 1. 패키지 골격을 만든다.

`/Users/logankim/AI-Workspaces/omnis/apps/hub/package.json`:
```json
{
  "name": "@omnis/hub",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/main.js",
  "scripts": {
    "build": "tsc --build",
    "dev": "tsx watch src/main.ts",
    "start": "node dist/main.js",
    "test": "vitest run",
    "test:integration": "vitest run test/integration"
  },
  "dependencies": {
    "@omnis/db": "workspace:*",
    "@omnis/kernel": "workspace:*",
    "@omnis/protocol": "workspace:*",
    "pg": "8.13.1"
  },
  "devDependencies": { "@types/pg": "8.11.10" }
}
```

`/Users/logankim/AI-Workspaces/omnis/apps/hub/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"],
  "references": [{ "path": "../../packages/db" }, { "path": "../../packages/kernel" }, { "path": "../../packages/protocol" }]
}
```

`/Users/logankim/AI-Workspaces/omnis/apps/hub/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import { omnisAlias } from "../../vitest.shared.js";

export default defineConfig({
  resolve: { alias: omnisAlias },
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["../../vitest.global-setup.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
```

루트 `tsconfig.json`:
```json
{
  "files": [],
  "references": [
    { "path": "./packages/protocol" },
    { "path": "./packages/db" },
    { "path": "./packages/kernel" },
    { "path": "./apps/hub" }
  ]
}
```

- [ ] 2. 실패하는 테스트를 쓴다. `/Users/logankim/AI-Workspaces/omnis/apps/hub/test/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readConfig } from "../src/config.js";

describe("readConfig", () => {
  it("binds the loopback address and port 8787 by default (마스터 §4.2)", () => {
    const c = readConfig({ DATABASE_URL: "postgres://x/y" });
    expect(c.host).toBe("127.0.0.1");
    expect(c.port).toBe(8787);
    expect(c.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("honours OMNIS_HUB_PORT", () => {
    expect(readConfig({ DATABASE_URL: "postgres://x/y", OMNIS_HUB_PORT: "9999" }).port).toBe(9999);
  });

  it("refuses 8642, which Hermes api_server owns", () => {
    expect(() => readConfig({ DATABASE_URL: "postgres://x/y", OMNIS_HUB_PORT: "8642" })).toThrow(
      /8642 belongs to Hermes/,
    );
  });

  it("refuses a non-numeric port and a missing DATABASE_URL", () => {
    expect(() => readConfig({ DATABASE_URL: "postgres://x/y", OMNIS_HUB_PORT: "abc" })).toThrow(/OMNIS_HUB_PORT/);
    expect(() => readConfig({})).toThrow(/DATABASE_URL/);
  });
});
```

- [ ] 3. 테스트를 돌려 실패를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm install && pnpm --filter @omnis/hub test
```
기대 실패: `Cannot find module '../src/config.js'`.

- [ ] 4. 설정을 쓴다. `/Users/logankim/AI-Workspaces/omnis/apps/hub/src/config.ts`:

```ts
export interface HubConfig {
  port: number;
  host: "127.0.0.1";
  version: string;
}

export const HUB_VERSION = "0.1.0";

/** 마스터 §4.2: 허브는 127.0.0.1:8787에만 bind한다. Tailscale Serve가 /api/로 노출한다. */
export function readConfig(env: NodeJS.ProcessEnv = process.env): HubConfig {
  if (env.DATABASE_URL === undefined || env.DATABASE_URL === "") {
    throw new Error("DATABASE_URL is required (계약 §9)");
  }
  const raw = env.OMNIS_HUB_PORT ?? "8787";
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`OMNIS_HUB_PORT must be an integer port, got ${raw}`);
  }
  if (port === 8642) {
    throw new Error("port 8642 belongs to Hermes api_server (마스터 §4.2) — pick another");
  }
  return { port, host: "127.0.0.1", version: HUB_VERSION };
}
```

- [ ] 5. 부트스트랩을 쓴다. HTTP 서버는 Task 24가 붙이므로 지금은 커널만 띄운다. `/Users/logankim/AI-Workspaces/omnis/apps/hub/src/main.ts`:

```ts
import { createPool } from "@omnis/db";
import { createKernel, createLogger, registerHealthcheckJob } from "@omnis/kernel";
import { type HubConfig, readConfig } from "./config.js";

export interface RunningHub {
  config: HubConfig;
  close(): Promise<void>;
}

export async function startHub(env: NodeJS.ProcessEnv = process.env): Promise<RunningHub> {
  const config = readConfig(env);
  const logger = createLogger("@omnis/hub");
  const pool = createPool(env);
  const kernel = createKernel({ pool, logger });

  registerHealthcheckJob(kernel.scheduler, { pool, events: kernel.events });
  await kernel.scheduler.start();
  await kernel.audit.record({ actor: "system", action: "hub.started", target_table: "jobs" });
  logger.info("hub started", { port: config.port, host: config.host, version: config.version });

  return {
    config,
    async close() {
      await kernel.close();
      await pool.end();
      logger.info("hub stopped");
    },
  };
}

// 직접 실행될 때만 부팅한다(테스트는 startHub를 import한다).
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  await startHub();
}
```

- [ ] 6. 테스트와 빌드를 돌린다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/hub test && pnpm --filter @omnis/hub build
```
기대: `Tests  4 passed (4)`, 빌드 에러 0.

- [ ] 7. 커밋하지 않는다 — Task 26까지가 US-A10 하나의 커밋이다.

---

## Task 24: hub-http-routes (US-A10, tier: Sonnet)

**스토리 US-A10** (계속) — 계약 §5의 허브 HTTP 표면 5개를 `node:http`로 연다.

| 메서드·경로 | body | 응답 |
|---|---|---|
| `GET /health` | — | `{ ok, version, db: "up"\|"down", uptimeSec, killSwitch }` |
| `GET /approvals?state=pending&limit=50` | — | `{ approvals: PendingApproval[] }` |
| `POST /approvals/:id/decide` | `HumanResponse` | `{ id, state: "decided" }` |
| `GET /kill-switch` | — | `{ on, since, reason }` |
| `POST /kill-switch` | `{ on, reason }` | `{ on, since }` |

**읽을 곳**: 계약 §5(위 표가 정본), 계약 §5 말미(`GET /search`·`GET /memory/search`·`GET /transcript/:session_id`는 다른 부록이 소유하므로 Phase A 범위 밖 — 열지 않는다), A6 §3(외부 경로는 `https://<mini>.ts.net/api/...`이고 마운트는 Tailscale이 한다 — 허브는 `/api` 접두를 모른다).

**만들지 않을 것(YAGNI)**: 라우터 라이브러리, OpenAPI 스펙, rate limit(루프백), 페이지네이션 커서(`limit`으로 충분), `/bridge` WS 구현(**Task 26**이 같은 `onUpgrade` 훅에 꽂는다 — 계약 §5가 서버 구현 오너를 이 계획으로 고정했다. agent-bridge 계획은 dial하는 클라이언트만 만든다).

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/apps/hub/src/http.ts`
- Modify: `/Users/logankim/AI-Workspaces/omnis/apps/hub/src/main.ts`
- Test: `/Users/logankim/AI-Workspaces/omnis/apps/hub/test/integration/routes.test.ts`

**Interfaces:**
- Consumes: `Kernel`, `killSwitchStatus`, `ApprovalStateError` (`@omnis/kernel`) · `HubConfig` (Task 23).
- Produces (`@omnis/hub`): `createHubServer(deps: { kernel: Kernel; pool: Pool; config: HubConfig; logger: Logger; startedAt: number; onUpgrade?: (req, socket, head) => void }): http.Server`.

### Steps

- [ ] 1. 실패하는 테스트를 쓴다. `/Users/logankim/AI-Workspaces/omnis/apps/hub/test/integration/routes.test.ts`:

```ts
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "@omnis/db";
import { type Kernel, createKernel, createLogger } from "@omnis/kernel";
import { createHubServer } from "../../src/http.js";
import { HUB_VERSION } from "../../src/config.js";

let base = "";
let kernel: Kernel;
let close: () => Promise<void>;

beforeAll(async () => {
  const pool = createPool();
  kernel = createKernel({ pool });
  const server = createHubServer({
    kernel,
    pool,
    config: { port: 0, host: "127.0.0.1", version: HUB_VERSION },
    logger: createLogger("@omnis/hub"),
    startedAt: Date.now(),
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address() as AddressInfo;
  base = `http://127.0.0.1:${addr.port}`;
  close = async () => {
    await new Promise<void>((r) => server.close(() => r()));
    await kernel.close();
    await pool.end();
  };
});
beforeEach(async () => {
  await kernel.killSwitch.set(false, "routes reset");
});
afterAll(async () => {
  await close();
});

const propose = (): Promise<string> =>
  kernel.approvals.propose({
    action: "send",
    args: { text: "hi" },
    description: "route test",
    config: { allow_accept: true, allow_edit: true, allow_respond: false, allow_ignore: true },
    risk: "normal",
  });

describe("GET /health", () => {
  it("reports version, db up, uptime and the kill switch", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.version).toBe(HUB_VERSION);
    expect(body.db).toBe("up");
    expect(typeof body.uptimeSec).toBe("number");
    expect(body.killSwitch).toBe(false);
  });
});

describe("GET /approvals", () => {
  it("returns pending approvals under the limit", async () => {
    await propose();
    const res = await fetch(`${base}/approvals?state=pending&limit=5`);
    const body = (await res.json()) as { approvals: Array<{ state: string }> };
    expect(body.approvals.length).toBeGreaterThanOrEqual(1);
    expect(body.approvals.length).toBeLessThanOrEqual(5);
    expect(body.approvals.every((a) => a.state === "pending")).toBe(true);
  });

  it("rejects an unknown state with 400", async () => {
    const res = await fetch(`${base}/approvals?state=banana`);
    expect(res.status).toBe(400);
  });
});

describe("POST /approvals/:id/decide", () => {
  it("decides a pending approval", async () => {
    const id = await propose();
    const res = await fetch(`${base}/approvals/${id}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "accept" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id, state: "decided" });
  });

  it("maps ApprovalStateError to 409 and a bad body to 400", async () => {
    const id = await propose();
    await fetch(`${base}/approvals/${id}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "accept" }),
    });
    const second = await fetch(`${base}/approvals/${id}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision: "ignore" }),
    });
    expect(second.status).toBe(409);

    const bad = await fetch(`${base}/approvals/${id}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(bad.status).toBe(400);
  });
});

describe("kill switch routes", () => {
  it("round-trips GET and POST", async () => {
    const on = await fetch(`${base}/kill-switch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ on: true, reason: "route test" }),
    });
    expect(on.status).toBe(200);
    const onBody = (await on.json()) as { on: boolean; since: string };
    expect(onBody.on).toBe(true);
    expect(onBody.since).toMatch(/^\d{4}-/);

    const get = await fetch(`${base}/kill-switch`);
    const body = (await get.json()) as { on: boolean; reason: string };
    expect(body.on).toBe(true);
    expect(body.reason).toBe("route test");

    const health = (await (await fetch(`${base}/health`)).json()) as { killSwitch: boolean };
    expect(health.killSwitch).toBe(true);
  });

  it("requires a boolean on and a reason", async () => {
    const res = await fetch(`${base}/kill-switch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ on: "yes" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("unknown routes", () => {
  it("404s the paths other appendices own and anything else", async () => {
    for (const p of ["/search", "/memory/search", "/transcript/abc", "/nope"]) {
      expect((await fetch(`${base}${p}`)).status).toBe(404);
    }
  });

  it("405s a wrong method on a known path", async () => {
    expect((await fetch(`${base}/health`, { method: "POST" })).status).toBe(405);
  });
});
```

- [ ] 2. 테스트를 돌려 실패를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/hub test:integration
```
기대 실패: `Cannot find module '../../src/http.js'`.

- [ ] 3. HTTP 표면을 쓴다. `/Users/logankim/AI-Workspaces/omnis/apps/hub/src/http.ts`:

```ts
import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import type { Duplex } from "node:stream";
import { query } from "@omnis/db";
import { ApprovalStateError, type Kernel, type Logger, killSwitchStatus } from "@omnis/kernel";
import type { Pool } from "pg";
import type { HubConfig } from "./config.js";

const APPROVAL_STATES = ["pending", "decided", "executing", "executed", "failed", "expired"] as const;
const MAX_BODY_BYTES = 64 * 1024;

export interface HubServerDeps {
  kernel: Kernel;
  pool: Pool;
  config: HubConfig;
  logger: Logger;
  startedAt: number;
  /** Task 26(hub-bridge-ws)이 WS /bridge를 여기에 꽂는다. 주입 안 되면 업그레이드는 501이다. */
  onUpgrade?: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new SyntaxError("body too large");
    chunks.push(buf);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createHubServer(deps: HubServerDeps): Server {
  const { kernel, pool, config, logger, startedAt } = deps;

  const server = createServer((req, res) => {
    void handle(req, res).catch((e: unknown) => {
      logger.error("route threw", { url: req.url, err: e instanceof Error ? e.message : String(e) });
      if (!res.headersSent) send(res, 500, { error: "internal" });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${config.host}:${config.port}`);
    const path = url.pathname;
    const method = req.method ?? "GET";

    if (path === "/health") {
      if (method !== "GET") return send(res, 405, { error: "method not allowed" });
      let db: "up" | "down" = "up";
      try {
        await query(pool, "SELECT 1");
      } catch {
        db = "down";
      }
      return send(res, 200, {
        ok: db === "up",
        version: config.version,
        db,
        uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
        killSwitch: await kernel.killSwitch.isOn(),
      });
    }

    if (path === "/approvals") {
      if (method !== "GET") return send(res, 405, { error: "method not allowed" });
      const stateParam = url.searchParams.get("state");
      if (stateParam !== null && !APPROVAL_STATES.includes(stateParam as (typeof APPROVAL_STATES)[number])) {
        return send(res, 400, { error: `unknown state: ${stateParam}` });
      }
      const limitParam = url.searchParams.get("limit");
      const limit = limitParam === null ? 50 : Number(limitParam);
      if (!Number.isInteger(limit) || limit < 1) return send(res, 400, { error: "bad limit" });
      const approvals = await kernel.approvals.list({
        ...(stateParam !== null ? { state: stateParam as (typeof APPROVAL_STATES)[number] } : {}),
        limit,
      });
      return send(res, 200, { approvals });
    }

    const decide = /^\/approvals\/([0-9a-fA-F-]{36})\/decide$/.exec(path);
    if (decide !== null) {
      if (method !== "POST") return send(res, 405, { error: "method not allowed" });
      const id = decide[1];
      if (id === undefined) return send(res, 400, { error: "bad id" });
      let body: unknown;
      try {
        body = await readJson(req);
      } catch {
        return send(res, 400, { error: "invalid json body" });
      }
      try {
        await kernel.approvals.decide(id, body);
      } catch (e) {
        if (e instanceof ApprovalStateError) return send(res, 409, { error: e.message });
        return send(res, 400, { error: e instanceof Error ? e.message : "bad request" });
      }
      return send(res, 200, { id, state: "decided" });
    }

    if (path === "/kill-switch") {
      if (method === "GET") return send(res, 200, await killSwitchStatus(pool));
      if (method === "POST") {
        let body: unknown;
        try {
          body = await readJson(req);
        } catch {
          return send(res, 400, { error: "invalid json body" });
        }
        const b = body as { on?: unknown; reason?: unknown };
        if (typeof b.on !== "boolean" || typeof b.reason !== "string" || b.reason.length === 0) {
          return send(res, 400, { error: "expected { on: boolean, reason: string }" });
        }
        await kernel.killSwitch.set(b.on, b.reason);
        const status = await killSwitchStatus(pool);
        return send(res, 200, { on: status.on, since: status.since });
      }
      return send(res, 405, { error: "method not allowed" });
    }

    // /search, /memory/search, /transcript/:id는 다른 부록이 소유한다(계약 §5) — Phase A는 열지 않는다.
    return send(res, 404, { error: "not found" });
  }

  server.on("upgrade", (req, socket, head) => {
    if (deps.onUpgrade !== undefined) {
      deps.onUpgrade(req, socket, head as Buffer);
      return;
    }
    // WS /bridge는 Task 26이 붙인다.
    socket.write("HTTP/1.1 501 Not Implemented\r\n\r\n");
    socket.destroy();
  });

  return server;
}
```

- [ ] 4. `main.ts`가 서버를 띄우도록 고친다. `startHub`의 `registerHealthcheckJob` 다음에 아래를 넣고 `RunningHub`에 `port`를 더한다:

```ts
  const startedAt = Date.now();
  const server = createHubServer({ kernel, pool, config, logger, startedAt });
  await new Promise<void>((resolve) => server.listen(config.port, config.host, resolve));
```
그리고 `close()`의 첫 줄에 `await new Promise<void>((r) => server.close(() => r()));`를 넣는다(Task 25가 이 자리를 더 다듬는다). 파일 맨 위에 `import { createHubServer } from "./http.js";`를 더한다.

- [ ] 5. 테스트를 돌려 통과를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/hub test:integration
```
기대: `Tests  9 passed (9)`.

- [ ] 6. 커밋하지 않는다 — Task 26이 US-A10을 닫는다.

---

## Task 25: graceful-shutdown (US-A10, tier: Sonnet)

**스토리 US-A10** (마무리) — SIGTERM/SIGINT에서 새 요청을 받지 않고, 스케줄러의 진행 중 잡을 끝내고, LISTEN 커넥션과 풀을 닫고, 그래도 안 끝나면 강제 종료한다. LaunchDaemon이 허브를 재시작할 때 `claimed_at`이 남은 잡이 없어야 한다(A3 §9 규칙 4의 5분 스윕에 의존하지 않도록).

**읽을 곳**: A6 §1(LaunchDaemon이 SIGTERM을 보낸다), 계약 §5(`Kernel.close()`), Task 14의 `Scheduler.stop()`(진행 중 틱을 기다린다), A3 §9 규칙 4(`approved`로 5분 이상 claim이 남으면 크래시로 간주).

**만들지 않을 것(YAGNI)**: drain 중 503 응답(루프백 클라이언트는 재시도한다), 헬스 엔드포인트의 draining 상태, 재시작 시 오래된 claim 회수(`followup_sweep` 잡, Phase B), systemd 스타일 readiness 파일.

**Files:**
- Modify: `/Users/logankim/AI-Workspaces/omnis/apps/hub/src/main.ts`
- Test: `/Users/logankim/AI-Workspaces/omnis/apps/hub/test/integration/shutdown.test.ts`

**Interfaces:**
- Consumes: Task 23의 `startHub`, Task 24의 `createHubServer`.
- Produces (`@omnis/hub`): `RunningHub { config: HubConfig; port: number; close(): Promise<void> }` · `installSignalHandlers(hub: RunningHub, logger: Logger, forceExitMs?: number): () => void`.

### Steps

- [ ] 1. 실패하는 테스트를 쓴다. 실제 프로세스를 띄우고 SIGTERM을 보낸다 — 시그널 처리는 in-process로는 증명되지 않는다. `/Users/logankim/AI-Workspaces/omnis/apps/hub/test/integration/shutdown.test.ts`:

```ts
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { createPool, one } from "@omnis/db";

const MAIN = fileURLToPath(new URL("../../src/main.ts", import.meta.url));
const PORT = "8799";

function startProcess(): ReturnType<typeof spawn> {
  return spawn("pnpm", ["exec", "tsx", MAIN], {
    env: { ...process.env, OMNIS_HUB_PORT: PORT },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitForHealth(ms = 15_000): Promise<void> {
  const started = Date.now();
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() - started > ms) throw new Error("hub never became healthy");
    await new Promise((r) => setTimeout(r, 250));
  }
}

const pool = createPool();
afterAll(async () => {
  await pool.end();
});

describe("graceful shutdown", () => {
  it("serves /health, then exits 0 on SIGTERM within 10s", async () => {
    const child = startProcess();
    const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
    await waitForHealth();

    const body = (await (await fetch(`http://127.0.0.1:${PORT}/health`)).json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    const t0 = Date.now();
    child.kill("SIGTERM");
    const code = await exited;
    expect(code).toBe(0);
    expect(Date.now() - t0).toBeLessThan(10_000);

    await expect(fetch(`http://127.0.0.1:${PORT}/health`)).rejects.toThrow();
  });

  it("leaves no claimed job behind and audits the stop", async () => {
    const stuck = await one<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM jobs WHERE claimed_at IS NOT NULL`,
    );
    expect(stuck.n).toBe("0");

    const audited = await one<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM audit_log WHERE action = 'hub.stopped'`,
    );
    expect(Number(audited.n)).toBeGreaterThanOrEqual(1);
  });

  it("exits 0 on SIGINT too", async () => {
    const child = startProcess();
    const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
    await waitForHealth();
    child.kill("SIGINT");
    expect(await exited).toBe(0);
  });
});
```

- [ ] 2. 테스트를 돌려 실패를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/hub test:integration
```
기대 실패: SIGTERM 후 프로세스가 죽지 않아 `hub never became healthy` 또는 exit code가 `143`(핸들러 없음).

- [ ] 3. `main.ts`를 완성한다. `/Users/logankim/AI-Workspaces/omnis/apps/hub/src/main.ts` 전문:

```ts
import { createPool } from "@omnis/db";
import { type Logger, createKernel, createLogger, registerHealthcheckJob } from "@omnis/kernel";
import { type HubConfig, readConfig } from "./config.js";
import { createHubServer } from "./http.js";

export interface RunningHub {
  config: HubConfig;
  port: number;
  close(): Promise<void>;
}

export async function startHub(env: NodeJS.ProcessEnv = process.env): Promise<RunningHub> {
  const config = readConfig(env);
  const logger = createLogger("@omnis/hub");
  const pool = createPool(env);
  const kernel = createKernel({ pool, logger });
  const startedAt = Date.now();

  registerHealthcheckJob(kernel.scheduler, { pool, events: kernel.events });
  await kernel.scheduler.start();

  const server = createHubServer({ kernel, pool, config, logger, startedAt });
  await new Promise<void>((resolve) => server.listen(config.port, config.host, resolve));

  await kernel.audit.record({ actor: "system", action: "hub.started", target_table: "jobs" });
  logger.info("hub listening", { host: config.host, port: config.port, version: config.version });

  let closing: Promise<void> | null = null;
  return {
    config,
    port: config.port,
    close() {
      if (closing !== null) return closing;
      closing = (async () => {
        // 1) 새 연결을 받지 않는다. keep-alive는 즉시 끊는다.
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeIdleConnections();
          setTimeout(() => server.closeAllConnections(), 2000).unref();
        });
        // 2) 스케줄러를 멈추고 진행 중 틱이 claimed_at을 풀고 끝나기를 기다린다(Task 14의 stop()).
        // 3) LISTEN 커넥션을 버린다.
        await kernel.close();
        await kernel.audit.record({ actor: "system", action: "hub.stopped", target_table: "jobs" });
        await pool.end();
        logger.info("hub stopped");
      })();
      return closing;
    },
  };
}

/** SIGTERM/SIGINT → close(). 10초 안에 안 끝나면 강제 종료한다(LaunchDaemon이 재시작한다). */
export function installSignalHandlers(hub: RunningHub, logger: Logger, forceExitMs = 10_000): () => void {
  let shuttingDown = false;
  const onSignal = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("shutdown requested", { signal });
    const force = setTimeout(() => {
      logger.error("shutdown timed out — forcing exit", { forceExitMs });
      process.exit(1);
    }, forceExitMs);
    force.unref();
    hub
      .close()
      .then(() => {
        clearTimeout(force);
        process.exit(0);
      })
      .catch((e: unknown) => {
        logger.error("shutdown failed", { err: e instanceof Error ? e.message : String(e) });
        process.exit(1);
      });
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
  return () => {
    process.off("SIGTERM", onSignal);
    process.off("SIGINT", onSignal);
  };
}

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  const hub = await startHub();
  installSignalHandlers(hub, createLogger("@omnis/hub"));
}
```

> `audit.record({action:'hub.stopped'})`가 `pool.end()` **앞**에 있어야 한다 — 순서를 바꾸면 기록이 사라진다. 테스트가 이 순서를 고정한다.

- [ ] 4. 테스트를 돌려 통과를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/hub test:integration
```
기대: `Tests  12 passed (12)`.

- [ ] 5. US-A10 검증 명령과 전체 회귀를 돌린다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/hub build && pnpm typecheck && pnpm lint && pnpm test && pnpm test:integration
```
기대: 빌드·타입체크·린트 에러 0, `pnpm test`와 `pnpm test:integration` 전부 통과.

- [ ] 6. 커밋하지 않는다 — US-A10은 Task 26(`hub-bridge-ws`)까지가 하나의 원자 커밋이다(A7-D8: 스토리당 원자 커밋 1개). 계약 §10이 US-A10의 태스크를 `hub-bootstrap` · `hub-http-routes` · `graceful-shutdown` · `hub-bridge-ws` 넷으로 적었다.

---

## Task 26: hub-bridge-ws (US-A10, tier: Opus)

**스토리 US-A10** (마무리 2) — 계약 §5의 마지막 행 `WS /bridge`를 연다. **서버 구현 오너는 이 계획이다**(계약 §5·§10, 교차 검증 M6). `2026-09-20-phase-a-agent-bridge.md`는 여기에 dial하는 **클라이언트**만 만든다 — 그 계획에 `apps/hub`를 건드리는 스텝은 없다. Task 24가 남겨 둔 `onUpgrade` 훅에 꽂는다.

**읽을 곳**: 계약 §3.5(브리지 프로토콜 전문 — `HUB_METHODS`/`BRIDGE_METHODS`/`BRIDGE_ERRORS`/`JSONRPC_ERRORS`/`withMeta`/`assertProtocolVersion`/`toJsonRpcError`), 계약 §5(`WS /bridge` 행 + `Approvals`), 계약 §8(`session.create`/`turn.start`/`approval.requested`의 파라미터 shape, `ingest.*`는 Phase B), A2 §3(JSON-RPC 방향·에러), A3 §4(`agent_runtimes`/`agent_sessions` 컬럼), 계약 §9(브리지 토큰 `omnis.bridge.token.<host>`).

**만들지 않을 것(YAGNI)**: 런타임 자식 프로세스 spawn(US-A18/A19가 브리지 쪽에서 한다), `turn.item.*`를 `items` row로 쓰는 write path(US-A18/A19), `ingest.scan`/`ingest.read`(Phase B — 호출하면 `CAPABILITY_UNSUPPORTED`로 즉시 거절), 재연결 백오프(클라이언트 몫, 계약 §8), outbox 재생(클라이언트 몫), 멀티플렉싱/압축, mTLS(Tailscale이 전송 신뢰를 준다 — 토큰은 그 위의 2차 관문).

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/apps/hub/src/bridge.ts`
- Modify: `/Users/logankim/AI-Workspaces/omnis/apps/hub/package.json`, `/Users/logankim/AI-Workspaces/omnis/apps/hub/src/config.ts`, `/Users/logankim/AI-Workspaces/omnis/apps/hub/src/main.ts`
- Test: `/Users/logankim/AI-Workspaces/omnis/apps/hub/test/integration/bridge.test.ts`

**Interfaces:**
- Consumes: `Kernel`(`approvals`·`events`), `Logger` (`@omnis/kernel`) · `query` (`@omnis/db`) · `HUB_METHODS`, `BRIDGE_ERRORS`, `JSONRPC_ERRORS`, `BridgeError`, `BridgeErrorCode`, `HostId`, `RuntimeKind`, `HumanInterrupt`, `HumanResponse`, `PROTOCOL_VERSION`, `assertProtocolVersion`, `toJsonRpcError`, `withMeta` (`@omnis/protocol`, 계약 §3.4·§3.5).
- Produces (`@omnis/hub`): `createBridgeHub(deps: BridgeDeps): BridgeHub` · `interface BridgeHub { handleUpgrade(req, socket, head): void; call<T>(host: HostId, method: HubMethod, params: Record<string, unknown>): Promise<T>; hosts(): HostId[]; close(): Promise<void> }` · `interface BridgeDeps { kernel: Kernel; pool: Pool; logger: Logger; token: string; heartbeatMs?: number; callTimeoutMs?: number }`.

**새 환경변수**: `OMNIS_BRIDGE_TOKEN` — Keychain `omnis.bridge.token.<host>`의 값을 A6 래퍼가 주입한다(`DATABASE_URL`과 같은 경로). 허브는 Keychain을 직접 읽지 않는다. 빈 값이면 `/bridge` 업그레이드를 전부 503으로 닫는다 — 토큰 없이 열린 브리지는 존재하지 않는다.

### Steps

- [ ] 1. `ws`를 `apps/hub` 의존성에 더한다. `/Users/logankim/AI-Workspaces/omnis/apps/hub/package.json`의 `dependencies`/`devDependencies`를 아래로 교체한다.

```json
  "dependencies": {
    "@omnis/db": "workspace:*",
    "@omnis/kernel": "workspace:*",
    "@omnis/protocol": "workspace:*",
    "pg": "8.13.1",
    "ws": "8.18.0"
  },
  "devDependencies": { "@types/pg": "8.11.10", "@types/ws": "8.5.13" }
```

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm install
```
기대: `+ ws 8.18.0` 을 포함한 설치 요약, 에러 0.

- [ ] 2. 실패하는 통합 테스트를 쓴다. 실제 `ws` 클라이언트를 띄워 register → discover 왕복과 승인 왕복을 증명한다. `/Users/logankim/AI-Workspaces/omnis/apps/hub/test/integration/bridge.test.ts`:

```ts
import type { AddressInfo } from "node:net";
import { createPool, query } from "@omnis/db";
import { type Kernel, createKernel, createLogger } from "@omnis/kernel";
import { PROTOCOL_VERSION } from "@omnis/protocol";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { type BridgeHub, createBridgeHub } from "../../src/bridge.js";
import { createHubServer } from "../../src/http.js";
import { readConfig } from "../../src/config.js";

const TOKEN = "test-bridge-token";

let pool: Pool;
let kernel: Kernel;
let bridge: BridgeHub;
let server: ReturnType<typeof createHubServer>;
let base: string;

beforeAll(async () => {
  pool = createPool();
  kernel = createKernel({ pool, logger: createLogger("@omnis/hub") });
  bridge = createBridgeHub({ kernel, pool, logger: createLogger("@omnis/hub"), token: TOKEN, heartbeatMs: 250 });
  server = createHubServer({
    kernel,
    pool,
    // 포트는 아래 listen(0)이 정한다. readConfig는 1~65535만 받으므로 유효값을 준다.
    config: readConfig({ DATABASE_URL: "postgres://x/y", OMNIS_HUB_PORT: "8788" }),
    logger: createLogger("@omnis/hub"),
    startedAt: Date.now(),
    onUpgrade: (req, socket, head) => bridge.handleUpgrade(req, socket, head),
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/bridge`;
  await query(pool, "DELETE FROM agent_runtimes WHERE runtime = 'claude_code' AND host = 'macbook'");
});

afterAll(async () => {
  await bridge.close();
  await new Promise<void>((r) => server.close(() => r()));
  await kernel.close();
  await pool.end();
});

/** 테스트용 미니 브리지 클라이언트: 알림을 보내고, 허브의 요청에는 handlers로 답한다. */
function connect(handlers: Record<string, (params: Record<string, unknown>) => unknown>): Promise<{
  ws: WebSocket;
  notify(method: string, params: Record<string, unknown>): void;
  closed: Promise<void>;
}> {
  const ws = new WebSocket(base, {
    headers: { authorization: `Bearer ${TOKEN}`, "x-omnis-host": "macbook" },
  });
  ws.on("message", (raw) => {
    const msg = JSON.parse(String(raw)) as { id?: string; method?: string; params?: Record<string, unknown> };
    if (msg.method === undefined || msg.id === undefined) return;
    const handler = handlers[msg.method];
    if (handler === undefined) {
      ws.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "no handler" } }));
      return;
    }
    ws.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: handler(msg.params ?? {}) }));
  });
  const closed = new Promise<void>((r) => ws.on("close", () => r()));
  return new Promise((resolve, reject) => {
    ws.on("error", reject);
    ws.on("open", () =>
      resolve({
        ws,
        notify(method, params) {
          ws.send(
            JSON.stringify({
              jsonrpc: "2.0",
              method,
              params: { ...params, _meta: { "ai.omnis/protocolVersion": PROTOCOL_VERSION } },
            }),
          );
        },
        closed,
      }),
    );
  });
}

async function until<T>(fn: () => Promise<T | null>, ms = 5000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const v = await fn();
    if (v !== null) return v;
    if (Date.now() - started > ms) throw new Error("condition never became true");
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("WS /bridge auth", () => {
  it("rejects an upgrade without the bridge token", async () => {
    const ws = new WebSocket(base, { headers: { "x-omnis-host": "macbook" } });
    const err = await new Promise<Error>((r) => ws.on("error", r));
    expect(err.message).toMatch(/401/);
  });

  it("rejects an upgrade without a valid x-omnis-host", async () => {
    const ws = new WebSocket(base, { headers: { authorization: `Bearer ${TOKEN}`, "x-omnis-host": "laptop" } });
    const err = await new Promise<Error>((r) => ws.on("error", r));
    expect(err.message).toMatch(/400/);
  });
});

describe("register + discover round trip", () => {
  it("writes agent_runtimes on runtime.registered and answers bridge/discover", async () => {
    const client = await connect({
      "bridge/discover": () => ({
        runtimes: [{ runtime: "claude_code", host: "macbook", version: "2.1.274", state: "online" }],
      }),
    });

    client.notify("runtime.registered", {
      runtime: "claude_code",
      host: "macbook",
      version: "2.1.274",
      capabilities: { resume: true, tool_calls: true, approvals: "hook", cancel: true },
    });

    const row = await until(async () => {
      const rows = await query<{ state: string; version: string; capabilities: Record<string, unknown> }>(
        pool,
        "SELECT state, version, capabilities FROM agent_runtimes WHERE runtime = 'claude_code' AND host = 'macbook'",
      );
      return rows[0] ?? null;
    });
    expect(row.state).toBe("online");
    expect(row.version).toBe("2.1.274");
    expect(row.capabilities.approvals).toBe("hook");

    expect(bridge.hosts()).toEqual(["macbook"]);

    const discovered = await bridge.call<{ runtimes: { runtime: string }[] }>("macbook", "bridge/discover", {});
    expect(discovered.runtimes.map((r) => r.runtime)).toEqual(["claude_code"]);

    client.ws.close();
    await client.closed;
  });

  it("refuses call() for a host that is not connected", async () => {
    await expect(bridge.call("mini", "session.create", {})).rejects.toThrow(/no bridge connected/);
  });

  it("refuses ingest.* as Phase B", async () => {
    await expect(bridge.call("macbook", "ingest.scan", {})).rejects.toThrow(/Phase B/);
  });
});

describe("approval.requested", () => {
  it("routes into pending_approvals and answers with the human decision", async () => {
    const client = await connect({});
    client.notify("runtime.registered", { runtime: "codex", host: "macbook", version: "0.155.1", capabilities: {} });

    const reply = new Promise<{ result?: { decision: string }; error?: unknown }>((resolve) => {
      client.ws.on("message", (raw) => {
        const msg = JSON.parse(String(raw)) as { id?: string; result?: { decision: string } };
        if (msg.id === "ap-1" && msg.result !== undefined) resolve(msg);
      });
    });

    client.ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "ap-1",
        method: "approval.requested",
        params: {
          session_key: "agent:codex:macbook:inbox",
          turn_id: "t-1",
          interrupt: {
            action: "send",
            args: { text: "보냅니다" },
            description: "슬랙 답장 1건",
            config: { allow_accept: true, allow_edit: true, allow_respond: false, allow_ignore: true },
          },
          _meta: { "ai.omnis/protocolVersion": PROTOCOL_VERSION },
        },
      }),
    );

    const id = await until(async () => {
      const rows = await kernel.approvals.list({ state: "pending", limit: 50 });
      return rows.find((a) => a.description === "슬랙 답장 1건")?.id ?? null;
    });
    await kernel.approvals.decide(id, { decision: "accept" });

    const msg = await reply;
    expect(msg.result?.decision).toBe("accept");

    client.ws.close();
    await client.closed;
  });

  it("rejects a request whose _meta carries an unsupported protocol version", async () => {
    const client = await connect({});
    const reply = new Promise<{ error: { code: number } }>((resolve) => {
      client.ws.on("message", (raw) => {
        const msg = JSON.parse(String(raw)) as { id?: string; error?: { code: number } };
        if (msg.id === "bad-1" && msg.error !== undefined) resolve({ error: msg.error });
      });
    });
    client.ws.send(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "bad-1",
        method: "approval.requested",
        params: { interrupt: {}, _meta: { "ai.omnis/protocolVersion": "1999-01-01" } },
      }),
    );
    expect((await reply).error.code).toBe(-32010);

    client.ws.close();
    await client.closed;
  });
});

describe("heartbeat", () => {
  it("marks the runtime offline when the socket goes away", async () => {
    const client = await connect({});
    client.notify("runtime.registered", { runtime: "claude_ds", host: "macbook", version: "1.0.0", capabilities: {} });
    await until(async () => {
      const rows = await query<{ state: string }>(
        pool,
        "SELECT state FROM agent_runtimes WHERE runtime = 'claude_ds' AND host = 'macbook'",
      );
      return rows[0]?.state === "online" ? true : null;
    });

    client.ws.terminate();
    await until(async () => {
      const rows = await query<{ state: string }>(
        pool,
        "SELECT state FROM agent_runtimes WHERE runtime = 'claude_ds' AND host = 'macbook'",
      );
      return rows[0]?.state === "offline" ? true : null;
    });
    expect(bridge.hosts()).toEqual([]);
  });
});
```

- [ ] 3. 테스트를 돌려 실패를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/hub test:integration
```
기대 실패: `Cannot find module '../../src/bridge.js'`.

- [ ] 4. 브리지 서버를 쓴다. `/Users/logankim/AI-Workspaces/omnis/apps/hub/src/bridge.ts`:

```ts
import { randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { query } from "@omnis/db";
import type { Kernel, Logger } from "@omnis/kernel";
import {
  BRIDGE_ERRORS,
  BridgeError,
  type BridgeErrorCode,
  HUB_METHODS,
  HostId,
  type HubMethod,
  HumanInterrupt,
  type HumanResponse,
  JSONRPC_ERRORS,
  PROTOCOL_VERSION,
  RuntimeKind,
  assertProtocolVersion,
  toJsonRpcError,
  withMeta,
} from "@omnis/protocol";
import type { Pool } from "pg";
import { type WebSocket, WebSocketServer } from "ws";

const BRIDGE_PATH = "/bridge";

/** 계약 §3.5 SessionState → A3 §4 agent_sessions.state. 두 enum의 이름이 다르다. */
const SESSION_STATE: Readonly<Record<string, string>> = {
  idle: "idle",
  running: "running",
  awaiting_approval: "waiting_approval",
  failed: "failed",
  closed: "ended",
};

const TURN_NOTIFICATIONS = new Set([
  "turn.started",
  "turn.item.started",
  "turn.item.delta",
  "turn.item.completed",
  "turn.completed",
]);

export interface BridgeDeps {
  kernel: Kernel;
  pool: Pool;
  logger: Logger;
  /** Keychain omnis.bridge.token.<host>의 값(A6 래퍼가 OMNIS_BRIDGE_TOKEN으로 주입). 빈 문자열이면 브리지를 닫는다. */
  token: string;
  heartbeatMs?: number;
  callTimeoutMs?: number;
}

export interface BridgeHub {
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
  call<T>(host: HostId, method: HubMethod, params: Record<string, unknown>): Promise<T>;
  hosts(): HostId[];
  close(): Promise<void>;
}

interface Conn {
  ws: WebSocket;
  host: HostId;
  alive: boolean;
}

interface Waiting {
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  timer: NodeJS.Timeout;
}

interface Waiter {
  stop: () => void;
  reject: (e: unknown) => void;
}

function refuse(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nconnection: close\r\ncontent-length: 0\r\n\r\n`);
  socket.destroy();
}

function constantEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function createBridgeHub(deps: BridgeDeps): BridgeHub {
  const { kernel, pool, logger, token } = deps;
  const heartbeatMs = deps.heartbeatMs ?? 30_000;
  const callTimeoutMs = deps.callTimeoutMs ?? 60_000;

  const wss = new WebSocketServer({ noServer: true });
  const conns = new Map<HostId, Conn>();
  const pending = new Map<string, Waiting>();
  const waiters = new Set<Waiter>();
  let closed = false;

  function send(ws: WebSocket, msg: Record<string, unknown>): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  async function markOffline(host: HostId): Promise<void> {
    await query(pool, "UPDATE agent_runtimes SET state = 'offline' WHERE host = $1", [host]);
  }

  // ---- bridge → hub 알림 ----

  async function onRegister(host: HostId, params: Record<string, unknown>): Promise<void> {
    const runtime = RuntimeKind.parse(params.runtime);
    const version = typeof params.version === "string" ? params.version : null;
    const display = typeof params.display === "string" ? params.display : `${runtime}@${host}`;
    const capabilities = (params.capabilities ?? {}) as Record<string, unknown>;
    await query(
      pool,
      `INSERT INTO agent_runtimes (runtime, host, display, capabilities, version, state, last_seen_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, 'online', now())
       ON CONFLICT (runtime, host) DO UPDATE
         SET display = EXCLUDED.display, capabilities = EXCLUDED.capabilities,
             version = EXCLUDED.version, state = 'online', last_seen_at = now()`,
      [runtime, host, display, JSON.stringify(capabilities), version],
    );
    logger.info("runtime registered", { runtime, host, version });
  }

  async function onHealth(host: HostId, params: Record<string, unknown>): Promise<void> {
    const runtime = RuntimeKind.parse(params.runtime);
    const raw = params.state;
    const state = raw === "degraded" || raw === "offline" ? raw : "online";
    await query(
      pool,
      "UPDATE agent_runtimes SET state = $1, last_seen_at = now() WHERE runtime = $2 AND host = $3",
      [state, runtime, host],
    );
  }

  async function onSessionRegistered(host: HostId, params: Record<string, unknown>): Promise<void> {
    const runtime = RuntimeKind.parse(params.runtime);
    const sessionKey = String(params.session_key);
    const sessionId = typeof params.session_id === "string" ? params.session_id : null;
    const mapped = typeof params.state === "string" ? SESSION_STATE[params.state] : undefined;
    const rows = await query<{ id: string }>(
      pool,
      `UPDATE agent_sessions s
          SET session_id = $1,
              state = COALESCE($2, s.state),
              last_turn_at = now()
         FROM agent_runtimes r
        WHERE s.runtime_id = r.id AND r.runtime = $3 AND r.host = $4 AND s.session_key = $5
      RETURNING s.id`,
      [sessionId, mapped ?? null, runtime, host, sessionKey],
    );
    if (rows.length === 0) {
      // 허브가 session.create로 먼저 row를 만든다(Phase B). 지금은 모르는 세션을 조용히 흘린다.
      logger.warn("session.registered for an unknown session_key", { runtime, host, sessionKey });
    }
    // NOTIFY는 0007의 sessions_notify 트리거가 쏜다 — 여기서 emit하면 두 번 나간다.
  }

  // ---- approval.requested ----

  async function readDecision(id: string): Promise<HumanResponse | null> {
    const rows = await query<{ decision: string | null; decided_args: Record<string, unknown> | null }>(
      pool,
      "SELECT decision, decided_args FROM pending_approvals WHERE id = $1 AND state <> 'pending'",
      [id],
    );
    const row = rows[0];
    if (row === undefined || row.decision === null) return null;
    const decision = row.decision as HumanResponse["decision"];
    return row.decided_args === null ? { decision } : { decision, decided_args: row.decided_args };
  }

  function waitForDecision(id: string): Promise<HumanResponse> {
    return new Promise<HumanResponse>((resolve, reject) => {
      let done = false;
      const waiter: Waiter = { stop: () => undefined, reject };
      const settle = (r: HumanResponse): void => {
        if (done) return;
        done = true;
        waiter.stop();
        waiters.delete(waiter);
        resolve(r);
      };
      waiter.stop = kernel.events.subscribe("omnis_approval", (p) => {
        if (p.id !== id) return;
        void readDecision(id).then((r) => {
          if (r !== null) settle(r);
        }, reject);
      });
      waiters.add(waiter);
      // propose와 subscribe 사이에 결정이 났을 수 있다 — 한 번 직접 읽는다.
      void readDecision(id).then((r) => {
        if (r !== null) settle(r);
      }, reject);
    });
  }

  async function onApprovalRequested(params: Record<string, unknown>): Promise<HumanResponse> {
    const interrupt = HumanInterrupt.parse(params.interrupt);
    const id = await kernel.approvals.propose(interrupt);
    logger.info("approval requested by bridge", { id, action: interrupt.action });
    return await waitForDecision(id);
  }

  // ---- 디스패치 ----

  async function dispatch(conn: Conn, method: string, params: Record<string, unknown>): Promise<unknown> {
    if (method === "runtime.registered") {
      await onRegister(conn.host, params);
      return null;
    }
    if (method === "session.registered") {
      await onSessionRegistered(conn.host, params);
      return null;
    }
    if (method === "health") {
      await onHealth(conn.host, params);
      return null;
    }
    if (TURN_NOTIFICATIONS.has(method)) {
      // ephemeral 팬아웃만(A3-D14). items row 쓰기는 US-A18/A19가 브리지 클라이언트 쪽에서 한다.
      await kernel.events.emit("ephemeral", method, { ...params, host: conn.host });
      return null;
    }
    if (method === "approval.requested") {
      return await onApprovalRequested(params);
    }
    throw new BridgeError(JSONRPC_ERRORS.METHOD_NOT_FOUND, `unknown bridge method: ${method}`);
  }

  function onMessage(conn: Conn, raw: string): void {
    let msg: {
      id?: string | number | null;
      method?: string;
      params?: unknown;
      result?: unknown;
      error?: { code: number; message: string };
    };
    try {
      msg = JSON.parse(raw) as typeof msg;
    } catch {
      send(conn.ws, { jsonrpc: "2.0", id: null, error: { code: JSONRPC_ERRORS.PARSE, message: "parse error" } });
      return;
    }

    // hub → bridge 요청에 대한 응답
    if (msg.method === undefined) {
      if (msg.id === undefined || msg.id === null) return;
      const waiting = pending.get(String(msg.id));
      if (waiting === undefined) return;
      pending.delete(String(msg.id));
      clearTimeout(waiting.timer);
      if (msg.error !== undefined) {
        waiting.reject(new BridgeError(msg.error.code as BridgeErrorCode, msg.error.message));
      } else {
        waiting.resolve(msg.result);
      }
      return;
    }

    const method = msg.method;
    const id = msg.id;
    const isRequest = id !== undefined && id !== null;
    const params = (msg.params ?? {}) as Record<string, unknown>;

    void (async () => {
      try {
        assertProtocolVersion(params);
        const result = await dispatch(conn, method, params);
        if (isRequest) send(conn.ws, { jsonrpc: "2.0", id, result });
      } catch (e) {
        logger.warn("bridge method failed", {
          method,
          host: conn.host,
          err: e instanceof Error ? e.message : String(e),
        });
        if (isRequest) send(conn.ws, { jsonrpc: "2.0", id, error: toJsonRpcError(e) });
      }
    })();
  }

  // ---- 업그레이드 ----

  function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const path = (req.url ?? "/").split("?")[0];
    if (path !== BRIDGE_PATH) return refuse(socket, 404, "Not Found");
    if (closed) return refuse(socket, 503, "Shutting Down");
    if (token === "") return refuse(socket, 503, "Bridge Token Not Configured");

    const auth = req.headers.authorization ?? "";
    if (!auth.startsWith("Bearer ") || !constantEquals(auth.slice(7), token)) {
      return refuse(socket, 401, "Unauthorized");
    }
    const parsed = HostId.safeParse(req.headers["x-omnis-host"]);
    if (!parsed.success) return refuse(socket, 400, "Bad Request");
    const host = parsed.data;

    wss.handleUpgrade(req, socket, head, (ws) => {
      const previous = conns.get(host);
      if (previous !== undefined) previous.ws.close(1012, "replaced by a newer bridge");
      const conn: Conn = { ws, host, alive: true };
      conns.set(host, conn);
      ws.on("pong", () => {
        conn.alive = true;
      });
      ws.on("message", (data) => onMessage(conn, String(data)));
      ws.on("error", (e: Error) => logger.warn("bridge socket error", { host, err: e.message }));
      ws.on("close", () => {
        if (conns.get(host) === conn) conns.delete(host);
        void markOffline(host).catch((e: unknown) => {
          logger.error("markOffline failed", { host, err: e instanceof Error ? e.message : String(e) });
        });
        logger.info("bridge disconnected", { host });
      });
      logger.info("bridge connected", { host, protocolVersion: PROTOCOL_VERSION });
    });
  }

  // ---- hub → bridge ----

  async function call<T>(host: HostId, method: HubMethod, params: Record<string, unknown>): Promise<T> {
    if (!HUB_METHODS.includes(method)) {
      throw new BridgeError(JSONRPC_ERRORS.METHOD_NOT_FOUND, `not a hub method: ${method}`);
    }
    if (method === "ingest.scan" || method === "ingest.read") {
      throw new BridgeError(BRIDGE_ERRORS.CAPABILITY_UNSUPPORTED, `${method} is Phase B (계약 §8)`);
    }
    const conn = conns.get(host);
    if (conn === undefined) {
      throw new BridgeError(BRIDGE_ERRORS.RUNTIME_UNAVAILABLE, `no bridge connected for host ${host}`);
    }
    const id = randomUUID();
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new BridgeError(BRIDGE_ERRORS.TURN_TIMEOUT, `${method} timed out after ${callTimeoutMs}ms`));
      }, callTimeoutMs);
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      send(conn.ws, { jsonrpc: "2.0", id, method, params: withMeta(params) });
    });
  }

  const beat = setInterval(() => {
    for (const conn of [...conns.values()]) {
      if (!conn.alive) {
        conn.ws.terminate();
        continue;
      }
      conn.alive = false;
      conn.ws.ping();
    }
  }, heartbeatMs);
  beat.unref();

  return {
    handleUpgrade,
    call,
    hosts: () => [...conns.keys()],
    async close() {
      closed = true;
      clearInterval(beat);
      for (const w of [...waiters]) {
        w.stop();
        w.reject(new BridgeError(BRIDGE_ERRORS.RUNTIME_UNAVAILABLE, "hub is shutting down"));
      }
      waiters.clear();
      for (const p of [...pending.values()]) {
        clearTimeout(p.timer);
        p.reject(new BridgeError(BRIDGE_ERRORS.RUNTIME_UNAVAILABLE, "hub is shutting down"));
      }
      pending.clear();
      for (const conn of [...conns.values()]) conn.ws.close(1001, "hub shutting down");
      conns.clear();
      await new Promise<void>((r) => wss.close(() => r()));
    },
  };
}
```

> `turn.item.delta`는 `emit("ephemeral", …)`로만 흘린다 — row도 NOTIFY도 만들지 않는다(계약 §3.5, A3-D14). `DURABLE_CHANNEL`에 `turn.*`가 없는 것은 실수가 아니라 이 규칙이다.

- [ ] 5. 설정에 브리지 토큰을 더한다. `/Users/logankim/AI-Workspaces/omnis/apps/hub/src/config.ts`의 `HubConfig`와 `readConfig` 반환값을 고친다.

```ts
export interface HubConfig {
  port: number;
  host: "127.0.0.1";
  version: string;
  /** Keychain omnis.bridge.token.<host>의 값을 A6 래퍼가 주입한다. 빈 문자열이면 WS /bridge를 닫는다. */
  bridgeToken: string;
}
```
그리고 `return { port, host: "127.0.0.1", version: HUB_VERSION };`를 아래로 바꾼다:
```ts
  return { port, host: "127.0.0.1", version: HUB_VERSION, bridgeToken: env.OMNIS_BRIDGE_TOKEN ?? "" };
```

- [ ] 6. `main.ts`에 브리지를 배선한다. `createHubServer` 호출 **앞**에 브리지를 만들고 `onUpgrade`로 넘긴 뒤, `close()`에서 서버를 닫은 직후 `bridge.close()`를 부른다.

```ts
  const bridge = createBridgeHub({ kernel, pool, logger, token: config.bridgeToken });
  if (config.bridgeToken === "") {
    logger.warn("OMNIS_BRIDGE_TOKEN is empty — WS /bridge refuses every upgrade with 503");
  }
  const startedAt = Date.now();
  const server = createHubServer({
    kernel,
    pool,
    config,
    logger,
    startedAt,
    onUpgrade: (req, socket, head) => bridge.handleUpgrade(req, socket, head),
  });
```
파일 맨 위에 `import { createBridgeHub } from "./bridge.js";`를 더하고, `close()`의 `await new Promise<void>((r) => server.close(() => r()));` 바로 다음 줄에 `await bridge.close();`를 넣는다(`kernel.close()` 앞 — 승인 대기 중인 브리지 요청을 먼저 깨워야 커널 LISTEN 커넥션을 닫을 수 있다).

- [ ] 7. 테스트를 돌려 통과를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/hub test:integration
```
기대: `Tests  19 passed (19)` (Task 24의 9개 + Task 25의 3개 + 이번 7개).

- [ ] 8. `WS /bridge`가 토큰 없이는 절대 열리지 않는다는 것을 실행 중인 허브로 한 번 더 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && DATABASE_URL=postgres://logan@127.0.0.1:5432/omnis OMNIS_BRIDGE_TOKEN=local-dev-token pnpm --filter @omnis/hub exec tsx src/main.ts & sleep 3
curl -si -N -H 'connection: Upgrade' -H 'upgrade: websocket' -H 'sec-websocket-version: 13' -H 'sec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==' -H 'x-omnis-host: macbook' http://127.0.0.1:8787/bridge | head -1
curl -si -N -H 'connection: Upgrade' -H 'upgrade: websocket' -H 'sec-websocket-version: 13' -H 'sec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==' -H 'x-omnis-host: macbook' -H 'authorization: Bearer local-dev-token' http://127.0.0.1:8787/bridge | head -1
kill %1
```
기대: 첫 줄 `HTTP/1.1 401 Unauthorized`, 둘째 줄 `HTTP/1.1 101 Switching Protocols`.

- [ ] 9. 전체 회귀를 돌린다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/hub build && pnpm typecheck && pnpm lint && pnpm test && pnpm test:integration
```
기대: 빌드·타입체크·린트 에러 0, `pnpm test`와 `pnpm test:integration` 전부 통과.

- [ ] 10. US-A10을 하나의 원자 커밋으로 남긴다(Task 23~26).

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-A10: apps/hub 부트스트랩 + HTTP 표면 + WS /bridge + graceful shutdown

- readConfig: 127.0.0.1 고정, OMNIS_HUB_PORT 기본 8787, 8642(Hermes) 거부, OMNIS_BRIDGE_TOKEN 주입
- startHub: createPool → createKernel → hub_healthcheck 등록 → scheduler.start → bridge → listen
- HTTP 5개(node:http): GET /health, GET /approvals, POST /approvals/:id/decide, GET/POST /kill-switch
- 다른 부록 소유 경로(/search, /memory/search, /transcript/:id)는 404
- WS /bridge(계약 §5 서버 구현 오너 = 이 계획): Bearer 토큰 + x-omnis-host 검증, JSON-RPC 2.0,
  runtime.registered/session.registered/health/turn.*/approval.requested 수신, bridge/discover 등 HUB_METHODS 송신,
  approval.requested → pending_approvals → 결정 대기 → HumanResponse 응답, 30초 ping/pong 하트비트
- 프로토콜 버전 불일치는 연결이 아니라 그 요청만 -32010으로 거절(A2-D3)
- ApprovalStateError → 409, 잘못된 body → 400
- SIGTERM/SIGINT: 연결 차단 → scheduler.stop(claim 해제) → bridge.close → kernel.close → hub.stopped 감사 → pool.end
- pnpm --filter @omnis/hub build 통과

Implemented-by: Claude Opus

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 27: ci (A7 §6, tier: Sonnet)

**스토리 없음** — A7 §6/A7-D7이 요구하는 `.github/workflows/ci.yml`이 6개 계획 어디에도 배정돼 있지 않았다(교차 검증 M13). Phase A 마지막 태스크로 이 계획이 만든다. 스토리 id가 없으므로 커밋 제목은 `<story-id>:` 대신 `A7-§6:` 접두를 쓴다.

**읽을 곳**: A7 §6(CI 문단 — lint+typecheck+unit은 항상, integration은 경로 필터), A7-D7(경로 필터 목록), 계약 §2(Postgres 17 + pgvector, 테스트 DB `omnis_test`, `DATABASE_URL` 기본값), Task 2의 `vitest.global-setup.ts`(`omnis_test`가 아니면 거부한다).

**만들지 않을 것(YAGNI)**: macOS 러너 Tauri 빌드 job(A7 §6이 적었지만 `apps/desktop`은 Phase A 이 계획 밖에서 생긴다 — 데스크톱 계획이 이 파일에 job 하나를 덧붙인다), 릴리스/서명 워크플로(Phase D), 커버리지 업로드, 캐시 튜닝, matrix(Node 22 하나).

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/.github/workflows/ci.yml`

**Interfaces:**
- Consumes: 루트 스크립트 `lint`/`typecheck`/`test`/`test:integration` (Task 1).
- Produces: GitHub Actions 워크플로 `ci` (TS export 없음).

### Steps

- [ ] 1. 워크플로를 쓴다. `/Users/logankim/AI-Workspaces/omnis/.github/workflows/ci.yml`:

```yaml
name: ci

on:
  push:
    branches: ["main"]
  pull_request:

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  changes:
    name: path filter
    runs-on: ubuntu-latest
    outputs:
      backend: ${{ steps.filter.outputs.backend }}
    steps:
      - uses: actions/checkout@v4
      - uses: dorny/paths-filter@v3
        id: filter
        with:
          # A7-D7: integration job은 이 경로가 바뀔 때만 돈다.
          filters: |
            backend:
              - 'packages/db/**'
              - 'packages/kernel/**'
              - 'packages/memory/**'
              - 'apps/hub/**'
              - 'vitest.workspace.ts'
              - 'vitest.shared.ts'
              - 'vitest.global-setup.ts'
              - 'package.json'
              - 'pnpm-lock.yaml'
              - '.github/workflows/ci.yml'

  check:
    name: lint + typecheck + unit
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9.12.3
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      # 컨테이너 없이 도는 unit 프로젝트만(계약 §2). integration은 아래 job이 맡는다.
      - run: pnpm test

  integration:
    name: integration (postgres 17 + pgvector)
    runs-on: ubuntu-latest
    needs: [changes, check]
    if: needs.changes.outputs.backend == 'true'
    services:
      postgres:
        # pgvector/pgvector:pg17 = 공식 postgres:17 + vector 확장. pgcrypto/pg_trgm은 contrib로 이미 들어 있다.
        image: pgvector/pgvector:pg17
        env:
          POSTGRES_USER: logan
          POSTGRES_PASSWORD: logan
          POSTGRES_DB: omnis_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U logan -d omnis_test"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 20
    env:
      # vitest.global-setup.ts는 URL에 omnis_test가 없으면 스키마를 지우지 않고 거부한다.
      DATABASE_URL: postgres://logan:logan@127.0.0.1:5432/omnis_test
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9.12.3
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:integration
```

- [ ] 2. YAML이 파싱되는지, job 3개와 핀이 그대로인지 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm dlx js-yaml .github/workflows/ci.yml | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const w=JSON.parse(s);console.log(Object.keys(w.jobs).join(','));console.log(w.jobs.integration.services.postgres.image);console.log(w.jobs.check.steps.filter(x=>x.run).map(x=>x.run).join('|'));});"
```
기대:
```
changes,check,integration
pgvector/pgvector:pg17
pnpm install --frozen-lockfile|pnpm lint|pnpm typecheck|pnpm test
```

- [ ] 3. 워크플로가 부르는 루트 스크립트가 전부 실제로 존재하는지 확인한다(오타 방지).

```bash
cd /Users/logankim/AI-Workspaces/omnis && node -e "const s=require('./package.json').scripts; for (const k of ['lint','typecheck','test','test:integration']) { if (!s[k]) { console.error('missing script: '+k); process.exit(1); } } console.log('all 4 root scripts present');"
```
기대: `all 4 root scripts present`.

- [ ] 4. 로컬에서 CI와 같은 순서를 한 번 돌려 본다(러너에서 처음 깨지는 것을 막는다).

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration
```
기대: 5개 명령 전부 exit 0.

- [ ] 5. 커밋한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "A7-§6: GitHub Actions CI — lint/typecheck/unit 상시 + Postgres 17 integration

- check job: pnpm install --frozen-lockfile → lint(Biome) → typecheck(tsc --build --force) → test(vitest run)
- integration job: pgvector/pgvector:pg17 서비스 컨테이너, DATABASE_URL이 omnis_test를 가리킨다
- A7-D7 경로 필터(dorny/paths-filter): packages/db·packages/kernel·packages/memory·apps/hub 변경 시에만 integration
- pnpm 9.12.3 / Node 22 핀(계약 §2)
- macOS Tauri job은 apps/desktop이 생길 때 데스크톱 계획이 덧붙인다

Implemented-by: Claude Sonnet

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## 완료 확인

계획 전체가 끝났을 때 아래가 전부 참이어야 한다.

- [ ] `pnpm db:migrate`를 두 번 연속 돌리면 두 번째가 `up to date`다(A3 §8의 러너 전체 테스트).
- [ ] `packages/db/migrations/`에 `0001`~`0008` 8개 파일이 있고 그 외에는 없다(A3 §8 = v1 테이블 전체 목록).
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:integration`이 전부 통과한다.
- [ ] `apps/hub`를 띄우고 `curl -s http://127.0.0.1:8787/health | jq` 하면 `{"ok":true,"version":"0.1.0","db":"up",...}`가 나온다.
- [ ] `curl -s -X POST http://127.0.0.1:8787/kill-switch -H 'content-type: application/json' -d '{"on":true,"reason":"manual check"}'` 후 스케줄러 로그에 `scheduler tick skipped: kill switch is on`이 찍힌다.
- [ ] `grep -rn "adapter.send\|\.send(" packages/kernel/src | grep -v outbox.ts`가 빈 결과다 — 채널 발송에 닿는 코드가 `outbox.ts` 하나뿐이라는 뜻이다.
- [ ] `psql omnis -c "SELECT count(*) FROM audit_log WHERE action='item.sent' AND approval_id IS NULL"`이 0이다(마스터 §2 지표).
- [ ] `OMNIS_BRIDGE_TOKEN` 없이 띄운 허브에 `/bridge` 업그레이드를 시도하면 `503`, 잘못된 토큰이면 `401`, 맞는 토큰 + `x-omnis-host: macbook`이면 `101 Switching Protocols`다(Task 26 스텝 8).
- [ ] `grep -rn "zero_replication" packages apps` 가 빈 결과다 — 복제 role 이름은 `omnis_sync` 하나뿐이다.
- [ ] `git log --format=%B | grep -c "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"` 가 이 계획이 만든 커밋 수와 같다 — 모든 커밋의 마지막 줄이 세션 규칙 트레일러이고, `Implemented-by:` 줄은 본문에 있다.
- [ ] `.github/workflows/ci.yml`이 있고 `pnpm dlx js-yaml .github/workflows/ci.yml`이 `changes`/`check`/`integration` 3개 job을 출력한다.
- [ ] 첫 push 후 GitHub Actions의 `check` job이 초록이고, `apps/hub` 변경이 포함된 push에서는 `integration` job도 돈다(A7-D7 경로 필터).

---

## 수정 이력 (2026-09-20, cross-plan review)

`2026-09-20-plans-review.md` §1 불일치표와 §2 계약 개정(2026-09-20 확정본)을 이 계획에 반영했다.

- **M1·M3·M4** — Task 1을 루트 파일(`package.json`·`pnpm-workspace.yaml`·`tsconfig.base.json`·`biome.jsonc`·`vitest.workspace.ts`)의 **유일 오너**로 명문화하고, 버전 핀을 한 블록으로 고정했다: `vitest 2.1.9` · `typescript 5.6.3` · `pg 8.13.1` · `packageManager pnpm@9.12.3` · `zod ^3.24.1`(zod 4 금지) · `@rocicorp/zero 1.9.0` exact · `ai 7.0.107`. 다른 5개 계획은 루트 스캐폴드를 만들지 않고 `test -f`로 확인만 한다.
- **M4(b)** — `biome.jsonc`의 `lineWidth`를 110 → **100**으로 내렸다(계약 §2 확정값). `tsconfig.base.json`은 `strict`·`noUncheckedIndexedAccess`·`exactOptionalPropertyTypes`·`verbatimModuleSyntax`·`isolatedModules`·`noImplicitOverride`를 모두 포함한 채로 유지했다.
- **M5** — 루트 `scripts`에 `dev`(`concurrently`로 hub+desktop 동시, `concurrently 9.1.0` 핀 추가) · `tauri:dev` · `tauri:build`를 더했고, `db:migrate`/`db:migrate:create`를 `tsx packages/db/src/cli/*.ts` 직접 호출에서 **`pnpm --filter @omnis/db migrate`**(계약 §2)로 바꿨다. 그에 맞춰 `packages/db/package.json`에 `migrate`/`migrate:create` 스크립트와 `tsx 4.19.2` devDependency를 더했다.
- **M12** — 루트 `vitest.workspace.ts`의 `unit` include를 `*.test.{ts,tsx}`로 넓혔다(`packages/*/src`·`packages/*/test`·`packages/adapters/*`·`apps/*/src`·`apps/*/test`). 계약이 적은 `src/**` 패턴을 그대로 넣되, 이 계획의 모든 테스트가 사는 `test/**`도 함께 유지해야 조용한 스킵이 생기지 않는다. `exclude`에 `**/dist/**`를 추가했다.
- **M6** — **Task 26 `hub-bridge-ws`를 신설**했다(US-A10). `apps/hub/src/bridge.ts`가 계약 §3.5/§8의 서버 측을 구현한다: Bearer 토큰(`OMNIS_BRIDGE_TOKEN` ← Keychain `omnis.bridge.token.<host>`) + `x-omnis-host` 검증, JSON-RPC 2.0 프레이밍, `runtime.registered`/`session.registered`/`health`/`turn.*` 수신, `approval.requested` → `pending_approvals` → 결정 대기 → `HumanResponse` 응답, `HUB_METHODS` 송신(`bridge/discover`·`session.*`·`turn.*`, `ingest.*`는 Phase B로 즉시 거절), ping/pong 하트비트. 테스트는 `ws` 클라이언트로 register + discover 왕복을 실제로 돈다. Task 24의 YAGNI/주석에 있던 "US-A17이 꽂는다"는 전부 "Task 26이 꽂는다"로 정정했다.
- **M13** — **Task 27 `ci`를 신설**했다. `.github/workflows/ci.yml`을 A7 §6/A7-D7대로 쓴다: `check` job(lint+typecheck+unit, 상시) + `integration` job(`pgvector/pgvector:pg17` 서비스 컨테이너, `dorny/paths-filter` 경로 필터). macOS Tauri job은 `apps/desktop`이 생길 때 데스크톱 계획이 덧붙인다.
- **US-A10 커밋 단위** — 계약 §10이 US-A10을 `hub-bootstrap`·`hub-http-routes`·`graceful-shutdown`·`hub-bridge-ws` 4개 태스크로 적었으므로, 원자 커밋 1개 규칙(A7-D8)을 지키려고 Task 25의 커밋 스텝을 Task 26 마지막으로 옮겼다. Task 23~26 전체가 커밋 하나다.
- **계약 §5 Approvals 정합** — `beginExecution`/`completeExecution`/`failExecution`/`expire`는 이제 계약 §5의 정식 표면이다. Task 18의 "계약을 넘어선 추가 메서드 4개" 표현을 "계약 §5 `Approvals`의 나머지 메서드 4개"로 고치고, Task 16의 `Approvals` 목록에 "나머지 4개는 Task 18이 붙인다"를 명시했다. `PendingApproval`·`Logger`/`createLogger`·`killSwitchStatus`·`runEgress`/`EgressToken`/`EgressSpec`/`EgressDeps`/`createOutbox`/`createIngestSink`는 이미 계약 §5와 같은 이름·시그니처였다 — `createLogger`만 Task 12의 Produces 줄에서 `traceId` 인자가 빠져 있어 계약과 같게 고쳤다. 계약 §5의 `zeroSchema`/`assertZeroPublication`/`ZeroPublicationError`는 `@omnis/kernel` 심볼이지만 오너가 US-A21(`2026-09-20-phase-a-sync-and-agents.md` Task 1~2)이므로 이 계획은 만들지 않는다 — 이 계획은 그들이 대조할 `zero_omnis` publication(Task 10)만 만든다.
- **복제 role** — `omnis_sync`(A3 §1이 오너)를 그대로 두고, **zero-cache가 붙는 유저가 `omnis_sync`임을** `0001`·`0008` 양쪽에 1줄씩 명기했다. 계약 §7의 `zero_replication`은 옛 이름이며 코드 어디에도 등장하지 않는다.
- **커밋 트레일러** — 이 계획의 `git commit` 19개 전부를 세션 규칙에 맞췄다: 본문 마지막에 `Implemented-by: <tier>`(A7 §6이 요구하는 실행 모델 표기), 커밋 마지막 줄은 예외 없이 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Global Constraints에 남아 있던 "불일치는 open question" 문장을 지웠다.
- **완료 확인** — 브리지 업그레이드 401/503/101, `zero_replication` 부재, 트레일러 일관성, `ci.yml` 파싱, 첫 push CI 초록 5줄을 추가했다.

미반영(이 계획 밖): M2(sync-and-agents의 zod 4 → protocol의 zod 3), M7·M8(Keychain 이름 — 어댑터·데스크톱 계획), M9·M10·M11(데스크톱 계획), M14(phase-0 T17 범위 축소).
