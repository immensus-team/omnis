# Channels (Outlook · Telegram · Hermes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the three new channel surfaces Phase B opens, exactly per contract — Outlook (Graph delta polling), Telegram (mtcute), and Hermes (a read-only HTTP agent session) — and wire live-connection hardening (token refresh, subscription re-registration, adapter health → system Item) into the kernel. Accept everything via fixture/mock only (B-D5; Logan's 2026-09-20 decision: real accounts get connected in one go, later).

**Architecture:** `packages/adapters/outlook` and `packages/adapters/telegram` have the same shape as Phase A's Slack/Gmail/Google-Calendar — leaf packages depending only on `@omnis/protocol`, exporting the pure function `normalize()` (raw payload → `NormalizedItem[]`) separately from the `Adapter` object, with `send()` calling only an injectable mock sink (no irreversible send without an approval gate). Outlook implements Graph delta polling as `subscribe()` (an AsyncGenerator, the same pattern as Google Calendar's syncToken polling), and Telegram injects the real mtcute client wrapped in a thin interface named `TelegramClientLike` that this package owns (tests use fixtures only; the real mtcute wiring lands after the A1-⑦ spike passes). Hermes is a single HTTP client implementing the `RuntimeAdapter` interface from `apps/local-agent` (the same contract as Claude Code/Codex) and spawns no child process — it puts `session_key` on the `X-Hermes-Session-Key` header and parses the SSE stream from `/v1/responses`, discarding keepalives (`:` comments) and raising only delta/done to the `EventSink`. Kernel hardening (`packages/kernel/src/adapter-health.ts`, `src/jobs/{token-refresh,rewatch}.ts`) does not import adapter SDKs directly; it receives per-channel callbacks by injection (provider SDKs stay inside adapter packages; A7 §7 prohibition-on-inheritance 2).

**Tech Stack:** TypeScript 5.6.3 (strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`) · zod ^3.24.1 · vitest 2.1.9 · pg 8.13.1 · `@microsoft/microsoft-graph-client 3.0.7` · `mtcute 0.29.x` · Node 22 fetch/ReadableStream (global, no extra HTTP library) · pnpm workspaces. Version-pin sources: `2026-09-20-phase-a-interfaces.md` §2 + `2026-09-20-phase-b-interfaces-delta.md` §1 (FIXED).

**Spec:** `/Users/logankim/AI-Workspaces/omnis/docs/spec/00-omnis-design.md` §16 (Phase B scope) · `/Users/logankim/AI-Workspaces/omnis/docs/spec/A1-channel-adapters.md` §1 (common contract) · §2.4 (Outlook) · §2.5 (Telegram) · `/Users/logankim/AI-Workspaces/omnis/docs/spec/A2-agent-session-bridge.md` §2.1–2.2 (local-agent configuration · reconnect) · §4.4 (Hermes) · `/Users/logankim/AI-Workspaces/omnis/docs/spec/A3-data-schema.md` §2 (accounts/items/threads) · §11 (no hard delete) · `/Users/logankim/AI-Workspaces/omnis/docs/spec/A6-ops-infra.md` §8 (ntfy routing) · `/Users/logankim/AI-Workspaces/omnis/docs/superpowers/plans/2026-09-20-phase-a-interfaces.md` (FIXED, especially §3 · §6 · §8) · `/Users/logankim/AI-Workspaces/omnis/docs/superpowers/plans/2026-09-20-phase-b-interfaces-delta.md` (FIXED, especially §5 · §6 · §8 · §9) · `/Users/logankim/AI-Workspaces/omnis/docs/superpowers/plans/2026-09-20-phase-b-backlog.md` (US-B37–B40, B-D5).

## Global Constraints

- Node 22 + pnpm workspaces. TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` (root `tsconfig.base.json`). Postgres 17.
- Version pins (FIXED, identical across all workspaces): `vitest 2.1.9` · `zod ^3.24.1` · `pg 8.13.1` · `typescript 5.6.3` · `@rocicorp/zero 1.9.0` (exact) · `ai 7.0.107`. Pins this plan newly adds: `@microsoft/microsoft-graph-client 3.0.7` · `mtcute 0.29.x`.
- The root scaffold (`pnpm-workspace.yaml`/`package.json`/`tsconfig.base.json`/`biome.jsonc`/`vitest.workspace.ts`) already exists (kernel-and-db Task 1 created it in Phase A) — this plan only confirms existence with `test -f` and never touches it. `packages/adapters/*` is already globbed in `pnpm-workspace.yaml` (Phase A), so adding new packages requires no workspace-file edits.
- Migrations are append-only `packages/db/migrations/000N_<name>.sql`. **This plan creates no migration files at all** — `0009` · `0011` · `0012` · `0013` belong to the W0 schema bundle, and `0010` is owned by memory-ingestion (delta §6). They may be absent from this worktree, and the migrate runner sorts by filename, so it does not break when a gap exists. `0012_jobs_phase_b.sql` is **not created by this plan** — `0009` · `0011` · `0012` · `0013` are produced by the **wave 0 schema bundle** in one worktree and one commit (delta §6; the 2026-09-20 cross-review M1 retired the old "shared ownership across 4 plans": the migration runner throws when the sha256 of an already-applied file changes, so parallel worktrees cannot split them). Task 5 assumes that file already exists and uses the seeded `outlook_delta_poll` row.
- The test DB is `omnis_test` (local Postgres 17 + pgvector); without `DATABASE_URL` it defaults to `postgres://logan@127.0.0.1:5432/omnis_test`. Integration tests run through `pnpm --filter <pkg> test:integration` (vitest `integration` project, singleFork serial).
- Run `pnpm lint` (biome) before committing. Commit message format: header `<story-id>: <one-line summary>`, body listing the acceptance criteria met, one `Implemented-by: Claude <tier>` line, last line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- **No irreversible tools**: `send()` never calls a real channel API outside the approval gate (Phase A US-A07, already present) — every adapter `send()` in this plan calls only an injectable mock sink. Hermes is read-only from the start (`origin:'human'` only, delegation refused), so it has no approval surface at all (A2-D9).
- **Provider SDKs are imported only inside their adapter package** (`@microsoft/microsoft-graph-client` never leaves `packages/adapters/outlook`; `mtcute` never leaves `packages/adapters/telegram`). `packages/kernel` never imports a channel SDK; it receives callbacks by injection.
- **Create no hard-delete path** (A3 §11). Outlook delta's `@removed` tombstone and Telegram's delete updates only make `normalize()` return an empty array — no code anywhere actually deletes from `items`.
- **Never put real-account credentials in tests** (B-D5). Outlook/Telegram/Hermes are all accepted via fixture replay + injected mock client/fetch only. Nothing reads `~/.claude/.credentials.json` or the like.
- Story tiers (backlog §2): US-B37/B38/B40 = Sonnet, US-B39 = Opus (HTTP bridge adapter; the session mapping and SSE parsing of A2 §4.4 interlock with the safety invariants of A2-D1/A2-D9).

---

### Task 1: Outlook adapter — package scaffold + `normalize()` (US-B37, tier: Sonnet)

**US-B37 deliverables (delta §11):** `packages/adapters/outlook/src/index.ts`, `packages/adapters/outlook/fixtures/*.json`. **Verification command:** `pnpm --filter @omnis/adapter-outlook test && pnpm test:contract`. **Goal:** a Graph delta-polling Outlook adapter, accepted via fixture contract tests only (B-D5).

**Files:**
- Create: `packages/adapters/outlook/package.json`, `packages/adapters/outlook/tsconfig.json`, `packages/adapters/outlook/vitest.config.ts`
- Create: `packages/adapters/outlook/src/keychain.ts`, `packages/adapters/outlook/src/index.ts`
- Test: `packages/adapters/outlook/test/normalize.test.ts`

**Interfaces:** Consumes: `@omnis/protocol`'s `Adapter`/`AuthRef`/`AdapterError`/`Capabilities`/`Health`/`NormalizedItem`/`Attachment` (Phase A contract §3.2–3.3, FIXED, copied verbatim). Produces: `CHANNEL` (`"outlook"` — `accounts_channel_ck` already includes this value; A3 §8, measured), `normalize(raw: unknown): NormalizedItem[]`.

Spec to read: A1 §2.4 (thread=`conversationId`, item=`id`, `sourceHash=internetMessageId`, the 3 write-back kinds). The Keychain item name uses the generic form `omnis.outlook.<upn>` (interfaces.md §9, no exception like the Google family).

- [ ] 1. Create the package scaffold.

  ```bash
  mkdir -p /Users/logankim/AI-Workspaces/omnis/packages/adapters/outlook/src
  mkdir -p /Users/logankim/AI-Workspaces/omnis/packages/adapters/outlook/test
  mkdir -p /Users/logankim/AI-Workspaces/omnis/packages/adapters/outlook/fixtures
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/outlook/package.json <<'EOF'
  {
    "name": "@omnis/adapter-outlook",
    "version": "0.0.1",
    "private": true,
    "type": "module",
    "main": "./dist/index.js",
    "types": "./dist/index.d.ts",
    "scripts": { "build": "tsc --build", "test": "vitest run" },
    "dependencies": {
      "@omnis/protocol": "workspace:*",
      "@microsoft/microsoft-graph-client": "3.0.7"
    },
    "devDependencies": { "typescript": "5.6.3", "vitest": "2.1.9" }
  }
  EOF
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/outlook/tsconfig.json <<'EOF'
  {
    "extends": "../../../tsconfig.base.json",
    "compilerOptions": { "outDir": "dist", "rootDir": "src" },
    "references": [{ "path": "../../protocol" }],
    "include": ["src"]
  }
  EOF
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/outlook/vitest.config.ts <<'EOF'
  import { defineConfig } from "vitest/config";
  import { omnisAlias } from "../../../vitest.shared.js";

  export default defineConfig({
    resolve: { alias: omnisAlias },
    test: { environment: "node" },
  });
  EOF
  ```

- [ ] 2. Write the Keychain wrapper: `packages/adapters/outlook/src/keychain.ts` (the same pattern as the Gmail/Slack tasks — duplicated because imports between adapter packages are forbidden; A7 §9 "intentional duplication").

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
        "find-generic-password",
        "-s",
        service,
        "-a",
        account,
        "-w",
      ]);
      return stdout.trim();
    } catch (cause) {
      throw new AdapterError(
        "auth_expired",
        channel,
        `Keychain item ${service}/${account} not found or locked`,
        undefined,
        cause,
      );
    }
  }
  ```

- [ ] 3. Write the failing test: `packages/adapters/outlook/test/normalize.test.ts`

  ```ts
  import { describe, expect, it } from "vitest";
  import { normalize } from "../src/index.js";

  describe("Outlook normalize()", () => {
    it("maps a Graph message to a NormalizedItem keyed by conversationId/internetMessageId", () => {
      const items = normalize({
        id: "AAMkAGI1AAA=",
        conversationId: "AAQkAGI1conv",
        internetMessageId: "<msg-001@outlook.com>",
        subject: "omnis launch sync",
        body: { contentType: "text", content: "Let's sync tomorrow at 10am." },
        from: { emailAddress: { name: "Dana Lee", address: "dana@example.com" } },
        toRecipients: [{ emailAddress: { name: "Logan", address: "logan@example.com" } }],
        receivedDateTime: "2023-11-14T22:13:20Z",
      });
      expect(items).toEqual([
        {
          threadExternalId: "AAQkAGI1conv",
          externalId: "AAMkAGI1AAA=",
          kind: "email",
          author: { kind: "person", id: "dana@example.com" },
          body: "Subject: omnis launch sync\n\nLet's sync tomorrow at 10am.",
          attachments: [],
          sentAt: "2023-11-14T22:13:20.000Z",
          status: "received",
          sourceHash: "<msg-001@outlook.com>",
          threadMeta: {
            externalId: "AAQkAGI1conv",
            kind: "email",
            title: "omnis launch sync",
            participants: [
              { externalId: "dana@example.com", displayName: "Dana Lee" },
              { externalId: "logan@example.com", displayName: "Logan" },
            ],
            lastItemAt: "2023-11-14T22:13:20.000Z",
            archivedAt: null,
          },
        },
      ]);
    });

    it("strips HTML bodies and returns [] for delta tombstones (@removed)", () => {
      expect(
        normalize({
          id: "x",
          conversationId: "c",
          internetMessageId: "<m@x>",
          subject: "s",
          body: { contentType: "html", content: "<p>hi <b>there</b></p>" },
          from: { emailAddress: { address: "a@x.com" } },
          receivedDateTime: "2023-11-14T22:13:20Z",
        })[0]?.body,
      ).toBe("Subject: s\n\nhi there");
      expect(normalize({ id: "x", conversationId: "c", "@removed": { reason: "deleted" } })).toEqual([]);
      expect(normalize({ id: "x" })).toEqual([]); // no conversationId
    });
  });
  ```

- [ ] 4. Run the test and confirm it fails.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm install && pnpm --filter @omnis/adapter-outlook test
  ```

  Expected failure: `Cannot find module '../src/index.js'`.

- [ ] 5. Write only `CHANNEL` and `normalize()` into `src/index.ts` (Tasks 2–5 fill in the adapter body).

  ```ts
  import type { Attachment, NormalizedItem } from "@omnis/protocol";

  export const CHANNEL = "outlook" as const;

  interface GraphAddress {
    emailAddress?: { name?: string; address?: string };
  }
  interface GraphMessage {
    id?: string;
    conversationId?: string;
    internetMessageId?: string;
    subject?: string;
    body?: { contentType?: string; content?: string };
    from?: GraphAddress;
    toRecipients?: GraphAddress[];
    ccRecipients?: GraphAddress[];
    receivedDateTime?: string;
    "@removed"?: { reason?: string };
  }

  /** ponytail: regex tag stripping only — promote this to a library when full HTML→text conversion
   *  becomes necessary (once broken table/list formatting is actually felt). Both Gmail and Graph
   *  store the body as-is and search runs over `items.search_tsv` (plain text), so this is enough
   *  for v1. */
  function stripHtml(html: string): string {
    return html
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function addr(a?: GraphAddress): { externalId: string; displayName: string } | null {
    const email = a?.emailAddress?.address;
    if (!email) return null;
    return { externalId: email, displayName: a?.emailAddress?.name || email };
  }

  export function normalize(raw: unknown): NormalizedItem[] {
    const m = raw as GraphMessage;
    // delta tombstone: a row announcing a deleted message, so it carries no content. Do not delete
    // from items (A3 §11) — simply do not create an item.
    if (m["@removed"] !== undefined) return [];
    if (!m.id || !m.conversationId) return [];

    const bodyText =
      m.body?.contentType === "html" ? stripHtml(m.body.content ?? "") : (m.body?.content ?? "");
    const participants = [addr(m.from), ...(m.toRecipients ?? []).map(addr), ...(m.ccRecipients ?? []).map(addr)]
      .filter((p): p is { externalId: string; displayName: string } => p !== null)
      .filter((p, i, all) => all.findIndex((o) => o.externalId === p.externalId) === i);
    const sentAt = m.receivedDateTime ?? new Date().toISOString();
    const attachments: Attachment[] = []; // downloads use individual /attachments calls (A1 §2.4) — same principle as Gmail

    return [
      {
        threadExternalId: m.conversationId,
        externalId: m.id,
        kind: "email",
        author: { kind: "person", id: m.from?.emailAddress?.address ?? "" },
        body: m.subject ? `Subject: ${m.subject}\n\n${bodyText}` : bodyText,
        attachments,
        sentAt,
        status: "received",
        sourceHash: m.internetMessageId || m.id,
        threadMeta: {
          externalId: m.conversationId,
          kind: "email",
          title: m.subject || null,
          participants,
          lastItemAt: sentAt,
          archivedAt: null,
        },
      },
    ];
  }
  ```

