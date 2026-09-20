import type { UiItemStatus } from "@omnis/ui";
import { AgentStatusBadge, StatusBadge } from "@omnis/ui";
import type { AgentSessionKinsoState } from "@omnis/ui/lib/row-meta";

const STATUSES: UiItemStatus[] = [
  "received",
  "read",
  "draft",
  "approved",
  "sent",
  "failed",
  "archived",
];

/** herdr 4-state — a different axis from UiItemStatus: this is the agent session, not the item. */
const AGENT_STATES: AgentSessionKinsoState[] = ["idle", "working", "blocked", "done"];

const flexRow = { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" } as const;

export function StatusBadgeDemo() {
  return (
    <div>
      <p className="gallery-variant-label">UiItemStatus</p>
      <div style={{ ...flexRow, marginBottom: 16 }}>
        {STATUSES.map((status) => (
          <StatusBadge key={status} status={status} />
        ))}
      </div>
      <p className="gallery-variant-label">AgentSessionKinsoState</p>
      <div style={flexRow}>
        {AGENT_STATES.map((state) => (
          <AgentStatusBadge key={state} state={state} />
        ))}
      </div>
    </div>
  );
}
