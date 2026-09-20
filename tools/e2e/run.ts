// `pnpm e2e:phase-a` 진입점. 스택을 올리고 → 시드하고 → Playwright를 돌리고 → 증거와 REPORT.md를
// 남기고 → 전부 내린다. 멱등성 확인을 위해 같은 일을 두 번 연속 한다.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Pool, query } from "../../packages/db/src/index.js";
import { type SeedResult, seed } from "./seed.js";
import {
  DB_NAME,
  E2E_DIR,
  HUB_PORT,
  REPO_ROOT,
  VITE_PORT,
  ZERO_PORT,
  assertPortsFree,
  deployZeroPermissions,
  dropDatabase,
  loadOrCreateEnv,
  resetDatabase,
  startDesktop,
  startHub,
  startZeroCache,
  stopAll,
  waitForHttp,
} from "./stack.js";

interface Assertion {
  name: string;
  ok: boolean;
  ms: number;
  note?: string;
}
interface PassResult {
  pass: number;
  ms: number;
  seed: SeedResult;
  assertions: Assertion[];
}

const TMP = join(E2E_DIR, ".tmp");

async function bringUp(env: Record<string, string>): Promise<void> {
  assertPortsFree();
  await resetDatabase(env);
  deployZeroPermissions(env);
  startZeroCache(env);
  await waitForHttp(`http://127.0.0.1:${ZERO_PORT}/`, 90_000);
  startHub(env);
  await waitForHttp(`http://127.0.0.1:${HUB_PORT}/health`, 60_000);
  startDesktop();
  await waitForHttp(`http://127.0.0.1:${VITE_PORT}/`, 90_000);
}

function runPlaywright(env: Record<string, string>): void {
  const r = spawnSync(
    "npx",
    ["playwright", "test", "--config", join(E2E_DIR, "playwright.config.ts")],
    {
      cwd: REPO_ROOT,
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: env.DATABASE_URL ?? "" },
    },
  );
  if (r.status !== 0) console.error(`playwright exited with ${String(r.status)}`);
}

/** UI가 아니라 허브가 실제로 남긴 흔적을 본다 — 승인 결정은 audit_log와 상태 전이로 증명된다. */
async function auditAssertions(pool: Pool, seeded: SeedResult): Promise<Assertion[]> {
  const out: Assertion[] = [];
  const started = Date.now();
  const audit = await query<{ action: string }>(
    pool,
    "SELECT action FROM audit_log WHERE target_id = $1 AND action = 'approval.decided'",
    [seeded.approvalId],
  );
  out.push({
    name: "A8b hub recorded audit_log(approval.decided)",
    ok: audit.length === 1,
    ms: Date.now() - started,
    note: `${audit.length} row(s)`,
  });
  const state = await query<{ state: string; decision: string | null }>(
    pool,
    "SELECT state, decision FROM pending_approvals WHERE id = $1",
    [seeded.approvalId],
  );
  out.push({
    name: "A8c pending_approvals.state moved to decided(accept)",
    ok: state[0]?.state === "decided" && state[0]?.decision === "accept",
    ms: 0,
    note: `state=${state[0]?.state ?? "?"} decision=${state[0]?.decision ?? "?"}`,
  });
  const runs = await query<{ model_tier: string; outcome: string }>(
    pool,
    "SELECT model_tier, outcome FROM agent_runs WHERE loop = 'classify'",
  );
  out.push({
    name: "A10 classify() recorded a T0 run in agent_runs (no network)",
    ok: runs.length >= 1 && runs.every((r) => r.model_tier === "T0" && r.outcome === "ok"),
    ms: 0,
    note: `${runs.length} run(s), tier=${seeded.classifyTier}`,
  });
  const runtimes = await query<{ state: string }>(
    pool,
    "SELECT state FROM agent_runtimes WHERE runtime = 'claude_code' AND host = 'macbook'",
  );
  out.push({
    name: "A11 local-agent registered over WS /bridge",
    ok: runtimes.length === 1,
    ms: 0,
    note: `agent_runtimes state=${runtimes[0]?.state ?? "missing"}`,
  });
  return out;
}

async function onePass(pass: number, env: Record<string, string>): Promise<PassResult> {
  const started = Date.now();
  mkdirSync(TMP, { recursive: true });
  await bringUp(env);
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 5 });
  try {
    const seeded = await seed(pool, env);
    writeFileSync(join(TMP, "seed.json"), JSON.stringify(seeded, null, 2));
    writeFileSync(join(TMP, "assertions.json"), "[]");
    if (process.env.E2E_HOLD === "1") {
      console.log("E2E_HOLD=1 — 스택을 띄운 채로 대기한다. ctrl-c로 끝낸다.");
      await new Promise(() => {});
    }
    runPlaywright(env);
    const assertions = JSON.parse(
      readFileSync(join(TMP, "assertions.json"), "utf8"),
    ) as Assertion[];
    const audit = await auditAssertions(pool, seeded);
    seeded.closeBridge?.();
    return {
      pass,
      ms: Date.now() - started,
      seed: seeded,
      assertions: [...assertions, ...audit],
    };
  } finally {
    await pool.end();
    await stopAll();
  }
}

