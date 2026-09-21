// US-B29 (Tasks screen) screenshots: docs/design/screens/w4b/tasks-{1440,390}.png.
//
// Same stack and the same two sizes as shots-w4b-today.ts (1440x900 and 390x844). This story needs a
// fixture of its own because `docs/design/screens/*` has never pictured the Tasks screen — before
// US-B29 there was nothing to picture — and the seed writes no `tasks` rows at all. Nothing in the
// seed is a task, so every row in these frames has to be produced here.
//
// The rows are driven through the **real** writers rather than typed in, the same call shots-w4b-today
// makes for the digest loops:
//
//   - `taskLoop.apply` (packages/agents/src/loops/task.ts, US-B19) for every task, which is the
//     production path for an extracted todo: it runs the confidence filter, calls `propose_task`, and
//     — for an owner='agent' task the routing rules can place — `propose_delegation`.
//   - `delegateLoop.apply` (US-B20) for the delegation whose rules could not place it: that is
//     exactly the `task.created` trigger the loop declares, and it is where the inline approval card
//     comes from.
//
// Only the model's own output is stubbed — the sentences T1 would return. Everything downstream of
// that (the confidence gate, the task INSERT, the `items.meta.task_due_basis` write, the approval
// INSERT, the routing rules, the Delegated row's `kind = 'delegation'`) is production code, so what
// the frame shows is what the screen shows on a real morning.
//
// Run: pnpm tsx tools/e2e/shots-w4b-tasks.ts   (same ports as the e2e smoke — never run both at once)
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Browser, type Page, chromium } from "@playwright/test";
import { configureAgents, delegateLoop, taskLoop } from "../../packages/agents/src/index.js";
import { Pool, query } from "../../packages/db/src/index.js";
import { createLogger } from "../../packages/kernel/src/index.js";
import { describeOverflow, measureOverflow } from "./overflow.js";
import { seed } from "./seed.js";
import {
  HUB_PORT,
  REPO_ROOT,
  VITE_PORT,
  ZERO_PORT,
  assertPortsFree,
  deployZeroPermissions,
  loadOrCreateEnv,
  resetDatabase,
  startDesktop,
  startHub,
  startZeroCache,
  stopAll,
  waitForHttp,
} from "./stack.js";

const OUT = join(REPO_ROOT, "docs/design/screens/w4b");
const logger = createLogger("@omnis/shots-tasks");

/** US-B19's own constants (packages/agents/src/loops/task.ts) — repeated here only so the fixture
 *  can be read against the loop's rules without opening it. */
const TASK_CONFIDENCE_MIN = 0.7;

/** Local midnight-relative ISO, in UTC. `due_at` reaches `propose_task` as a `z.string().datetime()`,
 *  which is the strict `...Z` form — an offset form would be a string the schema rejects, even though
 *  this fixture bypasses validation by calling `apply` directly. */
