// US-D09 §c.5–§c.8: the material rules for the detail pane, the sheets, the popover and the two
// action bars — measured on the rendered page, not read out of the stylesheet.
//
// US-D09's first pass satisfied the *literal* form of reviewer check 2 by moving the pane's glass
// recipe out of a `.glass-surface` class while leaving the recipe itself on the pane; a glass
// capsule then sat inside a glass sheet at 900–1279.98 and the DOM check still passed, because the
// check was looking at class names and the rule is about material. So this spec asks the browser
// what it actually painted: every element whose computed `backdrop-filter` is not `none`, and
// whether any of its ancestors has one too. `app-shell.test.tsx` still owns the stylesheet-text
// assertions; this file is the half that cannot be written against text.
//
// The stack was already brought up by tools/e2e/run.ts.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Page, expect, test } from "@playwright/test";

const E2E_DIR = new URL(".", import.meta.url).pathname;

interface Assertion {
  name: string;
  ok: boolean;
  ms: number;
  note?: string;
}
const results: Assertion[] = [];

/** Playwright colours its matcher errors, and the escapes end up in `.tmp/assertions.json` and in
 *  REPORT.md. Spelled rather than typed: biome rejects a literal control character in a regex, and
 *  a note is not the place to argue with it about that. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/** A failed row's note, values included. Playwright names the matcher on the first line and puts
 *  what it read on the third and fourth, so a note built from the first line alone records *that*
 *  something failed rather than what it saw — the last motion-OSS run's `.tmp/assertions.json` holds
 *  "expect(received).toBe(expected) // Object.is equality" for two failures and nothing else, which
 *  is unreadable evidence and cost a second run to diagnose. Six lines fit in the report's cell. */
function noteOf(e: unknown): string {
  const plain = (e instanceof Error ? e.message : String(e)).replace(ANSI, "");
  return plain
    .split("\n")
    .filter((line) => line.trim() !== "")
    .slice(0, 6)
    .join(" | ")
    .slice(0, 400);
}

async function check(name: string, fn: () => Promise<string | undefined>): Promise<void> {
  const started = Date.now();
  try {
    const note = await fn();
    results.push({ name, ok: true, ms: Date.now() - started, ...(note ? { note } : {}) });
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - started, note: noteOf(e) });
  }
}

/** Appends to `.tmp/assertions.json` — the same read-modify-write aurora.spec.ts documents, so the
 *  three specs' rows end up in one file rather than replacing each other. */
test.afterAll(() => {
  const file = join(E2E_DIR, ".tmp", "assertions.json");
  let existing: Assertion[] = [];
  try {
    existing = JSON.parse(readFileSync(file, "utf8")) as Assertion[];
  } catch {
    // No file yet (this spec ran first) — there is nothing to append to.
  }
  mkdirSync(join(E2E_DIR, ".tmp"), { recursive: true });
  writeFileSync(file, JSON.stringify([...existing, ...results], null, 2));
});

interface GlassLayer {
  el: string;
  backdrop: string;
  /** The nearest ancestor that also paints a backdrop filter, or null. */
  glassAncestor: string | null;
}

/** Runs in the page. Top-level `function`, and its body holds no nested function expressions: the
 *  source is shipped to the page, where a `__name(...)` wrapper injected by the TS transform's
 *  `keepNames` has nothing to bind to (overflow.ts's header records the same trap).
 *
 *  Elements that generate no box are skipped, in the ancestor walk as well as the scan. That is not
 *  a convenience: `.channel-rail__plate` is `display: contents` below 900 (app.css dissolves its box
 *  so its tiles join the bar's own row) and still *computes* the glass recipe, so counting it would
 *  report a nesting that has no pixels — the element paints nothing, so there is nothing stacked. */
