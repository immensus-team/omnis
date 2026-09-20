# 18 — Running a 24/7 Hub on a Headless macOS Mac Mini (M4, 16GB)

## 1. TL;DR

Mac mini(M4, 16GB, macOS 26.6)를 항상 켜진 헤드리스 허브로 쓸 때 핵심 제약: launchd의 **LaunchDaemon은 GUI(window server)에 접속 불가**라는 게 Apple 공식 문서로 확인됨 — KakaoTalk.app, LinkedIn용 브라우저 프로필처럼 화면이 필요한 앱은 반드시 **로그인된 유저 세션의 LaunchAgent**로 띄워야 함. 따라서 자동 로그인(FileVault 끄거나 인스턴트 언락 필요) + `pmset -c sleep 0` + `caffeinate`로 세션을 절대 로그아웃/잠금시키지 않는 게 전제 조건. Node/Bun 서비스(포트 있는 API 등)는 launchd KeepAlive로 충분하지만, 로그 로테이션·프로세스 그룹 관리는 pm2가 더 편함(단 pm2도 macOS에서는 결국 launchd에 등록됨). Docker Desktop은 유료 트리거가 있으니 Colima(무료, MIT, Lima 위에서 동작 — 이미 Lima VM 있다는 브리프와 일치)가 합리적. 백업은 restic(암호화+dedup, BSD 라이선스)+저가 클라우드 오브젝트 스토리지, 모니터링은 healthchecks.io 무료 티어(20 jobs) + ntfy 자체호스팅(무료, curl 한 줄) 조합이 가장 라지.

## 2. Facts

