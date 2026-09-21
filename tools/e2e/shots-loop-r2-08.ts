// loop-r2-08 evidence: focus lands somewhere. Every claim here is about `document.activeElement`
// after a *sequence* of real key presses on the live stack — which is the only place it can be
// checked. jsdom has a focus model, but not a keyboard's: RTL's `fireEvent.keyDown` dispatches a
// synthetic event and stops, so nothing in apps/desktop's suite can tell whether the browser focused
// the row in the same frame it was mounted by the virtualiser, whether `⌘K` then `Esc` returned the
// caret to the row it was opened over, or whether the third `⌘Z` posted a request. The browser is
// also the only witness for the two shots: the ring on the row and the absence of one on a heading
// are paint, and no unit test can see paint.
//
// Run against a stack that is already up (this script boots none of its own):
//   OMNIS_E2E_DB=omnis_test_loop_r2_impl OMNIS_E2E_PORT_OFFSET=500 ZERO_SHARD_NUM=12 \
//     pnpm tsx tools/e2e/hold.ts --web
//   OMNIS_E2E_DB=omnis_test_loop_r2_impl pnpm tsx tools/e2e/shots-loop-r2-08.ts
//   (desktop http://127.0.0.1:5673, the same stack r2-05..r2-07 shot against)
//
// Seven checks, in the order a person hits them:
//   1. `j j` (row 2 selected), `g t`: the focus is Today's `h1` and the words are the greeting's —
//      it used to be `<body>`, so the next Tab restarted at the top of the document.
//   2. `g i`: the focus is back on row 2, the row that was left (L2-09, NC2-10). The Inbox
//      unmounts when the shell switches away and React state does not outlive that, so the shell
//      remembers the id and hands it back as the screen's initial selection.
//   3. `j` from there: row 3 takes the selection. This is the half that proves the restore is a
//      *selection* and not just a focus — the roving tab stop has to move with it.
//   4. The rail's own Settings tile: the focus is the screen's `h1`. A click on a `<button>` leaves
//      the focus on that button, which is the other half of L2-14.
//   5. Row 2, `⌘K`, `Esc`: the caret is back on row 2. The palette captured the opener on open and
//      returns it on close; `returnFocusToOpener` on the *drawer* stays off, because a reopen loop
//      is what that flag's default buys below 900.
//   6. `e`, `j`, `e`, `⌘Z`, `⌘Z`: both threads are `archived_at IS NULL` again, and a third `⌘Z`
//      posts nothing. The undo used to be a one-level toggle that re-armed itself with the inverse,
//      so the second `⌘Z` re-archived the thread the first had just restored (L2-10, NC2-09).
//   7. No horizontal scroll at 1440, 390 and 320.
//
// One thing this file does *not* assert, on purpose: at 320 the Tasks screen lays one
// `.segmented-control__segment` 3.5px past the viewport, and it does so on a cold `?screen=tasks`
// load with nothing focused — measured while writing this, and pre-existing. It is printed by
// `assertNarrowFits` rather than asserted, so the run shows it and this story is not failed for it.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Page, chromium } from "@playwright/test";
import { Pool, query } from "../../packages/db/src/index.js";
import { assertNoOverflow, describeOverflow, measureOverflow } from "./overflow.js";
import { REPO_ROOT, loadOrCreateEnv } from "./stack.js";

const BASE = process.env.OMNIS_SHOTS_URL ?? "http://127.0.0.1:5673";
const OUT = join(REPO_ROOT, "docs/design/loop/r2/impl/loop-r2-08");

const WIDE = { width: 1440, height: 900 } as const;
/** The brief's 390x844, without `isMobile` — the same way the other shot tools take a narrow pass. */
const PHONE = { width: 390, height: 844 } as const;
const NARROW = [390, 320] as const;

/** The copy this script asserts on, spelled once here so a reworded line fails the check rather than
 *  quietly passing it. `Archived` is the archive's toast, and the quoted title is the whole point of
 *  the story's second half: "Archived" alone named nothing a person with two archives in a row could
 *  act on. */
const ARCHIVED = "Archived";
const UNDO = "Undo";
/** `truncateTitle`'s cap, from Inbox.tsx. Re-spelled rather than imported for the same reason the
 *  copy above is: a shot script that reads the implementation would pass on any implementation. */
const TITLE_MAX = 40;

const TOAST = '[data-sonner-toast]:not([data-removed="true"])';

function truncateTitle(title: string): string {
  return title.length <= TITLE_MAX ? title : `${title.slice(0, TITLE_MAX).trimEnd()}…`;
}

