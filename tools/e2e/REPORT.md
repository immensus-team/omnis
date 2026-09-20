# Phase A End-to-End Smoke Report

Generated: 2026-09-20T21:36:06.127Z · `pnpm e2e:phase-a` (tools/e2e/run.ts)

Stack: PostgreSQL `omnis_e2e` (migrations 0001–0008 + Zero permissions) → zero-cache :4848
→ hub :8787 (HTTP + WS /bridge) → local agent bridge (mock runtime fixtures, host=macbook)
→ desktop Vite dev :5173 → Playwright (chromium, headless).

Every part of the seed takes a real code path: adapter `normalize()` → kernel `IngestSink`,
kernel `approvals.propose`, `classify()` from `@omnis/agents` (T0 rule path, no network calls),
`ClaudeCodeAdapter` + `apps/local-agent/test` fixture replay.

## Pass 1 (13.0s, items=14)

| Result | Check | Time | Note |
| --- | --- | --- | --- |
| PASS | only the rail carries an aurora when the ask panel is closed | 2ms | 1 surface, variant=mist |
| PASS | no aurora inside a list row (§4.2) | 3ms | 0 list rows tinted |
| PASS | opening the ask panel adds exactly one dawn surface | 75ms | 2 surfaces: rail + aurora ask-panel |
| PASS | every rendered aurora mass still computes blur + drop-shadow (§2.4) | 2ms | 1 mass(es) blurred and rimmed; 1 hidden by variant |
| PASS | no aurora inside a message body, thread item or draft card (§4.2) | 50ms | 0 message bodies tinted |
| PASS | every aurora is one of §3.2's three surfaces, outside §4.2's list | 2ms | 2 surface(s) checked against the §3.2 allow-list |
| PASS | no element carries both .aurora and .glass-surface (§2.7) | 1ms | 0 collisions |
| PASS | no aurora, or its ancestor, carries a filter (§2.4) | 0ms | every wrapper computes filter: none, no filtered ancestor |
| PASS | the glass inside an aurora is still glass (§4.4) | 1ms | 2 glass plate(s) blurring inside an aurora |
| PASS | screen 1 (nothing selected) | 697ms | 320px: overflow 0px, worst svg > rect +61.7px; 375px: overflow 0px, worst svg > rect +6.7px; 390px: overflow 0px; 414px: overflow 0px; 768px: overflow 0px |
| PASS | screen 2 (ask panel open) | 751ms | 320px: overflow 0px, worst svg > rect +61.7px; 375px: overflow 0px, worst svg > rect +6.7px; 390px: overflow 0px; 414px: overflow 0px; 768px: overflow 0px |
| PASS | screen 4 (agents filter) | 737ms | 320px: overflow 0px, worst svg > rect +195.2px; 375px: overflow 0px, worst svg > rect +140.2px; 390px: overflow 0px, worst svg > rect +125.2px; 414px: overflow 0px, worst svg > rect +101.2px; 768px: overflow 0px |
| PASS | onboarding is a single void surface | 1ms | 1 surface, variant=void |
| PASS | every word sits on the scrim card, never on the aurora (§5.3 guard 4) | 1ms | 0 text nodes outside the card |
| PASS | onboarding does not scroll sideways at the four widths (§5.2) | 638ms | 320px: overflow 0px; 375px: overflow 0px; 390px: overflow 0px; 414px: overflow 0px; 768px: overflow 0px |
| PASS | A1 Inbox lists one row per seeded thread (U2: a row is a thread, not an item) | 18ms | 8 thread rows (item count was 14) |
| PASS | A2 Inbox rows show a visible channel icon for all three channels | 29ms | Slack message / Gmail message / Google Calendar message |
| PASS | A2b Inbox rows show the seeded thread titles | 1ms | #omnis-launch / omnis launch sync |
| PASS | A3 Inbox rows carry label chips | 2ms |  |
| PASS | A2c kinso shell: channel rail tiles + ask/search bar | 8ms | rail: Inbox/Slack/Gmail/Google Calendar/Agent + ask bar |
| PASS | A2d a conversation row has avatar + name + relative time + summary | 3ms | time="now" summary="Draft: Yes, I will review it today.…" |
| PASS | A4 work/personal filter pills change the list | 96ms | all=8 work=[#omnis-launch] personal=[Dana Lee <dana@example.com>] |
| PASS | A4b channel rail tile filters the list, Inbox tile restores it | 71ms | all=8 gmail=2 |
| PASS | A5 Thread screen renders seeded items with status badges | 40ms | 4 status badges |
| PASS | A6 Agent Session screen shows turns and a ToolCallBadge | 50ms |  |
| PASS | A7 Approval card shows the pending approval | 39ms |  |
| PASS | A8 Approve → hub moves the approval to decided | 42ms | pending → decided |
| PASS | A9 ⌘K opens the floating AI panel and types into the command list | 22ms | panel + cmdk list reachable by typing |
| PASS | A-archive archiving a row removes it from the list and restoring brings it back | 700ms | "omnis launch sync" archived → restored (8 rows), 2 audit_log actions recorded |
| PASS | G5 a new item reaches the UI in ≤2s | 69ms | 28ms ingest → on screen (target ≤2000ms) |
| PASS | A8b hub recorded audit_log(approval.decided) | 1ms | 1 row(s) |
| PASS | A8c pending_approvals.state moved to decided(accept) | 0ms | state=decided decision=accept |
| PASS | A10 classify() recorded a T0 run in agent_runs (no network) | 0ms | 1 run(s), tier=T0 |
| PASS | A11 local-agent registered over WS /bridge | 0ms | agent_runtimes state=online |

## Pass 2 (12.6s, items=14)

| Result | Check | Time | Note |
| --- | --- | --- | --- |
| PASS | only the rail carries an aurora when the ask panel is closed | 2ms | 1 surface, variant=mist |
| PASS | no aurora inside a list row (§4.2) | 3ms | 0 list rows tinted |
| PASS | opening the ask panel adds exactly one dawn surface | 65ms | 2 surfaces: rail + aurora ask-panel |
| PASS | every rendered aurora mass still computes blur + drop-shadow (§2.4) | 2ms | 1 mass(es) blurred and rimmed; 1 hidden by variant |
| PASS | no aurora inside a message body, thread item or draft card (§4.2) | 39ms | 0 message bodies tinted |
| PASS | every aurora is one of §3.2's three surfaces, outside §4.2's list | 1ms | 2 surface(s) checked against the §3.2 allow-list |
| PASS | no element carries both .aurora and .glass-surface (§2.7) | 1ms | 0 collisions |
| PASS | no aurora, or its ancestor, carries a filter (§2.4) | 2ms | every wrapper computes filter: none, no filtered ancestor |
| PASS | the glass inside an aurora is still glass (§4.4) | 1ms | 2 glass plate(s) blurring inside an aurora |
| PASS | screen 1 (nothing selected) | 719ms | 320px: overflow 0px, worst svg > rect +61.7px; 375px: overflow 0px, worst svg > rect +6.7px; 390px: overflow 0px; 414px: overflow 0px; 768px: overflow 0px |
| PASS | screen 2 (ask panel open) | 737ms | 320px: overflow 0px, worst svg > rect +61.7px; 375px: overflow 0px, worst svg > rect +6.7px; 390px: overflow 0px; 414px: overflow 0px; 768px: overflow 0px |
| PASS | screen 4 (agents filter) | 739ms | 320px: overflow 0px, worst svg > rect +195.2px; 375px: overflow 0px, worst svg > rect +140.2px; 390px: overflow 0px, worst svg > rect +125.2px; 414px: overflow 0px, worst svg > rect +101.2px; 768px: overflow 0px |
| PASS | onboarding is a single void surface | 1ms | 1 surface, variant=void |
| PASS | every word sits on the scrim card, never on the aurora (§5.3 guard 4) | 1ms | 0 text nodes outside the card |
| PASS | onboarding does not scroll sideways at the four widths (§5.2) | 622ms | 320px: overflow 0px; 375px: overflow 0px; 390px: overflow 0px; 414px: overflow 0px; 768px: overflow 0px |
| PASS | A1 Inbox lists one row per seeded thread (U2: a row is a thread, not an item) | 18ms | 8 thread rows (item count was 14) |
| PASS | A2 Inbox rows show a visible channel icon for all three channels | 28ms | Slack message / Gmail message / Google Calendar message |
| PASS | A2b Inbox rows show the seeded thread titles | 2ms | #omnis-launch / omnis launch sync |
| PASS | A3 Inbox rows carry label chips | 1ms |  |
| PASS | A2c kinso shell: channel rail tiles + ask/search bar | 6ms | rail: Inbox/Slack/Gmail/Google Calendar/Agent + ask bar |
| PASS | A2d a conversation row has avatar + name + relative time + summary | 3ms | time="now" summary="Draft: Yes, I will review it today.…" |
| PASS | A4 work/personal filter pills change the list | 96ms | all=8 work=[#omnis-launch] personal=[Dana Lee <dana@example.com>] |
| PASS | A4b channel rail tile filters the list, Inbox tile restores it | 69ms | all=8 gmail=2 |
| PASS | A5 Thread screen renders seeded items with status badges | 40ms | 4 status badges |
| PASS | A6 Agent Session screen shows turns and a ToolCallBadge | 47ms |  |
| PASS | A7 Approval card shows the pending approval | 38ms |  |
| PASS | A8 Approve → hub moves the approval to decided | 39ms | pending → decided |
| PASS | A9 ⌘K opens the floating AI panel and types into the command list | 19ms | panel + cmdk list reachable by typing |
| PASS | A-archive archiving a row removes it from the list and restoring brings it back | 698ms | "omnis launch sync" archived → restored (8 rows), 2 audit_log actions recorded |
| PASS | G5 a new item reaches the UI in ≤2s | 70ms | 28ms ingest → on screen (target ≤2000ms) |
| PASS | A8b hub recorded audit_log(approval.decided) | 1ms | 1 row(s) |
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