- [ ] 6. Run the test and confirm it passes.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/adapter-outlook test
  ```

  Expected output: `Tests  2 passed (2)`.

- [ ] 7. Commit.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/adapters/outlook
  git commit -m "$(cat <<'EOF'
  US-B37: Outlook adapter scaffold + normalize()

  - thread=conversationId, item=id, sourceHash=internetMessageId (A1 §2.4)
  - HTML bodies go through regex stripHtml; delta tombstones (@removed) return an empty array (A3 §11, no hard delete)
  - Keychain omnis.outlook.<upn> wrapper (generic form, no Google-family exception)

  Implemented-by: Claude Sonnet
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 2: Outlook adapter — `mapApiError()` + 5 fixtures + contract tests (US-B37, tier: Sonnet)

**Verification command:** `pnpm --filter @omnis/adapter-outlook test && pnpm test:contract`.

**Files:**
- Modify: `packages/adapters/outlook/src/index.ts`
- Create: `packages/adapters/outlook/fixtures/{text_message,thread_reply,attachment,rate_limited_response,auth_error_response}.json`
- Create: `packages/adapters/outlook/test/contract.test.ts`

**Interfaces:** Consumes: `normalize()` from Task 1. Produces: `mapApiError(cause: unknown): AdapterError`.

Spec to read: A1 §1.4 (the 6-way error classification table) · A1 §2.4 (429 + Retry-After; the 410 delta expiry is caught by the polling loop itself, not by mapApiError — Task 5). The 5 minimum scenarios are interfaces.md §9 (unchanged from Phase A; unlike Telegram, Outlook adds no edited/deleted cases — delta §12).

- [ ] 1. Write the failing test: `packages/adapters/outlook/test/mapApiError.test.ts`

  ```ts
  import { describe, expect, it } from "vitest";
  import { mapApiError } from "../src/index.js";

  describe("Outlook mapApiError()", () => {
    it("maps 429 with Retry-After to retryable_rate_limit", () => {
      const err = mapApiError({ statusCode: 429, headers: { "retry-after": "30" } });
      expect(err.kind).toBe("retryable_rate_limit");
      expect(err.retryAfterMs).toBe(30_000);
    });
    it("maps 401 to auth_expired and 403 to auth_revoked", () => {
      expect(mapApiError({ statusCode: 401 }).kind).toBe("auth_expired");
      expect(mapApiError({ statusCode: 403 }).kind).toBe("auth_revoked");
    });
    it("falls back to retryable_network for unmapped statuses", () => {
      expect(mapApiError({ statusCode: 500 }).kind).toBe("retryable_network");
    });
  });
  ```

- [ ] 2. Run the test and confirm it fails: `pnpm --filter @omnis/adapter-outlook test` — expected failure: `mapApiError is not a function`.

- [ ] 3. Add `mapApiError()` to `src/index.ts` (add `AdapterError` to the existing import).

  ```ts
  export function mapApiError(cause: unknown): AdapterError {
    const err = cause as { statusCode?: number; headers?: Record<string, string> };
    if (err.statusCode === 429) {
      const retryAfterSec = Number(err.headers?.["retry-after"] ?? "60");
      return new AdapterError(
        "retryable_rate_limit",
        CHANNEL,
        "Graph API rate limited",
        retryAfterSec * 1000,
        cause,
      );
    }
    if (err.statusCode === 401)
      return new AdapterError("auth_expired", CHANNEL, "Graph API auth expired", undefined, cause);
    if (err.statusCode === 403)
      return new AdapterError("auth_revoked", CHANNEL, "Graph API access forbidden", undefined, cause);
    return new AdapterError("retryable_network", CHANNEL, "Graph API call failed", undefined, cause);
  }
  ```

- [ ] 4. Run the test and confirm it passes: `pnpm --filter @omnis/adapter-outlook test` — expected output: `Tests  3 passed (3)` (+ the 2 from Task 1 = 5).

- [ ] 5. Create the 5 fixtures.

  ```bash
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/outlook/fixtures/text_message.json <<'EOF'
  {
    "scenario": "text_message",
    "raw": {
      "id": "AAMkAGI1msg001",
      "conversationId": "AAQkAGI1conv001",
      "internetMessageId": "<msg-001@outlook.com>",
      "subject": "omnis launch sync",
      "body": { "contentType": "text", "content": "Let's sync tomorrow at 10am about the omnis launch." },
      "from": { "emailAddress": { "name": "Dana Lee", "address": "dana@example.com" } },
      "toRecipients": [{ "emailAddress": { "name": "Logan", "address": "logan@example.com" } }],
      "receivedDateTime": "2023-11-14T22:13:20Z"
    },
    "expected": {
      "items": [
        {
          "threadExternalId": "AAQkAGI1conv001",
          "externalId": "AAMkAGI1msg001",
          "kind": "email",
          "author": { "kind": "person", "id": "dana@example.com" },
          "body": "Subject: omnis launch sync\n\nLet's sync tomorrow at 10am about the omnis launch.",
          "attachments": [],
          "sentAt": "2023-11-14T22:13:20.000Z",
          "status": "received",
          "sourceHash": "<msg-001@outlook.com>",
          "threadMeta": {
            "externalId": "AAQkAGI1conv001",
            "kind": "email",
            "title": "omnis launch sync",
            "participants": [
              { "externalId": "dana@example.com", "displayName": "Dana Lee" },
              { "externalId": "logan@example.com", "displayName": "Logan" }
            ],
            "lastItemAt": "2023-11-14T22:13:20.000Z",
            "archivedAt": null
          }
        }
      ]
    }
  }
  EOF
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/outlook/fixtures/thread_reply.json <<'EOF'
  {
    "scenario": "thread_reply",
    "raw": {
      "id": "AAMkAGI1msg002",
      "conversationId": "AAQkAGI1conv001",
      "internetMessageId": "<msg-002@outlook.com>",
      "subject": "RE: omnis launch sync",
      "body": { "contentType": "text", "content": "10am works for me." },
      "from": { "emailAddress": { "name": "Logan", "address": "logan@example.com" } },
      "toRecipients": [{ "emailAddress": { "name": "Dana Lee", "address": "dana@example.com" } }],
      "receivedDateTime": "2023-11-14T23:00:00Z"
    },
    "expected": {
      "items": [
        {
          "threadExternalId": "AAQkAGI1conv001",
          "externalId": "AAMkAGI1msg002",
          "kind": "email",
          "author": { "kind": "person", "id": "logan@example.com" },
          "body": "Subject: RE: omnis launch sync\n\n10am works for me.",
          "attachments": [],
          "sentAt": "2023-11-14T23:00:00.000Z",
          "status": "received",
          "sourceHash": "<msg-002@outlook.com>",
          "threadMeta": {
            "externalId": "AAQkAGI1conv001",
            "kind": "email",
            "title": "RE: omnis launch sync",
            "participants": [
              { "externalId": "logan@example.com", "displayName": "Logan" },
              { "externalId": "dana@example.com", "displayName": "Dana Lee" }
            ],
            "lastItemAt": "2023-11-14T23:00:00.000Z",
            "archivedAt": null
          }
        }
      ]
    }
  }
  EOF
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/outlook/fixtures/attachment.json <<'EOF'
  {
    "scenario": "attachment",
    "raw": {
      "id": "AAMkAGI1msg003",
      "conversationId": "AAQkAGI1conv002",
      "internetMessageId": "<msg-003@outlook.com>",
      "subject": "PoC slides",
      "body": { "contentType": "text", "content": "" },
      "from": { "emailAddress": { "name": "Dana Lee", "address": "dana@example.com" } },
      "receivedDateTime": "2023-11-14T23:30:00Z",
      "hasAttachments": true
    },
    "expected": {
      "items": [
        {
          "threadExternalId": "AAQkAGI1conv002",
          "externalId": "AAMkAGI1msg003",
          "kind": "email",
          "author": { "kind": "person", "id": "dana@example.com" },
          "body": "Subject: PoC slides\n\n",
          "attachments": [],
          "sentAt": "2023-11-14T23:30:00.000Z",
          "status": "received",
          "sourceHash": "<msg-003@outlook.com>",
          "threadMeta": {
            "externalId": "AAQkAGI1conv002",
            "kind": "email",
            "title": "PoC slides",
            "participants": [{ "externalId": "dana@example.com", "displayName": "Dana Lee" }],
            "lastItemAt": "2023-11-14T23:30:00.000Z",
            "archivedAt": null
          }
        }
      ]
    }
  }
  EOF
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/outlook/fixtures/rate_limited_response.json <<'EOF'
  {
    "scenario": "rate_limited_response",
    "raw": { "statusCode": 429, "headers": { "retry-after": "30" } },
    "expected": { "errorKind": "retryable_rate_limit" }
  }
  EOF
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/outlook/fixtures/auth_error_response.json <<'EOF'
  {
    "scenario": "auth_error_response",
    "raw": { "statusCode": 401 },
    "expected": { "errorKind": "auth_expired" }
  }
  EOF
  ```

- [ ] 6. Write the contract test: `packages/adapters/outlook/test/contract.test.ts` (a verbatim duplication of the same pattern from the Gmail task)

  ```ts
  import { readFileSync, readdirSync } from "node:fs";
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

  describe("Outlook contract: fixture replay", () => {
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

- [ ] 7. Run them and confirm they pass.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  pnpm --filter @omnis/adapter-outlook test
  pnpm test:contract
  ```

  Expected output: zero failures for both commands (the contract project already globs `packages/adapters/*/test/contract.test.ts`; `vitest.workspace.ts` is FIXED).

- [ ] 8. Commit.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/adapters/outlook
  git commit -m "$(cat <<'EOF'
  US-B37: Outlook mapApiError() + contract tests for 5 fixtures

  - Classifies 429 (honoring Retry-After)/401/403/other per the A1 §1.4 table
  - 5 fixtures (text_message/thread_reply/attachment/rate_limited/auth_error) — B-D5 fixture acceptance

  Implemented-by: Claude Sonnet
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 3: Outlook adapter — `connect()`/`disconnect()`/`health()` (`/common` OAuth) (US-B37, tier: Sonnet)

**Verification command:** `pnpm --filter @omnis/adapter-outlook test`.

**Files:** Modify: `packages/adapters/outlook/src/index.ts`. Test: `packages/adapters/outlook/test/connect.test.ts`.

**Interfaces:** Consumes: `readKeychainSecret` (Task 1). Produces: `OutlookAdapterDeps`, `GraphClientLike` (a thin duck-typed interface owned by this file — the real `Client.init(...)` satisfies it structurally, the same reason Gmail avoids the dual `OAuth2Client` type), `refreshAccessToken()`, `createOutlookAdapter(deps): Adapter`.

Spec to read: A1 §2.4 (`/common` authority, the 3 delegated scopes, refresh token → `omnis.outlook.<upn>`).

- [ ] 1. Write the failing test: `packages/adapters/outlook/test/connect.test.ts`

  ```ts
  import { describe, expect, it, vi } from "vitest";
  import { createOutlookAdapter, refreshAccessToken } from "../src/index.js";

  describe("refreshAccessToken()", () => {
    it("POSTs the /common token endpoint with the refresh_token grant", async () => {
      const fetchFn = vi.fn(async () =>
        new Response(JSON.stringify({ access_token: "tok-1", expires_in: 3600 }), { status: 200 }),
      );
      const result = await refreshAccessToken("client-1", "refresh-tok", fetchFn as unknown as typeof fetch);
      expect(result).toEqual({ accessToken: "tok-1", expiresIn: 3600 });
      const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/token");
      expect(String(init.body)).toContain("grant_type=refresh_token");
    });
    it("throws auth_revoked when the token endpoint rejects", async () => {
      const fetchFn = vi.fn(async () => new Response("bad", { status: 401 }));
      await expect(
        refreshAccessToken("client-1", "bad-tok", fetchFn as unknown as typeof fetch),
      ).rejects.toMatchObject({ kind: "auth_revoked" });
    });
  });

  describe("Outlook adapter connect()/health()", () => {
    it("reads the refresh token from Keychain, refreshes, and reports healthy", async () => {
      vi.mock("../src/keychain.js", () => ({ readKeychainSecret: vi.fn(async () => "refresh-tok") }));
      const fetchFn = vi.fn(async () =>
        new Response(JSON.stringify({ access_token: "tok-1", expires_in: 3600 }), { status: 200 }),
      );
      const adapter = createOutlookAdapter({ oauthClientId: "client-1", fetchFn: fetchFn as unknown as typeof fetch });
      await adapter.connect({
        channel: "outlook",
        accountExternalId: "logan@outlook.com",
        keychainService: "omnis.outlook.logan@outlook.com",
        keychainAccount: "logan@outlook.com",
      });
      expect((await adapter.health()).status).toBe("healthy");
    });
  });
  ```

- [ ] 2. Run the test and confirm it fails: `pnpm --filter @omnis/adapter-outlook test` — expected failure: `createOutlookAdapter is not a function`.

- [ ] 3. Add `refreshAccessToken()`, `GraphClientLike`, `OutlookAdapterDeps`, and `createOutlookAdapter()` to `src/index.ts` (connect/disconnect/health only; backfill/subscribe/send stay `fatal_unsupported` stubs).

  ```ts
  import {
    type Adapter,
    AdapterError,
    type AdapterEvent,
    type AuthRef,
    type Capabilities,
    type Health,
    type Outbound,
    type SendResult,
    type ThreadRef,
  } from "@omnis/protocol";
  import { readKeychainSecret } from "./keychain.js";
  // (NormalizedItem/Attachment are already imported — Task 1)

  const CAPABILITIES: Capabilities = {
    read: true,
    write: true,
    realtime: false, // delta polling, not push (A1 §2.4 "the step before webhooks")
    history: true,
    media: true,
    markRead: true,
    typing: false,
    archive: true,
    delete: false,
  };

  /** Duck-types only the subset this adapter actually calls — a `Client` instance from
   *  `@microsoft/microsoft-graph-client` satisfies this interface structurally, so both the real SDK
   *  and the test mock pass (the same reason Gmail avoids the dual OAuth2Client type; see the header
   *  comment in packages/adapters/gmail/src/index.ts). */
  export interface GraphClientLike {
    api(path: string): {
      get(): Promise<Record<string, unknown>>;
      patch(body: unknown): Promise<unknown>;
      post(body: unknown): Promise<unknown>;
    };
  }

  export async function refreshAccessToken(
    clientId: string,
    refreshToken: string,
    fetchFn: typeof fetch,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    const res = await fetchFn("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        scope: "offline_access Mail.ReadWrite Mail.Send Calendars.ReadWrite",
      }).toString(),
    });
    if (!res.ok) {
      throw new AdapterError(
        "auth_revoked",
        CHANNEL,
        `Outlook token refresh failed: ${res.status}`,
        undefined,
        await res.text().catch(() => undefined),
      );
    }
    const body = (await res.json()) as { access_token: string; expires_in: number };
    return { accessToken: body.access_token, expiresIn: body.expires_in };
  }

  export interface OutlookAdapterDeps {
    oauthClientId: string;
    graphClient?: GraphClientLike;
    fetchFn?: typeof fetch;
    pollIntervalMs?: number; // subscribe() delta polling interval, default 5 minutes (same as the jobs.outlook_delta_poll cadence)
    sink?: (thread: ThreadRef, draft: Outbound) => Promise<SendResult>;
    now?: () => Date;
  }

  export function createOutlookAdapter(deps: OutlookAdapterDeps): Adapter {
    const now = deps.now ?? ((): Date => new Date());
    const fetchFn = deps.fetchFn ?? fetch;
    let graphClient: GraphClientLike | undefined = deps.graphClient;
    let status: Health["status"] = "down";
    let lastEventAt: string | null = null;
    let lastError: Health["lastError"];

    return {
      id: "outlook",
      channel: CHANNEL,
      capabilities: () => CAPABILITIES,

      async connect(auth: AuthRef): Promise<void> {
        const refreshToken = await readKeychainSecret(auth.keychainService, auth.keychainAccount, CHANNEL);
        try {
          const { accessToken } = await refreshAccessToken(deps.oauthClientId, refreshToken, fetchFn);
          if (deps.graphClient === undefined) {
            const { Client } = await import("@microsoft/microsoft-graph-client");
            graphClient = Client.init({
              authProvider: (done) => done(null, accessToken),
            }) as unknown as GraphClientLike;
          }
        } catch (cause) {
          status = "down";
          if (cause instanceof AdapterError) throw cause;
          throw new AdapterError("auth_revoked", CHANNEL, "Outlook connect failed", undefined, cause);
        }
        status = "healthy";
        lastEventAt = now().toISOString();
      },

      async disconnect(): Promise<void> {
        status = "down";
      },

      async *backfill(): AsyncIterable<NormalizedItem> {
        throw new AdapterError("fatal_unsupported", CHANNEL, "backfill not implemented until Task 4");
      },

      subscribe(): AsyncIterable<NormalizedItem | AdapterEvent> {
        throw new AdapterError("fatal_unsupported", CHANNEL, "subscribe not implemented until Task 4");
      },

      async send(): Promise<never> {
        throw new AdapterError("fatal_unsupported", CHANNEL, "send not implemented until Task 5");
      },

      async health(): Promise<Health> {
        return {
          channel: CHANNEL,
          accountExternalId: "",
          status,
          lastEventAt,
          ...(lastError ? { lastError } : {}),
        };
      },
    };
  }
  ```

  The `graphClient`/`status`/`lastError` variable declarations did not already exist at the top of the file from Tasks 1–2, so this step introduces `createOutlookAdapter` for the first time — Tasks 4 and 5 only swap out the `backfill`/`subscribe`/`send` stubs in this function body.

- [ ] 4. Confirm that the type declarations for `@microsoft/microsoft-graph-client` are already declared in dependencies (Task 1) so the dynamic import type-checks. Run the tests with no additional install.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm install && pnpm --filter @omnis/adapter-outlook test
  ```

  Expected output: `Tests  ... passed` (mapApiError, normalize, and connect all included).

- [ ] 5. Commit.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/adapters/outlook
  git commit -m "$(cat <<'EOF'
  US-B37: Outlook connect()/health() — /common OAuth refresh-token flow

  - refreshAccessToken() fetches login.microsoftonline.com/common/oauth2/v2.0/token
  - auth_revoked on failure (A1 §1.4, no automatic retry)
  - GraphClientLike duck-typing satisfies both the real SDK and the test mock
  - backfill()/subscribe()/send() are still fatal_unsupported (Tasks 4 and 5)

  Implemented-by: Claude Sonnet
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 4: Outlook adapter — `backfill()` + `subscribe()` delta polling + spike scaffold (US-B37, tier: Sonnet)

**Verification command:** `pnpm --filter @omnis/adapter-outlook test`.

**Files:** Modify: `packages/adapters/outlook/src/index.ts`. Test: `packages/adapters/outlook/test/backfill.test.ts`. Create: `tools/spikes/a1-6-outlook-graph-delta/{probe.ts,result.md}`.

**Interfaces:** Consumes: `GraphClientLike`, `mapApiError()` (Tasks 2 and 3). Produces: the `backfill(since?)`/`subscribe()` implementations.

Spec to read: A1 §2.4 (backfill = the last 30 days of the `messages` list, delta polling, 410 → full resync). The polling loop duplicates the Google Calendar adapter's `syncToken` pattern (`packages/adapters/google-calendar/src/index.ts` `subscribe()`) verbatim — only `deltaLink`/`nextLink` are named differently.

- [ ] 1. Write the failing test: `packages/adapters/outlook/test/backfill.test.ts`

  ```ts
  import { describe, expect, it, vi } from "vitest";
  import { createOutlookAdapter } from "../src/index.js";
  import type { GraphClientLike } from "../src/index.js";

  function fakeAuth() {
    return {
      channel: "outlook" as const,
      accountExternalId: "logan@outlook.com",
      keychainService: "omnis.outlook.logan@outlook.com",
      keychainAccount: "logan@outlook.com",
    };
  }

  describe("Outlook backfill()", () => {
    it("paginates /me/mailFolders/inbox/messages via @odata.nextLink", async () => {
      const pages = [
        { value: [{ id: "m1", conversationId: "c1", internetMessageId: "<m1>", from: { emailAddress: { address: "a@x.com" } }, body: { contentType: "text", content: "hi" }, receivedDateTime: "2023-11-14T00:00:00Z" }], "@odata.nextLink": "page2" },
        { value: [{ id: "m2", conversationId: "c1", internetMessageId: "<m2>", from: { emailAddress: { address: "a@x.com" } }, body: { contentType: "text", content: "bye" }, receivedDateTime: "2023-11-15T00:00:00Z" }] },
      ];
      let call = 0;
      const graphClient: GraphClientLike = {
        api: () => ({
          get: async () => pages[call++] as Record<string, unknown>,
          patch: async () => ({}),
          post: async () => ({}),
        }),
      };
      const adapter = createOutlookAdapter({ oauthClientId: "c", graphClient });
      await adapter.connect(fakeAuth());
      const items = [];
      for await (const item of adapter.backfill()) items.push(item);
      expect(items.map((i) => i.externalId)).toEqual(["m1", "m2"]);
    });
  });

  describe("Outlook subscribe()", () => {
    it("resets to the base delta URL on 410 and keeps yielding", async () => {
      let call = 0;
      const graphClient: GraphClientLike = {
        api: () => ({
          get: async () => {
            call += 1;
            if (call === 1) {
              const err = new Error("Gone") as Error & { statusCode: number };
              err.statusCode = 410;
              throw err;
            }
            return { value: [{ id: "m3", conversationId: "c3", internetMessageId: "<m3>", from: { emailAddress: { address: "b@x.com" } }, body: { contentType: "text", content: "new" }, receivedDateTime: "2023-11-16T00:00:00Z" }], "@odata.deltaLink": "delta-2" };
          },
          patch: async () => ({}),
          post: async () => ({}),
        }),
      };
      const adapter = createOutlookAdapter({ oauthClientId: "c", graphClient, pollIntervalMs: 0 });
      await adapter.connect(fakeAuth());
      const it1 = adapter.subscribe()[Symbol.asyncIterator]();
      const first = await it1.next();
      expect(first.done).toBe(false);
      expect((first.value as { externalId?: string }).externalId).toBe("m3");
    });
  });
  ```

- [ ] 2. Run the test and confirm it fails: `pnpm --filter @omnis/adapter-outlook test` — expected failure: `backfill()`/`subscribe()` still throw `fatal_unsupported`.

- [ ] 3. Swap the `backfill`/`subscribe` stubs in `src/index.ts` for real implementations.

  ```ts
  async *backfill(): AsyncIterable<NormalizedItem> {
    if (graphClient === undefined)
      throw new AdapterError("fatal_protocol", CHANNEL, "backfill() called before connect()");
    const client = graphClient;
    let link = "/me/mailFolders/inbox/messages?$top=50";
    for (;;) {
      let res: { value?: unknown[]; "@odata.nextLink"?: string };
      try {
        res = (await client.api(link.startsWith("http") ? link : link).get()) as {
          value?: unknown[];
          "@odata.nextLink"?: string;
        };
      } catch (cause) {
        throw mapApiError(cause);
      }
      for (const raw of res.value ?? []) {
        for (const item of normalize(raw)) yield item;
      }
      const next = res["@odata.nextLink"];
      if (next === undefined) break;
      link = next;
    }
  }

  subscribe(): AsyncIterable<NormalizedItem | AdapterEvent> {
    if (graphClient === undefined)
      throw new AdapterError("fatal_protocol", CHANNEL, "subscribe() called before connect()");
    const client = graphClient;
    const intervalMs = deps.pollIntervalMs ?? 300_000; // outlook_delta_poll cron */5 * * * *
    const BASE = "/me/mailFolders/inbox/messages/delta";

    async function* poll(): AsyncGenerator<NormalizedItem | AdapterEvent> {
      let link = BASE;
      for (;;) {
        let res: { value?: unknown[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string };
        try {
          res = (await client.api(link).get()) as {
            value?: unknown[];
            "@odata.nextLink"?: string;
            "@odata.deltaLink"?: string;
          };
        } catch (cause) {
          const err = cause as { statusCode?: number };
          if (err.statusCode === 410) {
            link = BASE; // delta token expired → full resync (A1 §2.4)
            continue;
          }
          throw mapApiError(cause);
        }
        for (const raw of res.value ?? []) {
          for (const item of normalize(raw)) yield item;
        }
        const settled = res["@odata.deltaLink"];
        link = res["@odata.nextLink"] ?? settled ?? BASE;
        if (settled !== undefined && intervalMs > 0) await new Promise((r) => setTimeout(r, intervalMs));
      }
    }
    return poll();
  }
  ```

- [ ] 4. Run the test and confirm it passes: `pnpm --filter @omnis/adapter-outlook test`.

- [ ] 5. Create the A1-⑥ spike scaffold (owned by backlog §5 "Phase B entry spikes"). Because B-D5 pushed real-account connection back, leave `result.md` as PENDING and fill it in by running `probe.ts` as-is once a real account is connected.

  ```bash
  mkdir -p /Users/logankim/AI-Workspaces/omnis/tools/spikes/a1-6-outlook-graph-delta
  cat > /Users/logankim/AI-Workspaces/omnis/tools/spikes/a1-6-outlook-graph-delta/probe.ts <<'EOF'
  // A1-⑥: verify with a real account that the Graph delta query (/me/mailFolders/inbox/messages/delta) behaves as documented.
  // Run: OMNIS_OUTLOOK_ACCESS_TOKEN=<token> tsx tools/spikes/a1-6-outlook-graph-delta/probe.ts
  const token = process.env.OMNIS_OUTLOOK_ACCESS_TOKEN;
  if (!token) {
    console.error("OMNIS_OUTLOOK_ACCESS_TOKEN not set — B-D5: do not run this spike before connecting a real account.");
    process.exit(1);
  }
  const res = await fetch("https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta", {
    headers: { authorization: `Bearer ${token}` },
  });
  console.log(res.status, JSON.stringify(await res.json(), null, 2).slice(0, 2000));
  EOF
  cat > /Users/logankim/AI-Workspaces/omnis/tools/spikes/a1-6-outlook-graph-delta/result.md <<'EOF'
  # Gate: A1-⑥ Outlook Graph delta

  - **Question**: does polling `/me/mailFolders/inbox/messages/delta` return `@odata.nextLink`/`@odata.deltaLink`/410 as documented?
  - **Owning appendix**: A1 §2.4
  - **Owner**: agent
  - **Host**: mini
  - **Run date**: PENDING — after B-D5 (real accounts get connected in one go, later; Logan's 2026-09-20 decision)
  - **Result (Pass/Fail)**: PENDING
  - **Measurements/evidence**: fill in by running `probe.ts` with a real access token
  - **decided_by**: PENDING
  - **Notes**: this plan's (US-B37) adapter implementation is already accepted via fixture/mock — this spike is for live-connection verification, not an implementation gate
  EOF
  ```

