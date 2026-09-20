# Agent Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 맥북·미니 두 호스트에서 도는 `local-agent` 브리지 데몬과 그 와이어 타입(`@omnis/protocol`의 `src/bridge.ts`)을 만들어, Claude Code와 Codex 런타임의 턴을 허브가 읽을 수 있는 durable/ephemeral/cold 3티어 이벤트로 정규화한다.

**Architecture:** `@omnis/protocol/src/bridge.ts`가 JSON-RPC 2.0 페이로드의 zod 스키마·에러 코드·per-request 버전 협상을 소유하는 리프 계층이고, `apps/local-agent`가 그 타입만 의존하는 단일 Node 22 프로세스로서 허브에 WebSocket을 dial한다. 브리지 안에서 `RuntimeAdapter` 구현체(Claude Code = 턴당 서브프로세스, Codex = 상주 `app-server` 자식 1개)가 런타임 원본 스트림을 `turn.item.*` 이벤트로 매핑하고, 세션 레지스트리가 안정적인 `session_key`와 회전하는 `session_id`를 분리해 보관한다. 실행 경로는 전부 모의 런타임 프로세스로 계약 테스트되며, 위임 RPC는 선언만 하고 승인 증거 없이는 `-32006`으로 거절한다.

**Tech Stack:** Node 22 · TypeScript `5.6.3` strict · pnpm `9.12.3` workspaces · zod `^3.24.1`(= `@omnis/protocol`이 고정, US-A11 — zod 4는 어느 패키지도 쓰지 않는다) · `ws` 8.18.x(WebSocket 클라이언트) · `smol-toml` 1.3.x(TOML 파서, Node 22에 내장 TOML 없음) · vitest `2.1.9`(프로젝트 `unit`/`contract`/`integration`) · Biome 1.x · Codex `app-server` `rust-v0.155.1` 핀 · Claude Code ≥ 2.1.223(`cross_project_resume` 판정 기준)

버전은 계약 §2의 전 워크스페이스 핀(FIXED)을 그대로 쓴다 — caret으로 느슨하게 풀지 않는다.

**Spec:** /Users/logankim/AI-Workspaces/omnis/docs/spec/00-omnis-design.md + 이 계획이 구현하는 부록: `A2-agent-session-bridge.md`(전체), `A6-ops-infra.md` §10(local-agent 설치·LaunchAgent), `00-omnis-design.md` §9·§4.2, `A7-dev-process.md` §1·§2·§5·§7, 계약 문서 `docs/superpowers/plans/2026-09-20-phase-a-interfaces.md`

## Global Constraints

- Node 22 + pnpm workspaces. 새 패키지는 `pnpm-workspace.yaml`의 `apps/*`·`packages/*` 글롭에 이미 들어간다(A7 §1).
- TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`. 루트 `tsconfig.base.json`을 extend하고 `references`로 빌드 순서를 잡는다(A7 §1·§2).
- Postgres 17(A3). 이 계획은 DB에 직접 붙지 않는다 — 브리지는 허브에만 말한다.
- 허브는 `127.0.0.1:8787`에만 bind한다(마스터 §4.2). 미니 브리지는 루프백으로, 맥북 브리지는 Tailscale Serve가 `/api/`로 마운트한 `wss://<mini>.ts.net/api/bridge`로 붙는다.
- 마이그레이션은 append-only 파일 `packages/db/migrations/000N_<name>.sql` + 추적 테이블 `_omnis_migrations`(A3 §8). 이 계획은 마이그레이션 파일을 **추가하지도 수정하지도 않는다**.
- 승인 게이트(US-A07)가 서기 전에는 비가역 tool(`send`/`delete`/`delegate`/`calendar_write`)을 어디에도 배선하지 않는다(A7 §7 공통 금지). 이 계획의 `delegate.run`은 **선언 + 거절**까지만이다.
- 테스트를 삭제하거나 스킵해서 통과시키지 않는다(A7 §7 공통 금지).
- provider SDK는 해당 어댑터 패키지 안에서만 import한다(A7 §7 공통 금지). `apps/local-agent`는 `@omnis/protocol` 외의 내부 패키지를 import하지 않는다.
- Keychain 아이템 이름은 A1 규칙 `omnis.<channel>.<kind>.<external_id>`, 브리지 토큰은 `omnis.bridge.token.<host>`(A2 §2.1). account 필드는 `281932556+jinhologankim@users.noreply.github.com`.
- 스토리 티어는 A7 §4를 따르고(US-A16/A18/A19 = Opus, US-A17/A19b/A20 = Sonnet), DeepSeek 디프는 전부 Sonnet 이상이 리뷰한다.
- 커밋 메시지는 `<story-id>: <한 줄 요약>`(A7 §6) + 본문에 충족한 acceptance criteria, 마지막 줄은 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. (계약 §9는 실제 실행 모델을 적도록 `Co-Authored-By: Claude <tier>` / `Co-Authored-By: DeepSeek V4.1 Flash <noreply@deepseek.com>`를 요구한다 — 아래 각 태스크의 `git commit` 명령은 계약 §9 형식으로 적었다. 불일치는 open question으로 남긴다.)

## 읽기 순서와 전역 YAGNI

구현자는 착수 전 **A2 §0(결정표 A2-D1~D16)과 §1(개념 모델)** 을 읽는다. 이 두 절을 안 읽으면 `session_key`/`session_id` 분리의 이유를 모른 채 하나로 합치게 되고, 그게 이 계획 전체를 무효화한다.

Phase A에서 **만들지 않는 것**(A2·A7이 명시적으로 뒤로 미룬 것):

- Hermes 어댑터(A2 §4.4, Phase B 읽기 전용부터). `RuntimeKind`에 `'hermes'`는 있지만 어댑터 팩토리는 Phase A에서 이 값을 모른다.
- `'omnis'` 런타임 어댑터(A2 §1.1). 어댑터 팩토리의 `switch`에서 명시적으로 throw한다 — 조용히 무시하면 나중에 위임 대상 후보에 섞인다.
- `ingest.scan` / `ingest.read` 구현(A7 §7 "Phase B 시드 메모"). 메서드 이름은 `HUB_METHODS`에 있지만 디스패처는 `-32601`을 돌려준다.
- 위임 **실행** 경로(A2 §5). `delegate.run`은 `approval_id` 없으면 `-32006`이고, 있어도 Phase A에서는 승인 발급자(US-A07 커널)가 아직 서명을 주지 않으므로 실행 분기를 만들지 않는다.
- `session.read_summary`의 요약 **생성**(A2 §6의 T1 모델 호출). 브리지는 요약을 만들지 않는다 — 허브가 만든다. 브리지 쪽 RPC는 `-32003`으로 강등한다.
- 터미널에서 Logan이 직접 연 세션 스캔·import(A2 §2.3).
- 재시도 자동화(A2 §5.4). 재시도는 언제나 사람이 누른다.

---

## US-A16 — 브리지 프로토콜 타입 (Task 1~4)

> **목표**(A7 §7): 브리지 프로토콜 타입(session_key/session_id/capabilities, MCP 2026-07-28 버전 협상)
> **산출물**: `packages/protocol/src/bridge.ts`
> **검증 명령**: `pnpm --filter @omnis/protocol test`
> **티어**: Opus · **의존**: US-A11(`packages/protocol` 스캐폴드와 `src/adapter.ts`·`src/approval.ts`)

### Task 1: 브리지 코어 타입 (US-A16, tier: Opus)

**Files:**
- Create: `packages/protocol/src/bridge.ts`
- Test: `packages/protocol/test/bridge-types.test.ts`

**Interfaces:**
- Consumes: `HostId`, `RuntimeKind`, `Attachment`, `SessionKey`, `SessionId`(모두 `packages/protocol/src/adapter.ts`, 계약 §3.1~3.2, US-A11 산출)
- Produces: `PROTOCOL_VERSION: "2026-09-20"`, `META_KEYS`, `RuntimeCapabilities`(zod + type), `AgentRuntime`(zod + type), `PermissionProfile`, `SessionOrigin`, `SessionState`, `RuntimeState`

**읽을 것:** A2 §1.1(4개 객체), §1.2(capabilities 자기기술), §7.1(permission profile). **만들지 말 것:** `AgentSession` 전체 row 타입 — 그건 A3의 `agent_sessions` 테이블 소유이고 브리지는 `session_key`로만 말한다.

1. - [ ] 실패 테스트를 쓴다: `packages/protocol/test/bridge-types.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { AgentRuntime, META_KEYS, PROTOCOL_VERSION, PermissionProfile, RuntimeCapabilities } from "../src/bridge.js";

describe("bridge core types", () => {
  it("pins the protocol version and meta keys", () => {
    expect(PROTOCOL_VERSION).toBe("2026-09-20");
    expect(META_KEYS.protocolVersion).toBe("ai.omnis/protocolVersion");
    expect(META_KEYS.traceId).toBe("ai.omnis/traceId");
    expect(META_KEYS.origin).toBe("ai.omnis/origin");
  });

  it("passes unknown runtime feature strings through untouched", () => {
    const caps = RuntimeCapabilities.parse({
      resume: true, cross_project_resume: false, stream_deltas: true,
      reasoning_stream: false, tool_calls: true, approvals: "hook", cancel: true,
      models: ["sonnet", "haiku"], features: ["interrupt_receipt_v1", "some_future_flag"],
    });
    expect(caps.features).toEqual(["interrupt_receipt_v1", "some_future_flag"]);
  });

  it("allows binary_path=null and allowed_roots=[] for http transport", () => {
    const rt = AgentRuntime.parse({
      id: "6d0f4f1e-3d52-4b8a-9c0a-2f4b1f0a7c11", runtime: "hermes", host: "mini",
      version: "hermes 0.9.0",
      capabilities: { resume: true, cross_project_resume: false, stream_deltas: true,
        reasoning_stream: false, tool_calls: true, approvals: "none", cancel: false,
        models: [], features: [] },
      transport: "http", binary_path: null, allowed_roots: [],
      base_url: "http://127.0.0.1:8642", state: "online", last_health_at: "2026-09-20T01:02:03.000Z",
    });
    expect(rt.transport).toBe("http");
  });

  it("rejects an unknown permission profile", () => {
    expect(() => PermissionProfile.parse("root")).toThrow();
  });
});
```

2. - [ ] 실행해 실패를 확인한다: `pnpm --filter @omnis/protocol test`
   기대 실패: `Failed to resolve import "../src/bridge.js" from "test/bridge-types.test.ts"`

3. - [ ] 최소 구현을 쓴다: `packages/protocol/src/bridge.ts`

```ts
import { z } from "zod";
import { HostId, RuntimeKind } from "./adapter.js";

/** A2-D3: initialize 핸드셰이크 없음. 모든 요청의 params._meta에 이 버전을 싣는다. */
export const PROTOCOL_VERSION = "2026-09-20" as const;

export const META_KEYS = {
  protocolVersion: "ai.omnis/protocolVersion",
  traceId: "ai.omnis/traceId",
  origin: "ai.omnis/origin",
} as const;

/** A2 §7.1. profile은 origin과 purpose에서만 결정되고 프롬프트로 바뀌지 않는다. */
export const PermissionProfile = z.enum(["observe", "workspace", "trusted"]);
export type PermissionProfile = z.infer<typeof PermissionProfile>;

export const SessionOrigin = z.enum(["human", "delegation", "job"]);
export type SessionOrigin = z.infer<typeof SessionOrigin>;

export const SessionState = z.enum(["idle", "running", "awaiting_approval", "failed", "closed"]);
export type SessionState = z.infer<typeof SessionState>;

export const RuntimeState = z.enum(["online", "degraded", "offline"]);
export type RuntimeState = z.infer<typeof RuntimeState>;

/** A2 §1.2. features는 런타임 원문을 손대지 않고 그대로 싣는다. */
export const RuntimeCapabilities = z.object({
  resume: z.boolean(),
  cross_project_resume: z.boolean(),
  stream_deltas: z.boolean(),
  reasoning_stream: z.boolean(),
  tool_calls: z.boolean(),
  approvals: z.enum(["native", "hook", "none"]),
  cancel: z.boolean(),
  models: z.array(z.string()),
  features: z.array(z.string()),
});
export type RuntimeCapabilities = z.infer<typeof RuntimeCapabilities>;

/** A2 §1.1. transport='http'면 binary_path=null, allowed_roots=[]. */
export const AgentRuntime = z.object({
  id: z.string().uuid(),
  runtime: RuntimeKind,
  host: HostId,
  version: z.string(),
  capabilities: RuntimeCapabilities,
  transport: z.enum(["process", "http"]),
  binary_path: z.string().nullable(),
  allowed_roots: z.array(z.string()),
  base_url: z.string().nullable(),
  state: RuntimeState,
  last_health_at: z.string().datetime(),
});
export type AgentRuntime = z.infer<typeof AgentRuntime>;
```

4. - [ ] 테스트를 돌린다: `pnpm --filter @omnis/protocol test` → 4 passed

5. - [ ] 커밋한다:

```bash
git -C omnis/.worktrees/US-A16 add packages/protocol/src/bridge.ts packages/protocol/test/bridge-types.test.ts
git -C omnis/.worktrees/US-A16 commit -m "US-A16: 브리지 코어 타입(capabilities·AgentRuntime·PROTOCOL_VERSION)

- A2 §1.1/§1.2의 AgentRuntime·RuntimeCapabilities를 zod로 고정
- features 배열은 런타임 원문 통과
- transport='http'에서 binary_path=null/allowed_roots=[] 허용

Co-Authored-By: Claude Opus <noreply@anthropic.com>"
```

### Task 2: 와이어 페이로드 스키마 (US-A16, tier: Opus)

**Files:**
- Modify: `packages/protocol/src/bridge.ts`
- Test: `packages/protocol/test/bridge-wire.test.ts`

**Interfaces:**
- Consumes: Task 1의 `AgentRuntime`·`PermissionProfile`·`SessionOrigin`·`SessionState`, `SessionKey`/`SessionId`/`Attachment`(adapter.ts), `HumanInterrupt`(계약 §3.4, `src/approval.ts`)
- Produces: `TurnInput`, `SessionCreateParams`/`SessionCreateResult`, `SessionResumeParams`/`SessionResumeResult`, `TurnStartParams`/`TurnStartResult`, `TurnCancelParams`/`TurnCancelResult`, `SessionCloseParams`/`SessionCloseResult`, `BridgeDiscoverResult`, `DelegationBrief`, `BridgeItemKind`, `SessionRegistered`, `TurnStarted`, `ItemStarted`, `ItemDelta`, `ItemCompleted`, `TurnUsage`, `TurnCompleted`, `ApprovalRequestedParams`, `HealthNotification`, `SessionSummary`

**읽을 것:** A2 §3.2(hub→bridge 표), §3.3(bridge→hub 표), §5.2(브리프 5필드), §6(SessionSummary). **만들지 말 것:** `kind`를 `agent_turn`/`tool_call` 외로 늘리지 않는다 — reasoning은 item이 아니라 델타다(A2 §3.3).

1. - [ ] 실패 테스트를 쓴다: `packages/protocol/test/bridge-wire.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { ApprovalRequestedParams, DelegationBrief, ItemDelta, SessionCreateParams, TurnCompleted } from "../src/bridge.js";

const KEY = "agent:codex:mini:proj-omnis";

describe("bridge wire payloads", () => {
  it("accepts a session.create params object", () => {
    const p = SessionCreateParams.parse({
      session_key: KEY, runtime: "codex", cwd: "/Users/logankim/dev/omnis",
      purpose: "proj:omnis", origin: "human", permission_profile: "trusted",
    });
    expect(p.session_key).toBe(KEY);
  });

  it("rejects a session_key whose purpose still contains a colon", () => {
    expect(() => SessionCreateParams.parse({
      session_key: "agent:codex:mini:proj:omnis", runtime: "codex", cwd: "/x",
      purpose: "proj:omnis", origin: "human", permission_profile: "trusted",
    })).toThrow();
  });

  it("defaults the delta channel to output and requires a monotonic seq", () => {
    const d = ItemDelta.parse({ session_key: KEY, turn_id: "t1", item_id: "i1", seq: 0, text: "he" });
    expect(d.channel).toBe("output");
    expect(() => ItemDelta.parse({ session_key: KEY, turn_id: "t1", item_id: "i1", seq: -1, text: "x" })).toThrow();
  });

  it("requires output_path when a delegation brief outputs a file", () => {
    const base = {
      approval_id: "9a6a7a3e-1f2b-4a6c-8f33-0b2d6f0c9a10",
      target: { runtime: "claude_code", host: "macbook", cwd: "/Users/logankim/dev/omnis" },
      goal: "Fix the failing kernel contract test.", inputs: [], verify: "pnpm test:contract",
      timeout_ms: 900000,
    };
    expect(() => DelegationBrief.parse({ ...base, output: "file" })).toThrow();
    expect(DelegationBrief.parse({ ...base, output: "file", output_path: "/tmp/out.md" }).output).toBe("file");
  });

  it("carries a full HumanInterrupt on approval.requested", () => {
    const p = ApprovalRequestedParams.parse({
      session_key: KEY, turn_id: "t1",
      interrupt: { action: "delegate", args: { cmd: "rm -rf build" }, description: "run cleanup" },
    });
    expect(p.interrupt.config.allow_accept).toBe(true);
    expect(p.interrupt.risk).toBe("normal");
  });

  it("allows a cancelled turn to report status without an error object", () => {
    const t = TurnCompleted.parse({
      session_key: KEY, turn_id: "t1", status: "cancelled",
      usage: { cost_usd: null, duration_ms: 1200, num_turns: 1, tokens_in: 10, tokens_out: 4 },
    });
    expect(t.error).toBeUndefined();
  });
});
```

2. - [ ] 실행해 실패를 확인한다: `pnpm --filter @omnis/protocol test`
   기대 실패: `SyntaxError: The requested module '../src/bridge.js' does not provide an export named 'SessionCreateParams'`

3. - [ ] 최소 구현을 `packages/protocol/src/bridge.ts` 끝에 덧붙인다:

```ts
import { Attachment, SessionId, SessionKey } from "./adapter.js";
import { HumanInterrupt } from "./approval.js";

export const TurnInput = z.object({
  text: z.string(),
  attachments: z.array(Attachment).optional(),
});
export type TurnInput = z.infer<typeof TurnInput>;

// --- hub → bridge (A2 §3.2) ---
export const SessionCreateParams = z.object({
  session_key: SessionKey,
  runtime: RuntimeKind,
  cwd: z.string().min(1),
  purpose: z.string().min(1),
  origin: SessionOrigin,
  permission_profile: PermissionProfile,
  model: z.string().optional(),
});
export const SessionCreateResult = z.object({ session_id: z.null(), thread_id: z.string().uuid() });

export const SessionResumeParams = z.object({ session_key: SessionKey });
export const SessionResumeResult = z.object({ session_id: SessionId, restored: z.boolean() });

export const TurnStartParams = z.object({
  session_key: SessionKey,
  input: TurnInput,
  model: z.string().optional(),
  timeout_ms: z.number().int().positive().optional(),
});
export const TurnStartResult = z.object({ turn_id: z.string().min(1) });

export const TurnCancelParams = z.object({ session_key: SessionKey, turn_id: z.string().min(1), reason: z.string() });
export const TurnCancelResult = z.object({ cancelled: z.boolean() });

export const SessionCloseParams = z.object({ session_key: SessionKey, reason: z.string() });
export const SessionCloseResult = z.object({ closed: z.literal(true) });

export const BridgeDiscoverResult = z.object({
  protocolVersions: z.array(z.string()).min(1),
  methods: z.array(z.string()),
  runtimes: z.array(AgentRuntime),
});

/** A2 §5.2. 5필드 고정, verify 없는 위임은 만들지 않는다. */
export const DelegationBrief = z.object({
  approval_id: z.string().uuid(),
  target: z.object({ runtime: RuntimeKind, host: HostId, cwd: z.string().min(1) }),
  goal: z.string().min(1),
  inputs: z.array(z.string()),
  verify: z.string().min(1),
  output: z.enum(["diff", "file", "report"]),
  output_path: z.string().optional(),
  timeout_ms: z.number().int().positive().default(900_000),
  source_item_id: z.string().uuid().optional(),
}).refine((b) => b.output !== "file" || typeof b.output_path === "string", {
  message: "output_path is required when output='file'",
  path: ["output_path"],
});

// --- bridge → hub (A2 §3.3) ---
/** reasoning은 item이 아니다. kind는 이 둘뿐이다. */
export const BridgeItemKind = z.enum(["agent_turn", "tool_call"]);
export type BridgeItemKind = z.infer<typeof BridgeItemKind>;

export const SessionRegistered = z.object({
  session_key: SessionKey,
  session_id: SessionId.nullable(),
  runtime_id: z.string().uuid(),
  state: SessionState,
});
export const TurnStarted = z.object({ session_key: SessionKey, turn_id: z.string(), at: z.string().datetime() });

export const ItemStarted = z.object({
  session_key: SessionKey, turn_id: z.string(), item_id: z.string(),
  kind: BridgeItemKind, label: z.string(), meta: z.record(z.unknown()).default({}),
});
export const ItemDelta = z.object({
  session_key: SessionKey, turn_id: z.string(), item_id: z.string(),
  seq: z.number().int().nonnegative(), text: z.string(),
  channel: z.enum(["output", "reasoning"]).default("output"),
});
export const ItemCompleted = z.object({
  session_key: SessionKey, turn_id: z.string(), item_id: z.string(), kind: BridgeItemKind,
  body: z.string(), status: z.enum(["ok", "failed"]), meta: z.record(z.unknown()).default({}),
});

export const TurnUsage = z.object({
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int().nonnegative(),
  num_turns: z.number().int().nonnegative(),
  tokens_in: z.number().int().nonnegative().optional(),
  tokens_out: z.number().int().nonnegative().optional(),
});
export const TurnCompleted = z.object({
  session_key: SessionKey, turn_id: z.string(),
  status: z.enum(["ok", "failed", "cancelled"]),
  usage: TurnUsage,
  error: z.object({ code: z.number().int(), message: z.string() }).optional(),
});

export const ApprovalRequestedParams = z.object({
  session_key: SessionKey, turn_id: z.string(), interrupt: HumanInterrupt,
});

export const HealthNotification = z.object({
  host: HostId,
  runtimes: z.array(z.object({
    id: z.string().uuid(), state: RuntimeState, load: z.number().int().nonnegative(),
  })),
  limited: z.boolean().default(false),
  at: z.string().datetime(),
});

/** A2 §6. raw 델타·reasoning 원문은 여기에 담기지 않는다(A2-D13). */
export const SessionSummary = z.object({
  session_key: SessionKey, runtime: RuntimeKind, host: HostId, purpose: z.string(),
  state: SessionState, opened_at: z.string().datetime(), last_turn_at: z.string().datetime().nullable(),
  turn_count: z.number().int().nonnegative(),
  summary: z.string().max(400),
  open_questions: z.array(z.string()),
  artifacts: z.array(z.object({ path: z.string(), action: z.enum(["created", "modified", "read"]) })),
  recent_turns: z.array(z.object({
    turn_id: z.string(), at: z.string().datetime(), role: z.enum(["user", "agent"]),
    text: z.string().max(1000),
    tool_calls: z.array(z.object({ label: z.string(), status: z.enum(["ok", "failed"]) })),
  })).max(10),
});
```

