// Subscription storage for the PWA's Web Push (delta §7, US-B36).
// Sending is not here: VAPID configuration, signing, and 410/404 pruning have exactly one owner,
// @omnis/kernel's notify/webpush.ts (agents plan Task 12, cross review M-webpush). This file only
// inserts and removes the subscriptions the PWA sends into push_subscriptions.
import { query } from "@omnis/db";
import type { Pool } from "pg";

/** Mirror of the delta §2.3 `PushSubscription` — the keys are the browser's `PushSubscriptionJSON`
 *  ones, one level deep (apps/web/src/push/subscribe.ts builds this shape). */
export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  ua?: string;
}

/** delta §2.3 caps `ua` at 200 chars. Truncated rather than rejected: a browser with a long user
 *  agent string must not be the one device that cannot subscribe. The cap lives here, where every
 *  caller routes through, instead of in each caller. */
const UA_MAX = 200;

export async function saveSubscription(pool: Pool, sub: PushSubscriptionInput): Promise<string> {
  const rows = await query<{ id: string }>(
    pool,
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, ua)
       VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE SET p256dh = $2, auth = $3, ua = $4, fail_count = 0
     RETURNING id`,
    [sub.endpoint, sub.keys.p256dh, sub.keys.auth, sub.ua?.slice(0, UA_MAX) ?? null],
  );
  const row = rows[0];
  if (row === undefined) throw new Error("insert push_subscriptions returned no row");
  return row.id;
}

export async function removeSubscription(pool: Pool, endpoint: string): Promise<boolean> {
  const rows = await query(
    pool,
    "DELETE FROM push_subscriptions WHERE endpoint = $1 RETURNING id",
    [endpoint],
  );
  return rows.length > 0;
}
