# Phase B 스토리 백로그 (2026-09-20)

마스터 §16의 **Phase B — 컨텍스트 + 에이전트 + 폰**을 45개 스토리로 쪼갠다. 순서 = 의존성 순서(위에서 아래로, 모든 의존은 자기보다 작은 번호다 — **예외 1건**: US-B19가 US-B20에 의존한다. `taskLoop`이 `routeByRule`을 import하기 때문이고, 번호를 바꾸는 대신 의존 열에만 적었다. 2026-09-20 교차 리뷰 M14). 이 백로그가 5개 계획 문서(`writing-plans` skill 입력)의 입력이고, 계획 문서는 `플랜` 열이 가리키는 파일에 들어간다.

- 상위: `docs/spec/00-omnis-design.md` v1.0 §10·§11·§12·§14·§16·§19, 부록 A1~A7 v1.0.
- 계약: `2026-09-20-phase-a-interfaces.md`(Phase A) + `2026-09-20-phase-b-interfaces-delta.md`(이 Phase가 더하는 것). 식별자는 델타 문서에서 **그대로 복사**한다.
- 기준 코드: `main` 131a042(Phase A 35스토리 + Wave 4 완료, Wave 5 진행 중 — 수동 아카이브 US-A36, kinso 폴리시 US-A37, `tools/auth-kit`).
- 디자인: `docs/design/DESIGN-DIRECTION.md`(kinso, 라이트 기본).

---

## 0. 이 백로그가 확정하는 결정 (B-D1~B-D8)

| # | 결정 | 근거 | 뒤집히면 |
|---|---|---|---|
| **B-D1** | **mem0-ts를 쓰지 않는다.** 벡터 메모리는 `@omnis/memory`가 `public.memories`에 직접 붙는 얇은 pgvector 레이어다. mem0의 fact-extraction 프롬프트 구조(ADD/UPDATE/DELETE 판정)는 **참고만** 하고 코드·문자열을 복사하지 않는다 | 실측(2026-09-20, `npm pack mem0ai@3.2.0` 후 `dist/oss/index.d.ts` 확인): ① `type VectorStore`는 export되지만 **타입만**이고, `MemoryConfig.vectorStore`는 `{provider: string, config: VectorStoreConfig}` + `VectorStoreFactory.create(provider, config)` 정적 팩토리라 **외부 구현 인스턴스를 꽂는 슬롯이 없다** → A3-D12의 "커스텀 VectorStore 어댑터" 전제가 깨진다(S-A3-1 = **FAIL**). ② 번들된 `PGVector`는 `createDatabase`/`createCol`로 **자기 테이블을 만든다** — `memories`의 타입 컬럼(kind/scope/source_kind/4-timestamp/superseded_by)과 부분 HNSW(`WHERE invalidated_at IS NULL`)를 표현할 방법이 없다. ③ graph memory는 v2.0.0에서 제거됨(`26` VERIFIED) — entity/relation은 어차피 우리 테이블이다. ④ 패키지가 `@langchain/core`를 타입 경로로 끌고 오고 vector store 드라이버 20종을 포함한다 | A3-D12의 폴백 경로(= 이 결정)가 이미 정본이므로 뒤집을 일이 없다. mem0가 인스턴스 주입 API를 열면 그때 재검토 |
| **B-D2** | 설정은 **`settings` 단일 key-value 테이블**(`key text PK, value jsonb`)이다. allowlist·자율 규칙·비용 상한·조용시간·보관 임계를 타입 테이블로 쪼개지 않는다 | A3에 설정 테이블이 없다(전수 확인). Settings 화면이 쓰는 값은 전부 1인용 단일 row짜리라 테이블 6개를 만들 이유가 없다. `ponytail: kv + zod 파서, 값별 조회 패턴이 생기면 그때 컬럼으로 승격` | 다중 사용자(v2)가 오면 `user_id`를 붙이거나 타입 테이블로 분해 |
| **B-D3** | **아바타는 이니셜만.** `persons`에 `avatar_url` 컬럼을 만들지 않는다 | `packages/ui`의 `RowAvatar`는 이미 `{kind:'initials'}`를 지원한다. 원격 아바타는 채널 API 호출 + 이미지 캐시 + 프라이버시(외부 요청)가 전부 새 비용이고, kinso 행의 정보량은 이니셜로 충분하다 | 실제 사진이 필요해지면 `avatar_url` 컬럼 + 로컬 캐시 디렉터리를 같이 추가(`RowAvatar`의 `photo` 분기는 이미 있다) |
| **B-D4** | iPhone은 **`apps/web` installed PWA**, 허브가 Tailscale Serve로 같은 오리진에 서빙한다. 별도 호스팅·별도 도메인·Tauri iOS는 없다 | 마스터 §19 Q1 기본값, A6 §3의 `tailscale serve` 2줄이 이미 그 형태 | Tauri iOS는 Phase D |
| **B-D5** | Phase B의 모든 스토리는 **시드 데이터/픽스처만으로 검증 가능해야 한다**(Logan 결정: 실계정 연결은 나중에 한 번에). 어댑터·ingestion·알림 전부 fixture replay 또는 mock 서버로 인수한다 | Logan 2026-09-20 결정. Phase A의 어댑터 계약 테스트(A1 §1.7)가 이미 같은 형태 | 실연결이 앞당겨지면 스파이크(A1 §4 `A1-⑥`/`A1-⑦`)를 먼저 돌린다 |
| **B-D6** | **위임은 자동 제안 + 승인 실행.** 완전 자율은 `settings`의 런타임·레포별 허용 규칙을 열 때만이고 기본값은 전부 꺼짐 | 마스터 §11·§19 Q10, A4 §4.4 | — (Logan 확정) |
| **B-D7** | **Hermes는 읽기 전용 세션**(`origin:'human'`만). 위임 대상에서 제외 | 마스터 §19 Q7, A2 §4.4 | Phase C, S-A2-5 통과 시 |
| **B-D8** | 비용 상한 **$60**, VIP·민감 예비비 10%. `degraded`에서도 민감도 규칙(T2 강제)은 깨지 않는다 | 마스터 §14·§19 Q4·Q11, A4 §12.4 | Settings에서 상한·예비비율 변경 가능(감사 로그 남음) |

