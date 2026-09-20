-- packages/db/migrations/0013_publication_phase_b.sql
-- delta §6: add only settings to replication, not ingest_sources·push_subscriptions.
ALTER PUBLICATION zero_omnis ADD TABLE settings;
