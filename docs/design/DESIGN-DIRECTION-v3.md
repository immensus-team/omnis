# omnis design direction v3 — Apple Mail-informed, monotone glass

Status: implementable spec. Source: `DIRECTION-V3-BRIEF-fable.md` (Fable, 2026-09-21) → structured here (Opus) → implemented by DeepSeek as design-wave tasks **D7, D8, D9** → Opus verifies.

Repo: `/Users/logankim/AI-Workspaces/omnis.plan-design-w1`, branch `plan/design-w1`.
Evidence: `apple-mail-ios/Apple Mail ios Feb 2026<n>.png` — cited below as **M<n>**. Glass recipe reference: `ref-glass-sidebar.png`.

**Prerequisite: D6 must land first.** `ACCENT-DIRECTION.md` is not implemented on this branch — `packages/ui/src/tokens.css` still carries hue-260 neutrals, the peach/mint canvas radials and `--ask-gradient`, and `aurora-surface.tsx` does not exist. D7–D9 assume D6's tokens. Do not start D8 before D6 step 1 is reviewed.

**Two dependency facts, verified, that this spec is built on:**
- ~~`motion` / `framer-motion` / `dnd-kit` are **not installed** … Reorder and swipe are Pointer Events + FLIP, one shared primitive (§c.1), no new dependency.~~ **Superseded on 2026-09-21 by the motion-OSS wave — see §c.1.1.** At the time this spec was written none of them was installed and the brief's Reorder branch did not apply. Logan then asked for the hand-rolled physics to be replaced with battle-tested open-source motion, and five libraries are now installed (`motion@13.4.0`, `vaul@1.1.2`, `@use-gesture/react@10.3.1`, `@formkit/auto-animate@0.10.0`, `sonner@2.0.8` — all MIT). Guard 6 in §e is amended with them. §c.1's `pointer-drag.ts` survives as the **gesture** primitive; what the wave changes is the **animation** layer around it, not the gesture gates.
- The Agents mascot is **already wired** (`row-meta.ts:5-6,59` → `CHANNEL_BRAND_ASSET.agent` → `ChannelGlyph`, commit `87e2688`). D7 verifies it renders at 1x/2x; it does not re-do it.

One sentence for the whole thing: **the canvas is plain paper, the chrome is glass that floats above it, and the only colour on either is one blue.**

---

## a. What this supersedes — amend these files in the same commit

### a.1 `docs/design/DESIGN-DIRECTION.md`

| Rule today | v3 | Why |
|---|---|---|
| L6 "warm off-white canvas, subtle grid/gradient background" | **Plain paper. No grid, no gradient, no pattern.** `--canvas-grid: none` in both themes. The film grain (`.app-shell::before`, ACCENT §1.3) stays at 3.5%. | Brief §1. D6's §0 amendment already rewrites this line for the radials; v3 removes the grid too. Write one combined line (§a.3). |
| L9 "**No hairlines**, generous row height" | **Hairlines allowed in lists**, at ≤ 8% ink, inset to the text column. | Brief §4. M100, M135, M143 — Mail divides rows with an inset hairline, not padding alone. |
| L9 "only the selected row elevates into a white card + soft shadow" | Unchanged on desktop. **In the `<900` tier the selected row is a flat tint, no shadow** — a lifted card under a floating bar reads as two stacked sheets. | M143: touch rows are flat. |
| L10 "filter pills sit **small on the right side of the header**" | **A full-width horizontally scrolling category-chip row under a large title + grey subline.** | Brief §3. M100, M135, M15. |
| L25 "Liquid Glass only on sidebar/toolbar/sheet/palette/floating panels" | Unchanged, plus two new members of that set: the **mobile bottom bar** and the **detail action bar**. Both are toolbars. | M100 bottom bar, M103 action bar. |
| Radius scale | Add **`16px` — grouped cards inside a sheet** (M125, M115). Everything else unchanged. Update the table in the same commit. | New surface, no existing value fits between 20 and 12. |

### a.2 `ACCENT-DIRECTION.md` — one rule changes, explicitly

**§1.4 and §5.3 guard 6 said `--accent` is graphite. v3 makes it blue.** Logan's 2026-09-21 v3 brief §8 is newer and explicit ("one accent (blue, only for active/selected/links/primary button)"), and the reference is Apple Mail, whose entire selection grammar is one blue. Record the change in `ACCENT-DIRECTION.md` §1.4 and guard 6 in the same commit as D8.

