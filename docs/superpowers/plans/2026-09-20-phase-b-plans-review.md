# Phase B 계획 5종 교차 리뷰 (2026-09-20)

입력: `2026-09-20-phase-b-backlog.md`, `…-interfaces-delta.md`, `…-phase-a-interfaces.md`, `…-phase-b-{memory-ingestion,agents,surfaces,channels,ops}.md`.

판정: **조건부 ready**. 아래 M1~M3(순환·이중 생성)을 웨이브 0으로 걷어내면 병렬 실행 가능하다. M4~M11은 델타 문서를 고쳐서 닫았고(§"적용한 델타 수정"), M12~M16은 실행 노트다.

---

## 1. 불일치 표

| # | 종류 | 내용 | 증거 | 고칠 사람 |
|---|---|---|---|---|
| **M1** | 중복 작업 | `0012_jobs_phase_b.sql`을 agents Task 7과 channels Task 5가 **각자** 만든다. 내용이 다르다 — agents판엔 `CREATE VIEW cost_daily` + 주석이 더 붙는다. channels는 "바이트 단위로 동일"을 전제하지만 사실이 아니라 머지 충돌 + 러너 sha256 throw(계약 §4). ops는 `0014`로 이미 도피 | agents:2134·2151, channels:1061·1065, ops:1127 | **델타 §6**(수정함) → channels·ops 플랜 저자 |
| **M2** | 순환 의존 | `settings` 테이블·`getSetting`은 surfaces US-B33(W3) 소유인데 agents B14(W2)·memory-ingestion B11(W2)이 소비한다. 백로그는 B33 의존을 B09/B11/B14/B18로 적어 **양방향** | agents:1896·2029, mem-ing:8048·8375, 백로그 US-B33 행 | **백로그 §3 + 델타 §6**(수정함) |
| **M3** | 순환 의존 | 같은 형태. agents Task 12(US-B17)가 `0011_push_subscriptions.sql`을 기다리는데 그 파일은 surfaces US-B36 소유, B36 의존은 B17 | agents:6736, surfaces:3096 | **백로그 §3 + 델타 §6**(수정함) |
| **M4** | 심볼 부재 | 델타 §4 "`LoopId`는 Phase A의 9값 그대로" — Phase A에 `LoopId` export가 없다(`RecordRunInput.loop` 인라인 유니온뿐). 게다가 `morningDigestLoop`/`nightlyDigestLoop`이 `'digest'` 한 값을 공유해 `registerLoop` 키가 충돌한다 | phase-a:439, agents:180·"델타에 더하는 것" 표 | **델타 §4**(수정함) |
| **M5** | 시그니처 | 델타 §4가 `assemble(ctx: TriggerContext)`를 쓰면서 `TriggerContext`를 정의하지 않는다. `startLoops(deps:{kernel: Kernel; logger: Logger})`는 §1의 "`@omnis/agents`는 `@omnis/kernel`을 의존하지 않는다"와 자기모순 | 델타:206·217, agents:28~40 | **델타 §4**(수정함) |
| **M6** | 고아 심볼 | `ingestLoop: LoopSpec<IngestOutput>`이 델타에만 있고 5개 플랜 어디도 만들지 않는다. 실제 진입점은 `runIngest(deps)` | 델타:259, 전 플랜 grep 0건 | **델타 §4**(삭제함) |
| **M7** | 패키지 경계 | `isDenied`/`DENY_PATTERNS`를 델타 §3은 `@omnis/memory`에 두는데, `apps/local-agent`가 `@omnis/protocol`만 의존해서 memory-ingestion은 **protocol에 정의 + memory가 re-export**로 바꿨다 | mem-ing:39 표 | **델타 §3**(수정함) |
| **M8** | 고아 라우트 | `GET /transcript/:session_id`를 델타 §7이 US-B39에 달았지만 channels는 `apps/local-agent` 한 파일만 만들고 구현하지 않았다. surfaces도 안 한다 | channels:3180 | **델타 §7**(재배정함) → surfaces 플랜에 태스크 1개 추가 필요 |
| **M9** | 델타 누락 | surfaces Task 6이 `POST /notes/:id/route`를 새로 만든다 — 델타 §7에 없다 | surfaces:1720·1855 | **델타 §7**(추가함) |
| **M10** | 델타 누락 | `OMNIS_OPENROUTER_API_KEY`(agents T2 + memory-ingestion T1), `OMNIS_NTFY_URL`(channels+ops, 둘 다 `http://127.0.0.1:2586`로 일치). Keychain `omnis.openrouter.api_key`·`omnis.healthchecks.<slug>`·`omnis.restic.*`·`omnis.b2.*`도 없다 | agents:552·26, mem-ing:24, channels:2626, ops:764 | **델타 §9**(추가함) |
| **M11** | 델타 누락 | agents Task 7이 `settings`에 `cost.last_state`를 raw SQL로 넣는데 `SettingKey` 유니온에 없다 → `getAllSettings`가 타입 밖 키를 흘린다 | agents:2279·2292, surfaces:2381 | **델타 §5**(추가함) |
| **M12** | 중복 작업 | 루트 `package.json` 스크립트 5개를 memory-ingestion Task 1이 "오너"로 넣는데 agents Task 14가 `eval:archive`를 다시 넣는다 | mem-ing:218, agents:4136 | agents 플랜 저자(해당 스텝 삭제) |
| **M13** | 파일 교차 소유 | surfaces Task 1이 `packages/memory/src/search.ts`에 `truncateSnippet` export를 더한다 — memory-ingestion Task 4 소유 파일 | surfaces:36·213 | surfaces 저자(memory-ingestion Task 4에 미리 넣게 요청) |
| **M14** | 의존 역전 | 백로그는 US-B20 의존 = B19인데, agents 실행 순서는 Task 17(`routeByRule`, B20) → Task 15(`taskLoop`, B19)다(`taskLoop`이 `routeByRule`을 import) | agents:6739 | **백로그 §2**(B20 의존을 `B07`로, B19 의존에 `B20` 추가) |
| **M15** | 검증 전제 | B-D5(픽스처만)는 대체로 지켜졌다. 남는 것: ① `pnpm eval:memory`(B12)는 로컬 Ollama `11434` + `nomic-embed-text-v1.5` pull이 **실제로** 필요하다(자격증명은 아니지만 CI 전제) ② `eval/draft.jsonl`(B13)·`auto_archive.jsonl`(B18)·`task/route_note/followup` 5종 골든 세트는 실계정 전까지 합성이라 종료 기준 수치가 **가짜다** ③ B24 `memory_consolidate`는 키 없으면 null 반환(플랜이 처리함, OK) | 백로그 §6-5, agents:6262, mem-ing:457 | Logan(백로그 §6-5 유예 결정) |
| **M16** | 머지 마찰 | `packages/kernel/src/index.ts`(5개 플랜), `pnpm-workspace.yaml`·루트 `tsconfig.json`(4개), `biome.jsonc`(2개)를 동시에 건드린다. 전부 append-only 한 줄이라 충돌은 기계적이지만 자동 머지는 실패한다 | 파일별 grep | 실행자(웨이브 끝마다 순차 머지) |

