#!/bin/bash
# The spot for A6 §9's omnis-run-with-secrets.sh. env.sh reads the secrets from the Keychain and exports them,
# and this script execs a single service. launchd supervises it via KeepAlive, so there is no restart logic.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export PATH=/opt/homebrew/bin:$PATH

# shellcheck source=/dev/null
. "$ROOT/ops/mini/env.sh"

case "${1:?usage: run.sh <hub|zero-cache|local-agent>}" in
  hub)
    exec node "$ROOT/apps/hub/dist/main.js"
    ;;
  zero-cache)
    exec "$ROOT/packages/kernel/node_modules/.bin/zero-cache"
    ;;
  local-agent)
    # Codex bridge only. The bridge still comes up even when Codex is not logged in; only the runtime stays unavailable.
    # Because rootDir is ".", the tsc output lands under dist/src/ (apps/local-agent/tsconfig.json).
    exec node "$ROOT/apps/local-agent/dist/src/main.js" \
      --host mini --hub http://127.0.0.1:8787 --runtimes codex
    ;;
  *)
    echo "unknown service: $1" >&2
    exit 64
    ;;
esac
