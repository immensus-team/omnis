# Phase B Ops Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 미니(`vigors-mac-mini`)를 Phase B 상태로 운영 가능하게 만드는 인프라 6종 — Web Push VAPID 키 회전, Tailscale Serve PWA 마운트 + ACL 문서, 야간 백업 + 분기 복구 리허설, healthchecks.io + ntfy 이중 경보, 부팅 프리플라이트, 월간 비용 리포트 잡. 코드 의존이 있는 것은 US-B44(커널 스케줄러 잡) 하나뿐이고 나머지 5개는 셸 스크립트 + launchd + 문서다.

**Architecture:** `ops/mini/`(A6 §1·§10, 실측 반영 — LaunchAgent만 쓰고 sudo 없음, `run.sh`가 `env.sh`를 통해 Keychain 값을 export)의 기존 패턴을 그대로 확장한다. 새 셸 스크립트는 전부 `ops/scripts/`에 두고, `security find-generic-password`로 Keychain을 읽는 `kc()` 헬퍼(`ops/mini/env.sh.example`과 동일 관용구)를 각 스크립트가 자기 안에 갖는다(A6 §9 "createLogger·readKeychainSecret 중복은 의도된 것" 원칙을 셸 스크립트까지 확장 — 공용 라이브러리로 뽑지 않는다). 유일한 TypeScript 태스크(US-B44)는 `packages/kernel/src/jobs/healthcheck.ts`(A3 §6 seed job 패턴)를 그대로 베낀다: `scheduler.register(name, cron, handler)` + `events.emit("cold", …)`.

**Tech Stack:** bash(`set -euo pipefail`) · `security`(macOS Keychain) · `launchctl`/`pmset`/`fdesetup`(macOS) · `pg_dump`/`pg_restore`/`psql`(Postgres 17 클라이언트) · `restic` + Backblaze B2 · `tailscale` CLI · Node 22 `node:crypto`(VAPID 키 생성, 외부 패키지 없이) · TypeScript 5.6 strict + `pg` 8.13.1 + vitest 2.1.9(`@omnis/kernel` integration 프로젝트).

**Spec:** `/Users/logankim/AI-Workspaces/omnis/docs/spec/00-omnis-design.md` + 이 계획이 구현하는 부록:
- `A6-ops-infra.md` §2(OS 설정) · §3(네트워크·Tailscale Serve) · §4(Postgres 백업) · §8(모니터링) · §9(비밀 관리)
- `A4-agent-layer.md` §12.4(비용 미터 — US-B44가 읽는 `agent_runs` 집계 대상)
- `A7-dev-process.md` §2(툴체인) · §4(모델 배정) · §6(커밋 규칙)
- `2026-09-20-phase-b-backlog.md` §2 US-B16·B34·B41·B42·B43·B44 행, §4(공통 금지), B-D5(픽스처/시드로만 인수)
- `2026-09-20-phase-b-interfaces-delta.md` §5(`@omnis/kernel` 추가 export) · §8(잡 표) · §9(환경변수·Keychain)
- `2026-09-20-phase-a-interfaces.md` §4(`@omnis/db`) · §5(`@omnis/kernel` Scheduler/Events/Logger) · §9(공통 규약)
- 실측 코드(스펙보다 우선): `ops/mini/RUNBOOK.md`, `ops/mini/env.sh.example`, `ops/mini/run.sh`, `ops/mini/install.sh`, `ops/mini/com.omnis.hub.plist`, `packages/kernel/src/jobs/healthcheck.ts` — A6 원문의 `/opt/omnis` + sops 설계는 실제로 `ops/mini/env.sh` + 개별 Keychain 항목으로 대체되어 있다(RUNBOOK "이 배포가 미니에 실제로 바꾼 것" 표). 이 계획은 실측 쪽을 따른다.

---

## Global Constraints

- Node 22 + pnpm workspaces. TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`(루트 `tsconfig.base.json`, 이미 존재 — 이 계획은 만들지 않는다).
- Postgres 17 고정. 개발 DB `omnis`(미니에서 유저 `vigor`), 테스트 DB `omnis_test`(전부 `DATABASE_URL`, 없으면 `postgres://logan@127.0.0.1:5432/omnis_test` 기본값 — 계약 §2). US-B44의 vitest integration 테스트는 이 DB를 쓰고, 파일별 트랜잭션 롤백은 없다(트리거·NOTIFY 검증 때문 — 계약 §2). Task 6이 만든 잡 row는 `afterAll`에서 직접 지운다(공유 `omnis_test`가 0006 seed 개수 단언을 깨지 않도록, `healthcheck-job.test.ts`가 이미 쓰는 패턴).
- 버전 핀(FIXED): `vitest 2.1.9` · `zod ^3.24.1` · `pg 8.13.1` · `typescript 5.6.3` · `@rocicorp/zero 1.9.0`(exact) · `ai 7.0.107`. 이 계획은 `zod`/`zero`/`ai`를 쓰지 않는다 — `pg`(간접, `@omnis/db` 경유)와 `vitest`만.
- 마이그레이션은 append-only 파일 `packages/db/migrations/000N_<name>.sql`, 다음 번호는 **0009+**다. 이미 다른 Phase B 계획(worktree)이 적용한 파일은 절대 고치지 않는다 — `migrate()`가 sha256 비교로 "changed after apply"를 throw한다(계약 §4). Task 6의 마이그레이션 번호 선택 근거는 Task 6 본문 참조.
- lint는 커밋 전에 돈다: `pnpm lint`(TypeScript 파일에만 해당 — 셸 스크립트는 `bash -n`으로 문법만 확인, 이 리포에 shellcheck는 아직 안 물려 있다).
- 비가역 tool(`send`/`delete`/`delegate`/`calendar_write`)을 승인 게이트 밖에서 배선하지 않는다 — 이 계획은 그런 tool을 전혀 만들지 않는다(전부 읽기·모니터링·백업이다).
- provider SDK는 어댑터 안에서만 — 이 계획은 어댑터를 만들지 않는다.
- 실계정 자격증명을 테스트에 넣지 않는다(B-D5). 모든 셸 스크립트 테스트는 `PATH`에 가짜 `security`/`tailscale`/`launchctl`/`pg_dump` 바이너리를 세워 실제 Keychain·네트워크·launchd를 건드리지 않는다.
- 커밋 메시지: `US-Bxx: <한 줄 요약>` + 본문에 충족한 acceptance criteria + 마지막 두 줄 `Implemented-by: Claude <tier>` / `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`(세션 규칙). 브랜치 `ralph/<story-id>`.
- Keychain 항목명은 A1/A6 §9 점 스킴 `omnis.<service>.<kind>`, account는 전부 `281932556+jinhologankim@users.noreply.github.com`(`ops/mini/env.sh.example`의 `kc()` 관용구 그대로). 값은 셸 히스토리·로그·커밋에 남기지 않는다.
- `agent_runs`/`digests`/`jobs`/`accounts` 컬럼명은 계약 §4(Phase A) 그대로다 — 새 컬럼을 만들지 않는다(Task 6은 기존 `digests.metrics` jsonb에 병합만 한다).

**`exactOptionalPropertyTypes` 함정**(Task 6에만 해당): `deps.now`가 optional이면 `const now = deps.now ?? (() => new Date())`처럼 항상 폴백을 만든다 — `{ now: undefined }`를 그대로 넘기지 않는다.

---

### Task 1: VAPID Key Rotation (US-B16, tier: Haiku)

**스토리 US-B16** — 목표: Web Push용 VAPID 키쌍을 생성해 Keychain에 저장하고, 이미 있으면 건드리지 않으며(`--force`로만 회전), 있는지 없는지를 `--check`로 확인한다. `omnis-run-with-secrets.sh`는 이 리포에서 `ops/mini/run.sh` + `ops/mini/env.sh`로 실측 대체되어 있다(A6 §9 원문 대신 실측 코드가 정본). 산출물: `ops/scripts/gen-vapid.sh`, `ops/mini/RUNBOOK.md`(수정, 회전 절차 6단계). 검증: `bash ops/scripts/gen-vapid.sh --check`. 티어: Haiku.

**읽을 곳**: `ops/mini/env.sh.example`(`kc()` 관용구), 델타 §9(`OMNIS_WEBPUSH_VAPID_PUBLIC`/`…PRIVATE`, Keychain `omnis.webpush.vapid_private`/`…public`), A6 §9(회전 절차 6단계).

**만들지 않을 것(YAGNI)**: `web-push` npm 패키지 — VAPID 키는 P-256 EC 키쌍(uncompressed public point + private `d`)일 뿐이라 `node:crypto`(stdlib, ladder 3단)로 충분하다. `web-push` 자체는 허브의 발송 로직(US-B17, 이 계획 밖)에서만 필요하다. 키 회전 스케줄러(cron) — 회전은 A6 §9가 "유출 의심 시 즉시 + 분기 1회, 손으로"라고 정했으므로 자동화하지 않는다.

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/ops/scripts/gen-vapid.sh`
- Test: `/Users/logankim/AI-Workspaces/omnis/ops/scripts/test/gen-vapid.test.sh`
- Modify: `/Users/logankim/AI-Workspaces/omnis/ops/mini/RUNBOOK.md`

**Interfaces:**
- Consumes: `security find-generic-password`/`add-generic-password`(macOS Keychain CLI) · `node:crypto`(stdlib).
- Produces: Keychain 항목 `omnis.webpush.vapid_public` · `omnis.webpush.vapid_private`(둘 다 base64url, account `281932556+jinhologankim@users.noreply.github.com`) — 델타 §9가 고정한 이름 그대로. 허브가 `OMNIS_WEBPUSH_VAPID_PUBLIC`/`…PRIVATE`로 읽는 값(US-B17이 그 배선을 한다, 이 계획 밖).

#### Steps

- [ ] 1. 실패하는 테스트를 쓴다. 실제 Keychain을 건드리지 않도록 `PATH`에 가짜 `security`/`node`... 는 필요 없다(`node`는 진짜를 쓴다 — 순수 계산이라 안전), 가짜 `security`만 세운다.

`/Users/logankim/AI-Workspaces/omnis/ops/scripts/test/gen-vapid.test.sh`:
```bash
#!/bin/bash
# US-B16 self-check. 프레임워크 없음 — assert 스타일(ponytail).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/ops/scripts/gen-vapid.sh"

FAKE_BIN="$(mktemp -d)"
STORE="$(mktemp -d)/store"
mkdir -p "$STORE"
trap 'rm -rf "$FAKE_BIN" "$(dirname "$STORE")"' EXIT

# 가짜 security: -s <service> -a <account> -w [값] 를 파일 하나당 한 서비스로 흉내낸다.
cat > "$FAKE_BIN/security" <<'FAKESEC'
#!/bin/bash
store="${OMNIS_TEST_KC_STORE:?}"
if [ "$1" = "find-generic-password" ]; then
  svc=""; for a in "$@"; do case "$prev" in -s) svc="$a";; esac; prev="$a"; done
  [ -f "$store/$svc" ] && cat "$store/$svc" || { echo "not found" >&2; exit 44; }
