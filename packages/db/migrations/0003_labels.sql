-- 0003_labels.sql
-- A3 §3: labels, label_rules, item_labels, thread_labels

CREATE TABLE labels (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  kind       text NOT NULL,
  color      text,
  rule       text,                          -- 자연어 규칙 (Superhuman Auto Labels 방식)
  rule_model text,
  person_id  uuid REFERENCES persons(id) ON DELETE CASCADE,  -- kind='person'
  archived   boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT labels_kind_ck CHECK (kind IN ('scope','topic','priority','person')),
  CONSTRAINT labels_uq UNIQUE (kind, name)
);

-- 자연어 라벨 규칙 (A4 §2.3). A4 표기 대응: compiled→rule, compiled_by→rule_by,
-- compiled_at→rule_at, corrections→corrections_30d. positives/negatives는 uuid[](items.id).
CREATE TABLE label_rules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label_id       uuid NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  prompt         text NOT NULL,                    -- 사용자가 적은 원문 (SSOT)
  rule           jsonb NOT NULL DEFAULT '{}'::jsonb, -- 컴파일 결과 CompiledRule (A4 §2.3)
  rule_by        text,                             -- 'claude-sonnet-5' | 'user'
  rule_at        timestamptz,
  probe_embedding vector(768),                     -- CompiledRule.semantic 임베딩 (A4 §2.3 kNN 폴백)
  tier           text NOT NULL DEFAULT 'T0',
  positives      uuid[] NOT NULL DEFAULT '{}',     -- items.id
  negatives      uuid[] NOT NULL DEFAULT '{}',
  hits_30d       integer NOT NULL DEFAULT 0,
  corrections_30d integer NOT NULL DEFAULT 0,
  pinned_by_user boolean NOT NULL DEFAULT false,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT label_rules_tier_ck CHECK (tier IN ('T0','T1'))
);
CREATE INDEX label_rules_active_idx ON label_rules (label_id) WHERE active;

CREATE TABLE item_labels (
  item_id    uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  label_id   uuid NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  confidence real,
  by         text NOT NULL DEFAULT 'agent',   -- 'agent' | 'me' | 'rule'
  at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT item_labels_by_ck CHECK (by IN ('agent','me','rule')),
  PRIMARY KEY (item_id, label_id)
);
CREATE INDEX item_labels_label_idx ON item_labels (label_id);

CREATE TABLE thread_labels (
  thread_id  uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  label_id   uuid NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  confidence real,
  by         text NOT NULL DEFAULT 'agent',
  at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT thread_labels_by_ck CHECK (by IN ('agent','me','rule')),
  PRIMARY KEY (thread_id, label_id)
);
CREATE INDEX thread_labels_label_idx ON thread_labels (label_id);
