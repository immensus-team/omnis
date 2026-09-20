# herdr, and the OSS candidates for borrowing the kinso look (fetched 2026-09-20)

## TL;DR

- **"herdr" is not a unified inbox.** `herdrdev/herdr` (Rust, Apache-2.0, ⭐39.7k, committing actively as of 2026-09-20, $6M seed raised 2026-09 from Bessemer/YC/E2) is **the terminal multiplexer your coding agents (Claude Code/Codex/Cursor, etc.) live in** — tmux-style prefix key + mouse, session detach/restore, multiple machines unified, every pane tagged idle/working/blocked/done, a pure Rust binary (no Electron). Since it is not a messaging inbox, there is nothing to lift verbatim from herdr's core for kinso UI components like the channel rail, inbox row, thread view, or compose.
- **What is actually useful for omnis, though, is herdr's ecosystem (plugins/clients).** In particular, `AltanS/collie` (MIT, React Router+Vite+TS+**Tailwind+shadcn**, PWA — nearly identical to omnis's stack) has a status dashboard where "agents that need my answer rise to the top," a row list, and a pattern that lifts `AskUserQuestion` into tappable buttons, so it can be referenced almost as-is for omnis's "AI agent sessions" panel (one of the channels sitting alongside Slack/Gmail). For `hhdebb/herdr-radar` (MIT, JS), the description itself — "grouped by project, each agent in its vendor's logo/color, rows ordered by activity, idle sessions fade, light and dark" — is structurally the closest match to the kinso row spec (avatar + name + relative time + summary + right-fixed brand icon).
- **Things outside herdr that fit the kinso look**: `langchain-ai/agent-inbox` (MIT, human-in-the-loop review UI), `cloudflare/agentic-inbox` (Apache-2.0, React 19 + RR7 + Tailwind + TipTap, 3-pane mail client + AI side panel — the strongest candidate for borrowing compose/thread/AI summary), `Mail-0/Zero` (MIT, privacy-first open-source mail app), `assistant-ui/assistant-ui` (MIT, React AI chat components — compose/streaming replies), `shadcnblocks/kibo` (MIT, shadcn-compatible component registry), `simple-icons` (CC0) + `react-icons` (MIT-style) brand icon sets (KakaoTalk included). Chatwoot is excluded because its frontend is Vue, and originui is excluded because it has been absorbed into the AGPL `cosscom/coss`.
- The final table lays out the mapping: "kinso element → OSS to borrow → concrete path → effort (S/M/L)."

---

## 1. What is "herdr"?

### Verdict: `herdrdev/herdr` — a terminal multiplexer for coding agents, NOT a messaging inbox

| Fact | Value |
|---|---|
| Repo | https://github.com/herdrdev/herdr |
| Tagline | "the runtime your coding agents live on" |
| Stars | 39,741 (fetched 2026-09-20) |
| License | Apache-2.0 |
| Last push | 2026-09-20T01:41:28Z (commits land daily) |
| Primary language | Rust (10.4M bytes; TS/Python/Shell/JS present for tooling/plugins, not the core) |
| Homepage | https://herdr.dev (docs at herdr.dev/docs) |
| Distribution | `curl ... install.sh`, `brew install herdr`, single static binary — explicitly "no electron" |
| Funding | 2026-09: $6M seed, Bessemer Venture Partners led, YC + E2 participating (per web search results, not independently verified beyond search snippet) |

