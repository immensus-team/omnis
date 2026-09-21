// jsdom does not compute the CSS custom-property cascade (getComputedStyle does not actually apply
// <style> rules), so — the same way tokens.test.ts verifies tokens.ts by value — this reads
// tokens.css as text and checks that ":root" (no attribute) carries the light defaults and
// ':root[data-theme="dark"]' carries the dark ones. (The environment stays the package
// vitest.config.ts default, jsdom: setup.ts always runs as a global setupFile and touches Element,
// so switching to node breaks it.)
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../src/tokens.css"),
  "utf-8",
);

/** Extracts only the ":root {" block (the plain one, with no attribute selector) — it has to be
 *  separated from the ':root[data-theme=...] {' blocks to be sure that "default = light" holds. */
function rootDefaultBlock(source: string): string {
  const start = source.indexOf(":root {");
  const end = source.indexOf("\n}", start);
  return source.slice(start, end);
}

function themeBlock(source: string, theme: string): string {
  const marker = `:root[data-theme="${theme}"] {`;
  const start = source.indexOf(marker);
  const end = source.indexOf("\n}", start);
  return source.slice(start, end);
}

describe("U1 theme default = light (DESIGN-DIRECTION.md: light theme by default)", () => {
  it("the attribute-less :root block ships light values, not dark", () => {
    const block = rootDefaultBlock(css);
    expect(block).toContain("--bg-base: var(--gray-000)");
    expect(block).not.toContain("--bg-base: var(--gray-950)");
  });

  it('dark tokens are still available, gated behind data-theme="dark"', () => {
    const block = themeBlock(css, "dark");
    expect(block).toContain("--bg-base: var(--gray-950)");
  });

  it("there is no default (attribute-less) dark selector left over from the old A5 default", () => {
    expect(css).not.toContain(':root[data-theme="light"]');
  });
});

describe("US-D08 §b.2 canvas backdrop: plain paper, no pattern", () => {
  // The canvas is a flat near-white in both themes. US-D06 removed the peach/mint radials; US-D08
  // removed the faint grid that was left. The film grain `.app-shell::before` paints at 3.5% is the
  // only thing on it, and it is not a `--canvas-grid` layer — so "none" here is the whole assertion,
  // in both blocks. (The alternative — a grid value that merely looks faint — is what guard 1
  // rejects: "if you can point at the background and describe a shape, it fails".)
  it("the light block declares no grid image", () => {
    const block = rootDefaultBlock(css);
    const marker = "--canvas-grid:";
    const grid = block.slice(block.indexOf(marker) + marker.length);
    expect(grid.slice(0, grid.indexOf(";")).trim()).toBe("none");
    expect(block).toContain("--canvas-grid-size:");
  });

  it("the dark block declares no grid image either", () => {
    const block = themeBlock(css, "dark");
    expect(block).toContain("--canvas-grid: none");
    expect(block).toContain("--canvas-grid-size:");
  });

  // The declaration is still read by `body` (app.css), so the token is a live switch rather than
  // dead weight. If the grid ever comes back, both blocks have to say so together — which is the
  // drift these two tests exist to catch.
  it("body still reads the token, so `none` is a switch and not an orphan", () => {
    const appCss = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/desktop/src/app.css"),
      "utf-8",
    );
    expect(appCss).toContain("background-image: var(--canvas-grid);");
  });
});
