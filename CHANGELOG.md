# Changelog

## Phase B — 2026-09-21

Phase B (context + agents + phone) built end to end on `main`: **45 stories, US-B01–US-B45**, plus
the W0 schema bundle (US-B00), across six waves. Story ids are the backlog's
(`2026-09-20-phase-b-backlog.md`); per-story plan tasks are indexed in
[`docs/superpowers/plans/README.md`](docs/superpowers/plans/README.md).

### W0 — schema bundle (US-B00)
- US-B00: `0009_settings.sql`, `0011_push_subscriptions.sql`, `0012_jobs_phase_b.sql` (4 jobs +
  the `cost_daily` view), `0013_publication_phase_b.sql`, `packages/kernel/src/settings.ts` and the
  root scripts, in one worktree so the five plans share a single owner (cross-review M1–M3).

### W1 — memory, identity, adapters, ops
- US-B01: `@omnis/memory` scaffold + thin pgvector layer — `embed()` (Ollama `nomic-embed-text-v1.5`, 768d), `upsertMemory()`, `searchMemories()` over the partial HNSW, `invalidateBySource()`
- US-B02: self-model 3-file loader (`USER.md`/`VOICE.md`/`PROJECTS.md`) + frozen git snapshot with per-file token caps
- US-B03: person identity resolution — 6 `handle_norm` transforms, the 4-step resolve, `mergePersons()`/`splitIdentity()`, and `items.author_person_id` finally populated
- US-B04: bi-temporal `entities`/`relations` write API — four timestamps on every write, `asOf(ts)` queries
- US-B14: cost meter — 5 `costState()` states, VIP·sensitive reserve accounting, the loop gate, `cost_daily` + the 00:05 job
- US-B16: Web Push VAPID keypair generation, Keychain storage, documented rotation
- US-B34: Tailscale Serve mounts + ACL docs (Funnel always off; 5432 and 11434 never in `dst`)
- US-B37: Outlook adapter — `/common` OAuth, delta polling, `conversationId` threads, 3 write-backs
- US-B38: Telegram adapter — mtcute sidecar, QR pairing, MTProto update stream, flood-wait
- US-B39: Hermes read-only session in `local-agent` — `X-Hermes-Session-Key`, `/v1/responses` SSE, `origin:'human'` only
- US-B41: backup — `pg_dump --format=custom` + restic, forget policy, quarterly restore rehearsal
- US-B43: mini boot preflight — FileVault, `pmset`, LaunchAgents and Ollama models in one script

### W2 — agent core, notifications, adapter health
- US-B05: context assembler + `<data>` normalization and injection tagging, cache-boundary discipline, 5-step truncation (20 injection cases)
- US-B06: loop runtime contract — `LoopSpec`/`runLoopSpec`, budget enforcement, the 7 failure handlers
- US-B07: tool palette — 7 read tools + 6 `propose_*` tools that only store; phantom-tool and egress-import guards
- US-B13: draft pure functions — register, needs-reply score, channel shape, 6-point self-check
- US-B15: 3-tier notification router — immediate/batched/silent, quiet hours, `push_batch` collapsing to one "N drafts ready" (body = first 80 chars)
- US-B17: the two delivery paths — macOS local notifications + a VAPID Web Push sender; failures become system Items
- US-B18: `archiveItem`/`undoArchive` — 7-day undo, 30-day re-archive exclusion, no hard-delete path
- US-B40: adapter health → system Item, plus the real `token_refresh`, `gmail_rewatch` (7 days) and `graph_sub_renew` (10,080 minutes) jobs
- US-B42: monitoring — healthchecks.io pings, self-hosted ntfy dual alerting, 30-day log rotation with secret masking

### W3 — ingestion, loops, digests
- US-B08: L9 ingestion core — 3 chunkers, T1 extraction populating the four timestamps, `ingest_sources` cursor, dead-letter after 3 failures
- US-B09: local ingestion (mini) — FSEvents + one boot rescan, folder allowlist, hard exclusion rules decided by path alone
- US-B10: local ingestion (MacBook) — `ingest.scan`/`ingest.read` RPCs with the three caps, hub consumer catching up via `since`
- US-B11: Drive + GitHub polling — `changes.list` tombstones to `invalidated_at`, ETag `If-None-Match`, rate-limit backoff
- US-B12: recall evaluation harness — 50 cases, `pnpm eval:memory` recall@10, CI hard gate on exclusion patterns
- US-B13: `draftLoop` — the 60s SLA with a `meta.pending` placeholder past 55s, 6 tier-escalation conditions
- US-B18: `autoArchiveLoop` — the 5 hard gates, verdicts ①③④ pure SQL, only ②·④-b T1 at `confidence ≥ 0.85`, the 22:00 sweep
- US-B19: L3 todo extraction + the pure-SQL reminder job (precision first, `confidence < 0.70` not stored)
- US-B20: delegation — regex hints + `routeByRule()`, the 4 runaway guards, approval to `delegate.run`
- US-B21: L7 note routing — at most 3 candidates, never auto-attach
- US-B22: L6 network follow-up — first-contact detection + the weekday inactivity sweep
- US-B23: L5 morning briefing — a synchronous 06:30 call with arithmetic ranking (not an LLM)
- US-B24: L5 nightly digest + T2 `memory_consolidate`, full auto-archive exposure and the cost field
- US-B25: self-model patch proposals — the Sunday job, approved `git apply`, 4-week suppression by diff hash

### W4a — backend surfaces
- US-B26: unified search API — `GET /search`, four parallel branches, within-group normalization and merged ranking
- US-B27: ⌘K search mode — the palette falls through to results, fixed group order, 180ms debounce
- US-B33: the `settings` write path
- US-B39: `GET /transcript/:session_id` — the agent session transcript (surfaces plan Task 11)
- US-B44: monthly cost·usage report job — tokens, cost and cache hit rate by loop·tier·provider

