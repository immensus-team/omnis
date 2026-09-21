# Phase 0/A/B plans index

- **Contract** — [`2026-09-20-phase-a-interfaces.md`](2026-09-20-phase-a-interfaces.md): cross-plan package/export contract (types, env vars, keychain naming, root scaffold ownership).
- **6 plans**:
  - [`2026-09-20-phase-0-spikes.md`](2026-09-20-phase-0-spikes.md) — US-A00, gates ①–⑭
  - [`2026-09-20-phase-a-kernel-and-db.md`](2026-09-20-phase-a-kernel-and-db.md) — US-A01–A10
  - [`2026-09-20-phase-a-protocol-and-adapters.md`](2026-09-20-phase-a-protocol-and-adapters.md) — US-A11–A15
  - [`2026-09-20-phase-a-agent-bridge.md`](2026-09-20-phase-a-agent-bridge.md) — US-A16–A20
  - [`2026-09-20-phase-a-sync-and-agents.md`](2026-09-20-phase-a-sync-and-agents.md) — US-A21–A23b
  - [`2026-09-20-phase-a-desktop.md`](2026-09-20-phase-a-desktop.md) — US-A24–A31
- **Reviews** — [`2026-09-20-plans-review.md`](2026-09-20-plans-review.md): cross-plan consistency check (14 mismatches found and contract-fixed before Wave 0).
- **Handoff** — [`2026-09-20-logan-handoff.md`](2026-09-20-logan-handoff.md).

## Phase A status (2026-09-20)

All 35 stories merged to `main` (US-A00–A31, incl. A19b/A22b/A23b), 91 test files / 371 tests, lint+typecheck green.

Gate results (Phase 0, unattended):

| Gate | Question | Result |
|---|---|---|
| ⑥ | Zero + Postgres replication lag ≤2s | PASS |
| ⑦ | Codex app-server pin + 1-turn round trip | PASS (protocol round trip only) — the `agentMessage` item was never observed (Codex usage limit); **re-run after 2026-09-23 18:23** per [`tools/spikes/gate-07-codex-appserver/result.md`](../../../tools/spikes/gate-07-codex-appserver/result.md) |
| ⑧ | Ollama nomic-embed throughput | PASS |
| ⑪ | `claude -p --bare` hook injection | **FAIL** — `--settings` hooks merge with, don't replace, project hooks |
| ⑪b | `--permission-prompt-tool` headless approval surface | **PASS** — supersedes ⑪'s hook-based approach, works under `--bare` too |
| ⑫ | `--permission-mode` ↔ permission profile mapping | PASS |
| ⑬ | Zero replication of vector/tsvector/uuid[]/generated columns | PASS |
| ⑭ | worktrunk dry run | PASS (sibling worktree layout, not `.worktrees/<story-id>`) |

Gates ⑨⑩①②③④⑤ are Logan-assisted (real channel/OS access) and still open — see the README's "What needs Logan" list.

## Phase B plans (2026-09-20)

- **Backlog** — [`2026-09-20-phase-b-backlog.md`](2026-09-20-phase-b-backlog.md): 45 stories (US-B01–B45), dependency-ordered, grouped into the 5 plan files below.
- **Contract delta** — [`2026-09-20-phase-b-interfaces-delta.md`](2026-09-20-phase-b-interfaces-delta.md): what Phase B adds to the Phase A contract (new packages, exports, hub routes, jobs, env vars, migrations 0009–0013).
- **Cross review** — [`2026-09-20-phase-b-plans-review.md`](2026-09-20-phase-b-plans-review.md): 16 discrepancies (M1–M16) found and fixed before W0, plus the W0–W5 execution waves.
- **5 plans**: [`2026-09-20-phase-b-memory-ingestion.md`](2026-09-20-phase-b-memory-ingestion.md) (B01–B05, B08–B12) · [`2026-09-20-phase-b-agents.md`](2026-09-20-phase-b-agents.md) (B06–B07, B13–B25) · [`2026-09-20-phase-b-surfaces.md`](2026-09-20-phase-b-surfaces.md) (B26–B33, B35–B36) · [`2026-09-20-phase-b-channels.md`](2026-09-20-phase-b-channels.md) (B37–B40, B45) · [`2026-09-20-phase-b-ops.md`](2026-09-20-phase-b-ops.md) (B16, B34, B41–B44).

## Phase B status (2026-09-21)

All 45 stories merged to `main` (US-B01–B45), plus the W0 schema bundle (US-B00). Every link below
points at the plan task that landed the story; the wave names are the cross review's §3 waves, as
they were actually executed (W4 was split into W4a backend surfaces and W4b screens + PWA).

