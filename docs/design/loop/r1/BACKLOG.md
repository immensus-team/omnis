# Loop r1 backlog

**Round focus:** triage speed, agent observability, responsive polish.
**Inputs:** `findings-logan.md` (L-01…L-44), `findings-newcomer.md` (NC-01…NC-40), the UX adoption list (UX-01…UX-40), `DESIGN-DIRECTION-v3.md`, `POLISH-LOG.md`, `ds/FOLLOWUPS.md`.
**Branch:** `plan/loop-r1`. Unit-test DB `omnis_test_loop_r1`. Live stack for Playwright: `OMNIS_E2E_DB=omnis_test_loop_r1_e2e OMNIS_E2E_PORT_OFFSET=200 ZERO_SHARD_NUM=9` (desktop :5373, PWA :5374).
**Task files:** `/Users/logankim/AI-Workspaces/Claude/omnis/ds/tasks/loop-r1-NN.md`, run in the order of `loop-r1.list`. Each is sized for one DeepSeek run of 45 minutes or less, and each ends in one commit.

## Order

The two testers agree on the blockers, so the order follows user impact. First, what stops a morning outright: you can't reach a screen, can't see the list on a phone, and can't triage by keyboard. Next come the blockers that lose data or render broken. Then the round-focus majors: feedback on every write, then agent observability. Last is the palette, which builds on 01's commands.

| # | Id | Title | Fixes | Adoption | Depends on |
|---|----|-------|-------|----------|------------|
| 1 | loop-r1-01 | Reach every screen from the rail, the keyboard and ⌘K | L-06, NC-01, L-33 (active tile, dead tiles), NC-17 (dead buttons), part of L-16 | — | — |
| 2 | loop-r1-02 | Phone and split-screen: the list comes first | L-04, L-17, NC-03, NC-09 (way back), NC-37, NC-32, L-26, NC-27 | UX-26 (overlay rule), UX-05 (as a subline count) | 01 |
| 3 | loop-r1-03 | Keyboard triage: j/k move, e archives and advances | L-01, L-02, NC-02, NC-18 (roving tabindex), L-19 (Home/End), NC-28 | UX-01, UX-02 (e/u part) | 02 (owns Esc) |
| 4 | loop-r1-04 | PWA rows, a phone viewport, and the omnis mark | L-08, NC-06, L-39, NC-21, L-33/NC-17 (System = Settings gear), the L-21 icon part, FOLLOWUPS "system → omnis" | UX-28 (viewport part) | — |
| 5 | loop-r1-05 | Writes stop failing silently: proxy table and Tasks quick-add | L-14, NC-07, L-07, NC-05 | — | — |
| 6 | loop-r1-06 | Undo and outcome toasts for archive and approvals | L-03, L-12, L-13, NC-10, part of L-11 | — | 03 |
| 7 | loop-r1-07 | Agent session header, states and expandable tool calls | L-10, NC-08, NC-09 (blank pane) | UX-09 (expand part), UX-13 (header, no cost), UX-15 | 02 |
| 8 | loop-r1-08 | ⌘K: Enter opens, people open, commands filter | L-15, L-16, NC-12 (person, stale query), NC-13, NC-40 and L-35 (Phase B controls in the panel) | UX-03 (partial) | 01 |

**Blockers covered:** L-01, L-02, L-03, L-04, L-06, L-07, L-08 and NC-01, NC-02, NC-03, NC-05, NC-06.
**Blockers not covered:** L-05 / NC-04 (reply). See "Deferred".

## Decisions made while planning

- **"system → omnis" is a display rename, not a data rename.** `'system'` is in the `accounts_channel_ck` CHECK of the frozen migration `0002`, and in `adapter-health.ts` and `ingest.ts`. Renaming the stored value would take a new migration plus kernel changes, and the user sees none of it. So 04 changes `CHANNEL_LABEL.system` to "omnis" and swaps the `system@1x/2x.png` artwork for the omnis mark, rasterised from `apps/web/public/icon.svg`. The same rasterisation produces the PWA's `apple-touch-icon`. The FOLLOWUPS entry's second half (rail expanded/collapsed states) is deferred.
- **Approvals auto-open the pane only in the ≥1280 column tier.** Below that, the list comes first and a "N need approval" subline button opens the queue (02). This follows Apple Mail and both testers.
- **Escape belongs to the shell (02), not the list (03).** Esc closes whatever the pane shows and puts focus back on the row.
- **No session cost in the agent header (07).** Zero carries no per-session cost or token data, and UX-13 says to omit a figure rather than print `$0.00`.
- **Ignore becomes undoable by deferring the decide call for 5s behind the toast (06).** Approve stays confirm-first and gets an outcome toast with no undo, because the outbox may already have sent it.

## Deferred to round 2 (and why)

| Finding | Why not now |
|---|---|
| L-05 / NC-04 reply (Edit & send, Reply, draft from the ask bar) | Needs a hub "propose send" route, an inline editor and one-draft-one-card folding (L-23). That is more than one 45-minute slice. Top of r2. |
| L-22 / NC-38 apply labels | Needs a hub labels write route plus a popover. r2, alongside UX-07 snooze. |
| L-29 / NC-22 counts disagree | Needs one decision about what counts, applied on three screens. Do it in r2 with the Today rework (L-42, NC-20). |
| L-09 / NC-14 offline and connecting state | A shell-wide connection source. r2. |
| L-20 / NC-34 Settings health and copy | Not in the round focus. |
| L-24 / NC-35 stale digest, NC-19 / L-34 Network merge, L-21 / NC-36 PWA tabs and row tap | Not in the round focus. |
| L-27 / NC-16 hover card over pane, L-28 menu Esc, L-32 / NC-15 empty filter state | Small triage polish. Next round's first slice. |
| L-31 / NC-25 agent row preview and avatars | Follows 07 once its header lands. |
| L-41 / NC-39 Korean comments | Each task translates the comments in files it touches. A full sweep plus a lint grep is its own slice. |
| NC-12 summary indexing, L-43 thin search | Hub search work. |
| FOLLOWUPS: rail expanded/collapsed states | Design work first (ACCENT §4.4). |
