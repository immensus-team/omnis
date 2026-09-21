// @vitest-environment jsdom
// The root `pnpm test` (vitest.workspace.ts) does not read packages/ui/vitest.config.ts, so this
// file declares its own environment and setup (jest-dom matchers + afterEach(cleanup)).
import "./setup";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SessionHeader } from "../src/components/session-header.js";

/** The session the seeded inbox-draft thread runs, as the two rows arrive from Zero. */
const SESSION = {
  title: "Inbox draft",
  state: "waiting_approval",
  runtime: "claude_code",
  host: "macbook",
} as const;

describe("SessionHeader (loop-r1-07: who is running, where, since when)", () => {
  it("renders a row only when it has a value — a fact the DB has not got is not printed as a dash", () => {
    render(<SessionHeader {...SESSION} />);

    // Runtime is the one row that is always there: a session cannot be drawn without the runtime it
    // ran on, and the component's props make it required for the same reason.
    expect(screen.getByText("Runtime")).toBeInTheDocument();
    expect(screen.getByText("Claude Code on macbook")).toBeInTheDocument();

    // The three optional rows, absent: no cwd, no turn, no end.
    expect(screen.queryByText("Directory")).not.toBeInTheDocument();
    expect(screen.queryByText("Last turn")).not.toBeInTheDocument();
    expect(screen.queryByText("Ended")).not.toBeInTheDocument();
    // `started_at` is required by the schema but optional here (a row that has not synced yet), and
    // it is dropped rather than drawn as "now" — an invented time is worse than a missing row.
    expect(screen.queryByText("Started")).not.toBeInTheDocument();
    expect(screen.getAllByRole("definition")).toHaveLength(1);
  });

  it("adds a row for each value the session does carry", () => {
    const started = Date.now() - 6 * 60_000;
    render(
      <SessionHeader
        {...SESSION}
        cwd="/Users/logankim/AI-Workspaces/omnis.plan-loop-r1"
        startedAt={started}
        lastTurnAt={started + 60_000}
        endedAt={started + 120_000}
      />,
    );

    expect(screen.getByText("Directory")).toBeInTheDocument();
    expect(
      screen.getByText("/Users/logankim/AI-Workspaces/omnis.plan-loop-r1"),
    ).toBeInTheDocument();
    expect(screen.getByText("Started")).toBeInTheDocument();
    expect(screen.getByText("Last turn")).toBeInTheDocument();
    expect(screen.getByText("Ended")).toBeInTheDocument();
    expect(screen.getAllByRole("definition")).toHaveLength(5);
  });

  it("reads the state off the same mapper the inbox row uses, with failed told apart", () => {
    const { rerender } = render(<SessionHeader {...SESSION} state="waiting_approval" />);
    // waiting_approval is the row badge's "Blocked" (row-meta.ts DB_STATE_TO_KINSO) — one mapper,
    // so a header and a row cannot come to disagree about one session (UX-15).
    expect(screen.getByText("Blocked")).toBeInTheDocument();

    rerender(<SessionHeader {...SESSION} state="failed" />);
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.queryByText("Blocked")).not.toBeInTheDocument();
  });

  it("carries no cost or token row (UX-13: a $0.00 under a session that spent money is a lie)", () => {
    render(<SessionHeader {...SESSION} cwd="/tmp" startedAt={Date.now()} />);
    expect(screen.queryByText(/cost/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/token/i)).not.toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toContain("$");
  });

  // loop-r2-07/L2-32: omnis's runtime is not a stranger runtime whose icon is missing — it is the
  // app this header is drawn inside. The tile is reused from the inbox row, so "a runtime that gains
  // a brand mark gains it in both places at once" has to hold here too: the same session row drew
  // the real mark while the pane above it drew a black "O".
  it("draws omnis's own mark for the omnis runtime, not the O letter fallback", () => {
    const { container } = render(<SessionHeader {...SESSION} runtime="omnis" host="mini" />);

    // The label row is unaffected — it still names the runtime and the machine it is on.
    expect(screen.getByText("omnis on mini")).toBeInTheDocument();
    const slot = container.querySelector(".session-header__avatar");
    const mark = slot?.querySelector(".inbox-row__avatar--omnis");
    expect(mark).toBeInTheDocument();
    expect(mark?.querySelector("img")).toBeInTheDocument();
    // No letter behind it: the fallback is the thing this test exists to keep out of the header.
    expect(mark?.textContent).toBe("");
    expect(slot?.textContent ?? "").not.toContain("O");
  });
});