function readGlassStack(): GlassLayer[] {
  const out: GlassLayer[] = [];
  const all = Array.from(document.querySelectorAll("*"));
  for (const el of all) {
    if (el.getClientRects().length === 0) continue;
    const style = getComputedStyle(el);
    if (style.backdropFilter === "none" || style.backdropFilter === "") continue;
    let ancestor: Element | null = el.parentElement;
    let glassAncestor: string | null = null;
    while (ancestor !== null) {
      if (ancestor.getClientRects().length > 0) {
        const aStyle = getComputedStyle(ancestor);
        if (aStyle.backdropFilter !== "none" && aStyle.backdropFilter !== "") {
          glassAncestor = `${ancestor.tagName.toLowerCase()}.${String(ancestor.className)}`;
          break;
        }
      }
      ancestor = ancestor.parentElement;
    }
    out.push({
      el: `${el.tagName.toLowerCase()}.${String(el.className)}`,
      backdrop: style.backdropFilter,
      glassAncestor,
    });
  }
  return out;
}

interface SurfaceCheck {
  /** The selector that was looked for. */
  sel: string;
  /** How many it matched. More than one is only meaningful for the two action bars. */
  count: number;
  /** True when every match is a `.glass-surface` with a `data-glass-slot`. */
  glass: boolean;
  /** True when no match declares a background of its own: its computed `backgroundColor` and
   *  `backdropFilter` are exactly a bare `.glass-surface` probe's. `--bg-overlay` is a per-theme
   *  value with an alpha, so an element that set its own fill would land on a different string
   *  even if it named the same token by hand. */
  recipe: boolean;
  detail: string;
}

/** Runs in the page (same constraints as readGlassStack). */
function readSurfaces(): SurfaceCheck[] {
  // The reference: one element carrying nothing but the shared class, so whatever it computes to is
  // the recipe with no caller in the way.
  const probe = document.createElement("div");
  probe.className = "glass-surface";
  probe.style.position = "fixed";
  probe.style.top = "-9999px";
  document.body.appendChild(probe);
  const reference = getComputedStyle(probe);

  const out: SurfaceCheck[] = [];
  // The surfaces that are the shared glass recipe and nothing else. The pane's action bar is
  // deliberately not one of them any more: S5 made the pane a `vaul` drawer below 900, the bar is
  // that drawer's chrome row (`variant="chrome"`, no material of its own) and a `.glass-surface`
  // inside the drawer's own glass field is the ACCENT §4.4 nesting. What it *is* is asserted in
  // `readGlassStack` above, which reports what the browser painted rather than what the class says.
  const selectors = [".sheet", ".confirm-prompt", ".context-menu", ".bottom-bar__piece"];
  for (const sel of selectors) {
    const found = Array.from(document.querySelectorAll(sel));
    let glass = found.length > 0;
    let recipe = found.length > 0;
    const detail: string[] = [];
    for (const el of found) {
      const style = getComputedStyle(el);
      if (!el.classList.contains("glass-surface") || el.getAttribute("data-glass-slot") === null) {
        glass = false;
        detail.push(`${el.className} is not a glass-surface`);
      }
      if (
        style.backgroundColor !== reference.backgroundColor ||
        style.backdropFilter !== reference.backdropFilter
      ) {
        recipe = false;
        detail.push(`${el.className} declares its own material`);
      }
    }
    out.push({ sel, count: found.length, glass, recipe, detail: detail.join("; ") });
  }
  probe.remove();
  return out;
}

interface TypeReading {
  fontSize: string;
  lineHeight: string;
}

/** Runs in the page (same constraints as readGlassStack). */
function readBodyType(): TypeReading {
  const el = document.querySelector(".thread-screen__item p");
  if (el === null) return { fontSize: "missing", lineHeight: "missing" };
  const style = getComputedStyle(el);
  return { fontSize: style.fontSize, lineHeight: style.lineHeight };
}

