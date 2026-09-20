# Accent system brief (Fable, 2026-09-21)

Logan's directive: the app's background and overall palette go MONOTONE; on specific surfaces (sidebar/rail, popups, sheets, AI panel, palette, empty/onboarding states) the accent follows the attached reference (portrait 480×960; the original file was not persisted — Logan may drop it into this folder as `ref-aurora-accent.png`). Faithful description of the reference: a paper-white, slightly warm background with visible fine film grain everywhere (like pushed 35mm film / dithered noise, ~6–10% luminance variance). Center-bottom holds a large, soft-edged, heavily blurred dark mass in deep indigo → navy (≈ oklch(30% 0.16 275) core, ≈ oklch(45% 0.2 270) mid), its edges bleeding into cobalt/periwinkle (≈ oklch(60% 0.18 265)) and a violet/magenta haze (≈ oklch(55% 0.2 310)) on the upper-right. Above the mass, where it meets the white, sits a warm bloom: amber/yellow (≈ oklch(85% 0.16 85)) fading through orange (≈ oklch(72% 0.19 45)) to coral/rose (≈ oklch(65% 0.2 15)) — like a sunset glow behind a hill. Towards the bottom the indigo dissolves into a cool light blue (≈ oklch(85% 0.06 230)) and then white. Everything is out of focus (gaussian blur radius ≈ 8–12% of the short side); no hard edges anywhere; luminance range from near-black to paper white; overall mood: quiet, cinematic, analog. Not identical copies: the same sensibility, color temperature, grain, softness and variation.

Plan (Fable):
1. Base = monotone. Neutral warm-grey scale for canvas/ink/borders; no hue-tinted base tokens; brand colors only on brand marks (already a rule).
2. One signature texture: "aurora" — layered radial gradients (indigo → cobalt → violet + amber/coral bloom) with heavy blur and film grain (SVG feTurbulence noise, low opacity), vignetting to the surface color.
3. Three named variants with different blob positions/temperature (e.g. dusk = indigo-heavy, dawn = amber-heavy, mist = faint), assigned deterministically per surface; optional very slow drift (≥60s) that respects reduced-motion.
4. Where it appears: rail plate backdrop (faint, behind glass), AI ask panel + its orb, command palette/sheet backdrops, onboarding/empty states, maybe the agents tile. Never on list rows, message bodies, tables, or as decoration on cards.
5. Text over aurora must keep contrast (overlay scrim or ink-on-mist only).
6. Anti-slop: this is a confined brand texture, not "purple gradient everywhere"; keep grain subtle; no glow on buttons.

Pipeline: Fable brief (this) → Opus structures it into `ACCENT-DIRECTION.md` (tokens, surface map, CSS technique, variants, acceptance screenshots) → DeepSeek implements as design-wave task D6 with Opus review.

## Update 2026-09-21 (Logan supplied the files + his own analysis)

Reference files now in this folder: `ref-aurora-accent.png` (image 1, soft) and `ref-aurora-accent-2.png` (image 2, high-contrast). Logan's analysis, use these values as the palette anchors:

**Image 1 — soft aurora.** A softly rolling mountain-shaped mass of deep indigo/blue occupies the lower center; upward it passes through a reddish peach and yellow into a bright white background. Fine noise texture; very soft, dreamy gradient.
- deep blue/indigo (bottom): `oklch(35% 0.15 270)`
- peach/coral (transition): `oklch(75% 0.1 30)`
- soft yellow (top): `oklch(90% 0.08 90)`
- bright background: `oklch(98% 0.01 270)`

**Image 2 — high-contrast void.** Much stronger contrast: a heavy dark "void" curves across the center; the top is a vivid deep blue; the lower edge of the void glows intense orange/red and fades into lavender/pink at the very bottom. Coarse, rough film-grain noise is a defining feature.
- vivid deep blue (top): `oklch(40% 0.16 260)`
- dark shadow (center): `oklch(15% 0.02 280)`
- glow orange/red (lower edge): `oklch(60% 0.22 35)`
- lavender pink (bottom): `oklch(85% 0.08 320)`

**Noise is mandatory**: add visible film grain so surfaces read like an analog "space aurora" filter photo — finer grain for image-1-style variants (mist/dawn), coarser for image-2-style (dusk/void). Grain must stay a texture, not dirt: no grain on text, contrast preserved.

Variant mapping suggestion: `dawn` ← image 1 (soft, warm bloom), `dusk`/`void` ← image 2 (high contrast, orange rim), `mist` ← image 1 at 30–40% intensity.

## Update 2026-09-21 (glass stays, even with aurora + grain)

Reference `ref-glass-sidebar.png` (Logan): a frosted-glass sidebar over a blurred blue wallpaper, shown expanded (~300px) and collapsed (~72px, icon rail). Read it as the rule for every chrome surface: **however much aurora color and grain a sidebar/popup/sheet/AI panel carries, it must still read as glass** — translucent (the canvas/aurora behind it shows through, blurred), a 1px inner light edge, soft wide shadow, large corner radius (~24px on the container), inner opaque white cards for content groups, a single saturated accent for the selected item (blue pill in the reference), avatar stacks + red count badges, section labels with counts ("Menu: 6", "Service: 3"), and a big primary CTA at the bottom.

Implications for ACCENT-DIRECTION.md:
- Layer order on chrome: canvas → aurora (blurred, grainy) → glass plate (backdrop-filter blur + saturate, translucent white tint 55–70%) → content. The aurora is BEHIND the glass, never painted on top of content.
- Grain belongs to the aurora layer (and optionally a faint 2–3% grain on the glass tint), not to text or cards.
- The rail should support expanded/collapsed states exactly like the reference (labels + right-side affordances when expanded; icons only when collapsed), animated with the project's spring tiers.
- Section grouping inside the rail: Inbox/Today/Tasks/Network/Notes (menu), connected channels (services, with "+ connect"), settings/profile at the bottom.
