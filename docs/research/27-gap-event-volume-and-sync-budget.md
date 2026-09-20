# GAP 8 — Event firehose 크기 산정 후 sync engine·L0 스키마 결정

Researched 2026-09-20. 이 문서의 실측치는 이 세션에서 직접 실행한 `claude -p`/`codex exec` 헤드리스 런 캡처 결과이며, 나머지 수치는 공식 문서/저장소에서 이 세션 중 fetch했다. VERIFIED = 1차 소스 또는 직접 실측으로 확인, UNVERIFIED = 확인 못함.

## 1. TL;DR

실측 결과, Claude Code 헤드리스 한 턴(`stream-json --include-partial-messages`)은 이벤트 39개·63KB를 냈지만 그중 92%(58KB)는 매 턴이 아니라 매 **프로세스 기동**마다 한 번 나가는 `system/init`(MCP 툴 목록) + hook 이벤트였고, 실제 콘텐츠(델타+결과)는 약 4.8KB였다. Codex `app-server`는 문서상 `item/agentMessage/delta`, `item/reasoning/textDelta`, `item/commandExecution/outputDelta` 등 델타 타입만 6종 이상이라 툴 호출이 섞인 턴은 이벤트 수십~백여 개가 쉽는게 정상이다. 이 세션에서 실제 Codex 턴을 실행했으나 계정 사용량 한도로 완주하지 못해 스키마만 실측 확인(부분). 핵심 결론: **절대량은 하루 수천 건 수준으로 Zero·PowerSync 둘 다 여유 있게 처리 가능**(PowerSync 공식 벤치마크: 소형 row 초당 2,000–4,000 ops)하지만, 토큰 단위 델타를 그대로 Postgres row로 커밋해 복제하면 트랜잭션·복제 오버헤드가 G5(2초) 예산을 갉아먹는다. 델타는 별도 ephemeral 채널(WS 또는 Postgres NOTIFY, 8000바이트 한도)로 빼고, 동기화 스토어에는 디바운스된 요약본만 넣어야 한다.

## 2. Facts

