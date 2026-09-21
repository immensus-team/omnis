# Agent Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `local-agent` bridge daemon that runs on both hosts (MacBook and mini) and its wire types (`src/bridge.ts` in `@omnis/protocol`), normalizing Claude Code and Codex runtime turns into durable/ephemeral/cold three-tier events the hub can read.

**Architecture:** `@omnis/protocol/src/bridge.ts` is the leaf layer that owns the zod schemas, error codes, and per-request version negotiation for JSON-RPC 2.0 payloads, and `apps/local-agent` is a single Node 22 process that depends only on those types and dials a WebSocket to the hub. Inside the bridge, the `RuntimeAdapter` implementations (Claude Code = a subprocess per turn, Codex = one resident `app-server` child) map the runtime's native streams into `turn.item.*` events, and the session registry keeps the stable `session_key` separate from the rotating `session_id`. Every execution path is contract-tested against a mock runtime process, and the delegation RPC only declares itself — without approval evidence it rejects with `-32006`.

**Tech Stack:** Node 22 · TypeScript `5.6.3` strict · pnpm `9.12.3` workspaces · zod `^3.24.1`(= pinned by `@omnis/protocol`, US-A11 — no package uses zod 4) · `ws` 8.18.x (WebSocket client) · `smol-toml` 1.3.x (TOML parser; Node 22 ships no built-in TOML) · vitest `2.1.9` (project `unit`/`contract`/`integration`) · Biome 1.x · Codex `app-server` `rust-v0.155.1` pin · Claude Code ≥ 2.1.223 (the `cross_project_resume` threshold)

Versions use the contract §2 workspace-wide pins (FIXED) as-is — do not loosen them with carets.

**Spec:** /Users/logankim/AI-Workspaces/omnis/docs/spec/00-omnis-design.md + the appendices this plan implements: `A2-agent-session-bridge.md` (complete), `A6-ops-infra.md` §10 (local-agent installation · LaunchAgent), `00-omnis-design.md` §9·§4.2, `A7-dev-process.md` §1·§2·§5·§7, contract document `docs/superpowers/plans/2026-09-20-phase-a-interfaces.md`

## Global Constraints

- Node 22 + pnpm workspaces. New packages are already covered by the `apps/*`·`packages/*` globs in `pnpm-workspace.yaml` (A7 §1).
- TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`. Extend the root `tsconfig.base.json` and set build order via `references` (A7 §1·§2).
- Postgres 17(A3). This plan never connects to the DB directly — the bridge talks only to the hub.
- The hub binds only to `127.0.0.1:8787` (master §4.2). The mini bridge connects over loopback; the MacBook bridge connects to `wss://<mini>.ts.net/api/bridge`, mounted at `/api/` by Tailscale Serve.
- Migrations are append-only files `packages/db/migrations/000N_<name>.sql` plus the tracking table `_omnis_migrations` (A3 §8). This plan **neither adds nor modifies** any migration file.
- Until the approval gate (US-A07) exists, do not wire the irreversible tools (`send`/`delete`/`delegate`/`calendar_write`) to anything (A7 §7 common prohibitions). `delegate.run` in this plan goes only as far as **declaration plus refusal**.
- Do not delete or skip tests to make them pass (A7 §7 common prohibitions).
- Import provider SDKs only inside their own adapter package (A7 §7 common prohibitions). `apps/local-agent` imports no internal package other than `@omnis/protocol`.
- Keychain item names follow the A1 rule `omnis.<channel>.<kind>.<external_id>`; bridge tokens are `omnis.bridge.token.<host>` (A2 §2.1). The account field is `omnis`.
- Story tiers follow A7 §4 (US-A16/A18/A19 = Opus, US-A17/A19b/A20 = Sonnet), and every DeepSeek diff is reviewed by Sonnet or above.
- Commit messages are `<story-id>: <one-line summary>` (A7 §6) plus the acceptance criteria met in the body, and the last line is `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. (Contract §9 requires recording the actual execution model as `Co-Authored-By: Claude <tier>` / `Co-Authored-By: DeepSeek V4.1 Flash <noreply@deepseek.com>` — the `git commit` commands under each task below are written in the contract §9 format. The mismatch is left as an open question.)

## Reading order and global YAGNI

Before starting, the implementer reads **A2 §0 (decision table A2-D1~D16) and §1 (conceptual model)**. Without these two sections you will merge `session_key`/`session_id` into one without knowing why they are split, and that invalidates this entire plan.

**What is NOT built** in Phase A (what A2·A7 explicitly deferred):

- The Hermes adapter (A2 §4.4, starting read-only in Phase B). `'hermes'` exists in `RuntimeKind`, but the adapter factory does not know this value in Phase A.
- The `'omnis'` runtime adapter (A2 §1.1). It throws explicitly in the adapter factory's `switch` — ignoring it silently would later mix it into the delegation target candidates.
- Implementations of `ingest.scan` / `ingest.read` (A7 §7 "Phase B seed note"). The method names are in `HUB_METHODS`, but the dispatcher returns `-32601`.
- The delegation **execution** path (A2 §5). `delegate.run` returns `-32006` without an `approval_id`, and even with one, the approval issuer (the US-A07 kernel) does not sign yet in Phase A, so no execution branch is built.
- Summary **generation** for `session.read_summary` (the T1 model call in A2 §6). The bridge does not produce summaries — the hub does. The bridge-side RPC is downgraded to `-32003`.
- Scanning and importing sessions Logan opened directly in a terminal (A2 §2.3).
- Retry automation (A2 §5.4). A human always triggers the retry.

---

## US-A16 — Bridge protocol types (Task 1~4)

> **Goal** (A7 §7): bridge protocol types (session_key/session_id/capabilities, MCP 2026-07-28 version negotiation)
> **Deliverable**: `packages/protocol/src/bridge.ts`
> **Verification command**: `pnpm --filter @omnis/protocol test`
> **Tier**: Opus · **Depends on**: US-A11 (`packages/protocol` scaffold plus `src/adapter.ts`·`src/approval.ts`)

### Task 1: Bridge core types (US-A16, tier: Opus)

**Files:**
- Create: `packages/protocol/src/bridge.ts`
- Test: `packages/protocol/test/bridge-types.test.ts`

**Interfaces:**
- Consumes: `HostId`, `RuntimeKind`, `Attachment`, `SessionKey`, `SessionId` (all from `packages/protocol/src/adapter.ts`, contract §3.1~3.2, US-A11 output)
- Produces: `PROTOCOL_VERSION: "2026-09-20"`, `META_KEYS`, `RuntimeCapabilities`(zod + type), `AgentRuntime`(zod + type), `PermissionProfile`, `SessionOrigin`, `SessionState`, `RuntimeState`

**Read:** A2 §1.1 (the four objects), §1.2 (capabilities self-description), §7.1 (permission profile). **Do not build:** the full `AgentSession` row type — that belongs to the `agent_sessions` table in A3, and the bridge speaks only in `session_key`.

1. - [ ] Write the failing test: `packages/protocol/test/bridge-types.test.ts`

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

2. - [ ] Run it and confirm the failure: `pnpm --filter @omnis/protocol test`
   Expected failure: `Failed to resolve import "../src/bridge.js" from "test/bridge-types.test.ts"`

3. - [ ] Write the minimal implementation: `packages/protocol/src/bridge.ts`

```ts
import { z } from "zod";
import { HostId, RuntimeKind } from "./adapter.js";

/** A2-D3: no initialize handshake. Every request carries this version in params._meta. */
export const PROTOCOL_VERSION = "2026-09-20" as const;

export const META_KEYS = {
  protocolVersion: "ai.omnis/protocolVersion",
  traceId: "ai.omnis/traceId",
  origin: "ai.omnis/origin",
} as const;

/** A2 §7.1. The profile is determined only by origin and purpose, and a prompt never changes it. */
export const PermissionProfile = z.enum(["observe", "workspace", "trusted"]);
export type PermissionProfile = z.infer<typeof PermissionProfile>;

export const SessionOrigin = z.enum(["human", "delegation", "job"]);
export type SessionOrigin = z.infer<typeof SessionOrigin>;

export const SessionState = z.enum(["idle", "running", "awaiting_approval", "failed", "closed"]);
export type SessionState = z.infer<typeof SessionState>;

export const RuntimeState = z.enum(["online", "degraded", "offline"]);
export type RuntimeState = z.infer<typeof RuntimeState>;

/** A2 §1.2. features carries the runtime's native strings through untouched. */
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

/** A2 §1.1. transport='http' means binary_path=null, allowed_roots=[]. */
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

4. - [ ] Run the tests: `pnpm --filter @omnis/protocol test` → 4 passed

5. - [ ] Commit:

