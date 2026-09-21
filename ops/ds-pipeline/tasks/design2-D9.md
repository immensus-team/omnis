# D9 (design wave 2 — Apple Mail-informed monotone glass)

Worktree: /Users/logankim/AI-Workspaces/omnis.plan-design-w2 (branch plan/design-w2, created from main after the design wave D1–D6 merged). Per-branch DB: omnis_test_design_w2. Desktop dev server: `pnpm --filter @omnis/desktop dev`; seeded screens via tools/e2e (run.ts / seed.ts / shots.ts / shots-responsive.ts). Project skills in .claude/skills load via the Skill tool.

AUTHORITY: docs/design/DESIGN-DIRECTION-v3.md (copy it into the repo from /Users/logankim/AI-Workspaces/Claude/omnis/design/DESIGN-DIRECTION-v3.md if not present, together with DIRECTION-V3-BRIEF-fable.md as docs/design/DIRECTION-V3-BRIEF.md, and apply its section a. amendments to DESIGN-DIRECTION.md / ACCENT-DIRECTION.md in your first commit). Read sections a–c and e in full before starting; the Apple Mail reference screenshots it cites live in /Users/logankim/AI-Workspaces/Claude/omnis/design/apple-mail-ios/ (Read the cited file numbers). Hard rules: monotone paper canvas (no grid), glass only on chrome, aurora only where ACCENT-DIRECTION allows, English only, reduced-motion respected, no horizontal overflow at 390/768/1024/1440, no new dependencies unless already in package.json.

## Task spec (verbatim from DESIGN-DIRECTION-v3.md §d)
### D9 — Detail view, sheets, popovers, inline confirmations

Files: `packages/ui/src/components/sheet.tsx` (new), `packages/ui/src/components/confirm-prompt.tsx` (new), `packages/ui/src/index.ts`, `apps/desktop/src/screens/Thread.tsx`, `apps/desktop/src/screens/Inbox.tsx`, `apps/desktop/src/app.css`.

1. `Sheet` + `SheetGroup` (§c.6), with swipe-to-dismiss on the shared primitive.
2. `ConfirmPrompt` (§c.8).
3. Detail header block, subject, body scale, attachment cards, inline approval/tool-call placement (§c.5).
4. Desktop sticky glass toolbar + `<900` floating action bar.
5. Popover grammar extended to the contextual menu (§c.7); wire the row's `…` menu to it.
6. Wire the filters icon button to a `Sheet`, and Approve / bulk Archive to `ConfirmPrompt`.

Acceptance screenshots: **1440** — thread open with the sticky toolbar and an inline approval card; the contextual popover open over a row. **390** — thread with the floating action bar; the Filters sheet open; `"Archive 3 threads?"` prompt open.
Reviewer checks:
- [ ] `Sheet`, popover and action bar are all `.glass-surface`; none declares its own `background` (ACCENT §4.4).
- [ ] No `.glass-surface` is nested inside another `.glass-surface`. Inspect the DOM, not the source.
- [ ] The approval card and tool-call badges are `OpaqueSurface` in the body flow, in document order — not a separate column, not glass.
- [ ] Sheet: Escape closes it, focus returns to the filters button, focus is trapped while open.
- [ ] Every swipe action on a row also appears in that row's `…` popover.
- [ ] `prefers-reduced-motion`: the sheet appears without sliding; the prompt without scaling.
- [ ] `prefers-reduced-transparency`: sheet and popover are flat `--bg-sheet` / `--bg-elevated` and still legible.
- [ ] Detail body measures 15px at 1440 and 17px at 390, `line-height` 1.5 at both.

---



## Anti-slop guards (reviewer rejects on any one)
## e. Anti-slop guards — any one is a reject

These add to ACCENT §5.3's seven guards and `SKILLS.md`'s twelve. They do not replace either.

1. **No pattern on the canvas.** No grid, no dots, no noise beyond the 3.5% film grain, no tinted wash, no "subtle" radial. If you can point at the background and describe a shape, it fails.
2. **One blue.** A second hue used for emphasis — a purple "AI" tint, a green "done" chip that is not `--success-500`, a category-coloured chip row (Mail tints its categories; **we do not**, our accent is one colour) — is a reject.
3. **Hairlines are inset and faint.** A full-bleed row divider, or ink above 8%, turns the list into a table. Both are rejects.
4. **Glass is chrome only.** The canvas, list rows, message bodies, approval cards, attachment cards and every input stay opaque. A glass card inside a glass sheet is a reject (ACCENT §4.4).
5. **Nothing bounces for decoration.** Springs exist for direct manipulation — a drag settling, a sheet arriving, a row collapsing. A hover that scales, a card that fades up on mount, a chip that springs when selected: rejects.
6. **No new dependency.** `motion`, `framer-motion`, `dnd-kit`, a headless-UI kit, an icon pack beyond `lucide-react` / `react-icons` — reject. The primitives in §c.1 and Radix Popover are what exist.
7. **Chips are pills, not tabs.** No underline indicator, no bottom border, no segmented-control frame around the chip row. The active chip is a filled pill and nothing else (M100, M135).
8. **The AI summary survives.** Mail shows two lines of raw body preview; omnis shows one line of AI summary. A row that reverts to body preview has lost the product, not gained fidelity.
9. **Icon-only means labelled.** Every icon-only control carries an `aria-label` that does not depend on visible text. An icon button whose accessible name disappears with its label at a breakpoint is a reject.
10. **Every gesture has a non-gesture twin.** Swipe, long-press and drag must each have a keyboard or menu equivalent. A touch-only affordance is a reject.
11. **No fake depth.** One shadow per floating element, from `--shadow-glass` or `--shadow-row-selected`. No coloured shadow, no glow, no second ring, no border *and* shadow *and* inset highlight on the same edge.
12. **Copy stays plain.** Titles are the question or the noun (`"Filters"`, `"Archive 3 threads?"`). No em-dash subtitles, no "Manage your…", no sentence that explains the button below it.

