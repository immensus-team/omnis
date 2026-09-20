// US-D06 §4.2/§5.2: where the aurora is allowed to be, and where it may never be.
//
// §4.2 is a list of forbidden surfaces — inbox rows, message bodies, draft cards, tables, buttons,
// inputs and everything inside react-virtuoso — and a list of forbidden surfaces is exactly the kind
// of rule that erodes: the next person adds colour to "the empty state" or "the selected row" and
// nothing anywhere says no. So this spec asserts the allow-list instead. Every `.aurora` in the
// document has to be one of the three named surfaces of §3.2; an aurora anywhere else fails, whether
// or not §4.2 happened to name that particular place. The row and message-body checks spell the same
// rule the way §4.2 spells it, so a failure says which forbidden surface it found.
//
// The stack was already brought up by tools/e2e/run.ts.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Page, expect, test } from "@playwright/test";
import { assertNoOverflow, describeOverflow, measureOverflow } from "./overflow.js";

const E2E_DIR = new URL(".", import.meta.url).pathname;

interface Assertion {
  name: string;
  ok: boolean;
  ms: number;
  note?: string;
}
const results: Assertion[] = [];

async function check(name: string, fn: () => Promise<string | undefined>): Promise<void> {
  const started = Date.now();
  try {
    const note = await fn();
    results.push({ name, ok: true, ms: Date.now() - started, ...(note ? { note } : {}) });
  } catch (e) {
    results.push({
      name,
      ok: false,
      ms: Date.now() - started,
      note: e instanceof Error ? e.message.split("\n")[0] : String(e),
    });
  }
}

/** run.ts zeroes `.tmp/assertions.json` before the run, and both specs append to it: this one and
 *  phase-a.spec.ts each read the file, add their own list and write it back. Appending rather than
 *  writing is what keeps the two from clobbering each other — with `workers: 1` the files run one
 *  after another, so this read-modify-write is the whole synchronisation it needs. (This spec runs
 *  first; if phase-a were ever changed back to a plain write it would take these rows with it.) */
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

/** §3.2's surface map, as class tokens. Exactly these three, and nothing else, may carry `.aurora`. */
const ALLOWED_SURFACES = ["channel-rail__aurora", "ask-panel", "onboarding"];

interface AuroraInfo {
  variant: string | null;
  classes: string;
  /** The first §4.2 surface this aurora sits inside, or null if it sits outside all of them. */
  forbiddenAncestor: string | null;
  /** The nearest ancestor carrying a `filter`, or null. §2.4: that forms a backdrop root and kills
   *  every descendant `backdrop-filter` without an error. */
  filteredAncestor: string | null;
  /** The aurora wrapper's own computed filter — must be `none` for the same reason. */
  filter: string;
  hasGlassClass: boolean;
}

/** Runs in the page. A top-level `function`, and its body holds no nested function expressions:
 *  this source is shipped to the page, where a `__name(...)` wrapper injected by the TS transform's
 *  `keepNames` has nothing to bind to (overflow.ts's header records the same trap). */
function readAuroras(): AuroraInfo[] {
  // §4.2's forbidden surfaces. Declared here rather than at module scope because `page.evaluate`
  // ships this function's *source* to the page, where nothing outside the body exists — a module
  // const reads as `ReferenceError: FORBIDDEN_SURFACES is not defined` and takes every check that
  // calls this function down with it. Each is tested with `closest`, so an aurora nested anywhere
  // inside one is caught, not just a direct child.
  const forbiddenSurfaces = [
    ".inbox-row",
    "[role='option']",
    ".thread-screen__item",
    ".thread-panel",
    ".draft-card",
    ".approval-card",
    ".tool-call-badge",
    ".row-hover-card",
    ".key-value-table",
  ];
  const out: AuroraInfo[] = [];
  for (const el of Array.from(document.querySelectorAll(".aurora"))) {
    let forbidden: string | null = null;
    for (const sel of forbiddenSurfaces) {
      if (el.closest(sel) !== null) {
        forbidden = sel;
        break;
      }
    }
    let filtered: string | null = null;
    for (let p = el.parentElement; p !== null; p = p.parentElement) {
      if (getComputedStyle(p).filter !== "none") {
        filtered = `${p.tagName.toLowerCase()}.${p.className}`;
        break;
      }
    }
    const cs = getComputedStyle(el);
    out.push({
      variant: el.getAttribute("data-aurora"),
      classes: el.className,
      forbiddenAncestor: forbidden,
      filteredAncestor: filtered,
      filter: cs.filter,
      hasGlassClass: el.classList.contains("glass-surface"),
    });
  }
  return out;
}

