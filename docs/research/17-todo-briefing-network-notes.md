# Product patterns: agent-managed todo, briefings, personal CRM/Network, note routing (2026-09-20 리서치)

## 1. TL;DR

Todo는 Motion/Reclaim이 "task→calendar time block 자동배치+재최적화" 패턴을, Todoist Assist가 "이메일 forward→AI 추출→confirm" 캡처 패턴을 검증했다. 브리핑은 kinso(이미 01번 리서치에서 심층 분석됨)의 "urgency 랭킹 요약+톤매칭 draft"가 그대로 목표 UX. Personal CRM은 **Clay가 clay.earth(개인용)에서 clay.com(엔터프라이즈 GTM)으로 피벗**했고 개인용 후신은 **Mesh(me.sh)**다 — Dex가 15개 소스 통합+MCP서버+캘린더 트리거 pre-meeting brief로 omnis Network의 가장 근접한 레퍼런스. Folk의 "Follow-up Assistant"(비활성 대화 감지→톤매칭 초안)가 "노트→라우팅" 기능의 직접 전례. OSS는 Twenty(TS, 커스텀 라이선스·SaaS 재판매 제한)가 code-first entity/workflow 모델로, block/buzz(Rust, Apache-2.0, ★33.7k)가 "에이전트=인박스 스레드" 아키텍처로 가장 재사용 가치 높음. Monica(PHP, AGPL-3.0)는 UI카피 레퍼런스 정도.

## 2. Facts

