# 미니 운영 런북 (hub · zero-cache · local-agent)

대상: `vigors-mac-mini` (<hub-host>, tailnet `your-tailnet.ts.net`), 유저 `vigor`, 리포 `/Users/vigor/omnis`.
전부 **LaunchAgent, sudo 없음**. 맥북에서 `ssh <hub-user>@<hub-host>`로 무비밀번호 접속된다.

| | |
|---|---|
| 서비스 | `com.omnis.hub` (127.0.0.1:8787) · `com.omnis.zero-cache` (:4848) · `com.omnis.local-agent` (Codex 브리지) |
| plist 원본 | `ops/mini/com.omnis.*.plist` (템플릿) → `~/Library/LaunchAgents/` (install.sh가 치환) |
| 진입점 | `ops/mini/run.sh <service>` — `ops/mini/env.sh`를 source해 Keychain 비밀을 export한 뒤 exec |
| 로그 | `~/Library/Logs/omnis/{hub,zero-cache,local-agent}.{log,err.log}` |
| DB | `postgres://vigor@127.0.0.1:5432/omnis` (같은 클러스터에 miniflux가 있다 — 건드리지 말 것) |
| 외부 노출 | `https://your-hub.your-tailnet.ts.net/…` → 127.0.0.1:8787 (tailnet only, **prefix strip 없음** — 경로가 허브 라우트 그대로다) |

> **미니의 기존 설비는 건드리지 않는다**: Hermes/omh/buzz(`~/.hermes`, 포트 8642), colima, miniflux, recap-server(:8090).

## 설치 (처음 1회)

```bash
# 1) 맥북에서 리포를 밀어넣는다
cd <worktree> && rsync -az --delete \
  --exclude node_modules --exclude target --exclude .git --exclude ops/mini/env.sh \
  ./ <hub-user>@<hub-host>:/Users/vigor/omnis/

# 2) 미니에서 (ssh <hub-user>@<hub-host>)
export PATH=/opt/homebrew/bin:$PATH
npm i -g pnpm@9.12.3                 # brew node 26의 npm으로
brew install pgvector                # 0001_extensions.sql의 CREATE EXTENSION vector
cd /Users/vigor/omnis && pnpm install --prod=false --frozen-lockfile && pnpm build

# 3) DB
createdb -U vigor omnis
psql -U vigor -d omnis -c "CREATE SCHEMA IF NOT EXISTS zero_cvr"
psql -U vigor -d postgres -c "ALTER SYSTEM SET wal_level='logical'" && brew services restart postgresql@17
DATABASE_URL="postgres://vigor@127.0.0.1:5432/omnis" pnpm db:migrate
ZERO_UPSTREAM_DB="postgres://vigor@127.0.0.1:5432/omnis" OMNIS_USER_ID=logan pnpm zero:deploy-permissions
```

### 4) 비밀 (A6 §9)

**ssh 셸에서는 Keychain을 못 쓴다** — 로그인 세션이 `Background`라 `security`가
"User interaction is not allowed"로 거절한다. 항목 생성은 **GUI 세션(gui/501)에서 돌려야 한다**:
스크립트를 `/tmp`에 두고 1회성 LaunchAgent로 `launchctl bootstrap gui/501`한 뒤 결과를 로그로 읽는다.
(읽기는 LaunchAgent가 gui/501에서 돌기 때문에 운영 중에는 문제되지 않는다.)

항목 3개 — 이름은 A1/A6 §9 스킴 그대로:

| service | 쓰는 곳 |
|---|---|
| `omnis.bridge.token.mini` | hub `OMNIS_BRIDGE_TOKEN` ↔ local-agent가 Keychain에서 직접 읽음 |
| `omnis.zero.auth_secret` | hub `ZERO_AUTH_SECRET` ↔ zero-cache (같은 값이어야 한다) |
| `omnis.zero.admin_password` | zero-cache production 모드 부팅 조건 |

account는 전부 `281932556+jinhologankim@users.noreply.github.com`. 값은 `openssl rand -hex 32`(admin은 24).
**어떤 값도 로그·커밋·셸 히스토리에 남기지 않는다.**

### 5) 서비스

