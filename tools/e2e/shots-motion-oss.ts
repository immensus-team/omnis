// The motion-OSS wave's evidence: three-frame sequences of the four gestures the wave touched, at
// both tiers, into docs/design/screens/motion-oss/.
//
// Why sequences rather than stills: all four are a *travel* — a tile crossing a slot, a row
// collapsing, a sheet rising, a pane following a pointer past its own limit — and the state before
// and after each one is already in docs/design/screens. What this wave changed is the middle of the
// travel, so the middle is what is committed. A still would document the endpoints, which nobody
// disputed.
//
// The four, and the tier each exists at (asserted below, not assumed):
//   reorder       both tiers — the rail is a column at >=900 and a bottom toolbar below it
//                 (app.css: `@media (max-width: 899.98px) .channel-rail`), so the gesture is
//                 vertical at 1440 and horizontal at 390, which is why the axis is read from the
//                 tier rather than hardcoded.
//   row leave     both tiers. The archive pill is hover-revealed at 390 as well as 1440 — US-D08
//                 §c.4 deliberately kept it on the narrow tier (the swipe is that tier's *other*
//                 way to archive, not its only one). The same press is what raises the "Archived ·
//                 Undo" toast, so each leave sequence carries S6's two assertions as well: the
//                 toast's bottom edge is above the BottomBar's top edge, and the Undo's background
//                 is the accent rather than sonner's default. Both are stated in the frames and in
//                 app.css; the numbers are here.
//   sheet open    390 is the `vaul` drawer (§c.6). 1440 has no Filters trigger at all: the only one
//                 is the BottomBar's, and the BottomBar exists below 900. The wide tier's half of
//                 the same component is the centred dialog, and it is reached here the only way the
//                 app can reach it — open the sheet at the narrow tier, then widen the window, which
//                 is a real state (`useNarrowShell` flips on a resize) and the one the D9 report's
//                 viewport sweep already walks through.
//   divider drag  1440 only, and that is the app's own rule: the grip is `display: none` below 900
//                 (app.css, and shots-detail-pane.ts asserts it). What 390 gets here is a single
//                 frame of the tier proving there is no divider to drag — the pane is the `vaul`
//                 drawer there, which is the same moment `thread-sheet-390` is shot from — with the
//                 assertion behind it: three frames of a press that does nothing is a sequence of
//                 nothing, and shots-detail-pane.ts already records the attempt that photographed
//                 exactly that.
//
// S5's two stills are the exception to the sequences: `thread-sheet-390` and `ai-panel-390` are one
// frame each, because what they document is a *state* rather than a travel — the thread sheet and the
// AI panel as `vaul` drawers below 900, at their rest snap, with the grabber they drag by and the
// scrim over the list. The travel is the same mechanism the sheet's sequence above already frames.
// Both are measured before they are shot: the box `vaul`'s snap offset needs (the window's width, a
// viewport tall, top edge at the snap's fraction) and a hit test at a point inside the drawer, which
// is the one claim about them no stylesheet states — neither `vaul` nor Radix gives the content a
// z-index, so "it paints above the scrim" is read from the browser, not from app.css.
//
// Why the leave sequence runs on its own page: it is the only one needing `page.clock` (a JavaScript
// timer holds the row in the list, so wall-clock screenshots of a 240ms travel are a race), and an
// installed clock is page-wide and permanent. The other three would be frozen by it — `vaul` opens
// its drawer on a `setTimeout`. Two pages in one browser, one clock.
//
// Why the frames are not parked at 0ms: `sheet-in` starts at `translateY(100%)`, so a sheet parked
// at its own 0ms is a picture of nothing at all. Each sequence starts a quarter of the way in, and
// the first frame's measurement (printed, and asserted where it carries meaning) is what says the
// travel had started.
//
// Run: pnpm tsx tools/e2e/shots-motion-oss.ts (same ports as the e2e smoke — never run both at once).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Page, chromium } from "@playwright/test";
import { Pool, query } from "../../packages/db/src/index.js";
import { assertNoOverflow, describeOverflow, measureOverflow } from "./overflow.js";
import { seed, varyInboxCopy } from "./seed.js";
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

const OUT = join(REPO_ROOT, "docs/design/screens/motion-oss");
const HEIGHT = 1000;
const WIDE = 1440;
const NARROW = 390;
/** `<900` is the shell's own narrow breakpoint (lib/media-query.ts's NARROW_SHELL_QUERY, which
 *  app-shell.test.tsx pins to the literal in app.css). Spelled as a number here because this file is
 *  a driver, not a consumer: it decides which viewport to ask for, and it asserts the app answered
 *  in the tier the number named. */
const NARROW_TIER_PX = 900;

/** The durations the frames are named after. Each is the length of the transition the frame shows,
 *  read from the same tokens the app reads (tokens.css) rather than invented here: a frame named
 *  after a number the app does not use would be a picture of an animation that never happened. */
const LEAVE_MS = 240; // --dur-move, the leaving row's own length (and Inbox.tsx's hold)
const PANEL_MS = 240; // --dur-panel, `.sheet`'s sheet-in
const REORDER_MS = 220; // --dur-reorder, the rail's FLIP
const DRAWER_MS = 500; // `vaul`'s own transform transition, written inline on the drawer
/** The lowest of the three drawers' two rest points, as a fraction of the viewport
 *  (narrow-drawer.tsx's `NARROW_DRAWER_SNAP_POINTS`, which packages/ui/test/sheet.test.tsx is what
 *  asserts the literal of). Restated here for the same reason the durations above are: the frames
 *  are checked *against* the number, so a script that imported it would agree with itself. */
const DRAWER_SNAP = 0.5;

