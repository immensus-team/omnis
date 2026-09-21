// A5 §4.5 / delta §2.3 / §7: the PWA half of the Web Push subscription. The browser owns the keys
// (PushManager mints them against the push service's endpoint); this module only converts what the
// browser hands back into the body the hub stores.
//
// A5 §4.5 says the permission request happens when the first pending-approval item appears, in
// context. That decision belongs to the caller (App.tsx), not here — nothing in this file asks for
// permission on its own, because a prompt that appears before there is an approval to act on is the
// prompt people deny by reflex.

/** Same shape as the delta §2.3 `PushSubscription`, which is also what POST /push/subscribe parses. */
export interface PushSubscriptionPayload {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  ua?: string;
}

/** delta §2.3 caps `ua` at 200 chars. */
const UA_MAX = 200;

/** A `PushSubscriptionJSON` with no keys cannot be delivered to, so it is an error rather than a
 *  subscription the hub would store and then fail on for every notification. */
export function toSubscriptionPayload(
  json: PushSubscriptionJSON,
  ua?: string,
): PushSubscriptionPayload {
  const endpoint = json.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (endpoint === undefined || p256dh === undefined || auth === undefined) {
    throw new Error("PushSubscriptionJSON missing endpoint or keys");
  }
  return {
    endpoint,
    keys: { p256dh, auth },
    ...(ua !== undefined && ua !== "" ? { ua: ua.slice(0, UA_MAX) } : {}),
  };
}

// Same convention as zero-client.ts: empty means "same origin", which the dev server's proxy
// provides (vite.config.ts proxies /push to the hub) and Tailscale Serve provides on the mini.
const HUB_HTTP_URL = import.meta.env.OMNIS_HUB_HTTP_URL ?? "http://127.0.0.1:8787";

/** Registers this device with the hub so the notifier can reach it. Safe to call again: the hub
 *  upserts by endpoint. Throws when the hub has no VAPID key (503 — push is not configured there)
 *  or when the browser refuses the subscription, so the caller can decide whether to say anything. */
export async function subscribeToPush(): Promise<void> {
  const reg = await navigator.serviceWorker.ready;
  const keyRes = await fetch(`${HUB_HTTP_URL}/push/vapid-public-key`);
  if (!keyRes.ok) throw new Error(`vapid key fetch failed: HTTP ${keyRes.status}`);
  const { key } = (await keyRes.json()) as { key: string };
  // userVisibleOnly is required by Safari/Chrome for a subscription that may show a notification.
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const payload = toSubscriptionPayload(sub.toJSON(), navigator.userAgent);
  const res = await fetch(`${HUB_HTTP_URL}/push/subscribe`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`push subscribe failed: HTTP ${res.status}`);
}