```bash
cd /Users/vigor/omnis && bash ops/mini/install.sh        # 3개 전부. 인자로 하나만도 가능
```
install.sh는 `ops/mini/env.sh`(없으면 `env.sh.example`에서)와 `~/.omnis/local-agent.toml`
(없으면 `local-agent.toml.example`에서)을 깔고, plist를 치환해 `gui/$(id -u)`에 bootstrap한다.
`env.sh`는 **커밋하지 않는다**(.gitignore) — 값은 전부 Keychain 조회다.

### 6) tailnet 노출

```bash
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg --set-path=/ http://127.0.0.1:8787
```
`/`에 붙인다 — Serve는 `--set-path`로 붙인 prefix를 **떼고** 백엔드에 넘기기 때문에, `/api`에 마운트하면
허브의 `/api/zero-token`이 `/zero-token`으로 도착해 404가 된다. 더 구체적인 경로가 이기므로
기존 `/recaps`(:8090) 마운트는 그대로 산다. 확인은 `serve status`.

## 업데이트 (코드가 바뀌었을 때)

```bash
# 맥북
cd <worktree> && rsync -az --delete \
  --exclude node_modules --exclude target --exclude .git --exclude ops/mini/env.sh \
  ./ <hub-user>@<hub-host>:/Users/vigor/omnis/
# 미니
ssh <hub-user>@<hub-host> 'export PATH=/opt/homebrew/bin:$PATH; cd /Users/vigor/omnis &&
  pnpm install --prod=false --frozen-lockfile && pnpm build &&
  DATABASE_URL="postgres://vigor@127.0.0.1:5432/omnis" pnpm db:migrate &&
  for s in hub zero-cache local-agent; do launchctl kickstart -k "gui/501/com.omnis.$s"; done'
```
`packages/kernel/src/zero-schema.ts`나 `OMNIS_USER_ID`가 바뀌었으면 `pnpm zero:deploy-permissions`를
zero-cache 재기동 **전에** 한 번 더 돌린다 — 안 그러면 쿼리는 resolve되는데 행이 0개로 나온다.

> `--delete`는 미니 쪽에만 있는 파일을 지운다. `ops/mini/env.sh`는 제외 목록에 있으니 살아남는다.
> `--exclude dist`를 넣지 않으면 맥북에서 빌드한 산출물이 덮어써진다 — 미니에서 다시 `pnpm build`하면 된다.

## Web Push VAPID 키 (US-B16)

```bash
bash ops/scripts/gen-vapid.sh --check     # 있는지만 확인, 아무것도 안 바꾼다
bash ops/scripts/gen-vapid.sh             # 없을 때만 생성(둘 중 하나라도 있으면 거부)
bash ops/scripts/gen-vapid.sh --force     # 회전(유출 의심 시 즉시, 정기는 분기 1회 — A6 §9)
```

**키가 사는 곳은 미니 한 대다.** 키는 hub가 쓰고 hub는 미니에서만 돈다 — 맥북 로그인 Keychain에는
`omnis.webpush.*` 항목이 없는 게 정상이고, 맥북에서 `--check`는 `missing omnis.webpush.vapid_public`
으로 1을 내고 끝나야 한다(그게 이 명령의 설계된 동작이다). 맥북에서 키를 만들지 말 것 — 만들어도
hub가 못 읽고, 실제 비밀만 하나 더 생긴다.

**ssh 셸에서는 생성이 안 된다** — 위 "4) 비밀" 항목과 같은 이유로 `security add-generic-password`가
`Background` 세션에서 거절당한다. 미니에서의 생성·회전은 1회성 LaunchAgent로 gui/501에 넣어 돌린다.

### 회전 절차 6단계 (A6 §9)

1. **새 값 발급** — `bash ops/scripts/gen-vapid.sh --force`(gui/501 세션에서). 스크립트가 `node:crypto`
   로 새 P-256 키쌍을 만든다. 채널 콘솔 재발급이 필요한 다른 비밀과 달리 발급처가 우리 자신이다.
2. **저장** — 같은 명령이 Keychain `omnis.webpush.vapid_public` / `…vapid_private`를 덮어쓴다
   (`-U`). A6 §9 원문의 `sops secrets/<host>.enc.yaml` 단계를 이 리포에서는 Keychain이 대신한다.
3. **git commit — 해당 없음.** VAPID 키는 파일로 존재하지 않으므로 커밋할 것이 없다. 값이 diff·로그·
   셸 히스토리에 들어가면 그 자체가 유출이다. 커밋할 것은 절차 변경(이 문서)뿐이다.
