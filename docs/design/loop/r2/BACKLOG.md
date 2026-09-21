# Loop r2 backlog

**Round focus:** reply end-to-end (the draft card is the approval, an inline editor, a visible destination); agent observability finished (a blocked session shows what it waits on); keyboard finished (focus restore, heading focus on screen switch); one approval count; a connection-state banner and skeletons; the system→omnis rename finished with the omnis mark.
**Inputs:** `findings-logan.md` (L2-01…L2-39), `findings-newcomer.md` (NC2-01…NC2-41), the UX adoption list (UX-01…UX-40), `DESIGN-DIRECTION-v3.md`, `POLISH-LOG.md`, `ds/FOLLOWUPS.md`.
**Branch:** `plan/loop-r2`. Unit-test DB `omnis_test_loop_r2`. Live stack for Playwright: `OMNIS_E2E_DB=omnis_test_loop_r2_impl OMNIS_E2E_PORT_OFFSET=500 ZERO_SHARD_NUM=12` (desktop :5673, PWA :5674, hub :9287). The testers' stacks (offsets 300 and 400) are not reused.
**Task files:** `/Users/logankim/AI-Workspaces/Claude/omnis/ds/tasks/loop-r2-NN.md`, run in the order of `loop-r2.list`. Each is sized for one DeepSeek run of 45 minutes or less, and each ends in one commit.

## Order

Both testers put the same things at the top: approval buttons that decide on one click (data loss: "Edit" sends unchanged), no way to reply, typing into the phone's search sheet that archives threads, and a blank page when the hub is slow. The order follows that. The approval card comes first, because the reply flow builds on it. Next, the draft is folded into its approval, and then the composer can create one. The remaining blockers follow (keymap leak, blank page). The round-focus majors come last.

| # | Id | Title | Fixes | Adoption | Depends on |
|---|----|-------|-------|----------|------------|
| 1 | loop-r2-01 | Approval card: Edit and Respond open an editor, and the card shows where it goes | L2-02, NC2-01, NC2-02, NC2-05, L2-08 (card and confirm), L2-37 | UX-11 (reason line, partly) | — |
| 2 | loop-r2-02 | One reply, one card: the draft is the approval | NC2-04, L2-08 (three copies), NC2-32 | — | 01 |
| 3 | loop-r2-03 | Reply: `r` opens an inline composer that proposes a send | L2-01, NC2-03, the "Phase B" copy half of NC2-03 | UX-02 (`r`), UX-18 (one suggestion) | 01, 02 |
| 4 | loop-r2-04 | Overlays own the keyboard: the phone ask sheet types, Esc closes one layer | L2-03, NC2-15, NC2-12, L2-13 (panel stays open) | — | — |
| 5 | loop-r2-05 | Connection banner and skeleton rows | L2-05, NC2-13 (banner, skeletons, no false "Updated") | UX-06 (no shimmer) | — |
| 6 | loop-r2-06 | One approval count; Today's chips and Tasks' checkbox work | L2-07, NC2-08, L2-24, L2-15 (chips), L2-04 | UX-05 (the number it shows) | 01 |
| 7 | loop-r2-07 | Agent sessions say what they wait on; omnis wears its mark | L2-06, NC2-06, NC2-07, L2-32, NC2-29, FOLLOWUPS "system → omnis" (avatar half) | UX-15 | 01 |
| 8 | loop-r2-08 | Focus lands somewhere: headings on screen switch, restore after close and undo | L2-09, NC2-10, L2-10, NC2-09, L2-28 (focus after last restore), NC2-11 (focus back after ⌘K) | — | 04 |

**Blockers covered:** L2-01, L2-02, L2-03, L2-04, L2-05 and NC2-01, NC2-02, NC2-03. That is all of them.

## Decisions made while planning

