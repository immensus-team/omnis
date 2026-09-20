# Phase A 종단 스모크 리포트

생성: 2026-09-20T09:17:31.562Z · `pnpm e2e:phase-a` (tools/e2e/run.ts)

스택: PostgreSQL `omnis_e2e` (마이그레이션 0001–0008 + Zero permissions) → zero-cache :4848
→ 허브 :8787 (HTTP + WS /bridge) → 로컬 에이전트 브리지(mock 런타임 픽스처, host=macbook)
→ 데스크톱 Vite dev :5173 → Playwright(chromium, headless).

시드는 전부 실제 코드 경로다: 어댑터 `normalize()` → 커널 `IngestSink`,
커널 `approvals.propose`, `@omnis/agents`의 `classify()`(T0 규칙 경로, 네트워크 호출 없음),
`ClaudeCodeAdapter` + `apps/local-agent/test` 픽스처 재생.

## Pass 1 (7.1s, items=13)

| 결과 | 검증 | 소요 | 비고 |
| --- | --- | --- | --- |
| PASS | A1 Inbox lists every seeded item | 106ms | 13 rows |
| PASS | A2 Inbox rows show a visible channel icon for all three channels | 9ms | SL / GM / GC |
| PASS | A2b Inbox rows show the seeded thread titles | 3ms | #omnis-launch / omnis launch sync |
| PASS | A3 Inbox rows carry label chips | 1ms |  |
| PASS | A4 work/personal filter pills change the list | 83ms | all=13 work=7 personal=1 |
| PASS | A5 Thread screen renders seeded items with status badges | 40ms | 4 status badges |
| PASS | A6 Agent Session screen shows turns and a ToolCallBadge | 36ms |  |
| PASS | A7 Approval card shows the pending approval | 11ms |  |
| PASS | A8 Approve → hub moves the approval to decided | 54ms | pending → decided |
| PASS | A9 ⌘K opens the command palette | 13ms |  |
| PASS | G5 a new item reaches the UI in ≤2s | 69ms | 28ms ingest → 화면 (목표 ≤2000ms) |
| PASS | A8b hub recorded audit_log(approval.decided) | 2ms | 1 row(s) |
| PASS | A8c pending_approvals.state moved to decided(accept) | 0ms | state=decided decision=accept |
| PASS | A10 classify() recorded a T0 run in agent_runs (no network) | 0ms | 1 run(s), tier=T0 |
| PASS | A11 local-agent registered over WS /bridge | 0ms | agent_runtimes state=online |

## Pass 2 (7.3s, items=13)

| 결과 | 검증 | 소요 | 비고 |
| --- | --- | --- | --- |
| PASS | A1 Inbox lists every seeded item | 106ms | 13 rows |
| PASS | A2 Inbox rows show a visible channel icon for all three channels | 9ms | SL / GM / GC |
| PASS | A2b Inbox rows show the seeded thread titles | 2ms | #omnis-launch / omnis launch sync |
| PASS | A3 Inbox rows carry label chips | 2ms |  |
| PASS | A4 work/personal filter pills change the list | 83ms | all=13 work=7 personal=1 |
| PASS | A5 Thread screen renders seeded items with status badges | 40ms | 4 status badges |
| PASS | A6 Agent Session screen shows turns and a ToolCallBadge | 36ms |  |
| PASS | A7 Approval card shows the pending approval | 12ms |  |
| PASS | A8 Approve → hub moves the approval to decided | 39ms | pending → decided |
| PASS | A9 ⌘K opens the command palette | 14ms |  |
| PASS | G5 a new item reaches the UI in ≤2s | 68ms | 29ms ingest → 화면 (목표 ≤2000ms) |
| PASS | A8b hub recorded audit_log(approval.decided) | 1ms | 1 row(s) |
| PASS | A8c pending_approvals.state moved to decided(accept) | 0ms | state=decided decision=accept |
| PASS | A10 classify() recorded a T0 run in agent_runs (no network) | 0ms | 1 run(s), tier=T0 |
| PASS | A11 local-agent registered over WS /bridge | 0ms | agent_runtimes state=online |

## 멱등성

두 번 연속 실행 결과가 동일하다 (PASS).

## 읽는 법 (이 리포트가 주장하지 않는 것)

- **Inbox는 스레드가 아니라 item 목록이다.** A1의 13행은 시드된 item 13개이고, 한 스레드의
  여러 메시지가 각자 행으로 선다. 행 제목은 스레드 제목이다 — Phase A의 커널 IngestSink는
  author_person_id를 의도적으로 비워 두고(person 신원 해석은 Phase B) Slack 메시지에는
  subject가 없기 때문이다. A2b가 그 제목이 실제로 화면에 있는지 본다.
- **A2는 접근성 이름이 아니라 보이는 글리프를 본다.** 원래 main의 `.inbox-row__channel`은
  aria-label만 있고 내용도 CSS도 없어서 눈에는 아무것도 안 보였다 — 이 브랜치의 커밋
  `fix(desktop): render the Inbox channel icon…`에서 고쳤고(채널 모노그램 + 미읽음/승인
  점 CSS), A2가 글리프 텍스트까지 확인한다.
- **T1(DeepSeek/OpenRouter) 호출은 강제로 막혀 있다.** 시드가 classify()를 부르기 전에
  OMNIS_OPENROUTER_API_KEY를 비운다 — 규칙 1단이 안 맞아 3단까지 흘러내려도 t1Model()이
  fetch 전에 던진다. A10은 그와 별개로 기록된 run이 tier=T0인지 본다.
- **이 스모크를 다시 돌리면 REPORT.md와 evidence/ PNG가 덮어써진다.** 머지 전에 돌렸다면
  `git checkout -- tools/e2e`로 되돌리거나, 새 결과를 그대로 커밋해야 한다.

## 증거

`tools/e2e/evidence/`의 PNG 7장 (01-inbox / 02-inbox-filter-work / 03-thread /
04-agent-session / 05-approval-card / 06-command-palette / 07-g5-live-item).
05는 승인 카드 요소만 잘라 찍는다 — 전체 화면으로 찍으면 04와 완전히 같은 그림이 된다
(셸이 승인 카드를 상세 패널 위에 고정해 두기 때문에 04에도 이미 떠 있다).

## 로그

`tools/e2e/.logs/`의 hub.log · zero-cache.log · desktop.log (커밋 대상 아님).
