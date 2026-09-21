// US-B27 (⌘K search mode) screenshots: docs/design/screens/w4b/search-{1440,390}.png.
//
// Same stack, same pristine e2e seed and the same two sizes as shots-accent.ts (1440x900 and
// 390x844), so the frames sit next to the accent set and differ only in the state. This story adds
// no fixture of its own — the rows in the panel are the seed's own mail and calendar copy.
//
// What it shoots: the ask bar carrying a query that matches no action. That is the only way into
// search mode (A5 §2.5), and it is what makes the panel's second tab switch from the command list
// to the hub's results. Before any pixel is shot the same query is asked of the hub directly —
// a screenshot of an empty result list is evidence of nothing.
//
// Run: pnpm tsx tools/e2e/shots-w4b.ts   (same ports as the e2e smoke — never run both at once)
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Browser, type Page, chromium } from "@playwright/test";
import { Pool } from "../../packages/db/src/index.js";
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
/** Matches no action — "Go to Inbox" is the only one the shell registers — and does hit the seed's
 *  mail and calendar copy ("omnis launch sync"). */
const QUERY = "omnis launch";
const ASK_INPUT = ".ask-bar input";

/** One frame plus the horizontal-overflow reading. The page-wide scroll (reading 1) is asserted;
 *  the element scan is printed, since a floating panel legitimately reaches past the viewport edge
 *  at 390 when a hover card is left open (shots-accent.ts's note). */
async function shoot(page: Page, label: string): Promise<void> {
  await page.waitForTimeout(700);
  const file = join(OUT, `search-${label}.png`);
  await page.screenshot({ path: file });
  const overflow = await page.evaluate(measureOverflow);
  console.log(`  search-${label}.png — ${describeOverflow(overflow)}`);
  if (overflow.diff > 0) {
    throw new Error(`the page scrolls sideways at ${label}px: ${describeOverflow(overflow)}`);
  }
}

/** Type the query into the ask bar and wait for the panel's own search rows — not for a timeout: a
 *  sleep long enough for the 180ms debounce and the request is also long enough to look settled
 *  while the request never happened. */
async function search(page: Page): Promise<void> {
  await page.locator(ASK_INPUT).click();
  await page.waitForSelector(".ask-panel", { timeout: 10_000 });
  await page.locator(ASK_INPUT).pressSequentially(QUERY, { delay: 25 });
  await page.waitForSelector(".palette-search__title", { timeout: 15_000 });
  // The tab has to say what the list under it is (US-B27): the switch is part of the frame.
  await page.getByRole("button", { name: "Search" }).waitFor({ timeout: 5_000 });
}

/** 1440x900 — the three-pane shell, the seed's one pending approval in the detail pane, and the
 *  search results in the panel under the ask bar. */
async function widePass(browser: Browser): Promise<void> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.goto(`http://127.0.0.1:${String(VITE_PORT)}/`);
    await page.waitForSelector(".inbox-row", { timeout: 60_000 });
    await page.waitForTimeout(2000);
    await search(page);
    await shoot(page, "1440");
  } finally {
    await page.close();
  }
}

/** 390x844 — one column and the bottom bar. The seed's pending approval makes App.tsx render the
 *  detail pane, and below the 900px shell breakpoint that pane is a fixed sheet over everything
 *  (z-index 20 against the ask panel's 5): with the queue uncleared there is no ask bar to type
 *  into at all. Ignore is the decision that empties the queue without sending anything
 *  (shots-accent.ts's clearQueue). */
async function narrowPass(browser: Browser): Promise<void> {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await page.goto(`http://127.0.0.1:${String(VITE_PORT)}/`);
    await page.waitForSelector(".inbox-row", { timeout: 60_000 });
    await page.waitForTimeout(2000);
    await page.getByRole("button", { name: "Ignore" }).click();
    await page
      .locator('[data-testid="detail-pane"]')
      .waitFor({ state: "detached", timeout: 15_000 });
    await search(page);
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
  await waitForHttp(`http://127.0.0.1:${ZERO_PORT}/`, 90_000);
  startHub(env);
  await waitForHttp(`http://127.0.0.1:${HUB_PORT}/health`, 60_000);
  startDesktop();
  await waitForHttp(`http://127.0.0.1:${VITE_PORT}/`, 90_000);

  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 4 });
  let closeBridge: (() => void) | undefined;
  try {
    const seeded = await seed(pool, env);
    closeBridge = seeded.closeBridge;

    // What the panel will show, asked of the hub before the browser is even open.
    const probe = (await (
      await fetch(`http://127.0.0.1:${HUB_PORT}/search?q=${encodeURIComponent(QUERY)}`)
    ).json()) as { groups: { kind: string; total: number; results: unknown[] }[] };
    const counts = probe.groups.map((g) => `${g.kind}=${g.total}`).join(" ");
    console.log(`GET /search?q=${QUERY} -> ${counts}`);
    if (!probe.groups.some((g) => g.results.length > 0)) {
      throw new Error(
        `the seed has no hit for "${QUERY}" — the frames would show an empty state instead of results`,
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
