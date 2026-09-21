// loop-r1-08 evidence: ⌘K's three promises, against the live stack rather than a mock — a hit the
// keyboard can open, a person the palette can follow, and commands that narrow as you type. What
// the story repairs is only legible in a browser: the Enter it fixes was dead because of a *stale
// `value`* inside cmdk, and no RTL render with a stubbed list reproduces the sequence that leaves
// the list with no selected row (type a query, reopen, type another — see check 3). The hub is
// asked here for real, so the hit rows are the hub's answer, not a fixture's.
//
// Run against a stack that is already up (this script boots none of its own — it is the same live
// app a person is looking at):
//   OMNIS_E2E_DB=omnis_test_loop_r1_e2e OMNIS_E2E_PORT_OFFSET=200 ZERO_SHARD_NUM=9 \
//     pnpm tsx tools/e2e/hold.ts --web
//   pnpm tsx tools/e2e/shots-loop-r1-08.ts   (desktop http://127.0.0.1:5373)
//
// Six checks at 1440, in the order a person hits them:
//   1. ⌘K, "PoC", Enter: the pane leaves whatever it was showing and opens that thread. This is the
//      press that used to be swallowed (L-15) — asserted on the pane's own title, not on the panel
//      closing, because a panel that closes while the pane stays put is exactly the old failure.
//   2. ⌘K again: the input is empty, so a new search starts from nothing rather than from the last
//      one's words (NC-12).
//   3. "Dana" and Enter with NO arrow key first: after check 1's list, cmdk's remembered value names
//      a row that no longer exists, so nothing is highlighted — and this press is the one that
//      proves the fix reads the DOM instead of trusting that bookkeeping.
//   4. The same query with the brief's ArrowDown: the row is highlighted and Enter opens the person
//      (NC-12's other half — `openHit` follows `screen: "person"` now).
//   5. ">go": seven command rows, each with its shortcut in a `<kbd>`, and no hub request behind the
//      `>` (the request would be command grammar sent to the index).
//   6. No "Phase B" anywhere in the panel (L-35, NC-40).
//
// Then the two screenshots the brief names, plus the SKILLS.md #11 no-overflow sweep with the panel
// open — a floating panel is the surface most likely to push a narrow viewport wide.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Page, chromium } from "@playwright/test";
import { assertNoOverflow, describeOverflow, measureOverflow } from "./overflow.js";
import { REPO_ROOT } from "./stack.js";

const BASE = process.env.OMNIS_SHOTS_URL ?? "http://127.0.0.1:5373";
const OUT = join(REPO_ROOT, "docs/design/loop/r1/impl/loop-r1-08");

const WIDE = { width: 1440, height: 900 } as const;
/** The brief's 390x844, without `isMobile` — the same way the other shot tools take a narrow pass. */
const PHONE = { width: 390, height: 844 } as const;
/** SKILLS.md #11's four narrow widths, swept with the panel open. */
const SWEEP = [320, 375, 414, 768] as const;

/** The seed's calendar thread, and the first hit for "PoC" (verified against GET /search). Spelled
 *  out so a reworded seed fails the check rather than quietly passing it. */
const POC_FIRST_HIT = "PoC review";
/** The seed's person, and the only hit for "Dana". */
const PERSON = "Dana Lee";
/** The seven Navigate commands. `>` + "go" matches these and not "Toggle detail pane", which is
 *  what makes the count a check rather than an observation. */
const GO_SHORTCUTS = ["g i", "g t", "g k", "g n", "g o", "g d", "g s"];
/** The one row the palette's own View group adds (item 6 of the story). It is deliberately NOT in
 *  the `>go` list: if it were, the count above would be eight and this would be the row to blame. */
const PANE_COMMAND = "Toggle detail pane";
const PANE_SHORTCUT = "⌘\\";
/** The panel is a spring, not a cut: 450ms clears --dur-panel without racing the settle. */
const SETTLE_MS = 450;

const input = (page: Page) => page.locator("[cmdk-input]");
const rows = (page: Page) => page.locator("[cmdk-item]");
const pane = (page: Page) => page.locator('[data-testid="detail-pane"]');

function check(ok: boolean, message: string): void {
  if (!ok) throw new Error(message);
  console.log(`  ok: ${message}`);
}

/** Opens the palette from the keyboard, the way the story's user does. */
async function openPalette(page: Page): Promise<void> {
  await page.keyboard.press("Meta+k");
  await page.waitForTimeout(SETTLE_MS);
}

/** Types a query and waits for *that query's* rows to be the ones on screen.
 *
 *  Both halves are load-bearing. The count alone passes on the previous query's leftovers — the
 *  rows do not change until the 180ms debounce has been and gone and the hub has answered, so
 *  "there is at least one row" is true the whole time. Waiting on the count *and* the first row's
 *  text is what makes the wait about this query rather than about the last one. */
async function query(
  page: Page,
  text: string,
  expected: { count: number; first: string },
): Promise<void> {
  await input(page).fill(text);
  await page.waitForFunction(
    ({ count, first }) => {
      const items = Array.from(document.querySelectorAll("[cmdk-item]"));
      return items.length === count && (items[0].textContent ?? "").includes(first);
    },
    { count: expected.count, first: expected.first },
    { timeout: 15_000 },
  );
  await page.waitForTimeout(150);
}

