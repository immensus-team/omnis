# Phase 0 스파이크 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 마스터 §16이 "통과 전 Phase A 착수 금지"로 못박은 14개 게이트(①~⑭)와 US-A00 스캐폴드, 그리고 A7-D4/A7-D5가 요구하는 자체 스파이크(Tauri UI 테스트 도구, worktrunk CLI 확정) 전부를 `tools/spikes/`에 실행 가능한 스크립트 + `result.md`로 남겨, Phase A 착수 가부를 하나의 결정표로 판정한다.

**Architecture:** `tools/spikes/`는 워크스페이스 빌드 그래프 밖이다(A7 §1) — 어떤 `packages/*`도 이 폴더를 import하지 않고, 이 폴더의 스크립트도 `packages/*`를 import하지 않는다(존재하지 않기 때문이기도 하다: US-A01 이후에야 `@omnis/db` 등이 생긴다). 각 게이트는 독립된 `tools/spikes/<slug>/`에 자기완결 스크립트(필요하면 자체 `package.json`)와 `result.md`를 갖는다. 14개 게이트 중 7개(⑥⑦⑧⑪⑫⑬⑭)는 맥북에서 사람 개입 없이 도는 unattended 스파이크이고, 7개(①②③④⑤⑨⑩)는 OAuth 동의, GUI 권한 승인, QR 페어링처럼 Logan의 손이 필요한 assisted 스파이크다 — 이 문서는 unattended를 먼저 두고 assisted를 뒤에 둔다.

**Tech Stack:** Node 22, TypeScript 5(strict), `pg` 8.x, `@rocicorp/zero` 1.9.0(맥북에 설치 확인됨, `tools/spikes/_probes/2026-09-20-cli-probes.md`), Postgres 17 + pgvector(로컬 네이티브, `brew install postgresql@17`), Ollama 0.34.2(로컬), Codex CLI(`codex-cli` 0.155.1, `rust-v0.155.1` 핀), Claude Code CLI 2.1.274, `worktrunk`(brew) 0.78.0, `sops` 3.13.3 + `age` 1.3.2, `@tauri-apps/cli` 2.11.5, `tauri-driver` + WebdriverIO(A7-D4 기본 가정, 버전은 Task 17에서 설치 시 고정).

**Spec:** `/Users/logankim/AI-Workspaces/omnis/docs/spec/00-omnis-design.md` §16(Phase 0), §8(채널 매트릭스), §4.2(배치 토폴로지) + 부록 `A6-ops-infra.md` §11(스파이크 절차·pass 기준의 정본), `A1-channel-adapters.md` §4(채널 스파이크 A1-①~⑤), `A2-agent-session-bridge.md` §4.1·§4.2·§7.1·§8.3(S-A2-1·2), `A3-data-schema.md` §7·§14(S-A3-2), `A7-dev-process.md` §3·§7(US-A00, A7-D4·A7-D5) + 계약: `docs/superpowers/plans/2026-09-20-phase-a-interfaces.md`.

## Global Constraints

- Node 22 + pnpm workspaces.
- TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`(A7 §1).
- Postgres 17(A3).
- 허브는 `127.0.0.1:8787`에만 bind한다(마스터 §4.2) — Phase 0 스파이크가 로컬 Postgres/Zero를 띄울 때도 이 포트 규약을 어기지 않는다(8642는 Hermes 전용).
- 마이그레이션은 append-only 파일 `packages/db/migrations/000N_<name>.sql` + 추적 테이블 `_omnis_migrations`(A3 §8) — 이 규칙은 Phase A부터 적용되며, Phase 0 스파이크는 `packages/db`가 아직 없으므로 자체 스크래치 DDL만 쓰고 이 경로를 건드리지 않는다.
- 비가역 tool(`send`/`delete`/`delegate`/`calendar_write`)은 승인 게이트(US-A07)가 생기기 전에는 어떤 자율 루프에도 연결하지 않는다(A7 §7 공통 금지) — 스파이크 ①②의 "테스트 이벤트/메시지 1건 발송"은 Logan이 손으로 트리거하는 수동 검증이지 자율 루프의 egress가 아니므로 이 금지와 충돌하지 않는다.
- 테스트를 삭제하거나 스킵해서 통과시키지 않는다.
- provider SDK는 해당 어댑터 패키지 안에서만 쓴다 — Phase 0에는 어댑터 패키지가 없으므로 각 게이트 스크립트는 자기 디렉터리 안에서만 provider 클라이언트를 import한다(다른 `tools/spikes/<slug>`를 import하지 않는다).
- Keychain 아이템 명명은 A1 규칙 `omnis.<channel>.<kind>.<external_id>`(브리지 토큰은 `omnis.bridge.token.<host>`)를 그대로 따른다.
- 스토리 티어는 A7 §4 배정표를 따르고, DeepSeek diff는 반드시 Sonnet 이상이 리뷰한다(이 계획의 태스크는 전부 Haiku/Sonnet이라 DeepSeek 위임 대상이 없다).
- 커밋 메시지 마지막 줄은 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`으로 끝낸다(A7 §6의 실행 모델 표기 규칙 — 이 계획의 태스크는 Fable이 인터랙티브로 실행한다).

---

### Task 1: Phase 0 스파이크 스캐폴드 (US-A00, tier: Haiku)

**목표(A7 §7 원문)**: Phase 0 스파이크 스캐폴드: 마스터 §16의 게이트 14개(①~⑭) 각각에 `tools/spikes/<question-slug>/` 폴더 + 스크립트 자리 + `result.md` 템플릿(pass/fail, 근거, 날짜) 생성. 워크스페이스 빌드 그래프 밖(§1).
**산출물(A7 §7 원문)**: `tools/spikes/*/result.md`(14개, 미기입 템플릿).
**검증 명령(A7 §7 원문, US-A00 fix)**: `find tools/spikes -maxdepth 1 -mindepth 1 -type d ! -name _probes` 결과 14줄.
**티어**: Haiku.

**주의(리포 현재 상태와의 불일치)**: 이 레포에는 이미 `tools/spikes/_probes/2026-09-20-cli-probes.md`가 존재한다(Fable이 게이트 ⑦⑪⑫⑭를 위해 미리 캡처해 둔 CLI 증거 — Task 8·9·10·16에서 그대로 재사용한다). `_probes`는 14개 게이트 중 하나가 아니므로 지우지 않는다. 그 결과 A7 §7의 검증 명령을 문자 그대로 돌리면 15줄이 나온다 — 이 계획에서는 검증 명령을 `find tools/spikes -maxdepth 1 -mindepth 1 -type d ! -name _probes`로 조정해 14를 확인한다(카운트 대상에서 `_probes`만 제외, 나머지는 A7 §7과 동일).

**Files:**
- Create: `tools/spikes/gate-01-calendar-funnel/result.md`, `tools/spikes/gate-02-beeper-whatsapp/result.md`, `tools/spikes/gate-03-filevault-autologin/result.md`, `tools/spikes/gate-04-kmsg-read/result.md`, `tools/spikes/gate-05-tailscale-serve-iphone/result.md`, `tools/spikes/gate-06-zero-postgres/result.md`, `tools/spikes/gate-07-codex-appserver/result.md`, `tools/spikes/gate-08-ollama-nomic-embed/result.md`, `tools/spikes/gate-09-slack-socket-mode/result.md`, `tools/spikes/gate-10-gmail-watch-pubsub/result.md`, `tools/spikes/gate-11-claude-bare-hooks/result.md`, `tools/spikes/gate-12-permission-mode-mapping/result.md`, `tools/spikes/gate-13-zero-column-types/result.md`, `tools/spikes/gate-14-worktrunk-dryrun/result.md`.
- Test: 없음(스캐폴드 자체는 로직이 없다 — 검증은 `find` 명령 하나).

**Interfaces:** Consumes: 없음(리프 태스크, `packages/*`가 아직 없다). Produces: 없음(내보내는 심볼 없음 — 폴더와 마크다운 템플릿뿐).

1. `docs/spec/00-omnis-design.md` §16과 `docs/spec/A6-ops-infra.md` §11.1의 14개 게이트 표를 읽고 번호·이름을 확인한다.
2. 14개 디렉터리를 만들고 각각에 아래 템플릿 그대로 `result.md`를 쓴다(예시는 `gate-01-calendar-funnel`, 나머지 13개는 `<gate-slug>`와 `<gate-name>`만 바꿔 반복한다 — 파일 하나하나 실제로 생성한다):

```markdown
# Gate: <gate-name>

- **질문**: <이 스파이크가 답하는 한 문장 질문>
- **소유 부록**: <A6 | A1 | A2 | A3 | A7>
- **Owner**: <agent | Logan>
- **Host**: <macbook | mini>
- **실행일**: 
- **결과(Pass/Fail)**: 
- **측정치/근거**: 
- **decided_by**: 
- **비고**: 
```

3. `tools/spikes/gate-01-calendar-funnel/result.md`는 실제로 다음 내용으로 채운다(다른 13개는 2번의 빈 템플릿 그대로 두고, 각 게이트를 다루는 Task 2~15가 채운다 — Task 1은 뼈대만):

```markdown
# Gate ①: Calendar events.watch via Funnel

- **질문**: Google Calendar events.watch push 알림이 Tailscale Funnel 경유로 1분 이내 도착하는가
- **소유 부록**: A6(§11.3)
- **Owner**: Logan
- **Host**: mini
- **실행일**: 
- **결과(Pass/Fail)**: 
- **측정치/근거**: 
- **decided_by**: 
- **비고**: 
```

4. `find tools/spikes -maxdepth 1 -mindepth 1 -type d ! -name _probes | wc -l`를 실행해 `14`가 출력되는지 확인한다(PASS 텍스트: `14`). `_probes`를 포함한 원래 A7 §7 명령(`find tools/spikes -maxdepth 1 -mindepth 1 -type d`)은 `15`가 나오는 것이 이 레포의 정상 상태임을 커밋 메시지 본문에 한 줄로 남긴다.
5. `git add tools/spikes && git commit -m "$(cat <<'EOF'
US-A00: Phase 0 스파이크 스캐폴드 14개 생성

- 게이트 ①~⑭ 각각에 tools/spikes/<slug>/result.md 템플릿 생성
- 검증: find tools/spikes -maxdepth 1 -mindepth 1 -type d ! -name _probes | wc -l → 14
- 기존 tools/spikes/_probes(게이트 ⑦⑪⑫⑭ 사전 증거)는 보존, 카운트에서만 제외

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"`

---

## 순서 A — Unattended 게이트 (Fable/agent가 무인으로 돌린다)

### Task 2: Gate ⑥ — Zero + Postgres 반영 지연 (A6 소유, tier: Sonnet)

**질문**: 로컬 Postgres 17(pgvector) + zero-cache를 붙였을 때, 한 row INSERT부터 Zero 클라이언트 구독이 그 변경을 받기까지의 시간이 G5(≤2초)를 만족하는가.
**Owner**: agent(unattended) — OAuth·GUI 권한 불필요, 전부 로컬 프로세스.
**Host**: macbook(M5 Max 64GB — 미니 배치는 Phase A `apps/hub`가 결정할 문제고, Phase 0은 개발 머신에서 먼저 확인한다).
**Pass 기준(A6 §11.3 원문)**: "zero-cache 정상 기동 + 변경 반영 2초 이내(G5)".
**Fail → 결정 규칙(A6 §11.3 원문)**: "PowerSync(마스터 D7 폴백, 단 자체호스팅 시 MongoDB 필요 이슈 인지)".

**Files:**
- Create: `tools/spikes/gate-06-zero-postgres/package.json`, `tools/spikes/gate-06-zero-postgres/schema.ts`, `tools/spikes/gate-06-zero-postgres/setup.sql`, `tools/spikes/gate-06-zero-postgres/measure.ts`.
- Modify: `tools/spikes/gate-06-zero-postgres/result.md`(Task 1이 만든 빈 템플릿을 채운다).

