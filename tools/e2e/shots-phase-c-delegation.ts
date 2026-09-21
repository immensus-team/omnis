// US-C05 evidence: Settings → Autonomy → Delegation, against the live stack rather than a mock.
// Frames land in docs/design/screens/phase-c/delegation-{1280,900}.png.
//
// The two widths are the two shells: the settings sub-nav becomes a left rail at `min-width: 1280px`
// of the shell container (app.css), and 900 is the narrow breakpoint the rest of the shell keys off —
// so the two frames are the two layouts this section has, not two sizes of one layout.
//
// Why a stack and not a jsdom render: every claim US-C05 makes is a claim about the *hub*. The
// two-step warning ("nothing is stored until Allow") and "Remove is immediate" differ only in what
// `settings.delegation.allow_rules` holds after the click, and the editor writes through
// `PUT /settings/:key` — so each step below reads the column back out of Postgres and fails if the
// screen and the row disagree. A mock would assert the mock.
//
// What is real on the frames:
//   - The empty state is the seed's own `[]` out of migration 0015's `('delegation.allow_rules',
//     '[]')`, not a value this script injected.
//   - The rule row is a rule this script added through the screen's dialog, stored by the hub and
//     re-read from it on the second pass — so the frame is of the read path as well as the write one.
//   - The Hermes option is disabled because `delegation.hermes_enabled` is false in this run, which
//     is its seeded default; the frame shows the reason the screen gives for it.
//
// Run: OMNIS_E2E_DB=omnis_e2e_phase_c_w1 pnpm tsx tools/e2e/shots-phase-c-delegation.ts
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Browser, type Locator, type Page, chromium } from "@playwright/test";
import { Pool } from "../../packages/db/src/index.js";
import { getSetting } from "../../packages/kernel/src/settings.js";
import { canonicalJson } from "../../packages/protocol/src/delegation.js";
import { assertNoOverflow, describeOverflow, measureOverflow } from "./overflow.js";
import { seed } from "./seed.js";
import {
  HUB_PORT,
  REPO_ROOT,
  VITE_PORT,
  ZERO_PORT,
  assertPortsFree,
  deployZeroPermissions,
  loadOrCreateEnv,
  resetDatabase,
  startDesktop,
  startHub,
  startZeroCache,
  stopAll,
  waitForHttp,
} from "./stack.js";

const OUT = join(REPO_ROOT, "docs/design/screens/phase-c");

/** The section's copy, spelled the way the component and `packages/ui/src/i18n/en.ts` spell it.
 *  Literals rather than imports: the screen module renders React and pulls `@omnis/ui`'s image
 *  assets, which a node script has no business loading. */
const HEADING = "Delegation";
const EMPTY = "No runtime runs without your approval.";
const ADD = "Add rule";
const WARNING =
  "Delegations to this runtime in this repository will run without approval. Continue?";
const RELATIVE_PATH = "Use an absolute path";
const HERMES_HINT = "Needs the Hermes approval check first";

/** The rule the frames are of. `repo` is this worktree: absolute (A4 §4.4's schema is) and long
 *  enough that it is the thing most likely to push the page wider than a 320px phone — which is the
 *  other half of what the sweep below measures. */
const RULE = { runtime: "codex", host: "mini", repo: REPO_ROOT };

/** How `RUNTIME_LABEL` and the host map spell the two ids above — the row reads as a sentence. */
const ROW_TEXT = `Codex on the Mac mini in ${REPO_ROOT}`;

/** The column's own value, as the hub stored it. */
function storedRules(pool: Pool): Promise<unknown> {
  return getSetting<unknown>(pool, "delegation.allow_rules", []);
}

/** `delegation.allow_rules` is jsonb, and jsonb does not preserve key order — Postgres stores an
 *  object's keys sorted by length then by name, so the row comes back `{host, repo, runtime}` for a
 *  rule this script wrote `{runtime, host, repo}`. Comparing the two by a plain `JSON.stringify` is a
 *  comparison of key order, not of value; `canonicalJson` (Task 0's, in packages/protocol) sorts at
 *  every depth, which is the same normalisation the approval signatures are built on. */
