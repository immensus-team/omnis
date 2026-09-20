#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/ops/scripts/healthcheck-ping.sh"
FAKE_BIN="$(mktemp -d)"
trap 'rm -rf "$FAKE_BIN"' EXIT

# 가짜 security: 매 서비스마다 "not found"(healthchecks uuid 미설정 상태를 흉내낸다).
cat > "$FAKE_BIN/security" <<'FAKESEC'
#!/bin/bash
echo "no such keychain item" >&2
exit 44
FAKESEC
chmod +x "$FAKE_BIN/security"
export PATH="$FAKE_BIN:$PATH"

# 1) healthchecks uuid가 하나도 없어도 --check는 "설정 없음"을 경고만 하고 exit 0이어야 한다
#    (신규 설치 직후에도 스크립트 자체는 안전하게 돌아야 한다 — 실제 핑 실패와는 다른 상태).
"$SCRIPT" --check
echo "ok: --check succeeds even with zero configured jobs (reports, does not ping)"

out="$("$SCRIPT" --check)"
echo "$out" | grep -q "15 jobs configured" || { echo "FAIL: expected 15 jobs, got: $out" >&2; exit 1; }
echo "ok: --check reports exactly 15 configured jobs"

# 4) 시크릿처럼 보이는 값(sk-, xoxb-, 40자+ 토큰)이 샘플 로그 라인에 없는지 확인한다(계약 §9).
sample_log='{"ts":"2026-09-20T00:00:00Z","level":"info","pkg":"@omnis/kernel","msg":"job ok","trace_id":null}'
if echo "$sample_log" | grep -qE 'sk-[A-Za-z0-9]{20,}|xox[bp]-[A-Za-z0-9-]{10,}'; then
  echo "FAIL: sample log line looks like it leaks a secret" >&2; exit 1
fi
echo "ok: sample log line has no secret-shaped value"
echo "PASS"
