# 00 — omnis 리서치 스윕 종합 (2026-09-20)

작성: Fable. 대상: `BRIEF-2026-09-20.md`, `01-definition-draft.md`, `research/01~18`, gap 파일 `20~27`, critique `90`, 각 파일의 Verification(adversarial) 섹션 전부.

이 문서의 재검증 범위: 아래 항목은 이 종합 패스에서 **직접 재확인**했다(2026-09-20 fetch) — MCP 현행 스펙 버전, mem0 OSS graph memory 제거, Google push 도메인 검증 폐지, MS Graph 구독 최대 수명, Eve self-hosting 문서, Claude Code `fable` 티어와 headless 과금, Anthropic Claude Code 법적 문구, DeepSeek 가격표, Beeper Desktop API 지원 채널, kinso.ai 가격 부재, `beeper.com/pricing`·`kinso.ai/pricing` 404, `mautrix/linkedin` #55/#61 상태, Codex 릴리스 cadence, 19개 핵심 레포 메타데이터(star/license/pushed_at/archived). 재검증하지 못한 것은 §8에 명시한다.

---

## 1. 토픽별 한 줄 결론

1. **Kinso·경쟁사** — kinso는 목표 기능셋(tone-matched draft + morning briefing + contextual linking)의 정답지이지만 가격·플랫폼·캡처 메커니즘이 전부 미공개라 아키텍처 벤치마크로는 쓸 수 없고 UX 레퍼런스로만 유효하다. `01-kinso-and-competitors.md`
2. **block/buzz** — 포크하지 말고 아이디어 세 개(agent=channel member, ACP 하네스 파이프라인, kind 기반 dispatch)만 가져온다. Nostr/Schnorr 전체는 1인용에 과설계. `02-block-buzz.md`
3. **Google Artemis** — Android 전용 QA 자동화 도구로 omnis와 무관(채택 안 함). Flash/Pro 이중 프로파일 분리 패턴만 차용. `03-google-artemis.md`
4. **Beeper/Matrix 브릿지** — Beeper Desktop API는 로컬 REST+MCP+Tailscale Remote Access로 omnis 토폴로지에 정확히 맞지만 KakaoTalk 미지원, LinkedIn 브릿지 고장, 가격 게이팅 미확정. `04-beeper-matrix-bridges.md`
5. **KakaoTalk** — `channprj/kmsg`(macOS Accessibility, MIT, ★266)가 유일한 실전 경로이고 LOCO 재구현은 카카오 운영정책 문언에 정면으로 걸린다. `05-channel-kakaotalk.md`
6. **LinkedIn** — 공식 Messages API는 개인에게 닫혀 있고, `mautrix/linkedin`은 로그인 20초 후 세션 사망 버그(#55)가 오늘까지 미해결이라 Playwright 상주 프로필이 현실적 MVP다. `06-channel-linkedin.md`
7. **WhatsApp/Telegram** — WhatsApp은 whatsmeow 계열(ToS 회색지대, ban 확률 미정량), Telegram은 공식 api_id로 mtcute를 쓰는 정상 트랙(gramjs는 2026-07-14 archived). `07-channel-whatsapp-telegram.md`
8. **Slack/Gmail/Outlook/Calendar** — 전부 공식 API로 outbound-only 실시간 달성 가능: Slack Socket Mode+xoxp, Gmail watch+Pub/Sub pull, Outlook Graph delta→webhook, Calendar는 push 재검토 필요. `08-channel-slack-email-calendar.md`
9. **에이전트=인박스 스레드** — ACP/A2A는 과설계이고, 각 에이전트의 네이티브 headless 표면을 얇게 감싸는 자체 session bus가 정답이며 Hermes의 session-key/session-id 분리가 이 스윕 전체에서 가장 재사용 가치 높은 단일 발견이다. `09-agents-as-inbox.md`
10. **오픈소스 메모리** — Hermes/OpenClaw 공통 패턴(flat-file self-model + pluggable provider)을 복제하고, 저장은 mem0 OSS + Postgres 커스텀 bi-temporal 엔티티 테이블 하이브리드. `10-memory-oss.md`
11. **에이전트 하네스** — Vercel AI SDK 7은 모델 호출 계층으로만 쓰고 kernel(이벤트버스+스케줄러+승인게이트)은 기존 Postgres 위에 직접 짓는다. `11-agent-harness.md`
12. **비용 최적화** — 4티어 cascade(로컬 분류 → DeepSeek Flash → Claude Sonnet/Haiku 에스컬레이션 → 구독 CLI)로 런타임 추정 월 $20~50, 단 이는 실측이 아닌 모델 기반 추정. `12-cost-optimization.md`
13. **클라이언트/동기화** — macOS는 Tauri 2, iPhone은 PWA→네이티브 전환, 허브 접근은 Tailscale Serve(+TailscaleKit), sync는 Zero. `13-client-arch-sync.md`
14. **Apple 디자인 언어** — Liquid Glass는 컨트롤/내비게이션 레이어에만, 콘텐츠(리스트·본문)는 불투명. 다크 우선 + 단일 액센트 + ⌘K 커맨드 팔레트를 핵심 인터랙션으로. `14-apple-ui-design-language.md`
15. **보안/프라이버시** — 인박스 전체 + 실행 권한을 한 프로세스에 모으는 구조라 prompt injection이 1순위 리스크이고, 방어선은 프롬프트가 아니라 tool 가용성·승인 게이트·감사로그·kill switch다. `15-security-privacy.md`
16. **Hot repo README** — goose의 간결함 + hermes의 태그라인 공식 + openclaw의 옴니채널 프레이밍 하이브리드, 모션 데모는 어느 레포도 안 하는 차별화 지점. `16-hot-repo-readme.md`
17. **Todo/브리핑/Network/노트라우팅** — Dex(MCP 서버 보유)가 Network의 1순위 레퍼런스, folk의 Follow-up Assistant가 노트→라우팅의 유일한 근접 전례, "에이전트가 먼저 위임"은 상용 전례가 없는 미검증 영역. `17-todo-briefing-network-notes.md`
18. **맥미니 허브 운영** — LaunchDaemon은 GUI에 접근 불가(Apple TN2083)라 KakaoTalk/브라우저는 반드시 로그인 세션의 LaunchAgent여야 하고, 자동 로그인+화면 비잠금이 구조적 전제조건이다. `18-mac-mini-hub-ops.md`
19. **[GAP] Eve self-host** — `11`의 기각 근거("Vercel 전용")는 **틀렸다**. 실제 스파이크로 로컬 Postgres 위 `eve build && eve start` 기동·헬스체크 성공. 그러나 "에이전트 1개 = Node 서버 1개(idle ~550MB)"라는 프로세스 모델 때문에 kernel로는 여전히 부적합. `20-gap-eve-self-host-spike.md`
20. **[GAP] 채널 계층 bake-off** — 단일 계층 전제 자체가 틀렸고, 7채널 중 Beeper가 실질적으로 이득인 건 WhatsApp 하나뿐이다. `21-gap-channel-layer-bakeoff.md`
21. **[GAP] 선행 구현체 소스 읽기** — Draft는 별도 테이블이 아니라 Item의 status여야 하고(agentic-inbox), Action 승인 객체는 agent-inbox의 `HumanInterrupt/HumanResponse`를 그대로 이식하며, 승인은 프롬프트가 아니라 **tool 집합 설계**로 강제한다. `22-gap-read-the-prior-art-source.md`
22. **[GAP] Kinso 비주얼 티어다운** — 리스트는 hairline 없이 선택 행만 카드로 elevate, 채널 식별은 색이 아니라 우측 고정 브랜드 아이콘, 다크모드는 존재하지 않음(라이트 전용). `23-gap-kinso-visual-teardown.md`
23. **[GAP] ralph 개발 파이프라인** — OMC `ralph` skill + worktrunk worktree 격리 + DeepSeek 위임 티어 추가로 완성되며, **`fable`은 headless에서 동의 프롬프트 없이 과금되므로 무인 루프에서 배제**해야 한다. `24-gap-ralph-loop-dev-pipeline.md`
24. **[GAP] standalone·Kakao 세션 규칙** — G6를 "5채널+에이전트+캘린더만 hub-less"로 재정의해야 하고, Kakao 공식 정책이 "PC 에뮬레이터 등 비정상 환경"을 탐지 트리거로 명시해 에뮬레이터 경로는 슬롯 숫자와 무관하게 위험하다. `25-gap-standalone-and-kakao-session-rule.md`
25. **[GAP] 메모리 ingestion/eval** — **mem0 OSS는 graph memory를 완전히 제거했다**(Platform 전용). 따라서 Postgres 커스텀 엔티티 테이블은 "선택"이 아니라 "필수"이고, Drive/GitHub 웹훅은 공인 HTTPS가 필요해 폴링이 기본값이다. `26-gap-memory-ingestion-and-eval.md`
26. **[GAP] 이벤트 볼륨/sync 예산** — 실측상 Claude Code 한 턴의 92%는 프로세스 기동당 1회 나가는 `system/init`이고 실콘텐츠는 ~4.8KB. 절대량은 작지만 토큰 델타를 그대로 복제하면 G5(2초)를 깎아먹으므로 **3티어 분리**(ephemeral/durable/cold)가 답. `27-gap-event-volume-and-sync-budget.md`
27. **[critique] 스윕 자체의 결함** — 채널 권고 간 미조정, 소스코드 0줄 열람, kinso 실사 부재, 빌드 프로세스 미조사 — gap 20~27이 이 8개 중 8개를 닫았고 남은 것은 실기 스파이크(§6)뿐이다. `90-critique.md`

---

## 2. 아키텍처 결정 후보

### 2.1 Fork A — 채팅 집계 계층

| 옵션 | 근거 포인터 | 검증 상태 | 판정 |
|---|---|---|---|
| Beeper Desktop API 단일 계층 | `04` §2(로컬 REST+MCP, Remote Access `0.0.0.0`+`X-Forwarded-*`, Tailscale 권장) | 채널 목록·경고 문구·Remote Access는 오늘 재확인 VERIFIED. **가격 게이팅은 여전히 UNVERIFIED**(`beeper.com/pricing` 오늘도 404) | ✗ 단일 계층으로는 불가 |
| 채널별 전용 어댑터 전부 | `06`/`07`/`08` 각 권고 | 각 채널 1차 소스 VERIFIED | △ 총 effort 최대 |
| **하이브리드(채널별 최적)** | `21` §3 결정표 | LinkedIn 브릿지 고장은 오늘 `gh api`로 재확인(#55 open 2026-05-09, PR #61 open·미병합 2026-08-17) | **✓ 증거가 지지** |
| mautrix 풀 셀프호스트 | `04` §3 | AGPL-3.0, 16GB에 홈서버+브릿지 N개 | ✗ 지금은 아님, Phase D 재검토 |

**근거**: Beeper는 "커버리지가 큰 하나의 벤더"이지 "모든 채널의 최적 구현"이 아니다. Telegram/Slack은 공식 실시간 트랙이 이미 더 안전하고, LinkedIn은 Beeper가 의존하는 upstream이 고장나 있으며, 실제 이득은 WhatsApp(+덤으로 Instagram/Signal/Discord/X) 하나로 좁혀진다.

### 2.2 Fork B — 채널별 경로

`04`(Beeper 우선)와 `06`/`07`/`08`(각자 구현)의 모순은 `21`이 해소했다. §3 매트릭스 참조. 한 가지만 덧붙인다: `07`은 whatsapp-web.js를 Chromium 무게와 탐지 신호 때문에 기각하고 whatsmeow를 택했고, `15`는 whatsapp-web.js를 *더 낮은* ban 리스크로 택했다 — **`07`이 더 잘 소싱됐다**(레포 메타데이터 + 프로토콜 계층 논증 vs 벤더 블로그 1건). 그리고 `21`의 Beeper-for-WhatsApp 결론은 이 둘과 충돌하지 않는다: Beeper 내부도 whatsmeow 계열이라 리스크 근원이 동일하고 유지보수 주체만 바뀐다.

### 2.3 Fork C — 에이전트 세션 버스 / kernel

| 옵션 | 근거 포인터 | 검증 상태 | 판정 |
|---|---|---|---|
| ACP 또는 A2A 채택 | `09` §2 | ACP 레지스트리는 49~60+ agents(원문 "25+"는 stale). A2A는 150+ orgs지만 사용 깊이 UNVERIFIED | ✗ 1유저·고정 에이전트셋엔 과설계 |
| **자체 thin agent-bridge + Hermes 헤더 패턴** | `09` §4, Hermes `X-Hermes-Session-Key`/`X-Hermes-Session-Id` 분리 | Hermes 1차 문서 CONFIRMED(이 스윕에서 가장 강하게 검증된 단일 주장) | **✓ 증거가 지지** |
| `codex mcp-server`로 위임 | `09` §2(3rd-party 블로그) | **REFUTED** — `codex-rs/cli/src/mcp_cmd.rs`에 해당 서브커맨드 없음 | ✗ 존재하지 않음 |
| Eve를 kernel로 | `11` §4(잘못된 기각) → `20`(실측) | 기각 근거는 REFUTED, 그러나 프로세스 모델 문제는 유효 | ✗ kernel 아님, 개별 에이전트 1~2개만 |
| **Postgres 위 자작 kernel** | `11` §4, `20` §4, `22` §4 | events 테이블+`LISTEN/NOTIFY`+cron+`pending_approvals`; NOTIFY 페이로드 8,000B 한도(`27` VERIFIED) | **✓ 증거가 지지** |

**추가 확정(`22`)**: Draft = 별도 테이블이 아니라 Item의 `status`. Action 승인은 `HumanInterrupt{action_request, config:{allow_accept/edit/respond/ignore}, description}` / `HumanResponse{type, args}` 스키마를 이식하되 LangGraph 종속 없이 단순 상태 전이로 구현. 그리고 **비가역 tool(send/delete/delegate)은 자율 루프의 tool palette에 아예 등록하지 않는다** — agentic-inbox가 증명한 구조적 강제다.

**프로토콜 버전 주의**: `09` 본문의 "MCP 현행 스펙 2025-11-25"는 **오늘 재확인 결과 틀렸다**. 현행은 **2026-07-28**이며, `initialize` 핸드셰이크 대신 `_meta.io.modelcontextprotocol/protocolVersion` + `MCP-Protocol-Version` 헤더 기반 per-request 협상, 그리고 mandatory `server/discover` RPC를 쓴다(modelcontextprotocol.io/specification/versioning, 2026-09-20 fetch). omnis 자체 버스 프로토콜을 MCP 관용구로 설계한다면 이 모델을 따라야 한다.

### 2.4 Fork D — 메모리

| 옵션 | 근거 포인터 | 검증 상태 | 판정 |
|---|---|---|---|
| mem0 OSS 단독(그래프 포함) | `10` §4 | **REFUTED** — mem0 OSS는 graph memory를 제거했고 Platform 전용이다(docs.mem0.ai/open-source/graph_memory/overview, 2026-09-20 재확인: "Graph memory is removed from the open-source SDK... graph memory is a Mem0 Platform feature") | ✗ 관계 쿼리 불가 |
| Honcho self-host | `10` §4 fallback | AGPL-3.0(`gh api` 오늘 재확인), peer 모델이 Network와 개념적 정합 | △ fallback, 무수정 격리 호출 조건 |
| Graphiti/Neo4j 1차 저장소 | `10` §3 | 4-timestamp bi-temporal은 소스코드로 CONFIRMED(`graphiti_core/edges.py`), 단 Neo4j 풀스택은 16GB에 과함 | ✗ 스키마만 차용 |
| **3레이어 하이브리드** | `10` §4 + `26` §4 | flat-file self-model / mem0 OSS 벡터 / Postgres bi-temporal 엔티티 | **✓ 증거가 지지 — 단 3레이어는 이제 선택이 아니라 필수** |

**ingestion(`26`)**: Drive는 `changes.list()` + `newStartPageToken` 폴링, GitHub는 ETag conditional request 폴링, 로컬 파일은 FSEvents. 웹훅(push)은 둘 다 공인 HTTPS+유효 SSL을 요구해 Tailscale-only 미니와 충돌하므로 폴링이 기본값. 임베딩은 mem0 TS의 `ollama` provider + `nomic-embed-text-v1.5`(768d, Matryoshka로 256/128 축소 가능, pgvector HNSW 2,000d 한계 안전권)로 로컬 $0.

### 2.5 Fork E — 하네스

- **AI SDK 7을 모델 호출 계층으로만**: `ai@7.0.107`(2026-09-18), v7 major는 2026-06-25. tool-approval 정책 API가 omnis의 draft-then-approve와 1:1. **✓**
- **Eve는 개별 에이전트 1~2개(답장 초안, 야간 다이제스트)에만**: `20`의 실측이 self-host 가능성을 CONFIRMED했고 `@workflow/world-postgres`로 기존 Postgres 공유 가능. 단 Node ≥24 요구, `bootstrap` 마이그레이션 선행 필요, idle RSS ~550MB(64GB 맥북 측정치, 미니 실측 아님). **△ 조건부**
- **Mastra/LangGraph/Temporal/Restate/Inngest**: 전부 더 큰 문제의 답. 16GB에 프로세스를 하나 더 얹을 근거 없음. **✗**
- **Claude Agent SDK(TS)**: 에이전트 세션 브리지에 자연스럽게 맞음. 단 `gh api` license 필드가 `null`이므로 재배포 전 LICENSE 직접 확인. **✓ 보조**

### 2.6 Fork F — 클라이언트 + 동기화

| 축 | 옵션 | 판정 근거 |
|---|---|---|
| macOS | **Tauri 2**(★111,195, 활발) vs RN-macOS vs SwiftUI | ✓ Tauri 2 — TS 재사용, `window-vibrancy`로 네이티브 vibrancy |
| iOS | PWA(`13` MVP 권고) vs Tauri iOS vs Capacitor | **△ 모순 있음** — `13` 자신의 표가 PWA의 Apple-native 느낌을 "낮음"으로 평가하는데 브리프와 `14`는 Apple-native를 필수 요구로 둔다. Logan 결정 필요(§6) |
| 허브 접근 | Tailscale Serve vs **TailscaleKit(tsnet 임베드)** | ✓ Serve로 시작, TailscaleKit 검증 앞당김. `13`의 "가장 큰 리스크" 프레이밍은 **약화됨** — #19147은 댓글 5개에 제3자 DoH 앱 원인 진단이 있다 |
| sync | **Zero(rocicorp/mono)** vs PowerSync vs ElectricSQL vs 자체 WS | ✓ Zero — Postgres 하나로 끝남. PowerSync는 셀프호스트 시 MongoDB가 기본이라 16GB에 부담(`27` §3). "PowerSync가 가장 프로덕션 검증됨"은 어느 1차 소스에도 없는 **자체 마케팅 서술** |
| 이벤트 티어 | **3티어 분리** | ephemeral(델타, WS/NOTIFY, 복제 안 함) / durable(디바운스된 Item row) / cold(raw 전체 로그, 허브 로컬만) — `27` §4 |

### 2.7 Fork G — 비용 정책

- **Tier 0 로컬($0)**: 분류·라벨·임베딩. `12`는 M4 16GB가 MLX 고속 경로(32GB+)를 못 탄다고 지적했고 `90`이 "무료 로컬 분류의 상시 호스트가 없다"고 비판했으나, `26`이 사실상 해소했다 — nomic-embed(274MB)와 1~3B 분류기는 미니에서 Ollama로 충분하고, 32GB+가 필요한 건 30B급 MoE뿐이다. 무거운 로컬 추론만 M5 맥북으로 보낸다.
- **Tier 1 DeepSeek Flash**: cache-hit $0.003/$0.006, cache-miss $0.15/$0.30, output $0.60/$1.20 per 1M(오늘 재확인). peak = UTC Mon–Fri 01–04, 06–10. 야간 배치는 KST 19:00 이후로 스케줄.
- **Tier 2 Claude Sonnet 5 / Haiku 4.5**: VIP·저신뢰·메모리 통합·오케스트레이션.
- **Tier 3 구독 CLI**: unmodified `claude`/`codex` 바이너리를 서브프로세스로. **OAuth 토큰을 Agent SDK로 우회 사용하는 것은 명시 금지**(오늘 원문 재확인).
- 게이트웨이: OpenRouter 1순위(토큰 마크업 0, 카드 충전 5.5%), Vercel AI Gateway는 AI SDK를 쓸 경우 보조.
- 추정 런타임 **월 $20~50** — 실측 아님, 1~2주 로그 후 대체해야 함.

### 2.8 Fork H — 허브 운영

- **daemon/agent 분리는 선택이 아니라 제약**(Apple TN2083): Postgres·Hermes·브리지는 LaunchDaemon, KakaoTalk.app·LinkedIn 브라우저 프로필은 반드시 로그인 세션의 LaunchAgent.
- 자동 로그인 + `pmset -c sleep 0 displaysleep 0 disksleep 0` + `caffeinate` 이중화. FileVault와의 충돌은 미검증(§6).
- 컨테이너는 기존 Lima 위 **Colima**(MIT), Docker Desktop/OrbStack 추가 금지.
- 프로세스 감독 pm2(내부적으로 launchd 등록), 백업 restic+B2, 모니터링 healthchecks.io 무료 20 job + ntfy self-host.
- **`idle_replication_slot_timeout` 기본값이 0(비활성)**이라 zero-cache가 죽으면 WAL이 무한 누적돼 디스크를 채운다 — 명시 설정 + 슬롯 헬스체크가 필수(`27`).

---

## 3. 채널 feasibility 매트릭스

| 채널 | Best route | Fallback | Read/Write | Reliability | Ban/ToS risk | Effort | MVP |
|---|---|---|---|---|---|---|---|
| **Slack** | Socket Mode(WS, outbound-only) + `xoxp` user token | Events API(공인 endpoint 필요) | R/W 완전(검색·타인DM·본인명의 발송) | 높음 — 공식, openclaw manifest 재사용 가능 | 낮음(정상 OAuth 위임). 단 회사 워크스페이스 관리자가 커스텀 앱 설치를 막을 수 있음 | S | **Yes** |
| **Gmail** | `users.watch()` + Cloud Pub/Sub **pull** subscription | `history.list` 폴링 | R/W 완전(label/draft/send) | 높음 — 공인 endpoint 불요, 7일마다 재-watch | 낮음. OAuth를 반드시 Production으로 게시(Testing은 refresh token 7일 만료) | M | **Yes** |
| **Outlook/M365** | Graph API delta 폴링 → 안정화 후 webhook | IMAP+OAuth2 | R/W 완전 | 높음 — 구독 최대 수명 **10,080분(≈7일)**, 갱신 주간 1회면 충분 | 낮음. 개인 사용은 publisher verification 불요 | S→M | Yes(Phase A 후반) |
| **Google Calendar** | `events.list` + `syncToken` 폴링(1~5분) | **`events.watch` push 재시도** | R/W(hold 생성 포함) | 높음 | 낮음 | S | **Yes** |
| **Telegram** | mtcute(MTProto user account, 공식 `api_id`) | Telethon(별도 Python 프로세스) | R/W 완전 + markAsRead | 중상 — mtcute 활발(2026-09-19 push), SQLite 세션 내장. gramjs는 2026-07-14 archived | 낮음 — 비공식 클라이언트는 자동 관찰 대상이나 flooding/spam이 아니면 정상 트랙 | S–M | **Yes** |
| **WhatsApp** | **Beeper Desktop API**(내부 whatsmeow 계열) | whatsmeow Go 사이드카 | R/W(문서상 generic send + read/unread) | 중 — 실험적 WebSocket(`ws://localhost:23373/v1/ws`, 4 이벤트 타입), latency/SLA 문서 없음 | **중** — WhatsApp Web 역공학 자체가 회색지대, ban 확률 미정량. Beeper 문서도 "personal use only, 과다 발송 시 정지" 명시 | S(Beeper)/M(자체) | Yes(스파이크 통과 조건) |
| **KakaoTalk** | `kmsg`(macOS AX 자동화, MIT) — 미니 GUI 세션의 LaunchAgent | Notification Center DB 트리거 + Vision OCR | R 상세 / W 텍스트·이미지(dry-run 기본) | 중 — AX self-healing cache 있으나 카톡 업데이트에 취약. **`kmsg mcp-server`는 read/send/send_image 3개 tool만 노출, `watch`는 별도 프로세스 필요** | **중~높음** — 저자 본인이 영구정지 사례 명시. 카카오 공식 정책이 역분석·봇/매크로를 명시 금지하고 "PC 에뮬레이터 등 비정상 환경"을 탐지 트리거로 열거 | M | Yes(Phase C) |
| **LinkedIn** | Playwright 상주 프로필(미니, 저빈도 랜덤 폴링) | ① Gmail로 오는 LinkedIn 알림 메일 파싱(무비용 신호) ② Unipile(€49/월~) ③ `mautrix/linkedin`(버그 해결 후) | R/W(draft-then-approve) | **낮음** — 공식 API 없음, 브릿지 upstream 고장(#55 오늘도 open) | **중~높음** — User Agreement 8.2가 모든 자동화·스크래핑을 명시 금지. Unipile 기본 상한은 액션당 **100/일**(150 아님) | M | Phase C |
| **에이전트 세션(Claude Code/Codex/DeepSeek/Hermes)** | 네이티브 headless 표면 래핑(`claude -p --output-format stream-json --resume`, Codex `app-server` JSON-RPC, Hermes `/v1/responses`+세션 헤더) | — | R/W(턴 시작·재개·중단) | 중 — Codex app-server는 alpha가 하루 4~5회 컷됨(오늘 `rust-v0.156.0-alpha.8` 확인). 버전 핀 필수 | 낮음(자기 계정). 단 `fable` 헤드리스 과금 주의 | M | **Yes(Phase A)** |

---

## 4. 추천 스택

| 레이어 | 1순위 | Runner-up | 선정 근거 |
|---|---|---|---|
| **Agent harness** | Vercel AI SDK 7(`ai@7.0.107`) + 자작 Postgres kernel(events + `LISTEN/NOTIFY` + cron + `pending_approvals`) | Eve self-host를 답장초안·다이제스트 **에이전트 단위로만** | kernel 단위가 "이벤트버스 1개"여야 하는데 Eve의 단위는 "에이전트=프로세스"(`20`). AI SDK는 lock-in 없음 |
| **Agent session bus** | 자체 thin bridge + Hermes의 `session_key`/`session_id` 분리 + 위임 MCP 서버(`delegate_to_codex` 등) | ACP(멀티벤더 필요해지면) | `09` §4, `codex mcp-server`는 존재하지 않으므로 app-server JSON-RPC 직결 |
| **Memory** | ① flat-file self-model(`USER.md`/`SOUL.md`/`AGENTS.md`, frozen snapshot) ② mem0 OSS + pgvector(768d nomic-embed via Ollama) ③ Postgres bi-temporal 엔티티(`valid_from/valid_until/recorded_at/invalidated_at`) | Honcho self-host(무수정·API 격리 호출) | mem0 OSS의 graph 제거로 ③은 필수. Honcho는 AGPL이라 앱 배포 계획과 충돌 여지 |
| **Model tiers** | T0 로컬(분류·임베딩, $0) / T1 DeepSeek Flash(초안·노트라우팅) / T2 Sonnet 5·Haiku 4.5(VIP·저신뢰·메모리통합) / T3 구독 CLI(개발·본인 세션) | 게이트웨이: OpenRouter → Vercel AI Gateway | cascade + prompt-cache prefix 규율 + Batch API 50%. **추정 월 $20~50(미실측)** + 빌드 타임 DeepSeek 별도 |
| **Client** | macOS Tauri 2 → v2에서 iOS 합치기 | iPhone MVP는 installed PWA(모순 있음, §6) | Tauri 2 stable·활발, `window-vibrancy`로 Liquid Glass |
| **Sync** | Zero(rocicorp/mono, Apache-2.0) + 3티어 이벤트 분리 | PowerSync(모바일 우선이나 MongoDB 필요) | Postgres 하나로 끝남. 1유저 2~3기기 규모에선 둘 다 상한에 안 걸림 |
| **Storage** | Postgres(미니, SQLCipher는 로컬 메시지 스토어) + pgvector + R/W 감사로그 append-only | — | FileVault는 전원 차단 시에만 보호 → 앱 레벨 암호화 별도 필요 |
| **UI 시스템** | Tailwind v4 + shadcn/ui(Radix base) + react-virtuoso + Tiptap + shadcn Command(⌘K) | TanStack Virtual / Lexical | 인박스 행이 가변 높이 + 채널 그룹핑이라 virtuoso 우위 |
| **Dev pipeline** | OMC `ralph` skill + worktrunk(스토리당 worktree) + `assignedTier` 확장 + DeepSeek 위임 브랜치 | claude-squad(사람이 붙어 볼 때만) | `fable`은 planning interactive 세션에만, headless 루프에서 **배제** |

---

## 5. 착안 목록 (borrow list)

### 5.1 제품/기능

- **kinso 3종 세트**(tone-matched draft + morning briefing + contextual linking) — `01` — omnis 목표 기능셋의 기준선으로 그대로 채택.
- **kinso 모닝브리핑 카피 구조**("Good morning, {name}. You've got N new and M active conversations." + "Today's briefing" pill) — `23` — 아침 브리핑/야간 다이제스트 문구 템플릿으로 거의 그대로 재사용.
- **Superhuman Auto Labels**(짧은 자연어 프롬프트 → 라벨 규칙 생성) + Split Inbox — `17` — work/personal 자동 필터와 토픽 auto-label의 UX 원형.
- **Superhuman Instant Reply**("초안이 이미 달려 있는 인박스를 열다") — `17` — G4(인바운드 후 60초 내 초안 준비)의 제품적 표현.
- **folk Follow-up Assistant**(비활성 대화 감지 → pending next step 판단 → 톤매칭 초안) — `17` — 노트→라우팅/팔로업 자동화의 유일한 상용 전례, 알고리즘 뼈대로.
- **Dex**(15+ 소스 통합, keep-in-touch reminder, 캘린더 트리거 pre-meeting brief, **MCP 서버 노출**) — `17` — Network 모듈의 1차 청사진.
- **Motion/Reclaim의 task→calendar time block** + **Todoist의 추출→confirm** — `17` — 에이전트 투두의 캡처·배치 모델.
- **Artemis Flash/Pro 이중 프로파일** — `03` — 가벼운 라벨링은 계획 없는 반응형 루프, 답장 초안·CRM 판단은 Planner+Checker 루프.
- **Notion Mail 종료 교훈**(2026-09-22) — `14` — "인박스를 안 열어도 되는 경로(알림→초안 확인→원클릭 발송)"를 1급 시민으로.

### 5.2 UX/디자인

- **kinso 리스트 행**(원형 아바타 + bold 이름 + 회색 타임스탬프 + 1줄 프리뷰 + **우측 고정 브랜드 아이콘**) — `23` — 채널 식별을 색이 아니라 아이콘에 전담시켜 "누가"와 "어디서"를 분리.
- **kinso selected-row elevation**(hairline 구분선 없이 선택 행만 흰 카드+soft shadow) — `23` — Linear/Raycast의 hairline 밀도와 다른 제3의 축.
- **kinso pill 입력창 + 그라디언트 stroke 포커스**, **점선 unread 인디케이터**, **squircle 채널 아이콘 타일** — `23`.
- **Liquid Glass 레이어 규칙**(유리는 sidebar/toolbar/sheet/팔레트에만, 리스트·본문은 불투명) — `14` — 코드 규칙으로 강제. 위반 시 즉시 "AI가 만든 UI" 티가 남.
- **Superhuman 커맨드 팔레트**(중앙 모달, 액션 우측에 `kbd` 단축키 노출로 학습 유도) + **Arc의 사이드바=1급 내비게이션** — `14` — ⌘K를 omnis 핵심 인터랙션으로, 에이전트 액션(Codex 위임, Hermes 호출)도 같은 팔레트에.
- **Linear/Raycast 다크 토큰**(근흑 캔버스 + 0.5~1px 헤어라인 + 단일 액센트 + 100/160/400ms 모션) — `14` — kinso는 다크모드가 아예 없으므로(`23`) 다크는 여기서만 가져온다.
- **Pretendard + Inter 폴백 체인**, 웨이트 3단(400/510/590) — `14`.
- **agentic-inbox의 "Edit & send in composer" 게이트**와 **`TOOL_LABELS` + `ToolCallBadge`** — `22` — Draft 카드의 승인 UX 원형, 그리고 에이전트 세션을 스레드로 보여줄 때 tool 호출을 라벨+아이콘+진행상태로 매핑하는 최소 패턴.
- **Beeper `ai-bridge`의 "모델 1개 = 연락처 1명, 대화 1개 = 재개 가능한 방"** — `09` — 에이전트 세션이 인박스에서 어떤 느낌이어야 하는지의 가장 가까운 청사진(단 Matrix 종속은 가져오지 않음).

### 5.3 아키텍처

- **Hermes `X-Hermes-Session-Key`(안정 스코프) vs `X-Hermes-Session-Id`(회전 트랜스크립트) 분리 + `GET /v1/capabilities` 자기기술** — `09` — omnis 브리지 프로토콜에 그대로 이식. 이 스윕 최고 가치 발견.
- **Hermes flat-file + pluggable MemoryProvider(동시 1개만 활성)** 및 **frozen-snapshot 주입**(prefix cache 보존) — `10` — 메모리 아키텍처 골격 + 캐시 비용 절감.
- **Hermes `*_write_approval` 게이트(기본 false)** — `11` — 자동 생성 write 전부에 적용.
- **Graphiti 4-timestamp bi-temporal edge 스키마** — `10`/`26` — Postgres 엔티티 테이블 컬럼으로 그대로. 이제 필수.
- **Honcho peer 모델**(user/agent/group/project/idea를 전부 동일한 1급 엔티티로) — `10` — Network 스키마 프레임.
- **agentic-inbox의 Draft=Item status + tool 집합 격리** — `22` — 승인을 프롬프트가 아니라 tool palette 설계로 강제.
- **agent-inbox의 `HumanInterrupt`/`HumanResponse` 4-way config** — `22` — Action 객체 인터페이스의 직접 출발점.
- **buzz의 ACP 하네스 파이프라인**(이벤트 구독 → 정규화 → 에이전트 프롬프트 → write-back)과 **kind 기반 dispatch**, **`buzz-cli` JSON in/out + exit code 규약(0/1/2/3/4/5)** — `02`/`22` — 단 `request_approval`은 구현이 깨져 있으므로(🚧 WF-08) 실행 로직은 참조 금지.
- **OpenClaw binding-rule 라우팅**(channel/account/contact/group으로 에이전트 결정)과 **harness-as-swappable-plugin** — `09`/`11`.
- **Eve 승인 정책 API 상태머신**(`never/once/always/auto()`, request와 response의 권한 분리)과 **`@workflow/world-postgres` 스키마 분리**(runs/events/steps/hooks/stream_chunks/waits/event_slots) — `20` — 자작 kernel의 `pending_approvals`가 "events 테이블 하나"보다 나은 모양을 제시.
- **Codex `item/started` + `item/completed` 2단 라이프사이클** → durable row의 `streaming`/`complete` 상태 매핑 — `27`.
- **Beeper Remote Access의 `X-Forwarded-*` base URL 계산** — `04`/`21` — Tailscale 뒤 로컬 서비스들을 단일 게이트웨이로 묶는 패턴.
- **kmsg `chat_id` 로컬 레지스트리**(가변 방 이름 → 안정 synthetic ID) — `05` — 크로스소스 통합 thread ID 설계 참고.
- **TN2083 daemon/agent 분리** — `18` — 서비스 배치의 구조적 제약.
- **healthchecks.io ping 규약**(`/start`, `/fail`, exit-code suffix) — `18` — 에이전트 세션 heartbeat를 omnis 인박스 알림으로.

### 5.4 코드/라이브러리

- `channprj/kmsg`(MIT, ★266) — KakaoTalk 커넥터를 brew 설치 + MCP 3 tool + 별도 `watch --json` 프로세스로. effort를 L→S로 낮추는 핵심.
- `tulir/whatsmeow`(MPL-2.0, ★7,363) — Beeper 스파이크 실패 시 즉시 폴백. `Sealjay/mcp-whatsapp`(whatsmeow를 42 MCP tool로 래핑), `openclaw/wacli`(구 `steipete/wacli`, ★2,747)는 참고 구현.
- `mtcute/mtcute`(MIT, ★562) — Telegram 네이티브 TS, QR + phone-code 이중 로그인, better-sqlite3 세션.
- `openclaw/openclaw` `extensions/slack` + `docs/channels/slack/setup.md`의 Socket Mode manifest — 시작점. **주의: `extensions/google`은 Gemini 모델 provider이지 Gmail/Calendar 어댑터가 아니다.**
- `NangoHQ/nango` — OAuth 토큰 저장/갱신 self-host. 단 SPDX가 `NOASSERTION`(커스텀 라이선스) — "오픈소스"라고 단정하지 말 것.
- `mem0ai/mem0`(Apache-2.0, ★65,651) `mem0-ts/src/oss/src/embeddings/ollama.ts` — 임베딩 배선 예시.
- `cloudflare/agentic-inbox`(Apache-2.0, ★7,942, **pushed 2026-04-23 = 5개월 무커밋 스냅샷**) `workers/db/schema.ts`, `workers/lib/tools.ts`, `workers/agent/index.ts`(9 tool, send 없음) vs `workers/mcp/index.ts`(12 tool, send 있음) — 스키마·tool 격리의 직접 참조.
- `langchain-ai/agent-inbox`(MIT, ★1,092, pushed 2026-09-18) `src/components/agent-inbox/types.ts`, `hooks/use-interrupted-actions.tsx`, `components/generic-interrupt-value.tsx`.
- `rocicorp/mono`(Apache-2.0, ★3,390) + `rocicorp/zslack`(Expo+RN+Zero Slack 클론) — 인박스 리스트/스레드 뷰 참조 구현.
- `tailscale/libtailscale` swift(TailscaleKit) — iOS 앱에 tsnet 임베드, App Store 제출용 simulator-free 프레임워크 존재. `willmortimer/TailnetKit`, `indiagrams/tunnelless`는 API 설계 참고.
- `max-sixty/worktrunk`(★8,111) — 스토리당 worktree, 비-TUI 스크립트 우선. `smtg-ai/claude-squad`(AGPL-3.0, ★8,497, pushed 2026-08-20)는 사람이 붙어 볼 때만. **claude-squad README의 실제 로스터는 Claude Code/Codex/Gemini/Aider이며 OpenCode·Amp가 아니다.**
- `~/.claude/plugins/cache/omc/oh-my-claudecode/4.14.5/skills/ralph/SKILL.md` — omnis 빌드 루프 **그 자체**로 채택(새로 만들지 않음).
- `tauri-apps/window-vibrancy`의 `apply_liquid_glass`/`NSGlassEffectViewStyle` + `tauri-plugin-mobile-push`(스위즐링 없는 AppDelegate 위임).
- `abiosoft/colima`(MIT) — 기존 Lima 위 컨테이너 런타임.

---

## 6. 미해결 질문 (Logan 결정 필요 — 계획을 실제로 바꾸는 것만)

1. **Hermes를 대체하는가, 편입하는가?** `01-definition-draft` §8/§10은 "omnis가 미니의 Hermes/omh/buzz 세팅을 전부 대체하고 Hermes 메모리도 공유 안 함"이라고 쓰여 있는데, 브리프와 `09`/`11`은 Hermes를 4대 인박스 에이전트의 하나로 두고 `api_server`를 브리지 기반으로 삼는다. 두 문장은 양립 불가다. (편입 쪽이 기술적으로 훨씬 싸다 — `09`가 Hermes 헤더 패턴을 최고 가치 발견으로 꼽은 이유도 그것이다.)
2. **iPhone 클라이언트: PWA로 시작해도 되는가?** `13`은 MVP를 PWA로 권고하면서 자기 표에서 PWA의 Apple-native 느낌을 "낮음"으로 평가했다. 브리프는 "최대한 애플스럽게"를 명시 요구했다. PWA MVP(싸고 빠름, 푸시 제약)와 Tauri iOS 단일 코드베이스(비쌈, App Store 심사 사례 부족) 중 어느 쪽을 감수할 것인가. 이 선택이 Phase B 일정 전체를 좌우한다.
3. **WhatsApp을 본인 실사용 번호로 붙일 것인가?** ban 확률은 어느 소스에도 정량 데이터가 없고 복구도 어렵다. `07`은 **부번호 파일럿**을 강력 권고했다. Underpin/Onword 커뮤니케이션이 걸린 계정이므로 Logan의 명시적 확답이 필요하다.
4. **KakaoTalk 자동화 리스크를 감수할 것인가?** kmsg 저자 본인이 영구정지 사례를 README에 명시했고, 카카오 공식 정책은 역분석·봇/매크로를 금지하며 "이용환경 및 이용패턴 분석"이라는 포괄 문구를 갖고 있다(AX 방식이 문언에 정확히 걸리진 않으나 회색지대). 카카오 계정 상실의 비용을 Logan이 어떻게 평가하는가.
5. **개인 인박스 본문을 중국 호스팅 모델에 통과시킬 것인가?** Tier 1 전체가 DeepSeek 기반이다. PII 필드를 프롬프트에서 제외할지, 특정 스레드만 Tier 2로 라우팅할지의 정책 결정이 코드 작성 전에 필요하다(`12` §6).
6. **회사 GitHub 레포는 private인가?** public이면 sops+age 설정 암호화가 Later가 아니라 MVP로 격상된다(`15` §6).
7. **Honcho(AGPL-3.0) fallback을 허용하는가?** "나중에 맥북+아이폰 다운로드 서비스"라는 목표와 AGPL의 네트워크 배포 조항이 충돌할 수 있다. 무수정 self-host + API 격리 호출이면 리스크가 크게 줄지만, 이건 법률 자문이 아니라 프로젝트 정책 결정이다.
8. **G6(standalone)를 `25`의 제안대로 재정의할 것인가?** "Slack/Gmail/Outlook/Telegram/WhatsApp/Calendar + 에이전트는 완전 hub-less, KakaoTalk/LinkedIn은 상시 켜진 기기 1대 필요"로 제품 정의서에 정직하게 적을 것인지. 지금 안 적으면 Phase D에서 재설계 비용이 발생한다.
9. **Calendar push 스파이크를 돌릴 것인가?** 도메인 소유 검증 요구는 오늘 재확인 결과 **폐지됐고**(support.google.com/googleapi/answer/7072069: "Domain verification in the API Console is no longer required"), 남은 요건은 HTTPS + 유효 SSL뿐이라 Tailscale Funnel이 이론상 통과한다. 30분 스파이크로 Calendar가 실시간 채널이 되느냐 준실시간이 되느냐가 갈린다.

---

## 7. 리스크 top 10

| # | 리스크 | 근거 | 완화책 |
|---|---|---|---|
| 1 | **Prompt injection → 실제 행동 유발.** 인박스 전체(신뢰 불가 입력)와 실행 권한이 한 시스템에 있음. OWASP LLM01 2년 연속 1위 | `15` §2, Anthropic 브라우저 에이전트 ASR 1%도 "유의미한 리스크"로 자인 | 인박스 텍스트를 항상 data로 태깅·분리 / **비가역 tool을 자율 루프 palette에서 원천 배제**(`22`) / 작업 단위 tool allowlist / classifier 스캔(agentic-inbox의 `isPromptInjection` 패턴) / 외부 전송 전 전문 노출 승인 / 감사로그 / kill switch |
| 2 | **KakaoTalk·LinkedIn 계정 정지.** 복구 난이도 높고 사업 커뮤니케이션 직결 | `05`(저자 자인), `25`(카카오 공식 금지 문언), `06`(User Agreement 8.2) | read 우선·send는 dry-run→승인 1회 / 폴링 주기 랜덤화·인간 수준 빈도 / 선제 발신 금지 / 고정 IP(Tailscale) / talksafety의 탐지 트리거 목록을 역이용한 체크리스트 / 2FA |
| 3 | **WhatsApp 세션 ban.** 정량 데이터 없음, whatsmeow/Beeper 둘 다 같은 근원 | `07` §2, `21` §3 | 부번호 파일럿 우선(§6.3) / read-mostly + draft-then-send / 데이터센터 IP 회피 / 대량발송 금지 |
| 4 | **맥미니 단일 장애점.** GUI 세션이 잠기거나 자동 로그인이 macOS 업데이트로 리셋되면 Kakao/LinkedIn 캡처가 통째로 멈춤 | `18` §4(FileVault-자동로그인 충돌 UNVERIFIED), `25` | 부팅 시 pmset/자동로그인 재적용 LaunchAgent / `caffeinate` 이중화 / healthchecks dead-man's-switch + ntfy 푸시 / 캡처를 sidecar로 분리해 호스트 이동 비용 최소화 |
| 5 | **WAL 무한 누적으로 허브 디스크 풀.** `idle_replication_slot_timeout` 기본값 0(비활성) + zero-cache 크래시 조합 | `27` §2(PostgreSQL 공식 문서) | 이 값을 명시 설정 / 슬롯 헬스체크를 모니터링에 포함 / 디스크 임계 알림 |
| 6 | **Codex app-server 프로토콜 드리프트.** 오늘도 alpha가 하루 4~5회 컷됨(`rust-v0.156.0-alpha.8`, 2026-09-19) | `09` §4, 오늘 `gh api` 재확인 | Codex 버전 핀 / `capabilities` 배열 기반 feature detection / 브리지 자체 프로토콜을 MCP 2026-07-28 협상 모델로 설계 |
| 7 | **`fable` 헤드리스 무동의 과금.** `-p`/Agent SDK에서는 동의 프롬프트가 뜨지 않고 usage credit이 그냥 청구됨 | 오늘 code.claude.com/docs/en/model-config 원문 재확인 | ralph 루프 모델 풀에서 `fable` 제외 / planning은 interactive 세션에서만 / 에스컬레이션 경로는 DeepSeek→Sonnet→Opus까지만 |
| 8 | **Anthropic ToS 경계 침범.** OAuth 토큰을 Agent SDK/백엔드로 우회하면 계정 조치 대상 | 오늘 code.claude.com/docs/en/legal-and-compliance 원문 재확인 | unmodified `claude` 바이너리를 서브프로세스로만 호출 / 토큰 harvest 금지 / 제품 백엔드는 API key / "ordinary individual use"에 공개 임계치가 없으므로 24/7 스크립트 루프는 max-iteration 캡과 사람 체크포인트를 유지 |
| 9 | **ralph 루프 폭주.** ghuntley 자신이 "컴파일 안 되는 코드베이스로 깨어난다"고 경고 | `24` §2 | 스토리당 최대 3회 시도 후 1티어 에스컬레이션 / `--max-iterations` 월클럭 캡 / 마지막 검증 커밋으로 `git reset --hard` / implementer와 reviewer 컨텍스트 분리(자기 승인 금지) / DeepSeek diff는 반드시 Sonnet 이상이 리뷰 |
| 10 | **벤더/업스트림 증발.** Beeper 가격 정책 미공개(`pricing` 404), agentic-inbox 5개월 무커밋, mem0가 6개월 만에 graph를 통째로 제거, Eve는 공개 3개월 beta 프로토콜 핀 | `21`/`22`/`26`/`20` | 채널 어댑터를 교체 가능한 인터페이스 뒤에 둠(Notion Mail 교훈) / mem0·eve·`@workflow/*` 버전 고정 + 분기별 재검증 / Beeper는 WhatsApp 하나만 의존해 탈출 비용을 whatsmeow 이관으로 한정 |

---

## 8. 검증 요약 — 아직도 중요한 refuted / unverifiable 주장

**Refuted(본문이 틀렸고 계획에 영향)**

1. **MCP 현행 스펙은 2025-11-25가 아니라 2026-07-28**이다(오늘 재확인). `initialize` 핸드셰이크가 아니라 `_meta`/헤더 per-request 협상 + mandatory `server/discover`. `09` 본문과 `15`의 MCP 보안 지침이 구버전 모델 위에 쓰였다.
2. **mem0 OSS의 graph memory는 제거됐다**(오늘 재확인). `10`의 "그래프는 부가 옵션" 서술은 무효이고, Network 관계 쿼리는 Postgres 커스텀 테이블 외에 경로가 없다.
3. **Eve는 Vercel 전용이 아니다**(`20` 스파이크 + 오늘 문서 재확인: `eve build && eve start`, Nitro 스케줄 러너 자동 기동, `/eve/`와 `/.well-known/workflow/` 둘 다 프록시 필요). `11`의 기각 *근거*는 폐기하되 *결론*(kernel 아님)은 프로세스 모델 논거로 유지.
4. **Google push의 Search Console 도메인 소유 검증은 폐지됐다**(오늘 원문 재확인). `08` 본문이 Calendar를 폴링으로 못 박은 이유가 사라졌다 — 스파이크 필요.
5. **MS Graph의 Outlook message/event/contact 구독 최대 수명은 4,230분이 아니라 10,080분**(오늘 표 직접 확인). 4,230분은 Teams callRecord·group conversation·printer·todoTask 등 다른 리소스다. 갱신 cron을 3일→주간으로 완화 가능.
6. **`codex mcp-server`는 존재하지 않는다**(`09` 검증 패스에서 소스로 확인). 위임은 app-server JSON-RPC 직결로만.
7. **kinso $59/월은 근거 없다.** `07`/`14`가 VERIFIED로 표기했으나 `01`/`23`과 오늘 내 재확인 모두 kinso.ai 어디에도 가격이 없고 `kinso.ai/pricing`은 404다. **`01`/`23`이 더 잘 소싱됐다 — $59를 삭제하라.**
8. **Notification Center DB는 "배너 프리뷰만"이 아니다.** Sequoia 이전에는 iMessage 본문까지 평문으로 담겼고, *그래서* TCC/FDA로 잠겼다. `05`의 "거의 없음 리스크, 트리거 전용" 프레이밍은 과소평가다.
9. **`katok`은 export 기반 읽기전용 백필 도구가 아니다.** `katok sync --source macos`로 라이브 ingestion을 지원하고 Full Disk Access + 컨테이너/DB 접근 진단을 요구한다 — SQLCipher gist 경로에 가까운 민감도다.
10. **Slack "2026-03-03부터 기존 설치에도 레이트리밋 적용"은 1차 소스에 없다.** changelog는 오히려 "기존 설치에는 적용하지 않는다"고 명시. 계획에서 삭제할 것.
11. **openclaw `extensions/google`은 Gmail/Calendar 어댑터가 아니라 Gemini 모델 provider다.** 이메일/캘린더 코드는 이 레포에서 빌려올 수 없다.
12. 소소하지만 인용 위생: Unipile 기본 상한은 액션당 **100/일**(100~150 아님), hiQ 합의는 **2022-11**(12월 아님), Zep→Graphiti 전환은 **2025-04**(2026 아님), Memori는 **Apache-2.0**(NOASSERTION 아님), claude-squad 로스터는 **Gemini/Aider**(OpenCode/Amp 아님), goose는 **`block` org를 떠났다**, droidrun/mobilerun은 AndroidWorld **91.4%**(63% 아님), Letta의 활성 개발은 `letta-code`(★3,381)로 이동, Yjs 주간 다운로드는 **~6.2M**(~92만 아님).

**Unverifiable(여전히 닫히지 않았고 결정에 영향)**

- **카카오의 "모바일 1대 + PC/태블릿 1대" 정확한 동시접속 제한.** `05`·`25`·오늘 모두 1차 소스를 못 찾았다(`cs.kakao.com` 카테고리 1056 본문이 클라이언트 JS 렌더). Android 에뮬레이터 배제의 원래 논거였으나, `25`가 찾은 "PC 에뮬레이터 등 비정상적인 환경" 탐지 트리거 문구가 **더 강한 대체 근거**이므로 결론(에뮬레이터 배제)은 유지된다.
- **Beeper Desktop API의 유료 게이팅 여부.** `beeper.com/pricing`은 오늘도 404, FAQ는 Desktop API를 언급조차 안 함. 무료 계정으로 토큰을 발급해 봐야 닫힌다.
- **Beeper로 LinkedIn/WhatsApp 실제 send가 되는지.** API 레퍼런스가 네트워크별 예외를 긍정도 부정도 안 한다. 30분 스파이크로만 닫힌다.
- **실험적 Beeper WebSocket의 latency**가 G1(API 채널 5초)을 만족하는지 — 문서에 수치 전무.
- **omnis의 실제 이벤트 볼륨.** `27`의 "하루 1,000~30,000" 추정은 미검증이고, Codex 쪽 실측은 계정 사용량 한도로 완주 못 했다. 1주일 로그가 필요하다.
- **M4 16GB에서 nomic-embed(Ollama)의 실측 처리량/지연**. 스펙만 확인됐다.
- **FileVault 활성 상태에서 macOS 26.6 자동 로그인 가능 여부** — Apple 1차 문서 미확인, 직접 테스트 필요. 허브 운영의 전제조건이라 우선순위 높다.
- **Tailscale Serve `*.ts.net` iOS SSL 이슈(#19147)의 실제 재현 여부.** `13`은 "댓글/담당자 없음"이라 했으나 실제로는 댓글 5개이고 제3자 DoH 앱(DNSecure) 충돌이라는 진단과 해결 보고가 있다 — **`13`이 지목한 "최대 리스크"는 과대평가일 가능성이 높다.** 클린 네트워크에서 먼저 재현을 시도할 것.
- **PowerSync가 MongoDB 없이 Postgres를 스토리지 백엔드로 쓸 수 있는지** — 미확인. Zero를 택하면 무의미해진다.
- **Fable이 Console API key로 고정 단가 호출 가능한지** — 공개 per-token 가격표에 없다. 불가하면 헤드리스에서 원천 배제, 가능하면 하드 예산 캡으로 제한 사용.
- **Artemis의 "Pixel Test Engineering Fusion team, 2026-09-10" 출처** — Google 1차 소스 없음(AlphaSignal 단독). 인용 시 "한 2차 매체 보도"로만.
- **RAGAS 개별 지표 정의** — 미확인. 1단계는 recall@k 스크립트 20줄로 충분하므로 당장 영향 없음.
