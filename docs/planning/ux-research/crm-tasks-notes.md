# LENS: CRM + Tasks + Notes inside an inbox

Personal CRM, task extraction, and notes patterns for omnis, drawn from Clay/Mesh, Folk, Dex, Sunsama, Superhuman, Notion, and Obsidian daily notes. English only per instructions.

## Products studied (URLs)

- Clay / Mesh (personal CRM, iOS + web) — https://apps.apple.com/us/app/mesh-contacts-crm/id1463073824 , overview: https://www.buildfastwithai.com/ai-tools/clay-crm
- Folk (lightweight team CRM, table + pipeline views) — https://www.folk.app/ , data model: https://help.folk.app/en/articles/9790806-folk-data-model , pipeline views: https://help.folk.app/en/articles/6044821-create-custom-pipeline-views
- Dex (personal CRM, keep-in-touch board) — https://getdex.com/
- Sunsama (daily planning, Slack→task, manual email pull) — https://www.sunsama.com/daily-planning , Slack integration: https://www.sunsama.com/integrations/slack , daily planning docs: https://help.sunsama.com/docs/usage-guides/daily-planning/
- Superhuman (split inbox, triage model) — https://help.superhuman.com/hc/en-us/articles/45271247561107-Structure-Your-Inbox , custom splits: https://help.superhuman.com/hc/en-us/articles/38458483333907-Custom-Split-Inbox
- Obsidian daily notes + backlinks — https://obsidian.md/help/backlinks , workflow: https://jamierubin.net/2022/02/08/practically-paperless-with-obsidian-episode-17-six-ways-i-use-note-links/
- Notion (referenced from prior omnis research on databases/relations — no new fetch this pass; used for the "person as database row with relations" pattern, well established from general knowledge of the product).

## Patterns worth adopting

### 1. Person = a card, not a form (Clay/Mesh, Dex)
**What:** Every contact gets an auto-built card: photo, one-line bio, "how you know them," and a merged activity feed (last email, last calendar meeting, last DM) rather than a blank CRM form the user has to fill in.
**Why it works:** Zero data-entry burden is the whole reason personal CRMs get used instead of abandoned like classic sales CRMs. The card is *read* far more than it's *edited*.
**Implementation for omnis:** In the Network view, a person row expands into a right-side detail panel (reuse the existing thread-detail panel pattern) showing: avatar, name, org/role (enriched from email signature / LinkedIn if connected), a timeline merging omnis's own channels (last Slack DM, last email, last WhatsApp, last calendar event together) instead of a separate "interactions" tab. No required fields — every field is optional and auto-filled where possible; user only adds free-text notes.
**Effort:** M — timeline merge across channel tables already exist as `threads`/`messages`; person aggregation is a join + view, not new ingestion.

### 2. Keep-in-touch nudge, not a pipeline stage (Dex, Clay)
**What:** Instead of sales-style pipeline stages, personal CRMs surface a single passive signal: "you haven't talked to X in 6 weeks" and let the user set a per-person cadence (weekly/monthly/quarterly).
**Why it works:** Personal relationships don't have a "deal stage"; the only useful automation is a fading-interaction alert, which is cheap to compute (max(last_message_at) per person) and matches how people actually think about their network.
**Implementation for omnis:** A "Needs a nudge" filter pill in Network view, computed from `max(threads.last_message_at)` grouped by contact across all channels, with a per-person optional cadence field (default: no reminder). Surfacing this as a digest section ("3 people going quiet") in the nightly digest is more useful than a standing Kanban board.
**Effort:** S — one scheduled query + digest section; no new UI screen needed beyond a filter pill.

