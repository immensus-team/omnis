# LENS: Glass + Motion — Apple Liquid Glass / visionOS-style surfaces and spring motion on the web

Scope: tasteful glass surfaces and spring-based motion for omnis's floating layer only (sidebar rail, ⌘K palette, AI chat panel, sheets/dialogs, list-selection elevation). Per `DESIGN-DIRECTION.md`, lists and message bodies stay opaque — glass is reserved for the navigation/floating layer.

## Products studied (URLs)

- Apple Human Interface Guidelines — Materials / Liquid Glass (iOS 26, macOS 26 "Tahoe"): [MobileAction — Apple Liquid Glass design in iOS 26](https://www.mobileaction.co/blog/apple-liquid-glass-design/), [MockFlow — Designing iOS 26 Screens with Liquid Glass](https://mockflow.com/blog/designing-ios-26-screens-with-liquid-glass-design), [createwithswift.com — Liquid Glass: Hierarchy, Harmony, Consistency](https://www.createwithswift.com/liquid-glass-redefining-design-through-hierarchy-harmony-and-consistency/), [let's dev — iOS 26 Liquid Glass: Usability vs Accessibility](https://letsdev.de/en/blog/ios-26-in-detail-liquid-glass-ui-between-usability-and-accessibility.php), [giorgio-a11y/liquid-glass-guide (GitHub)](https://github.com/giorgio-a11y/liquid-glass-guide/blob/main/LIQUID-GLASS-GUIDE.md)
- Motion (motion.dev, formerly Framer Motion) — spring physics API and React transitions: [motion.dev/docs/spring](https://motion.dev/docs/spring), [motion.dev/docs/react-transitions](https://motion.dev/docs/react-transitions)
- Linear — spring-based list reordering and micro-animation philosophy: [Linear — Behind the latest design refresh](https://linear.app/now/behind-the-latest-design-refresh), [linearity.io — UI animation guide](https://www.linearity.io/blog/ui-animation-guide/)
- Raycast — dark glass command palette, layered shadow/border system: [oh-my-design.kr — Raycast Design System](https://oh-my-design.kr/design-systems/raycast), [getdesign.md/raycast](https://getdesign.md/raycast/design-md)
- Vercel — Web Interface Guidelines, restrained micro-interactions and elevation-via-border: [vercel.com/design/guidelines](https://vercel.com/design/guidelines), [designmd.cc/benchmarks/vercel](https://designmd.cc/benchmarks/vercel)
- CSS glassmorphism implementation reference (blur/saturate values, browser support): [dev.to — Glassmorphism effect with backdrop-filter](https://dev.to/nickbenksim/glassmorphism-effect-with-backdrop-filter-16jh), [design.dev — Backdrop Filter Playground](https://design.dev/tools/backdrop-filter-playground/)
- "AI slop" critique (purple gradients, over-glass) as a negative reference: [SmoothUI — AI Design Slop](https://smoothui.dev/blog/ai-design-slop), [dev.to — The Purple Gradient Problem](https://dev.to/james_anderson_h/the-purple-gradient-problem-why-ai-ui-all-looks-alike-and-how-to-fix-it-3j65), [uxskill.laithjunaidy.com — Why AI always reaches for the purple gradient](https://uxskill.laithjunaidy.com/blog/why-ai-uses-purple-gradients.html)

## Patterns worth adopting

### 1. Glass only on the floating navigation layer, never on content
**What:** Apple's own guidance: "Liquid Glass is best reserved for the navigation layer that floats above the content of your app" — sidebars, toolbars, tab bars, sheets, floating panels. Content (lists, text, cards you read) stays on an opaque material.
**Why it works:** Glass communicates "this sits above everything else, temporary/contextual" — a spatial cue, not decoration. Glass over long-form text or dense list rows reduces legibility and makes the eye do contrast-correction work on every scroll frame.
**Implementation notes for omnis:** Apply glass exactly to: channel rail, ⌘K palette, the floating AI chat panel, and modal sheets (approval dialog, settings sheet). Inbox rows, thread body, and the detail panel's content area stay opaque white/off-white per `DESIGN-DIRECTION.md`. This is already the stated rule — treat it as non-negotiable, not aspirational.
**Effort:** S (constraint, not new code)

### 2. Blur + saturate together, not blur alone
**What:** Apple's recipe (and the common CSS glassmorphism recipe) is `backdrop-filter: blur(20-24px) saturate(180%)` with a translucent fill (`rgba(255,255,255,0.6-0.7)` on light) and a 1px hairline border at 10-20% opacity to define the edge.
**Why it works:** Blur alone desaturates and muddies whatever sits behind the glass; saturate(180%) restores the color intensity the blur removes, so the glass reads as "frosted" rather than "grayed out." The hairline border is what separates a glass panel from the page behind it when both are near-white — without it, edges disappear on a light canvas.
**Implementation notes for omnis:** Channel rail and ⌘K palette: `backdrop-filter: blur(20px) saturate(180%)`, background `rgba(255,255,255,0.65)`, border `1px solid rgba(0,0,0,0.06)`, plus one soft drop shadow (`0 8px 24px rgba(0,0,0,0.08)`) to lift it off the canvas. Ship a solid-color fallback (`background-color` without transparency) behind an `@supports not (backdrop-filter: blur(1px))` query and respect the OS "reduce transparency" setting via `prefers-reduced-transparency` where supported.
**Effort:** S

### 3. Spring transitions with a "visual duration," not raw stiffness/damping tuning
**What:** motion.dev's `spring()` exposes `bounce` (0-1) and `visualDuration` (seconds) instead of forcing hand-tuned stiffness/damping/mass. `visualDuration` is roughly "how long the motion looks like it takes to settle," with the residual bounce happening after that window.
**Why it works:** This is far easier to reason about and keep consistent than tuning raw physics constants per component, and it composes cleanly with time-based sibling animations (e.g. an opacity fade timed alongside a spring move).
**Implementation notes for omnis:** Use `visualDuration` matching the three tiers already fixed in `DESIGN-DIRECTION.md` (entry 160ms, transition 240ms, layer appearance 320ms) with low bounce (0.1-0.15) — enough to feel alive, not enough to oscillate. Example for the AI panel opening: `spring({ visualDuration: 0.32, bounce: 0.12 })`. Never use `ease-in` for entrances (motion.dev/accessibility consensus) — use ease-out or spring for anything appearing, spring or ease-in-out for anything settling in place.
**Effort:** S (once motion library is chosen — Motion for React is the natural fit given the stack)

### 4. Elevate-on-select via a soft shadow + subtle scale, not a border
**What:** kinso's own reference pattern (already in `DESIGN-DIRECTION.md`): selected inbox row gets a white card background + soft shadow, unselected rows have no hairline. Linear's list reorder uses spring physics so a dragged/reordered item overshoots slightly then settles, rather than snapping.
**Why it works:** A shadow-based elevation reads as "this item lifted toward you," which matches the glass/depth metaphor everywhere else in the app, whereas a border-based selection reads as flat/static and clashes with the glassy chrome around it.
**Implementation notes for omnis:** On row selection: animate `box-shadow` from none to `0 2px 8px rgba(0,0,0,0.08)` and `transform: translateY(-1px) scale(1.002)` over the 160ms entry spring. On list reorder (e.g. drag-to-reprioritize in Tasks view), animate `transform` with a spring (`bounce: 0.15-0.2`) so the moved row briefly overshoots its target position before settling — this is what makes a reorder feel physical rather than teleported.
**Effort:** M (drag-reorder is the only nontrivial part; selection elevation alone is S)

### 5. Restraint as the default: CSS transitions over JS springs for anything that isn't a "moment"
**What:** Vercel's guideline: buttons/links animate only `background-color`/`color` on hover with plain CSS transitions (~200ms), no scale/translate/fade theatrics; box-shadow-as-border (`0 0 0 1px rgba(0,0,0,0.08)`) gives depth without heavier shadow stacks; CSS is preferred over main-thread JS animation wherever possible.
**Why it works:** Spring physics and glass are expensive attention — reserved for state changes that matter (a panel opening, a row selected, an approval granted). Using them on every hover trains the eye to ignore all motion, and burns a JS animation library's overhead on things `:hover { transition: color 150ms }` already does for free.
**Implementation notes for omnis:** Reserve motion.dev/spring for: panel open/close, row selection, list reorder, approval-card success state, agent status badge changing (idle→working→blocked→done). Everything else (button hover, tab underline, filter pill toggle) is a plain CSS `transition: 150-200ms ease-out` on `color`/`background-color`/`border-color`/`box-shadow` only — never `width`/`height`/`padding`/`margin` (these force layout and stutter).
**Effort:** S

### 6. Layered shadow + inset highlight for glass "thickness" on dark surfaces
**What:** Raycast's glass palette uses `backdrop-filter: blur(48px)` + a 1px border + a multi-layer box-shadow with an inset highlight, simulating a physically raised/pressed glass surface rather than a flat translucent rectangle.
**Why it works:** A single flat blur reads as "photoshopped transparency." Adding an inset light-catching edge (`inset 0 1px 0 rgba(255,255,255,0.08)` on a dark surface, or `inset 0 1px 0 rgba(255,255,255,0.4)` on light) plus an outer shadow gives the glass a sense of physical thickness, matching how Liquid Glass actually refracts and catches light at edges.
**Implementation notes for omnis:** On the ⌘K palette and AI chat panel (the two highest-attention glass surfaces), stack: outer `box-shadow: 0 12px 32px rgba(0,0,0,0.12)`, `border: 1px solid rgba(0,0,0,0.06)`, and `inset 0 1px 0 rgba(255,255,255,0.5)` for the top-edge highlight. Skip this on the channel rail (lower attention, always visible — keep it cheap and static).
**Effort:** S

### 7. Interruptible, position-continuous transitions (Apple's core motion principle)
**What:** Apple's HIG motion principle — an in-flight animation must be interruptible and continue from its *current* position/velocity if the user acts again mid-transition, never restart from the origin or jump-cut to the new target.
**Why it works:** A user closing the AI panel while it's still opening, or re-selecting a different row while the previous selection's shadow is still animating in, is common with real usage speed. A hard restart or jump reads as broken/laggy even when the animation itself is smooth.
**Implementation notes for omnis:** Use motion.dev's spring transitions (which are inherently interruptible/velocity-continuous by default, unlike keyframe/`transition` CSS which restarts) for anything that can be re-triggered quickly: panel open/close, row selection change, sheet dismiss. This is one of the few places where reaching for a JS animation library over plain CSS is justified even for a "simple" toggle.
**Effort:** M (requires the animation library on these specific components, not CSS)

## Patterns to avoid

- **Glass everywhere.** Glassmorphism on cards, list rows, or message bodies is the exact "AI slop" tell called out across multiple 2026 critiques (SmoothUI, dev.to) — it is becoming as recognizable a generic-AI signal as the purple gradient. omnis's own design direction already restricts glass to the floating layer; do not let it creep into content during implementation.
- **Purple/violet-to-blue gradients anywhere as decoration.** Flagged repeatedly as the single strongest "this was AI-generated" signal (2020-2023 Series-A startup house style baked into training data). omnis's palette should stay on the warm off-white / neutral system already specified; the only gradient in the design direction is the omnis orb in the search bar, and it should not spread to buttons, backgrounds, or empty states.
- **Bounce/scale on every hover.** A generic AI-slop fingerprint alongside gradients — hover states on buttons that scale, bounce, or wobble on ordinary controls. Reserve springy motion for real state changes (see Pattern 5); plain color/opacity transitions everywhere else.
- **Ease-in for anything entering or appearing.** Consistently called out as wrong across sources — ease-in starts slow, which makes an appearing element feel like it's dragging itself onto screen. Use ease-out or spring for entrances.
- **Ignoring `prefers-reduced-motion` / `prefers-reduced-transparency`.** Not optional — both should be checked and respected: disable/shorten springs and fall back to instant or near-instant opacity changes under reduced motion, and fall back to a solid (non-blurred) fill under reduced transparency.
- **Animating layout properties (`width`, `height`, `padding`, `margin`) for motion.** Forces reflow on every frame and stutters on lower-end hardware (a real concern for a PWA target on older iPhones); animate `transform` and `opacity` only.
- **Six identical glass cards in a row.** Uniform-grid-of-glass-cards with no hierarchy is one more named AI-slop tell (alongside purple gradients) — relevant if the Network/people-card view or dashboard-style views get built; vary size/weight or use a list, not a repeated card grid, for anything that isn't genuinely a symmetric collection.

## Open questions

- **Which animation library:** Motion (motion.dev) for React is the natural fit for interruptible springs (Pattern 3, 7), but per `DESIGN-DIRECTION.md`'s "don't build it yourself" principle, confirm this isn't already pulled in transitively via `cloudflare/agentic-inbox` or another borrowed pattern before adding a new dependency.
- **`backdrop-filter` performance on the Tauri desktop shell vs. iPhone PWA:** blur(20-24px) is cheap on modern Safari/WebKit but worth a real device check on an older iPhone in PWA mode before committing the value app-wide; may need a lighter blur (12-16px) on mobile.
- **Does Liquid Glass's "lensing"/specular-highlight-on-device-motion effect (gyroscope-reactive) have any web equivalent worth chasing**, or is that specifically a native-only affordance we should not attempt to fake on the web (current lean: skip it — faking it risks landing exactly in the "trying too hard" over-glass trap called out above).
- **Exact reduced-transparency fallback color** for the channel rail and AI panel needs a real value once the base off-white canvas token is finalized elsewhere in the design system (not yet confirmed against `DESIGN-DIRECTION.md`'s token file).
