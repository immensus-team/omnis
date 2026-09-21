// @vitest-environment jsdom
// The root `pnpm test` (vitest.workspace.ts) does not read packages/ui/vitest.config.ts, so the
// environment and the setup (jest-dom matchers + afterEach(cleanup)) are declared by the file itself.
import "./setup";

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AuroraSurface, type AuroraVariant } from "../src/components/aurora-surface";

/** This test file's own directory — the same cwd-independent read motion.test.tsx uses, because
 *  vitest's transform can leave import.meta.url on a scheme other than file:. */
const TEST_DIR = dirname(new URL(import.meta.url).pathname);
const tokensCss = readFileSync(join(TEST_DIR, "../src/tokens.css"), "utf8");

/** The body of the one @media (prefers-reduced-motion: reduce) block, from the query to the end of
 *  the file (tokens.css keeps it last, apart from the reduced-transparency block after it). */
function reducedMotionBlock(css: string): string {
  const start = css.indexOf("@media (prefers-reduced-motion: reduce)");
  if (start === -1) throw new Error("no prefers-reduced-motion block in tokens.css");
  return css.slice(start);
}

/** From the query to the end of the file: the block is the last media query in tokens.css, and the
 *  rules that answer the same question live at both ends of it. */
function reducedTransparencyBlock(css: string): string {
  const start = css.indexOf("@media (prefers-reduced-transparency: reduce)");
  if (start === -1) throw new Error("no prefers-reduced-transparency block in tokens.css");
  return css.slice(start);
}

describe("US-D06 AuroraSurface variant mapping", () => {
  const VARIANTS: AuroraVariant[] = ["dawn", "mist", "void"];

  it("defaults to dawn and carries both the class and the data attribute", () => {
    render(<AuroraSurface data-testid="plate" />);
    const plate = screen.getByTestId("plate");
    expect(plate).toHaveClass("aurora");
    expect(plate).toHaveAttribute("data-aurora", "dawn");
  });

  it("maps each variant onto data-aurora, which is what the token blocks key off", () => {
    for (const variant of VARIANTS) {
      const { unmount } = render(<AuroraSurface variant={variant} data-testid="plate" />);
      expect(screen.getByTestId("plate")).toHaveAttribute("data-aurora", variant);
      // The variant blocks in tokens.css are `[data-aurora="…"]` — a variant with no block would
      // render an unstyled plate rather than fail, so the pair is asserted here.
      expect(tokensCss).toContain(`[data-aurora="${variant}"] {`);
      unmount();
    }
  });

  it("renders the two layers that need their own opacity, and hides them from the a11y tree", () => {
    const { container } = render(<AuroraSurface variant="void" />);
    const mass = container.querySelector(".aurora__mass");
    const grain = container.querySelector(".aurora__grain");
    expect(mass).not.toBeNull();
    expect(grain).not.toBeNull();
    // Decorative texture: a screen reader announcing "mass" or "grain" would be noise, and the
    // component is used inside role="dialog" panels.
    expect(mass).toHaveAttribute("aria-hidden", "true");
    expect(grain).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps the caller's class alongside .aurora so a two-class override can win", () => {
    // ACCENT-DIRECTION §2.7: per-surface overrides are written `.aurora.my-surface { … }` — (0,2,0),
    // which beats the variant block whatever order the two stylesheets load in. That only works if
    // both classes survive the merge.
    render(<AuroraSurface variant="mist" className="channel-rail__aurora" data-testid="plate" />);
    const plate = screen.getByTestId("plate");
    expect(plate).toHaveClass("aurora");
    expect(plate).toHaveClass("channel-rail__aurora");
  });

  it("passes through the rest of the div attributes", () => {
    render(<AuroraSurface variant="dawn" role="presentation" id="plate" data-testid="plate" />);
    expect(screen.getByTestId("plate")).toHaveAttribute("id", "plate");
    expect(screen.getByTestId("plate")).toHaveAttribute("role", "presentation");
  });
});

describe("US-D06 reduced motion and reduced transparency", () => {
  it("kills the 90s drift in the reduce block", () => {
    expect(tokensCss).toContain("@keyframes aurora-drift");
    const reduced = reducedMotionBlock(tokensCss);
    expect(reduced).toContain(".aurora__mass");
    expect(reduced).toContain("animation: none;");
  });

  it("declares the drift BEFORE the block that animates it off", () => {
    // Both rules are (0,1,0) on the same selectors, so source order decides and a kill that lands
    // earlier loses silently — the drift would keep running for a reduced-motion user with nothing
    // anywhere to say so. This is the assertion that makes the ordering load-bearing rather than a
    // convention.
    const drift = tokensCss.indexOf("animation: aurora-drift");
    const reduced = tokensCss.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(drift).toBeGreaterThan(-1);
    expect(reduced).toBeGreaterThan(drift);
  });

  it("hides every texture layer when transparency is reduced, and leaves a flat surface", () => {
    const reduced = reducedTransparencyBlock(tokensCss);
    for (const layer of [".aurora::before", ".aurora::after", ".aurora__mass", ".aurora__grain"]) {
      expect(reduced).toContain(layer);
    }
    expect(reduced).toContain(".aurora {");
    expect(reduced).toContain("background-color: var(--bg-elevated);");
    // The canvas grain is part of the same answer — one block, not two.
    expect(reduced).toContain(".app-shell::before");
  });
});

