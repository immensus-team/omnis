import { type ApprovalCardInterrupt, ApprovalCardView } from "@omnis/ui";

/** 3 configs expose every conditional button branch:
 *  - send: accept + edit-then-accept + ignore (3 buttons)
 *  - calendar_write: accept only (with the 3 allow_* flags false the buttons disappear)
 *  - delegate: respond + ignore (with allow_accept=false there is no primary button) */
const INTERRUPTS: ApprovalCardInterrupt[] = [
  {
    action: "send",
    description: "Sends a reply to Minji Kim confirming the meeting time.",
    config: { allow_accept: true, allow_edit: true, allow_respond: false, allow_ignore: true },
  },
  {
    action: "calendar_write",
    description: "Adds the Thursday 3:00 PM 'Design review' event to the calendar.",
    config: { allow_accept: true, allow_edit: false, allow_respond: false, allow_ignore: false },
  },
  {
    action: "delegate",
    description: "Hands off expense-report verification to the finance agent.",
    config: { allow_accept: false, allow_edit: false, allow_respond: true, allow_ignore: true },
  },
];

export function ApprovalCardDemo() {
  return (
    <div>
      {INTERRUPTS.map((interrupt) => (
        <div key={interrupt.action} style={{ marginBottom: 16 }}>
          <ApprovalCardView interrupt={interrupt} onDecide={() => {}} />
        </div>
      ))}
    </div>
  );
}
