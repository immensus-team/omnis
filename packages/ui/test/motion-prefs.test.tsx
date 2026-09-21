// @vitest-environment jsdom
// The root `pnpm test` (vitest.workspace.ts) does not read packages/ui/vitest.config.ts, so the
// environment and the setup (jest-dom matchers + afterEach(cleanup)) are declared by the file itself.
import "./setup";

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useReducedMotion } from "motion/react";
import { afterEach, describe, expect, it } from "vitest";
import { type MotionTier, SPRING, TIER_MS, useMotionPrefs } from "../src/lib/motion";

/** This test file's own directory — the same cwd-independent read motion.test.tsx uses. */
const TEST_DIR = dirname(new URL(import.meta.url).pathname);
const tokensCss = readFileSync(join(TEST_DIR, "../src/tokens.css"), "utf8");

/** A `matchMedia` stub whose answers can be *moved*, with the change event actually delivered.
 *
 *  motion.test.tsx's stub is fire-and-forget (its addEventListener is a no-op), which is fine for
 *  the CSS-driven durations it tests. It is not enough here: motion caches its reduced-motion
 *  answer in a module-level ref at first initialisation and only ever updates it from the media
 *  query's `change` event, so a stub that cannot fire that event can only ever observe one value
 *  per test file. Delivering the event is what makes the reduced-motion half of `useMotionPrefs`
 *  testable at all. */
class MediaStub {
  private readonly lists = new Map<string, { matches: boolean; listeners: Set<() => void> }>();

  /** Install the stub and hand every query back its default answer.
   *
   *  The answers are cleared but the *listeners* are kept, and that asymmetry is the whole point:
   *  motion registers its media listener exactly once per module graph (its init is guarded by a
   *  module-level ref), so dropping the listeners between tests would leave the reduced-motion half
   *  permanently unwired after the first test file. Clearing the answers is what gives each test a
   *  clean starting point that still reaches the listener motion installed in an earlier one. */
  install(): void {
    window.matchMedia = ((query: string) => {
      const entry = this.lists.get(query) ?? { matches: false, listeners: new Set<() => void>() };
      this.lists.set(query, entry);
      return {
        // A getter, not a field: motion re-reads `matches` inside its change handler.
        get matches() {
          return entry.matches;
        },
        media: query,
        addEventListener: (_type: string, listener: () => void) =>
          void entry.listeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) =>
          void entry.listeners.delete(listener),
      };
    }) as unknown as typeof window.matchMedia;
    this.set("", false);
  }

  /** Move every query containing `part` and fire the listeners that asked about it. Note motion
   *  asks for the bare `(prefers-reduced-motion)`, with no `: reduce` suffix, so a substring match
   *  is what reaches it; the empty string in `install` is every query. */
  set(part: string, matches: boolean): void {
    for (const [query, entry] of this.lists) {
      if (!query.includes(part)) continue;
      entry.matches = matches;
      for (const listener of entry.listeners) listener();
    }
  }

  /** The distinct queries something has actually asked about — the map stays empty until a surface
   *  mounts and reads one, which is how the "both requests are consulted" assertion below can tell
   *  a wired-up hook from one that guesses. */
  queries(): string[] {
    return [...this.lists.keys()];
  }
}

const REAL_MATCH_MEDIA = window.matchMedia;
const media = new MediaStub();

afterEach(() => {
  window.matchMedia = REAL_MATCH_MEDIA;
});

/** A probe rather than a component: this hook's return value is the whole subject, and no surface in
 *  this package would show a `prefers-reduced-transparency` answer at a place a test could read it.
 *  It also renders motion's own hook beside the derived flag, which is what pins the coalescing. */
function Probe() {
  const prefs = useMotionPrefs();
  const own = useReducedMotion();
  return (
    <span
      data-testid="prefs"
      data-motion={String(prefs.reducedMotion)}
      data-transparency={String(prefs.reducedTransparency)}
      // The contract `useMotionPrefs` promises: its motion flag is motion's own answer, coalesced.
      data-own={String(own ?? false)}
    />
  );
}

