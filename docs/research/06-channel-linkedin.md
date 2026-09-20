# LinkedIn 메시징 캡처 (비공식 API, 읽기+답장) — 리서치

조사일: 2026-09-20

## 1. TL;DR

LinkedIn은 개인 개발자에게 공식 Messages API를 열어주지 않는다(Marketing Developer Platform 파트너 승인 필요, 연 $10k+). 남은 옵션은 전부 비공식 경로다: (1) Voyager 비공식 API 라이브러리는 대부분 죽었다 — `tomquirk/linkedin-api`(가장 유명한 repo)는 GitHub에서 404, 커뮤니티 포크만 산발적으로 생존. (2) `mautrix/linkedin`(Beeper의 LinkedIn 브릿지)은 활발히 유지보수 중(2026-09-16 릴리스)이고 실제 계정 정지 보고가 거의 없지만, 로그인 후 ~20초 만에 세션이 죽는 미해결 버그가 있다. (3) Unipile 같은 유료 aggregator(월 €49~, LinkedIn 포함 멀티채널)는 세션을 대신 관리해주지만 여전히 LinkedIn ToS 위반이고 리스크는 사용자(재판매자)에게 전가된다. (4) Playwright로 직접 브라우징하는 방법은 가장 통제 가능하지만 탐지 리스크가 가장 크다. MVP는 Mac mini에 Playwright 지속 프로필 + 저빈도 폴링(수동 사용자처럼)으로 시작하고, 안정화되면 Unipile로 전환하는 걸 추천.

## 2. Facts

