#!/bin/bash
# Stores one channel secret in the macOS Keychain. The value is only ever read from a prompt —
# it never lands in shell history (A6 §9). Names follow the A1 §1.3 / A6 §9 scheme verbatim:
#   omnis.<channel>.<kind>.<external_id>  (e.g. omnis.slack.xoxb.T0XXXXXXX)
#
# Usage: tools/auth-kit/keychain-add.sh <item> [account]
#   item    Keychain service name (required)
#   account defaults to omnis — a fixed, non-identifying label (A6 §9). Readers look items up by
#   service name only, so the account never has to match anything.
#
# Only works in a GUI session — in an SSH shell (Background session) security rejects it
# with "User interaction is not allowed" (ops/mini/RUNBOOK.md §4).
set -euo pipefail

item="${1:?usage: keychain-add.sh <item> [account]}"
account="${2:-omnis}"

read -r -s -p "Value for $item (account=$account): " secret
echo
if [ -z "$secret" ]; then
  echo "Empty value — not stored" >&2
  exit 1
fi

security add-generic-password -U -s "$item" -a "$account" -w "$secret"
echo "Stored: $item (account=$account)"
