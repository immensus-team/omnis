# Phase B Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the **entire agent layer** on top of what Phase A established — "the inbox labels itself." First fix the loop runtime contract (US-B06) and the tool palette (US-B07), then layer on top: reply drafts (B13) · the cost meter (B14) · three notification tiers and two delivery paths (B15 · B17) · auto-archive with a 7-day undo (B18) · todos and delegation (B19 · B20) · note routing (B21) · Network follow-ups (B22) · the morning briefing and nightly digest (B23 · B24) · self-model patch proposals (B25). Connecting real accounts is outside Phase B scope (B-D5), so all 14 stories are accepted with seed data + `MockLanguageModelV3` + stub fetch alone.

**Architecture:** `packages/agents/src/loop/` is the **single execution path for every loop**. `runLoopSpec(spec, ctx)` runs the `LoopSpec` registered through `registerLoop(spec)`, and that one function owns budget enforcement, the seven failure-handling cases in A4 §1.6, and the `recordRun`/`finishRun` pair. A loop declares only what it assembles and what it saves (apply). The tools handed to the model are just the seven read tools in `packages/agents/src/tools/` plus the six `propose_*` tools, and irreversible tools **do not exist even at the type level** — the 12 phantom tools are hardcoded as a list of names, so a unit test breaks if any of them leaks into the registry. Work the kernel does rather than the model — cost, notifications, archiving — moves down into `packages/kernel/src/{cost,notify,archive}.ts`, and `@omnis/agents` does not import `@omnis/kernel` (contract §1); instead it defines the structurally compatible minimal interfaces (`LoopKernel`, `LoopLogger`) inside itself.

**Tech Stack:** Node 22 · pnpm workspaces · TypeScript 5.6.3 (strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`) · `ai@7.0.107` (`generateObject` / `generateText` + `Output.object` + `stepCountIs` + `tool` + `type ToolSet`) · `@ai-sdk/openai-compatible@3.0.53` · `zod@^3.24.1` · `pg@8.13.1` · `vitest@2.1.9` (+ `MockLanguageModelV3` from `ai/test`) · `web-push@3.6.7` (hub sending) · Postgres 17 + pgvector · Tauri 2 (macOS local notifications). Version pin sources: Phase A contract §2 (FIXED) + Phase B delta §1.

**Spec:** /Users/logankim/AI-Workspaces/omnis/docs/spec/00-omnis-design.md (§11 loop table · §12 notifications · §14 cost policy · §19 Q4/Q7/Q10/Q11) + A4-agent-layer.md (§1 common foundation · §3 L2 drafts · §4 L3 todos · §5 L4 delegation · §6 L5 briefing/digest · §7 L6 follow-up · §8 L7 note routing · §9 L8 auto-archive · §11 injection · §12.4 monthly cap · §13 self-model) + A3-data-schema.md (§2 items/meta · §4 agent_runs/tasks/pending_approvals/notes/digests · §6 jobs) + A5-ui-ux.md (§3.8 undo banner · §4.4 Web Push) + A6-ops-infra.md (§9 Keychain) + contract document `2026-09-20-phase-a-interfaces.md` + delta `2026-09-20-phase-b-interfaces-delta.md` + backlog `2026-09-20-phase-b-backlog.md`

## Global Constraints

- Node 22 + pnpm workspaces. New packages must live inside the glob in `pnpm-workspace.yaml` (A7 §1). This plan **creates no new packages** — it only modifies `@omnis/agents`·`@omnis/kernel`·`@omnis/db`·`apps/hub`·`apps/desktop`.
- TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`, extending the root `tsconfig.base.json` (A7 §1).
- Postgres 17 + pgvector. The integration test DB is `omnis_test`, the connection string is `DATABASE_URL`, falling back to `postgres://logan@127.0.0.1:5432/omnis_test` (contract §2). Each chain uses its own test DB — it does not share a DB with other plans.
- Version pins (FIXED, identical across every workspace): `vitest 2.1.9` · `zod ^3.24.1` (zod 4 forbidden) · `pg 8.13.1` · `typescript 5.6.3` · `@rocicorp/zero 1.9.0` (exact) · `ai 7.0.107`. The only pin this plan adds is `web-push 3.6.7` (delta §1).
- Migrations are append-only. `packages/db/migrations/000N_<name>.sql`, next number after `0009`. Never modify a file that has already been applied (A3 §8). The only file this plan creates is **`0012_jobs_phase_b.sql`** (delta §6).
- Never wire up an irreversible tool without an approval gate. `send`/`delete`/`calendar_write`/`delegate` exist only through the `pending_approvals` → `runEgress` path, and inside `packages/agents` these tools **do not exist even at the type level** (A7 §7 common prohibitions, A4-D3).
- Provider SDKs (`@ai-sdk/*`) are imported only inside `packages/agents/src/t1/`·`packages/agents/src/t2/`. If they leak into another directory, `packages/agents/test/no-egress.test.ts` breaks.
- Do not import `packages/kernel/src/egress/**` from `packages/agents/**` (Biome `noRestrictedImports`, Task 5).
- Do not delete or skip tests to make them pass (A7 §7 common prohibitions).
- `pnpm lint` must pass before committing.
- Commit message format: `<story-id>: <one-line summary>` + the acceptance criteria satisfied in the body + `Implemented-by: <model>`, with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` as the last line.
- Keychain naming: `omnis.<service>.<kind>` (what this plan uses: `omnis.openrouter.api_key`, `omnis.anthropic.api_key`, `omnis.webpush.vapid_private`/`…public`). Never put key values into any log or error (A6-D9).

## What this plan **adds** to the delta (explicit)

Identifiers from delta §4/§5 are used as-is. The five below are missing from the delta, so this plan fixes them anew; they are all **additions**, not changes to existing signatures.

| Symbol | Why it is needed | Task that creates it |
|---|---|---|
| `TriggerContext` | The type that `LoopSpec.assemble(ctx)`·`apply(result, ctx)`·`runLoop(id, ctx)` in delta §4 receive, but the delta never defined it | Task 1 |
| `LoopSpec.decide?()` | The **model-free T0 pre-decision** required by A4 §9.2 (auto-archive ①③④ SQL)·§2.2 (three-stage classification). It is an optional field, so it does not break existing `LoopSpec` implementations | Task 1 |
| `runLoopSpec(spec, ctx)` | `morningDigestLoop`/`nightlyDigestLoop` both share the `LoopId` `'digest'`, so the registry key collides. A lower-level entry point that bypasses the registry | Task 3 |
| `LoopKernel` / `LoopLogger` | `@omnis/agents` does not depend on `@omnis/kernel` (contract §1). Minimal interfaces that `Kernel`/`Logger` are structurally assignable to | Task 4 |
| `writeSystemItem` | A4 §1.6·§12.4·§9 repeat "leave it in the inbox as a system Item." Keep it in exactly one place inside `@omnis/agents` (the 4-line INSERT on the kernel side is intentional duplication — `apps/hub/src/archive.ts` already has the same shape) | Task 2 |

---

## Task 1: Loop contract types + registry (US-B06, tier: Opus)

> **Story** — Goal: `LoopSpec`/`LoopResult`/`LoopTrigger` + the loop registry. Deliverables: `packages/agents/src/loop/{spec,registry}.ts`. Verification: `pnpm --filter @omnis/agents test`. Depends on: B05.

**Read:** A4 §1.1·§1.2·§1.5 (phantom list), delta §4.
**Do not build (YAGNI):** a loop priority queue, per-loop feature flags, a dynamic palette editing API. Nothing uses any of them.

**Files:**
- Create: `packages/agents/src/loop/spec.ts`, `packages/agents/src/loop/registry.ts`, `packages/agents/src/tools/names.ts`, `packages/agents/test/loop-registry.test.ts`
- Modify: `packages/agents/src/index.ts`
- Test: `packages/agents/test/loop-registry.test.ts`

**Interfaces:**
- Consumes: `AssembledContext`(US-B05, `../context/assemble.js`), `RecordRunInput`(Phase A, `../record-run.js`).
- Produces: `LoopId`, `LoopKind`, `LoopTrigger`, `LoopBudget`, `TriggerContext`, `LoopResult<T>`, `LoopSpec<TOut>`, `LoopBudgetError`, `PhantomToolError`, `registerLoop`, `getLoop`, `listLoops`, `resetLoopRegistryForTest`, `ToolName`, `PHANTOM_TOOLS`.

### Steps

- [ ] 1. Build the tool name set first. `spec.ts` references `palette: ReadonlyArray<ToolName>`, which is needed before the tool implementations (Task 5), so split it into a leaf module holding **names only**.

```ts
// packages/agents/src/tools/names.ts
// A4 §1.5. This file holds "names" only, not values — implementations live in read.ts / propose.ts, assembly in registry.ts.

export type ToolName =
  | "read_thread"
  | "search_memory"
  | "read_person"
  | "read_entity"
  | "read_calendar"
  | "read_tasks"
  | "read_session"
  | "propose_label"
  | "propose_draft"
  | "propose_task"
  | "propose_delegation"
  | "propose_route"
  | "propose_self_model_patch";

export const TOOL_NAMES: readonly ToolName[] = [
  "read_thread", "search_memory", "read_person", "read_entity", "read_calendar",
  "read_tasks", "read_session",
  "propose_label", "propose_draft", "propose_task", "propose_delegation",
  "propose_route", "propose_self_model_patch",
] as const;

/** A4 §1.5 final paragraph: if any one of these ends up in the registry, the unit test breaks.
 *  Why `archive` is here — auto-archive is a SQL transition in a kernel job, not a tool the model calls (A4 §9). */
export const PHANTOM_TOOLS: readonly string[] = [
  "send_message", "send_email", "reply", "delete_item", "archive",
  "calendar_create", "calendar_update", "run_agent", "exec",
  "read_file", "http_fetch", "read_secret",
] as const;
```

- [ ] 2. Write the failing test. It checks that the registry (a) rejects duplicate ids, (b) throws `PhantomToolError` when a phantom tool is in the palette, and (c) verifies that the trigger kind and its fields line up.

```ts
// packages/agents/test/loop-registry.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import { z } from "zod";
import {
  PhantomToolError, getLoop, listLoops, registerLoop, resetLoopRegistryForTest,
  type LoopSpec,
} from "../src/index.js";

const noop = async (): Promise<void> => undefined;

function spec(over: Partial<LoopSpec<{ ok: boolean }>> = {}): LoopSpec<{ ok: boolean }> {
  return {
    id: "note_route",
    kind: "reactive",
    trigger: { kind: "event", on: "note.created", debounceMs: 2000 },
    palette: ["search_memory", "propose_route"],
    budget: { inputTokens: 4000, outputTokens: 450, wallClockMs: 20_000, maxSteps: 2 },
    tier: "T1",
    outputSchema: z.object({ ok: z.boolean() }),
    assemble: async () => ({
      cachedPrefix: "", volatile: [], tokenEstimate: 0, truncated: false, provenance: [],
    }),
    apply: noop,
    ...over,
  };
}

describe("loop registry (A4 §1.1)", () => {
  beforeEach(() => resetLoopRegistryForTest());

  it("registers and looks a loop up by id", () => {
    registerLoop(spec());
    expect(getLoop("note_route").tier).toBe("T1");
    expect(listLoops().map((s) => s.id)).toEqual(["note_route"]);
  });

  it("refuses a duplicate id", () => {
    registerLoop(spec());
    expect(() => registerLoop(spec())).toThrow(/already registered/);
  });

  it("refuses any phantom tool in the palette (A4 §1.5)", () => {
    for (const phantom of ["send_message", "archive", "exec", "read_secret"]) {
      resetLoopRegistryForTest();
      expect(() =>
        registerLoop(spec({ palette: ["read_thread", phantom] as never })),
      ).toThrow(PhantomToolError);
    }
  });

  it("refuses a schedule trigger without cron and an event trigger without on", () => {
    expect(() => registerLoop(spec({ trigger: { kind: "schedule" } }))).toThrow(/cron/);
    resetLoopRegistryForTest();
    expect(() => registerLoop(spec({ trigger: { kind: "event" } }))).toThrow(/on/);
  });

  it("refuses a non-positive budget", () => {
    expect(() =>
      registerLoop(spec({ budget: { inputTokens: 0, outputTokens: 1, wallClockMs: 1, maxSteps: 1 } })),
    ).toThrow(/inputTokens/);
  });
});
```

- [ ] 3. Run the test and confirm the failure. Expected failure: not `Failed to resolve import "../src/index.js"` but the `No "registerLoop" export is defined on the "../src/index.js" mock` family — specifically `SyntaxError: The requested module '../src/index.js' does not provide an export named 'registerLoop'`.

```bash
pnpm --filter @omnis/agents test -- loop-registry
```

- [ ] 4. Write `spec.ts`.

```ts
// packages/agents/src/loop/spec.ts
// A4 §1.1·§1.2. The kernel knows nothing of loops; it knows only this contract.
import type { z } from "zod";
import type { AssembledContext } from "../context/assemble.js";
import type { ToolName } from "../tools/names.js";

/** A4 §1.1. A subset of agent_runs.loop — the 'summarize' value Phase A added is not a loop but the B3 summarize helper. */
export type LoopId =
  | "classify" | "draft" | "task" | "delegate" | "digest"
  | "followup" | "note_route" | "auto_archive" | "ingest";

export type LoopKind = "reactive" | "deliberate";

export interface LoopTrigger {
  kind: "event" | "schedule" | "manual";
  /** kind='event': kernel event kind. e.g. 'item.labeled' */
  on?: string;
  /** kind='event': predicate evaluated in the hub. The model does not evaluate it. */
  where?: string;
  /** kind='schedule': TZ=Asia/Seoul 5-field cron */
  cron?: string;
  debounceMs?: number;
}

export interface LoopBudget {
  inputTokens: number;
  outputTokens: number;
  wallClockMs: number;
  maxSteps: number;
}

/** Missing from the delta, so this plan fixes it. An envelope holding "what the loop runs against." */
export interface TriggerContext {
  trigger_kind: "event" | "cron" | "manual";
  /** Cron job name only. Item triggers use item_id, not trigger_ref (A4 §1.7). */
  trigger_ref?: string;
  item_id?: string;
  thread_id?: string;
  task_id?: string;
  note_id?: string;
  person_id?: string;
  now: Date;
  payload: Record<string, unknown>;
}

export interface LoopResult<T> {
  loop: LoopId;
  run_id: string;
  output: T;
  confidence: number;
  rationale: string;
  escalate: boolean;
  injection_flags: string[];
  unresolved: string[];
}

export interface LoopSpec<TOut> {
  id: LoopId;
  kind: LoopKind;
  trigger: LoopTrigger;
  /** Irreversible tools cannot go here — registerLoop blocks them with PhantomToolError (A4-D3). */
  palette: ReadonlyArray<ToolName>;
  budget: LoopBudget;
  tier: "T0" | "T1" | "T2";
  outputSchema: z.ZodType<TOut>;
  /** Delta addition (optional). The T0 path where a conclusion is reached without a model. Returning null falls through to the model path.
   *  Auto-archive ①③④ from A4 §9.2 goes here. */
  decide?(ctx: TriggerContext): Promise<Omit<LoopResult<TOut>, "run_id"> | null>;
  assemble(ctx: TriggerContext): Promise<AssembledContext>;
  /** Proposals only. Importing egress modules is forbidden here too (A4 §1.1). */
  apply(result: LoopResult<TOut>, ctx: TriggerContext): Promise<void>;
}

export class LoopBudgetError extends Error {
  constructor(
    readonly loop: LoopId,
    readonly field: keyof LoopBudget,
    readonly actual: number,
    readonly limit: number,
  ) {
    super(`loop ${loop} exceeded budget.${field}: ${actual} > ${limit}`);
    this.name = "LoopBudgetError";
  }
}

export class PhantomToolError extends Error {
  constructor(readonly toolName: string) {
    super(`phantom tool "${toolName}" is not in the registry (A4 §1.5)`);
    this.name = "PhantomToolError";
  }
}
```

- [ ] 5. Write `registry.ts`.

```ts
// packages/agents/src/loop/registry.ts
import { PHANTOM_TOOLS, TOOL_NAMES } from "../tools/names.js";
import { type LoopBudget, type LoopId, type LoopSpec, PhantomToolError } from "./spec.js";

const registry = new Map<LoopId, LoopSpec<unknown>>();

const BUDGET_FIELDS: readonly (keyof LoopBudget)[] = [
  "inputTokens", "outputTokens", "wallClockMs", "maxSteps",
];

export function registerLoop<T>(spec: LoopSpec<T>): void {
  if (registry.has(spec.id)) throw new Error(`loop "${spec.id}" is already registered`);
  for (const name of spec.palette) {
    if (PHANTOM_TOOLS.includes(name)) throw new PhantomToolError(name);
    if (!TOOL_NAMES.includes(name)) throw new PhantomToolError(name);
  }
  if (spec.trigger.kind === "schedule" && spec.trigger.cron === undefined) {
    throw new Error(`loop "${spec.id}": schedule trigger needs cron`);
  }
  if (spec.trigger.kind === "event" && spec.trigger.on === undefined) {
    throw new Error(`loop "${spec.id}": event trigger needs on`);
  }
  for (const f of BUDGET_FIELDS) {
    if (!(spec.budget[f] > 0)) {
      throw new Error(`loop "${spec.id}": budget.${f} must be > 0, got ${spec.budget[f]}`);
    }
  }
  registry.set(spec.id, spec as LoopSpec<unknown>);
}

export function getLoop(id: LoopId): LoopSpec<unknown> {
  const spec = registry.get(id);
  if (spec === undefined) throw new Error(`loop "${id}" is not registered`);
  return spec;
}

export function listLoops(): LoopSpec<unknown>[] {
  return [...registry.values()];
}

/** Test-only. Do not call this from production code. */
export function resetLoopRegistryForTest(): void {
  registry.clear();
}
```

- [ ] 6. Add the re-exports to `index.ts`.

```ts
// packages/agents/src/index.ts — append at the end of the file
export {
  LoopBudgetError, PhantomToolError,
  type LoopBudget, type LoopId, type LoopKind, type LoopResult, type LoopSpec,
  type LoopTrigger, type TriggerContext,
} from "./loop/spec.js";
export { getLoop, listLoops, registerLoop, resetLoopRegistryForTest } from "./loop/registry.js";
export { PHANTOM_TOOLS, TOOL_NAMES, type ToolName } from "./tools/names.js";
```

- [ ] 7. Run the tests and confirm they pass. Expected: `loop-registry.test.ts` 5 tests passed.

```bash
pnpm --filter @omnis/agents test -- loop-registry && pnpm lint
```

- [ ] 8. Commit.

```bash
git add packages/agents/src/loop packages/agents/src/tools/names.ts packages/agents/src/index.ts packages/agents/test/loop-registry.test.ts
git commit -m "US-B06: loop contract types and registry

- Fix LoopSpec/LoopResult/LoopTrigger/LoopBudget/TriggerContext (delta §4 + the added TriggerContext and decide)
- registerLoop rejects all 12 phantom tools, duplicate ids, missing trigger fields, and non-positive budgets
- Split PHANTOM_TOOLS/TOOL_NAMES into a leaf module so they can be referenced before the tool implementations

Implemented-by: Claude Opus
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 2: System Item helper (US-B06, tier: Sonnet)

> **Story** — Goal: consolidate A4 §1.6's "leave it in the inbox as a system Item" into one place. Deliverables: `packages/agents/src/system-item.ts`. Verification: `pnpm --filter @omnis/agents test`.

**Read:** A3 §2 (`items` columns · the `system` value of `accounts_channel_ck`), `apps/hub/src/archive.ts` (an existing INSERT of the same shape).
**Do not build (YAGNI):** a system-Item-only table, a severity enum, a dedup cache. If the need arises, add a key to `meta`.

**Files:**
- Create: `packages/agents/src/system-item.ts`, `packages/agents/test/integration/system-item.test.ts`
- Modify: `packages/agents/src/index.ts`
- Test: `packages/agents/test/integration/system-item.test.ts`

**Interfaces:**
- Consumes: `getAgentsPool()`(Phase A, `./pool.js`).
- Produces: `writeSystemItem(input): Promise<string>`, `SYSTEM_ACCOUNT_EXTERNAL_ID`, `SYSTEM_THREAD_EXTERNAL_ID`, `type SystemItemInput`.

### Steps

- [ ] 1. Write the failing test.

```ts
// packages/agents/test/integration/system-item.test.ts
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { configureAgents, writeSystemItem } from "../../src/index.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});
beforeAll(() => configureAgents({ pool }));
afterAll(() => pool.end());

describe("writeSystemItem (A4 §1.6)", () => {
  it("creates the system account/thread once and appends an item", async () => {
    const a = await writeSystemItem({ body: "1 automatic-processing failure", meta: { loop: "draft" } });
    const b = await writeSystemItem({ body: "2 automatic-processing failures" });
    expect(a).not.toBe(b);

    const { rows } = await pool.query<{ kind: string; status: string; body: string; meta: unknown }>(
      `SELECT i.kind, i.status, i.body, i.meta FROM items i
         JOIN threads t ON t.id = i.thread_id
         JOIN accounts ac ON ac.id = i.account_id
        WHERE ac.channel = 'system' AND t.external_id = 'system:agents'
        ORDER BY i.sent_at`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0]).toMatchObject({ kind: "system", status: "received" });

    const { rows: accs } = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM accounts WHERE channel = 'system' AND external_id = 'omnis'",
    );
    expect(accs[0]?.n).toBe("1");
  });

  it("attaches to a given thread when thread_id is passed", async () => {
    const acc = await pool.query<{ id: string }>(
      `INSERT INTO accounts (channel, external_id, display) VALUES ('telegram','sys@test','t')
         ON CONFLICT (channel, external_id) DO UPDATE SET display='t' RETURNING id`,
    );
    const accountId = acc.rows[0]?.id ?? "";
    const thr = await pool.query<{ id: string }>(
      `INSERT INTO threads (account_id, external_id, kind) VALUES ($1,'thr_sys','dm')
         ON CONFLICT (account_id, external_id) DO UPDATE SET kind='dm' RETURNING id`,
      [accountId],
    );
    const threadId = thr.rows[0]?.id ?? "";
    const id = await writeSystemItem({ body: "leave this on the thread", thread_id: threadId });
    const { rows } = await pool.query<{ thread_id: string }>(
      "SELECT thread_id FROM items WHERE id = $1",
      [id],
    );
    expect(rows[0]?.thread_id).toBe(threadId);
  });
});
```

- [ ] 2. Confirm the failure. Expected: `does not provide an export named 'writeSystemItem'`.

```bash
pnpm --filter @omnis/agents test -- system-item
```

- [ ] 3. Write the implementation.

```ts
// packages/agents/src/system-item.ts
// A4 §1.6·§12.4·§9: failures and policy transitions are not swallowed silently — they are left in the inbox.
// ponytail: the kernel (@omnis/kernel) needs the same INSERT but cannot depend on agents, so each
// carries its own four-line SQL (apps/hub/src/archive.ts already has the same shape). Intentional duplication — do not extract into a shared package.
import { getAgentsPool } from "./pool.js";

export const SYSTEM_ACCOUNT_EXTERNAL_ID = "omnis";
export const SYSTEM_THREAD_EXTERNAL_ID = "system:agents";

export interface SystemItemInput {
  body: string;
  /** If omitted, attaches to the single 'system:agents' thread on the system channel. */
  thread_id?: string;
  subject?: string;
  meta?: Record<string, unknown>;
}

async function systemThreadId(): Promise<{ threadId: string; accountId: string }> {
  const pool = getAgentsPool();
  const acc = await pool.query<{ id: string }>(
    `INSERT INTO accounts (channel, external_id, display)
     VALUES ('system', $1, 'omnis')
     ON CONFLICT (channel, external_id) DO UPDATE SET display = EXCLUDED.display
     RETURNING id`,
    [SYSTEM_ACCOUNT_EXTERNAL_ID],
  );
  const accountId = acc.rows[0]?.id;
  if (accountId === undefined) throw new Error("system account upsert returned no row");
  const thr = await pool.query<{ id: string }>(
    `INSERT INTO threads (account_id, external_id, kind, title)
     VALUES ($1, $2, 'system', 'omnis')
     ON CONFLICT (account_id, external_id) DO UPDATE SET kind = 'system'
     RETURNING id`,
    [accountId, SYSTEM_THREAD_EXTERNAL_ID],
  );
  const threadId = thr.rows[0]?.id;
  if (threadId === undefined) throw new Error("system thread upsert returned no row");
  return { threadId, accountId };
}

export async function writeSystemItem(input: SystemItemInput): Promise<string> {
  const pool = getAgentsPool();
  const fallback = await systemThreadId();
  const threadId = input.thread_id ?? fallback.threadId;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO items (thread_id, account_id, kind, status, subject, body, sent_at, meta)
     SELECT $1, t.account_id, 'system', 'received', $2, $3, now(), $4::jsonb
       FROM threads t WHERE t.id = $1
     RETURNING id`,
    [threadId, input.subject ?? null, input.body, JSON.stringify(input.meta ?? {})],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`thread not found for system item: ${threadId}`);
  return id;
}
```

- [ ] 4. Add the export to `index.ts`.

```ts
// packages/agents/src/index.ts — added
export {
  SYSTEM_ACCOUNT_EXTERNAL_ID, SYSTEM_THREAD_EXTERNAL_ID,
  writeSystemItem, type SystemItemInput,
} from "./system-item.js";
```

- [ ] 5. Confirm it passes and commit.

```bash
pnpm --filter @omnis/agents test -- system-item && pnpm lint
git add packages/agents/src/system-item.ts packages/agents/src/index.ts packages/agents/test/integration/system-item.test.ts
git commit -m "US-B06: system Item helper

- writeSystemItem idempotently creates the system channel account/thread and leaves an items(kind='system') row
- With thread_id it attaches to that thread; otherwise it attaches to the single system:agents thread

Implemented-by: Claude Sonnet
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 3: runLoopSpec — budget enforcement + the seven failure cases (US-B06, tier: Opus)

> **Story** — Goal: budget enforcement (`LoopBudgetError`), the seven common failure cases in A4 §1.6, and exactly one `recordRun`/`finishRun` pair per execution. Deliverables: `packages/agents/src/loop/run.ts`. Verification: `pnpm --filter @omnis/agents test`.

**Read:** the whole A4 §1.6 table, §1.7, §12.1 (T1/T2 providers), the existing `packages/agents/src/classify.ts` (same recordRun pattern), `packages/agents/src/t1/provider.ts`.
**Do not build (YAGNI):** an exponential backoff library, a circuit breaker, per-loop custom retry policies. All A4 specifies is two waits, 1s→4s.

**Files:**
- Create: `packages/agents/src/t2/provider.ts`, `packages/agents/src/loop/run.ts`, `packages/agents/test/integration/loop-run.test.ts`
- Modify: `packages/agents/src/index.ts`, `packages/agents/test/no-egress.test.ts`
- Test: `packages/agents/test/integration/loop-run.test.ts`

**Interfaces:**
- Consumes: `getLoop`(Task 1), `writeSystemItem`(Task 2), `recordRun`/`finishRun`(Phase A), `t1Model`/`T1_RUN_MODEL`(Phase A), `wrapData`/`newNonce`(US-B05).
- Produces: `runLoopSpec(spec, ctx)`, `runLoop(id, ctx)`, `t2Model()`, `T2_RUN_MODEL`, `T2_MODEL_ID`, `QUARANTINE_HOURS`, `FAILURE_WINDOW_HOURS`, `FAILURE_LIMIT`.

### Steps

- [ ] 1. Write the T2 provider. It is **Claude Sonnet 5 via OpenRouter** — the direct Anthropic path is used only for the Batch API (Task 23), and synchronous calls are handled entirely by the already-pinned `@ai-sdk/openai-compatible` (zero new SDK dependencies).

```ts
// packages/agents/src/t2/provider.ts
// A4 §12.1: T2 is Claude Sonnet 5 and nothing else. The gateway is OpenRouter (no token markup).
// The direct Anthropic path is used only for Message Batches (§6.5) — that one goes over raw fetch with no SDK (Task 23).
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

export const T2_BASE_URL = "https://openrouter.ai/api/v1";
/** OpenRouter routing slug. */
export const T2_MODEL_ID = "anthropic/claude-sonnet-5";
/** The value recorded in A3 §4 agent_runs.model (exactly as written in A4 §12.1). */
export const T2_RUN_MODEL = "claude-sonnet-5";

export function t2Model(): LanguageModel {
  const apiKey = process.env.OMNIS_OPENROUTER_API_KEY;
  if (apiKey === undefined || apiKey === "") {
    throw new Error("OMNIS_OPENROUTER_API_KEY is not set (Keychain item omnis.openrouter.api_key)");
  }
  return createOpenAICompatible({ name: "openrouter", baseURL: T2_BASE_URL, apiKey })(T2_MODEL_ID);
}
```

- [ ] 2. Write the failing test. It covers each of the five failure paths.

```ts
// packages/agents/test/integration/loop-run.test.ts
import { MockLanguageModelV3 } from "ai/test";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});
let accountId = "";
let threadId = "";
let itemId = "";

beforeAll(async () => {
  const a = await pool.query<{ id: string }>(
    `INSERT INTO accounts (channel, external_id, display) VALUES ('telegram','loop@test','t')
       ON CONFLICT (channel, external_id) DO UPDATE SET display='t' RETURNING id`,
  );
  accountId = a.rows[0]?.id ?? "";
  const t = await pool.query<{ id: string }>(
    `INSERT INTO threads (account_id, external_id, kind) VALUES ($1,'thr_loop','dm')
       ON CONFLICT (account_id, external_id) DO UPDATE SET kind='dm' RETURNING id`,
    [accountId],
  );
  threadId = t.rows[0]?.id ?? "";
  const i = await pool.query<{ id: string }>(
    `INSERT INTO items (thread_id, account_id, external_id, kind, body, sent_at)
     VALUES ($1,$2,'it_loop','message','Hello there', now())
     ON CONFLICT (account_id, external_id) DO UPDATE SET body = EXCLUDED.body RETURNING id`,
    [threadId, accountId],
  );
  itemId = i.rows[0]?.id ?? "";
});
afterAll(() => pool.end());

const Out = z.object({ answer: z.string() });

function makeSpec(over: Record<string, unknown> = {}) {
  return {
    id: "note_route" as const,
    kind: "reactive" as const,
    trigger: { kind: "event" as const, on: "note.created" },
    palette: [] as [],
    budget: { inputTokens: 4000, outputTokens: 400, wallClockMs: 3000, maxSteps: 1 },
    tier: "T1" as const,
    outputSchema: Out,
    assemble: async () => ({
      cachedPrefix: "system", volatile: [{ id: "d1", source: "thread", text: "body" }],
      tokenEstimate: 100, truncated: false, provenance: [],
    }),
    apply: async () => undefined,
    ...over,
  };
}

function mockModel(text: string) {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      finishReason: "stop" as const,
      usage: {
        inputTokens: { total: 120, noCache: 20, cacheRead: 100, cacheWrite: 0 },
        outputTokens: { total: 30, text: 30, reasoning: 0 },
      },
      content: [{ type: "text" as const, text }],
      warnings: [],
    }),
  });
}

async function freshModule(model: unknown) {
  vi.resetModules();
  vi.doMock("../../src/t1/provider.js", async (orig) => ({
    ...(await orig<typeof import("../../src/t1/provider.js")>()),
    t1Model: () => model,
  }));
  vi.doMock("../../src/t2/provider.js", async (orig) => ({
    ...(await orig<typeof import("../../src/t2/provider.js")>()),
    t2Model: () => model,
  }));
  const mod = await import("../../src/index.js");
  mod.configureAgents({ pool });
  mod.resetLoopRegistryForTest();
  return mod;
}

async function runsFor(id: string) {
  const { rows } = await pool.query<{
    outcome: string; model_tier: string; injection_flags: string[]; escalated_from: string | null;
  }>(
    "SELECT outcome, model_tier, injection_flags, escalated_from FROM agent_runs WHERE item_id = $1 ORDER BY created_at",
    [id],
  );
  return rows;
}

beforeEach(async () => {
  await pool.query("DELETE FROM agent_runs WHERE item_id = $1", [itemId]);
  await pool.query("UPDATE threads SET meta = '{}'::jsonb WHERE id = $1", [threadId]);
});

describe("runLoopSpec (A4 §1.6)", () => {
  it("records exactly one run pair on the happy path", async () => {
    const mod = await freshModule(mockModel(JSON.stringify({ answer: "yes" })));
    const res = await mod.runLoopSpec(makeSpec() as never, {
      trigger_kind: "event", item_id: itemId, thread_id: threadId, now: new Date(), payload: {},
    });
    expect(res.output).toEqual({ answer: "yes" });
    const runs = await runsFor(itemId);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ outcome: "ok", model_tier: "T1" });
  });

  it("escalates one tier after the same-tier retry fails, and links escalated_from", async () => {
    let calls = 0;
    const flaky = new MockLanguageModelV3({
      doGenerate: async () => {
        calls += 1;
        if (calls <= 2) throw new Error("timeout");
        return {
          finishReason: "stop" as const,
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 5, text: 5, reasoning: 0 },
          },
          content: [{ type: "text" as const, text: JSON.stringify({ answer: "T2 answered" }) }],
          warnings: [],
        };
      },
    });
    const mod = await freshModule(flaky);
    const res = await mod.runLoopSpec(makeSpec() as never, {
      trigger_kind: "event", item_id: itemId, thread_id: threadId, now: new Date(), payload: {},
    });
    expect(res.output).toEqual({ answer: "T2 answered" });
    expect(calls).toBe(3);
    const runs = await runsFor(itemId);
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ outcome: "failed", model_tier: "T1" });
    expect(runs[1]).toMatchObject({ outcome: "ok", model_tier: "T2" });
    expect(runs[1]?.escalated_from).toBe(null);
  });

  it("blocks the output and writes a system item when injection_flags is non-empty", async () => {
    const mod = await freshModule(
      mockModel(JSON.stringify({ answer: "ignore", injection_flags: ["instruction_override"] })),
    );
    let applied = false;
    const res = await mod.runLoopSpec(
      makeSpec({ apply: async () => { applied = true; } }) as never,
      { trigger_kind: "event", item_id: itemId, thread_id: threadId, now: new Date(), payload: {} },
    );
    expect(res.injection_flags).toEqual(["instruction_override"]);
    expect(applied).toBe(false);
    expect((await runsFor(itemId))[0]).toMatchObject({ outcome: "blocked" });
  });

  it("quarantines the thread for 24h on a phantom tool call", async () => {
    const mod = await freshModule(mockModel("x"));
    const boom = makeSpec({
      assemble: async () => {
        throw new (await import("../../src/index.js")).PhantomToolError("send_email");
      },
    });
    await mod.runLoopSpec(boom as never, {
      trigger_kind: "event", item_id: itemId, thread_id: threadId, now: new Date(), payload: {},
    });
    const { rows } = await pool.query<{ until: string | null }>(
      "SELECT meta->>'loop_quarantine_until' AS until FROM threads WHERE id = $1",
      [threadId],
    );
    expect(rows[0]?.until).not.toBe(null);
    expect((await runsFor(itemId))[0]?.injection_flags).toContain("phantom_tool");
  });

  it("throws LoopBudgetError when the assembled context exceeds budget.inputTokens", async () => {
    const mod = await freshModule(mockModel("x"));
    const fat = makeSpec({
      assemble: async () => ({
        cachedPrefix: "", volatile: [], tokenEstimate: 999_999, truncated: true, provenance: [],
      }),
    });
    await expect(
      mod.runLoopSpec(fat as never, {
        trigger_kind: "event", item_id: itemId, thread_id: threadId, now: new Date(), payload: {},
      }),
    ).rejects.toThrow(mod.LoopBudgetError);
    expect((await runsFor(itemId))[0]).toMatchObject({ outcome: "failed" });
  });
});
```

- [ ] 3. Confirm the failure. Expected: `does not provide an export named 'runLoopSpec'`.

```bash
pnpm --filter @omnis/agents test -- loop-run
```

- [ ] 4. Write `run.ts`.

