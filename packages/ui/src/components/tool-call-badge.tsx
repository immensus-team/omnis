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
import { OpaqueSurface } from "./glass-surface.js";

export const TOOL_LABELS: Record<string, { label: string; icon: LucideIcon }> = {
  read: { label: "Reading", icon: Eye },
  search_memory: { label: "Searching memory", icon: Search },
  read_calendar: { label: "Checking the calendar", icon: Calendar },
  read_session: { label: "Checking another session", icon: MessagesSquare },
  propose_draft: { label: "Drafting a reply", icon: PenLine },
  propose_task: { label: "Extracting tasks", icon: ListChecks },
  propose_delegation: { label: "Proposing a delegation", icon: Share2 },
  propose_route: { label: "Routing a note", icon: Route },
};

export type ToolCallState = "loading" | "done" | "error";

export interface ToolCallBadgeProps {
  tool: string;
  state: ToolCallState;
  resultSummary?: string;
}

/** `send`/`delete`/`delegate`/`calendar_write` are absent from the tool palette by master §11 —
 *  one arriving here is a bug, so the badge throws instead of silently drawing an empty pill. */
/** US-D09 §c.5: an opaque surface, not a glass one — a tool call sits in the message body, and
 *  glass is chrome (ACCENT §4.4). The wrapper is `OpaqueSurface` rather than a class on a div so a
 *  DOM inspection finds the same `.opaque-surface` on this and on the approval card beside it. */
export function ToolCallBadge({ tool, state, resultSummary }: ToolCallBadgeProps) {
  const meta = TOOL_LABELS[tool];
  if (!meta) throw new Error(`ToolCallBadge: unknown tool "${tool}" — not in master §11 palette`);
  const Icon = meta.icon;
  return (
    <OpaqueSurface className="tool-call-badge" aria-busy={state === "loading"} data-state={state}>
      <Icon size={16} strokeWidth={2} aria-hidden="true" />
      <span>{meta.label}</span>
      {state === "done" && <span aria-live="polite">✓ {resultSummary}</span>}
      {state === "error" && <span aria-live="polite">⚠ Retry</span>}
    </OpaqueSurface>
  );
}
