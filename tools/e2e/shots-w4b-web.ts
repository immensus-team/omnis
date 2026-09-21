// US-B35 (apps/web PWA shell) screenshots: docs/design/screens/w4b/inbox-{1440,390}.png.
//
// Same stack as the other w4b shot tools, with `startWeb()` instead of `startDesktop()` — the PWA
// has its own dev server — plus a horizontal-overflow sweep over docs/design/SKILLS.md's four
// slop-test widths (320/375/414/768), the gate that fails the task if a scrollbar appears at any one.
//
// What the frames are of:
//   - The Inbox tab is the shell's landing screen and the one body this task builds (the other four
//     are the plan's own open question). A shell photographed on an empty tab would be a picture of
//     a placeholder, which is what these frames exist to rule out, so both are of the list over the
//     run's seeded rows, with `data-state="ready"` asserted first.
//   - 390 is the phone frame and keeps A5 §4.5's install card up: it is a shipped element of this
//     screen and a browser is exactly where it belongs, and it is the phone that installs. 1440
//     dismisses it through the card's own "Got it", so the wide frame is the list and the chrome
//     rather than the same card twice.
//   - Neither frame is asserted against a string this script typed. The expected rows are read back
//     out of `items`/`threads`/`persons` after the seed and compared to what the DOM drew, so a
//     screen that invents a row fails the run instead of reaching a PNG.
//
// Run: pnpm tsx tools/e2e/shots-w4b-web.ts   (same ports as the e2e smoke — never run both at once)
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Browser, type Page, chromium } from "@playwright/test";
import { Pool, query } from "../../packages/db/src/index.js";
import { assertNoOverflow, describeOverflow, measureOverflow } from "./overflow.js";
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
  startHub,
  startWeb,
  startZeroCache,
  stopAll,
  waitForHttp,
} from "./stack.js";

const OUT = join(REPO_ROOT, "docs/design/screens/w4b");
const URL = `http://127.0.0.1:${String(VITE_PORT)}/`;

/** The list the PWA should draw: `items` minus archived, newest first, one row per thread — the same
 *  reading apps/web/src/screens/Inbox.tsx's query and `toInboxRows` take, spelled in SQL so the
 *  expectation comes from the database rather than from the screen. */
interface Expected {
  rows: string[];
  approvalThreadIds: Set<string>;
  sessionThreadIds: Set<string>;
}

async function readBack(pool: Pool): Promise<Expected> {
  const ordered = await query<{ thread_id: string; name: string }>(
    pool,
    `SELECT i.thread_id, COALESCE(p.display_name, t.title, a.channel) AS name
       FROM items i
       JOIN threads t ON t.id = i.thread_id
       JOIN accounts a ON a.id = i.account_id
       LEFT JOIN persons p ON p.id = i.author_person_id
      WHERE i.status <> 'archived'
      ORDER BY i.sent_at DESC
      LIMIT 60`,
  );
  const seen = new Set<string>();
  const rows: string[] = [];
  for (const row of ordered) {
    if (seen.has(row.thread_id)) continue;
    seen.add(row.thread_id);
    rows.push(row.name);
  }
  const approvals = await query<{ thread_id: string | null }>(
    pool,
    "SELECT thread_id FROM pending_approvals WHERE state = 'pending'",
  );
  const sessions = await query<{ thread_id: string }>(
    pool,
    `SELECT s.thread_id FROM agent_sessions s
       JOIN threads t ON t.id = s.thread_id
      WHERE t.kind = 'agent_session'`,
  );
  return {
    rows,
    approvalThreadIds: new Set(
      approvals.map((a) => a.thread_id).filter((id): id is string => id !== null),
    ),
    sessionThreadIds: new Set(sessions.map((s) => s.thread_id)),
  };
}

/** The names the list actually drew, in DOM order (the screen draws no id attribute, and the name is
 *  the one string a person reads off the row). */
async function drawnNames(page: Page): Promise<string[]> {
  const names = await page.locator('[role="option"] .inbox-row__name').allTextContents();
  return names.map((n) => n.trim());
}

/** The row count is also the de-duplication check: one row per thread, whatever the item count. */
function assertRows(where: string, expected: Expected, drawn: string[]): void {
  if (drawn.length !== expected.rows.length) {
    throw new Error(
      `${where}: the list drew ${String(drawn.length)} rows but the database has ${String(expected.rows.length)} non-archived threads in the 60-item window`,
    );
  }
  for (const [i, name] of expected.rows.entries()) {
    if (drawn[i] !== name) {
      throw new Error(
        `${where}: row ${String(i + 1)} reads "${drawn[i] ?? "(missing)"}" but the database says "${name}"`,
      );
    }
  }
}

/** A pending approval and an agent session both have to be on the screen for the frame to be of a
 *  finished Inbox: A5 §3.1 makes the approval dot the row's whole reason to be tappable, and the
 *  runtime avatar is what distinguishes a session from a message. */
async function assertRowMarks(page: Page, expected: Expected): Promise<void> {
  if (expected.approvalThreadIds.size > 0) {
    const dots = await page
      .locator('.inbox-row__approval-dot[aria-label="Pending approval"]')
      .count();
    if (dots === 0) {
      throw new Error("no row carries the pending-approval dot, but pending_approvals has rows");
    }
  }
  if (expected.sessionThreadIds.size > 0) {
    const avatars = await page.locator(".inbox-row__avatar--runtime").count();
    if (avatars === 0) {
      throw new Error("no row carries a runtime avatar, but agent_sessions has rows");
    }
  }
}

