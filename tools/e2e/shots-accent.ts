// US-D06 §5.1's screenshot set: §5.1's four screens (inbox, ask panel, onboarding, the agents
// filter) plus the ⌘K command list, at 1440x900 and 390x844, into docs/design/screens/accent/,
// with the two 1440 shots refreshed in place at docs/design/screens/ (§5.1's screens 1 and 2).
//
// Three passes, in this order, because they disagree about the seed:
//   1. 1440x900, the pristine seed — where every screen in §5.1 is reachable at once.
//   2. the dark and reduced-transparency repeats of screens 1 and 2 — also the pristine seed,
//      since they have to be pass 1's frames in another theme and not merely another layout.
//   3. 390x844 — the pass that spends the seed's approval to get the sheet out of the way
//      (clearQueue). It runs last so passes 1 and 2 never see that.
// The two sizes cannot share a pass: at 390 the shell is one column and the detail pane is a fixed
// sheet over the list, so a state built at 1440 and then narrowed is a picture of the sheet,
// whatever the frame is named (see narrowPass).
//
// Why its own script rather than another branch in shots.ts: that one shoots the *density* fixture
// (densify() adds approvals and all four agent-session states), and these frames have to be the
// plain e2e seed — the same fixture the pre-D6 `inbox-kinso.png` came from, so the two can be put
// side by side and only the surfaces differ. It also keeps `pnpm e2e:shots` from rewriting twelve
// files nobody asked it to.
//
// §5.1 says capture with chrome-devtools-mcp and repeat shots 1 and 2 with data-theme="dark" and
// prefers-reduced-transparency. Playwright is the repo's own capture path (shots.ts, shots-
// responsive.ts, shots-motion.ts all use it) and the only one that runs headless in this task, so
// the screens are shot with it; the dark and reduced-transparency repeats of 1 and 2 are here too,
// since §5.1 asks for them by name, as is §5.2's rail-zoom.png (the rail at 4x).
//
// Run: pnpm tsx tools/e2e/shots-accent.ts   (same ports as the e2e smoke — never run both at once)
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Browser, type Page, chromium } from "@playwright/test";
import { Pool } from "../../packages/db/src/index.js";
import { describeOverflow, measureOverflow } from "./overflow.js";
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

const SCREENS = join(REPO_ROOT, "docs/design/screens");
const OUT = join(SCREENS, "accent");
/** §5.1: desktop captures at 1440x900; the narrow pass at 390x844. */
interface Size {
  label: string;
  width: number;
  height: number;
}
const DESKTOP: Size = { label: "1440", width: 1440, height: 900 };
const NARROW: Size = { label: "390", width: 390, height: 844 };

/** Park the pointer on the rail and settle. The row-hover-card follows the pointer and would
 *  otherwise sit in the frame — shots.ts parks the pointer for the same reason. The rail is the
 *  bottom-left corner in both shells (a column at 1440, the fixed bottom bar at 390) and is never
 *  over a list row at either size, so the park is read off the live viewport rather than the 900px
 *  one the wide frames happen to use — at 390 a hard-coded y=898 is off-canvas and hovers nothing. */
async function settle(page: Page): Promise<void> {
  const size = page.viewportSize();
  await page.mouse.move(2, size === null ? 898 : size.height - 6);
  await page.waitForTimeout(600);
}

/** Wait until B3's summaries have landed in the client, and return the settled row text.
 *
 *  Two earlier versions of this wait were wrong the same way, and the replacement is a predicate
 *  rather than a duration because of it. The symptom: the light capture of screen 1 showed four rows
 *  with no second line, and its dark repeat four minutes later showed all of them filled — so the two
 *  frames §5.1 asks to be "the same screens in another theme" were not the same screen. A fixed sleep
 *  failed (six seconds is not a signal) and so did a settle detector: three identical samples prove
 *  the text stopped changing, and it *had* stopped changing. It was stable and wrong.
 *
 *  The cause is B3, not the list. packages/agents/src/summarize.ts writes threads.meta.summary, and
 *  apps/hub/src/summarize-job.ts debounces it 30 seconds behind each new inbound item. Before it
 *  lands, Inbox.tsx's threadSummary falls back to the subject or the body's first line and *drops*
 *  the candidate when it is the row's own title, so the row collapses to one line — which is exactly
 *  the four rows the light frame was missing. "No row is showing an empty second line" is false
 *  before B3 and true after, and this seed's post-B3 state satisfies it for all eight rows.
 *
 *  A state, not a settle — which is the point: no list that has merely not finished arriving can
 *  satisfy it early, so neither earlier failure mode is reachable. The database would be the other
 *  place to ask, but the question is what the *client* shows; the rows come through Zero, so the DOM
 *  is the truth here. */
