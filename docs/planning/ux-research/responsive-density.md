# Responsive density: dense-list layouts that never break

LENS: responsive-density, for omnis (unified inbox, agent sessions as threads). Goal: define how the inbox list pane, filter/chip rows, and detail panel survive every window width — Tauri desktop resize, split-screen, iPhone PWA — without rows clipping, chips wrapping into a wall, or timestamps colliding with names.

## Products studied (URLs)

- Linear — https://linear.app (issue list, sidebar-collapse-to-icon-rail, filter bar)
- GitHub Issues / PRs list — https://github.com (list rows, label chips, PR list density)
- Things 3 — https://culturedcode.com/things/ (task list, sidebar, macOS + iPhone parity)
- Apple Mail (macOS) — three-column layout, built into macOS (no public URL; use system app as reference)
- kinso.ai — https://kinso.ai (already omnis's baseline; cited here only for what it does NOT solve — chip/density at narrow widths)
- MDN / web.dev container query references — https://web.dev/patterns/layout/container-query-card, https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_containment/Container_queries
- Material Design chips guidance — https://m2.material.io/components/chips

Direct product CSS isn't inspectable for Things 3 (native AppKit/UIKit) or Apple Mail (system app); those two are described from direct, repeated use as reference behavior, not from reading their source.

## Patterns worth adopting

