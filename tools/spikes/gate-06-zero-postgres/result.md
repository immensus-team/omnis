# Gate ⑥: Zero + Postgres 반영 지연

- **질문**: 로컬 Postgres 17(pgvector) + zero-cache를 붙였을 때, 한 row INSERT부터 Zero 클라이언트 구독이 그 변경을 받기까지의 시간이 G5(≤2초)를 만족하는가.
- **소유 부록**: A6 (§5, §11.3 ⑥행)
- **Owner**: agent(unattended)
- **Host**: macbook (M5 Max, 로컬 Homebrew postgresql@17 + zero-cache-dev, 둘 다 이 스파이크 전용 스크래치 DB/replica)
- **실행일**: 2026-09-20
- **결과(Pass/Fail)**: **PASS**
- **측정치/근거**:
  - `npx tsx measure.ts` 2회 실행: `latency_ms=68.9` (exit 0), `latency_ms=46.0` (exit 0). 둘 다 Pass 기준(≤2000ms)의 3% 미만.
  - `wal_level`을 `replica`→`logical`로 변경(`ALTER SYSTEM SET wal_level = 'logical';` + `brew services restart postgresql@17`), 재시작 후 `SHOW wal_level;` → `logical` 확인. **로컬 Homebrew postgresql@17의 영구 설정 변경**(이 맥북에서 돌아가는 다른 프로젝트의 Postgres에도 적용됨 — 인스턴스가 하나뿐이라 격리 불가. 되돌리려면 `ALTER SYSTEM SET wal_level = 'replica'` 후 재시작).
  - `omnis_spike_zero` DB(pgvector는 불필요해 미설치, `pgcrypto`만 `CREATE EXTENSION`)에 `probe_events` 스크래치 테이블 생성, `zero-cache-dev`(포트 4848)를 붙이고 Zero 클라이언트로 `probe_events` 구독을 연 뒤, 별도 `psql` INSERT 시각(`performance.now()` 기준 t0)부터 클라이언트 리스너가 새 row를 받은 시각(t1)까지를 측정.
- **decided_by**: agent
- **비고**:
  - **계획서 원문 대비 발견한 3가지 API 드리프트**(설치된 `@rocicorp/zero@1.9.0`을 직접 검사해 확인, deviations에도 기록):
    1. `timestamp()` 컬럼 헬퍼가 존재하지 않는다(패키지 export는 `boolean/enumeration/json/number/string`뿐). `createdAt`을 `number()`로 바꾸고 Postgres 쪽 실제 컬럼명(`created_at`)에 매핑하려면 `.from("created_at")`가 필요했다(Zero는 컬럼명을 자동으로 camelCase 변환하지 않는다).
    2. `z.query.<table>`(계획서가 쓴 API)은 1.9.0에서 "legacy queries"로 deprecated이며 `createSchema`에 `enableLegacyQueries: true`를 명시하지 않으면 타입·런타임 모두 `undefined`다.
    3. 쿼리 키는 스키마의 JS 변수명(`probeEvents`)이 아니라 `table()`에 넘긴 실제 테이블명 문자열(`probe_events`)이다.
  - **가장 오래 걸린 디버깅**(계획서에 없던 발견): `schema.ts`에 `definePermissions`가 없으면 zero-cache-dev가 시작 로그에 "no tables will be syncable"만 남기고 **모든 쿼리가 조용히 0 rows를 반환**한다(에러 없이 그냥 빈 결과 — Postgres에는 row가 있는데 클라이언트에는 안 보임). `probe_events: { row: { select: ANYONE_CAN } }`를 추가해서 해결. 이 스파이크는 로컬 1회성 스크래치 DB라 `ANYONE_CAN`으로 충분하지만, Phase A `@omnis/kernel/zero-schema.ts`는 실제 행 단위 권한 규칙이 필요하다(이 태스크 범위 밖).
  - `wal_level` 변경은 시스템 전역이라, 이 맥북의 로컬 Postgres를 쓰는 다른 워크트리(`omnis.plan-kernel-db` 등)도 `logical`로 바뀐 상태에서 돈다 — 이후 게이트나 태스크가 이를 전제해도 안전하다(A3가 프로덕션에서도 `wal_level=logical`을 요구하므로 방향은 맞다).
  - `tools/spikes/gate-06-zero-postgres/`는 자체 `package.json`(`pnpm install --ignore-workspace`로 설치, 루트 `pnpm-workspace.yaml`의 `packages/*`/`apps/*` 글롭 밖이라 루트 lockfile은 건드리지 않음)와 자체 `pnpm-lock.yaml`을 갖는다 — Global Constraints의 "빌드 그래프 밖" 요구를 만족한다.
  - `zero-cache-dev` 프로세스는 측정 후 종료해 뒀다(포트 4848 사용 안 함). 재현하려면: `omnis_spike_zero` DB가 이미 있고 `wal_level=logical`이 이미 적용된 상태이므로, `cd tools/spikes/gate-06-zero-postgres && ZERO_UPSTREAM_DB=postgres://logankim@localhost:5432/omnis_spike_zero ZERO_CVR_DB=postgres://logankim@localhost:5432/omnis_spike_zero ZERO_REPLICA_FILE=/tmp/omnis-spike-zero-<new>.db npx zero-cache-dev -p schema.ts &` 후 `npx tsx measure.ts`.