**What it does**: herdr owns the terminal panes your coding agents (Claude Code, Codex, Cursor, OpenCode, Grok, etc.) run in. Core mechanics, from its README (https://github.com/herdrdev/herdr, fetched 2026-09-20):
- Detach without stopping work — a background server keeps terminals running after you close the client or lose SSH; on restart it restores the saved layout.
- Multiple machines, one window — local + saved SSH machines share a combined agent list.
- Every pane is tagged **idle / working / blocked / done / unknown** — "when an agent stops and needs an answer, herdr says so." The sidebar rolls state upward: a blocked agent makes its pane, tab, and workspace look blocked (per Better Stack's writeup, https://betterstack.com/community/guides/ai/herdr-ai-agent/, fetched 2026-09-20).
- Agent-native: agents drive herdr via CLI/socket API — spawn panes, prompt each other, wait on real blocks.
- tmux-style prefix keys AND mouse click/drag/split, both first-class.
- Plugin marketplace (herdr.dev/plugins) extends panes/workflows — this is the interesting part for omnis (see ecosystem below).

**UI description** (no direct screenshots fetched — herdr itself is a TUI, and official screenshots weren't reachable via WebFetch in this session; description synthesized from README + Better Stack + a first-hand user's live-use thread on X): a sidebar/agent list where each row shows an agent's pane, its live status badge, and — critically for kinso-style borrowing — the *mobile client* (Collie, below) renders that same state as a dashboard: "agents that need input at the top," everything else grouped by workspace/tab underneath.

**Why the task's "unified inbox" framing was probably wrong, with evidence**: web search for `"herdr" unified inbox messaging` returned no matches for herdr-as-inbox; independent sources (Better Stack guide, Flavio Copes deep-dive, an X thread from a live user, herdr.dev/docs itself) consistently describe it as a coding-agent terminal multiplexer. There is a "Herdr Mobile" app on Google Play (`dev.herdr.mobile`) — that's the official mobile companion to the same multiplexer, not a separate messaging product. I did not find a second, unrelated OSS project also named "herdr" that is actually a message aggregator — this is the one project Logan means.

### What omnis can/can't adopt from herdr directly

**Can't adopt as-is** (herdr core is a Rust TUI, not a web layout): channel rail, top ask/search bar, inbox rows, thread view, compose, onboarding, design tokens — none of these exist in herdr's own UI in a form transferable to React/Tailwind/shadcn.

**Can adopt from herdr's ecosystem** (these are separate repos, React/TS, MIT-licensed, built specifically to skin herdr's session/agent-status model as a web or mobile UI — this is the actually-useful part of Logan's instruction, and it maps onto omnis's "AI agent sessions" channel):

- **`AltanS/collie`** — https://github.com/AltanS/collie — MIT — ⭐1,039 — pushed 2026-09-20 — **stack: React Router + Vite + TypeScript + Tailwind + shadcn + Bun bridge** (this is nearly identical to omnis's own stack). It's a PWA mobile client for herdr (and tmux/zellij). Concretely reusable patterns:
  - `dashboard` view: "a workspace filter, a status summary, then panes grouped by workspace" — panes that need input surface to the top, everything else stays under its own workspace/tab grouping. This is structurally the "unread/needs-you first" sort omnis wants for its unified inbox.
  - `ask-question` view: turns an agent's own CLI prompt (e.g. Claude's `AskUserQuestion`) into tappable buttons — directly relevant if omnis surfaces agent-session prompts as inbox-row actions.
  - `quick` dock: one-tap canned replies over a "working" pane, configured via `quick-replies.toml` — a pattern for omnis's own quick-reply affordance on message rows.
  - Interactive demo (no install) at https://colliepwa.dev/demo — worth opening for actual pixel reference since screenshots weren't fetchable via WebFetch in this session.
  - Caveat: Collie is explicitly single-user / one-tailnet, with remote-shell-level security warnings — irrelevant to omnis's own security model, but a reminder not to copy its auth assumptions.

- **`hhdebb/herdr-radar`** — https://github.com/hhdebb/herdr-radar — MIT — ⭐57 — pushed 2026-09-19 — JavaScript. Description: "Who's working, who's waiting on you — grouped by project, each agent in its vendor's logo and colour. Worktrees nest under their repo, rows order by activity, idle sessions fade. Light and dark." This description is close to a 1:1 match for kinso's row spec (avatar/brand-color + name + recency ordering + fade for idle/read) — of everything surveyed, this is the closest structural analog to a kinso inbox row, just applied to agents instead of messages.

- **`kcosr/herdr-web`** — https://github.com/kcosr/herdr-web — MIT — ⭐125 — pushed 2026-09-16 — TypeScript-majority (with some Rust) full web client for herdr. Lower priority than Collie (less clean stack match, smaller/less description detail) but worth a look if Collie's PWA constraints (single-tailnet) don't fit.

- **`yigitkonur/awesome-herdr`** — https://github.com/yigitkonur/awesome-herdr — MIT — ⭐223 — a curated list of the whole ecosystem (tools/workflows/configs/clients/skills/integrations) — useful as a jumping-off index rather than something to borrow code from directly.

Net: treat herdr itself as an **architecture/interaction reference** (idle/working/blocked/done state model, "surface what needs you" sorting) for omnis's AI-agent-sessions channel, and treat **Collie specifically** as the closest thing to a borrowable React/Tailwind/shadcn codebase in this family.

### Alternative "herdr" candidates considered

Searched GitHub (`gh api search/repositories -f q=herdr`) and the web; every result is part of the same `herdrdev/herdr` ecosystem (30+ plugin/client repos: reviewr, file-viewer, sidebar, browser, mobile-relay, board, navigator, nvim, worktrunk, agent-quota, projects, etc.) or an unrelated tiny repo. No second, unrelated "herdr" project surfaced. Confidence: high that `herdrdev/herdr` is the one Logan means, given "최신 오픈소스" ("latest open source" — very recent, with daily commits and a 2026 seed round) and his general habit of tracking hot dev-tool launches.

