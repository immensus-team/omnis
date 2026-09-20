# Protocol and Channel Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock down the `@omnis/protocol` zod contract (NormalizedItem/Adapter/Capabilities) in code, and implement the Slack, Gmail, and Google Calendar channel adapters on top of that contract together with fixture-replay contract tests.

**Architecture:** `packages/protocol` is a leaf package that imports no other internal package, and exports only zod schemas and pure types such as `Adapter`/`AuthRef`/`AdapterError`. The three adapter packages (`packages/adapters/{slack,gmail,google-calendar}`) each depend only on `@omnis/protocol` and never import one another; each one exports the raw payload → `NormalizedItem[]` conversion as a pure function named `normalize()`, kept separate from the `Adapter` object so it can be verified with fixtures and no network. `send()` never calls a real channel API and calls only an injectable mock sink — this prevents irreversible sends while the approval gate (US-A07, kernel plan) does not exist yet.

**Tech Stack:** TypeScript 5.6.3 (strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`) · zod ^3.24.1 (owner `@omnis/protocol`; no package uses zod 4) · vitest 2.1.9 · Biome 1.9.x · `@slack/socket-mode` ^2.0.5 · `@slack/web-api` ^7.9.3 · `googleapis` ^161.0.0 · Node 22 · pnpm workspaces. Version pin sources: `2026-09-20-phase-a-interfaces.md` §2 (FIXED).

**Spec:** `/Users/logankim/AI-Workspaces/omnis/docs/spec/00-omnis-design.md` §8 + `/Users/logankim/AI-Workspaces/omnis/docs/spec/A1-channel-adapters.md` (entire) + `/Users/logankim/AI-Workspaces/omnis/docs/spec/A3-data-schema.md` §2 (items/threads/accounts) + `/Users/logankim/AI-Workspaces/omnis/docs/superpowers/plans/2026-09-20-phase-a-interfaces.md` §1·§2·§3·§9 (package names, toolchain, protocol exports, shared conventions — FIXED).

## Global Constraints

- Node 22 + pnpm workspaces(A7 §1~2).
- TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`, root `tsconfig.base.json` (A7 §1).
- Postgres 17 (A3) — this plan does not touch the DB (the adapters do not import `packages/kernel`, A7 §1).
- The hub binds only to `127.0.0.1:8787` (master §4.2) — the adapters in this plan are not yet wired into the hub process.
- Migrations are append-only `packages/db/migrations/000N_<name>.sql` plus the tracking table `_omnis_migrations` (A3 §8) — this plan does not create migrations.
- While the approval gate (US-A07) does not exist, do not connect irreversible tools such as `send`/`delete`/`calendar_write`/`delegate` directly to the kernel (A7 §7 shared prohibition) — every `send()` calls only a mock sink.
- Provider SDKs (`@slack/*`, `googleapis`) are imported only inside their own adapter package (A7 §7 shared prohibition, §1 dependency rules).
- Never make tests pass by deleting or skipping them.
- Keychain item names follow the A1 §1.3 convention (`omnis.<channel>.<kind>.<external_id>`) plus the interfaces.md §9 FIXED exception: the Google family (`gmail`/`gcal`) shares a single `omnis.gmail.<email>` item (`<kind>` omitted), while Slack uses two items — `omnis.slack.xoxb.<team_id>` (account=`<team_id>`) and `…​.app` (not `xoxp`).
- Story tiers follow A7 §4: US-A11 (Task 2·3) = Sonnet, US-A11 Task 1 (type scaffold) = DeepSeek, US-A12~A14 = Sonnet, US-A15 = DeepSeek (review Sonnet+).
- Commits (interfaces.md §9, same rules as the kernel-and-db plan): branch `ralph/<story-id>`, worktree `omnis/.worktrees/<story-id>`. Exactly one atomic commit per story, subject format `<story-id>: <one-line summary>` (A7 §6), body listing the acceptance criteria that were met, and a final line matching the story tier: `Co-Authored-By: Claude <tier> <noreply@anthropic.com>` (for Sonnet tasks, `Claude Sonnet`) or `Co-Authored-By: DeepSeek V4.1 Flash <noreply@deepseek.com>` — never use `fable`, because A7-D6 excludes it from the headless development loop (contract §9 sets no default, and this item is the authoritative source).

---

### Task 1: `@omnis/protocol` scaffold + value sets and branded types (US-A11, tier: DeepSeek)

**US-A11 deliverable (A7 §7):** `packages/protocol` — `NormalizedItem`/`Adapter`/`Capabilities` zod schemas. **Verification command:** `pnpm --filter @omnis/protocol test`. **Goal:** Lock down the interfaces.md §3.1~3.3 contract in code.

**Files:**
- Verify only (does not create — the root files are owned by kernel-and-db Task 1): `pnpm-workspace.yaml`, `package.json` (root), `tsconfig.base.json`, `biome.jsonc`
- Create: `packages/protocol/package.json`, `packages/protocol/tsconfig.json`, `packages/protocol/vitest.config.ts`
- Create: `packages/protocol/src/adapter.ts`
- Test: `packages/protocol/test/enums.test.ts`

**Interfaces:** Consumes: none (leaf). Produces: `Channel`, `ThreadKind`, `ItemKind`, `ItemStatus`, `Scope`, `Sensitivity`, `HostId`, `RuntimeKind` (zod enum + `z.infer` types), `SessionKey`, `SessionId` (branded strings + zod schemas) — all exactly as in interfaces.md §3.1.

**This task does not create the root scaffold.** The root `pnpm-workspace.yaml`/`package.json`/`tsconfig.base.json`/`biome.jsonc` are owned by `2026-09-20-phase-a-kernel-and-db.md` Task 1 (interfaces.md §2, FIXED — plans-review.md M4). This task only checks that those files exist, using `test -f`. In Wave 0, kernel-and-db Task 1 and this task run in parallel with no prerequisite (plans-review.md §3), so if kernel Task 1 has not finished yet and the root files are missing, **run kernel-and-db Task 1 (db-scaffold) first, then resume this task.**

- [ ] 1. Only verify that the root workspace files exist (do not create them).

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  test -f pnpm-workspace.yaml && test -f package.json && test -f tsconfig.base.json && test -f biome.jsonc \
    && echo "root scaffold confirmed (created by kernel-and-db Task 1)" \
    || { echo "root scaffold is missing — run kernel-and-db Task 1 (db-scaffold) first, then resume this task."; exit 1; }
  ```

- [ ] 2. Create the `packages/protocol` package scaffold.

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

- [ ] 3. Write the failing test: `packages/protocol/test/enums.test.ts`

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

- [ ] 4. Run the test and confirm it fails.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/protocol test
  ```

  Expected failure: `Cannot find module '../src/adapter.js'` (because `src/adapter.ts` does not exist yet — if pnpm/node_modules is missing, run `pnpm install` once at the root first).

- [ ] 5. Write the minimal implementation: `packages/protocol/src/adapter.ts` (exactly as in interfaces.md §3.1)

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

- [ ] 6. Run the test and confirm it passes.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/protocol test
  ```

  Expected output: `Test Files  1 passed (1)` / `Tests  3 passed (3)`.

- [ ] 7. Commit.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/protocol
  git commit -m "$(cat <<'EOF'
  US-A11: protocol value sets and branded types

  - Do not create the root scaffold (pnpm-workspace.yaml/package.json/tsconfig.base.json/biome.jsonc) — its owner is kernel-and-db Task 1 (interfaces.md §2)
  - packages/protocol: Channel/ThreadKind/ItemKind/ItemStatus/Scope/Sensitivity/HostId/RuntimeKind zod enum
  - SessionKey/SessionId branded types + regex validation

  Co-Authored-By: DeepSeek V4.1 Flash <noreply@deepseek.com>
  EOF
  )"
  ```

---

### Task 2: NormalizedItem / NormalizedThread / Capabilities (US-A11, tier: Sonnet)

**Files:**
- Modify: `packages/protocol/src/adapter.ts`
- Test: `packages/protocol/test/normalized.test.ts`

**Interfaces:** Consumes: Task 1's `Channel`, `ThreadKind`, `ItemKind`, `ItemStatus` (no re-import; same file). Produces: `Capabilities`, `ParticipantRef`, `NormalizedThread`, `Attachment`, `NormalizedItem` (exactly as in interfaces.md §3.2).

- [ ] 1. Write the failing test: `packages/protocol/test/normalized.test.ts`

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

- [ ] 2. Run the test and confirm it fails.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/protocol test
  ```

  Expected failure: `does not provide an export named 'Capabilities'`.

- [ ] 3. Append the following to the end of `packages/protocol/src/adapter.ts` (exactly as in interfaces.md §3.2).

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

- [ ] 4. Run the test and confirm it passes.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/protocol test
  ```

  Expected output: `Tests  6 passed (6)` (Task 1's 3 plus this task's 3).

- [ ] 5. Commit.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/protocol
  git commit -m "$(cat <<'EOF'
  US-A11: NormalizedThread/NormalizedItem/Capabilities zod schemas

  - Capabilities: 9 fields — read/write/realtime/history/media/markRead/typing/archive/delete
  - NormalizedItem.status is always the literal 'received' (A1 §1.2)
  - author.kind is person|agent|system (aligned with the A3 3-column model, A1-D1)

  Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 3: AdapterEvent / AuthRef / AdapterError / Health / Adapter interfaces (US-A11, tier: Sonnet)

**Files:**
- Modify: `packages/protocol/src/adapter.ts`
- Create: `packages/protocol/src/index.ts`
- Test: `packages/protocol/test/adapter-error.test.ts`

**Interfaces:** Consumes: Task 1·2's `Channel`, `NormalizedItem` (same file). Produces: `AdapterEvent`, `AuthRef`, `AdapterErrorKind`, `AdapterError`, `Health`, `ThreadRef`, `OutboundAttachment`, `Outbound`, `SendResult`, `Adapter`, `Normalize`, `IngestSink` (exactly as in interfaces.md §3.3) — all three adapter packages depend on these types.

- [ ] 1. Write the failing test: `packages/protocol/test/adapter-error.test.ts`

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

- [ ] 2. Run the test and confirm it fails.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/protocol test
  ```

  Expected failure: `does not provide an export named 'AdapterError'`.

- [ ] 3. Append the following to the end of `packages/protocol/src/adapter.ts` (exactly as in interfaces.md §3.3).

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

- [ ] 4. Create `packages/protocol/src/index.ts` (re-export).

  ```ts
  export * from "./adapter.js";
  ```

- [ ] 5. Run the test and confirm it passes.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/protocol test
  ```

  Expected output: `Tests  7 passed (7)`.

- [ ] 6. Commit.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/protocol
  git commit -m "$(cat <<'EOF'
  US-A11: AdapterEvent/AuthRef/AdapterError/Health/Adapter interfaces + index re-export

  - AdapterError: 6 kinds, name fixed to 'AdapterError' (A1 §1.4)
  - Adapter interface: connect/disconnect?/backfill/subscribe/send/markRead?/archive?/health (A1 §1.6)
  - Normalize/IngestSink types, re-exported from packages/protocol/src/index.ts

  Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 4: Slack adapter — package scaffold + Keychain + connect()/subscribe()/health() (US-A12, tier: Sonnet)

**US-A12 deliverable (A7 §7):** `packages/adapters/slack/src/index.ts`. **Verification command:** `pnpm --filter @omnis/adapter-slack test`. **Goal:** Slack adapter: Socket Mode connection + backfill + realtime subscribe.

**Files:**
- Create: `packages/adapters/slack/package.json`, `packages/adapters/slack/tsconfig.json`, `packages/adapters/slack/vitest.config.ts`
- Create: `packages/adapters/slack/src/keychain.ts`, `packages/adapters/slack/src/index.ts`
- Test: `packages/adapters/slack/test/capabilities.test.ts`, `packages/adapters/slack/test/connect.test.ts`

**Interfaces:** Consumes: `Adapter`, `AuthRef`, `AdapterError`, `Health`, `Capabilities`, `NormalizedItem`, `AdapterEvent` from `@omnis/protocol` (Task 3). Produces: `CHANNEL` (`"slack"` literal), `createSlackAdapter(deps?: SlackAdapterDeps): Adapter`, `readKeychainSecret(service, account, channel): Promise<string>`.

Spec to read: A1 §1.3 (Keychain naming), §2.1 (Slack details: Socket Mode, `apps.connections.open`, write-back table). **Keychain item names (interfaces.md §9, FIXED)**: the bot token is `omnis.slack.xoxb.<team_id>` (account=`<team_id>`) and the app token is `omnis.slack.xoxb.<team_id>.app` (account=`<team_id>`, same account) — 2 items, not `xoxp`. Every `AuthRef` example and fixture below uses this naming verbatim. **Do not build (YAGNI)**: the `typing` indicator (just declare it `false` in capabilities and stop — A1 §1.1 says the UI does not render what is not declared, so no implementation is needed either), and the Events API fallback path (only a fallback if A1 §4 A1-④ fails; not in Phase A scope).

- [ ] 1. Create the package scaffold.

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

- [ ] 2. Write the failing test: `packages/adapters/slack/test/capabilities.test.ts`

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

- [ ] 3. Run the test and confirm it fails.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm install && pnpm --filter @omnis/adapter-slack test
  ```

  Expected failure: `Cannot find module '../src/index.js'`.

- [ ] 4. Write the Keychain wrapper: `packages/adapters/slack/src/keychain.ts` (wraps the macOS `security` CLI, A1 §1.3)

  ```ts
  import { execFile } from "node:child_process";
  import { promisify } from "node:util";
  import { AdapterError, type Channel } from "@omnis/protocol";

  const execFileAsync = promisify(execFile);

  /** Reads the secret value with `security find-generic-password -s <service> -a <account> -w`.
   *  Never log the value (A7 §9 logging rules). */
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

- [ ] 5. In `src/index.ts`, write `capabilities()`/`connect()`/`disconnect()`/`subscribe()`/`health()`. `backfill`/`send`/`markRead`/`archive` are not implemented yet, so they throw `fatal_unsupported` when called (Task 5·6 fills them in).

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

- [ ] 6. Run the test and confirm it passes.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/adapter-slack test
  ```

  Expected output: `Tests  1 passed (1)`.

- [ ] 7. Add a test that verifies the path where `connect()` fails with `auth_expired`: `packages/adapters/slack/test/connect.test.ts`

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

  This test relies on the fact that the real macOS Keychain has no `omnis.slack.xoxb.T000UNKNOWN` item (neither CI nor developer machines create it, so it always takes the failure path) — no network calls.

- [ ] 8. Run the test and confirm it passes.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/adapter-slack test
  ```

  Expected output: `Tests  2 passed (2)`.

- [ ] 9. Commit.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/adapters/slack
  git commit -m "$(cat <<'EOF'
  US-A12: Slack adapter scaffold + Keychain + connect()/subscribe()/health()

  - readKeychainSecret(): wraps the security CLI, never leaves the value in logs (A1 §1.3)
  - connect(): reads both the xoxb token (WebClient) and the app token (SocketModeClient) from Keychain
  - subscribe(): AsyncIterable backed by AsyncQueue; connect() pushes a 'connected' event onto the queue
  - capabilities(): typing=false, archive=false, delete=false (A1 §3 write-back table)
  - backfill()/send() are still fatal_unsupported (implemented in Task 5·6)

  Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 5: Slack adapter — backfill() (US-A12, tier: Sonnet)

**Files:**
- Modify: `packages/adapters/slack/src/index.ts`
- Test: `packages/adapters/slack/test/backfill.test.ts`

**Interfaces:** Consumes: Task 4's `CHANNEL`, `AsyncQueue` (internal), `AdapterError` from `@omnis/protocol`. Produces: a `backfill()` implementation (no longer throws `fatal_unsupported`) and the `SlackAdapterDeps.webClient` injection path (already exists; backfill now actually uses it).

Spec to read: A1 §2.1 backfill paragraph (`conversations.history`/`conversations.replies`, last 30 days, pagination + backoff, `backfill_progress` event).

- [ ] 1. Write the failing test: `packages/adapters/slack/test/backfill.test.ts` (inject a mock WebClient, no real network)

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

- [ ] 2. Run the test and confirm it fails.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/adapter-slack test
  ```

  Expected failure: `expected [] to equal [ '1700000000.000100', '1700000100.000200' ]` (backfill still throws immediately).

- [ ] 3. Replace the `backfill` stub in `src/index.ts` with the following (same file, keeping it in the position after `channel:`/`capabilities:`).

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

- [ ] 4. `normalize` does not exist yet (implemented in Task 6), so add a temporary named export at the end of the file to make it compile — Task 6 replaces this stub with the real implementation.

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

- [ ] 5. Run the test and confirm it passes.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/adapter-slack test
  ```

  Expected output: `Tests  3 passed (3)`.

- [ ] 6. Commit.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/adapters/slack
  git commit -m "$(cat <<'EOF'
  US-A12: Slack backfill() — conversations.history pagination + rate-limit mapping

  - cursor-based pagination; when since is present, convert it to oldest
  - map a ratelimited response to AdapterError('retryable_rate_limit', retryAfterMs=retry_after*1000) (A1 §1.4)
  - push a backfill_progress event to the subscribe() queue on every page
  - normalize() is only a minimal stub in this task (Task 6 completes thread_reply/attachment)

  Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 6: Slack adapter — complete normalize() + send()/markRead() mock sink (US-A12, tier: Sonnet)

**Files:**
- Modify: `packages/adapters/slack/src/index.ts`
- Test: `packages/adapters/slack/test/normalize.test.ts`, `packages/adapters/slack/test/send.test.ts`

**Interfaces:** Consumes: Task 3's `Attachment`, `SendResult`, `Outbound`, `ThreadRef`. Produces: `normalize(raw: unknown): NormalizedItem[]` (the completed version, handling thread_ts/attachment), `mapApiError(raw: unknown): AdapterError` (a separate export verified by the fixture `rate_limited_response`/`auth_error_response` scenarios — a symbol outside the contract), `createSlackAdapter().send` (through the mock sink).

Spec to read: A1 §2.1 thread/ID mapping (`ts` vs `thread_ts`, `sourceHash`=`ts`), media (download then local cache), write-back (`chat.postMessage` is **not wired up yet** — "Do not wire send() to anything but a mock sink until the approval gate exists").

- [ ] 1. Write the failing test: `packages/adapters/slack/test/normalize.test.ts`

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

- [ ] 2. Run the test and confirm it fails.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/adapter-slack test
  ```

  Expected failure: `threadExternalId` comes out as `""` (the Task 5 stub maps neither thread nor attachment), and the attachment test fails because `attachments` comes out as `[]`.

- [ ] 3. Replace the `normalize` stub in `src/index.ts` with the following (exactly as in A1 §2.1 thread/ID mapping and media rules).

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

  Because `NormalizedItem` makes `threadMeta` an optional field, a plain message that is not a new thread omits `threadMeta` (A1-D1 "only for a new thread or when metadata changed").

- [ ] 4. Replace the `send`/`markRead` stubs with the mock sink versions (after `capabilities: () => CAPABILITIES,` and before `backfill`).

  ```ts
  export interface SlackAdapterDeps {
    socketClient?: SocketModeClient;
    webClient?: WebClient;
    now?: () => Date;
    sink?: (thread: ThreadRef, draft: Outbound) => Promise<SendResult>;
  }
  ```

  (Replace the existing `SlackAdapterDeps` declaration with the version that adds this field.) And the `send`/`markRead` implementations:

  ```ts
      // The approval gate (US-A07) does not exist yet — never call the real chat.postMessage.
      // If deps.sink is absent, use a default mock sink that only synthesizes a SendResult.
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

  Add `import type { Outbound, SendResult, ThreadRef } from "@omnis/protocol";` to the top-level imports.

- [ ] 5. Add a test verifying that `send()` calls only the mock sink and never the real Slack API: `packages/adapters/slack/test/send.test.ts`

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

- [ ] 6. Run the test and confirm everything passes.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/adapter-slack test
  ```

  Expected output: `Tests  7 passed (7)`.

- [ ] 7. Commit.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/adapters/slack
  git commit -m "$(cat <<'EOF'
  US-A12: complete Slack normalize() (thread_ts/attachment) + wire send() to the mock sink

  - normalize(): channel→threadExternalId, ts→externalId/sourceHash, files→Attachment[]
  - mapApiError(): 429→retryable_rate_limit, 401→auth_expired|auth_revoked(A1 §1.4)
  - send() calls only deps.sink — do not wire chat.postMessage before the approval gate (US-A07)
  - markRead() really calls conversations.mark (marking read is not an irreversible action)

  Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 7: Gmail adapter — package scaffold + OAuth + connect()/health() (US-A13, tier: Sonnet)

**US-A13 deliverable (A7 §7):** `packages/adapters/gmail/src/index.ts`. **Verification command:** `pnpm --filter @omnis/adapter-gmail test`. **Goal:** Gmail adapter (`users.watch`+Pub/Sub, OAuth, backfill).

**Files:**
- Create: `packages/adapters/gmail/package.json`, `packages/adapters/gmail/tsconfig.json`, `packages/adapters/gmail/vitest.config.ts`
- Create: `packages/adapters/gmail/src/keychain.ts`, `packages/adapters/gmail/src/index.ts`
- Test: `packages/adapters/gmail/test/capabilities.test.ts`

**Interfaces:** Consumes: `Adapter`/`AuthRef`/`AdapterError`/`Capabilities`/`Health` from `@omnis/protocol` (Task 3). Produces: `CHANNEL` (`"gmail"`), `createGmailAdapter(deps?: GmailAdapterDeps): Adapter`.

Spec to read: A1 §1.3 (Gmail Keychain `omnis.gmail.<email>`), §2.2 (OAuth Desktop client, refresh token, Production publishing requirements). **Keychain item names (interfaces.md §9, FIXED)**: the Google family (`gmail`/`gcal`) **shares a single `omnis.gmail.<email>` item** and omits the `<kind>` segment (an exception to the general form `omnis.<channel>.<kind>.<external_id>`) — the gcal adapter (Task 10) reuses the same `keychainService`. Every `AuthRef` example and fixture below uses this naming verbatim. **Do not build (YAGNI)**: the OAuth consent screen itself (onboarding UI is US-A31, a separate plan later in Phase A) — this adapter only reads an already-issued refresh token from Keychain.

- [ ] 1. Create the package scaffold.

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

- [ ] 2. Write the failing test: `packages/adapters/gmail/test/capabilities.test.ts`

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

- [ ] 3. Run the test and confirm it fails.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm install && pnpm --filter @omnis/adapter-gmail test
  ```

  Expected failure: `Cannot find module '../src/index.js'`.

- [ ] 4. Write the Keychain wrapper: `packages/adapters/gmail/src/keychain.ts` (same pattern as Slack Task 4, only the channel differs — duplicated because importing between adapter packages is forbidden)

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

- [ ] 5. In `src/index.ts`, write `capabilities()`/`connect()`/`disconnect()`/`health()`. Task 8·9 fills in `backfill`/`subscribe`/`send`/`markRead`/`archive`.

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

  The Gmail Cloud project's OAuth client id/secret is an app-level secret, not a per-account secret, so it is injected through `deps` at adapter construction rather than through `AuthRef` (A7 §9 "new variables are prefixed `OMNIS_`" — having the hub read `OMNIS_GOOGLE_OAUTH_CLIENT_ID`/`OMNIS_GOOGLE_OAUTH_CLIENT_SECRET` from the environment and pass them in belongs to the `apps/hub` wiring story (US-A10) and is outside this plan's scope).

