# A5 — UI/UX details

Version 1.0 (2026-09-20, incorporating global review pass 2 `99-review-v2.md`. pass 1 `99-review.md` is also cumulatively reflected). Sources: `00-omnis-design.md` (master v1.0, expanded in §4.2/§6/§12), `A3-data-schema.md` (§3 `persons.primary_thread_id`), `A4-agent-layer.md` (§3.6 three draft notification tiers, §14 unified search contract), `BRIEF-2026-09-20.md`, `research/14` (Apple design language), `research/23` (kinso hands-on teardown), `research/01` (kinso and competitors), `research/17` (todos, briefing, Network, notes), `research/22` (agentic-inbox / agent-inbox source reading), `research/13` (client architecture, sync). Master §5 D1–D16, §6 data model, §11 loops, §14 cost policy, §16 Phase, §19 Q1–Q12 are settled premises; this appendix only elaborates on top of them.

## Decisions this appendix settles

| # | Decision |
|---|---|
| A5-D1 | Color is dark-first OKLCH tokens in 3 layers (primitive → semantic → component), light mode fully defined, pinned to a single accent `--accent` (master D8 reaffirmed) |
| A5-D2 | Typography uses the `Pretendard Variable, Inter Variable, -apple-system, system-ui, sans-serif` chain, 3 weights (400/510/590), a 6-step type scale (12/13/14/16/20/26px) |
| A5-D3 | Spacing follows an 8px ladder (4/8/12/16/24/96), 4 radii (6/10/16/999), borders are 1px hairlines instead of shadows (`8% opacity`) |
| A5-D4 | Motion uses 3 durations 100/160/400ms plus a single spring easing, all falling back to 0 under `prefers-reduced-motion` |
| A5-D5 | Liquid Glass only on sidebar, toolbar, sheet and command palette; list rows, body text and the editor are always opaque. `window-vibrancy` first; CSS `backdrop-filter` only as the Linux/Windows fallback |
| A5-D6 | Icons are the single Lucide set (2px stroke); channel brand icons always occupy a fixed right-hand slot in list rows and the sidebar |
| A5-D7 | Navigation is a left sidebar (filter pills + 8 sections) + a fixed 3-pane (sidebar/list/detail) layout, with no separate tab bar |
| A5-D8 | ⌘K is a global command palette absorbing navigation, triage, agent actions and search. Keymap is j/k/e/r/a/s/d/l/t/n/⌘K/⌘Enter/Esc plus a go-to prefix (`g` then letter) |
| A5-D9 | Drafts are not a separate screen but a card component (`DraftCard`) plus an "Edit & send" gate. Full text is always shown, never replaced by a summary |
| A5-D10 | Irreversible actions (send/delete/delegate/calendar_write) are unified behind a single `ApprovalSheet`, with `HumanInterrupt`'s 4-way config (accept/edit/respond/ignore) deciding which buttons each action allows |
| A5-D11 | Agent Session is a variant of the Thread view, rendering a label + icon + progress badge for every tool call via the `TOOL_LABELS` mapping |
| A5-D12 | List row: avatar + name (bold) + timestamp (right side of the same line) + 1-line preview + channel icon on the right. The selected row is an elevation (soft shadow) card; unread is marked with a dashed circular indicator (no hairline divider) |
| A5-D13 | iPhone is a Phase B installed PWA; the layout is a single column + bottom tab bar (5), with fixed swipe left/right actions |
| A5-D14 | Components are assembled on shadcn/ui primitives (Radix base) + react-virtuoso (lists) + Tiptap (editor) + cmdk/shadcn Command (palette), plus 9 omnis-specific custom components |
| A5-D15 | The Tauri shell treats sidebar vibrancy, a resident menu bar tray, global shortcuts and `omnis://` deep links as first-class |
| A5-D16 | Sound uses only minimal macOS system sounds (no custom audio branding); haptics only for approval/swipe via the iPhone PWA's Vibration API |

---

## 1. Design language and tokens

### 1.1 Color

3 layers: **primitive** (raw color scale) → **semantic** (role names, redefined separately for dark and light) → **component** (individual components reference only semantic). Component CSS never references a primitive directly — this rule itself is a code review checklist item (§9).

We adopt the "near-black canvas + single accent + hairline border" pattern that Linear (`#08090a` + lime) and Raycast (`#07080a` + coral) both proved (`14`). kinso's dual gradient accent (teal↔orange, `23`) is not adopted because master D8 already settled on a "single accent" — not open for re-discussion.

```css
:root {
  /* primitive (dark defaults) */
  --gray-950: oklch(0.14 0.005 260);
  --gray-900: oklch(0.17 0.006 260);
  --gray-850: oklch(0.19 0.006 260);
  --gray-700: oklch(0.32 0.006 260);
  --gray-500: oklch(0.55 0.006 260);
  --gray-300: oklch(0.78 0.004 260);
  --gray-100: oklch(0.94 0.002 260);
  --gray-000: oklch(0.99 0.001 260);

  /* single accent — default. When Logan settles on a brand color, replace only this line */
  --accent-500: oklch(0.70 0.15 230); /* cool cyan-blue, a tone that does not collide with Linear's lime / Raycast's coral */
  --accent-600: oklch(0.62 0.16 230);
  --danger-500: oklch(0.62 0.19 25);
  --warn-500: oklch(0.75 0.15 80);
  --success-500: oklch(0.68 0.14 150);

  /* semantic — dark */
  --bg-base: var(--gray-950);
  --bg-elevated: var(--gray-850);
  --bg-overlay: color-mix(in oklch, var(--gray-900) 72%, transparent); /* glass surfaces only, §1.4 */
  --border-hairline: oklch(1 0 0 / 0.08);
  --border-hairline-strong: oklch(1 0 0 / 0.14);
  --text-primary: var(--gray-100);
  --text-secondary: var(--gray-500);
  --text-tertiary: oklch(0.55 0.006 260 / 0.7);
  --accent: var(--accent-500);
  --accent-fg: oklch(0.14 0 0);
  --shadow-row-selected: 0 4px 16px oklch(0 0 0 / 0.35), 0 1px 2px oklch(0 0 0 / 0.4);
}

:root[data-theme="light"] {
  --bg-base: var(--gray-000);
  --bg-elevated: oklch(0.97 0.002 260);
  --bg-overlay: color-mix(in oklch, var(--gray-000) 78%, transparent);
  --border-hairline: oklch(0 0 0 / 0.08);
  --border-hairline-strong: oklch(0 0 0 / 0.14);
  --text-primary: oklch(0.20 0.006 260);
  --text-secondary: oklch(0.42 0.006 260);
  --text-tertiary: oklch(0.55 0.006 260 / 0.75);
  --accent: var(--accent-600);
  --accent-fg: oklch(0.99 0 0);
  --shadow-row-selected: 0 4px 16px oklch(0 0 0 / 0.10), 0 1px 2px oklch(0 0 0 / 0.08);
}
```

The default is dark (no `data-theme` attribute = dark). Light requires an explicit `data-theme="light"`. macOS reads `prefers-color-scheme` as the initial value but Settings can override it manually (auto/dark/light 3-way; this is the only user-facing color setting).

**Channel identity is expressed through icons, not color** (measured in kinso, `23`): list row background colors and avatar tints never change per channel. Only the brand-colored icon in the fixed right-hand slot (Slack purple, Gmail red, WhatsApp green — each channel's official mark) carries color. Violating this rule (giving a row background a channel-color tint) is a §9 QA checklist failure item.

### 1.2 Typography

```css
:root {
  --font-sans: "Pretendard Variable", "Inter Variable", -apple-system,
    BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
  --font-mono: "SF Mono", "JetBrains Mono", ui-monospace, monospace; /* palette shortcuts and code blocks only */

  --text-xs: 12px;   --leading-xs: 16px;
  --text-sm: 13px;   --leading-sm: 18px;
  --text-base: 14px; --leading-base: 20px;
  --text-lg: 16px;   --leading-lg: 24px;
  --text-xl: 20px;   --leading-xl: 26px;
  --text-2xl: 26px;  --leading-2xl: 32px;

  --weight-regular: 400;
  --weight-medium: 510;
  --weight-semibold: 590;
}
```

The Pretendard (Korean) + Inter (Latin) chain is the standard practice that keeps each font from encroaching on the other's character set, so each renders only its own language (`14`). Bold (700+) is never used — 590 (semibold) is the heaviest emphasis weight. The body default is 14px (information density first — Things 3/Craft's "neither too airy nor too dense" density calibration, pulled one step denser to suit an inbox-style app, `14` §5). Pretendard is bundled from the npm `pretendard` package's variable font without subsetting (the full Korean glyph set is needed); Inter is subset to Latin only from the `inter` package.

### 1.3 Spacing, radii, hairlines

```css
:root {
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px;
  --space-4: 16px; --space-6: 24px; --space-16: 96px;

  --radius-sm: 6px; --radius-md: 10px; --radius-lg: 16px; --radius-full: 999px;

  --hairline: 1px solid var(--border-hairline);
  --hairline-strong: 1px solid var(--border-hairline-strong);
}
```

Card boundaries are expressed with hairlines, not shadows (Linear/Raycast pattern). There is exactly one exception — only the **selected list row** lifts with `--shadow-row-selected` (kinso pattern, `23`). box-shadow is forbidden everywhere else (except the self-elevation of popovers/dropdowns).

