# Phase 0/A 계획 교차 검증 (2026-09-20)

6개 계획 + 계약(`2026-09-20-phase-a-interfaces.md`) + A7 §1/§7 대조. **판정: kernel-and-db 플랜 착수를 막는 것은 없다(ready).** 단 아래 M1~M5는 첫 커밋 전에 계약을 고쳐야 한다 — 루트 스캐폴드를 만드는 태스크가 곧 kernel-and-db Task 1이기 때문이다.

## 1. 불일치 표

| # | 계획/태스크 | 기대(계약·A7) | 실제 | 수정 오너 |
|---|---|---|---|---|
| M1 | 루트 `package.json` — kernel T1 / protocol T1 | vitest 1종 | `vitest` **2.1.9**(kernel) / `^2.1.8`(protocol) / **5.0.1**(agents) / `^2.1.0`(bridge·desktop) | kernel T1이 `2.1.9` 확정, 나머지 3개 플랜 수정 |
| M2 | protocol T1 vs sync T4 | zod 1종(protocol이 오너) | `zod ^3.24.1`(protocol) vs **`4.6.5`**(agents). agents가 protocol의 zod3 `Scope`/`Sensitivity`를 zod4 `z.object` 안에 넣음 → 파싱 실패 | protocol T1 = 정본, sync T4 수정 |
| M3 | kernel T1 / sync T4 | `pg` 8.x 1종 | `8.13.1` vs **`8.23.0`**; `typescript` `5.6.3` vs `^5.7.2`; `packageManager` `pnpm@9.12.3` vs `9.15.0` | kernel T1 |
| M4 | kernel T1 ∩ protocol T1 | 루트 파일 오너 1명 | 양쪽이 `package.json`·`pnpm-workspace.yaml`·`tsconfig.base.json`·`biome.jsonc`를 각자 생성(`test -f` 가드). 내용 상이: `verbatimModuleSyntax`/`isolatedModules`/`noImplicitOverride` 유무, biome `lineWidth` 110 vs 100, `db:migrate`가 `tsx …/cli/migrate.ts` vs `--filter @omnis/db migrate` → **먼저 도는 쪽이 승자**(비결정적) | 계약 §2에 "루트 파일 오너 = kernel-and-db T1" 명시 |
| M5 | 루트 스크립트 | 계약 §2: `pnpm dev`(hub+desktop), `tauri:dev`, `tauri:build` | 두 루트 `package.json` 어디에도 없음. US-A25 검증 명령이 `pnpm tauri:build`인데 실행 불가 | kernel T1 |
| M6 | **허브 `WS /bridge` 무주인** | 계약 §5가 허브 표면으로 고정 | kernel T24가 "US-A17이 `onUpgrade`를 꽂는다"로 위임 → agent-bridge 플랜은 `apps/hub`를 **0회** 언급. local-agent는 dial하는 클라이언트만 만듦. Phase A에 브리지 end-to-end 경로 없음 | 새 태스크 필요(kernel T24 또는 bridge 플랜에 "hub-bridge-ws" 추가) |
| M7 | adapters T4 vs desktop T9 | Keychain 1종 | 어댑터는 `omnis.slack.xoxb.<team>`(account=`<team>`) + `…xoxb.<team>.app` 2개를 읽음. 온보딩은 `omnis.slack.xoxp.<team>`(account=`281932556+jinhologankim@users.noreply.github.com`) 1개만 씀 → connect 실패 | desktop T9 |
| M8 | adapters T7·T10 | 계약 §9 `omnis.<channel>.<kind>.<external_id>` | `omnis.gmail.<email>` — `<kind>` 세그먼트 누락. gcal이 gmail 항목을 재사용(`keychainService: "omnis.gmail.…"`, `channel:"gcal"`)하는 것도 계약에 없음 | 계약 §9 |
| M9 | desktop T3 | 계약 §1 `@omnis/desktop` 의존 = `@omnis/ui`+`@omnis/protocol` | `import { zeroSchema } from "@omnis/kernel/zero"`(계약 §7이 허용). §1↔§7 자기모순, desktop `package.json`에 `@omnis/kernel` workspace dep도 없음 | 계약 §1 |
| M10 | desktop T3 vs sync T1 | `@rocicorp/zero` 핀 고정(A6 §5 caret 금지) | sync `1.9.0` exact / desktop `pnpm add @rocicorp/zero`(무핀) | desktop T3 |
| M11 | desktop T8 | 계약 §9 환경변수 목록 | `OMNIS_HUB_HTTP_URL` 신규 도입, 목록에 없음 | 계약 §9 |
| M12 | 루트 `vitest.workspace.ts`(kernel T1) | 전 패키지 unit 수집 | `include: [".../*.test.ts"]`만 → `packages/ui`·`apps/desktop`의 `*.test.tsx`가 `pnpm test`에서 **조용히 스킵** | kernel T1 |
| M13 | 전 플랜 | A7 §6 `.github/workflows/ci.yml` | 어느 플랜도 만들지 않음 | 미배정(Phase A 말미 태스크 추가 권고) |
| M14 | desktop vs phase-0 T17 | 스파이크 결과 소비 | desktop은 vitest+RTL+jsdom로 이미 확정, phase-0 T17은 tauri-driver+WebdriverIO 스파이크 → 결과 소비처 없음 | phase-0 T17을 e2e 전용으로 범위 축소 |

중복 작업: (a) 루트 스캐폴드 M4, (b) `vitest.workspace.ts`(kernel T1 + protocol T15), (c) `createLogger`(kernel T12 + local-agent T5), (d) `readKeychainSecret`(어댑터 3개 + local-agent T8). (c)(d)는 패키지 경계상 불가피 — 계약에 "의도된 중복"으로 1줄 남기면 재논의를 막는다.