**Interfaces:** Consumes: `@rocicorp/zero`(npm, `Zero` 클라이언트 클래스, `createSchema`/`table`/`column` — Task 1이 아니라 npm 패키지에서 온다. `@omnis/kernel`의 `zeroSchema`(계약 §7)는 아직 없다 — Phase A US-A21이 정식 스키마를 만들기 전까지 이 스파이크는 자체 최소 스키마를 쓴다). Produces: 없음(스파이크는 라이브러리가 아니다).

1. `docs/spec/A6-ops-infra.md` §5(zero-cache 배치·권한)와 §11.3 ⑥행을 읽는다.
2. 전용 스크래치 DB를 만든다: `createdb omnis_spike_zero && psql omnis_spike_zero -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"`.
3. `tools/spikes/gate-06-zero-postgres/setup.sql`을 쓴다(최소 스키마, 실제 omnis DDL은 Phase A US-A02가 만든다 — 여기서 흉내내지 않는다):

```sql
CREATE TABLE IF NOT EXISTS probe_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  val text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER SYSTEM SET wal_level = 'logical';
```

4. `psql omnis_spike_zero -f setup.sql`을 실행하고, `wal_level`이 바뀌면 로컬 Postgres를 재시작한다(`brew services restart postgresql@17`).
5. `tools/spikes/gate-06-zero-postgres/schema.ts`를 쓴다:

```ts
import { createSchema, table, string, timestamp } from "@rocicorp/zero";

export const probeEvents = table("probe_events")
  .columns({ id: string(), val: string(), createdAt: timestamp() })
  .primaryKey("id");

export const schema = createSchema({ tables: [probeEvents] });
export type Schema = typeof schema;
```

6. `tools/spikes/gate-06-zero-postgres/package.json`을 쓴다:

```json
{
  "name": "gate-06-zero-postgres-spike",
  "private": true,
  "type": "module",
  "dependencies": { "@rocicorp/zero": "1.9.0", "pg": "8.13.1" }
}
```

7. `zero-cache`를 이 스파이크 전용 설정으로 기동한다: `ZERO_UPSTREAM_DB=postgres://localhost/omnis_spike_zero ZERO_CVR_DB=postgres://localhost/omnis_spike_zero ZERO_REPLICA_FILE=/tmp/omnis-spike-zero.db npx zero-cache-dev -p schema.ts`.
8. `tools/spikes/gate-06-zero-postgres/measure.ts`를 쓴다(Zero 클라이언트로 구독을 열고, 별도 `psql` INSERT 시각과 클라이언트가 새 row를 받은 시각의 차이를 측정한다):

```ts
import { Zero } from "@rocicorp/zero";
import { schema } from "./schema.js";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const z = new Zero({ server: "http://127.0.0.1:4848", userID: "spike", schema });
const id = randomUUID();
const t0 = performance.now();

const view = z.query.probeEvents.where("id", "=", id).materialize();
const seen = new Promise<number>((resolve) => {
  view.addListener((rows) => { if (rows.length > 0) resolve(performance.now()); });
});

execSync(
  `psql omnis_spike_zero -c "INSERT INTO probe_events (id, val) VALUES ('${id}', 'gate-06')"`,
);

const t1 = await seen;
console.log(`latency_ms=${(t1 - t0).toFixed(1)}`);
process.exit(t1 - t0 <= 2000 ? 0 : 1);
```

9. `cd tools/spikes/gate-06-zero-postgres && pnpm install && npx tsx measure.ts`를 실행한다. PASS 조건: `latency_ms=` 값이 2000 이하이고 프로세스 exit code 0.
10. `result.md`에 실행일·Pass/Fail·`latency_ms` 실측치·decided_by(`agent`)를 채워 넣는다.
11. `git add tools/spikes/gate-06-zero-postgres && git commit -m "$(cat <<'EOF'
gate-06: Zero+Postgres 반영 지연 스파이크

- probe_events 스크래치 테이블 + zero-cache + Zero 클라이언트 구독으로 INSERT→구독 반영 시간 측정
- Pass 기준(A6 §11.3): 반영 ≤2초(G5)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"`

### Task 3: Gate ⑦ — Codex app-server 버전 핀 + 1턴 왕복 (A6 소유, A2 §4.2 절차, tier: Sonnet)

**질문**: `codex app-server`를 `rust-v0.155.1`로 고정 실행하고 JSON-RPC로 1턴을 요청했을 때 프로토콜 에러 없이 `item/started`~`item/completed`까지 완주하는가.
**Owner**: agent(unattended) — Codex CLI는 이미 로그인된 상태(기존 구독)라 새 OAuth 동의가 필요 없다.
**Host**: macbook.
**Pass 기준(A6 §11.3 원문)**: "프로토콜 에러 없이 1턴 완주".
**Fail → 결정 규칙(A6 §11.3 원문)**: "버전 재핀 + capabilities 기반 feature detection으로 우회(마스터 §9)".

**Files:**
- Create: `tools/spikes/gate-07-codex-appserver/run.ts`, `tools/spikes/gate-07-codex-appserver/schema/`(생성된 JSON 스키마 번들 출력 디렉터리).
- Modify: `tools/spikes/gate-07-codex-appserver/result.md`.

**Interfaces:** Consumes: `tools/spikes/_probes/2026-09-20-cli-probes.md`(이미 확보된 `codex app-server generate-json-schema` 명령과 codex-cli 0.155.1 버전 증거). Produces: 없음.

1. `tools/spikes/_probes/2026-09-20-cli-probes.md`를 읽는다 — `codex codex-cli 0.155.1`이 이미 설치돼 있고 `codex app-server generate-json-schema --out <DIR>`이 유효한 명령임을 확인한다.
2. `codex --version`을 실행해 `codex-cli 0.155.1`(핀 `rust-v0.155.1`, A2 §2.1 macOS TOML 예시와 동일)과 일치하는지 확인한다. 불일치하면 `degraded` 시나리오로 5번에서 기록한다.
3. `mkdir -p tools/spikes/gate-07-codex-appserver/schema && codex app-server generate-json-schema --out tools/spikes/gate-07-codex-appserver/schema`를 실행해 프로토콜 스키마 번들을 뽑는다 — 이 번들은 Phase A US-A19(`apps/local-agent/src/bridges/codex.ts`)가 타입을 맞출 때 그대로 쓴다.
4. `tools/spikes/gate-07-codex-appserver/run.ts`를 쓴다(스키마에서 "새 턴을 시작하는" 요청 메서드를 찾아 그 메서드로 1턴을 보내고, A2 §4.2 표의 이벤트 이름(`item/started`, `item/completed`, `turn.completed`)이 실제로 오는지 확인한다):

```ts
import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

const schemaDir = new URL("./schema", import.meta.url).pathname;
const schemaFiles = readdirSync(schemaDir).filter((f) => f.endsWith(".json"));
const bundle = schemaFiles.map((f) => JSON.parse(readFileSync(`${schemaDir}/${f}`, "utf8")));
const turnMethod = bundle
  .flatMap((doc) => Object.keys(doc.$defs ?? doc.definitions ?? {}))
  .find((k) => /sendUserTurn|newTurn|userTurn/i.test(k));
if (!turnMethod) throw new Error("no turn-start method found in generated schema — inspect schema/ by hand");

const child = spawn("codex", ["app-server"], { stdio: ["pipe", "pipe", "inherit"] });
let buf = "";
let sawItemStarted = false;
let sawItemCompleted = false;
let sawTurnCompleted = false;

child.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  let idx: number;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (!line.trim()) continue;
    console.log("<<", line);
    if (line.includes("item/started")) sawItemStarted = true;
    if (line.includes("item/completed")) sawItemCompleted = true;
    if (line.includes("turn.completed") || line.includes("turn/completed")) sawTurnCompleted = true;
  }
});

function send(method: string, params: unknown, id: number) {
  const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
  console.log(">>", msg.trim());
  child.stdin.write(msg);
}

send("initialize", { clientInfo: { name: "omnis-spike-gate-07", version: "0.0.1" } }, 1);
setTimeout(() => send(turnMethod, { prompt: "reply with exactly the word: pong" }, 2), 1000);

setTimeout(() => {
  child.kill();
  const pass = sawItemStarted && sawItemCompleted && sawTurnCompleted;
  console.log(`gate7_pass=${pass}`);
  process.exit(pass ? 0 : 1);
}, 30000);
```

5. `cd tools/spikes/gate-07-codex-appserver && npx tsx run.ts | tee run.log`를 실행한다. PASS 조건: `gate7_pass=true`와 exit code 0. 스키마에서 turn-start 메서드를 자동으로 못 찾으면(위 `throw` 발생) `schema/` 디렉터리를 손으로 읽어 정확한 메서드명을 `run.ts`의 정규식에 추가하고 재실행한다 — 이건 스파이크의 목적 그 자체(정확한 프로토콜 표면 확정)이므로 `result.md` 비고에 실제로 찾은 메서드명을 남긴다.
6. `result.md`를 채운다: 측정치 칸에 실제로 관측된 메서드명과 이벤트 시퀀스를 적는다.
7. `git add tools/spikes/gate-07-codex-appserver && git commit -m "$(cat <<'EOF'
gate-07: Codex app-server 버전 핀 + 1턴 JSON-RPC 왕복 스파이크

- codex-cli 0.155.1(rust-v0.155.1 핀) 확인, generate-json-schema로 프로토콜 스키마 번들 추출
- 1턴 요청→item/started~item/completed~turn.completed 수신 확인
- Pass 기준(A6 §11.3): 프로토콜 에러 없이 1턴 완주

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"`

### Task 4: Gate ⑧ — Ollama nomic-embed 처리량 (A6 소유, tier: Sonnet)

**질문**: `nomic-embed-text-v1.5`로 1,000개 인박스 문장 샘플을 임베딩하는 데 120초 이내, p95 300ms 이내가 나오는가(A6 §11.1 수치화 + §11.3 "하루 ~2,000건 유입을 실시간 지연 없이 소화" 절차).
**Owner**: agent(unattended) — 전부 로컬 추론.
**Host**: macbook.
**Pass 기준(A6 §11.3 원문 + §11.1 수치)**: "하루 추정 ~2,000건 유입을 실시간 지연 없이 소화할 처리량 확인"(§11.3) — 이를 §11.1이 준 구체 수치 "1,000문장 ≤120s, p95 ≤300ms"로 판정한다.
**Fail → 결정 규칙(A6 §11.3 원문)**: "배치를 야간 오프피크로 이동(마스터 §14 KST 19시 이후 오프피크 원칙과 결합) 또는 맥북으로 오프로드".

**Files:**
- Create: `tools/spikes/gate-08-ollama-nomic-embed/sample-sentences.txt`, `tools/spikes/gate-08-ollama-nomic-embed/bench.ts`.
- Modify: `tools/spikes/gate-08-ollama-nomic-embed/result.md`.

**Interfaces:** Consumes: 없음(Ollama HTTP API `127.0.0.1:11434`만). Produces: 없음.

1. `docs/spec/A6-ops-infra.md` §6(Ollama)·§11.1·§11.3 ⑧행을 읽는다.
2. `ollama pull nomic-embed-text` 로 모델을 받는다(모델명 `nomic-embed-text`, 마스터 D6·D10이 확정한 `nomic-embed-text-v1.5`의 Ollama 태그).
3. `tools/spikes/gate-08-ollama-nomic-embed/sample-sentences.txt`에 1,000줄을 생성한다(실제 인박스 텍스트가 아직 없으므로 문장 길이 분포를 흉내낸 합성 문장을 쓴다):

```bash
node -e "for (let i = 0; i < 1000; i++) console.log(\`omnis 스파이크 샘플 문장 \${i}: 회의 일정 재조율 요청과 첨부 파일 확인 부탁드립니다.\`)" > sample-sentences.txt
```

