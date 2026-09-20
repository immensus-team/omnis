# Open-Source Design Skills (2026-09-20)

The list of Claude Code skills/plugins used for omnis UI work (Vite + React 18 + Tailwind v4 + shadcn/ui +
react-icons + cmdk + react-virtuoso, on top of Tauri 2). The baseline document is `DESIGN-DIRECTION.md`
(kinso-like, Apple/Liquid Glass, natural spring motion, no AI-slop). The research was verified on 2026-09-20 with GitHub CLI (`gh`) + WebSearch.

Project-specific skills are committed under `.claude/skills/` (they load automatically for this repo checkout). The rest are
things already installed globally on the Logan account (`~/.claude/skills/`, `~/.claude/plugins/`), so they are always
available regardless of this repo — they were not reinstalled, only catalogued in the table.

## Install list

| Name | Source | License | Version/Commit | Invocation | Purpose | How omnis uses it |
|---|---|---|---|---|---|---|
| `frontend-design` | [anthropics/skills](https://github.com/anthropics/skills) (official plugin, already installed through the `claude-plugins-official` marketplace) | Anthropic's own LICENSE.txt (redistributable; details in the plugin's LICENSE.txt) | plugin build `1aa8f02ec832` (global, user scope) | `Skill(frontend-design:frontend-design)` | Avoids the 5 big AI-slop clichés (warm cream + serif + terracotta, black + vivid accent, broadsheet hairline, SaaS card kit, tracked all-caps label); a 2-pass process that derives typography/color/layout from the brief | First-pass direction setting when designing a new screen/panel from scratch. Since the kinso reference already exists, skip the "derive palette from the brief" step and apply only the self-critique checklist |
| `apple-design` | Global skill (`~/.claude/skills/apple-design/`), a translation of the WWDC "Designing Fluid Interfaces" (2018) — source repo verified locally only (no upstream link, kept as installed globally) | The skill itself is a redistributable local document (the original WWDC content is Apple's, paraphrase only) | exactly as installed globally | `Skill(apple-design)` | response (immediate feedback), direct manipulation (1:1 tracking), momentum, interruptible transition, translucency, typography (optical size/tracking/leading), reduced-motion — Apple motion principles **translated to the web** | The primary source for omnis's rules on glass panels (sidebar/toolbar/sheet/palette) + spring motion (enter 160ms/transition 240ms/layer 320ms). Required when building drag-based UI (swipe, sheet) |
| `apple-design-skill` | [tzzs/apple-design-skill](https://github.com/tzzs/apple-design-skill) (installed globally) | MIT (`LICENSE`; the HIG text itself is Apple's, paraphrase only) | as of the 2026-09-19 commit | `Skill(apple-design-skill)` | An audit skill that restates the HIG as platform-agnostic rules. `references/hig/` holds color, typography, layout, accessibility, and interaction references; `hig-lookup.md` is the routing table | Used in the review pass after a screen is finished, as a "any HIG violations?" checklist (loads only 3–8 selected references) |
| `avoid-ai-design` | By [ungspirit](https://github.com), agentskills.io spec (installed globally) | MIT | v0.2.0 | `Skill(avoid-ai-design)` | AI-slop detection and rewriting for HTML/CSS + React/Tailwind/shadcn. `detect` (audit only) / `rewrite` (default) modes | After DeepSeek has polished a UI story, a Sonnet reviewer runs `detect` mode to make a first pass over code-level slop (gradients, default lucide icons, leaving Inter in place, etc.) even without screenshots |
| `hallmark` | [Nutlope/hallmark](https://github.com/nutlope/hallmark) — **newly installed**, `.claude/skills/hallmark/` | MIT | commit `13ac0ec` (cloned 2026-09-20) | `Skill(hallmark)` — subcommands `hallmark audit <target>` / `hallmark redesign <target>` / `hallmark study <screenshot\|URL>` | A catalog of 21 themes + a "slop test" of 48+ gates (no invented metrics, token lock, no fake browser chrome, verification at 4 mobile sizes, no italic headers, etc.) + **`study` = extract DNA (macro structure/type pairing/color anchors) from a reference screenshot** | Drop in `docs/design/reference/*.webp` (kinso, glass-mail-ai-panel, etc.), extract DNA with `hallmark study`, then rework existing components into the kinso look with `hallmark redesign <file>`. Division of labor with `avoid-ai-design`: hallmark = new work/redesign + structural variety, avoid-ai-design = audit and fix existing code |
| `motion-dev-animations` | [199-biotechnologies/motion-dev-animations-skill](https://github.com/199-biotechnologies/motion-dev-animations-skill) — **newly installed**, `.claude/skills/motion-dev-animations/` | MIT | commit `3feedfb` (cloned 2026-09-20) | `Skill(motion-dev-animations)` | Spring physics, gestures, scroll, and 120fps GPU-accelerated patterns built on Motion.dev (the successor to Framer Motion), plus mandatory `prefers-reduced-motion`. Includes `reference/spring-physics.md` and `templates/component-library.tsx` | When porting the spring timings from DESIGN-DIRECTION.md (160/240/320ms) into Motion library code. omnis does not yet depend on `motion`/`framer-motion`, so read this skill's `reference/api-reference.md` first when adopting it |
| `design-tokens` | [ilikescience/design-tokens-skill](https://github.com/ilikescience/design-tokens-skill) — **newly installed**, `.claude/skills/design-tokens/` | MIT | commit `787f972` (cloned 2026-09-20) | `Skill(design-tokens)` | The DTCG (Design Tokens Community Group) spec — token types, OKLCH/P3/sRGB color formats, alias/resolver, multi-platform themes | When extending the shadcn CSS variable tokens (`--background`, `--accent`, etc.) into a light/dark resolver structure, or syncing with a Figma export |
| `tailwind-v4-shadcn` | [secondsky/claude-skills](https://github.com/secondsky/claude-skills) `plugins/tailwind-v4-shadcn/skills/tailwind-v4-shadcn` — **newly installed**, `.claude/skills/tailwind-v4-shadcn/` | MIT | commit `a0994f7` (cloned 2026-09-20) | `Skill(tailwind-v4-shadcn)` | A hands-on guide for the exact stack omnis uses (Tailwind v4 CSS-first `@theme inline`, shadcn/ui, Vite, React) — dark mode ThemeProvider, `components.json`, common v4 bugs (`common-gotchas.md`) | First stop for debugging Tailwind v4/shadcn issues (theme colors not applying, `@theme` not recognized, etc.). When setting up a new shadcn component, refer to `theme-provider.tsx`/`index.css` in `templates/` |
| `shadcn` (Vercel plugin skill) + `mcp__shadcn__*` | Vercel's official plugin (installed globally) + the shadcn MCP server (already connected) | Vercel plugin license (official marketplace) | `vercel@0.49.2` | `Skill(vercel:shadcn)`, MCP tools such as `mcp__shadcn__search_items_in_registries` | shadcn CLI, custom registries, component composition/theme guidance + live component search and add-command generation over MCP | When adding a new shadcn component, get the exact install command from `mcp__shadcn__get_add_command_for_items`, and check accessibility with `get_audit_checklist` |
| `chrome-devtools-mcp` (plugin) | The official Chrome DevTools MCP plugin (installed globally, `claude-plugins-official`) | Official plugin license | `v1.9.0` | `Skill(chrome-devtools-mcp:chrome-devtools)` + `mcp__plugin_chrome-devtools-mcp_chrome-devtools__*` (screenshot, snapshot, network, performance, a11y trace, lighthouse) | Screenshot-based visual QA that opens the real Tauri webview/Vite dev server and captures screenshots, the accessibility tree, console, and network | After a screen is finished, capture the real thing with `take_screenshot`/`take_snapshot` → re-apply the hallmark/avoid-ai-design slop checklists against the screenshot. Also bundles the `a11y-debugging` and `debug-optimize-lcp` subskills |

### What was not installed, and why

- **`haider-nawaz/liquid-glass-skill`, `tristan-mcinnis/apple-hig-designer-skill-2026`** (specific to the SwiftUI Liquid Glass `.glassEffect()` API) — omnis is a webview (React/CSS) inside Tauri, so the SwiftUI API does not apply directly. "Translating Liquid Glass to the web" is already covered by the installed `apple-design` (translucency/materials section). Revisit this if we ever build a separate native macOS 26 app.
- **`ui-ux-pro-max-skill` (nextlevelbuilder)** — a vast local dataset (79 styles/192 palettes/74 font pairings, etc.), but over-engineered (YAGNI) for omnis, whose direction is already pinned by the kinso reference. `hallmark` (a narrower, stricter slop-test gate) is enough instead.
- **design-tokens candidates other than `ilikescience` (plugin87/ux-ui-agent-skills, etc.)** — a bundle of 19 skills + commands + agents, so the scope is far larger than omnis needs (43 build gates, 138 design systems). The `design-tokens-skill` narrowed down to 1 skill is lighter.
- **Playwright-specific skills (e.g. `maxrihter/claude-skill-visual-regression`)** — the `chrome-devtools-mcp` plugin already provides screenshots/snapshots/network/performance over MCP, so a separate Playwright skill is duplicate work. Revisit if pixel-diff regression testing actually becomes necessary.

## Standard prompt preamble for UI tasks

**Every task that touches UI loads the following before opening any code.**

1. All of `docs/design/DESIGN-DIRECTION.md` — kinso baseline, light theme, channel rail/row grammar, glass only in sidebar/toolbar/sheet/palette, spring timings (160/240/320ms).
2. At least 1 relevant reference image — `docs/design/reference/kinso-inbox.webp` plus the other 3 that match the work area (`ref-glass-mail-ai-panel.webp`=sidebar/AI panel, `ref-issue-tracker-density.webp`=filter/status pill, `ref-dashboard-detail-card.webp`=icon rail/detail card).
3. New screen/major redesign → `Skill(hallmark)` (extract DNA first with `hallmark study <reference webp>`, then `hallmark redesign`). Local edit to existing code → scan first with `Skill(avoid-ai-design)` `detect` mode.
4. Any panel that involves glass or motion (sidebar/toolbar/sheet/palette/floating) → `Skill(apple-design)` is a required load. If spring implementation code is needed, add `Skill(motion-dev-animations)`.
5. Tailwind v4/shadcn setup and bugs → `Skill(tailwind-v4-shadcn)` first (`references/common-gotchas.md`); for adding components, `mcp__shadcn__get_add_command_for_items`.
6. Once finished, always capture a real screenshot with `chrome-devtools-mcp` → `Skill(apple-design-skill)` (HIG audit) + re-check with `Skill(avoid-ai-design)` `detect`.

## 12-line Anti-AI-Slop checklist

(Synthesized from the `frontend-design` §5 big clichés + the `hallmark` slop-test gates + the `avoid-ai-design` catalog + real findings in omnis's `POLISH-LOG.md`)

1. No warm-cream background + serif display + terracotta (near #D97757) accent combo — it reads as Claude's own tone.
2. No uniform card grid where every card has the same border-radius + the same `rgba(0,0,0,.1)` soft shadow — a "SaaS card kit" with no hierarchy.
3. No overusing purple/blue gradients as decoration — if you use one, you must be able to answer why that color.
4. No italic emphasis in headings, or color/bold emphasis on just 1 word — replace with weight or an underline.
5. No "template chrome" such as tracked all-caps labels, middle-dot metadata (`A · B · C`), or spaced em-dash (`WORD — fragment`).
6. No inventing unsupported metrics (`+47% conversion`, `10× faster`) — if there is no actual measurement, use `—` or a label.
7. No hand-drawing fake browser bars (URL pill + traffic-light dots) or fake phone frames — use real screenshots.
8. No listing default lucide/heroicons icons with no meaning — brand icons from `react-icons/si`, feature icons only when they carry meaning.
9. No static entrance (appearing instantly) or a repeated fade-up on every card — the entrance is one spring (160/240/320ms), no exaggeration.
10. Never ignore `prefers-reduced-motion` — every spring/transition requires a reduced-motion fallback path.
11. If horizontal scroll occurs at even one of the 4 mobile sizes (320/375/414/768px), the task counts as failed.
12. No overusing hairlines/shadows on unselected list rows — follow the kinso rule (no hairlines; only the selected row elevates as a card).

## References

- The plan for borrowing OSS at the component/code level (shadcn-compatible kit, mail client patterns, agent status UI, etc.) is library research rather than skills, so it lives separately in `docs/research/30-herdr-and-oss-ui-borrow.md` — a different role from this document (this one is "the knowledge/checklists Claude Code loads when writing UI", that one is "component code to adopt").
