// US-B33 (Settings screen) screenshots: docs/design/screens/w4b/settings-{1440,390}.png.
//
// Same stack and the same two sizes as the other w4b shot tools (1440x900 and 390x844), plus a
// horizontal-overflow sweep over docs/design/SKILLS.md's four slop-test widths (320/375/414/768) — the
// gate that fails the whole task if a scrollbar appears at any one of them.
//
// The frame is the **Autonomy** section, and that is a deliberate choice rather than a shrug:
//
//   - A5 §3.9's Model tiers bar draws this month's spend from `agent_runs.cost_usd`, and nothing in
//     this repo produces that column yet — `recordRun`'s callers never set it and there is no price
//     table anywhere in `packages/*/src` (the provider layer is a later wave). A seeded month
//     therefore truthfully reads `$0 / $60`, so a Model tiers frame would be a photograph of an
//     empty bar: exactly the placeholder these frames exist to rule out. The other w4b shot tools
//     took the same reading of the same column (shots-w4b-digest: "a month with no spend truthfully
//     reads as `$0 / $60`"). The bar is still asserted below, so the run fails if it stops drawing
//     the real numbers — it is just not what the frame is of.
//   - Autonomy is the section the fixture can fill the way a person would, through the screen's own
//     gestures: the allowlist inputs add chips on Enter and the channel switch opens its warning
//     dialog, and both go to the hub over HTTP (contract §5) and come back. The frame is evidence
//     that the write path is wired, not just that the reads render.
//
// What is real on the frame:
//   - The five accounts are the run's own rows — `tools/e2e/seed.ts` creates slack/gmail/gcal with
//     `{read:true,write:true}`, and the kernel's notification path and the agent session add `system`
//     and `agent` — drawn through `zero.query.accounts`, the same read the rail uses.
//   - The chips were typed into the screen's inputs and landed in `settings` via PUT /settings/:key,
//     which audits them (`audit_log.settings.set`, delta §5).
//   - `autonomy.rules` was written by the switch's confirm dialog — the same PUT, after the
//     "Actions to this target send without approval" warning.
//   - The quiet hours and the threshold the tool asserts are the rows migration 0009 seeded.
//
// The 1440 pass makes the writes; the 390 pass is a fresh page load that re-reads them from the hub,
// so the two frames together cover the write path and the read path. Neither frame is asserted
// against a value this script typed: every expectation is read back out of `settings` after the
// write, which is what makes a screen that invents a number fail the run instead of reaching a PNG.
//
// Run: pnpm tsx tools/e2e/shots-w4b-settings.ts   (same ports as the e2e smoke — never run both at once)
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Browser, type Locator, type Page, chromium } from "@playwright/test";
import { Pool, query } from "../../packages/db/src/index.js";
import { currentPolicy } from "../../packages/kernel/src/cost/governor.js";
import { getSetting } from "../../packages/kernel/src/settings.js";
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

const OUT = join(REPO_ROOT, "docs/design/screens/w4b");

/** A5 §8's copy, as the screen's own constants spell it (`AUTONOMY_WARNING`/`KILL_SWITCH_QUESTION`).
 *  Asserted as literals rather than imported: the screen module renders React and pulls `@omnis/ui`'s
 *  image assets, which a node script has no business loading. */
const AUTONOMY_WARNING = "Actions to this target send without approval";

/** The channel the frame turns autonomy on for. A5 §3.9: every target starts off, and turning one on
 *  is the write worth showing — an all-off list is the resting state, not a finished one. */
const AUTONOMY_CHANNEL = "slack";

/** The channel the frame leaves alone, asserted to stay off: one switch flipped is only evidence if
 *  its neighbours did not move with it. */
const UNTOUCHED_CHANNEL = "gmail";

/** The allowlist the fixture types in, in the order the screen draws the kinds (`ALLOWLIST_KINDS`).
 *  MacBook folders are left empty on purpose: an empty list is a real state of this screen ("An empty
 *  list means none"), and filling all four would make the frame incapable of showing it. */
const ALLOWLIST = [
  {
    kind: "ingest.local_roots.mini",
    heading: "Mac mini folders",
    addLabel: "Add a Mac mini folder",
    entries: ["~/AI-Workspaces"],
  },
  {
    kind: "ingest.drive_folders",
    heading: "Google Drive folders",
    addLabel: "Add a Google Drive folder",
    entries: ["Boards", "Contracts"],
  },
  {
    kind: "ingest.github_repos",
    heading: "GitHub repos",
    addLabel: "Add a GitHub repo",
    entries: ["logankim/omnis"],
  },
] as const;