/** Everything the checks below read off the focused element in one round trip. `outlineStyle` is the
 *  paint half: the ring on a focused row and the *absence* of one on a heading are what the two
 *  screenshots are of, and `outline: none` computes to `outlineStyle: "none"`. */
interface Active {
  tag: string;
  className: string;
  text: string;
  threadId: string | null;
  outlineStyle: string;
  outlineWidth: string;
}

const NOTHING: Active = {
  tag: "",
  className: "",
  text: "",
  threadId: null,
  outlineStyle: "",
  outlineWidth: "",
};

async function active(page: Page): Promise<Active> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement)) {
      return {
        tag: "",
        className: "",
        text: "",
        threadId: null,
        outlineStyle: "",
        outlineWidth: "",
      };
    }
    const style = getComputedStyle(el);
    return {
      tag: el.tagName,
      className: typeof el.className === "string" ? el.className : "",
      text: (el.textContent ?? "").trim().slice(0, 120),
      threadId: el.getAttribute("data-thread-id"),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
    };
  });
}

/** Poll a read until it says what the press was supposed to do. The shell focuses inside a
 *  `requestAnimationFrame` (App.tsx: the new screen has to have mounted first, and on the Inbox the
 *  virtualiser mounts rows in its own layout effect), and the writes go to the hub over HTTP while
 *  the screens read through Zero's replica — so every assertion here is an "eventually", and a
 *  one-shot read right after the press would be a race dressed as a check. */
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
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const shown = (a: Active): string =>
  a.tag === "" ? "<body>" : `${a.tag.toLowerCase()}.${a.className.split(" ")[0] ?? ""}`;

/** Wait for the focus to satisfy `ok`, and report what it was when it did. */
async function waitForFocus(page: Page, ok: (a: Active) => boolean, what: string): Promise<Active> {
  const found = await poll(() => active(page), ok, what, 10_000);
  console.log(`  ${what}: focus is ${shown(found)} (outline ${found.outlineStyle})`);
  return found;
}

/** `g` and then a letter. The two presses are separate CDP round trips, so the 300ms window
 *  `reduceKeySequence` allows is never close to expiring. */
async function pressGo(page: Page, letter: string): Promise<void> {
  await page.keyboard.press("g");
  await page.keyboard.press(letter);
}

/** The thread the list says is selected, or null. Read from `aria-selected`, which is the list's own
 *  answer to "which row is the tab stop" — the same attribute the roving tab stop is built on. */
async function selectedId(page: Page): Promise<string | null> {
  return page
    .locator('.inbox-row[aria-selected="true"]')
    .first()
    .getAttribute("data-thread-id")
    .catch(() => null);
}

/** Load the Inbox and wait for a row that is a row.
 *
 *  `.inbox-row` alone is not that: the screen draws `.inbox-row--skeleton` placeholders in its boot
 *  state (Inbox.tsx), so a selector that matches the placeholder is satisfied before the list has
 *  anything in it — and `j` on a list with nothing in it does nothing at all, because the movement
 *  keys read "nothing selected" as "start at the top" and there is no top. The rows the queries
 *  answer with carry `data-thread-id`; the placeholders do not. */
async function openInbox(page: Page, url = BASE): Promise<void> {
  await page.goto(url);
  await page.waitForSelector(".inbox-row[data-thread-id]", { timeout: 60_000 });
}

/** `j` from nothing, retried until the list answers.
 *
 *  The rows appearing and the screen's own `rowIds` being non-empty are one commit apart (the ids
 *  come from a memo over the same query results), so the first press after a load can still land on
 *  an empty list. Every press that *does* get through before one works selects the same row — the
 *  first, since "nothing selected" resolves to the top — so retrying cannot walk the selection
 *  somewhere unintended. */
async function selectFirstRow(page: Page): Promise<string> {
  const until = Date.now() + 20_000;
  for (;;) {
    await page.keyboard.press("j");
    await page.waitForTimeout(150);
    const id = await selectedId(page);
    if (id !== null) return id;
    if (Date.now() > until) throw new Error("`j` never selected a row");
  }
}

/** The mounted rows in DOM order. The virtualiser only mounts what is near the viewport, so this is
 *  the list as the person sees it rather than every row in the database. */
async function mountedIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>(".inbox-row")).map(
      (row) => row.dataset.threadId ?? "",
    ),
  );
}

