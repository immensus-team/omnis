// loop-r1-04 evidence: the PWA's rows are rows again, a phone gets the phone shell, and the
// "system" channel wears the omnis mark instead of a second Settings gear.
//
// Run against a stack that is already up (this script boots none of its own — it is the same live
// app a person is looking at):
//   OMNIS_E2E_DB=omnis_test_loop_r1_e2e OMNIS_E2E_PORT_OFFSET=200 ZERO_SHARD_NUM=9 \
//     pnpm tsx tools/e2e/hold.ts --web
//   pnpm tsx tools/e2e/shots-loop-r1-04.ts   (desktop http://127.0.0.1:5373, PWA :5374)
//
// Why a script and not three committed PNGs: two of this story's three fixes are only visible in a
// medium a screenshot cannot be trusted for. The row width is a *number* — the before shot showed
// rows about 50px wide, and a picture of a broken row and a picture of a fixed one are both "a
// picture of a list". The viewport is the same: the meta tag's whole effect is on a layout number
// that exists before anything is painted (`documentElement.clientWidth`: 980 with no meta, 390 with
// one, on the same 390px device). And the third, the mark, is a picture — but the assertion behind
// it is that the rail's omnis tile is a PNG and Settings is still an SVG, which is what makes them
// two marks rather than one drawn twice (L-33). The screenshots are the evidence; the numbers are
// the proof.
//
// Three passes:
//   PWA 1440  no emulation: the row at the desktop width the second "before" shot used.
//   PWA 390   `devices["iPhone 13"]`, emulation on — the pass this story exists for. Emulation is
//             the point here, unlike loop-r1-03's 390 pass which turned it off: L-39 is about a
//             real phone, and `isMobile` is what makes Chromium use the meta viewport at all.
//   desktop   at 1440 for the rail mark, and at iPhone 13 for the same meta tag on the *other* app
//             (`apps/desktop/index.html` had no viewport either) — asserted on the layout width and
//             not on the picture, because the only wrong version of it is a number.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Page, chromium, devices, request } from "@playwright/test";
import { assertNoOverflow, describeOverflow, measureOverflow } from "./overflow.js";
import { REPO_ROOT } from "./stack.js";

const BASE = process.env.OMNIS_SHOTS_URL ?? "http://127.0.0.1:5373";
/** `hold.ts --web` starts the PWA one port above the desktop app (startWeb(VITE_PORT + 1)), so it
 *  is derived rather than hard-coded — the brief's :5373/:5374 are 5173/5174 plus the 200 offset. */
const PWA = process.env.OMNIS_SHOTS_PWA_URL ?? `http://127.0.0.1:${Number(new URL(BASE).port) + 1}`;
const OUT = join(REPO_ROOT, "docs/design/loop/r1/impl/loop-r1-04");

const WIDE = { width: 1440, height: 900 } as const;
/** `devices["iPhone 13"]` is 390x664 at DPR 3 with `isMobile` and `hasTouch`. The viewport is the
 *  brief's 390; the rest of the descriptor is what makes it a phone rather than a narrow window.
 *  The width is spelled out because it is the number both viewport assertions compare against, and
 *  `DeviceDescriptor.viewport` is nullable — a Playwright upgrade that moved the descriptor would
 *  otherwise silently compare against a fallback. */
const IPHONE = devices["iPhone 13"];
const IPHONE_WIDTH = 390;
if (IPHONE.viewport?.width !== IPHONE_WIDTH) {
  throw new Error(`devices["iPhone 13"] is ${IPHONE.viewport?.width}px wide, not ${IPHONE_WIDTH}`);
}

/** L-08/NC-06's floor, from the brief: a row that is a row, and a name that is a name. The before
 *  shot's rows were ~50px and its names one letter ("Seco" cut to "S"), so 340/120 are not tight
 *  numbers — they are the difference between a list and a column. */
const MIN_ROW = 340;
const MIN_NAME = 120;

/** SKILLS.md #11's four narrow widths. Rows that are wide enough at 390 can still push the shell
 *  past the window at 320, and the checklist fails the task at even one of the four — so the sweep
 *  is the cheap half of the same check the two measurements above are the point of. */
const SWEEP = [320, 375, 414, 768] as const;

/** One row, and the name inside it, in the page's own pixels. A string and not a function: tsx's
 *  esbuild transform names inner function expressions and injects a `__name` helper that does not
 *  exist in the page (overflow.ts's header carries the measurement). */
const ROW_PROBE = `(() => {
  const row = document.querySelector(".inbox-row");
  const name = document.querySelector(".inbox-row__name");
  return {
    rows: document.querySelectorAll(".inbox-row").length,
    width: row === null ? 0 : row.getBoundingClientRect().width,
    name: name === null ? 0 : name.getBoundingClientRect().width,
    nameText: name === null ? null : (name.textContent || "").trim(),
  };
})()`;

