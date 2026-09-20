#!/bin/bash
# 채널 시크릿 하나를 macOS Keychain에 저장한다. 값은 프롬프트로만 받는다 —
# 셸 히스토리에 남지 않는다(A6 §9). 이름은 A1 §1.3 / A6 §9 스킴 그대로:
#   omnis.<channel>.<kind>.<external_id>  (예: omnis.slack.xoxb.T0XXXXXXX)
#
# 사용법: tools/auth-kit/keychain-add.sh <item> [account]
#   item    Keychain service 이름 (필수)
#   account 생략 시 281932556+jinhologankim@users.noreply.github.com (Logan 본인 식별용, A6 §9)
#
# GUI 세션에서만 동작한다 — SSH 셸(Background 세션)에서는 security가
# "User interaction is not allowed"로 거절한다(ops/mini/RUNBOOK.md §4).
set -euo pipefail

item="${1:?사용법: keychain-add.sh <item> [account]}"
account="${2:-281932556+jinhologankim@users.noreply.github.com}"

read -r -s -p "Value for $item (account=$account): " secret
echo
if [ -z "$secret" ]; then
  echo "빈 값 — 저장하지 않음" >&2
  exit 1
fi

security add-generic-password -U -s "$item" -a "$account" -w "$secret"
echo "저장됨: $item (account=$account)"
