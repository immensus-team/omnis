# KakaoTalk capture on a Mac mini (read + reply) — channel research

Fetched 2026-09-20 via WebSearch/WebFetch + `gh` CLI (GitHub repo API/README). All facts below are sourced live; no training-data recall used for anything dated or version-specific.

## 1. TL;DR

카카오톡은 개인 메시지용 공식 API가 없고 "폰 1대 + PC/태블릿 1대"만 동시 로그인 가능하다. 실전에서 검증된 최선의 route는 **kmsg**(`channprj/kmsg`, macOS Accessibility API로 KakaoTalk.app UI를 직접 제어하는 오픈소스 CLI+native MCP server, ★266, 활발히 관리됨) — read/watch(polling)/send/send-image를 JSON으로 제공하고 MCP server가 내장돼 있어 omnis 커넥터로 거의 그대로 붙일 수 있다. 위험은 "계정 정지"이며, kmsg 저자 본인도 "known cases of permanent suspension"을 README에 명시한다. LOCO 프로토콜 직접 구현(node-kakao)은 실제 밴 사례가 문서화돼 있어 배제. Android 에뮬레이터는 카카오의 "모바일 1대" 슬롯을 이미 iPhone이 쓰고 있어 구조적으로 막힌다. Notification Center DB와 Vision OCR은 low-risk 보조 신호/fallback으로만 쓸 만하다. 공식 Kakao Developers API(알림톡/친구톡/Login)는 개인 DM과 무관.

## 2. Facts