async function waitForSummaries(page: Page): Promise<string> {
  // A string, not a function: page.evaluate ships the function's *source* to the page, and tsx's
  // esbuild pass has `keepNames` on, which rewrites a function expression into `__name(...)` — a
  // helper that does not exist in the page (overflow.ts's header records the trap).
  // Scoped to the rows, and a missing summary element counts as unsummarised: counting the summary
  // spans on their own would pass vacuously on a frame where they had not rendered yet.
  const probe = `JSON.stringify({
    rows: Array.from(document.querySelectorAll(".inbox-row")).map((r) => r.textContent),
    unsummarised: Array.from(document.querySelectorAll(".inbox-row")).filter((r) => {
      const s = r.querySelector(".inbox-row__summary");
      return s === null || (s.textContent ?? "") === "";
    }).length,
  })`;
  const started = Date.now();
  while (Date.now() - started < 180_000) {
    const raw = (await page.evaluate(probe)) as string;
    const state = JSON.parse(raw) as { rows: string[]; unsummarised: number };
    if (state.rows.length > 0 && state.unsummarised === 0) return JSON.stringify(state.rows);
    await page.waitForTimeout(500);
  }
  throw new Error("a row still has no summary line — B3 has not written threads.meta.summary");
}

/** djb2 over the settled row text, so the log can show that a light frame and its dark repeat carry
 *  the same content — the check that caught the unsettled captures in the first place. */
function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

/** One screen, at one size, into `accent/<name>-<label>.png`. `also` is the pre-D6 file at
 *  docs/design/screens/ that the same frame replaces at 1440. */
async function shoot(page: Page, name: string, label: string, also?: string): Promise<void> {
  const file = join(OUT, `${name}-${label}.png`);
  await page.screenshot({ path: file });
  if (also !== undefined && label === "1440") await page.screenshot({ path: join(SCREENS, also) });
  // §5.1's mobile gate is "no horizontal scroll", which is reading 1. The element scan (`worst`) is
  // logged rather than asserted here for the same reason tools/e2e/aurora.spec.ts asserts it only
  // for this story's own boxes: at 390 the row-hover-card can stay open past a programmatic pointer
  // move and would fail a frame that is otherwise correct.
  const overflow = await page.evaluate(measureOverflow);
  if (overflow.diff > 0) {
    throw new Error(
      `the page scrolls sideways at ${name} ${label}px: ${describeOverflow(overflow)}`,
    );
  }
  console.log(`  ${name}-${label}.png — ${describeOverflow(overflow)}`);
}

/** 1) the inbox, nothing selected: the rail's mist aurora behind glass over a monotone list. */
async function inbox(page: Page, label: string): Promise<void> {
  await page.goto(`http://127.0.0.1:${String(VITE_PORT)}/`);
  await page.waitForSelector(".inbox-row", { timeout: 60_000 });
  const rows = await waitForSummaries(page);
  await settle(page);
  await shoot(page, "inbox-kinso", label, "inbox-kinso.png");
  console.log(`  rows ${label}: ${hash(rows)}`);
}

/** 2) a thread selected and the ask panel open (dawn) — the surface the orb and the stroke live on. */
async function openAskPanel(page: Page): Promise<void> {
  await page.locator(".inbox-row").first().click();
  await page.waitForTimeout(800);
  await page.locator(".ask-bar input").click();
  await page.waitForSelector(".ask-panel", { timeout: 10_000 });
  await page.waitForTimeout(900);
  await page.locator(".ask-bar input").focus();
  await settle(page);
}

/** 3) the same panel opened from the keyboard (⌘K) and switched to its Commands tab — what the
 *  pre-D6 `ai-panel-commands.png` showed. Without the tab click this is frame-for-frame screen 2:
 *  the panel derives its default tab from the input, and an empty input means Suggestions either
 *  way, so ⌘K alone lands on exactly the state the shot above already captured. */
async function openPalette(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await page.keyboard.press("Meta+k");
  await page.waitForSelector(".ask-panel", { timeout: 10_000 });
  await page.getByRole("button", { name: "Commands" }).click();
  await page.waitForTimeout(900);
  await settle(page);
}

/** 4) §5.1's agents filter — the agent rows and the graphite agent glyph. The tile is the rail's
 *  own `agent` button (channel-rail.tsx: the fixed tile appended to `tiles`), not the chip bar's
 *  `agents` radio: §5.1 says "in the rail". The wait is the chip the pick puts in the chip bar, not
 *  the tile's own `aria-pressed`: at 390 it is the popover that closes on the pick (see
 *  narrowPass), so the chip is the one marker both shells keep. */
async function openAgents(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Agent" }).click();
  await page.locator(".filter-chip", { hasText: "Agent" }).waitFor({ timeout: 10_000 });
  await page.waitForTimeout(900);
  await settle(page);
}