4. - [ ] 테스트를 돌린다: `pnpm --filter @omnis/protocol test` → 6 passed (bridge-wire) + 4 passed (bridge-types)

5. - [ ] 커밋한다:

```bash
git -C omnis/.worktrees/US-A16 add packages/protocol/src/bridge.ts packages/protocol/test/bridge-wire.test.ts
git -C omnis/.worktrees/US-A16 commit -m "US-A16: 브리지 와이어 페이로드 zod 스키마

- A2 §3.2/§3.3의 모든 params/result/notification 페이로드
- DelegationBrief: output='file'이면 output_path 필수(refine)
- ItemDelta.channel 기본값 output, reasoning은 델타 전용

Co-Authored-By: Claude Opus <noreply@anthropic.com>"
```

### Task 3: 에러 코드와 메서드 목록 (US-A16, tier: Opus)

**Files:**
- Modify: `packages/protocol/src/bridge.ts`
- Test: `packages/protocol/test/bridge-errors.test.ts`

**Interfaces:**
- Consumes: 없음(리프)
- Produces: `BRIDGE_ERRORS`, `JSONRPC_ERRORS`, `BridgeErrorCode`, `BridgeError`, `HUB_METHODS`, `BRIDGE_METHODS`, `HubMethod`, `BridgeMethod`, `toJsonRpcError(e: unknown): { code: number; message: string; data?: unknown }`

**읽을 것:** A2 §3.4(에러 코드표 12개 + JSON-RPC 표준 5개). **만들지 말 것:** 에러 코드를 새로 발명하지 않는다. 표에 없는 상황은 `-32603 internal`로 접는다.

1. - [ ] 실패 테스트를 쓴다: `packages/protocol/test/bridge-errors.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { BRIDGE_ERRORS, BRIDGE_METHODS, BridgeError, HUB_METHODS, JSONRPC_ERRORS, toJsonRpcError } from "../src/bridge.js";

describe("bridge errors", () => {
  it("pins every omnis error code from A2 §3.4", () => {
    expect(BRIDGE_ERRORS).toEqual({
      SESSION_NOT_FOUND: -32001, RUNTIME_UNAVAILABLE: -32002, CAPABILITY_UNSUPPORTED: -32003,
      TURN_ALREADY_ACTIVE: -32004, PATH_NOT_ALLOWED: -32005, APPROVAL_REQUIRED: -32006,
      TURN_TIMEOUT: -32007, TURN_CANCELLED: -32008, RUNTIME_RATE_LIMITED: -32009,
      VERSION_UNSUPPORTED: -32010, AUTH_FAILED: -32011, BUDGET_EXCEEDED: -32012,
    });
  });

  it("lists exactly the methods each side may send", () => {
    expect(HUB_METHODS).toContain("delegate.run");
    expect(HUB_METHODS).toContain("ingest.scan");
    expect(BRIDGE_METHODS).toContain("approval.requested");
    expect(BRIDGE_METHODS).not.toContain("turn.start");
  });

  it("keeps name identical to the class name", () => {
    const e = new BridgeError(BRIDGE_ERRORS.PATH_NOT_ALLOWED, "cwd outside allowed_roots");
    expect(e.name).toBe("BridgeError");
    expect(e).toBeInstanceOf(Error);
  });

  it("serialises a BridgeError and folds anything else into -32603", () => {
    const withData = new BridgeError(BRIDGE_ERRORS.VERSION_UNSUPPORTED, "bad version", { supported: ["2026-09-20"] });
    expect(toJsonRpcError(withData)).toEqual({ code: -32010, message: "bad version", data: { supported: ["2026-09-20"] } });
    expect(toJsonRpcError(new TypeError("boom"))).toEqual({ code: JSONRPC_ERRORS.INTERNAL, message: "boom" });
  });
});
```

2. - [ ] 실행해 실패를 확인한다: `pnpm --filter @omnis/protocol test`
   기대 실패: `SyntaxError: ... does not provide an export named 'BRIDGE_ERRORS'`

3. - [ ] 최소 구현을 `packages/protocol/src/bridge.ts`에 덧붙인다:

```ts
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

export class BridgeError extends Error {
  constructor(readonly code: BridgeErrorCode, message: string, readonly data?: unknown) {
    super(message);
    this.name = "BridgeError";
  }
}

export function toJsonRpcError(e: unknown): { code: number; message: string; data?: unknown } {
  if (e instanceof BridgeError) {
    return e.data === undefined
      ? { code: e.code, message: e.message }
      : { code: e.code, message: e.message, data: e.data };
  }
  return { code: JSONRPC_ERRORS.INTERNAL, message: e instanceof Error ? e.message : String(e) };
}

export const HUB_METHODS = [
  "bridge/discover", "session.create", "session.resume", "turn.start", "turn.cancel",
  "session.read_summary", "delegate.run", "session.close", "ingest.scan", "ingest.read",
] as const;
export const BRIDGE_METHODS = [
  "runtime.registered", "session.registered", "turn.started", "turn.item.started",
  "turn.item.delta", "turn.item.completed", "turn.completed", "approval.requested", "health",
] as const;
export type HubMethod = typeof HUB_METHODS[number];
export type BridgeMethod = typeof BRIDGE_METHODS[number];
```

4. - [ ] 테스트를 돌린다: `pnpm --filter @omnis/protocol test` → 4 passed (bridge-errors)

5. - [ ] 커밋한다:

```bash
git -C omnis/.worktrees/US-A16 add packages/protocol/src/bridge.ts packages/protocol/test/bridge-errors.test.ts
git -C omnis/.worktrees/US-A16 commit -m "US-A16: 브리지 에러 코드·메서드 목록·toJsonRpcError

- A2 §3.4의 omnis 12코드 + JSON-RPC 표준 5코드
- HUB_METHODS/BRIDGE_METHODS 고정, BridgeError.name = 클래스명

Co-Authored-By: Claude Opus <noreply@anthropic.com>"
```

### Task 4: per-request 버전 협상 (US-A16, tier: Opus)

**Files:**
- Modify: `packages/protocol/src/bridge.ts`, `packages/protocol/src/index.ts`
- Test: `packages/protocol/test/bridge-version.test.ts`

**Interfaces:**
- Consumes: Task 1의 `PROTOCOL_VERSION`·`META_KEYS`·`SessionOrigin`, Task 3의 `BridgeError`·`BRIDGE_ERRORS`
- Produces: `SUPPORTED_PROTOCOL_VERSIONS: readonly ["2026-09-20"]`, `RpcMeta`(zod), `withMeta<P>(params, meta?)`, `assertProtocolVersion(params: unknown): void`

**읽을 것:** A2-D3, §3.1(공통 형태). **만들지 말 것:** `initialize` 핸드셰이크, 버전 불일치 시 연결 종료. 불일치는 **그 요청만** 거절한다 — 그래야 브리지와 허브를 따로 배포할 수 있다.

1. - [ ] 실패 테스트를 쓴다: `packages/protocol/test/bridge-version.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { BridgeError, PROTOCOL_VERSION, assertProtocolVersion, withMeta } from "../src/bridge.js";

describe("per-request version negotiation", () => {
  it("stamps _meta with the protocol version and keeps the original params", () => {
    const p = withMeta({ session_key: "agent:codex:mini:proj-omnis" }, { traceId: "01JBQ0000000000000000000", origin: "delegation" });
    expect(p.session_key).toBe("agent:codex:mini:proj-omnis");
    expect(p._meta["ai.omnis/protocolVersion"]).toBe(PROTOCOL_VERSION);
    expect(p._meta["ai.omnis/traceId"]).toBe("01JBQ0000000000000000000");
    expect(p._meta["ai.omnis/origin"]).toBe("delegation");
  });

  it("omits optional meta keys entirely when not supplied", () => {
    const p = withMeta({ a: 1 });
    expect(Object.keys(p._meta)).toEqual(["ai.omnis/protocolVersion"]);
  });

  it("accepts a request carrying the supported version", () => {
    expect(() => assertProtocolVersion(withMeta({ a: 1 }))).not.toThrow();
  });

  it("rejects only the offending request with -32010 and a supported list", () => {
    try {
      assertProtocolVersion({ _meta: { "ai.omnis/protocolVersion": "2025-01-01" } });
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(BridgeError);
      expect((e as BridgeError).code).toBe(-32010);
      expect((e as BridgeError).data).toEqual({ supported: [PROTOCOL_VERSION] });
    }
  });

  it("treats a missing _meta as unsupported", () => {
    expect(() => assertProtocolVersion({ session_key: "x" })).toThrow(BridgeError);
  });
});
```

2. - [ ] 실행해 실패를 확인한다: `pnpm --filter @omnis/protocol test`
   기대 실패: `SyntaxError: ... does not provide an export named 'withMeta'`

3. - [ ] 최소 구현을 `packages/protocol/src/bridge.ts`에 덧붙인다:

```ts
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

/** A2-D3: 불일치는 연결을 끊지 않고 이 요청만 -32010으로 거절한다. */
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

4. - [ ] `packages/protocol/src/index.ts`에 한 줄을 더한다: `export * from "./bridge.js";`

5. - [ ] 테스트와 타입체크를 돌린다: `pnpm --filter @omnis/protocol test` → 5 passed, `pnpm typecheck` → exit 0

6. - [ ] 커밋한다:

```bash
git -C omnis/.worktrees/US-A16 add packages/protocol/src/bridge.ts packages/protocol/src/index.ts packages/protocol/test/bridge-version.test.ts
git -C omnis/.worktrees/US-A16 commit -m "US-A16: per-request 프로토콜 버전 협상(withMeta/assertProtocolVersion)

- A2-D3 MCP 2026-07-28 모델: initialize 핸드셰이크 없음
- 버전 불일치는 연결 종료가 아니라 -32010 + data.supported
- index.ts에서 bridge.ts re-export

Co-Authored-By: Claude Opus <noreply@anthropic.com>"
```

---

## US-A17 — `local-agent` 데몬 (Task 5~10)

> **목표**(A7 §7): `apps/local-agent` 데몬 스캐폴드(Tailscale 연결, 세션 등록)
> **산출물**: `apps/local-agent/src/main.ts`
> **검증 명령**: `pnpm --filter @omnis/local-agent test`
> **티어**: Sonnet · **의존**: US-A16

### Task 5: 패키지 스캐폴드와 한 줄 JSON 로거 (US-A17, tier: Sonnet)

**Files:**
- Create: `apps/local-agent/package.json`, `apps/local-agent/tsconfig.json`, `apps/local-agent/vitest.config.ts`, `apps/local-agent/src/logger.ts`
- Test: `apps/local-agent/test/logger.test.ts`

**Interfaces:**
- Consumes: `@omnis/protocol`(workspace 의존만 선언)
- Consumes (서버 카운터파트): 허브의 **`WS /bridge`** 엔드포인트 — 정확한 주소는 미니 루프백 `ws://127.0.0.1:8787/bridge`, 맥북은 Tailscale Serve를 통과한 `wss://<mini>.ts.net/api/bridge`. 이 서버는 **`2026-09-20-phase-a-kernel-and-db.md`의 `hub-bridge-ws` 태스크(US-A10, T24 뒤)가 구현한다**(계약 §5 `WS /bridge` 행). 이 계획은 dial하는 클라이언트 쪽만 만든다 — 상대가 없는 게 아니라 다른 계획이 소유한다. 그쪽이 머지되기 전에는 Task 8·19의 fake/mock 소켓으로 테스트하고, end-to-end 연결은 `hub-bridge-ws` 머지 후 US-A20 계약 테스트로 확인한다.
- Produces: `Logger` 인터페이스, `createLogger(pkg: string, opts?: { sink?: (line: string) => void; now?: () => Date }): Logger`

**읽을 것:** 계약 §9(로그 규약), A7 §1(의존 방향). **만들지 말 것:** pino·winston 같은 로깅 라이브러리. 필수 키 5개짜리 한 줄 JSON이면 끝이고, 의존성 하나가 브리지 부팅 경로에 들어갈 이유가 없다.

1. - [ ] 실패 테스트를 쓴다: `apps/local-agent/test/logger.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { createLogger } from "../src/logger.js";

describe("createLogger", () => {
  it("emits one JSON line with the five required keys", () => {
    const lines: string[] = [];
    const log = createLogger("@omnis/local-agent", { sink: (l) => lines.push(l), now: () => new Date("2026-09-20T00:00:00.000Z") });
    log.info("bridge connected", { host: "mini" });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)).toEqual({
      ts: "2026-09-20T00:00:00.000Z", level: "info", pkg: "@omnis/local-agent",
      msg: "bridge connected", trace_id: null, host: "mini",
    });
  });

  it("carries an explicit trace_id when given", () => {
    const lines: string[] = [];
    const log = createLogger("@omnis/local-agent", { sink: (l) => lines.push(l) });
    log.warn("reconnecting", { trace_id: "01JBQ0000000000000000000" });
    expect(JSON.parse(lines[0] as string).trace_id).toBe("01JBQ0000000000000000000");
  });
});
```

2. - [ ] 실행해 실패를 확인한다: `pnpm --filter @omnis/local-agent test`
   기대 실패: `ERR_PNPM_NO_MATCHING_PROJECT  No projects matched the filters in "/Users/logankim/AI-Workspaces/omnis"`

3. - [ ] `apps/local-agent/package.json`을 만든다:

```json
{
  "name": "@omnis/local-agent",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "omnis-local-agent": "./dist/main.js" },
  "scripts": {
    "build": "tsc --build",
    "test": "vitest run"
  },
  "dependencies": {
    "@omnis/protocol": "workspace:*",
    "smol-toml": "^1.3.1",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/node": "^22.7.0",
    "@types/ws": "^8.5.12",
    "typescript": "5.6.3",
    "vitest": "2.1.9"
  }
}
```

   `typescript`/`vitest`는 계약 §2의 고정 핀이다(전 워크스페이스 동일: `vitest 2.1.9` · `typescript 5.6.3` · `zod ^3.24.1` · `pg 8.13.1` · `packageManager pnpm@9.12.3`). caret을 붙이면 워크스페이스에 두 버전이 설치돼 `pnpm test`가 패키지마다 다른 러너로 돈다.

4. - [ ] `apps/local-agent/tsconfig.json`과 `apps/local-agent/vitest.config.ts`를 만든다:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": ".", "composite": true },
  "include": ["src/**/*.ts", "test/**/*.ts"],
  "references": [{ "path": "../../packages/protocol" }]
}
```

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { name: "unit", include: ["test/**/*.test.ts"], environment: "node" },
});
```

5. - [ ] `apps/local-agent/src/logger.ts`를 만든다:

```ts
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  log(level: LogLevel, msg: string, extra?: Record<string, unknown>): void;
  debug(msg: string, extra?: Record<string, unknown>): void;
  info(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, extra?: Record<string, unknown>): void;
}

export function createLogger(
  pkg: string,
  opts: { sink?: (line: string) => void; now?: () => Date } = {},
): Logger {
  const sink = opts.sink ?? ((line: string) => { process.stdout.write(`${line}\n`); });
  const now = opts.now ?? (() => new Date());
  const log = (level: LogLevel, msg: string, extra: Record<string, unknown> = {}): void => {
    const { trace_id = null, ...rest } = extra;
    sink(JSON.stringify({ ts: now().toISOString(), level, pkg, msg, trace_id, ...rest }));
  };
  return {
    log,
    debug: (m, e) => log("debug", m, e),
    info: (m, e) => log("info", m, e),
    warn: (m, e) => log("warn", m, e),
    error: (m, e) => log("error", m, e),
  };
}
```

6. - [ ] `pnpm install`로 워크스페이스를 링크한 뒤 테스트를 돌린다: `pnpm --filter @omnis/local-agent test` → 2 passed

7. - [ ] 커밋한다:

```bash
git -C omnis/.worktrees/US-A17 add apps/local-agent
git -C omnis/.worktrees/US-A17 commit -m "US-A17: local-agent 패키지 스캐폴드 + 한 줄 JSON 로거

- @omnis/protocol만 의존(A7 §1 의존 방향)
- 계약 §9 로그 필수 키 5개(ts/level/pkg/msg/trace_id)

Co-Authored-By: Claude Sonnet <noreply@anthropic.com>"
```

### Task 6: TOML 설정과 우선순위 해석 (US-A17, tier: Sonnet)

**Files:**
- Create: `apps/local-agent/src/config.ts`
- Test: `apps/local-agent/test/config.test.ts`

**Interfaces:**
- Consumes: `HostId`(@omnis/protocol)
- Produces: `ProcessRuntimeConfig`, `HttpRuntimeConfig`, `RuntimeConfig`, `LocalAgentConfig`, `ConfigSource = "cli"|"env"|"toml"|"default"`, `LoadConfigResult`, `HOST_DEFAULTS`, `normalizeHubUrl(input: string): string`, `loadConfig(input: { argv: string[]; env: NodeJS.ProcessEnv; tomlText?: string }): LoadConfigResult`, `ConfigError`

**읽을 것:** A2-D15, A2 §2.1(TOML 예시 둘 + 필드 분기표 + `allowed_roots` 거부 규칙), 계약 §8. **만들지 말 것:** `[[runtime]]`을 CLI나 환경변수로 추가·수정하는 경로. `allowed_roots`가 명령줄에서 바뀔 수 있으면 A2-D12의 경로 상한이 의미를 잃는다.

1. - [ ] 실패 테스트를 쓴다: `apps/local-agent/test/config.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig, normalizeHubUrl } from "../src/config.js";

const TOML = `
host = "mini"
hub_url = "ws://127.0.0.1:8787/bridge"
token_keychain_item = "omnis.bridge.token.mini"

[[runtime]]
kind = "codex"
binary = "/opt/homebrew/bin/codex"
pinned_version = "rust-v0.155.1"
allowed_roots = ["/Users/logankim/dev"]

[[runtime]]
kind = "hermes"
base_url = "http://127.0.0.1:8642"
token_keychain_item = "omnis.hermes.api_key.mini"
session_header_mode = "hermes_v1"
`;

const base = { argv: [], env: {} as NodeJS.ProcessEnv, tomlText: TOML };

describe("loadConfig precedence (A2-D15)", () => {
  it("uses TOML when neither CLI nor env is present", () => {
    const r = loadConfig(base);
    expect(r.config.hub_url).toBe("ws://127.0.0.1:8787/bridge");
    expect(r.provenance.hub_url).toBe("toml");
  });

  it("lets env beat TOML and CLI beat env", () => {
    const envOnly = loadConfig({ ...base, env: { OMNIS_HUB_URL: "ws://127.0.0.1:9999/bridge" } });
    expect(envOnly.config.hub_url).toBe("ws://127.0.0.1:9999/bridge");
    expect(envOnly.provenance.hub_url).toBe("env");

    const both = loadConfig({ ...base, argv: ["--hub", "http://127.0.0.1:8787"], env: { OMNIS_HUB_URL: "ws://127.0.0.1:9999/bridge" } });
    expect(both.config.hub_url).toBe("ws://127.0.0.1:8787/bridge");
    expect(both.provenance.hub_url).toBe("cli");
  });

  it("falls back to the built-in default for the host", () => {
    const r = loadConfig({ argv: ["--host", "mini"], env: {} });
    expect(r.config.hub_url).toBe("ws://127.0.0.1:8787/bridge");
    expect(r.config.token_keychain_item).toBe("omnis.bridge.token.mini");
    expect(r.provenance.hub_url).toBe("default");
  });

  it("normalises the plist's http base URL into a ws bridge URL (A6 §10.2)", () => {
    expect(normalizeHubUrl("http://127.0.0.1:8787")).toBe("ws://127.0.0.1:8787/bridge");
    expect(normalizeHubUrl("https://omnis-hub.your-tailnet.ts.net/api")).toBe("wss://omnis-hub.your-tailnet.ts.net/api/bridge");
    expect(normalizeHubUrl("ws://127.0.0.1:8787/bridge")).toBe("ws://127.0.0.1:8787/bridge");
  });

  it("filters runtimes with --runtimes but never adds one", () => {
    const r = loadConfig({ ...base, argv: ["--runtimes", "codex"] });
    expect(r.config.runtimes.map((x) => x.kind)).toEqual(["codex"]);
    expect(() => loadConfig({ ...base, argv: ["--runtimes", "claude_code"] })).toThrow(ConfigError);
  });

  it("rejects HTTP fields on a process runtime and vice versa", () => {
    expect(() => loadConfig({ ...base, tomlText: `host="mini"\n[[runtime]]\nkind="codex"\nbinary="/x"\nallowed_roots=["/Users/logankim/dev"]\nbase_url="http://127.0.0.1:8642"\n` })).toThrow(/base_url/);
    expect(() => loadConfig({ ...base, tomlText: `host="mini"\n[[runtime]]\nkind="hermes"\ntoken_keychain_item="a"\nbinary="/x"\n` })).toThrow(/binary/);
  });

  it("refuses $HOME or / as an allowed root (A2 §2.1 fail-fast)", () => {
    for (const root of ["/", "/Users/logankim"]) {
      expect(() => loadConfig({
        ...base,
        env: { HOME: "/Users/logankim" },
        tomlText: `host="mini"\n[[runtime]]\nkind="codex"\nbinary="/x"\nallowed_roots=["${root}"]\n`,
      })).toThrow(ConfigError);
    }
  });

  it("reports the source of every top-level key", () => {
    const r = loadConfig({ ...base, argv: ["--host", "mini"] });
    expect(r.provenance).toEqual({ host: "cli", hub_url: "toml", token_keychain_item: "toml" });
  });
});
```

2. - [ ] 실행해 실패를 확인한다: `pnpm --filter @omnis/local-agent test`
   기대 실패: `Failed to resolve import "../src/config.js"`

3. - [ ] `apps/local-agent/src/config.ts`를 만든다:

