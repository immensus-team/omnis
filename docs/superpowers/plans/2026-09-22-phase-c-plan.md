# Phase C (capture channels + delegation + terminal import) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land every Phase C story from [`2026-09-22-phase-c-backlog.md`](2026-09-22-phase-c-backlog.md): W1 builds the three capture channels, real delegation execution, the allow rules, Hermes-as-target (off) and read-only terminal import on fixtures and mocks; W2 connects them to real accounts and hosts, one gate at a time.

**Architecture:** Capture channels are leaf adapter packages with an injected `*ClientLike` (the Telegram pattern). KakaoTalk and LinkedIn run inside `local-agent` on the mini's GUI session and reach the hub over the existing bridge WebSocket (`capture.items` / `capture.send`), where a `CaptureRelayAdapter` makes them look like any other `Adapter`. WhatsApp's adapter runs in the hub and talks HTTP/WS to Beeper. Delegation gets its missing execution half: `local-agent` finally builds its runtimes from TOML, the bridge executes a signed `delegate.run`, and a hub executor drives decided `delegate` approvals to the bridge and attaches results. Terminal import is a pull RPC (`sessions.import_scan`) behind a hub setting.

**Tech Stack:** TypeScript 5.6.3 strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) · Node 22 (`node:crypto`, `node:child_process`, global `fetch`) · zod ^3.24.1 · vitest 2.1.9 · pg 8.13.1 · React + `@omnis/ui` for UI · no new runtime dependency in W1.

**Spec:** `docs/superpowers/plans/2026-09-22-phase-c-backlog.md` (stories, decisions C-D1–C-D8, contract §3, gates §5) · `docs/spec/00-omnis-design.md` §8, §9, §12, §16, §19 · `docs/spec/A1-channel-adapters.md` §1.7, §2.6–§2.9, §3, §4 · `docs/spec/A2-agent-session-bridge.md` §4.4, §5, §6, §7 · `docs/spec/A4-agent-layer.md` §4.4, §5 · `docs/spec/A7-dev-process.md` §3–§4.

## Global Constraints

- English only in code, comments, tests, fixtures, docs, commits (repo `CLAUDE.md`). Fixtures with Korean text only where the test is about non-English input, and the `scenario` name says `non_english_…`.
- Version pins: `typescript 5.6.3`, `vitest 2.1.9`, `zod ^3.24.1`, `pg 8.13.1`. No new dependency in W1. `ws` is already in `apps/local-agent`; W2 may add `playwright` to `packages/adapters/linkedin` only.
- Migrations: only Task 0 creates one (`0015_phase_c.sql`). `0001`–`0014` are frozen; never edit them.
- New packages go into the root `tsconfig.json` `references` and follow `packages/adapters/telegram/{package.json,tsconfig.json,vitest.config.ts}` verbatim apart from the name.
- Tests use a per-branch DB `omnis_test_phase_c_<slug>` (`createdb`, then `DATABASE_URL=postgres://logankim@127.0.0.1:5432/omnis_test_phase_c_<slug> pnpm db:migrate`). Never the shared `omnis_test`.
- `pnpm lint && pnpm typecheck` green before every commit.
- No real account, Keychain value, `kmsg` process, browser, Beeper socket or Hermes connection in any W1 test. Never touch the mini's Hermes/omh/buzz or port 8642.
- No channel send and no delegation without a decided approval **and** a valid `verifyApproval()` signature.
- No hard delete anywhere. Deleted upstream messages normalize to `[]`.
- Fixtures that were not captured from a real account carry `"provenance": "synthetic-from-docs"`.
- Commit header `<story-id>: <summary>`; trailers per `ops/ds-pipeline/COMMON.md`, plus `Reviewed-by: Claude Opus 5` once the review passes.

## Execution protocol (DeepSeek implements, Opus reviews)

Every W1 task is one DeepSeek run and one Opus review.

