# Loop r2: user test "Logan"

**Persona:** Logan, founder of a small AI studio. Handles about 80 Slack, Gmail, and KakaoTalk threads a day and runs three coding agents. Impatient and keyboard-first.
**Build:** `plan/loop-r2` @ `cca0c7b` (main after the loop-r1 merge; no r2 story has landed yet, so this is the r2 baseline).
**Stack:** `tools/e2e/hold.ts --web` (seed + `varyInboxCopy` + the `shots.ts` densify fixture) on DB `omnis_test_loop_r2_e2e`, `OMNIS_E2E_PORT_OFFSET=400`: desktop :5573, PWA :5574, hub :9187.
**Widths:** 1440×900 and 390×844 (390 with an iPhone 13 profile for S8). S9 swept 1440→390 in 10px steps.
**Screenshots:** `docs/design/loop/r2/test-logan/` (paths below are relative to that folder).
**Date:** 2026-09-22

## Verdict

Round 1 fixed the morning triage: `j`/`k`/`e` work, the list advances, and there is an Undo toast. None of this round's focus items is usable yet:

- **Replying is still impossible.** Reply is disabled ("Not wired up yet — Phase B"), "Edit & send" is a no-op, and asking the AI panel to draft a reply returns "No results".
- **The approval card's "Edit" button sends the approval without an editor.** It records `decision=edit` with the original args and skips the confirm that Approve requires.
- **Agent observability stops at the header.** A blocked session says "nothing to decide here yet" while its own row says it is waiting for approval, and approving the matching request does not unblock it.
- **Keyboard focus is lost on every screen switch** (it lands on `<body>`). At 390, ⌘K focuses a tab button instead of the input, so the letters of a search run as shortcuts. Typing "Brightstone" archived a thread.
- **Approval counts disagree** (8 / 7 / 6 on one screen).
- **No connection state or skeletons.** A slow or unreachable hub gives a blank white page, and going offline shows no banner while the header keeps saying "Updated now".
- **The system→omnis rename is half done.** The label and rail mark changed, but the omnis thread still has an "OM" initials avatar.

What works and should be kept:

- keyboard triage (`j`/`k`/`e`/`z`) with advance and the Archived/Undo toast
- the offline archive failure toast with Retry
- the Archived view with `u`
- rail drag-reorder, which persists
- detail-pane resize: drag, double-click reset and arrow keys
- the Approve confirm plus outcome toast, and Ignore with Undo
- ⌘K at 1440: people open, `>` commands filter
- Notes save and the kill-switch confirm
- no horizontal overflow at any width from 1440 to 390

Tally: **5 blocker · 19 major · 11 minor · 4 polish** (39 findings). Findings carried over from r1 are marked "(r1 L-xx)".

**Test hygiene note:** the stack is shared state. My own S1 run archived the seeded agent threads and one run decided an approval. I restored every thread through the Archived view (DB check: 0 archived at the end). Two approvals stay decided: the Brightstone one (by the L2-02 bug) and the invoice one (by S4 on purpose).

## Findings table

