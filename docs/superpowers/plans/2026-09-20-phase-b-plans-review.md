# Cross-review of the 5 Phase B plans (2026-09-20)

Input: `2026-09-20-phase-b-backlog.md`, `…-interfaces-delta.md`, `…-phase-a-interfaces.md`, `…-phase-b-{memory-ingestion,agents,surfaces,channels,ops}.md`.

Verdict: **conditionally ready**. Once the M1~M3 items below (circular dependency·double creation) are cleared out into wave 0, parallel execution is possible. M4~M11 were closed by fixing the delta document (see §"Delta changes applied"), and M12~M16 are execution notes.

---

## 1. Discrepancy table

| # | Type | Detail | Evidence | Who fixes it |
|---|---|---|---|---|
| **M1** | Duplicate work | agents Task 7 and channels Task 5 **each** create `0012_jobs_phase_b.sql`. The contents differ — the agents version additionally has `CREATE VIEW cost_daily` + a comment. channels assumes "byte-for-byte identical", but that is not true, so it means a merge conflict + a runner sha256 throw (contract §4). ops has already dodged it with `0014` | agents:2134·2151, channels:1061·1065, ops:1127 | **Delta §6** (fixed) → channels·ops plan authors |
| **M2** | Circular dependency | The `settings` table·`getSetting` are owned by surfaces US-B33 (W3), but agents B14 (W2)·memory-ingestion B11 (W2) consume them. The backlog records the B33 dependents as B09/B11/B14/B18, making it **bidirectional** | agents:1896·2029, mem-ing:8048·8375, backlog US-B33 row | **Backlog §3 + Delta §6** (fixed) |
| **M3** | Circular dependency | Same shape. agents Task 12 (US-B17) waits on `0011_push_subscriptions.sql`, but that file is owned by surfaces US-B36, and B36's dependency is B17 | agents:6736, surfaces:3096 | **Backlog §3 + Delta §6** (fixed) |
| **M4** | Missing symbol | Delta §4 says "`LoopId` is Phase A's 9 values as-is" — Phase A has no `LoopId` export (only the inline union on `RecordRunInput.loop`). On top of that, `morningDigestLoop`/`nightlyDigestLoop` share the single `'digest'` value, so their `registerLoop` keys collide | phase-a:439, agents:180·"what delta adds" table | **Delta §4** (fixed) |
| **M5** | Signature | Delta §4 uses `assemble(ctx: TriggerContext)` but does not define `TriggerContext`. `startLoops(deps:{kernel: Kernel; logger: Logger})` contradicts §1's "`@omnis/agents` does not depend on `@omnis/kernel`" | delta:206·217, agents:28~40 | **Delta §4** (fixed) |
| **M6** | Orphan symbol | `ingestLoop: LoopSpec<IngestOutput>` exists only in the delta and none of the 5 plans creates it. The real entry point is `runIngest(deps)` | delta:259, 0 hits for grep across all plans | **Delta §4** (deleted) |
| **M7** | Package boundary | Delta §3 puts `isDenied`/`DENY_PATTERNS` in `@omnis/memory`, but `apps/local-agent` depends only on `@omnis/protocol`, so memory-ingestion changed it to **define in protocol + memory re-exports** | mem-ing:39 table | **Delta §3** (fixed) |
| **M8** | Orphan route | Delta §7 attached `GET /transcript/:session_id` to US-B39, but channels creates only the single file `apps/local-agent` and did not implement it. surfaces does not do it either | channels:3180 | **Delta §7** (reassigned) → 1 task needs to be added to the surfaces plan |
| **M9** | Missing from delta | surfaces Task 6 newly creates `POST /notes/:id/route` — it is not in delta §7 | surfaces:1720·1855 | **Delta §7** (added) |
| **M10** | Missing from delta | `OMNIS_OPENROUTER_API_KEY` (agents T2 + memory-ingestion T1), `OMNIS_NTFY_URL` (channels+ops, both matching `http://127.0.0.1:2586`). The Keychain entries `omnis.openrouter.api_key`·`omnis.healthchecks.<slug>`·`omnis.restic.*`·`omnis.b2.*` are missing too | agents:552·26, mem-ing:24, channels:2626, ops:764 | **Delta §9** (added) |
| **M11** | Missing from delta | agents Task 7 inserts `cost.last_state` into `settings` via raw SQL, but it is not in the `SettingKey` union → `getAllSettings` leaks a key outside the type | agents:2279·2292, surfaces:2381 | **Delta §5** (added) |
| **M12** | Duplicate work | memory-ingestion Task 1 adds the 5 root `package.json` scripts as the "owner", but agents Task 14 adds `eval:archive` again | mem-ing:218, agents:4136 | agents plan author (delete that step) |
| **M13** | Cross-owned file | surfaces Task 1 adds a `truncateSnippet` export to `packages/memory/src/search.ts` — a file owned by memory-ingestion Task 4 | surfaces:36·213 | surfaces author (request that it be added to memory-ingestion Task 4 up front) |
| **M14** | Dependency inversion | The backlog has US-B20's dependency = B19, but the agents execution order is Task 17 (`routeByRule`, B20) → Task 15 (`taskLoop`, B19) (`taskLoop` imports `routeByRule`) | agents:6739 | **Backlog §2** (change B20's dependency to `B07`, add `B20` to B19's dependencies) |
| **M15** | Verification precondition | B-D5 (fixtures only) was mostly honored. What remains: ① `pnpm eval:memory` (B12) **actually** needs a local Ollama `11434` + a `nomic-embed-text-v1.5` pull (not credentials, but a CI precondition) ② the `eval/draft.jsonl` (B13)·`auto_archive.jsonl` (B18)·`task/route_note/followup` 5-kind golden set is synthetic until a real account is connected, so the exit-criteria numbers are **fake** ③ B24 `memory_consolidate` returns null when the key is absent (the plan handles it, OK) | backlog §6-5, agents:6262, mem-ing:457 | Logan (deferral decision in backlog §6-5) |
| **M16** | Merge friction | `packages/kernel/src/index.ts` (5 plans), `pnpm-workspace.yaml`·root `tsconfig.json` (4), `biome.jsonc` (2) are touched at the same time. All of them are single append-only lines, so the conflict is mechanical, but automatic merge fails | grep per file | Executors (sequential merge at the end of each wave) |

