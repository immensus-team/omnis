# 25 — GAP 6: Kakao device-session rule & standalone (hub-less) degradation plan

Fetched 2026-09-20. WebSearch was exhausted session-wide before this pass started (confirmed again on the first query). All primary-source facts below come from direct `curl`/WebFetch of Kakao's own domains (talksafety.kakao.com, cs.kakao.com, kakao.com/policy, kakaocorp.com) — these are server-rendered Next.js pages, fetchable without a browser. `cs.kakao.com`'s FAQ article bodies (category 1056, "PC/태블릿/워치 이용") load via client-side JS after page load and could not be retrieved by `curl`; that specific gap needs a real browser or the user opening the page.

## 1. TL;DR (한국어)

카카오는 PC/Mac/태블릿/워치를 공식적으로 "서브 디바이스"로 부르고, sub-device 연결에는 매번 모바일에 뜨는 4자리 보안 인증번호나 카카오 인증서가 필요하다는 것까지는 카카오 1차 소스로 확인했다(VERIFIED). 하지만 "모바일 1대+PC 1대만 동시 허용"이라는 정확한 숫자 제한은 이번 패스에서도 1차 소스를 못 찾았다(UNVERIFIED, 05/90과 동일). 대신 더 중요한 새 사실 하나를 확인했다: 카카오의 공식 안티어뷰징 정책(talksafety.kakao.com/measure)이 "PC 에뮬레이터 등 비정상적인 환경에서 카카오톡 사용"을 이용제한 트리거로 명시한다 — Android 에뮬레이터 경로는 슬롯 문제와 별개로 정책상 이미 위험 신호다. WhatsApp(1폰+링크된 기기 4대, 공식 확인됨)·Telegram(다중 세션 정상 지원)은 기기 이동이 싸지만, KakaoTalk·LinkedIn은 여전히 "상시 켜진 한 기기"가 세션을 들고 있어야 한다. G6는 7채널 전체가 아니라 5채널+에이전트+캘린더로 재정의해야 한다.

## 2. Facts

