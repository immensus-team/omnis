import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, Inbox as InboxGlyph, Settings, User } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "../lib/cn.js";
import { CHANNEL_LABEL } from "../lib/row-meta.js";
import type { UiChannel } from "../types.js";
import { ChannelGlyph } from "./channel-glyph.js";
import { GlassSurface } from "./glass-surface.js";

// U2: the channel labels (CHANNEL_LABEL) live in lib/row-meta.ts — shared with inbox-row.tsx
// (keeping them here made a circular import). US-D02b: the mark itself is ChannelGlyph's job
// (lib/row-meta.ts CHANNEL_BRAND_ASSET), so both files render it the same way.

/** null = the "Inbox" tile (show everything). The Agents tile uses the same filter grammar as the
 *  other channel tiles (rail selection = channelFilter) but is a fixed rail element, present
 *  whether or not an agent account is connected. */
export type RailSelection = UiChannel | null;

export interface ChannelRailProps {
  /** Connected channels (accounts), de-duplicated, in display order. */
  channels: UiChannel[];
  selected: RailSelection;
  onSelect: (selection: RailSelection) => void;
}

/** US-D02b: the breakpoint at which the rail folds down into a bottom bar. It must be the **same
 *  number** as app.css's `@container shell (max-width: 899.98px)` — React cannot read the result of
 *  a CSS container query (it is neither the window width nor the shell box width), so the value is
 *  written in both places. This slice does not share the literal between CSS and TS: change it in
 *  one file and you change it in the other. */
const NARROW_RAIL_QUERY = "(max-width: 899.98px)";

/** Upper bound on the `tiles` that stand in the bottom bar — the Inbox tile is separate and is not
 *  counted here. */
const NARROW_RAIL_TILE_LIMIT = 4;

/** jsdom has no matchMedia — without it we fall back to the wide shell (the same defence as
 *  command-palette.tsx's panelExitMs). The wide tier is the rail as it has always been, so that is
 *  what the tests see; the narrow tier is for the CSS container queries and a real browser. */
function mediaQuery(query: string): MediaQueryList | null {
  try {
    return window.matchMedia(query);
  } catch {
    return null;
  }
}

