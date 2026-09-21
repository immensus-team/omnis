import * as HoverCard from "@radix-ui/react-hover-card";
import { Archive, Mail, MoreHorizontal, RotateCcw } from "lucide-react";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { cn } from "../lib/cn.js";
import { useNarrowShell } from "../lib/media-query.js";
import { closeRow, openRow, useRowOpen } from "../lib/open-row.js";
import { pointerDrag } from "../lib/pointer-drag.js";
import {
  type AgentRuntimeKind,
  type AgentSessionKinsoState,
  CHANNEL_LABEL,
  RUNTIME_ICON,
  RUNTIME_LABEL,
  RUNTIME_LETTER,
  initialsFromName,
  pastelFromName,
} from "../lib/row-meta.js";
import type { UiChannel } from "../types.js";
import { ChannelGlyph } from "./channel-glyph.js";
import { ContextMenu, type ContextMenuItem } from "./context-menu.js";
import { KeyValueTable } from "./key-value-table.js";
import { PersonCard, type RelationshipState } from "./person-card.js";
import { AgentStatusBadge } from "./status-badge.js";

export interface LabelChip {
  kind: "scope" | "topic" | "priority" | "person";
  name: string;
  color: string | null;
}

/** U2 avatar: a person's photo when there is one, otherwise the initials+pastel fallback; an
 * agent_session row shows its runtime logo (DESIGN-DIRECTION.md U2 — identities has no photo field
 * yet, so "photo" is the slot held open for when that data arrives). */
export type RowAvatar =
  | { kind: "photo"; url: string; name: string }
  | { kind: "initials"; name: string }
  | { kind: "runtime"; runtime: AgentRuntimeKind };

export interface InboxRowProps {
  /** thread id — since U2 a row is one per thread, not one per item. */
  id: string;
  /** Name or title (person display name -> thread title -> channel handle; Inbox.tsx's
   *  inboxRowTitle). */
  name: string;
  /** An already-formatted relative time string ("3m"/"2w"/"4 Aug" — @omnis/ui/lib/relative-time). */
  timestamp: string;
  /** threads.meta.summary first, else the subject or the body's first line (Inbox.tsx's
   *  threadSummary). */
  summary: string;
  /** When the last item is a draft, the summary is prefixed with "Draft: " (A5 §3.1). */
  isDraft: boolean;
  avatar: RowAvatar;
  channel: UiChannel;
  /** Non-null means this is an agent_session row — the right slot shows a status badge instead of
   *  a channel mark. Whether a row is a session lives here and nowhere else: overwriting it with
   *  null for a grouped view drops the row back to a channel glyph, so a runtime session claims to
   *  be a "Slack message" and the hover card grows a channel line it does not have. */
  agentState: AgentSessionKinsoState | null;
  /** The group header directly above already states this row's status (the Agents view). The row
   *  does not repeat it, and does not fill the gap with an unrelated channel glyph either — a
   *  session row's right slot is simply empty. */
  groupedByState?: boolean;
  unread: boolean;
  /** The unread count (threads.unread_count). The row reduces it to a single dot, so the hover
   *  card is where the number is said. */
  unreadCount?: number;
  selected: boolean;
  hasPendingApproval: boolean;
  labels: LabelChip[];
  onSelect: (id: string) => void;
  /** US-A36 row hover action. Without it no button is drawn (A5 §3.1, "an icon button on the
   *  right on hover"). */
  onArchive?: (id: string) => void;
  /** On an archived row the action becomes "Restore" (A5 §3.8). */
  archived?: boolean;
  /** US-D03: the person behind this row (items.author), for the hover card's PersonCard. Absent on
   *  an agent session, which has no person — the card then omits those rows rather than inventing
   *  them. */
  person?: { vip?: boolean; relationshipState?: RelationshipState | null } | null;
  /** US-D04: this row has just been archived (or restored) and is on its way out of the list. The
   *  screen keeps it in the data for the length of the leave animation (motion.ts's LEAVE_MS) so
   *  there is something left to animate; this prop is what makes it collapse while it waits. */
  leaving?: boolean;
  /** US-D08 §c.4: the last row in the list draws no hairline under itself. It has to be said by the
   *  list rather than by a `:last-child` selector in CSS — Virtuoso wraps every item in its own
   *  `<div data-index>`, so the row is an only child and `:last-child` is true of all of them (see
   *  the rule in app.css). */
  last?: boolean;
}

