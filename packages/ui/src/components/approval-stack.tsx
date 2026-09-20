import { useState } from "react";
import {
  ACTION_LABEL,
  type ApprovalCardDecision,
  type ApprovalCardInterrupt,
  ApprovalCardView,
} from "./approval-card.js";

/** US-D03: what the detail pane's approval area gets instead of a wall of identical cards. Every
 *  pending approval used to render as the same 12px-radius card with the same four buttons, so
 *  three of them read as one repeated object and the eye had nowhere to land.
 *
 *  The rule now: the approval that belongs to the thread you have open is the one you are looking
 *  at, so it is expanded and elevated; everything else (the thread's older approvals and every
 *  other thread's) collapses to a one-line row under a count. The scoping is in
 *  scopeApprovalStack so it can be tested without a DOM. */
export interface ApprovalStackItem extends ApprovalCardInterrupt {
  id: string;
  /** pending_approvals.thread_id — nullable in the schema (an approval raised outside any thread). */
  thread_id: string | null;
  /** 'normal' | 'high' (approvals_risk_ck). */
  risk: string;
  created_at: number;
}

export interface ApprovalStackProps<T extends ApprovalStackItem> {
  /** Every pending approval, in whatever order the query returned. */
  approvals: T[];
  /** The thread the detail pane currently shows, or null when nothing is open. */
  openThreadId: string | null;
  onDecide: (
    id: string,
    decision: ApprovalCardDecision,
    decidedArgs?: Record<string, unknown>,
  ) => void;
}

function riskRank(risk: string): number {
  return risk === "high" ? 1 : 0;
}

/** Risk first, then newest. The kernel's own pending list (packages/kernel/src/approvals.ts §12)
 *  sorts risk DESC, created_at **ASC** — that is a work queue, where oldest-first stops anything
 *  from being starved. This is the opposite question ("what should I look at right now"), and the
 *  answer to that is the newest one. */
function byAttention<T extends ApprovalStackItem>(a: T, b: T): number {
  return riskRank(b.risk) - riskRank(a.risk) || b.created_at - a.created_at;
}

export function scopeApprovalStack<T extends ApprovalStackItem>(
  approvals: T[],
  openThreadId: string | null,
): { primary: T | null; collapsed: T[] } {
  // With no thread open there is no narrower scope to apply — the whole pending queue is the
  // scope, so the pane still leads with one real card instead of a list of stubs.
  const scope =
    openThreadId === null ? approvals : approvals.filter((a) => a.thread_id === openThreadId);
  const primary = [...scope].sort(byAttention)[0] ?? null;
  if (primary === null) return { primary: null, collapsed: approvals };
  // The primary is always first in the collapsed list's own order: the rest of the open thread's
  // approvals, then everybody else's.
  const rest = approvals.filter((a) => a.id !== primary.id);
  const inScope = rest.filter((a) => a.thread_id === openThreadId).sort(byAttention);
  const outOfScope = rest.filter((a) => a.thread_id !== openThreadId).sort(byAttention);
  return { primary, collapsed: [...inScope, ...outOfScope] };
}

export function ApprovalStack<T extends ApprovalStackItem>({
  approvals,
  openThreadId,
  onDecide,
}: ApprovalStackProps<T>) {
  // null means "the scope's own choice" (scopeApprovalStack's primary). Picking a collapsed row
  // overrides it — one card is expanded at a time, whichever way it was chosen.
  const [pickedId, setPickedId] = useState<string | null>(null);
  const { primary, collapsed } = scopeApprovalStack(approvals, openThreadId);
  // An empty stack draws nothing at all: a landmark with nothing in it is a heading without a list
  // under it. Guarded here so no caller has to remember.
  if (approvals.length === 0) return null;
  const activeId = pickedId ?? primary?.id ?? null;
  const active = approvals.find((a) => a.id === activeId) ?? null;
  // Picking a collapsed row promotes it — so it leaves the collapsed list. Without this it would
  // be on screen twice, once as the card and once as the row that opened it.
  const rest = collapsed.filter((item) => item.id !== activeId);

  return (
    <section className="approval-stack" aria-label="Pending approvals">
      {active && (
        <ApprovalCardView
          interrupt={active}
          className="approval-stack__card"
          onDecide={(decision, decidedArgs) => onDecide(active.id, decision, decidedArgs)}
        />
      )}
      {rest.length > 0 && <p className="approval-stack__header">{rest.length} more waiting</p>}
      {rest.map((item) => (
        <button
          key={item.id}
          type="button"
          className="approval-stack__row"
          aria-expanded={false}
          onClick={() => setPickedId(item.id)}
        >
          <span className="approval-stack__row-action">{ACTION_LABEL[item.action]}</span>
          <span className="approval-stack__row-text">{item.description}</span>
          {item.risk === "high" && <span className="approval-stack__risk">High risk</span>}
        </button>
      ))}
    </section>
  );
}