/** Every channel a seeded `accounts` row can carry, spelled the way `CHANNEL_LABEL` spells it (the map
 *  the rail and every inbox row render from). The seed itself creates three (slack/gmail/gcal) and the
 *  rest of the run adds the kernel's `system` row and the agent session's `agent` row, so the screen
 *  draws five — which is why the assertions below are written per channel, not per seed entry. */
const CHANNEL_NAMES: Record<string, string> = {
  slack: "Slack",
  gmail: "Gmail",
  gcal: "Google Calendar",
  system: "System",
  agent: "Agent",
};

interface Seeded {
  accounts: { channel: string; name: string }[];
  capUsd: number;
  mtdUsd: number;
  rules: string[];
  allowlists: Record<string, string[]>;
  quiet: { start: string; end: string };
  threshold: number;
}

/** Everything the frame asserts, read out of the database — so the expectations are the rows the hub
 *  stored, not values this script typed and believed. */
async function readBack(pool: Pool): Promise<Seeded> {
  const rows = await query<{ channel: string }>(
    pool,
    "SELECT channel FROM accounts ORDER BY created_at",
  );
  if (rows.length === 0) throw new Error("the seed created no accounts");
  const accounts = rows.map((row) => ({
    channel: row.channel,
    name: CHANNEL_NAMES[row.channel] ?? row.channel,
  }));

  const allowlists: Record<string, string[]> = {};
  for (const entry of ALLOWLIST) {
    allowlists[entry.kind] = await getSetting<string[]>(pool, entry.kind, []);
  }

  const { mtdUsd } = await currentPolicy(pool, new Date());
  const rules = await getSetting<{ ref?: unknown }[]>(pool, "autonomy.rules", []);
  return {
    accounts,
    capUsd: await getSetting<number>(pool, "cost.cap_usd", 60),
    mtdUsd,
    rules: rules.map((rule) => String(rule.ref)),
    allowlists,
    quiet: await getSetting<{ start: string; end: string }>(pool, "notify.quiet_hours", {
      start: "23:00",
      end: "07:00",
    }),
    threshold: await getSetting<number>(pool, "archive.t1_confidence_min", 0.85),
  };
}

async function openTab(page: Page, label: string): Promise<void> {
  await page.getByRole("radio", { name: label, exact: true }).click();
  await page.waitForSelector(`.settings-screen__section[aria-label="${label}"]`);
}

function switchFor(page: Page, channel: string): Locator {
  const name = CHANNEL_NAMES[channel] ?? channel;
  return page.getByRole("switch", { name: `Allow autonomy for ${name}`, exact: true });
}

/** Checks the three sections the frame is not of against the database, then — on the write pass —
 *  fills the Autonomy section through the screen's own gestures. */