/** Three frames per travel, the middle one at the halfway mark. The first is a quarter in for the
 *  two sheet sequences (their `sheet-in` starts off-screen — see the header) and at the start for
 *  the two that are already on screen when they begin. */
const LEAVE_FRAMES = [0, LEAVE_MS / 2, LEAVE_MS - 1];
const REORDER_FRAMES = [0, REORDER_MS / 2, REORDER_MS - 1];
const SHEET_FRAMES = [PANEL_MS / 4, PANEL_MS * 0.62, PANEL_MS - 1];
const DRAWER_FRAMES = [150, 325, DRAWER_MS - 1];
/** How long the drawer is left alone before the first frame is parked on it — see `drawerSequence`.
 *  Not a frame offset: it is the turn `vaul` takes to start moving, and the frames above are
 *  milliseconds into the transition that begins at the end of it. */
const DRAWER_START_GRACE_MS = 150;

/** Where the divider's frames land: the pointer's travel at each sample, in px leftward. The press
 *  starts at the shipped 420px pane and the ceiling is half the shell (720 at 1440), so 240 is
 *  inside the limits, 300 lands the pane exactly *on* the ceiling, and 480 is 180px past it — the
 *  band, which is the one state a still of the settled pane cannot show. */

const GRIP_STEPS = [240, 300, 480];
const LAST_TRAVEL = GRIP_STEPS[GRIP_STEPS.length - 1] ?? 480;
const GRIP_STEP_PX = 60;
const DRAG_FRAME_NAME = ["a-inside", "b-at-limit", "c-band"];

/** Every width the no-overflow floor is checked at, with the pane on screen. 390 and 1440 are the
 *  two the frames are shot at; 768 and 1024 are the single- and two-pane tiers between them, which
 *  this script otherwise never visits. */
const SWEEP_WIDTHS = [390, 768, 1024, 1440];

/** Park every animation running on an element matching `selector` at `ms`, and leave it there.
 *
 *  `document.getAnimations()` returns CSS transitions and CSS animations alike, both of which carry
 *  a `KeyframeEffect` whose `target` is the element. `motion`'s own animations are in there too when
 *  it drives a property through the Web Animations API — the selector decides, not the source.
 *
 *  Each parked animation is named in the result (`CSSTransition[padding-top]`,
 *  `Animation[opacity]`), because "2 parked" does not say whether the one the sequence is about was
 *  among them — which is exactly the question the row's leave turns on (see `leaveSequence`).
 *  Callers assert the count is non-empty: a selector that matched nothing would otherwise produce
 *  three identical screenshots of a state nobody was travelling to, and they would look plausible.
 *
 *  One self-contained function declaration with no inner function expressions on purpose: tsx's
 *  esbuild transform names inner functions and injects a `__name` helper that does not exist in the
 *  page, and `page.evaluate` ships only the one function it is handed — a helper next to it is
 *  `is not defined` at the other end. */
function parkAnimations(args: { selector: string; ms: number }): { count: number; what: string[] } {
  const selector = args.selector;
  const ms = args.ms;
  const what: string[] = [];
  const animations = document.getAnimations();
  for (const animation of animations) {
    const effect = animation.effect;
    if (!(effect instanceof KeyframeEffect)) continue;
    const target = effect.target;
    if (!(target instanceof Element)) continue;
    if (target.closest(selector) === null) continue;
    animation.pause();
    animation.currentTime = ms;
    const props: string[] = [];
    for (const frame of effect.getKeyframes()) {
      for (const key of Object.keys(frame)) {
        if (key === "offset" || key === "computedOffset") continue;
        if (key === "easing" || key === "composite") continue;
        if (props.indexOf(key) === -1) props.push(key);
      }
    }
    what.push(`${animation.constructor.name}[${props.join("+")}]`);
  }
  return { count: what.length, what };
}

/** A box as plain numbers. Not the DOMRect itself: its members live on the prototype, so the
 *  serialiser that carries the value back across the bridge drops them. */