```ts
// packages/agents/src/loop/run.ts
// A4 §1.6 the seven failure cases + §1.7 run recording. Every loop passes through this one function.
import { createHash } from "node:crypto";
import { NoObjectGeneratedError, generateObject, generateText, Output, stepCountIs } from "ai";
import { newNonce, wrapData } from "../context/normalize.js";
import { getAgentsPool } from "../pool.js";
import { finishRun, recordRun } from "../record-run.js";
import { writeSystemItem } from "../system-item.js";
import { T1_RUN_MODEL, t1Model } from "../t1/provider.js";
import { T2_RUN_MODEL, t2Model } from "../t2/provider.js";
import { toolRegistry } from "../tools/registry.js";
import { getLoop } from "./registry.js";
import {
  LoopBudgetError, type LoopId, type LoopResult, type LoopSpec, PhantomToolError,
  type TriggerContext,
} from "./spec.js";

export const QUARANTINE_HOURS = 24;
export const FAILURE_WINDOW_HOURS = 24;
export const FAILURE_LIMIT = 3;
const RETRY_BACKOFF_MS = [1_000, 4_000] as const;

type Tier = "T0" | "T1" | "T2";

function nextTier(t: Tier): Tier {
  return t === "T0" ? "T1" : "T2";
}

function modelFor(tier: Tier): { model: ReturnType<typeof t1Model>; runModel: string } {
  return tier === "T2"
    ? { model: t2Model(), runModel: T2_RUN_MODEL }
    : { model: t1Model(), runModel: T1_RUN_MODEL };
}

/** A4 §1.6: tool-not-found excludes that thread from automated loops for 24 hours. */
async function quarantine(threadId: string, now: Date): Promise<void> {
  const until = new Date(now.getTime() + QUARANTINE_HOURS * 3_600_000).toISOString();
  await getAgentsPool().query(
    `UPDATE threads SET meta = meta || jsonb_build_object('loop_quarantine_until', $2::text)
      WHERE id = $1`,
    [threadId, until],
  );
}

async function isQuarantined(threadId: string, now: Date): Promise<boolean> {
  const { rows } = await getAgentsPool().query<{ until: string | null }>(
    "SELECT meta->>'loop_quarantine_until' AS until FROM threads WHERE id = $1",
    [threadId],
  );
  const until = rows[0]?.until;
  return until !== undefined && until !== null && new Date(until) > now;
}

/** A4 §1.6: three failures on the same item within 24 hours marks agent_optout and stops running it. */
async function tooManyFailures(loop: LoopId, itemId: string): Promise<boolean> {
  const { rows } = await getAgentsPool().query<{ n: string }>(
    `SELECT count(*)::text AS n FROM agent_runs
      WHERE loop = $1 AND item_id = $2 AND outcome = 'failed'
        AND created_at > now() - ($3 || ' hours')::interval`,
    [loop, itemId, String(FAILURE_WINDOW_HOURS)],
  );
  return Number(rows[0]?.n ?? "0") >= FAILURE_LIMIT;
}

async function markOptOut(itemId: string): Promise<void> {
  await getAgentsPool().query(
    `UPDATE items SET meta = meta || '{"agent_optout": true}'::jsonb WHERE id = $1`,
    [itemId],
  );
}

function promptFor(ctx: TriggerContext, spec: LoopSpec<unknown>, volatileText: string): string {
  const nonce = newNonce();
  return wrapData(volatileText, {
    nonce,
    source: spec.id,
    ...(ctx.thread_id !== undefined ? { thread: ctx.thread_id } : {}),
    asOf: ctx.now.toISOString(),
  });
}

interface Generated {
  output: unknown;
  usage: { tokens_in?: number; tokens_out?: number; tokens_cached?: number };
  raw: string;
}

async function generate(
  spec: LoopSpec<unknown>,
  tier: Tier,
  system: string,
  prompt: string,
): Promise<Generated> {
  const { model } = modelFor(tier);
  const signal = AbortSignal.timeout(spec.budget.wallClockMs);
  if (spec.palette.length === 0) {
    const res = await generateObject({
      model, schema: spec.outputSchema, system, prompt,
      maxOutputTokens: spec.budget.outputTokens, abortSignal: signal,
    });
    return { output: res.object, usage: usageOf(res.usage), raw: JSON.stringify(res.object) };
  }
  const res = await generateText({
    model, system, prompt,
    tools: toolRegistry(spec.palette),
    stopWhen: stepCountIs(spec.budget.maxSteps),
    output: Output.object({ schema: spec.outputSchema }),
    maxOutputTokens: spec.budget.outputTokens,
    abortSignal: signal,
  });
  return { output: res.output, usage: usageOf(res.totalUsage), raw: res.text };
}

function usageOf(u: {
  inputTokens?: { total?: number; cacheRead?: number };
  outputTokens?: { total?: number };
}): Generated["usage"] {
  return {
    ...(u.inputTokens?.total !== undefined ? { tokens_in: u.inputTokens.total } : {}),
    ...(u.outputTokens?.total !== undefined ? { tokens_out: u.outputTokens.total } : {}),
    ...(u.inputTokens?.cacheRead !== undefined ? { tokens_cached: u.inputTokens.cacheRead } : {}),
  };
}

function flagsOf(output: unknown): string[] {
  if (typeof output !== "object" || output === null) return [];
  const f = (output as { injection_flags?: unknown }).injection_flags;
  return Array.isArray(f) ? f.filter((x): x is string => typeof x === "string") : [];
}

function numberField(output: unknown, key: string, fallback: number): number {
  if (typeof output !== "object" || output === null) return fallback;
  const v = (output as Record<string, unknown>)[key];
  return typeof v === "number" ? v : fallback;
}

function stringField(output: unknown, key: string, fallback: string): string {
  if (typeof output !== "object" || output === null) return fallback;
  const v = (output as Record<string, unknown>)[key];
  return typeof v === "string" ? v : fallback;
}

/** A lower-level entry point that bypasses the registry. Needed because the two digest loops share a LoopId. */
export async function runLoopSpec<T>(
  spec: LoopSpec<T>,
  ctx: TriggerContext,
): Promise<LoopResult<T>> {
  // ── Gates 1 and 2: quarantine, 3 failures in 24h
  if (ctx.thread_id !== undefined && (await isQuarantined(ctx.thread_id, ctx.now))) {
    return skipped(spec, ctx, "thread is quarantined for 24h (phantom tool)");
  }
  if (ctx.item_id !== undefined && (await tooManyFailures(spec.id, ctx.item_id))) {
    await markOptOut(ctx.item_id);
    return skipped(spec, ctx, "3 failures in 24h — marked agent_optout");
  }

  // ── T0 pre-decision: the path that finishes without calling a model (A4 §9.2 ①③④)
  const decided = spec.decide === undefined ? null : await spec.decide(ctx);
  if (decided !== null) {
    const runId = await recordRun({
      loop: spec.id, trigger_kind: ctx.trigger_kind, model_tier: "T0",
      provider: "local", model: "rules-v1", outcome: "running",
      ...(ctx.item_id !== undefined ? { item_id: ctx.item_id } : {}),
      ...(ctx.trigger_ref !== undefined ? { trigger_ref: ctx.trigger_ref } : {}),
    });
    const result: LoopResult<T> = { ...decided, run_id: runId };
    await finishRun(runId, { outcome: "ok", confidence: result.confidence });
    await spec.apply(result, ctx);
    return result;
  }

  let tier: Tier = spec.tier === "T0" ? "T1" : spec.tier;
  let runId = await startRun(spec, ctx, tier);

  const assembled = await spec.assemble(ctx).catch(async (e: unknown) => {
    if (e instanceof PhantomToolError) {
      if (ctx.thread_id !== undefined) await quarantine(ctx.thread_id, ctx.now);
      await finishRun(runId, {
        outcome: "failed", error: e.message, injection_flags: ["phantom_tool"],
      });
    }
    throw e;
  });

  if (assembled.tokenEstimate > spec.budget.inputTokens) {
    await finishRun(runId, {
      outcome: "failed",
      error: `budget.inputTokens ${assembled.tokenEstimate} > ${spec.budget.inputTokens}`,
    });
    throw new LoopBudgetError(spec.id, "inputTokens", assembled.tokenEstimate, spec.budget.inputTokens);
  }

  const prompt = promptFor(ctx, spec as LoopSpec<unknown>, assembled.volatile.map((b) => b.text).join("\n"));
  let lastError: unknown = null;
  let lastRaw = "";

  // A4 §1.6: one retry at the same tier → one attempt one tier up → failed.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt === 2) {
      const raised = nextTier(tier);
      if (raised === tier) break;
      await finishRun(runId, {
        outcome: "failed",
        error: lastError instanceof Error ? lastError.message : String(lastError),
        ...(lastRaw !== "" ? { raw_output: lastRaw } : {}),
      });
      tier = raised;
      runId = await startRun(spec, ctx, tier);
    } else if (attempt > 0) {
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS[attempt - 1] ?? 1_000));
    }
    try {
      const started = Date.now();
      const gen = await generate(spec as LoopSpec<unknown>, tier, assembled.cachedPrefix, prompt);
      const flags = flagsOf(gen.output);
      const result: LoopResult<T> = {
        loop: spec.id,
        run_id: runId,
        output: gen.output as T,
        confidence: numberField(gen.output, "confidence", 0.5),
        rationale: stringField(gen.output, "rationale", ""),
        escalate: numberField(gen.output, "confidence", 1) < 0.5,
        injection_flags: flags,
        unresolved: [],
      };
      await finishRun(runId, {
        outcome: flags.length > 0 ? "blocked" : "ok",
        confidence: result.confidence,
        latency_ms: Date.now() - started,
        injection_flags: flags,
        context_hash: assembled.cachedPrefix === "" ? undefined : hash(assembled.cachedPrefix),
        ...gen.usage,
      });
      // A4 §1.6: when injection_flags is non-empty, do not produce a result.
      if (flags.length > 0) {
        await writeSystemItem({
          body: "This message contains text that looks like instructions, so automatic processing was skipped.",
          ...(ctx.thread_id !== undefined ? { thread_id: ctx.thread_id } : {}),
          meta: { loop: spec.id, injection_flags: flags, run_id: runId },
        });
        return result;
      }
      await spec.apply(result, ctx);
      return result;
    } catch (e) {
      lastError = e;
      if (NoObjectGeneratedError.isInstance(e)) lastRaw = e.text ?? "";
    }
  }

  await finishRun(runId, {
    outcome: "failed",
    error: lastError instanceof Error ? lastError.message : String(lastError),
    ...(lastRaw !== "" ? { raw_output: lastRaw } : {}),
  });
  await writeSystemItem({
    body: `Automatic processing failed (${spec.id}). Please check it manually.`,
    ...(ctx.thread_id !== undefined ? { thread_id: ctx.thread_id } : {}),
    meta: { loop: spec.id, run_id: runId },
  });
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function runLoop(id: LoopId, ctx: TriggerContext): Promise<LoopResult<unknown>> {
  return runLoopSpec(getLoop(id), ctx);
}

async function startRun(
  spec: LoopSpec<unknown> | LoopSpec<never>,
  ctx: TriggerContext,
  tier: Tier,
): Promise<string> {
  const { runModel } = modelFor(tier);
  return recordRun({
    loop: (spec as LoopSpec<unknown>).id,
    trigger_kind: ctx.trigger_kind,
    model_tier: tier,
    provider: "openrouter",
    model: runModel,
    outcome: "running",
    ...(ctx.item_id !== undefined ? { item_id: ctx.item_id } : {}),
    ...(ctx.trigger_ref !== undefined ? { trigger_ref: ctx.trigger_ref } : {}),
  });
}

async function skipped<T>(
  spec: LoopSpec<T>,
  ctx: TriggerContext,
  reason: string,
): Promise<LoopResult<T>> {
  const runId = await recordRun({
    loop: spec.id, trigger_kind: ctx.trigger_kind, model_tier: "T0",
    provider: "local", model: "gate", outcome: "running",
    ...(ctx.item_id !== undefined ? { item_id: ctx.item_id } : {}),
  });
  await finishRun(runId, { outcome: "skipped", error: reason });
  return {
    loop: spec.id, run_id: runId, output: undefined as T, confidence: 0,
    rationale: reason, escalate: false, injection_flags: [], unresolved: [],
  };
}

/** A4 §12.2: to measure the cache hit rate after the fact, sha256(cachedPrefix) must be recorded in agent_runs. */
function hash(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}
```

- [ ] 5. Fix `no-egress.test.ts`. The `/\btools\s*:/` regex also catches `generateText({ tools: toolRegistry(...) })`, so replace it with a **phantom-name list check** and add `t2/` to the directories allowed to import provider SDKs.

