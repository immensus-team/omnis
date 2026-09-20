# omnis accent direction — monotone base + "aurora" texture

Status: implementable spec. Source: `ACCENT-BRIEF-fable.md` (Fable) → structured here (Opus) → implemented by DeepSeek as design-wave task **D6**, Opus reviews.

Repo: `/Users/logankim/AI-Workspaces/omnis.plan-design-w1`.
Files touched: `packages/ui/src/tokens.css`, `apps/desktop/src/app.css`, `packages/ui/src/components/aurora-surface.tsx` (new), `packages/ui/src/index.ts`, `packages/ui/src/components/channel-rail.tsx`, `packages/ui/src/components/ask-panel.tsx`, `apps/desktop/src/screens/Onboarding.tsx`, `docs/design/DESIGN-DIRECTION.md` (one-line amendment, §0).

**The references are on disk and they are the spec.** `/Users/logankim/AI-Workspaces/Claude/omnis/design/ref-aurora-accent.png` (image 1, soft) and `ref-aurora-accent-2.png` (image 2, high-contrast). Every colour in §2.2 is one of Logan's eight anchors from `ACCENT-BRIEF-fable.md` "Update 2026-09-21" — no invented stops. Open both images before writing any CSS.

What the images actually are, because this determines the technique:

- **Image 1** — paper-white field, a **ridged mountain silhouette** of deep indigo filling the lower ~45%, a warm bloom (soft yellow core → peach) sitting directly above the ridge line, fine even grain, everything out of focus.
- **Image 2** — a **curved near-black void band** sweeping from lower-left to upper-right, vivid deep blue above it, an **intense orange rim-light hugging its lower edge**, lavender-pink floor beneath, coarse heavy grain, full-bleed inside a thin paper margin.

Both are defined by a **silhouette with a contour**. A stack of axis-aligned radial ellipses cannot produce a ridge line or a rim-light — it produces the generic pastel blob that §5.3 guard 1 and `SKILLS.md` anti-slop item 3 exist to reject. §2.3 therefore uses a masked silhouette plus a coloured `drop-shadow`, which is the whole reason this spec is not the usual four-radial-gradient recipe.

**This recipe was built and rendered before it was written down.** Every number in §2.3 and §3.1 comes from a browser, not from arithmetic; §2.4 records the two CSS traps that were hit on the way, both of which fail *silently*. Do not "simplify" the two-element mass or move the `calc()`s into `:root` — that is exactly what broke.

One sentence for the whole thing: **the app is grey; colour happens in three places, and when it happens it is an out-of-focus film photograph, not a gradient.**

---

## 0. This supersedes one line of DESIGN-DIRECTION.md — amend it in the same commit

`docs/design/DESIGN-DIRECTION.md` line 6 prescribed the tinted canvas ("warm off-white canvas, faint grid/gradient background"), and §1.3 below deletes the peach and mint radials it refers to. Logan's 2026-09-21 monotone directive supersedes it. Do not leave the SSOT contradicting the implementation — in the **same commit** as §1.3, replace that bullet's first sentence with:

```
- **Light theme by default** (warm off-white canvas + faint grid + film grain; the peach/mint gradient wash is retired by the 2026-09-21 monotone directive — colour lives only on the three aurora surfaces in `ACCENT-DIRECTION.md`). Dark is an option, and A5's "dark-first" is dropped.
```

Nothing else in DESIGN-DIRECTION.md changes. The kinso row grammar, the radius scale, the glass rules and the spring timings all still stand.

---

## 1. Monotone base

### 1.1 Rule

No base token carries a hue tint. Every neutral is warm (hue 80, the warm grey of paper) with chroma ≤ 0.005 — enough that white feels like paper, not enough to read as "beige". Colour in the base layer is allowed **only** for: brand channel glyphs (`react-icons/si`, already ruled), the three semantic tones (`--danger-500`, `--warn-500`, `--success-500`), and the aurora surfaces in §4.

Today's base is tinted **cool** (hue 260) and the canvas carries a peach + mint radial wash. Both go.

### 1.2 `packages/ui/src/tokens.css` — neutrals

Replace values in place. Left column is what is in the file today.

| token | current | new | note |
|---|---|---|---|
| `--gray-950` | `oklch(0.14 0.005 260)` | `oklch(0.145 0.004 80)` | ink tiles, dark bg |
| `--gray-900` | `oklch(0.17 0.006 260)` | `oklch(0.175 0.004 80)` | |
| `--gray-850` | `oklch(0.19 0.006 260)` | `oklch(0.195 0.004 80)` | |
| `--gray-700` | `oklch(0.32 0.006 260)` | `oklch(0.325 0.004 80)` | |
| `--gray-500` | `oklch(0.55 0.006 260)` | `oklch(0.555 0.004 80)` | |
| `--gray-300` | `oklch(0.78 0.004 260)` | `oklch(0.785 0.003 80)` | |
| `--gray-100` | `oklch(0.94 0.002 260)` | `oklch(0.945 0.003 80)` | |
| `--gray-000` | `oklch(0.99 0.001 260)` | `oklch(0.992 0.002 80)` | paper white |
| `--text-primary` | `oklch(0.2 0.006 260)` | `oklch(0.205 0.004 80)` | 15.6:1 on `--bg-canvas` |
| `--text-secondary` | `oklch(0.42 0.006 260)` | `oklch(0.435 0.004 80)` | 7.1:1 |
| `--text-tertiary` (`:root`, line 29) | `oklch(0.55 0.006 260 / 0.75)` | `oklch(0.56 0.004 80 / 0.75)` | metadata only, never body |
| `--text-tertiary` (`[data-theme="dark"]`, line 71) | `oklch(0.55 0.006 260 / 0.7)` | `oklch(0.56 0.004 80 / 0.7)` | **easy to miss — it is a second declaration in the dark block** |
| `--bg-elevated` (`:root`, line 19) | `oklch(0.97 0.002 260)` | `oklch(0.972 0.003 80)` | |
| `--border-hairline` | `oklch(0 0 0 / 0.08)` | `oklch(0.2 0.004 80 / 0.09)` | warm hairline, same weight |
| `--border-hairline-strong` | `oklch(0 0 0 / 0.14)` | `oklch(0.2 0.004 80 / 0.15)` | |
| `--accent-fg` (`:root`, line 31) | `oklch(0.99 0 0)` | `oklch(0.992 0.002 80)` | |
| `--accent-fg` (dark, line 70) | `oklch(0.14 0 0)` | `oklch(0.145 0.004 80)` | |
| `--bg-canvas` | `oklch(0.98 0.004 80)` | **unchanged** | already correct |
| `--bg-base`, `--bg-overlay`, `--state-hover` | aliases | **unchanged** | they follow the scale above |

`--state-hover` stays `color-mix(in oklch, var(--text-primary) 6%, transparent)` — it inherits the warm ink automatically and keeps working on glass. Do not reintroduce a lighten-on-glass hover.

