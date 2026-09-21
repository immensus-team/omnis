// loop-r2-03 evidence: "`r` opens an inline composer that proposes a send", against the live stack.
// The story's claims are about a keyboard gesture and about what the write lands as, neither of which
// a component test can settle: `r` is resolved by a window listener against a real focus ring, and
// "it proposed rather than sent" is a statement about a `pending_approvals` row and the absence of
// anything leaving for the channel.
//
// Run against a stack that is already up (this script boots none of its own):
//   OMNIS_E2E_DB=omnis_test_loop_r2_impl OMNIS_E2E_PORT_OFFSET=500 ZERO_SHARD_NUM=12 \
//     pnpm tsx tools/e2e/hold.ts --web
//   OMNIS_E2E_DB=omnis_test_loop_r2_impl pnpm tsx tools/e2e/shots-loop-r2-03.ts
//
// The checks, in the order a person hits them:
//   1. The Gmail thread with Dana Lee's "PoC slides" — not the Google Calendar event whose subject is
//      "PoC review" — is opened from the inbox, and `r` opens the composer with the caret already in
//      the box and a line that names the destination. 1440.png is this state, with a reply typed.
//   2. The same box in the phone sheet at 390, dragged to its tall snap. 390.png is this state — and
//      the box is opened and typed into *there*, because the tier flip replaces the pane rather than
//      resizing it (see the comment at that step).
//   3. ⌘Enter proposes: the box goes, and a card carrying the sentence is on the pane inside 5s.
//   4. The hub wrote a `pending` `send` approval whose `args.body` is that sentence and whose
//      `item_id` is null — a reply stands alone rather than folding into a draft (loop-r2-02).
//   5. Nothing on the page, in any element's text or `title`, says "Phase B" — the roadmap string the
//      control this story wired used to carry.
//   6. No horizontal overflow at 1440, 390 or 320.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Page, chromium } from "@playwright/test";
import { Pool, query } from "../../packages/db/src/index.js";
import { describeOverflow, measureOverflow } from "./overflow.js";
import { REPO_ROOT, loadOrCreateEnv } from "./stack.js";

const BASE = process.env.OMNIS_SHOTS_URL ?? "http://127.0.0.1:5673";
const OUT = join(REPO_ROOT, "docs/design/loop/r2/impl/loop-r2-03");

const WIDE = { width: 1440, height: 900 } as const;
/** The brief's 390x844, without `isMobile` — the same way the other shot tools take a narrow pass. */
const PHONE = { width: 390, height: 844 } as const;
/** SKILLS.md #11's narrowest width. */
const NARROW = { width: 320, height: 844 } as const;

/** The copy this script asserts on, spelled once so a reworded box fails the check instead of
 *  quietly passing it. */
const SUBJECT = "PoC slides";
const SENDER = "Dana Lee";
const REPLY = "I'll send comments Wednesday.";
/** The build-phase string the tooltip this story wired used to carry (NC2-03). Absence is only
 *  checkable against a literal, so it is one. */
const PHASE_B = "Phase B";

const PANE = '[data-testid="detail-pane"]';
const COMPOSER = ".reply-composer";

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

interface ThreadRow {
  id: string;
  title: string | null;
  channel: string;
  participants: string[];
}

/** The thread the story names: the Gmail one titled "PoC slides", whose sender is Dana Lee. Read from
 *  the database rather than clicked by eye, because "Dana Lee's" and the calendar event's "PoC
 *  review" are one word apart in the inbox and the wrong one has no reply worth writing. */
async function namedThread(pool: Pool): Promise<ThreadRow> {
  const rows = await query<ThreadRow>(
    pool,
    `SELECT t.id,
            t.title,
            a.channel,
            COALESCE(
              (SELECT array_agg(p.display_name ORDER BY p.display_name)
                 FROM unnest(t.participants) AS pid
                 JOIN persons p ON p.id = pid),
              ARRAY[]::text[]
            ) AS participants
       FROM threads t
       JOIN accounts a ON a.id = t.account_id
      WHERE a.channel = 'gmail' AND t.title = $1`,
    [SUBJECT],
  );
  if (rows.length !== 1) {
    throw new Error(
      `${String(rows.length)} gmail threads are titled "${SUBJECT}" — the fixture is not the one the story names`,
    );
  }
  const row = rows[0] as ThreadRow;
  if (!row.participants.includes(SENDER)) {
    throw new Error(
      `"${SUBJECT}" is not ${SENDER}'s — its participants are ${JSON.stringify(row.participants)}`,
    );
  }
  return row;
}

