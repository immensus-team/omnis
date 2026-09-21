// loop-r1-07 evidence: an agent session's header, its empty states and its expandable tool calls,
// against the live stack rather than a mock. What the story adds is only legible next to what was
// there before — "the pane is not empty any more", "the pill on the header and the pill on the row
// are the same mapper", "these arguments are the ones the DB holds" — and none of those is a claim
// an RTL test with a stubbed query can make. The reduced-motion check is here for the same reason:
// it is the browser's own `getComputedStyle`, not this repo's reading of its own stylesheet.
//
// Run against a stack that is already up (this script boots none of its own — it is the same live
// app a person is looking at):
//   OMNIS_E2E_DB=omnis_test_loop_r1_e2e OMNIS_E2E_PORT_OFFSET=200 ZERO_SHARD_NUM=9 \
//     pnpm tsx tools/e2e/hold.ts --web
//   pnpm tsx tools/e2e/shots-loop-r1-07.ts   (desktop http://127.0.0.1:5373)
//
// Three fixture repairs, all idempotent, all because the seed predates this story (see
// repairFixture below): the session's `cwd` is NULL, its one tool call carries `args = {}` (the hub
// writes `meta.input ?? {}` for a call that reported no input), and no pending approval points at
// the session thread — densify() proposes only on `kind <> 'agent_session'` threads, so the
// waiting section had nothing to show in the stack as seeded. The rows are left as the
// script wrote them: a second run finds the fixture already in place, and the stack keeps the one
// approval these screenshots are evidence about.
//
// Five checks, in the order a person hits them:
//   1. Agents pill -> the blocked `claude_code · inbox-draft` session: header title, runtime on its
//      host, the directory, the "Blocked" pill (the same mapper the inbox row uses), the waiting
//      label with the card under it, and no "$" anywhere in the screen (UX-13).
//   2. The tool call: one line closed, the arguments the DB holds once its summary is clicked.
//   3. 390: the same session in the sheet, with the header and the approval still on screen.
//   4. The running "Drafting 3 inbox replies" session: a pane that says it is working rather than an
//      empty one.
//   5. Reduced motion: the working dot's `animation-name` is the pulse at full motion and `none`
//      under `reduce` — the counterweight in the same breath, so a `none` that was always there
//      cannot pass for the override.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Page, chromium } from "@playwright/test";
import { Pool, one, query } from "../../packages/db/src/index.js";
import { createKernel, createLogger } from "../../packages/kernel/src/index.js";
import { assertNoOverflow, describeOverflow, measureOverflow } from "./overflow.js";
import { REPO_ROOT, loadOrCreateEnv } from "./stack.js";

const BASE = process.env.OMNIS_SHOTS_URL ?? "http://127.0.0.1:5373";
const OUT = join(REPO_ROOT, "docs/design/loop/r1/impl/loop-r1-07");

const WIDE = { width: 1440, height: 900 } as const;
/** The brief's 390x844, without `isMobile` — the same way the other shot tools take a narrow pass. */
const PHONE = { width: 390, height: 844 } as const;
/** SKILLS.md #11's four narrow widths, swept with the session open. */
const SWEEP = [320, 375, 414, 768] as const;

const SESSION_KEY = "agent:claude_code:macbook:inbox-draft";
const WORKING_TITLE = "Drafting 3 inbox replies";
/** The copy the script asserts on, spelled once so a reworded line fails the check rather than
 *  quietly passing it. loop-r2-07 renamed the section label from "Waiting on you" to "Waiting for
 *  your approval" (the old line named the section but not what the session was waiting on); this
 *  script is the other reader of that copy, so it moves with it. */
const WAITING = "Waiting for your approval";
const WORKING = "Working · no output yet";
const BLOCKED_PILL = "Blocked";

/** What the repaired tool call carries. Two keys rather than one, because the point of the `<pre>`
 *  is that it is the raw I/O: a single-key object is indistinguishable from a fixed label. */
const TOOL_ARGS = { command: "ls src", timeout_ms: 15_000 };
/** The approval the fixture proposes on the session thread. A session blocked on a decision has to
 *  be blocked on something a person would recognise. */
