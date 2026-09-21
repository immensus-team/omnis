# Loop r1: newcomer user test

**Persona:** first day after connecting Slack and Gmail. Doesn't know shortcuts, reads every label, uses the mouse, and judges polish against Apple Mail, Superhuman and Linear.
**Build:** `plan/loop-r1` @ `eb65057`, seeded with `tools/e2e/seed.ts` + `densify()` (8 pending approvals, 9 agent sessions in all four states).
**How:** `OMNIS_E2E_DB=omnis_test_loop_r1_newcomer OMNIS_E2E_PORT_OFFSET=100 ZERO_SHARD_NUM=7 pnpm tsx tools/e2e/hold.ts --web` (desktop :5273, PWA :5274). Each scenario was driven with Playwright at 1440×900 and 390×844, and the result checked in the DB or on the network where that mattered.
**Screenshots:** `docs/design/loop/r1/test-newcomer/`. Names are `s<scenario>-<what>-<width>.png`.

## Verdict

A newcomer can read the inbox at 1440, and that's about it. The whole round focus fails:

- **Triage speed:** keyboard archive works once, then gets stuck (NC-02).
- **Replying:** you can't reply to anything (NC-04).
- **Agent observability:** a session shows a bare transcript at best and a blank pane at worst (NC-08, NC-09).
- **Phone:** the inbox is unreachable at 390 when any approval is pending (NC-03), and the PWA's rows are broken (NC-06).
- **Other screens:** Today, Tasks, Network, Notes, Digest and Settings can't be reached without editing the URL (NC-01).

What held up:

- Rail drag-reorder persists across reload.
- Label chips filter correctly.
- The archived view's Restore works.
- Settings saves and persists.
- Pane collapse, ⌘\ and drag-resize (clamped at 720px) work.
- Page-level horizontal overflow is 0px at every width from 1440 down to 390 in 10px steps.

## Findings

| ID | Screen | Width | Severity | Summary |
|---|---|---|---|---|
| NC-01 | Shell | all | blocker | Only Inbox is reachable. Today, Tasks, Network, Notes, Digest and Settings exist only behind `?screen=` |
| NC-02 | Inbox | all | blocker | Keyboard archive gets stuck after one thread: the selection stays on the archived row, so the next `e` re-archives it |
| NC-03 | Inbox (narrow) | 390–899 | blocker | The approval queue sheet covers the inbox on load and can't be dismissed |
| NC-04 | Thread / AI panel | all | blocker | No way to reply: Reply is disabled, "Draft a reply" says Phase B, "Edit & send" does nothing, the ask bar only searches |
| NC-05 | Tasks | all | blocker | Quick add clears the field and stores nothing, so the typed task is lost |
| NC-06 | PWA inbox | 390, 1440 | blocker | Rows collapse into a ~50px column (stale vendored CSS) |
| NC-07 | Notes, Digest | all (browser/dev shell) | major | `/notes`, `/digests`, `/items` aren't in the Vite proxy, so Save fails and Digest undo/restore can't work |
| NC-08 | Agent session | all | major | No header, state, runtime, cost or tool-call detail; a "Blocked" session shows "✓ Turn completed" and nothing to approve |
| NC-09 | Agent session | all | major | Sessions without a transcript open a blank pane, and the pane never returns to the queue |
| NC-10 | Approvals | all | major | Approving gives no outcome: the card silently swaps to the next one, with no toast and no undo |
| NC-11 | Approvals | all | major | Cards don't say what gets sent, to whom, or on which channel; button sets differ between cards |
| NC-12 | ⌘K search | 1440 | major | Misses text shown in row summaries, returns identical duplicates, person hits do nothing, and the old query survives reopening |
| NC-13 | ⌘K commands | 1440 | major | The Commands tab takes focus from the input; there's one command in total |
| NC-14 | Error/offline | all | major | Disconnected looks the same as empty: no loading state, search says "No results", Today says "Quiet day" |
| NC-15 | Inbox empty | all | major | A filter with no matches renders nothing, with no message and no "clear filters" |
| NC-16 | Inbox | 1440 | major | The row hover card opens over the detail pane and hides its approval card |
| NC-17 | Rail | all | major | No labels or tooltips, System and Settings share a gear icon, Account/Settings buttons are dead, "Agent" ≠ "Agents" |
| NC-18 | Keyboard | 1440 | major | 3 tab stops per row, 27 Tabs from a row to the pane, no arrow-key movement, no `?` help, Escape does nothing |
| NC-19 | Network | all | major | A lone "This is the same person" button would merge the account owner with Dana Lee |
| NC-20 | Today | all | major | Approvals are inert chips, the digest card is inert, and the rail highlights Inbox |
| NC-21 | Desktop web | phone | major | No `<meta name="viewport">`, so real phones render the 980px desktop layout, not the <900 tier |
| NC-22 | Counts | 1440 | minor | "Needs approval 7" tab next to 8 approvals in the pane; archiving drops the tab count but not the pane's |
| NC-23 | Inbox rows | all | minor | An unexplained orange dot on almost every row |
| NC-24 | Inbox rows | all | minor | "Draft:" prefixes, system cost chatter, and indistinguishable duplicate rows |
| NC-25 | Agents list | all | minor | Generic black "O" avatars; agent sessions show up under the Slack rail tile |
| NC-26 | Detail pane | 1440 | minor | ~130px dead band at the top, title printed twice, "To: me" on a channel, draft shown twice |
| NC-27 | Approval card | 1440, 390 | polish | "Edit & approve" wraps to two lines; "Ignore" is clipped at 390 |
| NC-28 | Inbox | 1440 | polish | Selected-row focus ring is a square blue box that bleeds past the card's corners |
| NC-29 | Shell | 1440 | polish | With the pane collapsed, its expand chevron sits inside the ask bar |
| NC-30 | Pane resize | 1440 | minor | At max width the tab row clips Archived and hides "+"; after collapse/expand the pane shows the queue while a row is still highlighted |
| NC-31 | Resize | 660–510 | polish | Row 1 grows 73→94px and shrinks back as the window narrows |
| NC-32 | Narrow sheet | 390 | polish | Dragging the sheet selects its text instead of moving it |
| NC-33 | Filters sheet | 390 | minor | A destructive "Archive all 15 shown" sits in the Filters sheet |
| NC-34 | Settings | 1440, 390 | minor | "$0 used" next to a "90%" marker, a cap with no unit, T1/T2 jargon, "Model tiers" wraps at 390 |
| NC-35 | Digest | all | minor | "August 31 night digest" on Sep 21 while Today says "Nightly digest ready" |
| NC-36 | PWA | 390, 1440 | major | The Safari install card shows in desktop Chrome, four of five tabs are empty, tapping a row does nothing |
| NC-37 | Thread (narrow) | 390 | major | An open thread has no back/close; the action-bar icons are unlabeled |
| NC-38 | Inbox header | all | minor | "+" reads as compose; the label picker offers "work"/"personal", which duplicate the tabs |
| NC-39 | Source | — | minor | Korean comments are left in 9 source files (English-only rule) |
| NC-40 | Ask bar | all | minor | The model selector, @ and attachment icons promise an assistant; what's there is search |

