// loop-r2-06 evidence: one approval count, and the two writes that had no writer.
//
// Every claim this story makes is a claim about *agreement* — between three surfaces that used to
// print three different numbers, and between a screen and the row it just wrote — and none of them
// can be shown against a mock:
//   1. The Inbox's subline, the "Needs approval" pill's badge and the pane's queue print the same
//      number (L2-07), and they go on agreeing after three approval-carrying threads are archived.
//      That second half is the rule itself: the number is the queue, not the threads under it, so an
//      approval on an archived thread is still counted (BACKLOG "Decisions").
//   2. Today's chip strip reads that same queue rather than running a `pending_approvals` query of
//      its own, which is why it could say one number while the Inbox said another on the same tick.
//   3. A task can be completed from the screen (L2-04): the checkbox writes to the hub, the row is
//      `done` in the database with `done_at` set, and the toast's Undo puts both back.
//
// Run against a stack that is already up (this script boots none of its own — it is the same live app
// a person is looking at):
//   OMNIS_E2E_DB=omnis_test_loop_r2_impl OMNIS_E2E_PORT_OFFSET=500 ZERO_SHARD_NUM=12 \
//     pnpm tsx tools/e2e/hold.ts --web
//   OMNIS_E2E_DB=omnis_test_loop_r2_impl pnpm tsx tools/e2e/shots-loop-r2-06.ts   (desktop :5673)
//
// The stack seeds 8 pending approvals over 5 threads. This script archives three of those threads —
// "an approval on an archived thread is still counted" is not a claim you can check without one — and
// creates a task, which it leaves open again. Restart the stack to re-seed after a run.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Page, chromium } from "@playwright/test";
import { Pool, query } from "../../packages/db/src/index.js";
import { assertNoOverflow, describeOverflow, measureOverflow } from "./overflow.js";
import { REPO_ROOT, loadOrCreateEnv } from "./stack.js";

const BASE = process.env.OMNIS_SHOTS_URL ?? "http://127.0.0.1:5673";
const OUT = join(REPO_ROOT, "docs/design/loop/r2/impl/loop-r2-06");

const WIDE = { width: 1440, height: 900 } as const;
/** The brief's 390x844, without `isMobile` — the same way the other shot tools take a narrow pass. */
const PHONE = { width: 390, height: 844 } as const;
/** SKILLS.md #11's four narrow widths, plus the two the brief names. */
const SWEEP = [320, 375, 414, 768] as const;

/** The copy this script asserts on, spelled once here so a reworded toast fails the check instead of
 *  quietly passing it. The three strings are the product's, quoted from the brief. */
const ARCHIVED = "Archived";
const TASK_TITLE = "Send Dana deck comments";
const COMPLETED = `Completed "${TASK_TITLE}"`;
const UNDO = "Undo";

/** The toast element as sonner renders it. `:not([data-removed="true"])` is the half that matters: a
 *  dismissed toast stays mounted for the length of its exit, and React writes the false case as
 *  `data-removed="false"` rather than dropping the attribute, so a bare `:not([data-removed])` would
 *  exclude nothing. tools/e2e/shots-loop-r1-06.ts carries the full note. */
const TOAST = '[data-sonner-toast]:not([data-removed="true"])';

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

/** What the toast is saying, or null when there is none on screen. Read from the toast's two parts
 *  rather than its whole text, so "the sentence is right" and "the button is there" are two
 *  assertions instead of one string that could pass on a reworded message. The message comes from
 *  `[data-title]` and not the toast element's own text: sonner renders the action button as a sibling
 *  of that div, so the element's text is `ArchivedUndo`. */
async function readToast(page: Page): Promise<{ message: string; action: string | null } | null> {
  const toast = page.locator(TOAST).first();
  if ((await toast.count()) === 0) return null;
  const message = await toast.locator("[data-title]").textContent();
  const button = toast.locator("[data-button]");
  return {
    message: (message ?? "").trim(),
    action: (await button.count()) === 0 ? null : ((await button.textContent()) ?? "").trim(),
  };
}

/** Wait for a toast whose sentence satisfies `ok`, and hand it back. */
async function waitForToast(
  page: Page,
  ok: (toast: { message: string; action: string | null }) => boolean,
  what: string,
): Promise<{ message: string; action: string | null }> {
  return poll(
    () => readToast(page),
    (toast) => toast !== null && ok(toast),
    what,
    10_000,
  ).then((toast) => {
    if (toast === null) throw new Error(`no toast for ${what}`);
    return toast;
  });
}