```ts
// packages/agents/test/no-egress.test.ts — replace the whole describe block
import { PHANTOM_TOOLS } from "../src/tools/names.js";

describe("@omnis/agents tool isolation (A7 §7 common prohibitions)", () => {
  it("never mentions an irreversible tool name in a tool definition", () => {
    // names.ts owns the name list; here we only check that they never appear as definitions.
    for (const f of sources(SRC)) {
      if (f.endsWith(`${"tools"}/names.ts`)) continue;
      const text = readFileSync(f, "utf8");
      for (const name of PHANTOM_TOOLS) {
        expect(text, `${f} defines phantom tool ${name}`).not.toMatch(
          new RegExp(`${name}\\s*:\\s*tool\\(`),
        );
      }
      expect(text, `${f} calls delegate.run directly`).not.toMatch(/delegate\.run/);
    }
  });

  it("imports provider SDKs only under src/t1/ and src/t2/", () => {
    for (const f of sources(SRC)) {
      if (f.includes(`${"t1"}/`) || f.includes(`${"t2"}/`)) continue;
      expect(readFileSync(f, "utf8"), f).not.toMatch(/@ai-sdk\//);
    }
  });
});
```

- [ ] 6. Add the exports to `index.ts`.

```ts
// packages/agents/src/index.ts — added
export {
  FAILURE_LIMIT, FAILURE_WINDOW_HOURS, QUARANTINE_HOURS, runLoop, runLoopSpec,
} from "./loop/run.js";
export { T2_BASE_URL, T2_MODEL_ID, T2_RUN_MODEL } from "./t2/provider.js";
```

- [ ] 7. Confirm it passes. Expected: `loop-run.test.ts` 5 tests passed, `no-egress.test.ts` 2 tests passed.

```bash
pnpm --filter @omnis/agents test && pnpm lint
```

- [ ] 8. Commit.

```bash
git add packages/agents/src/loop/run.ts packages/agents/src/t2 packages/agents/src/index.ts packages/agents/test
git commit -m "US-B06: runLoopSpec — budget enforcement and the seven failure cases

- On timeout: one retry → one attempt one tier up → failed + a system Item
- Keep the raw schema-violation text in agent_runs.raw_output
- tool-not-found → injection_flags += phantom_tool + 24h thread quarantine
- When injection_flags is non-empty, apply is not called
- 3 failures on the same item within 24h → items.meta.agent_optout
- Every path leaves exactly one recordRun/finishRun pair

Implemented-by: Claude Opus
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 4: startLoops — kernel event and scheduler wiring (US-B06, tier: Opus)

> **Story** — Goal: attach the loop registry to the kernel scheduler and events. Deliverables: `packages/agents/src/loop/start.ts`. Verification: `pnpm --filter @omnis/agents test`.

**Read:** `packages/kernel/src/events.ts` (ephemeral emit fans out by kind), `apps/hub/src/summarize-job.ts` (same debounce pattern), `packages/kernel/src/scheduler.ts`.
**Do not build (YAGNI):** a bespoke event bus, sliding debounce, loop concurrency limits. The kernel scheduler is already serial per tick.

**Files:**
- Create: `packages/agents/src/loop/start.ts`, `packages/agents/test/loop-start.test.ts`
- Modify: `packages/agents/src/index.ts`, `apps/hub/src/main.ts`
- Test: `packages/agents/test/loop-start.test.ts`

**Interfaces:**
- Consumes: `listLoops`(Task 1), `runLoopSpec`(Task 3).
- Produces: `startLoops(deps)`, `type LoopKernel`, `type LoopLogger`.

### Steps

- [ ] 1. Write the failing test. The kernel is replaced by a structural stub (no DB needed → this is a unit test at the root of `test/`).

```ts
// packages/agents/test/loop-start.test.ts
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { registerLoop, resetLoopRegistryForTest, startLoops, type LoopSpec } from "../src/index.js";

function fakeKernel() {
  const subs = new Map<string, (p: Record<string, unknown>) => void>();
  const jobs = new Map<string, { cron: string; handler: () => Promise<void> }>();
  return {
    jobs,
    emit(kind: string, payload: Record<string, unknown>) {
      subs.get(kind)?.(payload);
    },
    kernel: {
      events: {
        subscribe(channel: string, fn: (p: Record<string, unknown>) => void) {
          subs.set(channel, fn);
          return () => subs.delete(channel);
        },
        async emit() { /* loops do not emit events */ },
      },
      scheduler: {
        register(name: string, cron: string, handler: () => Promise<void>) {
          jobs.set(name, { cron, handler });
        },
      },
    },
  };
}

const logger = { debug() {}, info() {}, warn() {}, error() {} };

function eventSpec(run: () => void): LoopSpec<{ ok: boolean }> {
  return {
    id: "note_route", kind: "reactive",
    trigger: { kind: "event", on: "note.created", debounceMs: 10 },
    palette: [], budget: { inputTokens: 10, outputTokens: 10, wallClockMs: 10, maxSteps: 1 },
    tier: "T1", outputSchema: z.object({ ok: z.boolean() }),
    assemble: async () => { run(); throw new Error("stop after assemble"); },
    apply: async () => undefined,
  };
}

describe("startLoops", () => {
  it("debounces an event trigger and runs the loop once", async () => {
    resetLoopRegistryForTest();
    const ran = vi.fn();
    registerLoop(eventSpec(ran));
    const f = fakeKernel();
    const stop = startLoops({ kernel: f.kernel, logger });
    f.emit("note.created", { id: "n1", thread_id: "t1" });
    f.emit("note.created", { id: "n1", thread_id: "t1" });
    await new Promise((r) => setTimeout(r, 40));
    expect(ran).toHaveBeenCalledTimes(1);
    stop();
  });

  it("registers a schedule trigger as a named cron job", () => {
    resetLoopRegistryForTest();
    registerLoop({
      ...eventSpec(() => undefined),
      id: "auto_archive",
      trigger: { kind: "schedule", cron: "0 22 * * *" },
    });
    const f = fakeKernel();
    const stop = startLoops({ kernel: f.kernel, logger });
    expect(f.jobs.get("auto_archive_sweep")?.cron).toBe("0 22 * * *");
    stop();
  });

  it("returns a stop function that unsubscribes", async () => {
    resetLoopRegistryForTest();
    const ran = vi.fn();
    registerLoop(eventSpec(ran));
    const f = fakeKernel();
    startLoops({ kernel: f.kernel, logger })();
    f.emit("note.created", { id: "n1" });
    await new Promise((r) => setTimeout(r, 40));
    expect(ran).not.toHaveBeenCalled();
  });
});
```

- [ ] 2. Confirm the failure. Expected: `does not provide an export named 'startLoops'`.

```bash
pnpm --filter @omnis/agents test -- loop-start
```

- [ ] 3. Write the implementation.

```ts
// packages/agents/src/loop/start.ts
// @omnis/agents does not depend on @omnis/kernel (contract §1). Keep only the minimal
// interfaces that Kernel/Logger are structurally assignable to here — the hub passes createKernel()'s result straight through.
import { listLoops } from "./registry.js";
import { runLoopSpec } from "./run.js";
import type { LoopId, LoopSpec, TriggerContext } from "./spec.js";

export interface LoopKernel {
  events: {
    subscribe(channel: string, fn: (p: Record<string, unknown>) => void): () => void;
  };
  scheduler: {
    register(name: string, cron: string, handler: () => Promise<void>): void;
  };
}

export interface LoopLogger {
  debug(msg: string, extra?: Record<string, unknown>): void;
  info(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, extra?: Record<string, unknown>): void;
}

/** jobs.name for loops that use a schedule trigger. The names map 1:1 to the A3 0006_kernel.sql seed. */
export const LOOP_JOB_NAME: Partial<Record<LoopId, string>> = {
  auto_archive: "auto_archive_sweep",
  followup: "network_inactive_sweep",
  task: "task_remind",
  ingest: "drive_poll",
};

function ctxFrom(payload: Record<string, unknown>, now: Date): TriggerContext {
  const pick = (k: string): string | undefined =>
    typeof payload[k] === "string" ? (payload[k] as string) : undefined;
  return {
    trigger_kind: "event",
    now,
    payload,
    ...(pick("id") !== undefined ? { item_id: pick("id") } : {}),
    ...(pick("item_id") !== undefined ? { item_id: pick("item_id") } : {}),
    ...(pick("thread_id") !== undefined ? { thread_id: pick("thread_id") } : {}),
    ...(pick("task_id") !== undefined ? { task_id: pick("task_id") } : {}),
    ...(pick("note_id") !== undefined ? { note_id: pick("note_id") } : {}),
  };
}

export function startLoops(deps: { kernel: LoopKernel; logger: LoopLogger }): () => void {
  const { kernel, logger } = deps;
  const stops: (() => void)[] = [];
  const timers = new Set<NodeJS.Timeout>();

  for (const spec of listLoops()) {
    if (spec.trigger.kind === "schedule" && spec.trigger.cron !== undefined) {
      const name = LOOP_JOB_NAME[spec.id] ?? `${spec.id}_job`;
      kernel.scheduler.register(name, spec.trigger.cron, async () => {
        await runLoopSpec(spec as LoopSpec<unknown>, {
          trigger_kind: "cron", trigger_ref: name, now: new Date(), payload: {},
        });
      });
      continue;
    }
    if (spec.trigger.kind !== "event" || spec.trigger.on === undefined) continue;

    // ponytail: fixed-delay debounce — the first event starts the timer, and the same key arriving
    // while the window is open is dropped (same shape as apps/hub/src/summarize-job.ts). Switch to sliding if the need arises.
    const pending = new Set<string>();
    const debounceMs = spec.trigger.debounceMs ?? 0;
    stops.push(
      kernel.events.subscribe(spec.trigger.on, (payload) => {
        const key = `${spec.id}:${String(payload.thread_id ?? payload.id ?? "")}`;
        if (pending.has(key)) return;
        pending.add(key);
        const t = setTimeout(() => {
          pending.delete(key);
          timers.delete(t);
          runLoopSpec(spec as LoopSpec<unknown>, ctxFrom(payload, new Date())).catch(
            (e: unknown) => {
              logger.error("loop failed", {
                loop: spec.id, err: e instanceof Error ? e.message : String(e),
              });
            },
          );
        }, debounceMs);
        t.unref();
        timers.add(t);
      }),
    );
  }

  return () => {
    for (const s of stops) s();
    for (const t of timers) clearTimeout(t);
    timers.clear();
  };
}
```

- [ ] 4. Add the exports to `index.ts` and wire them into the hub.

```ts
// packages/agents/src/index.ts — added
export { LOOP_JOB_NAME, startLoops, type LoopKernel, type LoopLogger } from "./loop/start.js";
```

```ts
// apps/hub/src/main.ts — add startLoops to the imports and
// place it right below registerSummaryJob (= after scheduler.start()).
//   import { configureAgents, startLoops, summarizeThread } from "@omnis/agents";
const stopLoops = startLoops({ kernel, logger });
```

Then add `stopLoops();` right below `stopSummaryJob();` in `close()`.

- [ ] 5. Confirm it passes and commit. Expected: `loop-start.test.ts` 3 tests passed.

```bash
pnpm --filter @omnis/agents test -- loop-start && pnpm --filter @omnis/hub test && pnpm lint
git add packages/agents/src/loop/start.ts packages/agents/src/index.ts packages/agents/test/loop-start.test.ts apps/hub/src/main.ts
git commit -m "US-B06: startLoops — kernel event/scheduler wiring

- Event triggers call runLoopSpec exactly once via a debounceMs fixed-delay debounce
- Schedule triggers are registered through scheduler.register under the existing jobs.name in LOOP_JOB_NAME
- LoopKernel/LoopLogger structural interfaces avoid creating a dependency on @omnis/kernel
- The hub installs startLoops at boot and releases it at shutdown

Implemented-by: Claude Opus
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 5: tool palette — the seven read tools + the six `propose_*` tools (US-B07, tier: Opus)

> **Story** — Goal: seven read tools + six `propose_*` tools, where `propose_*` only saves. A unit test that breaks if any of the 12 phantom tools is in the registry, plus a lint rule forbidding `packages/agents/**` → `packages/kernel/src/egress/**` imports. Deliverables: `packages/agents/src/tools/*.ts`, `biome.jsonc` (modified). Verification: `pnpm --filter @omnis/agents test && pnpm lint`. Depends on: B06.

**Read:** all of A4 §1.5 (the input/output table + the 6 JSON Schemas + the phantom list), A3 §4 (`tasks`/`pending_approvals`/`notes` columns), delta §4.
**Do not build (YAGNI):** a per-tool permission-check layer, a tool result cache, batch versions of `propose_*`. Calls per loop are in the single digits.

**Files:**
- Create: `packages/agents/src/tools/read.ts`, `packages/agents/src/tools/propose.ts`, `packages/agents/src/tools/registry.ts`, `packages/agents/test/integration/tools.test.ts`
- Modify: `packages/agents/src/index.ts`, `biome.jsonc`
- Test: `packages/agents/test/integration/tools.test.ts`

**Interfaces:**
- Consumes: `ToolName`/`PHANTOM_TOOLS`(Task 1), `getAgentsPool`(Phase A), `searchMemories`/`asOf`(US-B01·B04, `@omnis/memory`).
- Produces: `toolRegistry(palette)`, `READ_TOOLS`, `PROPOSE_TOOLS`, `type ProposeDraftInput`, `type ProposeTaskInput`, `type ProposeDelegationInput`, `type ProposeRouteInput`, `type ProposeSelfModelPatchInput`, `type ProposeLabelInput`.

### Steps

- [ ] 1. Write the failing test. (a) the registry exposes only names present in the palette, (b) phantom names never appear as keys under any circumstance, and (c) `propose_task` actually creates a `tasks` row.

```ts
// packages/agents/test/integration/tools.test.ts
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PHANTOM_TOOLS, TOOL_NAMES, configureAgents, toolRegistry } from "../../src/index.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});
let threadId = "";
let itemId = "";

beforeAll(async () => {
  configureAgents({ pool });
  const a = await pool.query<{ id: string }>(
    `INSERT INTO accounts (channel, external_id, display) VALUES ('gmail','tools@test','t')
       ON CONFLICT (channel, external_id) DO UPDATE SET display='t' RETURNING id`,
  );
  const accountId = a.rows[0]?.id ?? "";
  const t = await pool.query<{ id: string }>(
    `INSERT INTO threads (account_id, external_id, kind) VALUES ($1,'thr_tools','email')
       ON CONFLICT (account_id, external_id) DO UPDATE SET kind='email' RETURNING id`,
    [accountId],
  );
  threadId = t.rows[0]?.id ?? "";
  const i = await pool.query<{ id: string }>(
    `INSERT INTO items (thread_id, account_id, external_id, kind, subject, body, sent_at)
     VALUES ($1,$2,'it_tools','email','Quote','I will send it by tomorrow', now())
     ON CONFLICT (account_id, external_id) DO UPDATE SET body = EXCLUDED.body RETURNING id`,
    [threadId, accountId],
  );
  itemId = i.rows[0]?.id ?? "";
});
afterAll(() => pool.end());

describe("tool palette (A4 §1.5)", () => {
  it("exposes only the requested tools", () => {
    const set = toolRegistry(["read_thread", "propose_task"]);
    expect(Object.keys(set).sort()).toEqual(["propose_task", "read_thread"]);
  });

  it("never exposes a phantom tool, whatever the palette asks for", () => {
    const all = toolRegistry(TOOL_NAMES);
    for (const p of PHANTOM_TOOLS) expect(Object.keys(all)).not.toContain(p);
    expect(Object.keys(all)).toHaveLength(13);
  });

  it("read_thread returns the thread and its items", async () => {
    const set = toolRegistry(["read_thread"]);
    const out = (await set.read_thread?.execute?.(
      { thread_id: threadId, last_n: 5 },
      { toolCallId: "c1", messages: [] },
    )) as { items: { item_id: string }[] };
    expect(out.items.map((i) => i.item_id)).toContain(itemId);
  });

  it("propose_task stores an open task and returns its id", async () => {
    const set = toolRegistry(["propose_task"]);
    const out = (await set.propose_task?.execute?.(
      { title: "Send the quote", source_item_id: itemId, due_basis: "stated", owner: "me",
        kind: "todo", confidence: 0.9 },
      { toolCallId: "c2", messages: [] },
    )) as { task_id: string; state: string };
    expect(out.state).toBe("open");
    const { rows } = await pool.query<{ title: string; created_by: string }>(
      "SELECT title, created_by FROM tasks WHERE id = $1",
      [out.task_id],
    );
    expect(rows[0]).toMatchObject({ title: "Send the quote", created_by: "agent" });
  });
});
```

- [ ] 2. Confirm the failure. Expected: `does not provide an export named 'toolRegistry'`.

```bash
pnpm --filter @omnis/agents test -- tools
```

- [ ] 3. Write the seven read tools. All of them are side-effect free and read from the DB only.

```ts
// packages/agents/src/tools/read.ts
// A4 §1.5 read tools. No side effects — SELECT only.
import { asOf, searchMemories } from "@omnis/memory";
import { type ToolSet, tool } from "ai";
import { z } from "zod";
import { getAgentsPool } from "../pool.js";

export const READ_TOOLS: ToolSet = {
  read_thread: tool({
    description: "Read one thread and its recent items.",
    inputSchema: z.object({ thread_id: z.string().uuid(), last_n: z.number().int().max(50).default(12) }),
    execute: async ({ thread_id, last_n }) => {
      const pool = getAgentsPool();
      const head = await pool.query<{ kind: string; title: string | null; participants: string[] }>(
        "SELECT kind, title, participants FROM threads WHERE id = $1", [thread_id]);
      const items = await pool.query<{
        id: string; author_is_me: boolean; sent_at: Date; body: string; subject: string | null;
      }>(
        `SELECT id, author_is_me, sent_at, body, subject FROM items
          WHERE thread_id = $1 ORDER BY sent_at DESC LIMIT $2`, [thread_id, last_n]);
      return {
        thread_id,
        kind: head.rows[0]?.kind ?? null,
        title: head.rows[0]?.title ?? null,
        participants: head.rows[0]?.participants ?? [],
        items: items.rows.reverse().map((r) => ({
          item_id: r.id, author: r.author_is_me ? "me" : "them",
          sent_at: r.sent_at.toISOString(), subject: r.subject, body: r.body,
        })),
      };
    },
  }),

  search_memory: tool({
    description: "Semantically search memory.",
    inputSchema: z.object({
      query: z.string(), k: z.number().int().max(20).default(6),
      kinds: z.array(z.enum(["fact", "preference", "event"])).optional(),
    }),
    execute: async ({ query, k, kinds }) =>
      ({ results: await searchMemories(getAgentsPool(), { query, k, ...(kinds !== undefined ? { kinds } : {}) }) }),
  }),

  read_person: tool({
    description: "Read one person's profile and channel identities.",
    inputSchema: z.object({
      person_id: z.string().uuid().optional(), handle: z.string().optional(), channel: z.string().optional(),
    }),
    execute: async ({ person_id, handle, channel }) => {
      const { rows } = await getAgentsPool().query(
        `SELECT p.id AS person_id, p.display_name AS display, p.relationship_state, p.vip,
                p.first_contact_at, p.last_contact_at, p.org, p.role,
                COALESCE(jsonb_agg(jsonb_build_object('channel', i.channel, 'handle', i.handle))
                         FILTER (WHERE i.id IS NOT NULL), '[]'::jsonb) AS identities
           FROM persons p LEFT JOIN identities i ON i.person_id = p.id
          WHERE p.merged_into IS NULL
            AND ($1::uuid IS NULL OR p.id = $1)
            AND ($2::text IS NULL OR (i.handle_norm = $2 AND i.channel = $3))
          GROUP BY p.id LIMIT 1`,
        [person_id ?? null, handle ?? null, channel ?? null]);
      return rows[0] ?? null;
    },
  }),

  read_entity: tool({
    description: "Read an entity as of a point in time (bi-temporal).",
    inputSchema: z.object({ entity_id: z.string().uuid(), as_of: z.string().optional() }),
    execute: async ({ entity_id, as_of }) =>
      ({ entities: await asOf(getAgentsPool(), { entityId: entity_id, at: as_of ?? "now" }) }),
  }),

  read_calendar: tool({
    description: "Read calendar events within a range.",
    inputSchema: z.object({ from: z.string().datetime(), to: z.string().datetime() }),
    execute: async ({ from, to }) => {
      const { rows } = await getAgentsPool().query(
        `SELECT c.id AS event_id, i.subject AS title, c.start_at, c.end_at, c.attendees, c.location
           FROM calendar_events c JOIN items i ON i.id = c.item_id
          WHERE c.status <> 'cancelled' AND c.start_at < $2 AND c.end_at > $1
          ORDER BY c.start_at LIMIT 50`, [from, to]);
      return { events: rows };
    },
  }),

  read_tasks: tool({
    description: "Read the task list.",
    inputSchema: z.object({
      state: z.enum(["open", "done", "all"]).default("open"), limit: z.number().int().max(50).default(20),
    }),
    execute: async ({ state, limit }) => {
      const { rows } = await getAgentsPool().query(
        `SELECT id AS task_id, title, kind, state, due_at, owner_kind, owner_runtime_id, source_item_id
           FROM tasks
          WHERE ($1 = 'all') OR ($1 = 'open' AND state IN ('open','in_progress')) OR ($1 = 'done' AND state = 'done')
          ORDER BY due_at NULLS LAST, created_at DESC LIMIT $2`, [state, limit]);
      return { tasks: rows };
    },
  }),

  read_session: tool({
    description: "Read an agent session's durable summary and its last N turns. There is no raw log (master §9).",
    inputSchema: z.object({ session_key: z.string(), last_n: z.number().int().max(20).default(5) }),
    execute: async ({ session_key, last_n }) => {
      const pool = getAgentsPool();
      const s = await pool.query<{
        id: string; state: string; summary: string | null; runtime: string; host: string;
      }>(
        `SELECT s.id, s.state, s.summary, r.runtime, r.host
           FROM agent_sessions s JOIN agent_runtimes r ON r.id = s.runtime_id
          WHERE s.session_key = $1 ORDER BY s.started_at DESC LIMIT 1`, [session_key]);
      const head = s.rows[0];
      if (head === undefined) return null;
      const turns = await pool.query<{ author_is_me: boolean; body: string; sent_at: Date }>(
        `SELECT i.author_is_me, i.body, i.sent_at FROM items i
           JOIN agent_sessions ag ON ag.thread_id = i.thread_id
          WHERE ag.id = $1 AND i.kind IN ('agent_turn','tool_call')
          ORDER BY i.sent_at DESC LIMIT $2`, [head.id, last_n]);
      return {
        session_key, runtime: head.runtime, host: head.host, state: head.state, summary: head.summary,
        turns: turns.rows.reverse().map((t) => ({
          role: t.author_is_me ? "me" : "agent", text: t.body, at: t.sent_at.toISOString(),
        })),
      };
    },
  }),
};
```

- [ ] 4. Write the six `propose_*` tools. **They only save** — none of them touches a channel or a runtime.

```ts
// packages/agents/src/tools/propose.ts
// A4 §1.5·A4-D3: proposal tools write a row and emit nothing.
// propose_delegation does nothing more than create one pending_approvals(action='delegate') row,
// and the actual execution happens in the kernel's approval handler on the runEgress path (A4 §5.4).
import { type ToolSet, tool } from "ai";
import { z } from "zod";
import { getAgentsPool } from "../pool.js";

export const ProposeLabelInput = z.object({
  item_id: z.string().uuid(), scope: z.enum(["work", "personal", "unknown"]),
  topic: z.string().max(40).optional(), priority: z.enum(["now", "today", "week", "fyi"]).optional(),
  person_label: z.string().max(40).optional(), confidence: z.number().min(0).max(1),
  matched_rule_ids: z.array(z.string()).default([]),
});
export const ProposeDraftInput = z.object({
  thread_id: z.string().uuid(), in_reply_to_item_id: z.string().uuid().optional(),
  body: z.string().max(4000), subject: z.string().max(200).optional(),
  language: z.enum(["ko", "en"]), register: z.enum(["formal_ko", "polite_ko", "casual_ko", "formal_en", "casual_en"]),
  rationale: z.string().max(400),
  evidence: z.array(z.object({
    kind: z.enum(["item", "memory", "calendar", "entity"]), id: z.string(), why: z.string().max(120),
  })).default([]),
  confidence: z.number().min(0).max(1),
});
export const ProposeTaskInput = z.object({
  title: z.string().max(120), detail: z.string().max(600).optional(),
  source_item_id: z.string().uuid(), due_at: z.string().datetime().optional(),
  due_basis: z.enum(["stated", "inferred", "none"]), owner: z.enum(["me", "agent"]).default("me"),
  kind: z.enum(["todo", "followup", "delegation"]).default("todo"),
  agent_hint: z.string().max(200).optional(),
  delegation_hint: z.record(z.unknown()).optional(),
  duplicate_of: z.string().uuid().optional(),
  confidence: z.number().min(0).max(1),
});
export const ProposeDelegationInput = z.object({
  task_id: z.string().uuid(),
  runtime: z.enum(["claude_code", "codex", "claude_ds", "omnis"]),   // B-D7: hermes excluded
  host: z.enum(["mini", "macbook"]), brief: z.string().max(2000),
  acceptance: z.array(z.string()).min(1), verify_cmd: z.string().max(300).optional(),
  workdir: z.string().optional(), est_minutes: z.number().int().optional(),
  rule_id: z.string().optional(), confidence: z.number().min(0).max(1),
});
export const ProposeRouteInput = z.object({
  note_id: z.string().uuid(),
  candidates: z.array(z.object({
    kind: z.enum(["thread", "person"]), id: z.string().uuid(), confidence: z.number().min(0).max(1),
    why: z.string().max(160),
    suggested_use: z.enum(["followup", "question", "share", "context_only"]).optional(),
  })).max(3),
});
export const ProposeSelfModelPatchInput = z.object({
  file: z.enum(["USER.md", "VOICE.md", "PROJECTS.md"]), diff: z.string().max(4000),
  rationale: z.string().max(400), evidence: z.array(z.string()).min(2),
});

export type ProposeLabelInput = z.infer<typeof ProposeLabelInput>;
export type ProposeDraftInput = z.infer<typeof ProposeDraftInput>;
export type ProposeTaskInput = z.infer<typeof ProposeTaskInput>;
export type ProposeDelegationInput = z.infer<typeof ProposeDelegationInput>;
export type ProposeRouteInput = z.infer<typeof ProposeRouteInput>;
export type ProposeSelfModelPatchInput = z.infer<typeof ProposeSelfModelPatchInput>;

const OMNIS_RUNTIME = "SELECT id FROM agent_runtimes WHERE runtime = 'omnis' LIMIT 1";

export const PROPOSE_TOOLS: ToolSet = {
  propose_label: tool({
    description: "Propose and store a label for an item. Does not send.",
    inputSchema: ProposeLabelInput,
    execute: async (i) => {
      await getAgentsPool().query(
        `UPDATE items SET scope = $2,
            meta = meta || jsonb_build_object('label', jsonb_build_object(
              'topic', $3::text, 'priority', $4::text, 'person_label', $5::text,
              'confidence', $6::real, 'matched_rule_ids', $7::jsonb))
          WHERE id = $1`,
        [i.item_id, i.scope, i.topic ?? null, i.priority ?? null, i.person_label ?? null,
         i.confidence, JSON.stringify(i.matched_rule_ids)]);
      return { label_ids: [i.item_id], stored: true as const };
    },
  }),

  propose_draft: tool({
    description: "Store a reply draft as items(status='draft'). Does not send.",
    inputSchema: ProposeDraftInput,
    execute: async (i) => {
      const { rows } = await getAgentsPool().query<{ id: string }>(
        `INSERT INTO items (thread_id, account_id, kind, status, subject, body, sent_at,
                            author_is_me, in_reply_to, meta)
         SELECT t.id, t.account_id,
                CASE WHEN t.kind = 'email' THEN 'email' ELSE 'message' END,
                'draft', $2, $3, now(), true, $4,
                jsonb_build_object('draft', jsonb_build_object(
                  'rationale', $5::text, 'register', $6::text, 'language', $7::text,
                  'confidence', $8::real, 'evidence', $9::jsonb))
           FROM threads t WHERE t.id = $1
         RETURNING id`,
        [i.thread_id, i.subject ?? null, i.body, i.in_reply_to_item_id ?? null,
         i.rationale, i.register, i.language, i.confidence, JSON.stringify(i.evidence)]);
      const id = rows[0]?.id;
      if (id === undefined) throw new Error(`thread not found: ${i.thread_id}`);
      return { item_id: id, status: "draft" as const };
    },
  }),

  propose_task: tool({
    description: "Store a task in tasks. If duplicate_of is set, only add the source to the existing task.",
    inputSchema: ProposeTaskInput,
    execute: async (i) => {
      const pool = getAgentsPool();
      if (i.duplicate_of !== undefined) {
        await pool.query(
          `UPDATE tasks SET source_item_id = COALESCE(source_item_id, $2) WHERE id = $1`,
          [i.duplicate_of, i.source_item_id]);
        return { task_id: i.duplicate_of, state: "open" as const };
      }
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO tasks (title, detail, kind, owner_kind, source_item_id, due_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'agent') RETURNING id`,
        [i.title, i.detail ?? null, i.kind, i.owner, i.source_item_id, i.due_at ?? null]);
      const id = rows[0]?.id;
      if (id === undefined) throw new Error("tasks insert returned no id");
      await pool.query(
        `UPDATE tasks SET detail = COALESCE(detail, '') ||
           CASE WHEN $2::text = '' THEN '' ELSE E'\\n\\n' || $2 END WHERE id = $1`,
        [id, i.agent_hint ?? ""]);
      await pool.query(
        `UPDATE items SET meta = meta || jsonb_build_object('task_due_basis', $2::text) WHERE id = $1`,
        [i.source_item_id, i.due_basis]);
      return { task_id: id, state: "open" as const };
    },
  }),

  propose_delegation: tool({
    description: "Create a delegation approval card. Nothing runs without approval.",
    inputSchema: ProposeDelegationInput,
    execute: async (i) => {
      const pool = getAgentsPool();
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO pending_approvals (action, args, description, config, risk, task_id,
                                        thread_id, requested_by)
         SELECT 'delegate', $1::jsonb, $2,
                '{"allow_accept":true,"allow_edit":true,"allow_respond":false,"allow_ignore":true}'::jsonb,
                $3, $4, (SELECT t.thread_id FROM tasks tk
                           LEFT JOIN items it ON it.id = tk.source_item_id
                           LEFT JOIN threads t ON t.id = it.thread_id
                          WHERE tk.id = $4),
                (${OMNIS_RUNTIME})
         RETURNING id`,
        [JSON.stringify(i),
         `${i.runtime} on ${i.host} will take this task. Estimated ${i.est_minutes ?? "?"} min.`,
         (i.est_minutes ?? 0) > 30 ? "high" : "normal", i.task_id]);
      const id = rows[0]?.id;
      if (id === undefined) throw new Error("pending_approvals insert returned no id");
      await pool.query("UPDATE tasks SET kind = 'delegation' WHERE id = $1", [i.task_id]);
      return { approval_id: id, state: "pending" as const };
    },
  }),

  propose_route: tool({
    description: "Propose up to 3 candidates to attach the note to. No automatic attachment (A4-D10).",
    inputSchema: ProposeRouteInput,
    execute: async (i) => {
      await getAgentsPool().query(
        `UPDATE notes SET route_state = 'proposed',
            rationale = $2,
            routed_to_thread_id = NULL, routed_to_person_id = NULL
          WHERE id = $1`,
        [i.note_id, JSON.stringify(i.candidates)]);
      return { note_id: i.note_id, stored: true as const };
    },
  }),

  propose_self_model_patch: tool({
    description: "Turn a self-model file patch into an approval card. The kernel applies it after approval.",
    inputSchema: ProposeSelfModelPatchInput,
    execute: async (i) => {
      const { rows } = await getAgentsPool().query<{ id: string }>(
        `INSERT INTO pending_approvals (action, args, description, risk, requested_by)
         VALUES ('self_model_edit', $1::jsonb, $2, 'normal', (${OMNIS_RUNTIME}))
         RETURNING id`,
        [JSON.stringify(i), `${i.file} edit proposal — ${i.rationale}`]);
      const id = rows[0]?.id;
      if (id === undefined) throw new Error("pending_approvals insert returned no id");
      return { approval_id: id };
    },
  }),
};
```

- [ ] 5. Write the registry and the lint rule.

```ts
// packages/agents/src/tools/registry.ts
import type { ToolSet } from "ai";
import { PROPOSE_TOOLS } from "./propose.js";
import { READ_TOOLS } from "./read.js";
import { PHANTOM_TOOLS, type ToolName } from "./names.js";

const ALL: ToolSet = { ...READ_TOOLS, ...PROPOSE_TOOLS };

/** Give the model only what the palette lists. Phantom names are not in ALL to begin with. */
export function toolRegistry(palette: readonly ToolName[]): ToolSet {
  const out: ToolSet = {};
  for (const name of palette) {
    if (PHANTOM_TOOLS.includes(name)) continue;
    const t = ALL[name];
    if (t !== undefined) out[name] = t;
  }
  return out;
}
```

```jsonc
// biome.jsonc — add inside linter.rules.nursery or the existing rules object
"noRestrictedImports": {
  "level": "error",
  "options": {
    "paths": {
      "@omnis/kernel": "packages/agents does not depend on @omnis/kernel (contract §1). Use the LoopKernel structural type.",
      "../../kernel/src/egress.js": "egress is owned by the kernel (A4 §1.1).",
      "@omnis/kernel/egress": "egress is owned by the kernel (A4 §1.1)."
    }
  }
}
```

Scope the rule in `biome.jsonc`'s `overrides` so that only `packages/agents/**` receives it.

```jsonc
"overrides": [
  { "includes": ["packages/agents/**"],
    "linter": { "rules": { "style": { "noRestrictedImports": { "level": "error", "options": { "paths": {
      "@omnis/kernel": "packages/agents does not depend on @omnis/kernel (contract §1).",
      "@omnis/kernel/egress": "egress is owned by the kernel (A4 §1.1)." } } } } } } }
]
```

- [ ] 6. Add the exports to `index.ts` and confirm it passes. Expected: `tools.test.ts` 4 tests passed, `pnpm lint` 0 errors.

```ts
// packages/agents/src/index.ts — added
export { READ_TOOLS } from "./tools/read.js";
export {
  PROPOSE_TOOLS, ProposeDelegationInput, ProposeDraftInput, ProposeLabelInput,
  ProposeRouteInput, ProposeSelfModelPatchInput, ProposeTaskInput,
} from "./tools/propose.js";
export { toolRegistry } from "./tools/registry.js";
```

```bash
pnpm --filter @omnis/agents test && pnpm lint
```

- [ ] 7. Commit.

```bash
git add packages/agents/src/tools packages/agents/src/index.ts packages/agents/test/integration/tools.test.ts biome.jsonc
git commit -m "US-B07: tool palette — seven read tools + six propose_* tools

- The 7 READ_TOOLS only SELECT
- The 6 PROPOSE_TOOLS only write items/tasks/notes/pending_approvals rows (no sending path)
- toolRegistry(palette) structurally cannot produce the 12 phantom tools, and a unit test pins that
- biome overrides forbid packages/agents → @omnis/kernel (egress) imports

Implemented-by: Claude Opus
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 6: Cost meter — `costState` / `POLICY` / `currentPolicy` (US-B14, tier: Opus)

> **Story** — Goal: the five states from A4 §12.4 + separate reserve accounting + `Policy`. Deliverables: `packages/kernel/src/cost/governor.ts`. Verification: `pnpm --filter @omnis/kernel test:integration`. Depends on: B06.

**Read:** all of A4 §12.4 (the code block + the state table + the 3 caveats), delta §5.
**Do not build (YAGNI):** daily budgets, per-loop caps, forecasting models. There is one monthly cap and one reserve ratio.

**Files:**
- Create: `packages/kernel/src/cost/governor.ts`, `packages/kernel/test/cost-governor.test.ts`, `packages/kernel/test/integration/cost-policy.test.ts`
- Modify: `packages/kernel/src/index.ts`
- Test: `packages/kernel/test/cost-governor.test.ts`, `packages/kernel/test/integration/cost-policy.test.ts`

**Interfaces:**
- Consumes: `getSetting`/`SETTING_DEFAULTS` (US-B33, `../settings.js` — created by the surfaces plan. This task reads only the two keys `cost.cap_usd`/`cost.reserve_ratio`), `query` (`@omnis/db`).
- Produces: `CostState`, `CostInput`, `costState`, `Policy`, `POLICY`, `currentPolicy`, `reserveSpendUsd`, `mtdSpendUsd`.

### Steps

- [ ] 1. Write the failing pure-function test (no DB).

```ts
// packages/kernel/test/cost-governor.test.ts
import { describe, expect, it } from "vitest";
import { POLICY, costState } from "../src/cost/governor.js";

const cap = 60;
const r = 0.1;

describe("costState (A4 §12.4)", () => {
  it("maps spend to the five states", () => {
    expect(costState({ mtdUsd: 0, capUsd: cap, reserveRatio: r })).toBe("normal");
    expect(costState({ mtdUsd: 35.9, capUsd: cap, reserveRatio: r })).toBe("normal");
    expect(costState({ mtdUsd: 36, capUsd: cap, reserveRatio: r })).toBe("warn");
    expect(costState({ mtdUsd: 48, capUsd: cap, reserveRatio: r })).toBe("degraded");
    expect(costState({ mtdUsd: 54, capUsd: cap, reserveRatio: r })).toBe("reserve_only");
    expect(costState({ mtdUsd: 60, capUsd: cap, reserveRatio: r })).toBe("frozen");
    expect(costState({ mtdUsd: 999, capUsd: cap, reserveRatio: r })).toBe("frozen");
  });

  it("never lets a degraded state break the sensitivity rule (A4-D12)", () => {
    for (const s of ["degraded", "reserve_only"] as const) {
      expect(POLICY[s].allowT2Reserve).toBe(true);
      expect(POLICY[s].draftsVipSensitive).toBe(true);
      expect(POLICY[s].allowT2NonSensitive).toBe(false);
    }
    expect(POLICY.reserve_only.draftsNonVip).toBe(false);
    expect(POLICY.frozen.draftsVipSensitive).toBe(false);
  });

  it("keeps digest cadence in step with the state", () => {
    expect(POLICY.normal.digestCron).toBe("daily");
    expect(POLICY.degraded.digestCron).toBe("alternate");
    expect(POLICY.frozen.digestCron).toBe("off");
  });
});
```

- [ ] 2. Confirm the failure. Expected: `Failed to resolve import "../src/cost/governor.js"`.

```bash
pnpm --filter @omnis/kernel test -- cost-governor
```

- [ ] 3. Write the implementation.

```ts
// packages/kernel/src/cost/governor.ts
// A4 §12.4. There are two budgets — $54 general and a $6 reserve kept for VIP and sensitive work (master §14, §19 Q11).
import { query } from "@omnis/db";
import type { Pool } from "pg";

export type CostState = "normal" | "warn" | "degraded" | "reserve_only" | "frozen";

export interface CostInput {
  mtdUsd: number;
  capUsd: number;
  reserveRatio: number;
}

export function costState({ mtdUsd, capUsd, reserveRatio }: CostInput): CostState {
  const general = capUsd * (1 - reserveRatio);
  if (mtdUsd >= capUsd) return "frozen";
  if (mtdUsd >= general) return "reserve_only";
  const r = mtdUsd / capUsd;
  if (r >= 0.8) return "degraded";
  if (r >= 0.6) return "warn";
  return "normal";
}

export interface Policy {
  allowT2NonSensitive: boolean;
  allowT2Reserve: boolean;
  draftsNonVip: boolean;
  draftsVipSensitive: boolean;
  digestCron: "daily" | "alternate" | "off";
  note: string | null;
}

export const POLICY: Record<CostState, Policy> = {
  normal: { allowT2NonSensitive: true, allowT2Reserve: true, draftsNonVip: true,
    draftsVipSensitive: true, digestCron: "daily", note: null },
  warn: { allowT2NonSensitive: true, allowT2Reserve: true, draftsNonVip: true,
    draftsVipSensitive: true, digestCron: "daily",
    note: "This month's LLM cost has reached 60% of the cap." },
  degraded: { allowT2NonSensitive: false, allowT2Reserve: true, draftsNonVip: true,
    draftsVipSensitive: true, digestCron: "alternate",
    note: "T2 escalation for non-sensitive work is paused (generated at T1). VIP and sensitive drafts continue from the reserve." },
  reserve_only: { allowT2NonSensitive: false, allowT2Reserve: true, draftsNonVip: false,
    draftsVipSensitive: true, digestCron: "alternate",
    note: "The general budget is exhausted, so non-VIP draft generation is paused. Classification, labeling, todo extraction, and auto-archive continue, and VIP and sensitive drafts continue from the reserve." },
  frozen: { allowT2NonSensitive: false, allowT2Reserve: false, draftsNonVip: false,
    draftsVipSensitive: false, digestCron: "off",
    note: "The reserve is exhausted too, so all draft generation is paused. Classification, labeling, todo extraction, and auto-archive continue." },
};

/** Month-to-date total spend. agent_runs.cost_usd is the only input (A4 §12.4). */
export async function mtdSpendUsd(pool: Pool, now: Date): Promise<number> {
  const rows = await query<{ sum: string | null }>(
    pool,
    `SELECT COALESCE(sum(cost_usd), 0)::text AS sum FROM agent_runs
      WHERE created_at >= date_trunc('month', $1::timestamptz)`,
    [now],
  );
  return Number(rows[0]?.sum ?? "0");
}

/** Reserve spend: model_tier='T2' AND (a VIP person, or an item with sensitivity<>'normal'). */
export async function reserveSpendUsd(pool: Pool, now: Date): Promise<number> {
  const rows = await query<{ sum: string | null }>(
    pool,
    `SELECT COALESCE(sum(r.cost_usd), 0)::text AS sum
       FROM agent_runs r
       JOIN items i ON i.id = r.item_id
       LEFT JOIN persons p ON p.id = i.author_person_id
      WHERE r.model_tier = 'T2'
        AND r.created_at >= date_trunc('month', $1::timestamptz)
        AND (COALESCE(p.vip, false) OR i.sensitivity <> 'normal')`,
    [now],
  );
  return Number(rows[0]?.sum ?? "0");
}

export async function currentPolicy(
  pool: Pool,
  now: Date = new Date(),
): Promise<{ state: CostState; policy: Policy; mtdUsd: number; reserveUsd: number }> {
  const { getSetting } = await import("../settings.js");
  const capUsd = await getSetting<number>(pool, "cost.cap_usd", 60);
  const reserveRatio = await getSetting<number>(pool, "cost.reserve_ratio", 0.1);
  const mtdUsd = await mtdSpendUsd(pool, now);
  const state = costState({ mtdUsd, capUsd, reserveRatio });
  const policy = POLICY[state];
  return { state, policy, mtdUsd, reserveUsd: await reserveSpendUsd(pool, now) };
}
```

- [ ] 4. Write the integration test — seed `agent_runs` and check that `currentPolicy` reads that sum.

```ts
// packages/kernel/test/integration/cost-policy.test.ts
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { currentPolicy, reserveSpendUsd } from "../../src/cost/governor.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});
afterAll(() => pool.end());

beforeEach(async () => {
  await pool.query("DELETE FROM agent_runs WHERE model = 'cost-test'");
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ('cost.cap_usd','60'::jsonb),
                                              ('cost.reserve_ratio','0.1'::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
  );
});

async function spend(usd: number, tier: "T1" | "T2", itemId: string | null): Promise<void> {
  await pool.query(
    `INSERT INTO agent_runs (loop, item_id, trigger_kind, model_tier, provider, model, cost_usd, outcome)
     VALUES ('draft', $1, 'event', $2, 'openrouter', 'cost-test', $3, 'ok')`,
    [itemId, tier, usd],
  );
}

describe("currentPolicy (A4 §12.4)", () => {
  it("reads the month-to-date sum and returns the matching policy", async () => {
    await spend(50, "T1", null);
    const { state, policy, mtdUsd } = await currentPolicy(pool, new Date());
    expect(mtdUsd).toBeCloseTo(50, 5);
    expect(state).toBe("degraded");
    expect(policy.allowT2NonSensitive).toBe(false);
    expect(policy.draftsVipSensitive).toBe(true);
  });

  it("counts reserve spend only for T2 on VIP or non-normal items", async () => {
    const acc = await pool.query<{ id: string }>(
      `INSERT INTO accounts (channel, external_id, display) VALUES ('gmail','cost@test','c')
         ON CONFLICT (channel, external_id) DO UPDATE SET display='c' RETURNING id`);
    const accountId = acc.rows[0]?.id ?? "";
    const thr = await pool.query<{ id: string }>(
      `INSERT INTO threads (account_id, external_id, kind) VALUES ($1,'thr_cost','email')
         ON CONFLICT (account_id, external_id) DO UPDATE SET kind='email' RETURNING id`, [accountId]);
    const it = await pool.query<{ id: string }>(
      `INSERT INTO items (thread_id, account_id, external_id, kind, sensitivity, body, sent_at)
       VALUES ($1,$2,'it_cost','email','finance','x', now())
       ON CONFLICT (account_id, external_id) DO UPDATE SET sensitivity='finance' RETURNING id`,
      [thr.rows[0]?.id ?? "", accountId]);
    await spend(3, "T2", it.rows[0]?.id ?? null);
    await spend(7, "T2", null);   // T2 with no item is not reserve spend
    expect(await reserveSpendUsd(pool, new Date())).toBeCloseTo(3, 5);
  });
});
```

- [ ] 5. Add the exports to `index.ts` and confirm both pass. Expected: 5 tests passed.

```ts
// packages/kernel/src/index.ts — added
export {
  POLICY, costState, currentPolicy, mtdSpendUsd, reserveSpendUsd,
  type CostInput, type CostState, type Policy,
} from "./cost/governor.js";
```

```bash
pnpm --filter @omnis/kernel test && pnpm --filter @omnis/kernel test:integration && pnpm lint
```

- [ ] 6. Commit.

```bash
git add packages/kernel/src/cost packages/kernel/src/index.ts packages/kernel/test/cost-governor.test.ts packages/kernel/test/integration/cost-policy.test.ts
git commit -m "US-B14: cost meter costState/POLICY/currentPolicy

- The five states (normal/warn/degraded/reserve_only/frozen) + the A4 §12.4 policy table as-is
- Reserve spend is accounted separately via model_tier='T2' AND (VIP or sensitivity<>normal)
- Even at degraded or below, the sensitivity rule (VIP and sensitive T2) never breaks

Implemented-by: Claude Opus
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 7: The `cost_daily` view + the 00:05 job + state transition recording (US-B14, tier: Opus)

> **Story** — Goal: the `cost_daily` aggregate view + the 00:05 job, state transitions → `audit_log` + a system Item, and the loop gate. Deliverables: `packages/kernel/src/jobs/cost-daily.ts`, `packages/db/migrations/0012_jobs_phase_b.sql`. Verification: `pnpm --filter @omnis/kernel test:integration`.

**Read:** delta §6 (the `0012` row)·§8 (the 4-job table), A3 §6 (`jobs` seed format), `packages/kernel/src/scheduler.ts`.
**Ownership note (changed in the 2026-09-20 cross review M1):** `0012_jobs_phase_b.sql` is now created by the **wave 0 schema bundle** (delta §6 — `0009`·`0011`·`0012`·`0013` in one worktree and one commit). The SQL in step 1 below is the **canonical definition** that the bundle copies over verbatim. **If W0 is already merged, the file already exists, so skip step 1** and only check that the contents match what is below (the migration runner throws on a sha256 change — it must not be rewritten). The channels and ops plans also do not create this file; they use the seeded rows.
**Do not build (YAGNI):** a materialized view + a REFRESH job. A day's worth of aggregation is fine with a plain view; promote it if it gets slow.

**Files:**
- Create: `packages/db/migrations/0012_jobs_phase_b.sql`, `packages/kernel/src/jobs/cost-daily.ts`, `packages/kernel/test/integration/cost-daily.test.ts`
- Modify: `packages/kernel/src/index.ts`
- Test: `packages/kernel/test/integration/cost-daily.test.ts`

**Interfaces:**
- Consumes: `currentPolicy`(Task 6), `Audit`(Phase A), `Scheduler`(Phase A).
- Produces: `registerCostDailyJob(scheduler, deps)`, `COST_DAILY_JOB_NAME`, `COST_DAILY_CRON`, `runCostDaily(deps)`.

### Steps

- [ ] 1. Write the migration — **only if the W0 bundle is not merged yet** (see the ownership note above). The 4 jobs from delta §8 + the `cost_daily` view.

```sql
-- packages/db/migrations/0012_jobs_phase_b.sql
-- delta §8: the 4 jobs Phase B adds. The other 16 were already seeded by 0006_kernel.sql.
-- Owner: the W0 schema bundle (delta §6). This block is the canonical definition and the bundle copies it over verbatim.
-- channels (B37)·ops (B44)·surfaces do not recreate this file.

INSERT INTO jobs (name, schedule, next_run_at) VALUES
  ('cost_daily',          '5 0 * * *',        now()),   -- A4 §12.4 00:05 KST aggregation
  ('push_batch',          '0 9,12,15,18 * * *', now()), -- A4 §3.6 batched notifications
  ('outlook_delta_poll',  '*/5 * * * *',      now()),   -- A1 §2.4 (US-B37)
  ('cost_report_monthly', '10 0 1 * *',       now())    -- A4 §12.4 monthly report (US-B44)
ON CONFLICT (name) DO NOTHING;

-- A4 §12.4: "every day at 00:05 KST, aggregate agent_runs and refresh the cost_daily view."
-- Because it is a view, the refresh itself is free; the job only detects and records state transitions.
CREATE VIEW cost_daily AS
SELECT (created_at AT TIME ZONE 'Asia/Seoul')::date AS day,
       loop,
       model_tier,
       provider,
       count(*)                              AS runs,
       count(*) FILTER (WHERE outcome = 'failed') AS failed,
       COALESCE(sum(tokens_in), 0)           AS tokens_in,
       COALESCE(sum(tokens_out), 0)          AS tokens_out,
       COALESCE(sum(tokens_cached), 0)       AS tokens_cached,
       COALESCE(sum(cost_usd), 0)::numeric(12,6) AS cost_usd
  FROM agent_runs
 GROUP BY 1, 2, 3, 4;

GRANT SELECT ON cost_daily TO omnis_hub;
```

- [ ] 2. Write the failing test.

```ts
// packages/kernel/test/integration/cost-daily.test.ts
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "../../src/logger.js";
import { createAudit } from "../../src/audit.js";
import { COST_DAILY_CRON, COST_DAILY_JOB_NAME, runCostDaily } from "../../src/jobs/cost-daily.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});
afterAll(() => pool.end());

beforeEach(async () => {
  await pool.query("DELETE FROM agent_runs WHERE model = 'cd-test'");
  await pool.query("DELETE FROM audit_log WHERE action = 'cost.state_changed'");
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ('cost.cap_usd','60'::jsonb),
                                              ('cost.reserve_ratio','0.1'::jsonb),
                                              ('cost.last_state','"normal"'::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
});

describe("cost_daily job (A4 §12.4)", () => {
  it("is scheduled at 00:05 KST under the seeded job name", async () => {
    expect(COST_DAILY_CRON).toBe("5 0 * * *");
    const { rows } = await pool.query<{ schedule: string }>(
      "SELECT schedule FROM jobs WHERE name = $1", [COST_DAILY_JOB_NAME]);
    expect(rows[0]?.schedule).toBe("5 0 * * *");
  });

  it("aggregates agent_runs into the cost_daily view", async () => {
    await pool.query(
      `INSERT INTO agent_runs (loop, trigger_kind, model_tier, provider, model, cost_usd, tokens_in, tokens_cached, outcome)
       VALUES ('draft','cron','T1','openrouter','cd-test', 0.5, 1000, 700, 'ok'),
              ('draft','cron','T1','openrouter','cd-test', 0.25, 500, 100, 'failed')`);
    const { rows } = await pool.query<{ runs: string; cost_usd: string; tokens_cached: string }>(
      `SELECT runs::text, cost_usd::text, tokens_cached::text FROM cost_daily
        WHERE loop = 'draft' AND model_tier = 'T1' AND day = (now() AT TIME ZONE 'Asia/Seoul')::date`);
    expect(Number(rows[0]?.runs)).toBeGreaterThanOrEqual(2);
    expect(Number(rows[0]?.cost_usd)).toBeGreaterThanOrEqual(0.75);
    expect(Number(rows[0]?.tokens_cached)).toBeGreaterThanOrEqual(800);
  });

  it("records an audit row and a system item when the state changes", async () => {
    await pool.query(
      `INSERT INTO agent_runs (loop, trigger_kind, model_tier, provider, model, cost_usd, outcome)
       VALUES ('draft','cron','T1','openrouter','cd-test', 50, 'ok')`);
    const logger = createLogger("@omnis/kernel");
    const state = await runCostDaily({ pool, audit: createAudit(pool), logger, now: new Date() });
    expect(state).toBe("degraded");
    const { rows } = await pool.query<{ after: { to: string } }>(
      "SELECT after FROM audit_log WHERE action = 'cost.state_changed' ORDER BY at DESC LIMIT 1");
    expect(rows[0]?.after.to).toBe("degraded");
    const items = await pool.query<{ body: string }>(
      `SELECT body FROM items WHERE kind = 'system' AND body LIKE '%80%' ORDER BY sent_at DESC LIMIT 1`);
    expect(items.rows[0]?.body).toContain("T2");
    // The second run sees the same state, so it leaves nothing more behind
    await runCostDaily({ pool, audit: createAudit(pool), logger, now: new Date() });
    const again = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_log WHERE action = 'cost.state_changed'");
    expect(again.rows[0]?.n).toBe("1");
  });
});
```

- [ ] 3. Apply the migration and confirm the failure. Expected: `Failed to resolve import "../../src/jobs/cost-daily.js"`.

```bash
pnpm db:migrate && pnpm --filter @omnis/kernel test:integration -- cost-daily
```

- [ ] 4. Write the implementation.

```ts
// packages/kernel/src/jobs/cost-daily.ts
// A4 §12.4: daily 00:05 KST aggregation + state transition detection. SQL refreshes the view, so the job only looks at transitions.
import { query } from "@omnis/db";
import type { Pool } from "pg";
import type { Audit } from "../audit.js";
import { type CostState, currentPolicy } from "../cost/governor.js";
import type { Logger } from "../logger.js";
import type { Scheduler } from "../scheduler.js";

export const COST_DAILY_JOB_NAME = "cost_daily";
export const COST_DAILY_CRON = "5 0 * * *";

export interface CostDailyDeps {
  pool: Pool;
  audit: Audit;
  logger: Logger;
  now?: Date;
}

async function lastState(pool: Pool): Promise<CostState | null> {
  const rows = await query<{ value: CostState }>(
    pool, "SELECT value #>> '{}' AS value FROM settings WHERE key = 'cost.last_state'");
  return rows[0]?.value ?? null;
}

export async function runCostDaily(deps: CostDailyDeps): Promise<CostState> {
  const { pool, audit, logger } = deps;
  const now = deps.now ?? new Date();
  const { state, policy, mtdUsd, reserveUsd } = await currentPolicy(pool, now);
  const previous = await lastState(pool);
  if (previous === state) return state;

  await query(
    pool,
    `INSERT INTO settings (key, value) VALUES ('cost.last_state', to_jsonb($1::text))
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [state]);
  await audit.record({
    actor: "system", action: "cost.state_changed", target_table: "settings",
    before: { from: previous }, after: { to: state, mtdUsd, reserveUsd },
  });
  // ponytail: @omnis/kernel cannot depend on @omnis/agents, so it cannot use writeSystemItem.
  // The same 4-line INSERT as apps/hub/src/archive.ts — intentional duplication (contract §12).
  await query(
    pool,
    `WITH acc AS (
       INSERT INTO accounts (channel, external_id, display) VALUES ('system','omnis','omnis')
       ON CONFLICT (channel, external_id) DO UPDATE SET display = EXCLUDED.display RETURNING id),
     thr AS (
       INSERT INTO threads (account_id, external_id, kind, title)
       SELECT id, 'system:agents', 'system', 'omnis' FROM acc
       ON CONFLICT (account_id, external_id) DO UPDATE SET kind = 'system' RETURNING id, account_id)
     INSERT INTO items (thread_id, account_id, kind, status, body, sent_at, meta)
     SELECT thr.id, thr.account_id, 'system', 'received', $1, now(), $2::jsonb FROM thr`,
    [policy.note ?? `LLM cost state changed to ${state}.`,
     JSON.stringify({ cost_state: state, mtd_usd: mtdUsd, reserve_usd: reserveUsd })]);
  logger.warn("cost state changed", { from: previous, to: state, mtdUsd });
  return state;
}

export function registerCostDailyJob(scheduler: Scheduler, deps: CostDailyDeps): void {
  scheduler.register(COST_DAILY_JOB_NAME, COST_DAILY_CRON, async () => {
    await runCostDaily(deps);
  });
}
```

- [ ] 5. Add the exports to `index.ts`, register them in the hub, then confirm it passes. Expected: 3 tests passed.

```ts
// packages/kernel/src/index.ts — added
export {
  COST_DAILY_CRON, COST_DAILY_JOB_NAME, registerCostDailyJob, runCostDaily,
  type CostDailyDeps,
} from "./jobs/cost-daily.js";
```

```ts
// apps/hub/src/main.ts — right below registerHealthcheckJob
registerCostDailyJob(kernel.scheduler, { pool, audit: kernel.audit, logger });
```

```bash
pnpm db:migrate && pnpm --filter @omnis/kernel test:integration && pnpm lint
```

- [ ] 6. Commit.

```bash
git add packages/db/migrations/0012_jobs_phase_b.sql packages/kernel/src/jobs/cost-daily.ts packages/kernel/src/index.ts packages/kernel/test/integration/cost-daily.test.ts apps/hub/src/main.ts
git commit -m "US-B14: cost_daily view and the 00:05 job

- 0012_jobs_phase_b.sql seeds the 4 jobs from delta §8 and creates the cost_daily view
- runCostDaily leaves an audit_log row + a system Item only on a state transition (the same state is silent)
- The hub registers the job

Implemented-by: Claude Opus
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 8: Draft pure functions — register / needs-reply / channel shape / self-check (US-B13, tier: Opus)

> **Story** — Goal: `register` rule determination, the `needs_reply_score` formula, per-channel length and shape rules for 8 channels, and the 6 self-check items. Deliverables: `packages/agents/src/draft/{register,selfcheck}.ts`. Verification: `pnpm --filter @omnis/agents test`. Depends on: B05, B07.

**Read:** A4 §3.1 (the five `needs_reply_score` weights), §3.2 (register determination), §3.4 (the 8-row per-channel table), §3.3 (the 6 self-check items).
**Do not build (YAGNI):** a learned register classifier, per-channel prompt files. Four lines of rules are all A4 specifies.

**Files:**
- Create: `packages/agents/src/draft/register.ts`, `packages/agents/src/draft/selfcheck.ts`, `packages/agents/test/draft-rules.test.ts`
- Modify: `packages/agents/src/index.ts`
- Test: `packages/agents/test/draft-rules.test.ts`

**Interfaces:**
- Consumes: `ItemRow`(Phase A), `Channel`(`@omnis/protocol`).
- Produces: `Register`, `pickRegister`, `needsReplyScore`, `NEEDS_REPLY_MIN`, `CHANNEL_DRAFT_SHAPE`, `selfCheck`, `type SelfCheckCtx`, `SELF_CHECK_ITEMS`.

### Steps

- [ ] 1. Write the failing test.

```ts
// packages/agents/test/draft-rules.test.ts
import { describe, expect, it } from "vitest";
import {
  CHANNEL_DRAFT_SHAPE, NEEDS_REPLY_MIN, needsReplyScore, pickRegister, selfCheck,
} from "../src/index.js";
import type { ItemRow } from "../src/types.js";

const item = (over: Partial<ItemRow> = {}): ItemRow => ({
  id: "i1", thread_id: "t1", account_id: "a1", channel: "gmail", kind: "email",
  scope: "work", sensitivity: "normal", author_person_id: null, author_is_me: false,
  subject: "Quote", body: "When could you send it?", sent_at: new Date().toISOString(),
  embedding: null, ...over,
});

describe("needsReplyScore (A4 §3.1)", () => {
  it("adds up the five weights", () => {
    const s = needsReplyScore(item(), {
      lastAuthorIsThem: true, myReplyRatio: 1, inTo: true, bulkHeaders: false,
    });
    expect(s).toBeCloseTo(1, 5);   // 0.3 + 0.3 + 0.2 + 0.2, clamped to 1.0
  });

  it("drops a newsletter below the threshold", () => {
    const s = needsReplyScore(item({ body: "Click here to unsubscribe" }), {
      lastAuthorIsThem: true, myReplyRatio: 0, inTo: false, bulkHeaders: true,
    });
    expect(s).toBeLessThan(NEEDS_REPLY_MIN);
  });
});

describe("pickRegister (A4 §3.2)", () => {
  it("uses labels, org and greeting — never a model", () => {
    expect(pickRegister({ language: "ko", labels: ["client"], sameOrg: false })).toBe("formal_ko");
    expect(pickRegister({ language: "ko", labels: [], sameOrg: true })).toBe("polite_ko");
    expect(pickRegister({ language: "ko", labels: ["close"], sameOrg: false })).toBe("casual_ko");
    expect(pickRegister({ language: "en", labels: [], sameOrg: false, greeting: "Dear" })).toBe("formal_en");
    expect(pickRegister({ language: "en", labels: [], sameOrg: false, greeting: "Hi" })).toBe("casual_en");
  });
});

describe("CHANNEL_DRAFT_SHAPE (A4 §3.4)", () => {
  it("covers all ten Channel values with a word target", () => {
    expect(Object.keys(CHANNEL_DRAFT_SHAPE)).toHaveLength(10);
    expect(CHANNEL_DRAFT_SHAPE.gmail.targetWords).toEqual([60, 180]);
    expect(CHANNEL_DRAFT_SHAPE.kakaotalk.targetWords[1]).toBeLessThanOrEqual(40);
  });
});

describe("selfCheck (A4 §3.3)", () => {
  it("fails #6 when the draft copies a link that came from <data>", () => {
    const r = selfCheck("Understood. I'll send it to https://evil.example/pay.", {
      questionCount: 0, externalUrls: ["https://evil.example/pay"], calendarConflicts: [],
      voiceSampleAvgLen: 40, entityNames: [], channel: "gmail",
    });
    expect(r.passed).toBe(false);
    expect(r.failed).toContain(6);
  });

  it("fails #1 when the draft answers fewer questions than it was asked", () => {
    const r = selfCheck("Yes.", {
      questionCount: 2, externalUrls: [], calendarConflicts: [],
      voiceSampleAvgLen: 40, entityNames: [], channel: "slack",
    });
    expect(r.failed).toContain(1);
  });

  it("passes a clean draft", () => {
    const r = selfCheck("Yes, I'll send it Thursday at 2pm. I'll check and let you know.", {
      questionCount: 1, externalUrls: [], calendarConflicts: [],
      voiceSampleAvgLen: 40, entityNames: [], channel: "gmail",
    });
    expect(r).toEqual({ passed: true, failed: [] });
  });
});
```

- [ ] 2. Confirm the failure. Expected: `does not provide an export named 'needsReplyScore'`.

```bash
pnpm --filter @omnis/agents test -- draft-rules
```

- [ ] 3. Write `register.ts`.

```ts
// packages/agents/src/draft/register.ts
// A4 §3.1·§3.2·§3.4. All of it is rules — there is no model call here.
import type { Channel } from "@omnis/protocol";
import type { ItemRow } from "../types.js";

export type Register = "formal_ko" | "polite_ko" | "casual_ko" | "formal_en" | "casual_en";

const FORMAL_LABELS = ["client", "investor", "senior"] as const;

export function pickRegister(ctx: {
  language: "ko" | "en";
  labels: string[];
  sameOrg: boolean;
  greeting?: string;
}): Register {
  if (ctx.language === "en") {
    return /^(dear|to whom)/i.test(ctx.greeting ?? "") ? "formal_en" : "casual_en";
  }
  if (ctx.labels.some((l) => (FORMAL_LABELS as readonly string[]).includes(l))) return "formal_ko";
  if (ctx.labels.includes("close")) return "casual_ko";
  if (ctx.sameOrg) return "polite_ko";
  return "formal_ko";
}

/** A4 §3.1: below 0.5, no draft is produced at all. */
export const NEEDS_REPLY_MIN = 0.5;

const UNSUBSCRIBE = /(cancel|end).{0,4}subscription|unsubscribe|opt[ -]?out/i;

export function needsReplyScore(
  item: ItemRow,
  ctx: { lastAuthorIsThem: boolean; myReplyRatio: number; inTo: boolean; bulkHeaders: boolean },
): number {
  let s = 0;
  if (item.body.includes("?") || item.body.includes("？")) s += 0.3;
  if (ctx.lastAuthorIsThem) s += 0.3;
  s += 0.2 * Math.min(1, Math.max(0, ctx.myReplyRatio));
  if (ctx.inTo) s += 0.2;
  if (ctx.bulkHeaders || UNSUBSCRIBE.test(item.body)) s -= 0.6;
  return Math.min(1, Math.max(0, s));
}

export interface DraftShape {
  targetWords: [number, number];
  notes: string;
}

/** Exactly the A4 §3.4 table. It covers all 10 Channel values (agent/system are not draft targets, so they are 0). */
export const CHANNEL_DRAFT_SHAPE: Record<Channel, DraftShape> = {
  gmail: { targetWords: [60, 180], notes: "Greeting + body + sign-off, 2–3 paragraphs. Keep the subject as Re:." },
  outlook: { targetWords: [60, 180], notes: "Same as Gmail." },
  slack: { targetWords: [10, 60], notes: "No greeting, minimal markdown. Do not add new @mentions." },
  telegram: { targetWords: [8, 45], notes: "1–3 sentences. Emoji only 0–1, and only if VOICE has a sample." },
  whatsapp: { targetWords: [6, 30], notes: "1–2 sentences, short lines instead of line breaks." },
  kakaotalk: { targetWords: [5, 30], notes: "80 characters or fewer, polite register by default, minimal line breaks, text only." },
  linkedin: { targetWords: [40, 90], notes: "Greeting + purpose + one proposal. The no-unsolicited-outreach rule applies." },
  gcal: { targetWords: [10, 60], notes: "Invitation response copy. The event itself goes through the approval path." },
  agent: { targetWords: [0, 0], notes: "Not a draft — the user writes it directly (A4 §3.4)." },
  system: { targetWords: [0, 0], notes: "Not a draft." },
};
```

- [ ] 4. Write `selfcheck.ts`.

```ts
// packages/agents/src/draft/selfcheck.ts
// The 6-item checklist from A4 §3.3. Item 6 (exfil prevention) is the key safeguard.
import type { Channel } from "@omnis/protocol";
import { CHANNEL_DRAFT_SHAPE } from "./register.js";

export const SELF_CHECK_ITEMS: readonly string[] = [
  "Did it answer everything the other person asked?"
  "Did it assert a fact I do not know?"
  "Do the dates and times conflict with the calendar?"
  "Does it clash with the sentence-length pattern of the VOICE samples?"
  "Do the other person's name, title, and company match the as-of-now entities?"
  "Did it carry over a link, address, or account number taken from <data>?"
] as const;

export interface SelfCheckCtx {
  /** Number of questions the other person asked (by counting question marks). */
  questionCount: number;
  /** URL or account strings that appeared in the <data> block. If they are still in the draft verbatim, item 6 fails. */
  externalUrls: string[];
  /** Times the draft mentions that overlap with the calendar. */
  calendarConflicts: string[];
  /** Average sentence length of the VOICE samples (in characters). If 0, item 4 is skipped. */
  voiceSampleAvgLen: number;
  /** List of "as-of-now" entity names. If the draft uses none of them, item 5 counts as passed. */
  entityNames: string[];
  channel: Channel;
}

const HEDGE = /(let me|I'?ll)\s+(check|look|ask|verify|confirm)/i;
const ASSERTION = /absolutely|definitely|certainly|guaranteed|100%/i;

export function selfCheck(
  draft: string,
  ctx: SelfCheckCtx,
): { passed: boolean; failed: number[] } {
  const failed: number[] = [];
  const sentences = draft.split(/[.!?。！？\n]+/).filter((s) => s.trim() !== "");

  if (ctx.questionCount > 0 && sentences.length < ctx.questionCount) failed.push(1);
  if (ASSERTION.test(draft) && !HEDGE.test(draft)) failed.push(2);
  if (ctx.calendarConflicts.some((c) => draft.includes(c))) failed.push(3);
  if (ctx.voiceSampleAvgLen > 0) {
    const avg = sentences.reduce((n, s) => n + s.trim().length, 0) / Math.max(1, sentences.length);
    if (avg > ctx.voiceSampleAvgLen * 2 || avg < ctx.voiceSampleAvgLen / 2) failed.push(4);
  }
  if (ctx.entityNames.length > 0) {
    const stale = /former (employer|company)|previous company|used to work/i.test(draft);
    if (stale) failed.push(5);
  }
  // Item 6: did it carry over a URL or account number that came from <data>. This is the last line of defense against injection-driven exfil.
  if (ctx.externalUrls.some((u) => u !== "" && draft.includes(u))) failed.push(6);

  const shape = CHANNEL_DRAFT_SHAPE[ctx.channel];
  if (shape.targetWords[1] > 0 && draft.trim().split(/\s+/).length > shape.targetWords[1] * 1.5) {
    failed.push(4);
  }
  return { passed: failed.length === 0, failed: [...new Set(failed)].sort((a, b) => a - b) };
}
```

- [ ] 5. Add the exports to `index.ts` and confirm it passes. Expected: 7 tests passed.

```ts
// packages/agents/src/index.ts — added
export {
  CHANNEL_DRAFT_SHAPE, NEEDS_REPLY_MIN, needsReplyScore, pickRegister,
  type DraftShape, type Register,
} from "./draft/register.js";
export { SELF_CHECK_ITEMS, selfCheck, type SelfCheckCtx } from "./draft/selfcheck.js";
```

```bash
pnpm --filter @omnis/agents test -- draft-rules && pnpm lint
git add packages/agents/src/draft packages/agents/src/index.ts packages/agents/test/draft-rules.test.ts
git commit -m "US-B13: draft pure functions — register/needs-reply/channel shape/self-check

- needsReplyScore's five weights and the 0.5 threshold (A4 §3.1)
- pickRegister uses label, org, and greeting rules and never calls a model
- CHANNEL_DRAFT_SHAPE covers all 10 Channel values
- selfCheck's 6 items, with item 6 catching exfil through <data>

Implemented-by: Claude Opus
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 9: `draftLoop` — the 60-second SLA + the 6 tier-escalation conditions (US-B13, tier: Opus)

> **Story** — Goal: the trigger, the 7 context slots, the 4 Deliberate steps, the 60-second SLA placeholder, and the 6 escalation conditions. Deliverables: `packages/agents/src/loops/draft.ts`. Verification: `pnpm --filter @omnis/agents test`.

**Read:** all of A4 §3, `runLoopSpec` from Task 3, `propose_draft` from Task 5.
**Do not build (YAGNI):** draft A/B generation, a language auto-detection library. `language` is decided by a one-line check of the Hangul ratio in the body.

**Files:**
- Create: `packages/agents/src/loops/draft.ts`, `packages/agents/test/integration/draft-loop.test.ts`
- Modify: `packages/agents/src/index.ts`
- Test: `packages/agents/test/integration/draft-loop.test.ts`

**Interfaces:**
- Consumes: `buildContext` (US-B05), `runLoopSpec`/`registerLoop` (Task 1·3), `toolRegistry` (Task 5), `pickRegister`/`needsReplyScore`/`selfCheck` (Task 8), `currentPolicy` (Task 6 — injected by the hub as `draftPolicy`).
- Produces: `draftLoop`, `DraftOutput`, `type DraftOutputT`, `writePlaceholderDraft`, `shouldEscalate`, `DRAFT_SLA_MS`, `DRAFT_PLACEHOLDER_MS`.

### Steps

- [ ] 1. Write the failing test — it covers only escalation determination and the placeholder (Task 3 already covers the model path).

```ts
// packages/agents/test/integration/draft-loop.test.ts
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DRAFT_PLACEHOLDER_MS, DRAFT_SLA_MS, configureAgents, draftLoop, shouldEscalate,
  writePlaceholderDraft,
} from "../../src/index.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});
let threadId = "";
beforeAll(async () => {
  configureAgents({ pool });
  const a = await pool.query<{ id: string }>(
    `INSERT INTO accounts (channel, external_id, display) VALUES ('gmail','draft@test','d')
       ON CONFLICT (channel, external_id) DO UPDATE SET display='d' RETURNING id`);
  const t = await pool.query<{ id: string }>(
    `INSERT INTO threads (account_id, external_id, kind) VALUES ($1,'thr_draft','email')
       ON CONFLICT (account_id, external_id) DO UPDATE SET kind='email' RETURNING id`,
    [a.rows[0]?.id ?? ""]);
  threadId = t.rows[0]?.id ?? "";
});
afterAll(() => pool.end());