Shadow and highlight tokens (`--shadow-row-selected`, `--shadow-glass`, `--glass-highlight`) stay pure `oklch(0 0 0 / a)` / `oklch(1 0 0 / a)`. They are opacity, not colour.

### 1.3 Kill the tinted canvas wash, add the paper grain

`--canvas-grid` currently stacks two 1px grid lines **plus** a peach radial and a mint radial. Drop the two radials, keep the grid, and put the film grain here rather than in a blended full-viewport overlay (see the note below).

```css
/* tokens.css :root — grain is layer 1 (topmost of the background layers, still under content) */
--canvas-grid:
  linear-gradient(90deg, oklch(0.2 0.004 80 / 0.03) 1px, transparent 1px),
  linear-gradient(0deg,  oklch(0.2 0.004 80 / 0.03) 1px, transparent 1px);
--canvas-grid-size: 32px 32px, 32px 32px;
```

`apps/desktop/src/app.css` → `body { background-repeat: repeat; }` (was a stale 4-value list against what is now a 2-layer image; one value applies to all layers).

The canvas grain is a **static painted pseudo-element on the non-scrolling shell**, not a `position: fixed` blended layer over the viewport. A full-viewport `mix-blend-mode` layer forces the compositor to re-blend on every scroll of the virtualized inbox underneath it — the exact cost §2.8 spends effort avoiding. `.app-shell` is `height: 100%`, does not itself scroll, and its children are the scrollers, so a layer behind it is painted once.

```css
/* app.css — .app-shell already exists; add these two properties to it */
.app-shell {
  position: relative;
  isolation: isolate;   /* required: without it the z-index:-1 child escapes behind <body> */
}
.app-shell::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background-image: var(--grain);
  background-size: 160px 160px;
  opacity: 0.035;          /* canvas grain: 3.5%. Hard ceiling. */
}
@media (prefers-reduced-transparency: reduce) { .app-shell::before { display: none; } }
```

No `mix-blend-mode`, in either theme. Film grain is bidirectional; plain alpha reads correctly on both paper and ink and costs the compositor nothing. `--grain` is defined in §2.2 and shared with the aurora.

### 1.4 Accent goes to ink

`--accent-500/600` are blue (hue 230). In a monotone app a blue accent competes with the aurora and reads as stock-SaaS. Rename and re-value; these two tokens are referenced only by `--accent` in the two theme blocks (`tokens.css:30` and `:69`), so the token edit itself is two lines plus the rename.

```css
/* replaces --accent-500 / --accent-600 */
--ink-500: oklch(0.93 0.004 80);   /* dark-theme accent */
--ink-600: oklch(0.26 0.008 80);   /* light-theme accent */
```

`:root { --accent: var(--ink-600); }` · `:root[data-theme="dark"] { --accent: var(--ink-500); }`

**But `--accent` itself has 13 consumers, and five of them regress silently if you stop here.** This is the full grep (`grep -rn -- '--accent' apps packages | grep -v node_modules | grep -v /dist/`). Work the list.

| # | site | what happens at graphite | action |
|---|---|---|---|
| 1 | `app.css:89` `.channel-rail__tile--active` ring | graphite 2px ring on glass | fine, no change |
| 2 | `app.css:192-193` `.ask-bar__chip` | graphite chip on near-white fill | fine, no change |
| 3 | `app.css:286` `.ask-bar__model-menu button[aria-pressed]` | graphite + 600 weight | fine, no change |
| 4 | `app.css:523-524` `.inbox-card__pills button[aria-checked]` | near-black fill, paper text | fine, this is the correct "selected" |
| 5 | `app.css:540-541` `.inbox-card__archived-pill[aria-pressed]` | same | fine |
| 6 | `app.css:623` `.inbox-row__unread-dot` | graphite dot | fine — it was never the only signal (the name is bold too) |
| 7 | `app.css:656` `.inbox-row__summary[data-draft]` | graphite body text, indistinguishable from `--text-secondary` | **fix**: add `font-style: italic` is banned (SKILLS item 4) — use `color: var(--text-primary); font-weight: 500;` so a draft reads darker/heavier than a summary |
| 8 | `app.css:790` `.thread-screen__archived-banner button` | **regression** — a text-only affordance whose only signal was accent colour; at graphite it is body copy | **fix**: add `text-decoration: underline; text-underline-offset: 2px;` |
| 9 | `app.css:931-932` `.status-pill[data-tone="info"]` | **regression** — `oklch(from var(--accent) …)` with chroma 0.008 collapses to grey, visually identical to `[data-tone="neutral"]` directly above it | **fix**: stop deriving from accent. `background: transparent; border: 1px solid var(--border-hairline-strong); color: var(--text-primary);` — info is now distinguished from neutral by *shape* (outlined vs filled), not hue. Monotone-safe. |
| 10 | `app.css:1006` `.filter-chip` border | graphite outline | fine |
| 11 | `app.css:1013` `.filter-chip` fill | `oklch(from var(--accent) 0.97 …)` becomes L0.97 near-white on an L0.98 canvas — an invisible tint pretending to be one | **fix**: `background: var(--bg-elevated);` and delete the `oklch(from …)` (and the comment above it that explains a hue rotation that no longer happens) |
| 12 | `packages/ui/src/components/button.tsx:11` primary CTA | near-black fill + paper text (light), paper fill + near-black text (dark) | fine — this is a correct primary button in both themes. No change. |
| 13 | `packages/ui/src/lib/row-meta.ts:60-61` `CHANNEL_COLOR.agent` / `.system` | agent and system row glyphs lose their colour identifier | **keep as-is, deliberately**: every other channel glyph is a *brand* colour; agent/system are not brands, and graphite is the honest reading. Agent rows still carry the status badge (`idle`/`working`/`blocked`/`done`), which is the real identifier per DESIGN-DIRECTION. |

Two tests assert the token *name*, not its value — `packages/ui/test/row-meta.test.ts:69` and `packages/ui/test/channel-rail.test.tsx:55` both expect `var(--accent)`. They keep passing. Do not touch them.

Semantic tones keep their hue — they are signals, not decoration. Nudge only `--warn-500` warmer so `blocked` sits in the same family as the aurora bloom: `oklch(0.75 0.15 80)` → `oklch(0.74 0.16 72)`.

---

## 2. The aurora texture

### 2.1 What it is

A **field** (the sky/floor gradient), a **masked silhouette** (the ridge or the void band) carrying a coloured `drop-shadow` rim, **grain**, and a **vignette**. Heavily blurred, clipped to the box. Every variant is the *same* stack; only eleven custom properties change. There is one recipe in the codebase, not three.

The silhouette is the point. It is what makes the output read as a photograph of a landscape rather than a CSS gradient, and it is the one thing four stacked ellipses cannot fake.

### 2.2 Tokens (add to `tokens.css` `:root`)

Eight colour tokens: exactly Logan's eight anchors, one token each. Do not add a ninth.

