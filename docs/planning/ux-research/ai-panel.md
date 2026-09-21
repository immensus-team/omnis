# AI panel UX research — floating ask/command panels

Lens: Raycast AI, Arc Max, Notion AI (Q&A), Linear AI agents, Superhuman Ask AI, Spotlight-style command palettes. For omnis's always-on "Start typing to ask or search" bar and its expansion into a floating AI panel (per `docs/design/DESIGN-DIRECTION.md`, ref `ref-glass-mail-ai-panel.webp`).

## Products studied (URLs)

- Raycast AI Chat — https://www.raycast.com/core-features/ai , https://manual.raycast.com/ai , https://manual.raycast.com/new-in-v2
- Raycast Screen Awareness / Quick AI launch coverage — https://9to5mac.com/2026/08/12/raycast-adds-a-new-way-to-ask-ai-about-whatever-is-on-your-screen/ , https://alternativeto.net/news/2026/6/raycast-launches-ai-chat-and-inline-replace-features-for-windows-and-mac/
- Arc Max (Ask on Page, Tidy Tabs, 5-Second Previews) — https://arc.net/max , https://supasidebar.com/blog/arc-browser-ai-features-2026 , https://seraphicsecurity.com/learn/ai-browser/arc-max-ai-add-on-features-pros-cons-and-migrating-to-dia-browser/
- Notion AI Q&A — https://www.notion.com/blog/introducing-q-and-a , https://www.notion.com/help/guides/get-answers-about-content-faster-with-q-and-a
- Linear AI agents / Agent Interaction Guidelines (AIG) — https://linear.app/docs/agents-in-linear , https://linear.app/developers/aig , https://linear.app/now/our-approach-to-building-the-agent-interaction-sdk , https://linear.app/changelog/2025-07-30-agent-interaction-guidelines-and-sdk , https://linear.app/agents
- Superhuman Ask AI — https://blog.superhuman.com/ask-ai/ , https://help.superhuman.com/hc/en-us/articles/46005676610829-Ask-AI , https://help.superhuman.com/hc/en-us/articles/45266774244883-Your-AI-Assistant
- Grok browser integrations (Ask Grok on X, Grok Everywhere sidepanel) — https://chromewebstore.google.com/detail/ask-grok/kbhnnffloedjfonnapokghoklipaenph , https://chromewebstore.google.com/detail/grok-everywhere/onddcpahoenacjcgkldfegocdgdgajpn

## Patterns worth adopting