---

## NC-01: Only Inbox is reachable

- **Screen/width:** shell, all widths. **Severity:** blocker.
- **Expected:** the rail, the palette or a `g` shortcut takes me to Today, Tasks, Network, Notes, Digest and Settings (Linear's sidebar, Superhuman's `g` keys).
- **Actual:**
  - The rail has only channel tiles.
  - The avatar and gear at the bottom have `title="Not wired up yet — Phase B"` and do nothing.
  - ⌘K → Commands lists one item, "Go to Inbox".
  - `g t` and `g s` do nothing, although `use-keymap.ts` defines them.
  - The only way in is `?screen=today` in the URL (see `main.tsx` `previewElement`).
- **Repro:** load the app and look for Settings. Click the gear at the bottom-left: nothing. ⌘K → Commands: one entry. Press `g`, then `s`: nothing.
- **Screenshots:** `s0-first-load-1440.png`, `s5-commands-1440.png`, `s6-*-1440.png` (reached only via URL).
- **Proposed fix:**
  - `apps/desktop/src/App.tsx`: make `screen` shell state instead of a prop.
  - Add Today/Tasks/Network/Notes/Digest entries to `ChannelRail` (or a top section in the rail) and wire the bottom gear to Settings.
  - Add one palette action per screen.
  - Handle the `go-*` actions from `useKeymap` in the shell, not in `Inbox.tsx`.
  - `apps/desktop/src/main.tsx` keeps `?screen=` only as the initial value.

## NC-02: Keyboard archive gets stuck after one thread

- **Screen/width:** Inbox, all widths. **Severity:** blocker for S1.
- **Expected (Superhuman/Gmail):** `e` archives the selected thread and selects the next one; three `e` presses archive three threads.
- **Actual:**
  - The first `e` archives the thread, and focus moves to the next row.
  - The *selection* (`selectedId`) stays on the archived thread, and the pane keeps showing it with "Archived · Restore".
  - Each further `e` re-archives the same thread: the row flickers back in and plays its leave animation again, and nothing else is archived.
  - `j`/`k`/`↓` do nothing (`next-row`/`prev-row` are defined in `use-keymap.ts` but handled nowhere).
  - There is no undo toast. The only undo is the pane's small "Restore" link or `u`, which you'd need to already know.
- **Repro:** click row 1, press `e` three times, then query `threads.archived_at`: only row 1 is archived. The trace printed "db: omnis launch sync" after every press.
- **Screenshots:** `s1-archive-step1-1440.png`, `s1-archive-step2-1440.png`, `s1-archive-step3-1440.png`, `s1-tab-into-list-1440.png`.
- **Proposed fix:** in `apps/desktop/src/screens/Inbox.tsx` `toggleArchive`, move `selectedId` (and the open thread) to the next row in `filtered`. Handle `next-row`/`prev-row` in the same `useKeymap` callback. Add an "Archived · Undo" status toast (role=status, ~5s) that `⌘Z`/`u` also triggers.

## NC-03: At 390 the approval queue sheet buries the inbox