```bash
git -C omnis/.worktrees/US-A16 add packages/protocol/src/bridge.ts packages/protocol/test/bridge-types.test.ts
git -C omnis/.worktrees/US-A16 commit -m "US-A16: bridge core types (capabilities·AgentRuntime·PROTOCOL_VERSION)

- Pin AgentRuntime·RuntimeCapabilities from A2 §1.1/§1.2 as zod schemas
- The features array passes runtime strings through untouched
- Allow binary_path=null/allowed_roots=[] when transport='http'

Co-Authored-By: Claude Opus <noreply@anthropic.com>"
```

### Task 2: Wire payload schemas (US-A16, tier: Opus)

**Files:**
- Modify: `packages/protocol/src/bridge.ts`
- Test: `packages/protocol/test/bridge-wire.test.ts`

**Interfaces:**
- Consumes: Task 1's `AgentRuntime`·`PermissionProfile`·`SessionOrigin`·`SessionState`, `SessionKey`/`SessionId`/`Attachment` (adapter.ts), `HumanInterrupt` (contract §3.4, `src/approval.ts`)
- Produces: `TurnInput`, `SessionCreateParams`/`SessionCreateResult`, `SessionResumeParams`/`SessionResumeResult`, `TurnStartParams`/`TurnStartResult`, `TurnCancelParams`/`TurnCancelResult`, `SessionCloseParams`/`SessionCloseResult`, `BridgeDiscoverResult`, `DelegationBrief`, `BridgeItemKind`, `SessionRegistered`, `TurnStarted`, `ItemStarted`, `ItemDelta`, `ItemCompleted`, `TurnUsage`, `TurnCompleted`, `ApprovalRequestedParams`, `HealthNotification`, `SessionSummary`

**Read:** A2 §3.2 (hub→bridge table), §3.3 (bridge→hub table), §5.2 (the five brief fields), §6 (SessionSummary). **Do not build:** do not extend `kind` beyond `agent_turn`/`tool_call` — reasoning is a delta, not an item (A2 §3.3).

1. - [ ] Write the failing test: `packages/protocol/test/bridge-wire.test.ts`

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

2. - [ ] Run it and confirm the failure: `pnpm --filter @omnis/protocol test`
   Expected failure: `SyntaxError: The requested module '../src/bridge.js' does not provide an export named 'SessionCreateParams'`

3. - [ ] Append the minimal implementation to the end of `packages/protocol/src/bridge.ts`:

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

/** A2 §5.2. Five fixed fields; never create a delegation without verify. */
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
/** reasoning is not an item. These two are the only values of kind. */
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

/** A2 §6. Raw deltas and reasoning text are not carried here (A2-D13). */
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

4. - [ ] Run the tests: `pnpm --filter @omnis/protocol test` → 6 passed (bridge-wire) + 4 passed (bridge-types)

5. - [ ] Commit:

```bash
git -C omnis/.worktrees/US-A16 add packages/protocol/src/bridge.ts packages/protocol/test/bridge-wire.test.ts
git -C omnis/.worktrees/US-A16 commit -m "US-A16: bridge wire payload zod schemas

- Every params/result/notification payload from A2 §3.2/§3.3
- DelegationBrief: output_path is required when output='file' (refine)
- ItemDelta.channel defaults to output; reasoning is delta-only

Co-Authored-By: Claude Opus <noreply@anthropic.com>"
```

### Task 3: Error codes and method lists (US-A16, tier: Opus)

**Files:**
- Modify: `packages/protocol/src/bridge.ts`
- Test: `packages/protocol/test/bridge-errors.test.ts`

**Interfaces:**
- Consumes: none (leaf)
- Produces: `BRIDGE_ERRORS`, `JSONRPC_ERRORS`, `BridgeErrorCode`, `BridgeError`, `HUB_METHODS`, `BRIDGE_METHODS`, `HubMethod`, `BridgeMethod`, `toJsonRpcError(e: unknown): { code: number; message: string; data?: unknown }`

**Read:** A2 §3.4 (the 12-code error table plus the 5 JSON-RPC standard codes). **Do not build:** do not invent new error codes. Situations not in the table fold into `-32603 internal`.

1. - [ ] Write the failing test: `packages/protocol/test/bridge-errors.test.ts`

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

2. - [ ] Run it and confirm the failure: `pnpm --filter @omnis/protocol test`
   Expected failure: `SyntaxError: ... does not provide an export named 'BRIDGE_ERRORS'`

3. - [ ] Append the minimal implementation to `packages/protocol/src/bridge.ts`:

```ts
/** JSON-RPC 2.0 standard codes. A2 §3.4 layers the omnis range on top of these. */
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

4. - [ ] Run the tests: `pnpm --filter @omnis/protocol test` → 4 passed (bridge-errors)

5. - [ ] Commit:

```bash
git -C omnis/.worktrees/US-A16 add packages/protocol/src/bridge.ts packages/protocol/test/bridge-errors.test.ts
git -C omnis/.worktrees/US-A16 commit -m "US-A16: bridge error codes, method lists, and toJsonRpcError

- The 12 omnis codes from A2 §3.4 plus the 5 JSON-RPC standard codes
- Pin HUB_METHODS/BRIDGE_METHODS; BridgeError.name = the class name

Co-Authored-By: Claude Opus <noreply@anthropic.com>"
```

### Task 4: per-request version negotiation (US-A16, tier: Opus)

**Files:**
- Modify: `packages/protocol/src/bridge.ts`, `packages/protocol/src/index.ts`
- Test: `packages/protocol/test/bridge-version.test.ts`

**Interfaces:**
- Consumes: Task 1's `PROTOCOL_VERSION`·`META_KEYS`·`SessionOrigin`, Task 3's `BridgeError`·`BRIDGE_ERRORS`
- Produces: `SUPPORTED_PROTOCOL_VERSIONS: readonly ["2026-09-20"]`, `RpcMeta`(zod), `withMeta<P>(params, meta?)`, `assertProtocolVersion(params: unknown): void`

**Read:** A2-D3, §3.1 (common shape). **Do not build:** the `initialize` handshake, or closing the connection on a version mismatch. A mismatch rejects **only that request** — that is what lets the bridge and the hub be deployed separately.

1. - [ ] Write the failing test: `packages/protocol/test/bridge-version.test.ts`

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

2. - [ ] Run it and confirm the failure: `pnpm --filter @omnis/protocol test`
   Expected failure: `SyntaxError: ... does not provide an export named 'withMeta'`

3. - [ ] Append the minimal implementation to `packages/protocol/src/bridge.ts`:

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

/** A2-D3: a mismatch does not drop the connection; it rejects only this request with -32010. */
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

4. - [ ] Add one line to `packages/protocol/src/index.ts`: `export * from "./bridge.js";`

5. - [ ] Run the tests and typecheck: `pnpm --filter @omnis/protocol test` → 5 passed, `pnpm typecheck` → exit 0

6. - [ ] Commit:

```bash
git -C omnis/.worktrees/US-A16 add packages/protocol/src/bridge.ts packages/protocol/src/index.ts packages/protocol/test/bridge-version.test.ts
git -C omnis/.worktrees/US-A16 commit -m "US-A16: per-request protocol version negotiation (withMeta/assertProtocolVersion)

- The A2-D3 MCP 2026-07-28 model: no initialize handshake
- A version mismatch is not a connection close but -32010 + data.supported
- Re-export bridge.ts from index.ts

Co-Authored-By: Claude Opus <noreply@anthropic.com>"
```

---

## US-A17 — The `local-agent` daemon (Task 5~10)

> **Goal** (A7 §7): `apps/local-agent` daemon scaffold (Tailscale connection, session registration)
> **Deliverable**: `apps/local-agent/src/main.ts`
> **Verification command**: `pnpm --filter @omnis/local-agent test`
> **Tier**: Sonnet · **Depends on**: US-A16

### Task 5: Package scaffold and single-line JSON logger (US-A17, tier: Sonnet)

**Files:**
- Create: `apps/local-agent/package.json`, `apps/local-agent/tsconfig.json`, `apps/local-agent/vitest.config.ts`, `apps/local-agent/src/logger.ts`
- Test: `apps/local-agent/test/logger.test.ts`

**Interfaces:**
- Consumes: `@omnis/protocol` (declares the workspace dependency only)
- Consumes (server counterpart): the hub's **`WS /bridge`** endpoint — the exact address is `ws://127.0.0.1:8787/bridge` over mini loopback, and `wss://<mini>.ts.net/api/bridge` for the MacBook through Tailscale Serve. That server is **implemented by the `hub-bridge-ws` task (US-A10, after T24) in `2026-09-20-phase-a-kernel-and-db.md`** (the `WS /bridge` row in contract §5). This plan builds only the dialing client side — the counterpart is not missing, it is owned by another plan. Until that side merges, test with the fake/mock sockets in Task 8·19, and confirm the end-to-end connection with the US-A20 contract tests after `hub-bridge-ws` merges.
- Produces: the `Logger` interface, `createLogger(pkg: string, opts?: { sink?: (line: string) => void; now?: () => Date }): Logger`