4. `tools/spikes/gate-08-ollama-nomic-embed/bench.ts`를 쓴다:

```ts
import { readFileSync } from "node:fs";

const lines = readFileSync(new URL("./sample-sentences.txt", import.meta.url), "utf8")
  .split("\n").filter(Boolean);

const latencies: number[] = [];
const t0 = performance.now();

for (const line of lines) {
  const s = performance.now();
  const res = await fetch("http://127.0.0.1:11434/api/embeddings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "nomic-embed-text", prompt: line }),
  });
  if (!res.ok) throw new Error(`ollama error: ${res.status} ${await res.text()}`);
  await res.json();
  latencies.push(performance.now() - s);
}

const totalS = (performance.now() - t0) / 1000;
latencies.sort((a, b) => a - b);
const p95 = latencies[Math.floor(latencies.length * 0.95)];
console.log(`total_s=${totalS.toFixed(1)} p95_ms=${p95.toFixed(1)} n=${lines.length}`);
process.exit(totalS <= 120 && p95 <= 300 ? 0 : 1);
```

5. `cd tools/spikes/gate-08-ollama-nomic-embed && npx tsx bench.ts`를 실행한다. PASS 조건: `total_s <= 120`이고 `p95_ms <= 300`.
6. `result.md`에 `total_s`/`p95_ms`/`n` 실측치를 채운다.
7. `git add tools/spikes/gate-08-ollama-nomic-embed && git commit -m "$(cat <<'EOF'
gate-08: Ollama nomic-embed 처리량 스파이크

- 1,000문장 배치 임베딩, 총 소요시간과 p95 레이턴시 측정
- Pass 기준: 1,000문장 ≤120s, p95 ≤300ms(A6 §11.1), "하루 ~2,000건 실시간 소화"(A6 §11.3)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"`

### Task 5: Gate ⑪ — `claude -p --bare` hook 주입 (S-A2-1, A2 §4.1 소유, tier: Sonnet)

**질문**: `-p --bare` 조합에서 `--settings`로 omnis 자체 hook 설정을 명시 주입했을 때, `PreToolUse` hook이 실제로 발동해 승인 게이트(브리지의 유닉스 소켓 호출)로 이어지는가 — 그리고 그때 대상 레포 자신의 `.claude/settings.json` project hook은 안 뜨는가(2026-09-20 `plans-review.md` §2 fix).
**Owner**: agent(unattended) — Claude Code는 기존 구독 로그인 상태.
**Host**: macbook.
**Pass 기준(A6 §11.1/§16 원문, A2 §8.3, plans-review §2로 정밀화)**: mode (a)·(b) 중 **최소 하나**에서 omnis `PreToolUse` hook은 뜨고 project hook은 안 뜬다(`omnis_hook_fired=true` AND `project_hook_fired=false`).
**Fail → 결정 규칙**: A2 §4.1이 이미 명시한 대로 — 두 모드 모두 위 조건을 못 채우면(omnis hook이 아예 안 뜨거나, 뜨는 모드마다 project hook도 같이 떠서 격리가 안 되면) delegated 런에서 `PreToolUse` 기반 승인 승격 경로를 포기하고, 브리지가 각 tool_use 이벤트를 직접 가로채 승인으로 승격하는 폴링 방식으로 낮춘다(A2 §4.1 hooks 문단의 대안 경로). **결정 결과는 마스터 `docs/spec/00-omnis-design.md` §19 Q13**(대기 중인 질문표, "게이트 ⑪이 결정")에 반영한다 — 이 플랜은 마스터 문서 자체를 고치지 않으므로 `result.md`의 `decided_by`에 Q13 반영 여부만 기록하고, 실제 §19 갱신은 Phase A 착수 전 Logan 확인 항목으로 넘긴다.

**전제(`tools/spikes/_probes/2026-09-20-cli-probes.md` "Findings that change gate ⑪" 1·2번, 원문 그대로)**:
> 1. `--bare` skips hooks, CLAUDE.md auto-discovery, plugins, keychain reads. Context can still be supplied explicitly via `--settings`, `--mcp-config`, `--add-dir`, `--system-prompt[-file]`. Whether hooks declared inside a `--settings` file are honored under `--bare` is UNVERIFIED and is the core of gate ⑪.
> 2. **Under `--bare`, Anthropic auth is strictly `ANTHROPIC_API_KEY` or `apiKeyHelper` via `--settings`; OAuth and Keychain are never read.** Consequence: a delegated Claude Code run with `--bare` cannot use the Claude subscription (T3) and bills per token on an API key. This contradicts A2-D11's assumption that delegated runs ride the subscription binary. Gate ⑪ must therefore test BOTH modes:
>    - (a) `--bare` + omnis hooks via `--settings` + `ANTHROPIC_API_KEY` → cost = API (T2-class pricing).
>    - (b) non-bare + `--settings <omnis-hooks.json>` + `--permission-mode manual` + fresh worktree cwd → subscription auth, but the target repo's own `.claude/settings.json` hooks/CLAUDE.md still load. Measure whether omnis hooks in `--settings` take precedence and whether project hooks can be neutralized.
>    - claude-ds (DeepSeek, API key) is unaffected: `--bare` is the natural mode.

**Files:**
- Create: `tools/spikes/gate-11-claude-bare-hooks/hooks-settings.json`, `tools/spikes/gate-11-claude-bare-hooks/hook-receiver.mjs`, `tools/spikes/gate-11-claude-bare-hooks/project-hook.mjs`, `tools/spikes/gate-11-claude-bare-hooks/run.sh`.
- Modify: `tools/spikes/gate-11-claude-bare-hooks/result.md`.

**Interfaces:** Consumes: `tools/spikes/_probes/2026-09-20-cli-probes.md`(위 전제 1·2번, verbatim). Produces: 없음.

1. 위 전제(전제 블록)를 읽는다 — 특히 2번(“`--bare` 아래에서는 OAuth/Keychain이 아니라 `ANTHROPIC_API_KEY`만 읽힌다”)은 A2-D11의 "delegated 런은 구독 바이너리를 그대로 탄다"는 가정과 충돌하므로, 이 태스크의 실행 결과와 별개로 `result.md` 비고에 그대로 옮겨 적는다(A2-D11 재검토는 이 플랜의 범위 밖이고 Phase A 착수 전 Logan에게 에스컬레이션할 항목이다).
2. `tools/spikes/gate-11-claude-bare-hooks/hook-receiver.mjs`를 쓴다(유닉스 소켓 대신 이 스파이크는 stdout으로 "승인 게이트가 떴다"를 증명한다 — 실제 유닉스 소켓 브리지는 Phase A `apps/local-agent`가 만든다. 이것이 **omnis 자체 hook**, `--settings`로 명시 주입되는 쪽이다):

```js
#!/usr/bin/env node
// PreToolUse hook: stdin으로 { tool_name, tool_input, ... } JSON을 받아 exit code 2로 "차단"하면
// Claude Code가 이를 승인 필요로 취급한다(hook 표면 자체 확인이 목적이라 실제 브리지 소켓은 흉내만 낸다).
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  const evt = JSON.parse(raw);
  console.error(`GATE11_HOOK_FIRED tool=${evt.tool_name}`);
  process.exit(2); // 2 = block + surface reason to the model/user (Claude Code hook contract)
});
```

3. `tools/spikes/gate-11-claude-bare-hooks/project-hook.mjs`를 쓴다(대상 레포가 **자기 것으로** 갖고 있는 hook을 흉내낸다 — 전제 2번의 "fresh worktree cwd with a repo that has its own `.claude/settings.json` hook"을 재현하는 fixture 쪽이다. omnis hook과 구분되는 별도 마커를 찍는다):

```js
#!/usr/bin/env node
// project's own PreToolUse hook (fixture) — omnis hook과 별개의 마커로 "project hook이 떴는지"만 증명한다.
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  const evt = JSON.parse(raw);
  console.error(`PROJECT_HOOK_FIRED tool=${evt.tool_name}`);
  process.exit(0); // 0 = allow — 발동 여부만 증명하면 되고 이 hook이 실행을 막을 필요는 없다
});
```

4. `chmod +x tools/spikes/gate-11-claude-bare-hooks/hook-receiver.mjs tools/spikes/gate-11-claude-bare-hooks/project-hook.mjs`.
5. `tools/spikes/gate-11-claude-bare-hooks/hooks-settings.json`을 쓴다(omnis 쪽 `--settings` 주입 파일, 절대경로 없이도 두 모드 모두에서 통하도록 스크립트 경로는 run.sh가 `cd` 후 상대경로로 넘긴다):

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "node tools/spikes/gate-11-claude-bare-hooks/hook-receiver.mjs" }] }
    ]
  }
}
```

6. `tools/spikes/gate-11-claude-bare-hooks/run.sh`를 쓴다(전제 2번의 2가지 모드를 둘 다 시험하고, mode (b)는 project hook이 있는 **fresh worktree cwd**에서 돌려 project hook 발동 여부까지 같이 잰다):

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
REPO_ROOT="$(pwd)"
GATE_DIR="$REPO_ROOT/tools/spikes/gate-11-claude-bare-hooks"

check() {
  local log="$1" label="$2"
  grep -q "GATE11_HOOK_FIRED" "$log" && echo "${label}_omnis_hook_fired=true" || echo "${label}_omnis_hook_fired=false"
  grep -q "PROJECT_HOOK_FIRED" "$log" && echo "${label}_project_hook_fired=true" || echo "${label}_project_hook_fired=false"
}

echo "=== mode (a): --bare + --settings + ANTHROPIC_API_KEY (cwd = repo root, no project fixture) ==="
claude -p --bare \
  --settings "$GATE_DIR/hooks-settings.json" \
  --permission-mode manual \
  "run: ls" 2>&1 | tee "$GATE_DIR/mode-a.log" || true
check "$GATE_DIR/mode-a.log" mode_a

echo "=== fixture: fresh worktree cwd with its own .claude/settings.json project hook ==="
FIXTURE_PARENT="$(mktemp -d)"
FIXTURE_DIR="$FIXTURE_PARENT/gate11-project-fixture"
mkdir -p "$FIXTURE_DIR/.claude"
git init -q "$FIXTURE_DIR"
cp "$GATE_DIR/project-hook.mjs" "$FIXTURE_DIR/.claude/project-hook.mjs"
cat > "$FIXTURE_DIR/.claude/settings.json" <<'JSON'
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "node .claude/project-hook.mjs" }] }
    ]
  }
}
JSON

echo "=== mode (b): non-bare + --settings <omnis-hooks.json> + --permission-mode manual, cwd = fixture worktree ==="
(
  cd "$FIXTURE_DIR"
  claude -p \
    --settings "$GATE_DIR/hooks-settings.json" \
    --permission-mode manual \
    "run: ls" 2>&1 | tee "$GATE_DIR/mode-b.log"
) || true
check "$GATE_DIR/mode-b.log" mode_b

rm -rf "$FIXTURE_PARENT"
```