function prefs() {
  const el = screen.getByTestId("prefs");
  return {
    reducedMotion: el.dataset.motion,
    reducedTransparency: el.dataset.transparency,
    own: el.dataset.own,
  };
}

describe("the v3 motion tiers, as springs", () => {
  it("carries the three tier durations the ladder declares", () => {
    expect(TIER_MS).toEqual({ base: 160, move: 240, panel: 320 });
  });

  it("gives every tier a spring whose visual duration is that tier in seconds", () => {
    for (const tier of Object.keys(TIER_MS) as MotionTier[]) {
      const spring = SPRING[tier];
      expect(spring.type, tier).toBe("spring");
      // `visualDuration` is seconds and the token is ms, so this equality is the mapping itself.
      expect(spring.visualDuration * 1000, tier).toBe(TIER_MS[tier]);
    }
  });

  it("keeps every bounce inside the 0.1–0.15 window, falling as the tier lengthens", () => {
    // §e guard 5 rejects a bounce nobody asked for. The ceiling is the design direction's; the
    // ordering is the tuning rule (a long layer must not wobble like a short chip).
    for (const tier of Object.keys(TIER_MS) as MotionTier[]) {
      expect(SPRING[tier].bounce, tier).toBeGreaterThanOrEqual(0.1);
      expect(SPRING[tier].bounce, tier).toBeLessThanOrEqual(0.15);
    }
    expect(SPRING.panel.bounce).toBeLessThan(SPRING.base.bounce);
  });

  it("agrees with the durations tokens.css declares, in both directions", () => {
    // The same class of drift guard motion.test.tsx puts on PANEL_MS and LEAVE_MS: tokens.css
    // cannot import a TypeScript table and lib/motion.ts cannot read a stylesheet, so changing one
    // side alone makes the other side's assertion false.
    expect(tokensCss).toContain(`--dur-base: ${TIER_MS.base}ms;`);
    expect(tokensCss).toContain(`--dur-move: ${TIER_MS.move}ms;`);
    expect(tokensCss).toContain(`--dur-panel: ${TIER_MS.panel}ms;`);
  });
});

describe("useMotionPrefs", () => {
  it("asks about both requests, and starts from the platform's default of neither", () => {
    media.install();
    render(<Probe />);
    expect(prefs()).toMatchObject({ reducedMotion: "false", reducedTransparency: "false" });

    // Not decoration: a hook that hard-coded `false` would pass the assertion above. These are the
    // queries it actually consulted.
    const asked = media.queries();
    expect(asked.some((q) => q.includes("prefers-reduced-transparency"))).toBe(true);
    expect(asked.some((q) => q.includes("prefers-reduced-motion"))).toBe(true);
  });

  it("moves the transparency flag without moving the motion flag", () => {
    // The two preferences are separate requests — someone can want the blur gone and the springs
    // kept — so the one assertion that matters is that answering one does not answer the other.
    media.install();
    render(<Probe />);

    act(() => media.set("prefers-reduced-transparency", true));
    expect(prefs().reducedTransparency).toBe("true");
    expect(prefs().reducedMotion).toBe("false");
  });

  it("reports motion's own answer, so it cannot disagree with MotionConfig", () => {
    media.install();
    render(<Probe />);
    // `MotionConfig reducedMotion="user"` (main.tsx) acts on exactly this value. Deriving the flag
    // any other way is how a surface ends up animating while motion has already been told not to.
    expect(prefs().reducedMotion).toBe(prefs().own);
  });

  it("follows the reduced-motion query flipping under it", () => {
    media.install();
    render(<Probe />);
    expect(prefs().reducedMotion).toBe("false");

    act(() => media.set("prefers-reduced-motion", true));

    // Remounted on purpose. motion reads its cached answer in a `useState` initialiser, so an
    // already-mounted surface keeps the value it mounted with — a fresh mount is what shows the
    // change reached the store this hook reads. Asserting it on the stale mount would be asserting
    // the opposite of what motion does.
    cleanup();
    render(<Probe />);
    expect(prefs().reducedMotion).toBe("true");
    // …and the transparency request, answered separately, is untouched by it.
    expect(prefs().reducedTransparency).toBe("false");
  });
});
