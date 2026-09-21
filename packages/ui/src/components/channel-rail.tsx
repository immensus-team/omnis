import * as Popover from "@radix-ui/react-popover";
import {
  ChevronDown,
  Inbox as InboxGlyph,
  ListChecks,
  Moon,
  NotebookPen,
  Settings,
  Sun,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import { cn } from "../lib/cn.js";
import { useNarrowShell } from "../lib/media-query.js";
import { pointerDrag } from "../lib/pointer-drag.js";
import { applyOrder, moveTile, readRailOrder, writeRailOrder } from "../lib/rail-order.js";
import { CHANNEL_LABEL } from "../lib/row-meta.js";
import type { UiChannel } from "../types.js";
import { AuroraSurface } from "./aurora-surface.js";
import { ChannelGlyph } from "./channel-glyph.js";
import { GlassSurface } from "./glass-surface.js";

// U2: the channel labels (CHANNEL_LABEL) live in lib/row-meta.ts — shared with inbox-row.tsx
// (keeping them here made a circular import). US-D02b: the mark itself is ChannelGlyph's job
// (lib/row-meta.ts CHANNEL_BRAND_ASSET), so both files render it the same way.

/** null = the "Inbox" tile (show everything). The Agents tile uses the same filter grammar as the
 *  other channel tiles (rail selection = channelFilter) but is a fixed rail element, present
 *  whether or not an agent account is connected. */
export type RailSelection = UiChannel | null;

/** The screens the shell can show. The rail navigates by screen rather than by route — there is no
 *  URL router in the desktop app. Declared and exported here because packages/ui may not import
 *  from an app: apps/desktop/src/App.tsx's ShellScreen is an alias of this type. */
export type RailScreen = "inbox" | "today" | "tasks" | "network" | "notes" | "digest" | "settings";

/** One screen's rail entry: the tile in the wide rail is the same thing as the row in the narrow
 *  popover, so both are drawn from this one list. `shortcut` is the letter the keymap resolves
 *  (hooks/use-keymap.ts GOTO_KEYS) and the same one the palette's Navigate action shows — the title
 *  is the only place the rail can say it, since the tiles are icon-only. */
interface RailScreenEntry {
  screen: RailScreen;
  label: string;
  icon: LucideIcon;
  shortcut: string;
}

/** The five screens that stand as tiles in the wide rail, in the order they are drawn there. */
const SCREEN_TILES: RailScreenEntry[] = [
  { screen: "today", label: "Today", icon: Sun, shortcut: "g t" },
  { screen: "tasks", label: "Tasks", icon: ListChecks, shortcut: "g k" },
  { screen: "network", label: "Network", icon: Users, shortcut: "g n" },
  { screen: "notes", label: "Notes", icon: NotebookPen, shortcut: "g o" },
  { screen: "digest", label: "Digest", icon: Moon, shortcut: "g d" },
];

/** The sixth screen. In the narrow popover it is a row like the five above; in the wide rail it is
 *  the button at the foot rather than a tile, so it is kept out of SCREEN_TILES. */
const SETTINGS_ENTRY: RailScreenEntry = {
  screen: "settings",
  label: "Settings",
  icon: Settings,
  shortcut: "g s",
};

/** The popover's own list: the five tiles, then Settings. One array, so a screen cannot be missing
 *  from the tier that cannot show the wide rail's tiles. */
const POPOVER_ENTRIES: RailScreenEntry[] = [...SCREEN_TILES, SETTINGS_ENTRY];

export interface ChannelRailProps {
  /** Connected channels (accounts), de-duplicated, in display order. */
  channels: UiChannel[];
  selected: RailSelection;
  onSelect: (selection: RailSelection) => void;
  /** The screen the shell is showing. It is what the rail's own tiles mark as current, and what
   *  tells the channel tiles whether they are even on screen. */
  screen: RailScreen;
  onScreenChange: (screen: RailScreen) => void;
}

/** Upper bound on the `tiles` that stand in the bottom bar — the Inbox tile is separate and is not
 *  counted here. */
const NARROW_RAIL_TILE_LIMIT = 4;

/** D7 §c.2: a touch has to hold this long before a tile lifts. Below it, and for any movement past
 *  the primitive's 8px cancel distance, the gesture belongs to the browser's scroll. */
const TOUCH_HOLD_MS = 350;

/** D7 §c.2: the tile's lift while it is held — the haptic-like "picked up" cue, over --dur-fast. */
const LIFT_SCALE = 1.08;

/** One running drag. The lifted tile owns a working copy of the order for the length of the
 *  gesture and the store is written once, on drop — a reorder that lands two slots away in a single
 *  pointer event is still one splice, and an abandoned drag never touches the store at all. */
interface DragState {
  id: UiChannel;
  axis: "x" | "y";
  /** The full order, mutated copy — includes the tiles the narrow tier has pushed into More, so a
   *  drop writes the whole rail and not just the four that are on screen. */
  order: UiChannel[];
  /** The lifted tile's index in `order`. Held here rather than read back from state, because state
   *  is one render behind the pointer. */
  index: number;
  /** Slot centres along the axis, captured at lift. Stable for the drag's life: the tiles share an
   *  extent on this axis, so a reorder moves the neighbours between the same slots. */
  slots: number[];
  /** The lifted tile's own slot centre at lift. */
  origin: number;
  dx: number;
  dy: number;
  /** The layout shift the reorder has already moved this tile by, accumulated across the drag's
   *  crossings. The lifted tile's slot moves under it every time the order changes, so its own
   *  layout position stops being the base the pointer delta is measured against. The transform is
   *  written from `comp + pointer`; without this the tile is correct on the crossing frame and then
   *  leaps a full stride on the next pointermove. */
  compX: number;
  compY: number;
  el: HTMLButtonElement | null;
  moved: boolean;
}

/** Where the lifted tile is drawn while it is held: the pointer's own delta, offset by whatever the
 *  reorders so far have already moved its slot by. The single writer of the held tile's transform,
 *  so the two callers (a pointermove, and a crossing that lands between two of them) cannot disagree
 *  about the composition.
 *
 *  Module scope, not the component body: it reads nothing from the render, and a body-scoped copy
 *  would either be a stale closure or a new identity on every render — which is what the FLIP
 *  effect below would then have to list as a dependency, re-running the whole inversion each time. */
function applyLift(d: DragState): void {
  if (!d.el) return;
  d.el.style.transform = `translate3d(${d.compX + d.dx}px, ${d.compY + d.dy}px, 0) scale(${LIFT_SCALE})`;
}

export function ChannelRail({
  channels,
  selected,
  onSelect,
  screen,
  onScreenChange,
}: ChannelRailProps) {
  // Agents is a fixed rail tile rather than a connected account — if an agent account does exist,
  // it takes that same slot instead of being appended twice.
  const tiles = useMemo(
    () => (channels.includes("agent") ? channels : [...channels, "agent" as const]),
    [channels],
  );
  const narrow = useNarrowShell();

  // The stored order is a preference, not the truth: applyOrder turns it into a permutation of the
  // tiles the hub actually reports, so a disconnected account leaves no hole and a newly connected
  // one appears at the end rather than nowhere.
  const [order, setOrder] = useState<UiChannel[]>(readRailOrder);
  const ordered = useMemo(() => applyOrder(tiles, order), [tiles, order]);

  // The order as it stands *during* a drag: the neighbours have to move as the lifted tile passes
  // them, not when the finger comes up, and they ride the FLIP settle below.
  const [preview, setPreview] = useState<UiChannel[] | null>(null);
  const shown = preview ?? ordered;

  // Narrow shell: at most four tiles stand in the bar. The rest, along with the avatar and
  // settings, move into the More popover — pushing tiles into a 320px bar indefinitely walks the
  // last one off screen, and horizontal overflow is the one thing this layout may never do.
  const barTiles = narrow ? shown.slice(0, NARROW_RAIL_TILE_LIMIT) : shown;

  const [dragging, setDragging] = useState<UiChannel | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const tileEls = useRef(new Map<UiChannel, HTMLButtonElement>());
  const drag = useRef<DragState | null>(null);
  /** Layout rects, read immediately *before* a reorder commits — FLIP's First. Null means there is
   *  nothing to invert, which is the state every ordinary render is in. */
  const rectsBefore = useRef<Map<UiChannel, DOMRect> | null>(null);
  /** The lifted tile carried across a commit, so the FLIP below composes with it instead of
   *  dropping the tile out of the pointer's hand mid-animation. `dx`/`dy` are the tile's whole
   *  current offset (`comp + pointer`), not the pointer delta alone. `settle` says which commit
   *  this is: a reorder under the finger, where the tile is redrawn from the pointer, or a cancel,
   *  where the offset is played out to nothing so the tile glides home. */
  const lift = useRef<{ id: UiChannel; dx: number; dy: number; settle: boolean } | null>(null);
  /** The tile of the click that must not select: the one a drag *just* ended on. Cleared by the
   *  next pointerdown rather than by a timer, so a click the browser never delivers cannot leave a
   *  flag behind that swallows the next real one. */
  const suppressClick = useRef<UiChannel | null>(null);

  const captureRects = (): void => {
    const rects = new Map<UiChannel, DOMRect>();
    for (const [id, el] of tileEls.current) rects.set(id, el.getBoundingClientRect());
    rectsBefore.current = rects;
  };

  // FLIP's Play half. React has already moved the nodes; put each one back where it was on screen,
  // then release it onto the settle spring on the next frame. Under reduced motion --dur-reorder is
  // 0ms and the whole thing lands within the frame — no separate branch (§c.1).
  //
  // `shown` is what this effect runs *on*, not something it reads: the rects read a moment ago and
  // the order that replaced them arrive together, and the commit between them is the only frame in
  // which the inversion is still true. Walking that order (rather than the element map) is what
  // keeps the dependency honest — and a tile that has left the rail simply has no element to move.
  useLayoutEffect(() => {
    const before = rectsBefore.current;
    if (!before) return;
    rectsBefore.current = null;
    const lifted = lift.current;
    lift.current = null;
    for (const id of shown) {
      const el = tileEls.current.get(id);
      if (!el) continue;
      const previous = before.get(id);
      if (!previous) continue;
      const now = el.getBoundingClientRect();
      // Both readings carry the tile's current transform, so the difference between them is purely
      // the layout shift the reorder just caused — which is exactly the amount the held tile has to
      // compensate for.
      const dx = previous.left - now.left;
      const dy = previous.top - now.top;
      const d = drag.current;
      const held = lifted !== null && lifted.id === id;
      if (dx === 0 && dy === 0 && !held) continue;
      el.style.transition = "none";
      // `d` is null on the cancel commit — the drag is over and only the carried offset is left to
      // play out — so the accumulate branch is the one that has to check for it.
      if (held && !lifted.settle && d !== null) {
        // A reorder *under* the finger. Fold the shift into the compensation and redraw the tile
        // from the pointer — the position it holds this frame is not an animation to play out, and
        // dropping the compensation here is what made it leap a stride on the next move.
        d.compX += dx;
        d.compY += dy;
        applyLift(d);
        continue;
      }
      // A neighbour making room, or a cancelled drag gliding home: invert, then release onto the
      // settle spring on the next frame.
      const own = held
        ? ` translate3d(${lifted.dx}px, ${lifted.dy}px, 0) scale(${LIFT_SCALE})`
        : "";
      el.style.transform = `translate3d(${dx}px, ${dy}px, 0)${own}`;
      requestAnimationFrame(() => {
        el.style.transition = "transform var(--dur-reorder) var(--ease-settle)";
        el.style.transform = "";
      });
    }
  }, [shown]);

  const handlersFor = (channel: UiChannel) =>
    pointerDrag(
      {
        onStart: () => {
          const axis = narrow ? "x" : "y";
          const els = tileEls.current;
          const slots = barTiles.map((id) => {
            const rect = els.get(id)?.getBoundingClientRect();
            if (!rect) return 0;
            return axis === "x" ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
          });
          const index = barTiles.indexOf(channel);
          const el = els.get(channel) ?? null;
          drag.current = {
            id: channel,
            axis,
            order: [...shown],
            index,
            slots,
            origin: slots[index] ?? 0,
            dx: 0,
            dy: 0,
            compX: 0,
            compY: 0,
            el,
            moved: false,
          };
          suppressClick.current = channel;
          setDragging(channel);
          if (el) {
            // The lift lands where the tile stands, over --dur-fast; the first move takes the
            // transition off again so the tile can follow the pointer without lag.
            el.style.transition = "transform var(--dur-fast) var(--ease-spring)";
            el.style.transform = `scale(${LIFT_SCALE})`;
          }
        },

        onMove: (dx, dy) => {
          const d = drag.current;
          if (!d?.el) return;
          d.dx = dx;
          d.dy = dy;
          d.el.style.transition = "none";
          applyLift(d);

          // Which slot the lifted tile is over now — by nearest slot, not by "the last slot centre
          // the pointer has passed". The difference is a whole slot: comparing against the centres
          // hands the tile slot i only once the pointer is a full stride past its own, so a
          // fraction-of-a-stride drag leaves the tile claiming a slot one away from the one it is
          // drawn on — it lands squarely on top of the neighbour that just made room, instead of
          // between two of them, and the first 6px of every drag already commits a swap. The
          // midpoint between two slots is where the two are equally near, which is exactly when the
          // swap should happen. The slots share an extent, so the midpoints are evenly spaced and
          // the rule stays symmetric for a drag in either direction.
          const centre = d.origin + (d.axis === "x" ? dx : dy);
          let target = 0;
          for (let i = 1; i < d.slots.length; i++) {
            const mid = ((d.slots[i] ?? 0) + (d.slots[i - 1] ?? 0)) / 2;
            if (centre > mid) target = i;
          }
          if (target === d.index) return;

          const next = [...d.order];
          next.splice(d.index, 1);
          next.splice(target, 0, d.id);
          captureRects();
          lift.current = { id: d.id, dx, dy, settle: false };
          d.order = next;
          d.index = target;
          d.moved = true;
          setPreview(next);
        },

        onEnd: () => {
          const d = drag.current;
          drag.current = null;
          setDragging(null);
          if (!d) return;
          if (d.el) {
            // Settle: the same spring the neighbours ride, so the tile lands in its slot instead of
            // snapping into it. The DOM is already in the drop order — nothing to invert.
            d.el.style.transition = "transform var(--dur-reorder) var(--ease-settle)";
            d.el.style.transform = "";
          }
          setPreview(null);
          if (!d.moved) return;
          setOrder(d.order);
          writeRailOrder(d.order);
          setAnnouncement(
            `${CHANNEL_LABEL[d.id]} moved to position ${d.index + 1} of ${d.order.length}`,
          );
        },

        onCancel: () => {
          const d = drag.current;
          drag.current = null;
          setDragging(null);
          if (!d) return;
          if (d.moved) {
            // Back to where it started, on the same spring, and the neighbours ride back with it.
            // The carried offset is the tile's whole current transform (`comp + pointer`), not the
            // pointer delta alone: the settle has to start from where the tile is actually drawn.
            captureRects();
            lift.current = { id: d.id, dx: d.compX + d.dx, dy: d.compY + d.dy, settle: true };
          } else if (d.el) {
            d.el.style.transition = "transform var(--dur-reorder) var(--ease-settle)";
            d.el.style.transform = "";
          }
          setPreview(null);
          setAnnouncement(`${CHANNEL_LABEL[d.id]} returned to position ${d.index + 1}`);
        },
      },
      { holdMs: TOUCH_HOLD_MS, axis: narrow ? "x" : "y" },
    );

  /** §c.2: the keyboard twin of the drag. `Ctrl` + the arrow that matches this tier's axis moves
   *  the focused tile one slot and says so — a drag-only reorder is unreachable for anyone not
   *  using a pointer, and omnis's own rule (§e guard 10) is that every gesture has a non-gesture
   *  twin. The focus stays on the tile because React keeps the same keyed node. */
  const onTileKeyDown = (e: React.KeyboardEvent, channel: UiChannel): void => {
    if (!e.ctrlKey) return;
    const forward = narrow ? e.key === "ArrowRight" : e.key === "ArrowDown";
    const back = narrow ? e.key === "ArrowLeft" : e.key === "ArrowUp";
    if (!forward && !back) return;
    e.preventDefault();
    const from = shown.indexOf(channel);
    const to = from + (forward ? 1 : -1);
    if (from < 0 || to < 0 || to >= shown.length) return;
    const next = moveTile(shown, channel, forward ? 1 : -1);
    setOrder(next);
    writeRailOrder(next);
    setAnnouncement(`${CHANNEL_LABEL[channel]} moved to position ${to + 1} of ${next.length}`);
  };

  return (
    <nav className="channel-rail" aria-label="Channels">
      <button
        type="button"
        className={cn("channel-rail__tile", "channel-rail__tile--inbox")}
        // The Inbox is a screen as well as a filter: it stays pressed only while it is both the
        // screen on show and the unfiltered view. Pressed on every screen was the L-33 finding —
        // a tile that claimed "you are here" from Today, Tasks and Settings alike.
        aria-pressed={screen === "inbox" && selected === null}
        aria-label="Inbox"
        onClick={() => {
          // A channel tile and the Inbox tile are the two ways back to the list from a screen, so
          // both of them go through the shell — which also clears the pane's target, the same thing
          // the previous screen change does.
          if (screen !== "inbox") onScreenChange("inbox");
          onSelect(null);
        }}
      >
        <InboxGlyph size={18} aria-hidden="true" />
      </button>
      {/* Outside the plate and outside the reorder, like the Inbox tile: a screen is not a channel,
          so it takes no part in the drag (the drop slots the drag measures are the plate's tiles
          only). Dashed in the narrow shell, where the same six screens are rows in the More
          popover — a 320px bar cannot hold five more 44px tiles. */}
      {narrow
        ? null
        : SCREEN_TILES.map(({ screen: target, label, icon: Icon, shortcut }) => (
            <button
              key={target}
              type="button"
              className="channel-rail__tile channel-rail__tile--screen"
              aria-label={label}
              title={`${label} (${shortcut})`}
              aria-current={screen === target ? "page" : undefined}
              onClick={() => onScreenChange(target)}
            >
              <Icon size={18} aria-hidden="true" />
            </button>
          ))}
      {/* US-D01: the plate used to be opaque white, which read as "a board laid on the canvas" and
          nothing more. It is real glass now (blur + saturate + tint + inner highlight + soft
          shadow = .glass-surface). The tiles stay on top of it — brand marks still read over glass.
          US-D02b: in the narrow shell this plate lies down into the row that fills the bottom bar
          (app.css gives it `display: contents` there), and the bar itself carries the glass — glass
          is never stacked on glass.
          US-D06 §4.1.1: the plate's glass now sits on the `mist` aurora, which is the faint half of
          reference image 1 — image 1's colour, softness and grain with no silhouette (a 120:200
          landscape ridge stretched into a 56px-wide plate renders as a vertical finger, not a
          ridge). The aurora is BEHIND the glass, painted by this ancestor wrapper, never on the
          plate itself: `.aurora` and `.glass-surface` on one element would fight over the
          background and the panel would stop being glass (§2.7).
          D7: the Inbox tile is deliberately outside this plate. It is not a channel — it is "show
          everything" — so it takes no part in the reorder: it has no pointer handler, and the drop
          slots the drag measures are the plate's tiles only. */}
      <AuroraSurface variant="mist" className="channel-rail__aurora">
        <GlassSurface slot="sidebar" className="channel-rail__plate">
          {barTiles.map((channel) => (
            <button
              key={channel}
              ref={(el) => {
                if (el) tileEls.current.set(channel, el);
                else tileEls.current.delete(channel);
              }}
              type="button"
              className={cn(
                "channel-rail__tile",
                selected === channel && "channel-rail__tile--active",
                dragging === channel && "channel-rail__tile--dragging",
              )}
              // A channel filter is only the current view on the Inbox: picking Slack while Today
              // is on show switches to the Inbox *and* filters it.
              aria-pressed={screen === "inbox" && selected === channel}
              aria-label={CHANNEL_LABEL[channel]}
              aria-roledescription="reorderable"
              onPointerDown={(e) => {
                // A fresh press clears the flag the last drag left, so a click the browser never
                // delivered cannot swallow this one.
                suppressClick.current = null;
                handlersFor(channel)(e);
              }}
              onKeyDown={(e) => onTileKeyDown(e, channel)}
              onClick={() => {
                if (suppressClick.current === channel) {
                  suppressClick.current = null;
                  return;
                }
                if (screen !== "inbox") onScreenChange("inbox");
                onSelect(channel);
              }}
            >
              <ChannelGlyph channel={channel} size={18} />
            </button>
          ))}
          {narrow ? (
            <RailOverflowPopover
              tiles={shown.slice(NARROW_RAIL_TILE_LIMIT)}
              selected={selected}
              onSelect={onSelect}
              screen={screen}
              onScreenChange={onScreenChange}
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
      </AuroraSurface>
      {narrow ? null : (
        <>
          <div className="channel-rail__spacer" />
          {/* Settings is a screen, so this is a real control now rather than the disabled lookalike
              L-33 reported. There is no Account button: nothing is behind it. */}
          <button
            type="button"
            className="channel-rail__icon-button"
            aria-label={SETTINGS_ENTRY.label}
            title={`${SETTINGS_ENTRY.label} (${SETTINGS_ENTRY.shortcut})`}
            aria-current={screen === "settings" ? "page" : undefined}
            onClick={() => onScreenChange("settings")}
          >
            <Settings size={16} aria-hidden="true" />
          </button>
        </>
      )}
      {/* §c.2: the announcement. Present from the first render and empty until a reorder happens —
          a live region inserted at the same moment its text changes is a region screen readers
          have no reason to be watching. */}
      <p className="channel-rail__announce" aria-live="polite">
        {announcement}
      </p>
    </nav>
  );
}

/** The narrow shell's More popover: the screens, then the tiles that did not fit in the bar.
 *  Unlike the 44px bar tiles there is room for words here, so each icon gets a label — an icon
 *  alone does not say which channel it is, still less which screen. The Radix Popover grammar is
 *  the same one filter-chip-bar.tsx's AddFilterPopover uses; this repo does not grow a second way
 *  to build a floating panel. */
function RailOverflowPopover({
  tiles,
  selected,
  onSelect,
  screen,
  onScreenChange,
}: {
  tiles: UiChannel[];
  selected: RailSelection;
  onSelect: (selection: RailSelection) => void;
  screen: RailScreen;
  onScreenChange: (screen: RailScreen) => void;
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
          {/* v3 §c.7: two groups, separated by 6px of gap and never a rule — the popover's own gap
              is that 6px, and the rows inside a group sit 2px apart. */}
          <div className="channel-rail__popover-group">
            {POPOVER_ENTRIES.map(({ screen: target, label, icon: Icon }) => (
              <button
                key={target}
                type="button"
                className="channel-rail__popover-row"
                aria-current={screen === target ? "page" : undefined}
                onClick={() => {
                  onScreenChange(target);
                  setOpen(false);
                }}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
          </div>
          <div className="channel-rail__popover-group">
            {tiles.map((channel) => (
              <button
                key={channel}
                type="button"
                className="channel-rail__popover-row"
                aria-pressed={screen === "inbox" && selected === channel}
                onClick={() => {
                  if (screen !== "inbox") onScreenChange("inbox");
                  onSelect(channel);
                  setOpen(false);
                }}
              >
                <ChannelGlyph channel={channel} size={18} />
                <span>{CHANNEL_LABEL[channel]}</span>
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
