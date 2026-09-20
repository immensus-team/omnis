import { DraftCard } from "@omnis/ui";

/** The draft card has no variants — a single visual state exists (A5-D9: full body exposed, no summary).
 *  The callbacks are no-ops for the demo. */
export function DraftCardDemo() {
  return (
    <DraftCard
      body="Hi Minji, let's go with Thursday 3pm as you suggested. I've sent a calendar invite — please confirm. Let me know if that time doesn't work and I'll find another slot."
      rationale="Based on recent thread context"
      onEditAndSend={() => {}}
      onDiscard={() => {}}
      onRegenerate={() => {}}
    />
  );
}
