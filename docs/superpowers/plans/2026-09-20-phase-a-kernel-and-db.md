# Phase A Kernel & DB Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the omnis L0 kernel (8 schema files + 3 event tiers + scheduler + approval gate + kill switch + audit middleware) on Postgres 17, and make `apps/hub` serve it at `127.0.0.1:8787`.

**Architecture:** `@omnis/db` is the lowest layer, holding only DDL, the migration runner, and typed query helpers (no ORM). `@omnis/kernel` depends only on `@omnis/db` and `@omnis/protocol`, implementing events/scheduler/approvals/kill-switch/audit/egress as pure backend logic, and every irreversible action must pass through the single `runEgress` function to run. `apps/hub` boots the kernel and layers on only the 5 loopback HTTP surfaces, `WS /bridge` (contract §5 pinned this plan as the owner of the server implementation), and graceful shutdown — no channel code and no UI. Finally it attaches the CI workflow from A7 §6.

**Tech Stack:** Node 22 + pnpm workspaces · TypeScript 5.6 (strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`) · PostgreSQL 17 + `pgcrypto`/`vector`(pgvector)/`pg_trgm` · `pg` 8.13.x (no ORM) · vitest 2.1.x (projects: `unit`/`contract`/`integration`) · Biome 1.9.x · `node:http` + `ws` 8.18.x (no web framework) · GitHub Actions (`pgvector/pgvector:pg17` service container)

**Spec:** /Users/logankim/AI-Workspaces/omnis/docs/spec/00-omnis-design.md + the appendices this plan implements:
- `A3-data-schema.md` in full (§1 conventions, §1.1 value sets, §2 core DDL, §2.1 calendar, §3 people·labels, §4 tasks·agents·approvals, §5 memory, §6 kernel tables, §6.1 append-only, §6.1.1 rolloff, §6.2 NOTIFY, §7 publication, §8 migration, §9 draft transitions, §11 retention)
- `00-omnis-design.md` §4.2 deployment topology, §7 kernel
- `A7-dev-process.md` §1 dependency rules, §2 toolchain, §5 test strategy, §7 backlog (US-A01~A10)
- `2026-09-20-phase-a-interfaces.md` (interface contract — §1 packages, §2 commands, §4 `@omnis/db`, §5 `@omnis/kernel`, §9 common conventions)

---

## Global Constraints

- Node 22 + pnpm workspaces. The root `pnpm-workspace.yaml` includes only `packages/*`, `packages/adapters/*`, `apps/*`, and does not include `tools/spikes/*` (A7 §1).
- Pin TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` in the root `tsconfig.base.json`, and every package extends it (A7 §1).
- Pin Postgres 17 (A3 §1). Dev DB `omnis`, test DB `omnis_test`, connection via `DATABASE_URL` (contract §0-3, §9).
- The hub binds only to `127.0.0.1:8787` (master §4.2). Port 8642 is used by Hermes `api_server`, so avoid it.
- Migrations are append-only files `packages/db/migrations/000N_<name>.sql` and the tracking table is `_omnis_migrations` (A3 §8). Never modify an already-applied file — always add a new number.
- Until the approval gate (US-A07) is complete, do not wire up the `send`/`delete`/`delegate`/`calendar_write` irreversible tools anywhere (A7 §7 common prohibitions). In this plan the only place a real channel `send` is reached is `createOutbox` in Task 22, and only there does it pass through `runEgress`.
- Do not delete or skip tests to make them pass (A7 §7 common prohibitions).
- Import provider SDKs only inside each adapter package — `@omnis/db`/`@omnis/kernel`/`apps/hub` have no external client other than `pg` (A7 §1).
- Keychain item names follow the A1 rule `omnis.<channel>.<kind>.<external_id>`, and the bridge token is `omnis.bridge.token.<host>` (contract §0-7). This plan does not read the Keychain, but it preserves as a DDL comment the fact that `account_secrets.auth_ref` holds only strings of this form.
- Story tiers follow the A7 §4 assignment table, and any diff produced by DeepSeek must be reviewed by Sonnet or higher (A7 §3·§4).
- The commit message is `<story-id>: <one-line summary>` + a list of the acceptance criteria met in the body + a single `Implemented-by: <tier>` line at the end of the body (the "model that actually implemented the story" notation required by A7 §6: `DeepSeek V4.1 Flash` / `Claude Sonnet` / `Claude Opus`), and the **last line of the commit is, without exception,** `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` (session rule). The `Co-Authored-By: Claude <tier>` / `Co-Authored-By: DeepSeek V4.1 Flash` format from contract §9 was absorbed into the `Implemented-by:` body line — not an open question. Every `git commit` command below uses this format.
- Branches are `ralph/<story-id>`, worktrees are `omnis/.worktrees/<story-id>` (contract §9).

**Prerequisites (outside this plan):** From Task 16 on, the code imports `HumanInterrupt`/`HumanResponse`/`ApprovalAction`/`ApprovalState`/`ApprovalDecision`/`ApprovalRisk` from `@omnis/protocol` (contract §3.4) and `Adapter`/`NormalizedItem`/`AdapterEvent`/`IngestSink` (contract §3.2·§3.3). These symbols are created by US-A11 in `2026-09-20-phase-a-protocol-and-adapters.md`. Do not start Tasks 16~25 before US-A11 is merged (it is not in the A7 §7 dependency order, but the package dependency in contract §1 forces it).

**`exactOptionalPropertyTypes` pitfall**: `{ target_id: maybeUndefined }` assigns `undefined` to an optional property, which is a compile error. All the code in this plan solves this with the conditional spread `...(x !== undefined ? { k: x } : {})` or with `?? null` on SQL parameters.

**`noUncheckedIndexedAccess` pitfall**: the type of `rows[0]` is `T | undefined`. All the code in this plan narrows it with `const row = rows[0]; if (row === undefined) throw ...`.

---

## Task 1: db-scaffold (US-A01, tier: DeepSeek)

**Story US-A01** — Goal: `packages/db` scaffold + migration runner (runner only, no schema, advisory lock + sha comparison) / Outputs: `packages/db/src/migrate.ts`, `_omnis_migrations` bootstrap / Verification command: `pnpm --filter @omnis/db test` / tier: DeepSeek (review: Sonnet+).

This task builds only as much of the monorepo-wide bootstrap as is needed for `@omnis/db` to come alive. Task 2 layers on the runner.

**Read:** A7 §1 (tree·dependency direction), A7 §2 (toolchain·root scripts), contract §1 (package table), contract §2 (command table), contract §4 (`@omnis/db` export list).

**Do NOT build (YAGNI):** Turborepo/Nx (explicitly excluded by A7-D2), an ORM, a custom logging library, scaffolds for `packages/memory`·`packages/agents`·`packages/ui`·`apps/desktop` (each is built in its own plan), the CI workflow (A7 §6 — Task 27 of this plan builds it, not here).

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/package.json`, `/Users/logankim/AI-Workspaces/omnis/pnpm-workspace.yaml`, `/Users/logankim/AI-Workspaces/omnis/tsconfig.base.json`, `/Users/logankim/AI-Workspaces/omnis/tsconfig.json`, `/Users/logankim/AI-Workspaces/omnis/biome.jsonc`, `/Users/logankim/AI-Workspaces/omnis/vitest.shared.ts`, `/Users/logankim/AI-Workspaces/omnis/vitest.workspace.ts`, `/Users/logankim/AI-Workspaces/omnis/packages/db/package.json`, `/Users/logankim/AI-Workspaces/omnis/packages/db/tsconfig.json`, `/Users/logankim/AI-Workspaces/omnis/packages/db/vitest.config.ts`, `/Users/logankim/AI-Workspaces/omnis/packages/db/src/index.ts`
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/db/test/pool.test.ts`

**Interfaces:**
- Consumes: none (leaf bootstrap).
- Produces: `createPool(env?: NodeJS.ProcessEnv): Pool` · `query<T>(c: Pool | PoolClient, sql: string, params?: readonly unknown[]): Promise<T[]>` · `one<T>(c: Pool | PoolClient, sql: string, params?: readonly unknown[]): Promise<T>` · `tx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T>` · `MIGRATIONS_DIR: string` · `NOTIFY_CHANNELS: readonly string[]` (all from `@omnis/db`, contract §4).

### Steps

- [ ] 1. Create the 4 workspace root files.

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

> **This task is the sole owner of the root files** (contract §2). The other 5 plans do not create the root scaffold and only check that it exists with `test -f`. Version pins are identical across the whole workspace: `vitest 2.1.9` · `typescript 5.6.3` · `pg 8.13.1` · `packageManager pnpm@9.12.3` · `zod ^3.24.1` (owner `@omnis/protocol`, zod 4 prohibited) · `@rocicorp/zero 1.9.0` exact · `ai 7.0.107`.
>
> `dev`·`tauri:dev`·`tauri:build` point at `@omnis/desktop` — that package is created by `2026-09-20-phase-a-desktop.md`. Running `pnpm dev` at this stage of the plan means pnpm cannot find `@omnis/desktop` and only that side fails (expected). `db:migrate` calls the `migrate` script in `@omnis/db`, and that script and its CLI file are created by Task 2.

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

- [ ] 2. Pin the 3 vitest projects (`unit`/`contract`/`integration`) (contract §2). Declare the workspace alias here, only once, so that source TS runs directly.

`/Users/logankim/AI-Workspaces/omnis/vitest.shared.ts`:
```ts
import { fileURLToPath } from "node:url";

/** Internal packages resolve to source TS directly, not to build artifacts. Production uses the dist from tsc --build. */
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
      // contract §2: unit covers both *.test.ts and *.test.tsx (so that the tsx tests in packages/ui·apps/desktop
      // are not silently skipped by pnpm test). It collects both tests next to src/ and tests in the test/ directory.
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

> `vitest.global-setup.ts` is created by Task 2. In Task 1 no file matches the `integration` project, so it does not run even though it is referenced.

- [ ] 3. Create the `@omnis/db` package skeleton.

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

> The CLI files that `migrate`/`migrate:create` point at are created by Task 2. In Task 1 only the scripts are declared and they are not run — the root `pnpm db:migrate` delegates to `pnpm --filter @omnis/db migrate` (contract §2), so the names are pinned here in advance.

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

- [ ] 4. Write the failing test. `/Users/logankim/AI-Workspaces/omnis/packages/db/test/pool.test.ts`:

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

- [ ] 5. Install the dependencies and run the test and confirm it fails.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm install && pnpm --filter @omnis/db test
```
Expected failure: `Failed to resolve import "@omnis/db"` or `Cannot find module .../packages/db/src/index.ts`.

- [ ] 6. Write the minimal implementation. `/Users/logankim/AI-Workspaces/omnis/packages/db/src/index.ts`:

```ts
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";

export { Pool, type PoolClient } from "pg";

/** Absolute path to packages/db/migrations. Points to the same place whether running from src (vitest) or dist (hub). */
export const MIGRATIONS_DIR: string = fileURLToPath(new URL("../migrations", import.meta.url));

/** A3 §6.2. The payload carries only the id, 8,000B limit. */
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
    throw new Error("DATABASE_URL is required (contract §9)");
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

- [ ] 7. Run the tests and confirm they pass.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/db test
```
Expected output: `Test Files  1 passed (1)` / `Tests  4 passed (4)`.

- [ ] 8. Run the typecheck and lint.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm typecheck && pnpm lint
```
Expected output: 0 errors on both.

- [ ] 9. Commit.

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-A01: packages/db scaffold and typed query helpers

- pnpm workspaces + tsconfig.base.json(strict/noUncheckedIndexedAccess/exactOptionalPropertyTypes)
- Biome as the single linter, vitest projects unit/contract/integration
- @omnis/db: createPool/query/one/tx/MIGRATIONS_DIR/NOTIFY_CHANNELS
- pnpm --filter @omnis/db test passes

Implemented-by: DeepSeek V4.1 Flash

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 2: migrate-runner (US-A01, tier: DeepSeek)

**Story US-A01** (continued) — Outputs `packages/db/src/migrate.ts` + the `_omnis_migrations` bootstrap. Verification command `pnpm --filter @omnis/db test`. The runner code in A3 §8 is the single source, and this task transcribes it into the `migrate(pool, dir)` signature.

**Read:** A3 §8 (the runner code in full, verification rules), contract §4 (the `migrate()` semantics paragraph — bootstrap → advisory lock 8931447 → sort → sha256 comparison → `.noxact.sql` exception → insert → finally unlock), contract §2 (the integration test DB paragraph).

**Do NOT build (YAGNI):** rollback (forward-only, A3-D9), fancy scaffolding for the migration creation template (touching a single file is enough), a dry-run mode, migration lock timeout configuration.

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/packages/db/src/migrate.ts`, `/Users/logankim/AI-Workspaces/omnis/packages/db/src/cli/migrate.ts`, `/Users/logankim/AI-Workspaces/omnis/packages/db/src/cli/create.ts`, `/Users/logankim/AI-Workspaces/omnis/packages/db/migrations/.gitkeep`, `/Users/logankim/AI-Workspaces/omnis/vitest.global-setup.ts`
- Modify: `/Users/logankim/AI-Workspaces/omnis/packages/db/src/index.ts`
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/db/test/integration/migrate.test.ts`

**Interfaces:**
- Consumes: `createPool`, `query`, `MIGRATIONS_DIR` (Task 1).
- Produces: `migrate(pool: Pool, dir: string): Promise<{ applied: string[] }>` · `class MigrationError extends Error` (`name === "MigrationError"`, contract §9) — both re-exported from `@omnis/db`.

### Steps

- [ ] 1. Create the test DB. Assumes a local native Postgres 17 (contract §2: no container).

```bash
dropdb --if-exists omnis_test && createdb omnis_test && psql -d omnis_test -c 'SELECT version()'
```
Expected output: a single `PostgreSQL 17.x ...` line.

- [ ] 2. Create the globalSetup for the integration project. The reset strategy is exactly the contract §2 one: `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` → `migrate(pool, MIGRATIONS_DIR)` and nothing else (no per-file transaction rollback — triggers and NOTIFY must be verified).

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

> `DROP SCHEMA public CASCADE` also drops the extensions (`vector` etc.) and `_omnis_migrations`. The roles (`omnis_owner`/`omnis_hub`/`omnis_sync`) are cluster-global and survive, so `0001_extensions.sql` must be idempotent (Task 3).

- [ ] 3. Write the failing integration test. `/Users/logankim/AI-Workspaces/omnis/packages/db/test/integration/migrate.test.ts`:

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

- [ ] 4. Run the test and confirm it fails.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/db test
```
Expected failure: something along the lines of `No "migrate" export is defined on the "@omnis/db" mock` — in practice `SyntaxError: The requested module ... does not provide an export named 'migrate'`.

- [ ] 5. Write the runner. `/Users/logankim/AI-Workspaces/omnis/packages/db/src/migrate.ts`:

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

- [ ] 6. Re-export from `@omnis/db`. Add it directly below the import lines at the top of `/Users/logankim/AI-Workspaces/omnis/packages/db/src/index.ts`:

```ts
export { MigrationError, migrate } from "./migrate.js";
```

- [ ] 7. Create the empty migrations directory (filled from Task 3 on).

```bash
mkdir -p /Users/logankim/AI-Workspaces/omnis/packages/db/migrations && touch /Users/logankim/AI-Workspaces/omnis/packages/db/migrations/.gitkeep
```

- [ ] 8. Write the two CLI files the root scripts hook up.

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

- [ ] 9. Run the tests and confirm they pass.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/db test
```
Expected output: `Tests  8 passed (8)` (the 4 from Task 1 + these 4).

- [ ] 10. Also verify from the CLI the full runner test defined by A3 §8, namely that two consecutive runs are a no-op.

```bash
cd /Users/logankim/AI-Workspaces/omnis && DATABASE_URL=postgres://logan@127.0.0.1:5432/omnis_test pnpm db:migrate && DATABASE_URL=postgres://logan@127.0.0.1:5432/omnis_test pnpm db:migrate
```
Expected output: `up to date` both times (since there are no migration files yet).

- [ ] 11. Commit.

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-A01: migration runner (advisory lock + sha256 comparison, forward-only)

- migrate(pool, dir): _omnis_migrations bootstrap → pg_advisory_lock(8931447) → sort → sha comparison
- MigrationError when an applied file changes
- .noxact.sql runs outside a transaction (for CREATE INDEX CONCURRENTLY)
- pnpm db:migrate two consecutive runs are a no-op
- vitest globalSetup: DROP SCHEMA public CASCADE → migrate(MIGRATIONS_DIR)

Implemented-by: DeepSeek V4.1 Flash

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 3: ddl-0001-extensions (US-A02, tier: DeepSeek)

**Story US-A02** — Goal: DDL (A3-D9 `0001`~`0002`) / Outputs: `packages/db/migrations/0001_extensions.sql`, `packages/db/migrations/0002_core_inbox.sql` / Verification command: `pnpm db:migrate && pnpm --filter @omnis/db test` / tier: DeepSeek (review: Sonnet+). Depends on: A01.

**Read:** A3 §1 (conventions — 3 extensions, 3 roles), A3 §8 (file split table, `0001` row).

**Do NOT build (YAGNI):** a detailed per-role GRANT matrix (only what A3 defines — the REVOKE/GRANT in `0006` is all of it), an alternative `uuidv7()` implementation (A3-D1: an `(at, id)` index is enough for time ordering), the `mem0` schema (fallback path only, Phase B).

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/packages/db/migrations/0001_extensions.sql`
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/db/test/integration/schema-0001.test.ts`

**Interfaces:**
- Consumes: `migrate`, `createPool`, `query`, `MIGRATIONS_DIR` (Task 1·2).
- Produces: the extensions `pgcrypto`/`vector`/`pg_trgm`, the roles `omnis_owner`/`omnis_hub`/`omnis_sync`. They are SQL symbols, so there is no TS export.

### Steps

- [ ] 1. Write the failing test. `/Users/logankim/AI-Workspaces/omnis/packages/db/test/integration/schema-0001.test.ts`:

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

- [ ] 2. Run the test and confirm it fails.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/db test
```
Expected failure: `expected [] to deeply equal [ 'pg_trgm', 'pgcrypto', 'vector' ]`.

- [ ] 3. Write `/Users/logankim/AI-Workspaces/omnis/packages/db/migrations/0001_extensions.sql`. The 3 `CREATE EXTENSION` lines are exactly the block from A3 §1. For the role-creation DDL, A3 §1 only defines the responsibilities — "roles: `omnis_owner` (DDL·migrations), `omnis_hub` (hub process, DML), `omnis_sync` (zero-cache, `REPLICATION` + SELECT)" — and gives no SQL, so that sentence is transcribed directly into SQL. Roles are cluster-global, so they survive a `DROP SCHEMA public CASCADE` reset — it must be idempotent.

```sql
-- 0001_extensions.sql
-- A3 §1 conventions: 3 extensions + 3 roles. Roles are cluster-global, so this must be safe to re-run.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omnis_owner') THEN
    CREATE ROLE omnis_owner NOLOGIN;        -- DDL·migrations
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omnis_hub') THEN
    CREATE ROLE omnis_hub NOLOGIN;          -- hub process, DML only
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

> **The only replication role is `omnis_sync`.** The user zero-cache connects with via `ZERO_UPSTREAM_DB` is exactly `omnis_sync`, and this role also opens the logical replication slot (A3 §1 is the schema owner). The `zero_replication` written in contract §7 is an old name referring to the same role, so **do not use it** — the name `zero_replication` does not appear in `0001`, in `0008`, or anywhere in `apps/hub`.

- [ ] 4. Apply the migration and run the tests.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/db test
```
Expected output: `Tests  11 passed (11)` (after globalSetup applies `0001`, 3 more pass).

- [ ] 5. Apply it to the dev DB as well, satisfying half of the A7 US-A02 verification command.

```bash
cd /Users/logankim/AI-Workspaces/omnis && createdb omnis 2>/dev/null; DATABASE_URL=postgres://logan@127.0.0.1:5432/omnis pnpm db:migrate && DATABASE_URL=postgres://logan@127.0.0.1:5432/omnis pnpm db:migrate
```
Expected output: first line `applied 1: 0001_extensions.sql`, second line `up to date`.

- [ ] 6. Commit.

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-A02: 0001_extensions.sql — pgcrypto/vector/pg_trgm + 3 roles

- Exactly the A3 §1 conventions: 3 CREATE EXTENSION statements
- omnis_owner/omnis_hub/omnis_sync(REPLICATION) created idempotently
- pnpm db:migrate two consecutive runs are a no-op

Implemented-by: DeepSeek V4.1 Flash

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 4: ddl-0002-core-inbox (US-A02, tier: DeepSeek)

**Story US-A02** (continued) — `0002_core_inbox.sql` creates all 9 tables assigned by the A3 §8 table: `accounts`, `account_secrets`, `persons`, `identities`, `person_merges`, `agent_runtimes` (+ `omnis` 1 row seed), `threads`, `items` (+ partial HNSW), `calendar_events`.

**Read:** A3 §2 (accounts/account_secrets/threads/items DDL in full), A3 §2.1 (calendar_events DDL + join rules), A3 §3 (persons/identities/person_merges DDL), A3 §4 (agent_runtimes DDL + partial unique index + seed), A3 §8 (file ordering rules — "`person_merges` references only `persons` so it goes in `0002`; `calendar_events` references `items` so it goes at the end of the same `0002`").

**The SQL is copied verbatim from A3 — it is not rewritten.** Unlike the reading order in A3 §2 (which shows items first), in the file the FK targets come first: `accounts` → `account_secrets` → `threads` → `persons` → `identities` → `person_merges` → `agent_runtimes` → `items` → `calendar_events`. (This is exactly what the footnote to A3 §2 directs: "in the actual migration file those two tables are created first." `threads.participants` is `uuid[]` and not an FK, so it may come before `persons`.)

**Do NOT build (YAGNI):** embedding columns on tables other than `items`, a Korean morphological analyzer (A3 §1: not used in v1), person resolution logic (A3 §10 is on the TS side and is not in any Phase A story), partitioning (A3-D6).

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/packages/db/migrations/0002_core_inbox.sql`
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/db/test/integration/schema-0002.test.ts`

**Interfaces:**
- Consumes: `pgcrypto` (`gen_random_uuid()`), `vector`, `pg_trgm` from `0001_extensions.sql`.
- Produces: the 9 tables and their constraint names — `accounts_uq`, `accounts_channel_ck`, `accounts_state_ck`, `threads_uq`, `threads_kind_ck`, `threads_scope_ck`, `persons_rel_ck`, `identities_uq`, `identities_source_ck`, `person_merges_kind_ck`, `agent_runtimes_uq`, `agent_runtimes_runtime_ck`, `agent_runtimes_host_ck`, `agent_runtimes_state_ck`, `agent_runtimes_omnis_uq`, `items_kind_ck`, `items_status_ck`, `items_scope_ck`, `items_sensitivity_ck`, `items_author_ck`, `items_external_uq`, `items_source_hash_uq`, `items_idem_uq`, `items_embedding_idx`, `calendar_events_uq`, `calendar_events_status_ck`, `calendar_events_span_ck`. Later tasks and other plans assert on these names.

### Steps

- [ ] 1. Write the failing test. `/Users/logankim/AI-Workspaces/omnis/packages/db/test/integration/schema-0002.test.ts`:

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

- [ ] 2. Run the test and confirm it fails.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/db test
```
Expected failure: `relation "accounts" does not exist`.

- [ ] 3. Write `/Users/logankim/AI-Workspaces/omnis/packages/db/migrations/0002_core_inbox.sql`. The block below rearranges the DDL from A3 §2·§2.1·§3·§4 into FK order, with not a single character changed in the columns, constraints, or indexes.

```sql
-- 0002_core_inbox.sql
-- A3 §8 table: accounts, account_secrets, persons, identities, person_merges,
--           agent_runtimes(+omnis seed), threads, items(+partial HNSW), calendar_events
-- The order is FK order (A3 §2 footnote). It differs from the reading order in A3 §2.

CREATE TABLE accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel       text NOT NULL,
  external_id   text NOT NULL,                 -- account identifier within the channel (Slack team+user, email address, etc.)
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

-- A3-D4: secrets live in a separate table. Never put them in the Zero publication.
CREATE TABLE account_secrets (
  account_id  uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  auth_ref    text NOT NULL,                   -- Keychain item name (not the value).
                                               -- the naming convention is owned by A1: omnis.<channel>.<kind>.<external_id>
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
  meta          jsonb NOT NULL DEFAULT '{}'::jsonb,  -- reserved key: meta.pending_next_step (A4 §7.3)
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
  first_contact_at   timestamptz,          -- A4 §7.2 first-contact determination
  last_contact_at    timestamptz,
  next_followup_at   timestamptz,
  item_count         integer NOT NULL DEFAULT 0,
  primary_thread_id  uuid REFERENCES threads(id) ON DELETE SET NULL,  -- A4 §7.3 cadence join target
  cadence_days       integer,              -- if NULL, the relationship_state default applies (A4 §7.3)
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
  handle      text NOT NULL,              -- original spelling
  handle_norm text NOT NULL,              -- normalized key (A3 §10)
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
  identity_ids   uuid[] NOT NULL DEFAULT '{}',  -- identities moved when kind='split'
  reason         text,
  at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT person_merges_kind_ck CHECK (kind IN ('merge','split'))
);

CREATE TABLE agent_runtimes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  runtime      text NOT NULL,
  host         text NOT NULL,                  -- 'mini' | 'macbook'
  display      text NOT NULL,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,   -- bridge self-description (master D5)
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

-- `omnis` is a valid runtime value but a special row with no bridge adapter (master §6, 99-review §4-8).
CREATE UNIQUE INDEX agent_runtimes_omnis_uq ON agent_runtimes (runtime)
  WHERE runtime = 'omnis';

INSERT INTO agent_runtimes (runtime, host, display, state)
  VALUES ('omnis', 'mini', 'omnis agents', 'online');

CREATE TABLE items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id        uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  external_id      text,                        -- NULL for drafts (not yet in the channel)
  kind             text NOT NULL,
  status           text NOT NULL DEFAULT 'received',
  scope            text NOT NULL DEFAULT 'unknown',
  sensitivity      text NOT NULL DEFAULT 'normal',   -- A4 L1 is the only producer (A4 §2.4, A4-D12)
  author_person_id uuid REFERENCES persons(id) ON DELETE SET NULL,
  author_agent_id  uuid REFERENCES agent_runtimes(id) ON DELETE SET NULL,
  author_is_me     boolean NOT NULL DEFAULT false,
  in_reply_to      uuid REFERENCES items(id) ON DELETE SET NULL,
  subject          text,
  body             text NOT NULL DEFAULT '',
  body_html        text,
  attachments      jsonb NOT NULL DEFAULT '[]'::jsonb,
  tool             jsonb,                       -- when kind='tool_call': {name,args,state,label,icon}
  sent_at          timestamptz NOT NULL,
  received_at      timestamptz NOT NULL DEFAULT now(),
  source_hash      text,                        -- adapter idempotency key
  idempotency_key  text,                        -- send idempotency key (A3-D10)
  outbox_claimed_at timestamptz,                -- at-most-once claim by the send worker
  fail_reason      text,
  meta             jsonb NOT NULL DEFAULT '{}'::jsonb,
  embedding        vector(768),                 -- nomic-embed-text-v1.5. Input to the A4 §2.2 kNN
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

-- Index only the items that have an embedding.
CREATE INDEX items_embedding_idx ON items
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)   -- parameter rationale: UNVERIFIED — spike (A3 §14 S-A3-7)
  WHERE embedding IS NOT NULL;

-- A3 §2.1: items(kind='event') = inbox projection, calendar_events = detail.
CREATE TABLE calendar_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id      uuid NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE,  -- join rule
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  external_id  text NOT NULL,              -- event id from Google/Graph
  start_at     timestamptz NOT NULL,
  end_at       timestamptz NOT NULL,
  all_day      boolean NOT NULL DEFAULT false,
  status       text NOT NULL DEFAULT 'confirmed',
  attendees    jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{email, display, response, person_id}]
  attendees_count integer GENERATED ALWAYS AS (jsonb_array_length(attendees)) STORED,
  location     text,
  recurrence   text,                       -- the raw RRULE. No expansion is performed
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calendar_events_status_ck CHECK (status IN ('confirmed','tentative','cancelled')),
  CONSTRAINT calendar_events_uq UNIQUE (account_id, external_id),
  CONSTRAINT calendar_events_span_ck CHECK (end_at >= start_at)
);
CREATE INDEX calendar_events_start_idx ON calendar_events (start_at);
CREATE INDEX calendar_events_end_idx   ON calendar_events (end_at)
  WHERE status <> 'cancelled';
```

- [ ] 4. Run the tests and confirm they pass.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/db test
```
Expected output: `Tests  17 passed (17)`.

- [ ] 5. Run the US-A02 verification command as-is.

```bash
cd /Users/logankim/AI-Workspaces/omnis && DATABASE_URL=postgres://logan@127.0.0.1:5432/omnis pnpm db:migrate && pnpm --filter @omnis/db test
```
Expected output: `applied 1: 0002_core_inbox.sql`, then all tests pass.

- [ ] 6. Commit.

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-A02: 0002_core_inbox.sql — 9 inbox core tables

- accounts/account_secrets/threads/persons/identities/person_merges/agent_runtimes/items/calendar_events
- items: 3 author columns (items_author_ck), sensitivity, embedding vector(768) + partial HNSW, generated search_tsv column
- agent_runtimes: omnis 1 row seed + agent_runtimes_omnis_uq partial unique
- calendar_events: attendees_count generated column + span CHECK
- pnpm db:migrate && pnpm --filter @omnis/db test pass

Implemented-by: DeepSeek V4.1 Flash

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 5: ddl-0003-labels (US-A03, tier: DeepSeek)

**Story US-A03** — Goal: DDL (A3-D9 `0003`~`0004`) — `0003_labels.sql` (`labels`/`label_rules`/`item_labels`/`thread_labels`) + `0004_tasks_approvals.sql` (`agent_sessions`/`tasks`/`pending_approvals`/`notes`/`digests`/`agent_runs`) / Verification command: `pnpm db:migrate && pnpm --filter @omnis/db test` / tier: DeepSeek (review: Sonnet+). Depends on: A02.

**Read:** A3 §3 (labels/label_rules/item_labels/thread_labels DDL in full + the A4 §2.3 naming mapping table), A3 §1.1 (`labels.kind`, `label_rules.tier` value sets), A3 §7 (`label_rules.probe_embedding` is excluded from Zero replication — handled by `0008`, not this file).

**Do NOT build (YAGNI):** a rule compiler (A4 §2.3, not a Phase A story), an HNSW index on `probe_embedding` (A3 defines only one index on `label_rules`, `label_rules_active_idx` — there are only dozens of rules, so a kNN index is unnecessary), label seed data.

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/packages/db/migrations/0003_labels.sql`
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/db/test/integration/schema-0003.test.ts`

**Interfaces:**
- Consumes: `persons`, `items`, `threads` from `0002`.
- Produces: the constraint names `labels_kind_ck`, `labels_uq`, `label_rules_tier_ck`, `item_labels_by_ck`, `thread_labels_by_ck` and the indexes `label_rules_active_idx`, `item_labels_label_idx`, `thread_labels_label_idx`.

### Steps

- [ ] 1. Write the failing test. `/Users/logankim/AI-Workspaces/omnis/packages/db/test/integration/schema-0003.test.ts`:

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
       VALUES ($1, 'email with an invoice attached', $2::vector)
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

- [ ] 2. Run the test and confirm it fails.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/db test
```
Expected failure: `relation "labels" does not exist`.

- [ ] 3. Write `/Users/logankim/AI-Workspaces/omnis/packages/db/migrations/0003_labels.sql` — it is the later block from A3 §3 verbatim.

```sql
-- 0003_labels.sql
-- A3 §3: labels, label_rules, item_labels, thread_labels

CREATE TABLE labels (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  kind       text NOT NULL,
  color      text,
  rule       text,                          -- natural-language rule (Superhuman Auto Labels style)
  rule_model text,
  person_id  uuid REFERENCES persons(id) ON DELETE CASCADE,  -- kind='person'
  archived   boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT labels_kind_ck CHECK (kind IN ('scope','topic','priority','person')),
  CONSTRAINT labels_uq UNIQUE (kind, name)
);

-- Natural-language label rules (A4 §2.3). A4 naming mapping: compiled→rule, compiled_by→rule_by,
-- compiled_at→rule_at, corrections→corrections_30d. positives/negatives are uuid[] (items.id).
CREATE TABLE label_rules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label_id       uuid NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  prompt         text NOT NULL,                    -- the verbatim text the user wrote (SSOT)
  rule           jsonb NOT NULL DEFAULT '{}'::jsonb, -- compiled result CompiledRule (A4 §2.3)
  rule_by        text,                             -- 'claude-sonnet-5' | 'user'
  rule_at        timestamptz,
  probe_embedding vector(768),                     -- CompiledRule.semantic embedding (A4 §2.3 kNN fallback)
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

- [ ] 4. Run the tests and confirm they pass.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/db test
```
Expected output: `Tests  20 passed (20)`.

- [ ] 5. Commit.

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-A03: 0003_labels.sql — labels/label_rules/item_labels/thread_labels

- label_rules folds in the DDL A4 had, adopting A3 naming (rule/rule_by/rule_at/corrections_30d); id and label_id are uuid
- item_labels/thread_labels use a composite (item|thread, label) PK + a by CHECK
- pnpm db:migrate && pnpm --filter @omnis/db test pass

Implemented-by: DeepSeek V4.1 Flash

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 6: ddl-0004-tasks-approvals (US-A03, tier: DeepSeek)

**Story US-A03** (continued) — `0004_tasks_approvals.sql`: `agent_sessions`, `agent_runs`, `tasks`, `pending_approvals`, `notes`, `digests`. `agent_runs` is the table that master §6 and A4-D16 pin down as "the single source for evaluation, cost, and audit".

**Read:** A3 §4 in full (6 DDLs + the A4 §1.7 mapping table), A3 §1.1 (`tasks.state`/`tasks.kind`/`agent_runs.model_tier`/`agent_runs.outcome`/`agent_sessions.state`/`pending_approvals.action`·`state`·`decision` value sets), A3 §8 (`agent_runs` references both `agent_sessions` and `items`, so it lands in `0004`), contract §0-6 (`action` — A3's 6 values win).

**Note — the practical meaning of `approvals_decided_ck`**: `CHECK ((state = 'pending') = (decision IS NULL))` requires a non-NULL `decision` on every row whose `state` is not `pending`. `expired` is no exception. Task 18 decides how to satisfy this constraint (on expiry, `decision='ignore'`), so here we write the A3 SQL verbatim and do not change it.

**Do NOT build (YAGNI):** the approval executor (Task 22), the digest generator (Phase B), the `agent_runs` aggregate view (cost reports are Phase B), recurrence rules for `tasks`.

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/packages/db/migrations/0004_tasks_approvals.sql`
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/db/test/integration/schema-0004.test.ts`

**Interfaces:**
- Consumes: `agent_runtimes`, `threads`, `items`, `persons` from `0002`.
- Produces: the constraint names `agent_sessions_state_ck`, `agent_sessions_uq`, `agent_runs_tier_ck`, `agent_runs_outcome_ck`, `tasks_kind_ck`, `tasks_state_ck`, `tasks_owner_ck`, `approvals_action_ck`, `approvals_state_ck`, `approvals_decision_ck`, `approvals_risk_ck`, `approvals_decided_ck`, `notes_route_state_ck`, `digests_kind_ck`, `digests_uq`. Tasks 16~18 and `apps/hub` identify failures by these names.

### Steps

- [ ] 1. Write the failing test. `/Users/logankim/AI-Workspaces/omnis/packages/db/test/integration/schema-0004.test.ts`:

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
    // rejected when pending but a decision is set
    await expect(
      query(pool, `UPDATE pending_approvals SET decision = 'accept' WHERE id = $1`, [a.id]),
    ).rejects.toThrow(/approvals_decided_ck/);
    // rejected when not pending but decision is NULL — expired included
    await expect(
      query(pool, `UPDATE pending_approvals SET state = 'expired' WHERE id = $1`, [a.id]),
    ).rejects.toThrow(/approvals_decided_ck/);
    // passes when both are changed together
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

- [ ] 2. Run the test and confirm it fails.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/db test
```
Expected failure: `relation "pending_approvals" does not exist`.

- [ ] 3. Write `/Users/logankim/AI-Workspaces/omnis/packages/db/migrations/0004_tasks_approvals.sql` — the A3 §4 DDL verbatim, ordered by FK dependency (`agent_sessions` → `agent_runs` → `tasks` → `pending_approvals` → `notes` → `digests`).

```sql
-- 0004_tasks_approvals.sql
-- A3 §4: agent_sessions, agent_runs, tasks, pending_approvals, notes, digests

CREATE TABLE agent_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  runtime_id   uuid NOT NULL REFERENCES agent_runtimes(id) ON DELETE CASCADE,
  thread_id    uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,  -- session = thread
  session_key  text NOT NULL,        -- stable scope (master D5)
  session_id   text,                 -- rotating transcript id
  cwd          text,
  state        text NOT NULL DEFAULT 'starting',
  summary      text,                 -- durable summary that read_session reads
  last_turn_at timestamptz,
  started_at   timestamptz NOT NULL DEFAULT now(),
  ended_at     timestamptz,
  CONSTRAINT agent_sessions_state_ck CHECK (state IN
    ('starting','idle','running','waiting_approval','ended','failed')),
  CONSTRAINT agent_sessions_uq UNIQUE (runtime_id, session_key)
);
CREATE INDEX agent_sessions_active_idx ON agent_sessions (last_turn_at DESC)
  WHERE ended_at IS NULL;

-- The single record of every L3 loop run (A4-D16). A run that is not here is treated as not having happened.
CREATE TABLE agent_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loop             text NOT NULL,
  agent_session_id uuid REFERENCES agent_sessions(id) ON DELETE SET NULL,
  item_id          uuid REFERENCES items(id) ON DELETE SET NULL,
  trigger_kind     text NOT NULL DEFAULT 'event',   -- 'event' | 'cron' | 'manual'
  trigger_ref      text,                   -- cron job name etc., triggers other than item
  model_tier       text NOT NULL,          -- T0|T1|T2|T3 (master §14)
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
  escalated_from   uuid REFERENCES agent_runs(id) ON DELETE SET NULL,  -- T1 → T2 escalation
  injection_flags  text[] NOT NULL DEFAULT '{}',
  context_hash     text,                   -- sha256(cachedPrefix) — cache hit rate tracking
  result_ref       uuid,                   -- output id. No FK: there are several target tables
  raw_output       text,                   -- keeps output that violated the schema (A4 §1.6)
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
  kind                text NOT NULL DEFAULT 'todo',  -- A4 §7.3 task routing
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

-- HumanInterrupt / HumanResponse ported verbatim. A3-D11.
CREATE TABLE pending_approvals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action        text NOT NULL,
  args          jsonb NOT NULL,          -- ActionRequest.args (verbatim; the UI exposes it as-is)
  description   text NOT NULL,
  config        jsonb NOT NULL DEFAULT
                  '{"allow_accept":true,"allow_edit":true,"allow_respond":false,"allow_ignore":true}'::jsonb,
  state         text NOT NULL DEFAULT 'pending',
  decision      text,                    -- accept | edit | respond | ignore
  decided_args  jsonb,                   -- the human-corrected result for edit/respond
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
  metrics    jsonb NOT NULL DEFAULT '{}'::jsonb,   -- coverage and cost metrics (master §2)
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT digests_kind_ck CHECK (kind IN ('morning','nightly')),
  CONSTRAINT digests_uq UNIQUE (kind, for_date)
);
```

- [ ] 4. Run the tests and confirm they pass.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/db test
```
Expected output: `Tests  25 passed (25)`.

