export type SwipeAction = "archive" | "menu" | "snooze" | "none";

const PARTIAL_PX = 60;
const FULL_PX = 160;

/** A5 §4.2: partial or full rightward = Archive (same action either way, only the UI affordance
 *  differs). Partial leftward = the action menu (Snooze/Label/Delegate); full leftward = the
 *  default action, which is Snooze.
 *
 *  The thresholds are px, not a fraction of the row: a finger's travel is what the gesture is
 *  about, and a fraction would make the same gesture mean different things at 320 and 414. */
export function classifySwipe(deltaX: number): SwipeAction {
  if (deltaX >= PARTIAL_PX) return "archive";
  if (deltaX <= -FULL_PX) return "snooze";
  if (deltaX <= -PARTIAL_PX) return "menu";
  return "none";
}
