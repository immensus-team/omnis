# GAP 3: Reading the source of the three inbox+agent+approval reference implementations

Fetched 2026-09-20 via `gh api`/`gh repo view` against live repos, plus `git clone --depth 1` into scratchpad and direct file reads (not README-level — actual source: `.ts`, `.tsx`, `.rs`, `ARCHITECTURE.md`). Repos: `block/buzz`, `cloudflare/agentic-inbox`, `langchain-ai/agent-inbox`.

## 1. TL;DR

Having read the source of all three repos directly, the one most directly usable for omnis's Draft/Action schema is **agentic-inbox**: a Draft is not a separate table but just a single Email row with `folder_id='draft'`, and `send_email`/`send_reply` are structurally absent from the LLM tool list — "you can't send without consent" is enforced not by a prompt rule but by the **design of the tool set**. **agent-inbox** has, on top of LangGraph's `interrupt()`/`Command(resume=...)`, the types `HumanInterrupt{action_request, config:{allow_accept/edit/respond/ignore}, description}` / `HumanResponse{type, args}`, which can be ported into omnis's Action object almost verbatim. **buzz**'s `request_approval` workflow action is defined through kinds 46010–46012, but the implementation is explicitly broken ("does not resume") (🚧 WF-08) — of the three repos, agent-inbox is the only one whose approval/resume actually works.

## 2. Facts

**agentic-inbox (cloudflare/agentic-inbox)**
- Apache-2.0, ★7,942, created 2026-04-10, **`pushed_at` 2026-04-23** — the last commit was 5 months ago. A snapshot whose maintenance has effectively stopped relative to its star count. VERIFIED — `gh api repos/cloudflare/agentic-inbox`, fetched 2026-09-20.
- Stack: React 19 + React Router v7 (Cloudflare Workers, Hono), SQLite per Durable Object (Drizzle ORM), R2 attachments, Cloudflare Agents SDK `AIChatAgent`, AI SDK v6 (`ai@^6.0.116`), Workers AI model `@cf/moonshotai/kimi-k2.5`. VERIFIED — `package.json`, `workers/agent/index.ts` fetched 2026-09-20.
- **Item schema**: `workers/db/schema.ts` — a single `emails` table (`id, folder_id, subject, sender, recipient, cc, bcc, date, read, starred, body, in_reply_to, email_references, thread_id, message_id, raw_headers`), a `folders` table (`id, name, is_deletable`), and an `attachments` table. **There is no separate `drafts` table** — a draft is an ordinary email row with `folder_id = Folders.DRAFT`. VERIFIED — read the files directly, fetched 2026-09-20.
- **Draft creation logic**: `workers/lib/tools.ts` `toolDraftReply`/`toolDraftEmail` — creates an email row via `stub.createEmail(Folders.DRAFT, {...})` and returns `{status:"draft_saved", draftId, message:"Draft saved to Drafts folder. Review it and confirm to send."}`. `toolUpdateDraft` **does not update in place; it deletes the old draft and recreates it with a new UUID** (there is a comment about running verify first before rewriting to prevent data loss). VERIFIED, fetched 2026-09-20.
- **Structural separation of the tool set**: the in-app chat agent (`workers/agent/index.ts` `createEmailTools`) exposes exactly 9 tools — `list_emails, get_email, get_thread, search_emails, draft_email, draft_reply, mark_email_read, move_email, discard_draft`. **`send_email`/`send_reply` are not among them.** Those two tools are registered only in `workers/mcp/index.ts` (for external MCP clients, e.g. Claude Desktop), and are simply not callable from the in-app agent's tool-calling loop. The README's phrase "9 email tools" matches exactly these 9 (count verified). VERIFIED — read both files directly, fetched 2026-09-20.
- **Approval UX**: the system prompt has a `## CRITICAL: Draft Only - Never Send` section, but the actual safeguard is not the prompt — it is the tool set itself (previous item). The `DraftActions` component in `app/components/AgentPanel.tsx` renders an **"Edit & send in composer"** button on messages that carry a `draft_reply`/`draft_email` tool part → clicking it opens `ComposePanel` pre-filled with the draft, and only when the human explicitly presses the "Send" button (`handleSend`) is the actual send route called. That is the entire approval state machine: `create draft row → "Edit & send" button → human edits (optional) → explicit Send click → create sent row`. VERIFIED — read `AgentPanel.tsx`, `ComposePanel.tsx` directly, fetched 2026-09-20.
- **Streaming tool call rendering**: the `TOOL_LABELS` record in `AgentPanel.tsx` defines a tool-name → `{label, icon}` mapping (e.g. `draft_reply → "Drafting reply" + PaperPlaneTiltIcon`), and `ToolCallBadge` uses the `state` of the AI SDK `UIMessage` part (`output-available`/`result`/`output-error` = done, anything else = loading spinner) to distinguish in-progress from complete and render it as a badge. VERIFIED — read directly, fetched 2026-09-20.
- **Automatic defense**: when a new email arrives, `handleNewEmail` scans the email body and the full thread with `isPromptInjection(env.AI, text)` before creating a draft, and on detecting an injection it skips draft creation and only leaves a warning in the chat. VERIFIED, fetched 2026-09-20.
- **MCP tool count**: `workers/mcp/index.ts` has 13 actual registration call sites (`this.server.tool(`) but 12 unique tools by name (`list_mailboxes, list_emails, get_email, get_thread, search_emails, draft_reply, create_draft, update_draft, delete_email, send_reply, send_email, mark_email_read, move_email`) — the task briefing's "9 email tools" is only correct for the in-app agent and understates the full MCP surface. VERIFIED (recounted), fetched 2026-09-20.

