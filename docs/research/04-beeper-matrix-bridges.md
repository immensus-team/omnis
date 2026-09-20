# 04 — Beeper Desktop API/MCP vs 셀프호스트 Matrix 브릿지

Fetched 2026-09-20. 리서치 대상: Beeper Desktop API/MCP, mautrix 브릿지군, 경량 홈서버(Synapse/Tuwunel), omnis용 채팅 수집 계층 선택.

## 1. TL;DR

Beeper Desktop API는 이미 "우리가 만들려던 것"을 로컬 REST+MCP로 제공한다: WhatsApp·Telegram·Signal·Discord·Slack·LinkedIn·Instagram·iMessage(macOS) 등 12개+ 네트워크를 무료로, 토큰 인증 + 실험적 WebSocket 실시간 채널로. Remote Access를 켜면 `0.0.0.0` 바인딩 + Tailscale 조합으로 맥미니(허브)→맥북/아이폰(클라이언트) 토폴로지에 그대로 꽂힌다 — omnis가 이미 계획한 구조와 정확히 일치. 결정적 갭은 **KakaoTalk 미지원**(공식·커뮤니티 모두 사실상 죽음, 계정정지 리포트 있음)과 프리미엄 기능(예약전송 등) 뒤에 있는 유료 플랜. mautrix 셀프호스트(AGPL-3.0, bridgev2 활발)는 완전한 소유권을 주지만 맥미니 16GB에서 브릿지+홈서버를 직접 굴리는 유지보수 비용이 크고, LinkedIn 브릿지는 이미 archived. 결론: MVP는 Beeper Desktop API/MCP를 1차 채널로 쓰고, KakaoTalk만 별도(자체 automation 또는 최후수단으로 커뮤니티 브릿지)로 처리하라.

## 2. Facts

**Beeper Desktop API/MCP**
- 완전 로컬 REST API + 내장 MCP 서버. "runs entirely on your device." 지원: WhatsApp, Instagram, Telegram, Google Messages, Google Voice, Google Chat, Messenger, Signal, LinkedIn, X, Discord, Slack, iMessage(macOS 한정). — https://developers.beeper.com/desktop-api/ (2026-09-20 fetch) — VERIFIED
- KakaoTalk은 목록에 없음; Beeper 공식 오픈소스 페이지도 KakaoTalk을 "community-maintained" 카테고리에 넣음(공식 지원 아님). — https://developers.beeper.com/open-source/ (2026-09-20) — VERIFIED
- 인증: Settings→Integrations에서 발급하는 Bearer 토큰, 또는 OAuth 2.0 + PKCE (RFC 8414 discovery `/.well-known/oauth-authorization-server`). MCP 엔드포인트(`/v0/mcp`, `/v0/sse`)도 동일 토큰 사용. — https://developers.beeper.com/desktop-api/auth (2026-09-20) — VERIFIED
- 기본은 localhost(`http://localhost:23373`)만 바인딩. Settings→Integrations→Advanced에서 "Remote Access"를 켜면 `0.0.0.0` 바인딩 + `X-Forwarded-*` 헤더로 base URL 계산 + OAuth discovery CORS 완화. Beeper는 자체 터널을 제공하지 않고 Cloudflare Quick Tunnel / **Tailscale** / 일반 리버스 프록시를 권장. — https://developers.beeper.com/desktop-api/advanced/remote-access (2026-09-20) — VERIFIED. omnis는 이미 맥미니를 Tailscale로만 노출하는 구조이므로(메모리: vigor relay 참고) 그대로 재사용 가능.
- API 리소스: Accounts, Bridges, Chats, Messages, Assets, Client(포커스/검색), Info, App. 실시간은 실험적 WebSocket 엔드포인트가 REST와 별도로 존재("WebSocket (Experimental)"), CLI의 HMAC 서명 아웃바운드 webhook + WebSocket watch와는 별개 기능. — https://developers.beeper.com/desktop-api-reference/ (2026-09-20) — VERIFIED (WebSocket 세부 스펙은 별도 페이지, 미확인 → UNVERIFIED: 페이로드 형식)
- MCP transport: Streamable HTTP(`http://localhost:23373/v0/mcp`, 1차), stdio(Node `@beeper/mcp-remote` 경유). SSE는 최근 버전에서 제거됨("no longer supports Server-Side Events"). — https://developers.beeper.com/desktop-api/mcp/, https://glama.ai/mcp/servers/mimen/beeper-mcp (2026-09-20) — VERIFIED
- 가격: Beeper 앱 자체는 5개 계정까지 무료; Desktop API/MCP는 문서상 플랜 제한 언급 없이 Settings→Developers에서 활성화(무료 기능으로 보임). Beeper Plus $9.99/월(10개 서비스, 예약전송 등), Beeper Plus Plus $30~49.99/월(무제한 계정, 팀용). 어느 쪽이 Desktop API 자체를 게이트하는지는 문서에 명시 안 됨 → UNVERIFIED. — https://www.beeper.com/faq, TechCrunch 2025-07-16 기사 (2026-09-20 fetch) — 가격 자체는 VERIFIED, "API가 유료 게이트인가"는 UNVERIFIED
- ToS/자동화: 공식 문서는 "personal use only" 권고 + "메시지를 너무 많이 보내면 네트워크 측에서 계정 정지될 수 있음"이라고 명시 경고. 별도 Terms 페이지의 법적 문구는 미확인. — https://developers.beeper.com/desktop-api/ (2026-09-20) — VERIFIED(경고 문구), 전체 ToS 텍스트는 UNVERIFIED