function useNarrowRail(): boolean {
  const [narrow, setNarrow] = useState(() => mediaQuery(NARROW_RAIL_QUERY)?.matches ?? false);
  useEffect(() => {
    const mq = mediaQuery(NARROW_RAIL_QUERY);
    if (!mq) return;
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

/** Phase B gate. Account and Settings have no screen behind them yet, so they are rendered
 *  disabled with a title that says why rather than as labelled buttons that announce as actionable
 *  and then do nothing — the same treatment `.ask-panel__action:disabled` already gives un-wired
 *  actions in app.css. */
const PHASE_B_TITLE = "Not wired up yet — Phase B";

export function ChannelRail({ channels, selected, onSelect }: ChannelRailProps) {
  // Agents is a fixed rail tile rather than a connected account — if an agent account does exist,
  // it takes that same slot instead of being appended twice.
  const tiles = channels.includes("agent") ? channels : [...channels, "agent" as const];
  const narrow = useNarrowRail();
  // Narrow shell: at most four tiles stand in the bar. The rest, along with the avatar and
  // settings, move into the More popover — pushing tiles into a 320px bar indefinitely walks the
  // last one off screen, and horizontal overflow is the one thing this layout may never do.
  const barTiles = narrow ? tiles.slice(0, NARROW_RAIL_TILE_LIMIT) : tiles;

  return (
    <nav className="channel-rail" aria-label="Channels">
      <button
        type="button"
        className={cn("channel-rail__tile", "channel-rail__tile--inbox")}
        aria-pressed={selected === null}
        aria-label="Inbox"
        onClick={() => onSelect(null)}
      >
        <InboxGlyph size={18} aria-hidden="true" />
      </button>
      {/* US-D01: the plate used to be opaque white, which read as "a board laid on the canvas" and
          nothing more. It is real glass now (blur + saturate + tint + inner highlight + soft
          shadow = .glass-surface). The tiles stay on top of it — brand marks still read over glass.
          US-D02b: in the narrow shell this plate lies down into the row that fills the bottom bar
          (app.css gives it `display: contents` there), and the bar itself carries the glass — glass
          is never stacked on glass. */}
      <GlassSurface slot="sidebar" className="channel-rail__plate">
        {barTiles.map((channel) => (
          <button
            key={channel}
            type="button"
            className={cn(
              "channel-rail__tile",
              selected === channel && "channel-rail__tile--active",
            )}
            aria-pressed={selected === channel}
            aria-label={CHANNEL_LABEL[channel]}
            onClick={() => onSelect(channel)}
          >
            <ChannelGlyph channel={channel} size={18} />
          </button>
        ))}
        {narrow ? (
          <RailOverflowPopover
            tiles={tiles.slice(NARROW_RAIL_TILE_LIMIT)}
            selected={selected}
            onSelect={onSelect}
          />
        ) : (
          // In the wide shell there is nothing to overflow, so the chevron is a mark, not a
          // control: a <span>, out of the tab order and silent to a screen reader. It was a
          // labelled <button> with no handler, which is the classic copied-the-affordance-without-
          // the-behaviour tell. The narrow tier's chevron above is the real trigger.
          <span className="channel-rail__more" aria-hidden="true">
            <ChevronDown size={16} />
          </span>
        )}
      </GlassSurface>
      {narrow ? null : (
        <>
          <div className="channel-rail__spacer" />
          <button
            type="button"
            className="channel-rail__tile channel-rail__avatar"
            aria-label="Account"
            title={PHASE_B_TITLE}
            disabled
          >
            <User size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="channel-rail__icon-button"
            aria-label="Settings"
            title={PHASE_B_TITLE}
            disabled
          >
            <Settings size={16} aria-hidden="true" />
          </button>
        </>
      )}
    </nav>
  );
}

/** The narrow shell's More popover: the tiles that did not fit in the bar, plus the avatar and
 *  settings. Unlike the 44px bar tiles there is room for words here, so each icon gets a label —
 *  an icon alone does not say which channel it is. The Radix Popover grammar is the same one
 *  filter-chip-bar.tsx's AddFilterPopover uses; this repo does not grow a second way to build a
 *  floating panel. */
function RailOverflowPopover({
  tiles,
  selected,
  onSelect,
}: {
  tiles: UiChannel[];
  selected: RailSelection;
  onSelect: (selection: RailSelection) => void;
}) {
  // Choosing a channel closes the popover (AddFilterPopover stays open because it is multi-select;
  // here one pick is the whole interaction).
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className="channel-rail__more" aria-label="More" title="More">
          <ChevronDown size={16} aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="glass-surface channel-rail__popover"
          data-glass-slot="palette"
          side="top"
          align="center"
          sideOffset={8}
        >
          {tiles.map((channel) => (
            <button
              key={channel}
              type="button"
              className="channel-rail__popover-row"
              aria-pressed={selected === channel}
              onClick={() => {
                onSelect(channel);
                setOpen(false);
              }}
            >
              <ChannelGlyph channel={channel} size={18} />
              <span>{CHANNEL_LABEL[channel]}</span>
            </button>
          ))}
          {/* The two that stand at the foot of the wide rail — gated here for the same reason. */}
          <button
            type="button"
            className="channel-rail__popover-row"
            title={PHASE_B_TITLE}
            disabled
          >
            <User size={18} aria-hidden="true" />
            <span>Account</span>
          </button>
          <button
            type="button"
            className="channel-rail__popover-row"
            title={PHASE_B_TITLE}
            disabled
          >
            <Settings size={18} aria-hidden="true" />
            <span>Settings</span>
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