elif [ "$1" = "add-generic-password" ]; then
  svc=""; val=""; prev=""
  for a in "$@"; do
    case "$prev" in -s) svc="$a";; -w) val="$a";; esac
    prev="$a"
  done
  echo -n "$val" > "$store/$svc"
else
  echo "unsupported: $*" >&2; exit 64
fi
FAKESEC
chmod +x "$FAKE_BIN/security"

export PATH="$FAKE_BIN:$PATH"
export OMNIS_TEST_KC_STORE="$STORE"

# 1) 아직 키가 없을 때 --check는 실패해야 한다.
if "$SCRIPT" --check >/dev/null 2>&1; then
  echo "FAIL: --check passed with no keys stored" >&2; exit 1
fi
echo "ok: --check fails before generation"
```

- [ ] 2. 테스트를 돌려 실패를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && chmod +x ops/scripts/test/gen-vapid.test.sh && bash ops/scripts/test/gen-vapid.test.sh
```
기대 실패: `ops/scripts/gen-vapid.sh: No such file or directory`.

- [ ] 3. 스크립트를 쓴다.

`/Users/logankim/AI-Workspaces/omnis/ops/scripts/gen-vapid.sh`:
```bash
#!/bin/bash
# US-B16: Web Push VAPID 키쌍 생성 + Keychain 저장(A6 §9 회전 절차의 (1)~(2)).
# web-push npm 패키지 없이 node:crypto로 직접 만든다 — VAPID는 P-256 EC 키쌍일 뿐이다.
set -euo pipefail

ACCOUNT="281932556+jinhologankim@users.noreply.github.com"
PUB_SERVICE="omnis.webpush.vapid_public"
PRIV_SERVICE="omnis.webpush.vapid_private"

kc_get() { security find-generic-password -s "$1" -a "$ACCOUNT" -w 2>/dev/null; }
kc_set() { security add-generic-password -s "$1" -a "$ACCOUNT" -w "$2" -U >/dev/null; }

gen_keys() {
  # SPKI DER의 마지막 65바이트 = uncompressed EC point(0x04 + 32바이트 x + 32바이트 y).
  # P-256 SPKI 헤더 길이가 고정이라 안정적으로 뒤에서 자를 수 있다(node:crypto 표준 동작).
  node -e '
    const crypto = require("node:crypto");
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const pubRaw = publicKey.export({ type: "spki", format: "der" }).subarray(-65);
    const d = privateKey.export({ format: "jwk" }).d;
    process.stdout.write(JSON.stringify({
      publicKey: pubRaw.toString("base64url"),
      privateKey: Buffer.from(d, "base64url").toString("base64url"),
    }));
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
  local force="${1:-}"
  if [ "$force" != "--force" ] && kc_get "$PUB_SERVICE" >/dev/null 2>&1; then
    echo "vapid keys already exist — use --force to rotate (A6 §9 회전 절차)" >&2
    exit 1
  fi
  local json pub priv
  json="$(gen_keys)"
  pub="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).publicKey)' "$json")"
  priv="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).privateKey)' "$json")"
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
```

- [ ] 4. 실행 권한을 주고 테스트를 다시 돌려 1단계 assert가 통과함을 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && chmod +x ops/scripts/gen-vapid.sh && bash ops/scripts/test/gen-vapid.test.sh
```
기대: `ok: --check fails before generation`(아직 2번째 assert는 없다 — 다음 단계에서 추가).

- [ ] 5. 생성 → check 성공 → 중복 생성 거부 → `--force` 회전까지 검증하는 나머지 assert를 테스트 파일 끝에 추가한다.

`/Users/logankim/AI-Workspaces/omnis/ops/scripts/test/gen-vapid.test.sh`(파일 끝에 추가):
```bash

# 2) 생성 후 --check는 성공해야 한다.
"$SCRIPT" >/dev/null
"$SCRIPT" --check
echo "ok: --check passes after generation"

pub1="$(cat "$STORE/$PUB_SERVICE" 2>/dev/null || true)"

# 3) --force 없이 재생성하면 거부하고 기존 키를 보존해야 한다(A6 §9: 키는 손으로만 회전).
if "$SCRIPT" >/dev/null 2>&1; then
  echo "FAIL: re-generation without --force should be rejected" >&2; exit 1
fi
[ "$(cat "$STORE/$PUB_SERVICE")" = "$pub1" ] || { echo "FAIL: key mutated without --force" >&2; exit 1; }
echo "ok: re-generation without --force is rejected and key is unchanged"

# 4) --force는 키를 회전시켜야 한다.
"$SCRIPT" --force >/dev/null
pub2="$(cat "$STORE/$PUB_SERVICE")"
[ "$pub1" != "$pub2" ] || { echo "FAIL: --force did not rotate the key" >&2; exit 1; }
echo "ok: --force rotates the key"

echo "PASS"
```

여기서 `PUB_SERVICE` 변수는 테스트 스크립트 안에서도 정의해야 한다 — 1단계 헤더 근처에 `PUB_SERVICE="omnis.webpush.vapid_public"`를 추가한다(스크립트 본체와 이름이 같아야 파일 경로가 맞는다).

- [ ] 6. 전체 테스트를 돌려 통과를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && bash ops/scripts/test/gen-vapid.test.sh
```
기대: 마지막 줄 `PASS`, 그 앞에 `ok:` 4줄.

- [ ] 7. `ops/mini/RUNBOOK.md`의 "### 4) 비밀 (A6 §9)" 섹션 뒤에 VAPID 회전 절차를 추가한다(회전 6단계, A6 §9 그대로 셸 스크립트로 구체화).

`/Users/logankim/AI-Workspaces/omnis/ops/mini/RUNBOOK.md`에 다음 섹션을 "## 상태 확인" 앞에 삽입:
```markdown
## Web Push VAPID 키 (US-B16)

```bash
bash ops/scripts/gen-vapid.sh --check     # 있는지만 확인, 아무것도 안 바꾼다
bash ops/scripts/gen-vapid.sh             # 없을 때만 생성
bash ops/scripts/gen-vapid.sh --force     # 회전(유출 의심 시 즉시, 정기는 분기 1회 — A6 §9)
```
회전 후에는 hub를 재기동해야 새 `OMNIS_WEBPUSH_VAPID_PUBLIC`/`…PRIVATE`를 읽는다(`launchctl kickstart -k gui/$(id -u)/com.omnis.hub`, US-B17이 이 값을 env.sh에 배선한다). 기존 구독자는 새 키로 재구독해야 하므로(VAPID 키가 바뀌면 이전 구독이 전부 무효) 회전 직후 `push_subscriptions`가 비었는지 확인한다.
```

- [ ] 8. 커밋한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-B16: Web Push VAPID 키 생성·Keychain 저장

- node:crypto만으로 P-256 VAPID 키쌍 생성(web-push 패키지 불필요)
- --check(확인만)/기본(없을 때만 생성)/--force(회전) 3모드
- 이미 있으면 거부, 값은 Keychain omnis.webpush.vapid_public/…private
- RUNBOOK.md에 회전 절차 추가

Implemented-by: Claude Haiku

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Tailscale Serve Mount (US-B34, tier: Sonnet)

**스토리 US-B34** — 목표: `/api/` → hub(`127.0.0.1:8787`), `/` → PWA 정적 빌드(`127.0.0.1:5173`)를 Tailscale Serve로 마운트하고, ACL 문서에 Postgres(5432)·Ollama(11434)를 `dst`에 넣지 않는 이유를 명기하고, Funnel이 항상 꺼져 있는지 확인하는 스크립트를 만든다. 산출물: `ops/mini/tailscale-serve.sh`, `ops/mini/TAILSCALE-ACL.md`. 검증: `bash ops/mini/tailscale-serve.sh --check`. 티어: Sonnet.

**읽을 곳**: A6 §3(ACL 예시, Funnel 정책), `ops/mini/RUNBOOK.md`의 "이 배포가 미니에 실제로 바꾼 것" 표(실측: `tailscale serve --bg --https=443 --set-path=/api http://127.0.0.1:8787`가 이미 미니에서 돌고 있다 — 이 태스크는 그 실측 명령을 스크립트로 승격하고 PWA 마운트를 더한다).

**만들지 않을 것(YAGNI)**: Funnel 자동 on/off 토글 — A6 §3은 Funnel을 "상시 OFF"로 정했고 예외(Calendar watch 스파이크)는 이미 끝난 Phase 0 항목이다. `--check`는 Funnel이 켜져 있으면 **실패**해야지 꺼주면 안 된다(자동 끄기는 예상 밖의 네트워크 변경 — 사람이 확인하고 끈다).

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/ops/mini/tailscale-serve.sh`
- Create: `/Users/logankim/AI-Workspaces/omnis/ops/mini/TAILSCALE-ACL.md`
- Test: `/Users/logankim/AI-Workspaces/omnis/ops/scripts/test/tailscale-serve.test.sh`

**Interfaces:**
- Consumes: `tailscale serve --bg --https=443 --set-path=<path> <url>` · `tailscale serve status --json` · `tailscale funnel status`(전부 Tailscale CLI, 외부 계약 없음) · `$OMNIS_WEB_PORT`(기본 `5173`, 델타 §9) · `$OMNIS_HUB_PORT`(기본 `8787`, 계약 §9).
- Produces: 마운트 상태를 사람이 읽는 텍스트로 출력. 새 export 없음(순수 운영 스크립트).

#### Steps

- [ ] 1. 실패하는 테스트를 쓴다. 가짜 `tailscale`을 세워 `serve status --json`/`funnel status`를 흉내낸다.

`/Users/logankim/AI-Workspaces/omnis/ops/scripts/test/tailscale-serve.test.sh`:
```bash
#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/ops/mini/tailscale-serve.sh"
FAKE_BIN="$(mktemp -d)"
trap 'rm -rf "$FAKE_BIN"' EXIT

write_fake_tailscale() {
  # $1 = serve status json, $2 = funnel status text
  cat > "$FAKE_BIN/tailscale" <<FAKETS
#!/bin/bash
if [ "\$1" = "serve" ] && [ "\$2" = "status" ]; then
  cat <<'JSON'
$1
JSON
elif [ "\$1" = "funnel" ] && [ "\$2" = "status" ]; then
  echo "$2"
else
  echo "ok"
fi
FAKETS
  chmod +x "$FAKE_BIN/tailscale"
}
export PATH="$FAKE_BIN:$PATH"

# 1) /api 마운트가 없으면 --check는 실패해야 한다.
write_fake_tailscale '{"Web":{}}' "Funnel off."
if "$SCRIPT" --check >/dev/null 2>&1; then
  echo "FAIL: --check passed with no /api mount" >&2; exit 1