/** The rail's own marks. `system` is the UiChannel value that stays "system" in the database (see
 *  row-meta.ts) while its label and its glyph are omnis's — so the tile is found by its label and
 *  the assertions are on what is *inside* it. */
const RAIL_PROBE = `(() => {
  const tiles = Array.from(document.querySelectorAll(".channel-rail__tile"));
  const omnis = tiles.find((t) => t.getAttribute("aria-label") === "omnis");
  const settings = document.querySelector(".channel-rail__icon-button");
  const mark = omnis === null ? null : omnis.querySelector("img");
  return {
    labels: tiles.map((t) => t.getAttribute("aria-label")),
    // Before L-33 the tile held a react-icons <svg>; the fix is that it holds the brand PNG.
    omnisSvgs: omnis === null ? 0 : omnis.querySelectorAll("svg").length,
    markSrc: mark === null ? null : mark.getAttribute("src"),
    markVisible: mark === null ? null : mark.getBoundingClientRect().width,
    settingsSvgs: settings === null ? 0 : settings.querySelectorAll("svg").length,
  };
})()`;

interface Row {
  rows: number;
  width: number;
  name: number;
  nameText: string | null;
}

interface Rail {
  labels: (string | null)[];
  omnisSvgs: number;
  markSrc: string | null;
  markVisible: number | null;
  settingsSvgs: number;
}

async function open(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForSelector(".inbox-row", { timeout: 60_000 });
  // The rows arrive through Zero's sync, and their boxes move once as the composer/install card
  // settles — a width read on the first frame is a width mid-layout.
  await page.waitForTimeout(2000);
}

async function row(page: Page): Promise<Row> {
  return (await page.evaluate(ROW_PROBE)) as Row;
}

