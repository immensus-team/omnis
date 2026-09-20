# Phase 0/A plans index

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

## Phase B plans (2026-09-20, backlog stage)

- **Backlog** — [`2026-09-20-phase-b-backlog.md`](2026-09-20-phase-b-backlog.md): 44 stories (US-B01–B44), dependency-ordered, grouped into the 5 plan files below.
- **Contract delta** — [`2026-09-20-phase-b-interfaces-delta.md`](2026-09-20-phase-b-interfaces-delta.md): what Phase B adds to the Phase A contract (new packages, exports, hub routes, jobs, env vars, migrations 0009–0013).
- **5 plans (not written yet)**: `…-phase-b-memory-ingestion.md` (B01–B05, B08–B12) · `…-phase-b-agents.md` (B06–B07, B13–B25) · `…-phase-b-surfaces.md` (B26–B33, B35–B36) · `…-phase-b-channels.md` (B37–B40) · `…-phase-b-ops.md` (B16, B34, B41–B44).