1. Orchestrator (Opus, main worktree) creates a sibling worktree per task: `git worktree add ../omnis.plan-phase-c-<slug> -b plan/phase-c-<slug> main` (after the task's dependencies are merged).
2. Writes the task file `ops/ds-pipeline/tasks/phase-c-T<NN>.md` = this plan's `### Task NN` section verbatim + the per-branch DB name.
3. Implementer: from the worktree,
   ```bash
   export PATH=/opt/homebrew/bin:$PATH
   claude-ds -p "$(cat ops/ds-pipeline/COMMON.md)

   # TASK
   $(cat ops/ds-pipeline/tasks/phase-c-T<NN>.md)" \
     --permission-mode bypassPermissions --strict-mcp-config --output-format json \
     > ~/AI-Workspaces/Claude/omnis/ds/logs/phase-c-T<NN>-impl.json
   ```
   (`DS_MODEL=deepseek-v4-pro` for Tasks 2, 3, 4, 6, 12, 14 — the THOROUGH ones.) Ignore `total_cost_usd`.
4. Reviewer: a fresh Opus context (`Agent` subagent `oh-my-claudecode:code-reviewer`, `model: opus`), never the implementer's. It re-runs the task's verification commands plus `pnpm lint && pnpm typecheck`, reads the full diff against `main`, checks every acceptance bullet, and for THOROUGH tasks also checks: signature verification cannot be bypassed, paths are `realpath`-checked, no secret reaches a log/event/error, no file outside the declared globs is opened. Verdict JSON `{approved, issues[], notes[]}`.
5. Rejected → the issues go back to step 3 as "PREVIOUS ATTEMPT REJECTED". Three rejections → rerun the task with `claude -p --model sonnet`, three more → Opus implements; three Opus failures → stop and ask Logan (A7 §3).
6. Approved → orchestrator merges `--no-ff` to `main`, reruns the verification command on `main`, removes the worktree.

## File structure

| Path | Responsibility | Task |
|---|---|---|
| `packages/db/migrations/0015_phase_c.sql` | settings + jobs seeds | 0 |
| `packages/protocol/src/delegation.ts` | `canonicalJson`, `signApproval`, `verifyApproval` | 0 |
| `packages/protocol/src/bridge.ts` | new methods + schemas | 0 |
| `apps/local-agent/src/runtimes.ts` | TOML → runtime adapters → registration | 1 |
| `apps/local-agent/src/delegate.ts` | execute a signed brief, re-run `verify` | 2 |
| `apps/hub/src/delegate-exec.ts` | decided `delegate` approval → bridge → result attachment | 3 |
| `packages/kernel/src/delegation-rules.ts` | `delegationAllowed()` over `delegation.allow_rules` | 4 |
| `apps/desktop/src/screens/settings/DelegationRules.tsx` | Settings → Autonomy → Delegation | 5 |
| `apps/local-agent/src/bridges/hermes.ts` | delegation origin + approval mapping | 6 |
| `packages/agents/src/{delegate/route,loops/delegate,tools/propose}.ts` | `hermes` as a routable runtime | 7 |
| `packages/adapters/kakaotalk/**` | kmsg adapter | 8 |
| `packages/adapters/linkedin/src/email.ts`, `apps/hub/src/linkedin-email-hook.ts` | notification-email signal | 9 |
| `packages/adapters/linkedin/src/{index,page}.ts` | Playwright-shaped adapter | 10 |
| `packages/adapters/whatsapp/**` | Beeper adapter | 11 |
| `apps/local-agent/src/capture.ts`, `apps/hub/src/capture-relay.ts` | capture sidecar + relay adapter | 12 |
| `packages/kernel/src/kakao-send.ts` | 14-day gate + dry-run-first | 13 |
| `apps/local-agent/src/import/{claude-jsonl,codex-rollout}.ts` | terminal session parsers | 14, 15 |
| `apps/hub/src/terminal-import.ts` | import job + read-only sessions | 16 |
| `packages/kernel/src/jobs/followup-miss.ts`, `packages/ui/src/components/composer-state.tsx` | exit metric + composer honesty | 17 |
| `ops/mini/com.omnis.{kakaotalk,beeper}.plist` + ops edits | mini service definitions | 18 |

## Waves

- **W1a** (serial): Task 0.
- **W1b** (parallel): Tasks 1, 8, 9, 11.
- **W1c** (parallel): Tasks 2, 10, 14.
- **W1d** (parallel): Tasks 3, 6, 12, 15.
- **W1e** (parallel): Tasks 4, 13, 16.
- **W1f** (parallel): Tasks 5, 7, 17, 18.
- **W2**: Tasks 19–31, each started only when its gate row in backlog §5 flips.

---

# W1 — FIXTURE-FIRST

### Task 0: Contract bundle (US-C00)

**Files:**
- Create: `packages/db/migrations/0015_phase_c.sql`
- Create: `packages/protocol/src/delegation.ts`, `packages/protocol/test/delegation.test.ts`
- Modify: `packages/protocol/src/bridge.ts` (method lists, schemas), `packages/protocol/src/index.ts` (export `./delegation.js`)
- Modify: `packages/kernel/src/settings.ts` (`SettingKey`, `SETTING_DEFAULTS`), `packages/kernel/test/settings.test.ts`
- Modify: `apps/hub/src/bridge.ts:128–146` (`onRegister` returns `{ runtime_id }`), `apps/hub/src/bridge.ts:385–388` (`runtime.registered` returns that value)

**Interfaces:**
- Produces: `canonicalJson(v: unknown): string`; `signApproval(token: string, approvalId: string, payload: unknown): string`; `verifyApproval(token: string, approvalId: string, payload: unknown, sig: string): boolean`; zod `CaptureItemsParams`, `CaptureSendParams`, `ImportScanParams`, `ImportedTurn`, `ImportedSession`, `ImportScanResult`, `DelegateRunParams`, `RuntimeRegisteredResult`; `SettingKey` += `"delegation.allow_rules" | "delegation.hermes_enabled" | "import.terminal_sessions" | "kakao.read_stable_since"`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/protocol/test/delegation.test.ts
import { describe, expect, it } from "vitest";
import { canonicalJson, signApproval, verifyApproval } from "../src/delegation.js";

const id = "7f1c2a4e-3b7d-4c55-9a0e-2d6f1e8b9c01";
const brief = { goal: "g", target: { runtime: "claude_ds", host: "macbook", cwd: "/r" }, inputs: [] };

describe("approval signatures", () => {
  it("canonicalJson sorts keys at every depth", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 0 }] } })).toBe(
      '{"a":{"c":[3,{"e":0,"f":1}],"d":2},"b":1}',
    );
  });
  it("a signature verifies for the same token, id and payload in any key order", () => {
    const sig = signApproval("tok", id, brief);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    const reordered = { inputs: [], target: { cwd: "/r", host: "macbook", runtime: "claude_ds" }, goal: "g" };
    expect(verifyApproval("tok", id, reordered, sig)).toBe(true);
  });
  it("rejects another token, another id, a changed payload, and garbage", () => {
    const sig = signApproval("tok", id, brief);
    expect(verifyApproval("other", id, brief, sig)).toBe(false);
    expect(verifyApproval("tok", id.replace("01", "02"), brief, sig)).toBe(false);
    expect(verifyApproval("tok", id, { ...brief, goal: "h" }, sig)).toBe(false);
    expect(verifyApproval("tok", id, brief, "zz")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it** — `pnpm --filter @omnis/protocol test -- delegation` → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// packages/protocol/src/delegation.ts
// A2 §5.1: the bridge accepts delegate.run / capture.send only with an approval the hub signed.
// Both ends already hold the bridge token (omnis.bridge.token.<host>), so an HMAC needs no new secret.
import { createHmac, timingSafeEqual } from "node:crypto";

export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

export function signApproval(token: string, approvalId: string, payload: unknown): string {
  return createHmac("sha256", token).update(`${approvalId}\n${canonicalJson(payload)}`).digest("hex");
}

export function verifyApproval(token: string, approvalId: string, payload: unknown, sig: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(sig)) return false;
  const want = Buffer.from(signApproval(token, approvalId, payload), "hex");
  return timingSafeEqual(want, Buffer.from(sig, "hex"));
}
```

Append to `packages/protocol/src/bridge.ts` (import `Channel`, `NormalizedItem`, `AdapterEvent` from `./adapter.js`):

```ts
// --- Phase C (backlog §3) ---
export const RuntimeRegisteredResult = z.object({ runtime_id: z.string().uuid() });
export const DelegateRunParams = z.object({ brief: DelegationBrief, sig: z.string() });
export const CaptureItemsParams = z.object({
  channel: z.enum(["kakaotalk", "linkedin"]),
  account_external_id: z.string().min(1),
  events: z.array(z.union([NormalizedItem, AdapterEvent])).min(1).max(200),
});
export const CaptureSendParams = z.object({
  channel: z.enum(["kakaotalk", "linkedin"]),
  approval_id: z.string().uuid(),
  sig: z.string(),
  thread_external_id: z.string().min(1),
  text: z.string().min(1).max(4000),
  dry_run: z.boolean(),
});
export const ImportScanParams = z.object({
  since: z.string().datetime().nullable(),
  max_sessions: z.number().int().positive().max(200).default(50),
});
export const ImportedTurn = z.object({
  source_id: z.string().min(1),
  role: z.enum(["user", "agent"]),
  at: z.string().datetime(),
  text: z.string().max(1000),
  tool_calls: z.array(z.string()),
});
export const ImportedSession = z.object({
  runtime: z.enum(["claude_code", "codex"]),
  source_id: z.string().min(1),
  cwd: z.string().min(1),
  started_at: z.string().datetime(),
  turns: z.array(ImportedTurn),
});
export const ImportScanResult = z.object({ sessions: z.array(ImportedSession) });
export type ImportedSession = z.infer<typeof ImportedSession>;
export type ImportedTurn = z.infer<typeof ImportedTurn>;
```

Add `"capture.send"`, `"sessions.import_scan"` to `HUB_METHODS` and `"capture.items"` to `BRIDGE_METHODS`; change the `BRIDGE_METHODS` comment to "approval.requested and runtime.registered are requests; the rest are notifications".

```sql
-- packages/db/migrations/0015_phase_c.sql
-- Phase C contract bundle (backlog §3). Settings are off by default; jobs are no-ops until their flags flip.
INSERT INTO settings (key, value) VALUES
  ('delegation.allow_rules', '[]'),
  ('delegation.hermes_enabled', 'false'),
  ('import.terminal_sessions', 'false'),
  ('kakao.read_stable_since', 'null')
ON CONFLICT (key) DO NOTHING;

INSERT INTO jobs (name, schedule, next_run_at) VALUES
  ('terminal_import', '*/5 * * * *', now()),
  ('followup_miss',   '15 23 * * *', now())
ON CONFLICT (name) DO NOTHING;
```

Kernel settings: add the four keys to `SettingKey` and `SETTING_DEFAULTS` (`[]`, `false`, `false`, `null`). Hub `onRegister`: end the upsert with `RETURNING id` and return `{ runtime_id }`; `dispatch` returns it for `runtime.registered`.

- [ ] **Step 4: Run** — `pnpm --filter @omnis/protocol test && pnpm --filter @omnis/kernel test && pnpm --filter @omnis/hub test` → PASS; `DATABASE_URL=$TEST_DB pnpm db:migrate` applies `0015` once and is a no-op the second time.

- [ ] **Step 5: Commit** — `git add -A packages/protocol packages/kernel packages/db/migrations/0015_phase_c.sql apps/hub/src/bridge.ts && git commit -m "US-C00: Phase C contract bundle"`

---

### Task 1: local-agent runtime bootstrap (US-C01)

**Files:**
- Create: `apps/local-agent/src/runtimes.ts`, `apps/local-agent/test/runtimes.test.ts`
- Modify: `apps/local-agent/src/main.ts` (use `buildRuntimes` + `registerRuntimes` instead of the three empty maps)

**Interfaces:**
- Consumes: `RuntimeConfig`/`LocalAgentConfig` (`config.ts`), `ClaudeCodeAdapter`, `createClaudeDsAdapter`, `CodexAdapter` + `probeCodexVersion`, `HermesAdapter`, `readKeychainSecret`, `RuntimeRegisteredResult` (Task 0).
- Produces:
  ```ts
  export interface BuiltRuntime { kind: RuntimeKind; adapter: RuntimeAdapter; allowedRoots: string[];
    version: string; capabilities: RuntimeCapabilities; state: RuntimeState; transport: "process" | "http"; }
  export interface RuntimeFactoryDeps { readSecret(item: string): Promise<string>; logger: Logger;
    make?: (c: RuntimeConfig, secret: string | null) => RuntimeAdapter; }
  export async function buildRuntimes(cfgs: RuntimeConfig[], deps: RuntimeFactoryDeps): Promise<BuiltRuntime[]>;
  export async function registerRuntimes(client: { request(m: "runtime.registered", p: Record<string, unknown>): Promise<unknown> },
    host: HostId, built: BuiltRuntime[]): Promise<Map<RuntimeKind, string>>;
  ```

- [ ] **Step 1: Failing test**

```ts
// apps/local-agent/test/runtimes.test.ts
import { describe, expect, it, vi } from "vitest";
import type { RuntimeAdapter } from "../src/rpc-dispatch.js";
import { buildRuntimes, registerRuntimes } from "../src/runtimes.js";

const logger = { debug() {}, info() {}, warn: vi.fn(), error: vi.fn() };
const caps = { resume: true, cross_project_resume: false, stream_deltas: true, reasoning_stream: false,
  tool_calls: true, approvals: "native" as const, cancel: true, models: [], features: [] };
const fake = (kind: RuntimeAdapter["kind"], fail = false): RuntimeAdapter => ({
  kind,
  probe: fail ? () => Promise.reject(new Error("binary missing")) : () => Promise.resolve({ version: `${kind} 1`, capabilities: caps }),
  startTurn: vi.fn(), cancel: vi.fn(), close: vi.fn(),
});

describe("buildRuntimes", () => {
  it("builds one adapter per [[runtime]] block and keeps its allowed_roots", async () => {
    const built = await buildRuntimes(
      [
        { kind: "codex", binary: "/bin/codex", allowed_roots: ["/r/a"] },
        { kind: "hermes", base_url: "http://127.0.0.1:9", token_keychain_item: "omnis.hermes.token.macbook", session_header_mode: "hermes_v1" },
      ],
      { readSecret: async () => "s", logger, make: (c) => fake(c.kind) },
    );
    expect(built.map((b) => [b.kind, b.state, b.transport])).toEqual([["codex", "online", "process"], ["hermes", "online", "http"]]);
    expect(built[0]?.allowedRoots).toEqual(["/r/a"]);
    expect(built[1]?.allowedRoots).toEqual([]);
  });
  it("a failed probe registers the runtime as degraded instead of throwing", async () => {
    const built = await buildRuntimes([{ kind: "claude_code", binary: "/nope", allowed_roots: [] }],
      { readSecret: async () => "s", logger, make: (c) => fake(c.kind, true) });
    expect(built[0]?.state).toBe("degraded");
    expect(logger.warn).toHaveBeenCalled();
  });
  it("a secret that cannot be read drops only that runtime", async () => {
    const built = await buildRuntimes([{ kind: "claude_ds", binary: "/bin/claude-ds", allowed_roots: [] }],
      { readSecret: async () => { throw new Error("locked"); }, logger, make: (c) => fake(c.kind) });
    expect(built).toEqual([]);
  });
});

describe("registerRuntimes", () => {
  it("maps each runtime to the id the hub returned", async () => {
    const request = vi.fn().mockResolvedValueOnce({ runtime_id: "11111111-1111-4111-8111-111111111111" });
    const ids = await registerRuntimes({ request }, "macbook", [
      { kind: "codex", adapter: fake("codex"), allowedRoots: ["/r"], version: "v", capabilities: caps, state: "online", transport: "process" },
    ]);
    expect(ids.get("codex")).toBe("11111111-1111-4111-8111-111111111111");
    expect(request).toHaveBeenCalledWith("runtime.registered", expect.objectContaining({ runtime: "codex", host: "macbook", state: "online" }));
  });
});
```

- [ ] **Step 2:** `pnpm --filter @omnis/local-agent test -- runtimes` → FAIL.

- [ ] **Step 3: Implement**

```ts
// apps/local-agent/src/runtimes.ts
// A2 §2.1: the [[runtime]] blocks are the only source of runtimes. A runtime that cannot probe is still
// registered (as degraded) so the hub can show it and routing can skip it; one that cannot read its
// secret is left out entirely, because it could never run a turn.
import { spawn } from "node:child_process";
import { type HostId, RuntimeRegisteredResult, type RuntimeCapabilities, type RuntimeKind, type RuntimeState } from "@omnis/protocol";
import { ClaudeCodeAdapter, createClaudeDsAdapter } from "./bridges/claude-code.js";
import { CodexAdapter } from "./bridges/codex.js";
import { CODEX_CAPABILITIES, probeCodexVersion } from "./bridges/codex-probe.js";
import { HermesAdapter } from "./bridges/hermes.js";
import type { RuntimeConfig } from "./config.js";
import type { Logger } from "./logger.js";
import type { RuntimeAdapter } from "./rpc-dispatch.js";

export interface BuiltRuntime {
  kind: RuntimeKind; adapter: RuntimeAdapter; allowedRoots: string[];
  version: string; capabilities: RuntimeCapabilities; state: RuntimeState; transport: "process" | "http";
}
export interface RuntimeFactoryDeps {
  readSecret(item: string): Promise<string>;
  logger: Logger;
  make?: (c: RuntimeConfig, secret: string | null) => RuntimeAdapter;
}

const DEEPSEEK_KEY_ITEM = "deepseek-api"; // A2 §4.3

function codexVersionLine(binary: string): Promise<string> {
  return new Promise((resolve) => {
    const c = spawn(binary, ["--version"]);
    let out = "";
    c.stdout.on("data", (d: Buffer) => { out += d.toString("utf8"); });
    c.on("error", () => resolve(""));
    c.on("close", () => resolve(out.trim()));
  });
}

async function defaultMake(c: RuntimeConfig, secret: string | null): Promise<RuntimeAdapter> {
  switch (c.kind) {
    case "claude_code":
      return new ClaudeCodeAdapter({ kind: "claude_code", binary: c.binary, defaultModel: c.default_model ?? "sonnet",
        ...(c.bare === undefined ? {} : { bare: c.bare }) });
    case "claude_ds":
      return createClaudeDsAdapter({ binary: c.binary, apiKey: secret ?? "", ...(c.default_model ? { model: c.default_model } : {}) });
    case "codex": {
      const p = probeCodexVersion(await codexVersionLine(c.binary), c.pinned_version);
      return new CodexAdapter({ binary: c.binary, capabilities: p.capabilities ?? CODEX_CAPABILITIES, version: p.version });
    }
    case "hermes":
      return new HermesAdapter({ baseUrl: c.base_url, token: secret ?? "" });
  }
}

function secretItem(c: RuntimeConfig): string | null {
  if (c.kind === "claude_ds") return DEEPSEEK_KEY_ITEM;
  if (c.kind === "hermes") return c.token_keychain_item;
  return null;
}

export async function buildRuntimes(cfgs: RuntimeConfig[], deps: RuntimeFactoryDeps): Promise<BuiltRuntime[]> {
  const out: BuiltRuntime[] = [];
  for (const c of cfgs) {
    let secret: string | null = null;
    const item = secretItem(c);
    if (item !== null) {
      try { secret = await deps.readSecret(item); }
      catch (e) { deps.logger.error("runtime skipped: secret unreadable", { runtime: c.kind, item }); continue; }
    }
    const adapter = deps.make ? deps.make(c, secret) : await defaultMake(c, secret);
    const allowedRoots = c.kind === "hermes" ? [] : c.allowed_roots;
    const transport = c.kind === "hermes" ? "http" : "process";
    try {
      const p = await adapter.probe();
      out.push({ kind: c.kind, adapter, allowedRoots, version: p.version, capabilities: p.capabilities, state: "online", transport });
    } catch (e) {
      deps.logger.warn("runtime probe failed; registering as degraded", { runtime: c.kind, err: e instanceof Error ? e.message : String(e) });
      out.push({ kind: c.kind, adapter, allowedRoots, version: "unknown",
        capabilities: { resume: false, cross_project_resume: false, stream_deltas: false, reasoning_stream: false,
          tool_calls: false, approvals: "none", cancel: false, models: [], features: ["probe_failed"] },
        state: "degraded", transport });
    }
  }
  return out;
}

export async function registerRuntimes(
  client: { request(m: "runtime.registered", p: Record<string, unknown>): Promise<unknown> },
  host: HostId, built: BuiltRuntime[],
): Promise<Map<RuntimeKind, string>> {
  const ids = new Map<RuntimeKind, string>();
  for (const b of built) {
    const res = RuntimeRegisteredResult.parse(await client.request("runtime.registered", {
      runtime: b.kind, host, version: b.version, capabilities: b.capabilities, state: b.state, display: `${b.kind}@${host}`,
    }));
    ids.set(b.kind, res.runtime_id);
  }
  return ids;
}
```

In `main.ts`: build before the client, register in `onOpen` (every reconnect re-registers, which the hub upsert tolerates), and pass live maps:

```ts
const built = await buildRuntimes(config.runtimes, { readSecret: readKeychainSecret, logger });
const adapters = new Map(built.map((b) => [b.kind, b.adapter] as const));
const allowedRoots = new Map(built.map((b) => [b.kind, b.allowedRoots] as const));
const runtimeIds = new Map<RuntimeKind, string>();
// … createDispatcher({ registry, adapters, allowedRoots, runtimeIds, … })
onOpen: async () => {
  for (const [k, v] of await registerRuntimes(client, config.host, built)) runtimeIds.set(k, v);
  await outbox.drain(async (e) => { client.notify(e.method, e.params); });
},
```

- [ ] **Step 4:** `pnpm --filter @omnis/local-agent test && pnpm --filter @omnis/hub test` → PASS.
- [ ] **Step 5:** `git commit -m "US-C01: local-agent builds and registers its runtimes from TOML"`

---

### Task 2: Bridge `delegate.run` execution (US-C02, THOROUGH)

**Files:**
- Create: `apps/local-agent/src/delegate.ts`, `apps/local-agent/test/delegate.test.ts`
- Modify: `apps/local-agent/src/rpc-dispatch.ts:185–200` (call `runDelegation`), `DispatchDeps` gains `token: string`
- Modify: `apps/local-agent/src/main.ts` (pass the bridge token)

**Interfaces:**
- Consumes: `DelegateRunParams`, `verifyApproval` (Task 0), `assertPathAllowed`, `SessionRegistry`, `RuntimeAdapter`, `EventSink`.
- Produces:
  ```ts
  export interface VerifyResult { exitCode: number | null; tail: string; timedOut: boolean }
  export type RunVerify = (cmd: string, cwd: string, timeoutMs: number) => Promise<VerifyResult>;
  export function renderDelegationPrompt(b: DelegationBriefT, cwd: string): string;
  export async function runDelegation(params: unknown, deps: DelegationDeps): Promise<{ session_key: string; turn_id: string }>;
  ```
  `session_key` = `agent:<runtime>:<host>:delegation-<approval_id first 8>`.

- [ ] **Step 1: Failing test**

```ts
// apps/local-agent/test/delegate.test.ts
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signApproval } from "@omnis/protocol";
import { describe, expect, it, vi } from "vitest";
import { renderDelegationPrompt, runDelegation } from "../src/delegate.js";
import type { EventSink, RuntimeAdapter } from "../src/rpc-dispatch.js";
import { SessionRegistry } from "../src/session-registry.js";

const TOKEN = "bridge-token";
// assertPathAllowed realpaths the cwd, so it has to exist.
const ROOT = realpathSync(mkdtempSync(join(tmpdir(), "deleg-")));
const CWD = join(ROOT, "omnis");
mkdirSync(CWD);
const brief = {
  approval_id: "7f1c2a4e-3b7d-4c55-9a0e-2d6f1e8b9c01",
  target: { runtime: "claude_ds", host: "macbook", cwd: CWD },
  goal: "Fix the flaky test", inputs: [join(CWD, "a.ts")], verify: "pnpm test", output: "diff", timeout_ms: 60_000,
};
function harness(verifyExit = 0) {
  const events: Array<[string, Record<string, unknown>]> = [];
  const sink: EventSink = {
    itemStarted: (e) => events.push(["itemStarted", e]), delta: () => {}, turnStarted: (e) => events.push(["turnStarted", e]),
    itemCompleted: (e) => events.push(["itemCompleted", e]), turnCompleted: (e) => events.push(["turnCompleted", e]),
    approval: vi.fn(), raw: () => {},
  };
  let finish: (() => void) | undefined;
  const adapter: RuntimeAdapter = {
    kind: "claude_ds", probe: vi.fn(),
    startTurn: vi.fn(async (s, _i, sk) => { finish = () => sk.turnCompleted({ session_key: s.session_key, turn_id: "t1", status: "ok", usage: { cost_usd: null, duration_ms: 1, num_turns: 1 } }); return { turn_id: "t1", cancel: async () => true }; }),
    cancel: vi.fn(async () => true), close: vi.fn(),
  };
  const runVerify = vi.fn(async () => ({ exitCode: verifyExit, tail: verifyExit === 0 ? "ok" : "1 failed", timedOut: false }));
  const deps = { token: TOKEN, host: "macbook" as const, registry: new SessionRegistry(), adapterFor: () => adapter,
    allowedRoots: new Map([["claude_ds" as const, [ROOT]]]), runtimeIds: new Map([["claude_ds" as const, "11111111-1111-4111-8111-111111111111"]]),
    sinkFor: () => sink, runVerify, logger: { debug() {}, info() {}, warn() {}, error() {} } };
  return { deps, adapter, events, runVerify, done: async () => { finish?.(); await new Promise((r) => setTimeout(r, 0)); } };
}

describe("runDelegation", () => {
  it("refuses a missing or forged signature with -32006", async () => {
    const { deps } = harness();
    await expect(runDelegation({ brief }, deps)).rejects.toMatchObject({ code: -32006 });
    await expect(runDelegation({ brief, sig: signApproval("wrong", brief.approval_id, brief) }, deps)).rejects.toMatchObject({ code: -32006 });
    await expect(runDelegation({ brief: { ...brief, goal: "tampered" }, sig: signApproval(TOKEN, brief.approval_id, brief) }, deps)).rejects.toMatchObject({ code: -32006 });
  });
  it("refuses a cwd outside allowed_roots with -32005", async () => {
    const { deps } = harness();
    const b = { ...brief, target: { ...brief.target, cwd: "/etc" } };
    await expect(runDelegation({ brief: b, sig: signApproval(TOKEN, b.approval_id, b) }, deps)).rejects.toMatchObject({ code: -32005 });
  });
  it("opens a workspace-profile delegation session and sends the A2 §5.2 prompt", async () => {
    const { deps, adapter } = harness();
    const r = await runDelegation({ brief, sig: signApproval(TOKEN, brief.approval_id, brief) }, deps);
    expect(r.session_key).toBe("agent:claude_ds:macbook:delegation-7f1c2a4e");
    const [session, input] = (adapter.startTurn as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    expect(session).toMatchObject({ origin: "delegation", permission_profile: "workspace", cwd: CWD });
    expect(input.text).toBe(renderDelegationPrompt(brief as never, CWD));
    expect(input.text).toContain("VERIFY: run `pnpm test`; it must exit 0 before you report done.");
  });
  it("re-runs verify after the turn and reports it as a tool_call item; exit != 0 fails the turn", async () => {
    const { deps, events, runVerify, done } = harness(1);
    await runDelegation({ brief, sig: signApproval(TOKEN, brief.approval_id, brief) }, deps);
    await done();
    expect(runVerify).toHaveBeenCalledWith("pnpm test", CWD, 60_000);
    const verifyItem = events.find(([k, e]) => k === "itemCompleted" && e.kind === "tool_call");
    expect(verifyItem?.[1]).toMatchObject({ status: "failed", body: "1 failed", meta: { label: "verify", exit_code: 1 } });
    expect(events.at(-1)).toEqual(["turnCompleted", expect.objectContaining({ status: "failed" })]);
  });
});
```

- [ ] **Step 2:** `pnpm --filter @omnis/local-agent test -- delegate` → FAIL.

- [ ] **Step 3: Implement**

```ts
// apps/local-agent/src/delegate.ts
// A2 §5: the only path by which a runtime works for omnis. Signature first, path second, then a
// workspace-profile session; the bridge re-runs `verify` itself because a runtime saying "done" is not proof.
import { execFile } from "node:child_process";
import { BRIDGE_ERRORS, BridgeError, DelegateRunParams, type HostId, type RuntimeKind, verifyApproval } from "@omnis/protocol";
import type { z } from "zod";
import type { Logger } from "./logger.js";
import { assertPathAllowed } from "./paths.js";
import type { EventSink, RuntimeAdapter } from "./rpc-dispatch.js";
import type { SessionRecord, SessionRegistry } from "./session-registry.js";

export type DelegationBriefT = z.infer<typeof DelegateRunParams>["brief"];
export interface VerifyResult { exitCode: number | null; tail: string; timedOut: boolean }
export type RunVerify = (cmd: string, cwd: string, timeoutMs: number) => Promise<VerifyResult>;
export interface DelegationDeps {
  token: string; host: HostId; registry: SessionRegistry; logger: Logger;
  adapterFor(kind: RuntimeKind): RuntimeAdapter;
  allowedRoots: Map<RuntimeKind, string[]>; runtimeIds: Map<RuntimeKind, string>;
  sinkFor(s: SessionRecord, turnId: string): EventSink;
  runVerify?: RunVerify;
}

const TAIL_BYTES = 4096; // A2 §5.4

export const defaultRunVerify: RunVerify = (cmd, cwd, timeoutMs) =>
  new Promise((resolve) => {
    execFile("/bin/sh", ["-c", cmd], { cwd, timeout: timeoutMs, killSignal: "SIGTERM", maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const out = `${stdout}${stderr}`;
        const e = err as (NodeJS.ErrnoException & { code?: number | string; killed?: boolean }) | null;
        resolve({ exitCode: e === null ? 0 : typeof e.code === "number" ? e.code : null,
          tail: out.slice(-TAIL_BYTES), timedOut: e?.killed === true });
      });
  });

export function renderDelegationPrompt(b: DelegationBriefT, cwd: string): string {
  return [
    `[omnis delegation · approval ${b.approval_id}]`,
    `GOAL: ${b.goal}`,
    `INPUTS: ${b.inputs.join("\n")}`,
    `VERIFY: run \`${b.verify}\`; it must exit 0 before you report done.`,
    `OUTPUT: ${b.output}${b.output_path ? ` at ${b.output_path}` : ""}`,
    `Do not send messages, do not modify files outside ${cwd}.`,
  ].join("\n");
}

export async function runDelegation(params: unknown, deps: DelegationDeps): Promise<{ session_key: string; turn_id: string }> {
  const raw = params as { brief?: { approval_id?: unknown }; sig?: unknown };
  const approvalId = typeof raw.brief?.approval_id === "string" ? raw.brief.approval_id : "";
  // Verify over the object exactly as received — zod defaults must not change what was signed.
  if (typeof raw.sig !== "string" || approvalId === "" || !verifyApproval(deps.token, approvalId, raw.brief, raw.sig)) {
    deps.logger.error("delegate.run with an invalid signature", { host: deps.host });
    throw new BridgeError(BRIDGE_ERRORS.APPROVAL_REQUIRED, "delegate.run requires a hub-signed approval");
  }
  const { brief } = DelegateRunParams.parse(params);
  if (brief.target.host !== deps.host) throw new BridgeError(BRIDGE_ERRORS.PATH_NOT_ALLOWED, `brief targets ${brief.target.host}`);
  const kind = brief.target.runtime;
  const adapter = deps.adapterFor(kind);
  const cwd = assertPathAllowed(brief.target.cwd, deps.allowedRoots.get(kind) ?? []);
  const runtimeId = deps.runtimeIds.get(kind);
  if (runtimeId === undefined) throw new BridgeError(BRIDGE_ERRORS.RUNTIME_UNAVAILABLE, `runtime not registered: ${kind}`);

  const id8 = brief.approval_id.slice(0, 8);
  const sessionKey = `agent:${kind}:${deps.host}:delegation-${id8}`;
  const rec = deps.registry.create({ session_key: sessionKey, runtime: kind, runtime_id: runtimeId, cwd,
    purpose: `delegation-${id8}`, origin: "delegation", permission_profile: "workspace", opened_at: new Date().toISOString() });
  const outer = deps.sinkFor(rec, `d-${id8}`);
  const runVerify = deps.runVerify ?? defaultRunVerify;
  let settled = false;
  // Declared before the sink: a runtime may complete synchronously inside startTurn().
  let timer: NodeJS.Timeout | undefined;

  const sink: EventSink = {
    ...outer,
    turnCompleted: (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (e.status !== "ok") { outer.turnCompleted(e); return; }
      void runVerify(brief.verify, cwd, brief.timeout_ms).then((v) => {
        const ok = v.exitCode === 0;
        outer.itemCompleted({ session_key: sessionKey, turn_id: e.turn_id, item_id: `${String(e.turn_id)}-verify`,
          kind: "tool_call", body: v.tail, status: ok ? "ok" : "failed",
          meta: { label: "verify", exit_code: v.exitCode, timed_out: v.timedOut } });
        // A2 §5.4: a failed verify is a failed turn; the tail is already on the tool_call item above.
        outer.turnCompleted({ ...e, status: ok ? "ok" : "failed" });
      });
    },
  };

  const handle = await adapter.startTurn(rec, { text: renderDelegationPrompt(brief, cwd) }, sink);
  timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    void handle.cancel("timeout");
    outer.turnCompleted({ session_key: sessionKey, turn_id: handle.turn_id, status: "failed",
      usage: { cost_usd: null, duration_ms: brief.timeout_ms, num_turns: 1 },
      error: { code: BRIDGE_ERRORS.TURN_TIMEOUT, message: `timed out after ${brief.timeout_ms}ms` } });
  }, brief.timeout_ms);
  return { session_key: sessionKey, turn_id: handle.turn_id };
}
```

The error members used are the existing ones in `packages/protocol/src/bridge.ts`: `PATH_NOT_ALLOWED` (-32005), `APPROVAL_REQUIRED` (-32006), `TURN_TIMEOUT` (-32007), `RUNTIME_UNAVAILABLE` (-32002). In `rpc-dispatch.ts`, replace the `delegate.run` case body with `return runDelegation(params, { ...deps, adapterFor, sinkFor: deps.sinkFor ?? missingSink })` where `missingSink` throws `JSONRPC_ERRORS.INTERNAL` as `turn.start` does today.

- [ ] **Step 4:** `pnpm --filter @omnis/local-agent test` → PASS (the old "delegate.run is unsupported" assertion in `rpc-dispatch.test.ts` is replaced by the new behaviour — update it, do not delete the approval-required assertion).
- [ ] **Step 5:** `git commit -m "US-C02: bridge executes signed delegation briefs and re-runs verify"`

---

### Task 3: Hub delegation executor (US-C03, THOROUGH)

**Files:**
- Create: `apps/hub/src/delegate-exec.ts`, `apps/hub/test/integration/delegate-exec.test.ts`
- Modify: `apps/hub/src/bridge.ts` (`BridgeDeps.onTurnCompleted?: (host: HostId, p: Record<string, unknown>) => void`, called after the existing `turn.completed` handling), `apps/hub/src/main.ts` (start the executor)

**Interfaces:**
- Consumes: `kernel.approvals` (`list`, `beginExecution`, `completeExecution`, `failExecution`, `propose`), `kernel.events.subscribe("omnis_approval", …)`, `KillSwitch.isOn()`, `BridgeHub.call`, `signApproval`, `writeAgentItem`/system-item helper already used by `apps/hub` for system Items.
- Produces:
  ```ts
  export interface DelegateExecDeps { pool: Pool; kernel: Kernel; bridge: Pick<BridgeHub, "call" | "hosts">; token: string;
    killSwitch: Pick<KillSwitch, "isOn">; logger: Logger; }
  export interface DelegateExecutor { execute(approvalId: string): Promise<void>; onTurnCompleted(host: HostId, p: Record<string, unknown>): Promise<void>; stop(): void; }
  export function startDelegateExecutor(deps: DelegateExecDeps): DelegateExecutor;
  export function briefFromApproval(a: PendingApproval): z.input<typeof DelegationBrief>;
  ```

- [ ] **Step 1: Failing integration test** (per-branch DB; a fake bridge records calls)

```ts
// apps/hub/test/integration/delegate-exec.test.ts — key cases (use the existing hub integration helpers for pool/kernel/seed)
it("a decided delegate approval is signed, sent to the target host, and marked executing", async () => {
  const id = await seedDelegateApproval({ runtime: "claude_ds", host: "macbook", workdir: "/repo/omnis", verify_cmd: "pnpm test" });
  await kernel.approvals.decide(id, { decision: "accept" });
  await exec.execute(id);
  expect(bridge.calls[0]).toMatchObject({ host: "macbook", method: "delegate.run" });
  const { brief, sig } = bridge.calls[0]!.params as { brief: Record<string, unknown>; sig: string };
  expect(verifyApproval(TOKEN, id, brief, sig)).toBe(true);
  expect((await approvalRow(id)).state).toBe("executing");
});
it("turn.completed ok → approval executed, system Item on the source thread, tasks.delegated_session_id set", async () => { /* … */ });
it("turn.completed failed → approval failed, task blocked, one failure system Item, no second delegate.run", async () => { /* … */ });
it("-32009 from the bridge → approval failed + exactly one new pending approval for another runtime", async () => { /* … */ });
it("kill switch on → no bridge call, approval failed with reason 'kill switch'", async () => { /* … */ });
it("target host not connected → approval stays decided (retried when the host reconnects), no failure yet", async () => { /* … */ });
it("an ignore decision or a non-delegate action is never executed", async () => { /* … */ });
```

Write every case in full; the five `/* … */` bodies follow the first case's shape: seed, decide, `execute`, then drive `exec.onTurnCompleted("macbook", { session_key, turn_id, status, usage })` and assert on `pending_approvals`, `tasks`, and `items` (`kind='system'`, `thread_id` = the approval's `thread_id`).

- [ ] **Step 2:** `pnpm --filter @omnis/hub test:integration -- delegate-exec` → FAIL.

- [ ] **Step 3: Implement** — the core:

```ts
// apps/hub/src/delegate-exec.ts
// A2 §5.1/§5.3/§5.4 + A4 §5.4. The kernel, not an agent, turns a decided approval into a bridge call.
// No automatic retry anywhere: every retry is a new approval a human presses.
export function briefFromApproval(a: PendingApproval) {
  const args = { ...a.args, ...(a.decided_args ?? {}) } as Record<string, unknown>;
  return {
    approval_id: a.id,
    target: { runtime: String(args.runtime), host: String(args.host), cwd: String(args.workdir) },
    goal: String(args.brief),
    inputs: Array.isArray(args.inputs) ? args.inputs.map(String) : [],
    verify: String(args.verify_cmd),
    output: "diff" as const,
    timeout_ms: 900_000, // A2 §5.2 default, written out so the signed object never depends on a zod default
    ...(a.item_id ? { source_item_id: a.item_id } : {}),
  };
}

