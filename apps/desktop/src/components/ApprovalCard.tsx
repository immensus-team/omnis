import { type ApprovalCardDecision, type ApprovalCardInterrupt, ApprovalCardView } from "@omnis/ui";
import { decideApproval } from "../api/approvals.js";

export function ApprovalCard({ id, interrupt }: { id: string; interrupt: ApprovalCardInterrupt }) {
  function handleDecide(decision: ApprovalCardDecision, decidedArgs?: Record<string, unknown>) {
    void decideApproval(id, decision, decidedArgs);
  }
  return <ApprovalCardView interrupt={interrupt} onDecide={handleDecide} />;
}
