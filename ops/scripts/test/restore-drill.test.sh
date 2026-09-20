#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/ops/scripts/restore-drill.sh"
FAKE_BIN="$(mktemp -d)"
BACKUP_DIR="$(mktemp -d)"
trap 'rm -rf "$FAKE_BIN" "$BACKUP_DIR"' EXIT

# 1) With no dump files at all, --dry-run must fail.
export OMNIS_BACKUP_DIR="$BACKUP_DIR"
if "$SCRIPT" --dry-run >/dev/null 2>&1; then
  echo "FAIL: --dry-run passed with no dump files" >&2; exit 1
fi
echo "ok: --dry-run fails when no dump exists"

cat > "$FAKE_BIN/pg_restore" <<'FAKEPGR'
#!/bin/bash
# On a --list call, only verify the file exists and succeed (no fake header parsing).
if [ "$1" = "--list" ]; then
  [ -f "$2" ] && exit 0 || exit 1
fi
exit 0
FAKEPGR
chmod +x "$FAKE_BIN/pg_restore"
export PATH="$FAKE_BIN:$PATH"

mkdir -p "$BACKUP_DIR/pg"
echo "fake dump" > "$BACKUP_DIR/pg/omnis-20260920.dump"

"$SCRIPT" --dry-run
echo "ok: --dry-run passes when a dump exists"
echo "PASS"