- [ ] 5. Run the US-A03 verification command verbatim.

```bash
cd /Users/logankim/AI-Workspaces/omnis && DATABASE_URL=postgres://logan@127.0.0.1:5432/omnis pnpm db:migrate && pnpm --filter @omnis/db test
```
Expected output: everything passes after `applied 2: 0003_labels.sql, 0004_tasks_approvals.sql`.

- [ ] 6. Commit.

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-A03: 0004_tasks_approvals.sql — sessions, runs, tasks, approvals, notes, digests

- pending_approvals: 6 action values (A3 approvals_action_ck), 6 state values, 4 decision values, approvals_decided_ck
- agent_runs: A3 column names (model_tier/tokens_in/outcome/created_at) + escalated_from self-reference
- agent_sessions (runtime_id, session_key) unique, tasks/notes/digests
- pnpm db:migrate && pnpm --filter @omnis/db test pass

Implemented-by: DeepSeek V4.1 Flash

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 7: ddl-0005-memory (US-A04, tier: Sonnet)

**Story US-A04** — Goal: DDL (A3-D9 `0005`~`0008`) — `0005_memory.sql` (`entities`/`relations`/`memories`+HNSW) + `0006_kernel.sql` (`events` append-only/`audit_log`/`jobs`+triggers) + `0007_notify.sql` (LISTEN/NOTIFY, id-only payload) + `0008_publication.sql` (`zero_omnis`) / Verification command: `pnpm db:migrate && pnpm --filter @omnis/db test` / tier: Sonnet. Depends on: A03. **Additional acceptance criteria**: for the `calendar_events` that US-A02 created, both an `attendees_count BETWEEN 1 AND 8` query and a 48-hour window query on `end_at` must succeed (Task 11).

