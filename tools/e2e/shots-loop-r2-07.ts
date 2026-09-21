// loop-r2-07 evidence: what an agent session's pane says about the thing it is waiting on, and the
// omnis mark on the rows and the thread header — against the live stack rather than a mock.
//
// Why this cannot be an RTL test: every claim below is about the *link between two rows the seed
// wrote*. "The pane shows what its own row shows" is a fact about a session's items and the row
// above it agreeing; "Blocked says why" is a fact about an approval whose `thread_id` points at the
// asking session's thread, which is what apps/hub/src/bridge.ts's `onApprovalRequested` writes and
// what tools/e2e/shots.ts's densify() now seeds too. A stubbed query can assert the sentence; only
// the real stack can assert that the sentence is *true of the row next to it*.
//
// Run against a stack that is already up (this script boots none of its own — it is the same live
// app a person is looking at, and it must have been started *after* the densify() change, or the
// invoice approval is still filed under somebody else's thread):
//   OMNIS_E2E_DB=omnis_test_loop_r2_impl OMNIS_E2E_PORT_OFFSET=500 ZERO_SHARD_NUM=12 \
//     pnpm tsx tools/e2e/hold.ts --web
//   pnpm tsx tools/e2e/shots-loop-r2-07.ts   (desktop http://127.0.0.1:5673)
//
// Six checks, in the order a person hits them:
//   1. "Invoice reissue reply" (waiting_approval, linked approval): the section reads "Waiting for
//      your approval" and the card under it is the invoice question — the case that used to say
//      "Blocked · nothing to decide here yet" over its own approval.
//   2. "claude_code · inbox-draft" (waiting_approval, nothing linked): the pane's last paragraph is
//      the blocked note naming the runtime's host — after "✓ Turn completed", never before it.
//   3. "Drafting 3 inbox replies" (running): the pane carries the session's own `message` item,
//      which is the text its row summarises it with. It used to say "Working · no output yet".
//   4. The "omnis" row's avatar is the omnis mark (an <img>) with no monogram in it.
//   5. Settings reads the omnis account as "Built in", not "Connected".
//   6. No horizontal scroll at 1440, 390 and 320 — both as the brief spells it
//      (`documentElement.scrollWidth <= innerWidth`) and through the shared element scan, which is
//      the reading that survives a stylesheet pinning the first one.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Page, chromium } from "@playwright/test";
import { Pool, one } from "../../packages/db/src/index.js";
import { assertNoOverflow, describeOverflow, measureOverflow } from "./overflow.js";
import { REPO_ROOT, loadOrCreateEnv } from "./stack.js";

const BASE = process.env.OMNIS_SHOTS_URL ?? "http://127.0.0.1:5673";
const OUT = join(REPO_ROOT, "docs/design/loop/r2/impl/loop-r2-07");

const WIDE = { width: 1440, height: 900 } as const;
/** The brief's 390x844, without `isMobile` — the same way the other shot tools take a narrow pass. */
const PHONE = { width: 390, height: 844 } as const;
const NARROW = [390, 320] as const;

const INVOICE_TITLE = "Invoice reissue reply";
const BLOCKED_TITLE = "claude_code · inbox-draft";
const WORKING_TITLE = "Drafting 3 inbox replies";

/** The copy this script asserts on, spelled once so a reworded line fails the check rather than
 *  quietly passing it. */
const WAITING = "Waiting for your approval";
const BLOCKED = "No approval is waiting in omnis";
const WORKING_EMPTY = "Working · no output yet";
const BUILT_IN = "Built in";
/** The approval's own words, matched case-insensitively — the seeded description carries the phrase
 *  mid-sentence ("Answer the invoice reissue request …"), and the card is supposed to show it. */
const INVOICE = "invoice reissue";

/** The session screen itself, wherever the shell has put it — a pane column at 1440, a sheet at 390. */
const screen = (page: Page) => page.locator(".agent-session-screen");

interface SessionFacts {
  threadId: string;
  summary: string | null;
  state: string;
  runtime: string;
  host: string;
}

/** The session's facts read from the database rather than clicked for: a row found by its visible
 *  title is a locator that breaks on a rewording, and this fixture is written by the seed, not by
 *  the screen. A missing row is an error here rather than an undefined later. */
