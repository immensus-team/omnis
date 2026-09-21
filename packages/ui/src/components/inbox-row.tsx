import * as HoverCard from "@radix-ui/react-hover-card";
import { type CSSProperties, type RefObject, useEffect, useRef, useState } from "react";
import { cn } from "../lib/cn.js";
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
          tabIndex={0}
          aria-selected={props.selected}
          className={cn(
            "inbox-row",
            props.selected && "inbox-row--selected",
            props.last && "inbox-row--last",
            leaving && "inbox-row--leaving",
          )}
          onClick={() => props.onSelect(props.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              props.onSelect(props.id);
            }
          }}
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
