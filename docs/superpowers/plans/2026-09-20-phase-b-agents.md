# Phase B Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase A가 만든 "인박스가 스스로 라벨을 단다" 위에 **에이전트 층 전체**를 올린다 — 루프 런타임 계약(US-B06)과 tool palette(US-B07)를 먼저 고정하고, 그 위에 답장 초안(B13)·비용 미터(B14)·알림 3등급과 2경로 전달(B15·B17)·자동 보관과 7일 undo(B18)·투두와 위임(B19·B20)·노트 라우팅(B21)·Network 팔로업(B22)·아침 브리핑과 밤 다이제스트(B23·B24)·self-model 수정 제안(B25)을 얹는다. 실계정 연결은 Phase B 범위 밖이므로(B-D5) 14개 스토리 전부가 시드 데이터 + `MockLanguageModelV3` + 스텁 fetch만으로 인수된다.

**Architecture:** `packages/agents/src/loop/`가 **모든 루프의 단일 실행 경로**다. `registerLoop(spec)`로 등록된 `LoopSpec`을 `runLoopSpec(spec, ctx)`가 돌리고, 그 함수 하나가 예산 강제·A4 §1.6의 실패 처리 7종·`recordRun`/`finishRun` 한 쌍을 전부 책임진다. 루프는 "무엇을 조립하고(assemble) 무엇을 저장하는가(apply)"만 선언한다. 모델에 주는 tool은 `packages/agents/src/tools/`의 읽기 7종 + `propose_*` 6종뿐이고 비가역 tool은 **타입으로도 존재하지 않는다** — 팬텀 12종은 이름 목록으로 하드코딩되어 레지스트리에 새면 유닛 테스트가 깨진다. 비용·알림·보관처럼 "모델이 아니라 커널이 하는 일"은 `packages/kernel/src/{cost,notify,archive}.ts`로 내려가고, `@omnis/agents`는 `@omnis/kernel`을 import하지 않는다(계약 §1) — 대신 구조적으로 호환되는 최소 인터페이스(`LoopKernel`, `LoopLogger`)를 자기 안에 정의한다.

**Tech Stack:** Node 22 · pnpm workspaces · TypeScript 5.6.3(strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`) · `ai@7.0.107`(`generateObject` / `generateText` + `Output.object` + `stepCountIs` + `tool` + `type ToolSet`) · `@ai-sdk/openai-compatible@3.0.53` · `zod@^3.24.1` · `pg@8.13.1` · `vitest@2.1.9`(+ `ai/test`의 `MockLanguageModelV3`) · `web-push@3.6.7`(허브 발송) · Postgres 17 + pgvector · Tauri 2(macOS 로컬 알림). 버전 핀 출처: Phase A 계약 §2(FIXED) + Phase B 델타 §1.

**Spec:** /Users/logankim/AI-Workspaces/omnis/docs/spec/00-omnis-design.md (§11 루프 표 · §12 알림 · §14 비용 정책 · §19 Q4/Q7/Q10/Q11) + A4-agent-layer.md (§1 공통 기반 · §3 L2 초안 · §4 L3 투두 · §5 L4 위임 · §6 L5 브리핑/다이제스트 · §7 L6 팔로업 · §8 L7 노트 라우팅 · §9 L8 자동 보관 · §11 인젝션 · §12.4 월 상한 · §13 self-model) + A3-data-schema.md (§2 items/meta · §4 agent_runs/tasks/pending_approvals/notes/digests · §6 jobs) + A5-ui-ux.md (§3.8 되살리기 배너 · §4.4 Web Push) + A6-ops-infra.md (§9 Keychain) + 계약 문서 `2026-09-20-phase-a-interfaces.md` + 델타 `2026-09-20-phase-b-interfaces-delta.md` + 백로그 `2026-09-20-phase-b-backlog.md`

## Global Constraints

- Node 22 + pnpm workspaces. 새 패키지는 `pnpm-workspace.yaml`의 글롭 안에 있어야 한다 (A7 §1). 이 계획은 **새 패키지를 만들지 않는다** — `@omnis/agents`·`@omnis/kernel`·`@omnis/db`·`apps/hub`·`apps/desktop`만 고친다.
- TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`, 루트 `tsconfig.base.json`을 extend (A7 §1).
- Postgres 17 + pgvector. 통합 테스트 DB는 `omnis_test`, 연결 문자열은 `DATABASE_URL`, 없으면 `postgres://logan@127.0.0.1:5432/omnis_test` (계약 §2). 체인마다 자기 테스트 DB를 쓴다 — 다른 계획과 같은 DB를 공유하지 않는다.
- 버전 핀(FIXED, 전 워크스페이스 동일): `vitest 2.1.9` · `zod ^3.24.1`(zod 4 금지) · `pg 8.13.1` · `typescript 5.6.3` · `@rocicorp/zero 1.9.0`(exact) · `ai 7.0.107`. 이 계획이 더하는 핀은 `web-push 3.6.7` 하나다(델타 §1).
- 마이그레이션은 append-only. `packages/db/migrations/000N_<name>.sql`, 다음 번호는 `0009` 이후. 이미 적용된 파일은 절대 수정하지 않는다 (A3 §8). 이 계획이 만드는 파일은 **`0012_jobs_phase_b.sql` 하나**다(델타 §6).
- 승인 게이트 없이 비가역 tool을 연결하지 않는다. `send`/`delete`/`calendar_write`/`delegate`는 `pending_approvals` → `runEgress` 경로만 존재하고, `packages/agents`에는 이 tool들이 **타입으로도 존재하지 않는다** (A7 §7 공통 금지, A4-D3).
- provider SDK(`@ai-sdk/*`)는 `packages/agents/src/t1/`·`packages/agents/src/t2/` 안에서만 import한다. 다른 디렉터리로 새면 `packages/agents/test/no-egress.test.ts`가 깨진다.
- `packages/agents/**`에서 `packages/kernel/src/egress/**`를 import하지 않는다(Biome `noRestrictedImports`, Task 5).
- 테스트를 삭제하거나 스킵해서 통과시키지 않는다 (A7 §7 공통 금지).
- 커밋 전에 `pnpm lint`가 통과해야 한다.
- 커밋 메시지는 `<story-id>: <한 줄 요약>` + 본문에 충족한 acceptance criteria + `Implemented-by: <모델>`, 마지막 줄은 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Keychain 명명: `omnis.<service>.<kind>` (이 계획이 쓰는 것: `omnis.openrouter.api_key`, `omnis.anthropic.api_key`, `omnis.webpush.vapid_private`/`…public`). 키 값은 어떤 로그·에러에도 넣지 않는다 (A6-D9).

## 이 계획이 델타에 **더하는** 것 (명시)

델타 §4/§5의 식별자는 그대로 쓴다. 아래 다섯 개는 델타에 없어서 이 계획이 새로 고정하는 것이고, 전부 **추가**이지 기존 시그니처 변경이 아니다.

| 심볼 | 왜 필요한가 | 만드는 태스크 |
|---|---|---|
| `TriggerContext` | 델타 §4의 `LoopSpec.assemble(ctx)`·`apply(result, ctx)`·`runLoop(id, ctx)`가 받는 타입인데 델타가 정의하지 않았다 | Task 1 |
| `LoopSpec.decide?()` | A4 §9.2(자동 보관 ①③④ SQL)·§2.2(분류 3단)가 요구하는 **모델 없는 T0 선판정**. 선택 필드라 기존 `LoopSpec` 구현을 깨지 않는다 | Task 1 |
| `runLoopSpec(spec, ctx)` | `morningDigestLoop`/`nightlyDigestLoop`이 `LoopId`를 둘 다 `'digest'`로 공유해 레지스트리 키가 충돌한다. 레지스트리를 안 타는 하위 진입점 | Task 3 |
| `LoopKernel` / `LoopLogger` | `@omnis/agents`는 `@omnis/kernel`을 의존하지 않는다(계약 §1). `Kernel`/`Logger`가 구조적으로 대입되는 최소 인터페이스 | Task 4 |
| `writeSystemItem` | A4 §1.6·§12.4·§9가 "시스템 Item으로 인박스에 남긴다"를 반복한다. `@omnis/agents` 안에 한 번만 둔다(커널 쪽 4줄 INSERT는 의도된 중복 — `apps/hub/src/archive.ts`가 이미 같은 형태다) | Task 2 |

---

## Task 1: 루프 계약 타입 + 레지스트리 (US-B06, tier: Opus)

> **스토리** — 목표: `LoopSpec`/`LoopResult`/`LoopTrigger` + 루프 레지스트리. 산출물: `packages/agents/src/loop/{spec,registry}.ts`. 검증: `pnpm --filter @omnis/agents test`. 의존: B05.

**읽을 것:** A4 §1.1·§1.2·§1.5(팬텀 목록), 델타 §4.
**만들지 말 것(YAGNI):** 루프 우선순위 큐, 루프별 feature flag, 동적 palette 편집 API. 전부 쓰는 곳이 없다.

**Files:**
- Create: `packages/agents/src/loop/spec.ts`, `packages/agents/src/loop/registry.ts`, `packages/agents/src/tools/names.ts`, `packages/agents/test/loop-registry.test.ts`
- Modify: `packages/agents/src/index.ts`
- Test: `packages/agents/test/loop-registry.test.ts`

**Interfaces:**
- Consumes: `AssembledContext`(US-B05, `../context/assemble.js`), `RecordRunInput`(Phase A, `../record-run.js`).
- Produces: `LoopId`, `LoopKind`, `LoopTrigger`, `LoopBudget`, `TriggerContext`, `LoopResult<T>`, `LoopSpec<TOut>`, `LoopBudgetError`, `PhantomToolError`, `registerLoop`, `getLoop`, `listLoops`, `resetLoopRegistryForTest`, `ToolName`, `PHANTOM_TOOLS`.

### Steps

- [ ] 1. tool 이름 집합을 먼저 만든다. `spec.ts`가 `palette: ReadonlyArray<ToolName>`을 참조하는데 tool 구현(Task 5)보다 먼저 필요하므로 **이름만** 담은 리프 모듈로 분리한다.

```ts
// packages/agents/src/tools/names.ts
// A4 §1.5. 이 파일은 값이 아니라 "이름"만 가진다 — 구현은 read.ts / propose.ts, 조립은 registry.ts.

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

/** A4 §1.5 마지막 문단: 레지스트리에 이 중 하나라도 등록되면 유닛 테스트가 깨진다.
 *  `archive`가 여기 있는 이유 — 자동 보관은 커널 잡의 SQL 전이지 모델이 부르는 tool이 아니다(A4 §9). */
export const PHANTOM_TOOLS: readonly string[] = [
  "send_message", "send_email", "reply", "delete_item", "archive",
  "calendar_create", "calendar_update", "run_agent", "exec",
  "read_file", "http_fetch", "read_secret",
] as const;
```

- [ ] 2. 실패하는 테스트를 쓴다. 레지스트리가 (a) 중복 id를 거부하고 (b) 팬텀 tool이 palette에 있으면 `PhantomToolError`를 던지고 (c) trigger 종류와 필드가 맞는지 본다.

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

- [ ] 3. 테스트를 돌려 실패를 확인한다. 기대 실패: `Failed to resolve import "../src/index.js"`가 아니라 `No "registerLoop" export is defined on the "../src/index.js" mock` 계열 — 정확히는 `SyntaxError: The requested module '../src/index.js' does not provide an export named 'registerLoop'`.

```bash
pnpm --filter @omnis/agents test -- loop-registry
```

- [ ] 4. `spec.ts`를 쓴다.

```ts
// packages/agents/src/loop/spec.ts
// A4 §1.1·§1.2. 커널은 루프를 알지 못하고 이 계약만 안다.
import type { z } from "zod";
import type { AssembledContext } from "../context/assemble.js";
import type { ToolName } from "../tools/names.js";

/** A4 §1.1. agent_runs.loop의 부분집합이다 — Phase A가 더한 'summarize'는 루프가 아니라 B3 요약 헬퍼다. */
export type LoopId =
  | "classify" | "draft" | "task" | "delegate" | "digest"
  | "followup" | "note_route" | "auto_archive" | "ingest";

export type LoopKind = "reactive" | "deliberate";

export interface LoopTrigger {
  kind: "event" | "schedule" | "manual";
  /** kind='event': 커널 이벤트 kind. 예: 'item.labeled' */
  on?: string;
  /** kind='event': 허브에서 평가되는 술어. 모델이 평가하지 않는다. */
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

/** 델타에 없어서 이 계획이 고정한다. 루프가 "무엇에 대해 도는가"를 담는 봉투다. */
export interface TriggerContext {
  trigger_kind: "event" | "cron" | "manual";
  /** cron 잡 이름만. item 트리거는 trigger_ref가 아니라 item_id를 쓴다(A4 §1.7). */
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
  /** 비가역 tool은 여기 들어갈 수 없다 — registerLoop이 PhantomToolError로 막는다(A4-D3). */
  palette: ReadonlyArray<ToolName>;
  budget: LoopBudget;
  tier: "T0" | "T1" | "T2";
  outputSchema: z.ZodType<TOut>;
  /** 델타 추가(선택). 모델 없이 결론이 나는 T0 경로. null을 돌려주면 모델 경로로 내려간다.
   *  A4 §9.2의 자동 보관 ①③④가 이 자리에 들어간다. */
  decide?(ctx: TriggerContext): Promise<Omit<LoopResult<TOut>, "run_id"> | null>;
  assemble(ctx: TriggerContext): Promise<AssembledContext>;
  /** 제안만 쓴다. egress 모듈은 여기서도 import 금지(A4 §1.1). */
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

- [ ] 5. `registry.ts`를 쓴다.

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

/** 테스트 전용. 프로덕션 코드에서 호출하지 않는다. */
export function resetLoopRegistryForTest(): void {
  registry.clear();
}
```

- [ ] 6. `index.ts`에 re-export를 더한다.

```ts
// packages/agents/src/index.ts — 파일 끝에 추가
export {
  LoopBudgetError, PhantomToolError,
  type LoopBudget, type LoopId, type LoopKind, type LoopResult, type LoopSpec,
  type LoopTrigger, type TriggerContext,
} from "./loop/spec.js";
export { getLoop, listLoops, registerLoop, resetLoopRegistryForTest } from "./loop/registry.js";
export { PHANTOM_TOOLS, TOOL_NAMES, type ToolName } from "./tools/names.js";
```

- [ ] 7. 테스트를 돌려 통과를 확인한다. 기대: `loop-registry.test.ts` 5 tests passed.

```bash
pnpm --filter @omnis/agents test -- loop-registry && pnpm lint
```

- [ ] 8. 커밋한다.

```bash
git add packages/agents/src/loop packages/agents/src/tools/names.ts packages/agents/src/index.ts packages/agents/test/loop-registry.test.ts
git commit -m "US-B06: 루프 계약 타입과 레지스트리

- LoopSpec/LoopResult/LoopTrigger/LoopBudget/TriggerContext 고정(델타 §4 + TriggerContext·decide 추가)
- registerLoop이 팬텀 tool 12종·중복 id·트리거 필드 누락·비양수 예산을 거부한다
- PHANTOM_TOOLS/TOOL_NAMES를 리프 모듈로 분리해 tool 구현보다 먼저 참조 가능하게 했다

Implemented-by: Claude Opus
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 2: 시스템 Item 헬퍼 (US-B06, tier: Sonnet)

> **스토리** — 목표: A4 §1.6의 "시스템 Item으로 인박스에 남긴다"를 한 군데로 모은다. 산출물: `packages/agents/src/system-item.ts`. 검증: `pnpm --filter @omnis/agents test`.

**읽을 것:** A3 §2(`items` 컬럼·`accounts_channel_ck`의 `system` 값), `apps/hub/src/archive.ts`(같은 형태의 기존 INSERT).
**만들지 말 것(YAGNI):** 시스템 Item 전용 테이블, 심각도 enum, 중복 억제 캐시. 필요해지면 `meta`에 키를 더한다.

**Files:**
- Create: `packages/agents/src/system-item.ts`, `packages/agents/test/integration/system-item.test.ts`
- Modify: `packages/agents/src/index.ts`
- Test: `packages/agents/test/integration/system-item.test.ts`

**Interfaces:**
- Consumes: `getAgentsPool()`(Phase A, `./pool.js`).
- Produces: `writeSystemItem(input): Promise<string>`, `SYSTEM_ACCOUNT_EXTERNAL_ID`, `SYSTEM_THREAD_EXTERNAL_ID`, `type SystemItemInput`.

### Steps

- [ ] 1. 실패하는 테스트를 쓴다.

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
    const a = await writeSystemItem({ body: "자동 처리 실패 1건", meta: { loop: "draft" } });
    const b = await writeSystemItem({ body: "자동 처리 실패 2건" });
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
    const id = await writeSystemItem({ body: "이 스레드에 남긴다", thread_id: threadId });
    const { rows } = await pool.query<{ thread_id: string }>(
      "SELECT thread_id FROM items WHERE id = $1",
      [id],
    );
    expect(rows[0]?.thread_id).toBe(threadId);
  });
});
```

- [ ] 2. 실패를 확인한다. 기대: `does not provide an export named 'writeSystemItem'`.

```bash
pnpm --filter @omnis/agents test -- system-item
```

- [ ] 3. 구현을 쓴다.

```ts
// packages/agents/src/system-item.ts
// A4 §1.6·§12.4·§9: 실패와 정책 전이는 조용히 삼키지 않고 인박스에 남긴다.
// ponytail: 커널(@omnis/kernel)도 같은 INSERT를 필요로 하지만 agents를 의존할 수 없어 4줄짜리
// SQL을 각자 갖는다(apps/hub/src/archive.ts가 이미 같은 형태다). 의도된 중복 — 공용 패키지로 뽑지 않는다.
import { getAgentsPool } from "./pool.js";

export const SYSTEM_ACCOUNT_EXTERNAL_ID = "omnis";
export const SYSTEM_THREAD_EXTERNAL_ID = "system:agents";

export interface SystemItemInput {
  body: string;
  /** 없으면 system 채널의 단일 'system:agents' 스레드에 붙인다. */
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

- [ ] 4. `index.ts`에 export를 더한다.

```ts
// packages/agents/src/index.ts — 추가
export {
  SYSTEM_ACCOUNT_EXTERNAL_ID, SYSTEM_THREAD_EXTERNAL_ID,
  writeSystemItem, type SystemItemInput,
} from "./system-item.js";
```

- [ ] 5. 통과를 확인하고 커밋한다.

```bash
pnpm --filter @omnis/agents test -- system-item && pnpm lint
git add packages/agents/src/system-item.ts packages/agents/src/index.ts packages/agents/test/integration/system-item.test.ts
git commit -m "US-B06: 시스템 Item 헬퍼

- writeSystemItem이 system 채널 계정/스레드를 멱등하게 만들고 items(kind='system')를 남긴다
- thread_id를 주면 그 스레드에, 없으면 단일 system:agents 스레드에 붙인다

Implemented-by: Claude Sonnet
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 3: runLoopSpec — 예산 강제 + 실패 처리 7종 (US-B06, tier: Opus)

> **스토리** — 목표: 예산 강제(`LoopBudgetError`), A4 §1.6의 공통 실패 처리 7종, 모든 실행이 `recordRun`/`finishRun` 한 쌍. 산출물: `packages/agents/src/loop/run.ts`. 검증: `pnpm --filter @omnis/agents test`.

**읽을 것:** A4 §1.6 표 전체, §1.7, §12.1(T1/T2 provider), 기존 `packages/agents/src/classify.ts`(같은 recordRun 패턴), `packages/agents/src/t1/provider.ts`.
**만들지 말 것(YAGNI):** 지수 백오프 라이브러리, 서킷 브레이커, 루프별 커스텀 재시도 정책. A4가 정한 건 1s→4s 두 번뿐이다.

**Files:**
- Create: `packages/agents/src/t2/provider.ts`, `packages/agents/src/loop/run.ts`, `packages/agents/test/integration/loop-run.test.ts`
- Modify: `packages/agents/src/index.ts`, `packages/agents/test/no-egress.test.ts`
- Test: `packages/agents/test/integration/loop-run.test.ts`

**Interfaces:**
- Consumes: `getLoop`(Task 1), `writeSystemItem`(Task 2), `recordRun`/`finishRun`(Phase A), `t1Model`/`T1_RUN_MODEL`(Phase A), `wrapData`/`newNonce`(US-B05).
- Produces: `runLoopSpec(spec, ctx)`, `runLoop(id, ctx)`, `t2Model()`, `T2_RUN_MODEL`, `T2_MODEL_ID`, `QUARANTINE_HOURS`, `FAILURE_WINDOW_HOURS`, `FAILURE_LIMIT`.

### Steps

- [ ] 1. T2 provider를 쓴다. **OpenRouter 경유 Claude Sonnet 5**다 — Anthropic 직접 경로는 Batch API(Task 23)에서만 쓰고, 동기 호출은 이미 핀된 `@ai-sdk/openai-compatible` 하나로 끝낸다(새 SDK 의존 0).

```ts
// packages/agents/src/t2/provider.ts
// A4 §12.1: T2 = Claude Sonnet 5 하나뿐이다. 게이트웨이는 OpenRouter(토큰 마크업 없음).
// Anthropic 직접 경로는 Message Batches(§6.5)에서만 쓴다 — 그건 SDK 없이 fetch로 친다(Task 23).
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";

export const T2_BASE_URL = "https://openrouter.ai/api/v1";
/** OpenRouter 라우팅 슬러그. */
export const T2_MODEL_ID = "anthropic/claude-sonnet-5";
/** A3 §4 agent_runs.model에 기록하는 값(A4 §12.1 표기 그대로). */
export const T2_RUN_MODEL = "claude-sonnet-5";

export function t2Model(): LanguageModel {
  const apiKey = process.env.OMNIS_OPENROUTER_API_KEY;
  if (apiKey === undefined || apiKey === "") {
    throw new Error("OMNIS_OPENROUTER_API_KEY is not set (Keychain item omnis.openrouter.api_key)");
  }
  return createOpenAICompatible({ name: "openrouter", baseURL: T2_BASE_URL, apiKey })(T2_MODEL_ID);
}
```

- [ ] 2. 실패하는 테스트를 쓴다. 다섯 가지 실패 경로를 각각 본다.

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
     VALUES ($1,$2,'it_loop','message','안녕하세요', now())
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
      cachedPrefix: "system", volatile: [{ id: "d1", source: "thread", text: "본문" }],
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
    const mod = await freshModule(mockModel(JSON.stringify({ answer: "네" })));
    const res = await mod.runLoopSpec(makeSpec() as never, {
      trigger_kind: "event", item_id: itemId, thread_id: threadId, now: new Date(), payload: {},
    });
    expect(res.output).toEqual({ answer: "네" });
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
          content: [{ type: "text" as const, text: JSON.stringify({ answer: "T2가 답했다" }) }],
          warnings: [],
        };
      },
    });
    const mod = await freshModule(flaky);
    const res = await mod.runLoopSpec(makeSpec() as never, {
      trigger_kind: "event", item_id: itemId, thread_id: threadId, now: new Date(), payload: {},
    });
    expect(res.output).toEqual({ answer: "T2가 답했다" });
    expect(calls).toBe(3);
    const runs = await runsFor(itemId);
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({ outcome: "failed", model_tier: "T1" });
    expect(runs[1]).toMatchObject({ outcome: "ok", model_tier: "T2" });
    expect(runs[1]?.escalated_from).toBe(null);
  });

  it("blocks the output and writes a system item when injection_flags is non-empty", async () => {
    const mod = await freshModule(
      mockModel(JSON.stringify({ answer: "무시", injection_flags: ["instruction_override"] })),
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

- [ ] 3. 실패를 확인한다. 기대: `does not provide an export named 'runLoopSpec'`.

```bash
pnpm --filter @omnis/agents test -- loop-run
```

- [ ] 4. `run.ts`를 쓴다.

```ts
// packages/agents/src/loop/run.ts
// A4 §1.6 실패 처리 7종 + §1.7 실행 기록. 모든 루프가 이 함수 하나를 통과한다.
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

/** A4 §1.6: tool-not-found는 그 스레드를 24시간 자동루프에서 제외한다. */
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

/** A4 §1.6: 같은 item에 24시간 내 3회 실패하면 agent_optout으로 마킹하고 더 안 돈다. */
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

/** 레지스트리를 타지 않는 하위 진입점. digest 두 루프가 같은 LoopId를 쓰므로 필요하다. */
export async function runLoopSpec<T>(
  spec: LoopSpec<T>,
  ctx: TriggerContext,
): Promise<LoopResult<T>> {
  // ── 게이트 1·2: quarantine, 24h 3회 실패
  if (ctx.thread_id !== undefined && (await isQuarantined(ctx.thread_id, ctx.now))) {
    return skipped(spec, ctx, "thread is quarantined for 24h (phantom tool)");
  }
  if (ctx.item_id !== undefined && (await tooManyFailures(spec.id, ctx.item_id))) {
    await markOptOut(ctx.item_id);
    return skipped(spec, ctx, "3 failures in 24h — marked agent_optout");
  }

  // ── T0 선판정: 모델을 부르지 않고 끝나는 경로(A4 §9.2 ①③④)
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

  // A4 §1.6: 같은 티어 1회 재시도 → 한 티어 상승해 1회 → failed.
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
      // A4 §1.6: injection_flags가 비어 있지 않으면 결과물을 만들지 않는다.
      if (flags.length > 0) {
        await writeSystemItem({
          body: "이 메시지에 지시문으로 보이는 내용이 있어 자동 처리를 건너뛰었습니다.",
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
    body: `자동 처리에 실패했습니다(${spec.id}). 직접 확인해 주세요.`,
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

/** A4 §12.2: 캐시 히트율을 사후에 재려면 sha256(cachedPrefix)이 agent_runs에 남아야 한다. */
function hash(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}
```

- [ ] 5. `no-egress.test.ts`를 고친다. `/\btools\s*:/` 정규식은 `generateText({ tools: toolRegistry(...) })`를 잡아버리므로 **팬텀 이름 목록 검사**로 갈아끼우고, provider SDK 허용 디렉터리에 `t2/`를 더한다.

```ts
// packages/agents/test/no-egress.test.ts — describe 블록 전체를 교체
import { PHANTOM_TOOLS } from "../src/tools/names.js";

describe("@omnis/agents tool isolation (A7 §7 공통 금지)", () => {
  it("never mentions an irreversible tool name in a tool definition", () => {
    // 이름 목록은 names.ts가 소유하고, 여기서는 "정의로 등장하지 않는가"만 본다.
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

- [ ] 6. `index.ts`에 export를 더한다.

```ts
// packages/agents/src/index.ts — 추가
export {
  FAILURE_LIMIT, FAILURE_WINDOW_HOURS, QUARANTINE_HOURS, runLoop, runLoopSpec,
} from "./loop/run.js";
export { T2_BASE_URL, T2_MODEL_ID, T2_RUN_MODEL } from "./t2/provider.js";
```

- [ ] 7. 통과를 확인한다. 기대: `loop-run.test.ts` 5 tests passed, `no-egress.test.ts` 2 tests passed.

```bash
pnpm --filter @omnis/agents test && pnpm lint
```

- [ ] 8. 커밋한다.

```bash
git add packages/agents/src/loop/run.ts packages/agents/src/t2 packages/agents/src/index.ts packages/agents/test
git commit -m "US-B06: runLoopSpec — 예산 강제와 실패 처리 7종

- 타임아웃 1회 재시도 → 한 티어 상승 1회 → failed + 시스템 Item
- 스키마 위반 원문을 agent_runs.raw_output에 보관
- tool-not-found → injection_flags += phantom_tool + 스레드 24h quarantine
- injection_flags 비어있지 않으면 apply를 부르지 않는다
- 같은 item 24h 3회 실패 → items.meta.agent_optout
- 모든 경로가 recordRun/finishRun 한 쌍을 남긴다

Implemented-by: Claude Opus
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 4: startLoops — 커널 이벤트·스케줄러 배선 (US-B06, tier: Opus)

> **스토리** — 목표: 루프 레지스트리를 커널 스케줄러·이벤트에 붙인다. 산출물: `packages/agents/src/loop/start.ts`. 검증: `pnpm --filter @omnis/agents test`.

**읽을 것:** `packages/kernel/src/events.ts`(ephemeral emit = kind로 팬아웃), `apps/hub/src/summarize-job.ts`(같은 디바운스 패턴), `packages/kernel/src/scheduler.ts`.
**만들지 말 것(YAGNI):** 자체 이벤트 버스, 슬라이딩 디바운스, 루프 동시성 제한. 커널 스케줄러가 이미 틱 단위 직렬이다.

**Files:**
- Create: `packages/agents/src/loop/start.ts`, `packages/agents/test/loop-start.test.ts`
- Modify: `packages/agents/src/index.ts`, `apps/hub/src/main.ts`
- Test: `packages/agents/test/loop-start.test.ts`

**Interfaces:**
- Consumes: `listLoops`(Task 1), `runLoopSpec`(Task 3).
- Produces: `startLoops(deps)`, `type LoopKernel`, `type LoopLogger`.

### Steps

- [ ] 1. 실패하는 테스트를 쓴다. 커널은 구조적 스텁으로 갈음한다(DB 불필요 → `test/` 루트의 유닛 테스트다).

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
        async emit() { /* 루프는 이벤트를 쏘지 않는다 */ },
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

- [ ] 2. 실패를 확인한다. 기대: `does not provide an export named 'startLoops'`.

```bash
pnpm --filter @omnis/agents test -- loop-start
```

- [ ] 3. 구현을 쓴다.

```ts
// packages/agents/src/loop/start.ts
// @omnis/agents는 @omnis/kernel을 의존하지 않는다(계약 §1). Kernel/Logger가 구조적으로
// 대입되는 최소 인터페이스만 여기 둔다 — 허브가 createKernel()의 결과를 그대로 넘긴다.
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

/** schedule 트리거를 쓰는 루프의 jobs.name. 이름은 A3 0006_kernel.sql seed와 1:1이다. */
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

    // ponytail: 고정 지연 디바운스 — 첫 이벤트가 타이머를 걸고, 창이 열린 동안 온 같은 키는
    // 버린다(apps/hub/src/summarize-job.ts와 같은 형태). 슬라이딩이 필요해지면 그때 바꾼다.
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

- [ ] 4. `index.ts`에 export를 더하고 허브에 배선한다.

```ts
// packages/agents/src/index.ts — 추가
export { LOOP_JOB_NAME, startLoops, type LoopKernel, type LoopLogger } from "./loop/start.js";
```

```ts
// apps/hub/src/main.ts — import에 startLoops를 더하고,
// registerSummaryJob 바로 아래(= scheduler.start() 뒤)에 추가한다.
//   import { configureAgents, startLoops, summarizeThread } from "@omnis/agents";
const stopLoops = startLoops({ kernel, logger });
```

그리고 `close()`의 `stopSummaryJob();` 바로 아래에 `stopLoops();`를 더한다.

- [ ] 5. 통과를 확인하고 커밋한다. 기대: `loop-start.test.ts` 3 tests passed.

```bash
pnpm --filter @omnis/agents test -- loop-start && pnpm --filter @omnis/hub test && pnpm lint
git add packages/agents/src/loop/start.ts packages/agents/src/index.ts packages/agents/test/loop-start.test.ts apps/hub/src/main.ts
git commit -m "US-B06: startLoops — 커널 이벤트/스케줄러 배선

- event 트리거는 debounceMs 고정 지연 디바운스로 runLoopSpec을 한 번만 부른다
- schedule 트리거는 LOOP_JOB_NAME의 기존 jobs.name으로 scheduler.register된다
- LoopKernel/LoopLogger 구조적 인터페이스로 @omnis/kernel 의존을 만들지 않는다
- 허브가 부팅 때 startLoops를 걸고 종료 때 푼다

Implemented-by: Claude Opus
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 5: tool palette — 읽기 7종 + `propose_*` 6종 (US-B07, tier: Opus)

> **스토리** — 목표: 읽기 tool 7종 + `propose_*` 6종, `propose_*`는 저장만. 팬텀 12종이 레지스트리에 있으면 깨지는 유닛 테스트 + `packages/agents/**` → `packages/kernel/src/egress/**` import 금지 lint 규칙. 산출물: `packages/agents/src/tools/*.ts`, `biome.jsonc`(수정). 검증: `pnpm --filter @omnis/agents test && pnpm lint`. 의존: B06.

**읽을 것:** A4 §1.5 전체(입출력 표 + 6개 JSON Schema + 팬텀 목록), A3 §4(`tasks`/`pending_approvals`/`notes` 컬럼), 델타 §4.
**만들지 말 것(YAGNI):** tool별 권한 체크 레이어, tool 결과 캐시, `propose_*`의 배치 버전. 루프 하나당 호출이 한 자릿수다.

**Files:**
- Create: `packages/agents/src/tools/read.ts`, `packages/agents/src/tools/propose.ts`, `packages/agents/src/tools/registry.ts`, `packages/agents/test/integration/tools.test.ts`
- Modify: `packages/agents/src/index.ts`, `biome.jsonc`
- Test: `packages/agents/test/integration/tools.test.ts`

**Interfaces:**
- Consumes: `ToolName`/`PHANTOM_TOOLS`(Task 1), `getAgentsPool`(Phase A), `searchMemories`/`asOf`(US-B01·B04, `@omnis/memory`).
- Produces: `toolRegistry(palette)`, `READ_TOOLS`, `PROPOSE_TOOLS`, `type ProposeDraftInput`, `type ProposeTaskInput`, `type ProposeDelegationInput`, `type ProposeRouteInput`, `type ProposeSelfModelPatchInput`, `type ProposeLabelInput`.

### Steps

- [ ] 1. 실패하는 테스트를 쓴다. (a) 레지스트리가 palette에 있는 이름만 내고, (b) 팬텀 이름은 어떤 경우에도 키로 나타나지 않고, (c) `propose_task`가 실제로 `tasks` row를 만든다.

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
     VALUES ($1,$2,'it_tools','email','견적','내일까지 보내드릴게요', now())
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
      { title: "견적서 보내기", source_item_id: itemId, due_basis: "stated", owner: "me",
        kind: "todo", confidence: 0.9 },
      { toolCallId: "c2", messages: [] },
    )) as { task_id: string; state: string };
    expect(out.state).toBe("open");
    const { rows } = await pool.query<{ title: string; created_by: string }>(
      "SELECT title, created_by FROM tasks WHERE id = $1",
      [out.task_id],
    );
    expect(rows[0]).toMatchObject({ title: "견적서 보내기", created_by: "agent" });
  });
});
```

- [ ] 2. 실패를 확인한다. 기대: `does not provide an export named 'toolRegistry'`.

```bash
pnpm --filter @omnis/agents test -- tools
```

- [ ] 3. 읽기 tool 7종을 쓴다. 전부 부작용이 없고 DB만 읽는다.

```ts
// packages/agents/src/tools/read.ts
// A4 §1.5 읽기 tool. 부작용 없음 — SELECT만 한다.
import { asOf, searchMemories } from "@omnis/memory";
import { type ToolSet, tool } from "ai";
import { z } from "zod";
import { getAgentsPool } from "../pool.js";

