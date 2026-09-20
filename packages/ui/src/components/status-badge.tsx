import type { AgentSessionKinsoState } from "../lib/row-meta.js";
import type { UiItemStatus } from "../types.js";

const STATUS_LABEL: Record<UiItemStatus, string> = {
  received: "Received",
  read: "Read",
  draft: "Draft",
  approved: "Approved",
  sent: "Sent",
  failed: "Failed",
  archived: "Archived",
};

export function StatusBadge({ status }: { status: UiItemStatus }) {
  return (
    <span className="status-badge" data-status={status}>
      {STATUS_LABEL[status]}
    </span>
  );
}

/** U2: the badge InboxRow's fixed right slot shows instead of a channel glyph on an agent_session
 * row (herdr idle/working/blocked/done — DESIGN-DIRECTION.md; row-meta.ts maps the DB state here). */
const AGENT_STATE_LABEL: Record<AgentSessionKinsoState, string> = {
  idle: "Idle",
  working: "Working",
  blocked: "Blocked",
  done: "Done",
};

export function AgentStatusBadge({ state }: { state: AgentSessionKinsoState }) {
  return (
    <span className="status-badge status-badge--agent" data-agent-state={state}>
      {AGENT_STATE_LABEL[state]}
    </span>
  );
}