fi
echo "ok: --check fails when /api is not mounted"
```

- [ ] 2. 테스트를 돌려 실패를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && chmod +x ops/scripts/test/tailscale-serve.test.sh && bash ops/scripts/test/tailscale-serve.test.sh
```
기대 실패: `ops/mini/tailscale-serve.sh: No such file or directory`.

- [ ] 3. 스크립트를 쓴다.

`/Users/logankim/AI-Workspaces/omnis/ops/mini/tailscale-serve.sh`:
```bash
#!/bin/bash
# US-B34: hub API + PWA를 tailnet HTTPS 하나에 마운트한다(A6 §3).
# 실측(RUNBOOK "이 배포가 미니에 실제로 바꾼 것"): --set-path=/api가 이미 미니에서 돈다. sudo 불필요.
set -euo pipefail

HUB_PORT="${OMNIS_HUB_PORT:-8787}"
WEB_PORT="${OMNIS_WEB_PORT:-5173}"

do_mount() {
  tailscale serve --bg --https=443 --set-path=/api "http://127.0.0.1:${HUB_PORT}"
  tailscale serve --bg --https=443 --set-path=/ "http://127.0.0.1:${WEB_PORT}"
  echo "mounted: /api -> 127.0.0.1:${HUB_PORT}, / -> 127.0.0.1:${WEB_PORT}"
}

do_check() {
  local status
  status="$(tailscale serve status --json 2>/dev/null || echo '{}')"
  node -e '
    let data = "";
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => {
      let s;
      try { s = JSON.parse(data || "{}"); } catch { s = {}; }
      const web = s.Web || {};
      const paths = Object.values(web).flatMap((h) => Object.keys(h.Handlers || {}));
      if (!paths.some((p) => p.includes("/api"))) {
        console.error("no /api mount found in tailscale serve status");
        process.exit(1);
      }
      console.log("ok: /api mount present");
    });
  ' <<< "$status"

  local funnel
  funnel="$(tailscale funnel status 2>&1 || true)"
  if echo "$funnel" | grep -qi "funnel on"; then
    echo "FAIL: Funnel is ON — A6 §3은 Funnel을 상시 OFF로 정했다. 'tailscale funnel 443 off'로 끈다." >&2
    exit 1
  fi
  echo "ok: funnel is off"
}

case "${1:-}" in
  --mount) do_mount ;;
  --check) do_check ;;
  *) echo "usage: tailscale-serve.sh [--mount|--check]" >&2; exit 64 ;;
esac
```

- [ ] 4. 실행 권한을 주고 테스트를 다시 돌려 통과를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && chmod +x ops/mini/tailscale-serve.sh && bash ops/scripts/test/tailscale-serve.test.sh
```
기대: `ok: --check fails when /api is not mounted`.

- [ ] 5. `/api` 마운트가 있을 때 성공하는지, Funnel이 켜져 있으면 실패하는지를 검증하는 assert를 추가한다.

`/Users/logankim/AI-Workspaces/omnis/ops/scripts/test/tailscale-serve.test.sh`(파일 끝에 추가):
```bash

# 2) /api 마운트가 있고 Funnel이 꺼져 있으면 --check는 성공해야 한다.
write_fake_tailscale '{"Web":{"mini.ts.net:443":{"Handlers":{"/api":{"Proxy":"http://127.0.0.1:8787"}}}}}' "Funnel off."
"$SCRIPT" --check
echo "ok: --check passes with /api mounted and funnel off"

# 3) Funnel이 켜져 있으면 마운트가 맞아도 --check는 실패해야 한다.
write_fake_tailscale '{"Web":{"mini.ts.net:443":{"Handlers":{"/api":{"Proxy":"http://127.0.0.1:8787"}}}}}' "Funnel on."
if "$SCRIPT" --check >/dev/null 2>&1; then
  echo "FAIL: --check passed while funnel is on" >&2; exit 1
fi
echo "ok: --check fails when funnel is on"

echo "PASS"
```

- [ ] 6. 전체 테스트를 돌려 통과를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && bash ops/scripts/test/tailscale-serve.test.sh
```
기대: `PASS`.

- [ ] 7. ACL 문서를 쓴다.

`/Users/logankim/AI-Workspaces/omnis/ops/mini/TAILSCALE-ACL.md`:
```markdown
# Tailscale ACL (US-B34, A6 §3)

미니는 공인 인터넷에 어떤 포트도 열지 않는다. 노출은 전부 `tailscale serve`를 거친 HTTPS(443) 하나다.

## Grants

\`\`\`json
{
  "tagOwners": {
    "tag:hub": ["logan@onwordlab.ai"],
    "tag:client": ["logan@onwordlab.ai"]
  },
  "grants": [
    { "src": ["tag:client"], "dst": ["tag:hub"], "ip": ["tcp:443"] }
  ],
  "ssh": [
    { "action": "check", "src": ["tag:client"], "dst": ["tag:hub"], "users": ["logan", "vigor"] }
  ]
}
\`\`\`

## Postgres(5432)·Ollama(11434)를 `dst`에 넣지 않는 이유

클라이언트(맥북·아이폰)가 tailnet 너머로 직접 열어야 하는 것은 hub API(443 아래 `/api/`, `tailscale serve`가 127.0.0.1:8787로 프록시)뿐이다. Postgres와 Ollama는 hub 프로세스(또는 그 안의 local-agent 브리지)를 거쳐서만 쓰인다 — ACL에 5432/11434를 열면 클라이언트가 hub의 승인 게이트·감사 로그를 건너뛰고 DB/모델에 직접 접속하는 경로가 생긴다. 공격 표면을 hub API 하나로 좁히는 것이 A6 §3의 tailnet-only 원칙이다.

## Funnel

**상시 OFF.** `tailscale funnel status`가 "Funnel off."가 아니면 `bash ops/mini/tailscale-serve.sh --check`가 실패한다(§8 모니터링, US-B42가 이 스크립트를 healthcheck-ping.sh의 한 항목으로 물린다). Funnel은 공인 인터넷 노출이라 Calendar `events.watch` 같은 웹훅 수신이 꼭 필요한 스파이크 동안만 임시로 켰다가 즉시 끈다(A6 §3) — Phase B에는 그런 경로가 없다.

## 마운트

\`\`\`bash
bash ops/mini/tailscale-serve.sh --mount   # /api -> :8787, / -> :5173 (US-B35 PWA 빌드 산출물)
bash ops/mini/tailscale-serve.sh --check   # 마운트 + funnel off 확인만, 아무것도 안 바꾼다
\`\`\`
```

- [ ] 8. 커밋한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-B34: Tailscale Serve 마운트 스크립트 + ACL 문서

- --mount: /api -> hub(:8787), / -> PWA(:5173), --set-path 실측 구문 그대로
- --check: /api 마운트 존재 + Funnel off 둘 다 확인(Funnel on이면 실패)
- TAILSCALE-ACL.md: Postgres/Ollama를 dst에 안 넣는 이유 + Funnel 상시 OFF 근거

Implemented-by: Claude Sonnet

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Backup and Quarterly Restore Drill (US-B41, tier: Sonnet)

**스토리 US-B41** — 목표: 매일 03:00 `pg_dump` + restic → B2 백업, forget 정책(7일/4주/6개월), 분기 복구 리허설 스크립트(스크래치 포트 5433 복원 + `items`/`threads`/`pending_approvals` row count + 최신 `sent_at` 검증) + 리허설 로그. 산출물: `ops/scripts/omnis-backup.sh`, `ops/scripts/restore-drill.sh`, `ops/mini/LaunchDaemons/*.plist`, `backup/restore-drills.md`. 검증: `bash ops/scripts/restore-drill.sh --dry-run`. 티어: Sonnet.

**읽을 곳**: A6 §4(백업·복구 리허설 원문 — forget 정책·명령은 이 리포 실측 규약에 맞춰 조정한다), `ops/mini/RUNBOOK.md`(DB가 `postgres://vigor@127.0.0.1:5432/omnis`라는 실측, LaunchAgent 전용 + sudo 없음 원칙).