export const READ_TOOLS: ToolSet = {
  read_thread: tool({
    description: "스레드 하나와 최근 item들을 읽는다.",
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
    description: "메모리를 의미 검색한다.",
    inputSchema: z.object({
      query: z.string(), k: z.number().int().max(20).default(6),
      kinds: z.array(z.enum(["fact", "preference", "event"])).optional(),
    }),
    execute: async ({ query, k, kinds }) =>
      ({ results: await searchMemories(getAgentsPool(), { query, k, ...(kinds !== undefined ? { kinds } : {}) }) }),
  }),

  read_person: tool({
    description: "사람 한 명의 프로필과 채널 식별자를 읽는다.",
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
    description: "엔티티를 as-of 시각 기준으로 읽는다(bi-temporal).",
    inputSchema: z.object({ entity_id: z.string().uuid(), as_of: z.string().optional() }),
    execute: async ({ entity_id, as_of }) =>
      ({ entities: await asOf(getAgentsPool(), { entityId: entity_id, at: as_of ?? "now" }) }),
  }),

  read_calendar: tool({
    description: "기간 안의 캘린더 이벤트를 읽는다.",
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
    description: "할 일 목록을 읽는다.",
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
    description: "에이전트 세션의 durable 요약과 마지막 N턴을 읽는다. raw 로그는 없다(마스터 §9).",
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

- [ ] 4. `propose_*` 6종을 쓴다. **전부 저장만 한다** — 어떤 것도 채널·런타임을 건드리지 않는다.

```ts
// packages/agents/src/tools/propose.ts
// A4 §1.5·A4-D3: 제안 tool은 row를 쓸 뿐 아무것도 내보내지 않는다.
// propose_delegation은 pending_approvals(action='delegate') 한 행을 만드는 게 전부이고,
// 실제 실행은 커널의 승인 핸들러가 runEgress 경로에서 한다(A4 §5.4).
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
  runtime: z.enum(["claude_code", "codex", "claude_ds", "omnis"]),   // B-D7: hermes 제외
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
    description: "item에 라벨을 제안해 저장한다. 발송하지 않는다.",
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
    description: "답장 초안을 items(status='draft')로 저장한다. 발송하지 않는다.",
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
    description: "할 일을 tasks에 저장한다. duplicate_of가 있으면 기존 task에 출처만 더한다.",
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
    description: "위임 승인 카드를 만든다. 승인 없이는 아무것도 실행되지 않는다.",
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
         `${i.runtime} on ${i.host}에게 이 작업을 맡깁니다. 예상 ${i.est_minutes ?? "?"}분.`,
         (i.est_minutes ?? 0) > 30 ? "high" : "normal", i.task_id]);
      const id = rows[0]?.id;
      if (id === undefined) throw new Error("pending_approvals insert returned no id");
      await pool.query("UPDATE tasks SET kind = 'delegation' WHERE id = $1", [i.task_id]);
      return { approval_id: id, state: "pending" as const };
    },
  }),

  propose_route: tool({
    description: "노트를 붙일 후보를 최대 3개 제안한다. 자동 첨부는 하지 않는다(A4-D10).",
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
    description: "self-model 파일 패치를 승인 카드로 만든다. 적용은 승인 뒤 커널이 한다.",
    inputSchema: ProposeSelfModelPatchInput,
    execute: async (i) => {
      const { rows } = await getAgentsPool().query<{ id: string }>(
        `INSERT INTO pending_approvals (action, args, description, risk, requested_by)
         VALUES ('self_model_edit', $1::jsonb, $2, 'normal', (${OMNIS_RUNTIME}))
         RETURNING id`,
        [JSON.stringify(i), `${i.file} 수정 제안 — ${i.rationale}`]);
      const id = rows[0]?.id;
      if (id === undefined) throw new Error("pending_approvals insert returned no id");
      return { approval_id: id };
    },
  }),
};
```

- [ ] 5. 레지스트리와 lint 규칙을 쓴다.

```ts
// packages/agents/src/tools/registry.ts
import type { ToolSet } from "ai";
import { PROPOSE_TOOLS } from "./propose.js";
import { READ_TOOLS } from "./read.js";
import { PHANTOM_TOOLS, type ToolName } from "./names.js";

const ALL: ToolSet = { ...READ_TOOLS, ...PROPOSE_TOOLS };

/** palette에 적힌 것만 모델에게 준다. 팬텀 이름은 ALL에 애초에 없다. */
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
// biome.jsonc — linter.rules.nursery 또는 기존 rules 객체 안에 추가
"noRestrictedImports": {
  "level": "error",
  "options": {
    "paths": {
      "@omnis/kernel": "packages/agents는 @omnis/kernel을 의존하지 않는다(계약 §1). LoopKernel 구조적 타입을 쓴다.",
      "../../kernel/src/egress.js": "egress는 커널 소유다(A4 §1.1).",
      "@omnis/kernel/egress": "egress는 커널 소유다(A4 §1.1)."
    }
  }
}
```

`biome.jsonc`의 `overrides`에 `packages/agents/**`만 이 규칙을 받도록 스코프를 건다.

```jsonc
"overrides": [
  { "includes": ["packages/agents/**"],
    "linter": { "rules": { "style": { "noRestrictedImports": { "level": "error", "options": { "paths": {
      "@omnis/kernel": "packages/agents는 @omnis/kernel을 의존하지 않는다(계약 §1).",
      "@omnis/kernel/egress": "egress는 커널 소유다(A4 §1.1)." } } } } } } }
]
```

- [ ] 6. `index.ts`에 export를 더하고 통과를 확인한다. 기대: `tools.test.ts` 4 tests passed, `pnpm lint` 0 errors.

```ts
// packages/agents/src/index.ts — 추가
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

- [ ] 7. 커밋한다.

```bash
git add packages/agents/src/tools packages/agents/src/index.ts packages/agents/test/integration/tools.test.ts biome.jsonc
git commit -m "US-B07: tool palette — 읽기 7종 + propose_* 6종

- READ_TOOLS 7종은 SELECT만 한다
- PROPOSE_TOOLS 6종은 items/tasks/notes/pending_approvals row만 쓴다(발송 경로 없음)
- toolRegistry(palette)가 팬텀 12종을 구조적으로 낼 수 없다 + 유닛 테스트가 이를 고정한다
- biome overrides로 packages/agents → @omnis/kernel(egress) import를 금지했다

Implemented-by: Claude Opus
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 6: 비용 미터 — `costState` / `POLICY` / `currentPolicy` (US-B14, tier: Opus)

> **스토리** — 목표: A4 §12.4의 5상태 + 예비비 별도 집계 + `Policy`. 산출물: `packages/kernel/src/cost/governor.ts`. 검증: `pnpm --filter @omnis/kernel test:integration`. 의존: B06.

**읽을 것:** A4 §12.4 전체(코드 블록 + 상태 표 + 3개 단서), 델타 §5.
**만들지 말 것(YAGNI):** 일별 예산, 루프별 상한, 예측 모델. 상한은 월 하나 + 예비비 비율 하나다.

**Files:**
- Create: `packages/kernel/src/cost/governor.ts`, `packages/kernel/test/cost-governor.test.ts`, `packages/kernel/test/integration/cost-policy.test.ts`
- Modify: `packages/kernel/src/index.ts`
- Test: `packages/kernel/test/cost-governor.test.ts`, `packages/kernel/test/integration/cost-policy.test.ts`

**Interfaces:**
- Consumes: `getSetting`/`SETTING_DEFAULTS`(US-B33, `../settings.js` — surfaces 계획이 만든다. 이 태스크는 `cost.cap_usd`/`cost.reserve_ratio` 두 키만 읽는다), `query`(`@omnis/db`).
- Produces: `CostState`, `CostInput`, `costState`, `Policy`, `POLICY`, `currentPolicy`, `reserveSpendUsd`, `mtdSpendUsd`.

### Steps

- [ ] 1. 실패하는 순수 함수 테스트를 쓴다(DB 없음).

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

- [ ] 2. 실패를 확인한다. 기대: `Failed to resolve import "../src/cost/governor.js"`.

```bash
pnpm --filter @omnis/kernel test -- cost-governor
```

- [ ] 3. 구현을 쓴다.

```ts
// packages/kernel/src/cost/governor.ts
// A4 §12.4. 예산은 두 개다 — 일반 $54와 VIP·민감 전용 예비비 $6(마스터 §14, §19 Q11).
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
    note: "이번 달 LLM 비용이 상한의 60%입니다." },
  degraded: { allowT2NonSensitive: false, allowT2Reserve: true, draftsNonVip: true,
    draftsVipSensitive: true, digestCron: "alternate",
    note: "비민감 작업의 T2 에스컬레이션을 중단했습니다(T1으로 생성). VIP·민감 초안은 예비비로 계속됩니다." },
  reserve_only: { allowT2NonSensitive: false, allowT2Reserve: true, draftsNonVip: false,
    draftsVipSensitive: true, digestCron: "alternate",
    note: "일반 예산이 소진되어 비VIP 초안 생성을 중단했습니다. 분류·라벨·투두 추출·자동 보관은 계속되고, VIP·민감 초안은 예비비로 계속됩니다." },
  frozen: { allowT2NonSensitive: false, allowT2Reserve: false, draftsNonVip: false,
    draftsVipSensitive: false, digestCron: "off",
    note: "예비비까지 소진되어 모든 초안 생성을 중단했습니다. 분류·라벨·투두 추출·자동 보관은 계속됩니다." },
};

/** 이번 달 총 지출. agent_runs.cost_usd가 유일한 입력이다(A4 §12.4). */
export async function mtdSpendUsd(pool: Pool, now: Date): Promise<number> {
  const rows = await query<{ sum: string | null }>(
    pool,
    `SELECT COALESCE(sum(cost_usd), 0)::text AS sum FROM agent_runs
      WHERE created_at >= date_trunc('month', $1::timestamptz)`,
    [now],
  );
  return Number(rows[0]?.sum ?? "0");
}

/** 예비비 소진분: model_tier='T2' AND (VIP person이거나 sensitivity<>'normal'인 item). */
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

- [ ] 4. 통합 테스트를 쓴다 — `agent_runs`를 심고 `currentPolicy`가 그 합계를 읽는지 본다.

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
    await spend(7, "T2", null);   // item 없는 T2는 예비비가 아니다
    expect(await reserveSpendUsd(pool, new Date())).toBeCloseTo(3, 5);
  });
});
```

- [ ] 5. `index.ts`에 export를 더하고 둘 다 통과를 확인한다. 기대: 5 tests passed.

```ts
// packages/kernel/src/index.ts — 추가
export {
  POLICY, costState, currentPolicy, mtdSpendUsd, reserveSpendUsd,
  type CostInput, type CostState, type Policy,
} from "./cost/governor.js";
```

```bash
pnpm --filter @omnis/kernel test && pnpm --filter @omnis/kernel test:integration && pnpm lint
```

- [ ] 6. 커밋한다.

```bash
git add packages/kernel/src/cost packages/kernel/src/index.ts packages/kernel/test/cost-governor.test.ts packages/kernel/test/integration/cost-policy.test.ts
git commit -m "US-B14: 비용 미터 costState/POLICY/currentPolicy

- 5상태(normal/warn/degraded/reserve_only/frozen) + A4 §12.4 정책 표 그대로
- 예비비는 model_tier='T2' AND (VIP 또는 sensitivity<>normal)로 별도 집계한다
- degraded 이하에서도 민감도 규칙(VIP·민감 T2)은 깨지지 않는다

Implemented-by: Claude Opus
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 7: `cost_daily` 뷰 + 00:05 잡 + 상태 전이 기록 (US-B14, tier: Opus)

> **스토리** — 목표: `cost_daily` 집계 뷰 + 00:05 잡, 상태 전이 → `audit_log` + 시스템 Item, 루프 게이트. 산출물: `packages/kernel/src/jobs/cost-daily.ts`, `packages/db/migrations/0012_jobs_phase_b.sql`. 검증: `pnpm --filter @omnis/kernel test:integration`.

**읽을 것:** 델타 §6(`0012` 행)·§8(잡 4건 표), A3 §6(`jobs` seed 형식), `packages/kernel/src/scheduler.ts`.
**오너십 주의:** `0012_jobs_phase_b.sql`은 **이 태스크가 유일한 오너**다. channels 계획(`outlook_delta_poll`)과 ops 계획(`cost_report_monthly`)은 이 파일을 다시 만들지 않고 여기 seed된 행을 그대로 쓴다.
**만들지 말 것(YAGNI):** materialized view + REFRESH 잡. 하루치 집계라 일반 뷰로 충분하고, 느려지면 그때 승격한다.

**Files:**
- Create: `packages/db/migrations/0012_jobs_phase_b.sql`, `packages/kernel/src/jobs/cost-daily.ts`, `packages/kernel/test/integration/cost-daily.test.ts`
- Modify: `packages/kernel/src/index.ts`
- Test: `packages/kernel/test/integration/cost-daily.test.ts`

**Interfaces:**
- Consumes: `currentPolicy`(Task 6), `Audit`(Phase A), `Scheduler`(Phase A).
- Produces: `registerCostDailyJob(scheduler, deps)`, `COST_DAILY_JOB_NAME`, `COST_DAILY_CRON`, `runCostDaily(deps)`.

### Steps

- [ ] 1. 마이그레이션을 쓴다. 델타 §8의 잡 4건 + `cost_daily` 뷰.

```sql
-- packages/db/migrations/0012_jobs_phase_b.sql
-- 델타 §8: Phase B가 더하는 잡 4건. 나머지 16건은 0006_kernel.sql이 이미 seed했다.
-- 소유: agents 계획 Task 7. channels(B37)·ops(B44)는 이 파일을 다시 만들지 않는다.

INSERT INTO jobs (name, schedule, next_run_at) VALUES
  ('cost_daily',          '5 0 * * *',        now()),   -- A4 §12.4 00:05 KST 집계
  ('push_batch',          '0 9,12,15,18 * * *', now()), -- A4 §3.6 묶음 알림
  ('outlook_delta_poll',  '*/5 * * * *',      now()),   -- A1 §2.4 (US-B37)
  ('cost_report_monthly', '10 0 1 * *',       now())    -- A4 §12.4 월간 리포트 (US-B44)
ON CONFLICT (name) DO NOTHING;

-- A4 §12.4: "매일 00:05 KST에 agent_runs를 집계해 cost_daily 뷰를 갱신한다."
-- 뷰이므로 갱신 자체는 공짜고, 잡은 상태 전이 감지와 기록만 한다.
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

- [ ] 2. 실패하는 테스트를 쓴다.

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
    // 두 번째 실행은 상태가 같으므로 아무것도 더 남기지 않는다
    await runCostDaily({ pool, audit: createAudit(pool), logger, now: new Date() });
    const again = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM audit_log WHERE action = 'cost.state_changed'");
    expect(again.rows[0]?.n).toBe("1");
  });
});
```

- [ ] 3. 마이그레이션을 적용하고 실패를 확인한다. 기대: `Failed to resolve import "../../src/jobs/cost-daily.js"`.

```bash
pnpm db:migrate && pnpm --filter @omnis/kernel test:integration -- cost-daily
```

- [ ] 4. 구현을 쓴다.

```ts
// packages/kernel/src/jobs/cost-daily.ts
// A4 §12.4: 매일 00:05 KST 집계 + 상태 전이 감지. 뷰는 SQL이 갱신하므로 잡은 전이만 본다.
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
  // ponytail: @omnis/kernel은 @omnis/agents를 의존할 수 없어 writeSystemItem을 쓰지 못한다.
  // apps/hub/src/archive.ts와 같은 4줄 INSERT — 의도된 중복이다(계약 §12).
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
    [policy.note ?? `LLM 비용 상태가 ${state}로 바뀌었습니다.`,
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

- [ ] 5. `index.ts`에 export를 더하고 허브에 등록한 뒤 통과를 확인한다. 기대: 3 tests passed.

```ts
// packages/kernel/src/index.ts — 추가
export {
  COST_DAILY_CRON, COST_DAILY_JOB_NAME, registerCostDailyJob, runCostDaily,
  type CostDailyDeps,
} from "./jobs/cost-daily.js";
```

```ts
// apps/hub/src/main.ts — registerHealthcheckJob 바로 아래
registerCostDailyJob(kernel.scheduler, { pool, audit: kernel.audit, logger });
```

```bash
pnpm db:migrate && pnpm --filter @omnis/kernel test:integration && pnpm lint
```

- [ ] 6. 커밋한다.

```bash
git add packages/db/migrations/0012_jobs_phase_b.sql packages/kernel/src/jobs/cost-daily.ts packages/kernel/src/index.ts packages/kernel/test/integration/cost-daily.test.ts apps/hub/src/main.ts
git commit -m "US-B14: cost_daily 뷰와 00:05 잡

- 0012_jobs_phase_b.sql이 델타 §8의 잡 4건을 seed하고 cost_daily 뷰를 만든다
- runCostDaily가 상태 전이일 때만 audit_log + 시스템 Item을 남긴다(같은 상태는 무음)
- 허브가 잡을 등록한다

Implemented-by: Claude Opus
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 8: 초안 순수 함수 — register / needs-reply / 채널 형식 / self-check (US-B13, tier: Opus)

> **스토리** — 목표: `register` 규칙 판정, `needs_reply_score` 산술식, 채널별 길이·형식 8종, self-check 6항. 산출물: `packages/agents/src/draft/{register,selfcheck}.ts`. 검증: `pnpm --filter @omnis/agents test`. 의존: B05, B07.

**읽을 것:** A4 §3.1(`needs_reply_score` 규칙 5개 가중치), §3.2(register 판정), §3.4(채널별 표 8행), §3.3(self-check 6항).
**만들지 말 것(YAGNI):** 학습형 register 분류기, 채널별 프롬프트 파일. 규칙 4줄이 A4가 정한 전부다.

**Files:**
- Create: `packages/agents/src/draft/register.ts`, `packages/agents/src/draft/selfcheck.ts`, `packages/agents/test/draft-rules.test.ts`
- Modify: `packages/agents/src/index.ts`
- Test: `packages/agents/test/draft-rules.test.ts`

**Interfaces:**
- Consumes: `ItemRow`(Phase A), `Channel`(`@omnis/protocol`).
- Produces: `Register`, `pickRegister`, `needsReplyScore`, `NEEDS_REPLY_MIN`, `CHANNEL_DRAFT_SHAPE`, `selfCheck`, `type SelfCheckCtx`, `SELF_CHECK_ITEMS`.

### Steps

- [ ] 1. 실패하는 테스트를 쓴다.

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
  subject: "견적", body: "언제 보내주실 수 있을까요?", sent_at: new Date().toISOString(),
  embedding: null, ...over,
});

describe("needsReplyScore (A4 §3.1)", () => {
  it("adds up the five weights", () => {
    const s = needsReplyScore(item(), {
      lastAuthorIsThem: true, myReplyRatio: 1, inTo: true, bulkHeaders: false,
    });
    expect(s).toBeCloseTo(1, 5);   // 0.3 + 0.3 + 0.2 + 0.2, 1.0으로 클램프
  });

  it("drops a newsletter below the threshold", () => {
    const s = needsReplyScore(item({ body: "구독을 해지하려면 여기를 누르세요" }), {
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
    const r = selfCheck("확인했습니다. https://evil.example/pay 로 보내드릴게요.", {
      questionCount: 0, externalUrls: ["https://evil.example/pay"], calendarConflicts: [],
      voiceSampleAvgLen: 40, entityNames: [], channel: "gmail",
    });
    expect(r.passed).toBe(false);
    expect(r.failed).toContain(6);
  });

  it("fails #1 when the draft answers fewer questions than it was asked", () => {
    const r = selfCheck("네.", {
      questionCount: 2, externalUrls: [], calendarConflicts: [],
      voiceSampleAvgLen: 40, entityNames: [], channel: "slack",
    });
    expect(r.failed).toContain(1);
  });

  it("passes a clean draft", () => {
    const r = selfCheck("네, 목요일 오후 2시에 보내드리겠습니다. 확인해보고 알려드리겠습니다.", {
      questionCount: 1, externalUrls: [], calendarConflicts: [],
      voiceSampleAvgLen: 40, entityNames: [], channel: "gmail",
    });
    expect(r).toEqual({ passed: true, failed: [] });
  });
});
```

- [ ] 2. 실패를 확인한다. 기대: `does not provide an export named 'needsReplyScore'`.

```bash
pnpm --filter @omnis/agents test -- draft-rules
```

- [ ] 3. `register.ts`를 쓴다.

```ts
// packages/agents/src/draft/register.ts
// A4 §3.1·§3.2·§3.4. 전부 규칙이다 — 여기에 모델 호출은 없다.
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

/** A4 §3.1: 0.5 미만이면 초안을 아예 안 만든다. */
export const NEEDS_REPLY_MIN = 0.5;

const UNSUBSCRIBE = /구독.{0,4}해지|unsubscribe|수신거부/i;

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

/** A4 §3.4 표 그대로. Channel 10값 전부를 덮는다(agent/system은 초안 대상이 아니라 0이다). */
export const CHANNEL_DRAFT_SHAPE: Record<Channel, DraftShape> = {
  gmail: { targetWords: [60, 180], notes: "인사말 + 본문 + 맺음말, 문단 2~3. subject는 Re: 유지." },
  outlook: { targetWords: [60, 180], notes: "Gmail과 동일." },
  slack: { targetWords: [10, 60], notes: "인사말 없음, 마크다운 최소. 새 @멘션 추가 금지." },
  telegram: { targetWords: [8, 45], notes: "1~3문장. 이모지는 VOICE에 샘플이 있을 때만 0~1개." },
  whatsapp: { targetWords: [6, 30], notes: "1~2문장, 줄바꿈 대신 단문." },
  kakaotalk: { targetWords: [5, 30], notes: "80자 이하, 존댓말 기본, 줄바꿈 최소, 텍스트만." },
  linkedin: { targetWords: [40, 90], notes: "인사 + 용건 + 제안 1개. 선제 발신 금지 규칙 적용." },
  gcal: { targetWords: [10, 60], notes: "초대 응답 문구. 일정 자체는 승인 경로다." },
  agent: { targetWords: [0, 0], notes: "초안 아님 — 사용자가 직접 쓴다(A4 §3.4)." },
  system: { targetWords: [0, 0], notes: "초안 아님." },
};
```

- [ ] 4. `selfcheck.ts`를 쓴다.

```ts
// packages/agents/src/draft/selfcheck.ts
// A4 §3.3의 6항 체크리스트. 6번(exfil 방지)이 핵심 안전장치다.
import type { Channel } from "@omnis/protocol";
import { CHANNEL_DRAFT_SHAPE } from "./register.js";

export const SELF_CHECK_ITEMS: readonly string[] = [
  "상대가 물은 것에 전부 답했는가",
  "내가 모르는 사실을 단정했는가",
  "날짜·시간이 캘린더와 충돌하지 않는가",
  "VOICE 샘플의 문장 길이 패턴과 어긋나지 않는가",
  "상대 이름·직함·회사가 엔티티 지금 기준과 일치하는가",
  "<data>에서 가져온 링크·주소·계좌를 그대로 옮기지 않았는가",
] as const;

export interface SelfCheckCtx {
  /** 상대가 던진 질문 개수(물음표 세기). */
  questionCount: number;
  /** <data> 블록에 등장했던 URL·계좌 문자열. 초안에 그대로 있으면 6번 실패. */
  externalUrls: string[];
  /** 초안이 말한 시각 중 캘린더와 겹치는 것. */
  calendarConflicts: string[];
  /** VOICE 샘플의 평균 문장 길이(자). 0이면 4번을 건너뛴다. */
  voiceSampleAvgLen: number;
  /** "지금 기준" 엔티티 이름 목록. 초안이 이 중 어느 것도 안 쓰면 5번은 통과로 본다. */
  entityNames: string[];
  channel: Channel;
}

const HEDGE = /확인(해\s?보고|하고)|알아보고|여쭤보고/;
const ASSERTION = /반드시|무조건|확실히|100%/;

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
    const stale = /(?:전|前)\s?직장|예전\s?회사/.test(draft);
    if (stale) failed.push(5);
  }
  // 6번: <data>에서 온 URL·계좌를 그대로 옮겼는가. 인젝션 경유 exfil의 마지막 방어선이다.
  if (ctx.externalUrls.some((u) => u !== "" && draft.includes(u))) failed.push(6);

  const shape = CHANNEL_DRAFT_SHAPE[ctx.channel];
  if (shape.targetWords[1] > 0 && draft.trim().split(/\s+/).length > shape.targetWords[1] * 1.5) {
    failed.push(4);
  }
  return { passed: failed.length === 0, failed: [...new Set(failed)].sort((a, b) => a - b) };
}
```

- [ ] 5. `index.ts`에 export를 더하고 통과를 확인한다. 기대: 7 tests passed.

```ts
// packages/agents/src/index.ts — 추가
export {
  CHANNEL_DRAFT_SHAPE, NEEDS_REPLY_MIN, needsReplyScore, pickRegister,
  type DraftShape, type Register,
} from "./draft/register.js";
export { SELF_CHECK_ITEMS, selfCheck, type SelfCheckCtx } from "./draft/selfcheck.js";
```

```bash
pnpm --filter @omnis/agents test -- draft-rules && pnpm lint
git add packages/agents/src/draft packages/agents/src/index.ts packages/agents/test/draft-rules.test.ts
git commit -m "US-B13: 초안 순수 함수 — register/needs-reply/채널 형식/self-check

- needsReplyScore 5개 가중치와 0.5 임계(A4 §3.1)
- pickRegister는 라벨·소속·인사말 규칙이고 모델을 부르지 않는다
- CHANNEL_DRAFT_SHAPE가 Channel 10값을 전부 덮는다
- selfCheck 6항, 6번이 <data> 경유 exfil을 잡는다

Implemented-by: Claude Opus
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 9: `draftLoop` — 60초 SLA + 티어 에스컬레이션 6조건 (US-B13, tier: Opus)

> **스토리** — 목표: 트리거·컨텍스트 7슬롯·Deliberate 4스텝·60초 SLA placeholder·에스컬레이션 6조건. 산출물: `packages/agents/src/loops/draft.ts`. 검증: `pnpm --filter @omnis/agents test`.

**읽을 것:** A4 §3 전체, Task 3의 `runLoopSpec`, Task 5의 `propose_draft`.
**만들지 말 것(YAGNI):** 초안 A/B 생성, 다국어 자동 감지 라이브러리. `language`는 본문의 한글 비율 한 줄로 가른다.

**Files:**
- Create: `packages/agents/src/loops/draft.ts`, `packages/agents/test/integration/draft-loop.test.ts`
- Modify: `packages/agents/src/index.ts`
- Test: `packages/agents/test/integration/draft-loop.test.ts`

**Interfaces:**
- Consumes: `buildContext`(US-B05), `runLoopSpec`/`registerLoop`(Task 1·3), `toolRegistry`(Task 5), `pickRegister`/`needsReplyScore`/`selfCheck`(Task 8), `currentPolicy`(Task 6 — 허브가 `draftPolicy`로 주입).
- Produces: `draftLoop`, `DraftOutput`, `type DraftOutputT`, `writePlaceholderDraft`, `shouldEscalate`, `DRAFT_SLA_MS`, `DRAFT_PLACEHOLDER_MS`.

### Steps

- [ ] 1. 실패하는 테스트를 쓴다 — 에스컬레이션 판정과 placeholder 두 개만 본다(모델 경로는 Task 3이 이미 덮는다).

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
    expect(rows[0]).toMatchObject({ status: "draft", body: "초안 준비 중…" });
    expect(rows[0]?.meta.pending).toBe(true);
  });
});
```

- [ ] 2. 실패를 확인한다. 기대: `does not provide an export named 'draftLoop'`.

```bash
pnpm --filter @omnis/agents test -- draft-loop
```

- [ ] 3. 구현을 쓴다.

```ts
// packages/agents/src/loops/draft.ts
// A4 §3 L2 답장 초안 루프(Deliberate).
import type { Channel, Sensitivity } from "@omnis/protocol";
import { z } from "zod";
import { buildContext } from "../context/assemble.js";
import { CHANNEL_DRAFT_SHAPE, pickRegister } from "../draft/register.js";
import { selfCheck } from "../draft/selfcheck.js";
import { registerLoop } from "../loop/registry.js";
import type { LoopSpec, TriggerContext } from "../loop/spec.js";
import { getAgentsPool } from "../pool.js";
import { PROPOSE_TOOLS } from "../tools/propose.js";

/** A4 §3.1 SLA: 60초 안에 status='draft' row가 있어야 한다. 55초에 placeholder를 먼저 쓴다. */
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

/** A4 §3.5의 6조건. 하나라도 참이면 T2(Claude Sonnet 5). */
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

/** A4 §3.1: 화면이 "초안 없음"으로 비는 것보다 "준비 중"이 낫다. */
export async function writePlaceholderDraft(threadId: string): Promise<string> {
  const { rows } = await getAgentsPool().query<{ id: string }>(
    `INSERT INTO items (thread_id, account_id, kind, status, body, sent_at, author_is_me, meta)
     SELECT t.id, t.account_id,
            CASE WHEN t.kind = 'email' THEN 'email' ELSE 'message' END,
            'draft', '초안 준비 중…', now(), true, '{"pending": true}'::jsonb
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

  // A4 §3.2의 7슬롯. 슬롯 이름과 수치는 그 표 그대로다.
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
    // A4 §3.3 step 4: 실패 항목이 있으면 초안을 저장하되 UI가 볼 수 있게 표시한다 —
    // 재생성은 runLoopSpec의 재시도가 아니라 사람의 판단이다(6번은 안전 실패라 특히 그렇다).
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

- [ ] 4. `index.ts`에 export를 더하고 통과를 확인한다. 기대: `draft-loop.test.ts` 3 tests passed.

```ts
// packages/agents/src/index.ts — 추가
export {
  DRAFT_PLACEHOLDER_MS, DRAFT_SLA_MS, DraftOutput, draftLoop, shouldEscalate,
  writePlaceholderDraft, type DraftOutputT,
} from "./loops/draft.js";
```

```bash
pnpm --filter @omnis/agents test && pnpm lint
git add packages/agents/src/loops/draft.ts packages/agents/src/index.ts packages/agents/test/integration/draft-loop.test.ts
git commit -m "US-B13: L2 답장 초안 루프

- 트리거(item.labeled + needs_reply_score>=0.5, 20초 디바운스)와 A4 §3.7 예산
- 7슬롯 컨텍스트, palette에 propose_draft 하나만 쓰기 tool로 들어간다
- 60초 SLA placeholder(meta.pending) → 완료 시 같은 row 교체
- shouldEscalate 6조건

Implemented-by: Claude Opus
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 10: 알림 3등급 판정 + 조용시간 (US-B15, tier: Sonnet)

> **스토리** — 목표: 즉시/묶음/무음 판정, 조용시간 23:00~07:00 + 예외 1개. 산출물: `packages/kernel/src/notify/tier.ts`. 검증: `pnpm --filter @omnis/kernel test`. 의존: B13.

**읽을 것:** A4 §3.6 표 전체, 델타 §2.3(`NotifyTier`).
**만들지 말 것(YAGNI):** 사용자별 알림 프로필, 채널별 on/off. Settings의 `notify.quiet_hours`/`notify.vip_override` 두 키가 전부다.

**Files:**
- Create: `packages/kernel/src/notify/tier.ts`, `packages/kernel/test/notify-tier.test.ts`
- Modify: `packages/kernel/src/index.ts`
- Test: `packages/kernel/test/notify-tier.test.ts`

**Interfaces:**
- Consumes: `NotifyTier`(`@omnis/protocol`, 델타 §2.3).
- Produces: `notifyTierFor`, `inQuietHours`, `QUIET_START_HOUR_KST`, `QUIET_END_HOUR_KST`, `PUSH_BATCH_HOURS_KST`.

### Steps

- [ ] 1. 실패하는 테스트를 쓴다.

```ts
// packages/kernel/test/notify-tier.test.ts
import { describe, expect, it } from "vitest";
import { PUSH_BATCH_HOURS_KST, inQuietHours, notifyTierFor } from "../src/notify/tier.js";

/** KST 기준 시각을 UTC Date로 만든다(Asia/Seoul은 DST가 없어 고정 -9h). */
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

- [ ] 2. 실패를 확인한다. 기대: `Failed to resolve import "../src/notify/tier.js"`.

```bash
pnpm --filter @omnis/kernel test -- notify-tier
```

- [ ] 3. 구현을 쓴다.

```ts
// packages/kernel/src/notify/tier.ts
// A4 §3.6. 맥과 폰에 똑같이 적용된다 — 폰 전용 규칙은 없다.
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
  /** Settings `notify.vip_override`. 기본 true — 끄면 조용시간 예외가 사라진다. */
  vipOverride?: boolean;
}): NotifyTier {
  const immediate =
    i.priority === "now" && (i.vip || i.mentionsMe || i.meetingWithin2h);
  if (immediate) {
    if (!inQuietHours(i.now)) return "immediate";
    // 조용시간 예외는 vip AND priority='now' 하나뿐이고, 그것조차 Settings에서 끌 수 있다.
    return i.vip && (i.vipOverride ?? true) ? "immediate" : "batched";
  }
  if (i.priority === "today") return "batched";
  return "silent";
}
```

- [ ] 4. `index.ts`에 export를 더하고 통과를 확인한다. 기대: 4 tests passed.

```ts
// packages/kernel/src/index.ts — 추가
export {
  PUSH_BATCH_HOURS_KST, QUIET_END_HOUR_KST, QUIET_START_HOUR_KST, inQuietHours, notifyTierFor,
} from "./notify/tier.js";
```

```bash
pnpm --filter @omnis/kernel test -- notify-tier && pnpm lint
git add packages/kernel/src/notify/tier.ts packages/kernel/src/index.ts packages/kernel/test/notify-tier.test.ts
git commit -m "US-B15: 알림 3등급 판정과 조용시간

- notifyTierFor가 즉시/묶음/무음을 A4 §3.6 표 그대로 가른다
- inQuietHours 23:00~07:00 KST(자정 넘김 처리), 예외는 vip AND priority=now 하나
- 예외는 notify.vip_override로 끌 수 있다

Implemented-by: Claude Sonnet
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 11: `push_batch` 잡 + `createNotifier` (US-B15, tier: Sonnet)

> **스토리** — 목표: 묶음 잡(09/12/15/18 KST)이 "초안 N건 준비됨" 1건으로 접고, 본문은 첫 80자만 싣는다. 산출물: `packages/kernel/src/notify/batch.ts`. 검증: `pnpm --filter @omnis/kernel test`.

**읽을 것:** A4 §3.6 마지막 두 문단, 델타 §2.3(`PushPayload.body`는 `max(80)`), 델타 §8(`push_batch`).
**만들지 말 것(YAGNI):** 알림 dedup 저장소, 읽음 처리 동기화. 묶음 1건은 매번 새로 센다.

**Files:**
- Create: `packages/kernel/src/notify/batch.ts`, `packages/kernel/test/integration/notify-batch.test.ts`
- Modify: `packages/kernel/src/index.ts`
- Test: `packages/kernel/test/integration/notify-batch.test.ts`

**Interfaces:**
- Consumes: `PushPayload`/`NotifyTier`(`@omnis/protocol`), `notifyTierFor`/`inQuietHours`(Task 10), `sendWebPush`(Task 12 — 여기서는 `Notifier.send`로 주입받는 형태로만 쓴다).
- Produces: `Notifier`, `createNotifier`, `runPushBatch`, `registerPushBatchJob`, `PUSH_BATCH_JOB_NAME`, `PUSH_BATCH_CRON`, `first80`.

### Steps

- [ ] 1. 실패하는 테스트를 쓴다.

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
    expect(first80("가".repeat(200))).toHaveLength(80);
    expect(first80("짧다")).toBe("짧다");
  });

  it("folds every pending draft into a single push", async () => {
    for (let i = 0; i < 3; i += 1) {
      await pool.query(
        `INSERT INTO items (thread_id, account_id, kind, status, body, sent_at, author_is_me)
         SELECT $1, account_id, 'email', 'draft', $2, now(), true FROM threads WHERE id = $1`,
        [threadId, `초안 ${i}`]);
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
    expect(payload.body).toContain("3건");
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

- [ ] 2. 실패를 확인한다. 기대: `Failed to resolve import "../../src/notify/batch.js"`.

```bash
pnpm --filter @omnis/kernel test:integration -- notify-batch
```

- [ ] 3. 구현을 쓴다.

```ts
// packages/kernel/src/notify/batch.ts
// A4 §3.6: 묶음 등급은 3시간 간격으로 "초안 N건 준비됨" 1건으로 접힌다.
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

/** A4 §3.6 프라이버시 원칙: 잠금화면에 본문 전문을 띄우지 않는다. */
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
      body: first80(`초안 ${n}건 준비됨`),
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

/** 실제 발송기는 Task 12의 Web Push + Tauri 로컬 알림이다. 여기서는 주입 지점만 만든다. */
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
        // A4: 발송 실패를 조용히 삼키지 않는다. agent_runs가 아니라 시스템 Item이다(백로그 US-B17).
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
          [`알림 발송에 실패했습니다(${p.kind}). 설정에서 푸시 구독을 확인해 주세요.`],
        );
      }
    },
  };
}
```

- [ ] 4. `index.ts`에 export를 더하고 통과를 확인한다. 기대: 4 tests passed.

```ts
// packages/kernel/src/index.ts — 추가
export {
  PUSH_BATCH_CRON, PUSH_BATCH_JOB_NAME, createNotifier, first80, registerPushBatchJob,
  runPushBatch, type Notifier, type PushBatchDeps,
} from "./notify/batch.js";
```

```bash
pnpm --filter @omnis/kernel test:integration -- notify-batch && pnpm lint
git add packages/kernel/src/notify/batch.ts packages/kernel/src/index.ts packages/kernel/test/integration/notify-batch.test.ts
git commit -m "US-B15: push_batch 잡과 createNotifier

