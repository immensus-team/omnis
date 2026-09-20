# A6 — 운영·인프라

버전 1.0 (2026-09-20, pass 2). 근거: `00-omnis-design.md` v1.0(D1~D16, 특히 D7·D9·D11·D12), `99-review.md`, `99-review-v2.md`, `A1-channel-adapters.md` §4, `A2-agent-session-bridge.md` §2.1, `research/18-mac-mini-hub-ops.md`, `research/09-agents-as-inbox.md`, `research/13-client-arch-sync.md`, `research/27-gap-event-volume-and-sync-budget.md`, `research/15-security-privacy.md`, `research/25-gap-standalone-and-kakao-session-rule.md`, `research/20-gap-eve-self-host-spike.md`.

이 부록은 마스터 설계 §15(운영), §16(Phase 0), D11(허브 운영 분리), D12(standalone 재정의)를 구현 가능한 수준까지 내린다. 마스터 문서의 결정과 충돌하면 마스터가 이긴다 — 이 부록은 확장만 한다.

## 이 부록이 확정하는 결정

| # | 결정 | 근거 | 폴백 |
|---|---|---|---|
| A6-D1 | 미니 프로세스는 표(§1)대로 LaunchDaemon 5개(Postgres, omnis-hub, zero-cache, Ollama, healthcheck ping) / LaunchAgent 4개(kmsg watch, Playwright 프로필, Beeper Desktop, local-agent)로 고정 배치 | TN2083: daemon은 window server 접속 불가(`18`) | 없음 — 구조적 제약이라 대안 없음 |
| A6-D2 | FileVault는 ON을 먼저 시도(스파이크 ③, §2 8번 순서대로 §2 1번보다 먼저 실행)하고, 그 결과가 fail이면(자동 로그인이 막히면) 그때만 OFF로 내리며 동시에 tailnet-only 노출(Funnel 금지, Tailscale ACL만)로 좁히고 이 전환은 Logan 승인 필수 | FileVault ON 상태 자동 로그인 가능 여부는 macOS 26.6 기준 1차 문서로 미확인(`18`) | OFF + tailnet-only + 물리 보안(통제된 공간) 보완 |
| A6-D3 | 부팅/로그인마다 `pmset`·`caffeinate`·자동 로그인 설정을 재적용하는 `omnis-reapply-settings` LaunchAgent를 둔다 | macOS 업데이트가 전원 설정을 리셋시키는 사례가 실무에 흔함(`18`, UNVERIFIED이나 운영 상식으로 명시) | 없음 |
| A6-D4 | Postgres는 **17 고정** + pgvector, `idle_replication_slot_timeout = '3d'`로 명시 설정 | 기본값 0(비활성)이면 WAL 무한 누적 리스크(`27`); 버전은 99-review §1.2로 A3·A7과 정렬 | 슬롯 헬스체크가 먼저 걸리므로 3일 전에 사람이 개입 가능 |
| A6-D5 | zero-cache는 공식 권장치(Replication 2GB + View Syncer 4GB)가 아니라 합계 1.5GB 캡으로 축소 배치 | omnis는 1유저 2~3디바이스로 처리량 상한에 전혀 안 걸림(`27`), 16GB 예산이 진짜 제약(`18`) | 실측 시 부족하면 상한을 단계적으로 올림 |
| A6-D6 | Ollama는 `nomic-embed-text-v1.5` 고정 탑재, 1~3B 분류기는 스파이크 결과 전까지 미탑재(T0는 규칙 기반으로 시작) | 임베딩 모델은 마스터 D6·D10에서 확정. 분류기 후보 모델명은 6개 리서치 범위에 없음 | 스파이크 실패 시 규칙 기반 유지, T1(DeepSeek)로 애매한 건만 승격 |
| A6-D7 | 16GB 예산 분배는 §7 표대로: OS 2GB / Postgres 3GB / hub 1GB / zero 1.5GB / Ollama 1GB / kmsg 0.2GB / Playwright 0.8GB / Beeper 0.4GB / healthcheck 0.05GB / local-agent(미니) 0.2GB, 나머지 ~5.8GB는 헤드룸 | 개별 컴포넌트 주장치의 합, 통합 실측치는 리서치에 없음(`18` Open Questions) | Spike A6-9로 실측 후 재분배(Phase A 종료 전 필수) |
| A6-D8 | healthchecks.io job은 §8 표의 15개로 시작(미니 local-agent 추가분 포함, 무료 티어 20개 한도 내), ntfy 토픽은 `omnis-critical`/`omnis-warning` 2단 분리 | 무료 티어 20 jobs 한도(`18`) | Business $20/월(job 100개)로 업그레이드 |
| A6-D9 | Keychain 명명 규칙은 A1이 이미 코드 예시(`keychainService: "omnis.slack.xoxp"` 등)로 확정한 점(`.`) 구분 스킴 `omnis.<channel>.<kind>.<external_id>`를 그대로 따른다(예: `omnis.slack.xoxb.<team_id>`, `omnis.gmail.<email>`, `omnis.telegram.session_key` — external_id가 없는 단일 비밀은 `<kind>`까지만). 채널이 아닌 서비스(Anthropic API 키, macbook/mini local-agent 세션버스 토큰 등)는 같은 스킴을 `omnis.<service>.<kind>`로 확장한다. 기존 자산(`deepseek-api` 등)은 재생성 없이 그대로 재사용 | A1-channel-adapters.md §1.3 AuthRef·§Adapter별 온보딩 절 코드 예시. 하이픈 스킴(구 A6-D9)은 A1과 충돌해 폐기(99-review §1.2) | 없음 |
| A6-D10 | 맥북·미니 양쪽의 `local-agent`는 로그인 세션 LaunchAgent(root LaunchDaemon 아님) | CLI 에이전트(`claude`/`codex`)는 유저 셸 환경·Keychain 세션에 종속(`18`의 daemon/agent 구분 원리를 확장). 미니의 local-agent는 Codex와 Hermes만 노출하므로 `codex` CLI가 대상인데, `codex app-server` 자체는 GUI 접속이 필요 없는 headless JSON-RPC 프로세스지만(`09`) 로그인 셸 PATH·nvm·Keychain 세션에 기동을 의존하는 CLI 실행 방식은 맥북과 같다 — 게다가 미니는 A6-D1에 따라 KakaoTalk·Playwright·Beeper 때문에 어차피 GUI 세션을 상시 유지해야 하므로 local-agent를 그 세션에 얹는 데 추가 비용이 없다. 이 근거는 `18`/`09`가 준 원리의 연역이지 두 파일에 직접 명시된 사실은 아니다 | 없음 |
| A6-D11 | Phase D standalone에서도 KakaoTalk·LinkedIn 캡처 호스트는 기본값으로 미니를 유지("capture sidecar"로 격하), 완전 은퇴는 별도 결정 사항 | 미니 유지가 가장 싼 우회책, 맥북 단독 전환 시 슬립/이동 중 캡처 gap 발생(`25`) | 맥북 클램쉘+상시전원 — Later, 하드웨어 마모 리스크 미검증 |
| A6-D12 | Phase 0(2주) 게이트 14개 중 A6가 직접 도는 8개(①~⑧)는 §11 절차·pass 기준·기록표로 확정, 나머지 6개(A1-④·⑤, S-A2-1·2, S-A3-2, A7-1)는 소유 부록 원문을 참조로만 표기. A6 전용 추가 스파이크 2개(16GB 통합 실측=A6-9, Ollama 분류기 선정=A6-10)는 "Phase 진입 시 16개"에 속하고 Phase A 종료 전 필수(99-review §5) | 마스터 §16·99-review §5 | 없음 |

---

## 1. 미니 프로세스 배치표

TN2083이 명시하듯 **LaunchDaemon은 global bootstrap namespace에서 돌고 window server에 접속할 수 없다** — GUI가 필요한 프로세스를 daemon으로 띄우는 건 설정 실수가 아니라 애초에 불가능하다(`18`). KakaoTalk.app의 AX 트리를 읽는 kmsg, LinkedIn용 상주 브라우저 프로필, Beeper Desktop(Electron GUI 앱)은 전부 로그인된 유저 세션에 종속된 `~/Library/LaunchAgents`로 가야 하고, headless API/DB/추론 서버는 `/Library/LaunchDaemons`로 간다.

