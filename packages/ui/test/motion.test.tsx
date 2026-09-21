// @vitest-environment jsdom
// The root `pnpm test` (vitest.workspace.ts) does not read packages/ui/vitest.config.ts, so the
// environment and the setup (jest-dom matchers + afterEach(cleanup)) are declared by the file itself.
import "./setup";

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "../src/components/command-palette";
import {
  LEAVE_MS,
  PANEL_MS,
  REDUCED_FADE_MS,
  motionMs,
  prefersReducedMotion,
  useClosingSpring,
} from "../src/lib/motion";

/** This test file's own directory — the same cwd-independent read app-shell.test.tsx uses, because
 *  vitest's transform can leave import.meta.url on a scheme other than file:. */
const TEST_DIR = dirname(new URL(import.meta.url).pathname);
const UI_SRC = join(TEST_DIR, "../src");
const DESKTOP_SRC = join(TEST_DIR, "../../../apps/desktop/src");

const tokensCss = readFileSync(join(UI_SRC, "tokens.css"), "utf8");
const appCss = readFileSync(join(DESKTOP_SRC, "app.css"), "utf8");

/** The declarations between a selector and its closing brace. Enough for a flat CSS rule, which is
 *  all this file reads — a nested at-rule inside the block would need a real parser. */
function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`selector not found in the stylesheet: ${selector}`);
  const end = css.indexOf("}", start);
  return css.slice(start, end === -1 ? undefined : end);
}

/** The body of the one @media (prefers-reduced-motion: reduce) block in a stylesheet, from the
 *  query to the end of the file. Both files keep theirs last. */
function reducedMotionBlock(css: string): string {
  const start = css.indexOf("@media (prefers-reduced-motion: reduce)");
  if (start === -1) throw new Error("no prefers-reduced-motion block in this stylesheet");
  return css.slice(start);
}

const REAL_MATCH_MEDIA = window.matchMedia;
/** jsdom's window.matchMedia always reports matches:false (the same limitation channel-rail.test.tsx
 *  documents), so honouring a reduced-motion query is only observable against a stub. The component
 *  reads window.matchMedia, not globalThis's. */
function stubMatchMedia(reducedMotion: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reducedMotion && query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}
afterEach(() => {
  window.matchMedia = REAL_MATCH_MEDIA;
  vi.useRealTimers();
});

describe("US-D04 reduced-motion detection", () => {
  it("reads the reduce query, and takes the full-motion branch when it is off", () => {
    stubMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);
    stubMatchMedia(false);
    expect(prefersReducedMotion()).toBe(false);
  });

  it("falls back to full motion when matchMedia is missing entirely", () => {
    // The bare-Node / SSR case. The fallback is the open one: a runtime that cannot answer the
    // question has not asked for less motion.
    window.matchMedia = undefined as unknown as typeof window.matchMedia;
    expect(prefersReducedMotion()).toBe(false);
    expect(motionMs(PANEL_MS)).toBe(PANEL_MS);
  });

  it("collapses both JS-side holds onto the shared fade, and never onto zero", () => {
    stubMatchMedia(true);
    expect(motionMs(PANEL_MS)).toBe(REDUCED_FADE_MS);
    expect(motionMs(LEAVE_MS)).toBe(REDUCED_FADE_MS);

    // The invariant the whole helper exists for: a zero-length hold unmounts an exiting element on
    // the same tick it started leaving, so the CSS animation it was waiting for never runs and the
    // node is simply gone. Reduced motion wants a *shorter* exit, not the absence of one.
    expect(REDUCED_FADE_MS).toBeGreaterThan(0);
    stubMatchMedia(false);
    expect(motionMs(PANEL_MS)).toBeGreaterThan(0);
    expect(motionMs(LEAVE_MS)).toBeGreaterThan(0);
  });
});