/** `g` then a letter — A5 §2.4's go-to pair, which useKeymap resolves within 300ms of the `g`. */
async function goto(page: Page, key: string): Promise<void> {
  await page.keyboard.press("g");
  await page.keyboard.press(key);
}

function leadingNumber(text: string, what: string): number {
  const match = /^(\d+)/.exec(text.trim());
  if (match === null) throw new Error(`${what} reads "${text.trim()}" — no number in it`);
  return Number(match[1]);
}

/** The queue's own number: the card on top plus what the header behind it says ("7 more waiting" →
 *  8). Read as two facts rather than off the header alone, so a stack that had lost its card fails
 *  here instead of quietly returning 7. */
async function queueNumber(page: Page): Promise<number> {
  const cards = await page.locator(".approval-card").count();
  if (cards !== 1) throw new Error(`the queue is drawing ${cards} cards, not 1`);
  const header = ((await page.locator(".approval-stack__header").textContent()) ?? "").trim();
  const more = /^(\d+) more waiting$/.exec(header);
  if (more === null) throw new Error(`the queue's header reads "${header}"`);
  return Number(more[1]) + 1;
}

/** The three numbers the Inbox prints for one queue, read together: the subline's "N need approval",
 *  the "Needs approval" pill's badge, and the pane's 1 + "N more waiting". */
async function numbers(page: Page): Promise<{ subline: number; badge: number; queue: number }> {
  return {
    subline: leadingNumber(
      (await page.locator(".inbox-card__approvals").textContent()) ?? "",
      "the subline",
    ),
    badge: leadingNumber(
      (await page.locator(".inbox-card__pill-count").textContent()) ?? "",
      "the pill's badge",
    ),
    queue: await queueNumber(page),
  };
}

/** The check L2-07 is: three surfaces, one number, and the database agrees with all three. A Set is
 *  the whole assertion — three readings of one queue cannot differ from each other, and the fourth
 *  member is what says they are reading the real thing rather than a stale replica. */
function assertAgree(
  where: string,
  shown: { subline: number; badge: number; queue: number },
  db: number,
): void {
  const all = [shown.subline, shown.badge, shown.queue, db];
  if (new Set(all).size !== 1) {
    throw new Error(
      `${where}: the subline says ${shown.subline}, the pill ${shown.badge}, ` +
        `the queue 1 + ${shown.queue - 1}, and pending_approvals has ${db}`,
    );
  }
}

/** No horizontal scroll and nothing laid out past the viewport, at one width, on one screen. Both
 *  readings are taken: `measureOverflow` is the repo's own guard (body scrollWidth plus a visible
 *  element scan — see overflow.ts for what each half catches), and the document element's own
 *  scrollWidth is the reading the brief asks for by name. */
async function checkOverflow(page: Page, where: string, width: number): Promise<void> {
  await page.setViewportSize({ width, height: width === WIDE.width ? WIDE.height : PHONE.height });
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(measureOverflow);
  const root = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  console.log(`  ${where} at ${width}px: ${describeOverflow(overflow)}, documentElement ${root}px`);
  assertNoOverflow(`${where} at ${width}`, overflow);
  if (root > 0) {
    throw new Error(`the document element scrolls sideways at ${where} ${width}: ${root}px`);
  }
}