**agent-inbox (langchain-ai/agent-inbox)**
- MIT, ★1,092, created 2024-11-04, **pushed 2026-09-18** — actively maintained as recently as 2 days ago (in contrast to agentic-inbox). VERIFIED — `gh api repos/langchain-ai/agent-inbox`, fetched 2026-09-20.
- Stack: Next.js 16.3.4, React 19, `@langchain/langgraph-sdk@^1.9.25`, `@langchain/core@^1.2.10`, Tailwind + shadcn-style components. VERIFIED — `package.json`, fetched 2026-09-20.
- **Action/Draft schema** (`src/components/agent-inbox/types.ts`, entire file read directly):
  ```ts
  interface HumanInterruptConfig {
    allow_ignore: boolean; allow_respond: boolean;
    allow_edit: boolean; allow_accept: boolean;
  }
  interface ActionRequest { action: string; args: Record<string, any>; }
  interface HumanInterrupt {
    action_request: ActionRequest;
    config: HumanInterruptConfig;
    description?: string;
  }
  type HumanResponse = {
    type: "accept" | "ignore" | "response" | "edit";
    args: null | string | ActionRequest;
  };
  ```
  Thread state is a discriminated union: `status: "idle"|"busy"|"error"` (no interrupts) vs `"interrupted"|"human_response_needed"` (has interrupts). VERIFIED, fetched 2026-09-20.
- **Resume mechanism**: `sendHumanResponse` in `contexts/ThreadContext.tsx` → `client.runs.stream(threadId, graphId, { command: { resume: response } })` (the standard LangGraph SDK `interrupt()`/`Command(resume=...)` pattern). `hooks/use-interrupted-actions.tsx` builds the array of human-chosen responses and passes it to this function, and tracks per-`langgraph_node` progress (`currentNode`) while consuming the response stream. VERIFIED — read both files directly, fetched 2026-09-20.
- **Human response UI**: of the four actions (accept/edit/respond/ignore), only those the graph permits via `config` are exposed as buttons. Inside `handleSubmit` there is logic that automatically downgrades an `edit` response to `accept` when it is "accept allowed + not edited" (to avoid unnecessary diffs). `generic-interrupt-value.tsx` is a generic component that renders `action_request.args` (arbitrary JSON) with a collapsed/full-view toggle — color-coding strings/numbers/booleans/arrays/objects by type. VERIFIED, fetched 2026-09-20.
- The email demo graph lives in a separate repo (another langchain-ai repo); this repo itself is a generic viewer that "renders whatever value any LangGraph graph throws from `interrupt()`" — from omnis's perspective it is valuable only as a **Draft/Action UX skeleton**, and it has no email-specific logic (that side lives in agentic-inbox). VERIFIED (repo structure confirmed), fetched 2026-09-20.

