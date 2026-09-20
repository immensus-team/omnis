// @vitest-environment jsdom
// The root `pnpm test` (vitest.workspace.ts) does not read packages/ui/vitest.config.ts, so the
// environment and the setup (jest-dom matchers + afterEach(cleanup)) are declared by the file itself.
import "./setup";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AskPanel } from "../src/components/ask-panel";

const panel = (threadSelected: boolean, summary: string | null) => (
  <AskPanel commands={null} threadSelected={threadSelected} summary={summary} onClose={vi.fn()} />
);

const tab = (name: string) => screen.getByRole("button", { name });

const summarize = () => screen.getByRole("button", { name: "Summarize this thread" });

describe("AskPanel suggested actions (US-D01)", () => {
  it("disables Summarize this thread while no thread is selected", () => {
    render(panel(false, null));
    expect(summarize()).toBeDisabled();
  });

  it("enables Summarize this thread once a thread is selected", () => {
    render(panel(true, null));
    expect(summarize()).not.toBeDisabled();
  });

  it('keeps Draft a reply / Extract to-dos disabled with title="Phase B" regardless of selection', () => {
    render(panel(true, "Test summary"));
    for (const name of ["Draft a reply", "Extract to-dos"]) {
      const action = screen.getByRole("button", { name });
      expect(action).toBeDisabled();
      expect(action).toHaveAttribute("title", "Phase B");
    }
  });
});

describe("AskPanel summary display (US-D01)", () => {
  it("reveals the summary once Summarize this thread is pressed", () => {
    render(panel(true, "Test summary"));
    expect(screen.queryByText("Test summary")).toBeNull();

    fireEvent.click(summarize());
    expect(screen.getByText("Test summary")).toBeInTheDocument();
  });

  it("falls back to No summary yet when the summary is null", () => {
    render(panel(true, null));
    fireEvent.click(summarize());

    expect(screen.getByText("No summary yet")).toBeInTheDocument();
  });
});

describe("AskPanel tab switching (US-D01 regression: typing must not become a dead end)", () => {
  it("shows Suggestions while the ask bar query is empty", () => {
    render(
      <AskPanel
        commands={<p>Command list</p>}
        threadSelected
        summary={null}
        query=""
        onClose={vi.fn()}
      />,
    );
    expect(tab("Suggestions")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("Command list")).toBeNull();
  });

  it("auto-switches to Commands as soon as the query is non-empty", () => {
    const { rerender } = render(
      <AskPanel
        commands={<p>Command list</p>}
        threadSelected
        summary={null}
        query=""
        onClose={vi.fn()}
      />,
    );
    rerender(
      <AskPanel
        commands={<p>Command list</p>}
        threadSelected
        summary={null}
        query=">"
        onClose={vi.fn()}
      />,
    );
    expect(tab("Commands")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Command list")).toBeInTheDocument();
  });

  it("falls back to Suggestions when the query clears again", () => {
    const { rerender } = render(
      <AskPanel
        commands={<p>Command list</p>}
        threadSelected
        summary={null}
        query="go"
        onClose={vi.fn()}
      />,
    );
    rerender(
      <AskPanel
        commands={<p>Command list</p>}
        threadSelected
        summary={null}
        query=""
        onClose={vi.fn()}
      />,
    );
    expect(tab("Suggestions")).toHaveAttribute("aria-pressed", "true");
  });

  it("lets an explicit tab click win over the query-derived tab", () => {
    render(
      <AskPanel
        commands={<p>Command list</p>}
        threadSelected
        summary={null}
        query="go"
        onClose={vi.fn()}
      />,
    );
    expect(tab("Commands")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(tab("Suggestions"));
    expect(tab("Suggestions")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("Command list")).toBeNull();
  });
});

describe("AskPanel context line (US-D01)", () => {
  it("names the selected thread so the actions have a visible target", () => {
    render(
      <AskPanel
        commands={null}
        threadSelected
        threadTitle="omnis launch sync"
        summary={null}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("omnis launch sync")).toBeInTheDocument();
  });

  it("says so when nothing is selected", () => {
    render(panel(false, null));
    expect(screen.getByText("No thread selected")).toBeInTheDocument();
  });
});
