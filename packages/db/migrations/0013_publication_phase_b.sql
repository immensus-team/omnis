-- packages/db/migrations/0013_publication_phase_b.sql
-- 델타 §6: settings만 복제에 더한다. ingest_sources·push_subscriptions는 추가하지 않는다.
ALTER PUBLICATION zero_omnis ADD TABLE settings;
