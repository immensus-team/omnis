// loop-r2-04 evidence: "overlays own the keyboard", against the live stack rather than a mock.
//
// The story's claims are about a *focus ring* and about a *key that did not arrive*. A component test
// can prove the guard's predicate (use-keymap.test.ts does) and that the drawer holds an input
// (ask-panel.test.tsx does), but only a real browser can say where `vaul`'s modal focus actually
// lands, whether the letters of a typed word reach the window keymap, and whether one Escape closes
// one layer or four. Two of the checks also read the database, because "no archive was sent" and "the
// row is still there" look identical on screen.
//
// Run against a stack that is already up (this script boots none of its own):
//   OMNIS_E2E_DB=omnis_test_loop_r2_impl OMNIS_E2E_PORT_OFFSET=500 ZERO_SHARD_NUM=12 \
//     pnpm tsx tools/e2e/hold.ts --web
//   OMNIS_E2E_DB=omnis_test_loop_r2_impl pnpm tsx tools/e2e/shots-loop-r2-04.ts
//
// The checks, in the order a person hits them:
//   1. At 390, ⌘K opens the ask drawer and the caret is in the drawer's own input — not on the
//      "Suggestions" tab button, which is where the letters of "Brightstone" used to land. The
//      hint row under it is a `<kbd>`, and a touch device has no keyboard to press it with, so all
//      of them are `display: none`. 390.png is the drawer with the word typed.
//   2. The same word, typed on the same device, archives nothing: no `POST …/archive` leaves the
//      page and `threads.archived_at` is exactly the set it was before.
//   3. At 1440 one Escape closes the model menu and *only* the model menu. The panel stays, the
//      thread stays, and the focus goes back to the toggle that opened the menu.
//   4. A cold 1440 load: Tab reaches the ask input without the panel opening under it (L2-13).
//   5. No horizontal overflow at 1440, 390 or 320.
//
// **The 390 row is selected with `j`, not by clicking it.** The brief says "select first row", and
// the click is not that: at 390 clicking a row opens the thread sheet, and the shell's own narrow
// rule (App.tsx `useCommandPaletteKey` — `if (narrow && (paneVisible || filtersOpen)) return`) makes
// ⌘K a deliberate no-op while a drawer is up, so the drawer the check is about never appears. The
// cursor is the faithful reading anyway: it is the row the Inbox's keymap would have archived, which
// is the data loss L2-03/NC2-15 reported, and the probe that established this is in the commit's
// notes. `j` selects without opening, so the drawer and the row coexist exactly as the bug had them.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Page, chromium } from "@playwright/test";
import { Pool, query } from "../../packages/db/src/index.js";
import { describeOverflow, measureOverflow } from "./overflow.js";
import { REPO_ROOT, loadOrCreateEnv } from "./stack.js";

const BASE = process.env.OMNIS_SHOTS_URL ?? "http://127.0.0.1:5673";
const OUT = join(REPO_ROOT, "docs/design/loop/r2/impl/loop-r2-04");

const WIDE = { width: 1440, height: 900 } as const;
/** The brief's 390x844, without `isMobile`. `hasTouch` and not `isMobile` because the rule this pass
 *  measures is `@media (pointer: coarse)`, and Chromium derives that from the emulated *input*
 *  profile rather than from the width: a plain 390px context reports `pointer: fine`, so the
 *  kbd-hiding rule would never fire and the check would pass on a rule that was never applied. */
const PHONE = { width: 390, height: 844 } as const;
/** SKILLS.md #11's narrowest width. */
const NARROW = { width: 320, height: 844 } as const;

/** The copy this script asserts on, spelled once so a reworded field fails the check instead of
 *  quietly passing it. */
const TYPED = "Brightstone";
const ASK_INPUT = "Ask or search";
/** The Inbox row the 1440 pass opens. `#` and all: it is the Slack channel thread's title. */
const LAUNCH = "#omnis-launch";