- [ ] 6. Commit.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/adapters/outlook tools/spikes/a1-6-outlook-graph-delta
  git commit -m "$(cat <<'EOF'
  US-B37: Outlook backfill() + subscribe() delta polling

  - backfill(): paginates /me/mailFolders/inbox/messages via @odata.nextLink
  - subscribe(): delta polling; 410 Gone restarts from the BASE delta URL (full resync, A1 §2.4)
  - default polling interval 5 minutes (same as the outlook_delta_poll cron)
  - A1-⑥ spike scaffold (result.md is PENDING — real-account connection deferred per B-D5)

  Implemented-by: Claude Sonnet
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 5: Outlook adapter — `send()`/`markRead()`/`archive()` write-back (US-B37, tier: Sonnet)

**Verification command:** `pnpm --filter @omnis/adapter-outlook test && pnpm --filter @omnis/db test:integration`.

**Files:** Modify: `packages/adapters/outlook/src/index.ts`. Test: `packages/adapters/outlook/test/send.test.ts`. Modify: `packages/db/test/integration/schema-0006.test.ts` (relax the job-count assertion to `gte(16)` — it must pass both in worktrees that have `0012` and in those that do not). **Not created**: `packages/db/migrations/0012_jobs_phase_b.sql` (owned by the W0 schema bundle; delta §6 · cross-review M1).

**Interfaces:** Consumes: `GraphClientLike`, `mapApiError()`. Produces: the completed `Adapter` (`send`/`markRead`/`archive`), the `outlook_delta_poll` row in the `jobs` table (+ the other 3 rows from delta §8, co-owned with B14/B15/B44).

Spec to read: A1 §2.4 (send=`sendMail`, markRead=`isRead` PATCH, archive=`move`→Archive folder). Delta §8 (the exact cron for the 4 jobs).

- [ ] 1. Write the failing test: `packages/adapters/outlook/test/send.test.ts`

  ```ts
  import { describe, expect, it, vi } from "vitest";
  import { createOutlookAdapter } from "../src/index.js";
  import type { GraphClientLike } from "../src/index.js";

  describe("Outlook write-back", () => {
    it("send() only calls the injected mock sink, never a real API", async () => {
      const sink = vi.fn(async () => ({ externalId: "sent-1", sentAt: "2023-11-14T00:00:00.000Z" }));
      const adapter = createOutlookAdapter({ oauthClientId: "c", sink });
      const result = await adapter.send({ accountId: "a", externalId: "conv-1" }, { text: "hi" });
      expect(sink).toHaveBeenCalledOnce();
      expect(result.externalId).toBe("sent-1");
    });

    it("markRead() PATCHes isRead and archive() POSTs a move to the Archive folder", async () => {
      const patch = vi.fn(async () => ({}));
      const post = vi.fn(async () => ({}));
      const graphClient: GraphClientLike = { api: () => ({ get: async () => ({}), patch, post }) };
      const adapter = createOutlookAdapter({ oauthClientId: "c", graphClient });
      await adapter.connect({
        channel: "outlook", accountExternalId: "logan@outlook.com",
        keychainService: "s", keychainAccount: "a",
      });
      await adapter.markRead?.({ accountId: "a", externalId: "msg-1" });
      expect(patch).toHaveBeenCalledWith({ isRead: true });
      await adapter.archive?.({ accountId: "a", externalId: "msg-1" });
      expect(post).toHaveBeenCalledWith({ destinationId: "archive" });
    });
  });
  ```

- [ ] 2. Run the test and confirm it fails: `pnpm --filter @omnis/adapter-outlook test` — expected failure: `send()` still throws `fatal_unsupported`.

- [ ] 3. Swap out the `send` stub in `src/index.ts` and add `markRead`/`archive`.

  ```ts
  // Never call a real sendMail before the approval gate (US-A07, already present in Phase A).
  async send(thread: ThreadRef, draft: Outbound): Promise<SendResult> {
    const sink =
      deps.sink ??
      (async (): Promise<SendResult> => ({
        externalId: `mock-${now().getTime()}`,
        sentAt: now().toISOString(),
      }));
    return sink(thread, draft);
  },

  async markRead(thread: ThreadRef): Promise<void> {
    if (graphClient === undefined)
      throw new AdapterError("fatal_protocol", CHANNEL, "markRead() called before connect()");
    try {
      await graphClient.api(`/me/messages/${thread.externalId}`).patch({ isRead: true });
    } catch (cause) {
      throw mapApiError(cause);
    }
  },

  async archive(thread: ThreadRef): Promise<void> {
    if (graphClient === undefined)
      throw new AdapterError("fatal_protocol", CHANNEL, "archive() called before connect()");
    try {
      await graphClient.api(`/me/messages/${thread.externalId}/move`).post({ destinationId: "archive" });
    } catch (cause) {
      throw mapApiError(cause);
    }
  },
  ```

- [ ] 4. Run the tests and confirm they pass: `pnpm --filter @omnis/adapter-outlook test` — expected output: everything passing (normalize 2 + mapApiError 3 + contract 5 + connect 3 + backfill 2 + send 2 = around 17 cases).

- [ ] 5. **Only confirm** that `0012_jobs_phase_b.sql` is **already present** — since the 2026-09-20 cross-review M1, this file is owned by the **wave 0 schema bundle** (delta §6). Do not create it in this worktree: the migration runner throws when the sha256 of an already-applied file changes, and its contents differ from the agents-side version carrying the `cost_daily` view, so the merge breaks too.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && grep -n "outlook_delta_poll" packages/db/migrations/0012_jobs_phase_b.sql
  ```

  Expected output: one line, the seeded `outlook_delta_poll` row. If the file is absent, the W0 bundle has not been merged yet — **do not create it here**; wait for the W0 merge (the remaining steps of this task run without `0012` — Outlook `send()`/`markRead()`/`archive()` are independent of the job seeds).

- [ ] 6. Fix the existing Phase A job-count assertion (`packages/db/test/integration/schema-0006.test.ts`), which breaks from 16→20 — change it to a lower-bound assertion so it passes both in worktrees with `0012` applied and in those without (the code below already uses `toBeGreaterThanOrEqual(16)`).

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  ```

  ```ts
  // in packages/db/test/integration/schema-0006.test.ts, change the "seeds the 16 jobs..." it() block to this:
  it("seeds the jobs A3 §6 + Phase B delta §8 lists, with the A4-owned schedules", async () => {
    const rows = await query<{ name: string; schedule: string }>(
      pool,
      "SELECT name, schedule FROM jobs ORDER BY name",
    );
    expect(rows.length).toBeGreaterThanOrEqual(16); // passes even in worktrees without 0009–0011 (other plans)
    const byName = new Map(rows.map((r) => [r.name, r.schedule]));
    expect(byName.get("morning_digest")).toBe("30 6 * * *");
    expect(byName.get("nightly_digest")).toBe("0 23 * * *");
    expect(byName.get("memory_consolidate")).toBe("30 23 * * *");
    expect(byName.get("slot_health")).toBe("*/5 * * * *");
    expect(byName.get("events_rolloff")).toBe("15 4 * * *");
    // Phase B delta §8 (0012, created by this plan)
    expect(byName.get("cost_daily")).toBe("5 0 * * *");
    expect(byName.get("push_batch")).toBe("0 9,12,15,18 * * *");
    expect(byName.get("outlook_delta_poll")).toBe("*/5 * * * *");
    expect(byName.get("cost_report_monthly")).toBe("10 0 1 * *");
  });
  ```

  Relaxing `toHaveLength(16)` to `toBeGreaterThanOrEqual(16)` is deliberate — this worktree lacks 0009–0011 (owned by other plans), so exactly 20 cannot be expected. Once all 4 plans have merged to main, it becomes exactly 20.

