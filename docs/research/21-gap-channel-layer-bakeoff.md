# 21 — GAP 2: 채널 계층 결정 — Beeper Desktop API vs per-channel adapter (채널별 해소)

조사일: 2026-09-20. 대상: `04-beeper-matrix-bridges.md`, `06-channel-linkedin.md`, `07-channel-whatsapp-telegram.md`, `08-channel-slack-email-calendar.md`, `90-critique.md`의 상호 모순 해소.

## 0. 이 문서가 하지 못한 것 (먼저 밝힘)

과제는 "맥미니에 Beeper를 무료 계정으로 설치하고 토큰을 발급해 7개 채널에서 read+send+read-receipt write-back을 실측하라"였다. **이 세션은 그 실측을 수행하지 못했다.** 이유: (1) 이 세션은 리서치 서브에이전트로 로컬 파일시스템/웹만 접근하며 진호님의 맥미니에 대한 원격 실행 권한이 없다, (2) 실측에는 진호님의 실제 WhatsApp/LinkedIn/Telegram/Slack 계정으로 QR 스캔·2FA·OAuth 동의를 직접 수행해야 하는데 이는 사용자 인증정보를 다루는 행위라 에이전트가 대신할 수 없는 영역이다. 대신 (a) 4개 리서치 파일 + `90-critique.md`의 기존 1차 소스 검증을 정합성 있게 재구성하고, (b) 오늘 날짜로 Beeper 공식 문서를 재검증(가격 게이팅 질문·전송 API 세부사항 재확인)하고, (c) §4에 진호님이 30~60분 안에 직접 돌릴 수 있는 실측 프로토콜을 남겼다. 실측 자체는 열린 질문(§6)으로 넘긴다.

## 1. TL;DR

