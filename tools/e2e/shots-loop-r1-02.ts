// loop-r1-02 evidence: below 1280 the list comes first, and every tier the pane opens in has a way
// back to it.
//
// Run against a stack that is already up (this script boots none of its own — it is the same live
// app a person is looking at):
//   OMNIS_E2E_DB=omnis_test_loop_r1_e2e OMNIS_E2E_PORT_OFFSET=200 ZERO_SHARD_NUM=9 \
//     pnpm tsx tools/e2e/hold.ts --web
//   pnpm tsx tools/e2e/shots-loop-r1-02.ts        (base http://127.0.0.1:5373, i.e. 5173 + 200)
//
// Why a script and not three committed PNGs: the story's whole subject is *what is on top of what*,
// and a picture of a list cannot show that the list is reachable — a sheet painted over it and a
// sheet behind it look the same in a screenshot. The probe is `document.elementFromPoint` at the
// centre of the first row, which is the question "if I tapped here, what would I hit" asked of the
// browser rather than of the eye. That is also how the findings were made (NC-03's sheet that could
// not be dismissed is `elementFromPoint` answering the sheet).
//
// The four passes:
//   390   the phone tier. The list is uncovered on load, the subline's "N need approval" opens the
//         sheet, its `‹ Inbox` row gives the list back, a thread opened from a row is left the same
//         way, and the approval card's four buttons stop at its right edge (L-26, NC-27).
//   1270  the split tier. Same first-row assertion with no interaction at all: this is the width
//         where the self-opening sheet covered about 40% of the list on every load (L-17).
//   1440  the column tier. The pane still opens itself for the queue — the behaviour the story
//         deliberately leaves alone — and Escape on an open thread returns to the queue with the
//         focus back on the row it was opened from (NC-09).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Page, chromium } from "@playwright/test";
import { assertNoOverflow, describeOverflow, measureOverflow } from "./overflow.js";
import { REPO_ROOT } from "./stack.js";

const BASE = process.env.OMNIS_SHOTS_URL ?? "http://127.0.0.1:5373";
const OUT = join(REPO_ROOT, "docs/design/loop/r1/impl/loop-r1-02");

/** The brief's two viewports. 390×844 without `isMobile`, as the shot tools do: the touch flag
 *  switches the row swipe's pointer path on, and this story is about what the pane covers rather
 *  than about the gesture that reveals it. 1440×900 is the brief's desktop frame. */
const PHONE = { width: 390, height: 844 } as const;
const WIDE = { width: 1440, height: 900 } as const;
/** 1270: inside the floating band (<=1279.98) with the most list for a sheet to cover — the L-17
 *  width. 1280 and up is the column, which is a different story and is checked at 1440. */
const SPLIT = { width: 1270, height: 900 } as const;

/** One spring plus the pane's own settle. --dur-panel and --dur-move are both 240ms, and the pane's
 *  close is held in the DOM for the latter (useClosingSpring), so 450ms clears both without racing
 *  the frame the assertion reads. */
const SETTLE_MS = 450;

/** Runs in the page. A string and not a function: tsx's esbuild transform names inner function
 *  expressions and injects a `__name` helper that does not exist in the page (overflow.ts's header
 *  carries the measurement). Returns "" when the first row is the topmost node at its own centre,
 *  or the class of whatever is on top of it when it is not. */
const FIRST_ROW_PROBE = `(() => {
  const row = document.querySelector(".inbox-row");
  if (row === null) return "no row is on screen";
  const rect = row.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return "the first row has no box";
  const el = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  if (el === null) return "nothing is at the row's centre";
  return el.closest(".inbox-row") === row ? "" : "covered by " + (el.className || el.tagName);
})()`;

/** Every one of the card's buttons against the card's own right edge. The card's border and its 12px
 *  padding both sit inside that edge, so a button that merely respects them reads strongly negative;
 *  anything above zero is a decision the card is asking for and then clipping. */
const CARD_FIT_PROBE = `(() => {
  const card = document.querySelector(".approval-card");
  if (card === null) return null;
  const right = card.getBoundingClientRect().right;
  return {
    card: { left: card.getBoundingClientRect().left, right: right },
    buttons: Array.from(document.querySelectorAll(".approval-card__actions button")).map((b) => ({
      label: (b.textContent || "").trim(),
      right: b.getBoundingClientRect().right,
    })),
  };
})()`;

/** What the pane's close left the focus on. Read off `data-thread-id` rather than a class, because
 *  the assertion is about *which* row and not about what a row looks like. */
const ACTIVE_ELEMENT_PROBE = `(() => {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return { threadId: null, what: "nothing focused" };
  return { threadId: el.getAttribute("data-thread-id"), what: el.className || el.tagName };
})()`;

interface CardFit {
  card: { left: number; right: number };
  buttons: { label: string; right: number }[];
}

