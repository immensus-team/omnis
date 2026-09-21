// US-D10 evidence: the detail pane's three states, at the two tiers the story is about.
// Run: pnpm tsx tools/e2e/shots-detail-pane.ts (same ports as the e2e smoke — never run both).
//
// Why this is a script and not six committed PNGs: each of the three things US-D10 adds is only
// visible in a different state. The rounded card is the pane at rest; the chevron's way back only
// exists once the pane is gone; and the grip's pill is `opacity: 0` until the divider is hovered or
// held — so a screenshot of the open pane cannot show that a handle exists at all. Add that the
// width and the collapsed flag are settings, and the only way to photograph them settled is to
// reload. What was on the screen is as much of the evidence as the picture, and that is this file.
//
// The seeded pending approval is deliberately NOT closed out here, unlike shots-responsive.ts: the
// pane auto-opens for it (`paneVisible = open !== null || (!paneCollapsed && approvals.length > 0)`
// in App.tsx), so the approval is what keeps the pane on screen without the script first having to
// click a row. It is closed only for the last 390 shot, where the subject is the opposite — the
// tier with no pane of its own.
//
// The two tiers:
//   1440  the pane is a column of its own (>=1280). Open, resized, collapsed: three distinct
//         pictures, plus the reload that proves the first two are settings.
//   390   the pane is a full-width sheet and both of US-D10's controls are `display: none`
//         (app.css: `.detail-pane__grip, .detail-pane__chrome { display: none }` inside the narrow
//         tier). The sheet behaviour is unchanged there, which is the point — so what the 390 pass
//         asserts is the *absence* of the handle and the toggle, and what it photographs is the
//         sheet at the two states that tier actually has. `resized-390` is therefore the same
//         picture as `open-390`, deliberately: there is no handle to drag. It is shot rather than
//         skipped so the file set matches the story's acceptance, and the assertion behind it is
//         the one that carries the meaning.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Page, chromium } from "@playwright/test";
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
  startDesktop,
  startHub,
  startZeroCache,
  stopAll,
  waitForHttp,
} from "./stack.js";

const OUT = join(REPO_ROOT, "docs/design/screens/wave2");
const HEIGHT = 1000;
/** --dur-panel is the longest transition on this screen (240ms), and the pane's close is an
 *  animation React holds the node for; 450ms clears both without racing the settle. */
const SETTLE_MS = 450;
/** The drag distance for the resized shot. 420 + 140 = 560, comfortably inside 320…720 (half of
 *  1440), so the picture shows the pane following the pointer rather than a rubber band. */
const DRAG_PX = 140;
/** One arrow key, from detail-pane.ts's DETAIL_STEP_PX. Spelled here rather than imported: the
 *  desktop app's tsconfig does not include packages/ui's sources, and the script is checking the
 *  number the user actually gets, so a constant that drifted with a refactor would be a check that
 *  drifted with it. */
const STEP_PX = 16;

/** Widths swept for the no-overflow floor with the pane on screen. 320/375/414 are SKILLS.md #11's
 *  narrow sizes, 768/1024 the single- and two-pane tiers, 1280 the boundary where the pane stops
 *  being a sheet, 1440 where it is a column. The sweep is cheap (one evaluate per width) and it is
 *  the one assertion the anti-slop checklist asks for at every width rather than at the two the
 *  screenshots are taken at. */
const SWEEP_WIDTHS = [320, 375, 414, 768, 1024, 1280, 1440];

const pane = (page: Page) => page.locator('[data-testid="detail-pane"]');
const grip = (page: Page) => page.getByRole("separator", { name: "Resize details pane" });

/** The pane's width as the shell draws it. One property for the column, the sheet and the collapsed
 *  overlay (App.tsx sets `--detail-width` on the shell), so this is the width in whatever shape the
 *  pane currently has — and it is readable while the pane is collapsed, which is what makes it the
 *  way to check the setting survived a reload. */
