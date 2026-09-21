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
  it("offers no Summarize this thread while no thread is selected", () => {
    render(panel(false, null));
    // loop-r1-08 (L-35, NC-40): the button used to be drawn disabled under a "Thread required" tag.
    // A suggestion that cannot be pressed is not a suggestion, and with no thread there is nothing
    // to summarize — so the row is not there at all, and the recent commands stand in its place.
    expect(screen.queryByRole("button", { name: "Summarize this thread" })).not.toBeInTheDocument();
  });

  it("enables Summarize this thread once a thread is selected", () => {
    render(panel(true, null));
    expect(summarize()).not.toBeDisabled();
  });

  it("shows no Phase B placeholders, whatever is selected", () => {
    const { rerender } = render(panel(true, "Test summary"));
    for (const name of ["Draft a reply", "Extract to-dos"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }

    rerender(panel(false, null));
    // And the panel says no such thing anywhere: a roadmap's phase number is not product copy.
    expect(screen.queryByText(/Phase B/)).not.toBeInTheDocument();
  });

  it("falls back to the recent commands when the context has no suggestion of its own", () => {
    const perform = vi.fn();
    render(
      <AskPanel
        commands={null}
        recentActions={[
          { id: "go-inbox", name: "Go to Inbox", group: "Navigate", shortcut: "g i", perform },
        ]}
        threadSelected={false}
        summary={null}
        onClose={vi.fn()}
      />,
    );

    // Real and pressable — the same row the Commands tab runs, which is what makes the tab teach
    // the one next to it rather than advertise a phase the product is not in.
    const row = screen.getByRole("button", { name: /Go to Inbox/ });
    expect(row).not.toBeDisabled();
    fireEvent.click(row);
    expect(perform).toHaveBeenCalledOnce();
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

// US-D06 §4.1.2: the panel is two elements — an aurora wrapper and the glass that scrolls inside it.
// The split is load-bearing, not cosmetic: `.aurora` clips with `overflow: hidden` and positions its
// texture layers against itself, so it may never be the scroll container.
describe("AskPanel aurora backdrop (US-D06)", () => {
  const renderPanel = () => {
    const { container } = render(panel(true, "Test summary"));
    return container;
  };

  it("separates the aurora wrapper from the glass scroller", () => {
    const container = renderPanel();
    const aura = container.querySelector(".ask-panel");
    const glass = container.querySelector(".ask-panel__glass");

    expect(aura).toHaveAttribute("data-aurora", "dawn");
    expect(aura).toContainElement(glass);
    // §2.7: one element carrying both classes would give `.aurora`'s background-color and
    // `.glass-surface`'s background the same specificity, and the panel stops being glass.
    expect(aura).not.toHaveClass("glass-surface");
    expect(glass).not.toHaveClass("aurora");
    // The glass is the scroller, so the aurora around it never is.
    expect(glass).toHaveClass("glass-surface");
  });

  it("keeps the dialog role on the wrapper, where the close spring lands", () => {
    // The role used to sit on the glass, which *was* the outer element. It moved out with the box:
    // `.ask-panel--closing` is applied to the wrapper, and a dialog that is not the element carrying
    // the panel's state is a worse answer than a dialog that is.
    const { container } = render(
      <AskPanel commands={null} threadSelected summary={null} closing onClose={vi.fn()} />,
    );
    const dialog = screen.getByRole("dialog", { name: "AI panel" });
    expect(dialog).toHaveClass("ask-panel");
    expect(dialog).toHaveClass("ask-panel--closing");
    expect(dialog).toContainElement(container.querySelector(".ask-panel__glass"));
  });
});