**Read:** A3 §5 (entities/relations/memories DDL + the 3-layer mapping table), A3 §1.1 (`memories.kind`, `entities.type`), A3 §11 (retention policy — memories are not deleted but invalidated via `invalidated_at`).

**Do NOT build (YAGNI):** the mem0 VectorStore adapter (A3-D12, waiting on the Phase B spike S-A3-1 result), embedding generation (Ollama is Phase B), a `relations` traversal helper, Matryoshka truncation (once A3 §13's threshold signal arrives).

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/packages/db/migrations/0005_memory.sql`
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/db/test/integration/schema-0005.test.ts`

**Interfaces:**
- Consumes: `persons`, `items` from `0002`.
- Produces: the constraint names `entities_type_ck`, `memories_kind_ck`, `memories_scope_ck` and the indexes `entities_live_uq`, `memories_embedding_idx`, `relations_asof_idx`. Phase B's `@omnis/memory` stands on these names.

### Steps

- [ ] 1. Write the failing test. `/Users/logankim/AI-Workspaces/omnis/packages/db/test/integration/schema-0005.test.ts`:

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
      `INSERT INTO memories (content, embedding, kind) VALUES ('logan prefers Korean', $1::vector, 'preference')`,
      [zero768],
    );
    const hit = await query<{ content: string }>(
      pool,
      `SELECT content FROM memories WHERE invalidated_at IS NULL ORDER BY embedding <=> $1::vector LIMIT 1`,
      [zero768],
    );
    expect(hit[0]?.content).toContain("Korean");

    await expect(
      query(pool, `INSERT INTO memories (content, kind) VALUES ('x','rumor')`),
    ).rejects.toThrow(/memories_kind_ck/);
  });
});
```

- [ ] 2. Run the test and confirm it fails.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/db test
```
Expected failure: `relation "entities" does not exist`.

- [ ] 3. Write `/Users/logankim/AI-Workspaces/omnis/packages/db/migrations/0005_memory.sql` — A3 §5 verbatim.

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
  valid_from     timestamptz NOT NULL,     -- when the fact became valid
  valid_until    timestamptz,              -- when the fact stopped being valid
  recorded_at    timestamptz NOT NULL DEFAULT now(),   -- when the system learned of it
  invalidated_at timestamptz               -- when the system learned it is "no longer a fact"
);
CREATE INDEX relations_from_idx ON relations (from_entity_id, type, valid_from DESC);
CREATE INDEX relations_to_idx   ON relations (to_entity_id, type, valid_from DESC);
CREATE INDEX relations_asof_idx ON relations (valid_from, valid_until);

-- L2-2 vector memory. nomic-embed-text-v1.5 = 768d, within HNSW's 2,000d limit.
CREATE TABLE memories (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content        text NOT NULL,
  embedding      vector(768),
  kind           text NOT NULL DEFAULT 'fact',
  scope          text NOT NULL DEFAULT 'unknown',
  source_item_id uuid REFERENCES items(id) ON DELETE SET NULL,
  source_kind    text NOT NULL DEFAULT 'inbox',  -- inbox|calendar|file|drive|github|self
  source_ref     text,                            -- file path, Drive fileId, GitHub URL, etc.
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

-- Index only currently valid memories.
CREATE INDEX memories_embedding_idx ON memories
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)   -- parameter rationale: UNVERIFIED — spike (A3 §14 S-A3-7)
  WHERE invalidated_at IS NULL;
CREATE INDEX memories_person_idx ON memories (person_id, recorded_at DESC);
CREATE INDEX memories_source_idx ON memories (source_kind, source_ref);
CREATE INDEX memories_valid_idx ON memories (valid_from DESC) WHERE invalidated_at IS NULL;
```

- [ ] 4. Run the tests and confirm they pass.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/db test
```
Expected output: `Tests  28 passed (28)`.

- [ ] 5. Commit.

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-A04: 0005_memory.sql — entities/relations/memories + HNSW

- Graphiti 4-timestamp(valid_from/valid_until/recorded_at/invalidated_at)
- entities_live_uq: unique on (type, lower(name)) for live entities only
- memories are invalidated via invalidated_at; the partial HNSW excludes them automatically

Implemented-by: Claude Sonnet

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 8: ddl-0006-kernel (US-A04, tier: Sonnet)

**Story US-A04** (continued) — `0006_kernel.sql`: `events`, `audit_log`, `jobs` (+ 16 seeds) + the append-only triggers + the `omnis_events_rolloff()` function and GRANTs.

**Read:** A3 §6 (events/audit_log/jobs DDL + the 15 seed rows + the owner-split comment), A3 §6.1 (append-only: 2 functions, 4 triggers + REVOKE), A3 §6.1.1 (`omnis_events_rolloff()` SECURITY DEFINER in full + OWNER/REVOKE/GRANT), A3-D5·A3-D6, A3 §11 (retention policy).

**Exactly one line of the A3 SQL has to change — why, and what the changed form is**: A3 §6.1 hard-codes the DB name as a literal via `ALTER DATABASE omnis SET omnis.events_retention = '90 days';`. The test DB is `omnis_test` and contract §2 pins that name, so using the literal as-is makes `0006` fail immediately on `omnis_test` (`database "omnis" does not exist`). We change it only to a form with identical behavior that is independent of the DB name:

```sql
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET omnis.events_retention = %L', current_database(), '90 days');
END
$$;
```

`ALTER DATABASE ... SET` takes effect **from new connections onward**. So the ordering matters: `vitest.global-setup.ts` finishes the migration first, and only then does each test file open a new pool (globalSetup finishes first and the test files connect later, so this is satisfied automatically). We leave this fact in a SQL comment.

**Do NOT build (YAGNI):** partitioning (A3-D6: do not do it before 100,000 rows/day or a DELETE taking over 5 minutes), writing cold dump files (A3 §11 — the hub does it before calling rolloff, Phase B), job handlers (Tasks 14~15), a full GRANT matrix for `omnis_hub` (only the REVOKE/GRANT that A3 specifies).

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/packages/db/migrations/0006_kernel.sql`
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/db/test/integration/schema-0006.test.ts`

**Interfaces:**
- Consumes: `0004` (no table the seed references, but it comes later in file order), the 3 roles from `0001`.
- Produces: the tables `events` (`seq` bigint identity), `audit_log` (`seq`), `jobs`; the functions `omnis_append_only()`, `omnis_no_truncate()`, `omnis_events_rolloff()`; the triggers `events_append_only`, `audit_append_only`, `events_no_truncate`, `audit_no_truncate`; the DB parameter `omnis.events_retention='90 days'`; the 16 seed jobs (`morning_digest`, `nightly_digest`, `memory_consolidate`, `auto_archive_sweep`, `task_remind`, `network_inactive_sweep`, `self_model_weekly`, `eval_weekly`, `drive_poll`, `github_poll`, `followup_sweep`, `token_refresh`, `gmail_rewatch`, `graph_sub_renew`, `events_rolloff`, `slot_health`). Tasks 12·14·19·21 all stand on this.

### Steps

- [ ] 1. Write the failing test. `/Users/logankim/AI-Workspaces/omnis/packages/db/test/integration/schema-0006.test.ts`:

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

- [ ] 2. Run the test and confirm it fails.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/db test
```
Expected failure: `relation "events" does not exist`.

- [ ] 3. Write `/Users/logankim/AI-Workspaces/omnis/packages/db/migrations/0006_kernel.sql`.

```sql
-- 0006_kernel.sql
-- A3 §6: events, audit_log, jobs (+seed) + §6.1 append-only triggers + §6.1.1 rolloff function and GRANTs
-- No FKs on events/audit_log (A3 §1): audit records must survive even if the source row is deleted.

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
  approval_id  uuid,                     -- no FK (deliberate). Egress always leaves a record here
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

-- Schedule owner split (A3 §6):
--   The canonical source for L3~L9 loop job cron schedules is the A4 §6.1 table. A3 only seeds them; if a time changes, fix A4 first.
--   The owner of adapter and kernel infrastructure jobs is A3.
INSERT INTO jobs (name, schedule, next_run_at) VALUES
  -- A4-owned (canonical: A4 §6.1)
  ('morning_digest',        '30 6 * * *',   now()),   -- L5 morning briefing 06:30 KST
  ('nightly_digest',        '0 23 * * *',   now()),   -- L5 nightly digest 23:00 KST
  ('memory_consolidate',    '30 23 * * *',  now()),   -- nightly memory consolidation
  ('auto_archive_sweep',    '0 22 * * *',   now()),   -- L8 auto-archive
  ('task_remind',           '0 9,14,19 * * *', now()),-- L3 reminders
  ('network_inactive_sweep','0 10 * * 1-5', now()),   -- L6 inactivity detection (weekdays 10:00)
  ('self_model_weekly',     '0 21 * * 0',   now()),   -- self-model proposals (Sun 21:00)
  ('eval_weekly',           '0 22 * * 0',   now()),   -- eval harness (Sun 22:00)
  ('drive_poll',            '*/10 * * * *', now()),   -- L9 ingestion
  ('github_poll',           '*/15 * * * *', now()),   -- L9 ingestion
  -- A3-owned (infrastructure)
  ('followup_sweep',        '0 * * * *',    now()),   -- release outbox claims
  ('token_refresh',         '*/30 * * * *', now()),
  ('gmail_rewatch',         '0 3 * * *',    now()),   -- watch expires in 7 days → renew daily
  ('graph_sub_renew',       '0 4 * * 1',    now()),   -- Outlook subscription 10,080 minutes
  ('events_rolloff',        '15 4 * * *',   now()),
  ('slot_health',           '*/5 * * * *',  now());   -- WAL slot monitoring

-- A3 §6.1 append-only enforcement (A3-D5)
CREATE OR REPLACE FUNCTION omnis_append_only() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'append-only: UPDATE on % is forbidden', TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    -- audit_log can never be deleted. events only allow deletes outside the rolloff window.
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

-- A3 §6.1 wrote the DB name as a literal via `ALTER DATABASE omnis SET ...`. The test DB is omnis_test, so
-- we change it only to a form with identical behavior that is independent of the name. ALTER DATABASE ... SET applies from new connections onward.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET omnis.events_retention = %L', current_database(), '90 days');
END
$$;

-- Second line of defense: take the privilege away from the hub role entirely.
REVOKE UPDATE, DELETE, TRUNCATE ON events, audit_log FROM omnis_hub;
GRANT  DELETE ON events TO omnis_owner;   -- rolloff happens only through the SECURITY DEFINER function below

-- A3 §6.1.1: the hub (omnis_hub) has only EXECUTE on this function instead of arbitrary DELETE.
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
  -- The hub finishes the dump (A3 §11) before calling this. This function only deletes.
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