export function startDelegateExecutor(deps: DelegateExecDeps): DelegateExecutor {
  const running = new Map<string, { approvalId: string; taskId: string | null; threadId: string | null }>();
  async function execute(approvalId: string): Promise<void> {
    const [a] = await deps.kernel.approvals.list({ state: "decided" }).then((r) => r.filter((x) => x.id === approvalId));
    if (a === undefined || a.action !== "delegate" || (a.decision !== "accept" && a.decision !== "edit")) return;
    const brief = briefFromApproval(a);
    if (!deps.bridge.hosts().includes(brief.target.host as HostId)) return; // re-driven on reconnect
    await deps.kernel.approvals.beginExecution(a.id);
    if (await deps.killSwitch.isOn()) { await deps.kernel.approvals.failExecution(a.id, "kill switch"); return; }
    try {
      const r = await deps.bridge.call<{ session_key: string }>(brief.target.host as HostId, "delegate.run",
        { brief, sig: signApproval(deps.token, a.id, brief) });
      running.set(r.session_key, { approvalId: a.id, taskId: a.task_id, threadId: a.thread_id });
    } catch (e) {
      await onBridgeError(a, brief, e); // failExecution; -32009 → propose the same brief once on the other code runtime
    }
  }
  // onTurnCompleted: look up `running`, completeExecution|failExecution, write the system Item on threadId,
  // set tasks.delegated_session_id (ok) or tasks.state='blocked' (failed), delete the map entry.
  // subscribe: kernel.events.subscribe("omnis_approval", (p) => { if (p.state === "decided") void execute(String(p.id)); })
  // …
}
```

Also on bridge connect, re-drive every `decided` delegate approval for that host (`hosts()` changed). `-32009` fallback runtime: `claude_ds ↔ claude_code`, `codex → claude_code`; never `hermes`.

- [ ] **Step 4:** `pnpm --filter @omnis/hub test:integration` → PASS.
- [ ] **Step 5:** `git commit -m "US-C03: hub executes approved delegations and attaches results"`

---

### Task 4: Delegation allow rules (US-C04, THOROUGH)

**Files:**
- Create: `packages/kernel/src/delegation-rules.ts`, `packages/kernel/test/delegation-rules.test.ts`, `apps/hub/test/integration/delegate-autonomy.test.ts`
- Modify: `packages/kernel/src/approvals.ts` (`decide(id, r, actor?: { kind: "me" } | { kind: "rule"; index: number })` — the audit row uses `actor: "system"` and `after.decided_by: "rule:<index>"` for rules), `packages/kernel/src/index.ts` (export), `apps/hub/src/delegate-exec.ts` (on `omnis_approval` with `state === 'pending'` and `action === 'delegate'`, consult the rules)
- Modify: `packages/agents/src/loops/delegate.ts` — delete `autonomyAllows`/`AutonomyRule`/`AUTONOMY_MAX_MINUTES` there and re-export from the kernel module so there is one implementation.

**Interfaces:**
- Produces:
  ```ts
  export const DelegationRule = z.object({ runtime: z.enum(["claude_code", "codex", "claude_ds", "hermes", "omnis"]),
    host: z.enum(["mini", "macbook"]), repo: z.string().min(1) });
  export const AUTONOMY_MAX_MINUTES = 30;
  export function parseDelegationRules(v: unknown): DelegationRule[]; // drops malformed rows
  export function delegationAllowed(i: { rules: DelegationRule[]; hermesEnabled: boolean; runtime: string; host: string;
    workdir: string | null; estMinutes: number | null; hasEgress: boolean; injectionFlagged: boolean; fromInboxItem: boolean }): { allowed: true; index: number } | { allowed: false; reason: string };
  ```

- [ ] **Step 1: Failing unit test** (table-driven)

```ts
// packages/kernel/test/delegation-rules.test.ts
const rules = parseDelegationRules([{ runtime: "claude_ds", host: "macbook", repo: "/Users/l/omnis" }, { junk: 1 }]);
const base = { rules, hermesEnabled: false, runtime: "claude_ds", host: "macbook", workdir: "/Users/l/omnis/apps",
  estMinutes: 10, hasEgress: false, injectionFlagged: false, fromInboxItem: false };
