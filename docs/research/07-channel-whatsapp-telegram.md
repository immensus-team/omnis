# 07 — WhatsApp / Telegram 개인계정 연동 (channel adapters)

## 1. TL;DR

WhatsApp은 API가 없으니 whatsmeow(Go) 아니면 Baileys(TS) 둘 중 하나로 WhatsApp Web multi-device 프로토콜을 역엔지니어링해서 붙여야 한다. 공식 Business Cloud API는 신규 사업자 번호 발급용이라 개인 번호(진호님 실사용 번호)에는 애초에 못 쓴다. 두 라이브러리 다 ToS 위반 소지가 있고 ban 사례가 보고되지만, read-mostly 저볼륨 패턴이면 리스크는 낮은 편(정확한 확률은 UNVERIFIED). whatsmeow가 유지보수·안정성 면에서 더 앞서고 Mac mini에 별도 Go 바이너리 사이드카로 얹기 쉽다. Telegram은 공식 api_id로 MTProto user-account 로그인이 ToS상 허용되는 정상 경로이고, ban 리스크가 WhatsApp보다 훨씬 낮다. TypeScript 쪽은 gramjs가 2026-07에 archive되어 mtcute로 갈아타야 한다. 두 채널 다 Mac mini에 상주 sidecar 프로세스 + 로컬 세션 파일(암호화) + 이벤트를 omnis 코어로 webhook/큐로 흘려보내는 구조가 맞다.

## 2. Facts

