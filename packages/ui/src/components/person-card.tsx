import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";
import { CHANNEL_LABEL, initialsFromName, pastelFromName } from "../lib/row-meta.js";
import type { UiChannel } from "../types.js";
import { type KeyValueRow, KeyValueTable } from "./key-value-table.js";

/** The enum behind A3's persons_rel_ck (0002_core_inbox.sql). */
export type RelationshipState = "unknown" | "new" | "warming" | "active" | "dormant" | "closed";

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
  return [
    {
      label: "Relationship",
      value: (
        <span className="status-pill" data-tone={meta.tone}>
          <span className="status-pill__dot" />
          {meta.label}
        </span>
      ),
    },
  ];
}

export function PersonCard({ person, extraRows = [], children, className }: PersonCardProps) {
  const {
    name,
    photoUrl,
    vip,
    channels = [],
    labels = [],
    lastContact,
    relationshipState,
  } = person;
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
        <p className="person-card__name">{name}</p>
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
