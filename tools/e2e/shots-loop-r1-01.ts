// loop-r1-01 evidence: every screen is reachable from the rail, from `g` + a letter, and from ⌘K.
//
// Run against a stack that is already up (this script boots none of its own, unlike shots.ts and
// shots-detail-pane.ts — it is the same live app a person is looking at):
//   OMNIS_E2E_DB=omnis_test_loop_r1_e2e OMNIS_E2E_PORT_OFFSET=200 ZERO_SHARD_NUM=9 \
//     pnpm tsx tools/e2e/hold.ts --web
//   pnpm tsx tools/e2e/shots-loop-r1-01.ts        (base http://127.0.0.1:5373, i.e. 5173 + 200)
//
// Why a script and not two committed PNGs: the story's claim is about *reachability*, and no single
// picture of a screen shows that something reached it. Three separate routes have to be driven —
// a click on the rail's foot, a `g t` on the window, and a row in the narrow tier's More popover —
// and each one is only interesting together with the assertion that the screen actually changed.
// What was on screen when each shot was taken is as much of the evidence as the picture.
//
// The two tiers:
//   1440  the wide rail: five screen tiles under the Inbox tile and an enabled Settings button.
//         The Settings-gear click and the `g t` are both driven here, and 1440.png is the second of
//         them — Today on screen with the Today tile carrying aria-current="page".
//   390   the narrow rail: the bottom bar holds no screen tiles at all, and the same six screens are
//         labelled rows in the More popover. 390.png is that popover open, which is the only place
//         the narrow tier's screen navigation is visible. Choosing Tasks there is asserted to land on
//         the Tasks screen. 320 is measured for overflow but not shot: SKILLS.md #11 asks the floor
//         be checked there, and the two pictures the story asks for are the ones above.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Page, chromium } from "@playwright/test";
import { assertNoOverflow, describeOverflow, measureOverflow } from "./overflow.js";
import { REPO_ROOT } from "./stack.js";

const BASE = process.env.OMNIS_SHOTS_URL ?? "http://127.0.0.1:5373";
const OUT = join(REPO_ROOT, "docs/design/loop/r1/impl/loop-r1-01");
const HEIGHT = 1000;

/** The six screens the narrow popover lists, in the order the rail and the palette use. */
const SCREENS = ["Today", "Tasks", "Network", "Notes", "Digest", "Settings"] as const;
/** The five that are rail tiles at 1440 — Settings is the foot button, not a tile. */
const TILES = ["Today", "Tasks", "Network", "Notes", "Digest"] as const;

/** The screenshot is taken after the crossfade between screens is over, so the picture is of the
 *  screen that was asked for and not of two of them mid-swap. */
const SETTLE_MS = 400;

const tile = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

/** The Inbox tile's painted background. A string comparison rather than a colour parse: what the
 *  check is about is that the value changed between two screens, not what the value is — the dark
 *  fill is a token, and pinning its oklch here would be a second copy of tokens.css. */
async function inboxFill(page: Page): Promise<string> {
  return page.evaluate(
    `getComputedStyle(document.querySelector(".channel-rail__tile--inbox")).backgroundColor`,
  );
}

/** Waits for the shell to be the seeded app rather than the empty one: `hold.ts` densifies the
 *  inbox, so a row means Zero's sync has landed and the rail's tiles are the real ones. */
async function open(page: Page): Promise<void> {
  await page.goto(BASE);
  await page.waitForSelector(".inbox-row", { timeout: 60_000 });
  await page.waitForTimeout(1000);
}

/** Both readings. `assertNoOverflow` is the one with teeth: `overflow-x: clip` on the root — which
 *  app.css carries — pins `documentElement.scrollWidth` to the viewport no matter what the page
 *  does (see overflow.ts's header), so the literal reading the acceptance asks for is vacuous on
 *  its own and is kept only as the cheap first check. The element scan is what would fail if the
 *  five new tiles pushed the rail past a 320px shell. */
async function assertNoOverflowAt(page: Page, where: string): Promise<void> {
  const literal = await page.evaluate(
    "({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth })",
  );
  if (literal.scrollWidth > literal.innerWidth) {
    throw new Error(
      `documentElement.scrollWidth ${literal.scrollWidth} > innerWidth ${literal.innerWidth} at ${where}`,
    );
  }
  const overflow = await page.evaluate(measureOverflow);
  console.log(`  ${where}: ${describeOverflow(overflow)}`);
  assertNoOverflow(where, overflow);
}

