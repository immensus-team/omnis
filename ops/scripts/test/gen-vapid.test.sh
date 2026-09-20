#!/bin/bash
# US-B16 self-check. No framework — assert style (ponytail).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/ops/scripts/gen-vapid.sh"
PUB_SERVICE="omnis.webpush.vapid_public"
PRIV_SERVICE="omnis.webpush.vapid_private"

FAKE_BIN="$(mktemp -d)"
STORE="$(mktemp -d)/store"
mkdir -p "$STORE"
trap 'rm -rf "$FAKE_BIN" "$(dirname "$STORE")"' EXIT

# Fake security: mimics -s <service> -a <account> -w [value] with one service per file.
cat > "$FAKE_BIN/security" <<'FAKESEC'
#!/bin/bash
store="${OMNIS_TEST_KC_STORE:?}"
if [ "$1" = "find-generic-password" ]; then
  svc=""; for a in "$@"; do case "$prev" in -s) svc="$a";; esac; prev="$a"; done
  [ -f "$store/$svc" ] && cat "$store/$svc" || { echo "not found" >&2; exit 44; }
elif [ "$1" = "add-generic-password" ]; then
  svc=""; val=""; prev=""
  for a in "$@"; do
    case "$prev" in -s) svc="$a";; -w) val="$a";; esac
    prev="$a"
  done
  echo -n "$val" > "$store/$svc"
else
  echo "unsupported: $*" >&2; exit 64
fi
FAKESEC
chmod +x "$FAKE_BIN/security"

export PATH="$FAKE_BIN:$PATH"
export OMNIS_TEST_KC_STORE="$STORE"

# 1) With no keys stored yet, --check must fail.
if "$SCRIPT" --check >/dev/null 2>&1; then
  echo "FAIL: --check passed with no keys stored" >&2; exit 1
fi
echo "ok: --check fails before generation"

# 2) After generation, --check must succeed.
"$SCRIPT" >/dev/null
"$SCRIPT" --check
echo "ok: --check passes after generation"

pub1="$(cat "$STORE/$PUB_SERVICE" 2>/dev/null || true)"

# 3) Re-generating without --force must be rejected and the existing key preserved (A6 §9: keys rotate by hand only).
if "$SCRIPT" >/dev/null 2>&1; then
  echo "FAIL: re-generation without --force should be rejected" >&2; exit 1
fi
[ "$(cat "$STORE/$PUB_SERVICE")" = "$pub1" ] || { echo "FAIL: key mutated without --force" >&2; exit 1; }
echo "ok: re-generation without --force is rejected and key is unchanged"

# 4) --force must rotate the key.
"$SCRIPT" --force >/dev/null
pub2="$(cat "$STORE/$PUB_SERVICE")"
[ "$pub1" != "$pub2" ] || { echo "FAIL: --force did not rotate the key" >&2; exit 1; }
echo "ok: --force rotates the key"

# 5) Even in a half-written state (only the public key remains) it must reject without --force and name the reason distinctly.
rm -f "$STORE/$PRIV_SERVICE"
if "$SCRIPT" >/dev/null 2>&1; then
  echo "FAIL: half-written keychain should still require --force" >&2; exit 1
fi
# Not captured through a pipe because of pipefail — the script intentionally exits 1.
msg="$("$SCRIPT" 2>&1 >/dev/null || true)"
case "$msg" in
  *half-written*) ;;
  *) echo "FAIL: half-written state was not reported as such: $msg" >&2; exit 1 ;;
esac
"$SCRIPT" --force >/dev/null
[ -s "$STORE/$PRIV_SERVICE" ] || { echo "FAIL: --force did not restore the private key" >&2; exit 1; }
echo "ok: half-written keychain is reported and repaired only by --force"

echo "PASS"