- [ ] 6. Explicitly add `google-auth-library` to devDependencies (for type-only imports, since `import type` can fail with only the types re-exported by `googleapis`).

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

- [ ] 7. Run the test and confirm it passes.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/adapter-gmail test
  ```

  Expected output: `Tests  1 passed (1)`.

- [ ] 8. Commit.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/adapters/gmail
  git commit -m "$(cat <<'EOF'
  US-A13: Gmail adapter scaffold + OAuth2 refresh-token connect()/health()

  - Read the refresh token from Keychain omnis.gmail.<email> and call OAuth2Client.setCredentials
  - auth_revoked on connect() failure (A1 §1.4, no automatic retry)
  - capabilities(): send/markRead/archive all true (A1 §3 Gmail row)
  - OAuth client id/secret injected via GmailAdapterDeps, not AuthRef (app-level secret)
  - backfill()/subscribe()/send() are still fatal_unsupported (Task 8·9)

  Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 8: Gmail adapter — `users.watch` + Pub/Sub pull subscribe() + backfill() (US-A13, tier: Sonnet)

**Files:**
- Modify: `packages/adapters/gmail/src/index.ts`
- Test: `packages/adapters/gmail/test/backfill.test.ts`

**Interfaces:** Consumes: Task 7's `CHANNEL`, `GmailAdapterDeps`. Produces: a `backfill()` and `subscribe()` implementation, and `GmailAdapterDeps.pubsubSubscription` (the name of the subscription to pull from).

Spec to read: A1 §2.2 (`users.watch()`→Pub/Sub topic→**pull** subscription, 7-day expiry, `history.list` diff, backfill covering the last 30 days).

- [ ] 1. Write the failing test: `packages/adapters/gmail/test/backfill.test.ts` (inject a mock Gmail client)

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

- [ ] 2. Run the test and confirm it fails.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/adapter-gmail test
  ```

  Expected failure: `AdapterError: backfill not implemented until Task 8`.