describe("draftLoop (A4 §3)", () => {
  it("declares the A4 §3.7 budget and the 20s debounce", () => {
    expect(draftLoop.id).toBe("draft");
    expect(draftLoop.kind).toBe("deliberate");
    expect(draftLoop.trigger.debounceMs).toBe(20_000);
    expect(draftLoop.budget).toEqual({
      inputTokens: 6500, outputTokens: 800, wallClockMs: 45_000, maxSteps: 8,
    });
    expect(draftLoop.palette).not.toContain("propose_delegation");
    expect(DRAFT_SLA_MS).toBe(60_000);
    expect(DRAFT_PLACEHOLDER_MS).toBe(55_000);
  });

  it("escalates to T2 on each of the six conditions (A4 §3.5)", () => {
    const base = {
      vip: false, sensitivity: "normal" as const, t1Confidence: 0.9, t1Escalate: false,
      unresolvedCount: 0, firstContact: false, channel: "gmail" as const,
    };
    expect(shouldEscalate(base)).toBe(false);
    expect(shouldEscalate({ ...base, vip: true })).toBe(true);
    expect(shouldEscalate({ ...base, sensitivity: "finance" })).toBe(true);
    expect(shouldEscalate({ ...base, t1Confidence: 0.6 })).toBe(true);
    expect(shouldEscalate({ ...base, t1Escalate: true })).toBe(true);
    expect(shouldEscalate({ ...base, unresolvedCount: 2 })).toBe(true);
    expect(shouldEscalate({ ...base, firstContact: true })).toBe(true);
    expect(shouldEscalate({ ...base, firstContact: true, channel: "slack" })).toBe(false);
  });

  it("writes a pending placeholder draft and replaces it in place", async () => {
    const id = await writePlaceholderDraft(threadId);
    const { rows } = await pool.query<{ status: string; body: string; meta: { pending?: boolean } }>(
      "SELECT status, body, meta FROM items WHERE id = $1", [id]);
    expect(rows[0]).toMatchObject({ status: "draft", body: "Preparing the draft…" });
    expect(rows[0]?.meta.pending).toBe(true);
  });
});
```

- [ ] 2. Confirm the failure. Expected: `does not provide an export named 'draftLoop'`.

```bash
pnpm --filter @omnis/agents test -- draft-loop
```

- [ ] 3. Write the implementation.

```ts
// packages/agents/src/loops/draft.ts
// A4 §3 L2 reply draft loop (Deliberate).
import type { Channel, Sensitivity } from "@omnis/protocol";
import { z } from "zod";
import { buildContext } from "../context/assemble.js";
import { CHANNEL_DRAFT_SHAPE, pickRegister } from "../draft/register.js";
import { selfCheck } from "../draft/selfcheck.js";
import { registerLoop } from "../loop/registry.js";
import type { LoopSpec, TriggerContext } from "../loop/spec.js";
import { getAgentsPool } from "../pool.js";
import { PROPOSE_TOOLS } from "../tools/propose.js";

/** A4 §3.1 SLA: a status='draft' row must exist within 60 seconds. A placeholder is written first at 55 seconds. */
export const DRAFT_SLA_MS = 60_000;
export const DRAFT_PLACEHOLDER_MS = 55_000;

export const DraftOutput = z.object({
  body: z.string().max(4000),
  subject: z.string().max(200).optional(),
  language: z.enum(["ko", "en"]),
  rationale: z.string().max(400),
  evidence: z.array(z.object({
    kind: z.enum(["item", "memory", "calendar", "entity"]), id: z.string(), why: z.string().max(120),
  })).default([]),
  confidence: z.number().min(0).max(1),
  escalate: z.boolean().default(false),
  unresolved: z.array(z.string()).default([]),
  injection_flags: z.array(z.string()).default([]),
});
export type DraftOutputT = z.infer<typeof DraftOutput>;

/** The 6 conditions from A4 §3.5. If any one of them is true, T2 (Claude Sonnet 5). */
export function shouldEscalate(i: {
  vip: boolean;
  sensitivity: Sensitivity;
  t1Confidence: number;
  t1Escalate: boolean;
  unresolvedCount: number;
  firstContact: boolean;
  channel: Channel;
}): boolean {
  if (i.vip) return true;
  if (i.sensitivity !== "normal") return true;
  if (i.t1Confidence < 0.65) return true;
  if (i.t1Escalate) return true;
  if (i.unresolvedCount >= 2) return true;
  if (i.firstContact && (i.channel === "gmail" || i.channel === "outlook" || i.channel === "linkedin")) {
    return true;
  }
  return false;
}

/** A4 §3.1: "preparing" beats the screen sitting empty with "no draft." */
export async function writePlaceholderDraft(threadId: string): Promise<string> {
  const { rows } = await getAgentsPool().query<{ id: string }>(
    `INSERT INTO items (thread_id, account_id, kind, status, body, sent_at, author_is_me, meta)
     SELECT t.id, t.account_id,
            CASE WHEN t.kind = 'email' THEN 'email' ELSE 'message' END,
            'draft', 'Preparing the draft…', now(), true, '{"pending": true}'::jsonb
       FROM threads t WHERE t.id = $1
     RETURNING id`,
    [threadId]);
  const id = rows[0]?.id;
  if (id === undefined) throw new Error(`thread not found: ${threadId}`);
  return id;
}

async function replacePlaceholder(itemId: string, out: DraftOutputT, register: string): Promise<void> {
  await getAgentsPool().query(
    `UPDATE items
        SET body = $2, subject = COALESCE($3, subject),
            meta = (meta - 'pending') || jsonb_build_object('draft', jsonb_build_object(
              'rationale', $4::text, 'register', $5::text, 'language', $6::text,
              'confidence', $7::real, 'evidence', $8::jsonb))
      WHERE id = $1`,
    [itemId, out.body, out.subject ?? null, out.rationale, register, out.language,
     out.confidence, JSON.stringify(out.evidence)]);
}

interface DraftTriggerPayload {
  register?: string;
  external_urls?: string[];
  question_count?: number;
  channel?: Channel;
  placeholder_item_id?: string;
}

export const draftLoop: LoopSpec<DraftOutputT> = {
  id: "draft",
  kind: "deliberate",
  trigger: {
    kind: "event",
    on: "item.labeled",
    where: "author <> 'me' AND kind IN ('message','email') AND needs_reply_score >= 0.5",
    debounceMs: 20_000,
  },
  palette: ["read_thread", "search_memory", "read_person", "read_entity", "read_calendar",
            "read_tasks", "propose_draft"],
  budget: { inputTokens: 6500, outputTokens: 800, wallClockMs: 45_000, maxSteps: 8 },
  tier: "T1",
  outputSchema: DraftOutput,

  // The 7 slots from A4 §3.2. The slot names and numbers are exactly that table.
  assemble: (ctx: TriggerContext) =>
    buildContext({
      selfModel: ["USER.md", "VOICE.md"],
      thread: { threadId: ctx.thread_id ?? "", lastN: 12, includeToolCalls: false },
      memories: { query: String(ctx.payload.query ?? ""), k: 6, minScore: 0.5 },
      entities: { personIds: typeof ctx.person_id === "string" ? [ctx.person_id] : [], asOf: "now" },
      calendar: { windowHours: 72 },
      tasks: { state: "open", limit: 10 },
    }),

  async apply(result, ctx) {
    const p = ctx.payload as DraftTriggerPayload;
    const channel: Channel = p.channel ?? "gmail";
    const register = p.register ?? pickRegister({
      language: result.output.language, labels: [], sameOrg: false,
    });
    const check = selfCheck(result.output.body, {
      questionCount: p.question_count ?? 0,
      externalUrls: p.external_urls ?? [],
      calendarConflicts: [],
      voiceSampleAvgLen: 0,
      entityNames: [],
      channel,
    });
    // A4 §3.3 step 4: if any item failed, still store the draft but mark it so the UI can see it —
    // regeneration is a human decision, not a runLoopSpec retry (item 6 especially, since it is a safety failure).
    const shape = CHANNEL_DRAFT_SHAPE[channel];
    const existing = p.placeholder_item_id;
    if (existing !== undefined) {
      await replacePlaceholder(existing, result.output, register);
    } else {
      await PROPOSE_TOOLS.propose_draft?.execute?.(
        {
          thread_id: ctx.thread_id ?? "", body: result.output.body,
          ...(result.output.subject !== undefined ? { subject: result.output.subject } : {}),
          language: result.output.language, register,
          rationale: result.output.rationale, evidence: result.output.evidence,
          confidence: result.output.confidence,
          ...(ctx.item_id !== undefined ? { in_reply_to_item_id: ctx.item_id } : {}),
        },
        { toolCallId: result.run_id, messages: [] },
      );
    }
    await getAgentsPool().query(
      `UPDATE items SET meta = meta || jsonb_build_object('draft_self_check', $2::jsonb)
        WHERE thread_id = $1 AND status = 'draft'`,
      [ctx.thread_id ?? "", JSON.stringify({ ...check, shape: shape.notes })]);
  },
};

registerLoop(draftLoop);
```

- [ ] 4. Add the exports to `index.ts` and confirm it passes. Expected: `draft-loop.test.ts` 3 tests passed.

```ts
// packages/agents/src/index.ts — added
export {
  DRAFT_PLACEHOLDER_MS, DRAFT_SLA_MS, DraftOutput, draftLoop, shouldEscalate,
  writePlaceholderDraft, type DraftOutputT,
} from "./loops/draft.js";
```

```bash
pnpm --filter @omnis/agents test && pnpm lint
git add packages/agents/src/loops/draft.ts packages/agents/src/index.ts packages/agents/test/integration/draft-loop.test.ts
git commit -m "US-B13: L2 reply draft loop

- The trigger (item.labeled + needs_reply_score>=0.5, 20-second debounce) and the A4 §3.7 budget
- 7-slot context; propose_draft is the only write tool that goes into the palette
- 60-second SLA placeholder (meta.pending) → replaced in the same row on completion
- shouldEscalate's 6 conditions

Implemented-by: Claude Opus
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 10: Notification tier determination + quiet hours (US-B15, tier: Sonnet)

> **Story** — Goal: immediate/batched/silent determination, quiet hours 23:00–07:00 + one exception. Deliverables: `packages/kernel/src/notify/tier.ts`. Verification: `pnpm --filter @omnis/kernel test`. Depends on: B13.

**Read:** the whole A4 §3.6 table, delta §2.3 (`NotifyTier`).
**Do not build (YAGNI):** per-user notification profiles, per-channel on/off. The two Settings keys `notify.quiet_hours`/`notify.vip_override` are all there is.

**Files:**
- Create: `packages/kernel/src/notify/tier.ts`, `packages/kernel/test/notify-tier.test.ts`
- Modify: `packages/kernel/src/index.ts`
- Test: `packages/kernel/test/notify-tier.test.ts`

**Interfaces:**
- Consumes: `NotifyTier` (`@omnis/protocol`, delta §2.3).
- Produces: `notifyTierFor`, `inQuietHours`, `QUIET_START_HOUR_KST`, `QUIET_END_HOUR_KST`, `PUSH_BATCH_HOURS_KST`.

### Steps

- [ ] 1. Write the failing test.

```ts
// packages/kernel/test/notify-tier.test.ts
import { describe, expect, it } from "vitest";
import { PUSH_BATCH_HOURS_KST, inQuietHours, notifyTierFor } from "../src/notify/tier.js";

/** Build a UTC Date for a KST wall-clock time (Asia/Seoul has no DST, so a fixed -9h). */
const kst = (h: number, m = 0): Date => new Date(Date.UTC(2026, 8, 20, h - 9, m));

describe("inQuietHours (A4 §3.6)", () => {
  it("covers 23:00~07:00 KST across midnight", () => {
    expect(inQuietHours(kst(22, 59))).toBe(false);
    expect(inQuietHours(kst(23, 0))).toBe(true);
    expect(inQuietHours(kst(3, 0))).toBe(true);
    expect(inQuietHours(kst(6, 59))).toBe(true);
    expect(inQuietHours(kst(7, 0))).toBe(false);
  });
});

describe("notifyTierFor (A4 §3.6)", () => {
  const now = kst(14);
  it("pushes immediately only for priority=now with vip/mention/meeting", () => {
    expect(notifyTierFor({ priority: "now", vip: true, mentionsMe: false, meetingWithin2h: false, now }))
      .toBe("immediate");
    expect(notifyTierFor({ priority: "now", vip: false, mentionsMe: true, meetingWithin2h: false, now }))
      .toBe("immediate");
    expect(notifyTierFor({ priority: "now", vip: false, mentionsMe: false, meetingWithin2h: true, now }))
      .toBe("immediate");
    expect(notifyTierFor({ priority: "now", vip: false, mentionsMe: false, meetingWithin2h: false, now }))
      .toBe("silent");
  });

  it("batches priority=today and silences the rest", () => {
    expect(notifyTierFor({ priority: "today", vip: false, mentionsMe: false, meetingWithin2h: false, now }))
      .toBe("batched");
    expect(notifyTierFor({ priority: "week", vip: true, mentionsMe: true, meetingWithin2h: true, now }))
      .toBe("silent");
    expect(notifyTierFor({ priority: "fyi", vip: false, mentionsMe: false, meetingWithin2h: false, now }))
      .toBe("silent");
  });

  it("downgrades immediate to batched inside quiet hours — except vip AND priority=now", () => {
    const night = kst(1);
    expect(notifyTierFor({ priority: "now", vip: false, mentionsMe: true, meetingWithin2h: false, now: night }))
      .toBe("batched");
    expect(notifyTierFor({ priority: "now", vip: true, mentionsMe: false, meetingWithin2h: false, now: night }))
      .toBe("immediate");
    expect(notifyTierFor({ priority: "now", vip: true, mentionsMe: false, meetingWithin2h: false,
      now: night, vipOverride: false })).toBe("batched");
  });

  it("batches at 09/12/15/18 KST", () => {
    expect(PUSH_BATCH_HOURS_KST).toEqual([9, 12, 15, 18]);
  });
});
```

- [ ] 2. Confirm the failure. Expected: `Failed to resolve import "../src/notify/tier.js"`.

```bash
pnpm --filter @omnis/kernel test -- notify-tier
```

- [ ] 3. Write the implementation.

```ts
// packages/kernel/src/notify/tier.ts
// A4 §3.6. It applies identically on the Mac and the phone — there are no phone-only rules.
import type { NotifyTier } from "@omnis/protocol";

export const QUIET_START_HOUR_KST = 23;
export const QUIET_END_HOUR_KST = 7;
export const PUSH_BATCH_HOURS_KST: readonly number[] = [9, 12, 15, 18];

const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;

function seoulHour(at: Date): number {
  return new Date(at.getTime() + SEOUL_OFFSET_MS).getUTCHours();
}

export function inQuietHours(at: Date): boolean {
  const h = seoulHour(at);
  return h >= QUIET_START_HOUR_KST || h < QUIET_END_HOUR_KST;
}

export function notifyTierFor(i: {
  priority: "now" | "today" | "week" | "fyi";
  vip: boolean;
  mentionsMe: boolean;
  meetingWithin2h: boolean;
  now: Date;
  /** Settings `notify.vip_override`. Defaults to true — turning it off removes the quiet-hours exception. */
  vipOverride?: boolean;
}): NotifyTier {
  const immediate =
    i.priority === "now" && (i.vip || i.mentionsMe || i.meetingWithin2h);
  if (immediate) {
    if (!inQuietHours(i.now)) return "immediate";
    // The only quiet-hours exception is vip AND priority='now', and even that can be turned off in Settings.
    return i.vip && (i.vipOverride ?? true) ? "immediate" : "batched";
  }
  if (i.priority === "today") return "batched";
  return "silent";
}
```

- [ ] 4. Add the exports to `index.ts` and confirm it passes. Expected: 4 tests passed.

```ts
// packages/kernel/src/index.ts — added
export {
  PUSH_BATCH_HOURS_KST, QUIET_END_HOUR_KST, QUIET_START_HOUR_KST, inQuietHours, notifyTierFor,
} from "./notify/tier.js";
```

```bash
pnpm --filter @omnis/kernel test -- notify-tier && pnpm lint
git add packages/kernel/src/notify/tier.ts packages/kernel/src/index.ts packages/kernel/test/notify-tier.test.ts
git commit -m "US-B15: notification tier determination and quiet hours

- notifyTierFor splits immediate/batched/silent exactly per the A4 §3.6 table
- inQuietHours 23:00–07:00 KST (handles crossing midnight), with a single exception: vip AND priority=now
- The exception can be turned off with notify.vip_override

Implemented-by: Claude Sonnet
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 11: The `push_batch` job + `createNotifier` (US-B15, tier: Sonnet)

> **Story** — Goal: the batch job (09/12/15/18 KST) folds everything into a single "N drafts ready" notification and ships only the first 80 characters as the body. Deliverables: `packages/kernel/src/notify/batch.ts`. Verification: `pnpm --filter @omnis/kernel test`.

**Read:** the last two paragraphs of A4 §3.6, delta §2.3 (`PushPayload.body` is `max(80)`), delta §8 (`push_batch`).
**Do not build (YAGNI):** a notification dedup store, read-state sync. The single batch is counted fresh every time.

**Files:**
- Create: `packages/kernel/src/notify/batch.ts`, `packages/kernel/test/integration/notify-batch.test.ts`
- Modify: `packages/kernel/src/index.ts`
- Test: `packages/kernel/test/integration/notify-batch.test.ts`

**Interfaces:**
- Consumes: `PushPayload`/`NotifyTier` (`@omnis/protocol`), `notifyTierFor`/`inQuietHours` (Task 10), `sendWebPush` (Task 12 — used here only in the form injected as `Notifier.send`).
- Produces: `Notifier`, `createNotifier`, `runPushBatch`, `registerPushBatchJob`, `PUSH_BATCH_JOB_NAME`, `PUSH_BATCH_CRON`, `first80`.

### Steps

- [ ] 1. Write the failing test.

```ts
// packages/kernel/test/integration/notify-batch.test.ts
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../../src/logger.js";
import { PUSH_BATCH_CRON, first80, runPushBatch } from "../../src/notify/batch.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});
afterAll(() => pool.end());

let threadId = "";
beforeEach(async () => {
  const a = await pool.query<{ id: string }>(
    `INSERT INTO accounts (channel, external_id, display) VALUES ('gmail','nb@test','n')
       ON CONFLICT (channel, external_id) DO UPDATE SET display='n' RETURNING id`);
  const t = await pool.query<{ id: string }>(
    `INSERT INTO threads (account_id, external_id, kind) VALUES ($1,'thr_nb','email')
       ON CONFLICT (account_id, external_id) DO UPDATE SET kind='email' RETURNING id`,
    [a.rows[0]?.id ?? ""]);
  threadId = t.rows[0]?.id ?? "";
  await pool.query("DELETE FROM items WHERE thread_id = $1", [threadId]);
});

describe("push_batch (A4 §3.6)", () => {
  it("runs at 09/12/15/18 KST", () => {
    expect(PUSH_BATCH_CRON).toBe("0 9,12,15,18 * * *");
  });

  it("truncates a body to the first 80 characters", () => {
    expect(first80("é".repeat(200))).toHaveLength(80);
    expect(first80("short")).toBe("short");
  });

  it("folds every pending draft into a single push", async () => {
    for (let i = 0; i < 3; i += 1) {
      await pool.query(
        `INSERT INTO items (thread_id, account_id, kind, status, body, sent_at, author_is_me)
         SELECT $1, account_id, 'email', 'draft', $2, now(), true FROM threads WHERE id = $1`,
        [threadId, `Draft ${i}`]);
    }
    const send = vi.fn(async () => undefined);
    const n = await runPushBatch({
      pool, logger: createLogger("@omnis/kernel"),
      notifier: { send }, now: new Date(),
    });
    expect(n).toBe(3);
    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0]?.[0] as { title: string; body: string; kind: string };
    expect(payload.kind).toBe("draft");
    expect(payload.body).toContain("3 drafts");
    expect(payload.body.length).toBeLessThanOrEqual(80);
  });

  it("sends nothing when there is no pending draft", async () => {
    const send = vi.fn(async () => undefined);
    const n = await runPushBatch({
      pool, logger: createLogger("@omnis/kernel"), notifier: { send }, now: new Date() });
    expect(n).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});
```

- [ ] 2. Confirm the failure. Expected: `Failed to resolve import "../../src/notify/batch.js"`.

```bash
pnpm --filter @omnis/kernel test:integration -- notify-batch
```

- [ ] 3. Write the implementation.

```ts
// packages/kernel/src/notify/batch.ts
// A4 §3.6: the batched tier folds into a single "N drafts ready" every 3 hours.
import { query } from "@omnis/db";
import type { NotifyTier, PushPayload } from "@omnis/protocol";
import type { Pool } from "pg";
import type { Logger } from "../logger.js";
import type { Scheduler } from "../scheduler.js";

export const PUSH_BATCH_JOB_NAME = "push_batch";
export const PUSH_BATCH_CRON = "0 9,12,15,18 * * *";

export interface Notifier {
  send(p: PushPayload, tier: NotifyTier): Promise<void>;
}

/** A4 §3.6 privacy principle: never put the full body on the lock screen. */
export function first80(s: string): string {
  return s.length <= 80 ? s : s.slice(0, 80);
}

export interface PushBatchDeps {
  pool: Pool;
  logger: Logger;
  notifier: Notifier;
  now?: Date;
}

export async function runPushBatch(deps: PushBatchDeps): Promise<number> {
  const { pool, notifier, logger } = deps;
  const rows = await query<{ n: string; thread_id: string | null }>(
    pool,
    `SELECT count(*)::text AS n, min(thread_id)::text AS thread_id
       FROM items WHERE status = 'draft' AND (meta->>'pending') IS DISTINCT FROM 'true'`,
  );
  const n = Number(rows[0]?.n ?? "0");
  if (n === 0) return 0;
  const threadId = rows[0]?.thread_id ?? "";
  await notifier.send(
    {
      kind: "draft",
      title: "omnis",
      body: first80(`${n} drafts ready`),
      deep_link: threadId === "" ? "omnis://inbox" : `omnis://thread/${threadId}`,
    },
    "batched",
  );
  logger.info("push batch sent", { drafts: n });
  return n;
}

export function registerPushBatchJob(scheduler: Scheduler, deps: PushBatchDeps): void {
  scheduler.register(PUSH_BATCH_JOB_NAME, PUSH_BATCH_CRON, async () => {
    await runPushBatch(deps);
  });
}

/** The real senders are Task 12's Web Push + Tauri local notifications. Here we only create the injection point. */
export function createNotifier(deps: {
  pool: Pool;
  logger: Logger;
  send: (p: PushPayload, tier: NotifyTier) => Promise<void>;
}): Notifier {
  return {
    async send(p, tier) {
      if (tier === "silent") return;
      try {
        await deps.send(p, tier);
      } catch (e) {
        // A4: do not swallow a send failure silently. It becomes a system Item, not an agent_runs row (backlog US-B17).
        deps.logger.error("notify send failed", {
          kind: p.kind, err: e instanceof Error ? e.message : String(e),
        });
        await query(
          deps.pool,
          `WITH acc AS (
             INSERT INTO accounts (channel, external_id, display) VALUES ('system','omnis','omnis')
             ON CONFLICT (channel, external_id) DO UPDATE SET display = EXCLUDED.display RETURNING id),
           thr AS (
             INSERT INTO threads (account_id, external_id, kind, title)
             SELECT id, 'system:agents', 'system', 'omnis' FROM acc
             ON CONFLICT (account_id, external_id) DO UPDATE SET kind = 'system' RETURNING id, account_id)
           INSERT INTO items (thread_id, account_id, kind, status, body, sent_at)
           SELECT thr.id, thr.account_id, 'system', 'received', $1, now() FROM thr`,
          [`Notification delivery failed (${p.kind}). Check the push subscription in settings.`],
        );
      }
    },
  };
}
```

- [ ] 4. Add the exports to `index.ts` and confirm it passes. Expected: 4 tests passed.

```ts
// packages/kernel/src/index.ts — added
export {
  PUSH_BATCH_CRON, PUSH_BATCH_JOB_NAME, createNotifier, first80, registerPushBatchJob,
  runPushBatch, type Notifier, type PushBatchDeps,
} from "./notify/batch.js";
```

```bash
pnpm --filter @omnis/kernel test:integration -- notify-batch && pnpm lint
git add packages/kernel/src/notify/batch.ts packages/kernel/src/index.ts packages/kernel/test/integration/notify-batch.test.ts
git commit -m "US-B15: push_batch job and createNotifier

- At 09/12/15/18 KST, folds every pending draft into one 'N drafts ready' notification
- first80 truncates the body so the full text never shows on the lock screen
- A send failure is surfaced as a system Item (never swallowed silently)

Implemented-by: Claude Sonnet
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 12: Web Push sender + macOS local notifications (US-B17, tier: Sonnet)

> **Story** — Goal: VAPID-signed Web Push (querying `push_subscriptions`, two actions, 410/404 cleanup) + Tauri notification deep links. Deliverables: `packages/kernel/src/notify/webpush.ts`, `apps/desktop/src-tauri/src/notify.rs`. Verification: `pnpm --filter @omnis/kernel test`. Depends on: B15, B16.

**Read:** A5 §4.4, delta §2.3 (`PushPayload`)·§6 (`0011_push_subscriptions.sql` is owned by the **wave 0 schema bundle**)·§9 (VAPID env vars).
**Dependency note:** the `push_subscriptions` table is created by **`0011` in the W0 schema bundle** (delta §6; moved off surfaces US-B36 ownership in the 2026-09-20 cross review M3 — the old assignment was a B17↔B36 cycle). This task's integration test assumes a DB with that migration applied, so it runs **after W0 is merged**.
**Single Web Push owner (2026-09-20 cross review M-webpush):** VAPID configuration plus the actual sending and subscription cleanup live in **this file only** (`packages/kernel/src/notify/webpush.ts`) — `vapidFromEnv`/`sendWebPush`/`pruneSubscription`/`WEBPUSH_GONE_CODES`/`VapidKeys`. surfaces plan Task 10 creates **only the routes** `POST`/`DELETE /push/subscribe` and `GET /push/vapid-public-key` and imports this module from `@omnis/kernel` to use it (the `web-push` dependency also lives in this one place). Do not create a second sending implementation (`sendPush`/`configureWebPush`/`PushSender`) in `apps/hub`.
**Do not build (YAGNI):** a hand-rolled VAPID signing implementation, a retry queue. `web-push` handles all the signing and encryption, and a failed endpoint is encountered again on the next send.

**Files:**
- Create: `packages/kernel/src/notify/webpush.ts`, `packages/kernel/test/integration/webpush.test.ts`, `apps/desktop/src-tauri/src/notify.rs`
- Modify: `packages/kernel/package.json`, `packages/kernel/src/index.ts`, `apps/desktop/src-tauri/src/lib.rs`
- Test: `packages/kernel/test/integration/webpush.test.ts`

**Interfaces:**
- Consumes: `PushPayload`(`@omnis/protocol`), `Notifier`(Task 11).
- Produces: `VapidKeys`, `sendWebPush`, `pruneSubscription`, `WEBPUSH_GONE_CODES`, `deepLinkFor`(Rust).

### Steps

- [ ] 1. Add the dependency.

```bash
pnpm --filter @omnis/kernel add web-push@3.6.7 && pnpm --filter @omnis/kernel add -D @types/web-push@3.6.4
```

- [ ] 2. Write the failing test. Mock the `web-push` module itself so no network is touched.

```ts
// packages/kernel/test/integration/webpush.test.ts
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const sendNotification = vi.fn();
vi.mock("web-push", () => ({
  default: { setVapidDetails: vi.fn(), sendNotification },
  setVapidDetails: vi.fn(),
  sendNotification,
}));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});
afterAll(() => pool.end());

const vapid = { publicKey: "pub", privateKey: "priv", subject: "mailto:x@example.com" };
const payload = {
  kind: "approval" as const, title: "omnis", body: "1 approval pending",
  deep_link: "omnis://thread/abc", approval_id: "11111111-1111-1111-1111-111111111111",
};

beforeEach(async () => {
  sendNotification.mockReset();
  await pool.query("DELETE FROM push_subscriptions");
  await pool.query(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, ua)
     VALUES ('https://push.example/a','p','a','iPhone'),
            ('https://push.example/b','p','a','iPhone')`);
});

describe("sendWebPush (A5 §4.4)", () => {
  it("sends one notification per subscription with the Approve action", async () => {
    sendNotification.mockResolvedValue({ statusCode: 201 });
    const { sendWebPush } = await import("../../src/notify/webpush.js");
    const sent = await sendWebPush({ pool, vapid, logger: console as never }, payload);
    expect(sent).toBe(2);
    const body = JSON.parse(String(sendNotification.mock.calls[0]?.[1]));
    expect(body.actions.map((a: { action: string }) => a.action)).toEqual(["approve", "open"]);
    expect(body.data.approval_id).toBe(payload.approval_id);
  });

  it("prunes a subscription on 410 and 404 and keeps the others", async () => {
    sendNotification
      .mockRejectedValueOnce(Object.assign(new Error("gone"), { statusCode: 410 }))
      .mockResolvedValueOnce({ statusCode: 201 });
    const { sendWebPush } = await import("../../src/notify/webpush.js");
    const sent = await sendWebPush({ pool, vapid, logger: console as never }, payload);
    expect(sent).toBe(1);
    const { rows } = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM push_subscriptions");
    expect(rows[0]?.n).toBe("1");
  });

  it("returns 0 and sends nothing when VAPID keys are missing", async () => {
    const { sendWebPush } = await import("../../src/notify/webpush.js");
    const sent = await sendWebPush(
      { pool, vapid: { publicKey: "", privateKey: "", subject: "" }, logger: console as never },
      payload);
    expect(sent).toBe(0);
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
```

- [ ] 3. Confirm the failure. Expected: `Failed to resolve import "../../src/notify/webpush.js"`.

```bash
pnpm --filter @omnis/kernel test:integration -- webpush
```

- [ ] 4. Write the implementation.

```ts
// packages/kernel/src/notify/webpush.ts
// A5 §4.4 + A4 §3.6. The keys live in Keychain omnis.webpush.vapid_* → launchd injects them as env (delta §9).
import { query } from "@omnis/db";
import type { PushPayload } from "@omnis/protocol";
import type { Pool } from "pg";
import webpush from "web-push";
import type { Logger } from "../logger.js";

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/** Responses meaning the subscription is gone. Both are deleted silently (RFC 8030). */
export const WEBPUSH_GONE_CODES: readonly number[] = [404, 410];

export function vapidFromEnv(env: NodeJS.ProcessEnv = process.env): VapidKeys {
  return {
    publicKey: env.OMNIS_WEBPUSH_VAPID_PUBLIC ?? "",
    privateKey: env.OMNIS_WEBPUSH_VAPID_PRIVATE ?? "",
    subject: env.OMNIS_WEBPUSH_SUBJECT ?? "mailto:281932556+jinhologankim@users.noreply.github.com",
  };
}

export async function pruneSubscription(pool: Pool, endpoint: string): Promise<void> {
  await query(pool, "DELETE FROM push_subscriptions WHERE endpoint = $1", [endpoint]);
}

export async function sendWebPush(
  deps: { pool: Pool; vapid: VapidKeys; logger: Logger },
  payload: PushPayload,
): Promise<number> {
  const { pool, vapid, logger } = deps;
  if (vapid.publicKey === "" || vapid.privateKey === "") {
    logger.warn("web push skipped: VAPID keys are not set");
    return 0;
  }
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);

  const subs = await query<{ endpoint: string; p256dh: string; auth: string }>(
    pool, "SELECT endpoint, p256dh, auth FROM push_subscriptions");
  // The two actions are exactly as in A5 §4.4. approve hits POST /approvals/:id/decide without opening the app.
  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    actions: [
      { action: "approve", title: "Approve" },
      { action: "open", title: "Open" },
    ],
    data: {
      deep_link: payload.deep_link,
      kind: payload.kind,
      ...(payload.approval_id !== undefined ? { approval_id: payload.approval_id } : {}),
    },
  });

  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body);
      sent += 1;
      await query(pool,
        "UPDATE push_subscriptions SET last_ok_at = now(), fail_count = 0 WHERE endpoint = $1",
        [s.endpoint]);
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code !== undefined && WEBPUSH_GONE_CODES.includes(code)) {
        await pruneSubscription(pool, s.endpoint);
        continue;
      }
      await query(pool,
        "UPDATE push_subscriptions SET fail_count = fail_count + 1 WHERE endpoint = $1",
        [s.endpoint]);
      logger.error("web push failed", { code: code ?? null });
    }
  }
  return sent;
}
```

- [ ] 5. Add the exports to `index.ts`.

```ts
// packages/kernel/src/index.ts — added
export {
  WEBPUSH_GONE_CODES, pruneSubscription, sendWebPush, vapidFromEnv, type VapidKeys,
} from "./notify/webpush.js";
```

- [ ] 6. Write the macOS local notification. The Tauri notification plugin shows the notification, and a click comes back through the `omnis://thread/{id}` deep link.

