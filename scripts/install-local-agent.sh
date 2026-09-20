#!/usr/bin/env bash
# A6 §10: plist 복사 → launchctl bootstrap → 기동 확인. 사용법: scripts/install-local-agent.sh mini|macbook
set -euo pipefail

HOST="${1:?usage: install-local-agent.sh <mini|macbook>}"
LABEL="ai.onwordlab.omnis-local-agent"
SRC="$(cd "$(dirname "$0")/.." && pwd)/apps/local-agent/launchagent/${LABEL}.${HOST}.plist"
DEST="${HOME}/Library/LaunchAgents/${LABEL}.plist"

[ -f "$SRC" ] || { echo "no plist for host: ${HOST}" >&2; exit 1; }
mkdir -p "${HOME}/Library/LaunchAgents" "${HOME}/Library/Logs/omnis"
cp "$SRC" "$DEST"

launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$DEST"
launchctl kickstart -k "gui/$(id -u)/${LABEL}"

sleep 2
launchctl print "gui/$(id -u)/${LABEL}" | grep -E '^\s+state = ' || { echo "local-agent did not start" >&2; exit 1; }
echo "installed ${LABEL} for host=${HOST}"
