# Loop r2: newcomer user test

**Persona:** first day after connecting Slack and Gmail. Doesn't know shortcuts, reads every label, uses the mouse, gets lost easily, and judges polish against Apple Mail, Superhuman and Linear.
**Build:** `plan/loop-r2` @ `cca0c7b` (main after the loop r1 merge), seeded with `tools/e2e/seed.ts` + `varyInboxCopy()` + `densify()` (8 pending approvals, 10 agent sessions in all four states).
**How:** `OMNIS_E2E_DB=omnis_test_loop_r2_newcomer OMNIS_E2E_PORT_OFFSET=300 ZERO_SHARD_NUM=11 pnpm tsx tools/e2e/hold.ts --web` (desktop :5473, PWA :5474). A headless Chromium stayed up over CDP so one page kept its state across steps. Every scenario was run at 1440×900 and 390×844, and where it mattered the result was checked in the DB (`pending_approvals`, `tasks`) or in the network log.
**Screenshots:** `docs/design/loop/r2/test-newcomer/`, named `s<scenario>-<what>-<width>.png`.

## Verdict

The round focus is mostly unmet. What a newcomer notices first:

- **Replying:** still impossible. Worse, the approval card's **Edit** and **Respond** buttons now *decide the approval* the moment you click them, with no editor, no confirmation and no undo (NC2-01, NC2-02). Of all the findings, this one breaks trust fastest: "Edit" sends the message unchanged.
- **The draft is not the approval:** one reply shows up as three unconnected things, a "Draft" bubble, a "Reply to #omnis-launch?" approval card with no body, and a "Drafted from memory" card whose buttons are unstyled and do nothing (NC2-03, NC2-04). Nothing says where a reply would go (NC2-05).
- **Agent observability:** a blocked session still says "nothing to decide here yet" while its own approval waits in the queue, and every session pane shows less than its row does (NC2-06, NC2-07).
- **One approval count:** three numbers disagree on the first screen (8 / 7 / "7 more"), and they drift further apart with every archive: 8 / 2 / "7 more" (NC2-08).
- **Keyboard:** undo is a toggle, so pressing it twice re-archives the thread (NC2-09). Switching screens never focuses the heading, and closing ⌘K leaves focus in the input (NC2-10, NC2-11).
- **Connection state:** the Inbox says "Updated now" while sync has never connected; the only banner is on Today, and it says "offline" (NC2-13). There are no skeletons anywhere.
- **Phone:** the reply buttons sit below the bottom of the fully raised sheet, the ask sheet hides its own input and swallows typing, and the Filters sheet's "Archived threads" row can't be tapped (NC2-14, NC2-15, NC2-16).

What held up (checked, not assumed):

- Rail drag-reorder persists across reload (`s2-rail-dragging-1440.png`, `s2-rail-reordered-1440.png`).
- Adding and removing a label chip filters correctly (`s2-add-label-popover-1440.png`, `s2-label-added-1440.png`, `s2-label-removed-1440.png`).
- Desktop archive and restore both show a toast with Undo ("Archived", "Moved to Inbox"). A failed archive says "Couldn't archive. It's back in your inbox." with Retry, in a polite live region.
- The Archived view retitles the card "Archived". Restore works from the row's hover action (`s7-archived-view-1440.png`, `s7-restored-1440.png`).
- Approve asks for confirmation. Ignore gives an undoable toast (`s4-approved-1440.png`, `s4-ignored-1440.png`).
- Pane resize is clamped to 320–720 px, works with the arrow keys (16 px steps) and survives reload. ⌘\ and the palette's "Toggle detail pane" both collapse it (`s11-grip-hover-1440.png`, `s11-drag-wide-1440.png`).
- ⌘K: Enter on a hit opens it, and a person hit opens the person (`s5-person-opened-1440.png`, `s5-jump-thread-1440.png`).
- Escape from an open thread puts focus back on its row. Tab from a row reaches the pane in one step, where r1 needed 27 (`s10-tab-into-pane-1440.png`).
- Today's approval chips now expand into an inline card.
- Tasks' failed-write message keeps the typed text in the box.
- The Settings autonomy switch asks before enabling.
- Page-level horizontal overflow stays at 0 px for every width from 1440 to 390 in 10 px steps.

**Fixture caveats (not counted as findings):** `densify()` attaches its approval asks to threads in creation order, so a Calendar event carries a "Send" approval and the system cost notice carries "Share the Brightstone purchase agreement". `varyInboxCopy()` gives #omnis-launch a Brightstone summary over a "can you review the PR?" conversation. A real user would never see those pairings. What a real user *would* see is that nothing on the card tells them where the action goes, so they can't tell a sensible approval from a wrong one (NC2-05).

## Findings

