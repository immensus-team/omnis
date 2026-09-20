# omnis 디자인 방향 (Logan 결정, 2026-09-20)

**기준은 kinso다.** 레퍼런스: `reference/kinso-inbox.webp`, 상세 티어다운 `../research/23-gap-kinso-visual-teardown.md`, OSS 차용 계획 `../research/30-herdr-and-oss-ui-borrow.md`.

## 그대로 따르는 것
- **라이트 테마 기본**(따뜻한 오프화이트 캔버스, 은은한 그리드/그라데이션 배경). 다크는 옵션이며 A5의 "다크 우선"은 폐기한다.
- **왼쪽 채널 레일**: 세로 스쿼클 타일. 맨 위 Inbox 타일(검정), 아래로 채널 브랜드 아이콘(Gmail, Slack, LinkedIn, WhatsApp, Telegram, KakaoTalk, Outlook, Calendar), 에이전트 타일, 접기 화살표. 맨 아래 내 아바타와 설정.
- **상단 "Start typing to ask or search" 필 바**: ⌘K 팔레트를 상시 노출한 입력. 왼쪽에 옴니스 오브(그라데이션 구슬), 포커스 시 그라데이션 스트로크.
- **인박스 행 = 대화(사람) 단위**: 원형 아바타 + 굵은 이름 + 회색 상대시간(3m, 2w, 4 Aug) + **AI 한 줄 요약**("Wants you to share a sales contract from Brightstone Realty …") + 우측 고정 채널 브랜드 아이콘. 헤어라인 없음, 넉넉한 행 높이, 선택 행만 흰 카드 + 소프트 섀도로 elevate.
- **Inbox 제목 한 줄**만 있는 리스트 헤더. 필터 pill(All/Work/Personal/Agents/Needs approval)은 헤더 오른쪽에 작게.

## omnis 목적에 맞게 바꾸는 것
- 에이전트 세션도 같은 행 문법. 아바타 자리에 런타임 로고(Claude/Codex/DeepSeek/Hermes), 요약 자리에 마지막 턴 요약, 우측 아이콘 자리에 상태 배지(idle/working/**blocked**/done — herdr 상태 모델). blocked(내 응답 필요)는 리스트 최상단으로.
- 승인 카드는 상세 패널 상단에 kinso 스타일 카드로(전문 노출, Approve / Edit & send / Ignore).
- 라벨 칩은 요약 줄 오른쪽 끝에 최대 2개 + "+N", 채널 색을 쓰지 않는다.

## 구현 원칙
- 직접 만들지 않는다: 브랜드 아이콘 `react-icons/si`, 스레드·컴포저·AI 패널은 `cloudflare/agentic-inbox` 패턴, 에이전트 상태 UI는 `AltanS/collie`·`herdr-radar` 패턴, 명령/검색은 기존 `cmdk`, 토큰은 shadcn 테마 프리미티브.
- 요약은 T1(DeepSeek Flash) 한 줄, 실패·미생성 시 subject 또는 본문 첫 줄 폴백. `threads.meta.summary`에 저장하고 매 실행을 `agent_runs`에 기록.

## 추가 지시 (Logan, 2026-09-20 저녁)

- **UI/UX를 깎는 반복 작업은 DeepSeek V4.1 Flash가 주력이다.** UI 스토리는 DeepSeek 티어로 배정하고 Sonnet 드라이버가 실행·검증한다. 리뷰어는 스크린샷을 아래 레퍼런스와 대조해 "AI-slop처럼 보이면" 거절한다(균일한 카드 그리드, 보라 그라데이션 남발, 과한 그림자, 의미 없는 아이콘, 밋밋한 기본 폰트, 정적인 전환은 전부 슬롭 신호).
- **오픈소스 디자인 스킬을 계속 리서치·설치해 쓴다.** 설치 목록과 사용법은 `docs/design/SKILLS.md`(리서치 후 생성)에 유지한다.
- **애플답고 glassy하게, 모션은 자연스럽게.** Liquid Glass는 sidebar/toolbar/sheet/팔레트/플로팅 패널에만, 리스트·본문은 불투명(기존 규칙 유지). 모션은 spring 기반(진입 160ms, 전환 240ms, 레이어 등장 320ms; 과장 금지), reduced-motion 존중.

### 레퍼런스 3장 (`reference/`)
| 파일 | 가져올 디테일 |
|---|---|
| `ref-glass-mail-ai-panel.webp` | 배경 위 유리질 사이드바(반투명 + blur + 은은한 틴트), 스마트 폴더 트리와 카운트, 상단 탭 필, 플로팅 **AI 채팅 패널**(제안 액션 "Draft a reply / Summarize / Extract", 모델 선택기 Auto/Claude/Gemini/GPT, 첨부·@ 멘션 입력창). omnis의 ask 바를 이 패널로 확장한다. |
| `ref-issue-tracker-density.webp` | 필터 칩 바("Priority is any of 2 priorities"), 상태별 그룹 헤더(pill + 카운트 + +), 서브아이템 들여쓰기, 호버 카드, 체크박스 드롭다운. omnis의 Tasks·Needs-approval 뷰의 밀도와 상태 pill 문법. |
| `ref-dashboard-detail-card.webp` | 왼쪽 아이콘 레일(선택 상태 미세 배경), 상단 제목 + 서브라인, 토글·세그먼트 컨트롤, 우측 상세 카드(사진 + 배지 + 키-값 헤어라인 표). omnis의 상세 패널·Network 사람 카드·Settings의 타이포 기준. |

## 반경 스케일 (US-D02 4회차)

한 화면에 여러 반경이 공존하는 건 의도다(균일 반경은 SaaS 카드킷 텔이다). 다만 고를 때는
아래에서 고른다 — 새 값을 즉흥으로 만들지 않는다.

| 값 | 쓰는 곳 |
|---|---|
| `999px` | 필 — 탭 pill, 행 라벨 칩, 상태 배지 |
| `12px` | 떠 있는 면 — 상태 pill, 호버 카드, 필터 팝오버 |
| `8px` | 리스트 표면 — 선택/호버 행, 필터 칩, 칩 추가 버튼 |
| `6px` | 필 안에 드는 작은 것 — 그룹 헤더 카운트, 칩 × 버튼 |
| `30%` | 런타임 아바타 스퀘클 |
