CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE probe_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participants uuid[] NOT NULL DEFAULT '{}'
);

CREATE TABLE probe_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES probe_threads(id),
  body text NOT NULL,
  embedding vector(768),
  search_tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', body)) STORED
);

-- items 쪽만 컬럼 리스트로 publication에 넣는다(A3 §7 DDL과 같은 패턴):
CREATE PUBLICATION zero_spike_13 FOR TABLE
  probe_threads,
  probe_items (id, thread_id, body);
