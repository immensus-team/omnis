# Loop r1: verification report

**Build:** `plan/loop-r1` @ `5c674a0` (all eight stories merged).
**Stack:** a fresh seed of the same fixture the testers used (`hold.ts --web`: `seed` + `varyInboxCopy` + `densify`) on DB `omnis_test_loop_r1_verify`, offset 300 (desktop :5473, PWA :5474).
**How:** every finding in `findings-logan.md` (L-01…L-44) and `findings-newcomer.md` (NC-01…NC-40) was re-run with Playwright at its own width, with real keys and clicks. Results were checked against the DB and the network log where that matters. S9 (continuous resize) and S10 (keyboard only) were re-run in full. The eight story evidence scripts (`tools/e2e/shots-loop-r1-0N.ts`) were replayed against the same stack as a regression pass.
**Screenshots:** "before" images are the testers' (`test-logan/`, `test-newcomer/`); "after" images are in `verify/`.
**Date:** 2026-09-21

## Verdict

The round did what it planned. All 12 blockers it took on are fixed:

- L-01…L-04, L-06…L-08
- NC-01…NC-03, NC-05, NC-06

Logan can now triage by keyboard, undo an archive, reach every screen, use the phone-width list, and see the PWA rows. The only blocker left is the one the backlog deferred on purpose: **replying (L-05 / NC-04)**.

The round focus is two-thirds done:

- **Triage speed:** fixed at the core. `j`/`k`/`e`/`z`, the toasts and failure messages all work.
- **Responsive:** fixed at the core. List-first below 1280, the sheet has Back and Close, no page overflow at any width.
- **Agent observability:** half done. The header, state and empty states landed. But on the real ingest path, tool calls never get their arguments (N-01), so the new expand control never appears outside the evidence script's patched fixture. A blocked session still can't tell you what it is waiting on.

Nothing that worked before this round broke. One disagreement got louder: the approval counts (L-29 / NC-22) now sit side by side in the Inbox header.

| | Fixed | Partly fixed | Still open | Worse |
|---|---|---|---|---|
| Logan (44) | 16 | 9 | 18 | 1 |
| Newcomer (40) | 14 | 8 | 17 | 1 |
| **Total (84)** | **30** | **17** | **35** | **2** |

**New:** 8 findings (N-01…N-08). One is major.
**Checks:**
- `pnpm lint` and `pnpm typecheck` pass at `5c674a0`.
- Story replay: 01, 02, 03, 04, 06, 07 and 08 pass.
- 05 fails its own check (N-07; the product behaviour it checks is correct).
- 07 passes only on a fresh seed.

## Before / after

