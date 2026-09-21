#!/bin/bash
# US-B16 self-check. No framework — assert style (ponytail).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/ops/scripts/gen-vapid.sh"
PUB_SERVICE="omnis.webpush.vapid_public"
PRIV_SERVICE="omnis.webpush.vapid_private"
ACCT="omnis"

FAKE_BIN="$(mktemp -d)"
STORE="$(mktemp -d)/store"
LOG="$(mktemp -d)/calls"
mkdir -p "$STORE"
trap 'rm -rf "$FAKE_BIN" "$(dirname "$STORE")" "$(dirname "$LOG")"' EXIT

# Fake `security`: models the real store, where an item is keyed by (service, account) — one file per
# item, so a duplicate under a single service shows up as a second file. `find-generic-password -s X`
# with no `-a` returns the *first* match, exactly like the real tool: that is what made a duplicate
# dangerous rather than merely untidy. Every call is appended to $OMNIS_TEST_KC_LOG so a test can assert
# that the delete happens before the add.
cat > "$FAKE_BIN/security" <<'FAKESEC'
#!/bin/bash
store="${OMNIS_TEST_KC_STORE:?}"
cmd="$1"; shift
svc=""; acct=""; val=""; bare_w=0
while [ $# -gt 0 ]; do
  case "$1" in
    -s) svc="$2"; shift 2 ;;
    -a) acct="$2"; shift 2 ;;
    -w) if [ $# -ge 2 ] && [ "${2#-}" = "$2" ]; then val="$2"; shift 2; else bare_w=1; shift; fi ;;
    *) shift ;;
  esac
done
echo "$cmd -s $svc -a ${acct:-(none)}" >> "$OMNIS_TEST_KC_LOG"
dir="$store/$svc"
first_item() { [ -d "$dir" ] && find "$dir" -type f | sort | head -1; }
case "$cmd" in
  find-generic-password)
    item="$dir/${acct:-(none)}"
    if [ -z "$acct" ]; then item="$(first_item)"; fi
    if [ -n "$item" ] && [ -f "$item" ]; then
      if [ "$bare_w" = 1 ]; then cat "$item"; else echo "attributes: $svc"; fi
    else
      echo "item not found" >&2; exit 44
    fi ;;
  add-generic-password)
    mkdir -p "$dir"; printf '%s' "$val" > "$dir/${acct:-(none)}" ;;
  delete-generic-password)
    if [ "${OMNIS_TEST_KC_DENY_DELETE:-}" = 1 ]; then echo "delete denied" >&2; exit 1; fi
    item="$dir/${acct:-(none)}"
    if [ -z "$acct" ]; then item="$(first_item)"; fi
    if [ -n "$item" ] && [ -f "$item" ]; then rm -f "$item"; else echo "item not found" >&2; exit 44; fi ;;
  *) echo "unsupported: $cmd" >&2; exit 64 ;;
esac
FAKESEC
chmod +x "$FAKE_BIN/security"

export PATH="$FAKE_BIN:$PATH"
export OMNIS_TEST_KC_STORE="$STORE"
export OMNIS_TEST_KC_LOG="$LOG"

# An item's path in the fake store; the default account is the one the script writes with.
item_path() { echo "$STORE/$1/${2:-$ACCT}"; }
item_count() {
  local n=0
  if [ -d "$STORE/$1" ]; then n="$(find "$STORE/$1" -type f | wc -l | tr -d ' ')"; fi
  echo "$n"
}
item_value() { cat "$STORE/$1/${2:-$ACCT}" 2>/dev/null || true; }
# First line number of a call in the log, or empty.
line_of() { grep -n "^$1 " "$LOG" | head -1 | cut -d: -f1 || true; }
fail() { echo "FAIL: $1" >&2; exit 1; }

# 1) With no keys stored yet, --check must fail.
if "$SCRIPT" --check >/dev/null 2>&1; then
  echo "FAIL: --check passed with no keys stored" >&2; exit 1
fi
echo "ok: --check fails before generation"

# 2) After generation, --check must succeed.
"$SCRIPT" >/dev/null
"$SCRIPT" --check
echo "ok: --check passes after generation"

pub1="$(item_value "$PUB_SERVICE")"