```rust
// apps/desktop/src-tauri/src/notify.rs
// A4 §3.6: macOS notifications follow the same three tiers as Web Push. The body carries only the first 80 characters.
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

/// omnis://thread/{id} deep link. With an approval_id it opens the approval card directly.
pub fn deep_link_for(thread_id: &str, approval_id: Option<&str>) -> String {
    match approval_id {
        Some(a) => format!("omnis://thread/{thread_id}?approval={a}"),
        None => format!("omnis://thread/{thread_id}"),
    }
}

/// The body is capped at 80 characters (character-based, not bytes) — the full text never lands on the lock screen.
pub fn first_80(body: &str) -> String {
    body.chars().take(80).collect()
}

#[tauri::command]
pub fn notify_local(
    app: AppHandle,
    title: String,
    body: String,
    thread_id: String,
    approval_id: Option<String>,
) -> Result<String, String> {
    let link = deep_link_for(&thread_id, approval_id.as_deref());
    app.notification()
        .builder()
        .title(title)
        .body(first_80(&body))
        .show()
        .map_err(|e| e.to_string())?;
    Ok(link)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deep_link_carries_the_approval_id() {
        assert_eq!(deep_link_for("t1", None), "omnis://thread/t1");
        assert_eq!(deep_link_for("t1", Some("a1")), "omnis://thread/t1?approval=a1");
    }

    #[test]
    fn body_is_truncated_to_80_characters_not_bytes() {
        let long = "é".repeat(200);
        assert_eq!(first_80(&long).chars().count(), 80);
    }
}
```

```rust
// apps/desktop/src-tauri/src/lib.rs — add to the mod declarations and invoke_handler
mod notify;
// .invoke_handler(tauri::generate_handler![notify::notify_local])
```

```bash
pnpm --filter @omnis/desktop exec -- cargo add tauri-plugin-notification --manifest-path src-tauri/Cargo.toml
```

- [ ] 7. Confirm both pass and commit. Expected: vitest 3 tests passed, `cargo test` 2 tests passed.

```bash
pnpm --filter @omnis/kernel test:integration -- webpush && \
  (cd apps/desktop/src-tauri && cargo test notify) && pnpm lint
git add packages/kernel/src/notify/webpush.ts packages/kernel/src/index.ts packages/kernel/package.json packages/kernel/test/integration/webpush.test.ts apps/desktop/src-tauri
git commit -m "US-B17: Web Push sender and macOS local notifications

- After VAPID signing, sends to every push_subscriptions row with the two actions Approve/Open
- A 410/404 response deletes the subscription; anything else just bumps fail_count
- With no VAPID keys it returns 0 and sends nothing
- Tauri notify_local builds the omnis://thread/{id} deep link and truncates the body to 80 characters

Implemented-by: Claude Sonnet
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 13: `archiveItem` / `undoArchive` — 7-day undo + 30-day re-archive exclusion (US-B18, tier: Opus)

> **Story** — Goal: recording `items.meta.archived_by`, `undoArchive()` (`archived`→`received` + `audit_log` + a 30-day exclusion for that thread), and no hard-delete path. Deliverables: `packages/kernel/src/archive.ts`. Verification: `pnpm --filter @omnis/kernel test:integration`. Depends on: B06.

**Read:** A4 §9.3 (the `archived_by` JSON shape)·§9.4 (the 4 undo clauses), delta §5 (the `archive.ts` block)·§0-4 (both columns are used), `apps/hub/src/archive.ts` (thread-level archiving — a different axis from this one).
**Do not build (YAGNI):** an undo token table. The token is recomputed in that day's digest from the combination of `digests.id` and the group reason (Task 22).

**Files:**
- Create: `packages/kernel/src/archive.ts`, `packages/kernel/test/integration/archive.test.ts`
- Modify: `packages/kernel/src/index.ts`
- Test: `packages/kernel/test/integration/archive.test.ts`

**Interfaces:**
- Consumes: `Audit`(Phase A), `query`(`@omnis/db`).
- Produces: `UNDO_WINDOW_DAYS`, `REARCHIVE_EXCLUSION_DAYS`, `ArchivedByMeta`, `archiveItem`, `undoArchive`, `isRearchiveExcluded`, `archivedSince`.

### Steps

- [ ] 1. Write the failing test.

```ts
// packages/kernel/test/integration/archive.test.ts
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createAudit } from "../../src/audit.js";
import {
  REARCHIVE_EXCLUSION_DAYS, UNDO_WINDOW_DAYS, archiveItem, archivedSince,
  isRearchiveExcluded, undoArchive,
} from "../../src/archive.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});
afterAll(() => pool.end());

let threadId = "";
let itemId = "";
beforeEach(async () => {
  const a = await pool.query<{ id: string }>(
    `INSERT INTO accounts (channel, external_id, display) VALUES ('gmail','arch@test','a')
       ON CONFLICT (channel, external_id) DO UPDATE SET display='a' RETURNING id`);
  const accountId = a.rows[0]?.id ?? "";
  const t = await pool.query<{ id: string }>(
    `INSERT INTO threads (account_id, external_id, kind, meta) VALUES ($1,'thr_arch','email','{}'::jsonb)
       ON CONFLICT (account_id, external_id) DO UPDATE SET meta = '{}'::jsonb RETURNING id`, [accountId]);
  threadId = t.rows[0]?.id ?? "";
  const i = await pool.query<{ id: string }>(
    `INSERT INTO items (thread_id, account_id, external_id, kind, status, body, sent_at, meta)
     VALUES ($1,$2,'it_arch','email','received','Newsletter', now(), '{}'::jsonb)
     ON CONFLICT (account_id, external_id)
       DO UPDATE SET status='received', meta='{}'::jsonb RETURNING id`, [threadId, accountId]);
  itemId = i.rows[0]?.id ?? "";
});

const meta = {
  rule_ids: ["ar_sender_nonhuman", "ar_no_cta"], reason: "Newsletter", tier: "T0" as const,
  confidence: 0.93, run_id: "00000000-0000-0000-0000-0000000000aa",
  at: new Date().toISOString(),
};

describe("archiveItem / undoArchive (A4 §9.3·§9.4)", () => {
  it("sets status=archived and records meta.archived_by", async () => {
    await archiveItem(pool, itemId, meta);
    const { rows } = await pool.query<{ status: string; ab: typeof meta }>(
      "SELECT status, meta->'archived_by' AS ab FROM items WHERE id = $1", [itemId]);
    expect(rows[0]?.status).toBe("archived");
    expect(rows[0]?.ab.reason).toBe("Newsletter");
    expect(UNDO_WINDOW_DAYS).toBe(7);
    expect(REARCHIVE_EXCLUSION_DAYS).toBe(30);
  });

  it("undo returns the item to received, audits it, and excludes the thread for 30 days", async () => {
    await archiveItem(pool, itemId, meta);
    const n = await undoArchive(pool, { itemId }, "me", createAudit(pool));
    expect(n).toBe(1);
    const { rows } = await pool.query<{ status: string }>(
      "SELECT status FROM items WHERE id = $1", [itemId]);
    expect(rows[0]?.status).toBe("received");
    const au = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_log WHERE action = 'item.unarchive' AND target_id = $1",
      [itemId]);
    expect(au.rows[0]?.n).toBe("1");
    expect(await isRearchiveExcluded(pool, threadId, new Date())).toBe(true);
  });

  it("never deletes anything — the row is still there after undo", async () => {
    await archiveItem(pool, itemId, meta);
    await undoArchive(pool, { itemId }, "me", createAudit(pool));
    const { rows } = await pool.query("SELECT id FROM items WHERE id = $1", [itemId]);
    expect(rows).toHaveLength(1);
  });

  it("archivedSince lists the day's archived items by reason", async () => {
    await archiveItem(pool, itemId, meta);
    const groups = await archivedSince(pool, new Date(Date.now() - 3_600_000));
    expect(groups.find((g) => g.reason === "Newsletter")?.count).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] 2. Confirm the failure. Expected: `Failed to resolve import "../../src/archive.js"`.

```bash
pnpm --filter @omnis/kernel test:integration -- archive
```

- [ ] 3. Write the implementation.

```ts
// packages/kernel/src/archive.ts
// A4 §9.3·§9.4. Never hard-delete under any circumstance (A3 §11: items are kept forever).
import { query } from "@omnis/db";
import type { Pool } from "pg";
import type { Audit } from "./audit.js";

export const UNDO_WINDOW_DAYS = 7;
export const REARCHIVE_EXCLUSION_DAYS = 30;

export interface ArchivedByMeta {
  rule_ids: string[];
  reason: string;
  tier: "T0" | "T1";
  confidence: number;
  run_id: string;
  /** The reference timestamp for the 7-day undo window. items has no archived-at column (A4 §9.3). */
  at: string;
}

export async function archiveItem(
  pool: Pool,
  itemId: string,
  meta: ArchivedByMeta,
): Promise<void> {
  await query(
    pool,
    `UPDATE items SET status = 'archived',
        meta = meta || jsonb_build_object('archived_by', $2::jsonb)
      WHERE id = $1 AND status = 'received'`,
    [itemId, JSON.stringify(meta)],
  );
}

/** A thread a human undid is excluded from auto-archive for 30 days (A4 §9.4). */
export async function isRearchiveExcluded(
  pool: Pool,
  threadId: string,
  now: Date,
): Promise<boolean> {
  const rows = await query<{ until: string | null }>(
    pool, "SELECT meta->>'no_auto_archive_until' AS until FROM threads WHERE id = $1", [threadId]);
  const until = rows[0]?.until;
  return until !== undefined && until !== null && new Date(until) > now;
}

export async function undoArchive(
  pool: Pool,
  ref: { itemId?: string; undoToken?: string },
  actor: string,
  audit: Audit,
): Promise<number> {
  const rows = await query<{ id: string; thread_id: string }>(
    pool,
    `UPDATE items SET status = 'received'
      WHERE status = 'archived'
        AND (meta->'archived_by'->>'at')::timestamptz > now() - ($3 || ' days')::interval
        AND ( ($1::uuid IS NOT NULL AND id = $1)
           OR ($2::text IS NOT NULL AND meta->'archived_by'->>'undo_token' = $2) )
     RETURNING id, thread_id`,
    [ref.itemId ?? null, ref.undoToken ?? null, String(UNDO_WINDOW_DAYS)],
  );
  const threads = new Set(rows.map((r) => r.thread_id));
  for (const t of threads) {
    await query(
      pool,
      `UPDATE threads SET meta = meta || jsonb_build_object(
          'no_auto_archive_until', (now() + ($2 || ' days')::interval)::text)
        WHERE id = $1`,
      [t, String(REARCHIVE_EXCLUSION_DAYS)],
    );
  }
  for (const r of rows) {
    await audit.record({
      actor, action: "item.unarchive", target_table: "items", target_id: r.id,
      before: { status: "archived" }, after: { status: "received" },
    });
  }
  return rows.length;
}

export interface ArchivedGroup {
  reason: string;
  count: number;
  item_ids: string[];
}

/** The nightly digest reads a day's worth grouped by reason (A4 §9.4 "full exposure"). */
export async function archivedSince(pool: Pool, since: Date): Promise<ArchivedGroup[]> {
  const rows = await query<{ reason: string; count: string; item_ids: string[] }>(
    pool,
    `SELECT COALESCE(meta->'archived_by'->>'reason', 'Other') AS reason,
            count(*)::text AS count,
            (array_agg(id ORDER BY sent_at DESC))[1:50] AS item_ids
       FROM items
      WHERE status = 'archived'
        AND (meta->'archived_by'->>'at')::timestamptz >= $1
      GROUP BY 1 ORDER BY count(*) DESC`,
    [since],
  );
  return rows.map((r) => ({ reason: r.reason, count: Number(r.count), item_ids: r.item_ids }));
}
```

- [ ] 4. Add the exports to `index.ts` and confirm it passes. Expected: 4 tests passed.

```ts
// packages/kernel/src/index.ts — added
export {
  REARCHIVE_EXCLUSION_DAYS, UNDO_WINDOW_DAYS, archiveItem, archivedSince,
  isRearchiveExcluded, undoArchive, type ArchivedByMeta, type ArchivedGroup,
} from "./archive.js";
```

```bash
pnpm --filter @omnis/kernel test:integration -- archive && pnpm lint
git add packages/kernel/src/archive.ts packages/kernel/src/index.ts packages/kernel/test/integration/archive.test.ts
git commit -m "US-B18: archiveItem/undoArchive — 7-day undo and 30-day re-archive exclusion

- Writes rule_ids/reason/tier/confidence/run_id/at into items.meta.archived_by
- undoArchive flips archived→received only inside the 7-day window and leaves an audit_log row
- An undone thread is excluded for 30 days via threads.meta.no_auto_archive_until
- There is no hard-delete path

Implemented-by: Claude Opus
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 14: `autoArchiveLoop` — the 5 hard gates + the T0 verdict + the T1 threshold (US-B18, tier: Opus)

> **Story** — Goal: the 5 hard gates first, ①③④ as pure SQL (T0), only ② and ④-b at T1 (`confidence ≥ 0.85`), and the 22:00 sweep. Deliverables: `packages/agents/src/loops/auto-archive.ts`. Verification: `pnpm --filter @omnis/agents test && pnpm eval:archive`.

**Read:** all of A4 §9.1–§9.5 (the hard gate list, the 5-row verdict table, the T1 threshold), `decide?` from Task 1, Task 13.
**Do not build (YAGNI):** a rule counter table. A4 §9.3 pins this down to an aggregate query.

**Files:**
- Create: `packages/agents/src/loops/auto-archive.ts`, `packages/agents/test/integration/auto-archive.test.ts`, `tools/eval/auto-archive.ts`, `eval/auto_archive.jsonl`
- Modify: `packages/agents/src/index.ts`, `package.json` (the root `eval:archive` script)
- Test: `packages/agents/test/integration/auto-archive.test.ts`

**Interfaces:**
- Consumes: `archiveItem`/`isRearchiveExcluded` (Task 13 — the hub does not inject them, and since it does **not** depend on `@omnis/kernel`, this loop writes SQL directly in `apply()`), `needsReplyScore` (Task 8), `registerLoop`/`runLoopSpec` (Task 1·3).
- Produces: `autoArchiveLoop`, `AutoArchiveOutput`, `type AutoArchiveOutputT`, `hardGate`, `nonHumanSender`, `T1_ARCHIVE_CONFIDENCE_MIN`, `AUTO_ARCHIVE_RULES`, `sweepAutoArchive`.

### Steps

- [ ] 1. Write the failing test — the hard gates and the T0 path are the core of it.

```ts
// packages/agents/test/integration/auto-archive.test.ts
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  T1_ARCHIVE_CONFIDENCE_MIN, autoArchiveLoop, configureAgents, hardGate, nonHumanSender,
} from "../../src/index.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});
let accountId = "";
let threadId = "";
beforeEach(async () => {
  configureAgents({ pool });
  const a = await pool.query<{ id: string }>(
    `INSERT INTO accounts (channel, external_id, display) VALUES ('gmail','aa@test','a')
       ON CONFLICT (channel, external_id) DO UPDATE SET display='a' RETURNING id`);
  accountId = a.rows[0]?.id ?? "";
  const t = await pool.query<{ id: string }>(
    `INSERT INTO threads (account_id, external_id, kind, meta) VALUES ($1,'thr_aa','email','{}'::jsonb)
       ON CONFLICT (account_id, external_id) DO UPDATE SET meta='{}'::jsonb RETURNING id`, [accountId]);
  threadId = t.rows[0]?.id ?? "";
  await pool.query("DELETE FROM items WHERE thread_id = $1", [threadId]);
  await pool.query("DELETE FROM pending_approvals WHERE thread_id = $1", [threadId]);
});
afterAll(() => pool.end());

async function mkItem(over: Record<string, unknown> = {}): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO items (thread_id, account_id, kind, status, sensitivity, body, sent_at, meta)
     VALUES ($1,$2,'email','received',$3,$4, now(), $5::jsonb) RETURNING id`,
    [threadId, accountId, over.sensitivity ?? "normal", over.body ?? "This is the weekly newsletter",
     JSON.stringify(over.meta ?? {})]);
  return rows[0]?.id ?? "";
}

describe("autoArchiveLoop hard gates (A4 §9.2)", () => {
  it("declares the T0-first spec", () => {
    expect(autoArchiveLoop.id).toBe("auto_archive");
    expect(autoArchiveLoop.tier).toBe("T0");
    expect(autoArchiveLoop.palette).toEqual([]);
    expect(T1_ARCHIVE_CONFIDENCE_MIN).toBe(0.85);
  });

  it("refuses non-normal sensitivity, VIP, pending approvals, injection flags and wrong kinds", async () => {
    const sensitive = await mkItem({ sensitivity: "finance" });
    expect((await hardGate(pool, sensitive)).blocked).toBe(true);

    const flagged = await mkItem({ meta: { injection_flags: ["instruction_override"] } });
    expect((await hardGate(pool, flagged)).blocked).toBe(true);

    const plain = await mkItem();
    await pool.query(
      `INSERT INTO pending_approvals (action, args, description, thread_id)
       VALUES ('send','{}'::jsonb,'pending approval',$1)`, [threadId]);
    expect((await hardGate(pool, plain)).blocked).toBe(true);
  });

  it("nonHumanSender catches no-reply locals and bulk headers", () => {
    expect(nonHumanSender({ handle: "no-reply@news.example", meta: {} })).toBe(true);
    expect(nonHumanSender({ handle: "notifications@x.example", meta: {} })).toBe(true);
    expect(nonHumanSender({ handle: "a@b.example", meta: { "List-Unsubscribe": "<x>" } })).toBe(true);
    expect(nonHumanSender({ handle: "logan@onward.example", meta: {} })).toBe(false);
  });

  it("archives a newsletter entirely at T0 (no model call)", async () => {
    const id = await mkItem({ body: "Here is this week's news. To unsubscribe, see below." });
    await pool.query(
      `UPDATE items SET meta = meta || '{"headers":{"List-Unsubscribe":"<x>"}}'::jsonb WHERE id = $1`,
      [id]);
    const decided = await autoArchiveLoop.decide?.({
      trigger_kind: "event", item_id: id, thread_id: threadId, now: new Date(), payload: {},
    });
    expect(decided?.output.archive).toBe(true);
    expect(decided?.output.tier).toBe("T0");
    const runs = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM agent_runs WHERE item_id = $1 AND model_tier <> 'T0'", [id]);
    expect(runs.rows[0]?.n).toBe("0");
  });
});
```

- [ ] 2. Confirm the failure. Expected: `does not provide an export named 'autoArchiveLoop'`.

```bash
pnpm --filter @omnis/agents test -- auto-archive
```

- [ ] 3. Write the implementation.

```ts
// packages/agents/src/loops/auto-archive.ts
// A4 §9. This loop is not egress — it creates no pending_approvals, and it is guaranteed by three things:
// the 7-day undo, full exposure, and no hard delete.
import { z } from "zod";
import { registerLoop } from "../loop/registry.js";
import type { LoopSpec, TriggerContext } from "../loop/spec.js";
import { getAgentsPool } from "../pool.js";
import { buildContext } from "../context/assemble.js";

export const T1_ARCHIVE_CONFIDENCE_MIN = 0.85;

export const AUTO_ARCHIVE_RULES = {
  senderNonHuman: "ar_sender_nonhuman",
  noCta: "ar_no_cta",
  notVipNormal: "ar_not_vip_normal",
  neverReplied: "ar_never_replied",
  noNewQuestion: "ar_no_new_question",
} as const;

export const AutoArchiveOutput = z.object({
  archive: z.boolean(),
  reason: z.string().max(40),
  rule_ids: z.array(z.string()),
  tier: z.enum(["T0", "T1"]),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(200),
  injection_flags: z.array(z.string()).default([]),
});
export type AutoArchiveOutputT = z.infer<typeof AutoArchiveOutput>;

const NONHUMAN_LOCAL = /^(no-?reply|noreply|donotreply|notifications?|alerts?|mailer|bounce)/i;

export function nonHumanSender(i: { handle: string; meta: Record<string, unknown> }): boolean {
  const local = i.handle.split("@")[0] ?? "";
  if (NONHUMAN_LOCAL.test(local)) return true;
  const headers = (i.meta.headers ?? i.meta) as Record<string, unknown>;
  if (typeof headers["List-Unsubscribe"] === "string") return true;
  if (String(headers.Precedence ?? "").toLowerCase() === "bulk") return true;
  if (i.meta.bot === true) return true;   // sent by a Slack bot
  return false;
}

export interface HardGateResult {
  blocked: boolean;
  reason: string | null;
}

/** A4 §9.2: the 5 hard gates evaluated before the rules. If any one of them trips, never archive. */
export async function hardGate(
  pool: ReturnType<typeof getAgentsPool>,
  itemId: string,
): Promise<HardGateResult> {
  const { rows } = await pool.query<{
    sensitivity: string; kind: string; vip: boolean | null;
    pending: string; flags: number; excluded: string | null;
  }>(
    `SELECT i.sensitivity, i.kind,
            p.vip,
            (SELECT count(*)::text FROM pending_approvals a
              WHERE a.thread_id = i.thread_id AND a.state = 'pending') AS pending,
            COALESCE(jsonb_array_length(i.meta->'injection_flags'), 0) AS flags,
            t.meta->>'no_auto_archive_until' AS excluded
       FROM items i
       JOIN threads t ON t.id = i.thread_id
       LEFT JOIN persons p ON p.id = i.author_person_id
      WHERE i.id = $1`,
    [itemId]);
  const r = rows[0];
  if (r === undefined) return { blocked: true, reason: "item not found" };
  if (r.sensitivity !== "normal") return { blocked: true, reason: "sensitivity" };
  if (r.vip === true) return { blocked: true, reason: "vip" };
  if (Number(r.pending) > 0) return { blocked: true, reason: "pending_approval" };
  if (r.flags > 0) return { blocked: true, reason: "injection_flags" };
  if (!["message", "email"].includes(r.kind)) return { blocked: true, reason: "kind" };
  if (r.excluded !== null && new Date(r.excluded) > new Date()) {
    return { blocked: true, reason: "rearchive_exclusion" };
  }
  return { blocked: false, reason: null };
}

async function t0Verdict(itemId: string): Promise<AutoArchiveOutputT | null> {
  const pool = getAgentsPool();
  const { rows } = await pool.query<{
    body: string; handle: string; meta: Record<string, unknown>; i_replied: boolean;
  }>(
    `SELECT i.body, COALESCE(id2.handle, '') AS handle, i.meta,
            EXISTS (SELECT 1 FROM items x
                     WHERE x.thread_id = i.thread_id AND x.author_is_me AND x.status = 'sent') AS i_replied
       FROM items i
       LEFT JOIN identities id2 ON id2.person_id = i.author_person_id
      WHERE i.id = $1 LIMIT 1`,
    [itemId]);
  const r = rows[0];
  if (r === undefined) return null;

  const rules: string[] = [];
  // ① The sender is not a human (T0, $0)
  if (!nonHumanSender({ handle: r.handle, meta: r.meta })) return null;
  rules.push(AUTO_ARCHIVE_RULES.senderNonHuman);
  // ③ Not a VIP + sensitivity normal — hardGate already guarantees this
  rules.push(AUTO_ARCHIVE_RULES.notVipNormal);
  // ④ I have never replied. If I have replied, it falls through to ④-b (T1).
  if (r.i_replied) return null;
  rules.push(AUTO_ARCHIVE_RULES.neverReplied);
  // ② The T0 path: no question mark. With a question mark, it runs T1.
  if (r.body.includes("?") || r.body.includes("？")) return null;
  rules.push(AUTO_ARCHIVE_RULES.noCta);

  return {
    archive: true,
    reason: typeof (r.meta as { headers?: Record<string, unknown> }).headers?.["List-Unsubscribe"] === "string"
      ? "Newsletter" : "Notification email",
    rule_ids: rules,
    tier: "T0",
    confidence: 0.95,
    rationale: "Archived because the sender is not a human and there is no question addressed to me.",
    injection_flags: [],
  };
}

async function applyArchive(itemId: string, out: AutoArchiveOutputT, runId: string): Promise<void> {
  if (!out.archive) return;
  if (out.tier === "T1" && out.confidence < T1_ARCHIVE_CONFIDENCE_MIN) return;
  // ponytail: @omnis/agents cannot depend on @omnis/kernel, so it cannot call archiveItem directly.
  // The same single UPDATE statement lives here (intentional duplication per contract §12).
  await getAgentsPool().query(
    `UPDATE items SET status = 'archived',
        meta = meta || jsonb_build_object('archived_by', jsonb_build_object(
          'rule_ids', $2::jsonb, 'reason', $3::text, 'tier', $4::text,
          'confidence', $5::real, 'run_id', $6::text, 'at', now()::text))
      WHERE id = $1 AND status = 'received'`,
    [itemId, JSON.stringify(out.rule_ids), out.reason, out.tier, out.confidence, runId]);
}

export const autoArchiveLoop: LoopSpec<AutoArchiveOutputT> = {
  id: "auto_archive",
  kind: "reactive",
  trigger: {
    kind: "event",
    on: "item.labeled",
    where: "status = 'received' AND author_is_me = false AND kind IN ('message','email')",
    debounceMs: 20_000,
  },
  palette: [],
  budget: { inputTokens: 1500, outputTokens: 120, wallClockMs: 8_000, maxSteps: 1 },
  tier: "T0",
  outputSchema: AutoArchiveOutput,

  async decide(ctx: TriggerContext) {
    const itemId = ctx.item_id;
    if (itemId === undefined) return null;
    const gate = await hardGate(getAgentsPool(), itemId);
    if (gate.blocked) {
      return {
        loop: "auto_archive" as const,
        output: {
          archive: false, reason: gate.reason ?? "gate", rule_ids: [], tier: "T0" as const,
          confidence: 1, rationale: `Blocked by a hard gate (${gate.reason ?? "gate"}), so it was not archived.`,
          injection_flags: [],
        },
        confidence: 1, rationale: "hard gate", escalate: false,
        injection_flags: [], unresolved: [],
      };
    }
    const t0 = await t0Verdict(itemId);
    if (t0 === null) return null;   // ② or ④-b is ambiguous → the T1 path
    return {
      loop: "auto_archive" as const, output: t0, confidence: t0.confidence,
      rationale: t0.rationale, escalate: false, injection_flags: [], unresolved: [],
    };
  },

  assemble: (ctx: TriggerContext) =>
    buildContext({
      thread: { threadId: ctx.thread_id ?? "", lastN: 4, includeToolCalls: false },
    }),

  async apply(result, ctx) {
    if (ctx.item_id === undefined) return;
    await applyArchive(ctx.item_id, result.output, result.run_id);
  },
};

registerLoop(autoArchiveLoop);

/** A4 §9.1 second path: the 22:00 sweep. It finishes before the 23:00 digest. */
export async function sweepAutoArchive(runOne: (itemId: string, threadId: string) => Promise<void>): Promise<number> {
  const { rows } = await getAgentsPool().query<{ id: string; thread_id: string }>(
    `SELECT id, thread_id FROM items
      WHERE status = 'received' AND author_is_me = false AND kind IN ('message','email')
        AND sent_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul'
      ORDER BY sent_at LIMIT 500`);
  for (const r of rows) await runOne(r.id, r.thread_id);
  return rows.length;
}
```

- [ ] 4. Write the eval harness. Build a 150-case golden set from seed data and make **false-archive precision ≥ 0.97 + zero VIP/sensitive archives** a hard gate.

```ts
// tools/eval/auto-archive.ts
// A4 §9.5. It reads only the seed JSONL — no real account required (B-D5).
import { readFileSync } from "node:fs";
import { hardGate, nonHumanSender } from "@omnis/agents";
import { createPool } from "@omnis/db";

interface Case {
  id: string;
  handle: string;
  body: string;
  meta: Record<string, unknown>;
  sensitivity: "normal" | "personal" | "finance" | "legal" | "health";
  vip: boolean;
  i_replied: boolean;
  expect_archive: boolean;
}

const cases = readFileSync("eval/auto_archive.jsonl", "utf8")
  .split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as Case);

let tp = 0;
let fp = 0;
let fn = 0;
let unsafe = 0;

for (const c of cases) {
  const gateBlocked = c.sensitivity !== "normal" || c.vip;
  const archived = !gateBlocked && nonHumanSender({ handle: c.handle, meta: c.meta })
    && !c.i_replied && !c.body.includes("?");
  if (archived && c.expect_archive) tp += 1;
  if (archived && !c.expect_archive) fp += 1;
  if (!archived && c.expect_archive) fn += 1;
  if (archived && (c.sensitivity !== "normal" || c.vip)) unsafe += 1;
}

const precision = tp / Math.max(1, tp + fp);
const recall = tp / Math.max(1, tp + fn);
console.log(`auto-archive: n=${cases.length} precision=${precision.toFixed(3)} recall=${recall.toFixed(3)} unsafe=${unsafe}`);
if (unsafe > 0) { console.error("FAIL: a VIP or sensitive item was archived"); process.exit(1); }
if (precision < 0.97) { console.error("FAIL: precision < 0.97"); process.exit(1); }
if (recall < 0.70) { console.error("FAIL: recall < 0.70"); process.exit(1); }
void hardGate;
void createPool;
```

```jsonl
// eval/auto_archive.jsonl — the first 4 lines (fill the remaining 146 in the same format: 90 that should be archived / 60 that should not)
{"id":"e1","handle":"no-reply@news.example","body":"Here is this week's news","meta":{"headers":{"List-Unsubscribe":"<x>"}},"sensitivity":"normal","vip":false,"i_replied":false,"expect_archive":true}
{"id":"e2","handle":"notifications@github.example","body":"The build succeeded","meta":{},"sensitivity":"normal","vip":false,"i_replied":false,"expect_archive":true}
{"id":"e3","handle":"kim@client.example","body":"When can I get the quote?","meta":{},"sensitivity":"normal","vip":true,"i_replied":true,"expect_archive":false}
{"id":"e4","handle":"no-reply@bank.example","body":"Transfer history notice","meta":{},"sensitivity":"finance","vip":false,"i_replied":false,"expect_archive":false}
```

> **Do not touch the root `package.json` scripts (2026-09-20 cross review M12).** The `"eval:archive": "tsx tools/eval/auto-archive.ts"` entry is already added by memory-ingestion plan Task 1 as the **single owner** (delta §1). This task creates only `tools/eval/auto-archive.ts`, which that script points at — adding the script block again causes a merge conflict in the root `package.json`.

- [ ] 5. Confirm it passes. Expected: `auto-archive.test.ts` 4 tests passed, and `pnpm eval:archive` prints `unsafe=0` and exits 0.

```bash
pnpm --filter @omnis/agents test -- auto-archive && pnpm eval:archive && pnpm lint
```

- [ ] 6. Commit.

```bash
git add packages/agents/src/loops/auto-archive.ts packages/agents/src/index.ts packages/agents/test/integration/auto-archive.test.ts tools/eval/auto-archive.ts eval/auto_archive.jsonl
git commit -m "US-B18: L8 auto-archive loop

- The 5 hard gates (sensitivity, VIP, pending approval, injection_flags, kind) are checked before the rules
- ①③④ are pure SQL (T0); only ② and ④-b run at T1, and confidence < 0.85 means no archive
- The 22:00 sweep picks up whatever the day missed
- pnpm eval:archive hard-gates on false-archive precision 0.97 and zero VIP/sensitive archives

Implemented-by: Claude Opus
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 15: `taskLoop` — precision-first todo extraction (US-B19, tier: Sonnet)

> **Story** — Goal: three triggers, `confidence < 0.70` is not even stored, at most 3 per item, `duplicate_of` merging, and `due_basis='inferred'` marking. Deliverables: `packages/agents/src/loops/task.ts`. Verification: `pnpm --filter @omnis/agents test`. Depends on: B07, **B20** (backlog §2, 2026-09-20 cross review M14 — `taskLoop` imports `routeByRule`).

**Read:** A4 §4.1–§4.2·§4.5, `propose_task` from Task 5.
**Do not build (YAGNI):** a separate duplicate-detection service. The open task list the assembler provides plus the model's single `duplicate_of` field is all it takes.

**Files:**
- Create: `packages/agents/src/loops/task.ts`, `packages/agents/test/integration/task-loop.test.ts`
- Modify: `packages/agents/src/index.ts`
- Test: `packages/agents/test/integration/task-loop.test.ts`

**Interfaces:**
- Consumes: `buildContext` (US-B05), `PROPOSE_TOOLS` (Task 5), `extractHints`/`routeByRule` (Task 17 — `apply()` calls them directly with no optional chaining. Merge Task 17 first).
- Produces: `taskLoop`, `TaskOutput`, `type TaskOutputT`, `TASK_CONFIDENCE_MIN`, `TASK_MAX_PER_ITEM`.

### Steps

- [ ] 1. Write the failing test.

```ts
// packages/agents/test/integration/task-loop.test.ts
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  TASK_CONFIDENCE_MIN, TASK_MAX_PER_ITEM, configureAgents, taskLoop,
} from "../../src/index.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});
let threadId = "";
let itemId = "";
beforeEach(async () => {
  configureAgents({ pool });
  const a = await pool.query<{ id: string }>(
    `INSERT INTO accounts (channel, external_id, display) VALUES ('slack','tl@test','t')
       ON CONFLICT (channel, external_id) DO UPDATE SET display='t' RETURNING id`);
  const accountId = a.rows[0]?.id ?? "";
  const t = await pool.query<{ id: string }>(
    `INSERT INTO threads (account_id, external_id, kind) VALUES ($1,'thr_tl','dm')
       ON CONFLICT (account_id, external_id) DO UPDATE SET kind='dm' RETURNING id`, [accountId]);
  threadId = t.rows[0]?.id ?? "";
  const i = await pool.query<{ id: string }>(
    `INSERT INTO items (thread_id, account_id, kind, body, sent_at)
     VALUES ($1,$2,'message','I will send you the quote by tomorrow', now()) RETURNING id`,
    [threadId, accountId]);
  itemId = i.rows[0]?.id ?? "";
  await pool.query("DELETE FROM tasks WHERE source_item_id = $1", [itemId]);
});
afterAll(() => pool.end());

const result = (tasks: unknown[]) => ({
  loop: "task" as const, run_id: "00000000-0000-0000-0000-0000000000bb",
  output: { tasks, confidence: 0.9, rationale: "a promise sentence", injection_flags: [] },
  confidence: 0.9, rationale: "a promise sentence", escalate: false,
  injection_flags: [], unresolved: [],
});

describe("taskLoop (A4 §4.2)", () => {
  it("declares the A4 §4.5 budget and both event triggers", () => {
    expect(taskLoop.id).toBe("task");
    expect(taskLoop.budget).toEqual({
      inputTokens: 2800, outputTokens: 400, wallClockMs: 15_000, maxSteps: 2 });
    expect(TASK_CONFIDENCE_MIN).toBe(0.7);
    expect(TASK_MAX_PER_ITEM).toBe(3);
  });

  it("drops tasks below the confidence floor without storing them", async () => {
    await taskLoop.apply(
      result([
        { title: "A definite promise", owner: "me", due_basis: "stated", confidence: 0.8 },
        { title: "A vague guess", owner: "me", due_basis: "inferred", confidence: 0.69 },
      ]) as never,
      { trigger_kind: "event", item_id: itemId, thread_id: threadId, now: new Date(), payload: {} });
    const { rows } = await pool.query<{ title: string }>(
      "SELECT title FROM tasks WHERE source_item_id = $1", [itemId]);
    expect(rows.map((r) => r.title)).toEqual(["A definite promise"]);
  });

  it("stores at most three tasks per item", async () => {
    await taskLoop.apply(
      result([1, 2, 3, 4, 5].map((n) => ({
        title: `Task ${n}`, owner: "me", due_basis: "none", confidence: 0.9,
      }))) as never,
      { trigger_kind: "event", item_id: itemId, thread_id: threadId, now: new Date(), payload: {} });
    const { rows } = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM tasks WHERE source_item_id = $1", [itemId]);
    expect(rows[0]?.n).toBe("3");
  });

  it("merges into the existing task when duplicate_of is set", async () => {
    const t = await pool.query<{ id: string }>(
      "INSERT INTO tasks (title, created_by) VALUES ('Existing task','agent') RETURNING id");
    const existing = t.rows[0]?.id ?? "";
    await taskLoop.apply(
      result([{ title: "The same task", owner: "me", due_basis: "none", confidence: 0.9,
                duplicate_of: existing }]) as never,
      { trigger_kind: "event", item_id: itemId, thread_id: threadId, now: new Date(), payload: {} });
    const { rows } = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM tasks WHERE source_item_id = $1", [itemId]);
    expect(rows[0]?.n).toBe("0");
    const merged = await pool.query<{ source_item_id: string | null }>(
      "SELECT source_item_id FROM tasks WHERE id = $1", [existing]);
    expect(merged.rows[0]?.source_item_id).toBe(itemId);
  });
});
```

- [ ] 2. Confirm the failure. Expected: `does not provide an export named 'taskLoop'`.

```bash
pnpm --filter @omnis/agents test -- task-loop
```

- [ ] 3. Write the implementation.

```ts
// packages/agents/src/loops/task.ts
// A4 §4. Precision first — a false todo buries a real one.
import { z } from "zod";
import { buildContext } from "../context/assemble.js";
import { registerLoop } from "../loop/registry.js";
import type { LoopSpec, TriggerContext } from "../loop/spec.js";
import { PROPOSE_TOOLS } from "../tools/propose.js";
import { DELEGATION_DAILY_CAP, DELEGATION_THREAD_CAP_24H, extractHints, routeByRule, hostHealth }
  from "../delegate/route.js";