describe("US-D06 CSS traps that fail silently (ACCENT-DIRECTION §2.4)", () => {
  /** The declarations between a selector and its closing brace. Enough for a flat CSS rule, which is
   *  all this file reads. */
  function ruleBody(selector: string): string {
    const start = tokensCss.indexOf(`\n${selector} {`);
    if (start === -1) throw new Error(`selector not found in tokens.css: ${selector}`);
    return tokensCss.slice(start, tokensCss.indexOf("}", start));
  }

  it("keeps the blur off .aurora itself", () => {
    // An ancestor with `filter` disables descendant `backdrop-filter`, and `.aurora` is always an
    // ancestor of a glass plate (rail, ask panel). Moving the blur up here would silently stop every
    // glass surface inside it from blurring the canvas.
    expect(ruleBody(".aurora")).not.toContain("filter:");
  });

  it("does not reintroduce `contain: paint`", () => {
    // Per Filter Effects L2 that forms a backdrop root, which would make the rail's glass sample only
    // what is painted inside .aurora — it would stop blurring the page canvas and its grid.
    // (The prose above the rule names the property on purpose; only a declaration counts.)
    expect(tokensCss).not.toMatch(/^\s*contain:\s*paint/m);
  });

  it("keeps the mask on a different element from the blur", () => {
    // filter runs before mask, so blur() on the masked box blurs the unmasked rectangle and then cuts
    // it with a hard-edged mask: a crisp mountain instead of a soft one. The two-element split is the
    // fix, and the blur must be on the ancestor.
    const mass = ruleBody(".aurora__mass");
    const masked = ruleBody(".aurora__mass::before");
    expect(mass).toContain("blur(");
    expect(mass).toContain("drop-shadow(");
    expect(masked).toContain("mask-image");
    expect(masked).not.toContain("filter:");
  });

  it("derives the blur factors at the use site, never precomputed in :root", () => {
    // var() inside a custom-property declaration is substituted where it is declared, not where it is
    // used: a `:root { --aurora-mass-blur: calc(0.35 * var(--aurora-blur)) }` is guaranteed-invalid
    // the moment a surface overrides --aurora-blur, and the consuming filter silently computes to
    // `none` — no blur and no rim, with no error anywhere.
    const root = tokensCss.slice(tokensCss.indexOf(":root {"), tokensCss.indexOf("\n}", 0));
    expect(root).not.toContain("--aurora-mass-blur");
    expect(root).not.toMatch(/--aurora-[a-z-]+:\s*calc\(/);
    expect(ruleBody(".aurora__mass")).toContain("calc(0.35 * var(--aurora-blur))");
  });

  it("keeps the grain grey and sRGB-pinned", () => {
    // feTurbulence emits RGBA noise: without the saturate-0 matrix the grain is rainbow speckle
    // inside a spec whose whole premise is a monotone base. And the CSS/SVG default colour
    // interpolation is linearRGB, which Chrome honours — the tile then renders materially darker
    // than authored, and differently from Safari/WKWebView.
    const grain = /--grain: url\("data:image\/svg\+xml,([^"]+)"\)/.exec(tokensCss)?.[1];
    expect(grain).toBeDefined();
    expect(grain).toContain("feColorMatrix");
    expect(grain).toContain("values='0'");
    expect(grain).toContain("color-interpolation-filters='sRGB'");
  });

  it("keeps both -webkit- mask prefixes (Tauri 2 is WKWebView on macOS)", () => {
    const masked = ruleBody(".aurora__mass::before");
    expect(masked).toContain("-webkit-mask-image");
    expect(masked).toContain("mask-image");
    expect(masked).toContain("-webkit-mask-size: 100% 100%");
    // `cover` preserves the source aspect and scales the silhouette past the box, which makes the
    // contour read crisp and graphic — an illustration, not a photograph. The prose above the rule
    // names the keyword on purpose, so this reads the declaration, not the comment.
    expect(masked).not.toMatch(/mask-size:\s*cover/);
  });
});

describe("US-D06 the aurora palette stays at Logan's eight anchors", () => {
  it("declares exactly eight --aurora-* colour tokens", () => {
    // §2.2: "exactly Logan's eight anchors, one token each. Do not add a ninth." Anything beyond this
    // list is an invented stop, which is how a confined brand texture turns into a gradient kit. The
    // eight are told apart from the per-variant knobs (alpha, blur, sky, mass-hi, …) by being the only
    // --aurora-* tokens holding a literal colour.
    const anchors = [
      "--aurora-indigo",
      "--aurora-peach",
      "--aurora-butter",
      "--aurora-paper",
      "--aurora-blue",
      "--aurora-void",
      "--aurora-ember",
      "--aurora-lilac",
    ];
    const declared = [...tokensCss.matchAll(/^\s*(--aurora-[a-z0-9-]+):\s*oklch\(/gm)].map(
      (m) => m[1],
    );
    expect([...new Set(declared)].sort()).toEqual([...anchors].sort());
  });

  it("keeps the accent to one hue and the semantic tones to their three", () => {
    // §5.3 guard 6 as US-D08/§a.2 leaves it: exactly one accent hue, and semantic colour limited to
    // the three tones. The *value* changed (D6's graphite is superseded — v3 §b.1 puts the accent
    // back on blue at L 0.48, which is the ceiling above which white label text on an accent-filled
    // chip drops under 4.5:1), but the structural rule this asserts is the one that did not move: a
    // fourth coloured UI token, or a second hue used for emphasis, is still a reject.
    expect(tokensCss).toContain("--accent: var(--accent-600);");
    expect(tokensCss).toContain("--accent-600: oklch(0.48 0.18 255);");
    for (const tone of ["--danger-500", "--warn-500", "--success-500"]) {
      expect(tokensCss).toMatch(new RegExp(`${tone}: oklch\\([\\d.]+ 0\\.[1-9]`));
    }
  });
});
