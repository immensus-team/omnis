#!/bin/bash
# tools/auth-kit/keychain-add.sh self-check. No framework — assert style, like ops/scripts/test/*.sh.
#
# Regression target: the script used to write with `security add-generic-password -U`. An item is keyed
# by (service, account) and `-U` only replaces a same-account item, so on a machine whose item still
# carried an older account label the write added a *second* item under the same service instead of
# replacing it — while readers resolve by service name alone and take the first match. Re-running the
# tool could therefore leave the old secret in place and still "succeed".
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/tools/auth-kit/keychain-add.sh"
ITEM="omnis.slack.xoxb.T0TEST"

FAKE_BIN="$(mktemp -d)"
STORE="$(mktemp -d)/store"
LOG="$(mktemp -d)/calls"
mkdir -p "$STORE"
trap 'rm -rf "$FAKE_BIN" "$(dirname "$STORE")" "$(dirname "$LOG")"' EXIT

# Fake `security`: one file per (service, account) item, so a duplicate is visible as a second file.
# `find-generic-password -s X` with no `-a` returns the first match, exactly like the real tool.
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

item_path() { echo "$STORE/$ITEM/${1:-omnis}"; }
item_count() {
  local n=0
  if [ -d "$STORE/$ITEM" ]; then n="$(find "$STORE/$ITEM" -type f | wc -l | tr -d ' ')"; fi
  echo "$n"
}
read_back() { security find-generic-password -s "$ITEM" -w 2>/dev/null || true; }
line_of() { grep -n "^$1 " "$LOG" | head -1 | cut -d: -f1 || true; }
fail() { echo "FAIL: $1" >&2; exit 1; }

# 1) A value piped in is stored under the neutral account and comes back out.
: > "$LOG"
printf 'xoxb-secret\n' | bash "$SCRIPT" "$ITEM" >/dev/null 2>&1
[ "$(read_back)" = "xoxb-secret" ] || fail "the stored value did not read back"
[ -f "$(item_path omnis)" ] || fail "the item was not stamped with the neutral account"
echo "ok: a piped value is stored under account omnis and reads back"

# 2) An item left under an older account label is replaced, not duplicated, and the delete runs first.
#    The address stands in for the personal one older installs stamped here — no real address belongs
#    in this repo.
LEGACY_ACCT="somebody@example.com"
rm -f "$(item_path omnis)"
mkdir -p "$STORE/$ITEM"
printf 'stale-secret' > "$STORE/$ITEM/$LEGACY_ACCT"

: > "$LOG"
printf 'fresh-secret\n' | bash "$SCRIPT" "$ITEM" >/dev/null 2>&1

[ "$(item_count)" = 1 ] || fail "re-running left $(item_count) items on $ITEM (duplicate)"
[ ! -f "$STORE/$ITEM/$LEGACY_ACCT" ] || fail "the item under the older account survived"
[ "$(read_back)" = "fresh-secret" ] || fail "a read still returns the stale secret: $(read_back)"
del_at="$(line_of "delete-generic-password -s $ITEM")"
add_at="$(line_of "add-generic-password -s $ITEM")"
[ -n "$del_at" ] || fail "nothing deleted $ITEM before writing it"
[ "$add_at" -gt "$del_at" ] || fail "the add ran before the delete (line $add_at vs $del_at)"
echo "ok: a legacy-account item is deleted first, then replaced — one item, fresh value"

# 3) If the delete is refused, nothing may be written — otherwise the old item stays and a read picks
#    whichever it finds first.
printf 'stale-secret' > "$STORE/$ITEM/$LEGACY_ACCT"
rm -f "$(item_path omnis)"
: > "$LOG"
if OMNIS_TEST_KC_DENY_DELETE=1 bash "$SCRIPT" "$ITEM" >/dev/null 2>&1 <<< 'fresh-secret'; then
  fail "a refused delete was reported as a successful store"
fi
[ "$(item_count)" = 1 ] || fail "a refused delete still produced $(item_count) items"
[ -z "$(line_of "add-generic-password -s $ITEM")" ] || fail "a refused delete did not stop the add"
echo "ok: a refused delete aborts instead of leaving a shadowed stale secret"

# 4) An empty value is refused and never reaches the Keychain.
before="$(item_count)"
if printf '\n' | bash "$SCRIPT" "$ITEM" >/dev/null 2>&1; then
  fail "an empty value was accepted"
fi
[ "$(item_count)" = "$before" ] || fail "an empty value still changed the store"
echo "ok: an empty value is refused and nothing is written"

# 5) A caller-supplied account is still honoured (the label is the writer's, nothing else's).
rm -f "$(item_path omnis)"
printf 'other-account\n' | bash "$SCRIPT" "$ITEM" some-label >/dev/null 2>&1
[ "$(read_back)" = "other-account" ] || fail "an explicit account was not honoured"
[ "$(item_count)" = 1 ] || fail "an explicit account left $(item_count) items"
echo "ok: an explicit account is honoured, still as a single item"

echo "PASS"