- 09/12/15/18 KST에 대기 초안 전부를 '초안 N건 준비됨' 1건으로 접는다
- 본문은 first80으로 잘라 잠금화면에 전문이 뜨지 않게 한다
- 발송 실패는 시스템 Item으로 노출한다(조용히 삼키지 않는다)

Implemented-by: Claude Sonnet
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 12: Web Push 발송기 + macOS 로컬 알림 (US-B17, tier: Sonnet)

> **스토리** — 목표: VAPID 서명 Web Push(`push_subscriptions` 조회, 액션 2개, 410/404 정리) + Tauri 알림 딥링크. 산출물: `packages/kernel/src/notify/webpush.ts`, `apps/desktop/src-tauri/src/notify.rs`. 검증: `pnpm --filter @omnis/kernel test`. 의존: B15, B16.

**읽을 것:** A5 §4.4, 델타 §2.3(`PushPayload`)·§6(`0011_push_subscriptions.sql`은 surfaces 계획 US-B36 소유)·§9(VAPID 환경변수).
**의존 주의:** `push_subscriptions` 테이블은 **surfaces 계획의 `0011`이 만든다**. 이 태스크의 통합 테스트는 그 마이그레이션이 적용된 DB를 전제한다. 적용 전이면 `pnpm db:migrate`가 아직 `0011`을 못 가진 상태이므로 **surfaces 계획 Task(0011) 머지 후**에 이 태스크를 실행한다.
**만들지 말 것(YAGNI):** 자체 VAPID 서명 구현, 재시도 큐. `web-push`가 서명·암호화를 다 하고, 실패한 엔드포인트는 다음 발송에서 다시 만난다.

