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
  const selectors = [
    ".sheet",
    ".confirm-prompt",
    ".context-menu",
    ".thread-toolbar--floating",
    ".bottom-bar__piece",
  ];
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

/** Runs in the page (same constraints as readGlassStack). */
function readSheetMotion(): string {
  const el = document.querySelector(".sheet");
  if (el === null) return "missing";
  return getComputedStyle(el).animationName;
}

/** The two measured tiers plus the boundaries either side of 900 and 1280, where the pane changes
 *  shape. 1100 is the width the rejected pass was caught at. */
const WIDTHS = [1440, 1280, 1100, 1024, 900, 899, 768, 390];

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
  }

  // The three D9 chrome surfaces, at the widths they actually render at: the action bar and the
  // bottom bar exist below 900, the sheet and the popover at every width.
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "Filters" }).click();
  await page.getByRole("dialog", { name: "Filters" }).waitFor({ timeout: 10_000 });
  await page.waitForTimeout(400);

  await check(
    "the D9 chrome surfaces are the shared glass, with no fill of their own",
    async () => {
      const surfaces = await page.evaluate(readSurfaces);
      const bar = surfaces.find((s) => s.sel === ".thread-toolbar--floating");
      const sheet = surfaces.find((s) => s.sel === ".sheet");
      expect(bar?.count, "the action bar did not render at 390").toBeGreaterThan(0);
      expect(sheet?.count, "the Filters sheet did not render").toBeGreaterThan(0);
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
    const animated = await page.evaluate(readSheetMotion);
    expect(animated, "the sheet animates under the default preference").not.toBe("fade-in");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForTimeout(300);
    expect(await page.evaluate(readSheetMotion)).toBe("fade-in");
    await page.emulateMedia({ reducedMotion: null });
    return `${animated} → fade-in under reduce`;
  });

  await page.keyboard.press("Escape");
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