**셀프호스트: `bbctl` (Beeper Bridge Manager)**
- "a tool for running self-hosted bridges with your Beeper account." Linux/macOS(x86_64, arm64; Windows는 WSL), Python3+venv, ffmpeg 필요. 16개+ 공식 브릿지(Telegram, WhatsApp, Signal, Discord, Slack, Google Messages, Meta, Bluesky, iMessage, LinkedIn 등) + bridgev2 기반 서드파티/커스텀 브릿지 프록시 지원. 셀프호스트 계정은 무료이고 계정 한도에 포함 안 됨. 지원은 커뮤니티 채널 한정. 데이터는 `~/.local/share/bbctl`. — https://developers.beeper.com/bridges/self-hosting/ (2026-09-20) — VERIFIED

**mautrix 브릿지 라이선스/활동 (GitHub API 직접 조회, 2026-09-20)**
- `mautrix/whatsapp`(whatsmeow 기반): AGPL-3.0, 활성(마지막 push 2026-09-17). — VERIFIED
- `mautrix/telegram`: AGPL-3.0, 활성(2026-09-19), bridgev2로 재작성됨(v26.04+). — VERIFIED
- `mautrix/slack`: AGPL-3.0, 활성(2026-09-18). — VERIFIED
- `mautrix/gmessages`(Google Messages): AGPL-3.0, 활성(2026-09-16). — VERIFIED
- `mautrix/imessage`: AGPL-3.0, 마지막 push 2026-05-14 (다른 브릿지 대비 느림). — VERIFIED
- `mautrix/signal`: AGPL-3.0, 활성(2026-09-18). Go 버전은 libsignal-ffi(Rust)가 필요 — 직접 컴파일하려면 Rust/Cargo/libclang-dev/protoc 필요하지만 mau.dev CI에서 prebuilt `libsignal_ffi.a` 다운로드로 우회 가능. — https://docs.mau.fi/bridges/go/signal/index.html (2026-09-20) — VERIFIED
- `mautrix/go`(공유 프레임워크, bridgev2 코어): MPL-2.0. — VERIFIED
- `mautrix/meta`(FB/Instagram): AGPL-3.0, 활성(2026-09-19). — VERIFIED
- `beeper/linkedin`(linkedin-matrix, mautrix-python 기반): **Apache-2.0이지만 저장소가 archived, 마지막 코드 push 2025-03-17** — 1년 반 이상 방치, 실질적으로 죽은 프로젝트. — VERIFIED (`gh api repos/beeper/linkedin` → `archived: true`)
- `beeper/imessage`, `beeper/mac-registration-provider`도 archived — iMessage 셀프호스트 경로는 최근 `beeper/platform-imessage`(활성, 2026-09-16 push)와 `beeper/registration-relay`로 통합/이전된 것으로 보임 → UNVERIFIED(정확한 마이그레이션 경위는 리포 히스토리 미확인)
- `beeper/line`(LINE, bridgev2): 활성(2026-09-18 push) — 한국/동아시아향 신규 브릿지가 계속 나오는 중이라는 신호. — VERIFIED
- KakaoTalk: 공식 mautrix/beeper 브릿지 없음. 존재하는 것은 커뮤니티 프로젝트 `matrix-appservice-kakaotalk`(node-kakao 기반, node-kakao 자체가 unmaintained, mautrix-facebook 코드 일부 재사용) — 2022-09 시점 "계정 정지 리포트 있음" 언급이 남아있는 상태. 유지보수 신호 약함, 리스크 높음. — https://matrix.org/ecosystem/bridges/kakaotalk/, src.miscworks.net 미러 (2026-09-20 검색 기준) — VERIFIED(존재/미유지 신호), 정지 리포트 최신성은 UNVERIFIED(원출처 2022년 언급 재인용)