| Finding | Before | After |
|---|---|---|
| L-04 / NC-03: at 390 the list comes first; approvals are a subline link | ![](test-logan/s1-inbox-390.png) | ![](verify/s1-inbox-390.png) |
| …and the queue opens as a sheet with Back and Close (Esc closes it) | ![](test-newcomer/s0-first-load-390.png) | ![](verify/s1-approval-sheet-390.png) |
| L-02 / L-03: `e` archives and advances; "Archived · Undo" toast, `z` / ⌘Z | ![](test-logan/s1-click-then-e-1440.png) | ![](verify/s1-archive-step1-1440.png) |
| L-06 / NC-01 / L-33: Today reached with `g t`; the rail tile follows the screen | ![](test-logan/s6-today-1440.png) | ![](verify/s6-today-1440.png) |
| L-07 / NC-05: quick-add stores the task and says so | ![](test-logan/s6-tasks-added-1440.png) | ![](verify/s6-tasks-added-1440.png) |
| L-14 / NC-07: Notes save reaches the hub | ![](test-logan/s6-notes-saved-1440.png) | ![](verify/s6-notes-saved-1440.png) |
| L-08 / NC-06: PWA rows (mobile emulation) | ![](test-logan/s8-pwa-inbox-390.png) | ![](verify/s8-pwa-inbox-390.png) |
| L-10 / NC-08: blocked session gets a header | ![](test-logan/s4-agent-session-1440.png) | ![](verify/s4-claude-code-inbox-draft-1440.png) |
| NC-09 / L-10: a working session with no output says so | ![](test-newcomer/s4-working-session-1440.png) | ![](verify/s4-drafting-3-inbox-replies-1440.png) |
| L-12: Ignore is deferred behind "Ignored · Undo" | ![](test-logan/s4-after-ignore-1440.png) | ![](verify/s4-after-ignore-1440.png) |
| NC-10 / L-11: Approve ends in an outcome toast | ![](test-logan/s4-after-approve-1440.png) | ![](verify/s4-after-approve-1440.png) |
| L-13: failed archive and failed approve are announced | ![](test-logan/s12-archive-fails-1440.png) | ![](verify/s12-archive-fails-1440.png) |
| L-15: ⌘K "PoC" + Enter opens the thread | ![](test-logan/s5-jump-thread-1440.png) | ![](verify/s5-jump-thread-1440.png) |
| L-16 / NC-13: Commands filter as you type | ![](test-logan/s5-commands-1440.png) | ![](verify/s5-commands-1440.png) |
| L-17: 1270, fresh load: the list is whole | ![](test-logan/s9-resize-1270.png) | ![](verify/s9-fresh-1270.png) |
| **Still open**, L-18: the AI panel opens on Tab and stays over the header | ![](test-logan/s1-tab-focus-1440.png) | ![](verify/s1-tab-focus-1440.png) |
| **Still open**, NC-16 / L-27: the hover card lands on the pane after a click | ![](test-newcomer/s1-archive-step2-1440.png) | ![](verify/s1-archive-step2-1440.png) |
| **Still open**, L-32 / NC-15: an empty filter is a blank card | ![](test-logan/s12-empty-filter-1440.png) | ![](verify/s12-empty-filter-1440.png) |
| **Still open**, L-09 / NC-14: hub and sync down is a white page | ![](test-logan/s12-no-sync-1440.png) | ![](verify/s12-no-sync-1440.png) |
| **New**, N-02: resized from 1440 to 1270, the auto-opened queue floats over the list | ![](test-logan/s9-resize-1270.png) | ![](verify/s9-resize-1270.png) |

## Findings: status

Status meanings:
- **fixed:** the repro no longer fails.
- **partly:** the core complaint is gone but a named piece remains.
- **open:** reproduces as reported.
- **worse:** reproduces, and more visibly than before.

"Story" is the r1 task that took the finding on. "—" means deferred in `BACKLOG.md`.

### Logan