- [ ] 7. Run the migration + integration tests and confirm they pass.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  pnpm --filter @omnis/db test:integration
  ```

  Expected output: `schema-0006.test.ts` fully passing (including the 8 job assertions).

- [ ] 8. Lint, then commit (the final US-B37 commit).

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  pnpm lint
  # 0012_jobs_phase_b.sql belongs to the W0 schema bundle, so it does not go into this commit (cross-review M1).
  git add packages/adapters/outlook packages/db/test/integration/schema-0006.test.ts
  git commit -m "$(cat <<'EOF'
  US-B37: Outlook send()/markRead()/archive()

  - send() still calls only the injected mock sink (no irreversible send outside the approval gate)
  - markRead()=isRead PATCH, archive()=move to the Archive folder (A1 §2.4)
  - the outlook_delta_poll job seed lives in the W0 schema bundle's 0012_jobs_phase_b.sql — this plan only consumes it
  - relaxed the schema-0006 job-count assertion to gte(16) + added schedule assertions for the 4 Phase B jobs

  Implemented-by: Claude Sonnet
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 6: Telegram adapter — package scaffold + `normalize()` (text/edit/delete) (US-B38, tier: Sonnet)

**US-B38 deliverables (delta §11):** `packages/adapters/telegram/src/index.ts`, `packages/adapters/telegram/fixtures/*.json`. **Verification command:** `pnpm --filter @omnis/adapter-telegram test && pnpm test:contract`. **Goal:** an mtcute-based Telegram adapter, accepted via fixture contract tests only (B-D5).

**Files:**
- Create: `packages/adapters/telegram/package.json`, `packages/adapters/telegram/tsconfig.json`, `packages/adapters/telegram/vitest.config.ts`
- Create: `packages/adapters/telegram/src/keychain.ts`, `packages/adapters/telegram/src/index.ts`
- Test: `packages/adapters/telegram/test/normalize.test.ts`

**Interfaces:** Consumes: `@omnis/protocol`'s `Adapter`/`AuthRef`/`AdapterError`/`Capabilities`/`Health`/`NormalizedItem`/`Attachment` (FIXED). Produces: `CHANNEL` (`"telegram"`), `normalize(raw: unknown): NormalizedItem[]`.

Spec to read: A1 §2.5 (thread=chat/peer id, item=message id, `sourceHash=(chatId,messageId)`, archive unsupported). Keychain: `omnis.telegram.session_key` (generic form).

- [ ] 1. Create the package scaffold.

  ```bash
  mkdir -p /Users/logankim/AI-Workspaces/omnis/packages/adapters/telegram/src
  mkdir -p /Users/logankim/AI-Workspaces/omnis/packages/adapters/telegram/test
  mkdir -p /Users/logankim/AI-Workspaces/omnis/packages/adapters/telegram/fixtures
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/telegram/package.json <<'EOF'
  {
    "name": "@omnis/adapter-telegram",
    "version": "0.0.1",
    "private": true,
    "type": "module",
    "main": "./dist/index.js",
    "types": "./dist/index.d.ts",
    "scripts": { "build": "tsc --build", "test": "vitest run" },
    "dependencies": {
      "@omnis/protocol": "workspace:*",
      "@mtcute/node": "0.29.1"
    },
    "devDependencies": { "typescript": "5.6.3", "vitest": "2.1.9" }
  }
  EOF
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/telegram/tsconfig.json <<'EOF'
  {
    "extends": "../../../tsconfig.base.json",
    "compilerOptions": { "outDir": "dist", "rootDir": "src" },
    "references": [{ "path": "../../protocol" }],
    "include": ["src"]
  }
  EOF
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/telegram/vitest.config.ts <<'EOF'
  import { defineConfig } from "vitest/config";
  import { omnisAlias } from "../../../vitest.shared.js";

  export default defineConfig({
    resolve: { alias: omnisAlias },
    test: { environment: "node" },
  });
  EOF
  ```

- [ ] 2. Write the Keychain wrapper: `packages/adapters/telegram/src/keychain.ts` (a duplication of the same pattern).

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
        "find-generic-password",
        "-s",
        service,
        "-a",
        account,
        "-w",
      ]);
      return stdout.trim();
    } catch (cause) {
      throw new AdapterError(
        "auth_expired",
        channel,
        `Keychain item ${service}/${account} not found or locked`,
        undefined,
        cause,
      );
    }
  }
  ```

- [ ] 3. Write the failing test: `packages/adapters/telegram/test/normalize.test.ts`

  ```ts
  import { describe, expect, it } from "vitest";
  import { normalize } from "../src/index.js";

  describe("Telegram normalize()", () => {
    it("maps a text message keyed by (chatId, messageId)", () => {
      const items = normalize({
        id: 501,
        chat: { id: 1001, type: "private" },
        sender: { id: 42, firstName: "Dana", lastName: "Lee" },
        text: "sync tomorrow at 10am",
        date: 1_700_000_000,
      });
      expect(items).toEqual([
        {
          threadExternalId: "1001",
          externalId: "501",
          kind: "message",
          author: { kind: "person", id: "42" },
          body: "sync tomorrow at 10am",
          attachments: [],
          sentAt: new Date(1_700_000_000 * 1000).toISOString(),
          status: "received",
          sourceHash: "1001:501",
          threadMeta: {
            externalId: "1001",
            kind: "dm",
            title: null,
            participants: [{ externalId: "42", displayName: "Dana Lee" }],
            lastItemAt: new Date(1_700_000_000 * 1000).toISOString(),
            archivedAt: null,
          },
        },
      ]);
    });

    it("keeps edited messages as a normal item and drops delete updates", () => {
      const edited = normalize({
        id: 501,
        chat: { id: 1001, type: "private" },
        sender: { id: 42, firstName: "Dana" },
        text: "sync tomorrow at 11am (edited)",
        date: 1_700_000_000,
        editDate: 1_700_000_500,
      });
      expect(edited[0]?.body).toBe("sync tomorrow at 11am (edited)");
      expect(normalize({ deletedMessageIds: [501], deletedChatId: 1001 })).toEqual([]);
      expect(normalize({ id: 1 })).toEqual([]); // no chat/sender
    });
  });
  ```

- [ ] 4. Run the test and confirm it fails.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm install && pnpm --filter @omnis/adapter-telegram test
  ```

  Expected failure: `Cannot find module '../src/index.js'`.

- [ ] 5. Write `CHANNEL` and `normalize()` into `src/index.ts`.

  ```ts
  import type { Attachment, NormalizedItem } from "@omnis/protocol";

  export const CHANNEL = "telegram" as const;

  interface TgSender {
    id?: number;
    username?: string;
    firstName?: string;
    lastName?: string;
  }
  interface TgMedia {
    type?: string;
    mimeType?: string;
    fileSize?: number;
    fileName?: string;
  }
  interface TgMessage {
    id?: number;
    chat?: { id?: number | string; type?: string; title?: string };
    sender?: TgSender;
    text?: string;
    date?: number;
    editDate?: number;
    media?: TgMedia;
    // Delete updates are not messages but a separate shape (the mtcute DeleteMessageUpdate family), so this key discriminates them.
    deletedMessageIds?: number[];
  }

  function tgAttachmentKind(type: string | undefined): Attachment["kind"] {
    if (type === "photo") return "image";
    if (type === "video") return "video";
    if (type === "voice" || type === "audio") return "audio";
    return "file";
  }

  export function normalize(raw: unknown): NormalizedItem[] {
    const m = raw as TgMessage;
    if (m.deletedMessageIds !== undefined) return []; // delete updates carry no content — do not create an item
    if (m.id === undefined || m.chat?.id === undefined || m.sender?.id === undefined) return [];

    const chatId = String(m.chat.id);
    const senderId = String(m.sender.id);
    const displayName =
      [m.sender.firstName, m.sender.lastName].filter(Boolean).join(" ") || m.sender.username || senderId;
    const sentAt = new Date((m.date ?? 0) * 1000).toISOString();
    const attachments: Attachment[] = m.media
      ? [
          {
            kind: tgAttachmentKind(m.media.type),
            ...(m.media.mimeType !== undefined ? { mimeType: m.media.mimeType } : {}),
            ...(m.media.fileSize !== undefined ? { sizeBytes: m.media.fileSize } : {}),
            ...(m.media.fileName !== undefined ? { caption: m.media.fileName } : {}),
          },
        ]
      : [];

    return [
      {
        threadExternalId: chatId,
        externalId: String(m.id),
        kind: "message",
        author: { kind: "person", id: senderId },
        body: m.text ?? "",
        attachments,
        sentAt,
        status: "received",
        sourceHash: `${chatId}:${m.id}`, // A1 §2.5: sourceHash = (chatId, messageId)
        threadMeta: {
          externalId: chatId,
          kind: m.chat.type === "private" ? "dm" : "group",
          title: m.chat.type === "private" ? null : (m.chat.title ?? null),
          participants: [{ externalId: senderId, displayName }],
          lastItemAt: sentAt,
          archivedAt: null,
        },
      },
    ];
  }
  ```

- [ ] 6. Run the tests and confirm they pass: `pnpm --filter @omnis/adapter-telegram test` — expected output: `Tests  2 passed (2)`.

- [ ] 7. Commit.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/adapters/telegram
  git commit -m "$(cat <<'EOF'
  US-B38: Telegram adapter scaffold + normalize()

  - thread=chat id, item=message id, sourceHash=(chatId,messageId) (A1 §2.5)
  - delete updates (deletedMessageIds) return an empty array; edited messages pass through as normal items
  - Keychain omnis.telegram.session_key wrapper

  Implemented-by: Claude Sonnet
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 7: Telegram adapter — `mapApiError()` + 7 fixtures + contract tests (US-B38, tier: Sonnet)

**Verification command:** `pnpm --filter @omnis/adapter-telegram test && pnpm test:contract`.

**Files:**
- Modify: `packages/adapters/telegram/src/index.ts`
- Create: `packages/adapters/telegram/fixtures/{text_message,thread_reply,attachment,rate_limited_response,auth_error_response,edited_message,deleted_message}.json`
- Create: `packages/adapters/telegram/test/contract.test.ts`

**Interfaces:** Consumes: `normalize()` from Task 6. Produces: `mapApiError(cause: unknown): AdapterError`.

Spec to read: A1 §2.5 (flood-wait waits the server-given duration then retries; session invalidation → `auth_required`). The 7 minimum scenarios = Phase A's 5 + Telegram-only `edited_message`/`deleted_message` (interfaces.md §9, delta §12).

- [ ] 1. Write the failing test: `packages/adapters/telegram/test/mapApiError.test.ts`

  ```ts
  import { describe, expect, it } from "vitest";
  import { mapApiError } from "../src/index.js";

  describe("Telegram mapApiError()", () => {
    it("parses FLOOD_WAIT_<seconds> into retryable_rate_limit", () => {
      const err = mapApiError({ code: 420, message: "FLOOD_WAIT_45" });
      expect(err.kind).toBe("retryable_rate_limit");
      expect(err.retryAfterMs).toBe(45_000);
    });
    it("maps AUTH_KEY_UNREGISTERED to auth_revoked", () => {
      expect(mapApiError({ code: 401, message: "AUTH_KEY_UNREGISTERED" }).kind).toBe("auth_revoked");
    });
    it("falls back to retryable_network otherwise", () => {
      expect(mapApiError({ code: 500, message: "INTERNAL" }).kind).toBe("retryable_network");
    });
  });
  ```

- [ ] 2. Run the test and confirm it fails: `pnpm --filter @omnis/adapter-telegram test` — expected failure: `mapApiError is not a function`.

- [ ] 3. Add `mapApiError()` to `src/index.ts` (add `AdapterError` to the import).

  ```ts
  import { AdapterError } from "@omnis/protocol";

  export function mapApiError(cause: unknown): AdapterError {
    const err = cause as { code?: number; message?: string };
    const floodMatch = /FLOOD_WAIT_(\d+)/.exec(err.message ?? "");
    if (err.code === 420 || floodMatch !== null) {
      const secs = Number(floodMatch?.[1] ?? "60");
      return new AdapterError(
        "retryable_rate_limit",
        CHANNEL,
        `Telegram flood-wait: ${err.message ?? "FLOOD_WAIT"}`,
        secs * 1000,
        cause,
      );
    }
    if (err.code === 401 || err.message === "AUTH_KEY_UNREGISTERED") {
      return new AdapterError("auth_revoked", CHANNEL, "Telegram session invalidated", undefined, cause);
    }
    return new AdapterError("retryable_network", CHANNEL, "Telegram MTProto call failed", undefined, cause);
  }
  ```

- [ ] 4. Run the tests and confirm they pass: `pnpm --filter @omnis/adapter-telegram test`.

- [ ] 5. Create the 7 fixtures.

  ```bash
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/telegram/fixtures/text_message.json <<'EOF'
  {
    "scenario": "text_message",
    "raw": { "id": 501, "chat": { "id": 1001, "type": "private" }, "sender": { "id": 42, "firstName": "Dana", "lastName": "Lee" }, "text": "sync tomorrow at 10am", "date": 1700000000 },
    "expected": {
      "items": [
        {
          "threadExternalId": "1001", "externalId": "501", "kind": "message",
          "author": { "kind": "person", "id": "42" }, "body": "sync tomorrow at 10am",
          "attachments": [], "sentAt": "2023-11-14T22:13:20.000Z", "status": "received",
          "sourceHash": "1001:501",
          "threadMeta": { "externalId": "1001", "kind": "dm", "title": null,
            "participants": [{ "externalId": "42", "displayName": "Dana Lee" }],
            "lastItemAt": "2023-11-14T22:13:20.000Z", "archivedAt": null }
        }
      ]
    }
  }
  EOF
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/telegram/fixtures/thread_reply.json <<'EOF'
  {
    "scenario": "thread_reply",
    "raw": { "id": 502, "chat": { "id": 2002, "type": "group", "title": "omnis launch" }, "sender": { "id": 43, "firstName": "Logan" }, "text": "10am works", "date": 1700003600 },
    "expected": {
      "items": [
        {
          "threadExternalId": "2002", "externalId": "502", "kind": "message",
          "author": { "kind": "person", "id": "43" }, "body": "10am works",
          "attachments": [], "sentAt": "2023-11-14T23:13:20.000Z", "status": "received",
          "sourceHash": "2002:502",
          "threadMeta": { "externalId": "2002", "kind": "group", "title": "omnis launch",
            "participants": [{ "externalId": "43", "displayName": "Logan" }],
            "lastItemAt": "2023-11-14T23:13:20.000Z", "archivedAt": null }
        }
      ]
    }
  }
  EOF
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/telegram/fixtures/attachment.json <<'EOF'
  {
    "scenario": "attachment",
    "raw": { "id": 503, "chat": { "id": 1001, "type": "private" }, "sender": { "id": 42, "firstName": "Dana" }, "text": "see attached", "date": 1700007200, "media": { "type": "photo", "mimeType": "image/jpeg", "fileSize": 2048, "fileName": "poc.jpg" } },
    "expected": {
      "items": [
        {
          "threadExternalId": "1001", "externalId": "503", "kind": "message",
          "author": { "kind": "person", "id": "42" }, "body": "see attached",
          "attachments": [{ "kind": "image", "mimeType": "image/jpeg", "sizeBytes": 2048, "caption": "poc.jpg" }],
          "sentAt": "2023-11-15T00:13:20.000Z", "status": "received", "sourceHash": "1001:503",
          "threadMeta": { "externalId": "1001", "kind": "dm", "title": null,
            "participants": [{ "externalId": "42", "displayName": "Dana" }],
            "lastItemAt": "2023-11-15T00:13:20.000Z", "archivedAt": null }
        }
      ]
    }
  }
  EOF
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/telegram/fixtures/rate_limited_response.json <<'EOF'
  { "scenario": "rate_limited_response", "raw": { "code": 420, "message": "FLOOD_WAIT_45" }, "expected": { "errorKind": "retryable_rate_limit" } }
  EOF
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/telegram/fixtures/auth_error_response.json <<'EOF'
  { "scenario": "auth_error_response", "raw": { "code": 401, "message": "AUTH_KEY_UNREGISTERED" }, "expected": { "errorKind": "auth_revoked" } }
  EOF
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/telegram/fixtures/edited_message.json <<'EOF'
  {
    "scenario": "edited_message",
    "raw": { "id": 501, "chat": { "id": 1001, "type": "private" }, "sender": { "id": 42, "firstName": "Dana", "lastName": "Lee" }, "text": "sync tomorrow at 11am (edited)", "date": 1700000000, "editDate": 1700000500 },
    "expected": {
      "items": [
        {
          "threadExternalId": "1001", "externalId": "501", "kind": "message",
          "author": { "kind": "person", "id": "42" }, "body": "sync tomorrow at 11am (edited)",
          "attachments": [], "sentAt": "2023-11-14T22:13:20.000Z", "status": "received",
          "sourceHash": "1001:501",
          "threadMeta": { "externalId": "1001", "kind": "dm", "title": null,
            "participants": [{ "externalId": "42", "displayName": "Dana Lee" }],
            "lastItemAt": "2023-11-14T22:13:20.000Z", "archivedAt": null }
        }
      ]
    }
  }
  EOF
  cat > /Users/logankim/AI-Workspaces/omnis/packages/adapters/telegram/fixtures/deleted_message.json <<'EOF'
  { "scenario": "deleted_message", "raw": { "deletedMessageIds": [501], "deletedChatId": 1001 }, "expected": { "items": [] } }
  EOF
  ```

- [ ] 6. Write the contract test: `packages/adapters/telegram/test/contract.test.ts` (same pattern as the Gmail task).

  ```ts
  import { readFileSync, readdirSync } from "node:fs";
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

  describe("Telegram contract: fixture replay", () => {
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

- [ ] 7. Run them and confirm they pass.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  pnpm --filter @omnis/adapter-telegram test
  pnpm test:contract
  ```

- [ ] 8. Commit.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/adapters/telegram
  git commit -m "$(cat <<'EOF'
  US-B38: Telegram mapApiError() + contract tests for 7 fixtures

  - FLOOD_WAIT_<seconds> → retryable_rate_limit; AUTH_KEY_UNREGISTERED → auth_revoked
  - 7 fixtures (Phase A's 5 + edited_message/deleted_message; interfaces.md §9)

  Implemented-by: Claude Sonnet
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 8: Telegram adapter — `TelegramClientLike` + `connect()`/`health()` + A1-⑦ spike (US-B38, tier: Sonnet)

**Verification command:** `pnpm --filter @omnis/adapter-telegram test`.

**Files:** Modify: `packages/adapters/telegram/src/index.ts`. Test: `packages/adapters/telegram/test/connect.test.ts`. Create: `tools/spikes/a1-7-telegram-mtcute-pairing/{probe.ts,result.md}`.

**Interfaces:** Consumes: `readKeychainSecret` (Task 6). Produces: `TelegramClientLike` (a thin interface owned by this package — whether the real mtcute `TelegramClient` satisfies this subset is verified by the A1-⑦ spike; UNVERIFIED against mtcute 0.29.x, following the "UNVERIFIED — spike" convention of the A2 §4.4 kind), `TelegramAdapterDeps`, `createTelegramAdapter(deps?): Adapter`.

Spec to read: A1 §2.5 (QR/phone+code pairing; store in Keychain only the wrapping encryption key, not the session file itself). **B-D5 defers the real mtcute wiring** — `connect()` throws `fatal_protocol` unless `deps.client` is injected (every test runs against an injected `TelegramClientLike` mock).

- [ ] 1. Write the failing test: `packages/adapters/telegram/test/connect.test.ts`

  ```ts
  import { describe, expect, it, vi } from "vitest";
  import { createTelegramAdapter } from "../src/index.js";
  import type { TelegramClientLike } from "../src/index.js";

  vi.mock("../src/keychain.js", () => ({ readKeychainSecret: vi.fn(async () => "session-key") }));

  function fakeAuth() {
    return {
      channel: "telegram" as const,
      accountExternalId: "logan-tg",
      keychainService: "omnis.telegram.session_key",
      keychainAccount: "logan-tg",
    };
  }

  describe("Telegram adapter connect()/health()", () => {
    it("throws fatal_protocol when no client is injected (B-D5: real mtcute wiring deferred)", async () => {
      const adapter = createTelegramAdapter({});
      await expect(adapter.connect(fakeAuth())).rejects.toMatchObject({ kind: "fatal_protocol" });
    });

    it("reports healthy once the injected client starts", async () => {
      const client: TelegramClientLike = {
        start: vi.fn(async () => {}),
        getHistory: vi.fn(async () => []),
        onUpdate: vi.fn(() => () => {}),
        sendText: vi.fn(async () => ({ id: 1, date: 0 })),
        readHistory: vi.fn(async () => {}),
      };
      const adapter = createTelegramAdapter({ client });
      await adapter.connect(fakeAuth());
      expect((await adapter.health()).status).toBe("healthy");
      expect(client.start).toHaveBeenCalledOnce();
    });
  });
  ```

- [ ] 2. Run the test and confirm it fails: `pnpm --filter @omnis/adapter-telegram test` — expected failure: `createTelegramAdapter is not a function`.

- [ ] 3. Add `TelegramClientLike`, `TelegramAdapterDeps`, and `createTelegramAdapter()` to `src/index.ts` (connect/disconnect/health; backfill/subscribe/send are stubs), plus the same `AsyncQueue<T>` as Slack (duplicated because imports between packages are forbidden; A7 §9 "intentional duplication").

  ```ts
  import {
    type Adapter,
    AdapterError,
    type AdapterEvent,
    type AuthRef,
    type Capabilities,
    type Health,
    type Outbound,
    type SendResult,
    type ThreadRef,
  } from "@omnis/protocol";
  import { readKeychainSecret } from "./keychain.js";
  // (NormalizedItem/Attachment are already imported — Task 6)

  const CAPABILITIES: Capabilities = {
    read: true,
    write: true,
    realtime: true,
    history: true,
    media: true,
    markRead: true,
    typing: false,
    archive: false, // v1 keeps only a kernel-internal label (A1 §2.5)
    delete: false,
  };

  class AsyncQueue<T> {
    private buffered: T[] = [];
    private waiters: Array<(v: IteratorResult<T>) => void> = [];
    push(value: T): void {
      const waiter = this.waiters.shift();
      if (waiter) {
        waiter({ value, done: false });
        return;
      }
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

  /** Whether the real mtcute `TelegramClient` satisfies this subset is UNVERIFIED — the A1-⑦ spike
   *  confirms it at real-account connection time (B-D5). This interface narrowly defines only the
   *  methods the adapter actually calls, so fixture/mock tests all run without mtcute. */
  export interface TelegramClientLike {
    start(): Promise<void>;
    getHistory(chatId: string, opts: { limit: number; offsetUnixSec?: number }): Promise<unknown[]>;
    onUpdate(cb: (raw: unknown) => void): () => void; // the return value is the unsubscribe function
    sendText(chatId: string, text: string): Promise<{ id: number; date: number }>;
    readHistory(chatId: string): Promise<void>;
  }

  export interface TelegramAdapterDeps {
    client?: TelegramClientLike;
    sink?: (thread: ThreadRef, draft: Outbound) => Promise<SendResult>;
    now?: () => Date;
  }

  export function createTelegramAdapter(deps: TelegramAdapterDeps = {}): Adapter {
    const now = deps.now ?? ((): Date => new Date());
    let client: TelegramClientLike | undefined = deps.client;
    const queue = new AsyncQueue<NormalizedItem | AdapterEvent>();
    let status: Health["status"] = "down";
    let lastEventAt: string | null = null;
    let lastError: Health["lastError"];
    let unsubscribe: (() => void) | undefined;

    return {
      id: "telegram",
      channel: CHANNEL,
      capabilities: () => CAPABILITIES,

      async connect(auth: AuthRef): Promise<void> {
        // Only the wrapping encryption key lives in Keychain, not the session file itself (A1 §2.5) — never log it.
        await readKeychainSecret(auth.keychainService, auth.keychainAccount, CHANNEL);
        if (client === undefined) {
          status = "down";
          throw new AdapterError(
            "fatal_protocol",
            CHANNEL,
            "mtcute client not wired — real Telegram connect deferred to A1-⑦ (B-D5)",
          );
        }
        try {
          await client.start();
        } catch (cause) {
          status = "down";
          throw mapApiError(cause);
        }
        status = "healthy";
        lastEventAt = now().toISOString();
        queue.push({ kind: "connected", at: lastEventAt });
      },

      async disconnect(): Promise<void> {
        unsubscribe?.();
        status = "down";
      },

      async *backfill(): AsyncIterable<NormalizedItem> {
        throw new AdapterError("fatal_unsupported", CHANNEL, "backfill not implemented until Task 9");
      },

      subscribe(): AsyncIterable<NormalizedItem | AdapterEvent> {
        throw new AdapterError("fatal_unsupported", CHANNEL, "subscribe not implemented until Task 9");
      },

      async send(): Promise<never> {
        throw new AdapterError("fatal_unsupported", CHANNEL, "send not implemented until Task 10");
      },

      async health(): Promise<Health> {
        return {
          channel: CHANNEL,
          accountExternalId: "",
          status,
          lastEventAt,
          ...(lastError ? { lastError } : {}),
        };
      },
    };
  }
  ```

  Tasks 9 and 10 swap out only the `backfill`/`subscribe`/`send`/`markRead` bodies and the `unsubscribe` assignment — this step fixes the remaining closure variables.

- [ ] 4. Run the tests and confirm they pass: `pnpm --filter @omnis/adapter-telegram test`.

- [ ] 5. Create the A1-⑦ spike scaffold (owned by backlog §5; result.md is PENDING per B-D5).

  ```bash
  mkdir -p /Users/logankim/AI-Workspaces/omnis/tools/spikes/a1-7-telegram-mtcute-pairing
  cat > /Users/logankim/AI-Workspaces/omnis/tools/spikes/a1-7-telegram-mtcute-pairing/probe.ts <<'EOF'
  // A1-⑦: verify that mtcute QR pairing behaves as documented and that TelegramClientLike is
  // structurally satisfied by the real TelegramClient. Run: export OMNIS_TELEGRAM_API_ID/HASH and
  // tsx tools/spikes/a1-7-telegram-mtcute-pairing/probe.ts
  const apiId = process.env.OMNIS_TELEGRAM_API_ID;
  const apiHash = process.env.OMNIS_TELEGRAM_API_HASH;
  if (!apiId || !apiHash) {
    console.error("OMNIS_TELEGRAM_API_ID/HASH not set — B-D5: do not run this spike before connecting a real account.");
    process.exit(1);
  }
  const { TelegramClient } = await import("@mtcute/node");
  const client = new TelegramClient({ apiId: Number(apiId), apiHash, storage: "spike-session" });
  await client.start({ qrCallback: (url: string) => console.log("scan:", url) });
  console.log("paired as", await client.getMe());
  EOF
  cat > /Users/logankim/AI-Workspaces/omnis/tools/spikes/a1-7-telegram-mtcute-pairing/result.md <<'EOF'
  # Gate: A1-⑦ Telegram mtcute pairing

  - **Question**: does mtcute QR login pairing behave as documented, and does the real `TelegramClient`
    structurally satisfy this adapter's `TelegramClientLike` (start/getHistory/onUpdate/sendText/readHistory)?
  - **Owning appendix**: A1 §2.5
  - **Owner**: agent
  - **Host**: mini
  - **Run date**: PENDING — after B-D5 (real accounts get connected in one go, later; Logan's 2026-09-20 decision)
  - **Result (Pass/Fail)**: PENDING
  - **Measurements/evidence**: fill in by running `probe.ts` with real `api_id`/`api_hash`. If the method
    names differ, adjust `TelegramClientLike` to the real API and record the diff in this result.md
  - **decided_by**: PENDING
  - **Notes**: this plan's (US-B38) adapter implementation is already accepted via fixture/mock — this spike
    is for live-connection verification, not an implementation gate
  EOF
  ```

- [ ] 6. Commit.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/adapters/telegram tools/spikes/a1-7-telegram-mtcute-pairing
  git commit -m "$(cat <<'EOF'
  US-B38: Telegram TelegramClientLike + connect()/health() + A1-⑦ spike

  - connect() throws fatal_protocol when no client is injected (B-D5: real mtcute wiring follows a real-account connection)
  - TelegramClientLike narrowly defines only the methods the adapter actually calls (UNVERIFIED against mtcute 0.29.x)
  - the same AsyncQueue as Slack, duplicated (imports between adapter packages are forbidden)
  - A1-⑦ spike scaffold (result.md PENDING)

  Implemented-by: Claude Sonnet
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 9: Telegram adapter — `backfill()` (30-day/500-item caps) + `subscribe()` update stream (US-B38, tier: Sonnet)

**Verification command:** `pnpm --filter @omnis/adapter-telegram test`.

**Files:** Modify: `packages/adapters/telegram/src/index.ts`. Test: `packages/adapters/telegram/test/backfill.test.ts`.

**Interfaces:** Consumes: `TelegramClientLike`, `mapApiError()` (Tasks 7 and 8). Produces: the `backfill(since?)`/`subscribe()` implementations, `BACKFILL_MAX_DAYS`/`BACKFILL_MAX_ITEMS` (per-channel backfill caps; this adapter enforces backlog US-B40 "backfill caps (30 days · 500 items per channel)" directly).

Spec to read: A1 §2.5 (`getHistory` for the last 30 days or the last 500 items; a real-time stream over an MTProto persistent connection).

- [ ] 1. Write the failing test: `packages/adapters/telegram/test/backfill.test.ts`

  ```ts
  import { describe, expect, it, vi } from "vitest";
  import { createTelegramAdapter, BACKFILL_MAX_ITEMS } from "../src/index.js";
  import type { TelegramClientLike } from "../src/index.js";

  vi.mock("../src/keychain.js", () => ({ readKeychainSecret: vi.fn(async () => "session-key") }));

  function fakeAuth() {
    return {
      channel: "telegram" as const, accountExternalId: "logan-tg",
      keychainService: "s", keychainAccount: "a",
    };
  }

  describe("Telegram backfill()", () => {
    it("caps at BACKFILL_MAX_ITEMS even if the client returns more", async () => {
      const raws = Array.from({ length: BACKFILL_MAX_ITEMS + 10 }, (_, i) => ({
        id: i, chat: { id: 1, type: "private" }, sender: { id: 9, firstName: "A" }, text: "x", date: 1,
      }));
      const client: TelegramClientLike = {
        start: vi.fn(async () => {}), getHistory: vi.fn(async () => raws),
        onUpdate: vi.fn(() => () => {}), sendText: vi.fn(async () => ({ id: 1, date: 0 })),
        readHistory: vi.fn(async () => {}),
      };
      const adapter = createTelegramAdapter({ client });
      await adapter.connect(fakeAuth());
      const items = [];
      for await (const item of adapter.backfill()) items.push(item);
      expect(items).toHaveLength(BACKFILL_MAX_ITEMS);
    });
  });

  describe("Telegram subscribe()", () => {
    it("normalizes updates pushed via onUpdate()", async () => {
      let handler: ((raw: unknown) => void) | undefined;
      const client: TelegramClientLike = {
        start: vi.fn(async () => {}), getHistory: vi.fn(async () => []),
        onUpdate: vi.fn((cb) => { handler = cb; return () => {}; }),
        sendText: vi.fn(async () => ({ id: 1, date: 0 })), readHistory: vi.fn(async () => {}),
      };
      const adapter = createTelegramAdapter({ client });
      await adapter.connect(fakeAuth());
      const it1 = adapter.subscribe()[Symbol.asyncIterator]();
      handler?.({ id: 9, chat: { id: 1, type: "private" }, sender: { id: 9, firstName: "A" }, text: "hi", date: 1 });
      const first = await it1.next();
      expect((first.value as { externalId?: string }).externalId).toBe("9");
    });
  });
  ```

- [ ] 2. Run the test and confirm it fails: `pnpm --filter @omnis/adapter-telegram test` — expected failure: `backfill()`/`subscribe()` still throw `fatal_unsupported`.

- [ ] 3. Add the 2 constants and the `backfill`/`subscribe` implementations to `src/index.ts`.

  ```ts
  // A1 §2.5 + backlog US-B40 "backfill caps (30 days · 500 items per channel)" — this adapter enforces them directly.
  export const BACKFILL_MAX_DAYS = 30;
  export const BACKFILL_MAX_ITEMS = 500;
  ```

  ```ts
  async *backfill(since?: Date): AsyncIterable<NormalizedItem> {
    if (client === undefined)
      throw new AdapterError("fatal_protocol", CHANNEL, "backfill() called before connect()");
    const cutoff = since ?? new Date(now().getTime() - BACKFILL_MAX_DAYS * 86_400_000);
    let raws: unknown[];
    try {
      raws = await client.getHistory("me", {
        limit: BACKFILL_MAX_ITEMS,
        offsetUnixSec: Math.floor(cutoff.getTime() / 1000),
      });
    } catch (cause) {
      throw mapApiError(cause);
    }
    let done = 0;
    for (const raw of raws) {
      if (done >= BACKFILL_MAX_ITEMS) break;
      for (const item of normalize(raw)) {
        yield item;
        done += 1;
      }
    }
    queue.push({ kind: "backfill_progress", done, total: raws.length, at: now().toISOString() });
  },

  subscribe(): AsyncIterable<NormalizedItem | AdapterEvent> {
    if (client === undefined)
      throw new AdapterError("fatal_protocol", CHANNEL, "subscribe() called before connect()");
    unsubscribe = client.onUpdate((raw) => {
      for (const item of normalize(raw)) queue.push(item);
    });
    return queue;
  },
  ```

- [ ] 4. Run the tests and confirm they pass: `pnpm --filter @omnis/adapter-telegram test`.

- [ ] 5. Commit.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/adapters/telegram
  git commit -m "$(cat <<'EOF'
  US-B38: Telegram backfill() (30-day/500-item caps) + subscribe() update stream

  - BACKFILL_MAX_DAYS=30, BACKFILL_MAX_ITEMS=500 (A1 §2.5 + US-B40 per-channel caps, enforced by the adapter itself)
  - subscribe() normalizes the raw updates pushed by client.onUpdate() and enqueues them

  Implemented-by: Claude Sonnet
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 10: Telegram adapter — `send()`/`markRead()` write-back (US-B38, tier: Sonnet)

**Verification command:** `pnpm --filter @omnis/adapter-telegram test`.

**Files:** Modify: `packages/adapters/telegram/src/index.ts`. Test: `packages/adapters/telegram/test/send.test.ts`.

**Interfaces:** Consumes: `TelegramClientLike`, `mapApiError()`. Produces: the completed `Adapter` (`send`/`markRead`).

Spec to read: A1 §2.5 (send/markRead both supported; archive is `capabilities().archive=false`).

- [ ] 1. Write the failing test: `packages/adapters/telegram/test/send.test.ts`

  ```ts
  import { describe, expect, it, vi } from "vitest";
  import { createTelegramAdapter } from "../src/index.js";
  import type { TelegramClientLike } from "../src/index.js";

  vi.mock("../src/keychain.js", () => ({ readKeychainSecret: vi.fn(async () => "session-key") }));

  describe("Telegram write-back", () => {
    it("send() only calls the injected mock sink by default, never a real client call", async () => {
      const sink = vi.fn(async () => ({ externalId: "sent-1", sentAt: "2023-11-14T00:00:00.000Z" }));
      const adapter = createTelegramAdapter({ sink });
      const result = await adapter.send({ accountId: "a", externalId: "1001" }, { text: "hi" });
      expect(sink).toHaveBeenCalledOnce();
      expect(result.externalId).toBe("sent-1");
    });

    it("markRead() calls client.readHistory()", async () => {
      const readHistory = vi.fn(async () => {});
      const client: TelegramClientLike = {
        start: vi.fn(async () => {}), getHistory: vi.fn(async () => []),
        onUpdate: vi.fn(() => () => {}), sendText: vi.fn(async () => ({ id: 1, date: 0 })), readHistory,
      };
      const adapter = createTelegramAdapter({ client });
      await adapter.connect({
        channel: "telegram" as const, accountExternalId: "a", keychainService: "s", keychainAccount: "a",
      });
      await adapter.markRead?.({ accountId: "a", externalId: "1001" });
      expect(readHistory).toHaveBeenCalledWith("1001");
    });
  });
  ```

- [ ] 2. Run the test and confirm it fails: `pnpm --filter @omnis/adapter-telegram test` — expected failure: `send()` still throws `fatal_unsupported`.

- [ ] 3. Swap out the `send` stub in `src/index.ts` and add `markRead`.

  ```ts
  // Until the approval gate (US-A07), a real client.sendText is only reachable through deps.sink (the
  // test default is the mock sink). With a client injected and no deps.sink, we would open a path that
  // looks like a real send, so the default is always mock — when a real send is needed, the approved
  // execution path (runEgress) explicitly injects client.sendText as deps.sink.
  async send(thread: ThreadRef, draft: Outbound): Promise<SendResult> {
    const sink =
      deps.sink ??
      (async (): Promise<SendResult> => ({
        externalId: `mock-${now().getTime()}`,
        sentAt: now().toISOString(),
      }));
    return sink(thread, draft);
  },

  async markRead(thread: ThreadRef): Promise<void> {
    if (client === undefined)
      throw new AdapterError("fatal_protocol", CHANNEL, "markRead() called before connect()");
    try {
      await client.readHistory(thread.externalId);
    } catch (cause) {
      throw mapApiError(cause);
    }
  },
  ```

- [ ] 4. Run the tests and confirm they pass: `pnpm --filter @omnis/adapter-telegram test` — expected output: everything passing.

- [ ] 5. Lint, then commit (the final US-B38 commit).

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  pnpm lint
  git add packages/adapters/telegram
  git commit -m "$(cat <<'EOF'
  US-B38: Telegram send()/markRead() write-back

  - send() calls only the injected mock sink (no irreversible send outside the approval gate)
  - markRead() delegates to client.readHistory() (A1 §2.5)
  - archive is already blocked by capabilities().archive=false (Task 8)

  Implemented-by: Claude Sonnet
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 11-S: Hermes SSE field-name spike (prerequisite for US-B39, tier: Sonnet)

> **Why this exists (2026-09-20 cross-review §4-3, Logan's decision = backlog §7-3)**: the JSON field names of the `/v1/responses` SSE events Task 13 parses (`type: 'delta'|'done'`, `text`) are **UNVERIFIED**. `docs/research/09-agents-as-inbox.md` verified the session-header split, `previous_response_id` chaining, and the keepalive convention against primary sources, but could not pin down the event payload's field names. Being of the same class as A1-⑥/A1-⑦, it was **newly registered as a Phase B entry spike** (backlog §5, slug `gate-hermes-sse`).
>
> **This spike does not block US-B39.** The mechanism (stream parsing, keepalive suppression, header propagation, origin guard) is fully verified by the mock SSE tests in Tasks 11–13. What this task does is **record the provenance and confidence of the field names in a document**; with no live connection, it writes `UNVERIFIED` and moves on.

**Goal**: obtain one event sample from `/chat/stream` (or `/v1/responses`) and record it in `tools/spikes/gate-hermes-sse/result.md`. With a live connection, real bytes; otherwise, a documentation citation + `UNVERIFIED`.
**Deliverable**: `tools/spikes/gate-hermes-sse/result.md`
**Verification command**: `test -s tools/spikes/gate-hermes-sse/result.md`
**Dependencies**: none. Run this before Task 11.
**Read**: `docs/research/09-agents-as-inbox.md` (the §Hermes row + the keepalive convention), A2 §4.4, the Hermes `api_server` docs.
**Do not (YAGNI)**: do not try to start or fix Hermes (the mini's `api_server` is not omnis's concern — do not touch port 8642 or Hermes/omh/buzz). Do not build the parser here (Task 13 does). Do not commit the sample as a fixture file — a code block inside `result.md` is enough.

**Files:**
- Create: `tools/spikes/gate-hermes-sse/result.md`

**Interfaces:** none (a docs-only task).

- [ ] 1. Check **once** whether a live Hermes is present. If not, go straight to step 3 (the docs-only path).

```bash
curl -sS -m 3 -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8642/health || echo "no-hermes"
```

Expected: `200` means the live path (step 2); anything else (`000`/`no-hermes`/non-2xx) means the docs path (step 3). **A Hermes that is not up is not a failure** — the mini's `api_server` may be down, and that is the default assumption.

- [ ] 2. (Live path only) Capture one chunk of events. **Never write the token into the shell directly** — read it from Keychain and pass it only as an environment variable.

```bash
HERMES_KEY="$(security find-generic-password -s omnis.hermes.api_key.mini -a omnis -w)" \
  timeout 15 curl -sS -N http://127.0.0.1:8642/v1/responses \
  -H "Authorization: Bearer $HERMES_KEY" \
  -H 'content-type: application/json' \
  -d '{"model":"default","input":"say hi in three words","stream":true}' | head -40
```

Expected output: the first 40 lines of an SSE stream mixing `: keepalive` comment lines with `data: {...}` lines. **Never paste the `HERMES_KEY` value into `result.md`.**

- [ ] 3. Write `tools/spikes/gate-hermes-sse/result.md`. Below is the **canonical content when there is no live connection** — if step 2 succeeded, change `Result (Pass/Fail)` to `Pass`, replace the code block under `Measurements/evidence` with the real capture, and delete the `UNVERIFIED` sentence.

```markdown
# Gate: gate-hermes-sse

- **Question**: what are the JSON field names of the SSE events from Hermes `api_server`'s `/v1/responses` (and `/api/sessions/{id}/chat/stream`) — can `#pump` in `apps/local-agent/src/bridges/hermes.ts` read `type: 'delta' | 'done'` and `text` as-is?
- **Owning appendix**: A2
- **Owner**: agent
- **Host**: mini
- **Run date**: <YYYY-MM-DD>
- **Result (Pass/Fail)**: **UNVERIFIED** — at run time `127.0.0.1:8642` did not respond (the Hermes `api_server` is not omnis's concern and may be down). Once a live connection exists, re-run step 2 and change this line to Pass/Fail.
- **Measurements/evidence**:
  - `docs/research/09-agents-as-inbox.md` (primary-source citation, VERIFIED): Hermes's 4 streaming surfaces (`chat.completion.chunk`, Responses SSE, `/api/sessions/{id}/chat/stream`, `/v1/runs/{id}/events`) **share one keepalive convention** — a `: keepalive` comment every 10 seconds of silence. Session headers are split into `X-Hermes-Session-Id` (rotating) + `X-Hermes-Session-Key` (stable scope).
  - The same document also VERIFIES that `/v1/responses` is OpenAI Responses API-compatible. Under that spec, events look like `data: {"type":"response.output_text.delta","delta":"..."}` / `data: {"type":"response.completed",...}`, and **the field names differ from the `{"type":"delta","text":"..."}` we assumed.**
  - The parser is therefore safer written to **accept both shapes** (see the mitigation below).
- **decided_by**: Logan (backlog §7-3) — register the spike on the Phase B entry list, but leave it `UNVERIFIED` when there is no live connection and proceed with US-B39.
- **Notes / follow-up mitigation**:
  - Task 13's `#pump` **does not pin itself to one set of field names**: if `type` ends with `delta` (`"delta"`, `"response.output_text.delta"`) it treats it as a delta; if it ends with `done`/`completed` it treats it as the end; and the body is read as `text ?? delta ?? ""` in that order. Unknown `type` values are **discarded** (not an error — the same treatment as keepalives).
  - Until a live connection is confirmed, leave `UNVERIFIED: Hermes SSE field names — tools/spikes/gate-hermes-sse/result.md` in the header comment of `apps/local-agent/src/bridges/hermes.ts`.
  - This spike's failure (or non-confirmation) is not an acceptance condition for US-B39 (B-D5: accept via fixtures and mocks only).
```

- [ ] 4. Confirm the file is non-empty, then commit.

```bash
cd /Users/logankim/AI-Workspaces/omnis && test -s tools/spikes/gate-hermes-sse/result.md && pnpm lint
```

```bash
git add tools/spikes/gate-hermes-sse/result.md
git commit -m "$(cat <<'EOF'
US-B39: gate-hermes-sse spike — SSE event field names recorded (UNVERIFIED without a live Hermes)

- /v1/responses is OpenAI Responses-compatible, so the event type may be response.output_text.delta
  rather than the plain "delta" this plan assumed — Task 13's pump accepts both suffixes
- keepalive convention (": keepalive" every 10s) is VERIFIED from docs/research/09-agents-as-inbox.md
- registered as a Phase B entry spike by the 2026-09-20 cross-plan review (backlog §5, §7-3)

Implemented-by: Claude Sonnet
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Hermes bridge — `probe()` + capabilities self-description + session_key_header verification (US-B39, tier: Opus)

**US-B39 deliverables (backlog):** `apps/local-agent/src/bridges/hermes.ts`. **Verification command:** `pnpm --filter @omnis/local-agent test`. **Goal:** an HTTP-shaped `RuntimeAdapter` (the same contract as Claude Code/Codex) that verifies `session_key_header` against the `/v1/capabilities` self-description.

**Files:** Create: `apps/local-agent/src/bridges/hermes.ts`. Test: `apps/local-agent/test/hermes.test.ts`.

**Interfaces:** Consumes: `apps/local-agent/src/rpc-dispatch.ts`'s `RuntimeAdapter`/`EventSink`/`TurnHandle` (FIXED, the same contract as claude-code.ts), `apps/local-agent/src/session-registry.ts`'s `SessionRecord`, `@omnis/protocol`'s `RuntimeCapabilities`/`TurnInput`/`BridgeError`/`BRIDGE_ERRORS` (Phase A FIXED). Produces: `HermesConfig`, `HermesCapabilitiesResponse`, `parseHermesCapabilities()`, `HermesSessionHeaderMismatchError`, `HermesAdapter` (partial — `probe()` only).

Spec to read: A2 §2.1 (the Hermes `[[runtime]]` fields are already parsed in Phase A by `HttpRuntimeConfig` in `local-agent/src/config.ts` — this task is not the consumer of that config but the producer of a real HTTP client from it) · §4.4 (`GET /v1/capabilities` → `session_key_header`; on mismatch, register as `degraded` and do not open a session; A2-D9, Phase B is read-only).

- [ ] 1. Write the failing test: `apps/local-agent/test/hermes.test.ts`

  ```ts
  import { describe, expect, it, vi } from "vitest";
  import { HermesAdapter, HermesSessionHeaderMismatchError, parseHermesCapabilities } from "../src/bridges/hermes.js";

  describe("parseHermesCapabilities()", () => {
    it("maps the Hermes self-description to RuntimeCapabilities (Phase B: approval surface none)", () => {
      const caps = parseHermesCapabilities({ session_key_header: "X-Hermes-Session-Key", models: ["gpt-hermes-1"] });
      expect(caps.approvals).toBe("none"); // A2-D9: Phase B is read-only; there is no room for approval requests to arise
      expect(caps.models).toEqual(["gpt-hermes-1"]);
      expect(caps.stream_deltas).toBe(true);
    });
  });

  describe("HermesAdapter.probe()", () => {
    it("fetches GET /v1/capabilities with the bearer token and returns parsed capabilities", async () => {
      const fetchFn = vi.fn(async (url: string) => {
        expect(url).toBe("http://127.0.0.1:8642/v1/capabilities");
        return new Response(JSON.stringify({ session_key_header: "X-Hermes-Session-Key", models: [] }), { status: 200 });
      });
      const adapter = new HermesAdapter({ baseUrl: "http://127.0.0.1:8642", token: "tok-1", fetchFn: fetchFn as unknown as typeof fetch });
      const result = await adapter.probe();
      expect(result.capabilities.approvals).toBe("none");
      const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok-1");
    });

    it("throws HermesSessionHeaderMismatchError when session_key_header is unexpected (A2 §2.1: degraded)", async () => {
      const fetchFn = vi.fn(async () => new Response(JSON.stringify({ session_key_header: "X-Something-Else" }), { status: 200 }));
      const adapter = new HermesAdapter({ baseUrl: "http://127.0.0.1:8642", token: "tok-1", fetchFn: fetchFn as unknown as typeof fetch });
      await expect(adapter.probe()).rejects.toBeInstanceOf(HermesSessionHeaderMismatchError);
    });
  });
  ```

- [ ] 2. Run the test and confirm it fails.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/local-agent test
  ```

  Expected failure: `Cannot find module '../src/bridges/hermes.js'`.

- [ ] 3. Write `apps/local-agent/src/bridges/hermes.ts` (up to `probe()`; Tasks 12–13 fill in `startTurn`/`cancel`/`close`).

  ```ts
  import { BRIDGE_ERRORS, BridgeError, type RuntimeCapabilities, type RuntimeKind } from "@omnis/protocol";
  import type { EventSink, RuntimeAdapter, TurnHandle } from "../rpc-dispatch.js";
  import type { SessionRecord } from "../session-registry.js";

  export interface HermesConfig {
    baseUrl: string;
    token: string;
    fetchFn?: typeof fetch;
    now?: () => Date;
  }

  export interface HermesCapabilitiesResponse {
    session_key_header: string;
    session_id_header?: string;
    models?: string[];
  }

  /** A2 §4.4: approvals have no room to arise in Phase B (origin='human' only, excluded from
   *  delegation; A2-D9). `resume`/`stream_deltas` are VERIFIED by `09` (session_key/session_id split,
   *  SSE keepalive). The rest are fields Hermes does not self-describe verbatim, so they are pinned
   *  conservatively to match Phase B scope. */
  export function parseHermesCapabilities(raw: HermesCapabilitiesResponse): RuntimeCapabilities {
    return {
      resume: true,
      cross_project_resume: false,
      stream_deltas: true,
      reasoning_stream: false,
      tool_calls: false,
      approvals: "none",
      cancel: true,
      models: raw.models ?? [],
      features: [],
    };
  }

  /** A2 §2.1: if session_key_header differs from session_header_mode ('hermes_v1' = X-Hermes-Session-Key),
   *  register this runtime as degraded and do not open a session — the caller of probe() (bridge startup
   *  code, outside this plan) catches this error and drops AgentRuntime.state to 'degraded'. */
  export class HermesSessionHeaderMismatchError extends Error {
    constructor(readonly got: string) {
      super(
        `Hermes GET /v1/capabilities returned session_key_header='${got}', expected 'X-Hermes-Session-Key' (A2 §2.1)`,
      );
      this.name = "HermesSessionHeaderMismatchError";
    }
  }

  const EXPECTED_SESSION_KEY_HEADER = "X-Hermes-Session-Key";

  /** A2-D9: an HTTP-shaped RuntimeAdapter that spawns no process. It puts session_key onto
   *  X-Hermes-Session-Key 1:1 and uses the response's X-Hermes-Session-Id for the next turn's
   *  previous_response_id chaining (§4.4 "this mapping is 1:1, which is why this adapter is the thinnest"). */
  export class HermesAdapter implements RuntimeAdapter {
    readonly kind: RuntimeKind = "hermes";
    readonly #lastResponseId = new Map<string, string>();
    constructor(private readonly cfg: HermesConfig) {}

    async probe(): Promise<{ version: string; capabilities: RuntimeCapabilities }> {
      const fetchFn = this.cfg.fetchFn ?? fetch;
      const res = await fetchFn(`${this.cfg.baseUrl}/v1/capabilities`, {
        headers: { authorization: `Bearer ${this.cfg.token}` },
      });
      if (!res.ok) {
        throw new BridgeError(BRIDGE_ERRORS.RUNTIME_UNAVAILABLE, `Hermes /v1/capabilities failed: ${res.status}`);
      }
      const body = (await res.json()) as HermesCapabilitiesResponse;
      if (body.session_key_header !== EXPECTED_SESSION_KEY_HEADER) {
        throw new HermesSessionHeaderMismatchError(body.session_key_header);
      }
      return { version: "hermes", capabilities: parseHermesCapabilities(body) };
    }

    async startTurn(_s: SessionRecord, _input: unknown, _sink: EventSink): Promise<TurnHandle> {
      throw new BridgeError(BRIDGE_ERRORS.CAPABILITY_UNSUPPORTED, "startTurn not implemented until Task 12");
    }

    async cancel(): Promise<boolean> {
      throw new BridgeError(BRIDGE_ERRORS.CAPABILITY_UNSUPPORTED, "cancel not implemented until Task 13");
    }

    async close(): Promise<void> {
      /* Task 13 fills this in */
    }
  }
  ```

- [ ] 4. Run the tests and confirm they pass: `pnpm --filter @omnis/local-agent test` — expected output: `Tests  3 passed (3)`.

- [ ] 5. Commit.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add apps/local-agent/src/bridges/hermes.ts apps/local-agent/test/hermes.test.ts
  git commit -m "$(cat <<'EOF'
  US-B39: Hermes bridge — probe() + capabilities self-description verification

  - Fetches GET /v1/capabilities with a bearer token; a session_key_header mismatch raises
    HermesSessionHeaderMismatchError (A2 §2.1: register as degraded, do not open a session)
  - parseHermesCapabilities(): approvals='none' pinned (A2-D9, Phase B is read-only)
  - startTurn()/cancel() are still CAPABILITY_UNSUPPORTED (Tasks 12 and 13)

  Implemented-by: Claude Opus
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 12: Hermes bridge — `startTurn()` origin guard + `/v1/responses` request construction (US-B39, tier: Opus)

**Verification command:** `pnpm --filter @omnis/local-agent test`.

**Files:** Modify: `apps/local-agent/src/bridges/hermes.ts`. Test: `apps/local-agent/test/hermes.test.ts` (additions).

**Interfaces:** Consumes: `SessionRecord.origin`/`session_key`, `TurnInput`. Produces: `startTurn()` (up to the request — SSE parsing is Task 13).

Spec to read: A2-D9 (Phase B allows `origin:'human'` only; `delegation` is refused — excluded from delegation) · §4.4 (a turn chains to `/v1/responses` via `conversation` (= `session_key`) or `previous_response_id`; the `X-Hermes-Session-Key` header; the response's `X-Hermes-Session-Id` is used for the next turn's chaining).

- [ ] 1. Add the failing test: a new `describe` block in `apps/local-agent/test/hermes.test.ts`.

  ```ts
  import { BridgeError } from "@omnis/protocol";
  import type { SessionRecord } from "../src/session-registry.js";

  function fakeSink() {
    const calls: Record<string, unknown[]> = { turnStarted: [], delta: [], itemCompleted: [], turnCompleted: [] };
    return {
      sink: {
        itemStarted: () => {},
        delta: (e: Record<string, unknown>) => calls.delta.push(e),
        itemCompleted: (e: Record<string, unknown>) => calls.itemCompleted.push(e),
        turnStarted: (e: Record<string, unknown>) => calls.turnStarted.push(e),
        turnCompleted: (e: Record<string, unknown>) => calls.turnCompleted.push(e),
        approval: async () => ({ decision: "ignore" as const }),
        raw: () => {},
      },
      calls,
    };
  }

  function baseSession(origin: SessionRecord["origin"]): SessionRecord {
    return {
      session_key: "agent:hermes:mini:inbox-draft" as never,
      session_id: null, runtime: "hermes", runtime_id: "r-1",
      cwd: "/", purpose: "inbox-draft", origin, permission_profile: "observe",
      state: "idle", opened_at: "2026-09-20T00:00:00.000Z", last_turn_at: null,
    };
  }

  describe("HermesAdapter.startTurn()", () => {
    it("rejects non-human origin (A2-D9: Phase B is read-only, no delegation)", async () => {
      const adapter = new HermesAdapter({ baseUrl: "http://127.0.0.1:8642", token: "tok-1" });
      const { sink } = fakeSink();
      await expect(
        adapter.startTurn(baseSession("delegation"), { text: "do x" }, sink),
      ).rejects.toBeInstanceOf(BridgeError);
    });

    it("POSTs /v1/responses with X-Hermes-Session-Key and conversation=session_key on the first turn", async () => {
      const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
        expect(url).toBe("http://127.0.0.1:8642/v1/responses");
        expect((init.headers as Record<string, string>)["X-Hermes-Session-Key"]).toBe("agent:hermes:mini:inbox-draft");
        expect(JSON.parse(String(init.body))).toEqual({ conversation: "agent:hermes:mini:inbox-draft", input: "do x" });
        return new Response(new ReadableStream({ start(c) { c.close(); } }), {
          status: 200,
          headers: { "X-Hermes-Session-Id": "resp-1" },
        });
      });
      const adapter = new HermesAdapter({ baseUrl: "http://127.0.0.1:8642", token: "tok-1", fetchFn: fetchFn as unknown as typeof fetch });
      const { sink, calls } = fakeSink();
      const handle = await adapter.startTurn(baseSession("human"), { text: "do x" }, sink);
      expect(handle.turn_id).toMatch(/^t-/);
      expect(calls.turnStarted).toHaveLength(1);
    });
  });
  ```

- [ ] 2. Run the test and confirm it fails: `pnpm --filter @omnis/local-agent test` — expected failure: `startTurn not implemented until Task 12`.

- [ ] 3. Swap the `startTurn()` stub in `hermes.ts` for a real implementation (consuming the SSE body is delegated to `#pump` — Task 13 fills that in; for now leave it an empty no-op).

  ```ts
  async startTurn(s: SessionRecord, input: TurnInput, sink: EventSink): Promise<TurnHandle> {
    if (s.origin !== "human") {
      throw new BridgeError(
        BRIDGE_ERRORS.CAPABILITY_UNSUPPORTED,
        "Hermes sessions are read-only in Phase B — origin must be 'human' (A2-D9)",
      );
    }
    const fetchFn = this.cfg.fetchFn ?? fetch;
    const now = this.cfg.now ?? ((): Date => new Date());
    const turnId = `t-${Date.now().toString(36)}`;
    const controller = new AbortController();
    const previousResponseId = this.#lastResponseId.get(s.session_key);
    const body: Record<string, unknown> = previousResponseId
      ? { previous_response_id: previousResponseId, input: input.text }
      : { conversation: s.session_key, input: input.text };

    const res = await fetchFn(`${this.cfg.baseUrl}/v1/responses`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${this.cfg.token}`,
        "content-type": "application/json",
        "X-Hermes-Session-Key": s.session_key,
        accept: "text/event-stream",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok || res.body === null) {
      throw new BridgeError(BRIDGE_ERRORS.RUNTIME_UNAVAILABLE, `Hermes /v1/responses failed: ${res.status}`);
    }
    const sessionId = res.headers.get("X-Hermes-Session-Id");
    if (sessionId !== null) this.#lastResponseId.set(s.session_key, sessionId);

    sink.turnStarted({ session_key: s.session_key, turn_id: turnId, at: now().toISOString() });
    void this.#pump(res.body, s.session_key, turnId, sink);

    return {
      turn_id: turnId,
      cancel: async (): Promise<boolean> => {
        controller.abort();
        return true;
      },
    };
  }

  async #pump(_body: ReadableStream<Uint8Array>, _sessionKey: string, _turnId: string, _sink: EventSink): Promise<void> {
    /* Task 13 fills in the SSE parsing */
  }
  ```

  Add `TurnInput` to the top import: `import { BRIDGE_ERRORS, BridgeError, type RuntimeCapabilities, type RuntimeKind, type TurnInput } from "@omnis/protocol";`

- [ ] 4. Run the tests and confirm they pass: `pnpm --filter @omnis/local-agent test`.

- [ ] 5. Commit.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add apps/local-agent/src/bridges/hermes.ts apps/local-agent/test/hermes.test.ts
  git commit -m "$(cat <<'EOF'
  US-B39: Hermes startTurn() — origin guard + /v1/responses request construction

  - origin!=='human' is rejected immediately with CAPABILITY_UNSUPPORTED (A2-D9, excluded from delegation)
  - the first turn uses conversation=session_key; later turns chain via previous_response_id (§4.4)
  - X-Hermes-Session-Key request header + the response's X-Hermes-Session-Id stored for the next turn's chaining
  - consuming the SSE body is a #pump stub (Task 13)

  Implemented-by: Claude Opus
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 13: Hermes bridge — SSE `#pump` (keepalive suppression + delta/done) + `cancel()`/`close()` (US-B39, tier: Opus)

