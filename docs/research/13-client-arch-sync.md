# 13 — macOS + iPhone 클라이언트 아키텍처 & Tailscale 허브 실시간 동기화

## 1. TL;DR

macOS 클라이언트는 웹 스택 재사용이 가능한 **Tauri 2**(stable, 2.11.x)로, 순수 네이티브가 아니어도 Apple-native 느낌은 SwiftUI 수준 커스터마이징으로 충분히 낼 수 있음. iOS는 Tauri 2의 모바일 지원이 아직 desktop만큼 성숙하지 않아 리스크가 있고, 대신 **PWA(설치형, iOS 26 기준 기본 web-app 모드)**로 MVP를 띄우는 편이 개발비가 가장 쌈. 단, PWA는 APNs 없이 Web Push만 가능하고 백그라운드 실행이 제한적. Push는 Apple Developer Program($99/년) 없이는 진짜 APNs를 못 쓰므로, v2에서 네이티브 iOS 껍데기(Tauri iOS 또는 Capacitor)로 전환 권장. 동기화는 자체 WebSocket 대신 **Zero(Rocicorp)** 같은 local-first sync 엔진을 hub-authoritative Postgres 위에 얹는 게 오프라인/백그라운드 iPhone에 유리함. 허브 접근은 공식 **TailscaleKit**(tsnet을 iOS/macOS 앱에 VPN 프로필 없이 내장)이 유력한 발견 — Tailscale Serve HTTPS의 iOS 인증서 버그(#19147, 미해결)를 우회 가능.

## 2. Facts

- **Tauri 2**는 2024-10-02에 stable 출시, 2026-09-19 기준 최신 push는 여전히 활발(4.4만+ 커밋 이력, ★111,195 on tauri-apps/tauri). iOS/Android 지원은 2.0부터 있지만 팀 스스로 "mobile as first-class citizen은 아직 아님"이라고 밝힘. VERIFIED — [Tauri 2.0 RC blog](https://v2.tauri.app/blog/tauri-2-0-0-release-candidate/), `gh repo view tauri-apps/tauri` (2026-09-20 조회).
- **Tauri 3.0**은 2026-09-15에 alpha.0/alpha.1 출시됨(GTK3/4 런타임 분리 등 주로 Linux 쪽 변경). 프로덕션에는 아직 안 씀. VERIFIED — [tauri-v3.0.0-alpha.1 release](https://github.com/tauri-apps/tauri/releases/tag/tauri-v3.0.0-alpha.1), 2026-09-20 조회.
- **microsoft/react-native-macos**가 유일하게 유지보수되는 RN-macOS 포크(ptmt 원조는 deprecated). 2026-09-14에도 push 있었고 ★4,385. VERIFIED — [repo](https://github.com/microsoft/react-native-macos/), `gh repo view` 2026-09-20 조회.
- **iOS 26**부터 홈 화면에 추가한 사이트가 기본적으로 설치형 web app으로 열림(이전엔 옵션이었음). Web Push 자체는 iOS 16.4부터 지원됐고 홈 화면 설치가 구독 전제조건. 2026까지 개선 속도는 느림("가장 영향력 큰 갭은 안 건드림"). VERIFIED — [MobiLoud PWA iOS 2026 guide](https://www.mobiloud.com/blog/progressive-web-apps-ios/), 2026-09-20 조회.
- **Tailscale Serve**는 tailnet HTTPS 인증서를 자동 발급하지만, iPhone에서 `*.ts.net` HTTPS 엔드포인트에 SSL 프로토콜 에러가 나는 미해결 버그가 있음(#19147, 댓글/담당자 없음, iCloud Private Relay 끄기·재설치로도 미해결). UNVERIFIED(재현율/범위) 하지만 이슈 존재 자체는 VERIFIED — [GitHub issue #19147](https://github.com/tailscale/tailscale/issues/19147), 2026-09-20 조회.
- **TailscaleKit**은 공식 Tailscale Swift 패키지(`tailscale/libtailscale`)로, tsnet 노드를 iOS/macOS 앱에 직접 내장해 시스템 VPN 프로필/NetworkExtension 엔티틀먼트 없이 tailnet 노드에 직접 dial/listen 가능. iOS 시뮬레이터 없는 순정 프레임워크가 있어 "App Store 제출에 적합"하다고 README에 명시. 2026-08-31 push. VERIFIED — [libtailscale swift README](https://github.com/tailscale/libtailscale/blob/main/swift/README.md), 2026-09-20 조회.
- **tsnet**은 Go 프로그램에 Tailscale 노드를 gVisor 기반 userspace TCP/IP 스택으로 내장, root 불필요, 별도 데몬 불필요, 동일 바이너리 안에 여러 독립 노드 실행 가능. VERIFIED — [Tailscale tsnet docs](https://tailscale.com/docs/features/tsnet), 2026-09-20 조회.
- **Zero(Rocicorp)**는 Postgres 백엔드의 서버-authoritative sync 엔진으로 React Native/Expo를 공식 지원(`expo-sqlite` 또는 더 빠른 `op-sqlite`, 단 op-sqlite는 Expo Go 미지원). 실사용 예시 `zslack`(Slack 클론)이 2026-07 업데이트됨. VERIFIED — [Zero React Native docs](https://zero.rocicorp.dev/docs/react-native), 2026-09-20 조회. `rocicorp/mono` 저장소 ★3,390, 2026-09-19 push. VERIFIED — `gh api repos/rocicorp/mono`.
- **ElectricSQL**은 Postgres shape 구독 스트리밍(“electric-next” 리빌드, 구버전 개발 중단), 기본 LWW 충돌 해결. **PowerSync**는 Postgres WAL 읽기 + YAML 동기화 규칙, "가장 성숙·모바일 프로덕션 검증됨"으로 평가됨. VERIFIED — [PowerSync vs ElectricSQL blog](https://powersync.com/blog/electricsql-electric-next-vs-powersync), 2026-09-20 조회.
- **Triplit**은 2025-08에 Supabase가 acqui-hire, 이후 community-maintained로 전환되어 장기 신뢰도 우려가 제기됨. VERIFIED — [johnny.sh sync engine 2026](https://johnny.sh/blog/choosing-a-sync-engine-in-2026/), 2026-09-20 조회.
- **CRDT 라이브러리**: Yjs가 여전히 프로덕션 기본값(주간 다운로드 ~92만, ★17K). Automerge 3.0(2025-07)은 컬럼형 압축으로 메모리 10배 절감했지만 여전히 Yjs보다 상위 10% 워크로드에서 느림. Loro는 벤치마크 최속이지만 생태계 어림(~1.2만 다운로드). VERIFIED — [PkgPulse CRDT 2026 guide](https://www.pkgpulse.com/guides/yjs-vs-automerge-vs-loro-crdt-libraries-2026), 2026-09-20 조회.
- **Apple Developer Program**은 개인 $99/년, TestFlight 내부 테스터 100명·외부 테스터 승인 후 최대 10,000명. APNs 자체는 무료지만 사용하려면 이 프로그램 가입 필수. VERIFIED — [Apple Developer fee explainer](https://appbuilder24.com/blog/apple-developer-account-needed), 2026-09-20 조회.
- **ntfy**(self-hosted)는 무제한 무료, 프로토콜이 순수 HTTP curl로 전송 가능, 2026 기준 홈랩 기본값으로 추천되나 iOS 앱이 상대적으로 신생. **Pushover**는 유료($4.99/플랫폼, 1회성)이지만 성숙한 iOS 앱과 배달 추적 기능 보유. VERIFIED — [Big Iron ntfy vs Pushover comparison](https://www.bigiron.cc/guides/gotify-vs-ntfy-vs-apprise-vs-pushover), 2026-09-20 조회.
- **Tauri 모바일 push 플러그인**은 iOS APNs/Android FCM을 지원하는 커뮤니티 플러그인(`tauri-plugin-mobile-push`, `tauri-plugin-notifications`)이 있고, 최신 버전은 method swizzling 대신 명시적 AppDelegate 위임으로 iOS 26+ 호환성 문제를 회피함. VERIFIED — [tauri-plugin-mobile-push repo](https://github.com/yanqianglu/tauri-plugin-mobile-push), 2026-09-20 조회.

## 3. Options / Comparison

### 클라이언트 프레임워크

| 옵션 | macOS 성숙도 | iOS 성숙도 | 언어/재사용성 | Apple-native 느낌 낼 수 있는가 | 리스크 |
|---|---|---|---|---|---|
| **Tauri 2** | 높음(2.11.x, 안정) | 중간(공식 지원하나 "1급 시민 아님"으로 팀 스스로 경고) | Rust+웹(TS 재사용 가능) | 가능(WKWebView 기반, CSS/SwiftUI 흉내) | iOS 빌드 파이프라인 복잡, App Store 심사 사례 적음 |
| **Expo/RN + react-native-macos** | 중간(MS 유지보수, 활발) | 높음(RN 코어) | TS 100% 공유 | 노력 필요(네이티브 컴포넌트 브리지) | macOS 포크가 core RN과 별도 릴리스 주기 — 버전 드리프트 |
| **SwiftUI multiplatform** | 최고 | 최고 | Swift 별도 작성(TS 비공유) | 최고(네이티브 그 자체) | 개발 인력 全부 Swift, DeepSeek/Opus로 오케스트레이션할 코드베이스가 이원화 |
| **Flutter** | 중간 | 높음 | Dart(TS 비공유) | 낮음(커스텀 렌더러라 iOS 룩 재현 노력 큼) | 팀이 이미 TS 스택 선호, Dart는 생태계 이탈 |
| **PWA (installed)** | N/A(브라우저) | iOS 26 기준 기본 web-app 모드 | TS 100% 공유, 서버와 동일 코드 가능 | 낮음(브라우저 chrome 흔적) | Web Push만 가능(APNs 불가), 백그라운드 제한, "느린 개선 속도" |

### Sync 엔진 (허브 = Postgres, 클라이언트 = MacBook/iPhone, 종종 오프라인)

| 엔진 | 아키텍처 | 모바일(RN) 지원 | 충돌 해결 | 성숙도 | 비고 |
|---|---|---|---|---|---|
| **Zero (Rocicorp)** | 서버-authoritative, Postgres | 공식 지원(Expo/RN, op-sqlite) | 서버가 mutation accept/reject | 3세대 제품, ★3,390 | 웹 DX 최고 평가, RN 예제 실존 |
| **PowerSync** | Postgres WAL 읽기 + YAML sync rules | 모바일 특화 설계 | LWW + 커스텀 핸들러 | "가장 프로덕션 검증됨" 평가 | 모바일 우선 설계라 omnis 성격에 부합 |
| **ElectricSQL** | Postgres shape 구독 | 가능하나 "electric-next"로 리빌드 중 | 기본 LWW | 빠르게 진화 중, 구버전 단종 | 안정성보다 최신성 선호 시 |
| **Triplit** | Datalog DB + live query | 지원 | 자체 | Supabase acqui-hire 후 community-maintained | 장기 리스크로 비권장 |
| **자체 WS/SSE + SQLite 캐시** | hub-authoritative | 직접 구현 필요 | 직접 구현 | 자유도 최대, 개발비 최대 | omnis 초기엔 과설계 가능성 |

### Push 채널

| 채널 | 비용 | iPhone 백그라운드 신뢰성 | 개발비 |
|---|---|---|---|
| APNs(네이티브) | $99/년(Apple Developer) | 최고 | 중(엔타이틀먼트, 인증서) |
| Web Push(installed PWA) | 무료 | 중~낮음(iOS 백그라운드 제약) | 낮음 |
| ntfy(자체호스팅, HTTP) | 무료(허브에서 직접 호스팅 가능) | 낮음(polling/foreground 앱 필요, 진짜 push 아님) | 최저 |
| Pushover | $4.99 1회 | 중(자체 서버 신뢰) | 최저 |

## 4. Recommendation for omnis

**MVP (S, 1–2주 체감)**: Tauri 2로 macOS 앱 하나 먼저 완성(메뉴바 상주, 실시간 인박스 뷰). iPhone은 **installed PWA**로 동일 프론트엔드 재사용 — 별도 코드베이스를 만들지 않는 게 이 단계에서 가장 라지. Push는 우선 Web Push(제한적이어도 "알림 없음"보다 나음) + ntfy를 허브(맥미니)에서 직접 서빙해 중요 알림은 이중화. 허브 접근은 **TailscaleKit을 macOS Tauri 앱에는 넣지 말고**(Tauri는 WKWebView라 네이티브 tsnet 임베드가 아직 검증 사례 적음), 대신 맥미니에서 `tailscale serve`로 HTTPS 뜨우고 MacBook은 시스템 Tailscale 클라이언트(이미 깔려 있음, 브리프에 명시)로 접근 — Serve는 이미 동작 확인된 경로. iPhone PWA가 Tailscale Serve `*.ts.net`에 접속 못 하는 경우(#19147 버그) 대비책으로 **tailscale serve 대신 Funnel(공개지만 access-control로 제한) 혹은 MagicDNS 이름 직접 확인**을 리스크로 남겨둠 — 이 버그가 이 프로젝트의 가장 큰 미검증 리스크임.

**v2 (M, 3–6주)**: iOS 전용 네이티브 셸로 전환 — Tauri 2의 iOS 타겟(같은 코드베이스, Rust 플러그인만 추가) 또는 최소 침습으로 Capacitor 검토. 이 시점에 Apple Developer Program $99/년 가입해서 진짜 APNs 붙이고, **TailscaleKit**으로 iOS 앱이 시스템 VPN 없이 tailnet에 직접 dial — Serve의 SSL 버그를 완전히 우회하는 경로(허브에 직접 연결, 인증서 문제 자체가 발생 안 함). Sync는 자체 WS 폴링에서 **Zero(Rocicorp)**로 갈아탐(Postgres 백엔드 + RN 공식 지원 + 서버-authoritative라 omnis의 "허브가 진실의 원천" 모델과 정확히 맞음). CRDT는 아직 필요 없음(단일 유저 2–3 디바이스라 진짜 동시편집 충돌이 드묾) — Yjs/Automerge는 나중에 노트/드래프트 공동편집 기능이 생기면 그때.

**나중(맥미니 없는 순수 로컬) 전환 비용**: Zero+TailscaleKit 조합을 골랐을 때 가장 싸다 — 허브가 "맥미니의 Postgres"에서 "MacBook 앱 내장 Postgres/SQLite"로 바뀌어도 Zero의 client-server 프로토콜과 TailscaleKit의 tsnet 노드 개념은 그대로 유지되고, iPhone은 여전히 같은 tailnet으로 "허브"(이번엔 MacBook)에 접속. PWA/Tauri 이원화를 계속 끌고 가면 이 전환에서 두 코드베이스를 다 건드려야 함 — 그러니 **v2에서 PWA를 버리고 Tauri 2 단일 코드베이스(macOS+iOS)로 합치는 것 자체가 이 마이그레이션의 선행 조건**.

**리스크**: (1) Tauri iOS는 팀이 "1급 시민 아님"이라 명시 — App Store 심사 통과 사례를 직접 검증 전엔 스케줄에 버퍼 필요. (2) Tailscale Serve iOS SSL 버그는 미해결 오픈 이슈라 재현되면 MVP의 허브 접근 자체가 막힘 — TailscaleKit 검증을 앞당길 이유. (3) KakaoTalk/LinkedIn은 API가 없어 맥미니에서 화면/세션 캡처하는 방식일 텐데, 이는 ToS 위반 소지 있음(계정 정지 리스크) — 이 조사 범위 밖이지만 클라이언트 아키텍처와 무관하게 별도 확인 필요.

## 5. What to borrow

- **Zero의 `zslack` 예제**(Expo+RN+Zero로 만든 Slack 클론) — omnis 인박스 리스트/스레드 뷰의 참조 구현으로 그대로 패턴 복붙 가능. 저장소는 Zero 문서의 community 섹션에 링크됨 ([zero.rocicorp.dev/docs/community](https://zero.rocicorp.dev/docs/community)).
- **TailnetKit**(비공식이지만 코드가 읽기 쉬움, `willmortimer/TailnetKit`)의 Swift concurrency 래퍼 설계 — 공식 TailscaleKit이 아직 문서가 얇다면 API 설계 참고용으로.
- **tunnelless**(`indiagrams/tunnelless`) — "VPN 프로필 없이 iOS/macOS 앱에 tsnet 노드 내장"의 최소 재현 구현체, PoC 단계에서 그대로 clone해서 붙여볼 수 있음.
- **Tauri의 `tauri-plugin-mobile-push`** — APNs/FCM을 스위즐링 없이 붙이는 패턴(명시적 AppDelegate 위임)은 v2에서 그대로 채택해 iOS 26 호환성 이슈를 처음부터 회피.
- **PowerSync의 모바일 우선 설계 문서** — Zero 대신 PowerSync를 고를 경우를 대비해, "모바일에서 오프라인 큐를 어떻게 검증했는가"의 사고 과정(YAML sync rules)은 omnis의 work/personal 필터 규칙을 서버 사이드로 내리는 데 응용 가능.

## 6. Open questions

- Tailscale Serve iOS SSL 버그(#19147)가 이 프로젝트의 특정 iOS 버전/Tailscale 앱 버전에서도 재현되는지 실기기로 먼저 검증 필요 — MVP 착수 전 최우선 스파이크.
- Tauri 2 iOS 앱이 실제 App Store 심사를 통과한 사례(특히 WKWebView + 커스텀 프레임워크 조합)가 검색으로 충분히 검증 안 됨 — TestFlight로 직접 제출해서 확인 필요.
- TailscaleKit의 프로덕션 사용 사례(별도 회사/앱이 실제로 배포했는지)가 부족 — 2026-08-31 최신 push라 활발하긴 하나 "battle-tested"라 부르긴 이름.
- Zero vs PowerSync 최종 선택은 omnis의 실제 쓰기 패턴(누가 얼마나 자주 draft를 편집하는지)에 달림 — 이건 리서치가 아니라 실측 필요.
- KakaoTalk/LinkedIn 캡처 방식의 ToS 리스크는 이 리서치 범위 밖이나 클라이언트 아키텍처 결정(허브=맥미니 유지 기간)에 직접 영향 — 별도 법무/ToS 조사 트랙 필요.

## 7. Sources

- [Tauri 2.0 Release Candidate blog](https://v2.tauri.app/blog/tauri-2-0-0-release-candidate/) — 2026-09-20
- [tauri-v3.0.0-alpha.1 release](https://github.com/tauri-apps/tauri/releases/tag/tauri-v3.0.0-alpha.1) — 2026-09-20
- [microsoft/react-native-macos](https://github.com/microsoft/react-native-macos/) — 2026-09-20
- [MobiLoud — PWA iOS 2026 guide](https://www.mobiloud.com/blog/progressive-web-apps-ios/) — 2026-09-20
- [Tailscale Serve docs](https://tailscale.com/docs/features/tailscale-serve) — 2026-09-20
- [Tailscale Funnel docs](https://tailscale.com/docs/features/tailscale-funnel) — 2026-09-20
- [GitHub issue #19147 — iPhone Tailscale Serve HTTPS SSL error](https://github.com/tailscale/tailscale/issues/19147) — 2026-09-20
- [Tailscale tsnet docs](https://tailscale.com/docs/features/tsnet) — 2026-09-20
- [libtailscale swift README (TailscaleKit)](https://github.com/tailscale/libtailscale/blob/main/swift/README.md) — 2026-09-20
- [TailnetKit (community)](https://github.com/willmortimer/TailnetKit) — 2026-09-20
- [tunnelless reference implementation](https://github.com/indiagrams/tunnelless) — 2026-09-20
- [PowerSync — ElectricSQL electric-next vs PowerSync](https://powersync.com/blog/electricsql-electric-next-vs-powersync) — 2026-09-20
- [johnny.sh — Choosing a Sync Engine for Local-First in 2026](https://johnny.sh/blog/choosing-a-sync-engine-in-2026/) — 2026-09-20
- [Zero — React Native docs](https://zero.rocicorp.dev/docs/react-native) — 2026-09-20
- [Zero — Community examples](https://zero.rocicorp.dev/docs/community) — 2026-09-20
- [PkgPulse — Yjs vs Automerge vs Loro 2026](https://www.pkgpulse.com/guides/yjs-vs-automerge-vs-loro-crdt-libraries-2026) — 2026-09-20
- [Apple Developer Program fee explainer](https://appbuilder24.com/blog/apple-developer-account-needed) — 2026-09-20
- [Big Iron — ntfy vs Pushover vs Gotify vs Apprise](https://www.bigiron.cc/guides/gotify-vs-ntfy-vs-apprise-vs-pushover) — 2026-09-20
- [tauri-plugin-mobile-push](https://github.com/yanqianglu/tauri-plugin-mobile-push) — 2026-09-20
- [Kinso — official site](https://www.kinso.ai/) — 2026-09-20
- `gh repo view` / `gh api` calls against tauri-apps/tauri, microsoft/react-native-macos, tailscale/libtailscale, rocicorp/mono — 2026-09-20

## Verification (adversarial)

Re-checked 2026-09-20 against primary sources (gh api/repo view, official docs, vendor READMEs) where available. Verdict defaults to "unverifiable" when no primary source backs the specific wording, even if directionally plausible.

| # | Claim | Verdict | Evidence URL | Correction |
|---|---|---|---|---|
| 1 | Tauri 2 stable since 2024-10-02, still actively pushed 2026-09-19; team says mobile not yet "first-class" vs desktop | **Confirmed** | [Tauri 2.0 RC blog](https://v2.tauri.app/blog/tauri-2-0-0-release-candidate/) — exact quote: "we don't want to raise expectations that Tauri 2.0 will be the 'mobile as a first class citizen' release"; `gh api repos/tauri-apps/tauri` → pushed_at 2026-09-19T20:43Z, ★111,195 | None — file's wording matches the primary source closely. |
| 2 | Tailscale `*.ts.net` HTTPS fails on iPhone in an open, unresolved issue (#19147) with **no comments/no maintainer response** | **Refuted (partial)** | `gh api repos/tailscale/tailscale/issues/19147` and its `/comments` — state: open, but **5 comments** exist (not zero); a 2026-08-07 comment by a third party (not a confirmed Tailscale employee — not a public org member) diagnoses the root cause as a **third-party DNS-over-HTTPS app (DNSecure) conflicting with DNS resolution**, not a TLS/certificate bug in Tailscale Serve itself, and reports a working fix (uninstall the DoH app) | File's "댓글/담당자 없음" (no comments, no maintainer) is factually wrong — the issue has an active comment thread with a plausible root-cause diagnosis and reported workaround. This lowers the severity of the risk the recommendation treats as "biggest unverified risk": it may not be an inherent Tailscale/iOS bug at all on a clean device. |
| 3 | Official **TailscaleKit** Swift package (`tailscale/libtailscale`) embeds tsnet with no system VPN profile/NetworkExtension entitlement; simulator-free framework variant for App Store submission | **Confirmed** (App Store part verbatim; VPN-free part inferred, not stated) | [libtailscale swift README](https://github.com/tailscale/libtailscale/blob/main/swift/README.md), fetched via `gh api repos/tailscale/libtailscale/contents/swift/README.md` — exact quote: "The ios and ios-sim frameworks are purposefully separated. The former is free of any simulator segments and is suitable for app-store submissions." Repo pushed 2026-08-31 | The README never explicitly says "no VPN profile / no NetworkExtension entitlement" — that's a reasonable inference from tsnet's userspace design (confirmed separately via [tsnet docs](https://tailscale.com/docs/features/tsnet)), not a stated fact in this doc. Mark that sub-claim "plausible, not directly sourced." |
| 4 | Zero (Rocicorp) officially supports React Native/Expo, same API as web, needs `kvStore`, op-sqlite faster than expo-sqlite but incompatible with Expo Go; real `zslack` example updated 2026-07 | **Confirmed, with a date correction** | [Zero React Native docs](https://zero.rocicorp.dev/docs/react-native) — quotes match almost verbatim ("Usage is identical to React on the web" except kvStore; "op-sqlite is much faster than expo-sqlite but does not work with Expo Go"). `gh search repos zslack` → `rocicorp/zslack`, "Slack-like app built with Zero/Expo/React Native" | zslack's last push is **2026-09-04**, not "2026-07" as the file states — repo is more recently active than claimed, not less; a minor date error, not a materiality problem. Also note: `zslack` does not appear on the current `zero.rocicorp.dev/docs/community` page contents fetched — it's linked from elsewhere in the docs, so "community example" framing is fine but the specific docs page cited didn't list it in the fetched excerpt. |
| 5 | PowerSync "가장 성숙·모바일 프로덕션 검증됨" (most mobile-production-proven, WAL-based, YAML sync rules) vs ElectricSQL mid-rebuild ("electric-next") vs Triplit community-maintained after Aug-2025 Supabase acqui-hire | **Refuted (partial) on the superlative; rest confirmed** | Fetched both cited sources in full: [PowerSync vs ElectricSQL blog](https://powersync.com/blog/electricsql-electric-next-vs-powersync) and [johnny.sh](https://johnny.sh/blog/choosing-a-sync-engine-in-2026/) — **neither contains any claim that PowerSync is "the most mature" or "most mobile-production-proven"**, and neither mentions WAL reading or YAML sync rules at all. YAML sync rules is real but sourced elsewhere: [PowerSync's own docs](https://docs.powersync.com/usage/sync-rules) — "Sync Rules are defined in a YAML file." Triplit claim confirmed verbatim on johnny.sh: "The Triplit team was 'acqui-hired' by Supabase in August 2025, and Triplit became community-maintained." | The "most mobile-production-proven" characterization is an **unsourced editorial claim** not backed by either cited URL — it should be downgraded from stated fact to "PowerSync's own marketing position, not independently verified," and the citation for WAL/YAML should point to `docs.powersync.com/usage/sync-rules`, not the blog post. |
| 6 | iOS 26 PWAs open as web apps by default (UX change); Web Push since iOS 16.4, requires Add-to-Home-Screen; Apple's pace is slow, most impactful gaps unaddressed | **Confirmed** | [MobiLoud PWA iOS 2026 guide](https://www.mobiloud.com/blog/progressive-web-apps-ios/) (fetched via proxy after direct fetch was blocked with HTTP 403/Cloudflare) — exact quotes: "with iOS 26, every site added to the Home Screen now defaults to opening as a web app"; "Since iOS 16.4 (March 2023), PWAs added to the Home Screen can send push notifications... Push only works when the PWA has been added to the Home Screen"; "No Background Sync... None of these have a timeline for implementation" | None material. Note the article's original publish timestamp is 2024-03-14 and it's a continuously-updated evergreen post (references iOS 26, Oct-2025 UK CMA action) — treat as a live secondary source, still not Apple's own release notes as the file itself already flags (medium confidence). |
| 7 | Apple Developer Program $99/year individual; TestFlight 100 internal / up to 10,000 external testers | **Confirmed, with a better citation** | Apple's own pages: [developer.apple.com/programs/enroll](https://developer.apple.com/programs/enroll/) — "99 USD per membership year"; [developer.apple.com/testflight](https://developer.apple.com/testflight/) — "up to 100... beta testers" / "up to 10,000 external testers" | The file cites a third-party blog (appbuilder24.com) for a fact that has a clean primary source. Swap the citation to Apple's own enroll/TestFlight pages. |
| 8 | Only `microsoft/react-native-macos` is actively maintained for RN-macOS (ptmt fork deprecated); pushed as recently as 2026-09-14 | **Confirmed** | `gh api repos/microsoft/react-native-macos` → `pushed_at: 2026-09-14T21:58:13Z`, `isArchived: false`, ★4,385 | None. |
| 9 (extra) | Tauri 3.0 alpha.0/alpha.1 both released 2026-09-15 | **Refuted (minor)** | `gh api repos/tauri-apps/tauri/releases` — `tauri-v3.0.0-alpha.0` published **2026-09-13T01:52Z**, `tauri-v3.0.0-alpha.1` published **2026-09-15T10:58Z** | alpha.0 shipped two days before alpha.1, not "on the same day." Doesn't affect the recommendation (still pre-production Linux-focused alpha). |
| 10 (extra) | CRDT: Yjs production default (~92만 주간 다운로드, ★17K); Automerge 3.0 (2025-07) ~10x memory cut via columnar compression, still slower than Yjs on hardest workloads; Loro fastest benchmarks, smallest/youngest ecosystem (~1.2만 다운로드) | **Refuted (partial) on the numbers; direction and Automerge claim confirmed** | npm registry API (`api.npmjs.org/downloads/point/last-week`, 2026-09-12→18): **yjs 6,209,468/week** (not ~920K), **loro-crdt 127,554/week** (not ~12K), **@automerge/automerge 51,035/week**. `gh api repos/yjs/yjs` → ★22,813 (not ★17K). `gh api repos/loro-dev/loro` → ★6,148 vs `gh api repos/automerge/automerge` → ★6,614. Automerge memory claim confirmed verbatim at [automerge.org/blog/automerge-3](https://automerge.org/blog/automerge-3/): "we've cut that down memory usage by over 10x... pasting Moby Dick into an Automerge 2 document consumes 700Mb of memory, in Automerge 3 it only consumes 1.3Mb," dated **July 2025** (matches file) | Yjs's actual weekly npm downloads (6.2M) and stars (22.8K) are both materially higher than the PkgPulse figures the file cites (~920K / ★17K) — Yjs's dominance is understated, not overstated, so the file's conclusion still holds, but the specific numbers are stale/wrong and should be corrected or dropped. More importantly, **Loro currently has ~2.5x Automerge's weekly npm downloads** (127K vs 51K) despite fewer GitHub stars — "Loro has the smallest, youngest ecosystem" is true only relative to Yjs, not clearly true relative to Automerge specifically; soften that comparison. |

### Corrected recommendation

The two numeric/count-based claims that move the needle are #2 and #5. Neither overturns the MVP/v2 staging in Section 4, but both change how urgently and how the two flagged risks should be treated:

- **Tailscale Serve iOS bug (#19147) is not "unresolved with silence from the community/maintainers"** — it has an active thread and a plausible non-Tailscale root cause (a third-party DNS-over-HTTPS app breaking `.ts.net` name resolution before TLS ever starts). Before treating "Funnel or MagicDNS fallback" as a required MVP risk mitigation (Section 4/6), the actual next step should be: check whether Logan's iPhone runs any DoH/private-DNS app or profile, and reproduce (or fail to reproduce) the SSL error on a clean network configuration first. If it doesn't reproduce, the "biggest unverified risk" in Section 6 is smaller than stated and the MVP path (system Tailscale client + `tailscale serve`) is lower-risk than the doc currently implies.
- **PowerSync's "most mobile-production-proven" status is PowerSync's own positioning, not an independently verified fact** — it appears in neither cited source. This doesn't invalidate PowerSync as a v2 candidate (its Postgres-WAL + YAML-sync-rules architecture is confirmed from PowerSync's own docs), but the comparison table in Section 3 should attribute "가장 프로덕션 검증됨" to PowerSync's marketing rather than presenting it as settled fact, and the Zero-vs-PowerSync decision in Section 6 should stay open (as the doc already says) rather than leaning on that unverified superlative.
