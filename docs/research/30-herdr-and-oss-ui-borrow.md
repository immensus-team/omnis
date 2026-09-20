# herdr, 그리고 kinso 룩을 빌려올 OSS 후보들 (fetched 2026-09-20)

## TL;DR (한국어)

- **"herdr"는 통합 인박스가 아니다.** `herdrdev/herdr` (Rust, Apache-2.0, ⭐39.7k, 2026-09-20 기준 활발히 커밋 중, 2026-09 Bessemer/YC/E2 시드 $6M 유치)는 **코딩 에이전트(Claude Code/Codex/Cursor 등)가 사는 터미널 멀티플렉서**다 — tmux 스타일 prefix key + 마우스, 세션 detach/restore, 여러 머신 통합, 각 pane을 idle/working/blocked/done으로 표시, 순수 Rust 바이너리(Electron 없음). 메시징 인박스가 아니라서 채널 레일·인박스 row·스레드뷰·compose 같은 kinso UI 컴포넌트를 herdr 코어에서 그대로 가져올 건 없다.
- **하지만 omnis에 실제로 쓸모 있는 부분은 herdr의 생태계(플러그인/클라이언트)다.** 특히 `AltanS/collie`(MIT, React Router+Vite+TS+**Tailwind+shadcn**, PWA — omnis 스택과 거의 동일)는 "내 응답이 필요한 에이전트가 위로 온다"는 상태 대시보드 + row 리스트 + AskUserQuestion을 탭 가능한 버튼으로 끌어올리는 패턴을 갖고 있어서, omnis의 "AI agent sessions" 패널(Slack/Gmail과 나란히 놓이는 채널 중 하나)에 거의 그대로 참고할 수 있다. `hhdebb/herdr-radar`(MIT, JS)는 "프로젝트별로 묶고, 각 에이전트를 벤더 로고/컬러로, row는 활동순 정렬, idle은 페이드, 라이트/다크"라는 설명 자체가 kinso row 스펙(아바타+이름+상대시간+요약+우측 고정 브랜드 아이콘)과 구조적으로 가장 가깝다.
- **herdr 밖에서 kinso 룩에 맞는 것들**: `langchain-ai/agent-inbox`(MIT, human-in-the-loop 검토 UI), `cloudflare/agentic-inbox`(Apache-2.0, React19+RR7+Tailwind+TipTap, 3-pane 메일 클라이언트 + AI 사이드패널 — compose/thread/AI 요약 borrow 대상으로 제일 유력), `Mail-0/Zero`(MIT, 프라이버시 중심 오픈소스 메일 앱), `assistant-ui/assistant-ui`(MIT, React AI 채팅 컴포넌트 — compose/스트리밍 답변), `shadcnblocks/kibo`(MIT, shadcn 호환 컴포넌트 레지스트리), `simple-icons`(CC0)+`react-icons`(MIT류) 브랜드 아이콘 세트(카카오톡 포함). Chatwoot은 프론트가 Vue라 제외, originui는 AGPL인 `cosscom/coss`로 흡수돼 제외.
- 마지막 표에 "kinso 요소 → 빌려올 OSS → 구체 경로 → 공수(S/M/L)" 매핑 정리함.

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

Searched GitHub (`gh api search/repositories -f q=herdr`) and the web; every result is part of the same `herdrdev/herdr` ecosystem (30+ plugin/client repos: reviewr, file-viewer, sidebar, browser, mobile-relay, board, navigator, nvim, worktrunk, agent-quota, projects, etc.) or an unrelated tiny repo. No second, unrelated "herdr" project surfaced. Confidence: high that `herdrdev/herdr` is the one Logan means, given "최신 오픈소스" (very recent — daily commits, 2026 seed round) and his general habit of tracking hot dev-tool launches.

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
