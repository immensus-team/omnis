#!/bin/bash
# A6 §9의 omnis-run-with-secrets.sh 자리. env.sh가 Keychain에서 비밀을 읽어 export하고,
# 여기서 서비스 하나를 exec한다. launchd가 KeepAlive로 감독하므로 재시작 로직은 없다.
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
    # Codex 브리지만. Codex가 로그인돼 있지 않아도 브리지는 뜨고 런타임만 unavailable로 남는다.
    # rootDir이 "."라 tsc 산출물은 dist/src/ 아래로 떨어진다(apps/local-agent/tsconfig.json).
    exec node "$ROOT/apps/local-agent/dist/src/main.js" \
      --host mini --hub http://127.0.0.1:8787 --runtimes codex
    ;;
  *)
    echo "unknown service: $1" >&2
    exit 64
    ;;
esac
