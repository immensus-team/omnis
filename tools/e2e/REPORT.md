# Phase A End-to-End Smoke Report

Generated: 2026-09-20T18:56:50.960Z · `pnpm e2e:phase-a` (tools/e2e/run.ts)

Stack: PostgreSQL `omnis_e2e` (migrations 0001–0008 + Zero permissions) → zero-cache :4848
→ hub :8787 (HTTP + WS /bridge) → local agent bridge (mock runtime fixtures, host=macbook)
→ desktop Vite dev :5173 → Playwright (chromium, headless).

Every part of the seed takes a real code path: adapter `normalize()` → kernel `IngestSink`,
kernel `approvals.propose`, `classify()` from `@omnis/agents` (T0 rule path, no network calls),
`ClaudeCodeAdapter` + `apps/local-agent/test` fixture replay.

## Pass 1 (8.9s, items=14)

| Result | Check | Time | Note |
| --- | --- | --- | --- |
| PASS | A1 Inbox lists one row per seeded thread (U2: a row is a thread, not an item) | 10ms | 8 thread rows (item count was 14) |
| PASS | A2 Inbox rows show a visible channel icon for all three channels | 32ms | Slack message / Gmail message / Google Calendar message |
| PASS | A2b Inbox rows show the seeded thread titles | 2ms | #omnis-launch / omnis launch sync |
| PASS | A3 Inbox rows carry label chips | 3ms |  |
| PASS | A2c kinso shell: channel rail tiles + ask/search bar | 8ms | rail: Inbox/Slack/Gmail/Google Calendar/Agent + ask bar |
| PASS | A2d a conversation row has avatar + name + relative time + summary | 4ms | time="now" summary="Draft: Yes, I will review it today.…" |
| PASS | A4 work/personal filter pills change the list | 112ms | all=8 work=[#omnis-launch] personal=[Dana Lee <dana@example.com>] |
| PASS | A4b channel rail tile filters the list, Inbox tile restores it | 68ms | all=8 gmail=2 |
| PASS | A5 Thread screen renders seeded items with status badges | 43ms | 4 status badges |
| PASS | A6 Agent Session screen shows turns and a ToolCallBadge | 43ms |  |
| PASS | A7 Approval card shows the pending approval | 12ms |  |
| PASS | A8 Approve → hub moves the approval to decided | 41ms | pending → decided |
| PASS | A9 ⌘K opens the floating AI panel and types into the command list | 20ms | panel + cmdk list reachable by typing |
| PASS | A-archive archiving a row removes it from the list and restoring brings it back | 321ms | "omnis launch sync" archived → restored (8 rows), 2 audit_log actions recorded |
| PASS | G5 a new item reaches the UI in ≤2s | 72ms | 27ms ingest → on screen (target ≤2000ms) |
| PASS | A8b hub recorded audit_log(approval.decided) | 1ms | 1 row(s) |
| PASS | A8c pending_approvals.state moved to decided(accept) | 0ms | state=decided decision=accept |
| PASS | A10 classify() recorded a T0 run in agent_runs (no network) | 0ms | 1 run(s), tier=T0 |
| PASS | A11 local-agent registered over WS /bridge | 0ms | agent_runtimes state=online |

## Pass 2 (8.0s, items=14)

| Result | Check | Time | Note |
| --- | --- | --- | --- |
| PASS | A1 Inbox lists one row per seeded thread (U2: a row is a thread, not an item) | 12ms | 8 thread rows (item count was 14) |
| PASS | A2 Inbox rows show a visible channel icon for all three channels | 32ms | Slack message / Gmail message / Google Calendar message |
| PASS | A2b Inbox rows show the seeded thread titles | 2ms | #omnis-launch / omnis launch sync |
| PASS | A3 Inbox rows carry label chips | 3ms |  |
| PASS | A2c kinso shell: channel rail tiles + ask/search bar | 6ms | rail: Inbox/Slack/Gmail/Google Calendar/Agent + ask bar |
| PASS | A2d a conversation row has avatar + name + relative time + summary | 4ms | time="now" summary="Draft: Yes, I will review it today.…" |
| PASS | A4 work/personal filter pills change the list | 95ms | all=8 work=[#omnis-launch] personal=[Dana Lee <dana@example.com>] |
| PASS | A4b channel rail tile filters the list, Inbox tile restores it | 68ms | all=8 gmail=2 |
| PASS | A5 Thread screen renders seeded items with status badges | 41ms | 4 status badges |
| PASS | A6 Agent Session screen shows turns and a ToolCallBadge | 42ms |  |
| PASS | A7 Approval card shows the pending approval | 11ms |  |
| PASS | A8 Approve → hub moves the approval to decided | 41ms | pending → decided |
| PASS | A9 ⌘K opens the floating AI panel and types into the command list | 18ms | panel + cmdk list reachable by typing |
| PASS | A-archive archiving a row removes it from the list and restoring brings it back | 321ms | "omnis launch sync" archived → restored (8 rows), 2 audit_log actions recorded |
| PASS | G5 a new item reaches the UI in ≤2s | 69ms | 28ms ingest → on screen (target ≤2000ms) |
| PASS | A8b hub recorded audit_log(approval.decided) | 0ms | 1 row(s) |
| PASS | A8c pending_approvals.state moved to decided(accept) | 0ms | state=decided decision=accept |
| PASS | A10 classify() recorded a T0 run in agent_runs (no network) | 0ms | 1 run(s), tier=T0 |
| PASS | A11 local-agent registered over WS /bridge | 0ms | agent_runtimes state=online |

## Idempotence

Two consecutive runs produced the same result (PASS).

## How to read this (what the report does not claim)

- **The Inbox has been a thread list since U2 (kinso conversation rows).** Multiple messages in
  one thread collapse into a single row (the most recent item), and the row title is resolved as
  person display name → thread title → channel handle — the Phase A kernel IngestSink deliberately
  leaves author_person_id empty (resolving person identity is Phase B), so every seeded row falls
  through to the thread title. A1 checks the thread count; A2b checks that those titles are really
  on screen.
- **A2 looks at the visible icon, not the accessible name.** Channel icons are react-icons/si SVGs
  (they were monogram text before U2) — A2 confirms "something is actually drawn" via an svg child
  node and a non-zero bounding box.
- **A2c/A2d cover the kinso shell and the row anatomy.** A2c checks that the left channel rail
  tiles (Inbox/Slack/Gmail/Google Calendar/Agent) and the top "Start typing to ask or search" bar
  are up; A2d checks that a single row holds avatar, name, **relative-time grammar** (now/3m/2w/
  4 Aug — never an ISO timestamp) and a non-empty summary line. Without those two, A1/A2/A2b would
  still pass with the summary line missing entirely.
- **A4 checks identity, not counts.** Since U2 made rows per thread, the seed's work thread and
  personal thread are one each — "the counts differ" no longer holds (it actually broke at the U2
  merge), so the check became: the two filters' row sets do not overlap and both are proper subsets
  of all. A4b separately checks that clicking a rail tile narrows the list and the Inbox tile
  restores it.
- **T1 (DeepSeek/OpenRouter) calls are force-blocked.** The seed clears OMNIS_OPENROUTER_API_KEY
  before calling classify() — so even if tier 1 misses a rule and falls through to tier 3,
  t1Model() throws before the fetch. A10 separately checks that the recorded run has tier=T0.
- **Re-running this smoke overwrites REPORT.md and the evidence/ PNGs.** If you ran it before a
  merge, either revert with `git checkout -- tools/e2e` or commit the new results as they are.

## Evidence

The 8 PNGs in `tools/e2e/evidence/` (01-inbox / 02-inbox-filter-work / 03-thread /
04-agent-session / 05-approval-card / 06-command-palette / 07-g5-live-item /
08-archived — the Archived view with the archived pill on, US-A36).
05 crops to just the approval card element — shooting the full screen would produce exactly the
same image as 04 (the shell pins the approval card above the detail pane, so it is already in 04).

## Logs

hub.log · zero-cache.log · desktop.log under `tools/e2e/.logs/` (not committed).
