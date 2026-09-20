# Changelog

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
