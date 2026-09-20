#!/bin/bash
# US-B43: 미니 부팅 체크리스트. 읽기 전용 — 고치지 않고 실패 항목만 출력한다(A6 §2).
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
# autorestart는 sleep 3종과 반대로 1이어야 한다(정전 복구 시 자동 부팅, A6 §2.3) —
# 그리고 인접한 autorestartatconnect 줄에 걸리면 안 되므로 필드 고정으로 따로 본다.
check_autorestart() {
  pmset -g 2>/dev/null | awk '$1 == "autorestart" { found=1; if ($2 != 1) exit 1 } END { if (!found) exit 1 }' \
    || FAILS+=("pmset autorestart != 1 (전원 복구 시 자동 부팅 꺼짐)")
}
check_launchagents() {
  local uid; uid="$(id -u)"
  for label in com.omnis.hub com.omnis.zero-cache com.omnis.local-agent com.omnis.backup; do
    launchctl print "gui/$uid/$label" >/dev/null 2>&1 || FAILS+=("launchagent not loaded: $label")
  done
}
check_ollama() {
  curl -fsS -m 5 http://127.0.0.1:11434/api/tags 2>/dev/null | grep -q "nomic-embed-text" \
    || FAILS+=("ollama: nomic-embed-text 모델 없음")
}
check_slot() {
  local active
  active="$(psql "${DATABASE_URL:-postgres://vigor@127.0.0.1:5432/omnis}" -Atc \
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
