-- 0008_publication.sql
-- A3 §7 / A3-D8: Zero replication is a whitelist. A new table is not synced unless it is
-- added explicitly.
-- Excluded: account_secrets (secret), events (cold), audit_log (audit), agent_runs (cost/audit),
--       memories/entities/relations (server queries), person_merges, jobs.

-- ponytail: a publication is a DB-level object, not a schema object, so vitest.global-setup.ts's
-- `DROP SCHEMA public CASCADE` does not drop it (same situation as the 3 roles in 0001). It is
-- the same re-run-safe pattern 0001 uses for roles — needed because every test run replays
-- all migrations from scratch.
DROP PUBLICATION IF EXISTS zero_omnis;

CREATE PUBLICATION zero_omnis FOR TABLE
  accounts, threads, calendar_events, persons, identities,
  labels, item_labels, thread_labels,
  tasks, agent_runtimes, agent_sessions,
  pending_approvals, notes, digests,
  -- Only items narrows to a column list: keep the 768d embedding and generated
  -- columns off the phone.
  items (id, thread_id, account_id, external_id, kind, status, scope, sensitivity,
         author_person_id, author_agent_id, author_is_me, in_reply_to,
         subject, body, body_html, attachments, tool, sent_at, received_at,
         source_hash, idempotency_key, outbox_claimed_at, fail_reason, meta),
  -- label_rules drops only probe_embedding (per the A3 §7 body).
  label_rules (id, label_id, prompt, rule, rule_by, rule_at, tier,
               positives, negatives, hits_30d, corrections_30d,
               pinned_by_user, active, created_at, updated_at);
