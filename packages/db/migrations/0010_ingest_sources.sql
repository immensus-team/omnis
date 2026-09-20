-- A4 §10.5: 폴링 커서와 실패 카운터. Zero 복제 대상이 아니다(델타 §10) — 클라이언트가 쓸 일이 없다.

CREATE TABLE ingest_sources (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_kind text NOT NULL,
  source_ref  text NOT NULL,          -- 로컬 루트 경로, Drive 'changes', owner/repo 등
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
