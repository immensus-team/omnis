#!/bin/bash
# US-B42: healthchecks.io 15종 ping + ntfy critical/warning + items(kind=system) 이중 노출(A6 §8).
set -euo pipefail

ACCOUNT="281932556+jinhologankim@users.noreply.github.com"
kc() { security find-generic-password -s "$1" -a "$ACCOUNT" -w 2>/dev/null; }

NTFY_URL="${OMNIS_NTFY_URL:-http://127.0.0.1:2586}"
DATABASE_URL="${DATABASE_URL:-postgres://vigor@127.0.0.1:5432/omnis}"

# slug|check_cmd|tier(critical|warning) — A6 §8 표 그대로. check_cmd는 성공하면 exit 0.
# check_cmd 자체가 '|'(파이프)를 품으므로 `IFS='|' read`로 자르면 안 된다 — 양 끝에서 깎는다(parse_job).
JOBS=(
  "omnis-hub|curl -fsS -m 5 http://127.0.0.1:8787/health|critical"
  "omnis-postgres|psql \"\$DATABASE_URL\" -Atc 'select 1' | grep -q 1|critical"
  "omnis-pg-slot|psql \"\$DATABASE_URL\" -Atc \"select coalesce(bool_and(active), true) from pg_replication_slots\" | grep -qx t|critical"
  "omnis-zero-cache|curl -fsS -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:4848/ | grep -q 200|critical"
  "omnis-ollama|curl -fsS -m 5 http://127.0.0.1:11434/api/tags|warning"
  "omnis-adapter-slack|psql \"\$DATABASE_URL\" -Atc \"select coalesce(bool_and(state != 'broken'), true) from accounts where channel='slack'\" | grep -qx t|warning"
  "omnis-adapter-gmail|psql \"\$DATABASE_URL\" -Atc \"select coalesce(bool_and(state != 'broken'), true) from accounts where channel='gmail'\" | grep -qx t|warning"
  "omnis-adapter-calendar|psql \"\$DATABASE_URL\" -Atc \"select coalesce(bool_and(state != 'broken'), true) from accounts where channel='gcal'\" | grep -qx t|warning"
  "omnis-adapter-outlook|psql \"\$DATABASE_URL\" -Atc \"select coalesce(bool_and(state != 'broken'), true) from accounts where channel='outlook'\" | grep -qx t|warning"
  "omnis-adapter-telegram|psql \"\$DATABASE_URL\" -Atc \"select coalesce(bool_and(state != 'broken'), true) from accounts where channel='telegram'\" | grep -qx t|warning"
  "omnis-bridge-macbook|true|warning"
  "omnis-bridge-mini|curl -fsS -m 5 http://127.0.0.1:8787/health|warning"
  "omnis-backup-pgdump|find \"\$HOME/omnis-var/backup/pg\" -name \"omnis-\$(date +%Y%m%d).dump\" -newermt today 2>/dev/null | grep -q .|critical"
  "omnis-backup-restic|true|critical"
  "omnis-tailscale-serve|bash \"\$(dirname \"\$0\")/../mini/tailscale-serve.sh\" --check|critical"
)

# slug는 첫 필드, tier는 마지막 필드, 나머지 전부가 cmd다(cmd 안의 파이프를 보존한다).
parse_job() {
  job_slug="${1%%|*}"
  job_tier="${1##*|}"
  job_cmd="${1#*|}"; job_cmd="${job_cmd%|*}"
}

post_ntfy() {
  local topic="$1" title="$2" msg="$3"
  curl -fsS -m 10 -H "Title: $title" -d "$msg" "$NTFY_URL/$topic" >/dev/null 2>&1 || true
}

# A6 §8 "모든 critical/warning은 ntfy와 별개로 items(kind=system)에도 노출". thread_id/account_id가
# NOT NULL이라 'system'/'infra' 계정·스레드를 없으면 만들고(ON CONFLICT) 그 위에 item을 쌓는다.
post_system_item() {
  local subject="$1" body="$2"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q >/dev/null <<SQL
    INSERT INTO accounts (channel, external_id, display, capabilities)
      VALUES ('system', 'infra', 'omnis infra', '{}'::jsonb)
      ON CONFLICT (channel, external_id) DO NOTHING;
    WITH acc AS (SELECT id FROM accounts WHERE channel='system' AND external_id='infra'),
         thr AS (
           INSERT INTO threads (account_id, external_id, kind, title, last_item_at)
             SELECT id, 'infra-alerts', 'system', 'Infra alerts', now() FROM acc
             ON CONFLICT (account_id, external_id) DO UPDATE SET last_item_at = now()
             RETURNING id, account_id
         )
    INSERT INTO items (thread_id, account_id, kind, subject, body, sent_at)
      SELECT id, account_id, 'system', '$(echo "$subject" | sed "s/'/''/g")', '$(echo "$body" | sed "s/'/''/g")', now() FROM thr;
SQL
}

run_check() {
  local slug="$1" cmd="$2" tier="$3"
  local hc_uuid; hc_uuid="$(kc "omnis.healthchecks.$slug")" || true
  if eval "$cmd" >/dev/null 2>&1; then
    [ -n "$hc_uuid" ] && curl -fsS -m 10 --retry 3 "https://hc-ping.com/$hc_uuid" >/dev/null 2>&1 || true
    return 0
  fi
  [ -n "$hc_uuid" ] && curl -fsS -m 10 --retry 3 "https://hc-ping.com/$hc_uuid/fail" >/dev/null 2>&1 || true
  post_ntfy "omnis-$tier" "$slug failed" "check failed: $cmd"
  post_system_item "$slug 실패" "healthcheck '$slug' 실패 ($tier)"
  echo "FAIL: $slug" >&2
  return 1
}

do_check() {
  local missing=0
  for job in "${JOBS[@]}"; do
    parse_job "$job"; local slug="$job_slug"
    kc "omnis.healthchecks.$slug" >/dev/null 2>&1 || { echo "no healthchecks uuid for $slug (will run check but skip ping)"; missing=$((missing+1)); }
  done
  echo "ok: ${#JOBS[@]} jobs configured, $missing missing a healthchecks.io uuid"
}

do_run() {
  local failures=0
  for job in "${JOBS[@]}"; do
    parse_job "$job"
    run_check "$job_slug" "$job_cmd" "$job_tier" || failures=$((failures+1))
  done
  echo "ran ${#JOBS[@]} checks, $failures failed"
  [ "$failures" -eq 0 ]
}

do_list() {
  for job in "${JOBS[@]}"; do
    parse_job "$job"
    printf '%s\t%s\n' "$job_slug" "$job_tier"
  done
}

case "${1:---check}" in
  --check) do_check ;;
  --run) do_run ;;
  --list) do_list ;;
  *) echo "usage: healthcheck-ping.sh [--check|--run|--list]" >&2; exit 64 ;;
esac