- **Claude Code 실측(이 세션, 2026-09-20)**: `claude -p "What is 2+2?..." --output-format stream-json --verbose --include-partial-messages`를 실제로 실행해 39개 이벤트/63,367바이트 캡처. 타입 분포: `system` 30개(58,056B, 이 중 `init` 단독 28,340B — 이 환경에 연결된 다수 MCP 서버 목록 때문에 비대해짐, omnis 전용 에이전트는 이보다 작을 것), `stream_event` 6개(2,242B, `message_start`/`content_block_start`/`content_block_delta`/`content_block_stop`/`message_delta`/`message_stop` 각 1개), `assistant` 1개(752B), `result` 1개(1,772B), `rate_limit_event` 1개(506B). "Four" 한 단어 답변에 `content_block_delta`가 1개뿐이었다 — 실제 동시성 있는 응답은 델타 수가 응답 길이에 비례해 늘어난다. **VERIFIED (직접 실측)**.
- **Codex app-server 실측(이 세션, 2026-09-20, 부분)**: `codex exec --json --sandbox read-only --skip-git-repo-check`로 실제 실행, `thread.started` → `turn.started` → 에러 아이템 6개(각 150–350B) → `turn.failed`까지 11개 이벤트/1,992바이트 캡처 후 계정 사용량 한도(usage limit, 2026-09-23 리셋 예정 메시지)로 중단됨 — 정상 콘텐츠 턴은 완주 못함. **VERIFIED (직접 실측, 부분)**.
- **Codex app-server 이벤트 taxonomy**: 모든 item은 `item/started`(전체 item 페이로드)와 `item/completed`(최종본) 두 라이프사이클 이벤트를 공유. 델타 스트림은 `item/agentMessage/delta`(텍스트 청크), `item/plan/delta`, `item/reasoning/summaryTextDelta`, `item/reasoning/summaryPartAdded`, `item/reasoning/textDelta`, `item/commandExecution/outputDelta`(stdout/stderr 청크) 최소 6종. item 타입 자체도 `userMessage`/`agentMessage`/`functionCallOutput`/`plan`/`reasoning`/`commandExecution`/`fileChange`/`mcpToolCall`/`dynamicToolCall`/`collabToolCall`/`webSearch`/`imageView` 등 11개 이상. 문서에 전형적 이벤트 수·페이로드 크기 가이드는 없음. **VERIFIED** — https://learn.chatgpt.com/docs/app-server (2026-09-20 fetch).
- **PowerSync 공식 성능 벤치마크**: 소형 row 복제 처리량 "2,000–4,000 operations per second", 대형 row는 "up to 5MB per second"; 클라이언트 동기화는 "2,000–20,000 operations per second per client"; row 최대 크기 15MB; 유저당 버킷 기본 최대 1,000(요청 시 최대 10,000까지 조정 가능); 인스턴스당 동시 클라이언트 "50k+" 지원. **VERIFIED** — https://docs.powersync.com/resources/performance-and-limits.md (2026-09-20 fetch).
- **PowerSync 자체호스팅 사이징**: 스테이징 = compute 컨테이너 1개(512MB/1vCPU) + MongoDB 1노드(2GB/1vCPU, replica set 모드); 프로덕션 = replication 컨테이너 1개(1GB/1vCPU) + API 컨테이너 2개 이상(각 1GB/1vCPU) + MongoDB 3노드 replica set(노드당 2GB+); 고부하 시 각 컨테이너 2GB/2vCPU로 증설 권장, API는 커넥션 100개당 1개 추가. **중요**: 내부 버킷 스토리지 DB로 **MongoDB가 기본**이며 이 문서 발췌에서 Postgres-as-storage 지원 여부는 확인 못함 — 맥미니에 Postgres 외에 MongoDB까지 얹어야 할 가능성. **VERIFIED (사이징 수치)** / **UNVERIFIED (Postgres storage 대안 가능 여부)** — https://docs.powersync.com/maintenance-ops/self-hosting/deployment-architecture.md (2026-09-20 fetch).
- **Zero (rocicorp/mono)**: `advancement cost scales with number of changed rows, not number of queries`(공식 문구) — row 단위 write-amplification 모델이라 "쿼리 몇 개가 구독 중이냐"가 아니라 "몇 row가 바뀌었냐"가 비용을 결정. 멀티노드 배포 예시는 Replication Manager 1vCPU/2GB, View Syncer 2vCPU/4GB(시작점 권장치, 확정 상한 아님). CVR(client view record) DB는 별도 커넥션(`ZERO_CVR_DB`)이 필요하지만 클라이언트 수 대비 저장량 증가 곡선은 문서에 없음. 정량적 처리량 상한은 공개 안 됨 — "single-node로도 놀랄 만큼 버틴다"는 정성적 서술뿐. rocicorp/mono ★3,390, Apache-2.0, 2026-09-19 push, open issues 232. **VERIFIED** — https://zero.rocicorp.dev/docs/deployment (2026-09-20 fetch), `gh api repos/rocicorp/mono`.
- **PostgreSQL NOTIFY**: 페이로드 상한 8,000바이트(기본 설정), 동일 채널+동일 페이로드가 한 트랜잭션 내에서 중복되면 1건으로 합쳐짐(coalescing), 큰 데이터는 페이로드에 직접 넣지 말고 테이블 레코드의 key만 보내라고 공식 문서가 권장. 알림 큐가 8GB이며, 리스닝 세션이 긴 트랜잭션을 잡고 있으면 고빈도 NOTIFY 상황에서 커밋 시점에 실패할 수 있음. **VERIFIED** — https://www.postgresql.org/docs/current/sql-notify.html (2026-09-20 fetch).
- **PostgreSQL 논리 복제(logical replication) 슬롯 안전장치**: `idle_replication_slot_timeout`(기본값 0 = 비활성)를 설정하면 지정 시간 동안 비활성인 슬롯을 다음 체크포인트에서 무효화(invalidate)해 WAL 무한 누적을 막을 수 있음 — 기본값이 꺼져 있으므로, Zero/PowerSync의 복제 컨슈머(zero-cache 또는 powersync 서비스)가 맥미니에서 죽거나 오래 멈추면 기본 설정으로는 WAL이 무한정 쌓여 디스크를 채울 수 있음. **VERIFIED** — https://www.postgresql.org/docs/current/runtime-config-replication.html (2026-09-20 fetch).
- **omnis 목표치(G5)**: `01-definition-draft.md`에 "기기 간 상태 반영 2초 이내"로 명시됨(브리프 원문, 리서치 대상 아님, 내부 문서 인용).
- **estimate — 하루 이벤트 볼륨**: 인박스 메시지 ~2,000건/일(브리프 명시) + 에이전트 턴을 보수적으로 20~200회/일로 잡으면(Claude Code/Codex/Hermes/DeepSeek 합산, 실측 안 됨 — Logan 본인 사용 패턴 관찰 필요), 턴당 이벤트가 짧은 답변 6개~툴 호출 섞인 턴 50–150개(Codex taxonomy 근거 추정)라 할 때 하루 총 이벤트는 대략 1,000~30,000개 — 초당 평균으로는 0.01~0.35 events/sec로 미미하지만, 한 턴이 실행되는 수 초~수십 초 동안은 토큰 스트리밍으로 순간 초당 10~50개까지 버스트 가능(모델 스트리밍 속도 기준 추정치, 미실측). **UNVERIFIED (추정치, 실측 필요)**.

## 3. Options / Comparison