---

## 1. 마스터 §16과의 스코프 차이 (명시적 기록)

마스터 §16의 Phase B 행은 "메모리 3층 + ingestion, 컨텍스트 초안 + 알림, 아침 브리핑, 자동 보관 + 밤 다이제스트, 통합 검색(⌘K), PWA iPhone + Web Push, Outlook·Telegram, Hermes 읽기 전용 세션"이다. 이 백로그는 여기에 **Phase C 행의 4개 항목을 앞당긴다**:

| 앞당긴 항목 | 마스터 §16 원래 Phase | 이 백로그의 스토리 | 왜 |
|---|---|---|---|
| 투두 추출·리마인드 + 위임(자동 제안 + 승인) | C | US-B19, US-B20, US-B29 | 아침 브리핑의 `commitments` 섹션(A4 §6.2)이 `tasks`를 읽는다 — 브리핑이 Phase B인 이상 투두도 B여야 섹션이 비지 않는다 |
| Network + 팔로업 | C | US-B22, US-B30 | 초안 루프가 `persons`/`entities`의 "지금 기준"을 읽는다(A4 §3.2). 신원 해석(US-B03)이 B에 있으니 사람 화면도 같이 온다 |
| 노트 라우팅 | C | US-B21, US-B31 | 라우팅 루프는 `search_memory` 한 번 + `propose_route`뿐이라 메모리 레이어 위에서 가장 싼 소비자다 |
| 사람 라벨(person_label) | C | US-B03에 흡수 | `classify`가 이미 `person_label`을 출력한다(Phase A US-A23) — 소비처만 없었다 |

**Phase C에 남는 것**: 캡처 채널 3종(KakaoTalk/LinkedIn/WhatsApp), claude-ds·Hermes 위임 대상 승격, 터미널 세션 읽기 전용 import. 마스터 §16 표는 이 차이를 반영해 갱신이 필요하다(§6 미결 1).

---

## 2. 스토리 백로그 (45개)

`티어` 값은 A7 §3 모델 배정 규칙이다(`DeepSeek`는 Sonnet+ 리뷰 강제). `플랜` 값은 §3의 계획 파일 슬러그.

**2026-09-20 교차 리뷰 반영(M14)**: US-B20(위임)의 의존은 `B19`가 아니라 **`B07`**이다 — `routeByRule()`은 tool palette 위에서 바로 돌고 `tasks`를 읽지 않는다. 거꾸로 US-B19(`taskLoop`)가 `routeByRule`을 import하므로 **B19의 의존에 `B20`이 더해진다**. agents 플랜의 실행 순서(Task 17 → 15 → 16)가 이 방향과 같다.

