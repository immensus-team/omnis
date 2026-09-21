// @vitest-environment jsdom
// The root `pnpm test` (vitest.workspace.ts) does not read packages/ui/vitest.config.ts, so the
// environment and the setup (jest-dom matchers + afterEach(cleanup)) are declared by the file itself.
import "./setup";

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

// motion-OSS S5: below 900px the panel is the same `vaul` drawer the filters sheet is, rather than
// the card hanging off the ask bar's box. What the drawer buys is the mechanism — snap points, a drag
// that settles where it is released, Radix's modal machinery — and what that costs is the anchor
// (app.css's `[data-vaul-drawer].ask-panel` block). This file holds the mount and the two behaviours
// a mount can be asked about; the box itself is asserted against app.css in
// apps/desktop/test/app-shell.test.tsx, because that is where the numbers live.
describe("AskPanel, the narrow tier — vaul's drawer (motion-OSS S5)", () => {
  const REAL_MATCH_MEDIA = window.matchMedia;
  afterEach(() => {
    window.matchMedia = REAL_MATCH_MEDIA;
  });
  /** `useNarrowShell` reads `window.matchMedia`, so the tier is this stub and nothing else. */
  function stubTier(narrow: boolean): void {
    window.matchMedia = (() => ({
      matches: narrow,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
  }

  it("is the anchored card above the breakpoint, and not a drawer", () => {
    stubTier(false);
    render(panel(true, null));
    const dialog = screen.getByRole("dialog", { name: "AI panel" });
    expect(dialog.hasAttribute("data-vaul-drawer")).toBe(false);
    expect(document.querySelector("[data-vaul-overlay]")).toBeNull();
  });

  it("is the drawer below it, with the grabber and the half-height snap point", () => {
    stubTier(true);
    render(panel(true, null));
    const dialog = screen.getByRole("dialog", { name: "AI panel" });

    // The drawer's own attributes land on the aurora wrapper because `Drawer.Content asChild` hands
    // them to it through Radix's Slot — which is why `AuroraSurface` forwards a ref.
    expect(dialog.hasAttribute("data-vaul-drawer")).toBe(true);
    expect(dialog).toHaveAttribute("data-vaul-drawer-direction", "bottom");
    expect(dialog).toHaveAttribute("data-vaul-snap-points", "true");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    // The brief's "snap points [0.5, 0.92]", observed where it is observable: `vaul` writes the
    // active rest point to `--snap-point-height`, and for a bottom drawer that is a *translate* of
    // `viewport - snap * viewport` — half the viewport at the first snap.
    expect(dialog.style.getPropertyValue("--snap-point-height")).toBe(
      `${window.innerHeight - 0.5 * window.innerHeight}px`,
    );
    // `handleOnly` puts the whole gesture on the grabber: the panel's own list scrolls, and a drawer
    // that dragged from anywhere could not tell the two apart.
    const handle = dialog.querySelector("[data-vaul-handle].drawer__grabber");
    expect(handle).not.toBeNull();
    expect(dialog.querySelectorAll("[data-vaul-handle]")).toHaveLength(1);
    expect(handle?.querySelector("[data-vaul-handle-hitarea]")).not.toBeNull();
    // §2.7 holds at this tier too: the aurora wrapper is the drawer element, and the glass that
    // scrolls is still a child of it rather than the same element.
    expect(dialog).toHaveClass("ask-panel__aurora");
    expect(dialog).not.toHaveClass("glass-surface");
    expect(dialog).toContainElement(document.querySelector(".ask-panel__glass"));
    expect(document.querySelectorAll(".glass-surface .glass-surface")).toHaveLength(0);
  });

  it("closes on the scrim and on Escape, both of which are Radix's here", () => {
    stubTier(true);
    const onClose = vi.fn();
    render(<AskPanel commands={null} threadSelected summary={null} onClose={onClose} />);

    fireEvent.click(document.querySelector("[data-vaul-overlay]") as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("moves focus into the drawer on open", () => {
    stubTier(true);
    render(panel(true, null));
    // `vaul`'s `autoFocus` defaults to *off* and prevents Radix's mount autofocus when it is off;
    // the drawer passes it, and the panel's first control is where Radix's focus scope lands.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Suggestions" }));
  });
});