What survives unchanged, and is **not** negotiable:
- The **structural** rule behind guard 6: exactly **one** accent hue. Semantic colour stays `--danger-500` / `--warn-500` / `--success-500` plus brand PNGs. A fourth coloured UI token is still a reject.
- **Every layering and glass rule** — ACCENT §2.3 (the one `.aurora` recipe), §2.7 (`.aurora` and `.glass-surface` are never the same element), §2.8 (aurora on fixed-size non-scrolling boxes only, ≤ 3 mounted), §4.1 (aurora on exactly three surfaces), §4.2 (forbidden everywhere else), §4.4 (the glass recipe, 70–78% tint, `blur(24px) saturate(1.4)`, chroma-free tint, one outer shadow). v3 adds glass surfaces; it does not change the recipe.
- ACCENT §1.4's regression fixes for rows **7, 9, 11, 13** (draft summary, `status-pill[info]`, filter-chip fill, agent/system glyph). They were written against graphite but are correct against blue too: a draft is not "selected", and an `info` pill in the selection blue is indistinguishable from a selected one.

The **one** ACCENT fix that v3 drops: **§1.4 row 8**, the underline on `.thread-screen__archived-banner button`. Blue text on paper is now a sufficient link affordance — that is exactly Mail's "Unsubscribe" (M120, M112). Delete the `text-decoration: underline` requirement from §1.4; leave the button as `color: var(--accent)`.

### a.3 The combined DESIGN-DIRECTION.md line 6 replacement

Supersedes D6's §0 text. Use this, not that one:

```
- **라이트 테마 기본**(플레인 페이퍼 캔버스 + 필름 그레인 3.5%; 그리드와 피치/민트 그라데이션 워시는
  2026-09-21 모노톤 지시로 모두 폐기 — 색은 ACCENT-DIRECTION.md의 aurora 표면 3곳과
  단일 블루 액센트에만). 다크는 옵션이며 A5의 "다크 우선"은 폐기한다.
```

---

## b. Tokens — exact values

All edits are to `packages/ui/src/tokens.css` `:root` unless marked. Everything not listed here is unchanged from D6.

### b.1 Accent → blue (replaces ACCENT §1.4's `--ink-500/600`)

```css
--accent-600: oklch(0.48 0.18 255);   /* light theme. 4.8:1 on --bg-canvas; white on it is 4.8:1 */
--accent-500: oklch(0.72 0.14 255);   /* dark theme */
```

`:root { --accent: var(--accent-600); }` · `:root[data-theme="dark"] { --accent: var(--accent-500); }`. `--accent-fg` stays paper / near-black per D6.

L 0.48 is the ceiling: above it, white text on an accent-filled chip drops below 4.5:1. Do not raise it to match `#007AFF` — Apple's blue is ~3.6:1 and we carry label text on ours. Verify gamut with `getComputedStyle` before committing; if the browser clamps, lower chroma to 0.16, never raise L.

### b.2 Canvas — plain paper

```css
--canvas-grid: none;
--canvas-grid-size: auto;
```

`apps/desktop/src/app.css` `body { background-repeat: repeat; }` (currently a stale 4-value list, `app.css:37`). The `.app-shell::before` grain from ACCENT §1.3 is the *only* thing on the canvas.

### b.3 New tokens

```css
/* Hairlines in lists. ≤ 8% ink — the DESIGN-DIRECTION amendment's ceiling. */
--border-row: 1px solid oklch(0.2 0.004 80 / 0.07);
/* The inset from the row's left edge to where a list hairline starts = the text column origin. */
--row-rule-inset: 68px;          /* 40px avatar + 12px gap + 16px padding */

/* Chips (Mail category pills). */
--chip-bg: oklch(0.93 0.003 80);
--chip-h: 32px;

/* Sheets: grey field, white grouped cards on it. */
--bg-sheet: oklch(0.955 0.003 80);
--radius-group: 16px;

/* Floating bars and toolbars. */
--bar-h: 52px;
--bar-gap: 12px;                 /* distance from the bar to the viewport edge */

/* Motion. The two new springs; the existing --dur-* / --ease-spring are unchanged. */
--ease-settle: cubic-bezier(0.22, 1, 0.36, 1);   /* drop / settle after a drag */
--dur-reorder: 220ms;            /* neighbour displacement during a reorder */
--dur-swipe: 200ms;              /* swipe open / close */
```

Under `@media (prefers-reduced-motion: reduce)` add `--dur-reorder: 0ms; --dur-swipe: 0ms;` to the existing block (`tokens.css:86-93`).

### b.4 Type scale for the new surfaces

