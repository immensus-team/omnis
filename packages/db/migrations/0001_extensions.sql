-- 0001_extensions.sql
-- A3 §1 규약: 확장 3개 + 역할 3개. 역할은 클러스터 전역이므로 재실행 안전해야 한다.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omnis_owner') THEN
    CREATE ROLE omnis_owner NOLOGIN;        -- DDL·마이그레이션
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omnis_hub') THEN
    CREATE ROLE omnis_hub NOLOGIN;          -- 허브 프로세스, DML만
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omnis_sync') THEN
    CREATE ROLE omnis_sync NOLOGIN REPLICATION;   -- zero-cache: REPLICATION + SELECT
  ELSE
    ALTER ROLE omnis_sync REPLICATION;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO omnis_hub, omnis_sync;