**buzz (block/buzz)** — research item 02 already verified this down to the README/ARCHITECTURE level, but this pass extracted the workflow schema and kind constants directly from the files:
- `ARCHITECTURE.md` §"buzz-workflow": 4 trigger types (`message_posted, reaction_added, schedule, webhook`), 7 action types (`send_message, send_dm, set_channel_topic, add_reaction, call_webhook, request_approval, delay`). YAML example (verbatim):
  ```yaml
  name: "Incident Triage"
  trigger:
    on: message_posted
    filter: "str_contains(trigger_text, 'P1')"
  steps:
    - id: notify
      action: send_message
      text: "P1 incident detected: {{trigger.text}}"
    - id: page
      if: "str_contains(trigger_text, 'production')"
      action: request_approval
      from: "{{trigger.author}}"
      message: "Page on-call?"
  ```
  VERIFIED — fetched directly, 2026-09-20.
- **`request_approval` is currently broken**: "returns `StepResult::Suspended` with a generated UUID token, but the engine does not yet persist the token or resume execution — runs that hit an approval gate are marked as failed (🚧 WF-08)." `execute_from_step()` exists only "for future resume support". VERIFIED — `ARCHITECTURE.md` verbatim, fetched 2026-09-20.
- Confirmed the approval-related kind constants directly in `crates/buzz-core/src/kind.rs`: `KIND_WORKFLOW_APPROVAL_REQUESTED=46010`, `KIND_WORKFLOW_APPROVAL_GRANTED=46011`, `KIND_WORKFLOW_APPROVAL_DENIED=46012`, plus `KIND_APPROVAL_GRANT=46030`, `KIND_APPROVAL_DENY=46031`, which appear to be the human-sent response events (a separate range, split off from the workflow execution events 46001–46012 — the code comments give no explanation for the split; reason UNVERIFIED). VERIFIED — read the file directly, fetched 2026-09-20.
- Draft-related kinds exist only in the git domain (`KIND_GIT_STATUS_DRAFT=1633`, NIP-34) — buzz has no general-purpose "Draft" object/kind at the email/message level. For omnis's Draft requirement (an item that has a draft state), buzz has no directly corresponding concept. VERIFIED (a full grep of kind.rs found draft-related matches only in the git domain), fetched 2026-09-20.

## 3. Options / comparison