interface MassInfo {
  variant: string | null;
  filter: string;
  display: string;
}

/** Runs in the page, for the same reason as readAuroras. Every `.aurora__mass`'s own computed filter
 *  and display. No callback inside this body — see readAuroras. */
function readMassFilters(): MassInfo[] {
  const nodes = document.querySelectorAll(".aurora__mass");
  const out: MassInfo[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    if (el === undefined) continue;
    const cs = getComputedStyle(el);
    const parent = el.parentElement;
    out.push({
      variant: parent === null ? null : parent.getAttribute("data-aurora"),
      filter: cs.filter,
      display: cs.display,
    });
  }
  return out;
}

interface RailAurora {
  /** The wrapper's own computed display. `contents` is the narrow tier's arrangement: the box is
   *  dissolved so the wrapper adds no second glass layer to the bar. */
  wrapperDisplay: string;
  /** True when the wrapper does keep a box and that box is the clip — `.aurora`'s own
   *  `position: relative; overflow: hidden`. The other safe arrangement. */
  clipsOwnBox: boolean;
  /** `.aurora::before`, `.aurora::after`, `.aurora__mass`, `.aurora__grain` — all four layers of the
   *  recipe in tokens.css, named so a failure says which one is still painting. */
  layerNames: string[];
  layerDisplays: string[];
}

/** Runs in the page, for the same reason as readAuroras. The rail's aurora wrapper and the four
 *  layers of the texture recipe it owns.
 *
 *  The defect this exists for: all four layers are `position: absolute`, so each one needs a
 *  *positioned* containing block that clips it. In the narrow tier the wrapper is `display: contents`
 *  (app.css's `@container shell (max-width: 899.98px)` block) to keep a second glass layer off the
 *  bar — but `display: contents` does not retire the layers along with the box. It promotes the
 *  element's children *and* its `::before` / `::after` into the parent's box tree, where the nearest
 *  positioned ancestor is `.channel-rail`: `position: fixed`, full width. A `::before` left live
 *  there resolves against the whole bar. Measured on the un-fixed CSS at 390 and 768: wrapper
 *  display=contents, `::before` display=block, opacity=0.34, filter=blur(6px), containing block
 *  `.channel-rail` at 390x57 — a butter-to-peach radial washing the full width of the bottom bar,
 *  with `::after`'s vignette fading back over it. That is §3.2's surface map broken: the aurora
 *  belongs to the rail plate's own footprint (ACCENT-DIRECTION.md §4.1.1, "no bleed").
 *
 *  The child spans are read with `querySelector` and report `absent` when missing, so that deleting
 *  one of them is a failure too rather than a silent pass. */
function readRailAurora(): RailAurora | null {
  const rail = document.querySelector(".aurora.channel-rail__aurora");
  if (rail === null) return null;
  const cs = getComputedStyle(rail);
  const layerNames = [".aurora::before", ".aurora::after", ".aurora__mass", ".aurora__grain"];
  const layerDisplays = [
    getComputedStyle(rail, "::before").display,
    getComputedStyle(rail, "::after").display,
  ];
  for (const sel of [".aurora__mass", ".aurora__grain"]) {
    const el = rail.querySelector(sel);
    layerDisplays.push(el === null ? "absent" : getComputedStyle(el).display);
  }
  return {
    wrapperDisplay: cs.display,
    clipsOwnBox: cs.position === "relative" && cs.overflow === "hidden",
    layerNames: layerNames,
    layerDisplays: layerDisplays,
  };
}

interface GlassInfo {
  classes: string;
  backdropFilter: string;
}

/** Runs in the page, for the same reason as readAuroras. */
function readAuroraGlass(): GlassInfo[] {
  const out: GlassInfo[] = [];
  for (const el of Array.from(document.querySelectorAll(".aurora .glass-surface"))) {
    out.push({ classes: el.className, backdropFilter: getComputedStyle(el).backdropFilter });
  }
  return out;
}

