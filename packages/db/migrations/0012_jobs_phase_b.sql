-- packages/db/migrations/0012_jobs_phase_b.sql
-- 델타 §8: Phase B가 더하는 잡 4건. 나머지 16건은 0006_kernel.sql이 이미 seed했다.
-- 소유: W0 스키마 번들(델타 §6). agents 계획 Task 7 스텝 1이 정본 정의이고 그대로 옮겼다.
-- channels(B37)·ops(B44)·surfaces는 이 파일을 다시 만들지 않는다.

INSERT INTO jobs (name, schedule, next_run_at) VALUES
  ('cost_daily',          '5 0 * * *',        now()),   -- A4 §12.4 00:05 KST 집계
  ('push_batch',          '0 9,12,15,18 * * *', now()), -- A4 §3.6 묶음 알림
  ('outlook_delta_poll',  '*/5 * * * *',      now()),   -- A1 §2.4 (US-B37)
  ('cost_report_monthly', '10 0 1 * *',       now())    -- A4 §12.4 월간 리포트 (US-B44)
ON CONFLICT (name) DO NOTHING;

-- A4 §12.4: "매일 00:05 KST에 agent_runs를 집계해 cost_daily 뷰를 갱신한다."
-- 뷰이므로 갱신 자체는 공짜고, 잡은 상태 전이 감지와 기록만 한다.
CREATE VIEW cost_daily AS
SELECT (created_at AT TIME ZONE 'Asia/Seoul')::date AS day,
       loop,
       model_tier,
       provider,
       count(*)                              AS runs,
       count(*) FILTER (WHERE outcome = 'failed') AS failed,
       COALESCE(sum(tokens_in), 0)           AS tokens_in,
       COALESCE(sum(tokens_out), 0)          AS tokens_out,
       COALESCE(sum(tokens_cached), 0)       AS tokens_cached,
       COALESCE(sum(cost_usd), 0)::numeric(12,6) AS cost_usd
  FROM agent_runs
 GROUP BY 1, 2, 3, 4;

GRANT SELECT ON cost_daily TO omnis_hub;
