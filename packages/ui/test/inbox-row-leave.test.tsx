// @vitest-environment jsdom
// motion-OSS S4: the leaving row under `prefers-reduced-motion: reduce`. Its own file because the
// stub below has to be installed before the first render in this module — see the comment on it.
import "./setup";

import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InboxRow } from "../src/components/inbox-row";

/** Installed at module scope, before any render. `motion`'s `useReducedMotion` creates its media
 *  query listener once and keeps the answer it first saw, so a stub installed after a render would
 *  be read by this repo's own `prefersReducedMotion()` (which asks `matchMedia` every time, and is
 *  what the hold timer uses) but not by the hook the exit target comes from — and the two would
 *  then disagree about the same preference. Only the reduced-motion query matches; every other query
 *  answers `false`, which is what jsdom's own `matchMedia` answers anyway. */
window.matchMedia = ((query: string) => ({
  matches: query.includes("prefers-reduced-motion"),
  addEventListener: () => {},
  removeEventListener: () => {},
})) as unknown as typeof window.matchMedia;

const baseProps = {
  id: "thread-1",
  name: "Sora Kim",
  timestamp: "3m",
  summary: "Please take a look at the meeting notes",
  isDraft: false,
  avatar: { kind: "initials" as const, name: "Sora Kim" },
  channel: "slack" as const,
  agentState: null,
  unread: true,
  selected: false,
  hasPendingApproval: false,
  labels: [],
  onSelect: () => {},
};

describe("InboxRow leave under reduced motion (motion-OSS S4)", () => {
  // The exit is shortened, not skipped: the row is still held and still fades. That is the same
  // distinction `apps/desktop`'s archive suite pins on the timer side (the row is held for
  // REDUCED_FADE_MS, not LEAVE_MS); this is the animation side of it.
  it("fades the leaving row and drops the travel, keeping the height it had", async () => {
    render(<InboxRow {...baseProps} leaving />);
    const row = screen.getByRole("option");
    expect(row).toHaveClass("inbox-row--leaving");
    await waitFor(() => expect(row.style.opacity).toBe("0"));
    // No height in the exit target at all — not `0`, not a pixel value. A `height: 0` here would be
    // the collapse reduced motion asked not to see, and it is exactly what the target would carry if
    // the preference were ignored (inbox-row.tsx's LEAVE_EXIT vs LEAVE_EXIT_REDUCED).
    expect(row.style.height).toBe("");
  });
});