| ID | 목표 | 산출물 | 검증 명령 | 티어 | 의존 | 플랜 |
|---|---|---|---|---|---|---|
| US-B01 | `@omnis/memory` 스캐폴드 + pgvector 얇은 레이어(B-D1): `embed()`(Ollama `nomic-embed-text-v1.5`, 768d, 배치 + 실패 시 `embedding=NULL` 저장), `upsertMemory()`, `searchMemories()`(부분 HNSW 경유, A3 §12 벡터 함수 래핑), `invalidateBySource()`(`source_kind`+`source_ref`로 `invalidated_at` 일괄 세팅, 삭제 금지). mem0-ts FAIL 판정 근거를 `result.md`로 남긴다 | `packages/memory/src/{index,embed,store,search}.ts`, `tools/spikes/s-a3-1-mem0-vectorstore/result.md` | `pnpm --filter @omnis/memory test:integration` | Sonnet | — | memory-ingestion |
| US-B02 | self-model 3파일(`USER.md`/`VOICE.md`/`PROJECTS.md`) 로더 + 고정 스냅샷: git 레포(`~/.omnis/self-model/`) 초기화, 파일별 토큰 상한(1,200/1,500/1,500, A4 §12.3) 검사, `snapshot()`이 `cachedPrefix`용 불변 문자열과 `sha256`을 돌려준다. 상한 초과 시 경고 시스템 Item | `packages/memory/src/self-model.ts`, `ops/self-model/README.md` | `pnpm --filter @omnis/memory test` | Sonnet | — | memory-ingestion |
| US-B03 | person 신원 해석(A3 §10): 채널별 `handle_norm` 결정론적 변환 6종, 해석 알고리즘 4단계(identity 조회 → 교차채널 이메일 매칭 → 신규 생성 `verified=false` → 추측 금지), `mergePersons()`/`splitIdentity()` 트랜잭션 + `person_merges` + `audit_log`. `ingest.sink`가 `items.author_person_id`를 채우도록 배선(Phase A는 비워뒀다) | `packages/kernel/src/identity.ts`, `packages/kernel/src/ingest.ts`(수정) | `pnpm --filter @omnis/kernel test:integration` | Opus | — | memory-ingestion |
| US-B04 | bi-temporal `entities`/`relations` 쓰기 API: `upsertEntity()`(live 유니크 충돌 시 기존 row `invalidated_at` + 새 row), `assertRelation()`, `invalidateEntity()`, `asOf(ts)` 질의(`valid_from`/`valid_until`/`invalidated_at` 3조건). 4-timestamp를 채우지 않는 쓰기 경로는 타입으로 막는다 | `packages/memory/src/entities.ts` | `pnpm --filter @omnis/memory test:integration` | Opus | B01 | memory-ingestion |
| US-B05 | 컨텍스트 조립기(A4 §1.3) + `<data>` 정규화·인젝션 태깅(A4 §1.4·§11.1): `buildContext(req)` → `{cachedPrefix, volatile, tokenEstimate, truncated, provenance}`, 캐시 경계 규율(타임스탬프·nonce는 경계 뒤), 절삭 순서 5단계(USER.md와 마지막 3턴은 불가침), NFKC+zero-width 제거·HTML 스트립·base64 미디코드·URL 축약·nonce 치환 | `packages/agents/src/context/{assemble,normalize}.ts`, `packages/agents/test/injection-set.test.ts`(20건) | `pnpm --filter @omnis/agents test` | Opus | B01, B02, B04 | memory-ingestion |
| US-B06 | 루프 런타임 계약(A4 §1.1·§1.2·§1.6): `LoopSpec`/`LoopResult`/`LoopTrigger`, 루프 레지스트리 + 커널 스케줄러·이벤트 배선, 예산 강제(`LoopBudgetError`), 공통 실패 처리 7종(타임아웃 1회 재시도 → 한 티어 상승 → `failed` + 시스템 Item, 스키마 위반, tool-not-found quarantine 24h, `injection_flags` 비면 산출물 미생성, 24h 3회 실패 → `agent_optout`). 모든 실행이 `recordRun`/`finishRun` 한 쌍 | `packages/agents/src/loop/{spec,registry,run}.ts` | `pnpm --filter @omnis/agents test` | Opus | B05 | agents |
| US-B07 | tool palette(A4 §1.5): 읽기 tool 7종(`read_thread`/`search_memory`/`read_person`/`read_entity`/`read_calendar`/`read_tasks`/`read_session`) + `propose_*` 6종(`propose_label`/`propose_draft`/`propose_task`/`propose_delegation`/`propose_route`/`propose_self_model_patch`). `propose_*`는 저장만. 팬텀 tool 12종이 레지스트리에 있으면 깨지는 유닛 테스트 + `packages/agents/**` → `packages/kernel/src/egress/**` import 금지 lint 규칙 | `packages/agents/src/tools/*.ts`, `biome.jsonc`(수정) | `pnpm --filter @omnis/agents test && pnpm lint` | Opus | B06 | agents |
| US-B08 | L9 ingestion 코어(A4 §10.3~§10.5): 청킹 3종(문서 500~800토큰/오버랩 100, 코드 함수·클래스 경계, 캘린더 1이벤트=1청크), T1 추출 → `memories`+`entities`+`relations` 4-timestamp 채우기, 소스 커서 테이블(`ingest_sources`), 실패 처리(백오프 3회, 파싱 실패 청크 스킵, 3연속 실패 → dead-letter 시스템 Item), 캘린더 소스(`calendar_events` → memories) | `packages/memory/src/ingest/{chunk,extract,source}.ts`, `packages/db/migrations/0010_ingest_sources.sql` | `pnpm --filter @omnis/memory test:integration` | Opus | B01, B04, B06 | memory-ingestion |
| US-B09 | 로컬 ingestion(미니): FSEvents 구독 + 부팅 시 1회 재스캔, 호스트별 폴더 allowlist(`settings`, 기본 빈 값), A4 §10.2 하드 제외 규칙(경로로 판정, 내용 안 봄) + `.gitignore` 병합 + 2MB 상한 + NUL 바이트 바이너리 스킵 | `packages/memory/src/ingest/local-mini.ts`, `packages/memory/src/ingest/deny.ts` | `pnpm --filter @omnis/memory test` | Sonnet | B08 | memory-ingestion |
| US-B10 | 로컬 ingestion(맥북): `local-agent`에 `ingest.scan(roots, since)`/`ingest.read(path)` RPC 구현(A2 §3.2 상한 3종: allowlist ∩ `allowed_roots` 교집합 + `realpath` 재검사, 비밀 파일 무조건 거부, 1MB 절단) + 허브 소비자(`drive_poll` 틱 동승, 오프라인이면 `since`로 따라잡기) | `apps/local-agent/src/ingest.ts`, `packages/memory/src/ingest/local-macbook.ts` | `pnpm --filter @omnis/local-agent test` | Opus | B08 | memory-ingestion |
| US-B11 | Drive + GitHub 폴링 ingestion: Drive `changes.getStartPageToken()` 베이스라인 → `changes.list(pageToken)` + `includeRemoved=true` tombstone → `invalidated_at`, GitHub ETag `If-None-Match`(304면 본문 안 받음) + rate-limit 헤더 백오프 + repo allowlist. 토큰 유실 시 베이스라인 재수립(전체 재스캔 금지) | `packages/memory/src/ingest/{drive,github}.ts` | `pnpm --filter @omnis/memory test` | Sonnet | B08 | memory-ingestion |
| US-B12 | recall 평가 하네스: `eval/memory_recall.jsonl` 50문항(기대 `source_kind`+`source_ref`+as-of 시각 포함), `pnpm eval:memory`가 recall@10을 찍는다(목표 ≥ 0.80). **하드 게이트**: `memories.source_ref`에 A4 §10.2 제외 패턴이 1건이라도 있으면 CI 실패 | `tools/eval/memory-recall.ts`, `eval/memory_recall.jsonl` | `pnpm eval:memory` | Sonnet | B08, B09, B10, B11 | memory-ingestion |
| US-B13 | L2 답장 초안 루프(A4 §3): 트리거(`item.labeled` + `needs_reply_score ≥ 0.5`, 20초 디바운스), 컨텍스트 7슬롯, `register` 규칙 판정, Deliberate 4스텝(plan→gather≤3→draft→self-check 6항), 채널별 길이·형식 8종, **60초 SLA**(55초 초과 시 `meta.pending` placeholder draft 먼저), 티어 에스컬레이션 6조건(같은 컨텍스트 재사용 1회, `escalated_from` 연결) | `packages/agents/src/loops/draft.ts`, `packages/agents/src/draft/{register,selfcheck}.ts` | `pnpm --filter @omnis/agents test` | Opus | B05, B07 | agents |
| US-B14 | 비용 미터(A4 §12.4): `costState()`/`POLICY` 5상태, 예비비 별도 집계(`model_tier='T2' AND (vip OR sensitivity≠normal)`), 루프 게이트(스케줄러·루프 진입점이 `Policy`를 읽고 스킵·강등), `cost_daily` 집계 뷰 + 00:05 잡, 상태 전이 → `audit_log` + 시스템 Item. `degraded`에서도 민감도 규칙은 안 깨진다 | `packages/kernel/src/cost/governor.ts`, `packages/kernel/src/jobs/cost-daily.ts` | `pnpm --filter @omnis/kernel test:integration` | Opus | B06 | agents |
| US-B15 | 알림 3등급 라우터(A4 §3.6): 즉시/묶음/무음 판정, 전역 조용시간 23:00~07:00(예외는 `vip AND priority='now'` 하나, Settings에서 끔), 묶음 잡(`push_batch`, 09/12/15/18 KST)이 "초안 N건 준비됨" 1건으로 접기. 본문은 **첫 80자만** 싣는다 | `packages/kernel/src/notify/{tier,batch}.ts` | `pnpm --filter @omnis/kernel test` | Sonnet | B13 | agents |
| US-B16 | Web Push VAPID 키쌍 생성·보관: Keychain `omnis.webpush.vapid_private`/`…public`, `omnis-run-with-secrets.sh`가 env로 주입, 회전 절차 문서화(A6 §9 6단계) | `ops/scripts/gen-vapid.sh`, `ops/mini/RUNBOOK.md`(수정) | `bash ops/scripts/gen-vapid.sh --check` | Haiku | — | ops |
| US-B17 | 알림 전달 2경로: macOS 로컬 알림(Tauri notification plugin, 클릭 → `omnis://thread/{id}` 딥링크) + Web Push 발송기(VAPID 서명, `push_subscriptions` 조회, 액션 2개 `Approve`/`Open`, 410/404 응답 시 구독 정리). 발송 실패는 조용히 삼키지 않고 `agent_runs`가 아니라 시스템 Item으로 | `apps/desktop/src-tauri/src/notify.rs`, `packages/kernel/src/notify/webpush.ts` | `pnpm --filter @omnis/kernel test` | Sonnet | B15, B16 | agents |
| US-B18 | L8 자동 보관 루프(A4 §9) + 7일 undo: 하드 게이트 5종 먼저(민감·VIP·pending approval·injection_flags·kind), 판정 ①③④는 순수 SQL(T0), ②·④-b만 T1(`confidence ≥ 0.85`, 미달이면 보관 안 함), `items.meta.archived_by` 기록, 22:00 스윕 잡, `undoArchive()`(`archived`→`received` + `audit_log` + 해당 스레드 30일 제외). **하드 삭제 경로 없음** | `packages/agents/src/loops/auto-archive.ts`, `packages/kernel/src/archive.ts` | `pnpm --filter @omnis/agents test && pnpm eval:archive` | Opus | B06 | agents |
| US-B19 | L3 투두 추출 + 리마인드(A4 §4): 트리거 3종(`item.labeled`/`item.sent`/cron 09·14·19), 정밀도 우선(`confidence < 0.70`은 저장조차 안 함, item당 최대 3, `duplicate_of` 코사인 > 0.82면 기존 task에 `source_item_id` 추가), `due_basis='inferred'` 표시, 리마인드 잡은 LLM 없이 순수 SQL 3그룹 | `packages/agents/src/loops/task.ts`, `packages/kernel/src/jobs/task-remind.ts` | `pnpm --filter @omnis/agents test` | Sonnet | B07, B20 | agents |
| US-B20 | 위임 제안 + L4 판단 + 승인 실행(A4 §4.4·§5, B-D6): `DelegationHints` 추출(정규식, LLM 아님) + `routeByRule()`(~1ms, 규칙 5종), 규칙이 가르면 그 자리에서 `propose_delegation` → 승인 카드, 못 가르면 L4(T2)를 깨운다. 폭주 방지 4종(하루 5건, 스레드당 24h 2건, `confidence < 0.70` 제외, `injection_flags` 있으면 절대 제외). 승인 1회 → `delegate.run` 실행, 완전 자율은 `settings` 규칙이 열렸을 때만이고 `est_minutes > 30`·레포 밖·egress 포함이면 여전히 승인 | `packages/agents/src/delegate/{route,brief}.ts`, `packages/agents/src/loops/delegate.ts` | `pnpm --filter @omnis/agents test` | Opus | B07 | agents |
| US-B21 | L7 노트 라우팅 루프(A4 §8): `note` insert 트리거 → 후보 최대 3개(`propose_route`), 신뢰도 낮으면 제안 자체를 안 한다(수동 선택으로 수렴), 자동 라우팅 없음 — `notes.route_state`는 사람이 수락해야 `accepted` | `packages/agents/src/loops/note-route.ts` | `pnpm --filter @omnis/agents test` | Sonnet | B07 | agents |
| US-B22 | L6 Network 팔로업 루프(A4 §7): 초면 판정(§7.2), 비활성 감지 스윕(`network_inactive_sweep`, 평일 10:00, `persons.cadence_days`/`priority_score` 기반 SQL), 출력 = 톤매칭 draft + task, `persons.relationship_state` 갱신(`closed`만 승인 필요) | `packages/agents/src/loops/followup.ts` | `pnpm --filter @omnis/agents test` | Sonnet | B03, B07 | agents |
| US-B23 | L5 아침 브리핑(A4 §6.1~§6.3): 06:30 KST 동기 호출(배치 큐 아님), 콘텐츠 모델 6섹션 + `BriefItem`, **랭킹은 LLM이 아니라 산술 점수**(8항 가중합, 한 스레드는 브리핑 전체에서 1회), LLM은 한 줄 요약 문장만. `digests(kind='morning')` 1행 + 커버리지 지표 자동 계산 | `packages/agents/src/loops/digest-morning.ts`, `packages/agents/src/digest/rank.ts` | `pnpm --filter @omnis/agents test` | Opus | B18, B19 | agents |
| US-B24 | L5 밤 다이제스트(A4 §6.4·§6.5): 23:00 KST, `NightlyDigest` 모델(그룹별 `reason`/`samples`≤3/`undo_token` 7일), 자동 보관 **전량** 노출, `cost` 필드(MTD/cap/tier_state), 야간 메모리 통합은 T2 + Anthropic Message Batches(23:30 `memory_consolidate`, 다음 아침 전 수확). DeepSeek Batch API 유무는 S-A4-2로 열어둔다 | `packages/agents/src/loops/digest-nightly.ts`, `packages/agents/src/memory/consolidate.ts` | `pnpm --filter @omnis/agents test` | Opus | B14, B18, B23 | agents |
| US-B25 | self-model 수정 제안(A4 §13): 일요일 21:00 잡, 입력 5종(내가 직접 고쳐 보낸 초안 diff, 손으로 고친 라벨, self-model과 모순되는 신규 entity, 파일 전문, 상한 초과 여부), 패치 제약(파일당 1개·최대 3개·변경 ≤20줄·`evidence` ≥2, USER.md 삭제는 ≥3), 승인 시 `git apply`+커밋+스냅샷 캐시 무효화, 무시된 패치는 diff 해시로 4주 억제 | `packages/agents/src/self-model/propose.ts`, `packages/kernel/src/self-model/apply.ts` | `pnpm --filter @omnis/agents test` | Opus | B02, B07 | agents |
| US-B26 | 통합 검색 API(A4 §14): `GET /search?q&k&scope&since`, 네 갈래 병렬 쿼리(items FTS + trgm 폴백 / threads 집계 / persons trgm+handle_norm / memories kNN), 그룹 내 정규화 + `group_weight` 병합 랭킹 + recency·VIP 가산, 그룹당 5·전체 20 상한, `SearchResponse` 스키마 그대로. `agent_runs` 행을 남기지 않는다(사람이 친 검색은 에이전트 실행이 아니다) | `apps/hub/src/search.ts`, `packages/memory/src/search.ts`(수정) | `pnpm --filter @omnis/hub test` | Opus | B01, B03 | surfaces |
| US-B27 | ⌘K 검색 모드(A5 §2.5): 입력이 액션과 매치 안 되면 팔레트가 검색 결과로 전환, 그룹 순서 고정(people→threads→items→memories), 180ms 디바운스, `deep_link`가 null인 memory는 클릭 비활성, 빈 상태·느림 상태 카피 | `packages/ui/src/components/command-palette.tsx`(수정), `apps/desktop/src/api/search.ts` | `pnpm --filter @omnis/desktop test` | Sonnet | B26 | surfaces |
| US-B28 | Today 화면(A5 §3.4): 인사말 `<h1>`, 밤 다이제스트 진입 카드(nightly가 있을 때만), 오늘 캘린더, 아침 브리핑 리스트(항목 클릭 → 스레드 딥링크), 대기 승인 칩 스트립(클릭 시 인라인 확장 — 화면 이동 없음). 4상태(로딩/빈/오류/오프라인) 전부 | `apps/desktop/src/screens/Today.tsx`, `packages/ui/src/components/digest-card.tsx` | `pnpm --filter @omnis/desktop test` | Sonnet | B23 | surfaces |
| US-B29 | Tasks 화면(A5 §3.5): 뷰 탭 4개(Today/This week/Someday/Delegated), `TaskRow`(네이티브 체크박스 + 출처 딥링크 + `kind` 아이콘 + `due_basis='inferred'` 점선), `t` 단축키 빠른 추가, Delegated 행 → Agent Session 이동, 위임 승인 카드 인라인 | `apps/desktop/src/screens/Tasks.tsx`, `packages/ui/src/components/task-row.tsx` | `pnpm --filter @omnis/desktop test` | Sonnet | B19, B20 | surfaces |
| US-B30 | Network 화면(A5 §3.6): `PersonCard`(이니셜 아바타 B-D3, 소속·직함은 `entities` "지금 기준", 관계 dot 3단 + 텍스트 레이블 병기), 팔로업 큐 상단 스트립, 사람 상세 pane(타임라인 + 전 채널 링크 + 메모), "같은 사람입니다" 병합/분리 UI | `apps/desktop/src/screens/Network.tsx`, `packages/ui/src/components/person-card.tsx` | `pnpm --filter @omnis/desktop test` | Sonnet | B03, B22 | surfaces |
| US-B31 | Notes 화면(A5 §3.7): 한 줄 입력(`n` 전역 단축키, 저장 후 포커스 유지), `RoutingSuggestion` 3버튼(수락/다른 대상/라우팅 안 함), 신뢰도는 텍스트로만("높음"/"낮음"), 오류와 no-match를 사용자에게 구분해 보여주지 않는다 | `apps/desktop/src/screens/Notes.tsx` | `pnpm --filter @omnis/desktop test` | Sonnet | B21 | surfaces |
| US-B32 | Digest 화면(A5 §3.8): 카테고리 아코디언, 그룹·개별 되살리기(낙관적 업데이트 + toast), 월간 비용 리포트 섹션, Thread 헤더의 "자동 보관됨 · N일 전 — 되살리기" 인라인 배너(7일 이내만) | `apps/desktop/src/screens/Digest.tsx` | `pnpm --filter @omnis/desktop test` | Sonnet | B24 | surfaces |
| US-B33 | Settings 화면(A5 §3.9) + `settings` 쓰기 경로: 서브 nav 4개(Accounts/Autonomy/Model tiers/General), 비용 상한 **편집 가능** 숫자 입력 + 진행률 바(마지막 10% 예비비 세그먼트, 80%/100% 색 + 텍스트 병기), 자율 허용 토글(기본 꺼짐 + 경고 다이얼로그), 로컬·Drive·GitHub allowlist 편집, 자동 보관 임계, 조용시간, kill switch 2단계 확인 | `apps/desktop/src/screens/Settings.tsx`, `apps/hub/src/settings.ts` | `pnpm --filter @omnis/desktop test && pnpm --filter @omnis/hub test` | Sonnet | B09, B11, B14, B18 | surfaces |
| US-B34 | Tailscale Serve 마운트 + ACL 문서: `/api/` → `localhost:8787`, `/` → PWA 정적 빌드, `*.ts.net` 인증서 확인 스크립트, ACL(grants) 문서에 Postgres 5432·Ollama 11434를 `dst`에 넣지 않는 이유 명기, Funnel은 상시 OFF | `ops/mini/tailscale-serve.sh`, `ops/mini/TAILSCALE-ACL.md` | `bash ops/mini/tailscale-serve.sh --check` | Sonnet | — | ops |
| US-B35 | `apps/web` PWA 셸(A5 §4.1~§4.3, B-D4): Vite + 같은 `@omnis/ui`, 하단 탭바 5칸(Inbox/Today/Tasks/Network/Notes — Digest·Settings는 탭에 없다), manifest + 서비스 워커 + 설치 안내 3단계 카드, 스와이프 액션(오른쪽=Archive, 왼쪽=액션 메뉴, 승인 대기는 스와이프 대신 탭), 스누즈 프리셋 4개, quick-reply 칩 3개, 허브가 빌드 산출물을 서빙 | `apps/web/src/**`, `apps/web/public/manifest.webmanifest` | `pnpm --filter @omnis/web test` | Sonnet | B28, B34 | surfaces |
| US-B36 | PWA Web Push 구독(A5 §4.4): 권한 요청은 **첫 승인 대기 항목이 생겼을 때** 컨텍스트 안에서, `POST /push/subscribe` + `push_subscriptions` 저장, 서비스 워커 `notificationclick`(Approve = 앱 안 열고 `pending_approvals` accept, Open = 딥링크), 알림 종류 6종 문구 | `apps/web/src/push/*.ts`, `apps/hub/src/push.ts` | `pnpm --filter @omnis/web test` | Sonnet | B17, B35 | surfaces |
| US-B37 | Outlook 어댑터(A1 §2.4): `/common` authority OAuth(위임 스코프 3종), delta 폴링(`/me/mailFolders/inbox/messages/delta`), thread=`conversationId`·item=`id`·`sourceHash=internetMessageId`, write-back 3종(send/markRead/archive=move), 429 `Retry-After`, delta 410 → 풀 재동기화. **픽스처 계약 테스트로만 인수**(B-D5) | `packages/adapters/outlook/src/index.ts`, `packages/adapters/outlook/fixtures/*.json` | `pnpm --filter @omnis/adapter-outlook test && pnpm test:contract` | Sonnet | — | channels |
| US-B38 | Telegram 어댑터(A1 §2.5): mtcute 사이드카, QR 로그인 페어링 플로우, 세션 파일 + Keychain 래핑 키, MTProto update 스트림, `getHistory` backfill, write-back(send/markRead, archive=false), flood-wait 동적 대기. **픽스처 계약 테스트로만 인수** | `packages/adapters/telegram/src/index.ts`, `packages/adapters/telegram/fixtures/*.json` | `pnpm --filter @omnis/adapter-telegram test && pnpm test:contract` | Sonnet | — | channels |
| US-B39 | Hermes 읽기 전용 세션(A2 §4.4, B-D7): `local-agent`의 HTTP형 런타임 어댑터(`base_url` 기본 `http://127.0.0.1:8642`, bearer), `session_key` → `X-Hermes-Session-Key` 1:1, `/v1/responses` 체인, SSE keepalive는 이벤트로 올리지 않고 health 타이머만, `origin:'human'`만 허용(`delegation` 거부), 미니·맥북 각각 별개 `AgentRuntime` 등록 | `apps/local-agent/src/bridges/hermes.ts` | `pnpm --filter @omnis/local-agent test` | Opus | — | channels |
| US-B40 | 실연결 하드닝 + 어댑터 health → 시스템 Item: 토큰 갱신 잡(`token_refresh`) 실동작, `gmail_rewatch`(7일)·`graph_sub_renew`(10,080분) 재신청, backfill 상한(채널별 30일·500건), `auth_required`/`broken` 전이 시 `accounts.state`+`last_error`+시스템 Item, `health()` 실패 연속 N회 → ntfy + 인박스 이중 노출. 전부 mock 서버로 인수 | `packages/kernel/src/jobs/{token-refresh,rewatch}.ts`, `packages/kernel/src/adapter-health.ts` | `pnpm --filter @omnis/kernel test:integration` | Sonnet | B37, B38 | channels |
| US-B41 | 백업: `pg_dump --format=custom` 03:00 LaunchDaemon + restic → B2(`pg` 덤프 + self-model git + `secrets/*.enc.yaml`), forget 정책(7일/4주/6개월), **분기 복구 리허설 스크립트**(스크래치 포트 5433 복원 + `items`/`threads`/`pending_approvals` row count + 최신 `sent_at` 검증) + `backup/restore-drills.md` | `ops/scripts/omnis-backup.sh`, `ops/scripts/restore-drill.sh`, `ops/mini/LaunchDaemons/*.plist` | `bash ops/scripts/restore-drill.sh --dry-run` | Sonnet | — | ops |
| US-B42 | 모니터링 + 로그 로테이션: healthchecks.io 체크 15종 ping 배선(성공 `/`, 실패 `/fail`), self-hosted ntfy 2토픽(`omnis-critical`/`omnis-warning`), 모든 critical/warning은 ntfy + `items(kind='system')` 이중 노출, `newsyslog`/logrotate 30일 보관 + 시크릿 마스킹 확인 | `ops/scripts/healthcheck-ping.sh`, `ops/mini/newsyslog.d/omnis.conf` | `bash ops/scripts/healthcheck-ping.sh --check` | Sonnet | B40 | ops |
| US-B43 | 미니 부팅 체크리스트 자동화(A6 §2): FileVault 켠 채 자동 로그인 확인, `pmset` 설정(슬립 금지·전원 복구 시 자동 부팅), LaunchDaemon/Agent 로드 상태, Ollama 모델 존재, 슬롯 헬스 1회 — 한 스크립트가 전부 검사하고 실패 항목만 출력 | `ops/mini/preflight.sh`, `ops/mini/RUNBOOK.md`(수정) | `bash ops/mini/preflight.sh --check` | Haiku | — | ops |
| US-B44 | 비용·사용량 월간 리포트 잡: `agent_runs` 집계(루프별·티어별·provider별 토큰·비용·캐시 히트율 `tokens_cached/tokens_in`), 월 1일 `digests.metrics`에 적재 + 밤 다이제스트 `cost` 필드가 매일 MTD 노출, 캐시 히트율 40% 미만 루프는 리포트에 경고 줄 | `packages/kernel/src/jobs/cost-report.ts` | `pnpm --filter @omnis/kernel test:integration` | Sonnet | B14, B24 | ops |
| US-B45 | 허브 어댑터 레지스트리 + 부트스트랩 배선: `apps/hub/src/adapters.ts`가 `accounts`(+`account_secrets.auth_ref`) 행을 읽어 채널별 어댑터 패키지의 팩토리로 `Adapter` 인스턴스를 만들고 `connect(AuthRef)`(비밀은 각 어댑터가 Keychain에서 직접 읽는다 — 허브는 항목 이름만 넘긴다), `createHubServer({adapters})`에 주입해 보관 write-back(US-A36)과 이후 전송 경로가 실제로 동작하게 하고, `state='active'` 계정마다 `subscribe()` 루프를 띄워 health 전이를 시스템 Item으로 남긴다. 레지스트리(`AdapterFactories`)는 주입 가능해서 **가짜 팩토리로 픽스처 테스트가 된다**(B-D5) | `apps/hub/src/adapters.ts`, `apps/hub/src/main.ts`(수정) | `pnpm --filter @omnis/hub test` | Opus | B37, B38, B40 | channels |