7. `chmod +x tools/spikes/gate-11-claude-bare-hooks/run.sh && ./tools/spikes/gate-11-claude-bare-hooks/run.sh`를 실행한다. PASS 조건(2번 Pass 기준과 동일): mode (a)·(b) 중 최소 하나가 `omnis_hook_fired=true` AND `project_hook_fired=false`. 어느 모드도 이 조합을 못 내면 FAIL → Fail 결정 규칙(폴링 방식 강등)을 채택한다.
8. `result.md`를 채운다: mode (a)/(b) 각각의 `omnis_hook_fired`/`project_hook_fired`, 어느 모드가 pass 조건을 만족했는지, `decided_by`에 "§19 Q13"을 적고, 1번에서 옮겨 적은 A2-D11 충돌 메모를 비고에 남긴다.
9. `git add tools/spikes/gate-11-claude-bare-hooks && git commit -m "$(cat <<'EOF'
gate-11: claude -p --bare hook 주입 + project hook 격리 스파이크 (S-A2-1)

- --settings로 PreToolUse hook을 명시 주입해 --bare/non-bare 두 모드에서 승인 게이트가 뜨는지 확인
- mode (b)는 자체 .claude/settings.json hook을 가진 fresh worktree fixture cwd에서 실행해 project hook 발동 여부까지 측정
- Pass 기준: 최소 한 모드에서 omnis hook은 뜨고 project hook은 안 뜸 — 결과는 master §19 Q13에 반영 대상으로 기록
- _probes 발견(--bare는 OAuth/Keychain을 안 읽음, API 키만) → A2-D11 가정과 충돌, Logan 에스컬레이션 필요로 기록

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"`

### Task 6: Gate ⑫ — `--permission-mode` ↔ profile 매핑 (S-A2-2, A2 §7.1 소유, tier: Sonnet)

**질문**: `--permission-mode`의 실제 허용값 전수를 A2 §7.1의 3개 permission profile(`observe`/`workspace`/`trusted`)에 확정 매핑할 수 있는가.
**Owner**: agent(unattended).
**Host**: macbook.
**Pass 기준(A6 §11.1 원문)**: "3 profile 확정".
**Fail → 결정 규칙**: 값이 3개 profile로 깔끔히 안 나뉘면(예: 어떤 모드도 완전한 read-only를 보장 못 하면) `observe` profile을 CLI 플래그가 아니라 네트워크 차단(§7.2, S-A2-6 폴백)으로 별도 강제하도록 A2 §7.1을 갱신 대상으로 표시한다(이 플랜은 A2 본문을 고치지 않는다 — 스파이크 결과만 남긴다).

**Files:**
- Modify: `tools/spikes/gate-12-permission-mode-mapping/result.md`.
- Create: `tools/spikes/gate-12-permission-mode-mapping/mapping.md`.

**Interfaces:** Consumes: `tools/spikes/_probes/2026-09-20-cli-probes.md`(`--permission-mode` choices: `acceptEdits`, `auto`, `bypassPermissions`, `manual`, `dontAsk`, `plan` — 이미 확보됨). Produces: 없음.

1. `docs/spec/A2-agent-session-bridge.md` §7.1(permission profile 표)와 `tools/spikes/_probes/2026-09-20-cli-probes.md`의 "Findings ... gate ⑫" 3번 항목을 읽는다.
2. `claude --help 2>&1 | grep -A2 "permission-mode"`를 실행해 `_probes` 파일의 6개 값(`acceptEdits`/`auto`/`bypassPermissions`/`manual`/`dontAsk`/`plan`)이 현재 설치본에서도 동일한지 재확인한다(버전 드리프트 체크).
3. `tools/spikes/gate-12-permission-mode-mapping/mapping.md`를 쓴다(A2 §7.1 표를 실제 CLI 값으로 채운 확정판):

```markdown
# permission-mode ↔ profile 확정 매핑 (gate-12, S-A2-2)

| profile (A2 §7.1) | `--permission-mode` | 근거 |
|---|---|---|
| `observe` | `plan` | 파일 쓰기·도구 실행이 없는 읽기 전용 계획 모드. `inbox:*` 루프 전용(A2 §7.1) |
| `workspace` | `manual` | cwd 하위 파일 쓰기 + 그 외 도구는 승인 프롬프트(hook 경유, gate-11) |
| `trusted` | `bypassPermissions` | `origin:'human'`에서만, allowed_roots 내(A2 §7.1 "bypassPermissions는 trusted+origin:human에서만") |

미사용: `acceptEdits`(workspace보다 느슨하게 파일 편집을 자동 승인 — 어떤 profile에도 배정하지 않음, 승인 게이트 우회 소지), `auto`(런타임 기본 판단에 맡기는 모드라 세 profile 중 무엇에도 결정론적으로 대응 안 됨), `dontAsk`(trusted와 겹치나 bypassPermissions보다 의미가 불명확해 배제).
```

4. `result.md`를 채운다: 결과=Pass(3개 profile이 모두 확정 매핑됨), 측정치 칸에 `mapping.md` 경로를 남긴다.
5. `git add tools/spikes/gate-12-permission-mode-mapping && git commit -m "$(cat <<'EOF'
gate-12: --permission-mode ↔ permission profile 확정 매핑 (S-A2-2)

- observe→plan, workspace→manual, trusted→bypassPermissions로 확정
- acceptEdits/auto/dontAsk는 사용하지 않음(근거는 mapping.md)
- Pass 기준: 3 profile 확정

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"`

### Task 7: Gate ⑬ — Zero의 vector/tsvector/uuid[]/generated 컬럼 복제 (S-A3-2, A3 §7·§14 소유, tier: Sonnet)

**질문**: Zero가 `vector`, `tsvector`(generated), `uuid[]` 컬럼이 섞인 테이블을 publication에 넣었을 때 정상 복제하고 클라이언트에서 쿼리할 수 있는가 — 안 되면 `items.search_tsv`를 어떻게 빼야 하는가.
**Owner**: agent(unattended).
**Host**: macbook(Task 2와 같은 로컬 Zero+Postgres 스택 재사용 가능하나, 독립 실행을 위해 별도 스크래치 DB를 쓴다).
**Pass 기준(A6 §11.1 원문)**: "복제+쿼리 성공".
**Fail → 결정 규칙(A3 §14 S-A3-2 원문)**: "`search_tsv`를 별도 테이블로 빼고 `participants`를 join 테이블로 정규화".

**Files:**
- Create: `tools/spikes/gate-13-zero-column-types/setup.sql`, `tools/spikes/gate-13-zero-column-types/schema.ts`, `tools/spikes/gate-13-zero-column-types/measure.ts`.
- Modify: `tools/spikes/gate-13-zero-column-types/result.md`.

**Interfaces:** Consumes: `@rocicorp/zero`(npm). Produces: 없음.

1. `docs/spec/A3-data-schema.md` §7(Zero 동기화 범위)과 §14 S-A3-2·S-A3-6을 읽는다 — 실제 문제 컬럼은 `items.embedding vector(768)`(제외 대상이라 여기서 시험할 필요 없음), `items.search_tsv`(generated tsvector, 제외 대상이지만 "제외가 실제로 되는가"를 시험해야 함), `threads.participants uuid[]`(포함 대상, 실제로 복제되는지 시험해야 함).
2. `tools/spikes/gate-13-zero-column-types/setup.sql`을 쓴다(A3 §2·§3의 실제 테이블을 복제하지 않고, 문제 컬럼 3종만 가진 최소 재현 테이블 두 개를 만든다):

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE probe_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participants uuid[] NOT NULL DEFAULT '{}'
);

CREATE TABLE probe_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES probe_threads(id),
  body text NOT NULL,
  embedding vector(768),
  search_tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', body)) STORED
);

ALTER SYSTEM SET wal_level = 'logical';

-- items 쪽만 컬럼 리스트로 publication에 넣는다(A3 §7 DDL과 같은 패턴):
CREATE PUBLICATION zero_spike_13 FOR TABLE
  probe_threads,
  probe_items (id, thread_id, body);
```

3. `createdb omnis_spike_zero13 && psql omnis_spike_zero13 -f setup.sql && brew services restart postgresql@17`를 실행한다.
4. `tools/spikes/gate-13-zero-column-types/schema.ts`를 쓴다(uuid[] 컬럼과 컬럼 리스트로 좁힌 `probe_items`만 선언 — `embedding`/`search_tsv`는 스키마에 아예 넣지 않는다. Zero 클라이언트 스키마 자체가 publication과 일치해야 하므로 이것이 "제외가 실제로 되는가"의 1차 확인이다):

```ts
import { createSchema, table, string, json } from "@rocicorp/zero";

export const probeThreads = table("probe_threads")
  .columns({ id: string(), participants: json<string[]>() })
  .primaryKey("id");

export const probeItems = table("probe_items")
  .columns({ id: string(), threadId: string(), body: string() })
  .primaryKey("id");

export const schema = createSchema({ tables: [probeThreads, probeItems] });
```

5. `ZERO_UPSTREAM_DB=postgres://localhost/omnis_spike_zero13 ZERO_CVR_DB=postgres://localhost/omnis_spike_zero13 ZERO_REPLICA_FILE=/tmp/omnis-spike-zero13.db npx zero-cache-dev -p schema.ts`로 zero-cache를 띄운다. 이 명령이 스키마를 거부하면(예: `uuid[]` → `json<string[]>()` 매핑을 zero-cache가 인식 못 하면) 콘솔 에러 메시지를 그대로 `result.md`에 옮긴다 — 이게 이 스파이크의 1차 산출물이다.
6. `tools/spikes/gate-13-zero-column-types/measure.ts`를 쓴다:

```ts
import { Zero } from "@rocicorp/zero";
import { schema } from "./schema.js";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const z = new Zero({ server: "http://127.0.0.1:4848", userID: "spike13", schema });
const threadId = randomUUID();
const p1 = randomUUID();
const p2 = randomUUID();

execSync(
  `psql omnis_spike_zero13 -c "INSERT INTO probe_threads (id, participants) VALUES ('${threadId}', ARRAY['${p1}','${p2}']::uuid[])"`,
);
execSync(
  `psql omnis_spike_zero13 -c "INSERT INTO probe_items (id, thread_id, body) VALUES (gen_random_uuid(), '${threadId}', 'hello from gate 13')"`,
);

const thread = await z.query.probeThreads.where("id", "=", threadId).one().materialize().data;
const items = await z.query.probeItems.where("threadId", "=", threadId).materialize().data;

console.log("thread:", JSON.stringify(thread));
console.log("items:", JSON.stringify(items));
const pass = Array.isArray(thread?.participants) && thread.participants.length === 2 && items.length === 1;
console.log(`gate13_pass=${pass}`);
process.exit(pass ? 0 : 1);
```

7. `cd tools/spikes/gate-13-zero-column-types && pnpm add @rocicorp/zero pg && npx tsx measure.ts`를 실행한다. PASS 조건: `gate13_pass=true`(uuid[]가 배열로 복제되고, `embedding`/`search_tsv`를 스키마에 넣지 않아도 `probe_items` 쿼리가 정상 동작).
8. `result.md`를 채운다: `uuid[]` 복제 성공 여부, publication 컬럼 리스트 문법(`items (id, thread_id, ...)`)이 zero-cache에서 실제로 받아들여졌는지를 각각 적는다.
9. `git add tools/spikes/gate-13-zero-column-types && git commit -m "$(cat <<'EOF'
gate-13: Zero의 vector/tsvector/uuid[]/generated 컬럼 처리 스파이크 (S-A3-2)

- uuid[] 컬럼(threads.participants 재현) 복제·쿼리 확인
- generated tsvector·vector 컬럼을 publication 컬럼 리스트로 제외하는 문법(S-A3-6) 검증
- Pass 기준: 복제+쿼리 성공

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"`

### Task 8: Gate ⑭ — worktrunk 드라이런 (A7-1, A7 §3 소유, tier: Sonnet)

**질문**: `worktrunk`로 워크트리 create/remove 왕복이 실제로 되는가(정확한 서브커맨드·플래그는 A7-D5가 UNVERIFIED로 남긴 것).
**Owner**: agent(unattended).
**Host**: macbook(`worktrunk` 0.78.0이 이미 설치돼 있음, `_probes` 파일).
**Pass 기준(A6 §11.1 원문)**: "create/remove 왕복".
**Fail → 결정 규칙**: A7-D5가 이미 정한 폴백 — worktrunk 대신 순수 `git worktree add`/`git worktree remove`로 낮추고 ralph 루프의 워크트리 격리 절차(A7 §3)를 그 명령으로 재작성 대상 표시(이 플랜은 A7 본문을 고치지 않는다).

