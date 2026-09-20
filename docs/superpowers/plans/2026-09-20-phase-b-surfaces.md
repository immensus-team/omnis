# omnis Phase B Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the surfaces Logan actually touches in Phase B — unified search (`GET /search` + ⌘K search mode), the six new desktop screens (Today/Tasks/Network/Notes/Digest/Settings), and the iPhone PWA shell with Web Push — on top of the memory/agents/kernel work the other four Phase B plans land first (`memory-ingestion`, `agents`, `channels`, `ops`).
**Architecture:** Desktop screens stay read-only Zero consumers exactly like Phase A (`apps/desktop/src/screens/*.tsx` query `@rocicorp/zero`, join client-side the way `Inbox.tsx` already does — no new Zero relationships beyond the one this plan itself owns, `settings`). Every write (settings, unarchive, digest undo, note routing, push subscribe) goes through a typed hub HTTP route under `apps/hub/src/*.ts`, following the `send()`/regex-path-match pattern already in `apps/hub/src/http.ts`. `GET /search` is a synchronous four-way fan-out (`items` FTS+trgm, `threads` rollup, `persons` trgm, `@omnis/memory` kNN) merged and ranked in `apps/hub/src/search.ts`, consumed by both the desktop ⌘K palette and the PWA. `apps/web` is a second Vite React app (no Tauri) that reuses `@omnis/ui` and the same Zero client shape as `apps/desktop`, plus a service worker for install + Web Push.
**Tech Stack:** React 18 + TypeScript 5 (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), `@rocicorp/zero` 1.9.0 (read-only client), `cmdk` (⌘K), `react-virtuoso`, `lucide-react`, Vite 5 + `vite-plugin-pwa` 0.21.x, `web-push` 3.6.7 (hub-side VAPID push), `pg` 8.13.1, vitest 2.1.9 + `@testing-library/react` + `jsdom`, Biome.
**Spec:** `/Users/logankim/AI-Workspaces/omnis/docs/spec/A4-agent-layer.md` §14(통합 검색 계약) · `/Users/logankim/AI-Workspaces/omnis/docs/spec/A5-ui-ux.md` §2.3~§2.5(팔레트/검색) §3.4~§3.9(Today/Tasks/Network/Notes/Digest/Settings) §4(iPhone PWA) §5(컴포넌트 맵) §7~§9(온보딩/카피/QA) · `/Users/logankim/AI-Workspaces/omnis/docs/spec/A3-data-schema.md` §2~§5(스키마) §7(Zero 복제) §10(person 신원) · `/Users/logankim/AI-Workspaces/omnis/docs/superpowers/plans/2026-09-20-phase-a-interfaces.md`(Phase A 심볼 정본) · `/Users/logankim/AI-Workspaces/omnis/docs/superpowers/plans/2026-09-20-phase-b-interfaces-delta.md`(Phase B 심볼 정본, §2.2/§2.3/§5/§6/§7 이 플랜이 그대로 복사) · `/Users/logankim/AI-Workspaces/omnis/docs/superpowers/plans/2026-09-20-phase-b-backlog.md`(US-B26~B33, B35, B36).

## Global Constraints

- Node 22 + pnpm workspaces. `pnpm-workspace.yaml`의 `apps/*` glob이 이미 `apps/web`을 덮는다 — workspace 파일 수정 불필요.
- TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`(인터페이스 계약 §2). `packages/ui`는 "React만" 의존(Phase A 패키지 경계 판정 그대로) — `@omnis/protocol`의 `SearchResponse`/`SearchHit` 등을 **import하지 않고** 로컬 미러 타입(`UiSearchHit`/`UiSearchGroup`)을 쓴다.
- Postgres 17. 마이그레이션은 append-only 파일 `packages/db/migrations/000N_<name>.sql`, 다음 번호는 **0009**부터(이 플랜이 `0009_settings.sql`·`0011_push_subscriptions.sql`·`0013_publication_phase_b.sql` 3개를 만든다 — `0010`(ingest_sources)은 memory-ingestion 플랜, `0012`(jobs seed)는 공유 파일이라 이 플랜은 건드리지 않는다).
- 허브는 `127.0.0.1:8787`에만 bind(A6 §3), Tailscale Serve가 `/api/`로 마운트. `apps/web` 정적 서빙은 ops 플랜(US-B34 `tailscale-serve.sh`)의 몫이고 이 플랜은 `pnpm web:build` 산출물만 낸다.
- 핀 버전(인터페이스 계약 §1 그대로): `vitest 2.1.9` · `zod ^3.24.1` · `pg 8.13.1` · `typescript 5.6.3` · `pnpm@9.12.3` · `@rocicorp/zero 1.9.0`(exact) · `ai 7.0.107`. 이 플랜이 새로 고정하는 것(델타 §1): `web-push 3.6.7`, `vite-plugin-pwa 0.21.x`.
- 승인 게이트 없는 비가역 tool 배선 금지(A7 §7 공통 금지) — 이 플랜의 모든 쓰기 경로(설정 변경, 되살리기, 노트 라우팅 수락, 푸시 구독)는 `pending_approvals`를 거칠 필요가 없는 **가역** 액션이거나(되살리기는 archive의 undo, 설정 변경은 `audit_log`로 감사되는 관리 동작) 이미 승인된 것의 실행(Web Push의 Approve 버튼은 기존 `POST /approvals/:id/decide`를 그대로 쓴다, 새 경로를 만들지 않는다 — 계약 §7).
- provider SDK는 어댑터 패키지 안에만 — 이 플랜은 채널 어댑터를 만들지 않는다. `web-push`(VAPID)는 채널 어댑터가 아니라 허브 자신의 발송 인프라라 예외가 아니라 애초에 규칙 대상이 아니다.
- 스토리 티어(백로그 표): US-B26 **Opus**, 나머지(B27~B33, B35, B36) 전부 **Sonnet** — 이 플랜에 DeepSeek 티어 스토리는 없다.
- 커밋: 스토리당 원자 커밋(제목 `US-Bxx: <한 줄 요약>`), 본문에 충족한 acceptance criteria + `Implemented-by: Claude <Tier>`, 마지막 줄 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`(인터페이스 계약 §12 최신 트레일러 규칙).
- 이 플랜이 참조하는 **다른 Phase B 플랜의 심볼**(존재를 가정하되 이 워크트리에서 직접 만들지 않는 것): `@omnis/memory`의 `searchMemories`/`MemoryHit`(memory-ingestion US-B01/B04), `@omnis/kernel`의 `costState`/`currentPolicy`/`Policy`(agents US-B14), `@omnis/kernel`의 `archiveItem`/`undoArchive`/`ArchivedByMeta`/`UNDO_WINDOW_DAYS`(agents US-B18), `notifyTierFor`/`createNotifier`(agents US-B15/B17). 웨이브 순서(백로그 §3)상 이 플랜(W3)이 실행될 때는 이미 머지되어 있다.

---

### Task 1: 통합 검색 API — `GET /search` (US-B26, tier: Opus)

**목표(백로그)**: `GET /search?q&k&scope&since`, 네 갈래 병렬 쿼리(items FTS+trgm 폴백 / threads 집계 / persons trgm+handle_norm / memories kNN), 그룹 내 정규화 + `group_weight` 병합 랭킹 + recency·VIP 가산, 그룹당 5·전체 20 상한, `SearchResponse` 스키마 그대로. `agent_runs` row를 남기지 않는다.
**산출물**: `apps/hub/src/search.ts`, `packages/memory/src/search.ts`(수정)
**검증 명령**: `pnpm --filter @omnis/hub test`
**의존**: B01(`@omnis/memory` 스캐폴드), B03(person 신원 해석)
**읽을 스펙**: A4 §14(전체), 델타 §2.2(`SearchHit`/`SearchGroup`/`SearchResponse`/`SearchDeepLink`), A3 §2(items.search_tsv/items_body_trgm_idx), §3(persons_name_trgm_idx), §5(memories_embedding_idx — memory-ingestion 플랜 산출물, `searchMemories`로 이미 감싸져 있다)
**하지 말 것(YAGNI)**: `scope`/`since` 필터의 SQL WHERE 적용(백로그 표면에는 있지만 A4 §14.2 쿼리 표에 scope/since 필터 조건이 없다 — 파라미터는 파싱해 받아 두되 이번 태스크는 무시한다, 열린 질문에 기록), 그룹별 "더 보기" 페이지네이션(§14.3 "더 필요하면 그룹 헤더의 더 보기"는 클라이언트 후속), `agent_runs` 기록(스펙이 명시적으로 금지).

**Files:**
- Create: `apps/hub/src/search.ts`
- Modify: `apps/hub/src/http.ts`(GET /search, GET /memory/search 라우트 추가), `apps/hub/package.json`(`@omnis/memory` 의존 추가)
- Modify: `packages/memory/src/search.ts`(`truncateSnippet` export 추가)
- Test: `apps/hub/src/search.test.ts`, `packages/memory/test/search-snippet.test.ts`

**Interfaces:**
- Consumes: `SearchHit`/`SearchGroup`/`SearchResponse`/`SearchGroupKind`/`SearchHitKind`(`@omnis/protocol`, 델타 §2.2), `Channel`/`MemorySourceKind`(`@omnis/protocol`), `searchMemories`/`MemoryHit`(`@omnis/memory`, 델타 §3), `query`(`@omnis/db`)
- Produces: `normalizeScores`, `mergedScore`, `buildGroup`, `runSearch`, `createSearchDeps`, `SearchDeps`, `ItemHitRow`, `ThreadHitRow`, `PersonHitRow`(`apps/hub/src/search.ts`); `truncateSnippet`(`packages/memory/src/search.ts`)

**Steps:**

1. [ ] `packages/memory/src/search.ts`에 스니펫 절단 헬퍼의 실패하는 테스트부터 쓴다(memory-ingestion 플랜이 먼저 만든 파일에 한 함수를 더하는 것 — 이 워크트리에는 아직 그 파일이 없다면 최소 골격만 있다고 가정하고 이어 붙인다).
   ```ts
   // packages/memory/test/search-snippet.test.ts
   import { describe, expect, it } from "vitest";
   import { truncateSnippet } from "../src/search.js";

   describe("truncateSnippet (A4 §14.4 snippet ≤160자)", () => {
     it("returns short text unchanged", () => {
       expect(truncateSnippet("오전 미팅 선호")).toBe("오전 미팅 선호");
     });
     it("truncates to 160 chars with an ellipsis", () => {
       const long = "가".repeat(200);
       const out = truncateSnippet(long);
       expect(out.length).toBe(160);
       expect(out.endsWith("...")).toBe(true);
     });
     it("respects a custom max", () => {
       expect(truncateSnippet("abcdefgh", 5)).toBe("ab...");
     });
   });
   ```

2. [ ] 실행 → 실패 확인.
   ```bash
   pnpm --filter @omnis/memory test
   ```
   기대 출력: `truncateSnippet is not a function` 또는 `Cannot find module`(export가 아직 없음).

3. [ ] `packages/memory/src/search.ts` 끝에 export를 추가한다.
   ```ts
   // packages/memory/src/search.ts (기존 파일 끝에 추가)
   /** A4 §14.4: snippet은 ≤160자. items는 ts_headline이 있지만 memories는 없으므로 절단만 한다. */
   export function truncateSnippet(text: string, max = 160): string {
     if (text.length <= max) return text;
     return `${text.slice(0, max - 3)}...`;
   }
   ```

4. [ ] 재실행 → 통과 확인, 커밋.
   ```bash
   pnpm --filter @omnis/memory test
   ```
   기대 출력: `truncateSnippet` 3개 테스트 PASS.
   ```bash
   git add packages/memory/src/search.ts packages/memory/test/search-snippet.test.ts
   git commit -m "$(cat <<'EOF'
   US-B26: truncateSnippet helper for unified search memory hits

   - ≤160 char truncation shared by hub search.ts (A4 §14.4 snippet contract)

   Implemented-by: Claude Opus
   Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
   EOF
   )"
   ```

