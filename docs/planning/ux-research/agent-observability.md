# Agent Session Observability UX — Research for omnis

Scope: how real products surface live agent activity — tool-call timelines, cost/token meters, approval interrupts, diffs, logs, kill switch, retry, streaming states — so omnis's agent-session inbox threads (Claude Code, Codex, DeepSeek, Hermes) can borrow proven patterns instead of inventing UI.

## Products studied (URLs)

- **Claude Agent SDK / Claude Console managed-agent observability** — https://platform.claude.com/docs/en/managed-agents/observability, https://openobserve.ai/blog/claude-agent-sdk-observability-opentelemetry/, https://www.arthur.ai/blog/claude-code-observability-tracing-with-arthur
- **Claude Code community dashboards** (agents-observe, Channels) — https://www.blog.brightcoding.dev/2026/08/07/simple10agents-observe-real-time-dashboard-for-claude-code-sessions, https://ranjankumar.in/claude-code-observability-debugging
- **Cursor Agent panel / Composer** — https://www.learncursor.dev/learn/cursor-agents/agents-window, https://cursor.com/docs/cli/changelog, https://forum.cursor.com/t/reopening-cursor-requires-re-approval-of-past-agent-changes-diffs/155566, https://forum.cursor.com/t/in-agent-panel-cursor-doesn-t-show-inline-diff-in-main-editor-window/164681
- **OpenAI Codex Cloud** — https://developers.openai.com/codex/cloud, https://prlens.dev/guides/how-to-review-codex-pull-requests, https://github.com/openai/codex/issues/44845, https://github.com/openai/codex/issues/46174
- **Devin (Cognition) Session Insights / Timeline / Replay** — https://docs.devin.ai/product-guides/session-insights, https://fast.io/resources/devin-session-tools-guide/, https://clawmetry.com/runtimes/devin
- **Langfuse trace UI** — https://langfuse.com/docs/observability/features/token-and-cost-tracking, https://langfuse.com/docs/metrics/features/custom-dashboards, https://towardsdatascience.com/llm-monitoring-and-observability-hands-on-with-langfuse/
- **Braintrust trace viewer** — https://www.braintrust.dev/product/observe, https://www.braintrust.dev/docs/observe/examine-traces, https://www.braintrust.dev/foundations/how-to-read-a-trace
- **Grok / xAI + Vercel AI SDK chat & tool-loop streaming** — https://ai-sdk.dev/docs/ai-sdk-ui/chatbot, https://ai-sdk.dev/docs/reference/ai-sdk-core/create-agent-ui-stream-response, https://www.aisdkagents.com/patterns/chat-grok
- **Kill-switch / HITL approval-gate design** — https://www.miniorange.com/blog/ai-kill-switch-architecture/, https://accuknox.com/blog/ai-kill-switch-agentic-ai, https://pushary.com/ai-agent-kill-switch

## Patterns worth adopting

### 1. Chronological, titled timeline of session events (not a raw log dump)
**What:** Devin's Timeline shows each session as a color-coded sequence of discrete events (progress, obstacle, recovery), each with a short title + one-line description, not a scrolling console. Claude Console's managed-agent view does the same: a chronological event list (content, timestamps, token usage) with tool-execution detail expandable per event.
**Why it works:** raw stdout/tool-call logs are unscannable; a titled timeline lets you skim "what happened" in 2 seconds and drill in only where needed — same mental model as an email thread.
**Implementation notes for omnis:** in the agent-session thread detail panel, render each turn as a timeline row: icon (runtime logo) + one-line title ("Ran `pytest`, 3 failures" / "Edited 4 files in `auth/`") + relative time, collapsed by default; click to expand raw tool I/O. Store as `agent_runs.events[]` with `{title, kind, ts, detail}`; the T1 DeepSeek summarizer that already produces the thread's AI one-liner can also produce each event's title.
**Effort:** M (event schema + collapsible row component; summarization reuses existing T1 pipeline).

### 2. Inline per-step cost/token meter, rolled up to parent
**What:** Braintrust and Langfuse both show token count + latency + estimated cost as inline metrics on every span row, and Braintrust propagates cost from child spans up to parents so a multi-step trace shows total cost at the top and the expensive step highlighted inside.
**Why it works:** cost anxiety is the #1 reason people don't trust autonomous agents; a running total answers "is this getting expensive" without leaving the thread.
**Implementation notes for omnis:** header of the agent-session thread shows a small pill: `$0.42 · 18.2k tok · 2m14s` (session totals), updated live; each timeline row can show a smaller `+1.1k tok` badge on hover only — don't clutter every row by default (avoid AI-slop density). Source the numbers from `agent_runs` (already logs every run per DESIGN-DIRECTION.md).
**Effort:** S (aggregation query + pill component; data already captured).

### 3. Approval interrupt as a first-class card, not a modal
**What:** Cursor's per-command approval gate and the general HITL "gate" pattern (auto-approve reversible / notify recoverable / hard-gate irreversible) show the action, the agent's reasoning, what will change, and an undo path, and let you batch-approve rather than clicking through one at a time.
**Why it works:** a blocking modal forces a context switch; an inline card in the same thread keeps the approval in its narrative context and lets the user scroll past other threads without losing the pending action.
**Implementation notes for omnis:** already decided in DESIGN-DIRECTION.md — approval cards render at the top of the detail panel in the kinso card style (full text exposed, Approve / Edit & send / Ignore). Add: (a) a reason line ("wants to send this because…"), (b) tier badge (safe/reversible vs destructive, colored only on the badge, not the whole card, to avoid slop), (c) when 2+ approvals are pending in the same thread, stack them with a single "Approve all safe" batch action. blocked-status threads sort to top of inbox per existing design.
**Effort:** S–M (card already speced; add tiering + batch action).