| ID | Width | Status | Story | Evidence now |
|---|---|---|---|---|
| L-01 | 1440 | fixed | 03 / 01 | `j`, `k`, ↓ and ↑ move the selection and focus; every `g` sequence switches screen. `a` (approve) is still unbound. |
| L-02 | 1440 | fixed | 03 | `e e e` from keyboard focus alone archived three different threads (DB + three distinct POSTs). |
| L-03 | all | fixed | 06 | "Archived · Undo" toast. `z` restores (toast "Moved to Inbox · Undo"). ⌘Z also works. |
| L-04 | 390 | fixed | 02 | No sheet on load. The "8 need approval" link opens it, and Esc, "‹ Inbox" and Close all dismiss it. Drag-down still does nothing (see NC-32). |
| L-05 | all | open | — | Reply disabled; "Edit & send" inert; free text → "No results for …". |
| L-06 | all | fixed | 01 | Rail tiles for all six screens, `g t/k/n/o/d/s`, palette commands, and the Settings gear. |
| L-07 | all | fixed | 05 | `POST /tasks` 201, row in `tasks`, "Added to Tasks". But see N-06. |
| L-08 | 390 | fixed | 04 | PWA rows are 342px wide, names readable. `vendor-css.test.ts` guards the copy. |
| L-09 | all | open | — | With `/api` aborted and the Zero socket closed, the body is empty after 9s. |
| L-10 | all | partly | 07 | Header with title, state pill, runtime@host, started and last turn. "Working · no output yet" instead of a blank pane. **Tool calls do not expand on a real session** (N-01). A blocked session shows no approval it waits on. |
| L-11 | all | partly | 06 | "Approved: …" outcome toast. The confirm still shows neither body nor recipient, and the draft does not change after approval. |
| L-12 | all | fixed | 06 | Ignore sends nothing for 5s. Undo keeps the card; the pending count is unchanged in the DB. |
| L-13 | all | fixed | 06 | 500 on archive → "Couldn't archive. It's back in your inbox. Retry". 500 on approve → "Approval didn't go through. Retry". |
| L-14 | all | fixed | 05 | `/notes`, `/items`, `/digests`, `/tasks` proxied. `vite-proxy.test.ts` guards the table. The note is stored. |
| L-15 | all | fixed | 08 | Enter opens the top thread hit. ↓ Enter on "Dana Lee" opens her person card. |
| L-16 | all | partly | 08 | Seven "Go to" commands plus "Toggle detail pane", filtered by typing and by `>`. No archive, label, snooze or kill-switch commands. |
| L-17 | 900–1279 | fixed | 02 | A fresh load at 1270 and 1024 keeps the pane closed. But see N-02 for resizing into this tier. |
| L-18 | 1440 | open | — | The panel still opens on Tab focus and stays at opacity ≈0.77 over the Inbox header after focus moves to the list. `aria-expanded=true` at rest. 32 Tabs to row 1 (worse than 20). A new "Skip to inbox list" link makes it 2 keys for anyone who uses it. |
| L-19 | 1440 | partly | 03 | End/Home keep focus on a row. Enter opens with focus on the row. Esc closes and keeps focus. Tab from a row reaches the pane in one press. **Radio pills are still separate tab stops and ignore arrows** (the Settings segments too). |
| L-20 | all | open | — | Every account, `omnis` and `Agent` included, says "Connected". |
| L-21 | 390 | partly | 04 | `apple-touch-icon` plus 192/512 icons are in. A row tap still does nothing; Today and Tasks still show only the install card; no Approvals tab. |
| L-22 | all | open | — | The row menu holds Open and Archive. `l` opens the label *filter*, not a label action. |
| L-23 | all | open | — | Draft shown as a conversation item, an approval card and a draft card. "To: me" on a channel. |
| L-24 | all | open | — | "August 31 night digest" / "Nightly digest ready". |
| L-25 | 1440 | open | — | The draft card and its three buttons still render native (`border: 2px outset`, grey fill). See `verify/s3-draft-card-element-1440.png`. |
| L-26 | 420 pane, 390 | partly | 02 | The label is now "Edit", and actions wrap to a second row at 390 (Ignore at x 46–113, inside the card). The headline is still "Send needs your approval", with no person or channel. |
| L-27 | 1440, 390 | partly | — | The touch-tap fragment is gone at 390. At 1440 the hover card still opens over the pane after a click. |
| L-28 | 1440 | fixed | — | The row menu (a `dialog`) closes on Escape. |
| L-29 | all | **worse** | — | The new subline "8 need approval" (approvals) sits directly above "Needs approval 7" (threads). After archives: 7 vs 3. Today says 8. |
| L-30 | 1440 | open | — | Agent tile: 1 row. Agents tab: 7. The Slack tile lists six agent sessions. |
| L-31 | 1440 | open | — | Blocked `claude_code` still previews "✓ Turn completed"; every omnis session is a black "O". |
| L-32 | 1440 | open | — | The label chip still goes before the pills; an empty result is a blank card; the subline drops. |
| L-33 | 1440 | fixed | 01 / 04 | The system channel is "omnis" with the omnis mark; the active tile follows the screen; Settings works; Account is gone. The trailing "⌄" is unexplained. |
| L-34 | 1440 | open | — | Dana Lee "Messages 0"; lone "This is the same person" button. |
| L-35 | all | partly | 08 | The ⌘K panel is clean. The Thread Reply tooltip and the bottom bar's Compose still read "Not wired up yet — Phase B" (`PHASE_B_TITLE`). |
| L-36 | 1440 | open | — | Empty band above the icon pill; title printed twice; "To: me". |
| L-37 | 390 | open | — | Ask row (722–776) plus channel bar still ≈122px; "Model tiers" wraps (47px); Compose still disabled. |
| L-38 | 600, 890 | open | — | S9: "Archived" clipped at 600. With a thread open, the pane is caught mid-slide at 890 (x 224, width 650). |
| L-39 | phone | fixed | 04 | Viewport meta present. Mobile emulation lays out at 390 with 0px overflow. |
| L-40 | 1440 | open | — | The "90%" marker is unchanged. |
| L-41 | n/a | partly | each | 18 → 14 files with Korean comments (`zero-client.ts`, `api/threads.ts`, `api/keychain.ts`, five in `packages/agents`, `kernel/identity.ts`, `ui/types.ts`, `ui/lib/relative-time.ts`, `ui/i18n/{en,types,index}.ts`). |
| L-42 | all | open | — | Approvals are bare chips (now buttons that do nothing). "8 items … 8 approvals" double count. |
| L-43 | all | open | — | "Dana" returns only the person. |
| L-44 | n/a | fixed | (tooling) | `stack.ts` reads `OMNIS_E2E_DB`, `OMNIS_E2E_PORT_OFFSET` and `ZERO_SHARD_NUM`, and keeps a replica per DB; three stacks ran side by side this round. `engines: node >=22`; this run used Node 26 without the earlier zero-cache failure. |