4. **재기동** — `launchctl kickstart -k gui/$(id -u)/com.omnis.hub`. hub가 `env.sh` 경유로
   `OMNIS_WEBPUSH_VAPID_PUBLIC`/`…PRIVATE`를 다시 읽는다(배선은 US-B17). 전체 재부팅은 불필요.
5. **검증** — 재기동이 서비스를 깨지 않았는지 확인한다. healthchecks.io의 hub job이 다음 주기에 정상
   ping을 보내는지 보고(잡 배선은 US-B43), 그 전에 `curl -s http://127.0.0.1:8787/health`가
   `{"ok":true,...}`인지 확인한다. 실패하면 `~/Library/Logs/omnis/hub.log`부터 본다.
6. **감사 기록** — `audit_log`에 회전 이벤트를 남긴다. **키 값은 절대 넣지 않는다** — 서비스 이름과
   시각만 남긴다.
   ```bash
   psql -U vigor -d omnis -c "INSERT INTO audit_log (actor, action, target_table, after) \
     VALUES ('me', 'secret.rotate', 'keychain', \
             '{\"services\":[\"omnis.webpush.vapid_public\",\"omnis.webpush.vapid_private\"]}'::jsonb)"
   ```

회전하면 이전 VAPID 키로 만든 구독은 전부 무효다 — 회전 직후 `push_subscriptions`를 비우고 기기에서
재구독시킨다(정리 로직은 US-B17).

## 백업 · 복구 리허설 (US-B41)

매일 03:00에 LaunchAgent `com.omnis.backup`이 `ops/scripts/omnis-backup.sh`를 돌린다:
`pg_dump --format=custom` → `$HOME/omnis-var/backup/pg/omnis-YYYYMMDD.dump` → `restic backup` → B2,
그다음 `restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune`와 로컬 덤프 7일 정리.
성공/실패는 exit code로만 알린다(healthchecks.io 배선은 US-B42).

처음 1회(미니, gui 세션):

```bash
brew install restic                                    # pg_dump는 postgresql@17에 이미 있다
# Keychain 4개 — 값은 붙여넣지 말고 프롬프트로(-w 생략) 넣는다. ssh 셸에서는 거절당한다("4) 비밀" 참조).
for s in omnis.restic.repository omnis.restic.password omnis.b2.account_id omnis.b2.account_key; do
  security add-generic-password -U -s "$s" -a 281932556+jinhologankim@users.noreply.github.com -w
done
restic -r "$(security find-generic-password -s omnis.restic.repository -a 281932556+jinhologankim@users.noreply.github.com -w)" init
bash ops/scripts/omnis-backup.sh --check               # pg_dump·restic·Keychain 4개 확인만
ops/mini/install.sh backup                             # 03:00 예약(kickstart 안 함 — 걸기만 한다)
```

`restic init`은 스크립트가 하지 않는다 — 리포 생성은 1회성이라 매 실행 존재 확인 로직을 넣지 않는다.

분기 1회 복구 리허설:

```bash
bash ops/scripts/restore-drill.sh --dry-run   # 최신 덤프가 읽히는지만(아무것도 복원하지 않는다)
bash ops/scripts/restore-drill.sh             # 스크래치 포트 5433 omnis_restore_drill에 실복원 + row count
```

인자 없이 돌린 결과는 `backup/restore-drills.md`에 PASS/FAIL로 append된다. 스크래치 인스턴스가
5433에 떠 있어야 하고(`OMNIS_RESTORE_PORT`로 바꿀 수 있다), 드릴이 끝나면 그 DB는 지워진다.
FAIL이면 다음 분기로 미루지 않고 즉시 Sev1로 고친다(A6 §4).

## 상태 확인

```bash
launchctl print gui/501/com.omnis.hub | grep -E '^\s+(state|pid|last exit code) = '
curl -s http://127.0.0.1:8787/health                         # {"ok":true,"db":"up",...}
curl -s https://your-hub.your-tailnet.ts.net/health       # 맥북/아이폰에서
curl -so /dev/null -w '%{http_code}\n' \
  https://your-hub.your-tailnet.ts.net/api/zero-token       # 200 (허브 라우트가 실제로 /api/zero-token이다)
curl -so /dev/null -w '%{http_code}\n' http://127.0.0.1:4848/   # zero-cache → 200
grep '"bridge connected"' ~/Library/Logs/omnis/hub.log | tail -1   # local-agent 등록 확인
psql -U vigor -d omnis -Atc \
  "SELECT slot_name, active, wal_status FROM pg_replication_slots"  # zero_0_a|t|reserved
```