- **1인 1계정, 동시접속은 "스마트폰 1대 + PC/태블릿 1대"만 허용** — 두 PC에 동시 로그인 불가, 새 기기 로그인 시 이메일 인증 필요. VERIFIED. Source: 클리앙 포럼 스레드 및 a-ha 질의응답 다수 (검색 결과 종합), fetched 2026-09-20. 정확한 공식 문구는 카카오 고객센터 원문에서 재확인 권장(UNVERIFIED 세부 문구).
- **2단계 인증(2FA)**은 설정 > 카카오계정에서 켤 수 있고, 새 기기 로그인마다 추가 인증(이메일 등)을 요구한다. VERIFIED. Source: https://talksafety.kakao.com/toolandguide/account/auth (검색 스니펫), fetched 2026-09-20.
- **Kakao Developers 공식 메시지 API**(Kakao Talk Message API, 알림톡/친구톡/브랜드메시지)는 "서비스가 사용자에게 직접 메시지를 보낼 수 없다"는 원칙 하에, 자기 앱에 Kakao Login으로 동의한 "나에게 보내기" 또는 "친구(내 서비스에 가입한 친구)"에게만 발송 가능하다 — 임의의 개인 1:1 DM 수신/발신과는 무관. VERIFIED. Source: https://developers.kakao.com/docs/latest/en/kakaotalk-message/common (WebSearch 요약, 리다이렉트로 원문 직접 fetch는 실패), fetched 2026-09-20. 원문 전체 재확인은 UNVERIFIED로 표시.
- **`kmsg` (channprj/kmsg)**: macOS Accessibility API(AXUIElement)로 KakaoTalk.app의 실제 UI 트리를 탐색/제어하는 Swift CLI + native stdio MCP server. `chats`/`read`/`watch`/`send`/`send-image`/`friend add`/`open-profile start` 명령 제공, JSON 출력, `chat_id` 로컬 레지스트리(`~/.kmsg/chat-registry.json`), `read --background-safe`는 KakaoTalk을 실행/활성화하지 않고 이미 열려 있는 창만 읽음, `--capture-images`는 ScreenCaptureKit으로 이미지 캡처(화면 기록 권한 필요), self-healing AX path cache. MIT 라이선스, ★266, fork 44, 최근 push 2026-08-23(활발). VERIFIED. Source: `gh api repos/channprj/kmsg`, repo README, fetched 2026-09-20.
- **kmsg 저자의 리스크 판단**: LOCO 프로토콜 대신 AX를 쓴 이유로 "LOCO 리버스엔지니어링은 명백한 ToS 위반"이라 명시하고, "automation/unofficial protocol 사용으로 인한 영구정지 사례가 다수 존재한다"고 경고한다. AX 방식이 "상대적으로 더 안전"하다는 것은 저자 개인 판단이며 공식 Kakao 입장이 아니라고 명시. VERIFIED (저자 주장 자체). Source: ARCHITECTURE.md (WebFetch 요약), fetched 2026-09-20.
- **`smallfish06/kmsg`**: 같은 이름의 별도/신생 구현체, 0 star, 어제(2026-09-19) push — 성숙도가 훨씬 낮음. VERIFIED (메타데이터). Source: `gh api repos/smallfish06/kmsg`, fetched 2026-09-20.
- **LOCO 프로토콜 라이브러리 `storycraft/node-kakao`**: KakaoTalk의 비공개 프로토콜을 직접 구현해 서버에 클라이언트인 척 접속 — MIT, ★424/fork 116이지만 **마지막 push는 2023-11-11로 3년째 정지**. VERIFIED. Source: `gh api repos/storycraft/node-kakao`, fetched 2026-09-20.
- **LOCO 사용에 따른 실제 밴 사례**: 한국어 블로그(alonalab.kr)가 LOCO 기반 봇 사용으로 영구정지된 경험을 직접 서술; 카카오 공식 오픈채팅 봇 API도 남용 문제로 v4.5.0 이후 지원 중단됐다는 서술이 검색됨. VERIFIED (커뮤니티 서술 다수, 카카오 공식 성명은 미확인 → UNVERIFIED 세부).
- **Mac 로컬 KakaoTalk DB는 SQLCipher로 암호화**되어 있고, 공개된 복호화 스크립트(gist by blluv)는 userId+device UUID로 PBKDF2-HMAC-SHA256(100k iter) 키를 유도하는 방식이나, 저자 스스로 "userId는 bruteforce 필요"라 명시하고 최근 활동은 2026년 3월, star 0, 리비전 2개뿐으로 사실상 미완성/미유지보수. VERIFIED (내용), 실제 동작 여부는 미검증 → UNVERIFIED.
- **jiru/kakaodecrypt**(Android 버전 DB 복호화)는 ★90, 최근 push 2024-04, 라이선스 WTFPL — Android 전용이며 Mac 앱 DB 포맷과는 다름. VERIFIED. Source: `gh api repos/jiru/kakaodecrypt`, fetched 2026-09-20.
- **실전 하이브리드 사례**(gpters.org 블로그, Claude Code 커뮤니티): LOCO 기반 `agent-messenger`(실시간 발신 + 앱 오프라인 시 ±1일치 이력)와 Mac 로컬 SQLCipher DB(3.1년치 이력, 8,058명 연락처/458개 채팅방 캐시)를 patch script로 결합해 사용 중이라는 1인 사례 보고. 계정 밴/ToS 논의는 해당 글에 없음(=리스크를 다루지 않음). VERIFIED (글 내용), 실전 검증 수준은 UNVERIFIED.
- **`NomaDamas/k-skill`의 `katok` CLI**: KakaoTalk 대화를 로컬에 아카이브하고 키워드/BM25/의미 검색을 지원하는 **읽기 전용** 도구. 문서에 "메시지 발신/삭제, UI 자동화, DB 내부 직접 조사, 인증정보/복호화 자료 취급 금지"가 명시돼 있어, DB를 직접 복호화하지 않고 아마 KakaoTalk 자체의 "대화 내보내기" 결과물 등을 인덱싱하는 것으로 추정됨(원문에 데이터 소스가 명시적으로 "내보내기"라 적혀있지는 않음 → UNVERIFIED 세부). k-skill 저장소 자체는 ★7,625, 최근 push 2026-09-19로 매우 활발. VERIFIED (star/활동, 정책 문구), 데이터 소스 상세는 UNVERIFIED.
- **macOS Notification Center DB**는 macOS Sequoia부터 `~/Library/Group Containers/group.com.apple.usernoted/db2/db`(SQLite)로 이동했고, 이 경로는 TCC(Group Container) 보호를 받아 Full Disk Access 등 명시적 권한 승인이 있어야 읽을 수 있다 — 이전 경로(`/private/var/folders/...`)와 달리 임의 프로세스가 몰래 읽을 수 없게 됐다. VERIFIED. Source: 9to5Mac 2024-07 기사, mjtsai.com, x.com/theevilbit 스레드 (검색 요약), fetched 2026-09-20.
- **macOS는 기본적으로 포그라운드(활성) 앱의 알림 배너를 표시하지 않는다**는 것은 macOS의 일반적 동작(본 세션 지식 기반, 이번 검색으로 KakaoTalk 특화 확인은 못함) → **UNVERIFIED**(카카오톡 앱에 이 일반 규칙이 그대로 적용되는지는 별도 실기 검증 필요).
- **Apple Vision framework 기반 OCR CLI**가 다수 존재(`mac-ocr`, `macos-vision-ocr`, `macvision` 등) — macOS 10.15+/온디바이스, 한국어 포함 다국어 지원, 클라우드 호출 없이 무료. VERIFIED. Source: GitHub 검색 결과 각 repo 설명, fetched 2026-09-20.
- **Android 에뮬레이터 + Google Play Services on Apple Silicon**: BlueStacks Air(Apple Silicon 네이티브, 2024-12 출시)와 Android Studio의 arm64-v8a + Play Store 시스템 이미지가 2025년 기준 Apple Silicon에서 KakaoTalk(arm64-v8a APK 존재)을 구동 가능한 것으로 보임. VERIFIED (일반 호환성), KakaoTalk이 실제로 이 에뮬레이터들에서 계정 인증까지 문제없이 통과하는지는 UNVERIFIED.
- **카카오톡 봇/LOCO 관련 나무위키·블로그 서술**: LOCO는 원래 오픈채팅방 관리용으로 공개된 게 아니라 리버스엔지니어링된 것이며, 봇 제작자 커뮤니티 내에서도 "쓰면 위험하다"는 인식이 퍼져 있다는 서술이 다수 검색됨. VERIFIED (커뮤니티 인식 서술), 정량적 밴 확률 데이터는 없음 → UNVERIFIED.

