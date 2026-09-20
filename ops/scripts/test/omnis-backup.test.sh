#!/bin/bash
# US-B41 self-check. No framework — assert style (ponytail).
# Regression target: the PATH launchd hands over (/usr/bin:/bin:/usr/sbin:/sbin) has no pg_dump,
# so the 03:00 job died on its first line. This only checks that the script fixes PATH itself.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/ops/scripts/omnis-backup.sh"

FAKE_BIN="$(mktemp -d)"
trap 'rm -rf "$FAKE_BIN"' EXIT

# Stub out only security (always "not found") so the real Keychain is never touched.
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
    echo "FAIL: pg_dump not found under the launchd PATH — $out" >&2; exit 1 ;;
esac
echo "ok: pg_dump is found even under the launchd PATH"

# Argument validation: unknown flags are rejected with 64 (the plist invokes it with no args = do_run).
if env -i HOME="$HOME" PATH="$FAKE_BIN:/usr/bin:/bin" bash "$SCRIPT" --nope >/dev/null 2>&1; then
  echo "FAIL: unknown flag accepted" >&2; exit 1
fi
echo "ok: unknown flag rejected"
echo "PASS"