**홈서버(자체 운영 시)**
- Tuwunel(구 conduwuit 공식 후계, Rust, Apache-2.0)이 활발히 개발 중, 2026-09-19 push, 스위스 정부가 스폰서/실사용 중이라 주장. MSC4186(Simplified Sliding Sync)을 지원(Element X 대상으로 여러 차례 수정됨, 2026-07 SCT에서 MSC4186 공식 채택). — https://github.com/matrix-construct/tuwunel, matrix.org 블로그 2026-07-10 (2026-09-20) — VERIFIED
- Synapse(레퍼런스 구현, Python, 무거움)는 개인/소규모 배포 기준 RAM 1~2GB 권장(문서 산재, 정확한 공식 수치는 배포 가이드마다 다름) → 대략치, UNVERIFIED 정밀 수치
- Sliding Sync 구 프록시(MSC3575, `matrix-org/sliding-sync`)는 폐기(archived), 각 홈서버가 MSC4186을 네이티브 구현하는 방향으로 전환 완료. Synapse도 기본 활성화. — matrix.org 블로그 2024-11-14, 2026-07-10 (2026-09-20) — VERIFIED
- Sygnal은 모바일 푸시(APNs/FCM) 전용 게이트웨이 — 클라이언트 개발자가 자체 푸시를 만들 때만 필요, 일반 사용자는 불필요. — https://github.com/matrix-org/sygnal (2026-09-20) — VERIFIED

## 3. Options / Comparison

| 축 | Beeper Desktop API/MCP | bbctl 셀프호스트 (Beeper 인프라 활용) | 완전 자체 mautrix + Tuwunel 홈서버 | 직접 어댑터 (네트워크별 unofficial API 직접 호출) |
|---|---|---|---|---|
| 구축 노력 | S (앱 설치 + 토큰) | M (Python venv, bbctl 설정, 계정당 로그인) | L (홈서버 + 브릿지 N개 각각 설정/운영) | L~XL (네트워크마다 리버스엔지니어링, 계정정지 리스크 최고) |
| 실시간성 | REST + 실험적 WebSocket, MCP는 폴/이벤트 혼합 | Matrix 표준 sync(브릿지가 Beeper의 홈서버로 push) | Matrix client-server sync(sliding sync 네이티브 지원 시 빠름) | 구현 나름 |
| 커버리지 | Kakao 제외 12개+ | 16개+ 공식 + bridgev2 서드파티(Kakao는 커뮤니티뿐, 사실상 죽음) | mautrix 생태계 전부(라이선스·유지보수는 브릿지별 편차) | 이론상 전부, 실제론 각 사설 API ToS 위반 상시 리스크 |
| 라이선스 영향 | 서비스 이용(코드 소유 안 함), ToS만 준수하면 됨 | 동일 — Beeper 계정/인프라에 종속 | AGPL-3.0 브릿지 다수 — omnis를 제3자에게 SaaS로 재배포하면 소스 공개 의무 발동(개인 사용은 무관) | 라이선스 이슈 없음, 대신 ToS/보안 리스크 전가 |
| 맥미니 16GB 적합성 | 앱 하나, 가벼움 | 브릿지 개수 비례(5~6개는 표준 VPS 여유롭다는 커뮤니티 보고) — 16GB면 Kakao 제외 전부 돌려도 여유 있을 듯 | 홈서버(Tuwunel 1~2GB) + 브릿지 N개 + Postgres — 관리 부담이 코드가 아니라 "N개 프로세스 24/7 헬스체크"로 이동 | 해당 없음(네트워크별 다름) |
| 유지보수 부담 | Beeper가 흡수(브릿지 업데이트, 계정 재연결 UX 등) | 절반은 Beeper가, 로그인/재인증은 직접 | 전부 직접(브릿지 크래시, 스키마 마이그레이션, 홈서버 업그레이드) | 전부 직접 + 지속적 역공학 |
| KakaoTalk | 미지원 | 커뮤니티 브릿지뿐(위험) | 동일 커뮤니티 브릿지 사용 가능(위험 동일) | KakaoTalk.app 자체를 macOS 자동화(Accessibility/DB read)로 후킹 — 계정정지 리스크는 낮지만 완전 별도 구현 필요 |