function report(passes: PassResult[]): string {
  const now = new Date().toISOString();
  const rows = (p: PassResult): string =>
    p.assertions
      .map((a) => `| ${a.ok ? "PASS" : "FAIL"} | ${a.name} | ${a.ms}ms | ${a.note ?? ""} |`)
      .join("\n");
  const first = passes[0];
  const second = passes[1];
  const same =
    first !== undefined &&
    second !== undefined &&
    first.seed.itemCount === second.seed.itemCount &&
    first.assertions.length === second.assertions.length &&
    first.assertions.every((a, i) => a.ok === (second.assertions[i]?.ok ?? false));
  return `# Phase A 종단 스모크 리포트

생성: ${now} · \`pnpm e2e:phase-a\` (tools/e2e/run.ts)

스택: PostgreSQL \`${DB_NAME}\` (마이그레이션 0001–0008 + Zero permissions) → zero-cache :${ZERO_PORT}
→ 허브 :${HUB_PORT} (HTTP + WS /bridge) → 로컬 에이전트 브리지(mock 런타임 픽스처, host=macbook)
→ 데스크톱 Vite dev :${VITE_PORT} → Playwright(chromium, headless).

시드는 전부 실제 코드 경로다: 어댑터 \`normalize()\` → 커널 \`IngestSink\`,
커널 \`approvals.propose\`, \`@omnis/agents\`의 \`classify()\`(T0 규칙 경로, 네트워크 호출 없음),
\`ClaudeCodeAdapter\` + \`apps/local-agent/test\` 픽스처 재생.

${passes
  .map(
    (p) => `## Pass ${p.pass} (${(p.ms / 1000).toFixed(1)}s, items=${p.seed.itemCount})

| 결과 | 검증 | 소요 | 비고 |
| --- | --- | --- | --- |
${rows(p)}
`,
  )
  .join("\n")}
## 멱등성

두 번 연속 실행 결과가 ${same ? "동일하다 (PASS)" : "달랐다 (FAIL)"}.

## 읽는 법 (이 리포트가 주장하지 않는 것)

- **Inbox는 U2(kinso 대화 행)부터 스레드 목록이다.** 한 스레드의 여러 메시지는 행 하나로
  합쳐지고(가장 최근 item), 행 제목은 사람 표시명 → 스레드 제목 → 채널 핸들 순으로 정해진다 —
  Phase A의 커널 IngestSink는 author_person_id를 의도적으로 비워 두어(person 신원 해석은
  Phase B) 모든 시드 행이 스레드 제목으로 떨어진다. A1이 스레드 수를, A2b가 그 제목이 실제로
  화면에 있는지 본다.
- **A2는 접근성 이름이 아니라 눈에 보이는 아이콘을 본다.** 채널 아이콘은 react-icons/si
  SVG다(U2 이전엔 모노그램 텍스트였다) — A2가 svg 자식 노드와 non-zero bounding box로
  "정말 뭔가 그려져 있다"를 확인한다.
- **T1(DeepSeek/OpenRouter) 호출은 강제로 막혀 있다.** 시드가 classify()를 부르기 전에
  OMNIS_OPENROUTER_API_KEY를 비운다 — 규칙 1단이 안 맞아 3단까지 흘러내려도 t1Model()이
  fetch 전에 던진다. A10은 그와 별개로 기록된 run이 tier=T0인지 본다.
- **이 스모크를 다시 돌리면 REPORT.md와 evidence/ PNG가 덮어써진다.** 머지 전에 돌렸다면
  \`git checkout -- tools/e2e\`로 되돌리거나, 새 결과를 그대로 커밋해야 한다.

## 증거

\`tools/e2e/evidence/\`의 PNG 7장 (01-inbox / 02-inbox-filter-work / 03-thread /
04-agent-session / 05-approval-card / 06-command-palette / 07-g5-live-item).
05는 승인 카드 요소만 잘라 찍는다 — 전체 화면으로 찍으면 04와 완전히 같은 그림이 된다
(셸이 승인 카드를 상세 패널 위에 고정해 두기 때문에 04에도 이미 떠 있다).

## 로그

\`tools/e2e/.logs/\`의 hub.log · zero-cache.log · desktop.log (커밋 대상 아님).
`;
}

const env = loadOrCreateEnv();
const passes: PassResult[] = [];
try {
  // 기본은 2회(멱등성 확인). 디버깅 중에는 E2E_PASSES=1로 한 번만 돈다.
  const total = Number(process.env.E2E_PASSES ?? "2");
  for (let pass = 1; pass <= total; pass++) {
    passes.push(await onePass(pass, env));
  }
} finally {
  await stopAll();
  dropDatabase();
}
writeFileSync(join(E2E_DIR, "REPORT.md"), report(passes));
const failed = passes.flatMap((p) => p.assertions).filter((a) => !a.ok);
console.log(
  `\n${failed.length === 0 ? "ALL PASS" : `${failed.length} FAILED`} — tools/e2e/REPORT.md`,
);
process.exit(failed.length === 0 ? 0 : 1);