# 3) Re-generating without --force must be rejected and the existing key preserved (A6 §9: keys rotate by hand only).
if "$SCRIPT" >/dev/null 2>&1; then
  echo "FAIL: re-generation without --force should be rejected" >&2; exit 1
fi
[ "$(item_value "$PUB_SERVICE")" = "$pub1" ] || { echo "FAIL: key mutated without --force" >&2; exit 1; }
echo "ok: re-generation without --force is rejected and key is unchanged"

# 4) --force must rotate the key.
"$SCRIPT" --force >/dev/null
pub2="$(item_value "$PUB_SERVICE")"
[ "$pub1" != "$pub2" ] || { echo "FAIL: --force did not rotate the key" >&2; exit 1; }
echo "ok: --force rotates the key"

# 5) Even in a half-written state (only the public key remains) it must reject without --force and name the reason distinctly.
rm -f "$(item_path "$PRIV_SERVICE")"
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
[ -s "$(item_path "$PRIV_SERVICE")" ] || { echo "FAIL: --force did not restore the private key" >&2; exit 1; }
echo "ok: half-written keychain is reported and repaired only by --force"

# 6) A key left under an older account label must be REPLACED, not shadowed by a second item. `-U` only
# replaces a same-account item, and a read resolves by service alone and takes the first match, so an
# in-place-looking write could otherwise keep serving the stale secret. The address below stands in for
# the personal one older installs stamped here — no real address belongs in this repo.
LEGACY_ACCT="somebody@example.com"
rm -f "$(item_path "$PUB_SERVICE")" "$(item_path "$PRIV_SERVICE")"
mkdir -p "$STORE/$PUB_SERVICE" "$STORE/$PRIV_SERVICE"
printf 'stale-public' > "$STORE/$PUB_SERVICE/$LEGACY_ACCT"
printf 'stale-private' > "$STORE/$PRIV_SERVICE/$LEGACY_ACCT"
[ "$(item_count "$PUB_SERVICE")" = 1 ] || fail "setup: expected exactly one legacy item"

: > "$LOG"
"$SCRIPT" --force >/dev/null

[ "$(item_count "$PUB_SERVICE")" = 1 ] || fail "rotation left $(item_count "$PUB_SERVICE") items on $PUB_SERVICE (duplicate)"
[ "$(item_count "$PRIV_SERVICE")" = 1 ] || fail "rotation left $(item_count "$PRIV_SERVICE") items on $PRIV_SERVICE (duplicate)"
[ ! -f "$STORE/$PUB_SERVICE/$LEGACY_ACCT" ] || fail "the item under the older account survived"
[ "$(item_value "$PUB_SERVICE")" != "stale-public" ] || fail "the stale public key is still what a read returns"
[ "$(item_value "$PRIV_SERVICE")" != "stale-private" ] || fail "the stale private key is still what a read returns"

del_at="$(line_of "delete-generic-password -s $PUB_SERVICE")"
add_at="$(line_of "add-generic-password -s $PUB_SERVICE")"
[ -n "$del_at" ] || fail "nothing deleted $PUB_SERVICE before writing it"
[ -n "$add_at" ] || fail "nothing added $PUB_SERVICE"
[ "$del_at" -lt "$add_at" ] || fail "the add ran before the delete (line $add_at vs $del_at)"
echo "ok: a legacy-account item is deleted first, then replaced — one item, fresh key"

# 7) If the delete is refused, the write must abort rather than add a second item beside the old one.
printf 'stale-public' > "$STORE/$PUB_SERVICE/$LEGACY_ACCT"
rm -f "$(item_path "$PUB_SERVICE")"
: > "$LOG"
if OMNIS_TEST_KC_DENY_DELETE=1 "$SCRIPT" --force >/dev/null 2>&1; then
  fail "a refused delete was not reported — the write looked successful"
fi
[ "$(item_count "$PUB_SERVICE")" = 1 ] || fail "a refused delete still produced $(item_count "$PUB_SERVICE") items"
[ -z "$(line_of "add-generic-password -s $PUB_SERVICE")" ] || fail "a refused delete did not stop the add"
echo "ok: a refused delete aborts the write instead of leaving a shadowed stale key"

echo "PASS"