## 3. Options / comparison table

| Route | Read | Write(reply) | 성숙도/유지보수 | Ban 위험 | Effort | 비고 |
|---|---|---|---|---|---|---|
| **kmsg (channprj) — AX 자동화 + MCP** | 상세(방 목록/메시지/실시간 watch) | 텍스트+이미지 전송, dry-run 지원 | 높음(★266, 최근 push, Homebrew 배포) | 중간(저자 자인, 실밴 사례는 미확인) | **S** (brew install + MCP 연결) | omnis 커넥터의 1순위 후보. background-safe read 모드 존재 |
| smallfish06/kmsg | 상세(추정, README 미확인) | 추정 가능 | 매우 낮음(★0, 어제 생성) | 중간(같은 접근) | S | 검증 부족, 채택 보류 |
| Notification Center DB 읽기 | 배너 미리보기(발신자+짧은 본문)만 | 불가 | 높음(OS 표준 SQLite, 위치 안정적) | 거의 없음(로컬 파일 읽기, 카카오 계정과 무관) | **S** | 카카오톡이 포그라운드면 배너 자체가 안 옴(추정, 미검증). "새 메시지 도착" 트리거로만 적합 |
| 화면 캡처 + Vision OCR/VLM | 화면에 보이는 텍스트 전부(이미지 포함 서술 가능, VLM 사용 시) | 불가(별도 클릭 자동화 필요) | 높음(Vision framework 자체는 안정적 OS API) | 거의 없음(수동적 관찰) | M | kmsg AX 경로가 카카오톡 업데이트로 깨졌을 때의 fallback/검증용으로 적합 |
| 로컬 SQLCipher DB 복호화(gist) | 과거 이력 전체(1회성 backfill) | 불가 | 매우 낮음(★0, userId bruteforce 필요, 미완성) | 낮음~중간(계정 조작은 없지만 암호화 우회 자체가 회색지대) | **L** | 롱텀메모리 백필용 실험 후보, 실서비스 의존은 비권장 |
| LOCO 프로토콜(node-kakao 등) | 상세, 실시간 | 가능 | 낮음(3년째 미갱신) | **높음(실제 영구정지 사례 문서화)** | L | 채택하지 않음 |
| Android 에뮬레이터 + NotificationListenerService/AccessibilityService | 상세(Android 봇 생태계 재사용 가능) | 가능 | 중간(에뮬레이터 자체는 성숙) | 높음(자동화 자체 리스크 + **구조적 충돌**) | L | 카카오의 "모바일 1슬롯"을 이미 iPhone이 점유 → 병행 불가 |
| Kakao 공식 API(Login/알림톡/친구톡/Channel) | 불가(개인 DM) | 불가(개인 임의 상대) | 높음(공식, 안정적) | 없음 | N/A | 이 유스케이스에는 원천적으로 부적합 |

## 4. Recommendation for omnis

