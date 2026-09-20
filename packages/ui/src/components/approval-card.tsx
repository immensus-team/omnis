import { Button } from "./button.js";
import { OpaqueSurface } from "./glass-surface.js";

export type ApprovalCardAction =
  | "send"
  | "delete"
  | "calendar_write"
  | "delegate"
  | "self_model_edit"
  | "memory_write";
export type ApprovalCardDecision = "accept" | "edit" | "respond" | "ignore";

/** Mirrors @omnis/protocol's HumanInterrupt (a package-boundary call — protocol is not imported). */
export interface ApprovalCardInterrupt {
  action: ApprovalCardAction;
  description: string;
  args?: Record<string, unknown>;
  config: {
    allow_accept: boolean;
    allow_edit: boolean;
    allow_respond: boolean;
    allow_ignore: boolean;
  };
}

const ACTION_LABEL: Record<ApprovalCardAction, string> = {
  send: "Send",
  delete: "Delete",
  calendar_write: "Write to calendar",
  delegate: "Delegate",
  self_model_edit: "Edit profile",
  memory_write: "Write memory",
};

export interface ApprovalCardViewProps {
  interrupt: ApprovalCardInterrupt;
  onDecide: (decision: ApprovalCardDecision, decidedArgs?: Record<string, unknown>) => void;
}

export function ApprovalCardView({ interrupt, onDecide }: ApprovalCardViewProps) {
  const { config } = interrupt;
  return (
    <OpaqueSurface className="approval-card">
      <p className="approval-card__title">{ACTION_LABEL[interrupt.action]} needs your approval</p>
      <p className="approval-card__description">{interrupt.description}</p>
      <div className="approval-card__actions">
        {config.allow_accept && (
          <Button onClick={() => onDecide("accept", undefined)}>Approve</Button>
        )}
        {config.allow_edit && (
          <Button variant="ghost" onClick={() => onDecide("edit", interrupt.args)}>
            Edit &amp; approve
          </Button>
        )}
        {config.allow_respond && (
          <Button variant="ghost" onClick={() => onDecide("respond", undefined)}>
            Respond
          </Button>
        )}
        {config.allow_ignore && (
          <Button variant="ghost" onClick={() => onDecide("ignore", undefined)}>
            Ignore
          </Button>
        )}
      </div>
    </OpaqueSurface>
  );
}