describe("US-D04 CSS and JS agree on the durations", () => {
  // tokens.css cannot import a TypeScript constant and lib/motion.ts cannot read a stylesheet, so
  // the same numbers live in both. This is the same class of guard app-shell.test.tsx puts on the
  // narrow-rail breakpoint: it catches drift in either direction, because changing one side alone
  // makes the other side's assertion false.
  it("matches the tokens lib/motion.ts mirrors", () => {
    expect(tokensCss).toContain(`--dur-panel: ${PANEL_MS}ms;`);
    expect(tokensCss).toContain(`--dur-move: ${LEAVE_MS}ms;`);
    expect(tokensCss).toContain("--dur-base: 160ms;");
  });

  it("collapses every duration onto the reduced fade rather than onto 0ms", () => {
    const reduced = reducedMotionBlock(tokensCss);
    for (const token of ["--dur-fast", "--dur-base", "--dur-move", "--dur-slow", "--dur-panel"]) {
      expect(reduced).toContain(`${token}: ${REDUCED_FADE_MS}ms;`);
    }
    // A stray `0ms` would be the old behaviour creeping back: it silences the motion *and* the
    // feedback with it.
    expect(reduced).not.toContain(": 0ms;");
  });
});

describe("US-D04 reduced motion keeps the fade and drops the travel", () => {
  // Every surface whose entrance or exit carries a transform. Each one keeps a short fade instead of
  // switching its animation off, and the two that JavaScript unmounts on `animationend` (the ask
  // panel through useClosingSpring, the hover card through Radix Presence) would hang in the DOM
  // forever if the animation were removed rather than re-pointed.
  const MOVING_SURFACES = [
    ".ask-panel",
    ".ask-panel--closing",
    '.row-hover-card[data-state="open"]',
    '.row-hover-card[data-state="closed"]',
    ".app-shell__detail",
    ".inbox-row--leaving",
  ];

  it("lands the rail's reorder in the same slots with no travel", () => {
    // D7 §c.2: under reduced motion the neighbours jump. The rail's FLIP writes one transform either
    // way — the only thing reduced motion changes is the duration token it rides, which is why this
    // is a token override rather than a second code path in channel-rail.tsx.
    expect(reducedMotionBlock(appCss)).toMatch(/\.channel-rail\s*\{[^}]*--dur-reorder:\s*0ms/);
    expect(appCss).toMatch(/--dur-reorder:\s*220ms/);
  });

  it("re-points every moving animation at a fade, and defines the names it points at", () => {
    const reduced = reducedMotionBlock(appCss);
    for (const selector of MOVING_SURFACES) {
      const body = ruleBody(reduced, selector);
      const name = body.match(/animation-name:\s*([\w-]+)/)?.[1];
      expect(name, `${selector} has no animation-name in the reduced-motion block`).toBeDefined();
      expect(appCss).toContain(`@keyframes ${name}`);
    }
  });

  it("keeps the hover card's open and closed names different", () => {
    // Radix Presence decides to unmount from the animation-name *changing* between the open and
    // closed states. Give both states the same fade and the card does not animate out — it
    // disappears, which is the one outcome reduced motion is not asking for.
    const reduced = reducedMotionBlock(appCss);
    const open = ruleBody(reduced, '.row-hover-card[data-state="open"]').match(
      /animation-name:\s*([\w-]+)/,
    )?.[1];
    const closed = ruleBody(reduced, '.row-hover-card[data-state="closed"]').match(
      /animation-name:\s*([\w-]+)/,
    )?.[1];
    expect(open).toBeDefined();
    expect(closed).toBeDefined();
    expect(open).not.toBe(closed);
  });

  it("strips the transforms the reduced fades replace", () => {
    // Guards the fades themselves: a fade that still translates is a shortened slide, which is what
    // this block exists to prevent.
    for (const name of ["fade-in", "fade-out"]) {
      const body = ruleBody(appCss, `@keyframes ${name}`);
      expect(body).toContain("opacity");
      expect(body).not.toContain("transform");
    }
  });
});

