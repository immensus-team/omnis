import { ToolCallBadge } from "@omnis/ui";
import type { TOOL_LABELS, ToolCallBadgeProps } from "@omnis/ui";

/** ToolCallBadge throws on any key not in TOOL_LABELS (master §11 palette), so the tool name is
 *  typed as `keyof typeof TOOL_LABELS` — a typo is a typecheck error, not a runtime crash. */
type Tool = keyof typeof TOOL_LABELS;

const BADGES: { tool: Tool; state: ToolCallBadgeProps["state"]; resultSummary?: string }[] = [
  { tool: "search_memory", state: "loading" },
  { tool: "propose_draft", state: "done", resultSummary: "1 reply draft" },
  { tool: "read_calendar", state: "error" },
  { tool: "read", state: "done", resultSummary: "1 document read" },
  { tool: "read_session", state: "done", resultSummary: "2 sessions checked" },
  { tool: "propose_task", state: "done", resultSummary: "3 tasks extracted" },
  { tool: "propose_delegation", state: "done", resultSummary: "1 delegation proposed" },
  { tool: "propose_route", state: "done", resultSummary: "2 notes routed" },
];

export function ToolCallBadgeDemo() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
      {BADGES.map((badge) => (
        <ToolCallBadge key={badge.tool} {...badge} />
      ))}
    </div>
  );
}