---

## 3. 계획 파일 5개

| 계획 파일 | 슬러그 | 스토리 | 개수 |
|---|---|---|---|
| `2026-09-20-phase-b-memory-ingestion.md` | `memory-ingestion` | US-B01, B02, B03, B04, B05, B08, B09, B10, B11, B12 | 10 |
| `2026-09-20-phase-b-agents.md` | `agents` | US-B06, B07, B13, B14, B15, B17, B18, B19, B20, B21, B22, B23, B24, B25 | 14 |
| `2026-09-20-phase-b-surfaces.md` | `surfaces` | US-B26, B27, B28, B29, B30, B31, B32, B33, B35, B36 | 10 |
| `2026-09-20-phase-b-channels.md` | `channels` | US-B37, B38, B39, B40, B45 | 5 |
| `2026-09-20-phase-b-ops.md` | `ops` | US-B16, B34, B41, B42, B43, B44 | 6 |

**병렬 웨이브 제안**(worktrunk 형제 워크트리, 계획 단위 브랜치 `plan/<slug>`):

- **W1**: memory-ingestion US-B01~B05 + ops 전부(US-B16/B34/B41~B43은 코드 의존이 없다) + channels US-B37~B39
- **W2**: agents US-B06~B07 머지 후 → US-B13~B25, memory-ingestion US-B08~B12
- **W3**: surfaces 전부 + channels US-B40 + ops US-B44

