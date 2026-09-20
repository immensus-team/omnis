// US-D02b responsive pass: boots the same e2e stack as shots.ts and re-shoots the inbox at four
// widths, asserting what that story promised — no horizontal overflow anywhere, and the filter row
// staying a single <= 40px strip (the three-stacked-lines chip pile is the bug being locked out).
//
// Two passes, because one set of screenshots cannot do both jobs:
//   {w}.png           unfiltered, over a densified list — the visual record. The defects this
//                     story was opened on (titles wrapping to two lines, the time and brand mark
//                     drifting row to row) are only observable with long titles and several rows
//                     to misalign against, and density against the kinso reference cannot be
//                     judged from one row in an empty card.
//   {w}-filtered.png  one label filter on — the crowded strip. An empty strip has nothing to
//                     scroll, so the 40px assertion would pass even if the row went back to
//                     wrapping; this pass is what actually holds that invariant down.
// Run: pnpm tsx tools/e2e/shots-responsive.ts (same ports as the e2e smoke — never run both).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Page, chromium } from "@playwright/test";
import { Pool, one, query } from "../../packages/db/src/index.js";
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

const OUT = join(REPO_ROOT, "docs/design/screens/responsive");
const WIDTHS = [390, 768, 1024, 1440];
const HEIGHT = 1000;
/** Below the 900px shell breakpoint the rail leaves the grid and becomes a fixed bottom bar. */
const NARROW_WIDTHS = [390, 768];
/** Collapsed rail bar height, from app.css `@container shell (max-width: 899.98px) .channel-rail`.
 *  Measured it that +1px (57): the rule's `height: 56px` is content-box, so `border-top: var(--hairline)`
 *  adds rather than being absorbed — hence the tolerance below instead of an exact match. */
const RAIL_HEIGHT = 56;
/** The filter row must not grow past this — it is one line of controls, not a stack. */
const FILTER_ROW_MAX = 40;
/** --dur-panel is the longest transition on these screens (240ms); 400ms clears it. */
const SETTLE_MS = 400;

/** seed.ts leaves one approval pending (it exercises the real approvals.propose path), and the shell
 *  opens its detail pane whenever an approval is pending — `detail = open !== null ||
 *  approvals.length > 0` in App.tsx. Below 1280px that pane is a fixed sheet *over* the list, and at
 *  390px it covers the viewport, so the panes' clicks land on it and the screenshots stop being
 *  screenshots of the list. This pass is about the list pane, so the seeded approval is closed out
 *  here — the same post-seed fixture adjustment shots.ts does in its own densify(). The row is kept
 *  (state 'expired' + decision 'ignore' satisfies approvals_decided_ck) rather than deleted. */
async function closePendingApprovals(pool: Pool): Promise<void> {
  await query(
    pool,
    `UPDATE pending_approvals SET state = 'expired', decision = 'ignore', decided_at = now()
      WHERE state = 'pending'`,
  );
}

/** The kinso reference is a seven-row list; the seed alone leaves two or three. These rows are the
 *  fixture that makes the screenshots evidence rather than an empty template — deliberately mixed
 *  title lengths, with the first one long enough that it has to ellipsize at every width. Titles
 *  and summaries are what the row renders (Phase A never sets author_person_id, so inboxRowTitle
 *  falls through to threads.title and threadSummary to threads.meta.summary). */
const DENSITY_ROWS: { title: string; summary: string; unread: number }[] = [
  {
    title:
      "Quarterly supplier agreement — Brightstone Realty, revised indemnity clause and signature block",
    summary:
      "Asks you to share the latest sales contract, flagging that two clauses moved since last week's review and that they need a reply by Friday morning.",
    unread: 3,
  },
  {
    title: "Design review moved to Friday 14:00",
    summary: "Wants the calendar hold updated and the Figma link added to the invite.",
    unread: 1,
  },
  {
    title: "Invoice 2291 reissue",
    summary:
      "Billing asks whether to reissue against the new PO number or credit the original invoice first.",
    unread: 0,
  },
  {
    title: "Weekly metrics digest",
    summary: "Shares the weekly numbers; nothing needs a decision, three charts are attached.",
    unread: 0,
  },
  {
    title: "Onboarding checklist for the two new hires starting Monday",
    summary:
      "Lists the accounts to create, the hardware already ordered, and the two approvals still outstanding.",
    unread: 2,
  },
  {
    title: "Office move — loading dock times",
    summary: "Confirms the dock is booked 07:00–09:00 and asks who is on site to sign for it.",
    unread: 0,
  },
];