| ID | Screen | Width | Severity | Finding |
|----|--------|-------|----------|---------|
| L2-01 | Thread / AI panel | all | blocker | Still no way to reply: Reply disabled, "Edit & send" no-op, ask bar treats "draft a reply…" as a search (r1 L-05) |
| L2-02 | Approval card | all | blocker | "Edit" decides the approval at once (`decision=edit`, original args), with no editor and no confirm |
| L2-03 | ⌘K / ask bar | 390 | blocker | ⌘K and tapping the ask bar focus the "Suggestions" tab and show no input; typed letters run as list shortcuts (`e` archived a thread) |
| L2-04 | Tasks | all | blocker | The task checkbox does nothing: `onToggleDone` is never passed to `<Tasks>`, the box stays unchecked, and no request is sent |
| L2-05 | Shell | all | blocker | Slow or unreachable hub gives a blank white page; offline shows no banner and "Updated now" keeps claiming freshness (r1 L-09) |
| L2-06 | Agent session | all | major | A blocked session does not show what it waits on; it contradicts its row and stays blocked after the approval is granted; no cost, model or controls |
| L2-07 | Counts | all | major | Approval counts disagree: subline 8, pill 7, queue 1+7; archiving moves the pill but not the subline; Today says 6 (r1 L-29) |
| L2-08 | Approval card / Thread | all | major | Cards show a one-line question with no draft, recipient or channel; cards appear in unrelated threads; the draft is shown three times (r1 L-11, L-23) |
| L2-09 | Keyboard / shell | 1440 | major | Every screen switch drops focus to `<body>` (no heading focus); returning to Inbox resets the selection to row 1 |
| L2-10 | Inbox undo | all | major | Undo is a one-level toggle: the second ⌘Z re-archives; the toast says "Archived" without naming the thread |
| L2-11 | Inbox | all | major | Opening a thread does not mark it read: "1 unread" and the blue dot survive repeated opens |
| L2-12 | ⌘K | 1440 | major | "Brightstone" finds nothing, though it is in a summary, a draft and an approval; the palette opens empty; commands are navigation only |
| L2-13 | Ask bar | 1440 | major | Tabbing into the ask bar opens the panel, adds 6 tab stops, and the panel stays open after focus leaves, blocking clicks on the pills (r1 L-18) |
| L2-14 | Detail pane | 1440 | major | With the pane collapsed, Enter on a row does nothing (click opens a sheet); the collapsed state is saved on the hub, so a fresh load has no pane and no hint |
| L2-15 | Today | all | major | The approval chips on Today are dead buttons; "6 items to handle" never says what they are; no agent status |
| L2-16 | Tasks | all | major | Quick-add while on the Today tab files the task under Someday, out of sight; the toast says only "Added to Tasks" |
| L2-17 | Notes / Inbox | all | major | Saving a note creates an inbox row "Automatic processing failed (note_route)"; Notes says "pick one manually" and offers no picker |
| L2-18 | Settings | all | major | Every account reads "Connected" (Agent and omnis too) with no real adapters connected and no last-sync time (r1 L-20) |
| L2-19 | Inbox | all | major | The list is not chronological and reshuffles after actions: 2023 rows sit above rows from minutes ago; a thread drops to the bottom once its approval clears |
| L2-20 | Digest / Today | all | major | "August 31 night digest" shown on 22 September as tonight's digest (r1 L-24) |
| L2-21 | PWA | 390 | major | Row tap does nothing; install card pushes the inbox down; no approvals, agents or ask bar; "More actions" overlaps the status pill (r1 L-21) |
| L2-22 | Inbox tabs | 1440 | major | The pills are `role=radio` but arrow keys do not move between them (r1 L-19) |
| L2-23 | Keyboard | 1440 | major | `a` does not approve on an open thread, `?` opens the ask panel instead of a shortcut list, `l` is unbound, and there is no way to label a thread (r1 L-22) |
| L2-24 | Approvals queue | 1440 | major | The row an approval belongs to is not reachable from the card, and the queue item names no thread or person |
| L2-25 | Rail / tabs | 1440 | minor | The Slack filter and the Work tab list 7 omnis housekeeping agents; the rail "Agent" tile shows 1 session and the Agents tab 7 (r1 L-30) |
| L2-26 | Rail | 1440 | minor | Keyboard reorder is Ctrl+↑/↓, which macOS takes for Mission Control and App Exposé; nothing in the UI mentions it |
| L2-27 | Row hover card | 1440 | minor | Clicking a row pops its hover card over the thread that just opened (r1 L-27) |
| L2-28 | Archived view | 1440, 390 | minor | Empty Archived view is a blank card; rows you restore briefly reappear; focus drops to `<body>` after the last restore |
| L2-29 | Inbox filters | 1440 | minor | An empty filter result is a blank list with no "clear filters"; the label chip goes in front of "All" and shifts the pill row (r1 L-32) |
| L2-30 | Thread header | all | minor | ~90px empty band above the toolbar; title printed three times; "To: me" on a Slack channel and a calendar event (r1 L-36) |
| L2-31 | Floating pane | 900–1279 | minor | The floating pane covers the pill strip and cuts row text mid-word instead of truncating it |
| L2-32 | omnis mark | all | minor | The omnis thread has an "OM" initials avatar, not the mark; all omnis agents share an identical black "O" square (r1 L-31) |
| L2-33 | Shell chrome | 390 | minor | Compose is permanently disabled; Slack is buried under "More"; the sheet spends ~220px on chrome; bottom-bar icons show through the sheet (r1 L-37) |
| L2-34 | Network | 1440 | minor | Logan is listed as his own contact; "Messages 0" next to 2 conversations; "This is the same person" answers "isn't wired up yet" (r1 L-34) |
| L2-35 | Console | 1440 | minor | react-virtuoso logs "Zero-sized element, this should not happen" on every archive |
| L2-36 | Settings → Model tiers | 1440 | polish | "90%" over an empty bar reads as usage; "VIP reserve $6 (10% of the cap)" when no cap is shown (r1 L-40) |
| L2-37 | Approval card | all | polish | Four equal-weight buttons, Approve is not primary, "Respond" is unexplained, and there is a tall empty band at the top of the card |
| L2-38 | Today | all | polish | "Good morning, Logan" at 00:45 |
| L2-39 | Agent session | 1440 | polish | The divider under the key-value table is indented ~45px and does not line up with the table |

---

## Blockers

### L2-01: Still no way to reply (r1 L-05)
- **Screen / width:** Thread and AI panel, all widths
- **Expected:** Open the Slack thread, press Reply or `r` (or ask the AI panel to draft), edit inline, see "Reply in #omnis-launch (Slack)", send, and get it back as an approval card.
- **Actual:**
  - The toolbar Reply button is `disabled` with the tooltip "Not wired up yet — Phase B". That is roadmap jargon shown to the user.
  - "Edit & send" on the draft card does nothing; its handler is an empty function (`Thread.tsx:409`, comment "Composer wiring is out of this story's scope").
  - Typing "draft a reply to Dana saying I'll send comments Wednesday" into the ask bar and pressing Enter shows "No results for draft a reply…". The "Draft a reply" suggestion from r1 is gone, and the only thread suggestion left is "Summarize this thread".
  - No destination is shown anywhere, only "To: me".
- **Repro:** Click `#omnis-launch`, then try Reply, "Edit & send", and the ask bar.
- **Screenshot:** `s3-slack-thread-1440.png`, `s3-edit-and-send-1440.png`, `s3-ask-draft-1440.png`
- **Fix:** Wire the composer in `apps/desktop/src/screens/Thread.tsx` (DraftCard `onEditAndSend` → an inline editor pre-filled with the draft, with a "Reply in <channel> · <recipient>" line). Enable `packages/ui/src/components/thread-toolbar.tsx` Reply, and focus the editor on `r`. Add a "Draft a reply" action in `packages/ui/src/components/ask-panel.tsx` that calls the hub's propose-send route. Sending creates the approval, and the draft card *is* that approval (see L2-08).