const ASK = "Send the drafted reply to the Northwind thread?";
const APPROVAL_CONFIG = {
  allow_accept: true,
  allow_edit: true,
  allow_respond: true,
  allow_ignore: true,
};

const logger = createLogger("@omnis/shots-loop-r1-07");
/** The session screen itself, wherever the shell has put it — a pane column at 1440, a sheet at 390. */
const screen = (page: Page) => page.locator(".agent-session-screen");

/** The session row's own ids, read from the database rather than clicked for: a row that has to be
 *  found by its visible title is a locator that breaks on a rewording, and this fixture is written
 *  by the seed, not by the screen. */
async function sessionThread(pool: Pool): Promise<{ id: string; title: string; host: string }> {
  const row = await one<{ id: string; title: string; host: string }>(
    pool,
    `SELECT t.id, t.title, r.host
       FROM agent_sessions s
       JOIN threads t ON t.id = s.thread_id
       JOIN agent_runtimes r ON r.id = s.runtime_id
      WHERE s.session_key = $1`,
    [SESSION_KEY],
  );
  return row;
}

async function threadByTitle(pool: Pool, title: string): Promise<string> {
  const row = await one<{ id: string }>(
    pool,
    "SELECT id FROM threads WHERE kind = 'agent_session' AND title = $1",
    [title],
  );
  return row.id;
}

/** The three repairs described in the header. Each is guarded by the state it repairs, so a second
 *  run over the same stack writes nothing and prints "already in place". */
async function repairFixture(pool: Pool, threadId: string): Promise<string> {
  const missing: string[] = [];

  const cwd = await query<{ cwd: string | null }>(
    pool,
    "SELECT cwd FROM agent_sessions WHERE thread_id = $1",
    [threadId],
  );
  if ((cwd[0]?.cwd ?? null) === null) {
    await query(pool, "UPDATE agent_sessions SET cwd = $2 WHERE thread_id = $1", [
      threadId,
      REPO_ROOT,
    ]);
    missing.push("cwd");
  }

  const args = await query<{ id: string }>(
    pool,
    `SELECT id FROM items
      WHERE thread_id = $1 AND kind = 'tool_call' AND tool -> 'args' = '{}'::jsonb`,
    [threadId],
  );
  if (args.length > 0) {
    // Raw SQL rather than the kernel: this is the hub's own jsonb column (bridge.ts writes
    // `{name, label, state, args: meta.input ?? {}}`), and there is no service that edits an item
    // after the fact — the same direct write densify() uses to build its fixture.
    await query(
      pool,
      "UPDATE items SET tool = jsonb_set(tool, '{args}', $2::jsonb) WHERE id = $1",
      [args[0]?.id, JSON.stringify(TOOL_ARGS)],
    );
    missing.push(`${args.length} tool call(s) without arguments`);
  }

  const pending = await query<{ id: string }>(
    pool,
    "SELECT id FROM pending_approvals WHERE thread_id = $1 AND state = 'pending'",
    [threadId],
  );
  let approvalId = pending[0]?.id;
  if (approvalId === undefined) {
    // Through the kernel's real propose path, like densify(): the row the screen reads is the row
    // the product writes, trigger and all.
    const kernel = createKernel({ pool, logger });
    try {
      approvalId = await kernel.approvals.propose({
        action: "send",
        args: { channel: "slack", body: ASK },
        description: ASK,
        config: APPROVAL_CONFIG,
        risk: "normal",
        thread_id: threadId,
      });
    } finally {
      await kernel.close();
    }
    missing.push("the session's pending approval");
  }

  console.log(
    missing.length === 0
      ? "fixture: already in place (cwd, tool arguments, pending approval)"
      : `fixture: wrote ${missing.join(", ")}`,
  );
  return approvalId;
}