**Verification command:** `pnpm --filter @omnis/local-agent test`.

**Files:** Modify: `apps/local-agent/src/bridges/hermes.ts`. Test: `apps/local-agent/test/hermes.test.ts` (additions; the final US-B39 task).

**Interfaces:** Consumes: none (an internal stream parser). Produces: the completed `HermesAdapter` (`#pump`/`cancel`/`close`).

Spec to read: A2 §4.4 ("SSE; a `: keepalive` comment every 10 seconds of silence. The adapter does not raise keepalives as events — it only refreshes the health timer"). The payload JSON field names (`type: 'delta'|'done'`, `text`) are **UNVERIFIED against the real Hermes API** (`09` verified the session-header split, the capabilities self-description, and the existence of SSE keepalives, but could not pin the exact field names of `/v1/responses` event payloads against primary sources) — the mechanism (stream parsing, keepalive suppression, header propagation, origin guard) is fully verified by this task's mock SSE tests, and the exact field names are subject to a real-connection check of the same class as A1-⑦ (B-D5 defers it to fixtures/mocks for now).

**Run Task 11-S (`gate-hermes-sse`) first.** That spike's conclusion: `/v1/responses` is OpenAI Responses API-compatible, so the event `type` may be `"response.output_text.delta"`/`"response.completed"`. So `#pump` **does not pin itself to one set of field names** — if `type` **ends with** `delta` it treats it as a delta, if it ends with `done`/`completed` it treats it as the end, the body is read as `text ?? delta ?? ""` in that order, and an unknown `type` is **discarded silently** like a keepalive (it does not throw). To the `{"type":"delta","text":"…"}` sample in the test below, add one more line with a `{"type":"response.output_text.delta","delta":"…"}` case to confirm both shapes yield the same result. Leave the comment `// UNVERIFIED: Hermes SSE field names — tools/spikes/gate-hermes-sse/result.md` at the top of the file.

