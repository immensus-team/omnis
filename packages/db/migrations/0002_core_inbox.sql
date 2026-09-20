-- 0002_core_inbox.sql
-- A3 §8 표: accounts, account_secrets, persons, identities, person_merges,
--           agent_runtimes(+omnis seed), threads, items(+부분 HNSW), calendar_events
-- 순서는 FK 순서다(A3 §2 각주). A3 §2의 읽기용 순서와 다르다.

CREATE TABLE accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel       text NOT NULL,
  external_id   text NOT NULL,                 -- 채널 내 계정 식별자 (Slack team+user, 메일 주소 등)
  display       text NOT NULL,
  capabilities  jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {read,write,realtime,history,media,markRead,typing}
  state         text NOT NULL DEFAULT 'active',
  last_health_at timestamptz,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accounts_channel_ck CHECK (channel IN
    ('slack','gmail','outlook','gcal','telegram','whatsapp','kakaotalk','linkedin','agent','system')),
  CONSTRAINT accounts_state_ck CHECK (state IN ('active','paused','broken')),
  CONSTRAINT accounts_uq UNIQUE (channel, external_id)
);

-- A3-D4: 비밀은 별도 테이블. Zero publication에 절대 넣지 않는다.
CREATE TABLE account_secrets (
  account_id  uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  auth_ref    text NOT NULL,                   -- Keychain item 이름 (값이 아니다).
                                               -- 명명 규칙은 A1 소유: omnis.<channel>.<kind>.<external_id>
  scopes      text[] NOT NULL DEFAULT '{}',
  expires_at  timestamptz,
  rotated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE threads (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  external_id   text NOT NULL,
  kind          text NOT NULL,
  title         text,
  scope         text NOT NULL DEFAULT 'unknown',
  participants  uuid[] NOT NULL DEFAULT '{}',  -- persons.id
  meta          jsonb NOT NULL DEFAULT '{}'::jsonb,  -- 예약 키: meta.pending_next_step (A4 §7.3)
  last_item_at  timestamptz,
  unread_count  integer NOT NULL DEFAULT 0,
  needs_action  boolean NOT NULL DEFAULT false,
  archived_at   timestamptz,
  muted_until   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT threads_kind_ck CHECK (kind IN ('dm','group','email','agent_session','calendar','system')),
  CONSTRAINT threads_scope_ck CHECK (scope IN ('work','personal','unknown')),
  CONSTRAINT threads_uq UNIQUE (account_id, external_id)
);

CREATE INDEX threads_inbox_idx ON threads (last_item_at DESC)
  WHERE archived_at IS NULL;
CREATE INDEX threads_scope_idx ON threads (scope, last_item_at DESC)
  WHERE archived_at IS NULL;
CREATE INDEX threads_participants_idx ON threads USING gin (participants);

CREATE TABLE persons (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name       text NOT NULL,
  org                text,
  role               text,
  relationship_state text NOT NULL DEFAULT 'unknown',
  vip                boolean NOT NULL DEFAULT false,
  notes              text,
  first_contact_at   timestamptz,          -- A4 §7.2 초면 판정
  last_contact_at    timestamptz,
  next_followup_at   timestamptz,
  item_count         integer NOT NULL DEFAULT 0,
  primary_thread_id  uuid REFERENCES threads(id) ON DELETE SET NULL,  -- A4 §7.3 cadence 조인 대상
  cadence_days       integer,              -- NULL이면 relationship_state 기본값 (A4 §7.3)
  priority_score     real NOT NULL DEFAULT 0,
  merged_into        uuid REFERENCES persons(id) ON DELETE SET NULL,  -- tombstone
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT persons_rel_ck CHECK (relationship_state IN
    ('unknown','new','warming','active','dormant','closed'))
);
CREATE INDEX persons_followup_idx ON persons (next_followup_at)
  WHERE merged_into IS NULL AND next_followup_at IS NOT NULL;
CREATE INDEX persons_name_trgm_idx ON persons USING gin (display_name gin_trgm_ops);
CREATE INDEX persons_cadence_idx ON persons (priority_score DESC)
  WHERE merged_into IS NULL AND relationship_state IN ('warming','active');

CREATE TABLE identities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id   uuid NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  channel     text NOT NULL,
  handle      text NOT NULL,              -- 원본 표기
  handle_norm text NOT NULL,              -- 정규화 키 (A3 §10)
  display     text,
  verified    boolean NOT NULL DEFAULT false,
  source      text NOT NULL DEFAULT 'adapter',
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT identities_source_ck CHECK (source IN ('adapter','manual','agent')),
  CONSTRAINT identities_uq UNIQUE (channel, handle_norm)
);
CREATE INDEX identities_person_idx ON identities (person_id);

CREATE TABLE person_merges (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind           text NOT NULL,                 -- 'merge' | 'split'
  from_person_id uuid NOT NULL,
  to_person_id   uuid NOT NULL,
  identity_ids   uuid[] NOT NULL DEFAULT '{}',  -- split일 때 옮긴 identity
  reason         text,
  at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT person_merges_kind_ck CHECK (kind IN ('merge','split'))
);