| Role | Desktop | `<900` tier | Weight / colour |
|---|---|---|---|
| Screen title ("Inbox") | 28px / 1.15 | 32px | 700, `--text-primary` |
| Subline ("Updated just now · 12 unread") | 13px | 13px | 400, `--text-secondary` |
| Chip label | 13px | 14px | 500 |
| Row sender / title | 15px | 16px | 600 unread, 500 read |
| Row AI summary | 13px | 14px | 400, `--text-secondary` |
| Row time | 12px tabular | 13px | 400, `--text-tertiary` |
| Detail subject | 24px / 1.25 | 26px | 700 |
| Detail body | 15px / 1.5 | 17px / 1.5 | 400 |
| Sheet / popover row | 15px | 17px | 400 |

`font-variant-numeric: tabular-nums` on every time and count.

---

## c. Component specs

### c.1 `packages/ui/src/lib/pointer-drag.ts` — the one drag primitive (new)

Built once in D7, consumed by the rail reorder (D7) and the row swipe (D8). No second drag implementation may appear.

```ts
export interface DragHandlers {
  onStart(): void;
  onMove(dx: number, dy: number): void;
  onEnd(dx: number, dy: number): void;
  onCancel(): void;
}
/** Binds one pointer to an element. Returns the onPointerDown handler.
 *  - setPointerCapture on down, so the drag survives leaving the element.
 *  - holdMs > 0 arms a long-press timer that any movement > 8px before it fires cancels
 *    (touch: rail reorder uses 350ms; mouse and swipe use 0).
 *  - Ignores button !== 0 and pointerType "pen" with no primary contact.
 *  - Always releases capture and clears the timer in onPointerUp/Cancel — including on unmount.
 */
export function pointerDrag(h: DragHandlers, opts?: { holdMs?: number; axis?: "x" | "y" }): (e: React.PointerEvent) => void;
```

FLIP, in both consumers: on commit, read every sibling's `getBoundingClientRect()` **before** the DOM change (First), apply the change (Last), set `transform: translate(Δ)` with no transition (Invert), then on the next frame clear the transform with `transition: transform var(--dur-reorder) var(--ease-settle)` (Play). Under reduced motion the duration is 0ms and the whole thing lands instantly — no separate branch.

#### c.1.1 What the motion-OSS wave replaced, and the line it drew

Added 2026-09-21. The wave's rule, derived from the evidence below and applied to every slice since:

> **`motion` owns the animation layer. `pointer-drag.ts` keeps the gesture layer.**

That line is not a preference, it is what the harness can verify. The animation layer is React-level — `AnimatePresence`, `LayoutGroup`, `layout`, springs, `MotionConfig` — and a unit test drives it by rendering and asserting the DOM. The gesture layer is layout- and pointer-level, and jsdom has no layout: `getBoundingClientRect()` returns zeroes for every element and hit-testing does not exist. A gesture that a test cannot drive is a gesture whose regressions no test can catch.

**Replaced:** the per-surface JS exit holds (`useClosingSpring` held a node in the DOM for `PANEL_MS`/`LEAVE_MS` so a CSS exit animation could finish — `AnimatePresence` does this natively and correctly, including the "never opened, so never animate out" rule that `useClosingSpring` hand-rolled); the CSS duration ladder as the *only* source of motion timing (now `TIER_MS`/`SPRING` in `lib/motion.ts` mirror it, guarded by a drift test); the mobile bottom sheet's hand-built drag-to-dismiss (now `vaul`); the hand-rolled flat list transitions (now `auto-animate`); and the "Archived · Undo" affordance, which had no toast at all (now `sonner`).

**Deliberately kept — the rail's reorder stays on `pointer-drag.ts` + FLIP, and this is the wave's one recorded non-port:**

The brief asked for `motion`'s `Reorder.Group`/`Reorder.Item` here. It was evaluated and not taken, for two measured reasons, not one:

1. **`Reorder`'s drag cannot be driven in jsdom, so the port trades verified behaviour for unverified behaviour.** Probed directly: a `Reorder.Group` of three items, with `getBoundingClientRect` stubbed to a real 44px/52px stacked column (the same stub `channel-rail.test.tsx` uses), driven by a full synthetic `pointerdown` → moves → `pointerup` gesture. Result: `onReorder` fired **zero** times and the dragged item's inline style stayed `transform: none`. Repeated with the moves dispatched on `window` rather than the item, in case the binding target was the issue — same result. `Reorder`'s drag depends on layout, which jsdom does not have. In a real browser it would very likely work; the point is that the 13 tests that today pin the rail's reorder — the slot-crossing compensation, Escape-revert, click suppression, the 350ms hold, the scroll-vs-lift disambiguation — could not follow it there.
2. **`Reorder` does not cover the parts that are actually hard.** It replaces the FLIP (~60 lines). It does not replace the gesture gates: the mouse 6px slop, the touch 350ms hold with its 8px abandon, the scroll-vs-drag disambiguation, Escape-cancel-and-revert, or click suppression after a drop. Those are ~70 lines in `pointer-drag.ts`, and porting means re-implementing them around `dragControls.start(event)`, including calling it 350ms after the press with a retained event. Net: comparable code, on a strictly worse verification footing. It also cannot delete `pointer-drag.ts`, which the D8 row swipe still needs.

