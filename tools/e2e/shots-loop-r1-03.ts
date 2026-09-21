// loop-r1-03 evidence: `j`/`k` move the selection, `e` archives and advances, and the list is one
// tab stop.
//
// Run against a stack that is already up (this script boots none of its own — it is the same live
// app a person is looking at):
//   OMNIS_E2E_DB=omnis_test_loop_r1_e2e OMNIS_E2E_PORT_OFFSET=200 ZERO_SHARD_NUM=9 \
//     pnpm tsx tools/e2e/hold.ts --web
//   pnpm tsx tools/e2e/shots-loop-r1-03.ts        (base http://127.0.0.1:5373, i.e. 5173 + 200)
//
// Why a script and not two committed PNGs: this story's subject is a *sequence* of writes, and the
// bug it fixes (NC-02) is invisible in any single frame. The stuck selection posted the same thread
// id three times and every one of those three frames looks correct on its own. The probe is the hub
// request log — every `POST /api/threads/:id/archive` the browser actually sent, by id — which is
// the assertion a screenshot cannot make. The same reasoning as loop-r1-02's `elementFromPoint`,
// one layer down.
//
// Three passes:
//   1440  the keyboard triage itself: `j` `j` `j` then `e` `e` `e`, three distinct ids on the wire,
//         the list three rows shorter, and the focus ring measured off the computed style of the
//         row rather than read out of the stylesheet (NC-28).
//   1440  Tab into the list and straight back out: the list is one stop rather than one per row plus
//         two more on each (NC-18). The count from a cold load is logged with its whole trail, and it
//         is dominated by the rail, the ask panel and the filter chips — chrome this story does not
//         own. What it does own is measured instead: arriving lands on a row, and the next press
//         leaves the list, so the presses needed to cross it no longer grow with the row count.
//   390   the phone tier: a row tapped, the sheet's `‹ Inbox`, and the flat tint the selected row
//         keeps under it (v3 §a.1).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Page, chromium } from "@playwright/test";
import { REPO_ROOT } from "./stack.js";

const BASE = process.env.OMNIS_SHOTS_URL ?? "http://127.0.0.1:5373";
const OUT = join(REPO_ROOT, "docs/design/loop/r1/impl/loop-r1-03");

/** The brief's two viewports: 1440×900 is the desktop column, 390×844 the phone — no `isMobile`, as
 *  the other shot tools do, because the touch flag switches the row swipe's pointer path on and the
 *  swipe is not what this story is about. */
const WIDE = { width: 1440, height: 900 } as const;
const PHONE = { width: 390, height: 844 } as const;

/** The archive's leave animation is 240ms (LEAVE_MS, US-D04) and the row is held in the list for all
 *  of it. 700ms clears the animation, the removal and the reflow behind it, so a count read after
 *  this is the list at rest rather than mid-collapse. */
const SETTLE_MS = 700;

/** Three archives, one per press of `e` — the story's own number, and the one the bug broke. */
const ARCHIVES = 3;

/** Runs in the page. A string and not a function: tsx's esbuild transform names inner function
 *  expressions and injects a `__name` helper that does not exist in the page (overflow.ts's header
 *  carries the measurement). */
const LIST_PROBE = `(() => {
  const rows = Array.from(document.querySelectorAll(".inbox-row"));
  const active = document.activeElement;
  return {
    mounted: rows.length,
    selected: rows.filter((r) => r.getAttribute("aria-selected") === "true")
      .map((r) => r.getAttribute("data-thread-id")),
    stops: rows.filter((r) => r.getAttribute("tabindex") === "0")
      .map((r) => r.getAttribute("data-thread-id")),
    activeThreadId: active instanceof HTMLElement ? active.getAttribute("data-thread-id") : null,
  };
})()`;

/** Every row in the list, not only the mounted ones. The list is virtualised, so
 *  `querySelectorAll(".inbox-row")` answers "how many rows are on screen" and this story's
 *  assertion is "how many are in the inbox" — archiving three rows from the top of a long list
 *  moves three rows up from below and leaves the mounted count exactly where it was. So: walk the
 *  scroller a viewport at a time and union the ids it mounts on the way, which is the only count the
 *  DOM can honestly give. Scroll position is restored to the top afterwards, because the `j` presses
 *  that follow have to start from the first row. */
const COUNT_PROBE = `(async () => {
  const scroller = document.querySelector('[data-virtuoso-scroller="true"]');
  const ids = new Set();
  const grab = () => {
    for (const row of document.querySelectorAll(".inbox-row[data-thread-id]")) {
      ids.add(row.getAttribute("data-thread-id"));
    }
  };
  if (scroller === null) {
    grab();
    return { ids: Array.from(ids), scrolled: false };
  }
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  scroller.scrollTop = 0;
  await frame();
  grab();
  for (let top = 0; top < scroller.scrollHeight; top += scroller.clientHeight) {
    scroller.scrollTop = top;
    await frame();
    grab();
  }
  scroller.scrollTop = 0;
  await frame();
  grab();
  return { ids: Array.from(ids), scrolled: true };
})()`;