### L2-02: "Edit" on an approval card sends it as-is
- **Screen / width:** Approval card, in the pane queue and inside threads, all widths
- **Expected:** "Edit" opens the payload in an editor. Only saving the edit decides, and the decision confirms just like Approve.
- **Actual:** One click POSTs `/approvals/:id/decide` immediately. The DB row becomes `state=decided, decision=edit, decided_args = args` (the untouched original). No editor, no confirm, no toast that says what happened. So Edit is a confirm-free Approve. The code is `packages/ui/src/components/approval-card.tsx`: `onClick={() => onDecide("edit", interrupt.args)}`. "Respond" likewise decides with nothing typed.
- **Repro:** At 1440 with the approval queue in the pane, click "Edit" on the top card ("Share the latest Brightstone purchase agreement?"). The card disappears. `select decision, decided_args from pending_approvals where id=…` shows `edit` with the original body.
- **Screenshot:** `s3-card-edit-1440.png`
- **Fix:** In `approval-card.tsx`, "Edit" switches the card into an edit state (a textarea over `args.body`, with Save/Cancel). Save calls `onDecide("edit", {...args, body})` through the same `ConfirmPrompt` Approve uses. "Respond" needs a text field before it can decide. Add a unit test proving a single click on Edit does not call `onDecide`.

### L2-03: At 390, ⌘K and the ask bar type into the list
- **Screen / width:** Ask bar / ⌘K, 390 (desktop build, narrow shell)
- **Expected:** ⌘K or tapping the ask bar focuses a text input, so the phone keyboard comes up and typed letters go into the query.
- **Actual:**
  - ⌘K opens the bottom sheet with focus on the "Suggestions" tab button, and the sheet has no text input at all. Tapping the ask bar gives the same sheet.
  - Typed characters go to the Inbox keymap. Typing "Dana" found nothing. Typing "Brightstone" archived the selected thread through its `e` (`POST /api/threads/a1c2…/archive -> 200`).
  - Silent data loss from a search box.
- **Repro:** At 390 press ⌘K, type `Brightstone`. The toast says "Archived" and a row is gone.
- **Screenshot:** `s8-desktop-ask-390.png`
- **Fix:** The narrow ask sheet in `packages/ui/src/components/ask-panel.tsx` and the narrow tier of `apps/desktop/src/App.tsx` must render the input inside the sheet and focus it on open. `use-keymap` must ignore keys while any dialog or sheet is open (check `document.activeElement` is inside `[role=dialog]`, or add a shell-level "overlay open" flag).

### L2-04: A task cannot be completed
- **Screen / width:** Tasks, all widths
- **Expected:** Ticking a task marks it done, strikes it or moves it away, and offers Undo.
- **Actual:** The checkbox flips back instantly. No request is sent and the DB keeps `state=open`. `apps/desktop/src/App.tsx:864` renders `<Tasks onOpenSource onOpenDelegation />` without `onToggleDone`, so `Tasks.tsx:352` calls `onToggleDone?.()` on `undefined`.
- **Repro:** Tasks → Someday → tick "Send Dana deck comments". It stays unticked.
- **Screenshot:** `s6-tasks-checked-1440.png`
- **Fix:** Pass `onToggleDone` from `App.tsx`, writing `tasks.state = done` through Zero or the hub, with an Undo toast like archive. Add a test that renders App's Tasks and asserts the mutation.

### L2-05: No connection state, no skeletons (r1 L-09)
- **Screen / width:** Shell, all widths
- **Expected:** A skeleton list while sync connects. A banner ("Can't reach omnis on mini · retrying", or "Offline · changes will send when you're back") when the hub or Zero is unreachable. "Updated 3m ago" instead of "now" when the data is stale.
- **Actual:**
  - Delaying the hub and Zero by 5s shows a completely blank page for the whole wait, at both widths (0 skeleton nodes).
  - With the hub and the Zero socket refused, the page is still pure white after 8s.
  - Taking the browser offline mid-session gives no banner, and the header keeps saying "Updated now".
  - Only the archive failure toast ("Couldn't archive. It's back in your inbox. Retry") tells the truth, which is good.
- **Repro:** Playwright `route` delay/abort on `:5248|/api/`, or `context.setOffline(true)` after load (script in `tools/e2e/.tmp/s12.ts`, gitignored).
- **Screenshot:** `s12-loading-1440.png`, `s12-loading-390.png`, `s12-hub-down-1440.png`, `s12-offline-1440.png`, `s12-offline-archive-1440.png`
- **Fix:** Build a connection-state hook in `apps/desktop/src/App.tsx` from the Zero client's connection state, a `/health` poll and `navigator.onLine`. Render a `GlassSurface` banner under the ask bar. Draw skeleton `.inbox-row`s in `apps/desktop/src/screens/Inbox.tsx` until the first query result arrives. Base "Updated …" on the last successful sync, not on render time.

## Major

### L2-06: A blocked agent session does not say what it waits on
- **Screen / width:** Agent session (pane or sheet), all widths
- **Expected:** "Blocked · waiting for your approval: *Answer the invoice reissue request…*", with Approve/Edit/Reject inline, plus model, cost so far and a Stop control. Once approved, the session moves to Working.
- **Actual:**
  - "Invoice reissue reply": the row says "Waiting for approval of the reply wording", while the pane says "Blocked · nothing to decide here yet".
  - The matching approval sits in the global queue with no link to the session. In the DB both blocked sessions are `waiting_approval`, and no `pending_approvals` row points at their threads.
  - After I approved "Answer the invoice reissue request…" the session stayed Blocked (checked 15 minutes later at 390).
  - "claude_code · inbox-draft" is Blocked while its last line reads "✓ Turn completed".
  - The session pane has no buttons except Inbox and Collapse: no Stop, no reply-to-agent, no cost/tokens, no model.
