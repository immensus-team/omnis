# GAP 1 — Eve self-hosting: re-opening the harness decision

Fetched/spiked 2026-09-20.

## 1. TL;DR

`11-agent-harness.md`가 Vercel Eve를 "Vercel Functions 배포를 전제해 상시 가동 Mac mini와 궁합이 나쁘다"는 이유 하나로 기각했는데, 이 전제가 **틀렸다**. eve.dev 공식 문서와 실제 스파이크(로컬 Postgres 위에서 `eve build && eve start`)로 확인: eve는 순수 Node/Nitro 서버로 self-host되고, `@workflow/world-postgres`라는 실재하는 패키지로 상태를 로컬 Postgres에 영구 저장하며, cron도 Nitro 자체 스케줄러가 돌린다. Slack 채널(env-var 방식), 승인 게이트 툴, 스케줄, postgres world를 모두 넣고 빌드·기동·헬스체크까지 성공했고 idle RSS는 프로세스 두 개 합쳐 ~550MB. 하지만 "커널로 채택"할지는 별개 문제다 — eve는 이벤트버스가 아니라 "에이전트 디렉토리 = 별도 Node 서버 + 별도 Postgres 스키마"이므로, omnis에 필요한 5~10개 능력을 다 Eve화하면 16GB 예산에서 프로세스가 N개로 늘어난다. 결론: 커널은 11의 원안대로 Postgres 위에 손으로 짓고, Eve는 승인+스케줄+채널이 다 필요한 개별 에이전트(답장 초안, 야간 다이제스트 등) 1~2개에 한정 도입.

## 2. Facts

