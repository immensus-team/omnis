// loop-r1-06 evidence: the write-feedback toast, against the live stack rather than a mock. Every
// claim the story makes is a claim about a *sequence* — a row leaves, a toast appears, a key brings
// it back, an ignored card's decision is held and then taken back — and a sequence is what a mock
// cannot show. Three of the four checks also read the database, because "the card is gone" and "the
// decision was never sent" look identical on screen.
//
// Run against a stack that is already up (this script boots none of its own — it is the same live
// app a person is looking at):
//   OMNIS_E2E_DB=omnis_test_loop_r1_e2e OMNIS_E2E_PORT_OFFSET=200 ZERO_SHARD_NUM=9 \
//     pnpm tsx tools/e2e/hold.ts --web
//   pnpm tsx tools/e2e/shots-loop-r1-06.ts   (desktop http://127.0.0.1:5373)
//
// Five checks, in the order a person hits them:
//   1. Archive with `e`: the row leaves, "Archived · Undo" is on screen, and `z` puts the row back —
//      with threads.archived_at NULL again, which is the half the screen cannot prove.
//   2. Two archives 3s apart (`j e j e`): the second "Archived" toast keeps its own clock rather
//      than inheriting the first one's, and `z` still undoes the second archive. The row the first
//      archive left behind is restored from the Archived view, so the seed is whole.
//   3. Ignore: the card leaves the queue, the toast offers the undo, and the Undo means the hub was
//      never told — asserted on the *requests* (none) and then on state='pending' still being there.
//   4. Approve through the confirmation: "Approved: …" with no undo, and decision='accept' in the
//      database.
//   5. 390: the toast clears the BottomBar instead of sitting behind it.
//
// The 390 pass is a resize of the same page rather than a second page: both screenshots the brief
// wants are the same moment at two widths.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Page, chromium } from "@playwright/test";
import { Pool, query } from "../../packages/db/src/index.js";
import { describeOverflow, measureOverflow } from "./overflow.js";
import { REPO_ROOT, loadOrCreateEnv } from "./stack.js";

const BASE = process.env.OMNIS_SHOTS_URL ?? "http://127.0.0.1:5373";
const OUT = join(REPO_ROOT, "docs/design/loop/r1/impl/loop-r1-06");

const WIDE = { width: 1440, height: 900 } as const;
/** The brief's 390x844, without `isMobile` — the same way the other shot tools take a narrow pass. */
const PHONE = { width: 390, height: 844 } as const;
/** SKILLS.md #11's four narrow widths: no horizontal overflow at even one of them. */
const SWEEP = [320, 375, 414, 768] as const;

/** The copy this script asserts on, spelled once here so a reworded toast fails the check instead of
 *  quietly passing it. The three messages are the product's, quoted from the brief. */
const ARCHIVED = "Archived";
const RESTORED = "Moved to Inbox";
const IGNORED = "Ignored: ";
const APPROVED = "Approved: ";
const UNDO = "Undo";

/** The toast element as sonner renders it. The merge of plan/motion-oss replaced the shell's own
 *  pill with this host, so the class names this script used to query (`.toast__pill` and its two
 *  parts) are gone; `[data-sonner-toast]` is what every sonner toast carries, and it is the same
 *  handle tools/e2e/shots-motion-oss.ts measures against.
 *
 *  `:not([data-removed="true"])` is the half that matters for the checks below: sonner keeps a
 *  dismissed toast's element mounted for the length of its exit, and reading that one would be
 *  reading the sentence that just expired — which is exactly the bug check 1b is hunting for. React
 *  writes the false case as `data-removed="false"` rather than dropping the attribute, so a bare
 *  `:not([data-removed])` would exclude nothing. */
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
 *  `[data-title]` and not the toast element's own text: sonner renders the action button as a
 *  sibling of that div, so the element's text is `ArchivedUndo`.
 *
 *  `.first()` throughout because the app keeps one toast slot (`App.tsx` raises every message under
 *  one id), so more than one of these on screen is itself the failure the next check would report. */
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

