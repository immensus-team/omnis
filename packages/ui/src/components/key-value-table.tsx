import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";

/** US-D03: the key-value hairline table from ref-dashboard-detail-card.webp (the right card's
 *  Type/Built/Construction block). A grey 13px label on the left, the value on the right, and one
 *  1px hairline between rows — this is the **one** place in the product where hairlines are
 *  allowed (DESIGN-DIRECTION: lists carry no hairlines; only the selected row elevates). Putting
 *  them inside a table cell stack is what the reference does, so copying it here is not the same
 *  move as ruling the inbox rows.
 *
 *  It takes finished rows rather than a record because two callers want different subsets of the
 *  same object (the hover card has no relationship state, the person card does) and a row whose
 *  value is absent has to disappear, not print "—". */
export interface KeyValueRow {
  /** Left cell. Also the React key: two rows with the same label in one table is a bug, not a
   *  layout choice. */
  label: string;
  value: ReactNode;
  /** Times and counts. Switches the value to tabular figures so a column of them lines up — the
   *  reference does this for the dates in its seller cards, and relative times ("3m", "11m") are
   *  the same kind of column. */
  numeric?: boolean;
}

export interface KeyValueTableProps {
  /** Already filtered — a row with nothing to say is left out by the caller. */
  rows: KeyValueRow[];
  className?: string;
}

export function KeyValueTable({ rows, className }: KeyValueTableProps) {
  if (rows.length === 0) return null;
  return (
    <dl className={cn("key-value-table", className)}>
      {rows.map((row) => (
        <div
          key={row.label}
          className="key-value-table__row"
          data-numeric={row.numeric ? "true" : undefined}
        >
          <dt className="key-value-table__label">{row.label}</dt>
          <dd className="key-value-table__value">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