- **KakaoTalk 운영정책 시행일**: 공고일 2025-11-06, 시행일 2025-12-06. VERIFIED. Source: https://talksafety.kakao.com/policy (fetched 2026-09-20).
- **PC/Mac/태블릿/워치는 공식적으로 "서브 디바이스"**이며, 연결에는 "PC, Mac 등 서브 디바이스 버전 이용을 위한 4자리 보안 인증번호(카카오 인증서 미발급 시)"가 필요하다 — 이는 모바일에서 매번 확인하는 별도 인증 절차다. VERIFIED, 1차 소스 공식 문구. Source: https://talksafety.kakao.com/toolandguide/account (fetched 2026-09-20).
- **이용자보호조치(자동감지) 적용 시 제한 항목 중 하나가 "카카오톡 PC 버전 등 서브디바이스 사용 불가"** — sub-device 자체가 제재 대상이 될 수 있다는 뜻. VERIFIED. Source: https://talksafety.kakao.com/measure (fetched 2026-09-20).
- **"PC 에뮬레이터 등 비정상적인 환경에서 카카오톡을 사용하는 경우"가 안티어뷰징 시스템이 감지하는 비정상 이용패턴 목록에 명시적으로 포함**된다. VERIFIED, 신규 발견(05/90 시점엔 미확인). Source: https://talksafety.kakao.com/measure (fetched 2026-09-20). 이 문구는 05가 배제한 "Android 에뮬레이터" 경로를 "모바일 슬롯 충돌" 논리가 아니라 카카오 자체 정책 문구로 직접 뒷받침한다 — 슬롯 숫자를 몰라도 이 경로는 정책상 위험하다.
- **역분석(reverse engineering)·비공식 프로토콜/API 호출·"봇, 매크로, 웹사이트 등" 무단 개발·배포는 명시적으로 금지되며, 확인 시 즉시 한시적 또는 영구적 전체 서비스 이용제한이 가능**하다. VERIFIED. Source: https://talksafety.kakao.com/policy/stability/abnormalusage (fetched 2026-09-20). LOCO 재구현(node-kakao)은 이 조항에 정확히 걸린다(05의 배제 판단이 1차 소스로 재확인됨). kmsg(macOS Accessibility API 기반)는 프로토콜/API를 직접 호출하지 않으므로 이 조항의 문언에 정확히 걸리진 않지만, 조항 앞부분의 "이용환경 및 이용패턴 분석을 통해 확인 시" 문구는 자동화 패턴 전반을 포괄할 여지가 있다 — 회색지대로 남는다.
- **계정 정보(비밀번호, SMS 인증번호 등)의 거래·양도·대여·공유는 명시적으로 금지**되며, 확인 시 영구 제한 가능. VERIFIED. Source: https://talksafety.kakao.com/policy/stability/accountintegrity (fetched 2026-09-20). 이는 "iPhone과 다른 기기가 같은 계정을 나눠 쓰는 것" 자체를 금지하는 게 아니라 "타인에게" 넘기는 행위를 금지하는 조항이다 — omnis의 1인-소유 다중기기 사용과는 무관.
- **"모바일 1대+PC/태블릿 1대만 동시 로그인 허용"이라는 정확한 숫자 제한은 1차 소스에서 재확인 실패** — 이번 패스에서 카카오계정 이용약관(kakao.com/policy/terms), 카카오 통합서비스약관(kakao.com/policy/terms?type=ts), 카카오 운영정책(kakao.com/policy/oppolicy), talksafety.kakao.com/toolandguide/account/auth, /policy/stability/*, cs.kakao.com 고객센터 첫 화면을 모두 확인했으나 어디에도 "1대"라는 숫자가 없다. cs.kakao.com은 카테고리 1056("PC/태블릿/워치 이용")까지는 도달했지만 실제 FAQ 글 목록은 클라이언트 JS로 로드되어 `curl`로는 못 읽었다 — 이 부분은 브라우저로 직접 열어야 확정 가능. UNVERIFIED, carried forward.
- **cs.kakao.com 고객센터 KakaoTalk 서비스(service=8)는 "PC/태블릿/워치 이용"이라는 전용 카테고리(categoryId 1056)를 갖고 있고, 하위 카테고리는 PC(Win/Mac)/태블릿·iPad/스마트워치로 나뉜다** — 카카오 자신도 이 셋을 병렬적인 "서브 디바이스 타입"으로 취급한다는 구조적 근거. VERIFIED (카테고리 구조), 실제 FAQ 본문은 UNVERIFIED.
- **WhatsApp은 "1 phone + up to 4 linked devices"를 공식 지원**한다(faq.whatsapp.com, 07 파일에서 이미 1차 소스로 확인·adversarial pass 통과). VERIFIED (07 인용, 이번 패스에서 재확인은 안 했지만 07의 검증 수준을 신뢰). 이는 Kakao의 "sub-device 1개" 추정 모델보다 구조적으로 훨씬 유연하다 — 기기를 옮겨도 새 linked-device 슬롯 하나를 더 쓰는 것뿐, 기존 슬롯을 안 건드린다.
- **whatsmeow의 QR 페어링 세션은 약 160초 제한**이며 재발급 가능. VERIFIED (07 인용). 기기 이전 시 재인증 비용이 작다는 근거.
- **Telegram MTProto user-account는 공식 api_id 경로로 다중 세션이 정상 지원되는 ToS 준수 경로**이며 ban 리스크가 WhatsApp보다 낮다(07 파일, VERIFIED). 세션 파일(SQLite, mtcute 내장) 복사로 기기 이전이 가능하다.
- **omnis 자체 메시지 저장소는 SQLCipher로 암호화하는 것이 15의 기존 권고**이며, 현재 설계는 키가 맥미니 한 곳에만 있으면 되는 걸 전제한다; 허브가 맥북으로 이동하거나 두 기기가 번갈아 허브가 되면 "SQLCipher 키를 여러 기기 간 어떻게 배포/동기화할지"가 새로 생기는 미해결 문제라고 15 스스로 명시한다. VERIFIED (15 §4, 기존 리서치 재확인).
- **13의 Zero(Rocicorp)+TailscaleKit sync 설계는 허브가 맥미니의 Postgres에서 맥북 내장 Postgres/SQLite로 바뀌어도 client-server 프로토콜과 tsnet 노드 개념이 그대로 유지**된다고 명시한다(13 §6, "나중(맥미니 없는 순수 로컬) 전환 비용"). VERIFIED (기존 리서치 재확인). 단, 이건 "코어 로직과 캘린더/API 채널"의 이야기이고 KakaoTalk/LinkedIn 세션 이전 비용과는 별개다.

## 3. Options / comparison — where does the KakaoTalk/LinkedIn capture session live?

| 옵션 | 설명 | Hub-less 부합도 | 재인증 비용 | Effort | Risk |
|---|---|---|---|---|---|
| A. Mac mini 고정 (현행) | 미니가 24/7 KakaoTalk.app/LinkedIn 세션 유지 | 낮음(명백한 허브) | 없음(안정 상태 유지) | S(이미 구축됨) | ToS/ban 리스크만(05/06/15 기존 평가) |
| B. MacBook으로 전환 후 고정 | 맥북이 대신 상시 세션을 들고 있음 | 중간(허브가 맥북으로 이동했을 뿐, 개념은 동일) | sub-device 재인증 1회(4자리 코드/Kakao 인증서) + WhatsApp linked-device 재QR | S~M | 맥북 슬립/이동 시 capture gap(노트북은 미니처럼 상시전원이 아님) |
| C. iPhone에서 캡처 | 모바일에서 직접 자동화 | 불가능 | N/A | N/A | iOS 앱 샌드박스가 Accessibility 기반 타사 앱 제어를 근본적으로 허용하지 않음(카카오톡 자체 앱은 이미 "모바일 슬롯"으로 쓰이는 중이라 이중 역할도 불가) |
| D. 클라우드 macOS 인스턴스(MacStadium 등) | 항상 켜진 가상 Mac에 세션 고정 | 낮음(또 다른 고정 호스트일 뿐, "hub" 명칭만 바뀜) | 이전 시 1회 | L | 비용 발생(브리프의 cost-sensitive 원칙과 상충), 신규 인프라 유지보수 |
| **E. "capture host" 재정의(권장)** | 미니(또는 나중엔 맥북)를 "hub"가 아니라 "KakaoTalk/LinkedIn 캡처 전용 상시 노드"로 재명명, 나머지 5채널+에이전트+캘린더만 진짜 hub-less로 설계 | G6를 정직하게 재정의 | 호스트 변경 시에만 발생 | S(설계 변경만, 코드 변경 적음) | 없음 — 기존 리스크를 그대로 인정하고 범위만 명확히 함 |

## 4. Recommendation for omnis

**G6를 다음과 같이 재정의하라: "Slack/Gmail/Outlook/Telegram/WhatsApp/Calendar와 4개 에이전트 세션은 완전한 hub-less(맥북+아이폰만으로 동작)를 지원한다. KakaoTalk과 LinkedIn은 API가 없는 한 '상시 켜진 기기 한 대'가 세션을 들고 있어야 하며, 이는 omnis의 설계 결함이 아니라 카카오/링크드인 쪽의 외부 제약이다."** 이걸 숨기지 말고 제품 정의서에 그대로 적어라 — Phase D가 "허브 내장 + 배포"라면, 배포되는 것은 "코어+5채널+에이전트"이고 KakaoTalk/LinkedIn 캡처는 여전히 별도 상시 노드가 필요하다는 걸 명시해야 나중에 재설계 비용이 안 생긴다. Effort: **S**(설계 문서 수정), Risk: 없음(정직한 재정의일 뿐).

**Kakao/LinkedIn 캡처 호스트는 지금 당장은 옵션 A(맥미니 고정)를 유지하되, "언젠가 맥북 단독"으로 가려면 옵션 E의 프레임을 지금부터 코드/문서에 반영해라.** 구체적으로: (1) KakaoTalk/LinkedIn 커넥터를 코어 로직과 물리적으로 분리된 "capture sidecar" 프로세스로 설계(이미 05/06/07이 이 구조를 권고 중 — WhatsApp/Telegram 사이드카와 동일 패턴으로 통일), (2) sidecar가 어느 기기에서 돌든 코어(Zero+Postgres)에는 같은 이벤트 포맷으로 흘러들어가게 해서 "sidecar 호스트 = 미니냐 맥북이냐"가 코어 아키텍처에 영향을 주지 않게 한다. Effort: **M**(사이드카 분리 자체는 이미 계획된 패턴이라 크지 않음), Risk: 낮음.

**맥북이 트래블/슬립 상태일 때의 성능 저하를 제품적으로 명시하라.** 맥미니는 상시전원이라 문제 없지만, 만약 나중에 "맥미니 없는 순수 로컬"로 정말 전환해서 맥북이 유일한 상시 노드 역할을 맡는다면: 맥북이 잠들거나(클램쉘 모드 없이) 이동 중 전원이 꺼지면 KakaoTalk/LinkedIn 캡처는 그 시간만큼 완전히 멈춘다(카카오톡 앱 자체가 종료되므로). Slack/Gmail/Telegram/WhatsApp/Calendar는 API 기반이라 이 gap의 영향을 받지 않는다(재연결 시 백필 가능). Effort: 문서화만 S, 실제 우회책(항상 켜진 저전력 노드 유지)은 맥미니를 계속 쓰는 것 자체가 가장 싼 우회책이므로 별도 개발 불필요.

**재인증(re-pairing) 비용을 제품 UX에 명시하라.** 호스트를 바꾸거나 KakaoTalk 앱을 재설치할 때마다: (a) 모바일에 뜨는 4자리 보안 인증번호를 입력하거나 카카오 인증서로 승인(수동, 수초~수십초), (b) WhatsApp은 QR 재스캔(160초 창), (c) Telegram은 세션 파일(SQLite)을 복사하면 QR 없이 이전 가능(mtcute 내장 세션 스토리지 활용, 07 참고) — LinkedIn은 06 파일 확인 필요하지만 일반적으로 세션 쿠키/토큰 재발급이 유사한 수동 단계다. 아이폰의 "모바일 슬롯"은 이 어떤 재인증 과정에서도 영향받는다는 증거를 찾지 못했다(sub-device 추가/제거가 모바일 세션을 건드린다는 문구 없음) — 이 부분은 UNVERIFIED이지만 낙관적 방향의 UNVERIFIED다.

**SQLCipher 키 배포는 지금 당장 풀 문제가 아니다.** 미니만 hub인 동안은 키가 한 곳에만 있으면 되므로 15의 기존 권고(Keychain 저장, SQLCipher 전환)를 그대로 유지해라(Effort S). "맥북도 언젠가 hub가 될 수 있다"는 옵션을 열어두려면, 13이 이미 권고한 대로 Zero+TailscaleKit 조합을 골라 코어 데이터 계층을 Postgres 기반으로 만들어두는 것만으로 충분하다 — 그러면 나중에 "SQLCipher 키를 두 기기에 동기화"가 아니라 "Postgres 서버가 어느 기기에서 뜨는지"의 문제로 단순화된다(Postgres 자체의 at-rest 암호화 또는 SQLCipher 확장을 그 서버 쪽에만 적용하면 됨). 지금 이 키 동기화 로직을 미리 만들 필요는 없다(Effort L짜리 작업을 지금 당길 이유 없음, YAGNI).

## 5. What to borrow

- **talksafety.kakao.com/measure의 "이용자보호조치 적용 사례" 목록 전체**(짧은 기간 내 다량 친구추가, PC 에뮬레이터 사용, 해외 가상번호 등)를 omnis의 KakaoTalk 커넥터 "이렇게 쓰면 안전하다" 체크리스트로 그대로 역이용할 것 — 이 목록이 사실상 카카오가 공개한 "탐지 규칙"이므로, kmsg의 폴링 주기·친구추가 빈도·채팅방 생성 빈도를 이 목록에 안 걸리게 설계하는 게 가장 실전적인 ban 회피책이다. 참고: /Users/logankim/AI-Workspaces/Claude/omnis/research/05-channel-kakaotalk.md §4의 완화책과 직접 결합.
- **cs.kakao.com의 카테고리 taxonomy**("PC/태블릿/워치 이용" → PC(Win/Mac)/태블릿·iPad/스마트워치)를 omnis 자체 "채널 능력 선언" 스키마(01 정의서의 L1 Adapters, read/write/realtime/history/media)에 "device-type" 축 하나를 추가하는 참고 모델로 borrow — 카카오처럼 "이 채널은 기기 타입별로 슬롯이 다르다"는 걸 어댑터 메타데이터에 명시하면 나중에 재인증 UX를 자동화하기 쉬워진다.
- **WhatsApp의 linked-device 모델**(1폰+4개, 슬롯별 독립 해제 가능)을 omnis의 "채널×기기" 권한 모델 설계에 참고 — Kakao처럼 1개 슬롯에 묶이는 게 아니라 "몇 번째 슬롯을 쓰는지"를 보여주고 개별 해제할 수 있게 하는 UX가 재인증 마찰을 줄이는 좋은 참고 사례다.
- **13의 "나중(맥미니 없는 순수 로컬) 전환 비용" 섹션 자체**(파일: `/Users/logankim/AI-Workspaces/Claude/omnis/research/13-client-arch-sync.md`, 61번째 줄 근처)를 이 문서의 옵션 E와 그대로 이어붙여 하나의 "Phase D 준비 체크리스트"로 합칠 것 — 두 문서가 사실상 같은 결론(코어는 Zero+TailscaleKit로 미리 이식 가능하게, KakaoTalk/LinkedIn만 별도 고정 호스트)에 도달했다.

## 6. Open questions

- 정확한 동시 sub-device 로그인 대수(1대인지, PC+태블릿+워치를 각각 하나씩 합쳐 여러 대인지)는 cs.kakao.com 카테고리 1056의 실제 FAQ 본문을 브라우저로 직접 열어야 확정된다 — `curl`로는 클라이언트 JS 렌더링을 못 넘는다. 다음 사람이 할 일: cs.kakao.com → 카카오톡 → PC/태블릿/워치 이용 → PC(Win/Mac) 카테고리를 실제 브라우저로 열어 "몇 대까지 가능한가요" 류 FAQ를 찾는다.
- kmsg(AX 자동화)가 talksafety.kakao.com/policy/stability/abnormalusage의 "이용환경 및 이용패턴 분석을 통해... 비정상적인 방법에 의한 서비스 이용 확인 시" 조항에 실제로 걸리는지는 법률 해석 영역이라 이번 조사로 해소되지 않는다 — 카카오 고객센터에 직접 문의하거나, kmsg 커뮤니티의 실제 장기 밴 사례 축적을 계속 관찰하는 수밖에 없다.
- LinkedIn의 세션 재인증 비용(re-pairing 시 얼마나 자주 CAPTCHA/2FA가 뜨는지)은 이 문서 범위 밖 — 06(`06-channel-linkedin.md`)에서 별도 확인 필요.
- 맥북이 "capture host" 역할까지 맡게 될 경우, 클램쉘 모드+상시 전원 연결로 슬립을 막는 운영상의 해법이 실제로 충분한지(발열/배터리 열화 등 하드웨어 마모 이슈)는 검증 안 됨.

## 7. Sources

- https://talksafety.kakao.com/policy (fetched 2026-09-20) — 운영정책 개요, 공고일/시행일
- https://talksafety.kakao.com/toolandguide/account (fetched 2026-09-20) — sub-device 4자리 보안 인증번호
- https://talksafety.kakao.com/measure (fetched 2026-09-20) — 자동감지, 이용자보호조치 목록(PC 에뮬레이터, sub-device 사용불가 등)
- https://talksafety.kakao.com/policy/stability/abnormalusage (fetched 2026-09-20) — 역분석/봇·매크로/비공식 프로토콜 금지
- https://talksafety.kakao.com/policy/stability/accountintegrity (fetched 2026-09-20) — 계정 거래/양도/대여 금지
- https://talksafety.kakao.com/toolandguide/version/official (fetched 2026-09-20) — 정식 버전 이용 권고
- https://talksafety.kakao.com/toolandguide/account/auth (fetched 2026-09-20) — 2FA 안내(디바이스 대수 언급 없음, 재확인)
- https://cs.kakao.com/helps?service=8&locale=ko (fetched 2026-09-20) — 고객센터 카테고리 목록(PC/태블릿/워치 이용 = categoryId 1056)
- https://cs.kakao.com/helps?service=8&category=1056&locale=ko (fetched 2026-09-20) — 하위 카테고리(PC(Win/Mac)/태블릿·iPad/스마트워치), FAQ 본문은 클라이언트 JS 로드라 미확보
- https://www.kakao.com/policy/terms (fetched 2026-09-20) — 카카오계정 이용약관, 기기/동시접속 제한 문구 없음
- https://www.kakao.com/policy/terms?type=ts (fetched 2026-09-20) — 카카오 통합서비스약관, 동일하게 문구 없음
- https://www.kakao.com/policy/oppolicy (fetched 2026-09-20) — 카카오 운영정책(계정 공통), 카카오톡 세부 정책 링크(talksafety.kakao.com/policy)의 출처
- https://www.kakaocorp.com/page/service/service/KakaoTalk (fetched 2026-09-20) — 서비스 페이지, 정책 링크 확인용
- /Users/logankim/AI-Workspaces/Claude/omnis/research/05-channel-kakaotalk.md — 기존 KakaoTalk 리서치(kmsg 등), 이번 파일이 보강
- /Users/logankim/AI-Workspaces/Claude/omnis/research/07-channel-whatsapp-telegram.md — WhatsApp linked-device(1+4), Telegram 세션 인용
- /Users/logankim/AI-Workspaces/Claude/omnis/research/13-client-arch-sync.md — Zero+TailscaleKit 허브 이전 비용 섹션
- /Users/logankim/AI-Workspaces/Claude/omnis/research/15-security-privacy.md — SQLCipher 키 배포 미해결 문제(§4)
- /Users/logankim/AI-Workspaces/Claude/omnis/research/90-critique.md — 이 GAP(#6)의 최초 지적
- /Users/logankim/AI-Workspaces/Claude/omnis/01-definition-draft.md — G6 원문, Phase D 정의
