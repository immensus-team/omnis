#!/bin/bash
# US-B43: mini boot checklist. Read-only — it prints only the failing items and fixes nothing (A6 §2).
# US-C18 adds the capture-channel probes at the end. Each one is inert until its channel is switched on,
# so preflight stays green on a mini where Phase C has not gone live yet.
set -uo pipefail
FAILS=()

TOML="${OMNIS_LOCAL_AGENT_TOML:-$HOME/.omnis/local-agent.toml}"

# US-C18. Capture is opt-in per host (C-D3): a `[[capture]]` block in the TOML is the switch. The pattern
# is anchored and so rejects a leading `#`, which is what keeps the commented example block that install.sh
# copies from counting as enabled.
capture_enabled() {
  grep -qE "^[[:space:]]*channel[[:space:]]*=[[:space:]]*\"$1\"" "$TOML" 2>/dev/null
}
# Beeper/WhatsApp is a hub-side adapter rather than a `[[capture]]` channel, so the account row itself is
# its gate. A DB that is down reads as "no row" and skips the probe — check_slot below is the check that
# actually reports a broken Postgres.
whatsapp_account() {
  psql "${DATABASE_URL:-postgres://$(id -un)@127.0.0.1:5432/omnis}" -Atc \
    "select 1 from accounts where channel = 'whatsapp' limit 1" 2>/dev/null | grep -q 1
}

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

# --- US-C18 capture channels. Each probe prints a `skip:` note instead of failing while its channel is off. ---
check_kakaotalk() {
  capture_enabled kakaotalk \
    || { echo 'skip: KakaoTalk.app (no [[capture]] channel = "kakaotalk")'; return 0; }
  pgrep -x KakaoTalk >/dev/null 2>&1 \
    || FAILS+=("KakaoTalk.app not running (kmsg reads its UI through AX, A1 §2.8)")
}
check_kmsg_ax() {
  capture_enabled kakaotalk \
    || { echo 'skip: kmsg Accessibility (no [[capture]] channel = "kakaotalk")'; return 0; }
  # `kmsg status` exits non-zero when the process that spawns it is not AX-trusted. Grant it to the node
  # binary that run.sh execs, not to kmsg itself — that node process is the one asking (A1 §2.8).
  kmsg status --json >/dev/null 2>&1 \
    || FAILS+=("kmsg has no Accessibility trust (grant it to the node binary that runs local-agent)")
}
check_beeper() {
  whatsapp_account || { echo "skip: Beeper Desktop API (no whatsapp account row)"; return 0; }
  lsof -nP -iTCP@127.0.0.1:23373 -sTCP:LISTEN >/dev/null 2>&1 \
    || FAILS+=("Beeper Desktop API not listening on 127.0.0.1:23373")
}
check_linkedin_profile() {
  capture_enabled linkedin \
    || { echo 'skip: LinkedIn profile (no [[capture]] channel = "linkedin")'; return 0; }
  [ -d "$HOME/.omnis/linkedin-profile" ] \
    || FAILS+=("LinkedIn Playwright profile missing: ~/.omnis/linkedin-profile")
}

check_filevault
check_autologin
check_pmset
check_autorestart
check_launchagents
check_ollama
check_slot
check_kakaotalk
check_kmsg_ax
check_beeper
check_linkedin_profile

if [ "${#FAILS[@]}" -eq 0 ]; then
  echo "ok: preflight passed"
  exit 0
fi
printf 'FAIL: %s\n' "${FAILS[@]}" >&2
exit 1