/** NC-28, measured where it is painted rather than where it is written. `outlineOffset` is the
 *  finding: the square ring ran to the row's outer edge and past its corners, and a negative offset
 *  is the whole of "inside the row's box". `borderRadius` is read off the same element the ring is
 *  drawn on, so the two cannot drift the way they did. */
const RING_PROBE = `(() => {
  const row = document.querySelector('.inbox-row[aria-selected="true"]');
  if (row === null) return null;
  const cs = getComputedStyle(row);
  return {
    threadId: row.getAttribute("data-thread-id"),
    isActive: document.activeElement === row,
    focusVisible: row.matches(":focus-visible"),
    outlineWidth: cs.outlineWidth,
    outlineStyle: cs.outlineStyle,
    outlineColor: cs.outlineColor,
    outlineOffset: cs.outlineOffset,
    radius: cs.borderRadius,
  };
})()`;

/** The focus a person arrives with. Every click target in this layout is a control, and the keymap
 *  deliberately ignores keys typed into a field — so a page that autofocused a composer would
 *  swallow every `j` below without anything failing. Blur, don't click. */
const BLUR_PROBE =
  "(() => { const el = document.activeElement; if (el instanceof HTMLElement) el.blur(); })()";

/** What the focus is on, in words, for the Tab trail. Every stop is logged: the number is the
 *  assertion but the trail is the evidence, and a count of 9 that got there through five rail
 *  buttons is a different result from one that got there through five rows. */
const FOCUS_PROBE = `(() => {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return { what: "nothing focused", inRow: false };
  return {
    what: el.getAttribute("aria-label") || el.className || el.tagName,
    tag: el.tagName,
    inRow: el.closest(".inbox-row") !== null,
    threadId: el.getAttribute("data-thread-id"),
  };
})()`;

/** The flat tint the `<900` tier keeps for the selected row (v3 §a.1): a tint in place, with no
 *  card and therefore no shadow and no radius. Read off the computed style for the same reason the
 *  ring is — the tier is a container query, and which one applies is the browser's answer. */
const TINT_PROBE = `(() => {
  const row = document.querySelector('.inbox-row[aria-selected="true"]');
  if (row === null) return null;
  const cs = getComputedStyle(row);
  return {
    threadId: row.getAttribute("data-thread-id"),
    background: cs.backgroundColor,
    boxShadow: cs.boxShadow,
    radius: cs.borderRadius,
  };
})()`;

interface ListState {
  mounted: number;
  selected: string[];
  stops: (string | null)[];
  activeThreadId: string | null;
}

interface Ring {
  threadId: string;
  isActive: boolean;
  focusVisible: boolean;
  outlineWidth: string;
  outlineStyle: string;
  outlineColor: string;
  outlineOffset: string;
  radius: string;
}

/** The archive writes the browser sent, by thread id. Recorded from the request, not from a spy on
 *  `setThreadArchived`: the URL is what the hub receives, and NC-02 was a correct function being
 *  handed the wrong id — a spy would have shown one call and agreed with the bug. */
function recordArchives(page: Page, into: string[]): void {
  page.on("request", (request) => {
    if (request.method() !== "POST") return;
    const id = new URL(request.url()).pathname.match(/^\/api\/threads\/([^/]+)\/archive$/)?.[1];
    if (id !== undefined) into.push(id);
  });
}

async function open(page: Page): Promise<void> {
  await page.goto(BASE);
  await page.waitForSelector(".inbox-row", { timeout: 60_000 });
  await page.waitForTimeout(1500);
  // A person arriving has the focus on the document.
  await page.evaluate(BLUR_PROBE);
}

async function listState(page: Page): Promise<ListState> {
  return (await page.evaluate(LIST_PROBE)) as ListState;
}

/** Every row in the list, mounted or not — see COUNT_PROBE. */
async function inboxIds(page: Page): Promise<string[]> {
  const result = (await page.evaluate(COUNT_PROBE)) as { ids: string[]; scrolled: boolean };
  if (!result.scrolled) throw new Error("the list has no virtuoso scroller to count through");
  return result.ids;
}

/** One press, then the frame `moveTo` defers its focus to. Playwright's press resolves before that
 *  frame, so the wait is not padding — it is the assertion's own turn. */