### 1.4 Motion

```css
:root {
  --dur-fast: 100ms;
  --dur-base: 160ms;
  --dur-slow: 400ms;
  --ease-spring: cubic-bezier(0.2, 0, 0, 1);
  --ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
}
@media (prefers-reduced-motion: reduce) {
  :root { --dur-fast: 0ms; --dur-base: 0ms; --dur-slow: 0ms; }
}
```

Rules: **100ms** = hover/press feedback (buttons, list row hover), **160ms** = state changes (panel open/close, tab switch, badge appear), **400ms** = layout reflow (row removal followed by collapse in a list, sidebar open/close). Spring is unified into the single `--ease-spring` — never mix multiple easing curves (consistency is the difference from an "AI-made UI", §9). `prefers-reduced-motion` only drops durations to 0 and keeps the animations themselves (opacity/transform) so state changes are not cut off abruptly.

### 1.5 Liquid Glass usage rules (code rules)

Apple's official principle (`14`): glass is used only on the **control/navigation** layer (sidebar, toolbar, sheet, popover, command palette), never on **content** (lists, body text, scroll areas). We nail this down as an enforced rule at the CSS class level:

```css
/* allowed: --glass-* classes may be imported only by these 4 components (lint rule, §9) */
.glass-surface {
  background: var(--bg-overlay);
  backdrop-filter: blur(24px) saturate(1.4);
  -webkit-backdrop-filter: blur(24px) saturate(1.4);
  border: var(--hairline);
}
/* applies only to the Sidebar, Toolbar, Sheet (ApprovalSheet/settings modal) and CommandPalette containers */

/* forbidden: list rows, ThreadView body, DraftCard body, Tiptap editor — always opaque */
.opaque-surface { background: var(--bg-base); }
```

In the macOS Tauri shell, `window-vibrancy`'s `apply_liquid_glass` (macOS 26 Tahoe, `NSGlassEffectViewStyle`) is applied directly to the sidebar window layer, and `.glass-surface`'s `backdrop-filter` is kept only as the CSS fallback for platforms where vibrancy fails (Linux/Windows Tauri builds, and future expansions) (`14` option comparison). Research warns that `window-vibrancy`'s latest API may be unstable, "in progress as of 2026-09" (`14` §7), so the PoC includes a feature detect that automatically downgrades to the `.glass-surface` CSS fallback when vibrancy fails (checks `window.__TAURI__.vibrancy.supported`; on failure it sets a `data-vibrancy="css-fallback"` attribute on `<html>` so CSS can branch).

### 1.6 Icons

A single Lucide set, 2px stroke, only two sizes 16/20px (no other custom sizes). Lucide is closest to SF Symbols in shape grammar and is shadcn's default set, so there is no friction (`14`). Channel brand icons (Slack/Gmail/Outlook/Calendar/Telegram/WhatsApp/KakaoTalk/LinkedIn) and agent runtime icons (Claude Code/Codex/DeepSeek/Hermes/omnis) are stored as each official mark's SVG normalized to a 24×24 viewBox in `packages/ui/icons/channels/*.svg` and `packages/ui/icons/runtimes/*.svg`, and are used in list rows, the sidebar and settings **only in the right-hand or another designated fixed slot** (never mixed into the left avatar slot — A5-D6, D12).

### 1.7 Sound and haptics

Sound design was out of scope for this research round (`14` §7 open question). Default: **we do not create custom sounds.** The macOS app plays a system sound (`NSSound(named: "Glass")`, volume follows the system setting) only for pending-approval notifications, and is silent by default (turned on in settings). Every other interaction (send, archive, complete) is silent — following the conventional wisdom that gratuitous sound is a distraction in productivity apps. Condition for changing this default: if Logan feels during use that "feedback is lacking", review adding a single send-complete sound.

Haptics use the iPhone PWA's Web Vibration API (`navigator.vibrate()`), a single short pulse (10ms) on completing an approval swipe — because iOS Safari's Vibration API support is limited (it may not work regardless of silent mode), visual feedback (a check animation) always runs alongside, and haptics are treated only as reinforcement.

---

## 2. Information architecture and navigation

### 2.1 Sidebar

We adopt Arc browser's "sidebar = first-class navigation" pattern (`14`) — a single left sidebar absorbs all navigation, with no separate tab bar or top nav bar.

```
┌ Sidebar (glass) ──────────┐
│ ⌘K  Search / Ask omnis    │  ← palette entry point (pill button)
│                            │
│ Inbox                      │
│  ○ All            128      │  ← filter pill (5 of them, horizontal scroll or wrap)
│  ○ Work            84      │
│  ○ Personal         31      │
│  ○ Agents           9       │
│  ● Needs approval    4      │  ← selected state = elevation
│                            │
│ ─────────────────         │
│ 🗓 Today                   │
│ ✓ Tasks              12    │
│ 👤 Network                 │
│ 📝 Notes                   │
│ 🌙 Digest                  │
│                            │
│ ─── Agent sessions ───    │
│  Claude Code · kernel      │  ← active session list (live ones only)
│  Codex · adapter-slack     │
│                            │
│ ⚙ Settings                 │
└────────────────────────────┘
```