**MVP = `kmsg`(channprj fork)를 Mac mini에 Homebrew로 설치하고, 내장 native MCP server(`kmsg mcp-server`)를 omnis의 KakaoTalk 커넥터로 그대로 연결한다.** Mac mini에는 이미 KakaoTalk.app이 설치돼 있고 이것이 카카오의 "PC 1슬롯"을 차지하는 구조이므로 (iPhone이 "모바일 1슬롯"), kmsg는 그 위에서 추가 계정 슬롯 소모 없이 동작한다. Effort: **S** — brew install, KakaoTalk.app 자동 로그인 유지 설정, MCP 연결 배선만 하면 됨. `kmsg auth login`으로 카카오 비밀번호를 kmsg 자체 암호화 저장소에 넣는 기능은 **쓰지 않는 것을 권장** — KakaoTalk.app 자체의 "로그인 상태 유지"만으로 충분하고, 불필요한 비밀번호 저장 표면을 늘릴 이유가 없다.

Risk는 **medium, 지속 모니터링 필요**: kmsg 저자 본인이 README에 "automation/unofficial protocol 사용으로 인한 영구정지 사례가 다수"라고 명시했고, AX 방식이 LOCO보다 안전하다는 것은 저자의 개인 판단일 뿐 카카오의 공식 보증이 아니다. 완화책: (1) 폴링 주기를 과도하게 짧게 잡지 않는다(`watch`의 기본 0.2s는 실사용 관찰 후 조정), (2) `send`는 항상 dry-run 확인 후 1회 실행하는 kmsg의 기본 UX를 그대로 유지해 오발송/폭주를 막는다, (3) 카카오 계정에 2FA를 켜서 세션 탈취 대비를 별도로 강화한다(이건 밴 리스크가 아니라 계정 보안이지만 같이 챙길 가치가 있음).

**Fallback = macOS Notification Center DB + Vision OCR 조합.** kmsg의 AX 경로가 카카오톡 업데이트로 깨질 경우(자체 self-healing cache가 있지만 완전하지 않을 수 있음), (a) Notification DB를 "새 메시지 도착" 저비용 트리거로 쓰고 (b) 화면 캡처+Vision OCR(`macos-vision-ocr` 등, 무료/온디바이스)로 내용을 뽑아내는 이중 경로를 준비해 둔다. 단, 카카오톡이 포그라운드일 때 배너가 안 뜨는 일반 macOS 동작이 실제로 적용되는지는 미검증이므로 먼저 실기 테스트가 필요하다.

**명시적으로 배제**: LOCO 프로토콜 직접 구현(node-kakao 등)은 실제 영구정지 사례가 문서화돼 있고 라이브러리 자체도 3년째 방치돼 채택 이유가 없다. Android 에뮬레이터 경로는 카카오의 "모바일 1슬롯"을 이미 iPhone이 쓰고 있어 구조적으로 병행 불가능하다(에뮬레이터에서 KakaoTalk에 로그인하면 iPhone 세션이 로그아웃되거나 반대로 막힘). 공식 Kakao Developers API(알림톡/친구톡/Kakao Login)는 개인 1:1 DM과 무관하므로 처음부터 고려 대상이 아니다.

**롱텀메모리 백필(별도 트랙)**: 실시간 캡처와 별개로, "inbox + local files + Drive + GitHub 기반 장기 기억"이라는 omnis 목표를 위해 과거 대화 이력을 통째로 채워 넣고 싶다면, `k-skill`의 `katok`처럼 **카카오톡 자체 "대화 내보내기" 기능으로 export한 텍스트를 인덱싱**하는 방식이 SQLCipher 복호화보다 훨씬 낮은 리스크·낮은 유지보수 비용이다(암호화 우회 자체가 회색지대이고 카카오가 암호화 스킴을 바꾸면 즉시 깨짐). SQLCipher 직접 복호화(gist)는 effort L, 성공 여부 UNVERIFIED인 실험 트랙으로만 남겨둔다.

## 5. What to borrow (features, UX, architecture, code)