| 항목 | Zero (rocicorp/mono) | PowerSync |
|---|---|---|
| 소스 DB | Postgres (기존 스키마 그대로) | Postgres 소스 + **별도 스토리지 DB 필요**(기본 MongoDB) |
| 처리량 공개 여부 | 정량 상한 비공개("row 단위로 스케일") | 공식 벤치마크 공개(소형 row 2,000–4,000 ops/sec) |
| 자체호스팅 최소 풋프린트 | Replication Manager 1vCPU/2GB + View Syncer 2vCPU/4GB(권장치) | 스테이징 512MB+2GB(Mongo), 프로덕션 1GB×3+ (Mongo 3노드 포함 시 6GB+) |
| 맥미니(M4, 16GB, 이미 Postgres+Lima+Hermes+sidecar 상주) 적합성 | 상대적으로 가벼움, Postgres 하나로 끝남 | Mongo 추가 시 메모리 압박 — 16GB 중 5–8GB를 sync 스택에 뺏길 위험 |
| RN/모바일 지원 | 공식 지원(Expo, op-sqlite) | 모바일 우선 설계로 알려짐(포지셔닝, 독립 검증 안 됨 — 13번 문서 참조) |
| omnis 규모(1 유저, 2–3 디바이스) 적합성 | 두 엔진 모두 과설계 — 50k클라이언트/10k버킷 같은 한도는 전혀 안 걸림. 결정 기준은 처리량이 아니라 **맥미니 리소스 풋프린트와 Postgres-only 여부** |

## 4. Recommendation for omnis

**스토리지 티어를 3단으로 분리하라** (이게 이 갭의 핵심 답):

1. **Ephemeral tier (동기화 스토어 밖)** — `item/*/delta` 계열(토큰 단위 텍스트, reasoning, stdout 청크)은 Postgres에 커밋하지 않는다. 맥미니에서 얇은 WS fan-out(또는 Postgres `NOTIFY`, 페이로드 8,000B 한도 안에서 청크당 10–300B면 충분)으로 "지금 열려 있는 세션을 보고 있는 디바이스"에만 직접 중계한다. 세션을 안 보고 있으면 델타는 그냥 버려진다 — 재생 불가해도 무방(재생이 필요하면 티어 3에서 pull).
2. **Durable/replicated tier (같은 인박스 스키마, Zero/PowerSync가 복제하는 대상)** — 09가 제안한 "에이전트 세션 = 인박스 스레드" row 하나를 `item/started`(또는 `turn/started`)에서 생성하고, 콘텐츠 필드는 **디바운스(예: 500ms~1s 간격, 또는 `item/completed` 시점)로만 UPDATE**한다. 델타마다 write하지 않는다 — 이게 G5(2초)를 지키는 실질적 레버다: PowerSync 벤치마크(2,000–4,000 ops/sec)나 Zero의 "row 수 기준 비용" 모델 둘 다 초당 수십 건 버스트는 문제없지만, 복제 지연·CVR 재계산·클라이언트 머티리얼라이즈 각 단계에 수백ms씩 누적되면 토큰 단위 커밋으로는 2초를 넘길 여지가 있다. 디바운스 자체가 이 리스크를 없앤다.
3. **Cold/audit tier (복제 안 함)** — 모든 raw 이벤트(델타 포함) 전체 로그는 맥미니 로컬(Postgres 별도 테이블 또는 JSONL)에만 남기고 클라이언트로는 복제하지 않는다. "전체 transcript 보기"는 허브에 직접 쿼리하는 온디맨드 API로 처리.

**엔진 선택**: Zero를 1순위로 권고(effort: M). 이유는 처리량이 아니라 운영 단순성 — Postgres 하나로 끝나 맥미니에 새 DB(MongoDB)를 안 얹는다. PowerSync는 자체호스팅 시 스토리지 DB로 사실상 MongoDB가 기본이라(Postgres 대안 지원 여부 이번 세션에서 확인 못함 — Open questions 참조) 이미 Postgres+Lima+Hermes+채널 sidecar가 상주하는 16GB 머신에 부담이 크다. 단, Zero의 처리량 상한이 비공개라는 점(반대로 PowerSync는 공개 벤치마크 있음)은 리스크로 남긴다 — 1 유저 2–3 디바이스 규모에서는 어느 쪽이든 상한에 안 걸릴 것이 거의 확실하므로(둘 다 최소 수천 유저/디바이스 규모를 겨냥한 제품) 실무적으로 무의미한 리스크에 가깝다.

