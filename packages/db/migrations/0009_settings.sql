-- 0009_settings.sql
-- Delta §6 / B-D2 (US-B33): a single settings kv table. Owned by the W0 schema bundle.
CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- omnis_control is the channel 0007_notify.sql already created — settings changes ride on it
-- (Delta §6: no new NOTIFY channel).
CREATE OR REPLACE FUNCTION notify_settings_change() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('omnis_control', json_build_object('settings', NEW.key)::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER settings_notify AFTER INSERT OR UPDATE ON settings
  FOR EACH ROW EXECUTE FUNCTION notify_settings_change();

INSERT INTO settings (key, value) VALUES
  ('cost.cap_usd', '60'),
  ('cost.reserve_ratio', '0.1'),
  ('notify.quiet_hours', '{"start":"23:00","end":"07:00","vipOverride":true}'),
  ('notify.vip_override', 'true'),
  ('archive.t1_confidence_min', '0.85'),
  ('archive.enabled', 'true'),
  ('ingest.local_roots.mini', '[]'),
  ('ingest.local_roots.macbook', '[]'),
  ('ingest.drive_folders', '[]'),
  ('ingest.github_repos', '[]'),
  ('autonomy.rules', '[]'),
  ('kakao.send_enabled_at', 'null');