function sameJson(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

/** Reads the column until it holds `want`, or fails with what it does hold.
 *
 *  Every write on this screen is a `PUT /settings/:key` (contract §5) and the dialog closes the
 *  moment `onSave` is called rather than when it resolves — the outcome reaches the person through
 *  the screen's notice, not through the dialog staying open. So "click, then read" is a race against
 *  the request, and the claim this asserts is narrower and real: the write *lands*. The deadline is
 *  what makes that a bounded claim instead of a flaky one. */
async function waitForRules(pool: Pool, want: unknown, where: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const seen = await storedRules(pool);
    if (sameJson(seen, want)) return;
    if (Date.now() > deadline) {
      throw new Error(
        `${where}: delegation.allow_rules holds ${JSON.stringify(seen)}, expected ${JSON.stringify(want)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function openDelegation(page: Page): Promise<void> {
  await page.goto(`http://127.0.0.1:${String(VITE_PORT)}/?screen=settings`);
  await page.waitForSelector(".settings-screen", { timeout: 60_000 });
  await page.waitForSelector('.settings-screen[data-state="ready"]', { timeout: 60_000 });
  await page.getByRole("radio", { name: "Autonomy", exact: true }).click();
  await page.waitForSelector('.settings-screen__section[aria-label="Autonomy"]');
}

/** The Delegation field, found by its own heading — the Autonomy tab has three fields and only one
 *  of them is this one, so a bare `.settings-screen__field` would let a neighbour stand in for it. */
function section(page: Page): Locator {
  return page.locator(".settings-screen__field", {
    has: page.getByRole("heading", { name: HEADING, exact: true }),
  });
}

function removeButton(page: Page): Locator {
  return section(page).getByRole("button", { name: /^Remove/ });
}

/** Opens the dialog. The warning is asserted before anything is filled, because a two-step flow
 *  whose first step never appears is the failure this checks for. */
async function openDialog(page: Page): Promise<Locator> {
  await section(page).getByRole("button", { name: ADD, exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.waitFor({ timeout: 10_000 });
  const question = await dialog.locator(".settings-screen__dialog-question").textContent();
  if (question !== WARNING) {
    throw new Error(`the delegation warning reads "${String(question)}", expected "${WARNING}"`);
  }
  return dialog;
}

const field = (page: Page, label: string): Locator => page.getByLabel(label, { exact: true });

/** The resting frame: the seed's `[]`, drawn as the empty state. */
async function checkEmpty(page: Page, pool: Pool): Promise<void> {
  if (!sameJson(await storedRules(pool), [])) {
    throw new Error("the seed did not leave delegation.allow_rules at []");
  }
  const text = await section(page).locator(".settings-screen__hint").allTextContents();
  if (!text.includes(EMPTY)) {
    throw new Error(`the empty state reads ${JSON.stringify(text)}, expected "${EMPTY}"`);
  }
  if ((await removeButton(page).count()) !== 0) {
    throw new Error("a rule row is drawn while delegation.allow_rules is empty");
  }
}

/** A5 §3.9's two-step, checked at the one moment that separates it from a one-step flow: after the
 *  fields are filled and before Allow. Also the plan's relative-path refusal — a path that is not
 *  absolute must not reach the hub, so the column is read between the two Allow clicks. */
async function writeRule(page: Page, pool: Pool): Promise<void> {
  const dialog = await openDialog(page);

  // The reason the Hermes option cannot be picked is on the frame, next to the field it is about.
  const hermes = field(page, "Runtime").locator('option[value="hermes"]');
  if (!(await hermes.isDisabled())) {
    throw new Error("the Hermes option is enabled while delegation.hermes_enabled is false");
  }
  if (!(await dialog.getByText(HERMES_HINT, { exact: true }).isVisible())) {
    throw new Error(
      `the Hermes option is disabled but the screen gives no reason ("${HERMES_HINT}")`,
    );
  }

  await field(page, "Runtime").selectOption(RULE.runtime);
  await field(page, "Host").selectOption(RULE.host);

  // Relative first: the screen has to refuse it on its own, before the hub ever hears about it.
  await field(page, "Repository path").fill("omnis");
  await dialog.getByRole("button", { name: "Allow", exact: true }).click();
  await dialog.getByText(RELATIVE_PATH, { exact: true }).waitFor({ timeout: 10_000 });
  if (!sameJson(await storedRules(pool), [])) {
    throw new Error("a relative repository path reached the hub");
  }

  await field(page, "Repository path").fill(RULE.repo);
  if (!sameJson(await storedRules(pool), [])) {
    throw new Error("the rule was stored before Allow was pressed — the warning is not a step");
  }
  await dialog.getByRole("button", { name: "Allow", exact: true }).click();
  await dialog.waitFor({ state: "detached", timeout: 10_000 });

  await waitForRules(pool, [RULE], "Allow");
  const notice = await page.textContent(".settings-screen__notice");
  if (notice !== "Delegation rules saved.") throw new Error(`the notice reads "${String(notice)}"`);
}

/** The read pass: a fresh load draws the row the hub holds. The text is compared as a literal, so a
 *  row that renders an id where a name belongs fails here rather than looking plausible in a PNG. */
async function checkStored(page: Page, pool: Pool): Promise<void> {
  if (!sameJson(await storedRules(pool), [RULE])) {
    throw new Error("the rule did not survive the reload — this pass has nothing to be of");
  }
  const rows = section(page).locator(".settings-screen__rule");
  if ((await rows.count()) !== 1)
    throw new Error(`the list draws ${String(await rows.count())} rows`);
  const text = await rows.first().textContent();
  if (text !== ROW_TEXT) {
    throw new Error(`the rule row reads "${String(text)}", expected "${ROW_TEXT}"`);
  }
  if ((await removeButton(page).count()) !== 1) {
    throw new Error("the rule row has no Remove button");
  }
}

/** Remove is one step, and the frame is not of it — but the plan's claim is that it saves with no
 *  dialog, so it is checked with the column. Runs last, because it empties the column both frames
 *  are of. */
async function checkRemove(page: Page, pool: Pool): Promise<void> {
  await removeButton(page).click();
  // A dialog would be on screen already if there were one — the write is the only thing to wait on.
  if ((await page.getByRole("alertdialog").count()) !== 0) {
    throw new Error("Remove opened a dialog — it must not have a second step");
  }
  await waitForRules(pool, [], "Remove");
}

/** One frame plus the horizontal reading. Measured before the shutter, so a run that fails here does
 *  not leave a frame behind to be mistaken for evidence. */
async function shoot(page: Page, label: string): Promise<void> {
  await page.waitForTimeout(700);
  const overflow = await page.evaluate(measureOverflow);
  assertNoOverflow(`delegation at ${label}px`, overflow);
  console.log(`  delegation-${label}.png — ${describeOverflow(overflow)}`);
  await page.screenshot({ path: join(OUT, `delegation-${label}.png`) });
}

/** `docs/design/SKILLS.md`'s slop-test gate 11: a sideways scrollbar at even one of 320/375/414/768
 *  fails the task. The rule row is the new risk — an absolute path is one unbroken run — so the
 *  sweep runs with the rule on screen, not empty. Resized rather than reloaded: the shell's layout is
 *  container-query based, so a resize is what exercises it. */
const SWEEP_WIDTHS = [320, 375, 414, 768];

async function sweep(browser: Browser, pool: Pool): Promise<void> {
  const page = await browser.newPage({ viewport: { width: SWEEP_WIDTHS[0], height: 800 } });
  try {
    await openDelegation(page);
    await checkStored(page, pool);
    for (const width of SWEEP_WIDTHS) {
      await page.setViewportSize({ width, height: 800 });
      const overflow = await page.evaluate(measureOverflow);
      assertNoOverflow(`delegation at ${String(width)}px`, overflow);
      console.log(`  ${String(width)}px — ${describeOverflow(overflow)}`);
    }
  } finally {
    await page.close();
  }
}

async function main(): Promise<void> {
  const env = loadOrCreateEnv();
  assertPortsFree();
  await resetDatabase(env);
  deployZeroPermissions(env);
  startZeroCache(env);
  await waitForHttp(`http://127.0.0.1:${String(ZERO_PORT)}/`, 90_000);
  startHub(env);
  await waitForHttp(`http://127.0.0.1:${String(HUB_PORT)}/health`, 60_000);
  startDesktop();
  await waitForHttp(`http://127.0.0.1:${String(VITE_PORT)}/`, 90_000);

  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 4 });
  let closeBridge: (() => void) | undefined;
  try {
    const seeded = await seed(pool, env);
    closeBridge = seeded.closeBridge;

    mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch();
    try {
      // 1280 adds the rule through the dialog; 900 is a fresh load that reads it back from the hub.
      const wide = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      try {
        await openDelegation(wide);
        await checkEmpty(wide, pool);
        await writeRule(wide, pool);
        await shoot(wide, "1280");
      } finally {
        await wide.close();
      }

      const narrow = await browser.newPage({ viewport: { width: 900, height: 900 } });
      try {
        await openDelegation(narrow);
        await checkStored(narrow, pool);
        await shoot(narrow, "900");
      } finally {
        await narrow.close();
      }

      // The widths, with the long path still on screen — an empty list has nothing to blow the page
      // out with, which is the whole risk this sweep is here for.
      await sweep(browser, pool);

      // Last, because it empties the column both frames are of.
      const last = await browser.newPage({ viewport: { width: 900, height: 900 } });
      try {
        await openDelegation(last);
        await checkStored(last, pool);
        await checkRemove(last, pool);
      } finally {
        await last.close();
      }
      console.log("Remove cleared delegation.allow_rules — the seed is whole again");
    } finally {
      await browser.close();
    }
    console.log("shots written to", OUT);
  } finally {
    closeBridge?.();
    await pool.end();
    await stopAll();
  }
}

await main();