### Newcomer

| ID | Width | Status | Story | Evidence now |
|---|---|---|---|---|
| NC-01 | all | fixed | 01 | As L-06. Rail tiles carry a `title` with the shortcut ("Today (g t)"). |
| NC-02 | all | fixed | 03 | As L-02. The pane follows the new selection. |
| NC-03 | 390–899 | fixed | 02 | As L-04. |
| NC-04 | all | open | — | As L-05. |
| NC-05 | all | fixed | 05 | As L-07. |
| NC-06 | 390, 1440 | fixed | 04 | As L-08. |
| NC-07 | all | fixed | 05 | As L-14. |
| NC-08 | all | partly | 07 | As L-10. Tool-call rows don't open (N-01). "Blocked · nothing to decide here yet" when the list says Blocked. |
| NC-09 | all | fixed | 07 / 02 | The empty state says "Working · no output yet". Esc returns the pane to the queue. |
| NC-10 | all | fixed | 06 | "Approved: …" toast. No Undo, by the backlog's rule. The confirm is still centered, not anchored to the card. |
| NC-11 | all | open | — | Cards still don't name recipient, channel or body; collapsed rows still read "Send". |
| NC-12 | 1440 | partly | 08 | Person hits open. The query is cleared on reopen. "Brightstone" still gives "No results"; "launch" still gives three identical "omnis launch sync" hits. |
| NC-13 | 1440 | fixed | 08 | Focus stays in the input after clicking Commands; typing filters. |
| NC-14 | all | open | — | As L-09. |
| NC-15 | all | open | — | As L-32. |
| NC-16 | 1440 | open | — | The hover card covers the pane after a click (`verify/s1-archive-step2-1440.png`). |
| NC-17 | all | partly | 01 / 04 | Distinct omnis glyph; dead buttons wired or removed; native `title` tooltips. Agent tile ≠ Agents tab (L-30). |
| NC-18 | 1440 | partly | 03 | One tab stop per row. Tab from an open row reaches the pane in 1 press (was 27). Arrows move rows; Esc closes. **No `?` sheet**; pills ignore arrows; 32 Tabs to row 1 without the skip link (L-18). |
| NC-19 | all | open | — | As L-34. |
| NC-20 | all | partly | 01 | The rail highlights the current screen. Approval chips (now buttons) and the digest card still do nothing when clicked. |
| NC-21 | phone | fixed | 04 | As L-39. |
| NC-22 | 1440 | **worse** | — | As L-29. |
| NC-23 | all | open | — | Orange dot on most rows, no tooltip. |
| NC-24 | all | open | — | "Draft:" prefix, cost chatter row, duplicate "omnis launch sync". |
| NC-25 | all | open | — | As L-31 / L-30. |
| NC-26 | 1440 | open | — | As L-36 / L-23. |
| NC-27 | 1440, 390 | fixed | 02 | As L-26: "Edit", no wrap inside a button, no clipping at 390. |
| NC-28 | 1440 | fixed | 03 | The focus ring is rounded and matches the row's hover shape. |
| NC-29 | 1440 | open | — | Collapsed, the expand chevron (x 1384) still sits inside the ask bar (x 108–1424). |
| NC-30 | 1440 | open | — | At the 720px maximum the list is 580px, and "+" after the Archived pill (right edge 686, list edge 688) is cut off. |
| NC-31 | 660–510 | fixed | — | S9: row 1 holds 72–73px at every step. |
| NC-32 | 390 | open | 02 | Dragging the sheet head still selects the sheet's text and does not dismiss it. The sheet has `user-select: auto`. |
| NC-33 | 390 | open | — | Filters sheet still ends in "Actions: Archive all 12 shown". |
| NC-34 | 1440, 390 | open | — | As L-40 / L-37; Agent and omnis are listed as connected accounts. |
| NC-35 | all | open | — | As L-24. |
| NC-36 | 390, 1440 | partly | 04 | Rows fixed. The Safari install card still shows in desktop Chrome at 1440; tabs are empty; row tap does nothing. |
| NC-37 | 390 | fixed | 02 | "‹ Inbox" and Close on the sheet; the toolbar buttons carry `aria-label`s ("Archive thread", "Thread options"). |
| NC-38 | all | open | — | "+" unchanged; the picker still offers "work" and "personal". |
| NC-39 | n/a | partly | each | As L-41. |
| NC-40 | all | partly | 08 | "Phase B" gone from the panel. The "Auto" model selector and "@" remain; the placeholder still says "ask". |