- **kmsg의 native MCP server 자체를 재사용**: `kmsg mcp-server` (stdio, read/send-text/send-image 툴 제공) — omnis가 AX 자동화를 처음부터 새로 짤 필요 없이 이 바이너리를 그대로 KakaoTalk 커넥터로 shell-out/embed하면 됨. 이게 effort를 L에서 S로 낮추는 핵심 포인트.
- **`chat_id` 로컬 레지스트리 패턴**: `~/.kmsg/chat-registry.json` — 채팅방 이름(가변)을 안정적인 synthetic ID로 매핑하고, 동명 채팅방은 별도 ID 유지, 방 이름이 바뀌면 새 ID로 취급. omnis의 "여러 소스에 걸친 통합 thread ID" 설계에 그대로 대응하는 참고 패턴.
- **`read --background-safe` 모드 설계**: KakaoTalk을 실행/활성화하지 않고 이미 열린 창만 읽는 모드 — Mac mini가 다른 자동화(Hermes, postgres, Lima VM 등)와 동시에 여러 작업을 돌릴 때 포커스를 뺏지 않는 폴링이 필요하다는 omnis의 요구와 정확히 맞음. omnis KakaoTalk 커넥터의 기본 폴링은 이 모드를 쓰고, `send`처럼 실제 UI 조작이 필요한 동작만 포그라운드로 전환.
- **`send`/`friend add`의 dry-run 기본값**: 실제 전송 전 항상 시뮬레이션 결과를 보여주고, 명시적 확인 후에만 1회 실행 — omnis의 "reply draft with notification" 기능, 그리고 이 세션 자체가 따르는 "메시지 전송은 명시적 승인 필요"라는 원칙과 UX 상으로 정확히 일치. 그대로 차용.
- **AX self-healing path cache**(`AXPathCache`): 자주 쓰는 UI 경로를 캐시하고, 카카오톡 UI가 바뀌어 경로가 깨지면 재탐색 — omnis의 다른 UI-자동화 기반 커넥터(있다면)에도 적용할 수 있는 일반 설계 교훈: "구조적 셀렉터가 깨지면 자동 재탐색 + 로그"를 기본 패턴으로 둘 것.
- **`katok`(k-skill)의 read-only/export 기반 아카이빙**: 실시간 캡처(kmsg)와 과거 이력 인덱싱(katok류)을 아예 다른 파이프라인으로 분리하는 구조 — omnis의 "long-term memory" 빌더가 라이브 채널 커넥터와 별도로 동작해야 한다는 설계 근거로 그대로 인용 가능.
- **Apple Vision OCR CLI들**(`mac-ocr`, `macos-vision-ocr`): 클라우드 비용 없는 온디바이스 fallback/검증 레이어 — omnis 브리프의 "cost-sensitive, 로컬 모델/캐싱 우선" 방향과 정확히 맞는 부재료로 kmsg fallback에 바로 꽂을 수 있음.

## 6. Open questions

- Mac mini 화면이 잠겨 있거나(로그인 세션은 살아있되 화면 lock) GUI 세션에 물리적으로 아무도 없는 상태에서 kmsg의 AX 읽기/CGEvent 전송이 실제로 동작하는지 — 문서에 명시 없음, 실기 테스트 필요.
- kmsg(channprj) 방식의 실제 계정 정지 이력이 1년 이상 장기적으로 얼마나 되는지 — 현재는 ★266에 수개월 커뮤니티 사용 데이터뿐, "AX가 LOCO보다 안전하다"는 저자 주장을 뒷받침할 정량 데이터 없음.
- `k-skill`의 `katok`이 실제로 SQLCipher DB를 전혀 건드리지 않고 카카오톡 자체 export 기능만 쓰는지, 아니면 다른 방식으로 로컬 아카이브를 만드는지 — 문서 서술이 모호해서 직접 설치해 데이터 소스를 확인해야 함.
- macOS가 KakaoTalk.app이 포그라운드일 때 알림 배너를 억제하는지 여부(일반 macOS 규칙이 이 앱에도 그대로 적용되는지) — 실기 검증 필요, Notification DB fallback의 실효성에 직결됨.
- 카카오의 2025-06-16 정책 개정(콘텐츠 검열 강화) 이후 자동화 계정에 대한 탐지/제재 기준이 달라졌는지 — 검색으로 공식 자료를 찾지 못함.
- kmsg의 `watch` 폴링(다수 채팅방 동시 감시 시 0.2~10s 간격)이 16GB M4 mini에서 Hermes/postgres/Lima VM과 동시에 돌 때 CPU/AX 트리 경합으로 안정성 문제를 일으키는지 — 부하 테스트 필요.

## 7. Sources