---

## 2. 적용한 델타 수정 (old → new)

`…-phase-b-interfaces-delta.md`에 직접 반영했다.

1. **§6 표 앞에 단일 오너 규칙 신설** — old: 5파일이 B33/B08/B36/B14·B15·B37·B44/B33에 흩어짐 → new: `0009`·`0011`·`0012`·`0013`을 **웨이브 0 스키마 번들**(단일 워크트리·단일 커밋)로 묶고 `packages/kernel/src/settings.ts`를 같이 낸다. `0010`만 memory-ingestion 소유. ops의 `0014_cost_report_job.sql`은 불필요해져 삭제.
2. **§4 `LoopId`** — old: "Phase A의 9값 그대로" → new: `@omnis/agents`가 `export type LoopId`를 새로 낸다(`agent_runs.loop` 9값과 동일), `digest`를 공유하는 두 루프는 `registerLoop`을 타지 않고 `runLoopSpec(spec, ctx)`로 직접 부른다.
3. **§4에 5심볼 추가** — `TriggerContext`, `LoopSpec.decide?()`, `runLoopSpec`, `LoopKernel`/`LoopLogger`, `writeSystemItem`.
4. **§4 `startLoops`** — old: `deps: { kernel: Kernel; logger: Logger }` → new: `deps: { kernel: LoopKernel; logger: LoopLogger }`(§1 의존 규칙 준수).
5. **§4 `ingestLoop` 행 삭제** — `runIngest(deps)`를 허브 cron이 직접 부른다.
6. **§3 `isDenied`/`DENY_PATTERNS`** — old: `@omnis/memory` 정의 → new: `@omnis/protocol` 정의 + `@omnis/memory` re-export.
7. **§3에 memory-ingestion이 고정한 9심볼 추가** — `estimateTokens`, `EntityRow`, `ensureSelfModelRepo`, `overCapWarning`, `IngestProvider`/`IngestDoc`/`registerIngestProvider`, `Extractor`/`setExtractor`, `chunkCalendarEvent`/`DEAD_LETTER_THRESHOLD`. `@omnis/agents` 쪽 `scanInjection`/`setContextBudget`/`CONTEXT_INPUT_BUDGET_TOKENS`도 §4에 추가.
8. **§5 `SettingKey`** — `| "cost.last_state"` 추가(내부 키, Settings 화면 비노출).
9. **§7** — `GET /transcript/:session_id` 오너를 **B39 → surfaces 신규 태스크**로 재배정, `POST /notes/:id/route`(B31) 행 추가.
10. **§9** — `OMNIS_OPENROUTER_API_KEY`·`OMNIS_NTFY_URL`(기본 `http://127.0.0.1:2586`) 추가, Keychain에 `omnis.openrouter.api_key`·`omnis.healthchecks.<slug>`·`omnis.restic.repo_password`·`omnis.b2.app_key` 추가.
11. **§1 루트 스크립트** — "오너 = memory-ingestion Task 1, 다른 계획은 이 블록을 다시 건드리지 않는다" 문장 강화.