it.each([
  [{}, { allowed: true, index: 0 }],
  [{ workdir: "/Users/l/omnis-other" }, { allowed: false, reason: "no matching rule" }],   // prefix is not containment
  [{ workdir: "/Users/l/omnis/../secrets" }, { allowed: false, reason: "no matching rule" }],
  [{ estMinutes: 31 }, { allowed: false, reason: "over 30 minutes" }],
  [{ estMinutes: null }, { allowed: false, reason: "no estimate" }],
  [{ hasEgress: true }, { allowed: false, reason: "egress" }],
  [{ injectionFlagged: true }, { allowed: false, reason: "injection flags" }],
  [{ host: "mini" }, { allowed: false, reason: "no matching rule" }],
  [{ runtime: "hermes" }, { allowed: false, reason: "hermes disabled" }],
])("%o → %o", (patch, want) => expect(delegationAllowed({ ...base, ...patch })).toEqual(want));
it("claude_code from an inbox item always needs a human (A2-D11)", () => {
  const r = parseDelegationRules([{ runtime: "claude_code", host: "macbook", repo: "/Users/l/omnis" }]);
  expect(delegationAllowed({ ...base, rules: r, runtime: "claude_code", fromInboxItem: true })).toEqual({ allowed: false, reason: "inbox-originated claude_code" });
});
it("rules default to empty and nothing is allowed", () => expect(delegationAllowed({ ...base, rules: [] }).allowed).toBe(false));
```

Containment is `path.resolve(workdir) === repo || path.resolve(workdir).startsWith(repo + "/")`.

- [ ] **Step 2:** `pnpm --filter @omnis/kernel test -- delegation-rules` → FAIL.
- [ ] **Step 3:** Implement the function exactly to the table (guards first in the order: hermes → injection → egress → estimate → inbox-originated `claude_code` → rule match). Integration test: with a matching rule, a new `delegate` approval is decided without a human, its audit row has `after.decided_by = "rule:0"`, and `delegate.run` is called; with the rule removed it stays `pending`; toggling a rule writes one `settings` audit row (already done by `setSetting`).
- [ ] **Step 4:** `pnpm --filter @omnis/kernel test && pnpm --filter @omnis/agents test && pnpm --filter @omnis/hub test:integration` → PASS.
- [ ] **Step 5:** `git commit -m "US-C04: per-runtime, per-host, per-repo delegation allow rules"`

---

### Task 5: Settings → Autonomy → Delegation (US-C05)

**Files:**
- Create: `apps/desktop/src/screens/settings/DelegationRules.tsx`, `apps/desktop/test/delegation-rules.test.tsx`
- Modify: `apps/desktop/src/screens/Settings.tsx` (render `<DelegationRules>` under the existing "Autonomy allowed" section), `packages/ui/src/i18n/en.ts` (strings below)

**Interfaces:**
- Consumes: `GET /settings`, `PUT /settings/:key` (already used by `Settings.tsx`), `DelegationRule` shape from Task 4 (re-declare the TS type locally; the desktop does not import `@omnis/kernel`).
- Produces: `DelegationRules({ rules, hermesEnabled, onSave }: { rules: unknown; hermesEnabled: boolean; onSave(next: DelegationRule[]): Promise<void> })`.

Copy (en, exact): section title `Delegation`; empty state `No runtime runs without your approval.`; add button `Add rule`; fields `Runtime`, `Host`, `Repository path`; remove `Remove`; warning dialog question `Delegations to this runtime in this repository will run without approval. Continue?` with `Cancel` / `Allow`; Hermes option hint `Needs the Hermes approval check first`.

- [ ] **Step 1: Failing test** — renders the empty state for `[]`; adding a rule opens the dialog and saves nothing until `Allow`; `Allow` calls `onSave` with `[{runtime,host,repo}]`; `Remove` saves without a dialog; the Hermes `<option>` is `disabled` when `hermesEnabled=false`; a relative repo path shows `Use an absolute path` and blocks save.
- [ ] **Step 2:** `pnpm --filter @omnis/desktop test -- delegation-rules` → FAIL.
- [ ] **Step 3:** Implement with the existing Settings row/dialog components and native `<select>`/`<input>` (DESIGN-DIRECTION: list body opaque, no new glass). Run the `docs/design/SKILLS.md` checklist and screenshot `tools/e2e` at 1280 and 900 widths.
- [ ] **Step 4:** `pnpm --filter @omnis/desktop test` → PASS.
- [ ] **Step 5:** `git commit -m "US-C05: Settings delegation allow-rule editor"`

---

### Task 6: Hermes as a delegation target, bridge side (US-C06, THOROUGH)

**Files:**
- Modify: `apps/local-agent/src/config.ts` (`HttpRuntimeConfig.delegation?: boolean`, parsed from TOML, default `false`), `apps/local-agent/src/bridges/hermes.ts`
- Create: `apps/local-agent/test/hermes-delegation.test.ts`, `apps/local-agent/test/fixtures/hermes/approval.sse` (`# provenance: synthetic-from-docs`)

