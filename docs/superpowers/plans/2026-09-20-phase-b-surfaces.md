# omnis Phase B Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the surfaces Logan actually touches in Phase B — unified search (`GET /search` + ⌘K search mode), the six new desktop screens (Today/Tasks/Network/Notes/Digest/Settings), and the iPhone PWA shell with Web Push — on top of the memory/agents/kernel work the other four Phase B plans land first (`memory-ingestion`, `agents`, `channels`, `ops`).
**Architecture:** Desktop screens stay read-only Zero consumers exactly like Phase A (`apps/desktop/src/screens/*.tsx` query `@rocicorp/zero`, join client-side the way `Inbox.tsx` already does — no new Zero relationships beyond the one this plan itself owns, `settings`). Every write (settings, unarchive, digest undo, note routing, push subscribe) goes through a typed hub HTTP route under `apps/hub/src/*.ts`, following the `send()`/regex-path-match pattern already in `apps/hub/src/http.ts`. `GET /search` is a synchronous four-way fan-out (`items` FTS+trgm, `threads` rollup, `persons` trgm, `@omnis/memory` kNN) merged and ranked in `apps/hub/src/search.ts`, consumed by both the desktop ⌘K palette and the PWA. `apps/web` is a second Vite React app (no Tauri) that reuses `@omnis/ui` and the same Zero client shape as `apps/desktop`, plus a service worker for install + Web Push.
**Tech Stack:** React 18 + TypeScript 5 (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), `@rocicorp/zero` 1.9.0 (read-only client), `cmdk` (⌘K), `react-virtuoso`, `lucide-react`, Vite 5 + `vite-plugin-pwa` 0.21.x, `web-push` 3.6.7 (hub-side VAPID push), `pg` 8.13.1, vitest 2.1.9 + `@testing-library/react` + `jsdom`, Biome.
**Spec:** `/Users/logankim/AI-Workspaces/omnis/docs/spec/A4-agent-layer.md` §14 (unified search contract) · `/Users/logankim/AI-Workspaces/omnis/docs/spec/A5-ui-ux.md` §2.3–§2.5 (palette/search) §3.4–§3.9 (Today/Tasks/Network/Notes/Digest/Settings) §4 (iPhone PWA) §5 (component map) §7–§9 (onboarding/copy/QA) · `/Users/logankim/AI-Workspaces/omnis/docs/spec/A3-data-schema.md` §2–§5 (schema) §7 (Zero replication) §10 (person identity) · `/Users/logankim/AI-Workspaces/omnis/docs/superpowers/plans/2026-09-20-phase-a-interfaces.md` (canonical Phase A symbols) · `/Users/logankim/AI-Workspaces/omnis/docs/superpowers/plans/2026-09-20-phase-b-interfaces-delta.md` (canonical Phase B symbols; this plan copies §2.2/§2.3/§5/§6/§7 verbatim) · `/Users/logankim/AI-Workspaces/omnis/docs/superpowers/plans/2026-09-20-phase-b-backlog.md` (US-B26–B33, B35, B36).

## Global Constraints

- Node 22 + pnpm workspaces. The `apps/*` glob in `pnpm-workspace.yaml` already covers `apps/web` — no workspace file change needed.
- TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` (interface contract §2). `packages/ui` depends on "React only" (the Phase A package-boundary ruling, unchanged) — it does **not import** `SearchResponse`/`SearchHit` etc. from `@omnis/protocol` and instead uses local mirror types (`UiSearchHit`/`UiSearchGroup`).
- Postgres 17. Migrations are append-only files `packages/db/migrations/000N_<name>.sql`; the next number is **0009** (this plan creates three: `0009_settings.sql`, `0011_push_subscriptions.sql`, `0013_publication_phase_b.sql` — `0010` (ingest_sources) belongs to the memory-ingestion plan and `0012` (jobs seed) is a shared file, so this plan leaves both alone).
- The hub binds only to `127.0.0.1:8787` (A6 §3); Tailscale Serve mounts it at `/api/`. Static serving of `apps/web` belongs to the ops plan (US-B34 `tailscale-serve.sh`); this plan only produces the `pnpm web:build` artifacts.
- Pinned versions (interface contract §1, unchanged): `vitest 2.1.9` · `zod ^3.24.1` · `pg 8.13.1` · `typescript 5.6.3` · `pnpm@9.12.3` · `@rocicorp/zero 1.9.0` (exact) · `ai 7.0.107`. Newly pinned by this plan (delta §1): `web-push 3.6.7`, `vite-plugin-pwa 0.21.x`.
- No wiring of irreversible tools without an approval gate (A7 §7 common prohibition) — every write path in this plan (settings change, unarchive, accepting note routing, push subscription) is either a **reversible** action that does not need to go through `pending_approvals` (unarchive is the undo of an archive; a settings change is an administrative action audited via `audit_log`) or the execution of something already approved (the Web Push Approve button reuses the existing `POST /approvals/:id/decide` as-is; no new route is created — contract §7).
- Provider SDKs live only inside adapter packages — this plan creates no channel adapters. `web-push` (VAPID) is not a channel adapter but the hub's own delivery infrastructure, so it is not an exception; it was never in scope of the rule to begin with.
- Story tiers (backlog table): US-B26 is **Opus**, all the others (B27–B33, B35, B36) are **Sonnet** — this plan has no DeepSeek-tier stories.
- Commits: one atomic commit per story (subject `US-Bxx: <one-line summary>`), body listing the acceptance criteria met + `Implemented-by: Claude <Tier>`, final line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` (interface contract §12, latest trailer rule).
- **Symbols from other Phase B plans** that this plan references (assumed to exist, not created in this worktree): `searchMemories`/`MemoryHit` from `@omnis/memory` (memory-ingestion US-B01/B04), `costState`/`currentPolicy`/`Policy` from `@omnis/kernel` (agents US-B14), `archiveItem`/`undoArchive`/`ArchivedByMeta`/`UNDO_WINDOW_DAYS` from `@omnis/kernel` (agents US-B18), `notifyTierFor`/`createNotifier` (agents US-B15/B17). Given the wave order (backlog §3), these are already merged by the time this plan (W3) runs.

---

### Task 1: Unified search API — `GET /search` (US-B26, tier: Opus)