---

## 2. Delta changes applied (old → new)

Applied directly to `…-phase-b-interfaces-delta.md`.

1. **Single-owner rule newly created before the §6 table** — old: the 5 files were scattered across B33/B08/B36/B14·B15·B37·B44/B33 → new: `0009`·`0011`·`0012`·`0013` are bundled into the **wave 0 schema bundle** (single worktree·single commit) and `packages/kernel/src/settings.ts` ships with it. Only `0010` is owned by memory-ingestion. ops's `0014_cost_report_job.sql` became unnecessary and was deleted.
2. **§4 `LoopId`** — old: "Phase A's 9 values as-is" → new: `@omnis/agents` newly exports `export type LoopId` (identical to the 9 values of `agent_runs.loop`), and the two loops that share `digest` are called directly with `runLoopSpec(spec, ctx)` rather than going through `registerLoop`.
3. **5 symbols added to §4** — `TriggerContext`, `LoopSpec.decide?()`, `runLoopSpec`, `LoopKernel`/`LoopLogger`, `writeSystemItem`.
4. **§4 `startLoops`** — old: `deps: { kernel: Kernel; logger: Logger }` → new: `deps: { kernel: LoopKernel; logger: LoopLogger }` (follows the §1 dependency rule).
5. **§4 `ingestLoop` row deleted** — the hub cron calls `runIngest(deps)` directly.
6. **§3 `isDenied`/`DENY_PATTERNS`** — old: defined in `@omnis/memory` → new: defined in `@omnis/protocol` + re-exported from `@omnis/memory`.
7. **9 symbols pinned by memory-ingestion added to §3** — `estimateTokens`, `EntityRow`, `ensureSelfModelRepo`, `overCapWarning`, `IngestProvider`/`IngestDoc`/`registerIngestProvider`, `Extractor`/`setExtractor`, `chunkCalendarEvent`/`DEAD_LETTER_THRESHOLD`. The `@omnis/agents`-side `scanInjection`/`setContextBudget`/`CONTEXT_INPUT_BUDGET_TOKENS` were also added to §4.
8. **§5 `SettingKey`** — added `| "cost.last_state"` (internal key, not exposed on the Settings screen).
9. **§7** — reassigned the owner of `GET /transcript/:session_id` from **B39 → a newly created surfaces task**, and added a `POST /notes/:id/route` (B31) row.
10. **§9** — added `OMNIS_OPENROUTER_API_KEY`·`OMNIS_NTFY_URL` (default `http://127.0.0.1:2586`), and added `omnis.openrouter.api_key`·`omnis.healthchecks.<slug>`·`omnis.restic.repo_password`·`omnis.b2.app_key` to the Keychain.
11. **§1 root scripts** — strengthened the sentence "owner = memory-ingestion Task 1, other plans do not touch this block again".

