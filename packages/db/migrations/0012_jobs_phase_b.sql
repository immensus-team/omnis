-- packages/db/migrations/0012_jobs_phase_b.sql
-- Delta §8: the 4 jobs Phase B adds. 0006_kernel.sql already seeded the other 16.
-- Owner: W0 schema bundle (Delta §6). The agents plan's Task 7 step 1 is the source of truth
-- and this is copied from it as-is.
-- channels (B37), ops (B44) and surfaces do not recreate this file.

INSERT INTO jobs (name, schedule, next_run_at) VALUES
  ('cost_daily',          '5 0 * * *',        now()),   -- A4 §12.4 00:05 KST aggregation
  ('push_batch',          '0 9,12,15,18 * * *', now()), -- A4 §3.6 batched notification
  ('outlook_delta_poll',  '*/5 * * * *',      now()),   -- A1 §2.4 (US-B37)
  ('cost_report_monthly', '10 0 1 * *',       now())    -- A4 §12.4 monthly report (US-B44)
ON CONFLICT (name) DO NOTHING;

-- A4 §12.4: "Every day at 00:05 KST, aggregate agent_runs and refresh the cost_daily view."
-- Since it is a view the refresh itself is free; the job only detects and records state
-- transitions.
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