describe("US-D04 reduced motion in the rendered tree (RTL + matchMedia mock)", () => {
  it("holds the ask panel for the reduced fade instead of the full layer duration", () => {
    stubMatchMedia(true);
    vi.useFakeTimers();
    const { rerender } = render(
      <CommandPalette mode="inline" open onOpenChange={vi.fn()} actions={[]} />,
    );
    rerender(<CommandPalette mode="inline" open={false} onOpenChange={vi.fn()} actions={[]} />);
    expect(screen.getByRole("dialog", { name: "AI panel" })).toHaveClass("ask-panel--closing");

    // Past the reduced fade: the panel is already unmounted, well before the 320ms a full-motion
    // user waits. This is the whole assertion — the mock is what makes the difference visible.
    act(() => vi.advanceTimersByTime(REDUCED_FADE_MS));
    expect(screen.queryByRole("dialog", { name: "AI panel" })).not.toBeInTheDocument();
  });

  it("holds the ask panel for the full layer duration when reduced motion is off", () => {
    stubMatchMedia(false);
    vi.useFakeTimers();
    const { rerender } = render(
      <CommandPalette mode="inline" open onOpenChange={vi.fn()} actions={[]} />,
    );
    rerender(<CommandPalette mode="inline" open={false} onOpenChange={vi.fn()} actions={[]} />);

    // The counterweight: at the reduced fade's length the panel is still there, so the test above
    // cannot pass by the panel unmounting instantly for some unrelated reason.
    act(() => vi.advanceTimersByTime(REDUCED_FADE_MS));
    expect(screen.getByRole("dialog", { name: "AI panel" })).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(PANEL_MS));
    expect(screen.queryByRole("dialog", { name: "AI panel" })).not.toBeInTheDocument();
  });
});

/** US-D10 moved the hold itself out of command-palette.tsx, because the detail pane needed the same
 *  arithmetic at its own length (LEAVE_MS). The panel's two tests above are the default's proof —
 *  they call the hook with no `full` and see PANEL_MS — so what is left to hold here is the
 *  argument and the "never opened" rule. */
describe("US-D10 useClosingSpring (one hold, several lengths)", () => {
  /** A probe rather than a component: the hook's return value is the whole subject, and there is no
   *  surface in this package that would show a 240ms hold at a place a test could read it. */
  function Probe({ open, full }: { open: boolean; full: number }) {
    return <span data-testid="closing">{useClosingSpring(open, full) ? "yes" : "no"}</span>;
  }
  const closing = () => screen.getByTestId("closing").textContent;

  it("holds a surface that was open for the length it was given", () => {
    vi.useFakeTimers();
    const { rerender } = render(<Probe open full={LEAVE_MS} />);
    expect(closing()).toBe("no");

    rerender(<Probe open={false} full={LEAVE_MS} />);
    expect(closing()).toBe("yes");

    // Not one millisecond early, and not one late: the hold is the animation's length.
    act(() => vi.advanceTimersByTime(LEAVE_MS - 1));
    expect(closing()).toBe("yes");
    act(() => vi.advanceTimersByTime(1));
    expect(closing()).toBe("no");
  });

  it("never closes a surface that was not open to begin with", () => {
    vi.useFakeTimers();
    // The first render is what "never opened" means: a cell that mounts closed must not play an exit
    // (there is nothing leaving), and the timer this would otherwise start is the bug it prevents.
    const { rerender } = render(<Probe open={false} full={LEAVE_MS} />);
    expect(closing()).toBe("no");

    act(() => vi.advanceTimersByTime(LEAVE_MS));
    rerender(<Probe open={false} full={LEAVE_MS} />);
    expect(closing()).toBe("no");
  });

  it("holds for the reduced fade instead of the given length under reduced motion", () => {
    stubMatchMedia(true);
    vi.useFakeTimers();
    const { rerender } = render(<Probe open full={LEAVE_MS} />);
    rerender(<Probe open={false} full={LEAVE_MS} />);

    // The reduced fade is shorter than the pane's own length, so this is the one assertion that
    // tells the two apart: at the fade the hold is already over, and at LEAVE_MS it was over sooner.
    act(() => vi.advanceTimersByTime(REDUCED_FADE_MS));
    expect(closing()).toBe("no");
  });
});
