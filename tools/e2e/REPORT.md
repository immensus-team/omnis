# Phase A 종단 스모크 리포트

생성: 2026-09-20T15:44:13.000Z · `pnpm e2e:phase-a` (tools/e2e/run.ts)

스택: PostgreSQL `omnis_e2e` (마이그레이션 0001–0008 + Zero permissions) → zero-cache :4848
→ 허브 :8787 (HTTP + WS /bridge) → 로컬 에이전트 브리지(mock 런타임 픽스처, host=macbook)
→ 데스크톱 Vite dev :5173 → Playwright(chromium, headless).

시드는 전부 실제 코드 경로다: 어댑터 `normalize()` → 커널 `IngestSink`,
커널 `approvals.propose`, `@omnis/agents`의 `classify()`(T0 규칙 경로, 네트워크 호출 없음),
`ClaudeCodeAdapter` + `apps/local-agent/test` 픽스처 재생.

## Pass 1 (10.7s, items=13)

| 결과 | 검증 | 소요 | 비고 |
| --- | --- | --- | --- |
| PASS | A1 Inbox lists one row per seeded thread (U2: 행이 item이 아니라 thread 단위) | 9ms | 7 thread rows (item count was 13) |
| PASS | A2 Inbox rows show a visible channel icon for all three channels | 26ms | Slack 메시지 / Gmail 메시지 / Google Calendar 메시지 |
| PASS | A2b Inbox rows show the seeded thread titles | 2ms | #omnis-launch / omnis launch sync |
| PASS | A3 Inbox rows carry label chips | 2ms |  |
| PASS | A2c kinso shell: channel rail tiles + ask/search bar | 8ms | rail: Inbox/Slack/Gmail/Google Calendar/Agent + ask bar |
| PASS | A2d a conversation row has avatar + name + relative time + summary | 4ms | time="now" summary="초안: 네, 오늘 중으로 리뷰할게요.…" |
| PASS | A4 work/personal filter pills change the list | 110ms | all=7 work=[#omnis-launch] personal=[PoC slides] |
| PASS | A4b channel rail tile filters the list, Inbox tile restores it | 68ms | all=7 gmail=2 |
| PASS | A5 Thread screen renders seeded items with status badges | 41ms | 4 status badges |
| PASS | A6 Agent Session screen shows turns and a ToolCallBadge | 44ms |  |
| PASS | A7 Approval card shows the pending approval | 11ms |  |
| PASS | A8 Approve → hub moves the approval to decided | 39ms | pending → decided |
| PASS | A9 ⌘K opens the floating AI panel and types into the command list | 27ms | panel + cmdk list reachable by typing |
| PASS | A-archive 행 보관 → 목록에서 사라지고, 되살리면 돌아온다 | 330ms | "omnis launch sync" archived → restored (7 rows), audit_log 2종 기록 |
| PASS | G5 a new item reaches the UI in ≤2s | 70ms | 27ms ingest → 화면 (목표 ≤2000ms) |
| PASS | A8b hub recorded audit_log(approval.decided) | 1ms | 1 row(s) |
| PASS | A8c pending_approvals.state moved to decided(accept) | 0ms | state=decided decision=accept |
| PASS | A10 classify() recorded a T0 run in agent_runs (no network) | 0ms | 1 run(s), tier=T0 |
| PASS | A11 local-agent registered over WS /bridge | 0ms | agent_runtimes state=online |

## Pass 2 (11.5s, items=13)

| 결과 | 검증 | 소요 | 비고 |
| --- | --- | --- | --- |
| PASS | A1 Inbox lists one row per seeded thread (U2: 행이 item이 아니라 thread 단위) | 15ms | 7 thread rows (item count was 13) |
| PASS | A2 Inbox rows show a visible channel icon for all three channels | 45ms | Slack 메시지 / Gmail 메시지 / Google Calendar 메시지 |
| PASS | A2b Inbox rows show the seeded thread titles | 5ms | #omnis-launch / omnis launch sync |
| PASS | A3 Inbox rows carry label chips | 4ms |  |
| PASS | A2c kinso shell: channel rail tiles + ask/search bar | 15ms | rail: Inbox/Slack/Gmail/Google Calendar/Agent + ask bar |
| PASS | A2d a conversation row has avatar + name + relative time + summary | 7ms | time="now" summary="초안: 네, 오늘 중으로 리뷰할게요.…" |
| PASS | A4 work/personal filter pills change the list | 140ms | all=7 work=[#omnis-launch] personal=[PoC slides] |
| PASS | A4b channel rail tile filters the list, Inbox tile restores it | 86ms | all=7 gmail=2 |
| PASS | A5 Thread screen renders seeded items with status badges | 41ms | 4 status badges |
| PASS | A6 Agent Session screen shows turns and a ToolCallBadge | 35ms |  |
| PASS | A7 Approval card shows the pending approval | 13ms |  |
| PASS | A8 Approve → hub moves the approval to decided | 45ms | pending → decided |
| PASS | A9 ⌘K opens the floating AI panel and types into the command list | 25ms | panel + cmdk list reachable by typing |
| PASS | A-archive 행 보관 → 목록에서 사라지고, 되살리면 돌아온다 | 329ms | "omnis launch sync" archived → restored (7 rows), audit_log 2종 기록 |
| PASS | G5 a new item reaches the UI in ≤2s | 87ms | 26ms ingest → 화면 (목표 ≤2000ms) |
| PASS | A8b hub recorded audit_log(approval.decided) | 1ms | 1 row(s) |
| PASS | A8c pending_approvals.state moved to decided(accept) | 0ms | state=decided decision=accept |
| PASS | A10 classify() recorded a T0 run in agent_runs (no network) | 0ms | 1 run(s), tier=T0 |
| PASS | A11 local-agent registered over WS /bridge | 0ms | agent_runtimes state=online |

## 멱등성

두 번 연속 실행 결과가 동일하다 (PASS).

## 읽는 법 (이 리포트가 주장하지 않는 것)

- **Inbox는 U2(kinso 대화 행)부터 스레드 목록이다.** 한 스레드의 여러 메시지는 행 하나로
  합쳐지고(가장 최근 item), 행 제목은 사람 표시명 → 스레드 제목 → 채널 핸들 순으로 정해진다 —
  Phase A의 커널 IngestSink는 author_person_id를 의도적으로 비워 두어(person 신원 해석은
  Phase B) 모든 시드 행이 스레드 제목으로 떨어진다. A1이 스레드 수를, A2b가 그 제목이 실제로
  화면에 있는지 본다.
- **A2는 접근성 이름이 아니라 눈에 보이는 아이콘을 본다.** 채널 아이콘은 react-icons/si
  SVG다(U2 이전엔 모노그램 텍스트였다) — A2가 svg 자식 노드와 non-zero bounding box로
  "정말 뭔가 그려져 있다"를 확인한다.
- **A2c/A2d가 kinso 셸과 행 해부를 본다.** A2c는 왼쪽 채널 레일 타일(Inbox/Slack/Gmail/
  Google Calendar/Agent)과 상단 "Start typing to ask or search" 필바가 떠 있는지, A2d는 한
  행 안에 아바타 · 이름 · **상대시간 문법**(now/3m/2w/4 Aug — ISO 타임스탬프가 아님) · 비어
  있지 않은 요약 줄이 다 있는지 본다. 이 둘이 없으면 A1/A2/A2b는 요약 줄이 통째로 빠져도 통과한다.
- **A4는 개수가 아니라 신원을 본다.** 행이 thread 단위가 된 U2 이후로 시드의 work 스레드와
  personal 스레드는 각각 1개다 — "개수가 다르다"는 더 이상 성립하지 않아(U2 머지에서 실제로
  깨졌다) 두 필터의 행 집합이 서로 겹치지 않고 둘 다 all의 진부분집합인지로 바꿨다.
  A4b는 레일 타일 클릭이 목록을 좁히고 Inbox 타일이 되돌리는지를 따로 본다.
- **T1(DeepSeek/OpenRouter) 호출은 강제로 막혀 있다.** 시드가 classify()를 부르기 전에
  OMNIS_OPENROUTER_API_KEY를 비운다 — 규칙 1단이 안 맞아 3단까지 흘러내려도 t1Model()이
  fetch 전에 던진다. A10은 그와 별개로 기록된 run이 tier=T0인지 본다.
- **이 스모크를 다시 돌리면 REPORT.md와 evidence/ PNG가 덮어써진다.** 머지 전에 돌렸다면
  `git checkout -- tools/e2e`로 되돌리거나, 새 결과를 그대로 커밋해야 한다.

## 증거

`tools/e2e/evidence/`의 PNG 8장 (01-inbox / 02-inbox-filter-work / 03-thread /
04-agent-session / 05-approval-card / 06-command-palette / 07-g5-live-item /
08-archived — "보관됨" pill을 켠 Archived 뷰, US-A36).
05는 승인 카드 요소만 잘라 찍는다 — 전체 화면으로 찍으면 04와 완전히 같은 그림이 된다
(셸이 승인 카드를 상세 패널 위에 고정해 두기 때문에 04에도 이미 떠 있다).

## 로그

`tools/e2e/.logs/`의 hub.log · zero-cache.log · desktop.log (커밋 대상 아님).