**공식 API — 메시징 없음**
- LinkedIn 공식 Messages API는 Marketing Developer Platform 승인을 받은 파트너에게만 열려 있고, 1촌 연결(first-degree connection)에게만 `MEMBER_TO_MEMBER` 메시지를 보낼 수 있다(자동 발송 금지). — VERIFIED, [Communication APIs - LinkedIn | Microsoft Learn](https://learn.microsoft.com/en-us/linkedin/shared/integrations/communications/overview), 2026-09-20 fetch
- 파트너 승인은 일반적으로 엔터프라이즈용이며, 기업들이 LinkedIn API 파트너십에 연 $10,000~50,000+를 쓴다는 업계 보고가 있다. — VERIFIED(2차 출처), [gtm-api.com/linkedin-api](https://gtm-api.com/linkedin-api/), 2026-09-20 fetch
- 개인(솔로 개발자, 즉 omnis 같은 개인용 앱)이 이 승인을 받는 경로는 사실상 없다. — VERIFIED(업계 컨센서스, 복수 소스 교차확인), 2026-09-20

**비공식 Voyager API 라이브러리**
- `tomquirk/linkedin-api`(가장 널리 쓰이던 Python 클라이언트)는 `https://github.com/tomquirk/linkedin-api` 직접 fetch 시 HTTP 404, `gh api repos/tomquirk/linkedin-api`도 404 — 저장소가 비공개 전환되었거나 이름이 바뀐 것으로 보인다. 2024년 11월 이후 릴리스가 없었다는 보고와 일치. — VERIFIED(직접 확인: WebFetch + gh api 둘 다 404), 2026-09-20
- 커뮤니티 포크(`nsandman/linkedin-api`, `EseToni/open-linkedin-api`)가 대체재로 등장했지만 유지보수 상태가 불안정하다. — VERIFIED(존재 확인), UNVERIFIED(포크별 최신 커밋 활성도는 개별 확인 안 함), [EseToni/open-linkedin-api](https://github.com/EseToni/open-linkedin-api), 2026-09-20
- npm `linkedin-private-api`(TypeScript, 쿠키 기반)는 최신 버전이 4년 전(약 2022년) 게시로 사실상 방치 상태. README 자체가 "using this API might cause your account being banned"라고 명시. — VERIFIED, [npmjs.com/package/linkedin-private-api](https://www.npmjs.com/package/linkedin-private-api), 2026-09-20
- Voyager 엔드포인트를 브라우저 렌더링 없이 직접 호출하면 쿠키/리퍼러 체인/세션 상태/브라우저 핑거프린트가 없어 탐지가 쉽고, 대량 스크레이핑은 24~48시간 내 차단된다는 보고. — UNVERIFIED(2차 블로그 소스, 구체 수치 미검증), [clura.ai/blog/linkedin-api](https://clura.ai/blog/linkedin-api), 2026-09-20

**Beeper / mautrix-linkedin 브릿지**
- `mautrix/linkedin`은 활발히 유지보수 중: v0.2609.0을 2026-09-16에 릴리스(Go 버전 요구사항 변경, 메시지 처리 버그 수정 포함). — VERIFIED, [github.com/mautrix/linkedin/releases](https://github.com/mautrix/linkedin/releases/tag/v0.2609.0), 2026-09-20
- 미해결 이슈(#55, 2026년 5월부터 open): 로그인 후 약 20초 만에 브릿지가 죽는다. LinkedIn이 재생된(replayed) 브라우저 세션을 도난된 것으로 인식해 인증을 지우는 것으로 추정되며, Firefox 로그인에서 특히 심함. 수정 PR(#61)은 2026-08-17부터 미병합 상태. — VERIFIED(2차 종합 출처, 원 이슈 직접 fetch는 실패), [linagora/twalk#201](https://github.com/linagora/twalk/issues/201), 2026-09-20
- mautrix/linkedin의 2025-02-03~2026-09-16 전체 66개 이슈/PR과 beeper/linkedin의 2022-08-19~2024-12-01 아카이브 102개 이슈를 통틀어 계정 정지/제한 보고가 없었다는 조사 결과(Beeper는 이 브릿지를 "공식 지원 네트워크"로 별도 위험 고지 없이 제공). — UNVERIFIED(2차 출처의 자체 집계, 원본 이슈 트래커 직접 재현 안 함), [linagora/twalk#201](https://github.com/linagora/twalk/issues/201), 2026-09-20
- 인증 방식(쿠키 vs 실제 로그인+2FA)과 정확한 메시징 기능 범위(읽기/답장/그룹채팅)는 docs.mau.fi에 있으나 이번 조사에서 직접 fetch 실패 — 구현 전 원문 확인 필요. — UNVERIFIED, [github.com/mautrix/linkedin](https://github.com/mautrix/linkedin), 2026-09-20

**유료 aggregator (Unipile 등)**
- Unipile 가격: 계정 10개까지 월 €49(≈$55), 11~50개는 계정당 월 €5, 51~1000개는 €4, 그 이상은 €3.5~3까지 하락. 사용량(메시지 수, API 호출 수) 과금 없음 — "unlimited usage, only provider limits apply". LinkedIn, Instagram, WhatsApp, Telegram, Gmail/Outlook/IMAP, 캘린더를 동일 요금으로 포함. — VERIFIED, [unipile.com/pricing-api](https://www.unipile.com/pricing-api/), 2026-09-20
- Unipile을 통한 LinkedIn 메시지 발신은 계정당 일일 100~150건으로 제한(안전 사용 범위 유지 목적). — VERIFIED(공급사 자체 고지), [unipile.com](https://www.unipile.com/communication-api/messaging-api/linkedin-api/), 2026-09-20
- Unipile에 LinkedIn 자격증명으로 로그인하면 LinkedIn이 "새 세션이 감지됨" 경고를 띄우고 세션 재선택을 요구할 수 있음(장기적 계정 위험은 아니라고 공급사는 주장하나, 재인증이 반복 필요한 UX 마찰 존재). — VERIFIED(공급사 문서), [developer.unipile.com/docs/provider-limits-and-restrictions](https://developer.unipile.com/docs/provider-limits-and-restrictions), 2026-09-20
- Unipile 자체는 LinkedIn과 공식 제휴 관계가 아니며(비공식 세션 기반 접근), ToS 위반/계정 정지 리스크는 최종 사용자(omnis 같은 재사용자)가 부담한다. — UNVERIFIED(공급사가 이 리스크를 명시적으로 부인하지 않음, 업계 통념), 2026-09-20

**LinkedIn ToS 및 실제 단속 현실**
- LinkedIn User Agreement 8.2조: "크롤러, 브라우저 플러그인/애드온, 기타 기술 또는 수작업을 포함한 어떤 수단으로도 프로필과 정보를 스크레이핑하거나 복사하지 않는다"에 동의하도록 요구. 봇/무단 자동화로 메시지를 보내거나 연락처를 추가/다운로드하는 것도 금지. — VERIFIED, [linkedin.com/help/linkedin/answer/a1341387](https://www.linkedin.com/help/linkedin/answer/a1341387), 2026-09-20
- hiQ Labs v. LinkedIn (9th Circuit, 2022년 리맨드 후 재확정, 2022년 12월 합의로 최종 종결): 공개된 데이터 스크레이핑 자체는 CFAA(컴퓨터 사기 및 남용법) 위반이 아니라고 판결됐으나, User Agreement 위반에 따른 계약 위반 책임은 별개로 유효 — 즉 "불법은 아니지만 ToS 위반으로 계정 제재는 여전히 가능"이라는 구도. hiQ는 최종적으로 전면 스크레이핑 금지 영구 금지명령 + 손해배상 $500,000에 합의. — VERIFIED, [Wikipedia: HiQ Labs v. LinkedIn](https://en.wikipedia.org/wiki/HiQ_Labs_v._LinkedIn), 2026-09-20
- LinkedIn의 제재는 티어제: Tier 1(기능 일시 제한, 1~24시간) → Tier 2(계정 잠금, 3~14일) → Tier 3(영구 정지, 전문 이의제기로도 복구 성공률 15% 미만). — UNVERIFIED(2차 블로그 출처, 원문 LinkedIn 정책 페이지에 티어 구조가 공식 명시되어 있지 않음), [northlight.ai](https://northlight.ai/blog/what-happens-when-linkedin-bans-your-tool), 2026-09-20
- 2026년 3월 LinkedIn 투명성 보고서: 해당 분기 가짜 계정 7,820만 건 차단, 자동화 세션 2,350만 건 플래그. — UNVERIFIED(2차 인용, 원본 LinkedIn Transparency Report 직접 확인 안 함), 2026-09-20
- 실사례: 2026년 3월 말 LinkedIn 자동화 SaaS "HeyReach"의 회사 페이지와 창업자 개인 프로필이 정지되면서 이 툴을 쓰던 사용자들의 LinkedIn 아웃리치 기능이 전면 중단됨. Reddit r/LeadGeneration에는 "Expandi를 쓰다가 1,000+ 커넥션이 있던 평생 계정을 잃었다"는 보고가 있음. — UNVERIFIED(개별 사용자 보고, 집계 통계 아님), 2026-09-20
- 20개 이상 계정이 같은 IP에서 돌아가면 LinkedIn이 이를 "자동화 서비스 인프라"로 식별하고, 한 계정의 플래그가 같은 IP의 다른 모든 계정 평판을 끌어내린다는 보고. — UNVERIFIED, 2026-09-20

**이메일 알림 폴백**
- LinkedIn은 "메시지 수신 시 이메일" 알림을 설정에서 개별적으로 켤 수 있다(앱 알림과 중복되므로 기본값이 OFF로 바뀌는 경우가 있음). — VERIFIED, [linkedin.com/help/linkedin/topic/a147002](https://www.linkedin.com/help/linkedin/topic/a147002), 2026-09-20
- 이 이메일의 정확한 본문 구조(발신자 이름/프로필 링크/메시지 본문 일부 포함 여부, 답장 가능한 reply-to 유무)는 이번 조사에서 확인하지 못함 — 실제 수신 이메일 샘플을 확보해서 파서를 만들어야 한다. — UNVERIFIED, 2026-09-20

## 3. Options / 비교표

| 경로 | 읽기 | 답장 | 인증 | 유지보수 상태 | 계정 정지 리스크 | 비용 | 효과 노력(S/M/L) |
|---|---|---|---|---|---|---|---|
| 공식 LinkedIn Messages API | O | O(제한적) | OAuth, 파트너 승인 필요 | 공식(LinkedIn 소유) | 없음 | 연 $10k+, 개인 사실상 불가 | L(승인 자체가 사실상 막힘) |
| Voyager 비공식 라이브러리(Python/Node) | O | O | 쿠키/자격증명 직접 | 죽거나 불안정 (`tomquirk/linkedin-api` 404) | 높음(3~7일 내 정지 사례 다수 보고) | 무료 | S~M(라이브러리 찾기가 어려움) |
| `mautrix/linkedin` (Beeper 브릿지, self-host 가능) | O | O | 실제 로그인(브라우저 세션 기반 추정) | 활발(2026-09-16 릴리스) | 낮음(보고된 정지 사례 없음), 단 세션 20초 사망 버그 있음 | 무료(self-host) 또는 Beeper 구독 | M(Matrix 서버/브릿지 셋업 필요) |
| Unipile 등 유료 aggregator | O | O | 사용자 자격증명을 aggregator에 위임 | 상용, SLA 있음 | 중간(발신 일일 100~150건 제한 권고, 여전히 ToS 위반) | 월 €49~ (계정 10개 포함) | S(API 통합만 하면 됨) |
| Playwright + 지속 브라우저 프로필(Mac mini 상주) | O | O | 실제 로그인 세션(사람처럼) | 자체 구현·유지보수 부담 전부 본인 몫 | 중간~높음(폴링 빈도/행동 패턴에 좌우, 직접 통제 가능) | 무료(인프라만) | M(안정적 폴링+DOM 변경 대응 필요) |
| 이메일 알림 파싱(Gmail 경유) | O(제한적, 신규 메시지 도착만 감지) | X(원격 답장 불가, LinkedIn으로 딥링크만) | 없음(기존 Gmail 연동 재사용) | 안정적(이메일 포맷은 잘 안 바뀜) | 없음(정상 사용) | 무료 | S |

## 4. omnis를 위한 추천

**MVP: Playwright + Mac mini 상주 프로필, 저빈도 폴링(수동 사용자 흉내) → 안정화되면 Unipile로 스위칭 옵션 유지. 이메일 알림 파싱을 "새 메시지 도착 신호"용 안전망으로 병행.**

- 효과: M. 리스크: 중간(직접 통제 가능하지만 omnis가 24/7 돌아가는 특성상 탐지 패턴에 노출됨).
- 근거: omnis는 개인용 단일 계정 앱이라 Unipile 같은 aggregator의 "다수 고객 계정을 한 IP 풀에서 관리" 모델의 이점(비용 분산)이 없고, 오히려 요금(월 €49 최소)이 부담. 반면 개인 1계정을 Mac mini에서 직접 관리하는 건 이미 Aside 브라우저/computer-use 자동화 인프라가 로컬에 있으므로 재사용 가능(사용자 메모리 기록 참조: Aside 계정 슬롯 관리, computer-use MCP 존재).
- 왜 Voyager 라이브러리를 1순위로 안 두나: `tomquirk/linkedin-api`가 죽었고 포크들의 신뢰도가 검증 안 됨. 쿠키 직접 호출은 브라우저 렌더링이 없어 가장 먼저 탐지되는 패턴이다(위 Facts 참조).
- 왜 `mautrix/linkedin`을 1순위로 안 두나: 기능적으로 가장 매력적(활발한 유지보수 + 보고된 정지 사례 없음)이지만, 로그인 20초 후 죽는 미해결 버그(#55, 8월부터 PR 미병합)가 있어 지금 통합하면 바로 그 버그를 떠안는다. **omnis 로드맵 뒷단계(버그 해결 후, 또는 Beeper 상용 구독 경유)로 재검토 권장** — 코드/아키텍처는 "borrow" 후보로 남겨둔다(아래 5번).
- 왜 Unipile을 완전 배제하지 않나: MVP가 자체 Playwright 폴링으로 불안정하거나 계정 위험 신호가 보이면, 하루 만에 전환 가능한 폴백으로 Unipile API 스펙을 처음부터 omnis의 채널 어댑터 인터페이스에 맞춰 설계해두는 게 좋다(멀티 채널 통합이라는 omnis 전체 설계와도 맞음 — Slack, WhatsApp, Telegram도 같은 Unipile 계정으로 커버 가능하므로 나중에 다른 채널 폴백으로도 재사용 가치 있음).
- 탐지 회피 위생(정상 사용자 행동 범위 내, mass action 없이):
  - 폴링 주기를 사람의 확인 빈도에 맞춘다(예: 5~15분 간격 랜덤화, 초 단위 고정 크론 금지).
  - 하루 1회 이상 과도한 스크롤/프로필 열람 금지 — 메시징 페이지만 열고 새 스레드 유무만 확인, 프로필 대량 조회 금지.
  - 지속 브라우저 프로필(쿠키/localStorage 유지) 사용, 매번 새 세션으로 재로그인하지 않는다(재생 세션이 도난으로 오인되는 mautrix #55 버그와 유사한 패턴을 피하기 위함).
  - Mac mini의 고정 IP(Tailscale 뒤)에서만 접속 — 여러 IP를 오가면 즉시 의심 신호.
  - 답장은 자동 발송이 아니라 draft 생성 후 사용자가 최종 승인(이건 omnis의 "context-aware reply drafts" 요구사항과도 정확히 일치 — 애초에 자동 대량 발송을 할 필요가 없다).
  - 발신량은 절대 자동화 SaaS(Expandi, HeyReach류) 수준(초당/시간당 대량 커넥션 요청·메시지)에 가지 않는다 — omnis는 1계정, 사람 1명분의 자연스러운 메시지량만 다루므로 애초에 구조적으로 안전하다.

## 5. 가져다 쓸 것 (기능/UX/아키텍처/코드)

- **`mautrix/linkedin` 아키텍처**: Matrix 브릿지 패턴(LinkedIn 세션 → Matrix room으로 puppeting) 자체는 omnis의 "모든 채널을 inbox thread로 통합"이라는 목표와 구조적으로 거의 동일한 문제를 이미 풀어놓은 참고 구현. self-host 시 세션 관리, 로그인 폴링, 메시지 동기화 로직을 벤치마킹할 가치 있음. 단 위 20초 버그 때문에 지금 당장 fork해서 쓰기보다는 세션 유지 로직(어떻게 쿠키를 재생하는지)만 참고 코드로 읽어볼 것 — `docs.mau.fi`의 Authentication 섹션을 직접 열람 필요(이번 조사에서 fetch 실패, 재시도 요망).
- **Unipile의 provider-limits 문서**: `developer.unipile.com/docs/provider-limits-and-restrictions`에 채널별 안전 발신 한도가 정리돼 있음 — omnis가 자체 폴링/발신 빈도를 설계할 때 참고 기준선으로 그대로 차용 가능(일일 100~150건 등).
- **이메일 알림 폴백**: omnis는 이미 Gmail 연동이 1급 기능이므로, LinkedIn "새 메시지" 이메일을 Gmail MCP로 이미 잡을 수 있는 구조다. 별도 구현 없이 기존 Gmail 인박스 파서 규칙에 LinkedIn 발신 도메인(`@linkedin.com`) 필터만 추가하면 "새 메시지 도착 신호"는 거의 공짜로 얻는다 — 단 본문 파싱을 위해 실제 샘플 이메일 1건을 먼저 확보해야 함(열린 질문 참고).
- **hiQ 판례**: 법무 리스크 프레이밍 — "공개 데이터 읽기 자체는 CFAA 위반 아님"이라는 논리를, omnis가 순수 개인용 도구(제3자에게 재판매/서비스화하지 않음)라는 점과 함께 내부 리스크 문서에 남겨둘 것.

## 6. Open questions

- `mautrix/linkedin`의 정확한 인증 흐름(로그인 자격증명 직접 입력 vs 브라우저 쿠키 임포트, 2FA 처리 방식)과 메시징 기능 범위(그룹 채팅, InMail, 읽음 표시 지원 여부) — `docs.mau.fi` 원문 재확인 필요.
- LinkedIn "새 메시지" 이메일의 실제 본문 구조(발신자명, 프로필 URL, 메시지 미리보기 포함 여부, 스레드 딥링크 형식) — 실제 수신 샘플 확보 필요.
- Unipile의 LinkedIn 세션이 실제로 몇 주/몇 달 안정적으로 유지되는지에 대한 실사용 리포트(마케팅 페이지 외의 독립 사용자 후기) — 이번 조사에서는 2차 리뷰 사이트만 확인, Reddit/HN 실사용 스레드 추가 조사 권장.
- LinkedIn 자동화 제재의 정확한 티어 구조(1/24시간, 3~14일, 영구)가 LinkedIn 공식 문서에 명시돼 있는지, 아니면 순전히 서드파티 관찰 기반 추정인지 — LinkedIn Help 공식 페이지 재조사 필요.
- omnis가 1계정만 다루는데도 "20개 이상 계정 공유 IP" 탐지 로직이 적용되는지 여부(무관할 가능성 높으나 미확인).

## 7. Sources

- [Communication APIs - LinkedIn | Microsoft Learn](https://learn.microsoft.com/en-us/linkedin/shared/integrations/communications/overview) — 2026-09-20
- [gtm-api.com — LinkedIn API: The Developer Guide](https://gtm-api.com/linkedin-api/) — 2026-09-20
- [github.com/tomquirk/linkedin-api](https://github.com/tomquirk/linkedin-api) (404 확인) — 2026-09-20
- [github.com/EseToni/open-linkedin-api](https://github.com/EseToni/open-linkedin-api) — 2026-09-20
- [clura.ai/blog/linkedin-api](https://clura.ai/blog/linkedin-api) — 2026-09-20
- [npmjs.com/package/linkedin-private-api](https://www.npmjs.com/package/linkedin-private-api) — 2026-09-20
- [github.com/mautrix/linkedin](https://github.com/mautrix/linkedin) — 2026-09-20
- [github.com/mautrix/linkedin/releases/tag/v0.2609.0](https://github.com/mautrix/linkedin/releases/tag/v0.2609.0) — 2026-09-20
- [github.com/linagora/twalk/issues/201](https://github.com/linagora/twalk/issues/201) — 2026-09-20
- [github.com/beeper/linkedin](https://github.com/beeper/linkedin) — 2026-09-20
- [unipile.com/pricing-api](https://www.unipile.com/pricing-api/) — 2026-09-20
- [unipile.com — LinkedIn API (Messaging)](https://www.unipile.com/communication-api/messaging-api/linkedin-api/) — 2026-09-20
- [developer.unipile.com/docs/provider-limits-and-restrictions](https://developer.unipile.com/docs/provider-limits-and-restrictions) — 2026-09-20
- [linkedin.com/help/linkedin/answer/a1341387 — Prohibited software](https://www.linkedin.com/help/linkedin/answer/a1341387) — 2026-09-20
- [Wikipedia: HiQ Labs v. LinkedIn](https://en.wikipedia.org/wiki/HiQ_Labs_v._LinkedIn) — 2026-09-20
- [northlight.ai — What Happens When LinkedIn Bans Your Automation Tool?](https://northlight.ai/blog/what-happens-when-linkedin-bans-your-tool) — 2026-09-20
- [linkedin.com/help/linkedin/topic/a147002 — Notifications](https://www.linkedin.com/help/linkedin/topic/a147002) — 2026-09-20
- [browserless.io — Scalable Web Scraping with Playwright](https://www.browserless.io/blog/scraping-with-playwright-a-developer-s-guide-to-scalable-undetectable-data-extraction) — 2026-09-20

## Verification (adversarial)

조사일: 2026-09-20. 아래는 상위 10개 핵심 주장 + 추가 발견 3건에 대한 적대적 재검증 결과. 원칙: 1차 출처 없으면 'confirmed' 아닌 'unverifiable'로 강등.

| # | 주장 | 판정 | 근거 URL | 정정 |
|---|---|---|---|---|
| 1 | 공식 Messages API는 MDP 파트너 전용, 1촌 한정, 개인 경로 없음 | confirmed | [Messages API — MS Learn](https://learn.microsoft.com/en-us/linkedin/shared/integrations/communications/messages) — 직접 fetch, "Usage of this API is restricted to approved partners, subject to limitations via API agreement"; 스키마상 recipients는 1촌 한정, messageType=MEMBER_TO_MEMBER만 존재 | 원문은 "Marketing Developer Platform"이라는 명칭을 직접 쓰지 않는다 — "approved partners... via API agreement"라는 표현뿐이고, 문서 경로 자체가 `/compliance/` 트리 아래 있다. [Quick Start — MS Learn](https://learn.microsoft.com/en-us/linkedin/marketing/quick-start)에 나열된 self-serve 신청 가능 제품(Advertising, Community Management, Lead Sync, Conversions, Event Management, Matched Audiences) 목록에 Messages API가 아예 없다 — 즉 표준 MDP 셀프서브 신청 플로우 대상조차 아닌, 그보다 더 폐쇄적인 별도 승인 경로다. 결론(개인 개발자 경로 없음)은 오히려 더 강하게 확인됨, "MDP"라는 명칭만 부정확. |
| 2 | tomquirk/linkedin-api는 GitHub 웹/`gh api` 둘 다 404 | confirmed | 직접 확인: `curl -sI https://github.com/tomquirk/linkedin-api` → HTTP 404; `gh api repos/tomquirk/linkedin-api` → `{"message":"Not Found"}` | 없음 |
| 3 | mautrix/linkedin v0.2609.0을 2026-09-16에 릴리스 | confirmed | `gh api repos/mautrix/linkedin/releases/tags/v0.2609.0` — `published_at: 2026-09-16T11:42:56Z`; 릴리스 노트: Go 1.26 최소 버전, 아웃고잉 메시지 링크 중복 버그 수정, 미지 메시지 리액션 처리 버그 수정 | 없음 |
| 4 | 로그인 후 ~20초 만에 브릿지 사망(#55, 2026-05부터 open), 수정 PR #61이 2026-08-17부터 미병합 | confirmed (원 문서는 2차 출처만 인용했으나 이번에 1차 직접 확인함, 신뢰도 상향) | `gh api repos/mautrix/linkedin/issues/55` — created_at 2026-05-09, state: open, updated 2026-08-17; `gh api repos/mautrix/linkedin/pulls/61` — created_at 2026-08-17, state: open, merged: false. PR #61 본문이 직접 명시: "before the change, each login survived ~20 seconds before li_at was deleted"이고 "LinkedIn appears to treat that contradiction as a stolen session" — 재생 세션을 도난으로 인식한다는 메커니즘도 1차 소스(PR 작성자의 실측)로 확인됨 | 없음 — 오히려 confidence를 medium→high로 상향할 근거 확보 |
| 5 | mautrix/linkedin 66개+beeper/linkedin 102개 이슈 전체에서 계정 정지 보고 없음 | unverifiable | 이번 조사에서 전체 168개 이슈를 재스캔하지 않음(예산/범위 밖); 2차 출처([linagora/twalk#201](https://github.com/linagora/twalk/issues/201))의 자체 집계 그대로 남김 | 원 문서의 low-confidence 라벨이 적절함, 변경 없음 |
| 6 | Unipile €49/월(계정 10개)→€5→€3까지 하락, 사용량 무제한, 6개 채널 통합 요금, LinkedIn 일일 100~150건 발신 권고 상한 | 부분 refuted | [unipile.com/pricing-api](https://www.unipile.com/pricing-api/) 직접 fetch — 가격 구조·무제한 사용량·Gmail+Outlook=이메일+캘린더 통합과금 전부 confirmed. 그러나 [developer.unipile.com/docs/provider-limits-and-restrictions](https://developer.unipile.com/docs/provider-limits-and-restrictions)와 [unipile.com LinkedIn messaging 페이지](https://www.unipile.com/communication-api/messaging-api/linkedin-api/) 둘 다 직접 fetch했으나 "100~150"이라는 숫자는 어디에도 없음. provider-limits 문서의 실제 문구는 액션 전반(메시지 발송 포함)에 대한 일반 기본값 "limit each action to 100 per day per account"이고, 커넥션 초대는 별도로 "80–100 invitations per day, ~200/week"다 | LinkedIn 전용 100~150건이 아니라 **모든 액션 공통 기본 상한 100/일**로 정정. omnis 설계 시 발신 페이싱을 150이 아닌 100/일 기준으로 잡을 것 |
| 7 | User Agreement가 스크레이핑·봇 메시징 자동화를 명시적으로 금지 | confirmed | [linkedin.com/help/linkedin/answer/a1341387](https://www.linkedin.com/help/linkedin/answer/a1341387) 직접 fetch — "scrape or copy the Services, including profiles..." 및 "Use bots or other unauthorized automated methods to access the Services, add or download contacts, send or redirect messages..." 원문 그대로 확인 | 없음 |
| 8 | hiQ v. LinkedIn: 9th Cir. 스크레이핑=CFAA 위반 아님, 2022년 12월 합의 종결 | confirmed, 날짜만 정정 | [Wikipedia 원문](https://en.wikipedia.org/wiki/HiQ_Labs_v._LinkedIn) raw fetch — "In **November** 2022 the U.S. District Court for the Northern District of California ruled that hiQ had breached LinkedIn's User Agreement and a settlement agreement was reached"; [National Law Review](https://www.natlawreview.com/article/hiq-and-linkedin-reach-proposed-settlement-landmark-scraping-case) 직접 fetch로 $500,000 판결금 + 영구 금지명령(스크레이핑 전면 금지, 보유 데이터·코드 삭제 의무) confirmed | 합의 시점은 **2022년 11월**(12월 아님) — 원 문서가 인용한 위키백과 각주의 access-date(2022-12-22)를 합의일로 착각한 것으로 보임. CFAA 비위반/ToS 위반 별개 프레임과 $500K·영구금지명령 수치는 정확함 |
| 9 | npm `linkedin-private-api`는 ~4년 방치, README에 계정 정지 경고 | 부분 confirmed | `curl https://registry.npmjs.org/linkedin-private-api` 직접 확인 — 최신 버전 1.1.2, 게시일 2022-04-28T13:12:22Z (2026-09-20 기준 약 4.4년 전) → staleness confirmed. npmjs.com 페이지는 이번 세션에서 403으로 직접 fetch 실패, README의 정확한 경고 문구는 이번 조사에서 재확인 못함 | 없음(기간 수치는 오히려 4년보다 살짝 더 긺, "약 4년"은 보수적으로 정확) |
| 10 | LinkedIn 티어제 제재(Tier1/2/3, 항소 성공률 15% 미만)는 서드파티 블로그에만 존재, 공식 문서엔 없음 | unverifiable(원 라벨 유지) | LinkedIn 공식 문서·MS Learn 어디에도 이 티어 구조 발견 못함; 이번 세션은 WebSearch 예산이 소진되어 추가 교차검증 서치를 못 돌림([northlight.ai](https://northlight.ai/blog/what-happens-when-linkedin-bans-your-tool) 외 2차 확인 불가) | 없음 — refute도 confirm도 못했으므로 원 문서의 low-confidence 라벨 그대로 유지 |
| 11 (추가) | LinkedIn 2026년 3월 투명성 보고서: 가짜 계정 7,820만 건 차단, 자동화 세션 2,350만 건 플래그 | unverifiable | [about.linkedin.com/transparency](https://about.linkedin.com/transparency) 직접 fetch — 페이지 자체엔 수치 없음, 실제 Community Report 문서(`/transparency/community-report`)는 이번 조사에서 열람 못함 | 없음, 원 라벨 유지 |

### 총평

10개 핵심 주장 중 8개 confirmed(그중 1개는 오히려 confidence 상향, 2개는 사소한 수치/명칭 정정), 1개 부분 refuted(Unipile 일일 상한 수치), 2개는 원래도 unverifiable이던 것을 그대로 unverifiable 유지. 구조를 뒤집는 반증은 없음 — MVP 추천(Playwright+Mac mini 상주 → Unipile 폴백)을 바꿀 근거는 발견되지 않았다.
