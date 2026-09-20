#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/ops/scripts/restore-drill.sh"
FAKE_BIN="$(mktemp -d)"
BACKUP_DIR="$(mktemp -d)"
trap 'rm -rf "$FAKE_BIN" "$BACKUP_DIR"' EXIT

# 1) 덤프 파일이 하나도 없으면 --dry-run은 실패해야 한다.
export OMNIS_BACKUP_DIR="$BACKUP_DIR"
if "$SCRIPT" --dry-run >/dev/null 2>&1; then
  echo "FAIL: --dry-run passed with no dump files" >&2; exit 1
fi
echo "ok: --dry-run fails when no dump exists"

cat > "$FAKE_BIN/pg_restore" <<'FAKEPGR'
#!/bin/bash
# --list 호출이면 파일 존재만 확인하고 성공한다(가짜 헤더 파싱은 하지 않는다).
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