async function openSettings(page: Page, before: Seeded, write: boolean): Promise<void> {
  await page.goto(`http://127.0.0.1:${String(VITE_PORT)}/?screen=settings`);
  await page.waitForSelector(".settings-screen", { timeout: 60_000 });
  await page.waitForSelector('.settings-screen[data-state="ready"]', { timeout: 60_000 });

  const title = await page.textContent(".settings-screen__title");
  if (title !== "Settings") throw new Error(`the title reads "${String(title)}"`);

  // ── Accounts: the seed's own rows, one status pill each ───────────────────────────────────────
  await openTab(page, "Accounts");
  // Both sides sorted: Zero decides the order it syncs rows in, and it is not `created_at` — an
  // order-sensitive assertion here would fail on the sync's whim rather than on the screen's.
  const drawnNames = (
    await page.locator(".settings-screen__account-name").allTextContents()
  ).sort();
  const wantNames = before.accounts.map((a) => a.name).sort();
  if (drawnNames.join(", ") !== wantNames.join(", ")) {
    throw new Error(
      `the account list reads ${JSON.stringify(drawnNames)}, expected ${JSON.stringify(wantNames)}`,
    );
  }
  // A5 §9 again, on the pill: the state is a word, and the tone it is drawn on is the one that word
  // owns — not whatever colour a screen felt like. The labels' own rule (state vs capabilities) is
  // the screen's, so it is deliberately not restated here; what this asserts is that no pill is
  // blank and none is a state the screen has no copy for.
  const TONES: Record<string, string> = {
    Connected: "success",
    "Read only": "neutral",
    Paused: "warning",
    Broken: "danger",
  };
  const pills = page.locator(".settings-screen__account .status-pill");
  for (let i = 0; i < wantNames.length; i += 1) {
    const label = (await pills.nth(i).textContent()) ?? "";
    if (!(label in TONES)) throw new Error(`account ${i} reads "${label}", which is not a state`);
    if ((await pills.nth(i).getAttribute("data-tone")) !== TONES[label]) {
      throw new Error(`account ${i}'s "${label}" pill is not on the ${String(TONES[label])} tone`);
    }
  }

  // ── Model tiers: the bar's real numbers, off `agent_runs.cost_usd` ─────────────────────────────
  await openTab(page, "Model tiers");
  const spend = await page.textContent(".settings-screen__spend");
  if (spend !== `$${String(before.mtdUsd)} used`) {
    throw new Error(
      `the spend line reads "${String(spend)}", expected "$${String(before.mtdUsd)} used"`,
    );
  }
  const cap = await page.inputValue("#settings-cost-cap");
  if (cap !== String(before.capUsd)) {
    throw new Error(`the cap field reads "${cap}", expected "${String(before.capUsd)}"`);
  }
  const bar = page.locator(".settings-screen__bar");
  const ariaLabel = await bar.getAttribute("aria-label");
  if (ariaLabel !== `Monthly budget used: 0% of $${String(before.capUsd)}`) {
    throw new Error(`the bar's accessible name reads "${String(ariaLabel)}"`);
  }
  // A5 §9's "never colour alone": the threshold has to be in words, not only in the fill's colour.
  const barState = await page.textContent(".settings-screen__bar-state");
  if (barState !== "Normal") throw new Error(`the bar's state reads "${String(barState)}"`);
  const reserve = await page
    .locator(".settings-screen__hint", { hasText: "thread reserve" })
    .textContent();
  if (!/VIP\/sensitive thread reserve: \$\d+ \(10% of the cap\)/.test(reserve ?? "")) {
    throw new Error(`the reserve line reads "${String(reserve)}"`);
  }

  // ── General: migration 0009's quiet hours and threshold ───────────────────────────────────────
  await openTab(page, "General");
  const drawnQuiet = await Promise.all(
    ["Quiet hours start", "Quiet hours end"].map((name) =>
      page.getByLabel(name, { exact: true }).inputValue(),
    ),
  );
  if (drawnQuiet.join("–") !== `${before.quiet.start}–${before.quiet.end}`) {
    throw new Error(
      `quiet hours read ${drawnQuiet.join("–")}, expected ${before.quiet.start}–${before.quiet.end}`,
    );
  }
  const drawnThreshold = await page.inputValue("#settings-threshold");
  if (Number(drawnThreshold) !== before.threshold) {
    throw new Error(
      `the threshold reads "${drawnThreshold}", expected "${String(before.threshold)}"`,
    );
  }

  // ── Autonomy ──────────────────────────────────────────────────────────────────────────────────
  await openTab(page, "Autonomy");
  for (const account of before.accounts) {
    const drawn = await switchFor(page, account.channel).getAttribute("aria-checked");
    const wanted = before.rules.includes(account.channel);
    if (drawn !== String(wanted)) {
      throw new Error(
        `${account.name}'s switch is "${String(drawn)}", autonomy.rules says ${String(wanted)}`,
      );
    }
  }
  await assertAllowlist(page, before);

  if (!write) return;

  // Turning autonomy on has to be confirmed (A5 §3.9). The dialog is checked for its own words before
  // the confirm is clicked, because a warning that never appeared is the thing this asserts.
  const channelSwitch = switchFor(page, AUTONOMY_CHANNEL);
  await channelSwitch.click();
  const warning = page.getByRole("alertdialog");
  await warning.waitFor({ timeout: 10_000 });
  const question = await warning.locator(".settings-screen__dialog-question").textContent();
  if (question !== AUTONOMY_WARNING) {
    throw new Error(`the autonomy warning reads "${String(question)}"`);
  }
  await warning.getByRole("button", { name: "Confirm", exact: true }).click();
  await page.waitForSelector('.settings-screen__switch[aria-checked="true"]', { timeout: 10_000 });

  // The allowlist, typed the way a person types it: the text goes in, Enter adds it, the hub stores it
  // and the chip appears from the value that came back. GitHub repos go last so the notice the frame
  // carries is that write's.
  for (const entry of ALLOWLIST) {
    for (const item of entry.entries) {
      const input = page.getByLabel(entry.addLabel, { exact: true });
      await input.fill(item);
      await input.press("Enter");
      await page
        .locator(".settings-screen__chip", { hasText: item })
        .first()
        .waitFor({ timeout: 10_000 });
    }
  }
}

