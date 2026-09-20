#!/bin/bash
# US-B41: pg_dump --format=custom → restic → B2. The LaunchDaemon (ops/mini/LaunchDaemons/com.omnis.backup.plist)
# execs this script verbatim at 03:00. A GUI session is required (Keychain reads — see the RUNBOOK note
# "Do not touch the mini's existing infrastructure").
set -euo pipefail
# launchd hands over a PATH of just /usr/bin:/bin:/usr/sbin:/sbin, so pg_dump and restic are not visible (same reason as ops/mini/run.sh).
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

  # Apart from the dump, either of these may or may not exist — handing restic a missing path makes it
  # exit non-zero and forget/prune plus the local cleanup never run at all. Pass only the ones that exist.
  local -a sources=("$PG_DIR")
  local extra
  for extra in "$HOME/.omnis/self-model" "$ROOT/secrets"; do
    if [ -e "$extra" ]; then sources+=("$extra"); fi
  done
  restic backup "${sources[@]}" --tag omnis-backup
  restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune

  # Keep only 7 days of local dumps — restic retains them long-term in the remote, so locally they are just a buffer for recent recovery.
  find "$PG_DIR" -name 'omnis-*.dump' -mtime +7 -delete
  echo "backup ok: $(date -u +%FT%TZ)"
}

case "${1:-}" in
  --check) do_check ;;
  "") do_run ;;
  *) echo "usage: omnis-backup.sh [--check]" >&2; exit 64 ;;
esac