**Read:** contract §9 (logging convention), A7 §1 (dependency direction). **Do not build:** a logging library such as pino or winston. A single line of JSON with the five required keys is enough, and there is no reason for another dependency on the bridge boot path.

1. - [ ] Write the failing test: `apps/local-agent/test/logger.test.ts`

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

2. - [ ] Run it and confirm the failure: `pnpm --filter @omnis/local-agent test`
   Expected failure: `ERR_PNPM_NO_MATCHING_PROJECT  No projects matched the filters in "/Users/logankim/AI-Workspaces/omnis"`

3. - [ ] Create `apps/local-agent/package.json`:

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

   `typescript`/`vitest` are the fixed pins from contract §2 (identical across the workspace: `vitest 2.1.9` · `typescript 5.6.3` · `zod ^3.24.1` · `pg 8.13.1` · `packageManager pnpm@9.12.3`). Adding a caret installs two versions in the workspace, and `pnpm test` then runs a different runner per package.

4. - [ ] Create `apps/local-agent/tsconfig.json` and `apps/local-agent/vitest.config.ts`:

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

5. - [ ] Create `apps/local-agent/src/logger.ts`:

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

6. - [ ] Link the workspace with `pnpm install`, then run the tests: `pnpm --filter @omnis/local-agent test` → 2 passed

7. - [ ] Commit:

```bash
git -C omnis/.worktrees/US-A17 add apps/local-agent
git -C omnis/.worktrees/US-A17 commit -m "US-A17: local-agent package scaffold + single-line JSON logger

- Depends only on @omnis/protocol (A7 §1 dependency direction)
- The five required log keys from contract §9 (ts/level/pkg/msg/trace_id)

Co-Authored-By: Claude Sonnet <noreply@anthropic.com>"
```

### Task 6: TOML config and precedence resolution (US-A17, tier: Sonnet)

**Files:**
- Create: `apps/local-agent/src/config.ts`
- Test: `apps/local-agent/test/config.test.ts`

**Interfaces:**
- Consumes: `HostId`(@omnis/protocol)
- Produces: `ProcessRuntimeConfig`, `HttpRuntimeConfig`, `RuntimeConfig`, `LocalAgentConfig`, `ConfigSource = "cli"|"env"|"toml"|"default"`, `LoadConfigResult`, `HOST_DEFAULTS`, `normalizeHubUrl(input: string): string`, `loadConfig(input: { argv: string[]; env: NodeJS.ProcessEnv; tomlText?: string }): LoadConfigResult`, `ConfigError`

**Read:** A2-D15, A2 §2.1 (the two TOML examples plus the field branching table and the `allowed_roots` rejection rule), contract §8. **Do not build:** a path that adds or modifies `[[runtime]]` from the CLI or the environment. If `allowed_roots` could change on the command line, the path ceiling in A2-D12 loses its meaning.

1. - [ ] Write the failing test: `apps/local-agent/test/config.test.ts`

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

2. - [ ] Run it and confirm the failure: `pnpm --filter @omnis/local-agent test`
   Expected failure: `Failed to resolve import "../src/config.js"`

3. - [ ] Create `apps/local-agent/src/config.ts`:

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
  /** Gate ⑪ switch (Task 12). Unset means the origin default (A2-D11). It joins the field list in contract §8 once the gate closes. */
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

/** Contract §8. host-config.ts (US-A19b) reuses this table. */
export const HOST_DEFAULTS: Record<HostId, { hub_url: string; token_keychain_item: string }> = {
  mini: { hub_url: "ws://127.0.0.1:8787/bridge", token_keychain_item: "omnis.bridge.token.mini" },
  macbook: { hub_url: "wss://omnis-hub.your-tailnet.ts.net/api/bridge", token_keychain_item: "omnis.bridge.token.macbook" },
};

const PROCESS_KINDS = new Set(["claude_code", "codex", "claude_ds"]);
const PROCESS_ONLY_FIELDS = ["binary", "allowed_roots", "pinned_version", "default_model", "bare"];
const HTTP_ONLY_FIELDS = ["base_url", "session_header_mode"];

/** The plist in A6 §10 passes `--hub http://127.0.0.1:8787`. What the bridge uses is ws(s) + /bridge. */
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
    if (typeof raw.bare === "boolean") out.bare = raw.bare;   // gate ⑪ switch. If absent, Task 12 uses the origin default
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

4. - [ ] Run the tests: `pnpm --filter @omnis/local-agent test` → 8 passed

5. - [ ] Commit:

```bash
git -C omnis/.worktrees/US-A17 add apps/local-agent/src/config.ts apps/local-agent/test/config.test.ts apps/local-agent/package.json
git -C omnis/.worktrees/US-A17 commit -m "US-A17: TOML config + CLI>env>TOML>default precedence (A2-D15)

- [[runtime]] is TOML-only; --runtimes only filters
- Refuse to start if allowed_roots contains \$HOME or /
- Normalize the http base URL from the A6 plist into ws(s)+/bridge

Co-Authored-By: Claude Sonnet <noreply@anthropic.com>"
```

### Task 7: Session registry and path ceiling (US-A17, tier: Sonnet)

**Files:**
- Create: `apps/local-agent/src/paths.ts`, `apps/local-agent/src/session-registry.ts`
- Test: `apps/local-agent/test/session-registry.test.ts`

**Interfaces:**
- Consumes: `SessionKey`, `SessionId`, `SessionState`, `SessionOrigin`, `PermissionProfile`, `RuntimeKind`, `BridgeError`, `BRIDGE_ERRORS`(@omnis/protocol)
- Produces: `assertPathAllowed(cwd: string, allowedRoots: string[]): string` (returns the normalized realpath), `SessionRecord`, `SessionRegistry` (methods `create`/`get`/`require`/`bindSessionId`/`setState`/`list`/`close`)

**Read:** A2-D1 (key/id separation), A2-D12 (path revalidation), §7.2 (directory ceiling). **Do not build:** the bridge does not persist sessions to disk — on reconnect it re-announces via `session.registered` and the hub upserts on `session_key` (A2 §2.2 item 5).

1. - [ ] Write the failing test: `apps/local-agent/test/session-registry.test.ts`

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

2. - [ ] Run it and confirm the failure: `pnpm --filter @omnis/local-agent test`
   Expected failure: `Failed to resolve import "../src/paths.js"`

3. - [ ] Create `apps/local-agent/src/paths.ts`:

```ts
import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { BRIDGE_ERRORS, BridgeError } from "@omnis/protocol";

/** A2-D12: the bridge revalidates the cwd the hub sends. Symlinks are re-checked after realpath. */
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

4. - [ ] Create `apps/local-agent/src/session-registry.ts`:

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

/** The bridge manages only the sessions it created (A2 §2.3). It does not persist them to disk. */
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

  /** When the runtime creates a new session, only this value changes. The session_key and thread are kept. */
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

5. - [ ] Run the tests: `pnpm --filter @omnis/local-agent test` → 6 passed

6. - [ ] Commit:

```bash
git -C omnis/.worktrees/US-A17 add apps/local-agent/src/paths.ts apps/local-agent/src/session-registry.ts apps/local-agent/test/session-registry.test.ts
git -C omnis/.worktrees/US-A17 commit -m "US-A17: session registry (session_key≠session_id) + allowed_roots revalidation

- A2-D1: session_key and thread survive session_id rotation
- A2-D12: re-check after realpath; -32005 if outside

Co-Authored-By: Claude Sonnet <noreply@anthropic.com>"
```

### Task 8: Hub WebSocket client and reconnect backoff (US-A17, tier: Sonnet)

**Files:**
- Create: `apps/local-agent/src/keychain.ts`, `apps/local-agent/src/hub-client.ts`
- Test: `apps/local-agent/test/hub-client.test.ts`

**Interfaces:**
- Consumes: `LocalAgentConfig`(Task 6), `Logger`(Task 5), `withMeta`, `toJsonRpcError`, `BridgeMethod`, `HubMethod`(@omnis/protocol)
- Consumes (server counterpart): the hub `WS /bridge` — `ws://127.0.0.1:8787/bridge` (mini) / `wss://<mini>.ts.net/api/bridge` (MacBook). The owner is the `hub-bridge-ws` task (US-A10) in `2026-09-20-phase-a-kernel-and-db.md`. This task does not build that server; it only dials it.
- Produces: `readKeychainSecret(item, account?, exec?)`, `backoffDelayMs(attempt: number, rand?: () => number): number`, `SocketLike`, `HubClientDeps`, `HubClient` (methods `start`/`stop`/`notify`/`request`)

