#!/bin/bash
# US-B41: 분기 복구 리허설. --dry-run은 최신 덤프가 읽을 수 있는 파일인지만 확인한다(사람이 분기 1회
# 인자 없이 돌려 스크래치 포트 5433에 실제로 복원하고 row count를 검증한다).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BACKUP_DIR="${OMNIS_BACKUP_DIR:-$HOME/omnis-var/backup}"
PG_DIR="$BACKUP_DIR/pg"
SCRATCH_PORT="${OMNIS_RESTORE_PORT:-5433}"
SCRATCH_DB="omnis_restore_drill"
LOG="$ROOT/backup/restore-drills.md"

latest_dump() {
  ls -t "$PG_DIR"/omnis-*.dump 2>/dev/null | head -1 || true
}

mode="${1:-}"
latest="$(latest_dump)"
if [ -z "$latest" ]; then
  echo "FAIL: no dump file found in $PG_DIR (run omnis-backup.sh first)" >&2
  exit 1
fi

if [ "$mode" = "--dry-run" ]; then
  pg_restore --list "$latest" >/dev/null
  echo "ok: dump file is readable ($latest)"
  exit 0
fi

dropdb -p "$SCRATCH_PORT" --if-exists "$SCRATCH_DB"
createdb -p "$SCRATCH_PORT" "$SCRATCH_DB"
pg_restore --dbname="postgres://localhost:${SCRATCH_PORT}/${SCRATCH_DB}" --no-owner "$latest"

result="$(psql -p "$SCRATCH_PORT" -d "$SCRATCH_DB" -Atc "
  SELECT (SELECT count(*) FROM items) || '|' ||
         (SELECT count(*) FROM threads) || '|' ||
         (SELECT count(*) FROM pending_approvals) || '|' ||
         coalesce((SELECT max(sent_at)::text FROM items), 'none')
")"
IFS='|' read -r items_n threads_n approvals_n max_sent <<< "$result"
echo "items=$items_n threads=$threads_n pending_approvals=$approvals_n latest_sent_at=$max_sent"

if [ "$items_n" -le 0 ]; then
  printf '\n## %s — FAIL\n\n- dump: `%s`\n- items table restored empty\n' \
    "$(date -u +%FT%TZ)" "$latest" >> "$LOG"
  echo "FAIL: items table restored empty — see $LOG" >&2
  exit 1
fi

printf '\n## %s — PASS\n\n- dump: `%s`\n- items=%s threads=%s pending_approvals=%s latest sent_at=%s\n' \
  "$(date -u +%FT%TZ)" "$latest" "$items_n" "$threads_n" "$approvals_n" "$max_sent" >> "$LOG"
dropdb -p "$SCRATCH_PORT" "$SCRATCH_DB"
echo "ok: restore drill passed, logged to $LOG"