---

## 4. 모든 스토리 공통 금지 사항

A7 §7의 Phase A 금지 4종을 그대로 상속하고 Phase B가 5종을 더한다.

**상속**:
- 비가역 tool(`send`/`delete`/`delegate`/`calendar_write`)을 승인 게이트 밖에서 직접 연결하지 않는다.
- `packages/protocol` 밖에서 provider SDK를 임의로 import하지 않는다(어댑터·`t1/provider.ts` 안으로 격리).
- 마이그레이션 파일을 수정하지 않는다 — 항상 새 번호를 추가(append-only).
- 테스트를 삭제하거나 스킵해서 통과시키지 않는다.

**Phase B 추가**:
1. **`packages/agents/**`에서 egress 모듈을 import하지 않는다**(A4 §1.1). `apply()` 안에서도 금지이고 lint 규칙으로 강제한다(US-B07).
2. **`propose_*`는 저장만 한다.** `archive`조차 모델의 tool이 아니다 — 자동 보관은 커널 잡의 SQL 전이다(A4 §9).
3. **하드 삭제 경로를 만들지 않는다.** `memories`/`relations`는 `invalidated_at`으로만 무효화하고 `items`는 영구 보존한다(A3 §11).
4. **A4 §10.2 제외 패턴에 걸리는 경로는 열지 않는다.** 내용을 보고 판단하지 않는다 — 판단하려면 이미 읽은 뒤다. 위반 1건 = CI 실패(US-B12).
5. **실계정 자격증명을 테스트에 넣지 않는다**(B-D5). 어댑터·ingestion·푸시는 전부 픽스처/mock으로 인수한다.
6. `~/.claude/.credentials.json`류 구독 크리덴셜을 읽지 않는다(A4 §12.1 T3 경계, Phase A 테스트가 이미 감시한다).