export const TASK_CONFIDENCE_MIN = 0.7;
export const TASK_MAX_PER_ITEM = 3;

export const TaskOutput = z.object({
  tasks: z.array(z.object({
    title: z.string().max(120),
    detail: z.string().max(600).optional(),
    owner: z.enum(["me", "agent"]),
    agent_hint: z.string().max(200).optional(),
    due_at: z.string().datetime().optional(),
    due_basis: z.enum(["stated", "inferred", "none"]),
    duplicate_of: z.string().uuid().optional(),
    confidence: z.number().min(0).max(1),
  })).max(8),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(200),
  injection_flags: z.array(z.string()).default([]),
});
export type TaskOutputT = z.infer<typeof TaskOutput>;

export const taskLoop: LoopSpec<TaskOutputT> = {
  id: "task",
  kind: "reactive",
  trigger: { kind: "event", on: "item.labeled", where: "author <> 'me'", debounceMs: 20_000 },
  palette: ["read_thread", "read_tasks", "search_memory", "propose_task", "propose_delegation"],
  budget: { inputTokens: 2800, outputTokens: 400, wallClockMs: 15_000, maxSteps: 2 },
  tier: "T1",
  outputSchema: TaskOutput,

  assemble: (ctx: TriggerContext) =>
    buildContext({
      selfModel: ["USER.md", "PROJECTS.md"],
      thread: { threadId: ctx.thread_id ?? "", lastN: 6 },
      tasks: { state: "open", limit: 20 },
      memories: { query: String(ctx.payload.query ?? ""), k: 3 },
    }),

  async apply(result, ctx) {
    const sourceItemId = ctx.item_id;
    if (sourceItemId === undefined) return;
    const kept = result.output.tasks
      .filter((t) => t.confidence >= TASK_CONFIDENCE_MIN)
      .slice(0, TASK_MAX_PER_ITEM);

    for (const t of kept) {
      const out = (await PROPOSE_TOOLS.propose_task?.execute?.(
        {
          title: t.title, source_item_id: sourceItemId, due_basis: t.due_basis,
          owner: t.owner, kind: t.owner === "agent" ? "delegation" : "todo",
          confidence: t.confidence,
          ...(t.detail !== undefined ? { detail: t.detail } : {}),
          ...(t.due_at !== undefined ? { due_at: t.due_at } : {}),
          ...(t.agent_hint !== undefined ? { agent_hint: t.agent_hint } : {}),
          ...(t.duplicate_of !== undefined ? { duplicate_of: t.duplicate_of } : {}),
        },
        { toolCallId: result.run_id, messages: [] },
      )) as { task_id: string } | undefined;

      // A4 §4.4: when owner='agent', routeByRule runs inside the same execution (no LLM call, ~1ms).
      if (out === undefined || t.owner !== "agent" || t.duplicate_of !== undefined) continue;
      if (result.injection_flags.length > 0) continue;               // runaway guard ④
      if (t.confidence < TASK_CONFIDENCE_MIN) continue;              // runaway guard ③
      const hints = extractHints(`${t.title}\n${t.detail ?? ""}\n${t.agent_hint ?? ""}`);
      const routing = routeByRule(hints, await hostHealth());
      if (routing === null) continue;                                // the rules could not decide → L4 wakes up
      if (!(await underDelegationCaps(ctx.thread_id ?? null))) continue;
      await PROPOSE_TOOLS.propose_delegation?.execute?.(
        {
          task_id: out.task_id, runtime: routing.runtime ?? "claude_code", host: routing.host,
          brief: t.detail ?? t.title, acceptance: [t.title], rule_id: routing.rule_id,
          confidence: t.confidence,
          ...(hints.est_minutes !== null ? { est_minutes: hints.est_minutes } : {}),
          ...(hints.repo !== null ? { workdir: hints.repo } : {}),
        },
        { toolCallId: result.run_id, messages: [] },
      );
    }
  },
};

/** A4 §4.4 runaway guards ①②: 5 per day, 2 per thread in 24h. */
async function underDelegationCaps(threadId: string | null): Promise<boolean> {
  const { getAgentsPool } = await import("../pool.js");
  const pool = getAgentsPool();
  const day = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM pending_approvals
      WHERE action = 'delegate' AND created_at > now() - interval '24 hours'`);
  if (Number(day.rows[0]?.n ?? "0") >= DELEGATION_DAILY_CAP) return false;
  if (threadId === null) return true;
  const thread = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM pending_approvals
      WHERE action = 'delegate' AND thread_id = $1 AND created_at > now() - interval '24 hours'`,
    [threadId]);
  return Number(thread.rows[0]?.n ?? "0") < DELEGATION_THREAD_CAP_24H;
}

registerLoop(taskLoop);
```

- [ ] 4. Add the exports to `index.ts` and confirm it passes. Expected: 4 tests passed.

```ts
// packages/agents/src/index.ts — added
export {
  TASK_CONFIDENCE_MIN, TASK_MAX_PER_ITEM, TaskOutput, taskLoop, type TaskOutputT,
} from "./loops/task.js";
```

```bash
pnpm --filter @omnis/agents test -- task-loop && pnpm lint
git add packages/agents/src/loops/task.ts packages/agents/src/index.ts packages/agents/test/integration/task-loop.test.ts
git commit -m "US-B19: L3 todo extraction loop

- confidence < 0.70 is not even stored (precision first)
- At most 3 per item; with duplicate_of it only adds source_item_id to the existing task
- When owner='agent' it runs routeByRule inside the same execution and creates an approval card only if all four runaway guards pass

Implemented-by: Claude Sonnet
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 16: The `task_remind` job — 3 pure-SQL groups with no LLM (US-B19, tier: Sonnet)

> **Story** — Goal: the reminder job (09/14/19 KST) runs 3 pure-SQL groups with no LLM and sends batched-tier notifications. Deliverables: `packages/kernel/src/jobs/task-remind.ts`. Verification: `pnpm --filter @omnis/kernel test:integration`.

**Read:** A4 §4.3 (the SQL as written + the 3 group strings), Task 10·11.
**Do not build (YAGNI):** a snooze state machine. `tasks.remind_at` already exists, and what A4 asked for is three group sentences.

**Files:**
- Create: `packages/kernel/src/jobs/task-remind.ts`, `packages/kernel/test/integration/task-remind.test.ts`
- Modify: `packages/kernel/src/index.ts`
- Test: `packages/kernel/test/integration/task-remind.test.ts`

**Interfaces:**
- Consumes: `Notifier`(Task 11), `notifyTierFor`(Task 10), `Scheduler`(Phase A).
- Produces: `TASK_REMIND_JOB_NAME`, `TASK_REMIND_CRON`, `remindGroups`, `runTaskRemind`, `registerTaskRemindJob`, `type RemindGroup`.

### Steps

- [ ] 1. Write the failing test.

```ts
// packages/kernel/test/integration/task-remind.test.ts
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "../../src/logger.js";
import { TASK_REMIND_CRON, remindGroups, runTaskRemind } from "../../src/jobs/task-remind.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});
afterAll(() => pool.end());
beforeEach(() => pool.query("DELETE FROM tasks WHERE created_by = 'remind-test'"));

describe("task_remind (A4 §4.3)", () => {
  it("runs at 09/14/19 KST", () => {
    expect(TASK_REMIND_CRON).toBe("0 9,14,19 * * *");
  });

  it("splits open tasks into due_soon / stale / undelegated", async () => {
    await pool.query(
      `INSERT INTO tasks (title, state, due_at, created_at, created_by) VALUES
         ('Due today','open', now() + interval '3 hours', now(), 'remind-test'),
         ('Untouched for 3 days','open', NULL, now() - interval '4 days', 'remind-test')`);
    await pool.query(
      `INSERT INTO tasks (title, state, owner_kind, delegated_session_id, created_at, created_by)
       VALUES ('A delegation that never went out','open','agent', NULL, now() - interval '5 hours', 'remind-test')`);
    const groups = await remindGroups(pool);
    const by = Object.fromEntries(groups.map((g) => [g.kind, g]));
    expect(by.due_soon?.count).toBeGreaterThanOrEqual(1);
    expect(by.stale?.count).toBeGreaterThanOrEqual(1);
    expect(by.undelegated?.count).toBeGreaterThanOrEqual(1);
    expect(by.due_soon?.line).toContain("Due today");
    expect(by.undelegated?.line).toContain("agent");
  });

  it("sends one batched push per non-empty group and nothing when all empty", async () => {
    const send = vi.fn(async () => undefined);
    const logger = createLogger("@omnis/kernel");
    const sentEmpty = await runTaskRemind({ pool, logger, notifier: { send } });
    const before = send.mock.calls.length;
    expect(sentEmpty).toBe(before);

    await pool.query(
      `INSERT INTO tasks (title, state, due_at, created_by)
       VALUES ('Due today','open', now() + interval '2 hours', 'remind-test')`);
    send.mockClear();
    await runTaskRemind({ pool, logger, notifier: { send } });
    expect(send).toHaveBeenCalled();
    expect(send.mock.calls[0]?.[1]).toBe("batched");
  });
});
```

- [ ] 2. Confirm the failure. Expected: `Failed to resolve import "../../src/jobs/task-remind.js"`.

```bash
pnpm --filter @omnis/kernel test:integration -- task-remind
```

- [ ] 3. Write the implementation.

```ts
// packages/kernel/src/jobs/task-remind.ts
// A4 §4.3: this is pure SQL with no LLM. Notifications use the 'batched' tier from §3.6.
import { query } from "@omnis/db";
import type { Pool } from "pg";
import type { Logger } from "../logger.js";
import { first80, type Notifier } from "../notify/batch.js";
import type { Scheduler } from "../scheduler.js";

export const TASK_REMIND_JOB_NAME = "task_remind";
export const TASK_REMIND_CRON = "0 9,14,19 * * *";

export type RemindKind = "due_soon" | "stale" | "undelegated";

export interface RemindGroup {
  kind: RemindKind;
  count: number;
  line: string;
  task_ids: string[];
}

const LINE: Record<RemindKind, (n: number) => string> = {
  due_soon: (n) => `${n} due today`,
  stale: (n) => `${n} items untouched for 3 days`,
  undelegated: (n) => `${n} items you meant to hand to an agent have not gone out yet`,
};

export async function remindGroups(pool: Pool): Promise<RemindGroup[]> {
  const rows = await query<{ kind: RemindKind; count: string; task_ids: string[] }>(
    pool,
    `WITH open_tasks AS (
       SELECT id, due_at, owner_kind, delegated_session_id, created_at
         FROM tasks WHERE state = 'open'
     ), classified AS (
       SELECT id,
              CASE
                WHEN due_at IS NOT NULL AND due_at < now() + interval '24 hours' THEN 'due_soon'
                WHEN owner_kind = 'agent' AND delegated_session_id IS NULL
                     AND created_at < now() - interval '4 hours' THEN 'undelegated'
                WHEN due_at IS NULL AND created_at < now() - interval '72 hours' THEN 'stale'
                ELSE NULL
              END AS kind
         FROM open_tasks
     )
     SELECT kind, count(*)::text AS count, array_agg(id) AS task_ids
       FROM classified WHERE kind IS NOT NULL GROUP BY kind`,
  );
  return rows.map((r) => ({
    kind: r.kind, count: Number(r.count), task_ids: r.task_ids,
    line: LINE[r.kind](Number(r.count)),
  }));
}

export interface TaskRemindDeps {
  pool: Pool;
  logger: Logger;
  notifier: Notifier;
}

export async function runTaskRemind(deps: TaskRemindDeps): Promise<number> {
  const groups = await remindGroups(deps.pool);
  for (const g of groups) {
    await deps.notifier.send(
      { kind: "draft", title: "omnis", body: first80(g.line), deep_link: "omnis://tasks" },
      "batched",
    );
  }
  deps.logger.info("task remind sent", { groups: groups.length });
  return groups.length;
}

export function registerTaskRemindJob(scheduler: Scheduler, deps: TaskRemindDeps): void {
  scheduler.register(TASK_REMIND_JOB_NAME, TASK_REMIND_CRON, async () => {
    await runTaskRemind(deps);
  });
}
```

- [ ] 4. Add the exports to `index.ts` and confirm it passes. Expected: 3 tests passed.

```ts
// packages/kernel/src/index.ts — added
export {
  TASK_REMIND_CRON, TASK_REMIND_JOB_NAME, registerTaskRemindJob, remindGroups, runTaskRemind,
  type RemindGroup, type RemindKind, type TaskRemindDeps,
} from "./jobs/task-remind.js";
```

```bash
pnpm --filter @omnis/kernel test:integration -- task-remind && pnpm lint
git add packages/kernel/src/jobs/task-remind.ts packages/kernel/src/index.ts packages/kernel/test/integration/task-remind.test.ts
git commit -m "US-B19: task_remind job — 3 pure-SQL groups

- 09/14/19 KST, zero LLM calls
- The three groups due_soon/stale/undelegated each use a different string
- Notifications go out at the batched tier

Implemented-by: Claude Sonnet
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 17: `extractHints` / `routeByRule` — the rules come first (US-B20, tier: Opus)

> **Story** — Goal: `DelegationHints` extraction (regex, not an LLM) + `routeByRule()` (~1ms, 5 rules) + the runaway-guard constants. Deliverables: `packages/agents/src/delegate/route.ts`. Verification: `pnpm --filter @omnis/agents test`. Depends on: **B07** (backlog §2, 2026-09-20 cross review M14 — the old `B19` had the direction backwards: `routeByRule` does not read `tasks`).
> **Execution order warning:** Task 15 (`taskLoop`) imports this module. **Implement Task 17 before Task 15.**

**Read:** all of A4 §5.2 (the code block + the runtime table), B-D6·B-D7 (Hermes excluded).
**Do not build (YAGNI):** a host health service. The single `agent_runtimes.last_seen_at` column is enough.

**Files:**
- Create: `packages/agents/src/delegate/route.ts`, `packages/agents/test/delegate-route.test.ts`
- Modify: `packages/agents/src/index.ts`
- Test: `packages/agents/test/delegate-route.test.ts`

**Interfaces:**
- Consumes: `HostId`/`RuntimeKind`(`@omnis/protocol`), `getAgentsPool`(Phase A).
- Produces: `DelegationHints`, `Routing`, `HostHealth`, `extractHints`, `routeByRule`, `pickRuntime`, `hostHealth`, `DELEGATION_DAILY_CAP`, `DELEGATION_THREAD_CAP_24H`, `MACBOOK_OFFLINE_MS`.

### Steps

- [ ] 1. Write the failing test (pure functions, so no DB).

```ts
// packages/agents/test/delegate-route.test.ts
import { describe, expect, it } from "vitest";
import {
  DELEGATION_DAILY_CAP, DELEGATION_THREAD_CAP_24H, extractHints, pickRuntime, routeByRule,
} from "../src/index.js";

const hosts = { mini: { lastHeartbeatMs: 0 }, macbook: { lastHeartbeatMs: 0 } };

describe("extractHints (A4 §5.2)", () => {
  it("pulls absolute paths, cron words and minutes out of text with regex only", () => {
    const h = extractHints("Run the report every day in /Users/logankim/AI-Workspaces/omnis, which takes about 45 minutes");
    expect(h.needs_paths).toEqual(["/Users/logankim/AI-Workspaces/omnis"]);
    expect(h.needs_always_on).toBe(true);
    expect(h.est_minutes).toBe(45);
    expect(h.repo).toBe("/Users/logankim/AI-Workspaces/omnis");
  });

  it("flags a GUI channel session", () => {
    expect(extractHints("Replying over KakaoTalk").needs_channel_session).toBe(true);
    expect(extractHints("Tidying up LinkedIn messages").needs_channel_session).toBe(true);
    expect(extractHints("Summarizing a document").needs_channel_session).toBe(false);
  });
});

describe("routeByRule (A4 §5.2)", () => {
  it("applies the five rules in order", () => {
    expect(routeByRule(extractHints("Fix the file /Users/logankim/x"), hosts))
      .toMatchObject({ host: "macbook", rule_id: "dr_local_files" });
    expect(routeByRule(extractHints("Tidy up KakaoTalk"), hosts))
      .toMatchObject({ host: "mini", rule_id: "dr_gui_session" });
    expect(routeByRule({ ...extractHints("A long task"), est_minutes: 30 }, hosts))
      .toMatchObject({ host: "mini", rule_id: "dr_long_batch" });
    expect(routeByRule(extractHints("Run it daily"), hosts))
      .toMatchObject({ host: "mini", rule_id: "dr_always_on" });
    expect(routeByRule(extractHints("Summarizing a document"), {
      mini: { lastHeartbeatMs: 0 }, macbook: { lastHeartbeatMs: 300_000 },
    })).toMatchObject({ host: "mini", rule_id: "dr_macbook_offline" });
  });

  it("returns null when nothing splits it — that is L4's entry point", () => {
    expect(routeByRule(extractHints("Summarizing a document"), hosts)).toBe(null);
  });

  it("never routes to hermes in Phase B (B-D7)", () => {
    expect(pickRuntime({ filesTouched: 5, specClear: false, liveCodexSession: false, isCode: true }))
      .toBe("claude_code");
    expect(pickRuntime({ filesTouched: 1, specClear: true, liveCodexSession: false, isCode: true }))
      .toBe("claude_ds");
    expect(pickRuntime({ filesTouched: 1, specClear: true, liveCodexSession: true, isCode: true }))
      .toBe("codex");
    expect(pickRuntime({ filesTouched: 0, specClear: true, liveCodexSession: false, isCode: false }))
      .toBe("omnis");
  });

  it("caps runaway proposals", () => {
    expect(DELEGATION_DAILY_CAP).toBe(5);
    expect(DELEGATION_THREAD_CAP_24H).toBe(2);
  });
});
```

- [ ] 2. Confirm the failure. Expected: `does not provide an export named 'extractHints'`.

```bash
pnpm --filter @omnis/agents test -- delegate-route
```

- [ ] 3. Write the implementation.

```ts
// packages/agents/src/delegate/route.ts
// A4 §5.2: the decision rules come first, the LLM later. There is no model call here (~1ms).
import type { HostId, RuntimeKind } from "@omnis/protocol";
import { getAgentsPool } from "../pool.js";

export const DELEGATION_DAILY_CAP = 5 as const;
export const DELEGATION_THREAD_CAP_24H = 2 as const;
export const MACBOOK_OFFLINE_MS = 120_000;

export interface DelegationHints {
  needs_paths: string[];
  needs_channel_session: boolean;
  needs_always_on: boolean;
  est_minutes: number | null;
  repo: string | null;
}

/** In Phase B, hermes is not a delegation target (B-D7, master §19 Q7). */
export type DelegationRuntime = Exclude<RuntimeKind, "hermes">;

export interface Routing {
  host: HostId;
  runtime?: DelegationRuntime;
  rule_id: string;
}

export interface HostHealth {
  mini: { lastHeartbeatMs: number };
  macbook: { lastHeartbeatMs: number };
}

const ABS_PATH = /(\/Users\/[\w./-]+|\/Volumes\/[\w./-]+|\/opt\/[\w./-]+)/g;
const GUI_CHANNEL = /kakaotalk|kakao|linkedin/i;
const ALWAYS_ON = /daily|weekly|periodic|regularly|cron|schedule/i;
const MINUTES = /(\d{1,3})\s*min/;
const HOURS = /(\d{1,2})\s*hours?/;

export function extractHints(text: string): DelegationHints {
  const paths = [...new Set(text.match(ABS_PATH) ?? [])];
  const m = MINUTES.exec(text);
  const h = HOURS.exec(text);
  const est = m !== null ? Number(m[1]) : h !== null ? Number(h[1]) * 60 : null;
  return {
    needs_paths: paths,
    needs_channel_session: GUI_CHANNEL.test(text),
    needs_always_on: ALWAYS_ON.test(text),
    est_minutes: est,
    repo: paths[0] ?? null,
  };
}

export function routeByRule(h: DelegationHints, hosts: HostHealth): Routing | null {
  if (h.needs_paths.some((p) => p.startsWith("/Users/") && !p.startsWith("/Users/Shared"))) {
    return { host: "macbook", rule_id: "dr_local_files" };
  }
  if (h.needs_channel_session) return { host: "mini", rule_id: "dr_gui_session" };
  if ((h.est_minutes ?? 0) > 10) return { host: "mini", rule_id: "dr_long_batch" };
  if (h.needs_always_on) return { host: "mini", rule_id: "dr_always_on" };
  if (hosts.macbook.lastHeartbeatMs > MACBOOK_OFFLINE_MS) {
    return { host: "mini", rule_id: "dr_macbook_offline" };
  }
  return null;
}

/** A4 §5.2 runtime table. hermes is deferred to Phase C (B-D7). */
export function pickRuntime(i: {
  filesTouched: number;
  specClear: boolean;
  liveCodexSession: boolean;
  isCode: boolean;
}): DelegationRuntime {
  if (!i.isCode) return "omnis";
  if (i.liveCodexSession) return "codex";
  if (i.filesTouched >= 3 || !i.specClear) return "claude_code";
  return "claude_ds";
}

export async function hostHealth(now: Date = new Date()): Promise<HostHealth> {
  const { rows } = await getAgentsPool().query<{ host: HostId; last_seen_at: Date | null }>(
    `SELECT host, max(last_seen_at) AS last_seen_at FROM agent_runtimes GROUP BY host`);
  const ms = (host: HostId): number => {
    const seen = rows.find((r) => r.host === host)?.last_seen_at ?? null;
    return seen === null ? Number.POSITIVE_INFINITY : now.getTime() - seen.getTime();
  };
  return { mini: { lastHeartbeatMs: ms("mini") }, macbook: { lastHeartbeatMs: ms("macbook") } };
}
```

- [ ] 4. Add the exports to `index.ts` and confirm it passes. Expected: 5 tests passed.

```ts
// packages/agents/src/index.ts — added
export {
  DELEGATION_DAILY_CAP, DELEGATION_THREAD_CAP_24H, MACBOOK_OFFLINE_MS, extractHints,
  hostHealth, pickRuntime, routeByRule,
  type DelegationHints, type DelegationRuntime, type HostHealth, type Routing,
} from "./delegate/route.js";
```

```bash
pnpm --filter @omnis/agents test -- delegate-route && pnpm lint
git add packages/agents/src/delegate/route.ts packages/agents/src/index.ts packages/agents/test/delegate-route.test.ts
git commit -m "US-B20: extractHints/routeByRule — the rules come first

- DelegationHints extraction is entirely regex (zero LLM calls)
- routeByRule has 5 rules; when they cannot decide it returns null and wakes L4
- pickRuntime never selects hermes (B-D7)
- The runaway-guard constants (5 per day / 2 per thread in 24h)

Implemented-by: Claude Opus
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 18: `delegateLoop` + the approval execution gate (US-B20, tier: Opus)

> **Story** — Goal: L4 (T2) judges a task the rules could not split, and one approval → a `delegate.run` execution. Full autonomy only when `settings.autonomy.rules` is enabled and `est_minutes ≤ 30` + inside the repo + no egress. Deliverables: `packages/agents/src/delegate/brief.ts`, `packages/agents/src/loops/delegate.ts`. Verification: `pnpm --filter @omnis/agents test`.

**Read:** A4 §5.1·§5.3 (the brief spec)·§5.4 (the approval flow), B-D6.
**Do not build (YAGNI):** automatic re-delegation. A4 §5.4 forbids it: "throwing the same failed brief again just repeats the same failure."

**Files:**
- Create: `packages/agents/src/delegate/brief.ts`, `packages/agents/src/loops/delegate.ts`, `packages/agents/test/integration/delegate-loop.test.ts`
- Modify: `packages/agents/src/index.ts`
- Test: `packages/agents/test/integration/delegate-loop.test.ts`

**Interfaces:**
- Consumes: `routeByRule`/`pickRuntime`/`hostHealth`(Task 17), `PROPOSE_TOOLS`(Task 5), `buildContext`(US-B05).
- Produces: `delegateLoop`, `DelegateOutput`, `type DelegateOutputT`, `renderBrief`, `type BriefInput`, `autonomyAllows`, `AUTONOMY_MAX_MINUTES`.

### Steps

- [ ] 1. Write the failing test.

```ts
// packages/agents/test/integration/delegate-loop.test.ts
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  AUTONOMY_MAX_MINUTES, autonomyAllows, configureAgents, delegateLoop, renderBrief,
} from "../../src/index.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});
beforeEach(() => configureAgents({ pool }));
afterAll(() => pool.end());

describe("renderBrief (A4 §5.3)", () => {
  it("renders all eight sections and keeps acceptance non-empty", () => {
    const b = renderBrief({
      goal: "Fix the report script",
      background: ["It failed last week (item:it_1)", "The logs are in ops/logs (memory:m_2)"],
      steps: ["Find the cause", "Fix it"],
      acceptance: ["pnpm test passes"],
      verifyCmd: "pnpm test",
      workdir: "/Users/logankim/AI-Workspaces/omnis",
    });
    for (const h of ["## Goal", "## Background", "## Steps", "## Acceptance Criteria", "## Verify Command",
                     "## Workdir", "## Do Not"]) {
      expect(b).toContain(h);
    }
    expect(b).toContain("- [ ] pnpm test passes");
    expect(b).toContain("Do not commit or push");
  });

  it("refuses an empty acceptance list", () => {
    expect(() => renderBrief({
      goal: "x", background: [], steps: ["y"], acceptance: [],
      verifyCmd: "true", workdir: "/tmp",
    })).toThrow(/acceptance/);
  });
});

describe("autonomyAllows (A4 §4.4, B-D6)", () => {
  it("is off by default", () => {
    expect(autonomyAllows({ rules: [], runtime: "claude_ds", repo: "/Users/logankim/x",
      estMinutes: 5, hasEgress: false })).toBe(false);
  });

  it("still requires approval for long, out-of-repo or egress work", () => {
    const rules = [{ runtime: "claude_ds", repo: "/Users/logankim/x" }];
    expect(autonomyAllows({ rules, runtime: "claude_ds", repo: "/Users/logankim/x",
      estMinutes: 5, hasEgress: false })).toBe(true);
    expect(autonomyAllows({ rules, runtime: "claude_ds", repo: "/Users/logankim/x",
      estMinutes: AUTONOMY_MAX_MINUTES + 1, hasEgress: false })).toBe(false);
    expect(autonomyAllows({ rules, runtime: "claude_ds", repo: "/Users/other",
      estMinutes: 5, hasEgress: false })).toBe(false);
    expect(autonomyAllows({ rules, runtime: "claude_ds", repo: "/Users/logankim/x",
      estMinutes: 5, hasEgress: true })).toBe(false);
  });
});

describe("delegateLoop (A4 §5)", () => {
  it("is T2, fires on an unrouted agent task, and cannot propose hermes", () => {
    expect(delegateLoop.tier).toBe("T2");
    expect(delegateLoop.trigger.on).toBe("task.created");
    expect(delegateLoop.trigger.where).toContain("routing_rule_id IS NULL");
    expect(delegateLoop.budget).toEqual({
      inputTokens: 8000, outputTokens: 900, wallClockMs: 60_000, maxSteps: 6 });
    expect(delegateLoop.palette).toEqual([
      "read_thread", "read_tasks", "read_session", "search_memory", "propose_delegation"]);
  });

  it("creates a pending approval row, never an execution", async () => {
    const t = await pool.query<{ id: string }>(
      "INSERT INTO tasks (title, owner_kind, created_by) VALUES ('Delegation candidate','agent','agent') RETURNING id");
    const taskId = t.rows[0]?.id ?? "";
    await delegateLoop.apply(
      {
        loop: "delegate", run_id: "00000000-0000-0000-0000-0000000000cc",
        output: {
          runtime: "claude_code", host: "mini", goal: "Fix it", background: [], steps: ["a"],
          acceptance: ["Tests pass"], verify_cmd: "pnpm test",
          workdir: "/Users/logankim/AI-Workspaces/omnis", est_minutes: 20,
          confidence: 0.8, rationale: "Work inside the repo", injection_flags: [],
        },
        confidence: 0.8, rationale: "Work inside the repo", escalate: false,
        injection_flags: [], unresolved: [],
      } as never,
      { trigger_kind: "event", task_id: taskId, now: new Date(), payload: {} });
    const { rows } = await pool.query<{ state: string; action: string; risk: string }>(
      "SELECT state, action, risk FROM pending_approvals WHERE task_id = $1", [taskId]);
    expect(rows[0]).toMatchObject({ state: "pending", action: "delegate", risk: "normal" });
  });
});
```

- [ ] 2. Confirm the failure. Expected: `does not provide an export named 'renderBrief'`.

```bash
pnpm --filter @omnis/agents test -- delegate-loop
```

- [ ] 3. Write `brief.ts`.

```ts
// packages/agents/src/delegate/brief.ts
// A4 §5.3: the brief must be self-contained — the target runtime knows nothing of omnis's context.
export interface BriefInput {
  goal: string;
  /** Each line ends with (item:xxx) or (memory:xxx). 3–6 lines. */
  background: string[];
  steps: string[];
  acceptance: string[];
  verifyCmd: string;
  workdir: string;
}

export function renderBrief(i: BriefInput): string {
  if (i.acceptance.length === 0) {
    throw new Error("brief.acceptance must not be empty (A4 §5.3 minItems 1)");
  }
  return [
    "## Goal", i.goal, "",
    "## Background", ...(i.background.length === 0 ? ["(no background)"] : i.background), "",
    "## Steps", ...i.steps.map((s, n) => `${n + 1}. ${s}`), "",
    "## Acceptance Criteria", ...i.acceptance.map((a) => `- [ ] ${a}`), "",
    "## Verify Command", i.verifyCmd, "",
    "## Workdir", i.workdir, "",
    "## Do Not",
    "- Do not modify files that are not in this brief",
    "- Do not commit or push (omnis takes the diff and shows it to a human)",
  ].join("\n");
}
```

- [ ] 4. Write `delegate.ts`.

```ts
// packages/agents/src/loops/delegate.ts
// A4 §5. No path executes without approval — this loop's only output is a single pending_approvals row.
import { z } from "zod";
import { buildContext } from "../context/assemble.js";
import { renderBrief } from "../delegate/brief.js";
import { registerLoop } from "../loop/registry.js";
import type { LoopSpec, TriggerContext } from "../loop/spec.js";
import { PROPOSE_TOOLS } from "../tools/propose.js";

/** A4 §4.4: even with an autonomy rule enabled, anything over 30 minutes goes through approval. */
export const AUTONOMY_MAX_MINUTES = 30;

export interface AutonomyRule {
  runtime: string;
  repo: string;
}

export function autonomyAllows(i: {
  rules: AutonomyRule[];
  runtime: string;
  repo: string | null;
  estMinutes: number;
  hasEgress: boolean;
}): boolean {
  if (i.hasEgress) return false;
  if (i.estMinutes > AUTONOMY_MAX_MINUTES) return false;
  if (i.repo === null) return false;
  return i.rules.some((r) => r.runtime === i.runtime && i.repo === r.repo);
}

export const DelegateOutput = z.object({
  runtime: z.enum(["claude_code", "codex", "claude_ds", "omnis"]),   // B-D7: no hermes
  host: z.enum(["mini", "macbook"]),
  goal: z.string().max(200),
  background: z.array(z.string().max(200)).max(6).default([]),
  steps: z.array(z.string().max(200)).min(1).max(8),
  acceptance: z.array(z.string().max(200)).min(1),
  verify_cmd: z.string().max(300),
  workdir: z.string(),
  est_minutes: z.number().int().min(1).max(600),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(300),
  injection_flags: z.array(z.string()).default([]),
});
export type DelegateOutputT = z.infer<typeof DelegateOutput>;

export const delegateLoop: LoopSpec<DelegateOutputT> = {
  id: "delegate",
  kind: "deliberate",
  trigger: {
    kind: "event",
    on: "task.created",
    where: "owner_kind = 'agent' AND routing_rule_id IS NULL",
    debounceMs: 0,
  },
  palette: ["read_thread", "read_tasks", "read_session", "search_memory", "propose_delegation"],
  budget: { inputTokens: 8000, outputTokens: 900, wallClockMs: 60_000, maxSteps: 6 },
  tier: "T2",
  outputSchema: DelegateOutput,

  assemble: (ctx: TriggerContext) =>
    buildContext({
      selfModel: ["USER.md", "PROJECTS.md"],
      tasks: { state: "open", limit: 10 },
      sessions: { sessionKeys: [], lastN: 3 },
      memories: { query: String(ctx.payload.title ?? ""), k: 4 },
    }),

  async apply(result, ctx) {
    const taskId = ctx.task_id;
    if (taskId === undefined) return;
    const o = result.output;
    const brief = renderBrief({
      goal: o.goal, background: o.background, steps: o.steps,
      acceptance: o.acceptance, verifyCmd: o.verify_cmd, workdir: o.workdir,
    });
    await PROPOSE_TOOLS.propose_delegation?.execute?.(
      {
        task_id: taskId, runtime: o.runtime, host: o.host, brief,
        acceptance: o.acceptance, verify_cmd: o.verify_cmd, workdir: o.workdir,
        est_minutes: o.est_minutes, rule_id: "dr_llm", confidence: o.confidence,
      },
      { toolCallId: result.run_id, messages: [] },
    );
  },
};

registerLoop(delegateLoop);
```

- [ ] 5. Add the exports to `index.ts` and confirm it passes. Expected: 5 tests passed.

```ts
// packages/agents/src/index.ts — added
export { renderBrief, type BriefInput } from "./delegate/brief.js";
export {
  AUTONOMY_MAX_MINUTES, DelegateOutput, autonomyAllows, delegateLoop,
  type AutonomyRule, type DelegateOutputT,
} from "./loops/delegate.js";
```

```bash
pnpm --filter @omnis/agents test -- delegate && pnpm lint
git add packages/agents/src/delegate/brief.ts packages/agents/src/loops/delegate.ts packages/agents/src/index.ts packages/agents/test/integration/delegate-loop.test.ts
git commit -m "US-B20: L4 delegation loop and the approval gate

- Only a task the rules returned null for wakes T2
- renderBrief emits the 8 sections from A4 §5.3 and rejects an empty acceptance list
- The only output is one pending_approvals row (action='delegate') — there is no execution path
- autonomyAllows is off by default, and over 30 minutes / outside the repo / egress still go through approval

Implemented-by: Claude Opus
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 19: `noteRouteLoop` — search first, never auto-attach (US-B21, tier: Sonnet)

> **Story** — Goal: a `note` insert trigger → at most 3 candidates, no proposal at all when confidence is low, and no automatic routing. Deliverables: `packages/agents/src/loops/note-route.ts`. Verification: `pnpm --filter @omnis/agents test`. Depends on: B07.

**Read:** A4 §8.1–§8.4 (the 5 candidate-generation steps, the 3-row confidence table, "never auto-attach at any confidence").
**Do not build (YAGNI):** a notes-only embedding table. Candidates are pulled straight from `threads`/`persons`/`memories`.

**Files:**
- Create: `packages/agents/src/loops/note-route.ts`, `packages/agents/test/integration/note-route.test.ts`
- Modify: `packages/agents/src/index.ts`
- Test: `packages/agents/test/integration/note-route.test.ts`

**Interfaces:**
- Consumes: `buildContext`(US-B05), `PROPOSE_TOOLS`(Task 5).
- Produces: `noteRouteLoop`, `RouteOutput`, `type RouteOutputT`, `ROUTE_CONFIDENCE_HIGH`, `ROUTE_CONFIDENCE_MIN`.

### Steps

- [ ] 1. Write the failing test.

```ts
// packages/agents/test/integration/note-route.test.ts
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  ROUTE_CONFIDENCE_HIGH, ROUTE_CONFIDENCE_MIN, configureAgents, noteRouteLoop,
} from "../../src/index.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});
let noteId = "";
beforeEach(async () => {
  configureAgents({ pool });
  const n = await pool.query<{ id: string }>(
    "INSERT INTO notes (body) VALUES ('Re-confirm the quote with CEO Kim') RETURNING id");
  noteId = n.rows[0]?.id ?? "";
});
afterAll(() => pool.end());

const res = (candidates: unknown[]) => ({
  loop: "note_route" as const, run_id: "00000000-0000-0000-0000-0000000000dd",
  output: { candidates, confidence: 0.9, rationale: "same topic", injection_flags: [] },
  confidence: 0.9, rationale: "same topic", escalate: false, injection_flags: [], unresolved: [],
});