async function drawnWidth(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      document
        .querySelector('[data-testid="app-shell"]')
        ?.style.getPropertyValue("--detail-width") ?? "",
  );
}

async function assertNoOverflowAt(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(measureOverflow);
  console.log(`  ${label}: ${describeOverflow(overflow)}`);
  assertNoOverflow(label, overflow);
}

/** Park the pointer off the list and let any row hover card leave, the way shots.ts does. The card
 *  is anchored to a row and floats out over the pane, so a pointer that has been resting on the
 *  list arrives at the divider with the card already open on top of it. */
async function parkPointer(page: Page): Promise<void> {
  await page.mouse.move(2, 2);
  await page
    .locator(".row-hover-card")
    .waitFor({ state: "hidden", timeout: 5000 })
    .catch(() => undefined);
  await page.waitForTimeout(SETTLE_MS);
}

/** Where the grip is pressed: three-quarters across, not dead centre.
 *
 *  The grip straddles the divider, so its centre sits exactly on the pane's left edge — which is
 *  also where an inbox row ends. Resting there for the hover card's 400ms dwell opens the card over
 *  the divider, and the press then lands on the card. Measured, not guessed: this script's first
 *  runs pressed the centre, and `elementFromPoint` answered `row-hover-card__summary` for a press
 *  that reported the pane's starting width straight back. The quarter of the grip that is inside
 *  the pane is the same control and the same gesture, and it is never over a row. */
async function gripPressPoint(page: Page): Promise<{ x: number; y: number }> {
  const box = await grip(page).boundingBox();
  if (box === null) throw new Error("the grip has no box to press");
  return { x: box.x + box.width * 0.75, y: box.y + box.height / 2 };
}

/** The divider has to be the topmost thing at its own press point, and that is worth asserting
 *  rather than assuming: the collapsed pane's chevron lost its corner to the ask pill exactly this
 *  way (z-index 5 under the pill's 6), and a control that is painted but not reachable looks
 *  perfect in every screenshot while being impossible to use. */
async function assertGripIsReachable(page: Page, point: { x: number; y: number }): Promise<void> {
  const top = await page.evaluate(
    `(() => {
       const el = document.elementFromPoint(${point.x}, ${point.y});
       if (el === null) return "nothing";
       return el.closest(".detail-pane__grip") !== null ? "grip" : (el.className || el.tagName) + "";
     })()`,
  );
  if (top !== "grip") throw new Error(`the divider is covered at its own press point by: ${top}`);
}

/** Pointer events are what `pointerDrag` binds, so the gesture is driven through the mouse API —
 *  a dispatched synthetic event would not carry the `pointerId` the primitive filters on. Several
 *  intermediate moves rather than one jump: the primitive applies a 6px start slop, and a single
 *  move of the full distance is one frame of travel where a drag is many. */
