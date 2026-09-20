# omnis — Product Definition Draft v0.1

Author: Fable, 2026-09-20. Status: draft before the research sweep results are incorporated. It contains only what can be settled independently of research; §10 will be decided after research.

## 0. One-line definition

omnis is a personal operating system that gathers everything coming to me (people's messages, the calendar, agent progress and results) into a single inbox, and makes agents holding my context work first so that I only make decisions.

## 1. Problem

- Seven contact channels (Slack, KakaoTalk, Gmail, Outlook, Telegram, LinkedIn, WhatsApp), four kinds of agents (Claude, Codex, DeepSeek, Hermes), and the calendar are scattered across different apps, different devices, and different contexts.
- Channels without APIs (KakaoTalk, LinkedIn) are tied to a single device, so they cannot be viewed from a MacBook and an iPhone at the same time.
- Agent sessions are trapped in terminals and chat windows, so they do not appear as part of "my work." There is no way to tell at a glance which agent on which device is doing what.
- The context about me (what commitments I have with whom, how far along which project is) lives only in my head, so I stitch together replies, follow-ups, and todos by hand every time.

## 2. Theses

1. **Everything is an inbox.** Whether it is a message from a person or an agent's progress, everything that demands my attention goes into the same queue. An agent session is just "a thread where one of the participants is an agent."
2. **Context is the product.** The inbox is the surface; the real asset is the unified context (memory) about me. Every feature reads from this memory and writes to it. Memory is filled not only from the inbox but also from the calendar, local files, Drive, and GitHub.
3. **Agents act first, I decide.** The default is "agents do the classification, drafting, todos, and delegation first, and I only approve, edit, or reject." However, actions that go outside (sending, confirming a schedule) must always pass through my approval gate.

## 3. Users and success criteria

- v1 user: Logan alone. Founder, 7 channels, 4 kinds of agents, 3 devices (Mac mini hub, MacBook, iPhone).
- v2 users: founders and operators with the same profile. The point at which standalone deployment (MacBook + iPhone without a hub) works.

Success criteria (only what is measurable; numbers to be adjusted after the first month of measurement):

| Metric | Target |
|---|---|
| Morning briefing coverage | Of the items actually handled that day, the share that were already in the briefing ≥ 80% |
| Draft adoption rate | Of the replies sent, the share that started from an agent draft ≥ 50% |
| Unedited send rate | Share sent without editing the draft ≥ 20% |
| Missed follow-ups | Zero follow-ups left unsent within 48 hours after a meeting |
| Opening the source channel app directly | 5 times a week or fewer, excluding KakaoTalk and LinkedIn |
| Monthly LLM cost | Fixed ceiling (number after research); on overrun, automatic downgrade to a cheaper tier |

## 4. Architecture and goals derived from it

### Architecture: kernel + 4 layers

- **L0 Kernel**: append-only event log (all inbound, outbound, and agent events), scheduler (briefing, digest, follow-up timers), permissions and approval gate, audit log, cross-device session routing. The same code whether the hub is the Mac mini or inside the MacBook app.
- **L1 Adapters**: normalize channels and agents into the same Item schema. Each adapter declares its capabilities (read, write, realtime, history, media) and the UI shows things according to those capabilities. API channels (Slack, Gmail, Outlook, Telegram, WhatsApp, Calendar), capture channels (KakaoTalk, LinkedIn), and agent channels (Claude Code, Codex, DeepSeek, Hermes) all belong here.
- **L2 Context**: extract people, organizations, projects, commitments, decisions, and preferences from the inbox, calendar, local files, Drive, and GitHub, and unify them into memory with temporality (as-of). All agents read from and write to the same memory.
- **L3 Agents**: classification (work/personal, topic, person labels), reply drafting, todo extraction and reminders, delegation (to which agent on which device), briefing and digest, post-meeting follow-up, note routing.
- **L4 Surfaces**: the Mac app and the iPhone app. Inbox, agent sessions, todos, Network, notes, and digest live within the same UI grammar.

### Goals

| # | Goal | Layer | Acceptance criteria |
|---|---|---|---|
| G1 | Every channel enters a single queue in real time | L0, L1 | API channel latency ≤ 5 s, capture channel ≤ 60 s |
| G2 | Control from anywhere. Read, reply, and archive are reflected in the source channel | L1 | Write-back scope per channel is specified and the UI shows that scope honestly |
| G3 | One context. People, projects, commitments, and decisions accumulate in memory and every agent sees the same memory | L2 | No matter which agent you ask, it answers with the same facts as of the same point in time |
| G4 | Agents work first. Drafts, todos, labels, and delegation are ready before I look, and the approval gate is respected | L3 | Zero external sends without approval; draft ready within 60 s of inbound |
| G5 | One screen. Inbox and agent sessions in the same grammar, Apple-native, Mac and iPhone synced in real time | L4 | Cross-device state reflection within 2 s |
| G6 | Standalone-capable. The boundary between hub and client is a module boundary, not a process boundary | L0 | Launching the hub inside the MacBook app still syncs the iPhone as-is |
| G7 | Cost. Cheap-model-first routing, caching, local models, monthly ceiling | L3 | Automatic downgrade on ceiling overrun, monthly report |
| G8 | Safety. Inbox content is untrusted input, external sends require approval, and every agent action is recorded in the audit log | L0 | Passes the prompt injection test set, zero missing audit log entries |

## 5. Non-goals (v1)

- Team and multi-user collaboration. buzz already does this area, and omnis is a one-person operating system.
- Full replacement of source channel apps. Channel-specific features such as calls, stickers, and large media are handed off to the source app.
- The full feature set of an email client (rules engine, folder management). Focus on triage and replies.
- Training our own models. Solve it with routing and prompts.

## 6. Core objects (draft)

| Object | Definition |
|---|---|
| Account | A login unit for a channel. One Slack workspace, one Gmail account |
| Channel | Adapter type and capability declaration |
| Thread | Conversation unit. A conversation with a person, an email thread, and an agent session are all Threads |
| Item | A single unit within a Thread. A message, an email, a calendar event, an agent turn, a system event |
| Person / Org | People and organizations. Unifies identities across channels into one and carries labels and relationship state |
| Label | work/personal, topic, priority. Auto-assigned + manual correction |
| Task | A to-do created by an agent or by me. Source Item, assignee (me or a specific agent), state |
| AgentSession | A Thread attached to an agent runtime on a given device |
| Draft | A reply draft for a specific Thread. Includes the rationale (which memory and Items were used) |
| Action | An action going outside. Approval state (pending, approved, sent, rejected) |
| Note | A short note I toss in. Has a routing result (which Thread, which Person) |
| Memory | A fact with temporality. Source, as-of, confidence |
| Digest | Morning briefing, evening archive summary |

## 7. Key scenarios

- **S1 06:30 in the morning**: A one-page briefing. Today's schedule, what came in overnight in priority order, drafts waiting for approval, yesterday's archive summary. Approve, edit, and snooze from a single screen.
- **S2 real time**: A partner sends "Can you do 2 PM tomorrow?" on KakaoTalk. A draft that checked the calendar and a push notification arrive on the iPhone. On approval, the Mac mini sends it to KakaoTalk and creates a hold on the calendar.
- **S3 delegation**: "Please organize last quarter's data" arrives by email. The agent creates a Task and, judging that local files on the MacBook are needed, delegates to the Codex session on the MacBook. Progress shows up in the inbox thread, and a reply draft with the results attached waits for approval.
- **S4 after a meeting**: A calendar event ends. Attendees are updated in Network, and a follow-up draft is prepared (an introduction format if it is a first meeting). When I toss in a one-line note, it is reflected on that person and that thread.
- **S5 22:00 at night**: A summary of what was auto-archived today. Anything buried by mistake is restored in one go.

## 8. Design principles

- Greenfield. Does not depend on the Mac mini's existing setup (Hermes configuration, omh, buzz relay). omnis replaces all of it.
- Hub-agnostic. The hub is the Mac mini now, and later a process inside the MacBook app. The same code runs.
- Adapters declare capabilities and the UI promises only those capabilities. It does not pretend to do what it cannot.
- Egress is approval-based by default. Autonomous sending can be opened per person or per channel, but the default is approval.
- Inbox content is untrusted input. Agent instructions and data are separated.
- Cheap-first. Classification and labeling use a local or cheapest model, drafting a mid tier, and only delegation that requires judgment the upper tier.
- Local-first data. My data lives on my devices and the cloud is used only for model calls.
- Apple-native UI grammar. Keyboard-first on Mac, one-handed operation first on iPhone.

## 9. Phases (adjusted after research)

- Phase A: Kernel + inbox core. 2 API channels + 1 kind of agent session + Mac client.
- Phase B: Memory + drafts + briefing and digest + iPhone.
- Phase C: KakaoTalk and LinkedIn capture + todos and delegation + Network + note routing.
- Phase D: standalone (embedded hub) + distribution.

## 10. To be decided after research

1. Chat channel aggregation layer: whether to use the Beeper local API, self-hosted mautrix, or our own adapters.
2. Agent session bus: design our own bus. buzz (Nostr + ACP) and Hermes's omh are references for ideas only, not a foundation. The Mac mini's current setup is entirely replaced by omnis (Logan's decision, 2026-09-20).
3. Memory: which OSS to use. Sharing with Hermes memory is not considered.
4. Harness: what to layer on top of the Vercel AI SDK (durable execution, scheduler).
5. Client and sync: Tauri, PWA, or Swift, and what the sync engine is.
6. Model policy and monthly cost.
7. KakaoTalk and LinkedIn capture paths and account suspension risk.
