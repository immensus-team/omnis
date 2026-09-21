// @vitest-environment jsdom
// The root `pnpm test` (vitest.workspace.ts) does not read packages/ui/vitest.config.ts, so the
// environment and the setup (jest-dom matchers + afterEach(cleanup)) are declared by the file itself.
import "./setup";

import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CommandPalette,
  type PaletteAction,
  SEARCH_DEBOUNCE_MS,
  type UiSearchGroup,
  type UiSearchHit,
  groupBy,
  matchesAnyAction,
} from "../src/components/command-palette";
import {
  ASK_MODEL_STORAGE_KEY,
  type AskModelId,
  DEFAULT_ASK_MODEL,
  askModelLabel,
  writeAskModel,
} from "../src/lib/ask-model";
import { PANEL_MS } from "../src/lib/motion";

/** Since US-D01 the panel's default tab is "Suggestions" — the command list sits behind "Commands". */
const openCommandsTab = () => fireEvent.click(screen.getByRole("button", { name: "Commands" }));

/** A literal at the call site, but narrowed to AskModelId so a typo fails at compile time. */
const FLASH_ID: AskModelId = "deepseek-v4.1-flash";

describe("groupBy", () => {
  it("groups items by the given key function", () => {
    const grouped = groupBy(
      [
        { g: "a", v: 1 },
        { g: "b", v: 2 },
        { g: "a", v: 3 },
      ],
      (x) => x.g,
    );
    expect(grouped).toEqual({
      a: [
        { g: "a", v: 1 },
        { g: "a", v: 3 },
      ],
      b: [{ g: "b", v: 2 }],
    });
  });
});

