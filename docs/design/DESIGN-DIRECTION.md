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