async function dragGrip(page: Page, distance: number): Promise<void> {
  await parkPointer(page);
  const from = await gripPressPoint(page);
  await assertGripIsReachable(page, from);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 6; step++) {
    await page.mouse.move(from.x - (distance * step) / 6, from.y);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  // Leave the pointer on the divider's new position, so the pill is painting for the screenshot.
  // Deliberately a short wait and not SETTLE_MS: the pill's fade is --dur-fast, and the hover card
  // needs 400ms of dwell on a row to open — this is under it, so the pane is shot with the handle
  // showing and nothing else on top of it.
  const to = await gripPressPoint(page);
  await page.mouse.move(to.x, to.y);
  // Drop the focus the press moved onto the grip. A pointer drag leaves the divider hovered, not
  // focused — and the difference is visible: `:focus-visible` paints the accent outline, so leaving
  // it on would photograph a keyboard interaction to illustrate a drag. `:hover` is what keeps the
  // pill painting, and it is unaffected by the blur.
  await page.evaluate(
    "document.activeElement instanceof HTMLElement && document.activeElement.blur()",
  );
  await page.waitForTimeout(220);
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

    mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: HEIGHT } });
    await page.goto(`http://127.0.0.1:${VITE_PORT}/`);
    await page.waitForSelector(".inbox-row", { timeout: 60_000 });
    // The pane opens for the seeded approval. Waiting on the element rather than on a clock: the
    // approval reaches the shell through Zero's sync, which is a socket round trip and not a
    // constant.
    await pane(page).waitFor({ timeout: 60_000 });
    await page.waitForTimeout(2500);

    // ---- 1440: the pane as a column ------------------------------------------------------------
    console.log("1440 — open");
    await page.mouse.move(2, 2);
    await page.waitForTimeout(SETTLE_MS);

    if ((await grip(page).count()) !== 1) throw new Error("the open column draws no grip");
    if ((await page.getByRole("button", { name: "Collapse details" }).count()) !== 1) {
      throw new Error("the open column draws no collapse chevron");
    }
    // The splitter's range, which is the accessible description of what the drag is allowed to do.
    const handle = grip(page);
    console.log(
      `  grip: now=${await handle.getAttribute("aria-valuenow")} min=${await handle.getAttribute("aria-valuemin")} max=${await handle.getAttribute("aria-valuemax")}`,
    );
    await assertNoOverflowAt(page, "1440 open");
    await page.screenshot({ path: join(OUT, "detail-pane-open-1440.png") });

    // ---- the handle's two keyboard paths, before the screenshot that shows the pointer's --------
    // The arrows are asserted in the browser rather than left to the RTL tests because the shell is
    // what clamps them against the *window* — jsdom's window is 1024 and this one is 1440, so the
    // ceiling (720 vs 512) is a number only this run can reach.
    console.log("1440 — keyboard");
    await handle.focus();
    const before = Number(await handle.getAttribute("aria-valuenow"));
    for (let press = 0; press < 5; press++) {
      await page.keyboard.press("ArrowLeft");
      await page.waitForTimeout(60);
    }
    const grown = Number(await handle.getAttribute("aria-valuenow"));
    if (grown !== before + 5 * STEP_PX) {
      throw new Error(`five ArrowLeft presses moved ${grown - before}px, not ${5 * STEP_PX}`);
    }
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(120);
    if (Number(await handle.getAttribute("aria-valuenow")) !== grown - STEP_PX) {
      throw new Error("ArrowRight did not step the pane back by one step");
    }
    console.log(`  ${before} -> ${grown} -> ${grown - STEP_PX}px`);
    // Double-click resets to the shipped width, which is the same number the narrow sheet opens at
    // — so a reset and a collapse-and-reopen cannot disagree about how wide the conversation is.
    await handle.dblclick();
    await page.waitForTimeout(SETTLE_MS);
    const reset = await drawnWidth(page);
    if (reset !== "420px") throw new Error(`double-click reset the pane to ${reset}, not 420px`);
    console.log(`  double-click reset to ${reset}`);

    // ---- the pointer drag, which is also the width the reload check below reads back -------------
    console.log("1440 — resized");
    await dragGrip(page, DRAG_PX);
    const resized = await drawnWidth(page);
    if (resized !== "560px") throw new Error(`a ${DRAG_PX}px drag drew the pane at ${resized}`);
    // dragGrip leaves the pointer on the divider's new position, so the pill is painting — which is
    // the only state a screenshot can show the handle in, since the pill is transparent at rest.
    await assertNoOverflowAt(page, "1440 resized");
    await page.screenshot({ path: join(OUT, "detail-pane-resized-1440.png") });
    console.log(`  dragged to ${resized}, grip hovered so the pill paints`);

    // ---- collapsed ------------------------------------------------------------------------------
    console.log("1440 — collapsed");
    await page.getByRole("button", { name: "Collapse details" }).click();
    await pane(page).waitFor({ state: "detached", timeout: 15_000 });
    await page.waitForTimeout(SETTLE_MS);
    // The list takes the width — which is the whole of what "collapsed" means here, and is
    // measured rather than eyeballed because a pane that only *painted* over the list would look
    // identical in a screenshot while leaving the rows as narrow as they were.
    const listWidth = await page.evaluate(
      () => document.querySelector(".inbox-card")?.getBoundingClientRect().width ?? 0,
    );
    console.log(`  list card is ${listWidth.toFixed(1)}px of a 1440px shell`);
    if (listWidth < 1300) throw new Error(`the list did not take the width: ${listWidth}px`);
    await page.mouse.move(2, 2);
    await page.waitForTimeout(SETTLE_MS);
    await assertNoOverflowAt(page, "1440 collapsed");
    await page.screenshot({ path: join(OUT, "detail-pane-collapsed-1440.png") });

    // ---- the two settings survived a reload ------------------------------------------------------
    // This is the end-to-end half of the persistence requirement, and it is the half the RTL tests
    // cannot be: those stub `fetch` and never leave the page. A reload is a real GET of the real
    // settings row off the hub, and a real restore through it.
    console.log("1440 — reload (persistence)");
    await page.reload();
    await page.waitForSelector(".inbox-row", { timeout: 60_000 });
    // The pane is collapsed, so waiting on the pane itself would be waiting on the thing that
    // should not be there. The chevron is the restore's own visible end.
    await page.getByRole("button", { name: "Expand details" }).waitFor({ timeout: 60_000 });
    await page.waitForTimeout(SETTLE_MS);
    const restoredWidth = await drawnWidth(page);
    if (restoredWidth !== resized) {
      throw new Error(`the reload restored ${restoredWidth || "nothing"}, not ${resized}`);
    }
    if ((await pane(page).count()) !== 0) throw new Error("the reload reopened a collapsed pane");
    console.log(`  restored ${restoredWidth}, still collapsed`);
    await assertNoOverflowAt(page, "1440 reloaded");

    // ---- the no-overflow floor, with the pane on screen -----------------------------------------
    // Reopened first, because the sweep above the 1280 boundary is the only place the column's own
    // width arithmetic is under test — a sweep with the pane collapsed measures the list alone.
    await page.getByRole("button", { name: "Expand details" }).click();
    await pane(page).waitFor({ timeout: 15_000 });
    await page.waitForTimeout(SETTLE_MS);
    console.log(`no-overflow sweep at ${SWEEP_WIDTHS.join(", ")}`);
    for (const width of SWEEP_WIDTHS) {
      await page.setViewportSize({ width, height: HEIGHT });
      await page.waitForTimeout(SETTLE_MS);
      await assertNoOverflowAt(page, `${width}px pane open`);
    }

    // ---- 390: the tier where the pane is a sheet and neither control exists ----------------------
    // The stored width is still the 560 the drag committed. It is deliberately left there: the
    // sheet ignoring it is the assertion below, and it is worth photographing the sheet at a width
    // the user chose that this tier refuses to honour.
    console.log("390 — sheet (no handle, no toggle)");
    await page.setViewportSize({ width: 390, height: HEIGHT });
    await page.waitForTimeout(SETTLE_MS + 400);
    // A string rather than a function: tsx's esbuild transform names inner function expressions and
    // injects a `__name` helper for them, and that helper does not exist in the page.
    //
    // `display` as computed, plus the box — reading the rect alone would not do. A `display: none`
    // element is still in the DOM, so `querySelector` finds it and `getBoundingClientRect` answers
    // with a zero rect rather than nothing, which reads as "present but empty" and would sail past
    // a check that meant to ask "is it out of the layout".
    const hidden = (await page.evaluate(`(() => {
      const box = (selector) => {
        const el = document.querySelector(selector);
        if (el === null) return { display: "absent", width: 0, height: 0 };
        const rect = el.getBoundingClientRect();
        return { display: getComputedStyle(el).display, width: rect.width, height: rect.height };
      };
      return {
        grip: box(".detail-pane__grip"),
        chrome: box(".detail-pane__chrome"),
        sheet: document.querySelector(".app-shell__detail")?.getBoundingClientRect().width ?? 0,
        viewport: window.innerWidth,
      };
    })()`)) as {
      grip: { display: string; width: number; height: number };
      chrome: { display: string; width: number; height: number };
      sheet: number;
      viewport: number;
    };
    // The controls must be out of the layout, not merely invisible: a control that is transparent or
    // parked off-screen still takes the pointer, which is exactly the bug the collapsed chevron had
    // at 1440 before its z-index was raised.
    if (hidden.grip.display !== "none") {
      throw new Error(`the grip is ${hidden.grip.display} at 390 — it should be display:none`);
    }
    if (hidden.chrome.display !== "none") {
      throw new Error(`the collapse chevron is ${hidden.chrome.display} at 390 — not display:none`);
    }
    console.log(
      `  grip and chrome are display:none; sheet is ${hidden.sheet.toFixed(1)}px of ${hidden.viewport}px (stored width ${restoredWidth})`,
    );
    await page.mouse.move(2, 2);
    await page.waitForTimeout(SETTLE_MS);
    await assertNoOverflowAt(page, "390 open");
    await page.screenshot({ path: join(OUT, "detail-pane-open-390.png") });

    // The "resized" 390 shot. There is nothing on this tier to drag, so the picture is the sheet
    // again — the assertion that carries the meaning is that a press where the divider *would* be
    // finds no splitter at all, and the sheet keeps ignoring the 560px setting while it is pressed.
    console.log("390 — resized (nothing to resize)");
    if ((await grip(page).count()) !== 0) throw new Error("a grip exists in the DOM at 390");
    await page.mouse.move(2, 500);
    await page.mouse.down();
    await page.mouse.move(200, 500);
    await page.mouse.up();
    await page.waitForTimeout(SETTLE_MS);
    const afterPress = await page.evaluate(
      () => document.querySelector(".app-shell__detail")?.getBoundingClientRect().width ?? 0,
    );
    if (Math.abs(afterPress - hidden.sheet) > 1) {
      throw new Error(`a press at the divider moved the sheet: ${hidden.sheet} -> ${afterPress}`);
    }
    await assertNoOverflowAt(page, "390 resized");
    await page.screenshot({ path: join(OUT, "detail-pane-resized-390.png") });
    console.log("  no splitter to press; the sheet did not move");

    // ---- 390 collapsed: the tier's pane-less state ----------------------------------------------
    // Below 900 the collapsed flag deliberately does not apply — `paneCollapsed = collapsed &&
    // !narrow`, so a user who collapsed the pane on a wide screen still gets the sheet here. The
    // tier's equivalent picture is therefore the one with no pane in it at all, which is what a row
    // tap is answered with and what the list looks like when nothing is open. It is reached the way
    // shots-responsive.ts reaches it — the seeded approval decided, so the pane has nothing to
    // auto-open for. Keeping the row rather than deleting it: 'expired' + 'ignore' satisfies
    // approvals_decided_ck.
    console.log("390 — collapsed (list at full width)");
    await query(
      pool,
      `UPDATE pending_approvals SET state = 'expired', decision = 'ignore', decided_at = now()
        WHERE state = 'pending'`,
    );
    await pane(page).waitFor({ state: "detached", timeout: 30_000 });
    await page.waitForTimeout(SETTLE_MS);
    const listAt390 = await page.evaluate(
      () => document.querySelector(".inbox-card")?.getBoundingClientRect().width ?? 0,
    );
    console.log(`  list card is ${listAt390.toFixed(1)}px of a 390px shell`);
    if (listAt390 < 300) throw new Error(`the list did not take the width: ${listAt390}px`);
    await assertNoOverflowAt(page, "390 collapsed");
    await page.screenshot({ path: join(OUT, "detail-pane-collapsed-390.png") });

    await browser.close();
    console.log("detail-pane shots written to", OUT);
  } finally {
    closeBridge?.();
    await pool.end();
    await stopAll();
  }
}

await main();