Reason 2 alone would be arguable. Reason 1 is decisive, and it is the one that generalises: **a gesture primitive this repo owns and tests beats a library's gesture it cannot.** That is also why `@use-gesture/react`'s `useDrag` is not used for the rail or the row swipe — its `useGesture`-level velocity and rubber-band maths are used where the *maths* is the point and is unit-testable in isolation (`lib/detail-pane.ts`), not as a replacement for the pointer gates.

If a future wave wants `Reorder` here, the prerequisite is a browser-driven test (Playwright) that drives the drag for real, so the behaviour has somewhere to be verified. `tools/e2e/` is where that would live.

### c.2 Rail — `channel-rail.tsx` + `app.css:61-191`

Layout, tiles, breakpoint (`NARROW_RAIL_QUERY`, 899.98px) and the More popover are unchanged. What D7 adds:

- **Order.** `tiles` becomes `applyOrder(tiles, readRailOrder())`. `applyOrder` keeps stored ids in stored order, appends any channel not in the stored list (a newly connected account) at the end, and drops ids no longer present. The Inbox tile is outside the plate and is **never** reorderable; Agents is (it is a normal tile in `tiles`).
- **Storage.** New `packages/ui/src/lib/rail-order.ts`, modelled exactly on `lib/ask-model.ts` (same try/catch-and-ignore shape, same one-key-one-value scope). Key `omnis.rail-order`, value a JSON `UiChannel[]`. **Assumption, stated:** the hub has no settings HTTP route (`packages/kernel/src/settings.ts` is pool-only and `SettingKey` has no `ui.*` member), and adding one is backend work outside a design wave. localStorage is the store; when a settings route exists, this file is the single place that moves to `ui.rail_order`. Put that sentence in the file header.
- **Drag.** Mouse: press and move > 6px starts it. Touch: `holdMs: 350`, and on start the tile does `transform: scale(1.08)` over `--dur-fast` — the haptic-like lift (M145 is the reorder affordance; our grab handle is the tile itself, since a 44px icon tile has no room for a separate `≡`).
- **Flow.** The lifted tile follows the pointer on `transform` only (`z-index: 1`, `--shadow-glass`, no layout change). Every other tile animates to its new slot per §c.1. Axis is `"y"` in the wide rail, `"x"` in the bottom bar.
- **Drop.** Clear the transform, write the order, `--dur-reorder` settle. Cancel (Escape, pointercancel) returns it to its original slot on the same spring.
- **A11y.** The tiles are already `<button>`s. Add `aria-roledescription="reorderable"` and keyboard reorder: `Ctrl+ArrowUp/Down` (wide) / `Ctrl+ArrowLeft/Right` (bar) moves the focused tile one slot and announces via an `aria-live="polite"` region (`"Slack moved to position 3 of 6"`). Keyboard reorder writes the same store. A drag-only reorder is not accessible and is a D7 reject.
- **Mascot.** Already wired. Verify only: at 1440 the Agents tile shows `agent@2x.png` on a 2x display and is not double-framed (`ChannelGlyph` draws the PNG bare, `channel-glyph.tsx:11-26`).

### c.3 InboxHeader + CategoryChips — `Inbox.tsx:507-556`, `app.css:591-712`

M100 / M135 are the spec. M15 is the active-chip behaviour.

```
┌ .inbox-card__header ────────────────────────────┐
│ Inbox                                    28/700 │
│ Gmail · Updated just now · 12 unread     13/sec │
└─────────────────────────────────────────────────┘
┌ .inbox-card__filter-row  (unchanged scroller) ──┐
│ (◉ All) (🛒Work) (💬Personal) (🤖Agents) (…)  ⧉ ⊕│
└─────────────────────────────────────────────────┘
```