### 1. One command surface, two invocation depths (Raycast Quick AI + full AI Chat)
**What:** A single ⌘K-style bar answers small questions inline (Quick AI, one-shot, closes after answering) but the same input can "graduate" into a full AI Chat panel with history, branching, and projects when the exchange gets long.
**Why it works:** Most asks are one-liners ("summarize this thread," "when's my next meeting") that don't deserve a persistent panel; forcing every query into a heavyweight chat window adds friction. Letting the surface escalate only when needed keeps the common case fast.
**Implementation for omnis:** The top pill bar (already spec'd) stays the Quick-AI layer — type, get a streamed one-shot answer inline under the bar, dismiss with Esc. Add a "Continue in panel →" affordance (or auto-promote once the answer + a follow-up exceed ~2 turns) that slides the same content into the floating glass AI panel from `ref-glass-mail-ai-panel.webp`, preserving the query. Do not build two separate input components.
**Effort:** M (state machine: collapsed pill → inline answer → promoted panel; reuse one streaming-answer renderer).

### 2. @-mention chips to scope context, not just people
**What:** Raycast's AI Chat "@" menu inserts context sources (Screen Awareness, a focused window, a file) as chips inside the input, not just people. Notion's unified AI panel similarly pulls in AI Connectors (Slack, Drive, GitHub, Linear, Notion Mail) as scoped, chip-like sources for an answer.
**Why it works:** Users think in terms of "answer this using X," and a chip makes the scope visible and removable — it's the same mental model as an email "To:" chip, so it needs no explanation.
**Implementation for omnis:** In the ask bar and the floating panel, "@" opens a menu of: channels (Gmail, Slack, Calendar…), the currently open thread, an agent session, or "this week." Selected scope renders as a removable chip left of the caret. Store the resolved scope alongside the query so the same answer is reproducible from `agent_runs`.
**Effort:** M (menu + chip component + passing scope into the retrieval/prompt call).

### 3. Suggested actions row above the input, not buried in a menu
**What:** The glass-mail reference panel and Notion's Q&A panel both surface 3–4 one-tap suggested actions ("Draft a reply," "Summarize," "Extract") as pills sitting just above or beside the text input, before the user has typed anything.
**Why it works:** It answers "what can this thing even do" at the moment of first contact, and turns a blank-canvas cold-start into a one-click action — the single biggest driver of AI-panel activation in these products.
**Implementation for omnis:** When the panel opens with a thread/agent session in context, populate 3 pills from that context's type (email thread → Draft reply / Summarize / Extract action items; agent session → Summarize progress / Approve & continue / Ask why). Pills are DeepSeek-tier one-liners, not hardcoded strings, but the *set* of pill categories per context type is fixed and small.
**Effort:** S (static pill set per context type; wire each to an existing prompt template).

### 4. Model/agent picker as a footer control, not a header dropdown
**What:** Notion folded its Q&A picker into the general AI panel's footer; assistant-ui/Halaska-style model pickers and Linear's agent assignment both put the "who answers this" control at the bottom of the input, styled as a small chip/segmented control (Auto / Claude / Gemini / GPT, or Agent chips above an Effort row).
**Why it works:** The model/agent choice is a secondary decision made *after* the user has already started typing their real question — putting it at the top competes with the input for attention and gets ignored or fat-fingered.
**Implementation for omnis's multi-runtime reality:** Footer chip row: `Auto` (routes to DeepSeek T1 by default) · `Claude` · `Codex` · `Hermes`, each showing its runtime logo. Selecting a non-Auto runtime is how a user explicitly hands a task to a specific agent from inside the panel, which maps directly onto omnis's agent-session-as-thread model.
**Effort:** S (footer segmented control; routing logic likely already exists for agent dispatch).

### 5. Streaming answer with inline, numbered citations
**What:** Notion Q&A streams the answer and attaches numbered source pills inline (and a source list at the end) rather than a wall of unlinked text; "always cites sources" became a hard rule as of March 2026 per their own changelog.
**Why it works:** Unified-inbox answers ("what did Sarah say she needs") are worthless if the user can't jump to the original message in one click — citations are the trust mechanism that makes a one-line AI summary usable without re-reading the thread.
**Implementation for omnis:** Every panel answer that references inbox content renders small numbered chips `[1] [2]` inline, each a clickable jump-to-message-in-thread. Reuse the same citation renderer already implied by the AI-summary-in-row spec ("Wants you to share a sales contract…") — this is the same DeepSeek summarization pipeline, just multi-turn.
**Effort:** M (citation renderer + mapping model output to source message IDs — this is the highest-leverage item on this list given omnis's whole premise is trustworthy cross-channel answers).

### 6. Explicit, typed states for agent work (Linear's AIG)
**What:** Linear's Agent Interaction Guidelines standardize agent status into a small enum — thinking / waiting for input / executing / errored / done — and require structured activity entries (tool calls, thoughts, elicitations) rather than a raw log dump.
**Why it works:** Once agent sessions are threads in the same inbox as human messages, the *status badge* is doing the job a green "online" dot does for a person — it has to be legible at a glance in a list, not just inside the open thread.
**Implementation for omnis:** This is already directionally decided (idle/working/blocked/done, herdr-style). Adopt Linear's activity-entry typing for the *inside* of an agent thread specifically: render each turn as one of {thought, tool-call, elicitation, result}, each with its own compact visual treatment (thought = muted italic, tool-call = monospace chip with tool name, elicitation = the blocking approval card already spec'd, result = normal message). Don't invent a 5th shape.
**Effort:** M (four small renderers keyed off an existing `agent_runs`/turn-type field — confirm the field exists before adding one).

### 7. Command-K stays the front door even inside a feature-rich AI surface (Superhuman)
**What:** Superhuman's Ask AI has real capability (90-day chat history, cross-source search over inbox+calendar+web) but the *entry point* is still the same ⌘K bar used for every other command, not a separate icon or menu.
**Why it works:** One muscle-memory shortcut for "do anything" beats N shortcuts for N features; discoverability comes from the bar always being visible, not from teaching a new gesture.
**Implementation for omnis:** ⌘K opens the same pill/palette already at the top of the screen; it is not a second launcher. Ask-AI-style queries and plain navigation/search share one input and one result list, differentiated only by whether the top result is a streamed answer card or a list of matches.
**Effort:** S (already the direction; mainly a discipline constraint — don't add a second AI entry point later).

## Patterns to avoid

- **Ask on Page's silent dual-model routing (Arc Max):** Arc Max routes some features to OpenAI and others (Ask on Page) to Claude without surfacing this to the user. For omnis, always show which runtime/model answered (the footer chip in #4 already does this) — a unified inbox that silently swaps AI providers per-feature will erode the trust that citations (#5) are trying to build.
- **Feature sprawl without a single home (Arc Max):** Tidy Tabs, Tidy Titles, 5-Second Previews, Ask on Page, ChatGPT integration each live in different menus/shortcuts. Keep every omnis AI capability reachable from the one ask bar (#7) — don't let individual features grow their own entry points.
- **Assistant panel that competes with the primary content for width (generic AI sidebar pattern):** A persistent full-height AI sidebar (common in many AI-browser sidepanels) permanently steals list/reading width. omnis's panel should float and dismiss (glass, per DESIGN-DIRECTION), never dock and resize the inbox layout by default.
- **Standalone Q&A as a separate top-level feature (pre-2026 Notion):** Notion originally shipped Q&A as its own button/surface, then folded it into the general AI panel because users didn't know which entry point to use for which question. Don't ship a separate "Ask" feature distinct from the panel described in #1–#4 — one surface, escalating depth.

## Open questions

- What should the panel do when a query spans channels the user hasn't connected yet (e.g. asks about WhatsApp before that connector is set up) — inline connect-prompt inside the answer, or a silent gap?
- For agent-session threads, does "Continue in panel" (#1) let the user redirect a running agent mid-task, or is the panel read-only until the agent reaches an elicitation/approval point? This affects whether the footer runtime picker (#4) is enabled while an agent turn is in flight.
- Citation chips (#5) need a stable per-message anchor across channels with very different message models (a Slack message vs. a Gmail thread vs. a KakaoTalk bubble) — confirm the unified message schema already carries a jumpable ID before committing to the renderer.
- Should Quick AI's one-shot answer (#1) be allowed to trigger a side effect (e.g. "snooze this") without ever opening the full panel, or does every action-with-a-side-effect force promotion to the panel for an explicit approval step (consistent with omnis's "approvals before anything leaves" rule)?
