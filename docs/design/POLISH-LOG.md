# P1 kinso polish — 2026-09-20

Baseline: `reference/kinso-inbox.webp`. For a before/after, look at `docs/design/screens/inbox-kinso.png` in git
(freshly captured from the Playwright e2e seed in this commit).

## What changed

1. **Brand color icons** (`packages/ui/src/lib/row-meta.ts` `CHANNEL_COLOR`,
   new `packages/ui/src/components/channel-glyph.tsx`): rail tiles and row right-side icons were all gray;
   they are now painted with each channel's brand hex (Slack #4A154B, LinkedIn #0A66C2, WhatsApp #25D366, Telegram #26A5E4,
   Outlook #0078D4 — exactly the values the task specified; Gmail/Google Calendar had no hex in the task, so they are
   approximated from Google's public palette: EA4335 / 4285F4). react-icons doesn't provide real multi-tone marks
   (the simple-icons source is a single monochrome path) — so most are "solid color glyphs", which corresponds to kinso's
   "some are white tiles + colored glyphs". KakaoTalk alone is the exception per the task spec (`CHANNEL_TILE_BG`):
   a black glyph on a #FFE812 brand-yellow tile — channel-rail.tsx and inbox-row.tsx share the same `ChannelGlyph`
   component, so the logic lives in one place.
2. **Agents rail tile**: painted the sparkle with `var(--accent)` (CHANNEL_COLOR.agent). The Inbox tile (black + white
   glyph), the 44px squircle, and the white plate + shadow were already correct from U1, so I left them alone.
3. **Agent session avatar runtime logo**: for Claude Code I replaced `SiClaudecode` (terminal logo) with the real
   Anthropic mark the task specified (`SiAnthropic`, react-icons/si). Hermes has no brand mark (not in this version of
   simple-icons), so it shows a single letter "H", the same pattern as the human avatar initials fallback
   (`RUNTIME_LETTER`, row-meta.ts). For Codex, the OpenAI mark isn't in this react-icons version, so it kept the existing
   lucide `Bot` icon (preserving the principle of not hand-drawing new SVGs) — once the OpenAI logo lands in the package,
   only `RUNTIME_ICON.codex` needs to change. Runtime avatar tiles also became squircles (30%) so they read differently
   from circular human avatars.
4. **Row layout**: removed the `margin-left: auto` that pushed the time to the end of the row — kinso tucks the time right
   next to the name ("Natasha Corwin 3m"); now it sits directly on the name line like "#omnis-launch • now". Names are
   15px semibold (600, 700 when unread) — previously read rows were 400 (regular), much thinner than kinso.
   The summary was already 14px + `var(--text-secondary)`, so I left it alone.
5. **Selected row card**: radius 14px → 8px (other card types are 20px/22px, and only rows were conspicuously large). Row
   padding 14px → 12px (the "12px vertical rhythm" the task specified).