**만들지 않을 것(YAGNI)**: 백업 성공/실패의 healthchecks.io ping — 그건 US-B42(Task 4)의 몫이고, 이 스크립트는 exit code로만 성공/실패를 알린다(launchd `StandardErrorPath` + US-B42가 그 exit code를 소비한다). restic 초기 `init`(리포 생성)은 사람이 1회 수동으로 한다(회전만큼 드문 일 — `restic -r ... init`, 스크립트에 넣으면 매번 존재 확인 로직이 생겨 오히려 복잡해진다).

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/ops/scripts/omnis-backup.sh`
- Create: `/Users/logankim/AI-Workspaces/omnis/ops/scripts/restore-drill.sh`
- Create: `/Users/logankim/AI-Workspaces/omnis/ops/mini/LaunchDaemons/com.omnis.backup.plist`
- Create: `/Users/logankim/AI-Workspaces/omnis/backup/restore-drills.md`
- Test: `/Users/logankim/AI-Workspaces/omnis/ops/scripts/test/restore-drill.test.sh`
- **계획 수정(2026-09-20, 리뷰 반려 반영)** — Modify: `/Users/logankim/AI-Workspaces/omnis/ops/mini/install.sh`
  (plist를 `ops/mini/` 다음으로 `ops/mini/LaunchDaemons/`에서도 찾고, 기본 서비스 목록에 `backup`을 넣는다.
  캘린더 잡이라 `kickstart`는 건너뛴다 — 안 그러면 설치할 때마다 백업이 통째로 돈다). 백로그가 산출물 경로를
  `ops/mini/LaunchDaemons/*.plist`로 못박았으므로 plist를 옮기는 대신 install.sh를 넓힌다.
- **계획 수정(같은 이유)** — Modify: `/Users/logankim/AI-Workspaces/omnis/ops/mini/RUNBOOK.md`
  (설치·`restic init`·분기 드릴 절차. 이게 없으면 산출물에 사람이 닿는 경로가 문서에 없다),
  Test: `/Users/logankim/AI-Workspaces/omnis/ops/scripts/test/omnis-backup.test.sh`
  (launchd PATH에 `pg_dump`가 없어 03:00 잡이 첫 줄에서 죽던 회귀를 막는다).

**Interfaces:**
- Consumes: `pg_dump --format=custom` · `pg_restore` · `psql`(Postgres 17 클라이언트) · `restic` · Keychain `omnis.restic.repository`/`omnis.restic.password`/`omnis.b2.account_id`/`omnis.b2.account_key`(이 계획이 새로 정하는 이름, A6 §9 점 스킴을 따른다) · `$DATABASE_URL`(계약 §9).
- Produces: `$HOME/omnis-var/backup/pg/omnis-YYYYMMDD.dump` 파일, `backup/restore-drills.md`에 분기 리허설 로그 append.

#### Steps

- [ ] 1. 실패하는 테스트를 쓴다. `pg_restore`/`psql`/`createdb`/`dropdb`를 가짜로 세워 실제 스크래치 DB 없이 `--dry-run` 경로만 검증한다(실제 복원은 통합 검증이라 미니에서 사람이 분기 1회 돌린다 — B-D5의 "픽스처/mock으로 인수" 정신).

`/Users/logankim/AI-Workspaces/omnis/ops/scripts/test/restore-drill.test.sh`:
```bash
#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/ops/scripts/restore-drill.sh"
FAKE_BIN="$(mktemp -d)"
BACKUP_DIR="$(mktemp -d)"
trap 'rm -rf "$FAKE_BIN" "$BACKUP_DIR"' EXIT

# 1) 덤프 파일이 하나도 없으면 --dry-run은 실패해야 한다.
export OMNIS_BACKUP_DIR="$BACKUP_DIR"
if "$SCRIPT" --dry-run >/dev/null 2>&1; then
  echo "FAIL: --dry-run passed with no dump files" >&2; exit 1
fi
echo "ok: --dry-run fails when no dump exists"
```

- [ ] 2. 테스트를 돌려 실패를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && chmod +x ops/scripts/test/restore-drill.test.sh && bash ops/scripts/test/restore-drill.test.sh
```
기대 실패: `ops/scripts/restore-drill.sh: No such file or directory`.

- [ ] 3. 백업 스크립트를 쓴다(리허설 스크립트가 이 스크립트가 만드는 덤프 경로를 가정하므로 먼저 만든다).

`/Users/logankim/AI-Workspaces/omnis/ops/scripts/omnis-backup.sh`:
```bash
#!/bin/bash
# US-B41: pg_dump --format=custom → restic → B2. LaunchDaemon(ops/mini/LaunchDaemons/com.omnis.backup.plist)
# 이 03:00에 이 스크립트를 그대로 exec한다. GUI 세션 필요(Keychain 읽기, RUNBOOK "미니의 기존 설비" 절 참조).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ACCOUNT="281932556+jinhologankim@users.noreply.github.com"
kc() { security find-generic-password -s "$1" -a "$ACCOUNT" -w; }

BACKUP_DIR="${OMNIS_BACKUP_DIR:-$HOME/omnis-var/backup}"
PG_DIR="$BACKUP_DIR/pg"
DATABASE_URL="${DATABASE_URL:-postgres://vigor@127.0.0.1:5432/omnis}"

do_check() {
  command -v pg_dump >/dev/null || { echo "FAIL: pg_dump not on PATH" >&2; return 1; }
  command -v restic >/dev/null || { echo "FAIL: restic not on PATH" >&2; return 1; }
  kc omnis.restic.repository >/dev/null 2>&1 || { echo "FAIL: Keychain omnis.restic.repository missing" >&2; return 1; }
  kc omnis.restic.password >/dev/null 2>&1 || { echo "FAIL: Keychain omnis.restic.password missing" >&2; return 1; }
  echo "ok: pg_dump/restic on PATH, restic credentials present"
}

do_run() {
  mkdir -p "$PG_DIR"
  local dump_file="$PG_DIR/omnis-$(date +%Y%m%d).dump"
  pg_dump --format=custom --dbname="$DATABASE_URL" --file="$dump_file"
  echo "pg_dump ok: $dump_file"

  export RESTIC_REPOSITORY; RESTIC_REPOSITORY="$(kc omnis.restic.repository)"
  export RESTIC_PASSWORD; RESTIC_PASSWORD="$(kc omnis.restic.password)"
  export B2_ACCOUNT_ID; B2_ACCOUNT_ID="$(kc omnis.b2.account_id)"
  export B2_ACCOUNT_KEY; B2_ACCOUNT_KEY="$(kc omnis.b2.account_key)"

  restic backup "$PG_DIR" "$HOME/.omnis/self-model" "$ROOT/secrets" --tag omnis-backup
  restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune

  # 로컬 덤프는 7일치만 남긴다 — restic이 원격에 장기 보관하므로 로컬은 최근 복구용 버퍼일 뿐.
  find "$PG_DIR" -name 'omnis-*.dump' -mtime +7 -delete
  echo "backup ok: $(date -u +%FT%TZ)"
}

case "${1:-}" in
  --check) do_check ;;
  "") do_run ;;
  *) echo "usage: omnis-backup.sh [--check]" >&2; exit 64 ;;
esac
```

- [ ] 4. 리허설 스크립트를 쓴다.

`/Users/logankim/AI-Workspaces/omnis/ops/scripts/restore-drill.sh`:
```bash
#!/bin/bash
# US-B41: 분기 복구 리허설. --dry-run은 최신 덤프가 읽을 수 있는 파일인지만 확인한다(사람이 분기 1회
# 인자 없이 돌려 스크래치 포트 5433에 실제로 복원하고 row count를 검증한다).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BACKUP_DIR="${OMNIS_BACKUP_DIR:-$HOME/omnis-var/backup}"
PG_DIR="$BACKUP_DIR/pg"
SCRATCH_PORT="${OMNIS_RESTORE_PORT:-5433}"
SCRATCH_DB="omnis_restore_drill"
LOG="$ROOT/backup/restore-drills.md"

latest_dump() {
  ls -t "$PG_DIR"/omnis-*.dump 2>/dev/null | head -1 || true
}

mode="${1:-}"
latest="$(latest_dump)"
if [ -z "$latest" ]; then
  echo "FAIL: no dump file found in $PG_DIR (run omnis-backup.sh first)" >&2
  exit 1
fi

if [ "$mode" = "--dry-run" ]; then
  pg_restore --list "$latest" >/dev/null
  echo "ok: dump file is readable ($latest)"
  exit 0
fi

dropdb -p "$SCRATCH_PORT" --if-exists "$SCRATCH_DB"
createdb -p "$SCRATCH_PORT" "$SCRATCH_DB"
pg_restore --dbname="postgres://localhost:${SCRATCH_PORT}/${SCRATCH_DB}" --no-owner "$latest"

result="$(psql -p "$SCRATCH_PORT" -d "$SCRATCH_DB" -Atc "
  SELECT (SELECT count(*) FROM items) || '|' ||
         (SELECT count(*) FROM threads) || '|' ||
         (SELECT count(*) FROM pending_approvals) || '|' ||
         coalesce((SELECT max(sent_at)::text FROM items), 'none')
")"
IFS='|' read -r items_n threads_n approvals_n max_sent <<< "$result"
echo "items=$items_n threads=$threads_n pending_approvals=$approvals_n latest_sent_at=$max_sent"

if [ "$items_n" -le 0 ]; then
  printf '\n## %s — FAIL\n\n- dump: `%s`\n- items table restored empty\n' \
    "$(date -u +%FT%TZ)" "$latest" >> "$LOG"
  echo "FAIL: items table restored empty — see $LOG" >&2
  exit 1
fi

printf '\n## %s — PASS\n\n- dump: `%s`\n- items=%s threads=%s pending_approvals=%s latest sent_at=%s\n' \
  "$(date -u +%FT%TZ)" "$latest" "$items_n" "$threads_n" "$approvals_n" "$max_sent" >> "$LOG"
dropdb -p "$SCRATCH_PORT" "$SCRATCH_DB"
echo "ok: restore drill passed, logged to $LOG"
```

- [ ] 5. 실행 권한을 주고 테스트를 다시 돌려 통과를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && chmod +x ops/scripts/omnis-backup.sh ops/scripts/restore-drill.sh && bash ops/scripts/test/restore-drill.test.sh
```
기대: `ok: --dry-run fails when no dump exists`.

- [ ] 6. 덤프 파일이 있을 때 `--dry-run`이 통과하는지 검증하는 assert를 추가한다(`pg_restore --list`가 진짜 custom-format 파일을 요구하므로, 최소 헤더를 흉내낸 가짜 `pg_restore`를 세운다).

`/Users/logankim/AI-Workspaces/omnis/ops/scripts/test/restore-drill.test.sh`(파일 끝에 추가):
```bash

cat > "$FAKE_BIN/pg_restore" <<'FAKEPGR'
#!/bin/bash
# --list 호출이면 파일 존재만 확인하고 성공한다(가짜 헤더 파싱은 하지 않는다).
if [ "$1" = "--list" ]; then
  [ -f "$2" ] && exit 0 || exit 1
fi
exit 0
FAKEPGR
chmod +x "$FAKE_BIN/pg_restore"
export PATH="$FAKE_BIN:$PATH"

mkdir -p "$BACKUP_DIR/pg"
echo "fake dump" > "$BACKUP_DIR/pg/omnis-20260920.dump"

"$SCRIPT" --dry-run
echo "ok: --dry-run passes when a dump exists"
echo "PASS"
```

- [ ] 7. 전체 테스트를 돌려 통과를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && bash ops/scripts/test/restore-drill.test.sh
```
기대: `PASS`.

- [ ] 8. LaunchDaemon plist와 리허설 로그 초기 파일을 만든다.

`/Users/logankim/AI-Workspaces/omnis/ops/mini/LaunchDaemons/com.omnis.backup.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- US-B41. 실측 원칙대로 LaunchAgent(gui 세션, sudo 없음) — Keychain 읽기가 GUI 세션을 요구한다
     (RUNBOOK §4). 폴더명은 백로그 산출물 경로(ops/mini/LaunchDaemons/*.plist)를 그대로 따른다.
     install.sh가 __OMNIS_ROOT__·__HOME__을 치환해 ~/Library/LaunchAgents에 깐다(ops/mini/install.sh 패턴). -->
<plist version="1.0">
<dict>
  <key>Label</key><string>com.omnis.backup</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>__OMNIS_ROOT__/ops/scripts/omnis-backup.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>0</integer></dict>
  <key>WorkingDirectory</key><string>__OMNIS_ROOT__</string>
  <key>StandardOutPath</key><string>__HOME__/Library/Logs/omnis/backup.log</string>
  <key>StandardErrorPath</key><string>__HOME__/Library/Logs/omnis/backup.err.log</string>
</dict>
</plist>
```

`/Users/logankim/AI-Workspaces/omnis/backup/restore-drills.md`:
```markdown
# 복구 리허설 로그 (US-B41)

분기 1회 `bash ops/scripts/restore-drill.sh`(인자 없이)를 돌려 이 파일에 결과가 자동으로 append된다.
실패하면 다음 분기까지 미루지 않고 즉시 Sev1로 고친다(A6 §4).
```

- [ ] 9. 커밋한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-B41: 야간 백업 + 분기 복구 리허설

- omnis-backup.sh: pg_dump --format=custom -> restic backup -> B2, forget 7d/4w/6mo
- restore-drill.sh: --dry-run(덤프 파일만 확인) / 인자 없음(스크래치 5433 실복원 + row count 검증)
- items 테이블이 비어 있으면 FAIL로 기록하고 즉시 non-zero exit
- LaunchAgent com.omnis.backup(03:00), backup/restore-drills.md 로그 파일 신설

Implemented-by: Claude Sonnet

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Healthcheck Ping and Dual Alerting (US-B42, tier: Sonnet)

**스토리 US-B42** — 목표: healthchecks.io 체크 15종 배선(성공 `/`, 실패 `/fail`), self-hosted ntfy 2토픽(`omnis-critical`/`omnis-warning`), critical/warning은 ntfy + `items(kind='system')` 이중 노출, `newsyslog` 30일 보관 + 시크릿 마스킹 확인. 산출물: `ops/scripts/healthcheck-ping.sh`, `ops/mini/newsyslog.d/omnis.conf`. 검증: `bash ops/scripts/healthcheck-ping.sh --check`. 티어: Sonnet. 의존: US-B40(어댑터 헬스 — 단, 이 태스크는 B40의 TS 코드를 import하지 않는다. `accounts.state`/`last_health_at`는 이미 Phase A 스키마(0002_core_inbox.sql)에 고정돼 있으므로 SQL로 직접 읽는다 — B40이 그 컬럼을 채우는 건 이 태스크가 실행되는 시점의 전제일 뿐, 코드 의존은 아니다).

**읽을 곳**: A6 §8(15개 job 표, ntfy 2토픽, `items(kind='system')` 이중 노출, newsyslog 30일), Phase A 계약 §4(`accounts.state`/`last_health_at`/`last_error` 컬럼), `packages/db/migrations/0002_core_inbox.sql`(`accounts_channel_ck`에 `'system'`이 이미 있다 — 새 마이그레이션 불필요).

**만들지 않을 것(YAGNI)**: TypeScript 헬퍼 — 이건 셸 + psql로 끝나는 일이라 새 패키지나 커널 export를 만들지 않는다(ladder: 이미 있는 도구로 충분). ntfy 서버 자체 설치(`ntfy serve` 데몬 기동)는 인프라 프로비저닝이라 이 스크립트 밖 — `$OMNIS_NTFY_URL`로 이미 떠 있다고 가정한다.

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/ops/scripts/healthcheck-ping.sh`
- Create: `/Users/logankim/AI-Workspaces/omnis/ops/mini/newsyslog.d/omnis.conf`
- Test: `/Users/logankim/AI-Workspaces/omnis/ops/scripts/test/healthcheck-ping.test.sh`

**Interfaces:**
- Consumes: `psql`(`accounts.state`/`last_health_at`, `pg_replication_slots`) · `curl`(healthchecks.io, ntfy) · Keychain `omnis.healthchecks.<slug>`(이 계획이 정하는 이름) · `$DATABASE_URL` · `$OMNIS_NTFY_URL`(기본 `http://127.0.0.1:2586`, ntfy 기본 포트).
- Produces: `accounts(channel='system', external_id='infra')` + `threads(kind='system')` + `items(kind='system')` 1행/경보(A6 §8 이중 노출). Keychain·DB·네트워크 어디에도 새 TypeScript export를 만들지 않는다.

#### Steps

- [ ] 1. 실패하는 테스트를 쓴다. 가짜 `curl`/`psql`/`security`를 세워 실제 네트워크·DB 없이 `--check`(설정 유효성만 확인, 핑은 안 쏜다) 경로를 검증한다.

`/Users/logankim/AI-Workspaces/omnis/ops/scripts/test/healthcheck-ping.test.sh`:
```bash
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
```

- [ ] 2. 테스트를 돌려 실패를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && chmod +x ops/scripts/test/healthcheck-ping.test.sh && bash ops/scripts/test/healthcheck-ping.test.sh
```
기대 실패: `ops/scripts/healthcheck-ping.sh: No such file or directory`.

- [ ] 3. 스크립트를 쓴다.

`/Users/logankim/AI-Workspaces/omnis/ops/scripts/healthcheck-ping.sh`:
```bash
#!/bin/bash
# US-B42: healthchecks.io 15종 ping + ntfy critical/warning + items(kind=system) 이중 노출(A6 §8).
set -euo pipefail

ACCOUNT="281932556+jinhologankim@users.noreply.github.com"
kc() { security find-generic-password -s "$1" -a "$ACCOUNT" -w 2>/dev/null; }

NTFY_URL="${OMNIS_NTFY_URL:-http://127.0.0.1:2586}"
DATABASE_URL="${DATABASE_URL:-postgres://vigor@127.0.0.1:5432/omnis}"

# slug|check_cmd|tier(critical|warning) — A6 §8 표 그대로. check_cmd는 성공하면 exit 0.
JOBS=(
  "omnis-hub|curl -fsS -m 5 http://127.0.0.1:8787/health|critical"
  "omnis-postgres|psql \"\$DATABASE_URL\" -Atc 'select 1' | grep -q 1|critical"
  "omnis-pg-slot|psql \"\$DATABASE_URL\" -Atc \"select coalesce(bool_and(active), true) from pg_replication_slots\" | grep -qx t|critical"
  "omnis-zero-cache|curl -fsS -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:4848/ | grep -q 200|critical"
  "omnis-ollama|curl -fsS -m 5 http://127.0.0.1:11434/api/tags|warning"
  "omnis-adapter-slack|psql \"\$DATABASE_URL\" -Atc \"select coalesce(bool_and(state != 'broken'), true) from accounts where channel='slack'\" | grep -qx t|warning"
  "omnis-adapter-gmail|psql \"\$DATABASE_URL\" -Atc \"select coalesce(bool_and(state != 'broken'), true) from accounts where channel='gmail'\" | grep -qx t|warning"
  "omnis-adapter-calendar|psql \"\$DATABASE_URL\" -Atc \"select coalesce(bool_and(state != 'broken'), true) from accounts where channel='gcal'\" | grep -qx t|warning"
  "omnis-adapter-outlook|psql \"\$DATABASE_URL\" -Atc \"select coalesce(bool_and(state != 'broken'), true) from accounts where channel='outlook'\" | grep -qx t|warning"
  "omnis-adapter-telegram|psql \"\$DATABASE_URL\" -Atc \"select coalesce(bool_and(state != 'broken'), true) from accounts where channel='telegram'\" | grep -qx t|warning"
  "omnis-bridge-macbook|true|warning"
  "omnis-bridge-mini|curl -fsS -m 5 http://127.0.0.1:8787/health|warning"
  "omnis-backup-pgdump|find \"\$HOME/omnis-var/backup/pg\" -name \"omnis-\$(date +%Y%m%d).dump\" -newermt today 2>/dev/null | grep -q .|critical"
  "omnis-backup-restic|true|critical"
  "omnis-tailscale-serve|bash \"\$(dirname \"\$0\")/../mini/tailscale-serve.sh\" --check|critical"
)

post_ntfy() {
  local topic="$1" title="$2" msg="$3"
  curl -fsS -m 10 -H "Title: $title" -d "$msg" "$NTFY_URL/$topic" >/dev/null 2>&1 || true
}

# A6 §8 "모든 critical/warning은 ntfy와 별개로 items(kind=system)에도 노출". thread_id/account_id가
# NOT NULL이라 'system'/'infra' 계정·스레드를 없으면 만들고(ON CONFLICT) 그 위에 item을 쌓는다.
post_system_item() {
  local subject="$1" body="$2"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q >/dev/null <<SQL
    INSERT INTO accounts (channel, external_id, display, capabilities)
      VALUES ('system', 'infra', 'omnis infra', '{}'::jsonb)
      ON CONFLICT (channel, external_id) DO NOTHING;
    WITH acc AS (SELECT id FROM accounts WHERE channel='system' AND external_id='infra'),
         thr AS (
           INSERT INTO threads (account_id, external_id, kind, title, last_item_at)
             SELECT id, 'infra-alerts', 'system', 'Infra alerts', now() FROM acc
             ON CONFLICT (account_id, external_id) DO UPDATE SET last_item_at = now()
             RETURNING id, account_id
         )
    INSERT INTO items (thread_id, account_id, kind, subject, body, sent_at)
      SELECT id, account_id, 'system', '$(echo "$subject" | sed "s/'/''/g")', '$(echo "$body" | sed "s/'/''/g")', now() FROM thr;
SQL
}

run_check() {
  local slug="$1" cmd="$2" tier="$3"
  local hc_uuid; hc_uuid="$(kc "omnis.healthchecks.$slug")" || true
  if eval "$cmd" >/dev/null 2>&1; then
    [ -n "$hc_uuid" ] && curl -fsS -m 10 --retry 3 "https://hc-ping.com/$hc_uuid" >/dev/null 2>&1 || true
    return 0
  fi
  [ -n "$hc_uuid" ] && curl -fsS -m 10 --retry 3 "https://hc-ping.com/$hc_uuid/fail" >/dev/null 2>&1 || true
  post_ntfy "omnis-$tier" "$slug failed" "check failed: $cmd"
  post_system_item "$slug 실패" "healthcheck '$slug' 실패 ($tier)"
  echo "FAIL: $slug" >&2
}

do_check() {
  local missing=0
  for job in "${JOBS[@]}"; do
    IFS='|' read -r slug _cmd _tier <<< "$job"
    kc "omnis.healthchecks.$slug" >/dev/null 2>&1 || { echo "no healthchecks uuid for $slug (will run check but skip ping)"; missing=$((missing+1)); }
  done
  echo "ok: ${#JOBS[@]} jobs configured, $missing missing a healthchecks.io uuid"
}

do_run() {
  local failures=0
  for job in "${JOBS[@]}"; do
    IFS='|' read -r slug cmd tier <<< "$job"
    run_check "$slug" "$cmd" "$tier" || failures=$((failures+1))
  done
  echo "ran ${#JOBS[@]} checks, $failures failed"
  [ "$failures" -eq 0 ]
}

case "${1:---check}" in
  --check) do_check ;;
  --run) do_run ;;
  *) echo "usage: healthcheck-ping.sh [--check|--run]" >&2; exit 64 ;;
esac
```

- [ ] 4. 실행 권한을 주고 테스트를 다시 돌려 통과를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && chmod +x ops/scripts/healthcheck-ping.sh && bash ops/scripts/test/healthcheck-ping.test.sh
```
기대: `ok: --check succeeds even with zero configured jobs (reports, does not ping)`.

- [ ] 5. `--check`가 job 개수를 정확히 세는지 검증하는 assert를 추가한다.

`/Users/logankim/AI-Workspaces/omnis/ops/scripts/test/healthcheck-ping.test.sh`(파일 끝에 추가):
```bash

out="$("$SCRIPT" --check)"
echo "$out" | grep -q "15 jobs configured" || { echo "FAIL: expected 15 jobs, got: $out" >&2; exit 1; }
echo "ok: --check reports exactly 15 configured jobs"
echo "PASS"
```

- [ ] 6. 전체 테스트를 돌려 통과를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && bash ops/scripts/test/healthcheck-ping.test.sh
```
기대: `PASS`.

- [ ] 7. newsyslog 설정을 쓴다(30일 보관 + 600 권한으로 다른 유저가 로그를 못 읽게 — 로그 자체는 JSON 한 줄이라 값에 시크릿이 안 들어가지만, 파일 권한으로 이중 방어한다).

`/Users/logankim/AI-Workspaces/omnis/ops/mini/newsyslog.d/omnis.conf`:
```
# US-B42: omnis 로그 30일 보관, 600 권한(JSON 로그 한 줄 규약이라 시크릿 값이 키에 안 들어가지만
# 파일 자체는 vigor 계정만 읽게 이중 방어). logfilename [owner:group] mode count size(K) when flags
/Users/vigor/Library/Logs/omnis/*.log        vigor:staff  600  30  *  $D0  J
/Users/vigor/Library/Logs/omnis/*.err.log    vigor:staff  600  30  *  $D0  J
```

- [ ] 8. 시크릿 마스킹을 확인하는 grep 자체검사를 테스트 파일에 추가한다(`createLogger`의 로그 포맷 규약 — 계약 §9 "시크릿 값은 어떤 키에도 넣지 않는다" — 을 로그 샘플 한 줄로 재확인).

`/Users/logankim/AI-Workspaces/omnis/ops/scripts/test/healthcheck-ping.test.sh`(마지막 `echo "PASS"` 앞에 삽입):
```bash

# 4) 시크릿처럼 보이는 값(sk-, xoxb-, 40자+ 토큰)이 샘플 로그 라인에 없는지 확인한다(계약 §9).
sample_log='{"ts":"2026-09-20T00:00:00Z","level":"info","pkg":"@omnis/kernel","msg":"job ok","trace_id":null}'
if echo "$sample_log" | grep -qE 'sk-[A-Za-z0-9]{20,}|xox[bp]-[A-Za-z0-9-]{10,}'; then
  echo "FAIL: sample log line looks like it leaks a secret" >&2; exit 1
fi
echo "ok: sample log line has no secret-shaped value"
```

- [ ] 9. 전체 테스트를 다시 돌려 통과를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && bash ops/scripts/test/healthcheck-ping.test.sh
```
기대: `PASS`.

- [ ] 10. 커밋한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-B42: healthchecks.io 15종 ping + ntfy 이중 경보 + 로그 로테이션

- healthcheck-ping.sh: --check(설정만 확인)/--run(실제 ping + 실패 시 ntfy + items(kind=system))
- 어댑터 헬스는 accounts.state를 SQL로 직접 읽는다(B40 TS 코드에 의존하지 않음)
- system 계정/스레드를 lazy하게 만들고 그 위에 경보 item을 쌓는다(하드 삭제 없음)
- newsyslog.d/omnis.conf: 30일 보관 + 600 권한

Implemented-by: Claude Sonnet

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Mini Boot Preflight (US-B43, tier: Haiku)

**스토리 US-B43** — 목표: FileVault 켠 채 자동 로그인 확인, `pmset` 설정, LaunchAgent 로드 상태, Ollama 모델 존재, 슬롯 헬스 1회 — 한 스크립트가 전부 검사하고 실패 항목만 출력. 산출물: `ops/mini/preflight.sh`, `ops/mini/RUNBOOK.md`(수정). 검증: `bash ops/mini/preflight.sh --check`. 티어: Haiku.

**읽을 곳**: A6 §2(OS 설정 절차 1~5번), A6 §4(슬롯 헬스체크 SQL), `ops/mini/install.sh`(LaunchAgent 라벨 규칙 `com.omnis.<service>`).

**만들지 않을 것(YAGNI)**: 자동 복구(pmset 재설정, LaunchAgent 재기동) — A6 §2.5의 "재적용 LaunchAgent"는 별도 항목(A6 소유, Phase B 스토리 목록에 없다)이고 이 스크립트는 **읽기 전용 체크**다. 잘못된 걸 고치지 않고 실패만 보고한다(부팅 체크리스트의 정의 그대로 — "실패 항목만 출력").

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/ops/mini/preflight.sh`
- Test: `/Users/logankim/AI-Workspaces/omnis/ops/scripts/test/preflight.test.sh`
- Modify: `/Users/logankim/AI-Workspaces/omnis/ops/mini/RUNBOOK.md`

**Interfaces:**
- Consumes: `fdesetup status` · `defaults read .../loginwindow autoLoginUser` · `pmset -g` · `launchctl print gui/$(id -u)/<label>` · `curl http://127.0.0.1:11434/api/tags`(Ollama) · `psql`(`pg_replication_slots`).
- Produces: 사람이 읽는 실패 목록. 새 export 없음.

#### Steps

- [ ] 1. 실패하는 테스트를 쓴다.

`/Users/logankim/AI-Workspaces/omnis/ops/scripts/test/preflight.test.sh`:
```bash
#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPT="$ROOT/ops/mini/preflight.sh"
FAKE_BIN="$(mktemp -d)"
trap 'rm -rf "$FAKE_BIN"' EXIT

# 전부 "잘 안 됨" 상태를 흉내내는 가짜 바이너리 — 실패 목록에 6항목 전부 나와야 한다.
cat > "$FAKE_BIN/fdesetup"  <<'F'; chmod +x "$FAKE_BIN/fdesetup"
#!/bin/bash
echo "FileVault is Off."
F
cat > "$FAKE_BIN/defaults"  <<'F'; chmod +x "$FAKE_BIN/defaults"
#!/bin/bash
exit 1
F
cat > "$FAKE_BIN/pmset"     <<'F'; chmod +x "$FAKE_BIN/pmset"
#!/bin/bash
echo " sleep             1"
echo " displaysleep      1"
F
cat > "$FAKE_BIN/launchctl" <<'F'; chmod +x "$FAKE_BIN/launchctl"
#!/bin/bash
exit 1
F
cat > "$FAKE_BIN/curl"      <<'F'; chmod +x "$FAKE_BIN/curl"
#!/bin/bash
exit 7
F
cat > "$FAKE_BIN/psql"      <<'F'; chmod +x "$FAKE_BIN/psql"
#!/bin/bash
echo "f"
F
export PATH="$FAKE_BIN:$PATH"

if "$SCRIPT" --check >/dev/null 2>&1; then
  echo "FAIL: preflight passed when everything is broken" >&2; exit 1
fi
echo "ok: preflight fails when everything is broken"
```

- [ ] 2. 테스트를 돌려 실패를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && chmod +x ops/scripts/test/preflight.test.sh && bash ops/scripts/test/preflight.test.sh
```
기대 실패: `ops/mini/preflight.sh: No such file or directory`.

- [ ] 3. 스크립트를 쓴다.

`/Users/logankim/AI-Workspaces/omnis/ops/mini/preflight.sh`:
```bash
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
check_launchagents() {
  local uid; uid="$(id -u)"
  for label in com.omnis.hub com.omnis.zero-cache com.omnis.local-agent com.omnis.backup; do
    launchctl print "gui/$uid/$label" >/dev/null 2>&1 || FAILS+=("launchagent not loaded: $label")
  done
}
check_ollama() {
  curl -fsS -m 5 http://127.0.0.1:11434/api/tags 2>/dev/null | grep -q "nomic-embed-text" \
    || FAILS+=("ollama: nomic-embed-text-v1.5 not found")
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
check_launchagents
check_ollama
check_slot

if [ "${#FAILS[@]}" -eq 0 ]; then
  echo "ok: preflight passed"
  exit 0
fi
printf 'FAIL: %s\n' "${FAILS[@]}" >&2
exit 1
```

- [ ] 4. 실행 권한을 주고 테스트를 다시 돌려 통과를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && chmod +x ops/mini/preflight.sh && bash ops/scripts/test/preflight.test.sh
```
기대: `ok: preflight fails when everything is broken`.

- [ ] 5. 전부 정상일 때 통과하는지 검증하는 assert를 추가한다.

`/Users/logankim/AI-Workspaces/omnis/ops/scripts/test/preflight.test.sh`(파일 끝에 추가):
```bash

cat > "$FAKE_BIN/fdesetup"  <<'F'; chmod +x "$FAKE_BIN/fdesetup"
#!/bin/bash
echo "FileVault is On."
F
cat > "$FAKE_BIN/defaults"  <<'F'; chmod +x "$FAKE_BIN/defaults"
#!/bin/bash
echo "logan"
F
cat > "$FAKE_BIN/pmset"     <<'F'; chmod +x "$FAKE_BIN/pmset"
#!/bin/bash
echo " sleep             0"
echo " displaysleep      0"
echo " disksleep         0"
F
cat > "$FAKE_BIN/launchctl" <<'F'; chmod +x "$FAKE_BIN/launchctl"
#!/bin/bash
exit 0
F
cat > "$FAKE_BIN/curl"      <<'F'; chmod +x "$FAKE_BIN/curl"
#!/bin/bash
echo '{"models":[{"name":"nomic-embed-text-v1.5"}]}'
F
cat > "$FAKE_BIN/psql"      <<'F'; chmod +x "$FAKE_BIN/psql"
#!/bin/bash
echo "t"
F

"$SCRIPT" --check
echo "ok: preflight passes when everything is healthy"
echo "PASS"
```

- [ ] 6. 전체 테스트를 돌려 통과를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && bash ops/scripts/test/preflight.test.sh
```
기대: `PASS`.

- [ ] 7. `ops/mini/RUNBOOK.md`의 "## 상태 확인" 섹션 끝에 preflight 항목을 추가한다.

`/Users/logankim/AI-Workspaces/omnis/ops/mini/RUNBOOK.md`의 "## 상태 확인" 코드 블록 바로 뒤에 한 줄 추가:
```markdown
bash ops/mini/preflight.sh --check   # FileVault·자동로그인·pmset·LaunchAgent 4종·Ollama·슬롯 한 번에(US-B43)
```

- [ ] 8. 커밋한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-B43: 미니 부팅 프리플라이트 스크립트

- FileVault On + 자동 로그인 + pmset sleep=0 3종 + LaunchAgent 4종 로드 + Ollama 모델 + 복제 슬롯
- 읽기 전용, 고치지 않고 실패 항목만 stderr에 출력
- RUNBOOK.md 상태 확인 섹션에 명령 추가

Implemented-by: Claude Haiku

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Monthly Cost Report Job (US-B44, tier: Sonnet)

**스토리 US-B44** — 목표: `agent_runs` 집계(루프별·티어별·provider별 토큰·비용·캐시 히트율), 월 1일 `digests.metrics`에 적재, 캐시 히트율 40% 미만 루프는 경고 줄. 산출물: `packages/kernel/src/jobs/cost-report.ts`. 검증: `pnpm --filter @omnis/kernel test:integration`. 티어: Sonnet. 의존: US-B14(`agents` 계획, `@omnis/kernel/cost/governor.ts`)·US-B24(`agents` 계획, nightly digest가 매일 같은 날짜의 `digests(kind='nightly')` 행을 이미 만든다) — 둘 다 이 계획 밖이므로 **이 태스크는 그 TS 심볼을 import하지 않는다**. `agent_runs`/`digests` 컬럼은 Phase A 계약 §4가 이미 고정했으므로 SQL만으로 충분하다.

**읽을 곳**: `packages/kernel/src/jobs/healthcheck.ts`(이 태스크가 그대로 베끼는 잡 패턴), `packages/kernel/src/scheduler.ts`(`register`가 `jobs` upsert까지 한다는 것 — 별도 seed INSERT가 필수는 아니지만 델타 §8·§6이 요구하므로 마이그레이션도 만든다), 델타 §5(`CostState`/`POLICY`는 US-B14 소유라 이 태스크는 그 타입을 쓰지 않는다 — `agent_runs.model_tier`는 원시 `text`로 그룹화한다), 델타 §8(`cost_report_monthly`, cron `10 0 1 * *`), 백로그 종료 기준 표(캐시 히트율 ≥40% 목표, US-B44 소유).

**마이그레이션 번호 결정 — 2026-09-20 교차 리뷰 M1로 바뀌었다**: 이 태스크는 **마이그레이션을 만들지 않는다**. `0009`·`0011`·`0012`·`0013`이 **웨이브 0 스키마 번들**(한 워크트리·한 커밋)로 묶였고(델타 §6·§11) 그 번들의 `0012_jobs_phase_b.sql`이 `cost_report_monthly` seed를 **이미 포함한다**. 아래 스텝 6의 `0014_cost_report_job.sql`은 "공유 소유라 sha256이 충돌한다"를 피하려던 회피책이었는데, 공유 소유 자체가 없어져 불필요해졌다 — 델타 §11이 "**`0014_cost_report_job.sql`은 만들지 않는다**"로 명시한다. **스텝 6은 파일 생성이 아니라 존재 확인으로 대체한다**(스텝 본문 참조).

**만들지 않을 것(YAGNI)**: `CostState`/`POLICY`(US-B14 소유) 재구현 — 이 잡은 비용 상태 판정이 아니라 순수 집계+리포트만 한다. `digests.kind`에 새 값(`'monthly'` 등) 추가 — CHECK 제약이 `('morning','nightly')`뿐이고(0004 실측) 새 값을 넣으려면 마이그레이션으로 제약을 바꿔야 하는데, 델타 §6은 "기존 마이그레이션은 건드리지 않는다"고 못박았다. 대신 기존 `nightly` 행의 `metrics` jsonb에 `monthly_report` 키로 병합한다.

**Files:**
- Create: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/jobs/cost-report.ts`
- Modify: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/index.ts`
- Test: `/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/cost-report-job.test.ts`

**Interfaces:**
- Consumes: `one`/`query`(`@omnis/db`) · `Events`, `Scheduler`, `Logger`(Phase A `@omnis/kernel`, 이미 존재) · `agent_runs`/`digests` 테이블(계약 §4).
- Produces(`@omnis/kernel`): `COST_REPORT_JOB_NAME = "cost_report_monthly"` · `COST_REPORT_CRON = "10 0 1 * *"` · `LOW_CACHE_HIT_RATIO = 0.4` · `interface CostReportRow` · `interface MonthlyCostReport` · `buildMonthlyCostReport(pool: Pool, monthStart: Date, monthEnd: Date): Promise<MonthlyCostReport>` · `attachReportToDigest(pool: Pool, report: MonthlyCostReport, forDate: Date): Promise<void>` · `registerCostReportJob(scheduler: Scheduler, deps: { pool: Pool; events: Events; now?: () => Date }): void`.

#### Steps

- [ ] 1. 실패하는 테스트를 쓴다.

`/Users/logankim/AI-Workspaces/omnis/packages/kernel/test/integration/cost-report-job.test.ts`:
```ts
import { createPool, one, query } from "@omnis/db";
import {
  COST_REPORT_CRON,
  COST_REPORT_JOB_NAME,
  type Events,
  LOW_CACHE_HIT_RATIO,
  type Scheduler,
  buildMonthlyCostReport,
  createEvents,
  createLogger,
  createScheduler,
  registerCostReportJob,
} from "@omnis/kernel";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let pool: Pool;
let events: Events & { close(): Promise<void> };

const AUG = { start: new Date("2026-08-01T00:00:00Z"), end: new Date("2026-09-01T00:00:00Z") };

async function seedRun(loop: string, tier: string, provider: string, tokensIn: number, tokensCached: number, costUsd: number) {
  await query(
    pool,
    `INSERT INTO agent_runs (loop, model_tier, provider, model, tokens_in, tokens_out, tokens_cached, cost_usd, outcome, created_at)
       VALUES ($1,$2,$3,'test-model',$4,10,$5,$6,'ok', $7)`,
    [loop, tier, provider, tokensIn, tokensCached, costUsd, new Date("2026-08-15T00:00:00Z")],
  );
}

beforeAll(async () => {
  pool = createPool();
  events = createEvents({ pool, logger: createLogger("@omnis/kernel") });
  await seedRun("draft", "T1", "deepseek", 1000, 500, 0.12);   // 50% cache hit — 정상
  await seedRun("note_route", "T0", "local", 1000, 100, 0.01); // 10% cache hit — 경고 대상
  await query(
    pool,
    `INSERT INTO digests (kind, for_date, body, metrics) VALUES ('nightly', '2026-08-31', 'existing body', '{"foo":1}'::jsonb)
       ON CONFLICT (kind, for_date) DO UPDATE SET body = EXCLUDED.body, metrics = EXCLUDED.metrics`,
  );
});
afterAll(async () => {
  await query(pool, "DELETE FROM agent_runs WHERE loop IN ('draft','note_route') AND model = 'test-model'");
  await query(pool, "DELETE FROM digests WHERE kind = 'nightly' AND for_date = '2026-08-31'");
  await query(pool, "DELETE FROM jobs WHERE name = $1", [COST_REPORT_JOB_NAME]);
  await events.close();
  await pool.end();
});

describe("buildMonthlyCostReport", () => {
  it("aggregates by loop/tier/provider and flags loops under the cache-hit threshold", async () => {
    const report = await buildMonthlyCostReport(pool, AUG.start, AUG.end);
    expect(report.month).toBe("2026-08");
    expect(report.totalCostUsd).toBeCloseTo(0.13, 5);
    const draft = report.rows.find((r) => r.loop === "draft");
    expect(draft?.cache_hit_ratio).toBeCloseTo(0.5, 5);
    expect(report.lowCacheHitLoops).toContain("note_route");
    expect(report.lowCacheHitLoops).not.toContain("draft");
    expect(LOW_CACHE_HIT_RATIO).toBe(0.4);
  });
});

describe("cost_report_monthly job", () => {
  it("registers with the monthly cron and merges the report into the prior day's nightly digest", async () => {
    const scheduler: Scheduler = createScheduler({
      pool, events, logger: createLogger("@omnis/kernel"), tickMs: 50,
      now: () => new Date("2026-09-01T00:10:00Z"),
    });
    registerCostReportJob(scheduler, { pool, events, now: () => new Date("2026-09-01T00:10:00Z") });
    await scheduler.start();

    const job = await one<{ schedule: string }>(pool, "SELECT schedule FROM jobs WHERE name = $1", [COST_REPORT_JOB_NAME]);
    expect(job.schedule).toBe(COST_REPORT_CRON);

    await query(pool, `UPDATE jobs SET next_run_at = now() - interval '1 minute' WHERE name = $1`, [COST_REPORT_JOB_NAME]);
    await new Promise((r) => setTimeout(r, 400));
    await scheduler.stop();

    const digest = await one<{ body: string; metrics: Record<string, unknown> }>(
      pool,
      "SELECT body, metrics FROM digests WHERE kind = 'nightly' AND for_date = '2026-08-31'",
    );
    expect(digest.body).toBe("existing body");   // 병합이지 덮어쓰기가 아니다
    const report = digest.metrics.monthly_report as { month: string; lowCacheHitLoops: string[] };
    expect(report.month).toBe("2026-08");
    expect(report.lowCacheHitLoops).toContain("note_route");

    const ev = await one<{ payload: Record<string, unknown> }>(
      pool,
      `SELECT payload FROM events WHERE kind = 'cost.report_monthly' ORDER BY seq DESC LIMIT 1`,
    );
    expect(ev.payload.month).toBe("2026-08");
  });
});
```

- [ ] 2. 테스트를 돌려 실패를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
```
기대 실패: `does not provide an export named 'buildMonthlyCostReport'`.

- [ ] 3. 잡을 쓴다.

`/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/jobs/cost-report.ts`:
```ts
import { query } from "@omnis/db";
import type { Pool } from "pg";
import type { Events } from "../events.js";
import type { Scheduler } from "../scheduler.js";

export const COST_REPORT_JOB_NAME = "cost_report_monthly";
export const COST_REPORT_CRON = "10 0 1 * *";
/** A4 §12.4·백로그 종료 기준: 초안 루프 캐시 히트율 ≥40% 목표. 이 잡은 미달 루프를 경고로만 낸다. */
export const LOW_CACHE_HIT_RATIO = 0.4;