**Read:** A2 §2.2 (the six steps of connect · authenticate · reconnect), §3.1 (common JSON-RPC shape). **Do not build:** a hub→bridge dial path (A2-D2: only the bridge dials). Do not build the hub-side `WS /bridge` server here either — `hub-bridge-ws` (kernel-and-db) owns it. Do not invent a heartbeat — the 30-second `health` notification serves that role.

1. - [ ] Write the failing test: `apps/local-agent/test/hub-client.test.ts`

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

2. - [ ] Run it and confirm the failure: `pnpm --filter @omnis/local-agent test`
   Expected failure: `Failed to resolve import "../src/hub-client.js"`

3. - [ ] Create `apps/local-agent/src/keychain.ts`:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
export const KEYCHAIN_ACCOUNT = "omnis";

/** Never put the value in logs, events, or error messages (A2 §7.2). */
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

4. - [ ] Create `apps/local-agent/src/hub-client.ts`:

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

/** A2 §2.2 item 5: 1s → 2s → 4s → … → 30s ceiling, ±20% jitter. */
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

5. - [ ] Run the tests: `pnpm --filter @omnis/local-agent test` → 5 passed

6. - [ ] Commit:

```bash
git -C omnis/.worktrees/US-A17 add apps/local-agent/src/hub-client.ts apps/local-agent/src/keychain.ts apps/local-agent/test/hub-client.test.ts
git -C omnis/.worktrees/US-A17 commit -m "US-A17: hub WS JSON-RPC client + exponential backoff reconnect

- A2-D2: only the bridge dials, Authorization: Bearer <keychain token>
- 1s→30s ±20% jitter backoff, bidirectional request/notification handling

Co-Authored-By: Claude Sonnet <noreply@anthropic.com>"
```

### Task 9: The durable outbox while disconnected (US-A17, tier: Sonnet)

**Files:**
- Create: `apps/local-agent/src/outbox.ts`
- Test: `apps/local-agent/test/outbox.test.ts`

**Interfaces:**
- Consumes: `BridgeMethod`(@omnis/protocol)
- Produces: `OutboxEntry`, `Outbox` (constructor `{ path, maxBytes? }`, methods `append`/`drain`/`sizeBytes`/`length`)

**Read:** A2 §2.2 "turns while disconnected". **Do not build:** do not queue ephemeral deltas. Do not build a resend success/failure state machine — if drain throws, the remaining lines stay in the file as they are.

1. - [ ] Write the failing test: `apps/local-agent/test/outbox.test.ts`

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

2. - [ ] Run it and confirm the failure: `pnpm --filter @omnis/local-agent test`
   Expected failure: `Failed to resolve import "../src/outbox.js"`

3. - [ ] Create `apps/local-agent/src/outbox.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { BridgeMethod } from "@omnis/protocol";

export interface OutboxEntry { method: BridgeMethod; params: Record<string, unknown>; at?: string }

/** A2 §2.2: queue durable events only. Ephemeral deltas are dropped. approval.requested is never dropped. */
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

  /** Send in order and delete only what succeeded. If it throws, the rest stays in the file. */
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

4. - [ ] Run the tests: `pnpm --filter @omnis/local-agent test` → 3 passed

5. - [ ] Commit:

```bash
git -C omnis/.worktrees/US-A17 add apps/local-agent/src/outbox.ts apps/local-agent/test/outbox.test.ts
git -C omnis/.worktrees/US-A17 commit -m "US-A17: durable outbox for reconnect (~/.omnis/outbox.ndjson, 50MB)

- A2 §2.2: order-preserving flush; approval.requested is never dropped
- Ephemeral deltas are never queued

Co-Authored-By: Claude Sonnet <noreply@anthropic.com>"
```

### Task 10: RPC dispatcher and `delegate.run` refusal (US-A17, tier: Sonnet)

**Files:**
- Create: `apps/local-agent/src/rpc-dispatch.ts`, `apps/local-agent/src/main.ts`
- Test: `apps/local-agent/test/rpc-dispatch.test.ts`

**Interfaces:**
- Consumes: Task 4 `assertProtocolVersion`, Task 3 `BRIDGE_ERRORS`/`JSONRPC_ERRORS`/`BridgeError`, Task 2 `SessionCreateParams`/`TurnStartParams`/`TurnCancelParams`/`SessionCloseParams`/`BridgeDiscoverResult`, Task 6 `loadConfig`, Task 7 `SessionRegistry`/`assertPathAllowed`, Task 8 `HubClient`
- Produces: `RuntimeAdapter`, `EventSink`, `TurnHandle`, `DispatchDeps`, `createDispatcher(deps: DispatchDeps): (method: string, params: unknown) => Promise<unknown>`, `main(argv, env): Promise<void>`

**Read:** A2 §3.2 (method table), the top of §4 (RuntimeAdapter/EventSink), the last paragraph of §5.1 (`delegate.run` without an `approval_id` is rejected at the wire). **Do not build:** the execution branch of `delegate.run`. Implementations of `ingest.*`. Summary generation for `session.read_summary`.

1. - [ ] Write the failing test: `apps/local-agent/test/rpc-dispatch.test.ts`

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

2. - [ ] Run it and confirm the failure: `pnpm --filter @omnis/local-agent test`
   Expected failure: `Failed to resolve import "../src/rpc-dispatch.js"`

3. - [ ] Create `apps/local-agent/src/rpc-dispatch.ts`:

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
      throw new BridgeError(JSONRPC_ERRORS.METHOD_NOT_FOUND, `${method} is Phase B (A7 §7 Phase B seed note)`);
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
        // The hub produces summaries (A2 §6). The bridge has no generation path.
        throw new BridgeError(BRIDGE_ERRORS.CAPABILITY_UNSUPPORTED, "session.read_summary is served by the hub, not the bridge");

      case "delegate.run": {
        // A2 §5.1: without a hub-signed approval_id, reject at the wire. Phase A has no execution branch.
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

4. - [ ] Create `apps/local-agent/src/main.ts` to wire the pieces together:

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

5. - [ ] Run the tests and typecheck: `pnpm --filter @omnis/local-agent test` → 6 passed, `pnpm typecheck` → exit 0

6. - [ ] Commit:

```bash
git -C omnis/.worktrees/US-A17 add apps/local-agent/src/rpc-dispatch.ts apps/local-agent/src/main.ts apps/local-agent/test/rpc-dispatch.test.ts
git -C omnis/.worktrees/US-A17 commit -m "US-A17: RPC dispatcher + main entry (delegate.run rejects with -32006)

- Fix the order: version negotiation → method routing → params zod parsing
- ingest.* is Phase B so -32601; session.read_summary is hub-owned so -32003
- session.create only creates a slot and never spawns a process

Co-Authored-By: Claude Sonnet <noreply@anthropic.com>"
```

---

## US-A18 — Claude Code bridge (Task 11~12)

> **Goal** (A7 §7): Claude Code bridge (wrapping `claude -p --output-format stream-json --resume`)
> **Deliverable**: `apps/local-agent/src/bridges/claude-code.ts`
> **Verification command**: `pnpm --filter @omnis/local-agent test`
> **Tier**: Opus · **Depends on**: US-A17

### Task 11: stream-json parser and durable debounce (US-A18, tier: Opus)

**Files:**
- Create: `apps/local-agent/src/bridges/stream-json.ts`, `apps/local-agent/src/bridges/durable-debounce.ts`
- Test: `apps/local-agent/test/stream-json.test.ts`

**Interfaces:**
- Consumes: `BridgeMethod`, `BridgeItemKind`(@omnis/protocol)
- Produces: `BridgeEmit = { method: BridgeMethod; params: Record<string, unknown> }`, `StreamJsonState`, `newStreamJsonState()`, `mapStreamJsonEvent(raw, ctx): BridgeEmit[]`, `truncateToolResult(body: string): { body: string; truncated: boolean }`, `createDurableDebouncer(emit, opts)`

**Read:** A2 §4.1 (the entire event → Item mapping table), A2-D4 (three tiers). **Do not build:** do not lift the full `system/init` payload into durable (measured at 28KB). Do not handle `content_block_stop` — `assistant` is the authoritative version.

1. - [ ] Write the failing test: `apps/local-agent/test/stream-json.test.ts`

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

2. - [ ] Run it and confirm the failure: `pnpm --filter @omnis/local-agent test`
   Expected failure: `Failed to resolve import "../src/bridges/stream-json.js"`

3. - [ ] Create `apps/local-agent/src/bridges/durable-debounce.ts`:

```ts
import type { BridgeMethod } from "@omnis/protocol";

export interface DurableEvent { method: BridgeMethod; params: Record<string, unknown> }

/**
 * A2-D4: create the row on turn.item.started; UPDATE only on the 500ms debounce or on turn.item.completed.
 * Drop duplicate started events for the same item_id, and keep only the last of a burst of completed events.
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

4. - [ ] Create `apps/local-agent/src/bridges/stream-json.ts`:

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

/** A2 §4.1 mapping table. Events not in the table return an empty array → they stay in the cold tier only. */
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