- `.inbox-card__header` padding becomes `20px 16px 4px`. The `<h2>` keeps its class; add the subline as `.inbox-card__subline` (a `<p>`, 13px, `--text-secondary`), composed as `channel · "Updated just now" · "N unread"`, dropping empty segments. Never render the separator with no segment after it.
- **Chips** replace `.inbox-card__pills button`'s 11px hairline pills. Each chip: `height: var(--chip-h)`, `border-radius: 999px`, `padding: 0 14px`, `border: 0`, `background: var(--chip-bg)`, `color: var(--text-secondary)`, icon 16px + 13px/500 label, `gap: 6px`.
  Active: `background: var(--accent); color: var(--accent-fg);` and nothing else — no border, no shadow, no scale.
  The `aria-checked` radiogroup semantics at `Inbox.tsx:525` are unchanged.
- **`@container list (max-width: 559.98px)`** — replaces the current icon-swap block for the chips: **inactive chips go icon-only (`padding: 0 10px`, label `display: none`), the active chip keeps its label** (M15 exactly). This is why the chip must carry an icon at every width; the `aria-label` is the accessible name either way, so the name never collapses.
- **Archived** and **+ Label** become 32px circular icon buttons at the row's end: `border-radius: 50%; background: var(--chip-bg); border: 0`. `Archived` pressed = accent fill. Delete `.inbox-card__archived-label` and the `@container` block that hides it — it is icon-only at every width now. Keep `aria-pressed` and the `title`.
- Focus: the existing `outline: 2px solid var(--accent); outline-offset: 1px` block (`app.css:690-696`) covers the new shapes unchanged. Extend the selector list to the two icon buttons.

### c.4 InboxRow — `inbox-row.tsx`, `app.css:713-971`

The kinso grid (`40px minmax(0,1fr) auto`, two rows) is kept. Changes:

