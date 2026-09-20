import {
  Calendar,
  Eye,
  ListChecks,
  type LucideIcon,
  MessagesSquare,
  PenLine,
  Route,
  Search,
  Share2,
} from "lucide-react";

export const TOOL_LABELS: Record<string, { label: string; icon: LucideIcon }> = {
  read: { label: "읽는 중", icon: Eye },
  search_memory: { label: "메모리 검색 중", icon: Search },
  read_calendar: { label: "캘린더 확인 중", icon: Calendar },
  read_session: { label: "다른 세션 확인 중", icon: MessagesSquare },
  propose_draft: { label: "답장 초안 작성 중", icon: PenLine },
  propose_task: { label: "할 일 추출 중", icon: ListChecks },
  propose_delegation: { label: "위임 제안 중", icon: Share2 },
  propose_route: { label: "노트 라우팅 제안 중", icon: Route },
};

export type ToolCallState = "loading" | "done" | "error";

export interface ToolCallBadgeProps {
  tool: string;
  state: ToolCallState;
  resultSummary?: string;
}

/** `send`/`delete`/`delegate`/`calendar_write`는 master §11 원칙상 tool palette에 없다 —
 *  이 배지에 들어오면 버그이므로 조용히 빈 배지를 그리지 않고 즉시 throw한다. */
export function ToolCallBadge({ tool, state, resultSummary }: ToolCallBadgeProps) {
  const meta = TOOL_LABELS[tool];
  if (!meta) throw new Error(`ToolCallBadge: unknown tool "${tool}" — not in master §11 palette`);
  const Icon = meta.icon;
  return (
    <div className="tool-call-badge" aria-busy={state === "loading"} data-state={state}>
      <Icon size={16} strokeWidth={2} />
      <span>{meta.label}</span>
      {state === "done" && <span aria-live="polite">✓ {resultSummary}</span>}
      {state === "error" && <span aria-live="polite">⚠ 재시도</span>}
    </div>
  );
}