델타 밖이라 **내가 못 고친 것**: M12·M13·M14(각 플랜 본문과 백로그 §2·§3 수정), M8의 surfaces 신규 태스크 작성.

---

## 3. 실행 웨이브 (체인 = 순차 워크트리 1개, 웨이브당 ≤5)

**W0 — 스키마 번들 (1체인, 선행 필수)**
`0009_settings.sql` + `packages/kernel/src/settings.ts` + `0011_push_subscriptions.sql` + `0012_jobs_phase_b.sql`(잡 4건 + `cost_daily` 뷰) + `0013_publication_phase_b.sql` + 루트 `package.json` 스크립트 5개. 이것 하나가 M1·M2·M3을 동시에 없앤다.

**W1 — W0 머지 후, 5체인**
- C1 memory-ingestion T1–4(B01) → T5–6(B02) → T10(B04)
- C2 memory-ingestion T7–9(B03, kernel identity)
- C3 channels T1–10(B37·B38 어댑터, 픽스처 전용) — **지금 바로 시작 가능**
- C4 channels T11–13(B39 Hermes)
- C5 ops T1·T2·T3·T5(B16/B34/B41/B43) + agents T6→T7(B14 비용 미터 — W0 settings.ts만 필요)

**W2 — C1·C2 머지 후, 5체인**
- C1 memory-ingestion T11–13(B05) → agents T1→T5→T2→T3→T4(B06·B07)
- C2 agents T10→T11→T12(B15·B17)
- C3 agents T13(B18 `archiveItem`/`undoArchive`)
- C4 channels T14–16(B40) → ops T4(B42)
- C5 agents T8(B13 순수 함수)

**W3 — agents 코어 머지 후, 5체인**
- C1 memory-ingestion T14–17(B08) → T18(B09) → T19–20(B10) → T21–22(B11) → T23(B12)
- C2 agents T17→T15→T16→T18(B20·B19, M14 순서)
- C3 agents T9(B13 `draftLoop`)
- C4 agents T19(B21), T20(B22)
- C5 agents T14(B18 루프) → T21(B23) → T22(B24) → T23

**W4 — surfaces, 5체인**
- C1 surfaces T1(B26) → T2(B27)
- C2 surfaces T3(B28) → T9(B35) → T10(B36)
- C3 surfaces T4(B29), T5(B30)
- C4 surfaces T6(B31), T7(B32)
- C5 surfaces T8(B33 화면·허브 라우트만) + 신규 `GET /transcript` 태스크 + ops T6(B44)

**memory-ingestion T1.. 와 channels는 W0 없이도 즉시 시작할 수 있다** — 둘 다 W0 산출물(`settings`/`push_subscriptions`/잡 seed)을 코드로 import하지 않는다. 단 memory-ingestion T22의 허브 배선 3줄만 `getSetting` 대신 `[]` 리터럴로 두고 W0 머지 때 되돌린다(그 플랜 열린 항목 1이 이미 같은 말을 한다).

---

## 4. Logan 결정 대기

1. 골든 세트 5종이 합성인 채로 Phase B 종료 기준(초안 채택률·오보관 precision)을 판정할지, 이 지표만 유예할지(백로그 §6-5).
2. `apps/hub`·`apps/local-agent` 부트스트랩 배선(어댑터 인스턴스화)이 어느 계획 소관인지 — 현재 5개 플랜 전부 밖이다(channels 미결 1).
3. Hermes SSE 이벤트 필드명 스파이크를 Phase B 진입 스파이크 목록에 새로 넣을지(channels 미결 3).