~~Outside the delta, so **what I could not fix**: M12·M13·M14 (edits to each plan body and backlog §2·§3), writing M8's newly created surfaces task.~~ → **all of it has been applied (§2b)**.

---

## 2b. Plan body·backlog fixes (2026-09-20 follow-up)

| # | Where | What was done |
|---|---|---|
| **M8** | surfaces | **Task 11 newly created** — `GET /transcript/:session_id?last_n` → `SessionSummary` (`apps/hub/src/transcript.ts`). Reads the durable summary (`agent_sessions.summary`) + the last N turns of that session thread from `items`, and folds `tool_call` into the preceding turn (A2 §3.3). Turn text is truncated to the schema limit of 1000 chars, and `open_questions`/`artifacts` are empty arrays because there is no evidence (recorded as an open question). The owner column in delta §7 was also updated to `surfaces plan Task 11` |
| **M12** | agents | Deleted Task 14's root `package.json` script block + removed `package.json` from `git add`. The single owner is memory-ingestion Task 1 (delta §1) |
| **M13** | memory-ingestion / surfaces | Moved `truncateSnippet` to **memory-ingestion Task 4** (implementation + 3 cases in `search-snippet.test.ts` + `index.ts` re-export). surfaces Task 1 replaced steps 1~4 with a **single precondition-check step** and only imports from `@omnis/memory` |
| **M14** | backlog / agents | In backlog §2, **US-B20's dependency `B19` → `B07`**, and **`B20` added to US-B19's dependencies**. Noted this single exception in the "every dependency has a lower number than itself" sentence. The story lines of agents Task 15·17 were fixed in the same direction (the execution order Task 17 → 15 → 16 was correct all along) |
| **US-B28** | surfaces | Took Task 3's 4 states (loading/empty/error/offline) out of YAGNI and **actually implemented** them — the pure function `screenState()` (precedence error → offline → loading → empty → ready, based on Zero's `ResultType` and `zero.online`) + `STATE_COPY` + a one-line banner. The cached list stays visible even when offline·in error. Added 6 unit tests. **The backlog row is left as is** (the requirement is satisfied) |
| **US-B30** | surfaces | Closed Task 5's "undeclared symbol" suspicion by checking for real — `initialsFromName`/`pastelFromName` (`packages/ui/src/lib/row-meta.ts`)·`formatRelativeTime` (`packages/ui/src/lib/relative-time.ts`) **are already on main from Wave 4/5**. Pinned a file·signature table and a pre-start `grep` check step so they cannot be created anew |
| **Web Push duplication** | agents / surfaces | Single owner = **`packages/kernel/src/notify/webpush.ts` (agents Task 12)** — `vapidFromEnv`/`sendWebPush`/`pruneSubscription`/`WEBPUSH_GONE_CODES`/`VapidKeys`. In surfaces Task 10, **deleted** `sendPush`/`configureWebPush`/`PushSender`/`realPushSender` and their tests, leaving only the 3 routes + `saveSubscription`/`removeSubscription`. The `web-push` dependency is not put into `apps/hub` |
| **US-B45 (new)** | backlog / channels | Newly created the hub adapter registry·bootstrap wiring story (backlog §2, channels **Task 17**). `apps/hub/src/adapters.ts` goes `accounts`+`account_secrets.auth_ref` → `AuthRef` → each adapter's `connect()` (the hub does not touch the secret values, A3-D4), injects `createHubServer({adapters})` (the US-A36 storage write-back finally reaches the channels), `subscribe()` loop → `kernel.ingest.sink` + health. **The factory registry is injected, so everything is fixture-tested with fake factories** (B-D5) |
| **Hermes SSE spike (new)** | backlog / channels | Registered `gate-hermes-sse` as a Phase B entry spike (backlog §5) and put it into channels as **Task 11-S** (before Task 11). If there is no real connection, it stays doc-based + `UNVERIFIED`. The real output: since `/v1/responses` is OpenAI Responses compatible, `type` may be `response.output_text.delta`, so **Task 13's `#pump` does not pin down to one set of field names** (suffix matching + `text ?? delta`) |
| **M1 follow-up** | channels / ops / agents | Pushed the W0 schema bundle decision **all the way into the plan bodies** — channels Task 5 does not create `0012` and only checks that it exists, ops Task 6's `0014_cost_report_job.sql` is **scrapped** (delta §11 already wrote it that way), and agents Task 7 remains the "source of truth for the definition" and skips step 1 if W0 was merged first |
| **Wiring bug (bonus)** | surfaces | 6 screens were using module-top-level `const zero = initZero()`. This is a failure mode that `apps/desktop/src/zero-client.ts` recorded: "with the wiring where the screens each called `initZero()`, not a single screen ever appeared in the browser" — so all 6 spots were fixed to call **`useZeroClient()` inside the component**, like the 3 existing screens |