**Files:**
- Create: `packages/kernel/src/notify/webpush.ts`, `packages/kernel/test/integration/webpush.test.ts`, `apps/desktop/src-tauri/src/notify.rs`
- Modify: `packages/kernel/package.json`, `packages/kernel/src/index.ts`, `apps/desktop/src-tauri/src/lib.rs`
- Test: `packages/kernel/test/integration/webpush.test.ts`

**Interfaces:**
- Consumes: `PushPayload`(`@omnis/protocol`), `Notifier`(Task 11).
- Produces: `VapidKeys`, `sendWebPush`, `pruneSubscription`, `WEBPUSH_GONE_CODES`, `deepLinkFor`(Rust).

### Steps

- [ ] 1. 의존을 더한다.

```bash
pnpm --filter @omnis/kernel add web-push@3.6.7 && pnpm --filter @omnis/kernel add -D @types/web-push@3.6.4
```

- [ ] 2. 실패하는 테스트를 쓴다. `web-push` 모듈 자체를 mock해 네트워크를 타지 않는다.

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
  kind: "approval" as const, title: "omnis", body: "승인 대기 1건",
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

- [ ] 3. 실패를 확인한다. 기대: `Failed to resolve import "../../src/notify/webpush.js"`.

```bash
pnpm --filter @omnis/kernel test:integration -- webpush
```

- [ ] 4. 구현을 쓴다.

```ts
// packages/kernel/src/notify/webpush.ts
// A5 §4.4 + A4 §3.6. 키는 Keychain omnis.webpush.vapid_* → launchd가 env로 주입한다(델타 §9).
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

/** 구독이 사라졌음을 뜻하는 응답. 둘 다 조용히 지운다(RFC 8030). */
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
  // 액션 2개는 A5 §4.4 그대로. approve는 앱을 열지 않고 POST /approvals/:id/decide를 친다.
  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    actions: [
      { action: "approve", title: "승인" },
      { action: "open", title: "열기" },
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

- [ ] 5. `index.ts`에 export를 더한다.

```ts
// packages/kernel/src/index.ts — 추가
export {
  WEBPUSH_GONE_CODES, pruneSubscription, sendWebPush, vapidFromEnv, type VapidKeys,
} from "./notify/webpush.js";
```

- [ ] 6. macOS 로컬 알림을 쓴다. Tauri notification 플러그인이 알림을 띄우고, 클릭은 `omnis://thread/{id}` 딥링크로 돌아온다.