async function pendingInDb(pool: Pool): Promise<number> {
  const rows = await query<{ n: string }>(
    pool,
    "SELECT count(*) AS n FROM pending_approvals WHERE state = 'pending'",
  );
  return Number(rows[0]?.n ?? -1);
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
    // ---- 1. One number in three places ------------------------------------------------------------
    console.log("Inbox — one approval count, three surfaces");
    const page = await browser.newPage({ viewport: WIDE });
    await page.goto(BASE);
    await page.waitForSelector(".inbox-row", { timeout: 60_000 });
    // The pane opens itself here: >=1280 with approvals pending is the one case where the queue is a
    // column rather than a sheet, so all three numbers are on screen at once without anyone asking.
    await page.locator(".approval-stack").waitFor({ timeout: 30_000 });

    const atRest = await numbers(page);
    const dbAtRest = await poll(
      () => pendingInDb(pool),
      (n) => n === atRest.subline,
      `pending_approvals to read ${atRest.subline} pending`,
    );
    assertAgree("at rest", atRest, dbAtRest);
    console.log(
      `  subline ${atRest.subline}, pill ${atRest.badge}, queue 1 + ${atRest.queue - 1}, ` +
        `pending_approvals ${dbAtRest}`,
    );

    // A bare `e` with nothing selected does nothing — Inbox.tsx's keymap returns before the archive
    // when `selectedId` is null, which is why every archive below is preceded by a `j`. The row set
    // is what says so: archiving a row that carries an approval moves none of the three numbers, so
    // the count cannot be the witness here.
    const rowsBefore = await page.locator(".inbox-row").count();
    await page.keyboard.press("e");
    await page.waitForTimeout(800);
    const rowsAfter = await page.locator(".inbox-row").count();
    if (rowsAfter !== rowsBefore) {
      throw new Error(`a bare \`e\` archived a row: ${rowsBefore} rows became ${rowsAfter}`);
    }
    if ((await readToast(page)) !== null) {
      throw new Error("a bare `e` with nothing selected raised a toast");
    }
    console.log(`  a bare \`e\` before any \`j\` left all ${rowsBefore} rows where they were`);

    // The three archives are aimed with the filter rather than by luck: the "Needs approval" pill
    // lists the threads that carry one, so `j` `e` three times is three threads whose still-pending
    // approval has to survive the archive. Rows without an approval would prove nothing about the
    // rule this check exists for.
    await page.getByRole("radio", { name: "Needs approval" }).click();
    await page.locator(".inbox-card__pill-count").waitFor({ timeout: 5_000 });
    await page.waitForTimeout(300);
    const archived: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      await page.keyboard.press("j");
      const id = await page
        .locator('.inbox-row[aria-selected="true"]')
        .getAttribute("data-thread-id");
      if (id === null) throw new Error("`j` selected no row to archive");
      if (archived.includes(id))
        throw new Error(`\`j\` came back to ${id} — the list did not shrink`);
      await page.keyboard.press("e");
      await waitForToast(page, (toast) => toast.message === ARCHIVED, `an "${ARCHIVED}" toast`);
      archived.push(id);
    }
    await poll(
      () =>
        query<{ n: string }>(
          pool,
          "SELECT count(*) AS n FROM threads WHERE id = ANY($1::uuid[]) AND archived_at IS NOT NULL",
          [archived],
        ),
      (rows) => Number(rows[0]?.n ?? 0) === 3,
      "the three archived threads to carry archived_at",
    );
    console.log(`  archived three threads carrying approvals: ${archived.join(", ")}`);

    // Escape is the pane's one way out, and at this width the queue is put straight back (>=1280 with
    // approvals pending) — which is also why the queue's number is readable right after it.
    await page.keyboard.press("Escape");
    await page.locator(".approval-stack").waitFor({ timeout: 10_000 });

    const after = await numbers(page);
    const dbAfter = await poll(
      () => pendingInDb(pool),
      (n) => n === after.subline,
      `pending_approvals to read ${after.subline} pending`,
    );
    assertAgree("after three archives", after, dbAfter);
    console.log(
      `  after the archives: subline ${after.subline}, pill ${after.badge}, ` +
        `queue 1 + ${after.queue - 1}, pending_approvals ${dbAfter}`,
    );

    // The same rule from the other side, and the reason the check above is not vacuous: those three
    // threads are archived and their approvals are still in the number on screen.
    const stillCounted = Number(
      (
        await query<{ n: string }>(
          pool,
          `SELECT count(*) AS n FROM pending_approvals
            WHERE state = 'pending' AND thread_id = ANY($1::uuid[])`,
          [archived],
        )
      )[0]?.n ?? 0,
    );
    if (stillCounted === 0) {
      throw new Error(
        "none of the archived threads carried a pending approval — this run says nothing about " +
          "an approval on an archived thread still being counted",
      );
    }
    console.log(`  ${stillCounted} of those approvals are still pending on an archived thread`);

    // L2-24: every collapsed row names the conversation it belongs to. The expected names come from
    // the seed's own `threads` rows rather than from the screen, so a row that named its thread with
    // the wrong string fails here. One description can belong to more than one thread (the seed's
    // three "omnis launch sync" approvals), so the row has to match one of its thread's names.
    const names = new Map<string, Set<string>>();
    for (const row of await query<{
      description: string;
      title: string | null;
      external_id: string;
    }>(
      pool,
      `SELECT p.description, t.title, t.external_id
         FROM pending_approvals p JOIN threads t ON t.id = p.thread_id
        WHERE p.state = 'pending'`,
    )) {
      const set = names.get(row.description) ?? new Set<string>();
      set.add(row.title ?? row.external_id);
      names.set(row.description, set);
    }
    const collapsed = page.locator(".approval-stack__row");
    const collapsedCount = await collapsed.count();
    if (collapsedCount !== after.queue - 1) {
      throw new Error(
        `the queue draws ${collapsedCount} collapsed rows, not the ${after.queue - 1} its header advertises`,
      );
    }
    for (let i = 0; i < collapsedCount; i += 1) {
      const row = collapsed.nth(i);
      const text = ((await row.locator(".approval-stack__row-text").textContent()) ?? "").trim();
      const where = ((await row.locator(".approval-stack__row-where").textContent()) ?? "").trim();
      const expected = names.get(text);
      if (expected === undefined) throw new Error(`no pending_approvals row carries "${text}"`);
      const allowed = [...expected].map((name) => `in ${name}`);
      if (!allowed.includes(where)) {
        throw new Error(
          `the row for "${text}" says "${where}"; its thread is ${allowed.join(" or ")}`,
        );
      }
    }
    console.log(`  all ${collapsedCount} queue rows name their thread with "in …"`);

    // The shot is the Inbox as the story found it. The filter goes back to All first: the pill's badge
    // is the queue's number whether or not that pill is filtering, and a list of two rows under a
    // badge of eight — true, but a picture that needs this script's commentary to be read — would be
    // the artifact's only impression. The toast is waited out for the same kind of reason: it sits
    // over the corner the queue's rows are in.
    await page.getByRole("radio", { name: "All", exact: true }).click();
    await poll(
      () => readToast(page),
      (toast) => toast === null,
      "the archive's toast to clear",
      20_000,
    );
    const shot = await numbers(page);
    assertAgree("in 1440.png", shot, dbAfter);
    await page.screenshot({ path: join(OUT, "1440.png") });
    console.log(
      `  1440.png: subline ${shot.subline}, pill ${shot.badge}, queue 1 + ${shot.queue - 1}`,
    );

    // ---- 2. Today reads the shell's queue, not a query of its own ---------------------------------
    await goto(page, "t");
    await page
      .getByRole("heading", { name: `Pending approvals (${shot.subline})` })
      .waitFor({ timeout: 15_000 });
    const greeting = ((await page.locator(".today-screen__greeting").textContent()) ?? "").trim();
    if (!greeting.includes(`${shot.subline} approvals pending`)) {
      throw new Error(`Today's greeting reads "${greeting}" with ${shot.subline} pending`);
    }
    console.log(`  Today's greeting and heading both read ${shot.subline}: "${greeting}"`);

    // ---- 3. Tasks: the checkbox writes -------------------------------------------------------------
    console.log("Tasks — the checkbox writes to the hub");
    await goto(page, "k");
    await page.locator(".tasks-screen").waitFor({ timeout: 15_000 });
    // Created the way the screen's own quick-add does it — POST /tasks, which the desktop's dev server
    // proxies to the hub. It lands in Someday because `createTask` writes no `due_at`, and a task with
    // no date is what that tab means.
    const created = await page.request.post(`${BASE}/tasks`, { data: { title: TASK_TITLE } });
    if (!created.ok()) {
      throw new Error(`POST /tasks answered ${created.status()}: ${await created.text()}`);
    }
    const taskId = ((await created.json()) as { id: string }).id;
    await page.getByRole("radio", { name: "Someday" }).click();
    const checkbox = page.getByRole("checkbox", { name: TASK_TITLE });
    await checkbox.waitFor({ timeout: 20_000 });
    await checkbox.click();
    const doneToast = await waitForToast(
      page,
      (toast) => toast.message === COMPLETED && toast.action === UNDO,
      `the task's "${COMPLETED}" toast with its ${UNDO}`,
    );
    const done = await poll(
      async () => {
        const rows = await query<{ state: string; done_at: Date | null }>(
          pool,
          "SELECT state, done_at FROM tasks WHERE id = $1",
          [taskId],
        );
        return { state: rows[0]?.state ?? "missing", doneAt: rows[0]?.done_at ?? null };
      },
      (it) => it.state === "done" && it.doneAt !== null,
      `tasks.state = 'done' and done_at set for ${taskId}`,
    );
    console.log(
      `  ticked "${TASK_TITLE}": "${doneToast.message}", and the row is state='${done.state}' with done_at set`,
    );

    // The toast's Undo is the write's own way back — no confirmation, because a checkbox is already
    // the answer to "did you mean it" (the same rule the archive's Undo follows).
    await page.getByRole("button", { name: UNDO }).first().click();
    const reopened = await poll(
      async () => {
        const rows = await query<{ state: string; done_at: Date | null }>(
          pool,
          "SELECT state, done_at FROM tasks WHERE id = $1",
          [taskId],
        );
        return { state: rows[0]?.state ?? "missing", doneAt: rows[0]?.done_at ?? null };
      },
      (it) => it.state === "open" && it.doneAt === null,
      `tasks.state = 'open' and done_at cleared for ${taskId}`,
    );
    // The row's way back into the tab is the replica catching up on the same state, so waiting for it
    // is the second half of the same assertion — a `done` task leaves every tab, an open one returns.
    await checkbox.waitFor({ timeout: 20_000 });
    console.log(
      `  Undo: state='${reopened.state}' with done_at cleared, and the row is listed under Someday again`,
    );

    // ---- 4. 390: Today's chips, and the way into the thread -----------------------------------------
    await page.setViewportSize(PHONE);
    await goto(page, "t");
    const approvals = page.getByRole("heading", { name: `Pending approvals (${shot.subline})` });
    await approvals.waitFor({ timeout: 15_000 });
    await page.locator(".today-screen__chip").first().click();
    const openLink = page.locator(".approval-open-link");
    await openLink.waitFor({ timeout: 10_000 });
    const label = ((await openLink.textContent()) ?? "").trim();
    if (label !== "Open thread") {
      throw new Error(`the expanded card's link reads "${label}" at 390, not "Open thread"`);
    }
    // The task's own toast is still running and lands in the same corner as the chip strip; the shot is
    // the approvals, so it is waited out.
    await poll(
      () => readToast(page),
      (toast) => toast === null,
      "the task's toast to clear",
      20_000,
    );
    // The chip strip is taller than the fold at 844 once a card is open under it, so the scroll is what
    // the shot needs and not a nicety: `scrollIntoViewIfNeeded` on the link, which is *below* the fold —
    // asking the heading instead is a no-op (it is already visible) and the artifact is a card cut off
    // at the bottom edge with the link it exists to show never in frame. Both boxes are then required to
    // be inside the viewport, so a picture that had lost one of them fails here rather than quietly
    // shipping.
    await openLink.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const [headingBox, linkBox] = await Promise.all([
      approvals.boundingBox(),
      openLink.boundingBox(),
    ]);
    if (headingBox === null || linkBox === null) {
      throw new Error("Today's approvals heading or its open link has no box to measure");
    }
    for (const [what, box] of [
      ["the approvals heading", headingBox],
      ["the open link", linkBox],
    ] as const) {
      if (box.y < 0 || box.y + box.height > PHONE.height) {
        throw new Error(
          `${what} is outside the 390x844 viewport (y ${box.y}..${box.y + box.height}) — 390.png would not show it`,
        );
      }
    }
    await page.screenshot({ path: join(OUT, "390.png") });
    console.log(`  390.png: Today's chips with one expanded, its card offering "${label}"`);

    // ---- the overflow sweep ------------------------------------------------------------------------
    // SKILLS.md #11: no horizontal scroll at any narrow width. Swept on Today with a card expanded,
    // because that is the widest this screen has to be, and then on the Inbox at the three widths the
    // brief names.
    console.log("Overflow");
    for (const width of [PHONE.width, ...SWEEP, WIDE.width]) {
      await checkOverflow(page, "Today", width);
    }
    await goto(page, "i");
    await page.waitForSelector(".inbox-row", { timeout: 15_000 });
    for (const width of [WIDE.width, PHONE.width, 320]) {
      await checkOverflow(page, "Inbox", width);
    }

    await page.close();
    console.log("loop-r2-06 shots written to", OUT);
  } finally {
    await browser.close();
    await pool.end();
  }
}

await main();
