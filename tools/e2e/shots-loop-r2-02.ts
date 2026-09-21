// loop-r2-02 evidence: "one reply, one card", against the live stack rather than a mock. Every claim
// this story makes is a claim about **how many** of something are on screen — the same sentence used
// to be a flow bubble, a DraftCard and an approval card — and a count is a property of a rendered
// page, not of a component in a test renderer. Two of the checks also read the database, because
// "the card is gone" and "the draft was consumed" are different statements and only the row tells
// them apart.
//
// Run against a stack that is already up (this script boots none of its own):
//   OMNIS_E2E_DB=omnis_test_loop_r2_impl OMNIS_E2E_PORT_OFFSET=500 ZERO_SHARD_NUM=12 \
//     pnpm tsx tools/e2e/hold.ts --web
//   OMNIS_E2E_DB=omnis_test_loop_r2_impl pnpm tsx tools/e2e/shots-loop-r2-02.ts
//
// The checks, in the order a person hits them:
//   1. At 1440, `#omnis-launch` shows the draft's sentence exactly once, as a single card that names
//      where the reply goes and says it was drafted. 1440.png is this state.
//   2. The same card in the phone sheet at 390, dragged to its tall snap. 390.png is this state.
//   3. Discard is the ignore decision on the *approval* (`/decide`, not the hub's `/items/:id/discard`,
//      which is the standalone draft's route) — and while App holds it for the undo window the reply
//      is off the pane entirely rather than dropping back to a DraftCard.
//   4. After the window: `pending_approvals.decision = 'ignore'` and the draft item is
//      `status = 'archived'` with no `external_id` — the kernel consuming the draft, which is the
//      half no screenshot can show.
//   5. No horizontal overflow at 1440, 390 or 320.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Locator, type Page, chromium } from "@playwright/test";
import { Pool, query } from "../../packages/db/src/index.js";
import { describeOverflow, measureOverflow } from "./overflow.js";
import { REPO_ROOT, loadOrCreateEnv } from "./stack.js";

const BASE = process.env.OMNIS_SHOTS_URL ?? "http://127.0.0.1:5673";
const OUT = join(REPO_ROOT, "docs/design/loop/r2/impl/loop-r2-02");

const WIDE = { width: 1440, height: 900 } as const;
/** The brief's 390x844, without `isMobile` — the same way the other shot tools take a narrow pass. */
const PHONE = { width: 390, height: 844 } as const;
/** SKILLS.md #11's narrowest width. */
const NARROW = { width: 320, height: 844 } as const;

/** The copy this script asserts on, spelled once so a reworded card fails the check instead of
 *  quietly passing it. */
const REPLY = "Reply to #omnis-launch?";
const BODY = "Yes, I will review it today.";
const PROVENANCE = "Drafted from memory and past threads";
const DISCARD = "Discard";

const PANE = '[data-testid="detail-pane"]';

/** Poll a read until it says what the write was supposed to. The writes go to the hub over HTTP and
 *  the screens read through Zero's replica, so a database assertion is always "eventually" — a
 *  one-shot read right after the click would be a race dressed as a check. */