/** Where the sheet's arrival is written, which is what changed under S5. Before it, `.sheet` was an
 *  animated panel and this read its `animation-name` — `sheet-in`, which the preference swapped for
 *  `fade-in`. Now it is a `vaul` drawer with snap points, and such a drawer arrives on the
 *  `transition: transform .5s …` that `vaul`'s own injected stylesheet puts on every
 *  `[data-vaul-drawer]`: the element mounts a viewport below and *travels* to the snap point. So the
 *  preference is read where it is written — the duration of that travel — and the animation name is
 *  carried along for the note, because the drawer's blocks turn it off on purpose (an animation and
 *  a transition on one transform is the double-animation the S5 block exists to prevent).
 *
 *  Milliseconds, and only the transform's share: a duration list is per property, and summing the
 *  whole list would count a property that does not move. */
function readSheetMotion(): { animation: string; property: string; travel: number } {
  const el = document.querySelector(".sheet");
  if (el === null) return { animation: "missing", property: "missing", travel: Number.NaN };
  const style = getComputedStyle(el);
  const properties = style.transitionProperty.split(",").map((s) => s.trim());
  const durations = style.transitionDuration.split(",").map((s) => s.trim());
  const at = properties.indexOf("transform");
  const raw = at === -1 ? "0s" : (durations[at] ?? "0s");
  const ms = raw.endsWith("ms") ? Number.parseFloat(raw) : Number.parseFloat(raw) * 1000;
  return { animation: style.animationName, property: style.transitionProperty, travel: ms };
}

/** The two measured tiers plus the boundaries either side of 900 and 1280, where the pane changes
 *  shape. 1100 is the width the rejected pass was caught at. */
const WIDTHS = [1440, 1280, 1100, 1024, 900, 899, 768, 390];

/** Runs in the page (same constraints as readGlassStack). The pane's bar is right-aligned over the
 *  scrolling body and the sender's date is right-aligned to the same edge, so the one geometric
 *  question the material map cannot answer is whether the bar — and the shadow it casts down the
 *  page — lands on the header. `--shadow-glass` is `0 8px 24px`, so its reach past the box is the
 *  y-offset plus half the blur; both numbers are read off the token rather than restated, so a
 *  retuned shadow moves the requirement with it.
 *
 *  Only the tier where the bar *is* the glass casts that shadow. At 900–1279.98 it drops the
 *  material and becomes the sheet's chrome row (ThreadToolbar's `variant="chrome"`), and a chrome
 *  row owes the header no more than not overlapping it — so the requirement there is zero and the
 *  same helper serves both tiers. */
function readHeaderClearance(): { gap: number; needs: number; glass: boolean } {
  const bar = document.querySelector(".thread-toolbar--pane");
  const header = document.querySelector(".thread-header__sender");
  if (bar === null || header === null) return { gap: Number.NaN, needs: Number.NaN, glass: false };
  // The clearance is a requirement of the *rest* position: pinned over a message that has been
  // scrolled up is the behaviour §c.5 asks for. So the pane's scroller is put back at the top before
  // the boxes are read — whichever element the current tier made the scroller.
  let node: Element | null = bar.parentElement;
  while (node !== null) {
    if (node.scrollHeight > node.clientHeight) {
      node.scrollTop = 0;
      break;
    }
    node = node.parentElement;
  }
  let needs = 0;
  const glass = bar.classList.contains("glass-surface");
  if (glass) {
    const shadow = getComputedStyle(document.documentElement).getPropertyValue("--shadow-glass");
    for (const layer of shadow.split(",")) {
      const parts = layer.trim().split(/\s+/);
      const y = Number.parseFloat(parts[1] ?? "0");
      const blur = Number.parseFloat(parts[2] ?? "0");
      if (Number.isFinite(y) && Number.isFinite(blur)) {
        needs = Math.max(needs, Math.max(0, y) + blur / 2);
      }
    }
  }
  return {
    gap: header.getBoundingClientRect().top - bar.getBoundingClientRect().bottom,
    needs,
    glass,
  };
}