---

## 5. Phase B 종료 기준 (마스터 §16)

> 초안 채택률·브리핑 커버리지 측정 시작, 월 비용 실측.

측정 가능 상태의 구체:

| 지표 | 목표 | 측정 경로 | 소유 스토리 |
|---|---|---|---|
| 초안 채택률 | ≥ 50% | `items.status` 전이(`draft`→`approved`/`sent`) | US-B13 |
| 무수정 전송률 | ≥ 20% | `sent` body vs `draft` body Levenshtein | US-B13 |
| 브리핑 커버리지 | ≥ 80% | `digests.item_ids` ∩ 그날 열거나 답한 item | US-B23 |
| 자동 보관 오보관 | precision ≥ 0.97, VIP·민감 보관 **0건** | `eval/auto_archive.jsonl` 150건 + CI 하드 게이트 | US-B18 |
| memory recall@10 | ≥ 0.80 | `eval/memory_recall.jsonl` 50문항 | US-B12 |
| 월 비용 | 실측치가 `agent_runs.cost_usd` 합계로 나온다(추정 ~$22, 상한 $60) | `cost_daily` 뷰 + 월간 리포트 | US-B14, US-B44 |
| 캐시 히트율 | 초안 루프 `tokens_cached/tokens_in` ≥ 40% | 주간 리포트 | US-B44 |
| 인젝션 방어 | 테스트 세트 20건 전부 통과 | CI | US-B05 |