- [ ] 4. Run the tests and confirm they pass. The `omnis.events_retention` test needs a new connection, so it is satisfied automatically by the test pool opened after globalSetup finishes.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/db test
```
Expected output: `Tests  34 passed (34)`.

- [ ] 5. Commit.

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-A04: 0006_kernel.sql — events/audit_log/jobs + append-only + rolloff function

- events/audit_log use seq bigint identity with no FK; 4 append-only triggers (UPDATE/DELETE/TRUNCATE)
- audit_log can never be deleted; events allow deletes only outside the retention window
- omnis_events_rolloff(): SECURITY DEFINER, OWNER omnis_owner, omnis_hub gets EXECUTE only
- 16 job seeds (10 A4-owned + 6 A3 infrastructure)
- ALTER DATABASE runs dynamically via current_database() (works with the omnis_test test DB, identical behavior)

Implemented-by: Claude Sonnet

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 9: ddl-0007-notify (US-A04, tier: Sonnet)

**Story US-A04** (continued) — `0007_notify.sql`: the LISTEN/NOTIFY channels, payloads carry only the id (8,000B limit).

**Read:** A3 §6.2 (the 7-channel table + the `omnis_notify_item()` example + "attach triggers of the same shape to `threads`, `pending_approvals`, `tasks`, `agent_sessions`"), A3-D7 (hub-internal fanout only), A3-D14·contract §0-9 (ephemeral does not ride NOTIFY), contract §4 (the channel and payload table).

**Only 6 of the 7 channels have triggers**: `omnis_item`/`omnis_thread`/`omnis_approval`/`omnis_task`/`omnis_session`/`omnis_job` are fired by table triggers. **`omnis_control` has no table** — the kernel fires it directly with `pg_notify` when the kill switch state changes (Task 19). This file does not create an `omnis_control` trigger.

The payload `state` of `omnis_approval` allows only the two values `"pending"|"decided"` per contract §4, so the trigger NOTIFYs only when it changes to one of those two states. `omnis_session` needs the `runtime` string, so it joins `agent_runtimes`.

**Do NOT build (YAGNI):** debounce/coalescing logic (Postgres already merges the same transaction, channel, and payload, A3 §6.2), ephemeral channels, real data such as body or title in the payload (id only).

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/packages/db/migrations/0007_notify.sql`
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/db/test/integration/schema-0007.test.ts`

**Interfaces:**
- Consumes: `0002`(items/threads/agent_runtimes), `0004`(pending_approvals/tasks/agent_sessions), `0006`(jobs).
- Produces: the functions `omnis_notify_item()`, `omnis_notify_thread()`, `omnis_notify_approval()`, `omnis_notify_task()`, `omnis_notify_session()`, `omnis_notify_job()`; the triggers `items_notify`, `threads_notify`, `approvals_notify`, `tasks_notify`, `sessions_notify`, `jobs_notify`. Task 13 verifies with the kernel's `subscribe()` that these triggers actually fire.

### Steps

- [ ] 1. Write the failing test. This test LISTENs directly with `pg`'s raw client (there is no kernel yet). `/Users/logankim/AI-Workspaces/omnis/packages/db/test/integration/schema-0007.test.ts`:

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

- [ ] 2. Run the test and confirm it fails.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/db test
```
Expected failure: `expected undefined to deeply equal { id: ..., thread_id: ..., op: 'insert' }`.

- [ ] 3. Write `/Users/logankim/AI-Workspaces/omnis/packages/db/migrations/0007_notify.sql`. `omnis_notify_item()` is A3 §6.2 verbatim, and the other 5 are what A3 directed as "the same shape", written to match each channel's payload table (A3 §6.2 / contract §4).

```sql
-- 0007_notify.sql
-- A3 §6.2 / A3-D7: hub-internal fanout only, payloads carry only the id (8,000B limit).
-- omnis_control has no table — the kill switch fires it directly from the kernel with pg_notify.

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

-- contract §4: state only ever emits the two values 'pending' | 'decided'.
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

- [ ] 4. Run the tests and confirm they pass.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/db test
```
Expected output: `Tests  38 passed (38)`.

- [ ] 5. Commit.

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-A04: 0007_notify.sql — NOTIFY 6-channel triggers (id-only payload)

- omnis_item/thread/approval/task/session/job triggers + functions
- omnis_approval only on pending|decided, omnis_session joins runtime
- omnis_control has no table, so the kernel fires it directly (A3-D7)
- every payload stays under the 8,000B limit

Implemented-by: Claude Sonnet

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 10: ddl-0008-publication (US-A04, tier: Sonnet)

**Story US-A04** (continued) — `0008_publication.sql`: `CREATE PUBLICATION zero_omnis` (with column lists).

**Read:** A3 §7 (the publication SQL in full + the include/exclude decision table + "`label_rules` also needs a column list (`probe_embedding` excluded)" + the excluded table list), A3-D8 (whitelist), contract §7 (the replicated table list and the narrowed `items` column list).

**One thing A3 did not spell out**: the SQL block in A3 §7 expands columns only for `items` for readability, and the body instructs that "the real `0008_publication.sql` also lists `label_rules` columns the same way". This task carries out that instruction — it lists the 15 columns of `label_rules` with only `probe_embedding` removed.

**Do NOT build (YAGNI):** replication slot creation (zero-cache does it), the `zero_cvr` schema (A6's remit), the Zero permission DSL (TS side, US-A21), `idle_replication_slot_timeout` (owned by A6).

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/packages/db/migrations/0008_publication.sql`
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/db/test/integration/schema-0008.test.ts`

**Interfaces:**
- Consumes: every table from `0002`~`0006`.
- Produces: the publication `zero_omnis`. US-A21 (`zeroSchema`) must be 1:1 with this publication's table and column set.

### Steps

- [ ] 1. Write the failing test. `/Users/logankim/AI-Workspaces/omnis/packages/db/test/integration/schema-0008.test.ts`:

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

- [ ] 2. Run the test and confirm it fails.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/db test
```
Expected failure: `expected [] to deeply equal [ 'accounts', 'agent_runtimes', ... ]`.

- [ ] 3. Write `/Users/logankim/AI-Workspaces/omnis/packages/db/migrations/0008_publication.sql`.

```sql
-- 0008_publication.sql
-- A3 §7 / A3-D8: Zero replication is a whitelist. A table does not sync unless it is explicitly added.
-- Excluded: account_secrets(secrets), events(cold), audit_log(audit), agent_runs(cost·audit),
--       memories/entities/relations(server queries), person_merges, jobs.

CREATE PUBLICATION zero_omnis FOR TABLE
  accounts, threads, calendar_events, persons, identities,
  labels, item_labels, thread_labels,
  tasks, agent_runtimes, agent_sessions,
  pending_approvals, notes, digests,
  -- Narrow only items to a column list: do not drag the 768d embedding and generated columns down to the phone.
  items (id, thread_id, account_id, external_id, kind, status, scope, sensitivity,
         author_person_id, author_agent_id, author_is_me, in_reply_to,
         subject, body, body_html, attachments, tool, sent_at, received_at,
         source_hash, idempotency_key, outbox_claimed_at, fail_reason, meta),
  -- label_rules drops only probe_embedding (instruction from the A3 §7 body).
  label_rules (id, label_id, prompt, rule, rule_by, rule_at, tier,
               positives, negatives, hits_30d, corrections_30d,
               pinned_by_user, active, created_at, updated_at);
```

> The replication user that reads this publication is **`omnis_sync`** (`REPLICATION` + SELECT) created by `0001`. zero-cache's `ZERO_UPSTREAM_DB` connection string uses this role (`zero_replication` in contract §7 is the old name — do not use it).

> The `items` column list runs from `id` through `meta` — **24** columns (the value with the 2 columns `embedding`·`search_tsv` left out). The test pins this number — it counts directly from the length of `pg_publication_tables.attnames`.

- [ ] 4. Run the tests and confirm they pass.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/db test
```
Expected output: `Tests  42 passed (42)`.

- [ ] 5. Commit.

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-A04: 0008_publication.sql — zero_omnis whitelist publication

- 16 replicated tables, items with 24 columns (embedding/search_tsv excluded), label_rules with probe_embedding excluded
- account_secrets/events/audit_log/agent_runs/memories/entities/relations/person_merges/jobs excluded

Implemented-by: Claude Sonnet

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 11: calendar-query-acceptance (US-A04, tier: Sonnet)

**Story US-A04's explicit acceptance criteria** — "for the `calendar_events` created by US-A02, both the `attendees_count BETWEEN 1 AND 8` query (the prerequisite of the meeting-end trigger in A4 §7.1) and the 48-hour window query on `end_at` (the prerequisite of the metrics in A3 §12 (5b), A4 §7.5) must succeed." This task pins those two queries as executable tests.

**Read:** A3 §12 (5)·(5b) (follow-up queue / 48-hour metric query in full), A3 §2.1 (join rule — 1 event = 1 `items` row + 1 `calendar_events` row, put `start_at` into `items.sent_at`).

**Do NOT build (YAGNI):** the follow-up loop itself (A4 §7, Phase B), writing `digests.metrics` (nightly digest job, Phase B), a TS helper wrapping the queries (there is no caller yet — this task only proves the SQL runs).

**Files:**
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/db/test/integration/calendar-queries.test.ts`

**Interfaces:**
- Consumes: `accounts`/`threads`/`items`/`calendar_events`/`persons` from `0002`.
- Produces: none (acceptance tests only). Evidence that the A3 §12 (5)/(5b) SQL matches the schema.

### Steps

- [ ] 1. Write the acceptance test. `/Users/logankim/AI-Workspaces/omnis/packages/db/test/integration/calendar-queries.test.ts`:

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
    // A3 §2.1 join rule: items.sent_at = start_at
    const item = await one<{ id: string }>(
      c,
      `INSERT INTO items (thread_id, account_id, kind, subject, body, sent_at)
       VALUES ($1,$2,'event','PoC kickoff','', now() - interval '3 days') RETURNING id`,
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
       VALUES ($1,$2,'message','Thank you','sent', true, now() - interval '2 days')`,
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

- [ ] 2. Run the tests. The schema already exists, so this time they must pass right away — if they fail, `calendar_events` or `threads.participants` from `0002` has diverged from A3, so go back to Task 4.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/db test
```
Expected output: `Tests  45 passed (45)`.

- [ ] 3. Run the US-A04 verification command verbatim to close the story.

```bash
cd /Users/logankim/AI-Workspaces/omnis && DATABASE_URL=postgres://logan@127.0.0.1:5432/omnis pnpm db:migrate && pnpm --filter @omnis/db test
```
Expected output: everything passes after `applied 4: 0005_memory.sql, 0006_kernel.sql, 0007_notify.sql, 0008_publication.sql`.

- [ ] 4. Commit.

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-A04: calendar acceptance criteria — attendees_count 1..8 query and 48-hour window metric

- A4 §7.1 meeting-end trigger prerequisite: the attendees_count BETWEEN 1 AND 8 query succeeds
- The A3 §12 (5b) 48-hour missed-send metric query runs as-is on top of the schema
- Verified down to the metric dropping to 0 once an item I sent appears within 48 hours

Implemented-by: Claude Sonnet

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 12: kernel-events-tiers (US-A05, tier: Opus)

**Story US-A05** — Goal: `packages/kernel` event bus (ephemeral/durable/cold 3-tier routing, NOTIFY 8000B id-only) / Outputs: `packages/kernel/src/events.ts` / Verification command: `pnpm --filter @omnis/kernel test:integration` / tier: Opus. Depends on: A04.

**Read:** master §7 (definition of the 3 event tiers), A3-D14 + contract §0-9 (**ephemeral is WS fan-out only — no NOTIFY and no storage**), A3-D7 (NOTIFY is for in-hub fan-out only, id only), contract §5 (`Events` interface comment), contract §4 (channel·payload table), contract §9 (log format).

**The precise meaning of the 3 tiers (verbatim from the contract §5 comment)**:
- `ephemeral` — delivered only to in-process subscribers. It does not touch the DB and does not fire NOTIFY. The hub WS fan-out is the only consumer.
- `durable` — **notifies, via NOTIFY, the id of a row the caller has already written.** Writing the row is not emit's job. `items`/`threads`/`pending_approvals`/`tasks`/`agent_sessions`/`jobs` are already fired by the `0007` triggers, so there is no need to call emit — the place that needs emit is `omnis_control` (kill switch, Task 19), which has no trigger.
- `cold` — INSERT into the `events` table. `events` has no NOTIFY trigger, so nothing is fanned out anywhere.

**Do NOT build (YAGNI):** event replay, a subscription filter DSL, a backpressure queue, reconnect backoff (the graceful shutdown in Task 25 closes it and the hub restarts — the LaunchDaemon revives the Phase A hub), a path that emits inside a transaction.

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/package.json`, `/Users/logankim/AI-Workspaces/omnis/packages/kernel/tsconfig.json`, `/Users/logankim/AI-Workspaces/omnis/packages/kernel/vitest.config.ts`, `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/logger.ts`, `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/events.ts`, `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/index.ts`
- Modify: `/Users/logankim/AI-Workspaces/omnis/tsconfig.json` (add kernel to references)
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/events.test.ts`

**Interfaces:**
- Consumes: `createPool`, `query`, `NOTIFY_CHANNELS` (`@omnis/db`, Task 1).
- Produces (`@omnis/kernel`): `type EventTier = "ephemeral" | "durable" | "cold"` · `interface Events { emit(tier: EventTier, kind: string, payload: { id?: string; [k: string]: unknown }): Promise<void>; subscribe(channel: string, fn: (p: Record<string, unknown>) => void): () => void }` (contract §5) · `interface Logger { debug/info/warn/error(msg: string, extra?: Record<string, unknown>): void }` · `createLogger(pkg: string, traceId?: string | null): Logger` (same signature as contract §5 — the implementation below satisfies both with the `traceId: string | null = null` default) · `createEvents(deps: { pool: Pool; logger: Logger }): Events & { close(): Promise<void> }` · `DURABLE_CHANNEL: Readonly<Record<string, string>>` · `NOTIFY_MAX_BYTES: 8000`. `createKernel` is assembled from these pieces by Task 22.

### Steps

- [ ] 1. Create the package skeleton.

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

> The `./zero` subpath (contract §7) is where US-A21 will create `src/zero-schema.ts`. This task does not create the file — it only puts the `exports` entry in place up front.

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

Update `references` in `/Users/logankim/AI-Workspaces/omnis/tsconfig.json`:
```json
{
  "files": [],
  "references": [{ "path": "./packages/db" }, { "path": "./packages/kernel" }]
}
```

- [ ] 2. Write the failing integration test. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/events.test.ts`:

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

- [ ] 3. Run the test and confirm it fails.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm install && pnpm --filter @omnis/kernel test:integration
```
Expected failure: `Failed to resolve import "@omnis/kernel"`.

- [ ] 4. Write the logger (the one-line JSON format from contract §9). `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/logger.ts`:

```ts
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(msg: string, extra?: Record<string, unknown>): void;
  info(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, extra?: Record<string, unknown>): void;
}

/** contract §9: one line of JSON to stdout. Required keys ts/level/pkg/msg/trace_id. Never put secrets in any key. */
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

- [ ] 5. Write the event bus. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/events.ts`:

```ts
import { NOTIFY_CHANNELS, query } from "@omnis/db";
import type { Pool, PoolClient } from "pg";
import type { Logger } from "./logger.js";

export type EventTier = "ephemeral" | "durable" | "cold";

export interface Events {
  /** ephemeral: in-process fan-out only (no storage, no NOTIFY, A3-D14).
   *  durable: notifies the id of a row the caller has already written.
   *  cold: INSERT into the events table (no trigger, so no NOTIFY). */
  emit(tier: EventTier, kind: string, payload: { id?: string; [k: string]: unknown }): Promise<void>;
  subscribe(channel: string, fn: (p: Record<string, unknown>) => void): () => void;
}

/** durable event kind → NOTIFY channel (contract §4). A kind not listed here cannot be emitted as durable. */
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

/** A3 §6.2: NOTIFY payload limit. */
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
    // Channel names are identifiers and cannot be parameterized. NOTIFY_CHANNELS is a fixed constant, so there is no injection path.
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
        c.release(true); // this connection is in LISTEN state, so discard it instead of returning it to the pool
      }
    },
  };
}
```

- [ ] 6. Write the barrel. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/index.ts`:

```ts
export { DURABLE_CHANNEL, NOTIFY_MAX_BYTES, createEvents } from "./events.js";
export type { EventTier, Events, EventsDeps } from "./events.js";
export { createLogger } from "./logger.js";
export type { LogLevel, Logger } from "./logger.js";
```

- [ ] 7. Run the tests and confirm they pass.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
```
Expected output: `Tests  6 passed (6)`.

- [ ] 8. Run the typecheck (verify the dependency direction is enforced at compile time, A7 §2).

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm typecheck
```
Expected output: 0 errors.

- [ ] 9. Commit.

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-A05: kernel event bus 3-tier routing

- ephemeral: in-process fan-out only, creates neither a row nor a NOTIFY (A3-D14)
- durable: pg_notify via the DURABLE_CHANNEL mapping, throws when the 8000B limit is exceeded
- cold: INSERT into the events table (no NOTIFY trigger)
- subscribe LISTENs only the omnis_ channel whitelist; a subscriber exception does not kill the other subscribers
- pnpm --filter @omnis/kernel test:integration passes

Implemented-by: Claude Opus

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 13: notify-fanout (US-A05, tier: Opus)

**Story US-A05** (continued) — pins down whether the DB triggers from `0007` and the kernel `subscribe()` are actually wired together, so that fan-out runs from a row write alone even when nobody calls `emit`. This is the real behavior of "the durable tier notifies the id of a row the caller already wrote.".

**Read:** A3 §6.2 (trigger table), contract §5 (`Events` comment), the 6 triggers created by Task 9.

**Do NOT build (YAGNI):** the WS server (Task 24 only leaves the spot to open `/bridge`; the WS itself is US-A17), fan-out metrics, per-subscriber queues.

**Files:**
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/notify-fanout.test.ts`

**Interfaces:**
- Consumes: `createEvents`, `createLogger` (Task 12), the triggers from `0007`.
- Produces: none (behavior contract test).

### Steps

- [ ] 1. Write the test. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/notify-fanout.test.ts`:

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
  // Wait a beat for LISTEN to take effect (subscribe grabs the connection asynchronously).
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