**Files:**
- Create: `tools/spikes/gate-14-worktrunk-dryrun/run.sh`.
- Modify: `tools/spikes/gate-14-worktrunk-dryrun/result.md`.

**Interfaces:** Consumes: `tools/spikes/_probes/2026-09-20-cli-probes.md`(worktrunk 0.78.0 설치 확인). Produces: 없음.

1. `docs/spec/A7-dev-process.md` §3의 "worktrunk 워크트리 격리 절차" 문단을 읽는다 — 기본 가정 `worktrunk create <branch>` / `worktrunk remove <story-id>`.
2. `tools/spikes/gate-14-worktrunk-dryrun/run.sh`를 쓴다(omnis 레포 자체가 아니라 스크래치 레포에 대고 드라이런한다 — 실제 작업 브랜치를 건드리지 않는다):

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRATCH=$(mktemp -d)
git init -q "$SCRATCH"
cd "$SCRATCH"
git commit -q --allow-empty -m "init"

echo "=== worktrunk --help ==="
worktrunk --help

echo "=== create ==="
worktrunk create ralph/gate-14-dryrun
test -d "$SCRATCH/.worktrees/gate-14-dryrun" \
  && echo "create_pass=true" || echo "create_pass=false"

echo "=== remove ==="
worktrunk remove gate-14-dryrun
test ! -d "$SCRATCH/.worktrees/gate-14-dryrun" \
  && echo "remove_pass=true" || echo "remove_pass=false"

rm -rf "$SCRATCH"
```

3. `chmod +x tools/spikes/gate-14-worktrunk-dryrun/run.sh && ./tools/spikes/gate-14-worktrunk-dryrun/run.sh 2>&1 | tee tools/spikes/gate-14-worktrunk-dryrun/run.log`을 실행한다. `worktrunk create`/`worktrunk remove`가 정확히 A7-D5의 가정과 다른 서브커맨드·경로를 쓰면(예: 워크트리가 `.worktrees/`가 아니라 다른 위치에 생기면) `--help` 출력을 보고 스크립트의 `test -d` 경로를 실제 경로로 고쳐 재실행한다.
4. PASS 조건: `create_pass=true`와 `remove_pass=true` 둘 다.
5. `result.md`를 채운다: 실제로 확인된 정확한 명령 형태(`worktrunk create <branch>` 그대로인지, 플래그가 붙는지)를 측정치 칸에 남긴다 — 이 값은 Task 16(worktrunk-cli-spike)이 그대로 이어받는다.
6. `git add tools/spikes/gate-14-worktrunk-dryrun && git commit -m "$(cat <<'EOF'
gate-14: worktrunk create/remove 드라이런 (A7-1)

- 스크래치 레포에 대고 worktrunk create ralph/<id> → remove <id> 왕복 확인
- Pass 기준: create/remove 왕복

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"`

---

## 순서 B — Logan-assisted 게이트 (물리적 개입·OAuth 동의·GUI 권한 승인 필요)

### Task 9: Gate ③ — FileVault 켠 채 자동 로그인 (A6 소유, tier: Sonnet)

**질문**: 미니에서 FileVault를 켠 채로 자동 로그인이 재부팅 후 무개입으로 되는가.
**Owner**: Logan — 미니의 로컬 로그인 화면 조작(자동 로그인 설정, FileVault 복구키 확인, 재부팅 관찰)은 원격 Screen Sharing으로도 재부팅 직후의 초기 화면을 볼 수 없는 구간이 있어 물리적 현장 확인이 최선이다. Fable은 Screen Sharing(`vnc://<mini-hostname>.ts.net`)으로 절차 안내와 사후 확인만 한다.
**Host**: mini.
**Pass 기준(A6 §11.3 원문)**: "수동 개입 없이 재부팅 후 로그인 세션 도달".
**Fail → 결정 규칙(A6 §11.3·A6-D2 원문)**: "FileVault OFF + tailnet-only 노출 + 물리 보안 보완, Logan 승인 필수".
**순서 규칙(A6-D2·§11.1)**: 이 스파이크는 §2 1번(자동 로그인 설정)보다 먼저 실행한다 — FileVault 여부가 자동 로그인 설정 자체에 영향을 준다.

**Files:**
- Create: `tools/spikes/gate-03-filevault-autologin/checklist.md`.
- Modify: `tools/spikes/gate-03-filevault-autologin/result.md`.

**Interfaces:** Consumes: 없음(순수 OS 설정 절차, 코드 없음). Produces: 없음.

1. `docs/spec/A6-ops-infra.md` §2(미니 OS 설정 절차, 특히 8번)와 §11.3 ③행을 읽는다.
2. `tools/spikes/gate-03-filevault-autologin/checklist.md`를 쓴다(Logan이 미니 앞에서 그대로 따라갈 체크리스트 — 코드가 아니라 순서가 산출물이다):

```markdown
# Gate ③ 체크리스트 — FileVault ON + 자동 로그인 (미니, Logan 현장 작업)

1. System Settings → Privacy & Security → FileVault → Turn On FileVault. 복구키를 안전한 곳(비밀번호 관리자)에 저장한다.
2. 재시작 요구가 뜨면 재시작하고 디스크 암호화가 완료될 때까지 기다린다(`fdesetup status`로 진행률 확인 가능).
3. System Settings → Users & Groups → Automatic login → `logan` 계정으로 설정 시도.
4. 정상적으로 설정되면(FileVault ON 상태에서도 옵션이 막히지 않으면) 미니를 재부팅한다.
5. 재부팅 직후 로그인 화면 없이 바로 GUI 세션(데스크톱)에 도달하는지 **직접 육안으로** 확인한다 — Screen Sharing은 로그인 후 화면만 보여줄 수 있어 이 단계는 반드시 물리적으로 확인한다.
6. 4~5번을 총 2회 반복해 재현성을 확인한다(부팅마다 다를 수 있음).
```

3. Logan이 위 체크리스트를 실행하는 동안 대기하고, 완료 보고를 받으면 `result.md`에 실행일·Pass/Fail·decided_by(`Logan`)를 적는다.
4. Fail이면 A6-D2 규칙대로 즉시 FileVault를 OFF로 내리고 §3(네트워크)의 Tailscale ACL을 tailnet-only(Funnel 금지)로 좁히는 후속 작업이 필요함을 `result.md` 비고에 적고, 이 전환 자체는 Logan의 명시적 승인 문구를 받아 남긴다(승인 없이 이 플랜의 태스크가 스스로 FileVault를 끄지 않는다).
5. `git add tools/spikes/gate-03-filevault-autologin && git commit -m "$(cat <<'EOF'
gate-03: FileVault+자동 로그인 스파이크 체크리스트 및 결과 (Logan 현장 작업)

- Pass 기준: 재부팅 후 무개입 GUI 세션 도달
- Fail 시 A6-D2: FileVault OFF + tailnet-only + Logan 승인

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"`

### Task 10: Gate ④ — kmsg read on mini (A1-③, A1 §4 소유, tier: Sonnet)

**질문**: `kmsg watch --json`이 미니에서 48시간 연속으로 KakaoTalk 메시지를 정상 JSON 이벤트로 내보내면서 Accessibility 권한 재요청이 0회인가.
**Owner**: Logan — Accessibility 권한 프롬프트(System Settings → Privacy & Security → Accessibility)는 GUI 클릭이 필요하고 Screen Sharing으로 가능하지만 최초 승인은 물리적/원격 GUI 조작이 필수다.
**Host**: mini.
**Pass 기준(A1 §4 원문)**: "JSON에 최근 메시지 정상 출력, KakaoTalk.app 포커스 뺏기지 않음" / A6 §11.1 요약: "48h 연속, 권한 재요청 0".
**Fail → 결정 규칙(A1 §4 원문)**: "Notification Center DB + Vision OCR 폴백 설계로 전환, KakaoTalk read 착수 지연을 Logan에게 보고".

**Files:**
- Create: `tools/spikes/gate-04-kmsg-read/run.sh`, `tools/spikes/gate-04-kmsg-read/watch-48h.sh`.
- Modify: `tools/spikes/gate-04-kmsg-read/result.md`.

**Interfaces:** Consumes: 없음(kmsg CLI만). Produces: 없음.

1. `docs/spec/A1-channel-adapters.md` §4(A1-③ 행)와 §2.8(KakaoTalk 절)을 읽는다.
2. `tools/spikes/gate-04-kmsg-read/run.sh`를 쓴다(설치 + 최초 1회 read 확인, Logan이 미니에서 실행):

```bash
#!/usr/bin/env bash
set -euo pipefail
brew install channprj/tap/kmsg
kmsg chats --json | tee tools/spikes/gate-04-kmsg-read/chats.json
CHAT_ID=$(node -e "console.log(JSON.parse(require('fs').readFileSync('tools/spikes/gate-04-kmsg-read/chats.json','utf8'))[0].id)")
kmsg read "$CHAT_ID" --background-safe --json | tee tools/spikes/gate-04-kmsg-read/first-read.json
```

3. `tools/spikes/gate-04-kmsg-read/watch-48h.sh`를 쓴다(48시간 연속 관찰용 로그 수집 — 백그라운드 실행 후 이벤트 카운트와 에러를 집계):

```bash
#!/usr/bin/env bash
set -euo pipefail
LOG=tools/spikes/gate-04-kmsg-read/watch-48h.ndjson
kmsg watch --json > "$LOG" 2>tools/spikes/gate-04-kmsg-read/watch-48h.err &
echo $! > tools/spikes/gate-04-kmsg-read/watch.pid
echo "started, pid=$(cat tools/spikes/gate-04-kmsg-read/watch.pid), log=$LOG"
```

4. Logan이 미니에서 `run.sh`를 실행하고 System Settings의 Accessibility 권한 프롬프트에 Allow를 누른다(1회). 이어서 `watch-48h.sh`를 실행해 백그라운드로 48시간 켜둔다.
5. 48시간 후 Logan(또는 Fable이 Screen Sharing으로) `wc -l tools/spikes/gate-04-kmsg-read/watch-48h.ndjson`과 `cat tools/spikes/gate-04-kmsg-read/watch-48h.err`을 확인한다. PASS 조건: `.err` 파일에 권한 재요청 관련 에러가 없고(`grep -i "accessibility\|permission" watch-48h.err`가 빈 결과), `.ndjson`에 최소 1건 이상의 실제 메시지 이벤트가 있다.
6. `result.md`를 채운다: 48시간 시작/종료 시각, 총 이벤트 수, 권한 재요청 횟수(목표 0)를 적는다.
7. `git add tools/spikes/gate-04-kmsg-read && git commit -m "$(cat <<'EOF'
gate-04: kmsg read on mini 48시간 관찰 스파이크 (A1-③, Logan 현장 작업)

- kmsg watch --json 48시간 백그라운드 관찰, Accessibility 권한 재요청 횟수 카운트
- Pass 기준: 48h 연속, 권한 재요청 0

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"`

### Task 11: Gate ⑤ — Tailscale Serve HTTPS를 iPhone Safari에서 (A6 소유, tier: Sonnet)

**질문**: `<mini-hostname>.ts.net`에 iPhone Safari로 접속했을 때 SSL 에러 없이 페이지가 뜨는가.
**Owner**: Logan — 아이폰 실기기 Safari 테스트는 물리적 조작이 필요하다.
**Host**: mini(서빙) + iPhone(테스트 클라이언트).
**Pass 기준(A6 §11.3 원문)**: "SSL 에러 없이 페이지 로드".
**Fail → 결정 규칙(A6 §11.3 원문)**: "MagicDNS 이름 재확인 → 그래도 실패 시 TailscaleKit 검증을 Phase D로 앞당김".

