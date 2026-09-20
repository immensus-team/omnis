-- 0004_tasks_approvals.sql
-- A3 §4: agent_sessions, agent_runs, tasks, pending_approvals, notes, digests

CREATE TABLE agent_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  runtime_id   uuid NOT NULL REFERENCES agent_runtimes(id) ON DELETE CASCADE,
  thread_id    uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,  -- session = thread
  session_key  text NOT NULL,        -- stable scope (master D5)
  session_id   text,                 -- rotating transcript id
  cwd          text,
  state        text NOT NULL DEFAULT 'starting',
  summary      text,                 -- durable summary read by read_session
  last_turn_at timestamptz,
  started_at   timestamptz NOT NULL DEFAULT now(),
  ended_at     timestamptz,
  CONSTRAINT agent_sessions_state_ck CHECK (state IN
    ('starting','idle','running','waiting_approval','ended','failed')),
  CONSTRAINT agent_sessions_uq UNIQUE (runtime_id, session_key)
);
CREATE INDEX agent_sessions_active_idx ON agent_sessions (last_turn_at DESC)
  WHERE ended_at IS NULL;

-- The single record of every L3 loop run (A4-D16). A run absent here never happened.
CREATE TABLE agent_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loop             text NOT NULL,
  agent_session_id uuid REFERENCES agent_sessions(id) ON DELETE SET NULL,
  item_id          uuid REFERENCES items(id) ON DELETE SET NULL,
  trigger_kind     text NOT NULL DEFAULT 'event',   -- 'event' | 'cron' | 'manual'
  trigger_ref      text,                   -- cron job name etc.; triggers other than an item
  model_tier       text NOT NULL,          -- T0|T1|T2|T3 (master §14)
  provider         text NOT NULL,          -- 'local' | 'deepseek' | 'anthropic' | 'openrouter'
  model            text NOT NULL,
  tokens_in        integer,
  tokens_out       integer,
  tokens_cached    integer,
  cost_usd         numeric(10,6),
  latency_ms       integer,
  outcome          text NOT NULL DEFAULT 'running',
  error            text,
  confidence       real,
  escalated_from   uuid REFERENCES agent_runs(id) ON DELETE SET NULL,  -- T1 → T2 escalation
  injection_flags  text[] NOT NULL DEFAULT '{}',
  context_hash     text,                   -- sha256(cachedPrefix) — cache hit-rate tracking
  result_ref       uuid,                   -- artifact id. No FK: the target table varies
  raw_output       text,                   -- stores schema-violating output (A4 §1.6)
  created_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  CONSTRAINT agent_runs_tier_ck CHECK (model_tier IN ('T0','T1','T2','T3')),
  CONSTRAINT agent_runs_outcome_ck CHECK (outcome IN ('running','ok','failed','skipped','blocked'))
);
CREATE INDEX agent_runs_created_idx ON agent_runs (created_at DESC);
CREATE INDEX agent_runs_loop_idx    ON agent_runs (loop, created_at DESC);
CREATE INDEX agent_runs_item_idx    ON agent_runs (item_id) WHERE item_id IS NOT NULL;

CREATE TABLE tasks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title               text NOT NULL,
  detail              text,
  kind                text NOT NULL DEFAULT 'todo',  -- A4 §7.3 task routing
  state               text NOT NULL DEFAULT 'open',
  owner_kind          text NOT NULL DEFAULT 'me',   -- 'me' | 'agent'
  owner_runtime_id    uuid REFERENCES agent_runtimes(id) ON DELETE SET NULL,
  source_item_id      uuid REFERENCES items(id) ON DELETE SET NULL,
  person_id           uuid REFERENCES persons(id) ON DELETE SET NULL,
  delegated_session_id uuid REFERENCES agent_sessions(id) ON DELETE SET NULL,
  due_at              timestamptz,
  remind_at           timestamptz,
  done_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          text NOT NULL DEFAULT 'agent',
  CONSTRAINT tasks_kind_ck CHECK (kind IN ('todo','followup','delegation')),
  CONSTRAINT tasks_state_ck CHECK (state IN ('open','in_progress','blocked','done','dropped')),
  CONSTRAINT tasks_owner_ck CHECK (owner_kind IN ('me','agent'))
);
CREATE INDEX tasks_open_idx ON tasks (due_at NULLS LAST) WHERE state IN ('open','in_progress');
CREATE INDEX tasks_remind_idx ON tasks (remind_at) WHERE remind_at IS NOT NULL AND state <> 'done';

-- Ported as-is from HumanInterrupt / HumanResponse. A3-D11.
CREATE TABLE pending_approvals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action        text NOT NULL,
  args          jsonb NOT NULL,          -- ActionRequest.args (verbatim; exposed as-is in the UI)
  description   text NOT NULL,
  config        jsonb NOT NULL DEFAULT
                  '{"allow_accept":true,"allow_edit":true,"allow_respond":false,"allow_ignore":true}'::jsonb,
  state         text NOT NULL DEFAULT 'pending',
  decision      text,                    -- accept | edit | respond | ignore
  decided_args  jsonb,                   -- human-edited result for edit/respond
  requested_by  uuid REFERENCES agent_runtimes(id) ON DELETE SET NULL,
  thread_id     uuid REFERENCES threads(id) ON DELETE SET NULL,
  item_id       uuid REFERENCES items(id) ON DELETE SET NULL,
  task_id       uuid REFERENCES tasks(id) ON DELETE SET NULL,
  risk          text NOT NULL DEFAULT 'normal',
  expires_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  decided_at    timestamptz,
  executed_at   timestamptz,
  fail_reason   text,
  CONSTRAINT approvals_action_ck CHECK (action IN
    ('send','delete','calendar_write','delegate','self_model_edit','memory_write')),
  CONSTRAINT approvals_state_ck CHECK (state IN
    ('pending','decided','executing','executed','failed','expired')),
  CONSTRAINT approvals_decision_ck CHECK (decision IS NULL OR decision IN
    ('accept','edit','respond','ignore')),
  CONSTRAINT approvals_risk_ck CHECK (risk IN ('normal','high')),
  CONSTRAINT approvals_decided_ck CHECK ((state = 'pending') = (decision IS NULL))
);
CREATE INDEX approvals_pending_idx ON pending_approvals (created_at DESC) WHERE state = 'pending';
CREATE INDEX approvals_thread_idx ON pending_approvals (thread_id, created_at DESC);

CREATE TABLE notes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  body         text NOT NULL,
  routed_to_thread_id uuid REFERENCES threads(id) ON DELETE SET NULL,
  routed_to_person_id uuid REFERENCES persons(id) ON DELETE SET NULL,
  rationale    text,
  route_state  text NOT NULL DEFAULT 'proposed',
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notes_route_state_ck CHECK (route_state IN ('proposed','accepted','rejected','none'))
);

CREATE TABLE digests (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       text NOT NULL,
  for_date   date NOT NULL,
  body       text NOT NULL,
  item_ids   uuid[] NOT NULL DEFAULT '{}',
  metrics    jsonb NOT NULL DEFAULT '{}'::jsonb,   -- coverage and cost metrics (master §2)
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT digests_kind_ck CHECK (kind IN ('morning','nightly')),
  CONSTRAINT digests_uq UNIQUE (kind, for_date)
);
