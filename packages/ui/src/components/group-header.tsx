import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";

/** A one-line header that groups the list by state (the "In review 6 +" grammar of
 * ref-issue-tracker-density.webp). Two of the reference's three pieces are built: the status pill
 * (tone colour) then the count (a separate grey chip outside the pill). The "+" is left out —
 * omnis has no flow yet for creating a session into a group state, so drawing it would be a button
 * that reaches nothing (a POLISH-LOG US-D02 round-3 deviation item). If that flow appears, `onAdd`
 * goes back in here.
 * Putting the count inside the pill makes the header read as a fourth chip the same size and shape
 * as the filter chip row directly above it; separating them is what makes it read as "section label
 * + count". There is no card chrome (border, background, shadow) either: the header is a label
 * between rows, not another surface. */
export interface GroupHeaderProps {
  pill: ReactNode; // an <AgentStatusPill/>
  /** This group's row count. 0 is a real value, so the chip is only left out when it is undefined. */
  count?: number | undefined;
  className?: string;
}

export function GroupHeader({ pill, count, className }: GroupHeaderProps) {
  return (
    // role="presentation": these headers go inside Virtuoso's role="listbox", mixed in with the
    // rows. With the default (generic) role, AT counts the listbox's children as options and reads
    // more of them than there are rows.
    <div role="presentation" className={cn("group-header", className)}>
      {pill}
      {count !== undefined && <span className="group-header__count">{count}</span>}
    </div>
  );
}
