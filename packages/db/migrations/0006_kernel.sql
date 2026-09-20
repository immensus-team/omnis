-- 0006_kernel.sql
-- A3 §6: events, audit_log, jobs(+seed) + §6.1 append-only triggers
--         + §6.1.1 rolloff function and GRANT
-- No FKs on events/audit_log (A3 §1): the audit record must outlive the source row.

CREATE TABLE events (
  seq     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind    text NOT NULL,                 -- 'item.created', 'approval.decided', 'job.run', 'adapter.error' ...
  actor   text NOT NULL DEFAULT 'system',
  target_table text,
  target_id    uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_at_idx ON events (at DESC);
CREATE INDEX events_kind_idx ON events (kind, at DESC);
CREATE INDEX events_target_idx ON events (target_id, at DESC) WHERE target_id IS NOT NULL;

CREATE TABLE audit_log (
  seq          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor        text NOT NULL,            -- 'me' | 'agent:<runtime>' | 'system'
  action       text NOT NULL,
  target_table text NOT NULL,
  target_id    uuid,
  before       jsonb,
  after        jsonb,
  approval_id  uuid,                     -- no FK (intentional). Egress always records here
  at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_at_idx ON audit_log (at DESC);
CREATE INDEX audit_log_action_idx ON audit_log (action, at DESC);

CREATE TABLE jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL UNIQUE,
  schedule     text NOT NULL,            -- 5-field cron, TZ=Asia/Seoul
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled      boolean NOT NULL DEFAULT true,
  next_run_at  timestamptz NOT NULL,
  claimed_at   timestamptz,              -- at-most-once claim
  last_run_at  timestamptz,
  last_status  text,
  last_error   text,
  CONSTRAINT jobs_status_ck CHECK (last_status IS NULL OR last_status IN ('ok','failed','skipped'))
);
CREATE INDEX jobs_due_idx ON jobs (next_run_at) WHERE enabled AND claimed_at IS NULL;

-- Schedule ownership split (A3 §6):
--   The A4 §6.1 table is the source of truth for L3-L9 loop job crons. A3 only seeds them;
--   when a time changes, A4 is fixed first.
--   A3 owns the adapter and kernel infrastructure jobs.
INSERT INTO jobs (name, schedule, next_run_at) VALUES
  -- owned by A4 (source of truth: A4 §6.1)
  ('morning_digest',        '30 6 * * *',   now()),   -- L5 morning briefing 06:30 KST
  ('nightly_digest',        '0 23 * * *',   now()),   -- L5 nightly digest 23:00 KST
  ('memory_consolidate',    '30 23 * * *',  now()),   -- nightly memory consolidation
  ('auto_archive_sweep',    '0 22 * * *',   now()),   -- L8 auto-archive
  ('task_remind',           '0 9,14,19 * * *', now()),-- L3 reminders
  ('network_inactive_sweep','0 10 * * 1-5', now()),   -- L6 inactivity detection (weekdays 10:00)
  ('self_model_weekly',     '0 21 * * 0',   now()),   -- self-model proposals (Sun 21:00)
  ('eval_weekly',           '0 22 * * 0',   now()),   -- eval harness (Sun 22:00)
  ('drive_poll',            '*/10 * * * *', now()),   -- L9 ingestion
  ('github_poll',           '*/15 * * * *', now()),   -- L9 ingestion
  -- owned by A3 (infrastructure)
  ('followup_sweep',        '0 * * * *',    now()),   -- releases stale outbox claims
  ('token_refresh',         '*/30 * * * *', now()),
  ('gmail_rewatch',         '0 3 * * *',    now()),   -- watch expires after 7 days → refresh daily
  ('graph_sub_renew',       '0 4 * * 1',    now()),   -- Outlook subscription 10,080 minutes
  ('events_rolloff',        '15 4 * * *',   now()),
  ('slot_health',           '*/5 * * * *',  now());   -- WAL slot monitoring

-- A3 §6.1 append-only enforcement (A3-D5)
CREATE OR REPLACE FUNCTION omnis_append_only() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'append-only: UPDATE on % is forbidden', TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    -- audit_log is never deletable. events may only be deleted outside the rolloff window.
    IF TG_TABLE_NAME = 'audit_log'
       OR OLD.at > now() - (current_setting('omnis.events_retention', true))::interval THEN
      RAISE EXCEPTION 'append-only: DELETE on % is forbidden (retention window)', TG_TABLE_NAME
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN OLD;
END
$fn$;

CREATE OR REPLACE FUNCTION omnis_no_truncate() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'append-only: TRUNCATE on % is forbidden', TG_TABLE_NAME
    USING ERRCODE = '42501';
END
$fn$;

CREATE TRIGGER events_append_only   BEFORE UPDATE OR DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION omnis_append_only();
CREATE TRIGGER audit_append_only    BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION omnis_append_only();
CREATE TRIGGER events_no_truncate   BEFORE TRUNCATE ON events
  FOR EACH STATEMENT EXECUTE FUNCTION omnis_no_truncate();
CREATE TRIGGER audit_no_truncate    BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION omnis_no_truncate();

-- A3 §6.1 hardcodes the DB name in `ALTER DATABASE omnis SET ...`. The test DB is omnis_test, so
-- we only change it into an equivalent, name-independent form. ALTER DATABASE ... SET applies
-- from the next connection onward.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET omnis.events_retention = %L', current_database(), '90 days');
END
$$;

-- Second layer of defense: remove the privileges from the hub role entirely.
REVOKE UPDATE, DELETE, TRUNCATE ON events, audit_log FROM omnis_hub;
GRANT  DELETE ON events TO omnis_owner;   -- rolloff only via the SECURITY DEFINER function below

-- Plan deviation: 0001_extensions.sql (already applied, cannot be edited) grants no schema
-- USAGE to omnis_owner. It is NOLOGIN, so it never connects directly, but the SECURITY DEFINER
-- function below runs with omnis_owner privileges, so at execution time it must actually see
-- events/audit_log. Without USAGE it dies with "relation events does not exist" — a privilege
-- gap surfacing as a schema visibility error. We add the missing grants for omnis_owner here —
-- same behavior, it just lets the function actually run.
GRANT USAGE ON SCHEMA public TO omnis_owner;
GRANT SELECT ON events TO omnis_owner;
GRANT INSERT ON audit_log TO omnis_owner;

-- A3 §6.1.1: the hub (omnis_hub) gets EXECUTE on this function instead of arbitrary DELETE.
CREATE OR REPLACE FUNCTION omnis_events_rolloff()
RETURNS TABLE (cutoff timestamptz, deleted bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  retention text := current_setting('omnis.events_retention', true);
  cut       timestamptz;
  n         bigint;
BEGIN
  IF retention IS NULL OR retention = '' THEN
    RAISE EXCEPTION 'omnis.events_retention is not set — refusing to roll off';
  END IF;
  cut := now() - retention::interval;
  -- The dump (A3 §11) is finished by the hub before calling this. This function only deletes.
  DELETE FROM events WHERE at <= cut;
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO audit_log (actor, action, target_table, after)
    VALUES ('system', 'events.rolloff', 'events',
            json_build_object('cutoff', cut, 'deleted', n)::jsonb);
  RETURN QUERY SELECT cut, n;
END
$fn$;

ALTER FUNCTION omnis_events_rolloff() OWNER TO omnis_owner;
REVOKE ALL   ON FUNCTION omnis_events_rolloff() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION omnis_events_rolloff() TO omnis_hub;
