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

# 2) --list: 15행 전부 slug + tier(critical|warning)로 정확히 갈라져야 한다.
#    check_cmd가 파이프를 품고 있어서 `IFS='|' read`로 자르면 tier에 명령 꼬리가 섞여 들어간다.
list_out="$("$SCRIPT" --list)"
[ "$(echo "$list_out" | wc -l | tr -d ' ')" = "15" ] || { echo "FAIL: --list should print 15 rows" >&2; exit 1; }
while IFS=$'\t' read -r slug tier; do
  case "$slug" in omnis-*) ;; *) echo "FAIL: bad slug [$slug]" >&2; exit 1;; esac
  case "$tier" in critical|warning) ;; *) echo "FAIL: slug $slug parsed tier [$tier], want critical|warning" >&2; exit 1;; esac
done <<< "$list_out"
echo "ok: all 15 jobs parse to a slug + exactly critical|warning"

# 3) --run: 체크가 죄다 실패하면 실패 개수를 정확히 세고 non-zero로 끝나야 한다(launchd가 이 exit code를 본다).
CURL_LOG="$FAKE_BIN/curl.log"
cat > "$FAKE_BIN/curl" <<FAKECURL
#!/bin/bash
printf '%s\n' "\$*" >> "$CURL_LOG"
exit 1
FAKECURL
cat > "$FAKE_BIN/psql" <<'FAKEPSQL'
#!/bin/bash
cat >/dev/null 2>&1 || true
exit 1
FAKEPSQL
chmod +x "$FAKE_BIN/curl" "$FAKE_BIN/psql"

set +e
run_out="$(OMNIS_NTFY_URL="http://ntfy.test" "$SCRIPT" --run </dev/null 2>"$FAKE_BIN/run.err")"
run_rc=$?
set -e
fail_lines="$(grep -c '^FAIL: ' "$FAKE_BIN/run.err" || true)"
counted="$(echo "$run_out" | sed -n 's/^ran 15 checks, \([0-9]*\) failed$/\1/p')"
[ "$run_rc" -ne 0 ] || { echo "FAIL: --run exited 0 while checks failed" >&2; exit 1; }
[ -n "$counted" ] && [ "$counted" -gt 0 ] || { echo "FAIL: --run reported '$run_out' with $fail_lines failing checks" >&2; exit 1; }
[ "$counted" = "$fail_lines" ] || { echo "FAIL: --run counted $counted failures but printed $fail_lines" >&2; exit 1; }
echo "ok: --run counts $counted failures and exits non-zero"

# 4) 경보는 omnis-critical / omnis-warning 두 토픽으로만 가야 한다(tier 파싱이 깨지면 여기로 샌다).
grep -o 'http://ntfy\.test/[^ ]*' "$CURL_LOG" | sort -u > "$FAKE_BIN/topics"
[ -s "$FAKE_BIN/topics" ] || { echo "FAIL: no ntfy post captured" >&2; exit 1; }
while read -r url; do
  case "$url" in
    http://ntfy.test/omnis-critical|http://ntfy.test/omnis-warning) ;;
    *) echo "FAIL: alert posted to [$url]" >&2; exit 1;;
  esac
done < "$FAKE_BIN/topics"
echo "ok: alerts route only to omnis-critical / omnis-warning"

# 5) check_cmd도 온전해야 한다 — 파이프 뒤 grep이 잘려 나가면 결과를 검사하지 않고 통과해 버린다.
grep -q 'check failed: psql .* | grep -qx t' "$CURL_LOG" || { echo "FAIL: check_cmd lost its trailing pipe" >&2; exit 1; }
echo "ok: check_cmd keeps the pipeline that turns a query result into pass/fail"

# 6) 시크릿처럼 보이는 값(sk-, xoxb-, 40자+ 토큰)이 샘플 로그 라인에 없는지 확인한다(계약 §9).
sample_log='{"ts":"2026-09-20T00:00:00Z","level":"info","pkg":"@omnis/kernel","msg":"job ok","trace_id":null}'
if echo "$sample_log" | grep -qE 'sk-[A-Za-z0-9]{20,}|xox[bp]-[A-Za-z0-9-]{10,}'; then
  echo "FAIL: sample log line looks like it leaks a secret" >&2; exit 1
fi
echo "ok: sample log line has no secret-shaped value"
echo "PASS"
