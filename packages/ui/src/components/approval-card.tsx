import { useState } from "react";
import { cn } from "../lib/cn.js";
import { Button } from "./button.js";
import { CONFIRM_COPY, ConfirmPrompt } from "./confirm-prompt.js";
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

/** Exported for the approval stack (US-D03): a collapsed one-line row leads with the same action
 *  word the expanded card's title uses, so a row and its card cannot disagree. */
export const ACTION_LABEL: Record<ApprovalCardAction, string> = {
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
  /** US-D03: the approval stack passes the elevation hook here rather than wrapping the card —
   *  a wrapper div would put the shadow outside the card's own radius. */
  className?: string;
}

export function ApprovalCardView({ interrupt, onDecide, className }: ApprovalCardViewProps) {
  const { config } = interrupt;
  /** US-D09 §c.8: approving is the one decision here that goes out to the tool and cannot be taken
   *  back from this screen, so it asks first — and the prompt repeats the description rather than a
   *  pronoun, because the card behind it is dimmed and the question has to stand on its own. */
  const [confirming, setConfirming] = useState(false);
  return (
    <OpaqueSurface className={cn("approval-card", className)}>
      <p className="approval-card__title">{ACTION_LABEL[interrupt.action]} needs your approval</p>
      <p className="approval-card__description">{interrupt.description}</p>
      <div className="approval-card__actions">
        {config.allow_accept && <Button onClick={() => setConfirming(true)}>Approve</Button>}
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
      {/* The one decision that leaves this screen for good is the one marked destructive, so its
          pill can leave the accent; the others are still recoverable by deciding again. */}
      <ConfirmPrompt
        open={confirming}
        onOpenChange={setConfirming}
        {...CONFIRM_COPY.approve(interrupt.description)}
        confirmLabel="Approve"
        destructive={interrupt.action === "delete"}
        onConfirm={() => onDecide("accept", undefined)}
      />
    </OpaqueSurface>
  );
}