- https://github.com/channprj/kmsg — repo README, ARCHITECTURE.md (fetched via `gh api`/WebFetch, 2026-09-20)
- https://github.com/smallfish06/kmsg — repo metadata (fetched via `gh api`, 2026-09-20)
- https://github.com/storycraft/node-kakao — repo metadata (fetched via `gh api`, 2026-09-20)
- https://github.com/jiru/kakaodecrypt — repo metadata (fetched via `gh api`, 2026-09-20)
- https://gist.github.com/blluv/8418e3ef4f4aa86004657ea524f2de14 — Mac KakaoTalk DB decrypt script (fetched via WebFetch, 2026-09-20)
- https://github.com/NomaDamas/k-skill/blob/main/docs/features/kakaotalk-mac.md — `katok` docs (fetched via WebFetch, 2026-09-20) + repo metadata (`gh api`)
- https://www.gpters.org/dev/post/kakaotalk-macro-era-how-lEVSOKmyNxOqCtI — hybrid LOCO+SQLCipher real-world usage (fetched via WebFetch, 2026-09-20)
- https://developers.kakao.com/docs/latest/en/kakaotalk-message/common — official Kakao Talk Message API (WebSearch summary, 2026-09-20; direct fetch redirected/unconfirmed)
- https://9to5mac.com/2024/09/01/security-bite-apple-addresses-privacy-concerns-around-notification-center-database-in-macos-sequoia/ — Notification Center DB TCC protection (WebSearch, 2026-09-20)
- https://x.com/theevilbit/status/1811758367045537990 — Notification Center DB path change (WebSearch, 2026-09-20)
- https://talksafety.kakao.com/toolandguide/account/auth — 2FA/device login (WebSearch, 2026-09-20)
- https://blog.alonalab.kr/55 — LOCO 사용 후 계정 정지 경험담 (WebSearch, 2026-09-20)
- https://github.com/topics/ocr?l=swift — Vision-framework OCR CLI 목록 (`mac-ocr`, `macos-vision-ocr`, `macvision`) (WebSearch, 2026-09-20)
- BlueStacks Air / Android Studio arm64-v8a Play Store images — Apple Silicon Android emulator compatibility (WebSearch, 2026-09-20)

## Verification (adversarial)

Adversarial re-check performed 2026-09-20 against primary sources (`gh api`, repo README/ARCHITECTURE.md/docs fetched via `gh api .../contents/...`, direct WebFetch of vendor/press pages). WebSearch quota was exhausted mid-session (200/200 used by a prior call in this session) — claims that needed a fresh search and had no direct URL fallback are marked `unverifiable`, not `confirmed`, per instruction.

