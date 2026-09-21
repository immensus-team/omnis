#!/bin/bash
# US-B16: generate the Web Push VAPID key pair and store it in the Keychain (steps (1)~(2) of the A6 §9 rotation procedure).
# Built directly on node:crypto with no web-push npm package — VAPID is nothing but a P-256 EC key pair.
# For all 6 steps of the rotation procedure see ops/mini/RUNBOOK.md "Web Push VAPID keys".
set -euo pipefail

ACCOUNT="omnis"   # the fixed, non-identifying label new items are stamped with (A6 §9)
PUB_SERVICE="omnis.webpush.vapid_public"
PRIV_SERVICE="omnis.webpush.vapid_private"

# No `-a`: reads resolve by service name alone, so items stamped with an older account still match.
kc_get() { security find-generic-password -s "$1" -w 2>/dev/null; }
# NOTE: `security` only accepts the value as an argv (ending with a bare `-w` triggers a tty prompt,
# which a script cannot answer). So for this one line the private key is visible to `ps` on the same
# machine. It never lands in output, logs, or commits.
kc_set() { security add-generic-password -s "$1" -a "$ACCOUNT" -w "$2" -U >/dev/null; }

gen_keys() {
  # 2 lines on stdout: line 1 public (base64url uncompressed point), line 2 private (base64url d).
  # The last 65 bytes of the SPKI DER = the uncompressed EC point (0x04 + 32-byte x + 32-byte y).
  # The P-256 SPKI header has a fixed length, so it can be sliced reliably from the end (standard
  # node:crypto behavior).
  node -e '
    const crypto = require("node:crypto");
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const pubRaw = publicKey.export({ type: "spki", format: "der" }).subarray(-65);
    const d = privateKey.export({ format: "jwk" }).d;
    process.stdout.write(
      pubRaw.toString("base64url") + "\n" +
      Buffer.from(d, "base64url").toString("base64url") + "\n"
    );
  '
}

do_check() {
  local pub priv
  pub="$(kc_get "$PUB_SERVICE")" || { echo "missing $PUB_SERVICE" >&2; return 1; }
  priv="$(kc_get "$PRIV_SERVICE")" || { echo "missing $PRIV_SERVICE" >&2; return 1; }
  [ "${#pub}" -ge 80 ] || { echo "vapid public key looks too short (${#pub} chars)" >&2; return 1; }
  [ "${#priv}" -ge 40 ] || { echo "vapid private key looks too short (${#priv} chars)" >&2; return 1; }
  echo "ok: vapid keys present ($PUB_SERVICE, $PRIV_SERVICE)"
}

do_generate() {
  local force="${1:-}" have=0
  # Check both public and private — a half state with only one side left is not flattened into "already present".
  if kc_get "$PUB_SERVICE"  >/dev/null 2>&1; then have=$((have + 1)); fi
  if kc_get "$PRIV_SERVICE" >/dev/null 2>&1; then have=$((have + 2)); fi
  if [ "$force" != "--force" ] && [ "$have" -ne 0 ]; then
    case "$have" in
      3) echo "vapid keys already exist — use --force to rotate (A6 §9 rotation procedure)" >&2 ;;
      1) echo "half-written keychain: $PUB_SERVICE only. --force replaces BOTH entries" >&2 ;;
      2) echo "half-written keychain: $PRIV_SERVICE only. --force replaces BOTH entries" >&2 ;;
    esac
    exit 1
  fi
  local keys pub priv
  keys="$(gen_keys)"           # never pass this through argv (avoids ps exposure) — handle it only as a 2-line string
  pub="${keys%%$'\n'*}"
  priv="${keys##*$'\n'}"
  kc_set "$PUB_SERVICE" "$pub"
  kc_set "$PRIV_SERVICE" "$priv"
  echo "vapid keys stored: $PUB_SERVICE, $PRIV_SERVICE"
}

case "${1:-}" in
  --check) do_check ;;
  --force) do_generate --force ;;
  "") do_generate ;;
  *) echo "usage: gen-vapid.sh [--check|--force]" >&2; exit 64 ;;
esac