**Interfaces:**
- Produces: `HermesConfig.delegation?: boolean`; `parseHermesCapabilities(raw, delegation)` returns `approvals: delegation ? "native" : "none"`; `HermesAdapter.startTurn` accepts `origin` `"human"` always and `"delegation"` only when `cfg.delegation === true`; approval events → `await sink.approval(interrupt)` → `POST {baseUrl}/v1/responses/{response_id}/approval` with `{ decision: "approve" | "deny", note? }`. **The event names and the response endpoint are UNVERIFIED — S-A2-5 (Task 27) pins them.** Until then the matcher is: an event whose `type` ends in `approval.requested` or `approval_request`, carrying `id` and `command`.

- [ ] **Step 1: Failing test** — (a) `origin:'delegation'` with `delegation` unset → `CAPABILITY_UNSUPPORTED`; (b) with `delegation: true`, the synthetic SSE fixture's approval event calls `sink.approval` once with `{ action: "delegate", args: { command }, description }` and, for an `accept` response, posts `{decision:"approve"}` to the endpoint above via the injected `fetchFn`; (c) `ignore` posts `{decision:"deny"}`; (d) keepalive comments still never reach the sink; (e) the existing read-only tests still pass untouched.
- [ ] **Step 2:** `pnpm --filter @omnis/local-agent test -- hermes` → FAIL.
- [ ] **Step 3:** Implement inside `#pump`'s `handleLine` as a third branch before the delta branch. The approval call is awaited off the read loop (`void (async () => …)()`) so the stream keeps draining.
- [ ] **Step 4:** `pnpm --filter @omnis/local-agent test` → PASS.
- [ ] **Step 5:** `git commit -m "US-C06: Hermes accepts delegation behind a per-host flag and maps approvals"`

---

### Task 7: Hermes in routing (US-C07)

**Files:**
- Modify: `packages/agents/src/delegate/route.ts` (`DelegationRuntime = RuntimeKind`; `pickRuntime` gains `hermesOnline: boolean; hermesSkillMatch: boolean`), `packages/agents/src/loops/delegate.ts` (`DelegateOutput.runtime` enum + `"hermes"`), `packages/agents/src/tools/propose.ts` (`ProposeDelegationInput.runtime` + `"hermes"`; when the runtime is `hermes` and `getSetting(pool, "delegation.hermes_enabled", false)` is false, store the task with `kind='delegation'` and create **no** approval)
- Create: `packages/agents/test/delegate-hermes.test.ts`

- [ ] **Step 1: Failing test** — `pickRuntime({ isCode: false, hermesOnline: true, hermesSkillMatch: true, … })` → `"hermes"`; with `hermesOnline: false` → `"omnis"`; code tasks never pick `hermes`; `propose_delegation` with `runtime:"hermes"` and the flag off creates 0 `pending_approvals` rows and 1 task; with the flag on creates 1 approval. Update the `// B-D7` comments to `// C-D6`.
- [ ] **Step 2:** `pnpm --filter @omnis/agents test -- delegate-hermes` → FAIL.
- [ ] **Step 3:** Implement; order in `pickRuntime`: `!isCode && hermesOnline && hermesSkillMatch → hermes`, then the existing rules unchanged.
- [ ] **Step 4:** `pnpm --filter @omnis/agents test` → PASS.
- [ ] **Step 5:** `git commit -m "US-C07: Hermes joins delegation routing behind delegation.hermes_enabled"`

---

### Task 8: KakaoTalk adapter on fixtures (US-C08)

**Files:**
- Create: `packages/adapters/kakaotalk/{package.json,tsconfig.json,vitest.config.ts}` (copy Telegram's, name `@omnis/adapter-kakaotalk`, dependencies `@omnis/protocol` only), `src/index.ts`, `src/keychain.ts` is **not** created (kmsg uses KakaoTalk.app's own login; no secret)
- Create: `fixtures/{text_message,thread_reply,attachment,rate_limited_response,auth_error_response,room_renamed_new_chat_id,own_message_sent_from_phone,non_english_korean_text}.json`, `test/{normalize,contract,poll}.test.ts`
- Modify: root `tsconfig.json` references

**Interfaces:**
- Produces:
  ```ts
  export const CHANNEL = "kakaotalk" as const;
  export interface KmsgClientLike {
    chats(): Promise<unknown>;                                   // `kmsg chats --json`
    read(chatId: string): Promise<unknown>;                      // `kmsg read <id> --background-safe --json`
    watch(onLine: (raw: unknown) => void): () => void;           // `kmsg watch --json`, returns stop
    send(chatId: string, text: string, opts: { dryRun: boolean }): Promise<{ preview: string; sent: boolean }>;
  }
  export interface KakaoAdapterDeps { client?: KmsgClientLike; now?: () => Date; rand?: () => number; sendEnabled?: () => boolean; }
  export function createKakaoTalkAdapter(deps?: KakaoAdapterDeps): Adapter;
  export function normalize(raw: unknown): NormalizedItem[];
  export function mapError(cause: unknown): AdapterError;
  export function sourceHash(chatId: string, timestamp: string, sender: string, body: string): string; // sha256 hex of `${chatId}\n${timestamp}\n${sender}\n${body.slice(0, 64)}`
  export function nextPollDelayMs(rand?: () => number): number; // 5_000 + floor(rand() * 10_001)
  ```
- Fixture raw shape (synthetic from the kmsg README; re-pinned by Task 20): `{ "chat_id": "...", "chat_name": "...", "sender": "...", "is_me": false, "text": "...", "timestamp": "2026-09-22T09:14:03+09:00", "attachments": [{ "kind": "image" }] }`. A line without `chat_id` or `timestamp` normalizes to `[]`.

- [ ] **Step 1: Failing tests** — the A1 §1.7 contract (`expect(normalize(f.raw)).toEqual(f.expected.items)` over every fixture); `sourceHash` stable across calls and differs when any of the four inputs differs; `is_me: true` → `author.kind: "person", id: "me"`; `room_renamed_new_chat_id` puts the new name in `threadMeta.title`; `mapError("AXError: element not found")` → `fatal_protocol`, anything mentioning `not running` → `retryable_network`; `nextPollDelayMs(() => 0) === 5000`, `(() => 1) === 15000`; `capabilities().write === false` unless `sendEnabled()` returns true; `send()` with no client throws `fatal_unsupported`; `backfill()` reads each chat from `chats()` once.
- [ ] **Step 2:** `pnpm --filter @omnis/adapter-kakaotalk test` → FAIL.
- [ ] **Step 3:** Implement following `packages/adapters/telegram/src/index.ts` structure (an `AsyncQueue`, `status`, `lastEventAt`). `subscribe()` uses `client.watch` and additionally re-reads open chats every `nextPollDelayMs()`; dedupe by `sourceHash` in a bounded `Set` (last 5,000). Capabilities: `{ read: true, write: sendEnabled(), realtime: true, history: false, media: false, markRead: false, typing: false, archive: false, delete: false }`.
- [ ] **Step 4:** `pnpm --filter @omnis/adapter-kakaotalk test && pnpm test:contract` → PASS.
- [ ] **Step 5:** `git commit -m "US-C08: KakaoTalk kmsg adapter on synthetic fixtures"`