| # | Claim (short) | Verdict | Evidence URL | Correction |
|---|---|---|---|---|
| 1 | kmsg: ★266/44 forks/MIT/pushed 2026-08-23, macOS AX-based CLI+native stdio MCP server, chats/read/watch/send/send-image, JSON, chat_id registry, background-safe read, self-healing AX cache | **CONFIRMED** (repo metadata exact match; features verbatim in README/ARCHITECTURE.md) | https://github.com/channprj/kmsg (gh api repos/channprj/kmsg, README, ARCHITECTURE.md — fetched 2026-09-20) | Sub-point needs correction: the native MCP server (`kmsg mcp-server`) exposes only 3 tools — `kmsg_read`, `kmsg_send`, `kmsg_send_image`. `watch` is explicitly **not** an MCP tool; `docs/openclaw.md` says real-time detection requires running `kmsg watch "<chat>" --json` as a **separate process** and piping events in yourself. Any connector design assuming one MCP session covers live watching is wrong — it needs two processes. |
| 2 | kmsg author warns of real permanent-suspension cases from automation/unofficial-protocol use; AX-over-LOCO is his personal risk judgment, not Kakao's guarantee | **CONFIRMED** (verbatim) | https://github.com/channprj/kmsg/blob/main/ARCHITECTURE.md#accessibility-instead-of-a-private-protocol (fetched 2026-09-20) | None. Quote: "이런 방식의 자동화나 비공식 프로토콜 사용과 관련해 계정이 영구정지된 사례도 이미 적지 않게 알려져 있어서... 이것도 어디까지나 제 개인적인 판단일 뿐이며, 카카오의 공식 입장이나... 해석과는 다를 수 있습니다." |
| 3 | node-kakao (LOCO reimpl) stale since 2023-11-11 (★424); real ban cases documented in Korean blogs; Kakao open-chat bot support reportedly dropped after v4.5.0 | **CONFIRMED** (staleness + real ban case) / v4.5.0 detail **unverifiable** | https://github.com/storycraft/node-kakao (gh api, pushed_at 2023-11-11T10:40:32Z, ★424 exact match); https://blog.alonalab.kr/55 (WebFetch 2026-09-20) | alonalab.kr/55's ban is real ("영구정지") but dated 2022-11-21, for a LOCO-based open-chat spam-removal bot — narrower than a generic "LOCO bot use" case. The v4.5.0 discontinuation detail could not be re-verified this session (WebSearch quota exhausted, no direct source URL); leave as unverifiable, same as the original file already flagged. |
| 4 | KakaoTalk allows only 1 mobile + 1 PC/tablet session concurrently; email verification on new-device login; 2FA optional | **UNVERIFIABLE** — no primary source found this session | Checked https://talksafety.kakao.com/toolandguide/account/auth (WebFetch 2026-09-20) | That page covers 2FA only and does **not** mention device-session limits or email verification at all — it does not support the claim, it's simply silent on it. It also frames 2FA as something users are urged ("반드시... 진행해 주세요") to turn on, not a default-on requirement — consistent with "optional." The core session-limit claim (the load-bearing fact behind excluding the Android-emulator route) still needs an official Kakao CS article; do not treat it as settled. |
| 5 | Kakao Developers Message API only sends to 'me' or Kakao-Login-consented friends inside the developer's own app — no arbitrary personal 1:1 DM API | **CONFIRMED** | https://developers.kakao.com/docs/en/kakaotalk-message/common (WebFetch 2026-09-20, after following the 302 redirect from the /latest/ URL) | The `/docs/latest/en/...` URL 302-redirects to `/docs/en/...` — cite the redirected URL, not the `/latest/` one, to avoid a dead link in the doc. |
| 6 | macOS Sequoia moved Notification Center DB to a TCC/FDA-protected Group Container (previously unprotected); it only exposes banner previews, not full message content | **PARTIALLY REFUTED** | https://9to5mac.com/2024/09/01/security-bite-apple-addresses-privacy-concerns-around-notification-center-database-in-macos-sequoia/ (WebFetch 2026-09-20) | Location move + new TCC protection: confirmed. But "only... banner previews, not full message content" is wrong — the article states the (pre-Sequoia, unprotected) DB stored "your iMessages, file paths, Slack, X, Facebook, and any other notifications... visible in plaintext," i.e. full content, not truncated previews. So the Notification DB fallback is potentially **more** capable (and more privacy-sensitive) than the file's "low-risk, trigger-only" framing suggests — it's gated by FDA now precisely because it held full message text, not because it was ever limited to short previews. |
| 7 | blluv Mac-KakaoTalk-DB SQLCipher decrypt gist requires bruteforcing userId, essentially unmaintained (★0, last activity March 2026, 2 revisions) | **CONFIRMED** | https://gist.github.com/blluv/8418e3ef4f4aa86004657ea524f2de14 (gh api gists/..., updated_at 2026-03-04T00:06:52Z, history length 2 — exact match) | None on the verifiable parts. (Gist "★0" star count was read from the page by WebFetch, not independently re-confirmed via the gists API in this pass — low-stakes, doesn't change the verdict.) |
| 8 | NomaDamas/k-skill's `katok` (★7,625, very active) is a strictly read-only/archival CLI that bans sending/UI-automation/DB-internals inspection, better for long-term-memory backfill than live capture | **PARTIALLY REFUTED** | https://github.com/NomaDamas/k-skill (gh api, ★7625, pushed 2026-09-19T15:05:22Z — matches); https://github.com/NomaDamas/k-skill/blob/main/docs/features/kakaotalk-mac.md (gh api contents, fetched 2026-09-20) | Read-only / no-send / no-UI-automation: confirmed verbatim ("메시지 전송, 삭제, UI 자동화... 포함하지 않는다", "메시지 전송과 삭제를 지원하지 않는다"). But "likely useful for backfill rather than live capture" is wrong — the doc explicitly supports live sync: "live macOS 카카오톡 ingestion은 `katok sync --source macos --json`으로만 수행한다." It's designed for both backfill *and* ongoing live ingestion (pull/poll-based, not push like kmsg's `watch`). Also: the file's open question ("does katok use KakaoTalk's own export, or something else?") leans the wrong way — the doc requires **Full Disk Access** on the terminal and a `--macos-probe` mode that explicitly diagnoses "container, DB 파일 접근" (container/DB file access), pointing toward direct FDA-gated access to the local app container/DB rather than a plain "대화 내보내기" text export. That raises its sensitivity closer to the SQLCipher-gist route than the file's low-risk framing implies — worth re-verifying by installing it. Also, the doc's own repo/host is `NomaDamas/katok` via a separate `brew tap NomaDamas/katok`; k-skill just carries the *skill wrapper* around it, not the tool itself — a naming nuance worth fixing in citations. |
| 9 | Apple-Silicon Android emulation (BlueStacks Air since Dec 2024; Android-Studio arm64-v8a+Play images) is technically feasible for KakaoTalk (arm64-v8a APK exists) but blocked by the one-mobile-slot limit vs. the iPhone | **CONFIRMED** (APK + emulator capability) / **UNVERIFIABLE** (BlueStacks Air's exact Dec-2024 date; the blocking mechanism, since it depends on claim #4) | https://www.apkmirror.com/apk/kakao-corp/kakaotalk/ (WebFetch 2026-09-20 — arm64-v8a variants listed, e.g. "26.8.1 arm64-v8a + arm-v7a (480-640dpi) (Android 10+)"); https://developer.android.com/studio/run/emulator-acceleration (WebFetch 2026-09-20 — confirms arm64-v8a system images run natively via Hypervisor.Framework on Apple Silicon); BlueStacks Air existence confirmed via https://www.bluestacks.com/ ("Apple Silicon에 최적화된... 네이티브 시스템") but its launch date and Google-Play-Store bundling could not be re-confirmed this session (WebSearch exhausted, official press-release URL not found) | The technical-feasibility half is solid. The "blocked by session limit" half is only as strong as claim #4, which is unverifiable this session — don't present the exclusion of the Android-emulator route as settled fact without that primary source. |

**Additional architecture-critical claims checked (beyond the 9 listed):**

- `jiru/kakaodecrypt` (Android DB decrypt, ★90, WTFPL, last push 2024-04-23): **CONFIRMED** exactly via `gh api repos/jiru/kakaodecrypt` (stars 90, pushed_at 2024-04-23T13:37:30Z, license WTFPL). https://github.com/jiru/kakaodecrypt
- gpters.org hybrid real-world case (LOCO `agent-messenger` for live send + local SQLCipher DB for history, via a patch script, no ban/ToS discussion in the post): **CONFIRMED** — WebFetch confirms the patch script (`patch_messenger.py`), the "3.1년치"/8,058-contact/458-room figures, an automatic LOCO-fallback path, and confirms the post contains zero ban/ToS risk discussion. https://www.gpters.org/dev/post/kakaotalk-macro-era-how-lEVSOKmyNxOqCtI
- `smallfish06/kmsg` (★0, low maturity, recent push): **CONFIRMED** — `gh api repos/smallfish06/kmsg` shows 0 stars, created 2026-06-20, pushed 2026-09-19T14:55:24Z (i.e., "pushed yesterday" relative to the file's 2026-09-20 fetch date is accurate; "생성" wording in the original file is slightly imprecise since the repo was actually created 2026-06-20, not the day before — minor wording fix only).

### Corrected recommendation

Two of the refutations above change the risk/effort picture in Section 4, and should be reflected there:

1. **Notification Center DB fallback is not just a "low-risk trigger."** Primary-source evidence (9to5mac) shows this database has historically held full plaintext notification content (including iMessage text), not truncated banner previews — which is *why* Apple gated it behind TCC/Full Disk Access in Sequoia. Treat any future FDA grant for this path with the same sensitivity as the primary kmsg AX route, not as a free, low-stakes trigger signal; and don't assume it caps out at short previews when scoping what the fallback could extract if ever authorized.

2. **`katok` is not a safely-scoped, backfill-only, export-based tool — re-verify before adopting it for the long-term-memory track.** It explicitly supports live macOS ingestion (`katok sync --source macos`), and its Full-Disk-Access + `--macos-probe` container/DB-access diagnostics point toward direct access to the local KakaoTalk app container/DB rather than the KakaoTalk "대화 내보내기" export the original recommendation assumed. This likely puts `katok`'s risk/maturity profile closer to the SQLCipher-gist route (effort **L**, needs its own verification) than to the "S, effort-low, backfill-only" framing in the current Section 4 — install and inspect its actual data source (`katok doctor --macos-probe --json`) before committing to it as the long-term-memory backfill plan.

Section 4's core MVP pick (`kmsg` via Homebrew + native MCP server) is unaffected by any refutation above and stands, with one architecture fix: wire up `kmsg watch --json` as a second, separate process for live inbound detection — the MCP server alone (`kmsg mcp-server`) does not expose `watch`.