function dueIn(days: number, hour: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

interface PlannedTask {
  title: string;
  detail?: string;
  owner: "me" | "agent";
  /** The loop's `due_basis`: "stated" is a date a person wrote, "inferred" a date the model read out
   *  of the message. It lands on `items.meta.task_due_basis`, which is the only place it exists. */
  due_basis: "stated" | "inferred" | "none";
  due_at?: string;
  confidence: number;
}

/** Five items, five threads, one task each — three due today, one this week, one undated, plus the
 *  agent-owned one that carries the delegation. Titles are ordinary English todo lines: these rows
 *  are model extraction output, so they read like something T1 pulled out of a message rather than
 *  like test data.
 *
 *  Three under Today on purpose. A single row per tab would screenshot as cleanly as a screen whose
 *  query returned nothing, which is the failure mode these shots exist to rule out — and the frames
 *  have to show a *list*, which takes more than one row to be. */
const PLAN: PlannedTask[][] = [
  [
    {
      title: "Send the countersigned NDA back to Northwind legal",
      detail: "Dana asked for it before the 11:00 review.",
      owner: "me",
      due_basis: "inferred",
      due_at: dueIn(0, 18),
      confidence: 0.9,
    },
  ],
  [
    {
      title: "Confirm Thursday's offsite headcount with Priya",
      owner: "me",
      due_basis: "stated",
      due_at: dueIn(0, 12),
      confidence: 0.87,
    },
  ],
  [
    // The delegation. Deliberately hint-free: no path, no GUI-channel mention, no cadence. The route
    // rules (packages/agents/src/delegate/route.ts) therefore reach no verdict for it and `taskLoop`
    // stops at the task row — the L4 case A4 §4.4 describes, and the one `delegateLoop` exists for.
    // The hint regexes are Korean-only (route.ts MINUTES/HOURS), so an English task can never carry an
    // `est_minutes` anyway; that number comes from the delegate loop's own output below.
    //
    // Due today, not undated, because that is what puts it under Today *and* Delegated at once — A5
    // §3.5 defines Delegated as a separate axis (`owner_kind='agent'`), never as "and nowhere else",
    // and a delegation due today that vanished from Today would be work the person never sees on the
    // day it is due.
    {
      title: "Re-run the adapter contract suite and report what fails",
      detail: "The two failures from last night need a clean run on the current main.",
      owner: "agent",
      due_basis: "none",
      due_at: dueIn(0, 17),
      confidence: 0.86,
    },
  ],
  [
    {
      title: "Review the Brightstone redlines",
      owner: "me",
      due_basis: "stated",
      due_at: dueIn(3, 10),
      confidence: 0.88,
    },
  ],
  [
    {
      title: "Ask Minjun for the updated headcount figures",
      detail: "No date was given — raise it next time we talk.",
      owner: "me",
      due_basis: "none",
      confidence: 0.82,
    },
  ],
];

/** The two sentences each loop asks the model for, and nothing else — the ranking and the writes are
 *  arithmetic. Stubbing exactly those is what lets the rest of the loop run for real. */
function stubResult<T>(loop: string, output: T) {
  return {
    loop,
    run_id: "e2e-shots-tasks",
    output,
    confidence: 1,
    rationale: "e2e screenshot fixture",
    escalate: false,
    injection_flags: [],
    unresolved: [],
  };
}

const nowContext = () => ({
  trigger_kind: "manual" as const,
  now: new Date(),
  payload: {} as Record<string, unknown>,
});

/** Every task in these frames, written by the loops that write tasks. */
async function seedTasks(pool: Pool): Promise<void> {
  configureAgents({ pool });

  // One item per thread — the newest in each — so no two tasks share a source conversation and the
  // `sourceLabelFor` join has several distinct accounts to resolve.
  const items = await query<{ id: string; thread_id: string }>(
    pool,
    `SELECT DISTINCT ON (i.thread_id) i.id, i.thread_id
       FROM items i JOIN threads t ON t.id = i.thread_id
      WHERE t.kind <> 'agent_session' AND i.status <> 'draft'
      ORDER BY i.thread_id, i.sent_at DESC
      LIMIT $1`,
    [PLAN.length],
  );
  if (items.length < PLAN.length) {
    throw new Error(
      `the seed produced ${String(items.length)} usable threads, need ${PLAN.length}`,
    );
  }

  for (const [i, tasks] of PLAN.entries()) {
    const item = items[i];
    if (item === undefined) break;
    await taskLoop.apply(
      stubResult("task", {
        tasks: tasks.filter((t) => t.confidence >= TASK_CONFIDENCE_MIN),
        confidence: 1,
        rationale: "e2e screenshot fixture",
        injection_flags: [],
      }),
      { ...nowContext(), item_id: item.id, thread_id: item.thread_id },
    );
  }

  // The delegation, through the loop the `task.created` trigger belongs to. `est_minutes` is what the
  // approval card's description prints, and it is the one number the hint regexes cannot supply in
  // English — so it comes from the loop's output, which is where T2 would have put it. 25 minutes
  // because the card's own risk tier turns on that number (propose.ts: >30 is 'high'), and a routine
  // delegation is the frame worth showing.
  const delegated = await query<{ id: string }>(
    pool,
    `SELECT id FROM tasks
      WHERE owner_kind = 'agent'
        AND id NOT IN (SELECT task_id FROM pending_approvals WHERE action = 'delegate')
      LIMIT 1`,
  );
  const taskId = delegated[0]?.id;
  if (taskId === undefined) {
    throw new Error("no agent-owned task was extracted — delegateLoop has nothing to place");
  }
  await delegateLoop.apply(
    stubResult("delegate", {
      runtime: "claude_code",
      host: "macbook",
      goal: "Get the adapter contract suite green again",
      background: ["Two failures on main since last night", "Worktree at ~/AI-Workspaces/omnis"],
      steps: ["Run the contract suite", "Diagnose both failures", "Report the root cause"],
      acceptance: ["The suite exits 0", "Every failure has a named cause"],
      verify_cmd: "pnpm test:contract",
      workdir: "~/AI-Workspaces/omnis",
      est_minutes: 25,
      confidence: 0.9,
      rationale: "No routing rule matched; the work needs a real worktree and about an hour.",
      injection_flags: [],
    }),
    { ...nowContext(), task_id: taskId },
  );
  logger.info("tasks seeded");
}

/** One frame plus the horizontal-overflow reading. Both are asserted (the Tasks screen draws nothing
 *  meant to sit past the viewport edge, unlike shots-w4b.ts's floating palette): at 1440 and at 390
 *  anything past the edge is a defect. */
async function shoot(page: Page, label: string): Promise<void> {
  await page.waitForTimeout(700);
  const file = join(OUT, `tasks-${label}.png`);
  await page.screenshot({ path: file });
  const overflow = await page.evaluate(measureOverflow);
  console.log(`  tasks-${label}.png — ${describeOverflow(overflow)}`);
  if (overflow.diff > 0 || overflow.worst !== null) {
    throw new Error(`the Tasks screen overflows at ${label}px: ${describeOverflow(overflow)}`);
  }
}

/** A finished screen, not an empty one: the four view tabs, the quick-add field and at least three
 *  task rows are waited for by name, and the state word is read off the surface. A frame of
 *  `data-state="loading"` — or of `Nothing due today` — would screenshot just as cleanly, which is
 *  exactly what this shot exists to disprove. */
async function openTasks(page: Page): Promise<void> {
  await page.goto(`http://127.0.0.1:${String(VITE_PORT)}/?screen=tasks`);
  await page.waitForSelector(".tasks-screen", { timeout: 60_000 });
  await page.waitForSelector(".tasks-screen__quick-input", { timeout: 30_000 });
  await page.waitForSelector(".task-row", { timeout: 30_000 });
  const state = await page.getAttribute(".tasks-screen", "data-state");
  if (state !== "ready") {
    throw new Error(`the Tasks screen is in state "${String(state)}", not "ready"`);
  }
}

/** 1440x900 — all three panes, Today open, the delegation's approval card expanded in place.
 *
 *  Three panes, not two: the rail and the main column are there from the first paint, but the detail
 *  column only exists once something is open — so this clicks a source link first, the one navigation
 *  the Tasks screen does into that pane (A5 §3.5's source → Thread). With it open the frame shows what
 *  the screen actually has to survive: rail + list + detail at 1440 with the card expanded underneath.
 *
 *  The card is the reason this is not a plain list shot: A5 §3.5's inline delegation approval is the
 *  one interaction nothing else in the app has, and the same row with the card closed cannot show it.
 *  It sits on Today because that is where a delegation with a due date belongs (see PLAN) — the
 *  Delegated tab is one click away and shows the same row, which is the point of the axis. */
async function widePass(browser: Browser): Promise<void> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await openTasks(page);
    // `.task-row__source` is a button only when the shell passed a handler, so this doubles as the
    // check that the source deep link is wired rather than drawn as inert text.
    await page.locator("button.task-row__source").first().click();
    await page.waitForSelector('[data-testid="detail-pane"]', { timeout: 10_000 });
    await page.getByRole("button", { name: "Needs approval" }).click();
    await page.waitForSelector(".tasks-screen__approval", { timeout: 10_000 });
    await shoot(page, "1440");
  } finally {
    await page.close();
  }
}

