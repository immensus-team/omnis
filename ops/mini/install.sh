#!/bin/bash
# 미니에 omnis LaunchAgent를 깐다(hub, zero-cache, local-agent + 03:00 백업 잡). sudo 없음.
# 사용법: ops/mini/install.sh            # 전체
#         ops/mini/install.sh hub        # 하나만
#         ops/mini/install.sh backup     # 백업 잡만(plist는 ops/mini/LaunchDaemons/ 아래)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
AGENTS="$HOME/Library/LaunchAgents"
SERVICES=("${@:-}")
[ -z "${SERVICES[0]}" ] && SERVICES=(hub zero-cache local-agent backup)

mkdir -p "$AGENTS" "$HOME/Library/Logs/omnis" "$HOME/.omnis" "$HOME/omnis-var"
[ -f "$ROOT/ops/mini/env.sh" ] || cp "$ROOT/ops/mini/env.sh.example" "$ROOT/ops/mini/env.sh"
[ -f "$HOME/.omnis/local-agent.toml" ] || cp "$ROOT/ops/mini/local-agent.toml.example" "$HOME/.omnis/local-agent.toml"
chmod +x "$ROOT/ops/mini/run.sh"

for service in "${SERVICES[@]}"; do
  label="com.omnis.$service"
  src="$ROOT/ops/mini/$label.plist"
  [ -f "$src" ] || src="$ROOT/ops/mini/LaunchDaemons/$label.plist"
  [ -f "$src" ] || { echo "no plist: com.omnis.$service.plist (ops/mini/ 또는 ops/mini/LaunchDaemons/)" >&2; exit 1; }
  sed -e "s#__OMNIS_ROOT__#$ROOT#g" -e "s#__HOME__#$HOME#g" "$src" > "$AGENTS/$label.plist"
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  # bootout은 비동기다. 서비스가 사라지기 전에 bootstrap하면 "5: Input/output error"로 죽는다.
  for _ in $(seq 20); do
    launchctl print "gui/$(id -u)/$label" >/dev/null 2>&1 || break
    sleep 0.5
  done
  launchctl bootstrap "gui/$(id -u)" "$AGENTS/$label.plist"
  # 캘린더 잡은 kickstart하면 그 자리에서 백업이 통째로 돈다 — 예약만 걸고 실행은 03:00에 맡긴다.
  [ "$service" = backup ] || launchctl kickstart -k "gui/$(id -u)/$label"
  echo "installed $label"
done