## 2. 권장 계약 수정 (old → new)

- **§1 표** — `@omnis/agents` 의존 `@omnis/protocol`,`@omnis/memory`,`ai` → **`@omnis/protocol`,`ai`,`pg`**(`ClassifyCtx.pool: Pool`이 이미 pg를 요구, memory는 Phase A 미사용). `@omnis/desktop` 의존 `@omnis/ui`,`@omnis/protocol` → **+`@omnis/kernel`(`/zero` 서브패스만)**.
- **§2** — "루트 `package.json`/`pnpm-workspace.yaml`/`tsconfig.base.json`/`biome.jsonc`/`vitest.workspace.ts`의 오너는 kernel-and-db Task 1" 1줄 추가. 버전 고정 추가: `vitest 2.1.9` · `zod ^3.24.1` · `pg 8.13.1` · `typescript 5.6.3` · `pnpm@9.12.3` · `@rocicorp/zero 1.9.0`. unit include에 `*.test.tsx` 포함. 명령 표에 `pnpm dev`/`tauri:dev`/`tauri:build`가 루트 스크립트임을 명시.
- **§3.5** — 브리지 exports에 **`PermissionProfile`, `SessionOrigin`, `SessionState`, `RuntimeState`, `SUPPORTED_PROTOCOL_VERSIONS`, `RpcMeta`, `withMeta`, `assertProtocolVersion`, `toJsonRpcError`, `JSONRPC_ERRORS`** 추가(§8이 `permission_profile`을 이미 쓰면서 심볼 정의가 없음).
- **§5** — `Approvals`에 **`beginExecution`/`completeExecution`/`failExecution`/`expire`** 추가. 누락 심볼 추가: **`PendingApproval`**(§5·hub 라우트·desktop이 쓰는데 정의 없음), **`Logger`/`createLogger`**, **`killSwitchStatus`**, **`runEgress`/`EgressToken`/`EgressSpec`/`createOutbox`/`createIngestSink`**, **`assertZeroPublication`/`ZeroPublicationError`**. `WS /bridge` 행에 "서버 구현 오너 = kernel T24" 명기.
- **§6** — **`ItemRow`**(계약이 이름만 쓰고 정의 없음 → 오너 `@omnis/agents/src/types.ts`), **`configureAgents(deps:{pool:Pool})`/`getAgentsPool()`/`AgentsNotConfiguredError`** 추가(§6 `recordRun`이 pool 인자를 안 받으므로 주입 경로가 필수).
- **§7** — `@rocicorp/zero` 버전 `1.9.0` 명기, `ZERO_TABLES`/`ZERO_ITEM_COLUMNS` export 추가.
- **§9** — 환경변수에 **`OMNIS_HUB_HTTP_URL`** 추가. Keychain 규칙에 "Google 계열(`gmail`/`gcal`)은 `omnis.gmail.<email>` 1항목을 공유하고 `<kind>` 세그먼트를 생략한다", "Slack은 `omnis.slack.xoxb.<team_id>`(bot)와 `…​.app`(app token) 2항목, account=`<team_id>`" 명기.
- **§10** — kernel-and-db Task 16~25가 `@omnis/protocol`(US-A11)에 의존함을 표에 반영(A7 §7 의존 열에는 없다).

## 3. 교차 실행 순서

**Wave 0 — 즉시, 서로 병렬 (선행 0개)**
1. `phase-0` T1(스파이크 스캐폴드) → 끝나면 **게이트 ⑥⑦⑧⑪⑫⑬⑭**(T2~T8) + T16·T17 전부 병렬. 무인 실행, Logan 개입 불필요.
2. `kernel-and-db` T1~T15 (루트 스캐폴드 → `@omnis/db` → DDL 0001~0008 → events/scheduler). **어떤 게이트에도 의존하지 않는다.** 단 T10(`ddl-0008-publication`) 착수 시점엔 게이트 ⑬ 결과가 나와 있어야 컬럼 목록을 확정한다.
3. `protocol-and-adapters` T1~T3 (US-A11). 루트 파일 생성 스텝은 **건너뛴다**(M4).
4. `desktop` T1 (US-A24, 선행 없음).

**Wave 1 — (2)·(3) 이후**
- `kernel-and-db` T16~T25 (US-A07~A10) ← US-A11 merge 필요.
- `agent-bridge` T1~T4 (US-A16) ← US-A11만 필요. (1)(2)와 병렬.
- `sync-and-agents` T4~T9 (US-A22b/A23/A23b) ← kernel T6(`0004`)+T4(`0002`). kernel T16~25와 병렬.
- `protocol-and-adapters` T4~T15 (US-A12~A15) ← US-A11. 단 **게이트 ⑨(Slack)·⑩(Gmail)·①(Calendar)** 결과가 있어야 실연결 스텝이 의미를 갖는다 — Logan-assisted.

**Wave 2** — `agent-bridge` T5~T20 ← US-A16 · `sync-and-agents` T1~T3(US-A21) ← kernel T25 · `desktop` T2(US-A25) ← T1.

**Wave 3** — `desktop` T3(US-A22) ← sync T3 + desktop T2 → T4·T5·T7·T8 병렬, T6(US-A28) ← bridge US-A20, T9(US-A31) ← 어댑터 + 게이트 ⑨⑩.

Logan-assisted 게이트 ①②③④⑤⑨⑩은 커널/DB/protocol/브리지 타입 작업과 **무관**하다 — 어댑터 실연결과 온보딩 단계에서만 필요하다.
