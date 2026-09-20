-- 0011_push_subscriptions.sql
-- Delta §6 table (US-B36): PWA Web Push subscriptions. Owned by the W0 schema bundle
-- (cross-review M3).
-- Not added to Zero replication (see 0013) — only the hub reads subscriptions.
CREATE TABLE push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint    text UNIQUE NOT NULL,
  p256dh      text NOT NULL,
  auth        text NOT NULL,
  ua          text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_ok_at  timestamptz,
  fail_count  int NOT NULL DEFAULT 0
);