| ID | Screen | Width | Severity | Summary |
|---|---|---|---|---|
| NC2-01 | Approval card (pane, thread, Today) | all | blocker | **Edit** decides the approval immediately (`decision=edit`, args unchanged). No editor, no confirm, no undo; the toast says "Approved" |
| NC2-02 | Approval card (pane, thread, Today) | all | blocker | **Respond** decides the approval immediately with an empty response. There is no field to type it in |
| NC2-03 | Thread / ask bar / bottom bar | all | blocker | Still no way to reply. Reply and Compose are disabled with a "Not wired up yet — Phase B" tooltip, "Edit & send" does nothing, and the ask bar can't draft |
| NC2-04 | Thread | all | major | One reply appears three times: Draft bubble, an approval card with no body, and a "Drafted from memory" card with unstyled buttons. Deciding one leaves the other two |
| NC2-05 | Approval card, confirm dialog | all | major | "Send needs your approval": no channel, no recipient, no message body. The confirm dialog only repeats the question |
| NC2-06 | Agent session (blocked) | all | major | A blocked session says "nothing to decide here yet" while its approval is in the queue. Another blocked session ends in "✓ Turn completed" |
| NC2-07 | Agent session (working/done/idle) | all | major | The pane shows less than the row: "no output yet" vs "(2/3)", "No activity recorded" vs "Finished folding in 6 false positives". No cost, no stop, tool calls don't expand |
| NC2-08 | Inbox header, tab, pane | all | major | Three approval counts that disagree (8 / 7 / 7 more → 8 / 4 → 8 / 2). Approvals on archived threads keep waiting in the pane |
| NC2-09 | Inbox undo | 1440 | major | Undo toggles: a second `z` or ⌘Z re-archives the thread you just restored. Focus after undo stays on the next row |
| NC2-10 | Shell | 1440 | major | Switching screens (`g t`, `g k`, rail click) leaves focus on BODY or the rail button, never on the new screen's heading |
| NC2-11 | ⌘K / ask bar | 1440 | minor | Closing the palette with Esc leaves focus in the ask input instead of returning it to the row |
| NC2-12 | Ask bar | 1440 | major | With the model menu open, one Esc closes the menu, the panel, the typed text **and the open thread** |
| NC2-13 | Inbox, Today, search | all | major | No connection state: the Inbox shows "Updated now" with sync never connected, Today alone says "offline", search says "No results" when the hub is down, and there are no skeletons |
| NC2-14 | Detail sheet | 390 | major | The fully raised sheet is 65 px taller than the screen, so "Edit & send"/"Discard" can't be reached. At half height the sheet can't scroll to its approval card |
| NC2-15 | Ask sheet | 390 | major | The ask sheet covers its own input. Typed text goes nowhere (value stays empty), and it lists `g i` shortcuts on a touch screen |
| NC2-16 | Filters sheet | 390 | major | "Archived threads", Labels and "Archive all" are visible but the overlay intercepts the tap |
| NC2-17 | PWA | 390 | major | Rows still can't be opened by tapping. "Got it" on the install card doesn't stick, and the card names Safari in any browser. No approvals anywhere |
| NC2-18 | Tasks | all | major | A task added on the **Today** tab says "Added to Tasks" and vanishes: it was filed under Someday |
| NC2-19 | Notes → Inbox | all | major | "Couldn't find a routing target — pick one manually" with no picker, then an inbox row: "Automatic processing failed (note_route). Please check it manually." |
| NC2-20 | Network | all | major | The lone "This is the same person" button is still there (would merge the owner with Dana Lee). The person pane says "Messages 0" beside two conversations |
| NC2-21 | Digest / Today | all | minor | Today's "Nightly digest ready" opens a three-week-old "August 31 night digest" that says "Nothing was auto-archived today". Nothing on it can be acted on |
| NC2-22 | ⌘K search | 1440 | minor | Text shown in row summaries isn't searchable ("brightstone" → no results); "review" lists "PoC review" twice; "Dana" finds the person but none of her threads |
| NC2-23 | ⌘K commands | 1440 | minor | Only navigation plus "Toggle detail pane". Typing in the Commands tab jumps to Search ("No results for archive"); the `>` prefix is never shown |
| NC2-24 | Inbox hover card | 1440 | minor | The row hover card still opens over the detail pane and hides the thread you just opened; near the bottom it's clipped by the viewport |
| NC2-25 | Keyboard help | 1440 | minor | `?` does nothing. The Undo toast has no key hint, so `z` is undiscoverable |
| NC2-26 | Empty states | all | minor | A channel filter with no rows and an empty Archived view both render a blank card; the Archived header drops its subline |
| NC2-27 | Rail: Slack | all | minor | The Slack filter lists five agent sessions; with #omnis-launch archived it shows only agent sessions |
| NC2-28 | Rail / bottom bar | all | minor | Channel tiles have no tooltip or title. The rail says "Agent", the tab says "Agents". At 390 the bottom bar never marks Today, Tasks or Settings as current |
| NC2-29 | omnis identity | all | minor | Three different omnis marks: the real mark (rail, Settings), an "OM" pastel monogram (notices) and a black "O" tile (sessions on "omnis on mini"). Settings lists omnis as a connected account |
| NC2-30 | Thread (Slack) | all | minor | Messages have no sender or time; "To: me" on a channel; the title is printed twice; the floating toolbar overlaps the title once the pane scrolls |
| NC2-31 | Archive on phone | 390 | minor | Archive from the sheet shows no toast (desktop does), keeps the sheet open with an "Archived · Restore" strip, and doesn't advance to the next row |
| NC2-32 | Draft card | all | minor | "Edit & send / Discard / Regenerate" render as unstyled browser buttons with black borders, the only raw controls in the app |
| NC2-33 | Filter chip bar | 600–640 | minor | The chip row runs past the card: Archived is half cut, "+" is hidden, and nothing hints that it scrolls |
| NC2-34 | Settings | all | minor | Accounts say "Connected" and nothing else (no address, last sync or manage). The autonomy confirm appears ~600 px below the switch, with its buttons in the opposite order to the Approve dialog. The kill switch shows on two tabs |
| NC2-35 | Inbox rows | all | minor | "claude_code · inbox-draft" as a title, unexplained orange dots, a "Draft:" prefix, two identical "omnis launch sync" rows, and rows that jump position after a decision |
| NC2-36 | Keyboard selection | 1440 | polish | j/k move the selection but the pane keeps showing the queue until Enter. The first `j` after the skip link only selects row 1 |
| NC2-37 | Collapsed pane | 1440 | polish | The expand chevron sits inside the ask bar (r1 NC-29, unchanged) |
| NC2-38 | Row states | 1440 | polish | The status pill disappears on the hovered row; two rows can look hovered at once; list content scrolls under the sticky tab row with no fade |
| NC2-39 | Wrapping | 320 pane, 390 | polish | At a 320 px pane, "Ignore" wraps to its own line; at 390, "Model tiers" wraps inside the Settings segmented control |
| NC2-40 | Ask bar model picker | 1440 | polish | "Auto / DeepSeek V4.1 Flash / Claude Sonnet 5" is offered to a first-day user with no explanation |
| NC2-41 | Today copy, screen titles | all | polish | "Good morning" at 00:40, "4 items to handle today" names no items besides the approvals, and the title size changes between screens (28 px Inbox, 20 px elsewhere) |