/** Let the enter animation finish before a screenshot. Waiting for the *message* is not enough: the
 *  toast animates in from opacity 0 (app.css's `.omnis-toast` block re-points sonner's own entrance),
 *  so a shot taken the moment the text exists catches the toast as a ghost and the artifact shows a
 *  design nobody ever sees. `getAnimations()` is the browser's own answer to "is this still moving",
 *  which beats guessing at --dur-base.
 *
 *  Asked of the document and filtered to the toast's own subtree, rather than of the element: what
 *  is animating here is sonner's keyframes on descendants (the toast, its list, its wrapper), and
 *  the filter is what keeps the row that is leaving *behind* the toast — the other half of these
 *  shots — out of it. */
async function settleToast(page: Page): Promise<void> {
  await poll(
    () =>
      page.evaluate(
        (selector) =>
          document
            .getAnimations()
            .filter((animation) => {
              const target =
                animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
              return target instanceof Element && target.closest(selector) !== null;
            })
            .every((a) => a.playState === "finished" || a.playState === "idle"),
        TOAST,
      ),
    (settled) => settled,
    "the toast's enter animation to finish",
    5_000,
  );
}

/** The row behind the card on top of the queue. The card carries no id of its own, so the way back to
 *  the database is the copy the person is reading — the same string, written by the seed. */