/** The brief's assertion, in one place so both PWA tiers make it the same way. */
function assertRowIsARow(where: string, measured: Row): void {
  if (measured.rows === 0) throw new Error(`${where}: the inbox drew no rows`);
  if (measured.width < MIN_ROW) {
    throw new Error(
      `${where}: the first .inbox-row is ${measured.width.toFixed(1)}px wide, under ${MIN_ROW} (L-08/NC-06)`,
    );
  }
  if (measured.name < MIN_NAME) {
    throw new Error(
      `${where}: .inbox-row__name is ${measured.name.toFixed(1)}px wide, under ${MIN_NAME} — the name is being cut to "${measured.nameText}" (L-08/NC-06)`,
    );
  }
  console.log(
    `  ${where}: the row is ${measured.width.toFixed(1)}px and the name ${measured.name.toFixed(1)}px ("${measured.nameText}")`,
  );
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  try {
    // ---- PWA 1440: the row at the desktop tier ---------------------------------------------------
    // No emulation, exactly as the existing shot tools do a "1440" pass. The second "before" shot
    // (test-newcomer/s8-pwa-first-1440.png) was taken this way and its rows are as broken as the
    // phone's, which is the reason this pass exists: the stale stylesheet was not a narrow-tier bug.
    console.log("PWA 1440 — the row");
    const wide = await browser.newPage({ viewport: WIDE });
    await open(wide, PWA);
    assertRowIsARow("1440", await row(wide));
    await wide.screenshot({ path: join(OUT, "1440.png") });

    // The mobile sweep. Rows are the widest thing in the list and the narrowest tier is 320, so a
    // row that fits at 390 and not at 320 is the same overflow the checklist names.
    for (const width of SWEEP) {
      await wide.setViewportSize({ width, height: 844 });
      await wide.waitForTimeout(400);
      const overflow = await wide.evaluate(measureOverflow);
      console.log(`  ${width}px: ${describeOverflow(overflow)}`);
      assertNoOverflow(`PWA ${width}`, overflow);
    }
    await wide.close();

    // ---- PWA 390: the phone ----------------------------------------------------------------------
    console.log("PWA 390 — iPhone 13, emulation on");
    const phone = await browser.newPage({ ...IPHONE });
    await open(phone, PWA);
    const phoneRow = await row(phone);
    assertRowIsARow("390 iPhone 13", phoneRow);
    // The layout width is the tick that says the meta viewport is in *this* document too: without
    // one, a mobile-emulated Chromium lays the page out at 980 and scales it, and the row below
    // would be measured in a 980px coordinate space.
    const phoneLayout = (await phone.evaluate("document.documentElement.clientWidth")) as number;
    if (phoneLayout !== IPHONE_WIDTH) {
      throw new Error(
        `the PWA lays out at ${phoneLayout}px on a ${IPHONE_WIDTH}px phone — no viewport meta`,
      );
    }
    console.log(`  the PWA's layout width is ${phoneLayout}px on a ${IPHONE_WIDTH}px device`);
    await phone.screenshot({ path: join(OUT, "390.png") });
    await phone.close();

    // ---- the installed icon, over HTTP -----------------------------------------------------------
    // L-21: iOS asks for this exact path when it adds the page to the home screen, and the manifest's
    // two PNGs are what every other installer reads. Fetched rather than checked for existence in
    // the repo: `public/` is served by Vite in dev and copied by the build, and a file the dev
    // server does not serve is a file no browser gets.
    console.log("PWA — the install icon set");
    const api = await request.newContext();
    try {
      for (const path of ["/apple-touch-icon.png", "/icon-192.png", "/icon-512.png"]) {
        const response = await api.get(`${PWA}${path}`);
        const type = response.headers()["content-type"] ?? "";
        if (response.status() !== 200 || !type.startsWith("image/png")) {
          throw new Error(`GET ${path} answered ${response.status()} ${type}, not 200 image/png`);
        }
        console.log(
          `  ${path}: ${response.status()} ${type} (${(await response.body()).length} bytes)`,
        );
      }
    } finally {
      await api.dispose();
    }

    // ---- desktop 1440: the omnis mark -----------------------------------------------------------------
    console.log("desktop 1440 — the rail mark");
    const desktop = await browser.newPage({ viewport: WIDE });
    await open(desktop, BASE);
    const rail = (await desktop.evaluate(RAIL_PROBE)) as Rail;
    if (!rail.labels.includes("omnis")) {
      throw new Error(`the rail has no "omnis" tile — its labels are ${rail.labels.join(", ")}`);
    }
    if (rail.labels.includes("System")) {
      throw new Error('the rail still shows a tile labelled "System" (L-33)');
    }
    if (rail.markSrc === null || !rail.markSrc.includes("system@")) {
      throw new Error(`the omnis tile's mark is ${rail.markSrc ?? "absent"}, not the brand PNG`);
    }
    // The whole of L-33: a gear identical to the Settings gear sat in this slot. Two marks that are
    // the same drawing is the bug, so the check is that they are no longer the same *kind* of thing.
    if (rail.omnisSvgs !== 0) {
      throw new Error(
        `the omnis tile still holds ${rail.omnisSvgs} inline SVG(s), so it is a glyph`,
      );
    }
    if (rail.settingsSvgs !== 1) {
      throw new Error(`the Settings control holds ${rail.settingsSvgs} glyphs, not the one gear`);
    }
    if (rail.markVisible !== 18) {
      throw new Error(`the rail draws the mark at ${rail.markVisible}px, not 18 (the tile's size)`);
    }
    console.log(
      `  the omnis tile is a PNG (${rail.markSrc?.split("/").pop()} at ${rail.markVisible}px); Settings is still an SVG`,
    );
    // The rail column, whole: the glass plate with the ten tiles at the top and the Settings gear at
    // its foot. Cropping to the tile alone would photograph the artwork without the thing it is
    // being distinguished from, which is the entire reason the mark changed.
    await desktop.locator(".channel-rail").screenshot({ path: join(OUT, "rail-1440.png") });
    await desktop.close();

    // ---- desktop 390: the same meta tag, in the other app -----------------------------------------
    // L-39 names `apps/desktop/index.html` specifically: the PWA already had the meta, the desktop
    // app did not, so a phone pointed at the LAN address got the 980px layout zoomed out. Asserted
    // on the layout width, because that number *is* the fix — the bottom bar and the <900 tier only
    // get their chance once the viewport stops lying about how wide the screen is.
    console.log("desktop 390 — iPhone 13");
    const narrow = await browser.newPage({ ...IPHONE });
    await open(narrow, BASE);
    const layout = (await narrow.evaluate("document.documentElement.clientWidth")) as number;
    if (layout !== IPHONE_WIDTH) {
      throw new Error(
        `apps/desktop lays out at ${layout}px on a ${IPHONE_WIDTH}px phone, not ${IPHONE_WIDTH} — no viewport meta (L-39)`,
      );
    }
    const bottomBar = narrow.locator(".bottom-bar");
    if ((await bottomBar.count()) !== 1 || !(await bottomBar.isVisible())) {
      throw new Error(
        "the desktop shell draws no BottomBar at 390, so the <900 tier is not applied",
      );
    }
    // Visible is not enough on its own — an element can be laid out inside a scaled 980px canvas and
    // answer `isVisible()`. The bar's own box is what proves it is inside the window it is in.
    const bar = await bottomBar.boundingBox();
    if (bar === null || bar.x < 0 || bar.x + bar.width > IPHONE_WIDTH + 1) {
      throw new Error(
        `the BottomBar spans ${bar === null ? "nothing" : `${bar.x}…${bar.x + bar.width}`} in a ${layout}px layout`,
      );
    }
    console.log(
      `  clientWidth ${layout}; the BottomBar is visible at ${bar.x.toFixed(0)}…${(bar.x + bar.width).toFixed(0)} inside it`,
    );
    await narrow.close();

    console.log("loop-r1-04 shots written to", OUT);
  } finally {
    await browser.close();
  }
}

await main();
