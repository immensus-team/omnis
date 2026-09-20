import { cn } from "../lib/cn.js";
import type { AgentSessionKinsoState } from "../lib/row-meta.js";

/** The tinted pill for group headers and the filter bar (ref-issue-tracker-density.webp). It plays a
 * different role from the existing `.status-badge` (999px capsule, 12px, the row's right slot), so
 * the size and radius are deliberately kept apart — the badge is a tag inside one row, the pill is a
 * header/filter that binds a list together.
 * The count is not here: in the reference the number is a separate grey chip outside the pill, drawn
 * by GroupHeader. */
export type PillTone = "neutral" | "info" | "warning" | "danger" | "success";

export interface StatusPillProps {
  tone: PillTone;
  label: string;
  className?: string;
}

export function StatusPill({ tone, label, className }: StatusPillProps) {
  return (
    <span className={cn("status-pill", className)} data-tone={tone}>
      <span className="status-pill__dot" />
      {label}
    </span>
  );
}

/** AgentSessionKinsoState (idle/working/blocked/done) as-is — the existing design decision that the
 * DB mapping (row-meta.ts DB_STATE_TO_KINSO) folds failed into blocked is left alone. The task brief
 * also asks for a "failed" pill variant, but that is not a value arriving independently from
 * agent_sessions.state, so it is layered on as a presentational-only state (AgentPillState) rather
 * than touching AgentSessionKinsoState.
 * ponytail: if failed ever has to read apart from blocked, widen AgentPillState here and
 * DB_STATE_TO_KINSO in row-meta.ts together. */
export type AgentPillState = AgentSessionKinsoState | "failed";

const AGENT_META: Record<AgentPillState, { label: string; tone: PillTone }> = {
  idle: { label: "Idle", tone: "neutral" },
  working: { label: "Working", tone: "info" },
  // Both the label **and** the tone match the row badge (status-badge.tsx AgentStatusBadge). Round 2
  // matched only the label and left the colour on danger, so the same "Blocked" was red in the
  // header and blue in the row. Why warning: blocked means "needs my reply", not an error (the
  // error is failed) — and the colour this repository already uses for "your turn" is --warn-500
  // (.inbox-row__approval-dot). The actual colour comes from one rule in app.css that serves the
  // pill and the badge at once (two selectors, one set of values).
  blocked: { label: "Blocked", tone: "warning" },
  done: { label: "Done", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
};

export function AgentStatusPill({ state }: { state: AgentPillState }) {
  const { label, tone } = AGENT_META[state];
  return <StatusPill tone={tone} label={label} />;
}
