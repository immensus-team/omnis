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