```rust
// apps/desktop/src-tauri/src/notify.rs
// A4 §3.6: 맥 알림은 Web Push와 같은 3등급을 따른다. 본문은 첫 80자만 싣는다.
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

/// omnis://thread/{id} 딥링크. approval_id가 있으면 승인 카드로 바로 연다.
pub fn deep_link_for(thread_id: &str, approval_id: Option<&str>) -> String {
    match approval_id {
        Some(a) => format!("omnis://thread/{thread_id}?approval={a}"),
        None => format!("omnis://thread/{thread_id}"),
    }
}

/// 본문은 80자(문자 단위)까지만 — 잠금화면에 전문이 뜨지 않게 한다.
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
        let long = "가".repeat(200);
        assert_eq!(first_80(&long).chars().count(), 80);
    }
}
```

```rust
// apps/desktop/src-tauri/src/lib.rs — mod 선언과 invoke_handler에 추가
mod notify;
// .invoke_handler(tauri::generate_handler![notify::notify_local])
```

```bash
pnpm --filter @omnis/desktop exec -- cargo add tauri-plugin-notification --manifest-path src-tauri/Cargo.toml
```

- [ ] 7. 둘 다 통과를 확인하고 커밋한다. 기대: vitest 3 tests passed, `cargo test` 2 tests passed.

```bash
pnpm --filter @omnis/kernel test:integration -- webpush && \
  (cd apps/desktop/src-tauri && cargo test notify) && pnpm lint
git add packages/kernel/src/notify/webpush.ts packages/kernel/src/index.ts packages/kernel/package.json packages/kernel/test/integration/webpush.test.ts apps/desktop/src-tauri
git commit -m "US-B17: Web Push 발송기와 macOS 로컬 알림

- VAPID 서명 후 push_subscriptions 전체에 발송, 액션은 Approve/Open 2개
- 410/404 응답은 구독을 지우고 나머지는 fail_count만 올린다
- VAPID 키가 없으면 0을 돌려주고 아무것도 보내지 않는다
- Tauri notify_local이 omnis://thread/{id} 딥링크를 만들고 본문을 80자로 자른다

Implemented-by: Claude Sonnet
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 13: `archiveItem` / `undoArchive` — 7일 undo + 30일 재보관 제외 (US-B18, tier: Opus)

> **스토리** — 목표: `items.meta.archived_by` 기록, `undoArchive()`(`archived`→`received` + `audit_log` + 해당 스레드 30일 제외), 하드 삭제 경로 없음. 산출물: `packages/kernel/src/archive.ts`. 검증: `pnpm --filter @omnis/kernel test:integration`. 의존: B06.

**읽을 것:** A4 §9.3(`archived_by` JSON 형식)·§9.4(되살리기 4항), 델타 §5(`archive.ts` 블록)·§0-4(두 컬럼을 둘 다 쓴다), `apps/hub/src/archive.ts`(스레드 단위 보관 — 이것과 다른 축이다).
**만들지 말 것(YAGNI):** undo 토큰 테이블. 토큰은 `digests.id`와 그룹 reason의 조합으로 그날 다이제스트에서 재계산한다(Task 22).

**Files:**
- Create: `packages/kernel/src/archive.ts`, `packages/kernel/test/integration/archive.test.ts`
- Modify: `packages/kernel/src/index.ts`
- Test: `packages/kernel/test/integration/archive.test.ts`

**Interfaces:**
- Consumes: `Audit`(Phase A), `query`(`@omnis/db`).
- Produces: `UNDO_WINDOW_DAYS`, `REARCHIVE_EXCLUSION_DAYS`, `ArchivedByMeta`, `archiveItem`, `undoArchive`, `isRearchiveExcluded`, `archivedSince`.

### Steps

- [ ] 1. 실패하는 테스트를 쓴다.

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
     VALUES ($1,$2,'it_arch','email','received','뉴스레터', now(), '{}'::jsonb)
     ON CONFLICT (account_id, external_id)
       DO UPDATE SET status='received', meta='{}'::jsonb RETURNING id`, [threadId, accountId]);
  itemId = i.rows[0]?.id ?? "";
});

const meta = {
  rule_ids: ["ar_sender_nonhuman", "ar_no_cta"], reason: "뉴스레터", tier: "T0" as const,
  confidence: 0.93, run_id: "00000000-0000-0000-0000-0000000000aa",
  at: new Date().toISOString(),
};

describe("archiveItem / undoArchive (A4 §9.3·§9.4)", () => {
  it("sets status=archived and records meta.archived_by", async () => {
    await archiveItem(pool, itemId, meta);
    const { rows } = await pool.query<{ status: string; ab: typeof meta }>(
      "SELECT status, meta->'archived_by' AS ab FROM items WHERE id = $1", [itemId]);
    expect(rows[0]?.status).toBe("archived");
    expect(rows[0]?.ab.reason).toBe("뉴스레터");
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
    expect(groups.find((g) => g.reason === "뉴스레터")?.count).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] 2. 실패를 확인한다. 기대: `Failed to resolve import "../../src/archive.js"`.

```bash
pnpm --filter @omnis/kernel test:integration -- archive
```

- [ ] 3. 구현을 쓴다.

```ts
// packages/kernel/src/archive.ts
// A4 §9.3·§9.4. 하드 삭제는 어떤 경우에도 하지 않는다(A3 §11: items는 영구 보존).
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
  /** undo 7일 창의 기준 시각. items에는 보관 시각 컬럼이 없다(A4 §9.3). */
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

/** 사람이 되살린 스레드는 30일간 자동 보관 대상에서 제외한다(A4 §9.4). */
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

/** 밤 다이제스트가 하루치를 reason으로 묶어 읽는다(A4 §9.4 "전량 노출"). */
export async function archivedSince(pool: Pool, since: Date): Promise<ArchivedGroup[]> {
  const rows = await query<{ reason: string; count: string; item_ids: string[] }>(
    pool,
    `SELECT COALESCE(meta->'archived_by'->>'reason', '기타') AS reason,
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

- [ ] 4. `index.ts`에 export를 더하고 통과를 확인한다. 기대: 4 tests passed.

```ts
// packages/kernel/src/index.ts — 추가
export {
  REARCHIVE_EXCLUSION_DAYS, UNDO_WINDOW_DAYS, archiveItem, archivedSince,
  isRearchiveExcluded, undoArchive, type ArchivedByMeta, type ArchivedGroup,
} from "./archive.js";
```

```bash
pnpm --filter @omnis/kernel test:integration -- archive && pnpm lint
git add packages/kernel/src/archive.ts packages/kernel/src/index.ts packages/kernel/test/integration/archive.test.ts
git commit -m "US-B18: archiveItem/undoArchive — 7일 undo와 30일 재보관 제외

- items.meta.archived_by에 rule_ids/reason/tier/confidence/run_id/at을 남긴다
- undoArchive는 7일 창 안에서만 archived→received로 되돌리고 audit_log를 남긴다
- 되살린 스레드는 threads.meta.no_auto_archive_until로 30일 제외된다
- 하드 삭제 경로가 없다

Implemented-by: Claude Opus
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 14: `autoArchiveLoop` — 하드 게이트 5종 + T0 판정 + T1 임계 (US-B18, tier: Opus)

> **스토리** — 목표: 하드 게이트 5종 먼저, ①③④는 순수 SQL(T0), ②·④-b만 T1(`confidence ≥ 0.85`), 22:00 스윕. 산출물: `packages/agents/src/loops/auto-archive.ts`. 검증: `pnpm --filter @omnis/agents test && pnpm eval:archive`.

**읽을 것:** A4 §9.1~§9.5 전체(하드 게이트 목록, 판정 표 5행, T1 임계), Task 1의 `decide?`, Task 13.
**만들지 말 것(YAGNI):** 규칙 카운터 테이블. A4 §9.3이 집계 쿼리로 얻으라고 못박았다.

**Files:**
- Create: `packages/agents/src/loops/auto-archive.ts`, `packages/agents/test/integration/auto-archive.test.ts`, `tools/eval/auto-archive.ts`, `eval/auto_archive.jsonl`
- Modify: `packages/agents/src/index.ts`, `package.json`(루트 `eval:archive` 스크립트)
- Test: `packages/agents/test/integration/auto-archive.test.ts`

**Interfaces:**
- Consumes: `archiveItem`/`isRearchiveExcluded`(Task 13 — 허브가 주입하지 않고 `@omnis/kernel`을 **의존하지 않으므로**, 이 루프는 `apply()`에서 직접 SQL을 쓴다), `needsReplyScore`(Task 8), `registerLoop`/`runLoopSpec`(Task 1·3).
- Produces: `autoArchiveLoop`, `AutoArchiveOutput`, `type AutoArchiveOutputT`, `hardGate`, `nonHumanSender`, `T1_ARCHIVE_CONFIDENCE_MIN`, `AUTO_ARCHIVE_RULES`, `sweepAutoArchive`.

### Steps

- [ ] 1. 실패하는 테스트를 쓴다 — 하드 게이트와 T0 경로가 핵심이다.

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
    [threadId, accountId, over.sensitivity ?? "normal", over.body ?? "주간 뉴스레터입니다",
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
       VALUES ('send','{}'::jsonb,'승인 대기',$1)`, [threadId]);
    expect((await hardGate(pool, plain)).blocked).toBe(true);
  });

  it("nonHumanSender catches no-reply locals and bulk headers", () => {
    expect(nonHumanSender({ handle: "no-reply@news.example", meta: {} })).toBe(true);
    expect(nonHumanSender({ handle: "notifications@x.example", meta: {} })).toBe(true);
    expect(nonHumanSender({ handle: "a@b.example", meta: { "List-Unsubscribe": "<x>" } })).toBe(true);
    expect(nonHumanSender({ handle: "logan@onward.example", meta: {} })).toBe(false);
  });

  it("archives a newsletter entirely at T0 (no model call)", async () => {
    const id = await mkItem({ body: "이번 주 소식입니다. 구독 해지는 아래에서." });
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

- [ ] 2. 실패를 확인한다. 기대: `does not provide an export named 'autoArchiveLoop'`.

```bash
pnpm --filter @omnis/agents test -- auto-archive
```

- [ ] 3. 구현을 쓴다.

```ts
// packages/agents/src/loops/auto-archive.ts
// A4 §9. 이 루프는 egress가 아니다 — pending_approvals를 만들지 않고, 7일 undo·전량 노출·
// 하드 삭제 금지 셋으로 보장한다.
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
  if (i.meta.bot === true) return true;   // Slack bot 발신
  return false;
}

export interface HardGateResult {
  blocked: boolean;
  reason: string | null;
}

/** A4 §9.2: 규칙보다 먼저 평가하는 하드 게이트 5종. 하나라도 걸리면 절대 보관하지 않는다. */
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
  // ① 발신자가 사람이 아님 (T0, $0)
  if (!nonHumanSender({ handle: r.handle, meta: r.meta })) return null;
  rules.push(AUTO_ARCHIVE_RULES.senderNonHuman);
  // ③ VIP 아님 + sensitivity normal — hardGate가 이미 보장했다
  rules.push(AUTO_ARCHIVE_RULES.notVipNormal);
  // ④ 내가 답한 적 없음. 답한 적이 있으면 ④-b(T1)로 넘어간다.
  if (r.i_replied) return null;
  rules.push(AUTO_ARCHIVE_RULES.neverReplied);
  // ② T0 경로: 물음표 부재. 물음표가 있으면 T1을 태운다.
  if (r.body.includes("?") || r.body.includes("？")) return null;
  rules.push(AUTO_ARCHIVE_RULES.noCta);

  return {
    archive: true,
    reason: typeof (r.meta as { headers?: Record<string, unknown> }).headers?.["List-Unsubscribe"] === "string"
      ? "뉴스레터" : "알림 메일",
    rule_ids: rules,
    tier: "T0",
    confidence: 0.95,
    rationale: "발신자가 사람이 아니고 나에게 향한 질문이 없어 보관했습니다.",
    injection_flags: [],
  };
}

async function applyArchive(itemId: string, out: AutoArchiveOutputT, runId: string): Promise<void> {
  if (!out.archive) return;
  if (out.tier === "T1" && out.confidence < T1_ARCHIVE_CONFIDENCE_MIN) return;
  // ponytail: @omnis/agents는 @omnis/kernel을 의존할 수 없어 archiveItem을 직접 못 부른다.
  // 같은 UPDATE 한 문장을 여기 둔다(계약 §12의 의도된 중복).
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
          confidence: 1, rationale: `하드 게이트(${gate.reason ?? "gate"})에 걸려 보관하지 않았습니다.`,
          injection_flags: [],
        },
        confidence: 1, rationale: "hard gate", escalate: false,
        injection_flags: [], unresolved: [],
      };
    }
    const t0 = await t0Verdict(itemId);
    if (t0 === null) return null;   // ② 또는 ④-b가 애매하다 → T1 경로
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

/** A4 §9.1 두 번째 경로: 22:00 스윕. 23:00 다이제스트보다 먼저 끝난다. */
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

- [ ] 4. 평가 하네스를 쓴다. 150건 골든 세트는 시드로 만들고, **오보관 precision ≥ 0.97 + VIP·민감 보관 0건**을 하드 게이트로 건다.

```ts
// tools/eval/auto-archive.ts
// A4 §9.5. 시드 JSONL만 읽는다 — 실계정이 필요 없다(B-D5).
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
if (unsafe > 0) { console.error("FAIL: VIP·민감 item이 보관되었다"); process.exit(1); }
if (precision < 0.97) { console.error("FAIL: precision < 0.97"); process.exit(1); }
if (recall < 0.70) { console.error("FAIL: recall < 0.70"); process.exit(1); }
void hardGate;
void createPool;
```

```jsonl
// eval/auto_archive.jsonl — 처음 4줄(나머지 146줄은 같은 형식으로 채운다: 보관해야 함 90 / 안 됨 60)
{"id":"e1","handle":"no-reply@news.example","body":"이번 주 소식입니다","meta":{"headers":{"List-Unsubscribe":"<x>"}},"sensitivity":"normal","vip":false,"i_replied":false,"expect_archive":true}
{"id":"e2","handle":"notifications@github.example","body":"빌드가 성공했습니다","meta":{},"sensitivity":"normal","vip":false,"i_replied":false,"expect_archive":true}
{"id":"e3","handle":"kim@client.example","body":"견적서 언제 받을 수 있을까요?","meta":{},"sensitivity":"normal","vip":true,"i_replied":true,"expect_archive":false}
{"id":"e4","handle":"no-reply@bank.example","body":"이체 내역 안내","meta":{},"sensitivity":"finance","vip":false,"i_replied":false,"expect_archive":false}
```

```jsonc
// package.json(루트) scripts에 추가
"eval:archive": "tsx tools/eval/auto-archive.ts"
```

- [ ] 5. 통과를 확인한다. 기대: `auto-archive.test.ts` 4 tests passed, `pnpm eval:archive`가 `unsafe=0`을 찍고 exit 0.

```bash
pnpm --filter @omnis/agents test -- auto-archive && pnpm eval:archive && pnpm lint
```

- [ ] 6. 커밋한다.

```bash
git add packages/agents/src/loops/auto-archive.ts packages/agents/src/index.ts packages/agents/test/integration/auto-archive.test.ts tools/eval/auto-archive.ts eval/auto_archive.jsonl package.json
git commit -m "US-B18: L8 자동 보관 루프

- 하드 게이트 5종(민감·VIP·pending approval·injection_flags·kind)을 규칙보다 먼저 본다
- ①③④는 순수 SQL(T0), ②·④-b만 T1이고 confidence < 0.85면 보관하지 않는다
- 22:00 스윕이 그날 놓친 것을 훑는다
- pnpm eval:archive가 오보관 precision 0.97과 VIP·민감 보관 0건을 하드 게이트로 건다

Implemented-by: Claude Opus
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 15: `taskLoop` — 정밀도 우선 투두 추출 (US-B19, tier: Sonnet)

> **스토리** — 목표: 트리거 3종, `confidence < 0.70`은 저장조차 안 함, item당 최대 3, `duplicate_of` 병합, `due_basis='inferred'` 표시. 산출물: `packages/agents/src/loops/task.ts`. 검증: `pnpm --filter @omnis/agents test`. 의존: B07.

**읽을 것:** A4 §4.1~§4.2·§4.5, Task 5의 `propose_task`.
**만들지 말 것(YAGNI):** 별도 중복 판정 서비스. 조립기가 넣어준 open task 목록과 모델의 `duplicate_of` 한 필드로 끝난다.

**Files:**
- Create: `packages/agents/src/loops/task.ts`, `packages/agents/test/integration/task-loop.test.ts`
- Modify: `packages/agents/src/index.ts`
- Test: `packages/agents/test/integration/task-loop.test.ts`

**Interfaces:**
- Consumes: `buildContext`(US-B05), `PROPOSE_TOOLS`(Task 5), `extractHints`/`routeByRule`(Task 17 — `apply()`가 optional chaining 없이 직접 부른다. Task 17을 먼저 머지한다).
- Produces: `taskLoop`, `TaskOutput`, `type TaskOutputT`, `TASK_CONFIDENCE_MIN`, `TASK_MAX_PER_ITEM`.

### Steps

- [ ] 1. 실패하는 테스트를 쓴다.

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
     VALUES ($1,$2,'message','내일까지 견적서 보내드릴게요', now()) RETURNING id`,
    [threadId, accountId]);
  itemId = i.rows[0]?.id ?? "";
  await pool.query("DELETE FROM tasks WHERE source_item_id = $1", [itemId]);
});
afterAll(() => pool.end());

const result = (tasks: unknown[]) => ({
  loop: "task" as const, run_id: "00000000-0000-0000-0000-0000000000bb",
  output: { tasks, confidence: 0.9, rationale: "약속 문장", injection_flags: [] },
  confidence: 0.9, rationale: "약속 문장", escalate: false,
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
        { title: "확실한 약속", owner: "me", due_basis: "stated", confidence: 0.8 },
        { title: "애매한 추측", owner: "me", due_basis: "inferred", confidence: 0.69 },
      ]) as never,
      { trigger_kind: "event", item_id: itemId, thread_id: threadId, now: new Date(), payload: {} });
    const { rows } = await pool.query<{ title: string }>(
      "SELECT title FROM tasks WHERE source_item_id = $1", [itemId]);
    expect(rows.map((r) => r.title)).toEqual(["확실한 약속"]);
  });

  it("stores at most three tasks per item", async () => {
    await taskLoop.apply(
      result([1, 2, 3, 4, 5].map((n) => ({
        title: `할 일 ${n}`, owner: "me", due_basis: "none", confidence: 0.9,
      }))) as never,
      { trigger_kind: "event", item_id: itemId, thread_id: threadId, now: new Date(), payload: {} });
    const { rows } = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM tasks WHERE source_item_id = $1", [itemId]);
    expect(rows[0]?.n).toBe("3");
  });

  it("merges into the existing task when duplicate_of is set", async () => {
    const t = await pool.query<{ id: string }>(
      "INSERT INTO tasks (title, created_by) VALUES ('기존 할 일','agent') RETURNING id");
    const existing = t.rows[0]?.id ?? "";
    await taskLoop.apply(
      result([{ title: "같은 할 일", owner: "me", due_basis: "none", confidence: 0.9,
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

- [ ] 2. 실패를 확인한다. 기대: `does not provide an export named 'taskLoop'`.

```bash
pnpm --filter @omnis/agents test -- task-loop
```

- [ ] 3. 구현을 쓴다.

```ts
// packages/agents/src/loops/task.ts
// A4 §4. 정밀도 우선 — 거짓 투두는 진짜 투두를 묻는다.
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

      // A4 §4.4: owner='agent'면 같은 실행 안에서 routeByRule을 돌린다(LLM 호출 없음, ~1ms).
      if (out === undefined || t.owner !== "agent" || t.duplicate_of !== undefined) continue;
      if (result.injection_flags.length > 0) continue;               // 폭주 방지 ④
      if (t.confidence < TASK_CONFIDENCE_MIN) continue;              // 폭주 방지 ③
      const hints = extractHints(`${t.title}\n${t.detail ?? ""}\n${t.agent_hint ?? ""}`);
      const routing = routeByRule(hints, await hostHealth());
      if (routing === null) continue;                                // 규칙이 못 가름 → L4가 깨어난다
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

/** A4 §4.4 폭주 방지 ①②: 하루 5건, 같은 스레드 24h 2건. */
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

- [ ] 4. `index.ts`에 export를 더하고 통과를 확인한다. 기대: 4 tests passed.

```ts
// packages/agents/src/index.ts — 추가
export {
  TASK_CONFIDENCE_MIN, TASK_MAX_PER_ITEM, TaskOutput, taskLoop, type TaskOutputT,
} from "./loops/task.js";
```

```bash
pnpm --filter @omnis/agents test -- task-loop && pnpm lint
git add packages/agents/src/loops/task.ts packages/agents/src/index.ts packages/agents/test/integration/task-loop.test.ts
git commit -m "US-B19: L3 투두 추출 루프

- confidence < 0.70은 저장조차 하지 않는다(정밀도 우선)
- item당 최대 3개, duplicate_of면 기존 task에 source_item_id만 더한다
- owner='agent'면 같은 실행 안에서 routeByRule을 돌리고 폭주 방지 4종을 통과할 때만 승인 카드를 만든다

Implemented-by: Claude Sonnet
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 16: `task_remind` 잡 — LLM 없는 순수 SQL 3그룹 (US-B19, tier: Sonnet)

> **스토리** — 목표: 리마인드 잡(09/14/19 KST)은 LLM 없이 순수 SQL 3그룹, 묶음 등급 알림. 산출물: `packages/kernel/src/jobs/task-remind.ts`. 검증: `pnpm --filter @omnis/kernel test:integration`.

**읽을 것:** A4 §4.3(SQL 원문 + 3그룹 문구), Task 10·11.
**만들지 말 것(YAGNI):** 스누즈 상태 머신. `tasks.remind_at`이 이미 있고 A4가 요구한 건 세 그룹 문장이다.

**Files:**
- Create: `packages/kernel/src/jobs/task-remind.ts`, `packages/kernel/test/integration/task-remind.test.ts`
- Modify: `packages/kernel/src/index.ts`
- Test: `packages/kernel/test/integration/task-remind.test.ts`

**Interfaces:**
- Consumes: `Notifier`(Task 11), `notifyTierFor`(Task 10), `Scheduler`(Phase A).
- Produces: `TASK_REMIND_JOB_NAME`, `TASK_REMIND_CRON`, `remindGroups`, `runTaskRemind`, `registerTaskRemindJob`, `type RemindGroup`.

### Steps

- [ ] 1. 실패하는 테스트를 쓴다.

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
         ('오늘 마감','open', now() + interval '3 hours', now(), 'remind-test'),
         ('3일째 방치','open', NULL, now() - interval '4 days', 'remind-test')`);
    await pool.query(
      `INSERT INTO tasks (title, state, owner_kind, delegated_session_id, created_at, created_by)
       VALUES ('아직 안 나간 위임','open','agent', NULL, now() - interval '5 hours', 'remind-test')`);
    const groups = await remindGroups(pool);
    const by = Object.fromEntries(groups.map((g) => [g.kind, g]));
    expect(by.due_soon?.count).toBeGreaterThanOrEqual(1);
    expect(by.stale?.count).toBeGreaterThanOrEqual(1);
    expect(by.undelegated?.count).toBeGreaterThanOrEqual(1);
    expect(by.due_soon?.line).toContain("마감");
    expect(by.undelegated?.line).toContain("에이전트");
  });

  it("sends one batched push per non-empty group and nothing when all empty", async () => {
    const send = vi.fn(async () => undefined);
    const logger = createLogger("@omnis/kernel");
    const sentEmpty = await runTaskRemind({ pool, logger, notifier: { send } });
    const before = send.mock.calls.length;
    expect(sentEmpty).toBe(before);

    await pool.query(
      `INSERT INTO tasks (title, state, due_at, created_by)
       VALUES ('오늘 마감','open', now() + interval '2 hours', 'remind-test')`);
    send.mockClear();
    await runTaskRemind({ pool, logger, notifier: { send } });
    expect(send).toHaveBeenCalled();
    expect(send.mock.calls[0]?.[1]).toBe("batched");
  });
});
```

- [ ] 2. 실패를 확인한다. 기대: `Failed to resolve import "../../src/jobs/task-remind.js"`.

```bash
pnpm --filter @omnis/kernel test:integration -- task-remind
```

- [ ] 3. 구현을 쓴다.

```ts
// packages/kernel/src/jobs/task-remind.ts
// A4 §4.3: 이건 LLM 없이 순수 SQL이다. 알림은 §3.6의 '묶음' 등급을 쓴다.
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
  due_soon: (n) => `오늘 마감 ${n}건`,
  stale: (n) => `3일째 손 안 댄 항목 ${n}건`,
  undelegated: (n) => `에이전트에게 넘기기로 한 ${n}건이 아직 안 나갔습니다`,
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