```ts
import { parse as parseToml } from "smol-toml";
import type { HostId, RuntimeKind } from "@omnis/protocol";

export class ConfigError extends Error {
  constructor(message: string) { super(message); this.name = "ConfigError"; }
}

export type ConfigSource = "cli" | "env" | "toml" | "default";

export interface ProcessRuntimeConfig {
  kind: "claude_code" | "codex" | "claude_ds";
  binary: string;
  allowed_roots: string[];
  pinned_version?: string;
  default_model?: string;
  /** 게이트 ⑪ 스위치(Task 12). 미지정이면 origin 기본값(A2-D11). 계약 §8의 필드 목록에는 게이트가 닫힐 때 합친다. */
  bare?: boolean;
}
export interface HttpRuntimeConfig {
  kind: "hermes";
  base_url: string;
  token_keychain_item: string;
  session_header_mode: "hermes_v1";
}
export type RuntimeConfig = ProcessRuntimeConfig | HttpRuntimeConfig;

export interface LocalAgentConfig {
  host: HostId;
  hub_url: string;
  token_keychain_item: string;
  runtimes: RuntimeConfig[];
}
export interface LoadConfigResult {
  config: LocalAgentConfig;
  provenance: Record<"host" | "hub_url" | "token_keychain_item", ConfigSource>;
}

/** 계약 §8. host-config.ts(US-A19b)가 이 표를 재사용한다. */
export const HOST_DEFAULTS: Record<HostId, { hub_url: string; token_keychain_item: string }> = {
  mini: { hub_url: "ws://127.0.0.1:8787/bridge", token_keychain_item: "omnis.bridge.token.mini" },
  macbook: { hub_url: "wss://omnis-hub.your-tailnet.ts.net/api/bridge", token_keychain_item: "omnis.bridge.token.macbook" },
};

const PROCESS_KINDS = new Set(["claude_code", "codex", "claude_ds"]);
const PROCESS_ONLY_FIELDS = ["binary", "allowed_roots", "pinned_version", "default_model", "bare"];
const HTTP_ONLY_FIELDS = ["base_url", "session_header_mode"];

/** A6 §10의 plist는 `--hub http://127.0.0.1:8787`을 넘긴다. 브리지가 쓰는 것은 ws(s) + /bridge다. */
export function normalizeHubUrl(input: string): string {
  const u = new URL(input);
  if (u.protocol === "http:") u.protocol = "ws:";
  else if (u.protocol === "https:") u.protocol = "wss:";
  else if (u.protocol !== "ws:" && u.protocol !== "wss:") throw new ConfigError(`unsupported hub scheme: ${u.protocol}`);
  if (!u.pathname.endsWith("/bridge")) u.pathname = `${u.pathname.replace(/\/$/, "")}/bridge`;
  return u.toString().replace(/\/$/, "");
}

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
  const inline = argv.find((a) => a.startsWith(`--${name}=`));
  return inline === undefined ? undefined : inline.slice(name.length + 3);
}

function pick(
  cli: string | undefined, env: string | undefined, toml: string | undefined, fallback: () => string,
): { value: string; source: ConfigSource } {
  if (cli !== undefined) return { value: cli, source: "cli" };
  if (env !== undefined) return { value: env, source: "env" };
  if (toml !== undefined) return { value: toml, source: "toml" };
  return { value: fallback(), source: "default" };
}

function parseRuntime(raw: Record<string, unknown>, homeDir: string): RuntimeConfig {
  const kind = raw.kind;
  if (typeof kind !== "string") throw new ConfigError("[[runtime]] requires a kind");
  if (PROCESS_KINDS.has(kind)) {
    for (const f of HTTP_ONLY_FIELDS) {
      if (raw[f] !== undefined) throw new ConfigError(`[[runtime]] kind='${kind}' must not set ${f}`);
    }
    const binary = raw.binary;
    const roots = raw.allowed_roots;
    if (typeof binary !== "string") throw new ConfigError(`[[runtime]] kind='${kind}' requires binary`);
    if (!Array.isArray(roots) || roots.length === 0) throw new ConfigError(`[[runtime]] kind='${kind}' requires allowed_roots`);
    const allowed_roots = roots.map(String);
    for (const root of allowed_roots) {
      const norm = root.replace(/\/$/, "");
      if (norm === "" || norm === homeDir.replace(/\/$/, "")) {
        throw new ConfigError(`allowed_roots must not contain $HOME or /: ${root}`);
      }
    }
    const out: ProcessRuntimeConfig = { kind: kind as ProcessRuntimeConfig["kind"], binary, allowed_roots };
    if (typeof raw.pinned_version === "string") out.pinned_version = raw.pinned_version;
    if (typeof raw.default_model === "string") out.default_model = raw.default_model;
    if (typeof raw.bare === "boolean") out.bare = raw.bare;   // 게이트 ⑪ 스위치. 없으면 Task 12가 origin 기본값을 쓴다
    return out;
  }
  if (kind === "hermes") {
    for (const f of PROCESS_ONLY_FIELDS) {
      if (raw[f] !== undefined) throw new ConfigError(`[[runtime]] kind='hermes' must not set ${f}`);
    }
    const token = raw.token_keychain_item;
    if (typeof token !== "string") throw new ConfigError("[[runtime]] kind='hermes' requires token_keychain_item");
    return {
      kind: "hermes",
      base_url: typeof raw.base_url === "string" ? raw.base_url : "http://127.0.0.1:8642",
      token_keychain_item: token,
      session_header_mode: "hermes_v1",
    };
  }
  throw new ConfigError(`unknown runtime kind: ${kind}`);
}

export function loadConfig(input: { argv: string[]; env: NodeJS.ProcessEnv; tomlText?: string }): LoadConfigResult {
  const toml = (input.tomlText === undefined ? {} : parseToml(input.tomlText)) as Record<string, unknown>;
  const homeDir = input.env.HOME ?? "/Users/logankim";

  const host = pick(flag(input.argv, "host"), input.env.OMNIS_HOST, typeof toml.host === "string" ? toml.host : undefined, () => "mini");
  if (host.value !== "mini" && host.value !== "macbook") throw new ConfigError(`host must be mini|macbook, got ${host.value}`);
  const hostId = host.value as HostId;
  const defaults = HOST_DEFAULTS[hostId];

  const hubRaw = pick(flag(input.argv, "hub"), input.env.OMNIS_HUB_URL, typeof toml.hub_url === "string" ? toml.hub_url : undefined, () => defaults.hub_url);
  const token = pick(flag(input.argv, "token-keychain-item"), input.env.OMNIS_TOKEN_KEYCHAIN_ITEM,
    typeof toml.token_keychain_item === "string" ? toml.token_keychain_item : undefined, () => defaults.token_keychain_item);

  const declared = Array.isArray(toml.runtime) ? (toml.runtime as Record<string, unknown>[]).map((r) => parseRuntime(r, homeDir)) : [];
  const filterCsv = flag(input.argv, "runtimes") ?? input.env.OMNIS_RUNTIMES;
  let runtimes = declared;
  if (filterCsv !== undefined) {
    const wanted = filterCsv.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    for (const w of wanted) {
      if (!declared.some((r) => r.kind === w)) {
        throw new ConfigError(`--runtimes names '${w}' which has no [[runtime]] block (A2-D15: runtimes are TOML-only)`);
      }
    }
    runtimes = declared.filter((r) => wanted.includes(r.kind as RuntimeKind));
  }

  return {
    config: { host: hostId, hub_url: normalizeHubUrl(hubRaw.value), token_keychain_item: token.value, runtimes },
    provenance: { host: host.source, hub_url: hubRaw.source, token_keychain_item: token.source },
  };
}
```

4. - [ ] 테스트를 돌린다: `pnpm --filter @omnis/local-agent test` → 8 passed

5. - [ ] 커밋한다:

```bash
git -C omnis/.worktrees/US-A17 add apps/local-agent/src/config.ts apps/local-agent/test/config.test.ts apps/local-agent/package.json
git -C omnis/.worktrees/US-A17 commit -m "US-A17: TOML 설정 + CLI>env>TOML>default 우선순위(A2-D15)

- [[runtime]]은 TOML 전용, --runtimes는 필터만 한다
- allowed_roots에 \$HOME·/ 오면 기동 거부
- A6 plist의 http base URL을 ws(s)+/bridge로 정규화

Co-Authored-By: Claude Sonnet <noreply@anthropic.com>"
```

### Task 7: 세션 레지스트리와 경로 상한 (US-A17, tier: Sonnet)

**Files:**
- Create: `apps/local-agent/src/paths.ts`, `apps/local-agent/src/session-registry.ts`
- Test: `apps/local-agent/test/session-registry.test.ts`

**Interfaces:**
- Consumes: `SessionKey`, `SessionId`, `SessionState`, `SessionOrigin`, `PermissionProfile`, `RuntimeKind`, `BridgeError`, `BRIDGE_ERRORS`(@omnis/protocol)
- Produces: `assertPathAllowed(cwd: string, allowedRoots: string[]): string`(정규화된 realpath 반환), `SessionRecord`, `SessionRegistry`(메서드 `create`/`get`/`require`/`bindSessionId`/`setState`/`list`/`close`)

**읽을 것:** A2-D1(키/아이디 분리), A2-D12(경로 재검증), §7.2(디렉터리 상한). **만들지 말 것:** 세션을 디스크에 영속화하지 않는다 — 재연결 시 `session.registered`로 재신고하면 허브가 `session_key` 기준 upsert한다(A2 §2.2 5항).

1. - [ ] 실패 테스트를 쓴다: `apps/local-agent/test/session-registry.test.ts`

```ts
import { mkdtempSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BridgeError } from "@omnis/protocol";
import { describe, expect, it } from "vitest";
import { assertPathAllowed } from "../src/paths.js";
import { SessionRegistry } from "../src/session-registry.js";

const KEY = "agent:codex:mini:proj-omnis";
const newSession = () => ({
  session_key: KEY, runtime: "codex" as const, runtime_id: "7f1f0c6a-1b9e-4c0b-9a6f-2c3d4e5f6071",
  cwd: "/tmp", purpose: "proj:omnis", origin: "human" as const,
  permission_profile: "trusted" as const, opened_at: "2026-09-20T00:00:00.000Z",
});

describe("assertPathAllowed", () => {
  it("resolves symlinks before checking (A2 §7.2)", () => {
    const root = mkdtempSync(join(tmpdir(), "omnis-root-"));
    const outside = mkdtempSync(join(tmpdir(), "omnis-out-"));
    mkdirSync(join(root, "ok"));
    symlinkSync(outside, join(root, "escape"));
    expect(assertPathAllowed(join(root, "ok"), [root])).toContain("/ok");
    expect(() => assertPathAllowed(join(root, "escape"), [root])).toThrow(BridgeError);
  });

  it("throws -32005 for a cwd outside every allowed root", () => {
    try {
      assertPathAllowed("/etc", ["/tmp"]);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as BridgeError).code).toBe(-32005);
    }
  });
});

describe("SessionRegistry", () => {
  it("keeps session_key stable while session_id rotates (A2-D1)", () => {
    const reg = new SessionRegistry();
    reg.create(newSession());
    reg.bindSessionId(KEY, "thread_abc");
    reg.bindSessionId(KEY, "thread_def");
    expect(reg.require(KEY).session_key).toBe(KEY);
    expect(reg.require(KEY).session_id).toBe("thread_def");
  });

  it("starts a session with session_id=null and state=idle", () => {
    const reg = new SessionRegistry();
    const rec = reg.create(newSession());
    expect(rec.session_id).toBeNull();
    expect(rec.state).toBe("idle");
  });

  it("is idempotent on re-create for the same key", () => {
    const reg = new SessionRegistry();
    reg.create(newSession());
    reg.bindSessionId(KEY, "thread_abc");
    reg.create(newSession());
    expect(reg.list()).toHaveLength(1);
    expect(reg.require(KEY).session_id).toBe("thread_abc");
  });

  it("answers -32001 for an unknown key", () => {
    const reg = new SessionRegistry();
    try {
      reg.require("agent:codex:mini:nope");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as BridgeError).code).toBe(-32001);
    }
  });
});
```

2. - [ ] 실행해 실패를 확인한다: `pnpm --filter @omnis/local-agent test`
   기대 실패: `Failed to resolve import "../src/paths.js"`

3. - [ ] `apps/local-agent/src/paths.ts`를 만든다:

```ts
import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { BRIDGE_ERRORS, BridgeError } from "@omnis/protocol";

/** A2-D12: 허브가 보낸 cwd는 브리지가 재검증한다. 심볼릭 링크는 realpath 후 재검사. */
export function assertPathAllowed(cwd: string, allowedRoots: string[]): string {
  let real: string;
  try {
    real = realpathSync(resolve(cwd));
  } catch {
    throw new BridgeError(BRIDGE_ERRORS.PATH_NOT_ALLOWED, `cwd does not exist: ${cwd}`, { cwd });
  }
  const ok = allowedRoots.some((root) => {
    let realRoot: string;
    try { realRoot = realpathSync(resolve(root)); } catch { return false; }
    return real === realRoot || real.startsWith(realRoot.endsWith(sep) ? realRoot : realRoot + sep);
  });
  if (!ok) throw new BridgeError(BRIDGE_ERRORS.PATH_NOT_ALLOWED, `cwd outside allowed_roots: ${cwd}`, { cwd, allowedRoots });
  return real;
}
```

4. - [ ] `apps/local-agent/src/session-registry.ts`를 만든다:

```ts
import {
  BRIDGE_ERRORS, BridgeError,
  type PermissionProfile, type RuntimeKind, type SessionOrigin, type SessionState,
} from "@omnis/protocol";

export interface SessionRecord {
  session_key: string;
  session_id: string | null;
  runtime: RuntimeKind;
  runtime_id: string;
  cwd: string;
  purpose: string;
  origin: SessionOrigin;
  permission_profile: PermissionProfile;
  state: SessionState;
  opened_at: string;
  last_turn_at: string | null;
}

export type SessionCreateInput = Omit<SessionRecord, "session_id" | "state" | "last_turn_at">;

/** 브리지는 자기가 만든 세션만 관리한다(A2 §2.3). 디스크에 영속화하지 않는다. */
export class SessionRegistry {
  readonly #byKey = new Map<string, SessionRecord>();

  create(input: SessionCreateInput): SessionRecord {
    const existing = this.#byKey.get(input.session_key);
    if (existing !== undefined) return existing;
    const rec: SessionRecord = { ...input, session_id: null, state: "idle", last_turn_at: null };
    this.#byKey.set(rec.session_key, rec);
    return rec;
  }