describe("CommandPalette (A5 §2.3)", () => {
  it("renders grouped actions and calls perform() + closes on select", () => {
    const perform = vi.fn();
    const onOpenChange = vi.fn();
    const actions: PaletteAction[] = [
      { id: "go-inbox", name: "Go to Inbox", group: "Navigate", perform },
    ];
    render(<CommandPalette open onOpenChange={onOpenChange} actions={actions} />);
    fireEvent.click(screen.getByText("Go to Inbox"));
    expect(perform).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('CommandPalette mode="inline" (the U1 kinso ask/search pill bar)', () => {
  it("shows the kinso placeholder and no dropdown list while closed", () => {
    render(<CommandPalette mode="inline" open={false} onOpenChange={vi.fn()} actions={[]} />);
    expect(screen.getByPlaceholderText("Start typing to ask or search")).toBeInTheDocument();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("mounts the AI panel dialog only while open (US-D01)", () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <CommandPalette mode="inline" open={false} onOpenChange={onOpenChange} actions={[]} />,
    );
    expect(screen.queryByRole("dialog", { name: "AI panel" })).not.toBeInTheDocument();

    rerender(<CommandPalette mode="inline" open onOpenChange={onOpenChange} actions={[]} />);
    expect(screen.getByRole("dialog", { name: "AI panel" })).toBeInTheDocument();
  });

  it("typing into the pill opens the palette (onOpenChange(true))", () => {
    const onOpenChange = vi.fn();
    render(<CommandPalette mode="inline" open={false} onOpenChange={onOpenChange} actions={[]} />);
    fireEvent.change(screen.getByPlaceholderText("Start typing to ask or search"), {
      target: { value: "s" },
    });
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("focusing the pill also opens the palette", () => {
    const onOpenChange = vi.fn();
    render(<CommandPalette mode="inline" open={false} onOpenChange={onOpenChange} actions={[]} />);
    fireEvent.focus(screen.getByPlaceholderText("Start typing to ask or search"));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("when open, renders the same grouped actions as the dialog mode does", () => {
    const perform = vi.fn();
    const actions: PaletteAction[] = [
      { id: "go-inbox", name: "Go to Inbox", group: "Navigate", perform },
    ];
    render(<CommandPalette mode="inline" open onOpenChange={vi.fn()} actions={actions} />);
    openCommandsTab();
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Go to Inbox"));
    expect(perform).toHaveBeenCalledOnce();
  });
});

describe('CommandPalette mode="inline" close paths (U1 regression)', () => {
  it("Escape closes the inline dropdown", () => {
    const onOpenChange = vi.fn();
    render(<CommandPalette mode="inline" open onOpenChange={onOpenChange} actions={[]} />);
    fireEvent.keyDown(screen.getByPlaceholderText("Start typing to ask or search"), {
      key: "Escape",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("a pointerdown outside the pill closes the inline dropdown", () => {
    const onOpenChange = vi.fn();
    render(<CommandPalette mode="inline" open onOpenChange={onOpenChange} actions={[]} />);
    fireEvent.pointerDown(document.body);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("a pointerdown inside the palette does not close it (a click on a selection has to survive)", () => {
    const onOpenChange = vi.fn();
    const actions: PaletteAction[] = [
      { id: "go-inbox", name: "Go to Inbox", group: "Navigate", perform: vi.fn() },
    ];
    render(<CommandPalette mode="inline" open onOpenChange={onOpenChange} actions={actions} />);
    openCommandsTab();
    fireEvent.pointerDown(screen.getByText("Go to Inbox"));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("does not listen while closed", () => {
    const onOpenChange = vi.fn();
    render(<CommandPalette mode="inline" open={false} onOpenChange={onOpenChange} actions={[]} />);
    fireEvent.pointerDown(document.body);
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

// motion-OSS S5: below 900px the panel is `vaul`'s drawer, and a drawer hands focus back to whatever
// opened it on the way out — here the ask bar's own input, whose `onFocus` opens the panel. So the
// dismissal and the focus return fought: Escape (and the scrim) closed the drawer and the focus it
// restored opened it again, which left the panel with no way out at that tier. The first run of the
// evidence script is where this surfaced — it waits for the AI drawer to detach after Escape and
// timed out on a drawer that was open again.
describe('CommandPalette mode="inline", the narrow tier (motion-OSS S5)', () => {
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

  /** `open` follows `onOpenChange`, which is what App.tsx's `askOpen` does. A spy on its own could
   *  not carry this regression: the reopen is a state change the drawer then follows. It starts
   *  closed and is opened by focusing the bar, which is the app's own path — and the reason the
   *  drawer's return-focus has anywhere to land that reopens it. */
  function Harness() {
    const [open, setOpen] = useState(false);
    return <CommandPalette mode="inline" open={open} onOpenChange={setOpen} actions={[]} />;
  }

  it("closes on Escape, and the focus it hands back does not reopen it", async () => {
    stubTier(true);
    render(<Harness />);
    await act(async () => {
      screen.getByPlaceholderText("Start typing to ask or search").focus();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.querySelector("[data-vaul-drawer].ask-panel")).not.toBeNull();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    // Radix runs its unmount-autofocus on a `setTimeout(…, 0)` of its own, after the drawer is gone.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(document.querySelector("[data-vaul-drawer].ask-panel")).toBeNull();
  });
});

describe('CommandPalette mode="inline" model picker persistence (US-D01)', () => {
  // test/setup.ts's in-memory Storage survives for the whole file — empty it between tests.
  beforeEach(() => localStorage.clear());

  it("pick swaps the toggle label and writes the id to localStorage", () => {
    render(<CommandPalette mode="inline" open onOpenChange={vi.fn()} actions={[]} />);

    const toggle = screen.getByRole("button", { name: askModelLabel(DEFAULT_ASK_MODEL) });
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: askModelLabel(FLASH_ID) }));

    expect(toggle).toHaveTextContent(askModelLabel(FLASH_ID));
    expect(localStorage.getItem(ASK_MODEL_STORAGE_KEY)).toBe(FLASH_ID);
  });

  it("starts on the stored model", () => {
    writeAskModel(FLASH_ID);
    render(<CommandPalette mode="inline" open onOpenChange={vi.fn()} actions={[]} />);

    expect(screen.getByRole("button", { name: askModelLabel(FLASH_ID) })).toBeInTheDocument();
  });
});

const askInput = () => screen.getByPlaceholderText("Start typing to ask or search");

describe('CommandPalette mode="inline" typing path (US-D01 regression)', () => {
  const actions: PaletteAction[] = [
    { id: "go-inbox", name: "Go to Inbox", group: "Navigate", perform: vi.fn() },
  ];

  it("typing reaches the cmdk list without clicking the Commands tab", () => {
    render(<CommandPalette mode="inline" open onOpenChange={vi.fn()} actions={actions} />);
    // Before typing this is the Suggestions tab — there is no command list yet.
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    fireEvent.change(askInput(), { target: { value: "Inbox" } });

    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getByText("Go to Inbox")).toBeInTheDocument();
  });

  it('a leading ">" also lands on the Commands tab', () => {
    render(<CommandPalette mode="inline" open onOpenChange={vi.fn()} actions={actions} />);
    fireEvent.change(askInput(), { target: { value: ">" } });
    expect(screen.getByRole("button", { name: "Commands" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("clearing the query returns to the Suggestions tab", () => {
    render(<CommandPalette mode="inline" open onOpenChange={vi.fn()} actions={actions} />);
    fireEvent.change(askInput(), { target: { value: "Inbox" } });
    fireEvent.change(askInput(), { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Draft a reply" })).toBeInTheDocument();
  });
});

describe('CommandPalette mode="inline" @ mention affordance (US-D01)', () => {
  it("is present before any @ is typed and inserts one into the input", () => {
    render(<CommandPalette mode="inline" open onOpenChange={vi.fn()} actions={[]} />);
    expect(screen.queryByText("@ mention")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add mention" }));

    expect(askInput()).toHaveValue("@");
    expect(screen.getByText("@ mention")).toBeInTheDocument();
  });
});

describe('CommandPalette mode="inline" close spring (US-D01)', () => {
  afterEach(() => vi.useRealTimers());

  it("keeps the panel mounted for one --dur-panel so the close animation can play", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <CommandPalette mode="inline" open onOpenChange={vi.fn()} actions={[]} />,
    );
    rerender(<CommandPalette mode="inline" open={false} onOpenChange={vi.fn()} actions={[]} />);

    expect(screen.getByRole("dialog", { name: "AI panel" })).toHaveClass("ask-panel--closing");

    // US-D04: the hold is --dur-panel, which moved from the 240ms transition rung to the 320ms layer
    // rung (DESIGN-DIRECTION's ladder). Asserted against the token's own mirror in lib/motion.ts
    // rather than a literal, so the two cannot drift apart again.
    act(() => vi.advanceTimersByTime(PANEL_MS - 1));
    expect(screen.getByRole("dialog", { name: "AI panel" })).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("dialog", { name: "AI panel" })).not.toBeInTheDocument();
  });
});

describe("matchesAnyAction (A5 §2.5: search mode when the input matches no action)", () => {
  const actions: PaletteAction[] = [
    { id: "go-inbox", name: "Go to Inbox", group: "Navigation", perform: () => {} },
  ];

  it("stays in action mode for an empty query", () => {
    expect(matchesAnyAction("", actions)).toBe(true);
  });

  it("stays in action mode when the query matches an action name (case-insensitive substring)", () => {
    expect(matchesAnyAction("inbox", actions)).toBe(true);
  });

  it("switches to search mode when nothing matches", () => {
    expect(matchesAnyAction("davich", actions)).toBe(false);
  });

  it("is search mode when nothing matches and there are no actions at all", () => {
    expect(matchesAnyAction("davich", [])).toBe(false);
  });
});

const hit = (
  kind: "person" | "thread" | "item" | "memory",
  id: string,
  title: string,
  snippet: string,
  deepLinkDisabled = false,
  sourceKind: string | null = null,
) => ({ kind, id, title, snippet, deepLinkDisabled, sourceKind });

describe("CommandPalette search memory badge (A5 §2.5 source_kind)", () => {
  it("shows the source badge on a memory row and nowhere else", () => {
    const groups: UiSearchGroup[] = [
      {
        kind: "items",
        label: "Items",
        results: [hit("item", "i1", "omnis launch sync", "sync tomorrow")],
      },
      {
        kind: "memories",
        label: "Memories",
        results: [hit("memory", "m1", "Preference", "prefers morning meetings", false, "calendar")],
      },
    ];
    render(
      <CommandPalette
        open
        onOpenChange={() => {}}
        actions={[]}
        search={{ groups, loading: false, onQueryChange: () => {}, onSelectHit: () => {} }}
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "prefers" } });

    // The dialog renders into a portal, so the rows are not inside the test's container.
    const badges = document.querySelectorAll(".palette-search__source");
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveTextContent("calendar");
    // The badge belongs to the memory row, not to the item above it.
    expect(badges[0]?.closest("[cmdk-item]")).toHaveTextContent("Preference");
  });

  it("draws no badge for a hit the hub sent without a source", () => {
    const groups: UiSearchGroup[] = [
      { kind: "threads", label: "Threads", results: [hit("thread", "t1", "omnis launch", "sync")] },
    ];
    render(
      <CommandPalette
        open
        onOpenChange={() => {}}
        actions={[]}
        search={{ groups, loading: false, onQueryChange: () => {}, onSelectHit: () => {} }}
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "launch" } });

    expect(document.querySelectorAll(".palette-search__source")).toHaveLength(0);
  });
});

describe("CommandPalette search mode (A5 §2.5 fixed group order, memory deep_link click disabled)", () => {
  it("renders people before memories and blocks a deep_link-less memory hit", () => {
    const onSelectHit = vi.fn();
    const groups: UiSearchGroup[] = [
      {
        kind: "memories",
        label: "Memories",
        results: [hit("memory", "m1", "Preference", "prefers morning meetings", true)],
      },
      {
        kind: "people",
        label: "People",
        results: [hit("person", "p1", "David Park", "")],
      },
    ];
    render(
      <CommandPalette
        open
        onOpenChange={() => {}}
        actions={[]}
        search={{ groups, loading: false, onQueryChange: () => {}, onSelectHit }}
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "david" } });

    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveTextContent("David Park");
    fireEvent.click(screen.getByText("Preference"));
    expect(onSelectHit).not.toHaveBeenCalled();
  });

  it("shows the empty-state copy when typing yields no groups at all", () => {
    render(
      <CommandPalette
        open
        onOpenChange={() => {}}
        actions={[]}
        search={{ groups: [], loading: false, onQueryChange: () => {}, onSelectHit: () => {} }}
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "davich" } });
    expect(screen.getByText("No results for davich")).toBeInTheDocument();
  });

  it("shows the slow-state copy while the hub is still answering", () => {
    render(
      <CommandPalette
        open
        onOpenChange={() => {}}
        actions={[]}
        search={{ groups: [], loading: true, onQueryChange: () => {}, onSelectHit: () => {} }}
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "davich" } });
    expect(screen.getByText("Searching…")).toBeInTheDocument();
  });

  it("selects a hit that does have a deep link", () => {
    const onSelectHit = vi.fn();
    const groups: UiSearchGroup[] = [
      { kind: "threads", label: "Threads", results: [hit("thread", "t1", "omnis launch", "sync")] },
    ];
    render(
      <CommandPalette
        open
        onOpenChange={() => {}}
        actions={[]}
        search={{ groups, loading: false, onQueryChange: () => {}, onSelectHit }}
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "launch" } });
    fireEvent.click(screen.getByText("omnis launch"));
    expect(onSelectHit).toHaveBeenCalledWith(hit("thread", "t1", "omnis launch", "sync"));
  });
});

describe("CommandPalette search debounce (A5 §2.5: 180ms)", () => {
  afterEach(() => vi.useRealTimers());

  it("asks the hub once, 180ms after the last keystroke", () => {
    vi.useFakeTimers();
    const onQueryChange = vi.fn();
    render(
      <CommandPalette
        open
        onOpenChange={() => {}}
        actions={[]}
        search={{ groups: [], loading: false, onQueryChange, onSelectHit: () => {} }}
      />,
    );
    const input = screen.getByRole("combobox");

    // Three keystrokes inside one debounce window: only the last one is asked about.
    fireEvent.change(input, { target: { value: "d" } });
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1));
    fireEvent.change(input, { target: { value: "da" } });
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1));
    expect(onQueryChange).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "davich" } });
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS));
    expect(onQueryChange).toHaveBeenCalledTimes(1);
    expect(onQueryChange).toHaveBeenCalledWith("davich");
  });
});

describe('CommandPalette mode="inline" search mode (US-B27)', () => {
  const search = (groups: UiSearchGroup[]) => ({
    groups,
    loading: false,
    onQueryChange: vi.fn(),
    onSelectHit: vi.fn(),
  });

  it("types straight into search results when no action matches, and the tab says Search", () => {
    const actions: PaletteAction[] = [
      { id: "go-inbox", name: "Go to Inbox", group: "Navigate", perform: vi.fn() },
    ];
    const groups: UiSearchGroup[] = [
      {
        kind: "items",
        label: "Items",
        results: [hit("item", "i1", "omnis launch sync", "Let's sync tomorrow at 10am")],
      },
    ];
    const onSelectHit = vi.fn();
    render(
      <CommandPalette
        mode="inline"
        open
        onOpenChange={vi.fn()}
        actions={actions}
        search={{ groups, loading: false, onQueryChange: vi.fn(), onSelectHit }}
      />,
    );

    fireEvent.change(askInput(), { target: { value: "launch" } });

    expect(screen.getByRole("button", { name: "Search" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByText("omnis launch sync"));
    expect(onSelectHit).toHaveBeenCalledWith(
      hit("item", "i1", "omnis launch sync", "Let's sync tomorrow at 10am"),
    );
  });

  it("keeps the Commands tab while the query still matches an action", () => {
    const actions: PaletteAction[] = [
      { id: "go-inbox", name: "Go to Inbox", group: "Navigate", perform: vi.fn() },
    ];
    render(
      <CommandPalette
        mode="inline"
        open
        onOpenChange={vi.fn()}
        actions={actions}
        search={search([])}
      />,
    );

    fireEvent.change(askInput(), { target: { value: "inbox" } });

    expect(screen.getByRole("button", { name: "Commands" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("Go to Inbox")).toBeInTheDocument();
  });
});

describe("CommandPalette search rows that share a title (US-B27 cmdk item identity)", () => {
  // cmdk identifies an item by its `value` prop and falls back to the row's rendered text when
  // none is passed. Two rows that render the same title therefore collapse into one identity, so
  // selection (which is `item.value === selectedValue`) matches both at once. The empty snippet
  // is deliberate: the component skips an empty snippet, so title is all each row renders.
  const duplicate = (id: string): UiSearchHit => hit("thread", id, "omnis launch sync", "");
  const groups: UiSearchGroup[] = [
    { kind: "threads", label: "Threads", results: [duplicate("t1"), duplicate("t2")] },
  ];
  const renderSearch = (onSelectHit = vi.fn()) => {
    render(
      <CommandPalette
        open
        onOpenChange={() => {}}
        actions={[]}
        search={{ groups, loading: false, onQueryChange: () => {}, onSelectHit }}
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "launch" } });
    return onSelectHit;
  };
  const selectedRows = () => document.querySelectorAll('[cmdk-item][aria-selected="true"]');

  it("marks exactly one row selected", () => {
    renderSearch();
    expect(selectedRows()).toHaveLength(1);
  });

  it("Enter opens the row the keyboard moved to, not the first row with that title", () => {
    const onSelectHit = renderSearch();
    const input = screen.getByRole("combobox");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSelectHit).toHaveBeenCalledWith(duplicate("t2"));
  });
});