**Phase B 진입 스파이크**(A6 §11.2 "Phase 진입 시 16개" 중 이 Phase 소유분): `A1-⑥`(Outlook Graph delta), `A1-⑦`(Telegram mtcute 페어링), `S-A4-2`(DeepSeek Batch API 유무), `S-A4-6`(GitHub App vs PAT), `S-A4-7`(검색 p95 지연), **`gate-hermes-sse`(Hermes `/v1/responses` SSE 이벤트 필드명 — 2026-09-20 교차 리뷰에서 새로 등록, channels 플랜 Task 11-S 소유)**, `S-A2-5`는 Phase C로 미룬다. 전부 해당 스토리 안에서 돌리고 `tools/spikes/<slug>/result.md`에 pass/fail을 남긴다.

---

## 6. 미결 질문

1. **마스터 §16 표 갱신.** §1의 앞당긴 4항목(투두·위임, Network·팔로업, 노트 라우팅, 사람 라벨)이 Phase C 행에 그대로 남아 있다. 마스터를 고칠지, 이 백로그를 "Phase B+" 로 표기할지 Logan 결정 필요.
2. **`settings` 테이블(B-D2)은 A3에 없는 신규 테이블이다.** A3 §8의 "이 목록이 v1 테이블의 전체 목록이다"와 충돌한다 — A3에 `0009`를 추가 기재해야 한다(델타 문서 §5가 초안).
3. **자동 보관 `undo` 창의 기준 시각**이 `items.meta.archived_by.at`(jsonb)이라 하루치 조회가 인덱스를 못 탄다(A4 §9.3이 "느려지면 컬럼으로 승격"으로 열어둠). 첫 2주 실측 후 `items.archived_at` 컬럼 승격 여부를 정한다.
4. **Web Push의 iOS 백그라운드 신뢰성**(A5 §4.4, `13`). 배달 누락률을 US-B36에서 계측 지표로 남기고, 반복되면 v2 네이티브 셸 근거로 쓴다.
5. **초안 골든 세트 40건**(`eval/draft.jsonl`)은 "Logan이 실제로 보낸 답장"이 정답이라 **실계정 연결 전에는 채울 수 없다**. US-B13은 톤 유사도·길이 준수 지표를 배선만 해두고 세트는 연결 후 채운다. → **결정됨(§7-1)**.
6. **`memory_consolidate`(T2 Batch)의 Anthropic API 키**가 Keychain에 아직 없다(`omnis.anthropic.api_key`). 키가 없으면 US-B24의 통합 잡은 스킵되고 다이제스트만 돈다 — 이 폴백을 기본 동작으로 둘지 확인 필요.