async function densify(pool: Pool): Promise<void> {
  // Round-robin over the seeded accounts so the brand-mark column has something to align: a list
  // where every row is Gmail says nothing about whether the 20px mark column holds still.
  const accounts = await query<{ id: string }>(
    pool,
    "SELECT id FROM accounts WHERE channel <> 'agent' ORDER BY channel",
  );
  if (accounts.length === 0) throw new Error("no seeded accounts to hang density rows on");

  // Inbox orders by items.sent_at desc, and the seeded calendar fixtures all land on the same
  // "now" — inserting these at now() too leaves their position to whatever order Postgres returns
  // for a tie, which put them below the fold. Anchoring a minute per row above the newest seeded
  // item makes the record deterministic: these rows lead every screenshot.
  const newest = await one<{ at: string }>(pool, "SELECT max(sent_at) AS at FROM items");
  for (const [i, row] of DENSITY_ROWS.entries()) {
    const account = accounts[i % accounts.length];
    if (account === undefined) continue;
    const minutesAbove = String(DENSITY_ROWS.length - i);
    const thread = await one<{ id: string }>(
      pool,
      `INSERT INTO threads (account_id, external_id, kind, title, scope, unread_count, last_item_at, meta)
         VALUES ($1, $2, 'email', $3, 'work', $4, $5::timestamptz + ($6 || ' minutes')::interval,
                 jsonb_build_object('summary', $7::text))
         RETURNING id`,
      [
        account.id,
        `shots-responsive-${i}`,
        row.title,
        row.unread,
        newest.at,
        minutesAbove,
        row.summary,
      ],
    );
    await query(
      pool,
      `INSERT INTO items (thread_id, account_id, kind, status, scope, body, sent_at)
         VALUES ($1, $2, 'message', 'received', 'work', $3, $4::timestamptz + ($5 || ' minutes')::interval)`,
      [thread.id, account.id, row.summary, newest.at, minutesAbove],
    );
  }

  // Three labels on the longest row, so the row's "two chips + N" path is in the record too.
  await query(
    pool,
    `INSERT INTO thread_labels (thread_id, label_id, by)
       SELECT t.id, l.id, 'rule'
         FROM threads t, (SELECT id FROM labels ORDER BY name LIMIT 3) l
        WHERE t.external_id = 'shots-responsive-0'
        ON CONFLICT DO NOTHING`,
  );
}

interface ShotResult {
  width: number;
  overflow: number;
  filterRow: number;
}

/** One sweep of the four widths. `suffix` names the pass in the filename; the assertions are the
 *  same either way, because both passes have to hold the no-overflow and 40px-strip floors. */
async function sweep(page: Page, suffix: string): Promise<ShotResult[]> {
  const results: ShotResult[] = [];
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: HEIGHT });
    await page.waitForTimeout(SETTLE_MS);

    await page.screenshot({ path: join(OUT, `${width}${suffix}.png`) });

    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    const filterRow = await page.evaluate(() => {
      const el = document.querySelector(".inbox-card__filter-row");
      return el === null ? null : el.getBoundingClientRect().height;
    });
    if (filterRow === null) {
      throw new Error(
        `no .inbox-card__filter-row at ${width}px — the filter strip is not rendered`,
      );
    }

    const rail = await page.evaluate(() => {
      const el = document.querySelector(".channel-rail");
      if (el === null) return null;
      const rect = el.getBoundingClientRect();
      return { height: rect.height, bottom: rect.bottom, viewport: window.innerHeight };
    });

    const railPart =
      rail === null
        ? "no .channel-rail found"
        : `rail ${rail.height.toFixed(1)}px tall, ${(rail.viewport - rail.bottom).toFixed(1)}px off the bottom`;
    console.log(
      `[${suffix === "" ? "unfiltered" : "filtered"}] width ${width}: overflow ${over}px, filter row ${filterRow.toFixed(1)}px, ${railPart}`,
    );

    if (over > 0) throw new Error(`horizontal overflow at ${width}px: ${over}px`);
    if (filterRow > FILTER_ROW_MAX) {
      throw new Error(
        `filter row is ${filterRow.toFixed(1)}px tall at ${width}px (max ${FILTER_ROW_MAX}px) — it wrapped instead of scrolling`,
      );
    }
    // Secondary signal: below 900px the rail is a fixed bar pinned to the bottom edge. If the
    // collapsed tier ever stops rendering that way, the screenshots above stop telling the truth
    // long before anything else notices.
    if (NARROW_WIDTHS.includes(width)) {
      if (rail === null) throw new Error(`no .channel-rail at ${width}px`);
      if (rail.height > RAIL_HEIGHT + 16 || Math.abs(rail.viewport - rail.bottom) > 4) {
        throw new Error(
          `rail is not the collapsed bottom bar at ${width}px: ${rail.height.toFixed(1)}px tall, ${(rail.viewport - rail.bottom).toFixed(1)}px off the bottom`,
        );
      }
    }
    results.push({ width, overflow: over, filterRow });
  }
  return results;
}

/** Park the pointer somewhere inert before shooting. Whatever was last clicked leaves the virtual
 *  mouse over a row, which opens that row's hover card — it lands off the left edge at 1440px and
 *  shows up in the screenshot as a stray panel over the rail. The ask bar has no hover-only
 *  affordance, so hovering it changes nothing. */
async function parkPointer(page: Page): Promise<void> {
  await page.mouse.move(400, 34);
  await page.waitForTimeout(400);
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
    await closePendingApprovals(pool);
    await densify(pool);

    mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch();
    // Interact at 1440 first, like shots.ts: the chip popover needs room, and the widths under test
    // are reached by the sweeps below anyway.
    const page = await browser.newPage({ viewport: { width: 1440, height: HEIGHT } });
    await page.goto(`http://127.0.0.1:${VITE_PORT}/`);
    await page.waitForSelector(".inbox-row", { timeout: 60_000 });
    await page.waitForTimeout(2500);
    await parkPointer(page);

    // Pass 1: the list as it actually looks, nothing filtered.
    await sweep(page, "");

    // Pass 2: one label filter on, so the strip has to hold pills + Archived + an active chip +
    // the trigger at every width.
    await page.setViewportSize({ width: 1440, height: HEIGHT });
    await page.waitForTimeout(SETTLE_MS);
    await page.getByRole("button", { name: "Add Label filter" }).click();
    await page.waitForTimeout(300);
    await page.getByRole("dialog").getByRole("option").first().click();
    await page.waitForTimeout(400);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await parkPointer(page);
    await sweep(page, "-filtered");

    await browser.close();
    console.log("responsive shots written to", OUT);
  } finally {
    closeBridge?.();
    await pool.end();
    await stopAll();
  }
}

await main();
