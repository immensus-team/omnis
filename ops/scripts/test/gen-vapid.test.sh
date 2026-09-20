#!/bin/bash
# US-B16 self-check. 프레임워크 없음 — assert 스타일(ponytail).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/ops/scripts/gen-vapid.sh"
PUB_SERVICE="omnis.webpush.vapid_public"
PRIV_SERVICE="omnis.webpush.vapid_private"

FAKE_BIN="$(mktemp -d)"
STORE="$(mktemp -d)/store"
mkdir -p "$STORE"
trap 'rm -rf "$FAKE_BIN" "$(dirname "$STORE")"' EXIT

# 가짜 security: -s <service> -a <account> -w [값] 를 파일 하나당 한 서비스로 흉내낸다.
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

# 1) 아직 키가 없을 때 --check는 실패해야 한다.
if "$SCRIPT" --check >/dev/null 2>&1; then
  echo "FAIL: --check passed with no keys stored" >&2; exit 1
fi
echo "ok: --check fails before generation"

# 2) 생성 후 --check는 성공해야 한다.
"$SCRIPT" >/dev/null
"$SCRIPT" --check
echo "ok: --check passes after generation"

pub1="$(cat "$STORE/$PUB_SERVICE" 2>/dev/null || true)"

# 3) --force 없이 재생성하면 거부하고 기존 키를 보존해야 한다(A6 §9: 키는 손으로만 회전).
if "$SCRIPT" >/dev/null 2>&1; then
  echo "FAIL: re-generation without --force should be rejected" >&2; exit 1
fi
[ "$(cat "$STORE/$PUB_SERVICE")" = "$pub1" ] || { echo "FAIL: key mutated without --force" >&2; exit 1; }
echo "ok: re-generation without --force is rejected and key is unchanged"

# 4) --force는 키를 회전시켜야 한다.
"$SCRIPT" --force >/dev/null
pub2="$(cat "$STORE/$PUB_SERVICE")"
[ "$pub1" != "$pub2" ] || { echo "FAIL: --force did not rotate the key" >&2; exit 1; }
echo "ok: --force rotates the key"

# 5) 반쪽 상태(공개키만 남음)에서도 --force 없이는 거부하고, 거부 사유를 구분해 말해야 한다.
rm -f "$STORE/$PRIV_SERVICE"
if "$SCRIPT" >/dev/null 2>&1; then
  echo "FAIL: half-written keychain should still require --force" >&2; exit 1
fi
# pipefail 때문에 파이프로 받지 않는다 — 스크립트는 의도적으로 1로 끝난다.
msg="$("$SCRIPT" 2>&1 >/dev/null || true)"
case "$msg" in
  *half-written*) ;;
  *) echo "FAIL: half-written state was not reported as such: $msg" >&2; exit 1 ;;
esac
"$SCRIPT" --force >/dev/null
[ -s "$STORE/$PRIV_SERVICE" ] || { echo "FAIL: --force did not restore the private key" >&2; exit 1; }
echo "ok: half-written keychain is reported and repaired only by --force"

echo "PASS"
