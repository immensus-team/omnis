// loop-r1-05 evidence: two writes that used to fail silently now reach the hub, and the one that
// used to lose what you typed says what happened to it.
//
// Run against a stack that is already up (this script boots none of its own — it is the same live
// app a person is looking at):
//   OMNIS_E2E_DB=omnis_test_loop_r1_e2e OMNIS_E2E_PORT_OFFSET=200 ZERO_SHARD_NUM=9 \
//     pnpm tsx tools/e2e/hold.ts --web
//   pnpm tsx tools/e2e/shots-loop-r1-05.ts   (desktop http://127.0.0.1:5373, PWA :5374)
//
// Why a script and not two committed PNGs: the two bugs are not visible in a picture. L-14/NC-07 is
// a *status code* — the before shot of Notes after a save looks exactly like the after shot, because
// the box clears either way; the missing `/notes` proxy entry is only observable in the response,
// and the missing `/tasks` route only in the row that does not appear. A picture of a save and a
// picture of a lost write are the same picture. The screenshots below are the product evidence the
// brief asks for (the new task listed, "Added to Tasks" showing); the assertions are the proof.
//
// Three checks, in the order a person hits them:
//   1. Notes: type, click Save, and assert the `/notes` response is 201 with no alert on the screen.
//      In the dev and browser shells this POST used to leave the app as a request to the Vite server
//      (the proxy table did not name /notes) and never reached the hub.
//   2. Tasks: type, press Enter, and assert the `/tasks` response is 201 — then find the row under
//      the Someday tab, which is where an undated task belongs.
//   3. The database: one `tasks` row with that title, read with `pg` the way hold.ts reads it. The
//      201 alone would not say the row is there; the screen's row arrives through Zero, so neither
//      of the first two checks covers the table itself.
//
// The 390 pass is a resize of the same page rather than a second page: "Added to Tasks" clears
// itself after three seconds, and the two screenshots the brief wants are the same moment at two
// widths.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Page, chromium } from "@playwright/test";
import { Pool, query } from "../../packages/db/src/index.js";
import { describeOverflow, measureOverflow } from "./overflow.js";
import { REPO_ROOT, loadOrCreateEnv } from "./stack.js";

const BASE = process.env.OMNIS_SHOTS_URL ?? "http://127.0.0.1:5373";
const OUT = join(REPO_ROOT, "docs/design/loop/r1/impl/loop-r1-05");

const WIDE = { width: 1440, height: 900 } as const;
/** The brief's 390x844, without `isMobile` — the same way the other shot tools take a narrow pass. */
const PHONE = { width: 390, height: 844 } as const;
/** SKILLS.md #11's four narrow widths: no horizontal overflow at even one of them. */
const SWEEP = [320, 375, 414, 768] as const;

const NOTE = "Call the bank";
const TITLE = "Send Dana the slides";

/** The status line is on a three-second timer, so nothing may sit between the row appearing and the
 *  screenshots. Both of the assertions below are made in that window, and a miss is a loud failure
 *  rather than a screenshot that quietly lost the half of the evidence that is a caption. */
const QUICK_ADD_NOTICE = "Added to Tasks";
const QUICK_ADD_FAILED = "Couldn't add the task. It is still in the box.";

async function open(page: Page, screen: "notes" | "tasks"): Promise<void> {
  await page.goto(`${BASE}/?screen=${screen}`);
  await page.waitForSelector(`.${screen}-screen`, { timeout: 60_000 });
}

/** Wait until exactly `want` rows in the list carry this title. Counted rather than matched by text:
 *  both "not there yet" and "the previous run's row is still there" are answers this script waits
 *  for, and a text matcher would resolve to two rows instead of one and fail the screenshot's whole
 *  point. Throws on timeout, which is the loud half of the assertion. */