/** The toast's sentence and its button, or null. Read from sonner's two parts rather than the
 *  element's text: the action button is a sibling of `[data-title]`, so the element's own text is
 *  `Archived "…"Undo`. `.first()` because the app keeps one toast slot — more than one on screen is
 *  itself the failure the next check would report. */
async function readToast(page: Page): Promise<{ message: string; action: string | null } | null> {
  const toast = page.locator(TOAST).first();
  if ((await toast.count()) === 0) return null;
  const button = toast.locator("[data-button]");
  return {
    message: ((await toast.locator("[data-title]").textContent()) ?? "").trim(),
    action: (await button.count()) === 0 ? null : ((await button.textContent()) ?? "").trim(),
  };
}

async function waitForToast(
  page: Page,
  ok: (toast: { message: string; action: string | null }) => boolean,
  what: string,
): Promise<{ message: string; action: string | null }> {
  const toast = await poll(
    () => readToast(page),
    (value) => value !== null && ok(value),
    what,
    10_000,
  );
  if (toast === null) throw new Error(`no toast for ${what}`);
  return toast;
}

/** Let the toast's enter animation finish before the shot. Waiting for the *message* is not enough:
 *  it animates in from opacity 0, so a screenshot taken the moment the text exists catches a ghost
 *  and the artifact shows a design nobody ever sees. `getAnimations()` is the browser's own answer
 *  to "is this still moving", and it is filtered to the toast's own subtree so the row leaving
 *  behind it — the other half of the shot — is not what holds the frame open. */
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

/** The brief's own overflow reading, verbatim: `documentElement.scrollWidth <= innerWidth`. The
 *  shared probe is the stronger one (a stylesheet can pin this to 0 and it has before), so both are
 *  taken and neither replaces the other. */
async function assertDocumentFits(page: Page, label: string): Promise<void> {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (over > 0) {
    throw new Error(`${label}: documentElement.scrollWidth is ${over}px past innerWidth`);
  }
}

async function assertNoOverflowAt(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(measureOverflow);
  console.log(`  ${label}: ${describeOverflow(overflow)}`);
  assertNoOverflow(label, overflow);
  await assertDocumentFits(page, label);
}

/** The narrow sweep, on the reading the brief names. The shared probe is printed beside it rather
 *  than asserted, and that is a deliberate exception with a measurement behind it: at 320 the Tasks
 *  screen lays one `.segmented-control__segment` 3.5px past the viewport on a *cold* `?screen=tasks`
 *  load with `document.activeElement` on `<body>` — no key pressed, no heading focused, nothing this
 *  story touches. It is a Tasks-screen width nit from before this story, and asserting it here would
 *  fail this story for someone else's reason; dropping the probe silently would hide it. So it is
 *  printed, and it is named in this file's header too. */
async function assertNarrowFits(page: Page, label: string): Promise<void> {
  await assertDocumentFits(page, label);
  const overflow = await page.evaluate(measureOverflow);
  console.log(`  ${label}: ${describeOverflow(overflow)}`);
}

/** A thread's title and its archive state, read from the database rather than off the screen: the
 *  row's name is product copy the shot happens to show, and the write's effect is a column. */
