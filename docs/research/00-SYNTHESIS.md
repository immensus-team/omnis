# 00 — omnis Research Sweep Synthesis (2026-09-20)

Author: Fable. Scope: `BRIEF-2026-09-20.md`, `01-definition-draft.md`, `research/01~18`, gap files `20~27`, critique `90`, and every file's Verification (adversarial) section.

Re-verification scope of this document: the items below were **directly re-confirmed** in this synthesis pass (2026-09-20 fetch) — the current MCP spec version, mem0 OSS removing graph memory, Google push abolishing domain verification, the MS Graph subscription maximum lifetime, the Eve self-hosting docs, the Claude Code `fable` tier and headless billing, Anthropic Claude Code legal wording, the DeepSeek price list, Beeper Desktop API supported channels, the absence of kinso.ai pricing, the `beeper.com/pricing` and `kinso.ai/pricing` 404s, `mautrix/linkedin` #55/#61 status, Codex release cadence, and metadata for 19 key repos (star/license/pushed_at/archived). Items that could not be re-verified are listed in §8.

---

## 1. One-line conclusion per topic

1. **Kinso and competitors** — kinso is the answer key for the target feature set (tone-matched draft + morning briefing + contextual linking), but its pricing, platform, and capture mechanism are all undisclosed, so it cannot be used as an architecture benchmark and is valid only as a UX reference. `01-kinso-and-competitors.md`
2. **block/buzz** — do not fork it; take only three ideas (agent = channel member, ACP harness pipeline, kind-based dispatch). The whole Nostr/Schnorr stack is over-engineered for one person. `02-block-buzz.md`
3. **Google Artemis** — an Android-only QA automation tool, irrelevant to omnis (not adopted). Borrow only the Flash/Pro dual-profile separation pattern. `03-google-artemis.md`
4. **Beeper/Matrix bridges** — Beeper Desktop API (local REST + MCP + Tailscale Remote Access) fits the omnis topology exactly, but it does not support KakaoTalk, the LinkedIn bridge is broken, and pricing gating is unresolved. `04-beeper-matrix-bridges.md`
5. **KakaoTalk** — `channprj/kmsg` (macOS Accessibility, MIT, ★266) is the only battle-tested path, and reimplementing LOCO runs head-on into the letter of Kakao's operating policy. `05-channel-kakaotalk.md`
6. **LinkedIn** — the official Messages API is closed to individuals, and `mautrix/linkedin` still has the session-dies-20-seconds-after-login bug (#55) unresolved as of today, so a resident Playwright profile is the realistic MVP. `06-channel-linkedin.md`
7. **WhatsApp/Telegram** — WhatsApp is the whatsmeow family (ToS gray area, ban probability unquantified); Telegram is a clean track using mtcute with an official api_id (gramjs was archived 2026-07-14). `07-channel-whatsapp-telegram.md`
8. **Slack/Gmail/Outlook/Calendar** — all can achieve real-time outbound-only via official APIs: Slack Socket Mode + xoxp, Gmail watch + Pub/Sub pull, Outlook Graph delta → webhook, Calendar needs a push re-evaluation. `08-channel-slack-email-calendar.md`
9. **Agent = inbox thread** — ACP/A2A are over-engineered; the right answer is a custom session bus that thinly wraps each agent's native headless surface, and Hermes's session-key/session-id split is the single most reusable finding in this entire sweep. `09-agents-as-inbox.md`
10. **Open-source memory** — replicate the common Hermes/OpenClaw pattern (flat-file self-model + pluggable provider), and store with a hybrid of mem0 OSS + a custom Postgres bi-temporal entity table. `10-memory-oss.md`
11. **Agent harness** — use Vercel AI SDK 7 as the model-call layer only and build the kernel (event bus + scheduler + approval gate) directly on top of the existing Postgres. `11-agent-harness.md`
12. **Cost optimization** — a 4-tier cascade (local classification → DeepSeek Flash → Claude Sonnet/Haiku escalation → subscription CLI) puts runtime at an estimated $20–50/month, though this is a model-based estimate, not a measurement. `12-cost-optimization.md`
13. **Client/sync** — macOS is Tauri 2, iPhone is PWA → native transition, hub access is Tailscale Serve (+TailscaleKit), sync is Zero. `13-client-arch-sync.md`
14. **Apple design language** — Liquid Glass only on the control/navigation layer; content (lists, body text) stays opaque. Dark-first + a single accent + a ⌘K command palette as the core interaction. `14-apple-ui-design-language.md`
15. **Security/privacy** — the architecture concentrates the entire inbox plus execution authority in one process, so prompt injection is the #1 risk, and the defense line is not prompts but tool availability, approval gates, audit logs, and kill switches. `15-security-privacy.md`
16. **Hot repo README** — a hybrid of goose's concision + hermes's tagline formula + openclaw's omnichannel framing; a motion demo is a differentiator no repo has. `16-hot-repo-readme.md`
17. **Todo/briefing/Network/note routing** — Dex (which has an MCP server) is the #1 reference for Network, folk's Follow-up Assistant is the only close precedent for notes→routing, and "the agent delegates first" is an unverified area with no commercial precedent. `17-todo-briefing-network-notes.md`
18. **Mac mini hub ops** — a LaunchDaemon cannot access the GUI (Apple TN2083), so KakaoTalk/browsers must be LaunchAgents in the logged-in session, and auto-login + no screen lock is a structural precondition. `18-mac-mini-hub-ops.md`
19. **[GAP] Eve self-host** — `11`'s rejection rationale ("Vercel-only") is **wrong**. An actual spike succeeded in booting and health-checking `eve build && eve start` on local Postgres. But the process model of "one agent = one Node server (idle ~550MB)" still makes it unsuitable as the kernel. `20-gap-eve-self-host-spike.md`
20. **[GAP] Channel-layer bake-off** — the single-layer premise itself was wrong, and among the 7 channels Beeper is materially advantageous for only one: WhatsApp. `21-gap-channel-layer-bakeoff.md`
21. **[GAP] Reading the prior-art source** — Draft must be an Item's status, not a separate table (agentic-inbox); the Action approval object should port agent-inbox's `HumanInterrupt/HumanResponse` as-is; and approval is enforced not by prompts but by **tool-set design**. `22-gap-read-the-prior-art-source.md`
22. **[GAP] Kinso visual teardown** — the list elevates only the selected row into a card, with no hairlines; channel identification uses a fixed brand icon on the right rather than color; dark mode does not exist (light only). `23-gap-kinso-visual-teardown.md`
23. **[GAP] ralph dev pipeline** — completed by OMC's `ralph` skill + worktrunk worktree isolation + an added DeepSeek delegation tier, and **`fable` must be excluded from unattended loops** because it bills in headless mode without a consent prompt. `24-gap-ralph-loop-dev-pipeline.md`
24. **[GAP] standalone and Kakao session rules** — G6 must be redefined as "only the 5 channels + agents + calendar are hub-less", and Kakao's official policy explicitly lists "abnormal environments such as PC emulators" as a detection trigger, so the emulator path is risky regardless of the slot count. `25-gap-standalone-and-kakao-session-rule.md`
25. **[GAP] Memory ingestion/eval** — **mem0 OSS has fully removed graph memory** (Platform-only). The custom Postgres entity table is therefore not "optional" but "mandatory", and Drive/GitHub webhooks require public HTTPS, so polling is the default. `26-gap-memory-ingestion-and-eval.md`
26. **[GAP] Event volume/sync budget** — measured: 92% of one Claude Code turn is the once-per-process `system/init`, and real content is ~4.8KB. The absolute volume is small, but replicating token deltas verbatim would eat into G5 (2 seconds), so a **3-tier split** (ephemeral/durable/cold) is the answer. `27-gap-event-volume-and-sync-budget.md`
27. **[critique] Defects in the sweep itself** — uncoordinated channel recommendations, zero lines of source code read, no kinso field study, build process uninvestigated — gaps 20–27 closed 8 of these 8, and only live spikes (§6) remain. `90-critique.md`

---

## 2. Architecture decision candidates

### 2.1 Fork A — Chat aggregation layer

| Option | Evidence pointer | Verification status | Verdict |
|---|---|---|---|
| Beeper Desktop API as a single layer | `04` §2 (local REST + MCP, Remote Access `0.0.0.0` + `X-Forwarded-*`, Tailscale recommended) | Channel list, warning wording, and Remote Access re-confirmed VERIFIED today. **Pricing gating is still UNVERIFIED** (`beeper.com/pricing` is still 404 today) | ✗ Not viable as a single layer |
| Dedicated adapter for every channel | `06`/`07`/`08` respective recommendations | Each channel's primary source VERIFIED | △ Largest total effort |
| **Hybrid (best per channel)** | `21` §3 decision table | The broken LinkedIn bridge was re-confirmed today via `gh api` (#55 open 2026-05-09, PR #61 open and unmerged 2026-08-17) | **✓ Evidence supports it** |
| mautrix full self-host | `04` §3 | AGPL-3.0, home server + N bridges on 16GB | ✗ Not now, revisit in Phase D |

**Rationale**: Beeper is "one vendor with broad coverage", not "the optimal implementation of every channel". Telegram/Slack already have safer official real-time tracks, LinkedIn's upstream that Beeper depends on is broken, and the actual gain narrows to WhatsApp alone (+ Instagram/Signal/Discord/X as a bonus).

### 2.2 Fork B — Per-channel routes

The contradiction between `04` (Beeper-first) and `06`/`07`/`08` (implement each individually) was resolved by `21`. See the §3 matrix. One addition: `07` rejected whatsapp-web.js because of Chromium weight and detection signals and chose whatsmeow, while `15` chose whatsapp-web.js for *lower* ban risk — **`07` is better sourced** (repo metadata + protocol-layer argument vs. a single vendor blog post). And `21`'s Beeper-for-WhatsApp conclusion does not conflict with either: Beeper is also internally in the whatsmeow family, so the risk source is identical and only the maintainer changes.

### 2.3 Fork C — Agent session bus / kernel

| Option | Evidence pointer | Verification status | Verdict |
|---|---|---|---|
| Adopt ACP or A2A | `09` §2 | The ACP registry lists 49–60+ agents (the original text's "25+" is stale). A2A has 150+ orgs but depth of use is UNVERIFIED | ✗ Over-engineered for one user with a fixed agent set |
| **Custom thin agent-bridge + Hermes header pattern** | `09` §4, Hermes `X-Hermes-Session-Key`/`X-Hermes-Session-Id` split | Hermes primary docs CONFIRMED (the most strongly verified single claim in this sweep) | **✓ Evidence supports it** |
| Delegate via `codex mcp-server` | `09` §2 (third-party blog) | **REFUTED** — no such subcommand in `codex-rs/cli/src/mcp_cmd.rs` | ✗ Does not exist |
| Eve as the kernel | `11` §4 (wrong rejection) → `20` (measured) | The rejection rationale is REFUTED, but the process-model problem stands | ✗ Not the kernel; only 1–2 individual agents |
| **Homegrown kernel on Postgres** | `11` §4, `20` §4, `22` §4 | events table + `LISTEN/NOTIFY` + cron + `pending_approvals`; NOTIFY payload limit 8,000B (`27` VERIFIED) | **✓ Evidence supports it** |

**Additional confirmations (`22`)**: Draft = an Item's `status`, not a separate table. Action approval should port the `HumanInterrupt{action_request, config:{allow_accept/edit/respond/ignore}, description}` / `HumanResponse{type, args}` schema, but implement it as a simple state transition without LangGraph coupling. And **irreversible tools (send/delete/delegate) are simply not registered in the autonomous loop's tool palette at all** — the structural enforcement agentic-inbox proved out.

**Protocol version caveat**: `09`'s body claim that "the current MCP spec is 2025-11-25" is **wrong per today's re-check**. The current version is **2026-07-28**, which uses per-request negotiation via `_meta.io.modelcontextprotocol/protocolVersion` + the `MCP-Protocol-Version` header instead of an `initialize` handshake, plus a mandatory `server/discover` RPC (modelcontextprotocol.io/specification/versioning, 2026-09-20 fetch). If omnis designs its own bus protocol using MCP idioms, it must follow this model.

### 2.4 Fork D — Memory

| Option | Evidence pointer | Verification status | Verdict |
|---|---|---|---|
| mem0 OSS alone (graph included) | `10` §4 | **REFUTED** — mem0 OSS removed graph memory and it is Platform-only (docs.mem0.ai/open-source/graph_memory/overview, re-checked 2026-09-20: "Graph memory is removed from the open-source SDK... graph memory is a Mem0 Platform feature") | ✗ No relational queries |
| Honcho self-host | `10` §4 fallback | AGPL-3.0 (re-confirmed today via `gh api`), the peer model is conceptually aligned with Network | △ Fallback, under unmodified, isolated API-call conditions |
| Graphiti/Neo4j as the primary store | `10` §3 | The 4-timestamp bi-temporal is CONFIRMED from source (`graphiti_core/edges.py`), but the full Neo4j stack is too much for 16GB | ✗ Borrow the schema only |
| **3-layer hybrid** | `10` §4 + `26` §4 | flat-file self-model / mem0 OSS vectors / Postgres bi-temporal entities | **✓ Evidence supports it — but the 3 layers are now mandatory, not optional** |

**ingestion (`26`)**: Drive uses `changes.list()` + `newStartPageToken` polling, GitHub uses ETag conditional-request polling, local files use FSEvents. Webhooks (push) on both require public HTTPS + a valid SSL cert, which conflicts with a Tailscale-only mini, so polling is the default. Embeddings use mem0 TS's `ollama` provider + `nomic-embed-text-v1.5` (768d, reducible to 256/128 via Matryoshka, safely inside pgvector's 2,000d HNSW limit) for $0 locally.

### 2.5 Fork E — Harness

- **AI SDK 7 as the model-call layer only**: `ai@7.0.107` (2026-09-18), v7 major on 2026-06-25. The tool-approval policy API maps 1:1 onto omnis's draft-then-approve. **✓**
- **Eve only for 1–2 individual agents (reply drafts, nightly digest)**: `20`'s measurements CONFIRMED that self-hosting is possible and `@workflow/world-postgres` allows sharing the existing Postgres. But it requires Node ≥24, needs the `bootstrap` migration run first, and idles at ~550MB RSS (measured on a 64GB MacBook, not on the mini). **△ Conditional**
- **Mastra/LangGraph/Temporal/Restate/Inngest**: all answers to bigger problems. No justification for another process on 16GB. **✗**
- **Claude Agent SDK (TS)**: fits naturally as the agent session bridge. But `gh api` reports the license field as `null`, so check the LICENSE directly before redistributing. **✓ Auxiliary**

### 2.6 Fork F — Client + sync

| Axis | Option | Verdict rationale |
|---|---|---|
| macOS | **Tauri 2** (★111,195, active) vs RN-macOS vs SwiftUI | ✓ Tauri 2 — TS reuse, native vibrancy via `window-vibrancy` |
| iOS | PWA (`13`'s MVP recommendation) vs Tauri iOS vs Capacitor | **△ Contradiction** — `13`'s own table rates PWA's Apple-native feel as "low", while the brief and `14` make Apple-native a hard requirement. Logan must decide (§6) |
| Hub access | Tailscale Serve vs **TailscaleKit (embedded tsnet)** | ✓ Start with Serve, bring the TailscaleKit evaluation forward. `13`'s "biggest risk" framing is **weakened** — #19147 has 5 comments and a diagnosis pointing to a third-party DoH app |
| sync | **Zero (rocicorp/mono)** vs PowerSync vs ElectricSQL vs custom WS | ✓ Zero — ends with a single Postgres. PowerSync defaults to MongoDB when self-hosted, which is a burden on 16GB (`27` §3). "PowerSync is the most production-proven" is **self-marketing copy** found in no primary source |
| Event tiers | **3-tier split** | ephemeral (deltas, WS/NOTIFY, not replicated) / durable (debounced Item rows) / cold (full raw log, hub-local only) — `27` §4 |

### 2.7 Fork G — Cost policy

- **Tier 0 local ($0)**: classification, labeling, embeddings. `12` noted that an M4 16GB cannot run the MLX fast path (32GB+), and `90` criticized the absence of "an always-on host for free local classification", but `26` effectively resolved it — nomic-embed (274MB) and a 1–3B classifier are enough for the mini via Ollama; only a 30B-class MoE needs 32GB+. Only heavy local inference goes to the M5 MacBook.
- **Tier 1 DeepSeek Flash**: cache-hit $0.003/$0.006, cache-miss $0.15/$0.30, output $0.60/$1.20 per 1M (re-confirmed today). Peak = UTC Mon–Fri 01–04, 06–10. Schedule nightly batches after 19:00 KST.
- **Tier 2 Claude Sonnet 5 / Haiku 4.5**: VIP, low-confidence, memory consolidation, orchestration.
- **Tier 3 subscription CLI**: unmodified `claude`/`codex` binaries as subprocesses. **Using OAuth tokens through the Agent SDK to bypass this is explicitly prohibited** (original wording re-confirmed today).
- Gateway: OpenRouter first (0 token markup, 5.5% card top-up fee); Vercel AI Gateway as a secondary when the AI SDK is used.
- Runtime estimate **$20–50/month** — not measured; must be replaced after 1–2 weeks of logs.

### 2.8 Fork H — Hub operations

- **The daemon/agent split is a constraint, not a choice** (Apple TN2083): Postgres, Hermes, and bridges as LaunchDaemons; KakaoTalk.app and the LinkedIn browser profile must be LaunchAgents in the logged-in session.
- Auto-login + `pmset -c sleep 0 displaysleep 0 disksleep 0` + `caffeinate` redundancy. The FileVault conflict is unverified (§6).
- Containers: **Colima** (MIT) on the existing Lima; do not add Docker Desktop/OrbStack.
- Process supervision pm2 (registers with launchd internally), backups restic+B2, monitoring healthchecks.io free 20 jobs + self-hosted ntfy.
- **`idle_replication_slot_timeout` defaults to 0 (disabled)**, so if zero-cache dies, WAL accumulates unbounded and fills the disk — an explicit setting + a slot health check are mandatory (`27`).

---

## 3. Channel feasibility matrix

| Channel | Best route | Fallback | Read/Write | Reliability | Ban/ToS risk | Effort | MVP |
|---|---|---|---|---|---|---|---|
| **Slack** | Socket Mode (WS, outbound-only) + `xoxp` user token | Events API (requires a public endpoint) | Full R/W (search, others' DMs, sending as yourself) | High — official, and the openclaw manifest is reusable | Low (normal OAuth delegation). But a company workspace admin can block custom app installs | S | **Yes** |
| **Gmail** | `users.watch()` + Cloud Pub/Sub **pull** subscription | `history.list` polling | Full R/W (label/draft/send) | High — no public endpoint needed, re-watch every 7 days | Low. Must publish the OAuth app as Production (Testing expires refresh tokens after 7 days) | M | **Yes** |
| **Outlook/M365** | Graph API delta polling → webhook once stable | IMAP+OAuth2 | Full R/W | High — max subscription lifetime **10,080 minutes (≈7 days)**, a weekly renewal suffices | Low. Personal use does not require publisher verification | S→M | Yes (late Phase A) |
| **Google Calendar** | `events.list` + `syncToken` polling (1–5 min) | **Retry `events.watch` push** | R/W (including creating holds) | High | Low | S | **Yes** |
| **Telegram** | mtcute (MTProto user account, official `api_id`) | Telethon (separate Python process) | Full R/W + markAsRead | Medium-high — mtcute is active (pushed 2026-09-19), SQLite session built in. gramjs was archived 2026-07-14 | Low — unofficial clients are subject to automated observation but are on the normal track unless flooding/spamming | S–M | **Yes** |
| **WhatsApp** | **Beeper Desktop API** (internally the whatsmeow family) | whatsmeow Go sidecar | R/W (docs list generic send + read/unread) | Medium — experimental WebSocket (`ws://localhost:23373/v1/ws`, 4 event types), no latency/SLA documented | **Medium** — reverse-engineering WhatsApp Web is itself a gray area, and ban probability is unquantified. Beeper's docs also state "personal use only, suspension for excessive sending" | S (Beeper)/M (own) | Yes (conditional on the spike passing) |
| **KakaoTalk** | `kmsg` (macOS AX automation, MIT) — LaunchAgent in the mini's GUI session | Notification Center DB trigger + Vision OCR | R detailed / W text and images (dry-run by default) | Medium — has an AX self-healing cache but is fragile against KakaoTalk updates. **`kmsg mcp-server` exposes only 3 tools — read/send/send_image — and `watch` requires a separate process** | **Medium-to-high** — the author himself documents permanent-ban cases. Kakao's official policy explicitly prohibits reverse engineering and bots/macros, and lists "PC 에뮬레이터 등 비정상 환경" (abnormal environments such as PC emulators) as a detection trigger | M | Yes (Phase C) |
| **LinkedIn** | Resident Playwright profile (on the mini, low-frequency randomized polling) | ① Parse LinkedIn notification emails arriving in Gmail (a zero-cost signal) ② Unipile (from €49/month) ③ `mautrix/linkedin` (after the bug is fixed) | R/W (draft-then-approve) | **Low** — no official API, and the bridge's upstream is broken (#55 still open today) | **Medium-to-high** — User Agreement 8.2 explicitly prohibits all automation and scraping. Unipile's default cap is **100/day** per action (not 150) | M | Phase C |
| **Agent sessions (Claude Code/Codex/DeepSeek/Hermes)** | Thin wrappers over native headless surfaces (`claude -p --output-format stream-json --resume`, Codex `app-server` JSON-RPC, Hermes `/v1/responses` + session headers) | — | R/W (start, resume, abort turns) | Medium — a Codex app-server alpha is cut 4–5 times a day (today `rust-v0.156.0-alpha.8`). Version pinning is mandatory | Low (your own accounts). But watch `fable` headless billing | M | **Yes (Phase A)** |

---

## 4. Recommended stack

| Layer | Primary | Runner-up | Selection rationale |
|---|---|---|---|
| **Agent harness** | Vercel AI SDK 7 (`ai@7.0.107`) + homegrown Postgres kernel (events + `LISTEN/NOTIFY` + cron + `pending_approvals`) | Eve self-host **only as individual agents** for reply drafts and digests | The kernel unit must be "one event bus", but Eve's unit is "agent = process" (`20`). The AI SDK has no lock-in |
| **Agent session bus** | Custom thin bridge + Hermes's `session_key`/`session_id` split + a delegation MCP server (`delegate_to_codex`, etc.) | ACP (once multi-vendor becomes necessary) | `09` §4; `codex mcp-server` does not exist, so connect directly to app-server JSON-RPC |
| **Memory** | ① flat-file self-model (`USER.md`/`SOUL.md`/`AGENTS.md`, frozen snapshot) ② mem0 OSS + pgvector (768d nomic-embed via Ollama) ③ Postgres bi-temporal entities (`valid_from/valid_until/recorded_at/invalidated_at`) | Honcho self-host (unmodified, isolated API calls) | mem0 OSS removing the graph makes ③ mandatory. Honcho is AGPL, which may conflict with app-distribution plans |
| **Model tiers** | T0 local (classification/embeddings, $0) / T1 DeepSeek Flash (drafts, note routing) / T2 Sonnet 5 · Haiku 4.5 (VIP, low-confidence, memory consolidation) / T3 subscription CLI (development, personal sessions) | Gateway: OpenRouter → Vercel AI Gateway | cascade + prompt-cache prefix discipline + Batch API 50%. **Estimated $20–50/month (unmeasured)** + separate build-time DeepSeek |
| **Client** | macOS Tauri 2 → merge iOS in v2 | iPhone MVP as an installed PWA (contradiction, §6) | Tauri 2 is stable and active; Liquid Glass via `window-vibrancy` |
| **Sync** | Zero (rocicorp/mono, Apache-2.0) + 3-tier event split | PowerSync (mobile-first but requires MongoDB) | Ends with a single Postgres. At 1 user and 2–3 devices, neither hits its ceiling |
| **Storage** | Postgres (on the mini; SQLCipher for the local message store) + pgvector + append-only R/W audit log | — | FileVault only protects when powered off → app-level encryption is separately required |
| **UI system** | Tailwind v4 + shadcn/ui (Radix base) + react-virtuoso + Tiptap + shadcn Command (⌘K) | TanStack Virtual / Lexical | Inbox rows are variable-height and channel-grouped, so virtuoso wins |
| **Dev pipeline** | OMC `ralph` skill + worktrunk (one worktree per story) + `assignedTier` extension + DeepSeek delegation branch | claude-squad (only when a human is watching) | `fable` only for interactive planning sessions, **excluded** from headless loops |

---

## 5. Borrow list

### 5.1 Product/features

- **kinso's trio** (tone-matched draft + morning briefing + contextual linking) — `01` — adopted as-is as the baseline for omnis's target feature set.
- **kinso's morning briefing copy structure** ("Good morning, {name}. You've got N new and M active conversations." + "Today's briefing" pill) — `23` — reused almost verbatim as the template for morning briefings and nightly digests.
- **Superhuman Auto Labels** (short natural-language prompt → label rule generation) + Split Inbox — `17` — the UX archetype for automatic work/personal filtering and topic auto-labeling.
- **Superhuman Instant Reply** ("open an inbox that already has drafts attached") — `17` — the product expression of G4 (a draft ready within 60 seconds of inbound).
- **folk Follow-up Assistant** (detect inactive conversations → decide the pending next step → tone-matched draft) — `17` — the only commercial precedent for notes→routing/follow-up automation, and the algorithmic skeleton.
- **Dex** (15+ source integration, keep-in-touch reminders, calendar-triggered pre-meeting briefs, **an exposed MCP server**) — `17` — the primary blueprint for the Network module.
- **Motion/Reclaim's task→calendar time blocking** + **Todoist's extract→confirm** — `17` — the capture and placement model for agent todos.
- **Artemis's Flash/Pro dual profile** — `03` — light labeling runs a reactive loop with no plan; reply drafts and CRM judgments run a Planner+Checker loop.
- **The Notion Mail shutdown lesson** (2026-09-22) — `14` — make "the path that does not require opening the inbox (notification → review draft → one-click send)" a first-class citizen.

### 5.2 UX/design

- **kinso list rows** (circular avatar + bold name + gray timestamp + one-line preview + **a fixed brand icon on the right**) — `23` — channel identification is delegated to icons instead of color, separating "who" from "where".
- **kinso selected-row elevation** (no hairline dividers; only the selected row becomes a white card + soft shadow) — `23` — a third axis distinct from Linear/Raycast's hairline density.
- **kinso's pill input with gradient-stroke focus**, **dotted unread indicator**, **squircle channel icon tiles** — `23`.
- **Liquid Glass layer rules** (glass only on sidebar/toolbar/sheet/palette; lists and body text opaque) — `14` — enforced as a code rule. Violations instantly read as "an AI-made UI".
- **Superhuman's command palette** (centered modal; showing `kbd` shortcuts to the right of actions to teach them) + **Arc's sidebar-as-first-class-navigation** — `14` — make ⌘K omnis's core interaction, with agent actions (delegate to Codex, call Hermes) in the same palette.
- **Linear/Raycast dark tokens** (near-black canvas + 0.5–1px hairlines + a single accent + 100/160/400ms motion) — `14` — kinso has no dark mode at all (`23`), so dark comes only from here.
- **Pretendard + Inter fallback chain**, three weights (400/510/590) — `14`.
- **agentic-inbox's "Edit & send in composer" gate** and **`TOOL_LABELS` + `ToolCallBadge`** — `22` — the archetype for the Draft card's approval UX, and the minimal pattern for mapping tool calls to label + icon + progress state when showing an agent session as a thread.
- **Beeper `ai-bridge`'s "one model = one contact, one conversation = one resumable room"** — `09` — the closest blueprint for how an agent session should feel in the inbox (though do not borrow the Matrix coupling).

### 5.3 Architecture

- **Hermes's `X-Hermes-Session-Key` (stable scope) vs `X-Hermes-Session-Id` (rotating transcript) split + `GET /v1/capabilities` self-description** — `09` — port directly into the omnis bridge protocol. The highest-value finding of this sweep.
- **Hermes's flat-file + pluggable MemoryProvider (only one active at a time)** and **frozen-snapshot injection** (preserving the prefix cache) — `10` — the memory architecture skeleton + cache cost savings.
- **Hermes's `*_write_approval` gates (default false)** — `11` — apply to every auto-generated write.
- **Graphiti's 4-timestamp bi-temporal edge schema** — `10`/`26` — as-is into the Postgres entity table columns. Now mandatory.
- **Honcho's peer model** (user/agent/group/project/idea all as the same first-class entity) — `10` — the Network schema frame.
- **agentic-inbox's Draft = Item status + tool-set isolation** — `22` — enforce approval through tool-palette design, not prompts.
- **agent-inbox's `HumanInterrupt`/`HumanResponse` 4-way config** — `22` — the direct starting point for the Action object interface.
- **buzz's ACP harness pipeline** (event subscription → normalization → agent prompt → write-back) and **kind-based dispatch**, **`buzz-cli` JSON in/out + exit-code convention (0/1/2/3/4/5)** — `02`/`22` — but do not reference the execution logic of `request_approval`, since its implementation is broken (🚧 WF-08).
- **OpenClaw binding-rule routing** (deciding the agent by channel/account/contact/group) and **harness-as-swappable-plugin** — `09`/`11`.
- **Eve's approval-policy API state machine** (`never/once/always/auto()`, separating request and response authority) and **`@workflow/world-postgres` schema separation** (runs/events/steps/hooks/stream_chunks/waits/event_slots) — `20` — suggests a better shape for the homegrown kernel's `pending_approvals` than "one events table".
- **Codex's `item/started` + `item/completed` two-phase lifecycle** → mapping to a durable row's `streaming`/`complete` states — `27`.
- **Beeper Remote Access's `X-Forwarded-*` base-URL computation** — `04`/`21` — the pattern for bundling local services behind Tailscale into a single gateway.
- **kmsg's `chat_id` local registry** (variable room names → stable synthetic IDs) — `05` — a reference for cross-source unified thread ID design.
- **TN2083 daemon/agent split** — `18` — a structural constraint on service placement.
- **healthchecks.io ping convention** (`/start`, `/fail`, exit-code suffix) — `18` — agent session heartbeats as omnis inbox notifications.

### 5.4 Code/libraries

- `channprj/kmsg` (MIT, ★266) — the KakaoTalk connector via a brew install + MCP 3 tools + a separate `watch --json` process. The key to dropping effort from L to S.
- `tulir/whatsmeow` (MPL-2.0, ★7,363) — the immediate fallback if the Beeper spike fails. `Sealjay/mcp-whatsapp` (wrapping whatsmeow into 42 MCP tools) and `openclaw/wacli` (formerly `steipete/wacli`, ★2,747) are reference implementations.
- `mtcute/mtcute` (MIT, ★562) — native TS Telegram, dual QR + phone-code login, better-sqlite3 session.
- `openclaw/openclaw`'s `extensions/slack` + the Socket Mode manifest in `docs/channels/slack/setup.md` — a starting point. **Caveat: `extensions/google` is a Gemini model provider, not a Gmail/Calendar adapter.**
- `NangoHQ/nango` — self-hosted OAuth token storage/refresh. But the SPDX is `NOASSERTION` (custom license) — do not assert it is "open source".
- `mem0ai/mem0` (Apache-2.0, ★65,651) `mem0-ts/src/oss/src/embeddings/ollama.ts` — an embedding wiring example.
- `cloudflare/agentic-inbox` (Apache-2.0, ★7,942, **pushed 2026-04-23 = a 5-month no-commit snapshot**) `workers/db/schema.ts`, `workers/lib/tools.ts`, `workers/agent/index.ts` (9 tools, no send) vs `workers/mcp/index.ts` (12 tools, has send) — a direct reference for schema and tool isolation.
- `langchain-ai/agent-inbox` (MIT, ★1,092, pushed 2026-09-18) `src/components/agent-inbox/types.ts`, `hooks/use-interrupted-actions.tsx`, `components/generic-interrupt-value.tsx`.
- `rocicorp/mono` (Apache-2.0, ★3,390) + `rocicorp/zslack` (an Expo+RN+Zero Slack clone) — a reference implementation for inbox list/thread views.
- `tailscale/libtailscale` Swift (TailscaleKit) — embed tsnet in an iOS app; a simulator-free framework for App Store submission exists. `willmortimer/TailnetKit` and `indiagrams/tunnelless` are API design references.
- `max-sixty/worktrunk` (★8,111) — one worktree per story, script-first rather than TUI. `smtg-ai/claude-squad` (AGPL-3.0, ★8,497, pushed 2026-08-20) only when a human is watching. **claude-squad's README roster is actually Claude Code/Codex/Gemini/Aider, not OpenCode/Amp.**
- `~/.claude/plugins/cache/omc/oh-my-claudecode/4.14.5/skills/ralph/SKILL.md` — adopt as the omnis build loop **itself** (do not build a new one).
- `tauri-apps/window-vibrancy`'s `apply_liquid_glass`/`NSGlassEffectViewStyle` + `tauri-plugin-mobile-push` (AppDelegate delegation without swizzling).
- `abiosoft/colima` (MIT) — container runtime on the existing Lima.

---

## 6. Open questions (Logan must decide — only those that actually change the plan)

1. **Do we replace Hermes or incorporate it?** `01-definition-draft` §8/§10 state that "omnis fully replaces the mini's Hermes/omh/buzz setup and does not share Hermes memory either", while the brief and `09`/`11` treat Hermes as one of the four inbox agents and use `api_server` as the bridge foundation. The two statements are incompatible. (Incorporating is technically far cheaper — which is exactly why `09` named the Hermes header pattern the highest-value finding.)
2. **iPhone client: is starting with a PWA acceptable?** `13` recommends a PWA for the MVP while its own table rates PWA's Apple-native feel as "low". The brief explicitly required "as Apple-like as possible". Which do we accept: a PWA MVP (cheap and fast, push constraints) or a single Tauri iOS codebase (expensive, thin App Store review precedent)? This choice drives the entire Phase B schedule.
3. **Do we attach WhatsApp to your primary personal number?** No source has quantitative data on ban probability, and recovery is hard. `07` strongly recommended a **secondary-number pilot**. The account carries Underpin/Onword communications, so Logan's explicit confirmation is needed.
4. **Do we accept the KakaoTalk automation risk?** kmsg's author documents permanent-ban cases in the README, and Kakao's official policy prohibits reverse engineering and bots/macros and contains the blanket clause "이용환경 및 이용패턴 분석" (analysis of usage environments and usage patterns) (the AX approach does not hit the wording exactly, but it is a gray area). How does Logan value the cost of losing a Kakao account?
5. **Do we pass personal inbox content through a China-hosted model?** Tier 1 is entirely DeepSeek-based. A policy decision is needed before writing code on whether to exclude PII fields from prompts or route only specific threads to Tier 2 (`12` §6).
6. **Is the company GitHub repo private?** If public, sops+age config encryption is promoted from Later to MVP (`15` §6).
7. **Do we allow Honcho (AGPL-3.0) as a fallback?** The goal of "a MacBook + iPhone download service later" may conflict with AGPL's network-distribution clause. Unmodified self-host + isolated API calls greatly reduces the risk, but this is a project policy decision, not legal advice.
8. **Do we redefine G6 (standalone) as `25` proposes?** Whether to state honestly in the product definition that "Slack/Gmail/Outlook/Telegram/WhatsApp/Calendar + agents are fully hub-less, while KakaoTalk/LinkedIn require one always-on device." Not writing it down now incurs redesign cost in Phase D.
9. **Do we run the Calendar push spike?** The domain-ownership verification requirement is **abolished** per today's re-check (support.google.com/googleapi/answer/7072069: "Domain verification in the API Console is no longer required"); the only remaining requirement is HTTPS + a valid SSL cert, so Tailscale Funnel passes in theory. A 30-minute spike determines whether Calendar becomes a real-time channel or a near-real-time one.

---

## 7. Top 10 risks

| # | Risk | Evidence | Mitigation |
|---|---|---|---|
| 1 | **Prompt injection → inducing real actions.** The entire inbox (untrusted input) and execution authority live in one system. OWASP LLM01 has been #1 two years running | `15` §2; Anthropic concedes that even a 1% ASR for browser agents is "a meaningful risk" | Always tag and separate inbox text as data / **exclude irreversible tools from the autonomous loop's palette at the source** (`22`) / a per-task tool allowlist / classifier scanning (agentic-inbox's `isPromptInjection` pattern) / approval for full-content exposure before any external send / audit logs / kill switch |
| 2 | **KakaoTalk/LinkedIn account suspension.** Recovery is hard, and it directly affects business communications | `05` (author's own admission), `25` (Kakao's explicit prohibition wording), `06` (User Agreement 8.2) | Read-first, with send going dry-run → one-time approval / randomized polling intervals at human-level frequency / no unprompted outbound / a fixed IP (Tailscale) / a checklist that repurposes talksafety's detection-trigger list / 2FA |
| 3 | **WhatsApp session ban.** No quantitative data; whatsmeow and Beeper share the same root | `07` §2, `21` §3 | Prefer a secondary-number pilot (§6.3) / read-mostly + draft-then-send / avoid datacenter IPs / no bulk sending |
| 4 | **Mac mini as a single point of failure.** If the GUI session locks or auto-login is reset by a macOS update, Kakao/LinkedIn capture stops entirely | `18` §4 (FileVault–auto-login conflict UNVERIFIED), `25` | A LaunchAgent that re-applies pmset/auto-login at boot / `caffeinate` redundancy / healthchecks dead-man's-switch + ntfy push / split capture into a sidecar to minimize host-migration cost |
| 5 | **Unbounded WAL accumulation fills the hub disk.** `idle_replication_slot_timeout` defaults to 0 (disabled) + a zero-cache crash | `27` §2 (official PostgreSQL docs) | Set this value explicitly / include a slot health check in monitoring / disk threshold alerts |
| 6 | **Codex app-server protocol drift.** Even today an alpha is cut 4–5 times a day (`rust-v0.156.0-alpha.8`, 2026-09-19) | `09` §4, re-checked today via `gh api` | Pin the Codex version / feature-detect from the `capabilities` array / design the bridge's own protocol around the MCP 2026-07-28 negotiation model |
| 7 | **`fable` headless billing without consent.** With `-p`/Agent SDK no consent prompt appears and usage credit is simply charged | Re-confirmed today from the code.claude.com/docs/en/model-config source | Exclude `fable` from the ralph loop's model pool / planning only in interactive sessions / cap the escalation path at DeepSeek→Sonnet→Opus |
| 8 | **Crossing Anthropic ToS boundaries.** Routing OAuth tokens through the Agent SDK/backend makes the account subject to enforcement action | Re-confirmed today from the code.claude.com/docs/en/legal-and-compliance source | Call the unmodified `claude` binary only as a subprocess / never harvest tokens / use an API key for product backends / since "ordinary individual use" has no published threshold, keep max-iteration caps and human checkpoints on 24/7 script loops |
| 9 | **ralph loop runaway.** ghuntley himself warns you "wake up to a codebase that doesn't compile" | `24` §2 | Escalate one tier after at most 3 attempts per story / `--max-iterations` wall-clock cap / `git reset --hard` to the last verified commit / separate implementer and reviewer contexts (no self-approval) / DeepSeek diffs must be reviewed by Sonnet or above |
| 10 | **Vendor/upstream evaporation.** Beeper's pricing policy is undisclosed (`pricing` 404), agentic-inbox has 5 months with no commits, mem0 removed the graph entirely within 6 months, and Eve is a 3-month-old public beta protocol pin | `21`/`22`/`26`/`20` | Put channel adapters behind a swappable interface (the Notion Mail lesson) / pin mem0, eve, and `@workflow/*` versions + quarterly re-verification / for Beeper, depend only on WhatsApp so the exit cost is limited to migrating to whatsmeow |

---

## 8. Verification summary — refuted / unverifiable claims that still matter

**Refuted (the source text was wrong and it affects the plan)**

1. **The current MCP spec is 2026-07-28, not 2025-11-25** (re-confirmed today). Not an `initialize` handshake but `_meta`/header per-request negotiation + a mandatory `server/discover`. `09`'s body and `15`'s MCP security guidance were written on an older model.
2. **mem0 OSS's graph memory has been removed** (re-confirmed today). `10`'s claim that "the graph is an optional add-on" is void, and Network relationship queries have no path other than a custom Postgres table.
3. **Eve is not Vercel-only** (`20` spike + today's doc re-check: `eve build && eve start`, the Nitro schedule runner auto-starts, both `/eve/` and `/.well-known/workflow/` need proxying). Discard `11`'s *rationale* for rejection but keep its *conclusion* (not the kernel) on process-model grounds.
4. **Google push's Search Console domain-ownership verification has been abolished** (original source re-confirmed today). The reason `08`'s body pinned Calendar to polling is gone — a spike is needed.
5. **MS Graph's maximum subscription lifetime for Outlook message/event/contact is 10,080 minutes, not 4,230** (table checked directly today). 4,230 minutes applies to other resources such as Teams callRecord, group conversation, printer, and todoTask. The renewal cron can be relaxed from 3 days to weekly.
6. **`codex mcp-server` does not exist** (confirmed from source in `09`'s verification pass). Delegation is only possible by connecting directly to app-server JSON-RPC.
7. **kinso's $59/month has no basis.** `07`/`14` marked it VERIFIED, but `01`/`23` and my own re-check today find no price anywhere on kinso.ai, and `kinso.ai/pricing` is 404. **`01`/`23` are better sourced — delete the $59.**
8. **The Notification Center DB is not "banner previews only."** Before Sequoia it stored even iMessage bodies in plaintext, and *that is why* it was locked down behind TCC/FDA. `05`'s framing of "almost no risk, trigger-only" understates it.
9. **`katok` is not an export-based read-only backfill tool.** It supports live ingestion via `katok sync --source macos` and requires Full Disk Access plus container/DB access diagnostics — sensitivity close to that of the SQLCipher gist path.
10. **Slack's "rate limits apply to existing installations from 2026-03-03" appears in no primary source.** The changelog actually states the opposite: that it does not apply to existing installations. Delete it from the plan.
11. **openclaw's `extensions/google` is a Gemini model provider, not a Gmail/Calendar adapter.** No email/calendar code can be borrowed from this repo.
12. Minor but citation hygiene: Unipile's default cap is **100/day** per action (not 100–150); the hiQ settlement was **2022-11** (not December); the Zep→Graphiti transition was **2025-04** (not 2026); Memori is **Apache-2.0** (not NOASSERTION); claude-squad's roster is **Gemini/Aider** (not OpenCode/Amp); goose has **left the `block` org**; droidrun/mobilerun is **91.4%** on AndroidWorld (not 63%); Letta's active development moved to `letta-code` (★3,381); Yjs's weekly downloads are **~6.2M** (not ~920K).

**Unverifiable (still open and affecting decisions)**

- **Kakao's exact concurrent-connection limit of "one mobile + one PC/tablet."** `05`, `25`, and today's check all failed to find a primary source (`cs.kakao.com` category 1056 renders its content via client-side JS). This was the original argument for excluding Android emulators, but the "PC 에뮬레이터 등 비정상적인 환경" (abnormal environments such as PC emulators) detection-trigger wording that `25` found is **a stronger replacement rationale**, so the conclusion (exclude emulators) stands.
- **Whether the Beeper Desktop API is pay-gated.** `beeper.com/pricing` is still 404 today, and the FAQ does not even mention the Desktop API. Only issuing a token on a free account will close this.
- **Whether Beeper can actually send on LinkedIn/WhatsApp.** The API reference neither affirms nor denies per-network exceptions. Only a 30-minute spike closes this.
- **Whether the experimental Beeper WebSocket's latency** satisfies G1 (5 seconds for API channels) — the docs carry no numbers at all.
- **omnis's actual event volume.** `27`'s estimate of "1,000–30,000 per day" is unverified, and the Codex-side measurement could not complete due to account usage limits. One week of logs is needed.
- **Measured nomic-embed (Ollama) throughput/latency on an M4 16GB.** Only the spec was confirmed.
- **Whether auto-login works on macOS 26.6 with FileVault enabled** — no Apple primary doc found; direct testing is needed. It is a precondition for hub operations, so it is high priority.
- **Whether the Tailscale Serve `*.ts.net` iOS SSL issue (#19147) actually reproduces.** `13` said "no comments/assignees", but in reality there are 5 comments, including a diagnosis and a resolution report pointing to a third-party DoH app (DNSecure) conflict — **the "biggest risk" `13` identified is likely overestimated.** Try to reproduce it first on a clean network.
- **Whether PowerSync can use Postgres as its storage backend without MongoDB** — unconfirmed. Moot if we choose Zero.
- **Whether Fable can be called at a fixed rate with a Console API key** — it is not in the public per-token price list. If not, exclude it from headless entirely; if so, allow it with a hard budget cap.
- **Artemis's "Pixel Test Engineering Fusion team, 2026-09-10" sourcing** — no Google primary source (AlphaSignal alone). Cite it only as "a single secondhand media report".
- **RAGAS's individual metric definitions** — unconfirmed. Stage 1 is served by a 20-line recall@k script, so there is no immediate impact.
