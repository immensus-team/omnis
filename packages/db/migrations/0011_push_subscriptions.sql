-- 0011_push_subscriptions.sql
-- 델타 §6 표 (US-B36): PWA Web Push 구독. W0 스키마 번들 소유(교차 리뷰 M3).
-- Zero 복제에는 넣지 않는다(0013 참고) — 구독은 허브만 읽는다.
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
