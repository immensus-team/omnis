import { ToolCallBadge } from "@omnis/ui";
import type { TOOL_LABELS, ToolCallBadgeProps } from "@omnis/ui";

/** ToolCallBadge throws on any key not in TOOL_LABELS (master §11 palette), so the tool name is
 *  typed as `keyof typeof TOOL_LABELS` — a typo is a typecheck error, not a runtime crash. */
type Tool = keyof typeof TOOL_LABELS;

const BADGES: { tool: Tool; state: ToolCallBadgeProps["state"]; resultSummary?: string }[] = [
  { tool: "search_memory", state: "loading" },
  { tool: "propose_draft", state: "done", resultSummary: "답장 초안 1개" },
  { tool: "read_calendar", state: "error" },
  { tool: "read", state: "done", resultSummary: "문서 1개 읽음" },
  { tool: "read_session", state: "done", resultSummary: "세션 2개 확인" },
  { tool: "propose_task", state: "done", resultSummary: "할 일 3개 추출" },
  { tool: "propose_delegation", state: "done", resultSummary: "위임 1건 제안" },
  { tool: "propose_route", state: "done", resultSummary: "노트 2개 라우팅" },
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