## New findings

| ID | Screen | Width | Severity | Finding |
|---|---|---|---|---|
| N-01 | Agent session | all | **major** | Tool calls lose their arguments on the real ingest path, so the loop-r1-07 expand never appears |
| N-02 | Shell | 1280→1279 | minor | Resizing from the column tier into the floating tier keeps the auto-opened queue open, translucent, over the list |
| N-03 | Inbox header | all | minor | "8 need approval" (subline) above "Needs approval 7" (pill): the L-29 disagreement is now side by side |
| N-04 | ⌘K | all | minor | Esc closes the palette but leaves focus in the ask input, so the next `g s` or `j` types into it |
| N-05 | Shell | all | minor | A `g` screen switch drops focus to `<body>` |
| N-06 | Tasks | all | minor | An undated quick-add goes to Someday while the Today view says "Added to Tasks" and "Nothing due today" |
| N-07 | Tooling | n/a | polish | `shots-loop-r1-05.ts` now fails, and the story scripts depend on the order they run in |
| N-08 | Tooling | n/a | polish | The hold stack died twice mid-session with no log line, leaving its children on the ports |

### N-01: tool calls lose their arguments
- **Repro:**
  1. Boot a fresh seed and open Agents → `claude_code · inbox-draft`. "Reading ✓ index.ts main.ts" is a plain badge with no disclosure (`details` count 0).
  2. `SELECT meta FROM items WHERE kind = 'tool_call'` gives `{}`.
  3. The hub log shows the runtime *did* send `"input":{"command":"ls src"}`.
- **Cause:**
  - `apps/local-agent/src/bridges/stream-json.ts` sends `input` only on `turn.item.started`. The `turn.item.completed` it emits for the `tool_result` carries `meta: { label }` and nothing else.
  - `apps/hub/src/bridge.ts:285` writes `args: meta.input ?? {}` on *both* events, and `writeAgentItem` upserts on the same external id. The completion therefore overwrites the arguments with `{}`.
  - `shots-loop-r1-07.ts` passes because its `repairFixture` writes the arguments back. Its header even names the `{}` as a fixture gap, but it is a product defect.