---

## 3. Execution waves (chain = 1 sequential worktree, ≤5 per wave)

**W0 — schema bundle (1 chain, prerequisite)**
`0009_settings.sql` + `packages/kernel/src/settings.ts` + `0011_push_subscriptions.sql` + `0012_jobs_phase_b.sql` (4 jobs + the `cost_daily` view) + `0013_publication_phase_b.sql` + the 5 root `package.json` scripts. This one item removes M1·M2·M3 at the same time.

**W1 — after W0 merges, 5 chains**
- C1 memory-ingestion T1–4(B01) → T5–6(B02) → T10(B04)
- C2 memory-ingestion T7–9(B03, kernel identity)
- C3 channels T1–10 (B37·B38 adapters, fixtures only) — **can start right now**
- C4 channels **T11-S** (gate-hermes-sse spike) → T11–13 (B39 Hermes)
- C5 ops T1·T2·T3·T5 (B16/B34/B41/B43) + agents T6→T7 (B14 cost meter — only needs W0 settings.ts)

**W2 — after C1·C2 merge, 5 chains**
- C1 memory-ingestion T11–13(B05) → agents T1→T5→T2→T3→T4(B06·B07)
- C2 agents T10→T11→T12(B15·B17)
- C3 agents T13(B18 `archiveItem`/`undoArchive`)
- C4 channels T14–16(B40) → ops T4(B42)
- C5 agents T8 (B13 pure functions)

**W3 — after the agents core merges, 5 chains**
- C1 memory-ingestion T14–17(B08) → T18(B09) → T19–20(B10) → T21–22(B11) → T23(B12)
- C2 agents T17→T15→T16→T18 (B20·B19, M14 order)
- C3 agents T9(B13 `draftLoop`)
- C4 agents T19(B21), T20(B22)
- C5 agents T14 (B18 loop) → T21 (B23) → T22 (B24) → T23

**W4 — surfaces, 5 chains**
- C1 surfaces T1(B26) → T2(B27)
- C2 surfaces T3(B28) → T9(B35) → T10(B36)
- C3 surfaces T4(B29), T5(B30)
- C4 surfaces T6(B31), T7(B32)
- C5 surfaces T8(B33 screens·hub routes only) + surfaces **T11**(`GET /transcript`, newly created in M8) + ops T6(B44)

**W5 — adapter wiring (1 chain, after channels T3·T8·T14 merge)**
- channels **T17** (US-B45 hub adapter registry + `apps/hub/src/main.ts` wiring). The real factory table can only be filled in after all of W2's channels T14–16 and W1's adapter factories have landed. It can run in parallel with the surfaces wave, but it is the only chain that touches `apps/hub/src/main.ts`.

**memory-ingestion T1.. and channels can start immediately without W0** — neither imports W0's artifacts (`settings`/`push_subscriptions`/job seed) in code. The only exception is memory-ingestion T22's 3 lines of hub wiring, which stay as a `[]` literal instead of `getSetting` and are reverted when W0 merges (open item 1 in that plan already says the same thing).

---

## 4. Logan's decisions (done)

All three have answers, and **backlog §7** is the source of truth.

1. **Golden set → deferred.** The three metrics — draft acceptance rate·unmodified send rate·briefing coverage — are excluded from the Phase B exit verdict until a real account is connected (the exit condition is that the measurement wiring runs). **What is not deferred**: 0 VIP·sensitive items in auto-archive (safety invariant) and memory recall@10 ≥ 0.80 (the answers are the source documents, so real values come out even from synthetic data).
2. **Bootstrap wiring → channels US-B45 (Task 17).** The runtime adapter map in `apps/local-agent` is separate and is closed by US-B39.
3. **Hermes SSE spike → registered.** Slug `gate-hermes-sse`, channels Task 11-S. If there is no real connection, it is left as `UNVERIFIED` and does not block US-B39.