async function countRows(page: Page, title: string, want: number, timeout: number): Promise<void> {
  await page.waitForFunction(
    ([wanted, text]) =>
      Array.from(document.querySelectorAll(".task-row__title")).filter(
        (el) => el.textContent === text,
      ).length === wanted,
    [want, title] as const,
    { timeout },
  );
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  // tools/e2e/.env is written once and keeps whichever database the *first* stack in this worktree
  // used; `loadOrCreateEnv` only follows OMNIS_E2E_DB when it is exported. Without this guard the
  // browser would talk to the stack on :5373 while checks 2 and 3 read and cleared some other
  // database — which is exactly how this script first failed (two runs reported a missing row that
  // the real stack had). The port offset cannot tell us the database name, so the variable is
  // required rather than inferred.
  if (process.env.OMNIS_E2E_DB === undefined) {
    throw new Error("OMNIS_E2E_DB must name the running stack's database (see the header)");
  }
  const env = loadOrCreateEnv();
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });
  const browser = await chromium.launch();

  try {
    // The tool has to be re-runnable against a stack that is already up (hold.ts resets the database
    // only at boot), and check 3 asserts *one* row with this title — so this run's own fixture is
    // cleared before the browser opens. Done here rather than next to the add on purpose: the delete
    // travels to Zero's replica asynchronously, and the Notes pass below is the time it takes to
    // land, so the Tasks screen never shows the previous run's row beside this one's. Nothing else
    // in this throwaway stack writes that title.
    await query(pool, "DELETE FROM tasks WHERE title = $1", [TITLE]);

    // ---- 1. Notes: the write that landed on the Vite server ---------------------------------------
    console.log("Notes — POST /notes");
    const page = await browser.newPage({ viewport: WIDE });
    await open(page, "notes");
    await page.getByRole("textbox", { name: "New note" }).fill(NOTE);
    const [noteResponse] = await Promise.all([
      page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/notes" && r.request().method() === "POST",
        { timeout: 30_000 },
      ),
      page.getByRole("button", { name: "Save" }).click(),
    ]);
    if (noteResponse.status() !== 201) {
      throw new Error(
        `POST /notes answered ${noteResponse.status()}, not 201 — the proxy table is not naming /notes`,
      );
    }
    // The save is only half the check: the screen must not have drawn its failure line either, which
    // is what a 404 from the Vite fallback would have produced alongside the 200 the shot shows.
    await page.waitForTimeout(300);
    const noteAlerts = await page.locator(".notes-screen [role=alert]").allTextContents();
    if (noteAlerts.length > 0) {
      throw new Error(`the Notes screen drew an alert after a 201: ${noteAlerts.join(" / ")}`);
    }
    console.log(`  POST /notes → ${noteResponse.status()}, no alert on screen`);

    // ---- 2. Tasks: the row that had no route behind it --------------------------------------------
    console.log("Tasks — POST /tasks");
    await open(page, "tasks");
    // The replica catching up with the fixture delete above. Counted in the list rather than matched
    // by text, because the screenshot has to be of one row: a stale copy beside the new one would be
    // in the picture even though the database is correct.
    await countRows(page, TITLE, 0, 15_000);
    // Someday is the view an undated task belongs in (filterTasksByView), and the new task has no
    // due date — on Today it would land in a list that does not show it.
    await page.getByRole("radio", { name: "Someday" }).click();
    await page.getByRole("textbox", { name: "Quick add task" }).fill(TITLE);
    const [taskResponse] = await Promise.all([
      page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/tasks" && r.request().method() === "POST",
        { timeout: 30_000 },
      ),
      page.getByRole("textbox", { name: "Quick add task" }).press("Enter"),
    ]);
    if (taskResponse.status() !== 201) {
      throw new Error(
        `POST /tasks answered ${taskResponse.status()}, not 201 — the quick-add has no route behind it`,
      );
    }
    const added = await taskResponse.json();
    if (added.title !== TITLE) {
      throw new Error(`POST /tasks stored "${String(added.title)}", not "${TITLE}"`);
    }
    console.log(`  POST /tasks → ${taskResponse.status()} (${String(added.id)})`);

    // The row arrives through Zero, not from that response — so this waits for the screen, and the
    // clock starts the moment it appears (the status line's three seconds are already running).
    await countRows(page, TITLE, 1, 20_000);
    const status = page.getByRole("status");
    if ((await status.count()) !== 1 || (await status.textContent()) !== QUICK_ADD_NOTICE) {
      throw new Error(
        `the row is listed but the status line is "${(await status.allTextContents()).join("")}" — ` +
          `"${QUICK_ADD_NOTICE}" is what the brief's screenshots are of`,
      );
    }
    const alerts = await page.locator(".tasks-screen [role=alert]").allTextContents();
    if (alerts.includes(QUICK_ADD_FAILED)) {
      throw new Error(`the quick-add stored the row and still drew "${QUICK_ADD_FAILED}"`);
    }

    await page.screenshot({ path: join(OUT, "1440.png") });
    await page.setViewportSize(PHONE);
    await page.waitForTimeout(200);
    if ((await status.count()) !== 1) {
      throw new Error(
        "the status line expired between the two widths — the 390 shot would be of a " +
          "different moment than the 1440 one",
      );
    }
    await page.screenshot({ path: join(OUT, "390.png") });
    console.log(
      `  the row is listed under Someday with "${QUICK_ADD_NOTICE}" showing, at 1440 and 390`,
    );

    // ---- 3. The table itself ----------------------------------------------------------------------
    // The screen's row comes through Zero and the 201 comes from the hub; only this says the row is
    // in `tasks`. `due_at IS NULL` is the half that decides which view the task is in.
    const rows = await query<{
      title: string;
      state: string;
      kind: string;
      owner_kind: string;
      created_by: string;
      due_at: Date | null;
    }>(
      pool,
      "SELECT title, state, kind, owner_kind, created_by, due_at FROM tasks WHERE title = $1",
      [TITLE],
    );
    if (rows.length !== 1) {
      throw new Error(`${rows.length} tasks rows carry "${TITLE}", not 1`);
    }
    const [stored] = rows;
    if (stored?.state !== "open" || stored.kind !== "todo" || stored.due_at !== null) {
      throw new Error(`the stored task is ${JSON.stringify(stored)}`);
    }
    console.log(`  the database has one row: ${JSON.stringify(stored)}`);

    // ---- the narrow sweep ------------------------------------------------------------------------
    // SKILLS.md #11: no horizontal scroll at any of the four narrow widths. The assertion is the
    // page's own `scrollWidth` and not `assertNoOverflow`, because that helper also fails on any
    // element whose box pokes past the viewport — and this screen already has one that is not this
    // story's. The four view segments overrun their container at 320 (the "Delegated" button ends at
    // x=324 in a 320px window, measured 2026-09-21 with the quick-add field empty, so with no status
    // line on the screen at all). That is the Tasks header at the narrowest tier, older than
    // loop-r1-05 and outside its scope; `describeOverflow` still prints it below, so it stays visible
    // without being laid at this story's door. The line this story adds wraps and adds no width.
    for (const width of SWEEP) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForTimeout(300);
      const overflow = await page.evaluate(measureOverflow);
      console.log(`  ${width}px: ${describeOverflow(overflow)}`);
      if (overflow.diff > 0) {
        throw new Error(
          `horizontal scroll at Tasks ${width}: the body is ${overflow.diff}px wider than the viewport`,
        );
      }
    }

    await page.close();
    console.log("loop-r1-05 shots written to", OUT);
  } finally {
    await browser.close();
    await pool.end();
  }
}

await main();
