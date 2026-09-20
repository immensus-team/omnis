# A7 — 개발 프로세스

버전 1.0 (2026-09-20). 마스터 v1.0(`99-review-v2.md` pass 2 반영판) 정합 수정판. 근거: `00-omnis-design.md` §5(D2,D3,D9,D13,D14,D16), §16, §17 / `A3-data-schema.md` §2·§2.1·§7~8(캘린더·마이그레이션·author 규약) / `A4-agent-layer.md` §7.1·§7.5·§10.1(L9 Ingestion) / `A2-agent-session-bridge.md` §3.2(ingest RPC) / `99-review.md` / `99-review-v2.md` / `research/24-gap-ralph-loop-dev-pipeline.md` / `research/16-hot-repo-readme.md` / `research/12-cost-optimization.md` / `research/22-gap-read-the-prior-art-source.md` / `~/.claude/plugins/cache/omc/oh-my-claudecode/4.14.5/skills/ralph/SKILL.md`.

이 부록은 마스터 설계 문서의 D2(커널 자작), D3(AI SDK는 모델 호출 계층만), D9(모델 4티어+민감도 규칙), D13(개발 모델 배정), D14(레포/모노레포), D16(TS+Node22+pnpm)을 그대로 전제하고, 그것을 실행 가능한 절차로 확장한다. D13이 이미 정한 "Opus=커널·브리지·메모리스키마·보안, Sonnet=어댑터·UI·테스트, Haiku=문서·기계적, DeepSeek=격리된 스토리(Sonnet+ 리뷰), Fable=인터랙티브 기획만"은 재논의하지 않고 §4에서 스토리 유형별 표로 구체화한다.

**주의(범위 경계)**: 이 부록의 `claude-ds` 호출은 **개발 파이프라인(ralph 루프) 전용**이다. §14/D9의 T1(DeepSeek V4 Flash, 프로덕션 인박스 처리)은 AI SDK + API 키/게이트웨이 경유의 별도 런타임 경로이며 이 부록이 다루는 대상이 아니다. 둘을 혼동하지 않는다.

## 이 부록이 확정하는 결정

| # | 결정 | 근거 | 폴백 |
|---|---|---|---|
| A7-D1 | 모노레포 레이아웃을 아래 트리로 고정. 의존 방향 규칙: 낮은 층(`db`→`protocol`→`kernel`/`memory`→`adapters`/`agents`/`ui`→`apps`)이 높은 층을 import 할 수 없고, 같은 층 패키지끼리도 서로 import 하지 않는다 | D16(모노레포), D2(커널 자작) | 없음 |
| A7-D2 | 린트/포맷은 **Biome 하나**(ESLint+Prettier 대체). `tsconfig` strict 계열 + TS project references로 빌드 순서를 관리한다. Turborepo/Nx는 **도입하지 않는다** — 패키지 20개 미만에서는 `pnpm -r`로 충분하고, 빌드가 체감상 느려지면 그때 추가한다 | YAGNI(20개 미만 모노레포에 태스크 러너 캐싱은 과함) | Turborepo 도입(빌드 시간이 병목이 될 때) |
| A7-D3 | DB 마이그레이션은 ORM 없이 raw SQL + 자작 러너, 경로는 `packages/db/migrations/NNNN_<slug>.sql`(4자리, forward-only), 추적 테이블은 `_omnis_migrations(name, sha, applied_at)`(파일 내용의 sha256으로 재적용/변조를 감지). `packages/db`만 DDL을 갖고, 파일 분할 소유권은 A3(A3-D9)에 있다 | A3-D9(마이그레이션 파일 분할·러너 코드의 단일 소스), D2 "커널은 Postgres 위 자작"의 연장, `22` (agentic-inbox의 Drizzle은 채택 안 함 — 스키마 소유권을 한 곳에 두려는 D2 취지와 ORM 추상화가 상충) | Drizzle(스키마가 30개 테이블을 넘어 손으로 SQL 관리가 버거워지면) |
| A7-D4 | UI 테스트: `apps/web`(PWA)은 Playwright. `apps/desktop`(Tauri)은 **UNVERIFIED — 스파이크**: `tauri-driver` + WebdriverIO를 기본값으로 가정(Tauri 공식 WebDriver 경로이나 이 리서치 배치에서 직접 검증되지 않음). Phase A 착수 전 반나절 스파이크로 확정 | 근거 없음(A7 자체 스파이크) | Tauri 스모크를 생략하고 로직은 vitest 유닛으로만, 수동 QA로 보완 |
| A7-D5 | 개발 루프 = OMC `ralph` skill + `worktrunk` 스토리당 워크트리 격리. 스토리당 3회 실패 캡 후 티어 자동 상승(DeepSeek→Sonnet→Opus, **fable로는 자동 상승 안 함**), `--max-iterations` 벽시계 캡, 깨진 트리는 마지막 검증+리뷰 통과 커밋으로 `git reset --hard`. **Opus에서 3회 연속 실패하면 자동 상승 없이 루프를 중단하고 Logan에게 에스컬레이션한다**(다음 티어가 없고, fable 자동 상승은 A7-D6이 금지) | `24`(ralph skill+worktrunk 조합 권고), SKILL.md Step 7~9, 마스터 §17("Opus에서 3회 실패하면 중단하고 Logan에게 에스컬레이션") | Opus 3회 실패 시 중단+Logan 에스컬레이션(자동 폴백 없음, 이것이 유일한 절차) |
| A7-D6 | 모델 배정표(§4)와 DeepSeek 위임 절차 고정. `fable`은 개발 루프(헤드리스)에서 완전 배제 — 인터랙티브 기획/마일스톤 리뷰에만 | D13, `24`(fable 헤드리스 무동의 과금 검증), Logan 브리프("절대 fable로 모든 일들을 다 처리하려고 하지마") | 없음 |
| A7-D7 | CI(GitHub Actions): lint+typecheck+unit은 항상, Postgres 서비스 컨테이너를 쓰는 integration job은 `packages/kernel`·`packages/db`·`packages/memory`·`apps/hub` 경로 변경 시에만 경로 필터로 트리거 | 없음(CI 비용 절감을 위한 자체 결정) | 모든 PR에서 항상 integration 실행(CI 시간이 문제 안 되면) |
| A7-D8 | 커밋: 스토리당 원자 커밋(구현+테스트+리뷰 반영을 squash한 1개), `Co-Authored-By`는 실제 실행 모델명 표기. v1은 Logan 1인 프로젝트이므로 PR 없이 orchestrator(Opus, main worktree)가 로컬에서 순차 merge | §17("스토리당 원자 커밋", "Co-Authored-By 유지"), D14 | PR 리뷰 프로세스 도입(v2 멀티유저 시점) |
| A7-D9 | 릴리스: Phase A~C는 Tauri **unsigned dev build**만(로컬 설치, Gatekeeper quarantine 속성 제거 안내). Apple 서명/notarization은 Phase D | §16 Phase D 종료 기준 | 없음 |
| A7-D10 | Phase A 스토리 백로그 35개(§7)를 순서·의존성 포함해 확정. 이 백로그가 `writing-plans` skill의 입력이 된다 | §16 Phase A 범위, 이 부록 §7 | 없음 |

