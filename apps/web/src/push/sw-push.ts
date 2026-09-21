// A5 §4.4: what the phone shows and what a tap on it means. These two functions are the whole of
// the service worker's push/notificationclick decision, kept free of `self` and the DOM so they can
// be tested without a real service worker (the wiring that feeds them a push event is a follow-up
// task — see the plan's open questions).
//
// Delta §2.3 `PushPayload` is mirrored here rather than imported: apps/web depends on @omnis/ui and
// @omnis/kernel but not on @omnis/protocol, and the Global Constraints' package-boundary ruling has
// packages/ui mirror these types locally for exactly this reason.
export interface PushPayload {
  kind: "draft" | "approval" | "vip" | "briefing" | "digest" | "followup" | "adapter_down";
  title: string;
  body: string;
  deep_link: string;
  /** Present only for a pending approval; it is what turns the notification into a one-tap accept. */
  approval_id?: string;
}

/** A5 §4.4: at most two actions. Approve only exists when there is something to approve — an
 *  Approve button that opens the app instead is worse than no button. The body arrives already
 *  trimmed to 80 chars by the hub (first80), so it is passed through untouched. */
export function buildNotificationOptions(payload: PushPayload): {
  body: string;
  actions: { action: string; title: string }[];
} {
  const actions =
    payload.approval_id !== undefined
      ? [
          { action: "approve", title: "Approve" },
          { action: "open", title: "Open" },
        ]
      : [{ action: "open", title: "Open" }];
  return { body: payload.body, actions };
}

export type NotificationClickIntent =
  | { kind: "approve"; approvalId: string }
  | { kind: "open"; url: string };

/** `action` is "" when the notification body itself was tapped rather than an action button — A5
 *  §4.4 treats that the same as Open. Anything else that is not a usable approve falls back to the
 *  deep link rather than being swallowed: the notification is already on screen, and a tap that does
 *  nothing reads as the app being broken. */
export function resolveNotificationClick(
  action: string,
  payload: PushPayload,
): NotificationClickIntent {
  if (action === "approve" && payload.approval_id !== undefined) {
    return { kind: "approve", approvalId: payload.approval_id };
  }
  return { kind: "open", url: payload.deep_link };
}
