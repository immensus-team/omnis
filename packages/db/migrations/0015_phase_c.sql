-- Phase C contract bundle (backlog §3). Settings are off by default; jobs are no-ops until their flags flip.
INSERT INTO settings (key, value) VALUES
  ('delegation.allow_rules', '[]'),
  ('delegation.hermes_enabled', 'false'),
  ('import.terminal_sessions', 'false'),
  ('kakao.read_stable_since', 'null')
ON CONFLICT (key) DO NOTHING;

INSERT INTO jobs (name, schedule, next_run_at) VALUES
  ('terminal_import', '*/5 * * * *', now()),
  ('followup_miss',   '15 23 * * *', now())
ON CONFLICT (name) DO NOTHING;