### 4. Diff-first review for code/file-changing agents, reject-per-file not all-or-nothing
**What:** Cursor's Composer loop is plan → preview diff → accept/reject per file → apply; Codex Cloud gives a summary + diff to inspect before a PR exists, with `codex cloud diff TASK_ID` as a first-class object.
**Why it works:** granular accept/reject matches how people actually review changes — they trust 4 of 5 files and want to poke at the 5th, not gate the whole run on one line.
**Implementation notes for omnis:** when an agent run touches files/code (not just a message draft), render a compact file list with +/− counts, each row expandable to a real diff view, each row individually approvable. This is a Claude/Codex/DeepSeek-specific run type — reuse `cloudflare/agentic-inbox`'s diff component per the design doc's "don't build it yourself" principle.
**Effort:** L (diff rendering + per-file approval state; biggest lift here, but only needed for coding-agent threads, not chat/Slack-style ones — scope to Claude Code/Codex/DeepSeek runtimes first).

### 5. Explicit streaming/thinking state, not a bare spinner
**What:** the Vercel AI SDK `useChat`/`ToolLoopAgent` model exposes discrete states (submitted, streaming, tool-call-in-progress, awaiting-approval, error) that UIs map to distinct visual treatments, with cancellation via `AbortSignal` wired to a visible stop control.
**Why it works:** "thinking…" vs "running `grep`…" vs "waiting for your approval" are different waits with different user actions available; collapsing them into one spinner hides whether the user should act now.
**Implementation notes for omnis:** status badge on the agent thread row (already planned: idle/working/blocked/done per herdr model) should map 1:1 to these SDK-level states, and the detail panel's live row should show the *current* tool name while it runs ("Searching Gmail…") rather than a generic loader. Cheap to add since the runtime SDKs already emit these states as structured events.
**Effort:** S (map SDK stream events to existing status enum + one live "current action" line).

### 6. Kill switch that is external to the agent's own action loop, always reachable
**What:** the kill-switch literature is explicit that an "internal" switch the agent can read/write around is not a real switch — it must live in a layer the agent has no access to, revoking credentials/session immediately, and be reachable via one tap regardless of what the agent is mid-doing (see Pushary's "stop Claude Code or Codex in one tap").
**Why it works:** matches omnis's own "approvals before anything leaves" principle — the stop control must not depend on the agent's own turn loop to notice it.
**Implementation notes for omnis:** every agent-session thread gets a persistent Stop control in the detail panel header (not inside the composer, not gated behind a menu), calling a host-side kill (revoke session token / SIGKILL the runtime process) rather than sending a "please stop" message into the agent's context. Pair with a visible "stopped by you at 3:41p" system line in the timeline so the record is honest.
**Effort:** S (UI is trivial; backend must ensure the kill path doesn't route through the agent's own tool-call queue — verify per runtime, DeepSeek/Hermes may need a process-level kill vs an API-level cancel).

### 7. Session replay / rollback to a point in time
**What:** Devin records every terminal command, file edit, and browser action into a full replay timeline and lets you roll back both files and memory state to any prior point.
**Why it works:** the natural recovery action after "the agent went down a bad path" isn't reading logs, it's rewinding.
**Implementation notes for omnis:** lower priority than 1–6, but worth a v2 slot: a "rewind to here" affordance on any timeline event for coding-runtime threads (git-backed, so this is mostly wiring the timeline UI to `git reset`/worktree snapshot rather than new storage).
**Effort:** L, defer.

## Patterns to avoid

- **Modal-blocking approval dialogs that halt the whole app** (older Cursor mode-switch pager had a 15s auto-reject countdown UI reported as confusing/lossy) — keep approvals inline and undismissable-by-timeout; a forgotten approval should stay pending forever, not silently reject or silently proceed.
- **Status ambiguity across surfaces** — Codex Cloud users reported the task list, task detail page, and CLI disagreeing on state (Failed vs Working vs Pending) for the same task. omnis has one status source (`agent_runs`); never let the inbox row and the detail panel compute status independently.
- **Dense metric-per-row overload** — Langfuse/Braintrust's full trace tables (tokens, cost, latency, model, tags on every single span) are correct for a dedicated observability tool but are AI-slop-dense for an inbox; only the session/thread aggregate belongs in the default view, per-step numbers stay behind a hover/expand.
- **Generic spinner-only loading states** — collapses distinguishable waits (thinking vs tool-running vs blocked-on-you) into one state, per pattern 5 above; explicitly reject at review time per the design doc's slop checklist.
- **All-or-nothing diff approval** — forces trust-everything-or-reject-everything on multi-file agent output; reject in review.

## Open questions

- Does DeepSeek's and Hermes's runtime emit the same structured stream-state events (submitted/streaming/tool-call/error) that Claude Code and Codex do, or does omnis need a normalization shim per runtime before status badges can be 1:1 with pattern 5?
- Cost/token pill (pattern 2): DeepSeek pricing is token-based but Hermes may be self-hosted/flat-cost — does the pill show "$0.00 (self-hosted)" or hide entirely per runtime?
- Kill switch (pattern 6): for cloud-run agents (Codex Cloud, Claude managed agents) is there actually an external revoke path omnis can call, or only a "cancel" API that still routes through the provider's own queue? Needs a per-provider capability check before the "external, always-reachable" promise can be made real.
- Diff view (pattern 4) scope: does it also apply to Hermes/DeepSeek runs that only draft messages (no file diffs), or is diff-review strictly a coding-runtime feature and message-drafting runs stay on the existing Approve/Edit/Ignore card only?
- Replay/rollback (pattern 7): worth scoping now or explicitly punting to a dated backlog item so it doesn't silently expand v1?