/** Runs in the page, for the same reason as readAuroras. Every US-D06 surface box that lays out past
 *  the right edge, as `tag.class +Npx`. The bleed layers are deliberately absent: `.aurora` clips
 *  them by design (§2.3), so they are never the thing that grows the page. The row-hover-card is the
 *  one `.glass-surface` excluded — it is a pointer-following Radix preview (inbox-row.tsx), not a
 *  surface this story placed, and below 900px it is anchored `side="right"` of a full-width row, so
 *  it sits past the edge whenever it is open at all (x=376 at 390px). */
function readSurfaceOverflow(): string[] {
  const vw = document.documentElement.clientWidth;
  const out: string[] = [];
  for (const el of Array.from(
    document.querySelectorAll(".aurora, .glass-surface:not(.row-hover-card)"),
  )) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right - vw <= 0) continue;
    const first = typeof el.className === "string" ? el.className.trim().split(/\s+/)[0] : "";
    out.push(`${el.tagName.toLowerCase()}.${first} +${String(Math.round(r.right - vw))}px`);
  }
  return out;
}

/** The narrow shell's own surfaces, read on BOTH edges. `measureOverflow` cannot see the left one:
 *  its element scan is `rect.right - vw` (overflow.ts's header says so), and reading 1 is
 *  `scrollWidth - clientWidth`, which a box hanging off the leading edge does not grow either — the
 *  leading overflow is simply clipped by the viewport with both numbers at 0. The defects this
 *  catches are therefore invisible to every other probe in this file.
 *
 *  `.app-shell__detail` is the worked example, and it is why this exists: at ≤1279.98 it is
 *  `position: fixed; right: 16px; width: calc(100% - 32px); padding: 16px`. Under `content-box` —
 *  app.css has no global border-box reset — that width excluded the padding and the border, so the
 *  sheet laid out 34px wider than the margins it asked for and hung off the left edge of the
 *  viewport, clipping its own header and body text at x=0 while `diff` stayed 0 and the element scan
 *  reported nothing. The first captures of §5.1's screens 1, 2, 4 at 390 were all that sheet.
 *
 *  `:scope` boxes only, on purpose: a child at a negative x inside a box that is itself on screen is
 *  a different question (and several of them are legitimate — the aurora bleeds out of its clipper
 *  by design, §2.3). */
function readEdgeOverhang(): string[] {
  const vw = document.documentElement.clientWidth;
  const out: string[] = [];
  for (const el of Array.from(document.querySelectorAll(".app-shell__detail, .ask-panel"))) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const first = typeof el.className === "string" ? el.className.trim().split(/\s+/)[0] : "";
    if (r.left < 0) {
      out.push(
        `${el.tagName.toLowerCase()}.${first} ${String(Math.round(r.left))}px past the left edge`,
      );
    }
    if (r.right - vw > 0) {
      out.push(`${el.tagName.toLowerCase()}.${first} +${String(Math.round(r.right - vw))}px`);
    }
  }
  return out;
}

/** Runs in the page, for the same reason as readAuroras. Every element inside the onboarding aurora
 *  that holds its own text node and is NOT inside the scrim card — §5.3 guard 4 says there should be
 *  none, because the screen is far past the 40-word threshold. */
function readStrayText(): string[] {
  const aurora = document.querySelector(".onboarding");
  const card = document.querySelector(".onboarding__card");
  const out: string[] = [];
  if (aurora === null || card === null) return ["onboarding aurora or scrim card missing"];
  for (const el of Array.from(aurora.querySelectorAll("*"))) {
    if (card.contains(el)) continue;
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "") {
        out.push(`${el.tagName.toLowerCase()}.${el.className}`);
        break;
      }
    }
  }
  return out;
}

