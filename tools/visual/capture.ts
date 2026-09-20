import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { GALLERY_COMPONENTS } from "../../apps/gallery/src/registry.js";

/** Repo root, derived from this file's location — never hardcoded. */
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const BASE_URL = "http://127.0.0.1:5179/";

/** apps/gallery/src/gallery.css: nav is a fixed 220px column, .gallery-main pads 24px,
 *  .gallery-panes is `1fr 1fr` with a 16px gap. At 1600px wide each pane gets
 *  (1600 - 220 - 48 - 16) / 2 = 658px, so both light/dark panes fit without clipping. */
const VIEWPORT = { width: 1600, height: 1200 };

export interface CaptureResult {
  id: string;
  path: string;
}

export async function captureAll(outDir: string): Promise<CaptureResult[]> {
  fs.mkdirSync(outDir, { recursive: true });

  // detached: the pnpm wrapper spawns vite as its own child, so killing pnpm alone can
  // orphan a vite process still holding port 5179. A new process group lets us kill both.
  // ponytail: SIGTERM only, no SIGKILL escalation — vite exits on SIGTERM.
  const proc = spawn("pnpm", ["--filter", "@omnis/gallery", "dev"], {
    cwd: repoRoot,
    stdio: "pipe",
    detached: true,
  });

  const browser = await chromium.launch();
  try {
    await waitForServer(BASE_URL);

    const page = await browser.newPage({ viewport: VIEWPORT });
    await page.goto(BASE_URL);
    await page.waitForLoadState("networkidle");
    // networkidle says the bundle is fetched, not that React has mounted.
    await page.locator(`#${GALLERY_COMPONENTS[0].id}`).waitFor();

    const results: CaptureResult[] = [];
    for (const { id } of GALLERY_COMPONENTS) {
      const el = page.locator(`#${id}`);
      await el.scrollIntoViewIfNeeded();
      const file = path.join(outDir, `${id}.png`);
      await el.screenshot({ path: file });
      results.push({ id, path: file });

      // The dialog-mode palette is portaled to <body> as a position:fixed overlay, so it is
      // nowhere near #command-palette's bounding box — it needs a shot of its own. Opened only
      // after the section shot (which wants it closed) and closed again so the overlay cannot
      // bleed into the sections captured after this one, since SPA state persists.
      if (id === "command-palette") {
        // Every demo renders twice, once per theme pane, so the button is ambiguous by role
        // alone. The dialog portals to <body>, outside either pane's theme scope, so the light
        // pane's instance is the one to open.
        await page
          .locator("#command-palette .gallery-pane:not([data-theme='dark'])")
          .getByRole("button", { name: "Open ⌘K dialog" })
          .click();
        const dialog = page.locator("[cmdk-dialog]");
        await dialog.waitFor();
        const dialogFile = path.join(outDir, "command-palette-dialog.png");
        await dialog.screenshot({ path: dialogFile });
        results.push({ id: "command-palette-dialog", path: dialogFile });
        // Radix Dialog's Escape handler runs the component's onOpenChange(false).
        await page.keyboard.press("Escape");
        await dialog.waitFor({ state: "hidden" });
      }
    }
    return results;
  } finally {
    await browser.close();
    killGroup(proc);
  }
}

function killGroup(proc: ReturnType<typeof spawn>): void {
  if (proc.pid === undefined) return;
  try {
    process.kill(-proc.pid, "SIGTERM");
  } catch {
    proc.kill();
  }
}

async function waitForServer(url: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // dev server not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`gallery dev server never responded at ${url} (${timeoutMs}ms)`);
}