- **Hairline.** `.inbox-row { border-bottom: var(--border-row); }` drawn inset: use `background-image: linear-gradient(...)` no — use a `::after` at `left: var(--row-rule-inset); right: 16px; bottom: 0; height: 1px; background: oklch(0.2 0.004 80 / 0.07)`. `:last-child::after { display: none }`. The inset is what makes it read as Mail (M100, M143) rather than as a table.
- **Unread dot** moves from beside the name (`inbox-row.tsx`, `.inbox-row__unread-dot`) to a **left gutter**: grid becomes `10px 40px minmax(0,1fr) auto`, dot 8px, `background: var(--accent)`, vertically centred across both rows. The bold name stays — the dot is never the only signal (ACCENT §1.4 row 6).
- **Avatar** 40px, `border-radius: 10px` for brand/runtime tiles (M100's app tiles are squircles, not circles) and `50%` for people (M143). `RowAvatarView` already branches on `avatar.kind`; add the radius there.
- **Summary** stays the one-line AI summary — this is the kinso keep, not Mail's two-line body preview. `-webkit-line-clamp: 2` on desktop, 1 below 479.98px (unchanged).
- **Selected.** Desktop keeps `.inbox-row--selected`'s white card + `--shadow-row-selected`. In `@container shell (max-width: 899.98px)` override to `background: var(--state-hover); box-shadow: none; border-radius: 0` and keep the hairline.
- **Hover actions (desktop)** unchanged (`.inbox-row__action`).
- **Swipe (touch, `<900` only).** M167 is the spec: the row content translates left inside its own box; behind it, right-aligned, a 56px circular button per action with a 11px caption beneath. Actions: left-swipe → **Archive** (`--accent`) and **More** (`--chip-bg`); right-swipe → **Snooze** (`--warn-500`). Threshold 88px commits on release; below it, spring back over `--dur-swipe`. Uses `pointerDrag({ axis: "x" })`. One row open at a time — opening a second closes the first. Delete the `.inbox-row__action { display: none }` rule in the `<900` block and replace its comment: archiving from touch now has a gesture. Every swipe action must also exist in the row's contextual menu, or it is unreachable for keyboard users.
- **Archive animation.** On commit the row animates `height` to 0 + `opacity` to 0 over `--dur-base`, then unmounts. In `react-virtuoso` do this on the row's inner wrapper, never on the Virtuoso item itself.

### c.5 DetailView + ActionBar — `Thread.tsx`, `app.css:972-1011`

M103 (toolbars), M105 / M112 (header block), M120 (inline confirm).

- **Header block**, above the subject: 40px sender avatar, name 15px/600, `To: me` 13px `--text-secondary` on the next line, date 12px `--text-tertiary` right-aligned to the first line. One hairline below the block, full-bleed inside the pane's padding.
- **Subject** is the title: 24px/700/1.25, `margin: 16px 0 12px`.
- **Body** 15px/1.5 desktop, 17px/1.5 in the `<900` tier. `max-width: 68ch`. Existing `.thread-screen__item p` inherits.
- **Attachments** as cards: `border-radius: 12px; background: var(--bg-elevated); border: 0; padding: 12px` — icon + filename 13px/500 + size 12px tertiary. Never a glass surface (ACCENT §4.4 "opaque cards, not more glass").
- **Approvals and tool calls render inline in the body flow**, in document order, as `OpaqueSurface` at `--radius-group`. They are not a card wall and not a separate column. `ApprovalCard` / `ToolCallBadge` keep their components; only their container changes.
- **Desktop toolbar** — a compact glass bar at the top of the detail pane: `GlassSurface slot="toolbar"`, `height: 40px`, `border-radius: 999px`, icon buttons `reply · archive · more`, right-aligned, sitting over the scrolling body (`position: sticky; top: 8px; z-index: 2`).
- **`<900` action bar** — M103: a floating `GlassSurface slot="toolbar"` pinned `bottom: var(--bar-gap)`, `height: var(--bar-h)`, `border-radius: 999px`, holding `archive · move · reply` as 44px icon buttons, with a **separate** 52px circular glass compose button to its right. Two capsules, not one — that separation is the Mail grammar (M103, M143). The bar and the compose button share one `--shadow-glass`; per ACCENT §4.4 only one element carries the outer shadow, so put it on each capsule and nothing on their contents.

### c.6 Sheet — new `packages/ui/src/components/sheet.tsx`

M125 (Filters) and M115 (grouped menu) are the spec. One component; both are callers.

```tsx
<Sheet open onOpenChange title="Filters" confirm={{ label: "Done", onConfirm }}>
  <SheetGroup label="Include">…</SheetGroup>
</Sheet>
```

- Container: `GlassSurface slot="sheet"`, `background: var(--bg-sheet)` is **wrong** — the sheet field is glass (M125's field shows the list through it). Keep `.glass-surface`'s `--bg-overlay`; `--bg-sheet` is for the *reduced-transparency* fallback only, set inside the existing `prefers-reduced-transparency` block.
- Radius 20px top corners, `bottom: 0`, full width in the `<900` tier; a centred `min(480px, 100%)` card with all four corners at 20px above it.
- Header: 44px, centred title 15px/600, a 32px circular filled `--accent` confirm button at the right (M125), a 32px circular `--chip-bg` ✕ at the left when there is no confirm (M105).
- `SheetGroup`: grey label 13px `--text-secondary` above a white card — `background: var(--bg-base); border-radius: var(--radius-group); border: 0; box-shadow: none`. Rows 48px, separated by `--border-row` inset to the label column, last row no rule. Right slot holds a `--accent` checkmark, a native `<input type="checkbox" switch>`-style toggle, a count, or a `>` chevron.
- Motion: slides up from `translateY(100%)` over `--dur-panel` on `--ease-spring`; backdrop `oklch(0 0 0 / 0.18)` cross-fades over `--dur-base`. Dismiss on backdrop click, Escape, and a downward swipe past 96px (reuse `pointerDrag`, `axis: "y"`).
- A11y: `role="dialog"`, `aria-modal="true"`, focus trapped, focus returns to the trigger on close.

### c.7 Popover / contextual menu — extend `.channel-rail__popover`'s grammar

M160 (Remind Me) and M115. Do **not** add a new floating-panel library: Radix Popover + `.glass-surface` is already the grammar in two files.

- `border-radius: 12px` (floating-surface radius), `min-width: 240px`, `padding: 6px`.
- Optional grey section label, 12px `--text-secondary`, `padding: 6px 10px 2px`.
- Rows: 40px, `padding: 8px 10px`, `border-radius: 8px`, label left 15px, **icon right** 18px `--text-secondary` (M115's icon-trailing layout, not leading). No separators between rows in a single group; groups are separated by 6px of gap, never a rule.
- Destructive rows use `color: var(--danger-500)` for both label and icon (M115 "Block Contact", M95 "Delete Draft").
- Hover `background: var(--state-hover)`. Never a colour.

### c.8 Inline confirmation — new `packages/ui/src/components/confirm-prompt.tsx`

M120 is the spec, and it is a *prompt*, not a sheet: a small centred glass card over a dimmed backdrop.

- `min(320px, calc(100% - 48px))`, `border-radius: 20px`, `GlassSurface slot="sheet"`, `padding: 20px 16px 16px`.
- Title 15px/600 centred, body 13px `--text-secondary` centred, `max-width: 40ch`.
- Two pill buttons side by side, `flex: 1 1 0`, `height: 44px`, `border-radius: 999px`: cancel `background: var(--chip-bg); color: var(--text-primary)`, confirm `background: var(--accent); color: var(--accent-fg)`. Destructive confirm swaps to `--danger-500`. When either label exceeds the half-width, stack them (M112) with the confirm on top.
- omnis copy: `"Approve this action?"`, `"Archive 3 threads?"`, `"Unsubscribe from this sender?"`. The title is the whole question; the body says what happens, never why.

### c.9 BottomBar — new, `<900` tier only

M100 / M135 / M143. Three pieces on one line, `position: fixed; bottom: var(--bar-gap); left/right: var(--bar-gap); gap: 8px`:

1. 44px circular glass button — filters (the `≡` glyph), opens `Sheet`.
2. A flexible glass Search pill, `height: var(--bar-h)`, `border-radius: 999px`, magnifier left, placeholder 15px `--text-tertiary`. This is `CommandPalette mode="inline"` relocated — it is the ask bar, not a second search field. Its own `.ask-bar` styling stays; only its position changes.
3. 52px circular glass compose button.

The channel rail also lives at the bottom in this tier (`app.css:1918-1960`). **They do not stack into two bars.** The rail bar sits at `bottom: 0`, height 56px, full-bleed with a top hairline (as today); the BottomBar floats above it at `bottom: calc(56px + var(--bar-gap))`. `.app-shell__main` bottom padding goes from 72px to `calc(56px + var(--bar-h) + var(--bar-gap) * 2)`.

---

## d. Three tasks for DeepSeek

Each task: one branch, one commit, screenshots at **1440×900 and 390×844** (brief), plus the standing `SKILLS.md` item-11 overflow gate at **320 / 375 / 414 / 768** (overflow check only, no screenshots needed). Capture with `chrome-devtools-mcp` against the Vite dev server. Light theme only — dark is a non-goal for v3.

### D7 — Rail reorder, mascot verification, fluid motion

Files: `packages/ui/src/lib/pointer-drag.ts` (new), `packages/ui/src/lib/rail-order.ts` (new), `packages/ui/src/components/channel-rail.tsx`, `packages/ui/src/index.ts`, `apps/desktop/src/app.css`, `packages/ui/test/channel-rail.test.tsx`.

1. `pointer-drag.ts` per §c.1. Unit test: a synthetic down→move→up sequence fires start/move/end once each, and a move before `holdMs` cancels.
2. `rail-order.ts` per §c.2, mirroring `ask-model.ts`. Unit test `applyOrder`: stored order respected; unknown id dropped; new channel appended.
3. Wire the drag into the rail, both axes, with the scale-up lift and the FLIP settle.
4. Keyboard reorder + `aria-live` announcement.
5. Verify the mascot renders (no code change expected).

Acceptance screenshots: **1440** — rail at rest; rail mid-drag with the Slack tile lifted between two others. **390** — bottom bar at rest; bottom bar mid-drag.
Reviewer checks:
- [ ] `grep -rn "framer-motion\|dnd-kit\|'motion'" apps packages | grep -v /dist/` returns nothing; no `package.json` gained a dependency.
- [ ] The lifted tile moves on `transform` only — `getComputedStyle` shows no change to `top`/`left`/`margin` during the drag.
- [ ] Neighbours animate; they do not jump. With `prefers-reduced-motion: reduce` emulated they *do* jump, instantly, and the final order is identical.
- [ ] Reload preserves the order. `localStorage.getItem("omnis.rail-order")` is a JSON array of channel ids.
- [ ] `Ctrl+ArrowDown` on a focused tile moves it and the live region announces the new position.
- [ ] Long-press on touch emulation starts the drag at ~350ms; a 20px move at 100ms scrolls instead and does not start it.
- [ ] The Inbox tile cannot be dragged and cannot be a drop target.

### D8 — Monotone glass canvas, Mail header / chips / rows / bottom bar

Files: `packages/ui/src/tokens.css`, `apps/desktop/src/app.css`, `apps/desktop/src/screens/Inbox.tsx`, `packages/ui/src/components/inbox-row.tsx`, `docs/design/DESIGN-DIRECTION.md`, `ACCENT-DIRECTION.md`.

1. §b tokens; the two doc amendments (§a.1, §a.2, §a.3) **in this commit**.
2. Canvas to plain paper; fix `background-repeat`.
3. Header + subline + category chips (§c.3), including the `<560` icon-only-except-active rule.
4. Row hairlines, unread gutter, avatar radii, `<900` selected-row override (§c.4).
5. Row swipe on touch + the archive height animation.
6. BottomBar (§c.9) and the two-bar stacking maths.

Acceptance screenshots: **1440** — inbox at rest, one row selected; inbox with a row hovered showing the Archive action. **390** — inbox with both bars; a row mid-swipe with Archive revealed; the chip row with `Agents` active showing icon-only inactive chips.
Reviewer checks:
- [ ] `grep -n "canvas-grid" packages/ui/src/tokens.css` shows `none` in both blocks. No grid is visible at 400% zoom on any screenshot.
- [ ] The rail plate still blurs what is behind it (ACCENT §5.2). Sample the plate: it is not a flat fill.
- [ ] Every hairline starts at `--row-rule-inset`, not at the row edge. Measure one in devtools.
- [ ] Hairline ink ≤ 8%: `getComputedStyle(row, '::after').background` alpha ≤ 0.08.
- [ ] Exactly one accent hue on screen. Sample every non-grey, non-brand-PNG pixel: it is `--accent`, `--danger-500`, `--warn-500` or `--success-500`.
- [ ] White label on the active chip measures ≥ 4.5:1.
- [ ] Both bars visible at 390 and not overlapping; the last row is fully scrollable above them.
- [ ] No horizontal scroll at 320 / 375 / 414 / 768 (`body.scrollWidth === clientWidth`).
- [ ] Swiping one row closes any other open row.
- [ ] Inbox scrolling at 1440 stays smooth — no aurora surface became a scroll container.

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

## e. Anti-slop guards — any one is a reject

These add to ACCENT §5.3's seven guards and `SKILLS.md`'s twelve. They do not replace either.

1. **No pattern on the canvas.** No grid, no dots, no noise beyond the 3.5% film grain, no tinted wash, no "subtle" radial. If you can point at the background and describe a shape, it fails.
2. **One blue.** A second hue used for emphasis — a purple "AI" tint, a green "done" chip that is not `--success-500`, a category-coloured chip row (Mail tints its categories; **we do not**, our accent is one colour) — is a reject.
3. **Hairlines are inset and faint.** A full-bleed row divider, or ink above 8%, turns the list into a table. Both are rejects.
4. **Glass is chrome only.** The canvas, list rows, message bodies, approval cards, attachment cards and every input stay opaque. A glass card inside a glass sheet is a reject (ACCENT §4.4).
5. **Nothing bounces for decoration.** Springs exist for direct manipulation — a drag settling, a sheet arriving, a row collapsing. A hover that scales, a card that fades up on mount, a chip that springs when selected: rejects.
6. **No unreviewed dependency.** *Amended 2026-09-21 by the motion-OSS wave.* The five vetted animation libraries are now **allowed** (§c.1.1): `motion`, `vaul`, `@use-gesture/react`, `@formkit/auto-animate`, `sonner`. Still a reject: `dnd-kit`, a headless-UI kit, an icon pack beyond `lucide-react` / `react-icons`, GSAP, react-spring, lenis, and component kits (Aceternity, Magic UI). The rule's intent is unchanged — a dependency earns its place by doing something the primitives do badly, and it is added one at a time, with its bundle cost measured. What guard 6 was protecting against was *unvetted* dependencies, not dependencies as such.
   *Why this one was worth breaking:* the hand-rolled motion was a CSS duration ladder plus one shared pointer primitive, and the parts that needed real engineering — a spring that settles, a layout transition where siblings flow around a lifted element, an exit that unmounts only when its animation ends — were being re-derived per surface. §c.1.1 records what was actually replaced and what was deliberately kept.
7. **Chips are pills, not tabs.** No underline indicator, no bottom border, no segmented-control frame around the chip row. The active chip is a filled pill and nothing else (M100, M135).
8. **The AI summary survives.** Mail shows two lines of raw body preview; omnis shows one line of AI summary. A row that reverts to body preview has lost the product, not gained fidelity.
9. **Icon-only means labelled.** Every icon-only control carries an `aria-label` that does not depend on visible text. An icon button whose accessible name disappears with its label at a breakpoint is a reject.
10. **Every gesture has a non-gesture twin.** Swipe, long-press and drag must each have a keyboard or menu equivalent. A touch-only affordance is a reject.
11. **No fake depth.** One shadow per floating element, from `--shadow-glass` or `--shadow-row-selected`. No coloured shadow, no glow, no second ring, no border *and* shadow *and* inset highlight on the same edge.
12. **Copy stays plain.** Titles are the question or the noun (`"Filters"`, `"Archive 3 threads?"`). No em-dash subtitles, no "Manage your…", no sentence that explains the button below it.