test.describe("US-D06 aurora surface map", () => {
  test("the shell's aurora, and nothing else", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("option").first()).toBeVisible({ timeout: 30_000 });

    await check("only the rail carries an aurora when the ask panel is closed", async () => {
      const surfaces = await page.evaluate(readAuroras);
      const names = surfaces.map((s) => s.classes).join(", ");
      expect(surfaces, `found ${String(surfaces.length)}: ${names}`).toHaveLength(1);
      expect(surfaces[0]?.variant).toBe("mist");
      expect(surfaces[0]?.classes).toContain("channel-rail__aurora");
      return `1 surface, variant=${String(surfaces[0]?.variant)}`;
    });

    await check("no aurora inside a list row (§4.2)", async () => {
      const inRows = await page.locator(".inbox-row .aurora, [role='option'] .aurora").count();
      expect(inRows).toBe(0);
      // The texture layers are not `.aurora` themselves, so they are named too — a stray grain span
      // inside a row would be just as wrong as a whole surface.
      const layers = await page
        .locator(".inbox-row .aurora__mass, .inbox-row .aurora__grain")
        .count();
      expect(layers).toBe(0);
      return "0 list rows tinted";
    });

    await check("opening the ask panel adds exactly one dawn surface", async () => {
      await page.locator(".ask-bar input").click();
      await expect(page.locator(".ask-panel")).toBeVisible({ timeout: 10_000 });
      const surfaces = await page.evaluate(readAuroras);
      expect(surfaces).toHaveLength(2);
      const panel = surfaces.find((s) => s.classes.includes("ask-panel"));
      expect(panel?.variant).toBe("dawn");
      return `2 surfaces: rail + ${String(panel?.classes)}`;
    });

    await check("every rendered aurora mass still computes blur + drop-shadow (§2.4)", async () => {
      // §5.2 states this one as a console command — `getComputedStyle(document.querySelector(
      // '.aurora__mass')).filter` "must print a blur(...) drop-shadow(...) pair". It is worth a guard
      // and not just a reviewer's click: §2.4 records that both failure modes were hit while building
      // this, and trap 2 (the blur dropped by a nested stacking context) leaves a mass that is still
      // in the DOM, still has every class, and has quietly stopped being soft. `mist` is excluded by
      // its own `display: none` (§3.1: the rail plate is too narrow for a contour), so this asserts
      // over the rendered masses and requires at least one — the ask panel is open here.
      const masses = await page.evaluate(readMassFilters);
      const rendered = masses.filter((m) => m.display !== "none");
      expect(rendered.length, "no rendered aurora mass on this screen").toBeGreaterThan(0);
      const flat = rendered.filter(
        (m) => !(m.filter.includes("blur(") && m.filter.includes("drop-shadow(")),
      );
      expect(flat.map((m) => `${String(m.variant)}: ${m.filter}`)).toEqual([]);
      return `${String(rendered.length)} mass(es) blurred and rimmed; ${String(
        masses.length - rendered.length,
      )} hidden by variant`;
    });

    await check("no aurora inside a message body, thread item or draft card (§4.2)", async () => {
      await page.keyboard.press("Escape");
      await page.getByRole("option").first().click();
      await expect(page.locator(".thread-screen__item").first()).toBeVisible({ timeout: 10_000 });
      const inBody = await page
        .locator(
          ".thread-screen__item .aurora, .thread-panel .aurora, .draft-card .aurora, .approval-card .aurora, .tool-call-badge .aurora",
        )
        .count();
      expect(inBody).toBe(0);
      const layers = await page.locator(".thread-screen__item .aurora__grain").count();
      expect(layers).toBe(0);
      return "0 message bodies tinted";
    });

    await check("every aurora is one of §3.2's three surfaces, outside §4.2's list", async () => {
      const surfaces = await page.evaluate(readAuroras);
      for (const s of surfaces) {
        expect(
          s.forbiddenAncestor,
          `.${s.classes} sits inside ${String(s.forbiddenAncestor)}, which §4.2 forbids`,
        ).toBe(null);
        const tokens = s.classes.split(/\s+/);
        const allowed = ALLOWED_SURFACES.filter((a) => tokens.includes(a));
        expect(
          allowed.length,
          `.${s.classes} is not one of the three surfaces in §3.2`,
        ).toBeGreaterThan(0);
      }
      return `${String(surfaces.length)} surface(s) checked against the §3.2 allow-list`;
    });

    await check("no element carries both .aurora and .glass-surface (§2.7)", async () => {
      const surfaces = await page.evaluate(readAuroras);
      expect(surfaces.filter((s) => s.hasGlassClass).map((s) => s.classes)).toEqual([]);
      return "0 collisions";
    });

    await check("no aurora, or its ancestor, carries a filter (§2.4)", async () => {
      // `filter` on an ancestor forms a backdrop root and silently kills every descendant
      // `backdrop-filter`: the glass inside would stop blurring the canvas. The wrapper itself must
      // therefore compute `filter: none` — the blur belongs on the layers, never on the plate.
      const surfaces = await page.evaluate(readAuroras);
      const bad = surfaces.filter((s) => s.filter !== "none" || s.filteredAncestor !== null);
      expect(
        bad.map((s) => `${s.classes} (own=${s.filter}, ancestor=${String(s.filteredAncestor)})`),
      ).toEqual([]);
      return "every wrapper computes filter: none, no filtered ancestor";
    });

    await check("the glass inside an aurora is still glass (§4.4)", async () => {
      // The counterweight to the check above: proving nothing disabled the blur is only half the
      // evidence — the plates behind an aurora must still actually blur something.
      const plates = await page.evaluate(readAuroraGlass);
      expect(plates.length).toBeGreaterThan(0);
      const flat = plates.filter((p) => !p.backdropFilter.includes("blur("));
      expect(flat.map((p) => p.classes)).toEqual([]);
      return `${String(plates.length)} glass plate(s) blurring inside an aurora`;
    });
  });

  /** §5.2's mobile gate, run once per §5.1 screen. The brief says "every one of screens 1-4 must
   *  pass it", and one screen's pass is not evidence for another's: the ask panel adds a 420px-wide
   *  absolutely-positioned box and the agents filter adds a chip to a row that wraps, and either can
   *  be the thing that pushes the page sideways. Each screen gets its own test so it gets a fresh
   *  page and the config's per-test budget — twenty measurements is more than one test can hold.
   *
   *  Screen 3 (onboarding) sweeps inside the other test below; it is a full mount, not a shell state. */
  async function sweepWidths(page: Page, screen: string): Promise<string> {
    const notes: string[] = [];
    for (const width of [320, 375, 390, 414, 768]) {
      await page.setViewportSize({ width, height: 900 });
      // Park the pointer on the rail — the bottom-left corner, which is rail in both shells and
      // never over a list row — so the hover preview is not open while the page is measured.
      // shots.ts parks the pointer the same way. It has to be re-parked *after* each resize: at
      // (2, 2) the narrow shells put the inbox card under the pointer. The wait is best-effort on
      // purpose and its result is not asserted: below 900px the preview does not reliably close
      // on a programmatic pointer move (it stayed open past a 5s wait), and it is excluded from
      // the scan below anyway — this only keeps the reported note readable.
      await page.mouse.move(2, 898);
      await page
        .locator(".row-hover-card")
        .waitFor({ state: "hidden", timeout: 1000 })
        .catch(() => undefined);
      await page.waitForTimeout(120);
      const overflow = await page.evaluate(measureOverflow);
      // The brief's item is "no horizontal scroll at 320 / 375 / 414 / 768" — that is reading 1.
      // `assertNoOverflow` additionally fails on *any* element past the edge, and at 414px a
      // pre-existing clipped box trips it on both sides of this story (the filter chip bar's add
      // button, 18px, which overflow.ts's header explains it deliberately still reports). So the
      // gate is asserted, the element scan is asserted for the boxes this story owns, and
      // anything else is reported in the note rather than failing a D6 guard.
      expect(
        overflow.diff,
        `screen ${screen} at ${String(width)}px: ${describeOverflow(overflow)}`,
      ).toBe(0);
      const stray = await page.evaluate(readSurfaceOverflow);
      expect(
        stray,
        `aurora surface past the edge on screen ${screen} at ${String(width)}px`,
      ).toEqual([]);
      const overhang = await page.evaluate(readEdgeOverhang);
      expect(
        overhang,
        `the sheet or the ask panel is off an edge on screen ${screen} at ${String(width)}px`,
      ).toEqual([]);
      // US-D06 fix: all four of the committed 390 captures (screens 1 and 2, the palette, the agents
      // filter) had a warm bloom under the rail's tiles — the rail aurora's two pseudo-elements,
      // still generating boxes after `display: contents` dissolved their wrapper (readRailAurora's
      // header has the measurement). This is the guard. There are two safe arrangements and no
      // third: the wrapper keeps a box and that box is the clip, or the wrapper is dissolved and all
      // four of its layers are off. Anything else paints the aurora outside the rail's footprint.
      const railAurora = await page.evaluate(readRailAurora);
      expect(railAurora, "the rail's aurora wrapper is not in the document").not.toBeNull();
      if (railAurora !== null) {
        if (railAurora.wrapperDisplay === "contents") {
          const live: string[] = [];
          for (let i = 0; i < railAurora.layerNames.length; i++) {
            const display = railAurora.layerDisplays[i];
            if (display !== "none") {
              live.push(`${String(railAurora.layerNames[i])} (display: ${String(display)})`);
            }
          }
          expect(
            live,
            `screen ${screen} at ${String(width)}px: the rail wrapper is display: contents but ${String(
              live.length,
            )} of its four aurora layers still generate a box — each one resolves against the fixed, full-width .channel-rail instead of the plate`,
          ).toEqual([]);
        } else {
          expect(
            railAurora.clipsOwnBox,
            `screen ${screen} at ${String(width)}px: the rail aurora keeps a box (display: ${
              railAurora.wrapperDisplay
            }) but is not the clip (position: relative + overflow: hidden), so its layers bleed`,
          ).toBe(true);
        }
      }
      let railNote = "rail aurora: wrapper keeps its own clip";
      if (railAurora !== null && railAurora.wrapperDisplay === "contents") {
        let off = 0;
        for (const display of railAurora.layerDisplays) {
          if (display === "none") off += 1;
        }
        railNote = `rail aurora: dissolved, ${String(off)}/${String(
          railAurora.layerNames.length,
        )} layers off`;
      }
      notes.push(`${String(width)}px: ${describeOverflow(overflow)}; ${railNote}`);
    }
    return notes.join("; ");
  }

  test("§5.2's mobile gate, screen 1 — nothing selected", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("option").first()).toBeVisible({ timeout: 30_000 });
    await check("screen 1 (nothing selected)", async () => sweepWidths(page, "1"));
  });

  test("§5.2's mobile gate, screen 2 — the ask panel open", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("option").first()).toBeVisible({ timeout: 30_000 });
    await check("screen 2 (ask panel open)", async () => {
      await page.locator(".ask-bar input").click();
      await expect(page.locator(".ask-panel")).toBeVisible({ timeout: 10_000 });
      return sweepWidths(page, "2");
    });
  });

  test("§5.2's mobile gate, screen 4 — the agents filter", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("option").first()).toBeVisible({ timeout: 30_000 });
    await check("screen 4 (agents filter)", async () => {
      await page.getByRole("button", { name: "Agent" }).click();
      return sweepWidths(page, "4");
    });
  });

  test("the onboarding preview's void surface", async ({ page }) => {
    await page.goto("/?screen=onboarding");
    await expect(page.locator(".onboarding__card")).toBeVisible({ timeout: 30_000 });

    await check("onboarding is a single void surface", async () => {
      const surfaces = await page.evaluate(readAuroras);
      expect(surfaces).toHaveLength(1);
      expect(surfaces[0]?.variant).toBe("void");
      expect(surfaces[0]?.classes).toContain("onboarding");
      return `1 surface, variant=${String(surfaces[0]?.variant)}`;
    });

    await check(
      "every word sits on the scrim card, never on the aurora (§5.3 guard 4)",
      async () => {
        // The screen is well over 40 words, so no text may be a child of the aurora itself.
        const strays = await page.evaluate(readStrayText);
        expect(strays).toEqual([]);
        return "0 text nodes outside the card";
      },
    );

    await check("onboarding does not scroll sideways at the four widths (§5.2)", async () => {
      const notes: string[] = [];
      for (const width of [320, 375, 390, 414, 768]) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(120);
        const overflow = await page.evaluate(measureOverflow);
        assertNoOverflow(`${String(width)}px (onboarding)`, overflow);
        notes.push(`${String(width)}px: ${describeOverflow(overflow)}`);
      }
      return notes.join("; ");
    });
  });

  // The checks above record into `.tmp/assertions.json` for run.ts's report, and `check` swallows the
  // exception — so without this the run would still exit zero with a FAIL in the table. This is the
  // test that makes the file's verdict the run's verdict.
  test("every US-D06 assertion held", () => {
    const failed = results.filter((r) => !r.ok);
    expect(
      failed.map((f) => `${f.name}: ${f.note ?? ""}`),
      `${String(failed.length)} of ${String(results.length)} US-D06 assertions failed`,
    ).toEqual([]);
  });
});
