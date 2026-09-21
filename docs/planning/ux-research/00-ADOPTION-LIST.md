# omnis UX Adoption List

Prioritized, concrete improvements distilled from the seven LENS research files in this folder, checked against what actually exists today in `apps/desktop/src` and `packages/ui/src`.

**Source of truth for the design rules:** `/Users/logankim/AI-Workspaces/omnis/docs/design/DESIGN-DIRECTION.md`.

## Baseline: what the code has today

Read before using this list — several items below are *fixes to a real defect*, not new features.

| Area | State in code |
|---|---|
| Shell layout | `app.css:26` `grid-template-columns: 76px minmax(0, 1fr)`; with detail open `app.css:35` `76px minmax(0,1fr) minmax(360px,34%)`. **No `min-width` floor on the list track** — the list pane shrinks toward 0 as the window narrows. This is the direct cause of "다 깨지잖아". |
| Responsive | Zero `@media`, zero `@container`, no `dvh`, no `env(safe-area-inset-*)` anywhere in `packages/ui/src` or `apps/desktop/src`. The only media query in the repo is `prefers-reduced-motion` in `tokens.css:66`. |
| Viewport | `apps/desktop/index.html` has **no `<meta name="viewport">` at all**. Any mobile/PWA render is currently at desktop-width zoom. |
| Filter pills | `app.css:197` `.inbox-card__pills { flex-wrap: wrap }` — pills wrap to a second line and push the list down as the pane narrows. |
| Row text | `.inbox-row__name` (`app.css:300`) has no truncation; only `.inbox-row__summary` truncates. Timestamps have no `tabular-nums` / fixed width (`app.css:319`). |
| Row height | `Inbox.tsx:91` `threadSummary()` returns `""` when no candidate survives → grid row 2 collapses to 0 height → **variable row heights inside a Virtuoso list**. |
| Approvals | `App.tsx:56` queries *all* pending approvals and `App.tsx:102` renders them in the detail pane regardless of which thread is open. Approval for thread B shows above thread A. |
| Keyboard | `use-keymap.ts` declares `j k e u r a s d l t n x` + `g`-prefixed go-to keys, but `Inbox.tsx:301` only handles `archive` / `unarchive`. `j`/`k` do nothing; there is no keyboard row focus (selection is click-only). |
| Command palette | Two `CommandPalette` instances (inline ask bar + ⌘K dialog) share one `actions` array that contains **exactly one action** (`App.tsx:73`, `go-inbox`). |
| Agent session | `AgentSession.tsx` renders each item as a bare `<p>` (or a `ToolCallBadge`). No timeline titles, no cost, no stop control, no live state. |
| Motion | `tokens.css` defines `--dur-fast/base/slow` and `--ease-spring`, and **nothing uses them**. No `transition` declarations exist in either package. |
| Glass | `tokens.css:73` `.glass-surface` = `blur(24px) saturate(1.4)` + hairline, no shadow, no inset highlight. `app.css:140` explicitly sets `backdrop-filter: none` on the ask bar pill. |
| Brand marks | `row-meta.ts` `RUNTIME_ICON` has no entry for `hermes` (falls back to letter "H") and maps `codex` → lucide `Bot`. `CHANNEL_COLOR` Gmail/GCal hexes are admitted approximations. All channel glyphs are single-colour. |
| Rail | `channel-rail.tsx:54` "더 보기" chevron is a dead button; avatar + settings buttons are placeholders. |

---

## Group A — Triage speed

### UX-01 · Keyboard row focus (`j` / `k`) with roving tabindex
- **Source pattern:** Superhuman keyboard triage — https://blog.superhuman.com/email-triage/ ; shortcuts sheet https://download.superhuman.com/Superhuman%20Keyboard%20Shortcuts.pdf
- **Outcome:** `j`/`k` (and ↑/↓) move a visible focus ring down/up the list without touching the mouse; the focused row scrolls into view; Enter opens it. Today `j`/`k` are declared in the keymap and silently do nothing.
- **Implementation:** `apps/desktop/src/screens/Inbox.tsx` — add `focusedIndex` state, handle `next-row`/`prev-row` in the existing `useKeymap` callback, call `virtuosoRef.scrollIntoView({ index })` (react-virtuoso ref API). `packages/ui/src/components/inbox-row.tsx` — take a `focused` prop, set `tabIndex={focused ? 0 : -1}` instead of a hard `tabIndex={0}` on every row (roving tabindex; today every one of 200 rows is a tab stop).
- **Acceptance check:** Playwright: load inbox, press `j` three times, assert the 4th `role="option"` has `:focus` and `aria-selected` semantics are unchanged; assert exactly one element in the listbox has `tabindex="0"`.
- **Effort:** M · **Round:** 1

### UX-02 · One-key triage verbs actually wired (`E` `R` `H` `U` `L`)
- **Source pattern:** Superhuman + Notion Mail converged single-letter grammar — https://www.notion.com/help/notion-mail-keyboard-shortcuts
- **Outcome:** The focused row can be archived, replied to, snoozed, marked unread or labelled without a click. Currently only `e`/`u` do anything, and only against the *clicked* row.
- **Implementation:** `Inbox.tsx` `useKeymap` callback — route `archive`/`reply`/`snooze`/`unarchive`/`label` against `focusedIndex`, not `selectedId`. `use-keymap.ts` already emits all five; add `Backspace`/`Delete` → `archive` (omnis has no destructive delete across read-only channel APIs). Keep `isEditableTarget` guard as-is.
- **Acceptance check:** Playwright: focus row 1 with `j`, press `e`, assert row count drops by one and the hub recorded `thread.archived` (the existing `phase-a.spec.ts` archive assertion already has this shape at line 267).
- **Effort:** M · **Round:** 1