async function sessionByTitle(pool: Pool, title: string): Promise<SessionFacts> {
  const row = await one<{
    thread_id: string;
    summary: string | null;
    state: string;
    runtime: string;
    host: string;
  }>(
    pool,
    `SELECT s.thread_id, s.summary, s.state, r.runtime, r.host
       FROM agent_sessions s
       JOIN threads t ON t.id = s.thread_id
       JOIN agent_runtimes r ON r.id = s.runtime_id
      WHERE t.kind = 'agent_session' AND t.title = $1`,
    [title],
  );
  return {
    threadId: row.thread_id,
    summary: row.summary,
    state: row.state,
    runtime: row.runtime,
    host: row.host,
  };
}

/** The session's latest `message` item — the body its inbox row summarises it with, and the one the
 *  pane is supposed to draw as a turn. */
async function latestMessage(pool: Pool, threadId: string): Promise<string> {
  const row = await one<{ body: string }>(
    pool,
    `SELECT body FROM items
      WHERE thread_id = $1 AND kind = 'message'
      ORDER BY sent_at DESC LIMIT 1`,
    [threadId],
  );
  return row.body;
}

/** The pending approval the pane should be showing for this session — the link densify() writes. */
async function linkedApproval(pool: Pool, threadId: string): Promise<string> {
  const row = await one<{ description: string }>(
    pool,
    "SELECT description FROM pending_approvals WHERE thread_id = $1 AND state = 'pending'",
    [threadId],
  );
  return row.description;
}

/** omnis's own thread — the system account's. It is created by the hub's cost_daily job on the
 *  first scheduler tick, so a stack that has not ticked yet has no row to check. */
async function omnisThread(pool: Pool): Promise<string> {
  const row = await one<{ id: string }>(
    pool,
    `SELECT t.id FROM threads t JOIN accounts a ON a.id = t.account_id
      WHERE a.channel = 'system' AND t.kind = 'system'
      ORDER BY t.created_at LIMIT 1`,
  );
  return row.id;
}

/** The brief's own overflow reading, verbatim: `documentElement.scrollWidth <= innerWidth`. The
 *  shared probe below is the stronger one (a stylesheet can pin this to 0 and it has before), so
 *  both are taken and neither replaces the other. */
async function assertDocumentFits(page: Page, label: string): Promise<void> {
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  if (!fits) {
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    throw new Error(`${label}: documentElement.scrollWidth is ${String(over)}px past innerWidth`);
  }
}

async function assertNoOverflowAt(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(measureOverflow);
  console.log(`  ${label}: ${describeOverflow(overflow)}`);
  assertNoOverflow(label, overflow);
  await assertDocumentFits(page, label);
}