- **Screen/width:** Inbox, every width below 900. **Severity:** blocker for S1/S2/S8 on a phone-width window.
- **Expected:** the phone opens on the inbox. Pending approvals show as a count or banner, and I open the queue when I choose to (Apple Mail never opens a sheet by itself).
- **Actual:**
  - `paneRendered` is true whenever `approvals.length > 0`. Below 900 the pane is a full-height sheet, so the list is hidden from the first frame.
  - Escape, tapping empty sheet space, the Inbox tile and a swipe-down all leave it in place (checked one by one).
  - "Collapse details" is hidden below 900.
  - The sweep shows the switch happening at exactly 890px: the list vanishes under the sheet.
  - The only way out is to approve or ignore every pending approval.
- **Repro:** set the window to 390×844 with any pending approval and load `/`.
- **Screenshots:** `s0-first-load-390.png`, `s8-390-after-dismiss-attempts.png`, `s8-390-after-swipe.png`, `s9-list-890.png`, `s9-list-600.png`.
- **Proposed fix:**
  - `apps/desktop/src/App.tsx`: below 900, render the pane only when something is open; replace the auto-queue with a "N need approval" row or pill that opens it.
  - Give the sheet a grabber and a close button, and close it on Escape and swipe-down.
  - `app.css`: set `user-select: none` on the sheet chrome.

## NC-04: No way to reply

- **Screen/width:** Thread, AI panel; all widths. **Severity:** blocker for S3.
- **Expected:** open a Slack thread and either type a reply or ask the AI panel to draft one, then see it go to the channel (or into an approval).
- **Actual:**
  - The toolbar's Reply button is `disabled`.
  - "Draft a reply" and "Extract to-dos" in the AI panel are disabled with `title="Phase B"`.
  - The existing draft card's "Edit & send" button does nothing: no editor, no change in the pane.
  - Typing "draft a reply saying I'll review the contract by Thursday" and pressing Enter shows "No results for …", because the ask bar is search only.
  - There's no composer anywhere.
- **Repro:** open `#omnis-launch`, then try each of the four routes above.
- **Screenshots:** `s3-slack-thread-1440.png`, `s3-ask-panel-open-1440.png`, `s3-ask-enter-1440.png`, `s3-edit-and-send-1440.png`, `s9-thread-390.png`.
- **Proposed fix:**
  - Give "Edit & send" an inline editor (`packages/ui/src/components/draft-card.tsx`) whose send path proposes an approval through the existing kernel route.
  - Enable Reply to open the same editor empty (`apps/desktop/src/screens/Thread.tsx`).
  - Until the Phase B actions ship, hide them instead of showing disabled controls labelled "Phase B" (`ask-panel.tsx`).

## NC-05: Tasks quick add loses what you type

- **Screen/width:** Tasks, all widths. **Severity:** blocker (silent data loss).
- **Expected:** type a task, press Enter, and it appears in a list.
- **Actual:** the field clears and nothing is stored (`tasks` has 0 rows). `onSubmitQuickAdd` only calls `setQuickAdd("")`; its comment calls that "honest", but a cleared field reads as "saved".
- **Repro:** `?screen=tasks`, type "Send Dana comments on the PoC deck by Thursday", press Enter.
- **Screenshot:** `s6-tasks-after-add-1440.png`.
- **Proposed fix:** `apps/desktop/src/screens/Tasks.tsx`: add a hub `POST /tasks` route and call it. Until that exists, disable the field with a visible note ("Adding tasks lands in the next build") and keep the typed text.

## NC-06: PWA inbox rows are broken

- **Screen/width:** `apps/web` inbox at 390 (iPhone 13 emulation) and at 1440. **Severity:** blocker.
- **Expected:** the same row grammar as the desktop.
- **Actual:**
  - Every row is squeezed into a ~50px column.
  - Names are cut to a single glyph.
  - The time sits under the avatar.
  - The channel icon and orange dot hang outside the card's left edge.
  - The "…" button renders as an unstyled grey box.
- **Root cause:** `apps/web/src/vendor/app-styles.css` is a copy of the desktop `app.css` taken at `5ddba46`, and design wave 2 rewrote the row grammar since. The header says "re-copy the whole file", but nothing enforces it.
- **Repro:** open `http://127.0.0.1:5274/` at either width.
- **Screenshots:** `s8-pwa-first-390.png`, `s8-pwa-first-1440.png`.
- **Proposed fix:** re-vendor the file. Add a test (e.g. in `apps/web`) that fails when its body differs from `apps/desktop/src/app.css`, or generate the copy at build time.

## NC-07: Notes save fails and Digest undo can't work

