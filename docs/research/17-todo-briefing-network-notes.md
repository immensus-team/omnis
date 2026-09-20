# Product patterns: agent-managed todo, briefings, personal CRM/Network, note routing (research, 2026-09-20)

## 1. TL;DR

For todo, Motion/Reclaim have validated the "task → calendar time block auto-placement + re-optimization" pattern, and Todoist Assist has validated the "email forward → AI extraction → confirm" capture pattern. For briefings, the target UX is exactly kinso's "urgency-ranked summary + tone-matched draft" (already analyzed in depth in research 01). For personal CRM, **Clay has pivoted from clay.earth (personal) to clay.com (enterprise GTM)**, and its personal successor is **Mesh (me.sh)** — Dex, with its integration of 15 sources + MCP server + calendar-triggered pre-meeting brief, is the closest reference for omnis Network. Folk's "Follow-up Assistant" (dormant conversation detection → tone-matched draft) is the direct precedent for the "note → routing" feature. Among OSS, Twenty (TS, custom license, restricts SaaS resale) has the most reusable code-first entity/workflow model, and block/buzz (Rust, Apache-2.0, ★33.7k) the most reusable "agent = inbox thread" architecture. Monica (PHP, AGPL-3.0) is useful mostly as a UI copy reference.

## 2. Facts