### W4b — screens + PWA
- US-B28: Today screen — greeting, nightly digest card, calendar, briefing list, all 4 states
- US-B29: Tasks screen — 4 view tabs, quick add via `t`, inline delegation approval
- US-B30: Network screen — `PersonCard`, follow-up queue, person detail pane, merge/split UI
- US-B31: Notes screen — one-line input, routing suggestion with 3 buttons
- US-B32: Digest screen — category accordion, group and item restore, monthly cost report
- US-B33: Settings screen — 4 sub-navs, editable cost cap, autonomy toggle, allowlists, quiet hours, 2-step kill switch
- US-B35: `apps/web` PWA shell — Vite + `@omnis/ui`, 5-slot bottom tab bar, manifest, service worker, install guide card, swipe actions
- US-B36: PWA Web Push subscription — in-context permission on the first pending approval, `POST`/`DELETE /push/subscribe`, `notificationclick` Approve/Open

### W5 — adapter wiring
- US-B45: hub adapter registry + bootstrap wiring — `accounts` to `AuthRef` to each adapter's `connect()`, injectable factories, a per-account `subscribe()` health loop — plus the follow-up hardening (boot timeout, health recovery, per-account failure)

### Design waves
- **D1–D7 merged.** D1/D2/D2b/D3 (brand marks, responsive shell, filter pills, detail pane), D4, D6 (monotone base, accent direction) with D6fix, and D7 (design direction v3 — rail reorder, mascot verification, fluid motion).
- **D8–D9 remain.** `docs/design/DESIGN-DIRECTION-v3.md` specifies them; D8's token slice is on `plan/design-w2` (US-D08) and is not merged.

### English-only and history rewrite
- **English is the repository rule** (`35d3501`) — UI copy, identifiers, comments, test names, docs and commit messages.
- **Three sweeps** — `plan/en-{spec,plans,spikes,toolkits}`, `plan/en-r1`–`en-r4` and `plan/en2-{kernel,agents,adapters,hubtools,registry}` — 122 `i18n(en):` commits translating the spec, design and plans.
- **Default UI copy is English** (`docs/decisions/2026-09-21-english-ui-copy.md`) — A5 §8's microcopy table and §9's QA checklist were rewritten; runtime content language stays a separate axis.
- **History rewrite** — the repository history was rewritten with `git filter-repo`, preserving the interrupted slice as `d62ca78`. Because the sweep had translated comments inside the 13 already-applied migrations, their bytes were restored to the frozen state (`a50ad00`) and the English-only rule now exempts `0001`–`0013` explicitly (`4bd1d9c`) — `migrate.ts` hashes file bytes and refuses to run when an applied file changes.

### Evidence
- `pnpm test` — 221 test files passing, 1 skipped; 1,956 tests passing, 2 skipped.
- `pnpm lint` and `pnpm typecheck` — clean.
- `pnpm e2e:phase-a` — 34/34 checks PASS on two consecutive runs (the idempotence check); evidence in `tools/e2e/REPORT.md`.
- `pnpm e2e:phase-b` — the Phase B smoke entry point.

## 0.1.0-alpha — 2026-09-20

Phase A built end to end on `main` (35/35 stories, US-A00–A31 incl. A19b/A22b/A23b), across three waves.

### Wave 0 — Phase 0 spikes + foundations
- US-A00: Phase 0 spike scaffolds for all 14 gates
- US-A01: `@omnis/db` package — typed query helpers, forward-only migration runner
- US-A11: `@omnis/protocol` value sets and branded types
- US-A24: `@omnis/ui` design tokens + Glass/Opaque surface layer rule

### Wave 1 — kernel, bridge, adapters, agents, desktop scaffolds
- US-A02–A04: DB migrations 0001–0006 (extensions, core inbox, labels, tasks/approvals, memory/HNSW)
- US-A05: kernel event bus (3-tier routing) + DB trigger fan-out
- US-A06: scheduler (jobs table + cron executor)
- US-A07: `pending_approvals` propose/decide + execution transitions
- US-A08: kill switch (global flag + autonomous-loop checkpoint)
- US-A09: audit-record + no-approval-no-send invariant query
- US-A16: agent bridge core types, wire schemas, error codes, protocol version negotiation
- US-A12–A15: Slack/Gmail/Google Calendar adapter scaffolds (connect/backfill/normalize/send) + Slack fixture set
- US-A17: `local-agent` package — TOML config, session registry, WS JSON-RPC client, durable outbox, RPC dispatcher
- US-A22b, A23, A23b: `@omnis/agents` scaffold + recordRun, 3-stage classify (rules → embedding kNN → T1), sensitivity hook
- US-A25: Tauri 2 scaffold + vibrancy CSS fallback

### Wave 2 — sync, agent runtimes, desktop screens
- US-A10: `apps/hub` bootstrap — HTTP surface, WS `/bridge`, graceful shutdown
- US-A18, A19, A19b, A20: Claude Code/claude-ds runtime + Codex app-server client + host profiles + mock runtimes
- US-A21, A22: Zero schema (16 tables) + client init + round-trip test
- US-A26–A31: desktop screens — Inbox (InboxRow, filters), Thread (StatusBadge/DraftCard), Agent Session (ToolCallBadge), Command Palette, Approval card, Onboarding (Keychain wiring)

### Cross-cutting
- CI (`lint`/`typecheck`/`unit`/`contract`/`integration`) green on every merge
- Gates ⑥⑦⑧⑪⑫⑬⑭ run unattended (⑪ FAIL → ⑪b PASS supersedes it); gates ⑨⑩①②③④⑤ remain Logan-assisted
