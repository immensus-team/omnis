// loop-r2-01 evidence: the approval card's Edit and Respond, against the live stack rather than a
// mock. The two defects this story fixes are both claims about *what did not happen* — a click that
// sent a decision it should not have sent, and a decision that carried no reply — and neither is
// visible on screen: a card that is gone and a row that is still `pending` look the same until the
// request log and the database are read. So every check here reads one of those two.
//
// Run against a stack that is already up (this script boots none of its own):
//   OMNIS_E2E_DB=omnis_test_loop_r2_impl OMNIS_E2E_PORT_OFFSET=500 ZERO_SHARD_NUM=12 \
//     pnpm tsx tools/e2e/hold.ts --web
//   OMNIS_E2E_DB=omnis_test_loop_r2_impl pnpm tsx tools/e2e/shots-loop-r2-01.ts
//
// The checks, in the order a person hits them:
//   1. The card says where the action goes ("Reply in #omnis-launch · Slack") and quotes the message
//      it would send, where it used to say only "Send needs your approval".
//   2. Edit opens the message and decides nothing: no POST /decide left the browser and
//      `pending_approvals.state` is still 'pending'. 1440.png is this state.
//   3. The card as it is met, in the phone sheet at 390 — the sheet dragged up to its tall snap,
//      because at the peek the card is below the fold with no scroll range left to reach it.
//      390.png is this state.
//   4. Save & send, then Send in the prompt, is what decides — with the edited text in
//      `decided_args->>'body'`.
//   5. The second card names its own thread, with all four buttons (the round-2 "four equal buttons"
//      complaint was on the card nobody could tell apart from its neighbours).
//   6. No horizontal overflow at 1440, 390 or 320 — the sweep runs with that four-button card up.
//   7. Respond opens a reply field and sends nothing until there is something to send, or until it
//      is entered — then the decision is 'respond' and carries the reply.
//
// The two cards the brief names — the seed's "Reply to #omnis-launch?" (allow_respond: false) and
// densify's high-risk "Share the latest Brightstone purchase agreement?" (all four allowed) — are
// not on the same thread in this stack. `densify` hands `asks[0]` to the first thread by
// `created_at`, and here that thread is the one titled "omnis"; #omnis-launch is the seed's own
// card plus "Put the Friday 14:00 design review on the calendar?". Both cards are checked, each in
// the thread it actually lives on — found by the row's `data-thread-id`, never by position.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Page, chromium } from "@playwright/test";
import { Pool, query } from "../../packages/db/src/index.js";
import { describeOverflow, measureOverflow } from "./overflow.js";
import { REPO_ROOT, loadOrCreateEnv } from "./stack.js";

const BASE = process.env.OMNIS_SHOTS_URL ?? "http://127.0.0.1:5673";
const OUT = join(REPO_ROOT, "docs/design/loop/r2/impl/loop-r2-01");

const WIDE = { width: 1440, height: 900 } as const;
/** The brief's 390x844, without `isMobile` — the same way the other shot tools take a narrow pass. */
const PHONE = { width: 390, height: 844 } as const;
/** SKILLS.md #11's narrowest width, and the one the four buttons have to survive (L2-37). */
const NARROW = { width: 320, height: 844 } as const;

/** The copy this script asserts on, spelled once so a reworded card fails the check instead of
 *  quietly passing it. */
const REPLY = "Reply to #omnis-launch?";
const AGREEMENT = "Share the latest Brightstone purchase agreement?";
const EDITED = "Yes, I will review it tomorrow morning.";
const RESPONSE = "use Tuesday instead";

/** Poll a read until it says what the write was supposed to. The writes go to the hub over HTTP and
 *  the screens read through Zero's replica, so a database assertion is always "eventually" — a
 *  one-shot read right after the click would be a race dressed as a check. */
async function poll<T>(
  read: () => Promise<T>,
  ok: (value: T) => boolean,
  what: string,
  timeout = 15_000,
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
  state: string;
  decision: string | null;
  decided_args: { body?: string; response?: string } | null;
}

const ROW_COLUMNS = "id, thread_id, state, decision, decided_args";