Beeper Desktop API는 무료(공식 페이지 "Download for free", Public beta 명시)로 보이지만 `beeper.com/pricing`은 여전히 404, FAQ도 Desktop API를 언급하지 않아 API 자체의 유료 게이팅 여부는 문서만으론 확정 불가. 전송 API(`POST /v1/chats/{chatID}/messages`)는 네트워크별 구분 없이 일반화돼 있어 LinkedIn·WhatsApp에서 실제로 되는지는 문서로 확인 안 됨. 결정적으로 새로 확인한 사실: Beeper의 LinkedIn 브릿지(`mautrix/linkedin`)는 로그인 후 ~20초 만에 세션이 죽는 미해결 버그(#55, 2026-05 오픈, 수정 PR #61 8월부터 미병합)가 있고, `beeper/linkedin`과 `beeper/linkedin-messaging-api` 두 개의 자체 LinkedIn 레포가 모두 archived다 — LinkedIn은 Beeper 포트폴리오에서 가장 약한 고리다. omnis의 7개 채널(Slack/Kakao/Gmail/Outlook/Telegram/LinkedIn/WhatsApp) 각각에 대해 채널별로 다르게 답한다: WhatsApp은 Beeper를 1차로(같은 whatsmeow 계열 리스크, 통합 비용만 절감), Telegram·Slack은 각 플랫폼 공식 실시간 채널(mtcute, Socket Mode+xoxp)이 이미 더 낫고 ToS상 더 안전하므로 Beeper 배제, LinkedIn은 지금 당장은 Playwright 상주 프로필(Beeper 경로가 upstream에서 고장나 있음), KakaoTalk은 자체 macOS 어댑터, Gmail/Outlook은 애초에 Beeper 범위 밖이라 08의 계획 그대로.

## 2. Facts

**Beeper Desktop API — 오늘 재검증한 항목**
- `beeper.com/pricing` → HTTP 404 (2026-09-20 재확인). 여전히 가격 페이지가 존재하지 않는다. — UNVERIFIED(변화 없음)
- `beeper.com/faq` 전문에 "Desktop API"·"MCP" 언급 전혀 없음(2026-09-20 재확인). 언급되는 건 "Integrations that power all of our connections are open source"뿐. — VERIFIED(부재 확인)
- `beeper.com/faq`의 확정 가격: Beeper Free(계정 5개까지 무료), **Beeper Plus $9.99/월**(계정 최대 10개, send-later/reminder/incognito/음성노트 전사/커스텀 아이콘), **Beeper Plus Plus $49.99/월**(무제한 계정). 04가 인용한 "$30~49.99" 범위 중 $30 하한은 오늘도 어디서도 확인 안 됨 — **정정: $49.99 단일가만 확인됨.** — VERIFIED(2026-09-20 fetch)
- `beeper.com/desktop-api`(마케팅 페이지, docs와 별개) 원문: **"Download for free"**, 상태는 **"Public beta"**. 이는 "Beeper 앱 자체가 무료"라는 뜻이지 "Desktop API가 Plus 뒤에 게이트 안 됨"을 직접 증명하진 않지만, 유료 게이팅을 암시하는 문구는 어디에도 없다 — 무료일 가능성 쪽으로 증거가 더 쌓임. — VERIFIED(신규 확인, 2026-09-20)
- `developers.beeper.com/desktop-api-reference/`: 전송 엔드포인트는 `POST /v1/chats/{chatID}/messages` 하나로 전 네트워크 공통. Read-receipt는 `POST /v1/chats/{chatID}/read`, `POST /v1/chats/{chatID}/unread`. **문서 어디에도 "이 엔드포인트가 네트워크 X에서만 안 된다"는 예외 조항이 없다** — 즉 과제가 지적한 "네트워크별 전송 가능 여부 미문서화"는 오늘도 그대로 확인됨(read/mark-as-read도 동일하게 일반화돼 있어 write-back scope가 채널별로 다를 가능성을 문서가 부정도 긍정도 안 함). — VERIFIED(부재 확인, 2026-09-20)
- 실험적 WebSocket 신규 세부사항(04에 없던 내용, 오늘 직접 fetch): 접속 URL `ws://localhost:23373/v1/ws`, Bearer 토큰 인증, 이벤트 타입 4종(`chat.upserted`, `chat.deleted`, `message.upserted`, `message.deleted`), 구독은 `subscriptions.set` 하나로 전체 교체(증분 구독/해제 불가), "experimental and may change between desktop releases"라고 명시하며 latency/재연결/SLA 가이드는 전무. — VERIFIED(2026-09-20 fetch)
- `gh api search/repositories?q=org:beeper` 재조회: `beeper/linkedin`(Apache-2.0, archived 2025-03-17) 외에 **`beeper/linkedin-messaging-api`도 archived, 마지막 push 2023-12-12**(04에 없던 발견) — Beeper 자체가 LinkedIn 관련 레포를 두 번 만들고 두 번 다 방치했다는 뜻. 현재 살아있는 LinkedIn 경로는 `mautrix/linkedin` 하나뿐. — VERIFIED(2026-09-20, gh api)
- `beeper/cli`(TypeScript, 44 stars, 마지막 push 2026-06-04, open issues 27개)는 활발하진 않지만 죽지도 않은 상태 — 참고용 CLI 구현체로는 쓸 만하나 1차 SDK로 기대는 낮게. — VERIFIED(2026-09-20, gh api)

**LinkedIn 브릿지 버그 (06에서 이미 1차 확인된 것, 이 문서의 결정에 결정적)**
- `mautrix/linkedin` issue #55(2026-05-09 오픈, 상태 open): 로그인 후 ~20초 만에 `li_at` 쿠키가 삭제되어 세션 사망. LinkedIn이 재생된 세션을 도난으로 인식하는 것으로 추정. — CONFIRMED(1차 소스, `gh api repos/mautrix/linkedin/issues/55`)
- 수정 PR #61(2026-08-17 오픈, 상태 open, **미병합**): 작성자 본인이 "before the change, each login survived ~20 seconds" 라고 실측 명시. — CONFIRMED(1차 소스)
- 즉 **오늘(2026-09-20) 시점에도 이 버그는 미해결**이며, Beeper가 자사 LinkedIn 브릿지로 이 코드를 그대로 쓰고 있다면 Beeper Desktop API를 통한 LinkedIn 연동도 같은 결함의 영향권 안에 있을 가능성이 높다(Beeper가 별도 패치를 자체적으로 얹었는지는 UNVERIFIED — Beeper 앱 자체의 LinkedIn 연결 안정성은 Beeper 측 비공개 수정 여부에 달려 있어 이번 조사로 확정 불가).

**WhatsApp/Telegram — Beeper 내부 구현과 07의 독립 권고 사이의 실질적 리스크 중첩**
- Beeper의 WhatsApp 지원은 whatsmeow 계열 프로토콜(mautrix/whatsapp이 whatsmeow 기반, 04에서 이미 VERIFIED)을 쓴다. 07이 독립적으로 추천한 whatsmeow 사이드카와 **근본적으로 같은 프로토콜 계층을 사용** — Beeper를 통해 WhatsApp을 쓰든 자체 whatsmeow 사이드카를 짜든 ban 리스크의 근원(WhatsApp Web multi-device 리버스엔지니어링)은 동일하다. 차이는 "누가 그 코드를 유지보수하는가"뿐. — 이 문서의 논리적 추론(각 파일의 VERIFIED 사실을 조합), 새로운 1차 검증 아님.
- Telegram은 MTProto 기반이라는 점에서 유사한 구조지만, Telegram은 공식 `api_id` 발급 트랙이 있어(07, VERIFIED) 리스크 자체가 WhatsApp/LinkedIn보다 구조적으로 낮다 — Beeper를 거치나 mtcute를 직접 쓰나 리스크 차이는 미미하고, 차이는 "제어권"과 "회사 의존성"이다.

## 3. Options / 채널별 결정표

각 채널에 대해 "Beeper Desktop API를 1차로 쓴다" vs "해당 채널 리서치 파일이 권고한 전용 어댑터를 쓴다"를 결정한다. omnis의 7개 채널(Slack, KakaoTalk, Gmail, Outlook, Telegram, LinkedIn, WhatsApp) 기준.

| 채널 | Beeper 커버 | 전용 어댑터 대안(출처) | **결정** | Effort | Ban/ToS 리스크 | Write-back 범위(문서 기준) | Beeper 탈출 비용 |
|---|---|---|---|---|---|---|---|
| **WhatsApp** | O (whatsmeow 계열 내부 구현) | whatsmeow Go 사이드카(07) | **Beeper 1차 채택** — 같은 프로토콜이라 리스크 추가 없이 통합 비용만 S로 절감, 부수적으로 Instagram/Signal/Discord/X도 같은 통합으로 공짜로 딸려옴 | S(Beeper) / M(자체) | Medium, 회색지대(WhatsApp Web 리버스엔지니어링 자체가 리스크의 근원, 누가 코드를 짜든 동일) | 문서상 generic send+read/unread, LinkedIn과 달리 알려진 blocking 버그 없음 → 상대적으로 신뢰 가능하나 실측 전까진 UNVERIFIED-EMPIRICAL | M — Beeper가 쥔 device-linked 세션이라 exit 시 재페어링(QR 재스캔) 필요, 코드 자체는 whatsmeow로 그대로 이관 가능 |
| **Telegram** | O (MTProto 계열로 추정) | mtcute 네이티브 TS(07) | **mtcute 독립 채택, Beeper 배제** — Telegram은 이미 공식 `api_id` 트랙이 있어 ToS상 가장 안전한 채널인데, 굳이 회사 의존성(Beeper)을 얹을 이유가 없다. mtcute는 S–M effort, SQLite 세션 내장, 순수 TS로 omnis 스택과 직결 | S–M | Low(07의 결론 그대로) | mtcute 직접 구현이므로 read/send/markAsRead 전부 100% 통제·검증 가능 | 해당 없음(애초에 미채택) |
| **LinkedIn** | O이지만 **upstream 버그로 사실상 불안정**(mautrix/linkedin #55, 6월 넘게 미해결) | Playwright 상주 프로필(06) | **Playwright 독립 채택, Beeper 배제(지금은)** — omnis의 가장 민감한 채널(구직·비즈니스 커뮤니케이션)을 6개월째 안 고쳐진 20초-세션-사망 버그 위에 올릴 수 없다. #55/#61이 머지되고 Beeper가 실사용 안정성을 확인해주면 재검토 | M | Medium(06의 결론 그대로, 직접 통제 가능) | 06의 draft-then-approve 패턴으로 read+send 전부 구현 예정, read-receipt는 LinkedIn 자체가 상대에게만 보여주는 기능이라 별도 확인 필요(미조사) | 해당 없음(애초에 미채택) |
| **Slack** | O(generic) | Socket Mode + xoxp user token(08) | **Socket Mode+xoxp 독립 채택, Beeper 배제** — Slack은 이미 완전히 문서화된 공식 실시간 채널(Socket Mode)이 있고 openclaw의 매니페스트가 그대로 재사용 가능(S effort). Beeper의 generic 채팅 추상화보다 세분화된 스코프 제어(`search:read` 등)가 가능해 오히려 더 안전 | S | Low(08의 결론 그대로, user token 위임은 정상 OAuth) | Socket Mode 자체 구현이므로 read/send/mark-read 전부 직접 확인 가능 | 해당 없음(애초에 미채택) |
| **KakaoTalk** | X(공식 미지원, 커뮤니티 브릿지는 unmaintained+정지 리포트) | macOS Accessibility/로컬 DB 어댑터(04) | **자체 어댑터, 대안 없음** | M | Low(공식 클라이언트 그대로, 읽기 우선) | read 우선, send는 나중 단계 | 해당 없음 |
| **Gmail** | X(Beeper 범위 밖 — 채팅 전용) | watch()+Pub/Sub pull(08) | **08 계획 그대로, 이 갭과 무관** | M | Low | read/send/markRead 전부 Gmail API 표준 | 해당 없음 |
| **Outlook** | X | Graph API delta/webhook(08) | **08 계획 그대로, 이 갭과 무관** | S→M | Low | 동일 | 해당 없음 |

**정리**: 7개 채널 중 Beeper와 겹치는 건 4개(WhatsApp/Telegram/LinkedIn/Slack)뿐이고, 그중 실제로 Beeper를 쓰는 건 **WhatsApp 하나뿐**이다. 나머지 3개는 각 플랫폼의 공식/준공식 실시간 채널이 이미 Beeper보다 낫거나(Telegram/Slack), Beeper 쪽 구현 자체가 고장나 있다(LinkedIn). 04가 그린 "Beeper가 6개 채널을 S effort로 커버한다"는 큰 그림은 틀리지 않지만, omnis의 7채널 스코프에서 실질적으로 득을 보는 건 WhatsApp(+덤으로 Instagram/Signal/Discord/X) 하나로 좁혀진다.

## 4. Recommendation for omnis

**채택: 채널별 혼합(hybrid) 계층.** 단일 계층으로 통일하려던 전제 자체가 틀렸다 — Beeper는 "커버리지가 큰 하나의 벤더"이지 "가장 좋은 모든 채널의 구현"이 아니다. 채널마다 (a) 공식/준공식 실시간 API가 있는가, (b) Beeper의 해당 브릿지가 지금 안정적인가를 기준으로 따로 고른다.

- **WhatsApp = Beeper**. 이유는 §3에 정리한 대로 리스크 차이가 없고 통합 비용만 아낀다. 단, **문서가 네트워크별 전송 가능 여부를 확인해주지 않으므로(오늘 재확인해도 동일)**, 채택 전에 §5의 스파이크 테스트로 실제 send가 되는지 30분 안에 검증할 것. 안 되면 07의 whatsmeow 사이드카로 바로 폴백 — 코드 자산(프로토콜 계층)이 같으므로 전환 비용이 낮다.
- **Telegram = mtcute 독립 구현**. Beeper를 끼우는 게 오히려 손해(회사 의존성 추가, 이득 없음).
- **LinkedIn = Playwright 상주 프로필(06 그대로)**. Beeper 경로는 지금 당장은 배제 — `mautrix/linkedin#55`가 머지되고 최소 4주 이상 안정성이 확인된 뒤 재평가(open question으로 캘린더에 걸어둘 것).
- **Slack = Socket Mode+xoxp(08 그대로)**.
- **KakaoTalk/Gmail/Outlook**: 이 갭과 무관, 기존 파일의 계획 그대로 진행.

**effort 합산**: Beeper 통합(WhatsApp만, S) + mtcute(S–M) + Playwright(M) + Socket Mode(S) + Kakao 어댑터(M) + Gmail(M) + Outlook(S→M) ≈ 이전에 "Beeper가 전부 해결"이라고 가정했을 때보다 총 effort는 늘지만(4개 파일이 각자 권고한 걸 거의 다 살리므로), 각 채널의 리스크·제어권은 오히려 개선된다. Beeper 한 곳에 4개 채널을 몰아넣는 "단일 장애점+단일 회사 의존" 시나리오를 피했다는 게 이 hybrid 안의 핵심 이득.

**risk**: WhatsApp(Beeper 경유)은 ToS 회색지대(Medium, whatsmeow 계열 공통 리스크) — Beeper를 쓰든 안 쓰든 이 리스크는 없어지지 않는다. LinkedIn은 자체 구현이라도 Medium(06 그대로). 나머지는 Low.

## 5. What to borrow

- **Beeper의 `X-Forwarded-*` 기반 Remote Access 패턴**(04에서 이미 확인) — WhatsApp 채널 하나만 Beeper로 통합해도 이 Tailscale-friendly 노출 방식은 여전히 유효하게 재사용할 가치 있음.
- **Beeper WebSocket의 4-이벤트 모델**(`chat.upserted/deleted`, `message.upserted/deleted`) — omnis 내부 공통 `InboxEvent` 타입 설계 시 최소 이벤트 집합의 참고선으로 삼을 것(07이 이미 제안한 `connect/onEvent/sendMessage/markRead` 공통 어댑터 인터페이스와 정확히 부합).
- **`subscriptions.set`의 replace-only 구독 방식** — 증분 구독 관리 코드를 따로 안 짜도 되는 단순함이 있다. omnis 자체 이벤트 버스에도 "구독 목록은 매번 전체 교체"가 상태 관리 버그를 줄이는 실용적 선택일 수 있음(참고할 만한 단순화).
- **06의 draft-then-approve 패턴** — Beeper 없이 LinkedIn을 직접 만들 경우 그대로 적용.
- **openclaw Slack manifest**(08에서 이미 확인) — Socket Mode+xoxp 구현의 시작점.

## 6. Open questions

- **WhatsApp/LinkedIn 실제 send가 Beeper Desktop API로 되는지** — 문서로는 끝내 확인 못함(오늘도 동일). §4의 스파이크 테스트를 진호님이 직접 수행해야 닫히는 질문.
- **Beeper의 LinkedIn 연결이 `mautrix/linkedin#55` 버그의 영향을 받는지** — Beeper 앱이 자체 패치를 별도로 얹었을 가능성이 있어 미확정. 실사용 계정으로 로그인 시도해서 20초 넘게 세션이 유지되는지 직접 확인 필요.
- **Desktop API가 Plus/Plus Plus 뒤에 게이트돼 있는지** — `beeper.com/desktop-api`의 "Download for free" 문구는 앱 다운로드를 말하는 것일 수 있어 API 자체의 게이팅과는 별개일 수 있음. 무료 계정으로 토큰 발급을 실제로 시도해야 닫힘.
- **실험적 WebSocket이 G1(5초 목표) latency를 만족하는지** — 문서에 수치가 전혀 없어 실측 외엔 답이 없음.
- **LinkedIn read-receipt(상대가 읽음 표시) write-back이 애초에 LinkedIn 플랫폼상 가능한 개념인지** — 06/이 문서 둘 다 조사 안 함, LinkedIn 자체 UX 재확인 필요.

## 7. Sources

- [beeper.com/pricing](https://www.beeper.com/pricing) — HTTP 404, fetched 2026-09-20
- [beeper.com/faq](https://www.beeper.com/faq) — fetched 2026-09-20
- [beeper.com/desktop-api](https://www.beeper.com/desktop-api) — fetched 2026-09-20
- [developers.beeper.com/desktop-api/](https://developers.beeper.com/desktop-api/) — fetched 2026-09-20
- [developers.beeper.com/desktop-api-reference/](https://developers.beeper.com/desktop-api-reference/) — fetched 2026-09-20
- [developers.beeper.com/desktop-api/mcp/](https://developers.beeper.com/desktop-api/mcp/) — fetched 2026-09-20
- [developers.beeper.com/desktop-api/websocket-experimental](https://developers.beeper.com/desktop-api/websocket-experimental) — fetched 2026-09-20
- `gh api search/repositories?q=org:beeper` — fetched 2026-09-20
- `gh api repos/beeper/cli` — fetched 2026-09-20
- `gh api repos/mautrix/linkedin/issues/55`, `gh api repos/mautrix/linkedin/pulls/61` — 원출처는 `06-channel-linkedin.md`의 2026-09-20 검증, 이 문서에서 재인용
- 기반 리서치(이 문서가 종합·재구성한 원본): `research/04-beeper-matrix-bridges.md`, `research/06-channel-linkedin.md`, `research/07-channel-whatsapp-telegram.md`, `research/08-channel-slack-email-calendar.md`, `research/90-critique.md` (전부 2026-09-20 작성)
