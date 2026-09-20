#!/bin/bash
# Installs the omnis LaunchAgents on the mini (hub, zero-cache, local-agent + the 03:00 backup job). No sudo.
# Usage: ops/mini/install.sh            # everything
#        ops/mini/install.sh hub        # just one
#        ops/mini/install.sh backup     # backup job only (plist lives under ops/mini/LaunchDaemons/)
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
  [ -f "$src" ] || { echo "no plist: com.omnis.$service.plist (ops/mini/ or ops/mini/LaunchDaemons/)" >&2; exit 1; }
  sed -e "s#__OMNIS_ROOT__#$ROOT#g" -e "s#__HOME__#$HOME#g" "$src" > "$AGENTS/$label.plist"
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
  # bootout is asynchronous. Bootstrapping before the service is gone dies with "5: Input/output error".
  for _ in $(seq 20); do
    launchctl print "gui/$(id -u)/$label" >/dev/null 2>&1 || break
    sleep 0.5
  done
  launchctl bootstrap "gui/$(id -u)" "$AGENTS/$label.plist"
  # Kickstarting a calendar job runs a full backup right then — so only register the schedule and leave the run to 03:00.
  [ "$service" = backup ] || launchctl kickstart -k "gui/$(id -u)/$label"
  echo "installed $label"
done
