-- 0006_kernel.sql
-- A3 §6: events, audit_log, jobs(+seed) + §6.1 append-only 트리거 + §6.1.1 롤오프 함수·GRANT
-- events/audit_log에는 FK를 걸지 않는다(A3 §1): 원본이 지워져도 감사 기록은 남아야 한다.

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
  approval_id  uuid,                     -- FK 없음(의도적). egress는 여기에 반드시 남는다
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

-- 스케줄 오너 분담(A3 §6):
--   L3~L9 루프 잡의 cron 정본은 A4 §6.1 표다. A3는 seed만 하고, 시각이 바뀌면 A4를 먼저 고친다.
--   어댑터·커널 인프라 잡의 오너는 A3다.
INSERT INTO jobs (name, schedule, next_run_at) VALUES
  -- A4 소유 (정본: A4 §6.1)
  ('morning_digest',        '30 6 * * *',   now()),   -- L5 아침 브리핑 06:30 KST
  ('nightly_digest',        '0 23 * * *',   now()),   -- L5 밤 다이제스트 23:00 KST
  ('memory_consolidate',    '30 23 * * *',  now()),   -- 야간 메모리 통합
  ('auto_archive_sweep',    '0 22 * * *',   now()),   -- L8 자동 보관
  ('task_remind',           '0 9,14,19 * * *', now()),-- L3 리마인드
  ('network_inactive_sweep','0 10 * * 1-5', now()),   -- L6 비활성 감지(평일 10:00)
  ('self_model_weekly',     '0 21 * * 0',   now()),   -- self-model 제안(일 21:00)
  ('eval_weekly',           '0 22 * * 0',   now()),   -- 평가 하네스(일 22:00)
  ('drive_poll',            '*/10 * * * *', now()),   -- L9 ingestion
  ('github_poll',           '*/15 * * * *', now()),   -- L9 ingestion
  -- A3 소유 (인프라)
  ('followup_sweep',        '0 * * * *',    now()),   -- outbox claim 해제
  ('token_refresh',         '*/30 * * * *', now()),
  ('gmail_rewatch',         '0 3 * * *',    now()),   -- watch 만료 7일 → 매일 갱신
  ('graph_sub_renew',       '0 4 * * 1',    now()),   -- Outlook 구독 10,080분
  ('events_rolloff',        '15 4 * * *',   now()),
  ('slot_health',           '*/5 * * * *',  now());   -- WAL 슬롯 감시

-- A3 §6.1 append-only 강제 (A3-D5)
CREATE OR REPLACE FUNCTION omnis_append_only() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'append-only: UPDATE on % is forbidden', TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    -- audit_log는 어떤 경우에도 삭제 불가. events는 롤오프 윈도우 밖만 허용.
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

-- A3 §6.1은 `ALTER DATABASE omnis SET ...`로 DB 이름을 리터럴로 적었다. 테스트 DB는 omnis_test이므로
-- 동작이 같고 이름에 독립적인 형태로만 바꾼다. ALTER DATABASE ... SET은 새 커넥션부터 적용된다.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET omnis.events_retention = %L', current_database(), '90 days');
END
$$;

-- 2차 방어: 허브 역할에서 권한 자체를 뺀다.
REVOKE UPDATE, DELETE, TRUNCATE ON events, audit_log FROM omnis_hub;
GRANT  DELETE ON events TO omnis_owner;   -- 롤오프는 아래 SECURITY DEFINER 함수로만

-- 계획 편차: 0001_extensions.sql(이미 적용된 파일, 수정 불가)은 omnis_owner에 스키마 USAGE를
-- 주지 않았다. omnis_owner는 NOLOGIN이라 직접 접속하지 않지만, 아래 SECURITY DEFINER 함수가
-- omnis_owner 권한으로 실행되므로 실행 시점에 events/audit_log를 실제로 봐야 한다. USAGE가
-- 없으면 "relation events does not exist"로 죽는다(권한 부족이 스키마 가시성 오류로 나타남).
-- omnis_owner에 SELECT/INSERT/DELETE를 여기서 보충한다 — 동작은 그대로, 함수가 실제로 돌게만 한다.
GRANT USAGE ON SCHEMA public TO omnis_owner;
GRANT SELECT ON events TO omnis_owner;
GRANT INSERT ON audit_log TO omnis_owner;

-- A3 §6.1.1: 허브(omnis_hub)는 임의 DELETE 대신 이 함수 EXECUTE만 갖는다.
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
  -- 덤프(A3 §11)는 호출 전에 허브가 끝낸다. 이 함수는 삭제만 한다.
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