/** US-D04: the archive collapse animates `height`, and `height: auto` only interpolates where
 *  `interpolate-size: allow-keywords` exists — Chromium 129+, which macOS's WKWebView (what Tauri
 *  renders in) does not ship. So the row measures itself once, on the frame `leaving` turns on while
 *  it is still at full height, and hands the pixel value to app.css's @keyframes inbox-row-leave
 *  through --row-collapse-h.
 *  Once, not per frame: reading the rect of every animating row on every frame is exactly the layout
 *  thrash the rest of this pass avoids. The class is applied only after the measurement lands, so a
 *  row never starts an animation whose `from` height is unset — that would make the height discrete
 *  (auto -> 0 snaps instead of collapsing) while the opacity still faded, which reads as a glitch
 *  rather than as motion. */
function useCollapseHeight(leaving: boolean): {
  ref: RefObject<HTMLDivElement>;
  style: CSSProperties | undefined;
} {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    if (!leaving) {
      setHeight(null);
      return;
    }
    setHeight(ref.current?.getBoundingClientRect().height ?? null);
  }, [leaving]);
  return {
    ref,
    style: height === null ? undefined : ({ "--row-collapse-h": `${height}px` } as CSSProperties),
  };
}

/** US-D08 §c.4: how far the row's content travels to reveal its action — and, the same distance,
 *  how far a release has to have travelled to commit. One number, because the row comes to rest
 *  exactly where the gesture stops being a look and becomes an archive: a 56px action disc, a 16px
 *  gap beside it (Mail keeps the button off the row's text) and the row's own 16px right padding,
 *  which is what the disc is anchored to. Half of it is the rest threshold below. */
const SWIPE_OPEN_PX = 88;

function pickChips(labels: LabelChip[]): { shown: LabelChip[]; more: number } {
  const scope = labels.find((l) => l.kind === "scope");
  const rest = labels.filter((l) => l !== scope);
  // A5 §3.1: at most two chips. With no scope label, that slot is filled from the remaining
  // labels rather than left empty.
  const shown = (scope ? [scope, ...rest] : rest).slice(0, 2);
  return { shown, more: labels.length - shown.length };
}

function RowAvatarView({ avatar }: { avatar: RowAvatar }) {
  if (avatar.kind === "runtime") {
    // U5: a runtime with a real brand mark (Claude, DeepSeek, ...) shows that logo; one without
    // (Hermes) shows a single letter (RUNTIME_LETTER), the same idea as a person's initials
    // fallback.
    const Icon = RUNTIME_ICON[avatar.runtime];
    return (
      <span
        className="inbox-row__avatar inbox-row__avatar--runtime"
        aria-label={`${RUNTIME_LABEL[avatar.runtime]} session`}
      >
        {Icon ? <Icon size={16} aria-hidden="true" /> : RUNTIME_LETTER[avatar.runtime]}
      </span>
    );
  }
  if (avatar.kind === "photo") {
    return (
      <span className="inbox-row__avatar" aria-label={avatar.name}>
        <img className="inbox-row__avatar-img" src={avatar.url} alt="" />
      </span>
    );
  }
  return (
    <span
      className="inbox-row__avatar"
      style={{ background: pastelFromName(avatar.name) }}
      aria-label={avatar.name}
    >
      {initialsFromName(avatar.name)}
    </span>
  );
}