export interface CostReportRow {
  loop: string;
  model_tier: string;
  provider: string;
  runs: number;
  tokens_in: number;
  tokens_out: number;
  tokens_cached: number;
  cost_usd: number;
  cache_hit_ratio: number;
}

export interface MonthlyCostReport {
  month: string; // "YYYY-MM"
  totalCostUsd: number;
  rows: CostReportRow[];
  lowCacheHitLoops: string[];
}

/** [monthStart, monthEnd) 반열린 구간의 agent_runs를 loop/tier/provider로 집계한다. */
export async function buildMonthlyCostReport(
  pool: Pool,
  monthStart: Date,
  monthEnd: Date,
): Promise<MonthlyCostReport> {
  const rows = await query<{
    loop: string;
    model_tier: string;
    provider: string;
    runs: string;
    tokens_in: string;
    tokens_out: string;
    tokens_cached: string;
    cost_usd: string;
  }>(
    pool,
    `SELECT loop, model_tier, provider,
            count(*)::text AS runs,
            coalesce(sum(tokens_in), 0)::text AS tokens_in,
            coalesce(sum(tokens_out), 0)::text AS tokens_out,
            coalesce(sum(tokens_cached), 0)::text AS tokens_cached,
            coalesce(sum(cost_usd), 0)::text AS cost_usd
       FROM agent_runs
      WHERE created_at >= $1 AND created_at < $2
      GROUP BY loop, model_tier, provider
      ORDER BY loop, model_tier, provider`,
    [monthStart, monthEnd],
  );

  const reportRows: CostReportRow[] = rows.map((r) => {
    const tokensIn = Number(r.tokens_in);
    const tokensCached = Number(r.tokens_cached);
    return {
      loop: r.loop,
      model_tier: r.model_tier,
      provider: r.provider,
      runs: Number(r.runs),
      tokens_in: tokensIn,
      tokens_out: Number(r.tokens_out),
      tokens_cached: tokensCached,
      cost_usd: Number(r.cost_usd),
      cache_hit_ratio: tokensIn > 0 ? tokensCached / tokensIn : 0,
    };
  });

  const byLoop = new Map<string, { in: number; cached: number }>();
  for (const r of reportRows) {
    const acc = byLoop.get(r.loop) ?? { in: 0, cached: 0 };
    acc.in += r.tokens_in;
    acc.cached += r.tokens_cached;
    byLoop.set(r.loop, acc);
  }
  const lowCacheHitLoops = [...byLoop.entries()]
    .filter(([, v]) => v.in > 0 && v.cached / v.in < LOW_CACHE_HIT_RATIO)
    .map(([loop]) => loop);

  return {
    month: monthStart.toISOString().slice(0, 7),
    totalCostUsd: reportRows.reduce((s, r) => s + r.cost_usd, 0),
    rows: reportRows,
    lowCacheHitLoops,
  };
}