async function approval(pool: Pool, description: string): Promise<ApprovalRow> {
  const rows = await query<ApprovalRow>(
    pool,
    `SELECT ${ROW_COLUMNS} FROM pending_approvals WHERE description = $1`,
    [description],
  );
  const row = rows[0];
  if (row === undefined) throw new Error(`no pending_approvals row carries "${description}"`);
  return row;
}

async function state(pool: Pool, id: string): Promise<ApprovalRow> {
  const rows = await query<ApprovalRow>(
    pool,
    `SELECT ${ROW_COLUMNS} FROM pending_approvals WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  if (row === undefined) throw new Error(`pending_approvals row ${id} is gone`);
  return row;
}

/** Put a consumed fixture back. `WHERE state = 'decided'` is the guard: a row the kernel has already
 *  executed (or that something else decided in the meantime) is left exactly as it is. */
async function restore(pool: Pool, id: string): Promise<void> {
  await query(
    pool,
    `UPDATE pending_approvals
        SET state = 'pending', decision = NULL, decided_args = NULL, decided_at = NULL
      WHERE id = $1 AND state = 'decided'`,
    [id],
  );
}

/** A thread's title — the name the card's header is supposed to be printing. */
async function threadTitle(pool: Pool, id: string | null): Promise<string> {
  if (id === null) throw new Error("the approval is not on a thread, so there is no name to print");
  const rows = await query<{ title: string | null }>(
    pool,
    "SELECT title FROM threads WHERE id = $1",
    [id],
  );
  const title = rows[0]?.title ?? null;
  if (title === null) throw new Error(`thread ${id} has no title for the card to name`);
  return title;
}

/** A pending approval's card, found by what it says rather than by where it sits — the queue's
 *  order is risk-then-newest and the thread's flow is item order, and neither is this script's
 *  subject. */
function cardFor(page: Page, description: string) {
  return page.locator(".approval-card").filter({ hasText: description }).first();
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
    const agreement = await approval(pool, AGREEMENT);
    const replyTitle = await threadTitle(pool, seeded.thread_id);
    const agreementTitle = await threadTitle(pool, agreement.thread_id);
    // This is the name the card's header has to print, so an empty or drifting thread title fails
    // here rather than turning into a card that quietly drops half its sentence.
    if (replyTitle.trim() === "" || agreementTitle.trim() === "") {
      throw new Error(`threads without titles: "${replyTitle}" / "${agreementTitle}"`);
    }
    console.log(`Cards: "${REPLY}" on ${replyTitle}, "${AGREEMENT}" on ${agreementTitle}`);

    const page = await browser.newPage({ viewport: WIDE });
    /** Every `/decide` the browser sent. Checks 2 and 4 are exactly this list's length: a card that
     *  is gone and a decision that was never sent look identical on screen. */
    const decided: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/decide")) {
        decided.push(request.url());
      }
    });
    /** The thread in front of the pane, opened the way a person opens it: the row the approval's
     *  own `thread_id` names, never the row at some position. */
    const openThread = async (threadId: string | null): Promise<void> => {
      if (threadId === null) throw new Error("the approval has no thread to open");
      await page.locator(`.inbox-row[data-thread-id="${threadId}"]`).click();
    };

    await page.goto(BASE);
    await page.waitForSelector(".inbox-row", { timeout: 60_000 });
    await openThread(seeded.thread_id);

    const replyCard = cardFor(page, REPLY);
    await replyCard.waitFor({ timeout: 20_000 });

    // ---- 1. What the card says it would send, and to where ---------------------------------------
    const header = (await replyCard.locator(".approval-card__header").textContent())?.trim();
    const expectedHeader = `Reply in ${replyTitle} · Slack`;
    if (header !== expectedHeader) {
      throw new Error(`the card's header reads "${header ?? ""}", not "${expectedHeader}"`);
    }
    const quoted = (await replyCard.locator(".approval-card__body").textContent())?.trim();
    const seededBody = "Yes, I will review it today.";
    if (quoted !== seededBody) {
      throw new Error(`the card quotes "${quoted ?? ""}", not the message "${seededBody}"`);
    }
    // The seed's card is the one with no Respond (allow_respond: false); the other one has all four.
    const replyButtons = await replyCard.getByRole("button", { name: "Respond" }).count();
    if (replyButtons !== 0) {
      throw new Error(`"${REPLY}" carries a Respond button it is not allowed to carry`);
    }
    console.log(`  1. the card reads "${header}" and quotes the message it would send`);

    // ---- 2. Edit opens the message; the click decides nothing ------------------------------------
    const sentBeforeEdit = decided.length;
    await replyCard.getByRole("button", { name: "Edit" }).click();
    const editor = replyCard.getByRole("textbox", { name: "Edit message" });
    await editor.waitFor({ timeout: 5_000 });
    if ((await editor.inputValue()) !== seededBody) {
      throw new Error(`the editor opened on "${await editor.inputValue()}", not on the message`);
    }
    // Give a POST that was going to be sent the time to be sent before the log is read — the bug
    // this replaces posted from the click's own handler, so it would have landed long before now.
    await page.waitForTimeout(1_000);
    if (decided.length !== sentBeforeEdit) {
      throw new Error(
        `clicking Edit sent a decision: ${decided.slice(sentBeforeEdit).join(", ")} ` +
          `(${sentBeforeEdit} before the click, ${decided.length} after)`,
      );
    }
    const afterEditClick = await state(pool, seeded.id);
    if (afterEditClick.state !== "pending") {
      throw new Error(
        `clicking Edit moved ${seeded.id} to state='${afterEditClick.state}' with ` +
          `decision='${afterEditClick.decision ?? "null"}' — nothing was sent, but the row changed`,
      );
    }
    console.log("  2. Edit opened the message; no /decide was sent and the row is still pending");
    await page.screenshot({ path: join(OUT, "1440.png") });

    // ---- 3. The read state at 390, in the phone sheet ----------------------------------------------
    // Back to the read state first: the 390 frame is the card as it is met, and the editor at this
    // width would be a picture of a textarea rather than of what the card says. The click is the
    // cancel, not an Escape — Escape belongs to the sheet at this tier and would take the pane with
    // it (the card stops that press, but the brief's 390 frame is the sheet *open*).
    await replyCard.getByRole("button", { name: "Cancel" }).click();
    await page.setViewportSize(PHONE);
    await page.waitForTimeout(500);
    if ((await page.locator('[data-testid="detail-pane"]').count()) === 0) {
      throw new Error("the pane is gone at 390 — the sheet this frame is about is not on screen");
    }
    await replyCard.waitFor({ timeout: 10_000 });
    // The sheet comes up at its peek — half the window — and the card is below the fold there with no
    // way to reach it: the pane's own scroll range ends before the card's bottom, so scrolling cannot
    // bring it up. The frame is therefore composed the way a person composes it, by dragging the
    // grabber to the sheet's tall snap (`handleOnly` in narrow-drawer.tsx is why the gesture lives on
    // that one 5px element). Then the card is measured, because a screenshot of the wrong 844px would
    // satisfy every assertion below while showing nobody the thing this story is about.
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
    const framed = await replyCard.boundingBox();
    if (framed === null || framed.y < 0 || framed.y + framed.height > PHONE.height) {
      throw new Error(`the card is not in the 390 frame: ${JSON.stringify(framed)}`);
    }
    const phoneHeader = (await replyCard.locator(".approval-card__header").textContent())?.trim();
    if (phoneHeader !== expectedHeader) {
      throw new Error(`the card's header at 390 reads "${phoneHeader ?? ""}"`);
    }
    if ((await replyCard.locator(".approval-card__body").count()) === 0) {
      throw new Error("the card at 390 is not quoting its message");
    }
    await page.screenshot({ path: join(OUT, "390.png") });
    console.log(`  3. at 390 the sheet shows "${phoneHeader}" over the quoted message`);

    // ---- 4. Save & send, then Send, is what decides -------------------------------------------------
    await page.setViewportSize(WIDE);
    await page.waitForTimeout(500);
    await replyCard.getByRole("button", { name: "Edit" }).click();
    await editor.waitFor({ timeout: 5_000 });
    await editor.fill(EDITED);
    await replyCard.getByRole("button", { name: "Save & send" }).click();

    const prompt = page.getByRole("alertdialog");
    await prompt.waitFor({ timeout: 5_000 });
    // The prompt says which message it is about to send — that is the round-2 complaint (NC2-05)
    // about a question that named nothing.
    if (!(await prompt.textContent())?.includes(EDITED)) {
      throw new Error("the prompt does not carry the edited message it is about to send");
    }
    await prompt.getByRole("button", { name: "Send" }).click();

    const committed = await poll(
      async () => state(pool, seeded.id),
      (row) => row.decision === "edit",
      `pending_approvals.decision = 'edit' for ${seeded.id}`,
    );
    if (committed.decided_args?.body !== EDITED) {
      throw new Error(
        `the row carries decided_args ${JSON.stringify(committed.decided_args)}, not the edited ` +
          `"${EDITED}"`,
      );
    }
    if (decided.length !== sentBeforeEdit + 1) {
      throw new Error(
        `expected one /decide after "Send", saw ${decided.length - sentBeforeEdit}: ` +
          `${decided.slice(sentBeforeEdit).join(", ")}`,
      );
    }
    console.log(`  4. "Save & send" then "Send" decided it: decision='edit', body='${EDITED}'`);
    // Straight back, before the next check runs: this stack is a fixture other readers expect to
    // find whole, and a failure two checks later must not leave it short a card.
    await restore(pool, seeded.id);

    // ---- 5. The other card, on its own thread ------------------------------------------------------
    // densify's high-risk card is not on the seed's thread (see the header), so this half opens the
    // thread the row itself names rather than assuming the pane still holds both. Opening it also
    // puts a four-button card in front of the overflow sweep below, which is what the 320px rule is
    // about — the seed's card carries no Respond, so it is three buttons, not four.
    await openThread(agreement.thread_id);
    const agreementCard = cardFor(page, AGREEMENT);
    await agreementCard.waitFor({ timeout: 20_000 });
    const agreementHeader = (
      await agreementCard.locator(".approval-card__header").textContent()
    )?.trim();
    if (agreementHeader?.includes(agreementTitle) !== true) {
      throw new Error(
        `"${AGREEMENT}" reads "${agreementHeader ?? ""}", which does not name ${agreementTitle}`,
      );
    }
    for (const label of ["Approve", "Edit", "Respond", "Ignore"]) {
      if ((await agreementCard.getByRole("button", { name: label }).count()) === 0) {
        throw new Error(`"${AGREEMENT}" is missing its ${label} button`);
      }
    }
    console.log(`  5. "${agreementHeader}" leads its card, with the four buttons on it`);

    // ---- 6. No horizontal overflow ---------------------------------------------------------------
    // The card's action row is the one thing here that could push the page wide: four labels that do
    // not fit at 320 are allowed to scroll inside the card, never to overflow the pane.
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

    // ---- 7. Respond sends nothing until there is something to send ---------------------------------
    await page.setViewportSize(WIDE);
    await page.waitForTimeout(400);
    const sentBeforeRespond = decided.length;
    await agreementCard.getByRole("button", { name: "Respond" }).click();
    const field = agreementCard.getByRole("textbox", { name: "Reply to the agent" });
    await field.waitFor({ timeout: 5_000 });
    if (!(await agreementCard.getByRole("button", { name: "Send to agent" }).isDisabled())) {
      throw new Error('"Send to agent" is live while the reply is empty');
    }
    await page.waitForTimeout(1_000);
    if (decided.length !== sentBeforeRespond) {
      throw new Error(
        `clicking Respond sent a decision: ${decided.slice(sentBeforeRespond).join(", ")}`,
      );
    }
    await field.fill(RESPONSE);
    if (decided.length !== sentBeforeRespond) {
      throw new Error("typing a reply sent it — nothing sends until it is sent");
    }
    await field.press("Enter");
    const answered = await poll(
      async () => state(pool, agreement.id),
      (row) => row.decision === "respond",
      `pending_approvals.decision = 'respond' for ${agreement.id}`,
    );
    if (answered.decided_args?.response !== RESPONSE) {
      throw new Error(
        `the row carries decided_args ${JSON.stringify(answered.decided_args)}, not the reply ` +
          `"${RESPONSE}"`,
      );
    }
    console.log(`  7. Respond held until "${RESPONSE}", then decided with it`);
    await restore(pool, agreement.id);

    await page.close();
    console.log("loop-r2-01 shots written to", OUT);
  } finally {
    await browser.close();
    await pool.end();
  }
}

await main();