- [ ] 2. Run the tests. If both Task 9 and Task 12 are correct they pass right away — if they fail, the failure message tells which side broke (`timed out waiting for NOTIFY` = trigger or LISTEN problem, payload mismatch = the trigger's `json_build_object` problem).

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
```
Expected output: `Tests  9 passed (9)`.

- [ ] 3. Close the story with the US-A05 verification command and commit.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration && git add -A && git commit -m "US-A05: DB trigger → kernel subscribe fan-out verification

- A bare items/threads INSERT is enough for omnis_item/omnis_thread to reach subscribers
- Postgres coalesces identical payloads in the same transaction (A3 §6.2)
- omnis_approval only on pending/decided, executing is silent

Implemented-by: Claude Opus

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 14: scheduler-jobs (US-A06, tier: Opus)

**Story US-A06** — Goal: scheduler (`jobs` table + cron runner, first job = healthcheck) / Outputs: `packages/kernel/src/scheduler.ts` / Verification command: `pnpm --filter @omnis/kernel test:integration` / tier: Opus. Depends on: A05.

**Read:** master §7 (scheduler — a cron table inside the hub process, run history in events), A3 §6 (the `jobs` columns and `jobs_due_idx`, the 16 seeds, TZ=Asia/Seoul), contract §5 (`Scheduler` interface comment — 10-second tick, the claim UPDATE statement verbatim, the list updated after a run).

**Write the cron parser by hand — why**: contract §1 pins `@omnis/kernel`'s dependencies to `@omnis/db` and `@omnis/protocol`, so an external library such as `cron-parser` cannot be added. The syntax used by the 16 seeds is only four kinds — `*`, `*/n`, `a,b,c`, `a-b` — and the TZ is **Asia/Seoul only**. Asia/Seoul has no DST, so converting with a fixed +9h offset is exact. These two facts shrink the parser to 40 lines.

**Do NOT build (YAGNI):** second-level fields, `L`/`W`/`#` extensions, multiple timezones, distributed leader election (the hub is a single process — `claimed_at` only has to prevent duplicates across restarts), job retry backoff (it runs again at the next `next_run_at`), a job history table (the `events` cold tier records it).

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/cron.ts`, `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/scheduler.ts`
- Modify: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/index.ts`
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/cron.test.ts`, `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/scheduler.test.ts`

**Interfaces:**
- Consumes: `query`, `one` (`@omnis/db`) · `Events`, `Logger` (Task 12).
- Produces (`@omnis/kernel`): `nextRunAt(cron: string, from: Date): Date` · `interface Scheduler { register(name: string, cron: string, handler: () => Promise<void>): void; start(): Promise<void>; stop(): Promise<void> }` (contract §5) · `createScheduler(deps: SchedulerDeps): Scheduler` · `interface SchedulerDeps { pool: Pool; events: Events; logger: Logger; now?: () => Date; tickMs?: number; isKillSwitchOn?: () => Promise<boolean> }`.

### Steps

- [ ] 1. Write the failing unit test for the cron parser (no DB needed, so it is the `unit` project). `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/cron.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { nextRunAt } from "@omnis/kernel";

/** Build a UTC Date from a KST wall-clock time (Asia/Seoul = UTC+9, no DST). */
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

- [ ] 2. Run the test and confirm it fails.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test
```
Expected failure: `does not provide an export named 'nextRunAt'`.

- [ ] 3. Write the cron parser. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/cron.ts`:

```ts
/** A3 §6: 5-field cron, TZ=Asia/Seoul. Asia/Seoul has no DST, so convert with a fixed +9h.
 *  ponytail: linear minute-by-minute scan (366-day cap). It is called only once right after a job runs, so the cost does not matter.
 *  If a timezone with DST is ever needed, swap in an Intl.DateTimeFormat-based conversion. */
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
    // POSIX cron: when both dom and dow are restricted, OR them; when only one is restricted, read only that one.
    const dayOk = domStar && dowStar ? true : domStar ? dowOk : dowStar ? domOk : domOk || dowOk;
    if (dayOk) return new Date(t);
  }
  throw new Error(`no cron occurrence within 366 days: ${cron}`);
}
```

- [ ] 4. Run the cron unit tests and confirm they pass.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test -- cron
```
Expected output: `Tests  4 passed (4)`.

- [ ] 5. Write the failing integration test for the scheduler. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/scheduler.test.ts`:

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

- [ ] 6. Run the test and confirm it fails.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
```
Expected failure: `does not provide an export named 'createScheduler'`.

- [ ] 7. Write the scheduler. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/scheduler.ts`:

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
  /** Default 10 seconds (contract §5). Only tests reduce it. */
  tickMs?: number;
  /** Task 20 wires up the kill switch. When absent, it is always treated as off. */
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
    // The claim statement from contract §5 verbatim. Zero rows means another tick/process already claimed it or it is not due yet.
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
      nextRunAt(cron, now()); // a malformed cron blows up at registration time
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
      // Wait a moment so an in-flight tick finishes while holding claimed_at.
      for (let i = 0; i < 100 && ticking; i += 1) {
        await new Promise((r) => setTimeout(r, 20));
      }
    },
  };
}
```

- [ ] 8. Add to the barrel. Add two lines to `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/index.ts`:

```ts
export { nextRunAt } from "./cron.js";
export { createScheduler } from "./scheduler.js";
export type { Scheduler, SchedulerDeps } from "./scheduler.js";
```

- [ ] 9. Run the tests and confirm they pass.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test
```
Expected output: `Tests  19 passed (19)` (cron 4 + events 6 + fanout 3 + scheduler 6).

- [ ] 10. Commit.

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-A06: scheduler (jobs table + 5-field cron runner)

- register/start/stop, 10-second tick, the claim UPDATE statement from contract §5 verbatim (at-most-once)
- After a run, updates last_run_at/last_status/last_error/next_run_at and clears claimed_at
- Run history is recorded as a cold-tier job.run event (master §7)
- The cron parser is hand-written: external dependencies forbidden (contract §1) + Asia/Seoul has no DST, so a fixed +9h is enough
- Seeded jobs with no registered handler are left untouched

Implemented-by: Claude Opus

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 15: scheduler-healthcheck-job (US-A06, tier: Opus)

**Story US-A06**'s "first job = healthcheck" part — creates the first handler the scheduler will actually have wired up. All 16 seeds in A3 §6 are loop and infrastructure jobs from Phase B onward, so they have no handler in Phase A. `hub_healthcheck` is not in the A3 seeds, so `register()` creates a new row.

**Read:** A6 §8 (healthchecks.io ping target table — this job is the Phase A stand-in for that slot), A3 §6 (`slot_health` is an infrastructure job owned by A3 and is separate), master §7 ("run history is recorded in events").