const DRAWER_INPUT = "[data-vaul-drawer].ask-panel .ask-panel__input";
const PANE = '[data-testid="detail-pane"]';
const PANEL = '[aria-label="AI panel"]';

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

/** Every thread carrying an `archived_at`. The 390 check's claim is a statement about this set not
 *  growing, and a set is the only shape in which "nothing was archived" is a check rather than a
 *  count that happens to match. */
async function archivedIds(pool: Pool): Promise<Set<string>> {
  const rows = await query<{ id: string }>(
    pool,
    "SELECT id FROM threads WHERE archived_at IS NOT NULL",
  );
  return new Set(rows.map((row) => row.id));
}

/** The one thread titled `title`, read from the database rather than clicked by eye: `#omnis-launch`
 *  and "omnis launch sync" are one word apart in the inbox and only the first is the Slack thread. */
async function threadByTitle(pool: Pool, title: string): Promise<string> {
  const rows = await query<{ id: string }>(pool, "SELECT id FROM threads WHERE title = $1", [
    title,
  ]);
  if (rows.length !== 1) {
    throw new Error(
      `${String(rows.length)} threads are titled "${title}" — the fixture is not the one the story names`,
    );
  }
  return (rows[0] as { id: string }).id;
}

/** What the browser says about the panel's shortcut hints, and where the caret is. Both are read
 *  from the live document rather than from a prop: the whole story is that a real `vaul` modal, a
 *  real focus ring and a real keymap are in play, and none of the three is visible from React. */