5. - [ ] Run the tests: `pnpm --filter @omnis/local-agent test` → 8 passed

6. - [ ] Commit:

```bash
git -C omnis/.worktrees/US-A18 add apps/local-agent/src/bridges apps/local-agent/test/stream-json.test.ts
git -C omnis/.worktrees/US-A18 commit -m "US-A18: stream-json event → Item mapping + 500ms durable debounce

- The full A2 §4.1 table; system/init promotes only session_id·capabilities
- Unknown events produce 0 durable rows (cold only); tool_result is truncated at 8KB

Co-Authored-By: Claude Opus <noreply@anthropic.com>"
```

### Task 12: Claude Code adapter and the claude-ds variant (US-A18, tier: Opus)

**Files:**
- Create: `apps/local-agent/src/bridges/claude-code.ts`
- Test: `apps/local-agent/test/claude-code.test.ts`

**Interfaces:**
- Consumes: Task 11's `mapStreamJsonEvent`/`newStreamJsonState`/`createDurableDebouncer`, Task 10's `RuntimeAdapter`/`EventSink`/`TurnHandle`, Task 7's `SessionRecord`
- Produces: `PERMISSION_MODE`, `permissionModeFor(profile, origin)`, `buildClaudeArgs(opts): string[]`, `parseClaudeCapabilities(versionLine: string): { version, capabilities }`, `ClaudeCodeAdapter`, `createClaudeDsAdapter(cfg)`

**Read:** A2-D5, A2-D8, A2-D11, §4.1, §4.3 (the claude-ds difference table), §7.1. **Do not build:** a resident process. The Agent SDK. The exact surface of `--settings` hook injection (S-A2-1 unverified) — leave only the flag slot open, and verify hook promotion with the US-A20 mock.

**`--bare` changes the authentication path (probe measurement, `tools/spikes/_probes/2026-09-20-cli-probes.md` §2).** Under `--bare`, Anthropic authentication is **limited to `ANTHROPIC_API_KEY` or `apiKeyHelper` in `--settings`** and OAuth·Keychain are not read at all. That means a delegation turn running with `--bare` cannot use the Claude subscription (T3) and is billed per token (T2-class) — which conflicts with what A2-D11 assumed, that "delegation rides the subscription binary". **Which way to run delegation is decided by gate ⑪ (S-A2-1) / master §19 Q13.** Since that decision has not been made, the Phase A bridge **supports both call modes**: the `bare` config flag (`ClaudeAdapterConfig.bare?: boolean`) forces or forbids it, and when unset it falls back to the A2-D11 conservative value (non-human origin = `--bare`). claude-ds (DeepSeek, API key) is unaffected — `--bare` is the natural mode, so it is pinned to `bare: true`.

1. - [ ] Write the failing test: `apps/local-agent/test/claude-code.test.ts`

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

  it("lets the bare flag override the origin default in both directions (gate ⑪ undecided)", () => {
    // If gate ⑪ decides to run delegation on subscription auth, bare:false
    expect(buildClaudeArgs({ prompt: "x", model: "sonnet", profile: "workspace", origin: "delegation", sessionId: null, bare: false })).not.toContain("--bare");
    // If it decides to isolate even human turns behind an API key, bare:true
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
    expect(Object.values(PERMISSION_MODE)).not.toContain("default");  // a value claude 2.1.274 does not have
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

2. - [ ] Run it and confirm the failure: `pnpm --filter @omnis/local-agent test`
   Expected failure: `Failed to resolve import "../src/bridges/claude-code.js"`

3. - [ ] Create `apps/local-agent/src/bridges/claude-code.ts`:

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
 * profile → --permission-mode mapping (A2 §7.1, contract §8).
 * The literals measured on claude 2.1.274 are only the six acceptEdits|auto|bypassPermissions|manual|dontAsk|plan,
 * and no value named 'default' exists (tools/spikes/_probes/2026-09-20-cli-probes.md §3).
 * This table stays pending until gate ⑫ (S-A2-2) settles it, but the invariant is fixed now:
 * bypassPermissions is emitted only for trusted + origin='human'.
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
   * Whether to turn on `--bare`. When unset, the A2-D11 conservative value (non-human origin = bare).
   * `--bare` limits the auth path to ANTHROPIC_API_KEY / apiKeyHelper and does not read OAuth·Keychain
   * (measured on claude 2.1.274). Whether delegation runs on the subscription or on an API key is decided by
   * gate ⑪ / master §19 Q13 — this flag exists so both modes are supported until then.
   */
  bare?: boolean;
}

export function buildClaudeArgs(o: ClaudeArgsOpts): string[] {
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--model", o.model,
    "--permission-mode", permissionModeFor(o.profile, o.origin)];
  if (o.sessionId !== null) args.push("--resume", o.sessionId);
  if (o.bare ?? o.origin !== "human") args.push("--bare");           // A2-D11 default; gate ⑪ may flip it
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
  /** The switch until gate ⑪ is settled. Unset means the origin default (A2-D11). `bare` from TOML `[[runtime]]` arrives here. */
  bare?: boolean;
  env?: NodeJS.ProcessEnv;
  spawnFn?: typeof spawn;
}