- **Repro:** Agents tab → "Invoice reissue reply".
- **Screenshot:** `s4-session-invoice-reissue-reply-1440.png`, `s4-session-claude_code-inbox-draft-1440.png`, `s4-agents-tab-1440.png`
- **Fix:** Link the approval to the session (`pending_approvals.requested_by` or `thread_id` = the session thread) in `packages/kernel` and in the seed. Render the linked approval card inside `apps/desktop/src/screens/AgentSession.tsx` in place of "nothing to decide here yet". Derive the blocked reason from the last tool call when no approval exists. Move the session state on decision. Show the "last line" as the blocking reason, not "Turn completed".

### L2-07: Approval counts disagree (r1 L-29)
- **Screen / width:** Inbox header, pill, pane queue, Today; all widths
- **Expected:** One number, from one selector, everywhere.
- **Actual:**
  - First load: subline "8 need approval", pill "Needs approval 7", queue "1 + 7 more waiting".
  - After three archives: subline 8, pill 6, queue still 8.
  - Later: subline 6, pill 5, Today "6 approvals pending" and "6 items to handle today".
  - The pill counts *threads* with an approval and shrinks when you archive a thread. The subline counts approvals. Nothing labels the difference.
- **Repro:** Load, then compare the three numbers; press `e` three times and compare again.
- **Screenshot:** `s0-first-load-1440.png`, `s1-archive1-1440.png`, `s6-today-1440.png`
- **Fix:** A single `usePendingApprovalCount()` (Zero query on `pending_approvals.state='pending'`) in `apps/desktop/src/lib/` used by `Inbox.tsx` (subline and pill), the queue in `App.tsx`, and `Today.tsx`. The pill filter can still list threads, but its badge shows the same number.

### L2-08: Approval cards hide what they approve (r1 L-11, L-23)
- **Screen / width:** Approval card, Approve confirm, Thread; all widths
- **Expected:** The card for a send *is* the draft: the text, "to #omnis-launch (Slack)", and who asked (agent or rule). The confirm repeats the recipient.
- **Actual:**
  - Cards read "Send needs your approval / Reply on omnis launch sync?" with no body, recipient or channel. The confirm dialog repeats only that sentence.
  - "Reply on omnis launch sync?" is proposed on a *calendar event*.
  - Cards sit in unrelated threads: the NDA and recruiting approvals are in the "omnis launch sync" calendar thread, the invoice approval was in Dana's "PoC slides" thread, and the offsite one is in "PoC review". Partly the densify seed, but the UI never shows which thread a card is for, so it cannot look wrong.
  - In `#omnis-launch` the same "Yes, I will review it today." appears three times: as a "Draft" item, as the approval "Reply to #omnis-launch?", and as the DraftCard with "Edit & send".
- **Repro:** Open `#omnis-launch`; open "omnis launch sync"; approve anything from the queue.
- **Screenshot:** `s3-slack-thread-1440.png`, `s1-open-thread-1440.png`, `s4-approve-confirm-1440.png`
- **Fix:**
  - `packages/ui/src/components/approval-card.tsx`: render `args.body` and `args.channel`/recipient. Pass them to `CONFIRM_COPY.approve`.
  - `Thread.tsx`: fold a draft item, its approval and the DraftCard into one card.
  - `tools/e2e/shots.ts` densify: attach approvals to matching threads.

### L2-09: Focus is lost on every screen switch
- **Screen / width:** Shell, 1440
- **Expected:** After `g t`, a rail click or a ⌘K "Go to …", focus lands on the new screen's `h1` (and screen readers announce it). Coming back to Inbox puts focus on the row you left.
- **Actual:**
  - `document.activeElement` is `<body>` after every `g`-sequence and rail switch, and stays in the ask input after a ⌘K command.
  - Inbox, Tasks, Notes and Settings have no `h1` (the page has 0 `h1` elements; "Inbox" is not a heading).
  - `g t` then `g i` then `j` selects row 1, not the row you left.
- **Repro:** Select row 2, press `g t`, `g i`, `j`.
- **Screenshot:** `s10-tab-focus-1440.png`, `s5-command-ran-1440.png`
- **Fix:** In `apps/desktop/src/App.tsx`, give each screen's title element `tabIndex={-1}` as an `h1` and focus it in an effect keyed on `screen`. Keep the Inbox `selectedId` in App state (or sessionStorage) so it survives the unmount.

### L2-10: Undo is a toggle, and the toast does not say what it undoes
- **Screen / width:** Inbox, all widths
- **Expected:** An undo stack. ⌘Z twice restores the last two archives. The toast says "Archived *PoC review*".
- **Actual:** `e` `e` ⌘Z ⌘Z restores the second thread, then *re-archives* it (network: archive, archive, unarchive, archive of the same id). The toast says only "Archived" and lasts under 6s. `z` works but nothing advertises it.
- **Repro:** `j e e`, then ⌘Z ⌘Z.
- **Screenshot:** `s1-archive1-1440.png`, `s1-undo-1440.png`
- **Fix:** `apps/desktop/src/screens/Inbox.tsx`: keep a stack of `{threadId, action}`, and have undo pop from it instead of inverting the last action. Put the thread title and "z" in the toast copy (`packages/ui/src/components/toast.tsx`).

### L2-11: Opening a thread does not mark it read
- **Screen / width:** Inbox, all widths
- **Expected:** Opening a thread clears its unread dot and the "1 unread" count.
- **Actual:** `#omnis-launch` was opened about ten times across runs and still shows the blue dot and "1 unread". Its hover card says "Unread 2".
- **Repro:** Click `#omnis-launch`, press Esc, look at the header.
- **Screenshot:** `s3-slack-thread-1440.png`
- **Fix:** Mark items read on open (a `read_at` update via Zero or the hub) in `Thread.tsx`, and let the Inbox unread count follow it.