export function InboxRow(props: InboxRowProps) {
  const { shown, more } = pickChips(props.labels);
  const summaryText = props.isDraft ? `Draft: ${props.summary}` : props.summary;
  // US-D03: a runtime avatar is the one row shape with nobody behind it.
  const isPerson = props.avatar.kind !== "runtime";
  const unreadRows =
    props.unreadCount !== undefined && props.unreadCount > 0
      ? [{ label: "Unread", value: props.unreadCount, numeric: true }]
      : [];
  // US-D04: `style` is undefined until the row has been measured, so the leaving class and the
  // height it needs land in the same commit (see useCollapseHeight).
  const collapse = useCollapseHeight(props.leaving === true);
  const leaving = props.leaving === true && collapse.style !== undefined;

  // US-D08 §c.4: the swipe. Narrow-only — the tier where the rail is already a bottom bar, i.e. the
  // coarse-pointer layout — and only on a row that has something to reveal, so a row with no
  // archive action never moves. The primitive's long-press hold is off (0): the swipe has no
  // ambiguity to resolve, vertical scrolling stays the browser's until the gesture has actually
  // started, and a mouse drags the row too, which is how the acceptance screenshots and the
  // responsive gate drive it.
  const swipeable = useNarrowShell() && props.onArchive !== undefined;
  const revealed = useRowOpen(props.id);
  /** The finger's travel while it is down; null between gestures. The resting offset is not stored
   *  — it is derived from whether this row is the revealed one, so a row that loses the reveal to
   *  its neighbour springs back without either row being told about the other. */
  const [dragX, setDragX] = useState<number | null>(null);
  const dragging = dragX !== null;
  const restX = swipeable && revealed ? -SWIPE_OPEN_PX : 0;
  const x = dragX === null ? restX : Math.min(0, Math.max(-SWIPE_OPEN_PX, restX + dragX));

  // A row that stops being swipeable must not stay revealed — a rotation past 900 cannot be
  // recovered from, since neither the strip nor the gesture is drawn there any more. And a row that
  // unmounts must not leave the store pointing at it: the next mount of the same thread id would
  // then draw itself already open, from a gesture nobody made.
  useEffect(() => {
    if (!swipeable) closeRow(props.id);
    return () => closeRow(props.id);
  }, [swipeable, props.id]);

  // The gesture ends where the content came to rest, not where the finger stopped. Past the whole
  // action it is an archive; past half of it the row stays revealed with the action showing (Mail's
  // resting state — it is what makes "one row open at a time" mean anything); anything shorter
  // springs back to nothing. Clamping is the whole of the other direction: a swipe begun on a
  // revealed row closes it on the same arithmetic, with no second code path for a right swipe.
  /** Whether the gesture that is currently running moved the row at all. `pointerDrag` calls
   *  `onStart` only after its own 6px start slop, so an `onMove` is proof of a drag and a tap never
   *  sets this — the primitive's threshold is the single source, and no second number is written
   *  here. */
  const dragged = useRef(false);
  const startDrag = swipeable
    ? pointerDrag(
        {
          onStart: () => setDragX(0),
          onMove: (dx) => {
            dragged.current = true;
            setDragX(dx);
          },
          onEnd: (dx) => {
            setDragX(null);
            const landed = Math.min(0, Math.max(-SWIPE_OPEN_PX, restX + dx));
            if (landed <= -SWIPE_OPEN_PX) {
              // It stays revealed while it collapses — the action must not slide back under the
              // finger that just pressed it. If the archive goes through, the row unmounts and its
              // effect clears the store; if it does not, the row is simply still swipeable back.
              openRow(props.id);
              props.onArchive?.(props.id);
              return;
            }
            if (landed <= -SWIPE_OPEN_PX / 2) openRow(props.id);
            else closeRow(props.id);
          },
          onCancel: () => setDragX(null),
        },
        { axis: "x" },
      )
    : undefined;

  /** The latch belongs to one gesture, and a gesture begins at `pointerdown` — the same instant
   *  `pointerDrag` starts tracking one. Clearing it here and not only when a drag starts is what
   *  keeps a swipe that produced no click of its own (a `pointercancel` the browser took for a
   *  scroll, an Escape mid-gesture) from swallowing the next tap's click: that tap is a new
   *  gesture, and its own pointerdown is what says so. */
  const onPointerDown =
    startDrag === undefined
      ? undefined
      : (e: ReactPointerEvent): void => {
          dragged.current = false;
          startDrag(e);
        };

  /** A release after a swipe still delivers a click: the browser sends one whenever the press and
   *  the release share a target, and the content sliding 60px sideways does not change the target.
   *  Measured in Chromium at 390, and it is not cosmetic — after a 60px swipe the point under the
   *  finger is inside `.inbox-row__action`'s own box (the button rides the content, so it moves
   *  with it), and `opacity: 0` is not `pointer-events: none`. Every swipe therefore ended in a
   *  click on the row's Archive button and archived a row the user only meant to reveal. Capture
   *  phase, so it runs before the target's own handler wherever in the row the click landed. */
  const swallowAfterDrag = (e: React.MouseEvent): void => {
    if (!dragged.current) return;
    dragged.current = false;
    e.stopPropagation();
  };

  /** §c.4: on a revealed row the first press closes the reveal instead of opening the thread — the
   *  way back that does not depend on remembering the gesture. At 900 and above nothing is ever
   *  revealed, so this branch is unreachable there. */
  const activate = (): void => {
    if (revealed) {
      closeRow(props.id);
      return;
    }
    props.onSelect(props.id);
  };

  /** §c.7: what the row's `…` opens. The list is built from the same two facts the row already
   *  acts on, so it cannot drift from them — "Open" is the row's own click and the second row is
   *  the swipe's action, whose label follows `archived` exactly as the pill's and the swipe
   *  caption's do (guard 11: the gesture is never the only way to reach an action).
   *  The narrowed `onArchive` is captured rather than read off `props` inside the closure, so the
   *  guard and the call are provably the same function. */
  const hoverMenuItems: ContextMenuItem[] = [
    {
      id: "open",
      label: "Open",
      icon: Mail,
      // Not `activate`: on a revealed row that one closes the reveal instead of opening, which is
      // right for a tap on the row and wrong for a row that says "Open". A revealed row is behind
      // the pane when the thread opens, so it is closed on the way out either way.
      onSelect: () => {
        closeRow(props.id);
        props.onSelect(props.id);
      },
    },
  ];
  const archive = props.onArchive;
  if (archive !== undefined) {
    hoverMenuItems.push({
      id: "archive",
      label: props.archived ? "Restore" : "Archive",
      icon: props.archived ? RotateCcw : Archive,
      onSelect: () => archive(props.id),
    });
  }

  return (
    // US-D02: HoverCard.Trigger is asChild, so it only adds hover handlers to this row div — no
    // wrapper element appears and the row's role="option", click and keyboard behaviour are
    // untouched (Radix Slot merges into the existing props).
    // The 400ms openDelay is deliberate: rows here are short, so a pointer sweeps across many of
    // them, and with no delay the cards flash one after another (hover intent). closeDelay stays
    // short (100ms) so the card follows while moving between rows.
    <HoverCard.Root openDelay={400} closeDelay={100}>
      <HoverCard.Trigger asChild>
        <div
          ref={collapse.ref}
          style={collapse.style}
          // biome-ignore lint/a11y/useSemanticElements: A5 §3.1 listbox/option pattern — <option> is only valid inside <select> and can't hold this row's markup.
          role="option"
          // loop-r1-02/NC-09: the thread this row opens, so the shell can put focus back on it
          // after Escape closes the pane. The row is the list's own handle on the thread, and the
          // shell has no other way to find it — the rows live in a virtualiser it does not hold a
          // reference to.
          data-thread-id={props.id}
          tabIndex={0}
          aria-selected={props.selected}
          className={cn(
            "inbox-row",
            props.selected && "inbox-row--selected",
            props.last && "inbox-row--last",
            leaving && "inbox-row--leaving",
            dragging && "inbox-row--swiping",
            x !== 0 && "inbox-row--revealed",
          )}
          onPointerDown={onPointerDown}
          onClickCapture={swallowAfterDrag}
          onClick={activate}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              activate();
            }
          }}
        >
          {/* §c.4: what the swipe uncovers — one 56px circular action with an 11px caption under it
              (M167), right-aligned in the row. First in the DOM so the content paints over it: the
              row has no opaque fill of its own to hide it with, the way a Mail cell does, so the
              strip fades instead of relying on the stack, and its own opacity is 0 until the
              content has moved.
              Hidden from the a11y tree and out of the tab order on purpose. It is the visual echo
              of a gesture, not a second control: the same archive is on the row's own button, which
              is focusable and named, and two buttons answering to "Archive" in one row is how a
              screen reader ends up offering the same action twice (§e guard 11 wants the twin, not
              a duplicate). */}
          {swipeable && (
            <div className="inbox-row__swipe" aria-hidden="true">
              <button
                type="button"
                className="inbox-row__swipe-action"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onArchive?.(props.id);
                }}
              >
                <span className="inbox-row__swipe-disc">
                  {props.archived ? (
                    <RotateCcw size={20} aria-hidden="true" />
                  ) : (
                    <Archive size={20} aria-hidden="true" />
                  )}
                </span>
                <span className="inbox-row__swipe-caption">
                  {props.archived ? "Restore" : "Archive"}
                </span>
              </button>
            </div>
          )}
          {/* §c.4: the translating half. The row's grid lives here rather than on `.inbox-row`
              itself: the hairline and the archive collapse both belong to the row's box, and they
              must not travel with the content. */}
          <div
            className="inbox-row__content"
            style={x === 0 ? undefined : { transform: `translateX(${x}px)` }}
          >
            {/* US-D08 §c.4: the unread dot is a sibling of the avatar, not of the name. Laying it in
              the row's own leading column is what keeps every row's text at one x — inside the meta
              line it shifted the name and the time right by its own width, so unread rows were
              indented against read ones. */}
            {props.unread && <span className="inbox-row__unread-dot" aria-label="Unread" />}
            <RowAvatarView avatar={props.avatar} />
            <div className="inbox-row__meta">
              <span className="inbox-row__name" data-unread={props.unread}>
                {props.name}
              </span>
              <span className="inbox-row__timestamp">{props.timestamp}</span>
            </div>
            <div className="inbox-row__side">
              {props.agentState ? (
                !props.groupedByState && <AgentStatusBadge state={props.agentState} />
              ) : (
                <span
                  className="inbox-row__channel-icon"
                  aria-label={`${CHANNEL_LABEL[props.channel]} message`}
                >
                  <ChannelGlyph channel={props.channel} size={16} />
                </span>
              )}
              {props.hasPendingApproval && (
                <span className="inbox-row__approval-dot" aria-label="Pending approval" />
              )}
              {/* §c.7/US-D02b: the row's hover cluster — the `…` and the archive pill — as one
                  absolutely-positioned box. The pill was already out of flow so the row's `auto`
                  column is sized by the brand mark alone; a second control had to join it there,
                  and a wrapper keeps the cluster right-aligned to the mark's end without a second
                  `right` offset to keep in step with the first. */}
              <div className="inbox-row__hover-actions">
                <ContextMenu
                  label={`Actions for ${props.name}`}
                  trigger={
                    <button
                      type="button"
                      className="inbox-row__more"
                      // Guard 9: an icon-only control is named.
                      aria-label="More actions"
                      // The whole row is a click target, so without stopping propagation opening
                      // the menu also opens the thread behind it.
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <MoreHorizontal size={16} aria-hidden="true" />
                    </button>
                  }
                  groups={[{ items: hoverMenuItems }]}
                />
                {props.onArchive && (
                  <button
                    type="button"
                    className="inbox-row__action"
                    // The whole row is a click target, so without stopping propagation archiving
                    // also opens the thread.
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onArchive?.(props.id);
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    {props.archived ? "Restore" : "Archive"}
                  </button>
                )}
              </div>
            </div>
            <div className="inbox-row__summary-line">
              <span className="inbox-row__summary" data-draft={props.isDraft}>
                {summaryText}
              </span>
              <div className="inbox-row__chips">
                {shown.map((chip) => (
                  <span
                    key={`${chip.kind}:${chip.name}`}
                    className="inbox-row__chip"
                    aria-label={`${chip.kind} label: ${chip.name}`}
                  >
                    {chip.name}
                  </span>
                ))}
                {more > 0 && (
                  <span className="inbox-row__chip-more" aria-label={`${more} more labels`}>
                    +{more}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </HoverCard.Trigger>
      <HoverCard.Portal>
        {/* A floating panel, so it is glass (DESIGN-DIRECTION.md: Liquid Glass on floating panels
            only). Its density follows the reference (the lower-left card in
            ref-issue-tracker-density.webp) — a compact card of a title plus a few key-value lines,
            not a detail pane.
            US-D03: the body is the shared PersonCard (initials/photo + badge row + KeyValueTable)
            rather than a private <dl>, so the inbox and the future Network screen draw an identity
            the same way. The card still says only what the row had to cut — the summary the row
            clamped, and the labels it clipped to two chips plus "+N".
            An agent_session row has no person behind it (its avatar slot holds the runtime logo),
            so it keeps the plain title + table form instead of claiming to be somebody. */}
        <HoverCard.Content
          className="glass-surface row-hover-card"
          data-glass-slot="sheet"
          side="right"
          align="start"
          sideOffset={8}
        >
          {isPerson ? (
            <PersonCard
              person={{
                name: props.name,
                vip: props.person?.vip ?? false,
                relationshipState: props.person?.relationshipState ?? null,
                channels: [props.channel],
                labels: more > 0 ? props.labels.map((l) => l.name) : [],
                lastContact: props.timestamp,
              }}
              extraRows={unreadRows}
            >
              {summaryText && <p className="row-hover-card__summary">{summaryText}</p>}
            </PersonCard>
          ) : (
            <>
              <p className="row-hover-card__title">{props.name}</p>
              {summaryText && <p className="row-hover-card__summary">{summaryText}</p>}
              <KeyValueTable
                rows={[
                  { label: "Last activity", value: props.timestamp, numeric: true },
                  ...unreadRows,
                ]}
              />
            </>
          )}
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}