```css
/* Image 1 — soft aurora (ref-aurora-accent.png) */
--aurora-indigo: oklch(0.35 0.15 270);   /* deep blue/indigo, the ridge mass */
--aurora-peach:  oklch(0.75 0.10 30);    /* peach/coral, the transition */
--aurora-butter: oklch(0.90 0.08 90);    /* soft yellow, the bloom core */
--aurora-paper:  oklch(0.98 0.01 270);   /* bright background */

/* Image 2 — high-contrast void (ref-aurora-accent-2.png) */
--aurora-blue:   oklch(0.40 0.16 260);   /* vivid deep blue, above the void */
--aurora-void:   oklch(0.15 0.02 280);   /* the dark mass. Near-black, low chroma. */
--aurora-ember:  oklch(0.60 0.22 35);    /* the orange/red rim-light */
--aurora-lilac:  oklch(0.85 0.08 320);   /* lavender pink floor */

/* Silhouettes. Monochrome masks — the colour lives in the tokens above, never in the SVG. */
--aurora-ridge: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 200' preserveAspectRatio='none'%3E%3Cpath d='M-6 206V150C10 148 26 128 34 96C40 74 52 60 62 78C70 94 74 110 84 114C96 119 110 110 126 96V206Z' fill='%23000'/%3E%3C/svg%3E");
--aurora-curve: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 160' preserveAspectRatio='none'%3E%3Cpath d='M-6 40C30 26 74 4 126-14V70C86 86 40 118-6 98Z' fill='%23000'/%3E%3C/svg%3E");

/* Film grain. One 160px tile, desaturated in-filter, sRGB-interpolated. */
--grain: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n' color-interpolation-filters='sRGB'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E");
--grain-opacity: 0.08;   /* aurora grain: 8%. Ceiling is 10%. */

/* Scrim for any text block that sits on an aurora surface. */
--aurora-scrim: color-mix(in oklch, var(--bg-base) 82%, transparent);
```

Two non-negotiables on the grain URI, both of which were wrong in the previous draft:

- `feColorMatrix type='saturate' values='0'` — `feTurbulence` emits **RGBA** noise. Without this the grain is rainbow speckle inside a spec whose entire premise is a monotone base.
- `color-interpolation-filters='sRGB'` on the `<filter>` — the CSS/SVG default is linearRGB, and Chrome honours it, so the tile renders materially darker than authored. Safari/WKWebView differs. Pin it.

Per-variant knobs (the defaults below are `dawn`; §3.1 sets all of them per variant):

```css
--aurora-sky:        var(--aurora-paper);   /* field, top */
--aurora-floor:      var(--aurora-paper);   /* field, bottom */
--aurora-hot:        var(--aurora-butter);  /* bloom core; `transparent` disables the bloom */
--aurora-mass-hi:    var(--aurora-indigo);  /* silhouette fill, at its contour */
--aurora-mass-lo:    var(--aurora-indigo);  /* silhouette fill, at the bottom of the box */
--aurora-rim:        var(--aurora-peach);   /* rim-light colour along the contour */
--aurora-rim-dir:    -1;                    /* -1 = warm ABOVE the ridge (image 1); 1 = ember BELOW the void (image 2) */
--aurora-silhouette: var(--aurora-ridge);
--aurora-vignette:   var(--bg-base);        /* `transparent` = full bleed, no vignette */
--aurora-alpha:      0.62;
--grain-size:        120px;
```

**`--aurora-blur` is set per surface, not per variant.** It is ~10% of that surface's short side, which is what the reference's own focus falloff measures (8–12%). A single global value is wrong by construction: the rail plate is ~56px wide and the onboarding plate fills the panel. §4.1 gives the three values. Default in `:root`: `--aurora-blur: 24px;` — a value nothing should actually use.

Dark theme (`:root[data-theme="dark"]`): the palette does not change — on near-black the same masses read as glow instead of stain, so they need *less* alpha, not more. Three lines:

```css
:root[data-theme="dark"] { --aurora-scrim: color-mix(in oklch, var(--bg-base) 76%, transparent); }
:root[data-theme="dark"] [data-aurora="dawn"] { --aurora-alpha: 0.50; }
:root[data-theme="dark"] [data-aurora="mist"] { --aurora-alpha: 0.26; }
```

`void` stays at 1 in both themes — it is already its own dark field. `--canvas-grid` is already `none` in the dark block; leave the `.app-shell::before` grain at 0.035.

Note that nothing in the app currently sets `data-theme="dark"` (`tokens.css:59` documents this). The dark screenshots in §5.1 are taken by setting the attribute by hand in devtools.

### 2.3 The recipe

```css
/* tokens.css — one class, shared by every aurora surface. */
.aurora {
  position: relative;
  isolation: isolate;   /* the z-index:-1 layers must stay inside this box */
  overflow: hidden;     /* clips the oversized, blurred children */
  background-color: var(--bg-base);
}
```

No `contain: paint`. Per Filter Effects L2 it forms a **backdrop root**, which would make the rail's `.glass-surface` sample only what is painted inside `.aurora` — it would stop blurring the page canvas and its grid, silently changing the established plate/glass relationship documented at `app.css:46-51`. `overflow: hidden` already does the clipping and `isolation: isolate` already makes the stacking context; `contain` buys nothing here that those two do not. Verify the glass still picks up the canvas grid during step 3 of §5.4.

```css
/* Layer 1 — the field. No shape; this is the sky and the floor. */
.aurora::before {
  content: "";
  position: absolute;
  inset: calc(-2 * var(--aurora-blur));   /* bleed is a function of the blur, not a % of the box */
  z-index: -1;
  pointer-events: none;
  opacity: var(--aurora-alpha);
  filter: blur(var(--aurora-blur));
  background:
    radial-gradient(46% 30% at 50% 30%,
      color-mix(in oklch, var(--aurora-hot) 92%, transparent) 0%,
      color-mix(in oklch, var(--aurora-peach) 62%, transparent) 58%,
      transparent 100%),
    linear-gradient(to bottom, var(--aurora-sky) 0%, var(--aurora-floor) 100%);
}

/* Layer 2 — the silhouette. This is the ridge / the void band.
   TWO elements, and that is not a style preference: CSS applies `filter` BEFORE `mask`, so a
   masked element carrying its own blur() renders a razor-sharp cut-out. The blur must live on
   an ANCESTOR of the masked box. drop-shadow() then follows the already-blurred alpha
   contour, which is what produces the rim-light. See §2.4. */
.aurora__mass {
  position: absolute;
  inset: calc(-2 * var(--aurora-blur));
  z-index: -1;
  pointer-events: none;
  opacity: var(--aurora-alpha);
  /* Derived values are inlined HERE, never precomputed in :root — see §2.4. */
  filter:
    blur(calc(0.35 * var(--aurora-blur)))
    drop-shadow(
      0
      calc(var(--aurora-rim-dir) * 0.5 * var(--aurora-blur))
      calc(0.3 * var(--aurora-blur))
      var(--aurora-rim));
}
.aurora__mass::before {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(to bottom, var(--aurora-mass-hi) 0%, var(--aurora-mass-lo) 100%);
  -webkit-mask-image: var(--aurora-silhouette);
          mask-image: var(--aurora-silhouette);
  -webkit-mask-size: 100% 100%;
          mask-size: 100% 100%;
  -webkit-mask-repeat: no-repeat;
          mask-repeat: no-repeat;
}

/* Layer 3 — grain. A real child, because it needs its own opacity. */
.aurora__grain {
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background-image: var(--grain);
  background-size: var(--grain-size) var(--grain-size);
  opacity: var(--grain-opacity);
}

/* Layer 4 — vignette. Fades the plate back to the surface colour so no edge of the texture
   ever meets a hairline. `--aurora-vignette: transparent` turns it off (full-bleed variants). */
.aurora::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background: radial-gradient(120% 120% at 50% 50%, transparent 46%, var(--aurora-vignette) 100%);
}
```