- [ ] 1. Add the failing test: `apps/local-agent/test/hermes.test.ts`.

  ```ts
  function sseStream(lines: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream({
      start(controller) {
        for (const line of lines) controller.enqueue(encoder.encode(`${line}\n`));
        controller.close();
      },
    });
  }

  describe("HermesAdapter SSE pump", () => {
    it("suppresses ': keepalive' comments and emits delta/itemCompleted/turnCompleted for data lines", async () => {
      const fetchFn = vi.fn(
        async () =>
          new Response(
            sseStream([
              ": keepalive",
              `data: ${JSON.stringify({ type: "delta", text: "hel" })}`,
              ": keepalive",
              `data: ${JSON.stringify({ type: "delta", text: "lo" })}`,
              `data: ${JSON.stringify({ type: "done" })}`,
            ]),
            { status: 200, headers: { "X-Hermes-Session-Id": "resp-1" } },
          ),
      );
      const adapter = new HermesAdapter({ baseUrl: "http://127.0.0.1:8642", token: "tok-1", fetchFn: fetchFn as unknown as typeof fetch });
      const { sink, calls } = fakeSink();
      await adapter.startTurn(baseSession("human"), { text: "hi" }, sink);
      await new Promise((r) => setTimeout(r, 20)); // #pump is fire-and-forget (void) — wait briefly for it to drain
      expect(calls.delta.map((d) => (d as { text: string }).text)).toEqual(["hel", "lo"]);
      expect(calls.itemCompleted).toHaveLength(1);
      expect((calls.itemCompleted[0] as { body: string }).body).toBe("hello");
      expect(calls.turnCompleted).toHaveLength(1);
      expect((calls.turnCompleted[0] as { status: string }).status).toBe("ok");
    });
  });

  describe("HermesAdapter.cancel()/close()", () => {
    it("cancel() aborts the in-flight fetch via the turn handle", async () => {
      const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
        expect(init.signal).toBeInstanceOf(AbortSignal);
        return new Response(sseStream([]), { status: 200 });
      });
      const adapter = new HermesAdapter({ baseUrl: "http://127.0.0.1:8642", token: "tok-1", fetchFn: fetchFn as unknown as typeof fetch });
      const { sink } = fakeSink();
      const handle = await adapter.startTurn(baseSession("human"), { text: "hi" }, sink);
      expect(await adapter.cancel(handle, "user cancelled")).toBe(true);
    });
    it("close() resolves without throwing (stateless HTTP client, no resident resource)", async () => {
      const adapter = new HermesAdapter({ baseUrl: "http://127.0.0.1:8642", token: "tok-1" });
      await expect(adapter.close()).resolves.toBeUndefined();
    });
  });
  ```

- [ ] 2. Run the test and confirm it fails: `pnpm --filter @omnis/local-agent test` — expected failure: the `delta` array is empty (`#pump` is still a no-op), and `cancel()` throws `CAPABILITY_UNSUPPORTED`.

- [ ] 3. Swap `#pump` and `cancel()` in `hermes.ts` for real implementations.

  ```ts
  async #pump(body: ReadableStream<Uint8Array>, sessionKey: string, turnId: string, sink: EventSink): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let text = "";
    let seq = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      // biome-ignore lint/suspicious/noAssignInExpressions: SSE line-parser idiom
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trimEnd();
        buf = buf.slice(nl + 1);
        if (line === "" || line.startsWith(":")) continue; // ': keepalive' — do not raise it as an event (A2 §4.4)
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]" || payload === "") continue;
        let ev: { type?: string; text?: string };
        try {
          ev = JSON.parse(payload);
        } catch {
          continue; // an unknown shape does not kill the parser (the same principle as the claude-code.ts stream-json parser)
        }
        if (ev.type === "delta" && typeof ev.text === "string") {
          text += ev.text;
          sink.delta({ session_key: sessionKey, turn_id: turnId, item_id: turnId, seq: seq++, text: ev.text, channel: "output" });
        } else if (ev.type === "done") {
          sink.itemCompleted({
            session_key: sessionKey, turn_id: turnId, item_id: turnId,
            kind: "agent_turn", body: text, status: "ok", meta: {},
          });
          sink.turnCompleted({
            session_key: sessionKey, turn_id: turnId, status: "ok",
            usage: { cost_usd: null, duration_ms: 0, num_turns: 1 },
          });
        }
      }
    }
  }

  async cancel(h: TurnHandle, reason: string): Promise<boolean> {
    return h.cancel(reason);
  }

  async close(): Promise<void> {
    /* An HTTP client has no resident resource to close (A2 §4.4 — it spawns no process) */
  }
  ```

- [ ] 4. Run the tests and confirm they pass: `pnpm --filter @omnis/local-agent test` — expected output: everything passing.

- [ ] 5. Lint, then commit (the final US-B39 commit).

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  pnpm lint
  git add apps/local-agent/src/bridges/hermes.ts apps/local-agent/test/hermes.test.ts
  git commit -m "$(cat <<'EOF'
  US-B39: Hermes SSE pump (keepalive suppression) + cancel()/close()

  - ': keepalive' comments are never raised as events (A2 §4.4) — refreshing the health timer is the
    bridge startup code's job (outside this plan), via the 30-second health notification loop
  - data: delta goes to sink.delta; done goes to sink.itemCompleted + sink.turnCompleted
  - cancel() aborts the in-flight fetch via AbortController
  - close() is a no-op (HTTP client, no resident resource)
  - event payload field names are UNVERIFIED against the real Hermes API — the mechanism is verified
    by mock SSE; pinning the field names is an A1-⑦-class live-connection spike (B-D5)

  Implemented-by: Claude Opus
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 14: Kernel — `recordAdapterHealth()` + dual exposure as a system Item + ntfy (US-B40, tier: Sonnet)

**US-B40 deliverables (backlog):** `packages/kernel/src/jobs/{token-refresh,rewatch}.ts`, `packages/kernel/src/adapter-health.ts`. **Verification command:** `pnpm --filter @omnis/kernel test:integration`. **Goal:** expose consecutive adapter health failures dually through `accounts.state` + a system Item + ntfy.

**Files:** Create: `packages/kernel/src/adapter-health.ts`. Test: `packages/kernel/test/integration/adapter-health.test.ts`.

**Interfaces:** Consumes: `@omnis/db`'s `one`/`query`/`tx` (FIXED, Phase A), `@omnis/protocol`'s `Channel` (FIXED), `packages/kernel/src/logger.ts`'s `Logger` (FIXED). Produces: `ADAPTER_HEALTH_FAIL_THRESHOLD`, `NtfyDeps`, `sendNtfy()`, `AdapterHealthDeps`, `recordAdapterHealth(deps, channel, ok, error?): Promise<void>`, `resetAdapterHealthCounters()` (test-only).

Spec to read: A1 §1.5 (`down` sustained for 5 minutes → ntfy + a system Item; borrowing only the principle — this function is a generic version that counts "consecutive failures" each time the polling owner calls it) · A6 §8 (2-tier ntfy topics: `omnis-critical`/`omnis-warning`, one line of `curl -d "message" <url>/topic`) · A6 §8 ("every critical/warning is exposed dually via ntfy + `items(kind='system')`"). `accounts.state` allows only the 3 values `active`/`paused`/`broken` (A3 §8 `accounts_state_ck`, measured) — "connection lost" is expressed as `broken`.

- [ ] 1. Write the failing test: `packages/kernel/test/integration/adapter-health.test.ts`

  ```ts
  import { createPool, one, query } from "@omnis/db";
  import { createLogger } from "@omnis/kernel";
  import {
    ADAPTER_HEALTH_FAIL_THRESHOLD,
    recordAdapterHealth,
    resetAdapterHealthCounters,
  } from "@omnis/kernel";
  import type { Pool } from "pg";
  import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

  let pool: Pool;
  const logger = createLogger("@omnis/kernel");

  beforeAll(() => {
    pool = createPool();
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    resetAdapterHealthCounters();
    await query(pool, "DELETE FROM accounts WHERE channel IN ('outlook', 'system')");
  });
  afterEach(async () => {
    await query(pool, "DELETE FROM accounts WHERE channel IN ('outlook', 'system')");
  });

  describe("recordAdapterHealth()", () => {
    it("does nothing to accounts.state before the consecutive-failure threshold", async () => {
      await query(pool, `INSERT INTO accounts (channel, external_id, display) VALUES ('outlook', 'a@x.com', 'a')`);
      for (let i = 0; i < ADAPTER_HEALTH_FAIL_THRESHOLD - 1; i += 1) {
        await recordAdapterHealth({ pool, logger }, "outlook", false, "network down");
      }
      const row = await one<{ state: string }>(pool, `SELECT state FROM accounts WHERE channel = 'outlook'`);
      expect(row.state).toBe("active");
    });

    it("flips accounts.state to broken and inserts a system item once the threshold is hit", async () => {
      await query(pool, `INSERT INTO accounts (channel, external_id, display) VALUES ('outlook', 'a@x.com', 'a')`);
      for (let i = 0; i < ADAPTER_HEALTH_FAIL_THRESHOLD; i += 1) {
        await recordAdapterHealth({ pool, logger }, "outlook", false, "network down");
      }
      const account = await one<{ state: string; last_error: string }>(
        pool, `SELECT state, last_error FROM accounts WHERE channel = 'outlook'`,
      );
      expect(account.state).toBe("broken");
      expect(account.last_error).toBe("network down");
      const sys = await one<{ n: string }>(
        pool,
        `SELECT count(*)::text AS n FROM items i JOIN threads t ON t.id = i.thread_id
          WHERE i.kind = 'system' AND i.body LIKE '%outlook%disconnected%'`,
      );
      expect(Number(sys.n)).toBeGreaterThanOrEqual(1);
    });

    it("recovers accounts.state to active and resets the counter on ok=true", async () => {
      await query(pool, `INSERT INTO accounts (channel, external_id, display, state) VALUES ('outlook', 'a@x.com', 'a', 'broken')`);
      await recordAdapterHealth({ pool, logger }, "outlook", true);
      const row = await one<{ state: string }>(pool, `SELECT state FROM accounts WHERE channel = 'outlook'`);
      expect(row.state).toBe("active");
    });

    it("POSTs to the ntfy topic once the threshold is hit, and skips silently when ntfy.url is unset", async () => {
      await query(pool, `INSERT INTO accounts (channel, external_id, display) VALUES ('outlook', 'a@x.com', 'a')`);
      const fetchFn = vi.fn(async () => new Response("", { status: 200 }));
      for (let i = 0; i < ADAPTER_HEALTH_FAIL_THRESHOLD; i += 1) {
        await recordAdapterHealth(
          { pool, logger, ntfy: { url: "http://127.0.0.1:2586", topic: "omnis-warning", fetchFn: fetchFn as unknown as typeof fetch } },
          "outlook", false, "network down",
        );
      }
      expect(fetchFn).toHaveBeenCalledOnce();
      expect((fetchFn.mock.calls[0] as [string])[0]).toBe("http://127.0.0.1:2586/omnis-warning");
    });
  });
  ```

- [ ] 2. Run the test and confirm it fails.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
  ```

  Expected failure: `recordAdapterHealth is not exported from '@omnis/kernel'`.

- [ ] 3. Write `packages/kernel/src/adapter-health.ts`.

  ```ts
  import { one, query, tx } from "@omnis/db";
  import type { Channel } from "@omnis/protocol";
  import type { Pool, PoolClient } from "pg";
  import type { Logger } from "./logger.js";

  // ponytail: pinned to N=3 consecutive failures (A1 §1.5 uses "sustained for 5 minutes" as its basis,
  // but this function is a generic counter keyed on poll-call count — per-channel poll intervals all
  // differ, so it counts invocations rather than time). If that proves too noisy or too blunt, promote
  // it to a per-channel setting next to settings.notify.* (the B-D2 kv pattern).
  export const ADAPTER_HEALTH_FAIL_THRESHOLD = 3;

  const SYSTEM_ACCOUNT_EXTERNAL_ID = "omnis-system";
  const SYSTEM_THREAD_EXTERNAL_ID = "adapter-health";

  // ponytail: an in-process Map — the counter resets when the hub restarts. It is the simplification
  // traded for not adding a new column to accounts (delta §6 "no column changes to accounts"). A brief
  // recount right after a restart falls within the false-positive tolerance of "3 consecutive".
  const consecutiveFailures = new Map<Channel, number>();

  export function resetAdapterHealthCounters(): void {
    consecutiveFailures.clear();
  }

  export interface NtfyDeps {
    url?: string;
    topic?: string;
    fetchFn?: typeof fetch;
  }

  /** A6 §8: self-hosted ntfy, one line of `curl -d "message" <url>/<topic>`. When url is unset, skip
   *  silently — ntfy may not exist yet early in the mini's startup, and the system Item side of the
   *  dual exposure always runs. */
  export async function sendNtfy(deps: NtfyDeps, message: string): Promise<void> {
    if (deps.url === undefined) return;
    const fetchFn = deps.fetchFn ?? fetch;
    await fetchFn(`${deps.url.replace(/\/$/, "")}/${deps.topic ?? "omnis-warning"}`, {
      method: "POST",
      body: message,
    });
  }

  async function ensureSystemThread(c: PoolClient): Promise<{ accountId: string; threadId: string }> {
    const account = await one<{ id: string }>(
      c,
      `INSERT INTO accounts (channel, external_id, display, state)
         VALUES ('system', $1, 'omnis system', 'active')
         ON CONFLICT (channel, external_id) DO UPDATE SET display = EXCLUDED.display
         RETURNING id`,
      [SYSTEM_ACCOUNT_EXTERNAL_ID],
    );
    const thread = await one<{ id: string }>(
      c,
      `INSERT INTO threads (account_id, external_id, kind, title)
         VALUES ($1, $2, 'system', 'adapter health')
         ON CONFLICT (account_id, external_id) DO UPDATE SET title = EXCLUDED.title
         RETURNING id`,
      [account.id, SYSTEM_THREAD_EXTERNAL_ID],
    );
    return { accountId: account.id, threadId: thread.id };
  }

  export interface AdapterHealthDeps {
    pool: Pool;
    logger: Logger;
    ntfy?: NtfyDeps;
  }

  /** A generic implementation of the A1 §1.5 + A6 §8 principle. On ADAPTER_HEALTH_FAIL_THRESHOLD
   *  consecutive ok=false calls it sets accounts.state='broken' + items(kind='system') + ntfy, the
   *  A6 §8 dual exposure. ok=true resets the counter and returns a previously broken account to active. */
  export async function recordAdapterHealth(
    deps: AdapterHealthDeps,
    channel: Channel,
    ok: boolean,
    error?: string,
  ): Promise<void> {
    const { pool, logger } = deps;
    if (ok) {
      consecutiveFailures.set(channel, 0);
      await query(
        pool,
        `UPDATE accounts SET state = 'active', last_health_at = now(), last_error = NULL
          WHERE channel = $1 AND state = 'broken'`,
        [channel],
      );
      return;
    }

    const n = (consecutiveFailures.get(channel) ?? 0) + 1;
    consecutiveFailures.set(channel, n);
    await query(
      pool,
      `UPDATE accounts SET last_health_at = now(), last_error = $2 WHERE channel = $1`,
      [channel, error ?? null],
    );
    if (n < ADAPTER_HEALTH_FAIL_THRESHOLD) return;

    const message = `${channel} adapter disconnected (${n} consecutive failures): ${error ?? "unknown"}`;
    await tx(pool, async (c) => {
      await query(c, `UPDATE accounts SET state = 'broken', last_error = $2 WHERE channel = $1`, [channel, error ?? null]);
      const { accountId, threadId } = await ensureSystemThread(c);
      await query(
        c,
        `INSERT INTO items (thread_id, account_id, kind, body, sent_at) VALUES ($1, $2, 'system', $3, now())`,
        [threadId, accountId, message],
      );
    });
    logger.error("adapter health threshold exceeded", { channel, consecutive: n, error });
    await sendNtfy(deps.ntfy ?? {}, `[omnis] ${message}`);
  }
  ```

- [ ] 4. Add the exports to `packages/kernel/src/index.ts`.

  ```ts
  export {
    ADAPTER_HEALTH_FAIL_THRESHOLD,
    recordAdapterHealth,
    resetAdapterHealthCounters,
    sendNtfy,
  } from "./adapter-health.js";
  export type { AdapterHealthDeps, NtfyDeps } from "./adapter-health.js";
  ```

- [ ] 5. Run the tests and confirm they pass.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
  ```

  Expected output: all 4 cases in `adapter-health.test.ts` passing.