**WhatsApp — 라이브러리**
- whatsmeow(Go, `tulir/whatsmeow`, MPL-2.0)는 WhatsApp Web multi-device API의 Go 라이브러리. 2026-09-19 기준 GitHub stars 7,363, 같은 날 push 있음(활발히 유지보수 중). VERIFIED — [github.com/tulir/whatsmeow](https://github.com/tulir/whatsmeow), fetched 2026-09-20 (gh api).
- whatsmeow는 원래 go-whatsapp을 포크했지만 multidevice 지원을 위해 대부분 새로 작성했고, 코드 일부는 WhatsappWeb4j와 Baileys에서 포팅했다고 README에 명시. VERIFIED — 같은 소스.
- whatsmeow 지원 기능: private/group 메시지 송수신(텍스트+미디어), 그룹 관리·변경 이벤트, invite link, typing notification 송수신, delivery/read receipt 송수신, app-state(연락처·pin/mute 등) 읽기/쓰기, 복호화 실패 시 retry receipt. 미지원: broadcast list 메시지(WhatsApp Web 자체도 미지원), 통화(call). VERIFIED — [github.com/tulir/whatsmeow README](https://github.com/tulir/whatsmeow), fetched 2026-09-20.
- whatsmeow는 `GetQRChannel()`로 QR 로그인 채널을 열며 `Connect()` 이전에 호출해야 하고, QR은 만료 시 자동 재발급되며 전체 페어링 세션은 약 160초 제한. 마지막 이벤트로 success/timeout/에러 코드가 오고 채널이 닫힌다. VERIFIED (다수의 go.dev godoc 미러 일치) — [pkg.go.dev/go.mau.fi/whatsmeow](https://pkg.go.dev/go.mau.fi/whatsmeow), fetched 2026-09-20.
- whatsmeow는 이벤트 기반(`AddEventHandler`)이고 공식 SQL 스토어 구현(`store/sqlstore`)이 있어 device store와 메시지 히스토리를 SQLite/Postgres에 얹을 수 있다. `events.HistorySync`로 서버 히스토리 백필을 받는데, 실제 복구 가능한 기간은 WhatsApp 서버측 보존 정책에 달려있다(범위 UNVERIFIED). VERIFIED(구조) / UNVERIFIED(정확한 보존 기간) — [pkg.go.dev](https://pkg.go.dev/go.mau.fi/whatsmeow), fetched 2026-09-20.
- Baileys(TS, `WhiskeySockets/Baileys`, MIT)는 WhatsApp Web API용 WebSocket 기반 TS 라이브러리. 2026-09-19 기준 stars 11,093, 최근 push 2026-09-15(활발). 7.0.0에서 breaking change 다수 발생, 신규 가이드는 baileys.wiki로 이전 중. VERIFIED — [github.com/WhiskeySockets/Baileys](https://github.com/WhiskeySockets/Baileys), fetched 2026-09-20 (gh api + gh repo view).
- Baileys README는 "stalkerware, bulk, automated messaging 사용을 권장하지 않는다"는 명시적 디스클레이머를 달고 있고, 유지보수자는 오용에 대한 법적 책임을 지지 않는다고 명시. VERIFIED — [Baileys README](https://github.com/WhiskeySockets/Baileys/blob/master/README.md), fetched 2026-09-20.
- 대안으로 `pedroslopez/whatsapp-web.js`(Puppeteer로 실제 WhatsApp Web을 브라우저 자동화하는 방식, Apache-2.0)도 있음. 2026-09-19 기준 stars 22,593, 최근 push 2026-09-13. Puppeteer 기반이라 리소스 소모가 크고 Chromium 의존성이 붙음. VERIFIED(레포 메타) — [github.com/pedroslopez/whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js), fetched 2026-09-20.

**WhatsApp — 기기 제한 / ban 리스크**
- WhatsApp은 주 전화기 1대 + 동반기기(linked device) 최대 4대까지 기본 지원(WhatsApp Web/Desktop 등). Meta Verified 가입 시 동반기기 한도가 10대로 늘어남. VERIFIED — [WhatsApp Help Center: About linked devices](https://faq.whatsapp.com/647349420360876), fetched 2026-09-20.
- WhatsApp Business Cloud API(공식 API)는 "unlimited devices" 카테고리로 별도 취급되지만, 이는 신규 사업자 전화번호를 프로비저닝하는 구조이지 개인이 이미 쓰던 번호를 그대로 붙이는 구조가 아니다. VERIFIED(구조적 사실) — [Meta for Developers: About the WhatsApp Business Platform](https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform), fetched 2026-09-20; 요약 근거 [unipile.com WhatsApp API 2026 guide](https://www.unipile.com/whatsapp-api-a-complete-guide-to-integration/), fetched 2026-09-20.
- 확장 메시징 한도·Official Business Account 상태를 받으려면 비즈니스 검증(business verification)이 필요하며, 이는 "신규 사업자 번호"를 전제로 한 트랙이다. VERIFIED — 같은 소스.
- whatsmeow GitHub Issue #810("Your account may be at risk" 경고)은 whatsmeow 및 Baileys 사용자 양쪽에서 보고된 계정 경고 사례를 다룬다. Baileys Issue #1869("High number of bans on WhatsApp!")와 #2309(status 업로드 후 영구 정지 보고)도 존재. 이런 이슈 트래커 보고는 사용자 자기보고이며 통계적으로 검증된 ban율은 아니다. UNVERIFIED(정확한 ban 확률) / VERIFIED(이슈 존재 자체) — [whatsmeow #810](https://github.com/tulir/whatsmeow/issues/810), [Baileys #1869](https://github.com/WhiskeySockets/Baileys/issues/1869), [Baileys #2309](https://github.com/WhiskeySockets/Baileys/issues/2309), fetched 2026-09-20.
- 비공식 클라이언트(GB WhatsApp류) 및 Baileys/whatsmeow 기반 자동화 모두 WhatsApp ToS 위반 소지가 있고, 탐지는 프로토콜 레벨 신호(낮은 응답률, 연락망상 먼 낯선 사람에게 메시지, 로봇 같은 타이밍, 데이터센터/VPS IP 대역에서의 트래픽)에 기반한다는 것이 커뮤니티 보고의 공통된 설명. 이는 3rd-party 블로그·매뉴얼 기반 요약으로 공식 문서가 아니라 UNVERIFIED로 표시. — [achiya-automation.com WhatsApp Spam Detection 2026](https://achiya-automation.com/en/blog/whatsapp-spam-detection-2026/), fetched 2026-09-20.
- read-only/저볼륨(수신 확인, 가끔 답장) 개인 용도가 대량발송용 자동화보다 리스크가 낮다는 것은 논리적으로 합당하지만, 정량적 근거(구체적 ban율 수치)는 찾지 못함. UNVERIFIED.

**Telegram — 라이브러리**
- 공식 Bot API는 봇 계정으로 동작하며, 봇이 멤버로 가입한 채널/그룹의 메시지만 볼 수 있고(그것도 privacy mode가 꺼져 있어야 함) 다른 봇이 보낸 메시지는 못 본다. 즉 "내 모든 DM/그룹을 그대로 다 읽는" 개인 인박스 용도로는 구조적으로 안 맞는다. VERIFIED — [core.telegram.org/bots/faq](https://core.telegram.org/bots/faq), fetched 2026-09-20.
- 개인 계정처럼 모든 대화(DM, 내가 속한 모든 그룹/채널)를 그대로 읽으려면 MTProto user-account(userbot) 로그인이 필요하다. 대표 라이브러리: Python은 Telethon(`LonamiWebs/Telethon`, MIT, 2026-09-19 기준 stars 12,058, 최근 push 2026-02-21 — 최근 6개월+ 정체) 및 Pyrogram(`pyrogram/pyrogram`, LGPL-3.0, stars 4,616, 최근 push 2024-12-23 — 약 2년 정체). TS/Node는 `gram-js/gramjs`(MIT, stars 1,764)가 있었으나 **2026-07-14에 archive됨(공식 archived 상태 확인)**. VERIFIED — 전부 gh repo view 메타데이터, fetched 2026-09-20.
- gramjs archive 이후 활발히 유지되는 TS MTProto 대체 라이브러리는 mtcute(`mtcute/mtcute`, MIT, stars 562, 2026-09-19 push — 활발). teleproto라는 gramjs 포크도 커뮤니티에서 언급되나 이번 조사에서 공식 GitHub 레포 메타데이터로 직접 확인하지 못함(UNVERIFIED, 문서 사이트 docs.teleproto.dev만 확인). VERIFIED(mtcute) / UNVERIFIED(teleproto 레포 실체) — [github.com/mtcute/mtcute](https://github.com/mtcute/mtcute), fetched 2026-09-20; teleproto 언급 [docs.teleproto.dev/faq](https://docs.teleproto.dev/faq), fetched 2026-09-20.
- TDLib(`tdlib/td`, Boost-1.0, stars 9,101, 최근 push 2026-08-24 — 활발, Telegram 공식)는 C++ 코어 라이브러리로 Node/TS에서 쓰려면 네이티브 바이너리나 WASM 바인딩 + JSON 브리지가 필요해 순수 TS 스택 대비 빌드/배포 복잡도가 크다. VERIFIED(레포 메타) / 복잡도 서술은 커뮤니티 comparison 기반 UNVERIFIED-경향 — [github.com/tdlib/td](https://github.com/tdlib/td), fetched 2026-09-20; 비교 근거 [mtcute.dev/guide/intro/mtproto-vs-bot-api](https://mtcute.dev/guide/intro/mtproto-vs-bot-api), fetched 2026-09-20.
- mtcute는 QR 로그인(`qrCodeHandler`)과 phone+code(`sendCode`/`phoneCodeHash`) 두 로그인 경로를 지원하고, Node.js에서 SQLite 파일 기반 세션 스토리지를 기본 제공하며 `markAsRead` 등 300개 이상의 고수준 메서드를 제공한다. VERIFIED — [mtcute.dev/guide/intro/sign-in](https://mtcute.dev/guide/intro/sign-in), fetched 2026-09-20.

**Telegram — ToS / ban 리스크**
- Telegram 공식 API 약관: 앱은 반드시 자체 `api_id`를 발급받아야 하고, 그 자격증명을 공개적으로 배포하는 것은 명시적으로 금지된다. VERIFIED — [core.telegram.org/api/obtaining_api_id](https://core.telegram.org/api/obtaining_api_id), [core.telegram.org/api/terms](https://core.telegram.org/api/terms), fetched 2026-09-20.
- 비공식 API 클라이언트로 로그인한 모든 계정은 ToS 위반 방지를 위해 자동으로 관찰(observation) 대상이 되며, 플러딩/스팸/구독자·조회수 조작에 API를 쓰면 영구 밴된다고 명시. 짧은 시간 내 반복 로그인/로그아웃도 계정을 abuse로 표시할 수 있다. VERIFIED — [core.telegram.org/api/terms](https://core.telegram.org/api/terms), fetched 2026-09-20.
- 정상 사용 중 오탐으로 밴된 경우 recover@telegram.org로 사유를 설명하고 항소할 공식 경로가 있다. VERIFIED — 같은 소스.
- 개인 계정으로 자신이 받은 모든 메시지를 읽고 답장하는(자동 대량발송이 아닌) 용도는 Telegram이 명시적으로 금지하는 "flooding/spamming/카운터 조작"과는 성격이 다르지만, "관찰 대상이 된다"는 규정 자체는 모든 비공식 클라이언트 로그인에 적용된다. VERIFIED(문구) / 해석(리스크가 낮다)은 our own — UNVERIFIED as a quantified claim.
- Bot API 레이트리밋: 동일 채팅에 초당 1건 초과 금지(짧은 버스트는 허용될 수 있으나 이후 429), 그룹 채팅은 분당 20건, 대량 브로드캐스트는 초당 약 30건(유료 broadcast 활성화 시 초당 최대 1,000건까지 상향). MTProto user-account 쪽은 이런 공식 수치 문서가 없고 서버측 flood-wait로 동적 제어된다(구체 수치 UNVERIFIED). VERIFIED(Bot API 수치) — [core.telegram.org/bots/faq](https://core.telegram.org/bots/faq), fetched 2026-09-20.

**참고 오픈소스 (제품/아키텍처 벤치마크)**
- `block/buzz`("A hive mind communication platform", Apache-2.0)는 2026-09-19 기준 stars 33,695로 매우 활발. 브리프에서 언급된 참고 레포. VERIFIED(메타데이터만, 내부 아키텍처는 이번 조사에서 미확인) — [github.com/block/buzz](https://github.com/block/buzz), fetched 2026-09-20.
- Kinso.ai는 Gmail/LinkedIn/Slack/WhatsApp/Instagram 등을 합친 유료 유니파이드 인박스로, 메시지 우선순위 랭킹·톤을 학습한 답장 초안 제시·아침 브리핑을 제공하는 invite-only 제품($59/월대 언급). VERIFIED(제품 설명, 마케팅 자료 기반이라 기능 주장 자체는 회사측 claim) — [kinso.ai](https://www.kinso.ai/), [VentureBeat: Cracking the universal inbox](https://venturebeat.com/business/cracking-the-universal-inbox-inside-kinsos-quest-to-make-cross-channel-ai), fetched 2026-09-20.

## 3. Options / 비교표

| | whatsmeow (Go) | Baileys (TS) | whatsapp-web.js (TS/Puppeteer) |
|---|---|---|---|
| 언어/런타임 적합성 | Go 바이너리, omnis TS 스택과 별도 프로세스 필요 | omnis TS 스택과 네이티브 통합 가능 | TS지만 Chromium 필요, 무겁다 |
| 유지보수 활발도 | 매우 활발(2026-09-19 push) | 매우 활발하나 major breaking change 진행 중(7.0.0) | 활발하나 브라우저 자동화 특성상 취약 |
| 프로토콜 방식 | WhatsApp Web multi-device 직접 구현 | 동일(일부 코드 whatsmeow와 상호 포팅됨) | 실제 Chromium에 WhatsApp Web 로드 후 DOM/내부 API 후킹 |
| 리소스 사용 | 가볍다(단일 바이너리) | 가볍다(Node 프로세스) | 무겁다(Chromium 인스턴스 상시 구동) |
| 히스토리/미디어 지원 | HistorySync 이벤트, 공식 SQL 스토어 | 유사 기능 보유 | 브라우저 세션에 의존, 안정성 낮음 |
| 커뮤니티 신뢰도(스타) | 7,363 | 11,093 | 22,593(단, 목적이 다름) |
| 권장 여부(omnis) | **1순위 후보** — Mac mini sidecar에 적합 | 2순위(단일 언어 스택 선호 시) | 비권장(무겁고 탐지 신호 더 많음) |

| | Telethon (Py) | Pyrogram (Py) | gramjs (TS, archived) | mtcute (TS) | TDLib (C++) |
|---|---|---|---|---|---|
| 최근 활동 | 2026-02(정체 기미) | 2024-12(정체) | **2026-07-14 archived** | 2026-09-19(활발) | 2026-08-24(활발, 공식) |
| omnis 스택 적합성(TS 우선) | 별도 Python 프로세스 필요 | 별도 Python 프로세스 필요 | 사용 비권장(archived) | **네이티브 TS 통합** | 네이티브 바이너리/WASM 브릿지 필요, 복잡도 높음 |
| 세션 관리 | 파일 세션 | 파일 세션 | 세션 문자열(Telethon과 상호 호환 이슈 보고됨) | SQLite 세션(내장) | 자체 DB 파일 |
| 권장 여부(omnis) | 백업 옵션 | 비권장(정체) | **비권장(archived)** | **1순위 후보** | 비권장(빌드 복잡도 대비 이득 낮음, omnis 스코프엔 과함) |

## 4. Recommendation for omnis

**WhatsApp: whatsmeow(Go)를 Mac mini에 독립 사이드카 프로세스로 채택.** 이유: (1) 개인 번호를 그대로 쓰는 유일한 실질적 경로가 whatsmeow/Baileys 류의 web-protocol 리버스 엔지니어링뿐이고 Business Cloud API는 구조적으로 배제됨(VERIFIED), (2) whatsmeow가 두 라이브러리 중 유지보수 신호가 더 좋고 리소스가 가벼움, (3) 언어가 달라도 사이드카+로컬 HTTP/gRPC 또는 Unix socket으로 붙이면 문제 없음(Mac mini는 어차피 Hermes도 별도 프로세스로 돌아가는 구조). Baileys는 "Node 단일 스택 유지"가 더 중요해지면 대안으로 남겨둔다. whatsapp-web.js(Puppeteer)는 탈락 — Chromium 상시 구동은 Mac mini 16GB RAM에서 낭비고 탐지 신호도 더 많다는 커뮤니티 보고(UNVERIFIED이지만 논리적으로 합당).
- Effort: **M** (whatsmeow 자체는 성숙하지만, QR pairing UX + 세션 영속화 + 이벤트→omnis 큐 브리지 + 재연결/재인증 로직까지 포함하면 며칠 단위 작업)
- Risk: **ToS 위반 확정적(회색지대), ban 확률은 UNVERIFIED이나 0 아님.** 완화책: 응답률을 자연스럽게 유지(모든 메시지에 즉답 자동화 금지), 데이터센터 IP 아닌 Mac mini의 가정용 회선에서 구동(이미 계획대로), 대량 발송·낯선 사람에게 선제 메시지 금지, read-mostly + draft-then-human-send 패턴 유지(브리프의 "초안만 작성, 발송은 알림 후 결정" 설계와 자연히 일치). **진호님께 명시적으로 이 리스크를 인지시키고 진행 여부 확답 받을 것 — 계정 정지는 되돌리기 어렵고 사업(Underpin/Onword) 커뮤니케이션에 영향.**

**Telegram: mtcute(TS) + MTProto user-account 로그인을 채택.** 이유: (1) 공식 api_id 발급 경로가 있어 ToS상 정상 트랙(VERIFIED), (2) gramjs는 archived라 신규 프로젝트에 쓸 수 없음(VERIFIED), (3) mtcute가 활발히 유지되는 유일한 순수 TS 옵션이고 SQLite 세션이 내장돼 Mac mini sidecar 구조에 바로 맞음, (4) TDLib은 공식이지만 C++ 브릿지 복잡도가 omnis 스코프 대비 과함. Bot API는 보조 용도(예: 자체 알림 봇)로만 쓰고 메인 인박스 수집에는 부적합(그룹 전체를 못 읽음).
- Effort: **S–M** (MTProto 자체는 whatsmeow보다 단순한 편이지만 2FA/phone-code UX, flood-wait 처리, api_id 발급·보안 필요)
- Risk: **ToS 위반 소지 낮음, 밴 리스크 WhatsApp보다 명확히 낮음.** api_id를 코드에 하드코딩/공개 배포하지 않기, 짧은 시간 반복 로그인/로그아웃 피하기(세션을 길게 유지) 정도만 지키면 됨.

두 채널 모두 **"Mac mini가 유일한 수집 허브"**라는 브리프 설계와 정확히 맞아떨어진다 — API 없는 채널(WhatsApp, KakaoTalk, LinkedIn)은 어차피 세션이 특정 기기에 묶이므로, whatsmeow/mtcute 사이드카를 Mac mini에 상시 구동시키고 omnis 코어(Mac mini 또는 클라우드)로 이벤트를 큐/webhook으로 밀어넣는 게 맞다. "나중에 맥북 단독 앱"으로 갈 때는 같은 사이드카 바이너리/프로세스를 맥북에도 그대로 띄우면 되므로(세션 파일만 기기별로 새로 발급) 지금 설계가 그 목표와 상충하지 않는다.

## 5. What to borrow

- **whatsmeow 이벤트 모델**: `AddEventHandler` 기반 event bus 패턴을 omnis의 내부 이벤트 버스(추후 모든 채널 공통 `InboxEvent` 타입) 설계에 그대로 참고. 채널마다 어차피 QR/전화번호 로그인, 재연결, 메시지/영수증/타이핑 이벤트라는 동일한 shape가 반복되므로 **공통 어댑터 인터페이스**(`connect() / onEvent() / sendMessage() / markRead() / setTyping()`)를 하나 정의하고 whatsmeow, mtcute, (추후) Slack/Gmail 어댑터가 전부 구현하게 하면 코드량이 준다. 참고 소스: [pkg.go.dev/go.mau.fi/whatsmeow](https://pkg.go.dev/go.mau.fi/whatsmeow) events 섹션.
- **whatsmeow 공식 SQL store 패턴**(`store/sqlstore`): 세션/디바이스 상태를 로컬 SQLite에 두고 앱 재시작 시 QR 재스캔 없이 복원하는 구조를 mtcute 세션 관리에도 동일하게 적용(mtcute는 이미 SQLite 세션을 내장 지원하므로 자연히 일치).
- **`Sealjay/mcp-whatsapp`**(whatsmeow를 래핑해 42개 MCP 툴로 노출한 단일 바이너리 Go MCP 서버) — omnis의 "에이전트가 인박스를 직접 조작"하는 요구사항(브리프의 "에이전트가 알아서 인박스에 맞게 일을 다 하는" 부분)에 바로 참고할 아키텍처. MCP 툴 형태로 WhatsApp을 노출하면 Codex/Hermes/Claude 에이전트가 별도 통합 코드 없이 표준 MCP 클라이언트로 WhatsApp을 조작 가능 — omnis 자체도 채널 어댑터를 MCP 서버로 노출하는 설계를 검토할 가치가 있음. 참고: [github.com/Sealjay/mcp-whatsapp](https://github.com/Sealjay/mcp-whatsapp) (이번 조사에서 검색 결과로만 확인, 상세 코드는 미검토 — 다음 리서치 라운드에서 clone해서 볼 것).
- **`steipete/wacli`**(whatsmeow 기반 WhatsApp 터미널 클라이언트) — 링크·페어링·검색 UX 참고용. [github.com/steipete/wacli](https://github.com/steipete/wacli) (미검토, pointer만).
- **Baileys의 명시적 오용 방지 디스클레이머 문구와 커뮤니티 규범**(스팸/대량발송 금지 권고) — omnis 자체 정책 문서(어디까지 자동화를 허용할지)를 쓸 때 그대로 참고할 톤.
- **mtcute의 이중 로그인 경로(QR + phone-code)**: 브리프에서 요구한 "맥북/아이폰에서도 접근"이라는 목표를 생각하면, 최초 페어링은 Mac mini에서 하되 QR을 omnis 앱 화면에 렌더링해서 아이폰 카메라로 스캔하게 하는 흐름(WhatsApp의 실제 다중기기 UX와 동일한 패턴)을 그대로 차용할 수 있음.
- **Kinso.ai의 "읽으면 우선순위 랭킹 + 톤을 학습한 답장 초안 + 아침 브리핑"** 제품 흐름 — 브리프의 아카이브 다이제스트·컨텍스트 기반 답장 초안 요구사항과 정확히 겹친다. UI/기능 벤치마크 대상으로 계속 참고.

## 6. Open questions

1. `teleproto`(gramjs 포크)의 실제 GitHub 레포·유지보수 상태를 공식적으로 확인하지 못함 — mtcute 대신 고려할 가치가 있는지 다음 라운드에서 직접 clone해서 확인 필요.
2. whatsmeow의 히스토리 동기화가 실제로 며칠/몇 주 분량의 과거 메시지를 백필해주는지 정확한 보존 기간 수치를 못 찾음 — 프로토타입에서 직접 측정 필요.
3. WhatsApp ban 리스크의 정량적 수치(예: read-mostly 저볼륨 계정의 실제 생존 기간 통계)는 어디에도 공식 데이터가 없음 — 진호님 본인 번호로 리스크를 감수할지, 별도 세컨더리 번호로 먼저 파일럿할지 결정 필요(강력 권고: **부번호로 먼저 테스트**).
4. Telegram 2FA(cloud password)가 걸려있는 계정에서 QR 로그인 시 추가 UX가 필요한데, omnis 앱 내 QR 렌더링 + 2FA 입력 흐름을 구체적으로 어떻게 아이폰/맥북 클라이언트에 녹일지 설계 미정.
5. Mac mini sidecar(Go 바이너리 whatsmeow + Node 프로세스 mtcute)와 omnis 코어(아마 TS/Next.js) 사이의 통신 프로토콜(로컬 HTTP? gRPC? Unix domain socket? 메시지 큐?)을 다른 채널 어댑터(Hermes api_server:8642 패턴 참고)와 통일된 방식으로 설계해야 하는데 이번 리서치 범위 밖 — 별도 아키텍처 리서치 필요.
6. WhatsApp/Telegram 세션 파일(디바이스 키, MTProto auth key)을 Mac mini에만 둘지, 나중에 맥북에도 별도로 페어링할지(=별개 linked device 슬롯 소비) 결정 필요 — "맥미니 전용 수집, 클라이언트는 결과만 구독" 모델이 더 안전해 보이나 브리프의 "나중에 맥북 단독 앱" 목표와 세션 이전 방식을 조율해야 함.

## 7. Sources

- [github.com/tulir/whatsmeow](https://github.com/tulir/whatsmeow) — repo + README, fetched 2026-09-20
- [pkg.go.dev/go.mau.fi/whatsmeow](https://pkg.go.dev/go.mau.fi/whatsmeow) — godoc, fetched 2026-09-20
- [github.com/WhiskeySockets/Baileys](https://github.com/WhiskeySockets/Baileys) + [README](https://github.com/WhiskeySockets/Baileys/blob/master/README.md) — fetched 2026-09-20
- [github.com/pedroslopez/whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) — fetched 2026-09-20
- [faq.whatsapp.com/647349420360876](https://faq.whatsapp.com/647349420360876) — Linked devices, fetched 2026-09-20
- [developers.facebook.com — About the WhatsApp Business Platform](https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform) — fetched 2026-09-20
- [unipile.com WhatsApp API 2026 guide](https://www.unipile.com/whatsapp-api-a-complete-guide-to-integration/) — fetched 2026-09-20
- [github.com/tulir/whatsmeow/issues/810](https://github.com/tulir/whatsmeow/issues/810) — fetched 2026-09-20
- [github.com/WhiskeySockets/Baileys/issues/1869](https://github.com/WhiskeySockets/Baileys/issues/1869), [#2309](https://github.com/WhiskeySockets/Baileys/issues/2309) — fetched 2026-09-20
- [achiya-automation.com WhatsApp Spam Detection 2026](https://achiya-automation.com/en/blog/whatsapp-spam-detection-2026/) — fetched 2026-09-20
- [core.telegram.org/bots/faq](https://core.telegram.org/bots/faq) — fetched 2026-09-20
- [github.com/LonamiWebs/Telethon](https://github.com/LonamiWebs/Telethon), [github.com/pyrogram/pyrogram](https://github.com/pyrogram/pyrogram), [github.com/gram-js/gramjs](https://github.com/gram-js/gramjs) — repo metadata (incl. archived flag), fetched 2026-09-20
- [github.com/mtcute/mtcute](https://github.com/mtcute/mtcute) — fetched 2026-09-20
- [mtcute.dev/guide/intro/sign-in](https://mtcute.dev/guide/intro/sign-in), [mtcute.dev/guide/intro/mtproto-vs-bot-api](https://mtcute.dev/guide/intro/mtproto-vs-bot-api), [mtcute.dev/guide/intro/faq](https://mtcute.dev/guide/intro/faq) — fetched 2026-09-20
- [github.com/tdlib/td](https://github.com/tdlib/td) — fetched 2026-09-20
- [core.telegram.org/api/obtaining_api_id](https://core.telegram.org/api/obtaining_api_id), [core.telegram.org/api/terms](https://core.telegram.org/api/terms) — fetched 2026-09-20
- [docs.teleproto.dev/faq](https://docs.teleproto.dev/faq) — fetched 2026-09-20 (teleproto claim, repo itself unverified)
- [github.com/block/buzz](https://github.com/block/buzz) — fetched 2026-09-20
- [kinso.ai](https://www.kinso.ai/), [VentureBeat: Cracking the universal inbox](https://venturebeat.com/business/cracking-the-universal-inbox-inside-kinsos-quest-to-make-cross-channel-ai) — fetched 2026-09-20
- Pointer-only, not yet cloned/reviewed: [github.com/Sealjay/mcp-whatsapp](https://github.com/Sealjay/mcp-whatsapp), [github.com/steipete/wacli](https://github.com/steipete/wacli) — fetched 2026-09-20 (search result only)

## Verification (adversarial)

Re-checked 2026-09-20 via `gh api`/`gh repo view` (live GitHub metadata) and direct fetch of the cited primary-source pages. Default verdict is `unverifiable`, not `confirmed`, wherever no primary source actually says the thing.

| Claim | Verdict | Evidence URL | Correction |
|---|---|---|---|
| whatsmeow: 7,363 stars, pushed 2026-09-19 | **confirmed** | `gh api repos/tulir/whatsmeow` → `stars:7363, pushed_at:2026-09-19T10:35:50Z` — [github.com/tulir/whatsmeow](https://github.com/tulir/whatsmeow) | None — exact match. |
| Baileys: 11,093 stars, push 2026-09-15; README discourages stalkerware/bulk/automated use | **confirmed** | `gh api repos/WhiskeySockets/Baileys` → `stars:11093, pushed_at:2026-09-15T01:50:14Z`; README verbatim: *"We discourage any stalkerware, bulk or automated messaging usage."* — [README](https://github.com/WhiskeySockets/Baileys/blob/master/README.md) | Star/push counts and the disclaimer text are exact matches. The "v7.0.0 introduced multiple breaking changes" sub-claim was not independently checked against the changelog/release notes in this pass — treat that specific detail as unverified-but-plausible, not confirmed. |
| WhatsApp Business Cloud API is for provisioning a new business number, not attaching a personal one; needs business verification for higher limits | **confirmed** (substance), correction on citation | Working primary source: [developers.facebook.com/docs/whatsapp/cloud-api/overview](https://developers.facebook.com/docs/whatsapp/cloud-api/overview) — *"Business phone numbers, real or virtual, are used for sending and receiving WhatsApp messages"*; verification tied to *"higher throughput and Official Business Account status."* | The URL actually cited in the file's own Sources section, `developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform`, is a **dead link (404)** as of 2026-09-20. Replace it with `developers.facebook.com/docs/whatsapp/cloud-api/overview` in §7 Sources. |
| WhatsApp: 1 phone + up to 4 linked devices by default, 10 with Meta Verified | **confirmed** (4-device part), **unverifiable via primary source** (10-device part) | 1+4: [faq.whatsapp.com/647349420360876](https://faq.whatsapp.com/647349420360876) (WhatsApp Business Help Center) — *"You can use up to four linked devices and one phone at a time."* 10-with-Meta-Verified: only found in secondary sources (aisensy.com, sleekflow.io), no official WhatsApp/Meta page could be loaded that states "10" directly in this pass. | Note the primary source that resolved is titled "About linked devices on the **WhatsApp Business app**," not the general consumer WhatsApp FAQ — same underlying multi-device protocol, but cite that title precisely rather than implying a generic WhatsApp page. The "10 with Meta Verified" figure should be downgraded from VERIFIED to "reported consistently by secondary sources, official primary text not located" until a working faq.whatsapp.com/Meta page confirming "10" is found. |
| gram-js/gramjs archived 2026-07-14, should not be used for new projects | **confirmed** | `gh api graphql` → `isArchived:true, archivedAt:2026-07-14T19:51:17Z` — [github.com/gram-js/gramjs](https://github.com/gram-js/gramjs) | None — exact date match. |
| mtcute: actively maintained (pushed 2026-09-19), pure TS, SQLite session storage, QR + phone-code login | **confirmed** | `gh api repos/mtcute/mtcute` → `pushed_at:2026-09-19T18:39:54Z`; QR + phone/code confirmed on [mtcute.dev/guide/intro/sign-in](https://mtcute.dev/guide/intro/sign-in); SQLite confirmed via mtcute FAQ, which says it "uses `better-sqlite3` internally" for storage | None material. "Built-in SQLite session storage" is accurate but comes from the `better-sqlite3` dependency, not a phrase the sign-in page itself uses — minor wording precision only. |
| Telegram Bot API cannot read all messages (needs bot membership + privacy mode off; never sees other bots' messages); full read access needs MTProto userbot login | **confirmed** | [core.telegram.org/bots/faq](https://core.telegram.org/bots/faq) — privacy-mode-on bots get only commands; privacy-mode-off bots get "all messages except messages sent by other bots"; *"Bots will not be able to see messages from other bots regardless of mode."* | None — exact match. |
| Telegram API terms: unofficial-client accounts auto-observed, permanent ban for flooding/spam/counter manipulation, frequent login/logout flagged as abuse; official appeal via recover@telegram.org | **confirmed** (observation/ban/appeal), **unverifiable** (login/logout detail); **source misattributed** | Full text of [core.telegram.org/api/terms](https://core.telegram.org/api/terms) fetched directly (curl) — contains **none** of the observation/ban/appeal language; it only covers privacy, branding, monetization, breach-notice. The actual matching text lives on [core.telegram.org/api/obtaining_api_id](https://core.telegram.org/api/obtaining_api_id): *"all accounts that log in using unofficial Telegram API clients are automatically put under observation... If you use the Telegram API for flooding, spamming, faking subscriber and view counters of channels, you will be banned forever... write to recover@telegram.org."* | **Fix the citation**: drop `core.telegram.org/api/terms` as a source for this claim — it does not contain it. Cite `core.telegram.org/api/obtaining_api_id` only. Also: the specific detail "frequent login/logout can flag an account as abuse" was **not found on either page** or via secondary search in this pass — mark it unverifiable rather than VERIFIED until a primary source is located. |
| whatsmeow (#810) and Baileys (#1869, #2309) issues report WhatsApp bans/warnings from non-bulk automated use; no quantified ban-rate data exists | **confirmed** | Issues exist and match titles: [whatsmeow#810](https://github.com/tulir/whatsmeow/issues/810) "⚠️ Your account may be at risk warning..." (closed), [Baileys#1869](https://github.com/WhiskeySockets/Baileys/issues/1869) "High number of bans on WhatsApp!" (closed), [Baileys#2309](https://github.com/WhiskeySockets/Baileys/issues/2309) "Account gets permanently banned when uploading WhatsApp status..." (open) | None — the file already correctly hedges this as self-reported/unquantified. |
| TDLib needs native binary/WASM bridging for Node/TS, disproportionate complexity vs mtcute | **confirmed** (repo facts), **unverifiable** (complexity comparison) | `gh api repos/tdlib/td` → `stars:9101, pushed_at:2026-08-24T16:45:28Z, license:BSL-1.0` — [github.com/tdlib/td](https://github.com/tdlib/td) | Repo metadata matches (the file's "Boost-1.0" is just an informal name for the same SPDX `BSL-1.0` license — not an error). The "complexity disproportionate to omnis's scope" judgment is reasonable engineering opinion, not something a primary source states outright — the file already flags this correctly as UNVERIFIED-leaning; no change needed. |
| whatsmeow README explicitly states it ported code from WhatsappWeb4j and Baileys (Facts §, whatsmeow bullet 2) | **refuted** (as sourced) | Full current README fetched via `gh api repos/tulir/whatsmeow/readme` (35 lines, in full) — [github.com/tulir/whatsmeow](https://github.com/tulir/whatsmeow) | The current README contains **no** statement about being forked from go-whatsapp or porting code from WhatsappWeb4j/Baileys — it only has Discussion/Usage/Features sections. The file marks this "VERIFIED — 같은 소스" (same source, i.e. the README); that citation does not hold for the present README content. Either this info was true of an older README revision, or it needs a different source (git history, a wiki page, or a blog post) — cite that instead, or downgrade to unverified. |
| `github.com/steipete/wacli` — whatsmeow-based WhatsApp terminal client (pointer, §5) | **correction** | `gh api repos/steipete/wacli` redirects to `full_name: "openclaw/wacli"`, description "WhatsApp CLI: sync, search, send", 2,747 stars | The repo has been renamed/transferred: it now lives at `github.com/openclaw/wacli`, not `steipete/wacli`. GitHub's old-URL redirect currently still resolves it, but the canonical link and attribution should be updated to `openclaw/wacli` before this is used as a durable reference. |
| `Sealjay/mcp-whatsapp` — 42 MCP tools wrapping whatsmeow (§5) | **confirmed** | `gh api repos/Sealjay/mcp-whatsapp` → description: *"Single-binary Go MCP server that wraps whatsmeow to expose a personal WhatsApp account as 42 MCP tools (messaging, groups, polls, media, privacy)."* | None — matches the file's description closely; still worth actually cloning/reviewing as the file itself notes. |

None of the above refutations or corrections change the §4 recommendation (whatsmeow + mtcute, sidecar architecture, treat WhatsApp ban risk as real and unquantified). They are citation-hygiene and precision fixes: one dead source URL, one source misattributed to the wrong Telegram terms page, one unsupported sub-detail ("frequent login/logout" flagging), one README claim that doesn't hold for the current README text, and one renamed GitHub repo. No "Corrected recommendation" section is needed.