Notes that will save an hour each:

- **The `-webkit-` mask prefixes are not optional.** The desktop app is Tauri 2 → WKWebView on macOS, where unprefixed `mask-image` is still not reliable.
- **Bleed vs blur.** `inset: calc(-2 * var(--aurora-blur))` is the guarantee that no blurred rectangle edge lands inside the box. A percentage inset cannot make that guarantee: on the 56px rail plate `-30%` is 16.8px of bleed against what used to be a 44px blur (visible spread ≈ 3σ ≈ 130px), so the falloff landed well inside the box and the texture washed to near-uniform. Two blur radii of bleed covers ~2σ of spread on every surface regardless of size.
- **Layer order**, bottom to top: field (`::before`), mass (`.aurora__mass`), grain (`.aurora__grain`), vignette (`::after`) — all `z-index: -1`, resolved by source order — then the wrapped content at the default z-index. Source order in the stylesheet must match that list.
- **The mass blur is 0.35 × the field blur, not 1.0.** At parity the ridge dissolves into its own sky and you are back to the blob. The rim offset is `0.5 × blur` in the direction of `--aurora-rim-dir`: below that the rim is buried inside the contour's own falloff, above it the rim detaches into a separate band.
- **`mask-size` is `100% 100%`, not `cover`.** `cover` preserves the source aspect and scales the silhouette past the box, which makes the contour read crisp and graphic — an illustration, not a photograph. Stretching is correct here: the shape is a gesture, not a picture of one particular mountain.
- **Grain fineness is `--grain-size`, not a second SVG.** The tile is 160px of `stitchTiles='stitch'` noise; rendering it at 96px makes the speckle finer, at 220px coarser. That satisfies the brief's "finer for mist/dawn, coarser for void" with one URI. Do not author a second `baseFrequency`.

### 2.4 Two silent failure modes — both were hit while building this

Neither produces an error, a warning or a console message. Both produce a plausible-looking wrong picture, which is the worst kind.

**1. `filter` runs before `mask`.** The order is filter → clip → mask → opacity. So `blur()` on the element that also carries `mask-image` blurs the *unmasked* rectangle and then cuts it with a hard-edged mask. Fix: the two-element `.aurora__mass` / `.aurora__mass::before` split in §2.3. **Symptom: a crisp mountain or a crisp band.** If you see one, someone collapsed the two elements back into one.

**2. A `:root` custom property may not reference a variable that is only defined on descendants.** `var()` inside a custom-property declaration is substituted where it is *declared*, not where it is used. So:

```css
:root { --aurora-mass-blur: calc(0.35 * var(--aurora-blur)); }   /* WRONG */
.ask-panel { --aurora-blur: 42px; }
```

leaves `--aurora-mass-blur` guaranteed-invalid; every descendant inherits the empty value, and the `filter` consuming it becomes invalid-at-computed-value-time — which silently computes to `filter: none`. The blur *and* the rim vanish together. **Symptom: nothing is blurred and there is no rim.** Fix: keep every `calc()` at the use site, where `--aurora-blur` resolves, and pass only unitless factors (`--aurora-rim-dir`) down from `:root`. §2.3 is written that way; keep it that way.

### 2.5 Why exactly one surface is genuinely dark