/** Every element whose text or `title` names a build phase. Walked by hand rather than with
 *  `page.getByText`, because the claim is an absence over the *whole* page including attributes, and a
 *  locator can only answer for a selector someone already thought of.
 *
 *  Rendered text and not `textContent`: the claim is what a person can read and hover, and
 *  `textContent` also carries `<style>` and `<script>` sources, where a build phase is a legitimate
 *  word (docs/ and the plans name Phase B throughout). It caught exactly that on the first run.
 *
 *  No nested arrows in the body: `keepNames` in the `tsx` pass rewrites those into `__name(...)`,
 *  which does not exist in the page (tools/e2e/overflow.ts's header documents the trap). */
async function phaseBWords(page: Page): Promise<string[]> {
  return page.evaluate((needle) => {
    const hits: string[] = [];
    for (const el of Array.from(document.querySelectorAll("[title]"))) {
      const title = el.getAttribute("title") ?? "";
      if (title.includes(needle)) hits.push(`title="${title}"`);
    }
    if (document.body.innerText.includes(needle)) hits.push("visible text");
    return hits;
  }, PHASE_B);
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
  let created: string | null = null;

  try {
    const thread = await namedThread(pool);
    const title = thread.title ?? "";
    const expectedHeader = `Reply in ${title} · Gmail`;
    console.log(`${SENDER}'s "${title}": thread ${thread.id}, header "${expectedHeader}"`);

    const page = await browser.newPage({ viewport: WIDE });
    await page.goto(BASE);
    await page.waitForSelector(".inbox-row", { timeout: 60_000 });
    const row = page.locator(`.inbox-row[data-thread-id="${thread.id}"]`);
    await row.waitFor({ timeout: 30_000 });
    const rowText = (await row.innerText()).replace(/\s+/g, " ").trim();
    if (!rowText.includes(SENDER)) {
      throw new Error(`the inbox row for "${title}" does not name ${SENDER}: "${rowText}"`);
    }
    await row.click();
    await page.locator(PANE).waitFor({ timeout: 20_000 });

    // ---- 1. `r`, at 1440 ---------------------------------------------------------------------------
    // Nothing is focused in particular when a thread opens, so the key reaches the window listener
    // rather than a control that would swallow it.
    await page.locator(".thread-screen").click({ position: { x: 4, y: 4 } });
    await page.keyboard.press("r");
    const box = page.locator(`${COMPOSER} textarea`);
    await box.waitFor({ timeout: 5_000 });
    // The gesture's own claim: the caret is in the box, so the person can start typing without
    // reaching for the mouse.
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      return el === null
        ? "none"
        : `${el.tagName.toLowerCase()}${el.getAttribute("aria-label") === null ? "" : `[aria-label=${el.getAttribute("aria-label")}]`}`;
    });
    if (!focused.startsWith("textarea")) {
      throw new Error(`\`r\` left the focus on ${focused} instead of the reply box`);
    }
    const line = (
      await page.locator(`${COMPOSER} .reply-composer__header-text`).innerText()
    ).trim();
    if (line !== expectedHeader) {
      throw new Error(`the composer's line reads "${line}", not "${expectedHeader}"`);
    }
    const send = page.getByRole("button", { name: "Send for approval" });
    // The box opens empty, which is a claim about a *browser* and not about the component's state:
    // the first run of this script found the "r" that opened the box already in it, because a real
    // key press runs on to the text insertion while `fireEvent.keyDown` stops at the keydown
    // (use-keymap.ts's `preventDefault` and its comment are the fix).
    const opened = await box.inputValue();
    if (opened !== "") {
      throw new Error(`\`r\` opened the box with "${opened}" already in it`);
    }
    if (!(await send.isDisabled())) {
      throw new Error("Send for approval is live with an empty box");
    }
    await box.pressSequentially(REPLY, { delay: 8 });
    if (await send.isDisabled()) {
      throw new Error("Send for approval is still disabled with a reply in the box");
    }
    // The composer is the last thing in the conversation — under the flow, not chrome beside the
    // toolbar — so the frame shows it where a reply is written.
    await page.screenshot({ path: join(OUT, "1440.png") });
    console.log(
      `  1. \`r\` opened the box on "${focused}", the line reads "${line}", and "${REPLY}" is in it`,
    );

    // ---- 2. The box in the phone sheet at 390 --------------------------------------------------------
    await page.setViewportSize(PHONE);
    await page.waitForTimeout(500);
    if ((await page.locator(PANE).count()) === 0) {
      throw new Error("the pane is gone at 390 — the sheet this frame is about is not on screen");
    }
    // The box is opened *again* here rather than carried across the resize. The tier flip does not
    // move the pane, it replaces it: App renders the drawer in one branch and the column in the other,
    // so the switch is a different element type at the same position and React unmounts the whole
    // thread subtree — a smaller-typed reply would be lost the same way (the `dataset.probe` in
    // docs/design/loop/r2/impl/loop-r2-03 is that same flip observed, node for node). This is not
    // this story's state to hold, and a comment is the honest thing to leave rather than a fix that
    // moves the composer's draft into App. So the frame is composed the way a phone composes it:
    // open the thread's box with the same key and type the reply on this device.
    await page.locator(".thread-screen").waitFor({ timeout: 10_000 });
    await page.locator(".thread-screen").click({ position: { x: 4, y: 4 } });
    await page.keyboard.press("r");
    await box.waitFor({ timeout: 10_000 });
    const phoneOpened = await box.inputValue();
    if (phoneOpened !== "") {
      throw new Error(`\`r\` opened the 390 box with "${phoneOpened}" already in it`);
    }
    await box.pressSequentially(REPLY, { delay: 8 });
    // The sheet comes up at its peek, so the frame is composed the way a person composes it: drag the
    // grabber to the sheet's tall snap (`handleOnly` in narrow-drawer.tsx is why the gesture lives on
    // that one 5px element), then scroll the conversation to its end, which is where the box is.
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
    // The offset form from shots-loop-r2-02.ts, for the reason its comment gives: at the 0.92 snap the
    // drawer's box runs past the window, so `block: "end"` would park the box on an off-screen edge.
    await page.locator(".thread-screen").evaluate((el, margin) => {
      const scroller = el as HTMLElement;
      const target = scroller.querySelector(".reply-composer");
      if (target === null) return;
      scroller.scrollTop =
        scroller.scrollTop + target.getBoundingClientRect().bottom - (window.innerHeight - margin);
    }, 16);
    await page.waitForTimeout(400);
    const framed = await box.boundingBox();
    if (framed === null || framed.y + framed.height > PHONE.height) {
      throw new Error(
        `the box is not in the 390 frame: ${JSON.stringify(framed)} (window ${PHONE.height}px)`,
      );
    }
    const phoneLine = (
      await page.locator(`${COMPOSER} .reply-composer__header-text`).innerText()
    ).trim();
    if (phoneLine !== expectedHeader) {
      throw new Error(`the 390 box's line reads "${phoneLine}", not "${expectedHeader}"`);
    }
    await page.screenshot({ path: join(OUT, "390.png") });
    console.log(
      `  2. at 390 the sheet shows the same box over "${REPLY}", ${Math.round(framed.y)}..${Math.round(framed.y + framed.height)} of ${PHONE.height}`,
    );

    // ---- 3. ⌘Enter proposes ------------------------------------------------------------------------
    // Pressed on the phone, where the box now is — one keyboard path, and this is the tier that has no
    // modifier key at all, which is why the hint is hidden there and the button is the way in.
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/reply") && r.request().method() === "POST"),
      box.press("Meta+Enter"),
    ]);
    if (response.status() !== 201) {
      throw new Error(`the reply route answered ${String(response.status())}, not 201`);
    }
    created = ((await response.json()) as { approval_id: string }).approval_id;
    // The box's own exit is the submit's: it is one step, and the card it raised is the next.
    await page.locator(COMPOSER).waitFor({ state: "detached", timeout: 5_000 });
    // The card arrives through Zero's replica, so this is a wait and not a read. 5s is the brief's
    // number, and it is the number the focus hand-off in Thread.tsx is racing.
    const card = page.locator(".thread-screen .approval-card").filter({ hasText: REPLY });
    await card.waitFor({ timeout: 5_000 });
    const quoted = (await card.locator(".approval-card__body").innerText()).trim();
    if (quoted !== REPLY) {
      throw new Error(`the card quotes "${quoted}", not the reply "${REPLY}"`);
    }
    const cardHeader = (await card.locator(".approval-card__header").innerText()).trim();
    if (cardHeader !== expectedHeader) {
      throw new Error(`the card's header reads "${cardHeader}", not "${expectedHeader}"`);
    }
    // The focus a submit is owed: the card's Approve, or the subject if the card was slower than the
    // 2s the hand-off waits. Left on `<body>` would cost a keyboard user their place, which is the
    // one outcome that is always wrong.
    const landed = await page.evaluate(() => {
      const el = document.activeElement;
      if (el === null) return "none";
      if (el.tagName === "BUTTON") return (el.textContent ?? "").trim();
      return el.tagName.toLowerCase();
    });
    if (landed !== "Approve" && landed !== "h2") {
      throw new Error(
        `after the submit the focus is on ${landed}, not the card's Approve or the subject`,
      );
    }
    console.log(
      `  3. ⌘Enter emptied the box and "${quoted}" is on the pane as one card header "${cardHeader}", focus on ${landed}`,
    );
    // The reply is data and the box was local state, so the tier flip takes one and leaves the other.
    // Said out loud, because it is the difference a reader of the two screenshots would otherwise have
    // to guess at.
    await page.setViewportSize(WIDE);
    await page.waitForTimeout(600);
    await card.waitFor({ timeout: 10_000 });
    console.log("     after the resize the card stays and the box goes — the reply is a row");

    // ---- 4. What the hub actually wrote --------------------------------------------------------------
    interface ApprovalRow {
      id: string;
      state: string;
      action: string;
      item_id: string | null;
      args: { body?: unknown } | null;
    }
    const approval = await poll(
      async () =>
        (
          await query<ApprovalRow>(
            pool,
            "SELECT id, state, action, item_id, args FROM pending_approvals WHERE id = $1",
            [created],
          )
        )[0],
      (row) => row !== undefined && row.state === "pending",
      `the reply approval ${String(created)} to be a pending row`,
    );
    if (approval.action !== "send" || approval.args?.body !== REPLY) {
      throw new Error(
        `the row is not the reply that was typed: action=${approval.action}, args=${JSON.stringify(approval.args)}`,
      );
    }
    // A reply proposal carries no `item_id`, which is what keeps loop-r2-02's fold from pairing it
    // with a draft: the card the person just raised stands on its own.
    if (approval.item_id !== null) {
      throw new Error(`the reply approval carries item_id ${approval.item_id} — it would fold`);
    }
    console.log(
      `  4. pending_approvals ${approval.id}: action='${approval.action}', state='${approval.state}', item_id=null, args.body="${REPLY}"`,
    );

    // ---- 5. No "Phase B" anywhere, and no horizontal overflow ----------------------------------------
    for (const viewport of [WIDE, PHONE, NARROW]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(400);
      const words = await phaseBWords(page);
      if (words.length > 0) {
        throw new Error(
          `"${PHASE_B}" is still on the page at ${viewport.width}: ${words.join(", ")}`,
        );
      }
      const overflow = await page.evaluate(measureOverflow);
      console.log(`  ${viewport.width}px: ${describeOverflow(overflow)}`);
      if (overflow.diff > 0) {
        throw new Error(
          `horizontal scroll at ${viewport.width}: the body is ${overflow.diff}px wider than the viewport`,
        );
      }
    }
    console.log(
      `  5. no "${PHASE_B}" in any element's text or title, and no overflow at 1440/390/320`,
    );

    // ---- 6. Put the fixture back ---------------------------------------------------------------------
    // The card this script raised is a new row on a seeded thread, and this stack is a fixture other
    // readers expect to find whole. Deleting the pending approval and reloading is the way back.
    await page.setViewportSize(WIDE);
    await query(pool, "DELETE FROM pending_approvals WHERE id = $1 AND state = 'pending'", [
      created,
    ]);
    created = null;
    await page.reload();
    await page.waitForSelector(".inbox-row", { timeout: 60_000 });
    await page.locator(`.inbox-row[data-thread-id="${thread.id}"]`).click();
    await page.locator(PANE).waitFor({ timeout: 20_000 });
    await poll(
      async () => page.locator(".thread-screen .approval-card").filter({ hasText: REPLY }).count(),
      (count) => count === 0,
      "the raised card to leave the restored fixture",
      5_000,
    );
    console.log("  6. the raised approval is deleted and the thread is back to the seeded frame");

    await page.close();
    console.log("loop-r2-03 shots written to", OUT);
  } finally {
    // A failure above must not leave the fixture carrying a reply nobody asked for.
    if (created !== null) {
      await query(pool, "DELETE FROM pending_approvals WHERE id = $1 AND state = 'pending'", [
        created,
      ]);
    }
    await browser.close();
    await pool.end();
  }
}

await main();