---

## NC2-01: Edit on an approval card sends it unchanged
**Screen:** approval card in the pane queue, inside a thread, and on Today · **Width:** all · **Severity:** blocker

**Expected:** "Edit" opens the message in an inline editor, prefilled with the draft, with Send and Cancel. Nothing is decided until Send.
**Actual:** the click POSTs `/approvals/:id/decide` straight away. The DB row reads `state=decided, decision=edit, decided_args={"body": "Yes, I will review it today.", "channel": "slack"}`, identical to `args`. The toast says "Approved: Reply to #omnis-launch" and offers no undo. Approve asks "Approve this action?" first, but Edit, which is supposed to be the *safer* button, sends without asking.
**Repro:** 1440 → click the #omnis-launch row → scroll the pane to the "Reply to #omnis-launch?" card → Edit. Then `SELECT state, decision, decided_args, args FROM pending_approvals WHERE description = 'Reply to #omnis-launch?'`.
**Screenshot:** `s3-draft-area-1440.png` (before), `s3-approval-edit-1440.png` (after: toast "Approved", card gone).
**Proposed fix:** `packages/ui/src/components/approval-card.tsx:65` calls `onDecide("edit", interrupt.args)`. Make Edit swap the card body for an inline editor (the draft card's editor once NC2-04 folds them together). Decide only on Send, with `decided_args` set to the edited body. Add a unit test: Edit alone must never call `onDecide`.

## NC2-02: Respond decides with an empty response
**Screen:** approval card (pane, thread, Today) · **Width:** all · **Severity:** blocker

**Expected:** "Respond" opens a text field for a reply to the agent ("use the Tuesday slot instead"), sent on Enter.
**Actual:** one click decides it: `decision=respond, decided_args=NULL`. The approval disappears from Today with no toast and no undo. The agent gets a "respond" with nothing in it.
**Repro:** 1440 → Today → click the "Confirm the offsite venue for the 12th?" chip → Respond. `SELECT decision, decided_args FROM pending_approvals WHERE description LIKE 'Confirm the offsite%'`.
**Screenshot:** `s6-today-chip-click-1440.png` (card open), `s6-today-respond-1440.png` (gone, count 5 → 4).
**Proposed fix:** `approval-card.tsx:70` (`onDecide("respond", undefined)`) and the `respond` branch in `apps/desktop/src/App.tsx:409`. Respond should open a one-line composer, and decide with `{ response: text }` only when the text is non-empty. Show an outcome toast on Today as well as in the pane.

## NC2-03: There is still no way to reply
**Screen:** thread toolbar, draft card, ask bar, phone bottom bar · **Width:** all · **Severity:** blocker

**Expected:** at least one of these works: the thread's Reply, the phone's Compose, the draft card's "Edit & send", or asking the ask bar to "draft a reply".
**Actual:**
- Reply (thread toolbar) is disabled, with the tooltip "Not wired up yet — Phase B".
- Compose (phone bottom bar) is disabled, with the same tooltip, which a touch user never sees. It is the most prominent button on the phone screen.
- "Edit & send" does nothing: no editor, no request.
- The ask bar treats "draft a reply saying I'll review the PR tomorrow" as a search ("No results for …"). Its only thread suggestion is "Summarize this thread".

"Phase B" is internal vocabulary, and a user should never read it.
**Repro:** 1440 → open #omnis-launch → hover Reply (disabled) → scroll to "Drafted from memory" → Edit & send (network log: no request) → click the ask bar, type the sentence, press Enter. 390 → tap the pencil next to the ask bar.
**Screenshot:** `s3-slack-thread-1440.png`, `s3-edit-and-send-1440.png`, `s3-askbar-enter-1440.png`, `s3-askbar-suggestions-1440.png`, `s3-compose-disabled-390.png`.
**Proposed fix:** the r1 BACKLOG put this at the top of r2: a hub "propose send" route, an inline editor in `packages/ui/src/components/draft-card.tsx`, and "Draft a reply" in `packages/ui/src/components/ask-panel.tsx` next to "Summarize this thread". Until it lands, hide Reply and Compose rather than showing disabled buttons, and delete the "Phase B" copy from `packages/ui/src/i18n/en.ts` and `packages/ui/src/components/channel-rail.tsx`.

## NC2-04: The draft and its approval are three separate things
**Screen:** thread · **Width:** all · **Severity:** major

**Expected (round focus):** the draft card *is* the approval: one card showing the draft text, its destination, and Send / Edit / Discard.
**Actual:** the #omnis-launch conversation shows:
1. a "Draft" bubble: "Yes, I will review it today.";
2. an approval card "Send needs your approval / Reply to #omnis-launch?" with Approve / Edit / Ignore, and no text;
3. "Drafted from memory, past threads / Yes, I will review it today." with "Edit & send / Discard / Regenerate".

Deciding the approval (NC2-01) removes only card 2; the bubble and card 3 stay and still offer "Edit & send". A second, unrelated approval ("Put the Friday 14:00 design review on the calendar?") sits between them.
**Repro:** 1440 → #omnis-launch → scroll the pane.
**Screenshot:** `s3-draft-area-1440.png`, `s3-approval-edit-1440.png`, `s3-slack-draft-390.png`.
**Proposed fix:** fold the `send` approval whose `args.body` matches the thread's draft into `draft-card.tsx` (approval id as a prop). Render the draft once, drop the separate bubble, and let the card's buttons be the decide buttons. `apps/desktop/src/screens/Thread.tsx` owns the merge.

## NC2-05: An approval never says where it goes
**Screen:** approval card, approval stack, Approve confirm dialog · **Width:** all · **Severity:** major

**Expected:** before I approve a send I can see: the channel (Slack icon plus #omnis-launch), the recipient, and the message body. Apple Mail and Superhuman show To: and the body.
**Actual:** every card says "Send needs your approval" plus a question. The confirm dialog says "Approve this action? / Share the latest Brightstone purchase agreement? / Cancel / Approve". The queue rows say "Send · Reply on omnis launch sync?". `args.channel` and `args.body` exist on every approval but none of them is shown, so a newcomer can't tell that a Calendar event's "Send" (fixture) is wrong.
**Repro:** 1440 → first load → look at the pane → Approve.
**Screenshot:** `s0-first-load-1440.png`, `s4-approve-click-1440.png`.
**Proposed fix:** `packages/ui/src/components/approval-card.tsx` and `approval-stack.tsx`: a header row with `ChannelGlyph` + destination (the thread title or `args.to`), the body in a quoted block (clamped to 4 lines with "Show all"), and the same header in `confirm-prompt.tsx`.

## NC2-06: A blocked session doesn't say what it waits on
**Screen:** agent session · **Width:** all · **Severity:** major

**Expected (round focus):** a Blocked session shows the approval it is waiting for, inline and decidable, or at least links to it.
**Actual:**
- "Invoice reissue reply": the row says "Waiting for approval of the reply wording", and the queue holds "Answer the invoice reissue request with 'I will check and get back to you'?". The session pane says **"Blocked · nothing to decide here yet"**.
- "claude_code · inbox-draft": Blocked, and the transcript ends in "✓ Turn completed". Nothing explains what blocks it.
**Repro:** 1440 → click either Blocked row.
**Screenshot:** `s4-agent-blocked-invoice-1440.png`, `s4-agent-blocked-claude-1440.png`, `s4-agent-blocked-390.png`.
**Proposed fix:** `apps/desktop/src/screens/AgentSession.tsx`: look up pending approvals by `requested_by` (the runtime) or `thread_id`, and render the approval card under the header. When none is found, say *why* the session is blocked ("Waiting for …" from the session's status line) rather than "nothing to decide". The seed should link the invoice approval to its session (`densify()` in `tools/e2e/shots.ts`) so this stays tested.

## NC2-07: A session pane shows less than its row
**Screen:** agent session · **Width:** all · **Severity:** major

**Expected:** opening a session shows at least what the row says, plus progress, cost so far, the tool calls (expandable), and a Stop control for a running session.
**Actual:**

| Session | The row says | The pane says |
|---|---|---|
| Drafting 3 inbox replies (Working) | "Writing drafts for 3 received mails (2/3)" | "Working · no output yet" |
| Spam filter training (Done) | "Finished folding in 6 false positives" | "No activity recorded for this session." |
| Calendar conflict watch (Idle) | "Waiting for the next check" | "No activity recorded for this session." |

There is no cost anywhere and no way to stop a Working session. The one tool call ("Reading ✓ index.ts main.ts") is a static `div`, and clicking it does nothing.
**Repro:** 1440 → scroll the list → click each session.
**Screenshot:** `s4-agent-working-1440.png`, `s4-agent-done-1440.png`, `s4-agent-idle-1440.png`, `s4-tool-expanded-1440.png`.
**Proposed fix:** `AgentSession.tsx`: render the session's status line as the first transcript entry when the transcript is empty, and make `.tool-call-badge` a disclosure button when it has input or output. Add Stop for `running`. Cost needs a Zero column, so leave it out until then, as r1 decided.

## NC2-08: Three approval counts that disagree
**Screen:** Inbox subline, "Needs approval" tab, pane queue · **Width:** all · **Severity:** major

**Expected (round focus):** one number, from one selector, everywhere.
**Actual:**

| Moment | Subline | Tab | Pane |
|---|---|---|---|
| First load | 8 need approval | 7 | 1 + "7 more waiting" |
| After archiving 3 threads | 8 | 4 | 1 + "7 more" |
| After archiving 2 more (390) | 8 | 2 / 1 | — |
| During an Ignore's 5 s undo window | 5 | 6 | 1 + "4 more" |

The tab counts non-archived threads that have an approval (`pendingCount`, `Inbox.tsx:833`). The subline counts pending approvals (`Inbox.tsx:882`), the pane lists all of them, and archiving a thread does nothing to its approval. The "Needs approval" tab showed 2 rows while the pane held 8 approvals.
**Repro:** 1440 → first load → read the three numbers → archive three rows with `e` → read them again.
**Screenshot:** `s0-first-load-1440.png`, `s1-kb-archive-3-1440.png`, `s1-archive-sheet-390.png`, `s2-tab-needs-approval-1440.png`, `s4-ignored-1440.png`.
**Proposed fix:** one selector (say `usePendingApprovals()` in `apps/desktop/src/App.tsx`) that treats an approval deferred for undo as already gone and reads the same rows as the pane. Subline, tab pill and Today all read it. Decide separately what archiving a thread does to its approval (a hint on the Archive toast: "1 approval still waiting").

## NC2-09: Undo is a toggle, so a second press re-archives
**Screen:** Inbox · **Width:** 1440 · **Severity:** major

**Expected:** `z` / ⌘Z undoes the last archive once. Pressing it again ("did it work?") does nothing. Focus lands on the restored row.
**Actual:** `e` archives Spam filter training → ⌘Z brings it back → `z` archives it again. The row disappears a second time, and during the run the same thing happened to #omnis-launch and Logan Kim. After an undo, focus stays on the row that followed the archived one, not on the restored row.
**Repro:** 1440 → select a row → `e` → ⌘Z → `z`.
**Screenshot:** `s1-undo-focus-1440.png`.
**Proposed fix:** `apps/desktop/src/screens/Inbox.tsx:582`: `undoArchive` calls `toggleArchive(last.id, !last.archived)` and leaves `lastToggle.current` armed, and the toggle it makes is itself recorded as undoable. Clear `lastToggle.current` before toggling, and don't arm an undo from an undo. Then select and focus `last.id`. The unit test: press undo twice and the second press is a no-op.

## NC2-10: Switching screens never focuses the heading
**Screen:** shell · **Width:** 1440 · **Severity:** major

**Expected (round focus):** after `g t` or a rail click, focus moves to the new screen's heading, so a keyboard or screen-reader user knows where they are.
**Actual:** `g t`, `g k`, `g n`, `g i` → `document.activeElement` is BODY every time. A rail click leaves focus on the rail button.
**Repro:** 1440 → press `g` then `t`, and read `document.activeElement`.
**Screenshot:** `s10-after-g-i-1440.png`.
**Proposed fix:** in `apps/desktop/src/App.tsx`'s screen switch, focus the screen's `h1` (`tabIndex={-1}`) after the transition. Today renders its greeting as the only heading, so give it a visually hidden "Today" `h1`.

## NC2-11: Closing ⌘K leaves focus in the input
**Screen:** ask bar / palette · **Width:** 1440 · **Severity:** minor

**Expected:** Esc closes the palette and returns focus to where it came from (the selected row).
**Actual:** focus stays in the ask input (`INPUT[combobox]`). The next `j` or `e` types into it.
**Repro:** 1440 → select a row → ⌘K → Esc → read `document.activeElement`.
**Screenshot:** `s10-after-palette-esc-1440.png`.
**Proposed fix:** `packages/ui/src/components/ask-panel.tsx` / `command-palette.tsx`: remember `document.activeElement` on open, then blur the input and restore that element on close.

## NC2-12: One Esc with the model menu open loses the thread
**Screen:** ask bar · **Width:** 1440 · **Severity:** major

**Expected:** Esc closes the innermost layer only: the model menu, then the panel, then the thread.
**Actual:** with a thread open, text typed in the ask bar and the "Auto" menu open, a single Esc closes the menu, closes the panel, clears the typed text **and closes the thread**. The pane falls back to the approval queue. Without the menu open, Esc behaves correctly.
**Repro:** 1440 → open #omnis-launch → click the ask bar → type "draft a reply" → click "Auto" → Esc.
**Screenshot:** `s10-esc-model-menu-1440.png`.
**Proposed fix:** the menu's Esc handler has to `stopPropagation`. The shell's Esc handler (`App.tsx`) should ignore events whose target is inside an open menu or popover.

## NC2-13: No connection state and no skeletons
**Screen:** Inbox, Today, search · **Width:** all · **Severity:** major

**Expected (round focus):** a shell-level banner when sync is disconnected, reconnecting or stale ("Can't reach omnis. Showing what we had at 00:31. Retrying…"), skeleton rows while the first sync runs, and search that says it failed, not "No results".
**Actual (Zero websocket held with `page.routeWebSocket`, hub HTTP aborted with `page.route`):**
- The Inbox renders cached rows under "Updated now · 1 unread · 4 need approval" with no banner, after 10 s of never connecting.
- Today alone shows a thin grey "You're offline. Showing the last content we received.", which is wrong because the network is up and only sync is down.
- There are no `aria-busy` or skeleton elements on any screen.
- With the hub down, search says "No results for PoC" when the truth is "search is unavailable".
- Archive and Tasks do report their failures (see "What held up").
**Repro:** see the screenshot names; the route overrides are in the method line above.
**Screenshot:** `s12-sync-pending-10s-1440.png`, `s12-sync-pending-today-1440.png`, `s12-search-fails-1440.png`, `s12-archive-fails-1440.png`, `s12-task-fails-1440.png`.
**Proposed fix:** one connection source in the shell (`apps/desktop/src/zero-client.ts` exposes connection state) → a `GlassSurface` banner above the card on every screen, and move Today's line into it. Make "Updated …" read the last successful sync time, not render time. In `apps/desktop/src/api/search.ts`, distinguish a failed request from an empty result.

## NC2-14: The phone's detail sheet hides its own buttons
**Screen:** detail sheet · **Width:** 390 · **Severity:** major

**Expected:** at every detent everything in the sheet can be scrolled to, like an iOS sheet.
**Actual:** the sheet's container (`.app-shell__detail`) is 844 px tall with `overflow: hidden`, whatever the detent.
- At the first detent it starts at y=422, so the approval card sits below the screen and the wheel doesn't scroll it.
- Dragged to full height it starts at y=67, so its bottom is at 909. The inner scroller has already reached its end, and "Edit & send" sits at y=861, below the 844 px viewport, unreachable.
**Repro:** 390 → tap #omnis-launch → drag the grabber to the top → scroll to the end.
**Screenshot:** `s1-row-open-390.png`, `s1-sheet-scrolled-390.png`, `s1-sheet-dragged-scrolled-390.png`, `s3-slack-draft-390.png`.
**Proposed fix:** `packages/ui/src/components/sheet.tsx`: size the content to `100dvh - top of detent` (or give the content `max-height: calc(100dvh - var(--sheet-top))` and `overflow-y: auto`) and let the first detent scroll.

## NC2-15: The phone ask sheet hides its input and loses typing
**Screen:** ask sheet · **Width:** 390 · **Severity:** major

**Expected:** tap the ask bar → a sheet with the input at its top, the keyboard up, and results below.
**Actual:** the sheet opens over the ask bar and covers the input (still at y=738, under the sheet). Typing "Dana" leaves the value empty, so the keystrokes go nowhere. The sheet lists "Go to Inbox g i", keyboard shortcuts that mean nothing on a phone.
**Repro:** 390 → tap "Start typing to ask or search" → type.
**Screenshot:** `s8-askbar-typed-390.png`.
**Proposed fix:** `packages/ui/src/components/ask-panel.tsx`: at the narrow tier, render the input inside the sheet header and focus it; hide `kbd` hints when `(pointer: coarse)`.

## NC2-16: Rows in the Filters sheet can't be tapped
**Screen:** Filters sheet · **Width:** 390 · **Severity:** major

**Expected:** every visible row of the sheet is tappable.
**Actual:** "Archived threads" (y≈806) is fully visible, but `elementFromPoint` there returns `.sheet-overlay`, so the tap closes nothing and selects nothing. Labels and "Archive all 15 shown" below it are unreachable too. Dragging the sheet up didn't help.
**Repro:** 390 → tap the ≡ button left of the ask bar → tap "Archived threads".
**Screenshot:** `s8-filters-390.png`, `s7-filters-archived-row-390.png`.
**Proposed fix:** `packages/ui/src/components/sheet.tsx` (vaul): the content below the first snap point sits under the overlay. Either open Filters at full height (it is a short, fixed list) or make the content scroll inside the first detent. Separately, "Archive all 15 shown" is a destructive bulk action and doesn't belong in a filter sheet without a confirm.

## NC2-17: The PWA still can't open anything
**Screen:** PWA inbox and Today · **Width:** 390 · **Severity:** major

**Expected:** tapping a row opens the thread; the install card goes away once dismissed; approvals are visible somewhere.
**Actual:**
- Tapping "PoC review" does nothing (r1 L-21/NC-36).
- "Got it" hides the install card until the next navigation, then it's back, and on Today it's the only content.
- The card says "Tap the Share button in Safari's toolbar" in any browser.
- The PWA shows no approvals and no "need approval" count.
- Rows reserve a ~45 px unread gutter, so summaries wrap at 20 characters.
**Repro:** open :5474 at 390 → Got it → tap a row → tap Today.
**Screenshot:** `s8-pwa-inbox-390.png`, `s8-pwa-row-tap-390.png`, `s8-pwa-today-390.png`.
**Proposed fix:** `apps/web/src/components/InstallGuideCard.tsx`: persist the dismissal (`localStorage`) and only show on iOS Safari when not standalone. Opening a row and showing the approvals count are the r1-deferred PWA items; schedule them.

## NC2-18: A task added from Today goes to Someday
**Screen:** Tasks · **Width:** all · **Severity:** major

**Expected:** a task typed while the "Today" tab is selected lands in Today, or the confirmation says where it went, with a link.
**Actual:** "Added to Tasks" appears, and the list still says "Nothing due today". The task only shows up under Someday. To a newcomer it looks lost, which was the exact r1 complaint (NC-05) in a new form.
**Repro:** Tasks → Today tab → "New task…" → "Send Dana comments on the slides" → Enter.
**Screenshot:** `s6-tasks-added-1440.png`, `s6-tasks-someday-1440.png`.
**Proposed fix:** `apps/desktop/src/screens/Tasks.tsx`: pass the active tab's bucket as the due date when creating, or change the confirmation to "Added to Someday" with a "Show" button that switches tab.

## NC2-19: Notes' routing failure is a dead end, with an internal error in the inbox
**Screen:** Notes → Inbox · **Width:** all · **Severity:** major

**Expected:** a note mentioning Dana routes to Dana Lee. If it can't, it offers a picker ("File under…").
**Actual:** "Couldn't find a routing target — pick one manually" appears with nothing to pick with; clicking the note does nothing. A minute later a new omnis row arrives in the Inbox: **"Automatic processing failed (note_route). Please check it manually."** It uses an internal loop name, has no link to the note, and has no action.
**Repro:** Notes → type "Dana prefers comments by Thursday" → Enter.
**Screenshot:** `s6-notes-saved-1440.png`, `s9-resize-1100.png` (the omnis row).
**Proposed fix:** `apps/desktop/src/screens/Notes.tsx`: render a person/thread combobox under the message. In `packages/agents/src/loop/run.ts`, map loop names to user words ("Couldn't file your note 'Dana prefers…'") and attach the note id so the row opens it.

## NC2-20: Network still offers to merge the owner with Dana
**Screen:** Network · **Width:** all · **Severity:** major

**Expected:** merging people starts from a selection with a preview ("Merge Logan Kim into Dana Lee?").
**Actual:**
- "This is the same person" sits alone at the bottom-left of the card and would merge the account owner with Dana Lee (r1 NC-19, not fixed).
- Dana Lee's pane says "Messages 0" next to two conversations.
- "omnis launch sync", a Calendar event, carries a Gmail icon there.
- There is no way to add a note from the person.
**Repro:** Network → look at the bottom-left → click Dana Lee.
**Screenshot:** `s6-network-1440.png`, `s6-network-person-1440.png`.
**Proposed fix:** `apps/desktop/src/screens/Network.tsx`: hide the merge button until two cards are selected, then confirm with both names. Fix the person pane's message count, and use the thread's channel for its glyph.

## NC2-21: Today links to a three-week-old digest
**Screen:** Digest / Today · **Width:** all · **Severity:** minor

**Actual:** Today says "Nightly digest ready · 0 archived", and the card isn't clickable. The Digest screen is titled "August 31 night digest, nothing archived" on September 22 and says "Nothing was auto-archived today." There is nothing to do on it, not even browsing older digests.
**Screenshot:** `s6-today-1440.png`, `s6-digest-1440.png`.
**Proposed fix:** `apps/desktop/src/screens/Digest.tsx` / `Today.tsx`: show the digest's date relative to now ("3 weeks ago"), hide "ready" when it's stale, and make the Today card link to the Digest screen.

## NC2-22: Search misses what the rows show
**Screen:** ⌘K · **Width:** 1440 · **Severity:** minor

**Actual:** "brightstone" → "No results", though the #omnis-launch row's summary says "Brightstone Realty purchase agreement". "review" returns "PoC review" twice. "Dana" returns only the person, not her two threads. (r1 NC-12 search half, deferred.)
**Screenshot:** `s5-search-brightstone-1440.png`, `s5-search-person-1440.png`.
**Proposed fix:** index thread summaries in the hub search (`apps/hub/src/http.ts` search route), dedupe by thread id, and add a "Threads with Dana Lee" group under a person hit.

## NC2-23: The Commands tab only navigates
**Screen:** ⌘K · **Width:** 1440 · **Severity:** minor

**Actual:** the Commands tab lists seven "Go to …" rows and "Toggle detail pane". There is no Archive, Reply, Approve, Mark read or Snooze. Typing "archive" while on the Commands tab flips it to Search ("No results for archive"). Filtering commands needs a `>` prefix the panel never mentions.
**Screenshot:** `s5-commands-1440.png`, `s5-command-archive-1440.png`.
**Proposed fix:** `packages/ui/src/components/command-palette.tsx`: keep typing inside the tab you're on; add the thread actions when a thread is selected; show "Type > for commands" as the input hint.

## NC2-24: The hover card still covers the pane
**Screen:** Inbox · **Width:** 1440 · **Severity:** minor

**Actual:** clicking a row and leaving the pointer on the list opens a hover card at x≈1000 over the detail pane. It hides the tab row and approval card of the thread you just opened. A row near the bottom opens its card off the bottom edge (r1 NC-16/L-27).
**Screenshot:** `s1-open-row-1440.png`, `s1-pane-conversation-1440.png`, `s3-slack-thread-1440.png`.
**Proposed fix:** `packages/ui/src/components/inbox-row.tsx`: don't show the hover card for the selected row, or when the pane is open to the right; use Radix `avoidCollisions` for the bottom edge.

## NC2-25: No shortcut help
**Screen:** keyboard · **Width:** 1440 · **Severity:** minor

**Actual:** `?` does nothing. The Undo toast shows a button but no "Z" hint, so the one shortcut that saves you from a mistake is undiscoverable. The Undo button is 15 Tab presses away.
**Screenshot:** `s1-help-1440.png`, `s1-kb-archive-3-1440.png`.
**Proposed fix:** a `?` sheet listing `DIRECT_KEYS`/`GOTO_KEYS` from `apps/desktop/src/hooks/use-keymap.ts`, and a `kbd` "Z" inside the toast's Undo button (`packages/ui/src/components/toast.tsx`).

## NC2-26: Empty views are blank
**Screen:** Inbox (channel filter, Archived) · **Width:** all · **Severity:** minor

**Actual:** Google Calendar with its three threads archived renders an empty card, with no message and no way back. The empty Archived view does the same and also drops its "Updated …" subline, so the header jumps (r1 NC-15, deferred).
**Screenshot:** `s2-rail-google-calendar-1440.png`, `s7-archive-empty-1440.png`.
**Proposed fix:** an empty state in `apps/desktop/src/screens/Inbox.tsx` ("Nothing from Google Calendar in your inbox · Show archived · Clear filter" / "Nothing archived yet"), and keep the subline's height.

## NC2-27: The Slack filter shows agent sessions
**Screen:** rail → Slack · **Width:** all · **Severity:** minor

**Actual:** Slack lists "Label rule cleanup, Calendar conflict watch, Weekly report collection, Summarizing contract diff, Drafting 3 inbox replies", all agent sessions whose account happens to be Slack. With #omnis-launch archived, the Slack view contains no Slack conversation at all (r1 NC-25).
**Screenshot:** `s2-rail-slack-1440.png`.
**Proposed fix:** the channel filter in `Inbox.tsx` (`channelFiltered`) should exclude `kind = 'agent_session'` unless the tile is Agent.

## NC2-28: Rail and bottom bar don't label or locate
**Screen:** rail, phone bottom bar · **Width:** all · **Severity:** minor

**Actual:**
- The screen tiles got `title`s in r1 ("Today (g t)"), but the channel tiles (Google Calendar, Slack, Gmail, Agent, omnis) and Inbox have none. Hovering the black robot tells you nothing.
- The rail tile says "Agent", the tab says "Agents".
- At 390 on Today, Tasks or Settings, no bottom-bar item is highlighted, because they live under "More", which doesn't mark itself either.
**Screenshot:** `s2-rail-agent-hover-1440.png`, `s6-today-390.png`, `s6-settings-390.png`.
**Proposed fix:** `packages/ui/src/components/channel-rail.tsx` and `bottom-bar.tsx`: a tooltip on every tile, the "More" chevron takes the active state when the current screen lives in it, and use one noun (Agents).

## NC2-29: omnis has three faces
**Screen:** rows, rail, Settings · **Width:** all · **Severity:** minor

**Actual:** the system → omnis rename landed on the rail and in Settings with the mark. But omnis notices use a pastel "OM" monogram, sessions running on "omnis on mini" use a black "O" tile, and Settings lists "omnis — Connected" as if it were an account you connected.
**Screenshot:** `s0-first-load-1440.png`, `s6-settings-1440.png`.
**Proposed fix:** `packages/ui/src/components/inbox-row.tsx` avatar: use the omnis mark for `channel = 'system'` rows and for sessions whose runtime is omnis. Drop omnis from the Accounts list in `apps/desktop/src/screens/Settings.tsx` (or label it "Built in").

## NC2-30: A Slack thread doesn't read like Slack
**Screen:** thread · **Width:** all · **Severity:** minor

**Actual:**
- Messages are "Received / hey, can you review the PR?" with no sender, avatar or time.
- The header says "To: me" on a channel.
- The title is printed twice (header and h2).
- Once the pane scrolls, the floating toolbar (reply/archive/more) overlaps the title.
- On a Gmail thread the body is just "Subject: PoC slides".
**Screenshot:** `s3-slack-thread-1440.png`, `s3-draft-area-1440.png`, `s5-person-to-thread-1440.png`.
**Proposed fix:** `apps/desktop/src/screens/Thread.tsx`: sender name and time per message (the item carries both), drop "To:" for channel threads, and make the toolbar part of the sticky header rather than floating over it.

## NC2-31: Archive on the phone behaves differently
**Screen:** detail sheet · **Width:** 390 · **Severity:** minor

**Actual:** archiving from the sheet shows no toast, keeps the sheet open with an "Archived · Restore" strip, and turns the archive icon into a restore icon. On desktop the same action toasts "Archived · Undo" and the list advances. Apple Mail closes the message and shows the next one.
**Screenshot:** `s1-archive-sheet-390.png`, `s1-restore-sheet-390.png`.
**Proposed fix:** route the sheet's archive through the same `archiveAndAdvance` + toast path as the list (`Inbox.tsx`), and close or advance the sheet.

## NC2-32: The draft card's buttons are unstyled
**Screen:** thread · **Width:** all · **Severity:** minor

**Actual:** "Edit & send", "Discard" and "Regenerate" render as default browser buttons (black 1 px border, square corners, touching), the only raw controls in the app, and they read like leftovers.
**Screenshot:** `s3-draft-area-1440.png`.
**Proposed fix:** `packages/ui/src/components/draft-card.tsx`: use `Button` (`variant="ghost"`, gap 8) like the approval card. Check whether `draft-card`'s styles are missing from the desktop CSS (the class rules live in `apps/desktop/src/app.css`, and the web and gallery copies drift).

## NC2-33: The chip bar clips at 600–640 px
**Screen:** Inbox · **Width:** 600–640 · **Severity:** minor

**Actual:** between 600 and 640 px the chips keep their labels, and the row runs past the card: Archived is cut in half and "+" is off-screen. The parent scrolls horizontally, but nothing shows it. Below ~500 the chips go icon-only.
**Screenshot:** `s9-chipbar-620.png`, `s9-resize-600.png`.
**Proposed fix:** switch to icon-only chips at the width where the row stops fitting (container query on `.filter-chip-bar`), or add an edge fade.

## NC2-34: Settings says little and confirms far away
**Screen:** Settings · **Width:** all · **Severity:** minor

**Actual:**
- Accounts shows "Connected" and nothing else: no address, no last sync, no Manage or Disconnect.
- Turning on autonomy for Slack scrolls the page and shows the confirm as an inline panel ~600 px below the switch, with Confirm on the left and Cancel on the right; the Approve dialog has Cancel left and Approve right.
- The kill switch is repeated on both the Accounts and Autonomy tabs.
**Screenshot:** `s6-settings-1440.png`, `s6-settings-toggle-1440.png`.
**Proposed fix:** `apps/desktop/src/screens/Settings.tsx`: account address and last sync from `adapter-health`. Put the confirm next to the switch (or reuse `confirm-prompt.tsx`), with one button order app-wide.

## NC2-35: Rows still read like logs
**Screen:** Inbox · **Width:** all · **Severity:** minor

**Actual:**
- "claude_code · inbox-draft" is a row title.
- An orange dot sits on most rows, and nothing explains it.
- Summaries start with "Draft:".
- Two identical "omnis launch sync" rows.
- After a decision, rows change position (the omnis row jumped from 2nd to last).

All carried from r1 NC-23/NC-24/NC-25.
**Screenshot:** `s0-first-load-1440.png`, `s4-ignored-1440.png`.
**Proposed fix:** `packages/ui/src/components/inbox-row.tsx`: a human session title, a tooltip or legend for the dot (or drop it), and a stable sort key.

## NC2-36: Keyboard selection doesn't preview
**Screen:** Inbox · **Width:** 1440 · **Severity:** polish

**Actual:** j/k move the highlight but the pane keeps showing the approval queue until Enter. In Superhuman the pane follows the selection. The first `j` after the skip link doesn't move; it only turns the focused row 1 into the selected row 1.
**Screenshot:** `s10-enter-opens-1440.png`.
**Proposed fix:** open the selected thread in the pane when the pane is a column (≥1280), and make the skip link select row 1.

## NC2-37: The expand chevron sits inside the ask bar
**Screen:** collapsed pane · **Width:** 1440 · **Severity:** polish

**Actual:** unchanged from r1 NC-29.
**Screenshot:** `s5-command-ran-1440.png`.
**Proposed fix:** put the expand control on the card's right edge, or in the rail.

## NC2-38: Row states flicker
**Screen:** Inbox · **Width:** 1440 · **Severity:** polish

**Actual:**
- On hover or selection, the row's status pill ("Blocked") is replaced by the hover actions, so the state disappears exactly when you point at it.
- Two rows can show the hover highlight at once (the keyboard-selected one and the pointer's).
- Scrolled rows slide under the sticky tab row with a hard cut (the DL avatar is sliced in half).
**Screenshot:** `s4-agent-blocked-invoice-1440.png`, `s12-archive-fails-1440.png`, `s5-command-ran-1440.png`.
**Proposed fix:** keep the pill and put the actions to its left, style the keyboard selection separately from hover, and add a top fade or divider to the sticky header.

## NC2-39: Wrapping at narrow widths
**Screen:** approval card, Settings · **Width:** 320 pane, 390 · **Severity:** polish

**Actual:** with the pane at 320 px, "Ignore" drops to its own line under Approve / Edit / Respond. At 390, "Model tiers" wraps to two lines inside the Settings segmented control.
**Screenshot:** `s11-drag-narrow-1440.png`, `s6-settings-390.png`.
**Proposed fix:** put Ignore behind the card's overflow at narrow widths, and scroll the Settings segmented control horizontally (or shorten the label to "Models").

## NC2-40: The model picker is exposed
**Screen:** ask bar · **Width:** 1440 · **Severity:** polish

**Actual:** "Auto / DeepSeek V4.1 Flash / Claude Sonnet 5" sits in the ask bar for a first-day user who doesn't know what either model is or what it costs.
**Screenshot:** `s3-askbar-mode-1440.png`.
**Proposed fix:** move it to Settings → Model tiers, or show it only after the first ask, with a one-line description per option.

## NC2-41: Today's greeting
**Screen:** Today · **Width:** all · **Severity:** polish

**Actual:** "Good morning, Logan" at 00:40. "4 items to handle today, 4 approvals pending" counts the same four things twice and lists no items. Screen titles don't match: Inbox's is a 28 px/700 `h2`; Today, Tasks and Settings use a 20 px/600 `h1`, so the title shrinks and shifts as you move between screens.
**Screenshot:** `s6-today-1440.png`.
**Proposed fix:** `apps/desktop/src/screens/Today.tsx`: pick the greeting by hour (and say nothing between midnight and 5), say "4 approvals waiting" once, and give every screen the same `h1` title style.
