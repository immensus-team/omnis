import { DraftCard } from "@omnis/ui";

/** The draft card has no variants — a single visual state exists (A5-D9: full body exposed, no summary).
 *  The callback is a no-op for the demo.
 *
 *  loop-r2-02: Discard is the only action left. "Edit & send" and "Regenerate" were buttons that did
 *  nothing when pressed; a draft that has an approval is shown as that approval's card instead, and
 *  the standalone draft gets "Edit & send" back on loop-r2-03, wired to the composer. */
export function DraftCardDemo() {
  return (
    <DraftCard
      body="Hi Minji, let's go with Thursday 3pm as you suggested. I've sent a calendar invite — please confirm. Let me know if that time doesn't work and I'll find another slot."
      rationale="Based on recent thread context"
      onDiscard={() => {}}
    />
  );
}