**Do NOT build (YAGNI):** healthchecks.io HTTP ping (A6's concern, add one line inside this handler once `HC_UUIDS` exists in Phase B), ntfy notifications, WAL slot checks (the `slot_health` job, Phase B), disk capacity checks.

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/jobs/healthcheck.ts`
- Modify: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/index.ts`
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/healthcheck-job.test.ts`

**Interfaces:**
- Consumes: `one` (`@omnis/db`) · `Events`, `Scheduler` (Task 12·14).
- Produces (`@omnis/kernel`): `HEALTHCHECK_JOB_NAME = "hub_healthcheck"` · `HEALTHCHECK_CRON = "*/5 * * * *"` · `registerHealthcheckJob(scheduler: Scheduler, deps: { pool: Pool; events: Events }): void`.

### Steps

- [ ] 1. Write the failing test. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/healthcheck-job.test.ts`:

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

- [ ] 2. Run the test and confirm it fails.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
```
Expected failure: `does not provide an export named 'registerHealthcheckJob'`.

- [ ] 3. Write the job. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/jobs/healthcheck.ts`:

```ts
import { one } from "@omnis/db";
import type { Pool } from "pg";
import type { Events } from "../events.js";
import type { Scheduler } from "../scheduler.js";

export const HEALTHCHECK_JOB_NAME = "hub_healthcheck";
export const HEALTHCHECK_CRON = "*/5 * * * *";

/** The first handler the scheduler hooks up (US-A06). It only checks that the DB is alive and the queue is not jammed. */
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

- [ ] 4. Add to the barrel:

```ts
export { HEALTHCHECK_CRON, HEALTHCHECK_JOB_NAME, registerHealthcheckJob } from "./jobs/healthcheck.js";
```

- [ ] 5. Run the tests and close the story with the US-A06 verification command.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
```
Expected output: `Tests  17 passed (17)` (events 6 + fanout 3 + scheduler 6 + healthcheck 2).

- [ ] 6. Commit.

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-A06: hub_healthcheck — the scheduler's first job

- registers on */5 * * * *, DB round trip + pending_approvals/due_jobs counts
- the result is left as a cold tier hub.health event
- the healthchecks.io ping is A6's concern, so it is not wired up

Implemented-by: Claude Opus

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 16: approvals-propose (US-A07, tier: Opus)

**Story US-A07** — Goal: approval gate API (`propose`/`decide` state transitions, porting HumanInterrupt/HumanResponse) / Outputs: `packages/kernel/src/approvals.ts` / Verification command: `pnpm --filter @omnis/kernel test:integration` / tier: Opus. Depends on: A03, A05.

**Prerequisite**: This task onward needs `@omnis/protocol` (US-A11). If `packages/protocol` is not in the workspace, do not start.

**Read:** contract §3.4 (`HumanInterrupt`/`HumanResponse` zod schema in full — the 6 values of `action`, the `config` defaults, `risk` defaulting to `normal`), contract §5 (`Approvals` interface + state transition comments), A3 §4 (`pending_approvals` DDL and constraint names), A3-D11 (the two columns `state` and `decision`), master §7 (every egress goes through this gate).

**`action` is the 6 values from A3** (contract §0-6): `send`, `delete`, `calendar_write`, `delegate`, `self_model_edit`, `memory_write`. The 4-value notation in the body of A7 §1 is not used here.

**Do not fire NOTIFY directly**: The `approvals_notify` trigger in `0007` already fires `omnis_approval` on INSERT. If `propose()` calls `events.emit("durable", ...)`, the same notification goes out twice — do not call it.

**Do NOT build (YAGNI):** the approval policy engine (per-channel and per-person "autonomous allow" is written in master §7 as a v1 feature, but it is not a Phase A story — the default is always approval), the expiry sweep job (Task 18 creates `expire()`, and the cron job that calls it is Phase B), the approval UI (US-A30), push notifications (A6).

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/approvals.ts`, `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/audit.ts` (types only — implementation is Task 21)
- Modify: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/package.json` (add the `@omnis/protocol` dependency), `/Users/logankim/AI-Workspaces/omnis/packages/kernel/tsconfig.json` (references), `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/index.ts`
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/approvals-propose.test.ts`

**Interfaces:**
- Consumes: `HumanInterrupt`, `HumanResponse`, `ApprovalAction`, `ApprovalState`, `ApprovalDecision`, `ApprovalRisk` (`@omnis/protocol`, contract §3.4) · `one`, `query` (`@omnis/db`) · `Audit` (Task 21 creates it — until then `propose` takes `deps.audit` as optional).
- Produces (`@omnis/kernel`): `interface PendingApproval { id, action, args, description, config, state, decision, decided_args, requested_by, thread_id, item_id, task_id, risk, expires_at, created_at, decided_at, executed_at, fail_reason }` · `class ApprovalStateError extends Error` (`name === "ApprovalStateError"`, contract §9) · `interface Approvals { propose(i): Promise<string>; decide(id, r): Promise<void>; list(f?): Promise<PendingApproval[]> }` — on top of this, `Approvals` in contract §5 requires 4 more methods, `beginExecution`/`completeExecution`/`failExecution`/`expire`, and Task 18 attaches those 4 to the same interface to close US-A07 · `createApprovals(deps: ApprovalsDeps): Approvals` · `interface ApprovalsDeps { pool: Pool; logger: Logger; now?: () => Date; audit?: Audit }`.

### Steps

- [ ] 1. Wire up the protocol dependency. Add one line to `dependencies` in `packages/kernel/package.json` and one entry to `references` in `tsconfig.json`.

```json
  "dependencies": { "@omnis/db": "workspace:*", "@omnis/protocol": "workspace:*", "pg": "8.13.1" },
```
```json
  "references": [{ "path": "../db" }, { "path": "../protocol" }]
```
Then install:
```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm install
```
Expected output: the `@omnis/protocol` link is created. If it fails, US-A11 has not been merged yet, so stop here.

- [ ] 2. Write the failing test. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/approvals-propose.test.ts`:

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
      args: { thread_id: "t", text: "Hello" },
      description: "Slack DM reply",
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
    expect(row.args.text).toBe("Hello");
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
        // @ts-expect-error — deliberately break the type to verify the runtime guard
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
      description: "Delegate to the MacBook Codex",
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

- [ ] 3. Run the test and confirm it fails.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
```
Expected failure: `does not provide an export named 'createApprovals'`.

- [ ] 4. Put down **only the audit types** first. `propose`/`decide` reference `Audit`, but Task 21 does the implementation, so create the interface file here and let Task 21 add `createAudit` to the same file. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/audit.ts`:

```ts
/** Contract §5. append-only; every egress must pass through it. Implementation is Task 21. */
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

- [ ] 5. Write `propose` and `list`. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/approvals.ts`:

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

/** 1:1 with a pending_approvals row (A3 §4). The type contract §5's Approvals.list returns. */
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
  /** Task 21 hooks up audit. Without it, audit recording is skipped (for test bootstrap). */
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
      // zod enforces the 6 action values, config, and the risk default. It blows up before reaching the DB.
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
      // The approvals_notify trigger in 0007 already fires NOTIFY — emitting here would send it twice.
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
      // A3 §12 (2): high risk first, then oldest first.
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

> Task 17 fills in `decide`. Leaving it as a `throw` here is not a placeholder but an **explicit not-implemented that necessarily throws when run** — Task 17's failing test fixes this statement. Do not skip Task 17 and merge.

- [ ] 6. Add to the barrel:

```ts
export { ApprovalStateError, createApprovals } from "./approvals.js";
export type { ApprovalConfig, Approvals, ApprovalsDeps, PendingApproval } from "./approvals.js";
```

- [ ] 7. Run the tests and confirm they pass.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
```
Expected output: the 4 propose tests + 2 list tests pass. `Tests  23 passed (23)`.

- [ ] 8. Do not commit — for US-A07, everything through Task 18 is a single atomic commit (A7-D8: one atomic commit per story). Move on to Task 17.

---

## Task 17: approvals-decide (US-A07, tier: Opus)

**Story US-A07** (continued) — `decide(id, HumanResponse)`: performs only the single `pending → decided` transition. `decision`/`decided_args`/`decided_at` must be filled in the same UPDATE to satisfy `approvals_decided_ck`.

**Read:** contract §3.4 (`HumanResponse = { decision, decided_args? }`, `decision ∈ accept|edit|respond|ignore`), contract §5 (`decide`: pending → decided), A3 §4 (`approvals_decided_ck`, `approvals_decision_ck`), A3 §11 (when `expires_at` has passed, `state='expired'`).

**config gate**: If `config.allow_edit=false` and `decision='edit'` arrives, it is an `ApprovalStateError`. This is why `HumanInterrupt.config` in `22` exists — apart from the UI hiding the button, the server must reject it.

**Do NOT build (YAGNI):** the follow-up turn that a `respond` decision produces (A4's concern), decision revocation, multiple approvers.

**Files:**
- Modify: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/approvals.ts`
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/approvals-decide.test.ts`

**Interfaces:**
- Consumes: `createApprovals`, `PendingApproval`, `ApprovalStateError` from Task 16.
- Produces: the actual behavior of `Approvals.decide`. No new exports.

### Steps

- [ ] 1. Write the failing test. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/approvals-decide.test.ts`:

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
    await approvals.decide(id, { decision: "edit", decided_args: { text: "revised draft" } });

    const row = await one<{
      state: string;
      decision: string;
      decided_args: Record<string, unknown>;
      decided_at: Date;
    }>(pool, `SELECT state, decision, decided_args, decided_at FROM pending_approvals WHERE id = $1`, [id]);
    expect(row.state).toBe("decided");
    expect(row.decision).toBe("edit");
    expect(row.decided_args.text).toBe("revised draft");
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

- [ ] 2. Run the test and confirm it fails.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
```
Expected failure: `ApprovalStateError: decide() is implemented in Task 17`.

- [ ] 3. Implement `decide`. Replace the `decide` method in `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/approvals.ts` wholesale.

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

      // state and decision must change in a single UPDATE to satisfy approvals_decided_ck.
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

- [ ] 4. Run the tests and confirm they pass.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
```
Expected output: `Tests  29 passed (29)`.

- [ ] 5. Do not commit — everything through Task 18 is the single commit for US-A07.

---

## Task 18: approvals-state-machine (US-A07, tier: Opus)

**Story US-A07** (wrap-up) — makes the full set of transitions written in contract §5 executable: `pending → decided → executing → executed | failed`, and `pending → expired`. The segment after `decided` is used by `runEgress` in Task 22.

**Read:** contract §5 (the one-line state transition comment), A3 §4 (`approvals_state_ck` 6 values, `approvals_decided_ck`), A3 §11 (when `expires_at` has passed, `state='expired'`; the row is kept), A3 §9 rule 5 (every `→ sent` transition is recorded in `audit_log` together with `approval_id`).

**The conflict between `expired` and `approvals_decided_ck` — how this task resolves it**: Since `CHECK ((state = 'pending') = (decision IS NULL))` holds, a `state='expired'` row must have a non-NULL `decision`. A3 §11's "when `expires_at` has passed, `state='expired'`" alone cannot pass the constraint. **Expiry is recorded together with `decision='ignore'`** — a person choosing nothing while time passes semantically means "ignore", and among the 4 values of `ApprovalDecision` this is the only one that fits. `decided_at` gets the expiry time, and `action='approval.expired'` in the audit log distinguishes a human decision from an expiry. (This judgment is not in the A3 body — raise it as an open question.)

**Do NOT build (YAGNI):** the expiry sweep cron job (Phase B layers `expire()` onto `followup_sweep`), `executing` timeout reclamation, a retry queue.

**Files:**
- Modify: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/approvals.ts`
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/approvals-state-machine.test.ts`

**Interfaces:**
- Consumes: `createApprovals`, `ApprovalStateError` from Tasks 16 and 17.
- Produces (`@omnis/kernel`, the remaining 4 methods of `Approvals` in contract §5 — they became part of the formal contract surface with the 2026-09-20 contract revision): `Approvals.beginExecution(id: string): Promise<PendingApproval>` · `Approvals.completeExecution(id: string): Promise<void>` · `Approvals.failExecution(id: string, reason: string): Promise<void>` · `Approvals.expire(id: string): Promise<boolean>`.

### Steps

- [ ] 1. Write the failing test. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/approvals-state-machine.test.ts`:

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

- [ ] 2. Run the test and confirm it fails.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
```
Expected failure: `approvals.beginExecution is not a function`.

- [ ] 3. Add 4 methods to the `Approvals` interface (replace the `export interface Approvals` block in `approvals.ts`):

```ts
export interface Approvals {
  propose(i: unknown): Promise<string>;
  decide(id: string, r: unknown): Promise<void>;
  list(f?: { state?: ApprovalState; thread_id?: string; limit?: number }): Promise<PendingApproval[]>;
  /** decided(accept|edit) → executing. If 0 rows, ApprovalStateError. Only runEgress calls it. */
  beginExecution(id: string): Promise<PendingApproval>;
  /** executing → executed */
  completeExecution(id: string): Promise<void>;
  /** executing → failed */
  failExecution(id: string, reason: string): Promise<void>;
  /** pending & expires_at <= now → expired(+decision='ignore'). true if it changed. */
  expire(id: string): Promise<boolean>;
}
```

- [ ] 4. Add the 4 implementations after `list` in the object `createApprovals` returns:

```ts
    async beginExecution(id) {
      // Executable only when decision is accept|edit. ignore/respond do not go out to the channel.
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
      // approvals_decided_ck requires a non-NULL decision on rows where state<>'pending'.
      // Nobody choosing while time passes = 'ignore'.
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

- [ ] 5. Run the tests and confirm they pass.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
```
Expected output: `Tests  35 passed (35)`.

- [ ] 6. Leave US-A07 as a single atomic commit (Task 16~18).

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-A07: approval gate API (propose/decide + full state transitions)

- propose: after HumanInterrupt zod validation, INSERT into pending_approvals; NOTIFY is handled by the 0007 trigger
- decide: pending → decided in a single UPDATE (approvals_decided_ck); a decision the config blocks raises ApprovalStateError
- Rejects expiry, already-decided approvals, and non-existent ids, each distinguished
- beginExecution/completeExecution/failExecution: decided(accept|edit) → executing → executed|failed, at-most-once claim
- expire: pending → expired + decision='ignore' (satisfies the constraint) + audit action='approval.expired'
- list: high risk first, then oldest first (A3 §12 (2))

Implemented-by: Claude Opus

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 19: kill-switch-audit-state (US-A08, tier: Opus)

**Story US-A08** — Goal: kill switch (global flag, checkpoints for every autonomous loop and egress) / Outputs: `packages/kernel/src/kill-switch.ts` / Verification command: `pnpm --filter @omnis/kernel test:integration` / tier: Opus. Depends on: A05.

**Read:** master §7 (kill switch — a single global flag stops every autonomous loop and egress; turned on from both the UI and the CLI), contract §5 (`KillSwitch` interface + **the state store is not a new table but `audit_log`** — the newest row with `action='kill_switch.set'`, `after={"on":bool,"reason":string}` is the current value; in-process cache + invalidation via the `omnis_control` NOTIFY), A3 §6.2 (the `omnis_control` channel payload `{"kill_switch":true|false}`).

**Why no new table** (the contract already decided this, but the implementer must know the reason): a switch change is itself an audit target, and since `audit_log` is append-only, the history of "who turned it off, when, and why" is left for free. Keeping a separate flag table would mean having to build that history all over again.

**Do NOT build (YAGNI):** switch scoping (per-channel / per-loop — the master pinned it down as "a single global flag"), an auto-release timer, a CLI binary (the hub HTTP `POST /kill-switch` appears in Task 24).

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/kill-switch.ts`
- Modify: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/index.ts`
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/kill-switch.test.ts`

**Interfaces:**
- Consumes: `query` (`@omnis/db`) · `Events` (Task 12) · `Audit` (the type from Task 16, the implementation from Task 21).
- Produces (`@omnis/kernel`): `class KillSwitchError extends Error` (`name === "KillSwitchError"`, contract §9) · `interface KillSwitch { isOn(): Promise<boolean>; set(on: boolean, reason: string): Promise<void>; assertOff(): Promise<void> }` · `createKillSwitch(deps: KillSwitchDeps): KillSwitch` · `killSwitchStatus(pool: Pool): Promise<{ on: boolean; since: string | null; reason: string | null }>` (used by the hub `GET /kill-switch`) · `interface KillSwitchDeps { pool: Pool; events: Events; audit: Audit; logger: Logger }`.

### Steps

- [ ] 1. Write the failing test. This test creates **two kernel instances** and verifies NOTIFY-based cache invalidation — the real situation where the hub and another process run together. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/kill-switch.test.ts`:

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
  await new Promise((r) => setTimeout(r, 300)); // time for LISTEN to take effect
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
    await a.set(true, "suspected injection — stop everything");
    expect(await a.isOn()).toBe(true);

    const row = await one<{ actor: string; after: { on: boolean; reason: string } }>(
      pool,
      `SELECT actor, after FROM audit_log WHERE action = 'kill_switch.set' ORDER BY seq DESC LIMIT 1`,
    );
    expect(row.actor).toBe("me");
    expect(row.after.on).toBe(true);
    expect(row.after.reason).toContain("injection");
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
    expect(await b.isOn()).toBe(false); // populates b's cache
    await a.set(true, "from process A");
    await new Promise((r) => setTimeout(r, 400));
    expect(await b.isOn()).toBe(true);
  });

  it("reports since and reason for the hub route", async () => {
    await a.set(true, "under maintenance");
    const status = await killSwitchStatus(pool);
    expect(status.on).toBe(true);
    expect(status.reason).toBe("under maintenance");
    expect(status.since).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    await a.set(false, "maintenance done");
    const off = await killSwitchStatus(pool);
    expect(off.on).toBe(false);
    expect(off.reason).toBe("maintenance done");
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

- [ ] 2. Run the test and confirm it fails.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
```
Expected failure: `does not provide an export named 'createKillSwitch'`. (`createAudit` is missing too, so either finish Task 21 first, or attach Task 21's 8-line `createAudit` first and come back — step 3 below does that.)

- [ ] 3. Attach Task 21's `createAudit` implementation now (it is 8 lines, and without it the kill switch cannot persist its state). Add below the type definitions in `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/audit.ts`:

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
Then add `export { createAudit } from "./audit.js"; export type { Audit, AuditEntry } from "./audit.js";` to the barrel. (Task 21 layers egress enforcement and tests on top of this implementation.)

- [ ] 4. Write the kill switch. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/kill-switch.ts`:

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

/** Read-only query used by the hub GET /kill-switch. The state is entirely the newest row of audit_log (contract §5). */
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

  // If another process touches the switch, drop the cache (contract §5).
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

- [ ] 5. Add to the barrel:

```ts
export { KillSwitchError, createKillSwitch, killSwitchStatus } from "./kill-switch.js";
export type { KillSwitch, KillSwitchDeps } from "./kill-switch.js";
```

- [ ] 6. Run the tests and confirm they pass.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
```
Expected output: `Tests  41 passed (41)`.

- [ ] 7. Do not commit — everything through Task 20 is the single commit for US-A08.

---

## Task 20: kill-switch-assert-off (US-A08, tier: Opus)

The "checkpoints for every autonomous loop and egress" part of **Story US-A08** — wires up and proves **what actually stops** when the switch is on. The only thing running autonomously in Phase A is the scheduler tick (adapters and the L3 loop are other plans), and egress is handled by Task 22.

**Read:** master §7 (what the kill switch stops), `SchedulerDeps.isKillSwitchOn` in Task 14 (the slot was opened ahead of time), A7 §7 common prohibitions (do not wire up an irreversible tool before the approval gate).

**Do NOT build (YAGNI):** aborting jobs already claimed (stopping from the next tick is enough), queueing requests while the switch is on, the UI banner (US-A24~A30).

**Files:**
- Modify: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/scheduler.ts` (comments only — `isKillSwitchOn` already exists in Task 14)
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/kill-switch-scheduler.test.ts`

**Interfaces:**
- Consumes: `createScheduler` (the `isKillSwitchOn` option, Task 14), `createKillSwitch` (Task 19).
- Produces: nothing (a wiring contract test).

### Steps

- [ ] 1. Write the test. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/kill-switch-scheduler.test.ts`:

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

- [ ] 2. Run the tests. Task 14 already added `isKillSwitchOn`, so they must pass right away — if they fail, Task 14's `tick()` dropped the gate.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
```
Expected output: `Tests  44 passed (44)`.

- [ ] 3. Change the `isKillSwitchOn` field comment in `scheduler.ts` to the final wording (so the next person knows why this gate lives here):

```ts
  /** master §7: a single kill switch stops every autonomous loop. The scheduler tick is the only autonomous loop in Phase A.
   *  A job already claimed runs to completion; from the next tick on, it stops. */
  isKillSwitchOn?: () => Promise<boolean>;
```

- [ ] 4. Leave US-A08 as a single atomic commit (Task 19~20).

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-A08: kill switch (global flag + autonomous loop checkpoint)

- The state store is not a new table but the latest kill_switch.set row in audit_log (contract §5)
- An in-process cache + omnis_control NOTIFY, which invalidates other processes' caches too
- assertOff() throws KillSwitchError
- The scheduler tick passes the gate every time — when it is on, even due jobs are not claimed
- killSwitchStatus(pool) reads since/reason (for the hub's GET /kill-switch)

Implemented-by: Claude Opus

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 21: audit-record (US-A09, tier: Opus)

**Story US-A09** — Goal: audit log middleware (enforcing that every egress goes through it) / Outputs: `packages/kernel/src/audit.ts` / Verification command: `pnpm --filter @omnis/kernel test:integration` / tier: Opus. Depends on: A04, A07.

This task closes the recording side (`Audit.record`), and Task 22 closes the enforcement side (`runEgress`).

**Read:** contract §5 (`AuditEntry` fields and the `actor` value shape `'me' | 'agent:${RuntimeKind}' | 'system'`), A3 §6 (`audit_log` DDL — no FK, and `approval_id` has no FK either), A3-D5 (UPDATE/DELETE/TRUNCATE permanently forbidden), A3 §9 rule 5 (**every `→ sent` transition is recorded together with `approval_id`. A sent without approval cannot exist, and a nightly job counts `sent but no approval_id`**), master §2 metric ("zero unapproved external sends").

**Do NOT build (YAGNI):** an audit log query API (A5's Settings screen, Phase B), a signature/hash chain (an append-only trigger + REVOKE is enough, A3-D5), retention roll-off (`audit_log` is retained forever, A3 §11), a structured `action` enum (a free-form string is the canonical source — A3 did not add a CHECK).

**Files:**
- Modify: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/audit.ts` (add batch helpers and invariant queries to the `createAudit` attached in Task 19)
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/audit.test.ts`

**Interfaces:**
- Consumes: `query` (`@omnis/db`).
- Produces (`@omnis/kernel`): `interface AuditEntry` · `interface Audit { record(e: AuditEntry): Promise<void> }` (contract §5) · `createAudit(pool: Pool): Audit` · `countUnapprovedSends(pool: Pool, since: Date): Promise<number>` (the nightly check query for A3 §9 rule 5 — if it is not 0, the master §2 metric is broken).

### Steps

- [ ] 1. Write a failing test. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/audit.test.ts`:

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

describe("countUnapprovedSends (A3 §9 rule 5 / master §2)", () => {
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

- [ ] 2. Run the test and confirm it fails.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
```
Expected failure: `does not provide an export named 'countUnapprovedSends'`.

- [ ] 3. Add the invariant query to `audit.ts` (below `createAudit`):

```ts
/** A3 §9 rule 5 / master §2: there must be zero unapproved external sends.
 *  The nightly digest job (Phase B) counts this value, and if it is not 0 it shows up in that day's digest. */
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
Then add `countUnapprovedSends` to the barrel.

- [ ] 4. Run the tests and confirm they pass.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
```
Expected output: `Tests  49 passed (49)`.

- [ ] 5. Do not commit — everything through Task 22 is the single US-A09 commit.

---

## Task 22: egress-middleware (US-A09, tier: Opus)

The heart of **Story US-A09** — "**enforce** that every egress goes through the audit log". Enforcement must be structure, not convention (master D10: by structure, not by prompt). This task also assembles `createKernel` (contract §5) — only now do all 6 pieces exist.

**Enforcement pattern — what blocks what**:
1. `runEgress(deps, spec, fn)` is the **only** execution path. The order is ① `killSwitch.assertOff()` → ② `approvals.beginExecution(approvalId)` (if not decided + accept|edit, `ApprovalStateError`) → ③ `fn(token)` → ④ on success `completeExecution` + `audit.record({approval_id})`, on failure `failExecution` + `audit.record`. The audit record sits on the `finally` path, so neither success nor failure can escape it.
2. `fn` receives an `EgressToken`, and this branded type is created only inside `runEgress`. Because the function that goes out to a channel (`createOutbox().send`) **requires the token as an argument**, code that calls it without an approval fails the typecheck.
3. The adapter instance is locked inside a closure by `createOutbox` and is not exported. The hub never holds a raw `Adapter` — there is no reference from which to call `adapter.send(...)` directly.

**Read:** master §7 (approval gate — every egress goes through `pending_approvals`), A7 §1 (`packages/agents` has no `send`/`delete`/`delegate`/`calendar_write` type at all, and it exists only in `packages/kernel`'s approval handlers), A3 §9 (draft transitions and rule 5), contract §3.3 (`Adapter.send` "is called only after approval"), contract §5 (the `Kernel` interface — `events/scheduler/approvals/killSwitch/audit/ingest/close`).

**Do NOT build (YAGNI):** real channel adapters (another plan), the outbox claim worker (A3 §9 rules 2·4 — the `followup_sweep` job is Phase B), retry backoff, person identity resolution (A3 §10 is not a Phase A story — the ingest sink leaves `author_person_id` NULL and does not resolve it even when an adapter supplies a `person` author), the `ingest.scan`/`ingest.read` RPCs (Phase B, A7 §7 seed note).

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/egress.ts`, `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/outbox.ts`, `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/ingest.ts`, `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/kernel.ts`
- Modify: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/index.ts`
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/egress.test.ts`, `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/kernel.test.ts`

**Interfaces:**
- Consumes: `Approvals`(+`beginExecution`/`completeExecution`/`failExecution`), `KillSwitch`, `Audit`, `Events`, `Scheduler` (Task 12~21) · `Adapter`, `ThreadRef`, `Outbound`, `SendResult`, `NormalizedItem`, `AdapterEvent`, `IngestSink` (`@omnis/protocol`).
- Produces (`@omnis/kernel`): `type EgressToken` (branded) · `interface EgressSpec { approvalId: string; actor: string; action: string; targetTable: string; targetId?: string }` · `runEgress<T>(deps: EgressDeps, spec: EgressSpec, fn: (t: EgressToken) => Promise<T>): Promise<T>` · `interface EgressDeps { approvals: Approvals; killSwitch: KillSwitch; audit: Audit }` · `createOutbox(deps: OutboxDeps): { send(t: EgressToken, ref: ThreadRef, draft: Outbound): Promise<SendResult> }` · `createIngestSink(deps: { pool: Pool; logger: Logger }): IngestSink` · `interface KernelDeps { pool: Pool; now?: () => Date; logger?: Logger }` · `createKernel(deps: KernelDeps): Kernel` · `interface Kernel { events; scheduler; approvals; killSwitch; audit; ingest: { sink: IngestSink }; close(): Promise<void> }` (exactly as in contract §5).

### Steps

- [ ] 1. Write a failing test. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/egress.test.ts`:

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
  args: { text: "Sending it" },
  description: "Send Slack reply",
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
      (token: EgressToken) => outbox.send(token, { accountId: "a", externalId: "C1" }, { text: "Sending it" }),
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
    // @ts-expect-error — calling it without a token does not compile. This is the enforcement device.
    void (() => outbox.send({ accountId: "a", externalId: "C1" }, { text: "x" }));
  });

  it("never leaks the raw adapter, so nothing can call send() directly", () => {
    expect(Object.keys(outbox)).toEqual(["send"]);
  });
});
```

- [ ] 2. Write the kernel assembly test. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/kernel.test.ts`:

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
    await kernel.ingest.sink(accountId, item("m-1", "first message"));
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
    expect(row.body).toBe("first message");
    expect(row.status).toBe("received");
    expect(row.author_person_id).toBeNull();
    expect(row.author_is_me).toBe(false);
    expect(row.thread_kind).toBe("dm");
  });

  it("is idempotent on source_hash and bumps threads.last_item_at", async () => {
    await kernel.ingest.sink(accountId, item("m-1", "first message"));
    const count = await one<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM items WHERE account_id=$1 AND source_hash='hash-m-1'`,
      [accountId],
    );
    expect(count.n).toBe("1");

    await kernel.ingest.sink(accountId, item("m-2", "second one"));
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

- [ ] 3. Run both tests and confirm they fail.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
```
Expected failure: `does not provide an export named 'runEgress'`.

- [ ] 4. Write the egress gate. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/egress.ts`:

```ts
import type { Approvals } from "./approvals.js";
import type { Audit } from "./audit.js";
import type { KillSwitch } from "./kill-switch.js";

declare const egressBrand: unique symbol;
/** Created only inside runEgress. The function that goes out to a channel requires this token as an argument, turning a bypass into a compile error. */
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

/** The only execution path for irreversible actions (master §7, A7 §1). Do not change the order. */
export async function runEgress<T>(
  deps: EgressDeps,
  spec: EgressSpec,
  fn: (token: EgressToken) => Promise<T>,
): Promise<T> {
  await deps.killSwitch.assertOff();
  await deps.approvals.beginExecution(spec.approvalId); // throws unless decided + accept|edit
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

- [ ] 5. Write the outbox. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/outbox.ts`:

```ts
import type { Adapter, Outbound, SendResult, ThreadRef } from "@omnis/protocol";
import type { EgressToken } from "./egress.js";

export interface OutboxDeps {
  /** channel → adapter. This Map does not leave the closure. */
  adapters: ReadonlyMap<string, Adapter>;
}

export interface Outbox {
  send(token: EgressToken, ref: ThreadRef, draft: Outbound): Promise<SendResult>;
}

/** The only point that reaches a channel send(). Without a token it does not compile, and the adapter does not leak out. */
export function createOutbox(deps: OutboxDeps): Outbox {
  const { adapters } = deps;
  return {
    async send(token, ref, draft) {
      void token; // its very existence is the evidence of approval
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

> The rule for choosing a channel from `accountId` has no canonical source yet, because Phase A has no adapters at all. The adapter plan (US-A12~A15) replaces it with a real `accounts` lookup — until then the `adapters` Map holds exactly 1 entry, so the behavior is deterministic.

- [ ] 6. Write the ingest sink. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/ingest.ts`:

```ts
import { one, query, tx } from "@omnis/db";
import type { AdapterEvent, IngestSink, NormalizedItem } from "@omnis/protocol";
import type { Pool } from "pg";
import type { Logger } from "./logger.js";

function isItem(e: NormalizedItem | AdapterEvent): e is NormalizedItem {
  return "threadExternalId" in e;
}

/** The only entry point adapters push into (contract §3.3 IngestSink).
 *  Phase A goes only as far as the thread/item upsert — person identity resolution (A3 §10) is not a Phase A story, so
 *  it does not populate author_person_id. Even when an adapter supplies a person author, it stays NULL. */
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

      // resolve only author_agent_id. person is Phase B (A3 §10).
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

- [ ] 7. Assemble the kernel. `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/kernel.ts`:

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

- [ ] 8. Update the barrel:

```ts
export { runEgress } from "./egress.js";
export type { EgressDeps, EgressSpec, EgressToken } from "./egress.js";
export { createOutbox } from "./outbox.js";
export type { Outbox, OutboxDeps } from "./outbox.js";
export { createIngestSink } from "./ingest.js";
export { createKernel } from "./kernel.js";
export type { Kernel, KernelDeps } from "./kernel.js";
```

- [ ] 9. Run the tests and confirm they pass.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration && pnpm typecheck
```
Expected output: `Tests  62 passed (62)`, 0 typecheck errors. (The bypass-attempt test carrying `@ts-expect-error` **passes only if compilation fails** — if the typecheck passes, the enforcement device is alive.)

- [ ] 10. Leave US-A09 as a single atomic commit (Task 21~22).

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-A09: audit log + the enforcement gate every egress goes through

- createAudit: append-only INSERT into audit_log, preserving a target_id/approval_id with no FK as-is
- countUnapprovedSends: the check query for A3 §9 rule 5 / master §2 'zero unapproved external sends'
- runEgress: killSwitch.assertOff → beginExecution → fn → completeExecution|failExecution + audit(approval_id)
- Triple bypass prevention: only runEgress mints an EgressToken, outbox.send requires the token, and the adapter does not leave the closure
- createKernel: events/scheduler/approvals/killSwitch/audit/ingest/close (exactly as in contract §5)
- ingest.sink: thread/item upsert + source_hash idempotency, AdapterEvent goes to the cold tier

Implemented-by: Claude Opus

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 23: hub-bootstrap (US-A10, tier: Sonnet)

**Story US-A10** — Goal: `apps/hub` bootstrap (kernel initialization, Postgres connection, graceful shutdown) / Outputs: `apps/hub/src/main.ts` / Verification command: `pnpm --filter @omnis/hub build` / tier: Sonnet. Depends on: A05~A09.

**Read:** master §4.2 (the hub binds only to `127.0.0.1:8787`, Tailscale Serve exposes it at `/api/`, 8642 is Hermes), contract §5 (hub HTTP surface table), contract §9 (env vars `DATABASE_URL`·`OMNIS_HUB_PORT=8787`, log format), A6 §3 (`tailscale serve --https=443 /api/ localhost:8787/`).

**Do NOT build (YAGNI):** Express/Fastify (a framework is overkill for 5 routes — `node:http` is enough, and contract §1 pins `apps/hub`'s dependencies to `packages/*`), automatic migration at boot (`pnpm db:migrate` is a separate step — if the hub modified the schema, A3's ownership would collapse), adapter registration (another plan), the WS `/bridge` implementation (US-A17), CORS (loopback only), auth (the tailnet boundary is the auth — A6 §3).

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/apps/hub/package.json`, `/Users/logankim/AI-Workspaces/omnis/apps/hub/tsconfig.json`, `/Users/logankim/AI-Workspaces/omnis/apps/hub/vitest.config.ts`, `/Users/logankim/AI-Workspaces/omnis/apps/hub/src/config.ts`, `/Users/logankim/AI-Workspaces/omnis/apps/hub/src/main.ts`
- Modify: `/Users/logankim/AI-Workspaces/omnis/tsconfig.json`
- Test: `/Users/logankim/AI-Workspaces/omnis/apps/hub/test/config.test.ts`

**Interfaces:**
- Consumes: `createPool` (`@omnis/db`) · `createKernel`, `createLogger`, `registerHealthcheckJob` (`@omnis/kernel`).
- Produces (`@omnis/hub`, internal only): `interface HubConfig { port: number; host: "127.0.0.1"; version: string }` · `readConfig(env?: NodeJS.ProcessEnv): HubConfig` · `startHub(): Promise<{ close(): Promise<void> }>` (Tasks 24·25 fill it in).

### Steps

- [ ] 1. Create the package skeleton.

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

Root `tsconfig.json`:
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

- [ ] 2. Write a failing test. `/Users/logankim/AI-Workspaces/omnis/apps/hub/test/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readConfig } from "../src/config.js";

describe("readConfig", () => {
  it("binds the loopback address and port 8787 by default (master §4.2)", () => {
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

- [ ] 3. Run the test and confirm it fails.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm install && pnpm --filter @omnis/hub test
```
Expected failure: `Cannot find module '../src/config.js'`.

- [ ] 4. Write the config. `/Users/logankim/AI-Workspaces/omnis/apps/hub/src/config.ts`:

```ts
export interface HubConfig {
  port: number;
  host: "127.0.0.1";
  version: string;
}

export const HUB_VERSION = "0.1.0";

/** master §4.2: the hub binds only to 127.0.0.1:8787. Tailscale Serve exposes it at /api/. */
export function readConfig(env: NodeJS.ProcessEnv = process.env): HubConfig {
  if (env.DATABASE_URL === undefined || env.DATABASE_URL === "") {
    throw new Error("DATABASE_URL is required (contract §9)");
  }
  const raw = env.OMNIS_HUB_PORT ?? "8787";
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`OMNIS_HUB_PORT must be an integer port, got ${raw}`);
  }
  if (port === 8642) {
    throw new Error("port 8642 belongs to Hermes api_server (master §4.2) — pick another");
  }
  return { port, host: "127.0.0.1", version: HUB_VERSION };
}
```

- [ ] 5. Write the bootstrap. Task 24 attaches the HTTP server, so for now it only starts the kernel. `/Users/logankim/AI-Workspaces/omnis/apps/hub/src/main.ts`:

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

// Boot only when run directly (tests import startHub).
if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  await startHub();
}
```

- [ ] 6. Run the tests and the build.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/hub test && pnpm --filter @omnis/hub build
```
Expected output: `Tests  4 passed (4)`, 0 build errors.

- [ ] 7. Do not commit — everything through Task 26 is the single US-A10 commit.

---

## Task 24: hub-http-routes (US-A10, tier: Sonnet)

**Story US-A10** (continued) — opens the 5 hub HTTP surface routes of contract §5 with `node:http`.

| Method·path | body | response |
|---|---|---|
| `GET /health` | — | `{ ok, version, db: "up"\|"down", uptimeSec, killSwitch }` |
| `GET /approvals?state=pending&limit=50` | — | `{ approvals: PendingApproval[] }` |
| `POST /approvals/:id/decide` | `HumanResponse` | `{ id, state: "decided" }` |
| `GET /kill-switch` | — | `{ on, since, reason }` |
| `POST /kill-switch` | `{ on, reason }` | `{ on, since }` |

**Read:** contract §5 (the table above is the canonical source), the end of contract §5 (`GET /search`·`GET /memory/search`·`GET /transcript/:session_id` are owned by other appendices and are therefore out of Phase A scope — do not open them), A6 §3 (the external path is `https://<mini>.ts.net/api/...` and Tailscale does the mounting — the hub does not know about the `/api` prefix).

**Do NOT build (YAGNI):** a router library, an OpenAPI spec, rate limiting (loopback), pagination cursors (`limit` is enough), the `/bridge` WS implementation (**Task 26** plugs it into the same `onUpgrade` hook — contract §5 pinned the server implementation owner to this plan. The agent-bridge plan builds only the dialing client).

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/apps/hub/src/http.ts`
- Modify: `/Users/logankim/AI-Workspaces/omnis/apps/hub/src/main.ts`
- Test: `/Users/logankim/AI-Workspaces/omnis/apps/hub/test/integration/routes.test.ts`

**Interfaces:**
- Consumes: `Kernel`, `killSwitchStatus`, `ApprovalStateError` (`@omnis/kernel`) · `HubConfig` (Task 23).
- Produces (`@omnis/hub`): `createHubServer(deps: { kernel: Kernel; pool: Pool; config: HubConfig; logger: Logger; startedAt: number; onUpgrade?: (req, socket, head) => void }): http.Server`.

### Steps

- [ ] 1. Write a failing test. `/Users/logankim/AI-Workspaces/omnis/apps/hub/test/integration/routes.test.ts`:

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

- [ ] 2. Run the tests and confirm they fail.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/hub test:integration
```
Expected failure: `Cannot find module '../../src/http.js'`.

- [ ] 3. Write the HTTP surface. `/Users/logankim/AI-Workspaces/omnis/apps/hub/src/http.ts`:

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
  /** Task 26 (hub-bridge-ws) plugs the /bridge WS in here. If it is not injected, upgrades get a 501. */
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

    // /search, /memory/search, /transcript/:id are owned by other appendices (contract §5) — Phase A does not open them.
    return send(res, 404, { error: "not found" });
  }

  server.on("upgrade", (req, socket, head) => {
    if (deps.onUpgrade !== undefined) {
      deps.onUpgrade(req, socket, head as Buffer);
      return;
    }
    // WS /bridge is attached by Task 26.
    socket.write("HTTP/1.1 501 Not Implemented\r\n\r\n");
    socket.destroy();
  });

  return server;
}
```

- [ ] 4. Fix `main.ts` so it starts the server. After `registerHealthcheckJob` in `startHub` insert the following and add `port` to `RunningHub`:

```ts
  const startedAt = Date.now();
  const server = createHubServer({ kernel, pool, config, logger, startedAt });
  await new Promise<void>((resolve) => server.listen(config.port, config.host, resolve));
```
Then put `await new Promise<void>((r) => server.close(() => r()));` on the first line of `close()` (Task 25 refines this spot further). Add `import { createHubServer } from "./http.js";` at the top of the file.

- [ ] 5. Run the tests and confirm they pass.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/hub test:integration
```
Expected output: `Tests  9 passed (9)`.

- [ ] 6. Do not commit — Task 26 closes US-A10.

---

## Task 25: graceful-shutdown (US-A10, tier: Sonnet)

**Story US-A10** (wrap-up) — on SIGTERM/SIGINT, stop accepting new requests, let the scheduler's in-flight jobs finish, close the LISTEN connection and the pool, and force exit if that still does not finish. When LaunchDaemon restarts the hub, there must be no jobs left with `claimed_at` set (so it does not depend on the 5-minute sweep in A3 §9 rule 4).

**Read:** A6 §1 (LaunchDaemon sends SIGTERM), contract §5 (`Kernel.close()`), Task 14's `Scheduler.stop()` (waits for the in-flight tick), A3 §9 rule 4 (a claim left in `approved` for more than 5 minutes is treated as a crash).

**Do NOT build (YAGNI):** 503 responses during drain (loopback clients retry), a draining state on the health endpoint, reclaiming stale claims on restart (the `followup_sweep` job, Phase B), a systemd-style readiness file.

**Files:**
- Modify: `/Users/logankim/AI-Workspaces/omnis/apps/hub/src/main.ts`
- Test: `/Users/logankim/AI-Workspaces/omnis/apps/hub/test/integration/shutdown.test.ts`

**Interfaces:**
- Consumes: Task 23's `startHub`, Task 24's `createHubServer`.
- Produces (`@omnis/hub`): `RunningHub { config: HubConfig; port: number; close(): Promise<void> }` · `installSignalHandlers(hub: RunningHub, logger: Logger, forceExitMs?: number): () => void`.

### Steps

- [ ] 1. Write a failing test. Start a real process and send it SIGTERM — signal handling cannot be proven in-process. `/Users/logankim/AI-Workspaces/omnis/apps/hub/test/integration/shutdown.test.ts`:

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

- [ ] 2. Run the test and confirm it fails.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/hub test:integration
```
Expected failure: after SIGTERM the process does not die, so either `hub never became healthy` or an exit code of `143` (no handler).

- [ ] 3. Finish `main.ts`. `/Users/logankim/AI-Workspaces/omnis/apps/hub/src/main.ts` in full:

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
        // 1) Do not accept new connections. Keep-alive ones are cut immediately.
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeIdleConnections();
          setTimeout(() => server.closeAllConnections(), 2000).unref();
        });
        // 2) Stop the scheduler and wait for the in-flight tick to release claimed_at and finish (Task 14's stop()).
        // 3) Drop the LISTEN connection.
        await kernel.close();
        await kernel.audit.record({ actor: "system", action: "hub.stopped", target_table: "jobs" });
        await pool.end();
        logger.info("hub stopped");
      })();
      return closing;
    },
  };
}

/** SIGTERM/SIGINT → close(). If it does not finish within 10 seconds, force exit (LaunchDaemon restarts it). */
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

> `audit.record({action:'hub.stopped'})` must come **before** `pool.end()` — swapping the order makes the record disappear. The test pins this order.

- [ ] 4. Run the tests and confirm they pass.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/hub test:integration
```
Expected output: `Tests  12 passed (12)`.

- [ ] 5. Run the US-A10 verification command and the full regression.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/hub build && pnpm typecheck && pnpm lint && pnpm test && pnpm test:integration
```
Expected output: zero build, typecheck, and lint errors; `pnpm test` and `pnpm test:integration` all pass.

- [ ] 6. Do not commit — for US-A10, the work through Task 26 (`hub-bridge-ws`) is a single atomic commit (A7-D8: one atomic commit per story). Contract §10 lists US-A10's tasks as four: `hub-bootstrap` · `hub-http-routes` · `graceful-shutdown` · `hub-bridge-ws`.

---

## Task 26: hub-bridge-ws (US-A10, tier: Opus)

**Story US-A10** (wrap-up 2) — open the last row of contract §5, `WS /bridge`. **This plan owns the server implementation** (contract §5·§10, cross-check M6). `2026-09-20-phase-a-agent-bridge.md` only builds the **client** that dials into it — that plan has no step that touches `apps/hub`. It plugs into the `onUpgrade` hook Task 24 left behind.

**Read:** contract §3.5 (the bridge protocol in full — `HUB_METHODS`/`BRIDGE_METHODS`/`BRIDGE_ERRORS`/`JSONRPC_ERRORS`/`withMeta`/`assertProtocolVersion`/`toJsonRpcError`), contract §5 (the `WS /bridge` row + `Approvals`), contract §8 (the parameter shapes of `session.create`/`turn.start`/`approval.requested`; `ingest.*` is Phase B), A2 §3 (JSON-RPC direction and errors), A3 §4 (`agent_runtimes`/`agent_sessions` columns), contract §9 (bridge token `omnis.bridge.token.<host>`).

**Do NOT build (YAGNI):** spawning runtime child processes (US-A18/A19 does that on the bridge side), the write path that turns `turn.item.*` into `items` rows (US-A18/A19), `ingest.scan`/`ingest.read` (Phase B — calling them is rejected immediately with `CAPABILITY_UNSUPPORTED`), reconnect backoff (the client's job, contract §8), outbox replay (the client's job), multiplexing/compression, mTLS (Tailscale provides transport trust — the token is a second gate on top of it).

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/apps/hub/src/bridge.ts`
- Modify: `/Users/logankim/AI-Workspaces/omnis/apps/hub/package.json`, `/Users/logankim/AI-Workspaces/omnis/apps/hub/src/config.ts`, `/Users/logankim/AI-Workspaces/omnis/apps/hub/src/main.ts`
- Test: `/Users/logankim/AI-Workspaces/omnis/apps/hub/test/integration/bridge.test.ts`

**Interfaces:**
- Consumes: `Kernel` (`approvals`·`events`), `Logger` (`@omnis/kernel`) · `query` (`@omnis/db`) · `HUB_METHODS`, `BRIDGE_ERRORS`, `JSONRPC_ERRORS`, `BridgeError`, `BridgeErrorCode`, `HostId`, `RuntimeKind`, `HumanInterrupt`, `HumanResponse`, `PROTOCOL_VERSION`, `assertProtocolVersion`, `toJsonRpcError`, `withMeta` (`@omnis/protocol`, contract §3.4·§3.5).
- Produces (`@omnis/hub`): `createBridgeHub(deps: BridgeDeps): BridgeHub` · `interface BridgeHub { handleUpgrade(req, socket, head): void; call<T>(host: HostId, method: HubMethod, params: Record<string, unknown>): Promise<T>; hosts(): HostId[]; close(): Promise<void> }` · `interface BridgeDeps { kernel: Kernel; pool: Pool; logger: Logger; token: string; heartbeatMs?: number; callTimeoutMs?: number }`.

**New environment variable**: `OMNIS_BRIDGE_TOKEN` — the A6 wrapper injects the value from Keychain `omnis.bridge.token.<host>` (the same path as `DATABASE_URL`). The hub never reads Keychain directly. If it is empty, every `/bridge` upgrade is closed with 503 — no bridge exists that is open without a token.

### Steps

- [ ] 1. Add `ws` to `apps/hub`'s dependencies. Replace `dependencies`/`devDependencies` in `/Users/logankim/AI-Workspaces/omnis/apps/hub/package.json` with the following.

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
Expected output: an install summary including `+ ws 8.18.0`, zero errors.

- [ ] 2. Write a failing integration test. Start a real `ws` client and prove the register → discover round trip and the approval round trip. `/Users/logankim/AI-Workspaces/omnis/apps/hub/test/integration/bridge.test.ts`:

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
    // The port is decided by listen(0) below. readConfig only accepts 1..65535, so give it a valid value.
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

/** Mini bridge client for tests: sends notifications, and answers the hub's requests via handlers. */
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
            args: { text: "sending it" },
            description: "1 Slack reply",
            config: { allow_accept: true, allow_edit: true, allow_respond: false, allow_ignore: true },
          },
          _meta: { "ai.omnis/protocolVersion": PROTOCOL_VERSION },
        },
      }),
    );

    const id = await until(async () => {
      const rows = await kernel.approvals.list({ state: "pending", limit: 50 });
      return rows.find((a) => a.description === "1 Slack reply")?.id ?? null;
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

- [ ] 3. Run the test and confirm it fails.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/hub test:integration
```
Expected failure: `Cannot find module '../../src/bridge.js'`.

- [ ] 4. Write the bridge server. `/Users/logankim/AI-Workspaces/omnis/apps/hub/src/bridge.ts`:

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

/** contract §3.5 SessionState → A3 §4 agent_sessions.state. The two enums have different names. */
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
  /** The value of Keychain omnis.bridge.token.<host> (the A6 wrapper injects it as OMNIS_BRIDGE_TOKEN). An empty string closes the bridge. */
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

  // ---- bridge → hub notifications ----

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
      // The hub creates the row first with session.create (Phase B). For now, sessions it does not know are dropped silently.
      logger.warn("session.registered for an unknown session_key", { runtime, host, sessionKey });
    }
    // NOTIFY is fired by the sessions_notify trigger in 0007 — emitting here would send it twice.
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
      // A decision may have landed between propose and subscribe — read it directly once.
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

  // ---- dispatch ----

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
      // Ephemeral fan-out only (A3-D14). Writing items rows is done by US-A18/A19 on the bridge client side.
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

    // Response to a hub → bridge request
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

  // ---- upgrade ----

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
      throw new BridgeError(BRIDGE_ERRORS.CAPABILITY_UNSUPPORTED, `${method} is Phase B (contract §8)`);
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

> `turn.item.delta` is emitted only via `emit("ephemeral", …)` — it creates neither a row nor a NOTIFY (contract §3.5, A3-D14). The absence of `turn.*` from `DURABLE_CHANNEL` is not an oversight but this rule.

- [ ] 5. Add the bridge token to the config. Fix `HubConfig` and the `readConfig` return value in `/Users/logankim/AI-Workspaces/omnis/apps/hub/src/config.ts`.

```ts
export interface HubConfig {
  port: number;
  host: "127.0.0.1";
  version: string;
  /** The A6 wrapper injects the value of Keychain omnis.bridge.token.<host>. An empty string closes WS /bridge. */
  bridgeToken: string;
}
```
Then replace `return { port, host: "127.0.0.1", version: HUB_VERSION };` with the following:
```ts
  return { port, host: "127.0.0.1", version: HUB_VERSION, bridgeToken: env.OMNIS_BRIDGE_TOKEN ?? "" };
```

- [ ] 6. Wire the bridge into `main.ts`. Create the bridge **before** the `createHubServer` call and pass it as `onUpgrade`, then in `close()` call `bridge.close()` right after closing the server.

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
Add `import { createBridgeHub } from "./bridge.js";` at the top of the file, and put `await bridge.close();` on the line right after `await new Promise<void>((r) => server.close(() => r()));` in `close()` (before `kernel.close()` — bridge requests waiting on approval must be woken first before the kernel's LISTEN connection can be closed).

- [ ] 7. Run the tests and confirm they pass.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/hub test:integration
```
Expected output: `Tests  19 passed (19)` (Task 24's 9 + Task 25's 3 + these 7).

- [ ] 8. Confirm once more against a running hub that `WS /bridge` never opens without a token.

```bash
cd /Users/logankim/AI-Workspaces/omnis && DATABASE_URL=postgres://logan@127.0.0.1:5432/omnis OMNIS_BRIDGE_TOKEN=local-dev-token pnpm --filter @omnis/hub exec tsx src/main.ts & sleep 3
curl -si -N -H 'connection: Upgrade' -H 'upgrade: websocket' -H 'sec-websocket-version: 13' -H 'sec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==' -H 'x-omnis-host: macbook' http://127.0.0.1:8787/bridge | head -1
curl -si -N -H 'connection: Upgrade' -H 'upgrade: websocket' -H 'sec-websocket-version: 13' -H 'sec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==' -H 'x-omnis-host: macbook' -H 'authorization: Bearer local-dev-token' http://127.0.0.1:8787/bridge | head -1
kill %1
```
Expected output: first line `HTTP/1.1 401 Unauthorized`, second line `HTTP/1.1 101 Switching Protocols`.

- [ ] 9. Run the full regression.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/hub build && pnpm typecheck && pnpm lint && pnpm test && pnpm test:integration
```
Expected output: zero build, typecheck, and lint errors; `pnpm test` and `pnpm test:integration` all pass.

- [ ] 10. Leave US-A10 as a single atomic commit (Tasks 23~26).

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-A10: apps/hub bootstrap + HTTP surface + WS /bridge + graceful shutdown

- readConfig: pin 127.0.0.1, OMNIS_HUB_PORT defaults to 8787, reject 8642 (Hermes), inject OMNIS_BRIDGE_TOKEN
- startHub: createPool → createKernel → register hub_healthcheck → scheduler.start → bridge → listen
- 5 HTTP endpoints (node:http): GET /health, GET /approvals, POST /approvals/:id/decide, GET/POST /kill-switch
- Paths owned by other appendices (/search, /memory/search, /transcript/:id) return 404
- WS /bridge (contract §5, this plan owns the server implementation): Bearer token + x-omnis-host validation, JSON-RPC 2.0,
  receives runtime.registered/session.registered/health/turn.*/approval.requested, sends HUB_METHODS such as bridge/discover,
  approval.requested → pending_approvals → wait for decision → HumanResponse reply, 30s ping/pong heartbeat
- A protocol version mismatch rejects only that request with -32010, not the connection (A2-D3)
- ApprovalStateError → 409, invalid body → 400
- SIGTERM/SIGINT: block connections → scheduler.stop (release claims) → bridge.close → kernel.close → hub.stopped audit → pool.end
- pnpm --filter @omnis/hub build passes

Implemented-by: Claude Opus

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 27: ci (A7 §6, tier: Sonnet)

**No story** — the `.github/workflows/ci.yml` required by A7 §6/A7-D7 was not assigned to any of the six plans (cross-check M13). This plan creates it as the last Phase A task. Since there is no story id, the commit subject uses the prefix `A7-§6:` instead of `<story-id>:`.

**Read:** A7 §6 (the CI paragraph — lint+typecheck+unit always, integration behind a path filter), A7-D7 (the path filter list), contract §2 (Postgres 17 + pgvector, test DB `omnis_test`, `DATABASE_URL` default), Task 2's `vitest.global-setup.ts` (refuses anything that is not `omnis_test`).

**Do NOT build (YAGNI):** a macOS-runner Tauri build job (A7 §6 lists it, but `apps/desktop` is created outside this plan in Phase A — the desktop plan appends one job to this file), release/signing workflows (Phase D), coverage upload, cache tuning, a matrix (a single Node 22).

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/.github/workflows/ci.yml`

**Interfaces:**
- Consumes: root scripts `lint`/`typecheck`/`test`/`test:integration` (Task 1).
- Produces: the GitHub Actions workflow `ci` (no TS export).

### Steps

- [ ] 1. Write the workflow. `/Users/logankim/AI-Workspaces/omnis/.github/workflows/ci.yml`:

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
          # A7-D7: the integration job runs only when these paths change.
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
      # Only the unit project, which runs without a container (contract §2). The job below handles integration.
      - run: pnpm test

  integration:
    name: integration (postgres 17 + pgvector)
    runs-on: ubuntu-latest
    needs: [changes, check]
    if: needs.changes.outputs.backend == 'true'
    services:
      postgres:
        # pgvector/pgvector:pg17 = the official postgres:17 + the vector extension. pgcrypto/pg_trgm are already included via contrib.
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
      # vitest.global-setup.ts refuses without dropping the schema if the URL does not contain omnis_test.
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

- [ ] 2. Confirm the YAML parses and that the three jobs and the pins are unchanged.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm dlx js-yaml .github/workflows/ci.yml | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const w=JSON.parse(s);console.log(Object.keys(w.jobs).join(','));console.log(w.jobs.integration.services.postgres.image);console.log(w.jobs.check.steps.filter(x=>x.run).map(x=>x.run).join('|'));});"
```
Expected output:
```
changes,check,integration
pgvector/pgvector:pg17
pnpm install --frozen-lockfile|pnpm lint|pnpm typecheck|pnpm test
```

- [ ] 3. Confirm that every root script the workflow calls actually exists (to prevent typos).

```bash
cd /Users/logankim/AI-Workspaces/omnis && node -e "const s=require('./package.json').scripts; for (const k of ['lint','typecheck','test','test:integration']) { if (!s[k]) { console.error('missing script: '+k); process.exit(1); } } console.log('all 4 root scripts present');"
```
Expected output: `all 4 root scripts present`.

- [ ] 4. Run the same sequence as CI once locally (to prevent the first breakage from happening on the runner).

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration
```
Expected output: all five commands exit 0.