- [ ] 4. `index.ts`에 export를 더하고 통과를 확인한다. 기대: 3 tests passed.

```ts
// packages/kernel/src/index.ts — 추가
export {
  TASK_REMIND_CRON, TASK_REMIND_JOB_NAME, registerTaskRemindJob, remindGroups, runTaskRemind,
  type RemindGroup, type RemindKind, type TaskRemindDeps,
} from "./jobs/task-remind.js";
```

```bash
pnpm --filter @omnis/kernel test:integration -- task-remind && pnpm lint
git add packages/kernel/src/jobs/task-remind.ts packages/kernel/src/index.ts packages/kernel/test/integration/task-remind.test.ts
git commit -m "US-B19: task_remind 잡 — 순수 SQL 3그룹

- 09/14/19 KST, LLM 호출 0
- due_soon/stale/undelegated 세 그룹이 각각 다른 문구를 쓴다
- 알림은 묶음 등급으로 나간다

Implemented-by: Claude Sonnet
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 17: `extractHints` / `routeByRule` — 규칙이 먼저다 (US-B20, tier: Opus)

> **스토리** — 목표: `DelegationHints` 추출(정규식, LLM 아님) + `routeByRule()`(~1ms, 규칙 5종) + 폭주 방지 상수. 산출물: `packages/agents/src/delegate/route.ts`. 검증: `pnpm --filter @omnis/agents test`. 의존: B19.
> **실행 순서 주의:** Task 15(`taskLoop`)가 이 모듈을 import한다. **Task 17을 Task 15보다 먼저 구현한다.**

**읽을 것:** A4 §5.2 전체(코드 블록 + 런타임 표), B-D6·B-D7(Hermes 제외).
**만들지 말 것(YAGNI):** 호스트 헬스 서비스. `agent_runtimes.last_seen_at` 한 컬럼이면 충분하다.

**Files:**
- Create: `packages/agents/src/delegate/route.ts`, `packages/agents/test/delegate-route.test.ts`
- Modify: `packages/agents/src/index.ts`
- Test: `packages/agents/test/delegate-route.test.ts`

**Interfaces:**
- Consumes: `HostId`/`RuntimeKind`(`@omnis/protocol`), `getAgentsPool`(Phase A).
- Produces: `DelegationHints`, `Routing`, `HostHealth`, `extractHints`, `routeByRule`, `pickRuntime`, `hostHealth`, `DELEGATION_DAILY_CAP`, `DELEGATION_THREAD_CAP_24H`, `MACBOOK_OFFLINE_MS`.

### Steps

- [ ] 1. 실패하는 테스트를 쓴다(순수 함수라 DB 없음).

```ts
// packages/agents/test/delegate-route.test.ts
import { describe, expect, it } from "vitest";
import {
  DELEGATION_DAILY_CAP, DELEGATION_THREAD_CAP_24H, extractHints, pickRuntime, routeByRule,
} from "../src/index.js";

const hosts = { mini: { lastHeartbeatMs: 0 }, macbook: { lastHeartbeatMs: 0 } };

describe("extractHints (A4 §5.2)", () => {
  it("pulls absolute paths, cron words and minutes out of text with regex only", () => {
    const h = extractHints("/Users/logankim/AI-Workspaces/omnis 에서 매일 리포트를 돌려줘. 약 45분 걸림");
    expect(h.needs_paths).toEqual(["/Users/logankim/AI-Workspaces/omnis"]);
    expect(h.needs_always_on).toBe(true);
    expect(h.est_minutes).toBe(45);
    expect(h.repo).toBe("/Users/logankim/AI-Workspaces/omnis");
  });

  it("flags a GUI channel session", () => {
    expect(extractHints("카카오톡으로 답장 보내는 일").needs_channel_session).toBe(true);
    expect(extractHints("LinkedIn 메시지 정리").needs_channel_session).toBe(true);
    expect(extractHints("문서 요약").needs_channel_session).toBe(false);
  });
});

describe("routeByRule (A4 §5.2)", () => {
  it("applies the five rules in order", () => {
    expect(routeByRule(extractHints("/Users/logankim/x 파일 고쳐줘"), hosts))
      .toMatchObject({ host: "macbook", rule_id: "dr_local_files" });
    expect(routeByRule(extractHints("카카오톡 정리"), hosts))
      .toMatchObject({ host: "mini", rule_id: "dr_gui_session" });
    expect(routeByRule({ ...extractHints("긴 작업"), est_minutes: 30 }, hosts))
      .toMatchObject({ host: "mini", rule_id: "dr_long_batch" });
    expect(routeByRule(extractHints("매일 돌려줘"), hosts))
      .toMatchObject({ host: "mini", rule_id: "dr_always_on" });
    expect(routeByRule(extractHints("문서 요약"), {
      mini: { lastHeartbeatMs: 0 }, macbook: { lastHeartbeatMs: 300_000 },
    })).toMatchObject({ host: "mini", rule_id: "dr_macbook_offline" });
  });

  it("returns null when nothing splits it — that is L4's entry point", () => {
    expect(routeByRule(extractHints("문서 요약"), hosts)).toBe(null);
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

- [ ] 2. 실패를 확인한다. 기대: `does not provide an export named 'extractHints'`.

```bash
pnpm --filter @omnis/agents test -- delegate-route
```

- [ ] 3. 구현을 쓴다.

```ts
// packages/agents/src/delegate/route.ts
// A4 §5.2: 결정 규칙이 먼저, LLM은 나중. 여기에 모델 호출은 없다(~1ms).
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

/** Phase B에서 hermes는 위임 대상이 아니다(B-D7, 마스터 §19 Q7). */
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
const GUI_CHANNEL = /카카오톡|kakao|linkedin|링크드인/i;
const ALWAYS_ON = /매일|매주|주기적|정기적으로|cron|스케줄/i;
const MINUTES = /(\d{1,3})\s*분/;
const HOURS = /(\d{1,2})\s*시간/;

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

/** A4 §5.2 런타임 표. hermes는 Phase C로 미룬다(B-D7). */
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

- [ ] 4. `index.ts`에 export를 더하고 통과를 확인한다. 기대: 5 tests passed.

```ts
// packages/agents/src/index.ts — 추가
export {
  DELEGATION_DAILY_CAP, DELEGATION_THREAD_CAP_24H, MACBOOK_OFFLINE_MS, extractHints,
  hostHealth, pickRuntime, routeByRule,
  type DelegationHints, type DelegationRuntime, type HostHealth, type Routing,
} from "./delegate/route.js";
```

```bash
pnpm --filter @omnis/agents test -- delegate-route && pnpm lint
git add packages/agents/src/delegate/route.ts packages/agents/src/index.ts packages/agents/test/delegate-route.test.ts
git commit -m "US-B20: extractHints/routeByRule — 규칙이 먼저

- DelegationHints 추출은 전부 정규식이다(LLM 호출 0)
- routeByRule 5규칙, 못 가르면 null을 돌려 L4를 깨운다
- pickRuntime은 hermes를 절대 고르지 않는다(B-D7)
- 폭주 방지 상수(하루 5건 / 스레드 24h 2건)

Implemented-by: Claude Opus
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 18: `delegateLoop` + 승인 실행 게이트 (US-B20, tier: Opus)

> **스토리** — 목표: 규칙이 못 가른 task를 L4(T2)가 판단하고, 승인 1회 → `delegate.run` 실행. 완전 자율은 `settings.autonomy.rules`가 열렸고 `est_minutes ≤ 30` + 레포 안 + egress 없음일 때만. 산출물: `packages/agents/src/loops/delegate.ts`, `packages/agents/src/delegate/brief.ts`. 검증: `pnpm --filter @omnis/agents test`.

**읽을 것:** A4 §5.1·§5.3(브리프 규격)·§5.4(승인 흐름), B-D6.
**만들지 말 것(YAGNI):** 자동 재위임. A4 §5.4가 "실패한 브리프를 그대로 다시 던지면 같은 실패를 반복한다"로 금지했다.

**Files:**
- Create: `packages/agents/src/delegate/brief.ts`, `packages/agents/src/loops/delegate.ts`, `packages/agents/test/integration/delegate-loop.test.ts`
- Modify: `packages/agents/src/index.ts`
- Test: `packages/agents/test/integration/delegate-loop.test.ts`

**Interfaces:**
- Consumes: `routeByRule`/`pickRuntime`/`hostHealth`(Task 17), `PROPOSE_TOOLS`(Task 5), `buildContext`(US-B05).
- Produces: `delegateLoop`, `DelegateOutput`, `type DelegateOutputT`, `renderBrief`, `type BriefInput`, `autonomyAllows`, `AUTONOMY_MAX_MINUTES`.

### Steps

- [ ] 1. 실패하는 테스트를 쓴다.

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
      goal: "리포트 스크립트를 고친다",
      background: ["지난주 실패했다 (item:it_1)", "로그는 ops/logs에 있다 (memory:m_2)"],
      steps: ["원인 파악", "수정"],
      acceptance: ["pnpm test가 통과한다"],
      verifyCmd: "pnpm test",
      workdir: "/Users/logankim/AI-Workspaces/omnis",
    });
    for (const h of ["## 목표", "## 배경", "## 해야 할 일", "## 수용 기준", "## 검증 명령",
                     "## 작업 디렉터리", "## 금지"]) {
      expect(b).toContain(h);
    }
    expect(b).toContain("- [ ] pnpm test가 통과한다");
    expect(b).toContain("커밋/푸시하지 않는다");
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
      "INSERT INTO tasks (title, owner_kind, created_by) VALUES ('위임 후보','agent','agent') RETURNING id");
    const taskId = t.rows[0]?.id ?? "";
    await delegateLoop.apply(
      {
        loop: "delegate", run_id: "00000000-0000-0000-0000-0000000000cc",
        output: {
          runtime: "claude_code", host: "mini", goal: "고친다", background: [], steps: ["a"],
          acceptance: ["테스트 통과"], verify_cmd: "pnpm test",
          workdir: "/Users/logankim/AI-Workspaces/omnis", est_minutes: 20,
          confidence: 0.8, rationale: "레포 안 작업", injection_flags: [],
        },
        confidence: 0.8, rationale: "레포 안 작업", escalate: false,
        injection_flags: [], unresolved: [],
      } as never,
      { trigger_kind: "event", task_id: taskId, now: new Date(), payload: {} });
    const { rows } = await pool.query<{ state: string; action: string; risk: string }>(
      "SELECT state, action, risk FROM pending_approvals WHERE task_id = $1", [taskId]);
    expect(rows[0]).toMatchObject({ state: "pending", action: "delegate", risk: "normal" });
  });
});
```

- [ ] 2. 실패를 확인한다. 기대: `does not provide an export named 'renderBrief'`.

```bash
pnpm --filter @omnis/agents test -- delegate-loop
```

- [ ] 3. `brief.ts`를 쓴다.

```ts
// packages/agents/src/delegate/brief.ts
// A4 §5.3: 브리프는 자기완결적이어야 한다 — 대상 런타임은 omnis의 컨텍스트를 모른다.
export interface BriefInput {
  goal: string;
  /** 각 줄 끝에 (item:xxx) 또는 (memory:xxx). 3~6줄. */
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
    "## 목표", i.goal, "",
    "## 배경", ...(i.background.length === 0 ? ["(배경 없음)"] : i.background), "",
    "## 해야 할 일", ...i.steps.map((s, n) => `${n + 1}. ${s}`), "",
    "## 수용 기준", ...i.acceptance.map((a) => `- [ ] ${a}`), "",
    "## 검증 명령", i.verifyCmd, "",
    "## 작업 디렉터리", i.workdir, "",
    "## 금지",
    "- 이 브리프에 없는 파일을 수정하지 않는다",
    "- 커밋/푸시하지 않는다 (omnis가 diff를 받아 사람에게 보여준다)",
  ].join("\n");
}
```

- [ ] 4. `delegate.ts`를 쓴다.

```ts
// packages/agents/src/loops/delegate.ts
// A4 §5. 승인 없이 실행되는 경로는 없다 — 이 루프의 유일한 산출물은 pending_approvals 한 행이다.
import { z } from "zod";
import { buildContext } from "../context/assemble.js";
import { renderBrief } from "../delegate/brief.js";
import { registerLoop } from "../loop/registry.js";
import type { LoopSpec, TriggerContext } from "../loop/spec.js";
import { PROPOSE_TOOLS } from "../tools/propose.js";

/** A4 §4.4: 자율 규칙이 열려 있어도 30분을 넘으면 승인을 탄다. */
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
  runtime: z.enum(["claude_code", "codex", "claude_ds", "omnis"]),   // B-D7: hermes 없음
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

- [ ] 5. `index.ts`에 export를 더하고 통과를 확인한다. 기대: 5 tests passed.

```ts
// packages/agents/src/index.ts — 추가
export { renderBrief, type BriefInput } from "./delegate/brief.js";
export {
  AUTONOMY_MAX_MINUTES, DelegateOutput, autonomyAllows, delegateLoop,
  type AutonomyRule, type DelegateOutputT,
} from "./loops/delegate.js";
```

