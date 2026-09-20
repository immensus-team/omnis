// Entry point for `pnpm e2e:phase-a`. Bring the stack up → seed → run Playwright → leave evidence
// and REPORT.md behind → tear it all down. It does the same thing twice in a row to check idempotence.
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

/** Look at what the hub actually recorded, not the UI — an approval decision is proven by audit_log and the state transition. */
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
      console.log("E2E_HOLD=1 — holding with the stack up. Finish with ctrl-c.");
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
  return `# Phase A end-to-end smoke report

Generated: ${now} · \`pnpm e2e:phase-a\` (tools/e2e/run.ts)

Stack: PostgreSQL \`${DB_NAME}\` (migrations 0001–0008 + Zero permissions) → zero-cache :${ZERO_PORT}
→ hub :${HUB_PORT} (HTTP + WS /bridge) → local agent bridge (mock runtime fixture, host=macbook)
→ desktop Vite dev :${VITE_PORT} → Playwright (chromium, headless).

The seed only ever takes real code paths: adapter \`normalize()\` → kernel \`IngestSink\`,
kernel \`approvals.propose\`, \`classify()\` from \`@omnis/agents\` (T0 rule path, no network call),
\`ClaudeCodeAdapter\` + \`apps/local-agent/test\` fixture replay.

${passes
  .map(
    (p) => `## Pass ${p.pass} (${(p.ms / 1000).toFixed(1)}s, items=${p.seed.itemCount})

| Result | Check | Time | Note |
| --- | --- | --- | --- |
${rows(p)}
`,
  )
  .join("\n")}
## Idempotence

Two consecutive runs produced ${same ? "the same result (PASS)" : "different results (FAIL)"}.

## How to read this (what the report does not claim)

- **Since U2 (kinso conversation rows) the Inbox is a thread list.** Several messages in one thread
  collapse into a single row (the most recent item), and a row title resolves in the order person
  display name → thread title → channel handle — Phase A's kernel IngestSink deliberately leaves
  author_person_id empty (person identity resolution is Phase B), so every seeded row falls back to
  the thread title. A1 checks the thread count, A2b checks that those titles are really on screen.
- **A2 looks at a visible icon, not an accessible name.** The channel icon is a react-icons/si
  SVG (it was monogram text before U2) — A2 confirms "something is really drawn here" through an
  svg child node and a non-zero bounding box.
- **A2c/A2d look at the kinso shell and the row anatomy.** A2c checks that the left channel rail
  tiles (Inbox/Slack/Gmail/Google Calendar/Agent) and the top "Start typing to ask or search" pill
  bar are up; A2d checks that a single row has an avatar · name · **relative-time grammar**
  (now/3m/2w/4 Aug — not an ISO timestamp) · a non-empty summary line. Without those two, A1/A2/A2b
  still pass even with the summary line missing entirely.
- **A4 looks at identity, not counts.** Since U2 made rows thread-level, the seed's work thread and
  personal thread are one each — "the counts differ" no longer holds (it actually broke in the U2
  merge), so the check became whether the two filters' row sets are disjoint and both are proper
  subsets of all. A4b separately checks that a rail tile click narrows the list and the Inbox tile
  restores it.
- **T1 (DeepSeek/OpenRouter) calls are blocked by force.** The seed clears
  OMNIS_OPENROUTER_API_KEY before calling classify() — if rule stage 1 misses and it falls through
  to stage 3, t1Model() throws before the fetch. Separately from that, A10 checks that the recorded
  run has tier=T0.
- **Re-running this smoke overwrites REPORT.md and the evidence/ PNGs.** If you ran it before
  merging, either revert with \`git checkout -- tools/e2e\` or commit the new results as they are.

## Evidence

The 8 PNGs in \`tools/e2e/evidence/\` (01-inbox / 02-inbox-filter-work / 03-thread /
04-agent-session / 05-approval-card / 06-command-palette / 07-g5-live-item /
08-archived — the Archived view with the "Archived" pill on, US-A36).
05 crops to just the approval card — shot full-screen it would be exactly the same picture as 04
(the shell pins the approval card above the detail pane, so it is already up in 04).

## Logs

hub.log · zero-cache.log · desktop.log in \`tools/e2e/.logs/\` (not committed).
`;
}

const env = loadOrCreateEnv();
const passes: PassResult[] = [];
try {
  // Two passes by default (idempotence check). While debugging, E2E_PASSES=1 runs it once.
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