---

## 7. Logan 결정 (2026-09-20 교차 리뷰 후)

교차 리뷰(`2026-09-20-phase-b-plans-review.md` §4)가 올린 3건에 대한 답이다. 이 절이 정본이고, 위 §5·§6의 해당 항목은 여기를 가리킨다.

1. **골든 세트 종료 기준은 실계정 연결 전까지 유예한다.** `eval/draft.jsonl`(B13)·`eval/task.jsonl`·`eval/route_note.jsonl`·`eval/followup.jsonl`은 합성 데이터로 **형식·하네스·하드 게이트만** 인수하고, §5 표의 **초안 채택률(≥50%)·무수정 전송률(≥20%)·브리핑 커버리지(≥80%)** 세 지표는 Phase B 종료 판정에서 **제외**한다(측정 배선이 돌아가는 것까지가 Phase B의 종료 조건이다). 유예하지 **않는** 것: `eval/auto_archive.jsonl`의 **VIP·민감 보관 0건**과 `eval/memory_recall.jsonl`의 **recall@10 ≥ 0.80** — 앞은 안전 불변식이라 합성 데이터로도 깨지면 안 되고, 뒤는 정답이 소스 문서라 합성으로도 진짜 값이 나온다.
2. **허브·local-agent 부트스트랩 배선은 channels 플랜의 US-B45다.** 위 §2에 스토리를 신설했다(`apps/hub/src/adapters.ts` + `apps/hub/src/main.ts` 수정). 어댑터 팩토리 레지스트리를 주입 가능하게 만들어 가짜 팩토리로 픽스처 테스트한다(B-D5 유지). `apps/local-agent`의 `adapters: Map<RuntimeKind, RuntimeAdapter>` 배선은 Hermes 런타임이 붙는 US-B39 Task에서 같이 닫는다.
3. **Hermes SSE 필드명 스파이크를 Phase B 진입 스파이크에 등록한다.** 슬러그 `gate-hermes-sse`, 소유는 channels 플랜의 US-B39 선행 태스크(Task 11-S). 미니의 Hermes `api_server`(:8642)가 떠 있지 않을 수 있으므로 **실연결이 없으면 문서 기반 + 픽스처로 진행하고 `result.md`에 `UNVERIFIED`를 명시**한다 — 스파이크 실패가 US-B39를 막지 않는다(메커니즘은 mock SSE로 완전히 검증되고 필드명만 실연결 시점 확정 대상이다).
