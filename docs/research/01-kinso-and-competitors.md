# Kinso 티어다운 + 경쟁사 지형 (2026-09-20 리서치)

## 1. TL;DR

Kinso는 Frank/Jacques Greeff 형제($180M exit 이력)가 만드는 waitlist 단계 unified inbox로, Gmail·Slack·LinkedIn·WhatsApp·Instagram을 하나의 타임라인에 합치고 morning briefing, tone-matched AI draft, universal search, cross-channel "contextual assistant"(관련 대화 자동 연결)를 제공한다. 공식 페이지엔 가격이 없고(pricing 서브페이지 404), 서드파티 블로그들이 제시한 가격($29~59/월)은 서로 모순되어 전부 UNVERIFIED다. API 없는 채널(WhatsApp/LinkedIn) 캡처 메커니즘은 공식적으로 공개되지 않음 — omnis의 맥미니 허브 접근(Accessibility automation)이 사실상 유일한 실전 전례다. 경쟁사 중 Beeper(Automattic, Texts 합병)가 채널 커버리지 최고, Shortwave/Superhuman은 AI draft UX 성숙도 최고, Unipile은 WhatsApp/LinkedIn API-less capture의 상용 레퍼런스다. omnis는 kinso의 레이아웃/톤을 참고하되, 가격·아키텍처는 독자 설계해야 한다.

## 2. Facts