5. [ ] 병합 랭킹 순수 함수(`normalizeScores`/`mergedScore`/`buildGroup`)의 실패하는 테스트를 쓴다.
   ```ts
   // apps/hub/src/search.test.ts
   import { describe, expect, it } from "vitest";
   import { buildGroup, mergedScore, normalizeScores, runSearch, type SearchDeps } from "./search.js";

   describe("normalizeScores (A4 §14.3 그룹 내 0~1 정규화)", () => {
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

   describe("buildGroup (그룹당 최대 5, total은 상한 전 개수)", () => {
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

   describe("runSearch (A4 §14.4 그룹 순서 고정 people→threads→items→memories)", () => {
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
             memory_id: "m1", content: "오전 미팅 선호", score: 0.9,
             recorded_at: "2026-09-01T00:00:00Z", valid_from: "2026-09-01T00:00:00Z", valid_until: null,
             source_item_id: null, source_kind: "self", source_ref: null,
           }],
         }),
         { q: "미팅" },
       );
       const memories = res.groups.find((g) => g.kind === "memories");
       expect(memories?.results[0]?.deep_link).toBeNull();
       expect(memories?.results[0]?.source_kind).toBe("self");
     });
     it("threads deep_links to the item's thread when a memory does have a source item", async () => {
       const res = await runSearch(
         fakeDeps({
           searchItems: async () => [{
             id: "i1", thread_id: "t1", subject: "계약서 요청", body: "확인 부탁드립니다",
             sent_at: "2026-09-19T09:00:00Z", channel: "gmail",
           }],
         }),
         { q: "계약서" },
       );
       const items = res.groups.find((g) => g.kind === "items");
       expect(items?.results[0]?.deep_link).toEqual({ screen: "thread", thread_id: "t1", item_id: "i1" });
     });
   });
   ```

6. [ ] 실행 → 실패 확인.
   ```bash
   pnpm --filter @omnis/hub test
   ```
   기대 출력: `Cannot find module './search.js'`.

7. [ ] `apps/hub/src/search.ts`를 구현한다.
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

   /** A4 §14.3: 그룹 안에서 0~1 정규화. 그룹 전체가 0이면(랭크 없음) 정규화도 전부 0. */
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
       title: r.title ?? "(제목 없음)",
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

   /** 실제 SQL 배선. A4 §14.2 표 그대로 — FTS 0건일 때만 trigram 폴백을 다시 쏜다. */
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

8. [ ] 재실행 → 통과 확인, 커밋.
   ```bash
   pnpm --filter @omnis/hub test
   ```
   기대 출력: `normalizeScores`/`mergedScore`/`buildGroup`/`runSearch` 전부 PASS.
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

9. [ ] `apps/hub/package.json`에 `@omnis/memory` 의존을 추가한다(델타 §1 "apps/hub → @omnis/memory 추가").
   ```json
   // apps/hub/package.json — "dependencies"에 한 줄 추가
   "@omnis/memory": "workspace:*",
   ```