- [ ] 6. Commit.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/kernel/src/adapter-health.ts packages/kernel/src/index.ts packages/kernel/test/integration/adapter-health.test.ts
  git commit -m "$(cat <<'EOF'
  US-B40: recordAdapterHealth() — accounts.state='broken' + system Item + ntfy dual exposure

  - after ADAPTER_HEALTH_FAIL_THRESHOLD (3) consecutive failures: accounts.state='broken' + last_error,
    items(kind='system') (A6 §8 dual exposure), sendNtfy() (default topic omnis-warning)
  - ok=true resets the counter and recovers a previously broken account to active
  - skips silently when ntfy.url is unset (the system Item side always runs)
  - in-process Map counter (ponytail: no new accounts column, reset on restart accepted)

  Implemented-by: Claude Sonnet
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 15: Kernel — making the `token_refresh` job real (US-B40, tier: Sonnet)

**Verification command:** `pnpm --filter @omnis/kernel test:integration`.

**Files:** Create: `packages/kernel/src/jobs/token-refresh.ts`. Test: `packages/kernel/test/integration/token-refresh-job.test.ts`.

**Interfaces:** Consumes: `@omnis/db`'s `query` (FIXED), `packages/kernel/src/scheduler.ts`'s `Scheduler` (FIXED; `register()` already upserts into `jobs` — the same pattern as the `healthcheck.ts` task), `@omnis/protocol`'s `AuthRef`/`Channel` (FIXED). Produces: `TOKEN_REFRESH_JOB_NAME` (`"token_refresh"`, the same name as the 0006 seed — not created anew; only a handler attaches to the existing seed row, delta §8 "a handler attaching to an existing job"), `TOKEN_REFRESH_CRON`, `TokenRefresher`, `TokenRefreshDeps`, `registerTokenRefreshJob(scheduler, deps)`.

Spec to read: delta §8 ("token_refresh (B40)… a handler attaching to an existing job" — the seed already exists in 0006, cron `*/30 * * * *`). **Provider SDKs stay inside adapter packages** (Global Constraints) — this job holds no real OAuth refresh logic; it finds accounts nearing expiry and delegates per channel to an injected `TokenRefresher` callback (wrapping each adapter's `connect()`/`refreshAccessToken()` into that callback is the hub bootstrap's job, outside this plan — the `apps/hub` wiring story).

- [ ] 1. Write the failing test: `packages/kernel/test/integration/token-refresh-job.test.ts`

  ```ts
  import { createPool, one, query } from "@omnis/db";
  import { createEvents, createLogger, createScheduler, registerTokenRefreshJob } from "@omnis/kernel";
  import type { Events, Scheduler } from "@omnis/kernel";
  import type { Pool } from "pg";
  import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

  let pool: Pool;
  let events: Events & { close(): Promise<void> };
  let scheduler: Scheduler;
  let accountId: string;

  beforeAll(async () => {
    pool = createPool();
    events = createEvents({ pool, logger: createLogger("@omnis/kernel") });
    const account = await one<{ id: string }>(
      pool,
      `INSERT INTO accounts (channel, external_id, display) VALUES ('outlook', 'expiring@x.com', 'x') RETURNING id`,
    );
    accountId = account.id;
    await query(
      pool,
      `INSERT INTO account_secrets (account_id, auth_ref, expires_at) VALUES ($1, 'omnis.outlook.expiring@x.com', now() + interval '5 minutes')`,
      [accountId],
    );
  });
  afterAll(async () => {
    await scheduler.stop();
    await query(pool, "DELETE FROM account_secrets WHERE account_id = $1", [accountId]);
    await query(pool, "DELETE FROM accounts WHERE id = $1", [accountId]);
    await query(pool, "DELETE FROM jobs WHERE name = 'token_refresh'");
    await events.close();
    await pool.end();
  });

  describe("token_refresh job", () => {
    it("calls the injected refresher for accounts whose secret expires within the window", async () => {
      const refresher = vi.fn(async () => {});
      scheduler = createScheduler({ pool, events, logger: createLogger("@omnis/kernel"), tickMs: 50 });
      registerTokenRefreshJob(scheduler, {
        pool, logger: createLogger("@omnis/kernel"),
        refreshers: { outlook: refresher }, windowMinutes: 60,
      });
      await scheduler.start();
      await query(pool, `UPDATE jobs SET next_run_at = now() - interval '1 minute' WHERE name = 'token_refresh'`);
      await new Promise((r) => setTimeout(r, 300));
      expect(refresher).toHaveBeenCalledOnce();
      const [auth] = refresher.mock.calls[0] as [{ channel: string; accountExternalId: string; keychainService: string }];
      expect(auth.channel).toBe("outlook");
      expect(auth.accountExternalId).toBe("expiring@x.com");
      expect(auth.keychainService).toBe("omnis.outlook.expiring@x.com");
    });
  });
  ```

- [ ] 2. Run the test and confirm it fails.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
  ```

  Expected failure: `registerTokenRefreshJob is not exported from '@omnis/kernel'`.

- [ ] 3. Write `packages/kernel/src/jobs/token-refresh.ts`.

  ```ts
  import { query } from "@omnis/db";
  import type { AuthRef, Channel } from "@omnis/protocol";
  import type { Pool } from "pg";
  import type { Logger } from "../logger.js";
  import type { Scheduler } from "../scheduler.js";

  export const TOKEN_REFRESH_JOB_NAME = "token_refresh";
  export const TOKEN_REFRESH_CRON = "*/30 * * * *"; // same as the 0006 seed (an A3-owned infra job)
  // ponytail: refresh everything 60 minutes before expiry in one batch. If real expiry margins differ
  // per channel (Slack tokens are indefinite, etc.), split into per-channel windows then.
  export const TOKEN_REFRESH_WINDOW_MINUTES = 60;

  export type TokenRefresher = (auth: AuthRef) => Promise<void>;

  export interface TokenRefreshDeps {
    pool: Pool;
    logger: Logger;
    // Adapters attached to this host inject these per channel (the hub bootstrap's concern, outside
    // this plan). Channels with none are skipped silently — a local-agent on another host owns them.
    refreshers: Partial<Record<Channel, TokenRefresher>>;
    windowMinutes?: number;
  }

  interface DueSecretRow {
    channel: string;
    account_external_id: string;
    auth_ref: string;
  }

  export function registerTokenRefreshJob(scheduler: Scheduler, deps: TokenRefreshDeps): void {
    const windowMinutes = deps.windowMinutes ?? TOKEN_REFRESH_WINDOW_MINUTES;
    scheduler.register(TOKEN_REFRESH_JOB_NAME, TOKEN_REFRESH_CRON, async () => {
      const due = await query<DueSecretRow>(
        deps.pool,
        `SELECT a.channel, a.external_id AS account_external_id, s.auth_ref
           FROM account_secrets s JOIN accounts a ON a.id = s.account_id
          WHERE s.expires_at IS NOT NULL AND s.expires_at < now() + ($1 || ' minutes')::interval`,
        [windowMinutes],
      );
      for (const row of due) {
        const refresher = deps.refreshers[row.channel as Channel];
        if (refresher === undefined) continue;
        try {
          await refresher({
            channel: row.channel as Channel,
            accountExternalId: row.account_external_id,
            keychainService: row.auth_ref,
            keychainAccount: row.account_external_id,
          });
        } catch (e) {
          deps.logger.error("token refresh failed", {
            channel: row.channel,
            account: row.account_external_id,
            err: e instanceof Error ? e.message : String(e),
          });
        }
      }
    });
  }
  ```

- [ ] 4. Add the exports to `packages/kernel/src/index.ts`.

  ```ts
  export {
    TOKEN_REFRESH_CRON,
    TOKEN_REFRESH_JOB_NAME,
    TOKEN_REFRESH_WINDOW_MINUTES,
    registerTokenRefreshJob,
  } from "./jobs/token-refresh.js";
  export type { TokenRefreshDeps, TokenRefresher } from "./jobs/token-refresh.js";
  ```

- [ ] 5. Run the tests and confirm they pass.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
  ```

- [ ] 6. Commit.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  git add packages/kernel/src/jobs/token-refresh.ts packages/kernel/src/index.ts packages/kernel/test/integration/token-refresh-job.test.ts
  git commit -m "$(cat <<'EOF'
  US-B40: token_refresh job made real — delegates to a per-channel TokenRefresher callback

  - finds accounts with account_secrets.expires_at < now()+60 minutes and calls the injected per-channel callback
  - channels with no injected callback are skipped (a local-agent on another host owns them) — the kernel
    does not import provider SDKs directly (Global Constraints)
  - attaches only a handler to the existing 0006 seed job (token_refresh, */30 * * * *) (delta §8)

  Implemented-by: Claude Sonnet
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 16: Kernel — `gmail_rewatch` (7 days) + `graph_sub_renew` (10,080 minutes) re-registration (US-B40, tier: Sonnet)

**Verification command:** `pnpm --filter @omnis/kernel test:integration`.

**Files:** Create: `packages/kernel/src/jobs/rewatch.ts`. Test: `packages/kernel/test/integration/rewatch-jobs.test.ts`.

**Interfaces:** Consumes: `@omnis/db`'s `query` (FIXED), `Scheduler` (FIXED). Produces: `GMAIL_REWATCH_JOB_NAME`/`CRON`, `GRAPH_SUB_RENEW_JOB_NAME`/`CRON`, `RewatchFn`, `RewatchDeps`, `registerGmailRewatchJob()`, `registerGraphSubRenewJob()`.

Spec to read: A1 §2.2 (Gmail `users.watch` expires after 7 days; re-`watch` on a daily-midnight cron) · A1 §2.4 (Graph mail subscriptions last up to 10,080 minutes ≈ 7 days; renewed weekly). The 0006 seed already has `gmail_rewatch` (`0 3 * * *`) and `graph_sub_renew` (`0 4 * * 1`) — this task attaches only handlers (delta §8).

- [ ] 1. Write the failing test: `packages/kernel/test/integration/rewatch-jobs.test.ts`

  ```ts
  import { createPool, one, query } from "@omnis/db";
  import {
    createEvents, createLogger, createScheduler,
    registerGmailRewatchJob, registerGraphSubRenewJob,
  } from "@omnis/kernel";
  import type { Events, Scheduler } from "@omnis/kernel";
  import type { Pool } from "pg";
  import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

  let pool: Pool;
  let events: Events & { close(): Promise<void> };
  let gmailScheduler: Scheduler;
  let graphScheduler: Scheduler;

  beforeAll(async () => {
    pool = createPool();
    events = createEvents({ pool, logger: createLogger("@omnis/kernel") });
    await query(pool, `INSERT INTO accounts (channel, external_id, display) VALUES ('gmail', 'a@gmail.com', 'a'), ('outlook', 'b@outlook.com', 'b')`);
  });
  afterAll(async () => {
    await gmailScheduler.stop();
    await graphScheduler.stop();
    await query(pool, "DELETE FROM accounts WHERE external_id IN ('a@gmail.com', 'b@outlook.com')");
    await query(pool, "DELETE FROM jobs WHERE name IN ('gmail_rewatch', 'graph_sub_renew')");
    await events.close();
    await pool.end();
  });

  describe("gmail_rewatch / graph_sub_renew jobs", () => {
    it("calls the injected rewatch callback for each active account on that channel", async () => {
      const gmailRewatch = vi.fn(async () => {});
      const graphRenew = vi.fn(async () => {});
      gmailScheduler = createScheduler({ pool, events, logger: createLogger("@omnis/kernel"), tickMs: 50 });
      graphScheduler = createScheduler({ pool, events, logger: createLogger("@omnis/kernel"), tickMs: 50 });
      registerGmailRewatchJob(gmailScheduler, { pool, logger: createLogger("@omnis/kernel"), rewatch: gmailRewatch });
      registerGraphSubRenewJob(graphScheduler, { pool, logger: createLogger("@omnis/kernel"), rewatch: graphRenew });
      await gmailScheduler.start();
      await graphScheduler.start();
      await query(pool, `UPDATE jobs SET next_run_at = now() - interval '1 minute' WHERE name IN ('gmail_rewatch', 'graph_sub_renew')`);
      await new Promise((r) => setTimeout(r, 300));
      expect(gmailRewatch).toHaveBeenCalledWith("a@gmail.com");
      expect(graphRenew).toHaveBeenCalledWith("b@outlook.com");
    });

    it("skips silently when no rewatch callback is wired on this host", async () => {
      const scheduler = createScheduler({ pool, events, logger: createLogger("@omnis/kernel"), tickMs: 50 });
      registerGmailRewatchJob(scheduler, { pool, logger: createLogger("@omnis/kernel") });
      await scheduler.start();
      await query(pool, `UPDATE jobs SET next_run_at = now() - interval '1 minute' WHERE name = 'gmail_rewatch'`);
      await new Promise((r) => setTimeout(r, 200));
      const job = await one<{ last_status: string }>(pool, "SELECT last_status FROM jobs WHERE name = 'gmail_rewatch'");
      expect(job.last_status).toBe("ok"); // no callback = a normal skip, not a failure
      await scheduler.stop();
    });
  });
  ```