## 4. Recommendation for omnis

**1차 채널 계층은 Beeper Desktop API + MCP를 맥미니에 올려서 쓴다.** 이유: (a) omnis가 이미 계획한 "맥미니 = 수집 허브, Tailscale로만 노출" 구조와 Remote Access 옵션이 정확히 맞아떨어짐 — 별도 터널/프록시 설계가 거의 필요 없음. (b) WhatsApp·Telegram·Slack·LinkedIn·Discord·Signal·Instagram·iMessage를 하루 만에 커버. (c) MCP가 내장돼 있어 omnis의 에이전틱 레이어(Vercel AI SDK)가 바로 tool-call로 붙을 수 있음 — "브릿지를 관리하는 코드"를 omnis가 짤 필요가 없음. 효과: **S 효 과 (S effort)**, 리스크는 ToS(개인 사용 명시적으로 권장됨 — 대량 발송/자동 답장은 계정정지 리스크 있음, 특히 WhatsApp/LinkedIn) — **Medium risk, ToS 준수 항목**. 실험적 WebSocket이 아직 불안정할 수 있으니 초기엔 폴링 + WebSocket 병행으로 설계.

**KakaoTalk은 Beeper/mautrix 생태계 밖에서 별도로 푼다.** 커뮤니티 브릿지(node-kakao 기반)는 unmaintained + 계정정지 리포트가 있어 Logan의 실사용 계정으로 리스크를 지기엔 안 맞는다. 대안: 맥미니에 이미 설치된 `KakaoTalk.app`을 macOS Accessibility/AppleScript 또는 로컬 DB(SQLite) 폴링으로 읽어 omnis 인박스로 정규화하는 **자체 어댑터**를 만든다. 효과: **M effort, 낮은 계정정지 리스크(공식 클라이언트 그대로 사용, 자동 발신 없이 읽기 우선)**, 단 macOS 업데이트/카톡 앱 업데이트에 취약(UI 자동화 특유의 깨짐 리스크는 별도로 존재).

**전체 mautrix 셀프호스트(홈서버+브릿지 전부 직접)는 지금 채택하지 않는다.** Beeper가 이미 같은 브릿지 코드를 운영형으로 제공하는데 직접 운영하면 이득 대비 유지보수 비용(브릿지 크래시 대응, Postgres, 홈서버 업그레이드)이 과하다. 다만 **"맥미니 없는 미래 제품"** 단계에서는 재검토 가치가 있다: 그때는 Beeper Desktop 앱 자체가 "다른 회사 앱"이라는 의존성이 되므로, `bbctl`(Beeper 계정을 쓰되 브릿지는 자기 장비에서 돌림)이 중간 지점 — Beeper 인프라(로그인/재연결 UX, 홈서버)는 그대로 활용하면서 프로세스는 로컬로 가져온다. 이건 **M effort**, ToS상 명시적으로 허용된 경로(공식 문서에 self-host 안내가 있음)라 리스크 낮음. 완전 자체 홈서버(Tuwunel) + 전체 브릿지 셀프호스트는 그 다음 단계에서만, "Beeper 회사 자체에 대한 의존을 완전히 제거해야 한다"는 요구가 생길 때만 고려 — **L effort, AGPL 재배포 시에만 법적 리스크, 그 전엔 낮음**.

