#!/bin/bash
# US-B43: mini boot checklist. Read-only — it prints only the failing items and fixes nothing (A6 §2).
set -uo pipefail
FAILS=()

check_filevault() {
  local status; status="$(fdesetup status 2>/dev/null || echo unknown)"
  echo "$status" | grep -q "FileVault is On" || FAILS+=("FileVault: $status")
}
check_autologin() {
  local user
  user="$(defaults read /Library/Preferences/com.apple.loginwindow autoLoginUser 2>/dev/null || echo "")"
  [ -n "$user" ] || FAILS+=("autologin: not configured")
}
check_pmset() {
  local out; out="$(pmset -g 2>/dev/null | grep -E '^\s*(sleep|displaysleep|disksleep)\s')"
  echo "$out" | awk '{ if ($2 != 0) exit 1 }' || FAILS+=("pmset sleep != 0: $(echo "$out" | tr '\n' ';')")
}
# Unlike the three sleep settings, autorestart must be 1 (auto boot after a power outage, A6 §2.3) —
# and it must not match the adjacent autorestartatconnect line, so it is checked separately with an anchored field.
check_autorestart() {
  pmset -g 2>/dev/null | awk '$1 == "autorestart" { found=1; if ($2 != 1) exit 1 } END { if (!found) exit 1 }' \
    || FAILS+=("pmset autorestart != 1 (auto boot after power restore is off)")
}
check_launchagents() {
  local uid; uid="$(id -u)"
  for label in com.omnis.hub com.omnis.zero-cache com.omnis.local-agent com.omnis.backup; do
    launchctl print "gui/$uid/$label" >/dev/null 2>&1 || FAILS+=("launchagent not loaded: $label")
  done
}
check_ollama() {
  curl -fsS -m 5 http://127.0.0.1:11434/api/tags 2>/dev/null | grep -q "nomic-embed-text" \
    || FAILS+=("ollama: nomic-embed-text model missing")
}
check_slot() {
  local active
  # The mini's Postgres role is its login user — derive it instead of naming anyone (A6 §9).
  active="$(psql "${DATABASE_URL:-postgres://$(id -un)@127.0.0.1:5432/omnis}" -Atc \
    "select coalesce(bool_and(active), true) from pg_replication_slots" 2>/dev/null || echo f)"
  [ "$active" = "t" ] || FAILS+=("replication slot inactive")
}

check_filevault
check_autologin
check_pmset
check_autorestart
check_launchagents
check_ollama
check_slot

if [ "${#FAILS[@]}" -eq 0 ]; then
  echo "ok: preflight passed"
  exit 0
fi
printf 'FAIL: %s\n' "${FAILS[@]}" >&2
exit 1