**리스크**: (1) `idle_replication_slot_timeout` 기본값이 0(비활성)이라, zero-cache 프로세스가 맥미니에서 크래시하고 안 살아나면 Postgres WAL이 무한정 쌓여 디스크를 채울 수 있다 — 이 값을 명시적으로 설정하고 슬롯 헬스체크를 모니터링에 넣어야 한다(effort: S, 하지만 빠뜨리면 장애 시 디스크 풀로 전체 허브가 죽는 심각도). (2) Codex 계정 사용량 한도(이 세션에서 실제로 맞음)처럼, 에이전트 CLI 쪽 rate limit이 "이벤트가 실제로 얼마나 나오는지" 실측을 방해할 수 있으므로 이번 문서의 볼륨 추정치는 참고용이며 Logan의 실사용 로그로 재검증 필요. ToS/계정정지 리스크는 sync 엔진 자체와는 무관(둘 다 오픈소스 self-host 라이선스, Apache-2.0/유사).

## 5. What to borrow

- Claude Code `system/init.capabilities` 배열 패턴(13/09번 문서에서 이미 지목) — 동일하게 omnis의 내부 event bus 프로토콜에도 버전 협상용으로 재사용.
- Codex app-server의 `item/started` + `item/completed` 2단 라이프사이클 설계 — omnis의 durable tier row 상태 필드(`streaming` vs `complete`)를 이 두 이벤트에 직접 매핑하면 클라이언트 UI의 "생각 중..." 셰이머 로직이 단순해진다.
- PostgreSQL 공식 NOTIFY 문서의 "큰 데이터는 payload에 넣지 말고 key만 보내라" 원칙 — ephemeral tier 설계 그대로 적용(델타 텍스트가 8,000B를 넘는 케이스, 예: 큰 diff 출력은 key 참조 방식으로).
- PowerSync의 "bucket count" 개념(유저당 버킷 상한 1,000/10,000) — Zero를 선택해도 "얼마나 세분화된 구독을 만들 것인가"를 설계할 때 참고할 상한 감각으로 유용.

## 6. Open questions

- PowerSync가 Postgres를 자체 스토리지 백엔드로 지원하는지(MongoDB 없이) — 이번 세션 fetch로 확인 못함, 결정 전에 반드시 재확인.
- Zero의 정량적 처리량 상한(초당 row 수, CVR DB 크기 증가 곡선)이 공식 문서 어디에도 없음 — omnis 규모에서는 사실상 무관하겠지만, 실측(로컬에 zero-cache 띄우고 부하 테스트)으로 한 번은 확인해두는 게 저비용 보험.
- 이 문서의 "하루 1,000~30,000 이벤트" 추정은 미검증 — Logan의 실제 하루 에이전트 턴 수(Claude Code + Codex + Hermes + DeepSeek 합산)를 1주일 로그로 재는 게 다음 스텝.
- 디바운스 간격(제안: 500ms~1s)이 G5(2초)를 실제로 지키는지는 로컬 프로토타입으로 end-to-end 측정 전까지 가정일 뿐 — Zero/PowerSync 둘 다 선택 후 실제 propagation latency를 재야 함.
- Codex `item/reasoning/*` 이벤트를 durable tier에 아예 안 넣을지(추론 내용은 완전히 ephemeral) 결정 필요 — 프라이버시/디버깅 트레이드오프.

## 7. Sources

- 이 세션 직접 실행: `claude -p ... --output-format stream-json --verbose --include-partial-messages` (2026-09-20, 로컬 캡처)
- 이 세션 직접 실행: `codex exec --json --sandbox read-only --skip-git-repo-check ...` (2026-09-20, 로컬 캡처, 계정 한도로 부분 완주)
- [Codex app-server docs](https://learn.chatgpt.com/docs/app-server) — 2026-09-20
- [PowerSync — Performance and Limits](https://docs.powersync.com/resources/performance-and-limits.md) — 2026-09-20
- [PowerSync — Self-Hosting Deployment Architecture](https://docs.powersync.com/maintenance-ops/self-hosting/deployment-architecture.md) — 2026-09-20
- [Zero — Deployment docs](https://zero.rocicorp.dev/docs/deployment) — 2026-09-20
- [PostgreSQL — NOTIFY](https://www.postgresql.org/docs/current/sql-notify.html) — 2026-09-20
- [PostgreSQL — Runtime Config: Replication (idle_replication_slot_timeout)](https://www.postgresql.org/docs/current/runtime-config-replication.html) — 2026-09-20
- [PostgreSQL — Logical Replication Configuration](https://www.postgresql.org/docs/current/logical-replication-config.html) — 2026-09-20
- `gh api repos/rocicorp/mono`, `gh api repos/powersync-ja/powersync-service`, `gh api repos/electric-sql/electric` — 2026-09-20
- 내부 참조(재조사 아님): `/Users/logankim/AI-Workspaces/Claude/omnis/research/09-agents-as-inbox.md`, `/Users/logankim/AI-Workspaces/Claude/omnis/research/13-client-arch-sync.md`, `/Users/logankim/AI-Workspaces/Claude/omnis/01-definition-draft.md`