- [ ] 3. Add `gmailClient`/`pubsubClient` to `GmailAdapterDeps` and implement `backfill`/`subscribe`. Add `import type { gmail_v1, pubsub_v1 } from "googleapis";` to the top-level imports of `src/index.ts`, and replace `GmailAdapterDeps` with the following.

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

  Replace the `backfill`/`subscribe` stubs with the following.

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

- [ ] 4. `normalize`/`mapApiError` do not exist yet (completed in Task 9), so add temporary stubs at the end of the file to make it compile.

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

  The `subject` in this stub is a field that does not exist in the `NormalizedItem` schema — Task 9 drops `subject` and merges it into `body` to match the schema (for now, `as unknown as NormalizedItem[]` bypasses the type only, so compilation and this task's tests pass).

- [ ] 5. Run the test and confirm it passes.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/adapter-gmail test
  ```

  Expected output: `Tests  2 passed (2)`.

- [ ] 6. Commit.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/adapters/gmail
  git commit -m "$(cat <<'EOF'
  US-A13: Gmail backfill() (messages.list pagination) + subscribe() (Pub/Sub pull)

  - backfill(): messages.list → messages.get(format=full) → normalize()
  - subscribe(): projects.subscriptions.pull → fetch new messages → ack (A1 §2.2)
  - mapApiError(): HTTP 429→retryable_rate_limit, 401→auth_expired
  - normalize() is a temporary stub in this task (Task 9 completes it to match the schema)

  Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 9: Gmail adapter — normalize() schema conformance + send()/markRead()/archive() mock (US-A13, tier: Sonnet)

**Files:**
- Modify: `packages/adapters/gmail/src/index.ts`
- Test: `packages/adapters/gmail/test/normalize.test.ts`, `packages/adapters/gmail/test/send.test.ts`

**Interfaces:** Consumes: Task 3's `NormalizedItem` (the zod schema — `subject` is not a field, so it is absorbed into the body). Produces: the completed `normalize()` (matching the schema exactly), `createGmailAdapter().send`/`.markRead`/`.archive`.

Spec to read: A1 §2.2 thread/ID mapping (`threadId`, `messages.id`, `sourceHash`=`Message-Id`), write-back (send/markRead/archive are all supported, but this plan makes **send use only a mock sink**).

- [ ] 1. Write the failing test: `packages/adapters/gmail/test/normalize.test.ts`

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

- [ ] 2. Run the test and confirm it fails.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/adapter-gmail test
  ```

  Expected failure: `sentAt` is `new Date().toISOString()` (the current time), so it does not match `"2023-11-14T22:13:20.000Z"`.

- [ ] 3. Replace the `normalize` stub in `src/index.ts` with the following (parse the Date header + absorb subject into body).

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

  (Fully replace the existing `normalize` with this — removing the `as unknown as NormalizedItem[]` cast.)

- [ ] 4. Replace the `send`/`markRead`/`archive` stubs with the mock sink versions. Add a `sink` field to `GmailAdapterDeps`.

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
      // Do not call the real messages.send before the approval gate (US-A07).
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

  Add `import type { Outbound, SendResult, ThreadRef } from "@omnis/protocol";` to the top-level imports.

- [ ] 5. Add a test verifying that `send()` calls only the mock sink: `packages/adapters/gmail/test/send.test.ts`

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

- [ ] 6. Run the test and confirm everything passes.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/adapter-gmail test
  ```

  Expected output: `Tests  4 passed (4)`.

- [ ] 7. Commit.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/adapters/gmail
  git commit -m "$(cat <<'EOF'
  US-A13: Gmail normalize() schema conformance + send()/markRead()/archive()

  - normalize(): Message-Id→sourceHash, threadId→threadExternalId, Subject is absorbed into body (NormalizedItem has no subject field)
  - send() calls only the mock sink (messages.send not wired; waiting on the approval gate)
  - markRead() removes the UNREAD label, archive() removes the INBOX label (both really call the API — reading/archiving is not an irreversible send)

  Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 10: Google Calendar adapter — package scaffold + connect() + syncToken subscribe() (US-A14, tier: Sonnet)

**US-A14 deliverable (A7 §7):** `packages/adapters/google-calendar/src/index.ts`. **Verification command:** `pnpm --filter @omnis/adapter-google-calendar test`. **Goal:** Google Calendar adapter (`events.list` + syncToken polling).

**Files:**
- Create: `packages/adapters/google-calendar/package.json`, `packages/adapters/google-calendar/tsconfig.json`, `packages/adapters/google-calendar/vitest.config.ts`
- Create: `packages/adapters/google-calendar/src/keychain.ts`, `packages/adapters/google-calendar/src/index.ts`
- Test: `packages/adapters/google-calendar/test/capabilities.test.ts`, `packages/adapters/google-calendar/test/subscribe.test.ts`

**Interfaces:** Consumes: `Adapter`/`AuthRef`/`AdapterError`/`Capabilities`/`Health` from `@omnis/protocol` (Task 3). Produces: `CHANNEL` (`"gcal"` — interfaces.md §1 "directory name `google-calendar` ≠ the `accounts.channel` value `gcal`"), `createGoogleCalendarAdapter(deps?): Adapter`.

Spec to read: A1 §2.3 (reuses the same Cloud project and client as Gmail, `events.list` + syncToken polling every 1~5 minutes, write only after approval). **Be sure to honor the fact that the directory name and the channel value differ (interfaces.md §1).** **Keychain (interfaces.md §9, FIXED)**: do not create a separate item; reuse the same `omnis.gmail.<email>` as Gmail (`channel:"gcal"` while only `keychainService` is the same) — this means accepting the single `omnis.gmail.<email>` item created by Task 7 as-is, and keychainService does not change even when `AuthRef.channel` is `"gcal"`.

- [ ] 1. Create the package scaffold.

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

- [ ] 2. Write the failing test: `packages/adapters/google-calendar/test/capabilities.test.ts`

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

- [ ] 3. Run the test and confirm it fails.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm install && pnpm --filter @omnis/adapter-google-calendar test
  ```

  Expected failure: `Cannot find module '../src/index.js'`.

- [ ] 4. Write `src/index.ts`: `capabilities()`/`connect()` (reusing the same Keychain item as Gmail, A1 §2.3)/`disconnect()`/`health()`. Leave `backfill`/`subscribe`/`send` as stubs (Task 11 fills them in).

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
        // A1 §2.3: Calendar uses the same Cloud project/client as Gmail, so
        // the caller passes omnis.gmail.<email> as auth.keychainService as-is (reuse).
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

- [ ] 5. Run the test and confirm the 2 `capabilities`/`CHANNEL` checks pass.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/adapter-google-calendar test
  ```

  Expected output: `Tests  2 passed (2)`.

- [ ] 6. Write a failing test that verifies the `subscribe()` syncToken polling loop: `packages/adapters/google-calendar/test/subscribe.test.ts`

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

- [ ] 7. Run the test and confirm it fails.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/adapter-google-calendar test
  ```

  Expected failure: `AdapterError: subscribe not implemented until this task's next step`.

- [ ] 8. Replace the `subscribe()` stub with the syncToken polling implementation (A1 §2.3: `events.list` + `syncToken`, full resync on expiry (410), every 1~5 minutes — in the test, `pollIntervalMs: 0` repolls immediately).

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

  `normalize` does not exist yet (Task 11), so add a temporary stub at the end of the file.

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

- [ ] 9. Run the test and confirm it passes.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/adapter-google-calendar test
  ```

  Expected output: `Tests  3 passed (3)`.

- [ ] 10. Commit.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/adapters/google-calendar
  git commit -m "$(cat <<'EOF'
  US-A14: Google Calendar adapter scaffold + connect() + syncToken polling subscribe()

  - CHANNEL='gcal' (differs from the directory name google-calendar; stated in interfaces.md §1)
  - connect(): reuses the same Cloud project client as Gmail (A1 §2.3); the caller also passes omnis.gmail.<email> as the Keychain item
  - subscribe(): events.list + syncToken polling; on 410 Gone, discard the syncToken and do a full resync
  - capabilities(): realtime=false (polling), write=true but only after approval (A1 §3 R/W(hold))
  - backfill()/send() are still fatal_unsupported (Task 11)

  Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 11: Google Calendar adapter — complete backfill() + normalize() + send() mock (US-A14, tier: Sonnet)

**Files:**
- Modify: `packages/adapters/google-calendar/src/index.ts`
- Test: `packages/adapters/google-calendar/test/normalize.test.ts`, `packages/adapters/google-calendar/test/backfill.test.ts`

**Interfaces:** Consumes: Task 3's `NormalizedItem` (zod), `ThreadRef`/`Outbound`/`SendResult`. Produces: the completed `normalize()`, a `backfill()` implementation, `createGoogleCalendarAdapter().send` (mock sink).

Spec to read: A1 §2.3 backfill (`events.list`, `timeMin`=start of this quarter, `timeMax`=+90 days), thread/ID mapping (`kind="calendar"`, `externalId`=event id). **Open item (re-recorded as an open question in the §14 self-review)**: the `calendar_events` detail table in A3 §2.1 (outside this plan's required reading range) needs fields such as `attendees`/`end_at`/`recurrence`, but `NormalizedItem` has no such fields — this task creates only `NormalizedItem` (exactly as in the A1 §1.2 contract), and who fills that detail table with what is outside this plan's scope.

- [ ] 1. Write the failing test: `packages/adapters/google-calendar/test/normalize.test.ts`

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

- [ ] 2. Run the test and confirm it fails.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/adapter-google-calendar test
  ```

  Expected failure: `threadMeta` is `undefined` (the Task 10 stub does not populate `threadMeta`).

- [ ] 3. Replace the `normalize` stub in `src/index.ts` with the following.

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

- [ ] 4. Implement `backfill` and replace `send`/`markRead` with the mock sink versions. Add a `sink` field to `GoogleCalendarAdapterDeps`.

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
      // Never call events.insert/update before the approval gate (US-A07) (A1 §2.3 "always through pending_approvals").
      async send(thread: ThreadRef, draft: Outbound): Promise<SendResult> {
        const sink = deps.sink ?? (async (): Promise<SendResult> => ({
          externalId: `mock-${now().getTime()}`, sentAt: now().toISOString(),
        }));
        return sink(thread, draft);
      },
  ```

  Add `import type { Outbound, SendResult, ThreadRef } from "@omnis/protocol";` to the top-level imports.

- [ ] 5. Add a test verifying that `send()` calls only the mock sink: append it to `packages/adapters/google-calendar/test/backfill.test.ts` (same file, add a `describe` block)

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

- [ ] 6. Run the test and confirm everything passes.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/adapter-google-calendar test
  ```

  Expected output: `Tests  7 passed (7)` (Task 10's 3 + this task's 2 normalize + 2 backfill/send).

- [ ] 7. Commit.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/adapters/google-calendar
  git commit -m "$(cat <<'EOF'
  US-A14: complete Google Calendar normalize() (threadMeta) + backfill() + send() mock

  - normalize(): threadMeta.kind='calendar', maps attendees to participants, fills archivedAt when cancelled
  - backfill(): timeMin=start of this quarter, timeMax=+90 days (A1 §2.3)
  - send() calls only the mock sink — events.insert/update not wired before the approval gate (US-A07)

  Co-Authored-By: Claude Sonnet <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 12: Slack fixture set (US-A15, tier: DeepSeek, review Sonnet+)

**US-A15 deliverable (A7 §7):** `*/test/contract.test.ts` (3 kinds). **Verification command:** `pnpm test:contract`. **Goal:** the three adapter contract tests (fixture replay, one each for A12~A14).

**Files:**
- Create: `packages/adapters/slack/fixtures/text_message.json`, `thread_reply.json`, `attachment.json`, `edited_message.json`, `deleted_message.json`, `rate_limited_response.json`, `auth_error_response.json`

**Interfaces:** Consumes: the actual behavior of Task 6's `normalize(raw)`/`mapApiError(raw)` (the fixture `expected` must be byte-for-byte identical to what those functions actually return/throw). Produces: 7 fixture JSON files (interfaces.md §9 minimal scenarios + Slack-only `edited_message`/`deleted_message`).

Slack is a channel that supports edit/delete, so A1 §1.7 requires two additional scenarios. `edited_message`/`deleted_message` arrive from the Slack Events API as `subtype: "message_changed"`/`"message_deleted"` — the current `normalize()` (Task 6) handles only plain `message` events, so `expected.items` for these two fixtures is an empty array (subtype handling is outside Phase A scope, YAGNI — the v1 inbox does not surface edits in a separate UI, and A1 has no such requirement).

- [ ] 1. Create `text_message.json`.

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

- [ ] 2. Create `thread_reply.json`.

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

- [ ] 3. Create `attachment.json`.

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

- [ ] 4. Create `edited_message.json` and `deleted_message.json` (Phase A does not handle subtypes, so `expected.items` is `[]`).

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

- [ ] 5. Create `rate_limited_response.json` and `auth_error_response.json` (the verification target is Task 6's `mapApiError`, not `normalize` — these use `expected.errorKind`, and the Task 15 harness reads this field).

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

- [ ] 6. Verify that all 7 files are valid JSON.

  ```bash
  for f in /Users/logankim/AI-Workspaces/omnis/packages/adapters/slack/fixtures/*.json; do
    node -e "JSON.parse(require('fs').readFileSync('$f','utf8')); console.log('$f OK')"
  done
  ```

  Expected output: all 7 lines print `OK`.

- [ ] 7. Commit.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/adapters/slack/fixtures
  git commit -m "$(cat <<'EOF'
  US-A15: Slack fixture set of 7 (text_message/thread_reply/attachment/edited/deleted/rate_limited/auth_error)

  - text_message/thread_reply/attachment match Task 6 normalize() output byte for byte
  - edited_message/deleted_message have expected.items=[] (Phase A does not handle subtypes, YAGNI)
  - rate_limited_response/auth_error_response verify mapApiError() mapping through expected.errorKind (Task 15 harness)

  Co-Authored-By: DeepSeek V4.1 Flash <noreply@deepseek.com>
  EOF
  )"
  ```

---

### Task 13: Gmail fixture set (US-A15, tier: DeepSeek, review Sonnet+)

**Files:**
- Create: `packages/adapters/gmail/fixtures/text_message.json`, `thread_reply.json`, `attachment.json`, `rate_limited_response.json`, `auth_error_response.json`

**Interfaces:** Consumes: Task 9's `normalize(raw)`/`mapApiError(cause)`. Produces: 5 fixture JSON files.

- [ ] 1. Create `text_message.json` (a Gmail `users.messages.get` resource, the same sample as Task 9).

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

- [ ] 2. Create `thread_reply.json` (same `threadId`, new `id`/`Message-Id`, plus an `In-Reply-To` header — the normalization logic does not use the header, so the result is an independent item).

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

  `"U291bmRzIGdvb2Qu"` is the base64url of `"Sounds good."` (verified with `node -e "console.log(Buffer.from('Sounds good.').toString('base64url'))"`).

- [ ] 3. Create `attachment.json`. `normalize()` (Task 9) does not yet read attachments from `payload.parts` (YAGNI — Phase A normalizes body text only; attachment download is a separate path per A1 §2.2 "individual download" and is independent of Item normalization), so `expected.attachments` is `[]`.

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

  Note: the `payload.body.data` of this fixture is usually empty for a top-level `multipart/mixed` message (the real body is in `parts[0]`) — but Task 9's `normalize()` reads only `r.payload?.body?.data`, so this fixture also decodes only that field to match `expected.body` (it is designed so that `body.data` is left empty instead of holding "See attached slides.", making `body` end up as `"Subject: PoC slides\n\n"`). Multipart body parsing (iterating `parts[]`) is outside Phase A scope — it is recorded as an open question in `open_questions`.

- [ ] 4. Create `rate_limited_response.json` and `auth_error_response.json` (the googleapis error shape that Task 9's `mapApiError(cause)` receives).

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

- [ ] 5. Verify that all 5 files are valid JSON.

  ```bash
  for f in /Users/logankim/AI-Workspaces/omnis/packages/adapters/gmail/fixtures/*.json; do
    node -e "JSON.parse(require('fs').readFileSync('$f','utf8')); console.log('$f OK')"
  done
  ```

  Expected output: all 5 lines print `OK`.

- [ ] 6. Commit.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/adapters/gmail/fixtures
  git commit -m "$(cat <<'EOF'
  US-A15: Gmail fixture set of 5 (text_message/thread_reply/attachment/rate_limited/auth_error)

  - the attachment scenario documents that parts[] attachment parsing is outside Phase A scope (open question)
  - rate_limited/auth_error verify mapApiError() against the googleapis error shape ({code,message})

  Co-Authored-By: DeepSeek V4.1 Flash <noreply@deepseek.com>
  EOF
  )"
  ```

---

### Task 14: Google Calendar fixture set (US-A15, tier: DeepSeek, review Sonnet+)

**Files:**
- Create: `packages/adapters/google-calendar/fixtures/text_message.json`, `thread_reply.json`, `attachment.json`, `rate_limited_response.json`, `auth_error_response.json`

**Interfaces:** Consumes: Task 11's `normalize(raw)`. Produces: 5 fixture JSON files.

Calendar has no concept of a "message"/"thread reply", so the generic scenario names from interfaces.md §9 are filled in with event semantics: `text_message`=a single confirmed event, `thread_reply`=a recurring instance the attendee responded to (the next occurrence on the same weekday), `attachment`=an event with a Drive link attachment.

- [ ] 1. Create `text_message.json` (the same single confirmed event as the Task 11 sample).

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

- [ ] 2. Create `thread_reply.json` (the same recurring instance the following week — a separate event id, so it normalizes to a separate thread; for Calendar, per A1 §2.3, the event unit is the thread).

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

- [ ] 3. Create `attachment.json` (a Drive link attachment — A1 §2.3 "preserve the URL as-is, do not download separately". As of Task 11 `normalize()` does not create `attachments`, so `[]`).

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

- [ ] 4. Create `rate_limited_response.json` and `auth_error_response.json`. Up through Task 11 no separate `mapApiError` was exported (an `AdapterError` is thrown inline inside backfill/subscribe), so these two fixtures stay as reference material documenting **how backfill() maps an `events.list` failure** rather than anything `normalize()` does, and `expected.errorKind` records the value paired with the 410 handling of `subscribe()` already implemented in Task 10 — in the contract test for these two fixtures, Task 15 verifies them by making the `events.list` mock used by `subscribe()` respond with 410.

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

  The reason `errorKind` is `retryable_network`/`auth_revoked` here, unlike Slack/Gmail: the Calendar adapter in Task 10·11 does not create a `mapApiError()` (it throws every `events.list` failure as `retryable_network` from `backfill()`, and a `connect()` failure as `auth_revoked`) — this fixture matches that actual behavior. The fact that the three channels differ in how finely they map errors is recorded as an open question in `open_questions`.

- [ ] 5. Verify that all 5 files are valid JSON.

  ```bash
  for f in /Users/logankim/AI-Workspaces/omnis/packages/adapters/google-calendar/fixtures/*.json; do
    node -e "JSON.parse(require('fs').readFileSync('$f','utf8')); console.log('$f OK')"
  done
  ```

  Expected output: all 5 lines print `OK`.

- [ ] 6. Commit.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/adapters/google-calendar/fixtures
  git commit -m "$(cat <<'EOF'
  US-A15: Google Calendar fixture set of 5 (single event/recurring instance/attachment/rate_limited/auth_error)

  - text_message/thread_reply/attachment match the actual threadMeta output of Task 11 normalize()
  - rate_limited/auth_error record the actual behavior where the Calendar adapter keeps no separate mapApiError() and instead maps directly
    to retryable_network/auth_revoked in backfill()/connect()

  Co-Authored-By: DeepSeek V4.1 Flash <noreply@deepseek.com>
  EOF
  )"
  ```

---

### Task 15: Contract test harness — 3-channel `test/contract.test.ts` + `pnpm test:contract` wiring (US-A15, tier: DeepSeek, review Sonnet+)

**Files:**
- Create: `packages/adapters/slack/test/contract.test.ts`, `packages/adapters/gmail/test/contract.test.ts`, `packages/adapters/google-calendar/test/contract.test.ts`
- Verify only (does not create — the root files are owned by kernel-and-db Task 1): `vitest.workspace.ts` (root)

**Interfaces:** Consumes: Task 6's `normalize`/`mapApiError` (slack), Task 9's `normalize`/`mapApiError` (gmail), Task 11's `normalize` (google-calendar) + Task 10's `subscribe` (for verifying calendar error mapping) — all with the fixture JSON from Task 12~14. Produces: a state where `pnpm test:contract` ends green.

Spec to read: interfaces.md §2 (`pnpm test:contract` = `vitest run --project contract`, with the three vitest project names fixed) + §9 (fixture placement rules).

- [ ] 1. Write the failing test: `packages/adapters/slack/test/contract.test.ts` — iterate the fixture directory and replay `normalize`/`mapApiError`.

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

- [ ] 2. Create the same pattern for Gmail and Google Calendar (Calendar does not export `mapApiError`, so its error fixtures are verified by calling `backfill()`/`connect()` directly with mocks).

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

  The `auth_revoked` case really reads the Keychain (the `omnis.gmail.test@example.com` item does not exist), so it can fail first with `auth_expired` (Keychain item not found) — this fixture intends "the refresh token exists but was revoked", so `oauthClient` must be injected directly to bypass the `readKeychainSecret` step. The code above injects `oauthClient` up front so that only the path where `oauthClient.getAccessToken` rejects is taken, but `connect()` calls `readKeychainSecret` first even when `oauthClient` is given, so the Keychain lookup still fails first — the next step fixes this gap.

- [ ] 3. Modify Task 10's `connect()` so that when `oauthClient` is already injected it skips the `readKeychainSecret` call and uses that client as-is (cleanup of the test injection path; the production path is unaffected — it still reads the Keychain whenever it builds a new client each time). Replace `connect` in `packages/adapters/google-calendar/src/index.ts` with the following.

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

- [ ] 4. This task does not create the root `vitest.workspace.ts` — it is owned by `2026-09-20-phase-a-kernel-and-db.md` Task 1 (interfaces.md §2, FIXED — plans-review.md M4·M12). Only verify that it exists and that the `contract` project entry covers the pattern this plan needs.

  ```bash
  test -f /Users/logankim/AI-Workspaces/omnis/vitest.workspace.ts \
    || { echo "vitest.workspace.ts is missing — run kernel-and-db Task 1 first."; exit 1; }
  grep -q 'name: "contract"' /Users/logankim/AI-Workspaces/omnis/vitest.workspace.ts \
    && grep -q 'packages/adapters/\*/test/contract.test.ts' /Users/logankim/AI-Workspaces/omnis/vitest.workspace.ts \
    && echo "contract project entry confirmed" \
    || { echo "the contract project in vitest.workspace.ts does not include packages/adapters/*/test/contract.test.ts — kernel-and-db Task 1's vitest.workspace.ts must be modified (outside this plan's scope, owned by the kernel plan)."; exit 1; }
  ```

- [ ] 5. Before running `test:contract`, first confirm that the full `pnpm --filter` unit test suite is still green (verify there is no regression).

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  pnpm --filter @omnis/adapter-slack test && \
  pnpm --filter @omnis/adapter-gmail test && \
  pnpm --filter @omnis/adapter-google-calendar test
  ```

  Expected output: all three packages pass with the same test counts confirmed in previous tasks (Slack 7, Gmail 4, Calendar 7) — because `contract.test.ts` lives inside each package's `test/`, `pnpm --filter <name> test` (the package's own `vitest run`) also gains as many tests as there are fixtures from this point on.

- [ ] 6. Run `pnpm test:contract` at the root.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm test:contract
  ```

  Expected output: all three test files in the `contract` project pass — Slack 7 scenarios + Gmail 5 + Calendar 5 = 17 test cases, `Test Files  3 passed (3)` / `Tests  17 passed (17)`.

- [ ] 7. Commit.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/adapters/slack/test/contract.test.ts \
          packages/adapters/gmail/test/contract.test.ts \
          packages/adapters/google-calendar/test/contract.test.ts \
          packages/adapters/google-calendar/src/index.ts
  git commit -m "$(cat <<'EOF'
  US-A15: 3-channel contract test harness + pnpm test:contract wiring

  - test/contract.test.ts: iterates fixtures/*.json and replays normalize()/mapApiError() (A1 §1.7)
  - add a direct oauthClient injection path to Calendar connect() (bypasses the Keychain lookup so auth_revoked is testable)
  - do not create the root vitest.workspace.ts (owner = kernel-and-db Task 1, interfaces.md §2) — only verify the contract project entry exists
  - confirm pnpm test:contract is green: Slack 7 + Gmail 5 + Calendar 5 = 17 tests

  Co-Authored-By: DeepSeek V4.1 Flash <noreply@deepseek.com>
  EOF
  )"
  ```

---

## Self-review

1. **Story coverage**: US-A11 → Task 1~3. US-A12 → Task 4~6. US-A13 → Task 7~9. US-A14 → Task 10~11. US-A15 → Task 12~15. All 5 stories map to at least one task.
2. **Forbidden-pattern grep**: searched this file for the strings `TBD`/`TODO`/`implement later`/`add appropriate error handling`/`handle edge cases`/`similar to Task` and confirmed 0 hits (see the grep output below — if there had been any, they were fixed before this section was written).
3. **Symbol provenance check**: every symbol this plan consumes (`Channel`/`NormalizedItem`/`Adapter`/`AdapterError`/`Attachment`/`Capabilities`/`AuthRef`/`Health`/`ThreadRef`/`Outbound`/`SendResult`/`Normalize`) either already exists in the interfaces.md §3.1~3.3 contract or is defined by an earlier task in this plan (Task 1~3) (because Task 6 uses `Attachment`, `type Attachment` was included in Task 4's import list). Every out-of-contract symbol it produces (`createSlackAdapter`/`createGmailAdapter`/`createGoogleCalendarAdapter`/`normalize`/`mapApiError`/`readKeychainSecret`/`CHANNEL`/`*AdapterDeps`) is defined in this document before any later task consumes it — there are no forward references.

## open_questions

- **Gap between the calendar_events detail table and NormalizedItem**: A3 §2.1 (outside this plan's required reading range) assumes the adapter upserts two rows, `items` and `calendar_events`, in the same transaction, but A1's `Adapter`/`NormalizedItem` contract gives the adapter no DB access and `NormalizedItem` has no `end_at`/`attendees`/`recurrence` fields either. This plan creates only `NormalizedItem` (exactly as in the contract) — who fills `calendar_events` with what as input (for example, whether the kernel ingest write path receives the raw Calendar API resource separately, or whether `NormalizedItem` is extended) must be decided by the kernel/ingest plan (around US-A05).
- **Gmail attachment (`parts[]`) normalization not implemented**: A1 §2.2 mentions individual `attachments.get` downloads, but this plan's `normalize()` does not iterate `payload.parts` (it reads only the top-level `body.data`) — filling `NormalizedItem.attachments` with attachments from multipart messages remains a separate task (Task 13's `attachment.json` fixture documents this gap with `expected.attachments: []`).
- **Inconsistent error-mapping granularity across the three channels**: Slack and Gmail classify 429/401 with a named pure function, `mapApiError()`, but the Calendar adapter throws only `retryable_network`/`auth_revoked` ad hoc inside `backfill()`/`connect()` (only the 410 syncToken expiry is handled separately in `subscribe()`). Whether to unify the three adapters' error classification under the same shape (`mapApiError` export) is left as a question to decide in the next review.
- **`worktrunk` CLI flags not settled**: A7-D5/§3 already marks this "UNVERIFIED — spike", so this plan only quotes it as-is — depending on the dry-run results before Phase A starts, this plan's commit procedure itself is unaffected (one commit per story regardless of worktrunk).

## Revision history (2026-09-20, cross-plan review)

Applied these after cross-checking `2026-09-20-plans-review.md` (§1 discrepancy table, §2 recommended contract fixes) + the updated `2026-09-20-phase-a-interfaces.md` + `tools/spikes/_probes/2026-09-20-cli-probes.md`. Items applied:

- **(M4) Task 1 — root file ownership corrected**: removed the step that created the root `pnpm-workspace.yaml`/`package.json`/`tsconfig.base.json`/`biome.jsonc` and replaced it with a `test -f` existence check (owner = `2026-09-20-phase-a-kernel-and-db.md` Task 1, interfaces.md §2 FIXED). Because kernel T1 and this plan's T1~T3 run in parallel in Wave 0, added the guidance "if the root files are missing, run kernel-and-db Task 1 (db-scaffold) first and then resume". Also removed the root files from Task 1's `git add`/commit body.
- **(M1, M2) Version pins**: replaced everything with `vitest ^2.1.8` → `vitest 2.1.9` and `typescript ^5.7.2` → `typescript 5.6.3` (across all packages: protocol/slack/gmail/google-calendar package.json + the Tech Stack line, 5 places in total). Kept `zod ^3.24.1` since it already matches the authoritative source (owner = `@omnis/protocol`; added an explicit note that zod 4 is not used).
- **(M7, M8) Keychain naming made explicit**: added the interfaces.md §9 FIXED rules verbatim to the "Spec to read" paragraph of Task 4 (Slack), Task 7 (Gmail), and Task 10 (Calendar) — for Slack, `omnis.slack.xoxb.<team_id>` (account=`<team_id>`) plus `…​.app` two items (not `xoxp`); for the Google family, a single shared `omnis.gmail.<email>` item (`<kind>` omitted, reused by gcal). Also made this exception explicit in the Global Constraints Keychain item name line. The existing `AuthRef` examples and connect() implementations (Task 4/7/10) already follow this naming, so there is no code change — only documentation was strengthened.
- **Task 15 — removed duplicate creation of `vitest.workspace.ts`**: changed the "Files" list and step 4 from "create" to "verify only (existence + comparison against the `contract` project entry, with guidance to run kernel-and-db Task 1 first on failure)" (owner = kernel-and-db Task 1, interfaces.md §2). Also removed `vitest.workspace.ts` from the `git add`/body of the step 7 commit.
- **Commit trailer rules**: aligned the commit rules line in Global Constraints with the same format as the kernel-and-db plan and interfaces.md §9 (branch `ralph/<story-id>` + worktree `omnis/.worktrees/<story-id>` + subject `<story-id>: <one-line summary>` + body listing the acceptance criteria that were met + a final tier-appropriate `Co-Authored-By` line, `fable` unused).

Not applied (outside this plan's scope): M3 (the `pg`/`packageManager` pins are owned by the kernel-and-db plan; this plan does not depend on `pg`), M5 (root scripts are owned by kernel-and-db Task 1), M6 (the `WS /bridge` server is owned by kernel-and-db), M9~M11 (desktop/kernel contract symbols), M13·M14 (CI workflow and phase-0 spike scope reduction).
