-- 0007_notify.sql
-- A3 §6.2 / A3-D7: 허브 내부 팬아웃 전용, 페이로드는 id만(8,000B 한도).
-- omnis_control은 테이블이 없다 — kill switch가 커널에서 pg_notify로 직접 쏜다.

CREATE OR REPLACE FUNCTION omnis_notify_item() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM pg_notify('omnis_item', json_build_object(
    'id', NEW.id, 'thread_id', NEW.thread_id,
    'op', CASE WHEN TG_OP = 'INSERT' THEN 'insert' ELSE 'update' END)::text);
  RETURN NULL;
END
$fn$;

CREATE OR REPLACE FUNCTION omnis_notify_thread() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM pg_notify('omnis_thread', json_build_object(
    'id', NEW.id,
    'op', CASE WHEN TG_OP = 'INSERT' THEN 'insert' ELSE 'update' END)::text);
  RETURN NULL;
END
$fn$;

-- 계약 §4: state는 'pending' | 'decided' 두 값만 흘린다.
CREATE OR REPLACE FUNCTION omnis_notify_approval() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.state NOT IN ('pending', 'decided') THEN
    RETURN NULL;
  END IF;
  PERFORM pg_notify('omnis_approval', json_build_object(
    'id', NEW.id, 'state', NEW.state)::text);
  RETURN NULL;
END
$fn$;

CREATE OR REPLACE FUNCTION omnis_notify_task() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM pg_notify('omnis_task', json_build_object(
    'id', NEW.id,
    'op', CASE WHEN TG_OP = 'INSERT' THEN 'insert' ELSE 'update' END)::text);
  RETURN NULL;
END
$fn$;

CREATE OR REPLACE FUNCTION omnis_notify_session() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  rt text;
BEGIN
  SELECT runtime INTO rt FROM agent_runtimes WHERE id = NEW.runtime_id;
  PERFORM pg_notify('omnis_session', json_build_object(
    'id', NEW.id, 'runtime', rt, 'state', NEW.state)::text);
  RETURN NULL;
END
$fn$;

CREATE OR REPLACE FUNCTION omnis_notify_job() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM pg_notify('omnis_job', json_build_object(
    'id', NEW.id, 'name', NEW.name)::text);
  RETURN NULL;
END
$fn$;

CREATE TRIGGER items_notify     AFTER INSERT OR UPDATE ON items
  FOR EACH ROW EXECUTE FUNCTION omnis_notify_item();
CREATE TRIGGER threads_notify   AFTER INSERT OR UPDATE ON threads
  FOR EACH ROW EXECUTE FUNCTION omnis_notify_thread();
CREATE TRIGGER approvals_notify AFTER INSERT OR UPDATE ON pending_approvals
  FOR EACH ROW EXECUTE FUNCTION omnis_notify_approval();
CREATE TRIGGER tasks_notify     AFTER INSERT OR UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION omnis_notify_task();
CREATE TRIGGER sessions_notify  AFTER INSERT OR UPDATE ON agent_sessions
  FOR EACH ROW EXECUTE FUNCTION omnis_notify_session();
CREATE TRIGGER jobs_notify      AFTER INSERT OR UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION omnis_notify_job();