---

### Task 9: LinkedIn notification-email parser (US-C09)

**Files:**
- Create: `packages/adapters/linkedin/{package.json,tsconfig.json,vitest.config.ts}` (`@omnis/adapter-linkedin`), `src/email.ts`, `fixtures/email_{new_message,new_message_no_preview,connection_invite_ignored,job_alert_ignored,not_linkedin}.json`, `test/email.test.ts`
- Create: `apps/hub/src/linkedin-email-hook.ts`, `apps/hub/test/linkedin-email-hook.test.ts`
- Modify: the hub's ingest sink wiring in `apps/hub/src/main.ts` (wrap the sink: after a `gmail` item is stored, `linkedinFromGmail` may emit one more item for the `linkedin` account)

**Interfaces:**
- Produces:
  ```ts
  export function parseNotificationEmail(item: NormalizedItem): NormalizedItem | null;
  // sender must match /@(?:e\.)?linkedin\.com>?$/i; subject/body must be a message notification, not an invite or job alert.
  // Output: threadExternalId = `li:<conversation id>` from a /messaging/thread/<id>/ link, else `li-email:<profile slug>`;
  // externalId = `li-email:${item.externalId}`; body = preview (≤ 300 chars) or "" ; author = { kind: "person", id: <profile URL> };
  // sourceHash = `li-email:${item.sourceHash}`; threadMeta.title = sender display name.
  export function linkedinFromGmail(deps: { findLinkedInAccount(): Promise<string | null>; sink: IngestSink }): (accountId: string, e: NormalizedItem | AdapterEvent) => Promise<void>;
  ```
  The hub marks these items `meta.partial = true` when writing (the protocol `NormalizedItem` has no meta; the hook passes a side flag the sink already supports for system Items, or, if it has none, writes `items.meta` in the same transaction via the kernel ingest path — pick the one `packages/kernel/src/ingest.ts` exposes, do not add a column).
- Fixtures are Gmail-normalized items (`raw` = a `NormalizedItem` as the Gmail adapter would emit it), `"provenance": "synthetic-from-docs"`. Task 26 replaces them.

- [ ] **Step 1: Failing tests** — each fixture maps to its expected item or `null`; the hook calls the sink twice for a LinkedIn message email when a `linkedin` account exists, once otherwise, and never for non-LinkedIn mail.
- [ ] **Step 2–4:** `pnpm --filter @omnis/adapter-linkedin test && pnpm --filter @omnis/hub test` FAIL → implement → PASS.
- [ ] **Step 5:** `git commit -m "US-C09: LinkedIn notification-email signal from Gmail"`

---

### Task 10: LinkedIn Playwright adapter on fixtures (US-C10)

**Files:**
- Create: `packages/adapters/linkedin/src/{index,page}.ts`, `fixtures/dom_{text_message,thread_reply,attachment,rate_limited_response,auth_error_response,selector_missing}.json`, `test/{normalize,contract,poll}.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const CHANNEL = "linkedin" as const;
  export interface RawConversation { conversationId: string; title: string; participants: { name: string; profileUrl: string }[]; lastActivityAt: string; unread: boolean }
  export interface RawMessage { conversationId: string; ordinal: number; senderName: string; senderProfileUrl: string; isMe: boolean; text: string; sentAt: string; attachments: { kind: "image" | "file"; url: string }[] }
  export interface LinkedInPageLike {
    pollInbox(): Promise<RawConversation[]>;
    openThread(conversationId: string): Promise<RawMessage[]>;
    sendText(conversationId: string, text: string): Promise<{ sentAt: string }>;
  }
  export class SelectorMissingError extends Error {}
  export function createLinkedInAdapter(deps?: { page?: LinkedInPageLike; rand?: () => number; now?: () => Date }): Adapter;
  export function normalize(raw: unknown): NormalizedItem[]; // raw = { messages: RawMessage[] } | { error: {...} }
  export function nextPollDelayMs(rand?: () => number): number; // 300_000 + floor(rand() * 600_001)
  ```
  `sourceHash` = sha256 of `${conversationId}\n${ordinal}\n${sentAt}` (A1 §2.9). Only unread conversations are opened on each poll (no bulk profile views). `SelectorMissingError` → `health().status = "degraded"`, the poll loop keeps running on its normal schedule, no retry burst. `send()` without an approval-gate sink throws `fatal_unsupported`.

- [ ] **Step 1–5:** tests for the contract fixtures, the poll delay bounds (`rand=0 → 300000`, `rand=1 → 900000`), unread-only opening, degraded-on-selector; FAIL → implement → `pnpm --filter @omnis/adapter-linkedin test && pnpm test:contract` PASS → `git commit -m "US-C10: LinkedIn adapter on extracted-DOM fixtures"`

---

### Task 11: WhatsApp adapter via Beeper (US-C11)