| 프로세스 | 유형 | 이유 | KeepAlive | 로그 경로 | 환경변수 주입 |
|---|---|---|---|---|---|
| Postgres | LaunchDaemon | GUI 불필요, 부팅 즉시 필요(로그인 전에도 다른 서비스가 붙을 수 있어야 함) | `true` | `/usr/local/var/log/postgresql@17.log` | `sops`로 복호화한 `PGDATA`, 슈퍼유저 비번은 로컬 peer 인증으로 대체(원격 노출 없음) |
| omnis-hub (Node) | LaunchDaemon | 커널 API·스케줄러·session bus, headless | `true` + `ThrottleInterval 10` | `~/Library/Logs/omnis/hub.log` (`StandardOutPath`/`StandardErrorPath` 분리) | wrapper 스크립트가 `secrets/mini.enc.yaml`을 복호화해 `DATABASE_URL`, 채널 OAuth 클라이언트 시크릿 등을 export 후 exec |
| zero-cache | LaunchDaemon | Postgres 복제 컨슈머, headless | `true` | `~/Library/Logs/omnis/zero-cache.log` | `ZERO_UPSTREAM_DB`, `ZERO_CVR_DB`(별도 연결, `27`), `ZERO_REPLICA_FILE` |
| Ollama | LaunchDaemon | HTTP 추론 서버, GUI 불필요 | `true` | `~/Library/Logs/omnis/ollama.log` | `OLLAMA_HOST=127.0.0.1:11434`(tailnet 노출 안 함, hub만 호출) |
| healthcheck ping | LaunchDaemon | 다른 프로세스가 다 죽어도 독립적으로 살아있어야 하는 워치독 | `false`(주기 실행) + `StartInterval 300` | `~/Library/Logs/omnis/healthcheck.log` | `HC_UUIDS`(healthchecks.io ping URL 목록) |
| kmsg watch | LaunchAgent | KakaoTalk.app의 Accessibility(AX) 트리를 읽으려면 window server 세션 필요(TN2083, `18`) | `true` | `~/Library/Logs/omnis/kmsg.log` | `KMSG_OUTPUT_SOCKET`(hub로의 로컬 HTTP/유닉스 소켓) |
| Playwright 상주 프로필(LinkedIn) | LaunchAgent | 실제 브라우저 창(비-headless)으로 사람다운 세션 유지, GUI 필요 | `true` | `~/Library/Logs/omnis/linkedin-bridge.log` | `LINKEDIN_PROFILE_DIR` |
| Beeper Desktop | LaunchAgent | Electron GUI 앱, WhatsApp 로컬 REST/WS API 제공 | `true` | `~/Library/Logs/omnis/beeper.log` | 앱 자체가 최초 1회 QR/로그인 후 로컬 상태 보관 — 별도 env 불필요, 토큰은 Beeper 앱이 자체 관리 |
| local-agent (미니) | LaunchAgent | Codex CLI·Hermes 브리지. GUI 접속은 불필요하나 로그인 셸 PATH·Keychain 세션 종속은 맥북과 동일(A6-D10) — 어차피 위 3개 Agent 때문에 GUI 세션이 상시 필요해 추가 비용 없음 | `true` | `~/Library/Logs/omnis/local-agent-mini.log` | `secrets/mini.enc.yaml`에서 session bus 인증 토큰, `HERMES_BASE_URL=http://127.0.0.1:8642`(로컬 전용) |

Daemon과 Agent 사이의 통신은 별도 IPC를 설계하지 않는다 — omnis-hub가 이미 로컬 HTTP(`127.0.0.1:8787`)로 떠 있으므로(8642는 Hermes `api_server`가 이미 쓰고 있어 피한다, 마스터 §4.2·§15) kmsg/Playwright/Beeper/local-agent 쪽 Agent가 hub에 HTTP로 이벤트를 push하는 것으로 충분하다(`18`의 "두 계층 간 통신은 로컬 HTTP로 이미 하고 있으니 추가 IPC 설계는 불필요" 권고 그대로 채택). local-agent만 예외로 Hermes(`127.0.0.1:8642`)에도 로컬 접속한다 — 이 접속은 미니 내부로 닫혀 있고 tailnet에 노출되지 않는다.

**프로세스 감독 도구**: `18`은 pm2를 편의 계층으로 제안하지만, omnis MVP는 프로세스 수가 8개로 launchd plist를 손으로 관리해도 부담이 크지 않다 — 마스터 D11도 pm2를 언급하지 않고 LaunchDaemon/LaunchAgent 분리만 명시한다. pm2는 서비스 수가 늘어나 로그 로테이션·crash loop 가시성이 실제로 아쉬워지는 시점(Phase C 이후, 채널 sidecar가 5개 이상)에 Later로 재검토한다(pm2도 결국 내부적으로 launchd plist를 생성하므로 daemon/agent 분리 원칙 자체는 안 바뀐다, `18`).

### plist 예시 1 — LaunchDaemon (omnis-hub)

```xml
<!-- /Library/LaunchDaemons/ai.onwordlab.omnis-hub.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>ai.onwordlab.omnis-hub</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/omnis-run-with-secrets.sh</string>
    <string>mini</string>
    <string>/usr/local/bin/node</string>
    <string>/opt/omnis/hub/dist/main.js</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>/Users/logan/Library/Logs/omnis/hub.log</string>
  <key>StandardErrorPath</key><string>/Users/logan/Library/Logs/omnis/hub.err.log</string>
  <key>UserName</key><string>logan</string>
  <key>WorkingDirectory</key><string>/opt/omnis/hub</string>
</dict>
</plist>
```

`omnis-run-with-secrets.sh mini`는 `secrets/mini.enc.yaml`을 `sops`+`age`로 복호화해 최상위 키를 환경변수로 export한 뒤 나머지 인자를 `exec`한다(§9). `UserName`을 지정해도 LaunchDaemon은 daemon 네임스페이스에서 돌아 window server에는 여전히 접속 못 한다 — 이 항목은 "어떤 유닉스 유저 권한으로 파일을 쓰는가"만 결정하며 GUI 접근권과는 무관하다(`18`).

### plist 예시 2 — LaunchAgent (kmsg watch)

```xml
<!-- ~/Library/LaunchAgents/ai.onwordlab.omnis-kakao-bridge.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>ai.onwordlab.omnis-kakao-bridge</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/omnis-run-with-secrets.sh</string>
    <string>mini</string>
    <string>/usr/local/bin/kmsg</string>
    <string>watch</string>
    <string>--json</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/logan/Library/Logs/omnis/kmsg.log</string>
  <key>StandardErrorPath</key><string>/Users/logan/Library/Logs/omnis/kmsg.err.log</string>
</dict>
</plist>
```

이 파일은 `~/Library/LaunchAgents`(root가 아니라 `logan` 유저 홈)에 두고 `launchctl bootstrap gui/$(id -u logan)`으로 등록한다 — daemon 네임스페이스(`system`)가 아니라 GUI 세션 네임스페이스(`gui/<uid>`)에 붙여야 window server에 접근할 수 있다.

---

## 2. 미니 OS 설정 절차

1. **자동 로그인**: System Settings → Users & Groups → Automatic login을 `logan` 계정으로 설정. FileVault가 켜진 상태에서 이게 되는지는 스파이크 ③(§11) 결과로 확정한다 — A6-D2.
2. **화면 비잠금**: 화면보호기 비활성화(System Settings → Lock Screen → "Start Screen Saver when inactive" → Never), "Require password after screen saver" 끄기.
3. **`pmset`**: `sudo pmset -c sleep 0 displaysleep 0 disksleep 0`(AC 전원 프로필. 미니는 배터리가 없으므로 `-a`가 아니라 `-c`로 충분, `18`). 부팅 직후 및 macOS 업데이트 후 리셋될 수 있으므로 §2 5번(재적용 LaunchAgent)의 스크립트에 포함한다.
4. **`caffeinate` 이중화**: pmset이 리셋돼도 세션이 잠기지 않도록 로그인 시 `caffeinate -disu &`를 실행하는 LaunchAgent를 별도로 둔다(`18` 권고). `-d`(디스플레이 슬립 방지) `-i`(유휴 슬립 방지) `-s`(시스템 슬립 방지) `-u`(유저 활동 시뮬레이션, 화면 잠금 방지에 실질적으로 기여) 네 플래그를 모두 켠다.
5. **부팅 시 재적용 LaunchAgent(`omnis-reapply-settings`)**: 로그인마다 (a) `pmset -c sleep 0 displaysleep 0 disksleep 0`을 재실행, (b) `caffeinate -disu` 프로세스가 살아있는지 확인 후 없으면 기동, (c) 자동 로그인 설정이 유지되는지 `dscl`로 확인해 어긋나면 healthchecks.io `omnis-critical`로 즉시 알림. macOS 업데이트가 전원 설정을 리셋시키는 사례가 실무에서 흔하다는 지적(`18`)에 대한 직접 대응이다.
6. **Screen Sharing over tailnet**: System Settings → General → Sharing → Screen Sharing 켜기. 접근은 macOS 내장 화면 공유 앱에서 `vnc://<mini-hostname>.ts.net` 또는 tailnet IP(`100.x.x.x`)로 접속 — Tailscale이 사설 IP/MagicDNS를 제공하므로 포트포워딩이나 별도 설정 없이 그대로 동작한다(원리상 타당함은 확인, 전용 macOS 가이드 문서는 `18`에서 UNVERIFIED로 남음). macOS 자체의 "다음 사용자만 허용" 제한은 걸어두되, 1차 방어선은 Tailscale ACL(§3)로 건다 — 이중 방어.
7. **무인 업데이트 정책**: System Settings → General → Software Update → Automatic Updates를 끈다(기본값). Logan이 물리적으로 있거나 Screen Sharing 세션을 열어둔 상태에서 월 1회 수동으로 업데이트를 적용하고, 적용 전후로 §11의 재적용 스크립트가 정상 동작하는지 확인한다. 근거: FileVault-OFF/자동 로그인 조합은 예기치 않은 재부팅에 취약하고(`18`), 무인 자동 업데이트가 그 재부팅을 트리거할 수 있다. 조건: 보안 컴플라이언스 요구가 생기면 "Install Security Responses and system files"만 자동으로 켜고 메이저 OS 업그레이드는 계속 수동으로 유지한다.
8. **FileVault 스파이크 절차**: §11 스파이크 ③ 참조. 이 항목은 순서상 1번보다 먼저 실행해야 한다 — FileVault를 켤지 끌지가 자동 로그인 설정 자체에 영향을 준다.