### 1. Container queries on the list pane, not viewport media queries
**What:** The inbox list column's row layout (avatar size, summary visibility, timestamp column, channel icon) responds to the *pane's own width*, not the browser/window width. When the user narrows the pane (resizable split, or the detail panel opens and shrinks the list), rows adapt independently of anything else on screen.
**Why it works:** omnis has multiple independently-resizable regions (channel rail, list pane, detail pane) inside one window. A `@media` breakpoint tied to window width can't distinguish "list pane is 320px because detail is open" from "window is 1400px wide." Only the list pane's own box width matters for its row layout.
**Implementation notes for omnis:** Wrap the list pane root in `container-type: inline-size; container-name: inbox-list;` then gate row sub-elements with `@container inbox-list (max-width: Npx)`. Concretely: full row = avatar 40px + name + summary + trailing chips + timestamp + channel icon, all in one line. At `<560px` container width, drop the AI summary line, keep name + timestamp + channel icon only (summary reappears on hover/focus as a tooltip or is truncated harder). At `<380px` (iPhone portrait, PWA), drop channel icon to a small corner badge on the avatar instead of a separate trailing column, and collapse timestamp to a narrower format (`3m` stays, `4 Aug` → `Aug 4` already narrow — keep as-is, it's the tightest safe format).
**Effort:** M — requires restructuring row markup into logical zones (leading/main/trailing) that can be independently hidden per container breakpoint, plus `container-type` set correctly so it doesn't break existing flex/grid parents.

### 2. Chip/filter rows scroll horizontally, never wrap
**What:** The filter pill row (All / Work / Personal / Agents / Needs approval) and any per-row label chips scroll horizontally with `overflow-x: auto; flex-wrap: nowrap;` rather than wrapping to a second line. Each chip gets `flex-shrink: 0` so its label never gets squeezed or ellipsized mid-word.
**Why it works:** Wrapping a chip row pushes the list content down unpredictably and the amount of push depends on window width — this is the #1 source of "layout jumps as I resize" in dense apps. A fixed-height scrollable chip row keeps the header height constant at every width. Material Design's own guidance converges on this once you have more chips than fit one line.
**Implementation notes for omnis:** Apply to (a) the header filter pill bar, and (b) the per-row label chips at the end of a summary line — cap per-row chips to 2 visible + "+N" (already in DESIGN-DIRECTION.md) so that row never needs to scroll; only the header filter bar needs the scroll treatment since it can have many pills. Hide the scrollbar visually (`scrollbar-width: none`) but keep it scrollable via trackpad/touch; the clipped last chip is the visual affordance for "more." On iPhone PWA this becomes an ordinary touch-scroll strip, which iOS users already expect (see App Store, Photos album filters).
**Effort:** S — a few CSS lines, no markup restructure. Do this one first.

### 3. Tabular, fixed-width time/meta columns with lining figures
**What:** Timestamps, counts, and any right-aligned metadata column use `font-variant-numeric: tabular-nums` and a fixed min-width, so "3m" and "4 Aug" and "2w" all right-align cleanly without the column width jittering row to row.
**Why it works:** Proportional digits ("1" narrower than "8") make a right-aligned time column ragged and look unfinished at high density — very visible in Linear's and GitHub's list views where every row has a similar-shaped trailing cell. Fixed-width + tabular-nums is what makes those lists feel calm even when values vary a lot.
**Implementation notes for omnis:** `font-variant-numeric: tabular-nums; min-width: 44px; text-align: right;` on the timestamp span used in inbox rows, task rows, and agent-session rows alike (one shared component). No breakpoint needed — this is correct at every width and should just be baseline CSS on the component.
**Effort:** S — one CSS rule, add to the shared row-meta component omnis will build from `cloudflare/agentic-inbox` patterns.

### 4. Truncation rules: single-line ellipsis for name/summary, never multi-line reflow
**What:** Name and AI-summary text are always `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` — single line, hard truncated — never `line-clamp: 2` or wrapped. Row height stays constant regardless of content length or pane width.
**Why it works:** Variable row height is what makes a list "feel broken" when resized — rows of different heights next to each other, scroll position jumping as text reflows. Every dense-list product studied (Linear, GitHub, Things, Mail) uses fixed-height rows and truncates instead of wrapping, trading "see full text" for "predictable scanning and stable scroll position." Full text is always one hover/click away.
**Implementation notes for omnis:** Fixed row height (already implied by DESIGN-DIRECTION's "generous row height" + card elevation). Truncate name first if truly starved for space, but in practice truncate the AI summary — the name is short and rarely the constrained element. On overflow, native `title` attribute or a delayed hover tooltip shows the full summary; don't build a custom tooltip system for v1 — the browser's `title` is free and correct at S effort.
**Effort:** S.

### 5. Minimum pane widths + collapse-to-rail instead of proportional shrink
**What:** Each of the three regions (channel rail, list pane, detail pane) has a hard minimum width. When the window can't fit all three at their minimums, the *channel rail* collapses first (full squircle tiles → icon-only, already planned in DESIGN-DIRECTION), then the *detail pane* becomes an overlay/sheet instead of a third column (list pane goes full-width, detail slides in on top, à la Apple Mail on a narrow window or Things 3 on iPhone/split-screen iPad). The list pane itself never drops below its own minimum (~280px) — below that, it's the thing that goes full-screen and other panes give way.
**Why it works:** This mirrors macOS Mail exactly: at typical width it's rail + list + detail (three columns); narrow the window and the sidebar (rail) auto-collapses to a compact icon strip before anything else breaks; narrow further and it becomes list + detail as an overlay. Things 3 does the same rail→bottom-bar-or-hidden pattern on iPhone. This is the deliberate escape hatch for "container queries per-row" (pattern 1) — it handles the pane-level layout, while pattern 1 handles what happens inside the surviving list pane at whatever width it lands on.
**Implementation notes for omnis:** Set explicit `min-width` on the three CSS grid tracks (rail, list, detail) in the desktop shell. Add resize-observer or container-query logic on the outer shell: below a combined-width threshold, switch `grid-template-columns` from 3-track to 2-track (rail-icon + list, detail becomes a slide-over `position: fixed` panel with its own glassy sheet treatment per DESIGN-DIRECTION's Liquid Glass rule for sheets). On iPhone PWA, this is simply the permanent state: rail becomes a bottom tab bar (or is dropped in favor of the channel-rail-as-first-list-item pattern, worth a follow-up study), list is the default screen, detail is a full-screen push.
**Effort:** L — this is real layout-shell work (grid restructure + a slide-over/sheet component + a resize-driven mode switch), but it's the piece that actually fixes "everything breaks on resize" since patterns 1–4 only work once the pane-level collapse logic exists to keep each pane in a sane width range.

## Patterns to avoid

- **Proportional/fluid column shrinking with no floor.** Letting the list pane shrink smoothly with the window (e.g. `flex: 1` with no `min-width`) is what currently causes the "everything breaks" symptom Logan flagged — text wraps, icons collide, chips wrap into a second row that reflows the whole list. Every pane needs a hard floor; below it, something *changes mode* (collapses/overlays), it doesn't keep shrinking.
- **`line-clamp` on list rows.** Multi-line summaries in a dense list look fine in isolation and break the moment two adjacent rows have different clamp results — variable height, jumpy scroll. Single-line truncation only (pattern 4).
- **Wrapping filter chips to multiple lines.** Pushes the whole list down by an unpredictable amount per width; use horizontal scroll instead (pattern 2).
- **Hiding the channel-brand icon/state-badge entirely at narrow widths instead of shrinking it to a corner badge.** Losing the channel identity (which channel this thread is from) or agent status badge (idle/working/blocked/done) removes information the user relies on for scanning; shrink/reposition it, don't drop it — the blocked/needs-approval signal especially must survive to the narrowest width since that's the "needs me now" cue.
- **Reintroducing viewport media queries for the list pane's internal row layout.** Once the detail pane opens/closes or the window resizes, a viewport breakpoint will be wrong for the list pane's actual rendered width; only a container query on the pane itself is correct (pattern 1).

## Open questions

- Does the channel rail become a bottom tab bar or a leading rail-as-first-list-row on iPhone PWA? Apple Mail-style bottom bar is more iOS-idiomatic; kinso's vertical rail is the desktop baseline. Needs its own screenshot-comparison pass (Gmail iOS, Spark, Superhuman iOS) before deciding — flagged as a separate LENS.
- Where does the always-visible "Start typing to ask or search" pill bar live at iPhone width — persistent top bar (costs vertical space on a small screen) or a FAB that expands into the search sheet (Linear/Raycast-style ⌘K equivalent on mobile)? Not covered by this LENS; needs a mobile-search-pattern pass.
- Agent-session rows (Claude/Codex/DeepSeek/Hermes) carry a status badge in addition to the channel icon that plain-email rows don't have — at the narrowest container width, do both badges coexist on the avatar (stacked corner badges) or does the channel icon disappear for agent rows since the runtime logo already identifies the source? Needs a mock at 320px container width to judge legibility before deciding.