- **VERIFIED** — eve.dev의 공식 배포 문서는 self-hosting을 명시적으로 지원한다: "For self-managed infrastructure, eve compiles to a standard Nitro server under `.output/` that runs as a Node service... Choose this when you operate your own Node or container infrastructure." Source: [eve.dev/docs/deployment](https://eve.dev/docs/deployment), 2026-09-20 조회.
- **VERIFIED** — self-hosting 절차는 `eve build` 후 `PORT=3000 eve start --host 0.0.0.0`이며, "Run this process under the same process manager or container platform you use for other Node web services." Source: [eve.dev/docs/deployment/self-hosting](https://eve.dev/docs/deployment/self-hosting), 2026-09-20 조회.
- **VERIFIED** — 기본(default) Workflow world는 실행 상태를 `.eve/.workflow-data` 아래 디스크에 저장하며, `agent.ts`에서 `experimental.workflow.world`로 설치된 world 패키지(예: `@workflow/world-postgres`)를 지정할 수 있다. Source: 위와 동일 + `node_modules/eve/docs/concepts/execution-model-and-durability.mdx` (스파이크로 직접 확인).
- **VERIFIED** — self-host 시 리버스 프록시가 반드시 포워딩해야 하는 두 경로: `/eve/`(health, sessions, streams, channels, tools, subagents)와 `/.well-known/workflow/`(워크플로 콜백). "A proxy restricted to `/eve/` lets a session start, but the run stalls when its callback can't reach eve." Source: self-hosting doc, 2026-09-20.
- **VERIFIED** — Nitro의 스케줄 러너는 `eve build && eve start` 경로에서 자동으로 시작된다("The standard `eve build && eve start` path starts Nitro's schedule runner"); 커스텀 HTTP-only 프리셋으로 바꾸면 cron이 등록만 되고 실제로 안 돈다는 명시적 경고가 있다. Source: self-hosting doc + `node_modules/eve/docs/schedules.mdx` "Self-deployed hosts" 섹션.
- **VERIFIED** — 프로덕션 인증 관련 명시적 경고: "Don't rely on `vercelOidc()` as the only production authenticator outside Vercel." Source: self-hosting doc, 2026-09-20.
- **VERIFIED (스파이크로 직접 확인)** — `@workflow/world-postgres`(npm, 최신 `5.0.0-beta.44`, eve 0.63.0이 요구하는 `@workflow/*` "5.0.0-beta" 라인과 프로토콜 호환)는 실존하며 `WORKFLOW_POSTGRES_URL` 또는 `DATABASE_URL` 환경변수로 연결한다. Graphile Worker(큐) + Drizzle ORM + `pg` 위에서 동작. Source: `npm view @workflow/world-postgres`, 패키지 README, 2026-09-20.
- **VERIFIED (스파이크로 직접 확인, 문서에 없던 gotcha)** — self-hosting.md는 world 패키지를 "선택"하라고만 하고 끝나지만, 실제로는 그 전에 `npx --package=@workflow/world-postgres bootstrap`으로 스키마 마이그레이션을 먼저 돌려야 한다. 안 하면 `eve start`가 `relation "workflow.workflow_runs" does not exist`로 즉시 죽는다(스파이크에서 재현·해결함). 생성되는 테이블: `workflow_runs`, `workflow_events`, `workflow_steps`, `workflow_hooks`, `workflow_stream_chunks`, `workflow_waits`, `workflow_event_slots` (`workflow` 스키마 아래).
- **VERIFIED (스파이크로 직접 확인)** — `npx eve@latest init`은 `eve@0.63.0` 기준 **Node ≥24를 강제**한다(`package.json`의 `engines.node: "24.x"`; Node 22로 실행하면 `eve requires Node.js >=24`로 즉시 실패). Mac mini의 실제 Node 버전은 이번 세션에서 미확인(스파이크는 MacBook Pro에서 수행, Node 22와 24 둘 다 brew로 설치돼 있어 24로 전환해 진행).
- **VERIFIED (스파이크로 직접 확인)** — Slack 채널, `always()` 승인 게이트가 걸린 커스텀 툴, cron 스케줄(`defineSchedule`), `@workflow/world-postgres`를 모두 넣은 상태로 `eve build`가 성공했다(출력 12MB/2.71MB gzip, `node_modules` 168MB). Slack 채널은 Vercel Connect 없이 env var(`SLACK_BOT_TOKEN`) 방식으로도 컴파일된다 — self-host에 Vercel Connect가 강제되지 않음을 코드 레벨로 확인.
- **VERIFIED (스파이크로 직접 확인)** — `eve start`는 코딩 에이전트 세션과 무관하게 독립된 백그라운드 Node 프로세스로 살아남았다(`nohup`으로 분리 실행, 이후 여러 번의 별도 명령에서도 계속 응답). `GET /eve/v1/health` → `{"ok":true,"status":"ready","workflowId":"workflow//eve//workflowEntry"}` (HTTP 200).
- **VERIFIED (스파이크로 직접 확인)** — 프로덕션 빌드는 기본적으로 인증 없는 요청을 거부한다: `POST /eve/v1/session`을 토큰 없이 호출하면 `401 {"code":"unauthorized","error":"Authorization is required for this route."}` — self-hosting.md의 "replace `placeholderAuth()` with production authentication" 경고가 실제로 강제됨을 확인.
- **VERIFIED (스파이크로 직접 확인)** — 스케줄(`agent/schedules/heartbeat.ts`)은 빌드 시 `.output/server/_virtual/eve.schedule.mjs`라는 별도 Nitro scheduled-task 모듈로 컴파일됐다(`dispatchScheduleTask` 호출) — 문서의 "Nitro's schedule runner" 주장이 실제 산출물 레벨에서 확인됨.
- **VERIFIED (스파이크로 직접 확인)** — idle 상태(트래픽 없음, 세션 없음) 메모리: `eve start` CLI 래퍼 프로세스 RSS ≈303MB, 그 자식인 실제 빌드 서버(`​.output/server/index.mjs`) RSS ≈250MB, 합계 ≈550MB. Graphile Worker가 `maxPoolSize(10) < concurrency(50)` 경고를 로그로 남김(둘 다 기본값 — 운영 전 튜닝 필요). **측정 환경은 64GB MacBook Pro였고 16GB Mac mini 실측은 아님** — 참고치이지 확정치 아님.
- **VERIFIED** — `vercel/eve` 저장소: 5,270★, Apache-2.0, `pushed_at: 2026-09-19` (하루 전, 활발), open issues 857건. Source: `gh api repos/vercel/eve`, 2026-09-20.

## 3. Options / Comparison

| | Vercel Eve (self-host) | 11의 손수 구축 커널 (Postgres events + LISTEN/NOTIFY + node-cron + pending_approvals) |
|---|---|---|
| 배포 형태 | 순수 Node/Nitro 서버 (`eve build && eve start`), Vercel 불필요 | 이미 그렇게 설계됨(항상 self-host) |
| 상태 저장 | `@workflow/world-postgres` — 기존 로컬 Postgres에 붙일 수 있음(스파이크로 확인) | 이미 같은 Postgres |
| 승인 게이트 | 내장. `never/once/always/auto()` + 커스텀 정책 함수, request/response 권한 분리, durable pause(프로세스 재시작에도 살아남음) | 직접 설계·구현 필요(`pending_approvals` 테이블 + 폴링) |
| 스케줄 | 내장(`defineSchedule`, Nitro 스케줄 러너가 자동 기동) | `node-cron` 직접 배선 |
| 채널 어댑터 | Slack/Discord/Telegram/Teams/Twilio/GitHub/Linear/MCP 등 사전 제공(승인을 네이티브 버튼으로 렌더링) | 채널마다 직접 구현(어차피 KakaoTalk은 Eve에도 없음) |
| 프로세스 모델 | **에이전트 1개 = Node 서버 1개 + 포트 1개 + (world 공유 안 하면) 스키마 1개** | 이벤트버스 1개가 여러 능력을 처리 — 프로세스 수 안 늘어남 |
| 성숙도/드리프트 리스크 | 공개 3개월, `@workflow/*` 프로토콜이 "5.0.0-beta" 라인에 핀되어 있고 불일치 버전은 런타임이 거부 — breaking change 가능성 있음 | 리스크 0(본인 코드), 유지보수 100% 본인 부담 |
| Node 버전 요구 | ≥24 (스파이크로 확인) | 없음(현재 스택에 맞춤) |
| 16GB 예산 적합성 | 에이전트 1개당 idle ~550MB(미세측정, MacBook 기준) — **N개 도입 시 N배** | 프로세스 1개로 커널 전체 커버 |
| omnis의 "agent 세션 = inbox thread" 요구 | 없음 — Eve의 subagent/remote-agent는 자체 에이전트 간 위임이지, 외부 Claude Code/Codex CLI 세션을 채널로 편입하는 어댑터가 아님(이번 패스에서 `subagents/`, `remote-agents.md` 문서는 미독) | 어차피 커널과 별개로 직접 구현해야 함 — 무관 |

## 4. Recommendation for omnis

**11의 "Eve를 배포 형태 때문에 기각한다"는 근거는 폐기하라 — 사실이 아니다.** eve.dev 1차 문서와 실제 빌드+기동+헬스체크 스파이크로, Eve는 상시 가동 Mac mini 위에서 순수 Node 프로세스로 돌고 로컬 Postgres에 durable 상태를 남긴다는 게 확인됐다. Risk: 낮음(이 특정 주장에 한해서).

**그럼에도 Eve를 omnis의 "커널"로 채택하지는 마라.** 이유는 배포 형태가 아니라 **아키텍처 단위**다: Eve의 단위는 "에이전트 디렉토리 = 별도 Node 서버 프로세스 + (world 공유 안 하면) 별도 Postgres 스키마"다. omnis가 필요로 하는 건 반대로 "하나의 이벤트 버스가 여러 채널/능력을 처리"하는 커널이다. 답장 초안, 야간 다이제스트, 라벨링, CRM 팔로우업 등 5~10개 능력을 전부 별도 Eve 에이전트로 만들면 16GB 예산에서 Node 프로세스가 5~10개로 늘어난다 — 이는 `18-mac-mini-hub-ops.md`의 "VM/프로세스 하나 더 늘리지 마라" 권고와 정면으로 충돌한다. Effort: 이 결론 자체는 재확인일 뿐 추가 작업 없음(S), Risk: 낮음(전략 결정).

**Eve는 "승인+스케줄+채널이 다 필요한 개별 에이전트" 1~2개에 한정 도입하라.** 구체적으로: 컨텍스트 인지 답장 초안 에이전트, 또는 야간 아카이브 다이제스트 에이전트. 둘 다 "cron으로 깨어나서 → 사람 승인 대기 → 채널로 발송"이라는 Eve가 잘 푸는 정확한 모양이다. 이때 world는 각 에이전트가 자기 스키마를 새로 만들게 두지 말고, README에 나온 "기존 `pg.Pool` 공유" 옵션(`createWorld({ pool })`)이나 최소한 하나의 `WORKFLOW_POSTGRES_URL`로 통일해 스키마를 하나로 묶어라. Effort: S(스파이크 기준 반나절/에이전트), Risk: ToS 없음(Apache-2.0), 유지보수 리스크 중간(베타 프로토콜 핀, `eve`/`@workflow/*` 버전 고정 후 계획적으로만 업그레이드).

**커널(이벤트버스+스케줄러+승인게이트) 자체는 11의 원안대로 Postgres 위에 손으로 짓는다는 결론은 그대로 유지.** 다만 근거를 "Eve가 Vercel 전용이라서"에서 "Eve의 프로세스당-에이전트 단위가 omnis의 다능력-단일허브 요구와 안 맞아서"로 교체해야 한다. Effort: M(기존 추정 그대로), Risk: 유지보수(본인 부담) — 변동 없음.

**Node ≥24 요구는 실행 전제조건으로 기록해두라.** Mac mini의 현재 Node 버전이 24 미만이면 Eve를 쓰는 순간(스파이크용이든 실제 1~2개 에이전트든) 업그레이드가 선행 작업이다. 확인 안 된 채로 넘어가면 첫 `npx eve init`에서 바로 막힌다.

## 5. What to borrow

- **승인 정책 API 설계** (`eve/tools/approval`: `never()/once()/always()/auto()` + 커스텀 정책 함수, `session.auth.current` vs `session.auth.initiator` 구분, request와 response를 분리해 "누가 이 특정 호출을 승인할 자격이 있는가"를 따로 검사하는 패턴) — 코드가 아니라 **상태 머신 설계**를 11의 `pending_approvals` 테이블에 그대로 이식할 것. 포인터: `node_modules/eve/docs/tools/human-in-the-loop.md`(스파이크 산출물) 또는 https://eve.dev/docs/tools/human-in-the-loop.
- **`defineSchedule`의 markdown-vs-run 이분법** (fire-and-forget 프롬프트 vs `to(channel).send()` + `waitUntil()`로 제어하는 풀 핸들러) — node-cron으로 손수 만들 omnis 스케줄러에도 그대로 적용할 만한 깔끔한 API 모양. 포인터: https://eve.dev/docs/schedules, `node_modules/eve/docs/schedules.mdx`.
- **`@workflow/world-postgres`의 스키마 설계** (`workflow_runs/events/steps/hooks/stream_chunks/waits/event_slots`) — 11의 커널이 지금 "events 테이블 하나"로 뭉뚱그린 것보다 훨씬 검증된 "큐+스텝+훅+스트림" 분리 모델. 포인터: npm `@workflow/world-postgres` README의 "Database schema" 절, 또는 이번 스파이크의 `eve_spike` DB에 실제로 만들어진 `workflow.*` 테이블들.
- **채널 어댑터 인터페이스의 이름/개념 목록** (Slack/Discord/Telegram/Teams/Twilio/GitHub/Linear/MCP) — omnis 자체 채널 플러그인 인터페이스(Slack/KakaoTalk/Gmail/Outlook/Telegram/LinkedIn/WhatsApp) 설계 시 참고할 이름 짓기·기능 분류 기준으로만 참고(코드는 Vercel Connect에 묶여 있어 그대로 못 가져옴). 포인터: https://eve.dev/docs/channels/overview.
- **`pg.Pool` 공유 옵션** (`createWorld({ pool })`) — omnis가 나중에 특정 부분 기능만 Eve로 붙일 때, 별도 Postgres 커넥션 풀을 새로 열지 않고 기존 앱의 풀을 그대로 넘기는 구체적 코드 패턴. 포인터: `@workflow/world-postgres` README "Programmatic usage" 절.

## 6. Open questions

- Mac mini의 실제 Node 버전이 24 이상인지 미확인 — 이번 스파이크는 MacBook Pro(Node 22→24로 전환)에서 수행했다. 확인 필요.
- `@workflow/world-postgres`의 `bootstrap` 마이그레이션 단계가 self-hosting.md 본문에 안 나와 있는 이유(신버전에서 자동화됐는지, 아니면 그냥 문서 누락인지) — vercel/eve 저장소 이슈 검색 필요.
- 실제 트래픽(동시 세션, 대화 히스토리 누적) 상태에서의 RSS — 이번 측정은 idle·무트래픽 단일 에이전트 기준으로 방향성 참고치일 뿐이다.
- `npx eve start` 대신 `.output/server/index.mjs`를 직접 `node`로 실행하면 CLI 래퍼 프로세스(~300MB)를 아낄 수 있는지 — 미검증.
- `eve build`를 재실행하는 동안 기존 `eve start` 프로세스가 라이브 트래픽을 서빙 중이면 무슨 일이 벌어지는지(무중단 배포 여부) — 미검증.
- Eve의 subagents/remote-agents 기능(`docs/subagents/`, `docs/guides/remote-agents.md`, 이번 패스에서 미독)이 "기존 Claude Code/Codex CLI 세션을 채널처럼 편입"하는 데 조금이라도 쓸 수 있는지, 아니면 그 부분은 harness 선택과 무관하게 100% 자체 구현해야 하는지.

## 7. Sources

- [eve.dev/docs/deployment](https://eve.dev/docs/deployment) — 2026-09-20 조회
- [eve.dev/docs/deployment/self-hosting](https://eve.dev/docs/deployment/self-hosting) — 2026-09-20 조회
- `node_modules/eve/docs/` (via `npx eve@latest init`, eve@0.63.0) — 이번 세션 스파이크 산출물, 2026-09-20
  - `guides/deployment/self-hosting.md`, `concepts/execution-model-and-durability.mdx`, `schedules.mdx`, `tools/human-in-the-loop.md`, `channels/slack.mdx`
- [github.com/vercel/eve](https://github.com/vercel/eve) (via `gh api repos/vercel/eve`, `gh api repos/vercel/eve/readme`) — 2026-09-20
- `@workflow/world-postgres` npm 패키지 및 번들 README (`npm install @workflow/world-postgres@5.0.0-beta.44`) — 2026-09-20
- 실제 스파이크 실행: `/private/tmp/.../scratchpad/eve-spike/my-agent` — `eve build`, `npx --package=@workflow/world-postgres bootstrap`, `eve start --host 127.0.0.1 --port 3811` (로컬 Postgres DB `eve_spike`, macOS, Node v24.21.0), `curl /eve/v1/health`, `curl -X POST /eve/v1/session`(401 확인), `ps`(RSS 측정) — 2026-09-20, 이 세션에서 직접 수행 및 이후 프로세스 종료·정리 완료.
- 기존 리서치(교차 확인용, 재검증 안 함): `11-agent-harness.md`(원 기각 근거), `18-mac-mini-hub-ops.md`(16GB 예산·프로세스 수 제약의 근거).