function boxOf(selector: string): { top: number; left: number; width: number; height: number } {
  const el = document.querySelector(selector);
  if (el === null) return { top: 0, left: 0, width: 0, height: 0 };
  const rect = el.getBoundingClientRect();
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

/** Whether a point in the viewport hit-tests *inside* a drawer: `null` when it does, otherwise what
 *  it landed on instead. Neither `vaul` nor Radix gives `Drawer.Content` a z-index — app.css sets one
 *  on the two S5 drawers for that reason — so "the panel paints above the scrim" is not a claim a
 *  stylesheet can carry, and before this it was one a frame was read for by eye. The scrim is what a
 *  miss lands on, which is exactly the failure it is here to catch. */
function hitsDrawer(point: { x: number; y: number }): string | null {
  const el = document.elementFromPoint(point.x, point.y);
  if (el === null) return "nothing";
  if (el.closest("[data-vaul-drawer]") !== null) return null;
  return `${el.tagName.toLowerCase()}.${String(el.className)}`;
}

/** Puts the 390 tier's pane drawer down if it is up, and says whether it was.
 *
 *  It is up on a fresh 390 load, and not because anyone opened it: the seed proposes one pending
 *  approval, App.tsx auto-opens the pane on that queue (`approvals.length > 0` with nothing
 *  selected) and S5 made the narrow pane a *modal* drawer. Pre-S5 the same auto-opened pane was the
 *  z-20 sheet the BottomBar (z-30) sat above, so the bar stayed pressable; a modal drawer is
 *  `pointer-events: none` on everything outside itself, so the whole bar — rail tiles, filters,
 *  compose — is behind its scrim until it is dismissed. Every gesture at this tier that presses the
 *  shell's own chrome therefore has to put it down first, which is the same rule the AI panel's step
 *  below already states. Dismissal sticks (`paneDismissed`), so one Escape is enough per page. */
async function dismissPaneDrawer(page: Page): Promise<void> {
  const drawer = page.locator("[data-vaul-drawer].app-shell__detail");
  const up = await drawer
    .waitFor({ state: "visible", timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (!up) return;
  await page.keyboard.press("Escape");
  await drawer.waitFor({ state: "detached", timeout: 10_000 });
  await page.waitForTimeout(400);
}

/** The rail's tiles in the order they are drawn. The reorder is only evidenced by this: the tiles
 *  look identical in every frame, and where they *are* is the whole of what a reorder decides. The
 *  Inbox tile carries no `aria-roledescription` (it is pinned first and takes no part), so the
 *  filter is the reorderable set, which is what `channel-rail.tsx` marks. */
function railOrder(): string[] {
  const out: string[] = [];
  const tiles = document.querySelectorAll(
    '.channel-rail__tile[aria-roledescription="reorderable"]',
  );
  for (const tile of tiles) out.push(tile.getAttribute("aria-label") ?? "?");
  return out;
}

/** The pane's width as the shell wrote it. The shell draws whatever number this is (`App.tsx` sets
 *  `--detail-width` from one state), so while a drag is running it is the *banded* width, which is
 *  the point of reading it mid-gesture. */
function drawnWidth(): string {
  const shell = document.querySelector('[data-testid="app-shell"]');
  return shell?.style.getPropertyValue("--detail-width") ?? "";
}

/** The toast's bottom edge and the BottomBar's top edge, in viewport coordinates, or `null` when
 *  there is no toast on screen at all. `barTop` is `null` on its own at the wide tier, which draws
 *  no BottomBar (`App.tsx` renders it only when `narrow`) — the leave raises a toast at both, so
 *  "no toast" is a failure and "no bar" is simply a tier with nothing to clear. */
function toastGeometry(): {
  toastBottom: number;
  barTop: number | null;
} | null {
  const toast = document.querySelector("[data-sonner-toast]");
  if (toast === null) return null;
  const bar = document.querySelector(".bottom-bar");
  return {
    toastBottom: toast.getBoundingClientRect().bottom,
    barTop: bar === null ? null : bar.getBoundingClientRect().top,
  };
}

/** The action button's background against the accent it is supposed to wear, both as the browser
 *  computed them. Resolved through a throwaway element rather than read as the token's own text:
 *  `getPropertyValue("--accent")` returns the authored `oklch(…)`, which is not the string a
 *  computed `background-color` comes back as, so the two could never be compared directly.
 *
 *  This exists because the first run's frames showed a dark-grey Undo: sonner's own
 *  `[data-sonner-toast][data-styled='true'] [data-button]` is (0,3,0) and the app's
 *  `.omnis-toast__action` was (0,1,0), so every declaration in it was dead. A frame can be looked
 *  at and this cannot be, which is the whole reason it is here rather than left to the eye. */
function toastUndoColour(): { background: string; accent: string; label: string } {
  const probe = document.createElement("span");
  probe.style.color = "var(--accent)";
  document.body.appendChild(probe);
  const accent = getComputedStyle(probe).color;
  probe.remove();
  const button = document.querySelector("[data-sonner-toast] [data-button]");
  return {
    background: button === null ? "" : getComputedStyle(button).backgroundColor,
    accent,
    label: button === null ? "" : (button.textContent ?? ""),
  };
}

/** Finish, rather than park, whatever is still moving inside the toast: an entrance parked half way
 *  would put the toast's bottom edge 40px below where it comes to rest, and the assertion below is
 *  about where it rests. `finish()` jumps the animation to its end without waiting on a clock — the
 *  fake one this page carries is paused, and a CSS transition is driven by the browser's own
 *  timeline rather than by that clock, so waiting would be the unreliable way to get here. */
function settleToast(): number {
  let finished = 0;
  const animations = document.getAnimations();
  for (const animation of animations) {
    const effect = animation.effect;
    if (!(effect instanceof KeyframeEffect)) continue;
    const target = effect.target;
    if (!(target instanceof Element)) continue;
    if (target.closest("[data-sonner-toast]") === null) continue;
    try {
      animation.finish();
      finished++;
    } catch {
      // A transition that cannot be finished (a zero playback rate, an infinite duration) is left
      // where it is; the count that comes back is what says whether that happened.
    }
  }
  return finished;
}

/** The leaving row's rendered opacity, and the inline style the animation left on it. The fade is
 *  the half of this leave that cannot be sampled the way the collapse can — it is not among the
 *  animations `parkAnimations` finds — so the frames carry the numbers instead of leaving it to the
 *  eye, and the inline style is what says whether the value on screen is a committed style write or
 *  something still being driven. See `leaveSequence`. */
function leavingState(): { opacity: string; style: string } {
  const row = document.querySelector(".inbox-row--leaving");
  if (row === null) return { opacity: "", style: "" };
  return { opacity: getComputedStyle(row).opacity, style: row.getAttribute("style") ?? "" };
}

async function shot(page: Page, name: string, note: string): Promise<void> {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`  ${name}.png — ${note}`);
}

/** Park and insist something was there to park. */
async function park(page: Page, selector: string, ms: number, label: string): Promise<void> {
  const parked = await page.evaluate(parkAnimations, { selector, ms });
  if (parked.count === 0) {
    throw new Error(`nothing was animating on ${selector} for ${label} at ${ms}ms`);
  }
  console.log(`    ${label} @${ms}ms — parked ${parked.count}: ${parked.what.join(", ")}`);
}

/** The pointer off the list, and any hover card it opened given time to leave. The card is anchored
 *  to a row and floats out over the pane, so a pointer that rested on the list arrives at the
 *  divider with the card already open on top of it. */
async function parkPointer(page: Page): Promise<void> {
  await page.mouse.move(2, 2);
  await page
    .locator(".row-hover-card")
    .waitFor({ state: "hidden", timeout: 5000 })
    .catch(() => undefined);
  await page.waitForTimeout(500);
}

async function assertNoOverflowAt(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(measureOverflow);
  console.log(`  ${label}: ${describeOverflow(overflow)}`);
  assertNoOverflow(label, overflow);
}

/** One tier of the rail's reorder: lift a tile, carry it across its neighbour, and sample the FLIP
 *  three times while the neighbours are still travelling.
 *
 *  A crossing rather than a drop-at-the-end: the reorder commits under the pointer (the preview
 *  order is the render order), so the neighbours start moving on the `pointermove` that crossed the
 *  midpoint and the frames have something to park. The tile is left held at the last frame — the
 *  release is parked too, because the third thing this gesture has is the lifted tile's own settle
 *  into the slot it just took. */
async function reorderSequence(page: Page, width: number): Promise<void> {
  const vertical = width >= NARROW_TIER_PX;
  const tiles = page.locator('.channel-rail__tile[aria-roledescription="reorderable"]');
  await tiles.first().waitFor({ timeout: 30_000 });
  const count = await tiles.count();
  if (count < 3) throw new Error(`need three reorderable tiles to cross one, got ${count}`);

  const before = await page.evaluate(railOrder);
  const heldBox = await tiles.nth(1).boundingBox();
  const nextBox = await tiles.nth(2).boundingBox();
  if (heldBox === null || nextBox === null) throw new Error("a rail tile has no box to press");
  // One slot's pitch, measured rather than assumed: the two tiles are laid out by the stylesheet and
  // the pitch changes with the tier (a 56px toolbar row against a 44px column pitch).
  const pitch = vertical ? nextBox.y - heldBox.y : nextBox.x - heldBox.x;
  const centre = { x: heldBox.x + heldBox.width / 2, y: heldBox.y + heldBox.height / 2 };
  const along = (distance: number): { x: number; y: number } =>
    vertical ? { x: centre.x, y: centre.y + distance } : { x: centre.x + distance, y: centre.y };

  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  // Past the primitive's 6px start slop (so the tile lifts at all), short of the neighbour's
  // midpoint (so the order has not changed yet). The wait is the lift's own settle.
  const lift = along(12);
  await page.mouse.move(lift.x, lift.y);
  await page.waitForTimeout(REORDER_MS);
  await shot(
    page,
    `reorder-${width}-1-lift`,
    `"${before[1]}" is lifted off its slot and the order is still ${before.join(" ")}`,
  );

  // The crossing: a little past one pitch, which puts the pointer past the next tile's centre.
  const to = along(pitch * 1.15);
  await page.mouse.move(to.x, to.y);
  // Two frames for the FLIP's Play: the inversion is written inline in a layout effect and released
  // onto the transition in the *next* requestAnimationFrame, so parking before that has nothing to
  // park (and the throw in `park` says so rather than writing three stills of a settled rail).
  await page.waitForTimeout(60);
  for (const ms of REORDER_FRAMES) {
    await park(page, ".channel-rail__tile", ms, "reorder");
    await shot(
      page,
      `reorder-${width}-${REORDER_FRAMES.indexOf(ms) + 2}-cross-${ms}ms`,
      `the neighbours mid-travel, ${pitch.toFixed(0)}px to their new slots`,
    );
  }

  const after = await page.evaluate(railOrder);
  if (after.join(" ") === before.join(" ")) {
    throw new Error(`the crossing did not reorder the rail: still ${after.join(" ")}`);
  }
  console.log(`    rail order ${before.join(" ")} -> ${after.join(" ")}`);

  await page.mouse.up();
  await park(page, ".channel-rail__tile", REORDER_MS / 2, "reorder settle");
  await shot(
    page,
    `reorder-${width}-5-settle-${REORDER_MS / 2}ms`,
    `"${after[2]}" settling into the slot it just took`,
  );
}

/** The narrow tier's sheet open, at the frame offsets caller passes: click the BottomBar's Filters
 *  circle, then park the drawer's own entrance three times.
 *
 *  `vaul` writes the drawer's transform inline and transitions it over 500ms; `.sheet` carries
 *  `sheet-in` on top (--dur-panel). Both are parked together, and the measurement that carries the
 *  assertion is the drawer's top — the drawer rises, so it has to fall. */
async function drawerSequence(page: Page, frames: readonly number[]): Promise<void> {
  const filters = page.getByRole("button", { name: "Filters" });
  if ((await filters.count()) !== 1) {
    throw new Error("the narrow tier draws no Filters circle — no sheet can open from here");
  }
  await filters.click();
  await page.locator("[data-vaul-drawer]").waitFor({ timeout: 10_000 });
  // And then the drawer's own start, which is not the same moment as its mount. `vaul` mounts the
  // drawer at `translateY(100%)` and sets the snap offset on a later turn — the first run of this
  // script parked at 125ms and photographed a drawer that had not begun to move (its top was the
  // viewport height, measured). The wait is for that turn to have happened; parking then sets the
  // clock back to the frame being asked for, so the wait costs nothing but certainty.
  await page.waitForTimeout(DRAWER_START_GRACE_MS);

  const tops: number[] = [];
  for (const ms of frames) {
    await park(page, "[data-vaul-drawer], .sheet-overlay", ms, "drawer");
    const box = await page.evaluate(boxOf, "[data-vaul-drawer]");
    tops.push(box.top);
    await shot(
      page,
      `sheet-open-390-${ms}ms`,
      `drawer top ${box.top.toFixed(0)}px, height ${box.height.toFixed(0)}px`,
    );
  }
  // Strictly rising across all three samples. A parked drawer that does not move is a drawer whose
  // travel has already finished — three identical frames, which is the failure mode this whole
  // script exists to make impossible to mistake for evidence.
  for (let i = 1; i < tops.length; i++) {
    if (!((tops[i] ?? 0) < (tops[i - 1] ?? 0))) {
      throw new Error(
        `the drawer is not rising: tops ${tops.map((t) => t.toFixed(0)).join(" -> ")}`,
      );
    }
  }
  console.log(
    `    drawer rose ${(tops[0] ?? 0).toFixed(0)} -> ${(tops[tops.length - 1] ?? 0).toFixed(0)}px`,
  );
}

/** The same sheet above the narrow tier: the component is a centred dialog there, and the only path
 *  to it in this app is the resize (see the header). The dialog mounts on the tier flip, so its
 *  `sheet-in` runs from that moment and can be parked like any other animation. */
async function dialogSequence(page: Page, frames: readonly number[]): Promise<void> {
  const dialog = page.locator(".sheet");
  await dialog.waitFor({ timeout: 10_000 });
  const tops: number[] = [];
  for (const ms of frames) {
    await park(page, ".sheet, .sheet-overlay", ms, "dialog");
    const box = await page.evaluate(boxOf, ".sheet");
    tops.push(box.top);
    await shot(
      page,
      `sheet-open-1440-${ms}ms`,
      `dialog top ${box.top.toFixed(0)}px, width ${box.width.toFixed(0)}px`,
    );
  }
  console.log(`    dialog tops ${tops.map((t) => t.toFixed(0)).join(" -> ")}`);
}

/** The divider drag, at the tier that has a divider. The pane follows the pointer one-for-one
 *  inside its limits and at a third of the travel outside them, so the three samples are the pane's
 *  width at the pointer, then near the ceiling, then in the band — where the width drawn and the
 *  width asked for are deliberately different numbers, which is the assertion. */
async function dividerSequence(page: Page): Promise<void> {
  const grip = page.getByRole("separator", { name: "Resize details pane" });
  if ((await grip.count()) === 0) {
    const expand = page.getByRole("button", { name: "Expand details" });
    if ((await expand.count()) === 0)
      throw new Error("the wide tier draws neither grip nor chevron");
    await expand.click();
  }
  await grip.waitFor({ timeout: 10_000 });
  const shellWidth = await page.evaluate(boxOf, '[data-testid="app-shell"]').then((b) => b.width);
  const ceiling = shellWidth / 2;

  await parkPointer(page);
  const box = await grip.boundingBox();
  if (box === null) throw new Error("the grip has no box to press");
  // Three-quarters across, not the centre: the grip straddles the divider, so its centre is where a
  // row ends and the hover card's dwell would put the card over the press point. shots-detail-pane
  // measured that; the quarter inside the pane is the same control and never over a row.
  const from = { x: box.x + box.width * 0.75, y: box.y + box.height / 2 };
  const top = await page.evaluate(
    `(() => {
       const el = document.elementFromPoint(${from.x}, ${from.y});
       return el === null ? "nothing" : (el.closest(".detail-pane__grip") !== null ? "grip" : el.className);
     })()`,
  );
  if (top !== "grip") throw new Error(`the divider is covered at its press point by: ${top}`);

  const start = (await page.evaluate(boxOf, ".app-shell__detail")).width;
  console.log(
    `  shell ${shellWidth.toFixed(0)}px, pane starts at ${start.toFixed(0)}px, ceiling ${ceiling.toFixed(0)}px`,
  );

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Walked to the furthest frame rather than stopping at the third sample: the samples are travels
  // (240/360/480), not steps, and a loop that ran `GRIP_STEPS.length` times stopped at 180px — inside
  // the limits, with no band to release from. Measured, not imagined: that is what the first run of
  // this script did, and it failed three checks further on with "nothing was animating".
  for (let travel = GRIP_STEP_PX; travel <= LAST_TRAVEL; travel += GRIP_STEP_PX) {
    await page.mouse.move(from.x - travel, from.y);
    await page.waitForTimeout(40);
    if (GRIP_STEPS.indexOf(travel) === -1) continue;
    const rendered = (await page.evaluate(boxOf, ".app-shell__detail")).width;
    const drawn = await page.evaluate(drawnWidth);
    const asked = start + travel;
    const banded = asked > ceiling;
    // Inside the limits the pane is where the pointer is, to the pixel. Past the ceiling it is not:
    // it is the ceiling plus a third of the overshoot, so it lags the pointer by two thirds — which
    // is what makes the third frame a picture of a limit rather than of a wall.
    if (banded) {
      if (!(rendered > ceiling && rendered < asked)) {
        throw new Error(
          `outside the limits the pane drew ${rendered.toFixed(1)}px for a requested ${asked}px against a ${ceiling}px ceiling — the band is gone`,
        );
      }
      console.log(
        `    banded: asked ${asked}px, drew ${rendered.toFixed(1)}px (${(rendered - ceiling).toFixed(1)}px of the ${(asked - ceiling).toFixed(0)}px overshoot)`,
      );
    } else if (Math.abs(rendered - asked) > 1) {
      throw new Error(
        `the pane is not following the pointer: ${travel}px of travel drew ${rendered.toFixed(1)}px, not ${asked}px`,
      );
    }
    // The number the shell wrote and the box the browser laid out are the same width — read as
    // numbers rather than compared as strings, because the string is a float's own spelling
    // ("739.2px") and a tenth of a pixel of rounding is not a disagreement about the width.
    if (Math.abs(Number.parseFloat(drawn) - rendered) > 0.5) {
      throw new Error(
        `the shell wrote --detail-width: ${drawn} while drawing ${rendered.toFixed(1)}px`,
      );
    }
    await shot(
      page,
      `divider-drag-1440-${DRAG_FRAME_NAME[GRIP_STEPS.indexOf(travel)]}`,
      `${travel}px of travel: pane drawn at ${rendered.toFixed(0)}px (${banded ? "in the band" : "inside the limits"})`,
    );
  }

  // The release. The band is not a decision: the pane springs back to the ceiling on the same
  // settle it uses everywhere else, and the frame is that travel — still past the ceiling, already
  // past the band.
  await page.mouse.up();
  await park(page, ".app-shell__detail", LEAVE_MS / 2, "divider release");
  const settled = (await page.evaluate(boxOf, ".app-shell__detail")).width;
  // Strictly *beyond* the ceiling, which is the whole assertion: parked at half of --dur-move the
  // pane has to still be on its way back. A pane that had snapped (or a park that had failed to
  // take) would read exactly the ceiling, and the frame would be a picture of the settled state
  // wearing a mid-travel file name.
  if (!(settled > ceiling)) {
    throw new Error(
      `the release is at ${settled.toFixed(1)}px, not beyond its ${ceiling.toFixed(0)}px ceiling — it snapped rather than travelled`,
    );
  }
  await shot(
    page,
    `divider-drag-1440-d-release-${LEAVE_MS / 2}ms`,
    `released: the pane is past its ${ceiling.toFixed(0)}px ceiling and on its way back`,
  );
  await page.waitForTimeout(400);
  const committed = await page.evaluate(drawnWidth);
  console.log(`    committed ${committed}`);
}

async function leaveSequence(page: Page, width: number): Promise<void> {
  const rows = page.locator(".inbox-row");
  const rowCount = await rows.count();
  if (rowCount < 3) throw new Error(`need three rows to show a list closing, got ${rowCount}`);
  // A row with rows below it: the collapse is only legible if something moves up behind it.
  const target = rows.nth(1);
  const name = (await target.locator(".inbox-row__name").textContent()) ?? "?";

  // Freeze JavaScript time before the click. That is what holds the row in the list (Inbox.tsx's
  // LEAVE_MS timer), and it is also what lets the collapse be sampled: `motion` drives `height`
  // from its own rAF loop, so the frames are taken by advancing the fake clock rather than by
  // waiting on the wall clock. The opacity half rides the Web Animations API, which the fake clock
  // does not drive — that half is parked explicitly.
  await page.clock.install();
  await page.clock.pauseAt(new Date());

  await target.hover();
  await target.getByRole("button", { name: "Archive" }).click();
  await page.waitForSelector(".inbox-row--leaving", { timeout: 5_000 });

  // Parked on the first turn after the click, before the hover-out and before the loop. The timing
  // is the point: `motion` drives `opacity` through the Web Animations API, whose clock is the
  // browser's rather than the fake one, so the fade keeps running in real time while this driver is
  // between calls, and a finished animation leaves `document.getAnimations()` — at which point it
  // can no longer be parked at all. Whether the fade ends up in the frames is reported rather than
  // assumed: the log names what was parked (`Animation[opacity]` or not), and every frame prints the
  // row's rendered opacity next to its height.
  await park(page, ".inbox-row--leaving", 0, "row leave (the fade, first)");
  const first = await page.evaluate(leavingState);
  if (!(Number(first.opacity) > 0.99)) {
    throw new Error(
      `the fade was already over when the first frame was parked: opacity ${first.opacity} at 0ms, so the run would be three pictures of a row that is already gone`,
    );
  }
  console.log(`    the row is still opaque at the first park: style "${first.style}"`);
  await page.mouse.move(8, 8);

  let previous = Number.POSITIVE_INFINITY;
  let elapsed = 0;
  for (const ms of LEAVE_FRAMES) {
    await page.clock.runFor(ms - elapsed);
    elapsed = ms;
    await park(page, ".inbox-row--leaving", ms, "row leave");
    const box = await page.evaluate(boxOf, ".inbox-row--leaving");
    // The collapse, measured: the row's own height has to fall between the frames, or the three
    // pictures are a row that is fading where it stands. This is the assertion the whole fake clock
    // is for, and it is what a frame set alone cannot say.
    if (!(box.height < previous)) {
      throw new Error(
        `the row is not collapsing: ${previous.toFixed(1)}px at the previous frame, ${box.height.toFixed(1)}px at ${ms}ms`,
      );
    }
    previous = box.height;
    const state = await page.evaluate(leavingState);
    await shot(
      page,
      `row-leave-${width}-${ms}ms`,
      `row "${name}" at ${box.height.toFixed(1)}px tall, opacity ${state.opacity}, style "${state.style}"`,
    );
  }
  console.log(`    row "${name}" collapsed to ${previous.toFixed(1)}px over ${LEAVE_MS}ms`);

  // The toast, last: the archive press raises it at the same moment it starts the row leaving, so it
  // is on screen for all three frames — and at 390 it lands in the band the BottomBar and the rail
  // toolbar already own, which is where the first run's frames showed it sitting on the Inbox tile.
  // That was two faults in one rule (app.css carries both): an offset written to a variable sonner
  // does not read below 600px, and a sum that landed inside the bar's own band above it. Asserted
  // here rather than eyeballed in the frames because "the toast looks like it clears the bar" is
  // exactly the judgement a 40px-tall translucent object over a busy list defeats.
  //
  // Measured after the leave frames and not before them, because of the fade: the row's opacity runs
  // on the browser's own timeline while this page's clock is paused, so a detour of a few hundred
  // milliseconds here would let the fade finish before its first park, and `leaveSequence`'s own
  // "the fade was already over" check would fire. The toast's dwell is a `setTimeout`, which the
  // paused clock does hold, so it is still on screen this late.
  const settledAnimations = await page.evaluate(settleToast);
  const geometry = await page.evaluate(toastGeometry);
  if (geometry === null) {
    throw new Error("archiving raised no toast at all — nothing to wear the Undo");
  }
  console.log(
    `    toast settled (${settledAnimations} animation(s) finished); bottom edge at ${geometry.toastBottom.toFixed(1)}px`,
  );
  if (geometry.barTop !== null && !(geometry.toastBottom <= geometry.barTop)) {
    throw new Error(
      `at ${width} the toast's bottom edge is ${geometry.toastBottom.toFixed(1)}px, at or below the BottomBar's top edge at ${geometry.barTop.toFixed(1)}px — the bar is covered`,
    );
  }
  if (geometry.barTop !== null) {
    console.log(
      `    and it clears the BottomBar, whose top edge is at ${geometry.barTop.toFixed(1)}px`,
    );
  }

  const undo = await page.evaluate(toastUndoColour);
  if (undo.label !== "Undo") {
    throw new Error(`the toast's action is "${undo.label}", not the Undo this sequence documents`);
  }
  if (undo.background !== undo.accent) {
    throw new Error(
      `the Undo is ${undo.background}, not the accent (--accent computes to ${undo.accent}) — sonner's own [data-button] rule is winning`,
    );
  }
  console.log(`    the Undo wears --accent: ${undo.background}`);
}

async function main(): Promise<void> {
  const env = loadOrCreateEnv();
  assertPortsFree();
  await resetDatabase(env);
  deployZeroPermissions(env);
  startZeroCache(env);
  await waitForHttp(`http://127.0.0.1:${ZERO_PORT}/`, 90_000);
  startHub(env);
  await waitForHttp(`http://127.0.0.1:${HUB_PORT}/health`, 60_000);
  startDesktop();
  await waitForHttp(`http://127.0.0.1:${VITE_PORT}/`, 90_000);

  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 4 });
  let closeBridge: (() => void) | undefined;
  try {
    const seeded = await seed(pool, env);
    closeBridge = seeded.closeBridge;
    await varyInboxCopy(pool);

    mkdirSync(OUT, { recursive: true });
    const browser = await chromium.launch();

    /** Every page pins the motion preference, and that is not a convenience. `reducedMotion`
     *  defaults to the *host's* setting, so a machine with "Reduce Motion" on would quietly shoot
     *  the reduced branch — a different travel at a different length, named after the full-motion
     *  milliseconds in these file names. The reduced branch is covered where it can be asserted
     *  (packages/ui's leave suite and motion.test.tsx); these frames document the other one. */
    const open = async (width: number): Promise<Page> => {
      const page = await browser.newPage({ viewport: { width, height: HEIGHT } });
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.goto(`http://127.0.0.1:${VITE_PORT}/`);
      await page.waitForSelector(".inbox-row", { timeout: 60_000 });
      // The seed's rows arrive over Zero replication; nothing may be measured or archived before
      // the list has settled.
      await page.waitForTimeout(2500);
      return page;
    };

    const page = await open(WIDE);

    console.log("1440 — the rail's reorder");
    await reorderSequence(page, WIDE);
    console.log("390 — the rail's reorder (the toolbar tier, so the axis is x)");
    await page.setViewportSize({ width: NARROW, height: HEIGHT });
    await page.waitForTimeout(600);
    // A reload first, so the tiles the last sequence left with parked transforms are drawn again
    // from the stylesheet: this sequence measures a pitch between two boxes, and a box still carrying
    // a paused translate is not that pitch.
    await page.reload();
    await page.waitForSelector(".inbox-row", { timeout: 60_000 });
    await page.waitForTimeout(2500);
    await dismissPaneDrawer(page);
    await reorderSequence(page, NARROW);

    console.log("390 — the Filters sheet (vaul)");
    await page.reload();
    await page.waitForSelector(".inbox-row", { timeout: 60_000 });
    await page.waitForTimeout(2500);
    await dismissPaneDrawer(page);
    await drawerSequence(page, DRAWER_FRAMES);

    console.log("1440 — the same sheet above the narrow tier (the centred dialog)");
    await page.setViewportSize({ width: WIDE, height: HEIGHT });
    await dialogSequence(page, SHEET_FRAMES);

    // Closed before the divider: the sheet is the topmost thing on screen while it is up
    // (`.sheet-overlay` is z-index 40, over the pane's 20), so a divider pressed underneath it would
    // be a press on the scrim.
    await page.keyboard.press("Escape");
    await page.locator(".sheet").waitFor({ state: "detached", timeout: 10_000 });
    await page.waitForTimeout(500);

    console.log("1440 — the divider drag and the band");
    // The pane has to be up for there to be a divider, and by now it is not: the two 390 sequences
    // above dismissed the auto-opened one, and a dismissal sticks. A press on a row is how the shell
    // opens a thread at every tier (the D9 spec does the same), and it is an explicit target, which
    // is what releases the dismissal.
    if ((await page.locator('[data-testid="detail-pane"]').count()) === 0) {
      await page.locator(".inbox-row").first().click();
      await page.mouse.move(2, 2);
      await page.locator('[data-testid="detail-pane"]').waitFor({ timeout: 15_000 });
      await page.waitForTimeout(400);
    }
    await dividerSequence(page);

    console.log("390 — the thread sheet (vaul), and no divider");
    await page.setViewportSize({ width: NARROW, height: HEIGHT });
    await page.waitForTimeout(800);
    if ((await page.getByRole("separator", { name: "Resize details pane" }).count()) !== 0) {
      throw new Error("the divider is in the DOM at 390 — it is display:none in app.css");
    }
    // S5: below 900 the pane is the same `vaul` drawer the filters come up in, so the pane's box is
    // read off `Drawer.Content` rather than off `.app-shell__detail`'s own rule. Two numbers are the
    // whole of it: a bottom drawer is the window's width, and `vaul`'s snap offset is a *translate*
    // of `viewport - snap * viewport`, which is what puts the element's top edge at the snap's
    // fraction of the viewport while the box itself is a full viewport tall.
    const drawer = await page.evaluate(boxOf, "[data-vaul-drawer].app-shell__detail");
    const viewport = await page.evaluate("window.innerWidth");
    if (Math.abs(drawer.width - viewport) > 1) {
      throw new Error(
        `the 390 thread drawer is ${drawer.width.toFixed(1)}px wide, not the window's ${viewport}px`,
      );
    }
    const restingTop = HEIGHT * (1 - DRAWER_SNAP);
    if (Math.abs(drawer.top - restingTop) > 2) {
      throw new Error(
        `the 390 thread drawer rests at top ${drawer.top.toFixed(0)}px, not at the ${DRAWER_SNAP} snap's ${restingTop}px`,
      );
    }
    const missed = await page.evaluate(hitsDrawer, { x: viewport / 2, y: drawer.top + 60 });
    if (missed !== null) {
      throw new Error(`a point inside the thread drawer lands on ${missed}, not on the drawer`);
    }
    await parkPointer(page);
    await shot(
      page,
      "divider-drag-390-no-grip",
      `no splitter in the DOM; the pane is the window's own ${drawer.width.toFixed(0)}px drawer instead`,
    );
    await shot(
      page,
      "thread-sheet-390",
      `the thread sheet at rest: top ${drawer.top.toFixed(0)}px, snap ${DRAWER_SNAP} of ${HEIGHT}`,
    );

    console.log("390 — the AI panel (vaul), the same drawer");
    // The thread sheet has to be down first, for the reason the Filters press needed it: a modal
    // drawer owns the pointer for everything outside itself, and App.tsx ignores the ask bar's own
    // shortcut while one of them is up.
    await page.keyboard.press("Escape");
    await page
      .locator("[data-vaul-drawer].app-shell__detail")
      .waitFor({ state: "detached", timeout: 10_000 });
    await page.locator(".ask-bar input").click();
    await page.locator("[data-vaul-drawer].ask-panel").waitFor({ timeout: 10_000 });
    await page.waitForTimeout(800);
    const panel = await page.evaluate(boxOf, "[data-vaul-drawer].ask-panel");
    if (
      Math.abs(panel.width - viewport) > 1 ||
      Math.abs(panel.left) > 1 ||
      Math.abs(panel.top - restingTop) > 2
    ) {
      throw new Error(
        `the 390 AI drawer is ${panel.width.toFixed(0)}px at x=${panel.left.toFixed(0)}, top=${panel.top.toFixed(0)} — not the window's width at the ${DRAWER_SNAP} snap`,
      );
    }
    const panelMissed = await page.evaluate(hitsDrawer, { x: viewport / 2, y: panel.top + 60 });
    if (panelMissed !== null) {
      throw new Error(`a point inside the AI drawer lands on ${panelMissed}, not on the drawer`);
    }
    await parkPointer(page);
    await shot(
      page,
      "ai-panel-390",
      `the ask bar's panel, the same drawer: top ${panel.top.toFixed(0)}px`,
    );
    // Down before the sweep: a full-viewport fixed drawer is not the page that floor is measured on.
    await page.keyboard.press("Escape");
    await page
      .locator("[data-vaul-drawer].ask-panel")
      .waitFor({ state: "detached", timeout: 10_000 });
    await page.waitForTimeout(400);

    console.log(`no-overflow sweep at ${SWEEP_WIDTHS.join(", ")}`);
    for (const width of SWEEP_WIDTHS) {
      await page.setViewportSize({ width, height: HEIGHT });
      await page.waitForTimeout(600);
      await assertNoOverflowAt(page, `${width}px`);
    }

    // The leave sequences last, and on their own pages: the clock they install is page-wide and
    // permanent, so they cannot share one with the four above (see the header).
    //
    // The seeded approval is closed first, at both tiers. It is the one pending row the seed
    // proposes, and App.tsx auto-opens the pane on it (`approvals.length > 0` with nothing
    // selected) — a column at 1440, a full-width sheet at 390 that covers the very list the row
    // has to be hovered in. Measured: at 390 the hover timed out for 30s on `<section
    // data-testid="detail-pane"> intercepts pointer events`. Closing it (state 'expired' +
    // decision 'ignore' keeps the row and satisfies approvals_decided_ck — the same fixture
    // adjustment shots-responsive.ts makes) is what makes the list reachable, and doing it for
    // both tiers is what makes the two sequences measure the same list.
    await query(
      pool,
      `UPDATE pending_approvals SET state = 'expired', decision = 'ignore', decided_at = now()
        WHERE state = 'pending'`,
    );
    for (const width of [WIDE, NARROW]) {
      console.log(`${width} — the inbox row's leave`);
      const leavePage = await open(width);
      // Detached resolves at once if the pane is not there at all, which is the expected case;
      // it is here for the turn Zero could still be delivering the pre-update row on.
      await leavePage
        .locator('[data-testid="detail-pane"]')
        .waitFor({ state: "detached", timeout: 10_000 });
      await leaveSequence(leavePage, width);
      await leavePage.close();
    }

    await browser.close();
    console.log("motion-OSS sequences written to", OUT);
  } finally {
    closeBridge?.();
    await pool.end();
    await stopAll();
  }
}

await main();