/** The pane's own subject line — the visible answer to "did that press go anywhere". */
async function paneSubject(page: Page): Promise<string> {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid="detail-pane"]');
    if (root === null) return "";
    return (root.querySelector("h1,h2")?.textContent ?? root.textContent ?? "").trim();
  });
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  try {
    const page = await browser.newPage({ viewport: WIDE });
    await page.goto(BASE);
    // The app is up when the inbox has drawn its rows — the same gate the other shot tools use.
    await page.waitForSelector(".inbox-row", { timeout: 60_000 });

    // ---- 1. Enter opens the highlighted hit (L-15) --------------------------------------------------
    await openPalette(page);
    await query(page, "PoC", { count: 4, first: POC_FIRST_HIT });
    check(
      (await rows(page).first().textContent())?.includes(POC_FIRST_HIT) === true,
      `the first row for "PoC" is the ${POC_FIRST_HIT} thread`,
    );
    await page.keyboard.press("Enter");
    await page.waitForTimeout(SETTLE_MS);
    check(
      (await paneSubject(page)).includes(POC_FIRST_HIT),
      `Enter opened the thread in the pane (pane says "${await paneSubject(page)}")`,
    );

    // ---- 2. ⌘K opens empty (NC-12) ------------------------------------------------------------------
    await openPalette(page);
    check((await input(page).inputValue()) === "", "⌘K reopened with an empty input");

    // ---- 3. Enter with no highlighted row at all (the L-15 failure itself) --------------------------
    await query(page, "Dana", { count: 1, first: PERSON });
    const selectedBefore = await rows(page).first().getAttribute("aria-selected");
    console.log(`  (no arrow key pressed: the row reports aria-selected="${selectedBefore}")`);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(SETTLE_MS);
    check(
      (await paneSubject(page)).includes(PERSON),
      `Enter with ${selectedBefore === "true" ? "a highlighted" : "no highlighted"} row opened the person`,
    );
    check(
      (await pane(page).locator(".person-detail").count()) === 1,
      "the pane is showing PersonDetail, the same surface the Network screen opens",
    );

    // ---- 4. the brief's sequence: ArrowDown to the person, then Enter -------------------------------
    await openPalette(page);
    await query(page, "Dana", { count: 1, first: PERSON });
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(120);
    check(
      (await rows(page).first().getAttribute("aria-selected")) === "true",
      "ArrowDown highlighted the person row",
    );

    await page.keyboard.press("Enter");
    await page.waitForTimeout(SETTLE_MS);
    check((await paneSubject(page)).includes(PERSON), "ArrowDown + Enter opened the person");

    // ---- 5. ">go" is commands only, each with its shortcut ------------------------------------------
    await openPalette(page);
    await query(page, ">go", { count: GO_SHORTCUTS.length, first: "Go to Inbox" });
    check(
      (await rows(page).count()) === GO_SHORTCUTS.length,
      `">go" lists exactly the ${GO_SHORTCUTS.length} Go-to commands and nothing else`,
    );
    const shortcuts = await rows(page).evaluateAll((items) =>
      items.map((item) => item.querySelector("kbd")?.textContent ?? ""),
    );
    check(
      JSON.stringify(shortcuts) === JSON.stringify(GO_SHORTCUTS),
      `each row carries its own shortcut in a <kbd> (${shortcuts.join(", ")})`,
    );
    const heading = await page.locator("[cmdk-group-heading]").first().textContent();
    check(heading === "Commands", `the group above them is labelled "${heading}"`);

    // The panel's own View row is not a Go-to command — checked while the panel is still open, so
    // "seven" is a real narrowing rather than the whole list.
    await input(page).fill(">toggle");
    await rows(page).first().waitFor({ timeout: 15_000 });
    check(
      (await rows(page).count()) === 1 &&
        (await rows(page).first().textContent())?.includes(PANE_COMMAND) === true,
      `">toggle" narrows to the one ${PANE_COMMAND} row`,
    );
    check(
      (await rows(page).first().locator("kbd").textContent()) === PANE_SHORTCUT,
      `it shows the ${PANE_SHORTCUT} shortcut loop-r1-02 already binds`,
    );

    // ---- 6. no roadmap jargon in the panel (L-35, NC-40) --------------------------------------------
    await input(page).fill(">go");
    await rows(page).first().waitFor({ timeout: 15_000 });
    await page.waitForTimeout(150);
    const phaseB = await page.evaluate(() => document.body.innerText.includes("Phase B"));
    check(!phaseB, 'no "Phase B" anywhere while the panel is open');

    await page.screenshot({ path: join(OUT, "1440.png") });

    // ---- the 390 shot: "Dana" typed, the person result highlighted -----------------------------------
    // The viewport changes *first*. The shell swaps the ask bar for the narrow tier's own when it
    // crosses 1280, and that is a different element — the query state goes with the instance that
    // held it. Resizing with "Dana" already typed photographed an empty Suggestions tab, so the
    // narrow pass opens the palette after the resize rather than carrying one across it.
    await page.setViewportSize(PHONE);
    await page.waitForTimeout(SETTLE_MS);
    await openPalette(page);
    await query(page, "Dana", { count: 1, first: PERSON });
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(120);
    check(
      (await rows(page).first().getAttribute("aria-selected")) === "true",
      "at 390 the person row is the highlighted one",
    );
    await page.screenshot({ path: join(OUT, "390.png") });

    // ---- the narrow sweep (SKILLS.md #11) -----------------------------------------------------------
    console.log(`no-overflow sweep with the panel open at ${SWEEP.join(", ")}`);
    for (const width of SWEEP) {
      await page.setViewportSize({ width, height: PHONE.height });
      await page.waitForTimeout(300);
      const overflow = await page.evaluate(measureOverflow);
      console.log(`  ${width}px: ${describeOverflow(overflow)}`);
      assertNoOverflow(`${width}px with the panel open`, overflow);
    }

    await page.close();
    console.log("loop-r1-08 shots written to", OUT);
  } finally {
    await browser.close();
  }
}

await main();