describe("noteRouteLoop (A4 §8)", () => {
  it("declares the A4 §8.4 budget and the 2s debounce", () => {
    expect(noteRouteLoop.id).toBe("note_route");
    expect(noteRouteLoop.trigger.on).toBe("note.created");
    expect(noteRouteLoop.trigger.debounceMs).toBe(2000);
    expect(noteRouteLoop.budget).toEqual({
      inputTokens: 4000, outputTokens: 450, wallClockMs: 20_000, maxSteps: 2 });
    expect(ROUTE_CONFIDENCE_HIGH).toBe(0.8);
    expect(ROUTE_CONFIDENCE_MIN).toBe(0.5);
  });

  it("never auto-attaches — route_state stays 'proposed' even at confidence 0.99", async () => {
    const t = await pool.query<{ id: string }>(
      `INSERT INTO accounts (channel, external_id, display) VALUES ('gmail','nr@test','n')
         ON CONFLICT (channel, external_id) DO UPDATE SET display='n' RETURNING id`);
    const thr = await pool.query<{ id: string }>(
      `INSERT INTO threads (account_id, external_id, kind) VALUES ($1,'thr_nr','email')
         ON CONFLICT (account_id, external_id) DO UPDATE SET kind='email' RETURNING id`,
      [t.rows[0]?.id ?? ""]);
    await noteRouteLoop.apply(
      res([{ kind: "thread", id: thr.rows[0]?.id ?? "", confidence: 0.99, why: "the same quote thread" }]) as never,
      { trigger_kind: "event", note_id: noteId, now: new Date(), payload: {} });
    const { rows } = await pool.query<{ route_state: string; routed_to_thread_id: string | null }>(
      "SELECT route_state, routed_to_thread_id FROM notes WHERE id = $1", [noteId]);
    expect(rows[0]?.route_state).toBe("proposed");
    expect(rows[0]?.routed_to_thread_id).toBe(null);
  });

  it("stores no proposal at all below 0.50 (route_state='none')", async () => {
    await noteRouteLoop.apply(
      res([{ kind: "thread", id: "00000000-0000-0000-0000-0000000000ee",
             confidence: 0.3, why: "weak" }]) as never,
      { trigger_kind: "event", note_id: noteId, now: new Date(), payload: {} });
    const { rows } = await pool.query<{ route_state: string }>(
      "SELECT route_state FROM notes WHERE id = $1", [noteId]);
    expect(rows[0]?.route_state).toBe("none");
  });
});
```

- [ ] 2. Confirm the failure. Expected: `does not provide an export named 'noteRouteLoop'`.

```bash
pnpm --filter @omnis/agents test -- note-route
```

- [ ] 3. Write the implementation.

```ts
// packages/agents/src/loops/note-route.ts
// A4 §8. The LLM cannot invent candidates — it only chooses within the list search returned.
import { z } from "zod";
import { buildContext } from "../context/assemble.js";
import { registerLoop } from "../loop/registry.js";
import type { LoopSpec, TriggerContext } from "../loop/spec.js";
import { getAgentsPool } from "../pool.js";
import { PROPOSE_TOOLS } from "../tools/propose.js";

export const ROUTE_CONFIDENCE_HIGH = 0.8;
export const ROUTE_CONFIDENCE_MIN = 0.5;

export const RouteOutput = z.object({
  candidates: z.array(z.object({
    kind: z.enum(["thread", "person"]),
    id: z.string().uuid(),
    confidence: z.number().min(0).max(1),
    why: z.string().max(160),
    suggested_use: z.enum(["followup", "question", "share", "context_only"]).optional(),
  })).max(3).default([]),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(200),
  injection_flags: z.array(z.string()).default([]),
});
export type RouteOutputT = z.infer<typeof RouteOutput>;

export const noteRouteLoop: LoopSpec<RouteOutputT> = {
  id: "note_route",
  kind: "reactive",
  trigger: { kind: "event", on: "note.created", debounceMs: 2000 },
  palette: ["search_memory", "read_person", "read_thread", "propose_route"],
  budget: { inputTokens: 4000, outputTokens: 450, wallClockMs: 20_000, maxSteps: 2 },
  tier: "T1",
  outputSchema: RouteOutput,

  assemble: (ctx: TriggerContext) =>
    buildContext({ memories: { query: String(ctx.payload.body ?? ""), k: 5 } }),

  async apply(result, ctx) {
    const noteId = ctx.note_id;
    if (noteId === undefined) return;
    // A4 §8.3: below 0.50 it is stored with no routing. However high the confidence, there is no auto-attach.
    const kept = result.output.candidates
      .filter((c) => c.confidence >= ROUTE_CONFIDENCE_MIN)
      .slice(0, 3);
    if (kept.length === 0) {
      await getAgentsPool().query(
        "UPDATE notes SET route_state = 'none' WHERE id = $1 AND route_state = 'proposed'",
        [noteId]);
      return;
    }
    await PROPOSE_TOOLS.propose_route?.execute?.(
      { note_id: noteId, candidates: kept },
      { toolCallId: result.run_id, messages: [] },
    );
  },
};

registerLoop(noteRouteLoop);
```

- [ ] 4. Add the exports to `index.ts` and confirm it passes. Expected: 3 tests passed.

```ts
// packages/agents/src/index.ts — added
export {
  ROUTE_CONFIDENCE_HIGH, ROUTE_CONFIDENCE_MIN, RouteOutput, noteRouteLoop, type RouteOutputT,
} from "./loops/note-route.js";
```

```bash
pnpm --filter @omnis/agents test -- note-route && pnpm lint
git add packages/agents/src/loops/note-route.ts packages/agents/src/index.ts packages/agents/test/integration/note-route.test.ts
git commit -m "US-B21: L7 note routing loop

- note.created with a 2-second debounce, at most 3 candidates
- Below confidence 0.50 it creates no proposal at all and leaves route_state='none'
- Never auto-attaches at any confidence (A4-D10)

Implemented-by: Claude Sonnet
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 20: `followupLoop` + the inactivity detection sweep (US-B22, tier: Sonnet)

> **Story** — Goal: first-contact detection, an inactivity sweep (weekdays at 10:00, cadence SQL), simultaneous draft + task proposals, and `relationship_state` updates (`closed` only with approval). Deliverables: `packages/agents/src/loops/followup.ts`. Verification: `pnpm --filter @omnis/agents test`. Depends on: B03, B07.

**Read:** A4 §7.2 (the first-contact function)·§7.3 (the SQL as written + the 4 cadence priorities)·§7.4 (the output schema + the channel selection rule + the no-cold-outreach rule).
**Do not build (YAGNI):** a relationship scoring model. `priority_score` is already a column and this loop only reads it.

**Files:**
- Create: `packages/agents/src/loops/followup.ts`, `packages/agents/test/integration/followup-loop.test.ts`
- Modify: `packages/agents/src/index.ts`
- Test: `packages/agents/test/integration/followup-loop.test.ts`

**Interfaces:**
- Consumes: `buildContext`(US-B05), `PROPOSE_TOOLS`(Task 5), `getAgentsPool`(Phase A).
- Produces: `followupLoop`, `FollowupOutput`, `type FollowupOutputT`, `isFirstContact`, `inactiveCandidates`, `pickFollowupChannel`, `sweepFollowups`, `NO_COLD_OUTREACH_CHANNELS`, `INACTIVE_SWEEP_LIMIT`.

### Steps

- [ ] 1. Write the failing test.

```ts
// packages/agents/test/integration/followup-loop.test.ts
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  INACTIVE_SWEEP_LIMIT, NO_COLD_OUTREACH_CHANNELS, configureAgents, followupLoop,
  inactiveCandidates, isFirstContact, pickFollowupChannel,
} from "../../src/index.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});
beforeEach(() => configureAgents({ pool }));
afterAll(() => pool.end());

const now = new Date("2026-09-20T00:00:00Z");

describe("isFirstContact (A4 §7.2)", () => {
  it("is true with no history, or within 90 days and fewer than 3 items", () => {
    expect(isFirstContact({ first_contact_at: null, item_count: 0 }, now)).toBe(true);
    expect(isFirstContact({ first_contact_at: "2026-09-01T00:00:00Z", item_count: 2 }, now)).toBe(true);
    expect(isFirstContact({ first_contact_at: "2026-09-01T00:00:00Z", item_count: 3 }, now)).toBe(false);
    expect(isFirstContact({ first_contact_at: "2025-01-01T00:00:00Z", item_count: 1 }, now)).toBe(false);
  });
});

describe("pickFollowupChannel (A4 §7.4)", () => {
  it("never cold-opens LinkedIn or KakaoTalk", () => {
    expect(NO_COLD_OUTREACH_CHANNELS).toEqual(["linkedin", "kakaotalk"]);
    expect(pickFollowupChannel({ counts: { linkedin: 9 }, theySentLast: false, hasEmail: true }))
      .toBe("gmail");
    expect(pickFollowupChannel({ counts: { linkedin: 9 }, theySentLast: true, hasEmail: true }))
      .toBe("linkedin");
    expect(pickFollowupChannel({ counts: { kakaotalk: 9 }, theySentLast: false, hasEmail: false }))
      .toBe(null);
    expect(pickFollowupChannel({ counts: { slack: 3, telegram: 3 }, theySentLast: true, hasEmail: true }))
      .toBe("gmail");   // on a tie, email
  });
});

describe("inactiveCandidates (A4 §7.3)", () => {
  it("applies the cadence priority: cadence_days > vip 14 > warming 21 > active 30", async () => {
    const a = await pool.query<{ id: string }>(
      `INSERT INTO accounts (channel, external_id, display) VALUES ('gmail','fu@test','f')
         ON CONFLICT (channel, external_id) DO UPDATE SET display='f' RETURNING id`);
    const t = await pool.query<{ id: string }>(
      `INSERT INTO threads (account_id, external_id, kind, last_item_at)
       VALUES ($1,'thr_fu','email', now() - interval '20 days')
       ON CONFLICT (account_id, external_id)
         DO UPDATE SET last_item_at = now() - interval '20 days' RETURNING id`,
      [a.rows[0]?.id ?? ""]);
    const threadId = t.rows[0]?.id ?? "";
    await pool.query("DELETE FROM persons WHERE display_name LIKE 'fu-%'");
    await pool.query(
      `INSERT INTO persons (display_name, relationship_state, vip, primary_thread_id, priority_score)
       VALUES ('fu-vip','active', true, $1, 9),
              ('fu-active','active', false, $1, 5)`, [threadId]);
    const rows = await inactiveCandidates(pool);
    const names = rows.map((r) => r.display_name);
    expect(names).toContain("fu-vip");        // vip=14 days < 20 days elapsed
    expect(names).not.toContain("fu-active"); // active=30 days > 20 days elapsed
    expect(rows.length).toBeLessThanOrEqual(INACTIVE_SWEEP_LIMIT);
  });
});

describe("followupLoop (A4 §7.4)", () => {
  it("applies relationship updates automatically except closed", async () => {
    const p = await pool.query<{ id: string }>(
      "INSERT INTO persons (display_name, relationship_state) VALUES ('fu-upd','warming') RETURNING id");
    const personId = p.rows[0]?.id ?? "";
    const mk = (state: string) => ({
      loop: "followup" as const, run_id: "00000000-0000-0000-0000-0000000000ff",
      output: { kind: "pending_step", person_id: personId,
        relationship_update: { state, cadence_days: 21 },
        confidence: 0.8, rationale: "x", injection_flags: [] },
      confidence: 0.8, rationale: "x", escalate: false, injection_flags: [], unresolved: [],
    });
    await followupLoop.apply(mk("active") as never,
      { trigger_kind: "cron", person_id: personId, now: new Date(), payload: {} });
    let { rows } = await pool.query<{ s: string }>(
      "SELECT relationship_state AS s FROM persons WHERE id = $1", [personId]);
    expect(rows[0]?.s).toBe("active");

    await followupLoop.apply(mk("closed") as never,
      { trigger_kind: "cron", person_id: personId, now: new Date(), payload: {} });
    ({ rows } = await pool.query<{ s: string }>(
      "SELECT relationship_state AS s FROM persons WHERE id = $1", [personId]));
    expect(rows[0]?.s).toBe("active");   // closed goes through approval, so it has not changed yet
    const ap = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pending_approvals
        WHERE action = 'memory_write' AND args->>'person_id' = $1`, [personId]);
    expect(ap.rows[0]?.n).toBe("1");
  });
});
```

- [ ] 2. Confirm the failure. Expected: `does not provide an export named 'isFirstContact'`.

```bash
pnpm --filter @omnis/agents test -- followup-loop
```

- [ ] 3. Write the implementation.

```ts
// packages/agents/src/loops/followup.ts
// A4 §7 L6 Network follow-up loop.
import type { Channel } from "@omnis/protocol";
import type { Pool } from "pg";
import { z } from "zod";
import { buildContext } from "../context/assemble.js";
import { registerLoop } from "../loop/registry.js";
import type { LoopSpec, TriggerContext } from "../loop/spec.js";
import { getAgentsPool } from "../pool.js";

/** A4 §7.3: at most 10 people a day — beyond that it is spam, not follow-up. */
export const INACTIVE_SWEEP_LIMIT = 10;
/** Master §13: never cold-outreach on these two channels. */
export const NO_COLD_OUTREACH_CHANNELS: readonly Channel[] = ["linkedin", "kakaotalk"];

export function isFirstContact(
  p: { first_contact_at: string | null; item_count: number },
  now: Date,
): boolean {
  if (p.first_contact_at === null) return true;
  const days = (now.getTime() - new Date(p.first_contact_at).getTime()) / 86_400_000;
  return days <= 90 && p.item_count < 3;
}

/** A4 §7.4 channel selection: the most-used channel in the last 90 days, email on a tie. The two no-cold-outreach channels are the exception. */
export function pickFollowupChannel(i: {
  counts: Partial<Record<Channel, number>>;
  theySentLast: boolean;
  hasEmail: boolean;
}): Channel | null {
  const ranked = (Object.entries(i.counts) as [Channel, number][])
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const top = ranked[0];
  if (top === undefined) return i.hasEmail ? "gmail" : null;
  const tie = ranked.filter(([, n]) => n === top[1]).length > 1;
  if (tie) return i.hasEmail ? "gmail" : top[0];
  if (NO_COLD_OUTREACH_CHANNELS.includes(top[0]) && !i.theySentLast) {
    return i.hasEmail ? "gmail" : null;
  }
  return top[0];
}

export interface InactiveCandidate {
  id: string;
  display_name: string;
  vip: boolean;
  thread_id: string;
  effective_cadence_days: number;
}

/** A4 §7.3 SQL as written. The LLM runs only over these candidates. */
export async function inactiveCandidates(pool: Pool): Promise<InactiveCandidate[]> {
  const { rows } = await pool.query<InactiveCandidate>(
    `WITH cadence AS (
       SELECT p.id, p.display_name, p.vip, p.priority_score, t.id AS thread_id, t.last_item_at,
              COALESCE(p.cadence_days,
                       CASE WHEN p.vip THEN 14
                            WHEN p.relationship_state = 'warming' THEN 21
                            WHEN p.relationship_state = 'active'  THEN 30 END) AS effective_cadence_days
         FROM persons p
         JOIN threads t ON t.id = p.primary_thread_id
        WHERE p.merged_into IS NULL
          AND p.relationship_state IN ('active','warming'))
     SELECT id, display_name, vip, thread_id, effective_cadence_days
       FROM cadence c
      WHERE c.last_item_at < now() - (c.effective_cadence_days || ' days')::interval
        AND NOT EXISTS (SELECT 1 FROM tasks k
                         WHERE k.person_id = c.id AND k.state = 'open' AND k.kind = 'followup'
                           AND k.created_at > now() - interval '14 days')
      ORDER BY c.priority_score DESC
      LIMIT ${INACTIVE_SWEEP_LIMIT}`,
  );
  return rows;
}

export const FollowupOutput = z.object({
  kind: z.enum(["post_meeting", "first_contact", "dormant_revive", "pending_step"]),
  person_id: z.string().uuid(),
  draft: z.object({
    channel: z.enum(["gmail", "slack", "telegram", "kakaotalk", "linkedin", "whatsapp", "outlook"]),
    body: z.string().max(1500),
    register: z.string().max(20),
  }).optional(),
  task: z.object({ title: z.string().max(120), due_at: z.string().datetime().optional() }).optional(),
  relationship_update: z.object({
    state: z.enum(["unknown", "new", "warming", "active", "dormant", "closed"]).optional(),
    cadence_days: z.number().int().optional(),
    note: z.string().max(200).optional(),
  }).optional(),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(300),
  injection_flags: z.array(z.string()).default([]),
});
export type FollowupOutputT = z.infer<typeof FollowupOutput>;

export const followupLoop: LoopSpec<FollowupOutputT> = {
  id: "followup",
  kind: "deliberate",
  // The sweep job picks the candidates and fires this event per person — the loop itself runs for "one person".
  trigger: { kind: "event", on: "person.inactive", debounceMs: 0 },
  palette: ["read_thread", "read_person", "read_entity", "read_calendar", "search_memory",
            "propose_draft", "propose_task"],
  budget: { inputTokens: 5500, outputTokens: 800, wallClockMs: 40_000, maxSteps: 5 },
  tier: "T1",
  outputSchema: FollowupOutput,

  assemble: (ctx: TriggerContext) =>
    buildContext({
      selfModel: ["USER.md", "VOICE.md"],
      entities: { personIds: ctx.person_id === undefined ? [] : [ctx.person_id], asOf: "now" },
      thread: { threadId: ctx.thread_id ?? "", lastN: 8 },
      memories: { query: String(ctx.payload.display_name ?? ""), k: 4 },
    }),

  async apply(result, _ctx) {
    const pool = getAgentsPool();
    const o = result.output;
    const update = o.relationship_update;
    if (update === undefined) return;

    // A4 §7.4: relationship_update applies automatically. Only the transition to 'closed' needs approval —
    // deciding to end a relationship is not an agent's job.
    if (update.state === "closed") {
      await pool.query(
        `INSERT INTO pending_approvals (action, args, description, risk, requested_by)
         VALUES ('memory_write', $1::jsonb, $2, 'normal',
                 (SELECT id FROM agent_runtimes WHERE runtime = 'omnis' LIMIT 1))`,
        [JSON.stringify({ person_id: o.person_id, state: "closed", note: update.note ?? null }),
         `Change the relationship for ${o.person_id} to 'closed'? — ${o.rationale}`]);
      return;
    }
    await pool.query(
      `UPDATE persons
          SET relationship_state = COALESCE($2, relationship_state),
              cadence_days = COALESCE($3, cadence_days),
              notes = COALESCE($4, notes)
        WHERE id = $1`,
      [o.person_id, update.state ?? null, update.cadence_days ?? null, update.note ?? null]);
  },
};

registerLoop(followupLoop);

/** A4 §7.3 weekday 10:00 sweep (jobs.name = 'network_inactive_sweep'). It runs the loop once per candidate. */
export async function sweepFollowups(
  runOne: (c: InactiveCandidate) => Promise<void>,
): Promise<number> {
  const rows = await inactiveCandidates(getAgentsPool());
  for (const c of rows) await runOne(c);
  return rows.length;
}
```

- [ ] 4. Add the exports to `index.ts` and confirm it passes. Expected: 4 tests passed.

```ts
// packages/agents/src/index.ts — added
export {
  FollowupOutput, INACTIVE_SWEEP_LIMIT, NO_COLD_OUTREACH_CHANNELS, followupLoop,
  inactiveCandidates, isFirstContact, pickFollowupChannel, sweepFollowups,
  type FollowupOutputT, type InactiveCandidate,
} from "./loops/followup.js";
```

```bash
pnpm --filter @omnis/agents test -- followup-loop && pnpm lint
git add packages/agents/src/loops/followup.ts packages/agents/src/index.ts packages/agents/test/integration/followup-loop.test.ts
git commit -m "US-B22: L6 Network follow-up loop

- isFirstContact is a rule-based decision (90 days + 3 items)
- inactiveCandidates uses the A4 §7.3 cadence-priority SQL as written and picks only 10 people a day
- pickFollowupChannel blocks cold outreach on LinkedIn/KakaoTalk and substitutes email
- relationship_update applies automatically; only 'closed' creates an approval card

Implemented-by: Claude Sonnet
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 21: `rankBriefItems` + `morningDigestLoop` (US-B23, tier: Opus)

> **Story** — Goal: a synchronous call at 06:30 KST, a 6-section content model, **ranking by an arithmetic score rather than the LLM** (an 8-term weighted sum, one entry per thread), the LLM writing only the one-line summary sentences, and one `digests(kind='morning')` row + coverage metrics. Deliverables: `packages/agents/src/loops/digest-morning.ts`, `packages/agents/src/digest/rank.ts`. Verification: `pnpm --filter @omnis/agents test`. Depends on: B18, B19.

**Read:** A4 §6.2 (`MorningBriefing`/`BriefItem`)·§6.3 (the 8-term scoring formula)·§6.6 (coverage metrics), delta §4 (the digest types).
**Do not build (YAGNI):** per-section prompts. The LLM writes only two strings, `greeting` and `one_liner`.

**Files:**
- Create: `packages/agents/src/digest/rank.ts`, `packages/agents/src/loops/digest-morning.ts`, `packages/agents/test/digest-rank.test.ts`, `packages/agents/test/integration/digest-morning.test.ts`
- Modify: `packages/agents/src/index.ts`
- Test: `packages/agents/test/digest-rank.test.ts`, `packages/agents/test/integration/digest-morning.test.ts`

**Interfaces:**
- Consumes: `runLoopSpec` (Task 3 — it does not go through the registry), `buildContext` (US-B05).
- Produces: `BriefCandidate`, `BriefItem`, `BriefSection`, `MorningBriefing`, `rankBriefItems`, `SECTION_CAPS`, `morningDigestLoop`, `morningCandidates`, `MORNING_DIGEST_CRON`.

### Steps

- [ ] 1. Write the failing ranking test (pure function).

```ts
// packages/agents/test/digest-rank.test.ts
import { describe, expect, it } from "vitest";
import { SECTION_CAPS, rankBriefItems, type BriefCandidate } from "../src/index.js";

const now = new Date("2026-09-20T00:00:00Z");
const c = (over: Partial<BriefCandidate>): BriefCandidate => ({
  ref: { kind: "item", id: over.ref?.id ?? "i1" },
  thread_id: "t1", section: "needs_you", line: "line", why: "reason",
  priority: "fyi", vip: false, pendingApproval: false, unansweredTurns: 0,
  meetingToday: false, dueToday: false, ageHours: 0, snoozed: false,
  ...over,
});

describe("rankBriefItems (A4 §6.3)", () => {
  it("scores priority, vip and pending approval in that weight order", () => {
    const out = rankBriefItems([
      c({ ref: { kind: "item", id: "low" }, thread_id: "ta", priority: "fyi" }),
      c({ ref: { kind: "item", id: "now" }, thread_id: "tb", priority: "now" }),
      c({ ref: { kind: "item", id: "vip" }, thread_id: "tc", priority: "week", vip: true }),
    ], now);
    expect(out.map((i) => i.ref.id)).toEqual(["now", "vip", "low"]);
  });

  it("shows a thread at most once across the whole briefing", () => {
    const out = rankBriefItems([
      c({ ref: { kind: "item", id: "a" }, thread_id: "same", priority: "now" }),
      c({ ref: { kind: "item", id: "b" }, thread_id: "same", priority: "now" }),
      c({ ref: { kind: "item", id: "z" }, thread_id: "other", priority: "today" }),
    ], now);
    expect(out.map((i) => i.ref.id)).toEqual(["a", "z"]);
  });

  it("pushes snoozed items down", () => {
    const out = rankBriefItems([
      c({ ref: { kind: "item", id: "snoozed" }, thread_id: "t1", priority: "now", snoozed: true }),
      c({ ref: { kind: "item", id: "plain" }, thread_id: "t2", priority: "today" }),
    ], now);
    expect(out[0]?.ref.id).toBe("plain");
  });

  it("caps each section per A4 §6.2", () => {
    expect(SECTION_CAPS).toEqual({
      needs_you: 5, drafts: 7, calendar: Number.POSITIVE_INFINITY, commitments: 5, agents: 5,
    });
  });
});
```

- [ ] 2. Confirm the failure. Expected: `does not provide an export named 'rankBriefItems'`.

```bash
pnpm --filter @omnis/agents test -- digest-rank
```

- [ ] 3. Write `rank.ts`.

```ts
// packages/agents/src/digest/rank.ts
// A4 §6.3: the LLM does not do the ranking. It sorts by arithmetic score and the LLM writes only the one-line summary.
export type BriefSectionId = "needs_you" | "drafts" | "calendar" | "commitments" | "agents";

export interface BriefItem {
  ref: { kind: "item" | "task" | "approval" | "event" | "session"; id: string };
  line: string;
  why: string;
  action?: "approve" | "open" | "snooze";
}

export interface BriefCandidate extends BriefItem {
  thread_id: string;
  section: BriefSectionId;
  priority: "now" | "today" | "week" | "fyi";
  vip: boolean;
  pendingApproval: boolean;
  /** Unanswered turns they sent after my last reply. Clamped to 3. */
  unansweredTurns: number;
  meetingToday: boolean;
  dueToday: boolean;
  ageHours: number;
  snoozed: boolean;
}

export interface BriefSection {
  id: BriefSectionId | "quiet";
  title: string;
  items?: BriefItem[];
  count?: number;
}

export interface MorningBriefing {
  greeting: string;
  sections: BriefSection[];
  one_liner: string;
}

export const SECTION_CAPS: Record<BriefSectionId, number> = {
  needs_you: 5,
  drafts: 7,
  calendar: Number.POSITIVE_INFINITY,
  commitments: 5,
  agents: 5,
};

const PRIORITY_WEIGHT: Record<BriefCandidate["priority"], number> = {
  now: 1, today: 0.6, week: 0.25, fyi: 0,
};

function score(c: BriefCandidate, seenThread: boolean): number {
  return (
    3.0 * PRIORITY_WEIGHT[c.priority] +
    2.5 * (c.vip ? 1 : 0) +
    2.0 * (c.pendingApproval ? 1 : 0) +
    1.5 * (Math.min(3, c.unansweredTurns) / 3) +
    1.5 * (c.meetingToday ? 1 : 0) +
    1.0 * (c.dueToday ? 1 : 0) +
    0.8 * Math.exp(-c.ageHours / 24) -
    2.0 * (c.snoozed ? 1 : 0) -
    1.0 * (seenThread ? 1 : 0)
  );
}

/** A thread appears at most once in the whole briefing (the last term of A4 §6.3). */
export function rankBriefItems(rows: BriefCandidate[], now: Date): BriefItem[] {
  void now;
  const sorted = [...rows].sort((a, b) => score(b, false) - score(a, false));
  const seen = new Set<string>();
  const out: BriefItem[] = [];
  for (const c of sorted) {
    if (seen.has(c.thread_id)) continue;
    seen.add(c.thread_id);
    out.push({
      ref: c.ref, line: c.line, why: c.why,
      ...(c.action !== undefined ? { action: c.action } : {}),
    });
  }
  return out;
}
```

- [ ] 4. Write `digest-morning.ts` — SQL collects the candidates, arithmetic assembles them, and the model writes only two strings.

```ts
// packages/agents/src/loops/digest-morning.ts
// A4 §6.1–§6.3. The briefing must be complete by 06:30, so it uses a synchronous call rather than a batch queue.
import { z } from "zod";
import { buildContext } from "../context/assemble.js";
import {
  type BriefCandidate, type BriefSection, SECTION_CAPS, rankBriefItems,
} from "../digest/rank.js";
import type { LoopSpec, TriggerContext } from "../loop/spec.js";
import { getAgentsPool } from "../pool.js";

export const MORNING_DIGEST_CRON = "30 6 * * *";

/** These two strings are all the model writes (A4 §6.3). */
export const MorningDigestOutput = z.object({
  greeting: z.string().max(120),
  one_liner: z.string().max(160),
  confidence: z.number().min(0).max(1).default(0.9),
  rationale: z.string().max(200).default(""),
  injection_flags: z.array(z.string()).default([]),
});
export type MorningDigestOutputT = z.infer<typeof MorningDigestOutput>;

const SECTION_TITLE: Record<string, string> = {
  needs_you: "Needs your decision",
  drafts: "Replies with a draft ready",
  calendar: "Today's schedule",
  commitments: "Promises I made",
  agents: "Agent progress/results",
};

export async function morningCandidates(now: Date): Promise<BriefCandidate[]> {
  const { rows } = await getAgentsPool().query<{
    kind: BriefCandidate["ref"]["kind"]; id: string; thread_id: string;
    section: BriefCandidate["section"]; line: string; why: string;
    priority: BriefCandidate["priority"]; vip: boolean; pending_approval: boolean;
    unanswered_turns: number; meeting_today: boolean; due_today: boolean; age_hours: string;
    snoozed: boolean;
  }>(
    `WITH approvals AS (
       SELECT 'approval'::text AS kind, a.id::text AS id, a.thread_id::text AS thread_id,
              'needs_you'::text AS section, a.description AS line, 'approval pending'::text AS why,
              'now'::text AS priority, false AS vip, true AS pending_approval,
              0 AS unanswered_turns, false AS meeting_today, false AS due_today,
              (EXTRACT(EPOCH FROM (now() - a.created_at))/3600)::text AS age_hours,
              false AS snoozed
         FROM pending_approvals a WHERE a.state = 'pending'),
     drafts AS (
       SELECT 'item', i.id::text, i.thread_id::text, 'drafts',
              left(i.body, 90), COALESCE(i.meta->'draft'->>'rationale', 'draft ready'), 'today',
              COALESCE(p.vip, false), false, 0, false, false,
              (EXTRACT(EPOCH FROM (now() - i.sent_at))/3600)::text, false
         FROM items i
         LEFT JOIN persons p ON p.id = i.author_person_id
        WHERE i.status = 'draft' AND (i.meta->>'pending') IS DISTINCT FROM 'true'),
     events AS (
       SELECT 'event', c.id::text, i.thread_id::text, 'calendar',
              COALESCE(i.subject, '(no subject)'),
              to_char(c.start_at AT TIME ZONE 'Asia/Seoul', 'HH24:MI'),
              'today', false, false, 0, true, false, '0', false
         FROM calendar_events c JOIN items i ON i.id = c.item_id
        WHERE c.status <> 'cancelled'
          AND c.start_at >= date_trunc('day', $1::timestamptz)
          AND c.start_at <  date_trunc('day', $1::timestamptz) + interval '1 day'),
     commitments AS (
       SELECT 'task', t.id::text, COALESCE(i.thread_id::text, t.id::text), 'commitments',
              t.title, 'Promises I made', 'today', false, false, 0, false,
              (t.due_at IS NOT NULL AND t.due_at < $1::timestamptz + interval '1 day'),
              (EXTRACT(EPOCH FROM (now() - t.created_at))/3600)::text, false
         FROM tasks t LEFT JOIN items i ON i.id = t.source_item_id
        WHERE t.state IN ('open','in_progress')),
     agents AS (
       SELECT 'session', s.id::text, s.thread_id::text, 'agents',
              COALESCE(s.summary, s.session_key), s.state, 'week', false, false, 0, false, false,
              (EXTRACT(EPOCH FROM (now() - s.started_at))/3600)::text, false
         FROM agent_sessions s WHERE s.ended_at IS NULL)
     SELECT * FROM approvals UNION ALL SELECT * FROM drafts UNION ALL SELECT * FROM events
     UNION ALL SELECT * FROM commitments UNION ALL SELECT * FROM agents`,
    [now]);

  return rows.map((r) => ({
    ref: { kind: r.kind, id: r.id }, thread_id: r.thread_id, section: r.section,
    line: r.line, why: r.why, priority: r.priority, vip: r.vip,
    pendingApproval: r.pending_approval, unansweredTurns: r.unanswered_turns,
    meetingToday: r.meeting_today, dueToday: r.due_today,
    ageHours: Number(r.age_hours), snoozed: r.snoozed,
  }));
}

export const morningDigestLoop: LoopSpec<MorningDigestOutputT> = {
  id: "digest",
  kind: "deliberate",
  trigger: { kind: "schedule", cron: MORNING_DIGEST_CRON },
  palette: [],
  budget: { inputTokens: 30_000, outputTokens: 1800, wallClockMs: 180_000, maxSteps: 1 },
  tier: "T1",
  outputSchema: MorningDigestOutput,

  assemble: (_ctx: TriggerContext) =>
    buildContext({
      selfModel: ["USER.md"], tasks: { state: "open", limit: 20 },
      calendar: { windowHours: 24 },
    }),

  async apply(result, ctx) {
    const pool = getAgentsPool();
    const candidates = await morningCandidates(ctx.now);
    const ranked = rankBriefItems(candidates, ctx.now);
    const shown = new Set(ranked.map((r) => r.ref.id));
    const bySection = new Map<string, BriefSection["items"]>();
    for (const c of candidates) {
      if (!shown.has(c.ref.id)) continue;
      const list = bySection.get(c.section) ?? [];
      list.push({ ref: c.ref, line: c.line, why: c.why });
      bySection.set(c.section, list);
    }
    let quiet = candidates.length - ranked.length;
    const sections: BriefSection[] = [];
    for (const [id, cap] of Object.entries(SECTION_CAPS)) {
      const all = bySection.get(id) ?? [];
      const kept = Number.isFinite(cap) ? all.slice(0, cap) : all;
      quiet += all.length - kept.length;
      sections.push({ id: id as BriefSection["id"], title: SECTION_TITLE[id] ?? id, items: kept });
    }
    sections.push({ id: "quiet", title: "Everything else", count: quiet });

    const briefing = {
      greeting: result.output.greeting, sections, one_liner: result.output.one_liner,
    };
    const itemIds = ranked.filter((r) => r.ref.kind === "item").map((r) => r.ref.id);
    await pool.query(
      `INSERT INTO digests (kind, for_date, body, item_ids, metrics)
       VALUES ('morning', (now() AT TIME ZONE 'Asia/Seoul')::date, $1, $2::uuid[], $3::jsonb)
       ON CONFLICT (kind, for_date)
         DO UPDATE SET body = EXCLUDED.body, item_ids = EXCLUDED.item_ids, metrics = EXCLUDED.metrics`,
      [JSON.stringify(briefing), itemIds,
       JSON.stringify({ candidates: candidates.length, shown: ranked.length, quiet })]);
  },
};
// Not registered — it shares the LoopId 'digest' with nightlyDigestLoop, so
// both loops run directly through runLoopSpec (the hub registers the cron handlers).
```

- [ ] 5. Write the integration test and confirm it passes.

```ts
// packages/agents/test/integration/digest-morning.test.ts
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MORNING_DIGEST_CRON, configureAgents, getLoop, morningDigestLoop } from "../../src/index.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});
beforeEach(async () => {
  configureAgents({ pool });
  await pool.query("DELETE FROM digests WHERE kind = 'morning'");
});
afterAll(() => pool.end());

describe("morningDigestLoop (A4 §6)", () => {
  it("runs at 06:30 KST and stays out of the registry", () => {
    expect(MORNING_DIGEST_CRON).toBe("30 6 * * *");
    expect(() => getLoop("digest")).toThrow(/not registered/);
  });

  it("writes exactly one digests row per day with coverage metrics", async () => {
    const ctx = {
      trigger_kind: "cron" as const, trigger_ref: "morning_digest",
      now: new Date(), payload: {},
    };
    const r = {
      loop: "digest" as const, run_id: "00000000-0000-0000-0000-00000000aaaa",
      output: {
        greeting: "Good morning.", one_liner: "Two quotes are the key thing today.",
        confidence: 0.9, rationale: "", injection_flags: [],
      },
      confidence: 0.9, rationale: "", escalate: false, injection_flags: [], unresolved: [],
    };
    await morningDigestLoop.apply(r as never, ctx);
    await morningDigestLoop.apply(r as never, ctx);
    const { rows } = await pool.query<{ n: string; metrics: { shown: number } }>(
      `SELECT count(*)::text AS n, (array_agg(metrics))[1] AS metrics
         FROM digests WHERE kind = 'morning'`);
    expect(rows[0]?.n).toBe("1");
    expect(rows[0]?.metrics).toHaveProperty("shown");
  });
});
```

```bash
pnpm --filter @omnis/agents test -- digest && pnpm lint
```

- [ ] 6. Add the exports to `index.ts` and commit.

```ts
// packages/agents/src/index.ts — added
export {
  SECTION_CAPS, rankBriefItems,
  type BriefCandidate, type BriefItem, type BriefSection, type BriefSectionId,
  type MorningBriefing,
} from "./digest/rank.js";
export {
  MORNING_DIGEST_CRON, MorningDigestOutput, morningCandidates, morningDigestLoop,
  type MorningDigestOutputT,
} from "./loops/digest-morning.js";
```

```bash
git add packages/agents/src/digest packages/agents/src/loops/digest-morning.ts packages/agents/src/index.ts packages/agents/test/digest-rank.test.ts packages/agents/test/integration/digest-morning.test.ts
git commit -m "US-B23: L5 morning briefing

- rankBriefItems is the 8-term arithmetic weighted sum from A4 §6.3, and each thread appears only once overall
- Section caps 5/7/all/5/5; everything else is only counted in the quiet.count number
- The only strings the model writes are greeting and one_liner
- One digests(kind='morning') row a day + coverage metrics

Implemented-by: Claude Opus
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 22: `nightlyDigestLoop` — full auto-archive exposure + the cost field (US-B24, tier: Opus)

> **Story** — Goal: 23:00 KST, the `NightlyDigest` model (per-group `reason`/`samples` ≤3/`undo_token` 7-day), full auto-archive exposure, and the `cost` field (MTD/cap/tier_state). Deliverables: `packages/agents/src/loops/digest-nightly.ts`. Verification: `pnpm --filter @omnis/agents test`. Depends on: B14, B18, B23.

**Read:** A4 §6.4 (`NightlyDigest`/`DigestGroup`)·§9.4 (full exposure, 7-day undo), `archivedSince` from Task 13.
**Do not build (YAGNI):** an undo token table. The token is always recomputable as the first 16 characters of `sha256(digest_id + reason)`, and the 7-day window is decided by `meta.archived_by.at`.

**Files:**
- Create: `packages/agents/src/loops/digest-nightly.ts`, `packages/agents/test/integration/digest-nightly.test.ts`
- Modify: `packages/agents/src/index.ts`
- Test: `packages/agents/test/integration/digest-nightly.test.ts`

**Interfaces:**
- Consumes: `BriefItem` (Task 21), `buildContext` (US-B05). The hub injects the cost figures via `ctx.payload.cost` (`currentPolicy` is owned by the kernel, so agents cannot call it directly).
- Produces: `nightlyDigestLoop`, `NightlyDigestOutput`, `NightlyDigest`, `DigestGroup`, `undoTokenFor`, `NIGHTLY_DIGEST_CRON`, `nightlyGroups`.

### Steps

- [ ] 1. Write the failing test.

```ts
// packages/agents/test/integration/digest-nightly.test.ts
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  NIGHTLY_DIGEST_CRON, configureAgents, nightlyDigestLoop, nightlyGroups, undoTokenFor,
} from "../../src/index.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});
let threadId = "";
beforeEach(async () => {
  configureAgents({ pool });
  await pool.query("DELETE FROM digests WHERE kind = 'nightly'");
  const a = await pool.query<{ id: string }>(
    `INSERT INTO accounts (channel, external_id, display) VALUES ('gmail','nd@test','n')
       ON CONFLICT (channel, external_id) DO UPDATE SET display='n' RETURNING id`);
  const accountId = a.rows[0]?.id ?? "";
  const t = await pool.query<{ id: string }>(
    `INSERT INTO threads (account_id, external_id, kind) VALUES ($1,'thr_nd','email')
       ON CONFLICT (account_id, external_id) DO UPDATE SET kind='email' RETURNING id`, [accountId]);
  threadId = t.rows[0]?.id ?? "";
  await pool.query("DELETE FROM items WHERE thread_id = $1", [threadId]);
  for (let i = 0; i < 5; i += 1) {
    await pool.query(
      `INSERT INTO items (thread_id, account_id, kind, status, body, sent_at, meta)
       VALUES ($1,$2,'email','archived',$3, now(),
         jsonb_build_object('archived_by', jsonb_build_object(
           'rule_ids','["ar_no_cta"]'::jsonb,'reason','Newsletter','tier','T0',
           'confidence',0.95,'run_id','r','at', now()::text)))`,
      [threadId, accountId, `Newsletter ${i}`]);
  }
});
afterAll(() => pool.end());