async function assertNoOverflowAt(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(measureOverflow);
  console.log(`  ${label}: ${describeOverflow(overflow)}`);
  assertNoOverflow(label, overflow);
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  // tools/e2e/.env keeps whichever database the *first* stack in this worktree used, and the port
  // offset cannot tell us the database name — without this guard the browser would talk to the stack
  // on :5373 while the writes below land in another database.
  if (process.env.OMNIS_E2E_DB === undefined) {
    throw new Error("OMNIS_E2E_DB must name the running stack's database (see the header)");
  }
  const env = loadOrCreateEnv();
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });
  const browser = await chromium.launch();

  try {
    const session = await sessionThread(pool);
    const approvalId = await repairFixture(pool, session.id);
    const workingId = await threadByTitle(pool, WORKING_TITLE);
    console.log(
      `session ${session.id} "${session.title}" on ${session.host}; approval ${approvalId}`,
    );

    const page = await browser.newPage({ viewport: WIDE });
    await page.goto(BASE);
    await page.waitForSelector(".inbox-row", { timeout: 60_000 });

    // ---- 1. the blocked session, one Agents-pill click away ---------------------------------------
    await page.getByRole("radio", { name: "Agents" }).click();
    const row = page.locator(`.inbox-row[data-thread-id="${session.id}"]`).first();
    await row.waitFor({ timeout: 30_000 });
    await row.click();
    await page.locator(".session-header").waitFor({ timeout: 30_000 });

    const heading = (await page.locator(".session-header__title").textContent())?.trim();
    if (heading !== session.title) {
      throw new Error(`the header reads "${heading}", not the thread's title "${session.title}"`);
    }
    // The pill is read off the header and not off the row: the claim is that the two agree, and the
    // row's own badge is on screen behind the sheet at 390 but never at 1440.
    const pill = (await page.locator(".session-header .status-pill").textContent())?.trim();
    if (pill !== BLOCKED_PILL) {
      throw new Error(`the header's pill reads "${pill}", not "${BLOCKED_PILL}"`);
    }
    const runtimeLine = `Claude Code on ${session.host}`;
    if ((await screen(page).getByText(runtimeLine).count()) !== 1) {
      throw new Error(`the header does not carry "${runtimeLine}"`);
    }
    if ((await screen(page).getByText(REPO_ROOT).count()) !== 1) {
      throw new Error(`the header does not carry the session's directory (${REPO_ROOT})`);
    }
    // loop-r1-07: the queue moved *into* the screen, so the label and the card are one section —
    // asserting the label alone would pass on a stack where the card was still drawn above the pane.
    const waiting = page.locator(".agent-session-screen__waiting");
    await waiting.getByText(WAITING).waitFor({ timeout: 30_000 });
    if ((await waiting.locator(".approval-card").count()) !== 1) {
      throw new Error("the waiting section has no expanded card under its label");
    }
    const described = (await waiting.locator(".approval-card__description").textContent())?.trim();
    if (described !== ASK) {
      throw new Error(`the waiting card reads "${described}", not the proposed "${ASK}"`);
    }
    const text = await screen(page).innerText();
    if (text.includes("$")) {
      throw new Error(`the session screen carries a money figure: ${text.slice(0, 200)}`);
    }
    console.log(`1440 — "${session.title}", ${pill}, "${WAITING}" + card, no "$"`);

    // ---- 2. the tool call: closed, then the arguments -------------------------------------------------
    const details = page.locator("details.agent-session-screen__tool").first();
    await details.waitFor({ timeout: 15_000 });
    if ((await details.getAttribute("open")) !== null) {
      throw new Error(
        "the tool call is already expanded — the collapsed line is the resting state",
      );
    }
    await details.locator("summary").click();
    if ((await details.getAttribute("open")) === null) {
      throw new Error("clicking the summary did not open the tool call");
    }
    const pre = (await details.locator("pre").textContent()) ?? "";
    const expected = JSON.stringify(TOOL_ARGS, null, 2);
    if (pre !== expected) {
      throw new Error(
        `the expanded body reads ${JSON.stringify(pre)}, not ${JSON.stringify(expected)}`,
      );
    }
    console.log(`1440 — one tool call opens onto its ${Object.keys(TOOL_ARGS).length} arguments`);
    await assertNoOverflowAt(page, "1440 blocked session");
    await page.screenshot({ path: join(OUT, "1440.png") });

    // ---- 3. 390: the same session in the sheet --------------------------------------------------
    // A resize of the same page rather than a second one: the sheet is the same pane at a narrow
    // tier, so the header and the queue are the same nodes and only the frame around them changes.
    console.log("390 — the sheet");
    await page.setViewportSize(PHONE);
    await page.locator(".session-header").waitFor({ timeout: 15_000 });
    // The shell swaps the channel rail for the BottomBar below the narrow breakpoint, and the swap
    // lands in a React pass *after* the viewport changes: measured in that gap, the overflow scan
    // still finds the 1440 rail laid out 118.8px past the 390 viewport and reports an element that
    // is one frame from being unmounted. Waiting for the BottomBar is waiting on positive evidence
    // that the narrow tier is in, rather than on a duration that happens to be long enough today.
    await page.locator(".bottom-bar").waitFor({ timeout: 15_000 });
    if ((await waiting.getByText(WAITING).count()) !== 1) {
      throw new Error("the waiting section is gone at 390");
    }
    await assertNoOverflowAt(page, "390 blocked session");
    await page.screenshot({ path: join(OUT, "390.png") });

    // ---- 4. the running session is never an empty pane ---------------------------------------------
    // Back to the wide tier, where the list and the pane are two columns: there is no sheet to
    // dismiss, and the row below replaces the open session rather than stacking under it.
    await page.setViewportSize(WIDE);
    await page.locator(".channel-rail").waitFor({ timeout: 15_000 });
    const workingRow = page.locator(`.inbox-row[data-thread-id="${workingId}"]`).first();
    await workingRow.click();
    await page.locator(".session-header").waitFor({ timeout: 30_000 });

    const workingText = (await screen(page).innerText()).trim();
    if (workingText.length === 0) {
      throw new Error("the running session's pane is empty");
    }
    // The brief's "or a timeline": a session that *did* report something shows its items instead, so
    // the check is that the pane says one of the two, never nothing at all.
    const saysWorking = workingText.includes(WORKING);
    const timeline = await screen(page)
      .locator(
        ".agent-session-screen__turn, .agent-session-screen__system-log, details.agent-session-screen__tool",
      )
      .count();
    if (!saysWorking && timeline === 0) {
      throw new Error(
        `the running session's pane says neither "${WORKING}" nor a timeline: ${workingText}`,
      );
    }
    console.log(
      `1440 — "${WORKING_TITLE}": ${saysWorking ? `"${WORKING}"` : `${timeline} timeline item(s)`}`,
    );

    // ---- 5. the pulse, and the one thing reduced motion does to it ----------------------------------
    // The dot only exists in the working state, so this is the same screen as above — and the
    // full-motion reading is taken first: a `none` that was always there would pass a one-sided
    // check, and the pulse is the only animation this story adds.
    const dot = screen(page).locator(".agent-session-screen__empty-dot");
    await dot.waitFor({ timeout: 15_000 });
    const animationName = async (): Promise<string> =>
      dot.evaluate((el) => getComputedStyle(el).animationName);
    const full = await animationName();
    if (full !== "agent-session-working") {
      throw new Error(`the working dot's animation is "${full}" at full motion, not the pulse`);
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    const reduced = await animationName();
    if (reduced !== "none") {
      throw new Error(
        `the working dot still runs "${reduced}" under prefers-reduced-motion: reduce`,
      );
    }
    console.log(`  the dot is "${full}" at full motion and "${reduced}" under reduce`);
    await page.emulateMedia({ reducedMotion: "no-preference" });

    // ---- the narrow sweep ---------------------------------------------------------------------------
    // SKILLS.md #11: no horizontal scroll at any of the four narrow widths. The header is the one
    // thing this story adds above the timeline that cannot wrap — a long cwd, a long title and a
    // pill on one line — so the sweep is the check that its ellipsis holds rather than pushing the
    // pane wide.
    console.log(`no-overflow sweep at ${SWEEP.join(", ")}`);
    for (const width of SWEEP) {
      await page.setViewportSize({ width, height: PHONE.height });
      await page.waitForTimeout(300);
      const overflow = await page.evaluate(measureOverflow);
      console.log(`  ${width}px: ${describeOverflow(overflow)}`);
      if (overflow.diff > 0) {
        throw new Error(
          `horizontal scroll at ${width}: the body is ${overflow.diff}px wider than the viewport`,
        );
      }
    }

    await page.close();
    console.log("loop-r1-07 shots written to", OUT);
  } finally {
    await browser.close();
    await pool.end();
  }
}

await main();
