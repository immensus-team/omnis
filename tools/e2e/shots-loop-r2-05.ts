// loop-r2-05 evidence: the boot and the connection banner, against the live stack rather than a
// mock. Every claim in the story is a claim about *what is on screen while something is broken* —
// blank white for five seconds, a banner that never appears, rows that never arrive — and a mock
// cannot be broken in the way that matters. Nothing here stops a process: the failures are staged
// inside the browser (a delayed response, an aborted request, a held socket, `setOffline`), so the
// stack keeps running for whoever looks at these screenshots next.
//
// Run against a stack that is already up (this script boots none of its own):
//   OMNIS_E2E_DB=omnis_test_loop_r2_impl OMNIS_E2E_PORT_OFFSET=500 ZERO_SHARD_NUM=12 \
//     pnpm tsx tools/e2e/hold.ts --web
//   pnpm tsx tools/e2e/shots-loop-r2-05.ts   (desktop http://127.0.0.1:5673)
//
// Five checks, in the order a person hits them:
//   1. The token is delayed 5s at 1440: eight skeleton rows are on screen within 1s of
//      domcontentloaded, under `aria-busy`, with a spoken "Loading omnis…" — the blank page's
//      replacement. The boot is then waited out, and the state it lands in (no token, deadline
//      passed) is the banner's: "Can't reach omnis", and no "Updated …" claim under it.
//   2. With the hub aborted and the Zero socket held, a reload still draws the app: the banner
//      within 8s, the subline free of "Updated". "Retry now" is pressed here, because the branch it
//      takes depends on what Zero reports.
//   3. A warm page whose socket is then closed — the state a person is in when the hub dies
//      mid-session. The rows stay, the subline drops its freshness claim, and this is 1440.png.
//   4. The healthy stack, where `setOffline(true)` is the only way to say "you're offline" — the
//      banner is the app's answer, and it goes away when the browser comes back.
//   5. The banner's geometry at 1440, 390 and 320: SKILLS.md #11, no horizontal scroll.
//
// The skeleton-row height is measured against a real row's in the same pass, because "the list does
// not jump" is arithmetic in app.css (22.5px + 4px + 21px + 24px of padding) and this is the check
// that keeps it honest rather than merely plausible.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type BrowserContext, type Page, type WebSocketRoute, chromium } from "@playwright/test";
import { assertNoOverflow, describeOverflow, measureOverflow } from "./overflow.js";
import { REPO_ROOT } from "./stack.js";

const BASE = process.env.OMNIS_SHOTS_URL ?? "http://127.0.0.1:5673";
const OUT = join(REPO_ROOT, "docs/design/loop/r2/impl/loop-r2-05");

/** Every request the app makes *to the hub*, which in dev is a request to the app's own origin:
 *  the hub sends no CORS headers, so `apps/desktop/vite.config.ts` proxies the whole list of routes
 *  the app may call and the client uses relative paths. This list is that proxy table's.
 *
 *  Which is why a path glob is not good enough, and how this script first failed twice. `**\/api/**`
 *  also matches `http://127.0.0.1:5673/src/api/approvals.ts` — the application's own source — and
 *  aborting that leaves an empty `#root` and a console full of `net::ERR_FAILED`. Testing the origin
 *  instead catches nothing at all, because the token is proxied and never leaves it. The route
 *  prefixes are the discriminator; Vite's module graph is all under `/src/`, which is none of them. */
const APP_ORIGIN = new URL(BASE).origin;
const HUB_ROUTES = [
  "/api",
  "/approvals",
  "/health",
  "/kill-switch",
  "/search",
  "/settings",
  "/cost",
  "/notes",
  "/items",
  "/digests",
  "/tasks",
];
function isHubCall(url: URL): boolean {
  // Cross-origin is the hub too, for a stack that is not being proxied (a production build, or a
  // dev server whose OMNIS_HUB_HTTP_URL is absolute). Both shapes have to be caught.
  if (url.origin !== APP_ORIGIN) return true;
  return HUB_ROUTES.some((prefix) => url.pathname.startsWith(prefix));
}

const WIDE = { width: 1440, height: 900 } as const;
/** The brief's 390x844, without `isMobile` — the same way the other shot tools take a narrow pass. */
const PHONE = { width: 390, height: 844 } as const;
const SKILLS_NARROW = 320;