The 5 filter pills (All/Work/Personal/Agents/Needs approval) are views over a combination of `items.status` and `labels.kind='scope'` (work/personal) and are mutually exclusive (radio, matching master §12's UI grammar). "Needs approval" filters to only threads with `pending_approvals.state='pending'` — the badge number is always live (NOTIFY subscription).

### 2.2 3-pane layout

```
┌──────────┬───────────────────┬─────────────────────────┐
│ Sidebar  │  List pane         │  Detail pane              │
│ (240px,  │  (360–420px,       │  (flex, min 480px)        │
│  glass)  │  opaque)           │  (opaque)                 │
│          │                    │                            │
│  nav     │  InboxRow × N      │  ThreadView or             │
│  filters │  (react-virtuoso)  │  AgentSession or           │
│          │                    │  DraftCard edit mode, etc. │
└──────────┴───────────────────┴─────────────────────────┘
```

The list pane and the detail pane are always visible together (Today/Network/Notes/Digest/Settings spread their own layout across the whole detail area instead of a list pane — the 3-pane structure itself is kept, but some screens collapse the list pane width to 0, specified per screen in §3). The sidebar can be toggled collapsed with `⌘\` (standard Mac practice), and the list pane never shrinks below 320px (a variable-width resize handle is provided).

### 2.3 ⌘K command palette

Built on shadcn Command (wrapping cmdk), registering actions with the kbar pattern (`id + name + shortcut + perform`, `14`). The palette appears as a modal centered on screen and, Superhuman-style, exposes each action's shortcut as `<kbd>` on its right (`14` §5).

Action categories (separated by group headers):

1. **Navigation**: Go to Inbox / Today / Tasks / Network / Notes / Digest / Settings, Go to thread… (fuzzy search)
2. **Triage**: Archive, Snooze, Mark as Work/Personal, Add label…, Mark read/unread, Delete
3. **Draft & Reply**: Reply, Reply all, Edit draft, Regenerate draft, Discard draft, Send (⌘Enter)
4. **Agent actions**: Ask agent about this thread, Summarize thread, Delegate to Codex…, Delegate to Hermes…, Delegate to claude-ds…, Add task from this, Add note, Route note to…
5. **Approval**: Approve, Reject, Edit & approve (shown only when a pending_approval is waiting)
6. **Search**: search across people/threads/todos/notes (universal search, master §3)
7. **Settings/System**: Toggle theme, Toggle autonomy for this thread, Open kill switch, Sign out

Agent actions are **human-initiated** requests rather than the result of `propose_delegation`, so they do not conflict with tool palette isolation (master §11) — choosing "Delegate to Codex" in the palette creates a `pending_approvals(action='delegate')` and leads into the `ApprovalSheet` (not auto-execution).

### 2.4 Keymap (complete)

| Key | Action | Scope |
|---|---|---|
| `j` / `k` | Select next/previous row | List pane |
| `Enter` / `o` | Open the selected row | List pane |
| `e` | Archive | List pane, Thread |
| `r` | Reply (open the draft editor; if a draft exists open it, otherwise request a new one) | Thread |
| `a` | Approve (accept if a pending approval exists, otherwise no-op) | List pane, Thread, ApprovalSheet |
| `s` | Snooze (duration picker popover) | List pane, Thread |
| `d` | Delegate (open the Delegate palette submenu) | Thread, Agent Session |
| `l` | Open the label picker | List pane, Thread |
| `t` | Create a Task from this item | List pane, Thread |
| `n` | Focus new note input | Global |
| `x` | Select (toggle the multi-select checkbox) | List pane |
| `Shift+U` | Toggle read/unread | List pane, Thread |
| `/` | Focus search (filter inside the list pane) | List pane |
| `⌘K` | Open the command palette | Global |
| `⌘Enter` | Confirm send/approve in the currently open Composer/ApprovalSheet | Composer, ApprovalSheet |
| `Esc` | Close panel / clear selection / close palette | Global |
| `⌘\` | Toggle sidebar | Global |
| `1`–`5` | Switch filter pill (All/Work/Personal/Agents/Needs approval) | Global (Inbox context) |
| `g` `i` | Go to Inbox | Global (go-to prefix, next key within 300ms) |
| `g` `t` | Go to Today | Global |
| `g` `k` | Go to Tasks | Global |
| `g` `n` | Go to Network | Global |
| `g` `o` | Go to Notes (o = notes, n collides with Network) | Global |
| `g` `d` | Go to Digest | Global |
| `g` `s` | Go to Settings | Global |

We adopt Superhuman's principle of "teaching shortcuts by showing them beside the action in the palette" (`14`) as-is — every palette action row renders its shortcut from the table above as `<kbd>` on the right.

### 2.5 Unified search — ⌘K search mode (Phase B)

Master §3 "core interactions": "⌘K command palette (agent actions + unified search: items full-text search + memories kNN, Phase B)". This is the mode that category 6 ("Search") in §2.3 opens — not a separate screen or a separate shortcut: when the string typed into the ⌘K palette matches no registered action name (cmdk's default filtering behavior), the palette **switches from the action list to a search results list**.

**The one and only data source is A4 §14 `GET /search`** (99-review-v2 §4-5). The client never calls `items.search_tsv`, the trigram indexes or the `search_memory` tool directly — `search_tsv` is excluded from Zero replication in A3 §7 (as are `memories`/`entities`), because a client cannot substitute local queries for Postgres-only columns and kNN. A4 §14 runs four queries server-side in parallel (items tsvector FTS with an `items_body_trgm_idx` fallback / threads aggregation / persons `persons_name_trgm_idx` / memories kNN, index names exactly as in the A3 §7·§12 DDL), finishes within-group normalization and group-weight merged ranking, and returns a single `SearchResponse` — A5 only renders that response as-is.

```ts
GET /search?q=<string>&k=<int>&scope=<work|personal|all>&since=<iso8601>  // A4 §14.1, hub 127.0.0.1:8787, a common path for Mac and iPhone via Tailscale Serve
```

**Result groups** (A4 §14.4 `SearchResponse.groups` — fixed order `people → threads → items → memories`, at most 5 per group, and only groups whose `total` exceeds 5 are `truncated` with a "see N more"):
1. **People** — `SearchHit.kind='person'`. Selecting navigates to that PersonCard detail in Network via `deep_link.person_id`.
2. **Threads** — `kind='thread'`. Selecting navigates to that Thread via `deep_link.thread_id`.
3. **Items** — `kind='item'`. Shows `snippet` (≤160 chars, A4 `ts_headline` or truncation) as-is; selecting scrolls to the Thread via `deep_link.item_id`.
4. **Memories** — `kind='memory'`. `snippet` + a `source_kind` (inbox/calendar/file/drive/github/self) badge; if `deep_link` exists it goes to that Item/thread, if `null` (a memory with no source Item — self-model, etc.) only the snippet is shown and the click is disabled.

Each row renders `SearchHit`'s `title`/`snippet`/`at`/`channel` as-is (A4 §14.4 schema, no extra processing in A5).

**Keyboard navigation**: uses the palette's own standard behavior — `↑`/`↓` move between results across groups (focus flows naturally from a group boundary to the first item of the next group), `Enter` opens the selected item, `Esc` closes the palette (to get back to the action list, clear the input — there is no separate "back" key). `j`/`k` are not used here (inside the palette cmdk's arrow-key convention applies, a different context from the List pane's `j`/`k`).

**Empty state**: "No results for {query}" — shown once, centered in the palette with no group headers (when all of `SearchResponse.groups` is empty).

**Loading/slow state**: the four queries run in parallel server-side (A4 §14.2), but the response arrives at once as a single `SearchResponse` — items/threads/people/memories are not streamed group by group. If `took_ms` exceeds the targets below, a spinner stays at the bottom of the palette and the previous query's results (if any) remain until they are replaced by the new ones.

**Latency and debounce targets** (A4 §14.5, **S-A4-7 — UNVERIFIED**, no basis in `research/`, to be settled by re-measuring at 10k `memories` rows): **180ms** debounce after input, p95 targets items/threads/people **≤ 400ms**, memories (including embedding) **≤ 1.2s**. If missed, A4 lowers the per-group cap from 5 to 3 (A5 simply renders whatever cap applies; there is no client logic change).

---

## 3. Per-screen specifications

Common notation: **data binding** is written as pseudocode for Zero client queries (the exact Zero query builder syntax is settled against the official Zero docs in A3 / implementation spikes — here we only state which tables and fields each screen consumes). Table names follow master §6's data model exactly.

### 3.1 Inbox

**Purpose**: triage 8 channels + agent sessions in a single stream. The screen where omnis's core value proposition is proven.

```
┌ Sidebar ┬──────────────────────────┬───────────────────────────┐
│ All  Work Personal Agents Needs△(4)│  ThreadView / DraftCard     │
├──────────┼──────────────────────────┼───────────────────────────┤
│          │ ⬤ Sora Kim      · 09:14 │                            │
│          │  "Could you check the deck?" [G]│ (selected row detail) │
│          │ ○ Codex · adapter-slack ·10│                            │
│          │  "3 adapter tests failed" [◆]│                            │
│          │ ⬤ David Park    · yesterday │                            │
│          │  "Are you free Monday?" [S]│                            │
└──────────┴──────────────────────────┴───────────────────────────┘
[G]=Gmail [S]=Slack [◆]=Agent  ⬤=selectable ○=selected (card + shadow)
```

**Components**: `InboxRow` (×N, react-virtuoso), filter pill bar (located in the sidebar, §2.1), a bulk action bar at the top on multi-select (Archive/Label/Delegate appear).

**InboxRow spec** (kinso measured `23` + agentic-inbox tone badges `22` combined):
- Left: avatar (circular 32px, people) or runtime icon (squircle 32px when it is an agent_session)
- Middle: row 1 = name/subject (590 weight) + timestamp (right, `--text-secondary`, `--text-xs`); row 2 left = body preview (`--text-secondary`, ellipsis, truncated leaving room on the right for the label chips) or, when status is `draft`, "Draft: {first part of body}" in `--accent`; row 2 right = **label chips** (spec below)
- Right: channel/runtime brand icon (fixed 20px slot, A5-D6), with a dashed circular unread indicator on top of it when unread (adopting `23`'s dashed circle as-is — a differentiator instead of a solid dot)
- Selected state: separated as a card with background `--bg-elevated` + `--shadow-row-selected`, no hairline divider (kinso pattern). Unselected rows manage density with only `--space-3` vertical padding on `--bg-base`
- Threads with `pending_approvals` get a small amber dot badge at the right end of the row (overlaid at the icon's top-left so it does not collide with the brand icon)

**Label chip spec (master §3 "labels are 2 chips + `+N` on the right of InboxRow row 2", reflecting 99-review §4 item 12)**: of the `thread_labels` attached to the thread (master §6, A3 `labels.kind IN ('scope','topic','priority','person')`), at most 2 are shown as chips on the right of row 2 and the rest collapse into a single `+N`.
- **Selection priority**: ① a `kind='scope'` chip (work/personal), if present, is always first — it tells you the thread's nature soonest. ② the remaining slot goes to whichever of the `topic`/`person`/`priority` labels has the highest `item_labels.confidence` (or `thread_labels.confidence`). ③ all other labels are shown only as a count `+N` (N = total labels − 2), opening the full list in a popover on click.
- **Color**: when `labels.color` (A3 `labels` table column) exists, the chip background lifts that value onto `--bg-elevated` at 12% opacity and only the text is emphasized in that hue; when `color` is absent it falls back to a neutral `--gray-700`/`--text-secondary` chip. **Channel brand colors (Slack purple, Gmail red, etc.) are never used on label chips** — sharing a color grammar with the right-hand channel icon slot would create the misreading that "this label belongs to this channel" (the same rationale as the §1.1 channel identity rule).
- **Truncation**: chip text is `--text-xs`, ellipsized at a max width of 96px (`--space-16`); the chip itself is `--radius-full` (pill — one of the exceptions where pills are allowed alongside the search/command inputs; the §9 QA checklist's "no pill abuse" targets buttons/inputs, and status chips are outside its scope). `+N` is not a separate chip but `--text-tertiary` text next to the last chip.
- **Accessibility**: each chip has `aria-label="{kind} label: {name}"`, and `+N` has `aria-label="See {N} more labels"`.

**States**:
- Loading: 8 skeleton rows (react-virtuoso `placeholderComponent`), only the avatar/text placeholders pulse in `--bg-elevated`
- Empty: "Your inbox is empty" + the subtext "Connected channels: 8 healthy" (§8 microcopy)
- Error: when a specific channel adapter fails, an inline banner at the top of the list ("Slack disconnected — Reconnect"); the list itself keeps rendering with the remaining channels' data (a partial failure does not block everything)
- Offline: a pinned banner at the top ("Offline — last synced 3m ago"); you can keep working against cached Zero local data, but new actions (approve/send) are queued and flushed on reconnect

**Data binding** (pseudocode):
```ts
// items ⋈ threads; only the where clause changes with the selected filter pill
zero.query('items')
  .where('thread.archived_at', 'IS', null)
  .where(filter === 'work' ? ['thread.labels', 'CONTAINS', 'scope:work'] : undefined)
  .where(filter === 'needs-approval' ? ['thread.pending_approvals.state', '=', 'pending'] : undefined)
  .orderBy('sent_at', 'desc')
  .related('thread', t => t.related('participants'))
  .related('author')
  .limit(50) // react-virtuoso requests the next page as you scroll near
```

**Interactions**: `j/k` to move, `Enter` to open (rendering ThreadView/AgentSession in the right pane), `e/r/a/s/l/t` for immediate single-row actions (icon buttons also appear on the right on mouse hover), `x` for multi-select followed by bulk archive/label.

**Accessibility**: the list is `role="listbox"`, rows are `role="option"` + `aria-selected`, the channel icon has `aria-label="Slack message"` (not a decorative icon; it conveys information), and the dashed unread indicator is accompanied by a separate `aria-label="Unread"` text (never conveyed by color/shape alone). The keyboard focus ring is a 2px `--accent` outline with `outline-offset: -1px`.

### 3.2 Thread

**Purpose**: the full context of a human conversation (DM/group/email) + reviewing a context-based draft.

```
┌ Thread header (glass toolbar) ──────────────────────┐
│ ← Sora Kim (Slack)              [Archive][Label][⋯] │
├───────────────────────────────────────────────────────┤
│  09:02  Sora: Sharing the draft deck for the meeting  │
│  09:14  Sora: Please take a look!                      │
│                                                          │
│ ┌ DraftCard ────────────────────────────────────────┐ │
│ │ omnis draft · sources: PROJECTS.md #davich, 2 past threads │ │
│ │ "Got it, thanks — I'll leave comments tomorrow morning..." │ │
│ │            [Edit & send]  [Discard]  [Regenerate]  │ │
│ └───────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────┘
```

**Components**: `ThreadHeader` (participants, channel, action buttons), message list (react-virtuoso, paginates on upward scroll), `DraftCard` (only when an Item with status `draft` exists), `Composer` (typing a reply directly, Tiptap).

**DraftCard spec** (A5-D9, ported from agentic-inbox `22`): the draft is always shown **in full** (summaries forbidden — a summary is unsuitable for judging before approval). The top of the card states the sources (one line on which memories/past threads were referenced, reverse-referencing `memories.source_item_id`). Three buttons: **Edit & send** (the Composer opens with the draft content; the human may edit it or just press through → an explicit Send button must be pressed to actually create the `pending_approvals(action='send')` → on approval it is sent; this ports agentic-inbox's "create draft row → Edit & send button → human edit (optional) → explicit Send → sent row" state machine as-is), **Discard** (sets the draft item to `archived`), **Regenerate** (requests regeneration from the same context; the new draft replaces the old one).

**States**: loading (3 message skeletons), empty (new thread — "No messages yet", only the Composer active), error (on draft generation failure the card slot shows "Draft generation failed — Retry" plus a retry button; it never silently disappears), offline (the Composer saves locally and queues the send for reconnect), auto-archived (when `threads.archived_at` is within 7 days, an "Auto-archived · {N} days ago — Restore" banner below the header, see §3.8 — the same undo behavior as Digest).

**Data binding**:
```ts
zero.query('items').where('thread_id', '=', threadId).orderBy('sent_at', 'asc').related('author')
zero.query('items').where('thread_id', '=', threadId).where('status', '=', 'draft') // DraftCard
zero.query('pending_approvals').where('payload.item_id', '=', draftItemId) // check approval state
```

**Interactions**: `r` opens draft editing (if none exists, immediately request `propose_draft` and reserve the card slot in a loading state), `⌘Enter` sends from the Composer (= confirms approval), and if the channel is read-only (e.g. LinkedIn writes not yet approved) the Composer itself is disabled with a "this channel sends after approval" notice.

**Accessibility**: the message list is `role="log"` (live-added content), and new messages notify screen readers only via `aria-live="polite"` (no assertive interruption on every message). DraftCard buttons have clear text labels (icon-only forbidden).

### 3.3 Agent Session

**Purpose**: show Claude Code/Codex/claude-ds/Hermes/omnis agent sessions in the same grammar as a Thread, but with tool calls made human-readable.

```
┌ Agent Session header ────────────────────────────────┐
│ ← Codex · adapter-slack (macbook)      [Read session] │
├─────────────────────────────────────────────────────────┤
│ Turn 1 (agent):  "Confirmed 3 Slack adapter test        │
│                    failures, investigating the cause"    │
│  ⚙ Reading · adapter/slack/*.test.ts        ✓ done       │
│  ⚙ Searching memory · "slack rate limit"    ✓ done       │
│ Turn 2 (agent):  "Cause: 429 rate limit; proposing retry logic" │
│  ⚙ Proposing delegation                      ⏳ in progress │
│                                                            │
│ ┌ ApprovalSheet(inline) ───────────────────────────────┐ │
│ │ propose_delegation → delegate "retry logic patch" to Codex │ │
│ │              [Accept] [Edit] [Ignore]                 │ │
│ └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

**Components**: `AgentTurn` (×N, agent/system utterances), `ToolCallBadge` (×N, each tool call), inline `ApprovalSheet` (when the pending_approvals originate from this session).

**Hermes session badge (master Q7)**: when `agent_sessions.runtime_id` is the Hermes runtime and it is still before Phase C (admission as a delegation target), a gray `Badge` reading "Read only" is shown next to the runtime icon in the session header (Phase B only exposes read-only sessions; the "Delegate to Hermes…" action in §2.3 activates from Phase C). For sessions carrying the badge, the `d` (delegate) shortcut and the ApprovalSheet's delegation entry point render disabled. On the switch to Phase C the badge disappears and the session behaves like any other runtime session.

**ToolCallBadge / TOOL_LABELS pattern** (A5-D11, ported from agentic-inbox `22`): agentic-inbox's `TOOL_LABELS` record (tool name → `{label, icon}`) and its `state` pattern (per AI SDK `UIMessage` part: `output-available`/`result`/`output-error` = done, anything else = loading) are ported as-is onto omnis's agent tool list (master §11):

```ts
const TOOL_LABELS: Record<string, { label: string; icon: LucideIcon }> = {
  read:               { label: 'Reading',                icon: Eye },
  search_memory:      { label: 'Searching memory',       icon: Search },
  read_calendar:      { label: 'Checking calendar',      icon: Calendar },
  read_session:       { label: 'Checking other sessions', icon: MessagesSquare },
  propose_draft:      { label: 'Writing reply draft',    icon: PenLine },
  propose_task:       { label: 'Extracting tasks',       icon: ListChecks },
  propose_delegation: { label: 'Proposing delegation',   icon: Share2 },
  propose_route:      { label: 'Proposing note routing', icon: Route },
};
// state: 'loading' → spinner, 'done' → label + ✓ + 1-line result summary, 'error' → label + ⚠ + retry
```

When a `propose_*` tool completes, the badge transitions into a `pending_approvals` card (not a separate component — it expands in the same badge slot). Because `send`/`delete`/`delegate`/`calendar_write` are absent from the agent tool palette (master §11 principle), they **never appear on this screen as a badge the agent invoked directly** — only the result the system executed after approval is logged as a single line in a separate system Item (kind `system`) (e.g. "✓ Delegated to Codex · 09:41"). This distinction (agent proposal badge vs system execution log) is a §9 QA checklist item.

**"Read session" button**: expands another agent session's durable summary in an inline panel (the UI expression of master §9 `read_session(session_key)`) — not a raw token log, only the summary + the last N turns.

**States**: loading (connecting the session — a "Connecting to Codex…" spinner), empty (new session, waiting for the first turn), error (bridge connection failure — "Cannot reach local-agent on macbook, check Tailscale" + a reconnect button), offline (the session runs on another device, so only the last state is shown from local cache, with a "not live" badge).

**Data binding**:
```ts
zero.query('items').where('thread_id', '=', sessionThreadId).where('kind', 'IN', ['agent_turn', 'tool_call', 'system']).orderBy('sent_at', 'asc')
zero.query('agent_sessions').where('id', '=', sessionId) // state, capabilities, host
```

**Interactions**: `d` opens the follow-up delegate request palette for this session; the ApprovalSheet keymap reuses the §3.9 common rules (A5-D10).

**Accessibility**: the tool badge's spinner is `aria-busy="true"`, and on completion only the 1-line result is announced via `aria-live="polite"` (individual streaming tokens are not announced — ephemeral events are not exposed to screen readers either, matching master §7's 3 event tiers).

### 3.4 Today

**Purpose**: the morning briefing + today's schedule + pending approvals on one screen.

```
┌ Today ─────────────────────────────────────────────────┐
│ Good morning, Logan. 12 items to handle today, 4 pending│
│ approvals.                                              │
│                                                            │
│ 🌙 Night digest ready · 42 archived          [View →]    │  ← Digest entry card (only when present)
│                                                            │
│ ⏰ Today's schedule (Google Calendar)                    │
│   10:00  Davich PoC review                                │
│   15:00  1:1 with the CEO                                 │
│                                                            │
│ 📋 Morning briefing (overnight items, by importance)      │
│   1. [Gmail] Contract signature request — due today        │
│   2. [Slack] 3 new messages in #davich                     │
│   3. [Agent] Codex adapter tests completed · needs review  │
│                                                            │
│ ⏳ Pending approvals (4)                                   │
│   [Gmail reply]  [Codex delegation]  [Calendar event]  [Message] │
└────────────────────────────────────────────────────────┘
```

**Components**: `DigestCard` (for today, kind='morning'), the **night digest entry card** (shown only when the most recent kind='nightly' digest exists — one of the two paths to the Digest screen on iPhone, the other being §4.4's Web Push "night digest ready"; on macOS this card is replaced by the sidebar/⌘K/`g d`), calendar event list (same day only, Google Calendar integration), pending-approval chip strip (expands an inline `ApprovalSheet` on click).

**Data binding**:
```ts
zero.query('digests').where('kind', '=', 'morning').where('for_date', '=', today).one()
zero.query('digests').where('kind', '=', 'nightly').orderBy('for_date', 'desc').limit(1) // for the entry card
zero.query('items').where('kind', '=', 'event').where('sent_at', 'BETWEEN', [todayStart, todayEnd])
zero.query('pending_approvals').where('state', '=', 'pending').orderBy('created_at', 'asc')
```

**States**: loading (before the briefing is generated — if the nightly batch job has not run yet, a "Preparing your briefing, refreshes in N minutes" placeholder), empty (no schedule/approvals today — "Quiet day today"), error (briefing generation failed — the calendar/approval sections keep rendering independently and only the briefing section gets a retry button), offline (the last cached briefing + an "as of N hours ago" badge).

**Interactions**: clicking a briefing item deep-links to its Thread; clicking an approval chip expands it in place (no separate screen navigation — keeping "handle it right from the briefing" frictionless for the briefing-coverage metric); clicking `[View →]` on the night digest card navigates to the Digest screen (§3.8) (on iPhone this card plus the single Web Push are the only entry points; it is not in the tab bar — §4.1).

**Accessibility**: the greeting/summary text is an `<h1>` so screen readers read the page's gist immediately; an approval chip has `aria-label="Pending approval: Gmail reply, requested 2026-09-20 09:00"`.

### 3.5 Tasks

**Purpose**: a todo list used together with the agent. The source (which message it came from) is always visible.

```
┌ Tasks ─────────────────────────────────────────────────┐
│  [Today] [This week] [Someday] [Delegated]               │
│                                                            │
│  ☐ Review Davich PPT draft       from: Gmail · due today  │
│  ☐ Sign the contract             from: Gmail · today      │
│  ◐ Fix adapter tests (Codex)     delegated · in progress  │
│  ☑ Reply to Sora                 from: Slack · done       │
└────────────────────────────────────────────────────────┘
```

**Components**: 4 view tabs (Today/This week/Someday/Delegated — based on `tasks.due_at`, with only `tasks.owner_kind = 'agent'` items under Delegated; the A3 `tasks_owner_ck` values are `'me'|'agent'`), `TaskRow` (checkbox + title + source link + status icon + a distinguishing icon per `tasks.kind` (`todo`/`followup`/`delegation`, A3)).

**Data binding**:
```ts
zero.query('tasks').where('state', '!=', 'done').where(view === 'delegated' ? ['owner_kind', '=', 'agent'] : ['due_at', 'BETWEEN', viewRange])
  .related('source_item') // deep-link to the source message
```

**States**: loading (skeleton rows), empty (different copy per view — "Nothing due today" etc., §8), error (a task-extraction pipeline failure can be silently ignored, but a delegation status polling failure shows a "status unavailable" warning on the `TaskRow`), offline (checkbox toggles apply locally immediately and are queued).

**Interactions**: clicking the checkbox = `state: done` (optimistic update), `t` opens quick task-add input (title only, the rest later), clicking a Delegated row navigates to that Agent Session.

**Accessibility**: the checkbox is a native `<input type="checkbox">` (not custom — native is safest for screen reader/keyboard compatibility); the completion strikethrough is reflected in both `text-decoration` and `aria-checked`.

### 3.6 Network

**Purpose**: a personal CRM. Person cards + a follow-up queue. Dex (`17`) is the primary reference, minus team features (single-user).

```
┌ Network ───────────────────────────────────────────────┐
│  [Follow-up queue (3)]     🔍 Search                      │
│                                                            │
│ ┌ PersonCard ──────────┐ ┌ PersonCard ──────────┐        │
│ │ 🟢 David Park          │ │ ⚪ Sora Kim            │        │
│ │ Davich · CTO           │ │ Ownered Lab · PM       │        │
│ │ Last contact: 3 days   │ │ Last contact: today    │        │
│ │ Follow-up suggestion:  │ │                        │        │
│ │  "5 days of silence    │ │                        │        │
│ │   since PoC results"   │ │                        │        │
│ │        [Edit & send]   │ │                        │        │
│ └────────────────────────┘ └────────────────────────┘        │
└────────────────────────────────────────────────────────┘
```

**Components**: `PersonCard` (people grid/list toggle), follow-up queue top strip (folk Follow-up Assistant pattern `17` — inactive-conversation detection + tone-matched draft), person detail view (on click, in the right pane: interaction timeline + links to conversations across all channels + notes).

**PersonCard spec**: avatar/initials, name, affiliation and title (`entities` link), relationship state dot (of the full `persons.relationship_state` values `unknown/new/warming/active/dormant/closed` (master §6), the card exposes 3 levels — 🟢 `active` / 🟡 `new`·`warming` (relationship forming) / ⚪ `dormant`·`closed` (at risk of going cold); `unknown` shows no dot, just the text "not enough info"), and when a follow-up suggestion exists, a miniature `DraftCard` at the bottom of the card (the same "Edit & send" gate).

**Data binding**:
```ts
zero.query('persons').orderBy('last_contact_at', 'desc').related('identities')
// Follow-up queue: threads.person_id does not exist in the master schema (only participants[]) — we join
// backwards via persons.primary_thread_id, added in A3 v0.95 (persons → primaryThread → that thread's draft item), 99-review-v2 §2-4
zero.query('persons')
  .where('id', 'IN', followUpCandidateIds)
  .related('primaryThread', t => t
    .related('items', i => i.where('status', '=', 'draft').orderBy('sent_at', 'desc').limit(1))
  )
```

**States**: loading (card skeleton grid), empty ("No contacts yet — they fill in automatically from your inbox"), error (a follow-up suggestion generation failure is silently omitted from the card; the person data itself renders normally), offline (last cache).

**Interactions**: card click → detail in the right pane; the follow-up draft uses the same button set as Thread's DraftCard (Edit & send/Discard/Regenerate).

**Accessibility**: the card grid is `role="grid"`, or `role="list"` when toggled to list; the relationship state dot is accompanied by a text label, not color alone ("active" / "5 days cold", etc.).

### 3.7 Notes

**Purpose**: one-line note entry → routing suggestion (the UI for master §11's note routing loop). There is no commercial precedent for this feature (`17`), so the UI is kept as simple and as easily reversible as possible.

```
┌ Notes ─────────────────────────────────────────────────┐
│ ┌ New note ─────────────────────────────────────────┐   │
│ │ Give David a heads-up that the PoC needs 3 more...  │   │
│ │                                          [Save]     │   │
│ └──────────────────────────────────────────────────────┘   │
│                                                            │
│  Routing suggestion: share to David Park's thread (high confidence) │
│              [Accept]  [Choose another target]  [Don't route]       │
│                                                            │
│  Recent notes                                              │
│   "Notes on the Davich contract draft..."  → Network:David │
│   "Retro ideas for next week"              → not routed    │
└────────────────────────────────────────────────────────┘
```

**Components**: note input (single line, Enter to save, or expand to multiple lines), `RoutingSuggestion` (confidence indicator + 3 buttons), recent notes list (showing routing results).

**Design principles, since there is no commercial precedent (`17` §4)**: when confidence is low, no automatic suggestion is made at all — only "Couldn't find a match — pick manually" is shown. Automatic routing (attaching without approval) is not done — `notes.routed_to` is only settled when a human presses "Accept" (propose_route, like the other propose_* tools, is non-irreversible / proposal-only).

**Data binding**:
```ts
zero.query('notes').orderBy('created_at', 'desc').limit(20)
// the routing suggestion polls/subscribes to the propose_route result right after the notes insert
```

**States**: loading (computing the routing suggestion right after save — the spinner appears only if it takes 200ms or more; below that, the result shows immediately), empty ("No notes yet"), error (a routing suggestion failure converges to "Couldn't find a match" — the user is not shown a distinction between error and no-match; failure is also a safe default state), offline (note saving is local-first, routing suggestions after reconnect).

**Interactions**: the global `n` shortcut focuses note input from anywhere (matching master §12's core interactions); after saving, the input clears automatically and keeps focus (so you can keep typing).

**Accessibility**: the routing suggestion's confidence is expressed in text ("high confidence"/"low confidence"); percentages are excluded as numbers that mean nothing to the user.

### 3.8 Digest

**Purpose**: the nightly archive digest (generated daily at 23:00 KST; the morning briefing at 06:30 KST — the schedule owner is A4 §6, master §14) — check what was auto-archived that day for anything worth revisiting, and restore it.

```
┌ Digest ────────────────────────────────────────────────┐
│  September 19 night digest · 42 archived                  │
│                                                            │
│  📧 Email (31)                                             │
│   12 newsletters, 8 notifications, 11 receipts — [View all] │
│  💬 Messages (11)                                          │
│   Slack #random 8, WhatsApp groups 3                       │
│                                                            │
│  This month's cost report: $34 / $60 (57%)                 │
└────────────────────────────────────────────────────────┘
```

**Components**: `DigestCard` (kind='nightly'), collapsed groups per category (click expands the individual item list), a "Restore" button on each item (sets archived_at to null), monthly cost report section (the UI exposure point of master §14's cost policy).

**Data binding**:
```ts
zero.query('digests').where('kind', '=', 'nightly').orderBy('for_date', 'desc').limit(1)
zero.query('items').where('id', 'IN', digest.items) // fetch individually only when expanded
```

**States**: loading ("Tonight's digest isn't generated yet; it's created at 23:00"), empty (a day with nothing archived — "Nothing to archive today"), error (digest batch job failure — a "Digest generation failed, retry manually" button that re-runs the cron job), offline (the last cached digest).

**Restore affordance in Thread**: when `threads.archived_at` is set and within 7 days (§6.4 undo window, master §11), the Thread header (§3.2) shows an inline "Auto-archived · {N} days ago — Restore" banner (a top-pinned bar in the same tone as the offline banner). Clicking "Restore" does the same thing as restoring in Digest (sets `archived_at` to null, toasts "Restored · Undo"). After 7 days the banner is gone and the archived state simply persists (still reachable via search).

**Interactions**: clicking a category header = accordion toggle; an individual item's "Restore" = immediate return to Inbox (optimistic update + a "Restored, undo" toast).

**Accessibility**: the accordion uses `aria-expanded`; the toast after a restore action is `role="status"`.

### 3.9 Settings

**Purpose**: account connections, autonomy allow rules, model tiers, kill switch — every user-facing setting from master §12/§14/§19.

```
┌ Settings ──────────────────────────────────────────────┐
│  Accounts        Autonomy       Model tiers    General   │  ← left sub-nav
│ ─────────────────────────────────────────────────────── │
│  Accounts                                                 │
│   Slack        ● connected      [Reconnect]               │
│   Gmail        ● connected      [Reconnect]               │
│   KakaoTalk    ● read only      [Enable send (D-9)]  ⓘ     │
│   ...                                                      │
│                                                            │
│  ⚠ Kill switch                    [Stop all autonomy]     │
└────────────────────────────────────────────────────────┘
```

**Components**: 4 left sub-nav items (Accounts/Autonomy/Model tiers/General); each section uses a standard form layout (shadcn Form). The **Autonomy** section holds per-channel/per-person "autonomy allowed" toggles (overriding master §7's approval gate defaults) — all off by default (approval required); turning one on requires a warning dialog ("Actions to this channel/person will send automatically without approval. Continue?"). **Model tiers** shows the current monthly usage gauge + cost cap input (spec below) + sensitivity rules display (read-only; master D9/§14 are not open for re-discussion, so these are not toggles here). The kill switch is the same button in both Settings and the macOS menu bar tray (master §7).

**Cost cap (master §14, A4 §10.4, reflecting 99-review §1.2 "A5 §3.9 cost cap read-only ↔ A4 §10.4 change it in Settings → A5")**: the monthly cap is **not read-only but an editable numeric input** (default $60). The Model tiers section shows three things together — ① current month's spend (e.g. "$34 used"), ② a progress bar below it (full width = the cap, filled width = spend, with the last 10% rendered as a visually distinct segment marking the "VIP/sensitive reserve"), ③ a numeric cap input field (a "Save" button on change, applied immediately). The 10% reserve is not editable (a computed value subordinate to the cap) and is shown beside the input only as fixed text labeled "VIP/sensitive thread reserve". The 80%/100% thresholds are distinguished by progress bar color too (normal `--accent`, 80%↑ `--warn-500`, 100%↑ `--danger-500`) — and not by color alone: the text above the bar also reads "normal"/"T2→T1 demotion"/"non-VIP drafts paused" (§9 accessibility rules).

**KakaoTalk send gating (master §3/§19 Q3, 99-review §4 item 13)**: until KakaoTalk's read connection has stably completed 14 days, the `[Enable send]` button is **disabled**, and its label shows the remaining days as "Enable send (D-{N})". Hovering the button (or tapping it on mobile) raises the tooltip "read stable {14-N}/14 days · activates in {N} days". The same remaining-days information is also stated on the Accounts row itself (the same text as the `ⓘ` icon's hover/tap in the mockup above) so it still gets through in situations where the tooltip cannot be seen (screen readers, failed touch long-press). Once 14 days are complete the button becomes enabled and its label becomes "Enable send"; pressing it does not send anything immediately, and every subsequent KakaoTalk send still goes through `ApprovalSheet` approval (this button switches on the adapter's send capability; it does not bypass the approval gate).

**States**: loading (spinner while each account status polls), empty (not applicable — the 8 channels are always listed), error (inline error + retry on reconnect failure), offline (account status from the last cache with a "not live" badge; toggle changes apply after reconnect).

**Interactions**: the kill switch is a 2-step confirmation (button click → a "Stop all autonomous loops?" confirmation dialog → execute); undoing it is 1 click.

**Accessibility**: toggles use the native role (`role="switch"` + `aria-checked`); dangerous settings (autonomy allowed, kill switch) express risk with icon + text rather than color alone (§9 color-blindness handling).

---

## 4. iPhone (PWA) layout

Phase B is an installed PWA (master D8, the Q1 default). The goal is "one-handed triage" — the master principle of handing long edits back to the Mac (§12) is enforced by the layout itself.

### 4.1 Layout

```
┌ iPhone ──────────┐
│ Inbox         ⌘K │  ← top bar (current tab title + search); the ⚙ at top left is common to all screens
├────────────────────┤
│ ⬤ Sora   · 09:14 [G]│  ← single-column list, swipe zone
│   "Could you check..." │
│ ○ Codex  · 10:02 [◆]│
├────────────────────┤
│ 📥  🏠  ✓  👤  📝 │  ← bottom tab bar (5): Inbox/Today/Tasks/Network/Notes
└────────────────────┘
```

The bottom tab bar is **fixed at 5: Inbox·Today·Tasks·Network·Notes** (master §3 "core interactions", 99-review §4 item 11 "keep the tab bar at 5 slots"). Inbox is the tab shown first when the app opens (the most frequently used screen). **Digest is not in the tab bar** — the paths to Digest on iPhone are deliberately limited to §3.4's Today top card and the single Web Push in §4.4 (macOS has three entry points — sidebar + `g d` + ⌘K — but on the phone the night digest is not a "first-class screen you must check daily" but one "you open if it's there", so it does not get a tab). Settings is also out of the tab bar and moves to the ⚙ icon at the top left of the top bar (shown on every tab) — no tab slot is spent on the least-used screen during triage.

### 4.2 Swipe actions

Left/right swipe on a list row (an extension of the standard Superhuman/Gmail practice):
- **Swipe right** (partial) = Archive (same as `e`); all the way = execute immediately
- **Swipe left** (partial) = reveal the action menu (3 icons: Snooze/Label/Delegate); all the way = the default action (Snooze)
- For pending-approval items, a tap instead of a swipe opens the `ApprovalSheet` as a bottom sheet right away (on mobile, approval is an explicit tap + confirm rather than a swipe — mistake prevention)

### 4.3 Approval, snooze, short replies, note entry

- **Approval**: bottom sheet (`ApprovalSheet`, the same component as on the Mac, differing only in responsive layout), full text shown + Accept/Edit/Ignore buttons (the same 4-way config as desktop, but `respond` is deprioritized on mobile because the text input is small — only the button order puts Accept first)
- **Snooze**: a bottom sheet with 4 presets (in 1 hour / this evening / tomorrow / next week); custom times are reduced to a single hidden "Choose a time" (exposing a full date picker on mobile wastes screen space)
- **Short replies**: DraftCard's "Edit & send" switches to a full-screen Composer on mobile (Tiptap mobile-optimized, text only without formatting — table/image insertion is replaced with an "edit on Mac" notice). Short boilerplate replies ("Got it", "I'll get back to you shortly") can be sent with one tap from 3 quick-reply chips under the draft card (still passing through the approval sheet before sending)
- **Note entry**: the Notes tab in the bottom tab bar → the text input is focused automatically on entry (the same screen as §3.7 on the Mac, with the input at the very top for fast capture); on save, the routing suggestion appears inline at the bottom of the same screen, not on a next screen

### 4.4 Web Push

Phase B is Web Push only (APNs is the v2 native shell, `13`). **There is 1 kind of Digest entry push** (just "night digest ready" — limited by master §12, 99-review-v2 §4-1), but **draft notifications apply A4 §3.6's three tiers to the phone as well** (the notification policy owner is A4 §3.6; A5 only handles the rendering). The bottom tab bar stays at the same 5 — Inbox/Today/Tasks/Network/Notes — as in §4.1; the three draft notification tiers are a refinement of existing push kinds, not a new tab.

**Immediate draft push card** (A4 §3.6 "immediate push"): sent only when `priority='now'` AND (`vip` OR my name is mentioned in the thread OR it is a meeting counterpart within 2 hours on the calendar). The body is the first **80-character preview** of the draft (not the full text — A4 §3.6 privacy principle, never exposing full text on the lock screen). The action buttons are the 2 A4 §3.6 defines — **Approve / Open** (Web Notification actions, max 2): **Approve** accepts `pending_approvals(action='send')` in place and sends immediately without opening the app; **Open** opens the app and deep-links to that `DraftCard` (§6 `omnis://thread/{id}` scheme). Tapping the card body (the part that is not an action button) behaves the same as Open — matching §4.2's principle that "a pending-approval item opens on tap".

**Batched draft push** (A4 §3.6 "batched"): drafts with `priority='today'` are not pushed individually but collected at 3-hour intervals (09/12/15/18 KST) into a single "Drafts ready: {N}" notification. Tapping navigates to Inbox rather than a specific thread (you find out which thread in the inbox).

**Silent** (A4 §3.6 "silent"): other lower-priority drafts get no push — they only show up in the inbox badge and the morning briefing.

**Global quiet hours** (A4 §3.6): between 23:00 and 07:00 KST, immediate pushes are also demoted to batched and go out once together with the 07:00 morning briefing. The only exception is `vip` AND `priority='now'`, which Settings can turn off — the same policy as on the Mac; A5 adds no separate rules.

Other notification kinds:

| Kind | Trigger | Copy pattern |
|---|---|---|
| Pending approval (non-draft — delete/delegate/calendar_write, etc.) | a new `pending_approvals` is created | "{action} needs your approval · {target summary}" |
| VIP message | an item with label `priority:vip` arrives | "You have a message from {name}" |
| Morning briefing ready | `digests(kind=morning)` generation completed | "Your briefing is ready · N items" |
| Night digest ready | `digests(kind=nightly)` generation completed (just after 23:00 KST) | "Night digest ready · {N} archived" — tapping goes straight to the Digest screen without passing through the Today top card |
| Follow-up reminder | a new Network follow-up queue entry | "No contact with {name} for {N} days" |
| Channel disconnected | adapter `health()` failure | "{channel} disconnected, please check" |

Because Web Push has limited background reliability on iOS (`13`), the Mac mini's ntfy redundancy applies only to the macOS app (master §15) and iPhone starts with Web Push as a single path — repeated missed deliveries are recorded as evidence for switching to native in v2.

### 4.5 Install guidance

On first visit, an "Add to Home Screen" prompt banner at the top of Safari (since iOS 26, adding to the home screen defaults to web app mode, so the prompt is needed less than before, but installing a PWA still requires a user action, `13`): a 3-step card (tap the share button → "Add to Home Screen" → done). Web Push permission is requested not right after install but **when the first pending-approval item appears**, in context (never firing a permission prompt at app start for no reason — the standard practice for raising permission acceptance rates).

---

## 5. Component map

### 5.1 shadcn/ui (used as-is)

Button, Input, Textarea, Select, Checkbox, Switch, Dialog, Sheet, Popover, DropdownMenu, Command (wrapping cmdk), Tabs, Badge, Avatar, Tooltip, Separator, ScrollArea, Toast (wrapping Sonner), Form (combined with react-hook-form).

### 5.2 Custom components (9)

| Component | Role | Key dependencies |
|---|---|---|
| `InboxRow` | List row (avatar + name + timestamp + preview + channel icon + unread) | Avatar, own CSS (§3.1) |
| `ThreadView` | Message list + header + Composer container | react-virtuoso, Tiptap |
| `DraftCard` | Full draft + Edit&send/Discard/Regenerate | Card, Button |
| `ApprovalSheet` | Renders the HumanInterrupt 4-way (accept/edit/respond/ignore) | Sheet (Mac) / Sheet as bottom-sheet (mobile) |
| `AgentTurn` | One agent utterance turn + the group of ToolCallBadges belonging to it | — |
| `ToolCallBadge` | Tool progress badge driven by the TOOL_LABELS mapping | Badge, lucide icons |
| `PersonCard` | Network person card (shared by grid and detail) | Avatar, Badge |
| `CommandPalette` | ⌘K global action registration and execution | Command (cmdk) |
| `DigestCard` | Shared morning/nightly digest card (category accordion) | Accordion (shadcn extension) |

### 5.3 Where each library is used

- **react-virtuoso**: the `InboxRow` list (Inbox), the `AgentTurn` list (Agent Session), the `TaskRow` list (Tasks) — every long list needing dynamic heights and group headers. Handles 100k-item scale (`14`).
- **Tiptap**: `ThreadView`'s Composer, `DraftCard`'s Edit-mode editor. AI extensions (slash commands such as "change tone" or "shorten", as future room to grow, `14`) are out of v1 scope, but starting the editor itself on Tiptap lowers the cost of that extension.
- **cmdk (shadcn Command)**: all of `CommandPalette`.

---

## 6. Tauri shell

- **Window**: a single main window, `titleBarStyle: "overlay"` (keeping macOS traffic lights with a custom title bar), minimum size 1024×640, remembering the sidebar's collapsed state (local settings file).
- **Vibrancy**: apply `window-vibrancy`'s `apply_liquid_glass` (macOS 26+) to the sidebar layer first; fall back to `apply_vibrancy(NSVisualEffectMaterial::Sidebar)` on failure; if that also fails, fall back to the CSS `.glass-surface` from §1.5 (handling the instability noted in `14` §7).
- **Tray**: a resident menu bar icon (with the pending-approval count as a badge); clicking shows a mini list of the 3 most recent pending approvals + "Open omnis" + "Kill switch" + "Quit". Closing the window keeps it running in the tray (independent of the Mac mini hub, the MacBook app itself also acts as a bridge daemon, so fully quitting is treated as a deliberate act).
- **Notifications**: native macOS notifications via the Tauri notification plugin (a separate path from Web Push — assuming the Mac app is always running, native notifications are primary and Web Push is conceptually the fallback when the app is not running, symmetric with iPhone).
- **Shortcuts**: exactly one global shortcut is registered at the OS level — `⌘⇧O` (open/focus omnis, even while using another app). Every other shortcut (§2.4) is an in-app keymap that works only while the app is focused (not registered OS-globally — collision prevention with other apps).
- **Deep links**: registers the `omnis://thread/{id}`, `omnis://approval/{id}`, `omnis://person/{id}` schemes. Used to open the app from Web Push/native notification clicks, the digest email (future), etc. and land directly on the relevant screen.

---

## 7. Empty states and onboarding

### 7.1 Account connection flow

```
1. Welcome           "Welcome to omnis"
2. Connect channels   Slack/Gmail/Outlook/Calendar/Telegram (OAuth, skippable in any order)
                       WhatsApp/KakaoTalk/LinkedIn = "requires Mac mini setup" notice card
                       (onboarding does not hide master D12's honest definition either — only 3 channels are required in Phase A)
3. Self-model seed     5 draft USER.md questions (role, tone, priorities) → can start with minimal answers (skipping all is allowed)
4. First sync          "Syncing your messages…" (backfill progress bar, per channel)
5. First briefing      on completion go straight to the Today screen; if the first briefing is still generating, the §3.4 loading state
```

**Phase A requires only 3 channels: Slack/Gmail/Calendar** (matching master §16's Phase A scope) — in onboarding, Outlook/Telegram/WhatsApp/KakaoTalk/LinkedIn can always be skipped via a "Connect later" button and added anytime from Settings > Accounts.

### 7.2 Empty-state gist per screen (detailed copy in §8)

Inbox empty = not celebratory, neutral ("Your inbox is empty"). Tasks empty = branches per view. Network empty = explains auto-fill (making clear this is not a screen where you add people yourself). Notes/Digest empty = plain.

---

## 8. Microcopy table

The default copy is English; the reference column repeats the exact string used in code / aria-labels (listed only where stating both is worth it).

| Location | Copy (default) | Reference (code/aria-label) |
|---|---|---|
| DraftCard button | Edit & send | Edit & send |
| DraftCard button | Discard | Discard |
| DraftCard button | Regenerate | Regenerate |
| ApprovalSheet button | Accept | Accept |
| ApprovalSheet button | Edit & approve | Edit |
| ApprovalSheet button | Ignore | Ignore |
| ApprovalSheet button | Respond | Respond |
| Inbox empty state | Your inbox is empty | Inbox is empty |
| Inbox error (channel dropped) | {channel} disconnected — Reconnect | {channel} disconnected — Reconnect |
| Tasks empty (Today) | Nothing due today | Nothing due today |
| Tasks empty (Delegated) | No delegated tasks | No delegated tasks |
| Network empty | No contacts yet — they fill in automatically from your inbox | Contacts fill in automatically from your inbox |
| Notes low-confidence routing | Couldn't find a match — pick manually | Couldn't find a match — pick manually |
| Digest restore toast | Restored · Undo | Restored · Undo |
| Offline banner | Offline — last synced {N}m ago | Offline — last synced {N}m ago |
| Kill switch confirmation | Stop all autonomous actions? | Stop all autonomous actions? |
| Autonomy enable warning | Actions to this target send without approval | Actions to this target send without approval |
| Approval notification (Web Push) | {action} needs your approval · {summary} | {action} needs your approval |
| Channel not connected (onboarding) | Requires Mac mini setup | Requires Mac mini setup |
| First sync progress | Syncing your messages… | Syncing your messages… |
| Preparing briefing | Preparing your briefing, refreshes in {N}m | Preparing your briefing, refreshes in {N}m |

---

## 9. Design QA checklist

After implementation, check the following in order for every screen. Most "AI-made UI" tells come from violations of this checklist.

**Color/tokens**
- [ ] Does component CSS use only semantic tokens rather than referencing primitive tokens directly (§1.1)?
- [ ] Is there anywhere channel identity is expressed through list row backgrounds/avatar tints (only the fixed right-hand icon is allowed, §1.1)?
- [ ] Is the accent color free of overuse beyond CTAs, selected states and unread badges (no gradient fills on every button)?
- [ ] Is shadow absent everywhere except the selected list row (`--shadow-row-selected`) (card boundaries are hairlines)?

**Typography/layout**
- [ ] Do font weights stay within the 3 steps 400/510/590 (no 700+ bold)?
- [ ] Is there no arbitrary px value outside the 6-step type scale (12/13/14/16/20/26)?
- [ ] Is the information density at productivity-app level (not padded out with unnecessary large spacing or oversized icons to "look airy")?
- [ ] Is every spacing value on the 8px ladder (4/8/12/16/24/96)?

**Liquid Glass**
- [ ] Is the glass effect absent anywhere other than the 4 places — sidebar/toolbar/sheet/palette (list rows, body text and the editor are always opaque, §1.5)?
- [ ] Does the CSS fallback actually work when vibrancy fails (verified via the feature detect)?

**Motion**
- [ ] Do durations avoid arbitrary values outside the 3 steps 100/160/400ms?
- [ ] Is easing unified into the single `--ease-spring` (mixing several curves is forbidden)?
- [ ] Do animations actually complete instantly under `prefers-reduced-motion`?

**"AI slop" prevention**
- [ ] Are there no purple-blue gradient "AI-feel" backgrounds/buttons (a violation of master D8's single-accent principle)?
- [ ] Are decorative sparkles (✨) or robot emoji icons absent from UI text?
- [ ] Do cards avoid arbitrary per-card corner radii and use only the 4 steps (6/10/16/999)?
- [ ] Are buttons/inputs not all unified to full-radius (pill), using only sm/md by hierarchy (pills are reserved for search/command inputs; no pill abuse on master buttons)?
- [ ] Is there no placeholder text (Lorem ipsum-style) or fake data left in the final screens?
- [ ] Are agent proposals only (propose_*) visually distinguished from things actually executed (system logs) (§3.3)?

**Accessibility**
- [ ] Is there anywhere state is conveyed by color alone (the dashed unread indicator, relationship state dots, etc. always come with text/aria-label)?
- [ ] Is every interactive element keyboard-reachable (no mouse-only hover actions)?
- [ ] Is the focus ring always visible (nowhere wiped out with `outline: none`)?
- [ ] Do icon-only buttons have an `aria-label`?

**Copy and register**
- [ ] Is the register consistent (buttons use imperative single-word forms such as "Approve"/"Send"; guidance copy keeps one consistent polite tone matched to the screen's character — Today/briefing conversational, Settings/system messages declarative)?
- [ ] Do technical terms (Draft, Approve, etc. — the code column of the §8 table) stay confined to code/aria-labels, or do they leak into user-facing copy?

---

## Review notes (2026-09-20)

Fixed inline (notation inconsistencies in §2, §3.3, §3.1, §3.6 — recorded here for the log only, not open for re-discussion):
- A5-D10, §3.3: corrected `delegate.run`/`calendar.write` → `delegate`/`calendar_write` — master §6's `pending_approvals.action` enum and the A3 DDL's actual CHECK constraint (`'send','delete','calendar_write','delegate','self_model_edit','memory_write'`) use this notation, and A5 §2.3 (`action='delegate'`) already used it too, so A5 was inconsistent with itself as well.
- §3.6 data binding: the follow-up queue query was filtering on `items.kind = 'draft'`, but master §6 defines `draft` as an `items.status` value (`items.kind` has no `draft` — only message/email/event/agent_turn/tool_call/system). Corrected to `status`.
- §3.1 InboxRow preview rule: the prefix is `"Draft: {first part of body}"`. An earlier pass had flagged this as a §8/§9 violation (user-facing copy was Korean at the time) and rewrote it in Korean; that correction is **superseded** by the repo-wide English-only rule and by the current §8, whose default copy is English. The English prefix in §3.1 is the current, correct state.

Items 1, 2 and 4 were resolved in the v0.95 pass and removed from this section (see "Revision history" below). Item 3 (the missing `thread.person_id` field in the master schema) had to wait for A3 to settle it and was carried through v0.95, but in pass 2 (v1.0) A3 v0.95 introduced `persons.primary_thread_id`, resolving it — the §3.6 data binding was rewritten as a backwards join (99-review-v2 §2-4). There are now no unresolved items in this section.

---

## Revision history (v0.95, 2026-09-20)

Reflecting the global review `99-review.md` (§1.2, §4 items 11–13) and master v0.95, the following 8 items were fixed.

1. Corrected digest time copy: §3.8's loading-state wording "00:30" → "23:00" (night digest); §3.8's purpose line now also states the 06:30 KST morning briefing (master §14, A4 §6 schedule owner).
2. Redefined the iPhone bottom tab bar as 5 items — Inbox/Today/Tasks/Network/Notes (Settings in §4.1); added a night digest entry card at the top of Today (§3.4); added the single "night digest ready" Web Push kind (§4.4) — Digest is not put in the tab bar (master §3, 99-review §4 item 11).
3. Added the spec for 2 label chips + `+N` on the right of InboxRow row 2: selection priority (scope first), color (the label's own `labels.color`, channel brand colors forbidden), truncation, accessibility (§3.1, master §3, 99-review §4 item 12).
4. KakaoTalk send button: disabled while read stability is under 14 days, with a "D-{N}" label and the remaining days shown in the tooltip and on the Accounts row (§3.9, master §3, 99-review §4 item 13).
5. Changed the Settings cost cap from a read-only gauge to an editable input, exposing the 10% reserve and current spend together (§3.9, A4 §10.4, 99-review §1.2).
6. Added the ⌘K unified search mode (§2.5, Phase B): 4 result groups (threads/items/people/memories), sources are A3 `items.search_tsv`·`persons_name_trgm_idx` + the `search_memory` tool contract, keyboard navigation and empty/slow states defined (master §3).
7. Added the Hermes "read only" badge to Agent Session (Phase B, master Q7) (§3.3); specified the 7-day auto-archive restore affordance on both Thread and Digest (new state in §3.2, and §3.8).
8. Aligned schema field names with A3/master: the Tasks Delegated filter `owner='agent_runtime'` → `owner_kind='agent'` plus a mention of `tasks.kind` (§3.5); the PersonCard relationship state dot now reflects the full enum including `warming` (§3.6).

**Not applied**: none (all 8 applied).

**Newly opened items**: none — every spec added in this pass (label chip color, Hermes badge, unified search groups) is based on facts verified directly in master §3/§6/§9 or the A3 DDL, and only the one precise latency/debounce figure for unified search was marked **UNVERIFIED — spike** in the §2.5 body (stated as a spike within the same section rather than as a newly opened review item).

### v1.0 (2026-09-20, pass 2)

Reflecting global review pass 2 `99-review-v2.md` (§2-4, §4-1, §4-5), the following 3 items were fixed.

1. **§3.6 follow-up queue data binding**: rewrote the query that referenced the non-existent `threads.person_id` to join backwards via `persons.primary_thread_id`, introduced in A3 v0.95 (`persons.where(id IN followUpCandidateIds).related('primaryThread', ...)`). The remaining unresolved item in "Review notes" (no `thread.person_id` field) was closed along with it and removed from that section (99-review-v2 §2-4).
2. **§2.5 unified search**: removed everything that said the client consumes `items.search_tsv`/the trigram indexes/the `search_memory` tool directly, and rewrote it to consume only the single `SearchResponse` returned by A4 §14 `GET /search` (`search_tsv` is excluded from Zero replication in A3 §7). Aligned the result group order with the A4 §14.4 schema, correcting it to `people → threads → items → memories` (the previous `threads/items/people/memories` differed from the schema), and corrected the index name to A4 §14.2's notation (`items_body_trgm_idx`). Deleted the statement that "the latency targets exist nowhere" and replaced it with A4 §14.5/S-A4-7's actual UNVERIFIED targets (180ms debounce, items/threads/people p95 ≤ 400ms, memories ≤ 1.2s) (99-review-v2 §4-5).
3. **§4.4 Web Push**: kept the single Digest entry push, but explicitly ported A4 §3.6's three tiers (immediate/batched/silent) for draft notifications — adding the immediate push card (80-character preview + **Approve/Open** actions, verbatim from A4 §3.6) and the batched push copy ("Drafts ready: {N}", 09/12/15/18 KST), and quoting the global quiet-hours rule. The bottom tab bar is unchanged at 5 — Inbox/Today/Tasks/Network/Notes (99-review-v2 §4-1).

**Not applied**: none (all 3 applied). One exception: the task instruction's button copy "Approve/Snooze" was not used as-is — A4 §3.6, master §12 and 99-review-v2 §4-1 all define the immediate push action only as "Approve/Open", and nothing anywhere supports using "Snooze" as a push action button, so following the fact-tracing principle we specified **Approve/Open**.

**Newly opened items**: none — every change in this pass simply carries over facts already settled in master v1.0, A3 v0.95 and A4 (§14 SearchResponse schema, §3.6 three notification tiers, `persons.primary_thread_id`) and creates no new UNVERIFIED items. The latency/debounce figures in §2.5 cite the S-A4-7 spike A4 had already opened, so they are not a new open item for A5 alone.
