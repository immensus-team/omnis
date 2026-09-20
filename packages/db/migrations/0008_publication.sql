-- 0008_publication.sql
-- A3 §7 / A3-D8: Zero 복제는 화이트리스트다. 새 테이블은 명시적으로 추가하지 않으면 동기화되지 않는다.
-- 제외: account_secrets(비밀), events(cold), audit_log(감사), agent_runs(비용·감사),
--       memories/entities/relations(서버 쿼리), person_merges, jobs.

-- ponytail: publication은 스키마 객체가 아니라 DB-레벨 객체라 vitest.global-setup.ts의
-- `DROP SCHEMA public CASCADE`로 지워지지 않는다(0001의 role 3개와 같은 사정). 0001이 role에
-- 쓴 것과 같은 재실행-안전 패턴 — 매 테스트런마다 전체 마이그레이션을 처음부터 다시 태우므로 필요하다.
DROP PUBLICATION IF EXISTS zero_omnis;

CREATE PUBLICATION zero_omnis FOR TABLE
  accounts, threads, calendar_events, persons, identities,
  labels, item_labels, thread_labels,
  tasks, agent_runtimes, agent_sessions,
  pending_approvals, notes, digests,
  -- items만 컬럼 리스트로 좁힌다: 768d 임베딩과 생성 컬럼을 폰까지 끌고 가지 않는다.
  items (id, thread_id, account_id, external_id, kind, status, scope, sensitivity,
         author_person_id, author_agent_id, author_is_me, in_reply_to,
         subject, body, body_html, attachments, tool, sent_at, received_at,
         source_hash, idempotency_key, outbox_claimed_at, fail_reason, meta),
  -- label_rules는 probe_embedding만 뺀다(A3 §7 본문 지시).
  label_rules (id, label_id, prompt, rule, rule_by, rule_at, tier,
               positives, negatives, hits_30d, corrections_30d,
               pinned_by_user, active, created_at, updated_at);