- launchd **LaunchDaemon은 전역(global) bootstrap namespace에서 실행되며 window server에 접속할 수 없다** — GUI 앱을 daemon으로 띄우는 건 아키텍처상 불가능하다고 Apple TN2083이 명시("How can I launch a GUI application from my daemon? The answer is that you can't"). GUI가 필요한 작업은 로그인 세션에 종속된 **LaunchAgent(GUI 타입)**로 분리해야 하고, daemon↔agent 통신은 Unix domain socket 권장. VERIFIED — [Apple TN2083: Daemons and Agents](https://developer.apple.com/library/archive/technotes/tn2083/_index.html), 2026-09-20 조회.
- launchd 배치 규칙: `~/Library/LaunchAgents`(개별 유저), `/Library/LaunchAgents`(전체 유저 agent), `/Library/LaunchDaemons`(시스템, 부팅 시 로그인 없이 실행). LaunchAgent는 유저 로그인 시 시작해 해당 유저 로그인 중에만 실행되고, LaunchDaemon은 부팅 시 로그인 여부와 무관하게 실행된다. `KeepAlive`는 계속 실행 여부를 제어하고, on-demand(false)가 Apple 권장 기본값이나 상시 서비스는 `true`로 설정 가능. 주기 실행은 `StartInterval`(초 단위) 또는 `StartCalendarInterval`. VERIFIED — [Apple: Creating Launch Daemons and Agents](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html), 2026-09-20 조회.
- `pmset -c`는 AC 전원(충전기 연결) 상태의 전원 설정을 지정하는 플래그이며, 헤드리스 상시 가동 Mac은 `sudo pmset -c sleep 0 displaysleep 0 disksleep 0`으로 시스템 수면·디스플레이 수면·디스크 스핀다운을 모두 비활성화한다. VERIFIED — [ss64 pmset reference](https://ss64.com/mac/pmset.html), 2026-09-20 조회.
- pm2는 macOS(`darwin`)에서 `pm2 startup` 실행 시 **내부적으로 launchd plist를 생성**해 재부팅 후 프로세스를 복구하며, `pm2 save`로 현재 프로세스 목록을 저장해야 startup hook이 적용된다. VERIFIED — [PM2 runtime startup-hook docs](https://pm2.io/docs/runtime/guide/startup-hook/), 2026-09-20 조회. (로그 로테이션 세부 옵션은 별도 pm2-logrotate 모듈 페이지에서 확인 필요 — 이번 조회로는 세부값 미확보, UNVERIFIED)
- **Colima**는 Lima 위에서 동작하는 컨테이너 런타임 CLI로 Docker/Containerd/Incus 지원, MIT 라이선스, Apple Silicon 공식 지원(macOS 13+에서 Rosetta 2 에뮬레이션·GPU 가속 AI 워크로드까지 지원), 기본 VM 스펙은 2 CPU/2GiB 메모리/100GiB 디스크(커스터마이즈 가능). VERIFIED — [Colima GitHub README](https://github.com/abiosoft/colima), 2026-09-20 조회.
- **OrbStack**은 Apple Silicon 최적화 Docker/Linux VM 대체재로, "Apple Silicon에서 백그라운드 CPU 사용 0.1% 미만" 주장 및 개발 환경 프로비저닝이 Docker Desktop 대비 훨씬 빠르다고 자체 벤치마크(17분 vs 45분)를 게시. 가격 정보는 별도 페이지 필요(이번 조회로 미확보, 무료 개인용 티어 존재는 업계 상식이나 이번 세션에서 1차 소스로 확인 못함 — UNVERIFIED). VERIFIED(성능 주장만) — [OrbStack 홈페이지](https://orbstack.dev/), 2026-09-20 조회.
- **Docker Desktop**은 개인(Personal) 플랜이 완전 무료($0/월, 1 유저, Hub pull 시간당 100회 제한 등)이고, 팀 협업·SSO·감사 로그 등 필요 시 Pro($9~11/월)부터 유료. omnis는 1인 사용이라 무료 티어로 충분하지만 애초에 Colima/OrbStack이 더 가벼움. VERIFIED — [Docker pricing page](https://www.docker.com/pricing/), 2026-09-20 조회.
- **restic**은 단일 실행 파일, 서버 불필요, 증분 백업(변경분만 전송), 전 과정 암호화, BSD 2-Clause 라이선스, macOS/Linux/BSD/Windows 지원, v1.0.0 이후 메이저 버전 내 저장소 호환성 보장. VERIFIED — [restic.net](https://restic.net/), 2026-09-20 조회.
- **healthchecks.io** 무료(Hobbyist) 티어는 **20개 job 모니터링, job당 로그 100개**; 유료 Business는 $20/월(job 100개, 로그 1000개, SMS/전화 크레딧 포함). Self-hosted(Docker) 배포 옵션도 공식 문서에 존재. VERIFIED — [healthchecks.io pricing](https://healthchecks.io/pricing/), [healthchecks.io docs](https://healthchecks.io/docs/), 2026-09-20 조회.
- **ntfy**는 HTTP PUT/POST 한 줄(`curl -d "message" ntfy.sh/topic`)로 푸시 알림을 보내는 오픈소스 서비스이며 self-hosting 전용 설치 가이드가 별도로 있음(맥미니에 직접 띄우면 완전 무료·무제한). 라이선스 정식 문구는 이번 조회로 미확인(UNVERIFIED, 통상 Apache-2.0로 알려져 있으나 1차 소스 미확보). VERIFIED(기능) — [ntfy docs](https://docs.ntfy.sh/), 2026-09-20 조회.
- **Beeper**는 WhatsApp, Instagram, Telegram, Signal, Messenger, X, Google Messages/Chat/Voice, LinkedIn, Discord, Slack을 지원하지만 **KakaoTalk은 지원 목록에 없음** — 대부분 "온디바이스 연결"(메시지가 Beeper 서버를 거치지 않고 기기↔네트워크 직결)이 특징. 즉 omnis에서 KakaoTalk은 Beeper로 대체 불가하고 KakaoTalk.app 자체를 GUI 세션에서 계속 띄워둔 채 접근성 API나 화면 자동화로 캡처해야 한다. VERIFIED — [beeper.com](https://www.beeper.com/), 2026-09-20 조회.
- Tailscale 공식 문서에서 macOS Screen Sharing/VNC를 tailnet 위에서 쓰는 전용 가이드 페이지는 이번 조회(문서 인덱스, `/kb/1092/*` 계열)로 특정하지 못함 — Tailscale이 사설 IP/MagicDNS를 제공하므로 macOS 내장 Screen Sharing(`vnc://<tailscale-ip>` 또는 `<hostname>.ts.net`)을 포트포워딩 없이 그대로 쓸 수 있다는 것은 Tailscale의 기본 동작 원리상 타당하지만, 이번 세션에서 전용 튜토리얼 URL로 확인하지 못했으므로 **UNVERIFIED**(구체적 macOS Screen Sharing 가이드 문서). Tailscale 문서는 2026-02-04 기준으로 최신화됐다는 표기만 확인. — [tailscale.com/kb/1092/remote-desktop-access](https://tailscale.com/kb/1092/remote-desktop-access), 2026-09-20 조회.

## 3. Options / Comparison

### Process supervision: launchd 직접 vs pm2

| | launchd KeepAlive 직접 | pm2 (그 위에 launchd 등록) |
|---|---|---|
| 재부팅 후 자동 복구 | O (LaunchDaemon/Agent 자체 기능) | O (`pm2 startup` + `pm2 save`, 내부적으로 launchd plist 생성) |
| 로그 로테이션 | 없음(직접 `newsyslog` 설정 필요) | `pm2-logrotate` 모듈(생태계 검증됨, 세부 옵션은 별도 확인 필요) |
| 여러 Node 프로세스 한눈에 보기(`pm2 list`, `pm2 monit`) | 없음(각 plist를 따로 `launchctl list`) | O |
| 크래시 루프 백오프 제어 세밀도 | plist당 `ThrottleInterval` 정도 | pm2가 재시작 횟수/딜레이 더 세밀하게 노출 |
| 의존성 추가 | 0 | npm 패키지 1개 |
| GUI 필요 없는 순수 API/워커 | 적합 | 적합, 더 편함 |

### 컨테이너 런타임: OrbStack vs Colima vs Docker Desktop (네이티브 대안 포함)

| | Docker Desktop | Colima | OrbStack | 네이티브(컨테이너 없이) |
|---|---|---|---|---|
| 라이선스/비용 | 개인 무료, 팀/기업 유료($9+/월) | 무료, MIT | 무료 개인 티어 주장되나 이번 조회로 1차 확인 못함(UNVERIFIED) | 무료 |
| Apple Silicon | 지원 | 공식 지원, Rosetta 2 / GPU 가속 | "최적화" 주장(벤치마크는 자체 게시) | 해당 없음 |
| 기존 Lima VM과의 관계 | 별도 VM 엔진(하이퍼바이저 별도) | **Lima 그 자체 위에 구축**("Colima = Containers on Lima") | 자체 경량 VM | — |
| 메모리 풋프린트(16GB Mac에서 중요) | 상대적으로 무거움 | 기본 2GiB VM(조절 가능) | "0.1% 미만 유휴 CPU" 주장 | 가장 가벼움(VM 자체가 없음) |
| omnis 적합성 | 불필요한 기능(팀 협업 등)까지 포함 | 이미 있는 Lima와 겹쳐서 통합 쉬움 | 별도 VM 엔진 추가(Lima와 중복) | postgres는 brew로 네이티브 설치가 더 가벼움 |

### 원격 접근: Screen Sharing/VNC vs SSH-only

| | SSH(터미널만) | Screen Sharing/VNC over Tailscale |
|---|---|---|
| KakaoTalk/브라우저 GUI 확인·조작 | 불가 | 가능 |
| 대역폭/지연 | 낮음 | 화면 스트리밍이라 더 무거움 |
| Tailscale 위에서 포트 노출 필요성 | 불필요(SSH만) | 불필요(사설 IP/MagicDNS로 직결, 공인 포트포워딩 없음 — Tailscale 자체 특성상 타당, 전용 가이드는 이번 조회 UNVERIFIED) |
| 잠금화면 문제 | 무관 | **화면이 잠겨 있으면 GUI 자동화가 막힘 — 자동 로그인 + 화면 잠금 비활성화가 선행 조건** |

## 4. Recommendation for omnis

**launchd 아키텍처는 daemon/agent를 명확히 분리하라 (효과 M, 리스크 낮음).** Postgres, Hermes api_server(:8642), 브리지 서버처럼 화면이 필요 없는 백엔드는 `/Library/LaunchDaemons`(root, 부팅 즉시 기동, 로그인 불필요)로. KakaoTalk.app, LinkedIn용 브라우저 프로필처럼 GUI가 필요한 건 반드시 로그인한 유저의 `~/Library/LaunchAgents`(GUI 세션 종속)로 분리 — TN2083이 명확히 "daemon에서 GUI 앱 실행 불가"라고 못박았으므로 이건 선택이 아니라 제약이다. 두 계층 간 통신은 로컬 HTTP(:8642 같은)로 이미 하고 있으니 추가 IPC 설계는 불필요.

**GUI 세션을 절대 잠그지 마라 (필수, S, 리스크: 물리 보안 저하).** 자동 로그인 활성화(System Settings → Users & Groups) + `sudo pmset -c sleep 0 displaysleep 0 disksleep 0` + 화면보호기/잠금 비활성화. FileVault를 켠 상태에서는 자동 로그인이 보통 막히므로(업계 통설, 이번 조회로 Apple 1차 문서 확인은 실패 — UNVERIFIED 표시), FileVault를 끄거나 대안(APFS 볼륨 암호화 + 별도 키체인 잠금해제)을 검토해야 함. 트레이드오프: 물리적으로 접근 가능한 사람에게는 무방비 — 맥미니가 Tailscale-only 네트워크에 있고 물리 접근이 통제된 공간(집/사무실)이라는 전제가 깨지면 이 권장은 재검토 대상. `caffeinate -disu &`를 로그인 시 자동 실행하는 LaunchAgent 하나 추가해 pmset 설정이 시스템 업데이트 등으로 리셋돼도 이중 안전장치가 되게 하라.

**컨테이너는 Docker Desktop을 새로 깔지 말고 기존 Lima 기반으로 통합하라 (효과 M, 노력 S).** 브리프에 이미 Lima VM이 떠 있다고 했으므로, Colima(무료·MIT·Lima 네이티브)로 그 위에 Docker CLI 호환 런타임만 얹는 게 가장 라지 — Docker Desktop은 개인 무료 티어라도 GUI 오버헤드와 라이선스 정책 변경 리스크(과거 기업 규모 기준 유료 전환 전례)가 있고, OrbStack은 별도 VM 엔진이라 Lima와 중복. 16GB RAM 예산에서 "VM이 하나 더" 뜨는 건 피하는 게 맞다.

**프로세스 감독은 pm2로 통일하고, 로그는 pm2-logrotate에 맡겨라 (효과 S, 노력 S).** launchd plist를 서비스마다 손으로 쓰는 대신 `pm2 start ecosystem.config.js` 한 방 + `pm2 startup && pm2 save`로 재부팅 복구 자동화. pm2도 결국 launchd에 등록되므로 daemon/agent 분리 원칙은 그대로 유지해야 함(GUI 필요 프로세스를 pm2로 감싸도 daemon 세션에서 돌리면 여전히 못 띄움).

**백업: restic + 저가 오브젝트 스토리지, Time Machine은 로컬 스냅샷 보조용으로만 (효과 M, 노력 S).** postgres는 `pg_dump` 또는 WAL 아카이빙 후 restic으로 암호화 증분 백업, 대상은 Backblaze B2 같은 저가 S3-호환 스토리지(비용 민감 요구사항과 부합). Time Machine은 로컬 디스크 하나 더 붙여 켜두면 전체 시스템 스냅샷 안전망으로 공짜로 따라오니 끌 이유 없지만, 오프사이트 백업의 주력은 아니다.

**모니터링: healthchecks.io 무료 티어(20 jobs) + ntfy self-hosted (효과 M, 노력 S, 비용 0).** 각 launchd/pm2 서비스가 주기적으로 healthchecks.io에 ping(cron 스타일 dead-man's-switch), 실패 시 ntfy로 맥북/아이폰에 즉시 curl 한 줄 푸시. 둘 다 맥미니 자체에 self-host 가능(ntfy는 공식 self-host 가이드 존재)해서 외부 의존도 최소화하면서 비용도 0에 가깝다.

**리스크 요약**: ToS 리스크는 낮음(KakaoTalk/LinkedIn 자동화 자체의 계정 정지 리스크는 이 리포트 범위 밖, 다른 리서치 문서에서 다뤄야 함). 유지보수 리스크는 "자동 로그인 + 화면 잠금 해제 상태 유지"가 가장 크다 — macOS 업데이트가 pmset/자동 로그인 설정을 리셋시키는 경우가 실무에서 흔하므로(이번 조회로 1차 확인은 못함, UNVERIFIED이나 운영 상식), 부팅 시 설정을 재적용하는 LaunchAgent/스크립트를 두는 걸 권장.

## 5. What to Borrow

- **Daemon/Agent 분리 패턴** 그대로 omnis 서비스 배치 설계에 적용: `/Library/LaunchDaemons/ai.onwardlab.omnis-api.plist` (postgres 연결, Hermes 브리지, Slack/Gmail 폴러 등 headless) + `~/Library/LaunchAgents/ai.onwardlab.omnis-kakao-bridge.plist` (KakaoTalk.app 접근성 캡처, 로그인 세션 필수) — 참고: [Apple TN2083](https://developer.apple.com/library/archive/technotes/tn2083/_index.html)의 "split your program into multiple components" 섹션.
- **pm2 ecosystem.config.js**를 omnis 리포 루트에 두고 모든 Node/Bun 서비스(bridge, API, embedding worker)를 한 파일로 정의 — `pm2 startup`이 알아서 launchd로 등록해주므로 plist 여러 개 손으로 안 써도 됨. 참고: [PM2 startup-hook docs](https://pm2.io/docs/runtime/guide/startup-hook/).
- **Colima 설정 파일**(`~/.colima/default/colima.yaml`)을 브리프의 Lima VM 설정과 합쳐서, 임베딩 모델용 컨테이너(로컬 모델 서빙)를 이 VM 안에서 띄우는 걸 검토 — 이미 Lima가 떠 있으니 새 VM 안 만들어도 됨.
- **healthchecks.io ping URL 패턴**(`https://hc-ping.com/<uuid>/start`, `/fail`, exit code suffix)을 omnis의 "agent 세션이 죽었다" 감지에 그대로 재사용 가능 — Claude Code/Codex CLI/DeepSeek 세션이 주기적으로 heartbeat ping을 보내게 하면 omnis 자체 인박스에 "에이전트 세션 죽음" 알림을 healthchecks 웹훅으로 받을 수 있음.
- **ntfy curl 패턴**(`curl -d "message" <자체호스팅 URL>/topic`)을 omnis의 "context-aware reply draft 알림" 기능의 최소 구현으로 그대로 차용 가능 — 별도 push 인프라(APNs 등) 구축 전 임시 채널로.

## 6. Open Questions

- macOS 26.6에서 FileVault 활성 상태로 자동 로그인이 실제로 되는지(설정 UI가 막는지, 아니면 여전히 가능한지) — Apple 1차 문서로 이번 세션에 확인 못함. 직접 테스트 필요.
- OrbStack의 실제 가격 정책(무료 티어 존재 여부·제한)을 1차 소스(`orbstack.dev/pricing`)로 재확인 필요 — 이번 조회는 홈페이지만 봄.
- Tailscale 공식 문서에 macOS Screen Sharing/VNC 전용 가이드가 실제로 존재하는지(URL 특정), 그리고 Screen Sharing이 켜진 채로 화면이 "잠겨" 있을 때 GUI 자동화(Accessibility API 등)가 동작하는지 — 이건 KakaoTalk 캡처의 실질적 성패를 가름.
- pm2-logrotate의 macOS 기본 동작(파일 크기 임계값, 압축 여부)과 launchd 자체 stdout/stderr 리다이렉트(`StandardOutPath`)를 병행할 때 중복 로테이션이 안 생기는지.
- 16GB RAM 예산에서 Hermes + postgres + Lima/Colima VM + 로컬 임베딩 모델을 동시에 얹었을 때 실측 메모리 사용량 — 이번 리포트는 구성요소별 개별 주장만 모았고 통합 실측치는 없음(별도 벤치마크 필요).
- KakaoTalk.app을 Accessibility API로 읽는 게 카카오 ToS 위반 소지가 있는지 — 이 리포트 범위 밖, 별도 조사 필요.

## 7. Sources

- [Apple TN2083: Daemons and Agents](https://developer.apple.com/library/archive/technotes/tn2083/_index.html) — 2026-09-20 조회
- [Apple: Creating Launch Daemons and Agents](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html) — 2026-09-20 조회
- [ss64 pmset reference](https://ss64.com/mac/pmset.html) — 2026-09-20 조회
- [PM2 runtime startup-hook docs](https://pm2.io/docs/runtime/guide/startup-hook/) — 2026-09-20 조회
- [Colima GitHub README](https://github.com/abiosoft/colima) — 2026-09-20 조회
- [OrbStack homepage](https://orbstack.dev/) — 2026-09-20 조회
- [Docker pricing page](https://www.docker.com/pricing/) — 2026-09-20 조회
- [restic.net](https://restic.net/) — 2026-09-20 조회
- [healthchecks.io pricing](https://healthchecks.io/pricing/) — 2026-09-20 조회
- [healthchecks.io docs](https://healthchecks.io/docs/) — 2026-09-20 조회
- [ntfy docs](https://docs.ntfy.sh/) — 2026-09-20 조회
- [Beeper homepage](https://www.beeper.com/) — 2026-09-20 조회
- [Tailscale remote-desktop-access KB index](https://tailscale.com/kb/1092/remote-desktop-access) — 2026-09-20 조회 (문서 인덱스만 확인, 세부 가이드 미도달)
