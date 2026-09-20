#!/bin/bash
# US-B41: pg_dump --format=custom → restic → B2. LaunchDaemon(ops/mini/LaunchDaemons/com.omnis.backup.plist)
# 이 03:00에 이 스크립트를 그대로 exec한다. GUI 세션 필요(Keychain 읽기, RUNBOOK "미니의 기존 설비" 절 참조).
set -euo pipefail
# launchd가 주는 PATH는 /usr/bin:/bin:/usr/sbin:/sbin뿐이라 pg_dump·restic이 안 보인다(ops/mini/run.sh와 같은 이유).
export PATH=/opt/homebrew/bin:$PATH
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ACCOUNT="281932556+jinhologankim@users.noreply.github.com"
kc() { security find-generic-password -s "$1" -a "$ACCOUNT" -w; }

BACKUP_DIR="${OMNIS_BACKUP_DIR:-$HOME/omnis-var/backup}"
PG_DIR="$BACKUP_DIR/pg"
DATABASE_URL="${DATABASE_URL:-postgres://vigor@127.0.0.1:5432/omnis}"

do_check() {
  command -v pg_dump >/dev/null || { echo "FAIL: pg_dump not on PATH" >&2; return 1; }
  command -v restic >/dev/null || { echo "FAIL: restic not on PATH" >&2; return 1; }
  kc omnis.restic.repository >/dev/null 2>&1 || { echo "FAIL: Keychain omnis.restic.repository missing" >&2; return 1; }
  kc omnis.restic.password >/dev/null 2>&1 || { echo "FAIL: Keychain omnis.restic.password missing" >&2; return 1; }
  echo "ok: pg_dump/restic on PATH, restic credentials present"
}

do_run() {
  mkdir -p "$PG_DIR"
  local dump_file="$PG_DIR/omnis-$(date +%Y%m%d).dump"
  pg_dump --format=custom --dbname="$DATABASE_URL" --file="$dump_file"
  echo "pg_dump ok: $dump_file"

  export RESTIC_REPOSITORY; RESTIC_REPOSITORY="$(kc omnis.restic.repository)"
  export RESTIC_PASSWORD; RESTIC_PASSWORD="$(kc omnis.restic.password)"
  export B2_ACCOUNT_ID; B2_ACCOUNT_ID="$(kc omnis.b2.account_id)"
  export B2_ACCOUNT_KEY; B2_ACCOUNT_KEY="$(kc omnis.b2.account_key)"

  # 덤프 말고는 둘 다 있을 수도 없을 수도 있다 — 없는 경로를 넘기면 restic이 non-zero로 죽어
  # forget·prune과 로컬 정리가 통째로 안 돈다. 있는 것만 넘긴다.
  local -a sources=("$PG_DIR")
  local extra
  for extra in "$HOME/.omnis/self-model" "$ROOT/secrets"; do
    if [ -e "$extra" ]; then sources+=("$extra"); fi
  done
  restic backup "${sources[@]}" --tag omnis-backup
  restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune

  # 로컬 덤프는 7일치만 남긴다 — restic이 원격에 장기 보관하므로 로컬은 최근 복구용 버퍼일 뿐.
  find "$PG_DIR" -name 'omnis-*.dump' -mtime +7 -delete
  echo "backup ok: $(date -u +%FT%TZ)"
}

case "${1:-}" in
  --check) do_check ;;
  "") do_run ;;
  *) echo "usage: omnis-backup.sh [--check]" >&2; exit 64 ;;
esac