async function assertAllowlist(page: Page, expected: Seeded): Promise<void> {
  for (const entry of ALLOWLIST) {
    const drawn = await page
      .locator(".settings-screen__allowlist", {
        has: page.getByRole("heading", { name: entry.heading, exact: true }),
      })
      .locator(".settings-screen__chip-text")
      .allTextContents();
    const want = expected.allowlists[entry.kind] ?? [];
    if (drawn.join(",") !== want.join(",")) {
      throw new Error(
        `"${entry.heading}" draws ${JSON.stringify(drawn)}, the hub stored ${JSON.stringify(want)}`,
      );
    }
  }
}

/** The frame's own contents, each checked against the row it came from — the pass that wrote them
 *  also sees the save notice, because that is state the write left behind. */
async function verify(page: Page, after: Seeded, wrote: boolean): Promise<void> {
  if (!after.rules.includes(AUTONOMY_CHANNEL)) {
    throw new Error(
      `autonomy.rules holds ${JSON.stringify(after.rules)}, expected ${AUTONOMY_CHANNEL}`,
    );
  }
  if (after.rules.includes(UNTOUCHED_CHANNEL)) {
    throw new Error(`${UNTOUCHED_CHANNEL} was never switched on but is in autonomy.rules`);
  }
  const on = await switchFor(page, AUTONOMY_CHANNEL).getAttribute("aria-checked");
  if (on !== "true") throw new Error("the autonomy switch did not stay on");
  const off = await switchFor(page, UNTOUCHED_CHANNEL).getAttribute("aria-checked");
  if (off !== "false") throw new Error("a channel the fixture never touched came back on");

  await assertAllowlist(page, after);

  if (wrote) {
    const notice = await page.textContent(".settings-screen__notice");
    if (notice !== "GitHub repos saved.") {
      throw new Error(`the notice reads "${String(notice)}"`);
    }
  }

  // The kill switch stays on every section (A5 §3.9) and is asserted in its running state — the
  // stopped state is what the dialog below it is for, and this frame is of the settings, not of the
  // emergency.
  const kill = page.locator(".settings-screen__kill");
  if ((await kill.getAttribute("data-state")) !== "running") {
    throw new Error(
      "the kill switch is stopped — the seed should leave autonomous actions running",
    );
  }
  if ((await kill.getByRole("button").textContent()) !== "Stop all autonomous actions") {
    throw new Error("the kill switch is not offering the A5 §8 confirmation question");
  }
}

/** The vertical half of the frame's geometry, and the defect no horizontal reading can see.
 *
 *  `.settings-screen` is a scrolling column flex box, and `.settings-screen__panes` was `flex: 1 1
 *  auto; min-height: 0` inside it. `min-height: 0` is what lets a flex item shrink past its content:
 *  the panes' *box* shrank to the space left over, while the body inside them kept `min-height:
 *  auto` and its full content height, so the body spilled out of the panes and the Kill switch —
 *  later in the DOM, pinned to the foot by `margin-top: auto` — painted on top of it. Both frames of
 *  the previous attempt show it and neither overflow reading moves, because nothing got wider: at
 *  1440 the GitHub repos input hid under the panel, at 390 the MacBook folders block came through it.
 *
 *  So the two boxes are compared directly. `killTop` must not come before `bodyBottom`; when it does,
 *  the body's last pixels are painted over. Measured before the shutter, for the same reason the
 *  overflow reading is: a run that fails here should not leave a frame behind to be committed.
 *
 *  `page.evaluate` ships this source to the page, and `tsx`'s esbuild pass rewrites a nested arrow
 *  into `__name(arrow, ...)`, which does not exist there — so the body stays inline (see
 *  tools/e2e/overflow.ts, which hit exactly that). */