### 3. Pre-meeting brief agent (Clay/Mesh)
**What:** Before a calendar meeting, Clay auto-generates a one-paragraph brief per attendee: who they are, how you know them, recent shared context.
**Why it works:** It answers "who am I about to talk to" at the exact moment of need, without the user having to go look anything up — this is the single most-cited "magic moment" in Clay reviews.
**Implementation for omnis:** Tie into the Calendar channel + agent-session pattern already planned: 15 min before a meeting, a background agent run (T1 DeepSeek Flash) produces a 2–3 sentence brief per external attendee (pulled from the person's merged timeline) and posts it as a system message in that day's digest thread or as a calendar-event card in the Inbox. Reuse the existing agent-session-as-thread UI — this is just another agent run with a `meeting-brief` task type.
**Effort:** M — needs calendar-attendee → person matching (email address join) plus a scheduled trigger; summarization reuses existing T1 pipeline.

### 4. Table + pipeline are the same data, different view (Folk)
**What:** Folk stores contacts/companies/deals as one underlying dataset and lets the user switch between a spreadsheet-like table view and a Kanban/pipeline view of the *same* records, per saved view.
**Why it works:** Avoids building two separate features (a CRM table and a pipeline board); one schema, multiple renderers, matches how users actually toggle between "scan everything" and "see stage." Also keeps the product lightweight (Folk explicitly markets itself on load speed and minimal chrome).
**Implementation for omnis:** If/when omnis adds a lightweight deals/opportunities concept (not in MVP scope per DESIGN-DIRECTION.md), model it as a view toggle on the Network table (table view for scanning, pipeline view for anything with a "stage" custom field) rather than a separate app section. For MVP, skip pipeline entirely — Network is a flat/filterable table only.
**Effort:** L if pipeline is ever built; **skip for MVP** (explicitly out of scope, see Open Questions).

### 5. Slack/email message → task, one click, no separate app switch (Sunsama)
**What:** A message action turns a Slack message directly into a task on today's or a future day's plan; email is *not* auto-parsed for action items — the user manually drags relevant emails into the plan. Sunsama deliberately does not claim to "read your email and extract tasks automatically."
**Why it works:** Automatic action-item extraction from email has a high false-positive/false-negative rate and erodes trust; a manual "turn this into a task" affordance on a specific message is precise and cheap to build, and users trust it more because they chose it.
**Implementation for omnis:** On every inbox row and every message inside a thread, add a "Make task" quick action (hover icon or ⌘-K palette command) that creates a task pre-filled with the message subject/first line and a backlink to the source thread. Do NOT auto-extract tasks from every email as a background job — that's the AI-slop failure mode DESIGN-DIRECTION.md already warns against (noisy, untrustworthy). Where omnis *does* want automation, scope it narrowly: only agent-session threads flagged "blocked" (needs my input) auto-generate a task, since that's a structured signal, not free-text inference.
**Effort:** S — one action + a `tasks` row insert with `source_thread_id` FK; already have the thread/message schema.

### 6. Daily plan as the task surface, not a project-management board (Sunsama)
**What:** Sunsama's core loop is "plan your day" — pull tasks from various backlogs into a single ordered list for *today*, time-boxed against the calendar, not a Kanban/backlog-first UI.
**Why it works:** For a single user (not a team), a chronological daily list matches how one person actually executes, and it plays well with a nightly-digest product like omnis (digest → "plan tomorrow" flow).
**Implementation for omnis:** Tasks view defaults to "Today" (flat ordered list, checkbox + calendar-time chip if scheduled), with "Later" as an unordered backlog underneath, not a multi-column board. The nightly digest ends with a "3 things to plan for tomorrow" prompt that opens directly into this Today list. This matches kinso's minimal-chrome, list-first sensibility already chosen for Inbox.
**Effort:** S — reuse the Inbox row component (checkbox + title + due chip) for Tasks; no new list primitive needed.

### 7. Backlink every note to its source, automatically (Obsidian)
**What:** Any time you mention a person/topic in Obsidian, a backlink is created automatically on the target note — the target note becomes a live index of everywhere it was mentioned, with surrounding context, with zero manual index maintenance.
**Why it works:** Manual tagging/filing dies within weeks for a solo user; automatic backlinking gets the "everywhere this person came up" view for free from normal daily writing.
**Implementation for omnis:** When a person is @-mentioned in a note, task, or agent-session, or matched by email address in an inbox thread, automatically add a backlink entry on that person's card (already covered by pattern #1's merged timeline — the timeline *is* the backlink list). For free-text notes specifically: support `@Name` mention syntax in the notes composer that both links the note into the person's timeline and autocompletes from existing contacts, mirroring Obsidian's `[[Note]]` autocomplete UX.
**Effort:** S — mention-parsing + FK on notes table; autocomplete reuses the existing ⌘K/search index.