---

## 2. Beyond herdr: OSS matching the kinso look, fitting React + Tailwind + shadcn

Kinso reference spec (from `omnis/research/23-gap-kinso-visual-teardown.md`, already in this repo): light theme, left squircle channel rail (dark "Inbox" tile + colored brand tiles + glow halo), full-radius pill ask/search bar with gradient stroke, rows = avatar + name + relative time + one-line AI summary + right-fixed channel brand icon, no hairlines, selected row elevated as a card.

| # | Repo | License | Stars (2026-09-20) | Last push | Stack | What to borrow | Effort |
|---|---|---|---|---|---|---|---|
| 1 | [`AltanS/collie`](https://github.com/AltanS/collie) | MIT | 1,039 | 2026-09-20 | React Router + Vite + TS + **Tailwind + shadcn**, Bun | Status-dashboard layout (needs-you-first sort), row/pane list grouped by workspace, `AskUserQuestion`→tappable-buttons pattern, quick-reply dock (`quick-replies.toml`) — see `src` dashboard/space-detail/quick views | S–M |
| 2 | [`hhdebb/herdr-radar`](https://github.com/hhdebb/herdr-radar) | MIT | 57 | 2026-09-19 | JS (vanilla/light framework) | Row spec closest to kinso: brand-color avatar tile, activity-ordered rows, idle-fade, light/dark — adapt agent-row component to message-row | S |
| 3 | [`langchain-ai/agent-inbox`](https://github.com/langchain-ai/agent-inbox) | MIT | 1,092 | 2026-09-18 | TS/React/Next.js | Human-in-the-loop review UX: interrupt/approve/edit affordances on a thread — reference for how omnis surfaces "needs your decision" agent-session items alongside messages | M |
| 4 | [`cloudflare/agentic-inbox`](https://github.com/cloudflare/agentic-inbox) | Apache-2.0 | 7,951 | 2026-04-23 | React 19, React Router v7, Tailwind, Zustand, TipTap, `@cloudflare/kumo`; backend Hono/Workers/Durable Objects (backend not relevant to omnis's Node/Postgres hub) | Full 3-pane mail-client UI (folder sidebar, message list, reader), TipTap rich-text composer, reply/forward threading, **AI side panel with tool calls + auto-draft requiring confirmation** — best single source for omnis's compose + thread-view + AI-summary-panel components | M–L |
| 5 | [`Mail-0/Zero`](https://github.com/Mail-0/Zero) | MIT | 10,813 | 2026-05-26 | TypeScript (React-based open email client) | Privacy-first unified email client patterns — mail list row styling, account/provider abstraction if omnis wants a second reference point beyond agentic-inbox for the Gmail/Outlook lanes | M |
| 6 | [`assistant-ui/assistant-ui`](https://github.com/assistant-ui/assistant-ui) | MIT | 12,220 | 2026-09-20 | TypeScript/React | AI-chat primitives (message list, streaming, composer, tool-call rendering) — drop-in for omnis's "one-line AI summary" and any agent-chat surface inside a thread view | S |
| 7 | [`shadcnblocks/kibo`](https://github.com/shadcnblocks/kibo) (kibo-ui) | MIT | 3,937 | 2026-05-04 | shadcn/ui-compatible component registry | Composable extras beyond base shadcn (status dots, avatar groups, AI-adjacent blocks) installable via the shadcn CLI against a custom registry — cheapest way to fill kinso-row gaps (status pill, brand-tile avatar) without hand-rolling | S |
| 8 | [`simple-icons/simple-icons`](https://github.com/simple-icons/simple-icons) + [`react-icons/react-icons`](https://github.com/react-icons/react-icons) | CC0-1.0 / "Other" (permissive, MIT-style) | 25,885 / 12,662 | 2026-09-20 / 2026-09-18 | SVG icon sets | Brand icons for the channel rail and row's right-fixed brand icon — Slack, Gmail, Outlook, Telegram, WhatsApp, LinkedIn, KakaoTalk all present as maintained brand marks; `react-icons` wraps simple-icons (`si` set) as React components for zero-boilerplate import | S |

**Explicitly excluded / checked and rejected**:
- **Chatwoot** (`chatwoot/chatwoot`, ⭐36,989, license "Other"/permissive-ish, omni-channel desk) — primary frontend is Vue, not React (backend Ruby), fails the stack filter the user set ("Chatwoot-style UIs only if React").
- **originui** — the well-known shadcn-adjacent component set (`origin-space/originui`) has been absorbed into `cosscom/coss` (Cal.com's design system), which is **AGPL-3.0** — not permissive, excluded on license grounds. Use kibo-ui instead for the same "extra shadcn blocks" need.
- **shadcn/ui's own classic "Mail" example** — historically a well-known three-pane mail app example in `shadcn-ui/ui`. As of the current `main` tree (checked via `gh api repos/shadcn-ui/ui/git/trees/main`, fetched 2026-09-20) it is **no longer present** in `apps/v4/app/(app)/examples/` (only `authentication`, `dashboard`, `playground`, `rtl` remain) — don't cite it as a live reference; use `cloudflare/agentic-inbox` or the paid `shadcnuikit.com` "Mail App" kit (commercial, not OSS — mentioned for awareness only, not recommended) instead.
- **Beeper** — closed-source desktop client; already covered in this project's own `04-beeper-matrix-bridges.md` research (Matrix-bridge angle, not a UI-borrow source).

---

## Borrow plan for omnis desktop

| kinso element | OSS source | File/component to reference | Effort |
|---|---|---|---|
| Channel rail (squircle tiles, dark "Inbox" tile, colored brand tiles + glow) | `simple-icons`/`react-icons` (brand SVGs) + `hhdebb/herdr-radar` (grouping/ordering logic) | `react-icons/si` imports for brand marks; herdr-radar's project-grouping component for the rail's grouping behavior | S |
| Top "Start typing to ask or search" pill bar | Existing `cmdk` in omnis's own stack (already installed) — no strong external match found; `langchain-ai/agent-inbox`'s filter bar as a distant secondary reference | omnis's own `cmdk` integration; build the gradient-stroke pill styling directly with Tailwind | S |
| Inbox row (avatar + name + relative time + one-line AI summary + right-fixed brand icon, elevated card when selected, no hairlines) | `hhdebb/herdr-radar` (row spec/ordering/fade) + `AltanS/collie` (`dashboard` view's row grouping and "needs you" sort) | herdr-radar's row component; collie's `src/routes/dashboard` (per its README's dashboard screenshot description) | M |
| Thread view | `cloudflare/agentic-inbox` (reader pane) | agentic-inbox's message-thread/reader components | M |
| Compose | `cloudflare/agentic-inbox` (TipTap composer, reply/forward) | agentic-inbox's composer component | M |
| AI one-line summary / AI side panel | `cloudflare/agentic-inbox` (AI side panel, 9 email tools, auto-draft-with-confirmation) + `assistant-ui/assistant-ui` (streaming message/tool-call rendering) | agentic-inbox AI panel; assistant-ui message primitives | M |
| Command palette | Existing `cmdk` (already in stack) + `shadcnblocks/kibo` for any extra command-list styling | omnis's own cmdk usage; kibo-ui command blocks if gaps appear | S |
| AI-agent-sessions status (idle/working/blocked/done) | `herdrdev/herdr` (state model, docs) + `AltanS/collie` (`ask-question` tappable-button view, `quick` reply dock) | herdr's status semantics as the data model; collie's ask/quick views as the row-level UI treatment | S–M |
| "Needs your input" push/priority surfacing | `AltanS/collie` (push notifications, needs-you-first dashboard sort) | collie's dashboard sort + notification hook | M |
| Onboarding | No strong OSS match found among the above (all are dev-tool-flavored, thin/no onboarding flows) — treat as omnis-original work, informed by kinso's own onboarding (see `23-gap-kinso-visual-teardown.md`) | — | L (build from scratch) |
| Design tokens / theme (light, no hairlines, card elevation) | Existing shadcn/ui theming primitives (already in stack) + `shadcnblocks/kibo` components as styled examples to crib elevation/spacing from | omnis's own `tailwind.config` + shadcn theme tokens; kibo-ui component source for elevation patterns | S |

**Overall read**: herdr itself is not a UI donor for omnis's inbox surfaces — it's the best available reference for how to model and *state-badge* AI agent sessions (idle/working/blocked/done, "needs you" prioritization), and its ecosystem client `collie` is the one piece of that world built in a stack close enough to omnis's own (React Router+Vite+TS+Tailwind+shadcn) to actually crib component code from. For the messaging-inbox parts of kinso's look (rows, thread, compose, AI summary), `cloudflare/agentic-inbox` is the strongest single donor, with `herdr-radar` supplying the closest row-list structure and `simple-icons`/`react-icons` trivially solving the brand-icon need.