async function threadState(
  pool: Pool,
  id: string,
): Promise<{ title: string; archivedAt: Date | null }> {
  const rows = await query<{ title: string; archived_at: Date | null }>(
    pool,
    "SELECT title, archived_at FROM threads WHERE id = $1",
    [id],
  );
  const row = rows[0];
  if (row === undefined) throw new Error(`no threads row for ${id}`);
  return { title: row.title, archivedAt: row.archived_at };
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  // tools/e2e/.env keeps whichever database the *first* stack in this worktree used, and the port
  // offset cannot tell us the database name — without this guard the browser would talk to the stack
  // on :5673 while the reads below land in another database.
  if (process.env.OMNIS_E2E_DB === undefined) {
    throw new Error("OMNIS_E2E_DB must name the running stack's database (see the header)");
  }
  const env = loadOrCreateEnv();
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });
  const browser = await chromium.launch();

  try {
    const page = await browser.newPage({ viewport: WIDE });
    /** Every archive/restore the browser sent. Check 6's last half needs the log rather than the
     *  screen: an empty undo stack and an undo that was answered but failed look identical in the
     *  DOM, and only the requests tell them apart. */
    const writes: string[] = [];
    page.on("request", (request) => {
      const matched = request.url().match(/\/api\/threads\/([^/]+)\/(unarchive|archive)$/);
      if (matched !== null) writes.push(`${matched[2]}/${matched[1]}`);
    });

    await openInbox(page);

    // ---- 1. `g t`: the focus lands on the screen that arrived --------------------------------
    await selectFirstRow(page);
    await page.keyboard.press("j");
    const row2 = await poll(
      () => selectedId(page),
      (id) => id !== null,
      "row 2 to be selected",
    );
    const top = await mountedIds(page);
    if (top[1] !== row2) {
      throw new Error(`"row 2" is ${row2}, which is not the second row on screen (${top[1]})`);
    }
    console.log(`row 2 is ${row2}`);

    await pressGo(page, "t");
    const today = await waitForFocus(
      page,
      (a) => a.tag === "H1" && a.text.startsWith("Good "),
      "`g t` lands on Today's h1",
    );
    if (!/^Good (morning|afternoon|evening), /.test(today.text)) {
      throw new Error(`Today's heading reads "${today.text}", not the greeting`);
    }

    // ---- 2. `g i`: back to the row that was left ----------------------------------------------
    await pressGo(page, "i");
    const back = await waitForFocus(
      page,
      (a) => a.threadId === row2,
      "`g i` lands on the row the Inbox was left on",
    );
    if (back.tag !== "DIV") {
      throw new Error(`the remembered row is a ${back.tag}, not the row element`);
    }

    // ---- 3. the restore is a selection, not only a caret --------------------------------------
    const order = await mountedIds(page);
    const at = order.indexOf(row2);
    if (at === -1) throw new Error(`row 2 (${row2}) is not mounted after \`g i\``);
    const row3 = order[at + 1];
    if (row3 === undefined) throw new Error("there is no row after row 2 to move to");
    await page.keyboard.press("j");
    await waitForFocus(page, (a) => a.threadId === row3, "`j` moves to the row after the one left");
    if ((await selectedId(page)) !== row3) {
      throw new Error(
        `\`j\` focused ${row3} but the list still selects ${String(await selectedId(page))}`,
      );
    }

    // ---- 4. the rail's own tile, the third door -----------------------------------------------
    // Settings is not one of the rail's five screen tiles: in the wide rail it is the button at the
    // foot (channel-rail.tsx's SETTINGS_ENTRY), which is still a rail control and still a click that
    // leaves the focus on itself without the shell moving it.
    await page.locator('.channel-rail__icon-button[aria-label="Settings"]').click();
    await waitForFocus(
      page,
      (a) => a.tag === "H1" && a.text === "Settings",
      "the Settings rail tile lands on Settings' h1",
    );

    // ---- 5. the palette gives the caret back --------------------------------------------------
    await pressGo(page, "i");
    const restoring = await waitForFocus(page, (a) => a.threadId !== null, "`g i` lands on a row");
    // The `j` is waited for rather than read on the next line: `moveTo` focuses a frame later, so a
    // read taken immediately after the press still returns the row the key was pressed *on* — and
    // the palette then returns the caret to the row that really had it, which would look like the
    // wrong row coming back.
    await page.keyboard.press("j");
    const beforePalette = await poll(
      () => active(page),
      (a) => a.threadId !== null && a.threadId !== restoring.threadId,
      "the row the `j` moved to, before the palette opens",
    );
    await page.keyboard.press("Meta+k");
    // Above 900px the palette is a card the bar owns rather than a dialog (`.ask-bar` itself is
    // always on screen — it is the bar), and the card is mounted only while it is up, so its glass
    // is the marker. Waiting on it is waiting on the panel rather than on the press.
    await page.locator(".ask-panel__glass").first().waitFor({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    const returned = await waitForFocus(
      page,
      (a) => a.threadId === beforePalette.threadId,
      "`⌘K` then `Esc` returns the caret to the row",
    );
    console.log(
      `  the palette closed back onto ${returned.threadId ?? "?"}, the row it was opened over`,
    );

    // ---- 6a. archive with `e`: the toast names the thread, the next row takes the focus --------
    const firstId = beforePalette.threadId;
    if (firstId === null) throw new Error("no row is selected to archive");
    const firstOrder = await mountedIds(page);
    const nextId = firstOrder[firstOrder.indexOf(firstId) + 1];
    await page.keyboard.press("e");
    const first = await threadState(pool, firstId);
    const toast = await waitForToast(
      page,
      (t) => t.message === `${ARCHIVED} "${truncateTitle(first.title)}"` && t.action === UNDO,
      `the archive's toast to name "${truncateTitle(first.title)}" and offer the Undo`,
    );
    console.log(`  archived ${firstId}; toast: "${toast.message} · ${toast.action}"`);
    const landed = await waitForFocus(
      page,
      (a) => a.threadId !== null && a.threadId !== firstId,
      "the archive's focus to land on the next row",
    );
    if (nextId !== undefined && landed.threadId !== nextId) {
      throw new Error(`the focus landed on ${landed.threadId}, not the next row ${nextId}`);
    }
    await settleToast(page);
    await page.screenshot({ path: join(OUT, "1440.png") });
    await assertNoOverflowAt(page, "1440 inbox");

    // ---- 6b. the undo is a stack ---------------------------------------------------------------
    await page.keyboard.press("j");
    const secondId = await poll(
      () => active(page),
      (a) => a.threadId !== null && a.threadId !== firstId && a.threadId !== nextId,
      "a second row to archive",
    ).then((a) => a.threadId);
    if (secondId === null) throw new Error("`j` selected no second row");
    await page.keyboard.press("e");
    const second = await threadState(pool, secondId);
    await waitForToast(
      page,
      (t) => t.message === `${ARCHIVED} "${truncateTitle(second.title)}"`,
      "the second archive's toast",
    );
    if (writes.length !== 2) {
      throw new Error(`two archives sent ${writes.length} writes: ${writes.join(", ")}`);
    }

    // The newest first: the thread archived last is the one the first ⌘Z takes back, and the key
    // has to send `unarchive` for it rather than `archive` for the same id (the toggle's inverse).
    await page.keyboard.press("Meta+z");
    await poll(
      () => Promise.resolve(writes.slice()),
      (list) => list.length === 3 && list[2] === `unarchive/${secondId}`,
      `the first ⌘Z to unarchive ${secondId}`,
    );
    await page.keyboard.press("Meta+z");
    await poll(
      () => Promise.resolve(writes.slice()),
      (list) => list.length === 4 && list[3] === `unarchive/${firstId}`,
      `the second ⌘Z to unarchive ${firstId}`,
    );

    // And a third press has an empty stack: nothing to take back, so nothing goes out. Waited for
    // rather than sampled — the request log is appended asynchronously, so a bare read right after
    // the press would pass for the wrong reason.
    await page.keyboard.press("Meta+z");
    await page.waitForTimeout(600);
    if (writes.length !== 4) {
      throw new Error(
        `a third ⌘Z sent a write with an empty undo stack: ${writes.slice(4).join(", ")}`,
      );
    }
    for (const id of [firstId, secondId]) {
      await poll(
        () => threadState(pool, id),
        (state) => state.archivedAt === null,
        `threads.archived_at to be NULL for ${id}`,
      );
    }
    console.log(
      `  \`e\`, \`j\`, \`e\`, ⌘Z, ⌘Z: ${writes.join(" ")} — both threads are back, a third ⌘Z sent nothing`,
    );
    await page.close();

    // ---- 7. the narrow tiers, and Tasks at 390 --------------------------------------------------
    // A fresh load at 390 rather than a resize: the wide page above has a selection and a toast on
    // it, and this pass is about the shell's other tier.
    const phone = await browser.newPage({ viewport: PHONE });
    await openInbox(phone);
    // The shell swaps the channel rail for the BottomBar below the narrow breakpoint, and the swap
    // lands in a React pass *after* the viewport changes — waiting for it is waiting on positive
    // evidence that the narrow tier is in.
    await phone.locator(".bottom-bar").waitFor({ timeout: 30_000 });
    await pressGo(phone, "k");
    const tasks = await waitForFocus(
      phone,
      (a) => a.tag === "H1" && a.text === "Tasks",
      "`g k` lands on Tasks' h1 at 390",
    );
    // The ring's absence is the point of this shot: the shell moved the focus, so the heading is not
    // a control the user tabbed to, and `h1[tabindex="-1"]:focus { outline: none }` is what makes
    // the picture show a heading rather than a box drawn around one.
    if (tasks.outlineStyle !== "none") {
      throw new Error(`the Tasks heading draws a ring at 390 (outline ${tasks.outlineStyle})`);
    }
    await phone.screenshot({ path: join(OUT, "390.png") });
    for (const width of NARROW) {
      await phone.setViewportSize({ width, height: PHONE.height });
      await phone.waitForTimeout(300);
      await assertNarrowFits(phone, `${width} tasks`);
    }
    await phone.close();

    console.log("loop-r2-08 shots written to", OUT);
  } finally {
    await browser.close();
    await pool.end();
  }
}

await main();