CREATE TABLE agent_runtimes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  runtime      text NOT NULL,
  host         text NOT NULL,                  -- 'mini' | 'macbook'
  display      text NOT NULL,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,   -- 브리지 자기기술 (마스터 D5)
  version      text,
  state        text NOT NULL DEFAULT 'offline',
  last_seen_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_runtimes_runtime_ck CHECK (runtime IN
    ('claude_code','codex','claude_ds','hermes','omnis')),
  CONSTRAINT agent_runtimes_host_ck CHECK (host IN ('mini','macbook')),
  CONSTRAINT agent_runtimes_state_ck CHECK (state IN ('offline','online','degraded')),
  CONSTRAINT agent_runtimes_uq UNIQUE (runtime, host)
);

-- `omnis`는 유효한 runtime 값이지만 브리지 어댑터가 없는 특수 row다(마스터 §6, 99-review §4-8).
CREATE UNIQUE INDEX agent_runtimes_omnis_uq ON agent_runtimes (runtime)
  WHERE runtime = 'omnis';

INSERT INTO agent_runtimes (runtime, host, display, state)
  VALUES ('omnis', 'mini', 'omnis agents', 'online');

CREATE TABLE items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id        uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  external_id      text,                        -- draft는 NULL (아직 채널에 없음)
  kind             text NOT NULL,
  status           text NOT NULL DEFAULT 'received',
  scope            text NOT NULL DEFAULT 'unknown',
  sensitivity      text NOT NULL DEFAULT 'normal',   -- A4 L1이 유일한 생산자 (A4 §2.4, A4-D12)
  author_person_id uuid REFERENCES persons(id) ON DELETE SET NULL,
  author_agent_id  uuid REFERENCES agent_runtimes(id) ON DELETE SET NULL,
  author_is_me     boolean NOT NULL DEFAULT false,
  in_reply_to      uuid REFERENCES items(id) ON DELETE SET NULL,
  subject          text,
  body             text NOT NULL DEFAULT '',
  body_html        text,
  attachments      jsonb NOT NULL DEFAULT '[]'::jsonb,
  tool             jsonb,                       -- kind='tool_call'일 때 {name,args,state,label,icon}
  sent_at          timestamptz NOT NULL,
  received_at      timestamptz NOT NULL DEFAULT now(),
  source_hash      text,                        -- 어댑터 멱등성 키
  idempotency_key  text,                        -- 발송 멱등성 키 (A3-D10)
  outbox_claimed_at timestamptz,                -- 발송 워커의 at-most-once claim
  fail_reason      text,
  meta             jsonb NOT NULL DEFAULT '{}'::jsonb,
  embedding        vector(768),                 -- nomic-embed-text-v1.5. A4 §2.2 kNN의 입력
  search_tsv       tsvector GENERATED ALWAYS AS
                     (to_tsvector('simple', coalesce(subject,'') || ' ' || coalesce(body,''))) STORED,
  CONSTRAINT items_kind_ck CHECK (kind IN ('message','email','event','agent_turn','tool_call','system')),
  CONSTRAINT items_status_ck CHECK (status IN
    ('received','read','draft','approved','sent','failed','archived')),
  CONSTRAINT items_scope_ck CHECK (scope IN ('work','personal','unknown')),
  CONSTRAINT items_sensitivity_ck CHECK (sensitivity IN
    ('normal','personal','finance','legal','health')),
  CONSTRAINT items_author_ck CHECK (num_nonnulls(author_person_id, author_agent_id) <= 1)
);

CREATE UNIQUE INDEX items_external_uq ON items (account_id, external_id)
  WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX items_source_hash_uq ON items (account_id, source_hash)
  WHERE source_hash IS NOT NULL;
CREATE UNIQUE INDEX items_idem_uq ON items (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX items_thread_idx ON items (thread_id, sent_at DESC);
CREATE INDEX items_pending_idx ON items (status, sent_at DESC)
  WHERE status IN ('draft','approved','failed');
CREATE INDEX items_search_idx ON items USING gin (search_tsv);
CREATE INDEX items_body_trgm_idx ON items USING gin (body gin_trgm_ops);

-- 임베딩이 있는 item만 인덱싱한다.
CREATE INDEX items_embedding_idx ON items
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)   -- 파라미터 근거: UNVERIFIED — spike (A3 §14 S-A3-7)
  WHERE embedding IS NOT NULL;

-- A3 §2.1: items(kind='event')=인박스 투영, calendar_events=상세.
CREATE TABLE calendar_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id      uuid NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE,  -- 조인 규칙
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  external_id  text NOT NULL,              -- Google/Graph의 event id
  start_at     timestamptz NOT NULL,
  end_at       timestamptz NOT NULL,
  all_day      boolean NOT NULL DEFAULT false,
  status       text NOT NULL DEFAULT 'confirmed',
  attendees    jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{email, display, response, person_id}]
  attendees_count integer GENERATED ALWAYS AS (jsonb_array_length(attendees)) STORED,
  location     text,
  recurrence   text,                       -- RRULE 원문. 전개는 하지 않는다
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calendar_events_status_ck CHECK (status IN ('confirmed','tentative','cancelled')),
  CONSTRAINT calendar_events_uq UNIQUE (account_id, external_id),
  CONSTRAINT calendar_events_span_ck CHECK (end_at >= start_at)
);
CREATE INDEX calendar_events_start_idx ON calendar_events (start_at);
CREATE INDEX calendar_events_end_idx   ON calendar_events (end_at)
  WHERE status <> 'cancelled';