`agent_runtimes` 테이블은 **Phase A에서 아직 안 찬다** — `apps/local-agent/src/main.ts`가 어댑터 맵을
비운 채로 뜨기 때문에 `register` 알림을 보내지 않는다. 브리지 등록 여부는 위의 hub 로그 한 줄로 본다.

## 로그

```bash
tail -f ~/Library/Logs/omnis/hub.log          # JSON 한 줄씩
tail -50 ~/Library/Logs/omnis/zero-cache.err.log
```
로테이션은 아직 없다(A6 §8의 logrotate 30일은 Later). 커지면 손으로 자른다.

## 롤백

1. 코드만 되돌리기: 이전 커밋 워크트리에서 위 **업데이트** 절차를 그대로 한 번 더 돈다.
2. 서비스만 멈추기: `launchctl bootout gui/501/com.omnis.<service>`
3. zero-cache가 이상하면 replica 파일을 버리고 재기동한다(업스트림 데이터는 안 없어진다):
   ```bash
   launchctl bootout gui/501/com.omnis.zero-cache
   psql -U vigor -d omnis -Atc "SELECT pg_drop_replication_slot('zero_0_a')"
   rm -f ~/omnis-var/zero-replica.db*
   launchctl bootstrap gui/501 ~/Library/LaunchAgents/com.omnis.zero-cache.plist
   ```
4. 마이그레이션 롤백은 없다(전진 전용). 되돌려야 하면 `pg_dump` 복원이다 — 백업은 A6 §4, 아직 미구현.

## 제거

```bash
for s in hub zero-cache local-agent; do
  launchctl bootout "gui/501/com.omnis.$s" 2>/dev/null
  rm -f ~/Library/LaunchAgents/com.omnis.$s.plist
done
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve --https=443 --set-path=/ off   # /recaps는 남긴다
psql -U vigor -d omnis -Atc "SELECT pg_drop_replication_slot('zero_0_a')"   # 슬롯부터. 안 지우면 WAL이 쌓인다
dropdb -U vigor omnis
rm -rf /Users/vigor/omnis /Users/vigor/omnis-var ~/.omnis ~/Library/Logs/omnis
# Keychain 항목 3개는 GUI 세션에서: security delete-generic-password -s omnis.bridge.token.mini -a 281932556+jinhologankim@users.noreply.github.com
```
`wal_level=logical`은 되돌리지 않는다 — 되돌리려면 `ALTER SYSTEM RESET wal_level` + Postgres 재기동이고
miniflux가 같이 끊긴다.

## 이 배포가 미니에 실제로 바꾼 것 (2026-09-20)

| 시각(UTC) | 변경 |
|---|---|
| 08:41 | `brew install pgvector` (0.8.6) |
| 08:42 | `createdb omnis`, `CREATE SCHEMA zero_cvr` |
| 08:42:55 | `ALTER SYSTEM SET wal_level='logical'` + `brew services restart postgresql@17` — **miniflux가 몇 초 끊겼다**. 재기동 후 miniflux 접속 정상 확인. brew가 서비스 라벨을 `homebrew.mxcl.postgresql@17` → `sh.brew.postgresql@17`로 바꿨다(brew 7.x 동작, 중복 없음) |
| 08:43 | 마이그레이션 0001–0008 적용 (`omnis` DB) |
| 08:45 | Keychain 항목 3개 생성, LaunchAgent 3개 bootstrap |
| 08:45 | `zero:deploy-permissions` (hash 6ed5e84) |
| 08:48 | `tailscale serve --bg --https=443 --set-path=/api http://127.0.0.1:8787` — 기존 `/recaps` 마운트는 그대로 |
| 11:3x | `tailscale serve --bg --set-path=/ http://127.0.0.1:8787` + `--set-path=/api off` — `/api` prefix strip 때문에 `/api/zero-token`이 404였다. 이제 `/`에 그대로 붙는다(`/health` 200, `/api/zero-token` 200, `/recaps` 200 유지) |

`npm i -g pnpm@9.12.3`도 이때 깔았다. Postgres의 메모리 파라미터(A6 §4)는 **건드리지 않았다**.
