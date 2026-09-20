#!/bin/bash
# US-B16: Web Push VAPID 키쌍 생성 + Keychain 저장(A6 §9 회전 절차의 (1)~(2)).
# web-push npm 패키지 없이 node:crypto로 직접 만든다 — VAPID는 P-256 EC 키쌍일 뿐이다.
# 회전 절차 전체 6단계는 ops/mini/RUNBOOK.md "Web Push VAPID 키" 참조.
set -euo pipefail

ACCOUNT="281932556+jinhologankim@users.noreply.github.com"
PUB_SERVICE="omnis.webpush.vapid_public"
PRIV_SERVICE="omnis.webpush.vapid_private"

kc_get() { security find-generic-password -s "$1" -a "$ACCOUNT" -w 2>/dev/null; }
# NOTE: `security`는 값을 argv로만 받는다(`-w`를 값 없이 끝에 두면 tty 프롬프트라 스크립트에서 못 쓴다).
# 따라서 이 한 줄 동안 private key가 같은 머신의 `ps`에 보인다. 출력·로그·커밋에는 남지 않는다.
kc_set() { security add-generic-password -s "$1" -a "$ACCOUNT" -w "$2" -U >/dev/null; }

gen_keys() {
  # stdout 2줄: 1행 public(base64url uncompressed point), 2행 private(base64url d).
  # SPKI DER의 마지막 65바이트 = uncompressed EC point(0x04 + 32바이트 x + 32바이트 y).
  # P-256 SPKI 헤더 길이가 고정이라 안정적으로 뒤에서 자를 수 있다(node:crypto 표준 동작).
  node -e '
    const crypto = require("node:crypto");
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const pubRaw = publicKey.export({ type: "spki", format: "der" }).subarray(-65);
    const d = privateKey.export({ format: "jwk" }).d;
    process.stdout.write(
      pubRaw.toString("base64url") + "\n" +
      Buffer.from(d, "base64url").toString("base64url") + "\n"
    );
  '
}

do_check() {
  local pub priv
  pub="$(kc_get "$PUB_SERVICE")" || { echo "missing $PUB_SERVICE" >&2; return 1; }
  priv="$(kc_get "$PRIV_SERVICE")" || { echo "missing $PRIV_SERVICE" >&2; return 1; }
  [ "${#pub}" -ge 80 ] || { echo "vapid public key looks too short (${#pub} chars)" >&2; return 1; }
  [ "${#priv}" -ge 40 ] || { echo "vapid private key looks too short (${#priv} chars)" >&2; return 1; }
  echo "ok: vapid keys present ($PUB_SERVICE, $PRIV_SERVICE)"
}

do_generate() {
  local force="${1:-}" have=0
  # 공개/비밀 둘 다 본다 — 한쪽만 남은 반쪽 상태를 "이미 있음"으로 뭉개지 않는다.
  if kc_get "$PUB_SERVICE"  >/dev/null 2>&1; then have=$((have + 1)); fi
  if kc_get "$PRIV_SERVICE" >/dev/null 2>&1; then have=$((have + 2)); fi
  if [ "$force" != "--force" ] && [ "$have" -ne 0 ]; then
    case "$have" in
      3) echo "vapid keys already exist — use --force to rotate (A6 §9 회전 절차)" >&2 ;;
      1) echo "half-written keychain: $PUB_SERVICE only. --force replaces BOTH entries" >&2 ;;
      2) echo "half-written keychain: $PRIV_SERVICE only. --force replaces BOTH entries" >&2 ;;
    esac
    exit 1
  fi
  local keys pub priv
  keys="$(gen_keys)"           # argv로 넘기지 않는다(ps 노출 방지) — 2줄 문자열로만 다룬다
  pub="${keys%%$'\n'*}"
  priv="${keys##*$'\n'}"
  kc_set "$PUB_SERVICE" "$pub"
  kc_set "$PRIV_SERVICE" "$priv"
  echo "vapid keys stored: $PUB_SERVICE, $PRIV_SERVICE"
}

case "${1:-}" in
  --check) do_check ;;
  --force) do_generate --force ;;
  "") do_generate ;;
  *) echo "usage: gen-vapid.sh [--check|--force]" >&2; exit 64 ;;
esac