/** The copy this script asserts on, spelled once so a reworded banner fails the check instead of
 *  quietly passing it. Quoted from the brief. */
const OFFLINE = "You're offline";
const UNREACHABLE = "Can't reach omnis";
const LOADING = "Loading omnis…";

/** How long the boot is held open for check 1. The app's own deadline is 4s (`TOKEN_DEADLINE_MS`),
 *  so 5s is deliberately past it: the delay is long enough to see the skeleton and long enough that
 *  what comes after it is the "no token was ever issued" state rather than a slow success. */
const TOKEN_DELAY_MS = 5_000;

/** The boot's root, which the real tree replaces. `boot-skeleton__title` is the boot's alone. */
const BOOT = ".boot-skeleton__title";
const SKELETON_ROW = ".inbox-row--skeleton";
const REAL_ROW = ".inbox-row:not(.inbox-row--skeleton)";
const BANNER = ".connection-banner";
const BANNER_TEXT = ".connection-banner__text";
const SUBLINE = ".inbox-card__subline";

/** Poll a read until it says what it was supposed to. The app writes to the DOM in frames and reads
 *  through a replica, so a one-shot read after an action is a race dressed as a check. */
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

/** What the banner is saying, or null when there is none. Read as two pieces — the sentence and
 *  whether it carries a button — so "the line is right" and "the action is offered" are two
 *  assertions rather than one string that could pass on a reworded sentence. */
async function readBanner(page: Page): Promise<{ text: string; action: string | null } | null> {
  const banner = page.locator(BANNER).first();
  if ((await banner.count()) === 0) return null;
  const text = await banner.locator(BANNER_TEXT).textContent();
  const button = banner.locator(".connection-banner__action");
  return {
    text: (text ?? "").trim(),
    action: (await button.count()) === 0 ? null : ((await button.textContent()) ?? "").trim(),
  };
}

/** Wait for a banner whose sentence contains `says`, and hand it back. */
async function waitForBanner(
  page: Page,
  says: string,
  timeout: number,
): Promise<{ text: string; action: string | null }> {
  return poll(
    () => readBanner(page),
    (banner) => banner?.text.includes(says) ?? false,
    `the banner to read "${says}"`,
    timeout,
  ).then((banner) => {
    if (banner === null) throw new Error(`no banner for "${says}"`);
    return banner;
  });
}

/** The subline's own text, which is where the false freshness claim lived: with the hub down the
 *  Inbox used to say "Updated now" beside a socket that had not carried anything for minutes.
 *
 *  An absent line reads as the empty string rather than waiting for an element that is not coming —
 *  Inbox.tsx draws the `<p>` only when it has something to say, so no line at all is also no claim,
 *  and it is the state a page that has never synced is in. */
async function subline(page: Page): Promise<string> {
  const line = page.locator(SUBLINE).first();
  if ((await line.count()) === 0) return "";
  return ((await line.textContent()) ?? "").trim();
}

/** The first row's height, whichever kind of row it is. `boundingBox` on the element rather than
 *  `getBoundingClientRect` in the page, so a row that is not laid out reads as null and fails
 *  loudly instead of measuring 0. */
async function rowHeight(page: Page, selector: string): Promise<number> {
  const box = await page.locator(selector).first().boundingBox();
  if (box === null) throw new Error(`no ${selector} on screen to measure`);
  return Math.round(box.height * 10) / 10;
}

/** The banner's dot against the rule the brief says it must borrow from: the dot's `background` is
 *  that rule's `color` (`oklch(from var(--warn-500) 0.44 c h)` in both), so "no new colour enters
 *  the palette" is a claim two computed styles can answer.
 *
 *  The pill is a probe appended and removed rather than looked for on screen: no screen is
 *  guaranteed to be showing one, and the claim is about the two declarations, not about a view.
 *
 *  No nested functions in the evaluated body — it ships to the page as source, and tsx's `keepNames`
 *  would land a `__name(...)` call where `__name` does not exist (see overflow.ts). */