- [ ] 5. Commit.

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "A7-§6: GitHub Actions CI — lint/typecheck/unit always + Postgres 17 integration

- check job: pnpm install --frozen-lockfile → lint(Biome) → typecheck(tsc --build --force) → test(vitest run)
- integration job: pgvector/pgvector:pg17 service container, DATABASE_URL points at omnis_test
- A7-D7 path filter (dorny/paths-filter): integration only when packages/db·packages/kernel·packages/memory·apps/hub change
- pinned to pnpm 9.12.3 / Node 22 (contract §2)
- the macOS Tauri job is appended by the desktop plan when apps/desktop appears

Implemented-by: Claude Sonnet

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Definition of done

When the whole plan is finished, all of the following must be true.

- [ ] Running `pnpm db:migrate` twice in a row makes the second run say `up to date` (A3 §8's full runner test).
- [ ] `packages/db/migrations/` contains 8 files, `0001` through `0008`, and nothing else (A3 §8 = the complete v1 table list).
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm test:integration` all pass.
- [ ] Start `apps/hub` and run `curl -s http://127.0.0.1:8787/health | jq`; you get `{"ok":true,"version":"0.1.0","db":"up",...}`.
- [ ] After `curl -s -X POST http://127.0.0.1:8787/kill-switch -H 'content-type: application/json' -d '{"on":true,"reason":"manual check"}'`, the scheduler log shows `scheduler tick skipped: kill switch is on`.
- [ ] `grep -rn "adapter.send\|\.send(" packages/kernel/src | grep -v outbox.ts` is empty — meaning the only code that reaches channel delivery is `outbox.ts`.
- [ ] `psql omnis -c "SELECT count(*) FROM audit_log WHERE action='item.sent' AND approval_id IS NULL"` is 0 (master §2 metric).
- [ ] Attempting a `/bridge` upgrade against a hub started without `OMNIS_BRIDGE_TOKEN` gives `503`, a wrong token gives `401`, and the right token plus `x-omnis-host: macbook` gives `101 Switching Protocols` (Task 26 step 8).
- [ ] `grep -rn "zero_replication" packages apps` is empty — the only replication role name is `omnis_sync`.
- [ ] `git log --format=%B | grep -c "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"` equals the number of commits this plan produced — every commit's last line is the session-rule trailer, and the `Implemented-by:` line is in the body.
- [ ] `.github/workflows/ci.yml` exists and `pnpm dlx js-yaml .github/workflows/ci.yml` prints the three jobs `changes`/`check`/`integration`.
- [ ] After the first push, the `check` job in GitHub Actions is green, and a push that includes an `apps/hub` change also runs the `integration` job (A7-D7 path filter).

---

## Revision history (2026-09-20, cross-plan review)

The §1 discrepancy table and §2 contract revisions (2026-09-20 final) from `2026-09-20-plans-review.md` were applied to this plan.

- **M1·M3·M4** — Made Task 1 the **sole owner** of the root files (`package.json`·`pnpm-workspace.yaml`·`tsconfig.base.json`·`biome.jsonc`·`vitest.workspace.ts`), and pinned the versions in one block: `vitest 2.1.9` · `typescript 5.6.3` · `pg 8.13.1` · `packageManager pnpm@9.12.3` · `zod ^3.24.1` (zod 4 forbidden) · `@rocicorp/zero 1.9.0` exact · `ai 7.0.107`. The other five plans do not create the root scaffold and only check it with `test -f`.
- **M4(b)** — Lowered `biome.jsonc`'s `lineWidth` from 110 to **100** (contract §2 final value). `tsconfig.base.json` was kept with `strict`·`noUncheckedIndexedAccess`·`exactOptionalPropertyTypes`·`verbatimModuleSyntax`·`isolatedModules`·`noImplicitOverride` all included.
- **M5** — Added `dev` (hub+desktop at the same time via `concurrently`, with the `concurrently 9.1.0` pin added) · `tauri:dev` · `tauri:build` to the root `scripts`, and changed `db:migrate`/`db:migrate:create` from directly invoking `tsx packages/db/src/cli/*.ts` to **`pnpm --filter @omnis/db migrate`** (contract §2). Accordingly, added the `migrate`/`migrate:create` scripts and the `tsx 4.19.2` devDependency to `packages/db/package.json`.
- **M12** — Widened the root `vitest.workspace.ts` `unit` include to `*.test.{ts,tsx}` (`packages/*/src`·`packages/*/test`·`packages/adapters/*`·`apps/*/src`·`apps/*/test`). Keep the `src/**` pattern the contract wrote as is, but also keep `test/**`, where all of this plan's tests live, so that no silent skips appear. Added `**/dist/**` to `exclude`.
- **M6** — **Created Task 26 `hub-bridge-ws`** (US-A10). `apps/hub/src/bridge.ts` implements the server side of contract §3.5/§8: Bearer token (`OMNIS_BRIDGE_TOKEN` ← Keychain `omnis.bridge.token.<host>`) + `x-omnis-host` validation, JSON-RPC 2.0 framing, receiving `runtime.registered`/`session.registered`/`health`/`turn.*`, `approval.requested` → `pending_approvals` → wait for decision → `HumanResponse` reply, sending `HUB_METHODS` (`bridge/discover`·`session.*`·`turn.*`, with `ingest.*` rejected immediately as Phase B), ping/pong heartbeat. The test actually runs a register + discover round trip with a `ws` client. Every "US-A17 attaches it" in Task 24's YAGNI/comments was corrected to "Task 26 attaches it".
- **M13** — **Created Task 27 `ci`**. Wrote `.github/workflows/ci.yml` per A7 §6/A7-D7: the `check` job (lint+typecheck+unit, always) + the `integration` job (`pgvector/pgvector:pg17` service container, `dorny/paths-filter` path filter). The macOS Tauri job is appended by the desktop plan when `apps/desktop` appears.
- **US-A10 commit unit** — Since contract §10 lists US-A10 as four tasks, `hub-bootstrap`·`hub-http-routes`·`graceful-shutdown`·`hub-bridge-ws`, the commit step in Task 25 was moved to the end of Task 26 to honor the one-atomic-commit rule (A7-D8). Tasks 23~26 in their entirety are a single commit.
- **contract §5 Approvals alignment** — `beginExecution`/`completeExecution`/`failExecution`/`expire` are now the official surface of contract §5. Task 18's phrase "4 additional methods beyond the contract" was changed to "the remaining 4 methods of contract §5 `Approvals`", and Task 16's `Approvals` list now states "the remaining 4 are attached by Task 18". `PendingApproval`·`Logger`/`createLogger`·`killSwitchStatus`·`runEgress`/`EgressToken`/`EgressSpec`/`EgressDeps`/`createOutbox`/`createIngestSink` already had the same names and signatures as contract §5 — only `createLogger` was missing the `traceId` argument on Task 12's Produces line, so it was fixed to match the contract. Contract §5's `zeroSchema`/`assertZeroPublication`/`ZeroPublicationError` are `@omnis/kernel` symbols but owned by US-A21 (`2026-09-20-phase-a-sync-and-agents.md` Tasks 1~2), so this plan does not create them — this plan only creates the `zero_omnis` publication (Task 10) they will check against.
- **Replication role** — Left `omnis_sync` (owned by A3 §1) as is, and stated on one line each in `0001` and `0008` that **the user zero-cache connects as is `omnis_sync`**. `zero_replication` in contract §7 is the old name and appears nowhere in the code.
- **Commit trailer** — Aligned all 19 `git commit`s in this plan with the session rules: `Implemented-by: <tier>` at the end of the body (the execution-model notation A7 §6 requires), and the last line of every commit is without exception `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Removed the "a discrepancy is an open question" sentence remaining in Global Constraints.
- **Definition of done** — Added 5 lines: bridge upgrade 401/503/101, the absence of `zero_replication`, trailer consistency, `ci.yml` parsing, and green CI on the first push.

Not applied (outside this plan): M2 (sync-and-agents' zod 4 → protocol's zod 3), M7·M8 (Keychain names — the adapter and desktop plans), M9·M10·M11 (the desktop plan), M14 (the phase-0 T17 scope reduction).
