#!/bin/bash
# Stores one channel secret in the macOS Keychain. The value is only ever read from a prompt —
# it never lands in shell history (A6 §9). Names follow the A1 §1.3 / A6 §9 scheme verbatim:
#   omnis.<channel>.<kind>.<external_id>  (e.g. omnis.slack.xoxb.T0XXXXXXX)
#
# Usage: tools/auth-kit/keychain-add.sh <item> [account]
#   item    Keychain service name (required)
#   account defaults to omnis — a fixed, non-identifying label (A6 §9). Readers look items up by
#   service name only, so the account never has to match anything.
#   Re-running for an existing service *replaces* it: see the delete-first block below.
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

# A generic-password item is keyed by (service, account), so `-U` only ever replaces an item whose
# account matches too. An item left under an older label — older installs stamped a personal address
# there — would survive as a *second* item under the same service, and readers resolve by service name
# alone (A6 §9): they could then keep returning the stale secret. So delete every item for the service
# first, one per `security` call, and then confirm the service really is clear. A denied delete
# (`security` prompts for items this tool did not create) has to abort loudly — a silent fall-through
# would write the new item right next to the old one, which is the bug this guards against.
while security delete-generic-password -s "$item" >/dev/null 2>&1; do :; done
if security find-generic-password -s "$item" >/dev/null 2>&1; then
  echo "Aborted: an existing item for $item could not be removed — nothing was written" >&2
  exit 1
fi

security add-generic-password -s "$item" -a "$account" -w "$secret"
echo "Stored: $item (account=$account)"