/** 5) onboarding: the void aurora, full bleed, the words on a scrim card. */
async function onboarding(page: Page, size: Size): Promise<void> {
  await page.setViewportSize({ width: size.width, height: size.height });
  await page.goto(`http://127.0.0.1:${String(VITE_PORT)}/?screen=onboarding`);
  await page.waitForSelector(".onboarding__card", { timeout: 30_000 });
  await page.waitForTimeout(700);
  await settle(page);
  await shoot(page, "onboarding", size.label);
}

/** Clears the seed's one pending approval, which is what makes the narrow frames possible at all.
 *
 *  `App.tsx` renders the detail pane whenever a thread is open *or* an approval is pending (`const
 *  detail = open !== null || approvals.length > 0`), and the seed proposes one, so at 390 the pane
 *  is the fixed full-width sheet from app.css's ≤1279.98 container rather than a third column: it
 *  covers the list, the ask bar and the bottom bar, and every one of §5.1's 390 frames is that
 *  sheet. Ignore is the decision that empties the queue without sending anything.
 *
 *  The narrow frames are therefore shot with the queue cleared and nothing selected, which is the
 *  only 390 state in which the ask panel exists: the sheet sits at z-index 20 and the ask panel at
 *  5, and the ask bar is under the sheet too, so a thread selected and the ask panel visible are
 *  mutually exclusive below 900px. The 1440 pass, where all four screens are reachable at once, is
 *  the one §5.1's "a thread selected" is shot from. */
async function clearQueue(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Ignore" }).click();
  await page.locator('[data-testid="detail-pane"]').waitFor({ state: "detached", timeout: 15_000 });
}

/** §5.1's four screens at 390×844 — each state built *after* the resize, not carried over from a
 *  1440 page.
 *
 *  The difference matters and is the whole reason this is a separate pass. Resizing a page whose
 *  state was built at 1440 changes which element owns the screen: the shell drops to one column,
 *  the rail folds into the bottom bar and the detail pane stops being a column and becomes a fixed
 *  sheet over everything — so a capture that resizes last is a picture of the sheet, whatever it
 *  was named for. Every state below is therefore opened at 390 and waited on by its own selector
 *  (`.ask-panel`, the cmdk list, the pressed rail tile), not by a fixed sleep: a sleep long enough
 *  for the entrance spring is also long enough to look settled while the state never arrived. */
async function narrowPass(browser: Browser): Promise<void> {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await page.goto(`http://127.0.0.1:${String(VITE_PORT)}/`);
    await page.waitForSelector(".inbox-row", { timeout: 60_000 });
    const rows = await waitForSummaries(page);

    // Screen 1 — the list, nothing selected.
    await clearQueue(page);
    await settle(page);
    await shoot(page, "inbox-kinso", "390");
    console.log(`  rows 390: ${hash(rows)}`);

    // Screen 2 — the ask panel, opened at 390. Same wait as `openAskPanel`, minus the thread
    // selection, which the sheet makes impossible here (see clearQueue).
    await page.locator(".ask-bar input").click();
    await page.waitForSelector(".ask-panel", { timeout: 10_000 });
    await settle(page);
    await shoot(page, "ai-panel", "390");

    // The ⌘K command list. Escape closes the ask panel first — ⌘K toggles, so pressing it over an
    // open panel would close it — and the shot waits for the cmdk list itself, not just the panel:
    // the panel's default tab is derived from the input, and an empty input lands on Suggestions,
    // which is frame-for-frame screen 2 (openPalette's note).
    await page.keyboard.press("Escape");
    await page.waitForSelector(".ask-panel", { state: "hidden", timeout: 10_000 });
    await page.keyboard.press("Meta+k");
    await page.waitForSelector(".ask-panel", { timeout: 10_000 });
    await page.getByRole("button", { name: "Commands" }).click();
    await page.waitForSelector(".ask-panel [cmdk-list]", { timeout: 10_000 });
    await settle(page);
    await shoot(page, "palette", "390");

    // Screen 4 — the rail's Agents tile. In the narrow shell that tile is not in the bar: the bar
    // holds four tiles and the agent tile is the fifth, so it is the one that overflows into the
    // rail's More popover (channel-rail.tsx's NARROW_RAIL_TILE_LIMIT). Opening the popover and
    // picking it is still §5.1's "selected in the rail" — the popover is the rail's own overflow,
    // and no other control in the narrow shell selects the agent channel.
    //
    // What to wait on is not the tile's `aria-pressed`: picking closes the popover, so that button
    // is gone by the time the state settles. It is the chip the pick leaves behind — `Channel:
    // Agent` in the chip bar, the same marker the 1440 frame shows next to the pressed tile.
    await page.keyboard.press("Escape");
    await page.waitForSelector(".ask-panel", { state: "hidden", timeout: 10_000 });
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("button", { name: "Agent" }).click();
    await page.locator(".filter-chip", { hasText: "Agent" }).waitFor({ timeout: 10_000 });
    await settle(page);
    await shoot(page, "agents-filter", "390");

    // Screen 3 — a full mount, so it is its own navigation rather than a shell state.
    await onboarding(page, NARROW);
  } finally {
    await page.close();
  }
}