/** 390x844 — one column and the bottom bar. Today again, because that is the tab the screen opens on
 *  and the one a phone lands on: the narrow frame's job is the same list at a width where the row has
 *  to re-flow (app.css's container query puts each title on its own line and the meta underneath),
 *  and a different tab would change two variables at once. The approval card is left closed — it
 *  lands below the fold here, so opening it would move the fold without changing what is above it. */
async function narrowPass(browser: Browser): Promise<void> {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await openTasks(page);
    await shoot(page, "390");
  } finally {
    await page.close();
  }
}

async function main(): Promise<void> {
  const env = loadOrCreateEnv();
  assertPortsFree();
  await resetDatabase(env);
  deployZeroPermissions(env);
  startZeroCache(env);
  await waitForHttp(`http://127.0.0.1:${String(ZERO_PORT)}/`, 90_000);
  startHub(env);
  await waitForHttp(`http://127.0.0.1:${String(HUB_PORT)}/health`, 60_000);
  startDesktop();
  await waitForHttp(`http://127.0.0.1:${String(VITE_PORT)}/`, 90_000);

  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 4 });
  let closeBridge: (() => void) | undefined;
  try {
    const seeded = await seed(pool, env);
    closeBridge = seeded.closeBridge;
    await seedTasks(pool);

    // What the screen will draw, asked of the database before the browser is even open. Each view
    // tab's case is printed rather than assumed: if the fixture ever stops producing one of them the
    // frame would still look like a screen — it would just be a screen missing a tab's worth of rows.
    const counts = await query<{ bucket: string; n: string }>(
      pool,
      `SELECT CASE
                WHEN state IN ('done','dropped') THEN 'closed'
                WHEN owner_kind = 'agent' THEN 'delegated'
                WHEN due_at IS NULL THEN 'someday'
                WHEN due_at <= date_trunc('day', now()) + interval '1 day' THEN 'today'
                WHEN due_at <= now() + interval '7 days' THEN 'week'
                ELSE 'beyond'
              END AS bucket,
              count(*)::text AS n
         FROM tasks GROUP BY 1 ORDER BY 1`,
    );
    for (const c of counts) console.log(`tasks ${c.bucket}: ${c.n}`);
    const [basis] = await query<{ n: string }>(
      pool,
      `SELECT count(*)::text AS n FROM items WHERE meta ->> 'task_due_basis' = 'inferred'`,
    );
    const [delegations] = await query<{ n: string }>(
      pool,
      "SELECT count(*)::text AS n FROM pending_approvals WHERE action = 'delegate' AND state = 'pending'",
    );
    console.log(
      `inferred due dates=${String(basis?.n)} delegate approvals=${String(delegations?.n)}`,
    );
    const buckets = new Map(counts.map((c) => [c.bucket, Number(c.n)]));
    const missing = ["today", "week", "someday", "delegated"].filter((b) => !buckets.get(b));
    if (missing.length > 0 || basis?.n === "0" || delegations?.n !== "1") {
      throw new Error(
        `the fixture did not produce what the Tasks screen draws (missing ${missing.join(",")})`,
      );
    }

    mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch();
    try {
      await widePass(browser);
      await narrowPass(browser);
    } finally {
      await browser.close();
    }
    console.log("shots written to", OUT);
  } finally {
    closeBridge?.();
    await pool.end();
    await stopAll();
  }
}

await main();