/** Runs in the page (same constraints as readGlassStack). §c.7's cluster arrives on hover, and
 *  "did it arrive" is the wrong question to put to it: the pill is a *child* of the cluster, and a
 *  child's `opacity` is its own, so the cluster can be fully revealed while the pill inside it still
 *  computes `opacity: 0; pointer-events: none` — which is what shipped out of 7a02ecd and what
 *  phase A's A-archive spent its whole 90s budget trying to click. The material map could not see
 *  it either, because nothing about the pill's colour is wrong. So this reads the browser's own hit
 *  test: what would a click at the pill's centre land on, and can the pill receive one at all. */
function readHoverCluster(): { at: string | null; opacity: string; pointerEvents: string } {
  const row = document.querySelector(".inbox-row");
  const pill = row === null ? null : row.querySelector(".inbox-row__action");
  if (pill === null) return { at: null, opacity: "missing", pointerEvents: "missing" };
  const rect = pill.getBoundingClientRect();
  const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  const style = getComputedStyle(pill);
  return {
    at: hit === null ? null : `${hit.tagName.toLowerCase()}.${String(hit.className)}`,
    opacity: style.opacity,
    pointerEvents: style.pointerEvents,
  };
}

async function openThread(page: Page): Promise<void> {
  await page.locator(".inbox-row").first().click();
  await page.mouse.move(2, 2);
  await page.locator('[data-testid="detail-pane"]').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(500);
}