/** Opens the PWA and waits for the list to be loaded — `data-state` is the contract the screen puts
 *  on its surface for exactly this (see the Inbox screen's comment). */
async function openInbox(page: Page, expected: Expected): Promise<void> {
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  try {
    await page.waitForSelector('.pwa-inbox[data-state="ready"]', { timeout: 60_000 });
  } catch {
    const state = await page.locator(".pwa-inbox").getAttribute("data-state");
    throw new Error(`the inbox never reached data-state="ready" (it is "${state ?? "(absent)"}")`);
  }
  assertRows("inbox", expected, await drawnNames(page));
  await assertRowMarks(page, expected);
}

/** HIG (mobile): a control's default size is 44x44pt, its minimum 28. Tap-target size is the one
 *  thing a screenshot cannot show, so it is measured on the phone frame instead — and it is the check
 *  that keeps @omnis/ui's desktop-sized Button (14px text, 6px padding) honest where the shell has to
 *  grow it to the phone's default. */
const MIN_TAP_TARGET = 44;

async function assertTapTargets(page: Page): Promise<void> {
  const probes: [string, string][] = [
    ["the install card's Got it", ".install-card__dismiss"],
    ["a tab slot", ".tab-bar__tab"],
    ["an inbox row", '[role="option"]'],
  ];
  const measured: string[] = [];
  for (const [label, selector] of probes) {
    const box = await page.locator(selector).first().boundingBox();
    if (box === null) throw new Error(`${label} (${selector}) is not on the frame`);
    measured.push(`${label} ${box.height.toFixed(1)}px`);
    if (box.height < MIN_TAP_TARGET) {
      throw new Error(
        `${label} is ${box.height.toFixed(1)}px tall at this width — under the ${String(MIN_TAP_TARGET)}px mobile default (${selector})`,
      );
    }
  }
  // The numbers, not just the pass: a target that shrinks to 44.0 exactly is one CSS edit away from
  // being under the line, and the log is where that shows up before a person's thumb finds it.
  console.log(`  tap targets at ${String(page.viewportSize()?.width)}px — ${measured.join(", ")}`);
}

/** One frame plus the overflow reading, as every other shot tool takes it. */
async function shoot(page: Page, label: string): Promise<void> {
  // The pointer was left wherever the last click put it, and a row under it draws its hover card —
  // real behaviour, but in a design frame it is an accident, not evidence.
  await page.mouse.move(0, 0);
  await page.waitForTimeout(700);
  const overflow = await page.evaluate(measureOverflow);
  assertNoOverflow(`inbox at ${label}px`, overflow);
  console.log(`  inbox-${label}.png — ${describeOverflow(overflow)}`);
  await page.screenshot({ path: join(OUT, `inbox-${label}.png`) });
}

/** SKILLS.md's slop-test gate: a horizontal scrollbar at even one of these widths fails the task, and
 *  the two frames are only 1440 and 390 — so the four are measured with no frame written. The page is
 *  resized rather than reloaded: the shell is a grid that has to survive the width it is given. */
const SWEEP_WIDTHS = [320, 375, 414, 768];

async function sweep(browser: Browser, expected: Expected): Promise<void> {
  const page = await browser.newPage({ viewport: { width: SWEEP_WIDTHS[0], height: 800 } });
  try {
    await openInbox(page, expected);
    for (const width of SWEEP_WIDTHS) {
      await page.setViewportSize({ width, height: 800 });
      const overflow = await page.evaluate(measureOverflow);
      assertNoOverflow(`inbox at ${String(width)}px`, overflow);
      console.log(`  ${String(width)}px — ${describeOverflow(overflow)}`);
    }
  } finally {
    await page.close();
  }
}

async function pass(
  browser: Browser,
  label: string,
  size: { width: number; height: number },
  expected: Expected,
  dismissInstallGuide: boolean,
): Promise<void> {
  const page = await browser.newPage({ viewport: size });
  try {
    await openInbox(page, expected);
    if (dismissInstallGuide) {
      // The card's own control, not a hidden element removal: if the button stops dismissing it, the
      // frame should fail rather than quietly photograph the card twice.
      await page.getByRole("button", { name: "Got it" }).click();
      await page.waitForSelector(".install-card", { state: "detached", timeout: 5_000 });
    } else {
      // The card is up and carries its three steps — the phone frame is of the install path, not just
      // of the list under a heading.
      await page.waitForSelector(".install-card__step", { timeout: 5_000 });
    }
    if (size.width <= 480) await assertTapTargets(page);
    await shoot(page, label);
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
  startWeb();
  await waitForHttp(URL, 90_000);

  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 4 });
  let closeBridge: (() => void) | undefined;
  try {
    const seeded = await seed(pool, env);
    closeBridge = seeded.closeBridge;
    const expected = await readBack(pool);
    console.log(
      `inbox seeded: ${String(expected.rows.length)} threads — ${String(expected.approvalThreadIds.size)} with a pending approval, ${String(expected.sessionThreadIds.size)} agent sessions`,
    );
    if (expected.rows.length === 0) {
      throw new Error("the seed produced no non-archived items — there is nothing to photograph");
    }

    mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch();
    try {
      await pass(browser, "1440", { width: 1440, height: 900 }, expected, true);
      await pass(browser, "390", { width: 390, height: 844 }, expected, false);
      await sweep(browser, expected);
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