async function poll<T>(
  read: () => Promise<T>,
  ok: (value: T) => boolean,
  what: string,
  timeout = 20_000,
): Promise<T> {
  const until = Date.now() + timeout;
  for (;;) {
    const value = await read();
    if (ok(value)) return value;
    if (Date.now() > until) {
      throw new Error(`timed out waiting for ${what}: ${JSON.stringify(value)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

interface ApprovalRow {
  id: string;
  thread_id: string | null;
  item_id: string | null;
  state: string;
  decision: string | null;
}

async function approval(pool: Pool, description: string): Promise<ApprovalRow> {
  const rows = await query<ApprovalRow>(
    pool,
    "SELECT id, thread_id, item_id, state, decision FROM pending_approvals WHERE description = $1",
    [description],
  );
  const row = rows[0];
  if (row === undefined) throw new Error(`no pending_approvals row carries "${description}"`);
  return row;
}

async function itemStatus(pool: Pool, id: string): Promise<string> {
  const rows = await query<{ status: string }>(pool, "SELECT status FROM items WHERE id = $1", [
    id,
  ]);
  if (rows[0] === undefined) throw new Error(`items row ${id} is gone`);
  return rows[0].status;
}

/** How many times a sentence is on screen, read off the pane's rendered text. `innerText` and not
 *  `textContent`: this is a count of what a person can see, and the flow, the draft card and the
 *  approval card were three visible copies of one sentence.
 *
 *  Split on the text rather than querying by it, because the defect is a *duplicate* — `getByText`
 *  would have to be asked for a count anyway, and it would not see a copy inside an element whose
 *  text also holds something else. */
async function countInPane(page: Page, text: string): Promise<number> {
  return page.locator(PANE).evaluate((el, needle) => {
    const where = (el as HTMLElement).innerText;
    return where.split(needle).length - 1;
  }, text);
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  // tools/e2e/.env is written once and keeps whichever database the *first* stack in this worktree
  // used; `loadOrCreateEnv` only follows OMNIS_E2E_DB when it is exported. The port offset cannot
  // tell us the database name, so the variable is required rather than inferred — without this guard
  // the browser would talk to the stack on :5673 while the reads below hit another database.
  if (process.env.OMNIS_E2E_DB === undefined) {
    throw new Error("OMNIS_E2E_DB must name the running stack's database (see the header)");
  }
  const env = loadOrCreateEnv();
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });
  const browser = await chromium.launch();

  try {
    const seeded = await approval(pool, REPLY);
    if (seeded.thread_id === null) throw new Error(`"${REPLY}" is not on a thread`);
    if (seeded.item_id === null) {
      throw new Error(
        `"${REPLY}" carries no item_id — the seed is not linking the approval to its draft, and nothing below can fold`,
      );
    }
    const itemId = seeded.item_id;
    const titleRows = await query<{ title: string | null }>(
      pool,
      "SELECT title FROM threads WHERE id = $1",
      [seeded.thread_id],
    );
    const title = titleRows[0]?.title ?? null;
    if (title === null || title.trim() === "") {
      throw new Error(`thread ${seeded.thread_id} has no title for the card to name`);
    }
    console.log(`The draft and its approval: "${REPLY}" on ${title} (item ${seeded.item_id})`);

    const page = await browser.newPage({ viewport: WIDE });
    /** Every write the browser sent, so "Discard is the approval's ignore decision" is a statement
     *  about the requests and not about a card that happens to have left the screen. */
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.method() !== "POST") return;
      const url = request.url();
      if (url.includes("/decide") || url.includes("/discard")) requests.push(url);
    });

    await page.goto(BASE);
    await page.waitForSelector(".inbox-row", { timeout: 60_000 });
    await page.locator(`.inbox-row[data-thread-id="${seeded.thread_id}"]`).click();

    const card = page.locator(".thread-screen__draft");
    await card.waitFor({ timeout: 20_000 });

    // ---- 1. One reply, one card, at 1440 -----------------------------------------------------------
    const expectedHeader = `Reply in ${title} · Slack`;
    const header = (await card.locator(".approval-card__header").textContent())?.trim();
    if (header !== expectedHeader) {
      throw new Error(`the folded card's header reads "${header ?? ""}", not "${expectedHeader}"`);
    }
    const provenance = (await card.locator(".approval-card__provenance").textContent())?.trim();
    if (provenance !== PROVENANCE) {
      throw new Error(`the provenance line reads "${provenance ?? ""}", not "${PROVENANCE}"`);
    }
    const quoted = (await card.locator(".approval-card__body").textContent())?.trim();
    if (quoted !== BODY) {
      throw new Error(`the card quotes "${quoted ?? ""}", not the draft "${BODY}"`);
    }
    // The defect, counted: the flow bubble, the DraftCard and the approval card were three copies.
    const occurrences = await countInPane(page, BODY);
    if (occurrences !== 1) {
      throw new Error(
        `"${BODY}" is on the pane ${occurrences} times — the draft and its approval have to be one`,
      );
    }
    if ((await page.locator(".draft-card").count()) !== 0) {
      throw new Error("a standalone DraftCard is on screen beside the approval that is about it");
    }
    // The card's own buttons, as the brief lists them: Approve / Edit / Discard. `ignoreLabel` is
    // what makes the last one "Discard" rather than "Ignore".
    const labels: string[] = await card.getByRole("button").allTextContents();
    const wanted = ["Approve", "Edit", DISCARD];
    if (JSON.stringify(labels) !== JSON.stringify(wanted)) {
      throw new Error(
        `the folded card's buttons read ${JSON.stringify(labels)}, not ${JSON.stringify(wanted)}`,
      );
    }
    console.log(
      `  1. one card: "${header}" over the provenance line, "${labels.join(" / ")}", and "${BODY}" exactly once on the pane`,
    );
    await page.screenshot({ path: join(OUT, "1440.png") });

    // ---- 2. The same card in the phone sheet at 390 -------------------------------------------------
    await page.setViewportSize(PHONE);
    await page.waitForTimeout(500);
    if ((await page.locator(PANE).count()) === 0) {
      throw new Error("the pane is gone at 390 — the sheet this frame is about is not on screen");
    }
    await card.waitFor({ timeout: 10_000 });
    // The sheet comes up at its peek — half the window — and the card is below the fold there with no
    // scroll range left to reach it, so the frame is composed the way a person composes it: drag the
    // grabber to the sheet's tall snap (`handleOnly` in narrow-drawer.tsx is why the gesture lives on
    // that one 5px element).
    const grabber = page.locator("[data-vaul-handle]").first();
    const grip = await grabber.boundingBox();
    if (grip === null) throw new Error("the phone sheet has no grabber to drag");
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    for (let step = 1; step <= 12; step += 1) {
      await page.mouse.move(grip.x + grip.width / 2, grip.y - (step * 400) / 12);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await page.waitForTimeout(600);
    const framed = await card.boundingBox();
    if (framed === null || framed.y < 0 || framed.y + framed.height > PHONE.height) {
      throw new Error(`the card is not in the 390 frame: ${JSON.stringify(framed)}`);
    }
    if ((await countInPane(page, BODY)) !== 1) {
      throw new Error(`"${BODY}" is not on the pane exactly once at 390`);
    }
    await page.screenshot({ path: join(OUT, "390.png") });
    console.log(`  2. at 390 the sheet shows the same one card over "${BODY}"`);

    // ---- 3. Discard, and the window App holds it for ------------------------------------------------
    await page.setViewportSize(WIDE);
    await page.waitForTimeout(500);
    await card.getByRole("button", { name: DISCARD }).click();

    // The held frame: the approval is off screen and the draft is *still* `draft` in the database
    // (the hub has not been told yet), so a fold that did not know about the hold would put a
    // standalone DraftCard back — the card the person just dismissed.
    await poll(
      () => countInPane(page, BODY),
      (count) => count === 0,
      `"${BODY}" to leave the pane with the decision`,
      5_000,
    );
    if ((await page.locator(".draft-card").count()) !== 0) {
      throw new Error(
        "the ignored draft dropped back to a standalone DraftCard during the undo window",
      );
    }
    if ((await itemStatus(pool, itemId)) !== "draft") {
      throw new Error("the draft was consumed before the undo window was even over");
    }
    console.log(
      "  3. Discard emptied the pane, and the draft is still `draft` while the undo is up",
    );

    // ---- 4. The window closes: the kernel consumes the draft ----------------------------------------
    const decided = await poll(
      async () => ({
        state: (
          await query<{ state: string; decision: string | null }>(
            pool,
            "SELECT state, decision FROM pending_approvals WHERE id = $1",
            [seeded.id],
          )
        )[0],
        status: await itemStatus(pool, itemId),
      }),
      (it) => it.state?.decision === "ignore" && it.status === "archived",
      `decision='ignore' on ${seeded.id} and status='archived' on ${itemId}`,
    );
    // The route the click used. `/decide` and not `/items/:id/discard`: the folded card's Discard is
    // the ignore decision on the approval, which is what consumes the draft.
    if (!requests.some((url) => url.includes("/decide"))) {
      throw new Error(`no /decide was sent — the requests were ${JSON.stringify(requests)}`);
    }
    if (requests.some((url) => url.includes("/discard"))) {
      throw new Error("the folded card used the standalone draft's route instead of deciding");
    }
    const stillGone = await countInPane(page, BODY);
    if (stillGone !== 0) {
      throw new Error(`"${BODY}" came back to the pane after the decision (${stillGone} copies)`);
    }
    console.log(
      `  4. the window closed: decision='${decided.state?.decision}', item status='${decided.status}', and the pane still shows nothing`,
    );
    // Straight back, before the sweep: this stack is a fixture other readers expect to find whole,
    // and a failure below must not leave it short a card and a draft.
    await query(
      pool,
      `UPDATE pending_approvals
          SET state = 'pending', decision = NULL, decided_args = NULL, decided_at = NULL
        WHERE id = $1 AND state = 'decided'`,
      [seeded.id],
    );
    await query(pool, "UPDATE items SET status = 'draft' WHERE id = $1", [itemId]);
    // And let Zero catch up before the sweep measures the page, or it measures the old frame.
    await poll(
      () => countInPane(page, BODY),
      (count) => count === 1,
      `"${BODY}" to come back with the restored fixture`,
    );

    // ---- 5. No horizontal overflow ------------------------------------------------------------------
    for (const viewport of [WIDE, PHONE, NARROW]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(400);
      const overflow = await page.evaluate(measureOverflow);
      console.log(`  ${viewport.width}px: ${describeOverflow(overflow)}`);
      if (overflow.diff > 0) {
        throw new Error(
          `horizontal scroll at ${viewport.width}: the body is ${overflow.diff}px wider than the viewport`,
        );
      }
    }

    await page.close();
    console.log("loop-r2-02 shots written to", OUT);
  } finally {
    await browser.close();
    await pool.end();
  }
}

await main();