/** The one assertion the story is about, and the reason it is not a screenshot: a covered list and
 *  an uncovered one are the same picture when the cover is behind it. */
async function assertListOnTop(page: Page, where: string): Promise<void> {
  const covered = await page.evaluate(FIRST_ROW_PROBE);
  if (covered !== "") throw new Error(`the list is not reachable at ${where}: ${covered}`);
  console.log(`  ${where}: the first inbox row is the topmost node at its own centre`);
}

async function assertNoOverflowAt(page: Page, where: string): Promise<void> {
  const overflow = await page.evaluate(measureOverflow);
  console.log(`  ${where}: ${describeOverflow(overflow)}`);
  assertNoOverflow(where, overflow);
}

/** Loads the seeded app rather than the empty one: `hold.ts` densifies the inbox, so a row on screen
 *  means Zero's sync has landed. */
async function open(page: Page): Promise<void> {
  await page.goto(BASE);
  await page.waitForSelector(".inbox-row", { timeout: 60_000 });
  await page.waitForTimeout(1500);
}

/** What `hold.ts` seeds: `densify` proposes one approval per non-agent-session thread. Spelled here
 *  because the subline's count *is* the story's subject — a button that says the wrong number is the
 *  bug this replaces ("Needs approval 6" over a queue of eight), so the exact label is asserted and
 *  a fixture that changes size fails loudly rather than testing a number nobody checked. */
const EXPECTED_APPROVALS = 8;
const QUEUE_LABEL = `${EXPECTED_APPROVALS} need approval`;