function measureKillOverlap(): { killTop: number; bodyBottom: number } | null {
  const kill = document.querySelector(".settings-screen__kill");
  const body = document.querySelector(".settings-screen__body");
  if (kill === null || body === null) return null;
  return {
    killTop: kill.getBoundingClientRect().top,
    bodyBottom: body.getBoundingClientRect().bottom,
  };
}

/** Throw when the kill section starts above the body's last pixel. The tolerance is for subpixel
 *  rounding only — a correct layout puts the two boxes a `gap` apart, never within half a pixel. */
function assertNoKillOverlap(
  where: string,
  report: { killTop: number; bodyBottom: number } | null,
): void {
  if (report === null) {
    throw new Error(`the settings body or kill section is missing at ${where}`);
  }
  if (report.killTop < report.bodyBottom - 0.5) {
    throw new Error(
      `the kill section covers the settings body at ${where}: it starts at y=${report.killTop.toFixed(1)} ` +
        `but the body ends at y=${report.bodyBottom.toFixed(1)}`,
    );
  }
}

/** One frame plus both geometry readings. */
async function shoot(page: Page, label: string): Promise<void> {
  await page.waitForTimeout(700);
  const overflow = await page.evaluate(measureOverflow);
  assertNoOverflow(`settings at ${label}px`, overflow);
  assertNoKillOverlap(`settings at ${label}px`, await page.evaluate(measureKillOverlap));
  console.log(`  settings-${label}.png — ${describeOverflow(overflow)}`);
  await page.screenshot({ path: join(OUT, `settings-${label}.png`) });
}

/** `docs/design/SKILLS.md`'s slop-test gate 11: a horizontal scrollbar at even one of 320/375/414/768
 *  fails the task. The two frames are 1440 and 390, so these four are measured without a frame — and
 *  every section, because the long allowlist chips and the sensitivity table are the two things most
 *  likely to push the page wider than the phone. The page is resized rather than reloaded: the shell's
 *  layout is container-query based, so a resize is what actually exercises it. */
const SWEEP_WIDTHS = [320, 375, 414, 768];

async function sweep(browser: Browser, pool: Pool): Promise<void> {
  const page = await browser.newPage({ viewport: { width: SWEEP_WIDTHS[0], height: 800 } });
  try {
    await openSettings(page, await readBack(pool), false);
    for (const width of SWEEP_WIDTHS) {
      await page.setViewportSize({ width, height: 800 });
      for (const label of ["Accounts", "Autonomy", "Model tiers", "General"]) {
        await openTab(page, label);
        const overflow = await page.evaluate(measureOverflow);
        // The overlap is section-dependent — the tallest body (Autonomy's allowlist) is the one that
        // spills out of a shrunken panes box — so every section is checked at every width, not just
        // the two the frames are of.
        assertNoKillOverlap(
          `settings / ${label} at ${String(width)}px`,
          await page.evaluate(measureKillOverlap),
        );
        assertNoOverflow(`settings / ${label} at ${String(width)}px`, overflow);
        console.log(`  ${String(width)}px ${label} — ${describeOverflow(overflow)}`);
      }
    }
  } finally {
    await page.close();
  }
}

async function pass(
  browser: Browser,
  label: string,
  size: { width: number; height: number },
  pool: Pool,
  write: boolean,
): Promise<void> {
  const page = await browser.newPage({ viewport: size });
  try {
    await openSettings(page, await readBack(pool), write);
    // Read back again now that the writes landed: the frame is asserted against the rows the hub
    // stored, not against the values the script intended to store.
    await verify(page, await readBack(pool), write);
    await shoot(page, label);
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
    const start = await readBack(pool);
    console.log(
      `settings seeded: ${start.accounts.map((a) => a.name).join(", ")} — cap $${String(start.capUsd)}, mtd $${String(start.mtdUsd)}`,
    );

    mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch();
    try {
      // 1440 makes the writes; 390 is a fresh load that re-reads them from the hub. Both assert every
      // section, so neither frame can be of a screen whose other tabs are unfinished.
      // 1440 makes the writes; 390 and the sweep are fresh loads that re-read them from the hub. Both
      // frames assert every section, so neither can be of a screen whose other tabs are unfinished.
      await pass(browser, "1440", { width: 1440, height: 900 }, pool, true);
      await pass(browser, "390", { width: 390, height: 844 }, pool, false);
      await sweep(browser, pool);
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