### 8. Split-inbox triage, not folders (Superhuman)
**What:** Superhuman's Split Inbox puts 3–7 named, reorderable sections at the top of the inbox (e.g., "Important" vs "Other," or custom rule-based splits), each showing a live count, with Tab/Shift+Tab keyboard navigation between them.
**Why it works:** It's triage without leaving the single list — no folder-switching, no separate view; the split is a filter on top of one stream, and the count badge gives at-a-glance load.
**Implementation for omnis:** The filter-pill row already planned (All/Work/Personal/Agents/Needs approval, per DESIGN-DIRECTION.md) is functionally this pattern — validate it against Superhuman's specifics: (a) show a live count per pill, (b) keep pill count to ≤7, (c) add Tab/Shift+Tab keyboard cycling between pills as a omnis power-user shortcut, matching the "keyboard-first" Apple-like bar already in the design direction.
**Effort:** S — counts are a `COUNT() GROUP BY` on the existing filter query; Tab-cycling is a keydown handler on the Inbox view.

## Patterns to avoid

- **Sales-pipeline stages for a personal/solo-user CRM (avoid Folk's B2B framing for Network).** omnis's Network is about relationships and follow-ups, not deals in a funnel — don't import "stage," "deal value," "win probability" concepts; that's enterprise-CRM slop for a personal tool.
- **Auto-extracting tasks from every email/message via background AI.** Sunsama explicitly chose *not* to do this for email because of trust/accuracy problems; omnis's own DESIGN-DIRECTION.md already flags this class of over-automation as an AI-slop risk. Keep task creation explicit (user action) or scoped to structurally unambiguous signals (agent-session "blocked" state), never blanket NLP extraction presented as fact.
- **A separate CRM "module" with its own nav/shell.** Both Clay and Dex are single-purpose apps; inside omnis, Network must reuse the same row/list/detail-panel primitives as Inbox and Tasks (per DESIGN-DIRECTION.md's "don't build it yourself" principle) rather than becoming a visually distinct sub-app.
- **Manual tagging/filing as the primary organization method.** Obsidian's power comes from automatic backlinks, not manual folders/tags; don't ask the user to manually categorize every contact or note as a first step — auto-link from mentions/email-matching first, let manual tags be optional refinement.
- **Kanban board as the default Tasks view.** Sunsama's default is a flat daily list; a multi-column board is heavier chrome than a solo user needs and conflicts with kinso's minimal list-first direction.

## Open questions

- Does omnis need a "deals/pipeline" concept at all for v1, or is Network purely relationship tracking (Dex/Clay model) with no stages? DESIGN-DIRECTION.md doesn't mention deals — recommend deferring pattern #4 (table+pipeline toggle) entirely until a concrete use case appears.
- Attendee-matching for pre-meeting briefs (#3) needs calendar-event attendee emails reconciled against Network contacts — what's the matching/merge UX when an email doesn't match an existing contact (auto-create a stub person card vs. prompt)?
- Cadence-based "keep in touch" reminders (#2) need a default: opt-in per contact, or a global default cadence (e.g., 60 days) applied to everyone with no explicit setting? Recommend opt-in only, to avoid noisy false-positive nudges for one-off contacts.
- Where does the @-mention/backlink UI (#7) live for agent-session threads specifically — can a DeepSeek/Claude Code session thread @-mention a person and have that show up on the person's timeline the same as a human note would?
