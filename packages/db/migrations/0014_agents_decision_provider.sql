-- packages/db/migrations/0014_agents_decision_provider.sql
-- The decision tier's provider switch — "llm" (default) or "jev".
-- See docs/decisions/2026-09-21-jev-decision-tier.md.
--
-- 0009_settings.sql seeded every SettingKey that existed at the time, but the spike added
-- agents.decision_provider afterwards. Applied migrations are frozen (migrate.ts hashes each
-- file's bytes and refuses to run a changed one), so the missing row arrives here instead of
-- by editing 0009. "llm" keeps the existing decider as the default path; a run opts into "jev".

INSERT INTO settings (key, value) VALUES
  ('agents.decision_provider', '"llm"')
ON CONFLICT (key) DO NOTHING;
