import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";
import { CHANNEL_LABEL, initialsFromName, pastelFromName } from "../lib/row-meta.js";
import type { UiChannel } from "../types.js";
import { type KeyValueRow, KeyValueTable } from "./key-value-table.js";

/** The enum behind A3's persons_rel_ck (0002_core_inbox.sql). */
export type RelationshipState = "unknown" | "new" | "warming" | "active" | "dormant" | "closed";

/** A5 §3.6: the six stored states collapse to the three levels the card draws a dot for, plus
 *  `unknown`. The dot is the *level*; the chip next to it still prints the precise state, because
 *  "Warming" and "New" are different enough to be worth the word and identical as a colour. */
export type RelationshipDot = "active" | "warming" | "dormant" | "unknown";

/** US-B30: `new` is a relationship forming and `closed` one that went cold — the same two levels as
 *  `warming` and `dormant` respectively, which is why six states fit on three dots. `unknown` is the
 *  column's default rather than a finding, so it gets no dot at all. */
export function relationshipDot(state: RelationshipState): RelationshipDot {
  switch (state) {
    case "active":
      return "active";
    case "new":
    case "warming":
      return "warming";
    case "dormant":
    case "closed":
      return "dormant";
    default:
      return "unknown";
  }
}

/** US-D03: the person card from ref-dashboard-detail-card.webp (the seller block: photo, name,
 *  then a hairline key-value table). One card, two callers — the inbox row's hover card now, the
 *  Network screen later — so it takes a finished record rather than reaching for a query itself.
 *  Every field except the name is optional: the card is allowed to say less, and a row with
 *  nothing to say is left out rather than printed as "—". */
export interface PersonCardData {
  name: string;
  /** Held open for identities' photo field, which does not exist yet — a person without one falls
   *  back to initials on a name-derived pastel, the same fallback the inbox row uses. */
  photoUrl?: string | null;
  /** persons.vip. Drawn as a badge only when true — "not VIP" is not a fact worth a chip. */
  vip?: boolean;
  /** The channels this person is reachable on. Omitted for an agent session, which has none. */
  channels?: readonly UiChannel[];
  /** Label names. The card draws them as chips (the badge row) and does **not** repeat them as a
   *  table row — a badge row that restates a table row is two answers to one question. */
  labels?: readonly string[];
  /** Already formatted (lib/relative-time) — the card formats nothing. */
  lastContact?: string | null;
  relationshipState?: RelationshipState | null;
  /** US-B30: A5 §3.6's "affiliation and title". Both optional — an identity resolved from a bare
   *  address has neither, and "Davich ·" with a dangling separator is worse than the name alone. */
  org?: string | null;
  role?: string | null;
}

export interface PersonCardProps {
  person: PersonCardData;
  /** Rows the caller adds after the person's own fields. The hover card's Unread is a fact about
   *  the thread, not about the person, so it does not belong in PersonCardData. */
  extraRows?: KeyValueRow[];
  /** Content between the badge row and the table — the hover card passes the full summary the row
   *  had to clamp. */
  children?: ReactNode;
  className?: string;
  /** US-B30: the Network screen opens the person in the detail pane. The hover card has nowhere to
   *  open to, so it does not pass one and the name stays a plain heading.
   *
   *  The click target is the name rather than the whole card on purpose: the card can contain its
   *  own controls (the follow-up draft's "Edit & send"), and a button wrapped around a button is
   *  invalid HTML that browsers resolve by dropping one of the two. */
  onOpen?: (() => void) | undefined;
}

/** persons.relationship_state -> a chip. "unknown" is the column's default, not a finding: a card
 *  that says "Relationship: unknown" has said nothing, so the row is dropped entirely. */
const RELATIONSHIP: Record<
  Exclude<RelationshipState, "unknown">,
  { label: string; tone: string }
> = {
  new: { label: "New", tone: "info" },
  warming: { label: "Warming", tone: "info" },
  active: { label: "Active", tone: "success" },
  dormant: { label: "Dormant", tone: "warning" },
  closed: { label: "Closed", tone: "neutral" },
};

function relationshipRow(state: PersonCardData["relationshipState"]): KeyValueRow[] {
  if (!state || state === "unknown") return [];
  const meta = RELATIONSHIP[state];
  const dot = relationshipDot(state);
  return [
    {
      label: "Relationship",
      value: (
        <span className="status-pill" data-tone={meta.tone} data-dot={dot}>
          {/* US-B30: `data-dot` is the 3-tier level (A5 §3.6) and `data-tone` the 5-state tone the
              inbox hover card already had. The chip keeps printing the precise state: the dot says
              "warm", the word says "Warming" rather than "New". */}
          <span className="status-pill__dot" data-dot={dot} />
          {meta.label}
        </span>
      ),
    },
  ];
}

export function PersonCard({
  person,
  extraRows = [],
  children,
  className,
  onOpen,
}: PersonCardProps) {
  const {
    name,
    photoUrl,
    vip,
    channels = [],
    labels = [],
    lastContact,
    relationshipState,
    org,
    role,
  } = person;
  // A5 §3.6's "affiliation and title" line. `filter(Boolean)` rather than string concatenation: a
  // person with a role and no org prints "CTO", not " · CTO".
  const orgRole = [org, role]
    .filter((v): v is string => typeof v === "string" && v !== "")
    .join(" · ");
  const rows: KeyValueRow[] = [
    ...(channels.length > 0
      ? [{ label: "Channels", value: channels.map((c) => CHANNEL_LABEL[c]).join(", ") }]
      : []),
    ...(lastContact ? [{ label: "Last contact", value: lastContact, numeric: true }] : []),
    ...relationshipRow(relationshipState),
    ...extraRows,
  ];

  return (
    <article className={cn("person-card", className)}>
      <header className="person-card__head">
        {photoUrl ? (
          <span className="person-card__avatar">
            <img className="person-card__avatar-img" src={photoUrl} alt="" />
          </span>
        ) : (
          <span
            className="person-card__avatar"
            style={{ background: pastelFromName(name) }}
            aria-hidden="true"
          >
            {initialsFromName(name)}
          </span>
        )}
        <div className="person-card__identity">
          {onOpen ? (
            <button
              type="button"
              className="person-card__name person-card__name--open"
              onClick={onOpen}
            >
              {name}
            </button>
          ) : (
            <p className="person-card__name">{name}</p>
          )}
          {orgRole !== "" && <p className="person-card__org">{orgRole}</p>}
        </div>
      </header>
      {(vip || labels.length > 0) && (
        <div className="person-card__badges">
          {vip && (
            <span className="person-card__badge" data-tone="vip">
              VIP
            </span>
          )}
          {labels.map((label) => (
            <span key={label} className="person-card__badge">
              {label}
            </span>
          ))}
        </div>
      )}
      {children}
      <KeyValueTable rows={rows} />
    </article>
  );
}