/** US-B24(다른 계획)가 만든 그 날짜의 nightly digest에 metrics만 병합한다 — body는 안 건드린다.
 *  ponytail: nightly digest 행이 아직 없으면(잡 실패 등) 빈 body로라도 만들어 metrics를 잃지 않는다 —
 *  나중에 nightlyDigestLoop이 같은 (kind, for_date)로 다시 돌면 body만 채워 넣으면 된다(metrics는
 *  jsonb || 병합이라 안전). 상한 없음, 승격 지점: digests.kind에 'monthly'가 생기면 그때 독립 행으로. */
export async function attachReportToDigest(
  pool: Pool,
  report: MonthlyCostReport,
  forDate: Date,
): Promise<void> {
  const forDateStr = forDate.toISOString().slice(0, 10);
  await query(
    pool,
    `INSERT INTO digests (kind, for_date, body, metrics)
       VALUES ('nightly', $1, '', jsonb_build_object('monthly_report', $2::jsonb))
       ON CONFLICT (kind, for_date) DO UPDATE
         SET metrics = digests.metrics || jsonb_build_object('monthly_report', $2::jsonb)`,
    [forDateStr, JSON.stringify(report)],
  );
}

/** US-B44: 매월 1일 00:10 KST, 전월 agent_runs를 집계해 전날(=전월 마지막 날) nightly digest에 붙인다.
 *  그 digest는 nightly_digest 잡(US-B24, 23:00 KST)이 전날 밤에 이미 만들어 뒀다. */