/** The literal half of `assertNoOverflowAt`, for a screen with a known element-scan finding that is
 *  not this story's to fix. It still logs the scan, so the finding is in the output rather than
 *  hidden by the weaker check — see the 320 pass below for the one screen this is used on. */
async function assertViewportFits(page: Page, where: string): Promise<void> {
  const literal = await page.evaluate(
    "({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth })",
  );
  const overflow = await page.evaluate(measureOverflow);
  console.log(`  ${where}: ${describeOverflow(overflow)}`);
  if (literal.scrollWidth > literal.innerWidth) {
    throw new Error(
      `documentElement.scrollWidth ${literal.scrollWidth} > innerWidth ${literal.innerWidth} at ${where}`,
    );
  }
}

/** A screen is on show when its own root is, and the screen it replaced is gone. Asserting both
 *  halves is the point of the story: a route that renders the new screen *under* the old one would
 *  pass a one-sided check. */
async function assertScreen(page: Page, root: string, absent: string): Promise<void> {
  await page.waitForSelector(root, { timeout: 15_000 });
  await page.waitForTimeout(SETTLE_MS);
  if ((await page.locator(absent).count()) !== 0) {
    throw new Error(`${absent} is still on screen after switching to ${root}`);
  }
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  try {
    // ---- 1440: the wide rail drives both of the story's non-popover routes ----------------------
    const wide = await browser.newPage({ viewport: { width: 1440, height: HEIGHT } });
    await open(wide);
    console.log("1440 — the wide rail");

    // The five tiles and the foot button, and — as important — the absence of the Account button the
    // foot used to hold: an enabled Settings and a disabled Account sitting next to each other was
    // the "disabled lookalike" half of the finding (NC-01).
    for (const name of TILES) {
      if ((await tile(wide, name).count()) !== 1) {
        throw new Error(`the wide rail draws no ${name} tile`);
      }
    }
    if ((await tile(wide, "Settings").count()) !== 1) {
      throw new Error("the wide rail draws no Settings button");
    }
    if ((await tile(wide, "Settings").isDisabled()) === true) {
      throw new Error("the Settings button is disabled");
    }
    if ((await wide.getByRole("button", { name: "Account" }).count()) !== 0) {
      throw new Error("the Account button is still in the rail");
    }
    if ((await tile(wide, "Today").getAttribute("title")) !== "Today (g t)") {
      throw new Error("the Today tile does not carry its shortcut");
    }
    // The Inbox tile is pressed at rest and the tiles are not: four screens that each claimed "you
    // are here" at once was the L-33 finding.
    if ((await tile(wide, "Inbox").getAttribute("aria-pressed")) !== "true") {
      throw new Error("the Inbox tile is not pressed on the Inbox");
    }
    // ...and pressed has to *look* different, which is the half no unit test can see. jsdom applies
    // no stylesheet, so the attribute and the dark pill can come apart — and they did: this tile
    // kept its fill on every screen, and the shot for the story showed two filled pills side by side
    // (the Inbox's dark one and Today's accent one) while the ARIA said only one was current. The
    // reading below is the one that fails if the fill goes back to being unconditional.
    const inboxFillOnInbox = await inboxFill(wide);
    for (const name of TILES) {
      if ((await tile(wide, name).getAttribute("aria-current")) !== null) {
        throw new Error(`the ${name} tile claims to be current on the Inbox`);
      }
    }

    // Route 1: the foot button. Settings is the screen with a heading of its own, so it is the one
    // route whose arrival can be read off the page without knowing a class name.
    console.log("  click the Settings gear");
    await tile(wide, "Settings").click();
    await assertScreen(wide, ".settings-screen", ".inbox-card");
    const heading = await wide.locator("h1.settings-screen__title").textContent();
    if (heading !== "Settings") throw new Error(`the Settings heading reads ${heading}`);
    if ((await tile(wide, "Settings").getAttribute("aria-current")) !== "page") {
      throw new Error("the Settings button does not mark itself current");
    }
    if ((await tile(wide, "Inbox").getAttribute("aria-pressed")) !== "false") {
      throw new Error("the Inbox tile is still pressed on Settings");
    }

    // Route 2: the keyboard. `g` then `t`, into the window — nothing is focused, so this is the
    // path a reader with no pointer takes.
    console.log("  g t");
    await wide.keyboard.press("g");
    await wide.keyboard.press("t");
    await assertScreen(wide, ".today-screen", ".settings-screen");
    if ((await tile(wide, "Today").getAttribute("aria-current")) !== "page") {
      throw new Error("the Today tile does not mark itself current on Today");
    }
    if ((await tile(wide, "Settings").getAttribute("aria-current")) !== null) {
      throw new Error("the Settings button is still current on Today");
    }
    const inboxFillOnToday = await inboxFill(wide);
    if (inboxFillOnToday === inboxFillOnInbox) {
      throw new Error(
        `the Inbox tile still paints the selected fill on Today: ${inboxFillOnToday}`,
      );
    }
    console.log(`  Inbox tile fill: ${inboxFillOnInbox} → ${inboxFillOnToday}`);
    // Drop the focus the Settings click left on the foot button before shooting: `:focus-visible`
    // paints an accent ring, and a ring on the Settings gear next to the accent Today tile is a
    // picture of two things claiming to be current in the one shot whose whole subject is that only
    // one of them is.
    await wide.evaluate(
      "document.activeElement instanceof HTMLElement && document.activeElement.blur()",
    );
    await wide.mouse.move(720, 600);
    await wide.waitForTimeout(SETTLE_MS);
    await wide.screenshot({ path: join(OUT, "1440.png") });
    await assertNoOverflowAt(wide, "1440");

    // ---- 390: the narrow rail's screen rows, and the one route that lives there ------------------
    const narrow = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await open(narrow);
    console.log("390 — the narrow rail");

    // The bar holds no screen tile: a 320px bar cannot take five more 44px tiles, which is why the
    // same six screens are rows in More here.
    for (const name of TILES) {
      if ((await tile(narrow, name).count()) !== 0) {
        throw new Error(`the narrow bar still holds a ${name} tile`);
      }
    }
    // By class, not by name: every inbox row carries a hover-revealed "More actions" button, so the
    // rail's own More is 1 of 9 buttons whose accessible name starts with "More".
    await narrow.locator(".channel-rail__more").click();
    const popover = narrow.getByRole("dialog");
    await popover.waitFor({ timeout: 10_000 });
    for (const name of SCREENS) {
      if ((await popover.getByRole("button", { name, exact: true }).count()) !== 1) {
        throw new Error(`the More popover lists no ${name} row`);
      }
    }
    await narrow.waitForTimeout(SETTLE_MS);
    await narrow.screenshot({ path: join(OUT, "390.png") });

    // Route 3: a row in the popover. It has to both navigate and close the popover — a row that
    // left the popover open over the screen it just opened would be a menu nobody can dismiss.
    console.log("  click Tasks in the popover");
    await popover.getByRole("button", { name: "Tasks", exact: true }).click();
    await assertScreen(narrow, ".tasks-screen", ".inbox-card");
    await popover.waitFor({ state: "detached", timeout: 10_000 });
    if ((await narrow.locator(".channel-rail__popover").count()) !== 0) {
      throw new Error("the More popover stayed open after a row was chosen");
    }
    await assertNoOverflowAt(narrow, "390");

    // 320 is the floor SKILLS.md #11 names. No shot: the popover is a fixed-width panel and the
    // question here is only whether the bar fits.
    //
    // Two readings, because the Tasks screen has a finding of its own at this width that this story
    // did not put there and does not own: its view switcher (`.tasks-screen`'s SegmentedControl) is
    // an inline-flex row of segments with no wrap and no scroller, so at 320 its last segment hangs
    // 3.5px past the viewport. Pointing a user test at 320 was the only way to see it until now —
    // the rail is what changed here, and the rail is not involved. So the scan is logged rather than
    // thrown, the literal acceptance is still asserted, and the Inbox below gets the strict reading:
    // the rail's own floor is where this story's teeth are.
    await narrow.setViewportSize({ width: 320, height: 844 });
    await narrow.waitForTimeout(SETTLE_MS);
    await assertViewportFits(narrow, "320 tasks (known: SegmentedControl overhang)");
    await narrow.keyboard.press("g");
    await narrow.keyboard.press("i");
    await assertScreen(narrow, ".inbox-card", ".tasks-screen");
    await assertNoOverflowAt(narrow, "320 inbox");

    console.log("loop-r1-01 shots written to", OUT);
  } finally {
    await browser.close();
  }
}

await main();