async function askDrawerState(page: Page) {
  return page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    const input = document.querySelector(".ask-panel__input") as HTMLInputElement | null;
    const hints = Array.from(document.querySelectorAll(".ask-panel kbd"));
    return {
      drawer: document.querySelectorAll("[data-vaul-drawer].ask-panel").length,
      value: input?.value ?? null,
      label: input?.getAttribute("aria-label") ?? null,
      caretInInput: active !== null && active === input,
      caret:
        active === null
          ? "none"
          : `${active.tagName.toLowerCase()}${active.getAttribute("aria-label") === null ? "" : `[${active.getAttribute("aria-label")}]`}`,
      hints: hints.length,
      hintDisplays: hints.map((hint) => getComputedStyle(hint).display),
    };
  });
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
    const before = await archivedIds(pool);
    const launch = await threadByTitle(pool, LAUNCH);
    console.log(
      `archived before this pass: ${String(before.size)}; "${LAUNCH}" is thread ${launch}`,
    );

    // ---- 1. 390: the drawer types, and nothing else does -------------------------------------------
    // `viewport:` and not the bare `{ width, height }`: `newContext` nests the size and silently
    // falls back to 1280x720 when it is handed a flat one, which is a wide-tier page that looks
    // perfectly healthy and has no drawer in it. `setViewportSize` below takes the flat shape, so
    // the same constant is right for one call and wrong for the other.
    const phone = await browser.newContext({ viewport: PHONE, hasTouch: true });
    const page = await phone.newPage();
    /** The archive the story is about is a *request*, so the check is on the wire and not on the
     *  outcome: a `POST /api/threads/…/archive` that the hub then rejected is still the bug. */
    const archives: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().includes("/archive")) {
        archives.push(request.url());
      }
    });

    await page.goto(BASE);
    await page.waitForSelector(".inbox-row", { timeout: 60_000 });
    await page.waitForTimeout(800);
    // The row at risk: `j` puts the Inbox's cursor on the first row without opening it (the movement
    // keys answer above the selection guard — Inbox.tsx's keymap), which is the state the bug needed
    // and the one a check can hold. Read back from the DOM, because "the cursor is on a row" is what
    // makes the absence of an archive mean something.
    await page.keyboard.press("j");
    const selected = await page.evaluate(() => {
      const row = document.querySelector('.inbox-row[aria-selected="true"]');
      return row === null ? null : row.getAttribute("data-thread-id");
    });
    if (selected === null) {
      throw new Error("`j` selected no row — there is nothing the typed `e` could have archived");
    }

    await page.keyboard.press("Meta+k");
    await page.locator(DRAWER_INPUT).waitFor({ timeout: 10_000 });
    const opened = await askDrawerState(page);
    // L2-03/NC2-15: this is the caret that used to be on the "Suggestions" tab button. Without it
    // the word below never reaches the input and every letter runs as an Inbox shortcut.
    if (!opened.caretInInput) {
      throw new Error(`⌘K left the caret on ${opened.caret}, not in the drawer's own input`);
    }
    // And the input it landed in is the one the brief names: the class selector above is a handle,
    // the accessible name is the contract (ask-panel.test.tsx holds the jsdom half of this).
    if (opened.label !== ASK_INPUT) {
      throw new Error(`the drawer's input is named "${String(opened.label)}", not "${ASK_INPUT}"`);
    }
    // Item 3: a hint a touch device cannot act on is copy that lies. Read as a *computed* display,
    // because the rule is a media query and a class assertion would pass on a stylesheet that never
    // applied. The count guard is what keeps this from passing vacuously — and it is exactly the
    // state the story names: the word is not typed yet, so the tab under the caret is Suggestions
    // and its fallback rows end in `<kbd>`s.
    if (opened.hints === 0) {
      throw new Error("no shortcut hint is on the drawer's Suggestions tab — the rule is untested");
    }
    const shown = opened.hintDisplays.filter((display) => display !== "none");
    if (shown.length > 0) {
      throw new Error(
        `${String(shown.length)} of ${String(opened.hints)} hints in the drawer are visible on a coarse pointer: ${shown.join(", ")}`,
      );
    }
    console.log(
      `  1. at 390 ⌘K put the caret in the drawer's input (${opened.caret}) and hid all ${String(opened.hints)} shortcut hints`,
    );

    await page.keyboard.type(TYPED, { delay: 30 });
    await page.waitForTimeout(1200);
    const typed = await askDrawerState(page);
    if (typed.value !== TYPED) {
      throw new Error(`the drawer's input reads "${String(typed.value)}", not "${TYPED}"`);
    }
    // The word is in the drawer and nowhere else: the caret is still the input after all ten keys,
    // which is the half a value assertion alone would miss (a stray `r` would have moved it).
    if (!typed.caretInInput) {
      throw new Error(`typing moved the caret to ${typed.caret} — a key escaped the overlay`);
    }
    await page.screenshot({ path: join(OUT, "390.png") });
    const afterHints = typed.hintDisplays.filter((display) => display !== "none").length;
    console.log(
      `     "${TYPED}" is in the drawer's input, caret still in it, ${String(typed.hints)} hints on screen (${String(afterHints)} visible)`,
    );

    // ---- 2. Nothing was archived ---------------------------------------------------------------
    if (archives.length > 0) {
      throw new Error(
        `typing in the drawer sent ${String(archives.length)} archive request(s): ${archives.join(", ")}`,
      );
    }
    const after = await archivedIds(pool);
    const leaked = [...after].filter((id) => !before.has(id));
    if (leaked.length > 0) {
      throw new Error(
        `typing in the drawer archived ${String(leaked.length)} thread(s) that were not archived before: ${leaked.join(", ")}`,
      );
    }
    console.log(
      `  2. no POST …/archive left the page, and the archived set is unchanged (${String(after.size)}) — the row under the cursor (${selected}) is still in the inbox`,
    );

    // ---- 3. One Escape closes one layer, at 1440 ---------------------------------------------------
    const wide = await browser.newPage({ viewport: WIDE });
    await wide.goto(BASE);
    await wide.waitForSelector(".inbox-row", { timeout: 60_000 });
    // L2-13, cold: Tab is keyboard focus and nothing more. The panel used to open under the caret and
    // then stay up with the focus gone, swallowing the presses that landed on the pills beneath it.
    let tabs = 0;
    for (; tabs < 40; tabs += 1) {
      await wide.keyboard.press("Tab");
      const onAsk = await wide.evaluate(
        () => (document.activeElement as HTMLElement | null)?.hasAttribute("cmdk-input") === true,
      );
      if (onAsk) break;
    }
    if (tabs === 40) {
      throw new Error("40 Tabs never reached the ask input");
    }
    if (!(await wide.evaluate(() => document.querySelector('[aria-label="AI panel"]') === null))) {
      throw new Error("the panel opened for a keyboard focus that never pressed the bar");
    }
    console.log(`  3. ${String(tabs + 1)} Tabs reached the ask input and no panel opened under it`);

    await wide.locator(`.inbox-row[data-thread-id="${launch}"]`).click();
    await poll(
      async () => (await wide.locator(PANE).innerText()).includes(LAUNCH),
      (found) => found,
      `"${LAUNCH}" to be on the pane`,
    );
    await wide.locator(".ask-bar__pill").click();
    await wide.locator(PANEL).waitFor({ timeout: 5_000 });
    await wide.locator(".ask-bar__model-toggle").click();
    await wide.locator(".ask-bar__model-menu").waitFor({ timeout: 5_000 });
    await wide.waitForTimeout(400);

    // The one press. Four things used to go with it: the menu, the panel, the typed text and the
    // open thread (NC2-12).
    await wide.keyboard.press("Escape");
    await wide.waitForTimeout(700);
    const closed = await wide.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      const pane = document.querySelector('[data-testid="detail-pane"]');
      return {
        menu: document.querySelectorAll(".ask-bar__model-menu").length,
        panel: document.querySelectorAll('[aria-label="AI panel"]').length,
        pane: pane === null ? null : pane.innerText.includes("#omnis-launch"),
        focus:
          active === null
            ? "none"
            : active.className.match(/ask-bar__model-toggle/)
              ? "toggle"
              : String(active.tagName).toLowerCase(),
      };
    });
    if (closed.menu !== 0) {
      throw new Error("the model menu is still open after Escape");
    }
    if (closed.panel === 0) {
      throw new Error("the same Escape closed the AI panel as well as the menu");
    }
    if (closed.pane !== true) {
      throw new Error(
        `the same Escape closed the thread too — the pane no longer shows "${LAUNCH}"`,
      );
    }
    if (closed.focus !== "toggle") {
      throw new Error(
        `Escape left the focus on ${closed.focus}, not the toggle that opened the menu`,
      );
    }
    await wide.screenshot({ path: join(OUT, "1440.png") });
    console.log(
      "  4. one Escape closed the model menu, left the panel and the thread open, and put the focus back on the toggle",
    );
    await wide.close();
    await phone.close();

    // ---- 4. No horizontal overflow ---------------------------------------------------------------
    const sweep = await browser.newPage({ viewport: WIDE });
    await sweep.goto(BASE);
    await sweep.waitForSelector(".inbox-row", { timeout: 60_000 });
    for (const viewport of [WIDE, PHONE, NARROW]) {
      await sweep.setViewportSize(viewport);
      await sweep.waitForTimeout(500);
      const overflow = await sweep.evaluate(measureOverflow);
      console.log(`  ${String(viewport.width)}px: ${describeOverflow(overflow)}`);
      if (overflow.diff > 0) {
        throw new Error(
          `horizontal scroll at ${String(viewport.width)}: the body is ${String(overflow.diff)}px wider than the viewport`,
        );
      }
    }
    await sweep.close();
    console.log("  5. no horizontal overflow at 1440, 390 or 320");

    console.log("loop-r2-04 shots written to", OUT);
  } finally {
    await browser.close();
    await pool.end();
  }
}

await main();
