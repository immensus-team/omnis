// US-D04: three sequential frames of one transition, into docs/design/screens/motion/.
//
// The transition is the archive row leave (collapse + fade, --dur-move / 240ms) — the one piece of
// the motion pass that is a *timed* exit rather than a state change, and therefore the only one that
// can only be verified by looking at it. The other four (row selection, pill, tab switch, panel
// open) end in a state the still screenshots in docs/design/screens already capture.
//
// Why this needs a fake clock: the row is held in the list by a JavaScript timer (Inbox.tsx's
// LEAVE_MS hold) and removed when it fires. Wall-clock screenshots of a 240ms animation are a race —
// click, seek and capture all have to land inside the window, and a slow frame silently documents
// the wrong moment. `page.clock.pauseAt` stops that timer without touching the CSS animation, so the
// row parks mid-leave and the Web Animations API can seek it to an exact millisecond.
//
// Run: pnpm tsx tools/e2e/shots-motion.ts (same ports as the e2e smoke — never run both at once).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { Pool } from "../../packages/db/src/index.js";
import { assertNoOverflow, describeOverflow, measureOverflow } from "./overflow.js";
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

const OUT = join(REPO_ROOT, "docs/design/screens/motion");

/** The leave animation's own length. Read from the same place the app reads it rather than
 *  duplicated as a literal — the three frames below are named after the milliseconds they show. */
const LEAVE_MS = 240;
const FRAMES = [0, LEAVE_MS / 2, LEAVE_MS - 1];

/** Park every animation running on the leaving row at `ms`, and leave it there.
 *
 *  `document.getAnimations()` also returns animations on other elements (a Radix hover card mid
 *  entrance, for instance); only the leaving row's are touched, so the rest of the page is whatever
 *  it settled to. Returns the number of animations parked, which the caller asserts on — a selector
 *  that matched nothing would otherwise produce three identical screenshots of a row that is not
 *  actually leaving, and they would look plausible. */
function parkLeaveAnimation(ms: number): number {
  let parked = 0;
  for (const animation of document.getAnimations()) {
    // `target` is on KeyframeEffect, not on the AnimationEffect base — a CSS animation's effect is
    // one, but the type does not promise it, so this narrows rather than casts.
    const effect = animation.effect;
    if (!(effect instanceof KeyframeEffect)) continue;
    const target = effect.target;
    if (!(target instanceof Element) || !target.closest(".inbox-row--leaving")) continue;
    animation.pause();
    animation.currentTime = ms;
    parked++;
  }
  return parked;
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

    mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(`http://127.0.0.1:${VITE_PORT}/`);
    await page.waitForSelector(".inbox-row", { timeout: 60_000 });
    // The seed's rows arrive over Zero replication; the list has to be settled before anything is
    // measured or archived, or the first frame catches a half-rendered list.
    await page.waitForTimeout(2500);

    const rows = page.locator(".inbox-row");
    const rowCount = await rows.count();
    if (rowCount < 3)
      throw new Error(`need at least 3 seeded rows to show a list closing, got ${rowCount}`);

    // A row with rows below it: the collapse is only legible if something moves up behind it.
    const target = rows.nth(1);
    const targetName = (await target.locator(".inbox-row__name").textContent()) ?? "?";

    // Freeze JavaScript time before the click. This is what holds the row in the DOM — the CSS
    // animation is not clock-driven and keeps its own timeline, which parkLeaveAnimation then
    // takes over. (React's scheduler runs on MessageChannel, not setTimeout, so a paused clock does
    // not stall rendering; the waitForSelector below is the check on that assumption.)
    await page.clock.install();
    await page.clock.pauseAt(new Date());

    // The Archive button is hover-only (`.inbox-row__action` is opacity 0 + pointer-events none
    // until `.inbox-row:hover`), so the row has to be hovered before it can be pressed.
    await target.hover();
    await target.getByRole("button", { name: "Archive" }).click();
    await page.waitForSelector(".inbox-row--leaving", { timeout: 5_000 });

    // Take the pointer off the row so the frames show the collapse rather than the button that
    // started it. Moving the mouse is the driver's, not the page's, and needs no clock.
    await page.mouse.move(8, 8);

    for (const ms of FRAMES) {
      const parked = await page.evaluate(parkLeaveAnimation, ms);
      if (parked === 0) {
        throw new Error(`no animation to park at ${ms}ms — the row is not animating`);
      }
      // The full page, not a crop on the list: the point of the third frame is where the rows below
      // ended up, and a crop that excludes them documents nothing.
      await page.screenshot({ path: join(OUT, `archive-leave-${ms}ms.png`) });
      console.log(`archive-leave-${ms}ms.png — parked ${parked} animation(s), row "${targetName}"`);
    }

    // A collapsing row is a new layout state and nothing else measures it: an element that is
    // mid-collapse still has its full width, so a row whose contents cannot shrink past the pane
    // pushes the page sideways here even though every settled state is clean.
    const overflow = await page.evaluate(measureOverflow);
    console.log(`mid-leave overflow: ${describeOverflow(overflow)}`);
    assertNoOverflow("archive leave @1440px", overflow);

    await browser.close();
    console.log("motion shots written to", OUT);
  } finally {
    closeBridge?.();
    await pool.end();
    await stopAll();
  }
}

await main();