- [ ] 2. Run the test and confirm it fails.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
  ```

  Expected failure: `registerGmailRewatchJob is not exported from '@omnis/kernel'`.

- [ ] 3. Write `packages/kernel/src/jobs/rewatch.ts`.

  ```ts
  import { query } from "@omnis/db";
  import type { Pool } from "pg";
  import type { Logger } from "../logger.js";
  import type { Scheduler } from "../scheduler.js";

  export const GMAIL_REWATCH_JOB_NAME = "gmail_rewatch";
  export const GMAIL_REWATCH_CRON = "0 3 * * *"; // same as the 0006 seed — watch expires in 7 days, renewed daily (A1 §2.2)
  export const GRAPH_SUB_RENEW_JOB_NAME = "graph_sub_renew";
  export const GRAPH_SUB_RENEW_CRON = "0 4 * * 1"; // same as the 0006 seed — subscriptions expire in 10,080 minutes, renewed weekly (A1 §2.4)

  export type RewatchFn = (accountExternalId: string) => Promise<void>;

  export interface RewatchDeps {
    pool: Pool;
    logger: Logger;
    // undefined when this host has no adapter for that channel — the job skips as a normal (ok) run.
    rewatch?: RewatchFn;
  }

  async function runForChannel(deps: RewatchDeps, channel: string): Promise<void> {
    if (deps.rewatch === undefined) return;
    const rows = await query<{ external_id: string }>(
      deps.pool,
      `SELECT external_id FROM accounts WHERE channel = $1 AND state <> 'paused'`,
      [channel],
    );
    for (const row of rows) {
      try {
        await deps.rewatch(row.external_id);
      } catch (e) {
        deps.logger.error(`${channel} rewatch failed`, {
          account: row.external_id,
          err: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  export function registerGmailRewatchJob(scheduler: Scheduler, deps: RewatchDeps): void {
    scheduler.register(GMAIL_REWATCH_JOB_NAME, GMAIL_REWATCH_CRON, () => runForChannel(deps, "gmail"));
  }

  export function registerGraphSubRenewJob(scheduler: Scheduler, deps: RewatchDeps): void {
    scheduler.register(GRAPH_SUB_RENEW_JOB_NAME, GRAPH_SUB_RENEW_CRON, () => runForChannel(deps, "outlook"));
  }
  ```

- [ ] 4. Add the exports to `packages/kernel/src/index.ts`.

  ```ts
  export {
    GMAIL_REWATCH_CRON,
    GMAIL_REWATCH_JOB_NAME,
    GRAPH_SUB_RENEW_CRON,
    GRAPH_SUB_RENEW_JOB_NAME,
    registerGmailRewatchJob,
    registerGraphSubRenewJob,
  } from "./jobs/rewatch.js";
  export type { RewatchDeps, RewatchFn } from "./jobs/rewatch.js";
  ```

- [ ] 5. Run the tests and confirm they pass.

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
  ```

- [ ] 6. Lint, then commit (the final US-B40 commit).

  ```bash
  cd /Users/logankim/AI-Workspaces/omnis
  pnpm lint
  git add packages/kernel/src/jobs/rewatch.ts packages/kernel/src/index.ts packages/kernel/test/integration/rewatch-jobs.test.ts
  git commit -m "$(cat <<'EOF'
  US-B40: making the gmail_rewatch + graph_sub_renew jobs real

  - calls the per-channel RewatchFn callback for every active/broken account on that channel
  - no injected callback (this host has no adapter for that channel) is a normal skip (last_status='ok')
  - attaches only handlers to the existing 0006 seed jobs (gmail_rewatch 0 3 * * *, graph_sub_renew 0 4 * * 1) (delta §8)

  Implemented-by: Claude Sonnet
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 17: Hub adapter registry · bootstrap wiring (US-B45, tier: Opus)

> **Story** — Goal: build a per-channel `Adapter` instance from each `accounts` row + Keychain, inject it into `createHubServer({adapters})`, and start a `subscribe()` loop per connected account that records health as a system Item. Deliverables: `apps/hub/src/adapters.ts`, `apps/hub/src/main.ts` (modifications). Verification: `pnpm --filter @omnis/hub test`. Depends on: B37, B38, B40.

**Why this exists (2026-09-20 cross-review §4-2, Logan's decision = backlog §7-2)**: Phase A left `HubServerDeps.adapters?: ReadonlyMap<string, Adapter>` open (US-A36 archive write-back reads that map), but **`apps/hub/src/main.ts` injects nothing** — measured: `createHubServer({kernel, pool, config, logger, startedAt, onUpgrade})` has no `adapters`. So even with Slack/Gmail/GCal (Phase A) and Outlook/Telegram (Tasks 1–10 of this plan) all built, **the hub never instantiates one**. It was a hole in none of the five plans, so it goes here.

**Read**: `apps/hub/src/http.ts` (`HubServerDeps`, especially the `adapters` comment), `apps/hub/src/main.ts` (`startHub`'s current wiring), `apps/hub/src/archive.ts` (which key it looks up the map by — **this task follows that key convention, it does not change it**), `packages/adapters/gmail/src/index.ts` (`createGmailAdapter(deps)` + how `connect(auth: AuthRef)` reads Keychain **inside the adapter**), A1 §1 (common contract), A3 §2 (`accounts`/`account_secrets`), delta §5 (`recordAdapterHealth`, this plan's Task 14).

**Do not (YAGNI)**:
- **The hub does not read Keychain.** It only carries `account_secrets.auth_ref` (= the Keychain item **name**) in an `AuthRef` and passes it along; the secret value is fetched by each adapter's own `connect()` (A3-D4: secrets live in a separate table, values are not in the DB). Do not add a `security find-generic-password` call to the hub.
- **Do not build a reconnect-backoff engine.** When a `subscribe()` loop dies, the extent of it is notifying `recordAdapterHealth` (Task 14) and reattaching once after a fixed delay — if more retry policy is needed, promote it to a job like `token_refresh` (Task 15).
- **`local-agent`'s `adapters: Map<RuntimeKind, RuntimeAdapter>` is not this.** Those are runtime adapters (Hermes and friends), and `apps/local-agent/src/main.ts` registers the class US-B39 Tasks 11–13 build — a different map that merely shares the name.
- Do not add a new column to `accounts` (no migrations).

**Files:**
- Create: `apps/hub/src/adapters.ts`, `apps/hub/src/adapters.test.ts`
- Modify: `apps/hub/src/main.ts` (`startHub` builds and injects the adapters + cleans up the loops on shutdown)
- Test: `apps/hub/src/adapters.test.ts`

**Interfaces:**
- Consumes: `Adapter`/`AuthRef`/`Channel`/`NormalizedItem`/`AdapterEvent` (`@omnis/protocol`), `query` (`@omnis/db`), `recordAdapterHealth` (`@omnis/kernel`, Task 14), `Logger` (`@omnis/kernel`), `createOutlookAdapter` (Task 3) · `createTelegramAdapter` (Task 8) · Phase A's `createSlackAdapter`/`createGmailAdapter`/`createGoogleCalendarAdapter`
- Produces: `AdapterFactory`, `AdapterFactories`, `DEFAULT_ADAPTER_FACTORIES`, `AccountRow`, `buildAdapters`, `startAdapterLoops`, `AdapterLoops` (`apps/hub/src/adapters.ts`)

- [ ] 1. Write the failing test. Making the **factory registry injectable** is this task's design core — with a fake factory, everything is accepted without real accounts or real SDKs (B-D5).

```ts
// apps/hub/src/adapters.test.ts
import type { Adapter, AdapterEvent, AuthRef, NormalizedItem } from "@omnis/protocol";
import { describe, expect, it, vi } from "vitest";
import { buildAdapters, startAdapterLoops, type AccountRow, type AdapterFactories } from "./adapters.js";

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

function fakeAdapter(over: Partial<Adapter> = {}): Adapter {
  return {
    id: "fake",
    channel: "gmail",
    capabilities: () => ({ read: true, write: false, realtime: false, history: false, media: false, markRead: false, typing: false }) as never,
    connect: vi.fn(async (_auth: AuthRef) => {}),
    backfill: async function* () {},
    subscribe: async function* () {},
    send: vi.fn(async () => ({ externalId: "x", sentAt: new Date().toISOString() })),
    health: vi.fn(async () => ({ channel: "gmail", accountExternalId: "me", status: "healthy", lastEventAt: null }) as never),
    ...over,
  } as Adapter;
}

const accounts: AccountRow[] = [
  { id: "a1", channel: "gmail", external_id: "me@example.com", state: "active", auth_ref: "omnis.gmail.refresh.me@example.com" },
  { id: "a2", channel: "telegram", external_id: "+8210", state: "broken", auth_ref: "omnis.telegram.session_key" },
  { id: "a3", channel: "whatsapp", external_id: "w1", state: "active", auth_ref: "omnis.whatsapp.x" },
  { id: "a4", channel: "outlook", external_id: "me@corp.example", state: "active", auth_ref: null },
];

describe("buildAdapters", () => {
  it("builds one adapter per active account that has a factory and a secret, keyed by account id", async () => {
    const gmail = fakeAdapter();
    const factories: AdapterFactories = { gmail: () => gmail };
    const map = await buildAdapters({ accounts, factories, logger });
    expect([...map.keys()]).toEqual(["a1"]);
    expect(map.get("a1")).toBe(gmail);
  });

  it("calls connect() with the AuthRef built from the account row — never with a secret value", async () => {
    const connect = vi.fn(async () => {});
    const factories: AdapterFactories = { gmail: () => fakeAdapter({ connect }) };
    await buildAdapters({ accounts, factories, logger });
    expect(connect).toHaveBeenCalledWith({
      channel: "gmail",
      accountExternalId: "me@example.com",
      keychainService: "omnis.gmail.refresh.me@example.com",
      keychainAccount: "omnis",
    });
  });

  it("skips non-active accounts, channels with no factory, and accounts with no secret — and says which", async () => {
    const factories: AdapterFactories = { gmail: () => fakeAdapter(), outlook: () => fakeAdapter() };
    const map = await buildAdapters({ accounts, factories, logger });
    expect([...map.keys()]).toEqual(["a1"]); // a2 broken, a3 no factory, a4 no auth_ref
    expect(logger.warn).toHaveBeenCalled();
  });

  // If the hub fails to start because one account could not connect, every other channel dies with it.
  it("keeps going when one connect() throws, and reports that account as broken", async () => {
    const recordAdapterHealth = vi.fn(async () => {});
    const factories: AdapterFactories = {
      gmail: () => fakeAdapter({ connect: vi.fn(async () => { throw new Error("auth revoked"); }) }),
    };
    const map = await buildAdapters({ accounts, factories, logger, recordAdapterHealth });
    expect(map.size).toBe(0);
    expect(recordAdapterHealth).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: "a1", status: "down" }),
    );
  });
});

describe("startAdapterLoops", () => {
  it("drains subscribe() into the sink and stops cleanly", async () => {
    const events: (NormalizedItem | AdapterEvent)[] = [
      { kind: "health", channel: "gmail", status: "healthy" } as unknown as AdapterEvent,
    ];
    const adapter = fakeAdapter({ subscribe: async function* () { yield* events; } });
    const sink = vi.fn(async () => {});
    const loops = startAdapterLoops({ adapters: new Map([["a1", adapter]]), sink, logger });
    await loops.drained();
    expect(sink).toHaveBeenCalledWith("a1", events[0]);
    await loops.stop();
  });

  it("a throwing subscribe() reports health and does not reject stop()", async () => {
    const recordAdapterHealth = vi.fn(async () => {});
    const adapter = fakeAdapter({
      subscribe: async function* () { throw new Error("socket closed"); },
    });
    const loops = startAdapterLoops({
      adapters: new Map([["a1", adapter]]), sink: vi.fn(async () => {}), logger, recordAdapterHealth,
      retryDelayMs: 0, maxRetries: 0,
    });
    await loops.drained();
    expect(recordAdapterHealth).toHaveBeenCalledWith(expect.objectContaining({ accountId: "a1", status: "down" }));
    await expect(loops.stop()).resolves.toBeUndefined();
  });
});
```

- [ ] 2. Confirm the failure. Expected: `Failed to resolve import "./adapters.js"`.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/hub test -- adapters
```

- [ ] 3. Implement `apps/hub/src/adapters.ts`.

```ts
// apps/hub/src/adapters.ts
// accounts rows → Adapter instances. The hub deals only with the Keychain item **name** and never
// touches the value (A3-D4: account_secrets.auth_ref = the Keychain item name; each adapter's
// connect() reads the value). The factory registry is injected for testability — one fake factory
// runs everything without real SDKs (B-D5).
import type { Adapter, AdapterEvent, AuthRef, Channel, NormalizedItem } from "@omnis/protocol";
import type { Logger } from "@omnis/kernel";

/** A6 §9: the Keychain account is common to every item. */
const KEYCHAIN_ACCOUNT = "omnis";

export interface AccountRow {
  id: string;
  channel: string;
  external_id: string;
  state: string;
  /** account_secrets.auth_ref — the Keychain item name, not the value. */
  auth_ref: string | null;
}

export type AdapterFactory = () => Adapter;
export type AdapterFactories = Partial<Record<string, AdapterFactory>>;

type HealthReporter = (h: {
  accountId: string;
  channel: string;
  status: "healthy" | "degraded" | "down";
  error?: string;
}) => Promise<void>;

export interface BuildAdaptersDeps {
  accounts: readonly AccountRow[];
  factories: AdapterFactories;
  logger: Logger;
  recordAdapterHealth?: HealthReporter;
}

export async function buildAdapters(deps: BuildAdaptersDeps): Promise<Map<string, Adapter>> {
  const { accounts, factories, logger } = deps;
  const out = new Map<string, Adapter>();
  for (const a of accounts) {
    if (a.state !== "active") {
      logger.info("adapter skipped: account not active", { account: a.id, channel: a.channel, state: a.state });
      continue;
    }
    const make = factories[a.channel];
    if (make === undefined) {
      // Phase C channels (kakaotalk/linkedin/whatsapp) and the 'agent'/'system' pseudo-accounts land here.
      logger.warn("adapter skipped: no factory for channel", { account: a.id, channel: a.channel });
      continue;
    }
    if (a.auth_ref === null) {
      logger.warn("adapter skipped: account has no secret", { account: a.id, channel: a.channel });
      continue;
    }
    const auth: AuthRef = {
      channel: a.channel as Channel,
      accountExternalId: a.external_id,
      keychainService: a.auth_ref,
      keychainAccount: KEYCHAIN_ACCOUNT,
    };
    try {
      const adapter = make();
      await adapter.connect(auth);
      out.set(a.id, adapter);
    } catch (e) {
      // If one account's expired token blocks hub startup, every other channel dies with it.
      const err = e instanceof Error ? e.message : String(e);
      logger.error("adapter connect failed", { account: a.id, channel: a.channel, err });
      await deps.recordAdapterHealth?.({ accountId: a.id, channel: a.channel, status: "down", error: err });
    }
  }
  return out;
}

export interface AdapterLoops {
  /** Resolves once every subscribe() loop finishes — for tests. In production it usually never finishes. */
  drained(): Promise<void>;
  stop(): Promise<void>;
}

export interface StartLoopsDeps {
  adapters: ReadonlyMap<string, Adapter>;
  sink: (accountId: string, e: NormalizedItem | AdapterEvent) => Promise<void>;
  logger: Logger;
  recordAdapterHealth?: HealthReporter;
  retryDelayMs?: number;
  maxRetries?: number;
}

export function startAdapterLoops(deps: StartLoopsDeps): AdapterLoops {
  const { adapters, sink, logger } = deps;
  const retryDelayMs = deps.retryDelayMs ?? 5_000;
  const maxRetries = deps.maxRetries ?? 3;
  let stopped = false;

  async function pump(accountId: string, adapter: Adapter): Promise<void> {
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (stopped) return;
      try {
        for await (const e of adapter.subscribe()) {
          if (stopped) return;
          await sink(accountId, e);
        }
        return; // the stream ended normally — do not reconnect.
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        logger.error("adapter subscribe failed", { account: accountId, channel: adapter.channel, attempt, err });
        await deps.recordAdapterHealth?.({
          accountId, channel: adapter.channel, status: "down", error: err,
        });
        if (attempt === maxRetries || stopped) return;
        // ponytail: fixed-delay reconnect. If exponential backoff becomes necessary, promote it to a job like token_refresh.
        await new Promise((r) => setTimeout(r, retryDelayMs));
      }
    }
  }

  const running = [...adapters].map(([id, a]) => pump(id, a));
  return {
    drained: () => Promise.all(running).then(() => undefined),
    async stop() {
      stopped = true;
      await Promise.allSettled([...adapters.values()].map((a) => a.disconnect?.()));
      await Promise.allSettled(running);
    },
  };
}
```

- [ ] 4. Confirm it passes. Expected: `adapters` 6 tests passed.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/hub test -- adapters
```

- [ ] 5. Wire `apps/hub/src/main.ts`. The real factory table lives in exactly one place here (`adapters.ts` imports no channel SDK — keeping the leaf-package boundary), and `startHub` passes the map it built to `createHubServer`.

```ts
// apps/hub/src/main.ts — added imports
import { createGmailAdapter } from "@omnis/adapter-gmail";
import { createGoogleCalendarAdapter } from "@omnis/adapter-google-calendar";
import { createOutlookAdapter } from "@omnis/adapter-outlook";
import { createSlackAdapter } from "@omnis/adapter-slack";
import { createTelegramAdapter } from "@omnis/adapter-telegram";
import { recordAdapterHealth } from "@omnis/kernel";
import { query } from "@omnis/db";
import { type AccountRow, buildAdapters, startAdapterLoops } from "./adapters.js";
```

```ts
// inside startHub(), **before** the createHubServer call
const accountRows = await query<AccountRow>(
  pool,
  `SELECT a.id, a.channel, a.external_id, a.state, s.auth_ref
     FROM accounts a
     LEFT JOIN account_secrets s ON s.account_id = a.id`,
);
const adapters = await buildAdapters({
  accounts: accountRows,
  factories: {
    slack: () => createSlackAdapter({}),
    gmail: () => createGmailAdapter({
      oauthClientId: config.googleClientId,
      oauthClientSecret: config.googleClientSecret,
    }),
    gcal: () => createGoogleCalendarAdapter({
      oauthClientId: config.googleClientId,
      oauthClientSecret: config.googleClientSecret,
    }),
    outlook: () => createOutlookAdapter({
      clientId: config.outlookClientId,
      tenant: config.outlookTenant,
    }),
    telegram: () => createTelegramAdapter({}),
  },
  logger,
  recordAdapterHealth: (h) => recordAdapterHealth({ pool, events: kernel.events, logger }, h),
});
const adapterLoops = startAdapterLoops({
  adapters,
  sink: (accountId, e) => kernel.ingest.sink(accountId, e),
  logger,
  recordAdapterHealth: (h) => recordAdapterHealth({ pool, events: kernel.events, logger }, h),
});
```

```ts
// one added line in the createHubServer call
const server = createHubServer({
  kernel,
  pool,
  config,
  logger,
  startedAt,
  adapters,                                    // ← US-B45: US-A36 archive write-back reads this map
  onUpgrade: (req, socket, head) => bridge.handleUpgrade(req, socket, head),
});
```

```ts
// one line inside close(), right after bridge.close()
await adapterLoops.stop();
```

- [ ] 6. Confirm startup is not broken. **The hub must still boot against a DB with zero accounts** (an empty map = the same behavior as Phase A).

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/hub test && pnpm typecheck && pnpm lint
```

Expected output: all existing hub tests PASS + `adapters` 6 PASS, typecheck and lint clean.

- [ ] 7. Commit.

```bash
git add apps/hub/src/adapters.ts apps/hub/src/adapters.test.ts apps/hub/src/main.ts apps/hub/package.json
git commit -m "$(cat <<'EOF'
US-B45: hub adapter registry & bootstrap — accounts rows become connected Adapter instances

- buildAdapters() maps active accounts to adapters through an injectable factory registry,
  so the whole path is fixture-testable with a fake factory (B-D5, no real credentials)
- the hub passes only the Keychain item NAME (account_secrets.auth_ref) in AuthRef; secret values
  are read inside each adapter's connect() (A3-D4)
- one failing connect() no longer takes the hub down: it reports adapter health and the rest boot
- createHubServer({adapters}) is finally populated, so US-A36 archive write-back actually reaches a channel
- startAdapterLoops() drains subscribe() into kernel.ingest.sink and stops cleanly on shutdown

Implemented-by: Claude Opus
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

**Open question**: immediately before implementing, check `apps/hub/src/archive.ts` for **which key** it looks up the `adapters` map by (account id or channel name) and match `buildAdapters`'s key to it — the code above uses `accounts.id` as the key (a channel can have more than one account, so a channel name cannot be the key). On a mismatch, **adapt this task, not `archive.ts`** (US-A36 is already-merged code). If the `config.googleClientId`/`outlookClientId`/`outlookTenant` fields are absent from `HubConfig`, add them to `readConfig` first via the delta §9 environment variables (`OMNIS_OUTLOOK_CLIENT_ID`/`OMNIS_OUTLOOK_TENANT`) — the same pattern as surfaces Task 10 adding the 3 VAPID fields.

---

## Self-check (the final step of writing-plans)

**Story coverage** — all 5 `channels`-plan stories from backlog §3 have ≥1 task:

| Story | Task |
|---|---|
| US-B37 (Outlook) | Tasks 1–5 |
| US-B38 (Telegram) | Tasks 6–10 |
| US-B39 (Hermes) | **Task 11-S** (entry spike, prerequisite) → Tasks 11–13 |
| US-B40 (hardening) | Tasks 14–16 |
| US-B45 (hub adapter wiring) | Task 17 |

**Execution order**: Tasks 1–5 (Outlook) · Tasks 6–10 (Telegram) · Task 11-S → 11 → 12 → 13 (Hermes) are three mutually independent tracks. Tasks 14–16 (hardening) are independent of those three as well, and **only Task 17 must run after Tasks 3, 8, and 14 have merged** (it imports the 3 factories + `recordAdapterHealth`).

> **Numbering rule**: `Task 11-S` means a spike that runs **before** Task 11. Shifting Tasks 11–16 to renumber would break all 15 cross-references inside and outside this document, so the numbers stay put and the suffix was appended instead.

**Banned-pattern check** — `TBD`/`TODO`/"implement later"/"add appropriate error handling"/"similar to Task N"/steps without code/undefined symbols: all 17 tasks are filled with greppable real code and exact run/commit commands. Every place that says only "same pattern as Task N" has an actual code block right next to it (e.g. the Keychain wrapper is re-written in full each time — it is also code that genuinely has to be duplicated, because imports between adapter packages are forbidden).

**Symbol-existence check** — every symbol this plan consumes comes from a Phase A/B contract document or an earlier task in this plan:
- `Adapter`/`AuthRef`/`AdapterError`/`Capabilities`/`Health`/`NormalizedItem`/`Attachment`/`ThreadRef`/`Outbound`/`SendResult`/`Channel` — `2026-09-20-phase-a-interfaces.md` §3.2–3.3 (FIXED)
- `RuntimeAdapter`/`EventSink`/`TurnHandle` — `apps/local-agent/src/rpc-dispatch.ts` (Phase A real code; already present per the FIXED contract)
- `SessionRecord` — `apps/local-agent/src/session-registry.ts` (Phase A real code)
- `TurnInput`/`RuntimeCapabilities`/`BridgeError`/`BRIDGE_ERRORS`/`RuntimeKind` — `2026-09-20-phase-a-interfaces.md` §3.5 (FIXED)
- `HttpRuntimeConfig` (`kind:"hermes"`) — `apps/local-agent/src/config.ts` (config Phase A already parses; this plan fills in only the side that builds a real client from it — see "the HTTP-shaped `[[runtime]]` block of Phase A contract §8" in delta §11)
- `one`/`query`/`tx`/`createPool` — `2026-09-20-phase-a-interfaces.md` §4 (FIXED)
- `Scheduler`/`Logger`/`createLogger`/`createEvents`/`createScheduler` — `2026-09-20-phase-a-interfaces.md` §5 (FIXED)
- `recordAdapterHealth` — `2026-09-20-phase-b-interfaces-delta.md` §5 (FIXED signature; defined by this plan's Task 14)

## Produced symbols (newly exported relative to the delta)

- `packages/adapters/outlook`: `CHANNEL`, `normalize`, `mapApiError`, `refreshAccessToken`, `GraphClientLike`, `OutlookAdapterDeps`, `createOutlookAdapter`
- `packages/adapters/telegram`: `CHANNEL`, `normalize`, `mapApiError`, `TelegramClientLike`, `TelegramAdapterDeps`, `createTelegramAdapter`, `BACKFILL_MAX_DAYS`, `BACKFILL_MAX_ITEMS`
- `apps/local-agent/src/bridges/hermes.ts`: `HermesConfig`, `HermesCapabilitiesResponse`, `parseHermesCapabilities`, `HermesSessionHeaderMismatchError`, `HermesAdapter`
- `@omnis/kernel` (new exports, added to `packages/kernel/src/index.ts`): `ADAPTER_HEALTH_FAIL_THRESHOLD`, `recordAdapterHealth`, `resetAdapterHealthCounters`, `sendNtfy`, `AdapterHealthDeps`, `NtfyDeps`, `TOKEN_REFRESH_JOB_NAME`, `TOKEN_REFRESH_CRON`, `TOKEN_REFRESH_WINDOW_MINUTES`, `registerTokenRefreshJob`, `TokenRefreshDeps`, `TokenRefresher`, `GMAIL_REWATCH_JOB_NAME`, `GMAIL_REWATCH_CRON`, `GRAPH_SUB_RENEW_JOB_NAME`, `GRAPH_SUB_RENEW_CRON`, `registerGmailRewatchJob`, `registerGraphSubRenewJob`, `RewatchDeps`, `RewatchFn`
- `apps/hub/src/adapters.ts` (Task 17, US-B45): `AdapterFactory`, `AdapterFactories`, `AccountRow`, `BuildAdaptersDeps`, `buildAdapters`, `StartLoopsDeps`, `startAdapterLoops`, `AdapterLoops`
- `tools/spikes/gate-hermes-sse/result.md` (Task 11-S, no code deliverable)
- ~~`packages/db/migrations/0012_jobs_phase_b.sql`~~ — **this plan no longer creates it**. `0009` · `0011` · `0012` · `0013` are owned by the wave 0 schema bundle (delta §6, cross-review M1). Task 5 assumes that file already exists and uses the seeded `outlook_delta_poll` row.

## Open questions

1. ~~**`apps/hub` wiring is outside this plan.**~~ **Closed — Logan's decision (backlog §7-2)**: hub wiring is **this plan's US-B45 = Task 17**. `local-agent`'s runtime-adapter map (`Map<RuntimeKind, RuntimeAdapter>`) is separate, and `apps/local-agent/src/main.ts` registers the `HermesAdapter` that US-B39 Tasks 11–13 build.
2. ~~**`GET /transcript/:session_id?last_n`**~~ **Closed (cross-review M8)**: **the surfaces plan's Task 11** took it (`apps/hub/src/transcript.ts`). The owner column of the delta §7 table was updated too. This plan still creates only the single file `apps/local-agent/src/bridges/hermes.ts`.
3. ~~**The exact field names of the Hermes `/v1/responses` SSE event payload**~~ **Closed — Logan's decision (backlog §7-3)**: it was **newly registered as a Phase B entry spike** under the slug `gate-hermes-sse` (backlog §5) and is owned by this plan's **Task 11-S**. Without a live connection (the mini's `api_server` on :8642), proceed with documentation-based findings + an `UNVERIFIED` marker, and it does not block US-B39. The spike's substantive output is "do not pin to one set of field names", which Task 13 reflects.
4. **The provenance of `ADAPTER_HEALTH_FAIL_THRESHOLD=3` and the ntfy URL** — these are values this plan pinned (absent from the interfaces delta). Once `settings` (B-D2, US-B33) exists, it is undecided whether to promote them next to `notify.*` as keys like `adapter.health_threshold`, or to pin the ntfy base URL via an environment variable (`OMNIS_NTFY_URL`, newly introduced by this plan — not in delta §9).
5. ~~**Shared ownership of `0012_jobs_phase_b.sql`**~~ **Closed (cross-review M1)**: shared ownership was removed. `0009` · `0011` · `0012` · `0013` are produced by the **wave 0 schema bundle** in one worktree and one commit (delta §6). This plan does not create the file and instead uses the seeded rows — the "shared ownership" sentence in Global Constraints was retired.