async function topApproval(pool: Pool, page: Page): Promise<{ id: string; description: string }> {
  const description = await page.locator(".approval-card__description").first().textContent();
  if (description === null) {
    throw new Error("no approval card is on screen — the queue is what this check reads");
  }
  const rows = await query<{ id: string }>(
    pool,
    "SELECT id FROM pending_approvals WHERE description = $1",
    [description],
  );
  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error(`no pending_approvals row carries "${description}"`);
  }
  return { id, description };
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  // tools/e2e/.env is written once and keeps whichever database the *first* stack in this worktree
  // used; `loadOrCreateEnv` only follows OMNIS_E2E_DB when it is exported. The port offset cannot
  // tell us the database name, so the variable is required rather than inferred — without this guard
  // the browser would talk to the stack on :5373 while the reads below hit another database.
  if (process.env.OMNIS_E2E_DB === undefined) {
    throw new Error("OMNIS_E2E_DB must name the running stack's database (see the header)");
  }
  const env = loadOrCreateEnv();
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });
  const browser = await chromium.launch();

  try {
    console.log("Inbox — archive, toast, undo");
    const page = await browser.newPage({ viewport: WIDE });
    /** Every `/decide` the browser sent. The ignore check is the one that needs it: a card that is
     *  gone and a database row that is still pending is *also* what a sent-then-failed write looks
     *  like, and only the request log tells those two apart. */
    const decideRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/decide")) decideRequests.push(request.url());
    });

    await page.goto(BASE);
    await page.waitForSelector(".inbox-row", { timeout: 60_000 });

    // ---- 1. Archive with `e`, then undo with `z` --------------------------------------------------
    await page.keyboard.press("j");
    const row = page.locator('.inbox-row[aria-selected="true"]');
    const threadId = await row.getAttribute("data-thread-id");
    if (threadId === null) {
      throw new Error("`j` selected no row — there is nothing to archive");
    }

    await page.keyboard.press("e");
    const archivedToast = await waitForToast(
      page,
      (toast) => toast.message === ARCHIVED && toast.action === UNDO,
      `the archive's toast to read "${ARCHIVED} · ${UNDO}"`,
    );
    console.log(
      `  archived ${threadId} with \`e\`, toast: "${archivedToast.message} · ${archivedToast.action}"`,
    );
    await settleToast(page);
    await page.screenshot({ path: join(OUT, "1440.png") });

    await page.keyboard.press("z");
    // The undo's own toast is the proof the key was answered — waiting on the row instead would pass
    // on the 240ms before the leave animation has even finished.
    await waitForToast(page, (toast) => toast.message === RESTORED, "the undo's toast");
    await poll(
      async () => {
        const gone = await page.locator(`.inbox-row[data-thread-id="${threadId}"]`).count();
        const rows = await query<{ archived_at: Date | null }>(
          pool,
          "SELECT archived_at FROM threads WHERE id = $1",
          [threadId],
        );
        return { gone, archivedAt: rows[0]?.archived_at ?? null };
      },
      (state) => state.gone === 1 && state.archivedAt === null,
      `threads.archived_at to be NULL and the row to be back for ${threadId}`,
    );
    console.log("  `z` put it back: the row is listed and threads.archived_at is NULL again");

    // ---- 1b. Two archives in a row: the second toast keeps its own clock --------------------------
    // `j e j e` is the core triage loop, and both toasts say the same word — "Archived" — which is
    // what a countdown keyed on the message cannot tell apart. Under that bug the second pill is
    // dismissed on the *first* one's clock: 2s after its own archive, taking its Undo and `z` with
    // it. The pointer is parked in the corner first: a hovered pill holds its timer on purpose, and
    // a hover here would make this pass for the wrong reason.
    await page.mouse.move(0, 0);
    /** `j` to the selected row, `e` to archive it, and the toast that answers. */
    const archiveSelected = async (): Promise<string> => {
      await page.keyboard.press("j");
      const id = await page
        .locator('.inbox-row[aria-selected="true"]')
        .getAttribute("data-thread-id");
      if (id === null) throw new Error("`j` selected no row to archive");
      await page.keyboard.press("e");
      await waitForToast(page, (toast) => toast.message === ARCHIVED, `"${ARCHIVED}"`);
      return id;
    };
    const firstId = await archiveSelected();
    // The gap is most of the first toast's window, so the second toast arrives with the first one's
    // clock nearly run out rather than with it already gone.
    await page.waitForTimeout(3_000);
    const secondId = await archiveSelected();

    // 2.6s on: the live toast is 2.6s old, and the first toast's clock — had it been left running —
    // is 5.6s and would have fired. This is the assertion that fails when it does.
    await page.waitForTimeout(2_600);
    const survivor = await readToast(page);
    if (survivor?.message !== ARCHIVED) {
      throw new Error(
        `the second "${ARCHIVED}" toast was gone 2.6s after its own archive ` +
          `(read ${JSON.stringify(survivor)}) — it was dismissed on the first toast's clock`,
      );
    }
    // And the undo is the second archive's: `z` restores the row *this* toast names.
    await page.keyboard.press("z");
    await waitForToast(page, (toast) => toast.message === RESTORED, "the second undo's toast");
    await poll(
      async () => {
        const rows = await query<{ archived_at: Date | null }>(
          pool,
          "SELECT archived_at FROM threads WHERE id = $1",
          [secondId],
        );
        return {
          archivedAt: rows[0]?.archived_at ?? null,
          listed: await page.locator(`.inbox-row[data-thread-id="${secondId}"]`).count(),
        };
      },
      (state) => state.archivedAt === null && state.listed === 1,
      `threads.archived_at to be NULL and the row to be back for ${secondId}`,
    );
    console.log(
      `  archived ${firstId} and ${secondId} 3s apart: the second "${ARCHIVED}" outlived the first one's clock, and \`z\` still put the second row back`,
    );

    // The first archive has no key left to undo it — the second toast replaced its undo — so the row
    // goes back the way a person would put it back: the Archived view's own restore, which is the
    // brief's other sentence ("Moved to Inbox").
    //
    // The row is clicked, not walked to with `j`: a row that has just been toggled is in *both* lists
    // for the length of its leave animation (applyArchiveView's `leaving`), so the restored row is
    // still in this one and sorts above the row that was stranded — "the next row along" names the
    // wrong row here, while the row's own id names the right one. The `aria-pressed` wait is the
    // other half of the same care: without it the click races the view switch and lands in the inbox.
    const archivedPill = page.locator(".inbox-card__archived-pill");
    await archivedPill.click();
    await page
      .locator('.inbox-card__archived-pill[aria-pressed="true"]')
      .waitFor({ timeout: 5_000 });
    const strandedRow = page.locator(`.inbox-row[data-thread-id="${firstId}"]`);
    await strandedRow.waitFor({ timeout: 5_000 });
    await strandedRow.click();
    if ((await strandedRow.getAttribute("aria-selected")) !== "true") {
      throw new Error(`clicking ${firstId} in the Archived view did not select it`);
    }
    await page.keyboard.press("u");
    await waitForToast(page, (toast) => toast.message === RESTORED, "the Archived view's restore");
    await poll(
      async () => {
        const rows = await query<{ archived_at: Date | null }>(
          pool,
          "SELECT archived_at FROM threads WHERE id = $1",
          [firstId],
        );
        return rows[0]?.archived_at ?? null;
      },
      (archivedAt) => archivedAt === null,
      `threads.archived_at to be NULL for ${firstId}`,
    );
    // Back to the inbox, where the checks below start — and waited for, for the same reason.
    await archivedPill.click();
    await page
      .locator('.inbox-card__archived-pill[aria-pressed="false"]')
      .waitFor({ timeout: 5_000 });
    console.log(
      `  and the Archived view restored ${firstId} with its own "${RESTORED}" toast — the seed is whole`,
    );

    // ---- 2. Ignore, held back until its toast goes ------------------------------------------------
    const ignored = await topApproval(pool, page);

    await page.getByRole("button", { name: "Ignore" }).first().click();
    const ignoredToast = await waitForToast(
      page,
      (toast) => toast.message.startsWith(IGNORED) && toast.action === UNDO,
      `the ignore's toast to read "${IGNORED}… · ${UNDO}"`,
    );
    const before = decideRequests.length;
    if (before !== 0) {
      throw new Error(`the ignore was sent on the click: ${decideRequests.join(", ")}`);
    }
    console.log(`  ignored it: "${ignoredToast.message}", and no /decide reached the hub`);

    await page.getByRole("button", { name: "Undo" }).first().click();
    const stillPending = await poll(
      async () => {
        const rows = await query<{ state: string }>(
          pool,
          "SELECT state FROM pending_approvals WHERE id = $1",
          [ignored.id],
        );
        return { state: rows[0]?.state ?? "missing", sent: decideRequests.length };
      },
      (it) => it.state === "pending" && it.sent === 0,
      `pending_approvals.state to still be 'pending' for ${ignored.id}`,
    );
    console.log(
      `  Undo: the card is back and the row is state='${stillPending.state}' with ` +
        `${stillPending.sent} /decide requests in total`,
    );

    // ---- 3. Approve through the confirmation ------------------------------------------------------
    const approved = await topApproval(pool, page);
    await page.getByRole("button", { name: "Approve" }).first().click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Approve" }).click();
    // `/decide` for this one is expected — the assertion on the *request* log is that the ignore
    // above did not send one, not that nothing ever does.
    const approvedToast = await waitForToast(
      page,
      (toast) => toast.message.startsWith(APPROVED),
      `the approval's toast to read "${APPROVED}…"`,
    );
    // No Undo on this one: the reply is in the outbox, so a button that took it back would be a
    // button that lies. The pill carries the sentence and nothing else.
    if (approvedToast.action !== null) {
      throw new Error(`the approval's toast carries an action: "${approvedToast.action}"`);
    }
    console.log(
      `  approved through the confirm: "${approvedToast.message}", with no action button ` +
        `(${decideRequests.length} /decide requests so far)`,
    );
    // The card going away is optimistic, so the database is the half that says the decision landed.
    // `decision`, not `state`: an accepted approval is executed straight after, and chasing it
    // through decided → executing → executed would be a race with the kernel's own worker.
    const decided = await poll(
      async () => {
        const rows = await query<{ state: string; decision: string | null }>(
          pool,
          "SELECT state, decision FROM pending_approvals WHERE id = $1",
          [approved.id],
        );
        return { state: rows[0]?.state ?? "missing", decision: rows[0]?.decision ?? null };
      },
      (it) => it.decision === "accept",
      `pending_approvals.decision = 'accept' for ${approved.id}`,
    );
    console.log(`  the row behind it: decision='${decided.decision}', state='${decided.state}'`);
    // Put the seed back. This is the one check in the script that consumes a fixture rather than
    // restoring it, and the queue is an 8-approval fixture the next reader of this stack expects to
    // find whole. `WHERE state = 'decided'` is the guard: a row the kernel has already executed (or
    // an execution that failed) is left exactly as it is.
    await query(
      pool,
      `UPDATE pending_approvals
          SET state = 'pending', decision = NULL, decided_at = NULL
        WHERE id = $1 AND state = 'decided'`,
      [approved.id],
    );
    // ---- 4. 390: the toast clears the BottomBar ---------------------------------------------------
    await page.setViewportSize(PHONE);
    // The column the queue auto-opened at 1440 is gone at this width (that rule is a >=1280 fact),
    // and Escape is the tier's own way out of a sheet if one is up: the chrome row is
    // `display: none` here, so there is no close button to press. It returns early when there is
    // nothing to close. The wait is for the pane's leave animation; the assertion further down is
    // the check that it did leave, because this shot is the list and its bars.
    await page.keyboard.press("Escape");
    await page
      .locator('[data-testid="detail-pane"]')
      .waitFor({ state: "detached", timeout: 10_000 });
    await page.waitForSelector(".bottom-bar", { timeout: 10_000 });

    // A fresh toast at this width, and a *replaced* one is enough: the press raises the archive's
    // own, and the geometry check measures the pill that press put on screen.
    await page.keyboard.press("j");
    await page.keyboard.press("e");
    await waitForToast(
      page,
      (toast) => toast.message === ARCHIVED,
      `a second "${ARCHIVED}" toast at 390`,
    );
    await settleToast(page);
    // The shot is the list and its two bars. A sheet over them would make the measurement below
    // meaningless — the toast would be measured clear of a bar that is itself covered — and the
    // artifact would be a picture of the pane with a toast in the corner.
    const pane = page.locator('[data-testid="detail-pane"]');
    if ((await pane.count()) !== 0) {
      throw new Error(
        `the pane is on screen at 390 (${(await pane.getAttribute("class")) ?? "no class"}) — the toast clearance cannot be measured over a sheet`,
      );
    }
    const [pillBox, barBox] = await Promise.all([
      page.locator(TOAST).first().boundingBox(),
      page.locator(".bottom-bar").boundingBox(),
    ]);
    if (pillBox === null || barBox === null) {
      throw new Error("the toast or the BottomBar has no box to measure");
    }
    const clearance = barBox.y - (pillBox.y + pillBox.height);
    if (clearance < 0) {
      throw new Error(
        `the toast overlaps the BottomBar by ${-clearance}px at 390 ` +
          `(toast bottom ${pillBox.y + pillBox.height}, bar top ${barBox.y})`,
      );
    }
    console.log(`  at 390 the toast sits ${clearance}px clear of the BottomBar's top edge`);
    await page.screenshot({ path: join(OUT, "390.png") });
    // The undo, so the seed is not one row shorter for whoever looks at the stack next.
    await page.keyboard.press("z");
    await waitForToast(page, (toast) => toast.message === RESTORED, "the undo's toast at 390");

    // ---- the narrow sweep -------------------------------------------------------------------------
    // SKILLS.md #11: no horizontal scroll at any of the four narrow widths. The toast is capped at
    // `min(480px, 100vw - 24px)`, so it is the one element here that could push the page wide.
    for (const width of SWEEP) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForTimeout(300);
      const overflow = await page.evaluate(measureOverflow);
      console.log(`  ${width}px: ${describeOverflow(overflow)}`);
      if (overflow.diff > 0) {
        throw new Error(
          `horizontal scroll at ${width}: the body is ${overflow.diff}px wider than the viewport`,
        );
      }
    }

    await page.close();
    console.log("loop-r1-06 shots written to", OUT);
  } finally {
    await browser.close();
    await pool.end();
  }
}

await main();