/** §5.2's "zoom the rail plate corners at 400%" — the one check that sees whether §2.3's
 *  `calc(-2 * var(--aurora-blur))` bleed is doing its job, i.e. whether a blurred rectangle edge is
 *  visible where the texture is clipped. A 4x device scale factor over a 130x520 crop of the rail is
 *  that zoom; the rail is invisible at 1x in a 1440px frame. */
async function railZoom(browser: Browser): Promise<void> {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 4,
  });
  await page.goto(`http://127.0.0.1:${String(VITE_PORT)}/`);
  await page.waitForSelector(".inbox-row", { timeout: 60_000 });
  await page.waitForTimeout(2500);
  await settle(page);
  await page.screenshot({
    path: join(OUT, "rail-zoom.png"),
    clip: { x: 0, y: 0, width: 130, height: 520 },
  });
  console.log("  rail-zoom.png — the rail at 4x");
  await page.close();
}

/** §5.1: "repeat 1 and 2 with data-theme=dark" and "also capture 1 and 2 at 1440 with
 *  prefers-reduced-transparency: reduce". One page each, because both are emulated at the page. */
async function themed(browser: Browser, theme: string, transparency: string | null): Promise<void> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  if (transparency !== null) {
    // `prefers-reduced-transparency` is not one of emulateMedia's fields, so it goes through CDP.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-transparency", value: transparency }],
    });
  }
  await page.goto(`http://127.0.0.1:${String(VITE_PORT)}/`);
  await page.waitForSelector(".inbox-row", { timeout: 60_000 });
  // Same wait as inbox(): these two are §5.1's repeats of screens 1 and 2, so they have to be the
  // same content in another theme, not merely the same layout. The logged hash is how that is
  // checked rather than assumed — it has to match the light pass's for the same screen, and it is
  // what caught the pre-B3 captures in the first place.
  const rows = await waitForSummaries(page);
  // A string, not a function: `page.evaluate(fn)` ships the function's *source* to the page, and
  // tsx's esbuild pass has `keepNames` on, which rewrites a function expression into
  // `__name(...)` — a helper that does not exist in the page (overflow.ts's header records it).
  await page.evaluate(`document.documentElement.setAttribute("data-theme", "${theme}")`);
  await settle(page);
  const suffix = transparency === null ? "dark" : "reduced-transparency";
  await shoot(page, "inbox-kinso", suffix);
  console.log(`  rows ${suffix}: ${hash(rows)}`);
  await page.locator(".ask-bar input").click();
  await page.waitForSelector(".ask-panel", { timeout: 10_000 });
  await page.waitForTimeout(900);
  await settle(page);
  await shoot(page, "ai-panel", suffix);
  await page.close();
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
  const seeded = await seed(pool, env);
  try {
    mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch();

    // Pass 1 — §5.1's four screens and the ⌘K list at 1440×900, against the pristine seed. Screens
    // 1 and 2 also refresh the two pre-D6 files at docs/design/screens/, so they sit next to their
    // predecessors and only the surfaces differ.
    console.log(`${DESKTOP.label}x${String(DESKTOP.height)}:`);
    const wide = await browser.newPage({
      viewport: { width: DESKTOP.width, height: DESKTOP.height },
    });
    await inbox(wide, DESKTOP.label);
    await openAskPanel(wide);
    await shoot(wide, "ai-panel", DESKTOP.label, "ai-panel.png");
    await openPalette(wide);
    await shoot(wide, "palette", DESKTOP.label);
    await openAgents(wide);
    await shoot(wide, "agents-filter", DESKTOP.label);
    await onboarding(wide, DESKTOP);
    await wide.close();

    await railZoom(browser);

    // Pass 2 — §5.1's dark and reduced-transparency repeats of screens 1 and 2, one page each. This
    // has to run before pass 3 and not after: the repeats have to be pass 1's frames in another
    // theme, and pass 3 spends the seed's approval on frames of its own.
    console.log("dark:");
    await themed(browser, "dark", null);
    console.log("prefers-reduced-transparency: reduce:");
    await themed(browser, "light", "reduce");

    // Pass 3 — the same screens at 390×844, last because it is the pass that mutates the seed.
    console.log(`${NARROW.label}x${String(NARROW.height)}:`);
    await narrowPass(browser);

    await browser.close();
    console.log(`\nshots written to ${OUT}`);
  } finally {
    seeded.closeBridge?.();
    await pool.end();
    await stopAll();
  }
}

await main();
