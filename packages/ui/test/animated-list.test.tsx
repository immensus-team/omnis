// @vitest-environment jsdom
// The root `pnpm test` (vitest.workspace.ts) does not read packages/ui/vitest.config.ts, so the
// environment and the setup (jest-dom matchers + afterEach(cleanup)) are declared by the file itself.
import "./setup";

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnimatedList } from "../src/components/animated-list.js";

// motion-OSS S6. What is testable here is deliberately narrow: auto-animate's effect is measured
// boxes and keyframes, and jsdom has no layout engine — every getBoundingClientRect is zero — so the
// animation's *appearance* cannot be observed from a unit test. That is the same wall S2's Reorder
// probe hit, recorded in DESIGN-DIRECTION-v3 §c.1.1.
//
// What a unit test can hold is the two things around it. That the list is a real list and still
// updates, since the animation is an enhancement on top of that and a broken list would be a broken
// feature whatever it looked like. And that the reduced-motion contract holds — auto-animate skips
// its animation entirely for a user who asked for that — which is the one part of the motion wave's
// "honour the preference everywhere" requirement that is reachable without a browser.

/** Point `prefers-reduced-motion` at a chosen answer.
 *
 *  It has to be installed *before* render: auto-animate reads the query once, when the ref attaches,
 *  and returns before installing its observer if the answer is yes — there is no later moment at
 *  which it reconsiders. This is the setup file's stub with the one query that matters made movable. */
function installReducedMotion(reduced: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: reduced && query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/** Drop a child and let auto-animate's MutationObserver run. The observer is a microtask, so the
 *  assertion cannot be made on the line after the re-render. */
async function removeSecondItem(rerender: (ui: React.ReactElement) => void): Promise<void> {
  rerender(
    <AnimatedList>
      <li>~/notes</li>
    </AnimatedList>,
  );
  await vi.waitFor(() => {});
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AnimatedList (motion-OSS S6: a list that animates its own insertions)", () => {
  it("renders a list carrying the caller's class and its items", () => {
    render(
      <AnimatedList className="settings-screen__chips">
        <li>~/notes</li>
        <li>~/repos</li>
      </AnimatedList>,
    );

    const list = screen.getByRole("list");
    expect(list).toHaveClass("settings-screen__chips");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("still reflects an item being removed", async () => {
    installReducedMotion(false);
    const { rerender } = render(
      <AnimatedList>
        <li>~/notes</li>
        <li>~/repos</li>
      </AnimatedList>,
    );

    await removeSecondItem(rerender);

    // The list is a list first: the animation is what happens around this, not instead of it.
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("~/notes")).toBeInTheDocument();
  });

  it("animates the removal when the user has no motion preference", async () => {
    installReducedMotion(false);
    // `Element.prototype.animate` is jsdom's stub (test/setup.ts) — spying on it is how a skipped
    // animation is distinguished from one that ran, since neither leaves a trace in the DOM.
    const animate = vi.spyOn(Element.prototype, "animate");
    const { rerender } = render(
      <AnimatedList>
        <li>~/notes</li>
        <li>~/repos</li>
      </AnimatedList>,
    );

    await removeSecondItem(rerender);

    expect(animate).toHaveBeenCalled();
  });

  it("skips the animation entirely under prefers-reduced-motion: reduce", async () => {
    installReducedMotion(true);
    const animate = vi.spyOn(Element.prototype, "animate");
    const { rerender } = render(
      <AnimatedList>
        <li>~/notes</li>
        <li>~/repos</li>
      </AnimatedList>,
    );

    await removeSecondItem(rerender);

    // Not "animates faster" and not "animates with a shorter duration" — auto-animate returns before
    // it installs the observer, so nothing is ever asked to animate. The list above is still correct
    // without one, which is what makes this a reduction rather than a loss.
    expect(animate).not.toHaveBeenCalled();
  });
});