6. **Status badge soft pill**: separated `.status-badge` from the label chips (outlined pills) it had been grouped with,
   replacing the border with a light fill background (`--bg-elevated`) — a "soft pill". Only blocked is emphasized with an
   accent-tone background + text (instead of the existing `--warn-500` orange — separating the "I need to look at this"
   signal from the label chips by color among herdr's 4 states).

## What's still different (honestly)

- **Avatars are initials/emoji, not circular photos**: the seed data has no photo URLs (`RowAvatar` already supports the
  photo case but nothing populates it yet), so not a single row shows a real face like kinso. This is a data problem, not
  in scope for this polish pass (layout/color).
- **Some agent session avatars fall back to initials**: when a seed `agent_sessions` combination doesn't link to
  `agent_runtimes`, `Inbox.tsx` falls back to `{kind:"initials", name:title}` instead of `{kind:"runtime"}` (a fallback
  that has existed since U2 and was untouched here) — the "claude_code · inbox-draft" row did display the Anthropic mark
  correctly in this seed, confirmed via screenshot.
- **Label chips are still outlined pills** (not soft pills) — the task specified soft pills only for status badges, so
  the chips stayed as-is. kinso itself has no label chips (none in the reference image), so kinso offers no answer here.
- **Gmail/GCal brand colors are approximations**: the task document gave no hex, so I estimated from Google's public
  palette (see the `ponytail:` comment in row-meta.ts) — if the exact values ever matter, change that one line.
- **There are no true "multi-tone" brand marks**: react-icons (simple-icons source) is one SVG path + a single color per
  brand, so something like the real 4-color Gmail logo in the kinso reference isn't achievable with this library.
  Handled as the task allows (monochrome glyph when there's no multi-tone) — I did not hand-draw new SVGs.

## US-D01 rework — hierarchy on glass, focus stroke, floating panel (2026-09-20, attempt 2)

The five blocking items the review raised, fixed at the root cause. Screenshots:
`screens/inbox-glass.png`, `screens/ai-panel.png`, `screens/ai-panel-commands.png`.

1. **State on glass darkens, it does not brighten.** Every new state layer was
   `color-mix(in oklch, var(--bg-base) N%, transparent)` — laying L≈0.99 on top of glass
   (`--bg-overlay` = `--gray-000` at 78%, L≈0.988), a 0.15% lightness difference, i.e. invisible
   (selected tab, hover and summary background alike). Fills are `--bg-elevated` now (L 0.97,
   about 12x the contrast) and hover is unified on a new `--state-hover` token
   (`color-mix(in oklch, var(--text-primary) 6%, transparent)`). Why `--state-hover` became a
   token: the same value was needed in five places, and being derived from the text colour it
   inverts for dark in one line. The pre-existing `[cmdk-item][data-selected]` already used
   `--bg-elevated`, so the grain matches.
2. **The focus gradient is a stroke again.** The two-layer "padding-box fill + border-box gradient"
   trick only holds while the fill is opaque — the moment the fill became glass (78%), 22% of the
   border-box layer showed through and the gradient tinted the whole ~820px pill rather than a
   1.5px edge (anti-slop #3, decorative gradient). The fill is left to `.glass-surface`, and a
   single `::after` ring with its middle masked out owns the stroke. `border-image` cannot follow
   `border-radius` and `outline` cannot take a gradient, so on a rounded pill this is the only way
   left.
3. **Typing is no longer a dead end.** The panel always opened on the "Suggestions" tab while
   `Command.List` rendered only on the "Commands" tab, so typing in the bar had cmdk filtering
   with nothing on screen (a regression against the inline palette that preceded US-D01). The tab
   is derived from the input now: empty = suggestions, non-empty = commands (">" lands here too),
   and pressing a tab directly holds that choice until the next keystroke. Three regression tests
   added.
4. **The floor for a disabled signal is 0.55** (hallmark slop-test:111). The Phase B actions and
   the attachment button, at 0.42/0.40, came up to 0.55 and got a "Phase B" tag at the right edge
   of the row — why it cannot be pressed is now visible.
5. **Panel proportion.** The 4.4:1 empty band that stretched to the full bar width (~820px) came
   down to a 420px card anchored under the orb, and the reference's conversation area now holds
   real context (thread title + state/summary). `transform-origin` moved from `top center` to
   `top left` to match that anchor.
6. **Closing is a spring too.** `{open && <AskPanel/>}` unmounts synchronously, so there was a
   240ms entrance and a hard cut on exit. `useClosingSpring` holds the panel in the DOM for
   `--dur-panel` and `.ask-panel--closing` replays the entrance path in reverse (apple-design §7,
   spatial consistency). Under reduced motion `--dur-panel` is 0ms, so the JS timer is matched to
   0 via `matchMedia`.
7. **@ is a permanent button.** The chip previously appeared only when `query.includes("@")` — an
   affordance visible only to someone who already knew to type "@", which teaches nothing. As in
   the reference there is a permanent button beside the attachment icon, and pressing it inserts
   "@" into the input. The chip still appears above it.

### Verification notes

- **anti-slop #11 (horizontal scroll at the four mobile sizes) does not apply to this shell.**
  Measured: at 320/375/414px there is horizontal scroll and the ask bar input collapses to zero
  width. But `apps/desktop/src-tauri/tauri.conf.json` sets `minWidth: 1024`, so those widths are
  unreachable. At the reachable 1024/1280/1440px (the widest layout, detail pane open) Playwright
  confirms no horizontal scroll. If the web build (`@omnis/web`) ever uses this shell, this needs
  revisiting.
- `.claude/skills/**` was added to `biome.jsonc`'s ignore list — the vendored OSS skills' tsconfig
  templates and fixtures were failing `pnpm lint` with 136 errors (since 353f0a7, unrelated to this
  story).
- **The ⌘K path was broken (a regression this branch introduced; e2e caught it).** US-D01 moved ⌘K
  from the modal palette to the ask panel but left A9 in `tools/e2e/phase-a.spec.ts` asserting the
  modal placeholder, so it failed; worse, ⌘K opened the panel without focusing its input, so
  neither Escape nor typing worked (the open panel then blocked list clicks, cascading into
  A-archive/G5). The input is focused on open (`onFocus` does not re-touch state when already
  open), and A9 was rewritten against the new surface: ⌘K → AI panel → type → command list →
  Escape closes. `pnpm e2e:phase-a` 38/38 PASS over two passes.

## US-D02 review 2 — the pill and density system (2026-09-21)

A pass that walked the rejected items back to their product meaning. More of them were the screen
saying the wrong thing than the pixels being wrong.

1. **The needs-approval tab is an action queue again.** Round 1 widened it to
   `approvalState !== null` (every thread that ever saw approval activity) in order to show several
   group headers — which made it an approval archive that decided and expired items never leave,
   still named "needs-approval". Reverted to `hasPendingApproval`. The lifecycle groups live in
   whichever view handles lifecycle when one exists (`groupByApprovalState` holds that order and is
   pinned by a pure-function test).
2. **An execution failure on an approved item is not called "rejected".** Folding
   `state='failed' + decision='accept'` (migrations/0004) into the rejected bucket tells the user
   they did something they did not do. The display states gained `failed` and `responded` (a
   counter-proposal — `allow_respond` is its own option, not a rejection).
3. **The hover card says only what the row cut off.** Round 1's card had a "Participants" field
   whose value was the same string as the card title (a panel repeating its own heading — the
   classic shape of a component built to fill one line of a spec). With no participant model, that
   line is gone; the card now holds the **full summary** the row ellipsises to one line, the
   **full labels** the row cuts to two chips + N, the **unread count** the row reduces to a dot,
   and the channel name.
4. **Counts moved outside the pill.** The tab pill row, the filter chip row and the group header
   stacked as three rows of near-identically sized small chips, which made the header read as a
   fourth filter. The reference (ref-issue-tracker-density.webp) puts the number in a **separate
   grey chip** beside the status pill with the + after it — that grammar, plus more space above the
   header than between rows. The `count` prop was deleted from `StatusPill` (if there are two ways
   to draw the number, both end up used).
5. **Chip wording unified.** The reference's English filter DSL with localised nouns bolted onto it
   is gone: the chip's field cell (`Label`) and its value cell (`one of 2`) both read in one
   language now.
6. **The cap came back to the `pending_approvals` query.** Round 1 dropped `.where(state,pending)`,
   so the client was replicating the entire approval history unbounded. Pending only, as the name
   says, `created_at desc` + `limit(200)` (the same cap as the items query right above it).
7. **A wrong design record was corrected.** Two comments in `app.css` cited the same reference and
   said opposite things (`status pill = rounded rect` vs `= capsule`); in the actual reference the
   status pill is a capsule and the filter chip is a bordered rounded rect. The comment also now
   records that the 12px radius comes from the brief's measured spec, not from the reference — this
   repository uses comments as the design record.
8. **a11y.** Group headers are interleaved with rows inside Virtuoso's `role="listbox"`, so they
   take `role="presentation"` (so AT does not count headers as options). The three new controls got
   `:focus-visible`/`:active` (hallmark gate 26).

### Evidence

Recaptured with `tools/e2e/shots.ts` (a one-shot capture script that adds density on top of the
e2e stack + seed). Round 1's screenshots were one pill, one row and 600px of empty white, which
proved nothing about a "density system".

- `screens/needs-approval.png` — 6 pending, pill + separate count chip + dense rows.
- `screens/agents-density.png` (new) — the four groups blocked → running → waiting → done. This is
  the screen where the group **order** is actually visible (the order `inbox-grouping.test.tsx`
  asserts).
- `screens/filter-chips.png` — after actually selecting two labels: the chip plus two ✓ in the
  popover.
- `screens/row-hover-card.png` — the full summary the row cut with `…`, three labels (the row shows
  2 + `+1`), the channel and 2 unread.

`pnpm e2e:phase-a` 38/38 PASS over two passes (no regression even though the new hover card mounts
a portal per row).

## US-D02 review 3 — one state, one colour; the row does not repeat the header (2026-09-21)

Round 2's rejection was not about pixels but about **the screen saying the same thing twice**.
There was a single common cause, so it was fixed as a rule rather than case by case: *a state is
stated in exactly one place on screen.*

1. **blocked is one colour.** The same "blocked" was red in the group header (`tone="danger"`) and
   blue (`--accent`) in the row badge 700px away — visible in `agents-density.png`. Round 2 aligned
   only the **labels** of the two surfaces, left the colours apart, and wrote a comment saying that
   one state must not be shown in two ways. The tone is pinned to `warning` now (blocked means "your
   turn", not an error — the error is `failed`, and the colour this repository already uses for
   "your turn" is `--warn-500`: `.inbox-row__approval-dot`), with `app.css` giving **one set of
   values to two selectors**. One rule cannot diverge.
2. **Rows inside a group do not repeat the header's state word.** The agents view read as
   "blocked / blocked / running / running" (the reference keeps the state word in the header only).
   When grouped, the row badge is off and the channel glyph takes the freed right slot — **the
   header carries the state, the row carries the channel**.
3. **The hover card's trigger row got a hover state.** The 400ms card is the core interaction of
   this task, yet `.inbox-row:hover` had no background, so in `row-hover-card.png` the card floated
   anchored to nothing (slop catalog K7). The fill is the same `--state-hover` as the other five
   places on this screen, and the radius is the selected row's 8px (the row must not change shape
   between pointing at it and choosing it — the fill does the distinguishing, not the shape). The
   selected row already floats as a white card, so no grey is laid over it.
4. **The group header came out of needs-approval.** That view queries `pending_approvals` with
   `.where("state","=","pending")` only, so there is **always exactly one group** — the header band
   just restated the tab name without carrying information (the "● pending 6" band in
   `needs-approval.png`). Only the number folded into the tab pill.
5. **Unreachable lifecycle code deleted.** The five branches of `approvalPillState`, the six entries
   of `APPROVAL_GROUP_ORDER`, the six states of `ApprovalStatusPill` — all values the query above
   cannot produce. Round 2's log said "it lives in the lifecycle view when one exists" and then left
   the code here anyway. It gets built there, when that view exists.
6. **The test believed to protect that code protected nothing.** The mock proxy in
   `inbox-grouping.test.tsx` discarded `.where()`, so it fed the screen rows production can never
   produce (executed/expired/failed) and asserted several groups on top of them. The mock now
   actually applies `=`/`!=` and throws on an operator it does not know (so nothing leaks quietly).
7. **Dead surfaces removed.** `.status-pill__count` CSS (orphaned in round 2 when the count moved to
   the header), `StatusPill.icon`/`dot`, `GroupHeader.onAdd` and `.group-header__add`. The
   "one-shot script (not committed)" comment in `shots.ts` was corrected to the truth, the file
   being committed — this repository uses comments as the design record (same reason as round 2,
   item 7).

### Found by actually using the screen

Two more, found by driving the screen for real (switching tabs → filtering by label → hovering).
Both are the same rule applied again.

8. **The per-row pending-approval dot is off inside needs-approval.** In that tab **every** row is
   pending, so the dot distinguishes nothing — the tab pill already states it (same rule as item 3:
   the row does not repeat what the level above said). In other tabs it still means "this row in
   particular is waiting for your decision", so it stays.
9. **The filter popover placeholder was in the wrong language for the surrounding UI**
   (`"Filter…"`). It inherits the field name now.

### Deliberately **not** done this round

- **The "+" in the group header** (part of (2) in the brief). omnis has no "start a new session in
  this state" flow, so drawing it produces a dead affordance that does nothing when pressed. Round 2
  created the `onAdd` prop and never used it in the app, which made it an undelivered, untested
  surface — this time the prop is gone too. It goes back in the header the day a session-creation
  flow exists.
- **`AgentStatusPill.failed`** — not a value that arrives independently from `agent_sessions.state`
  (the DB mapping in `row-meta.ts` folds failed into blocked). It exists in the type; it has no app
  path.

### Evidence

Four screenshots recaptured with `tools/e2e/shots.ts`, with at least two sessions per state — if
every group count is 1, that is four header rows, not a density system.

- `screens/agents-density.png` — blocked 2 → running 2 → waiting 2 → done 2. The state word is in
  the header only, every row's right slot is a channel glyph. The header pill's amber is the same
  value as the row badge amber on the same screen's `all` tab.
- `screens/needs-approval.png` — no header band, the tab reads `needs-approval 6`, no duplicate dot
  on the rows.
- `screens/filter-chips.png` — the label chip plus two ✓ in the popover, the tab count following the
  chip's scope.
- `screens/row-hover-card.png` — grey fill on the hovered row, the card emerging attached to it.

`pnpm lint` / `pnpm typecheck` pass, `pnpm test` 584 passed / 2 skipped, `pnpm e2e:phase-a` 38/38
PASS over two passes.

## US-D02 review 4 — a row grid collision, and "evidence that was not evidence"

The heart of round 3's rejection was not the pill system but that **the row layout was drawing on
top of itself**, and that a script incapable of catching that overlap was cited as proof there was
none.

1. **`.inbox-row__summary-line` took `grid-column: 2 / span 2` and invaded the right slot.**
   `.inbox-row__side` is `grid-row: 1 / span 2` and vertically centred, so **its lower half lands
   exactly on the label chip line.** The Slack mark on `#omnis-launch` sat on the `launch` chip, and
   the Gmail marks on `PoC slides` / `omnis launch sync` sat on `personal` / `launch` — visible in
   three of the four screenshots round 3 committed as its own evidence. Broken since US-A33
   (0354512); the fix is one line: the chips end at column 2.
2. **`shots.ts`'s "overflow 0px" says nothing about that overlap.** Page-level horizontal scroll
   (`scrollWidth - clientWidth`) cannot see two grid items sharing a cell **inside** a row — which
   is how "0px at all three widths" was true and meaningless at the same time. It now measures the
   actual bounding-box intersection of `.inbox-row__chips` and `.inbox-row__side` for every rendered
   row at every width. *This check was confirmed to actually fail*: reverting the CSS to the old
   `2 / span 2` throws
   `1024px: #omnis-launch (75.0x6.0px), PoC slides (75.0x7.0px), omnis launch sync (55.4x6.0px)` —
   exactly the three rows the rejection named.
3. **`agentState={grouped ? null : …}` reverted.** Nulling the state in the group view dropped
   runtime session rows to a channel glyph, so they announced themselves to a screen reader as a
   "Slack message". The fact that something is a session lives in `agentState` alone; "the header
   already states it" is said by the new `groupedByState` prop — when grouped, a session row's right
   slot is **empty** (it is not padded with an unrelated icon).
4. **The one-value filter chip drops the quantifier.** The value cell holds the bare name when
   there is one value (`[Label][launch]`) — the reference DSL folds the quantifier too ("Channel is
   Slack"), and "one of 1" is not something a person writes. The count grammar starts at two, where
   the value cell reads `one of 2`.
5. **Chip × button: 20px painted, 28x28 pointer.** The chip itself does not grow. Its height stays
   28px, the × is a 20px box centred in it (`margin-left: 2px`), and only the pointer target is
   widened, to 28x28, by `::after { inset: -4px }` — a 28px box in a 28px chip would touch the
   border top and bottom.
6. **One tint formula.** `.filter-chip` was using `color-mix(in oklch, …)` twenty lines below a
   `.status-pill` comment explaining that this very function rotates the hue toward
   `--bg-elevated`'s h260. One file had two formulas doing the same job and one of them was
   documented as wrong — unified on `oklch(from …)`. (US-D06 §1.4 row 11 later took even that tint
   out: at graphite the accent-derived fill landed at L0.97 on an L0.98 canvas, an invisible tint
   pretending to be one, so the chip's fill is the `--bg-elevated` surface token now.)

### A note on radius

999px / 50% / 30% / 22px / 20px / 12px / 10px / 8px / 6px coexist on one screen. Each has its reason
in a comment and it is the opposite of the uniform-radius tell, so they stay — but **there was no
stated scale for the next person to round to**, so it is written down as a table in
`DESIGN-DIRECTION.md` (filled out in round 5 against a full census of `app.css` to add 22/20/10px
and 50%, and to drop the 4px that no longer exists).

### Evidence

`pnpm lint` / `pnpm typecheck` pass, `pnpm test` 110 files / 586 passed / 2 skipped (round 3's 584 +
two InboxRow `groupedByState` cases). Four screenshots recaptured with `tools/e2e/shots.ts`, all
three widths reporting `overflow 0px, 0 chip/right-slot overlaps across 12 rows`.
`pnpm e2e:phase-a` was not run, to avoid disturbing other chains — it takes the shared ports
(5173/8787/4848) via `resetDatabase()`/`assertPortsFree()`, and `shots.ts` brings up the same stack.

## US-D02b rework — brand marks, responsive shell and list (2026-09-21, attempt 2)

Screenshots: `screens/responsive/{390,768,1024,1440}.png` (the visual record, unfiltered over a
densified list) and `screens/responsive/{…}-filtered.png` (one label filter on, which is what holds
the 40px filter-strip invariant down). Two passes because one set cannot do both jobs: a filtered
list is one row in an empty card, which shows nothing about density, and an unfiltered strip has
too little in it for the wrap assertion to mean anything.

This branch is English-only from the `main` merge onward (repo `CLAUDE.md`). Every comment, test
name and fixture string the US-D02b commits added is now English; `apps/desktop/src/app.css`,
`apps/desktop/src/screens/Inbox.tsx` and the components and tests this story touched were converted
in full rather than line by line.

1. **The time goes back next to the name.** Attempt 1 re-added `margin-left: auto` on
   `.inbox-row__time`, reversing the decision recorded above (kinso sets the time next to the name:
   "Natasha Corwin 3m") in a code comment alone. The drift that reversal was chasing came from
   titles wrapping to two lines, and `grid-template-columns: 40px minmax(0, 1fr) auto` plus the
   title ellipsis had already fixed it at the source. The `auto` is gone again and
   `.inbox-row__name` is `flex: 0 1 auto` — it shrinks but never grows, so it cannot push the time
   away. The far-right column holds the brand mark, as in the reference.
2. **The summary keeps its line at 390px.** `.inbox-row__chips` was `flex: 0 0 auto` beside a
   `flex: 1 1 auto` summary, so on a narrow pane the chips took the line and the AI summary — the
   row's reason to exist — collapsed to about two characters (`Draft: …`). The chips now
   `display: none` inside `@container list (max-width: 479.98px)`. Same failure class as the
   filter row this story was opened on: an unshrinkable child starving its sibling.
3. **Active filters lead the strip.** The label chip doing the filtering sat behind five
   always-present view pills, so at 390px it scrolled off the right edge behind the fade: a list
   cut to one row with nothing on screen saying why. The chips render in front of the pills now,
   in DOM order so the tab sequence matches. The `+ Label` trigger stays at the end as a second
   bar — moving one bar would remount its popover mid-selection and break multi-select.
4. **One rhythm in the collapsed rail.** `space-around` was applied at two scopes (the nav over two
   children, the plate over five), which left the Inbox tile hard left and stretched the other five
   to a ~142px pitch at 768px. `.channel-rail__plate` takes `display: contents` in the narrow tier,
   so all six tiles are children of the bar's own flex row, centred with `gap: min(5vw, 24px)`.
   The plate no longer has a box there, so `border-radius: 0` is gone and the `0` row has been
   removed from the radius table in `DESIGN-DIRECTION.md`.
5. **No dead controls.** The wide shell's More chevron had a label, a tab stop and no handler; it is
   a decorative `<span aria-hidden>` now, and the real trigger stays in the narrow tier. Account and
   Settings are gated with `disabled` and a title that says why, at the same 0.55 opacity floor the
   ask panel's un-wired actions use.
6. **A focus ring the strip can show.** `:focus-visible` on the filter chips only set `--state-hover`,
   which is the hover value, and the view pills and the Archived toggle had nothing. All four now
   take `outline: 2px solid var(--accent)` at `outline-offset: 1px`. `overflow-x: auto` forces the
   computed `overflow-y` to `auto`, so the strip's vertical padding (4px above, 6px below) is the
   room that ring needs — the row still measures 40px at every width.

### Evidence

`pnpm lint` and `pnpm typecheck` exit 0. `pnpm --filter @omnis/ui test` 18 files / 170 passed;
`pnpm --filter @omnis/desktop test` 10/11 files, 63 passed — the one failing suite
(`test/integration/zero-client.test.ts`, unresolved `@omnis/db`) is pre-existing and predates this
branch. `pnpm tsx tools/e2e/shots-responsive.ts` reports `overflow 0px` at 390/768/1024/1440 in both
passes, a filter row of 36–40px (never above the 40px cap) and a 57px rail pinned to the bottom edge
at 390 and 768.

## US-D03 — the detail pane, the one hairline table, and the person card (2026-09-21)

Baseline: the right-hand card in `reference/ref-dashboard-detail-card.webp`. New evidence:
`screens/detail-pane.png`; the four screens it re-shoots now carry eight distinct approval strings
where the fixture used to repeat one sentence three times.

### What changed

1. **`KeyValueTable` (`packages/ui`) is where hairlines are allowed.** 13px, label grey on the left,
   value right-aligned, one `1px` rule above every row but the first, and `data-numeric` switching the
   value to tabular figures for the times and counts. Both callers are fact sheets rather than prose:
   the thread's own meta and the hover card.
2. **The detail header takes the reference's card header** — title, one grey subline under it, the
   segmented control, three right-aligned icon actions. The subline is a tested pure function
   (`threadSubline`) joining `channel · people · last activity`, people capped at three plus `+N`.
   Archive is a real state change; Labels and More are disclosures, not icon-shaped decoration — an
   icon that does nothing when pressed is worse than no icon. `apps/desktop` has no radix dependency,
   so both are inline panels, which also keeps them out of the floating layer.
3. **`PersonCard`** is the shared identity block: avatar or initials with the pastel fallback, a badge
   row, then the same table (channels, last contact, relationship state, plus the caller's own rows).
   The hover card *is* that card for rows with a person behind them. An agent-session row has nobody
   behind it — its avatar slot holds the runtime logo — so it keeps the plain title + table form and
   omits the channel line rather than inventing a person to fill it.
4. **The approval stack** scopes to the open thread: that thread's riskiest, then newest, approval is
   the expanded and elevated card, its in-scope siblings lead the collapsed one-line rows, and the
   rest follow under a count header. Picking a collapsed row promotes it — and it leaves the list it
   came from, which was the first version's bug: it rendered in both places at once.
5. **Part of the bug was the fixture.** `densify()` rotated three sentences through `i % 3`, so any
   screenshot catching more than three approvals printed one of them twice, and three identical rows
   under a count read as a rendering fault rather than a queue. It now uses one sentence per thread
   with a per-thread fallback, which makes uniqueness structural instead of a longer list to outrun,
   and it spreads risk so the ranking has something to rank.

### Found by actually using the screen

- **The pill count was reading the wrong stage of the pipeline.** `pendingCount` said it counted
  "before the pill filter (labelFiltered)" and did not: `labelFiltered` returns `pillFiltered`
  untouched when no label is chosen, so the count was taken after the pill after all. The badge read
  0 on every tab whose own rows carry no approval — the agents view advertised an empty queue while
  eight approvals waited one tab away. It counts from `channelFiltered` now (the last stage genuinely
  upstream of the pill), with a test that holds the number steady across tabs. Nothing had noticed
  because the earlier rounds' fixtures had no pending approvals at all: the badge never drew, so it
  could not draw wrongly.
- The first `detail-pane.png` had the hover card sitting over the header the shot exists to show:
  Playwright's `click()` leaves the pointer on the row, which re-opens the card 400ms later. The
  pointer now parks off the list, and the script waits for the card to leave the DOM instead of
  sleeping past it.
- The pane's own table was behind the More icon, so the one component this story adds to the pane was
  the one thing its evidence could not show. The screenshot opens it.
- The stack looked mis-scoped and was not. Assuming one approval per thread is what made the expanded
  card look like the wrong one: the fixture puts two on `#omnis-launch` (the seed proposes one too),
  and the expanded card is the newest in scope with its sibling leading the collapsed rows. The
  `needs-approval 7` badge against eight approvals is the same fact twice — seven threads, eight
  approvals — not a disagreement.

### Deliberately not done this round

- Absolute dates in the meta table. `Created: now` is honest (the fixture thread really is created
  during the run), and `packages/ui` has exactly one time formatter on purpose; a second convention
  costs more than one fixture row is worth.
- `DraftCard`'s hardcoded Korean copy, which is visible in the pane shot. It is not this story's file
  and the branch's i18n sweep owns it — `ko.ts`/`en.ts` already carry `common.draftCard` for it.
- Reporting the pane's overflow at 390/768 from `shots-responsive.ts`: that sweep never opens a
  thread, so it never renders the pane, and below the 900px breakpoint the pane is a floating sheet
  over the list. The two widths went into `shots.ts`'s own probe loop instead, which has a thread
  open — the sheet is a third of the widths' surface that nothing had measured.

### Evidence

`pnpm lint` (692 files, no fixes applied) and `pnpm typecheck` (`tsc --build --force`) exit 0.
`@omnis/ui` 22 files / 194 passed. `@omnis/desktop` 68 passed across 10 files, with
`test/integration/zero-client.test.ts` still failing to collect on an unresolved `@omnis/db` — the
same pre-existing suite the round above recorded. `pnpm tsx tools/e2e/shots.ts` reports `overflow 0px`
and zero chip/side-slot overlaps across all 12 rows at each of 390/768/1024/1280/1440.

## US-D05 — the anti-slop audit, and an identity that was never a name (2026-09-21)

Baseline: `Skill(avoid-ai-design)` in `detect` mode and `Skill(hallmark) audit` over `apps/desktop`
and `packages/ui`, plus SKILLS.md's 12-line checklist and frontend-design's five clichés. Evidence:
the five screens `shots.ts` writes, re-shot; `screens/inbox-kinso.png` refreshed in place.

### What changed

1. **The Gmail adapter was using a mail header as a person's identity.** `normalize()` set
   `author.id` to the raw `From` value, so the id was `"Dana Lee <dana@example.com>"` — display name
   and mailbox in one string. Nothing downstream could resolve it: `kernel/ingest.ts` finds a
   person's display name by matching `author.id` against `threadMeta.participants[].externalId`, and
   `parseAddressList` had already produced those participants keyed by **mailbox** (with a comment
   saying the address is the identity). The lookup missed on both counts at once, so the kernel
   created a person named after the header and the inbox row printed that header in its bold
   first-line slot — `Dana Lee <dana@example.com>`, avatar initials `D<`. It is now the mailbox
   address, which is also what the 25 fixtures in the adapter's contract corpus now expect. This
   was the root cause; every symptom below was downstream of it.
2. **The screenshots had no hierarchy because B3 had nothing to summarize.** `seed()` is a replay of
   the adapter fixtures, and those fixtures are a contract corpus rather than prose: gcal's three
   events are one recurring series, so the `summary` gcal normalizes into *both* the thread title
   and the item body is the same sentence twice, and B3's fallback (subject, else the body's first
   line) wrote that sentence into `threads.meta.summary` — the row's own title printed underneath
   the row's own title. Gmail's bodies are headed `Subject: …\n\n`, so its fallback landed on a mail
   header. New `varyInboxCopy()` in `tools/e2e/seed.ts` gives the shot runs their own copy, keyed by
   the fixtures' own external ids. It is deliberately **not** inside `seed()`: phase-a's G5 ingests a
   marker into the first Slack thread and asserts it reaches that row, and `waitForSummaries` in
   `shots-accent.ts` is a B3 regression guard — neither survives a seed that arrives pre-summarized.
   It also waits for B3's `summary_at` before writing, because B3 owns that field until its 30s
   debounce fires and would otherwise clobber the copy.
3. **`DraftCard`'s provenance line was template chrome.** It read `omnis draft · rationale: …`:
   the middle dot is the `A · B · C` metadata separator (checklist 5), "rationale" is the *prop's*
   name rather than a word anyone using the app has met, and "omnis draft" is a lowercase machine tag
   standing where a sentence belongs. It is one sentence now — `Drafted from {sources}` — and
   `i18n/en.ts`'s `draftProvenance` holds the same wording.
4. **`RUNTIME_ICON.omnis` was a generic glyph in a map of real brand marks.** Every other entry is a
   mark out of `react-icons/si` or `/pi`, and the map's own comment says a runtime with no mark falls
   through to a letter (`RUNTIME_LETTER`) — Hermes is the documented case. `omnis: Sparkles` was the
   one entry that was neither, and it was standing for omnis's *own* identity, the single mark in the
   app that cannot come from someone else's set. Omnis's mark is the orb, and hand-drawing one is
   barred (CLAUDE.md), so the line is deleted rather than replaced and `omnis` falls through to `"O"`.
   A test pins the invariant: every defined value is a real logo, and omnis is not defined.
5. **Carried over from D2's review.** `filter-chip-bar.tsx` imported `LuSearch` from `react-icons/lu`
   while the other five `packages/ui` files use lucide-react's `Search`; it now matches, with the
   regression test asserting `svg.lucide-search`. And the filter-chip description in this log still
   described the old single-string chip — it is the split `[field][value][×]` chip.
6. **`densify()`'s approval strings and the calendar rows** now carry one sentence per thread and
   one-line summaries respectively, so no screenshot shows the same string twice.

### Checked and clean

- **1** — no warm-cream/serif/terracotta: no `#D97757`, `#F4F1EA` or `#FAF9F5` anywhere in `apps/desktop/src` or `packages/ui/src`.
- **2** — radius census matches the documented scale, and shadow use is three tokens plus one focus
  ring rather than one soft `rgba(0,0,0,.1)` under everything.
- **3** — every `linear-gradient`/`radial-gradient` in the app is a mask (`mask-image` for the fade
  edges), the aurora orb, or the glass tint. None is a decorative wash.
- **4** — no italic headings and no single-word colour emphasis.
- **5** — no `text-transform` or `uppercase` in any stylesheet or component; no spaced em dash in UI
  copy (the ` — ` hits are all in code comments).
- **6/7** — no invented metrics (the spend line reads `$0.00` because the fixture really is zero) and
  no re-drawn browser chrome.
- **9/10** — all four animated surfaces have a `prefers-reduced-motion` fade fallback, and the
  entrance is the one 160/240/320ms spring rather than a fade-up on every card.
- **11** — `overflow 0px` at 390/768/1024/1280/1440 in `shots.ts`, with zero chip/side-slot overlaps
  across all 12 rows at each width; `shots-accent.ts` reports the same at 390/1440.
- **12** — only `.inbox-row--selected` elevates; unselected rows draw no hairline.

### Deliberately not done this round

- **`threadSubline`'s middle dot** (`Thread.tsx:59`). It is the live `channel · people · last
  activity` line the detail pane documents, and it survives checklist 5 on its merits: the three
  fields are heterogeneous and one of them is itself a comma list, so a comma join would misparse,
  while the spaced em dash is another named flag. Checklist 5's target is the *reflexive* dot — the
  one standing in for structure that does not exist (item 3 above, now fixed), not a compact
  metadata line with three real fields behind it.
- **The middle dots in `packages/ui/src/i18n/*.ts`.** Nothing imports that module: it is the A5 §8
  copy deck, exercised by its own test and by nothing the user sees, so `digest.heading`,
  `restoredToast`, `systemDelegated`, the settings tooltips and their siblings have no render path to
  fix. Editing them would move the Korean in `ko.ts` too, and writing new Korean is
  barred by the repo's English-only rule.
- **`ask-panel`'s `Sparkles`** on "Summarize this thread" stays: unlike the runtime mark, the glyph
  carries meaning here (this action is the model's), and it sits beside `PenLine` and `ListChecks`,
  which are the same kind of icon.
- **The 13 non-`i18n` files carrying Korean comments.** Out of scope for a design task, and the
  English-only rule's own carve-out; reported to the reviewer rather than swept here.

### Evidence

`pnpm lint` and `pnpm typecheck` exit 0. `@omnis/ui` and `@omnis/adapters/gmail` green, including the
25 updated fixtures. `pnpm tsx tools/e2e/shots.ts` and `pnpm tsx tools/e2e/shots-accent.ts` both
complete, with the overflow assertions quoted above.