---

## 3. 네트워크

미니는 공인 인터넷에 어떤 포트도 직접 열지 않는다. 모든 노출은 Tailscale을 경유한다(`15`의 "mini는 tailnet-only로 제한" 권고를 그대로 채택).

**Tailscale ACL 예시** (device tag 기반, Grants 문법 — 정확한 최신 스키마는 구현 시점에 Tailscale 공식 문서로 재확인, `15`가 Grants(신형)/ACL(구형) 두 문법이 공존한다고 명시):

```json
{
  "tagOwners": {
    "tag:hub": ["logan@onwordlab.ai"],
    "tag:client": ["logan@onwordlab.ai"]
  },
  "grants": [
    {
      "src": ["tag:client"],
      "dst": ["tag:hub"],
      "ip": ["tcp:443", "tcp:8787"]
    }
  ],
  "ssh": [
    {
      "action": "check",
      "src": ["tag:client"],
      "dst": ["tag:hub"],
      "users": ["logan"]
    }
  ]
}
```

미니는 `tag:hub`, 맥북·아이폰은 `tag:client`로 태깅한다. `dst`에 Postgres 포트(5432)나 Ollama 포트(11434)를 넣지 않는다 — 클라이언트는 오직 hub API(`127.0.0.1:8787`에만 바인딩, 8642는 Hermes `api_server`가 이미 쓰므로 피한다 — 마스터 §4.2·§15)와 HTTPS(443, `tailscale serve`가 리슨)로만 접근하고, Postgres·Ollama·Hermes는 hub(또는 hub 안의 local-agent 브리지) 프로세스를 거쳐서만 쓰인다(공격 표면 최소화, `15`의 tailnet-only 원칙과 일치).

**`tailscale serve` 설정**: hub API와 PWA를 같은 HTTPS 엔드포인트 아래 다른 path로 노출한다.

```bash
sudo tailscale serve --bg --https=443 /api/ localhost:8787/
sudo tailscale serve --bg --https=443 / localhost:5173/   # PWA 정적 서빙(빌드 산출물)
```