async function dotColours(page: Page): Promise<{ dot: string; warning: string }> {
  return page.evaluate(() => {
    const probe = document.createElement("span");
    probe.className = "status-pill";
    probe.setAttribute("data-tone", "warning");
    document.body.appendChild(probe);
    const warning = getComputedStyle(probe).color;
    probe.remove();
    const dot = document.querySelector(".connection-banner__dot");
    return { dot: dot === null ? "" : getComputedStyle(dot).backgroundColor, warning: warning };
  });
}

/** One width, measured with the banner on screen. `assertNoOverflow` is the repo's guard and is
 *  stricter than the brief's clause — it also fails on an element laid out past the edge inside a
 *  box that clips it — while `scrollWidth <= innerWidth` is the brief's own reading, asserted
 *  beside it so a reworded guard cannot quietly drop the clause that was asked for. */
async function checkWidth(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 844 });
  await page.waitForTimeout(400);
  const banner = await readBanner(page);
  if (banner === null) {
    throw new Error(`no banner is on screen at ${width}px — the measurement would be of nothing`);
  }
  const scrolling = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  const report = await page.evaluate(measureOverflow);
  console.log(`  ${width}px with the banner: ${describeOverflow(report)}`);
  if (scrolling.scrollWidth > scrolling.innerWidth) {
    throw new Error(
      `horizontal scroll at ${width}: documentElement.scrollWidth is ` +
        `${scrolling.scrollWidth} against an innerWidth of ${scrolling.innerWidth}`,
    );
  }
  assertNoOverflow(`${width}px with the banner (${banner.text})`, report);
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  try {
    // ---- 1. The delayed token: the skeleton, then the state the boot lands in --------------------
    console.log("Delayed token — the boot skeleton at 1440");
    const boot: BrowserContext = await browser.newContext({ viewport: WIDE });
    const bootPage = await boot.newPage();
    await bootPage.route("**/api/zero-token", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, TOKEN_DELAY_MS));
      await route.continue();
    });

    await bootPage.goto(BASE, { waitUntil: "domcontentloaded" });
    // The deadline is 1s from domcontentloaded, and the skeleton is there *at* domcontentloaded
    // (main.tsx renders it before the token fetch is even started), so this is a check that the
    // first paint is not the white page — not a check that eight rows appear quickly.
    const seen = await poll(
      async () => ({
        rows: await bootPage.locator(SKELETON_ROW).count(),
        busy: await bootPage.locator(".app-shell").first().getAttribute("aria-busy"),
        spoken: (
          (await bootPage.locator(".app-shell > .visually-hidden").textContent()) ?? ""
        ).trim(),
      }),
      (state) => state.rows >= 8,
      "eight skeleton rows inside the first second of the document",
      1_000,
    );
    if (seen.busy !== "true") {
      throw new Error(`the boot shell is not aria-busy (read ${JSON.stringify(seen.busy)})`);
    }
    if (seen.spoken !== LOADING) {
      throw new Error(`the boot's spoken line reads ${JSON.stringify(seen.spoken)}`);
    }
    const skeletonHeight = await rowHeight(bootPage, SKELETON_ROW);
    console.log(
      `  ${seen.rows} skeleton rows within 1s of domcontentloaded, aria-busy="true", ` +
        `spoken "${seen.spoken}", row height ${skeletonHeight}px`,
    );

    // 390 during the same delay. A reload rather than a resize, so the skeleton is drawn at this
    // width rather than reflowed into it, which is what a phone actually gets.
    await bootPage.setViewportSize(PHONE);
    await bootPage.reload({ waitUntil: "domcontentloaded" });
    await poll(
      () => bootPage.locator(SKELETON_ROW).count(),
      (rows) => rows >= 8,
      "the boot skeleton at 390",
      1_000,
    );
    await bootPage.screenshot({ path: join(OUT, "390.png") });
    console.log("  wrote 390.png (the boot skeleton, token still delayed)");

    // The boot is replaced when the deadline fires — 4s after the token fetch started — and with no
    // token there is nothing for Zero to sync with. That is the banner's state, and it is the half
    // of check 1 the skeleton cannot show.
    await poll(
      () => bootPage.locator(BOOT).count(),
      (count) => count === 0,
      "the real tree to replace the boot skeleton",
      15_000,
    );
    const landed = await waitForBanner(bootPage, UNREACHABLE, 8_000);
    console.log(`  the boot landed on the banner: "${landed.text}"`);

    // ---- 2a. Reload with the hub gone and no token -------------------------------------------------
    // The brief's scenario, and the one that reaches the `unreachable` copy: the token fetch is the
    // hub call that decides whether Zero can sync at all, so a document that never got one knows it
    // is unreachable before it has even tried the socket.
    console.log("Hub gone — a reload with no token and no socket");
    const down: BrowserContext = await browser.newContext({ viewport: WIDE });
    const downPage = await down.newPage();
    // In-browser only: the stack's processes are untouched, and the failure is staged per-request.
    await downPage.route(isHubCall, (route) => route.abort());
    // A held socket is one the mock never hands to the server and never answers: Zero's WebSocket
    // opens and then says nothing, so nothing about this page's failure is the network's fault.
    await downPage.routeWebSocket(/:5348/, () => {});

    await downPage.goto(BASE, { waitUntil: "domcontentloaded" });
    const downBanner = await waitForBanner(downPage, UNREACHABLE, 8_000);
    const downSubline = await subline(downPage);
    if (downSubline.includes("Updated")) {
      throw new Error(`the subline still claims freshness with the hub down: ${downSubline}`);
    }
    console.log(
      `  banner within 8s: "${downBanner.text}" · action ${JSON.stringify(downBanner.action)}`,
    );
    console.log(`  subline: ${JSON.stringify(downSubline)} — no "Updated" claim`);

    // Nothing may steal the focus on arrival: the banner is a status line, not a prompt.
    const focused = await downPage.evaluate(() => document.activeElement?.className ?? null);
    if (focused?.includes("connection-banner")) {
      throw new Error("the banner took the focus on load");
    }

    // "Retry now" is the one interactive element on the banner, and which of its two branches it
    // takes depends on what Zero reports — `connect()` from `error`/`needs-auth`, a reload from
    // everything else, including this state where no token exists to reconnect with. The flag is
    // how a reload is told from a re-render without guessing at an animation: a fresh document has
    // no `window.__probe`.
    await downPage.evaluate(() => {
      (window as unknown as { __probe?: number }).__probe = 1;
    });
    const retry = downPage.getByRole("button", { name: downBanner.action ?? "Retry now" });
    await retry.click();
    await poll(
      () => downPage.evaluate(() => (window as unknown as { __probe?: number }).__probe ?? null),
      (probe) => probe === null,
      "Retry now to reload the document (the no-token branch)",
      10_000,
    );
    await waitForBanner(downPage, UNREACHABLE, 15_000);
    console.log("  Retry now reloaded the document, which came back to the same banner");
    await down.close();

    // ---- 2b. A warm page whose socket is taken away: the shot --------------------------------------
    // This is where 1440.png comes from, and the reason is a measurement rather than a preference.
    //
    // The brief describes the shot as "Can't reach omnis" over synced rows. That state does not
    // exist in this app: `unreachable` needs no token (a document that never synced, so there are no
    // rows to put under it) or Zero refusing to reconnect — and Zero 1.9.0 never reports
    // `disconnected`, `error` or `closed` for a socket that simply goes away. Sampled every 100ms
    // across 20s after the socket is closed, the banner transitions are exactly
    // `["(none)", "Connecting to omnis…"]`: Zero goes straight to `connecting` and stays there while
    // it retries. Forcing the retries closed with a fatal code does not change it either.
    //
    // So the artifact is the state a person is actually in when the hub dies mid-session: the
    // banner, the synced rows still on screen (blanking them would be the regression this story is
    // fixing), and — the point of the check below — no "Updated …" claim on the subline.
    console.log("Hub gone — a warm page whose socket is taken away (1440.png)");
    const warm: BrowserContext = await browser.newContext({ viewport: WIDE });
    const warmPage = await warm.newPage();
    /** The sockets this page opened. The first is handed to the real server so the page really
     *  syncs; every connection after it is held, so the retry never lands anywhere. */
    const sockets: WebSocketRoute[] = [];
    await warmPage.routeWebSocket(/:5348/, (ws) => {
      if (sockets.length === 0) {
        ws.connectToServer();
      }
      sockets.push(ws);
    });
    await warmPage.goto(BASE);
    await warmPage.waitForSelector(REAL_ROW, { timeout: 60_000 });
    const warmed = await warmPage.locator(REAL_ROW).count();
    const warmSubline = await subline(warmPage);

    await sockets[0]?.close({ code: 1001, reason: "loop-r2-05: the hub goes away" });
    const dropped = await poll(
      () => readBanner(warmPage),
      (banner) => banner !== null,
      "a banner once the socket is gone",
      8_000,
    );
    const keptRows = await warmPage.locator(REAL_ROW).count();
    if (keptRows !== warmed) {
      throw new Error(
        `the socket going away changed the list: ${warmed} rows before, ${keptRows} after`,
      );
    }
    const droppedSubline = await subline(warmPage);
    if (droppedSubline.includes("Updated")) {
      throw new Error(`the subline still claims freshness with the socket gone: ${droppedSubline}`);
    }
    console.log(`  ${warmed} rows, kept — the list is not blanked by a broken connection`);
    console.log(
      `  subline was ${JSON.stringify(warmSubline)}, is now ${JSON.stringify(droppedSubline)}`,
    );
    console.log(`  banner: "${dropped?.text ?? ""}"`);
    await warmPage.screenshot({ path: join(OUT, "1440.png") });
    console.log("  wrote 1440.png (banner under the ask bar, synced rows below it)");
    await warm.close();

    // ---- 3. The healthy stack: offline, and back ---------------------------------------------------
    console.log("Healthy stack — offline and back");
    const live: BrowserContext = await browser.newContext({ viewport: WIDE });
    const page = await live.newPage();
    await page.goto(BASE);
    await page.waitForSelector(REAL_ROW, { timeout: 60_000 });
    // The baseline the check above is a departure from: while the connection is ok the subline does
    // make a freshness claim, so "no Updated claim" is a difference rather than a string that was
    // never going to be there.
    const liveSubline = await subline(page);
    if (!liveSubline.includes("Updated")) {
      throw new Error(
        `the healthy subline makes no freshness claim to drop: ${JSON.stringify(liveSubline)}`,
      );
    }
    console.log(`  healthy subline: ${JSON.stringify(liveSubline)}`);
    const realHeight = await rowHeight(page, REAL_ROW);
    if (realHeight !== skeletonHeight) {
      throw new Error(
        `the skeleton row is ${skeletonHeight}px and a real row is ${realHeight}px — the list jumps when the data lands`,
      );
    }
    console.log(
      `  a real row measures ${realHeight}px, the same as the skeleton's ${skeletonHeight}px`,
    );

    if ((await readBanner(page)) !== null) {
      throw new Error("the banner is on screen while the stack is healthy");
    }
    await live.setOffline(true);
    const offline = await waitForBanner(page, OFFLINE, 8_000);
    const colours = await dotColours(page);
    if (colours.dot !== colours.warning) {
      throw new Error(
        `the offline banner's dot is ${colours.dot} against .status-pill[data-tone="warning"]'s ` +
          `${colours.warning} — the colour was restated instead of borrowed`,
      );
    }
    console.log(`  setOffline(true): "${offline.text}" · dot ${colours.dot}`);
    await live.setOffline(false);
    await poll(
      () => readBanner(page),
      (banner) => banner === null,
      "the banner to go away when the browser is back online",
      10_000,
    );
    console.log("  back online: the banner is gone, which is the state it must not be sticky in");

    // ---- 4. The banner's geometry at three widths --------------------------------------------------
    // All three with a banner on screen, because the banner's line plus its button is the widest
    // thing this story adds. `offline` at each width rather than one state carried across: the
    // narrow tier swaps the ask bar for the BottomBar, and the banner has to fit under both rules.
    console.log("The banner at 1440 / 390 / 320");
    for (const width of [WIDE.width, PHONE.width, SKILLS_NARROW]) {
      await live.setOffline(false);
      await page.setViewportSize({ width, height: 844 });
      await page.waitForTimeout(400);
      await live.setOffline(true);
      await waitForBanner(page, OFFLINE, 8_000);
      await checkWidth(page, width);
    }

    await live.close();
    console.log("loop-r2-05 shots written to", OUT);
  } finally {
    await browser.close();
  }
}

await main();
