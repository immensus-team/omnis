# Inbox Triage UX — Research (LENS: inbox-triage)

Unified inbox triage UX across kinso.ai, Superhuman, Missive, Front, Shortwave, Notion Mail, Hey.com — for omnis (light kinso-style channel rail + row list + AI summaries + agent-session rows). See `docs/design/DESIGN-DIRECTION.md` for the base spec this extends.

## Products studied (URLs)

- kinso.ai — [kinso.ai](https://www.kinso.ai/), [VentureBeat teardown](https://venturebeat.com/business/cracking-the-universal-inbox-inside-kinsos-quest-to-make-cross-channel-ai), [Kinso review](https://www.thisandthat.chat/blog/kinso-review/)
- Superhuman — [How to Manage Your Email Inbox](https://blog.superhuman.com/how-to-manage-your-email-inbox/), [Keyboard shortcuts PDF](https://download.superhuman.com/Superhuman%20Keyboard%20Shortcuts.pdf), [Email triage](https://blog.superhuman.com/email-triage/), [Superhuman like a semi-pro](https://writing.arman.do/p/superhuman)
- Shortwave — [Divide and conquer your inbox with Splits](https://www.shortwave.com/blog/split-email-inbox-by-importance/), [Customize your Shortwave](https://www.shortwave.com/docs/guides/customize-your-shortwave-settings/), [AI Assistant docs](https://www.shortwave.com/docs/guides/ai-assistant/)
- Missive — [missiveapp.com](https://missiveapp.com/), [Shared inbox advantage](https://missiveapp.com/blog/shared-inbox-advantage-of-having-only-one-inbox)
- Front — [Front keyboard shortcuts](https://help.front.com/en/articles/2189), [Managing your inbox like a pro](https://academy.front.com/app/courses/f03e0799-52eb-4a5b-a53d-6f8f8204c07d), [5 pro tips](https://frontapp.com/blog/pro-tips-using-front)
- Notion Mail — [Introducing Notion Mail](https://www.notion.com/blog/introducing-notion-mail), [Notion Mail keyboard shortcuts](https://www.notion.com/help/notion-mail-keyboard-shortcuts)
- Hey.com — [The Imbox](https://www.hey.com/features/the-imbox/), [Paper Trail](https://www.hey.com/features/paper-trail/), [How HEY works](https://www.hey.com/how-it-works/)

## Patterns worth adopting

### 1. One-key triage verbs (E / R / H / U / L / Del)
- **What**: Superhuman and Notion Mail converged on the identical single-letter grammar — `E` done/archive, `R` reply, `H` set reminder/snooze, `U` unread, `L` label, `Delete` delete. No modifier keys, no chords.
- **Why it works**: triage is a repeated motion done hundreds of times a day; a bare letter with the hand already on home row removes the only friction (mouse travel + click precision) that makes triage feel like a chore. Convergent evolution across two unrelated teams is a strong signal this is the correct grammar, not an arbitrary choice.
- **Implementation for omnis**: bind the same letters on the row list: `E` = archive/done, `R` = open composer focused, `H` = snooze (open a small relative-time picker: 1h/tonight/tomorrow/next week), `U` = toggle read, `L` = open label picker, `Delete`/`Backspace` = archive-equivalent (omnis has no real "delete" across read-only channel APIs — map to archive). Selection follows keyboard focus (`j`/`k` or arrow move focus down/up one row), action keys apply to the focused row without requiring a click first. Show the shortcut inline in the ⌘K palette per the design direction's "Start typing to ask or search" bar, exactly as Superhuman surfaces "hit Cmd+K to open Command, type what you want, see the shortcut for next time."
- **Effort**: S (row-level keydown handler + existing selection state).

### 2. Split inbox / splits as parallel triage lanes, not folders
- **What**: Superhuman's Split Inbox and Shortwave's Splits both auto-bucket messages into ML-classified lanes (colleagues/execs/tools, or department/tool-based lanes) shown as parallel columns or tabs, distinct from labels which are manual and archival.
- **Why it works**: it turns "one long list I must linearly judge" into "several short lists I already trust the sorting on," so the user's attention goes straight to the lane that matters right now instead of re-deciding relevance per row.
- **Implementation for omnis**: this is exactly the filter-pill row the design direction already specifies (`All/Work/Personal/Agents/Needs approval`), but treat "Needs approval" as a true split-lane, not a filter — it should have its own persistent unread-style count badge on the pill and pull blocked agent-session rows to the top even when "All" is selected (already specified in DESIGN-DIRECTION.md). Add one more implicit split: a "Blocked" count in the channel-rail Inbox tile itself (small red-orange badge), mirroring how Shortwave's splits surface counts before you even open a lane.
- **Effort**: M (pill row exists; needs the cross-cutting "always-top" sort rule + rail badge wired to `agent_runs`/`threads.meta` state).

### 3. AI one-line summary inline in the row, not a separate panel
- **What**: Shortwave puts the AI summary at the top of the *thread view*; kinso puts it directly in the *list row* (per DESIGN-DIRECTION.md's existing teardown — this is already the omnis choice). Notion Mail auto-labels instead of summarizing.
- **Why it works**: the row-level summary is what makes scanning 50 rows in 10 seconds possible — the alternative (open each thread, read the AI summary there) reintroduces the exact click-per-item cost triage is supposed to eliminate.
- **Implementation for omnis**: already specified — keep it, but add a **degrade path** these competitors are silent on: when summary generation fails/is pending, don't blank the row. Show subject-line-as-summary in a slightly lower-emphasis gray immediately (no skeleton shimmer, no spinner — per the "no AI-slop" rule, a shimmering skeleton row reads as generic). Backfill the AI summary in place with a soft 120ms cross-fade when it arrives async, never a layout shift.
- **Effort**: S (fallback already specified in DESIGN-DIRECTION.md; add the no-shimmer, no-layout-shift constraint explicitly to implementation notes).

### 4. Snooze as a first-class triage action with quick presets, not a menu buried three levels deep
- **What**: Front and Superhuman both treat snooze as equal-weight to archive in the primary action set (not hidden under a "more" menu), with quick relative-time presets (tonight, tomorrow, next week, pick a date).
- **Why it works**: snooze is the release valve for "I can't decide right now" — if it's slow to reach, users default to leaving mail unread/unarchived instead, and the inbox count creeps up, defeating triage.
- **Implementation for omnis**: put snooze (`H`) as a visible icon-button on row hover (next to archive) alongside the keyboard shortcut, not only reachable via a swipe or overflow menu. Preset list: 1 hour, this evening, tomorrow morning, next week, pick a time — matches the mental model users already have from Superhuman/Front, so no re-teaching cost.
- **Effort**: S (UI affordance + existing snooze scheduling, if omnis has scheduled-task infra — it does, via `mcp__scheduled-tasks__*`).

### 5. Command bar (⌘K) as the shortcut discovery surface, not a shortcuts cheat-sheet page
- **What**: Superhuman's Cmd+K ("Superhuman Command") and Notion Mail's ⌘K Command Bar both let a user type the *intent* ("snooze", "archive", "go to Slack channel") and get the action plus a visible reminder of the keyboard shortcut for next time.
- **Why it works**: it collapses "learn 20 shortcuts up front" into "discover each shortcut exactly once, at the moment you need it," which is a far lower learning-curve tax — critical for omnis since it must teach triage verbs across 8+ channel types plus agent-session-specific actions (approve/edit-send/ignore) that have no email precedent.
- **Implementation for omnis**: the existing "Start typing to ask or search" filled bar (per DESIGN-DIRECTION.md) is the natural host. Typed fuzzy-match against: triage actions (archive/snooze/label current row), navigation (go to channel X, go to agent Y), and the omnis-specific approval actions. Each result row shows its keyboard shortcut inline, right-aligned, same visual slot Superhuman uses.
- **Effort**: M (palette exists per design direction as `cmdk`; needs an action registry + fuzzy match over triage/nav/approval verbs).

### 6. Screener as an opt-in gate for first-time senders (Hey.com)
- **What**: Hey.com routes any never-seen-before sender to a Screener where the user explicitly allows or blocks before the message ever reaches the inbox proper.
- **Why it works**: it moves the triage decision "is this even worth seeing" upstream of the inbox, so the inbox list only ever contains senders you've already vetted — inbox zero becomes maintainable because the noise floor never enters.
- **Implementation for omnis**: don't build a full screener for v1 (effort/complexity mismatch for a personal multi-channel tool where most channels — Slack, WhatsApp, Telegram contacts — already imply an existing relationship, unlike open email). Instead borrow the *narrower* idea: a lightweight one-time prompt only for new email senders with no prior thread history ("First time seeing this sender — Keep in Inbox / Send to Low Priority"), reusing the split-lane mechanism from #2 rather than a bespoke gate UI.
- **Effort**: L if building the full Hey-style screener; **S** for the narrower "new sender → low-priority split" version — recommend the S version for v1, flag full screener as a later idea.

### 7. In-thread internal discussion before sending (Missive)
- **What**: Missive puts team chat directly inside the email thread (not a separate Slack thread) so a reply can be discussed and co-drafted before it goes out.
- **Why it works**: it keeps the decision context (the original message) and the deliberation (should we send this, how) in one visual frame, avoiding the classic "switch to Slack to ask a coworker, lose the email context" tax.
- **Implementation for omnis**: directly maps onto the approval-card requirement in DESIGN-DIRECTION.md — the approval card (Approve / Edit & send / Ignore) sitting in the detail panel above the draft is the single-user analog of Missive's in-thread discussion (the "discussion" here is the human reviewing what the agent drafted). No separate build — just confirms the existing approval-card placement is right and should stay inline, never a modal that hides the source message.
- **Effort**: none — validates the existing spec, no new work.

## Patterns to avoid

- **Ticket-number/case UX (helpdesk tools, and Front's heavier "assign/route" model)**: omnis is single-user, not a support team inbox — assignment, routing rules, and SLA badges are enterprise-support concepts that would read as bloat and contradict the "no AI-slop, no unnecessary chrome" direction.
- **Tab-per-channel chrome (classic Gmail-style category tabs) as the *primary* navigation**: this is superseded by the channel rail already specified — don't duplicate the same grouping concept twice in two different UI regions (rail + tabs), it's redundant and confusing about which one is the source of truth for "where do I look."
- **Full inbox-zero gamification (streaks, zero-state confetti, counters as a UI focal point)**: several competitor blogs lean on this messaging; it trends toward AI-slop/gimmick territory the design direction explicitly rejects (flat generic fonts, static transitions were called out — gamified zero-states are the same category of noise). A calm, quiet empty state (per Apple-design motion principles already referenced) is enough.
- **Skeleton-shimmer loading rows for AI summaries**: common in AI-email competitors but reads as generic AI-slop per the existing reviewer rule; use the subject-line fallback + soft cross-fade instead (see pattern #3).
- **Screener as a hard gate for every channel**: Hey's screener is built for email-only, where senders are unbounded strangers. Applying it uniformly across Slack/WhatsApp/Telegram (where "sender" usually means an existing contact or workspace member) would add friction with no signal — only apply the lightweight version to net-new email senders (see pattern #6).

## Open questions

- Should snooze presets differ by channel (e.g., "snooze until next standup" makes sense for Slack but not email) — needs a decision before scheduled-task wiring is finalized.
- Where does the command-bar action registry live — client-side static list vs. server-driven (so agent-specific actions like "resume Claude session" can be added without a redeploy)? Affects effort estimate for pattern #5.
- For the "new sender → low-priority split" (pattern #6), does omnis have enough email volume/history to make "first time seeing this sender" a reliable signal, or does it need a grace period before the low-priority split activates (to avoid mis-routing a first message from a new but important contact)?
- Blocked-row "always top" sort (pattern #2) — does this apply within every filter pill or only "All"? Needs UX confirmation to avoid confusing users who filtered to "Personal" but still see an agent-blocked row.