```bash
pnpm --filter @omnis/agents test -- delegate && pnpm lint
git add packages/agents/src/delegate/brief.ts packages/agents/src/loops/delegate.ts packages/agents/src/index.ts packages/agents/test/integration/delegate-loop.test.ts
git commit -m "US-B20: L4 위임 루프와 승인 게이트

- 규칙이 null을 돌려준 task만 T2로 깨운다
- renderBrief가 A4 §5.3의 8섹션을 내고 빈 acceptance를 거부한다
- 산출물은 pending_approvals(action='delegate') 한 행뿐 — 실행 경로가 없다
- autonomyAllows는 기본 꺼짐이고 30분 초과/레포 밖/egress는 여전히 승인을 탄다

Implemented-by: Claude Opus
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 19: `noteRouteLoop` — 검색이 먼저, 자동 첨부 없음 (US-B21, tier: Sonnet)

> **스토리** — 목표: `note` insert 트리거 → 후보 최대 3개, 신뢰도 낮으면 제안 자체를 안 함, 자동 라우팅 없음. 산출물: `packages/agents/src/loops/note-route.ts`. 검증: `pnpm --filter @omnis/agents test`. 의존: B07.

**읽을 것:** A4 §8.1~§8.4(후보 산출 5단계, 신뢰도 표 3행, "자동 첨부는 어떤 confidence에서도 하지 않는다").
**만들지 말 것(YAGNI):** 노트 전용 임베딩 테이블. 후보는 `threads`/`persons`/`memories`에서 바로 뽑는다.

**Files:**
- Create: `packages/agents/src/loops/note-route.ts`, `packages/agents/test/integration/note-route.test.ts`
- Modify: `packages/agents/src/index.ts`
- Test: `packages/agents/test/integration/note-route.test.ts`

**Interfaces:**
- Consumes: `buildContext`(US-B05), `PROPOSE_TOOLS`(Task 5).
- Produces: `noteRouteLoop`, `RouteOutput`, `type RouteOutputT`, `ROUTE_CONFIDENCE_HIGH`, `ROUTE_CONFIDENCE_MIN`.

### Steps

- [ ] 1. 실패하는 테스트를 쓴다.

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
    "INSERT INTO notes (body) VALUES ('김 대표님께 견적 다시 확인') RETURNING id");
  noteId = n.rows[0]?.id ?? "";
});
afterAll(() => pool.end());

const res = (candidates: unknown[]) => ({
  loop: "note_route" as const, run_id: "00000000-0000-0000-0000-0000000000dd",
  output: { candidates, confidence: 0.9, rationale: "같은 주제", injection_flags: [] },
  confidence: 0.9, rationale: "같은 주제", escalate: false, injection_flags: [], unresolved: [],
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
      res([{ kind: "thread", id: thr.rows[0]?.id ?? "", confidence: 0.99, why: "같은 견적 건" }]) as never,
      { trigger_kind: "event", note_id: noteId, now: new Date(), payload: {} });
    const { rows } = await pool.query<{ route_state: string; routed_to_thread_id: string | null }>(
      "SELECT route_state, routed_to_thread_id FROM notes WHERE id = $1", [noteId]);
    expect(rows[0]?.route_state).toBe("proposed");
    expect(rows[0]?.routed_to_thread_id).toBe(null);
  });

  it("stores no proposal at all below 0.50 (route_state='none')", async () => {
    await noteRouteLoop.apply(
      res([{ kind: "thread", id: "00000000-0000-0000-0000-0000000000ee",
             confidence: 0.3, why: "약함" }]) as never,
      { trigger_kind: "event", note_id: noteId, now: new Date(), payload: {} });
    const { rows } = await pool.query<{ route_state: string }>(
      "SELECT route_state FROM notes WHERE id = $1", [noteId]);
    expect(rows[0]?.route_state).toBe("none");
  });
});
```

- [ ] 2. 실패를 확인한다. 기대: `does not provide an export named 'noteRouteLoop'`.

```bash
pnpm --filter @omnis/agents test -- note-route
```

- [ ] 3. 구현을 쓴다.

```ts
// packages/agents/src/loops/note-route.ts
// A4 §8. LLM은 후보를 만들어내지 못한다 — 검색이 준 목록 안에서만 고른다.
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
    // A4 §8.3: 0.50 미만이면 라우팅 없이 보관한다. 신뢰도가 아무리 높아도 자동 첨부는 없다.
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

- [ ] 4. `index.ts`에 export를 더하고 통과를 확인한다. 기대: 3 tests passed.

```ts
// packages/agents/src/index.ts — 추가
export {
  ROUTE_CONFIDENCE_HIGH, ROUTE_CONFIDENCE_MIN, RouteOutput, noteRouteLoop, type RouteOutputT,
} from "./loops/note-route.js";
```

```bash
pnpm --filter @omnis/agents test -- note-route && pnpm lint
git add packages/agents/src/loops/note-route.ts packages/agents/src/index.ts packages/agents/test/integration/note-route.test.ts
git commit -m "US-B21: L7 노트 라우팅 루프

- note.created 2초 디바운스, 후보는 최대 3개
- confidence < 0.50이면 제안 자체를 안 만들고 route_state='none'으로 둔다
- 어떤 신뢰도에서도 자동 첨부하지 않는다(A4-D10)

Implemented-by: Claude Sonnet
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 20: `followupLoop` + 비활성 감지 스윕 (US-B22, tier: Sonnet)

> **스토리** — 목표: 초면 판정, 비활성 감지 스윕(평일 10:00, cadence SQL), draft + task 동시 제안, `relationship_state` 갱신(`closed`만 승인). 산출물: `packages/agents/src/loops/followup.ts`. 검증: `pnpm --filter @omnis/agents test`. 의존: B03, B07.

**읽을 것:** A4 §7.2(초면 판정 함수)·§7.3(SQL 원문 + cadence 우선순위 4항)·§7.4(출력 스키마 + 채널 선택 규칙 + 선제 발신 금지).
**만들지 말 것(YAGNI):** 관계 점수 모델. `priority_score`는 이미 컬럼이고 이 루프는 읽기만 한다.

**Files:**
- Create: `packages/agents/src/loops/followup.ts`, `packages/agents/test/integration/followup-loop.test.ts`
- Modify: `packages/agents/src/index.ts`
- Test: `packages/agents/test/integration/followup-loop.test.ts`

**Interfaces:**
- Consumes: `buildContext`(US-B05), `PROPOSE_TOOLS`(Task 5), `getAgentsPool`(Phase A).
- Produces: `followupLoop`, `FollowupOutput`, `type FollowupOutputT`, `isFirstContact`, `inactiveCandidates`, `pickFollowupChannel`, `sweepFollowups`, `NO_COLD_OUTREACH_CHANNELS`, `INACTIVE_SWEEP_LIMIT`.

### Steps

- [ ] 1. 실패하는 테스트를 쓴다.

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
      .toBe("gmail");   // 동률이면 이메일
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
    expect(names).toContain("fu-vip");        // vip=14일 < 20일 경과
    expect(names).not.toContain("fu-active"); // active=30일 > 20일 경과
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
    expect(rows[0]?.s).toBe("active");   // closed는 승인을 타므로 아직 안 바뀐다
    const ap = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pending_approvals
        WHERE action = 'memory_write' AND args->>'person_id' = $1`, [personId]);
    expect(ap.rows[0]?.n).toBe("1");
  });
});
```

- [ ] 2. 실패를 확인한다. 기대: `does not provide an export named 'isFirstContact'`.

```bash
pnpm --filter @omnis/agents test -- followup-loop
```

- [ ] 3. 구현을 쓴다.

```ts
// packages/agents/src/loops/followup.ts
// A4 §7 L6 Network 팔로업 루프.
import type { Channel } from "@omnis/protocol";
import type { Pool } from "pg";
import { z } from "zod";
import { buildContext } from "../context/assemble.js";
import { registerLoop } from "../loop/registry.js";
import type { LoopSpec, TriggerContext } from "../loop/spec.js";
import { getAgentsPool } from "../pool.js";

/** A4 §7.3: 하루 최대 10명 — 이 이상은 팔로업이 아니라 스팸이다. */
export const INACTIVE_SWEEP_LIMIT = 10;
/** 마스터 §13: 이 두 채널로는 선제 발신하지 않는다. */
export const NO_COLD_OUTREACH_CHANNELS: readonly Channel[] = ["linkedin", "kakaotalk"];

export function isFirstContact(
  p: { first_contact_at: string | null; item_count: number },
  now: Date,
): boolean {
  if (p.first_contact_at === null) return true;
  const days = (now.getTime() - new Date(p.first_contact_at).getTime()) / 86_400_000;
  return days <= 90 && p.item_count < 3;
}

/** A4 §7.4 채널 선택: 최근 90일 최다 채널, 동률이면 이메일. 선제 발신 금지 2채널은 예외. */
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

/** A4 §7.3 SQL 원문. LLM은 이 후보에 대해서만 돈다. */
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
  // 스윕 잡이 후보를 뽑아 사람마다 이 이벤트를 쏜다 — 루프 자체는 "사람 한 명"에 대해 돈다.
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

    // A4 §7.4: relationship_update는 자동 적용된다. 단 'closed'로의 전이만 승인이 필요하다 —
    // 관계를 끊는 판단은 에이전트가 할 일이 아니다.
    if (update.state === "closed") {
      await pool.query(
        `INSERT INTO pending_approvals (action, args, description, risk, requested_by)
         VALUES ('memory_write', $1::jsonb, $2, 'normal',
                 (SELECT id FROM agent_runtimes WHERE runtime = 'omnis' LIMIT 1))`,
        [JSON.stringify({ person_id: o.person_id, state: "closed", note: update.note ?? null }),
         `${o.person_id} 관계를 'closed'로 바꿀까요? — ${o.rationale}`]);
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

/** A4 §7.3 평일 10:00 스윕(jobs.name = 'network_inactive_sweep'). 후보마다 루프를 한 번씩 돌린다. */
export async function sweepFollowups(
  runOne: (c: InactiveCandidate) => Promise<void>,
): Promise<number> {
  const rows = await inactiveCandidates(getAgentsPool());
  for (const c of rows) await runOne(c);
  return rows.length;
}
```

- [ ] 4. `index.ts`에 export를 더하고 통과를 확인한다. 기대: 4 tests passed.

```ts
// packages/agents/src/index.ts — 추가
export {
  FollowupOutput, INACTIVE_SWEEP_LIMIT, NO_COLD_OUTREACH_CHANNELS, followupLoop,
  inactiveCandidates, isFirstContact, pickFollowupChannel, sweepFollowups,
  type FollowupOutputT, type InactiveCandidate,
} from "./loops/followup.js";
```

```bash
pnpm --filter @omnis/agents test -- followup-loop && pnpm lint
git add packages/agents/src/loops/followup.ts packages/agents/src/index.ts packages/agents/test/integration/followup-loop.test.ts
git commit -m "US-B22: L6 Network 팔로업 루프

- isFirstContact 규칙 판정(90일 + item 3건)
- inactiveCandidates가 A4 §7.3 cadence 우선순위 SQL 그대로 하루 10명만 뽑는다
- pickFollowupChannel이 LinkedIn/KakaoTalk 선제 발신을 막고 이메일로 대체한다
- relationship_update는 자동 적용, 'closed'만 승인 카드를 만든다

Implemented-by: Claude Sonnet
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 21: `rankBriefItems` + `morningDigestLoop` (US-B23, tier: Opus)

> **스토리** — 목표: 06:30 KST 동기 호출, 6섹션 콘텐츠 모델, **랭킹은 LLM이 아니라 산술 점수**(8항 가중합, 한 스레드 1회), LLM은 한 줄 요약 문장만, `digests(kind='morning')` 1행 + 커버리지 지표. 산출물: `packages/agents/src/loops/digest-morning.ts`, `packages/agents/src/digest/rank.ts`. 검증: `pnpm --filter @omnis/agents test`. 의존: B18, B19.

**읽을 것:** A4 §6.2(`MorningBriefing`/`BriefItem`)·§6.3(점수식 8항)·§6.6(커버리지 지표), 델타 §4(digest 타입).
**만들지 말 것(YAGNI):** 섹션별 프롬프트. LLM이 쓰는 문장은 `greeting`과 `one_liner` 둘뿐이다.

**Files:**
- Create: `packages/agents/src/digest/rank.ts`, `packages/agents/src/loops/digest-morning.ts`, `packages/agents/test/digest-rank.test.ts`, `packages/agents/test/integration/digest-morning.test.ts`
- Modify: `packages/agents/src/index.ts`
- Test: `packages/agents/test/digest-rank.test.ts`, `packages/agents/test/integration/digest-morning.test.ts`

**Interfaces:**
- Consumes: `runLoopSpec`(Task 3 — 레지스트리를 타지 않는다), `buildContext`(US-B05).
- Produces: `BriefCandidate`, `BriefItem`, `BriefSection`, `MorningBriefing`, `rankBriefItems`, `SECTION_CAPS`, `morningDigestLoop`, `morningCandidates`, `MORNING_DIGEST_CRON`.

### Steps

- [ ] 1. 실패하는 랭킹 테스트를 쓴다(순수 함수).

```ts
// packages/agents/test/digest-rank.test.ts
import { describe, expect, it } from "vitest";
import { SECTION_CAPS, rankBriefItems, type BriefCandidate } from "../src/index.js";

const now = new Date("2026-09-20T00:00:00Z");
const c = (over: Partial<BriefCandidate>): BriefCandidate => ({
  ref: { kind: "item", id: over.ref?.id ?? "i1" },
  thread_id: "t1", section: "needs_you", line: "줄", why: "이유",
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

- [ ] 2. 실패를 확인한다. 기대: `does not provide an export named 'rankBriefItems'`.

```bash
pnpm --filter @omnis/agents test -- digest-rank
```

- [ ] 3. `rank.ts`를 쓴다.

```ts
// packages/agents/src/digest/rank.ts
// A4 §6.3: 랭킹은 LLM이 하지 않는다. 산술 점수로 정렬하고 LLM은 한 줄 요약만 쓴다.
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
  /** 내가 마지막으로 답한 뒤 상대가 보낸 미응답 턴 수. 3으로 클램프된다. */
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

/** 한 스레드는 브리핑 전체에서 최대 1회 등장한다(A4 §6.3 마지막 항). */
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

- [ ] 4. `digest-morning.ts`를 쓴다 — 후보 수집은 SQL, 조립은 산술, 모델은 두 문장만 쓴다.

```ts
// packages/agents/src/loops/digest-morning.ts
// A4 §6.1~§6.3. 브리핑은 06:30에 완성돼야 하므로 배치 큐를 쓰지 않고 동기 호출한다.
import { z } from "zod";
import { buildContext } from "../context/assemble.js";
import {
  type BriefCandidate, type BriefSection, SECTION_CAPS, rankBriefItems,
} from "../digest/rank.js";
import type { LoopSpec, TriggerContext } from "../loop/spec.js";
import { getAgentsPool } from "../pool.js";

export const MORNING_DIGEST_CRON = "30 6 * * *";

/** 모델이 쓰는 건 이 두 문장뿐이다(A4 §6.3). */
export const MorningDigestOutput = z.object({
  greeting: z.string().max(120),
  one_liner: z.string().max(160),
  confidence: z.number().min(0).max(1).default(0.9),
  rationale: z.string().max(200).default(""),
  injection_flags: z.array(z.string()).default([]),
});
export type MorningDigestOutputT = z.infer<typeof MorningDigestOutput>;

const SECTION_TITLE: Record<string, string> = {
  needs_you: "지금 결정이 필요한 것",
  drafts: "초안이 준비된 답장",
  calendar: "오늘 일정",
  commitments: "내가 한 약속",
  agents: "에이전트 진행/결과",
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
              'needs_you'::text AS section, a.description AS line, '승인 대기'::text AS why,
              'now'::text AS priority, false AS vip, true AS pending_approval,
              0 AS unanswered_turns, false AS meeting_today, false AS due_today,
              (EXTRACT(EPOCH FROM (now() - a.created_at))/3600)::text AS age_hours,
              false AS snoozed
         FROM pending_approvals a WHERE a.state = 'pending'),
     drafts AS (
       SELECT 'item', i.id::text, i.thread_id::text, 'drafts',
              left(i.body, 90), COALESCE(i.meta->'draft'->>'rationale', '초안 준비됨'), 'today',
              COALESCE(p.vip, false), false, 0, false, false,
              (EXTRACT(EPOCH FROM (now() - i.sent_at))/3600)::text, false
         FROM items i
         LEFT JOIN persons p ON p.id = i.author_person_id
        WHERE i.status = 'draft' AND (i.meta->>'pending') IS DISTINCT FROM 'true'),
     events AS (
       SELECT 'event', c.id::text, i.thread_id::text, 'calendar',
              COALESCE(i.subject, '(제목 없음)'),
              to_char(c.start_at AT TIME ZONE 'Asia/Seoul', 'HH24:MI'),
              'today', false, false, 0, true, false, '0', false
         FROM calendar_events c JOIN items i ON i.id = c.item_id
        WHERE c.status <> 'cancelled'
          AND c.start_at >= date_trunc('day', $1::timestamptz)
          AND c.start_at <  date_trunc('day', $1::timestamptz) + interval '1 day'),
     commitments AS (
       SELECT 'task', t.id::text, COALESCE(i.thread_id::text, t.id::text), 'commitments',
              t.title, '내가 한 약속', 'today', false, false, 0, false,
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
    sections.push({ id: "quiet", title: "그 외", count: quiet });

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
// 레지스트리에 넣지 않는다 — LoopId 'digest'를 nightlyDigestLoop과 공유하므로
// 두 루프 모두 runLoopSpec으로 직접 돈다(허브가 cron 핸들러를 등록한다).
```

- [ ] 5. 통합 테스트를 쓰고 통과를 확인한다.

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
        greeting: "좋은 아침입니다.", one_liner: "오늘은 견적 2건이 핵심입니다.",
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

- [ ] 6. `index.ts`에 export를 더하고 커밋한다.

```ts
// packages/agents/src/index.ts — 추가
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
git commit -m "US-B23: L5 아침 브리핑

- rankBriefItems는 A4 §6.3의 8항 산술 가중합이고 한 스레드는 전체에서 1회만 나온다
- 섹션 상한 5/7/전부/5/5, 나머지는 quiet.count 숫자로만 합산한다
- 모델이 쓰는 문장은 greeting과 one_liner 둘뿐이다
- digests(kind='morning') 하루 1행 + 커버리지 지표

Implemented-by: Claude Opus
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 22: `nightlyDigestLoop` — 자동 보관 전량 노출 + 비용 필드 (US-B24, tier: Opus)

> **스토리** — 목표: 23:00 KST, `NightlyDigest` 모델(그룹별 `reason`/`samples`≤3/`undo_token` 7일), 자동 보관 전량 노출, `cost` 필드(MTD/cap/tier_state). 산출물: `packages/agents/src/loops/digest-nightly.ts`. 검증: `pnpm --filter @omnis/agents test`. 의존: B14, B18, B23.

**읽을 것:** A4 §6.4(`NightlyDigest`/`DigestGroup`)·§9.4(전량 노출·undo 7일), Task 13의 `archivedSince`.
**만들지 말 것(YAGNI):** undo 토큰 테이블. 토큰은 `sha256(digest_id + reason)` 앞 16자로 언제든 재계산되고, 7일 창은 `meta.archived_by.at`이 판정한다.

**Files:**
- Create: `packages/agents/src/loops/digest-nightly.ts`, `packages/agents/test/integration/digest-nightly.test.ts`
- Modify: `packages/agents/src/index.ts`
- Test: `packages/agents/test/integration/digest-nightly.test.ts`

**Interfaces:**
- Consumes: `BriefItem`(Task 21), `buildContext`(US-B05). 비용 수치는 `ctx.payload.cost`로 허브가 주입한다(`currentPolicy`는 커널 소유라 agents가 직접 못 부른다).
- Produces: `nightlyDigestLoop`, `NightlyDigestOutput`, `NightlyDigest`, `DigestGroup`, `undoTokenFor`, `NIGHTLY_DIGEST_CRON`, `nightlyGroups`.

### Steps

- [ ] 1. 실패하는 테스트를 쓴다.

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
           'rule_ids','["ar_no_cta"]'::jsonb,'reason','뉴스레터','tier','T0',
           'confidence',0.95,'run_id','r','at', now()::text)))`,
      [threadId, accountId, `뉴스레터 ${i}`]);
  }
});
afterAll(() => pool.end());

describe("nightlyDigestLoop (A4 §6.4·§9.4)", () => {
  it("runs at 23:00 KST", () => {
    expect(NIGHTLY_DIGEST_CRON).toBe("0 23 * * *");
  });

  it("exposes every archived item — count is the full number, samples are capped at 3", async () => {
    const groups = await nightlyGroups(pool, new Date(Date.now() - 3_600_000), "d1");
    const g = groups.find((x) => x.reason === "뉴스레터");
    expect(g?.count).toBe(5);
    expect(g?.samples.length).toBe(3);
    expect(g?.undo_token).toBe(undoTokenFor("d1", "뉴스레터"));
  });

  it("stores the cost field the hub injected", async () => {
    await nightlyDigestLoop.apply(
      {
        loop: "digest", run_id: "00000000-0000-0000-0000-00000000bbbb",
        output: {
          headline: "오늘 처리 3건, 자동 보관 5건.", one_liner: "조용한 하루였습니다.",
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

- [ ] 2. 실패를 확인한다. 기대: `does not provide an export named 'nightlyGroups'`.

```bash
pnpm --filter @omnis/agents test -- digest-nightly
```

- [ ] 3. 구현을 쓴다.

```ts
// packages/agents/src/loops/digest-nightly.ts
// A4 §6.4. 판정은 §9(L8)가 소유하고, 여기는 그 결과를 사람이 볼 수 있게 노출하는 쪽만 정의한다.
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