- **Screen/width:** Notes (and Digest's actions); all widths in the browser/dev shell. **Severity:** major.
- **Expected:** "Save" stores the note.
- **Actual:**
  - "Couldn't save the note. It is still in the box." The request never reaches the hub (nothing in `hub.log`, 0 rows in `notes`).
  - `apps/desktop/vite.config.ts` proxies `/api /approvals /health /kill-switch /search /settings /cost`, but the app also calls `/notes`, `/digests/:id/undo` and `/items/:id/unarchive` (`api/notes.ts`, `api/digest.ts`).
  - This is exactly the silent failure the config's own comment warns about.
- **Repro:** `?screen=notes`, type something, click Save.
- **Screenshot:** `s6-notes-after-save-1440.png`.
- **Proposed fix:** add `/notes`, `/digests` and `/items` to the proxy table. Add a unit test that greps `HUB_HTTP_URL}/<prefix>` across `apps/desktop/src/api` and asserts each prefix is proxied.

## NC-08: Agent sessions can't be observed

- **Screen/width:** Agent session pane, all widths. **Severity:** major (round focus).
- **Expected (herdr, Linear agent views):** a header with the session name, runtime, host and state pill; a cost/tokens line; a timeline of tool calls I can expand; and, when blocked, the thing I need to decide.
- **Actual:**
  - `claude_code · inbox-draft` shows three plain lines: "Listing src/.", "Reading ✓ index.ts main.ts", "✓ Turn completed".
  - There's no header, state, cost, time, runtime or host.
  - Clicking the tool-call line does nothing.
  - The list says **Blocked**, but the session's own summary reads "✓ Turn completed", and there's no approval or question in the pane. Nothing tells me why it's blocked or how to unblock it.
- **Repro:** Agents tab → `claude_code · inbox-draft`.
- **Screenshots:** `s4-agent-session-1440.png`, `s4-tool-call-click-1440.png`, `s2-tab-agents-1440.png`.
- **Proposed fix:**
  - `apps/desktop/src/screens/AgentSession.tsx`: add a header (runtime avatar, title, `StatusPill` state, host, started/last turn) and a `KeyValueTable` for cost, tokens and turns.
  - Make `tool-call-badge.tsx` expandable to args and result.
  - For `waiting_approval`, pin the blocking approval or question at the top and don't show "Turn completed" as the row summary of a blocked session.

## NC-09: Blank session panes, and no way back to the queue

- **Screen/width:** Agent session / detail pane, all widths. **Severity:** major.
- **Expected:** a session with no turns yet says so ("Working · no output yet · started 5m ago"). Escape, or clicking Inbox, closes it and brings back the queue.
- **Actual:**
  - "Summarizing contract diff" (Working) and "Invoice reissue reply" (Blocked) open a completely empty pane.
  - Once something is open, Escape, the Inbox rail tile and re-clicking the tab never return the pane to the approval queue; only a reload does.
- **Repro:** Agents tab → "Summarizing contract diff", then press Escape.
- **Screenshots:** `s4-working-session-1440.png`, `s4-blocked-invoice-session-1440.png`, `s4-back-to-queue-1440.png`.
- **Proposed fix:**
  - `AgentSession.tsx`: add an empty state.
  - `App.tsx`: make Escape (and the Inbox tile) call `setOpen(null)`. Add a close (×) next to the pane chevron.

## NC-10: Approving gives no outcome

- **Screen/width:** approval card, all widths. **Severity:** major.
- **Expected:** after confirming I see "Approved · sending to #omnis-launch on Slack" with Undo for a few seconds, and later the sent message in the thread.
- **Actual:**
  - Approve opens a confirm dialog in the middle of the screen, far from the card I clicked.
  - After confirming, the card silently becomes the next approval. There's no toast and no undo, and nothing says what was executed or where. The DB shows `decided/accept`; the UI shows nothing.
  - (The confirm is `role="alertdialog"`, which is correct.)
- **Repro:** with nothing open, click Approve on the top card, confirm, and watch the pane.
- **Screenshots:** `s4-approve-click-network-1440.png`, `s4-confirmed-+150-1440.png`, `s4-confirmed-+2500-1440.png`.
- **Proposed fix:** in `App.tsx` `onDecide`, show a status toast with the channel and recipient plus an Undo (while the outbox hasn't claimed it). In `approval-card.tsx`, anchor the confirm to the card (popover) instead of centering it on the window.

## NC-11: Approval cards lack context

- **Screen/width:** approval stack and cards, all widths. **Severity:** major.
- **Expected:** each approval states the action, destination (channel, recipient, thread) and a body preview. I shouldn't approve a "send" I can't read.
- **Actual:**
  - Every card reads "Send needs your approval" followed by the proposal text, e.g. "Share the latest Brightstone purchase agreement?". Nothing says to whom, on which channel, or what the message says.
  - Each queue row repeats a grey "Send" prefix.
  - Within one thread, one card has Respond and the next doesn't (`#omnis-launch`).
  - The `#omnis-launch` thread carries an unrelated "Put the Friday 14:00 design review on the calendar?". That's partly the fixture, but nothing tells me why it's there.
- **Screenshots:** `s0-first-load-1440.png`, `s3-slack-thread-1440.png`.
- **Proposed fix:** `approval-card.tsx`: add a header line "Slack · #omnis-launch → Dana Lee" (a `ChannelGlyph` plus the recipient from `args`) and a quoted `args.body`. `approval-stack.tsx`: show the thread name instead of the verb on collapsed rows. Explain a missing button or keep the button set stable.

## NC-12: Search misses what's on screen

- **Screen/width:** ⌘K search, 1440. **Severity:** major.
- **Actual:**
  - "Brightstone", printed in the `#omnis-launch` row summary, returns "No results": summaries aren't indexed.
  - "launch" returns "omnis launch sync" three times with nothing to tell them apart.
  - Choosing the person "Dana Lee" (Enter or click) does nothing; `openHit` only follows `thread` links.
  - After choosing a result, ⌘K reopens with the old query, so typing "PoC" produced "DanaPoC", which still listed Dana Lee.
- **Repro:** ⌘K → "Brightstone"; ⌘K → "launch"; ⌘K → "Dana" → Enter; ⌘K → type "PoC".
- **Screenshots:** `s5-search-launch-1440.png`, `s5-search-poc-1440.png`, `s5-person-click-1440.png`.
- **Proposed fix:**
  - Hub search: index `threads.meta.summary`.
  - Result rows: add a subtitle (channel · date · participant).
  - `App.tsx` `openHit`: open the person in the pane (`setOpenPersonId`) as the Network screen does.
  - `command-palette.tsx`: clear the query on close/select.

## NC-13: The Commands tab steals focus

- **Screen/width:** ⌘K, 1440. **Severity:** major.
- **Actual:** clicking the Commands tab moves focus from the input to the tab button, so typing filters nothing, and ⌘A then selected the whole page. The only command is "Go to Inbox" (see NC-01).
- **Screenshot:** `s5-search-settings-1440.png` (whole page selected).
- **Proposed fix:** `packages/ui/src/components/command-palette.tsx`/`ask-panel.tsx`: tabs should use `onMouseDown={e => e.preventDefault()}` or return focus to the input. Add real commands (screens, archive, snooze, collapse pane, kill switch).

## NC-14: Disconnected looks like empty

- **Screen/width:** all screens, all widths. **Severity:** major.
- **Expected:** "Can't reach omnis — retrying" (Superhuman/Linear offline banners). A blank list must never pass for "nothing here".
- **Actual:**
  - With Zero unreachable, the inbox shows the header and tabs over an empty body forever, with no spinner or message after 9s. The rail loses every channel tile.
  - With the hub unreachable, search answers "No results for Dana", and Today announces "Quiet day today — nothing on the calendar and nothing waiting on you… 0 approvals pending".
  - Settings does show an error, but the copy is "Check the hub logs", which is developer language.
- **Repro:** Playwright blocked the Zero WebSocket, and separately aborted hub routes (`s12.ts`, `s12b.ts`).
- **Screenshots:** `s12-sync-blocked-9s-1440.png`, `s12-hub-down-inbox-1440.png`, `s12-hub-down-search-1440.png`, `s12-hub-down-settings-1440.png`.
- **Proposed fix:**
  - One connection-state source in the shell (Zero connection status plus the hub health poll) drives a thin banner in `App.tsx`.
  - Screens show skeleton or loading until the first sync.
  - Search surfaces "Search is offline" rather than "No results".
  - Today suppresses "Quiet day" while disconnected.
  - Rewrite the Settings copy to "Couldn't reach omnis. Retry".

## NC-15: Empty filter result is a blank card

- **Screen/width:** Inbox, all widths. **Severity:** major.
- **Actual:**
  - Personal plus the label "contract" gives a completely empty card, with no "No threads match" and no "Clear filters".
  - Adding the label chip also moves the chip *in front of* the tabs, so the All/Work/… row jumps sideways.
- **Screenshot:** `s12-empty-filter-1440.png`.
- **Proposed fix:** `Inbox.tsx`: add an empty state naming the active filters, with a Clear button. Keep `FilterChipBar` in one place: after the tabs, or on its own line.

## NC-16: The hover card covers the pane

- **Screen/width:** Inbox, 1440. **Severity:** major.
- **Actual:** after clicking a row the pointer rests on it, and 400ms later the hover card opens over the detail pane. It covers the pane's archived banner and the approval card's heading ("Send needs your approval" is half hidden).
- **Screenshot:** `s1-archive-step2-1440.png`.
- **Proposed fix:** `packages/ui/src/components/inbox-row.tsx`: suppress the hover card for the selected/open row, and never let it overlap the pane (place it inside the list's bounds).

## NC-17: The rail is a row of unlabeled icons

- **Screen/width:** rail, all widths. **Severity:** major.
- **Actual:**
  - No tooltip on hover (0 `role=tooltip`).
  - "System" uses a black gear that looks like the Settings gear at the bottom.
  - The "Agent" tile shows 1 row while the "Agents" tab shows 7.
  - The avatar and gear at the bottom are dead ("Not wired up yet — Phase B" appears only as a hover title).
  - At 390 the bottom bar cuts Gmail behind a chevron.
- **Screenshots:** `s2-rail-hover-1440.png`, `s0-first-load-390.png`.
- **Proposed fix:** `channel-rail.tsx`: a tooltip carrying the label and shortcut. Give System a distinct glyph, or drop it from the rail. Make "Agent" the same filter as the Agents tab, or rename it. Wire or hide the dead buttons.

## NC-18: Keyboard-only navigation

- **Screen/width:** 1440. **Severity:** major.
- **Actual:**
  - Tab order is 6 rail tiles → ask input → 5 ask-panel buttons → 5 tabs → Archived → + → the list wrapper (no visible focus) → then row, "More actions", "Archive" for **every** row.
  - Reaching the detail pane from an open row took **27** Tabs.
  - Arrow keys move neither between rows nor between the radio tabs (ArrowRight on "All" left "All" checked).
  - `?` shows no shortcut sheet.
  - Escape doesn't close an open thread.
- **Screenshots:** `s10-tab-45-1440.png`, `s10-question-mark-1440.png`.
- **Proposed fix:**
  - List: roving tabindex (one tab stop; ↑/↓ and j/k move; row actions via `.` or the context menu).
  - Tabs: radiogroup arrow keys.
  - Add a `?` sheet listing `use-keymap.ts`; Escape closes the pane.
  - Take the listbox wrapper out of the tab order.
  - Files: `inbox-row.tsx`, `Inbox.tsx`, `use-keymap.ts`, `App.tsx`.

## NC-19: Network can merge me with a contact

- **Screen/width:** Network, all widths. **Severity:** major.
- **Actual:**
  - A lone "This is the same person" button sits at the bottom-left corner, far from any card, with no explanation. Right now it would merge **Logan Kim** (me, the account owner) with Dana Lee.
  - The owner is listed as a contact.
  - Each person shows "Channels … Gmail" as a key/value pair stretched across half the width.
  - Dana Lee's card says "Messages 0" above two listed conversations.
- **Screenshots:** `s6-network-1440.png`, `s6-network-person-1440.png`.
- **Proposed fix:** `apps/desktop/src/screens/Network.tsx`: put the merge suggestion inline between the two candidates ("Same person? Logan Kim · Dana Lee — Merge / Not the same"), exclude the owner, and fix the count query.

## NC-20: Today is read-only

- **Screen/width:** Today, all widths. **Severity:** major.
- **Actual:**
  - The pending approvals render as pill chips, and clicking one does nothing: no pane, no card.
  - "Nightly digest ready · 0 archived" looks like a card but isn't clickable.
  - The headline "7 items to handle today" counts approvals only.
  - The rail's black Inbox tile stays selected on every non-Inbox screen.
  - The page is two-thirds empty at 1440.
- **Screenshots:** `s6-today-1440.png`, `s6-today-click-approval-1440.png`, `s6-today-390.png`.
- **Proposed fix:** `Today.tsx`: render approvals as the same `ApprovalCard` or open them in the pane, and link the digest card to Digest. `ChannelRail` should reflect the current screen.

## NC-21: The desktop app ignores phone viewports

- **Screen/width:** desktop app in a phone browser. **Severity:** major (for S8 via the desktop build).
- **Actual:** `apps/desktop/index.html` has no viewport meta, so with real mobile emulation the page lays out at ~980px and is scaled down to unreadable text. The whole <900 tier (bottom bar, sheet) only appears in a narrow desktop window. (The shots scripts never set `isMobile`, which is why they don't catch it.)
- **Screenshot:** reproduced during the run with `isMobile: true`; the layout matched `s9-list-1280.png` scaled to 390.
- **Proposed fix:** add `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` as `apps/web` has, and add an `isMobile` pass to `shots-responsive.ts`.

## NC-22: Approval counts disagree

- **Severity:** minor.
- **Actual:**
  - The tab says "Needs approval 7" while the pane shows 1 + "7 more waiting" = 8: the tab counts threads, the pane counts approvals.
  - After archiving a thread the tab drops to 6, but the pane still lists that thread's approval.
  - Today says "7 approvals pending".
- **Screenshots:** `s0-first-load-1440.png`, `s1-archive-step2-1440.png`.
- **Proposed fix:** count approvals everywhere, or label the tab "7 threads". Decide whether archiving hides a thread's approvals, and apply the same rule in both places (`Inbox.tsx` needs-approval count, `App.tsx` approvals).

## NC-23: Unexplained orange dots

- **Severity:** minor.
- **Actual:** almost every non-agent row ends with a small orange dot beside the channel glyph. There's no legend or tooltip. It reads as "unread" but isn't (the unread dot is the blue one on the left).
- **Screenshot:** `s0-first-load-1440.png`.
- **Proposed fix:** `inbox-row.tsx`: show the approval dot only when the row is not in the Needs-approval view, give it a tooltip ("Waiting for your approval"), or move it into the status slot as a `StatusPill`.

## NC-24: Noisy rows

- **Severity:** minor.
- **Actual:**
  - The `#omnis-launch` summary starts with "Draft:", which reads like the whole thread is a draft.
  - A system row "omnis — LLM cost is back within the normal range (month $0.00, reserve $0.00)" sits in the inbox.
  - Two "omnis launch sync" rows (recurring event) with the same avatar are hard to tell apart.
- **Screenshot:** `s0-first-load-1440.png`.
- **Proposed fix:** drop the "Draft:" prefix in the summary builder and show a "Draft ready" chip instead. Route system notices to Digest/Settings unless actionable. Add the occurrence date to recurring-event rows.

## NC-25: Agent rows look alike

- **Severity:** minor.
- **Actual:** every session except `claude_code` shows a black squircle with "O". The seeded sessions are attached to a Slack account, so Slack's rail filter shows agent sessions (partly a fixture artifact, but the UI doesn't guard against it).
- **Screenshots:** `s2-tab-agents-1440.png`, `s2-rail-slack-1440.png`.
- **Proposed fix:** use the runtime logo from `agent_runtimes` for every session, and exclude `kind='agent_session'` from channel filters.

## NC-26: Detail pane header

- **Severity:** minor.
- **Actual:**
  - ~130px at the top of the pane holds only the chevron and a floating 3-icon bar.
  - Then a small "#omnis-launch / To: me" header, then the same "#omnis-launch" again as a large H1.
  - "To: me" is wrong for a public Slack channel.
  - The pending draft appears twice: as a "Draft" bubble in the conversation and as the draft card at the bottom.
- **Screenshot:** `s3-slack-thread-1440.png`.
- **Proposed fix:** `Thread.tsx`/`thread-toolbar.tsx`: put the chevron and actions on the header line, show one title, use "in #omnis-launch" for channels, and render the draft once.

## NC-27: Approval buttons wrap and clip

- **Severity:** polish.
- **Actual:** "Edit & approve" breaks onto two lines in the 420px pane and at 390. At 390 the "Ignore" button is clipped at the card's right edge.
- **Screenshots:** `s0-first-load-1440.png`, `s0-first-load-390.png`.
- **Proposed fix:** `approval-card.tsx`: `white-space: nowrap` on the buttons and a flex-wrap row, or collapse Respond/Ignore into a "More" menu at narrow widths.

## NC-28: Square focus ring on the selected row

- **Severity:** polish.
- **Actual:** the focused, selected row gets a hard 2px blue rectangle that runs to the card's outer edge with square corners, while the row's own card has 8px radius.
- **Screenshot:** `s1-archive-step2-1440.png`.
- **Proposed fix:** `app.css` `.inbox-row:focus-visible`: set `outline-offset: -2px` and match `border-radius: 8px`.

## NC-29: Expand chevron inside the ask bar

- **Severity:** polish.
- **Actual:** with the pane collapsed, the floating "<" expand toggle sits at the right end of the ask bar, where it reads as an ask-bar control.
- **Screenshot:** `s11-collapsed-1440.png`.
- **Proposed fix:** `app.css` `.detail-pane__toggle--floating`: anchor it to the list card's top-right corner, outside the ask bar, or give the ask bar right padding for it.

## NC-30: Pane drag and collapse side effects

- **Severity:** minor.
- **Actual:**
  - At the 720px maximum the tab row clips the Archived icon in half and hides "+", with no scroll fade.
  - After collapse→expand, the pane shows the queue while row 1 is still drawn as selected.
- **Screenshot:** `s11-drag-max-1440.png`.
- **Proposed fix:** `app.css`: give the pills row an edge fade when it scrolls. `App.tsx`: keep `open` across collapse, or clear the row selection when the pane drops it.

## NC-31: Rows change height during resize

- **Severity:** polish.
- **Actual:** in the 10px resize sweep, row 1 goes from 73 to 94px at 660 and back to 73 at 510 (chips wrap, then move into the side slot).
- **Screenshots:** `s9-list-600.png`, `s9-list-480.png`.
- **Proposed fix:** `app.css` inbox-row container queries: make the chip-drop breakpoint match the one where the chips move, so each width has one row height.

## NC-32: Dragging the sheet selects text

- **Severity:** polish.
- **Actual:** a drag on the 390 sheet highlights all of its text in blue instead of moving the sheet.
- **Screenshot:** `s8-390-after-swipe.png`.
- **Proposed fix:** `user-select: none` on the sheet chrome and approval-row labels, plus a real drag-to-dismiss (NC-03).

## NC-33: Destructive action in the Filters sheet

- **Severity:** minor.
- **Actual:** the 390 Filters sheet ends with "Actions: Archive all 15 shown" under Show/View/Labels. A newcomer tidying filters can reach it by scrolling. (I didn't press it, so whether it asks for confirmation is untested.)
- **Screenshot:** `s8-390-hamburger.png` (the section is below the fold).
- **Proposed fix:** move bulk actions out of the Filters sheet (toolbar overflow), and confirm with a count.

## NC-34: Settings copy

- **Severity:** minor.
- **Actual:**
  - Model tiers reads "$0 used" with a "90%" label over the bar's hatched end, so it reads as 90% used.
  - "Monthly cost cap 60" has no currency.
  - "T1: local / T2: escalation" is internal vocabulary.
  - The segmented "Model tiers" wraps onto two lines at 390.
  - Accounts lists "Agent" and "System" as connected accounts next to Gmail and Slack.
- **Screenshots:** `s6-settings-model-tiers-1440.png`, `s6-settings-390.png`.
- **Proposed fix:** `Settings.tsx`: label the marker "Alert at 90%", add a "$" prefix, rename the tiers ("On-device", "Cloud drafts"), `white-space: nowrap` in the segments, and list the system accounts separately.

## NC-35: The digest is out of date

- **Severity:** minor.
- **Actual:** Digest's title is "August 31 night digest, nothing archived" on 2026-09-21, while Today says "Nightly digest ready".
- **Screenshot:** `s6-digest-1440.png`.
- **Proposed fix:** `Digest.tsx`: say "No digest since Aug 31" when the latest one is stale, and make Today's line match.

## NC-36: The PWA shell is mostly empty

- **Screen/width:** `apps/web`, 390 and 1440. **Severity:** major.
- **Actual:**
  - The "Keep omnis on your Home Screen — tap the Share button in Safari's toolbar" card shows in desktop Chrome at 1440.
  - Today, Tasks, Network and Notes show only that card and an empty page.
  - Tapping an inbox row does nothing.
  - The row layout is broken (NC-06).
- **Screenshots:** `s8-pwa-first-1440.png`, `s8-pwa-tab-1-390.png`, `s8-pwa-row-open-390.png`.
- **Proposed fix:** `apps/web/src/components/InstallGuideCard.tsx`: show only on iOS Safari when not standalone. Hide unbuilt tabs from `BottomTabBar.tsx`, or give them "Coming soon" bodies. Open rows in a sheet.

## NC-37: Thread sheet at 390 has no way back

- **Screen/width:** Thread, 390. **Severity:** major.
- **Actual:** an open thread fills the screen. The floating bar offers four unlabeled icons (archive, move, reply, more) but no back or close, and the Inbox tile doesn't close it. A sliver of another surface peeks out at the right edge around y≈500–590.
- **Screenshot:** `s9-thread-390.png`.
- **Proposed fix:** `Thread.tsx` narrow tier: a "‹ Inbox" back button in the header plus swipe-back. Add `aria-label`s and tooltips to the action bar. Find and clip the element leaking at the right edge (probably the resize handle, which should be `display:none` below 900).

## NC-38: The "+" button and label picker

- **Severity:** minor.
- **Actual:** the "+" after the tabs means "Add Label filter", but next to an inbox it reads as "new message". The picker lists "work" and "personal", which duplicate the Work/Personal tabs.
- **Screenshot:** `s2-label-popover-1440.png`.
- **Proposed fix:** use a tag icon with the visible text "Label", and exclude `kind='scope'` labels from the picker (`Inbox.tsx` options).

## NC-39: Korean comments in source

- **Severity:** minor (process: the repo rule is English only).
- **Actual:** non-English comments remain in
  - `apps/desktop/src/zero-client.ts` (12 lines)
  - `screens/AgentSession.tsx` (11)
  - `api/threads.ts` (2)
  - `api/approvals.ts` (1)
  - `api/keychain.ts` (1)
  - `hooks/use-keymap.ts` (2)
  - `packages/ui/src/lib/relative-time.ts` (5)
  - `packages/ui/src/types.ts` (1)
  - `packages/ui/src/i18n/{index,types,en}.ts` (22). `ko.ts` is an allowed locale; the others aren't.
- **Proposed fix:** translate them the next time each file is touched, or in one sweep.

## NC-40: The ask bar promises an assistant

- **Severity:** minor.
- **Actual:** the ask bar has an "Auto" model selector, an @-mention button and an attachment button, and its placeholder says "ask". Asking a question only runs search and returns "No results for …". Suggestions are disabled with "Phase B".
- **Screenshots:** `s3-ask-enter-1440.png`, `s5-palette-empty-1440.png`.
- **Proposed fix:** until asking works, change the placeholder to "Search" and hide the model, @ and attachment controls (`ask-panel.tsx`, `App.tsx` ask bar).

---

## Scenario coverage

| Scenario | 1440 | 390 | Result |
|---|---|---|---|
| S1 morning triage | done | blocked by NC-03 | summaries readable; archive ×3 impossible (NC-02); undo only via Restore/`u` |
| S2 rail, tabs, labels, drag | done | blocked by NC-03 | works; NC-17, NC-38 |
| S3 Slack thread, AI draft | done | thread seen via resize (`s9-thread-390`) | dead end (NC-04) |
| S4 agent session, approve/reject | done | — | observability missing (NC-08/09); approval works but gives no outcome (NC-10) |
| S5 ⌘K | done | — | NC-12, NC-13, NC-01 |
| S6 six screens | done (via URL only) | layout checked, no overflow | Settings ✓; Tasks ✗ (NC-05); Notes ✗ (NC-07); Today and Network inert (NC-19/20); Digest has no action |
| S7 archived view | done | — | works: Archived pill → Restore |
| S8 iPhone | desktop narrow tier + PWA | done | NC-03, NC-06, NC-21, NC-36, NC-37 |
| S9 resize 1440→390 | sweep in 10px steps, with and without an open thread | — | 0px page overflow at every step; tier switch at 890 buries the list; NC-31 |
| S10 keyboard only | done | — | NC-18, NC-02 |
| S11 pane collapse and drag | done | n/a below 900 | works; NC-29, NC-30 |
| S12 empty, loading, error | done | — | NC-14, NC-15 |

## Test tooling added in this round

- `tools/e2e/hold.ts` boots the seeded, densified stack and keeps it running for manual or Playwright use.
- `tools/e2e/stack.ts` can now run a second stack beside the default one:
  - `OMNIS_E2E_DB` sets the database.
  - `OMNIS_E2E_PORT_OFFSET` shifts the ports.
  - Each DB gets its own zero replica file and log directory. The shared replica path let one stack delete another's live replica.
  - Zero's replication slot names are cluster-wide, so a second stack also needs `ZERO_SHARD_NUM`.
- `apps/{desktop,web}/vite.config.ts` read `OMNIS_HUB_PORT` for the proxy target; the desktop config also reads `OMNIS_DESKTOP_PORT`.
- `tools/e2e/shots.ts` exports `densify()`.
