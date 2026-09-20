import { ToolCallBadge } from "@omnis/ui";
import type { TOOL_LABELS, ToolCallBadgeProps } from "@omnis/ui";

/** ToolCallBadge throws on any key not in TOOL_LABELS (master §11 palette), so the tool name is
 *  typed as `keyof typeof TOOL_LABELS` — a typo is a typecheck error, not a runtime crash. */
type Tool = keyof typeof TOOL_LABELS;

const BADGES: { tool: Tool; state: ToolCallBadgeProps["state"]; resultSummary?: string }[] = [
  { tool: "search_memory", state: "loading" },
  { tool: "propose_draft", state: "done", resultSummary: "답장 초안 1개" },
  { tool: "read_calendar", state: "error" },
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