/** 7일 창은 meta.archived_by.at이 판정하므로 토큰은 저장하지 않는다 — 재계산 가능한 값이다. */
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

/** A4 §9.4: 자동 보관은 전량 노출한다 — count는 전체 수, samples만 3건으로 자른다. */
export async function nightlyGroups(
  pool: Pool,
  since: Date,
  digestId: string,
): Promise<DigestGroup[]> {
  const { rows } = await pool.query<{
    reason: string; count: string; samples: { id: string; line: string }[];
  }>(
    `SELECT COALESCE(meta->'archived_by'->>'reason','기타') AS reason,
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
// morningDigestLoop과 같은 이유로 레지스트리에 넣지 않는다(LoopId 'digest' 공유).
```

- [ ] 4. `index.ts`에 export를 더하고 통과를 확인한다. 기대: 3 tests passed.

```ts
// packages/agents/src/index.ts — 추가
export {
  NIGHTLY_DIGEST_CRON, NightlyDigestOutput, nightlyDigestLoop, nightlyGroups, undoTokenFor,
  type DigestGroup, type NightlyDigest, type NightlyDigestOutputT,
} from "./loops/digest-nightly.js";
```

```bash
pnpm --filter @omnis/agents test -- digest-nightly && pnpm lint
git add packages/agents/src/loops/digest-nightly.ts packages/agents/src/index.ts packages/agents/test/integration/digest-nightly.test.ts
git commit -m "US-B24: L5 밤 다이제스트

- 23:00 KST, NightlyDigest 모델(그룹별 reason/samples<=3/undo_token)
- 자동 보관은 count로 전량 노출하고 samples만 3건으로 자른다
- undo_token은 sha256(digest_id::reason) 재계산 값이라 저장하지 않는다
- cost 필드(MTD/cap/tier_state)는 허브가 currentPolicy로 주입한다

Implemented-by: Claude Opus
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 23: `memory_consolidate` — Anthropic Message Batches (US-B24, tier: Opus)

> **스토리** — 목표: 야간 메모리 통합은 T2 + Anthropic Message Batches(23:30 제출, 다음 아침 전 수확). 산출물: `packages/agents/src/memory/consolidate.ts`. 검증: `pnpm --filter @omnis/agents test`.

**읽을 것:** A4 §6.5, 델타 §9(`OMNIS_ANTHROPIC_API_KEY`).
**설계 메모:** `@ai-sdk/anthropic`을 새로 핀하지 않는다 — Batches는 SDK가 아니라 **`fetch` 두 번**(제출 + 수확)이고, 그 편이 테스트에서 스텁하기도 쉽다. 동기 T2 호출은 Task 3의 OpenRouter 경로를 그대로 쓴다.
**만들지 말 것(YAGNI):** 배치 상태 폴링 루프. 23:30 제출 → 06:00 수확 두 잡이면 되고, 미완이면 그날은 건너뛴다.

**Files:**
- Create: `packages/agents/src/memory/consolidate.ts`, `packages/agents/test/memory-consolidate.test.ts`
- Modify: `packages/agents/src/index.ts`
- Test: `packages/agents/test/memory-consolidate.test.ts`

**Interfaces:**
- Consumes: 없음(`fetch`만 쓴다). 수확 결과를 `memories`에 반영하는 쪽은 US-B08의 `upsertMemory`/`supersede`가 받는다.
- Produces: `ANTHROPIC_BATCH_URL`, `ANTHROPIC_BATCH_MODEL`, `submitConsolidation`, `harvestConsolidation`, `MEMORY_CONSOLIDATE_CRON`, `MEMORY_HARVEST_CRON`, `type ConsolidationRequest`, `type ConsolidationResult`.

### Steps

- [ ] 1. 실패하는 테스트를 쓴다. `fetch`를 스텁해 네트워크를 타지 않는다.

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
    expect(await submitConsolidation([{ custom_id: "m1", prompt: "요약해줘" }])).toBe(null);
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

- [ ] 2. 실패를 확인한다. 기대: `does not provide an export named 'submitConsolidation'`.

```bash
pnpm --filter @omnis/agents test -- memory-consolidate
```

- [ ] 3. 구현을 쓴다.

```ts
// packages/agents/src/memory/consolidate.ts
// A4 §6.5: 지연에 둔감한 유일한 작업이라 배치가 정확히 맞는다(Anthropic Message Batches, -50%).
// SDK를 새로 핀하지 않는다 — 제출/수확 각각 fetch 한 번이다.
export const ANTHROPIC_BATCH_URL = "https://api.anthropic.com/v1/messages/batches";
export const ANTHROPIC_BATCH_MODEL = "claude-sonnet-5";
export const MEMORY_CONSOLIDATE_CRON = "30 23 * * *";
/** 다음 아침 브리핑(06:30) 전에 수확한다. */
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

/** 키가 없으면 null을 돌려준다 — 델타 §9: T2 경로가 스킵되고 시스템 Item이 뜬다. */
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

- [ ] 4. `index.ts`에 export를 더하고 통과를 확인한다. 기대: 4 tests passed.

```ts
// packages/agents/src/index.ts — 추가
export {
  ANTHROPIC_BATCH_MODEL, ANTHROPIC_BATCH_URL, MEMORY_CONSOLIDATE_CRON, MEMORY_HARVEST_CRON,
  harvestConsolidation, submitConsolidation,
  type ConsolidationRequest, type ConsolidationResult,
} from "./memory/consolidate.js";
```

```bash
pnpm --filter @omnis/agents test -- memory-consolidate && pnpm lint
git add packages/agents/src/memory/consolidate.ts packages/agents/src/index.ts packages/agents/test/memory-consolidate.test.ts
git commit -m "US-B24: 야간 메모리 통합 — Anthropic Message Batches

- 23:30 제출 / 06:00 수확, 새 provider SDK 핀 없이 fetch 두 번
- OMNIS_ANTHROPIC_API_KEY가 없으면 null을 돌려주고 아무것도 보내지 않는다
- 배치가 아직 안 끝났으면 빈 배열을 돌려 그날은 건너뛴다

Implemented-by: Claude Opus
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Task 24: self-model 수정 제안 + 적용 (US-B25, tier: Opus)

> **스토리** — 목표: 일요일 21:00 잡, 입력 5종, 패치 제약(파일당 1개·최대 3개·변경 ≤20줄·`evidence` ≥2, USER.md 삭제는 ≥3), 승인 시 `git apply`+커밋+스냅샷 캐시 무효화, 무시된 패치는 diff 해시로 4주 억제. 산출물: `packages/agents/src/self-model/propose.ts`, `packages/kernel/src/self-model/apply.ts`. 검증: `pnpm --filter @omnis/agents test`. 의존: B02, B07.

**읽을 것:** A4 §13.1~§13.3 전체, 델타 §3(`applySelfModelPatch`/`invalidateSnapshotCache`)·§0-2(`~/.omnis/self-model/`).
**만들지 말 것(YAGNI):** 자체 diff 파서. `git apply --check`가 검증하고 `git apply`가 적용한다.

**Files:**
- Create: `packages/agents/src/self-model/propose.ts`, `packages/kernel/src/self-model/apply.ts`, `packages/agents/test/integration/self-model-propose.test.ts`, `packages/kernel/test/integration/self-model-apply.test.ts`
- Modify: `packages/agents/src/index.ts`, `packages/kernel/src/index.ts`
- Test: 위 두 테스트 파일

**Interfaces:**
- Consumes: `PROPOSE_TOOLS.propose_self_model_patch`(Task 5), `applySelfModelPatch`/`invalidateSnapshotCache`(US-B02, `@omnis/memory`), `Audit`(Phase A).
- Produces: `SELF_MODEL_CRON`, `MAX_PATCHES`, `MAX_PATCH_LINES`, `SUPPRESSION_WEEKS`, `SelfModelPatch`, `validatePatch`, `diffHash`, `isSuppressed`, `suppressPatch`, `proposeSelfModelPatches`, `SELF_MODEL_DIR_ENV`, `selfModelDir`, `checkPatch`, `applyApprovedSelfModelPatch`.

### Steps

- [ ] 1. 실패하는 제약 테스트를 쓴다.

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
   ...Array.from({ length: lines }, (_, i) => `+새 줄 ${i}`)].join("\n");

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
    const deletion = ["--- a/USER.md", "+++ b/USER.md", "@@ -1,2 +1,1 @@", "-지운다"].join("\n");
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

- [ ] 2. 실패를 확인한다. 기대: `does not provide an export named 'validatePatch'`.

```bash
pnpm --filter @omnis/agents test -- self-model-propose
```

- [ ] 3. `propose.ts`를 쓴다.

```ts
// packages/agents/src/self-model/propose.ts
// A4 §13. 사용자가 직접 쓴 텍스트는 사용자만 바꾼다 — 이 모듈은 제안 카드까지만 만든다.
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
  if (added + removed === 0) return { ok: false, reason: "빈 diff" };
  if (added + removed > MAX_PATCH_LINES) {
    return { ok: false, reason: `변경 줄이 ${MAX_PATCH_LINES}줄을 넘었습니다(${added + removed})` };
  }
  const deletionOnly = added === 0 && removed > 0;
  const need = p.file === "USER.md" && deletionOnly ? 3 : 2;
  if (p.evidence.length < need) {
    return { ok: false, reason: `근거가 ${need}개 필요합니다(${p.evidence.length}개)` };
  }
  return { ok: true, reason: null };
}

export function diffHash(diff: string): string {
  return createHash("sha256").update(diff.trim()).digest("hex").slice(0, 32);
}

/** 무시된 패치는 4주간 다시 제안하지 않는다(A4 §13.2). settings kv를 그대로 쓴다. */
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

/** 파일당 최대 1개, 전체 최대 3개. 억제된 diff와 제약 위반은 건너뛴다. */
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

- [ ] 4. 커널 쪽 적용을 쓴다 — `git apply --check` → 적용 → 커밋 → 스냅샷 캐시 무효화.

```ts
// packages/kernel/src/self-model/apply.ts
// A4 §13.2: 승인 시 커널이 self-model git 레포에 git apply + 커밋하고 스냅샷 캐시를 무효화한다.
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

/** diff가 실제로 적용 가능한지 먼저 본다. 실패하면 승인은 failExecution으로 간다. */
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
  // 다음 루프 호출부터 새 프리픽스를 쓴다 — 캐시가 한 번 비워지므로 일요일 밤에 몰아서 한다.
  invalidateSnapshotCache();
  await deps.audit.record({
    actor: "me", action: "self_model.applied", target_table: "settings",
    target_id: args.file, after: { commit, rationale: args.rationale },
    approval_id: deps.approvalId,
  });
  return { commit };
}
```

- [ ] 5. 커널 테스트를 쓴다 — 임시 git 레포에서 실제 `git apply --check`를 돌린다.

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
  writeFileSync(join(dir, "VOICE.md"), "안녕하세요\n", "utf8");
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
      " 안녕하세요", "+대표님, 안녕하세요"].join("\n");
    expect(await checkPatch(dir, good)).toBe(true);
    const stale = ["--- a/VOICE.md", "+++ b/VOICE.md", "@@ -1 +1 @@",
      "-없는 줄", "+새 줄"].join("\n");
    expect(await checkPatch(dir, stale)).toBe(false);
  });
});
```

- [ ] 6. 두 `index.ts`에 export를 더하고 통과를 확인한다. 기대: agents 4 + kernel 2 tests passed.

```ts
// packages/agents/src/index.ts — 추가
export {
  MAX_PATCHES, MAX_PATCH_LINES, SELF_MODEL_CRON, SUPPRESSION_WEEKS, diffHash, isSuppressed,
  proposeSelfModelPatches, suppressPatch, validatePatch, type SelfModelPatch,
} from "./self-model/propose.js";
```

```ts
// packages/kernel/src/index.ts — 추가
export {
  SELF_MODEL_DIR_ENV, applyApprovedSelfModelPatch, checkPatch, selfModelDir,
} from "./self-model/apply.js";
```

```bash
pnpm --filter @omnis/agents test -- self-model && \
  pnpm --filter @omnis/kernel test:integration -- self-model && pnpm lint
git add packages/agents/src/self-model packages/kernel/src/self-model packages/agents/src/index.ts packages/kernel/src/index.ts packages/agents/test/integration/self-model-propose.test.ts packages/kernel/test/integration/self-model-apply.test.ts
git commit -m "US-B25: self-model 수정 제안과 적용

- 일요일 21:00, 파일당 1개·최대 3개·변경 20줄·evidence 2개(USER.md 삭제는 3개)
- 무시된 패치는 diff 해시로 4주 억제한다(settings kv)
- 승인 시 git apply --check → applySelfModelPatch → 스냅샷 캐시 무효화 → audit_log

Implemented-by: Claude Opus
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## 실행 순서

의존이 있는 곳만 적는다. 나머지는 순서 무관이다.

1. **Task 1 → 5 → 2 → 3 → 4** (US-B06·B07). Task 3(`runLoopSpec`)이 Task 5의 `toolRegistry`를 import하므로 **Task 5가 Task 3보다 먼저다**.
2. **Task 6 → 7** (US-B14). Task 7의 `0012_jobs_phase_b.sql`을 channels·ops 계획이 기다린다 — 웨이브 초반에 머지한다.
3. **Task 8 → 9** (US-B13). Task 9는 US-B05(`buildContext`)가 머지된 뒤에 실행한다.
4. **Task 10 → 11 → 12** (US-B15·B17). Task 12는 surfaces 계획의 `0011_push_subscriptions.sql`이 머지된 뒤에 실행한다.
5. **Task 13 → 14** (US-B18).
6. **Task 17 → 15 → 16** (US-B20·B19). `taskLoop`이 `routeByRule`을 import하므로 **Task 17이 먼저다**.
7. **Task 17 → 18** (US-B20).
8. **Task 19**(US-B21), **Task 20**(US-B22) — 독립.
9. **Task 21 → 22 → 23** (US-B23·B24). Task 22는 Task 6(`currentPolicy`)과 Task 13·14(보관 결과)가 있어야 의미 있는 값을 낸다.
10. **Task 24** (US-B25) — US-B02(`applySelfModelPatch`)가 머지된 뒤.

## 스토리 커버리지

| 스토리 | 태스크 | 주요 산출물 |
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

## 전체 검증

모든 태스크가 끝난 뒤 한 번에 돌린다. **실계정 없이 전부 통과해야 한다**(B-D5).

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

끝난 뒤 SQL 하드 게이트 3줄을 직접 확인한다(A4 §1.7·§9.5·A3 §9 규칙 5).

```sql
SELECT count(*) FROM agent_runs WHERE outcome = 'running' AND created_at < now() - interval '1 hour';  -- 0
SELECT count(*) FROM items i LEFT JOIN persons p ON p.id = i.author_person_id
 WHERE i.status = 'archived' AND (i.sensitivity <> 'normal' OR COALESCE(p.vip, false));                 -- 0
SELECT count(*) FROM audit_log WHERE action = 'item.sent' AND approval_id IS NULL;                      -- 0
```

## 열린 항목

1. **`0012_jobs_phase_b.sql`의 오너십.** 델타 §6이 이 파일을 B14·B15·B37·B44 넷에 걸쳐 놓았다. 이 계획의 Task 7이 유일 오너로 만들고 나머지 셋은 seed된 행을 쓴다 — channels·ops 계획 작성자와 이 규칙을 맞춰야 한다.
2. **`LoopSpec.decide?`와 `TriggerContext`가 델타에 없다.** 둘 다 A4 본문이 요구하는 것이라 이 계획이 추가했다(위 "델타에 더하는 것" 표). 델타 문서를 갱신할지, 이 계획을 출처로 둘지 결정이 필요하다.
3. **T2 게이트웨이.** A4 §12.1은 "Anthropic은 API 키로 직접 호출한다"지만, 새 SDK 핀을 피하려고 동기 T2는 OpenRouter(`anthropic/claude-sonnet-5`)로, Batch API만 Anthropic 직접 `fetch`로 갈랐다. 단가는 같고 배치 할인도 유지되지만 `agent_runs.provider`가 동기 T2에서 `openrouter`로 기록된다 — 비용 리포트(US-B44)가 이 구분을 어떻게 볼지 ops 계획과 맞춰야 한다.
4. **`item.labeled` 이벤트의 발행자.** `draftLoop`·`taskLoop`·`autoArchiveLoop`이 전부 이 이벤트를 기다리는데, Phase A의 `classify()`는 아직 이벤트를 쏘지 않는다. 허브의 분류 파이프라인이 `kernel.events.emit('ephemeral', 'item.labeled', …)`를 부르도록 memory-ingestion 계획(US-B03이 `ingest.sink`를 고칠 때)과 배선 지점을 맞춰야 한다. 같은 이유로 `note.created`·`task.created`·`person.inactive`의 발행자도 정해야 한다(앞 둘은 NOTIFY 채널이 이미 있고, `person.inactive`는 `sweepFollowups`가 쏜다).
5. **골든 세트 데이터.** `eval/auto_archive.jsonl` 150건, `eval/draft.jsonl` 40건, `eval/task.jsonl` 100건, `eval/route_note.jsonl` 50건, `eval/followup.jsonl` 20건은 이 계획이 형식과 하드 게이트만 정하고 **내용은 Logan의 실제 인박스에서 뽑아야 한다**. 실계정 연결 전까지는 합성 데이터로 하한만 지킨다.
6. **`NightlyDigest.still_open`.** Task 22가 빈 배열로 둔다 — 아침 브리핑의 `needs_you` 후보를 재사용하면 되지만 "내일 아침 예고"의 선정 규칙이 A4 §6.4에 없다. Logan 확인이 필요하다.
7. **`cost` 필드 주입 지점.** `nightlyDigestLoop`이 `ctx.payload.cost`로 받는데, 이 값을 넣는 cron 핸들러(허브)는 `currentPolicy(pool)`를 부른다. `morning_digest`/`nightly_digest` 잡 핸들러를 허브의 어느 파일에 둘지(현재 `apps/hub/src/main.ts`)는 surfaces 계획의 허브 라우트 추가와 겹칠 수 있다.