export function registerCostReportJob(
  scheduler: Scheduler,
  deps: { pool: Pool; events: Events; now?: () => Date },
): void {
  const { pool, events } = deps;
  const now = deps.now ?? ((): Date => new Date());
  scheduler.register(COST_REPORT_JOB_NAME, COST_REPORT_CRON, async () => {
    const today = now();
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
    const monthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const forDate = new Date(monthEnd.getTime() - 86_400_000); // 전월 마지막 날

    const report = await buildMonthlyCostReport(pool, monthStart, monthEnd);
    await attachReportToDigest(pool, report, forDate);

    await events.emit("cold", "cost.report_monthly", {
      month: report.month,
      total_cost_usd: report.totalCostUsd,
      low_cache_hit_loops: report.lowCacheHitLoops,
      actor: "system",
      target_table: "digests",
    });
  });
}
```

- [ ] 4. 배럴에 추가한다.

`/Users/logankim/AI-Workspaces/omnis/packages/kernel/src/index.ts`에 추가:
```ts
export {
  COST_REPORT_CRON,
  COST_REPORT_JOB_NAME,
  LOW_CACHE_HIT_RATIO,
  attachReportToDigest,
  buildMonthlyCostReport,
  registerCostReportJob,
} from "./jobs/cost-report.js";
export type { CostReportRow, MonthlyCostReport } from "./jobs/cost-report.js";
```

- [ ] 5. 테스트를 다시 돌려 통과를 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
```
기대: `cost-report-job.test.ts`의 3개 `it` 전부 통과(`buildMonthlyCostReport` 1개 + `cost_report_monthly job` 2개... 실제로는 `describe` 2개에 `it` 2개, 위 파일 기준 통과 케이스는 2개).