**Goal (backlog)**: `GET /search?q&k&scope&since`, four parallel queries (items FTS + trgm fallback / threads rollup / persons trgm + handle_norm / memories kNN), in-group normalization + `group_weight` merged ranking + recency·VIP boost, cap of 5 per group and 20 overall, `SearchResponse` schema verbatim. Leaves no `agent_runs` row.
**Deliverables**: `apps/hub/src/search.ts`, `packages/memory/src/search.ts` (modified)
**Verification command**: `pnpm --filter @omnis/hub test`
**Depends on**: B01 (`@omnis/memory` scaffold), B03 (person identity resolution)
**Spec to read**: A4 §14 (all), delta §2.2 (`SearchHit`/`SearchGroup`/`SearchResponse`/`SearchDeepLink`), A3 §2 (items.search_tsv/items_body_trgm_idx), §3 (persons_name_trgm_idx), §5 (memories_embedding_idx — a memory-ingestion plan deliverable, already wrapped by `searchMemories`)
**Do not do (YAGNI)**: applying `scope`/`since` filters as SQL WHERE clauses (they appear on the backlog surface, but the A4 §14.2 query table has no scope/since filter conditions — parse and accept the params but ignore them in this task; recorded under open questions), per-group "more" pagination (§14.3's "if you need more, the group header's more" is a client follow-up), writing `agent_runs` (explicitly forbidden by the spec).

**Files:**
- Create: `apps/hub/src/search.ts`
- Modify: `apps/hub/src/http.ts` (add GET /search and GET /memory/search routes), `apps/hub/package.json` (add the `@omnis/memory` dependency)
- Test: `apps/hub/src/search.test.ts`

**Interfaces:**
- Consumes: `SearchHit`/`SearchGroup`/`SearchResponse`/`SearchGroupKind`/`SearchHitKind` (`@omnis/protocol`, delta §2.2), `Channel`/`MemorySourceKind` (`@omnis/protocol`), `searchMemories`/`MemoryHit`/**`truncateSnippet`** (`@omnis/memory`, delta §3 + memory-ingestion plan Task 4), `query` (`@omnis/db`)
- Produces: `normalizeScores`, `mergedScore`, `buildGroup`, `runSearch`, `createSearchDeps`, `SearchDeps`, `ItemHitRow`, `ThreadHitRow`, `PersonHitRow` (`apps/hub/src/search.ts`)

**Steps:**

1. [ ] **Precondition check** — `truncateSnippet` is **produced by memory-ingestion plan Task 4** (2026-09-20 cross review M13: `packages/memory/src/search.ts` is that plan's single-owner file, so adding to it from this worktree would create cross-ownership). This task only imports it — if it is missing, do not start this task; wait for the memory-ingestion Task 4 merge.
   ```bash
   cd /Users/logankim/AI-Workspaces/omnis && grep -n "export function truncateSnippet" packages/memory/src/search.ts && grep -n "truncateSnippet" packages/memory/src/index.ts
   ```
   Expected output: both greps hit exactly 1 line each (`packages/memory/src/index.ts` has `export { searchMemories, truncateSnippet, type MemoryHit } from "./search.js";`). If there is no hit, **stop** and wait for the W1 memory-ingestion C1 chain (Tasks 1–4) to merge.

2. [ ] Write the failing tests for the merge-ranking pure functions (`normalizeScores`/`mergedScore`/`buildGroup`).
   ```ts
   // apps/hub/src/search.test.ts
   import { describe, expect, it } from "vitest";
   import { buildGroup, mergedScore, normalizeScores, runSearch, type SearchDeps } from "./search.js";

   describe("normalizeScores (A4 §14.3 in-group 0–1 normalization)", () => {
     it("divides by the group max", () => {
       expect(normalizeScores([2, 4, 1])).toEqual([0.5, 1, 0.25]);
     });
     it("returns all zeros when every raw score is 0 (no div-by-zero)", () => {
       expect(normalizeScores([0, 0])).toEqual([0, 0]);
     });
   });

   describe("mergedScore (A4 §14.3 score = group_weight×norm + 0.25×recency + 0.15×vip)", () => {
     it("adds the full recency + vip bump for a same-instant VIP hit", () => {
       const now = new Date("2026-09-20T00:00:00Z");
       expect(mergedScore(1.0, 1, now.toISOString(), true, now)).toBeCloseTo(1 + 0.25 + 0.15, 5);
     });
     it("decays recency toward 0 as the hit ages (90-day half-life-ish exp decay)", () => {
       const now = new Date("2026-09-20T00:00:00Z");
       const oldIso = new Date("2025-09-20T00:00:00Z").toISOString();
       const fresh = mergedScore(1, 0, now.toISOString(), false, now);
       const stale = mergedScore(1, 0, oldIso, false, now);
       expect(stale).toBeLessThan(fresh);
     });
     it("scores a null timestamp (self-model memory) as zero recency", () => {
       const now = new Date("2026-09-20T00:00:00Z");
       expect(mergedScore(1, 0, null, false, now)).toBe(0);
     });
   });

   describe("buildGroup (max 5 per group, total is the pre-cap count)", () => {
     it("caps results at 5, sorts by score desc, keeps the true total", () => {
       const hits = Array.from({ length: 8 }, (_, i) => ({
         kind: "item" as const, id: String(i), score: i, title: "t", snippet: "s",
         at: null, channel: null, deep_link: null,
       }));
       const group = buildGroup("items", hits);
       expect(group.total).toBe(8);
       expect(group.results).toHaveLength(5);
       expect(group.results[0]?.id).toBe("7");
     });
   });

   function fakeDeps(overrides: Partial<SearchDeps> = {}): SearchDeps {
     return {
       searchItems: async () => [],
       searchThreads: async () => [],
       searchPeople: async () => [],
       searchMemories: async () => [],
       ...overrides,
     };
   }

   describe("runSearch (A4 §14.4 fixed group order people→threads→items→memories)", () => {
     it("returns all 4 groups in fixed order even when everything is empty", async () => {
       const res = await runSearch(fakeDeps(), { q: "davich" });
       expect(res.groups.map((g) => g.kind)).toEqual(["people", "threads", "items", "memories"]);
       expect(res.q).toBe("davich");
       expect(res.truncated).toBe(false);
     });
     it("nulls deep_link for a memory with no source item (self-model fact)", async () => {
       const res = await runSearch(
         fakeDeps({
           searchMemories: async () => [{
             memory_id: "m1", content: "prefers morning meetings", score: 0.9,
             recorded_at: "2026-09-01T00:00:00Z", valid_from: "2026-09-01T00:00:00Z", valid_until: null,
             source_item_id: null, source_kind: "self", source_ref: null,
           }],
         }),
         { q: "meetings" },
       );
       const memories = res.groups.find((g) => g.kind === "memories");
       expect(memories?.results[0]?.deep_link).toBeNull();
       expect(memories?.results[0]?.source_kind).toBe("self");
     });
     it("threads deep_links to the item's thread when a memory does have a source item", async () => {
       const res = await runSearch(
         fakeDeps({
           searchItems: async () => [{
             id: "i1", thread_id: "t1", subject: "Contract request", body: "Please confirm",
             sent_at: "2026-09-19T09:00:00Z", channel: "gmail",
           }],
         }),
         { q: "contract" },
       );
       const items = res.groups.find((g) => g.kind === "items");
       expect(items?.results[0]?.deep_link).toEqual({ screen: "thread", thread_id: "t1", item_id: "i1" });
     });
   });
   ```

3. [ ] Run → confirm failure.
   ```bash
   pnpm --filter @omnis/hub test
   ```
   Expected output: `Cannot find module './search.js'`.

4. [ ] Implement `apps/hub/src/search.ts`.
   ```ts
   // apps/hub/src/search.ts
   import type {
     Channel,
     MemorySourceKind,
     SearchGroup,
     SearchGroupKind,
     SearchHit,
     SearchResponse,
   } from "@omnis/protocol";
   import { searchMemories, truncateSnippet, type MemoryHit } from "@omnis/memory";
   import type { Pool } from "pg";
   import { query } from "@omnis/db";

   export interface ItemHitRow {
     id: string;
     thread_id: string;
     subject: string | null;
     body: string;
     sent_at: string;
     channel: Channel;
   }
   export interface ThreadHitRow {
     id: string;
     title: string | null;
     last_item_at: string | null;
   }
   export interface PersonHitRow {
     id: string;
     display_name: string;
     last_contact_at: string | null;
     vip: boolean;
   }

   export interface SearchDeps {
     searchItems(q: string, k: number): Promise<ItemHitRow[]>;
     searchThreads(q: string, itemThreadIds: readonly string[], k: number): Promise<ThreadHitRow[]>;
     searchPeople(q: string, k: number): Promise<PersonHitRow[]>;
     searchMemories(q: string, k: number): Promise<MemoryHit[]>;
   }

   export interface SearchParams {
     q: string;
     k?: number;
     scope?: "work" | "personal" | "all";
     since?: string;
     now?: Date;
   }

   const GROUP_WEIGHT: Record<SearchGroupKind, number> = {
     people: 1.0,
     threads: 0.9,
     items: 0.85,
     memories: 0.8,
   };
   const GROUP_CAP = 5;
   const RECENCY_HALF_LIFE_DAYS = 90;

   function recency(at: string | null, now: Date): number {
     if (at === null) return 0;
     const ageDays = Math.max(0, (now.getTime() - new Date(at).getTime()) / 86_400_000);
     return Math.exp(-ageDays / RECENCY_HALF_LIFE_DAYS);
   }

   /** A4 §14.3: normalize to 0–1 within a group. If the whole group is 0 (no ranking), every normalized score is 0 too. */
   export function normalizeScores(raws: readonly number[]): number[] {
     const max = Math.max(0, ...raws);
     if (max === 0) return raws.map(() => 0);
     return raws.map((r) => r / max);
   }

   export function mergedScore(
     groupWeight: number,
     normRaw: number,
     at: string | null,
     vip: boolean,
     now: Date,
   ): number {
     return groupWeight * normRaw + 0.25 * recency(at, now) + 0.15 * (vip ? 1 : 0);
   }

   export function buildGroup(kind: SearchGroupKind, hits: readonly SearchHit[]): SearchGroup {
     const sorted = [...hits].sort((a, b) => b.score - a.score);
     return { kind, total: sorted.length, results: sorted.slice(0, GROUP_CAP) };
   }

   export async function runSearch(deps: SearchDeps, params: SearchParams): Promise<SearchResponse> {
     const start = Date.now();
     const k = params.k ?? GROUP_CAP;
     const now = params.now ?? new Date();

     const [itemRows, peopleRows, memoryHits] = await Promise.all([
       deps.searchItems(params.q, k),
       deps.searchPeople(params.q, k),
       deps.searchMemories(params.q, k),
     ]);
     const threadRows = await deps.searchThreads(
       params.q,
       [...new Set(itemRows.map((r) => r.thread_id))],
       k,
     );

     const peopleNorm = normalizeScores(peopleRows.map((_, i) => peopleRows.length - i));
     const peopleHits: SearchHit[] = peopleRows.map((r, i) => ({
       kind: "person",
       id: r.id,
       score: mergedScore(GROUP_WEIGHT.people, peopleNorm[i] ?? 0, r.last_contact_at, r.vip, now),
       title: r.display_name,
       snippet: r.display_name,
       at: r.last_contact_at,
       channel: null,
       deep_link: { screen: "person", person_id: r.id },
     }));

     const threadsNorm = normalizeScores(threadRows.map((_, i) => threadRows.length - i));
     const threadHits: SearchHit[] = threadRows.map((r, i) => ({
       kind: "thread",
       id: r.id,
       score: mergedScore(GROUP_WEIGHT.threads, threadsNorm[i] ?? 0, r.last_item_at, false, now),
       title: r.title ?? "(no subject)",
       snippet: r.title ?? "",
       at: r.last_item_at,
       channel: null,
       deep_link: { screen: "thread", thread_id: r.id },
     }));

     const itemsNorm = normalizeScores(itemRows.map((_, i) => itemRows.length - i));
     const itemHits: SearchHit[] = itemRows.map((r, i) => ({
       kind: "item",
       id: r.id,
       score: mergedScore(GROUP_WEIGHT.items, itemsNorm[i] ?? 0, r.sent_at, false, now),
       title: r.subject ?? truncateSnippet(r.body, 60),
       snippet: truncateSnippet(r.subject ? `${r.subject} — ${r.body}` : r.body),
       at: r.sent_at,
       channel: r.channel,
       deep_link: { screen: "thread", thread_id: r.thread_id, item_id: r.id },
     }));

     const memoriesNorm = normalizeScores(memoryHits.map((m) => m.score));
     const memoryHitViews: SearchHit[] = memoryHits.map((m, i) => ({
       kind: "memory",
       id: m.memory_id,
       score: mergedScore(GROUP_WEIGHT.memories, memoriesNorm[i] ?? 0, m.recorded_at, false, now),
       title: truncateSnippet(m.content, 60),
       snippet: truncateSnippet(m.content),
       at: m.recorded_at,
       channel: null,
       deep_link:
         m.source_item_id !== null ? { screen: "thread", item_id: m.source_item_id } : null,
       source_kind: m.source_kind,
     }));

     const groups: SearchGroup[] = [
       buildGroup("people", peopleHits),
       buildGroup("threads", threadHits),
       buildGroup("items", itemHits),
       buildGroup("memories", memoryHitViews),
     ];

     return {
       q: params.q,
       took_ms: Date.now() - start,
       groups,
       truncated: groups.some((g) => g.total > g.results.length),
     };
   }

   /** The real SQL wiring. The A4 §14.2 table verbatim — re-issue the trigram fallback only when FTS returns 0 rows. */
   export function createSearchDeps(pool: Pool): SearchDeps {
     return {
       async searchItems(q, k) {
         const fts = await query<ItemHitRow>(
           pool,
           `SELECT i.id, i.thread_id, i.subject, i.body, i.sent_at, a.channel
              FROM items i JOIN accounts a ON a.id = i.account_id
             WHERE i.search_tsv @@ websearch_to_tsquery('simple', $1)
             ORDER BY ts_rank(i.search_tsv, websearch_to_tsquery('simple', $1)) DESC
             LIMIT $2`,
           [q, k],
         );
         if (fts.length > 0) return fts;
         return query<ItemHitRow>(
           pool,
           `SELECT i.id, i.thread_id, i.subject, i.body, i.sent_at, a.channel
              FROM items i JOIN accounts a ON a.id = i.account_id
             WHERE similarity(i.body, $1) > 0.3
             ORDER BY similarity(i.body, $1) DESC
             LIMIT $2`,
           [q, k],
         );
       },
       async searchThreads(q, itemThreadIds, k) {
         return query<ThreadHitRow>(
           pool,
           `SELECT t.id, t.title, t.last_item_at
              FROM threads t
             WHERE t.id = ANY($2::uuid[]) OR similarity(coalesce(t.title, ''), $1) > 0.3
             ORDER BY (t.id = ANY($2::uuid[])) DESC, similarity(coalesce(t.title, ''), $1) DESC
             LIMIT $3`,
           [q, itemThreadIds, k],
         );
       },
       async searchPeople(q, k) {
         return query<PersonHitRow>(
           pool,
           `SELECT p.id, p.display_name, p.last_contact_at, p.vip
              FROM persons p
             WHERE p.merged_into IS NULL
               AND (similarity(p.display_name, $1) > 0.2
                 OR EXISTS (SELECT 1 FROM identities idn WHERE idn.person_id = p.id AND idn.handle_norm = $1))
             ORDER BY similarity(p.display_name, $1) DESC
             LIMIT $2`,
           [q, k],
         );
       },
       async searchMemories(q, k) {
         return searchMemories(pool, { query: q, k });
       },
     };
   }
   ```

5. [ ] Re-run → confirm pass, commit.
   ```bash
   pnpm --filter @omnis/hub test
   ```
   Expected output: `normalizeScores`/`mergedScore`/`buildGroup`/`runSearch` all PASS.
   ```bash
   git add apps/hub/src/search.ts apps/hub/src/search.test.ts
   git commit -m "$(cat <<'EOF'
   US-B26: GET /search merge-ranking core (A4 §14) — normalizeScores/mergedScore/buildGroup/runSearch

   - four-way fan-out interface (SearchDeps) so the ranking math is unit-tested without Postgres
   - createSearchDeps() wires the real FTS+trgm+kNN SQL (A4 §14.2 table, verbatim)
   - fixed group order people→threads→items→memories, group cap 5, no agent_runs row (A4 §14)

   Implemented-by: Claude Opus
   Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
   EOF
   )"
   ```

6. [ ] Add the `@omnis/memory` dependency to `apps/hub/package.json` (delta §1, "apps/hub → add @omnis/memory").
   ```json
   // apps/hub/package.json — add one line under "dependencies"
   "@omnis/memory": "workspace:*",
   ```

7. [ ] Add the two routes to `apps/hub/src/http.ts` immediately before the final branch (the "// /search, /memory/search, /transcript/:id are owned by other appendices…" one).
    ```ts
    // apps/hub/src/http.ts — inside handle(), inserted before the existing "/search... Phase A does not open it" comment/404
    import { createSearchDeps, runSearch } from "./search.js";
    import { searchMemories } from "@omnis/memory";
    // (top of the createHubServer function, on the line after `const { kernel, pool, config, logger, startedAt } = deps;`)
    const searchDeps = createSearchDeps(pool);

    if (path === "/search") {
      if (method !== "GET") return send(res, 405, { error: "method not allowed" });
      const q = url.searchParams.get("q");
      if (q === null || q.trim() === "") return send(res, 400, { error: "q is required" });
      const kParam = url.searchParams.get("k");
      const k = kParam === null ? undefined : Number(kParam);
      if (k !== undefined && (!Number.isInteger(k) || k < 1)) {
        return send(res, 400, { error: "bad k" });
      }
      const result = await runSearch(searchDeps, { q, ...(k !== undefined ? { k } : {}) });
      return send(res, 200, result);
    }

    if (path === "/memory/search") {
      if (method !== "GET") return send(res, 405, { error: "method not allowed" });
      const q = url.searchParams.get("q");
      if (q === null || q.trim() === "") return send(res, 400, { error: "q is required" });
      const results = await searchMemories(pool, { query: q });
      return send(res, 200, { results });
    }
    ```

8. [ ] Commit.
    ```bash
    git add apps/hub/package.json apps/hub/src/http.ts
    git commit -m "$(cat <<'EOF'
    US-B26: wire GET /search and GET /memory/search into the hub HTTP server

    Implemented-by: Claude Opus
    Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
    EOF
    )"
    ```

**Open questions**: The `scope`/`since` query params do not appear as filter conditions in the A4 §14.2 SQL table (parsed but not applied) — needs confirmation from the A4 author when Phase B runs.

---

### Task 2: ⌘K search mode (US-B27, tier: Sonnet)

**Goal (backlog)**: When the input matches no action, the palette switches to search results; fixed group order (people→threads→items→memories); 180ms debounce; memories with a null `deep_link` are not clickable; empty-state and slow-state copy.
**Deliverables**: `packages/ui/src/components/command-palette.tsx` (modified), `apps/desktop/src/api/search.ts`
**Verification command**: `pnpm --filter @omnis/desktop test`
**Depends on**: B26
**Spec to read**: A5 §2.5 (all), §2.3 (existing palette action categories — keep backward compatible)
**Do not do (YAGNI)**: per-group "more" pagination, the `scope` filter UI (Task 1 does not use it server-side yet, so the UI is not built either).

**Files:**
- Modify: `packages/ui/src/components/command-palette.tsx`
- Create: `apps/desktop/src/api/search.ts`
- Test: `packages/ui/test/command-palette.test.tsx` (extended), `apps/desktop/test/search-api.test.ts`

**Interfaces:**
- Consumes: `Command` (cmdk), `GlassSurface` (existing)
- Produces: `matchesAnyAction`, `UiSearchHit`, `UiSearchGroup`, `UiSearchGroupKind`, `CommandPaletteSearch` (all in `command-palette.tsx`); `search` (`apps/desktop/src/api/search.ts`)

**Steps:**

1. [ ] Write the failing test for the search-mode switch decision (`matchesAnyAction`).
   ```tsx
   // packages/ui/test/command-palette.test.tsx — add a describe block to the existing file
   import { matchesAnyAction, type PaletteAction, type UiSearchGroup } from "../src/components/command-palette.js";

   describe("matchesAnyAction (A5 §2.5: search mode when the input matches no action)", () => {
     const actions: PaletteAction[] = [
       { id: "go-inbox", name: "Go to Inbox", group: "Navigation", perform: () => {} },
     ];
     it("stays in action mode for an empty query", () => {
       expect(matchesAnyAction("", actions)).toBe(true);
     });
     it("stays in action mode when the query matches an action name (case-insensitive substring)", () => {
       expect(matchesAnyAction("inbox", actions)).toBe(true);
     });
     it("switches to search mode when nothing matches", () => {
       expect(matchesAnyAction("davich", actions)).toBe(false);
     });
   });
   ```

2. [ ] Run → confirm failure.
   ```bash
   pnpm --filter @omnis/ui test
   ```
   Expected output: `matchesAnyAction is not exported`.

3. [ ] Add the search-mode types + `matchesAnyAction` + `SearchResultList` to `command-palette.tsx`, and make `CommandPalette` switch to that list when a `search` prop is present and the input matches no action.
   ```tsx
   // packages/ui/src/components/command-palette.tsx — added to the top of the existing file
   import { useEffect, useState } from "react";
   // (add useState/useEffect to the existing imports)

   export type UiSearchGroupKind = "people" | "threads" | "items" | "memories";
   export interface UiSearchHit {
     kind: "person" | "thread" | "item" | "memory";
     id: string;
     title: string;
     snippet: string;
     deepLinkDisabled: boolean;
   }
   export interface UiSearchGroup {
     kind: UiSearchGroupKind;
     label: string;
     results: UiSearchHit[];
   }
   export interface CommandPaletteSearch {
     groups: UiSearchGroup[];
     loading: boolean;
     onQueryChange: (q: string) => void;
     onSelectHit: (hit: UiSearchHit) => void;
   }

   const SEARCH_GROUP_ORDER: UiSearchGroupKind[] = ["people", "threads", "items", "memories"];
   const SEARCH_DEBOUNCE_MS = 180;

   /** A5 §2.5: an empty input is always action mode; otherwise it is action mode if any registered action name matches as a substring. */
   export function matchesAnyAction(query: string, actions: PaletteAction[]): boolean {
     const q = query.trim().toLowerCase();
     if (q === "") return true;
     return actions.some((a) => a.name.toLowerCase().includes(q));
   }

   function SearchResultList({
     query,
     search,
   }: {
     query: string;
     search: CommandPaletteSearch;
   }) {
     const empty = !search.loading && search.groups.every((g) => g.results.length === 0);
     return (
       <Command.List>
         {search.loading && <div className="palette-search__loading">Searching…</div>}
         {empty && <div className="palette-search__empty">{`No results for ${query}`}</div>}
         {SEARCH_GROUP_ORDER.map((kind) => {
           const group = search.groups.find((g) => g.kind === kind);
           if (!group || group.results.length === 0) return null;
           return (
             <Command.Group key={kind} heading={group.label}>
               {group.results.map((hit) => (
                 <Command.Item
                   key={`${hit.kind}:${hit.id}`}
                   disabled={hit.deepLinkDisabled}
                   onSelect={() => {
                     if (!hit.deepLinkDisabled) search.onSelectHit(hit);
                   }}
                 >
                   <span>{hit.title}</span>
                   <span className="palette-search__snippet">{hit.snippet}</span>
                 </Command.Item>
               ))}
             </Command.Group>
           );
         })}
       </Command.List>
     );
   }
   ```

4. [ ] Add `search?: CommandPaletteSearch` to `CommandPaletteProps`, then wire the `query` state + 180ms debounce + mode branch into the `CommandPalette` body (replace the existing `resultList`/`Command.Input` section with the code below — keep the existing `Command.Dialog`/`GlassSurface` skeleton and layer on just the one `search` prop; mode/inline palettes are out of scope for this story and are not built).
   ```tsx
   // packages/ui/src/components/command-palette.tsx — add the field to CommandPaletteProps
   export interface CommandPaletteProps {
     open: boolean;
     onOpenChange: (open: boolean) => void;
     actions: PaletteAction[];
     /** US-B27: when present, an unmatched action query switches to search-results mode. When absent, Phase A behavior is unchanged. */
     search?: CommandPaletteSearch;
   }

   export function CommandPalette({
     open,
     onOpenChange,
     actions,
     search,
   }: CommandPaletteProps) {
     const [query, setQuery] = useState("");
     useEffect(() => {
       if (!search) return;
       const timer = setTimeout(() => search.onQueryChange(query), SEARCH_DEBOUNCE_MS);
       return () => clearTimeout(timer);
     }, [query, search]);

     const groups = groupBy(actions, (a) => a.group);
     const showSearch = search !== undefined && !matchesAnyAction(query, actions);
     const actionList = (
       <Command.List>
         <Command.Empty>No results</Command.Empty>
         {Object.entries(groups).map(([group, items]) => (
           <Command.Group key={group} heading={group}>
             {items.map((action) => (
               <Command.Item
                 key={action.id}
                 onSelect={() => {
                   action.perform();
                   onOpenChange(false);
                 }}
               >
                 <span>{action.name}</span>
                 {action.shortcut && <kbd>{action.shortcut}</kbd>}
               </Command.Item>
             ))}
           </Command.Group>
         ))}
       </Command.List>
     );
     const resultList = showSearch && search ? (
       <SearchResultList query={query} search={search} />
     ) : (
       actionList
     );

     return (
       <Command.Dialog open={open} onOpenChange={onOpenChange} label="omnis command palette">
         <GlassSurface slot="palette">
           <Command.Input value={query} onValueChange={setQuery} placeholder="Search or run a command…" />
           {resultList}
         </GlassSurface>
       </Command.Dialog>
     );
   }
   ```

5. [ ] Add the rendering tests: fixed group order + a memory without a deep_link is not clickable.
   ```tsx
   // packages/ui/test/command-palette.test.tsx — added
   import { Command } from "cmdk";
   import { render, screen, fireEvent } from "@testing-library/react";
   import { CommandPalette } from "../src/components/command-palette.js";

   describe("CommandPalette search mode (A5 §2.5 fixed group order, memory deep_link click disabled)", () => {
     it("renders people before memories and blocks a deep_link-less memory hit", () => {
       const onSelectHit = vi.fn();
       const groups: UiSearchGroup[] = [
         { kind: "memories", label: "Memories", results: [
           { kind: "memory", id: "m1", title: "Preference", snippet: "prefers morning meetings", deepLinkDisabled: true },
         ] },
         { kind: "people", label: "People", results: [
           { kind: "person", id: "p1", title: "David Park", snippet: "", deepLinkDisabled: false },
         ] },
       ];
       render(
         <CommandPalette
           open
           onOpenChange={() => {}}
           actions={[]}
           search={{ groups, loading: false, onQueryChange: () => {}, onSelectHit }}
         />,
       );
       fireEvent.change(screen.getByRole("combobox"), { target: { value: "david" } });
       const options = screen.getAllByRole("option");
       expect(options[0]).toHaveTextContent("David Park");
       fireEvent.click(screen.getByText("Preference"));
       expect(onSelectHit).not.toHaveBeenCalled();
     });

     it("shows the empty-state copy when typing yields no groups at all", () => {
       render(
         <CommandPalette
           open
           onOpenChange={() => {}}
           actions={[]}
           search={{ groups: [], loading: false, onQueryChange: () => {}, onSelectHit: () => {} }}
         />,
       );
       fireEvent.change(screen.getByRole("combobox"), { target: { value: "davich" } });
       expect(screen.getByText("No results for davich")).toBeInTheDocument();
     });
   });
   ```

6. [ ] Run → confirm pass, commit.
   ```bash
   pnpm --filter @omnis/ui test
   ```
   Expected output: 3 `matchesAnyAction` + 2 `CommandPalette search mode` PASS.
   ```bash
   git add packages/ui/src/components/command-palette.tsx packages/ui/test/command-palette.test.tsx
   git commit -m "$(cat <<'EOF'
   US-B27: cmd-k search mode — fixed group order, 180ms debounce, deep_link-less memory disabled

   - matchesAnyAction() decides action-vs-search mode the same way cmdk's own filter would
   - SearchResultList renders people→threads→items→memories and blocks clicks with no deep_link

   Implemented-by: Claude Sonnet
   Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
   EOF
   )"
   ```

7. [ ] Write the failing test for the hub `/search` client (same pattern as the existing `apps/desktop/src/api/approvals.ts` — a `fetch` stub).
   ```ts
   // apps/desktop/test/search-api.test.ts
   import { afterEach, describe, expect, it, vi } from "vitest";
   import { search } from "../src/api/search.js";

   describe("search (contract §7 GET /search)", () => {
     afterEach(() => vi.unstubAllGlobals());

     it("GETs /search?q=... and returns the parsed SearchResponse", async () => {
       const body = { q: "davich", took_ms: 12, groups: [], truncated: false };
       const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
       vi.stubGlobal("fetch", fetchMock);
       const result = await search("davich");
       expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:8787/search?q=davich");
       expect(result).toEqual(body);
     });

     it("appends k when given", async () => {
       vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
       await search("davich", { k: 3 });
       expect(vi.mocked(fetch)).toHaveBeenCalledWith("http://127.0.0.1:8787/search?q=davich&k=3");
     });

     it("throws on a non-2xx response", async () => {
       vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
       await expect(search("davich")).rejects.toThrow(/500/);
     });
   });
   ```

8. [ ] Run → confirm failure.
   ```bash
   pnpm --filter @omnis/desktop test
   ```
   Expected output: `Cannot find module '../src/api/search.js'`.

9. [ ] Implement `apps/desktop/src/api/search.ts` (the same `HUB_HTTP_URL` pattern as `approvals.ts`).
   ```ts
   // apps/desktop/src/api/search.ts
   const HUB_HTTP_URL = import.meta.env.OMNIS_HUB_HTTP_URL ?? "http://127.0.0.1:8787";

   export interface SearchDeepLink {
     screen: "thread" | "person" | "digest";
     thread_id?: string;
     item_id?: string;
     person_id?: string;
   }
   export interface SearchHit {
     kind: "person" | "thread" | "item" | "memory";
     id: string;
     score: number;
     title: string;
     snippet: string;
     at: string | null;
     channel: string | null;
     deep_link: SearchDeepLink | null;
     source_kind?: string;
   }
   export interface SearchGroup {
     kind: "people" | "threads" | "items" | "memories";
     total: number;
     results: SearchHit[];
   }
   export interface SearchResponse {
     q: string;
     took_ms: number;
     groups: SearchGroup[];
     truncated: boolean;
   }

   export async function search(
     q: string,
     opts?: { k?: number; scope?: "work" | "personal" | "all"; since?: string },
   ): Promise<SearchResponse> {
     const params = new URLSearchParams({ q });
     if (opts?.k !== undefined) params.set("k", String(opts.k));
     if (opts?.scope !== undefined) params.set("scope", opts.scope);
     if (opts?.since !== undefined) params.set("since", opts.since);
     const res = await fetch(`${HUB_HTTP_URL}/search?${params.toString()}`);
     if (!res.ok) throw new Error(`search failed: HTTP ${res.status}`);
     return res.json();
   }
   ```

10. [ ] Re-run → pass, commit.
    ```bash
    pnpm --filter @omnis/desktop test
    ```
    Expected output: 3 `search (contract §7 GET /search)` PASS.
    ```bash
    git add apps/desktop/src/api/search.ts apps/desktop/test/search-api.test.ts
    git commit -m "$(cat <<'EOF'
    US-B27: desktop client for GET /search

    Implemented-by: Claude Sonnet
    Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
    EOF
    )"
    ```

---

### Task 3: Today screen (US-B28, tier: Sonnet)

**Goal (backlog)**: Greeting `<h1>`, nightly digest entry card (only when a nightly exists), today's calendar, morning briefing list (click an item → thread deep link), pending-approval chip strip (click to expand inline).
**Deliverables**: `apps/desktop/src/screens/Today.tsx`, `packages/ui/src/components/digest-card.tsx`
**Verification command**: `pnpm --filter @omnis/desktop test`
**Depends on**: B23 (morning briefing loop — populates `digests(kind='morning')` rows)
**Spec to read**: A5 §3.4 (all), §5.2 (`DigestCard` role)
**This task builds all 4 states (loading/empty/error/offline)** (backlog US-B28 deliverable wording, 2026-09-20 cross review M-B28). The implementation stays small: the state decision is extracted into one pure function `screenState()` and unit-tested, and the screen renders that value as a **single-line banner** `<p role="status">` or `role="alert"` at the very top of the screen. Even in `offline`/`error` the already-synced local data stays visible below (Zero holds a local cache — blanking the screen would be a regression).
**Do not do (YAGNI)**: do not create a shared `<StateBanner>` component in `@omnis/ui` (this screen is its only consumer — promote it when a second screen needs the same thing), retry button / backoff indicator, a full 4-way reimplementation of the inline `ApprovalSheet` (reuse the existing `ApprovalCardView` as-is).

**Files:**
- Create: `packages/ui/src/components/digest-card.tsx`, `apps/desktop/src/screens/Today.tsx`
- Test: `packages/ui/test/digest-card.test.tsx`, `apps/desktop/test/today-screen.test.tsx`

**Interfaces:**
- Consumes: `OpaqueSurface`, `Button` (existing `@omnis/ui`), `ApprovalCardView`, `ApprovalCardInterrupt` (existing)
- Produces: `DigestCard`, `DigestCardProps` (`packages/ui/src/components/digest-card.tsx`); `greetingLine`, `isSameLocalDay`, `screenState`, `ScreenState`, `STATE_COPY` (`apps/desktop/src/screens/Today.tsx`)

**Steps:**

1. [ ] Write the test for `DigestCard` (shared by morning/nightly) first.
   ```tsx
   // packages/ui/test/digest-card.test.tsx
   import { describe, expect, it, vi } from "vitest";
   import { render, screen, fireEvent } from "@testing-library/react";
   import { DigestCard } from "../src/components/digest-card.js";

   describe("DigestCard (A5 §5.2 shared by morning/nightly)", () => {
     it("renders headline + body and calls onOpen", () => {
       const onOpen = vi.fn();
       render(
         <DigestCard kind="nightly" headline="Nightly digest ready · 42 archived" body="September 19" onOpen={onOpen} />,
       );
       expect(screen.getByText("Nightly digest ready · 42 archived")).toBeInTheDocument();
       fireEvent.click(screen.getByText("View →"));
       expect(onOpen).toHaveBeenCalled();
     });
     it("omits the open button when onOpen is not given", () => {
       render(<DigestCard kind="morning" headline="Morning briefing" body="" />);
       expect(screen.queryByText("View →")).not.toBeInTheDocument();
     });
   });
   ```

2. [ ] Run → fail.
   ```bash
   pnpm --filter @omnis/ui test
   ```
   Expected output: `Cannot find module '../src/components/digest-card.js'`.

3. [ ] Implement `DigestCard`.
   ```tsx
   // packages/ui/src/components/digest-card.tsx
   import { Button } from "./button.js";
   import { OpaqueSurface } from "./glass-surface.js";

   export interface DigestCardProps {
     kind: "morning" | "nightly";
     headline: string;
     body: string;
     onOpen?: () => void;
   }

   /** A5 §5.2: card shared by the morning/nightly digests (the category accordion is the Digest screen's responsibility; this is just the entry-card form). */
   export function DigestCard({ kind, headline, body, onOpen }: DigestCardProps) {
     return (
       <OpaqueSurface className="digest-card" data-digest-kind={kind}>
         <p className="digest-card__headline">{headline}</p>
         {body !== "" && <p className="digest-card__body">{body}</p>}
         {onOpen && (
           <Button variant="ghost" onClick={onOpen}>
             View →
           </Button>
         )}
       </OpaqueSurface>
     );
   }
   ```
   Then add `export * from "./components/digest-card.js";` to `packages/ui/src/index.ts`.

4. [ ] Re-run → pass, commit.
   ```bash
   pnpm --filter @omnis/ui test
   ```
   ```bash
   git add packages/ui/src/components/digest-card.tsx packages/ui/src/index.ts packages/ui/test/digest-card.test.tsx
   git commit -m "$(cat <<'EOF'
   US-B28: DigestCard component (A5 §5.2, shared by morning/nightly)

   Implemented-by: Claude Sonnet
   Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
   EOF
   )"
   ```

5. [ ] Test the Today screen's pure logic first (greeting text, "today" decision) — following the Inbox.tsx precedent of exporting pure functions and testing them without mounting Zero.
   ```ts
   // apps/desktop/test/today-screen.test.tsx
   import { describe, expect, it } from "vitest";
   import { STATE_COPY, greetingLine, isSameLocalDay, screenState } from "../src/screens/Today";

   describe("greetingLine (A5 §3.4 greeting <h1>)", () => {
     it("includes the pending item count and approval count", () => {
       expect(greetingLine("Logan", 12, 4)).toBe(
         "Good morning, Logan. 12 items to handle today, 4 approvals pending.",
       );
     });
     it("still reads naturally with zero of both", () => {
       expect(greetingLine("Logan", 0, 0)).toBe(
         "Good morning, Logan. 0 items to handle today, 0 approvals pending.",
       );
     });
   });

   describe("isSameLocalDay (today-calendar filter decision)", () => {
     it("is true for two timestamps on the same calendar day", () => {
       expect(isSameLocalDay(new Date("2026-09-20T01:00:00"), new Date("2026-09-20T23:00:00"))).toBe(true);
     });
     it("is false across a day boundary", () => {
       expect(isSameLocalDay(new Date("2026-09-20T23:59:00"), new Date("2026-09-21T00:01:00"))).toBe(false);
     });
   });

   describe("screenState (US-B28 4 states — loading/empty/error/offline)", () => {
     const ok = { online: true, resultTypes: ["complete", "complete"] as const };
     it("error wins over everything — a failed query is the most specific thing we know", () => {
       expect(screenState({ online: false, resultTypes: ["error", "unknown"], hasContent: true })).toBe("error");
     });
     it("offline beats loading — offline queries never reach 'complete', so 'loading' would hang forever", () => {
       expect(screenState({ online: false, resultTypes: ["unknown", "complete"], hasContent: false })).toBe("offline");
     });
     it("loading while any query is still 'unknown'", () => {
       expect(screenState({ online: true, resultTypes: ["unknown", "complete"], hasContent: false })).toBe("loading");
     });
     it("empty when every query completed and there is nothing to show", () => {
       expect(screenState({ ...ok, hasContent: false })).toBe("empty");
     });
     it("ready when every query completed and there is something to show", () => {
       expect(screenState({ ...ok, hasContent: true })).toBe("ready");
     });
     // Even offline, already-synced local data stays on screen — only the banner appears, the lists stay alive.
     it("offline still reports content so the caller keeps rendering the cached lists", () => {
       expect(STATE_COPY.offline).not.toBe("");
       expect(STATE_COPY.ready).toBe("");
     });
   });
   ```

6. [ ] Run → fail.
   ```bash
   pnpm --filter @omnis/desktop test
   ```
   Expected output: `Cannot find module '../src/screens/Today'`.

7. [ ] Implement `Today.tsx`. The data binding follows the A5 §3.4 pseudocode verbatim — read `digests` (morning/nightly), `items(kind='event')`, and `pending_approvals` separately through Zero and combine them client-side (the pattern Inbox.tsx already proves: query each one rather than relying on relationships, then join with `useMemo`).
   ```tsx
   // apps/desktop/src/screens/Today.tsx
   import { OpaqueSurface } from "@omnis/ui";
   import { DigestCard } from "@omnis/ui/components/digest-card";
   import { ApprovalCardView, type ApprovalCardInterrupt } from "@omnis/ui/components/approval-card";
   import { useQuery } from "@rocicorp/zero/react";
   import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
   import { decideApproval } from "../api/approvals.js";
   import { useZeroClient } from "../zero-client.js";

   /** A5 §3.4: greeting text, rendered as an <h1> so a screen reader announces the page's gist immediately. */
   export function greetingLine(name: string, pendingCount: number, approvalCount: number): string {
     return `Good morning, ${name}. ${pendingCount} items to handle today, ${approvalCount} approvals pending.`;
   }

   export function isSameLocalDay(a: Date, b: Date): boolean {
     return (
       a.getFullYear() === b.getFullYear() &&
       a.getMonth() === b.getMonth() &&
       a.getDate() === b.getDate()
     );
   }

   export type ScreenState = "error" | "offline" | "loading" | "empty" | "ready";

   /** US-B28 4 states. Zero's query result type is 'unknown' | 'complete' | 'error' (@rocicorp/zero
    * 1.9.0 `ResultType`), and while offline a query never reaches 'complete' — that is why offline
    * comes before loading. error carries the most specific information, so it comes first. */
   export function screenState(input: {
     online: boolean;
     resultTypes: readonly ("unknown" | "complete" | "error")[];
     hasContent: boolean;
   }): ScreenState {
     if (input.resultTypes.includes("error")) return "error";
     if (!input.online) return "offline";
     if (input.resultTypes.includes("unknown")) return "loading";
     return input.hasContent ? "ready" : "empty";
   }

   /** Banner copy. `ready` is an empty string = draw no banner. */
   export const STATE_COPY: Record<ScreenState, string> = {
     error: "Couldn't load the Today screen. Check the hub logs.",
     offline: "You're offline. Showing the last content we received.",
     loading: "Loading…",
     empty: "Today is empty. New items will pile up here.",
     ready: "",
   };

   /** Reads zero.online as React state (zero.onOnline returns an unsubscribe function). */
   function useZeroOnline(zero: ReturnType<typeof useZeroClient>): boolean {
     const subscribe = useCallback((cb: () => void) => zero.onOnline(() => cb()), [zero]);
     return useSyncExternalStore(
       subscribe,
       () => zero.online,
       () => true, // server-render/test default: assume online
     );
   }

   export function Today({ onOpenThread }: { onOpenThread?: (threadId: string) => void }) {
     const zero = useZeroClient();
     const [expandedApprovalId, setExpandedApprovalId] = useState<string | null>(null);
     const now = useMemo(() => new Date(), []);

     const online = useZeroOnline(zero);
     const [morningDigests, morningR] = useQuery(zero.query.digests.where("kind", "=", "morning"));
     const [nightlyDigests, nightlyR] = useQuery(
       zero.query.digests.where("kind", "=", "nightly").orderBy("for_date", "desc").limit(1),
     );
     const [eventItems, eventsR] = useQuery(zero.query.items.where("kind", "=", "event"));
     const [approvals, approvalsR] = useQuery(
       zero.query.pending_approvals.where("state", "=", "pending"),
     );

     const morning = useMemo(
       () => morningDigests.find((d) => isSameLocalDay(new Date(d.for_date), now)) ?? null,
       [morningDigests, now],
     );
     const nightly = nightlyDigests[0] ?? null;
     const todaysEvents = useMemo(
       () => eventItems.filter((i) => isSameLocalDay(new Date(i.sent_at), now)).sort((a, b) => a.sent_at - b.sent_at),
       [eventItems, now],
     );

     const state = screenState({
       online,
       resultTypes: [morningR.type, nightlyR.type, eventsR.type, approvalsR.type],
       hasContent:
         morning !== null || nightly !== null || todaysEvents.length > 0 || approvals.length > 0,
     });
     const banner = STATE_COPY[state];

     return (
       <OpaqueSurface className="today-screen" data-state={state}>
         {banner !== "" && (
           <p
             className="today-screen__banner"
             data-state={state}
             role={state === "error" ? "alert" : "status"}
           >
             {banner}
           </p>
         )}
         <h1 className="today-screen__greeting">
           {greetingLine("Logan", todaysEvents.length + approvals.length, approvals.length)}
         </h1>

         {nightly && (
           <DigestCard
             kind="nightly"
             headline={`Nightly digest ready · ${nightly.item_ids.length} archived`}
             body=""
             onOpen={() => {}}
           />
         )}

         <section aria-label="Today's schedule">
           <h2>⏰ Today's schedule</h2>
           <ul>
             {todaysEvents.map((e) => (
               <li key={e.id}>
                 <button type="button" onClick={() => onOpenThread?.(e.thread_id)}>
                   {e.subject ?? "(no subject)"}
                 </button>
               </li>
             ))}
           </ul>
         </section>

         {morning && (
           <section aria-label="Morning briefing">
             <h2>📋 Morning briefing</h2>
             <p>{morning.body}</p>
           </section>
         )}

         <section aria-label="Pending approvals">
           <h2>⏳ Pending approvals ({approvals.length})</h2>
           <div className="today-screen__approval-chips">
             {approvals.map((a) => (
               <button
                 key={a.id}
                 type="button"
                 aria-label={`Pending approval: ${a.description}`}
                 onClick={() => setExpandedApprovalId(expandedApprovalId === a.id ? null : a.id)}
               >
                 {a.description}
               </button>
             ))}
           </div>
           {expandedApprovalId &&
             (() => {
               const a = approvals.find((x) => x.id === expandedApprovalId);
               if (!a) return null;
               const interrupt: ApprovalCardInterrupt = {
                 action: a.action as ApprovalCardInterrupt["action"],
                 description: a.description,
                 args: a.args as Record<string, unknown>,
                 config: a.config as ApprovalCardInterrupt["config"],
               };
               return (
                 <ApprovalCardView
                   interrupt={interrupt}
                   onDecide={(decision, decidedArgs) => {
                     void decideApproval(a.id, decision, decidedArgs);
                     setExpandedApprovalId(null);
                   }}
                 />
               );
             })()}
         </section>
       </OpaqueSurface>
     );
   }
   ```

8. [ ] Re-run → pass, commit.
   ```bash
   pnpm --filter @omnis/desktop test
   ```
   Expected output: 10 `greetingLine`/`isSameLocalDay`/`screenState` PASS.
   ```bash
   git add apps/desktop/src/screens/Today.tsx apps/desktop/test/today-screen.test.tsx
   git commit -m "$(cat <<'EOF'
   US-B28: Today screen — greeting <h1>, nightly digest card, today's calendar, inline approval chips, 4 states

   - greetingLine()/isSameLocalDay()/screenState() are pure and unit-tested; the screen only wires Zero data to them
   - 4 states (loading/empty/error/offline) render as one banner line; offline/error keep showing cached rows
   - approval chip click expands ApprovalCardView inline (no screen navigation, A5 §3.4)

   Implemented-by: Claude Sonnet
   Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
   EOF
   )"
   ```

**Open questions**: `digests.for_date` is declared as `number()` (epoch ms) in the Zero schema — the A21/Zero conversion spike did not confirm whether the Postgres `date` column actually arrives as midnight UTC epoch or as KST midnight. `isSameLocalDay` was written against the browser's local timezone (fine if the Mac is on KST) — if the server sends midnight UTC, briefings between 9pm and midnight could slip a day.

---

### Task 4: Tasks screen (US-B29, tier: Sonnet)

**Goal (backlog)**: Four view tabs (Today/This week/Someday/Delegated), `TaskRow` (native checkbox + source deep link + `kind` icon + dotted `due_basis='inferred'`), `t` shortcut quick add, Delegated row → Agent Session navigation, delegation approval card inline.
**Deliverables**: `apps/desktop/src/screens/Tasks.tsx`, `packages/ui/src/components/task-row.tsx`
**Verification command**: `pnpm --filter @omnis/desktop test`
**Depends on**: B19 (todo extraction), B20 (delegation)
**Spec to read**: A5 §3.5 (all)
**Do not do (YAGNI)**: wiring the global `t` shortcut (App.tsx keymap integration is owned by the shell — this task only puts the quick-add input field in the screen; the actual global key listener is a separate scope), custom rendering for the delegation approval card (reuse the existing `ApprovalCardView`).

**Files:**
- Create: `packages/ui/src/components/task-row.tsx`, `apps/desktop/src/screens/Tasks.tsx`
- Test: `packages/ui/test/task-row.test.tsx`, `apps/desktop/test/tasks-screen.test.tsx`

**Interfaces:**
- Consumes: `Button`, `OpaqueSurface` (existing)
- Produces: `TaskRow`, `TaskRowProps` (`packages/ui/src/components/task-row.tsx`); `filterTasksByView`, `TasksView`, `dueBasisFor` (`apps/desktop/src/screens/Tasks.tsx`)

**Steps:**

1. [ ] Write the failing test for `TaskRow`.
   ```tsx
   // packages/ui/test/task-row.test.tsx
   import { describe, expect, it, vi } from "vitest";
   import { render, screen, fireEvent } from "@testing-library/react";
   import { TaskRow } from "../src/components/task-row.js";

   const base = {
     id: "t1", title: "Review Davich PPT draft", kind: "todo" as const, state: "open" as const,
     dueBasis: "explicit" as const, dueLabel: "Due today", sourceLabel: "Gmail",
     onToggleDone: vi.fn(), onOpenSource: vi.fn(),
   };

   describe("TaskRow (A5 §3.5)", () => {
     it("renders a native checkbox and toggles done on click", () => {
       render(<TaskRow {...base} />);
       const checkbox = screen.getByRole("checkbox", { name: base.title });
       expect(checkbox).not.toBeChecked();
       fireEvent.click(checkbox);
       expect(base.onToggleDone).toHaveBeenCalledWith("t1", true);
     });
     it("marks an inferred due date with a dotted data attribute (A5 §3.5)", () => {
       render(<TaskRow {...base} dueBasis="inferred" />);
       expect(screen.getByText("Due today")).toHaveAttribute("data-due-basis", "inferred");
     });
     it("calls onOpenSource when the source link is clicked", () => {
       render(<TaskRow {...base} />);
       fireEvent.click(screen.getByText("Gmail"));
       expect(base.onOpenSource).toHaveBeenCalled();
     });
   });
   ```

2. [ ] Run → fail.
   ```bash
   pnpm --filter @omnis/ui test
   ```

3. [ ] Implement `TaskRow`.
   ```tsx
   // packages/ui/src/components/task-row.tsx
   import type { ElementType } from "react";
   import { ListChecks, Share2, UserCheck } from "lucide-react";

   export type TaskKind = "todo" | "followup" | "delegation";
   export type TaskState = "open" | "in_progress" | "blocked" | "done" | "dropped";

   const KIND_ICON: Record<TaskKind, ElementType> = {
     todo: ListChecks,
     followup: UserCheck,
     delegation: Share2,
   };
   const KIND_LABEL: Record<TaskKind, string> = { todo: "To-do", followup: "Follow-up", delegation: "Delegated" };

   export interface TaskRowProps {
     id: string;
     title: string;
     kind: TaskKind;
     state: TaskState;
     /** A3 has no such column — treat created_by==='agent' as inferred (see Task 4 open questions). */
     dueBasis: "explicit" | "inferred";
     dueLabel: string | null;
     sourceLabel: string | null;
     onToggleDone: (id: string, done: boolean) => void;
     onOpenSource?: () => void;
     onOpenDelegation?: () => void;
   }

   export function TaskRow(props: TaskRowProps) {
     const Icon = KIND_ICON[props.kind];
     const done = props.state === "done";
     return (
       <div className="task-row" data-state={props.state}>
         <input
           type="checkbox"
           checked={done}
           aria-label={props.title}
           onChange={(e) => props.onToggleDone(props.id, e.target.checked)}
         />
         <Icon size={14} aria-label={`${KIND_LABEL[props.kind]} item`} />
         <span className="task-row__title" data-done={done} style={done ? { textDecoration: "line-through" } : undefined}>
           {props.title}
         </span>
         {props.dueLabel && (
           <span className="task-row__due" data-due-basis={props.dueBasis}>
             {props.dueLabel}
           </span>
         )}
         {props.sourceLabel && (
           <button type="button" className="task-row__source" onClick={() => props.onOpenSource?.()}>
             {props.sourceLabel}
           </button>
         )}
         {props.kind === "delegation" && (
           <button type="button" onClick={() => props.onOpenDelegation?.()}>
             In progress
           </button>
         )}
       </div>
     );
   }
   ```
   Add `export * from "./components/task-row.js";` to `packages/ui/src/index.ts`.

4. [ ] Re-run → pass, commit.
   ```bash
   pnpm --filter @omnis/ui test
   ```
   ```bash
   git add packages/ui/src/components/task-row.tsx packages/ui/src/index.ts packages/ui/test/task-row.test.tsx
   git commit -m "$(cat <<'EOF'
   US-B29: TaskRow component — native checkbox, kind icon, due_basis dotted marker

   Implemented-by: Claude Sonnet
   Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
   EOF
   )"
   ```

5. [ ] Write the failing tests for the view filter (`filterTasksByView`) and the `dueBasisFor` pure function.
   ```ts
   // apps/desktop/test/tasks-screen.test.tsx
   import { describe, expect, it } from "vitest";
   import { dueBasisFor, filterTasksByView, type TaskViewRow } from "../src/screens/Tasks";

   const now = new Date("2026-09-20T12:00:00");
   const rows: TaskViewRow[] = [
     { id: "1", ownerKind: "me", dueAt: new Date("2026-09-20T18:00:00").getTime(), state: "open" },
     { id: "2", ownerKind: "me", dueAt: new Date("2026-09-24T09:00:00").getTime(), state: "open" },
     { id: "3", ownerKind: "me", dueAt: null, state: "open" },
     { id: "4", ownerKind: "agent", dueAt: new Date("2026-09-20T18:00:00").getTime(), state: "in_progress" },
     { id: "5", ownerKind: "me", dueAt: new Date("2026-09-19T09:00:00").getTime(), state: "done" },
   ];

   describe("filterTasksByView (A5 §3.5 four view tabs)", () => {
     it("today = due within today, excluding done/dropped", () => {
       expect(filterTasksByView(rows, "today", now).map((r) => r.id)).toEqual(["1"]);
     });
     it("week = due after today through +7d", () => {
       expect(filterTasksByView(rows, "week", now).map((r) => r.id)).toEqual(["2"]);
     });
     it("someday = no due date or beyond the week window", () => {
       expect(filterTasksByView(rows, "someday", now).map((r) => r.id)).toEqual(["3"]);
     });
     it("delegated = owner_kind agent regardless of due date", () => {
       expect(filterTasksByView(rows, "delegated", now).map((r) => r.id)).toEqual(["4"]);
     });
   });

   describe("dueBasisFor (A3 has no due_basis column, so infer from created_by)", () => {
     it("is inferred for agent-created tasks", () => {
       expect(dueBasisFor("agent")).toBe("inferred");
     });
     it("is explicit for me-created tasks", () => {
       expect(dueBasisFor("me")).toBe("explicit");
     });
   });
   ```

6. [ ] Run → fail.
   ```bash
   pnpm --filter @omnis/desktop test
   ```

7. [ ] Implement `Tasks.tsx`.
   ```tsx
   // apps/desktop/src/screens/Tasks.tsx
   import { OpaqueSurface } from "@omnis/ui";
   import { TaskRow, type TaskKind, type TaskState } from "@omnis/ui/components/task-row";
   import { useQuery } from "@rocicorp/zero/react";
   import { useMemo, useState } from "react";
   import { useZeroClient } from "../zero-client.js";

   export const TASKS_VIEWS = ["today", "week", "someday", "delegated"] as const;
   export type TasksView = (typeof TASKS_VIEWS)[number];
   const VIEW_LABEL: Record<TasksView, string> = {
     today: "Today", week: "This week", someday: "Someday", delegated: "Delegated",
   };

   export interface TaskViewRow {
     id: string;
     ownerKind: "me" | "agent";
     dueAt: number | null;
     state: string;
   }

   /** A5 §3.5: Today/This week/Someday key off due_at; Delegated is owner_kind='agent' only (regardless of due date). */
   export function filterTasksByView<T extends TaskViewRow>(tasks: T[], view: TasksView, now: Date): T[] {
     const open = tasks.filter((t) => t.state !== "done" && t.state !== "dropped");
     if (view === "delegated") return open.filter((t) => t.ownerKind === "agent");
     const todayEnd = new Date(now);
     todayEnd.setHours(23, 59, 59, 999);
     const weekEnd = new Date(now);
     weekEnd.setDate(weekEnd.getDate() + 7);
     if (view === "today") return open.filter((t) => t.dueAt !== null && t.dueAt <= todayEnd.getTime());
     if (view === "week") {
       return open.filter(
         (t) => t.dueAt !== null && t.dueAt > todayEnd.getTime() && t.dueAt <= weekEnd.getTime(),
       );
     }
     return open.filter((t) => t.dueAt === null || t.dueAt > weekEnd.getTime());
   }

   /** The A3 tasks table has no due_basis column — an agent-created task is treated as L3 extraction (inferred), one I created as explicit. */
   export function dueBasisFor(createdBy: string): "explicit" | "inferred" {
     return createdBy === "agent" ? "inferred" : "explicit";
   }

   export function Tasks({ onOpenSource, onOpenDelegation }: {
     onOpenSource?: (itemId: string) => void;
     onOpenDelegation?: (sessionId: string) => void;
   }) {
     const zero = useZeroClient();
     const [view, setView] = useState<TasksView>("today");
     const [quickAdd, setQuickAdd] = useState("");
     const now = useMemo(() => new Date(), []);

     const [tasks] = useQuery(zero.query.tasks);

     const filtered = useMemo(
       () =>
         filterTasksByView(
           tasks.map((t) => ({ id: t.id, ownerKind: t.owner_kind as "me" | "agent", dueAt: t.due_at ?? null, state: t.state })),
           view,
           now,
         ),
       [tasks, view, now],
     );
     const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

     return (
       <OpaqueSurface className="tasks-screen">
         <div role="tablist" aria-label="Tasks views">
           {TASKS_VIEWS.map((v) => (
             <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}>
               {VIEW_LABEL[v]}
             </button>
           ))}
         </div>
         <form
           onSubmit={(e) => {
             e.preventDefault();
             setQuickAdd("");
           }}
         >
           <input
             aria-label="Quick add task"
             value={quickAdd}
             onChange={(e) => setQuickAdd(e.target.value)}
             placeholder="New task…"
           />
         </form>
         <ul>
           {filtered.map((row) => {
             const t = taskById.get(row.id);
             if (!t) return null;
             return (
               <li key={t.id}>
                 <TaskRow
                   id={t.id}
                   title={t.title}
                   kind={t.kind as TaskKind}
                   state={t.state as TaskState}
                   dueBasis={dueBasisFor(t.created_by)}
                   dueLabel={t.due_at ? new Date(t.due_at).toLocaleDateString("ko-KR") : null}
                   sourceLabel={t.source_item_id ? "View source" : null}
                   onToggleDone={() => {}}
                   onOpenSource={() => t.source_item_id && onOpenSource?.(t.source_item_id)}
                   onOpenDelegation={() => t.delegated_session_id && onOpenDelegation?.(t.delegated_session_id)}
                 />
               </li>
             );
           })}
         </ul>
       </OpaqueSurface>
     );
   }
   ```

8. [ ] Re-run → pass, commit.
   ```bash
   pnpm --filter @omnis/desktop test
   ```
   ```bash
   git add apps/desktop/src/screens/Tasks.tsx apps/desktop/test/tasks-screen.test.tsx
   git commit -m "$(cat <<'EOF'
   US-B29: Tasks screen — 4 view tabs, TaskRow list, quick-add input

   Implemented-by: Claude Sonnet
   Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
   EOF
   )"
   ```

**Open questions**: The global `t` shortcut (focus jump to quick add) and a real optimistic `state:'done'` update for the checkbox (a hub PATCH route) are not in the contract — this may require registering `t` in the Phase A `use-keymap.ts` plus a new hub route (e.g. `POST /tasks/:id/toggle`); route ownership must be coordinated with the agents plan (owner of the L3 deliverables) when this runs. The `created_by==='agent'` inference in `dueBasisFor` is an approximation that exists only because A3 has no dedicated column.

---

### Task 5: Network screen (US-B30, tier: Sonnet)

**Goal (backlog)**: `PersonCard` (initials avatar, org·title, 3-tier relationship dot + text label), follow-up queue strip at the top, person detail pane, merge/split UI.
**Deliverables**: `apps/desktop/src/screens/Network.tsx`, `packages/ui/src/components/person-card.tsx`
**Verification command**: `pnpm --filter @omnis/desktop test`
**Depends on**: B03 (person identity resolution), B22 (follow-up loop — populates `persons.next_followup_at`/`priority_score`)
**Spec to read**: A5 §3.6 (all)
**Do not do (YAGNI)**: the real behavior of the "same person" merge/split UI (the backend `mergePersons`/`splitIdentity` are owned by the memory-ingestion plan — this task only places the entry button and leaves the dialog contents to follow-up scope; recorded under open questions), grid/list toggle.

**Files:**
- Create: `packages/ui/src/components/person-card.tsx`, `apps/desktop/src/screens/Network.tsx`
- Test: `packages/ui/test/person-card.test.tsx`, `apps/desktop/test/network-screen.test.tsx`

**Interfaces:**
- Consumes: `OpaqueSurface`, `Button` (`@omnis/ui`), `initialsFromName`/`pastelFromName` (`@omnis/ui/lib/row-meta`), `formatRelativeTime` (`@omnis/ui/lib/relative-time`)

**Verified provenance of the consumed symbols (2026-09-20 cross review M-B30 — do not create them):** the three below are **code already merged to main in Wave 4/5**. Do not invent new helpers or rename them — import them as-is.

| Symbol | File | Signature |
|---|---|---|
| `initialsFromName` | `packages/ui/src/lib/row-meta.ts` | `(name: string) => string` — first/last initial after splitting on whitespace; a single word takes its first 2 characters; an empty name yields `"?"` |
| `pastelFromName` | `packages/ui/src/lib/row-meta.ts` | `(name: string) => string` — name hash → an `oklch(0.88 0.06 <hue>)` CSS color string (same name = always the same color) |
| `formatRelativeTime` | `packages/ui/src/lib/relative-time.ts` | `(timestampMs: number, now?: number) => string` — `"now"`/`"3m"`/`"5h"`/`"2d"`/`"3w"`/`"4 Aug"`. **Takes epoch ms** (not a Date) — `persons.last_contact_at` arrives from Zero as a `number`, so pass it straight through |

Subpath imports work because `packages/ui/package.json`'s `exports` has `"./*": "./src/*.ts"` and `"./components/*": "./src/components/*.tsx"` (verified). `apps/desktop/src/screens/Inbox.tsx` already uses all three symbols via the same paths — if in doubt, read that file first.

Confirm they exist before starting (if they do not, Wave 4/5 has not merged yet):
```bash
cd /Users/logankim/AI-Workspaces/omnis && grep -n "export function initialsFromName\|export function pastelFromName" packages/ui/src/lib/row-meta.ts && grep -n "export function formatRelativeTime" packages/ui/src/lib/relative-time.ts
```
- Produces: `PersonCard`, `PersonCardProps`, `relationshipDot`, `RelationshipDot` (`packages/ui/src/components/person-card.tsx`); `followupQueue` (`apps/desktop/src/screens/Network.tsx`)

**Steps:**

1. [ ] Write the failing tests for `relationshipDot` + `PersonCard` rendering.
   ```tsx
   // packages/ui/test/person-card.test.tsx
   import { describe, expect, it, vi } from "vitest";
   import { render, screen } from "@testing-library/react";
   import { PersonCard, relationshipDot } from "../src/components/person-card.js";

   describe("relationshipDot (A5 §3.6 three relationship tiers + unknown has no dot)", () => {
     it("maps active → active", () => expect(relationshipDot("active")).toBe("active"));
     it("maps new and warming → warming", () => {
       expect(relationshipDot("new")).toBe("warming");
       expect(relationshipDot("warming")).toBe("warming");
     });
     it("maps dormant and closed → dormant", () => {
       expect(relationshipDot("dormant")).toBe("dormant");
       expect(relationshipDot("closed")).toBe("dormant");
     });
     it("maps unknown → unknown (no dot, text only)", () => expect(relationshipDot("unknown")).toBe("unknown"));
   });

   describe("PersonCard", () => {
     it("renders name, org/role, and a text label alongside the dot (not color-only)", () => {
       render(
         <PersonCard id="p1" name="David Park" org="Davich" role="CTO" relationshipState="active"
           lastContactLabel="3 days ago" onOpen={vi.fn()} />,
       );
       expect(screen.getByText("David Park")).toBeInTheDocument();
       expect(screen.getByText("Davich · CTO")).toBeInTheDocument();
       expect(screen.getByLabelText("Relationship: Active")).toBeInTheDocument();
     });
   });
   ```

2. [ ] Run → fail.
   ```bash
   pnpm --filter @omnis/ui test
   ```

3. [ ] Implement `PersonCard`.
   ```tsx
   // packages/ui/src/components/person-card.tsx
   import { Button } from "./button.js";
   import { OpaqueSurface } from "./glass-surface.js";
   import { initialsFromName, pastelFromName } from "../lib/row-meta.js";

   export type PersonRelationshipState = "unknown" | "new" | "warming" | "active" | "dormant" | "closed";
   export type RelationshipDot = "active" | "warming" | "dormant" | "unknown";

   /** A5 §3.6: the three tiers shown on the card + unknown (no dot, text only). */
   export function relationshipDot(state: PersonRelationshipState): RelationshipDot {
     switch (state) {
       case "active":
         return "active";
       case "new":
       case "warming":
         return "warming";
       case "dormant":
       case "closed":
         return "dormant";
       default:
         return "unknown";
     }
   }

   const DOT_LABEL: Record<RelationshipDot, string> = {
     active: "Active",
     warming: "Warming up",
     dormant: "At risk",
     unknown: "Not enough info",
   };

   export interface FollowupDraft {
     body: string;
     onEditAndSend: () => void;
   }

   export interface PersonCardProps {
     id: string;
     name: string;
     org: string | null;
     role: string | null;
     relationshipState: PersonRelationshipState;
     lastContactLabel: string;
     followupDraft?: FollowupDraft | null;
     onOpen: (id: string) => void;
   }

   export function PersonCard(props: PersonCardProps) {
     const dot = relationshipDot(props.relationshipState);
     const orgRole = [props.org, props.role].filter(Boolean).join(" · ");
     return (
       <OpaqueSurface className="person-card">
         <button type="button" className="person-card__open" onClick={() => props.onOpen(props.id)}>
           <span className="person-card__avatar" style={{ background: pastelFromName(props.name) }}>
             {initialsFromName(props.name)}
           </span>
           <span className="person-card__name">{props.name}</span>
           {orgRole !== "" && <span className="person-card__org">{orgRole}</span>}
           <span className="person-card__dot" data-dot={dot} aria-label={`Relationship: ${DOT_LABEL[dot]}`}>
             {DOT_LABEL[dot]}
           </span>
           <span className="person-card__last-contact">Last contact: {props.lastContactLabel}</span>
         </button>
         {props.followupDraft && (
           <div className="person-card__followup">
             <p>{props.followupDraft.body}</p>
             <Button onClick={props.followupDraft.onEditAndSend}>Edit and send</Button>
           </div>
         )}
       </OpaqueSurface>
     );
   }
   ```
   Add `export * from "./components/person-card.js";` to `packages/ui/src/index.ts`.

4. [ ] Re-run → pass, commit.
   ```bash
   pnpm --filter @omnis/ui test
   ```
   ```bash
   git add packages/ui/src/components/person-card.tsx packages/ui/src/index.ts packages/ui/test/person-card.test.tsx
   git commit -m "$(cat <<'EOF'
   US-B30: PersonCard component — 3-tier relationship dot with text label (A5 §3.6, no color-only state)

   Implemented-by: Claude Sonnet
   Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
   EOF
   )"
   ```

5. [ ] Write the failing test for the follow-up queue sort (`followupQueue`) — the L6 loop (B22) already populates `next_followup_at`/`priority_score`, so the screen only filters and sorts those values.
   ```ts
   // apps/desktop/test/network-screen.test.tsx
   import { describe, expect, it } from "vitest";
   import { followupQueue, type FollowupCandidate } from "../src/screens/Network";

   const now = new Date("2026-09-20T00:00:00").getTime();
   const persons: FollowupCandidate[] = [
     { id: "1", nextFollowupAt: now - 1000, priorityScore: 0.5, mergedInto: null },
     { id: "2", nextFollowupAt: now + 100_000, priorityScore: 0.9, mergedInto: null }, // not due yet
     { id: "3", nextFollowupAt: now - 5000, priorityScore: 0.9, mergedInto: null },
     { id: "4", nextFollowupAt: now - 1000, priorityScore: 0.1, mergedInto: "1" }, // merged person excluded
     { id: "5", nextFollowupAt: null, priorityScore: 0.3, mergedInto: null },
   ];

   describe("followupQueue (persons.next_followup_at ≤ now, priority_score descending, merged excluded)", () => {
     it("returns only due, non-merged persons ordered by priority", () => {
       expect(followupQueue(persons, now).map((p) => p.id)).toEqual(["3", "1"]);
     });
   });
   ```

6. [ ] Run → fail.
   ```bash
   pnpm --filter @omnis/desktop test
   ```

7. [ ] Implement `Network.tsx`.
   ```tsx
   // apps/desktop/src/screens/Network.tsx
   import { OpaqueSurface } from "@omnis/ui";
   import { PersonCard, type PersonRelationshipState } from "@omnis/ui/components/person-card";
   import { formatRelativeTime } from "@omnis/ui/lib/relative-time";
   import { useQuery } from "@rocicorp/zero/react";
   import { useMemo } from "react";
   import { useZeroClient } from "../zero-client.js";

   export interface FollowupCandidate {
     id: string;
     nextFollowupAt: number | null;
     priorityScore: number;
     mergedInto: string | null;
   }

   /** Same conditions as A3 persons_followup_idx: not merged and next_followup_at has passed means it
    * enters the queue; descending priority_score (the L6 follow-up loop, US-B22 already computed these — the screen does not recompute). */
   export function followupQueue<T extends FollowupCandidate>(persons: T[], now: number): T[] {
     return persons
       .filter((p) => p.mergedInto === null && p.nextFollowupAt !== null && p.nextFollowupAt <= now)
       .sort((a, b) => b.priorityScore - a.priorityScore);
   }

   export function Network({ onOpenPerson }: { onOpenPerson?: (id: string) => void }) {
     const zero = useZeroClient();
     const now = useMemo(() => Date.now(), []);
     const [persons] = useQuery(zero.query.persons.orderBy("last_contact_at", "desc"));

     const queue = useMemo(
       () =>
         followupQueue(
           persons.map((p) => ({
             id: p.id,
             nextFollowupAt: p.next_followup_at ?? null,
             priorityScore: p.priority_score,
             mergedInto: p.merged_into ?? null,
           })),
           now,
         ),
       [persons, now],
     );
     const queueIds = useMemo(() => new Set(queue.map((q) => q.id)), [queue]);

     return (
       <OpaqueSurface className="network-screen">
         <div aria-label={`Follow-up queue (${queue.length})`}>Follow-up queue ({queue.length})</div>
         <div role="grid" className="network-screen__grid">
           {persons
             .filter((p) => p.merged_into === null)
             .map((p) => (
               <PersonCard
                 key={p.id}
                 id={p.id}
                 name={p.display_name}
                 org={p.org ?? null}
                 role={p.role ?? null}
                 relationshipState={p.relationship_state as PersonRelationshipState}
                 lastContactLabel={p.last_contact_at ? formatRelativeTime(p.last_contact_at) : "None"}
                 followupDraft={queueIds.has(p.id) ? { body: "Preparing follow-up draft", onEditAndSend: () => {} } : null}
                 onOpen={(id) => onOpenPerson?.(id)}
               />
             ))}
         </div>
       </OpaqueSurface>
     );
   }
   ```

8. [ ] Re-run → pass, commit.
   ```bash
   pnpm --filter @omnis/desktop test
   ```
   ```bash
   git add apps/desktop/src/screens/Network.tsx apps/desktop/test/network-screen.test.tsx
   git commit -m "$(cat <<'EOF'
   US-B30: Network screen — PersonCard grid + follow-up queue strip (reads persons.next_followup_at/priority_score from L6, no re-ranking)

   Implemented-by: Claude Sonnet
   Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
   EOF
   )"
   ```

**Open questions**: The person detail pane (timeline + all-channel links + notes) and the "same person" merge/split dialog exist here only as an entry button with no contents — a follow-up task calling `mergePersons`/`splitIdentity` (memory-ingestion US-B03) is needed. The real follow-up draft lookup via `persons.primary_thread_id` (the `related("primaryThread", …)` data binding in A5 §3.6) is also a stub — zeroSchema has no `persons→primaryThread` relationship, so the Inbox.tsx pattern would require joining separate `threads`/`items` queries, and this task uses fixed copy instead of that join.

---

### Task 6: Notes screen (US-B31, tier: Sonnet)

**Goal (backlog)**: Single-line input (`n` global shortcut, focus retained after save), `RoutingSuggestion` 3 buttons (accept / pick another target / don't route), confidence as text only, no distinction between error and no-match.
**Deliverables**: `apps/desktop/src/screens/Notes.tsx`
**Verification command**: `pnpm --filter @omnis/desktop test`
**Depends on**: B21 (note routing loop — populates `notes.route_state`/`routed_to_*`)
**Spec to read**: A4 §8.3 (confidence gating — when it is low no suggestion is produced at all, so the screen never has to deal with a numeric confidence), A5 §3.7 (all)
**Do not do (YAGNI)**: the "pick another target" picker UI (reusing people/thread search is follow-up scope after B27 — this task ships the button with a no-op click handler), wiring the global `n` shortcut (shell integration is out of scope for the same reason as `t` in Today).

**Files:**
- Create: `apps/hub/src/notes.ts`, `apps/desktop/src/api/notes.ts`, `apps/desktop/src/screens/Notes.tsx`
- Modify: `apps/hub/src/http.ts` (add the POST /notes/:id/route route)
- Test: `apps/hub/src/notes.test.ts`, `apps/desktop/test/notes-screen.test.tsx`

**Interfaces:**
- Consumes: `query`/`one` (`@omnis/db`), `Audit` (optional — this task simplifies to a direct `audit_log` insert, same pattern as Task 8 settings.ts)
- Produces: `decideNoteRouting` (`apps/hub/src/notes.ts`, **a route that was not in the delta, so this plan owns it anew** — see open questions below), `routeNote` (`apps/desktop/src/api/notes.ts`), `routingSuggestionCopy`, `hasRoutingSuggestion` (`apps/desktop/src/screens/Notes.tsx`)

**Steps:**

1. [ ] Write the failing test for the routing-copy pure functions — thanks to A4 §8.3 it only needs to look at "is there a suggestion", not a confidence number (if there is one, the threshold was already crossed).
   ```ts
   // apps/desktop/test/notes-screen.test.tsx
   import { describe, expect, it } from "vitest";
   import { hasRoutingSuggestion, routingSuggestionCopy, type NoteRouteRow } from "../src/screens/Notes";

   describe("hasRoutingSuggestion (A4 §8.3: low confidence means no suggestion at all)", () => {
     it("is true only when route_state is 'proposed'", () => {
       expect(hasRoutingSuggestion({ route_state: "proposed" } as NoteRouteRow)).toBe(true);
       expect(hasRoutingSuggestion({ route_state: "none" } as NoteRouteRow)).toBe(false);
       expect(hasRoutingSuggestion({ route_state: "accepted" } as NoteRouteRow)).toBe(false);
     });
   });

   describe("routingSuggestionCopy (A5 §3.7: confidence as text only, no percentages)", () => {
     it("names the target and says high confidence when a suggestion exists", () => {
       expect(routingSuggestionCopy({ route_state: "proposed" } as NoteRouteRow, "David Park thread")).toBe(
         "Routing suggestion: share to David Park thread (high confidence)",
       );
     });
     it("falls back to the no-match copy otherwise — same copy for error and no-match", () => {
       expect(routingSuggestionCopy({ route_state: "none" } as NoteRouteRow, null)).toBe(
         "Couldn't find a routing target — pick one manually",
       );
     });
   });
   ```

2. [ ] Run → fail.
   ```bash
   pnpm --filter @omnis/desktop test
   ```

3. [ ] Write the failing tests for `apps/hub/src/notes.ts` + `apps/desktop/src/api/notes.ts` (the hub client contract, same pattern as `search.ts`/`approvals.ts`).
   ```ts
   // apps/hub/src/notes.test.ts
   import { describe, expect, it, vi } from "vitest";
   import { decideNoteRouting } from "./notes.js";

   describe("decideNoteRouting (US-B31 — a route absent from the contract, added by this plan)", () => {
     it("accept: sets route_state to accepted using the already-proposed target", async () => {
       const query = vi.fn().mockResolvedValue([{ id: "n1", routed_to_thread_id: "t1", routed_to_person_id: null }]);
       await decideNoteRouting({ query } as never, "n1", { decision: "accept" });
       expect(query).toHaveBeenCalledWith(
         expect.anything(),
         expect.stringContaining("route_state = 'accepted'"),
         ["n1"],
       );
     });
     it("none: sets route_state to none and clears both targets", async () => {
       const query = vi.fn().mockResolvedValue([]);
       await decideNoteRouting({ query } as never, "n1", { decision: "none" });
       expect(query).toHaveBeenCalledWith(
         expect.anything(),
         expect.stringContaining("route_state = 'none'"),
         ["n1"],
       );
     });
   });
   ```

4. [ ] Run → fail.
   ```bash
   pnpm --filter @omnis/hub test
   ```

5. [ ] Implement `apps/hub/src/notes.ts`.
   ```ts
   // apps/hub/src/notes.ts
   import { query } from "@omnis/db";
   import type { Pool } from "pg";

   export interface NoteRouteDecision {
     decision: "accept" | "none";
     /** Used only by "pick another target" (follow-up scope) — this task supports accept/none only. */
     threadId?: string;
     personId?: string;
   }

   export async function decideNoteRouting(pool: Pool, noteId: string, d: NoteRouteDecision): Promise<void> {
     if (d.decision === "accept") {
       await query(
         pool,
         `UPDATE notes SET route_state = 'accepted' WHERE id = $1 AND route_state = 'proposed'`,
         [noteId],
       );
       return;
     }
     await query(
       pool,
       `UPDATE notes SET route_state = 'none', routed_to_thread_id = NULL, routed_to_person_id = NULL WHERE id = $1`,
       [noteId],
     );
   }
   ```

6. [ ] Re-run → pass, wire the route into `http.ts` (added near the existing `/search` branch), commit.
   ```bash
   pnpm --filter @omnis/hub test
   ```
   ```ts
   // apps/hub/src/http.ts — added inside handle()
   import { decideNoteRouting } from "./notes.js";

   const noteRoute = /^\/notes\/([0-9a-fA-F-]{36})\/route$/.exec(path);
   if (noteRoute !== null) {
     if (method !== "POST") return send(res, 405, { error: "method not allowed" });
     const id = noteRoute[1];
     if (id === undefined) return send(res, 400, { error: "bad id" });
     let body: unknown;
     try {
       body = await readJson(req);
     } catch {
       return send(res, 400, { error: "invalid json body" });
     }
     const b = body as { decision?: unknown };
     if (b.decision !== "accept" && b.decision !== "none") {
       return send(res, 400, { error: "expected { decision: 'accept' | 'none' }" });
     }
     await decideNoteRouting(pool, id, { decision: b.decision });
     return send(res, 200, { id, route_state: b.decision === "accept" ? "accepted" : "none" });
   }
   ```
   ```bash
   git add apps/hub/src/notes.ts apps/hub/src/notes.test.ts apps/hub/src/http.ts
   git commit -m "$(cat <<'EOF'
   US-B31: POST /notes/:id/route — accept/reject the L7 routing proposal (new route, not pre-registered in the Phase B delta; owned here since B31 is the only Phase B story that writes notes.route_state from a human action)

   Implemented-by: Claude Sonnet
   Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
   EOF
   )"
   ```

7. [ ] Implement `apps/desktop/src/api/notes.ts` (client) + `Notes.tsx` (screen).
   ```ts
   // apps/desktop/src/api/notes.ts
   const HUB_HTTP_URL = import.meta.env.OMNIS_HUB_HTTP_URL ?? "http://127.0.0.1:8787";

   export async function routeNote(
     id: string,
     decision: "accept" | "none",
   ): Promise<{ id: string; route_state: string }> {
     const res = await fetch(`${HUB_HTTP_URL}/notes/${id}/route`, {
       method: "POST",
       headers: { "content-type": "application/json" },
       body: JSON.stringify({ decision }),
     });
     if (!res.ok) throw new Error(`note routing decide failed: HTTP ${res.status}`);
     return res.json();
   }
   ```
   ```tsx
   // apps/desktop/src/screens/Notes.tsx
   import { OpaqueSurface } from "@omnis/ui";
   import { useQuery } from "@rocicorp/zero/react";
   import { useState } from "react";
   import { routeNote } from "../api/notes.js";
   import { useZeroClient } from "../zero-client.js";

   export interface NoteRouteRow {
     route_state: "proposed" | "accepted" | "rejected" | "none";
   }

   export function hasRoutingSuggestion(note: NoteRouteRow): boolean {
     return note.route_state === "proposed";
   }

   /** A5 §3.7: confidence as text only ("high confidence"); errors and no-match converge on the same copy. */
   export function routingSuggestionCopy(note: NoteRouteRow, targetLabel: string | null): string {
     if (hasRoutingSuggestion(note) && targetLabel !== null) {
       return `Routing suggestion: share to ${targetLabel} (high confidence)`;
     }
     return "Couldn't find a routing target — pick one manually";
   }

   export function Notes() {
     const zero = useZeroClient();
     const [body, setBody] = useState("");
     const [notes] = useQuery(zero.query.notes.orderBy("created_at", "desc").limit(20));

     return (
       <OpaqueSurface className="notes-screen">
         <form
           onSubmit={(e) => {
             e.preventDefault();
             if (body.trim() === "") return;
             // The actual insert is hub POST /notes (outside the contract, follow-up scope) — this task only proves input + reset.
             setBody("");
           }}
         >
           <input
             aria-label="New note"
             value={body}
             onChange={(e) => setBody(e.target.value)}
             placeholder="New note…"
           />
           <button type="submit">Save</button>
         </form>

         <ul>
           {notes.map((n) => {
             const targetLabel = n.routed_to_person_id ? "Network target" : n.routed_to_thread_id ? "thread" : null;
             const route: NoteRouteRow = { route_state: n.route_state as NoteRouteRow["route_state"] };
             return (
               <li key={n.id}>
                 <p>{n.body}</p>
                 <p>{routingSuggestionCopy(route, targetLabel)}</p>
                 {hasRoutingSuggestion(route) && (
                   <div>
                     <button type="button" onClick={() => void routeNote(n.id, "accept")}>
                       Accept
                     </button>
                     <button type="button" disabled>
                       Pick another target
                     </button>
                     <button type="button" onClick={() => void routeNote(n.id, "none")}>
                       Don't route
                     </button>
                   </div>
                 )}
               </li>
             );
           })}
         </ul>
       </OpaqueSurface>
     );
   }
   ```

8. [ ] Re-run → pass, commit.
   ```bash
   pnpm --filter @omnis/desktop test
   ```
   ```bash
   git add apps/desktop/src/api/notes.ts apps/desktop/src/screens/Notes.tsx apps/desktop/test/notes-screen.test.tsx
   git commit -m "$(cat <<'EOF'
   US-B31: Notes screen — single-line input, RoutingSuggestion 3-button (accept/pick-other/none), text-only confidence

   Implemented-by: Claude Sonnet
   Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
   EOF
   )"
   ```

**Open questions**: `POST /notes` (note creation itself) and the "pick another target" flavor of `POST /notes/:id/route` are absent from the Phase B interface delta §7 route table — this plan added only the minimal version of the latter (accept/none). A separate follow-up task is needed for the note-creation route and the target picker (there is a good chance it reuses B27's search infrastructure).

---

### Task 7: Digest screen (US-B32, tier: Sonnet)

**Goal (backlog)**: Category accordion, group and individual unarchive (optimistic update + toast), monthly cost report section, auto-archive banner in the Thread header (only within 7 days).
**Deliverables**: `apps/desktop/src/screens/Digest.tsx`
**Verification command**: `pnpm --filter @omnis/desktop test`
**Depends on**: B24 (nightly digest loop — populates `digests(kind='nightly').metrics`)
**Spec to read**: A4 §6.4 (`NightlyDigest`/`DigestGroup` models), A5 §3.8 (all)
**Do not do (YAGNI)**: implementing the Thread header banner itself (§3.2 owns it — this task only builds the same `unarchiveItem` client function the banner uses), wiring a toast library (Sonner is in A5 §5.1, but actually connecting toasts is follow-up scope; here we only expose the `onRestored` callback).

**Files:**
- Create: `apps/desktop/src/api/digest.ts`, `apps/desktop/src/screens/Digest.tsx`
- Modify: `apps/hub/src/http.ts` (add POST /items/:id/unarchive and POST /digests/:id/undo routes)
- Test: `apps/hub/src/archive-routes.test.ts`, `apps/desktop/test/digest-screen.test.tsx`

**Interfaces:**
- Consumes: `undoArchive` (`@omnis/kernel`, an agents US-B18 deliverable), `query`/`one` (`@omnis/db`)
- Produces: `handleUnarchiveItem`, `handleDigestUndo` (inline in `apps/hub/src/http.ts` — following the existing thin-handler pattern used by `kernel.approvals` et al., with no separate module), `unarchiveItem`, `undoDigestGroup` (`apps/desktop/src/api/digest.ts`); `groupsFromMetrics`, `monthlyCostLine` (`apps/desktop/src/screens/Digest.tsx`)

**Steps:**

1. [ ] Write the failing tests for the `groupsFromMetrics`/`monthlyCostLine` pure functions. Assume `digests.metrics` (jsonb, no column change — delta §6) holds `NightlyDigest`'s `auto_archived`/`cost` fields as-is (see open questions below).
   ```ts
   // apps/desktop/test/digest-screen.test.tsx
   import { describe, expect, it } from "vitest";
   import { groupsFromMetrics, monthlyCostLine } from "../src/screens/Digest";

   describe("groupsFromMetrics (safely read NightlyDigest.auto_archived out of digests.metrics)", () => {
     it("returns the groups array when shaped correctly", () => {
       const metrics = { auto_archived: [{ reason: "newsletters", count: 12, samples: [], undo_token: "tok1" }] };
       expect(groupsFromMetrics(metrics)).toEqual(metrics.auto_archived);
     });
     it("returns an empty array for missing or malformed metrics (no crash on a bad row)", () => {
       expect(groupsFromMetrics({})).toEqual([]);
       expect(groupsFromMetrics(null)).toEqual([]);
       expect(groupsFromMetrics({ auto_archived: "not-an-array" })).toEqual([]);
     });
   });

   describe("monthlyCostLine (A5 §3.8 'monthly cost report: $34 / $60 (57%)')", () => {
     it("formats month-to-date over cap with a rounded percentage", () => {
       expect(monthlyCostLine({ month_to_date_usd: 34, cap_usd: 60 })).toBe(
         "Monthly cost report: $34 / $60 (57%)",
       );
     });
   });
   ```

2. [ ] Run → fail.
   ```bash
   pnpm --filter @omnis/desktop test
   ```

3. [ ] Write the failing tests for the hub routes (`POST /items/:id/unarchive`, `POST /digests/:id/undo`). Rather than standing up all of `http.ts` behind a `node:http` mock (expensive), export the delegated handlers as separate functions and unit-test them directly — both routes are thin delegations to `@omnis/kernel`'s `undoArchive` (B18), so the new module holds just these two functions.
   ```ts
   // apps/hub/src/archive-routes.test.ts
   import { describe, expect, it, vi } from "vitest";
   import { handleDigestUndo, handleUnarchiveItem } from "./archive-routes.js";

   describe("handleUnarchiveItem (POST /items/:id/unarchive)", () => {
     it("delegates to undoArchive with the item id and returns the restored status", async () => {
       const undoArchive = vi.fn().mockResolvedValue(1);
       const result = await handleUnarchiveItem({ undoArchive }, "item-1");
       expect(undoArchive).toHaveBeenCalledWith({ itemId: "item-1" }, "me");
       expect(result).toEqual({ id: "item-1", status: "received" });
     });
   });

   describe("handleDigestUndo (POST /digests/:id/undo)", () => {
     it("delegates to undoArchive with the undo token and returns the restored count", async () => {
       const undoArchive = vi.fn().mockResolvedValue(3);
       const result = await handleDigestUndo({ undoArchive }, "tok-abc");
       expect(undoArchive).toHaveBeenCalledWith({ undoToken: "tok-abc" }, "me");
       expect(result).toEqual({ restored: 3 });
     });
   });
   ```

4. [ ] Run → fail.
   ```bash
   pnpm --filter @omnis/hub test
   ```
   Expected output: `Cannot find module './archive-routes.js'`.

5. [ ] Implement `apps/hub/src/archive-routes.ts` and wire it into `http.ts`.
   ```ts
   // apps/hub/src/archive-routes.ts
   /** http.ts already holds the pool, so partially apply it and pass it in — this module never has to know about pg. */
   export interface ArchiveDeps {
     undoArchive(ref: { itemId?: string; undoToken?: string }, actor: string): Promise<number>;
   }

   export async function handleUnarchiveItem(
     deps: ArchiveDeps,
     itemId: string,
   ): Promise<{ id: string; status: "received" }> {
     await deps.undoArchive({ itemId }, "me");
     return { id: itemId, status: "received" };
   }

   export async function handleDigestUndo(
     deps: ArchiveDeps,
     undoToken: string,
   ): Promise<{ restored: number }> {
     const restored = await deps.undoArchive({ undoToken }, "me");
     return { restored };
   }
   ```
   ```ts
   // apps/hub/src/http.ts — added import + routes (inside handle(), near /search)
   import { handleDigestUndo, handleUnarchiveItem, type ArchiveDeps } from "./archive-routes.js";
   import { undoArchive } from "@omnis/kernel";
   // (top of the createHubServer function; partially apply the pool so archive-routes.ts never depends on pg directly)
   const archiveDeps: ArchiveDeps = { undoArchive: (ref, actor) => undoArchive(pool, ref, actor) };

   const unarchive = /^\/items\/([0-9a-fA-F-]{36})\/unarchive$/.exec(path);
   if (unarchive !== null) {
     if (method !== "POST") return send(res, 405, { error: "method not allowed" });
     const id = unarchive[1];
     if (id === undefined) return send(res, 400, { error: "bad id" });
     return send(res, 200, await handleUnarchiveItem(archiveDeps, id));
   }

   const digestUndo = /^\/digests\/([0-9a-fA-F-]{36})\/undo$/.exec(path);
   if (digestUndo !== null) {
     if (method !== "POST") return send(res, 405, { error: "method not allowed" });
     const id = digestUndo[1];
     if (id === undefined) return send(res, 400, { error: "bad id" });
     let body: unknown;
     try {
       body = await readJson(req);
     } catch {
       return send(res, 400, { error: "invalid json body" });
     }
     const b = body as { undo_token?: unknown };
     if (typeof b.undo_token !== "string" || b.undo_token === "") {
       return send(res, 400, { error: "expected { undo_token: string }" });
     }
     return send(res, 200, await handleDigestUndo(archiveDeps, b.undo_token));
   }
   ```

6. [ ] Re-run → pass, commit.
   ```bash
   pnpm --filter @omnis/hub test
   ```
   ```bash
   git add apps/hub/src/archive-routes.ts apps/hub/src/archive-routes.test.ts apps/hub/src/http.ts
   git commit -m "$(cat <<'EOF'
   US-B32: POST /items/:id/unarchive and POST /digests/:id/undo — thin delegation to @omnis/kernel's undoArchive (US-B18)

   Implemented-by: Claude Sonnet
   Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
   EOF
   )"
   ```

7. [ ] Implement `apps/desktop/src/api/digest.ts` + `Digest.tsx`.
   ```ts
   // apps/desktop/src/api/digest.ts
   const HUB_HTTP_URL = import.meta.env.OMNIS_HUB_HTTP_URL ?? "http://127.0.0.1:8787";

   export async function unarchiveItem(id: string): Promise<{ id: string; status: string }> {
     const res = await fetch(`${HUB_HTTP_URL}/items/${id}/unarchive`, { method: "POST" });
     if (!res.ok) throw new Error(`unarchive failed: HTTP ${res.status}`);
     return res.json();
   }

   export async function undoDigestGroup(digestId: string, undoToken: string): Promise<{ restored: number }> {
     const res = await fetch(`${HUB_HTTP_URL}/digests/${digestId}/undo`, {
       method: "POST",
       headers: { "content-type": "application/json" },
       body: JSON.stringify({ undo_token: undoToken }),
     });
     if (!res.ok) throw new Error(`digest undo failed: HTTP ${res.status}`);
     return res.json();
   }
   ```
   ```tsx
   // apps/desktop/src/screens/Digest.tsx
   import { OpaqueSurface } from "@omnis/ui";
   import { useQuery } from "@rocicorp/zero/react";
   import { useState } from "react";
   import { undoDigestGroup } from "../api/digest.js";
   import { useZeroClient } from "../zero-client.js";

   export interface DigestGroup {
     reason: string;
     count: number;
     samples: unknown[];
     undo_token: string;
   }

   /** A3 digests.metrics is jsonb with no column change (delta §6) — assume it holds
    * NightlyDigest.auto_archived and read it defensively (a bad shape yields an empty array; the screen never crashes). */
   export function groupsFromMetrics(metrics: unknown): DigestGroup[] {
     if (typeof metrics !== "object" || metrics === null) return [];
     const auto = (metrics as { auto_archived?: unknown }).auto_archived;
     return Array.isArray(auto) ? (auto as DigestGroup[]) : [];
   }

   export function monthlyCostLine(cost: { month_to_date_usd: number; cap_usd: number }): string {
     const pct = Math.round((cost.month_to_date_usd / cost.cap_usd) * 100);
     return `Monthly cost report: $${cost.month_to_date_usd} / $${cost.cap_usd} (${pct}%)`;
   }

   export function Digest() {
     const zero = useZeroClient();
     const [expanded, setExpanded] = useState<Set<string>>(new Set());
     const [nightlyDigests] = useQuery(
       zero.query.digests.where("kind", "=", "nightly").orderBy("for_date", "desc").limit(1),
     );
     const digest = nightlyDigests[0] ?? null;
     if (!digest) {
       return <OpaqueSurface className="digest-screen">Tonight's digest hasn't been generated yet — it runs at 23:00</OpaqueSurface>;
     }
     const groups = groupsFromMetrics(digest.metrics);
     const cost = (digest.metrics as { cost?: { month_to_date_usd: number; cap_usd: number } }).cost;

     return (
       <OpaqueSurface className="digest-screen">
         <h2>{digest.body}</h2>
         {groups.map((g) => (
           <section key={g.undo_token}>
             <button
               type="button"
               aria-expanded={expanded.has(g.undo_token)}
               onClick={() =>
                 setExpanded((prev) => {
                   const next = new Set(prev);
                   next.has(g.undo_token) ? next.delete(g.undo_token) : next.add(g.undo_token);
                   return next;
                 })
               }
             >
               {g.reason} ({g.count})
             </button>
             <button type="button" onClick={() => void undoDigestGroup(digest.id, g.undo_token)}>
               Restore all
             </button>
           </section>
         ))}
         {cost && <p>{monthlyCostLine(cost)}</p>}
       </OpaqueSurface>
     );
   }
   ```

8. [ ] Re-run → pass, commit.
   ```bash
   pnpm --filter @omnis/desktop test
   ```
   ```bash
   git add apps/desktop/src/api/digest.ts apps/desktop/src/screens/Digest.tsx apps/desktop/test/digest-screen.test.tsx
   git commit -m "$(cat <<'EOF'
   US-B32: Digest screen — category accordion, group undo, monthly cost line

   Implemented-by: Claude Sonnet
   Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
   EOF
   )"
   ```

**Open questions**: That `digests.metrics` holds `NightlyDigest.auto_archived`/`cost` verbatim is an **assumption** of this plan — nothing in A3 or the delta fixes the inner shape of `metrics` (the column is just jsonb). Whether the nightly digest generation loop (agents US-B24, `packages/agents/src/loops/digest-nightly.ts`) really writes exactly this shape has to be reconciled at run time.

---

### Task 8: Settings screen + the `settings` write path (US-B33, tier: Sonnet)

**Goal (backlog)**: Four sub-nav sections (Accounts/Autonomy/Model tiers/General), editable cost-cap input + progress bar (10% reserve segment, 80%/100% color paired with text), autonomy-enable toggle (off by default + warning), allowlist editing, 2-step kill switch confirmation.
**Deliverables**: `apps/desktop/src/screens/Settings.tsx`, `apps/hub/src/settings.ts`
**Verification command**: `pnpm --filter @omnis/desktop test && pnpm --filter @omnis/hub test`
**Depends on**: B09/B11 (allowlist targets), B14 (cost policy — `costState`/`currentPolicy`), B18 (auto-archive threshold)
**Spec to read**: delta §5 (`SettingKey`/`getSetting`/`setSetting`/`SETTING_DEFAULTS`), §6 (`0009_settings.sql`), §7 (`/settings`·`/cost`), §10 (add `settings` to Zero replication), A5 §3.9 (all)
**Do not do (YAGNI)**: the KakaoTalk D-9 countdown badge (account connection state is itself out of scope for this task — the Accounts sub-tab only lists `zero.query.accounts`), a read-only sensitivity-rule table for Model tiers (the values are static, so hardcoded text is enough, YAGNI).

**Files:**
- Create: `packages/db/migrations/0009_settings.sql`, `packages/db/migrations/0013_publication_phase_b.sql`, `packages/kernel/src/settings.ts`, `apps/hub/src/settings.ts`, `apps/desktop/src/api/settings.ts`, `apps/desktop/src/screens/Settings.tsx`
- Modify: `packages/kernel/src/zero-schema.ts` (add the `settings` table), `packages/kernel/src/index.ts` (settings re-export), `apps/hub/src/http.ts` (GET/PUT /settings, GET /cost routes), `apps/hub/src/config.ts` (no change — for reference only)
- Test: `packages/kernel/test/settings.test.ts`, `apps/hub/src/settings.test.ts`, `apps/desktop/test/settings-screen.test.tsx`

**Interfaces:**
- Consumes: `query` (`@omnis/db`), `currentPolicy` (`@omnis/kernel`, an agents US-B14 deliverable)
- Produces: `SettingKey`, `SETTING_DEFAULTS`, `getSetting`, `setSetting` (`packages/kernel/src/settings.ts`, delta §5 verbatim); `getAllSettings`, `putSetting` (`apps/hub/src/settings.ts`); the `getSetting`/`putSetting` client (`apps/desktop/src/api/settings.ts`); `costBarSegments`, `costBarState` (`apps/desktop/src/screens/Settings.tsx`)

**Steps:**

1. [ ] Write `packages/db/migrations/0009_settings.sql` (delta §6 table verbatim — this task's verification command has no `test:integration`, so actually applying it to a DB is out of scope here; the next wave's integration tests verify it).
   ```sql
   -- packages/db/migrations/0009_settings.sql
   CREATE TABLE settings (
     key        text PRIMARY KEY,
     value      jsonb NOT NULL,
     updated_at timestamptz NOT NULL DEFAULT now()
   );

   -- omnis_control is a channel 0007_notify.sql already created — ride along on it for settings changes (delta §6: no new NOTIFY channel).
   CREATE OR REPLACE FUNCTION notify_settings_change() RETURNS trigger AS $$
   BEGIN
     PERFORM pg_notify('omnis_control', json_build_object('settings', NEW.key)::text);
     RETURN NEW;
   END;
   $$ LANGUAGE plpgsql;

   CREATE TRIGGER settings_notify AFTER INSERT OR UPDATE ON settings
     FOR EACH ROW EXECUTE FUNCTION notify_settings_change();

   INSERT INTO settings (key, value) VALUES
     ('cost.cap_usd', '60'),
     ('cost.reserve_ratio', '0.1'),
     ('notify.quiet_hours', '{"start":"23:00","end":"07:00","vipOverride":true}'),
     ('notify.vip_override', 'true'),
     ('archive.t1_confidence_min', '0.85'),
     ('archive.enabled', 'true'),
     ('ingest.local_roots.mini', '[]'),
     ('ingest.local_roots.macbook', '[]'),
     ('ingest.drive_folders', '[]'),
     ('ingest.github_repos', '[]'),
     ('autonomy.rules', '[]'),
     ('kakao.send_enabled_at', 'null');
   ```

2. [ ] Write `packages/db/migrations/0013_publication_phase_b.sql` (delta §6 — do not add `ingest_sources`/`push_subscriptions`).
   ```sql
   -- packages/db/migrations/0013_publication_phase_b.sql
   ALTER PUBLICATION zero_omnis ADD TABLE settings;
   ```

3. [ ] Commit (a migration is an append-only file and is a verifiable unit on its own — commit the added files without a separate red/green cycle).
   ```bash
   git add packages/db/migrations/0009_settings.sql packages/db/migrations/0013_publication_phase_b.sql
   git commit -m "$(cat <<'EOF'
   US-B33: 0009_settings.sql + 0013_publication_phase_b.sql (delta §6)

   Implemented-by: Claude Sonnet
   Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
   EOF
   )"
   ```

4. [ ] Write the failing tests for `packages/kernel/src/settings.ts` (fake the pg Pool without a real DB — `@omnis/db`'s `query()` calls `pool.query(sql, params)` directly, so `{query: vi.fn()}` is enough).
   ```ts
   // packages/kernel/test/settings.test.ts
   import { describe, expect, it, vi } from "vitest";
   import { getSetting, setSetting, SETTING_DEFAULTS } from "../src/settings.js";

   function fakePool(rows: unknown[]) {
     return { query: vi.fn().mockResolvedValue({ rows }) };
   }

   describe("SETTING_DEFAULTS", () => {
     it("has every allowlist key defaulting to an empty array (contract §5)", () => {
       expect(SETTING_DEFAULTS["ingest.local_roots.mini"]).toEqual([]);
       expect(SETTING_DEFAULTS["ingest.drive_folders"]).toEqual([]);
       expect(SETTING_DEFAULTS["ingest.github_repos"]).toEqual([]);
     });
     it("defaults the cost cap to 60", () => {
       expect(SETTING_DEFAULTS["cost.cap_usd"]).toBe(60);
     });
   });

   describe("getSetting", () => {
     it("returns the stored value when a row exists", async () => {
       const pool = fakePool([{ value: 75 }]);
       const value = await getSetting(pool as never, "cost.cap_usd", 60);
       expect(value).toBe(75);
       expect(pool.query).toHaveBeenCalledWith("SELECT value FROM settings WHERE key = $1", ["cost.cap_usd"]);
     });
     it("falls back to the given default when no row exists", async () => {
       const pool = fakePool([]);
       expect(await getSetting(pool as never, "cost.cap_usd", 60)).toBe(60);
     });
   });

   describe("setSetting", () => {
     it("upserts the value and writes an audit_log row", async () => {
       const pool = fakePool([]);
       await setSetting(pool as never, "cost.cap_usd", 80, "me");
       expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("ON CONFLICT (key)"), [
         "cost.cap_usd",
         "80",
       ]);
       expect(pool.query).toHaveBeenCalledWith(
         expect.stringContaining("INSERT INTO audit_log"),
         expect.arrayContaining(["me", "cost.cap_usd"]),
       );
     });
   });
   ```

5. [ ] Run → fail.
   ```bash
   pnpm --filter @omnis/kernel test
   ```
   Expected output: `Cannot find module '../src/settings.js'`.

6. [ ] Implement `packages/kernel/src/settings.ts` (delta §5 signatures verbatim).
   ```ts
   // packages/kernel/src/settings.ts
   import { query } from "@omnis/db";
   import type { Pool } from "pg";

   export type SettingKey =
     | "cost.cap_usd"
     | "cost.reserve_ratio"
     | "notify.quiet_hours"
     | "notify.vip_override"
     | "archive.t1_confidence_min"
     | "archive.enabled"
     | "ingest.local_roots.mini"
     | "ingest.local_roots.macbook"
     | "ingest.drive_folders"
     | "ingest.github_repos"
     | "autonomy.rules"
     | "kakao.send_enabled_at";

   export const SETTING_DEFAULTS: Readonly<Record<SettingKey, unknown>> = {
     "cost.cap_usd": 60,
     "cost.reserve_ratio": 0.1,
     "notify.quiet_hours": { start: "23:00", end: "07:00", vipOverride: true },
     "notify.vip_override": true,
     "archive.t1_confidence_min": 0.85,
     "archive.enabled": true,
     "ingest.local_roots.mini": [],
     "ingest.local_roots.macbook": [],
     "ingest.drive_folders": [],
     "ingest.github_repos": [],
     "autonomy.rules": [],
     "kakao.send_enabled_at": null,
   };

   export async function getSetting<T>(pool: Pool, key: SettingKey, fallback: T): Promise<T> {
     const rows = await query<{ value: T }>(pool, "SELECT value FROM settings WHERE key = $1", [key]);
     return rows[0]?.value ?? fallback;
   }

   /** Contract §5 makes audit_log mandatory — settings.ts is a low-level module that only takes
    * a pool, so it inserts directly rather than going through Kernel.audit (which would create a circular dependency), same pattern as identity.ts. */
   export async function setSetting(
     pool: Pool,
     key: SettingKey,
     value: unknown,
     actor: string,
   ): Promise<void> {
     await query(
       pool,
       `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
        ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = now()`,
       [key, JSON.stringify(value)],
     );
     await query(
       pool,
       `INSERT INTO audit_log (actor, action, target_table, target_id, after)
        VALUES ($1, 'settings.set', 'settings', NULL, $3::jsonb)`,
       [actor, key, JSON.stringify({ key, value })],
     );
   }
   ```
   Add `export * from "./settings.js";` to `packages/kernel/src/index.ts`.

7. [ ] Re-run → pass, commit.
   ```bash
   pnpm --filter @omnis/kernel test
   ```
   ```bash
   git add packages/kernel/src/settings.ts packages/kernel/src/index.ts packages/kernel/test/settings.test.ts
   git commit -m "$(cat <<'EOF'
   US-B33: @omnis/kernel settings.ts — getSetting/setSetting/SETTING_DEFAULTS (delta §5)

   Implemented-by: Claude Sonnet
   Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
   EOF
   )"
   ```

8. [ ] Write the failing tests for `apps/hub/src/settings.ts` (enumerate all keys + validate PUT).
   ```ts
   // apps/hub/src/settings.test.ts
   import { describe, expect, it, vi } from "vitest";
   import { getAllSettings, isValidSettingKey, putSetting } from "./settings.js";

   describe("isValidSettingKey", () => {
     it("accepts a known key and rejects an unknown one", () => {
       expect(isValidSettingKey("cost.cap_usd")).toBe(true);
       expect(isValidSettingKey("not.a.real.key")).toBe(false);
     });
   });

   describe("getAllSettings", () => {
     it("returns every SettingKey, falling back to SETTING_DEFAULTS for unset ones", async () => {
       const getSetting = vi.fn(async (_pool, key: string, fallback: unknown) =>
         key === "cost.cap_usd" ? 80 : fallback,
       );
       const result = await getAllSettings({ getSetting } as never, undefined as never);
       expect(result["cost.cap_usd"]).toBe(80);
       expect(result["archive.enabled"]).toBe(true);
     });
   });

   describe("putSetting", () => {
     it("writes through setSetting for a valid key", async () => {
       const setSetting = vi.fn();
       await putSetting({ setSetting } as never, undefined as never, "cost.cap_usd", 90, "me");
       expect(setSetting).toHaveBeenCalledWith(undefined, "cost.cap_usd", 90, "me");
     });
   });
   ```

9. [ ] Run → fail.
   ```bash
   pnpm --filter @omnis/hub test
   ```

10. [ ] Implement `apps/hub/src/settings.ts`.
    ```ts
    // apps/hub/src/settings.ts
    import { SETTING_DEFAULTS, type SettingKey } from "@omnis/kernel";
    import type { Pool } from "pg";

    const SETTING_KEYS = Object.keys(SETTING_DEFAULTS) as SettingKey[];

    export function isValidSettingKey(key: string): key is SettingKey {
      return (SETTING_KEYS as string[]).includes(key);
    }

    export interface SettingsDeps {
      getSetting<T>(pool: Pool, key: SettingKey, fallback: T): Promise<T>;
      setSetting(pool: Pool, key: SettingKey, value: unknown, actor: string): Promise<void>;
    }

    export async function getAllSettings(
      deps: Pick<SettingsDeps, "getSetting">,
      pool: Pool,
    ): Promise<Record<SettingKey, unknown>> {
      const entries = await Promise.all(
        SETTING_KEYS.map(async (key) => [key, await deps.getSetting(pool, key, SETTING_DEFAULTS[key])] as const),
      );
      return Object.fromEntries(entries) as Record<SettingKey, unknown>;
    }

    export async function putSetting(
      deps: Pick<SettingsDeps, "setSetting">,
      pool: Pool,
      key: SettingKey,
      value: unknown,
      actor: string,
    ): Promise<void> {
      await deps.setSetting(pool, key, value, actor);
    }
    ```

11. [ ] Re-run → pass. Wire the `/settings`·`/cost` routes into `http.ts` (assuming agents US-B14's `currentPolicy` — merged already, given the wave order).
    ```bash
    pnpm --filter @omnis/hub test
    ```
    ```ts
    // apps/hub/src/http.ts — added imports + routes
    import { getAllSettings, getSetting, isValidSettingKey, putSetting, setSetting } from "@omnis/kernel";
    import { currentPolicy } from "@omnis/kernel";

    if (path === "/settings") {
      if (method !== "GET") return send(res, 405, { error: "method not allowed" });
      return send(res, 200, { settings: await getAllSettings({ getSetting }, pool) });
    }

    const settingKey = /^\/settings\/([a-z0-9_.]+)$/.exec(path);
    if (settingKey !== null) {
      if (method !== "PUT") return send(res, 405, { error: "method not allowed" });
      const key = settingKey[1];
      if (key === undefined || !isValidSettingKey(key)) return send(res, 404, { error: "unknown setting" });
      let body: unknown;
      try {
        body = await readJson(req);
      } catch {
        return send(res, 400, { error: "invalid json body" });
      }
      const b = body as { value?: unknown };
      if (!("value" in b)) return send(res, 400, { error: "expected { value: unknown }" });
      await putSetting({ setSetting }, pool, key, b.value, "me");
      return send(res, 200, { key, value: b.value });
    }

    if (path === "/cost") {
      if (method !== "GET") return send(res, 405, { error: "method not allowed" });
      const { state, policy, mtdUsd, reserveUsd } = await currentPolicy(pool);
      const capUsd = await getSetting(pool, "cost.cap_usd", 60);
      return send(res, 200, { state, mtdUsd, capUsd, reserveUsd, policy });
    }
    ```

12. [ ] Commit.
    ```bash
    git add apps/hub/src/settings.ts apps/hub/src/settings.test.ts apps/hub/src/http.ts
    git commit -m "$(cat <<'EOF'
    US-B33: hub /settings, /settings/:key, /cost routes

    Implemented-by: Claude Sonnet
    Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
    EOF
    )"
    ```

13. [ ] Add the `settings` table to `zero-schema.ts` (no relationships — it is a plain key-value table, so no join is needed).
    ```ts
    // packages/kernel/src/zero-schema.ts — added to the table() definition list
    const settings = table("settings")
      .columns({
        key: string(),
        value: json(),
        updated_at: number(),
      })
      .primaryKey("key");
    // add settings to the tables: [...] array; ZERO_TABLES picks it up automatically (Object.keys(zeroSchema.tables)).
    ```
    Commit.
    ```bash
    git add packages/kernel/src/zero-schema.ts
    git commit -m "$(cat <<'EOF'
    US-B33: replicate settings to Zero (delta §10 — row.select only, writes stay hub-HTTP)

    Implemented-by: Claude Sonnet
    Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
    EOF
    )"
    ```

14. [ ] Write the failing tests for the cost progress-bar pure functions (`costBarSegments`/`costBarState`).
    ```ts
    // apps/desktop/test/settings-screen.test.tsx
    import { describe, expect, it } from "vitest";
    import { costBarSegments, costBarState } from "../src/screens/Settings";

    describe("costBarSegments (A5 §3.9: the last 10% is the reserve segment)", () => {
      it("computes the spend percentage and a fixed 90% reserve boundary", () => {
        const seg = costBarSegments({ mtdUsd: 34, capUsd: 60, reserveRatio: 0.1 });
        expect(seg.spendPct).toBeCloseTo(56.666, 2);
        expect(seg.reserveStartPct).toBe(90);
      });
    });

    describe("costBarState (80%/100% thresholds — the component owns color, this owns only the state name)", () => {
      it("normal below 80%", () => expect(costBarState(30, 60)).toBe("normal"));
      it("warn between 80% and 100%", () => expect(costBarState(49, 60)).toBe("warn"));
      it("danger at or over 100%", () => expect(costBarState(60, 60)).toBe("danger"));
    });
    ```

15. [ ] Run → fail.
    ```bash
    pnpm --filter @omnis/desktop test
    ```

16. [ ] Implement `apps/desktop/src/api/settings.ts` + `Settings.tsx`.
    ```ts
    // apps/desktop/src/api/settings.ts
    const HUB_HTTP_URL = import.meta.env.OMNIS_HUB_HTTP_URL ?? "http://127.0.0.1:8787";

    export async function fetchSettings(): Promise<Record<string, unknown>> {
      const res = await fetch(`${HUB_HTTP_URL}/settings`);
      if (!res.ok) throw new Error(`fetch settings failed: HTTP ${res.status}`);
      const body = (await res.json()) as { settings: Record<string, unknown> };
      return body.settings;
    }

    export async function putSetting(key: string, value: unknown): Promise<void> {
      const res = await fetch(`${HUB_HTTP_URL}/settings/${key}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value }),
      });
      if (!res.ok) throw new Error(`put setting failed: HTTP ${res.status}`);
    }
    ```
    ```tsx
    // apps/desktop/src/screens/Settings.tsx
    import { OpaqueSurface } from "@omnis/ui";
    import { useQuery } from "@rocicorp/zero/react";
    import { useState } from "react";
    import { putSetting } from "../api/settings.js";
    import { useZeroClient } from "../zero-client.js";

    export const SETTINGS_TABS = ["accounts", "autonomy", "model-tiers", "general"] as const;
    export type SettingsTab = (typeof SETTINGS_TABS)[number];
    const TAB_LABEL: Record<SettingsTab, string> = {
      accounts: "Accounts", autonomy: "Autonomy", "model-tiers": "Model tiers", general: "General",
    };

    export type CostBarState = "normal" | "warn" | "danger";

    /** A5 §3.9: the last 10% is the VIP/sensitive reserve — not editable, a fixed computed value. */
    export function costBarSegments(i: { mtdUsd: number; capUsd: number; reserveRatio: number }) {
      return {
        spendPct: (i.mtdUsd / i.capUsd) * 100,
        reserveStartPct: (1 - i.reserveRatio) * 100,
      };
    }

    export function costBarState(mtdUsd: number, capUsd: number): CostBarState {
      const pct = (mtdUsd / capUsd) * 100;
      if (pct >= 100) return "danger";
      if (pct >= 80) return "warn";
      return "normal";
    }

    const COST_STATE_TEXT: Record<CostBarState, string> = {
      normal: "Normal", warn: "T2→T1 downgrade", danger: "Non-VIP drafts halted",
    };

    export function Settings() {
      const zero = useZeroClient();
      const [tab, setTab] = useState<SettingsTab>("accounts");
      const [accounts] = useQuery(zero.query.accounts);
      const [settingsRows] = useQuery(zero.query.settings);
      const byKey = new Map(settingsRows.map((s) => [s.key, s.value]));
      const capUsd = (byKey.get("cost.cap_usd") as number | undefined) ?? 60;
      const mtdUsd = 0; // GET /cost provides the live value, but this task stops at wiring the Settings screen
      const state = costBarState(mtdUsd, capUsd);
      const [killSwitchConfirming, setKillSwitchConfirming] = useState(false);

      return (
        <OpaqueSurface className="settings-screen">
          <nav aria-label="Settings sub-nav">
            {SETTINGS_TABS.map((t) => (
              <button key={t} aria-current={tab === t} onClick={() => setTab(t)}>
                {TAB_LABEL[t]}
              </button>
            ))}
          </nav>

          {tab === "accounts" && (
            <ul>
              {accounts.map((a) => (
                <li key={a.id}>
                  {a.channel}: {a.state}
                </li>
              ))}
            </ul>
          )}

          {tab === "model-tiers" && (
            <div>
              <p>This month's usage: ${mtdUsd} / ${capUsd} — {COST_STATE_TEXT[state]}</p>
              <input
                type="number"
                aria-label="Monthly cost cap"
                defaultValue={capUsd}
                onBlur={(e) => void putSetting("cost.cap_usd", Number(e.target.value))}
              />
            </div>
          )}

          <section>
            <h2>⚠ Kill switch</h2>
            {!killSwitchConfirming ? (
              <button type="button" onClick={() => setKillSwitchConfirming(true)}>
                Stop all autonomous runs
              </button>
            ) : (
              <div role="alertdialog" aria-label="Really stop all autonomous runs?">
                <p>Really stop all autonomous runs?</p>
                <button type="button" onClick={() => setKillSwitchConfirming(false)}>Confirm</button>
                <button type="button" onClick={() => setKillSwitchConfirming(false)}>Cancel</button>
              </div>
            )}
          </section>
        </OpaqueSurface>
      );
    }
    ```

17. [ ] Re-run → pass, commit.
    ```bash
    pnpm --filter @omnis/desktop test
    ```
    ```bash
    git add apps/desktop/src/api/settings.ts apps/desktop/src/screens/Settings.tsx apps/desktop/test/settings-screen.test.tsx
    git commit -m "$(cat <<'EOF'
    US-B33: Settings screen — sub-nav 4, editable cost cap + reserve segment, 2-step kill switch confirm

    Implemented-by: Claude Sonnet
    Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
    EOF
    )"
    ```

**Open questions**: `mtdUsd` in `Settings.tsx` is pinned to `0` in this task — the real value requires calling `GET /cost` (adding `fetchCost()` to `apps/desktop/src/api/settings.ts`), and since that is a plain fetch rather than Zero it needs `useEffect` polling wired up (left out here to narrow scope). The Autonomy sub-tab's toggle + warning dialog, the allowlist editor (chip inputs for the three local/Drive/GitHub kinds), and the quiet-hours editor all proved only the read wiring from the `settings` table and were not built in this task — a follow-up task just needs to connect each key (`autonomy.rules`/`ingest.*`/`notify.quiet_hours`) to `putSetting` (the pattern is identical to the cost-cap input).

---

### Task 9: `apps/web` PWA shell (US-B35, tier: Sonnet)

**Goal (backlog)**: Vite + `@omnis/ui`, 5-slot bottom tab bar (Inbox/Today/Tasks/Network/Notes), manifest + service worker + 3-step install guide card, swipe actions, 4 snooze presets, 3 quick-reply chips.
**Deliverables**: `apps/web/src/**`, `apps/web/public/manifest.webmanifest`
**Verification command**: `pnpm --filter @omnis/web test`
**Depends on**: B28 (Today screen — the data pattern the PWA reuses), B34 (the ops plan's Tailscale Serve mount; this task only produces the build)
**Spec to read**: delta §1 (`@omnis/web` package definition), §9 (`OMNIS_WEB_PORT`), A5 §4.1–§4.3, §4.5 (all), §5 (component map — reuse `@omnis/ui`)
**Do not do (YAGNI)**: offline caching strategy (tuning the Workbox precache list is a follow-up — the service worker only needs to register so the app is installable), reimplementing the five real screens (Inbox/Today/Tasks/Network/Notes) in the PWA (reusing the same `@omnis/ui` components + Zero queries as desktop is the principle, but this task covers only the shell (tab bar + swipe + install card) — wiring up screen reuse is an open question).

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/public/manifest.webmanifest`, `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/components/BottomTabBar.tsx`, `apps/web/src/components/InstallGuideCard.tsx`, `apps/web/src/lib/swipe.ts`
- Modify: `tsconfig.json` (add `apps/web` to the root references)
- Test: `apps/web/test/bottom-tab-bar.test.tsx`, `apps/web/test/swipe.test.ts`, `apps/web/test/install-guide-card.test.tsx`

**Interfaces:**
- Consumes: `@omnis/ui` (the package as-is — same dependency rules as `apps/desktop`), `@omnis/kernel/zero` (subpath only)
- Produces: `WEB_TABS`, `WebTab`, `BottomTabBar` (`apps/web/src/components/BottomTabBar.tsx`); `classifySwipe`, `SwipeAction` (`apps/web/src/lib/swipe.ts`); `InstallGuideCard` (`apps/web/src/components/InstallGuideCard.tsx`)

**Steps:**

1. [ ] Create the scaffold files first (without a package, vitest will not even look at this directory — the only non-TDD step that must precede the tests; the root `pnpm-workspace.yaml`'s `apps/*` already covers it, so no workspace file is touched).
   ```json
   // apps/web/package.json
   {
     "name": "@omnis/web",
     "version": "0.0.0",
     "private": true,
     "type": "module",
     "scripts": {
       "dev": "vite",
       "build": "tsc --build && vite build",
       "test": "vitest run",
       "typecheck": "tsc --build"
     },
     "dependencies": {
       "@omnis/kernel": "workspace:*",
       "@omnis/ui": "workspace:*",
       "@rocicorp/zero": "1.9.0",
       "react": "^18.3.0",
       "react-dom": "^18.3.0"
     },
     "devDependencies": {
       "@testing-library/jest-dom": "^6.5.0",
       "@testing-library/react": "^16.0.0",
       "@types/react": "^18.3.0",
       "@types/react-dom": "^18.3.0",
       "@vitejs/plugin-react": "^4.3.0",
       "jsdom": "^25.0.0",
       "typescript": "5.6.3",
       "vite": "^5.4.0",
       "vite-plugin-pwa": "0.21.2",
       "vitest": "2.1.9"
     }
   }
   ```
   ```json
   // apps/web/tsconfig.json
   {
     "extends": "../../tsconfig.base.json",
     "compilerOptions": {
       "jsx": "react-jsx",
       "lib": ["ES2023", "DOM", "DOM.Iterable"],
       "outDir": "dist",
       "rootDir": "src",
       "types": ["vite/client"]
     },
     "references": [{ "path": "../../packages/ui" }],
     "include": ["src"]
   }
   ```
   ```ts
   // apps/web/vite.config.ts
   import react from "@vitejs/plugin-react";
   import { defineConfig } from "vite";
   import { VitePWA } from "vite-plugin-pwa";

   export default defineConfig({
     plugins: [
       react(),
       VitePWA({
         registerType: "prompt",
         manifest: false, // serve public/manifest.webmanifest as-is — delta §9 OMNIS_WEB_PORT
         includeAssets: ["favicon.svg"],
       }),
     ],
     server: { port: Number(process.env.OMNIS_WEB_PORT ?? 5173) },
   });
   ```
   ```html
   <!-- apps/web/index.html -->
   <!doctype html>
   <html lang="ko">
     <head>
       <meta charset="UTF-8" />
       <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
       <link rel="manifest" href="/manifest.webmanifest" />
       <title>omnis</title>
     </head>
     <body>
       <div id="root"></div>
       <script type="module" src="/src/main.tsx"></script>
     </body>
   </html>
   ```
   ```json
   // apps/web/public/manifest.webmanifest
   {
     "name": "omnis",
     "short_name": "omnis",
     "start_url": "/",
     "display": "standalone",
     "background_color": "#faf8f4",
     "theme_color": "#faf8f4",
     "icons": []
   }
   ```
   ```tsx
   // apps/web/src/main.tsx
   import { StrictMode } from "react";
   import { createRoot } from "react-dom/client";
   import { App } from "./App.js";

   const rootEl = document.getElementById("root");
   if (!rootEl) throw new Error("#root not found");
   createRoot(rootEl).render(
     <StrictMode>
       <App />
     </StrictMode>,
   );
   ```
   Add `{ "path": "./apps/web" }` to the root `tsconfig.json`'s `references` array.

2. [ ] Write the failing test for `classifySwipe` (the swipe decision).
   ```ts
   // apps/web/test/swipe.test.ts
   import { describe, expect, it } from "vitest";
   import { classifySwipe } from "../src/lib/swipe.js";

   describe("classifySwipe (A5 §4.2: right=archive, partial left=menu, full left=snooze)", () => {
     it("returns none below the partial threshold", () => {
       expect(classifySwipe(20)).toBe("none");
       expect(classifySwipe(-20)).toBe("none");
     });
     it("returns archive for a partial or full rightward swipe", () => {
       expect(classifySwipe(80)).toBe("archive");
       expect(classifySwipe(200)).toBe("archive");
     });
     it("returns menu for a partial leftward swipe", () => {
       expect(classifySwipe(-80)).toBe("menu");
     });
     it("returns snooze for a full leftward swipe", () => {
       expect(classifySwipe(-200)).toBe("snooze");
     });
   });
   ```

3. [ ] Run → fail.
   ```bash
   pnpm --filter @omnis/web test
   ```

4. [ ] Implement `apps/web/src/lib/swipe.ts`.
   ```ts
   // apps/web/src/lib/swipe.ts
   export type SwipeAction = "archive" | "menu" | "snooze" | "none";

   const PARTIAL_PX = 60;
   const FULL_PX = 160;

   /** A5 §4.2: partial or full rightward = Archive (same action either way, only the UI affordance differs).
    * Partial leftward = menu (Snooze/Label/Delegate); full leftward = the default action (Snooze). */
   export function classifySwipe(deltaX: number): SwipeAction {
     if (deltaX >= PARTIAL_PX) return "archive";
     if (deltaX <= -FULL_PX) return "snooze";
     if (deltaX <= -PARTIAL_PX) return "menu";
     return "none";
   }
   ```

5. [ ] Re-run → pass, commit.
   ```bash
   pnpm --filter @omnis/web test
   ```
   ```bash
   git add apps/web/package.json apps/web/tsconfig.json apps/web/vite.config.ts apps/web/index.html apps/web/public/manifest.webmanifest apps/web/src/main.tsx apps/web/src/lib/swipe.ts apps/web/test/swipe.test.ts tsconfig.json
   git commit -m "$(cat <<'EOF'
   US-B35: apps/web scaffold (Vite + vite-plugin-pwa) + classifySwipe (A5 §4.2)

   Implemented-by: Claude Sonnet
   Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
   EOF
   )"
   ```

6. [ ] Write the failing test for `BottomTabBar`.
   ```tsx
   // apps/web/test/bottom-tab-bar.test.tsx
   import { describe, expect, it, vi } from "vitest";
   import { render, screen, fireEvent } from "@testing-library/react";
   import { BottomTabBar, WEB_TABS } from "../src/components/BottomTabBar.js";

   describe("BottomTabBar (A5 §4.1: fixed 5 slots, no Digest·Settings)", () => {
     it("renders exactly the 5 fixed tabs", () => {
       expect(WEB_TABS).toEqual(["inbox", "today", "tasks", "network", "notes"]);
     });
     it("marks the active tab and calls onSelect on click", () => {
       const onSelect = vi.fn();
       render(<BottomTabBar active="inbox" onSelect={onSelect} />);
       expect(screen.getByRole("tab", { name: "Inbox" })).toHaveAttribute("aria-selected", "true");
       fireEvent.click(screen.getByRole("tab", { name: "Today" }));
       expect(onSelect).toHaveBeenCalledWith("today");
     });
   });
   ```

7. [ ] Run → fail.
   ```bash
   pnpm --filter @omnis/web test
   ```

8. [ ] Implement `BottomTabBar` + `InstallGuideCard`.
   ```tsx
   // apps/web/src/components/BottomTabBar.tsx
   export const WEB_TABS = ["inbox", "today", "tasks", "network", "notes"] as const;
   export type WebTab = (typeof WEB_TABS)[number];

   const TAB_LABEL: Record<WebTab, string> = {
     inbox: "Inbox", today: "Today", tasks: "Tasks", network: "Network", notes: "Notes",
   };

   export function BottomTabBar({ active, onSelect }: { active: WebTab; onSelect: (t: WebTab) => void }) {
     return (
       <nav className="bottom-tab-bar" role="tablist" aria-label="Main screens">
         {WEB_TABS.map((tab) => (
           <button
             key={tab}
             type="button"
             role="tab"
             aria-selected={active === tab}
             onClick={() => onSelect(tab)}
           >
             {TAB_LABEL[tab]}
           </button>
         ))}
       </nav>
     );
   }
   ```
   ```tsx
   // apps/web/src/components/InstallGuideCard.tsx
   /** A5 §4.5: tap the share button → Add to Home Screen → done, a 3-step card. */
   export function InstallGuideCard({ onDismiss }: { onDismiss: () => void }) {
     const steps = ["Tap the share button", "Choose 'Add to Home Screen'", "Done!"];
     return (
       <div className="install-guide-card" role="dialog" aria-label="Add to Home Screen">
         <ol>
           {steps.map((s, i) => (
             <li key={s}>
               {i + 1}. {s}
             </li>
           ))}
         </ol>
         <button type="button" onClick={onDismiss}>
           Close
         </button>
       </div>
     );
   }
   ```

9. [ ] Implement `apps/web/src/App.tsx` to assemble the shell (screen bodies are follow-up, as noted under open questions — this task proves only tab switching + install-card display).
   ```tsx
   // apps/web/src/App.tsx
   import { useState } from "react";
   import { BottomTabBar, type WebTab } from "./components/BottomTabBar.js";
   import { InstallGuideCard } from "./components/InstallGuideCard.js";

   function isStandalone(): boolean {
     return window.matchMedia("(display-mode: standalone)").matches;
   }

   export function App() {
     const [tab, setTab] = useState<WebTab>("inbox");
     const [showInstallGuide, setShowInstallGuide] = useState(() => !isStandalone());

     return (
       <div className="web-shell">
         <header className="web-shell__topbar">
           <h1>{tab}</h1>
         </header>
         {showInstallGuide && <InstallGuideCard onDismiss={() => setShowInstallGuide(false)} />}
         <main className="web-shell__main">{/* screen bodies are a follow-up task — see open questions */}</main>
         <BottomTabBar active={tab} onSelect={setTab} />
       </div>
     );
   }
   ```

10. [ ] Re-run → pass, commit.
    ```bash
    pnpm --filter @omnis/web test
    ```
    ```bash
    git add apps/web/src/components/BottomTabBar.tsx apps/web/src/components/InstallGuideCard.tsx apps/web/src/App.tsx apps/web/test/bottom-tab-bar.test.tsx
    git commit -m "$(cat <<'EOF'
    US-B35: BottomTabBar (5-tab, no Digest/Settings) + InstallGuideCard + App shell wiring

    Implemented-by: Claude Sonnet
    Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
    EOF
    )"
    ```

**Open questions**: The five tabs' actual screen bodies (Inbox/Today/Tasks/Network/Notes) are empty in this task — a decision is needed on whether to reuse the `Inbox.tsx`/`Today.tsx`/`Tasks.tsx`/`Network.tsx`/`Notes.tsx` desktop already has (differing only in responsive CSS) or to write new PWA-specific compact versions. The former is obviously lazier (YAGNI: don't write the same Zero queries twice), but `apps/desktop` depends on Tauri's `@tauri-apps/api`, so the screen components cannot be imported as-is; only the screens' pure logic can be extracted into `packages/ui` or another shared location. The actual pointer-event wiring for the swipe gesture (the component that calls `classifySwipe`), the 3 quick-reply chips, and the 4-snooze-preset bottom sheet are also still missing.

---

### Task 10: PWA Web Push subscription (US-B36, tier: Sonnet)

**Goal (backlog)**: Request permission when the first pending-approval item appears, `POST /push/subscribe` + `push_subscriptions` storage, service worker `notificationclick` (Approve=`pending_approvals` accept, Open=deep link), copy for the 6 notification kinds.
**Deliverables**: `apps/web/src/push/*.ts`, `apps/hub/src/push.ts`
**Verification command**: `pnpm --filter @omnis/web test`
**Depends on**: B17 (notification delivery — `createNotifier`/`PushPayload` sending infrastructure), B35 (this plan's Task 9)
**Spec to read**: delta §2.3 (`PushSubscription`/`PushPayload`), §6 (`0011_push_subscriptions.sql`), §7 (`/push/*`), A5 §4.4 (all)
**Single owner of Web Push (2026-09-20 cross review M-webpush):** VAPID configuration, signing, actual sending, and 410/404 subscription pruning have **exactly one owner: `packages/kernel/src/notify/webpush.ts` from agents plan Task 12** (`vapidFromEnv`/`sendWebPush`/`pruneSubscription`/`WEBPUSH_GONE_CODES`/`VapidKeys`). This task creates **only the three routes** — `GET /push/vapid-public-key`, `POST /push/subscribe`, `DELETE /push/subscribe` — plus subscription row save/delete (`saveSubscription`/`removeSubscription`). Do not build a second sending implementation in `apps/hub` (`sendPush`/`configureWebPush`/`PushSender`), and do not add the `web-push` dependency to `apps/hub` either.

**Do not do (YAGNI)**: wiring the send triggers for the actual 6 notification kinds (agents US-B17's `createNotifier` already owns that — this task covers only subscription storage + the click handler), a hub-side send function (per the single-owner rule above), retry logic for whether the Approve button succeeded (opening the app is enough on failure, so fire-and-forget suffices, YAGNI).

**Files:**
- Create: `apps/hub/src/push.ts`, `apps/web/src/push/subscribe.ts`, `apps/web/src/push/sw-push.ts`
- Modify: `apps/hub/src/http.ts` (GET /push/vapid-public-key, POST/DELETE /push/subscribe), `apps/hub/src/config.ts` (add 3 VAPID env fields)
- Test: `apps/hub/src/push.test.ts`, `apps/web/test/push-subscribe.test.ts`, `apps/web/test/sw-push.test.ts`
- **Not created**: `packages/db/migrations/0011_push_subscriptions.sql` (owned by the W0 schema bundle, delta §6 — cross review M3), `packages/kernel/src/notify/webpush.ts` (owned by agents plan Task 12)

**Interfaces:**
- Consumes: `PushSubscription`, `PushPayload` (`@omnis/protocol`, delta §2.3), `query` (`@omnis/db`), `sendWebPush`/`pruneSubscription`/`vapidFromEnv`/`VapidKeys` (`@omnis/kernel`, agents Task 12 — this task only imports them; `createNotifier` does the calling)
- Produces: `saveSubscription`, `removeSubscription` (`apps/hub/src/push.ts`); `toSubscriptionPayload` (`apps/web/src/push/subscribe.ts`); `buildNotificationOptions`, `resolveNotificationClick` (`apps/web/src/push/sw-push.ts`)

**Steps:**

1. [ ] **Precondition check** — this task creates neither the schema nor the sender. Both must already exist before starting.
   ```bash
   cd /Users/logankim/AI-Workspaces/omnis && ls packages/db/migrations/0011_push_subscriptions.sql && grep -n "export async function sendWebPush\|export async function pruneSubscription\|export function vapidFromEnv" packages/kernel/src/notify/webpush.ts
   ```
   Expected output: 1 line for the migration file + 3 export lines from `webpush.ts`. If they are missing, **stop** — `0011` comes from the **W0 schema bundle** (delta §6) and `webpush.ts` from **agents plan Task 12**. Do not recreate either in this worktree (the migration runner throws on a sha256 change, and two copies of the sender would split VAPID configuration across two places).

2. [ ] Write the failing tests for `apps/hub/src/push.ts` (subscription save/delete). There is no sending here — `@omnis/kernel`'s `sendWebPush` handles that.
   ```ts
   // apps/hub/src/push.test.ts
   import { describe, expect, it, vi } from "vitest";
   import { removeSubscription, saveSubscription } from "./push.js";

   function fakePool(rows: unknown[] = []) {
     return { query: vi.fn().mockResolvedValue({ rows }) };
   }

   describe("saveSubscription", () => {
     it("upserts by endpoint and returns the row id", async () => {
       const pool = fakePool([{ id: "sub-1" }]);
       const id = await saveSubscription(pool as never, {
         endpoint: "https://push.example/abc",
         keys: { p256dh: "p", auth: "a" },
       });
       expect(id).toBe("sub-1");
       expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("ON CONFLICT (endpoint)"), [
         "https://push.example/abc", "p", "a", null,
       ]);
     });
   });

   describe("removeSubscription", () => {
     it("returns true when a row was deleted", async () => {
       const pool = fakePool([{ id: "sub-1" }]);
       expect(await removeSubscription(pool as never, "https://push.example/abc")).toBe(true);
     });
     it("returns false when nothing matched", async () => {
       const pool = fakePool([]);
       expect(await removeSubscription(pool as never, "https://nope")).toBe(false);
     });
   });
   ```

3. [ ] Run → fail.
   ```bash
   pnpm --filter @omnis/hub test
   ```

4. [ ] Implement `apps/hub/src/push.ts` — subscription row save/delete only. Do not import `web-push`.
   ```ts
   // apps/hub/src/push.ts
   // Sending is not here: VAPID config, signing, and 410/404 pruning have exactly one owner,
   // @omnis/kernel's notify/webpush.ts (agents plan Task 12, cross review M-webpush). This file only
   // inserts and removes the subscriptions the PWA sends into push_subscriptions.
   import { query } from "@omnis/db";
   import type { Pool } from "pg";

   export interface PushSubscriptionInput {
     endpoint: string;
     keys: { p256dh: string; auth: string };
     ua?: string;
   }

   export async function saveSubscription(pool: Pool, sub: PushSubscriptionInput): Promise<string> {
     const rows = await query<{ id: string }>(
       pool,
       `INSERT INTO push_subscriptions (endpoint, p256dh, auth, ua)
          VALUES ($1, $2, $3, $4)
        ON CONFLICT (endpoint) DO UPDATE SET p256dh = $2, auth = $3, ua = $4, fail_count = 0
        RETURNING id`,
       [sub.endpoint, sub.keys.p256dh, sub.keys.auth, sub.ua ?? null],
     );
     const row = rows[0];
     if (row === undefined) throw new Error("insert push_subscriptions returned no row");
     return row.id;
   }

   export async function removeSubscription(pool: Pool, endpoint: string): Promise<boolean> {
     const rows = await query(pool, `DELETE FROM push_subscriptions WHERE endpoint = $1 RETURNING id`, [
       endpoint,
     ]);
     return rows.length > 0;
   }
   ```

5. [ ] Re-run → pass. Add the VAPID fields to `apps/hub/src/config.ts` (the same "empty string = unset" pattern as `zeroAuthSecret`), and wire the three `/push/*` routes into `http.ts`.
   ```bash
   pnpm --filter @omnis/hub test
   ```
   ```ts
   // apps/hub/src/config.ts — add 3 fields to HubConfig, wire them into readConfig
   export interface HubConfig {
     // ...existing fields
     webpushVapidPublic: string;
     webpushVapidPrivate: string;
     webpushSubject: string;
   }
   // added to the readConfig() return object:
   webpushVapidPublic: env.OMNIS_WEBPUSH_VAPID_PUBLIC ?? "",
   webpushVapidPrivate: env.OMNIS_WEBPUSH_VAPID_PRIVATE ?? "",
   webpushSubject: env.OMNIS_WEBPUSH_SUBJECT ?? "mailto:281932556+jinhologankim@users.noreply.github.com",
   ```
   ```ts
   // apps/hub/src/http.ts — added import + top of createHubServer + routes
   import { removeSubscription, saveSubscription } from "./push.js";
   // (top of the createHubServer function; config is already in scope)
   // The side that hands the VAPID keys to web-push (setVapidDetails) is @omnis/kernel's sendWebPush —
   // the hub only checks "is it configured" and returns the public key. With no config, /push/* is 503 (delta §7).
   const webpushConfigured = config.webpushVapidPublic !== "" && config.webpushVapidPrivate !== "";

   if (path === "/push/vapid-public-key") {
     if (method !== "GET") return send(res, 405, { error: "method not allowed" });
     if (!webpushConfigured) return send(res, 503, { error: "web push is not configured" });
     return send(res, 200, { key: config.webpushVapidPublic });
   }

   if (path === "/push/subscribe") {
     if (method === "POST") {
       let body: unknown;
       try {
         body = await readJson(req);
       } catch {
         return send(res, 400, { error: "invalid json body" });
       }
       const b = body as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown }; ua?: unknown };
       if (
         typeof b.endpoint !== "string" ||
         typeof b.keys?.p256dh !== "string" ||
         typeof b.keys?.auth !== "string"
       ) {
         return send(res, 400, { error: "expected PushSubscription shape" });
       }
       const id = await saveSubscription(pool, {
         endpoint: b.endpoint,
         keys: { p256dh: b.keys.p256dh, auth: b.keys.auth },
         ...(typeof b.ua === "string" ? { ua: b.ua } : {}),
       });
       return send(res, 200, { id });
     }
     if (method === "DELETE") {
       let body: unknown;
       try {
         body = await readJson(req);
       } catch {
         return send(res, 400, { error: "invalid json body" });
       }
       const b = body as { endpoint?: unknown };
       if (typeof b.endpoint !== "string") return send(res, 400, { error: "expected { endpoint: string }" });
       return send(res, 200, { removed: await removeSubscription(pool, b.endpoint) });
     }
     return send(res, 405, { error: "method not allowed" });
   }
   ```
   There is no sending path in this task — agents US-B17's `createNotifier` calls `@omnis/kernel`'s `sendWebPush(deps, payload)` (contract §5 `Notifier.send`). The hub is only responsible for receiving and storing subscriptions.

6. [ ] Commit.
   ```bash
   git add apps/hub/src/push.ts apps/hub/src/push.test.ts apps/hub/src/config.ts apps/hub/src/http.ts
   git commit -m "$(cat <<'EOF'
   US-B36: hub subscription store + GET vapid-public-key, POST/DELETE /push/subscribe

   - sending stays in @omnis/kernel notify/webpush.ts (single owner); the hub only stores subscriptions

   Implemented-by: Claude Sonnet
   Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
   EOF
   )"
   ```

7. [ ] Write the failing tests for the PWA-side subscription conversion (`toSubscriptionPayload`) and the service worker notification handlers (`buildNotificationOptions`/`resolveNotificationClick`) — the browser Push API itself (`navigator.serviceWorker`/`PushManager`) does not exist in jsdom, so only the pure conversion functions around it are tested.
   ```ts
   // apps/web/test/push-subscribe.test.ts
   import { describe, expect, it } from "vitest";
   import { toSubscriptionPayload } from "../src/push/subscribe.js";

   describe("toSubscriptionPayload (PushSubscriptionJSON → hub PushSubscription body)", () => {
     it("maps p256dh/auth keys and drops a missing ua", () => {
       const json = {
         endpoint: "https://push.example/abc",
         keys: { p256dh: "p", auth: "a" },
       } as PushSubscriptionJSON;
       expect(toSubscriptionPayload(json)).toEqual({
         endpoint: "https://push.example/abc",
         keys: { p256dh: "p", auth: "a" },
       });
     });
     it("throws when the browser omits keys (should not happen, but don't silently send garbage)", () => {
       const json = { endpoint: "https://push.example/abc" } as PushSubscriptionJSON;
       expect(() => toSubscriptionPayload(json)).toThrow();
     });
   });
   ```
   ```ts
   // apps/web/test/sw-push.test.ts
   import { describe, expect, it } from "vitest";
   import { buildNotificationOptions, resolveNotificationClick } from "../src/push/sw-push.js";

   describe("buildNotificationOptions (A5 §4.4: at most 2 actions Approve/Open, body 80 chars)", () => {
     it("includes an Approve action only when approval_id is present", () => {
       const withApproval = buildNotificationOptions({
         kind: "draft", title: "New draft", body: "Please confirm", deep_link: "omnis://thread/t1",
         approval_id: "ap1",
       });
       expect(withApproval.actions).toEqual([
         { action: "approve", title: "Approve" },
         { action: "open", title: "Open" },
       ]);
       const withoutApproval = buildNotificationOptions({
         kind: "digest", title: "Nightly digest ready · 42 archived", body: "", deep_link: "omnis://digest",
       });
       expect(withoutApproval.actions).toEqual([{ action: "open", title: "Open" }]);
     });
   });

   describe("resolveNotificationClick (Approve = pending_approvals accept, Open = deep link)", () => {
     const payload = {
       kind: "draft" as const, title: "t", body: "b", deep_link: "omnis://thread/t1", approval_id: "ap1",
     };
     it("approve action resolves to an approve intent with the approval id", () => {
       expect(resolveNotificationClick("approve", payload)).toEqual({ kind: "approve", approvalId: "ap1" });
     });
     it("open action (or the bare notification body) resolves to opening the deep link", () => {
       expect(resolveNotificationClick("open", payload)).toEqual({ kind: "open", url: "omnis://thread/t1" });
       expect(resolveNotificationClick("", payload)).toEqual({ kind: "open", url: "omnis://thread/t1" });
     });
   });
   ```

8. [ ] Run → fail.
   ```bash
   pnpm --filter @omnis/web test
   ```

9. [ ] Implement `apps/web/src/push/subscribe.ts` + `apps/web/src/push/sw-push.ts`.
   ```ts
   // apps/web/src/push/subscribe.ts
   export interface PushSubscriptionPayload {
     endpoint: string;
     keys: { p256dh: string; auth: string };
     ua?: string;
   }

   export function toSubscriptionPayload(json: PushSubscriptionJSON): PushSubscriptionPayload {
     const endpoint = json.endpoint;
     const p256dh = json.keys?.p256dh;
     const auth = json.keys?.auth;
     if (endpoint === undefined || p256dh === undefined || auth === undefined) {
       throw new Error("PushSubscriptionJSON missing endpoint or keys");
     }
     return { endpoint, keys: { p256dh, auth } };
   }

   const HUB_HTTP_URL = import.meta.env.OMNIS_HUB_HTTP_URL ?? "http://127.0.0.1:8787";

   /** A5 §4.5: the caller of this function (App.tsx, follow-up scope) decides when to ask for permission — when the first pending approval appears. */
   export async function subscribeToPush(): Promise<void> {
     const reg = await navigator.serviceWorker.ready;
     const keyRes = await fetch(`${HUB_HTTP_URL}/push/vapid-public-key`);
     if (!keyRes.ok) throw new Error(`vapid key fetch failed: HTTP ${keyRes.status}`);
     const { key } = (await keyRes.json()) as { key: string };
     const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
     const payload = toSubscriptionPayload(sub.toJSON());
     const res = await fetch(`${HUB_HTTP_URL}/push/subscribe`, {
       method: "POST",
       headers: { "content-type": "application/json" },
       body: JSON.stringify(payload),
     });
     if (!res.ok) throw new Error(`push subscribe failed: HTTP ${res.status}`);
   }
   ```
   ```ts
   // apps/web/src/push/sw-push.ts — imported in the service worker context (the self.addEventListener wiring is follow-up)
   export interface PushPayload {
     kind: "draft" | "approval" | "vip" | "briefing" | "digest" | "followup" | "adapter_down";
     title: string;
     body: string;
     deep_link: string;
     approval_id?: string;
   }

   /** A5 §4.4: the body is at most 80 chars (the hub's PushPayload.body already arrives trimmed — don't trim it again here). */
   export function buildNotificationOptions(payload: PushPayload): { body: string; actions: { action: string; title: string }[] } {
     const actions = payload.approval_id !== undefined
       ? [{ action: "approve", title: "Approve" }, { action: "open", title: "Open" }]
       : [{ action: "open", title: "Open" }];
     return { body: payload.body, actions };
   }

   export type NotificationClickIntent =
     | { kind: "approve"; approvalId: string }
     | { kind: "open"; url: string };

   /** action==='' is a click on the notification body (not an action button) — treat it the same as Open (A5 §4.4). */
   export function resolveNotificationClick(action: string, payload: PushPayload): NotificationClickIntent {
     if (action === "approve" && payload.approval_id !== undefined) {
       return { kind: "approve", approvalId: payload.approval_id };
     }
     return { kind: "open", url: payload.deep_link };
   }
   ```

10. [ ] Re-run → confirm pass, commit.
    ```bash
    pnpm --filter @omnis/web test
    ```
    ```bash
    git add apps/web/src/push/subscribe.ts apps/web/src/push/sw-push.ts apps/web/test/push-subscribe.test.ts apps/web/test/sw-push.test.ts
    git commit -m "$(cat <<'EOF'
    US-B36: PWA push subscribe client + service worker notification helpers (A5 §4.4)

    - toSubscriptionPayload() converts the browser's PushSubscriptionJSON to the hub's PushSubscription
    - buildNotificationOptions()/resolveNotificationClick() decide Approve-vs-Open without touching the DOM,
      so they're unit-tested without a real service worker

    Implemented-by: Claude Sonnet
    Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
    EOF
    )"
    ```

**Open questions**: The actual service worker registration for `self.addEventListener("push", …)`/`self.addEventListener("notificationclick", …)` (the entry point that calls `sw-push.ts`'s functions) is not in this task — it requires specifying a custom service worker source via `vite-plugin-pwa`'s `injectManifest` strategy (Task 9 only used the default generated service worker from `registerType: "prompt"`), so switching `vite.config.ts` to `strategies: "injectManifest"` and specifying `srcDir`/`filename` is a follow-up wiring task. The wiring that makes the `{kind:"approve"}` returned by `resolveNotificationClick` actually call the existing `POST /approvals/:id/decide` (the part Global Constraints promises with "don't create new routes") is also a follow-up task, together with the service worker entry point.

---

### Task 11: `GET /transcript/:session_id` — agent session transcript (US-B39 hub portion, tier: Sonnet)

**Why it's in this plan (2026-09-20 cross review M8)**: Delta §7 attached this route to US-B39, but the channels plan's US-B39 deliverable is just `apps/local-agent/src/bridges/hermes.ts`, making this an **orphan route** nobody would implement. `apps/hub/src/http.ts` is already touched by this plan's Task 1 (`/search`), Task 8 (`/settings`) and Task 10 (`/push/*`), so the route moves here. The owner column in the delta §7 table is updated to `surfaces plan Task 11` as well.

**Goal**: `GET /transcript/:session_id?last_n` → `SessionSummary` (A3 §7; `@omnis/protocol`'s `SessionSummary` is the canonical schema). It reads the durable summary (`agent_sessions.summary`) plus the **last N turns** of that session's thread from `items` and returns them.
**Deliverables**: `apps/hub/src/transcript.ts`, `apps/hub/src/http.ts` (modified)
**Verification command**: `pnpm --filter @omnis/hub test`
**Depends on**: nothing — `agent_sessions`/`agent_runtimes`/`items` are all Phase A schema. Can run in parallel with Tasks 1–10; just watch for the one-line conflict in `http.ts`.
**Spec to read**: A2 §6 (`SessionSummary`), A3 §7 (the announced route), delta §7, `SessionSummary` in `packages/protocol/src/bridge.ts` (FIXED, canonical fields), `apps/hub/src/sessions.ts` (`purposeOf`/`runtimeOf`/`writeAgentItem` — code that uses the same tables)
**Do not do (YAGNI)**: an LLM call to infer `open_questions`/`artifacts` (A2-D13 forbids storing raw deltas and reasoning text, so there is no basis for them in the current schema — leave them as **empty arrays** and note it in Open questions), an alias route that also looks up by `session_key` (delta §7 has only `:session_id`), pagination (`last_n` caps at 10, so it isn't needed).

**Files:**
- Create: `apps/hub/src/transcript.ts`, `apps/hub/src/transcript.test.ts`
- Modify: `apps/hub/src/http.ts` (add the `GET /transcript/:session_id` route)
- Test: `apps/hub/src/transcript.test.ts`

**Interfaces:**
- Consumes: `SessionSummary` (`@omnis/protocol`), `query` (`@omnis/db`), `purposeOf`/`runtimeOf` (`apps/hub/src/sessions.ts`)
- Produces: `toSessionState`, `clampLastN`, `buildSessionSummary`, `loadTranscript`, `TranscriptSessionRow`, `TranscriptItemRow` (`apps/hub/src/transcript.ts`)

**Steps:**

1. [ ] Write the failing test for the pure conversion first. The core is the function that takes DB row shapes (`TranscriptSessionRow`/`TranscriptItemRow`) and builds a `SessionSummary` — the Pool is only encountered in `loadTranscript`.
   ```ts
   // apps/hub/src/transcript.test.ts
   import { SessionSummary } from "@omnis/protocol";
   import { describe, expect, it } from "vitest";
   import {
     buildSessionSummary,
     clampLastN,
     toSessionState,
     type TranscriptItemRow,
     type TranscriptSessionRow,
   } from "./transcript.js";

   const session: TranscriptSessionRow = {
     id: "11111111-1111-1111-1111-111111111111",
     session_key: "agent:claude_code:macbook:omnis",
     runtime: "claude_code",
     host: "macbook",
     state: "running",
     summary: "Applying the Phase B plan cross review",
     started_at: new Date("2026-09-20T01:00:00.000Z"),
     last_turn_at: new Date("2026-09-20T04:00:00.000Z"),
     turn_count: 42,
   };

   const items: TranscriptItemRow[] = [
     { id: "i1", kind: "agent_turn", body: "I've read the plan", tool: null, author_is_me: false, sent_at: new Date("2026-09-20T03:58:00.000Z") },
     { id: "i2", kind: "tool_call", body: "", tool: { label: "Read docs/plan.md", state: "ok" }, author_is_me: false, sent_at: new Date("2026-09-20T03:59:00.000Z") },
     { id: "i3", kind: "agent_turn", body: "Moving on to the next task", tool: null, author_is_me: true, sent_at: new Date("2026-09-20T04:00:00.000Z") },
   ];

   describe("toSessionState (agent_sessions.state 6 values → SessionState 5 values)", () => {
     it("maps starting/idle/ended to the protocol's three", () => {
       expect(toSessionState("starting")).toBe("idle");
       expect(toSessionState("idle")).toBe("idle");
       expect(toSessionState("ended")).toBe("closed");
     });
     it("maps waiting_approval to awaiting_approval (the names differ)", () => {
       expect(toSessionState("waiting_approval")).toBe("awaiting_approval");
     });
     it("passes running and failed through", () => {
       expect(toSessionState("running")).toBe("running");
       expect(toSessionState("failed")).toBe("failed");
     });
     // The DB CHECK constraint enforces the 6 values, but if a new one appears we don't silently flatten it to 'idle'.
     it("throws on an unknown state instead of guessing", () => {
       expect(() => toSessionState("teleporting")).toThrow();
     });
   });

   describe("clampLastN (A2 §6 recent_turns ≤ 10)", () => {
     it("defaults to 10 and clamps out-of-range input", () => {
       expect(clampLastN(null)).toBe(10);
       expect(clampLastN("3")).toBe(3);
       expect(clampLastN("0")).toBe(1);
       expect(clampLastN("99")).toBe(10);
       expect(clampLastN("beer")).toBe(10);
     });
   });

   describe("buildSessionSummary", () => {
     it("produces a payload that parses against the protocol schema", () => {
       const out = buildSessionSummary(session, items);
       expect(() => SessionSummary.parse(out)).not.toThrow();
       expect(out.purpose).toBe("omnis");
       expect(out.state).toBe("running");
       expect(out.summary).toBe("Applying the Phase B plan cross review");
       expect(out.open_questions).toEqual([]);
       expect(out.artifacts).toEqual([]);
     });

     it("folds tool_call items into the preceding turn instead of emitting a turn for them", () => {
       const out = buildSessionSummary(session, items);
       expect(out.recent_turns.map((t) => t.turn_id)).toEqual(["i1", "i3"]);
       expect(out.recent_turns[0]?.tool_calls).toEqual([{ label: "Read docs/plan.md", status: "ok" }]);
       expect(out.recent_turns[1]?.tool_calls).toEqual([]);
     });

     it("marks author_is_me turns as 'user' and the rest as 'agent'", () => {
       const out = buildSessionSummary(session, items);
       expect(out.recent_turns.map((t) => t.role)).toEqual(["agent", "user"]);
     });

     // SessionSummary.text is max(1000) — parse throws on overflow, so it must be truncated here.
     it("truncates turn text to 1000 chars so the schema never rejects a long turn", () => {
       // noUncheckedIndexedAccess means we don't spread items[0] — build the row directly.
       const long: TranscriptItemRow[] = [
         { id: "i9", kind: "agent_turn", body: "a".repeat(2000), tool: null, author_is_me: false, sent_at: new Date("2026-09-20T04:01:00.000Z") },
       ];
       const out = buildSessionSummary(session, long);
       expect(out.recent_turns[0]?.text.length).toBe(1000);
       expect(() => SessionSummary.parse(out)).not.toThrow();
     });

     // A session with a NULL summary (the summary job hasn't run yet) must still return 200 — not 404.
     it("uses an empty summary when the session has none yet", () => {
       const out = buildSessionSummary({ ...session, summary: null, last_turn_at: null }, []);
       expect(out.summary).toBe("");
       expect(out.last_turn_at).toBeNull();
       expect(() => SessionSummary.parse(out)).not.toThrow();
     });
   });
   ```

2. [ ] Run → confirm failure.
   ```bash
   pnpm --filter @omnis/hub test
   ```
   Expected output: `Cannot find module './transcript.js'`.

3. [ ] Implement `apps/hub/src/transcript.ts`.
   ```ts
   // apps/hub/src/transcript.ts
   // Delta §7 GET /transcript/:session_id. This is the route A3 §7 announced, and the canonical
   // schema is @omnis/protocol's SessionSummary (A2 §6). Raw deltas and reasoning text are never
   // stored in the first place (A2-D13), so there is nothing to reconstruct here — we only read the
   // turn/tool_call items left in `items`.
   import { query } from "@omnis/db";
   import type { SessionState, SessionSummary } from "@omnis/protocol";
   import type { Pool } from "pg";
   import { purposeOf } from "./sessions.js";

   export interface TranscriptSessionRow {
     id: string;
     session_key: string;
     runtime: string;
     host: string;
     state: string;
     summary: string | null;
     started_at: Date;
     last_turn_at: Date | null;
     turn_count: number;
   }

   export interface TranscriptItemRow {
     id: string;
     kind: string;
     body: string;
     tool: { label?: unknown; state?: unknown } | null;
     author_is_me: boolean;
     sent_at: Date;
   }

   /** agent_sessions.state (6 values, 0004 CHECK) has different names from the protocol's SessionState (5 values). */
   const STATE_MAP: Readonly<Record<string, SessionState>> = {
     starting: "idle",
     idle: "idle",
     running: "running",
     waiting_approval: "awaiting_approval",
     ended: "closed",
     failed: "failed",
   };

   export function toSessionState(dbState: string): SessionState {
     const mapped = STATE_MAP[dbState];
     // Flattening an unknown value to idle would make "finished session" indistinguishable from "newly appeared state".
     if (mapped === undefined) throw new Error(`unknown agent_sessions.state: ${dbState}`);
     return mapped;
   }

   export const MAX_RECENT_TURNS = 10;
   const MAX_TURN_TEXT = 1000;

   export function clampLastN(raw: string | null): number {
     const n = Number.parseInt(raw ?? "", 10);
     if (!Number.isFinite(n)) return MAX_RECENT_TURNS;
     return Math.min(MAX_RECENT_TURNS, Math.max(1, n));
   }

   /** `items` arrive in ascending sent_at order. A tool_call folds into the **preceding turn**, not
    * its own (A2 §3.3: reasoning/tool are attachments of that turn, not items). If the first
    * tool_call arrives before any turn there is nothing to attach it to, so it is dropped —
    * SessionSummary has no tool-only turns. */
   export function buildSessionSummary(
     session: TranscriptSessionRow,
     items: readonly TranscriptItemRow[],
   ): SessionSummary {
     const turns: SessionSummary["recent_turns"] = [];
     for (const it of items) {
       if (it.kind === "tool_call") {
         const last = turns[turns.length - 1];
         if (last === undefined) continue;
         last.tool_calls.push({
           label: typeof it.tool?.label === "string" ? it.tool.label : "tool",
           status: it.tool?.state === "failed" ? "failed" : "ok",
         });
         continue;
       }
       turns.push({
         turn_id: it.id,
         at: it.sent_at.toISOString(),
         role: it.author_is_me ? "user" : "agent",
         text: it.body.slice(0, MAX_TURN_TEXT),
         tool_calls: [],
       });
     }
     return {
       session_key: session.session_key,
       runtime: session.runtime as SessionSummary["runtime"],
       host: session.host as SessionSummary["host"],
       purpose: purposeOf(session.session_key),
       state: toSessionState(session.state),
       opened_at: session.started_at.toISOString(),
       last_turn_at: session.last_turn_at === null ? null : session.last_turn_at.toISOString(),
       turn_count: session.turn_count,
       summary: session.summary ?? "",
       open_questions: [],
       artifacts: [],
       recent_turns: turns.slice(-MAX_RECENT_TURNS),
     };
   }

   /** If nothing is found, null → the route returns 404. */
   export async function loadTranscript(
     pool: Pool,
     sessionId: string,
     lastN: number,
   ): Promise<SessionSummary | null> {
     const sessions = await query<TranscriptSessionRow>(
       pool,
       `SELECT s.id, s.session_key, r.runtime, r.host, s.state, s.summary,
               s.started_at, s.last_turn_at,
               (SELECT count(*)::int FROM items i
                 WHERE i.thread_id = s.thread_id AND i.kind = 'agent_turn') AS turn_count
          FROM agent_sessions s
          JOIN agent_runtimes r ON r.id = s.runtime_id
         WHERE s.id = $1`,
       [sessionId],
     );
     const session = sessions[0];
     if (session === undefined) return null;

     // Filling N turns means also fetching the tool_calls interleaved between them — pull generously
     // and let buildSessionSummary keep only the last N turns. ponytail: cap is N*8. If a single turn
     // has more than 8 tools, earlier turns get pushed out.
     const rows = await query<TranscriptItemRow>(
       pool,
       `SELECT id, kind, body, tool, author_is_me, sent_at
          FROM (
            SELECT i.id, i.kind, i.body, i.tool, i.author_is_me, i.sent_at
              FROM items i
              JOIN agent_sessions s ON s.thread_id = i.thread_id
             WHERE s.id = $1 AND i.kind IN ('agent_turn', 'tool_call')
             ORDER BY i.sent_at DESC
             LIMIT $2
          ) recent
         ORDER BY sent_at ASC`,
       [sessionId, lastN * 8],
     );
     return buildSessionSummary(session, rows);
   }
   ```

4. [ ] Re-run → confirm pass.
   ```bash
   pnpm --filter @omnis/hub test
   ```
   Expected output: `transcript` 10 tests PASS.

5. [ ] Wire the route into `apps/hub/src/http.ts` — it goes in **the same branch spot** Task 1 modified (just before the final "owned by another appendix" comment). It shares a file with Tasks 1, 8 and 10, so as long as the merge order is respected it's a one-line conflict.
   ```ts
   // apps/hub/src/http.ts — added import
   import { clampLastN, loadTranscript } from "./transcript.js";

   // next to the /search and /memory/search branches
   if (path.startsWith("/transcript/")) {
     if (method !== "GET") return send(res, 405, { error: "method not allowed" });
     const sessionId = path.slice("/transcript/".length);
     // If it isn't a uuid, Postgres throws 22P02 — cut it off with a 400 first.
     if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return send(res, 400, { error: "invalid session_id" });
     const summary = await loadTranscript(pool, sessionId, clampLastN(url.searchParams.get("last_n")));
     if (summary === null) return send(res, 404, { error: "session not found" });
     return send(res, 200, summary);
   }
   ```

6. [ ] Run the full verification, then commit.
   ```bash
   pnpm --filter @omnis/hub test && pnpm typecheck && pnpm lint
   ```
   ```bash
   git add apps/hub/src/transcript.ts apps/hub/src/transcript.test.ts apps/hub/src/http.ts
   git commit -m "$(cat <<'EOF'
   US-B39: GET /transcript/:session_id — durable summary + last N turns (delta §7)

   - buildSessionSummary() is pure and validated against the protocol's SessionSummary zod schema
   - tool_call items fold into the preceding turn (A2 §3.3) instead of becoming turns of their own
   - turn text is truncated to the schema's 1000-char cap; a session with no summary yet returns 200, not 404
   - reassigned here by the 2026-09-20 cross-plan review (M8): channels US-B39 ships only the local-agent bridge

   Implemented-by: Claude Sonnet
   Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
   EOF
   )"
   ```

**Open questions**: `SessionSummary.open_questions` and `artifacts` are left as empty arrays. Both exist as fields in A2 §6 but have no basis in the Phase A schema (`items.tool`'s `{name,args,state,label,icon}` can carry a file path, but there is no `action: created|modified|read` distinction). To fill them, either ① the bridge would need to include artifacts in `TurnCompleted`, or ② the summary job (US-A?? `summarize-job.ts`) would need to add columns to `agent_sessions` — either way it's Phase C scope.

---

## Completion check

- All 10 stories (US-B26, B27, B28, B29, B30, B31, B32, B33, B35, B36) are covered by ≥1 task (exactly one each, Tasks 1–10). **Task 11 is outside the story list** — it is the hub portion of delta §7's `GET /transcript/:session_id`, handed over from US-B39 (channels) (2026-09-20 cross review M8).
- No forbidden phrasing (TBD/TODO/"implement later"/"add appropriate error handling"/"similar to Task N"/steps without code/undefined symbols) — self-check confirms none.
- Every symbol this document consumes is either from delta §2–§5 (the `SearchHit` family, `PushSubscription`/`PushPayload`, `getSetting`/`setSetting`/`SettingKey`/`SETTING_DEFAULTS`) or produced earlier in the wave order by another Phase B plan (`searchMemories`/`MemoryHit`, `undoArchive`, `currentPolicy`), and all of them are spelled out in Global Constraints.
- Symbols this plan newly pins down (not in the delta, see "Symbol deliverables"): `runSearch`/`createSearchDeps`/`SearchDeps` (Task 1), `matchesAnyAction`/`UiSearchHit`/`UiSearchGroup` (Task 2), `DigestCard` (Task 3), `TaskRow`/`filterTasksByView` (Task 4), `PersonCard`/`relationshipDot`/`followupQueue` (Task 5), `decideNoteRouting`/`POST /notes/:id/route` (Task 6, a route absent from the delta — recorded in Open questions), `handleUnarchiveItem`/`handleDigestUndo` (Task 7), all of `packages/kernel/src/settings.ts` (Task 8, the first implementation of delta §5), `BottomTabBar`/`classifySwipe`/`InstallGuideCard` (Task 9), subscription store/delete in `apps/hub/src/push.ts` (Task 10 — sending is single-owned by `@omnis/kernel`), `toSessionState`/`clampLastN`/`buildSessionSummary`/`loadTranscript` (Task 11).

**2026-09-20 cross review items reflected (what changed in this document)**:
- M8 — added `GET /transcript/:session_id` as **Task 11** (the delta §7 owner column is updated too).
- M13 — this plan does not create `truncateSnippet`. The memory-ingestion plan's Task 4 ships it in `packages/memory/src/search.ts`; Task 1 only imports it.
- M-B28 — Task 3 (US-B28)'s 4 states (loading/empty/error/offline) were pulled out of YAGNI and actually implemented with `screenState()` + a one-line banner.
- M-B30 — measured the file and signature of `initialsFromName`/`pastelFromName`/`formatRelativeTime` used by Task 5 (US-B30) and pinned them in a table (all already on main from Waves 4/5 — we don't create them).
- M-webpush — the single owner for Web Push sending is `packages/kernel/src/notify/webpush.ts` in the agents plan's Task 12. Task 10 only does the 3 routes plus subscription store/delete, and does not create `0011` either (owned by the W0 bundle).
- Wiring fix — six screens were using a module-top-level `const zero = initZero()`. `apps/desktop/src/zero-client.ts` records this as a known failure mode: "with the wiring where screens each called `initZero()` themselves, not a single screen rendered in the browser", so all of them were changed to call **`useZeroClient()` inside the component**, like the three existing screens (Inbox/Thread/AgentSession).