  get(key: string): SessionRecord | undefined { return this.#byKey.get(key); }

  require(key: string): SessionRecord {
    const rec = this.#byKey.get(key);
    if (rec === undefined) throw new BridgeError(BRIDGE_ERRORS.SESSION_NOT_FOUND, `unknown session_key: ${key}`, { session_key: key });
    return rec;
  }

  /** 런타임이 세션을 새로 만들면 이 값만 바뀐다. session_key와 thread는 유지된다. */
  bindSessionId(key: string, sessionId: string): SessionRecord {
    const rec = this.require(key);
    rec.session_id = sessionId;
    return rec;
  }

  setState(key: string, state: SessionState, at?: string): SessionRecord {
    const rec = this.require(key);
    rec.state = state;
    if (state === "running" && at !== undefined) rec.last_turn_at = at;
    return rec;
  }

  close(key: string): void { this.setState(key, "closed"); }

  list(): SessionRecord[] { return [...this.#byKey.values()]; }
}
```

5. - [ ] 테스트를 돌린다: `pnpm --filter @omnis/local-agent test` → 6 passed

6. - [ ] 커밋한다:

```bash
git -C omnis/.worktrees/US-A17 add apps/local-agent/src/paths.ts apps/local-agent/src/session-registry.ts apps/local-agent/test/session-registry.test.ts
git -C omnis/.worktrees/US-A17 commit -m "US-A17: 세션 레지스트리(session_key≠session_id) + allowed_roots 재검증

- A2-D1: session_id 회전에도 session_key와 thread는 유지
- A2-D12: realpath 후 재검사, 밖이면 -32005

Co-Authored-By: Claude Sonnet <noreply@anthropic.com>"
```

### Task 8: 허브 WebSocket 클라이언트와 재연결 백오프 (US-A17, tier: Sonnet)

**Files:**
- Create: `apps/local-agent/src/keychain.ts`, `apps/local-agent/src/hub-client.ts`
- Test: `apps/local-agent/test/hub-client.test.ts`

**Interfaces:**
- Consumes: `LocalAgentConfig`(Task 6), `Logger`(Task 5), `withMeta`, `toJsonRpcError`, `BridgeMethod`, `HubMethod`(@omnis/protocol)
- Consumes (서버 카운터파트): 허브 `WS /bridge` — `ws://127.0.0.1:8787/bridge`(미니) / `wss://<mini>.ts.net/api/bridge`(맥북). 오너는 `2026-09-20-phase-a-kernel-and-db.md`의 `hub-bridge-ws` 태스크(US-A10)다. 이 태스크는 그 서버를 만들지 않고 dial만 한다.
- Produces: `readKeychainSecret(item, account?, exec?)`, `backoffDelayMs(attempt: number, rand?: () => number): number`, `SocketLike`, `HubClientDeps`, `HubClient`(메서드 `start`/`stop`/`notify`/`request`)

**읽을 것:** A2 §2.2(접속·인증·재연결 6단계), §3.1(JSON-RPC 공통 형태). **만들지 말 것:** 허브→브리지 dial 경로(A2-D2: 브리지만 dial한다). 허브 쪽 `WS /bridge` 서버 구현도 여기서 만들지 않는다 — `hub-bridge-ws`(kernel-and-db) 소유다. 하트비트를 직접 발명하지 않는다 — 30초 `health` 알림이 그 역할이다.

1. - [ ] 실패 테스트를 쓴다: `apps/local-agent/test/hub-client.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";
import { HubClient, backoffDelayMs, type SocketLike } from "../src/hub-client.js";
import { createLogger } from "../src/logger.js";

function fakeSocket() {
  const sent: string[] = [];
  const handlers: Record<string, ((...a: unknown[]) => void)[]> = {};
  const sock: SocketLike = {
    send: (d) => { sent.push(d); },
    close: () => { (handlers.close ?? []).forEach((h) => h()); },
    on: (ev, fn) => { (handlers[ev] ??= []).push(fn as (...a: unknown[]) => void); return sock; },
  };
  return { sock, sent, fire: (ev: string, ...a: unknown[]) => (handlers[ev] ?? []).forEach((h) => h(...a)) };
}

const deps = (connect: () => SocketLike) => ({
  url: "ws://127.0.0.1:8787/bridge",
  token: "t0ken",
  logger: createLogger("@omnis/local-agent", { sink: () => {} }),
  connect,
  dispatch: async (method: string) => ({ echoed: method }),
});

describe("backoffDelayMs", () => {
  it("doubles from 1s and caps at 30s", () => {
    const noJitter = () => 0.5;
    expect(backoffDelayMs(0, noJitter)).toBe(1000);
    expect(backoffDelayMs(3, noJitter)).toBe(8000);
    expect(backoffDelayMs(10, noJitter)).toBe(30000);
  });

  it("applies +-20% jitter", () => {
    expect(backoffDelayMs(0, () => 0)).toBe(800);
    expect(backoffDelayMs(0, () => 1)).toBe(1200);
  });
});

describe("HubClient", () => {
  it("dials with a bearer token and stamps _meta on outgoing requests", async () => {
    const f = fakeSocket();
    const headers: Record<string, string>[] = [];
    const c = new HubClient(deps((u?: string, h?: Record<string, string>) => { headers.push(h ?? {}); return f.sock; }) as never);
    await c.start();
    f.fire("open");
    c.notify("health", { host: "mini", runtimes: [], at: "2026-09-20T00:00:00.000Z" });
    expect(headers[0]?.Authorization).toBe("Bearer t0ken");
    const sentNotify = JSON.parse(f.sent[0] as string);
    expect(sentNotify.method).toBe("health");
    expect(sentNotify.id).toBeUndefined();
    expect(sentNotify.params._meta["ai.omnis/protocolVersion"]).toBe("2026-09-20");
  });

  it("answers an inbound request through dispatch and echoes the id", async () => {
    const f = fakeSocket();
    const c = new HubClient(deps(() => f.sock) as never);
    await c.start();
    f.fire("open");
    f.fire("message", JSON.stringify({ jsonrpc: "2.0", id: "h-1", method: "session.close", params: { _meta: { "ai.omnis/protocolVersion": "2026-09-20" } } }));
    await vi.waitFor(() => expect(f.sent.some((s) => JSON.parse(s).id === "h-1")).toBe(true));
    expect(JSON.parse(f.sent.find((s) => JSON.parse(s).id === "h-1") as string).result).toEqual({ echoed: "session.close" });
  });

  it("resolves an outbound request when the hub replies", async () => {
    const f = fakeSocket();
    const c = new HubClient(deps(() => f.sock) as never);
    await c.start();
    f.fire("open");
    const p = c.request("approval.requested", { session_key: "agent:codex:mini:x", turn_id: "t1" });
    const id = JSON.parse(f.sent[0] as string).id as string;
    f.fire("message", JSON.stringify({ jsonrpc: "2.0", id, result: { decision: "accept" } }));
    await expect(p).resolves.toEqual({ decision: "accept" });
  });
});
```

2. - [ ] 실행해 실패를 확인한다: `pnpm --filter @omnis/local-agent test`
   기대 실패: `Failed to resolve import "../src/hub-client.js"`

3. - [ ] `apps/local-agent/src/keychain.ts`를 만든다:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
export const KEYCHAIN_ACCOUNT = "281932556+jinhologankim@users.noreply.github.com";

/** 값은 절대 로그·이벤트·에러 메시지에 싣지 않는다(A2 §7.2). */
export async function readKeychainSecret(
  item: string,
  account: string = KEYCHAIN_ACCOUNT,
  exec: (cmd: string, args: string[]) => Promise<{ stdout: string }> = (cmd, args) => run(cmd, args),
): Promise<string> {
  const { stdout } = await exec("security", ["find-generic-password", "-s", item, "-a", account, "-w"]);
  const secret = stdout.trim();
  if (secret.length === 0) throw new Error(`keychain item is empty: ${item}`);
  return secret;
}
```

4. - [ ] `apps/local-agent/src/hub-client.ts`를 만든다:

```ts
import { randomUUID } from "node:crypto";
import { type BridgeMethod, toJsonRpcError, withMeta } from "@omnis/protocol";
import type { Logger } from "./logger.js";

export interface SocketLike {
  send(data: string): void;
  close(): void;
  on(event: "open" | "message" | "close" | "error", fn: (...args: never[]) => void): SocketLike;
}

export interface HubClientDeps {
  url: string;
  token: string;
  logger: Logger;
  connect: (url: string, headers: Record<string, string>) => SocketLike;
  dispatch: (method: string, params: unknown) => Promise<unknown>;
  sleep?: (ms: number) => Promise<void>;
  onOpen?: () => Promise<void>;
  onClose?: () => void;
}

/** A2 §2.2 5항: 1s → 2s → 4s → … → 30s 상한, ±20% jitter. */
export function backoffDelayMs(attempt: number, rand: () => number = Math.random): number {
  const base = Math.min(1000 * 2 ** attempt, 30_000);
  return Math.round(base * (0.8 + 0.4 * rand()));
}

interface Pending { resolve: (v: unknown) => void; reject: (e: unknown) => void }

export class HubClient {
  #sock: SocketLike | null = null;
  #open = false;
  #stopped = false;
  #attempt = 0;
  readonly #pending = new Map<string, Pending>();

  constructor(private readonly deps: HubClientDeps) {}

  async start(): Promise<void> {
    this.#stopped = false;
    this.#connect();
  }

  stop(): void {
    this.#stopped = true;
    this.#open = false;
    this.#sock?.close();
    this.#sock = null;
  }

  #connect(): void {
    const sock = this.deps.connect(this.deps.url, { Authorization: `Bearer ${this.deps.token}` });
    this.#sock = sock;
    sock.on("open", (() => {
      this.#open = true;
      this.#attempt = 0;
      this.deps.logger.info("bridge connected", { url: this.deps.url });
      void this.deps.onOpen?.();
    }) as never);
    sock.on("message", ((raw: unknown) => { void this.#onMessage(String(raw)); }) as never);
    sock.on("close", (() => {
      this.#open = false;
      this.deps.onClose?.();
      if (this.#stopped) return;
      const delay = backoffDelayMs(this.#attempt++);
      this.deps.logger.warn("bridge disconnected, retrying", { delay_ms: delay, attempt: this.#attempt });
      void (this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))))(delay).then(() => {
        if (!this.#stopped) this.#connect();
      });
    }) as never);
    sock.on("error", ((e: unknown) => { this.deps.logger.error("bridge socket error", { reason: String(e) }); }) as never);
  }

  get connected(): boolean { return this.#open; }

  notify(method: BridgeMethod, params: Record<string, unknown>): void {
    this.#send({ jsonrpc: "2.0", method, params: withMeta(params) });
  }

  request(method: BridgeMethod, params: Record<string, unknown>): Promise<unknown> {
    const id = `b-${randomUUID().slice(0, 8)}`;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#send({ jsonrpc: "2.0", id, method, params: withMeta(params) });
    });
  }

  #send(msg: Record<string, unknown>): void {
    if (this.#sock === null || !this.#open) throw new Error("hub socket is not open");
    this.#sock.send(JSON.stringify(msg));
  }

  async #onMessage(raw: string): Promise<void> {
    let msg: { id?: string; method?: string; params?: unknown; result?: unknown; error?: { code: number; message: string } };
    try { msg = JSON.parse(raw); } catch { this.deps.logger.error("bridge received non-JSON frame"); return; }

    if (msg.method === undefined && msg.id !== undefined) {
      const p = this.#pending.get(msg.id);
      this.#pending.delete(msg.id);
      if (p === undefined) return;
      if (msg.error !== undefined) p.reject(msg.error);
      else p.resolve(msg.result);
      return;
    }
    if (msg.method === undefined) return;

    if (msg.id === undefined) { await this.deps.dispatch(msg.method, msg.params).catch(() => undefined); return; }
    try {
      const result = await this.deps.dispatch(msg.method, msg.params);
      this.#send({ jsonrpc: "2.0", id: msg.id, result });
    } catch (e) {
      this.#send({ jsonrpc: "2.0", id: msg.id, error: toJsonRpcError(e) });
    }
  }
}
```

5. - [ ] 테스트를 돌린다: `pnpm --filter @omnis/local-agent test` → 5 passed

6. - [ ] 커밋한다:

```bash
git -C omnis/.worktrees/US-A17 add apps/local-agent/src/hub-client.ts apps/local-agent/src/keychain.ts apps/local-agent/test/hub-client.test.ts
git -C omnis/.worktrees/US-A17 commit -m "US-A17: 허브 WS JSON-RPC 클라이언트 + 지수 백오프 재연결

- A2-D2: 브리지만 dial, Authorization: Bearer <keychain token>
- 1s→30s ±20% jitter 백오프, 양방향 요청/알림 처리

Co-Authored-By: Claude Sonnet <noreply@anthropic.com>"
```

### Task 9: 끊긴 동안의 durable outbox (US-A17, tier: Sonnet)

**Files:**
- Create: `apps/local-agent/src/outbox.ts`
- Test: `apps/local-agent/test/outbox.test.ts`

**Interfaces:**
- Consumes: `BridgeMethod`(@omnis/protocol)
- Produces: `OutboxEntry`, `Outbox`(생성자 `{ path, maxBytes? }`, 메서드 `append`/`drain`/`sizeBytes`/`length`)

**읽을 것:** A2 §2.2 "끊긴 동안의 턴". **만들지 말 것:** ephemeral 델타를 큐에 넣지 않는다. 재전송 성공/실패 상태 머신을 만들지 않는다 — drain이 던지면 남은 줄은 파일에 그대로 남는다.

1. - [ ] 실패 테스트를 쓴다: `apps/local-agent/test/outbox.test.ts`

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Outbox } from "../src/outbox.js";

const newPath = () => join(mkdtempSync(join(tmpdir(), "omnis-outbox-")), "outbox.ndjson");

describe("Outbox", () => {
  it("replays durable entries in order and empties itself", async () => {
    const o = new Outbox({ path: newPath() });
    o.append({ method: "turn.item.started", params: { item_id: "i1" } });
    o.append({ method: "turn.completed", params: { turn_id: "t1" } });
    const seen: string[] = [];
    await o.drain(async (e) => { seen.push(e.method); });
    expect(seen).toEqual(["turn.item.started", "turn.completed"]);
    expect(o.length()).toBe(0);
  });

  it("drops the oldest entries past the cap but never an approval.requested", () => {
    const o = new Outbox({ path: newPath(), maxBytes: 400 });
    o.append({ method: "approval.requested", params: { turn_id: "keep-me" } });
    for (let i = 0; i < 20; i++) o.append({ method: "turn.item.completed", params: { item_id: `i${i}`, body: "x".repeat(40) } });
    const kept = o.entries().map((e) => e.method);
    expect(kept).toContain("approval.requested");
    expect(o.sizeBytes()).toBeLessThanOrEqual(400);
  });

  it("keeps unflushed entries when the sender throws", async () => {
    const o = new Outbox({ path: newPath() });
    o.append({ method: "turn.item.started", params: { item_id: "i1" } });
    o.append({ method: "turn.item.completed", params: { item_id: "i1" } });
    await expect(o.drain(async (e) => { if (e.method === "turn.item.completed") throw new Error("socket closed"); })).rejects.toThrow("socket closed");
    expect(o.entries().map((e) => e.method)).toEqual(["turn.item.completed"]);
  });
});
```

2. - [ ] 실행해 실패를 확인한다: `pnpm --filter @omnis/local-agent test`
   기대 실패: `Failed to resolve import "../src/outbox.js"`

3. - [ ] `apps/local-agent/src/outbox.ts`를 만든다:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { BridgeMethod } from "@omnis/protocol";

export interface OutboxEntry { method: BridgeMethod; params: Record<string, unknown>; at?: string }

/** A2 §2.2: durable만 쌓는다. ephemeral 델타는 버린다. approval.requested는 절대 안 버린다. */
export class Outbox {
  readonly #path: string;
  readonly #maxBytes: number;
  #buf: OutboxEntry[] = [];

  constructor(opts: { path: string; maxBytes?: number }) {
    this.#path = opts.path;
    this.#maxBytes = opts.maxBytes ?? 50 * 1024 * 1024;
    mkdirSync(dirname(this.#path), { recursive: true });
    if (existsSync(this.#path)) {
      this.#buf = readFileSync(this.#path, "utf8").split("\n").filter((l) => l.length > 0)
        .map((l) => JSON.parse(l) as OutboxEntry);
    }
  }

  append(entry: OutboxEntry): void {
    this.#buf.push(entry.at === undefined ? { ...entry, at: new Date().toISOString() } : entry);
    while (this.sizeBytes() > this.#maxBytes) {
      const victim = this.#buf.findIndex((e) => e.method !== "approval.requested");
      if (victim < 0) break;
      this.#buf.splice(victim, 1);
    }
    this.#flushToDisk();
  }

  entries(): readonly OutboxEntry[] { return this.#buf; }
  length(): number { return this.#buf.length; }
  sizeBytes(): number { return Buffer.byteLength(this.#serialise(), "utf8"); }

  /** 순서대로 보내고 성공한 것만 지운다. 던지면 남은 것은 파일에 그대로 남는다. */
  async drain(send: (e: OutboxEntry) => Promise<void>): Promise<void> {
    while (this.#buf.length > 0) {
      const head = this.#buf[0] as OutboxEntry;
      try {
        await send(head);
      } catch (e) {
        this.#flushToDisk();
        throw e;
      }
      this.#buf.shift();
      this.#flushToDisk();
    }
  }

  #serialise(): string { return this.#buf.map((e) => JSON.stringify(e)).join("\n"); }
  #flushToDisk(): void { writeFileSync(this.#path, this.#serialise(), "utf8"); }
}
```

4. - [ ] 테스트를 돌린다: `pnpm --filter @omnis/local-agent test` → 3 passed

5. - [ ] 커밋한다:

```bash
git -C omnis/.worktrees/US-A17 add apps/local-agent/src/outbox.ts apps/local-agent/test/outbox.test.ts
git -C omnis/.worktrees/US-A17 commit -m "US-A17: 재연결용 durable outbox(~/.omnis/outbox.ndjson, 50MB)

- A2 §2.2: 순서 보존 flush, approval.requested는 절대 버리지 않음
- ephemeral 델타는 큐에 넣지 않는다

Co-Authored-By: Claude Sonnet <noreply@anthropic.com>"
```

### Task 10: RPC 디스패처와 `delegate.run` 거절 (US-A17, tier: Sonnet)

**Files:**
- Create: `apps/local-agent/src/rpc-dispatch.ts`, `apps/local-agent/src/main.ts`
- Test: `apps/local-agent/test/rpc-dispatch.test.ts`

**Interfaces:**
- Consumes: Task 4 `assertProtocolVersion`, Task 3 `BRIDGE_ERRORS`/`JSONRPC_ERRORS`/`BridgeError`, Task 2 `SessionCreateParams`/`TurnStartParams`/`TurnCancelParams`/`SessionCloseParams`/`BridgeDiscoverResult`, Task 6 `loadConfig`, Task 7 `SessionRegistry`/`assertPathAllowed`, Task 8 `HubClient`
- Produces: `RuntimeAdapter`, `EventSink`, `TurnHandle`, `DispatchDeps`, `createDispatcher(deps: DispatchDeps): (method: string, params: unknown) => Promise<unknown>`, `main(argv, env): Promise<void>`

**읽을 것:** A2 §3.2(메서드표), §4 앞머리(RuntimeAdapter/EventSink), §5.1 마지막 문단(`approval_id` 없는 `delegate.run`은 와이어에서 거절). **만들지 말 것:** `delegate.run`의 실행 분기. `ingest.*` 구현. `session.read_summary`의 요약 생성.

1. - [ ] 실패 테스트를 쓴다: `apps/local-agent/test/rpc-dispatch.test.ts`

```ts
import { withMeta } from "@omnis/protocol";
import { describe, expect, it, vi } from "vitest";
import { createDispatcher } from "../src/rpc-dispatch.js";
import { SessionRegistry } from "../src/session-registry.js";
import { createLogger } from "../src/logger.js";

const spawn = vi.fn();
const adapter = {
  kind: "codex" as const,
  probe: async () => ({ version: "codex rust-v0.155.1", capabilities: {
    resume: true, cross_project_resume: true, stream_deltas: true, reasoning_stream: true,
    tool_calls: true, approvals: "native" as const, cancel: true, models: [], features: [] } }),
  startTurn: async () => { spawn(); return { turn_id: "t1", cancel: async () => true }; },
  cancel: async () => true,
  close: async () => {},
};

const dispatch = () => createDispatcher({
  registry: new SessionRegistry(),
  adapters: new Map([["codex", adapter]]),
  allowedRoots: new Map([["codex", ["/tmp"]]]),
  runtimeIds: new Map([["codex", "7f1f0c6a-1b9e-4c0b-9a6f-2c3d4e5f6071"]]),
  logger: createLogger("@omnis/local-agent", { sink: () => {} }),
  host: "mini",
});

describe("rpc dispatcher", () => {
  it("rejects a request whose _meta carries an unknown version", async () => {
    await expect(dispatch()("session.create", { _meta: { "ai.omnis/protocolVersion": "1999-01-01" } }))
      .rejects.toMatchObject({ code: -32010 });
  });

  it("answers -32601 for ingest.* in Phase A", async () => {
    await expect(dispatch()("ingest.scan", withMeta({ roots: ["/tmp"] }))).rejects.toMatchObject({ code: -32601 });
  });

  it("answers -32601 for an entirely unknown method", async () => {
    await expect(dispatch()("turn.explode", withMeta({}))).rejects.toMatchObject({ code: -32601 });
  });

  it("rejects delegate.run without an approval_id and never spawns (A2 §5.1)", async () => {
    spawn.mockClear();
    await expect(dispatch()("delegate.run", withMeta({
      target: { runtime: "codex", host: "mini", cwd: "/tmp" },
      goal: "do it", inputs: [], verify: "true", output: "report", timeout_ms: 900000,
    }))).rejects.toMatchObject({ code: -32006 });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("creates a session slot without starting a process", async () => {
    const d = dispatch();
    const res = await d("session.create", withMeta({
      session_key: "agent:codex:mini:proj-omnis", runtime: "codex", cwd: "/tmp",
      purpose: "proj:omnis", origin: "human", permission_profile: "trusted",
    }));
    expect(res).toMatchObject({ session_id: null });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("refuses a cwd outside allowed_roots with -32005 and no spawn", async () => {
    spawn.mockClear();
    await expect(dispatch()("session.create", withMeta({
      session_key: "agent:codex:mini:escape", runtime: "codex", cwd: "/etc",
      purpose: "proj:escape", origin: "human", permission_profile: "trusted",
    }))).rejects.toMatchObject({ code: -32005 });
    expect(spawn).not.toHaveBeenCalled();
  });
});
```

2. - [ ] 실행해 실패를 확인한다: `pnpm --filter @omnis/local-agent test`
   기대 실패: `Failed to resolve import "../src/rpc-dispatch.js"`

3. - [ ] `apps/local-agent/src/rpc-dispatch.ts`를 만든다:

```ts
import { randomUUID } from "node:crypto";
import {
  BRIDGE_ERRORS, BRIDGE_METHODS, BridgeError, HUB_METHODS, JSONRPC_ERRORS, PROTOCOL_VERSION,
  SessionCloseParams, SessionCreateParams, TurnCancelParams, TurnStartParams,
  assertProtocolVersion,
  type AgentRuntime, type HostId, type HumanInterrupt, type HumanResponse,
  type RuntimeCapabilities, type RuntimeKind, type TurnInput,
} from "@omnis/protocol";
import type { Logger } from "./logger.js";
import { assertPathAllowed } from "./paths.js";
import type { SessionRecord, SessionRegistry } from "./session-registry.js";

export interface EventSink {
  itemStarted(e: Record<string, unknown>): void;
  delta(e: Record<string, unknown>): void;
  itemCompleted(e: Record<string, unknown>): void;
  turnCompleted(e: Record<string, unknown>): void;
  approval(i: HumanInterrupt): Promise<HumanResponse>;
  raw(line: string): void;
}

export interface TurnHandle { turn_id: string; cancel(reason: string): Promise<boolean> }

export interface RuntimeAdapter {
  kind: RuntimeKind;
  probe(): Promise<{ version: string; capabilities: RuntimeCapabilities }>;
  startTurn(s: SessionRecord, input: TurnInput, sink: EventSink): Promise<TurnHandle>;
  cancel(h: TurnHandle, reason: string): Promise<boolean>;
  close(s: SessionRecord): Promise<void>;
}

export interface DispatchDeps {
  registry: SessionRegistry;
  adapters: Map<RuntimeKind, RuntimeAdapter>;
  allowedRoots: Map<RuntimeKind, string[]>;
  runtimeIds: Map<RuntimeKind, string>;
  logger: Logger;
  host: HostId;
  runtimes?: AgentRuntime[];
  sinkFor?: (s: SessionRecord, turnId: string) => EventSink;
  beforeTurn?: (turnId: string) => void;
  afterTurn?: (turnId: string) => void;
}

const PHASE_B_METHODS = new Set(["ingest.scan", "ingest.read"]);

export function createDispatcher(deps: DispatchDeps): (method: string, params: unknown) => Promise<unknown> {
  const adapterFor = (kind: RuntimeKind): RuntimeAdapter => {
    if (kind === "omnis") throw new BridgeError(BRIDGE_ERRORS.RUNTIME_UNAVAILABLE, "omnis runtime has no adapter");
    const a = deps.adapters.get(kind);
    if (a === undefined) throw new BridgeError(BRIDGE_ERRORS.RUNTIME_UNAVAILABLE, `runtime not configured on this host: ${kind}`);
    return a;
  };

  return async (method: string, params: unknown): Promise<unknown> => {
    assertProtocolVersion(params);
    if (PHASE_B_METHODS.has(method)) {
      throw new BridgeError(JSONRPC_ERRORS.METHOD_NOT_FOUND, `${method} is Phase B (A7 §7 Phase B 시드 메모)`);
    }
    if (!(HUB_METHODS as readonly string[]).includes(method)) {
      throw new BridgeError(JSONRPC_ERRORS.METHOD_NOT_FOUND, `unknown method: ${method}`);
    }

    switch (method) {
      case "bridge/discover":
        return { protocolVersions: [PROTOCOL_VERSION], methods: [...BRIDGE_METHODS], runtimes: deps.runtimes ?? [] };

      case "session.create": {
        const p = SessionCreateParams.parse(params);
        const roots = deps.allowedRoots.get(p.runtime) ?? [];
        adapterFor(p.runtime);
        const cwd = assertPathAllowed(p.cwd, roots);
        const runtimeId = deps.runtimeIds.get(p.runtime);
        if (runtimeId === undefined) throw new BridgeError(BRIDGE_ERRORS.RUNTIME_UNAVAILABLE, `runtime not registered: ${p.runtime}`);
        deps.registry.create({
          session_key: p.session_key, runtime: p.runtime, runtime_id: runtimeId, cwd,
          purpose: p.purpose, origin: p.origin, permission_profile: p.permission_profile,
          opened_at: new Date().toISOString(),
        });
        return { session_id: null, thread_id: randomUUID() };
      }

      case "session.resume": {
        const rec = deps.registry.require((params as { session_key: string }).session_key);
        return { session_id: rec.session_id ?? "", restored: rec.session_id !== null };
      }

      case "turn.start": {
        const p = TurnStartParams.parse(params);
        const rec = deps.registry.require(p.session_key);
        if (rec.state === "running") throw new BridgeError(BRIDGE_ERRORS.TURN_ALREADY_ACTIVE, `turn already active: ${p.session_key}`);
        const turnId = `t-${randomUUID().slice(0, 8)}`;
        deps.beforeTurn?.(turnId);
        const sink = deps.sinkFor?.(rec, turnId);
        if (sink === undefined) throw new BridgeError(JSONRPC_ERRORS.INTERNAL, "no event sink wired");
        deps.registry.setState(p.session_key, "running", new Date().toISOString());
        await adapterFor(rec.runtime).startTurn(rec, p.input, sink);
        return { turn_id: turnId };
      }

      case "turn.cancel": {
        const p = TurnCancelParams.parse(params);
        const rec = deps.registry.require(p.session_key);
        const cancelled = await adapterFor(rec.runtime).cancel({ turn_id: p.turn_id, cancel: async () => true }, p.reason);
        deps.registry.setState(p.session_key, "idle");
        deps.afterTurn?.(p.turn_id);
        return { cancelled };
      }

      case "session.close": {
        const p = SessionCloseParams.parse(params);
        const rec = deps.registry.require(p.session_key);
        await adapterFor(rec.runtime).close(rec);
        deps.registry.close(p.session_key);
        return { closed: true };
      }

      case "session.read_summary":
        // 요약은 허브가 만든다(A2 §6). 브리지는 생성 경로를 갖지 않는다.
        throw new BridgeError(BRIDGE_ERRORS.CAPABILITY_UNSUPPORTED, "session.read_summary is served by the hub, not the bridge");

      case "delegate.run": {
        // A2 §5.1: 허브가 서명한 approval_id 없이는 와이어에서 거절한다. Phase A에는 실행 분기가 없다.
        const approvalId = (params as { approval_id?: unknown }).approval_id;
        if (typeof approvalId !== "string" || approvalId.length === 0) {
          deps.logger.error("delegate.run without approval_id", { host: deps.host });
          throw new BridgeError(BRIDGE_ERRORS.APPROVAL_REQUIRED, "delegate.run requires a hub-signed approval_id");
        }
        throw new BridgeError(BRIDGE_ERRORS.CAPABILITY_UNSUPPORTED, "delegation execution lands with the approval gate (US-A07)");
      }

      default:
        throw new BridgeError(JSONRPC_ERRORS.METHOD_NOT_FOUND, `unhandled method: ${method}`);
    }
  };
}
```

4. - [ ] `apps/local-agent/src/main.ts`를 만들어 조각을 잇는다:

```ts
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { loadConfig } from "./config.js";
import { HubClient, type SocketLike } from "./hub-client.js";
import { readKeychainSecret } from "./keychain.js";
import { createLogger } from "./logger.js";
import { Outbox } from "./outbox.js";
import { SessionRegistry } from "./session-registry.js";
import { createDispatcher } from "./rpc-dispatch.js";

export async function main(argv: string[], env: NodeJS.ProcessEnv): Promise<void> {
  const logger = createLogger("@omnis/local-agent");
  const tomlPath = join(homedir(), ".omnis", "local-agent.toml");
  let tomlText: string | undefined;
  try { tomlText = readFileSync(tomlPath, "utf8"); } catch { tomlText = undefined; }

  const { config, provenance } = loadConfig({ argv, env, ...(tomlText === undefined ? {} : { tomlText }) });
  for (const [key, source] of Object.entries(provenance)) {
    logger.info("config resolved", { key, value: config[key as "host" | "hub_url" | "token_keychain_item"], source });
  }

  const registry = new SessionRegistry();
  const outbox = new Outbox({ path: join(homedir(), ".omnis", "outbox.ndjson") });
  const token = await readKeychainSecret(config.token_keychain_item);

  const client = new HubClient({
    url: config.hub_url,
    token,
    logger,
    connect: (url, headers) => new WebSocket(url, { headers }) as unknown as SocketLike,
    dispatch: createDispatcher({
      registry,
      adapters: new Map(),
      allowedRoots: new Map(),
      runtimeIds: new Map(),
      logger,
      host: config.host,
    }),
    onOpen: async () => { await outbox.drain(async (e) => { client.notify(e.method, e.params); }); },
  });
  await client.start();
}

if (process.argv[1]?.endsWith("main.js") === true) {
  void main(process.argv.slice(2), process.env);
}
```

5. - [ ] 테스트와 타입체크를 돌린다: `pnpm --filter @omnis/local-agent test` → 6 passed, `pnpm typecheck` → exit 0

6. - [ ] 커밋한다:

```bash
git -C omnis/.worktrees/US-A17 add apps/local-agent/src/rpc-dispatch.ts apps/local-agent/src/main.ts apps/local-agent/test/rpc-dispatch.test.ts
git -C omnis/.worktrees/US-A17 commit -m "US-A17: RPC 디스패처 + main 엔트리(delegate.run은 -32006으로 거절)

- 버전 협상 → 메서드 라우팅 → params zod 파싱 순서 고정
- ingest.* 는 Phase B라 -32601, session.read_summary는 허브 소유라 -32003
- session.create는 슬롯만 만들고 프로세스를 띄우지 않는다

Co-Authored-By: Claude Sonnet <noreply@anthropic.com>"
```

---

## US-A18 — Claude Code 브리지 (Task 11~12)

> **목표**(A7 §7): Claude Code 브리지(`claude -p --output-format stream-json --resume` 래핑)
> **산출물**: `apps/local-agent/src/bridges/claude-code.ts`
> **검증 명령**: `pnpm --filter @omnis/local-agent test`
> **티어**: Opus · **의존**: US-A17

### Task 11: stream-json 파서와 durable 디바운스 (US-A18, tier: Opus)

**Files:**
- Create: `apps/local-agent/src/bridges/stream-json.ts`, `apps/local-agent/src/bridges/durable-debounce.ts`
- Test: `apps/local-agent/test/stream-json.test.ts`

**Interfaces:**
- Consumes: `BridgeMethod`, `BridgeItemKind`(@omnis/protocol)
- Produces: `BridgeEmit = { method: BridgeMethod; params: Record<string, unknown> }`, `StreamJsonState`, `newStreamJsonState()`, `mapStreamJsonEvent(raw, ctx): BridgeEmit[]`, `truncateToolResult(body: string): { body: string; truncated: boolean }`, `createDurableDebouncer(emit, opts)`

**읽을 것:** A2 §4.1(이벤트 → Item 매핑표 전체), A2-D4(3티어). **만들지 말 것:** `system/init` 전문을 durable로 올리지 않는다(실측 28KB). `content_block_stop`을 처리하지 않는다 — `assistant`가 확정판이다.

1. - [ ] 실패 테스트를 쓴다: `apps/local-agent/test/stream-json.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";
import { createDurableDebouncer } from "../src/bridges/durable-debounce.js";
import { mapStreamJsonEvent, newStreamJsonState, truncateToolResult } from "../src/bridges/stream-json.js";

const ctx = () => ({ session_key: "agent:claude_code:macbook:inbox-draft", turn_id: "t1", state: newStreamJsonState() });

describe("mapStreamJsonEvent (A2 §4.1)", () => {
  it("lifts only session_id and capabilities out of system/init", () => {
    const c = ctx();
    const out = mapStreamJsonEvent({ type: "system", subtype: "init", session_id: "s-42", capabilities: ["interrupt_receipt_v1"], tools: new Array(80).fill("x") }, c);
    expect(out).toHaveLength(1);
    expect(out[0]?.method).toBe("session.registered");
    expect(out[0]?.params.session_id).toBe("s-42");
    expect(JSON.stringify(out[0])).not.toContain("xxxxx");
  });

  it("maps a text content_block_delta to an ephemeral delta with a rising seq", () => {
    const c = ctx();
    mapStreamJsonEvent({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text" } } }, c);
    const a = mapStreamJsonEvent({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "he" } } }, c);
    const b = mapStreamJsonEvent({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "llo" } } }, c);
    expect(a[0]?.method).toBe("turn.item.delta");
    expect(a[0]?.params.seq).toBe(0);
    expect(b[0]?.params.seq).toBe(1);
  });

  it("closes the agent_turn item with the assistant text block", () => {
    const c = ctx();
    mapStreamJsonEvent({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text" } } }, c);
    const out = mapStreamJsonEvent({ type: "assistant", message: { content: [{ type: "text", text: "hello" }] } }, c);
    expect(out[0]?.method).toBe("turn.item.completed");
    expect(out[0]?.params.kind).toBe("agent_turn");
    expect(out[0]?.params.body).toBe("hello");
  });

  it("opens a tool_call on tool_use and closes it on tool_result", () => {
    const c = ctx();
    const started = mapStreamJsonEvent({ type: "assistant", message: { content: [{ type: "tool_use", id: "tu_1", name: "Bash", input: { command: "ls" } }] } }, c);
    expect(started[0]?.params.kind).toBe("tool_call");
    expect(started[0]?.params.label).toBe("Bash");
    const done = mapStreamJsonEvent({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu_1", is_error: false, content: "a\nb" }] } }, c);
    expect(done[0]?.method).toBe("turn.item.completed");
    expect(done[0]?.params.status).toBe("ok");
  });

  it("emits turn.completed with usage from result", () => {
    const out = mapStreamJsonEvent({ type: "result", subtype: "success", total_cost_usd: 0.012, duration_ms: 4200, num_turns: 1 }, ctx());
    expect(out[0]?.method).toBe("turn.completed");
    expect(out[0]?.params.status).toBe("ok");
  });

  it("keeps unknown event types out of durable entirely", () => {
    expect(mapStreamJsonEvent({ type: "some_future_event", payload: 1 }, ctx())).toEqual([]);
  });

  it("truncates a tool_result over 8KB to head 2KB + tail 1KB", () => {
    const r = truncateToolResult("A".repeat(9000));
    expect(r.truncated).toBe(true);
    expect(r.body).toContain("bytes truncated");
    expect(r.body.length).toBeLessThan(3200);
  });
});

describe("createDurableDebouncer (A2-D4)", () => {
  it("coalesces repeated completions for one item inside the window and flushes on turn.completed", () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const d = createDurableDebouncer((e) => seen.push(`${e.method}:${String(e.params.body ?? "")}`), { intervalMs: 500 });
    d.push({ method: "turn.item.started", params: { item_id: "i1" } });
    d.push({ method: "turn.item.started", params: { item_id: "i1" } });
    d.push({ method: "turn.item.completed", params: { item_id: "i1", body: "partial" } });
    d.push({ method: "turn.item.completed", params: { item_id: "i1", body: "final" } });
    d.push({ method: "turn.completed", params: { turn_id: "t1" } });
    expect(seen).toEqual(["turn.item.started:", "turn.item.completed:final", "turn.completed:"]);
    vi.useRealTimers();
  });
});
```

2. - [ ] 실행해 실패를 확인한다: `pnpm --filter @omnis/local-agent test`
   기대 실패: `Failed to resolve import "../src/bridges/stream-json.js"`

3. - [ ] `apps/local-agent/src/bridges/durable-debounce.ts`를 만든다:

```ts
import type { BridgeMethod } from "@omnis/protocol";

export interface DurableEvent { method: BridgeMethod; params: Record<string, unknown> }

/**
 * A2-D4: turn.item.started에서 row를 만들고, UPDATE는 500ms 디바운스 또는 turn.item.completed에만.
 * 같은 item_id의 started 중복은 버리고, completed 연타는 마지막 것만 남긴다.
 */
export function createDurableDebouncer(
  emit: (e: DurableEvent) => void,
  opts: { intervalMs?: number } = {},
): { push(e: DurableEvent): void; flush(): void } {
  const intervalMs = opts.intervalMs ?? 500;
  const started = new Set<string>();
  const held = new Map<string, DurableEvent>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    for (const e of held.values()) emit(e);
    held.clear();
  };

  const arm = (): void => {
    if (timer !== null) return;
    timer = setTimeout(() => { timer = null; flush(); }, intervalMs);
  };

  return {
    push(e: DurableEvent): void {
      const itemId = String(e.params.item_id ?? "");
      if (e.method === "turn.item.started") {
        if (started.has(itemId)) return;
        started.add(itemId);
        emit(e);
        return;
      }
      if (e.method === "turn.item.completed") { held.set(itemId, e); arm(); return; }
      flush();
      emit(e);
    },
    flush,
  };
}
```

4. - [ ] `apps/local-agent/src/bridges/stream-json.ts`를 만든다:

```ts
import type { BridgeItemKind, BridgeMethod } from "@omnis/protocol";

export interface BridgeEmit { method: BridgeMethod; params: Record<string, unknown> }

export interface StreamJsonState {
  seq: Map<string, number>;
  openText: string | null;
  toolLabels: Map<string, string>;
}
export function newStreamJsonState(): StreamJsonState {
  return { seq: new Map(), openText: null, toolLabels: new Map() };
}

const HEAD = 2048;
const TAIL = 1024;
const LIMIT = 8192;

export function truncateToolResult(body: string): { body: string; truncated: boolean } {
  const bytes = Buffer.byteLength(body, "utf8");
  if (bytes <= LIMIT) return { body, truncated: false };
  const cut = bytes - HEAD - TAIL;
  return { body: `${body.slice(0, HEAD)}… (${cut} bytes truncated)${body.slice(-TAIL)}`, truncated: true };
}

interface Ctx { session_key: string; turn_id: string; state: StreamJsonState }

function nextSeq(state: StreamJsonState, itemId: string): number {
  const n = state.seq.get(itemId) ?? 0;
  state.seq.set(itemId, n + 1);
  return n;
}

function item(ctx: Ctx, itemId: string, extra: Record<string, unknown>): Record<string, unknown> {
  return { session_key: ctx.session_key, turn_id: ctx.turn_id, item_id: itemId, ...extra };
}

/** A2 §4.1 매핑표. 표에 없는 이벤트는 빈 배열 → cold 티어에만 남는다. */
export function mapStreamJsonEvent(raw: unknown, ctx: Ctx): BridgeEmit[] {
  const ev = raw as Record<string, unknown>;
  const type = ev.type;

  if (type === "system" && ev.subtype === "init") {
    return [{ method: "session.registered", params: {
      session_key: ctx.session_key,
      session_id: String(ev.session_id ?? ""),
      capabilities_raw: Array.isArray(ev.capabilities) ? ev.capabilities : [],
    } }];
  }

  if (type === "stream_event") {
    const inner = (ev.event ?? {}) as Record<string, unknown>;
    const idx = `blk-${String(inner.index ?? 0)}`;
    if (inner.type === "content_block_start") {
      const block = (inner.content_block ?? {}) as Record<string, unknown>;
      if (block.type !== "text") return [];
      ctx.state.openText = idx;
      return [{ method: "turn.item.started", params: item(ctx, idx, { kind: "agent_turn" satisfies BridgeItemKind, label: "assistant", meta: {} }) }];
    }
    if (inner.type === "content_block_delta") {
      const delta = (inner.delta ?? {}) as Record<string, unknown>;
      const text = typeof delta.text === "string" ? delta.text : "";
      if (text === "") return [];
      return [{ method: "turn.item.delta", params: item(ctx, idx, { seq: nextSeq(ctx.state, idx), text, channel: "output" }) }];
    }
    return [];
  }

  if (type === "assistant") {
    const content = (((ev.message ?? {}) as Record<string, unknown>).content ?? []) as Record<string, unknown>[];
    const out: BridgeEmit[] = [];
    for (const block of content) {
      if (block.type === "text") {
        const id = ctx.state.openText ?? "blk-0";
        out.push({ method: "turn.item.completed", params: item(ctx, id, { kind: "agent_turn", body: String(block.text ?? ""), status: "ok", meta: {} }) });
        ctx.state.openText = null;
      } else if (block.type === "tool_use") {
        const id = String(block.id ?? "");
        const label = String(block.name ?? "tool");
        ctx.state.toolLabels.set(id, label);
        out.push({ method: "turn.item.started", params: item(ctx, id, { kind: "tool_call", label, meta: { tool: label, input: block.input ?? {} } }) });
      }
    }
    return out;
  }

  if (type === "user") {
    const content = (((ev.message ?? {}) as Record<string, unknown>).content ?? []) as Record<string, unknown>[];
    return content.filter((b) => b.type === "tool_result").map((b) => {
      const id = String(b.tool_use_id ?? "");
      const { body, truncated } = truncateToolResult(typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? ""));
      return { method: "turn.item.completed" as BridgeMethod, params: item(ctx, id, {
        kind: "tool_call", body, status: b.is_error === true ? "failed" : "ok",
        meta: { label: ctx.state.toolLabels.get(id) ?? "tool", ...(truncated ? { cold_ref: ctx.turn_id } : {}) },
      }) };
    });
  }

  if (type === "result") {
    return [{ method: "turn.completed", params: {
      session_key: ctx.session_key, turn_id: ctx.turn_id,
      status: ev.subtype === "success" ? "ok" : "failed",
      usage: {
        cost_usd: typeof ev.total_cost_usd === "number" ? ev.total_cost_usd : null,
        duration_ms: Number(ev.duration_ms ?? 0),
        num_turns: Number(ev.num_turns ?? 1),
      },
    } }];
  }

  if (type === "rate_limit_event") {
    return [{ method: "health", params: { session_key: ctx.session_key, limited: true, at: new Date().toISOString() } }];
  }

  return [];
}
```

5. - [ ] 테스트를 돌린다: `pnpm --filter @omnis/local-agent test` → 8 passed

6. - [ ] 커밋한다:

```bash
git -C omnis/.worktrees/US-A18 add apps/local-agent/src/bridges apps/local-agent/test/stream-json.test.ts
git -C omnis/.worktrees/US-A18 commit -m "US-A18: stream-json 이벤트 → Item 매핑 + durable 500ms 디바운스

- A2 §4.1 표 전량, system/init은 session_id·capabilities만 승격
- 미지 이벤트는 durable 0건(cold 전용), tool_result 8KB 축약

Co-Authored-By: Claude Opus <noreply@anthropic.com>"
```

### Task 12: Claude Code 어댑터와 claude-ds 변형 (US-A18, tier: Opus)

**Files:**
- Create: `apps/local-agent/src/bridges/claude-code.ts`
- Test: `apps/local-agent/test/claude-code.test.ts`

**Interfaces:**
- Consumes: Task 11의 `mapStreamJsonEvent`/`newStreamJsonState`/`createDurableDebouncer`, Task 10의 `RuntimeAdapter`/`EventSink`/`TurnHandle`, Task 7의 `SessionRecord`
- Produces: `PERMISSION_MODE`, `permissionModeFor(profile, origin)`, `buildClaudeArgs(opts): string[]`, `parseClaudeCapabilities(versionLine: string): { version, capabilities }`, `ClaudeCodeAdapter`, `createClaudeDsAdapter(cfg)`

**읽을 것:** A2-D5, A2-D8, A2-D11, §4.1, §4.3(claude-ds 차이표), §7.1. **만들지 말 것:** 상주 프로세스. Agent SDK. `--settings` hook 주입의 정확한 표면(S-A2-1 미검증) — 플래그 자리만 비워 두고 hook 승격은 US-A20의 mock으로 검증한다.

**`--bare`는 인증 방식을 바꾼다(프로브 실측, `tools/spikes/_probes/2026-09-20-cli-probes.md` §2).** `--bare` 아래에서 Anthropic 인증은 **`ANTHROPIC_API_KEY` 또는 `--settings`의 `apiKeyHelper`로 한정**되고 OAuth·Keychain은 아예 읽지 않는다. 즉 `--bare`로 도는 위임 턴은 Claude 구독(T3)을 못 타고 토큰 과금(T2급)이 된다 — A2-D11이 "위임은 구독 바이너리를 탄다"고 가정한 것과 어긋난다. **위임 런 모드를 어느 쪽으로 할지는 게이트 ⑪(S-A2-1) / 마스터 §19 Q13이 결정한다.** 그 결정이 나기 전이므로 Phase A 브리지는 **두 호출 방식을 모두 지원**한다: `bare` 설정 플래그(`ClaudeAdapterConfig.bare?: boolean`)가 강제/금지를 주고, 미지정이면 A2-D11의 보수값(비human origin = `--bare`)으로 떨어진다. claude-ds(DeepSeek, API 키)는 영향 없음 — `--bare`가 자연스러운 모드라 `bare: true`로 고정한다.

1. - [ ] 실패 테스트를 쓴다: `apps/local-agent/test/claude-code.test.ts`

```ts
import { BridgeError } from "@omnis/protocol";
import { describe, expect, it } from "vitest";
import { PERMISSION_MODE, buildClaudeArgs, parseClaudeCapabilities, permissionModeFor } from "../src/bridges/claude-code.js";

describe("buildClaudeArgs (A2-D5)", () => {
  it("always asks for stream-json with verbose and partial messages", () => {
    const a = buildClaudeArgs({ prompt: "hi", model: "sonnet", profile: "workspace", origin: "delegation", sessionId: null });
    expect(a.slice(0, 7)).toEqual(["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--model", "sonnet"]);
    expect(a).toContain("hi");
  });

  it("adds --resume only when a session_id exists", () => {
    expect(buildClaudeArgs({ prompt: "x", model: "sonnet", profile: "trusted", origin: "human", sessionId: null })).not.toContain("--resume");
    const resumed = buildClaudeArgs({ prompt: "x", model: "sonnet", profile: "trusted", origin: "human", sessionId: "s-42" });
    expect(resumed[resumed.indexOf("--resume") + 1]).toBe("s-42");
  });

  it("falls back to --bare on every non-human origin when nothing decided it (A2-D11)", () => {
    expect(buildClaudeArgs({ prompt: "x", model: "sonnet", profile: "workspace", origin: "delegation", sessionId: null })).toContain("--bare");
    expect(buildClaudeArgs({ prompt: "x", model: "sonnet", profile: "trusted", origin: "human", sessionId: null })).not.toContain("--bare");
  });

  it("lets the bare flag override the origin default in both directions (게이트 ⑪ 미확정)", () => {
    // 구독 인증으로 위임을 돌리는 쪽으로 게이트 ⑪이 정해지면 bare:false
    expect(buildClaudeArgs({ prompt: "x", model: "sonnet", profile: "workspace", origin: "delegation", sessionId: null, bare: false })).not.toContain("--bare");
    // API 키로 human 턴까지 격리하는 쪽으로 정해지면 bare:true
    expect(buildClaudeArgs({ prompt: "x", model: "sonnet", profile: "trusted", origin: "human", sessionId: null, bare: true })).toContain("--bare");
  });

  it("adds --strict-mcp-config for the claude-ds variant", () => {
    expect(buildClaudeArgs({ prompt: "x", model: "deepseek-flash", profile: "workspace", origin: "delegation", sessionId: null, strictMcpConfig: true })).toContain("--strict-mcp-config");
  });
});

describe("permissionModeFor (A2 §7.1)", () => {
  const CLI_MODES = ["acceptEdits", "auto", "bypassPermissions", "manual", "dontAsk", "plan"];

  it("maps each profile to a literal the CLI actually accepts", () => {
    expect(permissionModeFor("observe", "job")).toBe("plan");
    expect(permissionModeFor("workspace", "delegation")).toBe("manual");
    expect(permissionModeFor("trusted", "human")).toBe("bypassPermissions");
    for (const mode of Object.values(PERMISSION_MODE)) expect(CLI_MODES).toContain(mode);
    expect(Object.values(PERMISSION_MODE)).not.toContain("default");  // claude 2.1.274에 없는 값
  });

  it("never yields bypassPermissions outside trusted+human", () => {
    expect(permissionModeFor("trusted", "human")).toBe("bypassPermissions");
    for (const [p, o] of [["workspace", "delegation"], ["observe", "job"], ["workspace", "human"]] as const) {
      expect(permissionModeFor(p, o)).not.toBe("bypassPermissions");
    }
  });

  it("refuses a trusted profile that did not come from a human", () => {
    expect(() => permissionModeFor("trusted", "delegation")).toThrow(BridgeError);
  });
});

describe("parseClaudeCapabilities", () => {
  it("turns on cross_project_resume from 2.1.223 upwards", () => {
    expect(parseClaudeCapabilities("2.1.231 (Claude Code)").capabilities.cross_project_resume).toBe(true);
    expect(parseClaudeCapabilities("2.1.205 (Claude Code)").capabilities.cross_project_resume).toBe(false);
  });

  it("always reports hook approvals and delta streaming", () => {
    const c = parseClaudeCapabilities("2.1.231 (Claude Code)").capabilities;
    expect(c.approvals).toBe("hook");
    expect(c.stream_deltas).toBe(true);
    expect(c.reasoning_stream).toBe(false);
  });
});
```

2. - [ ] 실행해 실패를 확인한다: `pnpm --filter @omnis/local-agent test`
   기대 실패: `Failed to resolve import "../src/bridges/claude-code.js"`

3. - [ ] `apps/local-agent/src/bridges/claude-code.ts`를 만든다:

```ts
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import {
  BRIDGE_ERRORS, BridgeError, JSONRPC_ERRORS,
  type PermissionProfile, type RuntimeCapabilities, type RuntimeKind, type SessionOrigin, type TurnInput,
} from "@omnis/protocol";
import type { EventSink, RuntimeAdapter, TurnHandle } from "../rpc-dispatch.js";
import type { SessionRecord } from "../session-registry.js";
import { createDurableDebouncer } from "./durable-debounce.js";
import { mapStreamJsonEvent, newStreamJsonState } from "./stream-json.js";

/**
 * profile → --permission-mode 매핑(A2 §7.1, 계약 §8).
 * claude 2.1.274 실측 리터럴은 acceptEdits|auto|bypassPermissions|manual|dontAsk|plan 6종뿐이고
 * 'default'라는 값은 존재하지 않는다(tools/spikes/_probes/2026-09-20-cli-probes.md §3).
 * 게이트 ⑫(S-A2-2)가 확정하기 전까지 이 표는 pending이지만, 불변식은 지금 고정이다:
 * bypassPermissions는 trusted + origin='human'에서만 나온다.
 */
export const PERMISSION_MODE: Record<PermissionProfile, string> = {
  observe: "plan",
  workspace: "manual",
  trusted: "bypassPermissions",
};

export function permissionModeFor(profile: PermissionProfile, origin: SessionOrigin): string {
  if (profile === "trusted" && origin !== "human") {
    throw new BridgeError(JSONRPC_ERRORS.INVALID_PARAMS, "trusted profile requires origin='human' (A2 §7.1)");
  }
  return PERMISSION_MODE[profile];
}

export interface ClaudeArgsOpts {
  prompt: string;
  model: string;
  profile: PermissionProfile;
  origin: SessionOrigin;
  sessionId: string | null;
  strictMcpConfig?: boolean;
  /**
   * `--bare`를 켤지. 미지정이면 A2-D11의 보수값(비human origin = bare).
   * `--bare`는 인증 경로를 ANTHROPIC_API_KEY / apiKeyHelper로 한정하고 OAuth·Keychain을 읽지 않는다
   * (claude 2.1.274 실측). 위임 런을 구독으로 돌릴지 API 키로 돌릴지는 게이트 ⑪ / 마스터 §19 Q13이 정한다 —
   * 정해질 때까지 두 방식을 다 지원하려고 이 플래그가 있다.
   */
  bare?: boolean;
}

export function buildClaudeArgs(o: ClaudeArgsOpts): string[] {
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--model", o.model,
    "--permission-mode", permissionModeFor(o.profile, o.origin)];
  if (o.sessionId !== null) args.push("--resume", o.sessionId);
  if (o.bare ?? o.origin !== "human") args.push("--bare");           // A2-D11 기본값, 게이트 ⑪이 뒤집을 수 있다
  if (o.strictMcpConfig === true) args.push("--strict-mcp-config");  // A2 §4.3
  args.push(o.prompt);
  return args;
}

export function parseClaudeCapabilities(versionLine: string): { version: string; capabilities: RuntimeCapabilities } {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(versionLine);
  const [maj, min, pat] = [Number(m?.[1] ?? 0), Number(m?.[2] ?? 0), Number(m?.[3] ?? 0)];
  const atLeast = (a: number, b: number, c: number): boolean => maj > a || (maj === a && (min > b || (min === b && pat >= c)));
  return {
    version: `claude ${maj}.${min}.${pat}`,
    capabilities: {
      resume: true,
      cross_project_resume: atLeast(2, 1, 223),
      stream_deltas: true,
      reasoning_stream: false,
      tool_calls: true,
      approvals: "hook",
      cancel: true,
      models: ["sonnet", "haiku", "opus"],
      features: [],
    },
  };
}

export interface ClaudeAdapterConfig {
  kind: Extract<RuntimeKind, "claude_code" | "claude_ds">;
  binary: string;
  defaultModel: string;
  strictMcpConfig?: boolean;
  /** 게이트 ⑪ 확정 전까지의 스위치. 미지정이면 origin 기본값(A2-D11). TOML `[[runtime]]`의 `bare`가 여기로 온다. */
  bare?: boolean;
  env?: NodeJS.ProcessEnv;
  spawnFn?: typeof spawn;
}

/** A2-D5: 턴당 서브프로세스. 상주시키지 않는다. A2-D8: claude-ds는 이 클래스의 설정 변형이다. */
export class ClaudeCodeAdapter implements RuntimeAdapter {
  readonly kind: RuntimeKind;
  constructor(private readonly cfg: ClaudeAdapterConfig) { this.kind = cfg.kind; }

  async probe(): Promise<{ version: string; capabilities: RuntimeCapabilities }> {
    const line = await this.#capture(["--version"]);
    return parseClaudeCapabilities(line);
  }

  async startTurn(s: SessionRecord, input: TurnInput, sink: EventSink): Promise<TurnHandle> {
    const args = buildClaudeArgs({
      prompt: input.text,
      model: this.cfg.defaultModel,
      profile: s.permission_profile,
      origin: s.origin,
      sessionId: s.session_id,
      ...(this.cfg.strictMcpConfig === true ? { strictMcpConfig: true } : {}),
      ...(this.cfg.bare === undefined ? {} : { bare: this.cfg.bare }),
    });
    const turnId = `t-${Date.now().toString(36)}`;
    const child = (this.cfg.spawnFn ?? spawn)(this.cfg.binary, args, {
      cwd: s.cwd,
      env: { ...process.env, ...this.cfg.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (child.stdout === null) throw new BridgeError(BRIDGE_ERRORS.RUNTIME_UNAVAILABLE, `${this.cfg.binary} produced no stdout`);

    const state = newStreamJsonState();
    const debounced = createDurableDebouncer((e) => {
      if (e.method === "turn.item.started") sink.itemStarted(e.params);
      else if (e.method === "turn.item.completed") sink.itemCompleted(e.params);
      else sink.turnCompleted(e.params);
    });

    createInterface({ input: child.stdout }).on("line", (line) => {
      sink.raw(line);                                  // cold 티어
      let ev: unknown;
      try { ev = JSON.parse(line); } catch { return; } // 미지 형식도 파서를 죽이지 않는다
      for (const emit of mapStreamJsonEvent(ev, { session_key: s.session_key, turn_id: turnId, state })) {
        if (emit.method === "turn.item.delta") sink.delta(emit.params);   // ephemeral, 저장 안 함
        else if (emit.method === "session.registered" || emit.method === "health") sink.itemStarted(emit.params);
        else debounced.push({ method: emit.method, params: emit.params });
      }
    });

    return {
      turn_id: turnId,
      cancel: async (): Promise<boolean> => { child.kill("SIGTERM"); return true; },
    };
  }

  async cancel(h: TurnHandle, reason: string): Promise<boolean> { return h.cancel(reason); }

  async close(): Promise<void> { /* 턴당 프로세스라 닫을 상주 자원이 없다 */ }

  async #capture(args: string[]): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
      const child = (this.cfg.spawnFn ?? spawn)(this.cfg.binary, args, { stdio: ["ignore", "pipe", "ignore"] });
      let out = "";
      child.stdout?.on("data", (d: Buffer) => { out += d.toString("utf8"); });
      child.on("error", reject);
      child.on("close", () => resolve(out.trim()));
    });
  }
}

/** A2 §4.3: 바이너리·모델 alias·키 출처만 다르다. 비용은 result.cost_usd를 믿지 않는다. */
export function createClaudeDsAdapter(cfg: { binary: string; apiKey: string; model?: string; spawnFn?: typeof spawn }): ClaudeCodeAdapter {
  return new ClaudeCodeAdapter({
    kind: "claude_ds",
    binary: cfg.binary,
    defaultModel: cfg.model ?? "deepseek-flash",
    strictMcpConfig: true,
    bare: true,              // API 키로만 돌므로 --bare가 자연스러운 모드(프로브 §2). 게이트 ⑪과 무관하다.
    env: { DEEPSEEK_API_KEY: cfg.apiKey },
    ...(cfg.spawnFn === undefined ? {} : { spawnFn: cfg.spawnFn }),
  });
}
```

4. - [ ] 테스트를 돌린다: `pnpm --filter @omnis/local-agent test` → 10 passed

5. - [ ] 커밋한다:

```bash
git -C omnis/.worktrees/US-A18 add apps/local-agent/src/bridges/claude-code.ts apps/local-agent/test/claude-code.test.ts
git -C omnis/.worktrees/US-A18 commit -m "US-A18: Claude Code 어댑터(턴당 서브프로세스) + claude-ds 변형

- A2-D5 플래그 조합 고정, A2-D11 비human origin은 --bare가 기본값
- --bare는 ANTHROPIC_API_KEY/apiKeyHelper 인증만 탄다(프로브 실측) → bare 플래그로 양쪽 호출 모두 지원, 위임 모드는 게이트 ⑪ / 마스터 §19 Q13이 확정
- --permission-mode는 CLI 실측 리터럴만: observe→plan, workspace→manual, trusted→bypassPermissions
- bypassPermissions는 trusted+human에서만(그 외는 BridgeError)
- A2-D8: claude-ds는 별도 클래스가 아니라 설정 변형(bare: true 고정)

Co-Authored-By: Claude Opus <noreply@anthropic.com>"
```

---

## US-A19 — Codex 브리지 (Task 13~15)

> **목표**(A7 §7): Codex 브리지(`app-server` JSON-RPC, 버전 핀)
> **산출물**: `apps/local-agent/src/bridges/codex.ts`
> **검증 명령**: `pnpm --filter @omnis/local-agent test`
> **티어**: Opus · **의존**: US-A17

### Task 13: `app-server` stdio JSON-RPC 클라이언트 (US-A19, tier: Opus)

**Files:**
- Create: `apps/local-agent/src/bridges/app-server-client.ts`
- Test: `apps/local-agent/test/app-server-client.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `AppServerClient`(생성자 `{ stdin: NodeJS.WritableStream; stdout: NodeJS.ReadableStream }`, 메서드 `request`/`on`/`close`)

**읽을 것:** A2-D6, §4.2 앞머리. **만들지 말 것:** 재시작·헬스체크 루프를 여기 넣지 않는다 — 상주 프로세스 수명 관리는 Task 14의 어댑터 책임이다.

1. - [ ] 실패 테스트를 쓴다: `apps/local-agent/test/app-server-client.test.ts`

```ts
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { AppServerClient } from "../src/bridges/app-server-client.js";

describe("AppServerClient", () => {
  it("correlates a response to its request id", async () => {
    const stdin = new PassThrough(); const stdout = new PassThrough();
    const c = new AppServerClient({ stdin, stdout });
    const p = c.request("thread.start", { cwd: "/tmp" });
    const sent = JSON.parse((await new Promise<Buffer>((r) => stdin.once("data", r))).toString());
    expect(sent.method).toBe("thread.start");
    stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: sent.id, result: { threadId: "th_1" } })}\n`);
    await expect(p).resolves.toEqual({ threadId: "th_1" });
  });

  it("routes notifications to a handler and survives a malformed line", async () => {
    const stdin = new PassThrough(); const stdout = new PassThrough();
    const c = new AppServerClient({ stdin, stdout });
    const seen: unknown[] = [];
    c.on("item/started", (p) => seen.push(p));
    stdout.write("not json at all\n");
    stdout.write(`${JSON.stringify({ jsonrpc: "2.0", method: "item/started", params: { item: { type: "agentMessage", id: "i1" } } })}\n`);
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toHaveLength(1);
  });

  it("rejects a pending request when the server answers with an error", async () => {
    const stdin = new PassThrough(); const stdout = new PassThrough();
    const c = new AppServerClient({ stdin, stdout });
    const p = c.request("turn.start", {});
    const sent = JSON.parse((await new Promise<Buffer>((r) => stdin.once("data", r))).toString());
    stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: sent.id, error: { code: -32000, message: "nope" } })}\n`);
    await expect(p).rejects.toMatchObject({ code: -32000 });
  });
});
```

2. - [ ] 실행해 실패를 확인한다: `pnpm --filter @omnis/local-agent test`
   기대 실패: `Failed to resolve import "../src/bridges/app-server-client.js"`

3. - [ ] `apps/local-agent/src/bridges/app-server-client.ts`를 만든다:

```ts
import { createInterface } from "node:readline";

type Handler = (params: unknown) => void;

/** A2-D6: 상주 app-server 자식 1개를 stdio로 붙든다. 줄바꿈 구분 JSON-RPC 2.0. */
export class AppServerClient {
  #nextId = 1;
  readonly #pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  readonly #handlers = new Map<string, Handler[]>();

  constructor(private readonly io: { stdin: NodeJS.WritableStream; stdout: NodeJS.ReadableStream }) {
    createInterface({ input: io.stdout }).on("line", (line) => { this.#onLine(line); });
  }

  on(method: string, fn: Handler): void {
    const list = this.#handlers.get(method) ?? [];
    list.push(fn);
    this.#handlers.set(method, list);
  }

  request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.io.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  close(): void {
    for (const p of this.#pending.values()) p.reject(new Error("app-server closed"));
    this.#pending.clear();
  }

  #onLine(line: string): void {
    let msg: { id?: number; method?: string; params?: unknown; result?: unknown; error?: unknown };
    try { msg = JSON.parse(line); } catch { return; }   // 미지 형식도 파서를 죽이지 않는다
    if (typeof msg.id === "number" && msg.method === undefined) {
      const p = this.#pending.get(msg.id);
      this.#pending.delete(msg.id);
      if (p === undefined) return;
      if (msg.error !== undefined) p.reject(msg.error);
      else p.resolve(msg.result);
      return;
    }
    if (typeof msg.method === "string") {
      for (const fn of this.#handlers.get(msg.method) ?? []) fn(msg.params);
    }
  }
}
```

4. - [ ] 테스트를 돌린다: `pnpm --filter @omnis/local-agent test` → 3 passed

5. - [ ] 커밋한다:

```bash
git -C omnis/.worktrees/US-A19 add apps/local-agent/src/bridges/app-server-client.ts apps/local-agent/test/app-server-client.test.ts
git -C omnis/.worktrees/US-A19 commit -m "US-A19: Codex app-server stdio JSON-RPC 클라이언트

- 줄 단위 프레이밍, id 상관, 알림 핸들러
- 깨진 줄은 무시하고 스트림을 계속 읽는다

Co-Authored-By: Claude Opus <noreply@anthropic.com>"
```

### Task 14: Codex 이벤트 매핑과 승인 변환 (US-A19, tier: Opus)

**Files:**
- Create: `apps/local-agent/src/bridges/codex.ts`
- Test: `apps/local-agent/test/codex.test.ts`

**Interfaces:**
- Consumes: Task 13의 `AppServerClient`, Task 11의 `BridgeEmit`, Task 10의 `RuntimeAdapter`/`EventSink`
- Produces: `KNOWN_CODEX_ITEM_TYPES`, `REASONING_DELTA_METHODS`, `mapAppServerEvent(method, params, ctx): BridgeEmit[]`, `codexDecisionToResponse(d)`, `CodexAdapter`

**읽을 것:** A2 §4.2(이벤트표 + 승인 매핑표 + 버전 드리프트). **만들지 말 것:** reasoning 델타를 durable로 승격하지 않는다(표에 "durable 승격 금지"라고 못박혀 있다). `acceptWithExecpolicyAmendment`를 UI에 노출하지 않는다(S-A2-3 미검증 → decline으로 강등).

1. - [ ] 실패 테스트를 쓴다: `apps/local-agent/test/codex.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { codexDecisionToResponse, mapAppServerEvent } from "../src/bridges/codex.js";

const ctx = () => ({ session_key: "agent:codex:mini:proj-omnis", turn_id: "t1", seq: new Map<string, number>() });

describe("mapAppServerEvent (A2 §4.2)", () => {
  it("binds the runtime session_id from thread.started", () => {
    const out = mapAppServerEvent("thread.started", { threadId: "th_7" }, ctx());
    expect(out[0]?.method).toBe("session.registered");
    expect(out[0]?.params.session_id).toBe("th_7");
  });

  it("keeps every reasoning delta ephemeral and tagged", () => {
    for (const m of ["item/reasoning/textDelta", "item/reasoning/summaryTextDelta", "item/plan/delta"]) {
      const out = mapAppServerEvent(m, { itemId: "i1", delta: "thinking" }, ctx());
      expect(out[0]?.method).toBe("turn.item.delta");
      expect(out[0]?.params.channel).toBe("reasoning");
    }
  });

  it("generalises an unknown item type instead of dropping the thread", () => {
    const out = mapAppServerEvent("item/started", { item: { id: "i9", type: "quantumToolCall" } }, ctx());
    expect(out[0]?.method).toBe("turn.item.started");
    expect(out[0]?.params.kind).toBe("tool_call");
    expect(out[0]?.params.label).toBe("quantumToolCall");
  });

  it("maps agentMessage to an agent_turn item", () => {
    const out = mapAppServerEvent("item/started", { item: { id: "i1", type: "agentMessage" } }, ctx());
    expect(out[0]?.params.kind).toBe("agent_turn");
  });

  it("turns turn.failed into a failed turn.completed", () => {
    const out = mapAppServerEvent("turn.failed", { error: { code: -32009, message: "usage limit" } }, ctx());
    expect(out[0]?.method).toBe("turn.completed");
    expect(out[0]?.params.status).toBe("failed");
  });
});

describe("codexDecisionToResponse (A2 §4.2 승인표)", () => {
  it("maps accept / decline straight through", () => {
    expect(codexDecisionToResponse("accept")).toEqual({ decision: "accept" });
    expect(codexDecisionToResponse("decline")).toEqual({ decision: "ignore" });
  });

  it("records a session rule for acceptForSession", () => {
    expect(codexDecisionToResponse("acceptForSession")).toEqual({ decision: "accept", decided_args: { session_rules: true } });
  });

  it("downgrades acceptWithExecpolicyAmendment to ignore until S-A2-3", () => {
    expect(codexDecisionToResponse("acceptWithExecpolicyAmendment")).toEqual({ decision: "ignore" });
  });
});
```

2. - [ ] 실행해 실패를 확인한다: `pnpm --filter @omnis/local-agent test`
   기대 실패: `Failed to resolve import "../src/bridges/codex.js"`

3. - [ ] `apps/local-agent/src/bridges/codex.ts`를 만든다:

```ts
import { spawn } from "node:child_process";
import type { HumanResponse, RuntimeCapabilities, RuntimeKind, TurnInput } from "@omnis/protocol";
import type { EventSink, RuntimeAdapter, TurnHandle } from "../rpc-dispatch.js";
import type { SessionRecord } from "../session-registry.js";
import { AppServerClient } from "./app-server-client.js";
import type { BridgeEmit } from "./stream-json.js";

/** A2 §4.2: 이 목록에 없는 item/started는 kind='tool_call', label=item.type으로 일반화한다. */
export const KNOWN_CODEX_ITEM_TYPES = [
  "agentMessage", "commandExecution", "fileChange", "mcpToolCall",
  "dynamicToolCall", "collabToolCall", "webSearch", "imageView",
] as const;

export const REASONING_DELTA_METHODS = new Set([
  "item/plan/delta", "item/reasoning/textDelta",
  "item/reasoning/summaryTextDelta", "item/reasoning/summaryPartAdded",
]);

export type CodexDecision = "accept" | "acceptForSession" | "decline" | "cancel" | "acceptWithExecpolicyAmendment";

export function codexDecisionToResponse(d: CodexDecision): HumanResponse {
  switch (d) {
    case "accept": return { decision: "accept" };
    case "acceptForSession": return { decision: "accept", decided_args: { session_rules: true } };
    // S-A2-3 전까지 amendment payload 스키마를 모르므로 edit 경로를 UI에 노출하지 않는다.
    case "acceptWithExecpolicyAmendment":
    case "decline":
    case "cancel":
    default: return { decision: "ignore" };
  }
}

interface Ctx { session_key: string; turn_id: string; seq: Map<string, number> }

function delta(ctx: Ctx, itemId: string, text: string, channel: "output" | "reasoning"): BridgeEmit {
  const n = ctx.seq.get(itemId) ?? 0;
  ctx.seq.set(itemId, n + 1);
  return { method: "turn.item.delta", params: { session_key: ctx.session_key, turn_id: ctx.turn_id, item_id: itemId, seq: n, text, channel } };
}

export function mapAppServerEvent(method: string, params: unknown, ctx: Ctx): BridgeEmit[] {
  const p = (params ?? {}) as Record<string, unknown>;
  const base = { session_key: ctx.session_key, turn_id: ctx.turn_id };

  if (method === "thread.started") {
    return [{ method: "session.registered", params: { ...base, session_id: String(p.threadId ?? "") } }];
  }
  if (method === "turn.started") return [{ method: "turn.started", params: { ...base, at: new Date().toISOString() } }];

  if (REASONING_DELTA_METHODS.has(method)) {
    return [delta(ctx, String(p.itemId ?? "reasoning"), String(p.delta ?? ""), "reasoning")];
  }
  if (method === "item/agentMessage/delta" || method === "item/commandExecution/outputDelta") {
    return [delta(ctx, String(p.itemId ?? "i"), String(p.delta ?? p.chunk ?? ""), "output")];
  }

  if (method === "item/started") {
    const it = (p.item ?? {}) as Record<string, unknown>;
    const type = String(it.type ?? "unknown");
    const kind = type === "agentMessage" ? "agent_turn" : "tool_call";
    return [{ method: "turn.item.started", params: { ...base, item_id: String(it.id ?? ""), kind, label: type === "agentMessage" ? "assistant" : type, meta: { item_type: type } } }];
  }

  if (method === "item/completed") {
    const it = (p.item ?? {}) as Record<string, unknown>;
    const type = String(it.type ?? "unknown");
    return [{ method: "turn.item.completed", params: {
      ...base, item_id: String(it.id ?? ""),
      kind: type === "agentMessage" ? "agent_turn" : "tool_call",
      body: String(it.text ?? it.output ?? ""),
      status: it.error === undefined ? "ok" : "failed",
      meta: { item_type: type },
    } }];
  }

  if (method === "turn.completed" || method === "turn.failed") {
    const err = p.error as { code?: number; message?: string } | undefined;
    return [{ method: "turn.completed", params: {
      ...base,
      status: method === "turn.completed" ? "ok" : "failed",
      usage: { cost_usd: null, duration_ms: Number(p.durationMs ?? 0), num_turns: 1 },
      ...(err === undefined ? {} : { error: { code: Number(err.code ?? -32603), message: String(err.message ?? "") } }),
    } }];
  }

  return [];   // 미지 이벤트는 cold 전용
}

export interface CodexAdapterConfig { binary: string; spawnFn?: typeof spawn; capabilities: RuntimeCapabilities; version: string }

/** A2-D6: 상주 app-server 자식 1개가 여러 thread/턴을 처리한다. */
export class CodexAdapter implements RuntimeAdapter {
  readonly kind: RuntimeKind = "codex";
  #client: AppServerClient | null = null;
  #child: ReturnType<typeof spawn> | null = null;

  constructor(private readonly cfg: CodexAdapterConfig) {}

  async probe(): Promise<{ version: string; capabilities: RuntimeCapabilities }> {
    return { version: this.cfg.version, capabilities: this.cfg.capabilities };
  }

  #ensure(): AppServerClient {
    if (this.#client !== null) return this.#client;
    const child = (this.cfg.spawnFn ?? spawn)(this.cfg.binary, ["app-server"], { stdio: ["pipe", "pipe", "pipe"] });
    if (child.stdin === null || child.stdout === null) throw new Error("codex app-server has no stdio");
    this.#child = child;
    this.#client = new AppServerClient({ stdin: child.stdin, stdout: child.stdout });
    return this.#client;
  }

  async startTurn(s: SessionRecord, input: TurnInput, sink: EventSink): Promise<TurnHandle> {
    const client = this.#ensure();
    const turnId = `t-${Date.now().toString(36)}`;
    const ctx = { session_key: s.session_key, turn_id: turnId, seq: new Map<string, number>() };
    for (const m of ["thread.started", "turn.started", "item/started", "item/completed", "turn.completed", "turn.failed",
      "item/agentMessage/delta", "item/commandExecution/outputDelta", ...REASONING_DELTA_METHODS]) {
      client.on(m, (params) => {
        sink.raw(JSON.stringify({ method: m, params }));
        for (const e of mapAppServerEvent(m, params, ctx)) {
          if (e.method === "turn.item.delta") sink.delta(e.params);
          else if (e.method === "turn.item.started" || e.method === "session.registered") sink.itemStarted(e.params);
          else if (e.method === "turn.item.completed") sink.itemCompleted(e.params);
          else sink.turnCompleted(e.params);
        }
      });
    }
    await client.request("turn.start", { threadId: s.session_id, cwd: s.cwd, input: input.text });
    return { turn_id: turnId, cancel: async () => { await client.request("turn.cancel", { turnId }); return true; } };
  }

  async cancel(h: TurnHandle, reason: string): Promise<boolean> { return h.cancel(reason); }

  async close(): Promise<void> {
    this.#client?.close();
    this.#child?.kill("SIGTERM");
    this.#client = null;
    this.#child = null;
  }
}
```

4. - [ ] 테스트를 돌린다: `pnpm --filter @omnis/local-agent test` → 8 passed

5. - [ ] 커밋한다:

```bash
git -C omnis/.worktrees/US-A19 add apps/local-agent/src/bridges/codex.ts apps/local-agent/test/codex.test.ts
git -C omnis/.worktrees/US-A19 commit -m "US-A19: Codex 이벤트 매핑 + 승인 결정 변환

- 미지 item 타입은 kind='tool_call', label=item.type으로 일반화
- reasoning 델타 4종은 ephemeral 전용(durable 승격 금지)
- acceptWithExecpolicyAmendment는 S-A2-3까지 ignore로 강등

Co-Authored-By: Claude Opus <noreply@anthropic.com>"
```

### Task 15: 버전 핀과 드리프트 강등 (US-A19, tier: Opus)

**Files:**
- Create: `apps/local-agent/src/bridges/codex-probe.ts`
- Test: `apps/local-agent/test/codex-probe.test.ts`

**Interfaces:**
- Consumes: `RuntimeCapabilities`, `RuntimeState`(@omnis/protocol)
- Produces: `CODEX_PINNED_VERSION = "rust-v0.155.1"`, `CODEX_CAPABILITIES`, `probeCodexVersion(versionLine: string, pinned?: string): { version: string; state: RuntimeState; capabilities: RuntimeCapabilities }`

**읽을 것:** A2-D6, §4.2 "버전 드리프트 대응". **만들지 말 것:** 자동 업그레이드·핀 해제. 핀 해제는 계약 테스트 전량 통과 시에만 사람이 한다.

1. - [ ] 실패 테스트를 쓴다: `apps/local-agent/test/codex-probe.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { CODEX_PINNED_VERSION, probeCodexVersion } from "../src/bridges/codex-probe.js";

describe("probeCodexVersion (A2-D6)", () => {
  it("pins rust-v0.155.1", () => {
    expect(CODEX_PINNED_VERSION).toBe("rust-v0.155.1");
  });

  it("stays online on an exact pin match", () => {
    const r = probeCodexVersion("codex-cli rust-v0.155.1");
    expect(r.state).toBe("online");
    expect(r.capabilities.features).not.toContain("version_mismatch");
  });

  it("degrades and flags a drifted version instead of refusing to start", () => {
    const r = probeCodexVersion("codex-cli rust-v0.156.0-alpha.3");
    expect(r.state).toBe("degraded");
    expect(r.capabilities.features).toContain("version_mismatch");
    expect(r.version).toBe("codex rust-v0.156.0-alpha.3");
  });

  it("reports the capabilities A2 §4.2 verified for app-server", () => {
    const c = probeCodexVersion("codex-cli rust-v0.155.1").capabilities;
    expect(c.reasoning_stream).toBe(true);
    expect(c.approvals).toBe("native");
    expect(c.tool_calls).toBe(true);
  });
});
```

2. - [ ] 실행해 실패를 확인한다: `pnpm --filter @omnis/local-agent test`
   기대 실패: `Failed to resolve import "../src/bridges/codex-probe.js"`

3. - [ ] `apps/local-agent/src/bridges/codex-probe.ts`를 만든다:

```ts
import type { RuntimeCapabilities, RuntimeState } from "@omnis/protocol";

/** A2-D6. 핀 해제는 계약 테스트 전량 통과 시에만, 사람이 한다. */
export const CODEX_PINNED_VERSION = "rust-v0.155.1";

export const CODEX_CAPABILITIES: RuntimeCapabilities = {
  resume: true,
  cross_project_resume: true,
  stream_deltas: true,
  reasoning_stream: true,
  tool_calls: true,
  approvals: "native",
  cancel: true,
  models: [],
  features: [],
};

export function probeCodexVersion(
  versionLine: string,
  pinned: string = CODEX_PINNED_VERSION,
): { version: string; state: RuntimeState; capabilities: RuntimeCapabilities } {
  const found = /rust-v[0-9][^\s]*/.exec(versionLine)?.[0] ?? "unknown";
  const drifted = found !== pinned;
  return {
    version: `codex ${found}`,
    state: drifted ? "degraded" : "online",
    // 세션은 계속 뜨지만 허브가 위임 대상 후보에서 뺄 수 있게 플래그만 싣는다.
    capabilities: drifted ? { ...CODEX_CAPABILITIES, features: ["version_mismatch"] } : CODEX_CAPABILITIES,
  };
}
```

4. - [ ] 테스트를 돌린다: `pnpm --filter @omnis/local-agent test` → 4 passed

5. - [ ] 커밋한다:

```bash
git -C omnis/.worktrees/US-A19 add apps/local-agent/src/bridges/codex-probe.ts apps/local-agent/test/codex-probe.test.ts
git -C omnis/.worktrees/US-A19 commit -m "US-A19: Codex 버전 핀(rust-v0.155.1)과 드리프트 강등

- 핀 불일치는 기동 거부가 아니라 degraded + features=['version_mismatch']

Co-Authored-By: Claude Opus <noreply@anthropic.com>"
```

---

## US-A19b — 미니 호스트 기동과 동시성 캡 (Task 16~18)

> **목표**(A7 §7): 맥미니 호스트에서 `local-agent` 기동(Codex 브리지만 노출, Hermes는 Phase B) + host별 동시성 캡 4 적용(맥미니/맥북 각각)
> **산출물**: `apps/local-agent/src/host-config.ts`(host=`mini`/`macbook` 분기), LaunchAgent plist(A6-D10 방식)
> **검증 명령**: `pnpm --filter @omnis/local-agent test`
> **티어**: Sonnet · **의존**: US-A17, US-A19

### Task 16: 호스트 프로파일 (US-A19b, tier: Sonnet)

**Files:**
- Create: `apps/local-agent/src/host-config.ts`
- Test: `apps/local-agent/test/host-config.test.ts`

**Interfaces:**
- Consumes: Task 6의 `HOST_DEFAULTS`, `HostId`/`RuntimeKind`(@omnis/protocol)
- Produces: `PHASE_A_RUNTIMES`, `HostProfile`, `HOST_PROFILES`, `hostProfile(host: HostId): HostProfile`, `phaseARuntimesFor(host: HostId): RuntimeKind[]`

**읽을 것:** 계약 §8(호스트 설정), 마스터 §4.2, A6 §10.2. **만들지 말 것:** 호스트를 3개 이상으로 일반화하지 않는다 — `HostId`는 `mini`/`macbook` 둘뿐이고 세 번째가 생기면 그때 늘린다.

1. - [ ] 실패 테스트를 쓴다: `apps/local-agent/test/host-config.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { hostProfile, phaseARuntimesFor } from "../src/host-config.js";

/** 검증 명령: `pnpm --filter @omnis/local-agent test`. 두 호스트를 한 번에 단언하므로 호스트 플래그가 없다. */
const HOSTS = ["mini", "macbook"] as const;

describe("host profile", () => {
  it("caps active turns at 4 on both hosts (마스터 §9)", () => {
    expect(hostProfile("mini").maxActiveTurns).toBe(4);
    expect(hostProfile("macbook").maxActiveTurns).toBe(4);
  });

  it("points the mini at loopback and the macbook at the tailnet bridge", () => {
    expect(hostProfile("mini").hub_url).toBe("ws://127.0.0.1:8787/bridge");
    expect(hostProfile("macbook").hub_url.startsWith("wss://")).toBe(true);
    expect(hostProfile("macbook").hub_url.endsWith("/api/bridge")).toBe(true);
  });

  it("uses the per-host bridge token item name (A2 §2.1)", () => {
    for (const host of HOSTS) {
      expect(hostProfile(host).token_keychain_item).toBe(`omnis.bridge.token.${host}`);
    }
  });

  it("exposes only Codex on the mini in Phase A (Hermes is Phase B)", () => {
    expect(phaseARuntimesFor("mini")).toEqual(["codex"]);
    expect(hostProfile("mini").exposedRuntimes).toEqual(["codex", "hermes"]);
  });

  it("exposes the three process runtimes on the macbook in Phase A", () => {
    expect(phaseARuntimesFor("macbook")).toEqual(["claude_code", "codex", "claude_ds"]);
  });
});
```

2. - [ ] 실행해 실패를 확인한다: `pnpm --filter @omnis/local-agent test`
   기대 실패: `Failed to resolve import "../src/host-config.js"`

3. - [ ] `apps/local-agent/src/host-config.ts`를 만든다:

```ts
import type { HostId, RuntimeKind } from "@omnis/protocol";
import { HOST_DEFAULTS } from "./config.js";

/** Phase A에 어댑터가 존재하는 런타임. hermes(Phase B)와 omnis(어댑터 없음)는 빠진다. */
export const PHASE_A_RUNTIMES: readonly RuntimeKind[] = ["claude_code", "codex", "claude_ds"];

export interface HostProfile {
  host: HostId;
  hub_url: string;
  token_keychain_item: string;
  exposedRuntimes: RuntimeKind[];
  maxActiveTurns: number;
}

export const HOST_PROFILES: Record<HostId, HostProfile> = {
  mini: {
    host: "mini",
    ...HOST_DEFAULTS.mini,
    exposedRuntimes: ["codex", "hermes"],
    maxActiveTurns: 4,
  },
  macbook: {
    host: "macbook",
    ...HOST_DEFAULTS.macbook,
    exposedRuntimes: ["claude_code", "codex", "claude_ds", "hermes"],
    maxActiveTurns: 4,
  },
};

export function hostProfile(host: HostId): HostProfile { return HOST_PROFILES[host]; }

/** 이 호스트가 Phase A에 실제로 등록하는 런타임. */
export function phaseARuntimesFor(host: HostId): RuntimeKind[] {
  return HOST_PROFILES[host].exposedRuntimes.filter((r) => PHASE_A_RUNTIMES.includes(r));
}
```

4. - [ ] 테스트를 돌린다: `pnpm --filter @omnis/local-agent test` → 5 passed

5. - [ ] 커밋한다:

```bash
git -C omnis/.worktrees/US-A19b add apps/local-agent/src/host-config.ts apps/local-agent/test/host-config.test.ts
git -C omnis/.worktrees/US-A19b commit -m "US-A19b: 호스트 프로파일(mini/macbook) + Phase A 런타임 필터

- mini는 루프백 hub_url, macbook은 tailnet /api/bridge
- 동시 활성 턴 캡 4, Phase A 노출은 codex(+맥북의 claude_code/claude_ds)

Co-Authored-By: Claude Sonnet <noreply@anthropic.com>"
```

### Task 17: 호스트당 활성 턴 4개 상한 (US-A19b, tier: Sonnet)

**Files:**
- Create: `apps/local-agent/src/turn-cap.ts`
- Modify: `apps/local-agent/src/rpc-dispatch.ts`
- Test: `apps/local-agent/test/turn-cap.test.ts`

**Interfaces:**
- Consumes: `BRIDGE_ERRORS`/`BridgeError`(@omnis/protocol), Task 16의 `hostProfile`
- Produces: `TurnCap`(생성자 `{ max?, queueMax? }`, 메서드 `acquire`/`release`/`active`/`queued`), `DispatchDeps.turnCap?: TurnCap`

**읽을 것:** A2 §7.2 "동시성". **만들지 말 것:** 프로세스 수를 세지 않는다 — 세는 단위는 턴이다. 런타임별 세분 상한도 만들지 않는다.

1. - [ ] 실패 테스트를 쓴다: `apps/local-agent/test/turn-cap.test.ts`

```ts
import { BridgeError } from "@omnis/protocol";
import { describe, expect, it } from "vitest";
import { TurnCap } from "../src/turn-cap.js";

describe("TurnCap (A2 §7.2)", () => {
  it("runs the first four turns and queues the fifth", () => {
    const cap = new TurnCap({ max: 4 });
    for (let i = 0; i < 4; i++) expect(cap.acquire(`t${i}`)).toBe("run");
    expect(cap.acquire("t4")).toBe("queued");
    expect(cap.active()).toBe(4);
    expect(cap.queued()).toBe(1);
  });

  it("promotes the head of the queue when a turn finishes, whatever the outcome", () => {
    const cap = new TurnCap({ max: 1 });
    cap.acquire("a");
    cap.acquire("b");
    expect(cap.release("a")).toBe("b");
    expect(cap.active()).toBe(1);
  });

  it("throws -32004 once the queue passes 8", () => {
    const cap = new TurnCap({ max: 4, queueMax: 8 });
    for (let i = 0; i < 12; i++) cap.acquire(`t${i}`);
    try {
      cap.acquire("overflow");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as BridgeError).code).toBe(-32004);
    }
  });

  it("ignores a release for an unknown turn id", () => {
    const cap = new TurnCap({ max: 4 });
    expect(cap.release("never-started")).toBeUndefined();
  });
});
```

2. - [ ] 실행해 실패를 확인한다: `pnpm --filter @omnis/local-agent test`
   기대 실패: `Failed to resolve import "../src/turn-cap.js"`

3. - [ ] `apps/local-agent/src/turn-cap.ts`를 만든다:

```ts
import { BRIDGE_ERRORS, BridgeError } from "@omnis/protocol";

/** A2 §7.2: 호스트당 활성 "턴" 4개. 프로세스 수가 아니다. 초과는 큐잉(최대 8), 넘치면 -32004. */
export class TurnCap {
  readonly #max: number;
  readonly #queueMax: number;
  readonly #active = new Set<string>();
  #queue: string[] = [];

  constructor(opts: { max?: number; queueMax?: number } = {}) {
    this.#max = opts.max ?? 4;
    this.#queueMax = opts.queueMax ?? 8;
  }

  acquire(turnId: string): "run" | "queued" {
    if (this.#active.size < this.#max) { this.#active.add(turnId); return "run"; }
    if (this.#queue.length >= this.#queueMax) {
      throw new BridgeError(BRIDGE_ERRORS.TURN_ALREADY_ACTIVE, `turn queue full (${this.#queueMax}) on this host`);
    }
    this.#queue.push(turnId);
    return "queued";
  }

  /** 성공·실패·취소 모두에서 호출된다. 다음 대기 턴 id를 돌려준다. */
  release(turnId: string): string | undefined {
    if (!this.#active.delete(turnId)) {
      this.#queue = this.#queue.filter((t) => t !== turnId);
      return undefined;
    }
    const next = this.#queue.shift();
    if (next !== undefined) this.#active.add(next);
    return next;
  }

  active(): number { return this.#active.size; }
  queued(): number { return this.#queue.length; }
}
```

4. - [ ] `rpc-dispatch.ts`를 고쳐 `turn.start`/`turn.cancel`이 캡을 지나게 한다:
   - `DispatchDeps`에 `turnCap?: TurnCap;`을 더한다.
   - `case "turn.start"`의 `deps.beforeTurn?.(turnId);` 줄 앞에 `deps.turnCap?.acquire(turnId);`를 넣는다.
   - `case "turn.cancel"`의 `deps.afterTurn?.(p.turn_id);` 줄 앞에 `deps.turnCap?.release(p.turn_id);`를 넣는다.
   - `main.ts`의 `createDispatcher({...})` 호출에 `turnCap: new TurnCap({ max: hostProfile(config.host).maxActiveTurns })`를 더한다.

5. - [ ] 테스트를 돌린다: `pnpm --filter @omnis/local-agent test` → 4 passed (turn-cap) + 기존 전부 green

6. - [ ] 커밋한다:

```bash
git -C omnis/.worktrees/US-A19b add apps/local-agent/src/turn-cap.ts apps/local-agent/src/rpc-dispatch.ts apps/local-agent/src/main.ts apps/local-agent/test/turn-cap.test.ts
git -C omnis/.worktrees/US-A19b commit -m "US-A19b: 호스트당 활성 턴 4개 상한 + 큐 8

- 세는 단위는 프로세스가 아니라 턴(A2 §7.2)
- 큐 초과는 -32004, release는 성공·실패·취소 모두에서 호출

Co-Authored-By: Claude Sonnet <noreply@anthropic.com>"
```

### Task 18: 미니 LaunchAgent plist와 설치 스크립트 (US-A19b, tier: Sonnet)

**Files:**
- Create: `apps/local-agent/launchagent/ai.onwordlab.omnis-local-agent.mini.plist`, `apps/local-agent/launchagent/ai.onwordlab.omnis-local-agent.macbook.plist`, `scripts/install-local-agent.sh`
- Test: `apps/local-agent/test/launchagent.test.ts`

**Interfaces:**
- Consumes: Task 6의 `normalizeHubUrl`, Task 16의 `hostProfile`/`phaseARuntimesFor`
- Produces: 없음(자산 + 테스트)

**읽을 것:** A6 §10.1·§10.2(plist 두 개 + 설치 스크립트 3단계), A6-D10(root LaunchDaemon이 아니라 로그인 세션 LaunchAgent). **만들지 말 것:** LaunchDaemon 변형. healthchecks.io ping 로직(A6 §8 소유). plist 파서 라이브러리 — `ProgramArguments`의 `<string>`만 뽑으면 충분하다.

1. - [ ] 실패 테스트를 쓴다: `apps/local-agent/test/launchagent.test.ts`

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeHubUrl } from "../src/config.js";
import { hostProfile, phaseARuntimesFor } from "../src/host-config.js";

const plist = (host: "mini" | "macbook"): string[] => {
  const xml = readFileSync(join(__dirname, "..", "launchagent", `ai.onwordlab.omnis-local-agent.${host}.plist`), "utf8");
  const block = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(xml)?.[1] ?? "";
  return [...block.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1] as string);
};
const flagValue = (args: string[], name: string): string | undefined => args[args.indexOf(name) + 1];

describe("LaunchAgent plists (A6 §10)", () => {
  it("passes a --hub that normalises to this host's bridge URL", () => {
    for (const host of ["mini", "macbook"] as const) {
      const hub = flagValue(plist(host), "--hub");
      expect(hub).toBeDefined();
      expect(normalizeHubUrl(hub as string)).toBe(hostProfile(host).hub_url);
    }
  });

  it("restricts the mini to the runtimes Phase A actually implements", () => {
    const runtimes = (flagValue(plist("mini"), "--runtimes") ?? "").split(",");
    expect(runtimes).toContain("codex");
    expect(phaseARuntimesFor("mini").every((r) => runtimes.includes(r))).toBe(true);
  });

  it("boots at login and stays alive", () => {
    const xml = readFileSync(join(__dirname, "..", "launchagent", "ai.onwordlab.omnis-local-agent.mini.plist"), "utf8");
    expect(xml).toContain("<key>RunAtLoad</key><true/>");
    expect(xml).toContain("<key>KeepAlive</key><true/>");
    expect(xml).not.toContain("LaunchDaemons");
  });
});
```

2. - [ ] 실행해 실패를 확인한다: `pnpm --filter @omnis/local-agent test`
   기대 실패: `ENOENT: no such file or directory, open '.../launchagent/ai.onwordlab.omnis-local-agent.mini.plist'`

3. - [ ] `apps/local-agent/launchagent/ai.onwordlab.omnis-local-agent.mini.plist`를 만든다:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>ai.onwordlab.omnis-local-agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/omnis-run-with-secrets.sh</string>
    <string>mini</string>
    <string>/usr/local/bin/node</string>
    <string>/opt/omnis/local-agent/dist/main.js</string>
    <string>--host</string>
    <string>mini</string>
    <string>--hub</string>
    <string>http://127.0.0.1:8787</string>
    <string>--runtimes</string>
    <string>codex</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/logankim/Library/Logs/omnis/local-agent-mini.log</string>
  <key>StandardErrorPath</key><string>/Users/logankim/Library/Logs/omnis/local-agent-mini.err.log</string>
</dict>
</plist>
```

4. - [ ] `apps/local-agent/launchagent/ai.onwordlab.omnis-local-agent.macbook.plist`를 만든다:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>ai.onwordlab.omnis-local-agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/omnis-run-with-secrets.sh</string>
    <string>macbook</string>
    <string>/usr/local/bin/node</string>
    <string>/opt/omnis/local-agent/dist/main.js</string>
    <string>--host</string>
    <string>macbook</string>
    <string>--hub</string>
    <string>https://omnis-hub.your-tailnet.ts.net/api</string>
    <string>--runtimes</string>
    <string>claude_code,codex,claude_ds</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/logankim/Library/Logs/omnis/local-agent.log</string>
  <key>StandardErrorPath</key><string>/Users/logankim/Library/Logs/omnis/local-agent.err.log</string>
</dict>
</plist>
```

5. - [ ] `scripts/install-local-agent.sh`를 만든다:

```bash
#!/usr/bin/env bash
# A6 §10: plist 복사 → launchctl bootstrap → 기동 확인. 사용법: scripts/install-local-agent.sh mini|macbook
set -euo pipefail

HOST="${1:?usage: install-local-agent.sh <mini|macbook>}"
LABEL="ai.onwordlab.omnis-local-agent"
SRC="$(cd "$(dirname "$0")/.." && pwd)/apps/local-agent/launchagent/${LABEL}.${HOST}.plist"
DEST="${HOME}/Library/LaunchAgents/${LABEL}.plist"

[ -f "$SRC" ] || { echo "no plist for host: ${HOST}" >&2; exit 1; }
mkdir -p "${HOME}/Library/LaunchAgents" "${HOME}/Library/Logs/omnis"
cp "$SRC" "$DEST"

launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$DEST"
launchctl kickstart -k "gui/$(id -u)/${LABEL}"

sleep 2
launchctl print "gui/$(id -u)/${LABEL}" | grep -E '^\s+state = ' || { echo "local-agent did not start" >&2; exit 1; }
echo "installed ${LABEL} for host=${HOST}"
```

6. - [ ] 실행 권한을 주고 테스트를 돌린다: `chmod +x scripts/install-local-agent.sh && pnpm --filter @omnis/local-agent test` → 3 passed (launchagent)

7. - [ ] 커밋한다:

```bash
git -C omnis/.worktrees/US-A19b add apps/local-agent/launchagent scripts/install-local-agent.sh apps/local-agent/test/launchagent.test.ts
git -C omnis/.worktrees/US-A19b commit -m "US-A19b: 미니·맥북 LaunchAgent plist + 설치 스크립트

- A6-D10: root LaunchDaemon이 아니라 로그인 세션 LaunchAgent
- plist의 --hub가 host-config의 hub_url로 정규화되는지 테스트로 고정

Co-Authored-By: Claude Sonnet <noreply@anthropic.com>"
```

---

## US-A20 — mock 런타임 계약 테스트 (Task 19~20)

> **목표**(A7 §7): 브리지 mock 런타임 테스트(실 CLI 없이 stream-json/JSON-RPC 목업)
> **산출물**: `apps/local-agent/test/bridge-mock.test.ts`
> **검증 명령**: `pnpm --filter @omnis/local-agent test`
> **티어**: Sonnet · **의존**: US-A18, US-A19

### Task 19: fixture와 mock 런타임 프로세스 (US-A20, tier: Sonnet)

**Files:**
- Create: `apps/local-agent/test/fixtures/claude_code/tool_call_turn.ndjson`, `apps/local-agent/test/fixtures/claude_code/unknown_item_turn.ndjson`, `apps/local-agent/test/fixtures/codex/tool_call_turn.ndjson`, `apps/local-agent/test/mock-runtime.mjs`, `apps/local-agent/test/mock-runtime.ts`
- Test: `apps/local-agent/test/mock-runtime.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `mockSpawn(fixture: string): typeof spawn`(실제 자식 프로세스를 띄우는 spawn 대체), `FIXTURES`

**읽을 것:** A2-D14, §8.1(fixture 세트), §8.2(mock 런타임). **만들지 말 것:** CI에서 실 런타임을 호출하지 않는다 — `27` 실측 중 Codex 계정 한도로 턴이 끊겼다. 캡처 타이밍 재생(상대 시각 sleep)은 Phase A에 필요 없다.

1. - [ ] 실패 테스트를 쓴다: `apps/local-agent/test/mock-runtime.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { FIXTURES, mockSpawn } from "./mock-runtime.js";

describe("mock runtime process", () => {
  it("replays a claude stream-json fixture over real stdio", async () => {
    const child = mockSpawn(FIXTURES.claudeToolCall)("claude", ["-p"], { stdio: ["ignore", "pipe", "pipe"] });
    const lines: string[] = [];
    child.stdout?.on("data", (d: Buffer) => lines.push(...d.toString("utf8").split("\n").filter((l) => l.length > 0)));
    await new Promise((r) => child.on("close", r));
    expect(lines.length).toBeGreaterThanOrEqual(6);
    expect(JSON.parse(lines[0] as string).type).toBe("system");
    expect(JSON.parse(lines[lines.length - 1] as string).type).toBe("result");
  });

  it("replays a codex app-server fixture as JSON-RPC notifications", async () => {
    const child = mockSpawn(FIXTURES.codexToolCall)("codex", ["app-server"], { stdio: ["pipe", "pipe", "pipe"] });
    const lines: string[] = [];
    child.stdout?.on("data", (d: Buffer) => lines.push(...d.toString("utf8").split("\n").filter((l) => l.length > 0)));
    await new Promise((r) => child.on("close", r));
    expect(JSON.parse(lines[0] as string).method).toBe("thread.started");
  });
});
```

2. - [ ] 실행해 실패를 확인한다: `pnpm --filter @omnis/local-agent test`
   기대 실패: `Failed to resolve import "./mock-runtime.js"`

3. - [ ] `apps/local-agent/test/fixtures/claude_code/tool_call_turn.ndjson`을 만든다(한 줄 = 한 이벤트):

```
{"type":"system","subtype":"init","session_id":"s-mock-1","capabilities":["interrupt_receipt_v1"],"tools":["Bash","Read"],"cwd":"/Users/u/dev/omnis"}
{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}}
{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Listing "}}}
{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"src/."}}}
{"type":"assistant","message":{"content":[{"type":"text","text":"Listing src/."}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tu_1","name":"Bash","input":{"command":"ls src"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tu_1","is_error":false,"content":"index.ts\nmain.ts"}]}}
{"type":"result","subtype":"success","total_cost_usd":0.0121,"duration_ms":4210,"num_turns":1}
```

4. - [ ] `apps/local-agent/test/fixtures/claude_code/unknown_item_turn.ndjson`을 만든다:

```
{"type":"system","subtype":"init","session_id":"s-mock-2","capabilities":[],"tools":[]}
{"type":"some_future_event","payload":{"shape":"unknown"}}
{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}}
{"type":"assistant","message":{"content":[{"type":"text","text":"ok"}]}}
{"type":"result","subtype":"success","total_cost_usd":0.0009,"duration_ms":800,"num_turns":1}
```

5. - [ ] `apps/local-agent/test/fixtures/codex/tool_call_turn.ndjson`을 만든다:

```
{"jsonrpc":"2.0","method":"thread.started","params":{"threadId":"th_mock_1"}}
{"jsonrpc":"2.0","method":"turn.started","params":{"turnId":"turn_1"}}
{"jsonrpc":"2.0","method":"item/started","params":{"item":{"id":"i1","type":"agentMessage"}}}
{"jsonrpc":"2.0","method":"item/reasoning/textDelta","params":{"itemId":"r1","delta":"considering"}}
{"jsonrpc":"2.0","method":"item/agentMessage/delta","params":{"itemId":"i1","delta":"Running "}}
{"jsonrpc":"2.0","method":"item/completed","params":{"item":{"id":"i1","type":"agentMessage","text":"Running tests."}}}
{"jsonrpc":"2.0","method":"item/started","params":{"item":{"id":"i2","type":"quantumToolCall"}}}
{"jsonrpc":"2.0","method":"item/completed","params":{"item":{"id":"i2","type":"quantumToolCall","output":"done"}}}
{"jsonrpc":"2.0","method":"turn.completed","params":{"durationMs":3300}}
```

6. - [ ] `apps/local-agent/test/mock-runtime.mjs`를 만든다:

```js
#!/usr/bin/env node
// A2-D14: fixture NDJSON을 실제 stdio로 재생한다. 실 CLI는 CI에서 부르지 않는다.
import { readFileSync } from "node:fs";

const fixture = process.env.OMNIS_MOCK_FIXTURE;
if (typeof fixture !== "string") { process.stderr.write("OMNIS_MOCK_FIXTURE is required\n"); process.exit(2); }

for (const line of readFileSync(fixture, "utf8").split("\n")) {
  if (line.trim().length > 0) process.stdout.write(`${line}\n`);
}
process.stdout.end();
```

7. - [ ] `apps/local-agent/test/mock-runtime.ts`를 만든다:

```ts
import { type SpawnOptions, spawn } from "node:child_process";
import { join } from "node:path";

const here = new URL(".", import.meta.url).pathname;

export const FIXTURES = {
  claudeToolCall: join(here, "fixtures", "claude_code", "tool_call_turn.ndjson"),
  claudeUnknownItem: join(here, "fixtures", "claude_code", "unknown_item_turn.ndjson"),
  codexToolCall: join(here, "fixtures", "codex", "tool_call_turn.ndjson"),
} as const;

/** RuntimeAdapter가 stdio를 읽는 코드 경로를 그대로 타게 한다(A2 §8.2). */
export function mockSpawn(fixture: string): typeof spawn {
  return ((_cmd: string, _args: readonly string[], opts?: SpawnOptions) =>
    spawn(process.execPath, [join(here, "mock-runtime.mjs")], {
      ...opts,
      env: { ...process.env, OMNIS_MOCK_FIXTURE: fixture },
    })) as typeof spawn;
}
```

8. - [ ] 테스트를 돌린다: `pnpm --filter @omnis/local-agent test` → 2 passed (mock-runtime)

9. - [ ] 커밋한다:

```bash
git -C omnis/.worktrees/US-A20 add apps/local-agent/test/fixtures apps/local-agent/test/mock-runtime.mjs apps/local-agent/test/mock-runtime.ts apps/local-agent/test/mock-runtime.test.ts
git -C omnis/.worktrees/US-A20 commit -m "US-A20: mock 런타임 프로세스 + stream-json/app-server fixture

- A2-D14: 실 CLI를 CI에서 호출하지 않는다
- 어댑터가 실제 stdio를 읽는 경로를 그대로 탄다

Co-Authored-By: Claude Sonnet <noreply@anthropic.com>"
```

### Task 20: 브리지 계약 불변식 8개 (US-A20, tier: Sonnet)

**Files:**
- Create: `apps/local-agent/test/bridge-mock.test.ts`
- Test: 같은 파일

**Interfaces:**
- Consumes: Task 12 `ClaudeCodeAdapter`, Task 14 `CodexAdapter`/`mapAppServerEvent`, Task 9 `Outbox`, Task 10 `createDispatcher`/`EventSink`, Task 19 `mockSpawn`/`FIXTURES`
- Produces: 없음(검증 전용)

**읽을 것:** A2 §8.2의 불변식 1~8. **만들지 말 것:** 실 Postgres 통합(그건 US-A21 이후 커널 쪽 스토리다). 타이밍 재생 기반 flaky 단언.

1. - [ ] 계약 테스트를 쓴다: `apps/local-agent/test/bridge-mock.test.ts`

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withMeta } from "@omnis/protocol";
import { describe, expect, it, vi } from "vitest";
import { ClaudeCodeAdapter } from "../src/bridges/claude-code.js";
import { mapAppServerEvent } from "../src/bridges/codex.js";
import { Outbox } from "../src/outbox.js";
import { createDispatcher, type EventSink } from "../src/rpc-dispatch.js";
import { SessionRegistry } from "../src/session-registry.js";
import { createLogger } from "../src/logger.js";
import { FIXTURES, mockSpawn } from "./mock-runtime.js";

interface Captured { durable: Record<string, unknown>[]; deltas: Record<string, unknown>[]; raw: string[] }

function capture(): { sink: EventSink; out: Captured } {
  const out: Captured = { durable: [], deltas: [], raw: [] };
  return {
    out,
    sink: {
      itemStarted: (e) => out.durable.push({ ...e, _m: "started" }),
      delta: (e) => out.deltas.push(e),
      itemCompleted: (e) => out.durable.push({ ...e, _m: "completed" }),
      turnCompleted: (e) => out.durable.push({ ...e, _m: "turn.completed" }),
      approval: async () => ({ decision: "accept" as const }),
      raw: (l) => out.raw.push(l),
    },
  };
}

const session = {
  session_key: "agent:claude_code:macbook:inbox-draft", session_id: null, runtime: "claude_code" as const,
  runtime_id: "9c2d1f4b-2e6a-4d1f-8b0c-1a2b3c4d5e6f", cwd: process.cwd(), purpose: "inbox:draft",
  origin: "job" as const, permission_profile: "observe" as const, state: "idle" as const,
  opened_at: "2026-09-20T00:00:00.000Z", last_turn_at: null,
};

async function runClaudeFixture(fixture: string): Promise<Captured> {
  const { sink, out } = capture();
  const adapter = new ClaudeCodeAdapter({ kind: "claude_code", binary: "claude", defaultModel: "sonnet", spawnFn: mockSpawn(fixture) });
  await adapter.startTurn(session, { text: "go" }, sink);
  await vi.waitFor(() => expect(out.durable.some((d) => d._m === "turn.completed")).toBe(true), { timeout: 4000 });
  return out;
}

describe("bridge contract invariants (A2 §8.2)", () => {
  it("1. every started item is closed by a completed item of the same id", async () => {
    const out = await runClaudeFixture(FIXTURES.claudeToolCall);
    const started = out.durable.filter((d) => d._m === "started" && d.item_id !== undefined).map((d) => d.item_id);
    const completed = new Set(out.durable.filter((d) => d._m === "completed").map((d) => d.item_id));
    for (const id of started) expect(completed.has(id)).toBe(true);
  });

  it("2. not a single delta reaches the durable sink", async () => {
    const out = await runClaudeFixture(FIXTURES.claudeToolCall);
    expect(out.deltas.length).toBeGreaterThan(0);
    expect(out.durable.some((d) => typeof d.seq === "number")).toBe(false);
  });

  it("3. durable writes stay under item count x 2 (A2-D4 regression guard)", async () => {
    const out = await runClaudeFixture(FIXTURES.claudeToolCall);
    const items = new Set(out.durable.filter((d) => d.item_id !== undefined).map((d) => d.item_id)).size;
    expect(out.durable.filter((d) => d.item_id !== undefined).length).toBeLessThanOrEqual(items * 2);
  });

  it("4. an unknown event type never kills the parser and lands in cold only", async () => {
    const out = await runClaudeFixture(FIXTURES.claudeUnknownItem);
    expect(out.raw.some((l) => l.includes("some_future_event"))).toBe(true);
    expect(out.durable.some((d) => JSON.stringify(d).includes("some_future_event"))).toBe(false);
  });

  it("5. an approval request is answered before the runtime hears anything", async () => {
    const { sink } = capture();
    const order: string[] = [];
    const wrapped: EventSink = { ...sink, approval: async (i) => { order.push(`asked:${i.action}`); const r = { decision: "accept" as const }; order.push("answered"); return r; } };
    const res = await wrapped.approval({ action: "send", args: {}, description: "reply to Kim",
      config: { allow_accept: true, allow_edit: true, allow_respond: false, allow_ignore: true }, risk: "normal" });
    expect(order).toEqual(["asked:send", "answered"]);
    expect(res.decision).toBe("accept");
  });

  it("6. a cwd outside allowed_roots never spawns a process", async () => {
    const spawnFn = vi.fn(mockSpawn(FIXTURES.claudeToolCall));
    const dispatch = createDispatcher({
      registry: new SessionRegistry(),
      adapters: new Map([["claude_code", new ClaudeCodeAdapter({ kind: "claude_code", binary: "claude", defaultModel: "sonnet", spawnFn: spawnFn as never })]]),
      allowedRoots: new Map([["claude_code", [process.cwd()]]]),
      runtimeIds: new Map([["claude_code", "9c2d1f4b-2e6a-4d1f-8b0c-1a2b3c4d5e6f"]]),
      logger: createLogger("@omnis/local-agent", { sink: () => {} }),
      host: "macbook",
    });
    await expect(dispatch("session.create", withMeta({
      session_key: "agent:claude_code:macbook:escape", runtime: "claude_code", cwd: "/etc",
      purpose: "proj:escape", origin: "human", permission_profile: "trusted",
    }))).rejects.toMatchObject({ code: -32005 });
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it("7. an outbox flush produces no duplicate item_id", async () => {
    const o = new Outbox({ path: join(mkdtempSync(join(tmpdir(), "omnis-ob-")), "outbox.ndjson") });
    o.append({ method: "turn.item.started", params: { item_id: "i1" } });
    o.append({ method: "turn.item.completed", params: { item_id: "i1" } });
    const sent: string[] = [];
    await o.drain(async (e) => { sent.push(`${e.method}:${String(e.params.item_id)}`); });
    await o.drain(async (e) => { sent.push(`${e.method}:${String(e.params.item_id)}`); });
    expect(sent).toEqual(["turn.item.started:i1", "turn.item.completed:i1"]);
  });

  it("8. reassembled deltas match the completed body", async () => {
    const out = await runClaudeFixture(FIXTURES.claudeToolCall);
    const firstItem = String(out.deltas[0]?.item_id ?? "");
    const joined = out.deltas.filter((d) => d.item_id === firstItem).map((d) => String(d.text)).join("");
    const completed = out.durable.find((d) => d._m === "completed" && d.item_id === firstItem);
    expect(String(completed?.body ?? "")).toBe(joined);
  });

  it("codex: reasoning deltas never become durable items", () => {
    const ctx = { session_key: "agent:codex:mini:proj-omnis", turn_id: "t1", seq: new Map<string, number>() };
    const emits = mapAppServerEvent("item/reasoning/textDelta", { itemId: "r1", delta: "hmm" }, ctx);
    expect(emits.every((e) => e.method === "turn.item.delta")).toBe(true);
  });
});
```

2. - [ ] 실행해 실패를 확인한다: `pnpm --filter @omnis/local-agent test`
   기대 실패: 불변식 8이 먼저 깨진다 — `expected 'Listing src/.' to be 'Listing src/.'`가 아니라 델타 재조립이 `assistant` 본문과 어긋나면 `AssertionError: expected '' to be 'Listing src/.'`

3. - [ ] 불변식 위반이 나오면 **테스트가 아니라 파서를 고친다**. 빈번한 두 원인:
   - `mapStreamJsonEvent`의 `content_block_delta` 분기가 `openText` 인덱스와 다른 `item_id`를 쓰고 있다 → 양쪽 다 `blk-${index}`를 쓰게 맞춘다.
   - `createDurableDebouncer`가 `turn.completed` 앞에서 flush하지 않아 마지막 `completed`가 누락된다 → `push`의 기본 분기가 `flush()`를 먼저 부르는지 확인한다.

4. - [ ] 전체 검증을 돌린다: `pnpm --filter @omnis/local-agent test` → 9 passed, `pnpm lint` → exit 0, `pnpm typecheck` → exit 0

5. - [ ] 커밋한다:

```bash
git -C omnis/.worktrees/US-A20 add apps/local-agent/test/bridge-mock.test.ts
git -C omnis/.worktrees/US-A20 commit -m "US-A20: 브리지 계약 불변식 8개 + Codex reasoning ephemeral 회귀 가드

- A2 §8.2 불변식 전량: item 짝, 델타 0 durable, write <= item x 2,
  미지 이벤트 cold 전용, 승인 왕복, spawn 0회, outbox 멱등, 델타 재조립 일치

Co-Authored-By: Claude Sonnet <noreply@anthropic.com>"
```

---

## 스토리 종료 체크리스트

각 스토리는 ralph Step 7 리뷰어에게 넘기기 전에 아래를 스스로 통과해야 한다.

| 스토리 | 검증 명령 | 충족 조건 |
|---|---|---|
| US-A16 | `pnpm --filter @omnis/protocol test` | bridge 4개 테스트 파일 green, `pnpm typecheck` exit 0 |
| US-A17 | `pnpm --filter @omnis/local-agent test` | config 우선순위 8건 + 레지스트리 6건 + WS 5건 + outbox 3건 + 디스패처 6건 |
| US-A18 | `pnpm --filter @omnis/local-agent test` | stream-json 8건 + claude-code 10건, durable에 델타 0건 |
| US-A19 | `pnpm --filter @omnis/local-agent test` | app-server 3건 + codex 8건 + probe 4건 |
| US-A19b | `pnpm --filter @omnis/local-agent test` | host-config 5건 + turn-cap 4건 + plist 3건 |
| US-A20 | `pnpm --filter @omnis/local-agent test` | 불변식 8개 전부 green, 실 CLI 호출 0회 |

## 자기 점검 결과 (계획 작성자)

- 스토리 → 태스크 매핑: US-A16 → Task 1~4, US-A17 → Task 5~10, US-A18 → Task 11~12, US-A19 → Task 13~15, US-A19b → Task 16~18, US-A20 → Task 19~20. 빠진 스토리 없음.
- 금지 패턴(`TBD`, `TODO`, `implement later`, `similar to Task N`, `handle edge cases`) 전수 grep — 해당 없음. 미검증 지점은 전부 A2의 스파이크 ID(S-A2-1~S-A2-6)로 이름이 붙어 있고, 그 자리마다 실제로 동작하는 보수값과 그 값을 고정하는 테스트가 함께 있다.
- 소비 심볼은 전부 계약 문서(§3.1~3.5, §4, §8, §9)이거나 이 계획의 앞선 태스크가 만든 것이다. 유일한 외부 전제는 US-A11(`packages/protocol` 스캐폴드 + `src/adapter.ts` + `src/approval.ts`)이고, 이는 계약 §10의 의존 순서와 같다.

## 수정 이력 (2026-09-20, cross-plan review)

- **M6 / 허브 `WS /bridge` 오너 명시** — Task 5와 Task 8의 `Interfaces`에 "Consumes (서버 카운터파트)" 줄을 추가했다. 서버 엔드포인트는 `ws://127.0.0.1:8787/bridge`(미니) / `wss://<mini>.ts.net/api/bridge`(맥북)이고 구현 오너는 `2026-09-20-phase-a-kernel-and-db.md`의 `hub-bridge-ws` 태스크(US-A10, T24 뒤)다. 이 계획은 dial 클라이언트만 만든다 — 상대가 없는 게 아니라 다른 계획이 소유한다는 점을 Task 8의 "만들지 말 것"에도 1줄로 못박았다.
- **M1 / 버전 핀** — Tech Stack 줄과 Task 5의 `apps/local-agent/package.json`을 계약 §2의 FIXED 핀으로 맞췄다: `vitest 2.1.9`(← `^2.1.0`), `typescript 5.6.3`(← `^5.6.0`), 그리고 `zod ^3.24.1` · `pnpm 9.12.3` 표기. caret 금지 이유(워크스페이스에 러너 2벌)를 Task 5 스텝 3에 1줄로 남겼다.
- **⑫ / `--permission-mode` 매핑** — Task 12의 `PERMISSION_MODE`를 CLI 실측 리터럴로 교체했다: `observe → "plan"`, `workspace → "manual"`, `trusted → "bypassPermissions"`. 존재하지 않는 값 `"default"`를 제거했다(출처: `tools/spikes/_probes/2026-09-20-cli-probes.md` §3, claude 2.1.274). 게이트 ⑫ 확정 전까지 pending임은 주석에 유지하고, 매핑과 "리터럴 6종 밖의 값이 없다"를 고정하는 테스트 1건을 추가했다.
- **⑪ / `--bare` 인증 경로와 양쪽 호출 지원** — Task 12 "읽을 것" 아래에 프로브 실측을 기록했다: `--bare`는 Anthropic 인증을 `ANTHROPIC_API_KEY`/`apiKeyHelper`로 한정하고 OAuth·Keychain을 읽지 않으므로 위임 턴이 구독(T3)을 못 타고 API 과금이 된다(A2-D11 가정과 충돌). 위임 런 모드는 게이트 ⑪ / 마스터 §19 Q13이 결정한다. 그때까지 두 방식을 모두 지원하도록 `ClaudeArgsOpts.bare?: boolean` · `ClaudeAdapterConfig.bare?: boolean`를 추가하고 `buildClaudeArgs`의 분기를 `o.bare ?? o.origin !== "human"`으로 바꿨다(미지정 시 A2-D11 보수값 유지). `createClaudeDsAdapter`는 `bare: true` 고정, Task 6의 `ProcessRuntimeConfig`/`PROCESS_ONLY_FIELDS`/`parseRuntime`에 TOML `bare` 키를 뚫어 실제로 설정 가능하게 했다. 양방향 오버라이드를 고정하는 테스트 1건 추가 → Task 12 검증 명령 기대값 `8 passed` → `10 passed`, 스토리 종료 체크리스트의 US-A18 행도 `claude-code 10건`으로 갱신.
- **커밋 트레일러 규칙** — Global Constraints의 커밋 줄을 kernel-and-db 계획과 같은 형식으로 교체했다(본문에 acceptance criteria, 계약 §9가 요구하는 `Co-Authored-By: Claude <tier>` / DeepSeek 변형, 불일치는 open question). 20개 태스크의 `git commit` 트레일러를 각 태스크 티어에 맞춰 `Co-Authored-By: Claude Opus <noreply@anthropic.com>`(Task 1~4·11~15) / `Co-Authored-By: Claude Sonnet <noreply@anthropic.com>`(Task 5~10·16~20)으로 바꿨다.
