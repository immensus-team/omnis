// Rasterises apps/web/public/icon.svg — the omnis mark — into every PNG size the app ships.
// Run: pnpm tsx tools/e2e/rasterize-mark.ts   (no server and no database; it opens a blank page
// and leaves it there, so it is safe to run while a stack is up.)
//
// One-off, kept because the mark will change again and there is no build step that could do it
// instead: apps/web/public/*.png are served as-is by Vite and packages/ui/src/assets/brands/*.png
// are bundled by Vite, so both are assets in the repo rather than outputs of a pipeline. Editing
// icon.svg and forgetting to re-run this ships an app whose icon and whose rail mark are the old
// artwork — the same class of bug as the stale vendored CSS the R1 loop started with, which is why
// this prints what it wrote and checks each file's real pixel size before it exits.
//
// Two destinations, one source of truth:
//   packages/ui/src/assets/brands/system@1x.png (64) and @2x.png (128)
//     The "system" channel's rail mark. L-33: it used to be a gear identical to the Settings gear
//     at the foot of the same rail, so the channel now carries omnis's own mark. These two
//     OVERWRITE the gear artwork; system@1x/@2x are the only entries in CHANNEL_BRAND_ASSET whose
//     subject is omnis rather than a third party (row-meta.ts), which is the reason the file is
//     generated from our own SVG instead of sourced like the other eight.
//   apps/web/public/apple-touch-icon.png (180), icon-192.png, icon-512.png
//     The install set. 180 is the size iOS asks for; 192/512 are the two the manifest names.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { REPO_ROOT } from "./stack.js";

const SOURCE_SVG = join(REPO_ROOT, "apps/web/public/icon.svg");
const BRANDS = join(REPO_ROOT, "packages/ui/src/assets/brands");
const PUBLIC = join(REPO_ROOT, "apps/web/public");

/** Exactly the sizes named above, and named once: the TARGETS table is the whole spec of what this
 *  script produces, so adding a size is one line. */
const TARGETS = [
  { path: join(BRANDS, "system@1x.png"), size: 64 },
  { path: join(PUBLIC, "apple-touch-icon.png"), size: 180 },
  { path: join(PUBLIC, "icon-192.png"), size: 192 },
  { path: join(PUBLIC, "icon-512.png"), size: 512 },
  { path: join(BRANDS, "system@2x.png"), size: 128 },
] as const;

/** The width and height out of a PNG's IHDR, which is always the first chunk: 8 bytes of signature,
 *  4 of length, 4 of type ("IHDR"), then width and height as big-endian uint32. Read back from the
 *  file rather than trusted from the viewport, because the failure this catches is a screenshot
 *  that silently came out at the wrong size. */
function pngSize(png: Buffer): { width: number; height: number } {
  const type = png.subarray(12, 16).toString("ascii");
  if (type !== "IHDR") throw new Error(`not a PNG: the first chunk is "${type}"`);
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

const svg = readFileSync(SOURCE_SVG, "utf8");
// The inline SVG keeps its own viewBox (0 0 512 512) and takes the viewport's size from this rule —
// so every size below is the same artwork scaled, not a crop, and the 115/512 corner radius scales
// with it. A transparent page background is what `omitBackground` leaves transparent: the ink tile
// has rounded corners, so the corners of every PNG here are genuinely empty rather than white.
const PAGE = `<style>html, body { margin: 0; padding: 0 } svg { display: block; width: 100vw; height: 100vh }</style>${svg}`;

const browser = await chromium.launch();
try {
  for (const { path, size } of TARGETS) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    await page.setContent(PAGE);
    const png = await page.screenshot({ omitBackground: true });
    await page.close();

    const written = pngSize(png);
    if (written.width !== size || written.height !== size) {
      throw new Error(`${path} came out ${written.width}x${written.height}, not ${size}x${size}`);
    }
    writeFileSync(path, png);
    console.log(`${size}x${size}  ${path.slice(REPO_ROOT.length + 1)}  (${png.length} bytes)`);
  }
} finally {
  await browser.close();
}