- **Fix:** don't touch `args` on completion. Either omit it and `COALESCE` in the upsert, or carry the input in the bridge's `toolLabels` map. Add a hub test that runs started → completed and asserts the args survive.

### N-02: the queue follows you into the floating tier
- **Repro:** load at 1440 (the queue opens in the column, as designed), then narrow the window to 1270. The queue is now a floating sheet over the right third of the list, and the rows show through it (`verify/s9-resize-1270.png`). A fresh load at 1270 is fine.
- **Fix:** in `App.tsx`, when the tier drops below 1280, close a pane that was auto-opened for approvals (keep one the user opened). Give the floating sheet an opaque backing like the list.

### N-03: two approval counts in one header
- **Repro:** the Inbox at load reads "8 need approval" over "Needs approval 7". After three archives it reads "7 need approval" over "Needs approval 3".
- **Fix:** see L-29. Choose one unit and use it in both places.

### N-04: the palette's Esc leaves you typing
- **Repro:** at 390 or 1440, press ⌘K, type "Dana", press Esc, then press `g` `s`. The input now holds "gs" and the screen doesn't change.
- **Fix:** Esc that closes the panel should restore focus to where ⌘K was pressed (the row).

### N-05: focus is lost on a screen switch
- **Repro:** press `g` `s`. `document.activeElement` is `<body>`, and the next Tab starts from the top of the page.
- **Fix:** focus the new screen's `h1` (with `tabindex=-1`) on switch.

### N-06: where did my task go?
- **Repro:** on Tasks → Today, add "Send Dana comments on the slides by Thursday". The row is stored with no due date. The view keeps "Nothing due today" under "Added to Tasks", and the task is only visible under Someday.
- **Fix:** name the view in the notice ("Added to Someday"), or switch to it.

### N-07: story scripts rot
- **r1-05:** `shots-loop-r1-05.ts:158` asserts exactly one `role=status`. Since r1-06, the shell always mounts `<output class="toast">`, which is also a `status`. The notice text is right; the count is 2.
- **Order dependence:** replaying 01→08 on one stack failed r1-07, because an earlier script archives the session row it looks for. It passes on a fresh seed.
- **Fix:** scope the r1-05 locator to `.tasks-screen`. Have each script restore what it archives, or reseed.

### N-08: the hold stack exits silently
- **What happened:** twice this session, `hold.ts` exited with no error in its log, the first time after about 20 minutes. zero-cache, the hub and both Vite servers kept running with ppid 1 on the offset ports, so the next `hold.ts` refused to start. Running it under the harness's background task kept it up.
- **Possible cause:** its detached parent shell exiting. Not confirmed.
- **Fix:** have `stack.ts` spawn children in the hold's process group and kill the group on exit (`process.on("exit")`, not only SIGINT/SIGTERM).

## Items merged this round

| Story | Commits | Covers | Result here |
|---|---|---|---|
| loop-r1-01 Reach every screen | `e074634` | L-06, NC-01, L-33, NC-17 (part), L-16 (part) | fixed; replay passes |
| loop-r1-02 The list comes first | `aa47681` | L-04, L-17, NC-03, NC-09, NC-37, NC-32, L-26, NC-27 | fixed except NC-32 (drag selects text) and N-02; replay passes |
| loop-r1-03 Keyboard triage | `a56c954` `4fcbc00` `40c8cc8` `73320db` | L-01, L-02, NC-02, NC-18, L-19, NC-28 | fixed except pills' arrow keys and `?`; replay passes |
| loop-r1-04 PWA rows, viewport, omnis mark | `1b41ecb` `b484e70` `a1b1e2e` | L-08, NC-06, L-39, NC-21, L-33/NC-17 glyph, L-21 icons | fixed; replay passes |
| loop-r1-05 Writes stop failing silently | `a0ac095` `307ff37` `af0537c` `bd73d5c` `8a59958` | L-14, NC-07, L-07, NC-05 | fixed; replay script fails its own check (N-07) |
| loop-r1-06 Undo and outcome toasts | `f3b75ff` `8537fc7` `7459216` `caa82c4` `2e1de03` | L-03, L-12, L-13, NC-10, L-11 (part) | fixed; replay passes |
| loop-r1-07 Agent session header | `188ace8` `aa173fa` `ac4a410` | L-10, NC-08, NC-09 | header and states fixed; expand broken on the live path (N-01); replay passes on a fresh seed |
| loop-r1-08 ⌘K | `e237d32` `5c674a0` | L-15, L-16, NC-12 (part), NC-13, NC-40 / L-35 (panel) | fixed for what it took on; replay passes |