- **A reply is a proposed `send` approval, never a direct send.** The hub gets one route, `POST /threads/:id/reply { body }`. It calls `kernel.approvals.propose({ action: "send", … thread_id })`, the same path the bridge and the seed use. The folded card from 02 then renders it. Delivery stays behind `runEgress` as before. With no live adapter the send fails at execution, which the existing outcome toast already reports. So 03 needs no new send machinery, and nothing leaves omnis without an Approve.
- **Edit decides only on Save, and Save confirms like Approve does.** An edited send still goes out, so it gets the same `ConfirmPrompt` as Approve. Respond decides only with non-empty text, as `decided_args: { response }`. `HumanResponse.decided_args` is already `record<unknown>`, so no protocol change is needed.
- **The draft and its approval fold when they are the same message.** The pair is the thread's pending `send` approval whose `item_id` is the draft item, or failing that, whose `args.body` equals the draft's body. It is drawn once, as the draft card, and its buttons are the decision buttons. The kernel's `decide()` consumes the linked draft: `ignore` sets it `archived`, and `accept`/`edit` set it `approved`. So Discard is simply `ignore`, and it keeps App's 5s undo. A draft with no approval gets a hub `POST /items/:id/discard`. The Zero write that Discard uses today is rejected by the server (the permissions grant no writes), so it failed silently. "Regenerate" is removed until something regenerates.
- **The count is the number of pending approvals the pane would list.** One selector in the shell (`visibleApprovals`, which already hides decided and undo-deferred cards) feeds the subline, the "Needs approval" pill badge, the queue and Today. There is no rail badge yet, and none is added. The pill's *filter* still lists threads, but its badge reads the approval count. Archiving a thread leaves its approval pending, and still counted, because it is still waiting.
- **Every `app.css` edit is re-copied into `apps/web/src/vendor/app-styles.css` (test-guarded) and `apps/gallery/src/vendor/app-styles.css`.** Each brief says so.
- **Zero cannot write.** Task completion (06) and draft discard (02) go through new hub routes, as every other write does (contract §5).
- **The session's blocking reason is data we already have.** The row shows the session thread's latest `message` item. `AgentSession` filters that kind out, which is why the pane "shows less than the row". 07 adds `message` to the pane's kinds and fixes the seed, so the invoice approval carries the session's `thread_id` as the bridge would have set it. Moving a seeded session out of Blocked after a decision is the bridge's job (`settleState` in `apps/hub/src/bridge.ts`). The seed has no live bridge waiting, so that part of L2-06 is a fixture limit, not a UI bug. 07 does not fake it.
- **"system → omnis" stays a display rename** (as decided in r1). 07 finishes it on the two surfaces that still show "OM" initials and the black "O" tile. The rail expanded/collapsed half of the FOLLOWUPS entry stays deferred.
- **Connection state comes from Zero first.** `useConnectionState()` in `@rocicorp/zero/react` 1.9.0 returns `{ name }`, where `name` is one of `connecting | connected | disconnected | needs-auth | error | closed`. That, plus `navigator.onLine`, feeds one banner. Skeletons show while the Inbox query's `resultType` is not `'complete'` and there are no rows. Today's own "You're offline" line is removed in favour of the shell banner.

## Deferred to round 3 (and why)

| Finding | Why not now |
|---|---|
| L2-12 / NC2-22 / NC2-23 ⌘K search misses summaries, commands only navigate | Hub search indexing plus an action registry (UX-03). Its own round-3 item. |
| L2-23 / NC2-25 `a`, `l`, the `?` shortcut sheet, thread labels | The label write route plus a popover (UX-07 snooze belongs with it). |
| L2-11 mark read on open | A hub write route. Small, but not in the focus. First r3 slice. |
| L2-19 / NC2-35 list order and row copy | A sorting decision (attention groups vs. chronological) that needs design first. |
| L2-21 / NC2-17 PWA row tap, approvals tab, install card | The PWA is its own round. The install-card persistence is a one-liner r3 can take. |
| NC2-14 / NC2-16 phone sheet detents and the Filters overlay | Sheet sizing in `sheet.tsx` (vaul). A focused r3 slice with an iPhone profile. |
| L2-16 / NC2-18 quick-add goes to Someday | Tasks polish. |
| L2-17 / NC2-19 note routing picker and the `note_route` error row | The kernel copy map plus a picker. |
| L2-18 / NC2-34 Settings account health | Reads `adapter-health`. Pairs with 05's banner in r3. |
| L2-20 / NC2-21 stale digest | Small copy fix, not in the focus. |
| L2-25 / NC2-27 agents in the Slack filter; L2-22 pills' arrow keys; L2-26 rail reorder keys | Filter and keyboard polish for r3. |
| L2-27 / NC2-24 hover card over the pane; L2-31 floating pane cut; L2-30 / NC2-30 thread header | Layout polish. |
| UX-12 Stop control, UX-13 session cost | Stop needs a per-runtime kill path (adoption-list open question). Cost needs Zero columns. |
| FOLLOWUPS: rail expanded/collapsed states | Design work first (ACCENT §4.4). |
| Cut from r2 briefs to keep each within 45 minutes: "Write a reply" in the ask panel and "Edit & send" on a standalone draft (03); "Show all" on a long approval body (01); the ⌘K search-failure message (05); the time-of-day greeting, L2-38 / NC2-41 (06); the Z hint on Undo, NC2-25, and focus after ⌘\, L2-14 (08) | Each is a small, separate slice. Take them first in r3. |