/** Opens an agent session from the Agents tab and waits for its header. */
async function openSession(page: Page, threadId: string): Promise<void> {
  await page.getByRole("radio", { name: "Agents" }).click();
  const row = page.locator(`.inbox-row[data-thread-id="${threadId}"]`).first();
  await row.waitFor({ timeout: 30_000 });
  await row.click();
  await page.locator(".session-header").waitFor({ timeout: 30_000 });
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  // tools/e2e/.env keeps whichever database the *first* stack in this worktree used, and the port
  // offset cannot tell us the database name — without this guard the browser would talk to the stack
  // on :5673 while the reads below land in another database.
  if (process.env.OMNIS_E2E_DB === undefined) {
    throw new Error("OMNIS_E2E_DB must name the running stack's database (see the header)");
  }
  const env = loadOrCreateEnv();
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });
  const browser = await chromium.launch();

  try {
    const invoice = await sessionByTitle(pool, INVOICE_TITLE);
    const blocked = await sessionByTitle(pool, BLOCKED_TITLE);
    const working = await sessionByTitle(pool, WORKING_TITLE);
    if (invoice.state !== "waiting_approval") {
      throw new Error(`"${INVOICE_TITLE}" is ${invoice.state}, not waiting_approval`);
    }
    if (blocked.state !== "waiting_approval") {
      throw new Error(`"${BLOCKED_TITLE}" is ${blocked.state}, not waiting_approval`);
    }
    const ask = await linkedApproval(pool, invoice.threadId);
    const asked = await latestMessage(pool, invoice.threadId);
    const message = await latestMessage(pool, working.threadId);
    const omnisId = await omnisThread(pool);
    console.log(
      `invoice ${invoice.threadId} ("${ask}"); blocked ${blocked.threadId}; omnis row ${omnisId}`,
    );

    const page = await browser.newPage({ viewport: WIDE });
    await page.goto(BASE);
    await page.waitForSelector(".inbox-row", { timeout: 60_000 });

    // ---- 1. a session waiting on an approval omnis is holding -------------------------------------
    await openSession(page, invoice.threadId);
    const waiting = page.locator(".agent-session-screen__waiting");
    await waiting.getByText(WAITING).waitFor({ timeout: 30_000 });
    if ((await waiting.locator(".approval-card").count()) !== 1) {
      throw new Error("the waiting section has no expanded card under its label");
    }
    const described = (await waiting.locator(".approval-card__description").textContent())?.trim();
    if (described !== ask.trim()) {
      throw new Error(`the waiting card reads "${String(described)}", not the proposed "${ask}"`);
    }
    if (!described.toLowerCase().includes(INVOICE)) {
      throw new Error(`the waiting card does not name the invoice request: "${described}"`);
    }
    // The whole point of the story: the pane no longer claims there is nothing to decide while its
    // own card sits above the line.
    if ((await screen(page).getByText("nothing to decide here yet").count()) !== 0) {
      throw new Error('the pane still says "nothing to decide here yet"');
    }
    // The session's own message is a turn now, so the pane carries the line its row does. (Read off
    // the items rather than the session's `summary` column: the pane renders items, and the two are
    // the same text only because the row's summary *is* this message — which is the point being
    // checked, so the check would be circular if it asked the summary column.)
    if ((await screen(page).getByText(asked).count()) !== 1) {
      throw new Error(`the pane does not carry the session's own line "${asked}"`);
    }
    await assertNoOverflowAt(page, "1440 invoice session");
    await page.screenshot({ path: join(OUT, "1440.png") });
    console.log(`1440 — "${INVOICE_TITLE}": "${WAITING}" + the invoice card`);
    await page.close();

    // ---- 2. a session blocked on something omnis cannot see ---------------------------------------
    const second = await browser.newPage({ viewport: WIDE });
    await second.goto(BASE);
    await second.waitForSelector(".inbox-row", { timeout: 60_000 });
    await openSession(second, blocked.threadId);
    const blockedText = (await screen(second).innerText()).trim();
    if (!blockedText.includes(BLOCKED)) {
      throw new Error(`the blocked pane does not say "${BLOCKED}": ${blockedText}`);
    }
    // The reason is the *last* paragraph, so a transcript that ends in "✓ Turn completed" is
    // followed by the answer rather than leaving the log as the last word.
    const lastParagraph = (await screen(second).locator("p").last().textContent())?.trim() ?? "";
    if (!lastParagraph.includes(BLOCKED)) {
      throw new Error(`the pane's last paragraph is "${lastParagraph}", not the blocked note`);
    }
    if (!lastParagraph.startsWith("Blocked ·")) {
      throw new Error(`the blocked note does not open with "Blocked ·": "${lastParagraph}"`);
    }
    if (blocked.summary !== null && blocked.summary.trim() !== "") {
      if (!lastParagraph.includes(blocked.summary.trim())) {
        throw new Error(`the note drops the session's summary "${blocked.summary}"`);
      }
    }
    // The runtime and the host are the two facts a person needs to go and look; the host is the
    // one that is read off the DB here, so a stale runtime line fails this rather than passing.
    if (!lastParagraph.includes(` on ${blocked.host}.`)) {
      throw new Error(`the note does not name ${blocked.host}: "${lastParagraph}"`);
    }
    // The note is under the transcript, so the transcript has to be there to be under.
    if ((await screen(second).locator(".agent-session-screen__system-log").count()) === 0) {
      throw new Error("the blocked session has no transcript for the note to follow");
    }
    console.log(`1440 — "${BLOCKED_TITLE}": the note is the last paragraph, after the transcript`);
    await second.close();

    // ---- 3. a running session shows what it is doing ---------------------------------------------
    const third = await browser.newPage({ viewport: WIDE });
    await third.goto(BASE);
    await third.waitForSelector(".inbox-row", { timeout: 60_000 });
    await openSession(third, working.threadId);
    const workingText = (await screen(third).innerText()).trim();
    if (!workingText.includes(message)) {
      throw new Error(
        `the running pane does not carry its own message "${message}": ${workingText}`,
      );
    }
    if (workingText.includes(WORKING_EMPTY)) {
      throw new Error(`the running pane still says "${WORKING_EMPTY}" over its own message`);
    }
    console.log(`1440 — "${WORKING_TITLE}": the pane carries "${message}"`);

    // ---- 4. the omnis row wears the omnis mark ----------------------------------------------------
    // Back to the unfiltered list: the omnis thread is a system row, not a session, so the Agents
    // tab has nothing to show for it.
    await third.getByRole("radio", { name: "All" }).click();
    const omnisRow = third.locator(`.inbox-row[data-thread-id="${omnisId}"]`).first();
    await omnisRow.waitFor({ timeout: 30_000 });
    const omnisAvatar = omnisRow.locator(".inbox-row__avatar");
    if ((await omnisAvatar.getAttribute("class"))?.includes("inbox-row__avatar--omnis") !== true) {
      throw new Error("the omnis row's avatar is not the omnis mark");
    }
    if ((await omnisAvatar.locator("img").count()) !== 1) {
      throw new Error("the omnis row's avatar draws no mark");
    }
    const monogram = (await omnisAvatar.textContent())?.trim() ?? "";
    if (monogram !== "") {
      throw new Error(`the omnis row's avatar still draws a monogram: "${monogram}"`);
    }
    console.log(`1440 — the omnis row's avatar is the mark, with no "${monogram}" monogram`);
    await assertNoOverflowAt(third, "1440 inbox");
    await third.close();

    // ---- 5. Settings: omnis is not an account you connected ---------------------------------------
    // Through the shell's own route (?screen=settings), the way the w4b Settings shots reach it.
    const fourth = await browser.newPage({ viewport: WIDE });
    await fourth.goto(`${BASE}/?screen=settings`);
    await fourth.waitForSelector('.settings-screen[data-state="ready"]', { timeout: 60_000 });
    const accountRow = fourth.locator(".settings-screen__account", { hasText: "omnis" }).first();
    await accountRow.waitFor({ timeout: 30_000 });
    const pill = (await accountRow.locator(".status-pill").textContent())?.trim() ?? "";
    if (pill !== BUILT_IN) {
      throw new Error(`the omnis account reads "${pill}", not "${BUILT_IN}"`);
    }
    if ((await accountRow.locator('.status-pill[data-tone="neutral"]').count()) !== 1) {
      throw new Error(`the omnis account's "${pill}" pill is not on the neutral tone`);
    }
    console.log(`Settings — the omnis account reads "${BUILT_IN}" on the neutral tone`);

    // ---- 6. the narrow tiers, and the Inbox at 390 -------------------------------------------------
    // A fresh load at 390 rather than a resize: the wide page above has a session open, and a
    // resize would turn that pane into a sheet over the list the screenshot is of.
    await fourth.setViewportSize(PHONE);
    await fourth.goto(BASE);
    await fourth.waitForSelector(".inbox-row", { timeout: 60_000 });
    // The shell swaps the channel rail for the BottomBar below the narrow breakpoint, and the swap
    // lands in a React pass *after* the viewport changes — waiting for it is waiting on positive
    // evidence that the narrow tier is in (the same reason shots-loop-r1-07 waits for it).
    await fourth.locator(".bottom-bar").waitFor({ timeout: 30_000 });
    const narrowOmnis = fourth.locator(`.inbox-row[data-thread-id="${omnisId}"]`).first();
    await narrowOmnis.waitFor({ timeout: 30_000 });
    // Centre it: the point of the shot is the mark *and* the agent rows around it, and the
    // virtualiser only keeps the rows near the viewport mounted.
    await narrowOmnis.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await fourth.waitForTimeout(300);
    if ((await narrowOmnis.locator(".inbox-row__avatar--omnis img").count()) !== 1) {
      throw new Error("the omnis row's mark is gone at 390");
    }
    if ((await fourth.locator(".inbox-row:has(.status-badge--agent)").count()) === 0) {
      throw new Error("no agent session row is on screen beside the omnis row at 390");
    }
    await assertNoOverflowAt(fourth, "390 inbox");
    await fourth.screenshot({ path: join(OUT, "390.png") });

    for (const width of NARROW) {
      await fourth.setViewportSize({ width, height: PHONE.height });
      await fourth.waitForTimeout(300);
      await assertNoOverflowAt(fourth, `${width} inbox`);
    }

    await fourth.close();
    console.log("loop-r2-07 shots written to", OUT);
  } finally {
    await browser.close();
    await pool.end();
  }
}

await main();