## S9 and S10, re-run in full

**S9, 1440 → 390 in 10px steps, list only and with a thread open:**
- 0px page overflow at every step.
- The row height holds at 72–73px (NC-31 fixed).
- The tiers switch cleanly at 1280 (column → floating) and 900 (floating → sheet).
- Still wrong:
  - "Archived" is clipped at 600 (L-38).
  - The pane is caught mid-slide at 890 with a thread open (L-38).
  - The auto-opened queue stays up after crossing 1280 (N-02).

**S10, keyboard only at 1440:**

| Works | Doesn't |
|---|---|
| Skip link → list in 2 keys | `?` does nothing |
| `j`/`k`/↑/↓/Home/End move a single-stop list | `a` and `r` do nothing |
| Enter opens, Esc closes and keeps the row focused | Radio pills and Settings segments ignore arrows |
| `e` archives and advances; `z` and ⌘Z undo | Tabbing through the ask bar opens the panel, and it stays open (L-18) |
| `g` + letter reaches every screen | After `g` + letter, focus is on `<body>` (N-05) |
| ⌘K → Enter opens threads and people | ⌘K → Esc leaves focus in the input (N-04) |
| Tab from an open row reaches the pane in one press | |
| The approve confirm is keyboard-operable | |

## Next round suggestions

1. **Reply, end to end (blocker).** One draft card that *is* the approval, with an inline editor, destination ("Slack · #omnis-launch") and body in the confirm, and `r` to open it. Closes L-05, NC-04, L-23, L-11, NC-11, L-25 and NC-26.
2. **Agent observability, finished.** Fix N-01 (args survive completion). A blocked session shows what it waits on and previews that instead of "Turn completed". Runtime avatars. Agent sessions leave channel tiles. Closes L-31, L-30, NC-25 and the rest of NC-08.
3. **Keyboard, finished.** The ask panel closes on focus-out and is `inert` while closed. Esc restores focus (N-04), and screen switches focus the heading (N-05). Roving arrows on pills and segments. A `?` sheet. `a` approves. Closes L-18, L-19, NC-18 and N-04/05.
4. **One approval count.** A single selector for pending approvals, used by the subline, the pill, the queue and Today, with archived threads decided once. Fold in the Today rework: clickable approvals, digest link, agents block. Closes L-29, NC-22, N-03, L-42, NC-20.
5. **Connection state.** A shell-wide source (Zero status plus hub health) drives a banner and skeletons. Search says "offline", not "No results". Closes L-09 and NC-14.
6. **Triage polish slice.** Hover card never over the pane or a menu. Empty filter state plus chip after the pills. Collapse breakpoint about 650. No mid-slide on resize. `+` visible at max pane. Sheet drag-dismiss with `user-select: none`. Drop the auto-queue on tier change. Closes NC-16, L-27, L-32, NC-15, L-38, NC-30, NC-32, N-02.
7. **Honest screens.** Settings health from `last_health_at` / `last_error`, with omnis and Agent not listed as accounts. Stale digest named as stale. Network count and merge. Budget marker label. Remove `PHASE_B_TITLE` from Reply and Compose. Closes L-20, L-24/NC-35, L-34/NC-19, L-40/NC-34, L-35.
8. **PWA and hygiene.** A row tap opens a sheet. Hide the empty tabs or add an Approvals tab. The install card only on iOS Safari. Translate the last 14 Korean-comment files and add the grep to `pnpm lint`. Make the story scripts order-independent (N-07) and the hold stack reap its children (N-08). Closes L-21, NC-36, L-41, NC-39.