**직접 어댑터(사설 API 역공학)는 채택하지 않는다.** "브릿지를 새로 만들지 말자"는 이번 리서치의 전제와 정확히 반대이고, 이미 mautrix/Beeper가 수년간 깎아온 프로토콜 리버스엔지니어링을 처음부터 다시 할 이유가 없다.

## 5. What to borrow

- **인증/토큰 모델**: Beeper Desktop API의 "Settings→Integrations→Approved connections에서 스코프별 토큰 발급" UX를 omnis의 "에이전트가 인박스에 접근하는 권한" 모델에 그대로 참고. OAuth discovery(`/.well-known/oauth-authorization-server`, RFC 8414)까지 굳이 자체 구현할 필요는 없고, 클라이언트(MCP 붙는 다른 도구)가 생기면 그때 채택.
- **Remote Access 패턴**: `X-Forwarded-Host/Proto/Port` 기반 base URL 계산 방식은 omnis가 맥미니 위 여러 로컬 서비스(Beeper API, Hermes api_server:8642 등)를 Tailscale 뒤에서 통합 게이트웨이로 묶을 때 그대로 재사용 가능한 패턴 — 참고: https://developers.beeper.com/desktop-api/advanced/remote-access
- **MCP 서버 오픈소스 구현체**: `@beeper/desktop-mcp`(npm), 소스는 Beeper 조직 GitHub(`beeper/cli`가 참고할 CLI 쪽 코드, 커맨드별 REST 매핑 패턴 확인용) — omnis의 자체 MCP 레이어(예: KakaoTalk 어댑터를 MCP tool로 노출)를 만들 때 tool 이름/스키마 네이밍 컨벤션을 그대로 베낄 것.
- **bridgev2 3-layer 구조**(Bridge Framework / Network Connector / Network API Client)는 omnis가 "각 네트워크 어댑터를 어떻게 나눌지" 설계할 때 참고할 만한 분리 방식 — KakaoTalk 자체 어댑터를 짤 때도 "프로토콜 계층 vs Matrix/Inbox 계층"을 이 구조대로 나누면 나중에 다른 네트워크 추가가 쉬움.
- **CLI의 HMAC 서명 아웃바운드 webhook** 패턴(`beeper/cli`, `beeper/desktop-api-cli`) — omnis가 "새 메시지 도착 시 에이전트를 깨운다" 훅을 구현할 때 그대로 가져다 쓸 서명 검증 방식.

## 6. Open questions

- Desktop API 자체가 무료 티어에서 완전히 열려 있는지, 아니면 특정 기능(예: 다중 계정, 검색 API)이 Beeper Plus 뒤에 게이트돼 있는지 — 공식 문서에 명시 안 됨, 실제 무료 계정으로 토큰 발급해서 확인 필요.
- 실험적 WebSocket 엔드포인트의 실제 페이로드/안정성 — "experimental" 딱지가 붙어 있어 프로덕션 의존 전에 별도 스파이크 테스트 필요.
- KakaoTalk.app의 로컬 데이터 저장 위치/스키마(SQLite? 암호화?) — Accessibility 경로 vs DB 직접 읽기 중 어느 쪽이 실제로 가능한지 맥미니에서 직접 검증 필요.
- `beeper/imessage`/`beeper/mac-registration-provider` archived 이후 iMessage 셀프호스트가 정확히 어느 리포(`beeper/platform-imessage` + `beeper/registration-relay`)로 이관됐는지 문서화가 약함 — Beeper Desktop API의 내장 iMessage 지원을 쓰면 이 질문 자체가 무의미해질 가능성 높음(우선순위 낮음).
- Beeper 자체 회사 리스크(서비스 종료, 가격 정책 변경) — "맥미니 없는 미래 제품" 단계에서 Beeper 의존도를 어느 시점에 얼마나 낮출지는 제품 성숙도에 따라 재논의 필요.

## 7. Sources