async function press(page: Page, key: string): Promise<void> {
  await page.keyboard.press(key);
  await page.waitForTimeout(60);
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  try {
    // ---- 1440: the triage run -------------------------------------------------------------------
    const wide = await browser.newPage({ viewport: WIDE });
    const archives: string[] = [];
    recordArchives(wide, archives);
    await open(wide);
    console.log("1440 — the triage run");

    const start = await listState(wide);
    if (start.stops.length !== 1) {
      throw new Error(`the list has ${start.stops.length} tab stops, not 1 (NC-18)`);
    }
    console.log(`  ${start.mounted} rows mounted, one tab stop, nothing selected`);

    const before = await inboxIds(wide);
    console.log(`  the inbox holds ${before.length} rows`);

    // The shot: two `j`s in, so the ring is on the second row and the pane is still the queue —
    // moving does not open a thread, which is the difference between reading the queue with `j` and
    // opening three threads.
    await press(wide, "j");
    await press(wide, "j");
    // The selection's fill, its radius and its elevation travel together over --dur-base (160ms) —
    // the base row carries no radius and the selected one does, so `border-radius` is genuinely
    // mid-animation for that window. Read any earlier and the probe measures the transition instead
    // of the row: the first run of this script read 5.64529px and failed its own 8px assertion.
    await wide.waitForTimeout(SETTLE_MS);

    const ring = (await wide.evaluate(RING_PROBE)) as Ring | null;
    if (ring === null) throw new Error("`j` `j` left no row selected");
    if (!ring.isActive)
      throw new Error(`the selection is ${ring.threadId} but the focus is not on it`);
    if (!ring.focusVisible) throw new Error("the selected row does not match :focus-visible");
    if (ring.outlineWidth !== "2px" || ring.outlineStyle !== "solid") {
      throw new Error(
        `the ring is ${ring.outlineWidth} ${ring.outlineStyle}, not a 2px solid outline`,
      );
    }
    // NC-28 in one number: a positive offset grows the row's box and a zero one sits on its edge,
    // which is the square box that ran past the card's corners.
    if (ring.outlineOffset !== "-2px") {
      throw new Error(`the ring is offset ${ring.outlineOffset}, so it is not inset into the row`);
    }
    if (ring.radius !== "8px") {
      throw new Error(
        `the row under the ring is ${ring.radius}, so the ring cannot follow its corners`,
      );
    }
    console.log(
      `  row 2 selected and focused: ${ring.outlineWidth} ${ring.outlineStyle} ${ring.outlineColor}` +
        ` at offset ${ring.outlineOffset}, radius ${ring.radius}`,
    );

    const pane = wide.locator('[data-testid="detail-pane"]');
    if ((await pane.count()) !== 1) throw new Error("`j` `j` closed the pane");
    if ((await wide.locator('[aria-label="Pending approvals"]').count()) !== 1) {
      throw new Error("the pane is open but it is not the queue — moving must not open a thread");
    }
    console.log("  the pane is still the approval queue, unopened by the movement");
    await wide.screenshot({ path: join(OUT, "1440.png") });

    // ...and the third `j`, then three `e`s. Three distinct ids or NC-02 is back.
    await press(wide, "j");
    for (let i = 0; i < ARCHIVES; i++) {
      await press(wide, "e");
      await wide.waitForTimeout(SETTLE_MS);
    }

    if (archives.length !== ARCHIVES) {
      throw new Error(`the browser sent ${archives.length} archive posts, not ${ARCHIVES}`);
    }
    const distinct = new Set(archives);
    if (distinct.size !== ARCHIVES) {
      throw new Error(
        `the ${ARCHIVES} archives named only ${distinct.size} threads (${archives.join(", ")}) — the selection did not advance (NC-02)`,
      );
    }
    console.log(`  three archives, three distinct ids: ${archives.join(", ")}`);

    // Read the selection and the focus *before* the count, and that order is load-bearing:
    // COUNT_PROBE scrolls the list from end to end to find every row, and a row the virtualiser
    // scrolls out of its window is unmounted — which takes the focus off it. Running the count
    // first fails this assertion with the app behaving perfectly (the second run of this script did
    // exactly that). The count is the invasive measurement, so it goes last.
    const end = await listState(wide);
    if (end.stops.length !== 1) {
      throw new Error(`the list has ${end.stops.length} tab stops after the run, not 1`);
    }
    // The advance is the story: after three archives the selection is on the row that followed the
    // last one, and it is the only tab stop. A selection left on a thread that has left the list is
    // the same bug one step later.
    if (end.selected.length !== 1) throw new Error("no row is selected after the run");
    if (end.selected[0] !== end.stops[0]) throw new Error("the tab stop is not the selected row");
    if (end.activeThreadId !== end.selected[0]) {
      throw new Error(
        `the focus is on ${end.activeThreadId ?? "nothing"} but the selection is ${end.selected[0]}`,
      );
    }
    console.log(`  the selection landed on ${end.selected[0]} and the focus came with it`);

    const after = await inboxIds(wide);
    if (before.length - after.length !== ARCHIVES) {
      throw new Error(
        `the inbox went from ${before.length} rows to ${after.length}, not down by ${ARCHIVES}`,
      );
    }
    for (const id of archives) {
      if (after.includes(id)) throw new Error(`the archived thread ${id} is still in the inbox`);
    }
    for (const id of archives) {
      if (!before.includes(id)) {
        throw new Error(`the archived thread ${id} was not in the list before the run`);
      }
    }
    console.log(`  the list is down to ${after.length} rows, and no archived id is among them`);

    // ---- 1440: the tab stop count -----------------------------------------------------------------
    // NC-18: 27 Tabs from the ask bar to the pane, three per row. The assertion is on the whole
    // journey from a cold load, and every stop is logged, because "9" reached through five rail
    // buttons is a different answer from "9" reached through five rows.
    console.log("1440 — Tab into the list, and straight back out");
    const tabs = await browser.newPage({ viewport: WIDE });
    await open(tabs);
    let presses = 0;
    let landed: { what: string; inRow: boolean; threadId: string | null } = {
      what: "nothing focused",
      inRow: false,
      threadId: null,
    };
    for (; presses < 60; presses++) {
      await tabs.keyboard.press("Tab");
      landed = (await tabs.evaluate(FOCUS_PROBE)) as typeof landed;
      console.log(`  tab ${presses + 1}: ${landed.what}`);
      if (landed.inRow) break;
    }
    if (!landed.inRow) {
      throw new Error(`60 Tabs never reached a row (last stop: ${landed.what})`);
    }
    // Landing *on a row* is the half of NC-18 that is about what the list is made of: the row is a
    // stop, and neither of the two controls inside it is one.
    if (landed.threadId === null) {
      throw new Error(`the first stop inside the list is "${landed.what}", not a row`);
    }
    console.log(
      `  tab ${presses + 1} is a row (${landed.threadId}) — the chrome before it is other stories'`,
    );

    // ...and the half that is about how many stops the list has: the press *after* the one that
    // arrived leaves it. The list is one stop, not one per row and two more on each of them —
    // before this story the same walk went row → "More actions" → "Archive" → row, so the number of
    // presses to cross the list was 3 × the number of rows (45 at this fixture's fifteen, and the
    // finding's 27 at the eight rows it was measured with). The count no longer grows with the list,
    // which is the property a count against a fixed fixture could never show.
    await tabs.keyboard.press("Tab");
    const left = (await tabs.evaluate(FOCUS_PROBE)) as { what: string; inRow: boolean };
    console.log(`  tab ${presses + 2}: ${left.what}`);
    if (left.inRow) {
      throw new Error(
        `a second Tab is still inside the list (${left.what}) — the list is more than one stop (NC-18)`,
      );
    }
    console.log(`  one Tab crosses the whole list: ${presses + 1} to arrive, 1 to leave`);

    // ---- 390: the phone tier ---------------------------------------------------------------------
    // The selected row is a flat full-width band here, not the white card the desktop tier
    // elevates, so the ring has nothing to follow and the radius is 0 (v3 §a.1). What the tier
    // keeps is the tint — and the story's own claim is that it did not lose it to the ring.
    console.log("390 — a row, the sheet, and back");
    const phone = await browser.newPage({ viewport: PHONE });
    await open(phone);
    const second = phone.locator(".inbox-row").nth(1);
    const wanted = await second.getAttribute("data-thread-id");
    if (wanted === null) throw new Error("the second row carries no data-thread-id");
    await second.click();
    await phone.locator('[data-testid="detail-pane"]').waitFor({ timeout: 15_000 });
    await phone.waitForTimeout(SETTLE_MS);

    const back = phone.getByRole("button", { name: "Back to Inbox" });
    if ((await back.count()) !== 1) throw new Error("the 390 sheet draws no Back to Inbox row");
    await back.click();
    await phone
      .locator('[data-testid="detail-pane"]')
      .waitFor({ state: "detached", timeout: 15_000 });
    await phone.waitForTimeout(SETTLE_MS);

    const tint = (await phone.evaluate(TINT_PROBE)) as {
      threadId: string;
      background: string;
      boxShadow: string;
      radius: string;
    } | null;
    if (tint === null) throw new Error("coming back from the sheet left no row selected");
    if (tint.threadId !== wanted) {
      throw new Error(`the tapped row was ${wanted} but ${tint.threadId} came back selected`);
    }
    if (tint.boxShadow !== "none")
      throw new Error(`the narrow row still floats a card: ${tint.boxShadow}`);
    if (tint.radius !== "0px")
      throw new Error(`the narrow row is ${tint.radius}, not a square band`);
    console.log(`  row 2 came back selected: ${tint.background}, square and unshadowed`);
    await phone.screenshot({ path: join(OUT, "390.png") });

    console.log("loop-r1-03 shots written to", OUT);
  } finally {
    await browser.close();
  }
}

await main();