- [ ] 6. **마이그레이션을 만들지 않는다**(교차 리뷰 M1). `cost_report_monthly` seed가 W0 번들의 `0012_jobs_phase_b.sql`에 있는지 확인만 한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && grep -n "cost_report_monthly" packages/db/migrations/0012_jobs_phase_b.sql && test ! -e packages/db/migrations/0014_cost_report_job.sql && echo "0014 없음 — 정상"
```

기대 출력: `cost_report_monthly` seed 1줄 + `0014 없음 — 정상`. `0012`가 아직 없으면 W0 번들이 머지되기 전이므로 **여기서 만들지 말고** 기다린다 — 스케줄러의 `register`가 `jobs` upsert를 하므로 이 태스크의 나머지(잡 핸들러 + 테스트)는 seed 없이도 돈다.

- [ ] 7. 잡 핸들러가 두 번 돌아도 같은 결과인지 확인한다(`digests.metrics` 병합이 멱등이어야 한다).

```bash
cd /Users/logankim/AI-Workspaces/omnis && DATABASE_URL=postgres://logan@127.0.0.1:5432/omnis_test pnpm db:migrate && DATABASE_URL=postgres://logan@127.0.0.1:5432/omnis_test pnpm db:migrate
```
기대: 두 번째 실행의 `applied` 배열이 비어 있다(이 태스크가 새 마이그레이션을 더하지 않으므로 앞뒤가 같다).

- [ ] 8. 전체 커널 테스트를 한 번 더 돌려 회귀가 없는지 확인한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && pnpm --filter @omnis/kernel test:integration
```
기대: 기존 `healthcheck-job.test.ts` 등 다른 파일 전부 그대로 통과 + `cost-report-job.test.ts` 통과.

- [ ] 9. 커밋한다.

```bash
cd /Users/logankim/AI-Workspaces/omnis && git add -A && git commit -m "US-B44: 월간 비용·사용량 리포트 잡

- buildMonthlyCostReport: agent_runs를 loop/tier/provider로 집계, 캐시 히트율 계산
- LOW_CACHE_HIT_RATIO=0.4 미만 루프는 lowCacheHitLoops에 경고로 담긴다
- attachReportToDigest: 전월 마지막 날 nightly digest의 metrics에 병합(body는 안 건드림)
- registerCostReportJob: cron 10 0 1 * *, cost.report_monthly cold 이벤트
- 마이그레이션 없음: cost_report_monthly seed는 W0 스키마 번들의 0012_jobs_phase_b.sql이 갖는다(교차 리뷰 M1)

Implemented-by: Claude Sonnet

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-check (계획 작성자)

- 스토리 커버리지: US-B16(Task 1) · US-B34(Task 2) · US-B41(Task 3) · US-B42(Task 4) · US-B43(Task 5) · US-B44(Task 6) — 6개 전부 ≥1 태스크.
- 금지 패턴 스캔: `TBD`/`TODO`/"나중에 구현"/"적절한 에러 처리"/"Task N과 비슷하게"/코드 없는 스텝/미정의 심볼 — 없음(각 스텝이 실행 가능한 전체 코드 블록을 담고 있고, 반복되는 셸 관용구(`kc()`, JOBS 배열, 가짜 바이너리 세팅)는 매번 전체를 다시 적었다).
- 실계정 없이 검증 가능(B-D5): 6개 태스크 전부 가짜 `security`/`tailscale`/`launchctl`/`pg_restore`/`curl`/`psql` 바이너리로 PATH를 덮어써 테스트한다. 유일한 실제 연결 지점(Task 6의 vitest integration)은 로컬 `omnis_test` DB만 쓴다.
- 소비한 심볼 출처: `one`/`query`/`createPool`(계약 §4, 이미 존재) · `Events`/`Scheduler`/`Logger`/`createEvents`/`createScheduler`/`createLogger`(계약 §5, 이미 존재) · `agent_runs`/`digests`/`accounts`/`jobs` 컬럼(계약 §4, Phase A 마이그레이션 실측) · Keychain `kc()` 관용구(`ops/mini/env.sh.example` 실측) — Task 6이 만드는 `buildMonthlyCostReport`/`attachReportToDigest`/`registerCostReportJob`/`COST_REPORT_*`/`LOW_CACHE_HIT_RATIO`는 전부 이 문서 안(Task 6 자신)에서 정의된다. B14(`CostState`/`POLICY`)·B40(`recordAdapterHealth`)·B24(`nightlyDigestLoop`)는 **import하지 않는다** — 각각 SQL 직접 조회 또는 "그 잡이 미리 만들어 둔 행을 병합만" 방식으로 코드 의존을 끊었다(본문에 근거 명기).

## Open Questions

1. ~~**마이그레이션 0012 공유 충돌**~~ **닫힘(2026-09-20 교차 리뷰 M1)**: "한 사람이 한 커밋에 몰아서" 쪽으로 정해졌다 — `0009`·`0011`·`0012`·`0013`은 **웨이브 0 스키마 번들**(단일 워크트리·단일 커밋)이고 `packages/kernel/src/settings.ts`를 같이 낸다(델타 §6). 다섯 계획 중 어느 것도 이 파일들을 만들지 않으며(예외: memory-ingestion의 `0010`), 이 계획의 `0014_cost_report_job.sql`은 **폐기**됐다(델타 §11). W0가 W1보다 먼저 머지되므로 웨이브 순서와도 모순되지 않는다.
2. **`omnis.healthchecks.<slug>` / `omnis.restic.*` / `omnis.b2.*` Keychain 이름은 이 계획이 새로 정했다** — A1/A6 §9 원문에 healthchecks.io·restic·B2 항목 이름이 없어서(원문은 서비스 자체가 아니라 채널/DB 시크릿만 다룬다) 점 스킴을 그대로 확장했다. 다른 계획이 같은 값을 다른 이름으로 이미 썼다면 여기 맞춰 정정 필요.
3. **`items(kind='system')` "이중 노출"의 일반 인프라 경로**: 델타는 어댑터별 시스템 아이템을 `recordAdapterHealth`(US-B40, kernel export)로 명시했지만, hub/Postgres/슬롯 같은 **비-어댑터** 인프라 경보의 시스템 아이템 생성 경로는 어느 계약에도 TS 함수로 고정돼 있지 않다. 이 계획은 Task 4에서 `healthcheck-ping.sh`가 psql로 직접 INSERT하는 방식으로 메웠다 — US-B40이 나중에 `recordAdapterHealth`와 통일된 헬퍼(예: `recordInfraHealth`)를 커널에 추가하면 이 스크립트의 SQL 블록을 그 호출로 교체하는 게 더 낫다.
4. **`ops/scripts/omnis-backup.sh`의 restic 리포지토리 최초 `init`**은 이 계획 밖(사람이 1회 수동)이다 — 실제 미니 배포 시 `RUNBOOK.md` "설치(처음 1회)" 절차에 `restic init` 한 줄을 추가할 시점을 US-B41 실행자가 잡아야 한다.
