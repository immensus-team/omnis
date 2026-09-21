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
 *  The rule now: the pane is about the thread you have open, so the only approvals it shows are
 *  that thread's. The riskiest of them is expanded and elevated; the thread's own older ones
 *  collapse to one-line rows under a count. Other threads' approvals do not appear at all — the
 *  inbox's needs-approval tab is the queue surface, and a pane that opens on another
 *  conversation's work is a pane that never opens on its own title.
 *
 *  The one exception is a pane with nothing open at all: it has no thread to be about, so the
 *  whole queue is its scope rather than an empty column. The scoping is in scopeApprovalStack so
 *  it can be tested without a DOM. */
export interface ApprovalStackItem extends ApprovalCardInterrupt {
  id: string;
  /** pending_approvals.thread_id — nullable in the schema (an approval raised outside any thread). */
  thread_id: string | null;
  /** loop-r2-02: pending_approvals.item_id — the message the action is about, when it is about one.
   *  A `send` proposed over a `draft` item carries that draft's id, which is how the thread view
   *  knows the card and the draft are one reply rather than two. Nullable: most approvals are about
   *  something that is not an item of ours. */
  item_id?: string | null;
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
  /** loop-r2-01: the expanded card's header says where the action goes ("Reply in #omnis-launch"),
   *  and only the caller knows that — the name is the thread's title, which the approval row stores
   *  as an id. Omitted, the card drops that half of the sentence rather than guessing one. */
  destinationFor?: (item: T) => string | null;
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
  // With a thread open the scope is that thread and nothing else. With no thread open there is no
  // narrower scope to read, so the whole queue is the scope — that pane has nothing else in it,
  // and one real card beats an empty column.
  const scope =
    openThreadId === null ? approvals : approvals.filter((a) => a.thread_id === openThreadId);
  const primary = [...scope].sort(byAttention)[0] ?? null;
  // A thread with no pending approval of its own has an empty stack, not a list of other threads'
  // work: this returns empty and the component below draws nothing.
  return { primary, collapsed: scope.filter((a) => a.id !== primary?.id).sort(byAttention) };
}

export function ApprovalStack<T extends ApprovalStackItem>({
  approvals,
  openThreadId,
  onDecide,
  destinationFor,
}: ApprovalStackProps<T>) {
  // null means "the scope's own choice" (scopeApprovalStack's primary). Picking a collapsed row
  // overrides it — one card is expanded at a time, whichever way it was chosen.
  const [pickedId, setPickedId] = useState<string | null>(null);
  const { primary, collapsed } = scopeApprovalStack(approvals, openThreadId);
  // The pick is resolved **inside the scope**, never against the raw queue. This component is a
  // stable child of the thread view, so opening another thread re-renders it rather than remounting
  // it and pickedId outlives the thread it was picked in; looking that id up in `approvals` would
  // expand another conversation's card under this thread's title, which is the whole thing the
  // scoping exists to prevent. A pick that is no longer in scope yields to the scope's own primary.
  const inScope = primary ? [primary, ...collapsed] : collapsed;
  const active = inScope.find((a) => a.id === pickedId) ?? primary;
  // Picking a collapsed row promotes it — so it leaves the collapsed list. Without this it would
  // be on screen twice, once as the card and once as the row that opened it. Keyed off the
  // resolved card rather than off pickedId, so the two cannot disagree about which one is on top.
  const rest = collapsed.filter((item) => item.id !== active?.id);
  // An empty stack draws nothing at all: a landmark with nothing in it is a heading without a list
  // under it. This is the empty queue **and** the open thread that has no approval of its own —
  // both are "nothing of mine to decide here", and the pane simply does not raise the subject.
  if (active === null && rest.length === 0) return null;

  return (
    <section className="approval-stack" aria-label="Pending approvals">
      {active && (
        <ApprovalCardView
          interrupt={active}
          className="approval-stack__card"
          destination={destinationFor?.(active) ?? null}
          risk={active.risk}
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