**Files:**
- Create: `tools/spikes/gate-05-tailscale-serve-iphone/setup.sh`, `tools/spikes/gate-05-tailscale-serve-iphone/checklist.md`.
- Modify: `tools/spikes/gate-05-tailscale-serve-iphone/result.md`.

**Interfaces:** Consumes: 없음. Produces: 없음.

1. `docs/spec/A6-ops-infra.md` §3(네트워크, Tailscale Serve·MagicDNS·Funnel 문단)과 §11.3 ⑤행을 읽는다.
2. `tools/spikes/gate-05-tailscale-serve-iphone/setup.sh`를 쓴다(미니에서 최소한의 정적 페이지를 Serve로 노출한다 — 아직 `apps/web`이 없으므로 `python3 -m http.server`로 흉내낸다):

```bash
#!/usr/bin/env bash
set -euo pipefail
mkdir -p /tmp/omnis-spike-05 && echo "<h1>omnis gate-05 ok</h1>" > /tmp/omnis-spike-05/index.html
(cd /tmp/omnis-spike-05 && python3 -m http.server 5173 &)
sudo tailscale serve --bg --https=443 / localhost:5173/
echo "serve status:"
tailscale serve status
```

3. `tools/spikes/gate-05-tailscale-serve-iphone/checklist.md`를 쓴다:

```markdown
# Gate ⑤ 체크리스트 — Tailscale Serve HTTPS @ iPhone Safari (Logan)

1. 미니에서 `setup.sh` 실행(위 명령, Fable이 Screen Sharing으로 대신 실행 가능 — GUI 권한이 필요 없는 CLI 단계라 unattended 대행 가능. 다만 아이폰 쪽 확인만 Logan이 한다).
2. 아이폰 Settings → 설치된 프로파일/VPN 확인: DoH(DNS-over-HTTPS) 앱이나 private-DNS 프로파일이 있으면 임시로 끈다(A6 §3의 알려진 원인).
3. 아이폰 Safari에서 `https://<mini-hostname>.ts.net` 접속.
4. SSL 경고 없이 "omnis gate-05 ok" 페이지가 뜨는지 확인.
5. 3번이 실패하면 MagicDNS가 켜져 있는지(Tailscale 앱 → Settings) 재확인 후 재시도.
```

4. Logan이 iPhone에서 3~5번을 수행하고 결과를 보고하면 `result.md`에 채운다: SSL 에러 여부, DoH 앱 유무, 재시도 필요했는지.
5. 스파이크 종료 후 `sudo tailscale serve --https=443 off`(또는 `tailscale serve reset`)로 임시 정적 서버 노출을 내린다 — 이건 본 스파이크가 Zero/hub의 실제 경로가 아니라 흉내낸 것이므로 상시로 켜두지 않는다.
6. `git add tools/spikes/gate-05-tailscale-serve-iphone && git commit -m "$(cat <<'EOF'
gate-05: Tailscale Serve HTTPS @ iPhone Safari 스파이크 (Logan 확인)

- 미니에 임시 정적 페이지를 Serve로 노출, 아이폰 Safari에서 SSL 에러 없이 로드되는지 확인
- Pass 기준: SSL 에러 0

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"`

### Task 12: Gate ⑨ — Slack Socket Mode 1턴 왕복 (A1-④, A1 §4 소유, tier: Sonnet)

**질문**: Slack 앱을 Socket Mode로 만들고 WS 연결 후 테스트 DM을 보냈을 때 5초 이내(G1)에 이벤트를 수신하는가.
**Owner**: Logan — Slack workspace에 새 앱을 만들고 설치(admin 승인)하는 것은 Slack UI에서 Logan 계정으로 해야 한다.
**Host**: macbook(Socket Mode WS 클라이언트는 GUI가 필요 없어 개발 머신에서 수신 확인).
**Pass 기준(A1 §4 원문)**: "5초 이내 이벤트 수신(G1)".
**Fail → 결정 규칙(A1 §4 원문)**: "Events API(공인 endpoint, Funnel 경유) 대안 검토 — Phase A 지연 가능".

**Files:**
- Create: `tools/spikes/gate-09-slack-socket-mode/manifest.yaml`, `tools/spikes/gate-09-slack-socket-mode/listen.ts`, `tools/spikes/gate-09-slack-socket-mode/checklist.md`.
- Modify: `tools/spikes/gate-09-slack-socket-mode/result.md`.

**Interfaces:** Consumes: `@slack/socket-mode`(npm, Slack 공식 SDK — provider SDK는 A1 채널 스파이크 안에서만 쓴다는 제약을 그대로 지킨다). Produces: 없음.

1. `docs/spec/A1-channel-adapters.md` §2.1(Slack)과 §4(A1-④ 행)를 읽는다.
2. `tools/spikes/gate-09-slack-socket-mode/manifest.yaml`을 쓴다(Slack App manifest, Logan이 api.slack.com/apps → Create from manifest로 그대로 붙여넣는다):

```yaml
display_information:
  name: omnis-spike-gate-09
features:
  bot_user:
    display_name: omnis-spike
oauth_config:
  scopes:
    bot: ["channels:history", "chat:write", "im:history"]
settings:
  socket_mode_enabled: true
  event_subscriptions:
    bot_events: ["message.channels", "message.im"]
```

3. `tools/spikes/gate-09-slack-socket-mode/checklist.md`를 쓴다:

```markdown
# Gate ⑨ 체크리스트 (Logan)

1. https://api.slack.com/apps → Create New App → From an app manifest → `manifest.yaml` 붙여넣기.
2. OAuth & Permissions에서 워크스페이스에 설치(admin 승인), `xoxb-...` 토큰 확보.
3. Basic Information → App-Level Tokens에서 `connections:write` scope로 `xapp-...` 토큰 발급.
4. 두 토큰을 `security add-generic-password -s omnis.slack.xoxb.gate09 -a 281932556+jinhologankim@users.noreply.github.com -w '<xoxb>'`, `omnis.slack.xapp.gate09`로 Keychain에 저장(A1 명명 규칙, 프로덕션 재사용 아님 — 스파이크 전용 임시 앱).
5. `listen.ts` 실행 후 아무 DM 채널에서 테스트 메시지 1건 전송.
```

4. `tools/spikes/gate-09-slack-socket-mode/listen.ts`를 쓴다:

```ts
import { SocketModeClient } from "@slack/socket-mode";
import { execSync } from "node:child_process";

const appToken = execSync(
  "security find-generic-password -s omnis.slack.xapp.gate09 -a 281932556+jinhologankim@users.noreply.github.com -w",
).toString().trim();

const client = new SocketModeClient({ appToken });

client.on("message", ({ event, ack }) => {
  const t = Date.now();
  console.log(`received_at_ms=${t} text=${JSON.stringify(event.text)}`);
  ack();
});

await client.start();
console.log("socket mode connected, waiting for a test DM...");
setTimeout(() => process.exit(0), 60000);
```

5. `cd tools/spikes/gate-09-slack-socket-mode && pnpm add @slack/socket-mode && npx tsx listen.ts`를 실행한 채로 Logan이 테스트 DM을 보낸다. 콘솔에 찍힌 `received_at_ms`와 메시지 전송 시각(Slack 클라이언트 화면의 타임스탬프)의 차이를 5초 기준과 비교한다.
6. `result.md`를 채운다.
7. `git add tools/spikes/gate-09-slack-socket-mode && git commit -m "$(cat <<'EOF'
gate-09: Slack Socket Mode 1턴 왕복 스파이크 (A1-④, Logan 앱 설치)

- Socket Mode WS 연결 후 테스트 DM 수신 지연 측정
- Pass 기준: 5초 이내 이벤트 수신(G1)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"`

### Task 13: Gate ⑩ — Gmail watch + Pub/Sub pull 왕복 (A1-⑤, A1 §4 소유, tier: Sonnet)

**질문**: `users.watch()`로 Gmail push를 Pub/Sub에 걸었을 때 테스트 메일 발송 후 `historyId`가 pull subscription으로 실제 수신되는가.
**Owner**: Logan — Google Cloud 프로젝트 생성/과금 연결과 OAuth 동의 화면 승인은 Logan 계정으로 해야 한다.
**Host**: macbook.
**Pass 기준(A1 §4 원문)**: "pull subscription으로 `historyId` 수신".
**Fail → 결정 규칙(A1 §4 원문)**: "`history.list` 1분 폴링으로 폴백(이미 §2.2에 폴백으로 명시된 경로, 기능 손실 없음)".

**Files:**
- Create: `tools/spikes/gate-10-gmail-watch-pubsub/checklist.md`, `tools/spikes/gate-10-gmail-watch-pubsub/watch-and-pull.ts`.
- Modify: `tools/spikes/gate-10-gmail-watch-pubsub/result.md`.

**Interfaces:** Consumes: `googleapis`(npm, `google-auth-library`). Produces: 없음.

1. `docs/spec/A1-channel-adapters.md` §2.2(Gmail)와 §4(A1-⑤ 행)를 읽는다.
2. `tools/spikes/gate-10-gmail-watch-pubsub/checklist.md`를 쓴다:

```markdown
# Gate ⑩ 체크리스트 (Logan)

1. `gcloud pubsub topics create omnis-gmail-spike`
2. `gcloud pubsub subscriptions create omnis-gmail-spike-sub --topic omnis-gmail-spike`
3. Gmail API OAuth consent(Logan 계정, gmail.readonly scope)로 최초 1회 브라우저 동의 → 토큰을 `~/.omnis-spike/gmail-token.json`에 저장(스파이크 전용 임시 경로, 프로덕션 Keychain 규칙과 무관).
4. Pub/Sub 토픽에 Gmail push 발행 권한 부여: `gcloud pubsub topics add-iam-policy-binding omnis-gmail-spike --member=serviceAccount:gmail-api-push@system.gserviceaccount.com --role=roles/pubsub.publisher`
```

3. `tools/spikes/gate-10-gmail-watch-pubsub/watch-and-pull.ts`를 쓴다:

```ts
import { google } from "googleapis";
import { readFileSync } from "node:fs";

const token = JSON.parse(readFileSync(`${process.env.HOME}/.omnis-spike/gmail-token.json`, "utf8"));
const auth = new google.auth.OAuth2();
auth.setCredentials(token);
const gmail = google.gmail({ version: "v1", auth });
const pubsub = google.pubsub({ version: "v1", auth });

const watchRes = await gmail.users.watch({
  userId: "me",
  requestBody: { topicName: "projects/<PROJECT_ID>/topics/omnis-gmail-spike" },
});
console.log("watch historyId:", watchRes.data.historyId);
console.log("이제 아무 계정에서 이 Gmail 주소로 테스트 메일을 1통 보내세요...");

const deadline = Date.now() + 120000;
while (Date.now() < deadline) {
  const pull = await pubsub.projects.subscriptions.pull({
    subscription: "projects/<PROJECT_ID>/subscriptions/omnis-gmail-spike-sub",
    requestBody: { maxMessages: 1 },
  });
  const msg = pull.data.receivedMessages?.[0];
  if (msg) {
    const decoded = Buffer.from(msg.message!.data!, "base64").toString("utf8");
    console.log(`received historyId payload: ${decoded}`);
    console.log("gate10_pass=true");
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 3000));
}
console.log("gate10_pass=false (timeout)");
process.exit(1);
```

4. `<PROJECT_ID>`를 Logan의 실제 GCP 프로젝트 ID로 바꾸고 `cd tools/spikes/gate-10-gmail-watch-pubsub && pnpm add googleapis && npx tsx watch-and-pull.ts`를 실행한 채로 Logan이 테스트 메일을 보낸다.
5. `result.md`를 채운다: `watch()`가 준 초기 `historyId`, pull로 받은 payload, 왕복 소요 시간.
6. `git add tools/spikes/gate-10-gmail-watch-pubsub && git commit -m "$(cat <<'EOF'
gate-10: Gmail watch + Pub/Sub pull 왕복 스파이크 (A1-⑤, Logan OAuth 동의)

- users.watch() 등록 후 테스트 메일 발송, pull subscription으로 historyId 수신 확인
- Pass 기준: pull subscription으로 historyId 수신

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"`