const queueButton = (page: Page) => page.getByRole("button", { name: QUEUE_LABEL });
const pane = (page: Page) => page.locator('[data-testid="detail-pane"]');
const pendingStack = (page: Page) => page.locator('[aria-label="Pending approvals"]');

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  try {
    // ---- 390: the list, the sheet, and the way back ---------------------------------------------
    const phone = await browser.newPage({ viewport: PHONE });
    await open(phone);
    console.log("390 — the list at rest");

    // NC-03, the finding this story opens with: the pane used to open itself here, as a full-height
    // sheet with no way out, so the inbox could not be reached until every approval was decided.
    if ((await pane(phone).count()) !== 0) {
      throw new Error("the pane opened itself at 390");
    }
    await assertListOnTop(phone, "390 at rest");

    if ((await queueButton(phone).count()) !== 1) {
      const read = (await phone.locator(".inbox-card__subline").textContent()) ?? "(no subline)";
      throw new Error(`the subline does not offer "${QUEUE_LABEL}" — it reads ${read.trim()}`);
    }
    console.log(`  the subline offers: ${QUEUE_LABEL}`);
    await phone.screenshot({ path: join(OUT, "390.png") });

    // ---- 390: the sheet, asked for ---------------------------------------------------------------
    console.log("390 — the queue sheet");
    await queueButton(phone).click();
    await pane(phone).waitFor({ timeout: 15_000 });
    await pendingStack(phone).waitFor({ timeout: 15_000 });
    await phone.waitForTimeout(SETTLE_MS);

    // NC-37: the sheet's own header row. Without it this tier had no way out at all — the chrome row
    // that carries the chevron is `display: none` below 900.
    const back = phone.getByRole("button", { name: "Back to Inbox" });
    if ((await back.count()) !== 1) throw new Error("the 390 sheet draws no Back to Inbox row");
    // ...and it has to be reachable, not merely drawn: a control painted under the pane's own content
    // looks perfect in a screenshot and cannot be pressed.
    const backBox = await back.boundingBox();
    if (backBox === null || backBox.height < 40) {
      throw new Error(`the Back to Inbox row is ${backBox?.height ?? 0}px tall, not a 44px target`);
    }

    // L-26, NC-27: four decisions in one row did not fit. "Edit & approve" wrapped to two lines and
    // "Ignore" was clipped past the card's right edge — a decision the card asks for and then refuses
    // to show. The buttons now wrap instead of overflowing, and this is the measurement of that.
    const fit = (await phone.evaluate(CARD_FIT_PROBE)) as CardFit | null;
    if (fit === null) throw new Error("the 390 sheet shows no approval card");
    if (fit.buttons.length !== 4) {
      throw new Error(`the card draws ${fit.buttons.length} decisions, not 4`);
    }
    for (const button of fit.buttons) {
      const over = button.right - fit.card.right;
      if (over > 0)
        throw new Error(`"${button.label}" is ${over.toFixed(1)}px past the card's edge`);
    }
    console.log(
      `  four decisions, all inside the card: ${fit.buttons
        .map((b) => `${b.label} ${(b.right - fit.card.left).toFixed(0)}px`)
        .join(", ")}`,
    );
    await assertNoOverflowAt(phone, "390 sheet");
    await phone.screenshot({ path: join(OUT, "390-sheet.png") });

    await back.click();
    await pane(phone).waitFor({ state: "detached", timeout: 15_000 });
    await phone.waitForTimeout(SETTLE_MS);
    await assertListOnTop(phone, "390 after Back to Inbox");

    // ---- 390: a thread, and the same way out -----------------------------------------------------
    // The other half of NC-37: the back row has to work for the pane a *row* opened, not only for the
    // queue — an open thread at 390 had no way back at all.
    console.log("390 — a thread from a row");
    await phone.locator(".inbox-row").first().click();
    await pane(phone).waitFor({ timeout: 15_000 });
    await phone.waitForTimeout(SETTLE_MS);
    await phone.getByRole("button", { name: "Back to Inbox" }).click();
    await pane(phone).waitFor({ state: "detached", timeout: 15_000 });
    await phone.waitForTimeout(SETTLE_MS);
    await assertListOnTop(phone, "390 after a thread was closed");

    // ---- 1270: the split tier, with no interaction at all ----------------------------------------
    // L-17, and the assertion needs no gesture: the sheet used to be there on *load*, floating over
    // about 40% of the list. If the auto-open rule comes back for the floating tier, this is where it
    // shows.
    console.log("1270 — the split tier on load");
    const split = await browser.newPage({ viewport: SPLIT });
    await open(split);
    if ((await pane(split).count()) !== 0) {
      throw new Error("the pane opened itself at 1270");
    }
    await assertListOnTop(split, "1270 on load");
    await assertNoOverflowAt(split, "1270");

    // ---- 1440: the column tier, unchanged --------------------------------------------------------
    console.log("1440 — the queue in the column");
    const wide = await browser.newPage({ viewport: WIDE });
    await open(wide);
    // The regression guard: >=1280 the pane is a column and opening for the queue on arrival is the
    // behaviour this story leaves alone.
    await pane(wide).waitFor({ timeout: 30_000 });
    await pendingStack(wide).waitFor({ timeout: 15_000 });
    // The wider pane is what L-26 was about too, and it is the tier where the four labels never had
    // to wrap — so the fitting check is repeated rather than assumed.
    const wideFit = (await wide.evaluate(CARD_FIT_PROBE)) as CardFit | null;
    if (wideFit === null || wideFit.buttons.length !== 4) {
      throw new Error("the 1440 pane shows no four-decision card");
    }
    for (const button of wideFit.buttons) {
      if (button.right - wideFit.card.right > 0) {
        throw new Error(`"${button.label}" is past the card's edge at 1440`);
      }
    }
    console.log("  the pane opened itself for the queue");
    await wide.screenshot({ path: join(OUT, "1440.png") });

    // NC-09: "once something is open, nothing returns the pane to the queue". Escape is that, and
    // the focus has to come back to the row with it — the pane is gone, so the control that had the
    // focus went with it and the next Tab would start from the top of the document.
    console.log("1440 — a thread, Escape, and back to the queue");
    const row = wide.locator(".inbox-row").first();
    const threadId = await row.getAttribute("data-thread-id");
    if (threadId === null) throw new Error("the first row carries no data-thread-id");
    await row.click();
    await wide.waitForTimeout(SETTLE_MS);

    await wide.keyboard.press("Escape");
    await wide.waitForTimeout(SETTLE_MS);
    if ((await pendingStack(wide).count()) !== 1) {
      throw new Error("Escape did not put the queue back in the pane");
    }
    const active = (await wide.evaluate(ACTIVE_ELEMENT_PROBE)) as {
      threadId: string | null;
      what: string;
    };
    if (active.threadId !== threadId) {
      throw new Error(
        `the focus went to ${active.what} (thread ${active.threadId}), not the row ${threadId}`,
      );
    }
    console.log(`  the queue is back and the focus is on the row ${threadId}`);
    await assertNoOverflowAt(wide, "1440 after Escape");

    // ---- the overflow floor ----------------------------------------------------------------------
    // SKILLS.md #11's four sizes, with the sheet open on the tier where it covers the most: the card
    // is at its narrowest at 320 and this is the only run that can measure it.
    console.log("no-overflow sweep at 320, 375, 414, 768");
    await queueButton(phone).click();
    await pane(phone).waitFor({ timeout: 15_000 });
    for (const width of [320, 375, 414, 768]) {
      await phone.setViewportSize({ width, height: 844 });
      await phone.waitForTimeout(SETTLE_MS);
      await assertNoOverflowAt(phone, `${width} with the sheet open`);
      const swept = (await phone.evaluate(CARD_FIT_PROBE)) as CardFit | null;
      if (swept === null) throw new Error(`no approval card at ${width}`);
      for (const button of swept.buttons) {
        const over = button.right - swept.card.right;
        if (over > 0) {
          throw new Error(`"${button.label}" is ${over.toFixed(1)}px past the card at ${width}`);
        }
      }
    }

    console.log("loop-r1-02 shots written to", OUT);
  } finally {
    await browser.close();
  }
}

await main();
