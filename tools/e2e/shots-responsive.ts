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
import {
  type OverflowReport,
  assertNoOverflow,
  describeOverflow,
  measureOverflow,
} from "./overflow.js";
import { seed, varyInboxCopy } from "./seed.js";
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
/** Overflow-only widths. No screenshot, no layout assertions — these are the four sizes the
 *  anti-slop checklist (docs/design/SKILLS.md #11) names, and 320px is the narrowest thing the
 *  list has to survive. Cheap enough to sweep on every run. */
const OVERFLOW_ONLY_WIDTHS = [320, 375, 414];
/** Below the 560px list pane the strip's own controls come up to this — the min-height the narrow
 *  block sets on the view pills, the Archived toggle and the "+ Label" trigger. */
const TOUCH_TARGET_MIN = 32;
/** The floor for everything else in the strip. The chip's × is 20px painted inside a 28px chip
 *  with its pointer target widened to 28x28 by `::after { inset: -4px }` (US-D02 round 4 measured
 *  this: growing the button itself grows the chip to 32px and the strip past its 40px cap). So the
 *  sweep measures the expanded target, not the painted box, and holds it to 28. */
const CHIP_TARGET_MIN = 28;
/** The controls TOUCH_TARGET_MIN applies to — the ones the narrow block actually raises. */
const RAISED_CONTROLS =
  ".inbox-card__pills button, .inbox-card__archived-pill, .filter-chip-bar__add";
/** The boundary of `@container list (max-width: 559.98px)` — the tier where the strip's controls
 *  collapse to icons and come up to TOUCH_TARGET_MIN. Measured off the pane, not the window. */
const NARROW_LIST_PANE = 560;
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
  overflow: OverflowReport;
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

    const overflow = await page.evaluate(measureOverflow);
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
      `[${suffix === "" ? "unfiltered" : "filtered"}] width ${width}: ${describeOverflow(overflow)}, filter row ${filterRow.toFixed(1)}px, ${railPart}`,
    );

    assertNoOverflow(`${width}px${suffix}`, overflow);
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
    // The <900px tiers are the coarse-pointer layout, so two things the string-matching unit tests
    // cannot see are measured here instead.
    if (NARROW_WIDTHS.includes(width)) {
      // 1. Nothing in the row reserves space for the hover-only Archive/Restore button. It is
      //    `opacity: 0` in the wide tier, which keeps its box — ~65px of dead gutter per row, out
      //    of a 390px viewport, for a control a finger has no way to reveal.
      const actionBoxes = await page.evaluate(() =>
        [...document.querySelectorAll(".inbox-row__action")].map(
          (el) => el.getBoundingClientRect().width,
        ),
      );
      const laidOut = actionBoxes.filter((w) => w > 0);
      if (laidOut.length > 0) {
        throw new Error(
          `${laidOut.length} row action button(s) still take layout at ${width}px (widest ${Math.max(...laidOut).toFixed(1)}px) — the narrow tier must give that column back to the title`,
        );
      }

      // 2. Every control in the filter strip clears the touch floor — but only once the list pane
      //    itself is inside the `list` query, which is what raises them. At 768px the shell has
      //    collapsed while the pane is still ~736px wide, so the pane is measured, not the window.
      const paneWidth = await page.evaluate(
        () => document.querySelector(".inbox-card")?.getBoundingClientRect().width ?? 0,
      );
      if (paneWidth >= NARROW_LIST_PANE) {
        results.push({ width, overflow, filterRow });
        continue;
      }
      const targets = await page.evaluate((raised) => {
        const buttons = [
          ...document.querySelectorAll(".inbox-card__filter-row button"),
        ] as HTMLElement[];
        return buttons.map((el) => {
          const rect = el.getBoundingClientRect();
          // A control may widen its pointer target with an absolutely positioned `::after` on a
          // negative inset rather than growing its own box. That is the real target, so grow the
          // measured box by however far that pseudo-element reaches above and below.
          const after = getComputedStyle(el, "::after");
          const bleed =
            after.content === "none" ? 0 : Math.max(0, -Number.parseFloat(after.top || "0") || 0);
          return {
            label: el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "?",
            height: rect.height + bleed * 2,
            raised: el.matches(raised),
          };
        });
      }, RAISED_CONTROLS);
      if (targets.length === 0) throw new Error(`no filter-strip buttons at ${width}px`);

      for (const target of targets) {
        const floor = target.raised ? TOUCH_TARGET_MIN : CHIP_TARGET_MIN;
        if (target.height < floor) {
          throw new Error(
            `"${target.label}" has a ${target.height.toFixed(1)}px target at ${width}px (min ${floor}px)`,
          );
        }
      }
      const worst = targets.reduce((a, b) => (b.height < a.height ? b : a));
      console.log(
        `  ${width}px: ${targets.length} strip controls, smallest target "${worst.label}" ${worst.height.toFixed(1)}px`,
      );
    }

    results.push({ width, overflow, filterRow });
  }

  for (const width of OVERFLOW_ONLY_WIDTHS) {
    await page.setViewportSize({ width, height: HEIGHT });
    await page.waitForTimeout(SETTLE_MS);
    const overflow = await page.evaluate(measureOverflow);
    console.log(
      `[${suffix === "" ? "unfiltered" : "filtered"}] width ${width}: ${describeOverflow(overflow)}`,
    );
    assertNoOverflow(`${width}px${suffix}`, overflow);
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
    await varyInboxCopy(pool);
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