### UX-03 · Command palette action registry with right-aligned shortcut hints
- **Source pattern:** Superhuman Command (⌘K teaches the shortcut at point of need) — https://blog.superhuman.com/how-to-manage-your-email-inbox/ ; Notion Mail Command Bar
- **Outcome:** Typing "archive" / "snooze" / "go to Slack" / "approve" in ⌘K finds the action and shows its key next to it, so shortcuts are learned once each instead of memorised up front. Today the palette has one entry.
- **Implementation:** New `apps/desktop/src/lib/actions.ts` building `PaletteAction[]` from three sources: triage verbs (bound to the focused row), navigation (one per connected channel from `App.tsx`'s `connectedChannels`, plus each agent session), approval decisions for the open thread. `command-palette.tsx` already renders `<kbd>{action.shortcut}</kbd>` — only CSS needs the right-alignment (`[cmdk-item]` is already `justify-content: space-between`).
- **Acceptance check:** Playwright: ⌘K, type "arch", assert an item labelled with the archive action is visible and its `kbd` reads `e`; press Enter and assert the focused row archived.
- **Effort:** M · **Round:** 1

### UX-04 · Live counts on filter pills + Tab / Shift+Tab cycling
- **Source pattern:** Superhuman Split Inbox — https://help.superhuman.com/hc/en-us/articles/38458483333907-Custom-Split-Inbox ; Shortwave Splits — https://www.shortwave.com/blog/split-email-inbox-by-importance/
- **Outcome:** Each pill shows how many threads are behind it, so the user picks a lane instead of re-deciding relevance row by row; Tab cycles lanes without leaving the keyboard.
- **Implementation:** `Inbox.tsx` — compute counts by running `filterInboxItems` over `channelFiltered` once per filter (the array is already ≤200 rows, no query needed). Render `{f} <span className="pill__count">{n}</span>`. Add a `keydown` handler on the radiogroup for Tab/Shift+Tab that moves the active pill and `preventDefault`s.
- **Acceptance check:** Playwright: assert `needs-approval` pill text matches the number of rows visible after clicking it; press Tab from `all` and assert `aria-checked` moved to `work`.
- **Effort:** S · **Round:** 1

### UX-05 · Blocked / needs-approval badge on the rail Inbox tile
- **Source pattern:** Shortwave splits surface counts before the lane is opened — https://www.shortwave.com/docs/guides/ai-assistant/
- **Outcome:** The "something needs me" signal is visible even when the user is filtered into a single channel, or when the list is scrolled away.
- **Implementation:** `packages/ui/src/components/channel-rail.tsx` — add an optional `attentionCount?: number` prop, render a small badge on the Inbox tile (`.channel-rail__tile--inbox`). `App.tsx` already has `approvals` in scope; add blocked agent sessions to the same count. Use the accent tone the status badge already uses for `blocked` (`app.css:419`), not a new red.
- **Acceptance check:** Screenshot diff of the rail with 0 vs 2 pending approvals; Playwright asserts the badge's accessible name contains the count.
- **Effort:** S · **Round:** 1

### UX-06 · Summary fallback that never collapses the row (no shimmer, no layout shift)
- **Source pattern:** kinso row-level AI summary; the degrade path the competitors are silent about (inbox-triage.md §3)
- **Outcome:** Every row is the same height whether or not a summary exists, and a summary arriving later cross-fades in place instead of reflowing the list. Today `threadSummary()` returns `""` and the row silently loses its second grid line.
- **Implementation:** `Inbox.tsx:81-92` — return the subject/first-line at lower emphasis rather than `""`; if there is genuinely nothing, render a non-breaking placeholder so grid row 2 keeps its height. `app.css:326` — give `.inbox-row__summary-line` a fixed `min-height`. Add `transition: opacity 120ms ease-out` on the summary span (explicitly **not** a skeleton shimmer — flagged as an AI-slop tell in inbox-triage.md).
- **Acceptance check:** Playwright: measure `boundingBox().height` of every visible row and assert all values are equal; seed one thread with no summary and one with a long summary.
- **Effort:** S · **Round:** 1

### UX-07 · Snooze as a first-class action with relative presets
- **Source pattern:** Front — https://help.front.com/en/articles/2189 ; Superhuman triage
- **Outcome:** "I can't decide now" has a one-key release valve (`H` → 1 hour / this evening / tomorrow morning / next week / pick a time) instead of leaving the row unread forever.
- **Implementation:** New `packages/ui/src/components/snooze-menu.tsx` (small popover, glass per the floating-layer rule). Wire `snooze` from `use-keymap.ts` and a hover icon button on the row. Backend: the repo already has scheduled-task infrastructure to schedule the un-snooze; store `threads.snoozed_until` and filter it out of the inbox view the same way `applyArchiveView` filters archived.
- **Acceptance check:** Playwright: focus a row, press `h`, choose "1 hour", assert the row leaves the list and appears under a "Snoozed" view; DB assertion that `snoozed_until` is set.
- **Effort:** M · **Round:** 2

### UX-08 · Hover action cluster that is genuinely hidden when hidden
- **Source pattern:** Front/Superhuman primary-action set on hover (snooze equal-weight to archive)
- **Outcome:** Archive / snooze / make-task appear as icon buttons on hover or keyboard focus, and are not reachable by Tab or screen reader while invisible. Today `.inbox-row__action` (`app.css:382`) is `opacity: 0` — still focusable, still a tab stop, still announced.
- **Implementation:** `app.css` — replace `opacity: 0` with `visibility: hidden` (or `display:none` toggled by the `:hover, :focus-within` rule that already exists at `app.css:385`), and swap the text labels ("보관"/"되살리기") for icon buttons with `aria-label`. `inbox-row.tsx:135` — render the cluster as one `<div className="inbox-row__actions">` so archive/snooze/task sit together.
- **Acceptance check:** Playwright: assert `inbox-row__action` is not in the accessibility tree before hover, and that hovering reveals exactly three labelled buttons.
- **Effort:** S · **Round:** 2

---

## Group B — Agent observability

### UX-09 · Titled timeline rows instead of a raw turn dump
- **Source pattern:** Devin Session Insights / Timeline — https://docs.devin.ai/product-guides/session-insights ; Claude managed-agent observability — https://platform.claude.com/docs/en/managed-agents/observability
- **Outcome:** An agent session scans like an email thread — "Ran `pytest`, 3 failures", "Edited 4 files in `auth/`" — collapsed by default, expandable to raw tool I/O. Today `AgentSession.tsx:67` prints `item.body` in a bare `<p>`.
- **Implementation:** `apps/desktop/src/screens/AgentSession.tsx` — render each item through a new `packages/ui/src/components/timeline-row.tsx`: runtime glyph + one-line title + relative time (reuse `formatRelativeTime`) + `<details>` for raw I/O. Titles come from the existing T1 DeepSeek summariser that already writes `threads.meta.summary`; store per-event on `agent_runs.events[]`.
- **Acceptance check:** Playwright: open the seeded agent thread, assert ≥1 `.timeline-row` with a non-empty title, assert raw body is *not* in the DOM until the row is expanded.
- **Effort:** M · **Round:** 1

### UX-10 · Approval cards scoped to the open thread, stacked, with batch approve
- **Source pattern:** Cursor per-command approval gate; HITL gating tiers (agent-observability.md §3)
- **Outcome:** An approval belonging to thread B no longer appears above thread A. When 2+ approvals are pending in the same thread they stack with one "Approve all safe" action. **This is a correctness fix**, not a nicety: `App.tsx:56` queries every pending approval and `App.tsx:102` renders them all into the detail pane unconditionally.
- **Implementation:** `App.tsx` — filter `approvals` by `thread_id === open?.threadId`; keep the "any approval exists" signal in the rail badge (UX-05) instead of in the pane. `packages/ui/src/components/approval-card.tsx` — add a stacked-container variant with the batch button, enabled only when every stacked interrupt is in the safe/reversible tier (see UX-11).
- **Acceptance check:** Playwright: seed an approval on thread B, open thread A, assert `.approval-card` count is 0 in the detail pane and the rail badge reads 1; open thread B and assert the card appears.
- **Effort:** M · **Round:** 1

### UX-11 · Approval card: reason line + risk tier badge
- **Source pattern:** HITL gate design — auto-approve reversible / notify recoverable / hard-gate irreversible — https://www.miniorange.com/blog/ai-kill-switch-architecture/
- **Outcome:** The card says *why* the agent wants this and how bad it is if wrong, so approving is a decision rather than a reflex. Today the card shows only `ACTION_LABEL` + `description`.
- **Implementation:** `packages/ui/src/components/approval-card.tsx` — add `reason?: string` and derive a tier from the existing `ApprovalCardAction` union (`send`/`calendar_write`/`delegate` = outward-effect, `delete` = destructive, `memory_write`/`self_model_edit` = reversible). Colour **only the badge**, never the card body (glass-motion.md's slop rule). Keep full text exposed, never summarised (DESIGN-DIRECTION rule).
- **Acceptance check:** Screenshot of the three tiers side by side; Playwright asserts `[data-tier="destructive"]` exists for a `delete` interrupt and that the card background colour token is unchanged between tiers.
- **Effort:** S · **Round:** 1

### UX-12 · Always-reachable Stop control + honest "stopped by you" log line
- **Source pattern:** External kill switch, one tap, outside the agent's own loop — https://pushary.com/ai-agent-kill-switch ; https://accuknox.com/blog/ai-kill-switch-agentic-ai
- **Outcome:** Any running agent session can be stopped from the detail-panel header without waiting for the agent's turn loop to notice, and the timeline records who stopped it and when.
- **Implementation:** `AgentSession.tsx` — add a persistent header row with a Stop button (not in a menu, not in the composer). Backend must kill at the host layer (process kill / token revoke), not by injecting a "please stop" message. Per-runtime capability check needed first (Claude Code / Codex / DeepSeek / Hermes differ — see agent-observability.md open questions). On success insert a `kind='system'` item, which `AgentSession.tsx:46` already renders as a system log line.
- **Acceptance check:** Playwright: start a seeded long-running session, click Stop, assert the status badge moves to `done`/`idle` within 2s and a system log line containing the stop time is present.
- **Effort:** S (UI) + per-runtime backend verification · **Round:** 1

### UX-13 · Session cost / token / duration pill in the agent thread header
- **Source pattern:** Braintrust trace rollup — https://www.braintrust.dev/foundations/how-to-read-a-trace ; Langfuse cost tracking — https://langfuse.com/docs/observability/features/token-and-cost-tracking
- **Outcome:** `$0.42 · 18.2k tok · 2m14s` at the top of the session answers "is this getting expensive" without leaving the thread. Per-step numbers stay on hover only — the full metric-per-row table is explicitly rejected as inbox slop.
- **Implementation:** Aggregate from `agent_runs` (already written on every run per DESIGN-DIRECTION). New `packages/ui/src/components/session-meter.tsx`. Self-hosted runtimes (Hermes) show duration + tokens and omit the dollar figure rather than printing `$0.00`.
- **Acceptance check:** Playwright: seed two runs on one session, assert the pill's token figure equals their sum; assert no per-row token badge is in the DOM without hover.
- **Effort:** S · **Round:** 2

### UX-14 · Typed activity entries + a live current-action line
- **Source pattern:** Linear Agent Interaction Guidelines — https://linear.app/developers/aig ; Vercel AI SDK stream states — https://ai-sdk.dev/docs/ai-sdk-ui/chatbot
- **Outcome:** Four shapes only — thought (muted italic), tool-call (mono chip), elicitation (the approval card), result (normal text) — and while a tool runs the panel says "Searching Gmail…" rather than spinning. No fifth shape gets invented.
- **Implementation:** `AgentSession.tsx` already branches on `kind ∈ {agent_turn, tool_call, system}`; add `thought` as a turn sub-type and route the existing `ToolCallBadge` (which already carries `loading|done|error`) as the tool-call shape. Add one live row at the tail bound to the current stream state. Confirm the turn-type field exists in `agent_runs` before adding one.
- **Acceptance check:** Playwright: assert exactly four distinct `[data-entry-kind]` values render for a seeded mixed session; assert the live row's text names the running tool, not a generic loading string.
- **Effort:** M · **Round:** 2

### UX-15 · One status source for row badge and detail header
- **Source pattern:** Codex Cloud's status disagreement between list, detail and CLI — https://github.com/openai/codex/issues/44845 (pattern to avoid)
- **Outcome:** The inbox row badge and the open session header can never disagree about whether an agent is working, blocked or done.
- **Implementation:** `agentSessionKinsoState()` in `packages/ui/src/lib/row-meta.ts` is already the single mapper — make `AgentSession.tsx` import and use it for its header instead of computing anything locally, and export one `useAgentState(threadId)` hook so both call sites share the query.
- **Acceptance check:** Vitest on `row-meta.ts` covering every `agent_sessions_state_ck` enum value; Playwright asserts the row badge text and the detail header badge text are identical strings for the same session.
- **Effort:** S · **Round:** 2

### UX-16 · Per-file diff review with per-file accept/reject
- **Source pattern:** Cursor Composer plan→diff→accept-per-file — https://www.learncursor.dev/learn/cursor-agents/agents-window ; Codex Cloud diff — https://developers.openai.com/codex/cloud
- **Outcome:** For coding-runtime sessions, a file list with ±counts, each row expandable to a real diff and individually approvable — instead of trust-everything-or-reject-everything.
- **Implementation:** Coding runtimes only (`claude_code`, `codex`, `claude_ds`); message-drafting runs stay on the existing Approve/Edit/Ignore card. Per DESIGN-DIRECTION's "don't build it yourself" rule, borrow the `cloudflare/agentic-inbox` diff component rather than writing a diff renderer.
- **Acceptance check:** Playwright: seed a 3-file run, approve file 2 only, assert files 1 and 3 remain pending and the session is not marked done.
- **Effort:** L · **Round:** 3

---

## Group C — AI panel

### UX-17 · One action registry, one answer renderer, two invocation depths
- **Source pattern:** Raycast Quick AI → AI Chat escalation — https://manual.raycast.com/ai ; Superhuman keeps ⌘K as the only front door — https://help.superhuman.com/hc/en-us/articles/46005676610829-Ask-AI
- **Outcome:** The inline ask bar and the ⌘K dialog are the same surface at two depths, never two competing launchers. Today both `CommandPalette` instances exist (`App.tsx:97`, `App.tsx:112`) but neither has any content to differentiate.
- **Implementation:** Keep `command-palette.tsx`'s existing `mode="inline" | "dialog"` split — it is already the right shape. Feed both from the UX-03 registry. Add an "escalate" path: once an answer plus one follow-up exist, slide the same content into the floating panel, preserving the query. Do not add a second input component.
- **Acceptance check:** Playwright: type a query in the inline bar, assert the answer renders under the pill; send a follow-up, assert the same text node is now inside the floating panel and the pill is back to placeholder.
- **Effort:** M · **Round:** 2

### UX-18 · Suggested-action pills above the input, per context type
- **Source pattern:** `ref-glass-mail-ai-panel.webp` (Draft a reply / Summarize / Extract); Notion Q&A panel — https://www.notion.com/blog/introducing-q-and-a
- **Outcome:** The panel answers "what can this even do" before the user types — cold start becomes one click. Email thread → Draft reply / Summarize / Extract action items; agent session → Summarize progress / Approve & continue / Ask why.
- **Implementation:** `command-palette.tsx` inline mode — render a pill row inside `.ask-bar` above the dropdown. The *set* of categories per context type is a fixed small map in code; the pill copy can be a DeepSeek one-liner.
- **Acceptance check:** Playwright: open a thread, focus the ask bar, assert exactly three pills whose labels match the email set; open an agent session and assert the agent set instead.
- **Effort:** S · **Round:** 1

### UX-19 · `@`-mention chips that scope the answer
- **Source pattern:** Raycast AI Chat "@" context sources — https://manual.raycast.com/ai ; Notion AI Connectors
- **Outcome:** "Answer this using Slack + this thread" is visible and removable as chips left of the caret, in the same mental model as an email To: chip.
- **Implementation:** `command-palette.tsx` — `@` opens a menu of channels (from `connectedChannels`), the open thread, an agent session, or "this week". Store the resolved scope alongside the query in `agent_runs` so the answer is reproducible.
- **Acceptance check:** Playwright: type `@`, pick Slack, assert a removable chip renders and the outgoing request body carries the scope; click the chip's ✕ and assert it is gone.
- **Effort:** M · **Round:** 2

### UX-20 · Runtime picker as a footer chip row
- **Source pattern:** Notion folded its model picker into the AI panel footer; Linear agent assignment — https://linear.app/docs/agents-in-linear
- **Outcome:** `Auto · Claude · Codex · DeepSeek · Hermes` with runtime logos at the bottom of the input — the secondary decision stays out of the way of the primary one, and it is always visible *which* runtime answered (Arc Max's silent dual-model routing is the named anti-pattern).
- **Implementation:** Footer segmented control in the inline panel. Reuse `RUNTIME_ICON` / `RUNTIME_LABEL` from `row-meta.ts` (see UX-33 for completing those marks). Selecting a non-Auto runtime is how a task is handed to a specific agent from the panel.
- **Acceptance check:** Playwright: assert five chips with accessible names matching `RUNTIME_LABEL`; select Codex, send a query, assert the resulting agent session row's runtime avatar is Codex.
- **Effort:** S · **Round:** 2

### UX-21 · Streaming answers with numbered citation chips
- **Source pattern:** Notion Q&A always cites sources — https://www.notion.com/help/guides/get-answers-about-content-faster-with-q-and-a
- **Outcome:** Every cross-channel answer carries `[1] [2]` chips that jump to the source message. This is the trust mechanism that makes a one-line AI answer usable without re-reading the thread — the highest-leverage item in the AI-panel group given omnis's whole premise.
- **Implementation:** New `packages/ui/src/components/citation-chip.tsx`; map model output to `items.id`. Confirm first that the unified message schema carries a jumpable per-message anchor across Slack / Gmail / KakaoTalk shapes (flagged as an open question in `ai-panel.md`).
- **Acceptance check:** Playwright: ask a question over a seeded thread, assert ≥1 citation chip, click it, assert the detail pane scrolled to the cited `items.id` element.
- **Effort:** M · **Round:** 2

### UX-22 · Ask bar as a real glass floating surface, never a docked sidebar
- **Source pattern:** `ref-glass-mail-ai-panel.webp`; anti-pattern: persistent full-height AI sidebars that steal reading width (ai-panel.md, patterns to avoid)
- **Outcome:** The panel floats over the inbox and dismisses; it never resizes the three-column layout. Today the ask bar sits in the document flow inside `.app-shell__main` and its dropdown (`.ask-bar__dropdown`) overlays correctly — keep that, and make the promoted panel a floating layer rather than a fourth grid track.
- **Implementation:** `app.css:161` — keep the dropdown absolute; add the promoted panel as `position: fixed` with the glass recipe from UX-32. Explicitly do **not** add a column to `.app-shell` / `.app-shell--with-detail`.
- **Acceptance check:** Playwright: measure `.inbox-card` width before and after opening the panel, assert they are equal.
- **Effort:** S · **Round:** 2

---

## Group D — Responsive / mobile

> This group is the direct answer to "이렇게 사이즈에 따라 요소들이 깨지지 않고 밸런스를 갖춘 채로 조정될 수 있게 해줘." Items UX-23 → UX-27 are the load-bearing fixes; do them in that order.

### UX-23 · Filter/chip rows scroll horizontally, never wrap
- **Source pattern:** Material chips guidance — https://m2.material.io/components/chips ; Linear filter bar — https://linear.app
- **Outcome:** The inbox header keeps a constant height at every pane width; the list no longer jumps down when pills wrap. Today `app.css:197` is `flex-wrap: wrap`.
- **Implementation:** `app.css` `.inbox-card__pills` → `flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none;` and `flex-shrink: 0` on each pill button. The clipped last pill is the "more" affordance. Cap pills at ≤7 (Superhuman's own ceiling).
- **Acceptance check:** Playwright at 1440px, 900px and 420px: assert `.inbox-card__header` `boundingBox().height` is identical at all three widths.
- **Effort:** S · **Round:** 1 — *do this one first, it is a few CSS lines*

### UX-24 · Tabular figures + fixed-width timestamp slot
- **Source pattern:** Linear / GitHub dense list trailing columns (responsive-density.md §3)
- **Outcome:** "3m", "12h" and "4 Aug" stop jittering the row; the meta line reads calm at high density.
- **Implementation:** `app.css:319` `.inbox-row__timestamp` → add `font-variant-numeric: tabular-nums; min-width: 44px;`. Apply to the same span wherever task rows and agent rows land later — one shared class, no breakpoint (correct at every width).
- **Acceptance check:** Screenshot diff of ten seeded rows with varying timestamps; Playwright asserts every `.inbox-row__timestamp` has the same `offsetWidth`.
- **Effort:** S · **Round:** 1

### UX-25 · Single-line truncation on the name too, and constant row height
- **Source pattern:** Linear / GitHub / Things 3 / Apple Mail all truncate rather than wrap (responsive-density.md §4)
- **Outcome:** A long sender name or thread title no longer pushes the timestamp and channel icon out of the row. Row height is identical for every row regardless of content — which also keeps Virtuoso's virtual scrolling honest.
- **Implementation:** `app.css:300` `.inbox-row__name` → `overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;` and `.inbox-row__meta` → `min-width: 0` (a grid/flex child will not shrink below content without it — this is the usual reason an ellipsis "does not work"). Add the native `title` attribute on name and summary for the full text; do not build a custom tooltip. Pairs with UX-06 for the summary side.
- **Acceptance check:** Playwright: seed a 120-character sender name, assert the row's `scrollWidth <= clientWidth` and that the channel icon is still visible at 420px container width.
- **Effort:** S · **Round:** 1

### UX-26 · Pane minimum widths, rail-collapses-first, detail-as-overlay
- **Source pattern:** Apple Mail (macOS) three-column → sidebar collapse → overlay; Things 3 on split-screen iPad (responsive-density.md §5)
- **Outcome:** **This is the fix for the breakage.** Nothing shrinks past its floor: below the combined minimum the rail collapses to icons, then the detail pane becomes a slide-over sheet and the list goes full-width — instead of all three columns squeezing into unreadable slivers.
- **Implementation:** `app.css:26` / `app.css:35` — give each track an explicit minimum: rail `76px` (collapsed `56px`), list `minmax(320px, 1fr)`, detail `minmax(360px, 34%)`. Add a `ResizeObserver` (or a container query on `.app-shell`) in `App.tsx`: under ~1100px drop to two tracks and render `.app-shell__detail` as `position: fixed` with the glass sheet treatment; under ~700px the list is the only track. Note `App.tsx:88` already conditionally mounts the detail track — extend that same flag rather than adding a parallel one.
- **Acceptance check:** Playwright at 1440 / 1100 / 900 / 700 / 420px with a thread open: assert `.inbox-card` width never drops below 320px, assert no horizontal page scrollbar at any width, and capture a screenshot at each width for the reviewer pass.
- **Effort:** L · **Round:** 1

### UX-27 · Container queries for row density tiers
- **Source pattern:** MDN / web.dev container queries — https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_containment/Container_queries ; https://web.dev/patterns/layout/container-query-card
- **Outcome:** Rows adapt to the *list pane's* width, so opening the detail pane degrades rows gracefully instead of leaving them sized for a window they no longer occupy. A viewport media query cannot tell those two cases apart.
- **Implementation:** `app.css` `.inbox-card` → `container-type: inline-size; container-name: inbox-list;`. Then `@container inbox-list (max-width: 560px)` hide the label chips and tighten the summary; `@container inbox-list (max-width: 380px)` move the channel glyph to a corner badge on the avatar and shrink the avatar to 32px. **Never drop** the channel identity or the blocked status badge entirely — reposition them (responsive-density.md, patterns to avoid).
- **Acceptance check:** Playwright: set the window to 1440px with the detail pane open (list ≈ 500px), assert chips are hidden; close the detail pane at the same window width and assert chips return. This is the assertion a viewport media query would fail.
- **Effort:** M · **Round:** 1

### UX-28 · Viewport meta, `100dvh` shell, and safe-area padding
- **Source pattern:** iOS 26 PWA platform notes — https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide ; https://itnext.io/make-your-pwas-look-handsome-on-ios-fd8fdfcd5777
- **Outcome:** On iPhone the app stops rendering at desktop zoom, stops clipping under the notch and home indicator, and stops scrolling under system chrome. `apps/desktop/index.html` currently has **no viewport meta tag at all** — this is the cheapest high-impact fix in the whole list.
- **Implementation:** `apps/desktop/index.html` — add `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`. `app.css:3` — replace `html, body, #root { height: 100% }` with `100dvh` (`100svh` where an always-safe floor matters; `100%` is relative to the parent, not the real viewport, in standalone mode — the single most-cited iOS PWA bug). Pad every fixed edge element with `env(safe-area-inset-*)`, scoping the top inset to `@media (display-mode: standalone)` only.
- **Acceptance check:** Playwright with an iPhone device descriptor: assert no horizontal scroll, assert the app shell's height equals the viewport height, and screenshot with a simulated inset to confirm nothing is clipped.
- **Effort:** S (but thread it through every fixed element — treat as a checklist) · **Round:** 1

### UX-29 · Bottom tab bar below ~700px, glass chrome over opaque content
- **Source pattern:** Superhuman iOS nav — https://help.superhuman.com/hc/en-us/articles/38458290528531-Mobile-Navigation ; Linear mobile frosted toolbar — https://linear.app/changelog/2025-10-16-mobile-app-redesign
- **Outcome:** Below the phone breakpoint the left rail (unreachable one-handed) is replaced by a thumb-reachable Inbox / Agents / Tasks / Network tab bar, with the ask bar pinned at top. Linear converged on exactly omnis's existing "glass on chrome, opaque content" split on mobile — the desktop rule carries through unchanged.
- **Implementation:** New `packages/ui/src/components/bottom-tab-bar.tsx` rendering the same `RailSelection` type `channel-rail.tsx` already uses, so state and handlers are shared. Swap in `App.tsx` at the UX-26 breakpoint. Apply the UX-32 glass recipe + `env(safe-area-inset-bottom)` from UX-28.
- **Acceptance check:** Playwright at 420px: assert `.channel-rail` is absent and the tab bar is present with four labelled tabs; assert its bottom edge clears the simulated home indicator.
- **Effort:** M · **Round:** 2

### UX-30 · Rail collapse-to-icon + a real overflow menu
- **Source pattern:** Apple Mail sidebar auto-collapse; Linear sidebar-collapse-to-icon-rail — https://linear.app
- **Outcome:** The rail gets narrower before anything else breaks, and the "더 보기" chevron actually opens the channels that no longer fit. Today `channel-rail.tsx:54` is a dead button with a `ponytail:` comment saying so.
- **Implementation:** `channel-rail.tsx` — accept a `collapsed` prop from the UX-26 mode switch (44px tiles → 32px, hide the avatar/settings labels). Wire the chevron to a popover listing overflow channels once `channels.length` exceeds what fits.
- **Acceptance check:** Playwright: seed 12 connected accounts, assert the rail renders ≤8 tiles plus a chevron, click it and assert the remainder are listed.
- **Effort:** S · **Round:** 2

### UX-31 · Swipe row actions (short + long, both directions)
- **Source pattern:** Spark swipes — https://sparkmailapp.com/help/manage-your-inbox/manage-emails-with-swipes ; Superhuman iOS swipes — https://help.superhuman.com/hc/en-us/articles/46005853744525-Swiping-Around-Superhuman-Mail
- **Outcome:** On touch, right-short = archive, right-long = snooze, left-short = pin, left-long = channel-specific quick action (reply for chat channels, approve for agent-approval rows) — the two most common triage moves without opening the row.
- **Implementation:** One swipeable wrapper around `InboxRow`, reused later by Tasks. Keep the identical row grammar as desktop; the swipe only reveals coloured action backgrounds. Do not hand-roll drag physics — use the same library chosen for UX-34.
- **Acceptance check:** Playwright touch emulation: `dispatchEvent` a horizontal drag past 35% width and assert the row archives; drag to 20% and release, assert it springs back unchanged.
- **Effort:** M · **Round:** 3

### UX-32 · Bottom sheet with snap points for approvals and agent detail on mobile
- **Source pattern:** Telegram/iOS draggable sheets — https://github.com/alishari/TelegramBottomSheet ; `vaul`-style snap points
- **Outcome:** The approval card peeks (summary + Approve/Edit/Ignore), drags up to full (body + edit field), and dismisses by drag — no screen transition, no web-modal feel.
- **Implementation:** One reusable `BottomSheet` with 2–3 snap points, used for the approval card and agent-run detail at the UX-26 mobile mode. Glass on the sheet chrome only; content inside stays opaque.
- **Acceptance check:** Playwright touch: assert the sheet's height matches the peek snap point on open, drag up and assert it matches the full snap point, drag down past the threshold and assert it unmounts.
- **Effort:** M · **Round:** 3

---

## Group E — Glass + motion (and the brand marks)

### UX-33 · Complete and correct the brand marks
- **Source pattern:** kinso reference (`reference/kinso-inbox.webp`) real multitone channel logos; `POLISH-LOG.md` already documents exactly what is missing
- **Outcome:** This is the direct answer to "보이는 로고들 제대로 알맞게 넣어주고." Every channel and every runtime shows its real mark at the right size and colour, instead of a lucide `Bot` for Codex, a bare letter "H" for Hermes, and approximated Google hexes.
- **Implementation:** `packages/ui/src/lib/row-meta.ts` — `RUNTIME_ICON` has no `hermes` entry and maps `codex` → lucide `Bot`; ship real SVG marks as local assets under `packages/ui/src/assets/` and point `RUNTIME_ICON` at them (single choke point, both the rail and the row already go through `ChannelGlyph`/`RowAvatarView`). Replace the admitted Gmail `#EA4335` / GCal `#4285F4` approximations with the real multitone Gmail mark. Keep the KakaoTalk tile exception (`CHANNEL_TILE_BG`) as-is — it is correct.
- **Acceptance check:** Playwright: seed one thread per channel and one session per runtime; assert every `.inbox-row__avatar--runtime` and every `.inbox-row__channel-icon` contains an `<svg>` (not a text node), and capture one screenshot of the full rail + one row per channel for reviewer comparison against `reference/kinso-inbox.webp`.
- **Effort:** M · **Round:** 1

### UX-34 · The real glass recipe: blur + saturate + hairline + shadow + inset highlight
- **Source pattern:** Apple HIG Materials / Liquid Glass — https://www.createwithswift.com/liquid-glass-redefining-design-through-hierarchy-harmony-and-consistency/ ; Raycast layered palette — https://oh-my-design.kr/design-systems/raycast
- **Outcome:** Glass surfaces read as frosted and physically raised rather than "grayed out" or "photoshopped transparency". Today `tokens.css:73` is `blur(24px) saturate(1.4)` with a hairline and *no shadow*, and `app.css:140` explicitly turns `backdrop-filter` **off** on the ask bar pill — the one surface most in need of it.
- **Implementation:** `tokens.css` `.glass-surface` → `backdrop-filter: blur(20px) saturate(180%)`, background `rgba(255,255,255,0.65)` equivalent in oklch, `border: 1px solid oklch(0 0 0 / 0.06)`, `box-shadow: 0 8px 24px oklch(0 0 0 / 0.08)`. For the two highest-attention surfaces (⌘K palette, AI panel) add `inset 0 1px 0 oklch(1 0 0 / 0.5)` for the top-edge highlight; skip the inset on the rail (cheap and always visible). Glass stays on rail / ask bar / palette / sheets only — never on `.inbox-row`, `.inbox-card` or the thread body.
- **Acceptance check:** Playwright: assert `getComputedStyle('.glass-surface').backdropFilter` contains both `blur` and `saturate` on the palette and the ask bar; assert `.inbox-row` and `.inbox-card` have `backdropFilter: none`.
- **Effort:** S · **Round:** 1

### UX-35 · Reduced-transparency and `@supports` fallbacks
- **Source pattern:** Liquid Glass accessibility critique — https://letsdev.de/en/blog/ios-26-in-detail-liquid-glass-ui-between-usability-and-accessibility.php
- **Outcome:** On a machine with reduce-transparency on, or a browser without `backdrop-filter`, glass surfaces fall back to a solid fill instead of rendering as a washed-out unreadable panel.
- **Implementation:** `tokens.css` — add `@supports not (backdrop-filter: blur(1px))` and `@media (prefers-reduced-transparency: reduce)` blocks that set `.glass-surface { background: var(--bg-base); backdrop-filter: none; }`. `tokens.css:66` already does the equivalent for reduced motion, so the pattern is established in the file.
- **Acceptance check:** Playwright with `prefers-reduced-transparency: reduce` emulated: assert `backdropFilter` is `none` and the computed background is fully opaque.
- **Effort:** S · **Round:** 2

### UX-36 · Spring motion tiers, interruptible, with CSS for everything else
- **Source pattern:** motion.dev `spring({ visualDuration, bounce })` — https://motion.dev/docs/spring ; Vercel Web Interface Guidelines restraint — https://vercel.com/design/guidelines
- **Outcome:** Panels, row selection, list reorder and status-badge changes move with a settled, interruptible spring (entry 160ms / transition 240ms / layer 320ms, bounce 0.1–0.15); everything else is a plain 150–200ms CSS colour transition. Today `--dur-fast/base/slow` and `--ease-spring` are declared in `tokens.css:44-47` and **used nowhere** — the app has literally zero transitions.
- **Implementation:** Confirm whether Motion is already pulled in transitively before adding a dependency (DESIGN-DIRECTION "don't build it yourself"). Reserve JS springs for: panel open/close, row selection, reorder, approval success, status badge change. Everything else: CSS `transition` on `color` / `background-color` / `border-color` / `box-shadow` only — never `width`/`height`/`padding`/`margin`. Never `ease-in` for an entrance.
- **Acceptance check:** Vitest/Playwright: assert `getComputedStyle` on a pill button reports a non-zero `transition-duration` and that the property list contains no layout properties; with `prefers-reduced-motion: reduce` emulated, assert durations are 0 (the token block at `tokens.css:66` already handles this once the tokens are actually consumed).
- **Effort:** M · **Round:** 2

### UX-37 · Animated selection elevation + slop audit pass
- **Source pattern:** kinso selected-row card (already in DESIGN-DIRECTION); Linear spring list behaviour — https://linear.app/now/behind-the-latest-design-refresh ; AI-slop tells — https://smoothui.dev/blog/ai-design-slop
- **Outcome:** Selecting a row lifts it (shadow + 1px rise) over the 160ms entry spring instead of snapping; and a standing checklist keeps the named slop tells out (purple/violet gradients beyond the single ask-orb exception, glass on content, bounce-on-hover, uniform glass card grids, six identical cards in a row).
- **Implementation:** `app.css:254` `.inbox-row--selected` — animate `box-shadow` and `transform: translateY(-1px)` rather than applying them instantly. Add the slop checklist to `docs/design/POLISH-LOG.md` as the reviewer's rejection criteria (DESIGN-DIRECTION already names the criteria; this makes them a checked list).
- **Acceptance check:** Screenshot before/after selection; reviewer pass against `reference/kinso-inbox.webp` with the checklist. Playwright asserts the ask-bar orb is the only element whose computed background contains a gradient.
- **Effort:** S · **Round:** 2

---

## Group F — CRM / tasks / notes

### UX-38 · "Make task" as an explicit one-click action (never background extraction)
- **Source pattern:** Sunsama Slack→task, and its deliberate refusal to auto-parse email — https://www.sunsama.com/integrations/slack ; https://help.sunsama.com/docs/usage-guides/daily-planning/
- **Outcome:** Any row or message becomes a task pre-filled with its first line and backlinked to the source thread, chosen by the user. Blanket NLP task extraction stays out — it is the trust-eroding failure mode both Sunsama and DESIGN-DIRECTION call out.
- **Implementation:** Add to the UX-08 hover cluster and to the UX-03 palette registry (the keymap already reserves `t` → `add-task`). Insert a `tasks` row with `source_thread_id`. The one permitted automation: agent sessions in `blocked` state auto-generate a task, because that is a structured signal, not free-text inference.
- **Acceptance check:** Playwright: focus a row, press `t`, assert a task exists in the DB with the correct `source_thread_id` and that clicking it opens the source thread.
- **Effort:** S · **Round:** 2

### UX-39 · Tasks view = "Today" flat list + "Later" backlog, reusing the inbox row
- **Source pattern:** Sunsama daily planning — https://www.sunsama.com/daily-planning ; anti-pattern: Kanban as the default solo-user view
- **Outcome:** Tasks read like the inbox — one ordered list for today, an unordered backlog beneath — rather than a multi-column board a single user does not need.
- **Implementation:** Reuse `InboxRow` with a checkbox in the avatar slot and a due chip in the trailing slot; no new list primitive. The nightly digest's "3 things to plan for tomorrow" links straight into this list.
- **Acceptance check:** Playwright: assert the Tasks screen renders `role="option"` rows using the same `.inbox-row` class as the inbox (proving reuse, not a parallel component), and that checking one moves it out of Today.
- **Effort:** M · **Round:** 3

### UX-40 · Person card with a merged cross-channel timeline
- **Source pattern:** Clay/Mesh auto-built contact cards — https://www.buildfastwithai.com/ai-tools/clay-crm ; Dex — https://getdex.com/ ; Obsidian automatic backlinks — https://obsidian.md/help/backlinks
- **Outcome:** A person in Network expands into the existing detail panel showing avatar, role, and one merged timeline (last Slack DM + last email + last WhatsApp + last calendar event) — no blank CRM form, no required fields, no separate sub-app shell.
- **Implementation:** Reuse the `.app-shell__detail` pane and the row primitives — Network must not become a visually distinct module. The timeline is a join over the existing `threads`/`messages` tables grouped by contact, not new ingestion. `@Name` mentions in notes write into the same timeline (the timeline *is* the backlink list).
- **Acceptance check:** Playwright: seed one person with messages on three channels, open their card, assert three timeline entries in descending time order each carrying the correct channel glyph.
- **Effort:** M · **Round:** 3

---

## Round summary

| Round | Theme | Ids |
|---|---|---|
| **1** | Stop the breakage; make triage real; put the logos in | UX-01, UX-02, UX-03, UX-04, UX-05, UX-06, UX-09, UX-10, UX-11, UX-12, UX-18, UX-23, UX-24, UX-25, UX-26, UX-27, UX-28, UX-33, UX-34 |
| **2** | Depth: agent trust surface, AI panel, motion, mobile nav | UX-07, UX-08, UX-13, UX-14, UX-15, UX-17, UX-19, UX-20, UX-21, UX-22, UX-29, UX-30, UX-35, UX-36, UX-37, UX-38 |
| **3** | Touch gestures, diffs, CRM/tasks | UX-16, UX-31, UX-32, UX-39, UX-40 |

Suggested round-1 ordering: **UX-23 → UX-25 → UX-24 → UX-28 → UX-26 → UX-27** (cheap CSS first, then the layout-shell work that the container queries depend on), then UX-33, then the triage and agent items.

## Open questions carried forward from the LENS files

- Does every runtime (DeepSeek, Hermes) emit the structured stream states that UX-14's four entry shapes assume, or is a per-runtime normalisation shim needed first?
- Is there a genuine *external* cancel path for cloud-run agents (Codex Cloud, Claude managed agents), or only a provider-queued cancel? UX-12's "always reachable, outside the agent's loop" promise depends on the answer.
- Does the unified message schema already carry a stable jumpable anchor per message across Slack / Gmail / KakaoTalk? UX-21's citation chips are blocked on this.
- At the narrowest container width (UX-27), do the channel glyph and the agent status badge coexist as stacked corner badges on the avatar, or does the channel glyph yield because the runtime logo already identifies the source? Needs a 320px mock before deciding.
- Exact reduced-transparency fallback colour (UX-35) needs a real token value once the off-white canvas token is finalised.