- [Beeper Desktop API](https://developers.beeper.com/desktop-api/) — fetched 2026-09-20
- [Beeper Desktop MCP](https://developers.beeper.com/desktop-api/mcp/) — fetched 2026-09-20
- [Beeper Desktop API — Auth](https://developers.beeper.com/desktop-api/auth) — fetched 2026-09-20
- [Beeper Desktop API — Remote Access](https://developers.beeper.com/desktop-api/advanced/remote-access) — fetched 2026-09-20
- [Beeper API Reference (resource index)](https://developers.beeper.com/desktop-api-reference/) — fetched 2026-09-20
- [Beeper Open Source bridges list](https://developers.beeper.com/open-source/) — fetched 2026-09-20
- [Beeper Bridge Manager / self-hosting](https://developers.beeper.com/bridges/self-hosting/) — fetched 2026-09-20
- [Desktop API & MCP — beeper.com](https://www.beeper.com/desktop-api) — fetched 2026-09-20
- [Beeper FAQ](https://www.beeper.com/faq) — fetched 2026-09-20
- [Beeper Desktop API MCP Server (npm)](https://www.npmjs.com/package/@beeper/desktop-mcp) — fetched 2026-09-20
- [Beeper MCP Server listing — Glama](https://glama.ai/mcp/servers/mimen/beeper-mcp) — fetched 2026-09-20
- [Beeper's all-in-one messaging app relaunches — TechCrunch, 2025-07-16](https://techcrunch.com/2025/07/16/beepers-all-in-one-messaging-app-relaunches-with-an-on-device-model-and-premium-upgrades/) — fetched 2026-09-20
- [mautrix/whatsapp GitHub](https://github.com/mautrix/whatsapp) — checked via `gh api` 2026-09-20
- [mautrix/telegram GitHub](https://github.com/mautrix/telegram) — checked via `gh api` 2026-09-20
- [mautrix/slack GitHub](https://github.com/mautrix/slack) — checked via `gh api` 2026-09-20
- [mautrix/gmessages GitHub](https://github.com/mautrix/gmessages) — checked via `gh api` 2026-09-20
- [mautrix/imessage GitHub](https://github.com/mautrix/imessage) — checked via `gh api` 2026-09-20
- [mautrix/signal GitHub](https://github.com/mautrix/signal) — checked via `gh api` 2026-09-20
- [mautrix/go GitHub](https://github.com/mautrix/go) — checked via `gh api` 2026-09-20
- [mautrix/meta GitHub](https://github.com/mautrix/meta) — checked via `gh api` 2026-09-20
- [beeper/linkedin GitHub (archived)](https://github.com/beeper/linkedin) — checked via `gh api` 2026-09-20
- [beeper org repo listing](https://github.com/beeper) — checked via `gh search repos` 2026-09-20
- [mautrix-signal bridge setup docs](https://docs.mau.fi/bridges/go/signal/index.html) — fetched via search 2026-09-20
- [matrix-construct/tuwunel GitHub + README](https://github.com/matrix-construct/tuwunel) — checked via `gh api` 2026-09-20
- [Matrix.org — This Week in Matrix 2026-07-10 (MSC4186 status)](https://matrix.org/blog/2026/07/10/this-week-in-matrix-2026-07-10/) — fetched via search 2026-09-20
- [Matrix.org — Sunsetting the Sliding Sync Proxy](https://matrix.org/blog/2024/11/14/moving-to-native-sliding-sync/) — fetched via search 2026-09-20
- [Matrix.org — KakaoTalk bridge ecosystem page](https://matrix.org/ecosystem/bridges/kakaotalk/) — fetched via search 2026-09-20
- [matrix-appservice-kakaotalk mirror — miscworks](https://src.miscworks.net/fair/matrix-appservice-kakaotalk.git) — noted via search 2026-09-20
- [element-hq/sygnal GitHub](https://github.com/element-hq/sygnal) — fetched via search 2026-09-20
- Synapse RAM sizing — aggregated from multiple third-party install guides (no single canonical figure found; treated as approximate) — fetched via search 2026-09-20

## Verification (adversarial)

Fresh primary-source re-check, 2026-09-20. Method: direct `WebFetch` of the cited Beeper docs pages (fetched raw HTML + regex-extracted surrounding text where the summarizer's paraphrase looked incomplete, e.g. the Desktop API network list), `gh api` against the GitHub REST API for every repo claim (license/archived/pushed_at are server-reported fields, not inferred), and `gh api repos/matrix-org/matrix-spec-proposals/pulls/4186` for the MSC merge record. `WebSearch` was exhausted mid-task (session-wide 200/200 budget) after 2 queries, so the KakaoTalk ban-report currency and a couple of secondary pricing points could not be independently re-searched beyond what WebFetch could reach directly.

| # | Claim | Verdict | Evidence URL | Correction |
|---|---|---|---|---|
| 1 | Desktop API covers WhatsApp/Instagram/Telegram/Google Messages·Voice·Chat/Messenger/Signal/LinkedIn/X/Discord/Slack + iMessage(macOS), not KakaoTalk | **CONFIRMED** | https://developers.beeper.com/desktop-api/ (fetched 2026-09-20) | None. Exact page text: "a fully local API for all your chats across WhatsApp, Instagram, Telegram, Google Messages, Google Voice, Google Chat, Messenger, Signal, LinkedIn, X, Discord, Slack, and more" plus a separate line "iMessage is only supported on macOS." (The first-pass WebFetch summary dropped the iMessage sentence because it sits outside the main list — worth noting as a re-fetch trap.) KakaoTalk does not appear on this page; `developers.beeper.com/open-source/` places it under "Community-Maintained Bridges... available only for self-hosting," confirming it is not part of the built-in Desktop API set. |
| 2 | Remote Access binds `0.0.0.0`, resolves base URL from `X-Forwarded-*`, no built-in tunnel, recommends Tailscale/Cloudflare Quick Tunnel/reverse proxy | **CONFIRMED** | https://developers.beeper.com/desktop-api/advanced/remote-access (fetched 2026-09-20) | None. Page states verbatim: "The server binds to `0.0.0.0`..."; "Base URL is computed from `X-Forwarded-Host`, `X-Forwarded-Proto`, and forwarded port headers..."; "Beeper does not provide any tunneling services," recommending Cloudflare or Tailscale. |
| 3 | Auth via Bearer token (Settings→Integrations) or OAuth 2.0+PKCE with RFC 8414 discovery; same token covers REST and MCP (`/v0/mcp`, `/v0/sse`) | **CONFIRMED** | https://developers.beeper.com/desktop-api/auth (fetched 2026-09-20) | None. Page confirms RFC 8414 discovery at `/.well-known/oauth-authorization-server` and states explicitly that MCP endpoints accept the same Bearer token as REST. |
| 4 | KakaoTalk's only bridge is a community project (node-kakao-based, itself unmaintained) with a documented ban report; no actively maintained official path | **PARTIALLY REFUTED (nuance)** | https://developers.beeper.com/open-source/ (fetched 2026-09-20); `gh search repos node-kakao` (checked 2026-09-20) | Two corrections: (a) the underlying `storycraft/node-kakao` library's last push is verified at **2023-11-11** — i.e., ~2.9 years stale as of 2026-09-20, which does support "unmaintained," but this is now a directly verified date rather than an inference. (b) Beeper's own docs describe the KakaoTalk bridge as "community-maintained... **sponsored by Beeper**" and list it as an officially-acknowledged self-hostable bridge alongside IRC/GroupMe/LINE — this is a step above an orphaned rogue hack, contradicting the file's framing of it as purely unofficial. The 2022-era account-ban report's currency remains genuinely **UNVERIFIABLE** — `matrix.org/ecosystem/bridges/kakaotalk/` and the `src.miscworks.net` mirror were not deeply re-read for content (mirror responds HTTP 200, existence only), and WebSearch was unavailable to find a fresher report. |
| 5 | Core mautrix bridges (whatsapp/telegram/slack/gmessages/signal/meta) are AGPL-3.0, active as of Sept 2026; mautrix/go is MPL-2.0 | **CONFIRMED** | `gh api repos/mautrix/{whatsapp,telegram,slack,gmessages,signal,meta,go}` (checked 2026-09-20) | None. All six bridges report `license.spdx_id: AGPL-3.0`, `pushed_at` between 2026-09-16 and 2026-09-19. `mautrix/go` reports `MPL-2.0`, pushed 2026-09-19. |
| 6 | `beeper/linkedin` is archived, no commits since 2025-03-17 | **CONFIRMED** | `gh api repos/beeper/linkedin` (checked 2026-09-20) | None. `archived: true`, `pushed_at: 2025-03-17T16:41:45Z`, `license.spdx_id: Apache-2.0` — exact match. |
| 7 | Tuwunel is the official successor to conduwuit, Apache-2.0, supports MSC4186, migrates in-place from conduwuit/Conduit, spec-accepted July 2026 (per TWIM 2026-07-10) | **PARTIALLY REFUTED (date/citation)** | `gh api repos/matrix-construct/tuwunel`; README fetch (checked 2026-09-20); `gh api repos/matrix-org/matrix-spec-proposals/pulls/4186` (checked 2026-09-20); https://matrix.org/blog/2026/07/10/this-week-in-matrix-2026-07-10/ (fetched 2026-09-20) | GitHub repo description is verbatim "Official successor to conduwuit," license Apache-2.0, pushed 2026-09-19 — confirmed. README confirms in-place migration: "A RocksDB database from Conduit or a fork of conduwuit migrates in place on first boot," and Swiss-government sponsorship: "primarily sponsored by the government of Switzerland... currently deployed for citizens" — both confirmed. **Correction:** MSC4186 was merged into the Matrix spec repo on **2026-06-29** (per the PR's `merged_at`), not "July 2026" as the citation implies. The TWIM 2026-07-10 post does **not** announce spec acceptance at all — it only references MSC4186's PR number in passing, in the context of a Tuwunel sliding-sync bug fix. Tuwunel's support for MSC4186 itself is corroborated only indirectly (a bug being fixed in its MSC4186 implementation), not asserted in its own README. |
| 8 | `bbctl` lets a user self-host 16+ official Beeper bridges on their own hardware, free, outside account limits, community-only support | **CONFIRMED** | https://developers.beeper.com/bridges/self-hosting/ (fetched 2026-09-20) | None. Page states 16 official bridges, free and not counted against account limits, and "Self-hosting bridges are not entitled to the usual level of customer support," directing users to a community Matrix channel. |
| 9 | Beeper's docs warn Desktop API is for personal use only and risks account suspension from over-sending | **CONFIRMED** | https://developers.beeper.com/desktop-api/ (fetched 2026-09-20) | None. Verbatim: "We recommend Beeper Desktop API for personal use only. Sending too many messages might result in account suspension by the networks." |
| 10 | Whether Desktop API/MCP itself is gated behind paid Beeper Plus/Plus Plus is unstated in docs | **UNVERIFIABLE** (correctly flagged as such in the original) | https://www.beeper.com/faq (fetched 2026-09-20) | None — confirmed unverifiable, not merely unconfirmed. The FAQ page does not mention Desktop API or MCP at all, in either direction. `beeper.com/pricing` returned HTTP 404 on this re-check, so it could not be used to close the gap. Leave as UNVERIFIED per the file's own convention. |
| 11 (extra) | Beeper Plus Plus is priced "$30~49.99/month" | **PARTIALLY REFUTED** | https://www.beeper.com/faq (fetched 2026-09-20) | The FAQ only supports **$49.99/month** with "unlimited accounts." No $30/month figure was found on the FAQ, and `beeper.com/pricing` 404'd on this check. The lower bound of the stated range is currently unsupported by any primary source reachable in this pass — treat as UNVERIFIED, not a confirmed range, until a pricing page or an annual/regional variant is found. |

### Corrected recommendation

No claim above overturns the file's core recommendation (Desktop API/MCP as the primary channel layer, KakaoTalk handled outside it). Two corrections are worth folding into the decision text, not the conclusion: (1) the KakaoTalk bridge is Beeper-sponsored community infra, not a fully orphaned hack — if the self-built macOS-automation adapter turns out to be harder than expected, `bbctl` self-hosting the community KakaoTalk bridge is a slightly more legitimate fallback than the original wording suggested, though the underlying `node-kakao` library's ~3-year-stale upstream and the unverified ban-report still argue for keeping it out of the MVP path. (2) Don't cite "matrix.org TWIM 2026-07-10" as the MSC4186-acceptance source in any future doc — the actual spec-merge date is 2026-06-29, and that blog post doesn't announce it.
