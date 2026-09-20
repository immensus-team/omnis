# omnis design direction (Logan's decision, 2026-09-20)

**The baseline is kinso.** References: `reference/kinso-inbox.webp`, detailed teardown `../research/23-gap-kinso-visual-teardown.md`, OSS borrowing plan `../research/30-herdr-and-oss-ui-borrow.md`.

## What we follow as-is
- **Light theme by default** (warm off-white canvas, subtle grid/gradient background). Dark is an option, and A5's "dark-first" is dropped.
- **Left channel rail**: vertical squircle tiles. Inbox tile at the top (black), channel brand icons below it (Gmail, Slack, LinkedIn, WhatsApp, Telegram, KakaoTalk, Outlook, Calendar), agent tile, collapse arrow. My avatar and settings at the bottom.
- **Top "Start typing to ask or search" bar**: an input that keeps the ⌘K palette always visible. omnis orb (gradient bead) on the left, gradient stroke on focus.
- **Inbox row = conversation (person) unit**: circular avatar + bold name + gray relative time (3m, 2w, 4 Aug) + **one-line AI summary** ("Wants you to share a sales contract from Brightstone Realty …") + fixed channel brand icon on the right. No hairlines, generous row height, only the selected row elevates into a white card + soft shadow.
- **List header** carrying just the one-line Inbox title. The filter pills (All/Work/Personal/Agents/Needs approval) sit small on the right side of the header.

## What we change to fit omnis's purpose
- Agent sessions use the same row grammar. Runtime logo in the avatar slot (Claude/Codex/DeepSeek/Hermes), last-turn summary in the summary slot, status badge in the right icon slot (idle/working/**blocked**/done — the herdr state model). blocked (needs my response) floats to the top of the list.
- Approval cards go at the top of the detail panel as a kinso-style card (full text, Approve / Edit & send / Ignore).
- Label chips: at most 2 at the right end of the summary line + "+N"; no channel colors.

## Implementation principles
- Don't build these ourselves: brand icons from `react-icons/si`, thread/composer/AI panel from the `cloudflare/agentic-inbox` pattern, agent status UI from the `AltanS/collie` and `herdr-radar` patterns, command/search from the existing `cmdk`, tokens from shadcn theme primitives.
- Summaries are one line from T1 (DeepSeek Flash); on failure or when not generated, fall back to the subject or the first line of the body. Store in `threads.meta.summary` and record every run in `agent_runs`.

## Additional instructions (Logan, evening of 2026-09-20)

- **DeepSeek V4.1 Flash is the workhorse for iterative UI/UX polish.** Assign UI stories to the DeepSeek tier and have a Sonnet driver execute and verify them. Reviewers compare screenshots against the references below and reject anything that "looks like AI slop" (uniform card grids, purple gradients everywhere, excessive shadows, meaningless icons, bland default fonts, and static transitions are all slop signals).
- **Keep researching, installing, and using open-source design skills.** Keep the install list and usage notes in `docs/design/SKILLS.md` (created after research).
- **Apple-like and glassy, with natural motion.** Liquid Glass only on sidebar/toolbar/sheet/palette/floating panels; lists and body content stay opaque (existing rule). Motion is spring-based (160ms entry, 240ms transition, 320ms layer appearance; no exaggeration) and respects reduced-motion.

### 3 reference images (`reference/`)
| File | Details to borrow |
|---|---|
| `ref-glass-mail-ai-panel.webp` | Glassy sidebar over a background (translucent + blur + subtle tint), smart folder tree with counts, top tab pill, floating **AI chat panel** (suggested actions "Draft a reply / Summarize / Extract", model selector Auto/Claude/Gemini/GPT, attachment + @ mention input). Extend omnis's ask bar into this panel. |
| `ref-issue-tracker-density.webp` | Filter chip bar ("Priority is any of 2 priorities"), status group headers (pill + count + +), sub-item indentation, hover card, checkbox dropdown. The density and status pill grammar for omnis's Tasks and Needs-approval views. |
| `ref-dashboard-detail-card.webp` | Left icon rail (subtle background on the selected state), top title + subline, toggles and segmented controls, right detail card (photo + badge + key-value hairline table). The typography baseline for omnis's detail panel, Network person card, and Settings. |
