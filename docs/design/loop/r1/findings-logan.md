# Loop r1: user test "Logan"

**Persona:** Logan, founder of a small AI studio. Handles about 80 Slack, Gmail, and KakaoTalk threads a day and runs three coding agents. Impatient and keyboard-first.
**Build:** `plan/loop-r1` @ `eb65057`. Seeded e2e stack (`seed.ts` + `varyInboxCopy` + the `shots.ts` densify fixture) on DB `omnis_test_loop_r1`. Desktop dev server on :5173, PWA (`apps/web`) on :5174.
**Widths:** 1440×900 and 390×844. S9 also swept 1440→390 continuously in 10px steps.
**Screenshots:** `docs/design/loop/r1/test-logan/` (paths below are relative to that folder).
**Date:** 2026-09-21

## Verdict

Logan could not finish his morning with this build. Three of the four things he opens the app for fail:

- **Triage by keyboard is broken.** Only `e` works, and only after a mouse click.
- **Replying is impossible.**
- **At phone width the inbox cannot be reached at all.** An approval sheet covers it and cannot be closed.

Agent observability is a transcript with no state, cost, or header. Six of the seven screens can only be reached by typing `?screen=` into the URL. What does work is solid and good-looking:

- the list rendering, the filter pills and the label filter
- rail drag-reorder (it persists)
- the archived view with `u` to restore
- the approve confirm dialog
- detail-pane collapse and resize (`⌘\`, drag, keyboard, double-click reset, persisted)
- the 390 filter sheet

Tally: **8 blocker · 16 major · 15 minor · 5 polish** (44 findings).

## Findings table

| ID | Screen | Width | Severity | Finding |
|----|--------|-------|----------|---------|
| L-01 | Inbox | 1440 | blocker | `j`/`k`, arrow keys and every `g` sequence do nothing; only `e`/`u` are wired |
| L-02 | Inbox | 1440 | blocker | `e` only works after a mouse click and selection does not advance, so the next `e` re-archives the same thread |
| L-03 | Inbox | all | blocker | No undo for archive: no toast, `⌘Z` and `u` do nothing in the Inbox view |
| L-04 | Inbox shell | 390 (<900) | blocker | An approval sheet opens on launch over the whole inbox and cannot be dismissed |
| L-05 | Thread / AI panel | all | blocker | No way to reply: Reply is disabled, "Draft a reply" is disabled, "Edit & send" is a dead button |
| L-06 | Shell | all | blocker | Today, Tasks, Network, Notes, Digest and Settings are unreachable in-app (URL `?screen=` only) |
| L-07 | Tasks | all | blocker | Quick-add clears the typed task and stores nothing, silently |
| L-08 | PWA Inbox | 390 | blocker | PWA rows are collapsed to a ~60px column and unreadable (stale vendored CSS) |
| L-09 | Shell | all | major | Hub or sync unreachable gives a blank white page: no loading, offline or error state |
| L-10 | Agent session | all | major | Session pane has no header, state, model, cost or duration; a running session renders empty |
| L-11 | Approvals | all | major | Approve confirm hides the payload and recipient; after approval nothing shows it was sent |
| L-12 | Approvals | all | major | Ignore is one click and irreversible, while Approve asks to confirm |
| L-13 | Inbox / Approvals | all | major | Failed archive and failed approve are silent (row pops back, card stays) |
| L-14 | Notes (+ item unarchive, digest undo) | all | major | Notes "Save" returns 404: the dev proxy is missing `/notes`, `/items`, `/digests` |
| L-15 | ⌘K palette | all | major | Enter on a search result does nothing; a person result does nothing even when clicked |
| L-16 | ⌘K palette | all | major | Commands tab holds one command ("Go to Inbox") and typing does not filter it |
| L-17 | Inbox shell | 900–1279 | major | The floating approval sheet covers ~40% of the list on every load |
| L-18 | Ask bar | 1440 | major | AI panel opens on focus, stays open on blur over the Inbox header, and its hidden controls sit in the tab order (20 Tabs to reach row 1) |
| L-19 | Keyboard | 1440 | major | Radio pills ignore arrow keys; focus drops to `<body>` on End/Home and after opening a thread; Esc does not close the thread |
| L-20 | Settings | all | major | Every account reads "Connected" (System and Agent too) while the hub has 0 adapters connected |
| L-21 | PWA | 390 | major | Row tap does nothing, four of five tabs are empty, no agents or approvals tab, no apple-touch-icon |
| L-22 | Inbox / Thread | all | major | No way to add or remove a label on a thread (menu has only Open and Archive; `l` unbound) |
| L-23 | Thread | all | major | The same outgoing text appears three times with three action sets; "To: me" on a Slack channel |
| L-24 | Digest / Today | all | major | "August 31 night digest" on Sept 21: a stale digest presented as tonight's |
| L-25 | Thread draft card | 1440 | minor | Draft card buttons are unstyled native buttons |
| L-26 | Approval card | 420/320 pane, 390 | minor | "Edit & approve" wraps, "Ignore" is clipped outside the card; copy lacks who/where |
| L-27 | Row hover card | 1440, 390 | minor | Hover card overlaps the approval card and the open menu, and renders off-screen behind the rail |
| L-28 | Row context menu | 1440 | minor | Escape does not close the row "More actions" menu |
| L-29 | Counts | all | minor | Approval counts disagree between the pill, the stack and Today |
| L-30 | Rail | 1440 | minor | Rail "Agent" shows 1 session; the Agents tab shows 6 |
| L-31 | Agents list | 1440 | minor | "Blocked" session whose last line is "✓ Turn completed"; identical black "O" avatars |
| L-32 | Inbox header | 1440 | minor | Label chip shifts the pill row ~134px; empty views have no copy and the header jumps 22px |
| L-33 | Rail | 1440 | minor | System glyph equals the Settings gear; active tile stays on Inbox on other screens; Account and Settings tiles disabled |
| L-34 | Network | 1440 | minor | "Messages 0" beside 2 conversations; calendar thread shows a Gmail glyph; merge is a dead button |
| L-35 | Copy | all | minor | "Phase B", "Thread required", "Not wired up yet — Phase B" shown to the user |
| L-36 | Thread header | 1440 | minor | ~120px empty band above the icon pill; title printed twice; Summary tab shows the draft |
| L-37 | Shell chrome | 390 | minor | ~122px of stacked bottom chrome; palette floats detached; Compose permanently disabled; tab label wraps |
| L-38 | Inbox header | 600–640, 890 | minor | Pill strip clips "Archived" and "+ Label" before collapsing; pane jumps at 890 |
| L-39 | Desktop bundle | phone | minor | `apps/desktop/index.html` has no viewport meta |
| L-40 | Settings → Model tiers | 1440 | polish | "90%" threshold label over an empty bar reads as usage |
| L-41 | Source | n/a | polish | 18 source files carry Korean comments (English-only rule) |
| L-42 | Today | all | polish | Approvals are bare pills with no person, channel or thread; no agent status on Today |
| L-43 | ⌘K search | all | polish | "Dana" finds the person but none of her threads; hits have no channel glyph or time |
| L-44 | Tooling | n/a | polish | `tools/e2e/stack.ts` hardcodes DB, ports and replica path, so two stacks in one worktree corrupt each other |

---

## Blockers

### L-01 — Keyboard navigation is dead
- **Screen / width:** Inbox, 1440
- **Expected:** Logan lives on `j`/`k` to move and `g t`/`g k` to jump. A keyboard-first inbox moves selection without the mouse.
- **Actual:** `j`, `k`, ArrowDown, and every `g` sequence do nothing. The palette itself advertises "g i" for Go to Inbox, and that doesn't work either. `use-keymap.ts` resolves `next-row`, `reply`, `approve`, `snooze`, `label` and more, but `Inbox.tsx:500` only handles `archive` and `unarchive`. No shell-level `useKeymap` handles the `go-*` actions.
- **Repro:** Load `/` at 1440. Press `j` `j` `g` `t`. Nothing is selected and the screen doesn't change.
- **Screenshot:** `s1-tab-focus-1440.png`
- **Fix:** Handle `next-row`/`prev-row` in `apps/desktop/src/screens/Inbox.tsx` (move `selectedId` over `filtered`, scroll it into view, focus the row). Add a `useKeymap` in `apps/desktop/src/App.tsx` for `go-*`, which depends on L-06. Wire `approve` (`a`) to the open thread's top approval.

### L-02 — `e` needs a mouse click first and never advances
- **Screen / width:** Inbox, 1440
- **Expected:** `e` archives the focused row and selection moves to the next row. Three presses archive three threads.
- **Actual:**
  - Tab-focusing a row and pressing `e`: no request is sent.
  - Pressing Enter on a row (it opens) and then `e`: nothing is archived either.
  - Only a mouse click sets `selectedId`. After that, `e` archives, the row leaves, and focus lands on the next row, but `selectedId` still points at the archived thread. The second and third `e` POST `/api/threads/<same id>/archive` again (network log: two identical POSTs, both 200).
- **Repro:** Click "PoC review", press `e` `e` `e`. One thread is archived and the list is otherwise unchanged.
- **Screenshot:** `s1-click-then-e-1440.png`
- **Fix:** In `Inbox.tsx` `toggleArchive`/`useKeymap`, set `selectedId` to the next visible row id after an optimistic archive. Also derive `selectedId` from focus (`onFocus` on `.inbox-row`) so keyboard focus and selection are one thing.

### L-03 — Archive has no undo
- **Screen / width:** Inbox, all widths
- **Expected:** A Gmail/Superhuman-style "Archived · Undo" toast, and `⌘Z` or `z` to reverse the last archive. Logan archives in bursts and will fat-finger one.
- **Actual:** No toast and no status region (`[role=status]` is empty). `⌘Z` does nothing. `u` only works inside the Archived view. The only way back is to find the Archived toggle (an unlabeled icon), find the row, and restore it.
- **Repro:** Archive a row, then press `⌘Z` or `u`. The row stays gone.
- **Screenshot:** `s1-no-undo-1440.png`
- **Fix:** Add a toast with Undo (a new `packages/ui` toast, or reuse the `role="status"` banner pattern from `Tasks.tsx`) driven from `Inbox.tsx` `toggleArchive`. Map `z` or `⌘Z` to `setThreadArchived(lastId, false)`.

### L-04 — At 390 the inbox is behind an approval sheet that cannot be closed
- **Screen / width:** Inbox shell, 390 (and anything under 900)
- **Expected:** At phone width Logan sees his list first, with approvals reachable from a badge or tab.
- **Actual:** With any approval pending, `App.tsx:332` (`detail = … || approvals.length > 0`) opens the detail pane. Under 900 that pane is a full-height sheet over the list. It has no close button, no grabber, and ignores Esc and drag-down. Tapping the Inbox or Slack tiles leaves it up. The list is unreachable until every approval is decided. The card's "Ignore" button is also clipped past the card edge (x 311–378, card ends at ~356).
- **Repro:** Load `/` at 390×844 with the seeded approvals. Try Esc, drag the sheet down, or tap the rail tiles.
- **Screenshots:** `s1-inbox-390.png`, `s1-after-swipe-390.png`
- **Fix:**
  - `apps/desktop/src/App.tsx`: never auto-open the pane below 1280 for approvals alone. Show a count on the Needs-approval pill or the bottom bar instead.
  - Give the sheet a close control and Esc/drag-dismiss (`packages/ui/src/components/sheet.tsx` already exists; reuse it for the narrow pane).
  - Let `approval-card.tsx` actions wrap to a 2×2 grid when they can't fit.

### L-05 — There is no way to reply to a thread
- **Screen / width:** Thread and AI panel, all widths
- **Expected:** Open the Slack thread, press `r` or ask the AI "draft a reply saying I'll review by Friday", edit the draft, and see it queued for approval to `#omnis-launch`.
- **Actual:**
  - Header Reply button: disabled (tooltip "Not wired up yet — Phase B").
  - AI panel "Draft a reply" and "Extract to-dos": disabled with a "Phase B" badge.
  - Typing a sentence in the ask bar and pressing Enter runs a keyword search ("Threads: #omnis-launch").
  - The seeded Draft card's "Edit & send" does nothing: no request, no editor, focus stays on the button.
  - "Discard" and "Regenerate" are equally inert-looking native buttons (L-25).
- **Repro:** Click `#omnis-launch`, press `⌘K`, and try "Draft a reply". Then scroll the pane and click "Edit & send".
- **Screenshots:** `s3-slack-thread-1440.png`, `s3-ask-panel-1440.png`, `s3-typed-ask-1440.png`, `s3-draft-card-1440.png`
- **Fix:**
  - `packages/ui/src/components/draft-card.tsx` plus `apps/desktop/src/screens/Thread.tsx`: "Edit & send" should open an inline editor and create an approval through the kernel's `approvals.propose`, the same path the seed uses.
  - Make `r` focus that editor.
  - In `ask-panel.tsx`, route free text that isn't a search to an ask (or say plainly that asks are not available yet) instead of silently searching.

### L-06 — Six of seven screens are unreachable from the app
- **Screen / width:** Shell, all widths
- **Expected:** The rail or `g t` / `g k` / `g n` / `g o` / `g d` / `g s` reach Today, Tasks, Network, Notes, Digest and Settings.
- **Actual:**
  - `ShellScreen` is a prop set once from `?screen=` in `main.tsx`. There is no screen state in `Shell`.
  - The rail has no tiles for those screens. Its Settings and Account tiles are `disabled` (the `PHASE_B_TITLE` note in `ChannelRail`).
  - `g` sequences do nothing, and the palette offers only "Go to Inbox".
  - Logan found Today only by reading the source.
- **Repro:** Load `/` and try to reach Settings any way except editing the URL.
- **Screenshots:** `s6-today-1440.png`, `s5-commands-1440.png`
- **Fix:**
  - Move `screen` into `useState` in `apps/desktop/src/App.tsx`.
  - Add rail entries or a rail section in `packages/ui/src/components/channel-rail.tsx`.
  - Enable the Settings tile.
  - Register `go-*` palette actions and `useKeymap` handlers.
  - Keep `?screen=` for the shot tools.

### L-07 — Tasks quick-add throws the task away
- **Screen / width:** Tasks, all widths
- **Expected:** Typing "Send Dana comments on the slides by Thursday" and pressing Enter creates a task, or says clearly that it could not.
- **Actual:** The field clears and nothing is stored or shown. "Nothing due today", "this week" and "without a date" all stay empty. `Tasks.tsx:231` `onSubmitQuickAdd` only calls `setQuickAdd("")`. The comment calls this "the honest state", but to the user it looks like success and loses what they typed.
- **Repro:** `?screen=tasks`, type a task, press Enter, then check every view.
- **Screenshot:** `s6-tasks-added-1440.png`
- **Fix:** Wire a hub `POST /tasks` (the kernel owns `tasks`). Until then, disable the field with a visible "Tasks can't be created yet" hint, or keep the text and show an inline error. Never clear unsaved input.

### L-08 — PWA inbox rows are unreadable
- **Screen / width:** PWA Inbox, 390 (mobile emulation)
- **Expected:** The same row grammar as the desktop: name, time, summary, glyph.
- **Actual:** Each row is a ~60px column. The title is clipped to one letter ("O…"), the summary wraps one word per line ("Seco / oc…"), the channel glyph and the unread dot bleed out of the card's left edge, and "⋯" is an unstyled native button. The overflow probe reads 0px because the card clips it. Root cause: `apps/web/src/vendor/app-styles.css` is a verbatim copy of `apps/desktop/src/app.css` **at 5ddba46 (4,394 lines)**. The source is now 5,726 lines, and the design waves changed the row markup the copy styles.
- **Repro:** Open `http://127.0.0.1:5174/` at 390×844 with mobile emulation.
- **Screenshot:** `s8-pwa-inbox-390.png`
- **Fix:**
  - Re-vendor `apps/desktop/src/app.css` into `apps/web/src/vendor/app-styles.css`.
  - Better: move the component CSS into `packages/ui` so it cannot drift, and add a check (a line-count or hash assertion in `tools/e2e/shots-w4b-web.ts`) that fails when the copy is stale.

## Major

### L-09 — Hub or sync down gives a blank white screen
- **Screen / width:** Shell, all widths
- **Expected:** A skeleton list, then "Can't reach the hub, retrying…" with the last-synced rows if any.
- **Actual:** With `/api/**` failing and the Zero socket not answering, the page stays pure white (the body has no text at all) for as long as I watched.
- **Repro:** Block `/api/*` and `ws://…:4848`, then load `/`.
- **Screenshot:** `s12-no-sync-1440.png`
- **Fix:** In `apps/desktop/src/main.tsx` and `App.tsx`, render the shell immediately with a `data-state="connecting"` list skeleton, and show a banner when `loadZeroToken` rejects or Zero reports `Failed to connect`.

### L-10 — Agent session pane shows no agent
- **Screen / width:** Agent session, all widths
- **Expected:** At a glance: which agent (runtime@host), purpose, state (Blocked on X), model, tokens/cost for this turn and session, elapsed time, cwd. Tool calls should be expandable with args and results. A blocked session should show the approval it waits on, with Approve/Reject right there.
- **Actual:**
  - The blocked `claude_code · inbox-draft` pane is three lines ("Listing src/.", "Reading ✓ index.ts main.ts", "✓ Turn completed") with no header, state, cost or approval.
  - The running "Drafting 3 inbox replies" pane is **completely empty**: no header, no items, no "working…" indicator.
  - Cost appears nowhere in the app except as a system-message row ("LLM cost is back within the normal range (month $0.00…)").
- **Repro:** Agents tab, then click `claude_code · inbox-draft`, then click "Drafting 3 inbox replies".
- **Screenshots:** `s4-agent-session-1440.png`, `s4-running-session-1440.png`, `s4-agents-list-1440.png`
- **Fix:**
  - `apps/desktop/src/screens/AgentSession.tsx`: add a header from `agent_sessions` + `agent_runtimes` (state via `StatusPill`, and runtime, model, cost and turn fields shown with `KeyValueTable`).
  - Render the session's pending approvals with `ApprovalStack`.
  - Add an empty or "working" state when the session has no tool items.

### L-11 — Approving a send doesn't show what is sent, or that it was
- **Screen / width:** Approvals, all widths
- **Expected:** The confirm dialog shows the message body and its destination ("Slack · #omnis-launch: 'Yes, I will review it today.'"). Afterwards the draft becomes "Sending…/Sent" or an "Approved" line appears, with a toast.
- **Actual:** The dialog reads "Approve this action? Reply to #omnis-launch?" with no body. After Approve (POST `/approvals/…/decide` 200), the thread still shows "Draft: Yes, I will review it today." and the Draft card still offers "Edit & send". Nothing in the UI records that it was approved.
- **Repro:** Open `#omnis-launch`, click Approve, then Approve in the dialog.
- **Screenshots:** `s4-after-approve-1440.png`, `s4-approved-1440.png`
- **Fix:**
  - `packages/ui/src/components/confirm-prompt.tsx` and `approval-card.tsx`: render `args.body` and the channel target.
  - `Thread.tsx`: show a decided-approval line, and flip the draft's status once the kernel executes.

### L-12 — Ignore is irreversible in one click, Approve is not
- **Screen / width:** Approvals, all widths
- **Expected:** Both are decisions. Ignore should at least be undoable with a toast, since it discards the agent's work.
- **Actual:** Ignore POSTs immediately with no confirm and no undo. The card vanishes and the Needs-approval count drops (6→5).
- **Repro:** Click "Ignore" on any approval card.
- **Screenshot:** `s4-after-ignore-1440.png`
- **Fix:** In `approval-stack.tsx`, delay the decide call behind an "Ignored · Undo" toast (same component as L-03).

### L-13 — Write failures are silent
- **Screen / width:** Inbox and approvals, all widths
- **Expected:** "Couldn't archive — retry" or "Approval didn't go through".
- **Actual:**
  - Archive with the hub returning 500: the row animates out, pops back, and the only trace is `console.error("archive failed")`.
  - Approve with a 500: the dialog closes and the card stays, with no message.
  - The Notes screen already has the right pattern ("Couldn't save the note. It is still in the box.").
- **Repro:** Route `/api/threads/**` and `/approvals/**` to a 500, then archive a row and approve a card.
- **Screenshots:** `s12-archive-fails-1440.png`, `s12-approve-fails-1440.png`
- **Fix:** Surface the rollback in `Inbox.tsx` `toggleArchive`'s catch and in `App.tsx` `decideApproval`'s catch through the shared toast (L-03).

### L-14 — Notes save 404s (and so do item unarchive and digest undo)
- **Screen / width:** Notes, all widths
- **Expected:** "Save" stores the note.
- **Actual:** POST `http://127.0.0.1:5173/notes` returns 404. The hub has the route (a direct POST to :8787 answers 400 for an empty body). `apps/desktop/vite.config.ts` proxies `/api /approvals /health /kill-switch /search /settings /cost` but not `/notes`, `/items` (`items/:id/unarchive`) or `/digests` (`digests/:id/undo`). This is the same failure mode the file's own `/search` comment describes.
- **Repro:** `?screen=notes`, type a note, click Save.
- **Screenshot:** `s6-notes-saved-1440.png`
- **Fix:** Add `/notes`, `/items`, `/digests` (and `/tasks` once L-07 lands) to the proxy in `apps/desktop/vite.config.ts`. Add a test that greps `apps/desktop/src/api/*.ts` for `${HUB_HTTP_URL}/<prefix>` and asserts that each prefix is proxied.

### L-15 — Palette: Enter doesn't open results; people are dead ends
- **Screen / width:** ⌘K palette, all widths
- **Expected:** Type "PoC", press Enter, and the top thread opens. Type "Dana", press Enter, and her person card opens.
- **Actual:**
  - Enter (with or without ArrowDown first) leaves the panel open and opens nothing.
  - Only a mouse click on a thread hit works.
  - A person hit does nothing even when clicked (`openHit` only follows `screen === "thread"`).
- **Repro:** `⌘K`, type "PoC", press Enter. Then `⌘K`, type "Dana", press ArrowDown and Enter.
- **Screenshots:** `s5-jump-thread-1440.png`, `s5-search-dana-1440.png`
- **Fix:**
  - `packages/ui/src/components/ask-panel.tsx` and `command-palette.tsx`: bind Enter to the highlighted hit (cmdk `onSelect`).
  - `App.tsx` `openHit`: route `person` links to `setOpenPersonId`.

### L-16 — Commands tab is a stub
- **Screen / width:** ⌘K palette, all widths
- **Expected:** Archive, label, snooze, go to each screen, toggle the pane, kill switch. Typing should filter.
- **Actual:** One command ("Go to Inbox · g i"). Typing ">today" or "go to" still shows only that command.
- **Repro:** `⌘K`, open Commands, type "go to".
- **Screenshot:** `s5-commands-1440.png`
- **Fix:** Grow `actions` in `apps/desktop/src/App.tsx` alongside L-06 and L-01, and pass the query into the Commands list filter in `ask-panel.tsx`.

### L-17 — 900–1279: the approval sheet eats the list on every load
- **Screen / width:** Inbox shell, 900–1279
- **Expected:** At 1024–1279 (a MacBook split-screen) the list is fully visible and the pane opens when asked.
- **Actual:** The sweep shows the list jumping from 720px to 1146px wide at 1270 while a 420px floating sheet sits over its right side. Row channel glyphs, unread dots, the Archive buttons and the right end of the ask bar are hidden. It happens on every load because approvals are pending (same root cause as L-04). The collapse chevron exists here, unlike at <900, but the pane comes back every session with approvals.
- **Repro:** Resize to 1270×900.
- **Screenshot:** `s9-resize-1270.png`
- **Fix:** Same `App.tsx:332` change as L-04. In the floating tier, open only on explicit selection.

### L-18 — The AI panel pops open on focus and never leaves
- **Screen / width:** Ask bar, 1440
- **Expected:** Tabbing through the ask bar doesn't open a panel, or the panel closes when focus leaves it.
- **Actual:** Tabbing into the ask bar opens the panel. After tabbing out to the pills, it is **still fully visible 1.5s later** (opacity 1) over the "Inbox" heading and the filter pills. Its controls (Suggestions, Commands, Close, the disabled items) sit in the tab order, so it takes **20 Tabs** from page load to reach the first row. At rest the combobox reports `aria-expanded=true`.
- **Repro:** Load `/` and press Tab 13 times.
- **Screenshots:** `s1-ghost-panel-1440.png`, `s1-tab-focus-1440.png`
- **Fix:**
  - `packages/ui/src/components/ask-panel.tsx`: close on focus-out of the bar+panel group, set `inert` while closed, and set `aria-expanded` from the real state.
  - Add a "Skip to list" target, or make `/` or `Esc` jump to the list.

### L-19 — Keyboard focus model is broken outside the list
- **Screen / width:** Keyboard, 1440
- **Expected:** ARIA radio semantics (one tab stop, arrows move) for the pills. Focus goes into the pane when a thread opens, and Esc returns it to the row.
- **Actual:**
  - `role=radio` pills are separate tab stops and ArrowRight does nothing.
  - In the list, End/Home drop focus to `<body>`.
  - Enter opens a thread but focus goes to `<body>`, not the pane.
  - Esc does not close the thread.
- **Repro:** Focus "Work" and press ArrowRight. Focus row 1 and press End.
- **Screenshot:** `s10-pill-focus-1440.png`
- **Fix:**
  - `packages/ui/src/components/segmented-control.tsx`: use a roving tabindex with arrow handling.
  - `Inbox.tsx`: pass react-virtuoso `scrollToIndex` for Home/End, then focus the row.
  - `App.tsx`: focus the pane heading on open, close on Esc, and restore focus to the row.

### L-20 — Settings says every account is connected when none are
- **Screen / width:** Settings, all widths
- **Expected:** Real health (connected, error, never-synced), which workspace or address it is, and reconnect/disconnect actions. System and Agent aren't accounts a user connects.
- **Actual:** Slack, Google Calendar, System, Gmail and Agent all show a green "Connected" (`Settings.tsx:224` maps `state === "active"`). The hub log at the same moment says `adapter registry ready … connected: 0`.
- **Repro:** `?screen=settings`.
- **Screenshots:** `s6-settings-1440.png`, `s6-settings-390.png`
- **Fix:** Drive the pill from `accounts.last_health_at` and `last_error` (both are in the Zero schema). Hide the `system` and `agent` pseudo-accounts. Show `accounts.display`.

### L-21 — The PWA is an inbox you can't open
- **Screen / width:** PWA, 390
- **Expected:** On the phone Logan approves things and skims summaries.
- **Actual:**
  - Tapping a row does nothing (`App.tsx` only stores `selectedId`).
  - Today, Tasks, Network and Notes are empty bodies; only the install card shows.
  - There is no Agents or Approvals tab.
  - The manifest's only icon is an SVG and there is no `apple-touch-icon`, so an iOS home-screen install gets a page screenshot as its icon.
- **Repro:** Open :5174 at 390 with mobile emulation. Tap a row, then tap each tab.
- **Screenshots:** `s8-pwa-row-tap-390.png`, `s8-pwa-tab-tasks-390.png`, `s8-pwa-tab-today-390.png`
- **Fix:**
  - `apps/web/src/App.tsx`: open an approval sheet or thread on tap; swap an empty tab for "Approvals".
  - Add `apps/web/public/apple-touch-icon.png` (180×180) plus 192/512 PNG icons to `manifest.webmanifest`.

### L-22 — Labels can be filtered but never applied
- **Screen / width:** Inbox and Thread, all widths
- **Expected:** `l` or a row menu item adds or removes a label on the selected thread.
- **Actual:** The row "More actions" menu has only Open and Archive. The thread pane has no label control. `l` is resolved by the keymap but handled nowhere. The label filter chip works (add and remove), but nothing can put a label on a thread.
- **Repro:** Hover a row, open "⋯".
- **Screenshot:** `s2-row-more-menu-1440.png`
- **Fix:**
  - `packages/ui/src/components/context-menu.tsx` entries plus a label popover (reuse the FilterChipBar popover list).
  - A hub `POST /api/threads/:id/labels`.
  - Handle `label` in `Inbox.tsx`.

### L-23 — One reply, three surfaces, no destination
- **Screen / width:** Thread, all widths
- **Expected:** One draft with one set of actions, stating where it goes.
- **Actual:** "Yes, I will review it today." appears in three places:
  1. a Draft item in the conversation
  2. an approval card ("Reply to #omnis-launch?": Approve / Edit & approve / Ignore)
  3. a Draft card ("Drafted from memory, past threads": Edit & send / Discard / Regenerate)

  The row preview shows it a fourth time ("Draft: …"). The header says "To: me" on a Slack channel. Logan can't tell which button actually sends.
- **Repro:** Open `#omnis-launch`.
- **Screenshots:** `s3-slack-thread-1440.png`, `s3-draft-card-1440.png`
- **Fix:** In `Thread.tsx`, fold the draft card and its approval into one card (the approval *is* the send), and show the destination ("Slack · #omnis-launch"). Derive "To:" from the channel kind in the thread header.

### L-24 — Digest shows a three-week-old digest as tonight's
- **Screen / width:** Digest and Today, all widths
- **Expected:** "No digest yet tonight" or tonight's date.
- **Actual:** On 2026-09-21 the Digest heading is "August 31 night digest, nothing archived", and Today says "Nightly digest ready · 0 archived".
- **Repro:** `?screen=digest` and `?screen=today`.
- **Screenshots:** `s12-digest-empty-1440.png`, `s6-today-1440.png`
- **Fix:** In `apps/desktop/src/screens/Digest.tsx` and `Today.tsx`, treat a digest older than the last night boundary as "none", or print its age ("Last digest: Aug 31").

## Minor

### L-25 — Draft card buttons are unstyled
- **Where:** Thread draft card, 1440
- **Actual:** "Edit & send", "Discard" and "Regenerate" render as default native buttons (grey bevel, 1px black border) jammed together. Nothing else in the app looks like that.
- **Screenshot:** `s3-draft-card-1440.png`
- **Fix:** In `packages/ui/src/components/draft-card.tsx`, use the shared `button.tsx` variants. The draft-card class set is likely also missing from `app.css`.

### L-26 — Approval card doesn't fit and doesn't say enough
- **Where:** Approval card, 420px pane (1440), 320px pane, 390
- **Actual:**
  - At the default 420px pane, "Edit & approve" wraps to two lines, making that button twice the height of its row-mates.
  - At the 320px minimum pane and at 390, "Ignore" is pushed past the card's right edge and clipped.
  - The headline "Send needs your approval" names neither the person nor the thread.
  - "Send" is the verb even for "Put the Friday 14:00 design review on the calendar?".
- **Screenshots:** `s11-min-1440.png`, `s1-inbox-390.png`, `s0-inbox-1440.png`
- **Fix:** `approval-card.tsx`: `flex-wrap` the actions (or collapse to Approve plus a "⋯" menu), shorten the label to "Edit", and put "{person} · {channel}" in the headline.

### L-27 — Hover card fights everything
- **Where:** Row hover card, 1440 and 390
- **Actual:**
  - With the row "⋯" menu open, the row hover card still opens and lands on top of the approval card's buttons.
  - With the pane collapsed, the hover card renders at x<0, half off-screen behind the rail.
  - At 390, a tap leaves a hover-card fragment ("Dana Lee has… ogle Calendar now") stuck at the left edge.
- **Screenshots:** `s2-row-more-menu-1440.png`, `s11-collapsed-1440.png`, `s1-row-tapped-390.png`
- **Fix:** In `inbox-row.tsx`, suppress the hover card while a menu is open and on touch input, and clamp its position to the viewport (or use the floating-ui `flip`/`shift` middleware if it's installed).

### L-28 — Row menu ignores Escape
- **Where:** Row "More actions" menu, 1440
- **Actual:** Escape leaves the menu open. It stayed open through a rail drag afterwards.
- **Screenshot:** `s2-rail-dragging-1440.png`
- **Fix:** Add an Esc/outside-click close to `packages/ui/src/components/context-menu.tsx`.

### L-29 — Approval counts disagree
- **Where:** Counts, all widths
- **Actual:**
  - At load the pill says "Needs approval 7" while the stack shows 1 + "7 more waiting" = 8. The pill counts threads, the stack counts approvals.
  - After archiving a thread with a pending approval, the pill drops to 6 but the approval stays in the stack.
  - Today says "6 approvals pending" while the Inbox pill says 5.
- **Screenshots:** `s0-inbox-1440.png`, `s6-today-1440.png`
- **Fix:** One selector for "pending approvals" (`pending_approvals.state = 'pending'`) used by `Inbox.tsx` pills, `ApprovalStack` and `Today.tsx`. Decide whether archived threads count, and apply that everywhere.

### L-30 — Rail "Agent" and the Agents tab disagree
- **Where:** Rail, 1440
- **Actual:** Rail Agent shows 1 session. The Agents tab shows 6. Rail Slack lists agent sessions like "Label rule cleanup". The rail filters by the account's channel; the tab filters by thread kind.
- **Screenshot:** `s2-rail-agent-1440.png`
- **Fix:** In `Inbox.tsx` `channelFiltered`, map `kind = 'agent_session'` threads to the `agent` channel regardless of account. The shots fixture files sessions under the Slack account, but so could a real bridge.

### L-31 — Agent states contradict themselves
- **Where:** Agents list, 1440
- **Actual:** In the "Blocked" group, `claude_code · inbox-draft`'s last line is "✓ Turn completed". Every omnis session wears the same black "O" avatar, so the list can't be scanned by agent.
- **Screenshot:** `s4-agents-list-1440.png`
- **Fix:** Show "Waiting on: {approval description}" as the preview for blocked sessions. Use a runtime glyph or purpose initial in `inbox-row.tsx` for agent rows.

### L-32 — Header layout jumps; empty views are blank
- **Where:** Inbox header, 1440
- **Actual:**
  - Adding a label filter inserts the chip *before* the pills, shoving the whole strip ~134px right.
  - An empty filter result (Personal + launch) or an empty Archived view shows a blank card with no message.
  - The "Updated now · 1 unread" subline disappears in both cases, so the pills jump up 22px.
- **Screenshots:** `s2-label-chip-1440.png`, `s12-empty-filter-1440.png`, `s7-after-unarchive-1440.png`
- **Fix:** In `filter-chip-bar.tsx`, put chips after the pills (or on their own reserved slot). In `Inbox.tsx`, add a "Nothing matches — clear filters" / "Nothing archived" empty state and keep the subline mounted.

### L-33 — Rail identity and active state
- **Where:** Rail, 1440
- **Actual:**
  - The System channel's glyph is the same gear as the Settings button at the bottom of the rail.
  - On Today or Settings the Inbox tile still shows as active.
  - The Account and Settings tiles are permanently disabled but look clickable.
  - The trailing "⌄" tile has no visible purpose.
- **Screenshots:** `s6-today-1440.png`, `s6-settings-1440.png`
- **Fix:** In `packages/ui/src/components/channel-glyph.tsx`, give System a distinct glyph. `channel-rail.tsx`: reflect the current screen and hide or explain the disabled tiles.

### L-34 — Network person card is wrong
- **Where:** Network, 1440
- **Actual:** Dana Lee shows "Messages 0" above two conversations. "omnis launch sync" (a calendar event) shows a Gmail glyph. "This is the same person" floats alone at the bottom-left with nothing selected and answers "Merging two people isn't wired up yet."
- **Screenshots:** `s6-network-person-1440.png`, `s6-network-merge-1440.png`
- **Fix:** Compute the message count in `Network.tsx` `PersonDetail` from the same items as the conversations. Take the glyph from each thread's account channel. Hide the merge action until it works (L-35).

### L-35 — Roadmap jargon in the product
- **Where:** Copy, all widths
- **Actual:** "Phase B" badges in the AI panel, a "Thread required" badge, the Reply tooltip "Not wired up yet — Phase B", and "Merging two people isn't wired up yet."
- **Screenshots:** `s1-ghost-panel-1440.png`, `s3-ask-panel-1440.png`
- **Fix:** In `ask-panel.tsx`, `channel-rail.tsx`, `command-palette.tsx`, `Thread.tsx` and `Network.tsx`: hide unbuilt actions, or say "Coming soon" without internal phase names.

### L-36 — Thread header wastes space and repeats itself
- **Where:** Thread header, 1440
- **Actual:**
  - About 120px of empty glass sits above the floating Reply/Archive/⋯ pill.
  - The title is printed twice (the "#omnis-launch / To: me" line and then an H2 "#omnis-launch").
  - The Summary tab shows the draft reply text, not a summary.
- **Screenshot:** `s3-slack-thread-1440.png`
- **Fix:** In `packages/ui/src/components/thread-toolbar.tsx`, `detail-pane.tsx` and `Thread.tsx`: put the toolbar in the pane's top row next to the collapse chevron, drop the H2 when the person line already carries the title, and only fill Summary from `meta.summary` when `summary_source` isn't a draft.

### L-37 — 390 chrome is heavy and loose
- **Where:** Shell chrome, 390
- **Actual:**
  - The ask bar row (54px) plus the channel bar (57px) stack to ~122px of bottom chrome on an 844px screen.
  - The ⌘K results panel floats mid-screen, detached from the ask bar with a gap, narrower than the screen.
  - "Compose" is permanently disabled.
  - The Settings segmented control wraps "Model tiers" onto two lines.
- **Screenshots:** `s5-search-390.png`, `s6-settings-390.png`, `s6-today-390.png`
- **Fix:** `bottom-bar.tsx`: fold the ask field into the channel bar, or collapse the channel bar to icons within the same row. `ask-panel.tsx`: anchor the panel to the bar at narrow widths. Hide Compose until it works. Shorten the label to "Models".

### L-38 — Resize artifacts
- **Where:** Inbox header at 600–640px and 890px
- **Actual:**
  - From 640px down to 600px, "Archived" and "+ Label" sit past the right edge (clipped). At 590 the strip collapses to icons and they return, so the collapse threshold is ~50px too late.
  - At 890px the pane is caught mid-slide (x=101, width 773) on a width change.
- **Screenshots:** `s9-resize-890.png`, `s9-resize-560.png`
- **Fix:** In `apps/desktop/src/app.css`, raise the `@container list` icon-collapse breakpoint from 560 to ~650. Skip the pane enter-transition on resize, not on open.

### L-39 — Desktop bundle has no viewport meta
- **Where:** Desktop bundle, phone
- **Actual:** `apps/desktop/index.html` lacks `<meta name="viewport">`. With mobile emulation the whole desktop layout renders at 980px, zoomed out to unreadable.
- **Screenshot:** `s1-row-tapped-390.png` (the first capture, taken with mobile emulation, before the rest of the 390 set was shot as a narrow window)
- **Fix:** Add `width=device-width, initial-scale=1` to `apps/desktop/index.html`.

## Polish

### L-40 — Budget bar reads backwards
- **Screenshot:** `s6-settings-model-tiers-1440.png`
- **Actual:** "$0 used" with a "90%" label and a hatched block at the right end of an empty bar. It reads as "90% used" until you work out that it's the warning threshold. The `img` alt says "0% of $60", which is correct.
- **Fix:** Label the tick "Warn at 90%", or move it below the bar (`Settings.tsx`).

### L-41 — Korean comments in shipped source
- **Actual:** 18 files under `apps/*/src` and `packages/*/src` carry Korean comments, breaking the repo's English-only rule. This excludes the legitimate `packages/ui/src/i18n/ko.ts` locale. Examples: `apps/desktop/src/hooks/use-keymap.ts`, `apps/desktop/src/screens/AgentSession.tsx`, `apps/desktop/src/api/threads.ts`, `packages/ui/src/i18n/en.ts`, `packages/ui/src/lib/relative-time.ts`, `packages/kernel/src/identity.ts`.
- **Repro:** `grep -rlP '[\x{AC00}-\x{D7A3}]' apps/*/src packages/*/src`
- **Fix:** Translate the comments, and add the grep as a lint step.

### L-42 — Today doesn't brief
- **Screenshot:** `s6-today-1440.png`
- **Actual:** Approvals are bare text pills (no person, channel or thread). There are no agent states (two working, two blocked), no unread-from-VIPs, and no summaries. The headline counts the same six approvals twice ("6 items to handle today, 6 approvals pending").
- **Fix:** In `Today.tsx`, render approvals with `ApprovalStack` rows (person · channel), add an "Agents" block with `StatusPill`, and make "items" mean something other than approvals.

### L-43 — Search is thin
- **Screenshot:** `s5-search-dana-1440.png`
- **Actual:** "Dana" returns only the person. None of the three threads mentioning Dana Lee come back, and hits carry no channel glyph or time. The "no results" state is unverified: the capture shows the palette closed because `⌘K` toggles it.
- **Fix:** In the hub `/search`, include threads whose participants match. In `ask-panel.tsx`, render `ChannelGlyph` and a relative time per hit.

### L-44 — Two test stacks in one worktree corrupt each other
- **Actual:** `tools/e2e/stack.ts` hardcodes `DB_NAME = "omnis_e2e"`, the ports 8787/4848/5173 and `.tmp/zero-replica.db`. A parallel user-test session in the same worktree rewrote my replica file mid-run, and zero-cache died with `WrongReplicaVersion`. zero-cache also failed on the default Node 26, and ran on Node 22.
- **Fix:** Read the DB name, ports and replica path from env in `stack.ts` (default to the current values). Pin Node 22 in `.nvmrc` or `engines`.

---

## What worked (keep it)

- Filter pills, label-filter popover (searchable, ✓ state), chip remove.
- Rail drag-reorder: smooth, persisted across reload.
- Archived view plus `u` to restore; clicking a palette thread hit opens it, archived threads included, with a "Restore" banner.
- Approve confirm dialog: focus lands on the confirm button, Enter works.
- Detail pane at 1440: `⌘\` collapse/expand, drag wider (to 678) with the list reflowing, clamps at 320 min, ArrowLeft on the separator (valuenow 400), double-click reset to 420, width persisted across reload.
- 390 Filters sheet: clean and complete (Show / View / Labels).
- Page-level horizontal overflow stayed at 0px across the whole 1440→390 sweep, except the clipped-control cases above.

## How this was run

`tools/e2e/.tmp/logan-boot.ts` (untracked) boots the same stack as `shots.ts` on `omnis_test_loop_r1`, with its own zero replica file, the desktop dev server on :5173 and the PWA on :5174. It then runs `seed()`, `varyInboxCopy()` and the `shots.ts` densify fixture. Each scenario was a Playwright script driving real clicks and keys, logging network writes, DB state and the aria snapshot. The 390 desktop shots are a 390-wide window without mobile emulation (as the existing shot tools do). The PWA shots use mobile emulation. Note that the approval and archive actions above changed the seeded state as the session went on, so counts in later screenshots differ from the first ones.