### L2-12: ⌘K search misses what the app itself wrote
- **Screen / width:** ⌘K palette, 1440
- **Expected:** "Brightstone" finds `#omnis-launch` (its summary and draft) and the Brightstone approval. An empty ⌘K shows recent threads and people. The commands include the verbs Logan needs: Archive, Approve, Reply, Snooze, Label, Mark read.
- **Actual:** "Brightstone" gives 0 rows. ⌘K opens with 0 rows. `>` lists 7 "Go to" commands plus "Toggle detail pane", and ">archive" gives nothing.
- **Repro:** ⌘K, type `Brightstone`; ⌘K, type `>archive`.
- **Screenshot:** `s5-brightstone-1440.png`, `s5-palette-open-1440.png`
- **Fix:** Index the thread summary, draft item body and approval description in the hub's `/search` (apps/hub). Seed ⌘K's empty state with recents (`packages/ui/src/components/command-palette.tsx`). Register thread actions as commands in `App.tsx` against the selected thread.

### L2-13: The ask panel hijacks Tab and stays open (r1 L-18)
- **Screen / width:** Ask bar, 1440
- **Expected:** Tab passes over the ask bar. The panel opens on typing, or on ⌘K, and closes when focus leaves.
- **Actual:**
  - From load: Tab 1 is the skip link, 2–13 the rail, 14 the ask input. Reaching the input opens the panel, and Tab 15–23 walk through its Add mention, Auto, Suggestions, Commands, Close and four "Go to" buttons before reaching "6 need approval" and the pills (Tab 24–30).
  - The panel stays open after focus leaves. Its body then intercepts pointer events on the pill row: Playwright could not click "All" because `ask-panel__context-body` was on top.
- **Repro:** Load, press Tab 15 times, then click "All".
- **Screenshot:** `s10-tab-focus-1440.png`
- **Fix:** `packages/ui/src/components/ask-panel.tsx`: open on input or ⌘K, not on focus. Close on `focusout` outside the bar. Set `inert` on the panel while it is closed.

### L2-14: A collapsed pane makes Enter a no-op, and the collapse is sticky
- **Screen / width:** Detail pane, 1440
- **Expected:** With the pane collapsed, Enter on a row opens the thread (as a sheet, same as a click). Collapse is a per-device preference, and the pane shows a visible way back.
- **Actual:**
  - Clicking a row opens the floating sheet, but Enter on the same row does nothing: focus stays on the row and no pane appears.
  - The collapsed flag is written to the hub (`remember(DETAIL_COLLAPSED_KEY)` in `App.tsx`), so every fresh browser context loaded with no pane. The only way back is a 16px "‹" at the ask bar's right edge.
  - ⌘\ drops focus to `<body>` both when collapsing and expanding.
- **Repro:** Press ⌘\, reload, then `j` Enter.
- **Screenshot:** `s11-collapsed-1440.png`, `s11-collapsed-click-1440.png`
- **Fix:** In `App.tsx` / `Inbox.tsx`, route the keyboard open through the same `setOpen` path as the click, so it produces the sheet when `paneCollapsed`. After ⌘\, restore focus to the selected row. Consider localStorage over the hub setting for a layout preference.

### L2-15: Today's approvals are dead chips
- **Screen / width:** Today, all widths
- **Expected:** Clicking an approval on Today opens it (card in the pane, or its thread). "6 items to handle today" lists the six items. Agents that are blocked or working show here.
- **Actual:** Clicking "Send the countersigned NDA back to Northwind legal?" changes nothing, although the approval has a thread ("omnis launch sync"). The chips carry no person, channel or thread. Blocked agents are not mentioned. Below the chips the screen is 70% empty.
- **Repro:** Today, click any chip.
- **Screenshot:** `s6-today-1440.png`, `s6-today-pill-click-1440.png`
- **Fix:** `apps/desktop/src/screens/Today.tsx`: chip `onClick` opens the approval in the pane (the queue component the Inbox uses), and falls back to `onOpenThread(thread_id)`. Add an "Agents needing you" group. Add the requester and channel to each chip (r1 L-42).

### L2-16: Quick-add files tasks out of sight
- **Screen / width:** Tasks, all widths
- **Expected:** A task typed while the Today tab is showing is due today, or the toast says where it went ("Added to Someday · Move to Today").
- **Actual:** The task is created (`POST /tasks 201`) with no due date and appears only under Someday. The Today tab still says "Nothing due today", and the toast says "Added to Tasks".
- **Repro:** Tasks → Today → type "Send Dana deck comments" and press Enter.
- **Screenshot:** `s6-tasks-added-1440.png`, `s6-tasks-someday-1440.png`
- **Fix:** `apps/desktop/src/screens/Tasks.tsx`: default `due_at` from the active tab (Today → today, This week → Friday), and name the bucket in the toast.

### L2-17: A note produces an internal error row in the Inbox
- **Screen / width:** Notes and Inbox, all widths
- **Expected:** A note that can't be routed offers a picker ("Attach to… Dana Lee / #omnis-launch / Task"). Internal job failures never appear as inbox content.
- **Actual:** Saving "Brightstone: ask Dana about the two changed special terms" shows "Couldn't find a routing target — pick one manually" with nothing to pick, and the note is marked "Not routed". Minutes later the omnis thread's row reads "Automatic processing failed (note_route). Please check it manually." That exposes an internal job name, and there is no action on it.
- **Repro:** Notes → type → Save; then go back to the Inbox.
- **Screenshot:** `s6-notes-saved-1440.png`, `s9-1100.png` (row "omnis")
- **Fix:** Add the manual target picker in `apps/desktop/src/screens/Notes.tsx`. In the kernel's failure notice (packages/kernel), map `note_route` to user copy ("Couldn't file your note about Brightstone · Choose where it goes"), linking back to the note.

