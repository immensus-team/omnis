# 14. Apple-native Design Language + Web Component Strategy

## 1. TL;DR

Build omnis on Tauri with a web stack (Tailwind v4 + shadcn/ui + Radix), but follow the Liquid Glass principles of macOS Tahoe 26 — the control/navigation layer is glass, content (lists, mail bodies) is opaque. Use Liquid Glass only for the sidebar, toolbar, sheet, and command palette, never for the scrolling list itself (Apple's official guidance). Typography pairs Inter (Latin) with Pretendard (Korean), dark mode first, a desaturated background plus a single accent (the Linear/Raycast pattern). Get macOS-native vibrancy through Tauri's `window-vibrancy`; for virtual lists we recommend TanStack Virtual, for the command palette cmdk (already wrapped by shadcn Command), and for rich text Tiptap (ProseMirror-based, with AI extensions). Notion Mail shuts down on 2026-09-22 — a direct counterexample worth noting for the unified-inbox market.

## 2. Facts

**Apple HIG / Liquid Glass**
- Liquid Glass is a new material spanning iOS/iPadOS/macOS (Tahoe)/watchOS/tvOS 26, announced at WWDC25 (2025-06). It combines "the optical properties of glass with fluidity." VERIFIED — [Apple Newsroom](https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/) (fetched 2026-09-20)
- Core principle: layer separation — glass belongs to the **control/navigation** layer (toolbars, tab bars, sidebars, sheets, popovers, floating buttons) and is not used on **content** (lists, tables, media, scroll areas). VERIFIED — [WWDC25 session #323](https://developer.apple.com/videos/play/wwdc2025/323/), re-confirmed via search summary (fetched 2026-09-20)
- macOS Tahoe: the sidebar is a glass panel floating above the content, the inspector is edge-to-edge glass, and toolbar items automatically group onto the glass surface and adapt to the brightness of the content beneath. Scroll edge effects replace hard dividers with a blur. VERIFIED (WWDC25 summary; a direct crawl of the primary source failed because it is JS-rendered, cross-checked against Apple's official session titles and Newsroom) — [WWDC25 #310 AppKit](https://developer.apple.com/videos/play/wwdc2025/310/), [WWDC25 #356](https://developer.apple.com/videos/play/wwdc2025/356/) (fetched 2026-09-20)
- The glass material's color is "determined by the surrounding content and automatically adapts to light/dark" — that is, dark-mode support is built into the material itself. VERIFIED — Apple Newsroom (fetched 2026-09-20)

**Reference apps**
- Superhuman: the Cmd/Ctrl+K command palette appears centered on screen and uses a monospace font to give a "power tool" feel. Shortcut-first UX (E=archive, J/K=nav, etc.); when an action is executed the palette surfaces its shortcut alongside it, teaching it by exposure. VERIFIED — [Superhuman Blog](https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/), [Help Center](https://help.superhuman.com/hc/en-us/articles/45191759067411-Speed-Up-With-Shortcuts) (fetched 2026-09-20)
- Linear: Inter Variable used globally (`cv01`, `ss03` enabled), three weights (400/510/590), letter-spacing scaling inversely with font size. Spacing follows an 8/12/24/96 ladder on an 8px base. Dark background `#08090a` plus a single accent (acid-lime `#e4f222`). Motion durations 100/160/400ms; borders are 0.5px hairlines. VERIFIED (community DESIGN.md analysis, not a primary source, cross-checked across multiple sources) — [DesignMD Linear](https://www.designmd.co/d/linear.app) (fetched 2026-09-20)
- Raycast: near-black canvas `#07080a`, Inter + `ss03` (single-story g), 1px hairline borders, corner radius 6–16px, a single coral accent `#ff6363`, keycap-style inset shadows. VERIFIED (community analysis) — [shadcn.io/design/raycast](https://www.shadcn.io/design/raycast) (fetched 2026-09-20)
- Arc browser: the sidebar replaces the tab bar/URL bar/bookmarks bar, the Cmd+T command bar is a Spotlight-style universal search (unifying tabs/history/bookmarks/actions), and "Spaces" provide per-project vertical grouping. VERIFIED (cross-checked across multiple sources) — [Blake Crosley analysis](https://blakecrosley.com/guides/design/arc) (fetched 2026-09-20)
- Things 3 / Craft: typography- and whitespace-driven, with multiple reviews noting the density is finely tuned to be "neither too loose nor too tight." Things 3 won a 2017 Apple Design Award. VERIFIED — [Pratt IXD critique](https://ixd.prattsi.org/2020/02/design-critique-things-3-ios-app/) (fetched 2026-09-20)
- Notion Mail: **shutdown confirmed for 2026-09-22**. The reason is not product failure but that "more than half of email users never open their inbox and delegate the whole thing to an agent" — direct evidence that the market is moving toward the agent becoming the final surface, not toward the unified-inbox UI itself. Gmail data is retained, but Notion-specific features (drafts/auto-labeling/snippets) must be exported by 09-21. VERIFIED (primary source) — [Notion Help Center](https://www.notion.com/help/notion-mail-inbox-is-going-away-what-to-do-next) (fetched 2026-09-20)
- Kinso.ai: AI unified inbox (email + Slack + LinkedIn + WhatsApp + Instagram), tone-learning draft composition, cross-channel conversation threading, priority-based morning briefing. Invite-only at $59/month. Reputation is mixed (praise for beta support vs. criticism as a "hype company"). VERIFIED (multiple review sources; the only official primary source accessible was the landing page) — [Kinso.ai](https://www.kinso.ai/), [thisandthat.chat review](https://www.thisandthat.chat/blog/kinso-review/) (fetched 2026-09-20)

**Typography**
- Pretendard is a font synthesized from Inter (Latin) + Source Han Sans (Korean) + M PLUS 1p (Japanese), released 2021-06-28 as a replacement for Apple SD Gothic Neo/SF Pro. 9 weights, variable font support, 182 languages. VERIFIED — [Pretendard GitHub README](https://github.com/orioncactus/pretendard/blob/main/packages/pretendard/docs/en/README.md) (fetched 2026-09-20)

**Web implementation stack**
- Tailwind v4: the JS config is abolished and design tokens are defined inside CSS via the `@theme` directive (CSS-first). The Rust-based Oxide engine brings full builds to ~100ms and no-change incremental builds to ~192μs. Released 2025-01. VERIFIED — [Tailwind CSS v4.0 official blog](https://tailwindcss.com/blog/tailwindcss-v4) (fetched 2026-09-20)
- shadcn/ui: Tailwind v4 + React 19 support complete, a `data-slot` attribute on every primitive, HSL→OKLCH color migration. The `--base` flag lets you choose Radix or Base UI primitives (Base UI became the default as of 2026-07). VERIFIED — [shadcn/ui Tailwind v4 docs](https://ui.shadcn.com/docs/tailwind-v4), [changelog](https://ui.shadcn.com/docs/changelog) (fetched 2026-09-20)
- shadcn MCP server: lets AI agents browse, search, and install components from the registry (natural language like "add a login form" works), with multiple registries (public/private/third-party) connected simultaneously. Claude Code setup: `pnpm dlx shadcn@latest mcp init --client claude`. VERIFIED (primary source) — [ui.shadcn.com/docs/mcp](https://ui.shadcn.com/docs/mcp) (fetched 2026-09-20)
- Tauri `window-vibrancy`: macOS-native vibrancy support; Liquid Glass effects can be applied via `apply_liquid_glass` + `NSGlassEffectViewStyle` (latest work still in progress as of 2026-09). Linux is unsupported because it depends on the compositor; Windows uses a separate API. VERIFIED — [tauri-apps/window-vibrancy GitHub](https://github.com/tauri-apps/window-vibrancy) (fetched 2026-09-20)
- cmdk: effectively the industry standard, since the shadcn Command component wraps it (tens of millions of weekly downloads). An unstyled primitive that provides only fuzzy filtering + keyboard navigation; styling is up to you. VERIFIED (community analysis, cross-checked across multiple sources) — synthesized from search results (fetched 2026-09-20)
- Tiptap vs Lexical: Tiptap is ProseMirror-based with a mature extension ecosystem and first-party AI extensions (slash commands/completion/generation), an 80–120KB bundle, and a good fit for CMS, documents, and collaborative authoring. Lexical is Meta's open source (used in Messenger/WhatsApp Web), lighter and lower-level, and a good fit for high-performance social/messaging UIs. For omnis's reply drafter, Tiptap is the better fit (AI extensions needed, performance is not critical). VERIFIED (cross-checked across multiple 2026 comparison sources) — [Eddyter comparison](https://eddyter.com/blogs/lexical-vs-tiptap-2026) (fetched 2026-09-20)
- TanStack Virtual: handles 100k-item lists without rendering lag (windowing: only items near the viewport stay in the DOM). As of 2026 the most widely used virtual list library; react-virtuoso fits when built-in dynamic heights/grouping are needed, and react-window fits simple fixed-height cases. VERIFIED (cross-checked against community benchmark sources) — [TanStack Virtual official docs](https://tanstack.com/virtual/latest/docs/introduction) (fetched 2026-09-20)

## 3. Options / Comparison Table

| Axis | Option A | Option B | omnis choice |
|---|---|---|---|
| shadcn primitive base | Radix UI (mature, large existing ecosystem) | Base UI (shadcn default since 2026-07, new work from the MUI team) | **Radix** — a far larger pool of docs/examples/third-party components; Base UI is still a young ecosystem and a risk for M/L-scale apps |
| Virtual list | TanStack Virtual (headless, flexible) | react-virtuoso (built-in dynamic heights/grouping) | **react-virtuoso** — inbox rows vary in height because of avatars, previews, and badges, and per-channel grouping (Slack/Kakao/Gmail…) is required, so built-in support wins on development speed. Migrate to TanStack Virtual if we hit a performance ceiling |
| Rich text | Tiptap (ProseMirror) | Lexical (Meta) | **Tiptap** — AI extension maturity, and tables/formatting and the other features needed for email reply composition come built in |
| Command palette | cmdk directly | shadcn Command (wraps cmdk) | **shadcn Command** — already integrated into the design system, no separate styling needed |
| macOS glass effect implementation | Pure CSS `backdrop-filter: blur()` | Tauri `window-vibrancy` (native NSVisualEffectView/Liquid Glass) | **window-vibrancy first, CSS blur as fallback** — only native vibrancy reflects the actual desktop background, giving the "Apple-native" feel; CSS blur only blurs content inside the webview and looks shallow |
| Icons (web) | Lucide | Phosphor | **Lucide** — the icon set shadcn adopts by default, so there is no friction, and its shape grammar (simple lines, 2px stroke) is closest to SF Symbols |

## 4. Recommendation for omnis

**Enforce layer separation as a code rule.** Apply Liquid Glass only to the sidebar, toolbar, command palette, and sheets (the reply-composer modal, settings), and place "content" such as the inbox list (message rows) and mail bodies on opaque backgrounds. Apple itself explicitly says "don't use glass on every UI element," so deviating from this immediately reads as "a UI an AI built." Effort: S (document the CSS layer rules) + M (wire up Tauri vibrancy). Risk: low — not a HIG violation but a pure implementation risk (vibrancy can cause frame drops; GPU load needs monitoring).

**Dark mode first, cold neutral + a single accent.** The pattern Linear (`#08090a` + lime) and Raycast (`#07080a` + coral) both prove out: a near-black background, hairline borders (0.5–1px) to express card boundaries (instead of shadows), and an accent color confined to CTAs, selected states, and unread badges. Fix omnis's accent to a single brand color (e.g. per-channel colors only on icons/dots, never on backgrounds). Effort: S. Risk: none — pure token design.

**Typography: Inter + Pretendard pairing, with a system-font fallback chain.** Specify `font-family: Pretendard, Inter, -apple-system, sans-serif` in that order so Korean renders in Pretendard and Latin in Inter (preventing either font from forcing its own Latin/Korean glyphs). Limit weights to Linear's three-step scale (400/510~500/590~600) — no bold spam. Effort: S. Risk: none (both are OFL-licensed; just watch bundle size — variable-font subsetting required).

**Treat the command palette as omnis's core interaction (a pattern common to Superhuman/Arc/Raycast).** Build a single entry point under ⌘K that crosses every channel, agent session, and todo — this is the point where the UI proves omnis's core value proposition of "many apps unified into one." Use shadcn Command (wrapping cmdk) as-is, and follow the kbar pattern (id+name+shortcut+perform) for action registration so agent actions (delegate to Codex, call Hermes) live inside the same palette. Effort: M. Risk: low — high library maturity.

**Lay the virtual list in from the start; bolting it on later means rewriting the entire list component.** Since the 100k-message scale is explicit, nail react-virtuoso (built-in grouping/variable heights) down as the foundation of the inbox list component. Effort: M. Risk: low (though skimping on lazy-loading of images/avatars per row will cause scroll jank — separate issue).

**Reflect the Notion Mail shutdown as a product-positioning warning.** "The agent handles things first and the human only sees exceptions" is the direction the market has validated, more than "building a great email UI." omnis's strength already lies in this direction (agent-managed todo, draft reply), so when designing the UI the "never need to open the inbox" path (notification → review draft → one-click send) must be treated as a first-class citizen. Effort: planning impact (not code). Risk: medium — with only one data point (Notion), over-interpretation is a hazard; what remains UNVERIFIED is the causal claim in Notion's own official explanation that "AI agents are replacing the email UI."

## 5. What to borrow

- **Superhuman's command-modal typography** (action names shown in a monospace font, shortcut exposed on the right) → in omnis `CommandPalette.tsx`, render each action's shortcut as a `kbd` element on the right of the row. Reference: [Superhuman blog](https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/)
- **Arc's sidebar-as-primary-navigation** structure (removing the tab bar/bookmarks bar and absorbing all navigation into just the sidebar + command bar) → consolidate channel filters + Network + agent session list into one column in omnis's left sidebar, absorbing the top search bar into ⌘K rather than a separate element.
- **Things 3/Craft density calibration** → start list row heights at 44–56px (24px avatar + 2 lines of text), and a "compact/comfortable" density toggle can be deferred to a later release (YAGNI — with a single user, the setting may be unnecessary).
- **shadcn MCP workflow**: one line, `pnpm dlx shadcn@latest mcp init --client claude`, gives a Claude Code session the ability to install components — set up the design-to-code loop from the start of development. Reference: [ui.shadcn.com/docs/mcp](https://ui.shadcn.com/docs/mcp)
- **frontend-design skill + chrome-devtools/Playwright visual QA loop**: after writing a component, always run a separate screenshot-based review pass (consistent with the OMC principle of separating the authoring session from the review session). Figma MCP is still unauthenticated in this session (`plugin:figma:figma` auth required) — Logan must authenticate via `claude mcp`/`/mcp` before it is usable in practice.
- **Tauri window-vibrancy README's `NSGlassEffectViewStyle`** example code can be followed directly to apply Liquid Glass window effects in a macOS 26 target build. Reference: [tauri-apps/window-vibrancy](https://github.com/tauri-apps/window-vibrancy)

## 6. Concrete tokens (starting point)

```
/* spacing (borrowed from Linear's 8px ladder) */
--space-1: 4px;  --space-2: 8px;  --space-3: 12px;
--space-4: 16px; --space-6: 24px; --space-16: 96px;

/* radius */
--radius-sm: 6px; --radius-md: 10px; --radius-lg: 16px; --radius-full: 999px;

/* type scale (1.2 minor-third, base 14px — 15/16px body is too much for an information-dense app) */
--text-xs: 12px; --text-sm: 13px; --text-base: 14px;
--text-lg: 16px; --text-xl: 20px; --text-2xl: 26px;
font-family: Pretendard, Inter, -apple-system, system-ui, sans-serif;
font-weight: 400 (body) / 510 (emphasis) / 590 (heading);

/* color (dark first, OKLCH) — palette must be replaced with Logan's brand colors */
--bg-base: oklch(0.14 0.005 260);   /* near-black */
--bg-elevated: oklch(0.19 0.006 260);
--border-hairline: oklch(1 0 0 / 0.08);
--accent: <brand color 1>;

/* motion (Linear baseline) */
--dur-fast: 100ms; --dur-base: 160ms; --dur-slow: 400ms;
--ease-spring: cubic-bezier(0.2, 0, 0, 1);
```

## 7. Open questions

- Figma MCP is unauthenticated in this session — after Logan authenticates, we need to decide whether to move real kinso.ai/Superhuman screens into Figma and extract tokens precisely.
- The shadcn `--base Radix vs Base UI` choice: the default flipped in 2026-07 (to Base UI) so recently that ecosystem maturity may be low — re-check at project kickoff.
- The maturity of Tauri `window-vibrancy`'s actual macOS 26 Liquid Glass API (`apply_liquid_glass`, `NSGlassEffectViewStyle`) may be unstable, at the "in progress as of 2026-09" level — implement the fallback (CSS blur) alongside it during the PoC to hedge the risk.
- The Notion Mail shutdown is only one case of "agents replace the inbox UI" — whether omnis should instead invest in building a good "UI for humans to look at" needs separate validation (user research).
- Sound/haptics: required by the brief, but this research did not cover sound design references (e.g. macOS system sound policy) — separate research needed.

## 8. Sources

- [Apple Newsroom — Apple introduces a delightful and elegant new software design](https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/) (2026-09-20)
- [WWDC25 #323 — Build a SwiftUI app with the new design](https://developer.apple.com/videos/play/wwdc2025/323/) (2026-09-20)
- [WWDC25 #310 — Build an AppKit app with the new design](https://developer.apple.com/videos/play/wwdc2025/310/) (2026-09-20)
- [WWDC25 #356 — Get to know the new design system](https://developer.apple.com/videos/play/wwdc2025/356/) (2026-09-20)
- [Superhuman Blog — How to build a remarkable command palette](https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/) (2026-09-20)
- [Superhuman Help Center — Speed Up With Shortcuts](https://help.superhuman.com/hc/en-us/articles/45191759067411-Speed-Up-With-Shortcuts) (2026-09-20)
- [DesignMD — Linear design tokens](https://www.designmd.co/d/linear.app) (2026-09-20)
- [shadcn.io — Raycast design system](https://www.shadcn.io/design/raycast) (2026-09-20)
- [Blake Crosley — Arc Browser: Reimagining the Browser Chrome](https://blakecrosley.com/guides/design/arc) (2026-09-20)
- [Pratt IXD — Design Critique: Things 3](https://ixd.prattsi.org/2020/02/design-critique-things-3-ios-app/) (2026-09-20)
- [Notion Help Center — Notion Mail inbox is going away](https://www.notion.com/help/notion-mail-inbox-is-going-away-what-to-do-next) (2026-09-20)
- [Kinso.ai](https://www.kinso.ai/) (2026-09-20)
- [thisandthat.chat — Kinso Review 2026](https://www.thisandthat.chat/blog/kinso-review/) (2026-09-20)
- [Pretendard GitHub README](https://github.com/orioncactus/pretendard/blob/main/packages/pretendard/docs/en/README.md) (2026-09-20)
- [Tailwind CSS v4.0 official blog](https://tailwindcss.com/blog/tailwindcss-v4) (2026-09-20)
- [shadcn/ui — Tailwind v4 docs](https://ui.shadcn.com/docs/tailwind-v4) (2026-09-20)
- [shadcn/ui — changelog](https://ui.shadcn.com/docs/changelog) (2026-09-20)
- [shadcn/ui — MCP server docs](https://ui.shadcn.com/docs/mcp) (2026-09-20)
- [tauri-apps/window-vibrancy GitHub](https://github.com/tauri-apps/window-vibrancy) (2026-09-20)
- [Eddyter — Lexical vs TipTap 2026](https://eddyter.com/blogs/lexical-vs-tiptap-2026) (2026-09-20)
- [TanStack Virtual official docs](https://tanstack.com/virtual/latest/docs/introduction) (2026-09-20)