**Files:**
- Create: `packages/adapters/whatsapp/{package.json,tsconfig.json,vitest.config.ts}` (`@omnis/adapter-whatsapp`), `src/{index,keychain}.ts` (keychain = Telegram's copy), `fixtures/{text_message,thread_reply,attachment,rate_limited_response,auth_error_response,message_deleted,chat_upserted_group,non_whatsapp_network_ignored}.json`, `test/{normalize,contract,subscribe}.test.ts`
- Modify: root `tsconfig.json` references

**Interfaces:**
- Produces:
  ```ts
  export const CHANNEL = "whatsapp" as const;
  export type BeeperEvent = { type: "message.upserted" | "message.deleted" | "chat.upserted" | "chat.deleted"; data: unknown };
  export interface BeeperClientLike {
    listChats(): Promise<unknown[]>;
    listMessages(chatId: string, opts: { after?: string; limit: number }): Promise<unknown[]>;
    sendMessage(chatId: string, text: string): Promise<{ id: string; timestamp: string }>;
    markRead(chatId: string): Promise<void>;
    onEvent(cb: (e: BeeperEvent) => void, onClose: (reason: string) => void): () => void; // WS; returns stop
  }
  export function createWhatsAppAdapter(deps?: { client?: BeeperClientLike; sink?: (t: ThreadRef, d: Outbound) => Promise<SendResult>;
    now?: () => Date; pollMs?: number }): Adapter;
  export function normalize(raw: unknown): NormalizedItem[];
  export function isWhatsAppChat(chat: { accountID?: string; network?: string }): boolean; // backlog §8 Q2 default
  export const WS_RECONNECT_DEGRADE = 3, WS_WINDOW_MS = 30 * 60_000, POLL_MS = 60_000;
  ```
  Thread `externalId` = Beeper `chatID`; item `externalId` = `sourceHash` = Beeper message id (A1 §2.6). The WS and 1-minute REST poll run together; duplicates are dropped by `sourceHash`. The third WS close inside 30 minutes sets `health().status="degraded"` and `lastError.message = "ws_unstable: consider whatsmeow fallback (A1-D3)"`. `send()` calls only the injected `sink` (mock) until Task 24 wires the gate.

- [ ] **Step 1–5:** contract fixtures; a subscribe test with a fake client that closes the WS three times in 30 fake minutes (degraded) and twice (healthy); duplicate WS+poll delivery yields one item; a non-WhatsApp chat yields `[]`. FAIL → implement → `pnpm --filter @omnis/adapter-whatsapp test && pnpm test:contract` PASS → `git commit -m "US-C11: WhatsApp Beeper adapter on synthetic fixtures"`

---

### Task 12: Capture relay — local-agent sidecar + hub relay adapter (US-C12, THOROUGH)

**Files:**
- Create: `apps/local-agent/src/capture.ts`, `apps/local-agent/test/capture.test.ts`
- Modify: `apps/local-agent/src/config.ts` (`[[capture]]` blocks: `{ channel: "kakaotalk" | "linkedin"; account_external_id: string }`), `apps/local-agent/src/main.ts`, `apps/local-agent/src/rpc-dispatch.ts` (`capture.send`), `apps/local-agent/package.json` (add `@omnis/adapter-kakaotalk`, `@omnis/adapter-linkedin` workspace deps)
- Create: `apps/hub/src/capture-relay.ts`, `apps/hub/test/capture-relay.test.ts`
- Modify: `apps/hub/src/bridge.ts` (`capture.items` → `relay.push`), `apps/hub/src/main.ts` (factories `kakaotalk`, `linkedin` → `CaptureRelayAdapter`)

**Interfaces:**
- Produces (local-agent):
  ```ts
  export interface CaptureDeps { makeAdapter(channel: "kakaotalk" | "linkedin"): Adapter; notify(method: "capture.items", p: Record<string, unknown>): void;
    logger: Logger; batchMs?: number; }
  export function startCapture(blocks: CaptureConfig[], deps: CaptureDeps): { stop(): Promise<void>; adapterFor(channel: string): Adapter | undefined };
  export async function handleCaptureSend(params: unknown, deps: { token: string; adapterFor(c: string): Adapter | undefined }): Promise<{ preview: string; sent: boolean }>;
  ```
  Batches flush every `batchMs` (default 1,000) or at 200 events; notifications go through the existing outbox when the socket is down (`hub-sink.ts` pattern). An adapter whose `subscribe()` throws is restarted after 30s, forever, and its failure is sent as an `AdapterEvent` `disconnected` so the hub's health path sees it. In W1, `makeAdapter` returns the adapter **with no client** (every real client is a W2 story), so `subscribe()` idles — wiring is proven by the fake-adapter tests.
- Produces (hub):
  ```ts
  export class CaptureRelayAdapter implements Adapter { constructor(channel: "kakaotalk" | "linkedin", deps: { call: BridgeHub["call"]; token: string; host: HostId });
    push(events: (NormalizedItem | AdapterEvent)[]): void; /* subscribe() yields what push() received */ }
  export function captureRelayRegistry(): { get(channel: string): CaptureRelayAdapter | undefined; factories(deps): AdapterFactories };
  ```
  `send()` on the relay requires an `approval_id` in `Outbound` meta — it is called only from the approval execution path, which passes it; it signs `{channel, thread_external_id, text, dry_run}` with `signApproval` and calls `capture.send` on the mini. `handleCaptureSend` verifies with `verifyApproval` over the same object or throws `APPROVAL_REQUIRED`.

- [ ] **Step 1: Failing tests** — local-agent: a fake adapter yielding 3 items produces one `capture.items` notification with 3 events; 250 items produce two; a throwing adapter is restarted and emits `disconnected`; `capture.send` with a bad signature → `-32006`, with a good one → the adapter's `send` is called with `dry_run` respected. Hub: `capture.items` with an invalid item is rejected by zod and logged, a valid batch reaches the ingest sink with the right `accountId` (resolved from `account_external_id`), and the relay's `capabilities()` mirrors the channel's (`kakaotalk.write` false by default).
- [ ] **Step 2–4:** `pnpm --filter @omnis/local-agent test && pnpm --filter @omnis/hub test` FAIL → implement → PASS.
- [ ] **Step 5:** `git commit -m "US-C12: capture sidecar in local-agent and hub relay adapter"`

---

### Task 13: KakaoTalk send gate + dry-run first (US-C13, THOROUGH)

**Files:**
- Create: `packages/kernel/src/kakao-send.ts`, `packages/kernel/test/kakao-send.test.ts`, `apps/hub/test/integration/kakao-dry-run.test.ts`
- Modify: `apps/hub/src/capture-relay.ts` (send path), the hub's `send` approval execution for `kakaotalk` threads

**Interfaces:**
- Produces:
  ```ts
  export const KAKAO_STABLE_DAYS = 14;
  export async function kakaoSendState(pool: Pool, now?: Date): Promise<{ enabled: boolean; daysRemaining: number | null; reason: "no_stable_read" | "counting" | "awaiting_opt_in" | "open" }>;
  // enabled only when read_stable_since + 14d <= now AND kakao.send_enabled_at is set.
  ```
  Flow for an approved `send` on a KakaoTalk thread: first execution calls `capture.send` with `dry_run: true`, stores the preview in `pending_approvals.args.dry_run_preview`, and creates a **second** `send` approval with `args.confirm_of = <first id>`; only accepting that second approval calls `capture.send` with `dry_run: false`. If `kakaoSendState` is not `open`, execution fails with reason `kakao send closed (<reason>)`.

- [ ] **Step 1–5:** unit table for the four `reason`s and `daysRemaining` (e.g. stable since 10 days ago → `counting`, 4); integration: two approvals, one dry-run call and one real call, never a real call on the first; state `closed` → zero `capture.send` calls. FAIL → implement → `pnpm --filter @omnis/kernel test && pnpm --filter @omnis/hub test:integration` PASS → `git commit -m "US-C13: KakaoTalk 14-day send gate with dry-run first"`

---

### Task 14: Claude Code terminal-session import, bridge side (US-C14, THOROUGH)

**Files:**
- Create: `apps/local-agent/src/import/claude-jsonl.ts`, `apps/local-agent/test/import-claude.test.ts`, `apps/local-agent/test/fixtures/claude-projects/-repo-omnis/0b6c1d2e-0000-4000-8000-000000000001.jsonl`, `…/-etc-private/0b6c1d2e-0000-4000-8000-000000000002.jsonl`, `apps/local-agent/test/fixtures/claude-home/.credentials.json` (a decoy containing `DECOY-MUST-NOT-BE-READ`)
- Modify: `apps/local-agent/src/rpc-dispatch.ts` (`sessions.import_scan`)

**Interfaces:**
- Produces:
  ```ts
  export interface ImportDeps { claudeHome: string; codexHome: string; allowedRoots: string[]; secrets: string[];
    readFile?: (p: string) => Promise<string>; statMtime?: (p: string) => Promise<Date>; }
  export async function scanClaudeProjects(since: Date | null, max: number, deps: ImportDeps): Promise<ImportedSession[]>;
  export function parseClaudeJsonl(text: string): { cwd: string | null; sessionId: string | null; startedAt: string | null; turns: ImportedTurn[] };
  export function maskSecrets(s: string, secrets: string[]): string; // each known secret → "***"; also /sk-[A-Za-z0-9_-]{20,}/ and /ghp_[A-Za-z0-9]{36}/
  ```
  Only `path.join(claudeHome, "projects", <dir>, <file>.jsonl)` is ever opened — enumerate with `readdir` on `projects` and each child dir; never `readdir(claudeHome)`. A line is used when `type` is `user` or `assistant` and `isSidechain !== true`; text = string content or the `text` parts joined; tool calls = `tool_use` part `name`s; `source_id` = the line's `uuid`; the session `cwd` is the first line's `cwd`, and the session is dropped unless `path.resolve(cwd)` equals an allowed root or starts with `<root>/` (containment by resolved path, not `realpath`: a past session's directory may no longer exist, and nothing under it is ever opened). Turn text is truncated to 1,000 chars **after** masking.

- [ ] **Step 1: Failing tests** — the `-repo-omnis` session (cwd `/repo/omnis`, allowed root `/repo`) imports with the right turns, tool names, masked `sk-…` token; the `-etc-private` session is dropped; sidechain lines are skipped; malformed lines are skipped without failing the file; `since` filters by mtime; a `readFile` spy never sees a path outside `claudeHome/projects/**.jsonl` and never the decoy; `sessions.import_scan` over the dispatcher returns `ImportScanResult`.
- [ ] **Step 2–4:** `pnpm --filter @omnis/local-agent test` FAIL → implement → PASS.
- [ ] **Step 5:** `git commit -m "US-C14: read-only Claude Code session import on the bridge"`

---

### Task 15: Codex rollout import (US-C15)

**Files:**
- Create: `apps/local-agent/src/import/codex-rollout.ts`, `apps/local-agent/test/import-codex.test.ts`, `apps/local-agent/test/fixtures/codex-sessions/2026/09/21/rollout-2026-09-21T10-00-00-0b6c1d2e.jsonl` (`"provenance"` recorded in a first-line comment record `{"type":"_fixture","provenance":"synthetic-from-docs"}`)
- Modify: `apps/local-agent/src/rpc-dispatch.ts` (`sessions.import_scan` concatenates both scanners, newest first, capped at `max_sessions`)

**Interfaces:**
- Produces: `scanCodexSessions(since, max, deps: ImportDeps): Promise<ImportedSession[]>`; `parseCodexRollout(text): { cwd; sessionId; startedAt; turns }`. Assumed records (UNVERIFIED until Task 29): `{"type":"session_meta","payload":{"id","cwd","timestamp"}}`, `{"type":"response_item","payload":{"type":"message","role":"user"|"assistant","content":[{"type":"input_text"|"output_text","text"}]}}`, `{"type":"response_item","payload":{"type":"function_call","name"}}`. Any other `type` is skipped.

- [ ] **Step 1–5:** fixture parses to the expected session; unknown record types and bad JSON lines are skipped; outside-root cwd dropped; FAIL → implement → `pnpm --filter @omnis/local-agent test` PASS → `git commit -m "US-C15: read-only Codex rollout import on the bridge"`

---

### Task 16: Hub import job + read-only surface (US-C16)

**Files:**
- Create: `apps/hub/src/terminal-import.ts`, `apps/hub/test/integration/terminal-import.test.ts`, `apps/desktop/test/agent-session-readonly.test.tsx`
- Modify: `apps/hub/src/startup-jobs.ts` (register `terminal_import`), `apps/hub/src/bridge.ts` or the `turn.start` route (refuse `purpose` starting `term-` with `CAPABILITY_UNSUPPORTED`), `apps/desktop/src/screens/AgentSession.tsx`, `apps/desktop/src/screens/Settings.tsx` (General: toggle `Show terminal sessions (read-only)`)

**Interfaces:**
- Produces: `runTerminalImport(deps: { pool: Pool; bridge: Pick<BridgeHub, "call" | "hosts">; logger: Logger; now?: () => Date }): Promise<{ sessions: number; items: number }>` — no-op when `import.terminal_sessions` is false; per host, `since` = the newest imported item's `sent_at` for that host (null first time); session key `agent:<runtime>:<host>:term-<source_id first 8>`; `ensureSession(pool, { runtime, host, sessionKey, cwd, state: "idle" })`; items via `writeAgentItem` with `source_hash = import:<runtime>:<turn.source_id>` so re-imports are no-ops.
- Desktop copy (exact): badge `Read-only · opened in a terminal`; the composer is not rendered for `term-*` sessions.

- [ ] **Step 1–5:** integration: flag off → zero bridge calls; flag on → sessions and items created once, a second run creates nothing; a `turn.start` on a `term-` session is refused. Desktop: badge shown, composer absent. FAIL → implement → `pnpm --filter @omnis/hub test:integration && pnpm --filter @omnis/desktop test` PASS → `git commit -m "US-C16: terminal session import job and read-only sessions"`

---

### Task 17: Capture-channel composer states + missed-follow-up metric (US-C17)

**Files:**
- Create: `packages/kernel/src/jobs/followup-miss.ts`, `packages/kernel/test/integration/followup-miss.test.ts`
- Create: `packages/ui/src/components/composer-state.tsx`, `packages/ui/test/composer-state.test.tsx`
- Modify: `apps/desktop/src/screens/Thread.tsx` (render `ComposerState` instead of the composer when it returns a state), `packages/ui/src/i18n/en.ts`, the nightly digest body builder (one line `Missed follow-ups: N`)

**Interfaces:**
- Produces:
  ```ts
  export type ComposerBlock = { kind: "kakao_countdown"; days: number } | { kind: "linkedin_summary_only" } | { kind: "whatsapp_pilot" } | null;
  export function composerBlockFor(i: { channel: string; canWrite: boolean; partial: boolean; kakaoDaysRemaining: number | null }): ComposerBlock;
  export function ComposerState({ block }: { block: Exclude<ComposerBlock, null> }): JSX.Element;
  export async function runFollowupMiss(pool: Pool, now?: Date): Promise<{ misses: number; meetingIds: string[] }>;
  ```
  Copy (exact): `Sending opens in {n} days`, `Sending opens today once you turn it on in Settings` (n = 0), `Summary only — reply needs the capture host`, `Sending is off until the pilot check`.
  Miss rule: a `calendar_events` row that ended between `now - 72h` and `now - 48h`, with ≥1 attendee resolving to a `persons` row other than me, and no `items` with `status='sent'` authored by me in any thread whose participants include one of those persons, sent after the event's end. Result goes to `digests.metrics.followup_miss` on today's nightly row (create-or-merge the jsonb key; do not overwrite other metrics).

- [ ] **Step 1–5:** UI unit tests per block; integration seeds one meeting with a follow-up and one without → `misses = 1`; internal-only meetings do not count. FAIL → implement → `pnpm --filter @omnis/kernel test:integration && pnpm --filter @omnis/ui test && pnpm --filter @omnis/desktop test` PASS → `git commit -m "US-C17: capture composer states and the missed follow-up metric"`

---

### Task 18: Mini capture-sidecar service definitions (US-C18)

**Files:**
- Create: `ops/mini/com.omnis.kakaotalk.plist`, `ops/mini/com.omnis.beeper.plist`
- Modify: `ops/mini/local-agent.toml.example`, `ops/mini/install.sh`, `ops/mini/preflight.sh`, `ops/mini/RUNBOOK.md`, `apps/local-agent/test/mini-launchagents.test.ts`

**Content:**

```xml
<!-- ops/mini/com.omnis.kakaotalk.plist — keeps KakaoTalk.app running in the GUI session (A1 §2.8). -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.omnis.kakaotalk</string>
  <key>ProgramArguments</key><array><string>/usr/bin/open</string><string>-g</string><string>-a</string><string>KakaoTalk</string></array>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>300</integer>
  <key>LimitLoadToSessionType</key><string>Aqua</string>
</dict></plist>
```

`com.omnis.beeper.plist` is the same with Label `com.omnis.beeper` and `-a Beeper`. `open -g` is idempotent, so the 300s interval re-launches a crashed app without stealing focus.

```toml
# ops/mini/local-agent.toml.example — appended
# Capture channels (C-D3). Each block runs one adapter inside this GUI-session process.
# Leave them commented until the channel's live story (US-C21 / US-C30) says so.
# [[capture]]
# channel = "kakaotalk"
# account_external_id = "kakaotalk:me"
# [[capture]]
# channel = "linkedin"
# account_external_id = "linkedin:me"
```

`install.sh`: copy the two plists to `~/Library/LaunchAgents/` only when absent (same rule as the existing `local-agent.toml` copy), **do not** `launchctl bootstrap` them (the live story does). `preflight.sh --check` adds four checks, each printing only on failure: `pgrep -x KakaoTalk`, `lsof -nP -iTCP@127.0.0.1:23373 -sTCP:LISTEN` (Beeper), `test -d ~/.omnis/linkedin-profile`, and AX trust for `kmsg` via `kmsg status --json` exit code — all four are **skipped with a one-line note** unless the matching `[[capture]]` block (or, for Beeper, a `whatsapp` account row) exists, so preflight stays green before Phase C goes live. `RUNBOOK.md` gets a "Capture channels" section with the grant steps (Accessibility for `kmsg`, Beeper Remote Access bound to Tailscale only, LinkedIn one-time login) in the order Tasks 20/23/30 use them.

- [ ] **Step 1: Failing test** — extend `mini-launchagents.test.ts`: both plists parse, `LimitLoadToSessionType` is `Aqua`, neither references port 8642 or `hermes`, and `install.sh` contains no `launchctl bootstrap` line for them.
- [ ] **Step 2–4:** `plutil -lint ops/mini/*.plist && bash -n ops/mini/install.sh ops/mini/preflight.sh && pnpm --filter @omnis/local-agent test` FAIL → implement → PASS.
- [ ] **Step 5:** `git commit -m "US-C18: mini capture-sidecar service definitions"`

---

# W2 — LIVE (gate-ordered; Logan + Opus operator)

Each W2 task starts only when its gate is PASS in backlog §5. Code slices inside W2 tasks (real clients) still run through the DeepSeek → Opus loop above, in a worktree, on the gate's captured fixtures. Captured payloads are redacted before commit with `tools/fixtures/redact.ts` (created in Task 20: replaces names, phone numbers, emails, profile URLs and message text with stable placeholders, keeps structure and field names).

### Task 19: Gate ③ — FileVault + auto-login (US-C19)

- [ ] Logan: on the mini, confirm FileVault on, enable auto-login per `ops/mini/RUNBOOK.md`, reboot twice, check the GUI session and `launchctl print gui/$(id -u)/com.omnis.local-agent` after each.
- [ ] Opus fills `tools/spikes/gate-03-filevault-autologin/result.md` (question, owner, host, date, PASS/FAIL, evidence).
- [ ] Verify: `grep -E '^- \*\*Result \(Pass/Fail\)\*\*: (PASS|FAIL)' tools/spikes/gate-03-filevault-autologin/result.md`
- [ ] Commit `US-C19: gate 3 result`.

### Task 20: Gate ④ — kmsg read 48h + real client (US-C20)

- [ ] Logan: `brew install channprj/tap/kmsg`; grant Accessibility; run `kmsg chats --json`, `kmsg read <chat> --background-safe --json`; start `kmsg watch --json > ~/kmsg-48h.ndjson` for 48h. Never `kmsg auth login`.
- [ ] Opus: write `tools/fixtures/redact.ts`; redact 10+ captured lines into `packages/adapters/kakaotalk/fixtures/captured/*.json` with `expected` filled; fix `normalize()` for any field-name drift so **both** synthetic and captured fixtures pass.
- [ ] DeepSeek (worktree): `packages/adapters/kakaotalk/src/kmsg-client.ts` — `createKmsgClient({ binary })` implementing `KmsgClientLike` with `child_process.spawn` (`watch` = a long-lived child, one JSON object per stdout line; `send` passes `--dry-run` when asked). Test with a fake `spawn`.
- [ ] Fill `tools/spikes/gate-04-kmsg-read/result.md` (focus never lost, line count, gaps).
- [ ] Verify: `pnpm --filter @omnis/adapter-kakaotalk test`. Commit `US-C20: gate 4 + real kmsg client`.

### Task 21: KakaoTalk live read (US-C21)

- [ ] Insert the `accounts` row (`channel='kakaotalk'`, `external_id='kakaotalk:me'`); uncomment the `[[capture]]` block on the mini; `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.omnis.kakaotalk.plist`; restart local-agent with the real `KmsgClientLike` factory.
- [ ] Watch 24h; stamp `kakao.read_stable_since` when a full day passes with no `down` health longer than 1h (backlog §8 Q1); a longer outage resets it.
- [ ] Verify the backlog's `psql` count > 0 and p50 capture latency ≤ 60s. Append the 7-day health log to `gate-04` `result.md`. Commit.

### Task 22: KakaoTalk send open (US-C22)

- [ ] After `kakaoSendState` reports `awaiting_opt_in`, Logan sets `kakao.send_enabled_at` in Settings.
- [ ] Logan approves one reply in "chat with myself": first approval → dry-run preview visible in the card; second approval → real send.
- [ ] Verify one `item.sent` audit row for `kakaotalk` whose approval has `args.confirm_of`. Commit the `result.md` addendum.

### Task 23: Gate ② — Beeper + WhatsApp secondary number (US-C23)

- [ ] Logan: install Beeper on the mini, pair the **secondary** WhatsApp number, issue the Desktop API token, enable Remote Access bound for Tailscale only, store the token as Keychain `omnis.beeper.token` (service name only; A6 §9).
- [ ] Opus: spike script `tools/spikes/gate-02-beeper-whatsapp/probe.ts` — list chats, send one message to the pilot peer, subscribe WS for 30 min, count reconnects; capture and redact REST/WS payloads into `packages/adapters/whatsapp/fixtures/captured/`; pin the network field (backlog §8 Q2).
- [ ] Fill `result.md`: PASS if HTTP 200 + peer receipt and < 3 WS reconnects in 30 min; otherwise FAIL → Task 25.
- [ ] Verify `pnpm --filter @omnis/adapter-whatsapp test` (synthetic + captured). Commit.

### Task 24: WhatsApp live wiring (US-C24) — only if gate ② PASS

- [ ] DeepSeek (worktree): `packages/adapters/whatsapp/src/beeper-client.ts` — `createBeeperClient({ baseUrl, token, fetchFn?, WebSocketCtor? })` implementing `BeeperClientLike` (REST under `/v0`/`/v1` as pinned in Task 23, WS at `/v1/ws` with `subscriptions.set`). Tests with fake fetch/WS.
- [ ] Hub: `factories.whatsapp = () => createWhatsAppAdapter({ client: createBeeperClient(…), sink: approvedSendSink })` in `apps/hub/src/main.ts`, where `approvedSendSink` is the existing `runEgress` send path; account row `whatsapp`.
- [ ] Logan approves one send to the pilot peer. Verify `pnpm --filter @omnis/adapter-whatsapp test && pnpm --filter @omnis/hub test` + the `audit_log` row. Commit.

### Task 25: whatsmeow sidecar (US-C25) — only if gate ② FAIL

- [ ] Opus writes `tools/whatsmeow-sidecar/` (Go module, MPL-2.0 dependency noted in `THIRD-PARTY.md`): QR via `GetQRChannel()` rendered as a system Item image, `sqlstore` DB encrypted with the key from Keychain `omnis.whatsmeow.session_key`, a loopback HTTP API mirroring `BeeperClientLike` so only `createBeeperClient`'s sibling `createWhatsmeowClient` is new on the TS side.
- [ ] Verify `cd tools/whatsmeow-sidecar && go test ./...` + one approved send on the secondary number. Commit.

### Task 26: A1-⑧ — LinkedIn notification-email sample (US-C26) — needs gate ⑩

- [ ] Logan triggers one LinkedIn DM to himself; Opus fetches it with Gmail `messages.get?format=raw` through the connected Gmail account, redacts it into `packages/adapters/linkedin/fixtures/captured/email_new_message.json`.
- [ ] Re-pin `parseNotificationEmail`; if the body carries no usable preview, set body `""` and keep the path as a trigger only (A1 §4).
- [ ] Fill `tools/spikes/a1-8-linkedin-email/result.md`. Verify `pnpm --filter @omnis/adapter-linkedin test`. Commit.

### Task 27: S-A2-5 + gate-hermes-sse — Hermes approval surface (US-C27) — **Logan only**

- [ ] Logan (agents never touch the mini's Hermes or port 8642): on the host chosen in backlog §8 Q3, run one Hermes turn that requires command approval and save the raw SSE (`curl -N … /v1/responses > hermes-approval.sse`), plus the request that answers the approval. Logan hands the two files to the orchestrator.
- [ ] Opus: create `tools/spikes/gate-hermes-sse/result.md` and `tools/spikes/s-a2-5-hermes-approval/result.md`; redact the capture into `apps/local-agent/test/fixtures/hermes/approval.captured.sse`; pin the event names and the response endpoint in `hermes.ts`, replacing the suffix matcher from Task 6; tests pass on synthetic + captured.
- [ ] On PASS: Logan sets `delegation.hermes_enabled = true` and `delegation = true` in that host's `[[runtime]] kind="hermes"` block. On FAIL: both stay off; record it.
- [ ] Verify `pnpm --filter @omnis/local-agent test`. Commit.

### Task 28: Delegation live smoke (US-C28) — needs S-A2-4, ⑦ (after 2026-09-23 18:23), ⑪b

- [ ] Run S-A2-4 first: one `claude-ds -p` turn with `--output-format stream-json` under each `DS_MODEL` value; record in `tools/spikes/s-a2-4-claude-ds-stream/result.md`.
- [ ] Re-run gate ⑦ per `tools/spikes/gate-07-codex-appserver/result.md`.
- [ ] Logan creates a small real task on the MacBook ("fix typo in X, verify `pnpm --filter … test`"), approves the `claude_ds` delegation; confirm the bridge ran `verify`, the result Item landed on the source thread, `tasks.delegated_session_id` is set. Repeat for `codex` on the mini once ⑦ passes.
- [ ] Record in `tools/spikes/c28-delegation-smoke/result.md`. Commit.

### Task 29: Terminal import live check (US-C29) — gate S-C1

- [ ] Logan consents and turns on `import.terminal_sessions`.
- [ ] Opus runs `sudo fs_usage -w -f filesys node | grep -E '\.claude|\.codex'` during one import on the MacBook and keeps the excerpt: only `projects/*/*.jsonl` and `sessions/**/rollout-*.jsonl` may appear.
- [ ] Fix parser drift against real files; commit redacted captured-shape fixtures; `pnpm --filter @omnis/local-agent test`.
- [ ] Record in `tools/spikes/s-c1-terminal-import/result.md`. Commit.

### Task 30: Mini capture services + LinkedIn profile (US-C30) — needs ③, A1-⑨

- [ ] Logan logs into LinkedIn once in `~/.omnis/linkedin-profile` via `npx playwright open --user-data-dir ~/.omnis/linkedin-profile https://www.linkedin.com/messaging/` (2FA included).
- [ ] DeepSeek (worktree): `packages/adapters/linkedin/src/playwright-page.ts` — `createLinkedInPage({ userDataDir })` implementing `LinkedInPageLike` with `chromium.launchPersistentContext`, an in-page extractor returning `RawConversation[]`/`RawMessage[]`, `SelectorMissingError` when an anchor selector is absent. Unit-test the extractor against saved, redacted HTML with Playwright's `page.setContent`.
- [ ] Bootstrap `com.omnis.beeper`/`com.omnis.kakaotalk`, enable the `linkedin` `[[capture]]` block, run `bash ops/mini/preflight.sh` until it exits 0, then 48h unattended with healthchecks pinging.
- [ ] A1-⑨: after 7 days, confirm no re-login was needed; `tools/spikes/a1-9-linkedin-profile/result.md`. Commit.

### Task 31: Phase C exit measurement (US-C31)

- [ ] Run the per-channel count over 7 days (all 8 channels ≥ 1) and read `digests.metrics.followup_miss` for 14 nights (all 0).
- [ ] Add a "Phase C status" section to `docs/superpowers/plans/README.md` in the Phase B section's format (story → plan task table, gates, deferred list, numbers).
- [ ] Commit `docs: Phase C status`.

---

## Self-review

- **Spec coverage.** Master §16 Phase C: KakaoTalk (Tasks 8, 12, 13, 20–22), LinkedIn (9, 10, 26, 30), WhatsApp (11, 23–25), delegation execution + allow rules (1–5, 28), claude-ds and Hermes as targets (1–3, 6, 7, 27, 28), exit metric (17, 31). §19 Q2 → Task 23 secondary number; Q3 → Tasks 13, 22; Q7 → Tasks 6, 7, 27; Q10 → Tasks 4, 5; Q12 → Tasks 14–16, 29. A2 §5.4's failure table → Task 3. A2-D11 inbox-originated `--bare` → Tasks 2 (session profile) and 4 (guard). Mini sidecar definitions → Task 18; deploy → Task 30.
- **Placeholder scan.** The only deliberately open items are the UNVERIFIED vendor field names (kmsg, Beeper, LinkedIn email, Codex rollout, Hermes approval), each with a stated default shape in W1 and a named W2 task that pins it.
- **Type consistency.** `signApproval`/`verifyApproval` (Task 0) are used by Tasks 2, 3, 12, 13; `ImportedSession`/`ImportedTurn` (Task 0) by 14–16; `DelegationRule`/`delegationAllowed` (Task 4) by 5 and 7; `KmsgClientLike` (8) by 12, 20; `LinkedInPageLike` (10) by 12, 30; `BeeperClientLike` (11) by 24, 25; `CaptureRelayAdapter` (12) by 13.
