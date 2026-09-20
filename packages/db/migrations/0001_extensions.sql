-- 0001_extensions.sql
-- A3 §1 conventions: 3 extensions + 3 roles. Roles are cluster-wide, so re-running must be safe.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omnis_owner') THEN
    CREATE ROLE omnis_owner NOLOGIN;        -- DDL and migrations
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omnis_hub') THEN
    CREATE ROLE omnis_hub NOLOGIN;          -- hub process, DML only
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omnis_sync') THEN
    CREATE ROLE omnis_sync NOLOGIN REPLICATION;   -- zero-cache: REPLICATION + SELECT
  ELSE
    ALTER ROLE omnis_sync REPLICATION;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO omnis_hub, omnis_sync;