test("US-D09 surfaces (nested glass, surface material, type scale)", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector(".inbox-row", { timeout: 60_000 });
  await page.waitForTimeout(2500);
  await openThread(page);

  // §c.7's cluster, at the width the acceptance frames are shot at — the same 1440 the loop starts
  // with. The row is hovered rather than focused: hover is the reveal a pointer gets.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForTimeout(400);
  await check("the row's hover cluster is what a click lands on at 1440px (§c.7)", async () => {
    await page.locator(".inbox-row").first().hover();
    const { at, opacity, pointerEvents } = await page.evaluate(readHoverCluster);
    expect(at, "no .inbox-row__action was found in the first row").not.toBeNull();
    expect(at, `a click at the pill's centre lands on ${String(at)}`).toContain(
      "inbox-row__action",
    );
    expect(pointerEvents, "the pill cannot receive the click it is drawn for").not.toBe("none");
    expect(Number(opacity), `the revealed pill computes opacity ${opacity}`).toBe(1);
    return `a click lands on ${String(at)}, opacity ${opacity}, pointer-events ${pointerEvents}`;
  });

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(600);
    await check(`no glass layer sits on another at ${width}px (§4.4/§e guard 4)`, async () => {
      const layers = await page.evaluate(readGlassStack);
      const nested = layers.filter((l) => l.glassAncestor !== null);
      expect(
        nested,
        nested.map((l) => `${l.el} inside ${String(l.glassAncestor)}`).join(", "),
      ).toEqual([]);
      return `${layers.length} glass layers, 0 nested`;
    });

    // >=900 is the only tier with a clearance to measure: 900–1279.98 draws the bar as the sheet's
    // chrome row (no material, nothing to cast) and below 900 the pane is a `vaul` drawer whose own
    // chrome row is the same shape — the band `--shadow-glass` needs exists only where the bar is
    // the glass itself.
    if (width >= 900) {
      await check(`the pane's bar clears the header at rest at ${width}px (§c.5)`, async () => {
        const { gap, needs, glass } = await page.evaluate(readHeaderClearance);
        expect(Number.isFinite(gap), "the pane's bar or the sender block was not on screen").toBe(
          true,
        );
        expect(
          gap,
          `the bar's box leaves ${gap.toFixed(1)}px, and its shadow needs ${needs}px`,
        ).toBeGreaterThanOrEqual(needs);
        return `${gap.toFixed(1)}px clear, ${glass ? "glass" : "chrome"} needs ${needs}px`;
      });
    }
  }

  // The D9 chrome surfaces, at the widths they actually render at: the bottom bar exists below 900,
  // the sheet and the popover at every width.
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.waitForTimeout(600);
  // S5: the open thread is a modal `vaul` drawer at this tier, and Radix puts `pointer-events: none`
  // on everything outside the drawer — so the BottomBar's Filters circle cannot be pressed until the
  // thread sheet is down. (The press would land on the scrim, which is a click outside: the drawer
  // would close and the sheet would never open.)
  await page.keyboard.press("Escape");
  await page.locator("[data-vaul-drawer].app-shell__detail").waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Filters" }).click();
  await page.getByRole("dialog", { name: "Filters" }).waitFor({ timeout: 10_000 });
  await page.waitForTimeout(400);

  await check(
    "the D9 chrome surfaces are the shared glass, with no fill of their own",
    async () => {
      const surfaces = await page.evaluate(readSurfaces);
      const sheet = surfaces.find((s) => s.sel === ".sheet");
      const bar = surfaces.find((s) => s.sel === ".bottom-bar__piece");
      expect(sheet?.count, "the Filters sheet did not render").toBeGreaterThan(0);
      expect(bar?.count, "the BottomBar did not render at 390").toBeGreaterThan(0);
      for (const surface of surfaces) {
        if (surface.count === 0) continue;
        expect(surface.glass, `${surface.sel}: ${surface.detail}`).toBe(true);
        expect(surface.recipe, `${surface.sel}: ${surface.detail}`).toBe(true);
      }
      return surfaces
        .filter((s) => s.count > 0)
        .map((s) => `${s.sel}×${s.count}`)
        .join(", ");
    },
  );

  await check("the sheet arrives without moving under reduced motion (§c.6)", async () => {
    const moving = await page.evaluate(readSheetMotion);
    expect(
      moving.travel,
      `the sheet has no travel to speak of at rest: ${JSON.stringify(moving)}`,
    ).toBeGreaterThan(0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForTimeout(300);
    const still = await page.evaluate(readSheetMotion);
    expect(still.travel, `the sheet still travels under reduce: ${JSON.stringify(still)}`).toBe(0);
    await page.emulateMedia({ reducedMotion: null });
    return `${String(moving.travel)}ms travel → 0ms under reduce (animation ${moving.animation})`;
  });

  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // The pane again for the two checks below. Opening the Filters sheet is what closed it — the
  // thread sheet had to be down for that press (see above) — and a row press is how the shell opens
  // a thread at every tier. Its exit is waited for by the class rather than by a duration: while the
  // sheet is still mounted its overlay is the topmost element on screen, and the click would be a
  // press on the scrim.
  await page.locator(".sheet").waitFor({ state: "detached", timeout: 10_000 });
  await page.locator(".inbox-row").first().click();
  await page.mouse.move(2, 2);
  await page.locator('[data-testid="detail-pane"]').waitFor({ timeout: 15_000 });
  await page.waitForTimeout(400);

  // §c.5/§c.8's body scale: 15px at the desk, 17px at arm's length, 1.5 in both.
  for (const [width, expected] of [
    [1440, "15px"],
    [390, "17px"],
  ] as const) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(600);
    await check(`the detail body measures ${expected}/1.5 at ${width}px (§b.4)`, async () => {
      const type = await page.evaluate(readBodyType);
      expect(type.fontSize).toBe(expected);
      const size = Number.parseFloat(type.fontSize);
      const line = Number.parseFloat(type.lineHeight);
      expect(line / size).toBeCloseTo(1.5, 2);
      return `${type.fontSize} / ${type.lineHeight}`;
    });
  }

  // The rows above are *recorded*, not thrown — that is what fills `.tmp/assertions.json`, and it is
  // the shape the other specs use. On its own it would also mean this file reports green whatever it
  // measured, which is the exact failure mode it was written to end: the rejected pass satisfied a
  // green suite while a glass capsule sat on a glass sheet. So the recorded rows are also gated.
  const failed = results.filter((r) => !r.ok);
  expect(failed, failed.map((r) => `${r.name}: ${String(r.note)}`).join(" | ")).toEqual([]);
});