10. [ ] `apps/hub/src/http.ts`의 마지막 분기("// /search, /memory/search, /transcript/:id는 다른 부록이 소유한다…") 바로 앞에 두 라우트를 추가한다.
    ```ts
    // apps/hub/src/http.ts — handle() 안, 기존 "/search... Phase A는 열지 않는다" 주석/404 이전에 삽입
    import { createSearchDeps, runSearch } from "./search.js";
    import { searchMemories } from "@omnis/memory";
    // (createHubServer 함수 상단, `const { kernel, pool, config, logger, startedAt } = deps;` 다음 줄)
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

11. [ ] 커밋.
    ```bash
    git add apps/hub/package.json apps/hub/src/http.ts
    git commit -m "$(cat <<'EOF'
    US-B26: wire GET /search and GET /memory/search into the hub HTTP server

    Implemented-by: Claude Opus
    Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
    EOF
    )"
    ```

**열린 질문**: `scope`/`since` 쿼리 파라미터는 A4 §14.2 SQL 표에 필터 조건으로 나타나지 않는다(파싱만 하고 미적용) — Phase B 실행 시점에 A4 저자에게 확인 필요.

---

### Task 2: ⌘K 검색 모드 (US-B27, tier: Sonnet)

**목표(백로그)**: 입력이 액션과 매치 안 되면 팔레트가 검색 결과로 전환, 그룹 순서 고정(people→threads→items→memories), 180ms 디바운스, `deep_link`가 null인 memory는 클릭 비활성, 빈 상태·느림 상태 카피.
**산출물**: `packages/ui/src/components/command-palette.tsx`(수정), `apps/desktop/src/api/search.ts`
**검증 명령**: `pnpm --filter @omnis/desktop test`
**의존**: B26
**읽을 스펙**: A5 §2.5(전체), §2.3(기존 팔레트 액션 카테고리 — 하위 호환 유지)
**하지 말 것(YAGNI)**: 그룹별 "더 보기" 페이지네이션, `scope` 필터 UI(Task 1이 서버에서 아직 안 쓰므로 UI도 안 만든다).

**Files:**
- Modify: `packages/ui/src/components/command-palette.tsx`
- Create: `apps/desktop/src/api/search.ts`
- Test: `packages/ui/test/command-palette.test.tsx`(확장), `apps/desktop/test/search-api.test.ts`

**Interfaces:**
- Consumes: `Command`(cmdk), `GlassSurface`(기존)
- Produces: `matchesAnyAction`, `UiSearchHit`, `UiSearchGroup`, `UiSearchGroupKind`, `CommandPaletteSearch`(모두 `command-palette.tsx`); `search`(`apps/desktop/src/api/search.ts`)

**Steps:**

1. [ ] 검색 모드 전환 판정(`matchesAnyAction`)의 실패하는 테스트를 쓴다.
   ```tsx
   // packages/ui/test/command-palette.test.tsx — 기존 파일에 describe 블록 추가
   import { matchesAnyAction, type PaletteAction, type UiSearchGroup } from "../src/components/command-palette.js";

   describe("matchesAnyAction (A5 §2.5: 입력이 액션과 안 맞으면 검색 모드)", () => {
     const actions: PaletteAction[] = [
       { id: "go-inbox", name: "Inbox로 이동", group: "이동", perform: () => {} },
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

2. [ ] 실행 → 실패 확인.
   ```bash
   pnpm --filter @omnis/ui test
   ```
   기대 출력: `matchesAnyAction is not exported`.

3. [ ] `command-palette.tsx`에 검색 모드 타입 + `matchesAnyAction` + `SearchResultList`를 추가하고, `CommandPalette`가 `search` prop이 있고 액션이 안 맞을 때 그 목록으로 전환하게 한다.
   ```tsx
   // packages/ui/src/components/command-palette.tsx — 기존 파일 상단부에 추가
   import { useEffect, useState } from "react";
   // (기존 import에 useState/useEffect 추가)

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

   /** A5 §2.5: 빈 입력은 항상 액션 모드, 아니면 등록된 액션 이름 중 하나라도 부분일치하면 액션 모드. */
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
         {search.loading && <div className="palette-search__loading">검색 중…</div>}
         {empty && <div className="palette-search__empty">{`${query}에 대한 검색 결과가 없어요`}</div>}
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

4. [ ] `CommandPaletteProps`에 `search?: CommandPaletteSearch`를 추가하고, `CommandPalette` 본문에서 `query` 상태 + 180ms 디바운스 + 모드 분기를 배선한다(기존 `resultList`/`Command.Input` 부분을 아래로 교체 — 기존 `Command.Dialog`/`GlassSurface` 뼈대는 그대로 두고 `search` prop 하나만 얹는다, mode/inline 팔레트는 이 스토리의 목표 밖이라 만들지 않는다).
   ```tsx
   // packages/ui/src/components/command-palette.tsx — CommandPaletteProps에 필드 추가
   export interface CommandPaletteProps {
     open: boolean;
     onOpenChange: (open: boolean) => void;
     actions: PaletteAction[];
     /** US-B27: 있으면 액션 미매치 시 검색 결과 모드로 전환한다. 없으면 Phase A 동작 그대로. */
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
         <Command.Empty>결과가 없어요</Command.Empty>
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
           <Command.Input value={query} onValueChange={setQuery} placeholder="검색 또는 명령…" />
           {resultList}
         </GlassSurface>
       </Command.Dialog>
     );
   }
   ```

5. [ ] 렌더링 테스트를 추가한다: 그룹 순서 고정 + deep_link 없는 memory 클릭 비활성.
   ```tsx
   // packages/ui/test/command-palette.test.tsx — 추가
   import { Command } from "cmdk";
   import { render, screen, fireEvent } from "@testing-library/react";
   import { CommandPalette } from "../src/components/command-palette.js";

   describe("CommandPalette search mode (A5 §2.5 그룹 순서 고정, memory deep_link 클릭 비활성)", () => {
     it("renders people before memories and blocks a deep_link-less memory hit", () => {
       const onSelectHit = vi.fn();
       const groups: UiSearchGroup[] = [
         { kind: "memories", label: "메모리", results: [
           { kind: "memory", id: "m1", title: "선호", snippet: "오전 미팅 선호", deepLinkDisabled: true },
         ] },
         { kind: "people", label: "사람", results: [
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
       fireEvent.click(screen.getByText("선호"));
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
       expect(screen.getByText("davich에 대한 검색 결과가 없어요")).toBeInTheDocument();
     });
   });
   ```

6. [ ] 실행 → 통과 확인, 커밋.
   ```bash
   pnpm --filter @omnis/ui test
   ```
   기대 출력: `matchesAnyAction` 3개 + `CommandPalette search mode` 2개 PASS.
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

7. [ ] 허브 `/search` 클라이언트의 실패하는 테스트를 쓴다(기존 `apps/desktop/src/api/approvals.ts`와 같은 패턴 — `fetch` stub).
   ```ts
   // apps/desktop/test/search-api.test.ts
   import { afterEach, describe, expect, it, vi } from "vitest";
   import { search } from "../src/api/search.js";

   describe("search (계약 §7 GET /search)", () => {
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

8. [ ] 실행 → 실패 확인.
   ```bash
   pnpm --filter @omnis/desktop test
   ```
   기대 출력: `Cannot find module '../src/api/search.js'`.

9. [ ] `apps/desktop/src/api/search.ts`를 구현한다(`approvals.ts`와 동일한 `HUB_HTTP_URL` 패턴).
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

10. [ ] 재실행 → 통과, 커밋.
    ```bash
    pnpm --filter @omnis/desktop test
    ```
    기대 출력: `search (계약 §7 GET /search)` 3개 PASS.
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

### Task 3: Today 화면 (US-B28, tier: Sonnet)

**목표(백로그)**: 인사말 `<h1>`, 밤 다이제스트 진입 카드(nightly가 있을 때만), 오늘 캘린더, 아침 브리핑 리스트(항목 클릭 → 스레드 딥링크), 대기 승인 칩 스트립(클릭 시 인라인 확장).
**산출물**: `apps/desktop/src/screens/Today.tsx`, `packages/ui/src/components/digest-card.tsx`
**검증 명령**: `pnpm --filter @omnis/desktop test`
**의존**: B23(아침 브리핑 루프 — `digests(kind='morning')` row를 채움)
**읽을 스펙**: A5 §3.4(전체), §5.2(`DigestCard` 역할)
**하지 말 것(YAGNI)**: 로딩/오류/오프라인 3상태 배너(스토리 목표는 화면 자체 — 상태 배너는 Inbox 전례처럼 별도 스코프로 후속), 인라인 `ApprovalSheet` 전체 4-way 재구현(기존 `ApprovalCardView`를 그대로 재사용).

**Files:**
- Create: `packages/ui/src/components/digest-card.tsx`, `apps/desktop/src/screens/Today.tsx`
- Test: `packages/ui/test/digest-card.test.tsx`, `apps/desktop/test/today-screen.test.tsx`

**Interfaces:**
- Consumes: `OpaqueSurface`, `Button`(기존 `@omnis/ui`), `ApprovalCardView`, `ApprovalCardInterrupt`(기존)
- Produces: `DigestCard`, `DigestCardProps`(`packages/ui/src/components/digest-card.tsx`); `greetingLine`, `isSameLocalDay`(`apps/desktop/src/screens/Today.tsx`)

**Steps:**

1. [ ] `DigestCard`(morning/nightly 공용) 테스트를 먼저 쓴다.
   ```tsx
   // packages/ui/test/digest-card.test.tsx
   import { describe, expect, it, vi } from "vitest";
   import { render, screen, fireEvent } from "@testing-library/react";
   import { DigestCard } from "../src/components/digest-card.js";

   describe("DigestCard (A5 §5.2 morning/nightly 공용)", () => {
     it("renders headline + body and calls onOpen", () => {
       const onOpen = vi.fn();
       render(
         <DigestCard kind="nightly" headline="밤 다이제스트 준비됨 · 42개 보관됨" body="9월 19일" onOpen={onOpen} />,
       );
       expect(screen.getByText("밤 다이제스트 준비됨 · 42개 보관됨")).toBeInTheDocument();
       fireEvent.click(screen.getByText("보기 →"));
       expect(onOpen).toHaveBeenCalled();
     });
     it("omits the open button when onOpen is not given", () => {
       render(<DigestCard kind="morning" headline="아침 브리핑" body="" />);
       expect(screen.queryByText("보기 →")).not.toBeInTheDocument();
     });
   });
   ```

2. [ ] 실행 → 실패.
   ```bash
   pnpm --filter @omnis/ui test
   ```
   기대 출력: `Cannot find module '../src/components/digest-card.js'`.

3. [ ] `DigestCard`를 구현한다.
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

   /** A5 §5.2: morning/nightly 다이제스트 공용 카드(카테고리 아코디언은 Digest 화면 쪽 책임, 여기는 진입 카드 형태). */
   export function DigestCard({ kind, headline, body, onOpen }: DigestCardProps) {
     return (
       <OpaqueSurface className="digest-card" data-digest-kind={kind}>
         <p className="digest-card__headline">{headline}</p>
         {body !== "" && <p className="digest-card__body">{body}</p>}
         {onOpen && (
           <Button variant="ghost" onClick={onOpen}>
             보기 →
           </Button>
         )}
       </OpaqueSurface>
     );
   }
   ```
   그리고 `packages/ui/src/index.ts`에 `export * from "./components/digest-card.js";`를 추가한다.

4. [ ] 재실행 → 통과, 커밋.
   ```bash
   pnpm --filter @omnis/ui test
   ```
   ```bash
   git add packages/ui/src/components/digest-card.tsx packages/ui/src/index.ts packages/ui/test/digest-card.test.tsx
   git commit -m "$(cat <<'EOF'
   US-B28: DigestCard component (A5 §5.2, morning/nightly 공용)

   Implemented-by: Claude Sonnet
   Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
   EOF
   )"
   ```

5. [ ] Today 화면의 순수 로직(인사말 문구, "오늘" 판정)부터 테스트한다 — Inbox.tsx 전례(순수 함수를 export해 Zero 마운트 없이 테스트)를 그대로 따른다.
   ```ts
   // apps/desktop/test/today-screen.test.tsx
   import { describe, expect, it } from "vitest";
   import { greetingLine, isSameLocalDay } from "../src/screens/Today";

   describe("greetingLine (A5 §3.4 인사말 <h1>)", () => {
     it("includes the pending item count and approval count", () => {
       expect(greetingLine("Logan", 12, 4)).toBe(
         "좋은 아침이에요, Logan. 오늘 처리할 항목 12개, 대기 중 승인 4건.",
       );
     });
     it("still reads naturally with zero of both", () => {
       expect(greetingLine("Logan", 0, 0)).toBe(
         "좋은 아침이에요, Logan. 오늘 처리할 항목 0개, 대기 중 승인 0건.",
       );
     });
   });

   describe("isSameLocalDay (오늘 캘린더 필터 판정)", () => {
     it("is true for two timestamps on the same calendar day", () => {
       expect(isSameLocalDay(new Date("2026-09-20T01:00:00"), new Date("2026-09-20T23:00:00"))).toBe(true);
     });
     it("is false across a day boundary", () => {
       expect(isSameLocalDay(new Date("2026-09-20T23:59:00"), new Date("2026-09-21T00:01:00"))).toBe(false);
     });
   });
   ```

6. [ ] 실행 → 실패.
   ```bash
   pnpm --filter @omnis/desktop test
   ```
   기대 출력: `Cannot find module '../src/screens/Today'`.

7. [ ] `Today.tsx`를 구현한다. 데이터 바인딩은 A5 §3.4 의사코드 그대로 — `digests`(morning/nightly), `items(kind='event')`, `pending_approvals` 4개를 각각 Zero로 읽고 클라이언트에서 조합한다(Inbox.tsx가 이미 증명한 패턴: 관계가 아니라 각자 쿼리 후 `useMemo`로 조인).
   ```tsx
   // apps/desktop/src/screens/Today.tsx
   import { OpaqueSurface } from "@omnis/ui";
   import { DigestCard } from "@omnis/ui/components/digest-card";
   import { ApprovalCardView, type ApprovalCardInterrupt } from "@omnis/ui/components/approval-card";
   import { useQuery } from "@rocicorp/zero/react";
   import { useMemo, useState } from "react";
   import { decideApproval } from "../api/approvals.js";
   import { initZero } from "../zero-client.js";

   const zero = initZero();

   /** A5 §3.4: 인사말 텍스트, 스크린리더가 페이지 요지를 즉시 읽도록 <h1>으로 렌더링된다. */
   export function greetingLine(name: string, pendingCount: number, approvalCount: number): string {
     return `좋은 아침이에요, ${name}. 오늘 처리할 항목 ${pendingCount}개, 대기 중 승인 ${approvalCount}건.`;
   }

   export function isSameLocalDay(a: Date, b: Date): boolean {
     return (
       a.getFullYear() === b.getFullYear() &&
       a.getMonth() === b.getMonth() &&
       a.getDate() === b.getDate()
     );
   }

   export function Today({ onOpenThread }: { onOpenThread?: (threadId: string) => void }) {
     const [expandedApprovalId, setExpandedApprovalId] = useState<string | null>(null);
     const now = useMemo(() => new Date(), []);

     const [morningDigests] = useQuery(zero.query.digests.where("kind", "=", "morning"));
     const [nightlyDigests] = useQuery(
       zero.query.digests.where("kind", "=", "nightly").orderBy("for_date", "desc").limit(1),
     );
     const [eventItems] = useQuery(zero.query.items.where("kind", "=", "event"));
     const [approvals] = useQuery(zero.query.pending_approvals.where("state", "=", "pending"));

     const morning = useMemo(
       () => morningDigests.find((d) => isSameLocalDay(new Date(d.for_date), now)) ?? null,
       [morningDigests, now],
     );
     const nightly = nightlyDigests[0] ?? null;
     const todaysEvents = useMemo(
       () => eventItems.filter((i) => isSameLocalDay(new Date(i.sent_at), now)).sort((a, b) => a.sent_at - b.sent_at),
       [eventItems, now],
     );

     return (
       <OpaqueSurface className="today-screen">
         <h1 className="today-screen__greeting">
           {greetingLine("Logan", todaysEvents.length + approvals.length, approvals.length)}
         </h1>

         {nightly && (
           <DigestCard
             kind="nightly"
             headline={`밤 다이제스트 준비됨 · ${nightly.item_ids.length}개 보관됨`}
             body=""
             onOpen={() => {}}
           />
         )}

         <section aria-label="오늘 일정">
           <h2>⏰ 오늘 일정</h2>
           <ul>
             {todaysEvents.map((e) => (
               <li key={e.id}>
                 <button type="button" onClick={() => onOpenThread?.(e.thread_id)}>
                   {e.subject ?? "(제목 없음)"}
                 </button>
               </li>
             ))}
           </ul>
         </section>

         {morning && (
           <section aria-label="아침 브리핑">
             <h2>📋 아침 브리핑</h2>
             <p>{morning.body}</p>
           </section>
         )}

         <section aria-label="대기 중 승인">
           <h2>⏳ 대기 중 승인 ({approvals.length})</h2>
           <div className="today-screen__approval-chips">
             {approvals.map((a) => (
               <button
                 key={a.id}
                 type="button"
                 aria-label={`대기 중 승인: ${a.description}`}
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

8. [ ] 재실행 → 통과, 커밋.
   ```bash
   pnpm --filter @omnis/desktop test
   ```
   기대 출력: `greetingLine`/`isSameLocalDay` 4개 PASS.
   ```bash
   git add apps/desktop/src/screens/Today.tsx apps/desktop/test/today-screen.test.tsx
   git commit -m "$(cat <<'EOF'
   US-B28: Today screen — greeting <h1>, nightly digest card, today's calendar, inline approval chips

   - greetingLine()/isSameLocalDay() are pure and unit-tested; the screen only wires Zero data to them
   - approval chip click expands ApprovalCardView inline (no screen navigation, A5 §3.4)

   Implemented-by: Claude Sonnet
   Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
   EOF
   )"
   ```

**열린 질문**: `digests.for_date`가 Zero 스키마에서 `number()`(epoch ms)로 선언돼 있다 — Postgres `date` 컬럼이 실제로 자정 UTC epoch로 오는지 KST 자정 기준인지 A21/Zero 변환 스파이크에서 확인되지 않았다. `isSameLocalDay`는 브라우저 로컬 타임존(맥이 KST면 문제 없음) 기준으로 짰다 — 서버가 UTC 자정을 보내면 밤 9시~자정 사이 브리핑이 하루 밀릴 수 있다.

---

### Task 4: Tasks 화면 (US-B29, tier: Sonnet)

**목표(백로그)**: 뷰 탭 4개(Today/This week/Someday/Delegated), `TaskRow`(네이티브 체크박스 + 출처 딥링크 + `kind` 아이콘 + `due_basis='inferred'` 점선), `t` 단축키 빠른 추가, Delegated 행 → Agent Session 이동, 위임 승인 카드 인라인.
**산출물**: `apps/desktop/src/screens/Tasks.tsx`, `packages/ui/src/components/task-row.tsx`
**검증 명령**: `pnpm --filter @omnis/desktop test`
**의존**: B19(투두 추출), B20(위임)
**읽을 스펙**: A5 §3.5(전체)
**하지 말 것(YAGNI)**: `t` 전역 단축키 배선(App.tsx 키맵 통합은 셸 소유 — 이 태스크는 빠른 추가용 입력 필드만 화면 안에 둔다, 실제 전역 키 리스너는 별도 범위), 위임 승인 카드의 커스텀 렌더링(기존 `ApprovalCardView` 재사용).

**Files:**
- Create: `packages/ui/src/components/task-row.tsx`, `apps/desktop/src/screens/Tasks.tsx`
- Test: `packages/ui/test/task-row.test.tsx`, `apps/desktop/test/tasks-screen.test.tsx`

**Interfaces:**
- Consumes: `Button`, `OpaqueSurface`(기존)
- Produces: `TaskRow`, `TaskRowProps`(`packages/ui/src/components/task-row.tsx`); `filterTasksByView`, `TasksView`, `dueBasisFor`(`apps/desktop/src/screens/Tasks.tsx`)

**Steps:**

1. [ ] `TaskRow`의 실패하는 테스트를 쓴다.
   ```tsx
   // packages/ui/test/task-row.test.tsx
   import { describe, expect, it, vi } from "vitest";
   import { render, screen, fireEvent } from "@testing-library/react";
   import { TaskRow } from "../src/components/task-row.js";

   const base = {
     id: "t1", title: "Davich PPT 초안 리뷰", kind: "todo" as const, state: "open" as const,
     dueBasis: "explicit" as const, dueLabel: "오늘 마감", sourceLabel: "Gmail",
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
       expect(screen.getByText("오늘 마감")).toHaveAttribute("data-due-basis", "inferred");
     });
     it("calls onOpenSource when the source link is clicked", () => {
       render(<TaskRow {...base} />);
       fireEvent.click(screen.getByText("Gmail"));
       expect(base.onOpenSource).toHaveBeenCalled();
     });
   });
   ```

2. [ ] 실행 → 실패.
   ```bash
   pnpm --filter @omnis/ui test
   ```

3. [ ] `TaskRow`를 구현한다.
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
   const KIND_LABEL: Record<TaskKind, string> = { todo: "할 일", followup: "팔로업", delegation: "위임" };

   export interface TaskRowProps {
     id: string;
     title: string;
     kind: TaskKind;
     state: TaskState;
     /** A3에는 컬럼이 없다 — created_by==='agent'면 inferred로 취급한다(Task 4 열린 질문 참고). */
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
         <Icon size={14} aria-label={`${KIND_LABEL[props.kind]} 아이템`} />
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
             진행 중
           </button>
         )}
       </div>
     );
   }
   ```
   `packages/ui/src/index.ts`에 `export * from "./components/task-row.js";` 추가.

4. [ ] 재실행 → 통과, 커밋.
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

5. [ ] 뷰 필터(`filterTasksByView`)와 `dueBasisFor` 순수 함수의 실패하는 테스트를 쓴다.
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

   describe("filterTasksByView (A5 §3.5 뷰 탭 4개)", () => {
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

   describe("dueBasisFor (A3에 due_basis 컬럼이 없어 created_by로 추론)", () => {
     it("is inferred for agent-created tasks", () => {
       expect(dueBasisFor("agent")).toBe("inferred");
     });
     it("is explicit for me-created tasks", () => {
       expect(dueBasisFor("me")).toBe("explicit");
     });
   });
   ```

6. [ ] 실행 → 실패.
   ```bash
   pnpm --filter @omnis/desktop test
   ```

7. [ ] `Tasks.tsx`를 구현한다.
   ```tsx
   // apps/desktop/src/screens/Tasks.tsx
   import { OpaqueSurface } from "@omnis/ui";
   import { TaskRow, type TaskKind, type TaskState } from "@omnis/ui/components/task-row";
   import { useQuery } from "@rocicorp/zero/react";
   import { useMemo, useState } from "react";
   import { initZero } from "../zero-client.js";

   const zero = initZero();

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

   /** A5 §3.5: Today/This week/Someday는 due_at 기준, Delegated는 owner_kind='agent'만(마감일 무관). */
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

   /** A3 tasks 테이블에 due_basis 컬럼이 없다 — agent가 만든 task는 L3 추출(추론), 내가 만든 건 명시로 다룬다. */
   export function dueBasisFor(createdBy: string): "explicit" | "inferred" {
     return createdBy === "agent" ? "inferred" : "explicit";
   }

   export function Tasks({ onOpenSource, onOpenDelegation }: {
     onOpenSource?: (itemId: string) => void;
     onOpenDelegation?: (sessionId: string) => void;
   }) {
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
         <div role="tablist" aria-label="Tasks 뷰">
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
             aria-label="빠른 할 일 추가"
             value={quickAdd}
             onChange={(e) => setQuickAdd(e.target.value)}
             placeholder="새 할 일…"
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
                   sourceLabel={t.source_item_id ? "출처 보기" : null}
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

8. [ ] 재실행 → 통과, 커밋.
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

**열린 질문**: `t` 전역 단축키(빠른 추가 포커스 이동)와 체크박스의 실제 `state:'done'` 낙관적 업데이트(hub PATCH 라우트)는 계약에 없다 — Phase A `use-keymap.ts`에 `t` 등록 + 새 hub 라우트(예: `POST /tasks/:id/toggle`) 신설이 필요할 수 있다, 실행 시점에 agents 플랜(L3 산출물 owner)과 라우트 소유를 조율해야 한다. `dueBasisFor`의 `created_by==='agent'` 추론은 A3에 전용 컬럼이 없어서 나온 근사치다.

---

### Task 5: Network 화면 (US-B30, tier: Sonnet)

**목표(백로그)**: `PersonCard`(이니셜 아바타, 소속·직함, 관계 dot 3단 + 텍스트 레이블), 팔로업 큐 상단 스트립, 사람 상세 pane, 병합/분리 UI.
**산출물**: `apps/desktop/src/screens/Network.tsx`, `packages/ui/src/components/person-card.tsx`
**검증 명령**: `pnpm --filter @omnis/desktop test`
**의존**: B03(person 신원 해석), B22(팔로업 루프 — `persons.next_followup_at`/`priority_score`를 채움)
**읽을 스펙**: A5 §3.6(전체)
**하지 말 것(YAGNI)**: "같은 사람입니다" 병합/분리 UI의 실제 동작(백엔드 `mergePersons`/`splitIdentity`는 memory-ingestion 플랜 소유 — 이 태스크는 진입 버튼만 두고 다이얼로그 내용은 후속 범위로 남긴다, 열린 질문에 기록), 그리드/리스트 토글.

**Files:**
- Create: `packages/ui/src/components/person-card.tsx`, `apps/desktop/src/screens/Network.tsx`
- Test: `packages/ui/test/person-card.test.tsx`, `apps/desktop/test/network-screen.test.tsx`

**Interfaces:**
- Consumes: `OpaqueSurface`, `Button`, `initialsFromName`, `pastelFromName`(기존 `@omnis/ui/lib/row-meta`)
- Produces: `PersonCard`, `PersonCardProps`, `relationshipDot`, `RelationshipDot`(`packages/ui/src/components/person-card.tsx`); `followupQueue`(`apps/desktop/src/screens/Network.tsx`)

**Steps:**

1. [ ] `relationshipDot` + `PersonCard` 렌더링의 실패하는 테스트를 쓴다.
   ```tsx
   // packages/ui/test/person-card.test.tsx
   import { describe, expect, it, vi } from "vitest";
   import { render, screen } from "@testing-library/react";
   import { PersonCard, relationshipDot } from "../src/components/person-card.js";

   describe("relationshipDot (A5 §3.6 관계 상태 3단 + unknown은 dot 없음)", () => {
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
           lastContactLabel="3일 전" onOpen={vi.fn()} />,
       );
       expect(screen.getByText("David Park")).toBeInTheDocument();
       expect(screen.getByText("Davich · CTO")).toBeInTheDocument();
       expect(screen.getByLabelText("관계 상태: 활성")).toBeInTheDocument();
     });
   });
   ```

2. [ ] 실행 → 실패.
   ```bash
   pnpm --filter @omnis/ui test
   ```

3. [ ] `PersonCard`를 구현한다.
   ```tsx
   // packages/ui/src/components/person-card.tsx
   import { Button } from "./button.js";
   import { OpaqueSurface } from "./glass-surface.js";
   import { initialsFromName, pastelFromName } from "../lib/row-meta.js";

   export type PersonRelationshipState = "unknown" | "new" | "warming" | "active" | "dormant" | "closed";
   export type RelationshipDot = "active" | "warming" | "dormant" | "unknown";

   /** A5 §3.6: 카드에 노출하는 3단 + unknown(dot 없음, 텍스트만). */
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
     active: "활성",
     warming: "관계 형성 중",
     dormant: "방치 위험",
     unknown: "정보 부족",
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
           <span className="person-card__dot" data-dot={dot} aria-label={`관계 상태: ${DOT_LABEL[dot]}`}>
             {DOT_LABEL[dot]}
           </span>
           <span className="person-card__last-contact">마지막 연락: {props.lastContactLabel}</span>
         </button>
         {props.followupDraft && (
           <div className="person-card__followup">
             <p>{props.followupDraft.body}</p>
             <Button onClick={props.followupDraft.onEditAndSend}>수정 후 보내기</Button>
           </div>
         )}
       </OpaqueSurface>
     );
   }
   ```
   `packages/ui/src/index.ts`에 `export * from "./components/person-card.js";` 추가.

4. [ ] 재실행 → 통과, 커밋.
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

5. [ ] 팔로업 큐 정렬(`followupQueue`)의 실패하는 테스트를 쓴다 — L6 루프(B22)가 이미 `next_followup_at`/`priority_score`를 채워 두므로 화면은 그 값을 필터+정렬만 한다.
   ```ts
   // apps/desktop/test/network-screen.test.tsx
   import { describe, expect, it } from "vitest";
   import { followupQueue, type FollowupCandidate } from "../src/screens/Network";

   const now = new Date("2026-09-20T00:00:00").getTime();
   const persons: FollowupCandidate[] = [
     { id: "1", nextFollowupAt: now - 1000, priorityScore: 0.5, mergedInto: null },
     { id: "2", nextFollowupAt: now + 100_000, priorityScore: 0.9, mergedInto: null }, // 아직 안 됨
     { id: "3", nextFollowupAt: now - 5000, priorityScore: 0.9, mergedInto: null },
     { id: "4", nextFollowupAt: now - 1000, priorityScore: 0.1, mergedInto: "1" }, // 병합된 person 제외
     { id: "5", nextFollowupAt: null, priorityScore: 0.3, mergedInto: null },
   ];

   describe("followupQueue (persons.next_followup_at ≤ now, priority_score 내림차순, 병합 제외)", () => {
     it("returns only due, non-merged persons ordered by priority", () => {
       expect(followupQueue(persons, now).map((p) => p.id)).toEqual(["3", "1"]);
     });
   });
   ```

6. [ ] 실행 → 실패.
   ```bash
   pnpm --filter @omnis/desktop test
   ```

7. [ ] `Network.tsx`를 구현한다.
   ```tsx
   // apps/desktop/src/screens/Network.tsx
   import { OpaqueSurface } from "@omnis/ui";
   import { PersonCard, type PersonRelationshipState } from "@omnis/ui/components/person-card";
   import { formatRelativeTime } from "@omnis/ui/lib/relative-time";
   import { useQuery } from "@rocicorp/zero/react";
   import { useMemo } from "react";
   import { initZero } from "../zero-client.js";

   const zero = initZero();

   export interface FollowupCandidate {
     id: string;
     nextFollowupAt: number | null;
     priorityScore: number;
     mergedInto: string | null;
   }

   /** A3 persons_followup_idx와 같은 조건: 병합 안 됐고 next_followup_at이 지났으면 큐에 들어가고,
    * priority_score 내림차순(L6 팔로업 루프, US-B22가 이미 계산해 둔 값 — 화면은 재계산하지 않는다). */
   export function followupQueue<T extends FollowupCandidate>(persons: T[], now: number): T[] {
     return persons
       .filter((p) => p.mergedInto === null && p.nextFollowupAt !== null && p.nextFollowupAt <= now)
       .sort((a, b) => b.priorityScore - a.priorityScore);
   }

   export function Network({ onOpenPerson }: { onOpenPerson?: (id: string) => void }) {
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
                 lastContactLabel={p.last_contact_at ? formatRelativeTime(p.last_contact_at) : "없음"}
                 followupDraft={queueIds.has(p.id) ? { body: "팔로업 초안 준비 중", onEditAndSend: () => {} } : null}
                 onOpen={(id) => onOpenPerson?.(id)}
               />
             ))}
         </div>
       </OpaqueSurface>
     );
   }
   ```

8. [ ] 재실행 → 통과, 커밋.
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

**열린 질문**: 사람 상세 pane(타임라인 + 전 채널 링크 + 메모)과 "같은 사람입니다" 병합/분리 다이얼로그는 이 태스크에서 진입 버튼만 있고 내용은 없다 — `mergePersons`/`splitIdentity`(memory-ingestion US-B03)를 호출하는 후속 태스크가 필요하다. `persons.primary_thread_id`를 통한 팔로업 draft 실조회(A5 §3.6 데이터 바인딩의 `related("primaryThread", …)`)도 스텁이다 — zeroSchema에 `persons→primaryThread` 관계가 없어 Inbox.tsx 패턴대로 별도 `threads`/`items` 쿼리를 조인해야 하는데, 이 태스크는 그 조인 없이 고정 문구를 쓴다.

---

### Task 6: Notes 화면 (US-B31, tier: Sonnet)

**목표(백로그)**: 한 줄 입력(`n` 전역 단축키, 저장 후 포커스 유지), `RoutingSuggestion` 3버튼(수락/다른 대상/라우팅 안 함), 신뢰도는 텍스트로만, 오류와 no-match를 구분하지 않는다.
**산출물**: `apps/desktop/src/screens/Notes.tsx`
**검증 명령**: `pnpm --filter @omnis/desktop test`
**의존**: B21(노트 라우팅 루프 — `notes.route_state`/`routed_to_*`를 채움)
**읽을 스펙**: A4 §8.3(신뢰도 게이팅 — 낮으면 제안 자체를 안 만듦, 그래서 화면은 숫자 신뢰도를 다룰 필요가 없다), A5 §3.7(전체)
**하지 말 것(YAGNI)**: "다른 대상 선택" 피커 UI(사람/스레드 검색 재사용은 B27 완료 후 후속 범위 — 이 태스크는 버튼만 두고 클릭 핸들러는 no-op), `n` 전역 단축키 배선(Today의 `t`와 같은 이유로 셸 통합은 범위 밖).

**Files:**
- Create: `apps/hub/src/notes.ts`, `apps/desktop/src/api/notes.ts`, `apps/desktop/src/screens/Notes.tsx`
- Modify: `apps/hub/src/http.ts`(POST /notes/:id/route 라우트 추가)
- Test: `apps/hub/src/notes.test.ts`, `apps/desktop/test/notes-screen.test.tsx`

**Interfaces:**
- Consumes: `query`/`one`(`@omnis/db`), `Audit`(선택 — 이 태스크는 `audit_log` 직접 insert로 단순화, Task 8 settings.ts와 같은 패턴)
- Produces: `decideNoteRouting`(`apps/hub/src/notes.ts`, **이 델타에는 없던 라우트라 이 플랜이 새로 소유한다** — 아래 열린 질문 참고), `routeNote`(`apps/desktop/src/api/notes.ts`), `routingSuggestionCopy`, `hasRoutingSuggestion`(`apps/desktop/src/screens/Notes.tsx`)

**Steps:**

1. [ ] 라우팅 카피 순수 함수의 실패하는 테스트를 쓴다 — A4 §8.3 덕에 신뢰도 숫자가 아니라 "제안이 있는가"만 보면 된다(있으면 이미 임계를 넘긴 것).
   ```ts
   // apps/desktop/test/notes-screen.test.tsx
   import { describe, expect, it } from "vitest";
   import { hasRoutingSuggestion, routingSuggestionCopy, type NoteRouteRow } from "../src/screens/Notes";

   describe("hasRoutingSuggestion (A4 §8.3: 낮은 신뢰도는 제안 자체가 없다)", () => {
     it("is true only when route_state is 'proposed'", () => {
       expect(hasRoutingSuggestion({ route_state: "proposed" } as NoteRouteRow)).toBe(true);
       expect(hasRoutingSuggestion({ route_state: "none" } as NoteRouteRow)).toBe(false);
       expect(hasRoutingSuggestion({ route_state: "accepted" } as NoteRouteRow)).toBe(false);
     });
   });

   describe("routingSuggestionCopy (A5 §3.7: 신뢰도는 텍스트로만, 퍼센트 없음)", () => {
     it("names the target and says 신뢰도 높음 when a suggestion exists", () => {
       expect(routingSuggestionCopy({ route_state: "proposed" } as NoteRouteRow, "David Park 스레드")).toBe(
         "라우팅 제안: David Park 스레드에 공유 (신뢰도 높음)",
       );
     });
     it("falls back to the no-match copy otherwise — same copy for error and no-match", () => {
       expect(routingSuggestionCopy({ route_state: "none" } as NoteRouteRow, null)).toBe(
         "라우팅 대상을 찾지 못했어요 — 수동으로 선택",
       );
     });
   });
   ```

2. [ ] 실행 → 실패.
   ```bash
   pnpm --filter @omnis/desktop test
   ```

3. [ ] `apps/hub/src/notes.ts` + `apps/desktop/src/api/notes.ts`의 실패하는 테스트를 쓴다(허브 클라이언트 계약, `search.ts`/`approvals.ts`와 같은 패턴).
   ```ts
   // apps/hub/src/notes.test.ts
   import { describe, expect, it, vi } from "vitest";
   import { decideNoteRouting } from "./notes.js";

   describe("decideNoteRouting (US-B31 — 계약에 없던 라우트, 이 플랜이 신설)", () => {
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

4. [ ] 실행 → 실패.
   ```bash
   pnpm --filter @omnis/hub test
   ```

5. [ ] `apps/hub/src/notes.ts`를 구현한다.
   ```ts
   // apps/hub/src/notes.ts
   import { query } from "@omnis/db";
   import type { Pool } from "pg";

   export interface NoteRouteDecision {
     decision: "accept" | "none";
     /** "다른 대상 선택"(후속 범위)에서만 쓴다 — 이 태스크는 accept/none만 지원한다. */
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

6. [ ] 재실행 → 통과, `http.ts`에 라우트를 배선한다(기존 `/search` 분기 근처에 추가), 커밋.
   ```bash
   pnpm --filter @omnis/hub test
   ```
   ```ts
   // apps/hub/src/http.ts — handle() 안에 추가
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

7. [ ] `apps/desktop/src/api/notes.ts`(클라이언트) + `Notes.tsx`(화면)를 구현한다.
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
   import { initZero } from "../zero-client.js";

   const zero = initZero();

   export interface NoteRouteRow {
     route_state: "proposed" | "accepted" | "rejected" | "none";
   }

   export function hasRoutingSuggestion(note: NoteRouteRow): boolean {
     return note.route_state === "proposed";
   }

   /** A5 §3.7: 신뢰도는 텍스트로만("신뢰도 높음"), 에러와 no-match는 같은 문구로 수렴한다. */
   export function routingSuggestionCopy(note: NoteRouteRow, targetLabel: string | null): string {
     if (hasRoutingSuggestion(note) && targetLabel !== null) {
       return `라우팅 제안: ${targetLabel}에 공유 (신뢰도 높음)`;
     }
     return "라우팅 대상을 찾지 못했어요 — 수동으로 선택";
   }

   export function Notes() {
     const [body, setBody] = useState("");
     const [notes] = useQuery(zero.query.notes.orderBy("created_at", "desc").limit(20));

     return (
       <OpaqueSurface className="notes-screen">
         <form
           onSubmit={(e) => {
             e.preventDefault();
             if (body.trim() === "") return;
             // 실제 insert는 hub POST /notes(계약 밖, 후속 범위) — 이 태스크는 입력·초기화만 증명한다.
             setBody("");
           }}
         >
           <input
             aria-label="새 노트"
             value={body}
             onChange={(e) => setBody(e.target.value)}
             placeholder="새 노트…"
           />
           <button type="submit">저장</button>
         </form>

         <ul>
           {notes.map((n) => {
             const targetLabel = n.routed_to_person_id ? "Network 대상" : n.routed_to_thread_id ? "스레드" : null;
             const route: NoteRouteRow = { route_state: n.route_state as NoteRouteRow["route_state"] };
             return (
               <li key={n.id}>
                 <p>{n.body}</p>
                 <p>{routingSuggestionCopy(route, targetLabel)}</p>
                 {hasRoutingSuggestion(route) && (
                   <div>
                     <button type="button" onClick={() => void routeNote(n.id, "accept")}>
                       수락
                     </button>
                     <button type="button" disabled>
                       다른 대상 선택
                     </button>
                     <button type="button" onClick={() => void routeNote(n.id, "none")}>
                       라우팅 안 함
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

8. [ ] 재실행 → 통과, 커밋.
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

**열린 질문**: `POST /notes` (노트 생성 자체)와 `POST /notes/:id/route`의 "다른 대상 선택"은 Phase B 인터페이스 델타 §7 라우트 표에 없다 — 이 플랜이 후자의 최소 버전(accept/none)만 신설했다. 노트 생성 라우트와 대상 피커는 별도 후속 태스크가 필요하다(B27의 검색 인프라를 재사용할 여지가 크다).

---

### Task 7: Digest 화면 (US-B32, tier: Sonnet)

**목표(백로그)**: 카테고리 아코디언, 그룹·개별 되살리기(낙관적 업데이트 + toast), 월간 비용 리포트 섹션, Thread 헤더의 자동 보관 배너(7일 이내만).
**산출물**: `apps/desktop/src/screens/Digest.tsx`
**검증 명령**: `pnpm --filter @omnis/desktop test`
**의존**: B24(밤 다이제스트 루프 — `digests(kind='nightly').metrics`를 채움)
**읽을 스펙**: A4 §6.4(`NightlyDigest`/`DigestGroup` 모델), A5 §3.8(전체)
**하지 말 것(YAGNI)**: Thread 헤더 배너 자체 구현(§3.2가 소유 — 이 태스크는 배너가 쓰는 것과 같은 `unarchiveItem` 클라이언트 함수만 만든다), toast 라이브러리 배선(Sonner는 A5 §5.1에 있지만 실제 토스트 연결은 후속 범위, 여기서는 `onRestored` 콜백만 노출).

**Files:**
- Create: `apps/desktop/src/api/digest.ts`, `apps/desktop/src/screens/Digest.tsx`
- Modify: `apps/hub/src/http.ts`(POST /items/:id/unarchive, POST /digests/:id/undo 라우트 추가)
- Test: `apps/hub/src/archive-routes.test.ts`, `apps/desktop/test/digest-screen.test.tsx`

**Interfaces:**
- Consumes: `undoArchive`(`@omnis/kernel`, agents US-B18 산출물), `query`/`one`(`@omnis/db`)
- Produces: `handleUnarchiveItem`, `handleDigestUndo`(`apps/hub/src/http.ts`에 인라인 — 별도 모듈 없이 기존 `kernel.approvals`류 얇은 핸들러 패턴), `unarchiveItem`, `undoDigestGroup`(`apps/desktop/src/api/digest.ts`); `groupsFromMetrics`, `monthlyCostLine`(`apps/desktop/src/screens/Digest.tsx`)

**Steps:**

1. [ ] `groupsFromMetrics`/`monthlyCostLine` 순수 함수의 실패하는 테스트를 쓴다. `digests.metrics`(jsonb, 컬럼 변경 없음 — 델타 §6)가 `NightlyDigest`의 `auto_archived`/`cost` 필드를 그대로 담는다고 가정한다(아래 열린 질문 참고).
   ```ts
   // apps/desktop/test/digest-screen.test.tsx
   import { describe, expect, it } from "vitest";
   import { groupsFromMetrics, monthlyCostLine } from "../src/screens/Digest";

   describe("groupsFromMetrics (digests.metrics에 담긴 NightlyDigest.auto_archived를 안전하게 읽기)", () => {
     it("returns the groups array when shaped correctly", () => {
       const metrics = { auto_archived: [{ reason: "뉴스레터", count: 12, samples: [], undo_token: "tok1" }] };
       expect(groupsFromMetrics(metrics)).toEqual(metrics.auto_archived);
     });
     it("returns an empty array for missing or malformed metrics (no crash on a bad row)", () => {
       expect(groupsFromMetrics({})).toEqual([]);
       expect(groupsFromMetrics(null)).toEqual([]);
       expect(groupsFromMetrics({ auto_archived: "not-an-array" })).toEqual([]);
     });
   });

   describe("monthlyCostLine (A5 §3.8 '이번 달 비용 리포트: $34 / $60 (57%)')", () => {
     it("formats month-to-date over cap with a rounded percentage", () => {
       expect(monthlyCostLine({ month_to_date_usd: 34, cap_usd: 60 })).toBe(
         "이번 달 비용 리포트: $34 / $60 (57%)",
       );
     });
   });
   ```

2. [ ] 실행 → 실패.
   ```bash
   pnpm --filter @omnis/desktop test
   ```

3. [ ] 허브 라우트(`POST /items/:id/unarchive`, `POST /digests/:id/undo`)의 실패하는 테스트를 쓴다. `http.ts`를 통째로 `node:http` 목업으로 띄우는 대신(비용이 크다), 위임 대상 핸들러를 별도 함수로 export해 직접 단위 테스트한다 — 두 라우트 모두 `@omnis/kernel`의 `undoArchive`(B18)를 호출하는 얇은 위임이라 새 모듈은 이 함수 둘만 담는다.
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

4. [ ] 실행 → 실패.
   ```bash
   pnpm --filter @omnis/hub test
   ```
   기대 출력: `Cannot find module './archive-routes.js'`.

5. [ ] `apps/hub/src/archive-routes.ts`를 구현하고 `http.ts`에 배선한다.
   ```ts
   // apps/hub/src/archive-routes.ts
   /** pool은 http.ts가 이미 갖고 있으므로 부분적용해 넘긴다 — 이 모듈은 pg를 몰라도 된다. */
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
   // apps/hub/src/http.ts — 추가 import + 라우트(handle() 안, /search 근처)
   import { handleDigestUndo, handleUnarchiveItem, type ArchiveDeps } from "./archive-routes.js";
   import { undoArchive } from "@omnis/kernel";
   // (createHubServer 함수 상단, pool을 부분적용해 archive-routes.ts가 pg를 직접 의존하지 않게 한다)
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

6. [ ] 재실행 → 통과, 커밋.
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

7. [ ] `apps/desktop/src/api/digest.ts` + `Digest.tsx`를 구현한다.
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
   import { initZero } from "../zero-client.js";

   const zero = initZero();

   export interface DigestGroup {
     reason: string;
     count: number;
     samples: unknown[];
     undo_token: string;
   }

   /** A3 digests.metrics는 컬럼 변경 없이 jsonb다(델타 §6) — NightlyDigest.auto_archived를 여기 담는다고
    * 가정하고 방어적으로 읽는다(형태가 안 맞으면 빈 배열, 화면이 죽지 않는다). */
   export function groupsFromMetrics(metrics: unknown): DigestGroup[] {
     if (typeof metrics !== "object" || metrics === null) return [];
     const auto = (metrics as { auto_archived?: unknown }).auto_archived;
     return Array.isArray(auto) ? (auto as DigestGroup[]) : [];
   }

   export function monthlyCostLine(cost: { month_to_date_usd: number; cap_usd: number }): string {
     const pct = Math.round((cost.month_to_date_usd / cost.cap_usd) * 100);
     return `이번 달 비용 리포트: $${cost.month_to_date_usd} / $${cost.cap_usd} (${pct}%)`;
   }

   export function Digest() {
     const [expanded, setExpanded] = useState<Set<string>>(new Set());
     const [nightlyDigests] = useQuery(
       zero.query.digests.where("kind", "=", "nightly").orderBy("for_date", "desc").limit(1),
     );
     const digest = nightlyDigests[0] ?? null;
     if (!digest) {
       return <OpaqueSurface className="digest-screen">오늘 밤 다이제스트는 아직 생성 전이에요, 23:00에 생성됩니다</OpaqueSurface>;
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
               모두 되살리기
             </button>
           </section>
         ))}
         {cost && <p>{monthlyCostLine(cost)}</p>}
       </OpaqueSurface>
     );
   }
   ```

8. [ ] 재실행 → 통과, 커밋.
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

**열린 질문**: `digests.metrics`가 `NightlyDigest.auto_archived`/`cost`를 그대로 담는다는 것은 이 플랜의 **가정**이다 — A3/델타 어디에도 `metrics`의 내부 shape이 고정돼 있지 않다(컬럼은 jsonb일 뿐). 밤 다이제스트 생성 루프(agents US-B24, `packages/agents/src/loops/digest-nightly.ts`)가 정확히 이 shape으로 쓰는지 실행 시점에 맞춰봐야 한다.

---

### Task 8: Settings 화면 + `settings` 쓰기 경로 (US-B33, tier: Sonnet)

**목표(백로그)**: 서브 nav 4개(Accounts/Autonomy/Model tiers/General), 비용 상한 편집 가능 입력 + 진행률 바(예비비 10% 세그먼트, 80%/100% 색+텍스트 병기), 자율 허용 토글(기본 꺼짐 + 경고), allowlist 편집, kill switch 2단계 확인.
**산출물**: `apps/desktop/src/screens/Settings.tsx`, `apps/hub/src/settings.ts`
**검증 명령**: `pnpm --filter @omnis/desktop test && pnpm --filter @omnis/hub test`
**의존**: B09/B11(allowlist 대상), B14(비용 정책 — `costState`/`currentPolicy`), B18(자동 보관 임계)
**읽을 스펙**: 델타 §5(`SettingKey`/`getSetting`/`setSetting`/`SETTING_DEFAULTS`), §6(`0009_settings.sql`), §7(`/settings`·`/cost`), §10(Zero 복제에 `settings` 추가), A5 §3.9(전체)
**하지 말 것(YAGNI)**: KakaoTalk D-9 카운트다운 배지(계정 연결 상태 자체가 이 태스크 범위 밖 — Accounts 서브탭은 `zero.query.accounts` 나열만), Model tiers의 민감도 규칙 읽기 전용 표(값이 정적이라 하드코드 텍스트로 충분, YAGNI).

**Files:**
- Create: `packages/db/migrations/0009_settings.sql`, `packages/db/migrations/0013_publication_phase_b.sql`, `packages/kernel/src/settings.ts`, `apps/hub/src/settings.ts`, `apps/desktop/src/api/settings.ts`, `apps/desktop/src/screens/Settings.tsx`
- Modify: `packages/kernel/src/zero-schema.ts`(`settings` 테이블 추가), `packages/kernel/src/index.ts`(settings re-export), `apps/hub/src/http.ts`(GET/PUT /settings, GET /cost 라우트), `apps/hub/src/config.ts`(변화 없음 — 참고만)
- Test: `packages/kernel/test/settings.test.ts`, `apps/hub/src/settings.test.ts`, `apps/desktop/test/settings-screen.test.tsx`

**Interfaces:**
- Consumes: `query`(`@omnis/db`), `currentPolicy`(`@omnis/kernel`, agents US-B14 산출물)
- Produces: `SettingKey`, `SETTING_DEFAULTS`, `getSetting`, `setSetting`(`packages/kernel/src/settings.ts`, 델타 §5 그대로); `getAllSettings`, `putSetting`(`apps/hub/src/settings.ts`); `getSetting`/`putSetting` 클라이언트(`apps/desktop/src/api/settings.ts`); `costBarSegments`, `costBarState`(`apps/desktop/src/screens/Settings.tsx`)

**Steps:**

1. [ ] `packages/db/migrations/0009_settings.sql`을 쓴다(델타 §6 표 그대로 — 이 태스크의 검증 명령에 `test:integration`이 없으므로 실제 DB 적용 테스트는 이 태스크 범위 밖, 다음 웨이브의 통합 테스트가 검증한다).
   ```sql
   -- packages/db/migrations/0009_settings.sql
   CREATE TABLE settings (
     key        text PRIMARY KEY,
     value      jsonb NOT NULL,
     updated_at timestamptz NOT NULL DEFAULT now()
   );

   -- omnis_control은 이미 0007_notify.sql이 만든 채널이다 — settings 변경을 얹어 탄다(델타 §6: 새 NOTIFY 채널 없음).
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

2. [ ] `packages/db/migrations/0013_publication_phase_b.sql`을 쓴다(델타 §6 — `ingest_sources`/`push_subscriptions`는 넣지 않는다).
   ```sql
   -- packages/db/migrations/0013_publication_phase_b.sql
   ALTER PUBLICATION zero_omnis ADD TABLE settings;
   ```

3. [ ] 커밋(마이그레이션은 append-only 파일이라 그 자체로 검증 가능한 단위 — 별도 red/green 없이 파일 추가로 커밋한다).
   ```bash
   git add packages/db/migrations/0009_settings.sql packages/db/migrations/0013_publication_phase_b.sql
   git commit -m "$(cat <<'EOF'
   US-B33: 0009_settings.sql + 0013_publication_phase_b.sql (delta §6)

   Implemented-by: Claude Sonnet
   Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
   EOF
   )"
   ```

4. [ ] `packages/kernel/src/settings.ts`의 실패하는 테스트를 쓴다(pg Pool을 실제 DB 없이 흉내 — `@omnis/db`의 `query()`가 `pool.query(sql, params)`를 그대로 부르므로 `{query: vi.fn()}`이면 충분하다).
   ```ts
   // packages/kernel/test/settings.test.ts
   import { describe, expect, it, vi } from "vitest";
   import { getSetting, setSetting, SETTING_DEFAULTS } from "../src/settings.js";

   function fakePool(rows: unknown[]) {
     return { query: vi.fn().mockResolvedValue({ rows }) };
   }

   describe("SETTING_DEFAULTS", () => {
     it("has every allowlist key defaulting to an empty array (계약 §5)", () => {
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

5. [ ] 실행 → 실패.
   ```bash
   pnpm --filter @omnis/kernel test
   ```
   기대 출력: `Cannot find module '../src/settings.js'`.

6. [ ] `packages/kernel/src/settings.ts`를 구현한다(델타 §5 시그니처 그대로).
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

   /** audit_log는 계약 §5가 필수로 못박는다 — settings.ts는 pool만 받는 낮은 레벨 모듈이라
    * Kernel.audit(순환 의존 유발)을 거치지 않고 직접 insert한다(identity.ts와 같은 패턴). */
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
   `packages/kernel/src/index.ts`에 `export * from "./settings.js";` 추가.

7. [ ] 재실행 → 통과, 커밋.
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

8. [ ] `apps/hub/src/settings.ts`(전체 키 열거 + PUT 검증)의 실패하는 테스트를 쓴다.
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

9. [ ] 실행 → 실패.
   ```bash
   pnpm --filter @omnis/hub test
   ```

10. [ ] `apps/hub/src/settings.ts`를 구현한다.
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

11. [ ] 재실행 → 통과. `http.ts`에 `/settings`·`/cost` 라우트를 배선한다(agents US-B14의 `currentPolicy`를 가정 — 웨이브 순서상 이미 머지돼 있다).
    ```bash
    pnpm --filter @omnis/hub test
    ```
    ```ts
    // apps/hub/src/http.ts — 추가 import + 라우트
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

12. [ ] 커밋.
    ```bash
    git add apps/hub/src/settings.ts apps/hub/src/settings.test.ts apps/hub/src/http.ts
    git commit -m "$(cat <<'EOF'
    US-B33: hub /settings, /settings/:key, /cost routes

    Implemented-by: Claude Sonnet
    Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
    EOF
    )"
    ```

13. [ ] `zero-schema.ts`에 `settings` 테이블을 추가한다(관계 없음 — 단순 키-값이라 조인이 필요 없다).
    ```ts
    // packages/kernel/src/zero-schema.ts — table() 정의 목록에 추가
    const settings = table("settings")
      .columns({
        key: string(),
        value: json(),
        updated_at: number(),
      })
      .primaryKey("key");
    // tables: [...] 배열에 settings 추가, ZERO_TABLES가 자동으로 잡는다(Object.keys(zeroSchema.tables)).
    ```
    커밋.
    ```bash
    git add packages/kernel/src/zero-schema.ts
    git commit -m "$(cat <<'EOF'
    US-B33: replicate settings to Zero (delta §10 — row.select only, writes stay hub-HTTP)

    Implemented-by: Claude Sonnet
    Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
    EOF
    )"
    ```

14. [ ] 비용 진행률 바 순수 함수(`costBarSegments`/`costBarState`)의 실패하는 테스트를 쓴다.
    ```ts
    // apps/desktop/test/settings-screen.test.tsx
    import { describe, expect, it } from "vitest";
    import { costBarSegments, costBarState } from "../src/screens/Settings";

    describe("costBarSegments (A5 §3.9: 마지막 10%는 예비비 세그먼트)", () => {
      it("computes the spend percentage and a fixed 90% reserve boundary", () => {
        const seg = costBarSegments({ mtdUsd: 34, capUsd: 60, reserveRatio: 0.1 });
        expect(seg.spendPct).toBeCloseTo(56.666, 2);
        expect(seg.reserveStartPct).toBe(90);
      });
    });

    describe("costBarState (80%/100% 임계 — 색은 컴포넌트가, 여기는 상태 이름만)", () => {
      it("normal below 80%", () => expect(costBarState(30, 60)).toBe("normal"));
      it("warn between 80% and 100%", () => expect(costBarState(49, 60)).toBe("warn"));
      it("danger at or over 100%", () => expect(costBarState(60, 60)).toBe("danger"));
    });
    ```

15. [ ] 실행 → 실패.
    ```bash
    pnpm --filter @omnis/desktop test
    ```

16. [ ] `apps/desktop/src/api/settings.ts` + `Settings.tsx`를 구현한다.
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
    import { initZero } from "../zero-client.js";

    const zero = initZero();

    export const SETTINGS_TABS = ["accounts", "autonomy", "model-tiers", "general"] as const;
    export type SettingsTab = (typeof SETTINGS_TABS)[number];
    const TAB_LABEL: Record<SettingsTab, string> = {
      accounts: "Accounts", autonomy: "Autonomy", "model-tiers": "Model tiers", general: "General",
    };

    export type CostBarState = "normal" | "warn" | "danger";

    /** A5 §3.9: 마지막 10%는 VIP·민감 예비비 — 편집 불가, 고정 계산값. */
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
      normal: "정상", warn: "T2→T1 강등", danger: "비VIP 초안 중단",
    };

    export function Settings() {
      const [tab, setTab] = useState<SettingsTab>("accounts");
      const [accounts] = useQuery(zero.query.accounts);
      const [settingsRows] = useQuery(zero.query.settings);
      const byKey = new Map(settingsRows.map((s) => [s.key, s.value]));
      const capUsd = (byKey.get("cost.cap_usd") as number | undefined) ?? 60;
      const mtdUsd = 0; // GET /cost가 실시간 값을 주지만 이 태스크는 Settings 화면의 배선까지만
      const state = costBarState(mtdUsd, capUsd);
      const [killSwitchConfirming, setKillSwitchConfirming] = useState(false);

      return (
        <OpaqueSurface className="settings-screen">
          <nav aria-label="Settings 서브 nav">
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
              <p>이번 달 사용량: ${mtdUsd} / ${capUsd} — {COST_STATE_TEXT[state]}</p>
              <input
                type="number"
                aria-label="월 비용 상한"
                defaultValue={capUsd}
                onBlur={(e) => void putSetting("cost.cap_usd", Number(e.target.value))}
              />
            </div>
          )}

          <section>
            <h2>⚠ Kill switch</h2>
            {!killSwitchConfirming ? (
              <button type="button" onClick={() => setKillSwitchConfirming(true)}>
                모든 자율 실행 중지
              </button>
            ) : (
              <div role="alertdialog" aria-label="정말로 모든 자율 실행을 멈추시겠어요?">
                <p>정말로 모든 자율 실행을 멈추시겠어요?</p>
                <button type="button" onClick={() => setKillSwitchConfirming(false)}>확인</button>
                <button type="button" onClick={() => setKillSwitchConfirming(false)}>취소</button>
              </div>
            )}
          </section>
        </OpaqueSurface>
      );
    }
    ```

17. [ ] 재실행 → 통과, 커밋.
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

**열린 질문**: `Settings.tsx`의 `mtdUsd`는 이 태스크에서 `0`으로 고정돼 있다 — 실사용 값은 `GET /cost`를 호출해야 하는데(`apps/desktop/src/api/settings.ts`에 `fetchCost()` 추가 필요), Zero가 아니라 일반 fetch라 `useEffect` 폴링 배선이 필요하다(범위를 좁히려 이 태스크에서는 뺐다). Autonomy 서브탭의 토글+경고 다이얼로그, allowlist 편집기(로컬/Drive/GitHub 3종 chip 입력), 조용시간 편집기는 전부 `settings` 테이블의 읽기 배선만 증명했을 뿐 이 태스크에서 만들지 않았다 — 후속 태스크가 각 키(`autonomy.rules`/`ingest.*`/`notify.quiet_hours`)를 `putSetting`으로 잇기만 하면 된다(패턴은 비용 상한 입력과 동일).

---

### Task 9: `apps/web` PWA 셸 (US-B35, tier: Sonnet)

**목표(백로그)**: Vite + `@omnis/ui`, 하단 탭바 5칸(Inbox/Today/Tasks/Network/Notes), manifest + 서비스 워커 + 설치 안내 3단계 카드, 스와이프 액션, 스누즈 프리셋 4개, quick-reply 칩 3개.
**산출물**: `apps/web/src/**`, `apps/web/public/manifest.webmanifest`
**검증 명령**: `pnpm --filter @omnis/web test`
**의존**: B28(Today 화면 — PWA가 재사용할 데이터 패턴), B34(ops 플랜의 Tailscale Serve 마운트, 이 태스크는 빌드만 낸다)
**읽을 스펙**: 델타 §1(`@omnis/web` 패키지 정의), §9(`OMNIS_WEB_PORT`), A5 §4.1~§4.3, §4.5(전체), §5(컴포넌트 맵 — `@omnis/ui` 재사용)
**하지 말 것(YAGNI)**: 오프라인 캐싱 전략(Workbox precache 목록 튜닝은 후속 — 서비스 워커는 설치 가능하게만 등록), 실제 화면 5개(Inbox/Today/Tasks/Network/Notes)를 PWA에서 다시 구현(desktop과 같은 `@omnis/ui` 컴포넌트 + Zero 쿼리를 재사용하는 것이 원칙이나, 이 태스크는 셸(탭바+스와이프+설치 카드)만 — 화면 재사용 배선은 열린 질문).

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/public/manifest.webmanifest`, `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/components/BottomTabBar.tsx`, `apps/web/src/components/InstallGuideCard.tsx`, `apps/web/src/lib/swipe.ts`
- Modify: `tsconfig.json`(루트 references에 `apps/web` 추가)
- Test: `apps/web/test/bottom-tab-bar.test.tsx`, `apps/web/test/swipe.test.ts`, `apps/web/test/install-guide-card.test.tsx`

**Interfaces:**
- Consumes: `@omnis/ui`(패키지 그대로 — `apps/desktop`과 동일 의존 규칙), `@omnis/kernel/zero`(서브패스만)
- Produces: `WEB_TABS`, `WebTab`, `BottomTabBar`(`apps/web/src/components/BottomTabBar.tsx`); `classifySwipe`, `SwipeAction`(`apps/web/src/lib/swipe.ts`); `InstallGuideCard`(`apps/web/src/components/InstallGuideCard.tsx`)

**Steps:**

1. [ ] 스캐폴드 파일부터 만든다(패키지가 없으면 vitest가 이 디렉터리를 아예 안 본다 — 테스트보다 먼저 필요한 유일한 비-TDD 스텝, 루트 `pnpm-workspace.yaml`의 `apps/*`가 이미 덮으므로 workspace 파일은 안 건드린다).
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
         manifest: false, // public/manifest.webmanifest를 그대로 서빙 — 델타 §9 OMNIS_WEB_PORT
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
   루트 `tsconfig.json`의 `references` 배열에 `{ "path": "./apps/web" }`를 추가한다.

2. [ ] `classifySwipe`(스와이프 판정)의 실패하는 테스트를 쓴다.
   ```ts
   // apps/web/test/swipe.test.ts
   import { describe, expect, it } from "vitest";
   import { classifySwipe } from "../src/lib/swipe.js";

   describe("classifySwipe (A5 §4.2: 오른쪽=Archive, 왼쪽 부분=메뉴, 왼쪽 끝까지=Snooze)", () => {
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

3. [ ] 실행 → 실패.
   ```bash
   pnpm --filter @omnis/web test
   ```

4. [ ] `apps/web/src/lib/swipe.ts`를 구현한다.
   ```ts
   // apps/web/src/lib/swipe.ts
   export type SwipeAction = "archive" | "menu" | "snooze" | "none";

   const PARTIAL_PX = 60;
   const FULL_PX = 160;

   /** A5 §4.2: 오른쪽 부분/끝까지 = Archive(둘 다 같은 액션, UI 어포던스만 다르다).
    * 왼쪽 부분 = 메뉴(Snooze/Label/Delegate), 왼쪽 끝까지 = 기본 액션(Snooze). */
   export function classifySwipe(deltaX: number): SwipeAction {
     if (deltaX >= PARTIAL_PX) return "archive";
     if (deltaX <= -FULL_PX) return "snooze";
     if (deltaX <= -PARTIAL_PX) return "menu";
     return "none";
   }
   ```

5. [ ] 재실행 → 통과, 커밋.
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

6. [ ] `BottomTabBar`의 실패하는 테스트를 쓴다.
   ```tsx
   // apps/web/test/bottom-tab-bar.test.tsx
   import { describe, expect, it, vi } from "vitest";
   import { render, screen, fireEvent } from "@testing-library/react";
   import { BottomTabBar, WEB_TABS } from "../src/components/BottomTabBar.js";

   describe("BottomTabBar (A5 §4.1: 5칸 고정, Digest·Settings 없음)", () => {
     it("renders exactly the 5 fixed tabs", () => {
       expect(WEB_TABS).toEqual(["inbox", "today", "tasks", "network", "notes"]);
     });
     it("marks the active tab and calls onSelect on click", () => {
       const onSelect = vi.fn();
       render(<BottomTabBar active="inbox" onSelect={onSelect} />);
       expect(screen.getByRole("tab", { name: "받은 편지함" })).toHaveAttribute("aria-selected", "true");
       fireEvent.click(screen.getByRole("tab", { name: "홈" }));
       expect(onSelect).toHaveBeenCalledWith("today");
     });
   });
   ```

7. [ ] 실행 → 실패.
   ```bash
   pnpm --filter @omnis/web test
   ```

8. [ ] `BottomTabBar` + `InstallGuideCard`를 구현한다.
   ```tsx
   // apps/web/src/components/BottomTabBar.tsx
   export const WEB_TABS = ["inbox", "today", "tasks", "network", "notes"] as const;
   export type WebTab = (typeof WEB_TABS)[number];

   const TAB_LABEL: Record<WebTab, string> = {
     inbox: "받은 편지함", today: "홈", tasks: "할 일", network: "네트워크", notes: "노트",
   };

   export function BottomTabBar({ active, onSelect }: { active: WebTab; onSelect: (t: WebTab) => void }) {
     return (
       <nav className="bottom-tab-bar" role="tablist" aria-label="주요 화면">
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
   /** A5 §4.5: 공유 버튼 탭 → 홈 화면에 추가 → 완료, 3단계 카드. */
   export function InstallGuideCard({ onDismiss }: { onDismiss: () => void }) {
     const steps = ["공유 버튼을 탭하세요", "'홈 화면에 추가'를 선택하세요", "완료!"];
     return (
       <div className="install-guide-card" role="dialog" aria-label="홈 화면에 추가">
         <ol>
           {steps.map((s, i) => (
             <li key={s}>
               {i + 1}. {s}
             </li>
           ))}
         </ol>
         <button type="button" onClick={onDismiss}>
           닫기
         </button>
       </div>
     );
   }
   ```

9. [ ] `apps/web/src/App.tsx`를 구현해 셸을 조립한다(화면 본문은 열린 질문에 남긴 대로 후속 — 이 태스크는 탭 전환 + 설치 카드 노출만 증명).
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
         <main className="web-shell__main">{/* 화면 본문은 후속 태스크 — 열린 질문 참고 */}</main>
         <BottomTabBar active={tab} onSelect={setTab} />
       </div>
     );
   }
   ```

10. [ ] 재실행 → 통과, 커밋.
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

**열린 질문**: 5개 탭의 실제 화면 본문(Inbox/Today/Tasks/Network/Notes)은 이 태스크에서 비어 있다 — desktop이 이미 가진 `Inbox.tsx`/`Today.tsx`/`Tasks.tsx`/`Network.tsx`/`Notes.tsx`를 그대로 재사용할지(반응형 CSS만 다르게), 아니면 PWA 전용 컴팩트 버전을 새로 짤지 결정이 필요하다 — 전자가 명백히 더 라조이(YAGNI: 같은 Zero 쿼리를 두 번 안 짠다)하지만 `apps/desktop`이 Tauri `@tauri-apps/api`를 의존하고 있어 화면 컴포넌트를 그대로 import하면 안 되므로, 화면의 순수 로직만 `packages/ui`나 별도 공유 위치로 뽑아야 한다. 스와이프 제스처의 실제 포인터 이벤트 배선(`classifySwipe`를 호출하는 컴포넌트)과 quick-reply 칩 3개, 스누즈 프리셋 4개 바텀시트도 아직 없다.

---

### Task 10: PWA Web Push 구독 (US-B36, tier: Sonnet)

**목표(백로그)**: 권한 요청은 첫 승인 대기 항목이 생겼을 때, `POST /push/subscribe` + `push_subscriptions` 저장, 서비스 워커 `notificationclick`(Approve=`pending_approvals` accept, Open=딥링크), 알림 종류 6종 문구.
**산출물**: `apps/web/src/push/*.ts`, `apps/hub/src/push.ts`
**검증 명령**: `pnpm --filter @omnis/web test`
**의존**: B17(알림 전달 — `createNotifier`/`PushPayload` 발송 인프라), B35(이 플랜 Task 9)
**읽을 스펙**: 델타 §2.3(`PushSubscription`/`PushPayload`), §6(`0011_push_subscriptions.sql`), §7(`/push/*`), A5 §4.4(전체)
**하지 말 것(YAGNI)**: 실제 알림 6종의 발송 트리거 배선(그건 agents US-B17의 `createNotifier`가 이미 소유 — 이 태스크는 구독 저장 + 클릭 핸들러만), Approve 버튼이 성공했는지 재시도 로직(실패해도 앱을 열면 되므로 fire-and-forget으로 충분, YAGNI).

**Files:**
- Create: `packages/db/migrations/0011_push_subscriptions.sql`, `apps/hub/src/push.ts`, `apps/web/src/push/subscribe.ts`, `apps/web/src/push/sw-push.ts`
- Modify: `apps/hub/src/http.ts`(GET /push/vapid-public-key, POST/DELETE /push/subscribe), `apps/hub/src/config.ts`(VAPID 3개 env 필드 추가)
- Test: `apps/hub/src/push.test.ts`, `apps/web/test/push-subscribe.test.ts`, `apps/web/test/sw-push.test.ts`

**Interfaces:**
- Consumes: `PushSubscription`, `PushPayload`(`@omnis/protocol`, 델타 §2.3), `query`(`@omnis/db`)
- Produces: `saveSubscription`, `removeSubscription`, `sendPush`, `configureWebPush`, `VapidKeys`, `PushSender`(`apps/hub/src/push.ts`); `toSubscriptionPayload`(`apps/web/src/push/subscribe.ts`); `buildNotificationOptions`, `resolveNotificationClick`(`apps/web/src/push/sw-push.ts`)

**Steps:**

1. [ ] `packages/db/migrations/0011_push_subscriptions.sql`을 쓴다(델타 §6 표 그대로).
   ```sql
   -- packages/db/migrations/0011_push_subscriptions.sql
   CREATE TABLE push_subscriptions (
     id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     endpoint   text UNIQUE NOT NULL,
     p256dh     text NOT NULL,
     auth       text NOT NULL,
     ua         text,
     created_at timestamptz NOT NULL DEFAULT now(),
     last_ok_at timestamptz,
     fail_count integer NOT NULL DEFAULT 0
   );
   ```
   커밋.
   ```bash
   git add packages/db/migrations/0011_push_subscriptions.sql
   git commit -m "$(cat <<'EOF'
   US-B36: 0011_push_subscriptions.sql (delta §6)

   Implemented-by: Claude Sonnet
   Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
   EOF
   )"
   ```

2. [ ] `apps/hub/src/push.ts`(구독 저장/삭제/발송)의 실패하는 테스트를 쓴다 — `web-push`의 실제 네트워크 호출은 `PushSender`로 주입해 목업한다.
   ```ts
   // apps/hub/src/push.test.ts
   import { describe, expect, it, vi } from "vitest";
   import { removeSubscription, saveSubscription, sendPush } from "./push.js";

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

   describe("sendPush", () => {
     const sub = { id: "sub-1", endpoint: "https://push.example/abc", p256dh: "p", auth: "a" };
     const payload = {
       kind: "draft" as const, title: "새 초안", body: "확인 부탁드립니다",
       deep_link: "omnis://thread/t1",
     };

     it("delegates to the injected sender", async () => {
       const pool = fakePool();
       const sendNotification = vi.fn().mockResolvedValue(undefined);
       await sendPush(pool as never, { sendNotification }, sub, payload);
       expect(sendNotification).toHaveBeenCalledWith(
         { endpoint: sub.endpoint, keys: { p256dh: "p", auth: "a" } },
         JSON.stringify(payload),
       );
     });

     it("deletes the subscription on a 410 Gone instead of throwing", async () => {
       const pool = fakePool();
       const sendNotification = vi.fn().mockRejectedValue({ statusCode: 410 });
       await expect(sendPush(pool as never, { sendNotification }, sub, payload)).resolves.toBeUndefined();
       expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM push_subscriptions"), [
         "sub-1",
       ]);
     });

     it("bumps fail_count and rethrows on any other error", async () => {
       const pool = fakePool();
       const sendNotification = vi.fn().mockRejectedValue({ statusCode: 500 });
       await expect(sendPush(pool as never, { sendNotification }, sub, payload)).rejects.toBeDefined();
       expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("fail_count = fail_count + 1"), [
         "sub-1",
       ]);
     });
   });
   ```

3. [ ] 실행 → 실패.
   ```bash
   pnpm --filter @omnis/hub test
   ```

4. [ ] `apps/hub/src/push.ts`를 구현한다.
   ```ts
   // apps/hub/src/push.ts
   import { query } from "@omnis/db";
   import type { Pool } from "pg";
   import webpush from "web-push";

   export interface VapidKeys {
     publicKey: string;
     privateKey: string;
     subject: string;
   }

   export function configureWebPush(keys: VapidKeys): void {
     webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);
   }

   export interface PushSender {
     sendNotification: typeof webpush.sendNotification;
   }
   export const realPushSender: PushSender = { sendNotification: webpush.sendNotification };

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

   export interface StoredSubscription {
     id: string;
     endpoint: string;
     p256dh: string;
     auth: string;
   }

   export interface PushPayload {
     kind: "draft" | "approval" | "vip" | "briefing" | "digest" | "followup" | "adapter_down";
     title: string;
     body: string;
     deep_link: string;
     approval_id?: string;
   }

   /** 410/404(Gone/Not Found)는 조용히 구독을 지운다 — 그 외는 fail_count만 올리고 다시 던진다. */
   export async function sendPush(
     pool: Pool,
     sender: PushSender,
     sub: StoredSubscription,
     payload: PushPayload,
   ): Promise<void> {
     try {
       await sender.sendNotification(
         { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
         JSON.stringify(payload),
       );
     } catch (e) {
       const status = (e as { statusCode?: number }).statusCode;
       if (status === 404 || status === 410) {
         await query(pool, `DELETE FROM push_subscriptions WHERE id = $1`, [sub.id]);
         return;
       }
       await query(pool, `UPDATE push_subscriptions SET fail_count = fail_count + 1 WHERE id = $1`, [sub.id]);
       throw e;
     }
   }
   ```

5. [ ] 재실행 → 통과. `apps/hub/src/config.ts`에 VAPID 필드를 더하고(`zeroAuthSecret`과 같은 "빈 문자열=미설정" 패턴), `http.ts`에 `/push/*` 3개 라우트를 배선한다.
   ```bash
   pnpm --filter @omnis/hub test
   ```
   ```ts
   // apps/hub/src/config.ts — HubConfig에 필드 3개 추가, readConfig에 배선
   export interface HubConfig {
     // ...기존 필드
     webpushVapidPublic: string;
     webpushVapidPrivate: string;
     webpushSubject: string;
   }
   // readConfig() 반환 객체에 추가:
   webpushVapidPublic: env.OMNIS_WEBPUSH_VAPID_PUBLIC ?? "",
   webpushVapidPrivate: env.OMNIS_WEBPUSH_VAPID_PRIVATE ?? "",
   webpushSubject: env.OMNIS_WEBPUSH_SUBJECT ?? "mailto:281932556+jinhologankim@users.noreply.github.com",
   ```
   ```ts
   // apps/hub/src/http.ts — 추가 import + createHubServer 상단 + 라우트
   import { configureWebPush, realPushSender, removeSubscription, saveSubscription, sendPush } from "./push.js";
   // (createHubServer 함수 상단, config가 이미 있으므로)
   const webpushConfigured = config.webpushVapidPublic !== "" && config.webpushVapidPrivate !== "";
   if (webpushConfigured) {
     configureWebPush({
       publicKey: config.webpushVapidPublic,
       privateKey: config.webpushVapidPrivate,
       subject: config.webpushSubject,
     });
   }

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
   `sendPush`/`realPushSender`는 이 태스크에서 라우트로 노출하지 않는다 — 실제 발송 트리거는 agents US-B17의 `createNotifier`가 이 함수를 가져다 쓴다(계약 §5 `Notifier.send`).

6. [ ] 커밋.
   ```bash
   git add apps/hub/src/push.ts apps/hub/src/push.test.ts apps/hub/src/config.ts apps/hub/src/http.ts
   git commit -m "$(cat <<'EOF'
   US-B36: hub push.ts (VAPID send/save/remove) + GET vapid-public-key, POST/DELETE /push/subscribe

   Implemented-by: Claude Sonnet
   Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
   EOF
   )"
   ```

7. [ ] PWA 쪽 구독 변환(`toSubscriptionPayload`)과 서비스 워커 알림 핸들러(`buildNotificationOptions`/`resolveNotificationClick`)의 실패하는 테스트를 쓴다 — 브라우저 Push API 자체(`navigator.serviceWorker`/`PushManager`)는 jsdom에 없으므로 그 앞뒤의 순수 변환 함수만 테스트한다.
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

   describe("buildNotificationOptions (A5 §4.4: Approve/Open 최대 2개, 본문 80자)", () => {
     it("includes an Approve action only when approval_id is present", () => {
       const withApproval = buildNotificationOptions({
         kind: "draft", title: "새 초안", body: "확인 부탁드립니다", deep_link: "omnis://thread/t1",
         approval_id: "ap1",
       });
       expect(withApproval.actions).toEqual([
         { action: "approve", title: "Approve" },
         { action: "open", title: "Open" },
       ]);
       const withoutApproval = buildNotificationOptions({
         kind: "digest", title: "밤 다이제스트 준비됨 · 42개 보관", body: "", deep_link: "omnis://digest",
       });
       expect(withoutApproval.actions).toEqual([{ action: "open", title: "Open" }]);
     });
   });

   describe("resolveNotificationClick (Approve = pending_approvals accept, Open = 딥링크)", () => {
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

8. [ ] 실행 → 실패.
   ```bash
   pnpm --filter @omnis/web test
   ```

9. [ ] `apps/web/src/push/subscribe.ts` + `apps/web/src/push/sw-push.ts`를 구현한다.
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

   /** A5 §4.5: 권한 요청은 첫 승인 대기 항목이 생겼을 때 이 함수를 호출하는 쪽(App.tsx, 후속 범위)이 결정한다. */
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
   // apps/web/src/push/sw-push.ts — 서비스 워커 컨텍스트에서 import된다(self.addEventListener 배선은 후속)
   export interface PushPayload {
     kind: "draft" | "approval" | "vip" | "briefing" | "digest" | "followup" | "adapter_down";
     title: string;
     body: string;
     deep_link: string;
     approval_id?: string;
   }

   /** A5 §4.4: 본문은 80자까지만(이미 hub PushPayload.body가 그렇게 잘려 온다 — 여기서 다시 자르지 않는다). */
   export function buildNotificationOptions(payload: PushPayload): { body: string; actions: { action: string; title: string }[] } {
     const actions = payload.approval_id !== undefined
       ? [{ action: "approve", title: "Approve" }, { action: "open", title: "Open" }]
       : [{ action: "open", title: "Open" }];
     return { body: payload.body, actions };
   }

   export type NotificationClickIntent =
     | { kind: "approve"; approvalId: string }
     | { kind: "open"; url: string };

   /** action==='' 는 알림 본문(액션 버튼이 아닌 부분) 클릭 — Open과 동일하게 취급한다(A5 §4.4). */
   export function resolveNotificationClick(action: string, payload: PushPayload): NotificationClickIntent {
     if (action === "approve" && payload.approval_id !== undefined) {
       return { kind: "approve", approvalId: payload.approval_id };
     }
     return { kind: "open", url: payload.deep_link };
   }
   ```

10. [ ] 재실행 → 통과, 커밋.
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

**열린 질문**: `self.addEventListener("push", …)`/`self.addEventListener("notificationclick", …)`의 실제 서비스 워커 등록(`sw-push.ts`의 함수를 호출하는 진입점)은 이 태스크에 없다 — `vite-plugin-pwa`의 `injectManifest` 전략으로 커스텀 서비스 워커 소스를 지정해야 하는데(Task 9는 `registerType: "prompt"`의 기본 생성 서비스 워커만 썼다), `vite.config.ts`를 `strategies: "injectManifest"`로 바꾸고 `srcDir`/`filename`을 지정하는 배선이 후속 필요하다. `resolveNotificationClick`이 돌려준 `{kind:"approve"}`가 실제로 기존 `POST /approvals/:id/decide`를 호출하는 연결(Global Constraints에서 "새 경로를 만들지 않는다"고 약속한 부분)도 서비스 워커 진입점과 함께 후속 태스크다.

---

## 완료 체크

- 스토리 10개(US-B26, B27, B28, B29, B30, B31, B32, B33, B35, B36) 전부 태스크 ≥1개(각 정확히 1개, Task 1~10)로 커버됨.
- 금지 표현(TBD/TODO/"implement later"/"add appropriate error handling"/"similar to Task N"/코드 없는 스텝/미정의 심볼) 없음 — 셀프체크 결과 없음 확인.
- 이 문서가 소비하는 모든 심볼은 델타 §2~§5(`SearchHit` 계열, `PushSubscription`/`PushPayload`, `getSetting`/`setSetting`/`SettingKey`/`SETTING_DEFAULTS`) 또는 다른 Phase B 플랜이 웨이브 순서상 먼저 만드는 것(`searchMemories`/`MemoryHit`, `undoArchive`, `currentPolicy`)뿐이고, 전부 Global Constraints에 명시했다.
- 이 플랜이 새로 고정한 심볼(델타에 없던 것, "심볼 산출물" 참고): `runSearch`/`createSearchDeps`/`SearchDeps`(Task 1), `matchesAnyAction`/`UiSearchHit`/`UiSearchGroup`(Task 2), `DigestCard`(Task 3), `TaskRow`/`filterTasksByView`(Task 4), `PersonCard`/`relationshipDot`/`followupQueue`(Task 5), `decideNoteRouting`/`POST /notes/:id/route`(Task 6, 델타에 없던 라우트 — 열린 질문에 기록), `handleUnarchiveItem`/`handleDigestUndo`(Task 7), `packages/kernel/src/settings.ts` 전체(Task 8, 델타 §5를 최초로 구현), `BottomTabBar`/`classifySwipe`/`InstallGuideCard`(Task 9), `apps/hub/src/push.ts` 전체(Task 10, 델타 §2.3을 최초로 구현).