| Axis | agentic-inbox | agent-inbox | buzz |
|---|---|---|---|
| Maturity/maintenance | ★7,942, **no commits for 5 months** (snapshot) | ★1,092, commit 2 days ago (active) | ★33.7k, daily-ish, but approval itself is unfinished |
| Draft object | Same table as Item(email), distinguished only by `folder_id` | None (generic viewer; the graph defines the domain object) | No Draft concept (git domain is the only exception) |
| Action approval schema | None (replaced by code-level tool separation) | **`HumanInterrupt`/`HumanResponse`, 4-way config** | `request_approval` action is defined but **non-functional** |
| Approval enforcement point | The tool set itself (send tools are never in the agent's hands to begin with) | LangGraph `interrupt()`, called explicitly by the graph author | Workflow engine (broken) |
| Resume | Unnecessary (there is no "execution" to resume after approval — the draft is already complete and the human just presses a button) | `Command(resume=response)`, first-class support | Designed but unimplemented |
| Streaming tool call UI | `TOOL_LABELS` map + state badges, email-domain specific | `tool-call-table.tsx`, `generic-interrupt-value.tsx` — generic JSON renderer | Not applicable (chat UI, a different concept from tool calls) |
| Where it fits omnis | **Item/Draft schema**, tool isolation pattern, "Edit & send" gate UX | **Action/Interrupt schema**, 4-way response, resume protocol | Event kind taxonomy (design reference only; code not reused) |

## 4. Recommendation for omnis

**Do not create a separate object for Draft; model it as a state of Item** (the agentic-inbox pattern, effort S, low risk). A single field on the `items` table such as `status: 'received' | 'draft' | 'sent' | 'archived'` is enough — what agentic-inbox proves is that "a multi-channel inbox + agent drafts work fine without a dedicated Draft table or a polymorphic object". Since omnis has to unify channels that already carry different payloads (Slack/Kakao/Gmail/Telegram), splitting Draft into yet another separate schema only adds the complexity of having to re-link "original channel item ↔ draft item". Linking back to the original via `in_reply_to`/`thread_id` fields is also worth taking as-is.

**Port agent-inbox's schema verbatim for the Action object (= an execution requiring approval)** (effort S–M, low risk). `HumanInterrupt{action_request:{action,args}, config:{allow_accept,allow_edit,allow_respond,allow_ignore}, description}` / `HumanResponse{type,args}` maps 1:1 onto the omnis requirement that "the agent obtains human approval before delegating to Codex/Hermes or sending a message". The `config` 4-way flags (accept/edit/respond/ignore) structurally enforce that different action types need different approval UX — e.g. "delegate to Codex" gets only `allow_accept+allow_edit`, while "send KakaoTalk message" gets `allow_accept+allow_edit+allow_ignore` (respond is meaningless there). No LangGraph dependency is needed — port just these types into omnis's own orchestration layer, and implement "resume" as a simple state transition (`pending_approval → approved/rejected/edited`) rather than a LangGraph interrupt (omnis does not yet have long-running workflows that require suspending and resuming graph execution).

**Enforce "approval" through tool availability, not a prompt rule** (agentic-inbox's most important lesson; effort S, low risk, but expensive later if not done now). Even though agentic-inbox writes "never send" in its system prompt, the real safeguard is that **the send tools are simply not registered in the in-app agent's tool palette** (they are exposed separately on the MCP surface instead — a different trust boundary, where the externally calling client bears the approval responsibility on its own side). omnis should likewise exclude irreversible tools such as "send message / delete file / delegate to agent" from the autonomous loop's tool list at the source, and split them into a separate code path callable only from a UI action the human explicitly presses (after an approved `HumanResponse`). This is also consistent with the omnis brief's "context-aware reply drafts with notifications" (drafts + notifications, not auto-send).

**Treat buzz's approval workflow as reference only and never copy it** (risk: present — it becomes a reference implementation that does not exist). This pass confirmed directly in the code that the `request_approval` action is explicitly broken ("does not resume, just marks failed"). Use buzz's event kind taxonomy (46010/46011/46012 for the three approval stages, 46030/46031 for human responses) only as a design idea for "how many discrete events to split approval state into", and never reference the execution logic — using unimplemented code as a reference implementation makes you believe a feature exists that does not.

**Effort/risk summary**: Draft-as-Item-status (S, low risk) + porting the Action/HumanInterrupt schema (S–M, low risk, but it must be reimplemented as omnis's own state machine) + applying the tool isolation principle (S, but expensive to refactor later if not done early in design) = we recommend finalizing these three as GAP 3's output and reflecting them directly in the §6 Draft/Action schema design.

## 5. What to borrow — concrete pointers

- **Item/Draft = same table, distinguished by status**: `agentic-inbox/workers/db/schema.ts` (the emails table definition) + `agentic-inbox/workers/lib/tools.ts` `toolDraftReply`/`toolDraftEmail`/`toolUpdateDraft` (around the lines calling `createEmail(Folders.DRAFT, {...})`) — reference the `status` enum and the `in_reply_to`/`thread_id` linking pattern as-is when designing omnis's `items` table.
- **Structural separation of the tool set**: `createEmailTools()` in `agentic-inbox/workers/agent/index.ts` (9 tools, no send tools) vs `agentic-inbox/workers/mcp/index.ts` (12 tools, including send tools) — the reference structure for separating omnis's two sets, "autonomous loop tools" vs "actions the human explicitly triggers", at the code level.
- **"Edit & send" approval gate UI**: `DraftActions`/`hasDraftReplyTool` in `agentic-inbox/app/components/AgentPanel.tsx` — the button is shown only when a chat message has a draft tool call; clicking it navigates to a separate edit screen, and the explicit Send on that screen triggers the real send. The prototype for the "Review & Send" button UX on omnis's Draft card.
- **Action/Interrupt type definitions**: the whole of `agent-inbox/src/components/agent-inbox/types.ts` (`HumanInterrupt`, `HumanInterruptConfig`, `ActionRequest`, `HumanResponse`, `ThreadData` discriminated union) — the direct starting point for omnis's Action object TypeScript interfaces.
- **Approval UI logic**: `agent-inbox/src/components/agent-inbox/hooks/use-interrupted-actions.tsx` (the accept/edit/respond/ignore branches in `handleSubmit`, and the edit→accept auto-downgrade logic) and `agent-inbox/src/components/agent-inbox/components/generic-interrupt-value.tsx` (a generic renderer that color-codes arbitrary JSON args by type and shows them with a collapsed/full toggle) — reference these as-is when omnis shows a human a structured payload such as "Codex delegate args".
- **Streaming tool call badges**: the `TOOL_LABELS` record + `ToolCallBadge` (`state` → loading/done icon) in `agentic-inbox/app/components/AgentPanel.tsx` — the minimal pattern for mapping each tool call to a human-readable label + icon + progress state when omnis shows an agent session as an inbox thread.
- **Event kind taxonomy (design ideas only)**: the 4-trigger/7-action table in `buzz` `ARCHITECTURE.md` §"buzz-workflow" and the three approval kinds (REQUESTED/GRANTED/DENIED) in `crates/buzz-core/src/kind.rs` — use these only as a reference list for "how many stages to split approval state into" when omnis unifies heterogeneous channel events under a single `event_type` enum. **Do not reference the code/implementation** (confirmed unfinished).

## 6. Open questions

- agent-inbox's actual email domain graph (the LangGraph side, the email-assistant implementation that actually throws interrupts) lives in a separate repo and is outside this survey's scope — if omnis needs a real example of "how draft args are structured" (e.g. `action:"send_email", args:{to,subject,body}`), that graph repo must be examined separately.
- Could not determine why agentic-inbox has had no commits for 5 months (whether the project was discontinued or it is considered stable and left untouched) — whether Cloudflare will keep maintaining this repo as a demo/reference can only be judged by looking at the issue tracker.
- Why buzz's `KIND_APPROVAL_GRANT/DENY` (46030/46031) exist as separate kinds from `KIND_WORKFLOW_APPROVAL_GRANTED/DENIED` (46011/46012) (presumed to be the separation of the human-sent "intent" event from the system-recorded "result" event) is unconfirmed, as the code comments do not explain it.
- Whether omnis's own Action state machine will actually hit a scenario where "resume" is needed (e.g. the agent streams intermediate results and then halts awaiting approval), and therefore whether first-class checkpoint/resume infrastructure like LangGraph is required or simple state transitions remain sufficient, can only be judged once omnis's real delegation workflow design progresses further.

## 7. Sources

- https://github.com/cloudflare/agentic-inbox (repo metadata, README) — fetched 2026-09-20
- https://github.com/cloudflare/agentic-inbox/blob/main/workers/db/schema.ts — fetched 2026-09-20 (cloned, read locally)
- https://github.com/cloudflare/agentic-inbox/blob/main/workers/lib/tools.ts — fetched 2026-09-20
- https://github.com/cloudflare/agentic-inbox/blob/main/workers/agent/index.ts — fetched 2026-09-20
- https://github.com/cloudflare/agentic-inbox/blob/main/workers/mcp/index.ts — fetched 2026-09-20
- https://github.com/cloudflare/agentic-inbox/blob/main/app/components/AgentPanel.tsx — fetched 2026-09-20
- https://github.com/cloudflare/agentic-inbox/blob/main/app/components/ComposePanel.tsx — fetched 2026-09-20
- https://github.com/langchain-ai/agent-inbox (repo metadata, README) — fetched 2026-09-20
- https://github.com/langchain-ai/agent-inbox/blob/main/src/components/agent-inbox/types.ts — fetched 2026-09-20
- https://github.com/langchain-ai/agent-inbox/blob/main/src/components/agent-inbox/hooks/use-interrupted-actions.tsx — fetched 2026-09-20
- https://github.com/langchain-ai/agent-inbox/blob/main/src/components/agent-inbox/contexts/ThreadContext.tsx — fetched 2026-09-20
- https://github.com/langchain-ai/agent-inbox/blob/main/src/components/agent-inbox/components/generic-interrupt-value.tsx — fetched 2026-09-20
- https://github.com/langchain-ai/agent-inbox/blob/main/src/components/agent-inbox/components/interrupt-details-view.tsx — fetched 2026-09-20
- https://github.com/block/buzz/blob/main/ARCHITECTURE.md — fetched 2026-09-20 (re-fetched this pass for full workflow YAML + approval-gate status)
- https://github.com/block/buzz/blob/main/crates/buzz-core/src/kind.rs — fetched 2026-09-20 (re-fetched this pass for approval kind constants)
- /Users/logankim/AI-Workspaces/Claude/omnis/research/02-block-buzz.md — prior research this pass builds on (buzz README/architecture-level facts)
- /Users/logankim/AI-Workspaces/Claude/omnis/research/17-todo-briefing-network-notes.md — prior research, buzz cross-reference