`*.ts.net` 인증서는 Tailscale이 자동 발급한다(`15`). 아이폰 Safari에서 `<mini-hostname>.ts.net` 접속이 SSL 에러로 막히는 오픈 이슈(#19147)가 있으나, 실제로는 5개 댓글이 달려 있고 유력한 원인은 서드파티 DoH/private-DNS 앱이 `.ts.net` 이름 해석을 방해하는 것이었다(Tailscale 자체 결함이 아닐 가능성, `13`의 adversarial 재검증). 스파이크 ⑤(§11)에서 아이폰에 DoH 앱/프로파일이 있는지 먼저 확인하고 제거 후 재현 테스트를 한다.

**MagicDNS**: 켜둔다(기본 활성 가정) — `<mini-hostname>.ts.net`이 스파이크 ⑤의 기본 접속 경로다. IP(`100.x.x.x`)는 MagicDNS 실패 시 폴백으로만 쓴다.

**Funnel**: 원칙적으로 쓰지 않는다(공인 인터넷에 노출되므로 마스터 §15 "Funnel은 Calendar push 스파이크에만"과 일치). Google Calendar `events.watch`는 구글 서버가 공인 HTTPS 엔드포인트로 webhook을 쏘기 때문에 tailnet-only로는 받을 수 없다 — 스파이크 ①(§11) 동안만 `tailscale funnel --bg 443 on`으로 임시로 켜고, 스파이크 종료 즉시(pass든 fail이든) `tailscale funnel 443 off`로 끈다. Funnel이 상시로 켜져 있어야 하는 결과가 나오면(즉 push가 실용적이려면 상시 공개 노출이 불가피하면) 이는 채널 매트릭스(마스터 §8)의 Calendar 폴백(`events.list` + syncToken 폴링)을 기본값으로 확정하는 근거가 된다 — 이미 마스터가 그렇게 설계해뒀다.

---

## 4. Postgres 설정

- **버전**: `brew install postgresql@17`로 **17 고정**(A3·A7과 정렬, 99-review §1.2 — "16+"나 "설치 시점 최신"처럼 흔들리는 표현은 폐기). `brew install pgvector` 후 각 DB에서 `CREATE EXTENSION vector;`.
- **메모리 파라미터(16GB 예산 내, §7의 Postgres 3GB 배정에 맞춤)**:

```ini
# postgresql.conf 발췌
shared_buffers = 2GB
effective_cache_size = 6GB      # OS 페이지 캐시 포함 추정치, 다른 프로세스와 공유
work_mem = 32MB
maintenance_work_mem = 512MB
max_connections = 40             # hub + zero-cache + 어댑터 수 대비 여유
wal_level = logical              # Zero 복제에 필수
max_wal_senders = 5
max_replication_slots = 5
idle_replication_slot_timeout = '3d'
```

- **`idle_replication_slot_timeout` 명시**: 기본값은 0(비활성)이라 zero-cache가 죽은 채 방치되면 WAL이 무한정 쌓여 디스크를 채울 수 있다(`27`). 3일을 기본값으로 잡는다 — KeepAlive=true인 zero-cache는 crash 즉시 launchd가 재기동하므로 정상 운영 중에는 슬롯이 몇 초 이상 idle일 일이 거의 없고, 3일은 "미니가 며칠간 전원이 나가 있었다" 같은 심각한 장애 시나리오에도 슬롯 헬스체크(아래)가 먼저 경보를 울리는 시간이다. 조건: 디스크 여유가 50GB 미만으로 좁아지면 1일로 단축한다.
- **슬롯 헬스체크**: healthcheck ping 프로세스(§1)가 15분마다 아래 명령으로 슬롯 상태를 조회해 `active=false`가 10분 이상 지속되거나 `wal_status`가 `lost`에 가까워지면 `omnis-critical` ntfy 토픽으로 즉시 알림(§8, `omnis-pg-slot` job).

```bash
psql -U postgres -d omnis -Atc \
  "SELECT slot_name, active, wal_status, pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained_wal FROM pg_replication_slots;"
```
- **백업**: `pg_dump --format=custom`을 매일 03:00(로컬, 저사용 시간대)에 실행해 `/opt/omnis/backup/pg/omnis-YYYYMMDD.dump`로 저장, 같은 파일과 self-model 파일(`USER.md`/`VOICE.md`/`PROJECTS.md`, git 추적)·`secrets/*.enc.yaml`을 함께 restic으로 Backblaze B2(`omnis-backup-mini` 버킷, S3 호환 엔드포인트)에 암호화 증분 백업한다.

```bash
# /usr/local/bin/omnis-backup.sh (LaunchDaemon StartCalendarInterval Hour=3 Minute=0)
pg_dump --format=custom --file="/opt/omnis/backup/pg/omnis-$(date +%Y%m%d).dump" omnis
restic -r b2:omnis-backup-mini:/repo backup \
  /opt/omnis/backup/pg /opt/omnis/self-model /opt/omnis/secrets
restic -r b2:omnis-backup-mini:/repo forget \
  --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune
```

보관 정책(7일/4주/6개월)은 리서치에 고정값이 없는 합리적 기본값이다 — B2 비용이나 RPO 요구가 바뀌면 조정한다.

- **복구 리허설**: 분기 1회, 최신 `pg_dump` 파일을 스크래치 Postgres 인스턴스(별도 포트, 예: 5433)에 `pg_restore`로 복원하고 핵심 테이블(`items`, `threads`, `pending_approvals`) row count와 최신 `items.sent_at`이 최근인지 검증하는 스크립트를 돌린 뒤 결과를 리허설 로그(`backup/restore-drills.md`)에 남긴다. 실패하면 다음 분기까지 미루지 않고 즉시 Sev1로 수정한다.

---

## 5. Zero (zero-cache)

- **배치**: §1 표대로 미니의 LaunchDaemon. Replication Manager와 View Syncer를 별도 프로세스로 쪼개지 않고 zero-cache 단일 프로세스로 묶어 기동한다(1유저 2~3디바이스 규모에서 공식 권장 멀티노드 구성은 과설계, `27`).
- **권한**: Postgres에 `zero_replication`이라는 전용 role을 만들어 `REPLICATION` 속성만 부여하고 superuser는 주지 않는다. `ZERO_CVR_DB`(client view record 저장)는 별도 연결 문자열로 지정한다 — 같은 Postgres 인스턴스의 별도 스키마(`zero_cvr`)를 쓰되 upstream 스키마와는 분리해 권한 경계를 명확히 한다(`27`의 "CVR DB는 별도 커넥션이 필요" 사실 반영).
- **리소스 캡**: 메모리 1.5GB로 시작(A6-D5). Zero의 정량적 처리량 상한은 공개되어 있지 않지만 "row 수 기준으로 스케일"하는 모델이라(`27`) omnis 규모에서 상한에 걸릴 걱정보다 메모리 풋프린트가 실질적 제약이다.
- **업그레이드**: `package.json`에 정확한 버전을 pin한다(`rocicorp/mono`는 활발하지만 open issue 232건으로 드리프트 리스크가 있다, `13`). 업그레이드 전 로컬 스크래치 Postgres 클론에서 신버전 zero-cache를 먼저 기동해 마이그레이션/스키마 호환을 확인한 뒤에만 미니의 LaunchDaemon plist가 가리키는 바이너리 경로를 교체한다. 롤백은 이전 버전 바이너리를 나란히 남겨두고 plist의 경로만 되돌리는 방식으로 수 분 내 가능하게 한다.

---

## 6. Ollama

- **모델 목록**: `nomic-embed-text-v1.5`(768차원, 로컬 임베딩, 마스터 D6·D10에서 이미 확정 — 274MB 모델 크기는 `18`의 TL;DR에 인용됨). 1~3B급 분류기 후보는 이 부록이 읽은 6개 리서치 파일 어디에도 구체적 모델명이 없다 — **UNVERIFIED — 스파이크**(A6-Spike-10, §11). 스파이크 전까지 T0 분류(work/personal, 우선순위)는 규칙 기반(발신 채널 기본값, 발신자 도메인, 라벨 키워드 매칭)으로 시작하고, 규칙이 애매하다고 판정한 건만 T1(DeepSeek)로 올린다 — 이는 마스터 §14의 티어 구조(T0→T1 에스컬레이션)를 그대로 따르는 것이지 새 정책이 아니다.
- **메모리 예산**: nomic-embed 모델 자체 274MB + Ollama 런타임 오버헤드를 합쳐 기본 1GB로 잡는다(§7). 분류기가 스파이크를 통과해 탑재되면 추가로 필요한 메모리는 스파이크 실측치로 §7 예산을 갱신한다 — 지금 숫자를 추정으로 박아 넣지 않는다.
- **맥북 오프로딩 규칙**: 3B 초과 파라미터 또는 2GB 초과 메모리가 필요한 모델은 미니에 올리지 않는다. 마스터 §14가 "30B급 로컬 추론은 맥북에서만"이라 명시한 것과 같은 원칙을 3B 경계선까지 끌어내린 것 — 미니는 항상 가벼운 임베딩/분류만, 무거운 로컬 추론이 필요하면 맥북의 Ollama 인스턴스를 쓴다(맥북은 64GB라 여유가 있다). `OLLAMA_HOST`는 `127.0.0.1`로 바인딩해 tailnet에 직접 노출하지 않고 hub를 통해서만 호출되게 한다.

---

## 7. 리소스 예산표 (16GB, M4 미니)

| 컴포넌트 | 메모리(추정) | 근거 |
|---|---|---|
| macOS + 시스템 오버헤드 | 2.0GB | 일반적인 헤드리스 macOS 상주치, 리서치에 고정 수치 없음(경험적 가정) |
| Postgres(shared_buffers 2GB + 프로세스) | 3.0GB | §4 설정값 기반 |
| omnis-hub (Node) | 1.0GB | Node 프로세스 통상치, 리서치에 고정 수치 없음 |
| zero-cache | 1.5GB | A6-D5, 공식 권장치(6GB) 대비 축소 |
| Ollama(nomic-embed만) | 1.0GB | 모델 274MB + 런타임(`18`) |
| kmsg watch | 0.2GB | AX 폴링 스크립트, 경량 가정 |
| Playwright 상주 프로필(LinkedIn) | 0.8GB | 상주 Chromium 프로필, 통상치 |
| Beeper Desktop(Electron) | 0.4GB | Electron 앱 통상치 |
| healthcheck ping | 0.05GB | 경량 cron 스크립트 |
| local-agent(미니, Codex/Hermes 브리지) | 0.2GB | Node 프로세스, hub(1.0GB)보다 훨씬 가벼운 경량 브리지 가정 — 실측치 아님 |
| **소계** | **~10.2GB** | |
| 헤드룸(OS 캐시, burst, 향후 분류기, Colima 필요 시) | ~5.8GB | |

**디스크**: 미니의 실제 SSD 용량은 이 리서치 범위 밖이라 미확인 — 아래는 512GB 구성 가정(다른 용량이면 비례 조정). Postgres 데이터+WAL 여유 100GB, Ollama 모델 캐시 10GB, Playwright 프로필+브라우저 캐시 20GB, 로그(logrotate 30일 보관) 10GB, restic 로컬 스테이징(업로드 전 캐시) 50GB, 나머지는 OS·여유. 디스크 알림(§8)이 여유 50GB 미만에서 경보한다.

이 표 전체가 **개별 컴포넌트 주장치의 합**이지 통합 실측이 아니다(`18`의 Open Questions가 그대로 지적한 갭). A6-9(§11, "8-process RSS ≤10GB")는 원래 정의된 8개 프로세스(Postgres·hub·zero-cache·Ollama·healthcheck·kmsg·Playwright·Beeper) 기준을 이름 그대로 유지한다 — 이번 수정으로 추가된 local-agent(미니)의 0.2GB는 §7 소계엔 포함하되 A6-9 게이트 이름·pass 기준(≤10GB)은 바꾸지 않고, local-agent를 포함한 9개 프로세스 실측치가 그 상한을 넘는지도 같은 실측 때 함께 확인한다. **A6-9와 S-A4-5(A4 소유, 로컬 임베딩/분류 캐시 hit ≥60%)는 둘 다 Phase A 종료 기준(마스터 §16)의 전제 조건이라 Phase A 안에서 반드시 돈다(99-review §5)** — 늦어도 Phase A 종료 판정 전에 실측해 이 표를 갱신한다.

---

## 8. 모니터링

**healthchecks.io 체크 목록**(무료 티어 20 jobs 한도 내에서 15개로 시작, `18`):

| Job slug | 대상 | 주기 | Fail 조건 |
|---|---|---|---|
| `omnis-hub` | hub 프로세스 heartbeat | 5분 | ping 누락 10분 |
| `omnis-postgres` | Postgres 연결성 | 5분 | 연결 실패 |
| `omnis-pg-slot` | 복제 슬롯 상태 | 15분 | `active=false` 10분 이상 또는 `wal_status` 위험 |
| `omnis-zero-cache` | zero-cache `/health` | 5분 | 비정상 응답 |
| `omnis-ollama` | Ollama `/health` | 10분 | 비정상 응답 |
| `omnis-adapter-slack` | Slack 어댑터 | 15분 | 연속 실패 |
| `omnis-adapter-gmail` | Gmail 어댑터 | 15분 | 연속 실패 |
| `omnis-adapter-calendar` | Calendar 어댑터 | 15분 | 연속 실패 |
| `omnis-adapter-kakao` | kmsg 브리지(Phase C~) | 15분 | 연속 실패 |
| `omnis-adapter-linkedin` | Playwright 브리지(Phase C~) | 30분(랜덤 저빈도 폴링과 맞춤) | 연속 실패 |
| `omnis-adapter-whatsapp` | Beeper 브리지(Phase C~) | 15분 | 연속 실패 |
| `omnis-bridge-macbook` | 맥북 `local-agent` heartbeat | 10분 | ping 누락 20분 |
| `omnis-bridge-mini` | 미니 `local-agent`(Codex/Hermes) heartbeat | 10분 | ping 누락 20분 |
| `omnis-backup-pgdump` | 야간 `pg_dump` 성공 | 1일 | 미완료/exit code 실패 |
| `omnis-backup-restic` | 야간 restic 백업 성공 | 1일 | 미완료/exit code 실패 |

각 job은 `curl -fsS -m 10 --retry 3 https://hc-ping.com/<uuid>`을 정상 종료 시 호출하고, 실패 시 `/fail` suffix로 명시적으로 실패를 알린다(`18`의 ping URL 패턴 그대로 재사용).

**ntfy 라우팅**: 미니에 self-hosted ntfy를 띄우고(무료·무제한, `18`) 토픽을 2단으로 나눈다 — `omnis-critical`(hub/Postgres/슬롯/백업 실패, 즉시 맥북+아이폰 푸시) / `omnis-warning`(개별 채널 어댑터 일시 실패, 다음 아침 브리핑까지 유예 가능). healthchecks.io의 실패 웹훅이 미니의 ntfy 엔드포인트로 curl 한 줄을 쏘는 구조(`18`).

**omnis 인박스로의 이중 알림**: 모든 critical/warning 이벤트는 ntfy 푸시와 별개로 `items` 테이블에 `kind=system`인 Item을 만들어 omnis 자체 인박스에도 노출한다(마스터 §15 "어댑터 상태는 omnis 인박스에도 시스템 Item으로" 요구사항 그대로 구현) — 사람이 아이폰 알림을 놓쳐도 다음에 omnis를 열었을 때 Inbox 필터 "Needs approval" 옆에 시스템 상태가 보이게 한다.

---

## 9. 비밀 관리

**Keychain 명명 규칙**: A6-D9가 확정한 대로 A1의 점(`.`) 구분 스킴 `omnis.<channel>.<kind>.<external_id>`를 그대로 쓴다 — 하이픈 스킴은 A1과 충돌해 폐기했다(99-review §1.2). 예: `omnis.slack.xoxb.<team_id>`, `omnis.slack.xoxp.<team_id>`, `omnis.gmail.<email>`, `omnis.outlook.<upn>`, `omnis.telegram.session_key`, `omnis.beeper.token`, `omnis.whatsmeow.session_key`(전부 A1 원문 그대로). 채널이 아닌 서비스는 `omnis.<service>.<kind>`로 확장: `omnis.anthropic.api_key`. local-agent의 세션버스 토큰은 A2 §2.1이 이미 확정한 리터럴 `omnis.bridge.token.macbook`, `omnis.bridge.token.mini`를 그대로 쓴다(구 `omnis.macbook.session_bus_token`/`omnis.mini.session_bus_token`은 A2와 불일치해 폐기, 99-review §4-4). Account 필드는 `281932556+jinhologankim@users.noreply.github.com`(Logan 본인 식별용, 외부로 전송하지 않고 로컬 Keychain 항목 소유자 표시로만 사용). 조회는 `security find-generic-password -s <service> -a 281932556+jinhologankim@users.noreply.github.com -w`로 하되(`<service>`는 위 점 구분 이름 전체), `-w` 값이 shell history에 남을 수 있다는 점(`15`)을 감안해 항상 스크립트 안에서만 호출하고 인터랙티브 셸에 직접 치지 않는다.

**기존 자산 재사용 규칙**: DeepSeek API 키는 이미 Keychain 항목 `deepseek-api`로 존재한다(Logan의 기존 설정) — omnis는 이를 재생성하지 않고 `security find-generic-password -s deepseek-api -w`로 그대로 읽는다. 새 명명 규칙은 omnis가 새로 발급받는 시크릿에만 적용하고, 기존에 이미 다른 이름으로 관리되던 자산의 이름을 강제로 바꾸지 않는다.

**sops+age 파일 구조**: 기기별로 분리한다.

```
secrets/
  mini.enc.yaml       # 미니 전용: DATABASE_URL, ZERO_*, 채널 OAuth client secret
  macbook.enc.yaml     # 맥북 local-agent 전용: session bus 인증 토큰
  .sops.yaml           # age recipient 규칙(파일별 recipient 분리)
```

`.sops.yaml`에서 `mini.enc.yaml`은 미니의 age public key만 recipient로 등록하고, `macbook.enc.yaml`은 맥북의 age public key만 등록한다 — 한 기기가 탈취돼도 다른 기기의 시크릿까지 복호화되지 않는다. 값만 암호화되고 키(필드명)는 평문으로 남아 git diff 리뷰가 가능하다(`15`). `omnis-run-with-secrets.sh <host>` wrapper가 실행 시점에 해당 파일을 복호화해 환경변수로 export한다 — 정확한 `sops` 서브커맨드(예: `exec-env` 또는 `-d`+파싱)는 구현 시 `sops --help`로 확인해 확정한다(이 부분만 UNVERIFIED — 스파이크 불필요, 구현 중 5분 내 확인 가능한 논블로킹 항목).

**회전 절차**: (1) 새 값을 발급받는다(채널 콘솔에서 재발급 또는 새 API 키 생성), (2) `sops secrets/<host>.enc.yaml`로 열어 값을 교체하고 저장(자동 재암호화), (3) git commit, (4) 영향받는 LaunchDaemon/Agent만 `launchctl kickstart -k`로 재기동(전체 재부팅 불필요), (5) 재기동 후 healthchecks.io의 해당 job이 정상 ping을 보내는지 확인해 회전이 서비스를 깨지 않았음을 검증, (6) `audit_log`에 회전 이벤트를 기록. 정기 회전 주기는 채널별 만료 정책을 따르되(OAuth refresh token은 자동 갱신), API 키류(DeepSeek, Anthropic)는 유출 의심 시 즉시 + 정기로는 분기 1회를 기본값으로 한다.

---

## 10. `local-agent` 설치·자동 시작 (맥북·미니)

`local-agent`는 에이전트 런타임 세션을 hub의 session bus에 등록하는 브리지 데몬이다(마스터 §7 "세션 버스"). 맥북 것은 Claude Code·Codex·claude-ds·Hermes를, 미니 것은 Codex·Hermes만 노출한다(마스터 §4.2 "local-agent는 맥북과 미니 양쪽에 하나씩"). 두 프로세스 모두 로그인 셸 환경(nvm/node 버전, CLI 도구 PATH, macOS Keychain의 유저 세션 접근권)에 의존하므로 **root LaunchDaemon이 아니라 로그인 세션 LaunchAgent**로 설치한다(A6-D10).

### 10.1 맥북

```xml
<!-- ~/Library/LaunchAgents/ai.onwordlab.omnis-local-agent.plist (맥북) -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>ai.onwordlab.omnis-local-agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/omnis-run-with-secrets.sh</string>
    <string>macbook</string>
    <string>/usr/local/bin/node</string>
    <string>/opt/omnis/local-agent/dist/main.js</string>
    <string>--hub</string>
    <string>https://<mini-hostname>.ts.net/api</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/logan/Library/Logs/omnis/local-agent.log</string>
  <key>StandardErrorPath</key><string>/Users/logan/Library/Logs/omnis/local-agent.err.log</string>
</dict>
</plist>
```

설치 스크립트(`scripts/install-local-agent.sh`)는 (1) plist를 `~/Library/LaunchAgents/`에 복사, (2) `launchctl bootstrap gui/$(id -u)`로 등록, (3) `omnis-local-agent`가 healthchecks.io `omnis-bridge-macbook` job에 최초 ping을 보내는지 확인까지 자동화한다. 맥북이 잠들거나 재부팅되면 로그인 시 자동 재기동되고, 재기동 후에도 `--resume` 방식(마스터 §9의 `session_key`/`session_id` 분리)으로 진행 중이던 에이전트 세션을 이어 붙인다.

위 plist의 `--hub` 인자는 `~/.omnis/local-agent.toml`(A2 §2.1)의 `hub_url` 필드와 같은 값을 가리킨다 — 두 설정 소스의 우선순위(CLI 인자가 TOML을 오버라이드)는 A2 §2.1이 정본이고, 이 절은 인용만 한다(99-review §2-3).

### 10.2 미니

미니의 `local-agent`는 §1 표의 새 LaunchAgent 행(A6-D1)이다. Codex CLI(`app-server` JSON-RPC, 마스터 §9)와 Hermes(`127.0.0.1:8642`, 로컬 전용)만 브리지한다 — Claude Code·claude-ds는 맥북에만 있다. GUI 접속 자체는 필요 없지만(`codex app-server`는 headless, `09`) CLI 실행이 로그인 셸 PATH·Keychain 세션에 의존하는 것은 맥북과 같은 이유이고(A6-D10), 미니는 A6-D1 때문에 kmsg·Playwright·Beeper용 GUI 세션이 어차피 상시 켜져 있어 이 세션에 올리는 데 추가 비용이 없다.

```xml
<!-- ~/Library/LaunchAgents/ai.onwordlab.omnis-local-agent.plist (미니) -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>ai.onwordlab.omnis-local-agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/omnis-run-with-secrets.sh</string>
    <string>mini</string>
    <string>/usr/local/bin/node</string>
    <string>/opt/omnis/local-agent/dist/main.js</string>
    <string>--hub</string>
    <string>http://127.0.0.1:8787</string>
    <string>--runtimes</string>
    <string>codex,hermes</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/logan/Library/Logs/omnis/local-agent-mini.log</string>
  <key>StandardErrorPath</key><string>/Users/logan/Library/Logs/omnis/local-agent-mini.err.log</string>
</dict>
</plist>
```

미니는 hub와 같은 머신이므로 `--hub`는 Tailscale이 아니라 `127.0.0.1:8787`(hub의 로컬 바인딩)을 직접 가리킨다 — tailnet을 거칠 필요가 없다. 설치 절차는 맥북과 동일한 스크립트(`scripts/install-local-agent.sh mini`)를 쓰되 healthchecks.io job은 `omnis-bridge-mini`(§8)로 최초 ping을 확인한다. `~/Library/LaunchAgents`(root가 아닌 `logan` 유저 홈)에 두고 `launchctl bootstrap gui/$(id -u logan)`으로 등록하는 것은 §1 kmsg 예시와 동일한 원칙이다.

---

## 11. Phase 0 스파이크 실행 절차

**Phase 0은 2주다**(마스터 §16). 통과 전 Phase A 착수 금지인 게이트가 14개, 그중 A6가 직접 실행 절차를 소유하는 것이 8개(①~⑧, A6-D12)이고 나머지 6개는 A1·A2·A3·A7이 소유한다 — 아래 §11.1이 마스터 §16과 99-review §5 기준 14개 전체를 나열한다(A6 소유분만 절차·기록표를 내린다). §11.2는 "Phase 진입 시" 추가 16개(각 Phase 진입 시점에 돌리며 pass 기준은 소유 부록 원문을 그대로 따른다, 99-review §5).

### 11.1 Phase 0 게이트 14개 (통과 전 Phase A 착수 금지)

| # | 게이트 | Pass 기준 | 소유 부록 |
|---|---|---|---|
| ① Calendar `events.watch` via Funnel | 핸드셰이크+알림 1건 | A6(아래 절차) |
| ② Beeper+WhatsApp 부번호 send | 200+수신+24h 무제재 | A6(아래 절차) |
| ③ FileVault ON+자동 로그인 | 재부팅 후 무개입 GUI 세션 | A6(아래 절차) |
| ④ kmsg read on 미니 | 48h 연속, 권한 재요청 0 | A6(아래 절차) |
| ⑤ Tailscale Serve HTTPS @ iPhone | SSL 에러 0 | A6(아래 절차) |
| ⑥ Zero + Postgres | 반영 ≤2초(G5) | A6(아래 절차) |
| ⑦ Codex app-server 핀 + 1턴 | 프로토콜 에러 0 | A6(아래 절차) |
| ⑧ Ollama nomic-embed 처리량 | 1,000문장 ≤120s, p95 ≤300ms | A6(아래 절차) |
| A1-④ Slack Socket Mode 1턴 | ≤5초(G1) | A1 |
| A1-⑤ Gmail watch + Pub/Sub | `historyId` 수신 | A1 |
| S-A2-1 `claude -p --bare` hook 주입 | 승인 게이트가 뜸 | A2 |
| S-A2-2 `--permission-mode` ↔ profile 매핑 | 3 profile 확정 | A2 |
| S-A3-2 Zero의 `vector`/`tsvector`/`uuid[]`/generated 컬럼 복제 | 복제+쿼리 성공 | A3 |
| A7-1 `worktrunk` 드라이런 | create/remove 왕복 | A7 |

**FileVault 결정 규칙(③)**: 순서상 §2 1번(자동 로그인 설정)보다 먼저 ③을 실행한다. Pass면 FileVault ON 유지. Fail이면(자동 로그인이 막히면) 그 즉시 FileVault OFF로 내리고 동시에 tailnet-only 노출(Funnel 없이 Tailscale ACL만, §3)로 좁히며, 이 전환은 Logan 승인을 반드시 거친다(A6-D2). 아래 ③ 행의 절차·폴백은 이 규칙을 그대로 구현한다.

**pass 기준의 정본**: 위 14개 게이트 중 A1-④(Slack)·A1-⑤(Gmail)를 포함해 A6가 직접 절차를 내리는 ①~⑧(Calendar/Beeper/FileVault/kmsg/Tailscale Serve/Zero+Postgres/Codex/Ollama)은 §11.3의 절차·pass 기준 표가 정본이다 — A1-channel-adapters.md §4가 같은 채널(Calendar·Beeper·kmsg·Slack·Gmail)에 대해 자체 pass 기준 문구를 갖고 있어도, 그 5개 게이트에 한해 A1의 표는 §11.3을 따르며 문구가 다르면 §11.3이 이긴다(99-review §4-2). A1 고유 소유 게이트(Outlook A1-⑥·Telegram A1-⑦·LinkedIn A1-⑧, S-A2-1·2, S-A3-2, A7-1)는 계속 각 소유 부록 원문이 정본이다.

### 11.2 Phase 진입 시 16개 (각 Phase 진입 시점, pass 기준은 소유 부록 원문)

A1-⑥ Outlook webhook · A1-⑦ Telegram QR · A1-⑧ LinkedIn 알림메일 파싱 · S-A2-3~6 · S-A3-1·3·5 · S-A4-1(**=A6-10**, §6 Ollama 분류기 선정, recall ≥0.9·오탐 ≤0.15·p95 ≤800ms) · S-A4-2 · S-A4-4 · **S-A4-5**(A4 소유, cache-hit ≥60%) · **A6-9**(§7, 8-process RSS 합 ≤10GB) · A7-2 Tauri UI 테스트.

**A6-9와 S-A4-5는 Phase A 종료 기준(마스터 §16)의 전제 조건이라 "Phase 진입 시"로 미루지 않고 Phase A 안에서 반드시 돈다**(99-review §5) — 나머지 14개는 각자의 Phase(B/C 등) 진입 시점에 돌리면 된다.

### 11.3 A6 소유 8개 스파이크 — 절차

실패 시 폴백은 대부분 마스터의 채널 매트릭스(§8)에 이미 정의된 폴백 경로를 그대로 쓴다 — 스파이크는 최적 경로가 되는지를 확인하는 것이지, 실패해도 제품이 막히지 않게 마스터가 이미 설계해뒀다.

| # | 스파이크 | 절차 | Pass 기준 | Fail 시 폴백 |
|---|---|---|---|---|
| ① | Calendar `events.watch` via Funnel | `tailscale funnel --bg 443 on` → Google Calendar API로 `events.watch` 채널 등록(webhook URL = Funnel 엔드포인트) → 테스트 이벤트 생성/수정 → webhook 수신 확인 → 종료 즉시 `tailscale funnel 443 off` | webhook이 이벤트 변경 후 1분 이내 도착 | `events.list` + syncToken 폴링 1~5분(마스터 §8에 이미 기본 경로로 명시) |
| ② | Beeper 토큰 발급 + WhatsApp 부번호 send | Beeper Desktop 설치·QR 페어링(부번호로, Q2 기본값) → 로컬 REST API로 토큰 발급 확인 → 부번호에서 테스트 메시지 1건 발송 | 토큰 발급 성공 + 발송 성공 + 24시간 내 계정 제재 신호 없음 | whatsmeow Go 사이드카(마스터 D4 폴백) |
| ③ | FileVault 켠 채 자동 로그인 (§2 1번보다 먼저 실행 — 결정 규칙은 §11.1) | FileVault 켜기 → 자동 로그인 계정 설정 → 재부팅 → 로그인 화면 없이 GUI 세션 도달하는지 관찰 | 수동 개입 없이 재부팅 후 로그인 세션 도달 | FileVault OFF + tailnet-only 노출 + 물리 보안 보완, Logan 승인 필수(A6-D2) |
| ④ | kmsg read on mini | kmsg 설치 → `kmsg watch --json` 실행 → Accessibility 권한 부여 → 24~48시간 연속 JSON 이벤트 관찰 | 권한 재요청 없이 48시간 연속 정상 이벤트 | 없음(마스터 §8 KakaoTalk 경로 자체가 kmsg 단일안, 대안은 Notification Center DB 트리거+OCR로 이미 명시) |
| ⑤ | Tailscale Serve HTTPS를 iPhone Safari에서 | 아이폰에 DoH/private-DNS 앱·프로파일 있는지 먼저 점검·제거 → `<mini-hostname>.ts.net` Safari 접속 | SSL 에러 없이 페이지 로드 | MagicDNS 이름 재확인 → 그래도 실패 시 TailscaleKit 검증을 Phase D로 앞당김(`13`) |
| ⑥ | Zero + Postgres 기동 | 로컬 Postgres(pgvector 포함) 기동 → zero-cache 연결(§5 설정) → 테스트 row insert → 클라이언트 구독에서 변경 반영 시간 측정 | zero-cache 정상 기동 + 변경 반영 2초 이내(G5) | PowerSync(마스터 D7 폴백, 단 자체호스팅 시 MongoDB 필요 이슈 인지, `27`) |
| ⑦ | Codex app-server 핀 + 1턴 왕복 | `codex app-server` 버전 고정 실행 → JSON-RPC로 1턴 요청 → `item/started`~`item/completed` 수신 확인 | 프로토콜 에러 없이 1턴 완주 | 버전 재핀 + capabilities 기반 feature detection으로 우회(마스터 §9) |
| ⑧ | Ollama `nomic-embed` 처리량 | Ollama에 `nomic-embed-text-v1.5` 로드 → 인박스 메시지 샘플 100건 임베딩 배치 처리 시간 측정 | 하루 추정 ~2,000건(`27`) 유입을 실시간 지연 없이 소화할 처리량 확인 | 배치를 야간 오프피크로 이동(마스터 §14 KST 19시 이후 오프피크 원칙과 결합) 또는 맥북으로 오프로드 |

### 결과 기록표(빈 양식)

| # | 스파이크 | 실행일 | 결과(Pass/Fail) | 측정치 | 비고 |
|---|---|---|---|---|---|
| ① | Calendar watch/Funnel | | | | |
| ② | Beeper/WhatsApp 부번호 | | | | |
| ③ | FileVault+자동로그인 | | | | |
| ④ | kmsg read | | | | |
| ⑤ | Serve HTTPS/iPhone | | | | |
| ⑥ | Zero+Postgres | | | | |
| ⑦ | Codex app-server | | | | |
| ⑧ | Ollama nomic-embed | | | | |
| A6-9(추가) | 16GB 통합 메모리 실측(§7) | | | | 8개 프로세스 동시 구동 RSS 합 |
| A6-10(추가) | Ollama 1~3B 분류기 선정(§6) | | | | 후보 모델명·처리량·메모리 기록 |

이 표는 Phase A 종료 기준(마스터 §16 "3채널+2런타임에 대해 G1, G2, G4, G5 충족")을 판정하기 전에 채워져야 한다 — 특히 ⑥과 A6-9는 G5(2초 동기화)와 §7 예산의 전제 조건이다.

---

## 12. standalone(Phase D) 전환 시 달라지는 항목

마스터 D12/§4.2가 이미 "Slack/Gmail/Outlook/Telegram/WhatsApp/Calendar+4개 에이전트 세션은 완전 hub-less, KakaoTalk·LinkedIn은 상시 켜진 맥 1대가 필요"로 정직하게 재정의했다(`25`). 이 표는 그 전환이 §1~10의 각 운영 항목에 구체적으로 어떤 변화를 일으키는지 정리한다.

| 항목 | Phase A~C(미니 허브) | Phase D(standalone) | 비고 |
|---|---|---|---|
| Postgres 위치 | 미니 LaunchDaemon | 맥북 앱 번들 내장 인스턴스 | 마스터 §4.2 |
| zero-cache | 미니 LaunchDaemon | 맥북 앱 내장 프로세스 | client-server 프로토콜 자체는 안 바뀜(`13`) |
| omnis-hub | 미니 LaunchDaemon | 맥북 앱 안에서 동일 코드 실행(마스터 "허브가 맥미니든 맥북 앱 안이든 같은 코드") | |
| KakaoTalk/LinkedIn 캡처 호스트 | 미니(허브와 동일 머신) | **여전히 미니** — "capture sidecar"로 역할만 축소(A6-D11, 마스터 §19 Q8 기본값과 일치: "미니를 KakaoTalk·LinkedIn 캡처 사이드카로 병행") | `25`의 Option E, 완전 은퇴는 별도 결정 |
| Tailscale ACL 구조 | `tag:client → tag:hub`(미니 중심 단방향) | peer-to-peer 재설계(맥북이 hub이자 client) + 미니는 `tag:kakao-sidecar`로 재태깅 | `15` Later 섹션 |
| SQLCipher/시크릿 키 배포 | 미니 한 곳에만 키 존재 | "Postgres 서버가 어느 기기에서 뜨는가"의 문제로 단순화(Zero+Postgres 계층을 이미 골랐으므로 별도 키 동기화 로직 불필요) | `25` §4, YAGNI로 지금 안 만듦 |
| 백업 대상 | 미니의 restic → B2 | 맥북의 restic → B2(경로만 변경) | |
| 모니터링 대상 | §8의 15개 job 전부 | Postgres/hub/zero/`omnis-bridge-macbook`은 "맥북" 라벨로, kakao/linkedin job과 `omnis-bridge-mini`(미니에 남은 local-agent가 있다면)만 "미니(sidecar)" 라벨 유지 | |
| 리소스 예산 | 미니 16GB 공유(§7) | 맥북 64GB 중 일부만 사용(여유 큼), 미니는 kmsg+Playwright만 남아 §7 예산의 10GB 중 kmsg(0.2GB)+Playwright(0.8GB)만 남고 나머지 반납 | |
| 아이폰 접근 경로 | Tailscale Serve(미니) | Tailscale Serve(맥북) + TailscaleKit 네이티브 임베드 검토(`13` v2 권고) | |
| 맥북 슬립/이동 시 영향 | 해당 없음(미니가 상시) | Postgres/hub/zero도 맥북에 있으므로 맥북이 잠들면 전체가 멈춤 — 클램쉘+상시전원 필수, 순수 이동 중엔 오프라인(로컬 캐시로 triage만) | `25`가 지적한 새 리스크, 마스터가 아직 이 트레이드오프를 명시 안 함(decisions_needed) |

standalone 전환의 실질적 비용은 대부분 "미니에 있던 걸 맥북으로 옮기는" 이관 작업이지 재설계가 아니다 — Zero+Postgres+Tailscale 조합을 Phase A부터 그대로 썼기 때문이다(`13`, `25`의 공통 결론). "미니를 계속 병행 운용할지"는 마스터 §19 Q8 기본값(미니 병행)으로 이미 정해졌으므로 더 이상 decisions_needed가 아니다 — 위 표의 캡처 호스트 행이 그 구현이다. 아직 이 부록이 대신 정하지 않는 것은 별개 질문 하나뿐이다: Postgres/hub/zero가 옮겨간 **맥북 자체**가 유일한 상시 노드가 되면서 맥북의 슬립·이동이 곧 서비스 중단이 된다는 점을 받아들일지(맥북을 상시 전원 연결로 운용, 클램쉘 모드) — 이건 Q8과 무관하게 여전히 decisions_needed다(A6-D11 폴백 칸의 "Later, 하드웨어 마모 리스크 미검증"과 동일 항목).

---

## 리뷰 노트 (2026-09-20)

이 절은 인라인으로 고치지 않은 실질적 이슈를 기록한다. 아래 중 결정이 필요한 항목은 리뷰만 하고 값은 바꾸지 않았다.

| # | 이슈 | 심각도 | 근거 | 상태 |
|---|---|---|---|---|
| 2 | **"컨테이너는 쓰지 않는다" 원칙이 A6 본문에 명시적으로 재확인되지 않는다.** 마스터 §15는 "컨테이너는 쓰지 않는다(네이티브 프로세스). 필요 시 Colima만"이라고 명시했는데, A6는 이를 §7 리소스 표의 헤드룸 괄호 안(`Colima 필요 시`)에서만 스치듯 언급한다. 이 부록 어디에도 언제 Colima가 필요해지는지, 왜 기본은 네이티브 프로세스인지 설명이 없다 — 구현 가능성엔 지장 없지만 마스터 결정을 부록이 "구현 가능한 수준까지 내린다"는 이 문서 자체의 목적에는 못 미친다. | minor | 00-omnis-design.md §15, A6-ops-infra.md §7 | 미해결 — fix list 범위 밖, 내용을 UNVERIFIED 없이 확장하려면 별도 리서치가 필요해 이번 패스에서 스킵 |
| 3 | **`decisions_needed` 태그가 마스터/다른 부록 어디에도 정의돼 있지 않다.** A6-D2 폴백 칸과 §12 마지막 문단이 "Logan 승인 필요 — decisions_needed"처럼 이 태그를 쓰지만, 마스터 §19(미결 질문)나 다른 부록에는 이 규약이 없다. 이게 문서 안 단순 표기인지, README/이슈 트래커에 실제로 모아야 하는 리스트인지 불명확하다. | minor | A6-ops-infra.md A6-D2, §12 | 미해결 — fix list 범위 밖. 단 §12의 "미니 병행 vs 맥북 단독" 항목은 이번 패스에서 마스터 §19 Q8 기본값으로 해소했고, 남은 decisions_needed는 "맥북 상시전원/클램쉘 여부" 하나로 좁혔다 |
| 4 | **`SQLCipher/시크릿 키 배포` 행(§12 표)의 범위가 모호하다.** 마스터 §13은 SQLCipher급 메시지 본문 컬럼 암호화를 "Later"(MVP 비필수)로 분류하는데, A6 §12의 해당 행은 제목에 SQLCipher를 걸어놓고 본문은 "Postgres 서버가 어느 기기에서 뜨는가"만 얘기하고 SQLCipher 자체의 Phase A~C/D 상태는 언급하지 않는다. | minor | A6-ops-infra.md §12, 00-omnis-design.md §13 | 미해결 — fix list 범위 밖 |
| 5 | **부록 서두(1줄)가 근거로 든 `research/20-gap-eve-self-host-spike.md`가 본문 어디에도 인용되지 않는다.** 본문의 백틱 인용은 `09`/`13`/`15`/`18`/`25`/`27` 여섯 개뿐이다(이번 패스에서 `09`가 §10.2에 추가됨). `20`이 실제로 어느 결정에 영향을 줬는지 밝히거나, 서두 근거 목록에서 빼는 게 맞다. | minor | A6-ops-infra.md 1~3행 | 미해결 — fix list 범위 밖 |

해결됨(이번 v0.95 패스, 제거): 옛 1번 "Keychain 명명 규칙이 A1과 충돌한다" — A6-D9를 A1의 점(`.`) 구분 스킴 `omnis.<channel>.<kind>.<external_id>`로 재작성하고 §9 본문도 동일 스킴으로 다시 썼다(fix #1).

해결됨(v1.0 pass 2, 제거): 옛 1번 "local-agent 허브 주소 설정 경로가 두 부록에서 다르게 서술된다" — §10.1에 "CLI 인자가 TOML을 오버라이드"는 A2 §2.1이 정본이라는 인용 한 줄을 추가해 판단 기준을 명시했다(99-review §2-3). A2 쪽에 동일 문구가 실제로 적혔는지는 A2 자신의 fix pass 책임이다.

인라인으로 이미 고친 것(이전 패스): (a) `ai.onwardlab.*` / `logan@onwardlab.ai`를 마스터 D14·A8이 쓰는 철자 `Onword`에 맞춰 `onwordlab`으로 통일(§1, §3, §10) — 부록 간 철자 불일치였다. (b) §2의 "§2.5의 재적용 스크립트" 표기를 존재하지 않는 하위 섹션처럼 읽히던 것에서 "§2 5번(재적용 LaunchAgent)"로 고쳐 참조를 명확히 했다.

---

## 수정 이력 (v0.95, 2026-09-20)

1. Keychain 명명 규칙(A6-D9, §9)을 A1의 점(`.`) 구분 스킴 `omnis.<channel>.<kind>.<external_id>`로 재작성 — 하이픈 스킴은 A1과 충돌해 폐기(99-review §1.2).
2. 허브 로컬 포트를 `127.0.0.1:8787`로 전면 수정(§1, §3 ACL·`tailscale serve`)하고 8642는 Hermes `api_server` 전용으로 본문에 명시.
3. Postgres 버전을 17로 고정(§4, "설치 시점 최신" 표현 삭제)하고 `idle_replication_slot_timeout='3d'`(A6-D4, 기존 유지)에 슬롯 헬스체크 실행 명령(`psql` 조회문)을 §4에 추가.
4. 미니 `local-agent`(Codex+Hermes 브리지)를 §1 프로세스표·§7 리소스표·§8 모니터링표·§10.2에 신설. LaunchAgent로 결정(A6-D10 확장) — Codex CLI 실행이 로그인 셸/Keychain 세션에 의존한다는 A6-D10의 기존 근거를 미니에 연역 적용했고(`18`/`09`가 준 원리의 연역, 두 파일에 직접 명시된 사실은 아님), 미니가 A6-D1로 인해 이미 GUI 세션을 상시 유지하므로 추가 비용이 없다는 점을 근거로 스파이크 표시 없이 결정.
5. Phase 0을 2주로 명시하고 §11.1에 14개 게이트 전체(A6 소유 8개 + A1/A2/A3/A7 소유 6개)를 마스터 §16·99-review §5 기준 pass 기준과 함께 나열, §11.2에 "Phase 진입 시" 16개 목록 신설. FileVault 결정 규칙(③ 먼저 실행 → fail 시 OFF + tailnet-only + Logan 승인)을 A6-D2·§11.1·§11.3 ③행에 반영.
6. A6-9(8-process RSS ≤10GB)와 S-A4-5(cache-hit ≥60%, A4 소유)가 Phase A 종료 기준의 전제 조건이라 Phase A 안에서 반드시 돈다는 것을 §7·§11.2에 명시.
7. §12 standalone 표의 캡처 호스트 행에 마스터 §19 Q8 기본값(미니 병행) 인용을 추가하고, 닫는 문단에서 "미니 병행 여부"를 decisions_needed 목록에서 제거(Q8로 이미 해소) — 남은 decisions_needed는 "맥북 상시전원/클램쉘 여부" 하나로 좁힘.
8. 리뷰 노트에서 옛 1번(Keychain 충돌) 제거(fix #1로 해소). 남은 5개 항목은 이번 fix list 범위 밖이라 그대로 유지하고 각각 "미해결" 사유를 표에 추가.

### v1.0 (2026-09-20, pass 2)

1. §11.1·§11.2·A6-D12의 채널 스파이크 번호를 A1의 실제 라벨(A1-channel-adapters.md §4·A1-D10: `A1-①` Calendar·`②` Beeper·`③` kmsg·`④` Slack·`⑤` Gmail·`⑥` Outlook·`⑦` Telegram·`⑧` LinkedIn)에 맞춰 정정 — §11.1의 "A1-① Slack/A1-② Gmail"을 "A1-④ Slack/A1-⑤ Gmail"로, §11.2의 "A1-③ Outlook·④ Telegram·⑤ LinkedIn"을 "A1-⑥ Outlook·⑦ Telegram·⑧ LinkedIn"으로, A6-D12의 "A1-①·②"를 "A1-④·⑤"로 고쳤다(99-review-v2 §4-2). §11.1에 "pass 기준의 정본" 문단을 신설해, A6·A1이 함께 다루는 5개 게이트(Calendar/Beeper/kmsg/Slack/Gmail)는 §11.3이 정본이고 A1-channel-adapters.md §4는 문구가 다르면 §11.3을 따른다고 명시했다.
2. §9의 local-agent 세션버스 토큰 Keychain 이름을 A2 §2.1의 확정 리터럴 `omnis.bridge.token.macbook`/`omnis.bridge.token.mini`로 교체(구 `omnis.macbook.session_bus_token`/`omnis.mini.session_bus_token`은 A2와 불일치해 폐기, 99-review-v2 §4-4).
3. §10.1에 "`--hub` 인자와 A2 §2.1 `local-agent.toml`의 `hub_url`은 같은 값을 가리키며, 두 소스의 우선순위(CLI가 TOML을 오버라이드)는 A2 §2.1이 정본"이라는 인용 한 줄을 추가(`--hub` 인자 자체는 유지, 99-review-v2 §2-3). 리뷰 노트 옛 1번(local-agent 설정 소스 불명확)을 이 인용으로 해소해 표에서 제거.
4. 버전을 1.0으로 올리고 서두 근거 목록에 `99-review-v2.md`·`A1-channel-adapters.md` §4·`A2-agent-session-bridge.md` §2.1을 추가.

**이번 패스에서 다루지 않은 것**: rev2 §2·§3·§4의 나머지 항목(Web Push 1종, A7 US-A02/A04, A5 §2.5, 스케줄 정본 등)은 다른 부록 소유라 A6 범위 밖. rev2 §3-1(맥북 로컬 파일 ingestion 호스트, A4 §10.1 소유)·§2-2(A1 §16 8채널)·§2-4(threads.person_id, A5 소유)도 A6가 손댈 항목이 아니라 그대로 둔다.