### Task 14: Gate ① — Calendar `events.watch` via Funnel (A6 소유, tier: Sonnet)

**질문**: Tailscale Funnel로 노출한 webhook URL에 Google Calendar `events.watch`를 등록했을 때, 실제 일정 변경 후 1분 이내 알림이 오는가.
**Owner**: Logan — Calendar API OAuth 동의(Logan 캘린더 접근)와 Funnel을 여는/닫는 판단(공인 인터넷 노출이므로 A6 §3 "원칙적으로 안 쓴다"는 방침의 예외)은 Logan이 최종 확인한다. Fable이 명령을 준비하고 Screen Sharing으로 같이 실행할 수 있다.
**Host**: mini(Funnel은 허브가 배치될 미니에서 연다, A6 §3).
**Pass 기준(A6 §11.3 원문)**: "webhook이 이벤트 변경 후 1분 이내 도착".
**Fail → 결정 규칙(A6 §11.3 원문)**: "`events.list` + syncToken 폴링 1~5분(마스터 §8에 이미 기본 경로로 명시)".

**Files:**
- Create: `tools/spikes/gate-01-calendar-funnel/checklist.md`, `tools/spikes/gate-01-calendar-funnel/webhook-receiver.ts`.
- Modify: `tools/spikes/gate-01-calendar-funnel/result.md`(Task 1이 이미 기본값을 채워둔 것을 실제 결과로 갱신).

**Interfaces:** Consumes: `googleapis`(npm). Produces: 없음.

1. `docs/spec/A6-ops-infra.md` §3(Funnel 문단)과 §11.3 ①행, `docs/spec/A1-channel-adapters.md` §4(A1-① 행)를 읽는다.
2. `tools/spikes/gate-01-calendar-funnel/webhook-receiver.ts`를 쓴다(Google이 `validationToken` 핸드셰이크와 이후 POST 알림을 이 엔드포인트로 보낸다):

```ts
import { createServer } from "node:http";

const server = createServer((req, res) => {
  const t = new Date().toISOString();
  console.log(`[${t}] ${req.method} ${req.url}`);
  console.log("headers:", JSON.stringify(req.headers));
  res.writeHead(200).end("ok");
});

server.listen(8788, () => console.log("gate-01 webhook receiver on :8788"));
```

3. `tools/spikes/gate-01-calendar-funnel/checklist.md`를 쓴다:

```markdown
# Gate ① 체크리스트 (미니, Logan 확인)

1. `npx tsx tools/spikes/gate-01-calendar-funnel/webhook-receiver.ts &`로 로컬 8788 포트에 리시버를 띄운다.
2. `sudo tailscale funnel --bg 443 8788`로 Funnel을 연다(원칙적으로 상시 사용 금지 — 이 스파이크 동안만).
3. Google Calendar API에 OAuth 동의(Logan 캘린더, calendar scope)로 최초 1회 인증.
4. `POST https://www.googleapis.com/calendar/v3/calendars/primary/events/watch`를 `{ id: <uuid>, type: "web_hook", address: "https://<mini-hostname>.ts.net" }`로 호출(Funnel이 443을 8788로 넘기므로 address는 tailnet 도메인 루트).
5. Google Calendar에서 아무 일정이나 수정/생성한다.
6. 웹훅 리시버 로그에 POST 요청이 1분 이내 찍히는지 확인한다.
7. **스파이크 종료 즉시(pass든 fail이든) `sudo tailscale funnel 443 off`로 Funnel을 끈다.**
```

4. Logan이 실행하고 결과를 보고하면 `result.md`를 갱신한다.
5. `git add tools/spikes/gate-01-calendar-funnel && git commit -m "$(cat <<'EOF'
gate-01: Calendar events.watch via Funnel 스파이크 (A6 §11.3, Logan OAuth 동의)

- Funnel로 노출한 webhook에 events.watch 등록, 일정 변경 후 알림 도착 시간 측정
- Pass 기준: webhook이 이벤트 변경 후 1분 이내 도착
- 스파이크 종료 후 Funnel은 반드시 끈다(A6 §3 "원칙적으로 안 쓴다")

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"`

### Task 15: Gate ② — Beeper 토큰 발급 + WhatsApp 부번호 send (A6 소유, tier: Sonnet)

**질문**: Beeper Desktop에 부번호로 QR 페어링한 뒤 로컬 REST API로 토큰을 발급받고 테스트 메시지를 보낼 수 있는가, 그리고 24시간 내 계정 제재 신호가 없는가.
**Owner**: Logan — Beeper Desktop 설치·QR 페어링(부번호가 든 실물/보조 휴대폰으로 QR 스캔)은 전적으로 물리적 조작이다.
**Host**: mini(master 토폴로지: Beeper Desktop LaunchAgent는 미니에서 돈다).
**Pass 기준(A6 §11.3 원문)**: "토큰 발급 성공 + 발송 성공 + 24시간 내 계정 제재 신호 없음".
**Fail → 결정 규칙(A6 §11.3·마스터 D4 원문)**: "whatsmeow Go 사이드카(마스터 D4 폴백)".

**Files:**
- Create: `tools/spikes/gate-02-beeper-whatsapp/checklist.md`, `tools/spikes/gate-02-beeper-whatsapp/send-test.ts`.
- Modify: `tools/spikes/gate-02-beeper-whatsapp/result.md`.

**Interfaces:** Consumes: 없음(Beeper 로컬 REST API를 `fetch`로 직접 호출, provider SDK 없음). Produces: 없음.

1. `docs/spec/A1-channel-adapters.md` §2.6(WhatsApp — Beeper)과 §4(A1-② 행), `docs/spec/00-omnis-design.md` §19 Q2("부번호 파일럿 먼저")를 읽는다.
2. `tools/spikes/gate-02-beeper-whatsapp/checklist.md`를 쓴다:

```markdown
# Gate ② 체크리스트 (미니, Logan 현장 작업)

1. 미니에 Beeper Desktop 설치, WhatsApp 부번호(Q2 기본값 — 실사용 번호 아님)로 QR 페어링.
2. Beeper Settings → Integrations에서 로컬 REST API 토큰 발급.
3. `security add-generic-password -s omnis.beeper.token -a 281932556+jinhologankim@users.noreply.github.com -w '<token>'`로 Keychain에 저장(A6 §9 명명 규칙).
4. `send-test.ts`로 부번호 자신 또는 테스트 상대에게 메시지 1건 발송.
5. 24시간 동안 부번호 계정이 정상 동작하는지(로그인 풀림·경고 메시지 없는지) 관찰.
```

3. `tools/spikes/gate-02-beeper-whatsapp/send-test.ts`를 쓴다:

```ts
import { execSync } from "node:child_process";

const token = execSync(
  "security find-generic-password -s omnis.beeper.token -a 281932556+jinhologankim@users.noreply.github.com -w",
).toString().trim();

const chatID = process.argv[2];
if (!chatID) throw new Error("usage: tsx send-test.ts <chatID>");

const res = await fetch(`http://127.0.0.1:23373/v1/chats/${chatID}/messages`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({ text: "omnis gate-02 spike test message" }),
});

console.log(`status=${res.status}`);
console.log(await res.text());
process.exit(res.ok ? 0 : 1);
```

4. Logan이 체크리스트대로 진행하고 `npx tsx tools/spikes/gate-02-beeper-whatsapp/send-test.ts <chatID>`를 실행한다. PASS 조건: `status=200`이고 상대 단말에서 수신 확인.
5. 24시간 후 계정 상태를 재확인하고 `result.md`에 토큰 발급 성공 여부, 발송 성공 여부, 24시간 후 제재 신호 유무를 채운다.
6. `git add tools/spikes/gate-02-beeper-whatsapp && git commit -m "$(cat <<'EOF'
gate-02: Beeper 토큰 발급 + WhatsApp 부번호 send 스파이크 (Logan QR 페어링)

- Beeper 로컬 REST API로 부번호에서 테스트 메시지 1건 발송, 24시간 계정 상태 관찰
- Pass 기준: 토큰 발급 성공 + 발송 성공 + 24시간 내 계정 제재 신호 없음

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"`

---

## 순서 C — A7-D4/A7-D5 자체 스파이크 (14개 게이트 외 추가 2개)

### Task 16: worktrunk CLI 확정 절차 문서화 (A7-D5 자체 스파이크, tier: Sonnet)

**질문**: ralph 루프가 스토리마다 실제로 실행할 정확한 worktrunk 명령 형태(플래그 포함)는 무엇인가 — Task 8(gate-14)의 dry-run PASS 결과를 ralph 루프가 그대로 재사용할 수 있는 확정 절차로 옮긴다.
**Owner**: agent(unattended) — Task 8이 이미 물리적/OAuth 개입 없이 확보한 결과를 문서화하는 후속 작업이라 사람 개입이 필요 없다.
**Host**: macbook.
**Pass 기준**: A7 §3의 "worktrunk 워크트리 격리 절차" 문단이 참조할 수 있는 확정 명령 형태 문서 1개(`confirmed-usage.md`)가 Task 8의 `result.md`와 일치.
**Fail → 결정 규칙**: Task 8이 fail이면 이 태스크는 실행하지 않는다(선행 태스크 없이는 확정할 내용이 없다) — 대신 A7 §3의 `git worktree add`/`git worktree remove` 폴백 명령을 `confirmed-usage.md`에 기록한다.

**Files:**
- Create: `tools/spikes/worktrunk-cli/confirmed-usage.md`.
- Test: 없음(문서 태스크, `tools/spikes/gate-14-worktrunk-dryrun/result.md`와의 일치를 셸 명령으로 확인).

**Interfaces:** Consumes: `tools/spikes/gate-14-worktrunk-dryrun/result.md`(Task 8 산출물 — 이 플랜 안의 앞선 태스크). Produces: 없음.

1. `tools/spikes/gate-14-worktrunk-dryrun/result.md`와 `run.log`를 읽는다.
2. `mkdir -p tools/spikes/worktrunk-cli`.
3. `tools/spikes/worktrunk-cli/confirmed-usage.md`를 쓴다(Task 8에서 실제로 관측된 정확한 명령 형태를 옮긴다 — Task 8이 A7-D5 기본 가정 그대로 PASS했다고 가정한 기본 문서화, fail이었다면 2번의 대안 형태로 교체):

```markdown
# worktrunk 확정 사용법 (A7-D5, gate-14 dry-run 근거)

- 워크트리 생성: `worktrunk create ralph/<story-id>` → `omnis/.worktrees/<story-id>`에 생성됨(gate-14 확인).
- 워크트리 제거: `worktrunk remove <story-id>`.
- ralph 루프(A7 §3)의 "스토리 착수 직전" 단계는 이 두 명령을 그대로 쓴다. A7-D5의 "UNVERIFIED — 스파이크" 표기는 이 문서로 해소된다.
- 재현 증거: `tools/spikes/gate-14-worktrunk-dryrun/result.md`, `run.log`.
```

4. `grep -q "Pass" tools/spikes/gate-14-worktrunk-dryrun/result.md && echo "gate14_was_pass=true" || echo "gate14_was_pass=false"`로 Task 8 결과와의 일치를 확인한다(Task 8이 fail이었다면 3번 문서를 `git worktree add <path> -b ralph/<story-id>` / `git worktree remove <path>` 형태로 다시 쓴다).
5. `git add tools/spikes/worktrunk-cli && git commit -m "$(cat <<'EOF'
worktrunk-cli-spike: A7-D5 worktrunk CLI 확정 절차 문서화

- gate-14 dry-run 결과를 ralph 루프가 참조할 confirmed-usage.md로 정리
- A7-D5 "UNVERIFIED — 스파이크" 표기 해소

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"`