**Kinso 제품**
- Kinso는 "One inbox, every conversation"를 내세우며 Gmail(명시), WhatsApp, Slack, LinkedIn을 통합. VERIFIED — [kinso.ai](https://www.kinso.ai/) (2026-09-20 fetch).
- 서드파티 기사들은 여기에 Instagram, TikTok까지 추가로 언급. UNVERIFIED (공식 페이지에 없음) — [thisandthat.chat 리뷰](https://www.thisandthat.chat/blog/kinso-review/), [Grit Daily](https://gritdaily.com/hunt-for-unified-box-why-kinso-may-finally-nail-it/) (2026-09-20 fetch).
- 핵심 기능 4개: DRAFT RESPONSE(톤 매칭 자동 답장), 아침 브리핑(중요 메시지·액션아이템 요약), UNIVERSAL SEARCH(자연어 전 채널 검색), CONTEXTUAL ASSISTANT(채널 간 관련 대화 자동 연결). VERIFIED — [kinso.ai](https://www.kinso.ai/).
- 서드파티 소스는 추가로 "Smart Contacts"(연락처별 전 채널 요약 히스토리), 음성 인터페이스(핸즈프리 브리핑/답장), "opportunity stack" 랭킹(도착순이 아닌 비즈니스 임팩트순)을 언급. UNVERIFIED — [thisandthat.chat](https://www.thisandthat.chat/blog/kinso-review/), [VentureBeat](https://venturebeat.com/business/cracking-the-universal-inbox-inside-kinsos-quest-to-make-cross-channel-ai) (2026-09-20 fetch).
- 창업자 Frank/Jacques Greeff는 이전 회사(Realbase로 추정, 기사에 사명 명시 없음)에서 $180M exit. Kinso는 pre-seed 자가/엔젤 자금으로 시작, 정확한 라운드 금액 미공개. VERIFIED (창업자 배경) / UNVERIFIED (정확 펀딩 액수) — [Grit Daily](https://gritdaily.com/hunt-for-unified-box-why-kinso-may-finally-nail-it/), [WebSearch 요약](https://www.linkedin.com/in/jacques-greeff/) (2026-09-20 fetch).
- 2025-09-25 기준 waitlist 단계, 11,000~23,000명 대기 (소스마다 숫자 상이). UNVERIFIED — [Medium](https://medium.com/@theventurecation/over-11-000-waitlist-for-one-universal-inbox-the-hype-behind-100m-ai-platform-kinso-06afb108365b), [thisandthat.chat](https://www.thisandthat.chat/blog/kinso-review/).
- 가격: kinso.ai/pricing은 404. 서드파티 블로그 간 수치 모순 — 한 곳은 "$59/월, 무제한 이메일+메신저 연동"(창업자 인용 주장), 다른 곳은 "$35/월 또는 연간 $29/월, 3,000 크레딧, 30일 무료"라고 주장. 두 숫자 다 1차 소스 미확인, 서로 다른 과금 모델(구독형 vs 크레딧형)이라 신뢰도 낮음. UNVERIFIED, CONFLICTING — [thisandthat.chat pricing](https://www.thisandthat.chat/blog/kinso-pricing/), [WebSearch 요약](https://useconverge.app/pricing/kinso) (2026-09-20 fetch).
- 플랫폼(Mac/iOS/Web) 여부는 1차 소스에서 확인 불가. 검색 결과에 `kinso-site.webflow.io`라는 별도 대기 페이지와 Instagram 계정(@kinso.app)만 확인됨 — 네이티브 앱 존재 근거 없음. UNVERIFIED — WebSearch (2026-09-20).
- API-less 채널(WhatsApp, LinkedIn) 캡처 메커니즘은 어느 소스에도 구체적으로 설명되어 있지 않다("native APIs"라고만 언급, QR 세션인지 unofficial protocol인지 불명). UNVERIFIED — [thisandthat.chat](https://www.thisandthat.chat/blog/kinso-review/).
- 비주얼 디자인: 1차 페이지 텍스트 추출로는 레이아웃/타이포/컬러/모션 디테일을 얻지 못함(마케팅 카피 위주 랜딩). 스크린샷 기반 실사 분석이 필요 — 이번 텍스트 fetch로는 UNVERIFIED. 후속 작업으로 브라우저 스크린샷 필요.

**경쟁사 (2026-09-20 기준, WebSearch 요약 — 각 사 공식 페이지 직접 fetch는 미실시, 대부분 서드파티 pricing 블로그 교차 확인)**
- Superhuman: Starter $30/월, Business $40/월, Enterprise 별도. AI Replies/Summarize/Auto Labels/Instant Reply, Gmail+Outlook. VERIFIED-ish (다수 소스 일치) — [Morgen](https://www.morgen.so/blog-posts/superhuman-pricing), [Capterra](https://www.capterra.com/p/199278/Superhuman/) (2026-09-20).
- Shortwave: Business $24/seat, Premier $36, Max $100(월, 연간 청구). Gmail/Google Workspace 전용, Outlook 미지원. VERIFIED-ish — [faraday.email](https://faraday.email/blog/shortwave-pricing-2026), [get-alfred.ai](https://get-alfred.ai/blog/shortwave-pricing) (2026-09-20).
- Notion Mail: Notion AI로 auto-label/tone draft/스케줄링, Gmail 전용. **2026-09-22에 standalone Notion Mail(web/desktop/iOS) 서비스 종료 예정** — omnis 설계 시 반면교사(플랫폼 결합 리스크). VERIFIED — [TechCrunch 원 공지](https://techcrunch.com/2025/04/15/notion-releases-its-ai-driven-email-inbox), [Wysor](https://wysor.io/alternatives/notion-mail) (2026-09-20).
- Unipile: LinkedIn/WhatsApp/Instagram/Telegram/Email(Gmail·Outlook·IMAP)+캘린더를 단일 REST API로 통합. QR 인증, Meta 파트너 불필요. 가격 €49/월(계정 10개까지)+계정당 €3~5/월. LinkedIn은 unofficial(계정 정지 리스크 명시). VERIFIED — [unipile.com/pricing-api](https://www.unipile.com/pricing-api/) (2026-09-20).
- Beeper (Automattic, ex-Texts.com 병합): Automattic이 Beeper $125M(2024), Texts.com $50M(2023)에 인수, 2025년 합병 후 2026년 기준 "99% 통합". WhatsApp/Instagram/Messenger/X/Telegram/Signal/Matrix/Slack/Google Chat/Discord/LinkedIn/Google Messages 지원. On-device 모델로 리론치, 무료+프리미엄(더 많은 계정, 리마인더, 예약전송, incognito, AI 음성메모 텍스트화). VERIFIED — [TechCrunch](https://techcrunch.com/2025/07/16/beepers-all-in-one-messaging-app-relaunches-with-an-on-device-model-and-premium-upgrades/), [Wikipedia](https://en.wikipedia.org/wiki/Beeper_(software)) (2026-09-20).
- Missive: Starter $14, Productive $24, Business $36/유저/월(연간). 이메일+SMS+소셜, 실시간 2-way sync, 코멘트/공동초안 전 티어 포함. VERIFIED-ish — [missiveapp.com 비교](https://missiveapp.com/compare/frontapp-vs-missive) (2026-09-20).
- Front: Starter $25, Professional $65, Enterprise $105/시트/월. 티켓팅+지식베이스+음성+AI 풀세트, 고객운영 플랫폼에 가까움(개인 인박스보다 팀 헬프데스크). VERIFIED-ish — [hiverhq.com](https://hiverhq.com/blog/front-vs-missive) (2026-09-20).
- Spike: 채팅형 이메일 UI + 노트/화상통화/커스텀도메인 이메일 번들. 소규모 팀 대상. UNVERIFIED (가격 미확인) — [get-alfred.ai](https://get-alfred.ai/blog/best-spike-alternatives) (2026-09-20).
- 2025-2026 "AI 비서/unified inbox" 신생: Upstream(pre-seed $3M, 이메일을 사람+에이전트 협업 워크스페이스로 재정의), alfred_(triage+calendar+task+daily brief 올인원), Fambot(가정용 AI chief of staff). UNVERIFIED (펀딩 숫자 외 세부 미확인) — [MediaPost](https://www.mediapost.com/publications/article/415633/meet-me-in-the-inbox-startup-says-it-can-unite-ai-email-in-one-place.html), [TechCrunch](https://techcrunch.com/2026/09/01/fambot-introduces-an-ai-chief-of-staff-for-families/) (2026-09-20).

**omnis에 직접 관련된 API-less 채널 캡처 레퍼런스 (GitHub, `gh repo view`로 실존 확인함)**
- [`silver-flight-group/kakaocli`](https://github.com/silver-flight-group/kakaocli) — ★153. KakaoTalk 로컬 DB 읽기 + macOS Accessibility API로 UI 자동화 송신. AI 에이전트용 JSON 출력, MCP skill 정의, webhook. 서버 로그인/프로토콜 리버스엔지니어링 없음. 2026-09-18 업데이트, 활성. VERIFIED (repo 존재·메타데이터).
- [`JungHoonGhae/openkakao-cli`](https://github.com/JungHoonGhae/openkakao-cli) — ★123. "server login이 최근 빌드에서 깨짐" → local-send/ax-read(Accessibility 트리 읽기)로 우회. 2026-09-03 push. VERIFIED.
- [`twoimo/openkakao-bot`](https://github.com/twoimo/openkakao-bot) — ★0(신규). 로컬 DB 컨텍스트 + 선호 LLM으로 답장 초안, on-device 전용(크리덴셜 미유출 주장). 2026-09-19 push, 매우 최신·미검증 코드. VERIFIED (존재) / UNVERIFIED (안정성).
- [`block/buzz`](https://github.com/block/buzz) — ★33,695, "A hive mind communication platform", 2026-09-19 업데이트. Block(옛 Square)이 미는 멀티 에이전트 통신 레이어로, Logan 브리프에서 직접 지목한 레퍼런스. VERIFIED — omnis의 "에이전트 세션 = 인박스 스레드" 설계에 아키텍처 참고할 것.

## 3. 비교 표

| 축 | Kinso | Superhuman | Shortwave | Notion Mail | Beeper (Automattic) | Unipile | Missive/Front | omnis 시사점 |
|---|---|---|---|---|---|---|---|---|
| 채널 폭 | Gmail+Slack+LinkedIn+WhatsApp(+IG 주장) | Gmail/Outlook만 | Gmail만 | Gmail만 | 12개+ 메신저(최광) | LinkedIn/WhatsApp/IG/Telegram/Email(API 레이어) | 이메일+SMS+소셜(팀용) | 채널 폭은 Beeper·Unipile이 실전 최강 |
| AI draft 성숙도 | 주장만, UX 미검증 | 최고 수준(수년 다듬음) | 높음(계층별 쿼터) | 낮음("generic"이라는 비판) | 낮음(주로 캡처/라우팅) | 없음(API 레이어라 UI 없음) | 낮음~중간 | Superhuman/Shortwave의 draft UX를 벤치마크 |
| API-less 캡처 | 메커니즘 비공개 | 해당없음 | 해당없음 | 해당없음 | 자체 브리지(다수 프로토콜 리버스엔지니어링, 계정정지 이력 있음) | 상용 API, QR 세션, LinkedIn unofficial(ToS 리스크 명시) | 해당없음 | 맥미니 상시가동 + kakaocli류 Accessibility 자동화가 가장 현실적 |
| 플랫폼 | 불명(웹 대기페이지만 확인) | Mac/Win/iOS/Android/Web | Web/Mac/iOS/Android | Web/Desktop/iOS(9/22 종료) | Mac/Win/iOS/Android/Web | API only(자체 UI 없음) | Web/Mac/Win/iOS | omnis는 Mac 앱 + iOS 필수, web은 후순위 가능 |
| 가격 모델 | 불명/모순 | $30~40/월 구독 | $24~100/월 구독 | Notion 요금제 내 포함(종료됨) | 무료+프리미엄 | 계정당 종량제(€3~5) | 시트당 $14~105 | 1인 솔로 founder엔 종량제(Unipile식)가 예산 관리에 유리 |
| ToS/계정정지 리스크 | 불명 | 낮음(공식 API) | 낮음(공식 API) | 낮음(공식 API) | 있음(과거 WhatsApp/iMessage 브리지 이슈) | 있음(LinkedIn explicitly unofficial) | 낮음 | KakaoTalk/LinkedIn 자동화는 리스크를 안고 가는 설계가 불가피 |

## 4. Recommendation for omnis

**채널 캡처 아키텍처**: 공식 API가 있는 채널(Gmail, Outlook, Slack, Telegram, Google Calendar)은 각각 공식 API로 붙인다 — effort **S**, risk 낮음. WhatsApp은 Meta Business API(제한적, effort **M**, risk 중간·정책변경 리스크) 또는 whatsapp-web.js류 unofficial(effort S, risk 높음·밴 리스크)을 저울질해야 하는데, 개인 1계정 용도면 unofficial 쪽이 현실적이다. KakaoTalk과 LinkedIn은 API가 아예 없거나(카카오) unofficial만 존재(LinkedIn)하므로, Logan의 브리프대로 **맥미니에 상주 앱 + Accessibility 자동화**로 갈 수밖에 없다 — effort **M**(카카오톡은 kakaocli 포크/직접 구현), risk **높음**(ToS 위반 소지, 계정 정지 시 복구 어려움; Kakao는 국내 서비스라 정책 변화 예측 어려움). 이 리스크는 Logan에게 명시적으로 알리고 진행해야 한다.

**AI draft/브리핑 UX**: kinso의 "톤 매칭 draft + morning briefing + contextual linking" 3종 세트를 그대로 목표 기능셋으로 채택하되, UX 완성도는 Superhuman(Instant Reply, Split Inbox)과 Shortwave(계층형 AI 쿼터, bundle 정리)를 구현 디테일 레퍼런스로 삼는다. effort **M**, risk 낮음(순수 프로덕트 작업).

**에이전트 세션 = 인박스 스레드 설계**: `block/buzz`(★33.7k, hive-mind 통신 플랫폼)를 아키텍처 스파이크로 먼저 읽어라 — Claude Code/Codex/DeepSeek/Hermes 세션을 인박스 스레드처럼 다루는 melody가 이미 거기 있다. omnis 자체 구현 전에 buzz의 메시지 스키마·세션 브릿지 패턴을 grep해서 재사용 가능한 부분(메시지 프로토콜, 세션 핸드오프)을 먼저 확인. effort **S**(조사) → **M**(통합).

**가격/포지셔닝**: kinso 가격은 신뢰할 수 없으니 벤치마크로 쓰지 말 것. omnis는 1인 전용 제품이라 가격 설계 자체가 필요 없다 — 대신 Unipile의 "계정당 종량제" 사고방식을 인프라 비용 관리(어떤 채널을 몇 개 계정 연결하는지)에 적용해 OpenRouter/Gateway 토큰 비용을 추적하는 게 더 유의미하다.

**Notion Mail의 교훈**: 대형 플랫폼(Notion)조차 6개월 만에 이메일 클라이언트를 접었다 — 단일 벤더 종속(Gmail-only, 특정 SDK 종속)을 피하고 채널 어댑터를 교체 가능하게 설계해야 한다는 직접적 반면교사다.

## 5. What to borrow

- **레이아웃/카피 톤**: kinso.ai 홈페이지의 기능명 대문자 라벨링 패턴("DRAFT RESPONSE", "UNIVERSAL SEARCH", "CONTEXTUAL ASSISTANT") — omnis 랜딩/온보딩 카피에 이 네이밍 관습을 차용 가능. 단, 실제 비주얼(레이아웃 그리드, 타이포 스케일, 모션)은 이번 텍스트 fetch로 확인 못 했으므로 스크린샷 기반 재조사가 필요함 (다음 스텝으로 `mcp__Claude_Browser` 또는 `claude-in-chrome`으로 kinso.ai 방문해 실측 권고).
- **에이전트-세션-as-인박스-스레드 아키텍처**: `block/buzz` (https://github.com/block/buzz) 코드베이스를 클론해 메시지 라우팅/세션 핸드오프 스키마를 GitNexus로 인덱싱 후 재사용 패턴 추출.
- **KakaoTalk 캡처 구현 스타팅포인트**: `silver-flight-group/kakaocli`(로컬 DB 읽기 + AX 자동화, MCP skill 정의 포함, JSON 출력이라 omnis 에이전트 파이프라인에 바로 꽂기 좋음)와 `JungHoonGhae/openkakao-cli`(서버로그인 없는 대안 경로)를 나란히 포크/비교해서 더 안정적인 쪽을 맥미니 상주 프로세스로 채택.
- **WhatsApp/LinkedIn/Telegram 통합 레이어**: 직접 unofficial 프로토콜을 리버스엔지니어링하는 대신 Unipile API(€49/월~) 도입을 1차 옵션으로 검토 — 개발 리소스를 아끼는 대신 월 고정비 지불, ToS 리스크는 Unipile 쪽으로 이전됨(단 LinkedIn은 여전히 unofficial이라 최종 리스크는 완전히 없어지지 않음).
- **Beeper의 on-device 리론치 방향**: 크리덴셜/메시지를 클라우드에 안 올리고 로컬에서 브리지하는 아키텍처 — omnis의 "맥미니 허브, 아이폰/맥북 클라이언트" 구조와 철학적으로 일치하므로 Beeper 릴리즈 노트/블로그(TechCrunch 기사 링크)를 프라이버시 설계 참고자료로 사용.
- **Notion Mail의 뷰/DB 은유**: 이메일을 Notion 데이터베이스처럼 view로 다루는 방식(라벨·필터·프로젝트 연결)은 서비스가 종료돼도 패턴 자체는 유효 — omnis의 work/personal 자동 필터, 주제별 auto-label 기능 설계 시 뷰 개념을 참고.

## 6. Open questions

- kinso.ai의 실제 비주얼 디자인(레이아웃/타이포/모션)은 텍스트 fetch로 확인 불가 — 브라우저 스크린샷 기반 실사가 별도로 필요함.
- kinso의 API-less 채널 캡처가 Beeper식 프로토콜 브리지인지, WhatsApp Business API 재판매인지, 아니면 QR 세션(Unipile식)인지 공식적으로 확인된 바 없음.
- Kakao/LinkedIn Accessibility 자동화의 실제 계정 정지 사례(빈도, 트리거 조건)에 대한 데이터가 부족 — `kakaocli`/`openkakao-cli` 이슈 트래커를 뒤져 실제 사용자 리포트를 확인해야 함.
- Unipile을 쓸 경우 카카오톡은 여전히 커버되지 않음(Unipile 목록에 KakaoTalk 없음) — 카카오톡만 별도 트랙으로 갈지, 전면 자체 구현할지 결정 필요.
- omnis가 목표로 하는 "맥미니 없는 standalone" 미래 시나리오에서 Accessibility 자동화 기반 캡처가 기술적으로 유지 가능한지(아이폰 단독으로는 불가능) 별도 검토 필요.

## 7. Sources

- https://www.kinso.ai/ (2026-09-20)
- https://www.thisandthat.chat/blog/kinso-review/ (2026-09-20)
- https://www.thisandthat.chat/blog/kinso-pricing/ (2026-09-20)
- https://venturebeat.com/business/cracking-the-universal-inbox-inside-kinsos-quest-to-make-cross-channel-ai (2026-09-20)
- https://gritdaily.com/hunt-for-unified-box-why-kinso-may-finally-nail-it/ (2026-09-20)
- https://medium.com/@theventurecation/over-11-000-waitlist-for-one-universal-inbox-the-hype-behind-100m-ai-platform-kinso-06afb108365b (2026-09-20)
- https://useconverge.app/pricing/kinso (2026-09-20)
- https://www.linkedin.com/in/jacques-greeff/ (2026-09-20)
- https://www.morgen.so/blog-posts/superhuman-pricing (2026-09-20)
- https://www.capterra.com/p/199278/Superhuman/ (2026-09-20)
- https://faraday.email/blog/shortwave-pricing-2026 (2026-09-20)
- https://get-alfred.ai/blog/shortwave-pricing (2026-09-20)
- https://techcrunch.com/2025/04/15/notion-releases-its-ai-driven-email-inbox (2026-09-20)
- https://wysor.io/alternatives/notion-mail (2026-09-20)
- https://www.unipile.com/pricing-api/ (2026-09-20)
- https://techcrunch.com/2025/07/16/beepers-all-in-one-messaging-app-relaunches-with-an-on-device-model-and-premium-upgrades/ (2026-09-20)
- https://en.wikipedia.org/wiki/Beeper_(software) (2026-09-20)
- https://missiveapp.com/compare/frontapp-vs-missive (2026-09-20)
- https://hiverhq.com/blog/front-vs-missive (2026-09-20)
- https://get-alfred.ai/blog/best-spike-alternatives (2026-09-20)
- https://www.mediapost.com/publications/article/415633/meet-me-in-the-inbox-startup-says-it-can-unite-ai-email-in-one-place.html (2026-09-20)
- https://techcrunch.com/2026/09/01/fambot-introduces-an-ai-chief-of-staff-for-families/ (2026-09-20)
- https://github.com/silver-flight-group/kakaocli (2026-09-20, verified via `gh repo view`)
- https://github.com/JungHoonGhae/openkakao-cli (2026-09-20, verified via `gh repo view`)
- https://github.com/twoimo/openkakao-bot (2026-09-20, verified via `gh repo view`)
- https://github.com/block/buzz (2026-09-20, verified via `gh repo view`, ★33,695)
