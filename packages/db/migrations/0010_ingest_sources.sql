-- A4 §10.5: polling cursor and failure counter. Not a Zero replication target (Delta §10) —
-- clients have no use for it.

CREATE TABLE ingest_sources (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_kind text NOT NULL,
  source_ref  text NOT NULL,          -- local root path, Drive 'changes', owner/repo, etc.
  cursor      jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_ok_at  timestamptz,
  fail_count  integer NOT NULL DEFAULT 0,
  last_error  text,
  CONSTRAINT ingest_sources_kind_ck CHECK (source_kind IN
    ('inbox','calendar','file','drive','github','self')),
  CONSTRAINT ingest_sources_uq UNIQUE (source_kind, source_ref)
);

CREATE INDEX ingest_sources_failing_idx ON ingest_sources (fail_count DESC)
  WHERE fail_count > 0;