### Task 17: Tauri UI 테스트 도구 반나절 스파이크 (A7-D4·A7-2, tier: Sonnet)

**범위(M14, `2026-09-20-plans-review.md` §1)**: 컴포넌트 단위 테스트 도구는 이미 `2026-09-20-phase-a-desktop.md`가 vitest + `@testing-library/react` + jsdom으로 확정했다(그 플랜의 `packages/ui/vitest.config.ts`·`apps/desktop/vitest.config.ts`, `@testing-library/react` 의존성 참조) — 이 태스크는 그 결정을 재검토하지 않는다. Task 17이 답하는 질문은 오직 **e2e 스모크**(vitest+jsdom으로는 낼 수 없는, 실제로 빌드된 Tauri 바이너리를 띄워 진짜 WebDriver로 클릭하는 테스트) 하나뿐이며, `tauri-driver`로 그게 가능한지만 확정한다.
**질문**: `tauri-driver` + WebdriverIO 조합이 실제로 Tauri 2 앱의 e2e UI 스모크(빌드된 바이너리 기준 — 컴포넌트 단위 테스트가 아니다)를 돌릴 수 있는가(A7-D4의 "UNVERIFIED — 스파이크" 기본 가정 검증).
**Owner**: agent(unattended) — 로컬 스크래치 Tauri 앱에 대한 빌드·테스트라 GUI 클릭이나 OAuth가 필요 없다(창이 뜨긴 하지만 WebDriver가 자동 조작한다).
**Host**: macbook.
**Pass 기준(A7-D4 원문)**: 명시적 수치는 없음 — "확정"이 목표다. 이 태스크는 "`tauri-driver` 세션이 열리고 WebdriverIO가 스크래치 앱의 버튼 클릭 1건을 성공시킨다"를 pass 기준으로 삼는다(A7-D4가 요구하는 최소 확정 단위).
**Fail → 결정 규칙(M14 수정)**: `tauri-driver`가 세션을 못 열면(알려진 리스크 — Tauri의 WebDriver 경로는 Linux(WebKitWebDriver)/Windows(msedgedriver) 중심이고 macOS 공식 지원이 없다) e2e 스모크는 **웹 빌드 대상 Playwright**로 대체한다(`apps/desktop`을 Tauri 런타임 없이 `vite build`한 순수 웹 번들을 띄워 Playwright로 조작 — US-A25 이후 태스크가 이 스크립트를 만든다). 컴포넌트 단위 테스트는 이 실패와 무관하게 계속 vitest+RTL+jsdom(`phase-a-desktop.md`)을 쓴다 — "vitest 유닛으로만 대체"가 아니라 "e2e 계층만 Playwright로 대체"다.

**Files:**
- Create: `tools/spikes/tauri-ui-test/scratch-app/`(임시 Tauri hello-world, `packages/*`/`apps/*`가 아니다), `tools/spikes/tauri-ui-test/wdio.conf.ts`, `tools/spikes/tauri-ui-test/smoke.test.ts`.
- Create: `tools/spikes/tauri-ui-test/result.md`(Task 1 스캐폴드 대상이 아니므로 이 태스크가 처음 만든다).

**Interfaces:** Consumes: `@tauri-apps/cli` 2.11.5(이미 설치됨, `_probes` 파일), `tauri-driver`(cargo), `webdriverio`(npm). Produces: 없음.

1. `docs/spec/A7-dev-process.md` A7-D4(§0 결정표)와 §5("UI 스모크")를 읽는다.
2. `cd tools/spikes/tauri-ui-test && npx create-tauri-app@latest scratch-app --template vanilla --manager pnpm --yes`로 최소 Tauri 앱을 만든다(이 앱은 버릴 코드다 — `apps/desktop`과 무관, US-A25가 실제 앱을 다시 만든다).
3. `cargo install tauri-driver`로 드라이버를 설치한다(A7-D4 기본 가정).
4. `tools/spikes/tauri-ui-test/wdio.conf.ts`를 쓴다:

```ts
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

let tauriDriver: ChildProcess;

export const config: WebdriverIO.Config = {
  specs: ["./smoke.test.ts"],
  capabilities: [
    {
      "tauri:options": {
        application: path.resolve(
          "scratch-app/src-tauri/target/release/scratch-app",
        ),
      },
    } as any,
  ],
  hostname: "127.0.0.1",
  port: 4444,
  beforeSession: () => {
    tauriDriver = spawn("tauri-driver", [], { stdio: "inherit" });
  },
  afterSession: () => tauriDriver?.kill(),
};
```

5. `tools/spikes/tauri-ui-test/smoke.test.ts`를 쓴다(Tauri 기본 템플릿의 "Greet" 버튼을 클릭하고 응답 텍스트가 바뀌는지 확인 — vanilla 템플릿의 실제 DOM id는 `greet-input`/`greet-button`/`greet-msg`다):

```ts
import { expect } from "@wdio/globals";

describe("gate: tauri-driver + webdriverio smoke", () => {
  it("clicks the greet button and sees a response", async () => {
    const input = await $("#greet-input");
    await input.setValue("gate-17");
    const button = await $("#greet-button");
    await button.click();
    const msg = await $("#greet-msg");
    await expect(msg).toHaveTextContaining("gate-17");
  });
});
```

6. `cd tools/spikes/tauri-ui-test/scratch-app && pnpm tauri build --debug`로 릴리스 바이너리를 만들고(wdio.conf.ts의 경로와 맞춰 `--debug`면 `target/debug/scratch-app`로 경로를 조정한다), `cd .. && pnpm add -D webdriverio @wdio/cli @wdio/mocha-framework @wdio/local-runner && npx wdio run wdio.conf.ts`를 실행한다.
7. PASS 조건: WebdriverIO 세션이 정상 종료되고 `smoke.test.ts`의 assertion이 통과(exit code 0). 실패하면(예: `tauri-driver`가 macOS를 공식 지원하지 않아 세션이 안 열리면 — Tauri의 WebDriver 경로는 Linux(WebKitWebDriver)/Windows(msedgedriver) 중심이라는 게 알려진 리스크) 에러 메시지를 그대로 `result.md`에 옮기고 A7-D4 폴백(vitest 유닛 + 수동 QA)을 채택 결정으로 기록한다.
8. `tools/spikes/tauri-ui-test/result.md`를 새로 쓴다(다른 게이트와 같은 템플릿, Task 1의 14개에는 없었으므로 여기서 직접 만든다):

```markdown
# Spike: Tauri UI 테스트 도구 (A7-D4, A7-2)

- **질문**: tauri-driver + WebdriverIO로 Tauri 2 앱 UI 스모크가 되는가
- **소유 부록**: A7(A7-D4)
- **Owner**: agent
- **Host**: macbook
- **실행일**: 
- **결과(Pass/Fail)**: 
- **측정치/근거**: 
- **decided_by**: 
- **비고**: 
```

9. `git add tools/spikes/tauri-ui-test && git commit -m "$(cat <<'EOF'
tauri-ui-test-spike: tauri-driver + WebdriverIO 확정 스파이크 (A7-D4)

- 스크래치 Tauri vanilla 앱에 버튼 클릭 WebdriverIO 스모크 1건 실행(e2e 계층 전용 — 컴포넌트 테스트는 phase-a-desktop.md의 vitest+RTL+jsdom이 이미 확정)
- Pass 시 apps/desktop(US-A25 이후)의 e2e 스모크 도구로 확정, Fail 시 웹 빌드 대상 Playwright로 대체(M14)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"`

---

## 완료 기준

`tools/spikes/gate-01-calendar-funnel/result.md` ~ `gate-14-worktrunk-dryrun/result.md` 14개 전부와 `worktrunk-cli/confirmed-usage.md`, `tauri-ui-test/result.md`가 채워지고, 14개 게이트가 전부 Pass(또는 A6-D2/D4류의 승인된 폴백으로 대체)여야 마스터 §16의 "14개 게이트의 pass/fail이 결정표를 채움" 종료 기준을 만족하고 Phase A(`2026-09-20-phase-a-kernel-and-db.md` 등)에 착수할 수 있다. `A6-ops-infra.md` §11.1의 "결과 기록표(빈 양식)"도 이 14개 `result.md`의 값으로 옮겨 채운다(A6 문서 자체를 고치는 것은 이 플랜의 범위 밖이다).

## Self-review 기록

1. **스토리 커버리지**: US-A00(Task 1), 게이트 ①(Task 14) ②(Task 15) ③(Task 9) ④(Task 10) ⑤(Task 11) ⑥(Task 2) ⑦(Task 3) ⑧(Task 4) ⑨(Task 12) ⑩(Task 13) ⑪(Task 5) ⑫(Task 6) ⑬(Task 7) ⑭(Task 8) — 14개 전부 태스크 1개씩 매핑됨. 계약(`2026-09-20-phase-a-interfaces.md` §10)이 요구한 `worktrunk-cli-spike`(Task 16)·`tauri-ui-test-spike`(Task 17)도 포함.
2. **금지 패턴 grep**: `TBD`, `TODO`, `implement later`, `add appropriate error handling`, `handle edge cases`, `similar to Task` — 전부 0건(각 게이트의 코드는 실제 스크립트이고, `result.md` 빈 칸은 A6 §11.3 "결과 기록표(빈 양식)"과 같은 실행 후 기입용 데이터 템플릿이지 구현 회피가 아니다).
3. **심볼 검증**: 이 플랜은 `packages/*`가 아직 없는 Phase 0을 다루므로 계약(§3~§8)의 `@omnis/*` export를 하나도 소비하지 않는다(의도된 것 — A7 §1 "tools/spikes는 워크스페이스 빌드 그래프 밖"). 소비하는 심볼은 전부 npm 패키지(`@rocicorp/zero`, `googleapis`, `@slack/socket-mode`, `webdriverio`)이거나 이 플랜 안의 앞선 태스크 산출물(Task 16이 Task 8의 `result.md`를 읽는 것 하나뿐)이다.

## 수정 이력 (2026-09-20, cross-plan review)

- **M14 / Task 17**: `tauri-driver`+WebdriverIO 범위를 e2e 전용으로 축소 — 컴포넌트 테스트는 `phase-a-desktop.md`의 vitest+RTL+jsdom로 이미 확정된 것으로 명시하고, Fail 결정 규칙을 "vitest 유닛+수동 QA"에서 "웹 빌드 대상 Playwright"로 교체했다.
- **게이트 ⑪ / Task 5**: `_probes` "Findings that change gate ⑪" 1·2번을 원문 그대로 전제 블록에 인용하고, mode (b)를 자체 `.claude/settings.json` project hook을 가진 fresh worktree fixture cwd에서 실행하도록 재작성해 project hook 발동 여부를 실측하며, pass 기준을 "최소 한 모드에서 omnis hook 발동 AND project hook 미발동"으로 정밀화하고 결정 결과를 마스터 §19 Q13에 반영하도록 명시했다.
- **게이트 ⑫ / Task 6**: 검토 — `--permission-mode` 리터럴 6종(no `default`)과 observe→plan / workspace→manual / trusted→bypassPermissions 매핑이 이미 반영돼 있어 추가 수정 없음.
- **게이트 ⑦ / Task 3**: 검토 — `codex app-server generate-json-schema --out <dir>`로 스키마를 벤더링한 뒤 turn-start 메서드를 스키마에서 찾고 런타임 조회 폴백(수동 정규식 보정)을 유지하는 절차가 이미 반영돼 있어 추가 수정 없음.
- **US-A00 / Task 1**: 검증 명령을 `find tools/spikes -maxdepth 1 -mindepth 1 -type d | grep -v '/_probes$' | wc -l`에서 `find tools/spikes -maxdepth 1 -mindepth 1 -type d ! -name _probes`(+`| wc -l`)로 교체(본문 3곳 + 커밋 메시지 1곳).