---

## 1. 모노레포 구조

`pnpm` workspaces, Node 22, TypeScript strict(`"strict": true` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`를 루트 `tsconfig.base.json`에 고정, 각 패키지는 이를 extend).

```
omnis/
├── apps/
│   ├── hub/              # L0 커널+스케줄러를 호스팅하는 Node 프로세스 (맥미니, Phase D는 앱 내장)
│   ├── desktop/           # Tauri 2 macOS 앱 (L4)
│   ├── web/                # iPhone installed PWA (L4, Phase B)
│   └── local-agent/        # agent bridge 데몬 (L1, session bus 클라이언트). host 파라미터로 맥미니(Codex, Phase B부터 Hermes)와 맥북(Claude Code, Codex) 양쪽에 각각 배포한다
├── packages/
│   ├── kernel/             # L0: events, scheduler, pending_approvals, audit_log, kill switch
│   ├── protocol/           # wire 타입: NormalizedItem, Adapter interface, 브리지 프로토콜, capabilities
│   ├── adapters/
│   │   ├── slack/ gmail/ outlook/ google-calendar/ telegram/ whatsapp/ kakaotalk/ linkedin/
│   │   └── agent-bridge/   # 런타임별 브리지(Claude Code/Codex/claude-ds/Hermes) 어댑터
│   ├── agents/             # L3 루프: 분류, 초안, 투두, 위임, 다이제스트, Network, 노트 라우팅
│   ├── memory/             # L2: self-model 파일, mem0 wrapper, bi-temporal 엔티티 쿼리
│   ├── ui/                  # React 컴포넌트, 디자인 토큰, shadcn/ui 래퍼(비즈니스 로직 없음)
│   └── db/                  # DDL 마이그레이션 + 마이그레이션 러너 + 타입드 쿼리 헬퍼
└── tools/
    └── spikes/              # Phase 0 스파이크. 폴더당 result.md, 워크스페이스 빌드 그래프 밖
```

**책임과 의존 방향(A7-D1)**:
- `packages/protocol`은 리프(leaf) 패키지다 — zod 스키마와 타입만 있고 다른 내부 패키지를 import하지 않는다. `NormalizedItem`, `Adapter` 인터페이스(§8 master), `HumanInterrupt`/`HumanResponse`(`22` 차용, A3에서 상세), 브리지 프로토콜 메시지가 여기 산다.
- `packages/db`는 DDL과 마이그레이션 러너만 갖는다. 스키마 소유권이 한 곳에만 있어야 D2의 "자작 커널"이 실제로 자작으로 남는다.
- `packages/kernel`은 `packages/db`와 `packages/protocol`에만 의존한다. events/scheduler/approvals/audit_log/kill switch — 순수 백엔드 로직, UI도 채널 특정 코드도 없다. `apps/hub`만 이 패키지를 import한다.
- `packages/adapters/*`는 각각 `packages/protocol`에만 의존하고 서로를 참조하지 않는다(`slack`이 `gmail`을 모르게). 어댑터는 `kernel`을 직접 import하지 않는다 — 허브가 주입하는 sink 콜백으로만 이벤트를 밀어넣는다. 이게 §8의 "어댑터는 능력을 선언하고 UI는 선언된 능력만 약속한다"를 코드 레벨로 강제하는 지점이다.
- `packages/agents`는 `packages/protocol`, `packages/memory`, `ai`(Vercel AI SDK, D3)에 의존한다. `packages/adapters`를 직접 import하지 않는다 — 자율 루프의 tool palette는 커널이 등록한 인터페이스를 통해서만 채널에 닿는다(`22`의 tool-집합-분리 교훈을 패키지 경계로 재현). `send`/`delete`/`delegate`/`calendar_write`(마스터 §6 `pending_approvals.action` enum, A3 `approvals_action_ck`)는 `packages/agents`의 어떤 tool 목록에도 존재하지 않는다 — 이 타입 자체가 `packages/kernel`의 승인 핸들러에만 있다. 브리지 RPC 메서드명(A2 `delegate.run`)은 이것과 다른 층이다 — 전자는 승인 액션 enum, 후자는 위임 턴을 개시하는 JSON-RPC 메서드 이름이며 둘을 혼동하지 않는다.
- `packages/memory`는 `packages/db`(pgvector 테이블), `packages/protocol`에 의존한다.
- `packages/ui`는 순수 프레젠테이션 — 네트워크 호출도 비즈니스 로직도 없다.
- `apps/*`는 `packages/*`를 참조하지만 `packages/*`는 어떤 `apps/*`도 참조하지 않는다. `apps/desktop`, `apps/web`은 `packages/kernel`을 직접 import하지 않고 Zero 동기화(D7)와 승인 API로만 허브와 통신한다.
- `tools/spikes`는 워크스페이스 빌드 그래프에서 제외한다(어느 패키지도 이 폴더를 import하지 않는다) — 스파이크는 버릴 코드다.

## 2. 툴체인

- **tsconfig**: 루트 `tsconfig.base.json`(strict 전체 on) + 패키지별 `tsconfig.json`(`extends` + `references`). `tsc --build`가 참조 그래프 순서대로 빌드해 §1의 의존 방향을 컴파일 타임에도 어긴 import가 있으면 즉시 실패하게 한다.
- **린트/포맷(A7-D2)**: Biome 하나. 루트 `biome.jsonc`, `pnpm biome check --write`. ESLint+Prettier 조합은 쓰지 않는다 — 설정 두 개를 동기화하는 비용이 이 규모에선 낭비다.
- **테스트**: `vitest`(유닛/계약/통합 전부, 패키지별 `vitest.config.ts` + 루트 `vitest.workspace.ts`), `apps/web`은 Playwright(§5). `apps/desktop`은 A7-D4(스파이크 대기).
- **Tauri CLI**: `apps/desktop`에만. `pnpm tauri dev` / `pnpm tauri build`.
- **마이그레이션 러너**: `packages/db/migrations/NNNN_<slug>.sql`(4자리 번호순 raw SQL, forward-only, 파일 하나 = 트랜잭션 하나. `CREATE INDEX CONCURRENTLY`가 필요하면 `.noxact.sql`로 트랜잭션 밖 실행) + `packages/db/src/migrate.ts`(advisory lock으로 동시 실행 방지 → 미적용 파일을 sha256 비교로 골라 순서대로 실행 → `_omnis_migrations(name, sha, applied_at)`에 기록. 이미 적용된 파일의 내용이 바뀌면 에러). 러너 구현은 A3-D9(§8)가 단일 소스이고, A7은 그대로 채용한다. ORM 없음(A7-D3).
- **작업 러너**: Turborepo/Nx 없이 `pnpm -r`(A7-D2). 패키지 간 실행 순서는 `tsc --build`의 project references가 이미 강제하므로 별도 태스크 그래프 도구가 지금은 불필요하다.
- **루트 스크립트**: `dev`(`pnpm --filter @omnis/hub dev` + `pnpm --filter @omnis/desktop tauri:dev` 동시 실행), `build`(`tsc --build`), `test`(`vitest run`), `test:contract`(`vitest run --project contract`), `test:integration`(`vitest run --project integration`, 로컬은 네이티브 Postgres 필요), `lint`(`biome check`), `format`(`biome check --write`), `typecheck`(`tsc --build --force`), `db:migrate`, `db:migrate:create <name>`, `db:seed`, `tauri:dev`, `tauri:build`.

## 3. ralph 루프 운영

개발 루프는 새로 설계하지 않는다. 이미 이 머신에 설치된 OMC `ralph` skill(`~/.claude/plugins/cache/omc/oh-my-claudecode/4.14.5/skills/ralph/SKILL.md`)을 그대로 쓴다. 이 skill은 이미 PRD 기반 스토리 루프(Step 1~6), 티어드 리뷰어 게이트(Step 7: <5파일 표준=STANDARD/Sonnet, >20파일·보안=THOROUGH/Opus), 필수 deslop 패스(Step 7.5, `ai-slop-cleaner` skill), 회귀 재검증(Step 7.6)을 구현하고 있다(`24`). omnis에 필요한 추가는 두 가지뿐이다: (a) DeepSeek 위임 분기, (b) `worktrunk` 워크트리 격리.

**스토리 카드 형식**은 ralph의 `prd.json` 스토리 객체를 아래 필드로 확장한다(§7의 백로그가 이 형식으로 작성됨):

```json
{
  "id": "US-A12",
  "phase": "A",
  "goal": "Slack 어댑터: Socket Mode 연결 + backfill + realtime subscribe",
  "inputFiles": ["packages/protocol/src/adapter.ts", "packages/adapters/slack/README.md"],
  "outputs": ["packages/adapters/slack/src/index.ts", "packages/adapters/slack/test/contract.test.ts"],
  "verifyCommand": "pnpm --filter @omnis/adapter-slack test",
  "definitionOfDone": "capabilities()/connect()/backfill()/subscribe()/send()/health() 6개 메서드가 fixture 재생 계약 테스트를 통과",
  "tier": "sonnet",
  "prohibited": ["send()를 승인 게이트 없이 kernel에 직접 연결하지 않는다", "packages/adapters/gmail을 import하지 않는다"],
  "worktree": "omnis/.worktrees/US-A12",
  "branch": "ralph/US-A12",
  "attempts": 0,
  "passes": false
}
```

**`tier` 필드 규칙**: `deepseek`/`haiku`/`sonnet`/`opus` 중 하나(§4 배정표). **`tier: "deepseek"`인 스토리는 리뷰어를 반드시 `sonnet` 이상으로 강제한다** — DeepSeek 디프를 DeepSeek나 Haiku가 자기 리뷰하지 않는다(A7-D6). ralph Step 7의 리뷰어 게이트는 `tier`가 `deepseek`일 때 STANDARD(Sonnet) 리뷰어를 자동 배정하고, 파일 수·보안 영향에 따라 THOROUGH(Opus)로 올라가는 기존 규칙은 그대로 적용된다.

**worktrunk 워크트리 격리 절차**: 스토리 착수 직전 `worktrunk create ralph/<story-id>`로 `omnis/.worktrees/<story-id>`를 만들고 그 안에서만 구현·테스트를 진행한다(정확한 CLI 플래그는 **UNVERIFIED — 스파이크**, `worktrunk create <branch>` / `worktrunk remove <story-id>`를 기본 가정으로 두고 Phase A 착수 전 실제 레포에 대고 한 번 드라이런해 확정한다 — `24`가 "worktrunk vs claude-squad는 실사용 트라이얼이 필요"라고 명시적으로 남긴 미확정 지점). orchestrator(Opus, main worktree)는 리뷰+검증 게이트(Step 7~7.6)를 통과한 브랜치만 순차 merge하고 워크트리를 삭제한 뒤 의존 스토리의 블록을 푼다. `claude-squad`는 채택하지 않는다 — 그건 사람이 tmux를 오가며 지켜보는 도구고, ralph 루프는 무인이다(`24`).

**3회 캡과 티어 상승**: 스토리가 자신의 `tier`에서 acceptance criteria 또는 리뷰어 검증을 3회 연속 통과하지 못하면 한 단계 자동 상승한다: DeepSeek → Sonnet → Opus. **fable로는 절대 자동 상승하지 않는다**(§4, A7-D6). 상승은 `attempts` 카운터가 3에 도달하는 순간 발생하고, `progress.txt`에 상승 사유를 기록한다. **`tier: "opus"`에서 3회 연속 실패하면 다음 티어가 없다 — 자동 상승 없이 루프를 중단하고 Logan에게 에스컬레이션한다**(A7-D5, 마스터 §17). 워크트리는 삭제하지 않고 남겨 Logan이 상태를 그대로 볼 수 있게 하며, orchestrator는 해당 스토리를 블록된 것으로 표시하고 의존하지 않는 다른 스토리는 계속 진행한다.

**`--max-iterations`**: ralph 실행마다 벽시계 상한을 건다(Phase A 기본값 40, Phase B 이후는 스토리 수에 비례해 조정). 공식 `ralph-loop` 플러그인의 `--max-iterations`/completion-promise 메커니즘을 하드 바운드로 함께 건다(`24`).

**마지막 검증 커밋으로 reset**: 한 이터레이션이 트리를 깨뜨리고(빌드/린트/테스트 실패) 캡 안에서 못 고치면, 해당 스토리의 워크트리 안에서 그 스토리가 마지막으로 `verifyCommand`와 리뷰어 검증을 모두 통과했던 커밋으로 `git reset --hard`한다. 검증 통과 이력이 없으면 스토리 시작점(워크트리 생성 직후)으로 되돌린다. 다른 스토리의 이미 merge된 커밋은 건드리지 않는다.

**구현자·리뷰어 분리**: ralph Step 7이 이미 강제한다 — 리뷰어는 구현자와 다른(fresh) 컨텍스트에서 실행되고, `prd.json`의 구체적 acceptance criteria에 대고 검증한다. **DeepSeek 디프는 DeepSeek가 자기 리뷰하지 않고, Haiku도 리뷰하지 않는다 — 항상 Sonnet 이상**(A7-D6, 기존 `claude-ds` 관행과 일치).

## 4. 모델 배정 규칙표

D13을 스토리 유형별로 구체화한다.

| 스토리 유형 | 티어 | 예시(§7 참조) |
|---|---|---|
| 커널, 브리지 프로토콜, 메모리 스키마, 보안 경계, THOROUGH 리뷰(>20파일/보안) | **Opus** | US-A05~A09, US-A16, US-A18, US-A19, US-A21 |
| 어댑터, UI, 테스트, 통합, STANDARD 리뷰 | **Sonnet** | US-A04, US-A12~A14, US-A19b, US-A20, US-A22b, US-A23, US-A23b, US-A24~A30 |
| 문서, fixture, 기계적 리팩터, 단순 renames | **Haiku** | US-A00, fixture 생성, README, 타입 export 정리 |
| 격리되고 잘 정의된 스토리(어댑터 보일러플레이트, DDL 파일, fixture, 단순 UI 컴포넌트) — 항상 Sonnet+ 리뷰 필수 | **DeepSeek V4.1 Flash**(`claude-ds`) | US-A01~A03, US-A11의 타입 스캐폴드 부분, US-A15 |
| 인터랙티브 기획, PRD 정제, 마일스톤 리뷰 — **헤드리스 배제** | **Fable** | Phase 착수 전 백로그 재정렬(Logan 대면) |

**DeepSeek 위임 절차**:
```bash
claude-ds -p "<self-contained task: files, acceptance criteria, verify command>" \
  --permission-mode bypassPermissions --strict-mcp-config --output-format json
```
- 반드시 별도 브랜치/워크트리(`ralph/<story-id>`)에서 실행한다.
- 결과 diff는 병합 전 Sonnet 이상이 리뷰한다(자기 승인 금지, DeepSeek 자기 리뷰 금지).
- `--output-format json`이 돌려주는 `total_cost_usd`는 **Claude 가격 기준으로 계산된 값이라 무시한다**. 실비용은 DeepSeek V4.1 Flash 공식 요금표(cache-hit $0.003~0.006, cache-miss $0.15~0.30, output $0.60~1.20 per MTok, peak/off-peak 구간별, `12`/`24` 검증됨)로 별도 집계한다.
- 키는 Keychain `deepseek-api`에 있으며 절대 출력하지 않는다.

**Fable 헤드리스 배제(A7-D6)의 근거**: `fable`은 Claude Code의 실제 모델 티어(Opus 위)이며, `-p`(헤드리스)/Agent SDK 경로에서는 usage-credit 소비 동의 프롬프트가 뜨지 않고 그냥 과금된다(`24`, `code.claude.com/docs/en/model-config` 검증). 인터랙티브 터미널 세션에서만 동의 프롬프트가 뜬다. 따라서 ralph 루프의 모델 풀에는 `fable`을 아예 넣지 않는다 — Logan이 지켜보는 interactive 세션(백로그 재정렬, 마일스톤 리뷰)에만 예약한다. Opus/Sonnet/Haiku는 이미 보유한 구독으로 unmodified `claude` 바이너리를 서브프로세스로 호출하는 것이므로 ToS 상 "ordinary individual use" 경계 안에 있다(D9, `12`) — OAuth 토큰을 Agent SDK로 우회 사용하지 않는다.

## 5. 테스트 전략

- **어댑터 계약 테스트**: `packages/adapters/<channel>/test/contract.test.ts`. 실제 API 응답을 저장한 fixture(JSON)를 재생해 `Adapter` 인터페이스의 6개 메서드(`capabilities`/`connect`/`backfill`/`subscribe`/`send`/`health`, §8)를 검증한다. 실 네트워크 호출 없음.
- **커널 통합 테스트**: `packages/kernel/test/integration/*.test.ts`. 로컬 네이티브 Postgres(§15 "컨테이너는 쓰지 않는다" 원칙을 로컬 개발에도 적용 — Colima 폴백만 허용) 대고 events/LISTEN-NOTIFY/scheduler/pending_approvals/audit_log를 실제로 돌린다. **CI에서는 GitHub Actions의 Postgres 17 서비스 컨테이너를 쓴다** — 이건 일회성 테스트 인프라이지 운영 인프라가 아니므로 §15의 네이티브 프로세스 원칙과 모순되지 않는다.
- **브리지 mock 런타임**: `apps/local-agent/test/`. Claude Code/Codex CLI를 실제로 띄우지 않고, `stream-json`/`app-server` JSON-RPC 출력을 흉내내는 mock subprocess로 브리지 프로토콜(session_key/session_id, capabilities 협상)을 검증한다.
- **프롬프트 인젝션 세트**: `packages/agents/test/injection.test.ts`. agentic-inbox의 `isPromptInjection` 패턴(`22`)과 OWASP LLM01 케이스를 참고해 고정 세트를 만들고, tool palette 격리(§1의 `packages/agents`가 `send`/`delete` 등을 아예 가지지 않는다는 것)가 실제로 막는지를 assertion으로 확인한다.
- **UI 스모크**: `apps/web`은 Playwright. `apps/desktop`(Tauri)은 A7-D4(스파이크 대기, 기본값 tauri-driver+WebdriverIO).
- **스파이크**: `tools/spikes/<question-slug>/`에 스크립트와 `result.md`(pass/fail + 근거)를 남긴다. §16 Phase 0의 8개 스파이크 및 A7-D4/A7-D5의 자체 스파이크(worktrunk CLI, Tauri UI 테스트 도구)가 모두 이 형식을 따른다.

## 6. CI, 브랜치·커밋, 릴리스

**CI(GitHub Actions)**: `.github/workflows/ci.yml`가 lint(Biome)+typecheck(`tsc --build`)+unit(`vitest run`, 컨테이너 없이)을 모든 PR/push에서 항상 실행한다. integration job(Postgres 17 서비스 컨테이너, A6-D4/99-review §1.2가 고정한 버전과 일치)은 `packages/kernel`·`packages/db`·`packages/memory`·`apps/hub` 경로 변경 시에만 경로 필터로 트리거한다(A7-D7, CI 시간 절감). `apps/desktop` 변경 시에만 macOS 러너에서 Tauri dev build job을 추가로 돈다.

**브랜치·커밋 규약**: 스토리 브랜치는 `ralph/<story-id>`. 스토리당 원자 커밋 1개(구현+테스트+리뷰 반영을 squash), 메시지 형식 `<story-id>: <한 줄 요약>` + 본문에 충족한 acceptance criteria 목록. `Co-Authored-By`는 실제로 그 스토리를 구현한 모델을 표기한다(Opus/Sonnet/Haiku는 `Co-Authored-By: Claude <tier> <noreply@anthropic.com>`, DeepSeek는 `Co-Authored-By: DeepSeek V4.1 Flash <noreply@deepseek.com>`). v1은 Logan 1인 프로젝트이므로 PR 리뷰 프로세스 없이 orchestrator(Opus, main worktree)가 로컬에서 검증+리뷰 통과 브랜치를 `main`에 순차 merge한다 — ralph의 리뷰어 게이트(Step 7)가 PR 리뷰의 역할을 대신한다.

**릴리스**: Phase A~C는 `pnpm tauri build`의 unsigned dev build만 배포한다(README에 `xattr -d com.apple.quarantine` 안내 포함, 로컬 설치 전제). Apple Developer 서명과 notarization은 Phase D(§16 종료 기준: "미니 없이 5채널+에이전트 동작, 레포 public")에서 붙인다.

## 7. Phase A 스토리 백로그 (초안, 35개)

순서 = 의존성 순서(위에서 아래로). 모든 스토리에 공통 적용되는 금지 사항은 표 아래 별도 기재하고, 표의 "추가 금지"열에는 스토리별 예외만 적는다. 이 백로그가 `writing-plans` skill의 입력이 된다(A7-D10).

| ID | 목표 | 산출물 | 검증 명령 | 티어 | 의존 |
|---|---|---|---|---|---|
| US-A00 | Phase 0 스파이크 스캐폴드: 마스터 §16의 게이트 14개(①~⑭) 각각에 `tools/spikes/<question-slug>/` 폴더 + 스크립트 자리 + `result.md` 템플릿(pass/fail, 근거, 날짜) 생성. 워크스페이스 빌드 그래프 밖(§1) | `tools/spikes/*/result.md`(14개, 미기입 템플릿) | `find tools/spikes -maxdepth 1 -mindepth 1 -type d` 결과 14줄 | Haiku | — |
| US-A01 | `packages/db` 스캐폴드 + 마이그레이션 러너(스키마 없이 러너만, advisory lock + sha 비교) | `packages/db/src/migrate.ts`, `_omnis_migrations` 부트스트랩 | `pnpm --filter @omnis/db test` | DeepSeek | — |
| US-A02 | DDL(A3-D9 `0001`~`0002`): `0001_extensions.sql`(pgvector 등) + `0002_core_inbox.sql`(`accounts`/`account_secrets`/`persons`/`identities`/`person_merges`/`agent_runtimes`/`threads`/`items`/`calendar_events`, `items.author_person_id`/`author_agent_id`/`author_is_me` 3컬럼, `items.sensitivity`/`items.embedding vector(768)` 포함 — A3 §2·§2.1·§8·§10이 정한 9개 테이블 그대로, 99-review v2 §4-3) | `packages/db/migrations/0001_extensions.sql`, `packages/db/migrations/0002_core_inbox.sql` | `pnpm db:migrate && pnpm --filter @omnis/db test` | DeepSeek | A01 |
| US-A03 | DDL(A3-D9 `0003`~`0004`): `0003_labels.sql`(`labels`/`item_labels`/`thread_labels`/`label_rules`) + `0004_tasks_approvals.sql`(`agent_sessions`/`tasks`/`pending_approvals`/`notes`/`digests`/`agent_runs` — `agent_runs`는 마스터 §6·A4-D16이 "평가·비용·감사의 단일 소스"로 못박은 테이블) | `packages/db/migrations/0003_labels.sql`, `packages/db/migrations/0004_tasks_approvals.sql` | 동일 | DeepSeek | A02 |
| US-A04 | DDL(A3-D9 `0005`~`0008`): `0005_memory.sql`(`entities`/`relations`/`memories`+HNSW) + `0006_kernel.sql`(`events`(append-only)/`audit_log`/`jobs`+append-only 트리거) + `0007_notify.sql`(LISTEN/NOTIFY 채널, id-only 페이로드) + `0008_publication.sql`(`zero_omnis` publication). `calendar_events`는 US-A02(`0002_core_inbox.sql`)가 A3 §2.1의 DDL 그대로 만든다 — 여기서 다시 만들지 않는다("A3 어디에도 정의돼 있지 않다"는 옛 배제 사유는 stale, 99-review v2 §4-3). **인수 기준**: US-A02가 만든 `calendar_events`에 대해 `attendees_count BETWEEN 1 AND 8` 조회(A4 §7.1 미팅-종료 트리거의 전제)와 `end_at` 기준 48시간 윈도 조회(A3 §12 (5b), A4 §7.5 지표의 전제)가 둘 다 성공해야 한다 | `packages/db/migrations/0005_memory.sql`, `0006_kernel.sql`, `0007_notify.sql`, `0008_publication.sql` | 동일 | Sonnet | A03 |
| US-A05 | `packages/kernel` 이벤트 버스(ephemeral/durable/cold 3티어 라우팅, NOTIFY 8000B id-only) | `packages/kernel/src/events.ts` | `pnpm --filter @omnis/kernel test:integration` | Opus | A04 |
| US-A06 | 스케줄러(`jobs` 테이블 + cron 실행기, 최초 job=헬스체크) | `packages/kernel/src/scheduler.ts` | 동일 | Opus | A05 |
| US-A07 | 승인 게이트 API(`propose`/`decide` 상태 전이, action ∈ `send`/`delete`/`delegate`/`calendar_write`, HumanInterrupt/HumanResponse 이식 — `22`) | `packages/kernel/src/approvals.ts` | 동일 | Opus | A03, A05 |
| US-A08 | kill switch(전역 플래그, 모든 자율 루프/egress 체크포인트) | `packages/kernel/src/kill-switch.ts` | 동일 | Opus | A05 |
| US-A09 | 감사 로그 미들웨어(모든 egress가 경유하도록 강제) | `packages/kernel/src/audit.ts` | 동일 | Opus | A04, A07 |
| US-A10 | `apps/hub` 부트스트랩(kernel 초기화, Postgres 연결, graceful shutdown) | `apps/hub/src/main.ts` | `pnpm --filter @omnis/hub build` | Sonnet | A05~A09 |
| US-A11 | `packages/protocol`: `NormalizedItem`/`Adapter`/`Capabilities` zod 스키마 | `packages/protocol/src/adapter.ts` | `pnpm --filter @omnis/protocol test` | Sonnet(+DeepSeek 보일러플레이트) | — |
| US-A12 | Slack 어댑터(Socket Mode, backfill, subscribe) | `packages/adapters/slack/src/index.ts` | `pnpm --filter @omnis/adapter-slack test` | Sonnet | A11 |
| US-A13 | Gmail 어댑터(`users.watch`+Pub/Sub, OAuth, backfill) | `packages/adapters/gmail/src/index.ts` | `pnpm --filter @omnis/adapter-gmail test` | Sonnet | A11 |
| US-A14 | Google Calendar 어댑터(`events.list`+syncToken 폴링) | `packages/adapters/google-calendar/src/index.ts` | `pnpm --filter @omnis/adapter-google-calendar test` | Sonnet | A11 |
| US-A15 | 어댑터 계약 테스트 3종(fixture 재생, A12~A14 각각) | `*/test/contract.test.ts` | `pnpm test:contract` | DeepSeek(리뷰 Sonnet+) | A12~A14 |
| US-A16 | 브리지 프로토콜 타입(session_key/session_id/capabilities, MCP 2026-07-28 버전 협상) | `packages/protocol/src/bridge.ts` | `pnpm --filter @omnis/protocol test` | Opus | A11 |
| US-A17 | `apps/local-agent` 데몬 스캐폴드(Tailscale 연결, 세션 등록) | `apps/local-agent/src/main.ts` | `pnpm --filter @omnis/local-agent test` | Sonnet | A16 |
| US-A18 | Claude Code 브리지(`claude -p --output-format stream-json --resume` 래핑) | `apps/local-agent/src/bridges/claude-code.ts` | 동일 | Opus | A17 |
| US-A19 | Codex 브리지(`app-server` JSON-RPC, 버전 핀) | `apps/local-agent/src/bridges/codex.ts` | 동일 | Opus | A17 |
| US-A19b | 맥미니 호스트에서 `local-agent` 기동(Codex 브리지만 노출, Hermes는 Phase B) + host별 동시성 캡 4 적용(맥미니/맥북 각각) | `apps/local-agent/src/host-config.ts`(host=`mini`/`macbook` 분기), LaunchAgent plist(A6-D10 방식) | `pnpm --filter @omnis/local-agent test -- --host=mini` | Sonnet | A17, A19 |
| US-A20 | 브리지 mock 런타임 테스트(실 CLI 없이 stream-json/JSON-RPC 목업) | `apps/local-agent/test/bridge-mock.test.ts` | `pnpm --filter @omnis/local-agent test` | Sonnet | A18, A19 |
| US-A21 | Zero 스키마 정의 + `apps/hub` 연동(durable 티어 Item row 복제) | `packages/kernel/src/zero-schema.ts` | `pnpm --filter @omnis/kernel test:integration` | Opus | A05, A10 |
| US-A22 | Zero 클라이언트 초기화(`apps/desktop`에서 읽기 전용 쿼리 1개 왕복 확인) | `apps/desktop/src/zero-client.ts` | `pnpm --filter @omnis/desktop test` | Sonnet | A21, A25 |
| US-A22b | `agent_runs` 기록 헬퍼(모든 L3 루프 호출이 공유): 입력 해시, tier, provider, 토큰, 지연, outcome을 `agent_runs` row 하나로 남긴다(A4-D16, 마스터 §6) — 이후 추가되는 모든 L3 루프 스토리는 이 헬퍼를 거치는 것을 acceptance criteria로 삼는다 | `packages/agents/src/record-run.ts` | `pnpm --filter @omnis/agents test` | Sonnet | A03, A11 |
| US-A23 | 분류·라벨 루프(T0 로컬 규칙 스텁 → T1 DeepSeek 폴백 인터페이스, work/personal, 모든 실행이 US-A22b `recordRun`을 호출) | `packages/agents/src/classify.ts` | `pnpm --filter @omnis/agents test` | Sonnet | A11, A05, A22b |
| US-A23b | `items.sensitivity` 분류 훅 — Phase A 최소 구현: 기본값 `'normal'`, VIP person(`persons` 우선순위/라벨 기반 플래그)이면 `'personal'`로 승격만 한다. 마스터 §14/Q11의 T2 예약·저하 시 VIP 지속 규칙은 비용 정책 구현 스토리(Phase B `agent_runs.cost_usd` 집계 이후)에서 소비한다 — 이 스토리는 컬럼에 값을 채우는 것까지만 | `packages/agents/src/sensitivity.ts` | `pnpm --filter @omnis/agents test` | Sonnet | A02, A23 |
| US-A24 | 디자인 토큰 + shadcn/ui 셋업(Liquid Glass 프리미티브) | `packages/ui/src/tokens.ts`, `packages/ui/src/components/*` | `pnpm --filter @omnis/ui test` | Sonnet | — |
| US-A25 | Tauri 2 스캐폴드(`window-vibrancy` 연동, 빈 셸) | `apps/desktop/src-tauri/*` | `pnpm tauri:build` | Sonnet | A24 |
| US-A26 | Inbox 화면(필터 pill, react-virtuoso 리스트) | `apps/desktop/src/screens/Inbox.tsx` | `pnpm --filter @omnis/desktop test` | Sonnet | A22, A24 |
| US-A27 | Thread 화면(items 렌더링, status 뱃지) | `apps/desktop/src/screens/Thread.tsx` | 동일 | Sonnet | A22, A24 |
| US-A28 | Agent Session 화면(Thread 뷰 + tool_call 배지, `TOOL_LABELS` 패턴 차용 — `22`) | `apps/desktop/src/screens/AgentSession.tsx` | 동일 | Sonnet | A20, A27 |
| US-A29 | ⌘K 커맨드 팔레트(cmdk, 에이전트 액션 포함) | `apps/desktop/src/components/CommandPalette.tsx` | 동일 | Sonnet | A24 |
| US-A30 | 승인 카드 UI(pending_approvals 렌더링, 4-way accept/edit/respond/ignore — `22`) | `apps/desktop/src/components/ApprovalCard.tsx` | 동일 | Sonnet | A07, A22 |
| US-A31 | 온보딩 플로우(Slack/Gmail/Calendar OAuth 연결 마법사, Keychain 저장) | `apps/desktop/src/screens/Onboarding.tsx` | `pnpm --filter @omnis/desktop test` | Sonnet | A12~A14, A24 |

**Phase B 시드 메모(이 백로그 스코프 밖)**: 맥북 `local-agent`가 노출하는 ingest RPC(`ingest.scan(roots, since)` → `ingest.read(path)`, A2 §3.2)는 A4 §10.1 L9 Ingestion(A4-D19)이 소비하는데, L9 Ingestion 자체가 마스터 §16 Phase B 스코프("메모리 3층 + ingestion(로컬·Drive·GitHub)")다. 이 RPC 구현 스토리는 그래서 위 Phase A 35개에 넣지 않는다 — US-A17(local-agent 데몬 스캐폴드)까지만 Phase A가 만들고, `ingest.*` 메서드는 Phase B 백로그 작성 시 그 위에 얹는다. US-A19b(맥미니 `local-agent`)는 이미 Codex 브리지만 노출한다(Hermes read-only 세션은 Phase B, A7-D6·마스터 §5 D1) — 변경 없음, 교차 확인만.

**모든 스토리 공통 금지 사항**:
- `send`/`delete`/`delegate`/`calendar_write` 등 비가역 tool을 승인 게이트(US-A07) 완성 전에 직접 연결하지 않는다 — 그 전까지는 mock/interface로만 다룬다.
- `packages/protocol` 밖에서 provider SDK를 임의로 import하지 않는다(어댑터 패키지 내부로 격리).
- 마이그레이션 파일을 직접 수정하지 않는다 — 항상 새 번호의 마이그레이션을 추가(append-only).
- 테스트를 삭제하거나 스킵해서 통과시키지 않는다(ralph Final_Checklist와 동일 규칙).

## 리뷰 노트 (2026-09-20)

인라인으로 고칠 수 없는 실질적 이슈만 기록한다. 2026-09-20 v0.95 수정 패스에서 해결된 항목은 아래 "수정 이력"으로 옮겼다.

1. **[minor] Biome 채택(A7-D2)에 리서치 근거가 없음.** 다른 모든 A7-D# 결정은 `research/` 파일 번호를 근거로 인용하는데, "린트/포맷은 Biome 하나" 결정만 리서치 인용이 없다(research 폴더 전체에 Biome/ESLint/Turborepo/Nx 언급 자체가 없음 — grep 확인). 근거 칸의 "YAGNI"는 Turborepo/Nx를 배제하는 논리이지 Biome을 선택하는 논리는 아니다. 결정을 바꾸라는 게 아니라 근거 칸이 비어 있다는 점만 표시한다. **이번 패스에서 미해결**: 이 픽스 리스트에 포함되지 않았고, A7 자체 판단만으로 리서치를 새로 만들 근거가 없어 그대로 남긴다.

ready = true (blocker 없음; 남은 항목은 1건, minor).

## 수정 이력 (v0.95, 2026-09-20)

- 마이그레이션 경로를 `packages/db/migrations/000N_<name>.sql` + 추적 테이블 `_omnis_migrations`로 전환(A7-D3), US-A02~A04를 A3-D9의 8파일 분할(0001~0008)로 재작성하고 `agent_runtimes`(US-A02)·`label_rules`(US-A03)·`agent_runs`(US-A03) DDL을 포함시켰다. `calendar_events`는 A3/A4 미해결 스키마 gap이라 발명하지 않고 US-A04에 UNVERIFIED로 명시적으로 배제했다.
- US-A09의 의존을 `A03, A07` → `A04, A07`로 정정(감사 로그 테이블이 새 파일 분할에서 US-A04로 이동했으므로).
- 승인 핸들러 tool 이름을 `delegate.run`/`calendar.write` → `delegate`/`calendar_write`로 정정(§1, §7 공통 금지 사항). 브리지 RPC 메서드명(A2 `delegate.run`)과의 구분을 명문화했다.
- `@omnis/desktop` 패키지명 일관성 확인 — A7 전체에 `@omnis/app` 표기가 없어 추가 수정 없음(충돌은 A8 쪽이었다, 99-review §1.2).
- Opus 3회 연속 실패 시 자동 상승 없이 중단하고 Logan에게 에스컬레이션하도록 A7-D5·§3을 재작성(마스터 §17과 합치).
- CI integration job의 Postgres 버전을 16→17로 정정(§6, §5).
- Phase A 백로그에 4개 스토리 추가: US-A00(Phase 0 스파이크 14개 스캐폴드+`result.md` 템플릿), US-A19b(맥미니 `local-agent` + Codex 노출, host당 동시성 캡 4), US-A22b(`agent_runs` 기록 공유 헬퍼, 모든 L3 호출이 경유), US-A23b(`items.sensitivity` 분류 훅, Phase A 최소: 기본 `normal`+VIP 승격). 백로그 개수 31→35, A7-D10 갱신.
- 스토리 카드 필드 `assignedTier`→`tier`로 정정하고, `tier: "deepseek"`일 때 Sonnet+ 리뷰가 강제된다는 규칙을 명문화(§3, A7-D6과 합치).
- `local-agent`가 맥미니(Codex, Phase B부터 Hermes)와 맥북(Claude Code, Codex) 양쪽에서 도는 것으로 §1 모노레포 구조 설명을 정정.

### v1.0 (2026-09-20, pass 2)

- 헤더: 버전 0.95 → 1.0, 상위 문서를 마스터 v1.0으로 고정. 근거 목록에 A3 §2.1, A4 §7.1·§7.5·§10.1, A2 §3.2 추가.
- US-A02: `0002_core_inbox.sql` 산출물에 `person_merges`·`calendar_events`를 추가해 A3 §8이 확정한 9개 테이블 전체와 일치시켰다(99-review v2 §4-3).
- US-A04: "`calendar_events`는 A3 어디에도 정의돼 있지 않다 — UNVERIFIED"라는 stale 문장을 삭제하고, `calendar_events`는 US-A02가 A3 §2.1 DDL 그대로 만든다는 문장으로 교체했다. 인수 기준에 `attendees_count BETWEEN 1 AND 8` 조회(A4 §7.1 미팅-종료 트리거)와 48시간 윈도 조회(A3 §12 (5b), A4 §7.5 지표)가 둘 다 성공해야 한다는 조건을 추가했다(99-review v2 §4-3).
- §7 표 아래에 "Phase B 시드 메모" 신설: 맥북 `local-agent`의 ingest RPC(`ingest.scan`/`ingest.read`, A2 §3.2)는 L9 Ingestion(마스터 §16 Phase B 스코프)이 쓰므로 Phase A 백로그에 넣지 않는다는 점을 명시. US-A19b가 이미 맥미니 `local-agent`에 Codex 브리지만 노출(Hermes는 Phase B)하고 있음을 교차 확인했다 — 해당 스토리 자체는 수정 없음.
- §1 `packages/agents` 단락의 A3 인용을 `pending_approvals_action_ck` → **`approvals_action_ck`**로 정정(A3 §4 실제 CONSTRAINT 이름과 불일치했음). 그 외 A7이 인용하는 테이블·컬럼명(`accounts`~`zero_omnis`, `agent_runs.cost_usd`, `items.sensitivity`/`author_*`, `attendees_count` 등)은 A3 v1.0 DDL과 전수 대조해 이 1건 외 불일치 없음을 확인했다.