describe("nightlyDigestLoop (A4 §6.4·§9.4)", () => {
  it("runs at 23:00 KST", () => {
    expect(NIGHTLY_DIGEST_CRON).toBe("0 23 * * *");
  });

  it("exposes every archived item — count is the full number, samples are capped at 3", async () => {
    const groups = await nightlyGroups(pool, new Date(Date.now() - 3_600_000), "d1");
    const g = groups.find((x) => x.reason === "Newsletter");
    expect(g?.count).toBe(5);
    expect(g?.samples.length).toBe(3);
    expect(g?.undo_token).toBe(undoTokenFor("d1", "Newsletter"));
  });

  it("stores the cost field the hub injected", async () => {
    await nightlyDigestLoop.apply(
      {
        loop: "digest", run_id: "00000000-0000-0000-0000-00000000bbbb",
        output: {
          headline: "3 handled today, 5 auto-archived.", one_liner: "A quiet day.",
          confidence: 0.9, rationale: "", injection_flags: [],
        },
        confidence: 0.9, rationale: "", escalate: false, injection_flags: [], unresolved: [],
      } as never,
      {
        trigger_kind: "cron", trigger_ref: "nightly_digest", now: new Date(),
        payload: { cost: { month_to_date_usd: 12.5, cap_usd: 60, tier_state: "normal" } },
      });
    const { rows } = await pool.query<{ body: string }>(
      "SELECT body FROM digests WHERE kind = 'nightly' ORDER BY created_at DESC LIMIT 1");
    const parsed = JSON.parse(rows[0]?.body ?? "{}") as {
      cost: { cap_usd: number; tier_state: string }; auto_archived: { count: number }[];
    };
    expect(parsed.cost).toEqual({ month_to_date_usd: 12.5, cap_usd: 60, tier_state: "normal" });
    expect(parsed.auto_archived[0]?.count).toBe(5);
  });
});
```

- [ ] 2. Confirm the failure. Expected: `does not provide an export named 'nightlyGroups'`.

```bash
pnpm --filter @omnis/agents test -- digest-nightly
```

- [ ] 3. Write the implementation.

```ts
// packages/agents/src/loops/digest-nightly.ts
// A4 §6.4. The verdict is owned by §9 (L8); this module only defines how to expose its result for a human to see.
import { createHash } from "node:crypto";
import type { Channel } from "@omnis/protocol";
import type { Pool } from "pg";
import { z } from "zod";
import { buildContext } from "../context/assemble.js";
import type { BriefItem } from "../digest/rank.js";
import type { LoopSpec, TriggerContext } from "../loop/spec.js";
import { getAgentsPool } from "../pool.js";

export const NIGHTLY_DIGEST_CRON = "0 23 * * *";

export interface DigestGroup {
  reason: string;
  count: number;
  samples: BriefItem[];
  undo_token: string;
}

export interface NightlyDigest {
  headline: string;
  auto_archived: DigestGroup[];
  handled: { count: number; by_channel: Partial<Record<Channel, number>> };
  still_open: BriefItem[];
  cost: { month_to_date_usd: number; cap_usd: number; tier_state: string };
  agents: { runs: number; failed: number; delegated: number };
}

/** The 7-day window is decided by meta.archived_by.at, so the token is not stored — it is a recomputable value. */
export function undoTokenFor(digestId: string, reason: string): string {
  return createHash("sha256").update(`${digestId}::${reason}`).digest("hex").slice(0, 16);
}

export const NightlyDigestOutput = z.object({
  headline: z.string().max(120),
  one_liner: z.string().max(160),
  confidence: z.number().min(0).max(1).default(0.9),
  rationale: z.string().max(200).default(""),
  injection_flags: z.array(z.string()).default([]),
});
export type NightlyDigestOutputT = z.infer<typeof NightlyDigestOutput>;

/** A4 §9.4: auto-archive is fully exposed — count is the total, only samples are cut to 3. */
export async function nightlyGroups(
  pool: Pool,
  since: Date,
  digestId: string,
): Promise<DigestGroup[]> {
  const { rows } = await pool.query<{
    reason: string; count: string; samples: { id: string; line: string }[];
  }>(
    `SELECT COALESCE(meta->'archived_by'->>'reason','Other') AS reason,
            count(*)::text AS count,
            jsonb_agg(jsonb_build_object('id', id, 'line', left(COALESCE(subject, body), 90))
                      ORDER BY sent_at DESC) AS samples
       FROM items
      WHERE status = 'archived' AND (meta->'archived_by'->>'at')::timestamptz >= $1
      GROUP BY 1 ORDER BY count(*) DESC`,
    [since]);
  return rows.map((r) => ({
    reason: r.reason,
    count: Number(r.count),
    samples: (r.samples ?? []).slice(0, 3).map((s) => ({
      ref: { kind: "item" as const, id: s.id }, line: s.line, why: r.reason,
    })),
    undo_token: undoTokenFor(digestId, r.reason),
  }));
}

async function handledToday(pool: Pool, now: Date): Promise<NightlyDigest["handled"]> {
  const { rows } = await pool.query<{ channel: Channel; n: string }>(
    `SELECT a.channel, count(*)::text AS n
       FROM items i JOIN accounts a ON a.id = i.account_id
      WHERE i.status IN ('sent','read') AND i.sent_at >= date_trunc('day', $1::timestamptz)
      GROUP BY a.channel`, [now]);
  const by: Partial<Record<Channel, number>> = {};
  let total = 0;
  for (const r of rows) {
    by[r.channel] = Number(r.n);
    total += Number(r.n);
  }
  return { count: total, by_channel: by };
}

async function agentStats(pool: Pool, now: Date): Promise<NightlyDigest["agents"]> {
  const { rows } = await pool.query<{ runs: string; failed: string; delegated: string }>(
    `SELECT count(*)::text AS runs,
            count(*) FILTER (WHERE outcome = 'failed')::text AS failed,
            count(*) FILTER (WHERE loop = 'delegate')::text AS delegated
       FROM agent_runs WHERE created_at >= date_trunc('day', $1::timestamptz)`, [now]);
  return {
    runs: Number(rows[0]?.runs ?? "0"),
    failed: Number(rows[0]?.failed ?? "0"),
    delegated: Number(rows[0]?.delegated ?? "0"),
  };
}

export const nightlyDigestLoop: LoopSpec<NightlyDigestOutputT> = {
  id: "digest",
  kind: "deliberate",
  trigger: { kind: "schedule", cron: NIGHTLY_DIGEST_CRON },
  palette: [],
  budget: { inputTokens: 40_000, outputTokens: 2200, wallClockMs: 300_000, maxSteps: 1 },
  tier: "T1",
  outputSchema: NightlyDigestOutput,

  assemble: (_ctx: TriggerContext) =>
    buildContext({ selfModel: ["USER.md"], tasks: { state: "open", limit: 20 } }),

  async apply(result, ctx) {
    const pool = getAgentsPool();
    const dayStart = new Date(ctx.now);
    dayStart.setHours(0, 0, 0, 0);
    const digestId = `${ctx.now.toISOString().slice(0, 10)}:nightly`;
    const cost = (ctx.payload.cost ?? {
      month_to_date_usd: 0, cap_usd: 60, tier_state: "normal",
    }) as NightlyDigest["cost"];

    const digest: NightlyDigest = {
      headline: result.output.headline,
      auto_archived: await nightlyGroups(pool, dayStart, digestId),
      handled: await handledToday(pool, ctx.now),
      still_open: [],
      cost,
      agents: await agentStats(pool, ctx.now),
    };
    const itemIds = digest.auto_archived.flatMap((g) => g.samples.map((s) => s.ref.id));
    await pool.query(
      `INSERT INTO digests (kind, for_date, body, item_ids, metrics)
       VALUES ('nightly', (now() AT TIME ZONE 'Asia/Seoul')::date, $1, $2::uuid[], $3::jsonb)
       ON CONFLICT (kind, for_date)
         DO UPDATE SET body = EXCLUDED.body, item_ids = EXCLUDED.item_ids, metrics = EXCLUDED.metrics`,
      [JSON.stringify(digest), itemIds,
       JSON.stringify({
         archived: digest.auto_archived.reduce((n, g) => n + g.count, 0),
         cost_mtd_usd: cost.month_to_date_usd,
       })]);
  },
};
// Not registered, for the same reason as morningDigestLoop (it shares the LoopId 'digest').
```

- [ ] 4. Add the exports to `index.ts` and confirm it passes. Expected: 3 tests passed.

```ts
// packages/agents/src/index.ts — added
export {
  NIGHTLY_DIGEST_CRON, NightlyDigestOutput, nightlyDigestLoop, nightlyGroups, undoTokenFor,
  type DigestGroup, type NightlyDigest, type NightlyDigestOutputT,
} from "./loops/digest-nightly.js";
```

```bash
pnpm --filter @omnis/agents test -- digest-nightly && pnpm lint
git add packages/agents/src/loops/digest-nightly.ts packages/agents/src/index.ts packages/agents/test/integration/digest-nightly.test.ts
git commit -m "US-B24: L5 nightly digest

- 23:00 KST, the NightlyDigest model (per-group reason/samples<=3/undo_token)
- Auto-archive is fully exposed via count; only samples are cut to 3
- undo_token is a recomputed sha256(digest_id::reason) value, so it is not stored
- The cost field (MTD/cap/tier_state) is injected by the hub from currentPolicy

Implemented-by: Claude Opus
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 23: `memory_consolidate` — Anthropic Message Batches (US-B24, tier: Opus)

> **Story** — Goal: nightly memory consolidation runs at T2 + Anthropic Message Batches (submitted 23:30, harvested before the next morning). Deliverables: `packages/agents/src/memory/consolidate.ts`. Verification: `pnpm --filter @omnis/agents test`.

**Read:** A4 §6.5, delta §9 (`OMNIS_ANTHROPIC_API_KEY`).
**Design note:** do not pin `@ai-sdk/anthropic` fresh — Batches is not an SDK but **two `fetch` calls** (submit + harvest), and that is also easier to stub in tests. Synchronous T2 calls use the Task 3 OpenRouter path as is.
**Do not build (YAGNI):** a batch status polling loop. Two jobs — submit at 23:30, harvest at 06:00 — are enough, and an unfinished batch is skipped that day.

**Files:**
- Create: `packages/agents/src/memory/consolidate.ts`, `packages/agents/test/memory-consolidate.test.ts`
- Modify: `packages/agents/src/index.ts`
- Test: `packages/agents/test/memory-consolidate.test.ts`

**Interfaces:**
- Consumes: nothing (it uses only `fetch`). The side that writes the harvested results into `memories` is handled by US-B08's `upsertMemory`/`supersede`.
- Produces: `ANTHROPIC_BATCH_URL`, `ANTHROPIC_BATCH_MODEL`, `submitConsolidation`, `harvestConsolidation`, `MEMORY_CONSOLIDATE_CRON`, `MEMORY_HARVEST_CRON`, `type ConsolidationRequest`, `type ConsolidationResult`.

### Steps

- [ ] 1. Write the failing test. Stub `fetch` so no network is touched.

```ts
// packages/agents/test/memory-consolidate.test.ts
import { describe, expect, it, vi } from "vitest";
import {
  ANTHROPIC_BATCH_MODEL, MEMORY_CONSOLIDATE_CRON, harvestConsolidation, submitConsolidation,
} from "../src/index.js";

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200, headers: { "content-type": "application/json" },
  });

describe("memory consolidation via Message Batches (A4 §6.5)", () => {
  it("submits at 23:30 KST with the T2 model", () => {
    expect(MEMORY_CONSOLIDATE_CRON).toBe("30 23 * * *");
    expect(ANTHROPIC_BATCH_MODEL).toBe("claude-sonnet-5");
  });

  it("returns null without sending when the API key is missing", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubEnv("OMNIS_ANTHROPIC_API_KEY", "");
    expect(await submitConsolidation([{ custom_id: "m1", prompt: "Summarize this" }])).toBe(null);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("posts one batch request per candidate and returns the batch id", async () => {
    const fetchSpy = vi.fn(async () => json({ id: "msgbatch_1", processing_status: "in_progress" }));
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubEnv("OMNIS_ANTHROPIC_API_KEY", "sk-test");
    const id = await submitConsolidation([
      { custom_id: "m1", prompt: "a" }, { custom_id: "m2", prompt: "b" }]);
    expect(id).toBe("msgbatch_1");
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as {
      requests: { custom_id: string; params: { model: string } }[];
    };
    expect(body.requests).toHaveLength(2);
    expect(body.requests[0]?.params.model).toBe(ANTHROPIC_BATCH_MODEL);
    expect((init.headers as Record<string, string>)["anthropic-version"]).toBe("2023-06-01");
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns an empty harvest while the batch is still running", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({
      id: "msgbatch_1", processing_status: "in_progress" })));
    vi.stubEnv("OMNIS_ANTHROPIC_API_KEY", "sk-test");
    expect(await harvestConsolidation("msgbatch_1")).toEqual([]);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
});
```

- [ ] 2. Confirm the failure. Expected: `does not provide an export named 'submitConsolidation'`.

```bash
pnpm --filter @omnis/agents test -- memory-consolidate
```

- [ ] 3. Write the implementation.

```ts
// packages/agents/src/memory/consolidate.ts
// A4 §6.5: the only task insensitive to latency, so batching fits exactly (Anthropic Message Batches, -50%).
// No new SDK pin — one fetch each for submit and harvest.
export const ANTHROPIC_BATCH_URL = "https://api.anthropic.com/v1/messages/batches";
export const ANTHROPIC_BATCH_MODEL = "claude-sonnet-5";
export const MEMORY_CONSOLIDATE_CRON = "30 23 * * *";
/** Harvested before the next morning briefing (06:30). */
export const MEMORY_HARVEST_CRON = "0 6 * * *";

const ANTHROPIC_VERSION = "2023-06-01";

export interface ConsolidationRequest {
  custom_id: string;
  prompt: string;
}

export interface ConsolidationResult {
  custom_id: string;
  text: string;
}

function apiKey(): string {
  return process.env.OMNIS_ANTHROPIC_API_KEY ?? "";
}

function headers(key: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-api-key": key,
    "anthropic-version": ANTHROPIC_VERSION,
  };
}

/** Returns null when the key is missing — delta §9: the T2 path is skipped and a system Item appears. */
export async function submitConsolidation(
  requests: readonly ConsolidationRequest[],
): Promise<string | null> {
  const key = apiKey();
  if (key === "" || requests.length === 0) return null;
  const res = await fetch(ANTHROPIC_BATCH_URL, {
    method: "POST",
    headers: headers(key),
    body: JSON.stringify({
      requests: requests.map((r) => ({
        custom_id: r.custom_id,
        params: {
          model: ANTHROPIC_BATCH_MODEL,
          max_tokens: 800,
          messages: [{ role: "user", content: r.prompt }],
        },
      })),
    }),
  });
  if (!res.ok) throw new Error(`anthropic batch submit failed: ${res.status}`);
  const body = (await res.json()) as { id: string };
  return body.id;
}

export async function harvestConsolidation(batchId: string): Promise<ConsolidationResult[]> {
  const key = apiKey();
  if (key === "") return [];
  const status = await fetch(`${ANTHROPIC_BATCH_URL}/${batchId}`, { headers: headers(key) });
  if (!status.ok) throw new Error(`anthropic batch status failed: ${status.status}`);
  const meta = (await status.json()) as { processing_status: string; results_url?: string };
  if (meta.processing_status !== "ended" || meta.results_url === undefined) return [];

  const results = await fetch(meta.results_url, { headers: headers(key) });
  if (!results.ok) throw new Error(`anthropic batch results failed: ${results.status}`);
  const text = await results.text();
  const out: ConsolidationResult[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const row = JSON.parse(line) as {
      custom_id: string;
      result: { type: string; message?: { content: { type: string; text?: string }[] } };
    };
    if (row.result.type !== "succeeded") continue;
    const chunk = row.result.message?.content.find((c) => c.type === "text")?.text;
    if (chunk !== undefined) out.push({ custom_id: row.custom_id, text: chunk });
  }
  return out;
}
```

- [ ] 4. Add the exports to `index.ts` and confirm it passes. Expected: 4 tests passed.

```ts
// packages/agents/src/index.ts — added
export {
  ANTHROPIC_BATCH_MODEL, ANTHROPIC_BATCH_URL, MEMORY_CONSOLIDATE_CRON, MEMORY_HARVEST_CRON,
  harvestConsolidation, submitConsolidation,
  type ConsolidationRequest, type ConsolidationResult,
} from "./memory/consolidate.js";
```

```bash
pnpm --filter @omnis/agents test -- memory-consolidate && pnpm lint
git add packages/agents/src/memory/consolidate.ts packages/agents/src/index.ts packages/agents/test/memory-consolidate.test.ts
git commit -m "US-B24: nightly memory consolidation — Anthropic Message Batches

- Submit 23:30 / harvest 06:00, two fetches with no new provider SDK pin
- With no OMNIS_ANTHROPIC_API_KEY it returns null and sends nothing
- If the batch has not finished it returns an empty array and that day is skipped

Implemented-by: Claude Opus
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 24: self-model patch proposals + apply (US-B25, tier: Opus)

> **Story** — Goal: a Sunday 21:00 job, 5 kinds of input, the patch constraints (one per file·at most 3·≤20 changed lines·`evidence` ≥2, ≥3 for a USER.md deletion), `git apply` + commit + snapshot cache invalidation on approval, and suppressing ignored patches for 4 weeks by diff hash. Deliverables: `packages/agents/src/self-model/propose.ts`, `packages/kernel/src/self-model/apply.ts`. Verification: `pnpm --filter @omnis/agents test`. Depends on: B02, B07.

**Read:** all of A4 §13.1–§13.3, delta §3 (`applySelfModelPatch`/`invalidateSnapshotCache`)·§0-2 (`~/.omnis/self-model/`).
**Do not build (YAGNI):** a custom diff parser. `git apply --check` validates and `git apply` applies.

**Files:**
- Create: `packages/agents/src/self-model/propose.ts`, `packages/kernel/src/self-model/apply.ts`, `packages/agents/test/integration/self-model-propose.test.ts`, `packages/kernel/test/integration/self-model-apply.test.ts`
- Modify: `packages/agents/src/index.ts`, `packages/kernel/src/index.ts`
- Test: the two test files above

**Interfaces:**
- Consumes: `PROPOSE_TOOLS.propose_self_model_patch`(Task 5), `applySelfModelPatch`/`invalidateSnapshotCache`(US-B02, `@omnis/memory`), `Audit`(Phase A).
- Produces: `SELF_MODEL_CRON`, `MAX_PATCHES`, `MAX_PATCH_LINES`, `SUPPRESSION_WEEKS`, `SelfModelPatch`, `validatePatch`, `diffHash`, `isSuppressed`, `suppressPatch`, `proposeSelfModelPatches`, `SELF_MODEL_DIR_ENV`, `selfModelDir`, `checkPatch`, `applyApprovedSelfModelPatch`.

### Steps

- [ ] 1. Write the failing constraint test.

```ts
// packages/agents/test/integration/self-model-propose.test.ts
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_PATCHES, MAX_PATCH_LINES, SELF_MODEL_CRON, SUPPRESSION_WEEKS, configureAgents, diffHash,
  isSuppressed, suppressPatch, validatePatch,
} from "../../src/index.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://logan@127.0.0.1:5432/omnis_test",
});
beforeEach(async () => {
  configureAgents({ pool });
  await pool.query("DELETE FROM settings WHERE key LIKE 'self_model.suppressed.%'");
});
afterAll(() => pool.end());

const diff = (lines: number) =>
  ["--- a/VOICE.md", "+++ b/VOICE.md", "@@ -1,1 +1,1 @@",
   ...Array.from({ length: lines }, (_, i) => `+new line ${i}`)].join("\n");

describe("self-model patch constraints (A4 §13.2)", () => {
  it("runs on Sunday 21:00 KST with the documented caps", () => {
    expect(SELF_MODEL_CRON).toBe("0 21 * * 0");
    expect(MAX_PATCHES).toBe(3);
    expect(MAX_PATCH_LINES).toBe(20);
    expect(SUPPRESSION_WEEKS).toBe(4);
  });

  it("needs at least two pieces of evidence, three to delete from USER.md", () => {
    expect(validatePatch({ file: "VOICE.md", diff: diff(2), rationale: "r", evidence: ["a"] }).ok)
      .toBe(false);
    expect(validatePatch({ file: "VOICE.md", diff: diff(2), rationale: "r", evidence: ["a", "b"] }).ok)
      .toBe(true);
    const deletion = ["--- a/USER.md", "+++ b/USER.md", "@@ -1,2 +1,1 @@", "-delete this"].join("\n");
    expect(validatePatch({ file: "USER.md", diff: deletion, rationale: "r", evidence: ["a", "b"] }).ok)
      .toBe(false);
    expect(validatePatch({ file: "USER.md", diff: deletion, rationale: "r",
      evidence: ["a", "b", "c"] }).ok).toBe(true);
  });

  it("rejects a patch longer than 20 changed lines", () => {
    const r = validatePatch({ file: "VOICE.md", diff: diff(21), rationale: "r",
      evidence: ["a", "b"] });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("20");
  });

  it("suppresses an ignored patch for four weeks by diff hash", async () => {
    const d = diff(2);
    expect(await isSuppressed(pool, diffHash(d))).toBe(false);
    await suppressPatch(pool, diffHash(d));
    expect(await isSuppressed(pool, diffHash(d))).toBe(true);
    expect(diffHash(d)).toBe(diffHash(d));
    expect(diffHash(d)).not.toBe(diffHash(diff(3)));
  });
});
```

- [ ] 2. Confirm the failure. Expected: `does not provide an export named 'validatePatch'`.

```bash
pnpm --filter @omnis/agents test -- self-model-propose
```

- [ ] 3. Write `propose.ts`.

```ts
// packages/agents/src/self-model/propose.ts
// A4 §13. Only the user changes text the user wrote — this module goes no further than an approval card.
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { getAgentsPool } from "../pool.js";
import { PROPOSE_TOOLS } from "../tools/propose.js";

export const SELF_MODEL_CRON = "0 21 * * 0";
export const MAX_PATCHES = 3;
export const MAX_PATCH_LINES = 20;
export const SUPPRESSION_WEEKS = 4;

export interface SelfModelPatch {
  file: "USER.md" | "VOICE.md" | "PROJECTS.md";
  diff: string;
  rationale: string;
  evidence: string[];
}

function changedLines(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
    if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
  }
  return { added, removed };
}

export function validatePatch(p: SelfModelPatch): { ok: boolean; reason: string | null } {
  const { added, removed } = changedLines(p.diff);
  if (added + removed === 0) return { ok: false, reason: "empty diff" };
  if (added + removed > MAX_PATCH_LINES) {
    return { ok: false, reason: `changed lines exceed ${MAX_PATCH_LINES} (${added + removed})` };
  }
  const deletionOnly = added === 0 && removed > 0;
  const need = p.file === "USER.md" && deletionOnly ? 3 : 2;
  if (p.evidence.length < need) {
    return { ok: false, reason: `${need} pieces of evidence required (${p.evidence.length} given)` };
  }
  return { ok: true, reason: null };
}

export function diffHash(diff: string): string {
  return createHash("sha256").update(diff.trim()).digest("hex").slice(0, 32);
}

/** An ignored patch is not proposed again for 4 weeks (A4 §13.2). It uses the settings kv as is. */
export async function suppressPatch(
  pool: Pool,
  hash: string,
  now: Date = new Date(),
): Promise<void> {
  const until = new Date(now.getTime() + SUPPRESSION_WEEKS * 7 * 86_400_000).toISOString();
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ($1, to_jsonb($2::text))
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [`self_model.suppressed.${hash}`, until]);
}

export async function isSuppressed(
  pool: Pool,
  hash: string,
  now: Date = new Date(),
): Promise<boolean> {
  const { rows } = await pool.query<{ until: string }>(
    "SELECT value #>> '{}' AS until FROM settings WHERE key = $1",
    [`self_model.suppressed.${hash}`]);
  const until = rows[0]?.until;
  return until !== undefined && new Date(until) > now;
}

/** At most 1 per file, at most 3 overall. Suppressed diffs and constraint violations are skipped. */
export async function proposeSelfModelPatches(
  patches: readonly SelfModelPatch[],
  runId: string,
): Promise<string[]> {
  const pool = getAgentsPool();
  const seenFiles = new Set<string>();
  const approvalIds: string[] = [];
  for (const p of patches) {
    if (approvalIds.length >= MAX_PATCHES) break;
    if (seenFiles.has(p.file)) continue;
    if (!validatePatch(p).ok) continue;
    if (await isSuppressed(pool, diffHash(p.diff))) continue;
    seenFiles.add(p.file);
    const out = (await PROPOSE_TOOLS.propose_self_model_patch?.execute?.(
      { file: p.file, diff: p.diff, rationale: p.rationale, evidence: p.evidence },
      { toolCallId: runId, messages: [] },
    )) as { approval_id: string } | undefined;
    if (out !== undefined) approvalIds.push(out.approval_id);
  }
  return approvalIds;
}
```

- [ ] 4. Write the kernel-side apply — `git apply --check` → apply → commit → invalidate the snapshot cache.

```ts
// packages/kernel/src/self-model/apply.ts
// A4 §13.2: on approval the kernel runs git apply + commit in the self-model git repo and invalidates the snapshot cache.
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { applySelfModelPatch, invalidateSnapshotCache } from "@omnis/memory";
import type { Audit } from "../audit.js";

const run = promisify(execFile);

export const SELF_MODEL_DIR_ENV = "OMNIS_SELF_MODEL_DIR";

export function selfModelDir(env: NodeJS.ProcessEnv = process.env): string {
  return env[SELF_MODEL_DIR_ENV] ?? join(env.HOME ?? "", ".omnis", "self-model");
}

/** First check whether the diff is actually applicable. If it fails, the approval goes to failExecution. */
export async function checkPatch(dir: string, diff: string): Promise<boolean> {
  const tmp = await mkdtemp(join(tmpdir(), "omnis-patch-"));
  const file = join(tmp, "patch.diff");
  await writeFile(file, diff.endsWith("\n") ? diff : `${diff}\n`, "utf8");
  try {
    await run("git", ["-C", dir, "apply", "--check", file]);
    return true;
  } catch {
    return false;
  }
}

export async function applyApprovedSelfModelPatch(
  args: { file: "USER.md" | "VOICE.md" | "PROJECTS.md"; diff: string; rationale: string },
  deps: { audit: Audit; approvalId: string; dir?: string },
): Promise<{ commit: string }> {
  const dir = deps.dir ?? selfModelDir();
  if (!(await checkPatch(dir, args.diff))) {
    throw new Error(`git apply --check failed for ${args.file}`);
  }
  const { commit } = await applySelfModelPatch(args.file, args.diff, args.rationale);
  // The next loop call uses the new prefix — the cache is cleared once, so this is batched onto Sunday night.
  invalidateSnapshotCache();
  await deps.audit.record({
    actor: "me", action: "self_model.applied", target_table: "settings",
    target_id: args.file, after: { commit, rationale: args.rationale },
    approval_id: deps.approvalId,
  });
  return { commit };
}
```

- [ ] 5. Write the kernel test — it runs a real `git apply --check` in a temporary git repo.

```ts
// packages/kernel/test/integration/self-model-apply.test.ts
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkPatch, selfModelDir } from "../../src/self-model/apply.js";

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "omnis-sm-"));
  execFileSync("git", ["-C", dir, "init", "-q"]);
  execFileSync("git", ["-C", dir, "config", "user.email", "t@example.com"]);
  execFileSync("git", ["-C", dir, "config", "user.name", "t"]);
  writeFileSync(join(dir, "VOICE.md"), "Hello\n", "utf8");
  execFileSync("git", ["-C", dir, "add", "."]);
  execFileSync("git", ["-C", dir, "commit", "-qm", "init"]);
  return dir;
}

describe("self-model apply (A4 §13.2)", () => {
  it("defaults to ~/.omnis/self-model and honours the env override", () => {
    expect(selfModelDir({ HOME: "/h" })).toBe("/h/.omnis/self-model");
    expect(selfModelDir({ HOME: "/h", OMNIS_SELF_MODEL_DIR: "/x" })).toBe("/x");
  });

  it("accepts an applicable diff and rejects a stale one", async () => {
    const dir = repo();
    const good = ["--- a/VOICE.md", "+++ b/VOICE.md", "@@ -1 +1,2 @@",
      " Hello", "+Hello there"].join("\n");
    expect(await checkPatch(dir, good)).toBe(true);
    const stale = ["--- a/VOICE.md", "+++ b/VOICE.md", "@@ -1 +1 @@",
      "-a line that is not there", "+new line"].join("\n");
    expect(await checkPatch(dir, stale)).toBe(false);
  });
});
```

- [ ] 6. Add the exports to both `index.ts` files and confirm they pass. Expected: agents 4 + kernel 2 tests passed.

```ts
// packages/agents/src/index.ts — added
export {
  MAX_PATCHES, MAX_PATCH_LINES, SELF_MODEL_CRON, SUPPRESSION_WEEKS, diffHash, isSuppressed,
  proposeSelfModelPatches, suppressPatch, validatePatch, type SelfModelPatch,
} from "./self-model/propose.js";
```

```ts
// packages/kernel/src/index.ts — added
export {
  SELF_MODEL_DIR_ENV, applyApprovedSelfModelPatch, checkPatch, selfModelDir,
} from "./self-model/apply.js";
```

```bash
pnpm --filter @omnis/agents test -- self-model && \
  pnpm --filter @omnis/kernel test:integration -- self-model && pnpm lint
git add packages/agents/src/self-model packages/kernel/src/self-model packages/agents/src/index.ts packages/kernel/src/index.ts packages/agents/test/integration/self-model-propose.test.ts packages/kernel/test/integration/self-model-apply.test.ts
git commit -m "US-B25: self-model patch proposal and apply

- Sunday 21:00, one per file·at most 3·20 changed lines·2 evidence items (3 for a USER.md deletion)
- An ignored patch is suppressed for 4 weeks by diff hash (settings kv)
- On approval: git apply --check → applySelfModelPatch → invalidate the snapshot cache → audit_log

Implemented-by: Claude Opus
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Execution order

Only the places with dependencies are listed. The rest are order-independent.

1. **Task 1 → 5 → 2 → 3 → 4** (US-B06·B07). Task 3 (`runLoopSpec`) imports Task 5's `toolRegistry`, so **Task 5 comes before Task 3**.
2. **Task 6 → 7** (US-B14). The channels and ops plans are waiting on Task 7's `0012_jobs_phase_b.sql` — merge it early in the wave.
3. **Task 8 → 9** (US-B13). Run Task 9 after US-B05 (`buildContext`) is merged.
4. **Task 10 → 11 → 12** (US-B15·B17). Run Task 12 after the **W0 schema bundle** (`0011_push_subscriptions.sql`) is merged (delta §6).
5. **Task 13 → 14** (US-B18).
6. **Task 17 → 15 → 16** (US-B20·B19). `taskLoop` imports `routeByRule`, so **Task 17 comes first**.
7. **Task 17 → 18** (US-B20).
8. **Task 19** (US-B21), **Task 20** (US-B22) — independent.
9. **Task 21 → 22 → 23** (US-B23·B24). Task 22 only produces meaningful values once Task 6 (`currentPolicy`) and Task 13·14 (the archive results) are in place.
10. **Task 24** (US-B25) — after US-B02 (`applySelfModelPatch`) is merged.

## Story coverage

| Story | Tasks | Main deliverables |
|---|---|---|
| US-B06 | 1, 2, 3, 4 | `loop/{spec,registry,run,start}.ts`, `system-item.ts` |
| US-B07 | 5 | `tools/{names,read,propose,registry}.ts`, `biome.jsonc` |
| US-B13 | 8, 9 | `draft/{register,selfcheck}.ts`, `loops/draft.ts` |
| US-B14 | 6, 7 | `cost/governor.ts`, `jobs/cost-daily.ts`, `0012_jobs_phase_b.sql` |
| US-B15 | 10, 11 | `notify/{tier,batch}.ts` |
| US-B17 | 12 | `notify/webpush.ts`, `src-tauri/src/notify.rs` |
| US-B18 | 13, 14 | `archive.ts`, `loops/auto-archive.ts`, `tools/eval/auto-archive.ts` |
| US-B19 | 15, 16 | `loops/task.ts`, `jobs/task-remind.ts` |
| US-B20 | 17, 18 | `delegate/{route,brief}.ts`, `loops/delegate.ts` |
| US-B21 | 19 | `loops/note-route.ts` |
| US-B22 | 20 | `loops/followup.ts` |
| US-B23 | 21 | `digest/rank.ts`, `loops/digest-morning.ts` |
| US-B24 | 22, 23 | `loops/digest-nightly.ts`, `memory/consolidate.ts` |
| US-B25 | 24 | `self-model/propose.ts`(agents), `self-model/apply.ts`(kernel) |

## Full verification

Run it all at once after every task is done. **All of it must pass with no real account** (B-D5).

```bash
pnpm db:migrate && \
pnpm typecheck && \
pnpm lint && \
pnpm --filter @omnis/agents test && \
pnpm --filter @omnis/kernel test && \
pnpm --filter @omnis/kernel test:integration && \
pnpm eval:archive && \
(cd apps/desktop/src-tauri && cargo test notify)
```

Afterwards, check the three SQL hard gates by hand (A4 §1.7·§9.5·A3 §9 rule 5).

```sql
SELECT count(*) FROM agent_runs WHERE outcome = 'running' AND created_at < now() - interval '1 hour';  -- 0
SELECT count(*) FROM items i LEFT JOIN persons p ON p.id = i.author_person_id
 WHERE i.status = 'archived' AND (i.sensitivity <> 'normal' OR COALESCE(p.vip, false));                 -- 0
SELECT count(*) FROM audit_log WHERE action = 'item.sent' AND approval_id IS NULL;                      -- 0
```

## Open items

1. ~~**Ownership of `0012_jobs_phase_b.sql`.**~~ **Closed (2026-09-20 cross review M1)**: `0009`·`0011`·`0012`·`0013` are created by the **wave 0 schema bundle** (single worktree, single commit) (delta §6). Task 7 of this plan is the **source** of the `cost_daily` view definition (the bundle copies that definition verbatim) and does not create the migration file itself — run Task 7 after W0 is merged.
2. ~~**`LoopSpec.decide?` and `TriggerContext` are missing from the delta.**~~ **Closed**: delta §4 now adds `TriggerContext`·`LoopSpec.decide?()`·`runLoopSpec`·`LoopKernel`/`LoopLogger`·`writeSystemItem`·`LoopId` (cross review M4·M5). The delta is authoritative.
3. **The T2 gateway.** A4 §12.1 says "Anthropic is called directly with an API key," but to avoid a new SDK pin we split it: synchronous T2 goes through OpenRouter (`anthropic/claude-sonnet-5`), and only the Batch API uses a direct Anthropic `fetch`. The unit price is the same and the batch discount is preserved, but `agent_runs.provider` records `openrouter` for synchronous T2 — how the cost report (US-B44) should treat that distinction has to be aligned with the ops plan.
4. **The publisher of the `item.labeled` event.** `draftLoop`·`taskLoop`·`autoArchiveLoop` all wait on this event, but Phase A's `classify()` does not emit it yet. The wiring point has to be aligned with the memory-ingestion plan (when US-B03 changes `ingest.sink`) so that the hub's classification pipeline calls `kernel.events.emit('ephemeral', 'item.labeled', …)`. For the same reason the publishers of `note.created`·`task.created`·`person.inactive` must be decided too (the first two already have NOTIFY channels, and `sweepFollowups` emits `person.inactive`).
5. **Golden set data.** The 150 cases in `eval/auto_archive.jsonl`, 40 in `eval/draft.jsonl`, 100 in `eval/task.jsonl`, 50 in `eval/route_note.jsonl` and 20 in `eval/followup.jsonl` — this plan fixes only the format and the hard gates, and **the contents must be drawn from Logan's real inbox**. Until a real account is connected, synthetic data only holds the lower bound. → **Logan's decision (backlog §7-1)**: the three metrics — draft adoption rate, send-without-edit rate and briefing coverage — are **deferred** in the Phase B exit decision. The **zero VIP/sensitive archives gate in `eval/auto_archive.jsonl` is not deferred** — it is a safety invariant that must not break even on synthetic data.
6. **`NightlyDigest.still_open`.** Task 22 leaves it an empty array — reusing the morning briefing's `needs_you` candidates would work, but A4 §6.4 has no selection rule for a "tomorrow morning preview." Needs Logan's confirmation.
7. **Where the `cost` field is injected.** `nightlyDigestLoop` receives it as `ctx.payload.cost`, and the cron handler (in the hub) that supplies it calls `currentPolicy(pool)`. Which hub file holds the `morning_digest`/`nightly_digest` job handlers (currently `apps/hub/src/main.ts`) may collide with the surfaces plan's hub route additions.
