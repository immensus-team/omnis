#!/bin/bash
# US-B41 self-check. 프레임워크 없음 — assert 스타일(ponytail).
# 회귀 대상: launchd가 주는 PATH(/usr/bin:/bin:/usr/sbin:/sbin)에는 pg_dump가 없어서
# 03:00 잡이 첫 줄에서 죽었다. 스크립트가 직접 PATH를 고치는지만 본다.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/ops/scripts/omnis-backup.sh"

FAKE_BIN="$(mktemp -d)"
trap 'rm -rf "$FAKE_BIN"' EXIT

# 진짜 Keychain을 건드리지 않도록 security만 가짜로 세운다(항상 "없음").
cat > "$FAKE_BIN/security" <<'FAKESEC'
#!/bin/bash
echo "not found" >&2
exit 44
FAKESEC
chmod +x "$FAKE_BIN/security"

out="$(env -i HOME="$HOME" PATH="$FAKE_BIN:/usr/bin:/bin:/usr/sbin:/sbin" \
  bash "$SCRIPT" --check 2>&1 || true)"
case "$out" in
  *"pg_dump not on PATH"*)
    echo "FAIL: launchd PATH로는 pg_dump를 못 찾는다 — $out" >&2; exit 1 ;;
esac
echo "ok: launchd PATH에서도 pg_dump가 잡힌다"

# 인자 검증: 알 수 없는 인자는 64로 거절한다(plist는 인자 없이 부른다 = do_run).
if env -i HOME="$HOME" PATH="$FAKE_BIN:/usr/bin:/bin" bash "$SCRIPT" --nope >/dev/null 2>&1; then
  echo "FAIL: unknown flag accepted" >&2; exit 1
fi
echo "ok: unknown flag rejected"
echo "PASS"