**(1) Agent-managed todo**
- Todoist Assist의 Email Assist(Experimentalist 모드, Pro/Business)는 forward된 이메일에서 deadline·link·action item을 추출해 자동으로 task를 만든다. 토글로 on/off 가능한 유일한 Assist 기능. VERIFIED — [todoist.com/todoist-assist](https://www.todoist.com/todoist-assist), [TechCrunch](https://techcrunch.com/2026/01/21/todoists-app-now-lets-you-add-tasks-to-your-to-do-list-by-speaking-to-its-ai/) (2026-09-20 fetch).
- Ramble(음성→task)은 Google Gemini 2.5 Flash Live(Vertex AI)로 실시간 음성을 구조화된 task(날짜·디테일 포함)로 변환. VERIFIED — TechCrunch 상동.
- Motion은 project/task의 priority·dependency·deadline·duration을 받아 "하루에 수백 번" 재최적화하는 자동 스케줄링을 하고, 마감 임박 위험을 며칠~몇 주 전 경고한다. Task 캡처는 이메일 forward·미팅초대 변환·Siri 음성. VERIFIED — [usemotion.com](https://www.usemotion.com/) (2026-09-20 직접 fetch).
- Reclaim.ai는 Asana/ClickUp/Todoist/Jira의 task list를 sync해 우선순위 기반 calendar time block으로 변환. "Habits"는 유연한 recurring event, "AI Tasks"는 회의 충돌 시 task가 밀려나지 않게 방어하고 주간 단위로 재조정. VERIFIED — [reclaim.ai](https://reclaim.ai/) (2026-09-20 fetch).
- Akiflow는 "Universal Inbox"로 10+ 네이티브 연동(Slack, Gmail 등)+Zapier/IFTTT에서 task를 모으고, Someday/This month/This week 뷰의 daily planner에서 캘린더와 나란히 time-block한다. 캡처는 자연어 입력, Cmd+K, 음성, AI chat. VERIFIED — [akiflow.com](https://akiflow.com/) (2026-09-20 fetch).
- Vikunja(OSS, Go 백엔드, AGPL-3.0, ★5,460)는 List/Kanban/Gantt/Table 뷰, Docker/바이너리/설치 마법사 셀프호스팅, Todoist/Trello/MS To-Do 마이그레이션 지원. VERIFIED — [vikunja.io](https://vikunja.io/), `gh repo view go-vikunja/vikunja` (2026-09-20).
- 공통 패턴: 어느 제품도 "에이전트가 대신 실행"까지는 안 감 — 전부 **추출→사람이 확인/스케줄→(선택적) 자동배치**에서 멈춘다. omnis가 브리프에서 요구하는 "에이전트가 Codex/Hermes에게 먼저 일을 시킨다"는 이 카테고리에 선례가 없다(=차별화 지점이자 검증되지 않은 리스크).

**(2) Morning briefing / nightly archive digest**
- kinso의 Morning Briefing과 경쟁 제품 비교는 이미 `research/01-kinso-and-competitors.md`에 심층 분석되어 있음 — 여기서는 중복하지 않고 요지만: urgency 랭킹 요약 + 톤매칭 draft + contextual linking. VERIFIED (01번 파일 인용).
- kinso 자체 재확인: "contextual assistant"가 WhatsApp/Slack/email에 흩어진 관련 대화를 사람이 정리하지 않아도 연결한다는 문구, Morning Briefing은 "urgency와 importance로 랭킹된" 데일리 요약. VERIFIED — [kinso.ai](https://www.kinso.ai/) (2026-09-20 재fetch).
- Superhuman Auto Labels: 짧은 자연어 프롬프트("job applications", "requests to review work")로 AI가 라벨 규칙을 생성하고, Split Inbox가 이 라벨을 탭으로 나눠 동종 이메일을 몰아서 처리하게 한다. Instant Reply는 받은편지함을 열 때 이미 초안이 달려있는 상태("wake up to an inbox where every email has a draft reply")를 지향. VERIFIED — [superhuman.com/ai](https://superhuman.com/ai) (2026-09-20 fetch).
- Shortwave는 접속 실패(네트워크 에러, `getaddrinfo ENOTFOUND`)로 1차 소스 확인 못함. UNVERIFIED — 재시도 필요, 이번 리서치에는 사용하지 않음.
- "undo archive" 등 야간 다이제스트의 구체적 UI 어포던스는 어느 소스에서도 1차 확인하지 못했다. UNVERIFIED — 이 부분은 자체 설계 필요.

**(3) Personal CRM / Network**
- **중요 정정**: Clay는 더 이상 개인 CRM이 아니다. clay.com을 직접 fetch하면 "Keep CRM records accurate/complete", 엔터프라이즈 세일즈팀 대상 lead enrichment·rep productivity·sequence 자동화만 나오고, 개인 relationship entity model·reminder·캘린더 트리거는 전혀 없다. VERIFIED — [clay.com](https://clay.com/) (2026-09-20 fetch).
- 원래의 개인용 Clay(clay.earth)는 **301 리다이렉트로 me.sh("Mesh")** 로 이전(리브랜딩). Mesh는 LinkedIn/Facebook/Instagram/WhatsApp/X/Notion 연동 + 이메일/캘린더 자동 캡처로 연락처를 갱신("job changes automatically"), reconnect 타이밍 nudge, 생일/이직/뉴스 언급 활동 피드, 팀 기능("unlock every connection in the room"), 1억+ 관계 관리·Disney/Notion/Stanford/McKinsey 고객 주장. VERIFIED — [me.sh](https://me.sh/) (2026-09-20, clay.earth에서 301 리다이렉트 확인).
- folk: 엔티티 모델 = People / Companies / Objects / Deals. Gmail·Outlook 이메일 스캔 + 캘린더 미팅 + LinkedIn + WhatsApp + 6,000개+ 툴 연동으로 자동 enrich. **Follow-up Assistant**가 이메일/WhatsApp 대화를 분석해 "논의가 비활성화되고 pending next step이 있는" 상태를 감지, 사용자 톤으로 쓴 팔로업 초안을 알림으로 제안. VERIFIED — [folk.app](https://www.folk.app/) (2026-09-20 fetch). **이게 omnis "노트→라우팅" 기능과 가장 가까운 기존 제품 전례.**
- Attio: 데이터 모델 = records/objects + "Universal Context" 레이어(이메일·콜·제품사용·빌링 자동 동기화). Workflow는 이벤트 트리거→enrichment/scoring/routing 액션→시퀀스 등록. "agentic revenue용 CRM"으로 포지셔닝, 에이전트가 24/7 리서치·팔로업·prospecting. VERIFIED — [attio.com](https://attio.com/) (2026-09-20 fetch). 엔터프라이즈 세일즈용이라 omnis엔 워크플로우 엔진 설계 참고용.
- **Dex**: 15개+ 소스(이메일·캘린더·LinkedIn·WhatsApp·iMessage·Facebook·Instagram·전화연락처·CSV)에서 연락처를 통합하고 중복 병합, 커스텀 노트/필드/태그/그룹. Keep-in-touch 리마인더로 관계 방치를 방지. 상호작용 타임라인(미팅·콜·이메일·메시지). **캘린더 트리거 pre-meeting brief + 연락처 이직 시 network update.** Web/iOS/Android/macOS/Windows/Chrome 확장 + **MCP 서버**로 AI 에이전트 접근 + REST API. VERIFIED — [getdex.com](https://getdex.com/) (2026-09-20 fetch). **Dex의 MCP 서버 존재 자체가 omnis Network 설계에 직접 참고할 전례** — "에이전트가 Network 데이터를 읽고 쓴다"는 요구사항을 이미 상용 제품이 MCP로 풀었다는 뜻.
- Monica(OSS PRM, PHP, AGPL-3.0, ★25,336): contact, 관계정의, reminder(생일 자동), note, "어떻게 만났는지" 기록, activity, task, 주소/연락수단, pet, 일기(diary), custom gender/activity type, favorite, multi-vault/multi-user, label, 커스텀 contact sheet 섹션, multi-currency, 27개 언어. VERIFIED — `gh api repos/monicahq/monica/readme` (2026-09-20).

**(4) 노트→라우팅 & 오토레이블링**
- 직접적인 "메모 한 줄 → 적합한 대화/사람에게 라우팅" 기능을 명시적으로 광고하는 제품은 찾지 못했다. 가장 가까운 조합은 folk의 Follow-up Assistant(대화 비활성 감지+톤매칭 draft)와 Superhuman Auto Labels(자연어 프롬프트→라벨 규칙)다. 이 둘을 합성하면 omnis가 원하는 패턴에 근접한다. **이 기능 자체는 미검증 영역 — 직접 설계해야 한다.**
- Twenty CRM(TS, ★57,087, 라이선스 `Other`/NOASSERTION = 커스텀 라이선스, 순수 오픈소스 아님·SaaS 재판매 제한 있을 가능성)은 code-first entity 모델을 제공: 각 엔티티가 `defineObject({ nameSingular, fields: [{name, type: FieldType.TEXT|CURRENCY|DATE_TIME}] })` 형태의 TS 파일 하나, Logic Functions(HTTP route/cron/DB event 트리거 서버사이드 TS), Skills & Agents(재사용 가능한 AI 지침+자율 에이전트)까지 1급 개념으로 지원. `npx create-twenty-app`으로 스캐폴딩, 공식 Claude Code/Codex/Cursor용 agent-skills 패키지 제공. VERIFIED — `gh repo view twentyhq/twenty`, [docs.twenty.com](https://docs.twenty.com/developers/extend/apps/getting-started) (2026-09-20).
- block/buzz(Rust, ★33,695, **Apache-2.0** — 진짜 permissive OSS)는 "A hive mind communication platform": Nostr relay 위에 모든 메시지·리액션·워크플로우 스텝·리뷰 승인·git 이벤트를 서명된 이벤트로 기록. 사람과 에이전트가 동일한 채널 멤버십·키·감사로그를 가짐. `buzz-cli`(agent-first, JSON in/out) + ACP harness(Goose/Codex/Claude Code 연동), YAML 워크플로우(message/reaction/schedule/webhook 트리거), 데스크톱 앱(Tauri+React). VERIFIED — `gh api repos/block/buzz/readme` (2026-09-20). **omnis의 "에이전트 세션=인박스 스레드, 에이전트끼리 서로의 세션을 이해하고 act" 요구사항의 직접적 아키텍처 선례.**

## 3. 비교 표

| 영역 | 제품 | 핵심 패턴 | 라이선스/재사용성 | omnis 참고 포인트 |
|---|---|---|---|---|
| Todo | Todoist Assist | 이메일 forward→AI 추출→confirm | 폐쇄형 SaaS | 캡처 UX(토글, confirm 단계) |
| Todo | Motion/Reclaim | task→calendar 자동배치+재최적화 | 폐쇄형 SaaS | "task는 곧 캘린더 시간"이라는 모델 |
| Todo | Akiflow | 멀티소스 Universal Inbox+daily planner | 폐쇄형 SaaS | Cmd+K 캡처, Someday/week 뷰 |
| Todo(OSS) | Vikunja | List/Kanban/Gantt, 셀프호스팅 | AGPL-3.0 | AGPL이라 코드 재사용시 배포물도 AGPL 전파 — API로만 붙이거나 UI/데이터모델만 참고 권장 |
| 브리핑 | kinso | urgency 랭킹+톤매칭 draft+연결 | 폐쇄형 SaaS | 01번 리서치와 함께 목표 UX 기준선 |
| 브리핑 | Superhuman | Auto Labels(자연어 프롬프트)+Split Inbox+Instant Reply | 폐쇄형 SaaS | 라벨 생성 UX, "열자마자 초안 있음" 패턴 |
| CRM(엔터프라이즈) | Clay.com, Attio | 이벤트 트리거 워크플로우, enrichment, agentic 24/7 | 폐쇄형 SaaS | 워크플로우 엔진 설계(트리거→액션) 참고, 개인용 아님 |
| CRM(개인) | Mesh(구 Clay.earth) | 멀티채널 auto-enrich+reconnect nudge+활동피드 | 폐쇄형 SaaS | UX 카피, feed 개념 |
| CRM(개인) | folk | People/Company/Object/Deal + Follow-up Assistant | 폐쇄형 SaaS | **노트→라우팅의 가장 근접한 전례** |
| CRM(개인) | Dex | 15+소스 통합+MCP서버+캘린더 트리거 brief | 폐쇄형 SaaS(API+MCP 공개) | **Network 설계의 최우선 레퍼런스**, 특히 MCP 서버 패턴 |
| CRM(OSS) | Monica | 관계/reminder/diary, 셀프호스팅 | AGPL-3.0 | 데이터 모델·UI 카피 참고, 코드 fork는 AGPL 전파 주의 |
| CRM(OSS) | Twenty | code-first entity+workflow+agent skill | **Other(커스텀, 재판매 제한 가능성)** | entity/workflow DSL 설계 패턴 참고, 코드 직접 포크는 라이선스 검토 필요 |
| 에이전트 아키텍처 | block/buzz | 에이전트=1급 멤버, 서명 이벤트 로그, ACP harness | **Apache-2.0(진짜 permissive)** | **"에이전트 세션=인박스 스레드" 요구사항의 최우선 아키텍처 레퍼런스, 코드 재사용 가능** |

## 4. Recommendation for omnis

**Todo (effort M, risk 낮음)**: Motion/Reclaim의 "task→calendar time block" 모델과 Todoist의 "추출→confirm" 캡처를 결합한다. MVP는 (a) 인박스 메시지에서 action item을 LLM이 추출해 draft task로 큐잉, (b) Logan이 한 번 확인(swipe/tap)하면 확정, (c) 확정된 task는 Reclaim식으로 Google Calendar에 time block 제안. "에이전트가 Codex/Hermes에게 먼저 일을 시킨다"는 부분은 경쟁 제품 어디에도 전례가 없으므로 자체 설계 리스크로 인지하고, 초기엔 "에이전트가 할 수 있는 일"을 화이트리스트(파일 수집, 초안 작성 등)로 좁게 시작할 것.

**브리핑 (effort S~M, risk 낮음)**: kinso 패턴(urgency 랭킹+톤매칭 draft)을 그대로 목표로 삼되, "undo archive" 같은 세부 어포던스는 1차 소스가 없으므로 Gmail의 "되돌리기" 스낵바 UX를 직접 재현하면 된다(일반 상식 수준, 별도 검증 불필요). Superhuman Auto Labels의 "자연어 프롬프트→라벨 규칙" UX는 그대로 auto-labeling 기능에 이식 가능.

**Personal CRM/Network (effort M, risk 낮음~중간)**: **Dex를 1순위 설계 레퍼런스로 삼아라** — 멀티소스 통합, keep-in-touch reminder, 캘린더 트리거 pre-meeting brief, 그리고 결정적으로 **MCP 서버로 에이전트가 접근**하는 패턴까지 이미 실전 검증됐다. entity 스키마는 Twenty의 code-first `defineObject` 방식을 참고하되 코드를 직접 포크하지 말고(라이선스 `Other`, SaaS 재판매 제한 우려) 패턴만 차용한다. Follow-up 자동화는 folk의 Follow-up Assistant(비활성 대화 감지→톤매칭 draft)를 그대로 벤치마크.

**노트→라우팅 (effort M, risk 중간 — 새로운 영역)**: 상용 전례가 없는 기능이므로 folk Follow-up Assistant + Superhuman Auto Labels + kinso contextual linking 세 가지 조합으로 설계해야 한다: 노트 텍스트 임베딩 → 최근 대화/연락처 임베딩과 유사도 매칭 → 확신도 낮으면 사람 확인 요구. 과신뢰 시 잘못된 사람에게 라우팅되는 리스크가 있으니 초기엔 "제안만 하고 자동발송 금지"로 시작.

**아키텍처 스파이크 (effort S, risk 낮음, 최우선 순위)**: 본격 구현 전에 `block/buzz`(Apache-2.0, ★33.7k) 소스를 clone해서 읽어라 — "에이전트가 채널 멤버로서 자기 키·감사로그를 갖고, 사람과 동일한 이벤트 로그에 참여한다"는 설계가 omnis의 "에이전트 세션=인박스 스레드" 요구사항과 정확히 일치한다. `git clone --depth 1 https://github.com/block/buzz /private/tmp/claude-501/.../scratchpad/buzz`로 받아서 메시지 스키마(NIP류 이벤트 포맷)와 buzz-cli의 JSON in/out 프로토콜을 먼저 검토할 것.

## 5. What to borrow

- **Dex** — Network 엔티티 모델 전체(연락처 통합 로직, keep-in-touch reminder 타이밍, pre-meeting brief 트리거)와 **MCP 서버 노출 패턴**을 omnis Network 모듈 설계의 1차 청사진으로. ([getdex.com](https://getdex.com/))
- **folk** — Follow-up Assistant의 "비활성 대화 감지→pending next step 판단→톤매칭 draft" 로직을 note-routing/auto-followup 기능의 알고리즘 뼈대로. ([folk.app](https://www.folk.app/))
- **Superhuman** — Auto Labels의 "짧은 자연어 프롬프트→라벨 규칙" UX와 Split Inbox 탭 레이아웃을 auto-labeling·필터 UI에 직접 이식. ([superhuman.com/ai](https://superhuman.com/ai))
- **kinso** — Morning Briefing 랭킹 로직과 contextual linking 개념(상세는 `omnis/research/01-kinso-and-competitors.md` 참고).
- **block/buzz** — 에이전트를 1급 채널 멤버로 다루는 이벤트 로그 아키텍처, `buzz-cli` JSON 프로토콜, YAML 워크플로우(트리거: message/reaction/schedule/webhook) 설계를 omnis 에이전트 오케스트레이션 레이어의 참고 설계로. 코드는 Apache-2.0이라 직접 재사용 가능 — `git clone --depth 1 https://github.com/block/buzz`.
- **Twenty** — `defineObject()` 형태의 code-first entity/field/workflow DSL을 omnis 데이터 모델 설계 시 **패턴만** 참고(코드 포크는 라이선스 `Other` 확인 후).
- **Monica** — 관계 데이터 모델(생일 reminder, "어떻게 만났는지" 필드, diary)과 다국어 UI 카피를 Network 모듈 필드 설계 참고용으로(AGPL-3.0이라 코드 재사용 시 라이선스 전파 주의).
- **Vikunja** — Kanban/Gantt/Table 멀티뷰 UI 패턴을 todo 모듈 뷰 설계에 참고(AGPL-3.0, API로 붙이는 방식 권장).

## 6. Open questions

- Shortwave의 실제 AI 기능(daily recap, bundle, auto-label 구체 로직)은 네트워크 오류로 미확인 — 재조사 필요.
- "노트→라우팅" 기능은 상용 전례가 전혀 없어, 정확도/오탐 시 사용자 신뢰 손실 리스크를 어떻게 관리할지(confidence threshold, human-in-the-loop 정도) 별도 설계 검토 필요.
- Twenty의 정확한 라이선스 조항(`Other`, GitHub NOASSERTION)이 omnis가 코드를 일부 차용하거나 임베드하는 데 어떤 제약을 두는지 법률적으로 확인 필요.
- Dex의 MCP 서버가 공개 스펙인지, 서드파티가 붙일 수 있는 형태인지(자체 앱에서 Dex 데이터를 읽어오는 것이 가능한지, 혹은 그냥 Dex 내부에서 Claude 등 에이전트가 Dex를 호출하는 구조인지) 스펙 문서를 직접 fetch해 확인 필요 — 이번엔 getdex.com 마케팅 페이지만 봤다.
- Kakao/LinkedIn처럼 API 없는 채널에서 온 메시지를 "노트→라우팅" 대상으로 포함시킬 때, 상대방 식별(연락처 매칭)을 어떻게 안정적으로 할지는 이 리서치 범위 밖(05/06번 채널 리서치와 교차 검토 필요).

## 7. Sources

- [Todoist Assist](https://www.todoist.com/todoist-assist) (2026-09-20)
- [Todoist AI Ramble — TechCrunch](https://techcrunch.com/2026/01/21/todoists-app-now-lets-you-add-tasks-to-your-to-do-list-by-speaking-to-its-ai/) (2026-09-20)
- [Motion](https://www.usemotion.com/) (2026-09-20)
- [Reclaim.ai](https://reclaim.ai/) (2026-09-20)
- [Akiflow](https://akiflow.com/) (2026-09-20)
- [Vikunja](https://vikunja.io/) + `gh repo view go-vikunja/vikunja` (2026-09-20)
- [Superhuman AI](https://superhuman.com/ai) (2026-09-20)
- [kinso.ai](https://www.kinso.ai/) (2026-09-20)
- [Clay.com](https://clay.com/) (2026-09-20)
- [Mesh (me.sh, formerly clay.earth)](https://me.sh/) (2026-09-20)
- [folk.app](https://www.folk.app/) (2026-09-20)
- [Attio](https://attio.com/) (2026-09-20)
- [Dex](https://getdex.com/) (2026-09-20)
- [Monica CRM README](https://github.com/monicahq/monica) via `gh api repos/monicahq/monica/readme` (2026-09-20)
- [Twenty CRM](https://github.com/twentyhq/twenty), [docs.twenty.com](https://docs.twenty.com/developers/extend/apps/getting-started) (2026-09-20)
- [block/buzz](https://github.com/block/buzz) via `gh api repos/block/buzz/readme` (2026-09-20)
- Internal cross-reference: `/Users/logankim/AI-Workspaces/Claude/omnis/research/01-kinso-and-competitors.md`