### L2-18: Settings says everything is connected (r1 L-20)
- **Screen / width:** Settings → Accounts, all widths
- **Expected:** Real per-account state: Connected · synced 2m ago / Needs sign-in / Not connected. The rows double as the source for the connection banner (L2-05).
- **Actual:** Google Calendar, omnis, Gmail, Agent and Slack all show a green "Connected". This seeded stack has no live adapter, and "Agent" and "omnis" are not accounts.
- **Repro:** Open Settings.
- **Screenshot:** `s6-settings-1440.png`
- **Fix:** `apps/desktop/src/screens/Settings.tsx`: read adapter health from the hub (`adapter-health.ts` already exists kernel-side) and show last sync. Hide non-account channels, or label them "built in".

### L2-19: The list order is unexplained and shifts under you
- **Screen / width:** Inbox, all widths
- **Expected:** Newest first, or labelled groups ("Needs you", "Today", "Earlier"). A row does not move while you are working on it.
- **Actual:**
  - "Logan Kim · 15 Nov 2023" sits above "Spam filter training · 6m".
  - After the invoice approval (attached to Dana's thread) was approved, Dana's thread jumped from row 8 to the very last row (checked in a 2400px-tall window, all 15 rows).
  - The "omnis" row moved from row 7 to row 14.
  - No header explains the ordering.
- **Repro:** Compare `s0-first-load-1440.png` with a load after approving from the queue.
- **Screenshot:** `s0-first-load-1440.png`, `s4-approve-after-1440.png`
- **Fix:** `apps/desktop/src/screens/Inbox.tsx`: if ordering is attention-first, render `GroupHeader`s ("Needs approval", "Recent"); otherwise sort by `last_item_at` only.

### L2-20: A stale digest is presented as tonight's (r1 L-24)
- **Screen / width:** Digest and Today, all widths
- **Actual:** The Digest title is "August 31 night digest, nothing archived", and Today says "Nightly digest ready · 0 archived", on 22 September.
- **Expected:** "No digest yet tonight · last one Aug 31", or no card at all.
- **Repro:** `g d`.
- **Screenshot:** `s6-digest-1440.png`
- **Fix:** `apps/desktop/src/screens/Digest.tsx` and `Today.tsx`: compare the digest date with today before calling it "ready".

### L2-21: The PWA is still a read-only list (r1 L-21)
- **Screen / width:** PWA (`apps/web`), 390
- **Expected:** Tap a row to open the thread; approvals and agents are reachable; an ask bar is available.
- **Actual:**
  - Tapping a row only highlights it. Nothing opens.
  - The "Keep omnis on your Home Screen" card takes the top 300px on every load until dismissed.
  - Tabs are Inbox/Today/Tasks/Network/Notes. There are no Approvals or Agents tabs and no ask bar.
  - On the highlighted row, "More actions" (•••) is drawn over the "Done" pill ("Dc•••").
  - The good news: the manifest and apple-touch-icon are in place, and rows are readable now.
- **Repro:** Open :5574 at 390 and tap "Label rule cleanup".
- **Screenshot:** `s8-pwa-home-390.png`, `s8-pwa-row-tap-390.png`
- **Fix:** `apps/web/src/screens/Inbox.tsx` opens a thread sheet (reuse `packages/ui` Sheet and the desktop Thread). Add an Approvals tab in `apps/web/src/components/BottomTabBar.tsx`. Show `InstallGuideCard` once, then keep it behind a menu entry. Reserve the pill's space for `.inbox-row__more`.

### L2-22: The filter pills ignore arrow keys (r1 L-19)
- **Screen / width:** Inbox, 1440
- **Expected:** A `role=radiogroup` moves with ←/→, with roving tabindex.
- **Actual:** Focus "All", press → : focus and selection stay on "All". Every pill is its own Tab stop.
- **Repro:** Tab to "All", press ArrowRight.
- **Screenshot:** `s10-tab-focus-1440.png`
- **Fix:** Add arrow handling and roving tabindex in `packages/ui/src/components/segmented-control.tsx` / `filter-chip-bar.tsx`.

### L2-23: Half the keymap is missing (r1 L-22)
- **Screen / width:** Inbox / Thread, 1440
- **Expected:** `a` approves the open thread's top approval (with confirm), `r` replies, `l` labels, and `?` shows the shortcut sheet.
- **Actual:**
  - `a` on an open thread with a pending card does nothing.
  - `?` opens the ask panel (Suggestions) instead of a shortcut list.
  - `l` does nothing.
  - No control adds or removes a label on a thread. The label "+" only *filters*.
- **Repro:** Open "omnis launch sync" and press `a`, `l`, `?`.
- **Screenshot:** `s10-help-1440.png`
- **Fix:** Handle `approve`/`label`/`reply` in `apps/desktop/src/screens/Inbox.tsx` / `Thread.tsx` (the actions already exist in `use-keymap.ts`). Add a label popover writing through a hub route. Add a shortcut sheet dialog on `?`.

### L2-24: The approvals queue floats free of threads
- **Screen / width:** Pane queue, 1440
- **Expected:** Each queued approval shows "from <agent> · in <thread>". Clicking the thread name opens the thread with the card in place.
- **Actual:** Queue rows read "Send · Confirm the offsite venue for the 12th?". Expanding one shows the same card with no thread, requester or channel. Nothing leads from a card to its conversation.
- **Repro:** Click any "N more waiting" row.
- **Screenshot:** `s4-queue-expand-1440.png`
- **Fix:** `packages/ui/src/components/approval-stack.tsx`: add a thread/requester subline and an "Open thread" link. The data is `pending_approvals.thread_id` / `requested_by`.

## Minor

### L2-25: Agents leak into the Slack and Work filters (r1 L-30)
- **Screen / width:** Rail / tabs, 1440
- **Actual:** The rail Slack filter lists `#omnis-launch` plus 7 omnis agents ("Spam filter training", "Label rule cleanup", …). The Work tab shows the same agents. The rail "Agent" tile shows only `claude_code · inbox-draft`, while the Agents tab shows 7 sessions. The header still says "Inbox" while a channel filter is active.
- **Expected:** Slack shows Slack threads, Agents shows agents, and the header names the filter ("Slack").
- **Repro:** Click the Slack rail tile; click the Agent rail tile; compare with the Agents tab.
- **Screenshot:** `s2-rail-channel-1440.png`, `s4-agents-tab-1440.png`
- **Fix:** In `Inbox.tsx`'s channel predicate, exclude `agent_session` threads from channel filters and include every agent session under Agent. Put the filter name in the header.

### L2-26: Rail keyboard reorder collides with macOS
- **Screen / width:** Rail, 1440
- **Actual:** Tiles advertise `aria-roledescription="reorderable"`. Space+↑ does nothing. The binding is Ctrl+↑/↓ (`channel-rail.tsx:374`), which macOS intercepts for Mission Control and App Exposé by default. No tooltip or hint mentions it.
- **Expected:** An Option+↑/↓ (or grab with Space, then arrows) binding, and a hint in the tile's `aria-description` or tooltip.
- **Repro:** Focus the Slack tile, press Space, ↑, Space.
- **Screenshot:** `s2-rail-dragged-1440.png` (mouse drag works and persists)
- **Fix:** `packages/ui/src/components/channel-rail.tsx` `onTileKeyDown`: accept `altKey`, and describe the binding.

### L2-27: The hover card covers the thread you just opened (r1 L-27)
- **Screen / width:** Inbox row, 1440
- **Actual:** Clicking a row leaves the pointer on it, and the hover card opens over the detail pane, hiding the first messages of the thread.
- **Expected:** No hover card on the selected row, or one suppressed for a moment after a click.
- **Repro:** Click `#omnis-launch` and keep the mouse still.
- **Screenshot:** `s3-slack-thread-1440.png`
- **Fix:** `packages/ui/src/components/inbox-row.tsx`: suppress the hover card while the row is selected or the pane shows it.

### L2-28: Archived view rough edges
- **Screen / width:** Archived, 1440 and 390
- **Actual:**
  - The empty Archived view is a blank card with no copy and no "Back to Inbox". The Archived toggle is an unlabeled icon.
  - Pressing `u` quickly makes restored rows reappear for a moment (4 → 2 → 1 → back to 1 with an already-restored row).
  - After the last restore, focus is on `<body>`.
  - The "Needs approval" pill loses its count in this view.
- **Expected:** "Nothing archived · Inbox (g i)", a stable list, and focus on the next row or the heading.
- **Repro:** Archive 3, open Archived, then `j u u u`.
- **Screenshot:** `s7-archived-1440.png`, `s7-archived-empty-1440.png`
- **Fix:** `Inbox.tsx`: add empty copy for the archived view, keep optimistic removals until Zero confirms, and focus the header when the list empties.

### L2-29: Empty filter results and the shifting chip (r1 L-32)
- **Screen / width:** Inbox, 1440
- **Actual:** Personal + label "contract" shows a blank white list: no "No threads match", no "Clear filters". The label chip is inserted to the *left* of "All", so every pill moves ~135px right.
- **Expected:** Empty copy with a Clear action. The chip goes after the pills.
- **Repro:** Personal → + → contract.
- **Screenshot:** `s12-empty-filter-1440.png`, `s2-label-menu-1440.png`
- **Fix:** `Inbox.tsx` empty state; chip order in `packages/ui/src/components/filter-chip-bar.tsx`.

### L2-30: The thread header wastes space and repeats itself (r1 L-36)
- **Screen / width:** Thread, all widths
- **Actual:**
  - About 90px of empty pane above the floating toolbar (at 390 the sheet spends ~220px before the first message).
  - "omnis launch sync" appears as the sender line, the h-title and the first message body.
  - "To: me" on a Slack channel and on a calendar event.
  - The Summary tab of `#omnis-launch` talks about the Brightstone agreement while the messages are about a PR review (seed `varyInboxCopy` mismatch, but the UI does not flag it).
- **Expected:** One title line. "From Dana Lee · Gmail" for a received thread and "#omnis-launch · Slack" for a channel.
- **Repro:** Open any thread.
- **Screenshot:** `s1-open-thread-1440.png`, `s8-desktop-row-tap-390.png`
- **Fix:** `Thread.tsx` header; `packages/ui/src/components/detail-pane.tsx` top padding.

### L2-31: The floating pane cuts the list at 900–1279
- **Screen / width:** 1100
- **Actual:** An open thread floats over the right 40% of the list. The pill strip is cut after "Needs approval 5", and row previews are cut mid-word under the panel with no ellipsis.
- **Expected:** The list reserves the sheet's width, or rows truncate before the sheet's edge.
- **Repro:** Open a thread and resize to 1100.
- **Screenshot:** `s9-1100.png`
- **Fix:** `apps/desktop/src/app.css` floating tier: `padding-inline-end` on the list while the sheet is open.

### L2-32: The omnis rename is half done (r1 L-31)
- **Screen / width:** all
- **Actual:** The rail tile and Settings use the omnis mark and label, but the omnis thread row's avatar is green "OM" initials. Every omnis agent is an identical black square with "O".
- **Expected:** The mark as the omnis avatar, and per-agent glyphs or colours.
- **Repro:** Look at the "omnis" row.
- **Screenshot:** `s0-first-load-1440.png`
- **Fix:** `packages/ui/src/components/inbox-row.tsx` avatar: use the `ChannelGlyph` omnis mark when `channel === "system"`, and hash a hue for agent avatars.

### L2-33: Narrow chrome (r1 L-37)
- **Screen / width:** 390, desktop build
- **Actual:**
  - Compose (bottom right) is permanently disabled.
  - Slack, Logan's busiest channel, sits under "More" together with the six screens.
  - The thread sheet has a close row, a toolbar row and a header before any content.
  - Bottom-bar icons are faintly visible through the lower edge of the sheet.
- **Expected:** Compose hidden until it works, the bottom bar ordered by volume, and an opaque sheet body.
- **Repro:** 390, open any row.
- **Screenshot:** `s8-desktop-home-390.png`, `s8-desktop-menu-390.png`, `s8-desktop-row-tap-390.png`
- **Fix:** `packages/ui/src/components/bottom-bar.tsx`, `sheet.tsx`.

### L2-34: Network oddities (r1 L-34)
- **Screen / width:** Network, 1440
- **Actual:**
  - "Logan Kim", the user himself, is listed as a contact.
  - Dana's card says "Messages 0" above two conversations.
  - "This is the same person" answers "Merging two people isn't wired up yet".
- **Expected:** Self excluded, a real message count, and no dead buttons.
- **Repro:** `g n`, click Dana Lee, then click "This is the same person".
- **Screenshot:** `s6-network-person-1440.png`, `s6-network-merge-1440.png`
- **Fix:** `apps/desktop/src/screens/Network.tsx`: filter the self person, count items, and hide merge until it works.

### L2-35: react-virtuoso console errors
- **Screen / width:** Inbox, 1440
- **Actual:** Every archive logs `react-virtuoso: Zero-sized element, this should not happen` at console error level (4 times in one S1 run).
- **Expected:** A clean console.
- **Repro:** `j e e e` with DevTools open.
- **Screenshot:** n/a (console)
- **Fix:** `Inbox.tsx`: the row collapse animation should unmount instead of animating to height 0 inside Virtuoso, or use `itemSize`.

## Polish

### L2-36: Model tiers copy (r1 L-40)
- **Actual:** "$0 used · 90% · Normal" over an empty bar, where "90%" reads as usage. "VIP/sensitive thread reserve: $6 (10% of the cap)" appears while the cap field is empty.
- **Screenshot:** `s6-settings-tiers-1440.png`
- **Fix:** `Settings.tsx`: label it "Alert at 90%", and show the cap next to the reserve.

### L2-37: Approval card hierarchy
- **Actual:** Approve, Edit, Respond and Ignore are four equal outlined buttons. Approve is not the primary action, "Respond" has no explanation, and there is a ~30px empty band above "Send needs your approval".
- **Screenshot:** `s0-first-load-1440.png`
- **Fix:** `approval-card.tsx`: make Approve the accent `Button`, add a tooltip or subline for Respond, and trim the top padding.

### L2-38: "Good morning" at 00:45
- **Actual:** Today greets "Good morning, Logan" at 00:45 local.
- **Screenshot:** `s6-today-1440.png`
- **Fix:** `Today.tsx`: pick the greeting by hour, or drop it for the count.

### L2-39: Session divider misaligned
- **Actual:** The rule under the Runtime/Started/Last turn table starts ~45px right of the table's left edge.
- **Screenshot:** `s4-session-claude_code-inbox-draft-1440.png`
- **Fix:** `packages/ui/src/components/session-header.tsx` / `app.css`: align the rule with `KeyValueTable`.

---

## Scenario coverage

| Scenario | 1440 | 390 | Notes |
|---|---|---|---|
| S1 triage | done | done | `j/k/e/z` work at both widths; at 390 Enter moves focus to the sheet's Close (good) |
| S2 rail, tabs, label chip, drag | done | partial | Label *filter* chip add/remove works; there is no thread label action (L2-23); drag verified at 1440 only |
| S3 reply | done | done (sheet) | Blocked by L2-01, L2-02 |
| S4 agent session + approvals | done | done | L2-06; approve confirm, outcome toast, Ignore and Undo work |
| S5 ⌘K | done | done | 1440 works for people/commands; 390 is L2-03 |
| S6 screens | done | done | Today L2-15, Tasks L2-04/L2-16, Notes L2-17, Network L2-34, Digest L2-20, Settings L2-18 (kill switch confirm OK) |
| S7 archived | done | done | `u` restore works; L2-28 |
| S8 iPhone / PWA | — | done | L2-03, L2-21, L2-33 |
| S9 resize sweep | done | done | No horizontal overflow at any 10px step; the one jump is at 890, where the open thread becomes the sheet (by design); L2-31 |
| S10 keyboard-only | done | — | L2-09, L2-13, L2-22, L2-23 |
| S11 pane collapse/resize | done | — | Resize solid (320–678, double-click reset to 420, arrow keys ~16px); L2-14 |
| S12 empty/loading/error | done | done (loading) | L2-05, L2-28, L2-29 |