The references run from near-black (image 2's void, L≈0.15) to paper white. Compositing `--aurora-void` at alpha 0.34 over `--bg-base` (L≈0.99) lands around L≈0.70 — a pale lavender smudge, not a cinematic mass. Rendered, it is exactly that. **Below roughly alpha 0.8, image 2 is not reproducible; it is merely referenced.** A faint high-contrast variant is a contradiction.

So: **onboarding carries `void` at alpha 1 with the mass free to sit behind the panel**, and its content lives in a centred card on `--aurora-scrim`, so the ink stays dark-on-light while the dark mass is visible full-bleed around it. That is the one surface where Logan's image 2 actually exists. The other two (rail at 0.34, ask panel at 0.62) are `mist`/`dawn` and are meant to be faint — they are texture behind glass, not pictures.

This is also why the previous `dusk` variant is **dropped**: it was image 2 at alpha 0.34, i.e. the impossible case. Surfaces that used to be `dusk` get `dawn`.

### 2.6 Component

`packages/ui/src/components/aurora-surface.tsx` — thin, no logic:

```tsx
import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn.js";

export type AuroraVariant = "dawn" | "mist" | "void";

/** Decorative texture plate. Renders the two layers that need their own opacity;
 *  the field and the vignette are pseudo-elements on .aurora.
 *  Never put a scroll container directly on one — wrap the scroller inside. */
export function AuroraSurface({
  variant = "dawn",
  className,
  children,
  ...rest
}: { variant?: AuroraVariant } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("aurora", className)} data-aurora={variant} {...rest}>
      <span className="aurora__mass" aria-hidden="true" />
      <span className="aurora__grain" aria-hidden="true" />
      {children}
    </div>
  );
}
```

Export it from `packages/ui/src/index.ts`. It takes exactly one prop. A caller that wants a different blur or alpha sets `--aurora-blur` / `--aurora-alpha` in its own class — do not add props for them.

### 2.7 Specificity: state the rule once, do not rely on file order

`[data-aurora="mist"]` is specificity (0,1,0). `.channel-rail__aurora` is also (0,1,0). Whichever wins is decided by source order across two files (`main.tsx:3-4` loads `tokens.css` then `app.css`), which is not a contract anybody should be reading.

**Every per-surface override is written as a two-class selector**: `.aurora.channel-rail__aurora { --aurora-blur: 6px; }` — (0,2,0), beats the variant block in any order.

Also note the declaration collision the wrapper structure in §4.1 exists to avoid: `.aurora { background-color: var(--bg-base) }` and `.glass-surface { background: var(--bg-overlay) }` are both (0,1,0). If they ever land on the same element, either the vignette fades to an opaque `--bg-base` and kills the glass at the rim, or the panel stops being glass. **`.aurora` and `.glass-surface` are never the same element.** See §4.1.

### 2.8 Performance

- Aurora goes on **fixed-size, non-scrolling boxes only**. Never on `body`, never on the inbox scroller, never inside a `react-virtuoso` row, never on `.app-shell__detail`.
- One blurred mass per surface. Do not nest `.aurora` inside `.aurora`.
- Do not set `will-change`. The drift in §3.3 is 90s and GPU-composited by `transform` alone.
- `backdrop-filter` and aurora coexist in one direction only: the aurora is **behind** the glass, painted by an **ancestor** of the glass element. An element's own `::before` paints above its own background, so an aurora on the glass element itself would sit *on top of* the glass fill — which is why §4.1 uses wrappers everywhere, not `className="aurora glass-surface"`.
- An ancestor with `filter` disables descendant `backdrop-filter`. The `filter` lives on `::before` and `.aurora__mass`, never on `.aurora`. Do not move it up.
- Budget: at most **three** aurora surfaces mounted at once. In practice two (rail + ask panel); onboarding never co-mounts with the shell.

---

## 3. Variants

Three variants, three surfaces, one each. `dawn` and `mist` are image 1; `void` is image 2; `dusk` is dropped (§2.5).

### 3.1 Definitions

```css
/* dawn — image 1. Indigo ridge, warm bloom above it, paper field, rim pointing UP so the
   peach hugs the top of the ridge the way the sunset sits behind the hill in image 1. */
[data-aurora="dawn"] {
  --aurora-sky: var(--aurora-paper);
  --aurora-floor: var(--aurora-paper);
  --aurora-hot: var(--aurora-butter);
  --aurora-mass-hi: var(--aurora-indigo);
  --aurora-mass-lo: var(--aurora-indigo);
  --aurora-rim: var(--aurora-peach);
  --aurora-rim-dir: -1;
  --aurora-silhouette: var(--aurora-ridge);
  --aurora-vignette: var(--bg-base);
  --aurora-alpha: 0.62;
  --grain-size: 120px;
}

/* mist — image 1's colour and grain, no silhouette. Finest grain. */
[data-aurora="mist"] {
  --aurora-sky: var(--aurora-paper);
  --aurora-floor: var(--aurora-paper);
  --aurora-hot: var(--aurora-butter);
  --aurora-vignette: var(--bg-base);
  --aurora-alpha: 0.34;
  --grain-size: 96px;
}
[data-aurora="mist"] .aurora__mass { display: none; }

/* void — image 2. Near-black band, vivid blue above, ember rim BELOW its lower edge,
   lilac floor. Full bleed (no vignette), full alpha, coarse grain. */
[data-aurora="void"] {
  --aurora-sky: var(--aurora-blue);
  --aurora-floor: var(--aurora-lilac);
  --aurora-hot: transparent;            /* image 2 has no bloom — the rim IS the warm light */
  --aurora-mass-hi: var(--aurora-blue);
  --aurora-mass-lo: var(--aurora-void);
  --aurora-rim: var(--aurora-ember);
  --aurora-rim-dir: 1;
  --aurora-silhouette: var(--aurora-curve);
  --aurora-vignette: transparent;
  --aurora-alpha: 1;
  --grain-size: 220px;
}
```

**`mist` deliberately has no silhouette, and that is a measured decision, not an omission.** Its only consumer is the rail plate: ~56px wide by ~400px tall. Stretching a 120:200 landscape ridge into 56:400 is a 4.7× vertical stretch and renders as a vertical finger; cropping it instead (`mask-size: cover`) renders as a vertical bar. Neither is a ridge, and at 56px behind 24px of glass blur nothing legible as a contour can survive anyway. So mist carries image 1's **colour, softness and grain** but not its shape, and costs one blurred layer instead of two on the one surface that is always mounted. If a wider `mist` surface ever appears, give it `--aurora-silhouette: var(--aurora-ridge)` and delete the `display: none` for that surface only.

Temperature reads: **dawn** warm bloom over a cool ridge on paper; **mist** the same at a third of the strength, nearly monochrome — mist is what you use behind glass or near text; **void** high contrast, the only variant with a dark field.

### 3.2 Deterministic surface → variant map

| surface | variant | blur | why |
|---|---|---|---|
| rail plate backdrop | `mist` | 6px | ~56px plate; sits behind 24px of glass blur, where anything stronger turns to mud, and is too narrow for a contour (§3.1) |
| ask panel + orb | `dawn` | 42px | the AI surface is the warm one; it is the only shell surface where the bloom leads |
| onboarding | `void` | 64px | first run is the one moment the app can be a photograph (§2.5) |

No randomness, no per-user seed, no time-of-day switching. The map above is the whole rule.

### 3.3 Drift (optional, ship it last)

```css
@keyframes aurora-drift {
  0%   { transform: translate3d(0, 0, 0) scale(1); }
  50%  { transform: translate3d(-2.5%, 1.8%, 0) scale(1.06); }
  100% { transform: translate3d(0, 0, 0) scale(1); }
}
.aurora::before,
.aurora__mass { animation: aurora-drift 90s ease-in-out infinite; }
```

90 s, ≤ 2.5% translation, ≤ 6% scale. Field and mass drift together or the ridge detaches from its own sky. If it is perceptible as motion when you look at it directly, it is wrong.

### 3.4 Fallbacks

```css
@media (prefers-reduced-motion: reduce) {
  .aurora::before,
  .aurora__mass { animation: none; }
}
@media (prefers-reduced-transparency: reduce) {
  /* no texture at all — flat surface colour, hairline keeps the edge */
  .aurora::before, .aurora::after, .aurora__mass, .aurora__grain { display: none; }
  .aurora { background-color: var(--bg-elevated); }
}
```

The existing `prefers-reduced-transparency` block in `tokens.css` (lines 94-103) already flattens `--bg-overlay` and kills `backdrop-filter`; add the rule above to the same block so there is one place that answers "what does omnis look like with effects off". The `biome-ignore` comment above that block covers the new rules too.

No `@supports not (color-mix(…))` guard. `tokens.css` already depends on `color-mix` for `--state-hover` and `--bg-overlay`, so a browser without it has a broken app whether or not the aurora degrades — the guard would be dead code.

---

## 4. Surface map

### 4.1 Where the aurora appears — exactly three places

Every one of these is **AuroraSurface wrapping GlassSurface**, never the same element (§2.7, §2.8).

#### 4.1.1 Rail plate backdrop — `mist`

`packages/ui/src/components/channel-rail.tsx:40-61`: wrap the existing plate.

```tsx
<AuroraSurface variant="mist" className="channel-rail__aurora">
  <GlassSurface slot="sidebar" className="channel-rail__plate">
    {/* unchanged */}
  </GlassSurface>
</AuroraSurface>
```

```css
/* app.css */
.aurora.channel-rail__aurora {
  --aurora-blur: 6px;                 /* ~10% of the ~56px plate (44px tile + 6px padding × 2) */
  border-radius: 22px;
  box-shadow: var(--shadow-glass);    /* see the note below */
}
.glass-surface.channel-rail__plate {
  box-shadow: inset 0 1px 0 var(--glass-highlight);
}
```

**Known cost, accept it deliberately:** `.aurora` clips with `overflow: hidden`, which would clip the plate's outer `--shadow-glass` to nothing. So the drop shadow moves to the wrapper and the plate keeps only its inset highlight. The visual result is identical; it is just declared one element out. Both selectors are (0,2,0) so no file-order dependency.

The aurora must not extend past the plate's footprint — same 22px radius, no padding on the wrapper.

#### 4.1.2 Ask panel + orb — `dawn`

`packages/ui/src/components/ask-panel.tsx:54-60` currently returns a bare `GlassSurface`. Wrap it, and let the **glass element be the scroller** — that is the subtree that moves, and it contains both render branches (the `commands` branch at line 83 and the suggest branch at 84-146), so neither can scroll independently of the other.

```tsx
<AuroraSurface variant="dawn" className={cn("ask-panel", closing && "ask-panel--closing")}>
  <GlassSurface
    slot="palette"
    className="ask-panel__glass"
    role="dialog"
    aria-label="AI panel"
  >
    {/* head + branches, unchanged */}
  </GlassSurface>
</AuroraSurface>
```

Split the existing `.ask-panel` rule (`app.css:292-312`) in two — positioning stays outside, the panel's own box moves inside:

```css
.ask-panel {                    /* the aurora wrapper */
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  width: min(420px, 100%);
  z-index: 5;
  border-radius: 20px;
  --aurora-blur: 42px;          /* ~10% of the 420px short side */
  box-shadow: var(--shadow-glass);
  transform-origin: top left;
  animation: ask-panel-in var(--dur-panel) var(--ease-spring);
}
.glass-surface.ask-panel__glass {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px;
  border-radius: 20px;
  max-height: min(60vh, 420px);
  overflow-y: auto;             /* the glass scrolls; the aurora never does */
  box-shadow: inset 0 1px 0 var(--glass-highlight);
}
```

`.ask-panel--closing` and both `@keyframes` stay on the wrapper unchanged. The `--aurora-blur: 42px` override belongs on `.aurora.ask-panel` if you want the (0,2,0) form; `.ask-panel` alone is fine here only because nothing else declares it — prefer the two-class form for consistency.

**Orb and focus ring.** Retire `--ask-gradient` (teal→orange, `tokens.css:35`, used at `app.css:159` and `:178`). It is replaced by **two** tokens, both declared in `tokens.css :root`, because the two shapes have nothing in common geometrically — the orb is 18×18 and the focus ring is a 1.5px stroke around a box roughly 820×44 (`app.css:178`, the `mask-composite` ring). A single radial on a 19:1 box puts all the amber in the left ~200px and indigo everywhere else, which looks like neither.

```css
/* tokens.css :root */
--aurora-orb: radial-gradient(70% 70% at 30% 26%,
  var(--aurora-butter) 0%, var(--aurora-peach) 34%,
  var(--aurora-indigo) 74%, var(--aurora-void) 100%);
--aurora-stroke: linear-gradient(100deg,
  var(--aurora-indigo) 0%, var(--aurora-peach) 46%,
  var(--aurora-butter) 62%, var(--aurora-indigo) 100%);
```

`.ask-bar__orb { background: var(--aurora-orb); }` — one 18px bead of the photograph.
`.ask-bar__pill::after { background: var(--aurora-stroke); }` — the stroke traverses the pill's long axis, so all four stops are visible along its length.

#### 4.1.3 Onboarding — `void`, full bleed, content on a card

`apps/desktop/src/screens/Onboarding.tsx` has a `.onboarding` class at line 55 and **zero matching CSS anywhere in the repo** — there is no plate to put an aurora on. Spec it here; this is new work, not a re-skin.

```tsx
<AuroraSurface variant="void" className="onboarding">
  <div className="onboarding__card">
    {/* the existing h1 + ul + p + Button, unchanged */}
  </div>
</AuroraSurface>
```

```css
.aurora.onboarding {
  --aurora-blur: 64px;
  display: grid;
  place-items: center;
  min-height: 100%;
  padding: 24px;
  box-sizing: border-box;
}
.onboarding__card {
  width: min(460px, 100%);
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 28px;
  border-radius: 20px;
  background: var(--aurora-scrim);
  backdrop-filter: blur(20px) saturate(1.2);
  -webkit-backdrop-filter: blur(20px) saturate(1.2);
  border: var(--hairline);
  box-shadow: var(--shadow-glass);
}
.onboarding__card h1 { margin: 0; font-size: 22px; font-weight: 650; }
.onboarding__card ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
.onboarding__card li { display: flex; align-items: center; gap: 12px; }
.onboarding__card li > span:first-child { flex: 1 1 auto; }
.onboarding__card p { margin: 0; color: var(--text-secondary); font-size: 13px; }
.onboarding__card [role="alert"] { color: var(--danger-500); font-size: 12px; }
```

This is how onboarding satisfies §5.3 guard 4 rather than violating it: the screen is well over 40 words, so **the words sit on a scrim** and the aurora is what surrounds the card. Do not put `dawn` on the text block "because the screen is almost empty" — it is not.

`.onboarding` is not currently rendered by `App.tsx`. For the acceptance screenshot, mount it directly (a temporary route or a Vite entry) — do not wire a first-run flow as part of D6.

#### 4.1.4 Cut from the previous draft, and why

- **Command palette `mode="dialog"` backdrop.** `App.tsx:54` states in a comment that the shell does not use it and `App.tsx:113` passes `mode="inline"`; the dialog surface never renders. Styling an unreachable surface is unreviewable — the screenshot could not be captured. `CommandPalette mode="dialog"` stays in `@omnis/ui` untouched.
- **Inbox empty state.** No empty-state markup and no zero-row branch exists in `apps/desktop/src/screens/Inbox.tsx`. Building one is an inbox story, not an accent story. When it is built it gets `mist`.
- **Agents rail tile.** It is a `<button>` inside `<GlassSurface className="channel-rail__plate">` (`channel-rail.tsx:41-55`), which §4.1.1 now wraps in an AuroraSurface — so a tile aurora would be a `.aurora` inside a `.aurora`, against §2.8, and would push the mounted budget to four. `AuroraSurface` also renders a `<div>` and could not become the tile `<button>` without restructuring the map. Nothing in the rail is tinted except the plate backdrop behind the glass.

### 4.2 Where it is forbidden — no exceptions

Inbox rows (`.inbox-row`, hovered, selected, or unread), group headers, filter chips, label chips, status badges and pills, message bodies and thread items, approval cards, draft cards, tool-call badges, hover cards, tables and key-value lists, every button, every input, the detail panel body, the page background, and anything rendered inside `react-virtuoso`.

If the answer to "why is there colour here" is "it looked flat", the answer is no.

### 4.3 Contrast over aurora

- Body text and any interactive label over an aurora surface either sits on a scrim (`background: var(--aurora-scrim); backdrop-filter: blur(8px);` — the onboarding card, the ask panel's own glass) or sits where `--aurora-alpha ≤ 0.34` and there is no mass (the `mist` case).
- Measured requirement: `--text-primary` ≥ **7:1** and `--text-secondary` ≥ **4.5:1** against the *darkest* pixel of the surface behind them. Check the mass, not the average.
- **On `dawn` the mass does cross the content band, and the glass is what answers for it.** The ridge peaks at 35% of its viewBox, so on a 420×400 ask panel the indigo reaches the middle of the panel. Measured: `--aurora-indigo` at alpha 0.62 over paper composites to about L 0.64, and the panel's own `.glass-surface` fill (`--bg-overlay`, 78% `--gray-000`) lifts that to roughly L 0.91 before any text is drawn — `--text-primary` at L 0.205 clears 7:1 comfortably. This is why the ask panel keeps its glass; strip the glass and the panel fails contrast.
- **`mist` has no mass at all** (§3.1), so nothing dark can land behind the rail's glyphs.
- On `void` the mass crosses the content band by design — that surface answers with the card (§4.1.3), not with positioning.
- Never set text colour to an aurora colour. Ink on aurora, never aurora on ink.
- Existing focus rings stay `--accent` (graphite) — a focus ring drawn in aurora colours is invisible on an aurora surface.

### 4.4 Glass stays — the chrome recipe over aurora

`ref-glass-sidebar.png` is the rule for chrome: however much aurora colour and grain a rail, panel, sheet or popover carries, it must still read as **glass** — a blurred version of what is behind it shows through. The aurora is texture *behind* the plate (§4.1), never a fill *on* it.

**The plate.** Stack, bottom to top: canvas → `AuroraSurface` → `GlassSurface` → content. The glass recipe already exists at `tokens.css:104-110` and does not change; restated so the numbers are in one place:

```css
.glass-surface {
  background: var(--bg-overlay);                    /* 78% --gray-000 light / 72% --gray-900 dark */
  backdrop-filter: blur(24px) saturate(1.4);
  -webkit-backdrop-filter: blur(24px) saturate(1.4);
  border: var(--hairline);
  box-shadow: inset 0 1px 0 var(--glass-highlight), /* the 1px inner light edge — white @ 0.55 */
              var(--shadow-glass);                  /* 0 8px 24px /0.08 + 0 1px 3px /0.06 */
}
```

- **Tint alpha: 78% is the default and the ceiling, 70% is the floor.** The brief's 55–70% is measured over a photographic wallpaper; over our far fainter aurora, below 70% the plate stops lifting the mass and §4.3's contrast math (78% → L≈0.91 under the ask panel's ridge) fails. Above 78% it is a painted panel. Never declare `background` on a `.glass-surface` — move `--bg-overlay` if it must move at all.
- **`blur(24px) saturate(1.4)` stays.** Do not raise the saturate "to make the aurora pop": it saturates the canvas grid and the ink behind the plate too.
- **The plate owns the inset highlight; the outer shadow goes wherever the clipping is.** Where an `.aurora` wrapper clips with `overflow: hidden` (§4.1.1, §4.1.2) `--shadow-glass` sits on the wrapper and the plate keeps only `inset 0 1px 0 var(--glass-highlight)`. Exactly one of the two elements carries the outer shadow, never both.
- **Radius: take it from the existing scale, do not add 24px.** The reference's ~24px reads onto omnis as **22px** for the rail/sidebar plate, **20px** for floating panels (ask panel, sheets), **12px** for popovers and hover cards. The aurora wrapper and the glass plate carry the *same* radius, or the texture shows at the corner.
- **Measurable check — the aurora must stay readable through the plate.** Screenshot the plate, sample in OKLCH the darkest point over the mass and the lightest point over paper *within the same plate*: **ΔL ≥ 0.02** (≈ 5/255) on `dawn` and `void`. `mist` carries no mass (§3.1) and sits below that floor by design — its translucency evidence is the §5.2 item that the canvas grid is still visible through the rail plate. ΔL = 0 on any plate means the glass went opaque.

**Inside the glass: opaque cards, not more glass.** Content groups (the reference's Services block, the Settings strip) are `OpaqueSurface` — `background: var(--bg-base)`, `border-radius: 12px`, `border: 0`, `box-shadow: none`. No hairline, no shadow, no second `backdrop-filter`. Glass inside glass doubles the backdrop cost and reads as haze.

- **Selected item = one filled pill.** `background: var(--accent); color: var(--accent-fg); border-radius: 10px;` — this is §1.4 row 4's "correct selected". Saturated in *value*, not in hue: the reference's blue pill becomes near-black on paper (paper on ink in dark). A hued selected pill is a §5.3 guard 6 reject.
- **Section labels with counts** ("Menu: 6", "Service: 3"): 12px, label in `--text-secondary`, count in `--text-primary` with `font-variant-numeric: tabular-nums`. No pill, no badge, no colour.
- **Count badges are for alerts only.** A badge pill — `--danger-500` fill, `var(--gray-000)` text, `border-radius: 999px`, `min-width: 18px` — is allowed only where the count is an unread/needs-action alert (the reference's red "4"). Decorative counts stay plain text. Avatar stacks are images, not tinted chips.

**Reject rule — no flat tinted panel.** If a chrome surface reads as an opaque coloured panel, it fails, whatever the CSS claims. Three tells, each a reject on its own: (1) an opaque `background` declared on a `.glass-surface` or on its `.aurora` wrapper, (2) `backdrop-filter` absent or `none` outside the `prefers-reduced-transparency` block, (3) a plate fill carrying chroma — the tint is white or near-black at an alpha, never a colour. Under `prefers-reduced-transparency: reduce` a flat surface is the correct outcome (`tokens.css:94-103` plus §3.4); that is the one case these tells do not apply.

**Follow-up, not D6 — the expanded/collapsed rail.** The reference's two states (labels plus right-side affordances at ~300px expanded, icons only at ~72px collapsed, spring-animated on `--dur-panel` / `--ease-spring`) are a product-loop item, not an accent one: they change the rail's information architecture, not its material. D6 ships the collapsed rail we already have. When the states are built they touch three files — `packages/ui/src/components/channel-rail.tsx` (the state, the labels, the section groups), `apps/desktop/src/app.css` (`.channel-rail*` and the `.app-shell` `grid-template-columns` 76px track), `apps/desktop/src/App.tsx` (where the rail is mounted and the expanded/collapsed state would live). `packages/ui/test/channel-rail.test.tsx` gains cases then; it needs none now.

---

## 5. Acceptance

### 5.1 Screenshots

Capture with `chrome-devtools-mcp` against the Vite dev server (per `docs/design/SKILLS.md`, "Standard prompt preamble for UI tasks" item 6 — that file has no numbered sections), light theme, then repeat 1 and 2 with `data-theme="dark"`:

1. Inbox, default state, nothing selected — rail aurora behind glass, monotone list.
2. Inbox with the ask bar focused and the ask panel open (`dawn`), a thread selected.
3. Onboarding (`void`), mounted directly.
4. Agents filter selected in the rail, showing agent rows and the graphite agent glyph.

Desktop captures at **1440×900**. The mobile gate is `SKILLS.md` item 11's four sizes — **320 / 375 / 414 / 768** — and every one of screens 1–4 must pass it. Do not substitute 390×844.

Also capture 1 and 2 at 1440 with `prefers-reduced-transparency: reduce` emulated, and confirm they are flat and legible.

### 5.2 Reviewer checklist

- [ ] **Base tokens are monotone.** Run:
      `grep -n 'oklch(' packages/ui/src/tokens.css | grep -vE '\-\-(danger|warn|success)-500|\-\-aurora-|\-\-grain|oklch\(0 0 0|oklch\(1 0 0'`
      Every line that survives that allowlist must have hue `80` and chroma ≤ `0.005`. Both `--text-tertiary` declarations (`:root` and the dark block) must appear as hue 80 — the dark one is the one that gets missed.
- [ ] `--ask-gradient` no longer exists anywhere. `grep -rn 'ask-gradient' apps packages | grep -v /dist/` returns nothing.
- [ ] Aurora appears on exactly the three surfaces in §4.1 and nowhere else. `grep -rn 'AuroraSurface\|data-aurora' apps packages | grep -v /dist/` — count the call sites: one per surface, plus the component and the export.
- [ ] No `.aurora` element also carries `.glass-surface`, and no `.aurora` contains another `.aurora`. Inspect the DOM, not the source.
- [ ] **Every chrome plate still reads as glass** (§4.4): on the ask panel, sampled OKLCH L over the ridge vs over paper inside the same plate differs by ≥ 0.02; no `.glass-surface` declares its own `background`; `grep -rn 'backdrop-filter' apps packages | grep -v /dist/` shows no `none` outside the `prefers-reduced-transparency` block.
- [ ] The rail's glass still blurs the canvas grid behind it (i.e. `contain` was not reintroduced). Compare against a pre-D6 screenshot of the rail.
- [ ] At 320 / 375 / 414 / 768 there is no horizontal scroll on any of the four screens.
- [ ] No blurred rectangle edge is visible inside any aurora box (the `calc(-2 * blur)` bleed is doing its job) — zoom the rail plate corners at 400%.
- [ ] The silhouette is legible as a contour, not a blob: on onboarding you can see the curved lower edge of the void with the orange rim under it; on the ask panel you can see a ridge with the peach band above it. If both look like concentric soft ellipses, the mask is not applying — check the `-webkit-mask-image` prefix first.
- [ ] **Neither §2.4 trap is present.** Run in the devtools console on a page with the ask panel open:
      `getComputedStyle(document.querySelector('.aurora__mass')).filter`
      It must print a `blur(...) drop-shadow(...)` pair. If it prints `none`, trap 2 is back. If the contour is crisp rather than soft, trap 1 is back.
- [ ] Grain is grey, not rainbow (the `feColorMatrix saturate 0` is present), and the tile is not noticeably darker in Chrome than in Safari (`color-interpolation-filters='sRGB'` is present).
- [ ] Text contrast measured against the darkest pixel behind it, not the average — `--text-secondary` ≥ 4.5:1 on the ask panel and on the onboarding card.
- [ ] Dark theme: `dawn`/`mist` read as glow, not stain.
- [ ] `prefers-reduced-motion` kills the drift; `prefers-reduced-transparency` kills the whole texture.
- [ ] Scrolling the inbox at 1440 stays smooth — no aurora surface is a scroll container, and there is no full-viewport blended layer.
- [ ] All five §1.4 accent regressions are fixed (rows 7, 8, 9, 11 changed; row 13 deliberately unchanged with a comment).
- [ ] `DESIGN-DIRECTION.md` line 6 is amended in the same commit (§0).

### 5.3 Anti-slop guards (reject on any one)

1. **No purple-gradient decoration.** A linear or conic gradient used as ornament anywhere — on a card, a header, a button, a badge, a divider — is an automatic reject. The aurora is a masked silhouette, blurred, clipped, and confined to three surfaces.
2. **Grain ≤ 10%.** Canvas 3.5%, aurora 8%. If the noise is legible as texture rather than felt as film, it is too strong.
3. **No glow on buttons.** No `box-shadow` with a chromatic colour, no coloured focus ring, no hover that adds colour. Buttons get `--state-hover` and nothing else.
4. **Aurora never sits under dense text.** Any surface with more than ~40 words on it puts those words on a scrim (`mist` counts as its own scrim, since it has no mass), or carries no aurora at all. Onboarding is the worked example: `void` behind, words on a card (§4.1.3). *One word changed from the previous draft — "uses `mist` and a scrim" would have made §4.1.3 a violation of a gate it actually satisfies.*
5. **One recipe.** Exactly one `.aurora` stack exists in the codebase (field + mass + grain + vignette). If a second bespoke gradient appears "just for this one panel", it is a reject. (`--aurora-orb` and `--aurora-stroke` are the two named exceptions in §4.1.2 and there are no others.)
6. **No rainbow accent.** `--accent` is graphite. Semantic colour is limited to `--danger-500`, `--warn-500`, `--success-500` and the brand channel glyphs. A fourth coloured UI token is a reject.
7. **Reads as glass, not a tinted panel.** A chrome surface (rail plate, ask panel, sheet, popover) whose fill is opaque, whose `backdrop-filter` is gone outside the reduced-transparency block, or whose tint carries chroma, is a reject — §4.4. The aurora is visible *through* the plate, never painted onto it.

Plus the standing 12-line list in `docs/design/SKILLS.md` — this section adds to it, it does not replace it.

### 5.4 Order of work for D6

1. §0 + §1 token pass (base neutrals, canvas wash removal, canvas grain, accent → ink **including all five regression fixes in §1.4**). Screenshot 1.
2. §2 `.aurora` class + `AuroraSurface` + export. Before going further, put a throwaway `<AuroraSurface variant="void">` at 420×560 on screen and check it against `ref-aurora-accent-2.png`: dark band, orange rim under it, lilac floor. If it is a solid rectangle the `-webkit-mask-image` prefix is missing; if it is crisp or unblurred, see §2.4. Do not build surfaces on top of a broken recipe.
3. §4.1.1 rail (`mist`). Screenshot 1 again, and confirm the glass still samples the canvas grid (§2.3).
4. §4.1.2 ask panel + orb + stroke (`dawn`). Screenshot 2.
5. §4.1.3 onboarding (`void`) — this one is new CSS, budget for it. Screenshot 3. Screenshot 4 needs no new work.
6. §3.3 drift last, behind the reduced-motion guard.

**Stop after step 1 and have it reviewed before continuing.** If the monotone base does not read well on its own, the aurora will not save it.