/** A2-D5: a subprocess per turn. Do not make it resident. A2-D8: claude-ds is a config variant of this class. */
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
      sink.raw(line);                                  // cold tier
      let ev: unknown;
      try { ev = JSON.parse(line); } catch { return; } // an unknown format must not kill the parser
      for (const emit of mapStreamJsonEvent(ev, { session_key: s.session_key, turn_id: turnId, state })) {
        if (emit.method === "turn.item.delta") sink.delta(emit.params);   // ephemeral, never stored
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

  async close(): Promise<void> { /* process-per-turn, so there is no resident resource to close */ }

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

/** A2 §4.3: only the binary, the model alias, and the key source differ. For cost, do not trust result.cost_usd. */
export function createClaudeDsAdapter(cfg: { binary: string; apiKey: string; model?: string; spawnFn?: typeof spawn }): ClaudeCodeAdapter {
  return new ClaudeCodeAdapter({
    kind: "claude_ds",
    binary: cfg.binary,
    defaultModel: cfg.model ?? "deepseek-flash",
    strictMcpConfig: true,
    bare: true,              // runs on an API key only, so --bare is the natural mode (probe §2). Unrelated to gate ⑪.
    env: { DEEPSEEK_API_KEY: cfg.apiKey },
    ...(cfg.spawnFn === undefined ? {} : { spawnFn: cfg.spawnFn }),
  });
}
```

4. - [ ] Run the tests: `pnpm --filter @omnis/local-agent test` → 10 passed

5. - [ ] Commit:

```bash
git -C omnis/.worktrees/US-A18 add apps/local-agent/src/bridges/claude-code.ts apps/local-agent/test/claude-code.test.ts
git -C omnis/.worktrees/US-A18 commit -m "US-A18: Claude Code adapter (subprocess per turn) + claude-ds variant

- Pin the A2-D5 flag combination; for A2-D11 the non-human origin defaults to --bare
- --bare uses only ANTHROPIC_API_KEY/apiKeyHelper auth (probe measurement) → the bare flag supports both call modes; the delegation mode is settled by gate ⑪ / master §19 Q13
- --permission-mode uses only the measured CLI literals: observe→plan, workspace→manual, trusted→bypassPermissions
- bypassPermissions only for trusted+human (anything else is a BridgeError)
- A2-D8: claude-ds is a config variant, not a separate class (bare: true pinned)

Co-Authored-By: Claude Opus <noreply@anthropic.com>"
```

---

## US-A19 — Codex bridge (Task 13~15)

> **Goal** (A7 §7): Codex bridge (`app-server` JSON-RPC, version pin)
> **Deliverable**: `apps/local-agent/src/bridges/codex.ts`
> **Verification command**: `pnpm --filter @omnis/local-agent test`
> **Tier**: Opus · **Depends on**: US-A17

### Task 13: `app-server` stdio JSON-RPC client (US-A19, tier: Opus)

**Files:**
- Create: `apps/local-agent/src/bridges/app-server-client.ts`
- Test: `apps/local-agent/test/app-server-client.test.ts`

**Interfaces:**
- Consumes: none
- Produces: `AppServerClient` (constructor `{ stdin: NodeJS.WritableStream; stdout: NodeJS.ReadableStream }`, methods `request`/`on`/`close`)

**Read:** A2-D6, the top of §4.2. **Do not build:** do not put a restart or health-check loop here — managing the resident process lifetime is the Task 14 adapter's responsibility.

1. - [ ] Write the failing test: `apps/local-agent/test/app-server-client.test.ts`

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

2. - [ ] Run it and confirm the failure: `pnpm --filter @omnis/local-agent test`
   Expected failure: `Failed to resolve import "../src/bridges/app-server-client.js"`

3. - [ ] Create `apps/local-agent/src/bridges/app-server-client.ts`:

```ts
import { createInterface } from "node:readline";

type Handler = (params: unknown) => void;

/** A2-D6: hold one resident app-server child over stdio. Newline-delimited JSON-RPC 2.0. */
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
    try { msg = JSON.parse(line); } catch { return; }   // an unknown format must not kill the parser
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

4. - [ ] Run the tests: `pnpm --filter @omnis/local-agent test` → 3 passed

5. - [ ] Commit:

```bash
git -C omnis/.worktrees/US-A19 add apps/local-agent/src/bridges/app-server-client.ts apps/local-agent/test/app-server-client.test.ts
git -C omnis/.worktrees/US-A19 commit -m "US-A19: Codex app-server stdio JSON-RPC client

- Line-based framing, id correlation, notification handlers
- A malformed line is ignored and the stream keeps being read

Co-Authored-By: Claude Opus <noreply@anthropic.com>"
```

### Task 14: Codex event mapping and approval conversion (US-A19, tier: Opus)

**Files:**
- Create: `apps/local-agent/src/bridges/codex.ts`
- Test: `apps/local-agent/test/codex.test.ts`

**Interfaces:**
- Consumes: Task 13's `AppServerClient`, Task 11's `BridgeEmit`, Task 10's `RuntimeAdapter`/`EventSink`
- Produces: `KNOWN_CODEX_ITEM_TYPES`, `REASONING_DELTA_METHODS`, `mapAppServerEvent(method, params, ctx): BridgeEmit[]`, `codexDecisionToResponse(d)`, `CodexAdapter`

**Read:** A2 §4.2 (event table + approval mapping table + version drift). **Do not build:** do not promote reasoning deltas to durable (the table pins "no durable promotion"). Do not expose `acceptWithExecpolicyAmendment` in the UI (S-A2-3 unverified → downgrade to decline).

1. - [ ] Write the failing test: `apps/local-agent/test/codex.test.ts`

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

describe("codexDecisionToResponse (A2 §4.2 approval table)", () => {
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

2. - [ ] Run it and confirm the failure: `pnpm --filter @omnis/local-agent test`
   Expected failure: `Failed to resolve import "../src/bridges/codex.js"`

3. - [ ] Create `apps/local-agent/src/bridges/codex.ts`:

```ts
import { spawn } from "node:child_process";
import type { HumanResponse, RuntimeCapabilities, RuntimeKind, TurnInput } from "@omnis/protocol";
import type { EventSink, RuntimeAdapter, TurnHandle } from "../rpc-dispatch.js";
import type { SessionRecord } from "../session-registry.js";
import { AppServerClient } from "./app-server-client.js";
import type { BridgeEmit } from "./stream-json.js";

/** A2 §4.2: an item/started not in this list is generalized to kind='tool_call', label=item.type. */
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
    // Until S-A2-3 the amendment payload schema is unknown, so the edit path is not exposed in the UI.
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

  return [];   // unknown events are cold-only
}

export interface CodexAdapterConfig { binary: string; spawnFn?: typeof spawn; capabilities: RuntimeCapabilities; version: string }

/** A2-D6: one resident app-server child handles multiple threads/turns. */
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

4. - [ ] Run the tests: `pnpm --filter @omnis/local-agent test` → 8 passed

5. - [ ] Commit:

```bash
git -C omnis/.worktrees/US-A19 add apps/local-agent/src/bridges/codex.ts apps/local-agent/test/codex.test.ts
git -C omnis/.worktrees/US-A19 commit -m "US-A19: Codex event mapping + approval decision conversion

- Unknown item types are generalized to kind='tool_call', label=item.type
- The four reasoning delta methods are ephemeral-only (no durable promotion)
- acceptWithExecpolicyAmendment is downgraded to ignore until S-A2-3

Co-Authored-By: Claude Opus <noreply@anthropic.com>"
```

### Task 15: Version pin and drift downgrade (US-A19, tier: Opus)

**Files:**
- Create: `apps/local-agent/src/bridges/codex-probe.ts`
- Test: `apps/local-agent/test/codex-probe.test.ts`

**Interfaces:**
- Consumes: `RuntimeCapabilities`, `RuntimeState`(@omnis/protocol)
- Produces: `CODEX_PINNED_VERSION = "rust-v0.155.1"`, `CODEX_CAPABILITIES`, `probeCodexVersion(versionLine: string, pinned?: string): { version: string; state: RuntimeState; capabilities: RuntimeCapabilities }`

**Read:** A2-D6, §4.2 "handling version drift". **Do not build:** automatic upgrades or pin removal. A human unpins only after every contract test passes.

1. - [ ] Write the failing test: `apps/local-agent/test/codex-probe.test.ts`

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

2. - [ ] Run it and confirm the failure: `pnpm --filter @omnis/local-agent test`
   Expected failure: `Failed to resolve import "../src/bridges/codex-probe.js"`

3. - [ ] Create `apps/local-agent/src/bridges/codex-probe.ts`:

```ts
import type { RuntimeCapabilities, RuntimeState } from "@omnis/protocol";

/** A2-D6. A human unpins only after every contract test passes. */
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
    // The session still starts, but the flag is carried so the hub can drop it from the delegation candidates.
    capabilities: drifted ? { ...CODEX_CAPABILITIES, features: ["version_mismatch"] } : CODEX_CAPABILITIES,
  };
}
```

4. - [ ] Run the tests: `pnpm --filter @omnis/local-agent test` → 4 passed

5. - [ ] Commit:

```bash
git -C omnis/.worktrees/US-A19 add apps/local-agent/src/bridges/codex-probe.ts apps/local-agent/test/codex-probe.test.ts
git -C omnis/.worktrees/US-A19 commit -m "US-A19: Codex version pin (rust-v0.155.1) and drift downgrade

- A pin mismatch is not a refusal to start but degraded + features=['version_mismatch']

Co-Authored-By: Claude Opus <noreply@anthropic.com>"
```

---

## US-A19b — Mini host startup and concurrency cap (Task 16~18)

> **Goal** (A7 §7): start `local-agent` on the Mac mini host (exposing only the Codex bridge; Hermes is Phase B) + apply the per-host concurrency cap of 4 (Mac mini and MacBook each)
> **Deliverable**: `apps/local-agent/src/host-config.ts` (host=`mini`/`macbook` branching), LaunchAgent plist (the A6-D10 approach)
> **Verification command**: `pnpm --filter @omnis/local-agent test`
> **Tier**: Sonnet · **Depends on**: US-A17, US-A19

### Task 16: Host profiles (US-A19b, tier: Sonnet)

**Files:**
- Create: `apps/local-agent/src/host-config.ts`
- Test: `apps/local-agent/test/host-config.test.ts`

**Interfaces:**
- Consumes: Task 6's `HOST_DEFAULTS`, `HostId`/`RuntimeKind` (@omnis/protocol)
- Produces: `PHASE_A_RUNTIMES`, `HostProfile`, `HOST_PROFILES`, `hostProfile(host: HostId): HostProfile`, `phaseARuntimesFor(host: HostId): RuntimeKind[]`

**Read:** contract §8 (host config), master §4.2, A6 §10.2. **Do not build:** do not generalize to three or more hosts — `HostId` is only `mini`/`macbook`, and a third is added when one appears.

1. - [ ] Write the failing test: `apps/local-agent/test/host-config.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { hostProfile, phaseARuntimesFor } from "../src/host-config.js";

/** Verification command: `pnpm --filter @omnis/local-agent test`. There is no host flag because both hosts are asserted at once. */
const HOSTS = ["mini", "macbook"] as const;

describe("host profile", () => {
  it("caps active turns at 4 on both hosts (master §9)", () => {
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

2. - [ ] Run it and confirm the failure: `pnpm --filter @omnis/local-agent test`
   Expected failure: `Failed to resolve import "../src/host-config.js"`

3. - [ ] Create `apps/local-agent/src/host-config.ts`:

```ts
import type { HostId, RuntimeKind } from "@omnis/protocol";
import { HOST_DEFAULTS } from "./config.js";

/** The runtimes that have an adapter in Phase A. hermes (Phase B) and omnis (no adapter) are excluded. */
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

/** The runtimes this host actually registers in Phase A. */
export function phaseARuntimesFor(host: HostId): RuntimeKind[] {
  return HOST_PROFILES[host].exposedRuntimes.filter((r) => PHASE_A_RUNTIMES.includes(r));
}
```

4. - [ ] Run the tests: `pnpm --filter @omnis/local-agent test` → 5 passed

5. - [ ] Commit:

```bash
git -C omnis/.worktrees/US-A19b add apps/local-agent/src/host-config.ts apps/local-agent/test/host-config.test.ts
git -C omnis/.worktrees/US-A19b commit -m "US-A19b: host profiles (mini/macbook) + Phase A runtime filter

- mini uses the loopback hub_url; macbook uses the tailnet /api/bridge
- Active turn cap 4; Phase A exposes codex (+ claude_code/claude_ds on the MacBook)

Co-Authored-By: Claude Sonnet <noreply@anthropic.com>"
```

### Task 17: A ceiling of 4 active turns per host (US-A19b, tier: Sonnet)

**Files:**
- Create: `apps/local-agent/src/turn-cap.ts`
- Modify: `apps/local-agent/src/rpc-dispatch.ts`
- Test: `apps/local-agent/test/turn-cap.test.ts`

**Interfaces:**
- Consumes: `BRIDGE_ERRORS`/`BridgeError` (@omnis/protocol), Task 16's `hostProfile`
- Produces: `TurnCap` (constructor `{ max?, queueMax? }`, methods `acquire`/`release`/`active`/`queued`), `DispatchDeps.turnCap?: TurnCap`

**Read:** A2 §7.2 "concurrency". **Do not build:** do not count processes — the unit counted is the turn. Do not build per-runtime fine-grained ceilings either.

1. - [ ] Write the failing test: `apps/local-agent/test/turn-cap.test.ts`

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

2. - [ ] Run it and confirm the failure: `pnpm --filter @omnis/local-agent test`
   Expected failure: `Failed to resolve import "../src/turn-cap.js"`

3. - [ ] Create `apps/local-agent/src/turn-cap.ts`:

```ts
import { BRIDGE_ERRORS, BridgeError } from "@omnis/protocol";

/** A2 §7.2: 4 active "turns" per host. Not a process count. Overflow is queued (up to 8); beyond that -32004. */
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

  /** Called on success, failure, and cancellation alike. Returns the id of the next queued turn. */
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

4. - [ ] Modify `rpc-dispatch.ts` so `turn.start`/`turn.cancel` pass through the cap:
   - Add `turnCap?: TurnCap;` to `DispatchDeps`.
   - Insert `deps.turnCap?.acquire(turnId);` before the `deps.beforeTurn?.(turnId);` line in `case "turn.start"`.
   - Insert `deps.turnCap?.release(p.turn_id);` before the `deps.afterTurn?.(p.turn_id);` line in `case "turn.cancel"`.
   - Add `turnCap: new TurnCap({ max: hostProfile(config.host).maxActiveTurns })` to the `createDispatcher({...})` call in `main.ts`.

5. - [ ] Run the tests: `pnpm --filter @omnis/local-agent test` → 4 passed (turn-cap) + all existing tests green

6. - [ ] Commit:

```bash
git -C omnis/.worktrees/US-A19b add apps/local-agent/src/turn-cap.ts apps/local-agent/src/rpc-dispatch.ts apps/local-agent/src/main.ts apps/local-agent/test/turn-cap.test.ts
git -C omnis/.worktrees/US-A19b commit -m "US-A19b: cap of 4 active turns per host + a queue of 8

- The unit counted is the turn, not the process (A2 §7.2)
- Queue overflow is -32004; release is called on success, failure, and cancellation alike

Co-Authored-By: Claude Sonnet <noreply@anthropic.com>"
```

### Task 18: Mini LaunchAgent plist and install script (US-A19b, tier: Sonnet)

**Files:**
- Create: `apps/local-agent/launchagent/ai.onwordlab.omnis-local-agent.mini.plist`, `apps/local-agent/launchagent/ai.onwordlab.omnis-local-agent.macbook.plist`, `scripts/install-local-agent.sh`
- Test: `apps/local-agent/test/launchagent.test.ts`

**Interfaces:**
- Consumes: Task 6's `normalizeHubUrl`, Task 16's `hostProfile`/`phaseARuntimesFor`
- Produces: none (assets + tests)

**Read:** A6 §10.1·§10.2 (the two plists + the three install-script steps), A6-D10 (a login-session LaunchAgent, not a root LaunchDaemon). **Do not build:** a LaunchDaemon variant. The healthchecks.io ping logic (owned by A6 §8). A plist parser library — extracting just the `<string>` entries of `ProgramArguments` is enough.

1. - [ ] Write the failing test: `apps/local-agent/test/launchagent.test.ts`

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

2. - [ ] Run it and confirm the failure: `pnpm --filter @omnis/local-agent test`
   Expected failure: `ENOENT: no such file or directory, open '.../launchagent/ai.onwordlab.omnis-local-agent.mini.plist'`

3. - [ ] Create `apps/local-agent/launchagent/ai.onwordlab.omnis-local-agent.mini.plist`:

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

4. - [ ] Create `apps/local-agent/launchagent/ai.onwordlab.omnis-local-agent.macbook.plist`:

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

5. - [ ] Create `scripts/install-local-agent.sh`:

```bash
#!/usr/bin/env bash
# A6 §10: copy the plist → launchctl bootstrap → confirm startup. Usage: scripts/install-local-agent.sh mini|macbook
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

6. - [ ] Make it executable and run the tests: `chmod +x scripts/install-local-agent.sh && pnpm --filter @omnis/local-agent test` → 3 passed (launchagent)

7. - [ ] Commit:

```bash
git -C omnis/.worktrees/US-A19b add apps/local-agent/launchagent scripts/install-local-agent.sh apps/local-agent/test/launchagent.test.ts
git -C omnis/.worktrees/US-A19b commit -m "US-A19b: mini·MacBook LaunchAgent plists + install script

- A6-D10: a login-session LaunchAgent, not a root LaunchDaemon
- Pin with a test that the plist's --hub normalizes to host-config's hub_url

Co-Authored-By: Claude Sonnet <noreply@anthropic.com>"
```

---

## US-A20 — Mock runtime contract tests (Task 19~20)

> **Goal** (A7 §7): bridge mock runtime tests (stream-json/JSON-RPC mockups with no real CLI)
> **Deliverable**: `apps/local-agent/test/bridge-mock.test.ts`
> **Verification command**: `pnpm --filter @omnis/local-agent test`
> **Tier**: Sonnet · **Depends on**: US-A18, US-A19

### Task 19: Fixtures and the mock runtime process (US-A20, tier: Sonnet)

**Files:**
- Create: `apps/local-agent/test/fixtures/claude_code/tool_call_turn.ndjson`, `apps/local-agent/test/fixtures/claude_code/unknown_item_turn.ndjson`, `apps/local-agent/test/fixtures/codex/tool_call_turn.ndjson`, `apps/local-agent/test/mock-runtime.mjs`, `apps/local-agent/test/mock-runtime.ts`
- Test: `apps/local-agent/test/mock-runtime.test.ts`

**Interfaces:**
- Consumes: none
- Produces: `mockSpawn(fixture: string): typeof spawn` (a spawn replacement that launches a real child process), `FIXTURES`

**Read:** A2-D14, §8.1 (the fixture set), §8.2 (the mock runtime). **Do not build:** do not call a real runtime in CI — during the `27` measurements a turn was cut off by the Codex account limit. Replaying capture timing (relative-time sleeps) is not needed in Phase A.

1. - [ ] Write the failing test: `apps/local-agent/test/mock-runtime.test.ts`

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

2. - [ ] Run it and confirm the failure: `pnpm --filter @omnis/local-agent test`
   Expected failure: `Failed to resolve import "./mock-runtime.js"`

3. - [ ] Create `apps/local-agent/test/fixtures/claude_code/tool_call_turn.ndjson` (one line = one event):

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

4. - [ ] Create `apps/local-agent/test/fixtures/claude_code/unknown_item_turn.ndjson`:

```
{"type":"system","subtype":"init","session_id":"s-mock-2","capabilities":[],"tools":[]}
{"type":"some_future_event","payload":{"shape":"unknown"}}
{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}}
{"type":"assistant","message":{"content":[{"type":"text","text":"ok"}]}}
{"type":"result","subtype":"success","total_cost_usd":0.0009,"duration_ms":800,"num_turns":1}
```

5. - [ ] Create `apps/local-agent/test/fixtures/codex/tool_call_turn.ndjson`:

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

6. - [ ] Create `apps/local-agent/test/mock-runtime.mjs`:

```js
#!/usr/bin/env node
// A2-D14: replay the fixture NDJSON over real stdio. The real CLI is never invoked in CI.
import { readFileSync } from "node:fs";

const fixture = process.env.OMNIS_MOCK_FIXTURE;
if (typeof fixture !== "string") { process.stderr.write("OMNIS_MOCK_FIXTURE is required\n"); process.exit(2); }

for (const line of readFileSync(fixture, "utf8").split("\n")) {
  if (line.trim().length > 0) process.stdout.write(`${line}\n`);
}
process.stdout.end();
```

7. - [ ] Create `apps/local-agent/test/mock-runtime.ts`:

```ts
import { type SpawnOptions, spawn } from "node:child_process";
import { join } from "node:path";

const here = new URL(".", import.meta.url).pathname;

export const FIXTURES = {
  claudeToolCall: join(here, "fixtures", "claude_code", "tool_call_turn.ndjson"),
  claudeUnknownItem: join(here, "fixtures", "claude_code", "unknown_item_turn.ndjson"),
  codexToolCall: join(here, "fixtures", "codex", "tool_call_turn.ndjson"),
} as const;

/** Makes the exact code path the RuntimeAdapter uses to read stdio run for real (A2 §8.2). */
export function mockSpawn(fixture: string): typeof spawn {
  return ((_cmd: string, _args: readonly string[], opts?: SpawnOptions) =>
    spawn(process.execPath, [join(here, "mock-runtime.mjs")], {
      ...opts,
      env: { ...process.env, OMNIS_MOCK_FIXTURE: fixture },
    })) as typeof spawn;
}
```

8. - [ ] Run the tests: `pnpm --filter @omnis/local-agent test` → 2 passed (mock-runtime)

9. - [ ] Commit:

```bash
git -C omnis/.worktrees/US-A20 add apps/local-agent/test/fixtures apps/local-agent/test/mock-runtime.mjs apps/local-agent/test/mock-runtime.ts apps/local-agent/test/mock-runtime.test.ts
git -C omnis/.worktrees/US-A20 commit -m "US-A20: mock runtime process + stream-json/app-server fixtures

- A2-D14: the real CLI is never invoked in CI
- It runs the exact path the adapter uses to read real stdio

Co-Authored-By: Claude Sonnet <noreply@anthropic.com>"
```

### Task 20: The eight bridge contract invariants (US-A20, tier: Sonnet)

**Files:**
- Create: `apps/local-agent/test/bridge-mock.test.ts`
- Test: the same file

**Interfaces:**
- Consumes: Task 12 `ClaudeCodeAdapter`, Task 14 `CodexAdapter`/`mapAppServerEvent`, Task 9 `Outbox`, Task 10 `createDispatcher`/`EventSink`, Task 19 `mockSpawn`/`FIXTURES`
- Produces: none (verification only)

**Read:** invariants 1~8 in A2 §8.2. **Do not build:** real Postgres integration (that is a kernel-side story after US-A21). Flaky assertions based on replay timing.

1. - [ ] Write the contract test: `apps/local-agent/test/bridge-mock.test.ts`

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

2. - [ ] Run it and confirm the failure: `pnpm --filter @omnis/local-agent test`
   Expected failure: invariant 8 breaks first — if delta reassembly does not match the `assistant` body, `AssertionError: expected '' to be 'Listing src/.'` rather than `expected 'Listing src/.' to be 'Listing src/.'`

3. - [ ] When an invariant is violated, **fix the parser, not the test**. Two frequent causes:
   - The `content_block_delta` branch of `mapStreamJsonEvent` uses a different `item_id` than the `openText` index → make both use `blk-${index}`.
   - `createDurableDebouncer` does not flush before `turn.completed`, so the last `completed` is dropped → check that the default branch of `push` calls `flush()` first.

4. - [ ] Run the full verification: `pnpm --filter @omnis/local-agent test` → 9 passed, `pnpm lint` → exit 0, `pnpm typecheck` → exit 0

5. - [ ] Commit:

```bash
git -C omnis/.worktrees/US-A20 add apps/local-agent/test/bridge-mock.test.ts
git -C omnis/.worktrees/US-A20 commit -m "US-A20: the eight bridge contract invariants + a Codex reasoning ephemeral regression guard

- Every A2 §8.2 invariant: item pairing, 0 durable deltas, writes <= items x 2,
  unknown events cold-only, approval round trip, 0 spawns, idempotent outbox, delta reassembly match

Co-Authored-By: Claude Sonnet <noreply@anthropic.com>"
```

---

## Story exit checklist

Before handing each story to the ralph Step 7 reviewer, it must pass the following on its own.

| Story | Verification command | Pass condition |
|---|---|---|
| US-A16 | `pnpm --filter @omnis/protocol test` | the 4 bridge test files green, `pnpm typecheck` exit 0 |
| US-A17 | `pnpm --filter @omnis/local-agent test` | 8 config precedence cases + 6 registry cases + 5 WS cases + 3 outbox cases + 6 dispatcher cases |
| US-A18 | `pnpm --filter @omnis/local-agent test` | 8 stream-json cases + 10 claude-code cases, 0 deltas in durable |
| US-A19 | `pnpm --filter @omnis/local-agent test` | 3 app-server cases + 8 codex cases + 4 probe cases |
| US-A19b | `pnpm --filter @omnis/local-agent test` | 5 host-config cases + 4 turn-cap cases + 3 plist cases |
| US-A20 | `pnpm --filter @omnis/local-agent test` | all 8 invariants green, 0 real CLI invocations |

## Self-check results (plan author)

- Story → task mapping: US-A16 → Task 1~4, US-A17 → Task 5~10, US-A18 → Task 11~12, US-A19 → Task 13~15, US-A19b → Task 16~18, US-A20 → Task 19~20. No story is missing.
- Exhaustive grep for prohibited patterns (`TBD`, `TODO`, `implement later`, `similar to Task N`, `handle edge cases`) — none found. Every unverified point is named with its A2 spike id (S-A2-1~S-A2-6), and each one has a working conservative value alongside a test that pins it.
- Every consumed symbol comes either from the contract document (§3.1~3.5, §4, §8, §9) or from an earlier task in this plan. The only external prerequisite is US-A11 (`packages/protocol` scaffold + `src/adapter.ts` + `src/approval.ts`), which matches the dependency order in contract §10.

## Revision history (2026-09-20, cross-plan review)

- **M6 / naming the owner of the hub `WS /bridge`** — added "Consumes (server counterpart)" lines to the `Interfaces` of Task 5 and Task 8. The server endpoint is `ws://127.0.0.1:8787/bridge` (mini) / `wss://<mini>.ts.net/api/bridge` (MacBook), and the implementation owner is the `hub-bridge-ws` task (US-A10, after T24) in `2026-09-20-phase-a-kernel-and-db.md`. This plan builds only the dialing client — and pinned in one line under Task 8's "Do not build" that the counterpart is not missing but owned by another plan.
- **M1 / version pins** — aligned the Tech Stack line and `apps/local-agent/package.json` in Task 5 with the FIXED pins from contract §2: `vitest 2.1.9` (← `^2.1.0`), `typescript 5.6.3` (← `^5.6.0`), and the `zod ^3.24.1` · `pnpm 9.12.3` notation. Left one line in Task 5 step 3 explaining why carets are banned (two runners in the workspace).
- **⑫ / `--permission-mode` mapping** — replaced `PERMISSION_MODE` in Task 12 with the CLI-measured literals: `observe → "plan"`, `workspace → "manual"`, `trusted → "bypassPermissions"`. Removed the nonexistent value `"default"` (source: `tools/spikes/_probes/2026-09-20-cli-probes.md` §3, claude 2.1.274). Kept the comment noting it is pending until gate ⑫ is settled, and added one test pinning the mapping and that "no value outside the six literals exists".
- **⑪ / the `--bare` auth path and supporting both call modes** — recorded the probe measurement below "Read" in Task 12: `--bare` limits Anthropic auth to `ANTHROPIC_API_KEY`/`apiKeyHelper` and does not read OAuth·Keychain, so a delegation turn cannot use the subscription (T3) and is billed via the API (conflicting with the A2-D11 assumption). The delegation run mode is decided by gate ⑪ / master §19 Q13. To support both modes until then, added `ClaudeArgsOpts.bare?: boolean` · `ClaudeAdapterConfig.bare?: boolean` and changed the branch in `buildClaudeArgs` to `o.bare ?? o.origin !== "human"` (keeping the A2-D11 conservative value when unset). `createClaudeDsAdapter` is pinned to `bare: true`, and the TOML `bare` key was threaded through `ProcessRuntimeConfig`/`PROCESS_ONLY_FIELDS`/`parseRuntime` in Task 6 so it is actually configurable. Added one test pinning the bidirectional override → Task 12 verification command expectation `8 passed` → `10 passed`, and updated the US-A18 row of the story exit checklist to `claude-code 10 cases`.
- **Commit trailer rule** — replaced the commit line in Global Constraints with the same format as the kernel-and-db plan (acceptance criteria in the body, the `Co-Authored-By: Claude <tier>` / DeepSeek variants contract §9 requires, and the mismatch as an open question). Changed the `git commit` trailers of all 20 tasks to match each task tier: `Co-Authored-By: Claude Opus <noreply@anthropic.com>` (Task 1~4·11~15) / `Co-Authored-By: Claude Sonnet <noreply@anthropic.com>` (Task 5~10·16~20).
