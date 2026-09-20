CREATE TABLE IF NOT EXISTS probe_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  val text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER SYSTEM SET wal_level = 'logical';