| Story | What landed | Plan task |
|---|---|---|
| US-B00 | W0 schema bundle — migrations 0009–0013, `settings.ts`, root scripts | — |
| US-B01 | `@omnis/memory` scaffold + thin pgvector layer (`embed`/`upsertMemory`/`searchMemories`/`invalidateBySource`) | [T1–T4](2026-09-20-phase-b-memory-ingestion.md#task-1-omnismemory-scaffold--protocol-ingest-types--root-scripts-us-b01-tier-sonnet) |
| US-B02 | self-model 3-file loader + frozen git snapshot with token caps | [T5–T6](2026-09-20-phase-b-memory-ingestion.md#task-5-self-model-snapshot-loader--token-caps-us-b02-tier-sonnet) |
| US-B03 | person identity resolution (`handleNorm`, 4-step resolve, merge/split) + `author_person_id` wiring | [T7–T9](2026-09-20-phase-b-memory-ingestion.md#task-7-handlenorm--6-deterministic-per-channel-identity-keys-us-b03-tier-opus) |
| US-B04 | bi-temporal `entities`/`relations` write API + `asOf(ts)` | [T10](2026-09-20-phase-b-memory-ingestion.md#task-10-bi-temporal-entities--relations-write-api-us-b04-tier-opus) |
| US-B05 | context assembler + `<data>` normalization and injection tagging (20 cases) | [T11–T13](2026-09-20-phase-b-memory-ingestion.md#task-11-data-normalization--injection-scanner-us-b05-tier-opus) |
| US-B06 | loop runtime contract — `LoopSpec`/`runLoopSpec`, budget, 7 failure handlers | [T1–T4](2026-09-20-phase-b-agents.md#task-1-loop-contract-types--registry-us-b06-tier-opus) |
| US-B07 | tool palette — 7 read tools + 6 `propose_*` tools | [T5](2026-09-20-phase-b-agents.md#task-5-tool-palette--the-seven-read-tools--the-six-propose_-tools-us-b07-tier-opus) |
| US-B08 | L9 ingestion core — chunkers, T1 extraction, `ingest_sources` cursor, dead-letter | [T14, T16–T17](2026-09-20-phase-b-memory-ingestion.md#task-14-three-chunking-strategies-us-b08-tier-opus) |
| US-B09 | local ingestion (mini) — FSEvents, folder allowlist, hard exclusion rules | [T15, T18](2026-09-20-phase-b-memory-ingestion.md#task-15-hard-exclusion-rules-isdenied-us-b09-tier-sonnet) |
| US-B10 | local ingestion (MacBook) — `ingest.scan`/`ingest.read` RPCs + hub consumer | [T19–T20](2026-09-20-phase-b-memory-ingestion.md#task-19-ingestscan--ingestread-rpc--macbook-bridge-us-b10-tier-opus) |
| US-B11 | Drive + GitHub polling ingestion (tombstones, ETag, backoff) | [T21–T22](2026-09-20-phase-b-memory-ingestion.md#task-21-drive-polling-provider-us-b11-tier-sonnet) |
| US-B12 | recall eval harness + exclusion-rule hard gate | [T23](2026-09-20-phase-b-memory-ingestion.md#task-23-recall-eval-harness--exclusion-rule-hard-gate-us-b12-tier-sonnet) |
| US-B13 | L2 reply draft loop — 60s SLA, register, 6-point self-check, 6 escalations | [T8–T9](2026-09-20-phase-b-agents.md#task-8-draft-pure-functions--register--needs-reply--channel-shape--self-check-us-b13-tier-opus) |
| US-B14 | cost meter — 5 states, VIP·sensitive reserve, `cost_daily` + 00:05 job | [T6–T7](2026-09-20-phase-b-agents.md#task-6-cost-meter--coststate--policy--currentpolicy-us-b14-tier-opus) |
| US-B15 | 3-tier notification router + `push_batch` | [T10–T11](2026-09-20-phase-b-agents.md#task-10-notification-tier-determination--quiet-hours-us-b15-tier-sonnet) |
| US-B16 | Web Push VAPID keypair generation, Keychain storage, rotation | [T1](2026-09-20-phase-b-ops.md#task-1-vapid-key-rotation-us-b16-tier-haiku) |
| US-B17 | notification delivery — macOS local + VAPID Web Push sender | [T12](2026-09-20-phase-b-agents.md#task-12-web-push-sender--macos-local-notifications-us-b17-tier-sonnet) |
| US-B18 | L8 auto-archive loop + 7-day undo (5 hard gates, 22:00 sweep) | [T13–T14](2026-09-20-phase-b-agents.md#task-13-archiveitem--undoarchive--7-day-undo--30-day-re-archive-exclusion-us-b18-tier-opus) |
| US-B19 | L3 todo extraction + the pure-SQL reminder job | [T15–T16](2026-09-20-phase-b-agents.md#task-15-taskloop--precision-first-todo-extraction-us-b19-tier-sonnet) |
| US-B20 | delegation — `routeByRule()`, 4 runaway guards, approved execution | [T17–T18](2026-09-20-phase-b-agents.md#task-17-extracthints--routebyrule--the-rules-come-first-us-b20-tier-opus) |
| US-B21 | L7 note routing — ≤3 candidates, never auto-attach | [T19](2026-09-20-phase-b-agents.md#task-19-noterouteloop--search-first-never-auto-attach-us-b21-tier-sonnet) |
| US-B22 | L6 network follow-up — first-contact detection + inactivity sweep | [T20](2026-09-20-phase-b-agents.md#task-20-followuploop--the-inactivity-detection-sweep-us-b22-tier-sonnet) |
| US-B23 | L5 morning briefing — arithmetic ranking, one `digests(kind='morning')` row | [T21](2026-09-20-phase-b-agents.md#task-21-rankbriefitems--morningdigestloop-us-b23-tier-opus) |
| US-B24 | L5 nightly digest + T2 memory consolidation | [T22–T23](2026-09-20-phase-b-agents.md#task-22-nightlydigestloop--full-auto-archive-exposure--the-cost-field-us-b24-tier-opus) |
| US-B25 | self-model patch proposals + approved `git apply` | [T24](2026-09-20-phase-b-agents.md#task-24-self-model-patch-proposals--apply-us-b25-tier-opus) |
| US-B26 | unified search API — `GET /search`, four branches, merged ranking | [T1](2026-09-20-phase-b-surfaces.md#task-1-unified-search-api--get-search-us-b26-tier-opus) |
| US-B27 | ⌘K search mode — palette falls through to results | [T2](2026-09-20-phase-b-surfaces.md#task-2-k-search-mode-us-b27-tier-sonnet) |
| US-B28 | Today screen — greeting, digest card, calendar, briefing list, 4 states | [T3](2026-09-20-phase-b-surfaces.md#task-3-today-screen-us-b28-tier-sonnet) |
| US-B29 | Tasks screen — 4 tabs, quick add, inline delegation approval | [T4](2026-09-20-phase-b-surfaces.md#task-4-tasks-screen-us-b29-tier-sonnet) |
| US-B30 | Network screen — person card, follow-up queue, detail pane, merge/split | [T5](2026-09-20-phase-b-surfaces.md#task-5-network-screen-us-b30-tier-sonnet) |
| US-B31 | Notes screen — routing suggestion with 3 buttons | [T6](2026-09-20-phase-b-surfaces.md#task-6-notes-screen-us-b31-tier-sonnet) |
| US-B32 | Digest screen — category accordion, restore, cost report | [T7](2026-09-20-phase-b-surfaces.md#task-7-digest-screen-us-b32-tier-sonnet) |
| US-B33 | Settings screen + the `settings` write path | [T8](2026-09-20-phase-b-surfaces.md#task-8-settings-screen--the-settings-write-path-us-b33-tier-sonnet) |
| US-B34 | Tailscale Serve mounts + ACL docs | [T2](2026-09-20-phase-b-ops.md#task-2-tailscale-serve-mount-us-b34-tier-sonnet) |
| US-B35 | `apps/web` PWA shell — bottom tab bar, manifest, service worker, install card | [T9](2026-09-20-phase-b-surfaces.md#task-9-appsweb-pwa-shell-us-b35-tier-sonnet) |
| US-B36 | PWA Web Push subscription — in-context permission, subscribe routes, `notificationclick` | [T10](2026-09-20-phase-b-surfaces.md#task-10-pwa-web-push-subscription-us-b36-tier-sonnet) |
| US-B37 | Outlook adapter — `/common` OAuth, delta polling, 3 write-backs | [T1–T5](2026-09-20-phase-b-channels.md#task-1-outlook-adapter--package-scaffold--normalize-us-b37-tier-sonnet) |
| US-B38 | Telegram adapter — mtcute sidecar, QR pairing, MTProto stream | [T6–T10](2026-09-20-phase-b-channels.md#task-6-telegram-adapter--package-scaffold--normalize-texteditdelete-us-b38-tier-sonnet) |
| US-B39 | Hermes read-only session + `GET /transcript/:session_id` | [T11-S, T11–T13](2026-09-20-phase-b-channels.md#task-11-hermes-bridge--probe--capabilities-self-description--session_key_header-verification-us-b39-tier-opus) |
| US-B40 | adapter health → system Item + real refresh/rewatch jobs | [T14–T16](2026-09-20-phase-b-channels.md#task-14-kernel--recordadapterhealth--dual-exposure-as-a-system-item--ntfy-us-b40-tier-sonnet) |
| US-B41 | backup — `pg_dump` + restic, forget policy, quarterly restore drill | [T3](2026-09-20-phase-b-ops.md#task-3-backup-and-quarterly-restore-drill-us-b41-tier-sonnet) |
| US-B42 | monitoring — healthcheck pings, ntfy dual alerting, log rotation | [T4](2026-09-20-phase-b-ops.md#task-4-healthcheck-ping-and-dual-alerting-us-b42-tier-sonnet) |
| US-B43 | mini boot preflight script | [T5](2026-09-20-phase-b-ops.md#task-5-mini-boot-preflight-us-b43-tier-haiku) |
| US-B44 | monthly cost·usage report job | [T6](2026-09-20-phase-b-ops.md#task-6-monthly-cost-report-job-us-b44-tier-sonnet) |
| US-B45 | hub adapter registry + bootstrap wiring | [T17](2026-09-20-phase-b-channels.md#task-17-hub-adapter-registry--bootstrap-wiring-us-b45-tier-opus) |

### Deferred

- **Auth connection day.** No live account is connected — every adapter, ingestion and push path is
  accepted on fixtures or a mock server (B-D5), and the manual OAuth/token/webhook gates (⑨⑩①②③④⑤)
  are still Logan-assisted and open. Connecting a real account is the single event that closes most
  of the list below.
- **Phase B exit metrics.** The three headline numbers — draft adoption rate ≥ 50%, send-without-edit
  rate ≥ 20%, briefing coverage ≥ 80% — are excluded from the exit verdict until real messages exist
  (backlog §7-1). What is *not* deferred, and is enforced today: **0 VIP·sensitive auto-archives** and
  **memory recall@10 ≥ 0.80**.
- **Golden sets are synthetic.** `eval/draft.jsonl` (40 cases) is graded against replies Logan
  actually sent, so it cannot be filled before connection. The task, note-routing and follow-up sets
  are synthetic too — the harness and the hard gates are real, the values are not.
- **Jev real evaluation is pending billing.** [`tools/spikes/gate-jev/RESULT.md`](../../../tools/spikes/gate-jev/RESULT.md)
  is **PENDING**: the credential resolves (`omnis.vercel.ai_gateway`) but the Gateway refuses to serve
  the account, so every number in that file is a mock run. Re-run `pnpm spike:jev` once billing is
  enabled; until then the decision tier stays behind its provider flag.
- **`memory_consolidate` needs a key.** `omnis.anthropic.api_key` is not in the Keychain, so US-B24's
  T2 consolidation is skipped and only the digest runs (backlog §6-6).
- **Design waves D8–D9.** Specified in [`DESIGN-DIRECTION-v3.md`](../../design/DESIGN-DIRECTION-v3.md);
  D8's token slice sits on `plan/design-w2` and is unmerged.
- **Gate ⑦ (Codex app-server)** needs a re-run after 2026-09-23 18:23 — the `agentMessage` item was
  never observed, and the first pass was cut short by a Codex usage limit.
- **iOS Web Push background reliability.** US-B36 instruments the delivery-miss rate; if it recurs it
  is the grounds for a native shell in v2.

### Numbers (2026-09-21)

- `pnpm test` (per-branch DB `omnis_test_phase_b_close`, migrations 0001–0014) — **221 test files
  passing, 1 skipped (222); 1,956 tests passing, 2 skipped (1,958).** The skipped file is
  `apps/desktop/test/integration/zero-client.test.ts` (`describe.skipIf(!zeroCacheUrl)`: the Zero
  permissions round trip needs a running zero-cache).
- `pnpm lint` — clean (774 files). `pnpm typecheck` (`tsc --build --force`) — clean.
- `pnpm e2e:phase-a` — **34/34 checks PASS on each of two consecutive runs** (that is the idempotence
  check), 7 Playwright tests per pass; report and screenshots in
  [`tools/e2e/REPORT.md`](../../../tools/e2e/REPORT.md).
- `pnpm e2e:phase-b` — the Phase B smoke entry point (same runner, `--phase b`).