**(1) Agent-managed todo**
- Todoist Assist's Email Assist (Experimentalist mode, Pro/Business) extracts deadlines, links, and action items from forwarded email and creates tasks automatically. It is the only Assist feature that can be toggled on/off. VERIFIED — [todoist.com/todoist-assist](https://www.todoist.com/todoist-assist), [TechCrunch](https://techcrunch.com/2026/01/21/todoists-app-now-lets-you-add-tasks-to-your-to-do-list-by-speaking-to-its-ai/) (fetched 2026-09-20).
- Ramble (voice → task) uses Google Gemini 2.5 Flash Live (Vertex AI) to convert live speech into structured tasks (including dates and details). VERIFIED — TechCrunch, same as above.
- Motion takes a project/task's priority, dependency, deadline, and duration and performs automatic scheduling that re-optimizes "hundreds of times a day", warning of imminent deadline risk days to weeks in advance. Task capture is via email forward, meeting-invite conversion, and Siri voice. VERIFIED — [usemotion.com](https://www.usemotion.com/) (fetched directly, 2026-09-20).
- Reclaim.ai syncs task lists from Asana/ClickUp/Todoist/Jira and converts them into priority-based calendar time blocks. "Habits" are flexible recurring events, and "AI Tasks" defend a task from being pushed aside when meetings conflict and rebalance it on a weekly cadence. VERIFIED — [reclaim.ai](https://reclaim.ai/) (fetched 2026-09-20).
- Akiflow's "Universal Inbox" gathers tasks from 10+ native integrations (Slack, Gmail, etc.) plus Zapier/IFTTT, and time-blocks them alongside the calendar in a daily planner with Someday/This month/This week views. Capture is via natural-language input, Cmd+K, voice, and AI chat. VERIFIED — [akiflow.com](https://akiflow.com/) (fetched 2026-09-20).
- Vikunja (OSS, Go backend, AGPL-3.0, ★5,460) offers List/Kanban/Gantt/Table views, self-hosting via Docker/binary/installer wizard, and migration from Todoist/Trello/MS To-Do. VERIFIED — [vikunja.io](https://vikunja.io/), `gh repo view go-vikunja/vikunja` (2026-09-20).
- Common pattern: none of these products go as far as "the agent executes on your behalf" — they all stop at **extraction → human confirms/schedules → (optional) auto-placement**. The "the agent assigns work to Codex/Hermes first" behavior omnis calls for in the brief has no precedent in this category (= a differentiator and an unvalidated risk).

**(2) Morning briefing / nightly archive digest**
- A comparison of kinso's Morning Briefing against competing products is already analyzed in depth in `research/01-kinso-and-competitors.md` — not duplicated here; in summary: urgency-ranked summary + tone-matched draft + contextual linking. VERIFIED (cited from file 01).
- kinso itself, re-confirmed: copy stating that the "contextual assistant" links related conversations scattered across WhatsApp/Slack/email without the user having to organize them, and that the Morning Briefing is a daily summary "ranked by urgency and importance". VERIFIED — [kinso.ai](https://www.kinso.ai/) (re-fetched 2026-09-20).
- Superhuman Auto Labels: short natural-language prompts ("job applications", "requests to review work") let the AI generate label rules, and Split Inbox splits those labels into tabs so similar email can be processed in batches. Instant Reply aims for a state where drafts are already attached when you open the inbox ("wake up to an inbox where every email has a draft reply"). VERIFIED — [superhuman.com/ai](https://superhuman.com/ai) (fetched 2026-09-20).
- Shortwave could not be confirmed from a primary source due to a connection failure (network error, `getaddrinfo ENOTFOUND`). UNVERIFIED — retry needed; not used in this research round.
- No source provided primary confirmation of the specific UI affordances of the nightly digest, such as "undo archive". UNVERIFIED — this part needs to be designed in-house.

**(3) Personal CRM / Network**
- **Important correction**: Clay is no longer a personal CRM. Fetching clay.com directly surfaces only "Keep CRM records accurate/complete" plus lead enrichment, rep productivity, and sequence automation aimed at enterprise sales teams — there is no personal relationship entity model, reminder, or calendar trigger at all. VERIFIED — [clay.com](https://clay.com/) (fetched 2026-09-20).
- The original personal Clay (clay.earth) moved (rebranded) to **me.sh ("Mesh") via a 301 redirect**. Mesh refreshes contacts ("job changes automatically") through LinkedIn/Facebook/Instagram/WhatsApp/X/Notion integrations plus automatic email/calendar capture, nudges reconnect timing, shows an activity feed of birthdays/job changes/news mentions, offers team features ("unlock every connection in the room"), and claims 100M+ relationships managed with Disney/Notion/Stanford/McKinsey as customers. VERIFIED — [me.sh](https://me.sh/) (2026-09-20, 301 redirect from clay.earth confirmed).
- folk: entity model = People / Companies / Objects / Deals. Automatic enrichment via Gmail/Outlook email scanning + calendar meetings + LinkedIn + WhatsApp + 6,000+ tool integrations. The **Follow-up Assistant** analyzes email/WhatsApp conversations, detects the state where "the discussion has gone dormant and there is a pending next step", and proposes a follow-up draft written in the user's tone as a notification. VERIFIED — [folk.app](https://www.folk.app/) (fetched 2026-09-20). **This is the closest existing product precedent for omnis's "note → routing" feature.**
- Attio: data model = records/objects plus a "Universal Context" layer (automatic sync of email, calls, product usage, billing). Workflows run event trigger → enrichment/scoring/routing action → sequence enrollment. Positioned as "the CRM for agentic revenue", with agents doing research, follow-up, and prospecting 24/7. VERIFIED — [attio.com](https://attio.com/) (fetched 2026-09-20). It is built for enterprise sales, so for omnis it serves as a reference for workflow engine design.
- **Dex**: consolidates contacts from 15+ sources (email, calendar, LinkedIn, WhatsApp, iMessage, Facebook, Instagram, phone contacts, CSV) and merges duplicates, with custom notes/fields/tags/groups. Keep-in-touch reminders prevent relationships from going stale. Interaction timeline (meetings, calls, email, messages). **Calendar-triggered pre-meeting brief + network update when a contact changes jobs.** Web/iOS/Android/macOS/Windows/Chrome extension + **MCP server** for AI agent access + REST API. VERIFIED — [getdex.com](https://getdex.com/) (fetched 2026-09-20). **The very existence of Dex's MCP server is a direct precedent to reference for omnis Network's design** — it means a commercial product has already solved the "agents read and write Network data" requirement via MCP.
- Monica (OSS PRM, PHP, AGPL-3.0, ★25,336): contact, relationship definitions, reminders (automatic birthdays), note, "how we met" record, activity, task, address/contact method, pet, diary, custom gender/activity type, favorite, multi-vault/multi-user, label, custom contact sheet section, multi-currency, 27 languages. VERIFIED — `gh api repos/monicahq/monica/readme` (2026-09-20).

**(4) Note → routing & auto-labeling**
- No product was found that explicitly advertises a direct "one-line memo → route to the right conversation/person" feature. The closest combination is folk's Follow-up Assistant (dormant conversation detection + tone-matched draft) and Superhuman Auto Labels (natural-language prompt → label rules). Synthesizing these two gets close to the pattern omnis wants. **This feature itself is unvalidated territory — it must be designed in-house.**
- Twenty CRM (TS, ★57,087, license `Other`/NOASSERTION = custom license, not purely open source, possibly restricts SaaS resale) provides a code-first entity model: each entity is a single TS file of the form `defineObject({ nameSingular, fields: [{name, type: FieldType.TEXT|CURRENCY|DATE_TIME}] })`, with Logic Functions (server-side TS triggered by HTTP route/cron/DB event), and Skills & Agents (reusable AI instructions + autonomous agents) supported as first-class concepts. Scaffolding via `npx create-twenty-app`, and an official agent-skills package for Claude Code/Codex/Cursor. VERIFIED — `gh repo view twentyhq/twenty`, [docs.twenty.com](https://docs.twenty.com/developers/extend/apps/getting-started) (2026-09-20).
- block/buzz (Rust, ★33,695, **Apache-2.0** — genuinely permissive OSS) is "A hive mind communication platform": on top of a Nostr relay it records every message, reaction, workflow step, review approval, and git event as a signed event. Humans and agents share the same channel membership, keys, and audit log. `buzz-cli` (agent-first, JSON in/out) + ACP harness (Goose/Codex/Claude Code integration), YAML workflows (message/reaction/schedule/webhook triggers), desktop app (Tauri+React). VERIFIED — `gh api repos/block/buzz/readme` (2026-09-20). **A direct architectural precedent for omnis's requirement that "an agent session = an inbox thread, and agents understand each other's sessions and act".**

## 3. Comparison table

| Area | Product | Key pattern | License/reusability | What omnis should take from it |
|---|---|---|---|---|
| Todo | Todoist Assist | Email forward → AI extraction → confirm | Closed-source SaaS | Capture UX (toggle, confirm step) |
| Todo | Motion/Reclaim | task → calendar auto-placement + re-optimization | Closed-source SaaS | The model where "a task is calendar time" |
| Todo | Akiflow | Multi-source Universal Inbox + daily planner | Closed-source SaaS | Cmd+K capture, Someday/week views |
| Todo (OSS) | Vikunja | List/Kanban/Gantt, self-hosting | AGPL-3.0 | AGPL means code reuse propagates AGPL to the distributed artifact — integrating via API only, or referencing just the UI/data model, is recommended |
| Briefing | kinso | urgency ranking + tone-matched draft + linking | Closed-source SaaS | Together with research 01, the target UX baseline |
| Briefing | Superhuman | Auto Labels (natural-language prompt) + Split Inbox + Instant Reply | Closed-source SaaS | Label-generation UX, the "draft already there when you open it" pattern |
| CRM (enterprise) | Clay.com, Attio | Event-triggered workflows, enrichment, agentic 24/7 | Closed-source SaaS | Reference for workflow engine design (trigger → action); not for personal use |
| CRM (personal) | Mesh (formerly Clay.earth) | Multi-channel auto-enrich + reconnect nudge + activity feed | Closed-source SaaS | UX copy, the feed concept |
| CRM (personal) | folk | People/Company/Object/Deal + Follow-up Assistant | Closed-source SaaS | **The closest precedent for note → routing** |
| CRM (personal) | Dex | 15+ source integration + MCP server + calendar-triggered brief | Closed-source SaaS (API + MCP public) | **Top-priority reference for Network design**, especially the MCP server pattern |
| CRM (OSS) | Monica | relationships/reminders/diary, self-hosting | AGPL-3.0 | Reference the data model and UI copy; beware AGPL propagation when forking code |
| CRM (OSS) | Twenty | code-first entity + workflow + agent skill | **Other (custom, possibly restricts resale)** | Reference the entity/workflow DSL design patterns; forking code directly requires license review |
| Agent architecture | block/buzz | agent = first-class member, signed event log, ACP harness | **Apache-2.0 (genuinely permissive)** | **Top-priority architectural reference for the "agent session = inbox thread" requirement; code can be reused** |

## 4. Recommendation for omnis

**Todo (effort M, low risk)**: Combine Motion/Reclaim's "task → calendar time block" model with Todoist's "extraction → confirm" capture. The MVP is (a) an LLM extracts action items from inbox messages and queues them as draft tasks, (b) Logan confirms each with a single action (swipe/tap), and (c) confirmed tasks get a Reclaim-style time block proposal on Google Calendar. The "the agent assigns work to Codex/Hermes first" part has no precedent in any competing product, so recognize it as an in-house design risk, and start narrow with a whitelist of "things the agent may do" (collecting files, writing drafts, etc.).

**Briefing (effort S~M, low risk)**: Adopt the kinso pattern (urgency ranking + tone-matched draft) as the target as-is, but for detailed affordances like "undo archive" there is no primary source, so simply reproduce Gmail's "Undo" snackbar UX (common knowledge, no separate verification needed). Superhuman Auto Labels' "natural-language prompt → label rules" UX can be ported directly into the auto-labeling feature.

**Personal CRM/Network (effort M, low-to-medium risk)**: **Make Dex the first-priority design reference** — multi-source integration, keep-in-touch reminders, calendar-triggered pre-meeting briefs, and decisively the **pattern of agents accessing it via MCP server** are all already validated in production. For the entity schema, reference Twenty's code-first `defineObject` approach, but do not fork the code directly (license `Other`, concerns about restrictions on SaaS resale) — borrow only the pattern. For follow-up automation, benchmark folk's Follow-up Assistant (dormant conversation detection → tone-matched draft) as-is.

**Note → routing (effort M, medium risk — new territory)**: With no commercial precedent, this feature must be designed as a combination of three things: folk Follow-up Assistant + Superhuman Auto Labels + kinso contextual linking: embed the note text → similarity-match against embeddings of recent conversations/contacts → require human confirmation when confidence is low. Since over-trusting it risks routing to the wrong person, start with "suggest only, never auto-send".

**Architecture spike (effort S, low risk, top priority)**: Before real implementation, clone and read the `block/buzz` (Apache-2.0, ★33.7k) source — its design, where "an agent is a channel member with its own keys and audit log, participating in the same event log as humans", matches omnis's "agent session = inbox thread" requirement exactly. Fetch it with `git clone --depth 1 https://github.com/block/buzz /private/tmp/claude-501/.../scratchpad/buzz` and review the message schema (NIP-style event format) and buzz-cli's JSON in/out protocol first.

## 5. What to borrow

- **Dex** — Use its entire Network entity model (contact consolidation logic, keep-in-touch reminder timing, pre-meeting brief trigger) and its **MCP server exposure pattern** as the primary blueprint for omnis's Network module design. ([getdex.com](https://getdex.com/))
- **folk** — Use the Follow-up Assistant's "detect dormant conversation → judge pending next step → tone-matched draft" logic as the algorithmic skeleton for the note-routing/auto-followup feature. ([folk.app](https://www.folk.app/))
- **Superhuman** — Port Auto Labels' "short natural-language prompt → label rules" UX and the Split Inbox tab layout directly into the auto-labeling and filter UI. ([superhuman.com/ai](https://superhuman.com/ai))
- **kinso** — The Morning Briefing ranking logic and the contextual linking concept (see `omnis/research/01-kinso-and-competitors.md` for details).
- **block/buzz** — Use its event log architecture that treats agents as first-class channel members, the `buzz-cli` JSON protocol, and the YAML workflow design (triggers: message/reaction/schedule/webhook) as a reference design for omnis's agent orchestration layer. The code is Apache-2.0, so it can be reused directly — `git clone --depth 1 https://github.com/block/buzz`.
- **Twenty** — Reference the code-first entity/field/workflow DSL in the form of `defineObject()` when designing omnis's data model, **pattern only** (forking code depends on verifying the `Other` license first).
- **Monica** — Use its relationship data model (birthday reminder, "how we met" field, diary) and multilingual UI copy as reference for the Network module's field design (AGPL-3.0, so beware license propagation when reusing code).
- **Vikunja** — Reference its Kanban/Gantt/Table multi-view UI patterns for the todo module's view design (AGPL-3.0; integrating via API is recommended).

## 6. Open questions

- Shortwave's actual AI features (daily recap, bundle, the specific auto-label logic) could not be confirmed due to a network error — needs re-investigation.
- The "note → routing" feature has no commercial precedent at all, so a separate design review is needed on how to manage the risk of losing user trust when accuracy is low or it misfires (confidence threshold, degree of human-in-the-loop).
- Legal confirmation is needed on what constraints Twenty's exact license terms (`Other`, GitHub NOASSERTION) place on omnis borrowing or embedding part of its code.
- Need to fetch the spec docs directly to confirm whether Dex's MCP server is a public spec and whether third parties can attach to it (whether our own app can read Dex data, or whether it is simply a structure where agents like Claude call Dex from inside Dex) — this round only looked at the getdex.com marketing page.
- How to reliably identify the other party (contact matching) when including messages from channels without APIs, such as KakaoTalk/LinkedIn, as targets for "note → routing" is outside this research's scope (requires cross-review with the channel research in 05/06).

## 7. Sources

- [Todoist Assist](https://www.todoist.com/todoist-assist) (2026-09-20)
- [Todoist AI Ramble — TechCrunch](https://techcrunch.com/2026/01/21/todoists-app-now-lets-you-add-tasks-to-your-to-do-list-by-speaking-to-its-ai/) (2026-09-20)
- [Motion](https://www.usemotion.com/) (2026-09-20)
- [Reclaim.ai](https://reclaim.ai/) (2026-09-20)
- [Akiflow](https://akiflow.com/) (2026-09-20)
- [Vikunja](https://vikunja.io/) + `gh repo view go-vikunja/vikunja` (2026-09-20)
- [Superhuman AI](https://superhuman.com/ai) (2026-09-20)
- [kinso.ai](https://www.kinso.ai/) (2026-09-20)
- [Clay.com](https://clay.com/) (2026-09-20)
- [Mesh (me.sh, formerly clay.earth)](https://me.sh/) (2026-09-20)
- [folk.app](https://www.folk.app/) (2026-09-20)
- [Attio](https://attio.com/) (2026-09-20)
- [Dex](https://getdex.com/) (2026-09-20)
- [Monica CRM README](https://github.com/monicahq/monica) via `gh api repos/monicahq/monica/readme` (2026-09-20)
- [Twenty CRM](https://github.com/twentyhq/twenty), [docs.twenty.com](https://docs.twenty.com/developers/extend/apps/getting-started) (2026-09-20)
- [block/buzz](https://github.com/block/buzz) via `gh api repos/block/buzz/readme` (2026-09-20)
- Internal cross-reference: `/Users/logankim/AI-Workspaces/Claude/omnis/research/01-kinso-and-competitors.md`
